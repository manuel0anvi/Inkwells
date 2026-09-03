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

/* ══════════════════════════════════════════════════════════════════════
   DER GEWÜNSCHTE ZOOM UND DER, DER WIRKLICH GILT

   `_zoom` ist, was der Nutzer eingestellt hat. `_wirksam` ist, was davon
   auf dem Blatt ankommt – und das ist im schmalen Fenster weniger.

   >>> Warum es diesen Unterschied braucht <<<
   Im Querformat blieb es bei den 1,2, wie breit das Fenster auch war.
   Bei der kleinsten erlaubten Breite (820 px, siehe minWidth in main.js)
   ist die Seite damit 953 px breit und der Rahmen 757 – sie ragt links
   und rechts hinaus. Herankommen konnte man an das Abgeschnittene
   NICHT: #pg-scroll hat overflow-x: hidden, und das Schieben mit dem
   Finger fängt erst über panThreshold() an, also über 1,21. Der Anfang
   jeder Zeile war damit unerreichbar – aus „Kapitel 1" wurde „apitel 1".
   Ein halb auf den Schirm geschobenes Fenster auf einem 1366er Laptop
   reicht schon dafür.

   Begrenzt wird deshalb genau dort, wo man sich nicht behelfen kann:
   solange der Wunsch nicht über panThreshold() liegt. Wer ausdrücklich
   weiter hineinzoomt, bekommt sein Übermass – dort darf er schieben.

   Und `_zoom` bleibt dabei unangetastet. Sonst stünde nach dem
   Breiterziehen des Fensters immer noch der kleine Wert da, ohne dass
   jemand ihn eingestellt hätte – derselbe Fall, der weiter unten beim
   Umklappen ins Hochformat beschrieben ist.
   ══════════════════════════════════════════════════════════════════════ */
let _wirksam = _zoom;

/** Der grösste Zoom, bei dem die Seite noch ganz in den Rahmen passt. */
function getFitZoom() {
  const sc = E('pg-scroll');
  if (!sc || !sc.clientWidth) return null;
  return sc.clientWidth / CFG.PAGE_W;
}

function getZoom() { return _wirksam; }

function setZoom(z) {
  const sc = E('pg-scroll');
  // Gerechnet wird mit dem Zoom, der WIRKLICH gilt – sonst springt die
  // Ansicht im schmalen Fenster, wo Wunsch und Wirkung auseinandergehen.
  let oldZ = _wirksam;
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
    const actualNewCenterY = unscaledY * _wirksam + paddingTop;
    sc.scrollTop = actualNewCenterY - (sc.clientHeight / 2);
  }
}

function isVerticalMode() {
  return window.innerHeight > window.innerWidth;
}

/**
 * Der Zoom, mit dem die Seite im Hochformat empfangen wird.
 *
 * >>> Eingepasst wird die BREITE, nicht die ganze Seite <<<
 * Hier stand `Math.min(breite, hoehe)` – die ganze Seite musste also
 * hineinpassen, Höhe eingeschlossen. Eine A4-Seite ist 1123 px hoch; auf
 * einem Laptop bleiben davon gut 800, macht rund 70 % – und weil die
 * Grundgröße 1,2 ist, standen als Anzeige knapp 60 %. Gemeldet wurde das
 * als „auf dem Laptop ist der Zoom ganz klein eingestellt", und das ist
 * es auch: Text in 10 px liest niemand gern.
 *
 * Eingepasst wird deshalb die Breite. Die Seite füllt den Schirm, und
 * geblättert wird wie überall sonst auch – auf Papier sieht man ja
 * ebenfalls nicht immer das ganze Blatt. Wer die ganze Seite sehen will,
 * zieht sie mit zwei Fingern kleiner.
 */
function getVerticalFitZoom() {
  const sc = E('pg-scroll');
  if (!sc) return null;
  const availW = Math.max(1, sc.clientWidth - 16);
  const fit = availW / CFG.PAGE_W;
  return Math.max(ZOOM_MIN, Math.min(VERTICAL_MAX_ZOOM, fit));
}

function _applyZoom() {
  if (isVerticalMode() && _verticalAutoFit) {
    const fitZoom = getVerticalFitZoom();
    if (fitZoom) _zoom = fitZoom;
  }

  /* Im Querformat nie breiter als der Rahmen – aber nur, solange man
     ohnehin nicht schieben könnte (siehe oben bei _wirksam). */
  _wirksam = _zoom;
  if (!isVerticalMode() && _zoom <= panThreshold()) {
    const passt = getFitZoom();
    if (passt && passt < _zoom) _wirksam = Math.max(ZOOM_MIN, passt);
  }

  const z = _wirksam, pw = E('pages-wrap');
  if (!pw) return;
  pw.style.transform = 'scale(' + z + ')';
  pw.style.transformOrigin = 'top center';
  // Update the sizer so the scroll container has the right height
  const sizer = E('pg-sizer');
  if (sizer) {
    const totalH = pw.scrollHeight || (CFG.PAGE_H * Math.max(1, pw.children.length));
    sizer.style.height = Math.round(totalH * z) + 'px';
  }
  /* ══ WER DIE FINGERBEWEGUNG BEKOMMT: BROWSER ODER STRICH ══
     touch-action entscheidet, ob der Browser aus einem gezogenen Finger
     ein Scrollen macht. Tut er das, bricht er den Strich nach wenigen
     Pixeln mit pointercancel ab.

     >>> Warum die Zeichenflaechen hier NICHTS mehr bekommen <<<
     Hier stand derselbe Wert fuer alles, also auch pan-y auf jeder
     .j-canvas – als INLINE-Stil. Damit kam die Regel aus css/pages.css
     (body.touch-draw .j-canvas { touch-action: none }) nie zum Zug, denn
     ein Inline-Stil schlaegt jedes Stylesheet. Ergebnis: mit dem Finger
     liess sich ueberhaupt nicht zeichnen, egal wie der Schalter stand.
     Die Zeichenflaechen entscheiden das jetzt allein ueber die Klasse am
     body (ui/toolbar.js) – nur beim Vergroessern muss es trotzdem von
     hier kommen, weil app.js das Schieben dann selbst uebernimmt. */
  const ta = z > 1.21 ? 'none' : 'pan-y';
  pw.style.touchAction = ta;
  document.querySelectorAll('.j-canvas').forEach(c => c.style.touchAction = z > 1.21 ? 'none' : '');
  const sc = E('pg-scroll');
  if (sc) { sc.style.overflow = ''; sc.style.touchAction = ta; }
  const prozent = Math.round((z / BASE_ZOOM) * 100) + '%';
  const lbl = E('btn-zoom-reset');
  if (lbl) lbl.textContent = prozent;
  if (z <= 1.21 && typeof window.resetPan === 'function') window.resetPan();
  rerenderCanvasesForZoom();
  updateAddPageBtnVisibility();
  if (typeof updateCursor === 'function') updateCursor();
  meldeZoom();
}

/* ══════════════════════════════════════════════════════════════════════
   WER SONST NOCH VOM ZOOM WISSEN MUSS

   Alles, was fest am Fenster hängt statt in #pages-wrap zu liegen, wird
   vom transform:scale() nicht mitskaliert und muss selbst nachrechnen –
   zurzeit ist das das Lineal (ui/ruler.js).

   >>> Warum ein Ereignis und kein ResizeObserver <<<
   Das Lineal hing an einem ResizeObserver auf #pages-wrap. Der meldet
   aber die LAYOUT-Größe, und die ändert ein transform nicht: beim Zoomen
   feuerte er nie. Das Lineal behielt seine Breite und seine
   Millimeter-Teilung, war also bei jedem anderen Zoom als dem, bei dem
   man es eingeschaltet hatte, schlicht falsch. Genau so wurde es
   gemeldet.
   ══════════════════════════════════════════════════════════════════════ */
function meldeZoom() {
  window.dispatchEvent(new CustomEvent('inkwells:zoom', { detail: { zoom: _zoom } }));
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
    sizer.style.height = Math.round(pw.offsetHeight * _wirksam) + 'px';
    updateAddPageBtnVisibility();
  });
}

/* ══════════════════════════════════════════════════════════════════════
   UMKLAPPEN UND ZURÜCK

   >>> Warum der Laptop danach „ganz klein eingestellt" war <<<
   Im Hochformat passt sich die Seite ein – das ist gewollt. Beim
   Zurückklappen ins Querformat blieb dieser eingepasste Wert aber
   einfach stehen: _applyZoom() rechnet nur im Hochformat neu, und
   niemand setzte ihn zurück. Der Laptop stand danach dauerhaft auf gut
   der Hälfte, ohne dass irgendetwas darauf hingedeutet hätte. Genau so
   wurde es gemeldet.

   Gemerkt wird deshalb, was im Querformat galt, und beim Zurückklappen
   gilt es wieder – auch ein von Hand eingestellter Wert.
   ══════════════════════════════════════════════════════════════════════ */
let _querZoom = BASE_ZOOM;

/* ══════════════════════════════════════════════════════════════════════
   WENN DER RAHMEN SCHMALER WIRD, MUSS DER ZOOM NACHRECHNEN

   Nicht nur beim Fenster: die Abschnittsleiste schiebt den Rahmen um
   230 px zusammen, und das ohne jedes resize-Ereignis.

   >>> Warum hier ein ResizeObserver richtig ist <<<
   Weiter oben steht, dass einer auf #pages-wrap nichts taugt – der
   meldet die LAYOUT-Groesse, und die aendert ein transform nicht. Hier
   ist es genau umgekehrt: gefragt ist die Layout-Breite des Rahmens, und
   das ist das Einzige, was ein ResizeObserver zuverlaessig liefert.

   setSidePanel() half sich vorher mit setTimeout(220) – die Leiste
   braucht 200 ms (css/sidebar.css). Gemessen wurde damit aber mitten in
   der Bewegung: bei 600 statt der endgueltigen 577 px. Danach rechnete
   niemand mehr nach, und die Seite blieb 53 px zu breit – abgeschnitten,
   und bei overflow-x: hidden nicht zu erreichen. Ein Beobachter trifft
   dagegen jeden Zwischenschritt UND den letzten; nebenbei passt sich die
   Seite dadurch waehrend der Bewegung mit an, statt am Ende zu springen.

   Die Breite wird gemerkt, damit die eigene Aenderung (der Balken zum
   Rollen kommt oder geht) nicht in eine Schleife laeuft.

   >>> Und warum nur im Querformat <<<
   Im Hochformat passt sich die Seite ohnehin schon ein
   (getVerticalFitZoom), und dort ist jede Breitenaenderung eine ANDERE
   Groesse: die Kommentarleiste macht den Rahmen schmaler, die Seite
   wuerde mitschrumpfen – und dadurch wuerde der Rand rechts davon
   BREITER als MIN_RAND. Genau daran entscheidet ui/comments.js, ob die
   Karten in die Leiste oder an den Rand gehoeren; sie sprangen also beim
   Antippen sofort wieder aus der Leiste heraus. test:touch hat das
   gefunden. Im Hochformat bleibt es deshalb beim Bisherigen: dort rechnet
   das resize-Ereignis nach, und die Abschnittsleiste sagt selbst Bescheid.
   ══════════════════════════════════════════════════════════════════════ */
(function beobachteRahmen() {
  if (typeof ResizeObserver !== 'function') return;
  const sc = E('pg-scroll');
  if (!sc) return;

  let zuletzt = sc.clientWidth;
  new ResizeObserver(() => {
    const jetzt = sc.clientWidth;
    if (!jetzt || jetzt === zuletzt) return;
    zuletzt = jetzt;
    if (isVerticalMode()) return;
    _applyZoom();
  }).observe(sc);
})();

window.addEventListener('resize', () => {
  const nowVertical = isVerticalMode();
  if (nowVertical && !_lastVerticalMode) {
    _querZoom = _zoom;
    _verticalAutoFit = true;
  }
  if (!nowVertical && _lastVerticalMode) {
    _verticalAutoFit = false;
    _zoom = _querZoom;
  }
  _lastVerticalMode = nowVertical;
  _applyZoom();
}, { passive: true });
