/* ══════════════════════════════════════════════════════════════════════
   NOTIZBUCH-DARSTELLUNG  ―  gemeinsam genutzt

   Enthält alles, was eine Heftseite zeichnet, und sonst nichts: keine
   Anmeldung, kein Cloud-Zugriff, keine Suche. Dadurch können zwei sehr
   verschiedene Seiten dieselbe Darstellung verwenden:

     dashboard/  – die eigenen Hefte, nur nach Anmeldung
     s/          – ein freigegebenes Heft, ohne Anmeldung lesbar

   Vorher lag das alles in dashboard/dashboard.js. Für die Freigabe-Seite
   hätte es kopiert werden müssen – und kopierte Darstellung läuft
   auseinander (genau daher kam der Fehler mit den PDF-Seiten, die auf der
   Website an der falschen Stelle standen).

   Portiert aus:
     src/app.js             -> buildPageElement()  (appendPageDOM)
     src/canvas/drawing.js  -> redrawStrokes() / drawStroke()
     src/core/data.js       -> getNotebookPages()  (pagesOfSec)
     src/core/state.js      -> CFG / BG_STYLE

   Braucht aus i18n.js: t() und die Variable lang.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Konstanten identisch zur App (src/core/state.js) ─────────────── */

const CFG = { PAGE_W: 794, PAGE_H: 1123 };

const BG_STYLE = {
  ruled: 'background:#faf7f0;background-image:repeating-linear-gradient(to bottom,transparent,transparent 7px,#d4cdc0 7px,#d4cdc0 8px)',
  grid: 'background:#faf7f0;background-image:repeating-linear-gradient(to bottom,transparent,transparent 7px,#d4cdc0 7px,#d4cdc0 8px),repeating-linear-gradient(to right,transparent,transparent 7px,#d4cdc0 7px,#d4cdc0 8px)',
  dots: 'background:#faf7f0;background-image:radial-gradient(circle,#b0a898 1px,transparent 1px);background-size:8px 8px;background-position:4px 4px',
  blank: 'background:#fff',
  craft: 'background:#f0e8d5'
};

// src/canvas/text.js
const lhForBg = (bg) => (bg === 'grid' || bg === 'dots') ? 24 : 32;
const ptForBg = (bg) => Math.round(lhForBg(bg) - 17 * 0.78);
const rightPadForBg = (bg) => (bg === 'grid' || bg === 'dots' || bg === 'blank' || bg === 'craft') ? 72 : 32;

/* ── Datum wie in der App (src/core/state.js: fmt) ────────────────── */

// Gibt ein gültiges Date zurück oder null. Notizbücher aus älteren
// App-Versionen haben teils gar kein oder ein unlesbares Datum – ohne
// diese Prüfung stand dann "Invalid Date" auf der Seite.
function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtPageDate(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDate(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return d.toLocaleDateString(
    lang === 'de' ? 'de-AT' : lang === 'it' ? 'it-IT' : 'en-GB',
    { year: 'numeric', month: 'short', day: 'numeric' }
  );
}

/* ── Notizbuch-Struktur normalisieren ─────────────────────────────── */

/**
 * Alle Seiten eines Hefts in der Reihenfolge, in der sie auch in der App
 * stehen.
 *
 * Wichtig: die Reihenfolge steckt in den Abschnitten (`section.pgIds`),
 * NICHT in `notebook.pages`. Die App hängt neue Seiten hinten an das
 * pages-Array an und trägt sie nur in pgIds an der richtigen Stelle ein
 * (siehe src/core/data.js: pagesOfSec). Wer `notebook.pages` einfach der
 * Reihe nach durchgeht – so war es hier vorher –, zeigt eingefügte PDF-
 * oder Bildseiten deshalb am Ende des Hefts statt an ihrem Platz.
 *
 * Seiten, die in keinem Abschnitt vorkommen, werden hinten angehängt,
 * damit durch einen kaputten Abschnitt nichts unsichtbar wird.
 */
function getNotebookPages(notebook) {
  if (!notebook || typeof notebook !== 'object') return [];

  const allPages = Array.isArray(notebook.pages) ? notebook.pages.filter(Boolean) : [];
  const sections = Array.isArray(notebook.sections) ? notebook.sections : [];

  const pagesById = new Map();
  for (const page of allPages) {
    if (page && page.id) pagesById.set(page.id, page);
  }

  const ordered = [];
  const seen = new Set();

  for (const section of sections) {
    // Ältere Hefte legen die Seiten direkt im Abschnitt ab
    if (Array.isArray(section?.pages)) {
      for (const page of section.pages) {
        if (!page || !page.id || seen.has(page.id)) continue;
        seen.add(page.id);
        ordered.push(page);
      }
      continue;
    }

    if (Array.isArray(section?.pgIds)) {
      for (const pageId of section.pgIds) {
        const page = pagesById.get(pageId);
        if (!page || seen.has(page.id)) continue;
        seen.add(page.id);
        ordered.push(page);
      }
    }
  }

  // Nicht zugeordnete Seiten nicht verlieren
  for (const page of allPages) {
    if (page.id && seen.has(page.id)) continue;
    if (page.id) seen.add(page.id);
    ordered.push(page);
  }

  return ordered;
}

function normalizeNotebookRecord(row) {
  const raw = row?.notebook_json
    ? (typeof row.notebook_json === 'string' ? JSON.parse(row.notebook_json) : row.notebook_json)
    : row;
  const notebook = Array.isArray(raw?.notebooks)
    ? raw.notebooks[0]
    : Array.isArray(raw) ? raw[0] : raw;

  if (!notebook || typeof notebook !== 'object') return null;

  const normalized = JSON.parse(JSON.stringify(notebook));
  normalized.name = normalized.name || normalized.title || normalized.notebookName || row?.title || 'Untitled';
  normalized.color = normalized.color || '#c8a96e';
  normalized.defaultBg = normalized.defaultBg || 'ruled';

  // Erstes brauchbares Datum gewinnt; Drives modifiedTime ist der
  // verlässlichste Rückfall, wenn die Datei selbst keines enthält.
  const updated = parseDate(normalized.updatedAt)
    || parseDate(normalized.updated_at)
    || parseDate(row?.updated_at)
    || parseDate(row?.modifiedTime);
  normalized.updatedAt = updated ? updated.toISOString() : '';

  normalized.pages = getNotebookPages(normalized);
  return normalized;
}

// Hintergrund einer Seite bestimmen: eigene Einstellung der Seite hat
// Vorrang, danach der Abschnitt, in dem die Seite liegt, zuletzt der
// Notizbuch-Standard. So sieht die Vorschau genau das Papier, das beim
// Anlegen gewählt wurde (liniert / kariert / gepunktet / weiß / craft).
function resolvePageBg(notebook, page) {
  if (page.bg) return page.bg;

  const sections = Array.isArray(notebook.sections) ? notebook.sections : [];
  for (const section of sections) {
    const belongs = (Array.isArray(section.pgIds) && section.pgIds.includes(page.id))
      || (Array.isArray(section.pages) && section.pages.some(p => p && p.id === page.id));
    if (belongs && section.defaultBg) return section.defaultBg;
  }

  const activeSec = sections.find(s => s.id === notebook.activeSecId);
  return activeSec?.defaultBg || notebook.defaultBg || 'ruled';
}

/* Portierung von src/canvas/drawing.js */
function traceStrokePath(ctx, s) {
  const pts = s.path;
  if (!pts || !pts.length) return;

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (s.isGeometric) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  ctx.stroke();
}

function applyStrokeStyles(ctx, s) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

// Alte Notizbücher speichern Punkte unter "points" und Breite unter "size".
function normalizeStroke(stroke) {
  return {
    ...stroke,
    path: Array.isArray(stroke.path) ? stroke.path : (Array.isArray(stroke.points) ? stroke.points : []),
    width: stroke.width || stroke.size || 2,
    color: stroke.color || '#1a1510',
    isHL: stroke.isHL || stroke.isHighlighter || false
  };
}

function redrawStrokes(canvas, rawStrokes, dpr) {
  const strokes = (rawStrokes || []).map(normalizeStroke);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  let i = 0;
  while (i < strokes.length) {
    const s = strokes[i];

    if (s.isHL) {
      // Marker werden als Gruppe auf ein Off-Screen-Canvas gezeichnet und
      // gemeinsam transparent eingeblendet – sonst überlagern sie sich.
      const hlChunk = [];
      while (i < strokes.length && strokes[i].isHL) { hlChunk.push(strokes[i]); i++; }

      const off = document.createElement('canvas');
      off.width = w * dpr;
      off.height = h * dpr;
      const oc = off.getContext('2d');
      oc.scale(dpr, dpr);
      hlChunk.forEach(hs => {
        applyStrokeStyles(oc, hs);
        oc.globalAlpha = 1;
        traceStrokePath(oc, hs);
      });

      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.drawImage(off, 0, 0, w, h);
      ctx.restore();
    } else if (s.isEraser) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      applyStrokeStyles(ctx, { ...s, color: 'rgba(0,0,0,1)' });
      traceStrokePath(ctx, s);
      ctx.restore();
      i++;
    } else {
      ctx.save();
      applyStrokeStyles(ctx, s);
      ctx.globalAlpha = s.alpha || 1;
      traceStrokePath(ctx, s);
      ctx.restore();
      i++;
    }
  }
}

/* Portierung von src/app.js: appendPageDOM() – nur Darstellung,
   ohne Eingabe-, Undo- und Auto-Paging-Logik. */
function buildPageElement(notebook, page, index) {
  const bgId = resolvePageBg(notebook, page);

  const lh = lhForBg(bgId);
  const pt = ptForBg(bgId);
  const rightPad = rightPadForBg(bgId);

  const targetW = page.w || CFG.PAGE_W;
  const targetH = page.h || CFG.PAGE_H;

  const div = document.createElement('div');
  div.className = 'j-page bg-' + bgId;
  div.dataset.pgid = page.id;
  div.style.width = targetW + 'px';
  div.style.minHeight = targetH + 'px';

  // Kopfzeile
  const hdr = document.createElement('div');
  hdr.className = 'j-page-hdr';
  const pageWord = t('page') || 'Seite';
  const num = document.createElement('span');
  num.className = 'j-page-num';
  num.textContent = `${pageWord} ${index + 1}`;
  const date = document.createElement('span');
  date.className = 'j-page-date';
  date.textContent = fmtPageDate(page.date);
  hdr.append(num, date);
  div.appendChild(hdr);

  // Hintergrundbild (z. B. importierte PDF-Seite)
  if (page.bgImg) {
    const bgImgEl = document.createElement('img');
    bgImgEl.className = 'j-page-bgimg';
    bgImgEl.alt = '';
    // Bilder kommen erst nach dem Layout an. Ohne dieses erneute Messen
    // behält der Skalierungs-Wrapper seine vorläufige Höhe – und weil er
    // overflow:hidden hat, wäre das Bild dann angeschnitten oder gar nicht
    // zu sehen.
    bgImgEl.addEventListener('load', rescaleAllPages);
    bgImgEl.addEventListener('error', () => {
      console.warn('[Viewer] Seiten-Hintergrundbild nicht darstellbar:', page.id);
    });
    bgImgEl.src = page.bgImg;
    div.style.backgroundImage = 'none';
    div.style.backgroundColor = '#fff';
    div.appendChild(bgImgEl);
  }

  // Handschrift
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const canvas = document.createElement('canvas');
  canvas.className = 'j-canvas';
  canvas.width = Math.round(targetW * dpr);
  canvas.height = Math.round(targetH * dpr);
  canvas.style.width = targetW + 'px';
  canvas.style.height = targetH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  div.appendChild(canvas);

  // Eingefügte Bilder / Objekte
  const objLayer = document.createElement('div');
  objLayer.className = 'j-objects';
  for (const obj of (page.objects || [])) {
    if (!obj || !obj.src) continue;
    const wrap = document.createElement('div');
    wrap.className = 'obj-wrap';
    wrap.style.left = (obj.x || 0) + 'px';
    wrap.style.top = (obj.y || 0) + 'px';
    wrap.style.width = (obj.w || 200) + 'px';
    wrap.style.height = (obj.h || 200) + 'px';
    if (obj.rot) wrap.style.transform = `rotate(${obj.rot}deg)`;
    const img = document.createElement('img');
    img.alt = obj.name || '';
    img.draggable = false;
    img.addEventListener('load', rescaleAllPages);
    img.addEventListener('error', () => {
      console.warn('[Viewer] Bild nicht darstellbar:', obj.id || obj.name || '(ohne Namen)');
    });
    img.src = obj.src;
    wrap.appendChild(img);
    objLayer.appendChild(wrap);
  }
  div.appendChild(objLayer);

  // Text
  const textDiv = document.createElement('div');
  textDiv.className = 'j-text';
  textDiv.style.cssText =
    `font-size:17px;line-height:${lh}px;padding-top:${pt}px;`
    + `top:64px;left:72px;right:${rightPad}px;bottom:24px;`
    + 'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  textDiv.innerHTML = page.textContent || '';

  // Überschriften wie in der App auf p.j-title-* normalisieren
  textDiv.querySelectorAll('h1,h2,h3').forEach(h => {
    const p = document.createElement('p');
    const level = h.tagName === 'H1' ? 1 : h.tagName === 'H2' ? 2 : 3;
    p.className = 'j-title-' + level;
    p.innerHTML = h.innerHTML;
    h.replaceWith(p);
  });

  // Überschriftengrößen hängen an der Zeilenhöhe des Hintergrunds
  const st = document.createElement('style');
  const sel = `[data-pgid="${page.id}"] .j-text`;
  st.textContent =
    `${sel} p.j-title-1{font-size:${Math.round(lh * .75)}px}`
    + `${sel} p.j-title-2{font-size:${Math.round(lh * .65)}px}`
    + `${sel} p.j-title-3{font-size:${Math.round(lh * .58)}px}`;
  div.appendChild(st);
  div.appendChild(textDiv);

  redrawStrokes(canvas, page.inkStrokes, dpr);

  return { pageEl: div, width: targetW, height: targetH };
}

// Hüllt die 794px breite Seite in einen Wrapper, der sie auf die
// verfügbare Breite herunterskaliert (nie hoch – 100 % ist das Maximum).
// Ein einziger Resize-Listener bedient alle Seiten, damit sich beim
// wiederholten Öffnen von Notizbüchern keine Listener ansammeln.
const pageScalers = [];

function rescaleAllPages() {
  for (const { scaler, pageEl, width, height } of pageScalers) {
    if (!scaler.isConnected) continue;
    const available = scaler.parentElement ? scaler.parentElement.clientWidth : width;
    const scale = Math.min(1, available / width);
    // Tatsächliche Höhe verwenden, damit nichts abgeschnitten wird, falls
    // eine Seite mehr Text enthält als ihre Sollhöhe hergibt
    const realHeight = Math.max(height, pageEl.offsetHeight || 0);
    pageEl.style.transform = `scale(${scale})`;
    scaler.style.width = Math.round(width * scale) + 'px';
    scaler.style.height = Math.round(realHeight * scale) + 'px';
  }
}

window.addEventListener('resize', rescaleAllPages);

function wrapScaled(pageEl, width, height) {
  const scaler = document.createElement('div');
  scaler.className = 'j-page-scaler';
  // Startbreite, damit die 794px breite Seite vor dem ersten Messen
  // nicht kurz horizontal aus dem Layout ragt
  scaler.style.width = '100%';
  scaler.appendChild(pageEl);

  pageScalers.push({ scaler, pageEl, width, height });
  return scaler;
}
