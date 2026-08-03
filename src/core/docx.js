/* ══════════════════════════════════════════════════════════════════════
   HEFT ALS WORD-DOKUMENT (.docx)

   Erzeugt eine echte .docx-Datei – ohne Bibliothek, ohne Server. Eine
   .docx ist ein ZIP-Archiv mit XML darin; beides steht weiter unten.

   ── Wie das Ergebnis 1:1 wie Inkwell aussieht ───────────────────────
   Ein Word-Dokument kann Text nicht frei auf der Seite platzieren wie
   der Browser. Deshalb wird jede Heftseite zweigeteilt ausgegeben:

     1. Ein Vollseiten-Bild HINTER dem Text (behindDoc). Es enthält
        alles, was Word nicht als Text kennt: Papier (liniert, kariert,
        gepunktet, Kraftpapier), Kopfzeile, eingefügte Bilder und
        PDF-Seiten sowie die Handschrift.
     2. Der getippte Text als richtiger Word-Text – mit Überschriften,
        Fett/Kursiv/Unterstrichen und Farben. Der bleibt änderbar.

   Damit der Text auf denselben Linien sitzt wie in der App, bekommt
   JEDE Seite ihren eigenen Word-Abschnitt: Seitengröße und Ränder
   werden aus den Maßen der Heftseite gerechnet (1 px bei 96 dpi = 15
   Twips), die Zeilenhöhe wird als feste Zeilenhöhe gesetzt.

   ── Ein Modul für App und Website ───────────────────────────────────
   Bewusst ein klassisches Script ohne Import/Export: es wird sowohl in
   der Desktop-App (src/core/docx.js) als auch auf der Website geladen.
   Gleiche Datei = gleiches Ergebnis. Abgleich: npm run sync-share
   ══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* ── Maße ─────────────────────────────────────────────────────────
     Alle Längen im Heft sind CSS-Pixel bei 96 dpi.
     Word rechnet in Twips (1/1440 Zoll) und EMU (1/914400 Zoll).      */

  const TWIPS_PER_PX = 15;        // 96 dpi -> 1440/96
  const EMU_PER_PX = 9525;        // 914400/96

  const DEFAULT_PAGE_W = 794;     // = A4-Breite bei 96 dpi
  const DEFAULT_PAGE_H = 1123;

  const HEADER_H = 56;            // .j-page-hdr
  const TEXT_TOP = 64;            // .j-text top
  const TEXT_LEFT = 72;
  const TEXT_BOTTOM = 24;

  const BASE_FONT_PX = 17;        // .j-text font-size

  // Farben aus css/base.css bzw. css/pages.css
  const PAPER = '#faf7f0';
  const PAPER_LINE = '#e2dbd0';   // --pl
  const PAPER_GRID = '#ddd6c8';   // --pg
  const PAPER_MARGIN = 'rgba(190,120,120,0.18)';
  const TEXT_COLOR = '1A1510';
  const HDR_COLOR = '#b0a898';

  /* Muss zu src/canvas/text.js passen – sonst stünde der Text im Word-
     Dokument nicht auf denselben Linien wie in der App. */
  const lhForBg = (bg) => (bg === 'grid' || bg === 'dots') ? 24 : 32;
  const ptForBg = (bg) => Math.round(lhForBg(bg) - BASE_FONT_PX * 0.78);
  const rightPadForBg = (bg) =>
    (bg === 'grid' || bg === 'dots' || bg === 'blank' || bg === 'craft') ? 72 : 32;

  /* ══════════════════════════════════════════════════════════════════
     ZIP (nur „gespeichert", ohne Komprimierung)

     Reicht vollkommen: der Inhalt sind PNG/JPEG-Bilder, die ohnehin
     schon komprimiert sind. Deflate selbst zu schreiben wäre viel Code
     für wenige Prozent.
     ══════════════════════════════════════════════════════════════════ */

  let _crcTable = null;

  function crcTable() {
    if (_crcTable) return _crcTable;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    _crcTable = table;
    return table;
  }

  function crc32(bytes) {
    const table = crcTable();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const utf8 = (text) => new TextEncoder().encode(text);

  /**
   * @param {Array<{name: string, data: Uint8Array}>} entries
   * @returns {Uint8Array} das fertige Archiv
   */
  function zip(entries) {
    const parts = [];
    const directory = [];
    let offset = 0;

    // 1980-01-01, weil ein ZIP kein Datum vor 1980 abbilden kann und der
    // Zeitpunkt hier ohnehin nichts aussagt.
    const DOS_DATE = 0x0021;
    const DOS_TIME = 0x0000;

    for (const entry of entries) {
      const nameBytes = utf8(entry.name);
      const data = entry.data;
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);         // benötigte Version
      lv.setUint16(6, 0x0800, true);     // Dateinamen sind UTF-8
      lv.setUint16(8, 0, true);          // Verfahren: gespeichert
      lv.setUint16(10, DOS_TIME, true);
      lv.setUint16(12, DOS_DATE, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);         // erzeugt von
      cv.setUint16(6, 20, true);         // benötigte Version
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, DOS_TIME, true);
      cv.setUint16(14, DOS_DATE, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);

      parts.push(local, data);
      directory.push(central);
      offset += local.length + data.length;
    }

    const directorySize = directory.reduce((sum, part) => sum + part.length, 0);

    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, directorySize, true);
    ev.setUint32(16, offset, true);

    const all = [...parts, ...directory, end];
    const total = all.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of all) { out.set(part, at); at += part.length; }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════
     KLEINKRAM
     ══════════════════════════════════════════════════════════════════ */

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Steuerzeichen sind in XML nicht erlaubt und lassen Word die Datei
      // als beschädigt melden.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = String(dataUrl).split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /** '#a0b0c0' oder 'rgb(1,2,3)' -> 'A0B0C0'. Ohne Treffer: null. */
  function toHexColor(value) {
    if (!value) return null;
    const text = String(value).trim();

    const hex = text.match(/^#?([0-9a-f]{6})$/i);
    if (hex) return hex[1].toUpperCase();

    const short = text.match(/^#([0-9a-f]{3})$/i);
    if (short) {
      return short[1].split('').map(c => c + c).join('').toUpperCase();
    }

    const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
      return [rgb[1], rgb[2], rgb[3]]
        .map(n => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0'))
        .join('').toUpperCase();
    }

    return null;
  }

  /* ══════════════════════════════════════════════════════════════════
     SEITENBILD

     Alles, was Word nicht als Text darstellen kann, wird hier auf ein
     Canvas gezeichnet – in derselben Reihenfolge und mit denselben
     Farben wie css/pages.css und canvas/drawing.js.
     ══════════════════════════════════════════════════════════════════ */

  function traceStrokePath(ctx, stroke) {
    const pts = stroke.path;
    if (!pts || !pts.length) return;

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (stroke.isGeometric) {
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

  function applyStrokeStyles(ctx, stroke) {
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  // Ältere Hefte legen die Punkte unter "points" und die Breite unter "size" ab
  function normalizeStroke(stroke) {
    return {
      ...stroke,
      path: Array.isArray(stroke.path) ? stroke.path
        : (Array.isArray(stroke.points) ? stroke.points : []),
      width: stroke.width || stroke.size || 2,
      color: stroke.color || '#1a1510',
      isHL: stroke.isHL || stroke.isHighlighter || false
    };
  }

  function drawPaper(ctx, bg, w, h) {
    ctx.fillStyle = bg === 'blank' ? '#ffffff' : bg === 'craft' ? '#f0e8d5' : PAPER;
    ctx.fillRect(0, 0, w, h);

    if (bg === 'ruled') {
      // repeating-linear-gradient, 32px Abstand, Ursprung bei y = 83
      ctx.fillStyle = PAPER_LINE;
      for (let y = 83 + 31; y < h; y += 32) ctx.fillRect(0, y, w, 1);
      for (let y = 83 - 1; y >= 0; y -= 32) ctx.fillRect(0, y, w, 1);

      // Randlinie links (.j-page.bg-ruled::after)
      ctx.fillStyle = PAPER_MARGIN;
      ctx.fillRect(64, 0, 1, h);
      return;
    }

    if (bg === 'grid') {
      ctx.fillStyle = PAPER_GRID;
      for (let y = 75; y < h; y += 24) ctx.fillRect(0, y, w, 1);
      for (let y = 75 - 24; y >= 0; y -= 24) ctx.fillRect(0, y, w, 1);
      for (let x = 0; x < w; x += 24) ctx.fillRect(x, 0, 1, h);
      return;
    }

    if (bg === 'dots') {
      // radial-gradient, Kachel 24x24, Ursprung y = 63 -> Mittelpunkte bei 75
      ctx.fillStyle = PAPER_GRID;
      for (let y = 75; y < h; y += 24) {
        for (let x = 12; x < w; x += 24) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (let y = 75 - 24; y >= 0; y -= 24) {
        for (let x = 12; x < w; x += 24) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawHeader(ctx, w, leftText, rightText) {
    ctx.fillStyle = PAPER_LINE;
    ctx.fillRect(0, HEADER_H - 2, w, 2);

    ctx.save();
    ctx.font = '9px "DM Mono", Consolas, "Courier New", monospace';
    ctx.fillStyle = HDR_COLOR;
    ctx.textBaseline = 'middle';
    try { ctx.letterSpacing = '0.5px'; } catch (e) { /* ältere Engines */ }

    ctx.textAlign = 'left';
    if (leftText) ctx.fillText(leftText, TEXT_LEFT, HEADER_H / 2);

    ctx.textAlign = 'right';
    if (rightText) ctx.fillText(rightText, w - TEXT_LEFT, HEADER_H / 2);
    ctx.restore();
  }

  // object-fit: contain
  function containBox(imgW, imgH, boxW, boxH) {
    if (!imgW || !imgH) return { x: 0, y: 0, w: boxW, h: boxH };
    const scale = Math.min(boxW / imgW, boxH / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
  }

  function drawInk(ctx, strokes, w, h, scale) {
    const list = (strokes || []).map(normalizeStroke);

    let i = 0;
    while (i < list.length) {
      const stroke = list[i];

      if (stroke.isHL) {
        // Marker gemeinsam und einmal transparent, sonst überlagern sie sich
        const chunk = [];
        while (i < list.length && list[i].isHL) { chunk.push(list[i]); i++; }

        const off = document.createElement('canvas');
        off.width = Math.round(w * scale);
        off.height = Math.round(h * scale);
        const oc = off.getContext('2d');
        oc.scale(scale, scale);
        for (const hl of chunk) {
          applyStrokeStyles(oc, hl);
          oc.globalAlpha = 1;
          traceStrokePath(oc, hl);
        }

        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.drawImage(off, 0, 0, w, h);
        ctx.restore();
      } else if (stroke.isEraser) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        applyStrokeStyles(ctx, { ...stroke, color: 'rgba(0,0,0,1)' });
        traceStrokePath(ctx, stroke);
        ctx.restore();
        i++;
      } else {
        ctx.save();
        applyStrokeStyles(ctx, stroke);
        ctx.globalAlpha = stroke.alpha || 1;
        traceStrokePath(ctx, stroke);
        ctx.restore();
        i++;
      }
    }
  }

  /**
   * Zeichnet eine ganze Heftseite ohne den getippten Text.
   * @returns {Promise<{dataUrl: string, extension: string}>}
   */
  async function renderPageImage(entry, scale) {
    const page = entry.page;
    const w = page.w || DEFAULT_PAGE_W;
    const h = page.h || DEFAULT_PAGE_H;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);

    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let hasPhoto = false;

    if (page.bgImg) {
      // Eine eingefügte PDF- oder Bildseite deckt das Papier ab
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const img = await loadImage(page.bgImg);
      if (img) {
        const box = containBox(img.naturalWidth, img.naturalHeight, w, h - HEADER_H);
        ctx.drawImage(img, box.x, HEADER_H + box.y, box.w, box.h);
        hasPhoto = true;
      }
    } else {
      drawPaper(ctx, entry.bg, w, h);
    }

    drawHeader(ctx, w, entry.headerLeft, entry.headerRight);

    for (const obj of (page.objects || [])) {
      if (!obj || !obj.src) continue;
      const img = await loadImage(obj.src);
      if (!img) continue;

      hasPhoto = true;
      const ow = obj.w || 200;
      const oh = obj.h || 200;
      const box = containBox(img.naturalWidth, img.naturalHeight, ow, oh);

      ctx.save();
      if (obj.rot) {
        ctx.translate((obj.x || 0) + ow / 2, (obj.y || 0) + oh / 2);
        ctx.rotate(obj.rot * Math.PI / 180);
        ctx.translate(-ow / 2, -oh / 2);
        ctx.drawImage(img, box.x, box.y, box.w, box.h);
      } else {
        ctx.drawImage(img, (obj.x || 0) + box.x, (obj.y || 0) + box.y, box.w, box.h);
      }
      ctx.restore();
    }

    drawInk(ctx, page.inkStrokes, w, h, scale);

    // Papier und Handschrift sind große Flächen und dünne Linien – dafür ist
    // PNG klein und scharf. Sobald Fotos im Spiel sind, wird PNG schnell
    // riesig; dann lieber JPEG mit hoher Qualität.
    return hasPhoto
      ? { dataUrl: canvas.toDataURL('image/jpeg', 0.9), extension: 'jpeg' }
      : { dataUrl: canvas.toDataURL('image/png'), extension: 'png' };
  }

  /* ══════════════════════════════════════════════════════════════════
     TEXT:  contenteditable-HTML  ->  Word-Absätze
     ══════════════════════════════════════════════════════════════════ */

  const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'SECTION']);

  function paragraphStyleOf(el) {
    const tag = el.tagName;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (tag === 'H1' || cls.includes('j-title-1')) return 'h1';
    if (tag === 'H2' || cls.includes('j-title-2')) return 'h2';
    if (tag === 'H3' || cls.includes('j-title-3')) return 'h3';
    return 'body';
  }

  function inlineColorOf(el) {
    const inline = el.style && el.style.color ? el.style.color : null;
    return toHexColor(inline) || toHexColor(el.getAttribute && el.getAttribute('color'));
  }

  /**
   * @param {string} html Inhalt von page.textContent
   * @returns {Array<{style: string, runs: Array}>}
   */
  function htmlToParagraphs(html) {
    const paragraphs = [];
    if (!html) return paragraphs;

    const doc = new DOMParser().parseFromString('<div id="root">' + html + '</div>', 'text/html');
    const root = doc.getElementById('root');
    if (!root) return paragraphs;

    let current = null;

    const openParagraph = (style) => {
      current = { style, runs: [] };
      paragraphs.push(current);
      return current;
    };
    const ensureParagraph = () => current || openParagraph('body');

    const walk = (node, format) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          // &nbsp; kommt aus contenteditable und soll ein normales
          // Leerzeichen werden, sonst klebt Word Wörter zusammen
          const text = child.nodeValue.replace(/\u00a0/g, ' ');
          if (text) ensureParagraph().runs.push({ ...format, text });
          continue;
        }
        if (child.nodeType !== 1) continue;

        const tag = child.tagName;

        if (tag === 'BR') {
          ensureParagraph().runs.push({ ...format, lineBreak: true });
          continue;
        }
        if (tag === 'SCRIPT' || tag === 'STYLE') continue;

        const next = { ...format };
        if (tag === 'B' || tag === 'STRONG') next.bold = true;
        if (tag === 'I' || tag === 'EM') next.italic = true;
        if (tag === 'U' || tag === 'INS') next.underline = true;
        if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;

        const style = child.style || {};
        if (style.fontWeight === 'bold' || parseInt(style.fontWeight, 10) >= 600) next.bold = true;
        if (style.fontStyle === 'italic') next.italic = true;
        if (typeof style.textDecoration === 'string' && style.textDecoration.includes('underline')) next.underline = true;

        const color = inlineColorOf(child);
        if (color) next.color = color;

        if (BLOCK_TAGS.has(tag)) {
          openParagraph(paragraphStyleOf(child));
          walk(child, next);
          // Text, der NACH einem Block kommt, gehört in einen neuen Absatz
          current = null;
        } else {
          walk(child, next);
        }
      }
    };

    walk(root, {});

    // Reine Hüllen ohne Inhalt (verschachtelte divs) fallen weg; ein
    // <div><br></div> hat einen Umbruch-Lauf und bleibt als Leerzeile stehen.
    return paragraphs.filter(p => p.runs.length > 0);
  }

  /* ══════════════════════════════════════════════════════════════════
     OOXML
     ══════════════════════════════════════════════════════════════════ */

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

  // Word-Schriftgröße wird in halben Punkten angegeben; 1 px = 0,75 pt
  const halfPoints = (px) => Math.max(2, Math.round(px * 1.5));

  function styleSpec(style, lh) {
    switch (style) {
      case 'h1':
        return {
          font: 'Cormorant Garamond', fallback: 'Crimson Pro',
          size: halfPoints(Math.round(lh * 0.75)),
          italic: true, bold: false, color: '2A1F14', border: true
        };
      case 'h2':
        return {
          font: 'Crimson Pro', fallback: 'Crimson Pro',
          size: halfPoints(Math.round(lh * 0.65)),
          italic: false, bold: true, color: '2A1F14', border: false
        };
      case 'h3':
        return {
          font: 'Crimson Pro', fallback: 'Crimson Pro',
          size: halfPoints(Math.round(lh * 0.58)),
          italic: false, bold: true, color: '3A2E22', border: false, italicToo: true
        };
      default:
        return {
          font: 'Crimson Pro', fallback: 'Georgia',
          size: halfPoints(BASE_FONT_PX),
          italic: false, bold: false, color: TEXT_COLOR, border: false
        };
    }
  }

  /* Die Reihenfolge in <w:rPr> ist im Schema festgelegt (CT_RPr):
     rFonts, b, i, strike, color, sz, szCs, u. Word verzeiht Abweichungen
     meist, andere Programme (LibreOffice, Google Docs) nicht immer. */
  function runXml(run, spec) {
    const props = [];
    props.push(`<w:rFonts w:ascii="${esc(spec.font)}" w:hAnsi="${esc(spec.font)}" w:cs="${esc(spec.font)}"/>`);
    if (run.bold || spec.bold) props.push('<w:b/>');
    if (run.italic || spec.italic || spec.italicToo) props.push('<w:i/>');
    if (run.strike) props.push('<w:strike/>');
    props.push(`<w:color w:val="${esc(run.color || spec.color)}"/>`);
    props.push(`<w:sz w:val="${spec.size}"/><w:szCs w:val="${spec.size}"/>`);
    if (run.underline) props.push('<w:u w:val="single"/>');

    const rPr = `<w:rPr>${props.join('')}</w:rPr>`;

    if (run.lineBreak) return `<w:r>${rPr}<w:br/></w:r>`;
    return `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
  }

  /** Das Vollseiten-Bild, frei positioniert und hinter dem Text. */
  function anchorXml(id, relationshipId, widthPx, heightPx) {
    const cx = Math.round(widthPx * EMU_PER_PX);
    const cy = Math.round(heightPx * EMU_PER_PX);

    return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>'
      + '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" '
      + 'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">'
      + '<wp:simplePos x="0" y="0"/>'
      + '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>'
      + '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>'
      + `<wp:extent cx="${cx}" cy="${cy}"/>`
      + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
      + '<wp:wrapNone/>'
      + `<wp:docPr id="${id}" name="Inkwell-Seite ${id}"/>`
      + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + '<pic:pic>'
      + `<pic:nvPicPr><pic:cNvPr id="${id}" name="seite${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + '<pic:spPr><a:xfrm><a:off x="0" y="0"/>'
      + `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
      + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
      + '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
  }

  /**
   * Abschnittseigenschaften einer Seite: Seitengröße und Ränder werden
   * direkt aus den Maßen der Heftseite gerechnet, damit der Word-Text an
   * genau derselben Stelle beginnt wie in der App.
   */
  function sectionXml(entry) {
    const page = entry.page;
    const w = page.w || DEFAULT_PAGE_W;
    const h = page.h || DEFAULT_PAGE_H;
    const topPad = ptForBg(entry.bg);

    return '<w:sectPr>'
      + `<w:pgSz w:w="${Math.round(w * TWIPS_PER_PX)}" w:h="${Math.round(h * TWIPS_PER_PX)}"/>`
      + '<w:pgMar'
      + ` w:top="${Math.round((TEXT_TOP + topPad) * TWIPS_PER_PX)}"`
      + ` w:right="${Math.round(rightPadForBg(entry.bg) * TWIPS_PER_PX)}"`
      + ` w:bottom="${Math.round(TEXT_BOTTOM * TWIPS_PER_PX)}"`
      + ` w:left="${Math.round(TEXT_LEFT * TWIPS_PER_PX)}"`
      + ' w:header="0" w:footer="0" w:gutter="0"/>'
      + '<w:cols w:space="0"/>'
      + '<w:docGrid w:linePitch="360"/>'
      + '</w:sectPr>';
  }

  function paragraphXml(paragraph, lh, options = {}) {
    const spec = styleSpec(paragraph.style, lh);

    // Reihenfolge nach CT_PPr: pBdr, spacing, ind, sectPr
    const props = [];
    if (spec.border) {
      props.push(`<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="${PAPER_LINE.slice(1).toUpperCase()}"/></w:pBdr>`);
    }
    props.push(`<w:spacing w:before="0" w:after="0" w:line="${Math.round(lh * TWIPS_PER_PX)}" w:lineRule="exact"/>`);
    props.push('<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
    if (options.sectPr) props.push(options.sectPr);

    const runs = (options.leadingXml || '')
      + paragraph.runs.map(run => runXml(run, spec)).join('');

    return `<w:p><w:pPr>${props.join('')}</w:pPr>${runs}</w:p>`;
  }

  /* ══════════════════════════════════════════════════════════════════
     ZUSAMMENBAU
     ══════════════════════════════════════════════════════════════════ */

  /**
   * @param {Array} entries  je Seite ein Eintrag:
   *   { page, bg, headerLeft, headerRight }
   * @param {object} [options]
   * @param {string} [options.title] Titel in den Dokumenteigenschaften
   * @param {number} [options.scale=2] Auflösung der Seitenbilder
   * @param {(done:number,total:number)=>void} [options.onProgress]
   * @returns {Promise<Uint8Array>} der Inhalt der .docx-Datei
   */
  async function build(entries, options = {}) {
    const list = Array.isArray(entries) ? entries.filter(e => e && e.page) : [];
    if (!list.length) throw new Error('EMPTY_SELECTION');

    const scale = options.scale || 2;

    const media = [];        // { name, data }
    const relationships = [];
    const body = [];

    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const lh = lhForBg(entry.bg);

      const image = await renderPageImage(entry, scale);
      const relationshipId = `rId${i + 1}`;
      const fileName = `seite${i + 1}.${image.extension}`;

      media.push({ name: `word/media/${fileName}`, data: dataUrlToBytes(image.dataUrl) });
      relationships.push(
        `<Relationship Id="${relationshipId}" `
        + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
        + `Target="media/${fileName}"/>`
      );

      const width = entry.page.w || DEFAULT_PAGE_W;
      const height = entry.page.h || DEFAULT_PAGE_H;
      const anchor = anchorXml(i + 1, relationshipId, width, height);

      const paragraphs = htmlToParagraphs(entry.page.textContent);
      // Das Seitenbild hängt am ersten Absatz. Ein frei positioniertes Bild
      // nimmt keinen Platz im Textfluss ein – ein eigener Absatz dafür würde
      // dagegen jede Seite um eine Leerzeile nach unten schieben.
      if (!paragraphs.length) paragraphs.push({ style: 'body', runs: [] });

      // Die Abschnittsangaben stehen beim letzten Absatz der Seite; dadurch
      // beginnt die nächste Seite automatisch neu, ganz ohne Seitenumbruch.
      const isLast = i === list.length - 1;

      paragraphs.forEach((paragraph, index) => {
        body.push(paragraphXml(paragraph, lh, {
          leadingXml: index === 0 ? anchor : '',
          sectPr: (!isLast && index === paragraphs.length - 1) ? sectionXml(entry) : ''
        }));
      });

      if (isLast) body.push(sectionXml(entry));

      if (typeof options.onProgress === 'function') options.onProgress(i + 1, list.length);
    }

    const documentXml = XML_HEAD
      + `<w:document ${NS}><w:body>${body.join('')}</w:body></w:document>`;

    const contentTypes = XML_HEAD
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Default Extension="png" ContentType="image/png"/>'
      + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
      + '<Override PartName="/word/document.xml" '
      + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>';

    const rootRels = XML_HEAD
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '<Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '</Relationships>';

    const documentRels = XML_HEAD
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + relationships.join('')
      + '</Relationships>';

    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const coreXml = XML_HEAD
      + '<cp:coreProperties '
      + 'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
      + 'xmlns:dc="http://purl.org/dc/elements/1.1/" '
      + 'xmlns:dcterms="http://purl.org/dc/terms/" '
      + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:title>${esc(options.title || 'Inkwell')}</dc:title>`
      + '<dc:creator>Inkwell</dc:creator>'
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>`
      + `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
      + '</cp:coreProperties>';

    return zip([
      // [Content_Types].xml muss als Erstes im Archiv stehen
      { name: '[Content_Types].xml', data: utf8(contentTypes) },
      { name: '_rels/.rels', data: utf8(rootRels) },
      { name: 'docProps/core.xml', data: utf8(coreXml) },
      { name: 'word/document.xml', data: utf8(documentXml) },
      { name: 'word/_rels/document.xml.rels', data: utf8(documentRels) },
      ...media
    ]);
  }

  /** Dateiname ohne Zeichen, die Windows nicht erlaubt. */
  function safeFileName(name) {
    return String(name || 'Inkwell').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Inkwell';
  }

  global.InkwellDocx = { build, safeFileName, htmlToParagraphs, lhForBg };
})(typeof window !== 'undefined' ? window : globalThis);
