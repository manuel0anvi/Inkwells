'use strict';

/* ══════════════════════════════════════════════════════════════════════
   FORMEN-WERKZEUG

   Geometrische Formen zeichnen wie in Word: Rechteck, Ellipse, Linie,
   Pfeil. Anders als Striche sind Formen Objekte in page.objects[] und
   lassen sich nachträglich verschieben, skalieren und drehen.

   Die Bedienung ist Aufziehen: Drücken, ziehen, loslassen. Während des
   Ziehens zeigt eine Vorschau den Umriss; beim Loslassen entsteht das
   Objekt.

   >>> Warum Formen und nicht Striche mit Form-Erkennung <<<
   Ein Strich wird nach dem Zeichnen erkannt und durch eine Form ersetzt
   (wie in GoodNotes). Das ist die zweite Wahl: der Nutzer hat dann einen
   Augenblick lang das Falsche gesehen und muss darauf vertrauen, dass
   gleich das Richtige daraus wird. Beim Aufziehen sieht er von Anfang an
   die Form – und er kann sie korrigieren, bevor er loslässt.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Zustand während des Aufziehens ─────────────────────────────────── */
let _shapeStart = null;       // { x, y } – Seitenkoordinaten
let _shapePreview = null;     // das Vorschau-Element
let _shapePage = null;        // die Seite, auf der gezeichnet wird
let _shapeCanvas = null;      // der Leinwand-Knoten (für pointer-Events)

/* ── Standardwerte ──────────────────────────────────────────────────── */
const SHAPE_DEFAULTS = {
  fill: 'none',
  stroke: '#1a1510',
  strokeWidth: 2
};

/**
 * SVG für eine Form bauen – das Innere des Objekts.
 *
 * Wird sowohl für die Vorschau als auch für das fertige Objekt benutzt.
 * viewBox ist 0 0 w h; die Form füllt sie aus (mit etwas Rand für den
 * Strich, der sonst an den Rändern abgeschnitten würde).
 */
function buildShapeSvg(type, w, h, fill, stroke, strokeWidth) {
  const pad = strokeWidth / 2;
  const pw = w, ph = h;
  const inner = 'x="' + pad + '" y="' + pad + '" width="' + Math.max(0, pw - pad * 2) + '" height="' + Math.max(0, ph - pad * 2) + '"';

  let form = '';
  switch (type) {
    case 'rect':
      form = '<rect ' + inner + ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" rx="2"/>';
      break;
    case 'ellipse':
      form = '<rect ' + inner + ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" rx="50%"/>';
      break;
    case 'line': {
      const x1 = pad, y1 = ph - pad, x2 = pw - pad, y2 = pad;
      form = '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" stroke-linecap="round"/>';
      break;
    }
    case 'arrow': {
      const x1 = pad, y1 = ph - pad, x2 = pw - pad, y2 = pad;
      const markerId = 'arrowhead-' + (stroke.replace(/[^a-zA-Z0-9]/g, ''));
      form = '<defs><marker id="' + markerId + '" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="' + stroke + '"/></marker></defs>'
        + '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" stroke-linecap="round" marker-end="url(#' + markerId + ')"/>';
      break;
    }
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + pw + ' ' + ph + '" width="' + pw + '" height="' + ph + '" style="display:block">' + form + '</svg>';
}

/* ── Vorschau während des Aufziehens ────────────────────────────────── */

function ensurePreview() {
  if (_shapePreview) return;
  _shapePreview = document.createElement('div');
  _shapePreview.className = 'shape-preview';
  _shapePreview.style.cssText = 'position:absolute;pointer-events:none;z-index:5500;border:2px dashed #666;background:rgba(0,0,0,0.05);display:none';
  // Die Vorschau liegt im Seiten-Element, damit sie beim Zoomen mitgeht
}

function showPreview(pageEl, x, y, w, h, type) {
  ensurePreview();
  if (_shapePreview.parentElement !== pageEl) pageEl.appendChild(_shapePreview);

  _shapePreview.style.display = 'block';
  _shapePreview.style.left = x + 'px';
  _shapePreview.style.top = y + 'px';
  _shapePreview.style.width = w + 'px';
  _shapePreview.style.height = h + 'px';

  if (type === 'ellipse') {
    _shapePreview.style.borderRadius = '50%';
    _shapePreview.style.border = '2px dashed #666';
    _shapePreview.innerHTML = '';
  } else if (type === 'line' || type === 'arrow') {
    _shapePreview.style.borderRadius = '0';
    _shapePreview.style.border = 'none';
    _shapePreview.style.background = 'transparent';
    _shapePreview.innerHTML = buildShapeSvg(type, w, h, 'none', '#666', 2);
  } else {
    _shapePreview.style.borderRadius = '2px';
    _shapePreview.style.border = '2px dashed #666';
    _shapePreview.style.background = 'rgba(0,0,0,0.05)';
    _shapePreview.innerHTML = '';
  }
}

function hidePreview() {
  if (_shapePreview) {
    _shapePreview.style.display = 'none';
    if (_shapePreview.parentElement) _shapePreview.remove();
    _shapePreview = null;
  }
}

/* ── Aufziehen ──────────────────────────────────────────────────────── */

/**
 * Form-Aufziehen beginnen.
 *
 * Wird von input.js aus handleDrawStart aufgerufen, wenn S.mode === 'shape'.
 */
function startShapeDraw(e, page, canvas) {
  if (S.readOnly) return;

  _shapeStart = coordsFromEvent(e, canvas);
  _shapePage = page;
  _shapeCanvas = canvas;

  S._shapeDrawing = true;
  S._drawPointerId = e.pointerId;
  e.preventDefault();
  try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* nicht schlimm */ }

  const textDiv = canvas.parentElement.querySelector('.j-text');
  if (textDiv) {
    textDiv.style.pointerEvents = 'none';
    textDiv.dataset.ph = '';
  }
  setActivePg(page.id);
}

function moveShapeDraw(e) {
  if (!_shapeStart || !_shapePage) return;
  e.preventDefault();

  const cur = coordsFromEvent(e, _shapeCanvas);
  const type = S.shapeType || 'rect';

  // Rechteck aus Start und aktueller Mausposition
  const x = Math.min(_shapeStart.x, cur.x);
  const y = Math.min(_shapeStart.y, cur.y);
  const w = Math.abs(cur.x - _shapeStart.x);
  const h = Math.abs(cur.y - _shapeStart.y);

  const pageEl = document.querySelector('[data-pgid="' + _shapePage.id + '"]');
  if (!pageEl) return;

  if (type === 'line' || type === 'arrow') {
    // Bei Linien ist das Rechteck die Bounding-Box
    showPreview(pageEl, x, y, Math.max(w, 1), Math.max(h, 1), type);
  } else {
    const minSize = 2;
    showPreview(pageEl, x, y, Math.max(w, minSize), Math.max(h, minSize), type);
  }
}

function endShapeDraw(e) {
  S._shapeDrawing = false;
  S._drawPointerId = null;

  if (!_shapeStart || !_shapePage || !_shapeCanvas) {
    hidePreview();
    _shapeStart = null;
    _shapePage = null;
    _shapeCanvas = null;
    return;
  }

  hidePreview();

  const cur = coordsFromEvent(e, _shapeCanvas);
  const type = S.shapeType || 'rect';

  let x = Math.min(_shapeStart.x, cur.x);
  let y = Math.min(_shapeStart.y, cur.y);
  let w = Math.abs(cur.x - _shapeStart.x);
  let h = Math.abs(cur.y - _shapeStart.y);

  // Keine unsichtbar kleinen Formen
  const MIN = 8;
  if (type === 'line' || type === 'arrow') {
    if (w < MIN && h < MIN) { cleanupShapeState(); return; }
  } else {
    if (w < MIN || h < MIN) { cleanupShapeState(); return; }
  }

  // Zustand vor dem Erstellen sichern
  pushPageHistory(_shapePage);

  const obj = {
    id: uid(),
    kind: 'shape',
    shapeType: type,
    x: x,
    y: y,
    w: Math.max(w, MIN),
    h: Math.max(h, MIN),
    rot: 0,
    fill: S.shapeFill || SHAPE_DEFAULTS.fill,
    stroke: S.shapeStroke || SHAPE_DEFAULTS.stroke,
    strokeWidth: S.shapeStrokeWidth || SHAPE_DEFAULTS.strokeWidth,
    layer: 'front'
  };

  const list = _shapePage.objects || (_shapePage.objects = []);
  list.push(obj);

  // Objekt auf der Seite platzieren
  const pageEl = document.querySelector('[data-pgid="' + _shapePage.id + '"]');
  if (pageEl) {
    const objLayer = pageEl.querySelector('.j-objects');
    if (objLayer && typeof placeObject === 'function') {
      placeObject(objLayer, obj, _shapePage);
    }
  }

  updateUndoRedoUI();
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();

  cleanupShapeState();
}

function cleanupShapeState() {
  _shapeStart = null;
  _shapePage = null;
  _shapeCanvas = null;
}

/**
 * Zeiger-Koordinaten in Seiten-Koordinaten umrechnen.
 * Dasselbe wie coords() in input.js, hier wiederholt, damit shapes.js
 * unabhängig bleibt.
 */
function coordsFromEvent(e, canvas) {
  const r = canvas.getBoundingClientRect();
  const pw = _shapePage ? (_shapePage.w || CFG.PAGE_W) : CFG.PAGE_W;
  const ph = _shapePage ? (_shapePage.h || CFG.PAGE_H) : CFG.PAGE_H;
  const scaleX = pw / r.width;
  const scaleY = ph / r.height;
  return {
    x: (e.clientX - r.left) * scaleX,
    y: (e.clientY - r.top) * scaleY
  };
}

/* ── Form-Objekt rendern (für placeObject) ──────────────────────────── */

/**
 * Baut das innere HTML für ein Form-Objekt.
 *
 * Wird von placeObject() in objects.js aufgerufen, wenn obj.kind === 'shape'.
 * Gibt einen HTML-String zurück, der in .obj-body eingesetzt wird.
 */
function renderShapeBody(obj) {
  const type = obj.shapeType || 'rect';
  const w = obj.w || 100;
  const h = obj.h || 100;
  const fill = obj.fill || 'none';
  const stroke = obj.stroke || '#1a1510';
  const strokeWidth = obj.strokeWidth || 2;

  return buildShapeSvg(type, w, h, fill, stroke, strokeWidth);
}

/* ── Form-spezifisches Chrome (Farbe, Linienstärke) ─────────────────── */

/**
 * Erweitert die Objekt-Leiste um Form-spezifische Knöpfe:
 * Füllfarbe, Linienfarbe, Linienstärke.
 *
 * Wird von placeObject() aufgerufen, nachdem die Standard-Leiste gebaut ist.
 */
function addShapeChrome(bar, obj, page, objLayer) {
  // Füllfarbe umschalten: none ↔ current
  const btnFill = document.createElement('button');
  btnFill.type = 'button';
  btnFill.className = 'obj-bar-btn';
  btnFill.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="currentColor" opacity=".5"/><path d="M7 2v6l2-2 2 2V2" fill="currentColor"/></svg>';
  btnFill.title = (typeof t === 'function' && t('shapeFill')) || 'Füllung';
  btnFill.setAttribute('aria-label', btnFill.title);
  btnFill.classList.toggle('active', obj.fill !== 'none');

  btnFill.addEventListener('click', ev => {
    ev.stopPropagation();
    pushPageHistory(page);
    obj.fill = obj.fill === 'none' ? (S.shapeFill || '#e8e0d0') : 'none';
    btnFill.classList.toggle('active', obj.fill !== 'none');
    // SVG im Body neu bauen
    const body = bar.closest('.obj-wrap').querySelector('.obj-body');
    if (body) body.innerHTML = renderShapeBody(obj);
    if (typeof noteObjectChanged === 'function') noteObjectChanged();
    updateUndoRedoUI();
  });

  bar.appendChild(btnFill);

  // Linienstärke: drei Knöpfe (1px, 2px, 4px)
  [1, 2, 4].forEach(sw => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'obj-bar-btn';
    if (obj.strokeWidth === sw) btn.classList.add('active');
    btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round"/></svg>';
    btn.title = sw + 'px';
    btn.setAttribute('aria-label', sw + 'px');

    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      pushPageHistory(page);
      obj.strokeWidth = sw;
      // Alle drei Knöpfe aktualisieren
      bar.querySelectorAll('.obj-bar-btn').forEach(b => {
        if (b.title === '1px' || b.title === '2px' || b.title === '4px') {
          b.classList.toggle('active', b.title === sw + 'px');
        }
      });
      const body = bar.closest('.obj-wrap').querySelector('.obj-body');
      if (body) body.innerHTML = renderShapeBody(obj);
      if (typeof noteObjectChanged === 'function') noteObjectChanged();
      updateUndoRedoUI();
    });

    bar.appendChild(btn);
  });
}
