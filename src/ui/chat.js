'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DAS GESPRÄCH NEBEN DEM DOKUMENT

   Wer zu zweit an einem Heft schreibt, will zwischendurch etwas sagen,
   das NICHT im Heft stehen soll: „schau mal auf Seite 4", „ich mach den
   Rest morgen". Bisher gab es dafür nur den Kommentar – der klebt aber
   an einer Textstelle, bleibt stehen und gehört zum Dokument.

   ── Wo er sitzt ────────────────────────────────────────────────────
   Die Ikone steht in der Leiste über dem Dokument, gleich neben den
   Abzeichen der Anwesenden. Sie ist nur da, solange auch sonst jemand da
   ist: mit sich selbst redet niemand, und ein Knopf, hinter dem nichts
   sein kann, ist schlimmer als keiner.

   Die Leiste selbst ist die der Kommentare, noch einmal – gleiche
   Breite, gleiche Kante, gleiches Aufgehen. Beide schließen einander
   aus: nebeneinander bliebe vom Blatt nichts übrig, und wer den Chat
   offen hat, liest gerade keine Kommentare. Solange der Chat offen ist,
   geht die Kommentarleiste deshalb nicht auf (window.chatBlocksComments
   fragt ui/comments.js).

   ── Wer gerade tippt ───────────────────────────────────────────────
   Wie beim Telefon: die Abzeichen derer, die gerade schreiben, und
   daneben drei wandernde Punkte. Sich selbst sieht man nie – man weiß,
   dass man tippt.

   Gemeldet wird beim Anschlag, aufgefrischt höchstens alle
   TIPP_TAKT_MS. Das Ende kommt auf zwei Wegen: ausdrücklich, sobald man
   aufhört oder abschickt, und von selbst, wenn nichts mehr aufgefrischt
   wird (CHAT_TYPING_TTL_MS in core/share.js). Der zweite Weg ist der
   wichtige – der erste kommt bei einer abgerissenen Leitung nie an.

   ── Was hier NICHT ist ─────────────────────────────────────────────
   Keine Bilder, keine Formatierung, keine Verweise. Das Eingabefeld ist
   ein <textarea> und kein contenteditable, damit das gar nicht erst
   hineingeraten kann. Was Bestand haben soll, gehört ins Dokument.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  /* Höchstens so oft wird „ich tippe" aufgefrischt. Die Anzeige verfällt
     nach 6 s (core/share.js) – hier ist also reichlich Luft. */
  const TIPP_TAKT_MS = 2000;
  /* Und so lange nach dem letzten Anschlag gilt man als fertig. */
  const TIPP_ENDE_MS = 2500;

  const MAX_LEN = 800;

  const txt = (key, ersatz) => (typeof t === 'function' && t(key)) || ersatz;

  let raum = null;          // der Live-Raum, solange einer läuft
  let stopChat = null;
  let stopWeg = null;
  let stopTipp = null;
  let stopStatus = null;

  /* Ab wann eine Nachricht als „neu" gilt. Alles davor ist der
     Rückstand, den der Strom beim Anmelden nachliefert – der gehört in
     die Liste, aber nicht in eine Windows-Meldung. */
  let angeschlossenSeit = 0;

  /* Leer heißt: er läuft. Sonst der Grund, warum nicht – siehe
     onChatStatus in core/share.js. */
  let gesperrt = '';

  /* Was schon angezeigt wird. Firebase liefert jede Nachricht genau
     einmal – aber der Strom meldet sich nach einem Abbruch neu an und
     holt dabei denselben Rückstand noch einmal. Ohne diese Liste stünde
     danach alles doppelt da. */
  const gesehen = new Set();

  // Ungelesenes, solange die Leiste zu ist – für den Punkt an der Ikone
  let ungelesen = 0;

  const el = (id) => document.getElementById(id);

  /* ── Auf und zu ───────────────────────────────────────────────────── */

  function leiste() { return el('chat-panel'); }
  function offen() { return !!leiste() && leiste().classList.contains('open'); }

  /* ui/comments.js fragt das, bevor es seine eigene Leiste aufmacht. */
  window.chatBlocksComments = offen;

  function setzeOffen(auf) {
    const p = leiste();
    if (!p || p.classList.contains('open') === auf) return;

    /* Zuerst die andere zumachen. Andersherum stünden beide einen
       Wimpernschlag lang nebeneinander, und das Blatt spränge zweimal. */
    if (auf && typeof window.closeCommentPanel === 'function') {
      window.closeCommentPanel();
    }

    p.classList.toggle('open', auf);

    if (auf) {
      ungelesen = 0;
      zeichneIkone();
      nachUnten();
      setTimeout(() => el('chat-input')?.focus(), 220);
    } else {
      melde(false);
    }

    /* Die Blattspalte wird schmaler: der Zoom passt die Seite neu ein.
       Dieselbe Verzögerung wie bei der Kommentarleiste – erst wenn die
       Bewegung durch ist, stimmt die Breite. Die Kommentarkarten hängen
       am selben Maß und werden mit neu gesetzt. */
    setTimeout(() => {
      if (typeof _applyZoom === 'function') _applyZoom();
      if (typeof window.refreshComments === 'function') window.refreshComments();
    }, 220);
  }

  el('chat-open')?.addEventListener('click', () => setzeOffen(!offen()));
  el('chat-close')?.addEventListener('click', () => setzeOffen(false));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !offen()) return;
    /* In Schritten zurück: erst den Bezug, dann den Satz, dann die
       Leiste. Sonst wäre ein versehentliches Escape ein verlorener
       Satz – und ein zweites Escape schliesst ja weiterhin. */
    if (antwortAuf) { setzeAntwort(null); return; }
    const feld = el('chat-input');
    if (feld && feld.value.trim()) { feld.value = ''; passeHoeheAn(); return; }
    setzeOffen(false);
  });

  /* ── Die Ikone ────────────────────────────────────────────────────── */

  function jemandDa() {
    if (!raum) return false;
    const leute = (window.Collab && typeof Collab.people === 'function')
      ? Collab.people() : [];
    return leute.length > 0;
  }

  function zeichneIkone() {
    const knopf = el('chat-open');
    if (!knopf) return;

    const zeigen = jemandDa();
    knopf.style.display = zeigen ? 'inline-flex' : 'none';
    knopf.classList.toggle('aktiv', offen());

    /* Geht der Letzte, geht auch die Leiste. Eine offene Leiste ohne
       Gegenüber sähe aus, als warte man auf eine Antwort. */
    if (!zeigen && offen()) setzeOffen(false);

    const punkt = el('chat-open-dot');
    if (punkt) punkt.style.display = (!offen() && ungelesen > 0) ? 'block' : 'none';
  }
  // renderPresenceBar in ui/collab.js ruft das bei jeder Änderung
  function refresh() { zeichneIkone(); }

  /* ── Nachrichten ──────────────────────────────────────────────────── */

  /** „14:32" – mehr braucht ein Gespräch von heute nicht. */
  function uhrzeit(ts) {
    const d = new Date(ts || Date.now());
    const spr = (typeof getLanguage === 'function' ? getLanguage() : 'de');
    try {
      return new Intl.DateTimeFormat(spr, { hour: '2-digit', minute: '2-digit' }).format(d);
    } catch (err) {
      return d.toLocaleTimeString();
    }
  }

  /** Gleiche Farbe wie überall sonst; fehlt sie, aus der Kennung. */
  function farbeFuer(m) {
    if (m.color) return m.color;
    let h = 0;
    const s = String(m.uid || '?');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ' 62% 58%)';
  }

  /**
   * Ein Knopf mit einem Sinnbild aus einer Vorlage in index.html.
   *
   * >>> Warum nicht einfach innerHTML mit dem SVG <<<
   * Weil in dieser Datei NICHTS über innerHTML gesetzt wird – hier
   * kommt fremder Text herein, und eine Ausnahme „nur für dieses eine
   * feste SVG" ist genau die Sorte Regel, an der später jemand
   * vorbeirutscht. Geprüft wird das in scripts/test-neue-teile.js.
   */
  function knopfMitBild(vorlageId, klassen, name) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = klassen;
    btn.title = name;
    const vorlage = el(vorlageId);
    if (vorlage && vorlage.content) btn.appendChild(vorlage.content.cloneNode(true));
    return btn;
  }

  function baueZeile(m) {
    const zeile = document.createElement('div');
    zeile.className = 'chat-msg' + (m.selbst ? ' selbst' : '');
    zeile.dataset.mid = m.id;
    // Für den Antwort-Knopf: was zitiert würde, steht am Element selbst
    zeile._nachricht = m;

    /* Das Abzeichen steht NEBEN der Nachricht, nicht darüber: wer
       darauf zeigt, sieht den Namen. Er noch einmal ausgeschrieben über
       jeder Zeile wäre bei einem Gespräch zu zweit nur Lärm. */
    const kreis = document.createElement('span');
    kreis.className = 'chat-face';
    kreis.style.background = farbeFuer(m);
    kreis.textContent = m.initials || '?';
    kreis.title = m.name || (m.selbst ? txt('collabYou', 'du') : '?');

    const blase = document.createElement('div');
    blase.className = 'chat-bubble';

    /* ══════════════════════════════════════════════════════════════
       DAS ZITAT ÜBER DER ANTWORT

       In der Blase und nicht daneben: es gehört zu dieser Nachricht,
       nicht zwischen zwei. Ein Klick springt zur gemeinten Zeile –
       solange es sie noch gibt. Nach einem Tag ist sie weg
       (CHAT_MAX_AGE_MS), und dann bleibt eben der Ausschnitt stehen,
       der mitgereist ist.
       ══════════════════════════════════════════════════════════════ */
    if (m.antwort) {
      const zitat = document.createElement('button');
      zitat.type = 'button';
      zitat.className = 'chat-zitat';

      const wer = document.createElement('span');
      wer.className = 'chat-zitat-wer';
      wer.textContent = m.antwort.name || txt('chatSomeone', 'Jemand');

      const was = document.createElement('span');
      was.className = 'chat-zitat-text';
      was.textContent = m.antwort.text || '';

      zitat.append(wer, was);
      zitat.addEventListener('click', () => springeZu(m.antwort.id));
      blase.appendChild(zitat);
    }

    const text = document.createElement('div');
    text.className = 'chat-text';
    // textContent und nicht innerHTML: hier kommt fremder Text herein
    text.textContent = m.text;

    const zeit = document.createElement('span');
    zeit.className = 'chat-time';
    zeit.textContent = uhrzeit(m.at);

    blase.append(text, zeit);

    /* ══════════════════════════════════════════════════════════════
       ANTWORTEN UND ZURÜCKNEHMEN

       Zwei kleine Knöpfe neben der Blase. Mit der Maus erscheinen sie
       beim Darüberfahren – dauerhaft sichtbar wären sie Lärm in einem
       Gespräch, in dem die meisten Zeilen keiner Bedienung bedürfen.

       Mit dem Finger gibt es kein Darüberfahren: dort stehen sie von
       selbst da (css/pages.css fragt body.touch-input und das
       Hochformat, dieselbe Regel wie beim Punkteknopf der Heftkarte).

       Zurücknehmen gibt es nur an der eigenen Zeile. Fremdes zu
       löschen ist keine Bedienung, die in ein Gespräch gehört – und
       die Regeln in der Datenbank liessen es ohnehin nicht zu.
       ══════════════════════════════════════════════════════════════ */
    const aktionen = document.createElement('div');
    aktionen.className = 'chat-akt';

    const antworten = knopfMitBild('chat-icon-antwort', 'chat-akt-btn',
      txt('chatReply', 'Antworten'));
    antworten.addEventListener('click', () => setzeAntwort(m));
    aktionen.appendChild(antworten);

    if (m.selbst) {
      const weg = knopfMitBild('chat-icon-weg', 'chat-akt-btn gefahr',
        txt('chatDelete', 'Nachricht zurücknehmen'));
      weg.addEventListener('click', () => nimmZurueck(m));
      aktionen.appendChild(weg);
    }

    zeile.append(kreis, blase, aktionen);
    haengeFingerAn(zeile, m);
    return zeile;
  }

  /* ══════════════════════════════════════════════════════════════════
     MIT DEM FINGER: WISCHEN UND LANGES DRÜCKEN

     Die beiden Knöpfe neben der Blase erscheinen beim Darüberfahren.
     Ein Finger fährt aber nicht über etwas, ohne es zu berühren – auf
     dem Tablet standen sie deshalb dauerhaft da, an jeder einzelnen
     Zeile. Das ist in einem Gespräch von zwanzig Zeilen vierzig Knöpfe,
     die man nie braucht.

     Stattdessen die zwei Gesten, die auf einem Telefon jeder kennt:

       Nach rechts wischen   antwortet auf diese Nachricht
       Lange drücken         öffnet Antworten und Zurücknehmen

     >>> Warum die Zeile beim Wischen mitgeht <<<
     Ohne die Bewegung wüsste man bis zum Loslassen nicht, ob die Geste
     überhaupt erkannt wird. Sie geht nur bis zur Schwelle mit und
     federt zurück – das ist die Rückmeldung, nicht die Wirkung.

     >>> touch-action <<<
     Die Liste rollt senkrecht. `pan-y` an der Zeile sagt dem Browser:
     senkrecht gehört weiter dir, waagerecht uns. Ohne das macht er aus
     dem gezogenen Finger ein Rollen und bricht die Geste mit
     pointercancel ab – dieselbe Falle wie beim Tabellenraster
     (css/toolbar.css).
     ══════════════════════════════════════════════════════════════════ */

  // So weit muss der Finger, damit die Antwort ausgelöst wird
  const WISCH_SCHWELLE = 52;
  // Und so weit geht die Zeile höchstens mit
  const WISCH_MAX = 72;
  // So lange gedrückt halten heisst „langes Drücken"
  const HALTEN_MS = 480;
  // So weit darf der Finger dabei wandern, ohne dass es ein Wischen wird
  const HALTEN_ZITTERN = 10;

  function haengeFingerAn(zeile, m) {
    let start = null;      // { x, y, id }
    let uhr = null;        // Nachlauf fürs lange Drücken
    let wischt = false;
    let erledigt = false;  // schon ausgelöst – der Rest wird ignoriert

    const zurueck = () => {
      zeile.classList.remove('wischt');
      zeile.style.transform = '';
      wischt = false;
    };

    const aufraeumen = () => {
      clearTimeout(uhr);
      uhr = null;
      start = null;
      zurueck();
    };

    zeile.addEventListener('pointerdown', (e) => {
      // Nur der Finger. Mit der Maus gibt es die Knöpfe daneben.
      if (e.pointerType === 'mouse') return;
      if (e.target.closest('.chat-akt-btn, .chat-zitat')) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      erledigt = false;
      clearTimeout(uhr);
      uhr = setTimeout(() => {
        uhr = null;
        if (!start || wischt || erledigt) return;
        erledigt = true;
        zeigeZeilenMenue(start.x, start.y, m);
        aufraeumen();
      }, HALTEN_MS);
    });

    zeile.addEventListener('pointermove', (e) => {
      if (!start || start.id !== e.pointerId || erledigt) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;

      /* Senkrecht gewischt heisst: die Liste rollen. Dann ist die Geste
         hier vorbei – auch das lange Drücken, sonst spränge das Menü
         mitten aus einer Rollbewegung heraus. */
      if (!wischt && Math.abs(dy) > Math.abs(dx)) {
        if (Math.abs(dy) > HALTEN_ZITTERN) aufraeumen();
        return;
      }
      if (Math.abs(dx) > HALTEN_ZITTERN) { clearTimeout(uhr); uhr = null; }
      // Nur nach rechts, wie beim Telefon
      if (dx <= 0) { zurueck(); return; }

      wischt = true;
      zeile.classList.add('wischt');
      // Zäher werdend: die letzten Pixel kosten mehr als die ersten
      const weg = Math.min(WISCH_MAX, dx * (dx > WISCH_SCHWELLE ? 0.4 : 1));
      zeile.style.transform = 'translateX(' + Math.round(weg) + 'px)';
      zeile.classList.toggle('reif', dx >= WISCH_SCHWELLE);
    });

    const beenden = (e) => {
      if (!start || (e && start.id !== e.pointerId)) return;
      const dx = e && e.clientX !== undefined ? e.clientX - start.x : 0;
      const ausloesen = !erledigt && wischt && dx >= WISCH_SCHWELLE;
      aufraeumen();
      zeile.classList.remove('reif');
      if (ausloesen) setzeAntwort(m);
    };

    zeile.addEventListener('pointerup', beenden);
    zeile.addEventListener('pointercancel', () => aufraeumen());
  }

  /* ── Das Menü beim langen Drücken ─────────────────────────────────── */

  let menueNachricht = null;

  function zeigeZeilenMenue(x, y, m) {
    const menue = el('chat-msg-menu');
    if (!menue) return;
    menueNachricht = m;

    // Zurücknehmen gibt es nur an der eigenen Zeile
    const weg = el('chatctx-weg');
    if (weg) weg.style.display = m.selbst ? '' : 'none';

    menue.style.cssText = 'display:block;position:fixed;left:0;top:0';
    /* Erst zeigen, dann messen: ein Menü mit display:none hat keine
       Grösse, und es soll nicht über den Rand hinausstehen. */
    const b = menue.offsetWidth || 200;
    const h = menue.offsetHeight || 90;
    menue.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - b - 8, x - b / 2))) + 'px';
    menue.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, y - h - 8))) + 'px';

    setTimeout(() => document.addEventListener('pointerdown', menueDraussen, true), 0);
  }

  function schliesseZeilenMenue() {
    const menue = el('chat-msg-menu');
    if (menue) menue.style.display = 'none';
    menueNachricht = null;
    document.removeEventListener('pointerdown', menueDraussen, true);
  }

  function menueDraussen(e) {
    if (!e.target.closest('#chat-msg-menu')) schliesseZeilenMenue();
  }

  el('chatctx-antwort')?.addEventListener('click', () => {
    const m = menueNachricht;
    schliesseZeilenMenue();
    if (m) setzeAntwort(m);
  });

  el('chatctx-weg')?.addEventListener('click', () => {
    const m = menueNachricht;
    schliesseZeilenMenue();
    if (m) nimmZurueck(m);
  });

  /** Die gemeinte Zeile kurz hervorheben – wenn sie noch da ist. */
  function springeZu(id) {
    const ziel = el('chat-list')?.querySelector('[data-mid="' + CSS.escape(String(id)) + '"]');
    if (!ziel) { toastKurz(txt('chatQuoteGone', 'Diese Nachricht gibt es nicht mehr.')); return; }
    ziel.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ziel.classList.remove('gefunden');
    // Neu anstossen: ohne den Zwischenschritt läuft die Kennzeichnung
    // beim zweiten Klick auf dieselbe Zeile nicht noch einmal
    void ziel.offsetWidth;
    ziel.classList.add('gefunden');
    setTimeout(() => ziel.classList.remove('gefunden'), 1600);
  }

  function toastKurz(text) {
    if (typeof toast === 'function') toast(text);
  }

  async function nimmZurueck(m) {
    if (!raum || typeof raum.deleteChat !== 'function') return;
    if (typeof showConfirm === 'function'
        && !await showConfirm(txt('chatDeleteConfirm', 'Diese Nachricht zurücknehmen?'))) return;

    /* Die Zeile NICHT schon hier wegnehmen: kommt das Löschen nicht
       durch, stünde sie bei allen anderen weiter da und nur hier nicht
       mehr. Weg ist sie, wenn der Raum es meldet (entferneZeile). */
    const gut = await raum.deleteChat(m.id);
    if (!gut) toastKurz(txt('chatDeleteFailed', 'Die Nachricht konnte nicht zurückgenommen werden.'));
  }

  function entferneZeile(id) {
    const zeile = el('chat-list')?.querySelector('[data-mid="' + CSS.escape(String(id)) + '"]');
    zeile?.remove();
    if (antwortAuf && antwortAuf.id === id) setzeAntwort(null);
    leereHinweis();
  }

  /** Steht die Liste schon fast unten? Dann darf sie mitwandern. */
  function istUnten() {
    const liste = el('chat-list');
    if (!liste) return true;
    return liste.scrollHeight - liste.scrollTop - liste.clientHeight < 60;
  }

  function nachUnten() {
    const liste = el('chat-list');
    if (liste) liste.scrollTop = liste.scrollHeight;
  }

  function leereHinweis() {
    const liste = el('chat-list');
    if (!liste || liste.querySelector('.chat-msg')) return;
    liste.innerHTML = '';
    const leer = document.createElement('div');
    leer.className = 'chat-leer';
    leer.textContent = txt('chatEmpty', 'Noch nichts gesagt.');
    liste.appendChild(leer);
  }

  /* ══════════════════════════════════════════════════════════════════
     WENN DER CHAT NICHT DARF

     Der Zweig `chat` ist in der Realtime Database neu. Solange die dort
     veröffentlichten Regeln ihn nicht kennen, wird jeder Zugriff
     abgewiesen (core/share.js sagt es einmal in der Konsole und gibt
     dann Ruhe).

     Im Fenster darf das nicht als „ich habe nichts geschrieben"
     ankommen. Deshalb steht der Grund IN der Leiste, und das Feld ist
     zu: ein Eingabefeld, in das man tippen kann und aus dem nie etwas
     hinausgeht, ist schlimmer als eines, das gesperrt ist.
     ══════════════════════════════════════════════════════════════════ */
  function zeigeSperre() {
    const liste = el('chat-list');
    const feld = el('chat-input');
    const senden = el('chat-send');

    if (feld) { feld.disabled = !!gesperrt; }
    if (senden) { senden.disabled = !!gesperrt; }

    // Nichts zu melden: einen alten Hinweis wegräumen und fertig
    liste?.querySelector('.chat-gesperrt')?.remove();
    if (!gesperrt) { leereHinweis(); return; }

    if (!liste) return;
    liste.querySelector('.chat-leer')?.remove();

    const kasten = document.createElement('div');
    kasten.className = 'chat-gesperrt';
    kasten.textContent = txt('chatRulesMissing',
      'Der Chat ist in der Live-Datenbank noch nicht freigeschaltet. '
      + 'Die Regeln aus website/database.rules.json müssen in der Firebase '
      + 'Console veröffentlicht werden.');
    liste.appendChild(kasten);
    nachUnten();
  }

  function zeigeNachricht(m) {
    if (!m || gesehen.has(m.id)) return;
    gesehen.add(m.id);

    const liste = el('chat-list');
    if (!liste) return;
    liste.querySelector('.chat-leer')?.remove();

    /* VOR dem Einhängen fragen: danach ist die Liste schon länger und
       die Antwort immer „nein". */
    const folgen = istUnten();
    liste.appendChild(baueZeile(m));
    if (folgen || m.selbst) nachUnten();

    if (!offen() && !m.selbst) { ungelesen++; zeichneIkone(); }
    if (!m.selbst) meldeWindows(m);
  }

  /* ══════════════════════════════════════════════════════════════════
     WINDOWS SAGT BESCHEID, WENN INKWELL NICHT VORNE IST

     Der Punkt an der Ikone reicht nur, solange man hinsieht. Wer neben
     dem Heft an etwas anderem arbeitet, hat das Fenster gar nicht auf
     dem Schirm – und eine Nachricht, die man erst beim nächsten
     Hinsehen bemerkt, ist keine Nachricht.

     >>> Was hier NICHT entschieden wird <<<
     Ob das Fenster vorne steht. Das weiss nur der Hauptprozess
     verlässlich (main.js, notify-chat): das Fenster kann minimiert
     sein oder auf einem anderen Schreibtisch liegen, und beides sieht
     von hier aus gleich aus.

     >>> Der Rückstand beim Betreten meldet nichts <<<
     Beim Anmelden am Strom kommen bis zu CHAT_BACKLOG alte
     Nachrichten auf einmal – ohne die Sperre unten stünden achtzig
     Meldungen von gestern rechts unten übereinander. Erst was NACH
     dem Anschluss ankommt, gilt als neu.
     ══════════════════════════════════════════════════════════════════ */
  function meldeWindows(m) {
    if (!angeschlossenSeit || (m.at || 0) < angeschlossenSeit) return;
    if (typeof Settings !== 'undefined' && Settings.get && Settings.get('chatNotifyOff')) return;
    if (!window.api || typeof window.api.notifyChat !== 'function') return;

    const wer = m.name || txt('chatTitle', 'Chat');
    const heft = (typeof S !== 'undefined' && S.sharedDoc && S.sharedDoc.title) || '';
    try {
      window.api.notifyChat({
        title: heft ? wer + ' — ' + heft : wer,
        body: m.text
      });
    } catch (err) { /* eine Meldung darf nichts kosten */ }
  }

  /* ── Schreiben ────────────────────────────────────────────────────── */

  /* Worauf die nächste Nachricht antwortet – oder nichts. */
  let antwortAuf = null;

  function setzeAntwort(m) {
    antwortAuf = m ? { id: m.id, name: m.name || '', text: m.text || '' } : null;

    const bar = el('chat-antwort-bar');
    if (!bar) return;
    if (!antwortAuf) { bar.style.display = 'none'; return; }

    const wer = el('chat-antwort-wer');
    const was = el('chat-antwort-text');
    if (wer) wer.textContent = m.selbst
      ? txt('collabYou', 'du')
      : (antwortAuf.name || txt('chatSomeone', 'Jemand'));
    if (was) was.textContent = antwortAuf.text;
    bar.style.display = 'flex';

    // Wer auf Antworten drückt, will danach tippen
    el('chat-input')?.focus();
  }

  el('chat-antwort-weg')?.addEventListener('click', () => setzeAntwort(null));

  /** Das Feld wächst mit dem Text – bis zu einer Grenze. */
  const FELD_MAX_PX = 120;

  function passeHoeheAn() {
    const feld = el('chat-input');
    if (!feld) return;
    feld.style.height = 'auto';
    const noetig = feld.scrollHeight;
    feld.style.height = Math.min(FELD_MAX_PX, noetig) + 'px';

    /* Die Rollleiste erst, wenn es wirklich nicht mehr passt. Chromium
       blendet sie sonst schon bei einer einzigen Zeile ein, sobald das
       Feld einmal höher war – zu sehen war ein Feld mit zwei Pfeilchen
       daneben, in dem gar nichts steht. */
    feld.style.overflowY = noetig > FELD_MAX_PX ? 'auto' : 'hidden';
  }

  let tippUhr = null;       // wann zuletzt gemeldet
  let tippEnde = null;      // Nachlauf bis „fertig"
  let tippAn = false;

  function melde(an) {
    if (!raum || typeof raum.setTyping !== 'function') return;
    if (an === tippAn && an) return;      // läuft schon
    tippAn = an;
    raum.setTyping(an);
  }

  function beimTippen() {
    passeHoeheAn();

    const feld = el('chat-input');
    const etwasDa = !!(feld && feld.value.trim());

    clearTimeout(tippEnde);
    if (!etwasDa) { melde(false); return; }

    /* Gebremst: bei jedem Buchstaben zu schreiben wäre ein Schreibvorgang
       je Anschlag, und die Anzeige gewönne dadurch nichts. */
    const jetzt = Date.now();
    if (!tippAn || jetzt - (tippUhr || 0) > TIPP_TAKT_MS) {
      tippUhr = jetzt;
      tippAn = false;      // erzwingt das Auffrischen in melde()
      melde(true);
    }

    tippEnde = setTimeout(() => melde(false), TIPP_ENDE_MS);
  }

  async function sende() {
    const feld = el('chat-input');
    if (!feld || !raum || typeof raum.sendChat !== 'function') return;

    const text = feld.value.trim().slice(0, MAX_LEN);
    if (!text) return;

    /* Das Feld sofort leeren, nicht erst nach der Antwort: bei einer
       trägen Leitung tippt man sonst in einen Satz hinein, der gerade
       hinausgeht. Scheitert es, kommt er zurück ins Feld – und mit ihm
       der Bezug, auf den er sich bezog. */
    const bezug = antwortAuf;
    feld.value = '';
    setzeAntwort(null);
    passeHoeheAn();
    clearTimeout(tippEnde);
    melde(false);

    const gut = await raum.sendChat(text, bezug);
    if (gut) return;

    feld.value = text;
    if (bezug) setzeAntwort({ id: bezug.id, name: bezug.name, text: bezug.text });
    passeHoeheAn();

    /* Beim ersten Versuch kann genau hier herauskommen, dass die Regeln
       den Chat nicht kennen. Dann steht der Grund schon in der Leiste –
       ein zusätzliches „kam nicht an" sagt nichts dazu. */
    if (gesperrt) return;
    if (typeof toast === 'function') toast(txt('chatFailed', 'Die Nachricht kam nicht an.'), true);
  }

  el('chat-send')?.addEventListener('click', () => sende());
  el('chat-input')?.addEventListener('input', beimTippen);
  el('chat-input')?.addEventListener('keydown', (e) => {
    /* Enter schickt, Umschalt+Enter macht eine neue Zeile. Wie in jedem
       anderen Chat auch – und der Knopf daneben bleibt für den Finger. */
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    sende();
  });
  el('chat-input')?.addEventListener('blur', () => { clearTimeout(tippEnde); melde(false); });

  /* ── Wer gerade tippt ─────────────────────────────────────────────── */

  function zeigeTippende(uids) {
    const streifen = el('chat-typing');
    const gesichter = el('chat-typing-faces');
    if (!streifen || !gesichter) return;

    const leute = (window.Collab && typeof Collab.people === 'function')
      ? Collab.people() : [];
    const karte = new Map(leute.map(p => [p.uid, p]));

    /* Nur die, die auch wirklich hier sind. Ein Eintrag von jemandem,
       der inzwischen gegangen ist, hätte weder Namen noch Farbe. */
    const zeigen = (uids || []).map(uid => karte.get(uid)).filter(Boolean);

    if (!zeigen.length) { streifen.style.display = 'none'; gesichter.innerHTML = ''; return; }

    gesichter.innerHTML = '';
    for (const person of zeigen.slice(0, 4)) {
      const kreis = document.createElement('span');
      kreis.className = 'chat-face klein';
      kreis.style.background = person.color || 'var(--gold)';
      kreis.textContent = person.initials || '?';
      kreis.title = person.name || person.email || '?';
      gesichter.appendChild(kreis);
    }

    const folgen = istUnten();
    streifen.style.display = 'flex';
    if (folgen) nachUnten();
  }

  /* ── Anschluss an den Raum ────────────────────────────────────────── */

  function attach(neuerRaum) {
    detach();
    if (!neuerRaum) return;
    raum = neuerRaum;
    angeschlossenSeit = Date.now();

    if (typeof raum.onChat === 'function') stopChat = raum.onChat(zeigeNachricht);
    /* Mit ?. gefragt: eine ältere core/share.js kennt das Zurücknehmen
       noch nicht – dann bleibt es beim bisherigen Verhalten. */
    if (typeof raum.onChatRemoved === 'function') stopWeg = raum.onChatRemoved(entferneZeile);
    if (typeof raum.onTyping === 'function') stopTipp = raum.onTyping(zeigeTippende);

    /* Der Zustand kommt sofort und noch einmal, wenn er kippt. Mit ?.
       gefragt: eine ältere core/share.js kennt ihn nicht – dann bleibt
       es beim bisherigen Verhalten. */
    if (typeof raum.onChatStatus === 'function') {
      stopStatus = raum.onChatStatus((grund) => {
        gesperrt = grund || '';
        zeigeSperre();
        zeichneIkone();
      });
    }

    leereHinweis();
    zeigeSperre();
    zeichneIkone();
  }

  function detach() {
    /* Die Abmeldung des eigenen „ich tippe" geht noch über den ALTEN
       Raum hinaus – danach ist er weg. */
    melde(false);
    clearTimeout(tippEnde);

    if (typeof stopChat === 'function') { try { stopChat(); } catch (e) {} }
    if (typeof stopWeg === 'function') { try { stopWeg(); } catch (e) {} }
    if (typeof stopTipp === 'function') { try { stopTipp(); } catch (e) {} }
    if (typeof stopStatus === 'function') { try { stopStatus(); } catch (e) {} }
    stopChat = null;
    stopWeg = null;
    stopTipp = null;
    stopStatus = null;
    raum = null;
    tippAn = false;
    gesperrt = '';
    angeschlossenSeit = 0;

    gesehen.clear();
    ungelesen = 0;

    const liste = el('chat-list');
    if (liste) liste.innerHTML = '';
    const streifen = el('chat-typing');
    if (streifen) streifen.style.display = 'none';
    setzeAntwort(null);
    const feld = el('chat-input');
    if (feld) {
      feld.value = '';
      feld.style.height = '';
      feld.style.overflowY = '';
      feld.disabled = false;
    }
    const senden = el('chat-send');
    if (senden) senden.disabled = false;

    setzeOffen(false);
    zeichneIkone();
  }

  /* Wer die Meldung anklickt, will das Gespräch sehen – nicht bloss ein
     Fenster, das nach vorn springt. Das Nachvornholen macht main.js,
     das Aufziehen hier. */
  if (window.api && typeof window.api.onChatNotificationClicked === 'function') {
    window.api.onChatNotificationClicked(() => {
      if (raum && jemandDa()) setzeOffen(true);
    });
  }

  window.ChatUI = { attach, detach, refresh, isOpen: offen };
})();
