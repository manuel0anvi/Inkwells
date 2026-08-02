#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   WO STEHT DIE SCHREIBMARKE DES ANDEREN?

   Prüft das flache Positionsmaß aus src/canvas/text.js. Daran hängen zwei
   Dinge: die Schreibmarken der anderen und die Zeilensperre.

   >>> Der Fehler, der hier festgehalten wird <<<
   Die alte Umrechnung zählte nur die Zeichen in den Textknoten. Bei
   <p>abc</p><p></p><p>def</p> ergaben damit DREI verschiedene Stellen
   dieselbe Zahl 3: das Ende der ersten Zeile, die leere Zeile und der
   Anfang der dritten. rangeForTextOffset nahm bei Gleichstand immer die
   früheste – die fremde Marke landete deshalb verlässlich eine Zeile zu
   hoch, am Ende der Zeile davor. Genau das ist „der Cursor ist nie an der
   richtigen Stelle".

   Nachgestellt wird nur so viel DOM, wie die geprüften Funktionen
   anfassen: Knoten, Kindlisten und Bereiche (Range). Ein echter Browser
   ist dafür nicht nötig – die Umrechnung ist reine Kopfrechnerei.

   Aufruf:  node scripts/test-collab-caret.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ── Ein sehr kleines DOM ───────────────────────────────────────────── */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

class TextNode {
  constructor(value) {
    this.nodeType = TEXT_NODE;
    this.nodeValue = value;
    this.childNodes = [];
    this.parentNode = null;
  }
  get parentElement() { return this.parentNode; }
}

class ElementNode {
  constructor(tag) {
    this.nodeType = ELEMENT_NODE;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
  }
  get parentElement() { return this.parentNode; }
  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  contains(node) {
    let cur = node;
    while (cur) { if (cur === this) return true; cur = cur.parentNode; }
    return false;
  }
}

function el(tag, ...kids) {
  const node = new ElementNode(tag);
  for (const kid of kids) node.appendChild(typeof kid === 'string' ? new TextNode(kid) : kid);
  return node;
}

/** Weg vom Wurzelknoten bis hierher, als Folge von Kindnummern. */
function pathOf(node) {
  const out = [];
  let cur = node;
  while (cur.parentNode) {
    out.unshift(cur.parentNode.childNodes.indexOf(cur));
    cur = cur.parentNode;
  }
  return out;
}

/** Vergleicht zwei Punkte in Dokumentreihenfolge: -1, 0 oder 1. */
function comparePoints(aNode, aOffset, bNode, bOffset) {
  const a = pathOf(aNode).concat([aOffset]);
  const b = pathOf(bNode).concat([bOffset]);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/* ── Ein sehr einfaches Layout ──────────────────────────────────────────
   Damit sich Zeilenumbrüche prüfen lassen, bekommt der Text eine Geometrie:
   jedes Zeichen 10 px breit, nach UMBRUCH_BEI Zeichen bricht die Zeile,
   Zeilenhöhe 32 px, die Buchstaben selbst 19 px hoch und mittig darin – so
   wie es der echte Browser gemessen hat.

   Gebraucht für caretRectAt: an einem Umbruch ist eine zusammengefallene
   Auswahl mehrdeutig (Ende der Zeile davor oder Anfang der nächsten?), und
   genau daran hat die fremde Marke gezuckt.
   ─────────────────────────────────────────────────────────────────── */

const ZEICHENBREITE = 10;
const ZEILENHOEHE = 32;
const BUCHSTABENHOEHE = 19;
const UMBRUCH_BEI = 10;
const LINKS = 72;
const OBEN = 64;

class DOMRectStub {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.width = w; this.height = h;
    this.left = x; this.top = y; this.right = x + w; this.bottom = y + h;
  }
}

/** Welche Zeile und Spalte hat das Zeichen an dieser Stelle? */
function gitter(index) {
  return { zeile: Math.floor(index / UMBRUCH_BEI), spalte: index % UMBRUCH_BEI };
}

/**
 * Rechtecke für den Zeichenbereich [von, bis) – eines je Bildschirmzeile,
 * genau wie Range.getClientRects() es im Browser tut.
 */
function rechtecke(von, bis) {
  const out = [];
  for (let i = von; i < bis; i++) {
    const { zeile, spalte } = gitter(i);
    const letzte = out[out.length - 1];
    if (letzte && letzte._zeile === zeile) { letzte.right += ZEICHENBREITE; letzte.width += ZEICHENBREITE; continue; }
    const r = new DOMRectStub(
      LINKS + spalte * ZEICHENBREITE,
      OBEN + zeile * ZEILENHOEHE + (ZEILENHOEHE - BUCHSTABENHOEHE) / 2,
      ZEICHENBREITE, BUCHSTABENHOEHE
    );
    r._zeile = zeile;
    out.push(r);
  }
  return out;
}

function makeRange() {
  return {
    startContainer: null, startOffset: 0,
    endContainer: null, endOffset: 0,
    collapsed: true,
    setStart(node, offset) {
      this.startContainer = node; this.startOffset = offset;
      if (!this.endContainer) { this.endContainer = node; this.endOffset = offset; }
    },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    collapse(toStart) {
      if (toStart === false) { this.startContainer = this.endContainer; this.startOffset = this.endOffset; }
      else { this.endContainer = this.startContainer; this.endOffset = this.startOffset; }
      this.collapsed = true;
    },
    selectNodeContents(node) {
      this.startContainer = node; this.startOffset = 0;
      this.endContainer = node; this.endOffset = node.childNodes.length;
      this.collapsed = false;
    },
    compareBoundaryPoints(how, other) {
      return comparePoints(this.startContainer, this.startOffset,
                           other.startContainer, other.startOffset);
    },
    /* Nur für den einfachen Fall gedacht: EIN Textknoten, der die ganze
       Zeile trägt. Genau so sieht eine Seite in Inkwell meistens aus. */
    getClientRects() {
      if (this.startContainer !== this.endContainer) return [];
      if (this.startContainer.nodeType !== TEXT_NODE) return [];
      return rechtecke(this.startOffset, this.endOffset);
    }
  };
}

/* ── Umgebung bauen ─────────────────────────────────────────────────── */

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'canvas', 'text.js'), 'utf8');

let selection = null;

const ctx = {
  console,
  Node: { ELEMENT_NODE, TEXT_NODE },
  Range: { START_TO_START: 0 },
  document: {
    createRange: makeRange,
    createElement: (tag) => el(tag),
    createTextNode: (value) => new TextNode(value),
    createTreeWalker: () => ({ nextNode: () => null })
  },
  NodeFilter: { SHOW_TEXT: 4 },
  getComputedStyle: () => ({}),
  DOMRect: DOMRectStub,
  getZoom: () => 1,
  window: {}
};
ctx.window.getSelection = () => selection;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(source, ctx);

const {
  flatTextParts, flatTextOf, flatRangeAt, flatPosOfPoint, flatLineSpan,
  flatCaretPos, caretRectAt
} = ctx;

/* ── Prüfwerkzeug ───────────────────────────────────────────────────── */

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + label);
  if (!ok) {
    console.log('      erwartet: ' + JSON.stringify(expected));
    console.log('      bekommen: ' + JSON.stringify(actual));
  }
}

/* ══ 1. Absätze: jede Zeilengrenze ist ein eigenes Zeichen ══════════ */

console.log('Absätze, dazwischen eine leere Zeile');

const p1 = el('p', 'abc');
const p2 = el('p', el('br'));       // leere Zeile, wie contenteditable sie baut
const p3 = el('p', 'def');
const rich = el('div', p1, p2, p3);

check('Flacher Text', flatTextOf(rich), 'abc\n\ndef');

const abc = p1.childNodes[0];
const def = p3.childNodes[0];

/* Der Kern der Sache: drei Stellen, die früher alle die Zahl 3 ergaben. */
check('Ende der ersten Zeile', flatPosOfPoint(rich, abc, 3), 3);
check('Die leere Zeile dazwischen', flatPosOfPoint(rich, p2, 0), 4);
check('Anfang der dritten Zeile', flatPosOfPoint(rich, def, 0), 5);

const atEnd = flatRangeAt(rich, 3);
check('Stelle 3 zeigt ans Ende von „abc"', [atEnd.startContainer === abc, atEnd.startOffset], [true, 3]);

const atEmpty = flatRangeAt(rich, 4);
check('Stelle 4 zeigt in die leere Zeile', atEmpty.startContainer === p2, true);

const atNext = flatRangeAt(rich, 5);
check('Stelle 5 zeigt an den Anfang von „def"', [atNext.startContainer === def, atNext.startOffset], [true, 0]);

/* ══ 2. Hin und zurück muss dasselbe ergeben ════════════════════════ */

console.log('\nHin und zurück, über den ganzen Text');

const text = flatTextOf(rich);
const roundTrip = [];
for (let pos = 0; pos <= text.length; pos++) {
  const range = flatRangeAt(rich, pos);
  roundTrip.push(flatPosOfPoint(rich, range.startContainer, range.startOffset));
}
check('Jede Stelle findet sich wieder',
  roundTrip, Array.from({ length: text.length + 1 }, (_, i) => i));

/* ══ 3. Reiner Text mit Zeilenumbrüchen (der Alltagsfall) ═══════════ */

console.log('\nReiner Text mit Umbrüchen');

const plainNode = new TextNode('eins\nzwei\ndrei');
const plain = el('div', plainNode);

check('Flacher Text unverändert', flatTextOf(plain), 'eins\nzwei\ndrei');
check('Stelle mitten in Zeile zwei', flatPosOfPoint(plain, plainNode, 7), 7);

const inPlain = flatRangeAt(plain, 7);
check('Und zurück', [inPlain.startContainer === plainNode, inPlain.startOffset], [true, 7]);

/* ══ 4. Auszeichnungen brechen die Zeile nicht ══════════════════════ */

console.log('\nFett und kursiv gehören zur selben Zeile');

const bold = el('b', 'dick');
const mixed = el('div', el('p', 'ganz ', bold, ' gedruckt'));
check('Flacher Text', flatTextOf(mixed), 'ganz dick gedruckt');
check('Stelle im fetten Teil', flatPosOfPoint(mixed, bold.childNodes[0], 2), 7);

/* ══ 5. Die Zeilensperre ════════════════════════════════════════════ */

console.log('\nWelche Zeilen die Sperre umfasst');

const lines = 'erste\nzweite\ndritte\nvierte';
check('Diese und die nächste Zeile', flatLineSpan(lines, 2, 1), { from: 0, to: 12 });
check('Ab der zweiten Zeile', flatLineSpan(lines, 8, 1), { from: 6, to: 19 });
check('Letzte Zeile: hört am Textende auf', flatLineSpan(lines, 22, 1), { from: 20, to: lines.length });
check('Nur die eigene Zeile', flatLineSpan(lines, 2, 0), { from: 0, to: 5 });
check('Leerer Text', flatLineSpan('', 0, 1), { from: 0, to: 0 });

// Über die leere Zeile hinweg: sie muss mit hineinfallen
check('Leere Zeile wird mitgesperrt', flatLineSpan('abc\n\ndef', 1, 1), { from: 0, to: 4 });

/* ══ 6. Die Marke am Zeilenumbruch ══════════════════════════════════
   Der Fall, an dem die fremde Marke „mal richtig, mal falsch" saß.

   Eine zusammengefallene Auswahl an einer Umbruchstelle ist mehrdeutig:
   Stelle 10 ist zugleich das Ende der ersten und der Anfang der zweiten
   Bildschirmzeile. Welche der Browser zurückgibt, hängt von seiner
   inneren „Affinität" ab und wechselt. caretRectAt fragt deshalb nicht
   nach der Stelle selbst, sondern nach dem ZEICHEN dahinter – und das
   liegt eindeutig auf der zweiten Zeile, dort erscheint auch das nächste
   Getippte.
   ══════════════════════════════════════════════════════════════════ */

console.log('\nDie Marke an einem Zeilenumbruch');

// 25 Zeichen, Umbruch nach je 10 → drei Bildschirmzeilen
const langerKnoten = new TextNode('abcdefghijklmnopqrstuvwxy');
const lang = el('div', langerKnoten);
lang.style = { lineHeight: '32px' };

const zeileVon = (y) => Math.round((y - OBEN - (ZEILENHOEHE - BUCHSTABENHOEHE) / 2) / ZEILENHOEHE);

const amAnfang = caretRectAt(lang, 0);
check('Stelle 0: erste Zeile, ganz links', [zeileVon(amAnfang.top), amAnfang.left], [0, LINKS]);

const mitten = caretRectAt(lang, 4);
check('Stelle 4: erste Zeile, fünfte Spalte',
  [zeileVon(mitten.top), mitten.left], [0, LINKS + 4 * ZEICHENBREITE]);

/* Der entscheidende Fall: Stelle 10 ist genau die Umbruchstelle. */
const amUmbruch = caretRectAt(lang, 10);
check('Stelle 10 (Umbruch): ZWEITE Zeile, ganz links',
  [zeileVon(amUmbruch.top), amUmbruch.left], [1, LINKS]);

const amUmbruch2 = caretRectAt(lang, 20);
check('Stelle 20 (Umbruch): DRITTE Zeile, ganz links',
  [zeileVon(amUmbruch2.top), amUmbruch2.left], [2, LINKS]);

// Am Textende gibt es kein Zeichen mehr danach – dann hinter das davor
const amEnde = caretRectAt(lang, 25);
check('Am Textende: hinter dem letzten Zeichen',
  [zeileVon(amEnde.top), amEnde.left], [2, LINKS + 5 * ZEICHENBREITE]);

/* Vor einem echten Zeilenumbruch darf die Marke NICHT in die nächste
   Zeile rutschen – dort steht der Text ja gar nicht mehr. */
const mitUmbruch = el('div', new TextNode('abc\ndef'));
mitUmbruch.style = { lineHeight: '32px' };
const vorUmbruch = caretRectAt(mitUmbruch, 3);
check('Vor einem \\n: bleibt am Ende der Zeile davor',
  vorUmbruch.left, LINKS + 3 * ZEICHENBREITE);

/* ══ 7. flatCaretPos liest die Auswahl ══════════════════════════════ */


console.log('\nDie eigene Schreibmarke');

const caretRange = makeRange();
caretRange.setStart(def, 1);
caretRange.collapse(true);
selection = { rangeCount: 1, getRangeAt: () => caretRange };
check('Wird gefunden', flatCaretPos(rich), 6);

const outside = makeRange();
outside.setStart(plainNode, 0);
outside.collapse(true);
selection = { rangeCount: 1, getRangeAt: () => outside };
check('Fremdes Feld zählt nicht', flatCaretPos(rich), null);

selection = null;
check('Ohne Auswahl kein Wert', flatCaretPos(rich), null);

/* ══ Ergebnis ═══════════════════════════════════════════════════════ */

console.log('');
if (failed) {
  console.log(failed + ' Prüfung(en) fehlgeschlagen.');
  process.exit(1);
}
console.log('Alle Prüfungen bestanden.');
