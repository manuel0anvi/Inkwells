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
  /* Wem das offene Dokument gehoert. Steht in den Meldungen und
     entscheidet dort, wer sie lesen darf (ui/melden.js). */
  let ownerUidJetzt = '';
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
  /* Steht die Leitung zur Live-Datenbank? null = noch nichts gehoert. */
  let verbindungSteht = null;
  let stopVerbindung = null;

  function showLiveState() {
    const el = E('collab-state');
    if (!el) return;

    if (room) {
      /* Betreten heisst noch nicht, dass etwas ankommt. Steht die
         Leitung nicht, laeuft alles weiter, als sei nichts - geschrieben
         wird in eine Warteschlange, die niemand sieht. Das gehoert in
         den Streifen, und zwar solange es anhaelt. */
      if (verbindungSteht === false) {
        el.style.display = 'inline';
        el.textContent = t('collabOffline') + ' — ' + t('collabBlocked');
        el.title = '';
        return;
      }
      el.textContent = '';
      el.style.display = 'none';
      return;
    }

    el.style.display = 'inline';
    el.textContent = t('collabOffline') + grundText();
    el.title = lastError || '';
  }

  /**
   * Warum laeuft die Live-Uebertragung nicht?
   *
   * >>> Warum das im Streifen stehen muss <<<
   * Bis hierher stand dort nur "Live-Uebertragung aus", und der Grund
   * ausschliesslich im Tooltip und in der Konsole. Wer nicht auf die
   * Idee kam, die Entwicklerwerkzeuge zu oeffnen, sah eine App, die
   * einfach nicht zusammenarbeitet - ohne jeden Hinweis, woran es liegt.
   * Ein blockierter Zugang zur Datenbank sieht dann genauso aus wie ein
   * Besitzer, der das Heft noch nicht offen hat.
   */
  function grundText() {
    if (!lastError) return '';
    if (/RTDB_UNREACHABLE/.test(lastError)) return ' — ' + t('collabBlocked');
    if (/ROOM_NOT_ADMITTED/.test(lastError)) return ' — ' + t('collabWaitingOwner');
    if (/ROOM_OWNER_MISMATCH/.test(lastError)) return ' — ' + t('collabOwnerMismatch');
    if (/PERMISSION_DENIED|permission_denied/i.test(lastError)) return ' — ' + t('collabDenied');
    return '';
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
      const u = toBase64(update);

      /* >>> Passt das überhaupt durch den Kanal? <<<
         Die Regel der Realtime Database lässt für `u` 200.000 Zeichen zu.
         Struktur-Meldungen wurden schon immer vorher gemessen (sendLive),
         der TEXT aber nicht: er ging ungeprüft hinaus, die Datenbank wies
         ihn ab, und sendOp schrieb nur eine Warnung in die Konsole. Die
         Änderung war damit für immer verloren.

         Sichtbar war das als „ich schreibe, der andere sieht nichts – nur
         mein Sperrband": Anwesenheit und Sperre laufen über einen anderen
         Weg und kamen weiter an. Groß werden Textänderungen vor allem
         beim ersten Stand einer vollen Seite und beim Einfügen langer
         Abschnitte.

         Was nicht durchpasst, geht denselben Weg wie ein Bild: erst nach
         Firestore sichern, dann der Gegenseite sagen „hol diese Seite
         neu". Langsamer, aber es kommt an. */
      if (u.length > LIVE_OP_LIMIT) {
        console.warn('[Collab] Textänderung zu groß für den Live-Kanal ('
          + u.length + ' Zeichen) – Seite ' + pageId + ' geht über Firestore.');
        sendViaFirestore(pageId);
        return;
      }

      const op = { k: 'y', p: pageId, u };
      const hier = caretInfoFor(pageId);
      if (hier) {
        op.c = hier.offset;
        if (hier.anker) op.cx = hier.anker;
        if (hier.lock) { op.lf = hier.lock.from; op.lt = hier.lock.to; }
      }

      /* Und wenn es trotzdem schiefgeht – ältere Regeln, Netz weg –, darf
         die Änderung nicht einfach verschwinden. Dann derselbe Notweg. */
      Promise.resolve(room.sendOp(op))
        .then((ok) => { if (!ok) sendViaFirestore(pageId); })
        .catch(() => sendViaFirestore(pageId));
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
    if (!others.length) { bar.style.display = 'none'; schliesseLeute(); return; }
    bar.style.display = 'flex';

    /* Höchstens fünf Abzeichen, und wenn es mehr sind, ein sechstes mit
       einem Plus. Die Namen stehen alle im Fenster darunter – dafür ist
       ein Abzeichen anzutippen. */
    for (const person of others.slice(0, 5)) {
      const dot = document.createElement('span');
      dot.className = 'collab-dot';
      dot.style.background = person.color || 'var(--gold)';
      dot.textContent = person.initials || '?';
      dot.title = person.name || person.email || '';
      bar.appendChild(dot);
    }
    if (others.length > 5) {
      const more = document.createElement('span');
      more.className = 'collab-dot collab-dot-more';
      more.textContent = '+';
      more.title = others.slice(5).map(p => p.name || p.email).join(', ');
      bar.appendChild(more);
    }

    if (leuteOffen()) zeigeLeute();   // offenes Fenster mitführen

    /* Die Chat-Ikone steht neben den Abzeichen und hängt an derselben
       Frage: ist sonst noch jemand da? Mit sich selbst redet niemand. */
    if (window.ChatUI && typeof window.ChatUI.refresh === 'function') {
      window.ChatUI.refresh();
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     WER IST DAS? – DAS FENSTER AN DER LEISTE

     Auf einem Abzeichen stehen zwei Buchstaben; wer dahinter steckt,
     stand nur im Tooltip, und den gibt es auf einem Tablet nicht. Ein
     Tipp auf die Leiste zeigt deshalb alle Beteiligten mit vollem Namen,
     Adresse und der Seite, auf der sie gerade sind – auch die, die nicht
     mehr in die fünf Abzeichen gepasst haben.

     Das Bild ist dasselbe wie überall sonst in der App: ein farbiger
     Kreis mit den Initialen (ui/auth.js macht es in der Titelleiste
     genauso). Ein echtes Profilbild liegt gar nicht vor – Microsoft
     liefert keines, und ein fremder Bildserver käme an der
     Inhaltsrichtlinie in src/index.html ohnehin nicht vorbei.
     ══════════════════════════════════════════════════════════════════ */
  let leuteKarte = null;

  function leuteOffen() {
    return !!leuteKarte && leuteKarte.style.display !== 'none';
  }

  function schliesseLeute() {
    if (leuteKarte) leuteKarte.style.display = 'none';
  }

  function baueLeuteKarte() {
    if (leuteKarte) return leuteKarte;
    leuteKarte = document.createElement('div');
    leuteKarte.className = 'collab-card';
    leuteKarte.style.display = 'none';
    document.body.appendChild(leuteKarte);

    // Daneben getippt heisst zu
    document.addEventListener('pointerdown', (e) => {
      if (!leuteOffen()) return;
      if (leuteKarte.contains(e.target)) return;
      if (e.target.closest && e.target.closest('#collab-people')) return;
      schliesseLeute();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && leuteOffen()) schliesseLeute();
    });
    return leuteKarte;
  }

  /** „Seite 3" – oder nichts, wenn die Seite hier nicht bekannt ist. */
  function seitenName(pageId) {
    if (!pageId) return t('collabNoPage');
    const nb = (S.notebooks || []).find(n => n.id === S.activeNbId);
    const nr = (nb && typeof pageNumberOf === 'function') ? pageNumberOf(nb, pageId) : 0;
    return nr ? t('collabPageNr').replace('{n}', nr) : t('collabNoPage');
  }

  function zeigeLeute() {
    const karte = baueLeuteKarte();
    const leiste = E('collab-people');
    if (!leiste) return;

    const alle = [];
    if (room && room.me) alle.push({ ...room.me, selbst: true });
    alle.push(...others);

    karte.innerHTML = '';
    const kopf = document.createElement('div');
    kopf.className = 'collab-card-kopf';
    kopf.textContent = t('collabPeople');
    karte.appendChild(kopf);

    for (const person of alle) {
      const zeile = document.createElement('div');
      zeile.className = 'collab-card-zeile';

      const kreis = document.createElement('span');
      kreis.className = 'collab-face';
      kreis.style.background = person.color || 'var(--gold)';
      kreis.textContent = person.initials || '?';
      zeile.appendChild(kreis);

      const text = document.createElement('div');
      text.className = 'collab-card-text';
      const name = document.createElement('strong');
      name.textContent = (person.name || person.email || '?')
        + (person.selbst ? ' (' + t('collabYou') + ')' : '');
      const wo = document.createElement('small');
      wo.textContent = seitenName(person.pageId);
      text.appendChild(name);
      text.appendChild(wo);
      zeile.appendChild(text);

      /* ══════════════════════════════════════════════════════════
         MELDEN

         Nur an fremden Zeilen und nur, wenn eine Adresse bekannt ist –
         ohne sie liesse sich niemand zuordnen (ui/melden.js).

         Das Fenster geht dabei zu: der Melde-Dialog liegt darueber, und
         zwei offene Fenster uebereinander sind schwer zu bedienen. */
      if (!person.selbst && person.email && window.Melden_) {
        const melden = document.createElement('button');
        melden.className = 'collab-melden';
        melden.title = t('meldenTitel') || 'Jemanden melden';
        melden.setAttribute('aria-label', melden.title);
        melden.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" '
          + 'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'
          + '<path d="M3.6 14V2.6h7.6l-1 2.7 1 2.7H3.6"/></svg>';
        melden.addEventListener('click', (ev) => {
          ev.stopPropagation();
          schliesseLeute();
          window.Melden_.oeffne({ email: person.email, name: person.name });
        });
        zeile.appendChild(melden);
      }

      karte.appendChild(zeile);
    }

    karte.style.display = 'block';

    // Unter der Leiste, aber nie aus dem Fenster hinaus
    const r = leiste.getBoundingClientRect();
    const b = karte.offsetWidth || 240;
    karte.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - b - 8, r.left))) + 'px';
    karte.style.top = Math.round(r.bottom + 6) + 'px';
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('#collab-people')) return;
    if (leuteOffen()) schliesseLeute();
    else zeigeLeute();
  });

  /**
   * Marker an den Seitenrand: ein Abzeichen mit den Initialen auf Höhe
   * der Seite, auf der die Person gerade ist. Fremde Textcursor werden
   * bewusst NICHT gezeigt – so gewünscht, und nebenbei erheblich
   * einfacher.
   */
  /* ══════════════════════════════════════════════════════════════════
     DAS ABZEICHEN STEHT STILL

     Hier wurden alle Marker weggeworfen und neu gebaut. Die Anwesenheit
     kommt aber alle 150 ms – und ein frisch eingesetztes Element fängt
     seine Einblend-Bewegung von vorn an (collab-pop in css/layout.css).
     Das Abzeichen pulsierte dadurch ununterbrochen, obwohl sich gar
     nichts geändert hatte; genau so wurde es gemeldet.

     Jetzt wird nur noch nachgeführt: neu angelegt wird ein Abzeichen,
     wenn die Person dazukommt, entfernt, wenn sie geht. Wer bleibt,
     behält sein Element – und damit seine Ruhe.
     ══════════════════════════════════════════════════════════════════ */
  function renderMarkers() {
    const byPage = new Map();
    for (const person of others) {
      if (!person.pageId) continue;
      if (!byPage.has(person.pageId)) byPage.set(person.pageId, []);
      byPage.get(person.pageId).push(person);
    }

    const gebrauchteLeisten = new Set();

    for (const [pageId, people] of byPage) {
      const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
      if (!pgEl) continue;

      let rail = pgEl.querySelector(':scope > .collab-marker');
      if (!rail) {
        rail = document.createElement('div');
        rail.className = 'collab-marker';
        pgEl.appendChild(rail);
      }
      gebrauchteLeisten.add(rail);

      const vorhanden = new Map();
      for (const el of rail.children) vorhanden.set(el.dataset.uid, el);

      for (const person of people.slice(0, 3)) {
        let dot = vorhanden.get(person.uid);
        if (!dot) {
          dot = document.createElement('span');
          dot.className = 'collab-dot';
          dot.dataset.uid = person.uid;
          rail.appendChild(dot);
        }
        vorhanden.delete(person.uid);

        const farbe = person.color || 'var(--gold)';
        if (dot.dataset.farbe !== farbe) {
          dot.dataset.farbe = farbe;
          dot.style.background = farbe;
        }
        const kurz = person.initials || '?';
        if (dot.textContent !== kurz) dot.textContent = kurz;
        const titel = (person.name || person.email || '') + ' – ' + t('collabOnThisPage');
        if (dot.title !== titel) dot.title = titel;
      }

      // Wer diese Seite verlassen hat
      for (const el of vorhanden.values()) el.remove();
    }

    document.querySelectorAll('.collab-marker').forEach(rail => {
      if (!gebrauchteLeisten.has(rail)) rail.remove();
    });
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

  /* ── Gerendert wird nur einmal je Frame ───────────────────────────
     Das Drosseln in core/share.js (150 ms Marke, 1000 ms Seite)
     ist eine Sache. Aber die Marke und die Sperre werden von
     mehreren Stellen aus aufgerufen – bei jedem Eintreffen einer
     Nachricht, beim Scrollen, nach einer Textänderung. Alle diese
     Aufrufe im selben Frame müssen nur EIN Mal rendern.
     Deshalb werden sie hier gesammelt und erst im nächsten
     requestAnimationFrame ausgeführt. */

  let _renderScheduled = false;

  function _flushCaretsAndLocks() {
    _renderScheduled = false;
    _renderCaretsNow();
    _renderLocksNow();
  }

  function scheduleCaretsAndLocks() {
    if (_renderScheduled) return;

    /* >>> Ohne Bildtakt wird nicht gezeichnet <<<
       Im Prüfstand ohne Fenster (scripts/test-collab-sync.js) gibt es kein
       requestAnimationFrame. Der Aufruf warf dort einen Fehler mitten im
       Einarbeiten einer fremden Änderung – und riss damit den ABGLEICH
       mit, obwohl nur eine Anzeige nicht gezeichnet werden konnte.
       Gehalten hat das bisher nur ein Zufall: der erste Fehler fiel an
       einer Stelle an, die ihn verschluckte, und danach stand das Flag
       schon. */
    if (typeof requestAnimationFrame !== 'function') return;

    _renderScheduled = true;
    requestAnimationFrame(_flushCaretsAndLocks);
  }

  function renderCarets() { scheduleCaretsAndLocks(); }
  function renderLocks() { scheduleCaretsAndLocks(); }

  /* ══════════════════════════════════════════════════════════════════
     WIEDERVERWENDEN STATT NEU BAUEN

     Hier stand ein `querySelectorAll(...).forEach(el => el.remove())` und
     danach ein frisches createElement je Person – und das bei jedem Bild,
     also bis zu sechzigmal in der Sekunde, solange jemand tippt.

     Zwei Folgen, beide gemeldet:
       · Es FLACKERTE. Ein neues Element hat keinen vorigen Zustand, von
         dem aus es sich bewegen könnte; die weichen Übergänge in
         css/layout.css (transition: left/top) liefen deshalb nie, die
         Marke sprang stattdessen jedes Mal neu ins Bild.
       · Es kostete unnötig Zeit – jedes Mal Elemente wegwerfen und neu
         aufbauen, samt Namensschild.

     Deshalb: je Person EIN Element, das bleibt und nur seine Werte
     bekommt. Weg kommt nur, wer nicht mehr da ist.
     ══════════════════════════════════════════════════════════════════ */
  const caretEls = new Map();     // uid -> Element
  const lockEls = new Map();      // uid#nr -> Element

  /** Holt das gemerkte Element oder baut es – und hängt es an die Seite. */
  function reuse(store, key, pgEl, bauen) {
    let el = store.get(key);
    if (!el || !el.isConnected) {
      el = bauen();
      store.set(key, el);
    }
    if (el.parentElement !== pgEl) pgEl.appendChild(el);
    return el;
  }

  /** Alles wegräumen, was in diesem Durchgang nicht gebraucht wurde. */
  function aufraeumen(store, gebraucht) {
    for (const [key, el] of store) {
      if (gebraucht.has(key)) continue;
      el.remove();
      store.delete(key);
    }
  }

  function _renderCaretsNow() {
    if (!others.length) {
      aufraeumen(caretEls, new Set());
      return;
    }

    const gebraucht = new Set();
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

      const caret = reuse(caretEls, person.uid, pgEl, () => {
        const el = document.createElement('div');
        el.className = 'collab-caret';
        const label = document.createElement('span');
        label.className = 'collab-caret-label';
        el.appendChild(label);
        return el;
      });
      gebraucht.add(person.uid);

      const farbe = person.color || 'var(--gold)';
      const name = person.name || person.email || '?';
      caret.style.left = box.left + 'px';
      caret.style.top = box.top + 'px';
      caret.style.height = box.height + 'px';
      if (caret.style.background !== farbe) caret.style.background = farbe;

      const label = caret.firstElementChild;
      if (label) {
        if (label.style.background !== farbe) label.style.background = farbe;
        if (label.textContent !== name) label.textContent = name;
      }
      }
    }

    aufraeumen(caretEls, gebraucht);
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
     wer weiterschreibt, frischt ununterbrochen auf. Wer aufhört, gibt die
     Sperre nach LOCK_CLAIM_MS ausdrücklich frei – dieser Nachlauf greift
     also nur, wenn jemand gar nichts mehr meldet (Absturz, Leitung weg). */
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

    /* Die eigene Zeile gehört einem selbst, auch wenn eine fremde Sperre
       über sie hinweggeht (siehe eigeneSperreDeckt). Ohne das bekam, wer
       in Zeile 5 schreibt, dauernd „X bearbeitet diese Zeile" zu lesen,
       weil X in Zeile 4 sitzt und die Sperre eine Zeile weiter reicht. */
    if (eigeneSperreDeckt(pageId, from) && eigeneSperreDeckt(pageId, to)) return null;

    return lockOwner(pageId, from, to);
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE MARKE KOMMT GAR NICHT ERST IN EINE GESPERRTE ZEILE

     Bis hierher wurde erst der ANSCHLAG abgewiesen (editBlockedBy in
     'beforeinput'). Die Schreibmarke durfte trotzdem dort stehen, und
     das hat zwei Nachteile, beide gemeldet:

       · Es sieht aus, als könnte man schreiben. Man tippt einen Satz,
         und nichts erscheint.
       · Es gibt Wege an 'beforeinput' vorbei – eine Ersetzung durch die
         Rechtschreibhilfe, ein Einfügen über das Kontextmenü des
         Systems, eine Eingabemethode. Dann stand doch etwas da.

     Deshalb verschwindet die zusammengefallene Marke aus einer fremden
     Sperre. MARKIEREN bleibt erlaubt: eine Auswahl über mehrere Zeilen
     ist zum Lesen und Kopieren da und ändert nichts.

     >>> Sie VERSCHWINDET, sie wird nicht verschoben <<<
     Hier stand: die Marke wandert an die Stelle vor der Sperre. Das war
     falsch, und zwar gleich doppelt.

       · Sie stand danach in einer Zeile, die man gar nicht angeklickt
         hatte – meist ÜBER dem Band. Wer dort weiterschrieb, schrieb an
         einer Stelle, die er nicht gemeint hatte.
       · Und sie stand dort mitten in einer Zeile, die dem anderen
         gleich gehören könnte: die Sperre wandert mit seinem Schreiben
         mit. Das Ergebnis war ein Cursor, der bei jedem Takt woandershin
         sprang. Gemeldet als „alles wird buggy".

     Ein gesperrter Bereich gehört jemand anderem. Das Richtige ist
     deshalb nicht, einen Ersatzplatz zu suchen, sondern gar keinen:
     die Auswahl wird aufgehoben und das Textfeld gibt den Fokus ab. Es
     ist dann sichtbar nichts da, wo man gerade nichts darf.

     Gehört die Sperre einem selbst (das kann nicht sein) oder gibt es
     keine, passiert hier nichts.

     >>> Warum das Verschieben STILL geschieht <<<
     Gemeldet worden: „jemand anders schreibt, ich fasse das Heft gar
     nicht an – und trotzdem kommt dauernd der Hinweis." Der Grund war
     dieser Takt hier. Er läuft alle 600 ms weiter, auch wenn die eigene
     Marke bloß irgendwo im Text liegt; wandert die Sperre des anderen
     über sie hinweg, sprang jedes Mal ein Hinweis heraus, ohne dass
     jemand etwas versucht hätte.

     Der Hinweis gehört an den VERSUCH, nicht an die Sperre. Wer wirklich
     tippt, bekommt ihn ohnehin aus app.js (lockedHere → warnLocked).
     Deshalb wird hier nur noch gemeldet, wenn beides zutrifft: der
     Aufruf kommt von einer eigenen Bewegung (`melden`) UND auf dieser
     Seite wurde gerade wirklich geschrieben (schreibtGerade).
     ══════════════════════════════════════════════════════════════════ */
  let letzterAusweich = 0;

  /* ══════════════════════════════════════════════════════════════════
     LIEGT DIESER PUNKT AUF EINEM FREMDEN SPERRBAND?

     Gefragt wird vor dem Setzen der Schreibmarke (canvas/input.js), also
     BEVOR irgendetwas passiert ist. Ohne das lief die Reihenfolge
     andersherum: der Klick setzte die Marke, placeCaretAnywhere füllte
     dabei bis dorthin auf – und erst der nächste Takt schob die Marke
     wieder heraus. Das Auffüllen blieb stehen und verschob alle Stellen
     dahinter, auch die Sperre des anderen. Genau daraus wurde „alles
     wird buggy".

     >>> Warum über die Bänder und nicht über die Stelle im Text <<<
     Eine Stelle im Text gibt es an dieser Stelle noch gar nicht – sie
     entstünde erst durch das Setzen der Marke. Die Bänder liegen
     dagegen schon da, in Bildschirmkoordinaten, und sie sind genau das,
     was der Nutzer sieht. Was aussieht wie gesperrt, ist gesperrt.
     ══════════════════════════════════════════════════════════════════ */
  /** Welche Stelle im Text liegt unter diesem Punkt? −1, wenn keine. */
  function stelleUnterZeiger(clientX, clientY, pgEl) {
    const textDiv = pgEl && typeof pgEl.querySelector === 'function'
      ? pgEl.querySelector('.j-text') : null;
    if (!textDiv || typeof flatPosOfPoint !== 'function') return -1;
    const treffer = document.caretPositionFromPoint
      ? document.caretPositionFromPoint(clientX, clientY)
      : (document.caretRangeFromPoint ? document.caretRangeFromPoint(clientX, clientY) : null);
    const knoten = treffer ? (treffer.offsetNode || treffer.startContainer) : null;
    if (!knoten || !textDiv.contains(knoten)) return -1;
    try {
      const stelle = flatPosOfPoint(textDiv, knoten,
        treffer.offset !== undefined ? treffer.offset : treffer.startOffset);
      return stelle === null ? -1 : stelle;
    } catch (err) { return -1; }
  }

  function trifftSperrband(clientX, clientY, pgEl) {
    if (!others.length || !pgEl || typeof pgEl.querySelectorAll !== 'function') return null;

    /* Ein Band, das über die eigene beanspruchte Zeile hinweggeht, ist
       kein Hindernis – sonst käme man in die Zeile, in der man gerade
       schreibt, nach einem Klick daneben nicht mehr zurück. Gemeint ist
       wirklich nur die eigene Zeile; alles andere sperrt weiterhin.

       Die Stelle unter dem Zeiger wird dafür gemessen und nicht gesetzt:
       gesetzt würde sie erst durch den Klick, den wir hier ja gerade
       noch abwenden wollen. */
    if (eigeneSperreDeckt(pgEl.dataset ? pgEl.dataset.pgid : '',
                          stelleUnterZeiger(clientX, clientY, pgEl))) return null;

    for (const band of pgEl.querySelectorAll('.collab-lock')) {
      const r = band.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (clientX < r.left || clientX > r.right
          || clientY < r.top || clientY > r.bottom) continue;
      // Wem sie gehört, damit der Hinweis einen Namen nennen kann
      return others.find(p => p.uid === band.dataset.uid) || others[0] || null;
    }
    return null;
  }

  /**
   * Nimmt die Schreibmarke aus dem Text – ohne ihr eine neue Stelle zu
   * geben.
   *
   * Beides ist nötig: die Auswahl aufheben nimmt den Cursor weg, der
   * Fokus muss aber auch weg, sonst setzt Chromium ihn beim nächsten
   * Anschlag von selbst wieder an den Anfang des Feldes – und der liegt
   * je nach Seite mitten in fremdem Text.
   */
  function markeWeg(textDiv) {
    try {
      const sel = window.getSelection();
      if (sel && typeof sel.removeAllRanges === 'function') sel.removeAllRanges();
    } catch (err) { /* dann wenigstens der Fokus */ }
    try { textDiv.blur(); } catch (err) { /* egal */ }
  }

  /**
   * @param {boolean} [melden] Darf ein Hinweis erscheinen? Nur bei einer
   *   Bewegung, die vom Nutzer selbst ausgeht – der Takt meldet nie.
   */
  function haltCaretAusSperre(melden = false) {
    if (!others.length) return;
    /* Ohne Auswahl-Werkzeug gibt es hier nichts zu tun. Der Prüfstand
       scripts/test-collab-sync.js fährt collab.js in einem nachgebauten
       DOM ohne getSelection – und ein Fehler in diesem Takt hätte dort
       die ganze Sitzung mitgerissen. */
    if (typeof window.getSelection !== 'function') return;
    if (typeof flatCaretPos !== 'function' || typeof setFlatCaret !== 'function') return;

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;   // Markieren ist erlaubt

    const textDiv = document.activeElement;
    if (!textDiv || !textDiv.classList || !textDiv.classList.contains('j-text')) return;
    const pgEl = textDiv.closest('[data-pgid]');
    if (!pgEl) return;

    const pageId = pgEl.dataset.pgid;
    let stelle;
    try { stelle = flatCaretPos(textDiv); } catch (err) { return; }
    if (stelle === null) return;

    // Die eigene Zeile gehört einem selbst – siehe eigeneSperreDeckt
    if (eigeneSperreDeckt(pageId, stelle)) return;

    const person = lockOwner(pageId, stelle, stelle);
    if (!person) return;

    markeWeg(textDiv);

    /* Sagen, warum die Marke wegspringt – aber nur dem, der hier auch
       wirklich arbeitet. Wer nur zusieht, soll das Sperrband sehen und
       sonst nichts (siehe der Absatz oben). */
    if (!melden || !schreibtGerade(pageId)) return;

    const jetzt = Date.now();
    if (jetzt - letzterAusweich > LOCK_HINT_MS) {
      letzterAusweich = jetzt;
      warnLocked(person);
    }
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

  // Mehr Zeilen als das kann eine Sperre nie umfassen – Notbremse
  const LOCK_MAX_ZEILEN = 6;
  // So viele Zeilen MINDESTENS sperren – der andere soll sehen, dass
  // hier geschrieben wird, nicht nur einen schmalen Strich
  const LOCK_MIN_ZEILEN = 2;

  /**
   * Die Zeilenkästen eines gesperrten Bereichs – einer je Bildschirmzeile.
   *
   * >>> Warum nicht über die Rechtecke des Textes <<<
   * Vorher kam jede Zeile aus getClientRects() des Bereichs. Eine LEERE
   * Zeile hat aber keinen Text und damit auch kein Rechteck – für sie
   * entstand kein Band. Gesperrt sind aber „diese Zeile und die
   * nächste", und wenn die nächste gerade leer ist, sah man nur eine.
   *
   * Gerechnet wird deshalb aus der Geometrie: der Kasten der ersten Zeile
   * und der der letzten, und dazwischen je eine Zeilenhöhe. Das deckt
   * leere Zeilen genauso ab wie umbrochene.
   *
   * Seit dem 10.8.2026 kommt die Mindestzahl dazu: Liegen erste und
   * letzte auf derselben Höhe, entsteht trotzdem ein zweites Band.
   */
  function lockZeilen(pgEl, textDiv, from, to, zoom) {
    const text = flatTextOf(textDiv);
    const ersteR = caretRectAt(textDiv, from, text);
    const letzteR = caretRectAt(textDiv, Math.max(from, to), text);
    if (!ersteR || !letzteR) return [];

    const erste = lineBoxOf(pgEl, textDiv, ersteR, zoom);
    const letzte = lineBoxOf(pgEl, textDiv, letzteR, zoom);
    const hoehe = erste.height || 32;

    const zeilen = [erste];
    let top = erste.top + hoehe;
    while (top <= letzte.top + hoehe / 2 || zeilen.length < LOCK_MIN_ZEILEN) {
      if (zeilen.length >= LOCK_MAX_ZEILEN) break;
      zeilen.push({ top, height: hoehe, left: erste.left });
      top += hoehe;
    }
    return zeilen;
  }

  function _renderLocksNow() {
    if (!others.length) {
      aufraeumen(lockEls, new Set());
      return;
    }

    const gebraucht = new Set();
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
        let zeilen = [];
        try { zeilen = lockZeilen(pgEl, textDiv, person.lockFrom, person.lockTo, zoom); }
        catch (err) { continue; }
        if (!zeilen.length) continue;

        const farbe = person.color || 'var(--gold)';

        /* >>> Ohne Namensschild am Band <<<
           Am oberen Band hing „🔒 Name". Das war dieselbe Auskunft
           zweimal: die fremde Schreibmarke steht schon in derselben
           Farbe in derselben Zeile und trägt den Namen bereits. Zwei
           Schilder übereinander in einer Zeile verdecken den Text, den
           sie erklären sollen. Die Farbe des Bandes genügt, um es der
           Marke zuzuordnen. */
        zeilen.forEach((box, i) => {
          const key = person.uid + '#' + i;
          const band = reuse(lockEls, key, pgEl, () => {
            const el = document.createElement('div');
            el.className = 'collab-lock';
            return el;
          });
          gebraucht.add(key);

          band.style.left = left + 'px';
          band.style.width = width + 'px';
          band.style.top = box.top + 'px';
          band.style.height = box.height + 'px';
          band.style.setProperty('--lock-color', farbe);
          // Wem das Band gehört – trifftSperrband braucht den Namen
          if (band.dataset.uid !== person.uid) band.dataset.uid = person.uid;
        });
      }
    }

    aufraeumen(lockEls, gebraucht);
  }

  /* Wann zuletzt getippt wurde, je Seite. Entscheidet, ob die eigene
     Zeile für die anderen gesperrt wird: eine Sperre am bloß abgelegten
     Cursor würde eine Zeile blockieren, obwohl niemand daran arbeitet. */
  const typedAt = new Map();

  /* Wo die eigene Marke zuletzt stand, je Seite. Rückfall für
     applyRemoteText, wenn die Auswahl im Augenblick nicht auslesbar ist –
     ohne ihn landet die Marke beim Austausch des Inhalts auf Stelle 0. */
  const letzteEigeneStelle = new Map();

  /* So lange nach dem letzten Anschlag gilt man noch als „am Schreiben".
     Das ist die Zeit, die eine Zeile für die anderen belegt bleibt –
     vier Sekunden waren zu knapp: wer einen Satz überlegt, hatte seine
     Zeile schon wieder freigegeben, während er noch daran arbeitete. */
  const LOCK_CLAIM_MS = 10000;

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
    /* Bei jedem dieser Abbrüche gehört der gemerkte Anspruch weg und
       nicht bloss abgelaufen: er ist die Vollmacht über die eigene Zeile
       (eigeneSperreDeckt). Blieb er nach dem Aufhören liegen, wirkte er
       noch bis zu zehn Sekunden weiter – und deckte dabei womöglich eine
       Zeile, in die man inzwischen ganz woanders geklickt hatte. */
    if (!canWrite || S.readOnly) { eigeneSperre.delete(pageId); return null; }
    if (!schreibtGerade(pageId)) { eigeneSperre.delete(pageId); return null; }
    if (typeof flatTextOf !== 'function') { eigeneSperre.delete(pageId); return null; }

    let span = null;
    try { span = visualLineSpan(textDiv, offset); } catch (err) { return null; }
    span = ohneFremdeStellen(span, pageId, textDiv, offset);

    /* Was hier herauskommt, ist der eigene Anspruch – merken, damit
       eigeneSperreDeckt() ihn kennt (siehe dort). */
    if (span) eigeneSperre.set(pageId, { from: span.from, to: span.to, at: Date.now() });
    else eigeneSperre.delete(pageId);
    return span;
  }

  /* Der zuletzt gemeldete eigene Anspruch, je Seite. */
  const eigeneSperre = new Map();

  /* ══════════════════════════════════════════════════════════════════
     WER SCHREIBT, HAT DIE VOLLMACHT ÜBER SEINE ZEILE

     Gegenstück zu ohneFremdeStellen, auf der Empfängerseite: dort wird
     verhindert, dass ein Zusammenstoss ENTSTEHT, hier, dass er noch
     etwas anrichtet, wenn er trotzdem entstanden ist – weil die fremde
     Sperre einen Augenblick älter ist, oder weil am anderen Ende eine
     ältere Fassung von Inkwells läuft, die die Zusatzzeile noch ohne
     Rücksicht beansprucht.

     >>> Warum nicht einfach „ich tippe gerade" <<<
     Das wäre zu grob. `schreibtGerade` gilt zehn Sekunden lang für die
     ganze Seite – wer eben noch geschrieben hat und dann mitten in eine
     fremde Zeile klickt, dürfte damit dort weitermachen, und die Sperre
     wäre wertlos.

     Massgeblich ist deshalb der eigene ANSPRUCH: die Zeile, die man
     zuletzt selbst gemeldet hat. Er entsteht nur beim Tippen, er endet
     mit dem Nachlauf, und ohneFremdeStellen hat ihm alles weggeschnitten,
     wo schon eine fremde Marke sitzt. Wer in eine fremde Zeile klickt,
     hat dort keinen Anspruch – der alte lag ja woanders.
     ══════════════════════════════════════════════════════════════════ */
  function eigeneSperreDeckt(pageId, stelle) {
    const eigen = eigeneSperre.get(pageId);
    if (!eigen) return false;
    if (Date.now() - eigen.at > LOCK_TTL_MS) return false;
    if (stelle < eigen.from || stelle > eigen.to) return false;

    /* ── Und die Zeile, in der ein anderer WIRKLICH sitzt, nie ────────
       Der eigene Anspruch umfasst die eigene Zeile und die nächste. Steht
       in dieser nächsten inzwischen jemand anderes und schreibt dort, ist
       sie seine – der eigene Anspruch von vorhin gilt dort nicht mehr.

       Ohne diese Frage liess sich die Sperre aushebeln, und genau so ist
       es gemeldet worden: „öfter auf die gesperrte Zeile drücken und
       dabei tippen, irgendwann geht es doch". Der Weg dahin:

         B schreibt in Zeile 4, sein Anspruch reicht bis Zeile 5.
         A schreibt in Zeile 5 – die ist gesperrt.
         B klickt in Zeile 5. Sein eigener Anspruch deckt sie ja noch,
         also liess ihn trifftSperrband durch, editBlockedBy liess ihn
         schreiben, und der Takt liess seine Marke stehen.

       Die Zusatzzeile ist eine Höflichkeit (siehe ohneFremdeStellen) –
       sie endet, sobald sie jemandem gehört. Gefragt wird nach der
       Zeile, in der die fremde Marke steht, NICHT nach seinem ganzen
       Sperrbereich: dessen Zusatzzeile ist genauso wenig ein Recht, und
       sie über die eigene zu legen war der Fehler von letztem Mal. */
    return !fremdeZeileDeckt(pageId, stelle);
  }

  /* Kurzgedächtnis für fremdeZeile(). Die Frage kommt bei jedem Anschlag,
     und jede Antwort kostet ein Dutzend Messungen im Text. 300 ms sind
     kurz genug, dass sie beim Tippen des anderen nicht veraltet – seine
     Meldungen kommen ohnehin seltener. */
  const zeilenMerk = new Map();
  const ZEILEN_MERK_MS = 300;

  /**
   * Die Zeile, in der die Marke dieser Person steht – ohne die
   * Zusatzzeile ihres Anspruchs.
   */
  function fremdeZeile(person, textDiv) {
    let stelle = Number(person.offset);
    if (!Number.isFinite(stelle) || stelle < 0) stelle = Number(person.lockFrom);
    if (!Number.isFinite(stelle) || stelle < 0) return null;

    const jetzt = Date.now();
    const schluessel = (person.uid || '?') + ':' + stelle;
    const alt = zeilenMerk.get(schluessel);
    if (alt && jetzt - alt.at < ZEILEN_MERK_MS) return alt.zeile;

    let zeile = { from: stelle, to: stelle };
    try {
      const gemessen = visualLineSpan(textDiv, stelle, 0);
      if (gemessen) zeile = gemessen;
    } catch (err) { /* dann gilt wenigstens die Stelle selbst */ }

    // Damit die Karte bei langen Sitzungen nicht wächst
    if (zeilenMerk.size > 64) zeilenMerk.clear();
    zeilenMerk.set(schluessel, { at: jetzt, zeile });
    return zeile;
  }

  /** Liegt diese Stelle in der Zeile eines anderen, der gerade schreibt? */
  function fremdeZeileDeckt(pageId, stelle) {
    const sperren = activeLocks(pageId);
    if (!sperren.length) return false;

    const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(pageId) + '"]');
    const textDiv = pgEl ? pgEl.querySelector('.j-text') : null;
    if (!textDiv) return false;

    for (const person of sperren) {
      const zeile = fremdeZeile(person, textDiv);
      if (zeile && stelle >= zeile.from && stelle <= zeile.to) return true;
    }
    return false;
  }

  /* ══════════════════════════════════════════════════════════════════
     WAS SCHON JEMAND ANDEREM GEHÖRT, WIRD NICHT BEANSPRUCHT

     Eine Sperre umfasst die eigene Zeile UND die darauf folgende – damit
     der andere sieht, dass hier gearbeitet wird. Genau daraus entstand
     ein Zusammenstoss:

       Person A schreibt in Zeile 5.
       Person B schreibt in Zeile 4 – ihre Sperre reicht bis Zeile 5.

     Damit lag A mitten in Bs Sperre, obwohl A dort zuerst war und
     gerade tippt. As Marke wurde herausgeworfen, kam beim nächsten
     Anschlag zurück, flog wieder heraus: der Cursor hüpfte. Gemeldet
     genau so.

     Die Zusatzzeile ist eine Höflichkeit, kein Recht. Sitzt dort schon
     eine fremde Marke, wird sie einfach nicht mitbeansprucht – die
     eigene Zeile bleibt in jedem Fall.

     >>> Und wenn beide gleichzeitig anfangen <<<
     Dann schneidet jeder dem anderen die Zusatzzeile weg, und beide
     behalten ihre eigene. Das ist das gewollte Ergebnis: wer schreibt,
     behält seine Zeile.
     ══════════════════════════════════════════════════════════════════ */
  function ohneFremdeStellen(span, pageId, textDiv, offset) {
    if (!span || !others.length) return span;

    let von = span.from;
    let bis = span.to;

    for (const person of peopleOnPage(pageId, textDiv)) {
      const stelle = Number(person.offset);
      if (!Number.isFinite(stelle) || stelle < 0) continue;
      if (stelle < von || stelle > bis) continue;
      // Die eigene Zeile bleibt: nur zurückweichen, nie darüber hinaus
      if (stelle > offset) bis = Math.min(bis, stelle - 1);
      else if (stelle < offset) von = Math.max(von, stelle + 1);
    }

    if (bis < offset || von > offset) return null;   // nichts mehr übrig
    return (von === span.from && bis === span.to) ? span : { from: von, to: bis };
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

    // Für den Rückfall in applyRemoteText mitschreiben
    letzteEigeneStelle.set(pageId, offset);

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
        lockAt: Number.isFinite(frisch.lockAt) ? frisch.lockAt : 0,

        /* Was die Anwesenheit sagt, bleibt daneben stehen – sie ist
           JÜNGER (150 ms statt 300 ms) und damit genauer, sobald sie zum
           hiesigen Text passt. Ob sie das tut, kann erst peopleOnPage
           entscheiden: dort liegt der Text. Siehe dort. */
        praesenz: (person.pageId === frisch.pageId
                   && Number.isFinite(person.offset) && person.offset >= 0)
          ? { offset: person.offset, cx: person.cx,
              lockFrom: person.lockFrom, lockTo: person.lockTo, lockAt: person.lockAt }
          : null
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

  // Maximaler Abstand, den ein gefundener Anker vom erwarteten Ort haben darf.
  // Liegt er weiter weg, ist es fast sicher der falsche Treffer.
  const CTY = 500;

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
  /**
   * Wie findeStelle, sagt aber ausdrücklich, wenn der Anker WEG ist.
   *
   * >>> Warum der Unterschied wichtig ist <<<
   * findeStelle gibt in zwei ganz verschiedenen Fällen dieselbe Zahl
   * zurück: „der Anker steht genau dort, wo er soll" und „der Anker ist
   * nirgends zu finden". Für die fremde Marke ist das einerlei – dort
   * ist die gemeldete Stelle der beste Schätzwert. Für die EIGENE Marke
   * nicht: verschwindet der Anker, weil die fremde Änderung mitten in
   * ihn hineingeschrieben hat, ist die alte Zahl gerade NICHT mehr
   * richtig, und es braucht den Umweg über den Textvergleich.
   *
   * @returns {number|null} null, wenn der Anker nicht wiederzufinden ist
   */
  function stelleAusAnker(text, pos, anker) {
    if (typeof anker !== 'string' || !anker) return null;

    /* Wie viele Zeichen des Ankers vor der Marke stehen. Das muss nicht
       mitgeschickt werden – es ergibt sich aus der Stelle selbst, weil
       der Absender genauso gerechnet hat. */
    const davor = Math.min(pos, CTX);
    const beginn = pos - davor;

    // Passt es dort, wo es soll? Der Normalfall, und er kostet fast nichts.
    if (text.slice(beginn, beginn + anker.length) === anker) return pos;

    // Sonst die nächstgelegene Fundstelle nehmen – aber nur,
    // wenn sie nah genug liegt. Sonst ist es ein Zufallstreffer
    // und die ursprüngliche Stelle ist der bessere Schätzwert.
    let beste = -1;
    let abstand = Infinity;
    for (let i = text.indexOf(anker); i !== -1; i = text.indexOf(anker, i + 1)) {
      const kandidat = i + davor;
      const d = Math.abs(kandidat - pos);
      if (d < abstand) { abstand = d; beste = kandidat; }
    }
    return (beste !== -1 && abstand <= CTY) ? beste : null;
  }

  function findeStelle(text, pos, anker) {
    const gefunden = stelleAusAnker(text, pos, anker);
    return gefunden === null ? pos : gefunden;
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

      /* ══════════════════════════════════════════════════════════════
         DIE JÜNGERE STELLE, ABER NUR WENN SIE ZU DIESEM TEXT PASST

         Beim Tippen gilt die Stelle aus der Textänderung (opCarets) –
         sie gehört zum selben Text und kann deshalb nicht danebenliegen.
         Sie ist aber bis zu 300 ms alt, und die Anwesenheit meldet alle
         150 ms. Wer den Cursor nur BEWEGT, ohne zu tippen, wurde dadurch
         bis zu 900 ms lang an seiner alten Stelle gezeigt: die Marke
         stand sichtbar hinter dem, was der andere tat.

         Übernommen wird die jüngere Stelle deshalb genau dann, wenn ihr
         Anker HIER wiederzufinden ist. Das ist der Beweis, dass sie sich
         auf denselben Text bezieht. Hat der andere inzwischen etwas
         getippt, das hier noch fehlt, enthält der Anker genau diese
         Zeichen – er wird nicht gefunden, und es bleibt bei der Stelle
         aus der Textänderung. Genau davor sollte der Vorrang schützen. */
      if (person.praesenz && person.praesenz.cx
          && stelleAusAnker(inhalt, person.praesenz.offset, person.praesenz.cx) !== null) {
        // Umgerechnet wird sie gleich darunter, wie jede andere auch –
        // dann wandert die Sperre um denselben Betrag mit.
        person = { ...person, ...person.praesenz };
      }

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
   * Verlässlich ist stattdessen, wo der Text tatsächlich umbricht.
   *
   * >>> Warum das NICHT mehr über caretRangeFromPoint geht <<<
   * Vorher wurde der Browser an den Rändern der Zeile gefragt: „welche
   * Stelle liegt an diesem Bildpunkt?" Das ist eine Trefferprüfung, und
   * die beachtet pointer-events. `.j-text` steht aber auf
   * `pointer-events: none`, sobald ein anderes Werkzeug als der Cursor
   * gewählt ist (css/pages.css und app.js) – der Punkt traf dann die
   * Seite DAHINTER, nicht den Text.
   *
   * Die Sperre fiel damit lautlos aus: gemeldet wurde keine, und beim
   * anderen blieb das zuletzt bekannte Band bis zum Ablauf des Nachlaufs
   * stehen – auf einer Zeile, an der längst niemand mehr schrieb. Genau
   * das war „das Band steht an der falschen Stelle". Dasselbe passierte,
   * sobald die Zeile aus dem Bild gescrollt war.
   *
   * Gemessen wird jetzt statt getroffen: zu einer Stelle liefert
   * caretRectAt die Mitte ihrer Bildschirmzeile. Zeichen derselben Zeile
   * haben dieselbe Mitte, und die Zeilennummer wächst mit der Stelle –
   * damit lässt sich der Anfang und das Ende der Zeile einschachteln.
   * Das hängt an keiner Maus und an keinem Bildausschnitt.
   *
   * >>> Zwei Zeilen: die eigene und die darauffolgende <<<
   * Wer schreibt, kommt gleich in der nächsten Zeile an – die gehört
   * deshalb dazu. Wichtig ist nur, dass das BAND genauso weit reicht wie
   * der gemeldete Bereich: hielt sich die Anzeige nicht daran, sah es
   * aus, als sei etwas gesperrt, was niemand anfasst.
   */
  /**
   * @param {number} [zeilenDanach=1] Wie viele Zeilen NACH der eigenen noch
   *   dazugehören. 1 ist der Anspruch beim Schreiben (eigene Zeile plus die
   *   nächste), 0 fragt nach der blossen Zeile, in der die Stelle liegt –
   *   das braucht ohneFremdeStellen, um die Zeile eines anderen ganz
   *   auszusparen und nicht nur den Punkt, an dem seine Marke gerade steht.
   */
  function visualLineSpan(textDiv, offset, zeilenDanach = 1) {
    const text = flatTextOf(textDiv);
    // Nie über den Absatz hinaus: ein Umbruch beendet die Sperre ohnehin
    const grenze = flatLineSpan(text, offset, zeilenDanach);

    const caret = caretRectAt(textDiv, offset, text);
    if (!caret) return null;

    const zoom = (typeof getZoom === 'function') ? getZoom() : 1;
    const lh = (parseInt(textDiv.style.lineHeight) || 32) * zoom;
    const mitte = caret.top + caret.height / 2;

    /** Mitte der Bildschirmzeile, auf der diese Stelle liegt. */
    const zeilenMitte = (stelle) => {
      let r = null;
      try { r = caretRectAt(textDiv, stelle, text); } catch (e) { return null; }
      return r ? r.top + r.height / 2 : null;
    };

    /* Anfang der eigenen Zeile: die früheste Stelle im Absatz, die noch
       dieselbe Zeilenmitte hat. Halbieren geht, weil die Zeile mit der
       Stelle nur wachsen kann. */
    let lo = grenze.from, hi = offset;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = zeilenMitte(mid);
      if (m !== null && Math.abs(m - mitte) < lh / 2) hi = mid;
      else lo = mid + 1;
    }
    const von = lo;

    /* Ende der Zeile DANACH: die späteste Stelle, die höchstens eine
       Zeilenhöhe tiefer sitzt. Gibt es keine nächste Zeile, bleibt es
       beim Ende der eigenen. */
    let lo2 = offset, hi2 = grenze.to;
    const untenBis = mitte + lh * (0.5 + zeilenDanach);
    while (lo2 < hi2) {
      const mid = (lo2 + hi2 + 1) >> 1;
      const m = zeilenMitte(mid);
      if (m !== null && m < untenBis) lo2 = mid;
      else hi2 = mid - 1;
    }
    const bis = lo2;

    if (bis < von) return null;

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

    /* Einmal bereinigen, und zwar HIER – der bereinigte Stand ist ab
       jetzt der Stand der Seite, im Datenmodell wie im DOM.

       >>> Warum beides dasselbe sein muss <<<
       Die Stellen der fremden Schreibmarken sind Zeichenzahlen im
       flachen Text, und der wird aus dem DOM gelesen (flatTextOf).
       Stünde im Modell etwas anderes als im DOM, zeigten alle Marken
       und Sperrbaender um die Differenz daneben – der Text saesse
       richtig, die Marke nicht. Genau dieses Fehlerbild.

       Im Normalfall aendert die Bereinigung ohnehin nichts; sie greift
       nur bei etwas, das der Editor nie erzeugt. Dann aber soll das
       Aufgeraeumte auch das sein, was gesichert wird. */
    const nextText = sanitizePageHtml(entry.ytext.toString());
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

    /* >>> Warum es einen Rückfall braucht <<<
       flatCaretPos gibt null zurück, sobald gerade keine Auswahl im Feld
       steht – nach einem vorigen Umbau, nach einem Klick daneben, nach
       einem Fensterwechsel. Dann wurde die Marke NICHT wiederhergestellt,
       und weil das Feld den Fokus behielt, setzte der Browser sie beim
       Austausch des Inhalts auf Stelle 0. Genau das war „mein Cursor
       springt an den Anfang der Zeile, in der der andere schreibt" –
       schreibt er in der ersten Zeile, ist Stelle 0 eben dort. Und das
       Nächste, was man tippte, landete mitten in seinem Satz.

       Deshalb die zuletzt bekannte eigene Stelle als Rückfall. */
    let caret = (hadFocus && typeof flatCaretPos === 'function')
      ? flatCaretPos(textDiv) : null;
    if (hadFocus && caret === null) {
      const gemerkt = letzteEigeneStelle.get(pageId);
      if (Number.isFinite(gemerkt)) caret = gemerkt;
    }

    /* Der Text VOR der fremden Änderung. Nur damit lässt sich hinterher
       ausrechnen, wohin die eigene Marke gewandert ist – siehe shiftedPos. */
    const vorher = (caret !== null && typeof flatTextOf === 'function')
      ? flatTextOf(textDiv) : null;

    /* Der Text kommt aus dem Raum, also von aussen – bereinigen, bevor
       er ins DOM geht. Der Yjs-Stand bleibt unangetastet: dort steht
       weiterhin, was der andere geschickt hat, sonst liefen die beiden
       Fassungen auseinander und jeder Abgleich schriebe hin und her. */
    entry.applying = true;
    textDiv.innerHTML = nextText;   // schon bereinigt, siehe oben
    entry.applying = false;

    /* Die Spaltenbreite der frei stehenden Absätze steht nicht im Text –
       sie ergibt sich aus der Lage der Nachbarn und wird deshalb bei
       jedem Einspielen neu gerechnet (canvas/text.js). Ohne das liefen
       zwei Absätze auf einer Zeile beim EMPFÄNGER ineinander, während
       sie beim Schreiber sauber nebeneinander stehen. */
    if (typeof ordneFreieAbsaetze === 'function') ordneFreieAbsaetze(textDiv);

    // Kommentar-Marken aus dem fremden Text wiederfinden
    if (pgEl && typeof ensureCommentsFromMarkers === 'function') {
      ensureCommentsFromMarkers(pgEl);
      if (typeof window.refreshComments === 'function') window.refreshComments();
    }

    if (hadFocus && caret !== null && typeof setFlatCaret === 'function') {
      let ziel = caret;
      const nachher = flatTextOf(textDiv);
      /* Den Anker VOR dem DOM-Tausch nehmen. Er sucht dieselben
         24 Zeichen im neuen Text – unabhängig davon, was sich sonst
         geändert hat. shiftedPos mit textDelta verschmolz dagegen
         lokale und fremde Änderungen zu einem Block, und die eigene
         Marke sprang zum fremden Text („Cursor beim anderen"). */
      /* ══════════════════════════════════════════════════════════════
         WOHIN DIE EIGENE MARKE GEHÖRT – ZWEI WEGE, IN DIESER REIHENFOLGE

         Hier stand nur der Anker, und davor stand nur der Vergleich.
         Jeder für sich hat eine Lücke, und beide Lücken sind gemeldet
         worden.

         1. DER ANKER. Die zwölf Zeichen um die Marke im neuen Text
            wiederfinden. Das ist die genaueste Auskunft, die es gibt –
            solange es die Zeichen noch gibt.

            Seine Lücke: er wurde nur gesucht, wenn die Marke NICHT am
            Ende stand (`caret < vorher.length`). Genau dort steht sie
            aber meistens, man schreibt ja vorwärts. Die Stelle blieb
            dann dieselbe ZAHL, während der Text durch die fremde
            Änderung länger wurde – die Marke stand plötzlich mittendrin,
            und zwar dort, wo der andere gerade tippt.

         2. DER VERGLEICH (shiftedPos). Er sagt, wie weit sich alles
            hinter der Änderung verschoben hat.

            Seine Lücke war, dass Eigenes und Fremdes zu EINEM Block
            verschmolzen – deshalb steht flushPending() weiter oben: das
            Eigene ist da längst eingetragen, der Unterschied zwischen
            vorher und nachher ist also genau die fremde Änderung.

         Der Anker gewinnt, wenn er wiederzufinden ist. Schreibt der
         andere mitten in ihn hinein, gibt es ihn nicht mehr – dann
         zählt der Vergleich. */
      if (vorher !== null && vorher !== nachher) {
        try {
          const ausAnker = stelleAusAnker(nachher, caret, ankerAt(vorher, caret));
          ziel = (ausAnker !== null) ? ausAnker : shiftedPos(vorher, nachher, caret);
        } catch (e) { /* bleibt caret */ }
      }
      let gesetzt = false;
      try { gesetzt = setFlatCaret(textDiv, ziel); } catch (e) { gesetzt = false; }

      /* Ließ sich die Stelle nicht setzen, steht die Marke jetzt auf 0 –
         der Browser hat sie beim Austausch des Inhalts dorthin gelegt.
         Dort weiterzutippen hieße, in den Satz des anderen zu schreiben.
         Lieber den Fokus abgeben: dann tut die nächste Taste nichts, statt
         etwas Falsches. */
      if (!gesetzt) {
        try { textDiv.blur(); } catch (e) { /* egal */ }
      } else {
        letzteEigeneStelle.set(pageId, ziel);
      }
      merkeCaretLauf(vorher, nachher, caret, ziel, textDiv);
    } else if (hadFocus) {
      // Fokus im Feld, aber keine bekannte Stelle – siehe oben
      try { textDiv.blur(); } catch (e) { /* egal */ }
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
  /* Ein kurzer Fingerabdruck statt des ganzen Strichs.
     Hier lag vorher die volle JSON-Zeichenkette jedes Strichs im Set –
     bei einer langen Sitzung mit viel Handschrift sind das schnell
     einige Megabyte, die bis zum Verlassen des Raums liegen bleiben.
     Gebraucht wird aber nur „schon gesehen oder nicht", und dafuer
     genuegt eine Zahl. FNV-1a, dieselbe Rechnung wie in core/share.js. */
  function strichAbdruck(stroke) {
    const roh = JSON.stringify(stroke);
    let hash = 0x811c9dc5;
    for (let i = 0; i < roh.length; i++) {
      hash ^= roh.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(36) + ':' + roh.length;
  }

  function inkSignatures(pageId) {
    let set = inkSeen.get(pageId);
    if (!set) {
      set = new Set((S.strokeHistory[pageId] || []).map(strichAbdruck));
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
    const key = strichAbdruck(stroke);
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
      /* Kommentare gehören mit hinein. Sie standen bisher NICHT im
         Vergleich: die Markierung im Text reiste über Yjs mit, der
         Kommentar selbst blieb zurück – beim anderen stand die Stelle
         markiert da, und dazu ein leerer Eintrag von „Unbekannt"
         (core/comments.js, ensureCommentsFromMarkers). */
      struct: JSON.stringify({
        sections: nb.sections || [],
        name: nb.name || '',
        color: nb.color || '',
        defaultBg: nb.defaultBg || '',
        comments: echteKommentare(nb)
      })
    };
  }

  /* ══════════════════════════════════════════════════════════════════
     NUR ECHTE KOMMENTARE GEHEN HINAUS

     Ein Platzhalter ist kein Inhalt, sondern das Eingeständnis, dass uns
     einer fehlt (core/comments.js). Ihn zu verschicken kann nur schaden:
     beim anderen liegt das Original, und unser leerer Eintrag würde es
     überschreiben.

     Er wird auch nicht in den Vergleich aufgenommen – sonst löste allein
     sein Entstehen einen Struktur-Takt aus, der nichts überträgt.
     ══════════════════════════════════════════════════════════════════ */
  function echteKommentare(nb) {
    const alle = Array.isArray(nb && nb.comments) ? nb.comments : [];
    if (typeof istPlatzhalterKommentar !== 'function') return alle;
    return alle.filter(c => !istPlatzhalterKommentar(c));
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
        // Das Etikett gleich mitschicken: sonst haengt die neue Seite beim
        // anderen bis zum folgenden st-Op im falschen Ausschnitt
        secId: page.secId || '',
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

    // 4. Abschnitte, Reihenfolge, Heftangaben, Kommentare
    if (now.struct !== snapshot.struct || now.order !== snapshot.order) {
      sendLive('st', '*', {
        sections: liveNb.sections || [],
        order: (liveNb.pages || []).map(p => String(p.id)),
        name: liveNb.name || '',
        color: liveNb.color || '',
        defaultBg: liveNb.defaultBg || '',
        // Ohne Platzhalter – siehe echteKommentare()
        comments: echteKommentare(liveNb)
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
    // Das Etikett kommt mit dem Op mit – siehe base in doSyncStructure
    if (incoming.secId) page.secId = String(incoming.secId);

    const at = Number.isInteger(data.index) ? data.index : (liveNb.pages || []).length;
    liveNb.pages.splice(Math.max(0, Math.min(at, liveNb.pages.length)), 0, page);
    if (typeof syncSectionIds === 'function') syncSectionIds(liveNb);

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
    if (typeof syncSectionIds === 'function') syncSectionIds(liveNb);
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
    inkSeen.set(pageId, new Set(strokes.map(strichAbdruck)));

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
        defaultBg: sec.defaultBg || liveNb.defaultBg || 'ruled',
        /* Ohne diese Zeile ginge eine selbst gewaehlte Farbe bei jedem
           Struktur-Abgleich still verloren – hier wird feldweise neu
           gebaut, was nicht aufgezaehlt ist, faellt weg. Leer heisst
           "nicht gewaehlt", dann rechnet colorForSection eine aus. */
        color: sec.color || ''
      }));

      /* >>> Die Etiketten reisen in den pgIds mit <<<
         Seit Abschnitte Etiketten sind, steht die Zugehoerigkeit an der
         Seite (page.secId). pgIds wird daraus nur noch abgeleitet – aber
         genau deshalb traegt der Struktur-Op sie weiterhin, und hier
         lassen sie sich zurueckrechnen. Das Uebertragungsprotokoll
         brauchte dafuer keine Aenderung, und ein Stand ohne den Umbau
         versteht denselben Op unveraendert. */
      const etikett = new Map();
      for (const sec of data.sections) {
        for (const pgId of (sec.pgIds || [])) etikett.set(String(pgId), String(sec.id));
      }
      for (const page of (liveNb.pages || [])) {
        const next = etikett.get(String(page.id)) || '';
        if (next) page.secId = next; else delete page.secId;
      }
    }
    if (typeof data.name === 'string' && data.name) liveNb.name = data.name;
    if (typeof data.color === 'string' && data.color) liveNb.color = data.color;
    if (typeof data.defaultBg === 'string' && data.defaultBg) liveNb.defaultBg = data.defaultBg;

    /* ══════════════════════════════════════════════════════════════
       KOMMENTARE

       Die Markierung im Text reist über Yjs mit, der Kommentar selbst
       nicht: beim anderen stand die Stelle farbig da und dazu ein leerer
       Eintrag von „Unbekannt" (core/comments.js baut den aus der
       Markierung, damit wenigstens etwas da ist). Jetzt kommt der Text
       mit – feldweise übernommen, nicht mit der eigenen Liste
       verschmolzen: der Absender hat den vollständigen Stand, und zwei
       Listen zu vereinen hiesse, Gelöschtes wiederauferstehen zu lassen.
       ══════════════════════════════════════════════════════════════ */
    if (Array.isArray(data.comments)) {
      const meine = new Map((liveNb.comments || []).map(c => [String(c.id), c]));

      liveNb.comments = data.comments.map(c => {
        const id = String(c.id);
        const fremd = {
          id,
          pageId: String(c.pageId || ''),
          text: String(c.text || ''),
          zitat: String(c.zitat || ''),
          author: c.author && typeof c.author === 'object'
            ? { uid: String(c.author.uid || ''), name: String(c.author.name || '') }
            : { uid: '', name: '' },
          created: Number(c.created) || Date.now(),
          edited: Number(c.edited) || 0,
          resolved: !!c.resolved,
          replies: Array.isArray(c.replies) ? c.replies : []
        };

        /* ── Ein Platzhalter darf ein Original NICHT verdrängen ──────
           >>> Der Fehler, den das behebt <<<
           Beide Seiten schicken die GANZE Kommentarliste, und hier wurde
           sie eins zu eins übernommen. Der Ablauf war:

             1. Ich schreibe einen Kommentar. Die Markierung geht sofort
                über Yjs hinaus, die Kommentardaten erst mit dem nächsten
                Struktur-Takt.
             2. Der andere sieht die Markierung ohne Kommentar und baut
                sich einen Platzhalter: ohne Text, ohne Autor.
             3. SEIN Struktur-Takt läuft ab und schickt mir seine Liste –
                mit dem Platzhalter darin.
             4. Meine Liste wird dadurch ersetzt. Mein eigener Kommentar
                stand ab da bei MIR als „Unbekannt" da, ohne Text und
                ohne Bearbeiten-Knopf, während der andere längst meinen
                Namen sah.

           Genau so wurde es gemeldet. Deshalb: hat der Absender nur
           einen Platzhalter und ich das Original, behalte ich meins. */
        const alt = meine.get(id);
        if (alt && istPlatzhalterKommentar(fremd) && !istPlatzhalterKommentar(alt)) {
          return alt;
        }
        return fremd;
      });
      if (typeof window.refreshComments === 'function') window.refreshComments();
    }

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

    /* Der eigene Ausschnitt bleibt der eigene – es sei denn, es gibt ihn
       nicht mehr. Dann zurueck auf "alle Seiten" statt auf irgendeinen
       fremden Abschnitt. */
    if (liveNb.activeSecId && !(liveNb.sections || []).some(s => s.id === liveNb.activeSecId)) {
      liveNb.activeSecId = '';
    }

    // Die abgeleiteten pgIds wieder in Deckung bringen
    if (typeof syncSectionIds === 'function') syncSectionIds(liveNb);

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

    /* >>> Der Ausschnitt bleibt der, auf den DIESE Ansicht eingestellt ist <<<
       Hier stand ein Rueckfall auf sections[0], und darunter ein Ausstieg,
       falls es gar keinen Abschnitt gibt. Beides stammt aus der Zeit, als
       immer ein Abschnitt offen sein musste. Seit Abschnitte Etiketten
       sind, ist activeSecId === '' der Normalfall und openSection(null)
       heisst "alle Seiten" – und damit war beides falsch:

         · Heft OHNE Abschnitte: sec blieb undefined, der Aufbau wurde
           uebersprungen. Legte der andere eine Seite an, loeschte eine
           oder sortierte um, sah man davon nichts.
         · Heft MIT Abschnitten, Ansicht auf "alle Seiten": der Rueckfall
           zog einen still in den ERSTEN Abschnitt.

       activeSection() liefert genau das Richtige, null eingeschlossen. */
    const sec = (typeof activeSection === 'function') ? activeSection(liveNb) : null;

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
   * @param {Function} [opts.onOwnerAway]  Rückruf, wenn der Kontakt zum Besitzer fehlt
   */
  async function start(id, notebook, crdt, canEdit, opts = {}) {
    await stop();
    docId = id;
    ownerUidJetzt = String(opts.ownerUid || '');
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
      room = await window.InkwellsShare.joinDocRoom(id, {
        isOwner: !!opts.isOwner,
        ownerUid: opts.ownerUid || '',
        /* Der Name des Live-Raums aus dem Kopf. Ohne Angabe ist es die
           Dokumentkennung – so laufen alle bestehenden Dokumente weiter.
           Warum es ihn gibt: siehe roomKey in core/share.js. */
        roomKey: opts.roomKey || '',
        // Nur der Besitzer schreibt sie – siehe database.rules.json
        memberUids: opts.memberUids || {}
      });
      lastError = '';

      /* Ab jetzt folgt der Streifen der Leitung. null heisst "noch nichts
         gehoert" - dann wird nichts gemeldet, sonst blitzte bei jedem
         Betreten kurz eine Warnung auf. */
      verbindungSteht = null;
      if (typeof room.onConnection === 'function') {
        stopVerbindung = room.onConnection((steht) => {
          verbindungSteht = steht;
          showLiveState();
        });
      }
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

    /* Der Chat hängt am Raum und nicht am Dokument: erst hier gibt es
       jemanden, mit dem man reden könnte. ui/chat.js meldet sich damit
       für Nachrichten und Tipp-Anzeige an. */
    if (window.ChatUI && typeof window.ChatUI.attach === 'function') {
      try { window.ChatUI.attach(room); }
      catch (err) { console.warn('[Collab] Chat nicht angeschlossen:', err?.message || err); }
    }

    /* >>> Ohne Kontakt zum Besitzer wird nur gelesen <<<
       Egal ob ihm die Leitung abgerissen ist, er die App zugemacht hat,
       oder die EIGENE Verbindung fehlt: ohne gesicherten Kontakt könnte
       der Besitzer gerade örtlich weiterschreiben, ohne dass es jemand
       mitbekommt. Würde hier gleichzeitig geändert, gäbe es beim
       Wiederverbinden zwei Fassungen derselben Seite. Solange der Kontakt
       fehlt, wird deshalb nur gelesen; kehrt er zurück, ebenso von selbst
       wieder zurück. Erklärung in core/share.js (onOwnerAway).

       canEdit bleibt dabei unangetastet: es ist das dauerhafte Recht, das
       der Besitzer vergeben hat. Hier wird es nur vorübergehend nicht
       ausgeübt. */
    /* Mit ?. gefragt: eine ältere core/share.js kennt onOwnerAway noch
       nicht. Dann bleibt es beim bisherigen Verhalten – lieber ohne diese
       Sperre als gar kein Live-Betrieb. */
    room.onOwnerAway?.((away) => {
      setCanWrite(!!canEdit && !away);
      try { opts.onOwnerAway?.(!!away); }
      catch (err) { console.warn('[Collab] Rückmeldung zur Erreichbarkeit:', err); }
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
    /* Und beim selben Anlass: eine Marke, die in einer gesperrten Zeile
       gelandet ist, wieder herausschieben (haltCaretAusSperre). */
    const beiAuswahl = () => { haltCaretAusSperre(true); reportCaret(); };
    document.addEventListener('selectionchange', beiAuswahl);
    stops.push(() => document.removeEventListener('selectionchange', beiAuswahl));

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
      /* Auch ohne eigenes Zutun kann die Marke in eine Sperre geraten:
         der andere beansprucht die Zeile, in der sie gerade steht. Ohne
         Hinweis – dieser Takt läuft, ob man etwas tut oder nicht. */
      haltCaretAusSperre(false);
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

    /* Den Chat als Erstes abhängen: er hält eigene Beobachter am Raum,
       und der wird gleich verlassen. */
    if (window.ChatUI && typeof window.ChatUI.detach === 'function') {
      try { window.ChatUI.detach(); } catch (e) {}
    }

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

    // Die Beobachtung der Leitung ebenfalls abbestellen
    if (typeof stopVerbindung === 'function') { try { stopVerbindung(); } catch (e) {} }
    stopVerbindung = null;
    verbindungSteht = null;
    reloading.clear();
    typedAt.clear();
    letzteEigeneStelle.clear();
    liveNb = null;
    snapshot = null;

    for (const undo of stops) { try { undo(); } catch (e) {} }
    stops = [];

    if (room) { try { await room.leave(); } catch (e) {} }
    room = null;
    docId = null;
    ownerUidJetzt = '';
    others = [];

    for (const entry of docs.values()) { try { entry.ydoc.destroy(); } catch (e) {} }
    docs.clear();
    inkSeen.clear();
    opCarets.clear();

    document.querySelectorAll('.collab-marker, .collab-caret, .collab-lock').forEach(el => el.remove());
    // Die Merkzettel der wiederverwendeten Elemente zeigen sonst ins Leere
    caretEls.clear();
    lockEls.clear();
    const bar = E('collab-people');
    if (bar) { bar.innerHTML = ''; bar.style.display = 'none'; }
  }

  /* ── Meldungen aus dem Editor ─────────────────────────────────────── */

  /* ══════════════════════════════════════════════════════════════════
     DER TAKT IST EINE DROSSEL, KEINE ENTPRELLUNG

     Hier stand ein clearTimeout + setTimeout(300) je Anschlag – also
     eine ENTPRELLUNG: jeder weitere Buchstabe stellte die Uhr zurück.
     Wer durchschreibt, tippt aber schneller als alle 300 ms, und damit
     ging während des Schreibens ÜBERHAUPT NICHTS hinaus. Beim anderen
     erschien der Text erst, wenn man eine Pause machte – gemeldet als
     „das Schreiben ist laggy, es dauert, bis etwas kommt". Im Prüfstand
     (scripts/test-collab-live) kam bei zwei Sekunden Dauertippen kein
     einziges Zeichen an.

     Richtig ist eine Drossel mit sofortigem ersten Schlag: der erste
     Anschlag geht gleich raus, alles Weitere höchstens alle 300 ms.
     Damit sieht der andere das erste Zeichen ohne Verzögerung und
     danach viermal je Sekunde den neuen Stand.
     ══════════════════════════════════════════════════════════════════ */
  const flushTimers = new Map();
  const pendingText = new Map();
  const lastFlush = new Map();      // pageId -> wann zuletzt hinausgegangen

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

    const seit = Date.now() - (lastFlush.get(pageId) || 0);
    if (seit >= TEXT_FLUSH_MS) {
      flushPending(pageId);
      // Beim Tippen wandert auch die eigene Schreibmarke
      reportCaret();
      return;
    }

    /* Läuft schon einer, bleibt es dabei – ihn zurückzustellen wäre
       genau die Entprellung, die nichts mehr durchließ. */
    if (flushTimers.has(pageId)) return;
    flushTimers.set(pageId, setTimeout(() => {
      flushPending(pageId);
      reportCaret();
    }, TEXT_FLUSH_MS - seit));
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

    // Auch ohne Wartendes: der Takt zählt ab jetzt neu
    lastFlush.set(pageId, Date.now());

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
   * Die fremden Marken, so knapp wie möglich – zum Abfotografieren.
   *
   * Die entscheidende Spalte ist `hierSteht`: der Text an der Stelle, die
   * der andere gemeldet hat, aus MEINEM Text geschnitten. Tippt er gerade
   * „Hallo" und hier steht an seiner Stelle etwas anderes, dann ist die
   * ZAHL falsch – die Texte der beiden Seiten sind auseinander. Steht
   * dort das Richtige, die Marke sitzt aber trotzdem woanders, dann liegt
   * es an der Umrechnung in Bildpunkte.
   */
  function zeigeFremdeMarken() {
    const leute = peopleNow();
    if (!leute.length) { console.log('[Collab] Gerade ist niemand sonst da.'); return; }

    const zeilen = leute.map(person => {
      const pgEl = document.querySelector('[data-pgid="' + cssEscapeId(person.pageId || '') + '"]');
      const td = pgEl ? pgEl.querySelector('.j-text') : null;
      const txt = td ? flatTextOf(td) : null;
      const roh = person.offset;

      // Die Stelle, wie sie nach der Anker-Umrechnung wirklich gilt
      const hier = (td && Number.isFinite(roh) && roh >= 0)
        ? (peopleOnPage(person.pageId, td).find(p => p.uid === person.uid) || person).offset
        : roh;

      let wo = '(nicht im Text)';
      let zeile = null, spalte = null;
      if (txt !== null && Number.isFinite(hier) && hier >= 0) {
        wo = JSON.stringify(txt.slice(Math.max(0, hier - 12), hier))
           + ' ▏ ' + JSON.stringify(txt.slice(hier, hier + 12));
        try {
          const rect = caretRectAt(td, hier, txt);
          if (rect) {
            const zoom = (typeof getZoom === 'function') ? getZoom() : 1;
            const box = lineBoxOf(pgEl, td, rect, zoom);
            const lh = parseInt(td.style.lineHeight) || 32;
            const oben = 64 + (parseFloat(td.style.paddingTop) || 0);
            zeile = Math.round((box.top - oben) / lh);
            spalte = Math.round(box.left);
          }
        } catch (e) { /* egal */ }
      }

      return {
        wer: person.name || person.email || '?',
        gemeldet: roh,
        giltHier: hier,
        verschoben: (Number.isFinite(hier) && Number.isFinite(roh)) ? hier - roh : null,
        textLaenge: txt === null ? null : txt.length,
        ueberDasEnde: txt !== null && Number.isFinite(hier) && hier > txt.length,
        hierSteht: wo,
        zeile, spalteInPx: spalte,
        sperre: (Number.isFinite(person.lockFrom) && person.lockFrom >= 0)
          ? person.lockFrom + '–' + person.lockTo : 'keine'
      };
    });

    console.table(zeilen);
    console.log('[Collab] Stimmt „hierSteht" mit dem überein, was der andere gerade '
      + 'tippt? Wenn nein, ist die gemeldete ZAHL falsch. Wenn ja, die Umrechnung.');
    return zeilen;
  }

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
    /* >>> Warum das auch OHNE eigene Marke laufen muss <<<
       Die wichtigste Frage ist „wo sitzt die Marke des ANDEREN und stimmt
       das?", und dabei sieht man ihm zu, statt selbst zu tippen. Vorher
       stieg die Prüfung genau dann aus („erst in den Text klicken") und
       war für den einen Fall unbrauchbar, für den sie gebraucht wird.
       Ohne eigene Marke wird jetzt nur der eigene Teil übersprungen. */
    let textDiv = document.activeElement;
    if (!textDiv || !textDiv.classList || !textDiv.classList.contains('j-text')) {
      textDiv = null;
    }
    if (!textDiv) {
      zeigeFremdeMarken();
      return null;
    }

    const pgEl = textDiv.closest('[data-pgid]');
    const sel = window.getSelection();
    if (!pgEl || !sel || !sel.rangeCount) { zeigeFremdeMarken(); return null; }

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

  /**
   * Die Rollenliste des Raums nachziehen (nur beim Besitzer). Wird
   * gerufen, sobald sich der Kopf des Dokuments aendert – etwa weil
   * jemand neu dazugekommen ist und seine Kennung eingetragen hat.
   */
  function refreshRoomRoles(rollen) {
    if (!room || typeof room.setRoles !== 'function') return;
    room.setRoles(rollen).catch(err =>
      console.warn('[Collab] Rollen nicht aufgefrischt:', err?.message || err));
  }

  window.Collab = {
    start, stop, setCanWrite, refreshRoomRoles,
    noteTextChange, noteStroke, notePage, noteChange,
    stateFor, isLive, renderMarkers, renderCarets, renderLocks, status, checkCaret,
    /* Wer außer einem selbst gerade da ist – flach kopiert, damit
       niemand von außen in die laufende Liste hineinschreibt. Der Chat
       braucht daraus Name, Initialen und Farbe. */
    people: () => others.map(p => ({
      uid: p.uid, name: p.name, email: p.email,
      initials: p.initials, color: p.color
    })),
    // Nur die fremden Marken – die Tabelle zum Abfotografieren
    fremdeMarken: zeigeFremdeMarken,
    // Zeilensperre – app.js fragt vor jeder Eingabe nach
    editBlockedBy, warnLocked, lockOwner, caretOf,
    // ... und canvas/input.js vor jedem Klick, siehe dort
    trifftSperrband, markeWeg,
    // Sofort abgleichen, ohne auf den Takt zu warten (Tests, Schließen)
    syncNow: syncStructure,
    // Fehlersuche: was fremde Anschläge mit der eigenen Marke gemacht haben
    caretLog: zeigeCaretLog,
    /* Welches Dokument gerade offen ist, und wem es gehoert. ui/melden.js
       braucht beides: die Meldung nennt das Dokument, und nur ueber
       ownerUid darf der Besitzer sie spaeter lesen
       (website/firestore.rules). */
    offenesDokument: () => (docId ? { docId, ownerUid: ownerUidJetzt } : null),
    // offengelegt für scripts/test-collab-text.js
    _textDelta: textDelta,
    _shiftedPos: shiftedPos,
    _seedUpdate: seedUpdate
  };
})();
