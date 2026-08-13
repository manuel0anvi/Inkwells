'use strict';

/* ── PDF TO IMAGES Helper ── */
async function parsePdfToImages(pdfDataUrl) {
  const base64 = pdfDataUrl.split(',')[1];
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const images = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    images.push({
      url: canvas.toDataURL('image/jpeg', 0.65),
      w: Math.round(viewport.width / 1.5), // native width (at scale 1.0)
      h: Math.round(viewport.height / 1.5) // native height
    });
  }
  return images;
}

/**
 * Baut aus einem Seitenbild eine Heftseite.
 *
 * Die Rechnung stand zweimal fast gleich da – einmal fuers PDF, einmal
 * fuers Bild. Sie ist nicht offensichtlich: die Breite wird auf das
 * Heftmass gezogen, die Hoehe folgt dem Seitenverhaeltnis, und der Platz
 * des Seitenkopfs kommt obendrauf. Ohne ihn saesse das Bild unter dem
 * Kopf und waere unten abgeschnitten.
 *
 * >>> Warum 56 und nicht CFG.HDR (58) <<<
 * Weil das Bild selbst bei 56 px anfaengt und `calc(100% - 56px)` hoch
 * ist (app.js, beim Aufbau der Seite). CFG.HDR zaehlt die 2 px Trennlinie
 * mit – die richtige Zahl dort, wo es um den freizuhaltenden Kopfbereich
 * geht, hier aber 2 px Luft unter dem Bild. Die beiden Zahlen meinen
 * verschiedene Dinge und duerfen nicht zusammengelegt werden.
 *
 * Papier: immer 'blank'. Ein Linienraster hinter einem fertigen
 * Seitenbild ergibt kein Bild, sondern ein Durcheinander.
 */
const BILD_KOPF_PX = 56;

function makeImagePage(dataUrl, breite, hoehe) {
  const pg = makePage('blank');
  pg.bgImg = dataUrl;
  pg.w = CFG.PAGE_W;
  pg.h = Math.round(CFG.PAGE_W * (hoehe / (breite || 1))) + BILD_KOPF_PX;
  return pg;
}
window.makeImagePage = makeImagePage;

/* ══════════════════════════════════════════════════════════════════════
   EIN PDF ALS NEUES HEFT

   Derselbe Weg wie beim Einfuegen – parsePdfToImages malt jede Seite in
   ein Bild –, nur landen die Seiten in einem frischen Heft statt in
   einem offenen. Aufgerufen aus ui/homeGrid.js, wenn in der Uebersicht
   „Dokument oeffnen" gewaehlt wurde.

   @param {object} nb        das frische Heft; seine Seiten werden ersetzt
   @param {string} dataUrl   die PDF-Datei
   @returns {Promise<{seiten:number}>}
   ══════════════════════════════════════════════════════════════════════ */
async function fillNotebookFromPdf(nb, dataUrl) {
  const bilder = await parsePdfToImages(dataUrl);
  if (!bilder.length) throw new Error(t('pdfNoPages') || 'Das PDF hat keine Seiten.');

  /* Die leere Startseite faellt weg – sie stuende sonst vor der ersten
     Seite des Dokuments, und niemand hat sie bestellt. */
  nb.pages = bilder.map(b => makeImagePage(b.url, b.w, b.h));
  nb.sections = [];
  return { seiten: nb.pages.length };
}
window.fillNotebookFromPdf = fillNotebookFromPdf;

/* ══════════════════════════════════════════════════════════════════════
   EIN WORD-DOKUMENT ALS NEUES HEFT

   Drei Schritte, jeder in seiner eigenen Datei:
     1. core/docxImport.js   liest die .docx und macht Bloecke daraus
     2. core/docxPaginate.js misst und verteilt sie auf Seiten
     3. hier                 baut daraus Heftseiten samt Bild-Objekten

   Getrennt, weil nur der mittlere Schritt ein Fenster zum Messen
   braucht und nur der letzte das Datenmodell kennt.
   ══════════════════════════════════════════════════════════════════════ */

/** data:-Adresse → Bytes. */
function dataUrlZuBytes(dataUrl) {
  const roh = atob(String(dataUrl).split(',')[1] || '');
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return bytes;
}

async function fillNotebookFromDocx(nb, dataUrl, onFortschritt) {
  if (typeof InkwellDocxImport === 'undefined' || typeof InkwellDocxPaginate === 'undefined') {
    throw new Error('NO_DOCX_MODULE');
  }

  const bg = nb.defaultBg || 'ruled';
  const zeilenhoehe = InkwellDocxPaginate.zeilenhoeheFuer(bg);
  const nutz = InkwellDocxPaginate.nutzhoehe(CFG.PAGE_H);

  /* Die Kennungen aus dem Auspacker in etwas uebersetzen, das man lesen
     kann. Sie kamen bisher roh bis in die Meldung durch – „ZIP_BROKEN"
     sagt niemandem etwas, und bei ZIP_TOO_BIG (der Grenze gegen eine
     aufgeblasene Datei, siehe core/docxImport.js) waere es sogar
     irrefuehrend: die Datei ist ja klein, nur ihr Inhalt nicht. */
  let gelesen;
  try {
    gelesen = await InkwellDocxImport.lese(dataUrlZuBytes(dataUrl), {
      zeilenhoehe,
      maxBildHoehe: nutz
    });
  } catch (err) {
    const kennung = String(err && err.message || '');
    if (kennung === 'ZIP_TOO_BIG') throw new Error(t('docxTooBig') || 'Das Dokument ist zu groß zum Öffnen.');
    if (kennung === 'ZIP_BROKEN' || kennung === 'NO_ZIP' || kennung === 'BAD_XML') {
      throw new Error(t('docxBroken') || 'Die Datei ist beschädigt und lässt sich nicht lesen.');
    }
    throw err;
  }
  const { bloecke, bericht } = gelesen;

  if (!bloecke.length) throw new Error(t('docxEmpty') || 'Das Dokument ist leer.');

  const seiten = InkwellDocxPaginate.verteile(bloecke, {
    breite: CFG.PAGE_W,
    hoehe: CFG.PAGE_H,
    bg,
    onFortschritt
  });

  nb.pages = seiten.map(s => {
    const pg = makePage(bg);
    /* Durch den Sanitizer, obwohl der Text aus dem eigenen Umwandler
       kommt: er ist aus einer FREMDEN Datei gebaut, und deren Inhalt
       hat niemand geprueft. Derselbe Riegel wie bei geteilten Heften. */
    pg.textContent = typeof sanitizePageHtml === 'function'
      ? sanitizePageHtml(s.html) : s.html;
    pg.objects = (s.bilder || []).map(b => ({
      id: uid(), kind: 'image', src: b.src, name: '',
      x: b.x, y: b.y, w: b.w, h: b.h, rot: 0
    }));
    return pg;
  });
  nb.sections = [];

  return {
    seiten: nb.pages.length,
    bilder: bericht.bilder,
    tabellen: bericht.tabellen,
    verloren: bericht.verloren
  };
}
window.fillNotebookFromDocx = fillNotebookFromDocx;

/* ── INSERT ── */
/* Aufgerufen aus dem Einfügen-Menü (ui/insert.js). Hier hing bis dahin
   der Knopf selbst; seit es dort auch Tabellen gibt, ist der Knopf ein
   Menü und dies einer seiner Einträge. */
async function insertFilesFlow() {
  if (!window.api) { toast(t('electronOnly'), true); return; }
  /* Ohne Schreibrecht gar nicht erst anfangen. Sonst entstünden Seiten nur
     örtlich – und gingen gesammelt hinaus, sobald das Recht zurückkommt
     (setCanWrite ruft syncStructure). Gleicher Riegel wie in ui/sidebar.js. */
  if (S.readOnly) { toast(t('sharedNoRight'), true); return; }
  const files = await window.api.pickFiles();
  if (!files || !files.length) return;

  const insertType = await showInsertChoice();
  if (!insertType) return;

  toast(t('processingFiles'));
  const nb = getNb();
  /* Der gezeigte Ausschnitt – darf leer sein. Steht die Ansicht auf
     "alle Seiten", bekommen neue Seiten kein Etikett; frueher brach der
     Einfuegevorgang hier ab, weil immer ein Abschnitt offen sein musste. */
  const sec = activeSection(nb);
  const info = getPage(S.activePgId);
  if (!info) return;

  let addedPages = false;
  let firstNewPageId = null;
  let addedObjects = 0;

  for (const f of files) {
    if (f.kind === 'pdf') {
      try {
        const pdfImageUrls = await parsePdfToImages(f.dataUrl);

        if (insertType === 'page') {
          // Die Stelle zaehlt im HEFT, nicht im Abschnitt
          const insertIdx = pageNumberOf(nb, info.page.id);

          pdfImageUrls.forEach((imgObj, i) => {
            const newPg = makeImagePage(imgObj.url, imgObj.w, imgObj.h);
            insertPageInto(nb, sec, newPg, insertIdx + i);
            if (!firstNewPageId) firstNewPageId = newPg.id;
          });
          addedPages = true;
          if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
        } else {
          const pages = pagesOfSec(sec, nb);
          let curIdx = pages.indexOf(info.page);
          const MAX_PER_PAGE = 5;
          for (let start = 0; start < pdfImageUrls.length; start += MAX_PER_PAGE) {
            const chunk = pdfImageUrls.slice(start, start + MAX_PER_PAGE);
            let targetPgInfo;
            if (start === 0) {
              targetPgInfo = info;
            } else {
              curIdx++;
              if (curIdx < pages.length) {
                targetPgInfo = getPage(pages[curIdx].id);
              } else {
                const newPg = makePage(sec.defaultBg || nb.defaultBg || 'ruled');
                insertPageInto(nb, sec, newPg, pageNumberOf(nb, pages[curIdx - 1]?.id));
                targetPgInfo = { page: newPg };
                addedPages = true;
                if (!firstNewPageId) firstNewPageId = newPg.id;
                pages.splice(curIdx, 0, newPg);
              }
            }

            const objLayer = E('pg-scroll').querySelector(`[data-pgid="${targetPgInfo.page.id}"]`)?.querySelector('.j-objects');
            let currY = 80;
            let pageHLimit = (targetPgInfo.page.h || CFG.PAGE_H);
            let ohLimit = (pageHLimit - 120) / chunk.length - 20;

            pushPageHistory(targetPgInfo.page);
            chunk.forEach((imgObj, idx) => {
              let oh = Math.min(ohLimit, 400);
              let ow = oh * (imgObj.w / imgObj.h);
              if (ow > 600) { ow = 600; oh = ow * (imgObj.h / imgObj.w); }

              const obj = { id: uid(), kind: 'image', src: imgObj.url, name: f.name, x: 80, y: currY, w: ow, h: oh, rot: 0 };
              if (!targetPgInfo.page.objects) targetPgInfo.page.objects = [];
              targetPgInfo.page.objects.push(obj);
              if (objLayer) placeObject(objLayer, obj, targetPgInfo.page);
              addedObjects++;
              currY += oh + 20;
            });
          }
        }
      } catch (err) {
        console.error('PDF Parse error:', err);
        toast(t('pdfError'), true);
      }
    } else if (f.kind === 'image') {
      if (insertType === 'page') {
        const tmpImg = new Image();
        tmpImg.src = f.dataUrl;
        await new Promise(r => tmpImg.onload = r);
        const newPg = makeImagePage(f.dataUrl, tmpImg.naturalWidth, tmpImg.naturalHeight);
        insertPageInto(nb, sec, newPg, pageNumberOf(nb, info.page.id));
        if (!firstNewPageId) firstNewPageId = newPg.id;
        addedPages = true;
        if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
      } else {
        // Die Objekt-Ebene fehlt, wenn die Zielseite gerade nicht gezeichnet
        // ist. Das Bild trotzdem ins Datenmodell legen – vorher wurde es in
        // dem Fall stillschweigend ganz verworfen.
        const objLayer = E('pg-scroll').querySelector('[data-pgid="' + info.page.id + '"]')?.querySelector('.j-objects');
        pushPageHistory(info.page);
        const tmpImg = new Image();
        tmpImg.src = f.dataUrl;
        await new Promise(r => tmpImg.onload = r);
        let ow = 200;
        let oh = ow * (tmpImg.naturalHeight / (tmpImg.naturalWidth || 1));
        const obj = { id: uid(), kind: 'image', src: f.dataUrl, name: f.name, x: 80, y: 80, w: ow, h: oh, rot: 0 };
        if (!info.page.objects) info.page.objects = [];
        info.page.objects.push(obj);
        if (objLayer) placeObject(objLayer, obj, info.page);
        addedObjects++;
      }
    }
  }

  // Ein einziger Ort für „es hat sich etwas geändert“.
  // Vorher hing das an mehreren Stellen im Ablauf und wurde ausgerechnet
  // beim häufigsten Fall vergessen: ein PDF als Objekte einfügen, das noch
  // auf die vorhandenen Seiten passt. Dann war addedPages false, das Heft
  // galt als unverändert – und die Bilder wurden weder gespeichert noch in
  // die Cloud geladen. In der App sah man sie (sie hingen im DOM), auf der
  // Website tauchten sie nie auf und nach einem Neustart waren sie weg.
  if ((addedPages || addedObjects > 0) && window.markCurrentNotebookDirty) {
    window.markCurrentNotebookDirty();
  }

  if (addedPages) {
    renderSideTree();
    openSection(sec, firstNewPageId);
    toast(t('insertedAsPages'));
  } else if (addedObjects > 0) {
    updateUndoRedoUI();
    S.mode = 'cursor';
    applyMode();
    QA('.tb-mode').forEach(b => b.classList.toggle('active', b.dataset.mode === 'cursor'));
    E('pen-opts').style.display = 'none';
    E('eraser-opts').style.display = 'none';
    E('text-opts').style.display = 'flex';
    toast(addedObjects + ' ' + t('objectsInserted'));
  }
}
window.insertFilesFlow = insertFilesFlow;

/* ── SAVE / LOAD / PDF ── */
function syncAll() { QA('.j-page').forEach(pgEl => { const info = getPage(pgEl.dataset.pgid); if (!info) return; const txt = pgEl.querySelector('.j-text'); if (txt) info.page.textContent = txt.innerHTML; info.page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[info.page.id] || [])); }); }
async function doLoad() { 
  if (!window.api) { toast(t('electronOnly'), true); return; } 
  const data = await window.api.load(); 
  if (!data) { toast(t('cancelled'), true); return; } 
  
  // Treat either an explicit "loadedSingle" flag OR a file that contains
  // exactly one notebook in the `notebooks` array as a single-notebook load.
  if ((data.loadedSingle && data.notebooks && data.notebooks.length === 1) || (data.notebooks && data.notebooks.length === 1 && !data.loadedSingle)) {
    // Single notebook loaded - add to existing notebooks if not already present
    const loadedNb = data.notebooks[0];
    const existing = S.notebooks.find(nb => nb.id === loadedNb.id);
    if (existing) {
      // Replace existing notebook with loaded one
      const idx = S.notebooks.indexOf(existing);
      S.notebooks[idx] = loadedNb;
      toast(t('notebookUpdated'));
    } else {
      // Check if name already exists
      const nameExists = S.notebooks.find(nb => nb.name === loadedNb.name);
      if (nameExists) {
        toast(t('nameExists'), true);
        return;
      }
      S.notebooks.push(loadedNb);
      toast(t('notebookLoaded'));
    }

    // Persist the loaded notebook in the overview registry so it comes back after restart
    if (data.sourcePath) {
      await Registry.add(loadedNb, data.sourcePath);
    }
  } else {
    // Old format - replace all
    S.notebooks = data.notebooks || []; 
  }
  S.activeNbId = null; 
  showHome(); 
}
// Der Knopf in der Übersicht ist weg; der im Heft bleibt.
if (E('btn-load')) E('btn-load').addEventListener('click', doLoad);
if (E('btn-load-home')) E('btn-load-home').addEventListener('click', doLoad);
/* ══════════════════════════════════════════════════════════════════
   PDF-EXPORT
   Die Seiten werden genauso aufgebaut wie in der App: Papierhintergrund,
   Handschrift, eingefügte Bilder und Text. Die frühere Fassung gab nur
   Text und Hintergrundbild aus – Zeichnungen fehlten im PDF komplett.

   794 × 1123 px entsprechen bei 96 dpi genau DIN A4, deshalb passen die
   Seiten ohne Umrechnung in die Druckausgabe (printToPDF, A4, ohne Rand).
   ══════════════════════════════════════════════════════════════════ */

// Zeichnet die Striche einer Seite auf ein durchsichtiges Bild.
// Gleiche Logik wie redrawStrokes(), aber mit fester Skalierung statt
// Bildschirm-Pixelverhältnis, damit die Auflösung fürs Drucken reicht.
function renderInkToDataUrl(page, scale = 2) {
  const strokes = page.inkStrokes || [];
  if (!strokes.length) return null;

  const w = page.w || CFG.PAGE_W;
  const h = page.h || CFG.PAGE_H;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  /* Im Seitenkopf steht nie ein Strich – dieselbe Grenze wie auf dem
     Bildschirm (css/pages.css, .j-canvas) und im Word-Export
     (core/docx.js, drawInk). Ohne das laege im Ausdruck ein Strich
     quer ueber Seitenzahl und Datum. */
  ctx.beginPath();
  ctx.rect(0, CFG.HDR, w, h - CFG.HDR);
  ctx.clip();

  let i = 0;
  while (i < strokes.length) {
    const s = strokes[i];

    if (s.isHL) {
      // Marker gruppiert und gemeinsam transparent, sonst überlagern sie sich
      const chunk = [];
      while (i < strokes.length && strokes[i].isHL) { chunk.push(strokes[i]); i++; }

      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const oc = off.getContext('2d');
      oc.scale(scale, scale);
      chunk.forEach(hs => {
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

  return canvas.toDataURL('image/png');
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {number} pageNo Seitenzahl des HEFTS (1-basiert), nicht des Abschnitts */
function buildPdfPage(nb, sec, page, pageNo) {
  const bgId = page.bg || sec?.defaultBg || nb.defaultBg || 'ruled';
  const lh = lhForBg(bgId);
  const pt = ptForBg(bgId);
  const rightPad = rightPadForBg(bgId);
  const w = page.w || CFG.PAGE_W;
  const h = page.h || CFG.PAGE_H;

  let html = `<div class="pg bg-${bgId}" data-pgid="${escapeAttr(page.id)}" style="width:${w}px;height:${h}px">`;

  if (page.bgImg) {
    html += `<img class="pg-bgimg" src="${escapeAttr(page.bgImg)}">`;
  }

  html += `<div class="ph"><span>${t('page') || 'Seite'} ${pageNo}</span><span>${fmt(page.date)}</span></div>`;

  // Text mit derselben Geometrie wie im Editor
  /* Auch hier bereinigt: das erzeugte HTML wird in main.js in ein
     eigenes Fenster geladen (export-pdf). Das traegt zwar kein
     preload und damit kein window.api, koennte aber immer noch nach
     aussen funken – ein fremdes Heft zu exportieren darf nichts
     ausloesen. */
  const exportText = sanitizePageHtml(page.textContent);
  if (exportText) {
    /* --lh muss mit: die Tabellenzellen halten darüber ihre Mindesthöhe
       auf genau eine Zeile (siehe die Regeln im Kopf von buildPdf). Ohne
       das wäre eine leere Zelle im Ausdruck ein Strich ohne Höhe. */
    html += `<div class="tx" style="line-height:${lh}px;--lh:${lh}px;padding-top:${pt}px;right:${rightPad}px">`
      + exportText + '</div>';
  }

  /* Eingefügte Bilder. Die Ebene entscheidet, ob sie über oder unter Text
     und Handschrift liegen – genau wie in der App (canvas/objects.js). Die
     Reihenfolge im Dokument bleibt die aus page.objects, damit sich zwei
     Bilder derselben Ebene hier genauso überdecken wie dort. */
  for (const obj of (page.objects || [])) {
    if (!obj || !obj.src) continue;
    const rot = obj.rot ? `transform:rotate(${obj.rot}deg);` : '';
    const cls = obj.layer === 'back' ? 'obj behind' : 'obj';
    html += `<img class="${cls}" src="${escapeAttr(obj.src)}" style="left:${obj.x || 0}px;top:${obj.y || 0}px;`
      + `width:${obj.w || 200}px;height:${obj.h || 200}px;${rot}">`;
  }

  const ink = renderInkToDataUrl(page);
  if (ink) html += `<img class="ink" src="${ink}">`;

  html += '</div>';

  // Überschriftengrößen hängen an der Zeilenhöhe des Hintergrunds
  const sel = `[data-pgid="${page.id}"] .tx`;
  html += `<style>${sel} h1,${sel} p.j-title-1{font-size:${Math.round(lh * .75)}px}`
    + `${sel} h2,${sel} p.j-title-2{font-size:${Math.round(lh * .65)}px}`
    + `${sel} h3,${sel} p.j-title-3{font-size:${Math.round(lh * .58)}px}</style>`;

  return html;
}

/* ══════════════════════════════════════════════════════════════════
   WELCHE SEITEN WERDEN EXPORTIERT?

   Ein Export umfasst nicht mehr zwangsläufig das ganze Heft: man kann
   eine einzelne Seite, einen Bereich oder alles ausgeben. Damit sich
   Auswahl und Ergebnis decken, gibt es genau EINE maßgebliche Liste –
   dieselbe, aus der auch das PDF gebaut wird.

   Leere Seiten stehen nicht drin: sie landeten noch nie im PDF, und sie
   mitzuzählen würde die Seitenzahlen der Auswahl verschieben.
   ══════════════════════════════════════════════════════════════════ */

/**
 * @returns {Array<{page: object, sec: object, pageNo: number}>}
 *   in Heft-Reihenfolge. `pageNo` ist die Seitenzahl des HEFTS – dieselbe,
 *   die im Editor über der Seite steht.
 *
 * >>> Warum die Nummer jetzt vom Heft kommt <<<
 * Vorher wurde je Abschnitt gezählt (`indexInSection`), im Export-Dialog
 * dagegen über die ganze Liste. Der Dialog sagte deshalb „Seite 12 von 30",
 * während auf ebendieser Seite im PDF „Seite 3" stand. Beide Zahlen kommen
 * jetzt aus derselben Quelle: notebookPages() in core/data.js.
 *
 * Leere Seiten stehen weiterhin nicht in der Liste – sie landeten noch nie
 * im PDF. Ihre Nummer wird aber NICHT übersprungen: eine herausgegriffene
 * Seite 7 heißt im PDF weiterhin „Seite 7", auch wenn Seite 6 leer war.
 */
function exportPageList(nb) {
  if (!nb) return [];
  getSections(nb);

  const list = [];
  notebookPages(nb).forEach((page, idx) => {
    if (pageIsEmpty(page)) return;
    list.push({ page, sec: findSecForPage(page.id, nb) || null, pageNo: idx + 1 });
  });
  return list;
}

/**
 * Liest eine Eingabe wie „1-3, 5, 8-10" als Menge von Seitenzahlen.
 * @returns {Set<number>|null} null, wenn die Eingabe unbrauchbar ist.
 */
function parsePageRange(text, total) {
  if (typeof text !== 'string') return null;

  // Auch Gedankenstriche und Semikolons annehmen – die tippt man leicht
  const cleaned = text.replace(/[–—]/g, '-').replace(/;/g, ',').trim();
  if (!cleaned) return null;

  const numbers = new Set();

  for (const rawPart of cleaned.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;

    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let from = parseInt(range[1], 10);
      let to = parseInt(range[2], 10);
      if (from > to) [from, to] = [to, from];
      for (let n = from; n <= to; n++) {
        if (n >= 1 && n <= total) numbers.add(n);
      }
      continue;
    }

    if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= total) numbers.add(n);
      continue;
    }

    return null;   // etwas, das keine Seitenangabe ist
  }

  return numbers.size ? numbers : null;
}

/**
 * @param {object} nb
 * @param {object} [options]
 * @param {Set<string>} [options.pageIds] Nur diese Seiten ausgeben. Ohne
 *   Angabe das ganze Heft. Die Seitenzahl in der Kopfzeile bleibt dabei
 *   die des vollständigen Hefts – eine herausgegriffene Seite 7 heißt im
 *   PDF also weiterhin „Seite 7" und nicht „Seite 1".
 */
/* >>> Warum nicht mehr nach Abschnitten gruppiert wird <<<
   Das PDF gibt das Heft wieder, wie es ist: eine durchgehende Folge, mit
   den Seitenzahlen des Hefts. Vorher standen erst alle Seiten des einen
   Abschnitts, dann die des nächsten, jeweils wieder ab 1 gezählt – und der
   Export-Dialog zählte gleichzeitig durch. Er sagte „Seite 12 von 30",
   während auf ebendieser Seite „Seite 3" stand.

   Beide kommen jetzt aus exportPageList(), und die Website gibt ohnehin
   schon flach aus – damit sind alle drei endlich einig. */
function buildPdf(nb, options = {}) {
  getSections(nb);

  const selected = options.pageIds instanceof Set ? options.pageIds : null;

  let body = '';
  for (const entry of exportPageList(nb)) {
    if (selected && !selected.has(entry.page.id)) continue;
    body += buildPdfPage(nb, entry.sec, entry.page, entry.pageNo);
  }

  if (!body) {
    body = `<div class="pg bg-blank" style="width:${CFG.PAGE_W}px;height:${CFG.PAGE_H}px">`
      + `<div class="tx" style="line-height:32px;padding-top:19px;right:32px">${t('pdfEmpty') || 'Dieses Notizbuch enthält noch keine Inhalte.'}</div></div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;1,400&family=DM+Mono:wght@400&family=Cormorant+Garamond:ital,wght@0,400;1,400&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0 }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { background: #fff; font-family: 'Crimson Pro', Georgia, serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }

  .sh { padding: 6mm 18mm 3mm; font-size: 17pt; font-style: italic; color: #8a6030;
        border-bottom: 1px solid #d4c8b0; page-break-after: avoid }

  .pg { position: relative; overflow: hidden; page-break-after: always; break-after: page }
  .pg:last-child { page-break-after: auto }

  .pg.bg-ruled, .pg.bg-grid, .pg.bg-dots { background: #faf7f0 }
  .pg.bg-blank { background: #fff }
  .pg.bg-craft { background: #f0e8d5 }

  .pg.bg-ruled::before { content: ''; position: absolute; inset: 0; z-index: 1;
    background-image: repeating-linear-gradient(to bottom, transparent, transparent 31px, #e2dbd0 31px, #e2dbd0 32px);
    background-position: 0 83px }
  .pg.bg-ruled::after { content: ''; position: absolute; left: 64px; top: 0; bottom: 0; width: 1px;
    background: rgba(190,120,120,.18); z-index: 1 }
  .pg.bg-grid::before { content: ''; position: absolute; inset: 0; z-index: 1;
    background-image: linear-gradient(to bottom, #ddd6c8 1px, transparent 1px), linear-gradient(to right, #ddd6c8 1px, transparent 1px);
    background-size: 24px 24px; background-position: 0 75px, 0 0 }
  .pg.bg-dots::before { content: ''; position: absolute; inset: 0; z-index: 1;
    background-image: radial-gradient(circle, #ddd6c8 1.2px, transparent 1.2px);
    background-size: 24px 24px; background-position: 0 63px }

  .pg-bgimg { position: absolute; top: 56px; left: 0; width: 100%; height: calc(100% - 56px);
              object-fit: contain; z-index: 1 }

  .ph { position: absolute; top: 0; left: 0; right: 0; height: 56px; padding: 0 72px; z-index: 1300;
        display: flex; align-items: center; justify-content: space-between;
        border-bottom: 2px solid #e2dbd0;
        font-family: 'DM Mono', Consolas, monospace; font-size: 9px; color: #b0a898; letter-spacing: .5px }

  .tx { position: absolute; top: 64px; left: 72px; bottom: 24px; z-index: 1000;
        font-family: 'Crimson Pro', Georgia, serif; font-size: 17px; color: #1a1510;
        white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word }
  .tx * { line-height: inherit }
  .tx h1, .tx p.j-title-1 { font-family: 'Cormorant Garamond', 'Crimson Pro', serif; font-weight: 400;
        font-style: italic; color: #2a1f14; border-bottom: 1px solid #e2dbd0; display: block }
  .tx h2, .tx p.j-title-2 { font-weight: 600; color: #2a1f14; display: block }
  .tx h3, .tx p.j-title-3 { font-weight: 600; font-style: italic; color: #3a2e22; display: block }

  /* ── Aufzaehlungen und Tabellen ──────────────────────────────────────
     ACHTUNG: Dieser Block steht INNERHALB einer Schablonenzeichenkette.
     Ein Gegenstrich-Anfuehrungszeichen beendete sie hier mitten im
     Kommentar – deshalb steht im Folgenden keines.

     Beide Regelsaetze standen hier gar nicht, und das ist im Ausdruck zu
     sehen: der Rundumschlag ganz oben (Sternchen, margin 0, padding 0)
     nimmt einer Liste ihren Einzug – die Punkte klebten am linken Rand –
     und eine Tabelle bekam die Voreinstellung des Browsers, also keine
     Linien.

     Die Regeln sind dieselben wie in css/pages.css – auch der Grund
     dafuer, dass die Zellenlinien aus einem box-shadow kommen und nicht
     aus einem border: ein Rand nimmt Platz ein und schoebe den Text
     unter der Tabelle neben die Linien des Papiers. */
  /* Ausrichtung. Dieselben Klassen wie in css/pages.css, samt !important
     aus demselben Grund: Kopfzelle und Block-Formel richten selbst aus
     und sind genauer als eine einzelne Klasse. */
  .tx .j-align-center { text-align: center !important }
  .tx .j-align-right { text-align: right !important }
  .tx .j-align-justify { text-align: justify !important }

  .tx ul, .tx ol { margin: 0; padding: 0 0 0 32px; line-height: inherit }
  .tx li { margin: 0; padding: 0; line-height: inherit }
  .tx ul.j-list-disc { list-style-type: disc }
  .tx ul.j-list-circle { list-style-type: circle }
  .tx ul.j-list-square { list-style-type: square }
  .tx ul.j-list-dash { list-style-type: '– ' }
  .tx ul.j-list-arrow { list-style-type: '➤ ' }
  .tx ul.j-list-check { list-style-type: '✓ ' }
  .tx ol.j-list-decimal { list-style-type: decimal }
  .tx ol.j-list-lower-alpha { list-style-type: lower-alpha }
  .tx ol.j-list-upper-alpha { list-style-type: upper-alpha }
  .tx ol.j-list-lower-roman { list-style-type: lower-roman }
  .tx ol.j-list-upper-roman { list-style-type: upper-roman }
  .tx ol.j-list-paren { list-style-type: decimal }
  .tx ol.j-list-paren > li::marker { content: counter(list-item) ') ' }
  .tx ol.j-list-alpha-paren { list-style-type: lower-alpha }
  .tx ol.j-list-alpha-paren > li::marker { content: counter(list-item, lower-alpha) ') ' }
  .tx ul.j-list-disc ul.j-list-disc { list-style-type: circle }
  .tx ul.j-list-disc ul.j-list-disc ul.j-list-disc { list-style-type: square }
  .tx ol.j-list-decimal ol.j-list-decimal { list-style-type: lower-alpha }
  .tx ol.j-list-decimal ol.j-list-decimal ol.j-list-decimal { list-style-type: lower-roman }

  .tx table.j-table { border-collapse: collapse; table-layout: auto; max-width: 100%;
        margin: 0; font-size: inherit; box-shadow: inset 1px 1px 0 0 rgba(28,20,10,.72) }
  .tx table.j-table:has(colgroup) { table-layout: fixed }
  .tx table.j-table td, .tx table.j-table th { border: 0;
        box-shadow: inset -1px -1px 0 0 rgba(28,20,10,.72);
        padding: 0 7px; vertical-align: middle; word-break: break-word;
        overflow-wrap: break-word; min-width: 28px; height: var(--lh, 32px) }
  .tx table.j-table th { font-weight: 600; text-align: left; background: rgba(28,20,10,.07) }

  /* Dieselbe Staffelung wie in der App (css/pages.css): Muster 1 ·
     Bild hinten 100 · Text 1000 · Handschrift 1100 · Seitenkopf 1300 ·
     Bild vorne 2000. Die Reihenfolge innerhalb eines Bandes steckt hier
     in der Dokumentreihenfolge – buildPdfPage gibt die Bilder in der
     Reihenfolge aus page.objects aus. */
  .obj { position: absolute; object-fit: contain; z-index: 2000 }
  .obj.behind { z-index: 100 }
  .ink { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1100 }
</style></head><body>${body}</body></html>`;
}

function pageIsVisuallyEmpty(page) {
  if (pageIsEmpty(page)) return true;
  if (!page || page.bgImg || page.objects?.length) return false;

  const plainText = (page.textContent || '').replace(/<[^>]+>/g, '').replace(/\s/g, '');
  if (plainText.length) return false;

  // Zeichenfläche ggf. erst wieder aufbauen, sonst wäre eine entlastete
  // Seite fälschlich "leer"
  if (window.PageCanvases) PageCanvases.ensure(page.id);

  const canvas = E('pg-scroll')?.querySelector('[data-pgid="' + page.id + '"]')?.querySelector('.j-canvas');
  if (!canvas) return false;

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const w = canvas.width || 0;
  const h = canvas.height || 0;
  if (!w || !h) return true;

  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

