'use strict';

/* ══════════════════════════════════════════════════════════════════════
   LINEAL

   Eine durchsichtige Zeichenhilfe, die über der Seite liegt und nicht
   gespeichert wird. Lässt sich mit einem Finger oder der Maus
   verschieben; das Mausrad dreht sie.

   >>> Warum sie auf einem eigenen Canvas gemalt werden <<<
   Ein DOM-Element mit vielen kleinen Strichen wäre ein ganzes Heer von
   <div>-Elementen. Ein Canvas malt alle Markierungen in einem Rutsch und
   lässt sich mit einem einzigen CSS-transform drehen und verschieben.

   >>> Und warum sie position:fixed sind <<<
   Innerhalb der transformierten Seitenhülle (zoom) wäre fixed wirkungslos.
   Deshalb hängen sie direkt im body und rechnen ihre Lage bei jedem
   Scrollen und Zoomen selbst um.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  /* ── Maße ──────────────────────────────────────────────────────────── */
  const LINEAL_H = 58;           // CSS-Pixel, gesamte Höhe
  const LINEAL_H_PAD = 16;       // Platz über den Strichen (für Griff)

  /* Die Breite ist NICHT fest: das Lineal ist so lang wie die Seite breit
     ist. Ein 420 px langes Stück auf einer 953 px breiten Seite reicht für
     keinen Rand bis Rand gezogenen Strich – genau so wurde es gemeldet.
     Weil der Zoom die Seite skaliert, wird die Breite bei jeder
     Zoom-Änderung neu gerechnet (passeGroesseAn). */
  let linealBreite = 794;

  function seitenBreite() {
    const z = typeof getZoom === 'function' ? getZoom() : 1;
    return Math.max(200, Math.round((CFG.PAGE_W || 794) * z));
  }

  /* echte mm je CSS-Pixel. A4-Seite: 794 px / 210 mm ≈ 3,78 px/mm.
     Bei Zoom z: 1 mm = 3.78 * z px. */
  function pxJeMm() {
    const z = typeof getZoom === 'function' ? getZoom() : 1;
    return (CFG.PAGE_W || 794) / 210 * z;
  }

  /* Seiten-Mitte in Bildschirm-Koordinaten – da erscheint das Lineal. */
  function seitenMitte() {
    const wrap = E('pages-wrap');
    if (!wrap) return { x: 200, y: 300 };
    const r = wrap.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 180 };
  }

  /* ── Canvas anlegen ───────────────────────────────────────────────── */
  function neuesCanvas(w, h) {
    const dpr = typeof getCanvasDpr === 'function' ? getCanvasDpr() : (window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.style.cssText = 'position:fixed;z-index:700;pointer-events:auto;touch-action:none;display:none;'
      + 'width:' + w + 'px;height:' + h + 'px;';
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return { canvas: c, ctx: ctx, dpr: dpr };
  }

  /* ── Lineal malen ─────────────────────────────────────────────────── */
  const ln = neuesCanvas(linealBreite, LINEAL_H);
  document.body.appendChild(ln.canvas);

  /** Bringt das Canvas auf Seitenbreite. Gibt zurück, ob sich etwas
   *  geändert hat – dann muss neu gemalt werden. */
  function passeGroesseAn() {
    const w = seitenBreite();
    if (w === linealBreite) return false;
    linealBreite = w;

    const dpr = ln.dpr;
    ln.canvas.width = Math.round(w * dpr);
    ln.canvas.height = Math.round(LINEAL_H * dpr);
    ln.canvas.style.width = w + 'px';
    ln.canvas.style.height = LINEAL_H + 'px';
    // Das Setzen von width/height leert den Kontext samt Transformation
    ln.ctx.setTransform(1, 0, 0, 1, 0, 0);
    ln.ctx.scale(dpr, dpr);
    return true;
  }

  function maleLineal() {
    const ctx = ln.ctx;
    const dpr = ln.dpr;
    const w = linealBreite, h = LINEAL_H;
    const pmm = pxJeMm();
    const top = LINEAL_H_PAD;

    ctx.clearRect(0, 0, w * dpr, h * dpr);

    // Körper: abgerundetes Rechteck
    const pad = 2;
    ctx.fillStyle = 'rgba(245,235,200,0.88)';
    ctx.strokeStyle = 'rgba(160,130,70,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(pad, pad, w - pad * 2, h - pad * 2, 6);
    ctx.fill();
    ctx.stroke();

    // mm-Striche
    const maxMm = Math.floor((w - 20) / Math.max(pmm, 0.5));
    for (let mm = 0; mm <= maxMm; mm++) {
      const x = 10 + mm * pmm;
      if (x > w - 10) break;

      let len, sw, alpha;
      if (mm % 10 === 0) { len = 28; sw = 1.2; alpha = '0.9'; }
      else if (mm % 5 === 0) { len = 18; sw = 0.9; alpha = '0.7'; }
      else { len = 10; sw = 0.6; alpha = '0.55'; }

      ctx.strokeStyle = 'rgba(60,35,10,' + alpha + ')';
      ctx.lineWidth = sw;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + len);
      ctx.stroke();
    }

    // cm-Zahlen
    ctx.fillStyle = 'rgba(40,20,5,0.85)';
    ctx.font = '10px "DM Mono", monospace';
    ctx.textAlign = 'center';
    for (let cm = 0; cm <= Math.floor(maxMm / 10); cm++) {
      const x = 10 + cm * 10 * pmm;
      if (x > w - 10) break;
      ctx.fillText(String(cm), x, top + 38);
    }
  }

  /* ── Zustand ──────────────────────────────────────────────────────── */
  const lineal = { x: 200, y: 300, winkel: 0, an: false, gesetzt: false };

  function aktualisiereLinealPos() {
    ln.canvas.style.left = Math.round(lineal.x) + 'px';
    ln.canvas.style.top = Math.round(lineal.y) + 'px';
    ln.canvas.style.transform = 'rotate(' + (lineal.winkel || 0) + 'deg)';
  }

  /**
   * Einfache Bewegung: Ziehen mit einem Zeiger, Drehen mit dem Mausrad.
   *
   * Der Zeiger wird auf dem Canvas gefangen, damit die Seite darunter
   * nicht scrollt oder zeichnet, während das Lineal geschoben wird.
   */
  function einfacheBewegung(canvasEl, state, aktualisiereFn) {
    let aktive = null; // { id, lx, ly }

    canvasEl.addEventListener('pointerdown', e => {
      if (aktive) return;
      e.preventDefault();
      e.stopPropagation();
      canvasEl.setPointerCapture(e.pointerId);
      aktive = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
    });

    canvasEl.addEventListener('pointermove', e => {
      if (!aktive || aktive.id !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - aktive.lx;
      const dy = e.clientY - aktive.ly;
      state.x += dx;
      state.y += dy;
      aktive.lx = e.clientX;
      aktive.ly = e.clientY;
      aktualisiereFn();
    });

    const beenden = e => {
      if (!aktive || aktive.id !== e.pointerId) return;
      try { canvasEl.releasePointerCapture(e.pointerId); } catch (err) {}
      aktive = null;
    };
    canvasEl.addEventListener('pointerup', beenden);
    canvasEl.addEventListener('pointercancel', beenden);
    canvasEl.addEventListener('lostpointercapture', () => { aktive = null; });

    // Mausrad dreht: ohne Shift 1°-Schritte, mit Shift 15°-Schritte
    canvasEl.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      const schritt = e.shiftKey ? 15 : 1;
      state.winkel = (state.winkel || 0) + (e.deltaY > 0 ? schritt : -schritt);
      aktualisiereFn();
    }, { passive: false });
  }

  einfacheBewegung(ln.canvas, lineal, aktualisiereLinealPos);

  /* ── Neumalen bei Zoom-Änderung ────────────────────────────────────── */
  function beimZoomen() {
    if (!lineal.an) return;
    passeGroesseAn();   // Seitenbreite hat sich mit dem Zoom geändert
    maleLineal();
  }

  // Die App feuert kein eigenes Zoom-Ereignis. Der sicherste Weg ist,
  // einen ResizeObserver auf den Seiten-Umschlag zu setzen und bei jeder
  // Größenänderung neu zu malen.
  const wrap = E('pages-wrap');
  if (wrap && typeof ResizeObserver !== 'undefined') {
    let zoomTimer = 0;
    new ResizeObserver(() => {
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(beimZoomen, 150);
    }).observe(wrap);
  }

  /* ── Knöpfe in der Leiste ──────────────────────────────────────────── */

  function baueKnoepfe() {
    const zone = document.querySelector('.tb-right');
    if (!zone) return setTimeout(baueKnoepfe, 200);

    const sep = document.createElement('div');
    sep.className = 'tb-sep';

    const grp = document.createElement('div');
    grp.className = 'tb-grp';

    function knopf(id, text, titelKey, titelFallback, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = id;
      btn.className = 'tb-opt';
      btn.textContent = text;
      btn.title = (typeof t === 'function' && t(titelKey)) || titelFallback;
      btn.addEventListener('click', onClick);
      return btn;
    }

    const btnL = knopf('btn-ruler', '📏', 'ruler', 'Lineal', umschaltenLineal);
    grp.appendChild(btnL);

    // Vor den Pfeil-Knöpfen einfügen
    const prevBtn = E('btn-tb-prev');
    if (prevBtn) {
      prevBtn.before(sep, grp);
    } else {
      zone.appendChild(sep);
      zone.appendChild(grp);
    }

    // Overflow nach dem Hinzufügen neu rechnen
    if (typeof window.updateToolbarOverflow === 'function') {
      window.updateToolbarOverflow();
    }
  }

  function aktualisiereKnopfZustand() {
    const btnL = E('btn-ruler');
    if (btnL) btnL.classList.toggle('active', lineal.an);
  }

  /* ── Ein- und Ausschalten ─────────────────────────────────────────── */
  function umschaltenLineal() {
    lineal.an = !lineal.an;
    if (lineal.an) {
      passeGroesseAn();
      // Beim ersten Mal über der Seite platzieren
      if (!lineal.gesetzt) {
        const m = seitenMitte();
        lineal.x = m.x - linealBreite / 2;
        lineal.y = m.y - LINEAL_H / 2;
        lineal.gesetzt = true;
      }
      maleLineal();
      ln.canvas.style.display = 'block';
      aktualisiereLinealPos();
    } else {
      ln.canvas.style.display = 'none';
    }
    aktualisiereKnopfZustand();
  }

  /** Ausblenden, ohne den Zustand zu behalten – für den Weg zur Startseite. */
  function versteckeLineal() {
    if (!lineal.an) return;
    lineal.an = false;
    ln.canvas.style.display = 'none';
    aktualisiereKnopfZustand();
  }

  /* Auf der Startseite hat das Lineal nichts zu suchen: es liegt fest am
     Fenster (position:fixen), die Heft-Übersicht schiebt es nicht weg, und
     der Knopf zum Ausschalten steht in der Editor-Leiste, die dort gar
     nicht da ist – man wurde es also nicht mehr los. */
  (function haengeAnSeitenwechsel() {
    const orig = window.showHome;
    if (typeof orig !== 'function') return setTimeout(haengeAnSeitenwechsel, 200);
    window.showHome = function () {
      versteckeLineal();
      return orig.apply(this, arguments);
    };
  })();

  /* ── Start ────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', baueKnoepfe);
  } else {
    baueKnoepfe();
  }

  /* ── Global erreichbar ────────────────────────────────────────────── */
  window.toggleRuler = umschaltenLineal;

  /** Gibt die aktuelle Lage des Lineals in Bildschirm-Koordinaten zurück,
   *  oder null, wenn es ausgeschaltet ist. Für das Einrasten gezeichneter
   *  Linien an der Lineal-Kante (siehe canvas/input.js). */
  window.getRulerState = function () {
    if (!lineal.an) return null;
    return { x: lineal.x, y: lineal.y, winkel: lineal.winkel || 0,
             w: linealBreite, h: LINEAL_H, hPad: LINEAL_H_PAD };
  };

})();
