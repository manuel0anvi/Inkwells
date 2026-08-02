'use strict';

function getCanvasDpr() {
  return Math.max(2.5, Math.min(6, CFG.DPR * Math.max(1, getZoom())));
}

/* ══ ZOOM SYSTEM ═══════════════════════════════════════════
  - Pages are ALWAYS rendered at 794×1123px internally (never change)
  - Zoom = CSS transform:scale() on the pages-wrap
  - A "sizer" div behind pages-wrap holds the real scrollable height
  - Canvas coords: always divide by scale to map screen→canvas space
  - ≤100%: normal scroll (touch + mouse wheel)
  - >100%: pan with one finger (like photo gallery)
══════════════════════════════════════════════════════════ */
let _zoom = 1.2;           // 1.2 = 120% (default 100% is actually 120%)
const ZOOM_MIN = 0.25, ZOOM_MAX = 4.0;
const BASE_ZOOM = 1.2;
const VERTICAL_MAX_ZOOM = 0.99;
let _verticalAutoFit = true;
let _lastVerticalMode = window.innerHeight > window.innerWidth;

function getZoom() { return _zoom; }

function setZoom(z) {
  const sc = E('pg-scroll');
  let oldZ = _zoom;
  let unscaledY = 0;
  if (sc) {
    const paddingTop = 28;
    // calculate the actual center focus of the current scroll viewport (minus padding)
    const absoluteCenterY = sc.scrollTop + (sc.clientHeight / 2) - paddingTop;
    unscaledY = absoluteCenterY / oldZ;
  }
  
  _zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  _applyZoom();
  
  if (sc) {
    const paddingTop = 28;
    const actualNewCenterY = unscaledY * _zoom + paddingTop;
    sc.scrollTop = actualNewCenterY - (sc.clientHeight / 2);
  }
}

function isVerticalMode() {
  return window.innerHeight > window.innerWidth;
}

function getVerticalFitZoom() {
  const sc = E('pg-scroll');
  if (!sc) return null;
  const availW = Math.max(1, sc.clientWidth - 16);
  const availH = Math.max(1, sc.clientHeight - 16);
  const fit = Math.min(availW / CFG.PAGE_W, availH / CFG.PAGE_H);
  return Math.max(ZOOM_MIN, Math.min(VERTICAL_MAX_ZOOM, fit));
}

function _applyZoom() {
  if (isVerticalMode() && _verticalAutoFit) {
    const fitZoom = getVerticalFitZoom();
    if (fitZoom) _zoom = fitZoom;
  }
  const z = _zoom, pw = E('pages-wrap');
  if (!pw) return;
  pw.style.transform = 'scale(' + z + ')';
  pw.style.transformOrigin = 'top center';
  // Update the sizer so the scroll container has the right height
  const sizer = E('pg-sizer');
  if (sizer) {
    const totalH = pw.scrollHeight || (CFG.PAGE_H * Math.max(1, pw.children.length));
    sizer.style.height = Math.round(totalH * z) + 'px';
  }
    const ta = z > 1.21 ? 'none' : 'pan-y';
  pw.style.touchAction = ta;
  document.querySelectorAll('.j-canvas').forEach(c => c.style.touchAction = ta);
  const sc = E('pg-scroll');
  if (sc) { sc.style.overflow = ''; sc.style.touchAction = ta; }
  const lbl = E('btn-zoom-reset');
  if (lbl) lbl.textContent = Math.round((z / BASE_ZOOM) * 100) + '%';
  if (z <= 1.21 && typeof window.resetPan === 'function') window.resetPan();
  rerenderCanvasesForZoom();
  updateAddPageBtnVisibility();
  if (typeof updateCursor === 'function') updateCursor();
}

function rerenderCanvasesForZoom() {
  const dpr = getCanvasDpr();
  QA('.j-page').forEach(pgEl => {
    const canvas = pgEl.querySelector('.j-canvas:not(.live-canvas)');
    if (!canvas) return;
    // Entlastete Zeichenflächen überspringen – sie werden beim Heranscrollen
    // ohnehin in der dann gültigen Auflösung neu aufgebaut
    if (window.PageCanvases?.isUnloaded(canvas)) return;
    const pgId = pgEl.dataset.pgid;
    const info = getPage(pgId);
    const targetW = info?.page?.w || CFG.PAGE_W;
    const targetH = info?.page?.h || CFG.PAGE_H;
    
    const w = Math.round(targetW * dpr), h = Math.round(targetH * dpr);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = targetW + 'px';
    canvas.style.height = targetH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    redrawStrokes(canvas, S.strokeHistory[pgId] || []);
  });
}

function zoomIn() {
  if (isVerticalMode()) _verticalAutoFit = false;
  setZoom(_zoom * 1.25);
}

function zoomOut() {
  if (isVerticalMode()) _verticalAutoFit = false;
  setZoom(_zoom / 1.25);
}

function zoomReset() {
  if (isVerticalMode()) {
    _verticalAutoFit = true;
    _applyZoom();
    return;
  }
  _verticalAutoFit = false;
  setZoom(BASE_ZOOM);
}

function panThreshold() { return 1.21; }

function refreshSizer() {
  requestAnimationFrame(() => {
    const pw = E('pages-wrap'); const sizer = E('pg-sizer'); if (!pw || !sizer) return;
    sizer.style.height = Math.round(pw.offsetHeight * _zoom) + 'px';
    updateAddPageBtnVisibility();
  });
}

window.addEventListener('resize', () => {
  const nowVertical = isVerticalMode();
  if (nowVertical && !_lastVerticalMode) _verticalAutoFit = true;
  _lastVerticalMode = nowVertical;
  _applyZoom();
}, { passive: true });
