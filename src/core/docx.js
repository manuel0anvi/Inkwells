/* ══════════════════════════════════════════════════════════════════════
   HEFT ALS WORD-DOKUMENT (.docx)

   Erzeugt eine echte .docx-Datei – ohne Bibliothek, ohne Server. Eine
   .docx ist ein ZIP-Archiv mit XML darin; beides steht weiter unten.

   ── Wie das Ergebnis 1:1 wie Inkwells aussieht ───────────────────────
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

  /**
   * Die Farbe des Blattes.
   *
   * >>> Warum ein leeres Blatt hier NICHT weiss ist <<<
   * Im Heft ist es das (css/pages.css, .bg-blank) – zwischen zwei warmen
   * Seiten fällt das kaum auf, weil man immer nur eine ansieht. In einem
   * Word-Dokument stehen sie untereinander, und dann steht ein weisses
   * Blatt als heller Bruch zwischen den anderen. Es bekommt deshalb
   * denselben Ton wie sie.
   */
  function papierFarbe(bg) {
    return bg === 'craft' ? '#f0e8d5' : PAPER;
  }

  function drawPaper(ctx, bg, w, h) {
    ctx.fillStyle = papierFarbe(bg);
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


  // object-fit: contain
  function containBox(imgW, imgH, boxW, boxH) {
    if (!imgW || !imgH) return { x: 0, y: 0, w: boxW, h: boxH };
    const scale = Math.min(boxW / imgW, boxH / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
  }

  /* Der Seitenkopf: 56 px hoch plus 2 px Linie. Die Zahl steht in der App
     in CFG.HDR (core/state.js); diese Datei laeuft aber auch auf der
     Website, wo es kein CFG gibt – deshalb hier noch einmal. Wer sie
     aendert, muss beide Stellen anfassen. */
  const KOPF_H = 58;

  function drawInk(ctx, strokes, w, h, scale) {
    const list = (strokes || []).map(normalizeStroke);

    /* Im Seitenkopf steht nie ein Strich. Auf dem Bildschirm schneidet
       das css/pages.css ab (.j-canvas); hier muss es der Kontext tun,
       sonst laege im Word-Export ein Strich quer ueber Seitenzahl und
       Datum.

       In SEITENMASSEN, nicht in Bildpunkten: renderPageImage hat den
       Kontext schon skaliert (ctx.scale), und alles darin rechnet
       deshalb in den Massen der Seite. */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, KOPF_H, w, h - KOPF_H);
    ctx.clip();

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

    // Der Beschnitt gilt nur fuer die Striche – danach wird noch gemalt
    ctx.restore();
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE HANDSCHRIFT ALS EIGENES DING

     Sie steckte im Seitenbild, zusammen mit dem Papier. In Word liess
     sich damit nichts davon anfassen, und das Papier musste ihretwegen
     fein gerastert werden – ein kariertes Blatt mit drei Strichen
     kostete 96 KB statt 36.

     Jetzt ist sie ein Bild fuer sich, und zwar nur so gross wie das,
     was darauf steht: gemalt wird in den Kasten um alle Striche, nicht
     auf ein ganzes Blatt. Eine Notiz in der Ecke kostet damit so viel
     wie eine Notiz in der Ecke.

     >>> Warum ein Bild und keine Freihandform <<<
     Word kennt Freiformen (a:custGeom), und ein Strich liesse sich als
     Pfad schreiben. Nur besteht ein Strich aus Hunderten von Punkten mit
     wechselndem Druck – die Breite gehoert zum Weg, nicht zur Linie.
     Als Pfad waere jeder Strich entweder gleichmaessig dick oder ein
     Umriss aus tausend Punkten. Ein Bild sagt die Wahrheit darueber,
     was es ist: ein Abbild der Handschrift.

     >>> Warum hinter dem Text <<<
     Im Heft liegt sie unter dem Textfeld (css/pages.css). Ein Textmarker
     ueber einem Wort ist dort durchsichtig; als Objekt VOR dem Text
     laege er darauf und deckte es zu.
     ══════════════════════════════════════════════════════════════════ */
  async function renderInkImage(page, scale) {
    const strokes = (page.inkStrokes || []).map(normalizeStroke);
    if (!strokes.length) return null;

    const w = page.w || DEFAULT_PAGE_W;
    const h = page.h || DEFAULT_PAGE_H;

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) {
      const rand = (s.width || 2) / 2 + 1;
      for (const p of (s.path || [])) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (p.x - rand < x0) x0 = p.x - rand;
        if (p.x + rand > x1) x1 = p.x + rand;
        if (p.y - rand < y0) y0 = p.y - rand;
        if (p.y + rand > y1) y1 = p.y + rand;
      }
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y1)) return null;

    // Im Seitenkopf steht nie ein Strich – derselbe Beschnitt wie drawInk
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(KOPF_H, Math.floor(y0));
    x1 = Math.min(w, Math.ceil(x1));
    y1 = Math.min(h, Math.ceil(y1));
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw < 2 || bh < 2) return null;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bw * scale);
    canvas.height = Math.round(bh * scale);

    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    /* Der Ursprung wandert in die Ecke des Kastens; drinnen wird weiter
       in Seitenmassen gerechnet, so wie drawInk es erwartet. */
    ctx.translate(-x0, -y0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    drawInk(ctx, page.inkStrokes, w, h, scale);

    // PNG, denn was zwischen den Strichen liegt, muss durchsichtig bleiben
    return { dataUrl: canvas.toDataURL('image/png'), x: x0, y: y0, w: bw, h: bh };
  }

  /**
   * Zeichnet den Hintergrund einer Heftseite: das Papier und eine
   * eingefügte Bildseite. Text, Objekte und Handschrift kommen als
   * eigene Dinge dazu (build).
   *
   * >>> Warum nicht immer in voller Auflösung <<<
   * Das Papiermuster besteht aus Linien von genau EINEM Pixel. Bei
   * doppelter Auflösung werden daraus zwei, das Bild vervierfacht sich –
   * und zu sehen ist davon nichts. Ein kariertes Blatt kostete so 172 KB
   * statt 37 KB, auf zehn Seiten über ein Megabyte für Linien.
   *
   * Feiner gerechnet wird nur, wo es etwas bringt: bei einer
   * eingefügten Bildseite, die ein Foto ist und grob gerastert sichtbar
   * verliert.
   *
   * >>> Und warum ein Blatt ohne Muster gar keines bekommt <<<
   * Auf ihm steht nichts als eine einzige Farbe. Ein Bild davon wären
   * 66 KB für eine Fläche – die malt build stattdessen als Form, und
   * die kostet nichts (papierFarbe).
   *
   * @returns {Promise<{dataUrl: string, extension: string}|null>}
   *   null = diese Seite braucht kein Bild, nur ihre Farbe
   */
  async function renderPageImage(entry, scale) {
    const page = entry.page;
    const w = page.w || DEFAULT_PAGE_W;
    const h = page.h || DEFAULT_PAGE_H;

    const ohneMuster = entry.bg === 'blank' || entry.bg === 'craft';
    if (!page.bgImg && ohneMuster) return null;

    const feinheit = page.bgImg ? scale : 1;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * feinheit);
    canvas.height = Math.round(h * feinheit);

    const ctx = canvas.getContext('2d');
    ctx.scale(feinheit, feinheit);
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

    /* ══ HIER WURDE EINMAL ALLES MITGEMALT ═════════════════════════
       Papier, Hintergrund, jedes Foto, jede Zeichnung und die
       Handschrift in einer Datei – die ganze Seite war ein einziges
       Bild, und in Word liess sich davon nichts anfassen.

       Alles geht jetzt als eigenes Ding hinaus (build): ein Bild als
       Bild, eine Form als Word-Form, die Handschrift als eigenes Bild in
       ihrem eigenen Kasten. Hier bleibt nur, was das Blatt selbst ist. */

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

  /* ══════════════════════════════════════════════════════════════════
     AUFZÄHLUNGEN

     >>> Warum die Marke als TEXT im Absatz steht und nicht als echte
         Word-Nummerierung <<<
     Eine richtige Nummerierung braucht einen eigenen Teil numbering.xml
     mit Ebenendefinitionen – und Word bringt dafür seine eigenen
     Abstände und Einzüge mit. Genau die sind hier das Problem: dieses
     Dokument legt hinter den Text ein Bild der Seite mit den Linien des
     Papiers und setzt jeden Absatz auf `w:lineRule="exact"`, damit die
     Zeilen auf denselben Linien sitzen wie in der App. Eine
     Word-Nummerierung würde in dieses Raster hineinregieren, und der
     ganze Text darunter stünde neben den Linien.

     Als Text im Absatz ist die Marke dagegen bloß ein Lauf wie jeder
     andere: Zeilenhöhe, Farbe und Schrift bleiben, wie sie sind. Der
     hängende Einzug sorgt dafür, dass umbrechende Zeilen unter dem Text
     beginnen und nicht unter der Marke – so sieht es auch in der App
     aus. Bearbeiten lässt sich die Liste in Word dann nicht mehr als
     Liste; dieses Dokument ist ohnehin eine Abbildung der Seite und
     keine Vorlage zum Weiterschreiben.
     ══════════════════════════════════════════════════════════════════ */

  // Muss zu css/pages.css und zu LIST_STYLES in core/lists.js passen
  const LIST_BULLETS = {
    disc: '●', circle: '○', square: '▪', dash: '–', arrow: '➤', check: '✓'
  };

  const LIST_INDENT_PX = 32;      // = padding-left je Ebene in css/pages.css
  const LIST_HANGING_PX = 20;     // so weit steht die Marke davor

  /* So breit wird ein Leerzeichen beim Ausgeben veranschlagt. Gebraucht
     nur für den Abstandshalter mitten in einer Zeile (siehe dort) – ein
     Näherungswert, denn wie breit Word es wirklich setzt, weiss nur
     Word. Im Heft selbst wird nichts genähert. */
  const LUECKE_ZEICHEN_PX = 4.5;

  function romanOf(n) {
    const paare = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let rest = Math.max(1, n);
    let out = '';
    for (const [wert, zeichen] of paare) {
      while (rest >= wert) { out += zeichen; rest -= wert; }
    }
    return out;
  }

  /** 1 -> A, 26 -> Z, 27 -> AA (wie CSS upper-alpha) */
  function alphaOf(n) {
    let rest = Math.max(1, n);
    let out = '';
    while (rest > 0) {
      rest--;
      out = String.fromCharCode(65 + (rest % 26)) + out;
      rest = Math.floor(rest / 26);
    }
    return out;
  }

  /**
   * Die Form einer Liste – mit demselben Wechsel je Ebene, den
   * css/pages.css für die Voreinstellungen macht (● ○ ▪ bzw. 1. a. i.).
   */
  function listStyleIdOf(list, depth) {
    const cls = typeof list.className === 'string' ? list.className : '';
    const treffer = cls.match(/j-list-([a-z-]+)/);
    let id = treffer ? treffer[1] : (list.tagName === 'OL' ? 'decimal' : 'disc');

    if (id === 'disc') id = depth >= 3 ? 'square' : (depth === 2 ? 'circle' : 'disc');
    else if (id === 'decimal') id = depth >= 3 ? 'lower-roman' : (depth === 2 ? 'lower-alpha' : 'decimal');
    return id;
  }

  /** Die Marke des n-ten Punktes (n ab 1). */
  function listMarkerOf(styleId, n) {
    if (LIST_BULLETS[styleId]) return LIST_BULLETS[styleId];
    switch (styleId) {
      case 'paren': return n + ')';
      case 'lower-alpha': return alphaOf(n).toLowerCase() + '.';
      case 'alpha-paren': return alphaOf(n).toLowerCase() + ')';
      case 'upper-alpha': return alphaOf(n) + '.';
      case 'lower-roman': return romanOf(n).toLowerCase() + '.';
      case 'upper-roman': return romanOf(n) + '.';
      default: return n + '.';
    }
  }

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
   * Die Ausrichtung eines Absatzes, als Wert für w:jc.
   *
   * Sie steht als Klasse am Block (ui/toolbar.js) und nicht als style:
   * von einem style bleibt beim Bereinigen allein die Farbe stehen
   * (core/sanitize.js). Linksbündig hat keine Klasse – das ist der
   * Zustand ohne Auszeichnung – und braucht in Word auch kein w:jc.
   */
  function ausrichtungVon(el) {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (cls.includes('j-align-center')) return 'center';
    if (cls.includes('j-align-right')) return 'right';
    if (cls.includes('j-align-justify')) return 'both';   // so heißt Blocksatz in OOXML
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════
     ABSTAND STATT LEERZEICHEN – UND IN WORD ECHTE EINZÜGE

     Wer in Inkwells irgendwohin klickt und dort schreibt, bekommt seit
     der Umstellung keinen Block aus Leerzeichen mehr, sondern einen
     Einzug am Absatz (canvas/text.js). Word kennt genau das:

       margin-left  ->  w:ind w:left
       margin-top   ->  w:spacing w:before

     Das ist TREUER als vorher. Die Leerzeichen kamen in Words Schrift
     anders heraus als in Inkwells – der Text stand im Export immer ein
     Stück woanders. Ein Einzug ist ein Mass und überall dasselbe.
     ══════════════════════════════════════════════════════════════════ */
  function pxAusStil(el, name) {
    const wert = el && el.style ? el.style[name] : '';
    const zahl = Number.parseFloat(String(wert || ''));
    return Number.isFinite(zahl) && zahl > 0 ? zahl : 0;
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

    /* Unterkante des zuletzt gesehenen frei stehenden Absatzes, in
       Seiten-Pixeln – oder null, solange keiner kam. Daraus wird sein
       Abstand zum naechsten (siehe unten). Eine Zeilenhoehe genuegt als
       Mass: mehrzeilige freie Absaetze sind selten, und der Fehler
       waere ein zu grosser Abstand, kein verlorener Text. */
    let letzteFreiUnten = null;
    const FREI_ZEILE_PX = 32;

    const openParagraph = (style) => {
      current = { style, runs: [] };
      paragraphs.push(current);
      return current;
    };
    const ensureParagraph = () => current || openParagraph('body');

    /**
     * Die Absätze, die in einer Zelle stehen.
     *
     * walk() hängt an dieselbe Liste an wie alles andere – die neu
     * entstandenen Absätze werden deshalb hinten wieder abgeschnitten.
     * Ein eigener Sammler dafür wäre eine zweite Fassung derselben
     * Schleife, und die liefe beim nächsten Zusatz auseinander.
     */
    const zelleAbsaetze = (zelle, format) => {
      const bisher = paragraphs.length;
      const vorher = current;
      current = null;
      walk(zelle, format, null);
      const neue = paragraphs.splice(bisher);
      current = vorher;

      /* Eine Tabelle in einer Tabelle geht nicht – Word kann es, dieser
         Weg nicht. Ihr Inhalt bleibt als Absätze erhalten, statt still
         zu verschwinden. */
      const flach = [];
      for (const e of neue) {
        if (!e.tabelle) { flach.push(e); continue; }
        for (const zeile of e.tabelle.zeilen) {
          for (const z of zeile) flach.push(...z.absaetze);
        }
      }
      // Word verlangt in jeder Zelle mindestens einen Absatz
      return flach.length ? flach : [{ style: 'body', runs: [] }];
    };

    /** Die Zeilen einer Tabelle, ohne die einer verschachtelten. */
    const tabellenZeilen = (tabelle, format) => {
      const zeilen = [];
      const reihen = [];
      for (const teil of tabelle.children) {
        if (teil.tagName === 'TR') reihen.push(teil);
        else if (/^(THEAD|TBODY|TFOOT)$/.test(teil.tagName)) {
          for (const tr of teil.children) if (tr.tagName === 'TR') reihen.push(tr);
        }
      }
      for (const tr of reihen) {
        const zellen = [];
        for (const td of tr.children) {
          if (td.tagName !== 'TD' && td.tagName !== 'TH') continue;
          zellen.push({
            kopf: td.tagName === 'TH',
            spannt: Math.max(1, parseInt(td.getAttribute('colspan'), 10) || 1),
            absaetze: zelleAbsaetze(td, format)
          });
        }
        if (zellen.length) zeilen.push(zellen);
      }
      return zeilen;
    };

    /**
     * @param {object} [liste] die Liste, in der wir gerade stecken:
     *        { depth, styleId, n } – n zählt die Punkte DIESER Liste
     */
    const walk = (node, format, liste) => {
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

        /* ══ EIN VERWEIS BLEIBT EIN VERWEIS ═══════════════════════════
           Bisher lief walk() durch ein <a> hindurch wie durch ein
           <span>: der Text kam mit, die Adresse blieb liegen. Im
           Word-Dokument stand danach ein Wort, das einmal anklickbar
           war – im PDF-Export dagegen (core/importExport.js schreibt
           HTML) ist der Verweis erhalten. Zwei Ausgabewege, zwei
           verschiedene Ergebnisse.

           Die Adresse wandert am Lauf mit; erst paragraphXml macht
           daraus ein <w:hyperlink> samt Beziehung, denn nur dort gibt
           es den Zähler dafür.

           Eine Seitenmarke (inkwells://page/7) wird bewusst NICHT
           mitgenommen: sie zeigt auf eine Seite dieses Hefts, und die
           gibt es in Word nicht. Sie bliebe ein Verweis, der ins Leere
           führt oder, schlimmer, die App aufruft. Ihr Text bleibt
           stehen, wie bisher. */
        if (tag === 'A') {
          const ziel = child.getAttribute && child.getAttribute('href');
          if (ziel && /^(https?:|mailto:)/i.test(ziel.trim())) next.link = ziel.trim();
        }

        /* ══ EINE TABELLE IST IN WORD EINE TABELLE ══════════════════
           Bisher lief walk() einfach durch sie hindurch. Herauskam eine
           Reihe von Textstücken in einem Absatz: "MeilensteinSollIst" –
           die Tabelle war weg, und im Word-Dokument stand ihr Inhalt als
           Fließtext ohne jede Trennung. Genau so wurde es gemeldet.

           Sie wird deshalb als eigener Eintrag gesammelt und später zu
           einem echten w:tbl (tabelleXml). */
        if (tag === 'TABLE') {
          const zeilen = tabellenZeilen(child, next);
          if (zeilen.length) {
            current = null;
            paragraphs.push({ tabelle: { zeilen } });
          }
          continue;
        }

        /* Eine Liste ist selbst kein Absatz, sondern die Hülle um ihre
           Punkte. Sie merkt sich nur, auf welcher Ebene wir sind und
           welche Marke gilt. */
        if (tag === 'UL' || tag === 'OL') {
          const tiefe = (liste ? liste.depth : 0) + 1;
          current = null;
          walk(child, next, { depth: tiefe, styleId: listStyleIdOf(child, tiefe), n: 0 });
          current = null;
          continue;
        }

        /* ── Der Abstandshalter mitten in einer Zeile ──────────────────
           In Inkwells ist er ein leeres Element mit einer Breite
           (canvas/text.js). Word kennt so etwas nicht: dort gibt es
           mitten in einer Zeile nur Zeichen und Tabulatoren, und ein
           Tabulator bräuchte einen Anschlag an einer Stelle, die sich
           hier nicht ausrechnen lässt (sie hängt davon ab, wie breit
           der Text davor in WORDS Schrift wird).

           Also Leerzeichen – aber nur hier, im Ausgegebenen. Im Heft
           selbst steht weiterhin kein einziges. Das ist der Punkt der
           ganzen Umstellung: der Verlust bleibt in der Kopie, statt im
           Original zu stehen. */
        if (tag === 'SPAN' && child.classList && child.classList.contains('j-luecke')) {
          const px = pxAusStil(child, 'width');
          if (px > 0) {
            const anzahl = Math.max(1, Math.min(120, Math.round(px / LUECKE_ZEICHEN_PX)));
            ensureParagraph().runs.push({ ...format, text: ' '.repeat(anzahl) });
          }
          continue;
        }

        /* ══ EIN CODEBLOCK IST IN WORD EIN CODEBLOCK ═══════════════
           Word kennt keinen eigenen Typ dafür. Was es kennt, ist ein
           Absatz mit fester Schrift und Hinterlegung – und genau so
           sieht ein Codelisting in jedem Lehrbuch aus.

           Jede ZEILE wird ein eigener Absatz. Ein einzelner mit
           Umbrüchen darin ginge auch, aber dann liesse sich in Word
           keine Zeile einzeln anfassen, und beim Zurücklesen käme
           alles als ein Klumpen an.

           Die Einfärbung kommt NICHT mit: im Heft steht nackter Code
           (core/code.js), die Farben liegen nur darüber. Sie hier
           nachzubauen hiesse, den Einfärber ein zweites Mal zu
           schreiben – für ein Word-Dokument, in dem man den Code
           ohnehin weiterbearbeitet. */
        if (tag === 'PRE' && child.classList && child.classList.contains('j-code')) {
          const zeilen = (child.textContent || '').replace(/\n$/, '').split('\n');
          for (const zeile of zeilen) {
            const p = openParagraph('code');
            p.code = true;
            if (zeile) p.runs.push({ ...format, text: zeile, code: true });
          }
          current = null;
          continue;
        }

        if (BLOCK_TAGS.has(tag)) {
          const absatz = openParagraph(paragraphStyleOf(child));
          absatz.align = ausrichtungVon(child);
          // Wo der Klick hingezeigt hat – siehe pxAusStil
          absatz.einzugPx = pxAusStil(child, 'marginLeft');
          absatz.obenPx = pxAusStil(child, 'marginTop');

          /* ── Ein frei stehender Absatz ────────────────────────────
             Er traegt seine Lage absolut (left/top), Word kennt aber
             nur Abstaende von einem Absatz zum naechsten. Umgerechnet
             wird deshalb in den ABSTAND zum vorigen freien Absatz –
             bei einer Seite, die nur aus Klicks entstanden ist (der
             uebliche Fall), kommt der Text damit in Word auf dieselben
             Zeilen wie im Heft. */
          if (child.classList && child.classList.contains('j-frei')) {
            const obenAbs = pxAusStil(child, 'top');
            absatz.einzugPx = pxAusStil(child, 'left');
            absatz.obenPx = Math.max(0, obenAbs - (letzteFreiUnten === null ? obenAbs : letzteFreiUnten));
            letzteFreiUnten = obenAbs + FREI_ZEILE_PX;
          }

          if (tag === 'LI' && liste) {
            liste.n++;
            absatz.indentPx = liste.depth * LIST_INDENT_PX;
            absatz.runs.push({ ...next, text: listMarkerOf(liste.styleId, liste.n) });
            absatz.runs.push({ ...next, tab: true });
          }

          walk(child, next, liste);
          // Text, der NACH einem Block kommt, gehört in einen neuen Absatz
          current = null;
        } else {
          walk(child, next, liste);
        }
      }
    };

    walk(root, {}, null);

    // Reine Hüllen ohne Inhalt (verschachtelte divs) fallen weg; ein
    // <div><br></div> hat einen Umbruch-Lauf und bleibt als Leerzeile stehen.
    /* Eine Tabelle hat keine Laeufe – sie faellt sonst genau hier
       heraus, und zwar still. */
    return paragraphs.filter(p => p.tabelle || p.runs.length > 0);
  }

  /* ══════════════════════════════════════════════════════════════════
     OOXML
     ══════════════════════════════════════════════════════════════════ */

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
    + 'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';

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
      /* Ein Codeblock: feste Schrittweite, etwas kleiner, hinterlegt.
         Consolas ist auf jedem Windows da; Courier New als Rückfall
         auf allem anderen. */
      case 'code':
        return {
          font: 'Consolas', fallback: 'Courier New',
          size: halfPoints(Math.round(BASE_FONT_PX * 0.82)),
          italic: false, bold: false, color: '1F1F1F', border: false
        };
      default:
        return {
          font: 'Crimson Pro', fallback: 'Georgia',
          size: halfPoints(BASE_FONT_PX),
          italic: false, bold: false, color: TEXT_COLOR, border: false
        };
    }
  }

  /* Der graue Grund hinter einem Codeblock. Als w:shd am Absatz – so
     reicht er über die ganze Zeilenbreite, wie ein Listing im Buch, und
     nicht nur hinter den Zeichen. */
  const CODE_GRUND = 'F2F0EB';

  /* Die Reihenfolge in <w:rPr> ist im Schema festgelegt (CT_RPr):
     rFonts, b, i, strike, color, sz, szCs, u. Word verzeiht Abweichungen
     meist, andere Programme (LibreOffice, Google Docs) nicht immer. */
  /* Wie Word einen Verweis malt, wenn keine Formatvorlage da ist: blau
     und unterstrichen. Eine Vorlage („Hyperlink") waere der uebliche
     Weg, hiesse aber styles.xml anzulegen – und ihr Name ist in jeder
     Word-Sprache ein anderer. Die zwei Angaben sind ueberall dieselben. */
  const LINK_FARBE = '0563C1';

  function runXml(run, spec) {
    const props = [];
    props.push(`<w:rFonts w:ascii="${esc(spec.font)}" w:hAnsi="${esc(spec.font)}" w:cs="${esc(spec.font)}"/>`);
    if (run.bold || spec.bold) props.push('<w:b/>');
    if (run.italic || spec.italic || spec.italicToo) props.push('<w:i/>');
    if (run.strike) props.push('<w:strike/>');
    props.push(`<w:color w:val="${esc(run.link ? LINK_FARBE : (run.color || spec.color))}"/>`);
    props.push(`<w:sz w:val="${spec.size}"/><w:szCs w:val="${spec.size}"/>`);
    if (run.underline || run.link) props.push('<w:u w:val="single"/>');

    const rPr = `<w:rPr>${props.join('')}</w:rPr>`;

    if (run.lineBreak) return `<w:r>${rPr}<w:br/></w:r>`;
    // Der Sprung von der Marke zum Text einer Aufzählung
    if (run.tab) return `<w:r>${rPr}<w:tab/></w:r>`;
    return `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
  }

  /** Das Vollseiten-Bild, frei positioniert und hinter dem Text. */
  /* ══════════════════════════════════════════════════════════════════
     WER LIEGT VOR WEM

     Word stapelt frei hängende Objekte nach relativeHeight: höher heisst
     weiter vorn. Hier stand für das Seitenbild eine feste 0 – und eine 0
     liest Word wie "nicht gesetzt". Das Papier landete damit je nach
     Fassung irgendwo im Stapel, im schlimmsten Fall VOR der Handschrift,
     und die war dann unter einem deckenden Blatt nicht mehr zu sehen.
     Genau so wurde es gemeldet.

     Jede Stelle bekommt deshalb eine eigene, aufsteigende Zahl aus einem
     Zähler, und der beginnt bei derselben Basis, die Word selbst
     benutzt. Das Papier zieht als Erstes und liegt damit ganz hinten.
     ══════════════════════════════════════════════════════════════════ */
  const Z_BASIS = 251658240;      // 0x0F000000, wie Word es schreibt

  function anchorXml(id, relationshipId, widthPx, heightPx, hoehe) {
    const cx = Math.round(widthPx * EMU_PER_PX);
    const cy = Math.round(heightPx * EMU_PER_PX);

    return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>'
      + '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" '
      + `relativeHeight="${hoehe}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">`
      + '<wp:simplePos x="0" y="0"/>'
      + '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>'
      + '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>'
      + `<wp:extent cx="${cx}" cy="${cy}"/>`
      + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
      + '<wp:wrapNone/>'
      + `<wp:docPr id="${id}" name="Inkwells-Seite ${id}"/>`
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

    // Reihenfolge nach CT_PPr: pBdr, tabs, spacing, ind, jc, sectPr.
    // Word ist da streng – steht jc vor ind, öffnet die Datei gar nicht.
    const props = [];
    if (spec.border) {
      props.push(`<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="${PAPER_LINE.slice(1).toUpperCase()}"/></w:pBdr>`);
    }

    /* Ein Punkt einer Aufzählung: der Text rückt ein, die Marke steht
       davor (hängender Einzug). Der Tabulator dazwischen braucht einen
       Anschlag genau am Textrand, sonst springt er auf Words
       Voreinstellung und die Marke steht zu weit links. */
    const einzug = Math.round((paragraph.indentPx || 0) * TWIPS_PER_PX);
    if (einzug) props.push(`<w:tabs><w:tab w:val="left" w:pos="${einzug}"/></w:tabs>`);

    /* Der Abstand nach oben, den ein Klick weiter unten gesetzt hat.
       Er steht in ganzen Zeilenhöhen (canvas/text.js) und kommt damit in
       Word auf dieselben Zeilen wie im Heft. */
    const oben = Math.round((paragraph.obenPx || 0) * TWIPS_PER_PX);
    props.push(`<w:spacing w:before="${oben}" w:after="0" w:line="${Math.round(lh * TWIPS_PER_PX)}" w:lineRule="exact"/>`);

    /* Der Einzug eines Aufzählungspunktes hängt (die Marke steht davor);
       der Einzug aus einem Klick ist ein gewöhnlicher linker Einzug.
       Beides zugleich kommt nicht vor – ein Listenpunkt entsteht nicht
       aus einem Klick ins Leere. */
    const klickEinzug = Math.round((paragraph.einzugPx || 0) * TWIPS_PER_PX);
    props.push(einzug
      ? `<w:ind w:left="${einzug}" w:right="0" w:hanging="${Math.round(LIST_HANGING_PX * TWIPS_PER_PX)}"/>`
      : `<w:ind w:left="${klickEinzug}" w:right="0" w:firstLine="0"/>`);
    if (paragraph.align) props.push(`<w:jc w:val="${paragraph.align}"/>`);

    /* ── Eine Überschrift ist auch in Word eine Überschrift ───────────
       Bisher wurde nur ihr Aussehen geschrieben – größer, kursiv, mit
       Strich darunter. Für Word war das ein gewöhnlicher Absatz, der
       zufällig groß aussieht: nicht im Navigationsbereich, nicht im
       Inhaltsverzeichnis, und beim Zurücklesen nicht wiederzuerkennen
       (core/docxImport.js). Die Gliederungsebene sagt es ausdrücklich.

       Direkt am Absatz und nicht über eine Formatvorlage: eine Vorlage
       müsste in styles.xml angelegt und benannt werden, und ihr Name
       ist in jeder Word-Sprache ein anderer. w:outlineLvl ist eine
       Zahl und überall dieselbe. */
    const ebene = { h1: 0, h2: 1, h3: 2 }[paragraph.style];
    if (ebene !== undefined) props.push(`<w:outlineLvl w:val="${ebene}"/>`);

    /* Der Grund hinter einer Codezeile. Nach CT_PPr steht w:shd hinter
       jc und vor sectPr – Word ist da streng, in der falschen
       Reihenfolge öffnet es die Datei gar nicht. */
    if (paragraph.code) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${CODE_GRUND}"/>`);

    if (options.sectPr) props.push(options.sectPr);

    /* ── Verweise zusammenfassen ───────────────────────────────────────
       Aufeinanderfolgende Läufe mit derselben Adresse gehören in EIN
       <w:hyperlink>. Sonst bekäme jedes Wort eines Verweises einen
       eigenen – Word zeigt das zwar an, aber beim Anklicken springt der
       Mauszeiger von Stück zu Stück, und beim Zurücklesen entstünden
       ebenso viele Verweise.

       options.verweis liefert die Beziehungskennung; ohne den Rückruf
       (Tabellenzellen rufen paragraphXml ohne options) bleibt es beim
       blossen Text – lieber ein toter Verweis als eine Datei, die Word
       wegen einer fehlenden Beziehung gar nicht erst öffnet. */
    let runs = options.leadingXml || '';
    const laeufe = paragraph.runs || [];
    for (let i = 0; i < laeufe.length; i++) {
      const ziel = laeufe[i].link;
      if (!ziel || typeof options.verweis !== 'function') {
        runs += runXml(laeufe[i], spec);
        continue;
      }
      let bis = i;
      while (bis + 1 < laeufe.length && laeufe[bis + 1].link === ziel) bis++;
      const inhalt = laeufe.slice(i, bis + 1).map(r => runXml(r, spec)).join('');
      const rId = options.verweis(ziel);
      runs += rId ? `<w:hyperlink r:id="${rId}">${inhalt}</w:hyperlink>` : inhalt;
      i = bis;
    }

    return `<w:p><w:pPr>${props.join('')}</w:pPr>${runs}</w:p>`;
  }

  /* ══════════════════════════════════════════════════════════════════
     EIN OBJEKT AN SEINER STELLE AUF DER SEITE

     Bild wie Form hängen frei auf dem Blatt (wp:anchor, relativ zur
     Seite) – genau dort, wo sie im Heft liegen. Sie nehmen keinen Platz
     im Text ein; der Text steht darunter weiter, so wie im Heft auch.

     >>> Warum vor und nicht hinter dem Text <<<
     Im Heft liegen Objekte über dem Textfeld (canvas/objects.js,
     z-index 2000), und ein Bild deckt dort zu, was darunter steht.
     behindDoc="0" hält das ein. Nur ein Objekt der hinteren Ebene
     (layer 'back') geht nach hinten – dafür ist die Ebene da.
     ══════════════════════════════════════════════════════════════════ */

  /** Die gemeinsame Hülle: Lage, Grösse, Ebene. */
  function objektAnkerXml(id, obj, inhaltXml, name, hoehe) {
    const x = Math.max(0, Math.round((obj.x || 0) * EMU_PER_PX));
    const y = Math.max(0, Math.round((obj.y || 0) * EMU_PER_PX));
    const cx = Math.max(1, Math.round((obj.w || 100) * EMU_PER_PX));
    const cy = Math.max(1, Math.round((obj.h || 100) * EMU_PER_PX));
    const hinten = obj.layer === 'back' ? '1' : '0';

    return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>'
      + '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" '
      + `relativeHeight="${hoehe}" behindDoc="${hinten}" locked="0" layoutInCell="0" allowOverlap="1">`
      + '<wp:simplePos x="0" y="0"/>'
      + `<wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH>`
      + `<wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV>`
      + `<wp:extent cx="${cx}" cy="${cy}"/>`
      + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
      + '<wp:wrapNone/>'
      + `<wp:docPr id="${id}" name="${esc(name)}"/>`
      + inhaltXml(cx, cy)
      + '</wp:anchor></w:drawing></w:r>';
  }

  /** Ein Bild aus dem Heft. */
  function bildAnkerXml(id, obj, relationshipId, hoehe) {
    /* Die Drehung steht in Sechzigsteln eines Grades; im Heft sind es
       Grad (canvas/objects.js). */
    const dreh = obj.rot ? ` rot="${Math.round(obj.rot * 60000)}"` : '';
    return objektAnkerXml(id, obj, (cx, cy) =>
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="0"/></wp:cNvGraphicFramePr>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + '<pic:pic>'
      + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(obj.name || 'Bild')}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm${dreh}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
      + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
      + '</pic:pic></a:graphicData></a:graphic>',
      obj.name || 'Bild', hoehe);
  }

  /* Die fünf Formen des Hefts (canvas/shapes.js) in Words Sprache. */
  const FORM_NACH_WORD = {
    rect: 'rect', ellipse: 'ellipse', triangle: 'triangle',
    line: 'line', arrow: 'line'
  };

  /** Eine Form aus dem Heft – als Form, nicht als Bild davon. */
  function formAnkerXml(id, obj, hoehe) {
    const prst = FORM_NACH_WORD[obj.shapeType] || 'rect';
    const fuellung = toHexColor(obj.fill);
    const strich = toHexColor(obj.stroke);
    const breite = Math.max(1, Math.round((obj.strokeWidth || 2) * EMU_PER_PX));

    /* Eine Linie zeigt in Word von links oben nach rechts unten; die
       Enden des Hefts liegen als Anteile im Rechteck (shapeEnden). Aus
       ihrer Richtung werden die beiden Spiegelungen. */
    const p1 = obj.p1 || { x: 0, y: 1 };
    const p2 = obj.p2 || { x: 1, y: 0 };
    const gerade = prst === 'line';
    const spiegel = gerade
      ? ((p2.x - p1.x) < 0 ? ' flipH="1"' : '') + ((p2.y - p1.y) < 0 ? ' flipV="1"' : '')
      : '';
    const dreh = obj.rot ? ` rot="${Math.round(obj.rot * 60000)}"` : '';

    // Ein Pfeil ist eine Linie mit Spitze – Word setzt sie an den Strich
    const spitze = obj.shapeType === 'arrow'
      ? '<a:tailEnd type="triangle" w="med" len="med"/>' : '';

    return objektAnkerXml(id, obj, (cx, cy) =>
      '<wp:cNvGraphicFramePr/>'
      + '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
      + '<wps:wsp>'
      + `<wps:cNvSpPr/>`
      + `<wps:spPr><a:xfrm${dreh}${spiegel}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
      + `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>`
      + (fuellung ? `<a:solidFill><a:srgbClr val="${fuellung}"/></a:solidFill>` : '<a:noFill/>')
      + (strich
        ? `<a:ln w="${breite}"><a:solidFill><a:srgbClr val="${strich}"/></a:solidFill>${spitze}</a:ln>`
        : '<a:ln><a:noFill/></a:ln>')
      + '</wps:spPr>'
      + '<wps:bodyPr rot="0" anchor="ctr"/>'
      + '</wps:wsp></a:graphicData></a:graphic>',
      'Form', hoehe);
  }

  /* ══════════════════════════════════════════════════════════════════
     EINE TABELLE ALS w:tbl

     Die Spalten teilen sich die Textbreite zu gleichen Teilen. Word
     rechnet sie beim Öffnen selbst nach dem Inhalt um (tblLayout
     autofit) – eine genaue Breite je Spalte müsste hier gemessen
     werden, und gemessen wird an dieser Stelle nichts.

     Die Kopfzeile wird als solche gekennzeichnet (w:tblHeader): läuft
     die Tabelle über die Seite hinaus, wiederholt Word sie oben. Genau
     das macht der Seitenumbruch im Heft auch (core/docxPaginate.js).
     ══════════════════════════════════════════════════════════════════ */

  /* Die nutzbare Textbreite einer Heftseite – wie in css/pages.css. */
  const TEXT_BREITE_PX = DEFAULT_PAGE_W - 72 - 32;
  const TABELLE_RAHMEN = 'D9D2C4';

  function tabelleXml(tabelle, lh, verweis) {
    let spalten = 1;
    for (const zeile of tabelle.zeilen) {
      const n = zeile.reduce((s, z) => s + z.spannt, 0);
      if (n > spalten) spalten = n;
    }
    const spaltenBreite = Math.round(TEXT_BREITE_PX * TWIPS_PER_PX / spalten);

    const kante = (name) =>
      `<w:${name} w:val="single" w:sz="4" w:space="0" w:color="${TABELLE_RAHMEN}"/>`;

    const rahmen = '<w:tblBorders>'
      + kante('top') + kante('left') + kante('bottom') + kante('right')
      + kante('insideH') + kante('insideV')
      + '</w:tblBorders>';

    const kopf = '<w:tblPr>'
      + '<w:tblW w:w="0" w:type="auto"/>'
      + '<w:tblLayout w:type="autofit"/>'
      + rahmen
      + '<w:tblCellMar>'
      + '<w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
      + '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/>'
      + '</w:tblCellMar></w:tblPr>'
      + '<w:tblGrid>' + `<w:gridCol w:w="${spaltenBreite}"/>`.repeat(spalten) + '</w:tblGrid>';

    const zeilen = tabelle.zeilen.map((zeile, nr) => {
      const istKopfzeile = zeile.every(z => z.kopf);
      const zellen = zeile.map(z => {
        const breite = spaltenBreite * z.spannt;
        const eigenschaften = '<w:tcPr>'
          + `<w:tcW w:w="${breite}" w:type="dxa"/>`
          + (z.spannt > 1 ? `<w:gridSpan w:val="${z.spannt}"/>` : '')
          + (z.kopf ? '<w:shd w:val="clear" w:color="auto" w:fill="F4F0E6"/>' : '')
          + '<w:vAlign w:val="center"/>'
          + '</w:tcPr>';
        /* Eine Kopfzelle steht fett – im Heft macht das die Papierregel
           (css/pages.css, th), in Word muss es am Text stehen. */
        const inhalt = z.absaetze
          .map(a => paragraphXml(z.kopf ? { ...a, runs: a.runs.map(r => ({ ...r, bold: true })) } : a, lh, { verweis }))
          .join('');
        return `<w:tc>${eigenschaften}${inhalt}</w:tc>`;
      }).join('');

      const zeilenkopf = (istKopfzeile && nr === 0)
        ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '';
      return `<w:tr>${zeilenkopf}${zellen}</w:tr>`;
    }).join('');

    return `<w:tbl>${kopf}${zeilen}</w:tbl>`;
  }

  /* ══════════════════════════════════════════════════════════════════
     ZUSAMMENBAU
     ══════════════════════════════════════════════════════════════════ */

  /**
   * @param {Array} entries  je Seite ein Eintrag:
   *   { page, bg }
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

    /* Kennungen laufen jetzt über das ganze Dokument: neben den Seiten
       hängt an jedem Bild eine eigene Datei, und zwei Objekte mit
       derselben Kennung öffnet Word gar nicht erst. */
    let relZaehler = 0;
    let ankerZaehler = 0;
    let zZaehler = 0;
    const naechsteRel = () => `rId${++relZaehler}`;

    /* ══════════════════════════════════════════════════════════════════
       EINE BEZIEHUNG JE ADRESSE, NICHT JE VERWEIS

       Ein Verweis nach draussen ist in OOXML eine Beziehung mit
       TargetMode="External"; im Text steht nur ihre Kennung. Dieselbe
       Adresse zweimal anzulegen ginge zwar, blaeht die Datei aber auf –
       und in einem Heft steht derselbe Link oft auf mehreren Seiten.

       Die Adresse wird escaped: sie landet als Attribut im XML, und ein
       & in einer Suchadresse (?a=1&b=2) macht die Datei sonst
       unlesbar. Word oeffnet sie dann gar nicht erst. */
    const verweisRels = new Map();
    const verweisRel = (adresse) => {
      const ziel = String(adresse || '').trim();
      if (!ziel) return '';
      if (verweisRels.has(ziel)) return verweisRels.get(ziel);
      const rId = naechsteRel();
      verweisRels.set(ziel, rId);
      relationships.push(
        `<Relationship Id="${rId}" `
        + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
        + `Target="${esc(ziel)}" TargetMode="External"/>`
      );
      return rId;
    };
    // Wer später zieht, liegt weiter vorn – das Papier zieht als Erstes
    const naechsteHoehe = () => Z_BASIS + (++zZaehler);

    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const lh = lhForBg(entry.bg);

      const image = await renderPageImage(entry, scale);
      const width = entry.page.w || DEFAULT_PAGE_W;
      const height = entry.page.h || DEFAULT_PAGE_H;

      let anchor = '';
      if (!image) {
        /* Kein Muster, nichts drauf – aber die Farbe des Papiers gehört
           trotzdem hin. Als Form statt als Bild: sie kostet keine
           einzige Datei im Archiv und lässt sich in Word anklicken und
           wegnehmen, wenn jemand doch ein weisses Blatt will. */
        anchor = formAnkerXml(++ankerZaehler, {
          shapeType: 'rect', x: 0, y: 0, w: width, h: height,
          fill: papierFarbe(entry.bg), stroke: 'none', strokeWidth: 0, layer: 'back'
        }, naechsteHoehe());
      }
      if (image) {
        const relationshipId = naechsteRel();
        const fileName = `seite${i + 1}.${image.extension}`;

        media.push({ name: `word/media/${fileName}`, data: dataUrlToBytes(image.dataUrl) });
        relationships.push(
          `<Relationship Id="${relationshipId}" `
          + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
          + `Target="media/${fileName}"/>`
        );
        anchor = anchorXml(++ankerZaehler, relationshipId, width, height, naechsteHoehe());
      }

      /* Die Handschrift kommt gleich nach dem Papier – und VOR den
         Text.

         >>> Warum nicht dahinter, wie im Heft <<<
         Dahinter teilt sie sich die Ebene mit dem Papier, und das ist
         ein deckendes Blatt. Stimmt die Stapelreihenfolge dort auch nur
         einmal nicht, ist die Handschrift verschwunden – und niemand
         sucht sie unter dem Papier. Vor dem Text ist sie immer zu sehen.
         Ihr Preis ist gering: ein Textmarker ist ohnehin durchsichtig
         gemalt (drawInk, Alpha 0.38), und ein Stift, mit dem jemand
         ueber ein Wort gestrichen hat, soll darauf liegen. */
      const schrift = await renderInkImage(entry.page, scale);
      if (schrift) {
        const kennung = ++ankerZaehler;
        const schriftRel = naechsteRel();
        const schriftDatei = `schrift${kennung}.png`;

        media.push({ name: `word/media/${schriftDatei}`, data: dataUrlToBytes(schrift.dataUrl) });
        relationships.push(
          `<Relationship Id="${schriftRel}" `
          + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
          + `Target="media/${schriftDatei}"/>`
        );
        anchor += bildAnkerXml(kennung,
          { ...schrift, name: 'Handschrift' }, schriftRel, naechsteHoehe());
      }

      /* Die Code-Kaesten dieser Seite. Sie werden unten als Absaetze
         angehaengt, nicht als frei haengendes Ding – siehe der Kasten
         beim obj.kind === 'code'. */
      const codeAbsaetze = [];

      /* Jedes Objekt der Seite als eigenes Ding: ein Bild bekommt seine
         eigene Datei im Archiv, eine Form braucht gar keine. Beide
         hängen anschliessend am selben Absatz wie das Seitenbild – sie
         sitzen ohnehin frei auf der Seite. */
      for (const obj of (entry.page.objects || [])) {
        if (!obj) continue;
        const kennung = ++ankerZaehler;

        if (obj.kind === 'shape') {
          anchor += formAnkerXml(kennung, obj, naechsteHoehe());
          continue;
        }

        /* ══ EIN CODE-KASTEN WIRD IN WORD ZU CODE-ABSÄTZEN ═══════════
           Er hängt im Heft frei auf dem Blatt (core/code.js), Word
           bekommt ihn aber als Folge von Absätzen in fester Schrift mit
           Hinterlegung – dieselbe Darstellung, die htmlToParagraphs für
           einen Codeblock erzeugt.

           >>> Warum nicht als Bild an seiner Stelle <<<
           Weil man Code in Word weiterverwenden will: kopieren, in eine
           Arbeit einfügen, weiterschreiben. Ein Bild davon ist tot. Der
           Preis ist die Lage – der Kasten steht danach im Textfluss und
           nicht mehr genau dort, wo er auf dem Blatt lag. Für einen
           Ausdruck mit genauer Lage gibt es das PDF, dort steht er, wo
           er hingehört (core/importExport.js). */
        if (obj.kind === 'code') {
          codeAbsaetze.push(obj);
          continue;
        }

        if (!obj.src) continue;          // Formeln haben kein Bild
        const bytes = dataUrlToBytes(obj.src);
        if (!bytes || !bytes.length) continue;

        const endung = /^data:image\/(png|jpe?g|gif|webp|bmp)/i.exec(obj.src);
        const dateiname = `bild${kennung}.${(endung ? endung[1] : 'png').replace('jpg', 'jpeg')}`;
        const bildRel = naechsteRel();

        media.push({ name: `word/media/${dateiname}`, data: bytes });
        relationships.push(
          `<Relationship Id="${bildRel}" `
          + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
          + `Target="media/${dateiname}"/>`
        );
        anchor += bildAnkerXml(kennung, obj, bildRel, naechsteHoehe());
      }

      const paragraphs = htmlToParagraphs(entry.page.textContent);

      /* Die Code-Kaesten hinter den Text der Seite. Jede Zeile ein
         eigener Absatz, damit sie sich in Word einzeln anfassen laesst. */
      for (const kasten of codeAbsaetze) {
        const zeilen = String(kasten.code || '').replace(/\n$/, '').split('\n');
        for (const zeile of zeilen) {
          const p = { style: 'code', runs: [], code: true };
          if (zeile) p.runs.push({ text: zeile, code: true });
          paragraphs.push(p);
        }
      }
      // Das Seitenbild hängt am ersten Absatz. Ein frei positioniertes Bild
      // nimmt keinen Platz im Textfluss ein – ein eigener Absatz dafür würde
      // dagegen jede Seite um eine Leerzeile nach unten schieben.
      if (!paragraphs.length) paragraphs.push({ style: 'body', runs: [] });

      /* Eine Tabelle kann weder das Seitenbild noch die Abschnittsangabe
         tragen – beide gehören in einen Absatz. Und nach der letzten
         Tabelle muss ohnehin einer stehen, sonst öffnet Word die Datei
         gar nicht erst. */
      if (paragraphs[paragraphs.length - 1].tabelle) {
        paragraphs.push({ style: 'body', runs: [] });
      }
      let ankerBei = paragraphs.findIndex(p => !p.tabelle);
      if (ankerBei < 0) ankerBei = paragraphs.length - 1;

      // Die Abschnittsangaben stehen beim letzten Absatz der Seite; dadurch
      // beginnt die nächste Seite automatisch neu, ganz ohne Seitenumbruch.
      const isLast = i === list.length - 1;

      paragraphs.forEach((paragraph, index) => {
        if (paragraph.tabelle) {
          body.push(tabelleXml(paragraph.tabelle, lh, verweisRel));
          return;
        }
        body.push(paragraphXml(paragraph, lh, {
          leadingXml: index === ankerBei ? anchor : '',
          sectPr: (!isLast && index === paragraphs.length - 1) ? sectionXml(entry) : '',
          verweis: verweisRel
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
      + `<dc:title>${esc(options.title || 'Inkwells')}</dc:title>`
      + '<dc:creator>Inkwells</dc:creator>'
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
    return String(name || 'Inkwells').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Inkwells';
  }

  global.InkwellsDocx = { build, safeFileName, htmlToParagraphs, lhForBg };
})(typeof window !== 'undefined' ? window : globalThis);
