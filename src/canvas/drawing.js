'use strict';

/* ── CANVAS ── */
function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.className = 'j-canvas'; 
  const dpr = getCanvasDpr(); 
  const pw = w || CFG.PAGE_W;
  const ph = h || CFG.PAGE_H;
  c.width = Math.round(pw * dpr); c.height = Math.round(ph * dpr); 
  c.style.width = pw + 'px'; c.style.height = ph + 'px';
  /* touch-action steht in css/pages.css: pan-y, damit der Finger ueber der
     Seite scrollt – und none, sobald er zeichnen soll (body.touch-draw).

     >>> Hier stand es als INLINE-Stil, und das war der Fehler <<<
     Ein Inline-Stil schlaegt jedes Stylesheet. Damit kam die Regel fuers
     Zeichnen nie an: mit dem Finger liess sich ueberhaupt nichts malen,
     egal wie der Schalter stand. Gesetzt wird es nur noch dort, wo es
     wirklich vom Zustand abhaengt (core/zoom.js, beim Vergroesserten). */
  const ctx = c.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; return c;
}

function traceStrokePath(ctx, s) {
  const pts = s.path;
  if (!pts || !pts.length) return;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (s.isGeometric) {
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    }
    ctx.stroke();
  }
}

function applyStrokeStyles(ctx, s) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function redrawStrokes(canvas, strokes) {
  const dpr = getCanvasDpr();
  const w = canvas.width / dpr, h = canvas.height / dpr;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
  let i = 0;
  while (i < strokes.length) {
    const s = strokes[i];
    if (s.isHL) {
      const hlChunk = [];
      while (i < strokes.length && strokes[i].isHL) { hlChunk.push(strokes[i]); i++; }
      const off = document.createElement('canvas'); off.width = w * dpr; off.height = h * dpr; const oc = off.getContext('2d'); oc.scale(dpr, dpr);
      hlChunk.forEach(hs => {
        applyStrokeStyles(oc, hs);
        oc.globalAlpha = 1;
        traceStrokePath(oc, hs);
      });
      ctx.save(); ctx.globalAlpha = 0.38; ctx.drawImage(off, 0, 0, w, h); ctx.restore();
    } else if (s.isEraser) {
      ctx.save(); 
      ctx.globalCompositeOperation = 'destination-out'; 
      applyStrokeStyles(ctx, { ...s, color: 'rgba(0,0,0,1)' });
      traceStrokePath(ctx, s);
      ctx.restore();
      i++;
    } else {
      drawStroke(ctx, s);
      i++;
    }
  }
}

function drawStroke(ctx, s) {
  ctx.save();
  applyStrokeStyles(ctx, s);
  ctx.globalAlpha = s.alpha || 1;
  traceStrokePath(ctx, s);
  ctx.restore();
}
