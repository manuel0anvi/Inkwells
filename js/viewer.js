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
     src/canvas/objects.js  -> buildObjectElement() (placeObject)
     src/canvas/drawing.js  -> redrawStrokes() / drawStroke()
     src/core/data.js       -> getNotebookPages()  (pagesOfSec)
     src/core/state.js      -> CFG / BG_STYLE

   NICHT portiert, sondern dieselben Dateien wie in der App (erzeugt von
   npm run sync-share, geladen vor dieser Datei):
     js/formula.js   renderFormula / renderFormulaBody   Formeln
     js/shapes.js    renderShapeBody                     Formen
     js/code.js      renderCodeBody                      Code-Kästen
     js/pdfSeiten.js PdfSeiten                           Seiten aus einem PDF
     css/pages.css   wie eine Seite aussieht

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

/* Wo die Website liegt – für pdf.js, das erst bei Bedarf geholt wird.
   Aus der Adresse DIESES Skripts und nicht aus der der Seite: s/ und
   dashboard/ liegen zwar gleich tief, aber eine dritte Seite muss daran
   dann nicht denken. */
const VIEWER_BASIS = (document.currentScript && document.currentScript.src)
  ? new URL('..', document.currentScript.src).href
  : new URL('../', window.location.href).href;

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

  /* Umgestelltes Heft: notebook.pages IST die Reihenfolge, und die
     Zugehoerigkeit steht als page.secId an der Seite. Ueber die Abschnitte
     zu gehen waere hier sogar falsch – deren pgIds sind nur noch
     abgeleitet und wuerden die Seiten nach Abschnitten gruppieren.
     Gegenstueck: notebookPages() in src/core/data.js. */
  if (notebook.schemaVersion === 2) return allPages;

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

  /* Kommt der Inhalt als notebook_json, ist er gerade erst geladen und
     gehört niemandem sonst – eine tiefe Kopie wäre bei einem Heft von
     mehreren Megabyte nur Wartezeit. Ein übergebenes Heft dagegen kann
     noch woanders in Gebrauch sein und wird kopiert. */
  const normalized = row && row.notebook_json ? notebook : JSON.parse(JSON.stringify(notebook));
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

  // Seit Abschnitte Etiketten sind, steht die Zugehoerigkeit an der Seite
  if (page.secId) {
    const eigen = sections.find(sec => String(sec.id) === String(page.secId));
    if (eigen?.defaultBg) return eigen.defaultBg;
  }

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

/* ══════════════════════════════════════════════════════════════════════
   EINGEFÜGTE OBJEKTE  ―  Portierung von canvas/objects.js: placeObject()

   Hier stand lange nur das Bild: jedes Objekt ohne obj.src wurde
   übersprungen. Formeln, Formen und Code-Kästen sind in der App aber
   eigene Objekte OHNE src (core/formula.js, canvas/shapes.js,
   core/code.js) – auf der Website fehlten sie deshalb ersatzlos.
   Gemeldet als „mathematische Formeln werden nicht angezeigt".

   Gezeichnet wird mit DENSELBEN Funktionen wie in der App. Fehlt eine
   davon (Skript nicht geladen), bleibt nur diese eine Stelle leer und
   nicht die ganze Seite.

   Aufbau und Staffelung wie dort: die Hülle trägt nur Lage und Größe,
   Zahl und Drehung stehen am Körper. Sonst machte die Hülle einen eigenen
   Stapel auf, und ein Bild „hinter dem Text" läge doch davor.
   ══════════════════════════════════════════════════════════════════════ */
const OBJ_Z = { back: 100, front: 2000 };
const OBJ_Z_SPAN = 700;

function buildObjectElement(obj, index) {
  if (!obj || typeof obj !== 'object') return null;
  // Bilder aus sehr alten Heften tragen noch keine Art, nur ihr src
  const kind = obj.kind || (obj.src ? 'image' : 'datei');

  const wrap = document.createElement('div');
  wrap.className = 'obj-wrap';
  wrap.style.left = (Number(obj.x) || 0) + 'px';
  wrap.style.top = (Number(obj.y) || 0) + 'px';
  wrap.style.width = (Number(obj.w) || 200) + 'px';
  wrap.style.height = (Number(obj.h) || 200) + 'px';

  const body = document.createElement('div');
  body.className = 'obj-body';
  body.dataset.kind = kind;
  /* Nur ansehen: nichts auf der Seite soll Klicks abfangen – bis auf den
     Code-Kasten. Er ist ein Fenster auf den Code, und was nicht
     hineinpasst, wird darin geschoben (css/pages.css). Ohne Zeiger
     liess er sich hier weder nach unten noch zur Seite rollen. */
  body.style.pointerEvents = kind === 'code' ? 'auto' : 'none';
  body.style.zIndex = OBJ_Z[obj.layer === 'back' ? 'back' : 'front'] + Math.min(index, OBJ_Z_SPAN - 1);
  if (obj.rot) body.style.transform = 'rotate(' + (Number(obj.rot) || 0) + 'deg)';

  try {
    if (kind === 'image') {
      if (!obj.src) return null;
      const img = document.createElement('img');
      img.alt = obj.name || '';
      img.draggable = false;
      // Wörtlich wie in der App, damit ein Bild hier nicht anders sitzt
      img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;border-radius:2px';
      // Bilder kommen erst nach dem Layout an; ohne erneutes Messen bliebe
      // der Skalierungs-Wrapper bei seiner vorläufigen Höhe
      img.addEventListener('load', rescaleAllPages);
      img.addEventListener('error', () => {
        console.warn('[Viewer] Bild nicht darstellbar:', obj.id || obj.name || '(ohne Namen)');
      });
      img.src = obj.src;
      body.appendChild(img);
    } else if (kind === 'shape') {
      if (typeof renderShapeBody !== 'function') return null;
      body.innerHTML = renderShapeBody(obj);
    } else if (kind === 'formula') {
      if (typeof renderFormulaBody !== 'function') return null;
      body.innerHTML = renderFormulaBody(obj);
    } else if (kind === 'code') {
      if (typeof renderCodeBody !== 'function') return null;
      body.innerHTML = renderCodeBody(obj);
    } else {
      // Angehängte Datei. Der Name kommt von außen – deshalb als Text und
      // nicht wie in der App ins HTML gesetzt
      const chip = document.createElement('div');
      chip.style.cssText = 'background:#ede8dc;border:1px solid #cfc5b0;border-radius:6px;padding:8px 14px;'
        + 'font-size:13px;color:#4a3d2e;height:100%;display:flex;align-items:center;gap:8px';
      chip.textContent = '📎 ' + (obj.name || 'Datei');
      body.appendChild(chip);
    }
  } catch (err) {
    console.warn('[Viewer] Objekt nicht darstellbar:', obj.id || kind, err);
    return null;
  }

  wrap.appendChild(body);
  return wrap;
}

/* ══════════════════════════════════════════════════════════════════════
   FORMELN IM TEXT  ―  Hefte von vor den Formel-Objekten

   Dort steht die Formel als <span class="j-formula" data-latex="…"> mit
   dem fertigen KaTeX-HTML darin. Heil durch die Bereinigung kommt das
   nicht: von jedem style bleibt dort nur die Farbe, und KaTeX setzt
   Höhen und Versätze genau so – ein Bruch fiele in sich zusammen.

   Der Quelltext steht aber daneben. Aus ihm wird hier neu gesetzt; was
   dann im Span steht, ist KaTeX' eigene Ausgabe aus einer Zeichenkette
   und kein fremdes HTML (ohne trust lässt KaTeX weder \href noch
   \htmlClass zu).
   ══════════════════════════════════════════════════════════════════════ */
function renderTextFormulas(textDiv) {
  if (typeof renderFormula !== 'function') return;
  textDiv.querySelectorAll('.j-formula[data-latex]').forEach(span => {
    const { html } = renderFormula(span.getAttribute('data-latex'), !!span.closest('.j-formula-block'));
    if (html) span.innerHTML = html;
  });
}

/* ══════════════════════════════════════════════════════════════════════
   PDF-SEITEN  ―  core/pdfSeiten.js

   Seit das PDF selbst im Heft liegt, trägt eine solche Seite kein Bild
   mehr, sondern nur page.pdfRef. Eine Freigabe bekommt das Bild vorher
   beigelegt (materialisiere) – ein Heft, das das Dashboard aus Drive oder
   OneDrive holt, aber nicht. Dort blieb die Seite weiß.

   pdf.js ist gut 1,3 MB groß und wird deshalb erst geholt, wenn eine
   solche Seite wirklich vorkommt. Gerechnet wird eine Seite nach der
   anderen: ein Skript mit 300 Seiten auf einmal legte den Tab lahm.
   ══════════════════════════════════════════════════════════════════════ */
let pdfJsBereit = null;
let pdfWarteschlange = Promise.resolve();

function ladePdfJs() {
  if (typeof pdfjsLib !== 'undefined') return Promise.resolve();
  if (!pdfJsBereit) {
    pdfJsBereit = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = VIEWER_BASIS + 'lib/pdf.min.js';
      s.onload = () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = VIEWER_BASIS + 'lib/pdf.worker.min.js';
        resolve();
      };
      s.onerror = () => {
        pdfJsBereit = null;   // beim nächsten Heft noch einmal versuchen
        reject(new Error('pdf.js nicht ladbar'));
      };
      document.head.appendChild(s);
    });
  }
  return pdfJsBereit;
}

function zeichnePdfSeite(notebook, page, imgEl) {
  if (typeof PdfSeiten === 'undefined') return;
  pdfWarteschlange = pdfWarteschlange.then(async () => {
    // Inzwischen ein anderes Heft offen: diese Seite sieht niemand mehr
    if (!imgEl.isConnected) return;
    try {
      await ladePdfJs();
      const url = await PdfSeiten.bild(notebook, page, PdfSeiten.FREIGABE_FEINHEIT);
      if (!url) return;
      /* Am Heft behalten: der Word-Export (js/docx.js) liest page.bgImg,
         und beim Neuzeichnen nach einem Sprachwechsel muss nichts noch
         einmal gerechnet werden. */
      page.bgImg = url;
      imgEl.src = url;
    } catch (err) {
      console.warn('[Viewer] PDF-Seite nicht darstellbar:', page.id, err?.message || err);
    }
  });
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

  // Hintergrundbild: importierte PDF-Seite, als Bild oder als Verweis
  const pdfVerweis = !page.bgImg && page.pdfRef && page.pdfRef.datei;
  if (page.bgImg || pdfVerweis) {
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
    if (page.bgImg) bgImgEl.src = page.bgImg;
    else zeichnePdfSeite(notebook, page, bgImgEl);
    div.style.backgroundImage = 'none';
    div.style.backgroundColor = '#fff';
    div.appendChild(bgImgEl);
  }

  /* ══ HANDSCHRIFT ALS VEKTOR ═══════════════════════════════════════
     >>> Gemeldet: „wenn man hineinzoomt, ist Gezeichnetes gepixelt" <<<
     Hier stand eine Zeichenfläche in der Auflösung des Bildschirms. Wer
     auf dem Handy mit zwei Fingern oder am Rechner mit Strg + hineinzoomt,
     vergrösserte dieses Bild – und sah seine Bildpunkte. Jetzt steht die
     Handschrift als SVG da (js/inkSvg.js, dieselbe Fassung wie im PDF):
     jeder Strich ein Pfad, scharf bei jedem Zoom. Die Zeichenfläche
     bleibt nur der Rückfall, falls das Modul fehlt. */
  const vektor = (typeof InkSvg !== 'undefined' && InkSvg && (page.inkStrokes || []).length)
    ? InkSvg.svg(page.inkStrokes, targetW, targetH, { klasse: 'j-ink-vektor' }) : '';
  if (vektor) div.insertAdjacentHTML('beforeend', vektor);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const canvas = document.createElement('canvas');
  canvas.className = 'j-canvas';
  canvas.width = Math.round(targetW * dpr);
  canvas.height = Math.round(targetH * dpr);
  canvas.style.width = targetW + 'px';
  canvas.style.height = targetH + 'px';
  // Liegt über einem Code-Kasten „hinter dem Text" und nähme ihm sonst
  // das Rollen weg – gezeichnet wird hier ohnehin nicht
  canvas.style.pointerEvents = 'none';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (!vektor) div.appendChild(canvas);

  // Eingefügte Objekte: Bilder, Formen, Formeln, Code-Kästen
  const objLayer = document.createElement('div');
  objLayer.className = 'j-objects';
  (page.objects || []).forEach((obj, i) => {
    const wrap = buildObjectElement(obj, i);
    if (wrap) objLayer.appendChild(wrap);
  });
  div.appendChild(objLayer);

  // Text
  const textDiv = document.createElement('div');
  textDiv.className = 'j-text';
  // --lh wie in der App: Tabellenzeilen und die Kästchen der
  // Ankreuzliste richten sich danach (css/pages.css)
  textDiv.style.cssText =
    `font-size:17px;--lh:${lh}px;line-height:${lh}px;padding-top:${pt}px;`
    + `top:64px;left:72px;right:${rightPad}px;bottom:24px;`
    + 'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  // Fremdes Heft: der Text geht durch die Bereinigung (js/sanitize.js)
  textDiv.innerHTML = sanitizePageHtml(page.textContent);

  // Überschriften wie in der App auf p.j-title-* normalisieren
  textDiv.querySelectorAll('h1,h2,h3').forEach(h => {
    const p = document.createElement('p');
    const level = h.tagName === 'H1' ? 1 : h.tagName === 'H2' ? 2 : 3;
    p.className = 'j-title-' + level;
    p.innerHTML = h.innerHTML;
    h.replaceWith(p);
  });

  renderTextFormulas(textDiv);

  /* Eine frei gesetzte Tabelle trägt ihre Lage als x/y und nicht im
     style – die Bereinigung liesse davon nichts übrig. Übertragen wie in
     core/tables.js (stelleTabellenAus); sonst stünde sie oben links. */
  textDiv.querySelectorAll('table.j-table[x]').forEach(tbl => {
    tbl.style.left = (parseInt(tbl.getAttribute('x'), 10) || 0) + 'px';
    tbl.style.top = (parseInt(tbl.getAttribute('y'), 10) || 0) + 'px';
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

  if (!vektor) redrawStrokes(canvas, page.inkStrokes, dpr);

  return { pageEl: div, width: targetW, height: targetH };
}

// Hüllt die 794px breite Seite in einen Wrapper, der sie auf die
// verfügbare Breite herunterskaliert (nie hoch – 100 % ist das Maximum).
// Ein einziger Resize-Listener bedient alle Seiten, damit sich beim
// wiederholten Öffnen von Notizbüchern keine Listener ansammeln.
const pageScalers = [];

function rescaleOne(eintrag) {
  const { scaler, pageEl, width, height } = eintrag;
  if (!scaler.isConnected) return;
  const available = scaler.parentElement ? scaler.parentElement.clientWidth : width;
  const scale = Math.min(1, available / width);
  // Tatsächliche Höhe verwenden, damit nichts abgeschnitten wird, falls
  // eine Seite mehr Text enthält als ihre Sollhöhe hergibt. Eine noch
  // nicht gezeichnete Seite hält ihren Platz in der Sollhöhe frei.
  const realHeight = pageEl ? Math.max(height, pageEl.offsetHeight || 0) : height;
  if (pageEl) pageEl.style.transform = `scale(${scale})`;
  scaler.style.width = Math.round(width * scale) + 'px';
  scaler.style.height = Math.round(realHeight * scale) + 'px';
}

function rescaleAllPages() {
  for (const eintrag of pageScalers) rescaleOne(eintrag);
}

window.addEventListener('resize', rescaleAllPages);

/* Die Navigation steht fest oben und ist je nach Breite verschieden hoch
   (css/style.css). Die Leiste eines offenen Hefts klebt direkt darunter
   (css/notebook.css, --nav-hoehe) – gemessen statt geraten, sonst läge
   sie auf dem Handy halb unter der Navigation oder hinge darunter. */
(function navHoeheMerken() {
  const nav = document.querySelector('nav');
  if (!nav) return;
  const setze = () => document.documentElement.style.setProperty('--nav-hoehe', nav.offsetHeight + 'px');
  setze();
  if (typeof ResizeObserver === 'function') new ResizeObserver(setze).observe(nav);
  else window.addEventListener('resize', setze);
})();

/* ══════════════════════════════════════════════════════════════════════
   GEZEICHNET WIRD, WAS MAN GLEICH SIEHT

   >>> Gemeldet: „das Laden dauert lange – die ersten Seiten sollten
   sofort da sein, der Rest beim Scrollen" <<<
   Beim Öffnen wurde jede Seite auf einmal gebaut: Text, Formeln, Bilder
   und die ganze Handschrift auf einer Zeichenfläche je Seite. Bei einem
   Heft mit 17 vollgeschriebenen Seiten stand die Ansicht dafür eine
   ganze Weile still, bevor irgendetwas zu sehen war.

   Jetzt bekommt jede Seite sofort ihren Platz in der richtigen Grösse –
   die Bildlaufleiste stimmt, die Seitenzahl auch –, gebaut werden aber
   nur die ersten Seiten gleich und alle weiteren, sobald sie in die Nähe
   des Sichtfelds kommen. Wer druckt, bekommt vorher alle gewählten Seiten
   gebaut (renderPagesNow, js/export-ui.js).
   ══════════════════════════════════════════════════════════════════════ */
const SOFORT_SEITEN = 3;
let seitenBeobachter = null;

function baueEintrag(eintrag) {
  if (eintrag.pageEl || !eintrag.build) return;
  try {
    const { pageEl } = eintrag.build();
    eintrag.pageEl = pageEl;
    eintrag.scaler.appendChild(pageEl);
  } catch (error) {
    console.error('Viewer render error:', error);
  }
  eintrag.build = null;
  if (seitenBeobachter) seitenBeobachter.unobserve(eintrag.scaler);
  rescaleOne(eintrag);
}

/**
 * Seiten in den Behälter legen – gebaut werden zuerst nur die ersten.
 * @param {object} notebook
 * @param {Array} pages   in Heftreihenfolge
 * @param {HTMLElement} container
 */
function renderPagesLazy(notebook, pages, container) {
  if (seitenBeobachter) seitenBeobachter.disconnect();
  seitenBeobachter = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((treffer) => {
        for (const t of treffer) {
          if (!t.isIntersecting) continue;
          const eintrag = pageScalers.find(e => e.scaler === t.target);
          if (eintrag) baueEintrag(eintrag);
        }
      }, { rootMargin: '1500px 0px' })
    : null;

  pages.forEach((page, index) => seiteAnhaengen(notebook, page, index, container));
  requestAnimationFrame(rescaleAllPages);
}

/**
 * Eine Seite ans Ende legen – auch während das Heft noch lädt
 * (dashboard.js, ladeHeft). Eine Seite aus einem PDF wartet dann, bis das
 * Heft ganz da ist: das PDF selbst steht in der Datei HINTER den Seiten.
 */
function seiteAnhaengen(notebook, page, index, container) {
  const width = page.w || CFG.PAGE_W;
  const height = page.h || CFG.PAGE_H;
  const scaler = document.createElement('div');
  scaler.className = 'j-page-scaler';
  scaler.style.width = '100%';
  // Damit eine Suche die Stelle findet, auch bevor die Seite gebaut ist
  scaler.dataset.pgid = page.id;
  const eintrag = { scaler, pageEl: null, width, height, page, notebook, wartet: false };
  eintrag.build = () => buildPageElement(eintrag.notebook, eintrag.page, index);
  pageScalers.push(eintrag);
  container.appendChild(scaler);
  if (page.pdfRef && !page.bgImg && !notebook.pdfs) { eintrag.wartet = true; rescaleOne(eintrag); return; }
  if (index < SOFORT_SEITEN || !seitenBeobachter) baueEintrag(eintrag);
  else seitenBeobachter.observe(scaler);
  rescaleOne(eintrag);
}

/**
 * Das vollständige Heft ist da: stimmen die Seiten mit den schon
 * angehängten überein, bleiben diese stehen und bekommen nur das
 * vollständige Heft untergeschoben. Sonst false – dann baut der Aufrufer neu.
 */
function seitenUebernehmen(notebook, pages) {
  if (pages.length !== pageScalers.length) return false;
  if (pages.some((p, k) => String(p.id) !== String(pageScalers[k].page.id))) return false;
  pageScalers.forEach((eintrag, k) => {
    eintrag.notebook = notebook;
    eintrag.page = pages[k];
    if (!eintrag.wartet) return;
    eintrag.wartet = false;
    if (seitenBeobachter) seitenBeobachter.observe(eintrag.scaler); else baueEintrag(eintrag);
  });
  return true;
}

/** Die gewählten (sonst alle) Seiten jetzt bauen – vor dem Drucken. */
function renderPagesNow(auswahl) {
  pageScalers.forEach((eintrag, index) => {
    if (!auswahl || auswahl.has(index + 1)) baueEintrag(eintrag);
  });
}

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
