'use strict';

/* ══════════════════════════════════════════════════════════════════════
   LINEAL UND GEODREIECK

   Zwei durchsichtige Zeichenhilfen, die über der Seite liegen und nicht
   gespeichert werden. Beide lassen sich mit einem Finger oder der Maus
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
  const LINEAL_W = 420;          // CSS-Pixel, gesamte Breite
  const LINEAL_H = 58;           // CSS-Pixel, gesamte Höhe
  const LINEAL_H_PAD = 16;       // Platz über den Strichen (für Griff)
  const GEO_R = 150;             // Radius des Geodreiecks
  const GEO_PAD = 20;            // Platz um das Geodreieck herum

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
    c.style.cssText = 'position:fixed;z-index:7000;pointer-events:auto;touch-action:none;display:none;'
      + 'width:' + w + 'px;height:' + h + 'px;';
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return { canvas: c, ctx: ctx, dpr: dpr };
  }

  /* ── Lineal malen ─────────────────────────────────────────────────── */
  const ln = neuesCanvas(LINEAL_W, LINEAL_H);
  document.body.appendChild(ln.canvas);

  function maleLineal() {
    const ctx = ln.ctx;
    const dpr = ln.dpr;
    const w = LINEAL_W, h = LINEAL_H;
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

  /* ── Geodreieck malen ─────────────────────────────────────────────── */
  const gSize = GEO_R * 2 + GEO_PAD * 2;
  const geo = neuesCanvas(gSize, GEO_R + GEO_PAD * 2);
  document.body.appendChild(geo.canvas);

  function maleGeodreieck() {
    const ctx = geo.ctx;
    const dpr = geo.dpr;
    const cx = GEO_R + GEO_PAD;
    const cy = GEO_R + GEO_PAD;

    ctx.clearRect(0, 0, gSize * dpr, gSize * dpr);

    // Halbkreis-Hintergrund
    ctx.fillStyle = 'rgba(220,230,245,0.82)';
    ctx.strokeStyle = 'rgba(100,130,180,0.7)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, GEO_R, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Basislinie
    ctx.beginPath();
    ctx.moveTo(cx - GEO_R, cy);
    ctx.lineTo(cx + GEO_R, cy);
    ctx.stroke();

    // Grad-Striche
    for (let deg = 0; deg <= 180; deg++) {
      const rad = (deg - 90) * Math.PI / 180;
      const innerR = deg % 10 === 0 ? GEO_R - 20 : deg % 5 === 0 ? GEO_R - 14 : GEO_R - 10;
      const outerR = GEO_R - 2;

      const x1 = cx + Math.cos(rad) * innerR;
      const y1 = cy - Math.sin(rad) * innerR;
      const x2 = cx + Math.cos(rad) * outerR;
      const y2 = cy - Math.sin(rad) * outerR;

      ctx.strokeStyle = 'rgba(40,60,100,' + (deg % 10 === 0 ? '0.8' : '0.45') + ')';
      ctx.lineWidth = deg % 10 === 0 ? 1.1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Grad-Zahlen
    ctx.fillStyle = 'rgba(20,30,60,0.85)';
    ctx.font = '9px "DM Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = 0; deg <= 180; deg += 10) {
      const rad = (deg - 90) * Math.PI / 180;
      const labelR = GEO_R - 30;
      const lx = cx + Math.cos(rad) * labelR;
      const ly = cy - Math.sin(rad) * labelR;
      ctx.fillText(String(deg), lx, ly);
    }

    // Fadenkreuz in der Mitte
    const crossLen = 10;
    ctx.strokeStyle = 'rgba(180,40,40,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - crossLen);
    ctx.lineTo(cx, cy + crossLen);
    ctx.moveTo(cx - crossLen, cy);
    ctx.lineTo(cx + crossLen, cy);
    ctx.stroke();
  }

  /* ── Zustand ──────────────────────────────────────────────────────── */
  const lineal = { x: 200, y: 300, winkel: 0, an: false };
  const dreieck = { x: 300, y: 400, winkel: 0, an: false };

  function aktualisiereLinealPos() {
    ln.canvas.style.left = Math.round(lineal.x) + 'px';
    ln.canvas.style.top = Math.round(lineal.y) + 'px';
    ln.canvas.style.transform = 'rotate(' + (lineal.winkel || 0) + 'deg)';
  }

  function aktualisiereGeoPos() {
    geo.canvas.style.left = Math.round(dreieck.x) + 'px';
    geo.canvas.style.top = Math.round(dreieck.y) + 'px';
    geo.canvas.style.transform = 'rotate(' + (dreieck.winkel || 0) + 'deg)';
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
  einfacheBewegung(geo.canvas, dreieck, aktualisiereGeoPos);

  /* ── Neumalen bei Zoom-Änderung ────────────────────────────────────── */
  function beimZoomen() {
    if (lineal.an) maleLineal();
    if (dreieck.an) maleGeodreieck();
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
    const btnG = knopf('btn-protractor', '📐', 'protractor', 'Geodreieck', umschaltenGeodreieck);

    grp.appendChild(btnL);
    grp.appendChild(btnG);

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
    const btnG = E('btn-protractor');
    if (btnL) btnL.classList.toggle('active', lineal.an);
    if (btnG) btnG.classList.toggle('active', dreieck.an);
  }

  /* ── Ein- und Ausschalten ─────────────────────────────────────────── */
  function umschaltenLineal() {
    lineal.an = !lineal.an;
    if (lineal.an) {
      // Beim ersten Mal in der Seitenmitte platzieren
      if (lineal.x === 200 && lineal.y === 300) {
        const m = seitenMitte();
        lineal.x = m.x - LINEAL_W / 2;
        lineal.y = m.y - LINEAL_H / 2;
      }
      maleLineal();
      ln.canvas.style.display = 'block';
      aktualisiereLinealPos();
      if (dreieck.an) umschaltenGeodreieck();
    } else {
      ln.canvas.style.display = 'none';
    }
    aktualisiereKnopfZustand();
  }

  function umschaltenGeodreieck() {
    dreieck.an = !dreieck.an;
    if (dreieck.an) {
      if (dreieck.x === 300 && dreieck.y === 400) {
        const m = seitenMitte();
        dreieck.x = m.x - gSize / 2;
        dreieck.y = m.y - GEO_R;
      }
      maleGeodreieck();
      geo.canvas.style.display = 'block';
      aktualisiereGeoPos();
      if (lineal.an) umschaltenLineal();
    } else {
      geo.canvas.style.display = 'none';
    }
    aktualisiereKnopfZustand();
  }

  /* ── Start ────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', baueKnoepfe);
  } else {
    baueKnoepfe();
  }

  /* ── Global erreichbar ────────────────────────────────────────────── */
  window.toggleRuler = umschaltenLineal;
  window.toggleProtractor = umschaltenGeodreieck;

})();
