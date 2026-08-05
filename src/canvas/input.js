'use strict';

/* ── INPUT ── */
function attachInput(canvas, textDiv, objLayer, page) {
  const div = canvas.parentElement;
  const LINE_HOLD_MS = 320;

  function activateTextEditingAt(clientX, clientY, forceManual = false) {
    if (S.mode !== 'cursor') switchMode('cursor');
    textDiv.style.pointerEvents = 'auto';
    // Im Nur-Lese-Modus darf der Zeiger stehen (Markieren und Kopieren
    // bleiben möglich), aber es wird nichts gesetzt oder verändert.
    if (S.readOnly) { setActivePg(page.id); return; }
    const richMode = !isPlainTextEditable(textDiv);
    placeCaretAnywhere(textDiv, clientX, clientY, forceManual || richMode, page);
    setActivePg(page.id);
  }

  function isFreeEditorAreaClick(clientX, clientY) {
    const plain = (textDiv.innerText || '').replace(/\r/g, '');
    if (!plain.trim().length) return true;

    const divRect = textDiv.getBoundingClientRect();
    const pad = 2;
    if (clientX < divRect.left - pad ||
        clientX > divRect.right + pad ||
        clientY < divRect.top - pad ||
        clientY > divRect.bottom + pad) {
      return true;
    }

    try {
      const range = document.createRange();
      range.selectNodeContents(textDiv);
      const rects = Array.from(range.getClientRects());

      if (!rects.length) {
        return true;
      }

      const hitsVisibleText = rects.some(rc => (
        rc.width > 1 &&
        clientX >= rc.left - 2 &&
        clientX <= rc.right + 2 &&
        clientY >= rc.top - 1 &&
        clientY <= rc.bottom + 1
      ));
      return !hitsVisibleText;
    } catch (err) {
      return true;
    }
  }

  function armLineTimer(stroke) {
    if (!stroke || stroke.isEraser) return;
    clearTimeout(stroke._lineTimer);
    stroke._lineTimer = setTimeout(() => {
      if (!S.isDrawing || S._cur !== stroke) return;
      stroke._lineLocked = true;
      const pts = stroke.path || [];
      if (pts.length > 1) {
        stroke._shapeDetected = false;
        stroke.isGeometric = false;
        const start = pts[0], end = pts[pts.length - 1];
        stroke.path = [start, end];
        clearLiveCanvas();
        redrawStrokes(canvas, S.strokeHistory[page.id]);
      }
    }, LINE_HOLD_MS);
  }

  function stopLineTimer(stroke) {
    if (!stroke) return;
    clearTimeout(stroke._lineTimer);
    stroke._lineTimer = null;
  }

  function coords(e) {
    const r = canvas.getBoundingClientRect();
    const pw = page.w || CFG.PAGE_W;
    const ph = page.h || CFG.PAGE_H;
    const scaleX = pw / r.width, scaleY = ph / r.height;
    return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY, p: e.pressure > 0 ? e.pressure : 0.5 };
  }

  /**
   * Einen Strich beginnen – mit Stift, Maus oder Finger.
   *
   * Hiess handlePenStart und lief nur fuer den Stift. Gezeichnet wird
   * inzwischen mit allem, was der Nutzer dafuer nimmt; welches Geraet
   * ueberhaupt hierher kommt, entscheidet der Verteiler unten.
   */
  function handleDrawStart(e) {
    // Fremdes Dokument ohne Bearbeitungsrecht: der Stift schreibt nicht.
    // Ohne diese Bremse landeten die Striche zwar nur lokal, wären aber
    // sichtbar – und wirkten dadurch wie eine gespeicherte Änderung.
    if (S.readOnly) return;

    // Die hintere Taste am Stift radiert – bei der Maus die rechte
    const isE = e.button === 5 || e.button === 2 || (e.buttons & 32) || (e.buttons & 2);
    if (isE) {
      if (S.mode !== 'eraser') { S._restoreMode = S.mode; switchMode('eraser'); }
    } else if (S._restoreMode) {
      S._restoreMode = null;
    }
    S._drawPointerId = e.pointerId;
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { }
    textDiv.style.pointerEvents = 'none';
    textDiv.dataset.ph = '';
    setActivePg(page.id);
    const c = coords(e); S.isDrawing = true;
    // Zustand vor dem Strich sichern – ein Strich ist ein Rückgängig-Schritt
    pushPageHistory(page);
    if (S.mode !== 'eraser' || S.eraser.type === 'pixel') {
      if (!S.strokeHistory[page.id]) S.strokeHistory[page.id] = [];
      const stroke = buildStroke(c);
      if (S.mode === 'eraser') {
        stroke.isEraser = true; stroke.color = 'rgba(0,0,0,1)'; stroke.width = ERASER_SIZES[S.eraser.szIdx] * 2;
      }
      S.strokeHistory[page.id].push(stroke); S._cur = stroke;
      armLineTimer(stroke);
      if (stroke.isHL) {
        const pw = page.w || CFG.PAGE_W;
        const ph = page.h || CFG.PAGE_H;
        const lctx = getLiveCtx(div, pw, ph);
        lctx.save(); lctx.fillStyle = stroke.color;
        lctx.beginPath(); lctx.arc(c.x, c.y, stroke.width / 2, 0, Math.PI * 2); lctx.fill(); lctx.restore();
      } else {
        const ctx = canvas.getContext('2d'); ctx.save(); ctx.fillStyle = stroke.color;
        if (stroke.isEraser) ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(c.x, c.y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     WELCHES GERAET WAS TUT

     Stift und Maus sind dasselbe Zeigegeraet – was zaehlt, ist das
     gewaehlte Werkzeug. Auf Stift, Marker oder Radierer zeichnen beide,
     auf dem Zeiger setzen beide nur die Schreibmarke.

     Hier schaltete der Stift frueher von selbst auf das zuletzt
     benutzte Werkzeug. Das nahm einem die Wahl wieder weg: wer den
     Zeiger gewaehlt hatte, konnte mit dem Stift keinen Text mehr
     antippen, weil schon die Beruehrung einen Strich machte.

     Der Finger scrollt – ausser das Zeichnen mit dem Finger ist
     eingeschaltet und ein Zeichenwerkzeug gewaehlt.
     ══════════════════════════════════════════════════════════════════ */
  div.addEventListener('pointerdown', e => {
    const target = e.target;
    if (target.closest('.j-page-hdr') || target.closest('.obj-handle') || target.closest('.obj-bar')) return;
    if (target.closest('.j-text')) return;

    if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
      const zweiteTaste = e.button === 5 || e.button === 2 || (e.buttons & 32) || (e.buttons & 2);
      if (e.button !== 0 && !zweiteTaste) return;

      /* Die zweite Taste am Stift radiert in jedem Werkzeug – umdrehen,
         wegwischen, weiterschreiben, ohne zur Leiste zu muessen. Bei der
         Maus bleibt die rechte Taste dem Kontextmenue, sonst waere das
         Markieren von Text kaputt. */
      if (isDrawMode(S.mode) || (e.pointerType === 'pen' && zweiteTaste)) {
        handleDrawStart(e);
        return;
      }

      // We don't preventDefault here to allow native selection to work.
      // But we call activeTextEditingAt immediately so the cursor appears
      // where we want it before the browser has a chance to place its own.
      activateTextEditingAt(e.clientX, e.clientY, false);
      return;
    }

    if (e.pointerType === 'touch' && touchDrawActive()) { handleDrawStart(e); return; }
    // sonst bleibt der Finger fuers Scrollen und Zoomen (app.js)
  });

  div.addEventListener('pointermove', e => {
    // Nur der Zeiger, der den Strich begonnen hat – ein zweiter Finger
    // beim Zoomen darf nicht mitmalen
    if (!S.isDrawing || e.pointerId !== S._drawPointerId) return;
    e.preventDefault(); const c = coords(e); const ctx = canvas.getContext('2d');
    if (S.mode === 'eraser' && S.eraser.type === 'stroke') {
      strokeErase(c, page, canvas);
    }
    else {
      if (S._cur) {
        const stroke = S._cur;
        if (!stroke.isEraser) armLineTimer(stroke);
        // If a shape was detected, don't override it with line logic
        if (stroke._lineLocked && !stroke._shapeDetected && !stroke.isEraser) {
          const start = stroke.path[0] || { x: c.x, y: c.y, p: c.p };
          stroke.path = [start, { x: c.x, y: c.y, p: c.p }];
          clearLiveCanvas();
          redrawStrokes(canvas, S.strokeHistory[page.id]);
        } else if (!stroke._lineLocked) {
          stroke.path.push({ x: c.x, y: c.y, p: c.p });
        }
        // Draw preview
        if (stroke._lineLocked && !stroke._shapeDetected) {
          // already redrawn above for line
        } else if (stroke._shapeDetected) {
          // Shape is already rendered, don't update
        } else if (S._cur.isHL) {
          const pw = page.w || CFG.PAGE_W;
          const ph = page.h || CFG.PAGE_H;
          const lctx = getLiveCtx(div, pw, ph);
          lctx.clearRect(0, 0, pw, ph);
          lctx.save();
          applyStrokeStyles(lctx, S._cur);
          traceStrokePath(lctx, S._cur);
          lctx.restore();
        } else {
          liveDrawIncr(ctx, c);
        }
      }
    }
  }, { passive: false });

  div.addEventListener('pointerup', e => {
    if (!S.isDrawing || e.pointerId !== S._drawPointerId) return;
    S.isDrawing = false;
    S._drawPointerId = null;
    stopLineTimer(S._cur);
    clearLiveCanvas();
    if (S.mode === 'eraser' && S._restoreMode) { switchMode(S._restoreMode); S._restoreMode = null; }
    if (S._cur?.isHL || S._cur?.isEraser) redrawStrokes(canvas, S.strokeHistory[page.id]);

    // Der fertige Strich geht sofort an die anderen. Erst beim Loslassen –
    // während des Zeichnens wäre es ein Sturm aus Zwischenständen, und der
    // Strich sieht ohnehin erst am Ende richtig aus.
    const finished = S._cur;
    if (finished && !finished.isEraser && window.Collab) Collab.noteStroke(page.id, finished);

    S._cur = null; page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[page.id] || []));
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  });
  div.addEventListener('pointercancel', () => {
    stopLineTimer(S._cur);
    S.isDrawing = false; S._cur = null; S._drawPointerId = null;
    clearLiveCanvas();
    if (S.mode === 'eraser' && S._restoreMode) { switchMode(S._restoreMode); S._restoreMode = null; }
  });

  textDiv.addEventListener('pointerdown', e => {
    setActivePg(page.id);
    /* Das gewaehlte Zeichenwerkzeug bleibt stehen. Hier stand frueher ein
       bedingungsloses switchMode('cursor') – damit war das Zeichnen mit
       der Maus unmoeglich: der erste Klick auf die Seite schaltete sofort
       wieder auf Text. */
    if (S.mode !== 'cursor') return;
    textDiv.style.pointerEvents = 'auto';

    if (S.readOnly) return;
    /* Stift und Maus setzen die Marke selbst – sonst landet sie beim Stift
       am Zeilenende statt dort, wo man hingetippt hat. Der Finger nicht:
       dort ist der eigene Treffer des Browsers samt Griffen besser. */
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (e.button !== 0) return;

    // Direct clicks on the editor container:
    // normal text hits stay native, free-area hits use corrected manual caret.
    if (textDiv.contains(e.target)) {
      const forceManual = isFreeEditorAreaClick(e.clientX, e.clientY);
      if (forceManual || e.target === textDiv) {
        // No preventDefault to allow selection, but update DOM immediately
        activateTextEditingAt(e.clientX, e.clientY, forceManual);
      }
    }
  });
}

let _liveCanvas = null;
function getLiveCtx(parentDiv, dw = CFG.PAGE_W, dh = CFG.PAGE_H) {
  const dpr = getCanvasDpr();
  if (!_liveCanvas) {
    _liveCanvas = document.createElement('canvas');
    _liveCanvas.className = 'j-canvas live-canvas';
    _liveCanvas.style.cssText = 'pointer-events:none;z-index:11;position:absolute;inset:0;opacity:0.38;';
    _liveCanvas.width = Math.round(dw * dpr); _liveCanvas.height = Math.round(dh * dpr);
    _liveCanvas.style.width = dw + 'px'; _liveCanvas.style.height = dh + 'px';
    const ctx = _liveCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  const expectedW = Math.round(dw * dpr), expectedH = Math.round(dh * dpr);
  if (_liveCanvas.width !== expectedW || _liveCanvas.height !== expectedH) {
    _liveCanvas.width = expectedW;
    _liveCanvas.height = expectedH;
    _liveCanvas.style.width = dw + 'px'; 
    _liveCanvas.style.height = dh + 'px';
    const ctx = _liveCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  if (_liveCanvas.parentElement !== parentDiv) parentDiv.appendChild(_liveCanvas);
  return _liveCanvas.getContext('2d');
}
function clearLiveCanvas() {
  if (_liveCanvas) {
    _liveCanvas.remove();
    _liveCanvas = null;
  }
}

// Helper: distance from point to line segment
function pointToLineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function strokeErase(c, page, canvas) {
  const r = ERASER_SIZES[S.eraser.szIdx]; const before = S.strokeHistory[page.id].length;
  S.strokeHistory[page.id] = S.strokeHistory[page.id].filter(s => {
    if (s.isEraser) return true;
    const pts = s.path;
    if (!pts || pts.length === 0) return true;
    // Check all points
    if (pts.some(pt => Math.hypot(pt.x - c.x, pt.y - c.y) < r)) return false;
    // Also check line segments (important for straight lines with few points)
    for (let i = 0; i < pts.length - 1; i++) {
      const dist = pointToLineDistance(c.x, c.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (dist < r) return false;
    }
    return true;
  });
  if (S.strokeHistory[page.id].length < before) {
    redrawStrokes(canvas, S.strokeHistory[page.id]);
    page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[page.id]));
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  }
}

function buildStroke(c) { const m = S.mode; if (m === 'pen1') return { path: [{ x: c.x, y: c.y, p: c.p }], color: S.pen1.color, width: PEN_SIZES[S.pen1.szIdx], isHL: false }; if (m === 'pen2') return { path: [{ x: c.x, y: c.y, p: c.p }], color: S.pen2.color, width: PEN_SIZES[S.pen2.szIdx], isHL: false }; if (m === 'hl') return { path: [{ x: c.x, y: c.y, p: c.p }], color: S.hl.color, width: HL_SIZES[S.hl.szIdx], isHL: true }; return { path: [{ x: c.x, y: c.y, p: c.p }], color: '#000', width: 4, isHL: false }; }
function liveDrawIncr(ctx, c) { const s = S._cur; if (!s) return; const pts = s.path; if (pts.length < 2) return; const prev = pts[pts.length - 2], cur = pts[pts.length - 1]; ctx.save(); ctx.strokeStyle = s.color; ctx.lineWidth = s.isEraser ? s.width : s.width * (0.5 + cur.p); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; if (s.isHL) ctx.globalAlpha = 0.38; if (s.isEraser) ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); if (pts.length >= 3) { const pp = pts[pts.length - 3]; ctx.moveTo((pp.x + prev.x) / 2, (pp.y + prev.y) / 2); ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + cur.x) / 2, (prev.y + cur.y) / 2); } else { ctx.moveTo(prev.x, prev.y); ctx.lineTo(cur.x, cur.y); } ctx.stroke(); ctx.restore(); }

