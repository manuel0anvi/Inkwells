'use strict';

/* ── TOOLBAR ── */
QA('.tb-mode[data-mode]').forEach(btn => { btn.addEventListener('click', () => switchMode(btn.dataset.mode)); });

/* ══════════════════════════════════════════════════════════════════════
   MIT DEM FINGER ZEICHNEN

   Aus, solange nichts anderes gesagt wird. Waere es an, liesse sich die
   Seite mit einem Finger nicht mehr bewegen, sobald ein Zeichenwerkzeug
   gewaehlt ist – und wer einen Stift hat, will genau das nicht.

   Der Knopf erscheint nur, wo es ueberhaupt einen Finger gibt. Auf einem
   Rechner ohne Beruehrungsschirm waere er eine Frage ohne Gegenstand.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const btn = E('btn-touch-draw');
  if (!btn) return;

  const hatFinger = (navigator.maxTouchPoints || 0) > 0
    || window.matchMedia('(pointer: coarse)').matches;
  if (!hatFinger) return;

  btn.style.display = '';

  const anwenden = () => {
    btn.classList.toggle('active', !!S.touchDraw);
    /* Beim Zeichnen mit dem Finger darf der Browser die Seite nicht
       gleichzeitig scrollen – sonst bleibt vom Strich ein Ruckeln. */
    document.body.classList.toggle('touch-draw', !!S.touchDraw);
  };

  S.touchDraw = !!(typeof Settings !== 'undefined' && Settings.get && Settings.get('touchDraw'));
  anwenden();

  btn.addEventListener('click', () => {
    S.touchDraw = !S.touchDraw;
    anwenden();
    toast(S.touchDraw ? t('touchDrawOn') : t('touchDrawOff'));
    if (typeof Settings !== 'undefined' && Settings.set) Settings.set('touchDraw', S.touchDraw);
  });

  // Die Einstellung wird erst nach dem Laden der Datei richtig bekannt
  if (typeof Settings !== 'undefined' && Settings.onChange) {
    Settings.onChange(s => {
      if (!!s.touchDraw === !!S.touchDraw) return;
      S.touchDraw = !!s.touchDraw;
      anwenden();
    });
  }
})();

/** Zeichnet der Finger gerade, statt zu scrollen? */
function touchDrawActive() {
  return !!S.touchDraw && !S._modeAuto
    && typeof isDrawMode === 'function' && isDrawMode(S.mode);
}

/* Pen color presets */
QA('.pen-sw[data-pcolor]').forEach(sw => {
  sw.addEventListener('click', () => {
    const c = sw.dataset.pcolor;
    if (S.mode === 'pen1') S.pen1.color = c;
    else if (S.mode === 'pen2') S.pen2.color = c;
    else if (S.mode === 'hl') S.hl.color = c;
    updatePenUI();
  });
});

function updatePenUI() {
  const m = S.mode, pen = m === 'pen1' ? S.pen1 : m === 'pen2' ? S.pen2 : m === 'hl' ? S.hl : null;
  if (!pen) return;
  if (!pen.customColor) pen.customColor = pen.color;
  E('pen-color-dot').style.background = pen.customColor;
  E('pen-color-in').value = pen.customColor;
  QA('#pen-sz-row .sz-btn').forEach(b => b.classList.toggle('active', +b.dataset.sz === pen.szIdx));
  let hasNorm = false;
  QA('.pen-sw[data-pcolor]').forEach(sw => {
    const isMatch = sw.dataset.pcolor === pen.color;
    sw.classList.toggle('active', isMatch);
    if (isMatch) hasNorm = true;
  });
  E('pen-color-ring').classList.toggle('active', !hasNorm);
}
let _customColorTarget = null;
let _customColorAnchor = null;
let _colorPressTimer = null;
let _colorLongPressed = false;
const _recentCustomColors = [];
const RECENT_CUSTOM_COLORS_MAX = 5;

function activePenState() {
  return S.mode === 'pen1' ? S.pen1 : S.mode === 'pen2' ? S.pen2 : S.mode === 'hl' ? S.hl : S.pen1;
}

function closeCustomColorPopover() {
  E('custom-color-pop').style.display = 'none';
  _customColorTarget = null;
  _customColorAnchor = null;
}

function positionCustomColorPopover(anchorEl) {
  const pop = E('custom-color-pop');
  if (!pop || !anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  pop.style.left = Math.round(r.left + r.width / 2) + 'px';
  pop.style.top = Math.round(r.bottom + 8) + 'px';
  pop.style.transform = 'translateX(-50%)';
}

function normalizeHexColor(color) {
  if (!color) return null;
  const hex = String(color).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

function currentCustomColor() {
  return normalizeHexColor(
    S.pen1.customColor ||
    S.pen2.customColor ||
    S.hl.customColor ||
    S.textCustomColor ||
    S.textColor
  );
}

function saveRecentCustomColor(color) {
  const hex = normalizeHexColor(color);
  if (!hex) return;
  const existingIndex = _recentCustomColors.indexOf(hex);
  if (existingIndex >= 0) _recentCustomColors.splice(existingIndex, 1);
  _recentCustomColors.unshift(hex);
  if (_recentCustomColors.length > RECENT_CUSTOM_COLORS_MAX) _recentCustomColors.length = RECENT_CUSTOM_COLORS_MAX;
}

function renderRecentCustomColors() {
  const wrap = E('custom-color-recent');
  if (!wrap) return;
  const colors = _recentCustomColors.slice(0, RECENT_CUSTOM_COLORS_MAX);
  wrap.innerHTML = '';
  if (!colors.length) {
    wrap.style.display = 'none';
    return;
  }
  colors.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-color-recent-btn';
    btn.title = color;
    btn.style.background = color;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const input = E('custom-color-pop-input');
      input.value = color;
      applyCustomColorValue(color, true);
    });
    wrap.appendChild(btn);
  });
  wrap.style.display = 'flex';
}

let _savedTextRange = null;

function openCustomColorPopover(target, anchorEl) {
  _customColorTarget = target;
  _customColorAnchor = anchorEl;
  
  if (target === 'text') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) _savedTextRange = sel.getRangeAt(0);
    else _savedTextRange = null;
  }

  const pop = E('custom-color-pop');
  const input = E('custom-color-pop-input');
  E('custom-color-pop-title').textContent = target === 'text' ? 'Textfarbe' : 'Eigene Stiftfarbe';
  input.value = currentCustomColor() || (target === 'text' ? (S.textCustomColor || S.textColor) : (activePenState().customColor || activePenState().color));
  if (_recentCustomColors.length === 0 && input.value) saveRecentCustomColor(input.value);
  pop.style.display = 'block';
  positionCustomColorPopover(anchorEl);
  renderRecentCustomColors();
}

function syncGlobalCustomColor(color, applyToSelection) {
  const c = normalizeHexColor(color);
  if (!c) return;
  S.pen1.customColor = c; S.pen1.color = c;
  S.pen2.customColor = c; S.pen2.color = c;
  S.hl.customColor = c; S.hl.color = c;
  S.textCustomColor = c; S.textColor = c;
  E('txt-color-dot').style.background = c;
  E('txt-custom-ring').classList.add('active');
  QA('.pen-sw[data-pcolor]').forEach(sw => sw.classList.remove('active'));
  QA('.pen-sw[data-tcolor]').forEach(sw => sw.classList.remove('active'));
  if (applyToSelection && _savedTextRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_savedTextRange);
  }
  if (applyToSelection) document.execCommand('foreColor', false, c);
  updatePenUI();
}

function applyCustomColorValue(color, commitHistory) {
  const c = normalizeHexColor(color);
  if (!c) return;
  syncGlobalCustomColor(c, _customColorTarget === 'text');
  if (commitHistory) {
    saveRecentCustomColor(c);
    renderRecentCustomColors();
  }
}

function applyPenCustomColor() {
  const c = currentCustomColor() || activePenState().customColor || activePenState().color;
  syncGlobalCustomColor(c, false);
}

function applyTextCustomColor() {
  const c = currentCustomColor() || S.textCustomColor || S.textColor;
  syncGlobalCustomColor(c, true);
  E('txt-color-dropdown').style.display = 'none';
}

function bindShortLongColorPress(el, onShort, onLong) {
  el.addEventListener('mousedown', e => e.preventDefault());
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    try { el.setPointerCapture(e.pointerId); } catch(err){}
    _colorLongPressed = false;
    clearTimeout(_colorPressTimer);
    _colorPressTimer = setTimeout(() => {
      _colorLongPressed = true;
      onLong(el);
    }, 1000); // 1 sekunde
  });
  const finish = e => {
    e.stopPropagation();
    try { el.releasePointerCapture(e.pointerId); } catch(err){}
    clearTimeout(_colorPressTimer);
    if (!_colorLongPressed) {
      _colorLongPressed = true; // prevent double firing
      onShort();
    }
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', e => {
    try { el.releasePointerCapture(e.pointerId); } catch(err){}
    clearTimeout(_colorPressTimer);
  });
}

bindShortLongColorPress(E('pen-color-ring'), applyPenCustomColor, anchor => openCustomColorPopover('pen', anchor));

E('custom-color-pop-input').addEventListener('input', function () {
  applyCustomColorValue(this.value, false);
});

E('custom-color-pop-input').addEventListener('change', function () {
  applyCustomColorValue(this.value, true);
});

E('custom-color-pop-close').addEventListener('click', e => {
  e.stopPropagation();
  closeCustomColorPopover();
});

QA('#pen-sz-row .sz-btn').forEach(btn => { btn.addEventListener('click', () => { const i = +btn.dataset.sz; if (S.mode === 'pen1') S.pen1.szIdx = i; else if (S.mode === 'pen2') S.pen2.szIdx = i; else if (S.mode === 'hl') S.hl.szIdx = i; QA('#pen-sz-row .sz-btn').forEach(b => b.classList.toggle('active', +b.dataset.sz === i)); }); });
QA('[data-eraser]').forEach(btn => { btn.addEventListener('click', () => { S.eraser.type = btn.dataset.eraser; QA('[data-eraser]').forEach(b => b.classList.remove('active')); btn.classList.add('active'); updateCursor(); }); });
QA('#er-sz-row .sz-btn').forEach(btn => { btn.addEventListener('click', () => { S.eraser.szIdx = +btn.dataset.esz; QA('#er-sz-row .sz-btn').forEach(b => b.classList.toggle('active', +b.dataset.esz === S.eraser.szIdx)); updateCursor(); }); });

function positionTextColorDropdown() {
  const dd = E('txt-color-dropdown');
  const anchor = E('txt-color-wrap') || E('txt-color-ring');
  if (!dd || !anchor) return;
  const r = anchor.getBoundingClientRect();
  dd.style.left = Math.round(r.left + r.width / 2) + 'px';
  dd.style.top = Math.round(r.bottom + 8) + 'px';
  dd.style.transform = 'translateX(-50%)';
}

/* Text color dropdown */
E('txt-color-dropdown').addEventListener('mousedown', e => e.preventDefault());
E('custom-color-pop').addEventListener('mousedown', e => e.preventDefault());
E('txt-color-ring').addEventListener('mousedown', e => e.preventDefault());
E('txt-color-ring').addEventListener('click', e => {
  e.stopPropagation();
  const dd = E('txt-color-dropdown');
  const willShow = dd.style.display === 'none';
  dd.style.display = willShow ? 'flex' : 'none';
  if (willShow) positionTextColorDropdown();
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#txt-color-dropdown') && !e.target.closest('#txt-color-ring')) {
    E('txt-color-dropdown').style.display = 'none';
  }
  if (!e.target.closest('#custom-color-pop') && !e.target.closest('#pen-color-ring') && !e.target.closest('#txt-custom-ring')) {
    closeCustomColorPopover();
  }
});
QA('.pen-sw[data-tcolor]').forEach(sw => {
  sw.addEventListener('mousedown', e => e.preventDefault());
  sw.addEventListener('click', () => {
    S.textColor = sw.dataset.tcolor;
    E('txt-color-dot').style.background = sw.dataset.tcolor;
    document.execCommand('foreColor', false, sw.dataset.tcolor);
    QA('.pen-sw[data-tcolor]').forEach(s => s.classList.toggle('active', s.dataset.tcolor === sw.dataset.tcolor));
    E('txt-custom-ring').classList.remove('active');
    E('txt-color-dropdown').style.display = 'none';
  });
});
bindShortLongColorPress(E('txt-custom-ring'), applyTextCustomColor, anchor => openCustomColorPopover('text', anchor));
E('txt-color-in').addEventListener('input', function () {
  S.textColor = this.value; E('txt-color-dot').style.background = this.value;
  S.textCustomColor = this.value;
  document.execCommand('foreColor', false, this.value);
  QA('.pen-sw[data-tcolor]').forEach(s => s.classList.remove('active'));
  E('txt-color-dropdown').style.display = 'none';
});
window.addEventListener('resize', positionTextColorDropdown, { passive: true });
E('pg-scroll').addEventListener('scroll', () => {
  if (E('txt-color-dropdown').style.display !== 'none') positionTextColorDropdown();
  if (E('custom-color-pop').style.display !== 'none' && _customColorAnchor) positionCustomColorPopover(_customColorAnchor);
}, { passive: true });

/* Heading toggles */
function curBlockTag() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const node = sel.anchorNode;
  const block = node?.nodeType === 3 ? node.parentElement : node;
  return block?.closest('[contenteditable] h1,[contenteditable] h2,[contenteditable] h3,[contenteditable] p,[contenteditable] div') || null;
}

function clearTitleClasses(block) {
  if (!block || !block.classList) return;
  block.classList.remove('j-title-1', 'j-title-2', 'j-title-3');
}

function getTitleLevel(block) {
  if (!block) return null;
  const tag = (block.tagName || '').toLowerCase();
  if (tag === 'h1') return 1;
  if (tag === 'h2') return 2;
  if (tag === 'h3') return 3;
  if (block.classList?.contains('j-title-1')) return 1;
  if (block.classList?.contains('j-title-2')) return 2;
  if (block.classList?.contains('j-title-3')) return 3;
  return null;
}

function normalizeActiveHeadingToLeft() {
  const block = curBlockTag();
  if (!block || !getTitleLevel(block)) return;
  const txt = block.textContent || '';
  const trimmed = txt.replace(/^[\s\u00A0]+/, '');
  if (trimmed !== txt) block.textContent = trimmed;
}

function toggleHeading(tag) {
  const targetLevel = tag === 'h1' ? 1 : tag === 'h2' ? 2 : 3;
  const current = curBlockTag();
  const currentLevel = getTitleLevel(current);
  
  // Undo/Redo-Logik entfernt
  
  document.execCommand('formatBlock', false, 'p');
  setTimeout(() => {
    const block = curBlockTag();
    if (!block) return;
    clearTitleClasses(block);
    if (currentLevel !== targetLevel) block.classList.add('j-title-' + targetLevel);
    normalizeActiveHeadingToLeft();
    updateHdrBtns();
    renderSideTree();
    // Sync page content after change
    if (info) {
      const pgEl = E('pages-wrap')?.querySelector('[data-pgid="' + info.page.id + '"]');
      const textDiv = pgEl?.querySelector('.j-text');
      if (textDiv) info.page.textContent = textDiv.innerHTML;
    }
  }, 50);
}

function updateHdrBtns() {
  const level = getTitleLevel(curBlockTag());
  E('fmt-h1').classList.toggle('active', level === 1);
  E('fmt-h2').classList.toggle('active', level === 2);
  E('fmt-h3').classList.toggle('active', level === 3);
  E('fmt-p').classList.toggle('active', !level);
  E('fmt-bold').classList.toggle('active', document.queryCommandState('bold'));
  E('fmt-italic').classList.toggle('active', document.queryCommandState('italic'));
  E('fmt-under').classList.toggle('active', document.queryCommandState('underline'));
}
E('fmt-p').addEventListener('mousedown', e => {
  e.preventDefault();
  
  // Undo/Redo-Logik entfernt
  
  document.execCommand('formatBlock', false, 'p');
  setTimeout(() => {
    const block = curBlockTag();
    clearTitleClasses(block);
    updateHdrBtns();
    renderSideTree();
    // Sync page content after change
    if (info) {
      const pgEl = E('pages-wrap')?.querySelector('[data-pgid="' + info.page.id + '"]');
      const textDiv = pgEl?.querySelector('.j-text');
      if (textDiv) info.page.textContent = textDiv.innerHTML;
    }
  }, 50);
});
E('fmt-h1').addEventListener('mousedown', e => { e.preventDefault(); toggleHeading('h1'); });
E('fmt-h2').addEventListener('mousedown', e => { e.preventDefault(); toggleHeading('h2'); });
E('fmt-h3').addEventListener('mousedown', e => { e.preventDefault(); toggleHeading('h3'); });
E('fmt-bold').addEventListener('mousedown', e => { e.preventDefault(); document.execCommand('bold'); setTimeout(updateHdrBtns, 0); });
E('fmt-italic').addEventListener('mousedown', e => { e.preventDefault(); document.execCommand('italic'); setTimeout(updateHdrBtns, 0); });
E('fmt-under').addEventListener('mousedown', e => { e.preventDefault(); document.execCommand('underline'); setTimeout(updateHdrBtns, 0); });
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  const node = sel && sel.rangeCount ? sel.anchorNode : null;
  const el = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
  if (document.activeElement?.classList?.contains('j-text') || el?.closest('.j-text')) {
    updateHdrBtns();
    renderSideTree();
  }
});






/* ── APPLY MODE ── */
function applyMode() {
  const ic = S.mode === 'cursor';
  QA('.j-canvas').forEach(c => c.style.pointerEvents = ic ? 'none' : 'auto');
  QA('.j-text').forEach(t => {
    t.style.pointerEvents = 'auto';
    t.contentEditable = ic ? 'true' : 'false';
  });
  QA('.j-objects').forEach(o => o.style.pointerEvents = 'none');
  // Nur das Bild schaltet um; die Bedienteile regeln sich über .obj-chrome
  QA('.obj-body').forEach(o => o.style.pointerEvents = ic ? 'auto' : 'none');
  updateCursor();
}

function updateCursor() {
  const ec = E('eraser-cursor');
  if (S.mode === 'eraser') {
    const r = ERASER_SIZES[S.eraser.szIdx];
    const z = getZoom();
    const size = Math.min(128, Math.max(8, Math.round(r * 2 * z)));
    if (ec) {
      ec.style.width = size + 'px';
      ec.style.height = size + 'px';
    }
    QA('.j-canvas').forEach(c => c.style.cursor = 'crosshair');
  } else {
    if (ec) ec.style.display = 'none';
    const cur = S.mode === 'cursor' ? 'text' : 'crosshair';
    QA('.j-canvas').forEach(c => c.style.cursor = cur);
  }
}

window.addEventListener('pointermove', e => {
  const ec = E('eraser-cursor');
  if (ec && S.mode === 'eraser') {
    if (e.pointerType === 'pen' && e.target.closest('.j-page')) {
      ec.style.display = 'block';
      ec.style.left = e.clientX + 'px';
      ec.style.top = e.clientY + 'px';
    } else {
      ec.style.display = 'none';
    }
  }
});

// Track last pen mode so pen auto-switch restores it
S._lastPenMode = 'pen1';

/* Wurde das Werkzeug vom Geraet gesetzt oder vom Nutzer gewaehlt?
   Daran haengt, ob die Maus zum Text zurueckspringt: hat der Stift
   umgeschaltet, war es nicht gemeint und die Maus schreibt wieder. Hat der
   Nutzer den Stift angeklickt, darf er auch mit der Maus zeichnen. */
S._modeAuto = false;

/** Malt dieses Werkzeug, statt Text zu setzen? */
function isDrawMode(mode) {
  return mode === 'pen1' || mode === 'pen2' || mode === 'hl' || mode === 'eraser';
}

/**
 * @param {string} mode
 * @param {{auto?: boolean}} [opts] auto = vom Eingabegeraet gesetzt,
 *   nicht vom Nutzer gewaehlt
 */
function switchMode(mode, opts = {}) {
  S.mode = mode;
  S._modeAuto = !!opts.auto;
  if (mode !== 'cursor' && mode !== 'eraser') S._lastPenMode = mode;
  /* Nur die Werkzeug-Knoepfe. Ohne den Zusatz [data-mode] loeschte jeder
     Werkzeugwechsel auch die Markierung am Finger-Schalter – der hat
     keinen Modus, sein dataset.mode ist undefined und passt nie. */
  QA('.tb-mode[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const isPen = mode === 'pen1' || mode === 'pen2' || mode === 'hl';
  E('pen-opts').style.display = isPen ? 'flex' : 'none';
  E('eraser-opts').style.display = mode === 'eraser' ? 'flex' : 'none';
  E('text-opts').style.display = mode === 'cursor' ? 'flex' : 'none';
  updatePenUI();
  applyMode();
  updateUndoRedoUI();
}

E('btn-undo')?.addEventListener('click', undoPage);
E('btn-redo')?.addEventListener('click', redoPage);

// Rückgängig/Wiederholen laufen jetzt über die änderbaren Kürzel
// (core/shortcuts.js) und rufen von dort undoPage()/redoPage() auf.

/* TOOLBAR mode/pen/color/heading controls moved to ui/toolbar.js */

