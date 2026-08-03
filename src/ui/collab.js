'use strict';

/* ══════════════════════════════════════════════════════════════════════
   LIVE-BEARBEITUNG  ―  nur in der App

   Setzt zusammen, was in einem geteilten Dokument gleichzeitig passiert:

     · Anwesenheit  Wer ist gerade dabei, und auf welcher Seite?
     · Marker       Abzeichen mit Initialen am Rand dieser Seite
     · Text         zeichengenau gemeinsam, über Yjs
     · Handschrift  Striche erscheinen sofort beim anderen

   Anwesenheit und der Strom der Änderungen laufen über die Realtime
   Database (core/share.js, joinDocRoom). Die dauerhafte Fassung bleibt
   in Firestore und wird im gewohnten Takt geschrieben.

   ── Warum der Text als Zeichenkette durch Yjs geht ──────────────────
   Der Editor ist ein contenteditable und arbeitet mit einem HTML-String
   je Seite. Diesen String hält Yjs als Y.Text. Tippen zwei Leute an
   verschiedenen Stellen, führt Yjs beides zusammen – genau das, was
   fehlte. Der Editor selbst musste dafür nicht umgebaut werden.

   Die Grenze, die man kennen muss: zwei Leute, die im selben Moment
   dieselbe Stelle formatieren (fett, Überschrift), können ein Tag-Paar
   ineinanderschieben. Der Text bleibt erhalten, die Auszeichnung kann
   dabei verrutschen. Für getrenntes Arbeiten an verschiedenen Absätzen –
   der Normalfall – tritt das nicht auf.

   ── Was ohne Realtime Database passiert ─────────────────────────────
   Nichts Schlimmes: Anwesenheit und Live-Übertragung bleiben aus, das
   Dokument lässt sich weiterhin öffnen und bearbeiten, gespeichert wird
   im 4-Sekunden-Takt nach Firestore. Es erscheint ein Hinweis in der
   Konsole, kein Fehler für den Nutzer.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  // Höchstens so oft geht eine Textänderung raus. Tippen erzeugt sonst
  // pro Anschlag eine Nachricht.
  const TEXT_FLUSH_MS = 300;

  // Verschwundene Marker aufräumen: die RTDB entfernt Einträge beim
  // Verbindungsabbruch selbst, ein abgestürztes Fenster kann aber einen
  // Rest hinterlassen.
  const PRESENCE_STALE_MS = 90 * 1000;

  let room = null;          // der betretene Raum (core/share.js)
  let docId = null;
  let docs = new Map();     // pageId -> { ydoc, ytext, applying, dirty }
  let inkSeen = new Map();  // pageId -> Set der schon vorhandenen Striche
  let others = [];          // wer sonst noch da ist
  let staleTimer = null;
  let caretTimer = null;    // eigener, schnellerer Takt für Marken und Sperren
  let stops = [];           // Aufräumarbeiten beim Verlassen
  let canWrite = false;     // darf diese Person schreiben?
  let lastError = '';       // warum der Live-Betrieb nicht zustande kam

  /**
   * Sagt im Streifen über dem Dokument, ob die Live-Übertragung läuft.
   * Vorher scheiterte sie stumm: die App sah aus wie immer, nur kam
   * nichts an und niemand wusste warum.
   */
  function showLiveState() {
    const el = E('collab-state');
    if (!el) return;

    if (room) {
      el.textContent = '';
      el.style.display = 'none';
      return;
    }

    el.style.display = 'inline';
    el.textContent = t('collabOffline');
    el.title = lastError || '';
  }

  /* ── Yjs ──────────────────────────────────────────────────────────── */

  function yAvailable() {
    return typeof window.Y === 'object' && typeof window.Y.Doc === 'function';
  }

  function toBase64(bytes) {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /**
   * Erzeugt den ersten Yjs-Stand aus vorhandenem Text.
   *
   * >>> Der feste clientID ist kein Versehen <<<
   * Wenn zwei Leute gleichzeitig ein Dokument öffnen, das noch keinen
   * CRDT-Stand hat, würden beide einen anlegen. Mit zufälliger Kennung
   * wären das für Yjs zwei VERSCHIEDENE Texte, und beim Zusammenführen
   * stünde alles doppelt da. Mit einer festen Kennung erzeugen beide
   * exakt denselben Stand – das Zusammenführen ist dann wirkungslos,
   * und genau das ist hier richtig.
   */
  function seedUpdate(text) {
    const seed = new window.Y.Doc();
    seed.clientID = 1;
    seed.getText('t').insert(0, String(text || ''));
    return window.Y.encodeStateAsUpdate(seed);
  }

  /** Holt (oder legt an) den gemeinsamen Text einer Seite. */
  function docFor(pageId, initialText, storedState) {
    if (docs.has(pageId)) return docs.get(pageId);

    const ydoc = new window.Y.Doc();
    if (storedState) {
      window.Y.applyUpdate(ydoc, fromBase64(storedState));
    } else {
      window.Y.applyUpdate(ydoc, seedUpdate(initialText));
    }

    const entry = { ydoc, ytext: ydoc.getText('t'), applying: false, dirty: false, timer: null };

    ydoc.on('update', (update, origin) => {
      // Von außen gekommene Änderungen nicht zurücksenden
      if (origin === 'remote') return;
      entry.dirty = true;
      if (!room) return;

      /* Die eigene Stelle FÄHRT MIT der Textänderung.
         Sonst laufen zwei Wege nebeneinander: der Text über den
         Änderungsstrom, die Stelle über die Anwesenheit – und welcher
         zuerst ankommt, ist offen. Traf die Stelle vor dem Text ein,
         zeigte sie auf Zeichen, die es beim anderen noch gar nicht gab;
         traf sie danach ein, hinkte die Marke sichtbar hinterher. Im
         selben Paket kann beides nicht mehr auseinanderlaufen. */
      const op = { k: 'y', p: pageId, u: toBase64(update) };
      const hier = caretInfoFor(pageId);
      if (hier) {
        op.c = hier.offset;
        if (hier.anker) op.cx = hier.anker;
        if (hier.lock) { op.lf = hier.lock.from; op.lt = hier.lock.to; }
      }
      room.sendOp(op);
    });

    docs.set(pageId, entry);
    return entry;
  }

  /**
   * Findet die eine Stelle, an der sich zwei Fassungen unterscheiden.
   *
   * Verglichen wird nur an den Rändern: was vorne und hinten gleich
   * geblieben ist, bleibt unangetastet. Das genügt, weil an einer
   * Schreibmarke immer nur eine zusammenhängende Stelle geändert wird –
   * und es ist wichtig, dass möglichst wenig angefasst wird, denn jede
   * angefasste Stelle kann mit der Änderung eines anderen kollidieren.
   *
   * @returns {{at:number, remove:number, insert:string}|null}
   */
  function textDelta(current, next) {
    if (current === next) return null;

    let start = 0;
    const max = Math.min(current.length, next.length);
    while (start < max && current[start] === next[start]) start++;

    let endOld = current.length;
    let endNew = next.length;
    while (endOld > start && endNew > start && current[endOld - 1] === next[endNew - 1]) {
      endOld--; endNew--;
    }

    return { at: start, remove: endOld - start, insert: next.slice(start, endNew) };
  }

  /**
   * Wo liegt eine Stelle, nachdem sich der Text davor geändert hat?
   *
   * >>> Warum die eigene Marke das braucht <<<
   * Tippt der andere etwas VOR der eigenen Schreibmarke, rutscht der
   * ganze Text dahinter weiter – die Marke muss um denselben Betrag mit.
   * Bisher wurde sie nach einer fremden Änderung auf dieselbe ZAHL
   * zurückgesetzt: sie blieb stehen, während der Text unter ihr
   * weiterwanderte. Nach ein paar fremden Anschlägen stand sie mitten im
   * vorigen Wort oder gleich eine Zeile höher, und das Nächste, was man
   * tippte, landete dort statt an der Stelle, auf die man sah – genau
   * das „der Text geht in die falsche Zeile".
   *
   * @param {string} vorher
   * @param {string} nachher
   * @param {number} stelle
   */
  function shiftedPos(vorher, nachher, stelle) {
    const d = textDelta(vorher, nachher);
    if (!d) return stelle;

    // Die Änderung liegt ganz hinter der Marke – die bleibt, wo sie ist
    if (stelle < d.at) return stelle;

    // Ganz davor: um den Längenunterschied mitwandern. Der Gleichstand
    // (stelle === d.at) gehört hierher: fremd Eingefügtes schiebt die
    // eigene Marke nach rechts, so wie es auf dem Papier auch aussieht.
    if (stelle >= d.at + d.remove) return stelle + d.insert.length - d.remove;

    // Mitten im geänderten Bereich – die Marke am Text festmachen
    return verankerteStelle(vorher, nachher, stelle);
  }

  // So viele Zeichen werden höchstens als Halt genommen
  const HALT_MAX = 24;
  // Kürzer als das ist kein Halt mehr, sondern Zufall
  const HALT_MIN = 3;

  /**
   * Die eigene Marke liegt IM geänderten Bereich – wohin damit?
   *
   * >>> Warum hier nicht „ans Ende des Neuen" <<<
   * Genau das stand hier, und es war der Grund für „mein Cursor springt
   * dorthin, wo der andere schreibt". Das Ende des Neuen IST die Stelle,
   * an der der andere gerade tippt.
   *
   * Und der Fall trat nicht etwa selten ein: textDelta vergleicht über
   * gemeinsamen Anfang und gemeinsames Ende und fasst damit ALLES
   * dazwischen zu einem einzigen Block zusammen. Unterscheiden sich die
   * beiden Fassungen an ZWEI Stellen – sein Tippen oben, meines unten,
   * der Normalfall beim gemeinsamen Schreiben –, dann reicht dieser eine
   * Block über den halben Text, und die eigene Marke liegt fast immer
   * darin. Sie wurde also bei fast jedem fremden Anschlag an sein
   * Textende gezogen. Weil reportCaret die verrutschte Stelle danach
   * weitermeldet, saß auch SEIN Bild meiner Marke und mein Sperrband
   * falsch – ein Fehler, drei Beschwerden.
   *
   * Verlässlich ist stattdessen der Text unmittelbar um die Marke herum:
   * erst die Zeichen davor, sonst die dahinter. Wird davon nichts
   * wiedergefunden, bleibt die Marke lieber ungefähr stehen, als
   * irgendwohin zu springen.
   */
  function verankerteStelle(vorher, nachher, stelle) {
    /* Der Halt DAVOR: die Marke gehört hinter diese Zeichen. Von lang
       nach kurz, damit der längste eindeutige Halt gewinnt. */
    for (let len = Math.min(HALT_MAX, stelle); len >= HALT_MIN; len--) {
      const halt = vorher.slice(stelle - len, stelle);
      const treffer = naechsterTreffer(nachher, halt, stelle, len);
      if (treffer !== -1) return treffer;
    }

    /* Nichts davor wiedergefunden – dann der Halt DAHINTER. Die Marke
       gehört vor diese Zeichen. Hilft, wenn ausgerechnet das Wort vor
       der Marke ersetzt wurde. */
    for (let len = Math.min(HALT_MAX, vorher.length - stelle); len >= HALT_MIN; len--) {
      const halt = vorher.slice(stelle, stelle + len);
      const treffer = naechsterTreffer(nachher, halt, stelle, 0);
      if (treffer !== -1) return treffer;
    }

    // Weder noch: ungefähr stehen bleiben ist besser als springen
    return Math.min(stelle, nachher.length);
  }

  /**
   * Die Fundstelle von `halt`, die der bisherigen Stelle am nächsten
   * liegt. `versatz` sagt, wo die Marke bezogen auf den Fund sitzt.
   */
  function naechsterTreffer(text, halt, stelle, versatz) {
    let beste = -1;
    let abstand = Infinity;
    for (let i = text.indexOf(halt); i !== -1; i = text.indexOf(halt, i + 1)) {
      const kandidat = i + versatz;
      const d = Math.abs(kandidat - stelle);
      if (d < abstand) { abstand = d; beste = kandidat; }
    }
    return beste;
  }

  /* ══════════════════════════════════════════════════════════════════
     AUFZEICHNUNG: was ein fremder Anschlag mit der eigenen Marke macht

     Die Beschwerde „mein Cursor springt dorthin, wo der andere schreibt"
     lässt sich von außen nicht nachstellen – sie hängt daran, wie weit
     die beiden Fassungen im Augenblick auseinander sind. Hier wird
     deshalb jeder Lauf mitgeschrieben. Im Fenster:

         Collab.caretLog()

     Interessant ist die Spalte `fall`: „innen" heißt, die Marke lag im
     geänderten Bereich und musste über den Halt wiedergefunden werden.
     Steht in `haltVorher` und `haltNachher` dasselbe, sitzt sie richtig.
     ══════════════════════════════════════════════════════════════════ */

  const CARET_LOG_MAX = 40;
  const caretLog = [];

  function merkeCaretLauf(vorher, nachher, caret, ziel, textDiv) {
    if (vorher === null) return;
    let d = null;
    try { d = textDelta(vorher, nachher); } catch (e) { return; }

    const fall = !d ? 'nichts'
      : caret < d.at ? 'davor'
      : caret >= d.at + d.remove ? 'dahinter'
      : 'innen';

    caretLog.push({
      zeit: new Date().toLocaleTimeString(),
      fall,
      vonStelle: caret,
      nachStelle: ziel,
      sprung: ziel - caret,
      aenderungBei: d ? d.at : null,
      entfernt: d ? d.remove : null,
      eingefuegt: d ? d.insert.length : null,
      // Der Text um die Marke – vorher und nachher. Muss gleich bleiben.
      haltVorher: JSON.stringify(vorher.slice(Math.max(0, caret - 10), caret)),
      haltNachher: JSON.stringify(nachher.slice(Math.max(0, ziel - 10), ziel)),
      // Wo steht der andere gerade? Zum Vergleich mit nachStelle.
      andere: others.map(p => p.offset).join(',')
    });
    if (caretLog.length > CARET_LOG_MAX) caretLog.shift();
  }

  /** Die letzten Läufe ansehen – für die Fehlersuche im Fenster. */
  function zeigeCaretLog() {
    if (!caretLog.length) { console.log('[Collab] Noch nichts aufgezeichnet.'); return caretLog; }
    console.table(caretLog);
    const verdaechtig = caretLog.filter(e => e.haltVorher !== e.haltNachher);
    if (!verdaechtig.length) {
      console.log('[Collab] Die Marke hat jedes Mal ihren Text behalten.');
    } else {
      console.warn('[Collab] ' + verdaechtig.length + ' von ' + caretLog.length
        + ' Läufen haben die Marke von ihrem Text weggezogen – diese Zeilen ansehen.');
    }
    return caretLog;
  }

  /** Trägt eine lokale Textänderung in den gemeinsamen Text ein. */
  function applyLocalText(pageId, nextText) {
    const entry = docs.get(pageId);
    if (!entry || entry.applying) return;

    const delta = textDelta(entry.ytext.toString(), nextText);
    if (!delta) return;

    entry.ydoc.transact(() => {
      if (delta.remove > 0) entry.ytext.delete(delta.at, delta.remove);
      if (delta.insert) entry.ytext.insert(delta.at, delta.insert);
    });
  }

  /* ── Oberfläche: Leiste und Marker ────────────────────────────────── */

  function renderPresenceBar() {
    const bar = E('collab-people');
    if (!bar) return;

    bar.innerHTML = '';
    if (!others.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';

    // Wie bei Google Docs: ab sechs Personen wird zusammengefasst.
    const shown = others.slice(0, 5);
    for (const person of shown) {
      const dot = document.createElement('span');
      dot.className = 'collab-dot';
      dot.style.background = person.color || 'var(--gold)';
      dot.textContent = person.initials || '?';
      dot.title = person.name || person.email || '';
      bar.appendChild(dot);
    }
    if (others.length > shown.length) {
      const more = document.createElement('span');
      more.className = 'collab-dot collab-dot-more';
      more.textContent = '+' + (others.length - shown.length);
      more.title = others.slice(5).map(p => p.name || p.email).join(', ');
      bar.appendChild(more);
    }
  }

  /**
   * Marker an den Seitenrand: ein Abzeichen mit den Initialen auf Höhe
   * der Seite, auf der die Person gerade ist. Fremde Textcursor werden
   * bewusst NICHT gezeigt – so gewünscht, und nebenbei erheblich
   * einfacher.
   */
  function renderMarkers() {
    document.querySelectorAll('.collab-marker').forEach(el => el.remove());
    if (!others.length) return;

    const byPage = new Map();
    for (const person of others) {
      if (!person.pageId) continue;
      if (!byPage.has(person.pageId)) byPage.set(person.pageId, []);
      byPage.get(person.pageId).push(person);
    }

    for (const [pageId, people] of byPage) {
      const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
      if (!pgEl) continue;

      const rail = document.createElement('div');
      rail.className = 'collab-marker';
      for (const person of people.slice(0, 3)) {
        const dot = document.createElement('span');
        dot.className = 'collab-dot';
        dot.style.background = person.color || 'var(--gold)';
        dot.textContent = person.initials || '?';
        dot.title = (person.name || person.email || '') + ' – ' + t('collabOnThisPage');
        rail.appendChild(dot);
      }
      pgEl.appendChild(rail);
    }
  }

  function cssEscapeId(value) {
    const text = String(value ?? '');
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
    return text.replace(/["\\\]\[]/g, '\\$&');
  }

  /* ── Fremde Schreibmarken ───────────────────────────────────────────
     Ein farbiger Strich genau dort, wo der andere gerade steht, mit
     Namensschild darüber – wie bei Google Docs.

     Warum das erst jetzt geht: die Position ist eine Zahl (Abstand in
     Zeichen). Sie ergibt nur dann bei beiden dasselbe, wenn beide auch
     denselben Text haben – und genau das stellt erst das CRDT sicher.
     Vorher wäre der Strich mal hier, mal dort gelandet.
     ─────────────────────────────────────────────────────────────────── */

  /**
   * Ermittelt das Rechteck der Schreibmarke an einer Stelle.
   *
   * Eine zusammengefallene Auswahl hat keine Breite. getBoundingClientRect
   * liefert dafür in einem Textknoten die richtige Stelle – nur nicht in
   * einem LEEREN Element (frische Zeile), dort kommt (0,0,0,0) zurück.
   * Früher wich der Code dann auf das umgebende Element aus, und die Marke
   * sprang an den Anfang des ganzen Absatzes. Stattdessen wird hier um ein
   * Zeichen erweitert – das ergibt ein echtes Rechteck – und daraus die
   * Kante genommen, an der die Marke steht.
   */
  /* rectOfSpan und caretRectAt liegen in canvas/text.js – sie sind
     Textgeometrie wie flatRangeAt und werden dort auch geprüft
     (scripts/test-collab-caret.js). */

  function renderCarets() {
    document.querySelectorAll('.collab-caret').forEach(el => el.remove());
    if (!others.length) return;

    const zoom = (typeof getZoom === 'function') ? getZoom() : 1;

    /* Nach Seiten gruppiert: der Text einer Seite wird dadurch einmal
       gelesen und nicht je Person erneut. */
    const seiten = new Set(peopleNow().map(p => p.pageId).filter(Boolean));

    for (const pageId of seiten) {
      const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
      const textDiv = pgEl ? pgEl.querySelector('.j-text') : null;
      if (!textDiv) continue;

      let inhalt;
      try { inhalt = flatTextOf(textDiv); } catch (err) { continue; }

      for (const person of peopleOnPage(pageId, textDiv)) {
      if (!Number.isFinite(person.offset) || person.offset < 0) continue;

      let rect = null;
      try {
        /* Zeigt die Stelle immer noch über das Ende hinaus – auch der
           Anker hat sie nicht wiedergefunden –, sind die Fassungen
           auseinander. Einmal sagen, nicht dauernd. */
        if (person.offset > inhalt.length) meldeVersatz(person, inhalt.length);
        rect = caretRectAt(textDiv, person.offset, inhalt);
      } catch (err) { continue; }

      if (!rect || (!rect.height && !rect.width)) continue;

      // Durch den Zoom sind die Maße vergrößert – zurückrechnen, denn die
      // Marke wird IN der Seite platziert und dort gilt die Grundgröße.
      const box = lineBoxOf(pgEl, textDiv, rect, zoom);

      const caret = document.createElement('div');
      caret.className = 'collab-caret';
      caret.style.left = box.left + 'px';
      caret.style.top = box.top + 'px';
      caret.style.height = box.height + 'px';
      caret.style.background = person.color || 'var(--gold)';

      const label = document.createElement('span');
      label.className = 'collab-caret-label';
      label.style.background = person.color || 'var(--gold)';
      label.textContent = person.name || person.email || '?';
      caret.appendChild(label);

      pgEl.appendChild(caret);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     ZEILENSPERRE

     Die Zeile, an der jemand schreibt, und die darauf folgende gehören
     ihm. Für alle anderen sind sie gesperrt: sichtbar durch ein Band in
     seiner Farbe, und Eingaben dort werden abgewiesen (app.js fragt vor
     jedem Anschlag bei editBlockedBy nach).

     >>> Warum das trotz CRDT sinnvoll ist <<<
     Yjs führt zwei gleichzeitige Änderungen zusammen, ohne etwas zu
     verlieren – technisch braucht es die Sperre nicht. Was Yjs NICHT
     kann, ist verhindern, dass zwei Leute denselben Satz gleichzeitig
     umformulieren und hinterher beide Fassungen ineinander stehen. Die
     Sperre ist deshalb bewusst eine Sache der Oberfläche, keine
     Absicherung: sie hält Leute auseinander, sie schützt keine Daten.

     >>> Warum nur mit Nachlauf <<<
     Eine Sperre, die am Cursor hängt, blockiert sonst dauerhaft eine
     Zeile, bloß weil jemand das Fenster offen liegen lässt. Deshalb
     verfällt sie LOCK_TTL_MS nach der letzten Meldung; wer weiterschreibt,
     frischt sie ununterbrochen auf (core/share.js, LOCK_REFRESH_MS).
     ══════════════════════════════════════════════════════════════════ */

  /* So lange gilt eine gemeldete Sperre noch nach.
     Gemessen wird gegen die Uhr des Absenders (lockAt) – gehen die Uhren
     der beiden Geräte auseinander, verschiebt sich der Nachlauf um diesen
     Betrag. Das ist hier vertretbar: geht die eigene Uhr vor, verfällt die
     Sperre zu früh und alle dürfen wieder schreiben; geht sie nach, hält
     sie etwas länger, und spätestens wenn der Schreibende aufhört, gibt er
     sie ausdrücklich frei (reportCaret im caretTimer) oder sein Eintrag
     verschwindet beim Verbindungsabbruch von selbst. Beide Richtungen
     enden also von allein.

     Gerechnet ab der letzten MELDUNG, nicht ab dem letzten Anschlag:
     wer weiterschreibt, frischt ununterbrochen auf. Nach dem Aufhören
     kommen noch LOCK_CLAIM_MS lang Meldungen, danach läuft dieser
     Nachlauf – zusammen bleibt eine Zeile also rund 14 Sekunden
     belegt. */
  const LOCK_TTL_MS = 10000;

  // Höchstens so oft ein Hinweis, wenn jemand in eine gesperrte Zeile tippt
  const LOCK_HINT_MS = 2500;
  let lastLockHint = 0;

  /** Die gerade gültigen Sperren einer Seite. */
  function activeLocks(pageId) {
    const now = Date.now();
    const out = [];

    /* Über peopleOnPage und nicht über peopleNow: die Sperrgrenzen müssen
       auf den hiesigen Text umgerechnet sein, sonst sperren sie nach dem
       Tippen des anderen die falschen Zeilen. */
    const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
    const textDiv = pgEl ? pgEl.querySelector('.j-text') : null;

    for (const person of peopleOnPage(pageId, textDiv)) {
      if (!Number.isFinite(person.lockFrom) || person.lockFrom < 0) continue;
      if (!Number.isFinite(person.lockTo) || person.lockTo < person.lockFrom) continue;
      /* Ohne Zeitstempel (ältere Fassung am anderen Ende) gilt die Sperre
         nicht – lieber gar nicht sperren als unbegrenzt. */
      if (!Number.isFinite(person.lockAt) || now - person.lockAt > LOCK_TTL_MS) continue;
      out.push(person);
    }
    return out;
  }

  /**
   * Wer sperrt diesen Bereich? null, wenn er frei ist.
   *
   * @param {string} pageId
   * @param {number} from  Anfang im flachen Text
   * @param {number} to    Ende, ausschließlich (gleich from = Einfügestelle)
   */
  function lockOwner(pageId, from, to) {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    for (const person of activeLocks(pageId)) {
      // Berührung genügt: an der Grenze einzufügen verändert die Zeile mit
      if (start <= person.lockTo && end >= person.lockFrom) return person;
    }
    return null;
  }

  /**
   * Darf hier gerade geschrieben werden? Wird von app.js vor jeder Eingabe
   * gefragt (beforeinput, paste, Tab, Enter).
   *
   * @param {string} pageId
   * @param {HTMLElement} textDiv
   * @param {string} [inputType] aus dem beforeinput-Ereignis
   * @returns {object|null} die Person, die sperrt – oder null
   */
  function editBlockedBy(pageId, textDiv, inputType) {
    if (!others.length || !textDiv) return null;
    if (typeof flatPosOfPoint !== 'function') return null;

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;

    const range = sel.getRangeAt(0);
    if (!textDiv.contains(range.startContainer)) return null;

    let from, to;
    try {
      from = flatPosOfPoint(textDiv, range.startContainer, range.startOffset);
      to = range.collapsed
        ? from
        : flatPosOfPoint(textDiv, range.endContainer, range.endOffset);
    } catch (err) { return null; }
    if (from === null || to === null) return null;

    /* Löschen greift über die Schreibmarke hinaus: Rückschritt am
       Zeilenanfang holt die Zeile davor herauf, Entfernen am Zeilenende
       die dahinter. Genau das muss die Sperre abfangen. */
    if (range.collapsed) {
      if (inputType === 'deleteContentBackward') from = Math.max(0, from - 1);
      else if (inputType === 'deleteContentForward') to = to + 1;
    }

    return lockOwner(pageId, from, to);
  }

  /** Sagt einmal Bescheid, warum nichts passiert – aber nicht bei jedem Anschlag. */
  function warnLocked(person) {
    const now = Date.now();
    if (now - lastLockHint < LOCK_HINT_MS) return;
    lastLockHint = now;

    const who = person?.name || person?.email || '?';
    const text = (typeof t === 'function' ? t('collabLineLocked') : '{name} bearbeitet diese Zeile')
      .replace('{name}', who);
    if (typeof toast === 'function') toast(text, true);

    const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(person?.pageId || '') + '"]');
    if (pgEl) {
      pgEl.querySelectorAll('.collab-lock').forEach(el => {
        el.classList.remove('bump');
        void el.offsetWidth;         // Neustart der Animation erzwingen
        el.classList.add('bump');
      });
    }
  }

  /** Alle sichtbaren Zeilen eines Bereichs – eine je Bildschirmzeile. */
  function spanRects(textDiv, from, to) {
    const start = flatRangeAt(textDiv, from);
    const end = flatRangeAt(textDiv, to);
    if (!start || !end) return [];

    const span = document.createRange();
    try {
      span.setStart(start.startContainer, start.startOffset);
      span.setEnd(end.startContainer, end.startOffset);
    } catch (err) { return []; }

    const rects = Array.from(span.getClientRects()).filter(r => r.height > 0);
    if (rects.length) return rects;

    // Leere Zeile: kein Inhalt, also auch kein Rechteck – die Marke nehmen
    const caret = caretRectAt(textDiv, from);
    return caret ? [caret] : [];
  }

  function renderLocks() {
    document.querySelectorAll('.collab-lock').forEach(el => el.remove());
    if (!others.length) return;

    const zoom = (typeof getZoom === 'function') ? getZoom() : 1;
    const byPage = new Map();
    for (const person of peopleNow()) {
      if (!person.pageId || byPage.has(person.pageId)) continue;
      const locked = activeLocks(person.pageId);
      if (locked.length) byPage.set(person.pageId, locked);
    }

    for (const [pageId, people] of byPage) {
      const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
      const textDiv = pgEl ? pgEl.querySelector('.j-text') : null;
      if (!textDiv || typeof textDiv.getBoundingClientRect !== 'function') continue;

      const pageRect = pgEl.getBoundingClientRect();
      const textRect = textDiv.getBoundingClientRect();
      // Das Band geht über die ganze Textbreite, nicht nur über die
      // beschriebenen Zeichen – gesperrt ist die ZEILE, nicht der Satz.
      const left = (textRect.left - pageRect.left) / zoom;
      const width = textRect.width / zoom;

      for (const person of people) {
        let rects = [];
        try { rects = spanRects(textDiv, person.lockFrom, person.lockTo); }
        catch (err) { continue; }
        if (!rects.length) continue;

        /* Mehrere Rechtecke derselben Zeile zusammenfassen: getClientRects
           zerlegt eine Zeile an jeder Auszeichnung (fett, kursiv) in
           Stücke, und daraus würden sonst mehrere Bänder übereinander. */
        const zeilen = [];
        for (const rect of rects) {
          const box = lineBoxOf(pgEl, textDiv, rect, zoom);
          const schon = zeilen.find(z => Math.abs(z.top - box.top) < box.height / 2);
          if (!schon) zeilen.push(box);
        }

        zeilen.forEach((box, i) => {
          const band = document.createElement('div');
          band.className = 'collab-lock';
          band.style.left = left + 'px';
          band.style.width = width + 'px';
          band.style.top = box.top + 'px';
          band.style.height = box.height + 'px';
          band.style.setProperty('--lock-color', person.color || 'var(--gold)');

          if (i === 0) {
            const tag = document.createElement('span');
            tag.className = 'collab-lock-tag';
            tag.style.background = person.color || 'var(--gold)';
            tag.textContent = '🔒 ' + (person.name || person.email || '?');
            band.appendChild(tag);
          }
          pgEl.appendChild(band);
        });
      }
    }
  }

  /* Wann zuletzt getippt wurde, je Seite. Entscheidet, ob die eigene
     Zeile für die anderen gesperrt wird: eine Sperre am bloß abgelegten
     Cursor würde eine Zeile blockieren, obwohl niemand daran arbeitet. */
  const typedAt = new Map();

  // So lange nach dem letzten Anschlag gilt man noch als „am Schreiben"
  const LOCK_CLAIM_MS = 4000;

  /**
   * Schreibt diese Person gerade auf dieser Seite?
   *
   * >>> Warum daran auch die MARKE hängt und nicht nur die Sperre <<<
   * Gezeigt wurde die fremde Schreibmarke, sobald jemand die Seite offen
   * hatte – auch wenn er seit einer Viertelstunde nichts tut. Eine Marke,
   * die nur herumsteht, sagt niemandem etwas; sie muss aber trotzdem
   * ununterbrochen richtig sitzen, und gerade der ruhende Cursor steht
   * gern an den Stellen, die sich am schlechtesten messen lassen (leere
   * Zeile, Absatzgrenze).
   *
   * Beim Tippen ist die Stelle dagegen immer die hinter dem eben
   * geschriebenen Zeichen – die lässt sich unmittelbar messen. Marke und
   * Sperrband erscheinen deshalb zusammen und verschwinden zusammen.
   */
  function schreibtGerade(pageId) {
    const last = typedAt.get(pageId) || 0;
    return Date.now() - last <= LOCK_CLAIM_MS;
  }

  /* Die eigene Position melden. Ausgelöst von jeder Bewegung der
     Schreibmarke – die Bremse sitzt in core/share.js, hier wird nur
     festgestellt, wo sie steht und welche Zeilen sie belegt. */
  function reportCaret() {
    if (!room) return;

    /* Nach der FOKUSSIERTEN Seite gehen, nicht nach S.activePgId. Der
       Wert dort wechselt schon beim Scrollen (eine Seite rutscht ins
       Bild), während die Schreibmarke ganz woanders steht – die Marke
       wäre dann ständig auf der falschen Seite oder verschwände. */
    const focused = document.activeElement;
    const isText = focused && focused.classList && focused.classList.contains('j-text');
    const pgEl = isText ? focused.closest('[data-pgid]') : null;

    if (pgEl && typeof flatCaretPos === 'function') {
      const pageId = pgEl.dataset.pgid;
      const hier = caretInfoFor(pageId);
      if (hier) {
        room.setPage(pageId, hier.offset, hier.lock, hier.anker);
        return;
      }
    }

    // Nicht im Text: nur melden, auf welcher Seite man ist – ohne Sperre
    if (S.activePgId) room.setPage(S.activePgId, -1, null, '');
  }

  /**
   * Welche Zeilen beansprucht diese Person gerade? Die, in der sie steht,
   * und die darauf folgende – aber nur, solange sie auch wirklich tippt.
   */
  function lockSpanFor(pageId, textDiv, offset) {
    if (!canWrite || S.readOnly) return null;
    if (!schreibtGerade(pageId)) return null;
    if (typeof flatTextOf !== 'function') return null;

    try {
      return visualLineSpan(textDiv, offset);
    } catch (err) { return null; }
  }

  /** Wo steht die eigene Marke auf DIESER Seite – falls sie dort steht. */
  function caretInfoFor(pageId) {
    const focused = document.activeElement;
    if (!focused || !focused.classList || !focused.classList.contains('j-text')) return null;
    if (typeof flatCaretPos !== 'function') return null;

    const pgEl = focused.closest('[data-pgid]');
    if (!pgEl || pgEl.dataset.pgid !== pageId) return null;

    /* Nicht am Schreiben: die Seite melden, aber keine Stelle. −1 heißt
       „ist hier, zeigt aber nirgendwohin" – die anderen lassen die Marke
       dann weg (renderCarets überspringt alles unter 0). Das Abzeichen am
       Seitenrand bleibt davon unberührt. */
    if (!schreibtGerade(pageId)) return { offset: -1, anker: '', lock: null };

    const offset = flatCaretPos(focused);
    if (offset === null) return null;

    // Der Anker macht die Stelle beim anderen wiederauffindbar
    let anker = '';
    try { anker = ankerAt(flatTextOf(focused), offset); } catch (err) { anker = ''; }

    return { offset, anker, lock: lockSpanFor(pageId, focused, offset) };
  }

  /* ── Zwei Quellen für dieselbe Stelle ───────────────────────────────
     Die Stelle kommt auf zwei Wegen: an der Textänderung (genau, weil sie
     zum selben Text gehört) und über die Anwesenheit (auch dann, wenn
     jemand nur den Cursor bewegt, ohne zu tippen).

     >>> Warum die beiden sich in die Quere kamen <<<
     Die Anwesenheit meldet alle 150 ms, der Text alle 300 ms. Beim Tippen
     traf also regelmäßig eine Stelle ein, die zu einem Text gehörte, den
     es hier noch gar nicht gab – sie zeigte hinter das Ende, die Marke
     sprang ans Dokumentende, und mit der nächsten Textänderung wieder
     zurück. Genau dieses Zucken war zu sehen.

     Deshalb: solange Textänderungen hereinkommen, gilt die Stelle VON
     DORT. Hört das Tippen auf, läuft der Vorrang nach kurzer Zeit ab und
     die Anwesenheit übernimmt wieder – bis dahin sind beide Fassungen
     ohnehin gleich.
     ─────────────────────────────────────────────────────────────────── */

  // Etwas länger als der Takt der Textänderungen (TEXT_FLUSH_MS)
  const OP_CARET_TTL_MS = 900;

  const opCarets = new Map();   // uid -> { pageId, offset, lockFrom, lockTo, at }

  /**
   * Übernimmt die Stelle, die an einer Textänderung mitgereist ist.
   *
   * Der Zeitstempel wird dabei auf die EIGENE Uhr gesetzt – hier ist sie
   * gerade eingetroffen, das ist genauer als die Uhr des Absenders und
   * macht den Nachlauf unabhängig von Uhrenunterschieden.
   */
  function noteCaretFromOp(op) {
    if (!op || !op.by || !Number.isFinite(op.c)) return;

    const eintrag = { pageId: op.p, offset: op.c, at: Date.now() };
    if (typeof op.cx === 'string') eintrag.cx = op.cx;
    if (Number.isFinite(op.lf) && Number.isFinite(op.lt)) {
      eintrag.lockFrom = op.lf;
      eintrag.lockTo = op.lt;
      eintrag.lockAt = eintrag.at;
    }
    opCarets.set(op.by, eintrag);

    renderCarets();
    renderLocks();
  }

  /**
   * Wer ist da – mit der Stelle, die gerade gilt.
   *
   * Alles, was Marken und Sperren zeichnet oder prüft, geht hierüber und
   * nicht mehr unmittelbar über `others`. Sonst gewinnt mal der eine, mal
   * der andere Weg, je nachdem, was zuletzt eintraf.
   */
  function peopleNow() {
    const jetzt = Date.now();
    return others.map(person => {
      const frisch = opCarets.get(person.uid);
      if (!frisch || jetzt - frisch.at > OP_CARET_TTL_MS) return person;

      /* Stelle, Anker und Sperre gehören ZUSAMMEN – sie sind an ein und
         demselben Text gemessen. Vorher wurde nur überschrieben, was in
         der Textänderung stand: kam sie ohne Sperre (der andere hatte
         gerade gescrollt, dann findet visualLineSpan die Zeile nicht),
         blieb die Sperre aus der Anwesenheit stehen und wurde in
         peopleOnPage um den Versatz der NEUEN Stelle verschoben. Das
         Band landete dadurch auf einer Zeile, an der nie jemand saß.
         Deshalb hier alles aus einer Quelle – lieber kurz keine Sperre
         als eine falsche. */
      return {
        ...person,
        pageId: frisch.pageId,
        offset: frisch.offset,
        cx: typeof frisch.cx === 'string' ? frisch.cx : '',
        lockFrom: Number.isFinite(frisch.lockFrom) ? frisch.lockFrom : -1,
        lockTo: Number.isFinite(frisch.lockTo) ? frisch.lockTo : -1,
        lockAt: Number.isFinite(frisch.lockAt) ? frisch.lockAt : 0
      };
    });
  }

  /** Welche Stelle gilt für diese Person? Für Tests und die Fehlersuche. */
  function caretOf(uid) {
    const person = peopleNow().find(p => p && p.uid === uid);
    if (!person) return null;

    // Über peopleOnPage, damit hier dasselbe herauskommt wie beim Zeichnen
    const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(person.pageId || '') + '"]');
    const textDiv = pgEl ? pgEl.querySelector('.j-text') : null;
    const gefunden = peopleOnPage(person.pageId, textDiv).find(p => p.uid === uid);
    return gefunden ? gefunden.offset : person.offset;
  }

  /* ══════════════════════════════════════════════════════════════════
     GLEICHZEITIG AUF DERSELBEN SEITE TIPPEN

     Eine Stelle ist eine Zahl, und Zahlen verrutschen. Schreibt jemand
     zehn Zeichen weiter vorn, steht alles dahinter zehn Stellen später –
     die fremde Marke säße bis zur nächsten Meldung daneben. Beim Tippen
     zu zweit auf derselben Seite passiert das ununterbrochen.

     >>> Warum nicht Y.RelativePosition <<<
     Yjs hätte dafür genau das richtige Werkzeug. Es zählt aber im
     Yjs-Text, und der hält hier den HTML-Text; gemeldet wird dagegen die
     Stelle im SICHTBAREN Text. Beides ineinander umzurechnen ginge nur
     über ein Zerlegen des HTML an beliebiger Stelle – brüchig, und bei
     jeder Auszeichnung anders.

     Stattdessen reist ein kurzes Stück Text mit: zwölf Zeichen davor und
     zwölf danach. Passt es an der gemeldeten Stelle, ist alles gut.
     Passt es nicht, wird die nächstgelegene Stelle gesucht, an der es
     passt – und die Marke sitzt wieder richtig. Das heilt nicht nur das
     gleichzeitige Tippen, sondern jede Art von Verschiebung, auch die
     durch die eigenen Änderungen HIER.
     ══════════════════════════════════════════════════════════════════ */

  // So viele Zeichen je Seite reisen als Anker mit
  const CTX = 12;

  /** Der Anker um eine Stelle herum. */
  function ankerAt(text, pos) {
    return text.slice(Math.max(0, pos - CTX), pos + CTX);
  }

  /**
   * Findet die Stelle wieder, an der der Anker steht.
   *
   * @param {string} text  der hiesige Text
   * @param {number} pos   die gemeldete Stelle
   * @param {string} anker die Zeichen um sie herum, beim Absender genommen
   * @returns {number} die Stelle, die hier gemeint ist
   */
  function findeStelle(text, pos, anker) {
    if (typeof anker !== 'string' || !anker) return pos;

    /* Wie viele Zeichen des Ankers vor der Marke stehen. Das muss nicht
       mitgeschickt werden – es ergibt sich aus der Stelle selbst, weil
       der Absender genauso gerechnet hat. */
    const davor = Math.min(pos, CTX);
    const beginn = pos - davor;

    // Passt es dort, wo es soll? Der Normalfall, und er kostet fast nichts.
    if (text.slice(beginn, beginn + anker.length) === anker) return pos;

    // Sonst die nächstgelegene Fundstelle nehmen
    let beste = -1;
    let abstand = Infinity;
    for (let i = text.indexOf(anker); i !== -1; i = text.indexOf(anker, i + 1)) {
      const kandidat = i + davor;
      const d = Math.abs(kandidat - pos);
      if (d < abstand) { abstand = d; beste = kandidat; }
    }
    return beste === -1 ? pos : beste;
  }

  /**
   * Die Leute auf einer Seite – mit Stellen, die auf den HIESIGEN Text
   * umgerechnet sind. Eine Verschiebung der Marke verschiebt die Sperre
   * um denselben Betrag mit.
   */
  function peopleOnPage(pageId, textDiv) {
    const inhalt = (textDiv && typeof flatTextOf === 'function')
      ? flatTextOf(textDiv) : null;

    return peopleNow().filter(p => p.pageId === pageId).map(person => {
      if (inhalt === null || !Number.isFinite(person.offset) || person.offset < 0) return person;

      const stelle = findeStelle(inhalt, person.offset, person.cx);
      const versatz = stelle - person.offset;
      if (!versatz) return person;

      const out = { ...person, offset: stelle };
      if (Number.isFinite(person.lockFrom) && person.lockFrom >= 0) {
        out.lockFrom = person.lockFrom + versatz;
        out.lockTo = person.lockTo + versatz;
      }
      return out;
    });
  }

  /**
   * Die SICHTBARE Zeile an dieser Stelle, und die darunter.
   *
   * >>> Warum nicht die logische Zeile <<<
   * Dieser Editor setzt beim Klicken keine Zeilenumbrüche, sondern füllt
   * mit Leerzeichen auf (placeCaretAnywhere in canvas/text.js). Eine Seite
   * besteht dadurch oft aus einer EINZIGEN sehr langen Zeile, die bloß
   * umbricht. „Die logische Zeile" hieß damit in der Praxis „von hier bis
   * zum Ende der Seite" – das Band begann weit über der Marke und deckte
   * fast alles zu.
   *
   * Verlässlich ist stattdessen, wo der Text tatsächlich umbricht. Das
   * sagt der Browser, wenn man ihn an den Rändern der Zeile fragt: links
   * für den Anfang, rechts eine Zeilenhöhe tiefer für das Ende der
   * nächsten. Übertragen werden weiterhin Zeichenpositionen – nur die
   * kommen bei allen an derselben Stelle an.
   */
  function visualLineSpan(textDiv, offset) {
    const text = flatTextOf(textDiv);
    // Nie über den Absatz hinaus: ein Umbruch beendet die Sperre ohnehin
    const grenze = flatLineSpan(text, offset, 1);

    const caret = caretRectAt(textDiv, offset, text);
    if (!caret) return null;

    const box = textDiv.getBoundingClientRect();
    const zoom = (typeof getZoom === 'function') ? getZoom() : 1;
    const lh = (parseInt(textDiv.style.lineHeight) || 32) * zoom;
    const mitte = caret.top + caret.height / 2;

    const stelleBei = (x, y) => {
      let punkt = null;
      if (typeof document.caretRangeFromPoint === 'function') {
        punkt = document.caretRangeFromPoint(x, y);
      } else if (typeof document.caretPositionFromPoint === 'function') {
        const p = document.caretPositionFromPoint(x, y);
        if (p && p.offsetNode) {
          punkt = document.createRange();
          punkt.setStart(p.offsetNode, p.offset);
        }
      }
      if (!punkt || !textDiv.contains(punkt.startContainer)) return null;
      return flatPosOfPoint(textDiv, punkt.startContainer, punkt.startOffset);
    };

    const von = stelleBei(box.left + 1, mitte);
    // Ende der NÄCHSTEN sichtbaren Zeile; gibt es keine, das der eigenen
    let bis = stelleBei(box.right - 1, mitte + lh);
    if (bis === null) bis = stelleBei(box.right - 1, mitte);

    /* >>> Warum hier NICHT auf die logische Zeile zurückgefallen wird <<<
       Die Trefferprüfung scheitert, wenn die Zeile gerade nicht im Bild
       ist – der andere hat gescrollt, eine Seite kam dazu. Vorher galt
       dann die logische Zeile, und die reicht in diesem Editor oft über
       die halbe Seite: das Band sprang bei jedem Scrollen auf und zu.
       Keine Sperre ist in dem Fall ehrlicher als eine falsche. */
    if (von === null || bis === null || bis < von) return null;

    return {
      from: Math.max(von, grenze.from),
      to: Math.min(Math.max(bis, offset), grenze.to)
    };
  }

  /* ── Eingehende Änderungen ────────────────────────────────────────── */

  function handleOp(op) {
    if (!op || !op.p) return;

    if (op.k === 'y') {
      applyRemoteText(op.p, op.u);
      // Die Stelle, die mitgereist ist – jetzt passt sie zum neuen Text
      return noteCaretFromOp(op);
    }
    if (op.k === 'ink') return applyRemoteStroke(op.p, op.s);

    /* Alles Übrige beschreibt den Aufbau des Hefts. Vor dem Anwenden muss
       das Eigene raus, sonst hält der Vergleich gleich darauf die fremde
       Änderung für etwas, das hier fehlt, und macht sie rückgängig. */
    if (STRUCTURAL.has(op.k)) {
      syncStructure();
      applyStructural(op);
      takeSnapshot();

      /* Auch der Merkzettel fürs Sichern muss davon wissen. Sonst hielte
         er das Empfangene für etwas Eigenes und Neues – und schriebe es
         nach Firestore zurück. Bei der Handschrift wäre das nicht nur
         überflüssig, sondern schädlich: eine „neue" Seite lässt ihre
         Bögen neu schreiben, und Striche, die der andere seither
         hinzugefügt hat, wären damit gelöscht. */
      if (typeof window.noteRemoteApplied === 'function') {
        window.noteRemoteApplied(op.k === 'st' ? null : op.p);
      }
    }
  }

  function applyRemoteText(pageId, base64) {
    if (!yAvailable() || !base64) return;

    const info = getPage(pageId);
    if (!info) return;                        // Seite gehört zu einem anderen Abschnitt

    /* Seite noch ohne gemeinsamen Text? Dann jetzt anlegen.
       Kommt in zwei Fällen vor: die Seite wurde erst während der Sitzung
       angelegt, oder das Dokument war zwischenzeitlich nicht geöffnet.
       Früher wurde hier abgebrochen – wer nur lesen durfte, bekam
       dadurch NIE eine Änderung zu sehen. */
    const entry = docs.get(pageId) || docFor(pageId, info.page.textContent || '', null);

    // ERST das eigene Getippte eintragen, DANN das Fremde anwenden.
    // Andersherum würde der Vergleich die fremde Änderung wieder löschen.
    flushPending(pageId);

    entry.applying = true;
    try {
      window.Y.applyUpdate(entry.ydoc, fromBase64(base64), 'remote');
    } finally {
      entry.applying = false;
    }

    const nextText = entry.ytext.toString();
    if (info.page.textContent === nextText) return;
    info.page.textContent = nextText;

    const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
    const textDiv = pgEl ? pgEl.querySelector('.j-text') : null;
    if (!textDiv) return;

    /* Schreibmarke retten. Sie steht im DOM, der Text kommt als HTML –
       deshalb wird die Position als Stelle im flachen Text gemerkt und
       danach wieder gesetzt. Ohne das springt die Marke bei jedem fremden
       Tastendruck an den Anfang.

       Über das flache Maß und nicht über getCaretTextOffset: dort sind
       Zeilenanfang und Ende der Zeile davor dieselbe Zahl, die eigene
       Marke rutschte dadurch bei jeder fremden Änderung eine Zeile hoch. */
    const hadFocus = document.activeElement === textDiv;
    const caret = hadFocus && typeof flatCaretPos === 'function'
      ? flatCaretPos(textDiv) : null;

    /* Der Text VOR der fremden Änderung. Nur damit lässt sich hinterher
       ausrechnen, wohin die eigene Marke gewandert ist – siehe shiftedPos. */
    const vorher = (caret !== null && typeof flatTextOf === 'function')
      ? flatTextOf(textDiv) : null;

    entry.applying = true;
    textDiv.innerHTML = nextText;
    entry.applying = false;

    if (hadFocus && caret !== null && typeof setFlatCaret === 'function') {
      let ziel = caret;
      const nachher = flatTextOf(textDiv);
      if (vorher !== null) {
        try { ziel = shiftedPos(vorher, nachher, caret); } catch (e) { ziel = caret; }
      }
      try { setFlatCaret(textDiv, ziel); } catch (e) { /* Text war zu stark umgebaut */ }
      merkeCaretLauf(vorher, nachher, caret, ziel, textDiv);
    }
    if (typeof renderSideTree === 'function') renderSideTree();

    // Der Text hat sich verschoben – Marken und Bänder sitzen sonst falsch
    renderCarets();
    renderLocks();
  }

  /**
   * Merkzettel der Striche, die auf einer Seite schon liegen. Gebraucht,
   * weil beim Betreten der letzte Teil des Änderungsstroms nachgeholt wird
   * (OP_BACKLOG in core/share.js) – darin stehen auch Striche, die längst
   * in Firestore gesichert und damit beim Laden schon angekommen sind.
   */
  function inkSignatures(pageId) {
    let set = inkSeen.get(pageId);
    if (!set) {
      set = new Set((S.strokeHistory[pageId] || []).map(s => JSON.stringify(s)));
      inkSeen.set(pageId, set);
    }
    return set;
  }

  function applyRemoteStroke(pageId, stroke) {
    if (!stroke) return;
    const info = getPage(pageId);
    if (!info) return;

    /* Die Strichliste im Zustand gibt es nur für Seiten, die auch aufgebaut
       wurden (app.js). Eine Seite aus einem anderen Abschnitt hat keine –
       dann MUSS die Liste aus der Seite selbst kommen. Vorher wurde hier
       mit einer LEEREN Liste angefangen und danach page.inkStrokes daraus
       ersetzt: die gesamte bisherige Handschrift dieser Seite war weg, und
       die nächste Sicherung hat sie auch in Firestore gelöscht. */
    if (!S.strokeHistory[pageId]) {
      S.strokeHistory[pageId] = JSON.parse(JSON.stringify(info.page.inkStrokes || []));
    }

    // Schon da? Dann nicht ein zweites Mal auf die Seite legen.
    const seen = inkSignatures(pageId);
    const key = JSON.stringify(stroke);
    if (seen.has(key)) return;
    seen.add(key);

    S.strokeHistory[pageId].push(stroke);
    info.page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[pageId]));

    /* Dass der Strich beim nächsten Sichern mit hochgeht, ist in Ordnung:
       Firestore hängt ihn per arrayUnion an, und arrayUnion nimmt nur auf,
       was noch nicht drinsteht. Hat ihn der Urheber schon gesichert, ist
       das Anhängen wirkungslos – und hat er es nicht mehr geschafft, ist
       der Strich hierüber trotzdem gerettet. */

    const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
    const canvas = pgEl ? pgEl.querySelector('.j-canvas:not(.live-canvas)') : null;
    if (canvas && typeof redrawStrokes === 'function') {
      redrawStrokes(canvas, S.strokeHistory[pageId]);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     ALLES ÜBRIGE: AUFBAU DES HEFTS

     Text geht über Yjs, ein fertiger Strich geht sofort raus. Alles
     andere – Seiten anlegen und löschen, Reihenfolge, Abschnitte,
     Hintergrund, Bilder, Radieren, Rückgängig – wird hier erfasst.

     >>> Warum ein Vergleich und keine Haken an den Änderungsstellen <<<
     Diese Änderungen entstehen an über zwanzig Stellen im Programm
     (app.js, sidebar.js, objects.js, importExport.js, shortcuts.js …),
     und an manchen gar nicht ausdrücklich: ein Bild wird verschoben,
     indem obj.x direkt gesetzt wird. Jede Stelle einzeln zu benachrichtigen
     hieße, jede künftige Stelle wieder zu vergessen. Stattdessen wird das
     Heft in kurzen Abständen mit dem zuletzt gesendeten Stand verglichen –
     was sich unterscheidet, geht raus. Eine vergessene Stelle gibt es
     dadurch nicht mehr.

     Der Vergleich muss billig sein, weil er oft läuft: je Seite drei
     kurze Zeichenketten, und die Handschrift wird nur abgetastet statt
     ganz gelesen.
     ══════════════════════════════════════════════════════════════════ */

  // Wie oft höchstens verglichen wird.
  const STRUCT_SYNC_MS = 250;

  /* So groß darf eine einzelne Meldung werden. Die Regel der Realtime
     Database lässt 200.000 Zeichen zu; darunter bleiben, weil noch
     Feldnamen dazukommen. Was nicht hineinpasst (Bilder, sehr viel
     Handschrift), geht über Firestore – siehe sendLive(). */
  const LIVE_OP_LIMIT = 150000;

  const STRUCTURAL = new Set(['st', 'pg+', 'pg-', 'pgm', 'obj', 'inks', 'get']);

  let liveNb = null;        // das Heft dieser Sitzung
  let snapshot = null;      // der Stand, der zuletzt hinausgegangen ist
  let structTimer = null;
  let rerenderTimer = null;
  let syncing = false;      // Sperre gegen den Vergleich im Vergleich

  /** Kurze Unterschrift über die Handschrift einer Seite – ohne sie ganz zu lesen. */
  function inkSig(strokes) {
    const list = strokes || [];
    const n = list.length;
    if (!n) return '0';
    const mark = (s) => {
      if (!s || !Array.isArray(s.path) || !s.path.length) return '-';
      const a = s.path[0], b = s.path[s.path.length - 1];
      return s.path.length + ',' + Math.round(a.x) + ',' + Math.round(a.y)
        + ',' + Math.round(b.x) + ',' + Math.round(b.y);
    };
    // Anfang, Mitte, Ende: ändert sich etwas dazwischen, ändert sich fast
    // immer auch die Anzahl – und die steht vorn.
    return n + '|' + mark(list[0]) + '|' + mark(list[n >> 1]) + '|' + mark(list[n - 1]);
  }

  /** Objekte ohne die Bilddaten – die gehören nicht in den Live-Kanal. */
  function lightObjects(objects) {
    let partial = false;
    const out = (objects || []).map(obj => {
      const copy = { ...obj };
      if (typeof copy.src === 'string' && copy.src.startsWith('data:')) {
        copy.src = '';
        copy.imgPending = 1;
        partial = true;
      }
      return copy;
    });
    return { objects: out, partial };
  }

  function objSig(objects) {
    return JSON.stringify(lightObjects(objects).objects);
  }

  /**
   * Unterschrift NUR über die Bilddaten einer Seite.
   *
   * >>> Warum das eine eigene Unterschrift braucht <<<
   * Bilddaten passen nicht durch den Live-Kanal, sie müssen über Firestore
   * gehen. Bisher wurde dieser Umweg immer dann angestoßen, wenn auf der
   * Seite überhaupt ein Bild lag – also auch, wenn eines bloß VERSCHOBEN
   * wurde. Die Gegenseite hat die Seite dann aus Firestore nachgeladen,
   * wo der alte Stand stand, und damit die gerade richtig angekommene
   * neue Position wieder überschrieben: das Bild sprang zurück.
   *
   * Deshalb wird hier getrennt, was sich unterscheiden muss – die reinen
   * Bilddaten. Nur wenn DIE sich ändern, muss Firestore ran.
   */
  function imageSig(page) {
    const parts = [(page.bgImg || '').length];
    for (const obj of (page.objects || [])) {
      if (typeof obj.src === 'string' && obj.src.startsWith('data:')) {
        parts.push(String(obj.id) + ':' + obj.src.length);
      }
    }
    return parts.join('|');
  }

  /**
   * Seitenangaben in vergleichbarer Form.
   *
   * Das Seitenbild (bgImg) steht als Länge mit darin. Ohne das fiel eine
   * PDF-Seite ganz durch den Vergleich: die Seite kam beim anderen an,
   * ihr Inhalt nie.
   */
  function pageMeta(page) {
    return JSON.stringify([
      page.bg ?? null, page.w ?? null, page.h ?? null, page.date || '',
      (page.bgImg || '').length
    ]);
  }

  /**
   * Der Aufbau des Hefts in vergleichbarer Form.
   *
   * activeSecId steht bewusst NICHT darin: welcher Abschnitt gerade offen
   * ist, ist Sache jedes Einzelnen. Sonst würde man beim Blättern des
   * anderen mitgerissen.
   */
  function snapshotOf(nb) {
    const pages = {};
    for (const page of (nb.pages || [])) {
      pages[String(page.id)] = {
        meta: pageMeta(page),
        objs: objSig(page.objects),
        img: imageSig(page),
        ink: inkSig(page.inkStrokes)
      };
    }
    return {
      pages,
      order: (nb.pages || []).map(p => String(p.id)).join(','),
      struct: JSON.stringify({
        sections: nb.sections || [],
        name: nb.name || '',
        color: nb.color || '',
        defaultBg: nb.defaultBg || ''
      })
    };
  }

  function takeSnapshot() {
    if (liveNb) snapshot = snapshotOf(liveNb);
  }

  /**
   * Schickt eine Meldung – oder, wenn sie zu groß ist, den Hinweis
   * „hol dir diese Seite neu". Das betrifft Bilder und Seiten mit sehr
   * viel Handschrift. Gesichert wird dann zuerst nach Firestore, damit
   * die Gegenseite dort auch wirklich den neuen Stand vorfindet.
   */
  function sendLive(kind, pageId, payload) {
    if (!room) return;
    const text = JSON.stringify(payload || {});

    if (text.length <= LIVE_OP_LIMIT) {
      room.sendOp({ k: kind, p: pageId, u: text });
      return;
    }
    sendViaFirestore(pageId);
  }

  /* Seiten, für die noch ein „hol dich neu" ansteht. Ein PDF mit zwanzig
     Seiten stößt zwanzig Aufrufe im selben Zug an – ohne Sammelstelle
     liefe jeder einzeln los. */
  const fetchPending = new Set();
  let fetchTimer = null;

  /**
   * Sagt der Gegenseite: „diese Seite bitte aus Firestore nachladen".
   *
   * >>> Warum das nicht mehr sofort losgeschickt wird <<<
   * Der Hinweis ist nur brauchbar, wenn in Firestore auch wirklich schon
   * der neue Stand steht. Vorher lief das so: flushSharedDocSave() rufen
   * und gleich danach senden. Nur stieg das Speichern sofort wieder aus,
   * wenn gerade nichts als geändert galt (`!dirty`) oder schon ein
   * Speichervorgang lief (`saving`) – der Hinweis ging also raus, BEVOR
   * geschrieben wurde. Die Gegenseite fand dann nichts (bei neuen Seiten)
   * oder den alten Stand (bei verschobenen Bildern). Genau daran lagen
   * die verschwundenen PDF-Inhalte und die zurückspringenden Bilder.
   *
   * Jetzt: sammeln, EINMAL wirklich schreiben lassen, und erst wenn das
   * durch ist, alle gesammelten Seiten anfordern.
   */
  function sendViaFirestore(pageId) {
    if (!room) return;
    fetchPending.add(String(pageId));
    if (fetchTimer) return;

    fetchTimer = setTimeout(() => {
      fetchTimer = null;
      const wanted = Array.from(fetchPending);
      fetchPending.clear();
      if (!wanted.length || !room) return;

      const save = (typeof window.forceSharedDocSave === 'function')
        ? window.forceSharedDocSave()
        : (typeof window.flushSharedDocSave === 'function'
            ? window.flushSharedDocSave()
            : Promise.resolve());

      Promise.resolve(save).catch(() => {}).then(() => {
        if (!room) return;
        for (const id of wanted) room.sendOp({ k: 'get', p: id, u: '{}' });
      });
    }, 60);
  }

  /** Vergleicht das Heft mit dem zuletzt gesendeten Stand und schickt die Unterschiede. */
  function syncStructure() {
    clearTimeout(structTimer);
    structTimer = null;

    if (!room || !canWrite || !liveNb || !snapshot) return;

    /* Nicht zweimal gleichzeitig. Der Aufruf steckt auch im Empfangen von
       Änderungen, und Senden kann – je nachdem, wie die Verbindung
       zustellt – noch im selben Zug wieder etwas hereinbringen. Ohne
       diese Sperre liefe der Vergleich mitten in sich selbst und schriebe
       den Vergleichsstand halb fertig zurück. */
    if (syncing) return;
    syncing = true;
    try { doSyncStructure(); } finally { syncing = false; }
  }

  function doSyncStructure() {
    const now = snapshotOf(liveNb);
    const byId = new Map((liveNb.pages || []).map(p => [String(p.id), p]));

    // 1. Neue Seiten zuerst – sonst zeigen Abschnitte auf Seiten, die es
    //    beim anderen noch gar nicht gibt.
    for (const pageId of Object.keys(now.pages)) {
      if (snapshot.pages[pageId]) continue;
      const page = byId.get(pageId);
      if (!page) continue;
      const { objects, partial } = lightObjects(page.objects);

      /* Bilddaten passen nicht in den Kanal. Der Empfänger muss aber
         WISSEN, dass da noch etwas kommt – sonst zeigt er stumm eine
         leere Seite und wartet auf einen Hinweis, der unterwegs verloren
         gehen kann. Genau das war bei PDF-Seiten der Fall: die Seiten
         kamen an, der Inhalt nie. Mit needsFetch holt er sich die Seite
         selbst, ohne auf den Absender angewiesen zu sein. */
      const needsFetch = !!page.bgImg || partial;
      const base = {
        id: pageId,
        date: page.date || '',
        bg: page.bg ?? null,
        w: page.w ?? null,
        h: page.h ?? null,
        textContent: page.textContent || '',
        hasBg: !!page.bgImg,
        needsFetch,
        objects
      };
      const index = (liveNb.pages || []).findIndex(p => String(p.id) === pageId);

      /* Eine schon vollgeschriebene Seite (kopiert, eingefügt, aus einem
         PDF entstanden) sprengt den Live-Kanal. Dann geht sie OHNE
         Handschrift hinüber – die Seite ist damit sofort da, und der
         Inhalt kommt gleich darauf über Firestore nach. Sie ganz
         wegzulassen wäre falsch: der andere hätte dann eine Seite, von
         der er nie erfährt. */
      const full = { page: { ...base, inkStrokes: page.inkStrokes || [] }, index };
      const tooBig = JSON.stringify(full).length > LIVE_OP_LIMIT;

      sendLive('pg+', pageId, tooBig
        ? { page: { ...base, needsFetch: true, inkStrokes: [] }, index }
        : full);
      if (tooBig || needsFetch) sendViaFirestore(pageId);
    }

    // 2. Geänderte Seiten
    for (const [pageId, sig] of Object.entries(now.pages)) {
      const before = snapshot.pages[pageId];
      if (!before) continue;                       // eben erst angelegt

      const page = byId.get(pageId);
      if (!page) continue;

      if (before.meta !== sig.meta) {
        sendLive('pgm', pageId, {
          bg: page.bg ?? null, w: page.w ?? null, h: page.h ?? null,
          date: page.date || '', hasBg: !!page.bgImg
        });
      }

      if (before.objs !== sig.objs) {
        const { objects } = lightObjects(page.objects);
        sendLive('obj', pageId, { objects });
      }

      /* Der Umweg über Firestore NUR, wenn sich die Bilddaten selbst
         geändert haben – ein neues Bild, ein ausgetauschtes, ein neues
         Seitenbild aus einem PDF. Beim bloßen Verschieben oder Skalieren
         bleibt er aus: dort reicht die obj-Meldung, und ein Nachladen
         würde die frisch angekommene Position wieder überschreiben. */
      if (before.img !== sig.img) sendViaFirestore(pageId);

      /* Handschrift: das Anhängen läuft schon über noteStroke, Strich für
         Strich. Hier bleibt der Fall übrig, in dem sich die Liste ANDERS
         verändert hat – radiert, rückgängig gemacht, eingefügt. Dann geht
         sie ganz hinüber, denn welcher Strich fehlt, lässt sich von außen
         nicht sagen. */
      if (before.ink !== sig.ink) {
        sendLive('inks', pageId, { strokes: page.inkStrokes || [] });
      }
    }

    // 3. Gelöschte Seiten
    for (const pageId of Object.keys(snapshot.pages)) {
      if (!now.pages[pageId]) sendLive('pg-', pageId, {});
    }

    // 4. Abschnitte, Reihenfolge, Heftangaben
    if (now.struct !== snapshot.struct || now.order !== snapshot.order) {
      sendLive('st', '*', {
        sections: liveNb.sections || [],
        order: (liveNb.pages || []).map(p => String(p.id)),
        name: liveNb.name || '',
        color: liveNb.color || '',
        defaultBg: liveNb.defaultBg || ''
      });
    }

    snapshot = now;
  }

  function scheduleStructSync() {
    if (!room || !canWrite || structTimer) return;
    structTimer = setTimeout(syncStructure, STRUCT_SYNC_MS);
  }

  /* ── Eingehende Aufbau-Änderungen ─────────────────────────────────── */

  function applyStructural(op) {
    if (!liveNb) return;

    let data = {};
    try { data = op.u ? JSON.parse(op.u) : {}; } catch (e) { return; }

    if (op.k === 'get')  return void reloadPage(op.p);
    if (op.k === 'pg+')  return applyPageAdd(op.p, data);
    if (op.k === 'pg-')  return applyPageRemove(op.p);
    if (op.k === 'pgm')  return applyPageMeta(op.p, data);
    if (op.k === 'obj')  return applyObjects(op.p, data);
    if (op.k === 'inks') return applyInkSet(op.p, data);
    if (op.k === 'st')   return applyStruct(data);
  }

  function applyPageAdd(pageId, data) {
    if ((liveNb.pages || []).some(p => String(p.id) === pageId)) return;
    const incoming = data.page || {};

    const page = {
      id: pageId,
      date: incoming.date || new Date().toISOString(),
      bg: incoming.bg ?? null,
      textContent: incoming.textContent || '',
      inkStrokes: Array.isArray(incoming.inkStrokes) ? incoming.inkStrokes : [],
      objects: Array.isArray(incoming.objects) ? incoming.objects : []
    };
    if (incoming.w) page.w = incoming.w;
    if (incoming.h) page.h = incoming.h;

    const at = Number.isInteger(data.index) ? data.index : (liveNb.pages || []).length;
    liveNb.pages.splice(Math.max(0, Math.min(at, liveNb.pages.length)), 0, page);

    // Der gemeinsame Text der neuen Seite, sonst käme dort nichts an
    if (yAvailable()) docFor(pageId, page.textContent, null);

    /* Bilder passen nicht durch den Kanal. Statt darauf zu warten, dass
       der Absender den Hinweis schickt, wird hier selbst nachgeholt –
       sein Hinweis kann verloren gehen oder zu früh kommen. Genau daran
       scheiterten PDF-Seiten: die Seite war da, ihr Inhalt nie. */
    if (incoming.needsFetch || incoming.hasBg) reloadPage(pageId, true);

    scheduleRerender();
  }

  function applyPageRemove(pageId) {
    const before = (liveNb.pages || []).length;
    liveNb.pages = (liveNb.pages || []).filter(p => String(p.id) !== pageId);
    for (const sec of (liveNb.sections || [])) {
      sec.pgIds = (sec.pgIds || []).filter(id => String(id) !== pageId);
    }
    if (liveNb.pages.length === before) return;

    delete S.strokeHistory[pageId];
    inkSeen.delete(pageId);
    const entry = docs.get(pageId);
    if (entry) { try { entry.ydoc.destroy(); } catch (e) {} docs.delete(pageId); }

    scheduleRerender();
  }

  function applyPageMeta(pageId, data) {
    const info = getPage(pageId);
    if (!info) return;
    info.page.bg = data.bg ?? null;
    if (data.w) info.page.w = data.w; else delete info.page.w;
    if (data.h) info.page.h = data.h; else delete info.page.h;
    if (data.date) info.page.date = data.date;

    /* Das Seitenbild selbst kommt nicht mit – dafür die Auskunft, ob es
       eines gibt. Ist es weg, hier auch löschen; ist es neu, nachholen. */
    if (data.hasBg === false) delete info.page.bgImg;
    else if (data.hasBg && !info.page.bgImg) reloadPage(pageId, true);

    scheduleRerender();
  }

  /**
   * Objekte einer Seite ersetzen. Bilddaten kommen NICHT über den
   * Live-Kanal – sie stehen als imgPending drin. Ist das Bild hier schon
   * bekannt (es wurde nur verschoben), bleibt es einfach stehen; sonst
   * folgt gleich ein Hinweis, die Seite aus Firestore nachzuladen.
   */
  function applyObjects(pageId, data) {
    const info = getPage(pageId);
    if (!info) return;

    const known = new Map((info.page.objects || []).map(o => [String(o.id), o]));
    let missing = false;

    info.page.objects = (data.objects || []).map(obj => {
      const copy = { ...obj };
      if (copy.imgPending) {
        delete copy.imgPending;
        const previous = known.get(String(copy.id));
        copy.src = (previous && previous.src) ? previous.src : '';
        if (!copy.src) missing = true;
      }
      return copy;
    });

    /* Ein Bild, das hier noch niemand kennt. Selbst nachholen, statt auf
       den Hinweis des Absenders zu warten – ein Objekt ohne Bilddaten ist
       nicht nur unsichtbar, es würde beim nächsten Sichern auch mit
       leerem src nach Firestore geschrieben und wäre damit für alle weg. */
    if (missing) reloadPage(pageId, true);

    redrawObjects(pageId);
  }

  function applyInkSet(pageId, data) {
    const info = getPage(pageId);
    if (!info) return;

    const strokes = Array.isArray(data.strokes) ? data.strokes : [];
    info.page.inkStrokes = JSON.parse(JSON.stringify(strokes));
    S.strokeHistory[pageId] = JSON.parse(JSON.stringify(strokes));
    inkSeen.set(pageId, new Set(strokes.map(s => JSON.stringify(s))));

    const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
    const canvas = pgEl ? pgEl.querySelector('.j-canvas:not(.live-canvas)') : null;
    if (canvas && typeof redrawStrokes === 'function') {
      redrawStrokes(canvas, S.strokeHistory[pageId]);
    }
  }

  function applyStruct(data) {
    if (Array.isArray(data.sections)) {
      liveNb.sections = data.sections.map(sec => ({
        id: String(sec.id),
        name: String(sec.name || ''),
        pgIds: (sec.pgIds || []).map(String),
        defaultBg: sec.defaultBg || liveNb.defaultBg || 'ruled'
      }));
    }
    if (typeof data.name === 'string' && data.name) liveNb.name = data.name;
    if (typeof data.color === 'string' && data.color) liveNb.color = data.color;
    if (typeof data.defaultBg === 'string' && data.defaultBg) liveNb.defaultBg = data.defaultBg;

    // Reihenfolge der Seiten übernehmen, Unbekanntes hinten anhängen
    if (Array.isArray(data.order) && data.order.length) {
      const byId = new Map((liveNb.pages || []).map(p => [String(p.id), p]));
      const sorted = [];
      for (const id of data.order) {
        const page = byId.get(String(id));
        if (page) { sorted.push(page); byId.delete(String(id)); }
      }
      for (const rest of byId.values()) sorted.push(rest);
      liveNb.pages = sorted;
    }

    /* Der eigene Abschnitt bleibt der eigene – es sei denn, es gibt ihn
       nicht mehr. Sonst würde man beim Blättern des anderen mitgerissen. */
    if (!(liveNb.sections || []).some(s => s.id === liveNb.activeSecId)) {
      liveNb.activeSecId = (liveNb.sections || [])[0]?.id || '';
    }

    scheduleRerender();
  }

  /* Abstände für die Wiederholungen. Sie gelten nur dort, wo wir dem
     Schreiber voraus sein KÖNNEN – wenn der Empfänger sich eine Seite von
     sich aus holt, weil ihre Ankündigung Bilddaten versprochen hat
     (applyPageAdd). Auf einen 'get'-Hinweis hin wird nicht wiederholt:
     der Absender hat vor dem Senden nachweislich geschrieben. */
  const RELOAD_TRIES = [1200, 3000, 6000];

  const reloading = new Map();   // pageId -> Versuch

  /**
   * Eine Seite aus Firestore nachholen – für Bilder und sehr viel
   * Handschrift.
   *
   * @param {string} pageId
   * @param {boolean} [retry] noch einmal versuchen, wenn nichts da war.
   *   Für selbst angestoßene Abrufe: die Seite kann bei uns angekommen
   *   sein, bevor der Absender sie überhaupt geschrieben hat. Ohne
   *   Wiederholung bliebe sie dann für immer leer – genau das war bei
   *   PDF-Seiten der Fall.
   */
  function reloadPage(pageId, retry = false, attempt = 0) {
    if (typeof window.reloadLivePage !== 'function') return;
    const key = String(pageId);

    // Läuft schon ein Versuch für diese Seite? Dann nicht noch einer.
    if (attempt === 0 && reloading.has(key)) return;
    reloading.set(key, attempt);

    Promise.resolve(window.reloadLivePage(key))
      .then((changed) => {
        if (changed) {
          reloading.delete(key);
          takeSnapshot();
          if (typeof window.noteRemoteApplied === 'function') window.noteRemoteApplied(key);
          scheduleRerender();
          return;
        }

        // Nichts gefunden: der Absender war noch nicht fertig mit Schreiben
        if (!retry || attempt >= RELOAD_TRIES.length || !room) { reloading.delete(key); return; }
        setTimeout(() => {
          if (room && reloading.get(key) === attempt) reloadPage(key, true, attempt + 1);
        }, RELOAD_TRIES[attempt]);
      })
      .catch(err => {
        reloading.delete(key);
        console.warn('[Collab] Seite nicht nachgeholt:', err?.message || err);
      });
  }

  /* ── Neu zeichnen ─────────────────────────────────────────────────── */

  function redrawObjects(pageId) {
    const info = getPage(pageId);
    const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
    const layer = pgEl ? pgEl.querySelector('.j-objects') : null;
    if (!info || !layer || typeof placeObject !== 'function') return;

    layer.innerHTML = '';
    for (const obj of (info.page.objects || [])) placeObject(layer, obj, info.page);
  }

  function scheduleRerender() {
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(rerenderPages, 60);
  }

  /**
   * Baut den offenen Abschnitt neu auf. Bildlauf, Fokus und Schreibmarke
   * werden gerettet – sonst springt einem die Ansicht weg, sobald der
   * andere irgendwo eine Seite anlegt.
   */
  function rerenderPages() {
    clearTimeout(rerenderTimer);
    rerenderTimer = null;
    if (!liveNb || typeof openSection !== 'function') return;
    if (typeof S !== 'undefined' && S.activeNbId !== liveNb.id) return;

    const sections = liveNb.sections || [];
    const sec = sections.find(s => s.id === liveNb.activeSecId) || sections[0];
    if (!sec) return;

    const scroller = E('pg-scroll');
    const top = scroller ? scroller.scrollTop : 0;

    const focused = document.activeElement;
    const isText = focused && focused.classList && focused.classList.contains('j-text');
    const focusPgId = isText ? focused.closest('[data-pgid]')?.dataset.pgid : null;

    /* Gemessen wird mit DEMSELBEN Maß, mit dem unten wieder gesetzt wird.
       Hier stand getCaretTextOffset, gesetzt wurde aber mit setFlatCaret –
       zwei verschiedene Zählweisen: getCaretTextOffset zählt nur die
       Zeichen in den Textknoten, das flache Maß zählt jede Zeilengrenze
       als eigenes \n mit.

       Die gemerkte Zahl war dadurch um die Anzahl der Zeilen ÜBER der
       Marke zu klein, und genau so weit sprang die eigene Schreibmarke
       beim Wiederherstellen nach oben. Ausgelöst wurde das von jeder
       Struktur-Änderung des anderen – und eine davon kommt beim bloßen
       Tippen ununterbrochen: läuft seine Seite über, legt die App die
       nächste an. Es sah deshalb so aus, als zöge es einen dorthin, wo
       der andere schreibt. */
    const caret = (isText && typeof flatCaretPos === 'function')
      ? flatCaretPos(focused) : null;

    openSection(sec);

    if (scroller) scroller.scrollTop = top;
    if (focusPgId) {
      const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(focusPgId) + '"]');
      const textDiv = pgEl ? pgEl.querySelector('.j-text') : null;
      if (textDiv) {
        textDiv.focus();
        if (caret !== null && typeof setFlatCaret === 'function') {
          try { setFlatCaret(textDiv, caret); } catch (e) { /* Seite hat sich zu stark geändert */ }
        }
      }
    }

    renderMarkers();
    renderCarets();
    renderLocks();
  }

  /* ── Betreten und Verlassen ───────────────────────────────────────── */

  /**
   * Wird von ui/sharedDocs.js aufgerufen, sobald ein geteiltes Dokument
   * offen ist.
   *
   * @param {string} id        Dokumentkennung
   * @param {object} notebook  das geladene Heft
   * @param {object} crdt      gespeicherte Yjs-Stände je Seite
   * @param {boolean} canEdit  darf diese Person schreiben?
   * @param {object} [opts]
   * @param {boolean}  [opts.isOwner]      ist DIESE Person der Besitzer?
   * @param {string}   [opts.ownerUid]     Kennung des Besitzers
   * @param {Function} [opts.onOwnerLost]  Rückruf, wenn der Besitzer abbricht
   */
  async function start(id, notebook, crdt, canEdit, opts = {}) {
    await stop();
    docId = id;
    liveNb = notebook;
    takeSnapshot();

    /* Für JEDE Seite den gemeinsamen Text herstellen – auch dann, wenn man
       nur lesen darf. Sonst kämen bei Lesern gar keine Änderungen an: der
       eingehende Yjs-Stand braucht ein Gegenstück, in das er hineinpasst. */
    canWrite = !!canEdit;
    if (yAvailable()) {
      for (const page of (notebook.pages || [])) {
        docFor(String(page.id), page.textContent || '', crdt ? crdt[String(page.id)] : null);
      }
    } else {
      console.warn('[Collab] Yjs nicht geladen – gemeinsames Tippen bleibt aus.');
    }

    try {
      room = await window.InkwellShare.joinDocRoom(id, {
        isOwner: !!opts.isOwner,
        ownerUid: opts.ownerUid || ''
      });
      lastError = '';
    } catch (err) {
      /* Bisher stand das nur in der Konsole – der Nutzer sah eine App, die
         aussah, als liefe alles, und wunderte sich, warum nichts ankommt.
         Jetzt sagt es der Streifen über dem Dokument. */
      lastError = err?.message || String(err);
      console.warn('[Collab] Kein Live-Betrieb:', lastError);
      console.warn('[Collab] Prüfe: Realtime Database in der Firebase Console angelegt? '
        + 'Regeln aus website/database.rules.json veröffentlicht? '
        + 'Adresse in RTDB_URL richtig?');
      room = null;
      showLiveState();
      return;
    }

    showLiveState();

    /* >>> Der Besitzer ist mitten in der Arbeit weggebrochen <<<
       Dann hat er die App offen, aber kein Netz – und schreibt womöglich
       örtlich weiter. Würde hier jemand gleichzeitig ändern, gäbe es beim
       Wiederverbinden zwei Fassungen derselben Seite. Solange die Marke
       steht, wird deshalb nur gelesen; kommt er zurück, ebenso von selbst
       wieder zurück. Erklärung des Zeichens in core/share.js.

       canEdit bleibt dabei unangetastet: es ist das dauerhafte Recht, das
       der Besitzer vergeben hat. Hier wird es nur vorübergehend nicht
       ausgeübt. */
    /* Mit ?. gefragt: eine ältere core/share.js kennt onOwnerLost noch
       nicht. Dann bleibt es beim bisherigen Verhalten – lieber ohne diese
       Sperre als gar kein Live-Betrieb. */
    room.onOwnerLost?.((lost) => {
      setCanWrite(!!canEdit && !lost);
      try { opts.onOwnerLost?.(!!lost); }
      catch (err) { console.warn('[Collab] Rückmeldung zum Abbruch:', err); }
    });

    room.onPresence((list) => {
      /* Der Zeitstempel kommt von der Uhr des Servers, verglichen wird mit
         der eigenen. Geht die eigene vor, wäre plötzlich niemand mehr da –
         deshalb zählt der jüngste gemeldete Zeitpunkt mit. */
      const newest = list.reduce(
        (max, p) => (typeof p.at === 'number' && p.at > max ? p.at : max), 0);
      const fresh = Math.max(Date.now(), newest) - PRESENCE_STALE_MS;
      others = list.filter(p => typeof p.at !== 'number' || p.at > fresh);

      /* Alles Zeichnen zusammen abgesichert. Reißt eine einzelne
         Darstellung, darf sie nicht den Rückruf der Anwesenheit mit
         herunterziehen – der käme dann nie wieder, und von da an wäre
         niemand mehr zu sehen. */
      try {
        renderPresenceBar();
        renderMarkers();
        renderCarets();
        renderLocks();
      } catch (err) {
        console.warn('[Collab] Anzeige der Mitarbeitenden:', err?.message || err);
      }
    });

    room.onOp(handleOp);

    // Jede Bewegung der eigenen Schreibmarke melden. selectionchange ist
    // das einzige Ereignis, das auch bei den Pfeiltasten und beim Klicken
    // kommt – 'input' allein würde die Hälfte verpassen.
    document.addEventListener('selectionchange', reportCaret);
    stops.push(() => document.removeEventListener('selectionchange', reportCaret));

    reportCaret();

    /* Marker und Schreibmarken hängen an Bildschirmpositionen: die
       verschieben sich beim Blättern, Zoomen und wenn jemand tippt.
       Deshalb regelmäßig neu setzen. Im selben Takt wird der Aufbau des
       Hefts verglichen – als Netz unter dem Anstoß aus markDirty, für
       Änderungen, die sich gar nicht melden (ein verschobenes Bild etwa
       setzt nur obj.x). */
    clearInterval(staleTimer);
    staleTimer = setInterval(() => {
      renderMarkers();
      renderCarets();
      syncStructure();
    }, 1500);

    /* Schreibmarken und Sperrbänder haben einen eigenen, schnelleren Takt.
       Sie hängen an Bildschirmpositionen und an einer Sperre, die abläuft –
       beides braucht ein kürzeres Auge als der Vergleich des Hefts, und
       den mitzubeschleunigen hieße nur, öfter alles durchzurechnen.

       Die eigene Meldung wird hier mit aufgefrischt: hört jemand auf zu
       tippen, kommt von selbst kein selectionchange mehr, und die Sperre
       verfiele erst über den Nachlauf statt sofort. */
    clearInterval(caretTimer);
    caretTimer = setInterval(() => {
      reportCaret();
      renderCarets();
      renderLocks();
    }, 600);

    const scroller = E('pg-scroll');
    if (scroller) {
      const onScroll = () => { renderCarets(); renderLocks(); };
      scroller.addEventListener('scroll', onScroll, { passive: true });
      stops.push(() => scroller.removeEventListener('scroll', onScroll));
    }
  }

  /**
   * Verlässt den Raum.
   *
   * @param {string} [expectedDocId] Nur verlassen, wenn genau dieses
   *   Dokument noch offen ist. Gebraucht beim Schließen: dort wird erst
   *   gesichert und erst danach verlassen – in der Zwischenzeit kann
   *   längst ein anderes Dokument offen sein, und das dürfte der Aufruf
   *   von vorhin nicht mit abräumen.
   */
  async function stop(expectedDocId) {
    if (expectedDocId && docId !== expectedDocId) return;

    // Was noch wartet, gehört noch hinaus – sonst fehlt es beim anderen
    // und in dem Stand, der gleich gesichert wird.
    try { flushAllPending(); } catch (e) {}
    try { syncStructure(); } catch (e) {}

    clearInterval(staleTimer);
    staleTimer = null;
    clearInterval(caretTimer);
    caretTimer = null;
    clearTimeout(structTimer);
    structTimer = null;
    clearTimeout(rerenderTimer);
    rerenderTimer = null;
    clearTimeout(fetchTimer);
    fetchTimer = null;
    fetchPending.clear();
    reloading.clear();
    typedAt.clear();
    liveNb = null;
    snapshot = null;

    for (const undo of stops) { try { undo(); } catch (e) {} }
    stops = [];

    if (room) { try { await room.leave(); } catch (e) {} }
    room = null;
    docId = null;
    others = [];

    for (const entry of docs.values()) { try { entry.ydoc.destroy(); } catch (e) {} }
    docs.clear();
    inkSeen.clear();
    opCarets.clear();

    document.querySelectorAll('.collab-marker, .collab-caret, .collab-lock').forEach(el => el.remove());
    const bar = E('collab-people');
    if (bar) { bar.innerHTML = ''; bar.style.display = 'none'; }
  }

  /* ── Meldungen aus dem Editor ─────────────────────────────────────── */

  /** Der Nutzer hat auf einer Seite getippt. */
  const flushTimers = new Map();
  const pendingText = new Map();

  function noteTextChange(pageId, html) {
    /* Bewusst NICHT von `room` abhängig: auch ohne Live-Verbindung soll
       der gemeinsame Text mitgeführt werden, sonst wäre beim Speichern
       kein Yjs-Stand da und der nächste Öffner müsste neu anfangen. */
    if (!yAvailable() || !docId) return;

    /* Seite erst während der Sitzung angelegt? Dann gibt es für sie noch
       keinen gemeinsamen Text. Früher wurde hier abgebrochen – getippt
       werden konnte, nur kam beim anderen nichts an und beim Sichern fehlte
       der Yjs-Stand, sodass die Seite beim nächsten Öffnen von vorn anfing. */
    const entry = docs.get(pageId) || docFor(pageId, '', null);
    if (entry.applying) return;

    // Ab jetzt gilt diese Zeile als in Arbeit – siehe lockSpanFor
    typedAt.set(pageId, Date.now());
    pendingText.set(pageId, html);

    clearTimeout(flushTimers.get(pageId));
    flushTimers.set(pageId, setTimeout(() => {
      flushPending(pageId);
      // Beim Tippen wandert auch die eigene Schreibmarke
      reportCaret();
    }, TEXT_FLUSH_MS));
  }

  /**
   * Trägt Getipptes, das noch wartet, sofort in den gemeinsamen Text ein.
   *
   * >>> Warum das der wichtigste Handgriff hier ist <<<
   * Getipptes wird kurz gesammelt, bevor es hinausgeht – sonst gäbe es je
   * Anschlag eine Nachricht. In dieser Wartezeit kann eine fremde Änderung
   * eintreffen. Würde die zuerst angewandt, stünde danach im gemeinsamen
   * Text etwas anderes als in der wartenden Fassung, und der Vergleich
   * würde die fremde Änderung als „gelöscht" deuten und wieder entfernen.
   *
   * Deshalb: vor JEDER fremden Änderung erst das Eigene eintragen. Dann
   * treffen zwei saubere Änderungen aufeinander, und Yjs führt sie
   * zusammen – was es ja gerade kann.
   */
  function flushPending(pageId) {
    const timer = flushTimers.get(pageId);
    if (timer) { clearTimeout(timer); flushTimers.delete(pageId); }

    if (!pendingText.has(pageId)) return;
    const html = pendingText.get(pageId);
    pendingText.delete(pageId);
    applyLocalText(pageId, html);
  }

  function flushAllPending() {
    for (const pageId of Array.from(pendingText.keys())) flushPending(pageId);
  }

  /** Ein Strich ist fertig – sofort weitergeben. */
  function noteStroke(pageId, stroke) {
    if (!room || !stroke) return;
    room.sendOp({ k: 'ink', p: pageId, s: JSON.parse(JSON.stringify(stroke)) });

    /* Den Vergleichsstand nachziehen. Ohne das sähe er gleich darauf eine
       veränderte Strichliste und schickte sie NOCH einmal, dann als
       vollständige Liste – bei einer handgeschriebenen Seite wären das
       zigtausend Zeichen je Strich. */
    const info = getPage(pageId);
    if (snapshot && snapshot.pages[pageId] && info) {
      snapshot.pages[pageId].ink = inkSig(info.page.inkStrokes);
    }
  }

  /**
   * Irgendetwas am Heft hat sich geändert (core/autoSave.js). Was genau,
   * weiß hier niemand – deshalb wird verglichen.
   */
  function noteChange(nbId) {
    if (!liveNb || (nbId && nbId !== liveNb.id)) return;
    scheduleStructSync();
  }

  /** Die aktive Seite hat gewechselt – der eigene Marker zieht mit. */
  function notePage(pageId) {
    if (!room || !pageId) return;
    room.setPage(pageId, -1);
    // Steht die Schreibmarke schon wieder im Text, meldet reportCaret das
    // gleich hinterher; die Bremse fasst beides zu einer Meldung zusammen.
    reportCaret();
  }

  /** Der Yjs-Stand einer Seite, zum Sichern nach Firestore. */
  function stateFor(pageId) {
    // Wartendes zuerst eintragen, sonst fehlte es im gesicherten Stand
    flushPending(pageId);

    const entry = docs.get(pageId);
    if (!entry) return null;
    return toBase64(window.Y.encodeStateAsUpdate(entry.ydoc));
  }

  function isLive() { return !!room; }

  /**
   * Selbstprüfung für die Stelle der Schreibmarke.
   *
   * Läuft in EINEM Fenster und braucht niemanden sonst: die eigene Marke
   * wird durch dieselbe Rechenkette geschickt, die auch für die fremde
   * gilt (DOM → Zahl → DOM → Bildschirmpunkt), und das Ergebnis mit dem
   * verglichen, was der Browser selbst sagt. Weicht es hier schon ab,
   * liegt es an der Umrechnung; stimmt es, liegt es an dem, was ankommt.
   *
   * In die Konsole eingeben, während die Schreibmarke im Text steht:
   *     Collab.checkCaret()
   */
  function checkCaret() {
    const textDiv = document.activeElement;
    if (!textDiv || !textDiv.classList || !textDiv.classList.contains('j-text')) {
      console.log('[Collab] Erst in den Text klicken, dann noch einmal.');
      return null;
    }
    const pgEl = textDiv.closest('[data-pgid]');
    const sel = window.getSelection();
    if (!pgEl || !sel || !sel.rangeCount) return null;

    const echt = sel.getRangeAt(0);
    const pos = flatCaretPos(textDiv);
    const zurueck = flatRangeAt(textDiv, pos);

    const gleicherPunkt = !!zurueck
      && zurueck.startContainer === echt.startContainer
      && zurueck.startOffset === echt.startOffset;

    const zoom = (typeof getZoom === 'function') ? getZoom() : 1;
    const pageRect = pgEl.getBoundingClientRect();
    const textRect = textDiv.getBoundingClientRect();

    // Was der Browser für die echte Marke sagt, und was wir daraus machen
    const echtRoh = echt.getBoundingClientRect();
    const text = flatTextOf(textDiv);
    const unser = caretRectAt(textDiv, pos, text);
    const zeile = flatLineSpan(text, pos, 1);

    const bericht = {
      stelle: pos,
      textLaenge: text.length,
      umgebung: JSON.stringify(text.slice(Math.max(0, pos - 12), pos))
        + ' ▏ ' + JSON.stringify(text.slice(pos, pos + 12)),
      hinUndZurueck: gleicherPunkt ? 'stimmt' : 'WEICHT AB',

      zoom,
      zeilenhoehe: parseInt(textDiv.style.lineHeight) || null,

      // Rohwerte am Bildschirm
      browserMarkeOben: Math.round(echtRoh.top),
      browserMarkeHoehe: Math.round(echtRoh.height),
      unsereMarkeOben: unser ? Math.round(unser.top) : null,
      unsereMarkeHoehe: unser ? Math.round(unser.height) : null,
      abweichungPx: unser ? Math.round(unser.top - echtRoh.top) : null,

      // Woraus die Platzierung gerechnet wird
      seiteOben: Math.round(pageRect.top),
      textfeldOben: Math.round(textRect.top),
      gesetztesTop: unser ? Math.round((unser.top - pageRect.top) / zoom) : null,

      zeileVonBis: zeile,

      /* >>> Die entscheidende Zeile bei „die Marke sitzt woanders" <<<
         Für jeden anderen wird nachgesehen, was HIER an der Stelle steht,
         die er gemeldet hat. Tippt er gerade „hallo" und hier steht an
         seiner Stelle etwas ganz anderes, dann sind nicht die Pixel
         schuld, sondern die Texte der beiden Seiten sind auseinander. */
      andere: others.map(p => {
        const el = document.querySelector('[data-pgid="' + cssEscapeId(p.pageId || '') + '"]');
        const td = el ? el.querySelector('.j-text') : null;
        const txt = td ? flatTextOf(td) : null;
        const o = p.offset;
        const imText = Number.isFinite(o) && o >= 0;

        return {
          name: p.name,
          seite: p.pageId,
          seiteHierOffen: !!td,
          stelle: o,
          meinTextLaenge: txt === null ? null : txt.length,
          ueberDasEndeHinaus: txt !== null && imText && o > txt.length,
          hierSteht: (txt !== null && imText)
            ? JSON.stringify(txt.slice(Math.max(0, o - 12), o))
              + ' ▏ ' + JSON.stringify(txt.slice(o, o + 12))
            : '(nicht im Text)',
          sperre: p.lockFrom + '–' + p.lockTo
        };
      })
    };

    /* Als Zeichenkette und nicht als Objekt: main.js reicht die Ausgaben
       des Fensters ans Terminal weiter, aber nur den fertigen Text – ein
       Objekt käme dort als „[object Object]" an. So ist die Prüfung auch
       ohne offene Entwicklerwerkzeuge zu lesen. */
    console.log('[Collab] Prüfung der Schreibmarke:\n' + JSON.stringify(bericht, null, 2));
    if (!gleicherPunkt) {
      console.warn('[Collab] Die Umrechnung DOM → Zahl → DOM trifft nicht dieselbe Stelle.');
    }
    if (unser && Math.abs(unser.top - echtRoh.top) > 2) {
      console.warn('[Collab] Das Rechteck sitzt um ' + Math.round(unser.top - echtRoh.top)
        + ' px daneben (Bildschirmpixel, also noch mit Zoom).');
    }
    return bericht;
  }

  /**
   * Zustandsbericht für die Fehlersuche. In der Konsole aufrufen:
   *     Collab.status()
   * Sagt in einem Blick, woran es hakt – ob Yjs geladen ist, ob der Raum
   * steht, wie viele Seiten mitgeführt werden und wer sonst da ist.
   */
  function status() {
    const report = {
      dokument: docId || '(keins offen)',
      yjsGeladen: yAvailable(),
      liveVerbindung: !!room,
      darfSchreiben: canWrite,
      nurLesen: !!S.readOnly,
      seitenMitGemeinsamemText: docs.size,
      heft: liveNb ? liveNb.id : '(keins)',
      seitenImVergleich: snapshot ? Object.keys(snapshot.pages).length : 0,
      andereGeradeDa: others.map(p => ({
        name: p.name, seite: p.pageId, zeichen: p.offset,
        sperrt: (Number.isFinite(p.lockFrom) && p.lockFrom >= 0)
          ? p.lockFrom + '–' + p.lockTo : '–',
        sperreGilt: !!activeLocks(p.pageId).includes(p)
      })),
      letzterFehler: lastError || '(keiner)'
    };
    console.table ? console.table(report.andereGeradeDa) : null;
    console.log('[Collab]', report);
    return report;
  }

  /* Die Prüfung auch ohne Konsole erreichbar: Strg+Alt+P. Die Ausgabe
     geht über das Fenster ans Terminal (main.js, console-message), dort
     ist sie also auch ohne Entwicklerwerkzeuge zu sehen. */
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.altKey || String(e.key).toLowerCase() !== 'p') return;
    e.preventDefault();
    try { checkCaret(); } catch (err) { console.log('[Collab] Prüfung fehlgeschlagen: ' + err.message); }
  });

  /**
   * Das Schreibrecht während der laufenden Sitzung umstellen.
   *
   * >>> Warum das nötig ist <<<
   * Bisher bekam der Raum das Recht nur einmal, beim Beitreten. Änderte
   * der Besitzer es danach, sah der andere zwar sofort die neue
   * Beschriftung (ui/sharedDocs.js schaltet S.readOnly um), der Raum
   * arbeitete aber mit dem alten Wert weiter:
   *
   *   · Herabgestuft: die Person konnte weiter in den Raum schreiben.
   *     Firestore hätte es abgewiesen, die Live-Datenbank nicht – und
   *     genau dort landet das gemeinsame Tippen und die Handschrift.
   *   · Heraufgestuft: sie durfte laut Anzeige bearbeiten, ihre
   *     Änderungen gingen aber nirgends hin. Erst ein Schließen und
   *     erneutes Öffnen half.
   *
   * @param {boolean} canEdit
   */
  function setCanWrite(canEdit) {
    const wanted = !!canEdit;
    if (wanted === canWrite) return;
    canWrite = wanted;

    /* Wer gerade das Recht bekommt, hat vielleicht schon getippt, während
       er noch nicht durfte. Damit dieser Stand nicht liegen bleibt, wird
       einmal abgeglichen. Wer es verliert, braucht das nicht – seine
       Eingaben waren nie für den Raum bestimmt. */
    if (wanted && room) {
      try { syncStructure(); } catch (err) { console.warn('[Collab] Abgleich nach Rechtewechsel:', err); }
    }

    showLiveState();
  }

  window.Collab = {
    start, stop, setCanWrite, noteTextChange, noteStroke, notePage, noteChange,
    stateFor, isLive, renderMarkers, renderCarets, renderLocks, status, checkCaret,
    // Zeilensperre – app.js fragt vor jeder Eingabe nach
    editBlockedBy, warnLocked, lockOwner, caretOf,
    // Sofort abgleichen, ohne auf den Takt zu warten (Tests, Schließen)
    syncNow: syncStructure,
    // Fehlersuche: was fremde Anschläge mit der eigenen Marke gemacht haben
    caretLog: zeigeCaretLog,
    // offengelegt für scripts/test-collab-text.js
    _textDelta: textDelta,
    _shiftedPos: shiftedPos,
    _seedUpdate: seedUpdate
  };
})();
