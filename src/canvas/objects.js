'use strict';

/* ── OBJECTS ── */
let _selObj = null;

/* ══════════════════════════════════════════════════════════════════════
   EBENEN

   Ein Bild lag bisher immer über allem. Jetzt entscheidet obj.layer, ob es
   vor oder hinter Text und Handschrift liegt.

   >>> Warum das über z-index am einzelnen Bild läuft <<<
   Die Ebene .j-objects hatte selbst ein z-index und damit einen eigenen
   Stapel: was darin liegt, kann NIE unter den Text rutschen, egal welche
   Zahl es bekommt. Sie ist deshalb auf z-index:auto gesetzt (css/pages.css)
   und reicht ihre Kinder in den Stapel der Seite durch. Dort gilt:

     Seitenmuster 1 · BILD HINTEN 2 · Text 5 · Handschrift 10 ·
     Seitenkopf 20 · BILD VORNE 20

   Innerhalb einer Ebene entscheidet die Reihenfolge in page.objects –
   deshalb muss die DOM-Reihenfolge mit ihr übereinstimmen.
   ══════════════════════════════════════════════════════════════════════ */

const OBJ_Z = { back: 2, front: 20 };

function objLayerOf(obj) {
  return obj && obj.layer === 'back' ? 'back' : 'front';
}

document.addEventListener('pointerdown', e => { if (!e.target.closest('.obj-wrap')) deselect(); });

/* >>> Bilder hinter dem Text mit Alt+Klick greifen <<<
   Ein Bild in der hinteren Ebene liegt unter .j-text, und das Textfeld
   nimmt in der Zeigerstellung jeden Klick entgegen – auch dort, wo gar
   kein Buchstabe steht. Ohne diesen Griff wäre ein einmal nach hinten
   gestelltes Bild nicht mehr auswählbar. Der Hinweis darauf erscheint
   beim Umschalten als kurze Meldung. */
document.addEventListener('pointerdown', e => {
  if (!e.altKey || typeof S === 'undefined' || S.mode !== 'cursor') return;
  if (e.target.closest('.obj-wrap')) return;

  const pageEl = e.target.closest ? e.target.closest('.j-page') : null;
  const layer = pageEl && pageEl.querySelector('.j-objects');
  if (!layer) return;

  // Von vorn nach hinten suchen: das oberste Bild unter dem Zeiger gewinnt
  const wraps = [...layer.querySelectorAll('.obj-wrap')].reverse();
  for (const wrap of wraps) {
    const r = wrap.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right) continue;
    if (e.clientY < r.top || e.clientY > r.bottom) continue;
    if (typeof wrap._beginObjInteraction !== 'function') continue;
    e.preventDefault();
    e.stopPropagation();
    wrap._beginObjInteraction(e);
    return;
  }
}, true);

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

/** Kurzform für die Beschriftungen der Leiste – ohne Übersetzung geht es auch. */
function objText(key, fallback) {
  return (typeof t === 'function' && t(key)) || fallback;
}

function deselect() {
  if (!_selObj) return;
  _selObj.classList.remove('selected');
  [..._selObj.querySelectorAll('.obj-handle,.obj-bar')].forEach(h => h.style.display = 'none');
  _selObj = null;
}

/* ── Symbole der Leiste ─────────────────────────────────────────────
   Bewusst als Umriss-Zeichnungen und nicht als Emoji: Emoji sehen auf
   jedem Rechner anders aus und ziehen ihre eigene Farbe mit. */
const OBJ_ICONS = {
  rotL: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5h4v-4"/><path d="M3.3 6.2A5.5 5.5 0 1 1 2.6 10"/></svg>',
  rotR: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.5H9v-4"/><path d="M12.7 6.2A5.5 5.5 0 1 0 13.4 10"/></svg>',
  front: '<svg viewBox="0 0 16 16" fill="none"><path d="M1.8 3.2h12.4M1.8 6h12.4M1.8 8.8h5M1.8 11.6h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".45"/><rect x="7" y="6.6" width="7.2" height="7.2" rx="1.2" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none"><rect x="7" y="6.6" width="7.2" height="7.2" rx="1.2" fill="currentColor" opacity=".3"/><path d="M1.8 3.2h12.4M1.8 6h12.4M1.8 8.8h12.4M1.8 11.6h12.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V4"/><path d="M4.5 7.5 8 4l3.5 3.5"/><path d="M3 2.2h10"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v9"/><path d="M11.5 8.5 8 12l-3.5-3.5"/><path d="M3 13.8h10"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.3"/><path d="M10.6 3.2A1.4 1.4 0 0 0 9.3 2.4H3.7a1.3 1.3 0 0 0-1.3 1.3v5.6c0 .6.35 1.1.85 1.3" stroke-linecap="round"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 4.2h10.8"/><path d="M6.4 4.2V2.9h3.2v1.3"/><path d="M3.9 4.2 4.5 13a.9.9 0 0 0 .9.8h5.2a.9.9 0 0 0 .9-.8l.6-8.8"/><path d="M6.7 6.8v4.3M9.3 6.8v4.3"/></svg>'
};

function placeObject(objLayer, obj, page) {
  const wrap = document.createElement('div'); wrap.className = 'obj-wrap';
  wrap.style.cssText = 'left:' + obj.x + 'px;top:' + obj.y + 'px;width:' + obj.w + 'px;height:' + obj.h + 'px;transform:rotate(' + (obj.rot || 0) + 'deg);position:absolute;z-index:' + OBJ_Z[objLayerOf(obj)] + ';pointer-events:' + (S.mode === 'cursor' ? 'auto' : 'none');
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
          placeBar();
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
      obj.rot = newRot; applyRotation();
    };
    const up = (ev) => { rotH.releasePointerCapture(ev.pointerId); rotH.removeEventListener('pointermove', mv); rotH.removeEventListener('pointerup', up); if (_hasMutated) noteObjectChanged(); };
    rotH.addEventListener('pointermove', mv); rotH.addEventListener('pointerup', up);
  });

  /* ── Schwebende Leiste ────────────────────────────────────────────
     Alles, was nicht am Rahmen selbst geschieht, steht hier: drehen,
     Ebene wechseln, stapeln, verdoppeln, löschen. Vorher gab es dafür
     einen einzigen roten Knopf zum Löschen und sonst nichts. */
  const bar = document.createElement('div');
  bar.className = 'obj-bar';
  bar.style.display = 'none';
  // Ein Klick in die Leiste darf das Bild weder verschieben noch abwählen
  bar.addEventListener('pointerdown', e => e.stopPropagation());

  const barBtn = (icon, label, onClick, extraClass) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'obj-bar-btn' + (extraClass ? ' ' + extraClass : '');
    b.innerHTML = icon;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', ev => { ev.stopPropagation(); onClick(); });
    bar.appendChild(b);
    return b;
  };
  const barSep = () => {
    const s = document.createElement('span');
    s.className = 'obj-bar-sep';
    bar.appendChild(s);
  };

  /** Dreht das Bild und hält die Leiste dabei aufrecht. */
  function applyRotation() {
    wrap.style.transform = 'rotate(' + (obj.rot || 0) + 'deg)';
    // Sonst stünde die Leiste bei einem gedrehten Bild auf dem Kopf
    bar.style.transform = 'translateX(-50%) rotate(' + (-(obj.rot || 0)) + 'deg)';
  }

  /** Oben ist bei einem Bild am Seitenanfang kein Platz – dann nach unten. */
  function placeBar() {
    bar.classList.toggle('below', (obj.y || 0) < 64);
  }

  function turnBy(deg) {
    pushPageHistory(page);
    // Auf volle Viertel einrasten: nach drei Klicks soll wieder gerade sein
    const cur = Math.round((obj.rot || 0) / 90) * 90;
    obj.rot = ((cur + deg) % 360 + 360) % 360;
    applyRotation();
    updateUndoRedoUI();
    noteObjectChanged();
  }

  function setLayer(which) {
    if (objLayerOf(obj) === which) return;
    pushPageHistory(page);
    obj.layer = which;
    wrap.style.zIndex = OBJ_Z[which];
    markLayerButtons();
    updateUndoRedoUI();
    noteObjectChanged();
    if (which === 'back' && typeof toast === 'function') {
      toast(objText('objBehindHint', 'Hinter dem Text – mit Alt+Klick wieder auswählbar.'));
    }
  }

  /** Verschiebt das Bild in page.objects UND im DOM – beide müssen gleich sein. */
  function reorder(toEnd) {
    const list = page.objects || [];
    const idx = list.indexOf(obj);
    if (idx < 0) return;
    if (toEnd && idx === list.length - 1) return;
    if (!toEnd && idx === 0) return;

    pushPageHistory(page);
    list.splice(idx, 1);
    if (toEnd) { list.push(obj); objLayer.appendChild(wrap); }
    else { list.unshift(obj); objLayer.insertBefore(wrap, objLayer.firstChild); }
    updateUndoRedoUI();
    noteObjectChanged();
  }

  function duplicate() {
    pushPageHistory(page);
    const copy = { ...obj, id: uid(), x: (obj.x || 0) + 16, y: (obj.y || 0) + 16 };
    const list = page.objects || (page.objects = []);
    list.splice(list.indexOf(obj) + 1, 0, copy);
    placeObject(objLayer, copy, page);
    updateUndoRedoUI();
    noteObjectChanged();
  }

  function removeSelf() {
    pushPageHistory(page);
    page.objects = (page.objects || []).filter(o => o.id !== obj.id);
    deselect();
    wrap.remove();
    updateUndoRedoUI();
    noteObjectChanged();
  }

  barBtn(OBJ_ICONS.rotL, objText('objTurnLeft', 'Nach links drehen'), () => turnBy(-90));
  barBtn(OBJ_ICONS.rotR, objText('objTurnRight', 'Nach rechts drehen'), () => turnBy(90));
  barSep();
  const btnFront = barBtn(OBJ_ICONS.front, objText('objInFrontOfText', 'Vor den Text'), () => setLayer('front'));
  const btnBack = barBtn(OBJ_ICONS.back, objText('objBehindText', 'Hinter den Text'), () => setLayer('back'));
  barSep();
  barBtn(OBJ_ICONS.up, objText('objBringForward', 'Ganz nach vorn'), () => reorder(true));
  barBtn(OBJ_ICONS.down, objText('objSendBackward', 'Ganz nach hinten'), () => reorder(false));
  barSep();
  barBtn(OBJ_ICONS.copy, objText('objDuplicate', 'Verdoppeln'), duplicate);
  barBtn(OBJ_ICONS.trash, objText('objDelete', 'Löschen'), removeSelf, 'danger');

  function markLayerButtons() {
    const back = objLayerOf(obj) === 'back';
    btnBack.classList.toggle('active', back);
    btnFront.classList.toggle('active', !back);
  }
  markLayerButtons();
  applyRotation();

  wrap.appendChild(bar);
  wrap.dataset.objid = String(obj.id);

  /** Auswählen und, solange der Zeiger unten bleibt, verschieben. */
  function beginInteraction(e) {
    if (S.mode !== 'cursor') return;
    if (e.target.closest && e.target.closest('.obj-handle,.obj-bar')) return;
    e.stopPropagation(); e.preventDefault();
    deselect(); _selObj = wrap; wrap.classList.add('selected');
    placeBar();
    [...wrap.querySelectorAll('.obj-handle')].forEach(h => h.style.display = 'flex');
    bar.style.display = 'flex';
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
      placeBar();
    };
    const up = (ev) => { hideSnaps(); wrap.releasePointerCapture(ev.pointerId); wrap.removeEventListener('pointermove', mv); wrap.removeEventListener('pointerup', up); if (_hasMutated) noteObjectChanged(); };
    wrap.addEventListener('pointermove', mv); wrap.addEventListener('pointerup', up);
  }

  wrap.addEventListener('pointerdown', beginInteraction);
  // Für den Alt+Klick weiter oben: er sitzt außerhalb dieses Elements
  wrap._beginObjInteraction = beginInteraction;

  let pinchStartDist = 0, pinchStartW = 0, pinchStartH = 0;
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2 && S.mode === 'cursor') {
      e.stopPropagation(); e.preventDefault();
      pinchStartDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      pinchStartW = obj.w; pinchStartH = obj.h; deselect(); _selObj = wrap; wrap.classList.add('selected');
      placeBar();
      [...wrap.querySelectorAll('.obj-handle')].forEach(h => h.style.display = 'flex');
      bar.style.display = 'flex';
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
        placeBar();
      }
    }
  }, { passive: false });
  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2 && pinchStartDist > 0) { pinchStartDist = 0; noteObjectChanged(); }
  }, { passive: true });

  objLayer.appendChild(wrap);
}
