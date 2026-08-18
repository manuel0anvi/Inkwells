'use strict';

/* ══════════════════════════════════════════════════════════════════════
   PNG lesen und schreiben — ohne fremde Pakete

   Gebraucht von scripts/make-icons.js. Absichtlich klein gehalten: es
   muss genau das können, was das Inkwells-Zeichen verlangt — 8 Bit je
   Kanal, nicht verschachtelt, RGB oder RGBA. Alles andere lehnt es ab,
   statt still etwas Falsches zu liefern.
   ══════════════════════════════════════════════════════════════════════ */

const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ── CRC nach PNG-Spezifikation ──────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── Lesen ───────────────────────────────────────────────────────── */

/**
 * @param {Buffer} buffer
 * @returns {{width: number, height: number, data: Buffer}} data = RGBA
 */
function decode(buffer) {
  if (!buffer.slice(0, 8).equals(SIGNATURE)) throw new Error('Keine PNG-Datei');

  let width = 0, height = 0, colorType = -1;
  const idat = [];
  let offset = 8;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.slice(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8) throw new Error('Nur 8 Bit je Kanal');
      colorType = body[9];
      if (colorType !== 2 && colorType !== 6) throw new Error('Nur RGB oder RGBA');
      if (body[12] !== 0) throw new Error('Verschachtelte PNG werden nicht gelesen');
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);

  let previous = Buffer.alloc(stride);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.slice(pos, pos + stride));
    pos += stride;

    unfilter(filter, line, previous, channels);

    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = line[from];
      out[to + 1] = line[from + 1];
      out[to + 2] = line[from + 2];
      out[to + 3] = channels === 4 ? line[from + 3] : 255;
    }

    previous = line;
  }

  return { width, height, data: out };
}

/** Macht die Zeilenvorhersage rückgängig (PNG-Filter 0–4). */
function unfilter(filter, line, previous, bpp) {
  const n = line.length;

  if (filter === 0) return;

  if (filter === 1) {
    for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 0xff;
    return;
  }

  if (filter === 2) {
    for (let i = 0; i < n; i++) line[i] = (line[i] + previous[i]) & 0xff;
    return;
  }

  if (filter === 3) {
    for (let i = 0; i < n; i++) {
      const left = i >= bpp ? line[i - bpp] : 0;
      line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xff;
    }
    return;
  }

  if (filter === 4) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = previous[i];
      const c = i >= bpp ? previous[i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      line[i] = (line[i] + pred) & 0xff;
    }
    return;
  }

  throw new Error('Unbekannter Zeilenfilter: ' + filter);
}

/* ── Schreiben ───────────────────────────────────────────────────── */

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndBody), 0);
  return Buffer.concat([length, typeAndBody, crc]);
}

/**
 * Schreibt RGBA als PNG. Jede Zeile bekommt den Filter, der die kleinste
 * Summe ergibt – das ist die übliche Heuristik und spart hier gut ein
 * Drittel gegenüber „immer Filter 0".
 *
 * @param {{width: number, height: number, data: Buffer}} image
 * @returns {Buffer}
 */
function encode({ width, height, data }) {
  const stride = width * 4;
  const lines = [];
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const line = data.slice(y * stride, (y + 1) * stride);
    let best = null;

    for (let filter = 0; filter <= 4; filter++) {
      const candidate = applyFilter(filter, line, previous, 4);
      let sum = 0;
      for (let i = 0; i < candidate.length; i++) {
        const v = candidate[i];
        sum += v < 128 ? v : 256 - v;
      }
      if (!best || sum < best.sum) best = { sum, filter, candidate };
    }

    lines.push(Buffer.from([best.filter]), best.candidate);
    previous = line;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;     // Bit je Kanal
  ihdr[9] = 6;     // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(Buffer.concat(lines), { level: 9 });

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function applyFilter(filter, line, previous, bpp) {
  const n = line.length;
  const out = Buffer.alloc(n);

  for (let i = 0; i < n; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = previous[i];
    const c = i >= bpp ? previous[i - bpp] : 0;
    let pred = 0;

    if (filter === 1) pred = a;
    else if (filter === 2) pred = b;
    else if (filter === 3) pred = (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
    }

    out[i] = (line[i] - pred) & 0xff;
  }

  return out;
}

/* ── Verkleinern ─────────────────────────────────────────────────── */

/**
 * Mittelt über den Quellbereich jedes Zielpixels (Box-Filter). Für das
 * Verkleinern eines Zeichens auf Symbolgrößen genau richtig: bilineares
 * Abtasten würde bei Faktor 10 die meisten Bildpunkte überspringen und
 * dünne Linien verschwinden lassen.
 *
 * Gerechnet wird mit vorab multipliziertem Alpha – sonst färbt der
 * (beliebige) Farbwert vollständig durchsichtiger Bildpunkte die Ränder ein.
 */
function resize(image, width, height) {
  const out = Buffer.alloc(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * scaleY));

    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * scaleX));

      let r = 0, g = 0, b = 0, a = 0, n = 0;

      for (let sy = y0; sy < y1 && sy < image.height; sy++) {
        for (let sx = x0; sx < x1 && sx < image.width; sx++) {
          const i = (sy * image.width + sx) * 4;
          const alpha = image.data[i + 3] / 255;
          r += image.data[i] * alpha;
          g += image.data[i + 1] * alpha;
          b += image.data[i + 2] * alpha;
          a += image.data[i + 3];
          n++;
        }
      }

      const to = (y * width + x) * 4;
      if (!n || a === 0) { out[to + 3] = 0; continue; }

      const alpha = a / n;
      const weight = alpha / 255 * n;
      out[to] = Math.round(r / weight);
      out[to + 1] = Math.round(g / weight);
      out[to + 2] = Math.round(b / weight);
      out[to + 3] = Math.round(alpha);
    }
  }

  return { width, height, data: out };
}

module.exports = { decode, encode, resize };
