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
  _pgCtxPage.bg = _pgCtxBg;
  _pgCtxEl.className = 'j-page bg-' + _pgCtxBg;
  const t = _pgCtxEl.querySelector('.j-text');
  if (t) applyTextLayoutForBg(t, _pgCtxBg);
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

