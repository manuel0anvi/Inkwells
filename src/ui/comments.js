'use strict';

/* ══════════════════════════════════════════════════════════════════════
   KOMMENTAR-OBERFLÄCHE

   Drei Teile, die zusammengehören:

     1. Die Leiste rechts neben der Seite – dort steht jeder Kommentar als
        Karte mit Name, Text und Zeit.
     2. Der kleine Knopf, der erscheint, sobald man Text auswählt. Ein
        Klick darauf schreibt einen Kommentar zur Auswahl.
     3. Die farbige Unterlegung der kommentierten Stelle im Text.

   >>> Warum die Leiste neben .editor-col liegt und nicht darin <<<
   .editor-col ist eine Spalte (flex-direction: column). Ein Kind davon
   landet UNTER dem Seitenbereich, nicht daneben – und weil darüber
   overflow: hidden steht, war die Leiste schlicht nicht zu sehen. Genau
   das war „hat überhaupt keine UI". Sie gehört als Geschwister neben
   .editor-col in die .journal-layout-Zeile, wie die Seitenleiste links.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  /* ── Die Leiste rechts ────────────────────────────────────────────── */
  const rail = document.createElement('aside');
  rail.id = 'comment-rail';
  rail.className = 'comment-rail';
  rail.innerHTML =
      '<div class="comment-rail-head">'
    +   '<span class="comment-rail-title"></span>'
    +   '<button type="button" class="comment-rail-close" id="comment-rail-close" title="">✕</button>'
    + '</div>'
    + '<div class="comment-list" id="comment-list"></div>'
    + '<p class="comment-empty" id="comment-empty"></p>';

  function haengeEin() {
    const layout = document.querySelector('.journal-layout');
    const spalte = document.querySelector('.editor-col');
    if (!layout || !spalte) return setTimeout(haengeEin, 200);
    layout.appendChild(rail);   // als Geschwister NEBEN der Editorspalte
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

  let _gemerkteWahl = null;   // { range, textDiv, pgId, zitat }

  /* ── Beschriftungen ───────────────────────────────────────────────── */
  const txt = (key, ersatz) => (typeof t === 'function' && t(key)) || ersatz;

  function beschrifte() {
    rail.querySelector('.comment-rail-title').textContent = txt('comments', 'Kommentare');
    rail.querySelector('.comment-rail-close').title = txt('close', 'Schließen');
    E('comment-empty').textContent = txt('noComments', 'Noch keine Kommentare auf dieser Seite.');
    wahlKnopf.querySelector('.comment-add-pop-text').textContent = txt('addComment', 'Kommentar');
  }

  if (typeof t === 'function') beschrifte();
  else window.addEventListener('load', beschrifte);

  /* ── Zeitangabe ───────────────────────────────────────────────────── */
  function formatZeit(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60000) return txt('timeNow', 'gerade eben');
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' h';
    const spr = (typeof S !== 'undefined' && S.lang) ? S.lang : 'de';
    return d.toLocaleDateString(spr, { day: '2-digit', month: '2-digit', year: '2-digit' });
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

    // Der kommentierte Ausschnitt, damit man weiß, worum es geht
    if (c.zitat) {
      const zitat = document.createElement('div');
      zitat.className = 'comment-card-quote';
      zitat.textContent = c.zitat;
      karte.appendChild(zitat);
    }

    const text = document.createElement('div');
    text.className = 'comment-card-text';
    text.textContent = c.text || '';
    karte.appendChild(text);

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
        rt.textContent = r.text || '';
        z.appendChild(rn);
        z.appendChild(rt);
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

    /* Löschen sieht nur, wem der Kommentar gehört. Ein Knopf, der beim
       Drücken „darfst du nicht" sagt, ist schlechter als keiner. */
    if (typeof istMeinKommentar === 'function' && istMeinKommentar(c)) {
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

    /* Karte und Textstelle zeigen aufeinander: über der Karte schweben
       hebt die Stelle im Text hervor und umgekehrt. */
    karte.addEventListener('mouseenter', () => hebeHervor(c.id, true));
    karte.addEventListener('mouseleave', () => hebeHervor(c.id, false));
    karte.addEventListener('click', () => springeZuMarke(c.id));

    return karte;
  }

  function kleinerKnopf(beschriftung, tun, extra) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sm-action' + (extra ? ' ' + extra : '');
    b.textContent = beschriftung;
    b.addEventListener('click', e => { e.stopPropagation(); tun(); });
    return b;
  }

  /** Eine gleichbleibende Farbe je Verfasser – wie bei den Mitschreibenden. */
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

  /* ── Die Leiste zeichnen ──────────────────────────────────────────── */
  function zeichne() {
    const liste = E('comment-list');
    const leer = E('comment-empty');
    if (!liste) return;

    const pgId = S.activePgId;
    const kommentare = (pgId && typeof getPageComments === 'function')
      ? getPageComments(pgId) : [];

    liste.innerHTML = '';
    for (const c of kommentare) liste.appendChild(baueKarte(c));

    // Die Leiste bleibt stehen, auch wenn nichts drinsteht
    if (leer) leer.style.display = kommentare.length ? 'none' : '';

    faerbeMarken();
  }

  /* ── Die Marken im Text ───────────────────────────────────────────── */
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
    const karte = rail.querySelector('.comment-card[data-cid="' + CSS.escape(String(cid)) + '"]');
    if (karte) karte.classList.toggle('aktiv', an);
  }

  function springeZuMarke(cid) {
    const mark = document.querySelector('.j-comment-mark[data-cid="' + CSS.escape(String(cid)) + '"]');
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* Klick auf eine markierte Stelle im Text führt zur Karte. */
  document.addEventListener('click', e => {
    const mark = e.target.closest && e.target.closest('.j-comment-mark[data-cid]');
    if (!mark) return;
    const cid = mark.dataset.cid;
    const karte = rail.querySelector('.comment-card[data-cid="' + CSS.escape(cid) + '"]');
    if (!karte) return;
    karte.scrollIntoView({ behavior: 'smooth', block: 'center' });
    karte.classList.add('blitz');
    setTimeout(() => karte.classList.remove('blitz'), 1400);
  });

  /* Über eine markierte Stelle schweben hebt die zugehörige Karte hervor. */
  document.addEventListener('mouseover', e => {
    const mark = e.target.closest && e.target.closest('.j-comment-mark[data-cid]');
    if (mark) hebeHervor(mark.dataset.cid, true);
  });
  document.addEventListener('mouseout', e => {
    const mark = e.target.closest && e.target.closest('.j-comment-mark[data-cid]');
    if (mark) hebeHervor(mark.dataset.cid, false);
  });

  /* ══════════════════════════════════════════════════════════════════
     DER KNOPF AN DER AUSWAHL

     Erscheint, sobald im Seitentext etwas markiert ist – dort, wo die
     Auswahl endet. Das ist der einzige Weg zum Kommentieren; das alte
     Versteck im Einfügen-Menü verlangte eine gesetzte Schreibmarke und
     lehnte ausgerechnet eine Auswahl ab.
     ══════════════════════════════════════════════════════════════════ */
  function versteckeWahlKnopf() {
    wahlKnopf.style.display = 'none';
    _gemerkteWahl = null;
  }

  function pruefeAuswahl() {
    if (S.readOnly) return versteckeWahlKnopf();

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return versteckeWahlKnopf();

    const range = sel.getRangeAt(0);
    let knoten = range.commonAncestorContainer;
    if (knoten.nodeType === Node.TEXT_NODE) knoten = knoten.parentNode;
    const textDiv = knoten && knoten.closest ? knoten.closest('.j-text') : null;
    if (!textDiv) return versteckeWahlKnopf();

    const zitat = range.toString();
    if (!zitat.trim()) return versteckeWahlKnopf();

    // Schon kommentiert? Dann nicht noch einmal darüber
    if (knoten.closest('.j-comment-mark')) return versteckeWahlKnopf();

    const pgEl = textDiv.closest('[data-pgid]');
    _gemerkteWahl = {
      range: range.cloneRange(),
      textDiv,
      pgId: pgEl ? pgEl.dataset.pgid : null,
      zitat
    };

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
    // Kurz warten: während des Ziehens feuert das Ereignis dauernd
    _wahlTimer = setTimeout(pruefeAuswahl, 180);
  });

  // Der Klick auf den Knopf darf die Auswahl nicht wegnehmen
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
      // Markieren ging nicht – dann auch keinen leeren Kommentar behalten
      deleteComment(c.id);
      if (typeof toast === 'function') toast(txt('commentNoMark', 'Diese Stelle lässt sich nicht markieren.'), true);
    }

    _gemerkteWahl = null;
    zeichne();
  });

  /* ── Leiste auf- und zuklappen ────────────────────────────────────── */
  function umschalten(an) {
    const zu = (an === undefined) ? !rail.classList.contains('zu') : !an;
    rail.classList.toggle('zu', zu);
    const btn = E('btn-comments');
    if (btn) btn.classList.toggle('active', !zu);
  }

  E('comment-rail-close').addEventListener('click', () => umschalten(false));

  /* ── Knopf in der Werkzeugleiste ──────────────────────────────────── */
  (function baueKnopf() {
    const zone = document.querySelector('.tb-right');
    if (!zone) return setTimeout(baueKnopf, 200);

    const grp = document.createElement('div');
    grp.className = 'tb-grp';
    // Entbehrlich beim Blättern, aber erst nach Speichern und Teilen
    grp.dataset.tbMore = '3';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btn-comments';
    btn.className = 'tb-opt active';
    btn.textContent = '💬';
    btn.title = txt('comments', 'Kommentare');
    btn.addEventListener('click', () => umschalten());
    grp.appendChild(btn);

    const prevBtn = E('btn-tb-prev');
    if (prevBtn) prevBtn.before(grp);
    else zone.appendChild(grp);

    if (typeof window.updateToolbarOverflow === 'function') window.updateToolbarOverflow();
  })();

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
  window.refreshComments = zeichne;
  window.toggleCommentRail = umschalten;
})();
