'use strict';

/* ── PAGE CONTEXT MENU ── */
let _pgCtxPage = null, _pgCtxEl = null, _pgCtxBg = 'ruled';

function showPgCtxMenu(x, y, page, pgEl) {
  // Im Nur-Lese-Modus gäbe es hier nur Einträge, die etwas verändern
  // (Hintergrund, Seite löschen). Dann bleibt das Menü ganz zu.
  if (S.readOnly) return;

  _pgCtxPage = page; _pgCtxEl = pgEl;
  const m = E('pg-ctx-menu');

  if (page.bgImg) {
    E('pgctx-bg').style.display = 'none';
  } else {
    E('pgctx-bg').style.display = 'block';
  }

  const margin = 8;
  m.style.cssText = 'display:block;position:fixed;left:0;top:0;z-index:1000;visibility:hidden';
  const menuW = m.offsetWidth || 220;
  const menuH = m.offsetHeight || 120;
  const clampedX = Math.max(margin, Math.min(x, window.innerWidth - menuW - margin));
  const clampedY = Math.max(margin, Math.min(y, window.innerHeight - menuH - margin));
  m.style.left = clampedX + 'px';
  m.style.top = clampedY + 'px';
  m.style.visibility = 'visible';
  setTimeout(() => document.addEventListener('pointerdown', hidePgCtxOut), 0);
}
/* ══════════════════════════════════════════════════════════════════════
   ABSCHNITT EINER SEITE FESTLEGEN

   Das Menü hinter dem Symbol im Seitenkopf. Es listet alle Abschnitte mit
   ihrem Farbpunkt, dazu „Ohne Abschnitt". Ein Klick etikettiert um – die
   Seite bleibt dabei genau da, wo sie im Heft steht.

   Aufgebaut zur Laufzeit, weil sich die Abschnitte jederzeit ändern.
   Gleiches Muster wie ensureSecMgrCtxMenu in ui/sidebar.js.
   ══════════════════════════════════════════════════════════════════════ */
let _pgSecMenu = null;

/**
 * @param {function} [onDone] Wird nach dem Umhängen gerufen – die
 *   Abschnittsverwaltung zeichnet sich damit selbst nach, ohne dass dieses
 *   Menü sie kennen müsste.
 */
function showPgSectionMenu(x, y, page, onDone) {
  if (S.readOnly) return;
  const nb = getNb();
  if (!nb || !page) return;

  if (!_pgSecMenu) {
    _pgSecMenu = document.createElement('div');
    _pgSecMenu.className = 'ctx-menu';
    _pgSecMenu.style.display = 'none';
    document.body.appendChild(_pgSecMenu);
    document.addEventListener('pointerdown', e => {
      if (_pgSecMenu && !_pgSecMenu.contains(e.target)) _pgSecMenu.style.display = 'none';
    });
  }

  const menu = _pgSecMenu;
  menu.innerHTML = '';
  const jetzt = findSecForPage(page.id, nb);

  const eintrag = (label, farbe, aktiv, handler) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctx-item' + (aktiv ? ' on' : '');
    const dot = document.createElement('span');
    dot.className = 'ctx-sec-dot';
    if (farbe) dot.style.background = farbe;
    else dot.style.boxShadow = 'inset 0 0 0 1.5px currentColor';
    const text = document.createElement('span');
    text.textContent = label;
    btn.append(dot, text);
    btn.addEventListener('click', () => { menu.style.display = 'none'; handler(); });
    return btn;
  };

  const umhaengen = (secId) => {
    if (!setSectionOfPage(nb, page.id, secId)) { if (onDone) onDone(); return; }
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();

    /* Steht die Ansicht auf einem Ausschnitt und die Seite gehört jetzt
       nicht mehr dazu, muss neu gezeichnet werden – sonst bliebe sie
       sichtbar, obwohl sie nicht mehr zur Auswahl zählt. */
    const gezeigt = activeSection(nb);
    if (gezeigt && String(gezeigt.id) !== String(secId || '')) openSection(gezeigt);
    else { refreshPageSectionMarks(); renderSideTree(); }
    if (onDone) onDone();
  };

  for (const sec of getSections(nb)) {
    menu.appendChild(eintrag(
      getSectionDisplayName(sec), colorForSection(sec),
      jetzt && jetzt.id === sec.id, () => umhaengen(sec.id)
    ));
  }
  menu.appendChild(eintrag(t('noSection'), null, !jetzt, () => umhaengen('')));

  /* Ein Heft startet ohne Abschnitte – ohne diesen Eintrag stünde hier
     nur „Ohne Abschnitt", und man müsste erst die Verwaltung aufmachen,
     um überhaupt etwas etikettieren zu können. */
  const neu = document.createElement('button');
  neu.type = 'button';
  neu.className = 'ctx-item ctx-item-new';
  neu.textContent = t('addSection');
  neu.addEventListener('click', () => {
    menu.style.display = 'none';
    // Derselbe Weg wie ueberall: Name und Farbe in einem Aufwasch
    createSection(sec => umhaengen(sec.id));
  });
  menu.appendChild(neu);

  const margin = 8;
  menu.style.cssText = 'display:block;position:fixed;left:0;top:0;z-index:1000;visibility:hidden';
  const mx = Math.max(margin, Math.min(x, window.innerWidth - (menu.offsetWidth || 200) - margin));
  const my = Math.max(margin, Math.min(y, window.innerHeight - (menu.offsetHeight || 160) - margin));
  menu.style.left = mx + 'px';
  menu.style.top = my + 'px';
  menu.style.visibility = 'visible';
}

/** Farbstreifen, Papier und Knopf-Titel nachziehen, ohne alles neu zu zeichnen. */
function refreshPageSectionMarks() {
  const nb = getNb();
  if (!nb) return;
  for (const pgEl of QA('#pages-wrap .j-page')) {
    const info = getPage(pgEl.dataset.pgid);
    const sec = findSecForPage(pgEl.dataset.pgid, nb);
    const hdr = pgEl.querySelector('.j-page-hdr');
    if (sec) pgEl.style.setProperty('--sec-color', colorForSection(sec));
    else pgEl.style.removeProperty('--sec-color');
    if (hdr) hdr.classList.toggle('has-sec', !!sec);
    const btn = pgEl.querySelector('.pg-sec-btn');
    if (btn) btn.title = sec ? t('sectionOf').replace('{name}', sec.name) : t('setSection');

    /* Das Papier zieht beim Umetikettieren mit (setSectionOfPage). Ohne
       diese Zeilen stuende die neue Wahl zwar im Heft, zu sehen waere
       aber weiter die alte. */
    const page = info?.page;
    if (page && !page.bgImg) {
      const bg = page.bg || nb.defaultBg || 'ruled';
      if (!pgEl.classList.contains('bg-' + bg)) {
        // Nur die bg-Klasse tauschen; das Element traegt auch andere
        for (const cls of [...pgEl.classList]) {
          if (cls.startsWith('bg-')) pgEl.classList.remove(cls);
        }
        pgEl.classList.add('bg-' + bg);
        const txt = pgEl.querySelector('.j-text');
        if (txt && typeof applyTextLayoutForBg === 'function') applyTextLayoutForBg(txt, bg);
      }
    }
  }
}

function hidePgCtxMenu() { E('pg-ctx-menu').style.display = 'none'; document.removeEventListener('pointerdown', hidePgCtxOut); }
function hidePgCtxOut(e) { if (!e.target.closest('#pg-ctx-menu')) hidePgCtxMenu(); }

E('pgctx-bg').addEventListener('click', () => {
  hidePgCtxMenu();
  const cur = _pgCtxPage?.bg || getNb()?.defaultBg || 'ruled';
  _pgCtxBg = cur;
  buildBgRow(E('pg-bg-picker-row'), cur, id => { _pgCtxBg = id; });
  E('ov-pg-bg').style.display = 'flex';
});
E('pg-bg-cancel').addEventListener('click', () => E('ov-pg-bg').style.display = 'none');
E('pg-bg-ok').addEventListener('click', () => {
  E('ov-pg-bg').style.display = 'none';
  if (!_pgCtxPage || !_pgCtxEl) return;
  if (_pgCtxPage.bg === _pgCtxBg) return;   // nichts gewählt, nichts zu tun

  _pgCtxPage.bg = _pgCtxBg;

  /* Nur die bg-Klasse tauschen, nicht das ganze class-Attribut neu
     setzen: das Element traegt auch andere (obj-dragging), und die waeren
     danach weg. Dieselbe Vorsicht wie in refreshPageSectionMarks. */
  for (const cls of [..._pgCtxEl.classList]) {
    if (cls.startsWith('bg-')) _pgCtxEl.classList.remove(cls);
  }
  _pgCtxEl.classList.add('bg-' + _pgCtxBg);

  const t = _pgCtxEl.querySelector('.j-text');
  if (t) applyTextLayoutForBg(t, _pgCtxBg);

  /* ── Und das Heft gilt jetzt als geaendert ─────────────────────────
     Ohne diese Zeile war die neue Papierart nach dem Zumachen wieder
     weg. Gespeichert wird NUR, was AutoSave als schmutzig kennt: der
     Takt, der Heimknopf (core/dialogs.js) und die Titelleiste
     (ui/titlebar.js) fragen alle vorher isDirty(). Hier meldete es
     niemand, also schrieb auch niemand — und im geteilten Heft sah der
     andere die Aenderung nie, denn markDirty ist zugleich der Anstoss
     fuer Collab.noteChange. */
  if (window.markCurrentNotebookDirty) markCurrentNotebookDirty();
});

E('pgctx-clear').addEventListener('click', async () => {
  hidePgCtxMenu();
  if (!_pgCtxPage || !_pgCtxEl) return;
  if (!await showConfirm('Seite wirklich leeren?')) return;
  _pgCtxPage.textContent = ''; _pgCtxPage.inkStrokes = []; _pgCtxPage.objects = [];
  delete S.strokeHistory[_pgCtxPage.id];
  const t = _pgCtxEl.querySelector('.j-text'); if (t) t.innerHTML = '';
  const canvas = _pgCtxEl.querySelector('.j-canvas');
  if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  _pgCtxEl.querySelector('.j-objects').innerHTML = '';
  if (window.Collab) Collab.noteTextChange(_pgCtxPage.id, '');
  if (window.markCurrentNotebookDirty) markCurrentNotebookDirty();
});

E('pgctx-delete').addEventListener('click', async () => {
  hidePgCtxMenu();
  if (!_pgCtxPage) return;
  const nb = getNb(); if (!nb) return;
  /* Nur das HEFT braucht mindestens eine Seite. Frueher war die Sperre an
     den Abschnitt geknuepft – unter Etiketten waere das die falsche Frage,
     ein Etikett darf durchaus auf keiner Seite kleben. */
  if (notebookPages(nb).length <= 1) { await showAlert(t('lastPageStays')); return; }
  if (!await showConfirm(t('deletePage') + '?')) return;
  nb.pages = nb.pages.filter(p => p.id !== _pgCtxPage.id);
  syncSectionIds(nb);
  delete S.strokeHistory[_pgCtxPage.id];
  _pgCtxEl.remove();
  renumberVisiblePages();
  renderSideTree();
  // Fehlte: ohne das erreichte das Loeschen weder die Datei noch den Raum
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
});

