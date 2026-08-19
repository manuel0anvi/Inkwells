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

/* Zwei Baender mit Platz darin. Die Zahl eines Bildes ist
   Bandanfang + seine Stelle in page.objects – damit sagen die beiden
   Knopfpaare zwei verschiedene Dinge, die sich nicht in die Quere kommen:

     vor / hinter Text   waehlt das BAND, also nur das Verhaeltnis zum Text
     vorn / hinten       waehlt die Stelle IM Band, also nur das
                         Verhaeltnis zu den anderen Bildern

   Vorher trugen alle Bilder eines Bandes dieselbe Zahl und die Reihenfolge
   hing allein am DOM. Sichtbar wurde davon nichts, sobald die beiden
   Bilder in verschiedenen Baendern lagen – die Knoepfe „ganz nach vorn"
   und „ganz nach hinten" schienen wirkungslos.

   Die Staffelung der ganzen Seite steht in css/pages.css; zwischen den
   Baendern liegen Text (1000), Handschrift (1100) und Seitenkopf (1300). */
const OBJ_Z = { back: 100, front: 2000 };
const OBJ_Z_SPAN = 700;   // so viele Bilder je Band bekommen eine eigene Zahl

function objLayerOf(obj) {
  return obj && obj.layer === 'back' ? 'back' : 'front';
}

/* ══════════════════════════════════════════════════════════════════════
   AUF DEM BLATT BLEIBEN

   Ein Bild, eine Form oder eine Formel liess sich beliebig weit ueber den
   Rand hinausschieben. Zu sehen war davon nichts – .j-page schneidet ab –,
   und beim Ausdrucken erst recht nicht: das Ding war weg, stand aber
   weiterhin in page.objects und wanderte bei jedem Abgleich mit. Genau so
   wurde es gemeldet.

   Gerechnet wird mit dem Platz, den das Objekt GEDREHT einnimmt. Gedreht
   wird um die Mitte (canvas/objects.js, applyRotation), ein um 90°
   gedrehtes Hochformat ragt also links und rechts ueber sein eigenes
   Rechteck hinaus – ohne diesen Zuschlag stuende es sichtbar daneben.

   Oben ist die Grenze nicht das Blatt, sondern der Seitenkopf (CFG.HDR):
   dort stehen Seitenzahl und Datum, und dieselbe Kante schneidet auch die
   Handschrift ab (css/pages.css).
   ══════════════════════════════════════════════════════════════════════ */
function klemme(wert, min, max) {
  // Groesser als das Blatt: dann gewinnt die obere linke Ecke
  if (max <= min) return min;
  return Math.max(min, Math.min(max, wert));
}

function objGrenzen(obj, page) {
  const pw = (page && page.w) || CFG.PAGE_W;
  const ph = (page && page.h) || CFG.PAGE_H;
  const rad = (obj.rot || 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  // Wie weit die Drehung ueber das ungedrehte Rechteck hinausragt
  const ueberX = ((obj.w * c + obj.h * s) - obj.w) / 2;
  const ueberY = ((obj.w * s + obj.h * c) - obj.h) / 2;
  return {
    minX: ueberX, maxX: pw - obj.w - ueberX,
    minY: CFG.HDR + ueberY, maxY: ph - obj.h - ueberY
  };
}

/** Schiebt ein Objekt so weit zurueck, dass es ganz auf dem Blatt liegt. */
function haltAufBlatt(obj, page) {
  const g = objGrenzen(obj, page);
  obj.x = klemme(obj.x, g.minX, g.maxX);
  obj.y = klemme(obj.y, g.minY, g.maxY);
}

/**
 * Schreibt allen Bildern einer Seite ihre Zahl neu.
 *
 * Muss nach jeder Änderung an Band oder Reihenfolge laufen – und zwar für
 * die ganze Seite, nicht nur für das angefasste Bild: eine verschobene
 * Stelle verschiebt auch alle dahinter.
 */
function restackObjects(objLayer, page) {
  const bodies = new Map();
  for (const wrap of objLayer.querySelectorAll('.obj-wrap')) {
    const body = wrap.querySelector('.obj-body');
    if (body) bodies.set(wrap.dataset.objid, body);
  }
  (page.objects || []).forEach((o, i) => {
    const body = bodies.get(String(o.id));
    if (body) body.style.zIndex = OBJ_Z[objLayerOf(o)] + Math.min(i, OBJ_Z_SPAN - 1);
  });
}

document.addEventListener('pointerdown', e => { if (!e.target.closest('.obj-wrap')) deselect(); });

/* ══════════════════════════════════════════════════════════════════════
   ABWAEHLEN VON AUSSEN

   Der Faenger darueber steht in der BLASENPHASE. canvas/strokeSelect.js
   faengt einen Tipp auf einen Strich aber schon in der Abfangphase ab und
   haelt ihn mit stopPropagation an – hier kam er dann nie an. Ein
   ausgewaehltes Bild blieb deshalb ausgewaehlt, waehrend daneben die
   Huelle des Strichs aufging: zwei Auswahlen, zwei Leisten, und Entf traf
   beides. Genau so wurde es gemeldet.

   Statt den Faenger ebenfalls in die Abfangphase zu ziehen – dort raeumte
   er zu frueh weg, noch bevor feststeht, ob ueberhaupt etwas anderes
   ausgewaehlt wird – sagt strokeSelect.js jetzt ausdruecklich Bescheid.
   Die Gegenrichtung steht in select(): dort wird die Strich-Huelle
   weggenommen.
   ══════════════════════════════════════════════════════════════════════ */
window.deselectObject = deselect;

/* ══════════════════════════════════════════════════════════════════════
   EIN BILD HINTER DEM TEXT ANKLICKEN

   Es liegt unter .j-text, und das Textfeld nimmt in der Zeigerstellung
   JEDEN Klick entgegen – auch dort, wo gar kein Buchstabe steht. Ein
   einmal nach hinten gestelltes Bild war damit für immer verloren: man
   kam nur noch ins Schreiben.

   Deshalb wird hier vorher abgefangen. Die Regel ist die, die man von
   Textverarbeitungen kennt:

     · auf einem Buchstaben  →  der Text gewinnt, der Blinker springt hin
     · irgendwo sonst        →  das Bild darunter wird ausgewählt
     · mit Alt               →  immer das Bild, auch mitten im Wort

   Ob ein Buchstabe unter dem Zeiger liegt, beantwortet nicht die Fläche
   des Absatzes, sondern das Rechteck des einzelnen Zeichens neben der
   Einfügemarke. Eine leere Zeile oder der Platz unter dem letzten Absatz
   zählen dadurch als „kein Text".
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Das oberste Objekt an dieser Bildschirmstelle – oder null.
 *
 * Gefragt wird das RECHTECK und nicht die Form darin: eine Ellipse ohne
 * Füllung hat sonst nur ihren Umriss, und den trifft mit dem Finger
 * niemand. Genau so wurde es gemeldet.
 *
 * @param {string} [band] 'back' oder 'front' – ohne Angabe zählt jedes
 */
function objectAt(pageEl, x, y, band) {
  const layer = pageEl && pageEl.querySelector('.j-objects');
  if (!layer) return null;

  // Von vorn nach hinten: das zuletzt gezeichnete liegt oben
  const wraps = [...layer.querySelectorAll('.obj-wrap')].reverse();
  for (const wrap of wraps) {
    if (band && wrap.dataset.layer !== band) continue;
    if (typeof wrap._beginObjInteraction !== 'function') continue;
    const r = wrap.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return wrap;
  }
  return null;
}

/** Das oberste Bild unter dem Zeiger, das hinter dem Text liegt. */
function backObjectAt(pageEl, x, y) {
  return objectAt(pageEl, x, y, 'back');
}

/** Die Einfügemarke an einer Bildschirmstelle – über beide Schreibweisen. */
function caretAt(x, y) {
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  return null;
}

/** Steht an dieser Stelle wirklich ein Zeichen? */
function pointIsOnText(pageEl, x, y) {
  const textDiv = pageEl.querySelector('.j-text');
  if (!textDiv) return false;

  const caret = caretAt(x, y);
  if (!caret || !textDiv.contains(caret.node)) return false;

  const node = caret.node;
  if (node.nodeType !== 3) return false;   // kein Textknoten – also kein Zeichen

  /* Beide Nachbarn der Einfügemarke ansehen: der Klick kann links oder
     rechts vom gefundenen Punkt auf dem Zeichen gelandet sein. */
  const len = node.textContent.length;
  const spans = [[caret.offset - 1, caret.offset], [caret.offset, caret.offset + 1]];

  for (const [from, to] of spans) {
    if (from < 0 || to > len) continue;
    const probe = document.createRange();
    probe.setStart(node, from);
    probe.setEnd(node, to);
    for (const r of probe.getClientRects()) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
  }
  return false;
}

document.addEventListener('pointerdown', e => {
  if (typeof S === 'undefined' || S.mode !== 'cursor') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // Ein Bild in der vorderen Ebene bekommt seinen Klick ohnehin selbst
  if (e.target.closest('.obj-wrap')) return;

  const pageEl = e.target.closest ? e.target.closest('.j-page') : null;
  if (!pageEl) return;

  const wrap = backObjectAt(pageEl, e.clientX, e.clientY);
  if (!wrap) return;

  /* Ist es schon ausgewählt, gewinnt es immer: sonst verlöre man es beim
     Verschieben, sobald der Zeiger über einem Buchstaben aufsetzt. */
  if (_selObj !== wrap && !e.altKey && pointIsOnText(pageEl, e.clientX, e.clientY)) return;

  e.preventDefault();
  e.stopPropagation();
  wrap._beginObjInteraction(e);
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

/* ── Bedienteile über allem, das Bild bleibt liegen ─────────────────
   Griffe und Leiste sassen zunächst im selben Element wie das Bild. Bei
   einem Bild hinter dem Text lagen sie damit selbst unter dem Text:
   unsichtbar und nicht anzuklicken. Der erste Versuch war, das Bild beim
   Auswählen nach vorn zu holen – dann sprang es aber sichtbar vor den
   Text und stellte die eingestellte Ebene in Frage.

   Deshalb sind es jetzt zwei Geschwister in einem Rahmen ohne eigenen
   Stapel (.obj-wrap hat z-index:auto und KEIN transform – beides würde
   die Kinder einsperren):

     .obj-body    das Bild        z-index 2 oder 20, je nach Ebene
     .obj-chrome  Griffe, Leiste  z-index 30, also immer obenauf

   Beide liegen deckungsgleich auf dem Rahmen und drehen sich getrennt,
   aber gleich weit. Die Ebene des Bildes ändert sich durch das Auswählen
   damit überhaupt nicht mehr. */
const OBJ_Z_CHROME = 5000;

function deselect() {
  if (!_selObj) return;
  _selObj.classList.remove('selected');
  const chrome = _selObj.querySelector('.obj-chrome');
  if (chrome) chrome.style.display = 'none';
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
  // Nur Lage und Größe – kein z-index, kein transform (siehe OBJ_Z_CHROME)
  wrap.style.cssText = 'left:' + obj.x + 'px;top:' + obj.y + 'px;width:' + obj.w + 'px;height:' + obj.h + 'px;position:absolute;pointer-events:none';

  const body = document.createElement('div'); body.className = 'obj-body';
  /* Die Art steht am Koerper, damit der Stil sie unterscheiden kann:
     eine Form braucht mehr Rand zum Anfassen als ein Bild
     (css/pages.css). */
  body.dataset.kind = obj.kind || 'datei';
  body.style.pointerEvents = S.mode === 'cursor' ? 'auto' : 'none';
  if (obj.kind === 'image') { const img = document.createElement('img'); img.src = obj.src; img.draggable = false; img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;border-radius:2px'; body.appendChild(img); }
  else if (obj.kind === 'shape') { body.innerHTML = renderShapeBody(obj); }
  else if (obj.kind === 'formula') { body.innerHTML = renderFormulaBody(obj); }
  else { body.innerHTML = '<div style="background:#ede8dc;border:1px solid #cfc5b0;border-radius:6px;padding:8px 14px;font-size:13px;color:#4a3d2e;height:100%;display:flex;align-items:center;gap:8px">📎 ' + (obj.name || 'Datei') + '</div>'; }
  wrap.appendChild(body);

  /* Die Bedienteile. Der Rahmen selbst lässt Klicks durch, sonst läge er
     als unsichtbare Scheibe über dem Text – nur Griffe und Leiste fangen
     sie ab. */
  const chrome = document.createElement('div'); chrome.className = 'obj-chrome';
  chrome.style.zIndex = OBJ_Z_CHROME;
  chrome.style.display = 'none';
  wrap.appendChild(chrome);

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

  /* ══════════════════════════════════════════════════════════════════
     LINIE UND PFEIL: GRIFFE AN DEN ENDEN

     Ein Bild fasst man an den Ecken – bei einer Linie ist das falsch. Die
     Ecken gehoeren zum umschliessenden Rechteck, das man gar nicht sieht;
     man will den ANFANG und das ENDE bewegen. Genau so wurde es gemeldet.

     Deshalb bekommen Linie und Pfeil zwei runde Griffe statt vier Ecken
     und keinen Drehgriff: das Drehen steckt schon darin, wenn man ein
     Ende bewegt.
     ══════════════════════════════════════════════════════════════════ */
  const istLinie = obj.kind === 'shape'
    && (obj.shapeType === 'line' || obj.shapeType === 'arrow');

  if (istLinie) {
    baueEndGriffe();
  } else {
  ['tl', 'tr', 'bl', 'br'].forEach(pos => {
    const h = document.createElement('div'); h.className = 'obj-handle ' + pos; chrome.appendChild(h);
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
        // Eine Formel darf kleiner werden als ein Bild – sie ist oft nur
        // ein paar Zeichen breit und waere sonst nicht zu verkleinern
        const mind = obj.kind === 'formula' ? 12 : 20;
        // Auch beim Ziehen an der Oberkante bleibt der Seitenkopf frei
        if (ny < CFG.HDR) { nh -= (CFG.HDR - ny); ny = CFG.HDR; }
        /* Nicht ueber das Blatt hinaus WACHSEN. Nur wachsen: sonst liesse
           sich ein Objekt, das von frueher ueber dem Rand liegt, nicht
           einmal mehr kleiner ziehen. */
        const pw = page.w || CFG.PAGE_W, ph = page.h || CFG.PAGE_H;
        if (nw > ow && (nx < 0 || nx + nw > pw || ny + nh > ph)) return;
        if (nw > mind && nh > mind) {
          obj.w = nw; obj.h = nh; obj.x = nx; obj.y = ny;
          wrap.style.left = obj.x + 'px'; wrap.style.top = obj.y + 'px'; wrap.style.width = obj.w + 'px'; wrap.style.height = obj.h + 'px';
          // Formel-Inhalt neu rendern – er wird über transform:scale(k) mit
          // k = w/natW skaliert, nicht über Breitenänderung allein
          if (obj.kind === 'formula') { body.innerHTML = renderFormulaBody(obj); }
          placeBar();
        }
      };
      const up = (ev) => { hideSnaps(); h.releasePointerCapture(ev.pointerId); h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); if (_hasMutated) noteObjectChanged(); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
    });
  });

  const rotH = document.createElement('div'); rotH.className = 'obj-handle rot'; rotH.textContent = '↻'; chrome.appendChild(rotH);
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
  }

  /**
   * Zwei runde Griffe an Anfang und Ende einer Linie.
   *
   * Beim Ziehen wird der absolute Punkt gerechnet, daraus das neue
   * umschliessende Rechteck – und darin liegen beide Enden wieder als
   * Anteil. So bleibt die Linie das, was sie ist, egal wohin man zieht.
   */
  function baueEndGriffe() {
    const griffe = [];

    function stelleGriffe() {
      const e = shapeEnden(obj);
      const punkte = [e.p1, e.p2];
      griffe.forEach((g, i) => {
        g.style.left = (punkte[i].x * obj.w) + 'px';
        g.style.top = (punkte[i].y * obj.h) + 'px';
      });
    }

    [0, 1].forEach(nr => {
      const g = document.createElement('div');
      g.className = 'obj-handle end';
      chrome.appendChild(g);
      griffe.push(g);

      g.addEventListener('pointerdown', e => {
        e.stopPropagation(); e.preventDefault();
        g.setPointerCapture(e.pointerId);

        const start = shapeEnden(obj);
        // Beide Enden in Seiten-Koordinaten
        const abs = [
          { x: obj.x + start.p1.x * obj.w, y: obj.y + start.p1.y * obj.h },
          { x: obj.x + start.p2.x * obj.w, y: obj.y + start.p2.y * obj.h }
        ];
        const sx = e.clientX, sy = e.clientY;
        const fest = abs[1 - nr];      // das andere Ende bleibt liegen
        const beweglich = { x: abs[nr].x, y: abs[nr].y };

        let _hasMutated = false;
        const mv = ev => {
          if (!_hasMutated) { _hasMutated = true; pushPageHistory(page); }

          let nx = beweglich.x + (ev.clientX - sx) / _zoom;
          let ny = beweglich.y + (ev.clientY - sy) / _zoom;

          // Mit Umschalt auf 15°-Schritte – fuer waagerecht und senkrecht
          if (ev.shiftKey) {
            const dx = nx - fest.x, dy = ny - fest.y;
            const len = Math.hypot(dx, dy);
            const schritt = Math.PI / 12;
            const w = Math.round(Math.atan2(dy, dx) / schritt) * schritt;
            nx = fest.x + Math.cos(w) * len;
            ny = fest.y + Math.sin(w) * len;
          }

          // Auch ein Linienende bleibt auf dem Blatt – nach dem Einrasten,
          // sonst drehte der Winkelschritt es wieder hinaus
          nx = klemme(nx, 0, page.w || CFG.PAGE_W);
          ny = klemme(ny, CFG.HDR, page.h || CFG.PAGE_H);

          const p = [null, null];
          p[nr] = { x: nx, y: ny };
          p[1 - nr] = fest;

          const minX = Math.min(p[0].x, p[1].x), maxX = Math.max(p[0].x, p[1].x);
          const minY = Math.min(p[0].y, p[1].y), maxY = Math.max(p[0].y, p[1].y);
          // Ein Rechteck ohne Ausdehnung liesse sich nicht mehr anfassen
          const bw = Math.max(2, maxX - minX), bh = Math.max(2, maxY - minY);

          obj.x = minX; obj.y = minY; obj.w = bw; obj.h = bh;
          obj.p1 = { x: (p[0].x - minX) / bw, y: (p[0].y - minY) / bh };
          obj.p2 = { x: (p[1].x - minX) / bw, y: (p[1].y - minY) / bh };

          wrap.style.left = obj.x + 'px'; wrap.style.top = obj.y + 'px';
          wrap.style.width = obj.w + 'px'; wrap.style.height = obj.h + 'px';
          body.innerHTML = renderShapeBody(obj);
          stelleGriffe();
          placeBar();
        };
        const up = ev => {
          try { g.releasePointerCapture(ev.pointerId); } catch (err) { }
          g.removeEventListener('pointermove', mv);
          g.removeEventListener('pointerup', up);
          if (_hasMutated) noteObjectChanged();
        };
        g.addEventListener('pointermove', mv);
        g.addEventListener('pointerup', up);
      });
    });

    stelleGriffe();
    // Nach dem Auswaehlen sitzen sie sofort richtig
    wrap._stelleEndGriffe = stelleGriffe;
  }

  /* ── Schwebende Leiste ────────────────────────────────────────────
     Alles, was nicht am Rahmen selbst geschieht, steht hier: drehen,
     Ebene wechseln, stapeln, verdoppeln, löschen. Vorher gab es dafür
     einen einzigen roten Knopf zum Löschen und sonst nichts. */
  const bar = document.createElement('div');
  bar.className = 'obj-bar';
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

  /**
   * Dreht Bild und Bedienteile getrennt, aber gleich weit.
   *
   * Getrennt, weil eine Drehung am gemeinsamen Rahmen einen eigenen
   * Stapel aufmachen und die Bedienteile wieder unter den Text sperren
   * würde. Beide liegen deckungsgleich auf demselben Rechteck und drehen
   * um dessen Mitte – das Ergebnis ist dasselbe.
   */
  function applyRotation() {
    const deg = 'rotate(' + (obj.rot || 0) + 'deg)';
    body.style.transform = deg;
    chrome.style.transform = deg;
    // Die Leiste dreht sich gegen: sonst stünde sie auf dem Kopf.
    // Ihre Stelle rechnet placeBar() aus, samt Gegendrehung.
    placeBar();
  }

  /* Luft zwischen Leiste und Blattrand. */
  const BAR_LUFT = 6;

  /* ══════════════════════════════════════════════════════════════════
     DIE LEISTE BLEIBT AUF DEM BLATT

     Sie steht mittig über der Form. Stand die Form am linken oder
     rechten Rand, ragte die Leiste über das Blatt hinaus – und .j-page
     schneidet ab (overflow: hidden, css/pages.css). Die halbe Leiste
     fehlte also, und die Knöpfe darin waren nicht zu treffen.

     Zu sehen war sie nur, WÄHREND man die Form schob: dann trägt die
     Seite kurz .obj-dragging und schneidet nichts ab. Beim Loslassen
     verschwand sie wieder unter dem Rand. Genau so wurde es gemeldet.

     Statt am Abschneiden zu drehen – das brauchen die Seiten, damit
     Striche nicht auf die nächste überlaufen – wird die Leiste hier ins
     Blatt zurückgeschoben. Senkrecht dasselbe: über der Form, solange
     darüber Blatt ist, sonst darunter. Gemessen wird an der wirklichen
     Höhe der Leiste; vorher stand dort die feste Zahl 64, und in einer
     Sprache mit längeren Beschriftungen stimmte sie nicht mehr.
     ══════════════════════════════════════════════════════════════════ */
  function placeBar() {
    const pw = (page && page.w) || (typeof CFG !== 'undefined' ? CFG.PAGE_W : 794);
    const bh = bar.offsetHeight || 40;
    const bw = bar.offsetWidth || 0;

    // Senkrecht: oben, wenn oben Platz ist
    bar.classList.toggle('below', (obj.y || 0) - bh - 12 < BAR_LUFT);

    /* Waagerecht: die Mitte der Form, aber nicht über den Rand hinaus.
       Ist die Leiste breiter als das Blatt, bleibt sie mittig – dann ist
       jede Verschiebung nur eine andere Art, daneben zu liegen. */
    const mitte = (obj.x || 0) + (obj.w || 0) / 2;
    const links = BAR_LUFT + bw / 2;
    const rechts = pw - BAR_LUFT - bw / 2;
    const soll = links > rechts ? mitte : Math.max(links, Math.min(rechts, mitte));

    bar.style.transform = 'translateX(calc(-50% + ' + Math.round(soll - mitte) + 'px)) '
      + 'rotate(' + (-(obj.rot || 0)) + 'deg)';
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
    wrap.dataset.layer = which;
    // Nur das Band wechselt; die Stelle unter den Bildern bleibt dieselbe
    restackObjects(objLayer, page);
    markLayerButtons();
    updateUndoRedoUI();
    noteObjectChanged();
    if (which === 'back' && typeof toast === 'function') {
      toast(objText('objBehindHint', 'Liegt jetzt hinter dem Text.'));
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
    // Nur die Stelle im Band wechselt; das Band selbst bleibt
    restackObjects(objLayer, page);
    updateUndoRedoUI();
    noteObjectChanged();
  }

  function duplicate() {
    pushPageHistory(page);
    const copy = { ...obj, id: uid(), x: (obj.x || 0) + 16, y: (obj.y || 0) + 16 };
    // Die Kopie liegt versetzt – am Blattrand sonst schon halb daneben
    haltAufBlatt(copy, page);
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
    restackObjects(objLayer, page);
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

  // Form-spezifische Knöpfe: Füllung und Linienstärke
  if (obj.kind === 'shape' && typeof addShapeChrome === 'function') {
    addShapeChrome(bar, obj, page, objLayer);
  }

  /* Formel: ein Stift, der den Editor wieder aufmacht. Doppelklick tut es
     auch (siehe unten), aber ein sichtbarer Knopf sagt, dass es geht. */
  if (obj.kind === 'formula') {
    const bearbeiten = () => {
      if (typeof openFormulaEditor !== 'function') return;
      openFormulaEditor(obj.latex || '', !!obj.display, null, {
        obj, page,
        neuZeichnen: () => {
          wrap.style.width = obj.w + 'px';
          wrap.style.height = obj.h + 'px';
          body.innerHTML = renderFormulaBody(obj);
          placeBar();
        }
      });
    };
    barBtn('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11.3 2.2 13.8 4.7 5.6 12.9 2.4 13.6 3.1 10.4z"/></svg>',
      objText('formulaEdit', 'Formel bearbeiten'), bearbeiten);
    // Doppelklick auf die Formel selbst öffnet ihn ebenfalls
    body.addEventListener('dblclick', ev => { ev.preventDefault(); ev.stopPropagation(); bearbeiten(); });
  }

  function markLayerButtons() {
    const back = objLayerOf(obj) === 'back';
    btnBack.classList.toggle('active', back);
    btnFront.classList.toggle('active', !back);
  }
  markLayerButtons();
  applyRotation();

  chrome.appendChild(bar);
  wrap.dataset.objid = String(obj.id);
  // backObjectAt() liest hier ab, ob dieses Bild hinter dem Text liegt
  wrap.dataset.layer = objLayerOf(obj);

  /** Zeigt Griffe und Leiste. Die Ebene des Bildes bleibt unberührt. */
  function select() {
    deselect();
    /* ══════════════════════════════════════════════════════════════
       ES DARF IMMER NUR EINES AUSGEWAEHLT SEIN

       Auswaehlen gibt es zweimal: hier fuer Bilder, Formen und Formeln,
       und in canvas/strokeSelect.js fuer Gezeichnetes. Beide wussten
       nichts voneinander. Der Weg dorthin ging nur in eine Richtung:
       wer einen Strich antippte, verlor das Bild (der Faenger ganz oben
       in dieser Datei raeumt es weg) – wer aber ein Bild antippte,
       behielt die Huelle des Strichs. Danach standen zwei Leisten
       nebeneinander, und Entf traf beides. Genau so wurde es gemeldet.

       Hier fehlte also die Gegenrichtung.
       ══════════════════════════════════════════════════════════════ */
    if (typeof window.deselectStroke === 'function') window.deselectStroke();
    _selObj = wrap;
    wrap.classList.add('selected');
    chrome.style.display = 'block';
    // Die Endgriffe einer Linie sitzen an den Enden, nicht an den Ecken –
    // nach einem Verschieben muessen sie neu gestellt werden
    if (wrap._stelleEndGriffe) wrap._stelleEndGriffe();
    placeBar();
  }

  /**
   * Nimmt der Finger dieses Ding schon beim ersten Zug mit?
   *
   * Ja, solange daneben noch genug Blatt zum Rollen bleibt. Gemessen
   * wird nur die HOEHE: gerollt wird senkrecht, und ein breites, flaches
   * Ding steht dem nicht im Weg. Ein Drittel der Seite ist die Grenze –
   * darueber bliebe auf einem Handy kaum noch etwas uebrig, woran der
   * Finger die Seite fassen koennte.
   */
  function passtInDenGriff() {
    const ph = (page && page.h) || (typeof CFG !== 'undefined' ? CFG.PAGE_H : 1123);
    return (obj.h || 0) <= ph / 3;
  }

  /** Auswählen und, solange der Zeiger unten bleibt, verschieben. */
  function beginInteraction(e) {
    if (S.mode !== 'cursor') return;
    if (e.target.closest && e.target.closest('.obj-handle,.obj-bar')) return;
    e.stopPropagation(); e.preventDefault();

    /* ══════════════════════════════════════════════════════════════
       MIT DEM FINGER: ERST ANTIPPEN, DANN SCHIEBEN – ABER NUR BEI
       GROSSEN DINGEN

       Ein Bild ist gross, oft die halbe Seite. Faengt das Verschieben
       schon bei der ersten Beruehrung an, hat der Browser die Wahl
       zwischen Scrollen und Schieben – und er entscheidet sich fuers
       Scrollen: die Seite lief unter dem Finger weg, das Bild blieb
       liegen. Genau so wurde es gemeldet. Deshalb waehlt die erste
       Beruehrung dort nur aus; erst am AUSGEWAEHLTEN Bild steht
       touch-action: none (css/pages.css), und dann gehoert die Bewegung
       dem Bild allein.

       >>> Warum das nicht fuer alles gilt <<<
       Bei einer Form ist es genau verkehrt herum. Sie ist klein, und
       rundherum bleibt Blatt genug zum Rollen – trotzdem musste man sie
       zweimal anfassen, um sie einen Zentimeter zu schieben. Der erste
       Zug tat sichtbar nichts, und das las sich wie „sie laesst sich
       nicht anfassen". Genau so wurde es gemeldet.

       Massgebend ist deshalb, ob das Ding das Rollen ueberhaupt
       behindert: siehe passtInDenGriff(). Was schmal genug ist, gehoert
       dem Finger sofort – dazu haelt der touchstart-Hoerer weiter unten
       die Seite an. Was hoch ist, bleibt beim Antippen zuerst.

       Maus und Stift treffen genau, fuer sie war es nie ein Problem. */
    if (e.pointerType === 'touch' && _selObj !== wrap && !passtInDenGriff()) {
      select();
      /* Und die Berührung darf nicht gleich noch die Schreibmarke in die
         Zeile darunter setzen: auf einem Tablet fährt sonst die
         Bildschirmtastatur heraus, obwohl nur eine Form ausgewählt
         werden sollte (canvas/input.js). */
      if (typeof unterdrueckeTextTipp === 'function') unterdrueckeTextTipp();
      return;
    }

    select();
    body.setPointerCapture(e.pointerId);
    // Waehrend des Zugs darf das Bild ueber den Seitenrand hinausragen
    let aktPgEl = wrap.closest('.j-page');
    let aktPage = page, aktLayer = objLayer;
    let gewechselt = false;
    if (aktPgEl) aktPgEl.classList.add('obj-dragging');
    let sx = e.clientX, sy = e.clientY, ox = obj.x, oy = obj.y;

    let xs = [], ys = [], cxs = [], cys = [];
    function sammleNachbarn() {
      xs = []; ys = []; cxs = []; cys = [];
      (aktPage.objects || []).filter(o => o.id !== obj.id).forEach(o => {
        xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h);
        cxs.push(o.x + o.w / 2); cys.push(o.y + o.h / 2);
      });
    }
    sammleNachbarn();

    /* ══════════════════════════════════════════════════════════════
       AUF DIE ANDERE SEITE, WÄHREND MAN ZIEHT

       Bisher entschied sich das erst beim Loslassen: man musste den
       Finger auf die andere Seite legen, loslassen, und erst dann sprang
       das Bild hinüber – bis dahin sah es aus, als ginge gar nichts.
       Genau so wurde es gemeldet.

       Jetzt wandert es, sobald der Zeiger wirklich IN einer anderen Seite
       steht (nicht schon in der Lücke dazwischen – dort flackerte es
       zwischen beiden hin und her). Der Bezugspunkt wird dabei neu
       gesetzt, sonst ruckte das Bild beim nächsten Millimeter um eine
       ganze Seitenlänge.
       ══════════════════════════════════════════════════════════════ */
    function seiteUnterZeiger(cx, cy) {
      for (const el of QA('.j-page')) {
        const r = el.getBoundingClientRect();
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return el;
      }
      return null;
    }

    /**
     * @param {number} rohX  Lage auf der ALTEN Seite, noch ungeklemmt
     * @returns {{x:number,y:number}|null} dieselbe Lage, auf die neue Seite
     *   umgerechnet – der Aufrufer rechnet damit weiter
     *
     * >>> Warum die ROHE Lage und nicht der Rahmen auf dem Bildschirm <<<
     * Hier wurde wrap.getBoundingClientRect() genommen und das Ergebnis
     * mit haltAufBlatt() auf die neue Seite geklemmt. Beides ging schief,
     * und zwar zusammen:
     *
     *   · Der Rahmen steht noch dort, wo die VORIGE Bewegung ihn gesetzt
     *     hat. Bei einem schnellen Zug – und über eine Seitengrenze zieht
     *     man schnell – hinkt er einen Schritt hinterher.
     *   · Das Klemmen schrieb die zurechtgerückte Lage in den Bezugspunkt
     *     (ox/oy). Wer ein Bild an seiner Unterkante hielt, dessen
     *     Oberkante beim Übertritt noch über der neuen Seite lag, bekam
     *     sie an den oberen Rand geschoben – und von da an folgte das Bild
     *     dem Finger nicht mehr, sondern klebte oben. Genau so gemeldet.
     *
     * Die rohe Lage kennt der Aufrufer; umgerechnet wird nur der Bezug
     * (Seite A → Seite B). Geklemmt wird danach wie bei jeder anderen
     * Bewegung auch – für die Anzeige, nicht für den Bezugspunkt.
     */
    function wechsleSeite(zielEl, ev, rohX, rohY) {
      const info = getPage(zielEl.dataset.pgid);
      const zielLayer = zielEl.querySelector('.j-objects');
      if (!info || !zielLayer || info.page === aktPage || !aktPgEl) return null;

      // Beide Seiten aendern sich – beide brauchen ihren Rueckgaengig-Schritt
      pushPageHistory(info.page);

      const alt = aktPgEl.getBoundingClientRect();
      const ziel = zielEl.getBoundingClientRect();
      const nx = rohX + (alt.left - ziel.left) / _zoom;
      const ny = rohY + (alt.top - ziel.top) / _zoom;

      aktPage.objects = (aktPage.objects || []).filter(o => o.id !== obj.id);
      (info.page.objects || (info.page.objects = [])).push(obj);

      obj.x = nx; obj.y = ny;
      wrap.style.left = obj.x + 'px';
      wrap.style.top = obj.y + 'px';

      zielLayer.appendChild(wrap);
      /* ══════════════════════════════════════════════════════════════
         DER ZEIGER MUSS NEU GEFANGEN WERDEN

         Ein Element umzuhängen ist für den Browser ein Herausnehmen und
         ein Einsetzen – und dabei verliert es den gefangenen Zeiger.
         Danach kamen die Bewegungen nicht mehr an: das Bild blieb genau
         dort stehen, wo es beim Übertritt gerade war, und liess sich
         nicht mehr nachführen. Wer schnell nach oben zog, hatte es
         deshalb oben kleben – gemeldet als „es geht ganz oben hin und
         nicht dahin, wo ich den Finger gelassen habe".
         ══════════════════════════════════════════════════════════════ */
      try { body.setPointerCapture(ev.pointerId); } catch (err) { }
      aktPgEl.classList.remove('obj-dragging');
      zielEl.classList.add('obj-dragging');

      aktPgEl = zielEl; aktPage = info.page; aktLayer = zielLayer;
      ox = nx; oy = ny; sx = ev.clientX; sy = ev.clientY;
      gewechselt = true;
      sammleNachbarn();
      return { x: nx, y: ny };
    }

    let _hasMutated = false;
    const mv = ev => {
      if (!_hasMutated) { _hasMutated = true; pushPageHistory(page); }
      hideSnaps();

      // Erst die rohe Lage, dann der Seitenwechsel: er rechnet sie um
      let nx = ox + (ev.clientX - sx) / _zoom, ny = oy + (ev.clientY - sy) / _zoom;

      const unterZeiger = seiteUnterZeiger(ev.clientX, ev.clientY);
      if (unterZeiger && unterZeiger !== aktPgEl) {
        const umgerechnet = wechsleSeite(unterZeiger, ev, nx, ny);
        if (umgerechnet) { nx = umgerechnet.x; ny = umgerechnet.y; }
      }

      let sXL = getSnaps(nx, xs), sXR = getSnaps(nx + obj.w, xs), sXC = getSnaps(nx + obj.w / 2, cxs);
      if (sXL.sn) { nx = sXL.v; showSnap('v', nx); } else if (sXR.sn) { nx = sXR.v - obj.w; showSnap('v', sXR.v); } else if (sXC.sn) { nx = sXC.v - obj.w / 2; showSnap('v', sXC.v); }

      let sYT = getSnaps(ny, ys), sYB = getSnaps(ny + obj.h, ys), sYC = getSnaps(ny + obj.h / 2, cys);
      if (sYT.sn) { ny = sYT.v; showSnap('h', ny); } else if (sYB.sn) { ny = sYB.v - obj.h; showSnap('h', sYB.v); } else if (sYC.sn) { ny = sYC.v - obj.h / 2; showSnap('h', sYC.v); }

      /* Nicht ueber den Blattrand und nicht in den Seitenkopf hinauf –
         siehe objGrenzen(). Dort stehen Seitenzahl, Datum und die zwei
         Knoepfe; ein Bild darueber deckte sie zu, und weil es vor dem
         Text liegt, war der Kopf danach nicht mehr zu treffen. */
      const g = objGrenzen(obj, aktPage);
      nx = klemme(nx, g.minX, g.maxX);
      ny = klemme(ny, g.minY, g.maxY);

      obj.x = nx; obj.y = ny; wrap.style.left = obj.x + 'px'; wrap.style.top = obj.y + 'px';
      placeBar();
    };
    const up = (ev) => {
      hideSnaps();
      try { body.releasePointerCapture(ev.pointerId); } catch (err) { }
      body.removeEventListener('pointermove', mv);
      body.removeEventListener('pointerup', up);
      body.removeEventListener('pointercancel', up);
      if (aktPgEl) aktPgEl.classList.remove('obj-dragging');

      if (gewechselt) {
        /* Unterwegs auf eine andere Seite gewandert: neu aufbauen, denn
           alle Schliessungen hier zeigen noch auf die alte. */
        restackObjects(aktLayer, aktPage);
        deselect();
        wrap.remove();
        placeObject(aktLayer, obj, aktPage);
        updateUndoRedoUI();
        noteObjectChanged();
        return;
      }

      /* Losgelassen ueber einer anderen Seite, ohne dass der Zeiger je
         darin stand – etwa in der Luecke dazwischen. Dann entscheidet
         wie bisher die Stelle des Loslassens. */
      const gewandert = ev.type === 'pointerup' && moveToPageAt(ev.clientX, ev.clientY);
      if (_hasMutated && !gewandert) noteObjectChanged();
    };
    body.addEventListener('pointermove', mv);
    body.addEventListener('pointerup', up);
    body.addEventListener('pointercancel', up);
  }

  /* ══════════════════════════════════════════════════════════════════
     UEBER DEN SEITENRAND HINAUS

     Ein Bild ans Seitenende zu schieben ging bisher „einfach weiter":
     .j-page schneidet ab, das Bild verschwand unter dem Rand und lag
     danach ausserhalb der Seite. Auf die naechste Seite kam es nur ueber
     Ausschneiden und Einfuegen.

     Jetzt entscheidet die Stelle, an der losgelassen wird. Sie wird ueber
     die Rechtecke der Seiten gesucht und nicht ueber elementFromPoint:
     unter dem Zeiger liegt das Bild selbst, das gerade geschoben wird.

     Die Seite darf zu einem anderen Abschnitt gehoeren – gezeigt wird
     ohnehin nur, was gerade sichtbar ist, und wo es hinfaellt, ist die
     Absicht des Nutzers.
     ══════════════════════════════════════════════════════════════════ */
  function pageElAt(clientX, clientY) {
    const seiten = QA('.j-page');
    let naechste = null, kuerzeste = Infinity;
    for (const el of seiten) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return el;
      /* Zwischen zwei Seiten liegt eine Luecke. Wer dort loslaesst, hat
         nicht „daneben" gemeint – das Bild gehoert dann zur naechsten
         Seite, sonst bliebe es im Nichts zwischen beiden haengen. */
      const abstand = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
      if (abstand < kuerzeste) { kuerzeste = abstand; naechste = el; }
    }
    return naechste;
  }

  /**
   * Legt das Bild auf die Seite unter dieser Stelle, wenn es eine andere ist.
   *
   * @returns {boolean} ob es umgezogen ist
   */
  function moveToPageAt(clientX, clientY) {
    const zielEl = pageElAt(clientX, clientY);
    if (!zielEl || zielEl === wrap.closest('.j-page')) return false;

    const info = getPage(zielEl.dataset.pgid);
    const zielLayer = zielEl.querySelector('.j-objects');
    if (!info || !zielLayer) return false;

    // Beide Seiten aendern sich – beide brauchen ihren Rueckgaengig-Schritt
    pushPageHistory(info.page);

    /* Die neue Lage aus dem Bildschirm zurueckrechnen. Ueber die Ecke des
       Rahmens, nicht ueber den Zeiger: sonst spraenge das Bild beim
       Loslassen unter den Finger. */
    const alt = wrap.getBoundingClientRect();
    const ziel = zielEl.getBoundingClientRect();
    obj.x = Math.round((alt.left - ziel.left) / _zoom);
    obj.y = Math.round((alt.top - ziel.top) / _zoom);
    /* Losgelassen wird ueber der neuen Seite, das Bild selbst haengt aber
       noch am unteren Rand der alten: umgerechnet ergaebe das ein y weit
       oberhalb der neuen Seite. Es faengt dort also oben an. */
    haltAufBlatt(obj, info.page);

    page.objects = (page.objects || []).filter(o => o.id !== obj.id);
    (info.page.objects || (info.page.objects = [])).push(obj);

    deselect();
    wrap.remove();
    restackObjects(objLayer, page);
    // Neu aufbauen: die Schliessungen hier zeigen alle auf die alte Seite
    placeObject(zielLayer, obj, info.page);
    updateUndoRedoUI();
    noteObjectChanged();
    return true;
  }

  body.addEventListener('pointerdown', beginInteraction);
  /* Für den Griff von außen: ein Bild hinter dem Text bekommt seinen
     Klick nicht selbst, den reicht der Fänger ganz oben herein. */
  wrap._beginObjInteraction = beginInteraction;
  /* Damit eine frisch eingesetzte Form gleich in der Hand liegt
     (canvas/shapes.js, insertShape). */
  wrap._waehleObjekt = select;

  let pinchStartDist = 0, pinchStartW = 0, pinchStartH = 0;
  let _pinchHasMutated = false;
  body.addEventListener('touchstart', e => {
    /* ══════════════════════════════════════════════════════════════
       DEN FINGER FESTHALTEN

       Ohne das entscheidet der Browser mitten in der Bewegung auf
       Rollen, bricht die Zeigerfolge mit pointercancel ab, und das Ding
       bleibt liegen, waehrend die Seite wegläuft. touch-action allein
       reicht hier nicht: es steht nur am AUSGEWAEHLTEN Ding
       (css/pages.css), und beim ersten Zug ist noch nichts ausgewaehlt.

       Angehalten wird nur, was der Finger auch wirklich mitnimmt –
       dieselbe Bedingung wie oben in beginInteraction(). Ueber allem
       anderen rollt die Seite weiter wie gewohnt.
       ══════════════════════════════════════════════════════════════ */
    if (e.touches.length === 1 && S.mode === 'cursor' && passtInDenGriff()) {
      e.preventDefault();
      return;
    }
    if (e.touches.length === 2 && S.mode === 'cursor') {
      e.stopPropagation(); e.preventDefault();
      pinchStartDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      pinchStartW = obj.w; pinchStartH = obj.h;
      _pinchHasMutated = false;
      select();
    }
  }, { passive: false });
  body.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchStartDist > 0 && S.mode === 'cursor') {
      e.stopPropagation(); e.preventDefault();
      if (!_pinchHasMutated) { _pinchHasMutated = true; pushPageHistory(page); }
      const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      const scale = dist / pinchStartDist;
      let nw = pinchStartW * scale, nh = pinchStartH * scale;
      // Formeln dürfen kleiner werden als Bilder (Mindestmaß 12 statt 40×30)
      const mindW = obj.kind === 'formula' ? 12 : 20;
      const mindH = obj.kind === 'formula' ? 12 : 20;
      if (nw > mindW && nh > mindH) {
        obj.x -= (nw - obj.w) / 2; obj.y -= (nh - obj.h) / 2; obj.w = nw; obj.h = nh;
        // Es waechst aus der Mitte heraus – dabei kann es ueber den Rand geraten
        haltAufBlatt(obj, page);
        wrap.style.width = obj.w + 'px'; wrap.style.height = obj.h + 'px'; wrap.style.left = obj.x + 'px'; wrap.style.top = obj.y + 'px';
        // Formel-Inhalt neu rendern, damit die Skalierung greift
        if (obj.kind === 'formula') { body.innerHTML = renderFormulaBody(obj); }
        placeBar();
      }
    }
  }, { passive: false });
  body.addEventListener('touchend', e => {
    if (e.touches.length < 2 && pinchStartDist > 0) { pinchStartDist = 0; if (_pinchHasMutated) noteObjectChanged(); }
  }, { passive: true });

  objLayer.appendChild(wrap);
  // Erst jetzt hängt es im Baum – vorher findet restackObjects es nicht
  restackObjects(objLayer, page);
}

/* ── Entf / Rück löscht das ausgewählte Objekt ──────────────────────
   Wie in jeder anderen Anwendung auch: ein ausgewähltes Ding verschwindet,
   wenn man die Löschtaste drückt. Der Handler darf nicht feuern, wenn der
   Fokus im Text oder in einem Eingabefeld steht – sonst kann man nichts mehr
   schreiben. */
document.addEventListener('keydown', e => {
  if (!_selObj) return;
  const a = document.activeElement;
  if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  e.preventDefault();

  const wrap = _selObj;
  const pgEl = wrap.closest('[data-pgid]');
  if (!pgEl) return;
  const info = typeof getPage === 'function' ? getPage(pgEl.dataset.pgid) : null;
  const page = info && info.page;
  if (!page) return;

  const objId = wrap.dataset.objid;
  if (typeof pushPageHistory === 'function') pushPageHistory(page);
  page.objects = (page.objects || []).filter(o => String(o.id) !== objId);
  deselect();
  wrap.remove();

  const objLayer = pgEl.querySelector('.j-objects');
  if (objLayer && typeof restackObjects === 'function') restackObjects(objLayer, page);

  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  if (typeof noteObjectChanged === 'function') noteObjectChanged();
});
