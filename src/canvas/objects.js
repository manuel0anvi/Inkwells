'use strict';

/* ── OBJECTS ── */
let _selObj = null;

/**
 * Ein Objekt wurde verschoben, skaliert, gedreht oder gelöscht.
 *
 * >>> Warum das eine eigene Zeile wert ist <<<
 * Verschieben und Skalieren setzen nur obj.x / obj.w – ohne Umweg über
 * eine Funktion, die irgendjemand benachrichtigen könnte. Genau deshalb
 * fehlte diese Meldung hier ganz: die Änderung war im Bild zu sehen, galt
 * aber als nicht vorhanden. Sie wurde weder gespeichert noch hochgeladen,
 * und in einem geteilten Dokument sprang das Bild beim anderen wieder an
 * seinen alten Platz, weil dessen Seite aus Firestore nachgeladen wurde –
 * mit dem Stand, der dort mangels Speichern noch immer stand.
 *
 * Aufgerufen wird das am ENDE einer Bewegung, nicht bei jedem Pixel.
 */
function noteObjectChanged() {
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

document.addEventListener('pointerdown', e => { if (!e.target.closest('.obj-wrap')) deselect(); });
function deselect() { if (_selObj) { _selObj.classList.remove('selected');[..._selObj.querySelectorAll('.obj-handle,.obj-delete')].forEach(h => h.style.display = 'none'); _selObj = null; } }
function placeObject(objLayer, obj, page) {
  const wrap = document.createElement('div'); wrap.className = 'obj-wrap';
  wrap.style.cssText = 'left:' + obj.x + 'px;top:' + obj.y + 'px;width:' + obj.w + 'px;height:' + obj.h + 'px;transform:rotate(' + (obj.rot || 0) + 'deg);position:absolute;pointer-events:' + (S.mode === 'cursor' ? 'auto' : 'none');
  if (obj.kind === 'image') { const img = document.createElement('img'); img.src = obj.src; img.draggable = false; img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;border-radius:2px'; wrap.appendChild(img); }
  else { wrap.innerHTML = '<div style="background:#ede8dc;border:1px solid #cfc5b0;border-radius:6px;padding:8px 14px;font-size:13px;color:#4a3d2e;height:100%;display:flex;align-items:center;gap:8px">📎 ' + (obj.name || 'Datei') + '</div>'; }

  let snapV = null, snapH = null;
  const showSnap = (type, pos) => {
    let el = type === 'v' ? snapV : snapH;
    if (!el) { el = document.createElement('div'); el.className = 'snap-line ' + type; objLayer.appendChild(el); if (type === 'v') snapV = el; else snapH = el; }
    el.style.display = 'block'; el.style[type === 'v' ? 'left' : 'top'] = pos + 'px';
  };
  const hideSnaps = () => { if (snapV) snapV.style.display = 'none'; if (snapH) snapH.style.display = 'none'; };
  const getSnaps = (val, list) => {
    let best = val, minD = 8 / _zoom;
    list.forEach(v => { if (Math.abs(val - v) < minD) { minD = Math.abs(val - v); best = v; } });
    return { v: best, sn: best !== val };
  };

  ['tl', 'tr', 'bl', 'br'].forEach(pos => {
    const h = document.createElement('div'); h.className = 'obj-handle ' + pos; h.style.display = 'none'; wrap.appendChild(h);
    h.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ow = obj.w, oh = obj.h, ox = obj.x, oy = obj.y, ratio = oh / ow;
      const others = (page.objects || []).filter(o => o.id !== obj.id);
      let xs = [], ys = [], ws = [], hs = [];
      others.forEach(o => { xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h); ws.push(o.w); hs.push(o.h); });

      let _hasMutated = false;
      const mv = ev => {
        if (!_hasMutated) { _hasMutated = true; pushPageHistory(page); }
        hideSnaps();
        const dx = (ev.clientX - sx) / _zoom, dy = (ev.clientY - sy) / _zoom;
        let nw = ow, nh = oh, nx = ox, ny = oy;

        let tw = ow + (pos.includes('r') ? dx : -dx);
        let sW = getSnaps(tw, ws); if (sW.sn) tw = sW.v;
        if (pos.includes('r')) { let sR = getSnaps(ox + tw, xs); if (sR.sn) { tw = sR.v - ox; showSnap('v', sR.v); } }
        else { let sL = getSnaps(ox - (tw - ow), xs); if (sL.sn) { tw = ow + (ox - sL.v); showSnap('v', sL.v); } }

        nw = tw; nh = nw * ratio;
        let sH = getSnaps(nh, hs); if (sH.sn && !sW.sn && !pos.includes('r') && !pos.includes('l')) { nh = sH.v; nw = nh / ratio; }

        if (pos === 'bl') { nx = ox + (ow - nw); }
        if (pos === 'tr') { ny = oy + (oh - nh); }
        if (pos === 'tl') { nx = ox + (ow - nw); ny = oy + (oh - nh); }
        if (nw > 20 && nh > 20) {
          obj.w = nw; obj.h = nh; obj.x = nx; obj.y = ny;
          wrap.style.left = obj.x + 'px'; wrap.style.top = obj.y + 'px'; wrap.style.width = obj.w + 'px'; wrap.style.height = obj.h + 'px'; wrap.style.transform = 'rotate(' + (obj.rot || 0) + 'deg)';
        }
      };
      const up = (ev) => { hideSnaps(); h.releasePointerCapture(ev.pointerId); h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); if (_hasMutated) noteObjectChanged(); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
    });
  });

  const rotH = document.createElement('div'); rotH.className = 'obj-handle rot'; rotH.textContent = '↻'; rotH.style.display = 'none'; wrap.appendChild(rotH);
  rotH.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault(); rotH.setPointerCapture(e.pointerId);
    const r = wrap.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const sa = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI, sr = obj.rot || 0;
    let _hasMutated = false;
    const mv = ev => {
      if (!_hasMutated) { _hasMutated = true; pushPageHistory(page); }
      let newRot = sr + (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI - sa);
      for (const sp of [0, 90, 180, 270, 360, -90, -180, -270, -360]) if (Math.abs(newRot - sp) < 10) { newRot = sp; break; }
      obj.rot = newRot; wrap.style.transform = 'rotate(' + obj.rot + 'deg)';
    };
    const up = (ev) => { rotH.releasePointerCapture(ev.pointerId); rotH.removeEventListener('pointermove', mv); rotH.removeEventListener('pointerup', up); if (_hasMutated) noteObjectChanged(); };
    rotH.addEventListener('pointermove', mv); rotH.addEventListener('pointerup', up);
  });

  const dBtn = document.createElement('button'); dBtn.className = 'obj-delete'; dBtn.textContent = '✕'; dBtn.style.display = 'none'; dBtn.addEventListener('click', e => { pushPageHistory(page); e.stopPropagation(); page.objects = page.objects.filter(o => o.id !== obj.id); wrap.remove(); updateUndoRedoUI(); noteObjectChanged(); }); wrap.appendChild(dBtn);

  wrap.addEventListener('pointerdown', e => {
    if (S.mode !== 'cursor') return;
    if (e.target.closest('.obj-handle,.obj-delete')) return;
    e.stopPropagation(); e.preventDefault(); deselect(); _selObj = wrap; wrap.classList.add('selected');
    [...wrap.querySelectorAll('.obj-handle,.obj-delete')].forEach(h => h.style.display = 'flex'); dBtn.style.display = 'flex';
    wrap.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, ox = obj.x, oy = obj.y;
    const others = (page.objects || []).filter(o => o.id !== obj.id);
    let xs = [], ys = [], cxs = [], cys = [];
    others.forEach(o => { xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h); cxs.push(o.x + o.w / 2); cys.push(o.y + o.h / 2); });

    let _hasMutated = false;
    const mv = ev => {
      if (!_hasMutated) { _hasMutated = true; pushPageHistory(page); }
      hideSnaps();
      let nx = ox + (ev.clientX - sx) / _zoom, ny = oy + (ev.clientY - sy) / _zoom;
      let sXL = getSnaps(nx, xs), sXR = getSnaps(nx + obj.w, xs), sXC = getSnaps(nx + obj.w / 2, cxs);
      if (sXL.sn) { nx = sXL.v; showSnap('v', nx); } else if (sXR.sn) { nx = sXR.v - obj.w; showSnap('v', sXR.v); } else if (sXC.sn) { nx = sXC.v - obj.w / 2; showSnap('v', sXC.v); }

      let sYT = getSnaps(ny, ys), sYB = getSnaps(ny + obj.h, ys), sYC = getSnaps(ny + obj.h / 2, cys);
      if (sYT.sn) { ny = sYT.v; showSnap('h', ny); } else if (sYB.sn) { ny = sYB.v - obj.h; showSnap('h', sYB.v); } else if (sYC.sn) { ny = sYC.v - obj.h / 2; showSnap('h', sYC.v); }

      obj.x = nx; obj.y = ny; wrap.style.left = obj.x + 'px'; wrap.style.top = obj.y + 'px';
    };
    const up = (ev) => { hideSnaps(); wrap.releasePointerCapture(ev.pointerId); wrap.removeEventListener('pointermove', mv); wrap.removeEventListener('pointerup', up); if (_hasMutated) noteObjectChanged(); };
    wrap.addEventListener('pointermove', mv); wrap.addEventListener('pointerup', up);
  });

  let pinchStartDist = 0, pinchStartW = 0, pinchStartH = 0;
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2 && S.mode === 'cursor') {
      e.stopPropagation(); e.preventDefault();
      pinchStartDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      pinchStartW = obj.w; pinchStartH = obj.h; deselect(); _selObj = wrap; wrap.classList.add('selected');
      [...wrap.querySelectorAll('.obj-handle,.obj-delete')].forEach(h => h.style.display = 'flex'); dBtn.style.display = 'flex';
    }
  }, { passive: false });
  wrap.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchStartDist > 0 && S.mode === 'cursor') {
      e.stopPropagation(); e.preventDefault();
      const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      const scale = dist / pinchStartDist;
      let nw = pinchStartW * scale, nh = pinchStartH * scale;
      if (nw > 40 && nh > 30) {
        obj.x -= (nw - obj.w) / 2; obj.y -= (nh - obj.h) / 2; obj.w = nw; obj.h = nh;
        wrap.style.width = obj.w + 'px'; wrap.style.height = obj.h + 'px'; wrap.style.left = obj.x + 'px'; wrap.style.top = obj.y + 'px';
      }
    }
  }, { passive: false });
  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2 && pinchStartDist > 0) { pinchStartDist = 0; noteObjectChanged(); }
  }, { passive: true });

  objLayer.appendChild(wrap);
}

