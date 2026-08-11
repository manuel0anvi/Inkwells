'use strict';

/* ══════════════════════════════════════════════════════════════════════
   KOMMENTAR-OBERFLÄCHE

   Drei Teile:

     1. Die Karten stehen im leeren Rand RECHTS NEBEN der Seite, auf der
        Höhe der Stelle, zu der sie gehören.
     2. Ein kleiner Knopf erscheint, sobald man Text auswählt.
     3. Die kommentierte Stelle bekommt Farbe – aber nur, wenn man
        darüber schwebt oder mit der Schreibmarke darin steht.

   >>> Warum keine eigene Leiste <<<
   Es gab eine, 290 px breit, die dem Blatt Platz wegnahm. Neben der Seite
   ist ohnehin leerer Raum: bei 794 px Blattbreite und einem gewöhnlichen
   Fenster bleiben links und rechts je gut 200 px übrig. Dort gehören die
   Karten hin – wie in Word, und ohne dass etwas schmaler wird.

   >>> Und wenn der Platz nicht reicht <<<
   Bei einem schmalen Fenster gibt es keinen Rand. Dann stehen die Karten
   nicht dauerhaft da, sondern nur die eine, über deren Stelle man gerade
   schwebt oder in der die Schreibmarke steht.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const KARTE_B = 210;      // Breite einer Karte
  const KARTE_LUFT = 14;    // Abstand zwischen Blatt und Karte
  const MIN_RAND = KARTE_B + KARTE_LUFT + 8;   // ab so viel Rand passt es

  /* ── Die Ebene, in der die Karten liegen ──────────────────────────── */
  const ebene = document.createElement('div');
  ebene.id = 'comment-layer';
  ebene.className = 'comment-layer';

  function haengeEin() {
    const scroll = E('pg-scroll');
    if (!scroll) return setTimeout(haengeEin, 200);
    scroll.appendChild(ebene);
    scroll.addEventListener('scroll', planeNeu, { passive: true });
  }
  haengeEin();

  /* ── Der Knopf an der Auswahl ─────────────────────────────────────── */
  const wahlKnopf = document.createElement('button');
  wahlKnopf.type = 'button';
  wahlKnopf.id = 'comment-add-pop';
  wahlKnopf.className = 'comment-add-pop';
  wahlKnopf.style.display = 'none';
  wahlKnopf.innerHTML = '<span class="comment-add-pop-icon">💬</span><span class="comment-add-pop-text"></span>';
  document.body.appendChild(wahlKnopf);

  let _gemerkteWahl = null;
  let _einzeln = null;      // im Engformat: die gerade gezeigte Karte

  const txt = (key, ersatz) => (typeof t === 'function' && t(key)) || ersatz;

  function beschrifte() {
    wahlKnopf.querySelector('.comment-add-pop-text').textContent = txt('addComment', 'Kommentar');
  }
  if (typeof t === 'function') beschrifte();
  else window.addEventListener('load', beschrifte);

  /* ── Zeitangabe ───────────────────────────────────────────────────── */
  function formatZeit(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return txt('timeNow', 'gerade eben');
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' h';
    const spr = (typeof S !== 'undefined' && S.lang) ? S.lang : 'de';
    return new Date(ts).toLocaleDateString(spr, { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  /** Eine gleichbleibende Farbe je Verfasser. */
  function farbeFuer(kennung) {
    const s = String(kennung || 'local');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ' 62% 58%)';
  }

  async function frage(titel) {
    if (typeof txtModal === 'function') return await txtModal(titel, '');
    return window.prompt(titel);
  }

  function kleinerKnopf(beschriftung, tun, extra) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sm-action' + (extra ? ' ' + extra : '');
    b.textContent = beschriftung;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => { e.stopPropagation(); tun(); });
    return b;
  }

  /* ── Eine Karte bauen ─────────────────────────────────────────────── */
  function baueKarte(c) {
    const karte = document.createElement('div');
    karte.className = 'comment-card' + (c.resolved ? ' resolved' : '');
    karte.dataset.cid = String(c.id);

    const kopf = document.createElement('div');
    kopf.className = 'comment-card-head';

    const punkt = document.createElement('span');
    punkt.className = 'comment-card-dot';
    punkt.style.background = farbeFuer(c.author && c.author.uid);

    const autor = document.createElement('span');
    autor.className = 'comment-card-author';
    autor.textContent = (c.author && c.author.name) || txt('commentUnknown', 'Unbekannt');

    const zeit = document.createElement('span');
    zeit.className = 'comment-card-time';
    zeit.textContent = formatZeit(c.created);

    kopf.appendChild(punkt);
    kopf.appendChild(autor);
    kopf.appendChild(zeit);
    karte.appendChild(kopf);

    const text = document.createElement('div');
    text.className = 'comment-card-text';
    text.textContent = c.text || '';
    karte.appendChild(text);

    // Geändert? Dann soll man es sehen – sonst wirkt der neue Text wie der alte
    if (c.edited) {
      const vermerk = document.createElement('span');
      vermerk.className = 'comment-card-edited';
      vermerk.textContent = txt('commentEdited', 'bearbeitet');
      text.appendChild(document.createTextNode(' '));
      text.appendChild(vermerk);
    }

    if (c.replies && c.replies.length) {
      const antworten = document.createElement('div');
      antworten.className = 'comment-replies';
      for (const r of c.replies) {
        const z = document.createElement('div');
        z.className = 'comment-reply';
        const rn = document.createElement('span');
        rn.className = 'comment-reply-author';
        rn.textContent = (r.author && r.author.name) || '';
        const rt = document.createElement('span');
        rt.className = 'comment-reply-text';
        rt.textContent = (r.text || '') + (r.edited ? ' ' : '');
        z.appendChild(rn);
        z.appendChild(rt);

        // Auch eine eigene Antwort laesst sich nachbessern
        if (typeof istMeinKommentar === 'function' && istMeinKommentar(r)) {
          const stift = document.createElement('button');
          stift.type = 'button';
          stift.className = 'comment-reply-edit';
          stift.textContent = '✎';
          stift.title = txt('editComment', 'Bearbeiten');
          stift.addEventListener('mousedown', e => e.preventDefault());
          stift.addEventListener('click', async e => {
            e.stopPropagation();
            const neu = typeof txtModal === 'function'
              ? await txtModal(txt('editComment', 'Bearbeiten'), r.text || '')
              : window.prompt(txt('editComment', 'Bearbeiten'), r.text || '');
            if (neu === null || neu === undefined) return;
            if (editReply(c.id, r.id, neu)) zeichne();
          });
          z.appendChild(stift);
        }

        antworten.appendChild(z);
      }
      karte.appendChild(antworten);
    }

    const reihe = document.createElement('div');
    reihe.className = 'comment-card-btns';

    reihe.appendChild(kleinerKnopf(txt('replyToComment', 'Antworten'), async () => {
      const antwort = await frage(txt('replyPlaceholder', 'Antwort schreiben …'));
      if (!antwort) return;
      replyToComment(c.id, antwort);
      zeichne();
    }));

    reihe.appendChild(kleinerKnopf(
      c.resolved ? txt('reopenComment', 'Wieder öffnen') : txt('resolveComment', 'Erledigt'),
      () => { toggleCommentResolved(c.id); zeichne(); }));

    // Bearbeiten und Löschen sieht nur, wem der Kommentar gehört
    if (typeof istMeinKommentar === 'function' && istMeinKommentar(c)) {
      reihe.appendChild(kleinerKnopf(txt('editComment', 'Bearbeiten'), async () => {
        const neu = typeof txtModal === 'function'
          ? await txtModal(txt('editComment', 'Kommentar bearbeiten'), c.text || '')
          : window.prompt(txt('editComment', 'Kommentar bearbeiten'), c.text || '');
        if (neu === null || neu === undefined) return;
        if (editComment(c.id, neu)) zeichne();
      }));

      reihe.appendChild(kleinerKnopf(txt('deleteComment', 'Löschen'), async () => {
        const ok = typeof showConfirm === 'function'
          ? await showConfirm(txt('confirmDeleteComment', 'Kommentar wirklich löschen?'))
          : window.confirm(txt('confirmDeleteComment', 'Kommentar wirklich löschen?'));
        if (!ok) return;
        deleteComment(c.id);
        zeichne();
      }, 'danger'));
    }

    karte.appendChild(reihe);

    karte.addEventListener('mouseenter', () => hebeHervor(c.id, true));
    karte.addEventListener('mouseleave', () => hebeHervor(c.id, false));

    return karte;
  }

  /* ══════════════════════════════════════════════════════════════════
     KARTEN IM RAND SETZEN

     Jede Karte will auf die Höhe ihrer Stelle. Zwei Karten dicht
     beieinander würden sich überdecken – deshalb werden sie von oben nach
     unten durchgegangen und nach unten weggeschoben, bis Platz ist. Das
     ist dasselbe Verfahren wie in Word und Google Docs.
     ══════════════════════════════════════════════════════════════════ */
  function randBreite() {
    const scroll = E('pg-scroll');
    const seite = document.querySelector('.j-page');
    if (!scroll || !seite) return 0;
    const sr = scroll.getBoundingClientRect();
    const pr = seite.getBoundingClientRect();
    return sr.right - pr.right;
  }

  function zeichne() {
    if (!ebene.isConnected) return;

    const pgId = S.activePgId;
    const kommentare = (pgId && typeof getPageComments === 'function')
      ? getPageComments(pgId) : [];

    ebene.innerHTML = '';
    faerbeMarken();

    if (!kommentare.length) { ebene.style.display = 'none'; return; }

    // Kein Platz im Rand: dann nur die eine, die gerade dran ist
    if (randBreite() < MIN_RAND) {
      ebene.style.display = 'none';
      zeigeEinzeln(_einzeln);
      return;
    }

    ebene.style.display = '';
    const scroll = E('pg-scroll');
    const sr = scroll.getBoundingClientRect();
    const seite = document.querySelector('.j-page');
    const pr = seite.getBoundingClientRect();
    // Innerhalb der Ebene wird relativ zum Scroll-Inhalt gerechnet
    const links = (pr.right - sr.left) + scroll.scrollLeft + KARTE_LUFT;

    let untersteKante = -Infinity;

    for (const c of kommentare) {
      const mark = document.querySelector(
        '.j-comment-mark[data-cid="' + CSS.escape(String(c.id)) + '"]');

      const karte = baueKarte(c);
      karte.style.left = Math.round(links) + 'px';
      karte.style.width = KARTE_B + 'px';
      ebene.appendChild(karte);

      let oben;
      if (mark) {
        const mr = mark.getBoundingClientRect();
        oben = (mr.top - sr.top) + scroll.scrollTop;
      } else {
        oben = untersteKante === -Infinity ? 0 : untersteKante + 8;
      }

      // Nicht auf die vorige Karte legen
      if (oben < untersteKante + 8) oben = untersteKante + 8;
      karte.style.top = Math.round(Math.max(0, oben)) + 'px';
      untersteKante = Math.max(0, oben) + karte.offsetHeight;

      karte.addEventListener('click', () => {
        if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  let _geplant = false;
  function planeNeu() {
    if (_geplant) return;
    _geplant = true;
    requestAnimationFrame(() => { _geplant = false; zeichne(); });
  }

  window.addEventListener('resize', planeNeu, { passive: true });

  /* ── Engformat: eine einzelne schwebende Karte ────────────────────── */
  let einzelKarte = null;

  function zeigeEinzeln(cid) {
    if (einzelKarte) { einzelKarte.remove(); einzelKarte = null; }
    if (!cid) return;

    const nb = typeof getNb === 'function' ? getNb() : null;
    const c = nb && nb.comments && nb.comments.find(x => String(x.id) === String(cid));
    if (!c) return;

    const mark = document.querySelector('.j-comment-mark[data-cid="' + CSS.escape(String(cid)) + '"]');
    if (!mark) return;

    einzelKarte = baueKarte(c);
    einzelKarte.classList.add('schwebend');
    einzelKarte.style.width = KARTE_B + 'px';
    document.body.appendChild(einzelKarte);

    const mr = mark.getBoundingClientRect();
    const h = einzelKarte.offsetHeight || 90;
    const links = Math.max(8, Math.min(window.innerWidth - KARTE_B - 8, mr.left));
    const oben = mr.top - h - 8;
    einzelKarte.style.left = Math.round(links) + 'px';
    einzelKarte.style.top = Math.round(oben > 60 ? oben : mr.bottom + 8) + 'px';
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE MARKIERUNG IM TEXT

     Farbe bekommt sie nur, wenn man darüber schwebt oder mit der
     Schreibmarke darin steht. Sonst bleibt sie blass – der Text soll
     Text bleiben und nicht wie ein Textmarker-Feldzug aussehen.
     ══════════════════════════════════════════════════════════════════ */
  function faerbeMarken() {
    const nb = typeof getNb === 'function' ? getNb() : null;
    const kommentare = (nb && nb.comments) || [];

    document.querySelectorAll('.j-comment-mark[data-cid]').forEach(mark => {
      const c = kommentare.find(x => String(x.id) === mark.dataset.cid);
      mark.classList.toggle('j-resolved', !!(c && c.resolved));
      if (c) mark.title = ((c.author && c.author.name) || '') + ': ' + (c.text || '');
    });
  }

  function hebeHervor(cid, an) {
    const wahl = '.j-comment-mark[data-cid="' + CSS.escape(String(cid)) + '"]';
    document.querySelectorAll(wahl).forEach(m => m.classList.toggle('j-aktiv', an));
    ebene.querySelectorAll('.comment-card[data-cid="' + CSS.escape(String(cid)) + '"]')
      .forEach(k => k.classList.toggle('aktiv', an));
  }

  /* Über eine markierte Stelle schweben färbt sie und ihre Karte. */
  document.addEventListener('mouseover', e => {
    const mark = e.target.closest && e.target.closest('.j-comment-mark[data-cid]');
    if (!mark) return;
    hebeHervor(mark.dataset.cid, true);
    if (randBreite() < MIN_RAND) { _einzeln = mark.dataset.cid; zeigeEinzeln(_einzeln); }
  });

  document.addEventListener('mouseout', e => {
    const mark = e.target.closest && e.target.closest('.j-comment-mark[data-cid]');
    if (mark) hebeHervor(mark.dataset.cid, false);
  });

  /* Steht die Schreibmarke in einer kommentierten Stelle, gilt sie
     ebenfalls als aktiv – auch ohne Maus, etwa beim Blättern mit den
     Pfeiltasten oder auf einem Gerät ganz ohne Zeiger. */
  function pruefeMarkeUnterCursor() {
    const sel = window.getSelection();
    let drin = null;
    if (sel && sel.rangeCount) {
      let k = sel.getRangeAt(0).startContainer;
      if (k.nodeType === Node.TEXT_NODE) k = k.parentNode;
      const m = k && k.closest ? k.closest('.j-comment-mark[data-cid]') : null;
      if (m) drin = m.dataset.cid;
    }

    document.querySelectorAll('.j-comment-mark[data-cid]').forEach(m => {
      m.classList.toggle('j-cursor', drin !== null && m.dataset.cid === drin);
    });

    if (drin && randBreite() < MIN_RAND) { _einzeln = drin; zeigeEinzeln(drin); }
    else if (!drin && _einzeln && randBreite() < MIN_RAND) { _einzeln = null; zeigeEinzeln(null); }
  }

  /* ══════════════════════════════════════════════════════════════════
     DER KNOPF AN DER AUSWAHL
     ══════════════════════════════════════════════════════════════════ */
  function versteckeWahlKnopf() {
    wahlKnopf.style.display = 'none';
    _gemerkteWahl = null;
  }

  function pruefeAuswahl() {
    pruefeMarkeUnterCursor();

    if (S.readOnly) return versteckeWahlKnopf();

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return versteckeWahlKnopf();

    const range = sel.getRangeAt(0);

    // Leere Auswahl nach Löschung: der Browser meldet manchmal eine
    // nicht-kollabierte Auswahl, die aber keinen Text enthält – etwa
    // wenn ein leeres <span> oder <br> übrig bleibt. Ohne diese Prüfung
    // bliebe der Kommentar-Knopf nach dem Löschen stehen.
    if (!range.toString().trim()) return versteckeWahlKnopf();

    let knoten = range.commonAncestorContainer;
    if (knoten.nodeType === Node.TEXT_NODE) knoten = knoten.parentNode;
    const textDiv = knoten && knoten.closest ? knoten.closest('.j-text') : null;
    if (!textDiv) return versteckeWahlKnopf();

    const zitat = range.toString();
    if (!zitat.trim()) return versteckeWahlKnopf();
    if (knoten.closest('.j-comment-mark')) return versteckeWahlKnopf();

    const pgEl = textDiv.closest('[data-pgid]');
    _gemerkteWahl = { range: range.cloneRange(), textDiv, pgId: pgEl ? pgEl.dataset.pgid : null, zitat };

    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) return versteckeWahlKnopf();

    wahlKnopf.style.display = 'flex';
    const b = wahlKnopf.offsetWidth || 120;
    const h = wahlKnopf.offsetHeight || 30;
    const links = Math.max(8, Math.min(window.innerWidth - b - 8, r.left + r.width / 2 - b / 2));
    const oben = r.top - h - 8;
    wahlKnopf.style.left = Math.round(links) + 'px';
    wahlKnopf.style.top = Math.round(oben > 60 ? oben : r.bottom + 8) + 'px';
  }

  let _wahlTimer = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(_wahlTimer);
    _wahlTimer = setTimeout(pruefeAuswahl, 180);
  });

  /* >>> Auch beim Tippen und Löschen nachsehen <<<
     Wird markierter Text gelöscht, ist die Auswahl weg – aber Chromium
     meldet dafür kein selectionchange. Der Knopf blieb also stehen und
     zeigte auf eine Stelle, die es nicht mehr gab. Genau so gemeldet.
     Ohne Wartezeit: hier ist die Auswahl bereits fort, es gibt nichts
     abzuwarten. */
  document.addEventListener('input', e => {
    if (!e.target || !e.target.closest || !e.target.closest('.j-text')) return;
    clearTimeout(_wahlTimer);
    // Erst verstecken, dann neu prüfen: nach einer Löschung ist die
    // alte Auswahl nicht mehr gültig, und der Knopf muss sofort weg,
    // nicht erst nach der Wartezeit.
    versteckeWahlKnopf();
    _wahlTimer = setTimeout(pruefeAuswahl, 200);
  }, true);

  /* Und wenn der Textbereich den Fokus verliert – etwa weil jemand ein
     Werkzeug wählt – hat ein Kommentar-Knopf dort nichts mehr zu suchen. */
  document.addEventListener('focusout', e => {
    if (!e.target || !e.target.classList || !e.target.classList.contains('j-text')) return;
    setTimeout(() => {
      const a = document.activeElement;
      // Der Klick auf den Knopf selbst darf ihn nicht wegnehmen
      if (a === wahlKnopf || (a && a.closest && a.closest('#comment-add-pop'))) return;
      if (!a || !a.classList || !a.classList.contains('j-text')) versteckeWahlKnopf();
    }, 120);
  }, true);

  wahlKnopf.addEventListener('mousedown', e => e.preventDefault());

  wahlKnopf.addEventListener('click', async () => {
    const w = _gemerkteWahl;
    if (!w || !w.pgId) return;
    wahlKnopf.style.display = 'none';

    const text = await frage(txt('commentPlaceholder', 'Kommentar …'));
    if (!text || !text.trim()) { _gemerkteWahl = null; return; }

    // Die Auswahl wiederherstellen – das Modal hat sie genommen
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(w.range);

    const c = addComment(w.pgId, text.trim(), w.zitat);
    if (!c) { _gemerkteWahl = null; return; }

    if (!markSelection(c.id)) {
      deleteComment(c.id);
      if (typeof toast === 'function') toast(txt('commentNoMark', 'Diese Stelle lässt sich nicht markieren.'), true);
    }

    _gemerkteWahl = null;
    zeichne();
  });

  /* ── Bei Seitenwechsel neu zeichnen ───────────────────────────────── */
  (function haengeAnSeitenwechsel() {
    const orig = window.setActivePg;
    if (typeof orig !== 'function') return setTimeout(haengeAnSeitenwechsel, 200);
    window.setActivePg = function () {
      const r = orig.apply(this, arguments);
      setTimeout(zeichne, 40);
      return r;
    };
  })();

  window.addEventListener('load', () => setTimeout(zeichne, 400));

  /* ── Global erreichbar ────────────────────────────────────────────── */
  window.refreshComments = planeNeu;
})();
