#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Prüft die Umwandler aus website/js/share.js:

       Heft  →  splitNotebook()  →  assembleNotebook()  →  Heft

   Wenn dabei etwas verloren geht, merkt man das sonst erst, wenn ein
   geteiltes Heft beim Empfänger ohne Bilder oder ohne Handschrift
   ankommt – und dann ist der Stand im Raum schon kaputt.

   Warum die Funktionen hier von Hand herausgeschnitten werden:
   share.js ist ein ES-Modul, das beim Laden Firebase von einer
   CDN-Adresse holt. Das geht in Node nicht. Die Umwandler sind aber
   bewusst reine Funktionen ohne Firestore – sie lassen sich deshalb
   einzeln herauslösen und prüfen.

   Aufruf:  node scripts/test-doc-split.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'website', 'js', 'share.js'), 'utf8'
);

/** Schneidet eine Funktion samt Körper aus dem Quelltext. */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Funktion ${name} nicht gefunden`);

  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Ende von ${name} nicht gefunden`);
}

const NAMES = [
  'splitNotebook', 'assembleNotebook', 'fingerprintNotebook',
  'signatureOf', 'isInlineData', 'splitIntoChunks',
  // Baut die Heft-Reihenfolge; splitNotebook hängt daran
  'pagesInOrder',
  // Die Unterschriften. kurzhash traegt beide anderen – ohne sie hier
  // scheitert der Aufbau mit „kurzhash is not defined".
  'kurzhash', 'inkSignatureOf'
];

const sandbox = { INK_SHEET_LIMIT: 600000, CHUNK_SIZE: 700000, console };
vm.createContext(sandbox);
vm.runInContext(NAMES.map(extract).join('\n\n'), sandbox);

const { splitNotebook, assembleNotebook, fingerprintNotebook } = sandbox;

/* ── Ein Heft, das alles enthält, was schiefgehen kann ──────────────── */

const PNG = 'data:image/png;base64,' + 'A'.repeat(120);

function makeStroke(n) {
  return {
    path: Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, p: 0.5 })),
    color: '#1a1510', width: 2.5, isHL: false
  };
}

const notebook = {
  id: 'nb1',
  name: 'Mathematik',
  color: '#2a5fa8',
  defaultBg: 'grid',
  activeSecId: 'sec1',
  sections: [
    { id: 'sec1', name: 'Analysis', pgIds: ['p1', 'p2'], defaultBg: 'grid' },
    { id: 'sec2', name: 'Algebra', pgIds: ['p3'], defaultBg: 'ruled' }
  ],
  pages: [
    {
      id: 'p1', date: '2026-08-01T10:00:00.000Z', bg: 'grid',
      textContent: '<p>Erste Seite mit Umlauten: äöü &amp; &lt;Zeichen&gt;</p>',
      inkStrokes: [makeStroke(4), makeStroke(6)],
      objects: [{ id: 'o1', type: 'image', x: 10, y: 20, w: 100, h: 80, src: PNG }]
    },
    {
      id: 'p2', date: '2026-08-01T11:00:00.000Z', bg: null,
      w: 794, h: 1123,
      textContent: '', inkStrokes: [], objects: [],
      bgImg: PNG
    },
    {
      id: 'p3', date: '2026-08-01T12:00:00.000Z', bg: 'ruled',
      textContent: '<p>Dritte</p>',
      inkStrokes: [makeStroke(3)],
      objects: [{ id: 'o2', type: 'image', x: 0, y: 0, w: 50, h: 50, src: 'https://example.com/extern.png' }]
    }
  ]
};

/* ── Prüfen ─────────────────────────────────────────────────────────── */

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`  ✗ ${label}`);
    console.error(`      erwartet: ${JSON.stringify(expected)}`);
    console.error(`      bekommen: ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log('Rundlauf Heft → zerlegt → Heft');

const parts = splitNotebook(notebook);
const back = assembleNotebook({ ...parts.head, notebookId: notebook.id }, parts.pages, parts.ink, parts.blobs);

check('Name', back.name, notebook.name);
check('Farbe', back.color, notebook.color);
check('Standard-Hintergrund', back.defaultBg, notebook.defaultBg);
check('Abschnitte', back.sections, notebook.sections);
check('Seitenzahl', back.pages.length, notebook.pages.length);
check('Seitenreihenfolge', back.pages.map(p => p.id), ['p1', 'p2', 'p3']);

check('Text Seite 1', back.pages[0].textContent, notebook.pages[0].textContent);
check('Striche Seite 1', back.pages[0].inkStrokes, notebook.pages[0].inkStrokes);
check('Bild Seite 1 wiederhergestellt', back.pages[0].objects[0].src, PNG);
check('Objektdaten Seite 1', back.pages[0].objects[0].w, 100);

check('Seitenbild Seite 2', back.pages[1].bgImg, PNG);
check('Breite Seite 2', back.pages[1].w, 794);
check('Leere Striche Seite 2', back.pages[1].inkStrokes, []);

check('Externe Bildadresse bleibt', back.pages[2].objects[0].src, 'https://example.com/extern.png');
check('Striche Seite 3', back.pages[2].inkStrokes, notebook.pages[2].inkStrokes);

console.log('\nBilder liegen außerhalb der Seiten');
check('Keine Bilddaten im Seitendokument',
  JSON.stringify(parts.pages).includes('data:image'), false);
check('Bilder als Blob abgelegt', parts.blobs.length > 0, true);

console.log('\nHandschrift bogenweise');
const big = {
  id: 'nb2', name: 'Viel', color: '#000', defaultBg: 'blank', sections: [],
  pages: [{ id: 'pX', date: '', bg: null, textContent: '', objects: [],
            inkStrokes: Array.from({ length: 400 }, () => makeStroke(120)) }]
};
const bigParts = splitNotebook(big);
const bigBack = assembleNotebook({ ...bigParts.head, notebookId: 'nb2' }, bigParts.pages, bigParts.ink, bigParts.blobs);
check('Mehr als ein Bogen nötig', bigParts.ink.length > 1, true);
check('Alle Striche wieder da', bigBack.pages[0].inkStrokes.length, 400);
check('Bögen in Reihenfolge', bigBack.pages[0].inkStrokes, big.pages[0].inkStrokes);
for (const sheet of bigParts.ink) {
  const bytes = JSON.stringify(sheet.strokes).length;
  if (bytes > 1000000) { failed++; console.error(`  ✗ Bogen ${sheet.id} ist ${bytes} Bytes – über der Dokumentgrenze`); }
}

/* ── Der Kopf muss zu den Sicherheitsregeln passen ────────────────────
   Beim Zerlegen des Datenmodells ist genau das schiefgegangen: die
   Regel verlangte weiterhin chunkCount, das es in der neuen Form nicht
   mehr gibt – und jede Freigabe wurde abgelehnt. Die Regel steht in
   website/firestore.rules und lässt sich von hier aus nicht ausführen;
   geprüft wird deshalb, dass die Felder da sind, die sie liest.
   Wer die Regel ändert, ändert diese Liste mit. ────────────────────── */
console.log('\nKopf enthält, was die Firestore-Regel prüft');

const RULE_FIELDS = ['title', 'pageCount', 'pageOrder', 'sections'];
for (const field of RULE_FIELDS) {
  check(`Feld "${field}" vorhanden`, Object.prototype.hasOwnProperty.call(parts.head, field), true);
}
check('title ist eine Zeichenkette', typeof parts.head.title, 'string');
check('title höchstens 200 Zeichen', parts.head.title.length <= 200, true);
check('pageCount ist eine ganze Zahl', Number.isInteger(parts.head.pageCount), true);

// Sehr langer Heftname darf die Grenze nicht sprengen
const longName = splitNotebook({ ...notebook, name: 'A'.repeat(500) });
check('Langer Name wird gekürzt', longName.head.title.length <= 200, true);

/* ── Die gewählte Abschnittsfarbe übersteht den Rundlauf ──────────────
   Sie wird sonst aus der Kennung gerechnet. Wer eine aussucht, muss sie
   beim anderen wiederfinden – und ein Abschnitt ohne Wahl darf das Feld
   gar nicht erst mitschleppen. */
console.log('\nAbschnittsfarbe im Kopf');

const bunt = JSON.parse(JSON.stringify(notebook));
bunt.sections[0].color = '#2a5fa8';
const buntParts = splitNotebook(bunt);

check('Die gewählte Farbe steht im Kopf', buntParts.head.sections[0].color, '#2a5fa8');
check('Ohne Wahl steht dort nichts',
  Object.prototype.hasOwnProperty.call(buntParts.head.sections[1], 'color'), false);

const buntBack = assembleNotebook(
  { ...buntParts.head, notebookId: bunt.id }, buntParts.pages, buntParts.ink, buntParts.blobs);
check('Und sie kommt zurück', buntBack.sections[0].color, '#2a5fa8');
check('Der andere Abschnitt bleibt ohne',
  Object.prototype.hasOwnProperty.call(buntBack.sections[1], 'color'), false);

console.log('\nMerkzettel erkennt Änderungen');
const fp1 = fingerprintNotebook(notebook);
const edited = JSON.parse(JSON.stringify(notebook));
edited.pages[0].textContent = '<p>geändert</p>';
const fp2 = fingerprintNotebook(edited);
check('Geänderte Seite fällt auf', fp1.pages.p1.sig !== fp2.pages.p1.sig, true);
check('Unveränderte Seite bleibt gleich', fp1.pages.p3.sig, fp2.pages.p3.sig);

const drawn = JSON.parse(JSON.stringify(notebook));
drawn.pages[2].inkStrokes.push(makeStroke(5));
const fp3 = fingerprintNotebook(drawn);
check('Neuer Strich wird gezählt', fp3.pages.p3.strokes, fp1.pages.p3.strokes + 1);

if (failed > 0) {
  console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Prüfungen bestanden.');
