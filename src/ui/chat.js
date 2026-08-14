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
  let stopTipp = null;

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
    /* Nur zumachen, wenn nichts geschrieben ist – sonst wäre ein
       versehentliches Escape ein verlorener Satz. */
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

  function baueZeile(m) {
    const zeile = document.createElement('div');
    zeile.className = 'chat-msg' + (m.selbst ? ' selbst' : '');

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

    const text = document.createElement('div');
    text.className = 'chat-text';
    // textContent und nicht innerHTML: hier kommt fremder Text herein
    text.textContent = m.text;

    const zeit = document.createElement('span');
    zeit.className = 'chat-time';
    zeit.textContent = uhrzeit(m.at);

    blase.append(text, zeit);
    zeile.append(kreis, blase);
    return zeile;
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
  }

  /* ── Schreiben ────────────────────────────────────────────────────── */

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
       hinausgeht. Scheitert es, kommt er zurück ins Feld. */
    feld.value = '';
    passeHoeheAn();
    clearTimeout(tippEnde);
    melde(false);

    const gut = await raum.sendChat(text);
    if (gut) return;

    feld.value = text;
    passeHoeheAn();
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

    if (typeof raum.onChat === 'function') stopChat = raum.onChat(zeigeNachricht);
    if (typeof raum.onTyping === 'function') stopTipp = raum.onTyping(zeigeTippende);

    leereHinweis();
    zeichneIkone();
  }

  function detach() {
    /* Die Abmeldung des eigenen „ich tippe" geht noch über den ALTEN
       Raum hinaus – danach ist er weg. */
    melde(false);
    clearTimeout(tippEnde);

    if (typeof stopChat === 'function') { try { stopChat(); } catch (e) {} }
    if (typeof stopTipp === 'function') { try { stopTipp(); } catch (e) {} }
    stopChat = null;
    stopTipp = null;
    raum = null;
    tippAn = false;

    gesehen.clear();
    ungelesen = 0;

    const liste = el('chat-list');
    if (liste) liste.innerHTML = '';
    const streifen = el('chat-typing');
    if (streifen) streifen.style.display = 'none';
    const feld = el('chat-input');
    if (feld) { feld.value = ''; feld.style.height = ''; feld.style.overflowY = ''; }

    setzeOffen(false);
    zeichneIkone();
  }

  window.ChatUI = { attach, detach, refresh, isOpen: offen };
})();
