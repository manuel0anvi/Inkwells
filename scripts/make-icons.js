'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ANWENDUNGSZEICHEN FREISTELLEN

   Die Vorlage (scripts/icon-source.png) ist ein goldenes Zeichen auf
   dunklem Grund, mit Schlagschatten. Auf jeder helleren Fläche – der
   Titelleiste der Website, dem Reiter im Browser, dem Startmenü – stand
   dadurch ein dunkles Kästchen um das Zeichen herum.

   Dieses Script rechnet den Grund heraus und schreibt:
       website/icon.png   das freigestellte Zeichen, quadratisch
       website/icon.ico   dasselbe als Symboldatei für den Browser
       icon.ico           dasselbe für den Anwendungsbau (electron-builder)

   Aufruf:  node scripts/make-icons.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const png = require('./png.js');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(__dirname, 'icon-source.png');

/* ── Wie der Grund erkannt wird ──────────────────────────────────────
   Die Vorlage ist praktisch zweifarbig: der Grund liegt bei Helligkeit
   24, das Gold zwischen 120 und 215. Dazwischen liegt fast nichts (rund
   2500 von 720 000 Bildpunkten) – das sind die weichen Ränder.

   Genau dort steigt die Deckkraft an. Der Schlagschatten ist mit
   Helligkeit 17 DUNKLER als der Grund und fällt damit von selbst weg.
   ─────────────────────────────────────────────────────────────────── */

const BACKGROUND = [24, 24, 26];
const OPAQUE_FROM = 120;     // ab hier ganz deckend
const CLEAR_UNTIL = 30;      // bis hier ganz durchsichtig

const PADDING = 0.05;        // Luft ringsum, als Anteil der Kantenlänge
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Rechnet den dunklen Grund heraus und liefert echtes Alpha. */
function removeBackground(image) {
  const out = Buffer.alloc(image.data.length);
  const span = OPAQUE_FROM - CLEAR_UNTIL;

  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
    const alpha = Math.min(1, Math.max(0, (luma(r, g, b) - CLEAR_UNTIL) / span));

    if (alpha <= 0) { out[i + 3] = 0; continue; }

    /* Der Bildpunkt ist eine Mischung aus Gold und Grund. Ohne das
       Herausrechnen bliebe in jedem weichen Rand ein dunkler Saum stehen –
       auf hellem Untergrund sieht das aus wie ein schmutziger Umriss. */
    for (let c = 0; c < 3; c++) {
      const mixed = image.data[i + c];
      const pure = (mixed - BACKGROUND[c] * (1 - alpha)) / alpha;
      out[i + c] = Math.min(255, Math.max(0, Math.round(pure)));
    }
    out[i + 3] = Math.round(alpha * 255);
  }

  return { width: image.width, height: image.height, data: out };
}

/** Schneidet auf das Zeichen zu und legt es mittig auf ein Quadrat. */
function squareCrop(image) {
  let minX = image.width, minY = image.height, maxX = -1, maxY = -1;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error('Nach dem Freistellen ist nichts übrig geblieben');

  const contentW = maxX - minX + 1;
  const contentH = maxY - minY + 1;
  const side = Math.round(Math.max(contentW, contentH) * (1 + 2 * PADDING));

  const offsetX = Math.round((side - contentW) / 2);
  const offsetY = Math.round((side - contentH) / 2);
  const out = Buffer.alloc(side * side * 4);

  for (let y = 0; y < contentH; y++) {
    for (let x = 0; x < contentW; x++) {
      const from = ((minY + y) * image.width + (minX + x)) * 4;
      const to = ((offsetY + y) * side + (offsetX + x)) * 4;
      image.data.copy(out, to, from, from + 4);
    }
  }

  return { width: side, height: side, data: out };
}

/* ── Symboldatei (.ico) ──────────────────────────────────────────────
   Bis 128 Bildpunkte als BMP, die 256er als eingebettetes PNG. Genau so
   machen es die üblichen Werkzeuge: alte Windows-Fassungen verstehen im
   Symbolverzeichnis kein PNG, für 256 wäre BMP dagegen unnötig groß.
   ─────────────────────────────────────────────────────────────────── */

/** 32-Bit-BMP ohne Dateikopf, von unten nach oben, wie im ICO verlangt. */
function bmpFor(image) {
  const { width, height, data } = image;

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);   // Farb- und Maskenteil zusammen
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);          // unkomprimiert

  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const source = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const from = (source * width + x) * 4;
      const to = (y * width + x) * 4;
      pixels[to] = data[from + 2];        // Blau
      pixels[to + 1] = data[from + 1];    // Grün
      pixels[to + 2] = data[from];        // Rot
      pixels[to + 3] = data[from + 3];
    }
  }

  // Die Maske wird bei 32 Bit nicht ausgewertet, muss aber dastehen.
  const maskStride = Math.ceil(width / 8 / 4) * 4;
  const mask = Buffer.alloc(maskStride * height);

  return Buffer.concat([header, pixels, mask]);
}

function buildIco(entries) {
  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);

  let offset = directory.length;
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0;
    directory[at + 3] = 0;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.body.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.body.length;
  });

  return Buffer.concat([directory, ...entries.map(e => e.body)]);
}

/* ── Ablauf ─────────────────────────────────────────────────────────── */

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Vorlage fehlt: ' + path.relative(ROOT, SOURCE));
    process.exit(1);
  }

  const source = png.decode(fs.readFileSync(SOURCE));
  console.log(`Vorlage: ${source.width}×${source.height}`);

  const square = squareCrop(removeBackground(source));
  console.log(`Freigestellt und zugeschnitten: ${square.width}×${square.width}`);

  const webPng = png.resize(square, 512, 512);
  fs.writeFileSync(path.join(ROOT, 'website', 'icon.png'), png.encode(webPng));
  console.log('geschrieben: website/icon.png');

  const entries = ICO_SIZES.map(size => {
    const scaled = png.resize(square, size, size);
    return { size, body: size >= 256 ? png.encode(scaled) : bmpFor(scaled) };
  });

  const ico = buildIco(entries);
  fs.writeFileSync(path.join(ROOT, 'website', 'icon.ico'), ico);
  fs.writeFileSync(path.join(ROOT, 'icon.ico'), ico);
  console.log('geschrieben: website/icon.ico und icon.ico (' + ICO_SIZES.join(', ') + ')');
}

main();
