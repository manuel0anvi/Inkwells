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
/* ══════════════════════════════════════════════════════════════════════
   WOHIN EINE LINIE ZEIGT

   Die Enden liegen als Anteile 0…1 im umschliessenden Rechteck: p1 ist
   der Anfang, p2 das Ende.

   >>> Warum nicht einfach die Diagonale <<<
   Genau das war es vorher: von unten links nach oben rechts, fest
   verdrahtet. Eine Linie nach unten rechts war damit nicht zu zeichnen –
   sie kam immer verkehrt heraus. Und zum Verlaengern musste man am
   Rahmen ziehen wie an einem Bild, statt am Ende der Linie selbst.

   Fehlen die Werte (Formen aus aelteren Heften), gilt weiter die alte
   Diagonale – so sieht dort nichts anders aus als vorher. */
function shapeEnden(obj) {
  const p1 = obj && obj.p1;
  const p2 = obj && obj.p2;
  if (p1 && p2 && typeof p1.x === 'number' && typeof p2.x === 'number') {
    return { p1, p2 };
  }
  return { p1: { x: 0, y: 1 }, p2: { x: 1, y: 0 } };
}

function buildShapeSvg(type, w, h, fill, stroke, strokeWidth, obj) {
  const pad = strokeWidth / 2;
  const pw = Math.max(1, w), ph = Math.max(1, h);
  const inner = 'x="' + pad + '" y="' + pad + '" width="' + Math.max(0, pw - pad * 2) + '" height="' + Math.max(0, ph - pad * 2) + '"';

  /* Die Enden auf das Rechteck abbilden, aber innerhalb des Randes
     bleiben – ein dicker Strich wuerde sonst an den Kanten beschnitten. */
  const enden = shapeEnden(obj);
  const auf = (a, ganz) => pad + a * Math.max(0, ganz - pad * 2);
  const x1 = auf(enden.p1.x, pw), y1 = auf(enden.p1.y, ph);
  const x2 = auf(enden.p2.x, pw), y2 = auf(enden.p2.y, ph);

  let form = '';
  switch (type) {
    case 'rect':
      form = '<rect ' + inner + ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" rx="2"/>';
      break;
    case 'ellipse':
      form = '<rect ' + inner + ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" rx="50%"/>';
      break;
    case 'line':
      form = '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" stroke-linecap="round"/>';
      break;
    case 'arrow': {
      /* Die Kennung muss je Form eindeutig sein: zwei Pfeile derselben
         Farbe auf einer Seite teilten sich sonst eine Markierung, und die
         zweite verschwand, sobald die erste geloescht wurde. */
      const markerId = 'ah-' + (stroke.replace(/[^a-zA-Z0-9]/g, ''))
        + '-' + String((obj && obj.id) || '0').replace(/[^a-zA-Z0-9]/g, '');
      form = '<defs><marker id="' + markerId + '" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, 8 3, 0 6" fill="' + stroke + '"/></marker></defs>'
        + '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" stroke-linecap="round" marker-end="url(#' + markerId + ')"/>';
      break;
    }
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + pw + ' ' + ph + '" width="' + pw + '" height="' + ph + '" style="display:block;overflow:visible">' + form + '</svg>';
}

/* ── Vorschau während des Aufziehens ────────────────────────────────── */

function ensurePreview() {
  if (_shapePreview) return;
  _shapePreview = document.createElement('div');
  _shapePreview.className = 'shape-preview';
  _shapePreview.style.cssText = 'position:absolute;pointer-events:none;z-index:5500;border:2px dashed #666;background:rgba(0,0,0,0.05);display:none';
  // Die Vorschau liegt im Seiten-Element, damit sie beim Zoomen mitgeht
}

function showPreview(pageEl, x, y, w, h, type, enden) {
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
    // Mit den echten Enden, damit die Vorschau zeigt, was entsteht
    _shapePreview.innerHTML = buildShapeSvg(type, w, h, 'none', '#666', 2, enden);
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
    // Bei Linien ist das Rechteck die Bounding-Box; die Richtung steckt
    // in den Anteilen p1/p2 (siehe shapeEnden)
    const bw = Math.max(w, 1), bh = Math.max(h, 1);
    const enden = {
      p1: { x: (_shapeStart.x - x) / bw, y: (_shapeStart.y - y) / bh },
      p2: { x: (cur.x - x) / bw, y: (cur.y - y) / bh }
    };
    showPreview(pageEl, x, y, bw, bh, type, enden);
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

  /* Bei Linie und Pfeil zaehlt die RICHTUNG, in die gezogen wurde, nicht
     nur das umschliessende Rechteck. Vorher lief jede Linie von unten
     links nach oben rechts – eine nach unten rechts gezogene kam
     spiegelverkehrt heraus. */
  if (type === 'line' || type === 'arrow') {
    const bw = obj.w, bh = obj.h;
    obj.p1 = { x: bw ? (_shapeStart.x - x) / bw : 0, y: bh ? (_shapeStart.y - y) / bh : 0 };
    obj.p2 = { x: bw ? (cur.x - x) / bw : 1, y: bh ? (cur.y - y) / bh : 1 };
  }

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

  return buildShapeSvg(type, w, h, fill, stroke, strokeWidth, obj);
}

/* ── Form-spezifisches Chrome (Farbe, Linienstärke) ─────────────────── */

/**
 * Erweitert die Objekt-Leiste um Form-spezifische Knöpfe:
 * Füllfarbe, Linienfarbe, Linienstärke.
 *
 * Wird von placeObject() aufgerufen, nachdem die Standard-Leiste gebaut ist.
 */
function addShapeChrome(bar, obj, page, objLayer) {
  const body = () => {
    const wrap = bar.closest('.obj-wrap');
    return wrap ? wrap.querySelector('.obj-body') : null;
  };

  const neuZeichnen = () => {
    const b = body();
    if (b) b.innerHTML = renderShapeBody(obj);
    if (typeof noteObjectChanged === 'function') noteObjectChanged();
    updateUndoRedoUI();
  };

  // Linien und Pfeile haben keine Fläche, die man füllen könnte
  const flaechig = obj.shapeType !== 'line' && obj.shapeType !== 'arrow';

  /* ── Füllung ────────────────────────────────────────────────────────
     Ein Knopf zeigt die aktuelle Farbe und öffnet das Farb-Popover mit
     nativem Picker, zuletzt verwendeten Farben und Hex-Code. */
  if (flaechig) {
    const fuellWahl = document.createElement('div');
    fuellWahl.className = 'obj-fill-row';
    fuellWahl.style.gap = '4px';

    const aktFarbe = obj.fill || 'none';

    const fuellBtn = document.createElement('button');
    fuellBtn.type = 'button';
    fuellBtn.className = 'obj-color-btn';
    fuellBtn.style.cssText = 'width:15px;height:15px;border-radius:4px;border:none;cursor:pointer;padding:0;flex-shrink:0';
    if (aktFarbe === 'none') {
      fuellBtn.style.background = 'repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%) 50% / 8px 8px';
      fuellBtn.title = (typeof t === 'function' && t('shapeFillNone')) || 'Ohne Füllung';
    } else {
      fuellBtn.style.background = aktFarbe;
      fuellBtn.title = aktFarbe;
    }
    fuellBtn.addEventListener('pointerdown', ev => ev.stopPropagation());
    fuellBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (typeof openCustomColorPopover !== 'function') return;
      openCustomColorPopover('shape-fill', fuellBtn, (c, final) => {
        obj.fill = c;
        fuellBtn.style.background = c;
        fuellBtn.title = c;
        if (final) { pushPageHistory(page); neuZeichnen(); }
      });
    });
    fuellWahl.appendChild(fuellBtn);

    // Knopf für „ohne Füllung"
    if (aktFarbe !== 'none') {
      const keineBtn = document.createElement('button');
      keineBtn.type = 'button';
      keineBtn.className = 'obj-fill-sw keine';
      keineBtn.title = (typeof t === 'function' && t('shapeFillNone')) || 'Ohne Füllung';
      keineBtn.addEventListener('pointerdown', ev => ev.stopPropagation());
      keineBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        pushPageHistory(page);
        obj.fill = 'none';
        fuellBtn.style.background = 'repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%) 50% / 8px 8px';
        fuellBtn.title = (typeof t === 'function' && t('shapeFillNone')) || 'Ohne Füllung';
        neuZeichnen();
      });
      fuellWahl.appendChild(keineBtn);
    }

    bar.appendChild(fuellWahl);
  }

  /* ── Linienfarbe ────────────────────────────────────────────────────
     Ein Knopf zeigt die aktuelle Farbe und öffnet das Farb-Popover. */
  {
    const strichWahl = document.createElement('div');
    strichWahl.className = 'obj-fill-row';
    strichWahl.style.gap = '4px';

    const aktStrich = obj.stroke || '#1a1510';

    const strichBtn = document.createElement('button');
    strichBtn.type = 'button';
    strichBtn.className = 'obj-color-btn';
    strichBtn.style.cssText = 'width:15px;height:15px;border-radius:4px;border:none;cursor:pointer;padding:0;flex-shrink:0';
    strichBtn.style.background = aktStrich;
    strichBtn.title = aktStrich;
    strichBtn.addEventListener('pointerdown', ev => ev.stopPropagation());
    strichBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (typeof openCustomColorPopover !== 'function') return;
      openCustomColorPopover('shape-stroke', strichBtn, (c, final) => {
        obj.stroke = c;
        strichBtn.style.background = c;
        strichBtn.title = c;
        if (final) { pushPageHistory(page); neuZeichnen(); }
      });
    });
    strichWahl.appendChild(strichBtn);

    bar.appendChild(strichWahl);
  }

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
      neuZeichnen();
    });

    bar.appendChild(btn);
  });
}
