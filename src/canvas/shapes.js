'use strict';

/* ══════════════════════════════════════════════════════════════════════
   FORMEN-WERKZEUG

   Geometrische Formen zeichnen wie in Word: Rechteck, Ellipse, Linie,
   Pfeil. Anders als Striche sind Formen Objekte in page.objects[] und
   lassen sich nachträglich verschieben, skalieren und drehen.

   Die Bedienung ist Einsetzen, nicht Aufziehen: ein Druck im
   Formen-Fenster legt die Form auf die Seite, danach zieht man sie
   zurecht. Warum das so ist, steht unten bei „Eine Form einsetzen".

   >>> Warum Formen und nicht Striche mit Form-Erkennung <<<
   Ein Strich wird nach dem Zeichnen erkannt und durch eine Form ersetzt
   (wie in GoodNotes). Das ist die zweite Wahl: der Nutzer hat dann einen
   Augenblick lang das Falsche gesehen und muss darauf vertrauen, dass
   gleich das Richtige daraus wird. Eine eingesetzte Form ist von Anfang
   an die Form, die gemeint war.
   ══════════════════════════════════════════════════════════════════════ */

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
    /* Dazugekommen mit dem Glattziehen freihändig gemalter Formen
       (canvas/shapeSnap.js): ein gemaltes Dreieck wird ein Dreieck, und
       das braucht hier ein Gegenstück. Die Spitze zeigt nach oben – wie
       bei jedem Dreieck, das man von Hand aufs Blatt setzt.
       stroke-linejoin: round, sonst stehen bei dickem Strich spitze
       Zacken über die Ecken hinaus. */
    case 'triangle':
      form = '<polygon points="' + (pw / 2) + ',' + pad
        + ' ' + (pw - pad) + ',' + (ph - pad)
        + ' ' + pad + ',' + (ph - pad) + '"'
        + ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth
        + '" stroke-linejoin="round"/>';
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

/* ══════════════════════════════════════════════════════════════════════
   EINE FORM EINSETZEN

   >>> Hier stand das Aufziehen, und warum es weg ist <<<
   Formen waren ein WERKZEUG wie der Stift: Werkzeug wählen, auf der
   Seite drücken, ziehen, loslassen. Das kostete den Modus – wer eine
   Form wollte, verließ dafür den Text, und wer danach weiterschreiben
   wollte, musste daran denken, den Cursor zurückzuholen. Gemeldet wurde
   genau das: die Formen sollen sein wie die Tabelle.

   Und eine Tabelle zieht man nicht auf, man setzt sie ein. Genauso hier:
   ein Druck im Formen-Fenster legt die Form auf die Seite, in einer
   brauchbaren Größe und dort, wo man gerade hinsieht. Danach ist sie ein
   gewöhnliches Objekt – verschieben, in der Größe ziehen, drehen,
   färben, alles wie beim Bild und alles auch mit dem Finger
   (canvas/objects.js).

   Der Weg ist damit kürzer als vorher: ein Druck statt Werkzeugwechsel,
   Aufziehen und Zurückwechseln.
   ══════════════════════════════════════════════════════════════════════ */

/* Aufeinanderfolgende Formen versetzt hinlegen, wie Word es mit
   eingefügten Objekten tut – sonst liegt die zweite genau auf der ersten
   und es sieht aus, als wäre nichts geschehen. */
let _formenVersatz = 0;
const VERSATZ_SCHRITT = 18;
const VERSATZ_RUNDE = 5;

/**
 * Die Stelle auf der Seite, an der eine neue Form landen soll.
 *
 * Nicht die Seitenmitte: von einer A4-Seite ist auf einem Laptop die
 * Hälfte gar nicht zu sehen, und die Form entstünde außerhalb des
 * Blickfelds. Genommen wird die Mitte des SICHTBAREN Stücks.
 */
function formenPlatz(page, pageEl, w, h) {
  const pw = page.w || CFG.PAGE_W, ph = page.h || CFG.PAGE_H;
  let my = ph / 2;

  const sc = E('pg-scroll');
  if (pageEl && sc) {
    const pr = pageEl.getBoundingClientRect();
    const sr = sc.getBoundingClientRect();
    const massstab = pr.height / ph;
    if (massstab > 0) {
      const oben = Math.max(pr.top, sr.top);
      const unten = Math.min(pr.bottom, sr.bottom);
      if (unten > oben) my = ((oben + unten) / 2 - pr.top) / massstab;
    }
  }

  const versatz = (_formenVersatz % VERSATZ_RUNDE) * VERSATZ_SCHRITT;
  _formenVersatz++;

  /* Unterhalb des Seitenkopfes – dort gehoert nie etwas hin
     (core/state.js, CFG.HDR). */
  return {
    x: Math.max(8, Math.min(pw - w - 8, pw / 2 - w / 2 + versatz)),
    y: Math.max(CFG.HDR, Math.min(ph - h - 8, my - h / 2 + versatz))
  };
}

/**
 * Setzt eine Form auf die gerade offene Seite.
 *
 * @param {string} type rect | ellipse | line | arrow
 * @returns {boolean} ob es geklappt hat
 */
function insertShape(type) {
  if (S.readOnly) {
    if (typeof toast === 'function') toast(t('sharedNoRight'), true);
    return false;
  }

  const info = typeof getPage === 'function' ? getPage(S.activePgId) : null;
  if (!info || !info.page) return false;
  const page = info.page;
  const pageEl = document.querySelector('[data-pgid="' + page.id + '"]');

  /* Eine Größe, mit der man etwas anfangen kann: gut ein Viertel der
     Seitenbreite. Zu klein und man sucht die Griffe, zu groß und man
     zieht sie als Erstes wieder zusammen. */
  const pw = page.w || CFG.PAGE_W;
  const w = Math.round(pw * 0.26);
  const h = (type === 'line' || type === 'arrow') ? Math.round(w * 0.5) : Math.round(w * 0.68);

  pushPageHistory(page);

  const stelle = formenPlatz(page, pageEl, w, h);
  const obj = {
    id: uid(),
    kind: 'shape',
    shapeType: type,
    x: stelle.x,
    y: stelle.y,
    w: w,
    h: h,
    rot: 0,
    fill: S.shapeFill || SHAPE_DEFAULTS.fill,
    stroke: S.shapeStroke || SHAPE_DEFAULTS.stroke,
    strokeWidth: S.shapeStrokeWidth || SHAPE_DEFAULTS.strokeWidth,
    layer: 'front'
  };

  /* Linie und Pfeil zeigen von unten links nach oben rechts – dieselbe
     Voreinstellung, die shapeEnden() für Formen aus alten Heften
     annimmt. Wer sie anders haben will, zieht an den Enden. */
  if (type === 'line' || type === 'arrow') {
    obj.p1 = { x: 0, y: 1 };
    obj.p2 = { x: 1, y: 0 };
  }

  (page.objects || (page.objects = [])).push(obj);

  if (pageEl) {
    const objLayer = pageEl.querySelector('.j-objects');
    if (objLayer && typeof placeObject === 'function') placeObject(objLayer, obj, page);
  }

  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  return true;
}

window.insertShape = insertShape;

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
