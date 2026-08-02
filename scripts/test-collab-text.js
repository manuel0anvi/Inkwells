#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Prüft die Live-Textbearbeitung aus src/ui/collab.js.

   Zwei Dinge, die still schiefgehen können und dann Text zerstören:

   1. Der Vergleich (textDelta). Fasst er zu viel an, kollidiert jede
      Änderung mit der des anderen. Fasst er das Falsche an, steht
      hinterher Unsinn da.

   2. Der erste Yjs-Stand (seedUpdate). Öffnen zwei Leute gleichzeitig
      ein Dokument, das noch keinen hat, legen beide einen an. Wären das
      für Yjs zwei verschiedene Texte, stünde nach dem Zusammenführen
      ALLES DOPPELT da. Deshalb die feste clientID – und deshalb wird
      genau das hier geprüft.

   Aufruf:  node scripts/test-collab-text.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

/* ── Umgebung bauen ──────────────────────────────────────────────────
   collab.js ist für den Browser geschrieben. Hier wird gerade so viel
   davon nachgestellt, dass die Datei durchläuft – geprüft werden
   ausschließlich die beiden reinen Funktionen. */
const ctx = {
  console,
  crypto: require('node:crypto').webcrypto,
  performance,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  document: {
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {} }),
    addEventListener() {}
  },
  E: () => null,
  S: { strokeHistory: {}, activePgId: null },
  t: (k) => k,
  getPage: () => null,
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: (fn) => fn,
  clearTimeout: () => {}
};
ctx.self = ctx;
ctx.window = ctx;
vm.createContext(ctx);

vm.runInContext(fs.readFileSync(path.join(root, 'src', 'lib', 'yjs.bundle.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src', 'ui', 'collab.js'), 'utf8'), ctx);

const Y = ctx.Y;
const { _textDelta: textDelta, _shiftedPos: shiftedPos,
        _seedUpdate: seedUpdate } = ctx.window.Collab;

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

/* ── 1. Der Vergleich ───────────────────────────────────────────────── */

console.log('Vergleich zweier Fassungen');

check('Nichts geändert', textDelta('abc', 'abc'), null);
check('Am Ende angehängt', textDelta('abc', 'abcd'), { at: 3, remove: 0, insert: 'd' });
check('Vorne eingefügt', textDelta('abc', 'Xabc'), { at: 0, remove: 0, insert: 'X' });
check('In der Mitte eingefügt', textDelta('abc', 'abXc'), { at: 2, remove: 0, insert: 'X' });
check('Zeichen gelöscht', textDelta('abcd', 'abd'), { at: 2, remove: 1, insert: '' });
check('Ersetzt', textDelta('abcd', 'abXYd'), { at: 2, remove: 1, insert: 'XY' });
check('Alles gelöscht', textDelta('abc', ''), { at: 0, remove: 3, insert: '' });
check('Aus leer geschrieben', textDelta('', 'neu'), { at: 0, remove: 0, insert: 'neu' });

// Der wichtigste Fall: wiederholte Zeichen. Ein naiver Vergleich fasst
// hier zu viel an und würde beim anderen Text zerreißen.
check('Wiederholte Zeichen', textDelta('aaa', 'aaaa'), { at: 3, remove: 0, insert: 'a' });

const html = '<p>Hallo Welt</p><p>Zweite Zeile</p>';
check('Wort im HTML geändert',
  textDelta(html, '<p>Hallo Erde</p><p>Zweite Zeile</p>'),
  { at: 9, remove: 4, insert: 'Erde' });

/* ── 1b. Die eigene Marke wandert mit ───────────────────────────────
   Tippt der andere etwas VOR der eigenen Schreibmarke, rutscht der ganze
   Text dahinter weiter. Die Marke wurde bisher auf dieselbe ZAHL
   zurückgesetzt und blieb damit stehen, während der Text unter ihr
   weiterwanderte – nach ein paar fremden Anschlägen stand sie mitten im
   Wort davor oder eine Zeile höher, und das Nächste, was man tippte,
   landete dort statt an der Stelle, auf die man sah. */

console.log('\nDie eigene Marke bei fremden Änderungen');

check('Fremdes Einfügen davor schiebt mit',
  shiftedPos('abc def', 'abcXY def', 5), 7);
check('Fremdes Einfügen dahinter lässt sie stehen',
  shiftedPos('abc def', 'abc defXY', 2), 2);
check('Fremdes Löschen davor zieht zurück',
  shiftedPos('abcXY def', 'abc def', 7), 5);
check('Nichts geändert, nichts bewegt',
  shiftedPos('abc def', 'abc def', 4), 4);

/* Genau an der Marke eingefügt: das Fremde steht davor, die eigene Marke
   rückt nach rechts – so sieht es auf dem Papier auch aus. */
check('Genau an der Marke eingefügt', shiftedPos('abcdef', 'abcXdef', 3), 4);

/* Ersetzt jemand einen Bereich, in dem die Marke steht, gibt es keine
   Stelle mehr, die ihr entspricht. Dann ans Ende des Neuen – dort steht
   die Zeile jetzt. */
check('Mitten im Ersetzten', shiftedPos('abcdef', 'aXYZf', 3), 4);

// Eine ganze Zeile weiter vorn – der Fall aus der Live-Sitzung
check('Neue Zeile davor', shiftedPos('eins\nzwei', 'eins\nneu\nzwei', 7), 11);

/* ── 2. Der erste Yjs-Stand ─────────────────────────────────────────── */

console.log('\nZwei Leute legen gleichzeitig den ersten Stand an');

const text = '<p>Vorhandener Text</p>';
const a = new Y.Doc();
const b = new Y.Doc();
Y.applyUpdate(a, seedUpdate(text));
Y.applyUpdate(b, seedUpdate(text));

// jetzt zusammenführen, als hätten sich beide getroffen
Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

check('Kein doppelter Text bei A', a.getText('t').toString(), text);
check('Kein doppelter Text bei B', b.getText('t').toString(), text);

/* ── 3. Gleichzeitiges Tippen ───────────────────────────────────────── */

console.log('\nGleichzeitig an verschiedenen Stellen tippen');

/** Bildet nach, was applyLocalText tut. */
function edit(ydoc, next) {
  const ytext = ydoc.getText('t');
  const delta = textDelta(ytext.toString(), next);
  if (!delta) return;
  ydoc.transact(() => {
    if (delta.remove > 0) ytext.delete(delta.at, delta.remove);
    if (delta.insert) ytext.insert(delta.at, delta.insert);
  });
}

const start = '<p>Zeile eins</p><p>Zeile zwei</p>';
const x = new Y.Doc();
const y = new Y.Doc();
Y.applyUpdate(x, seedUpdate(start));
Y.applyUpdate(y, seedUpdate(start));

// getrennt voneinander arbeiten
edit(x, '<p>Zeile eins ist meine</p><p>Zeile zwei</p>');
edit(y, '<p>Zeile eins</p><p>Zeile zwei ist deine</p>');

// und wieder zusammenfinden
const ux = Y.encodeStateAsUpdate(x);
const uy = Y.encodeStateAsUpdate(y);
Y.applyUpdate(x, uy);
Y.applyUpdate(y, ux);

const merged = '<p>Zeile eins ist meine</p><p>Zeile zwei ist deine</p>';
check('Beide Änderungen sind da', x.getText('t').toString(), merged);
check('Beide sehen dasselbe', y.getText('t').toString(), x.getText('t').toString());

console.log('\nGleichzeitig in DERSELBEN Zeile tippen');

const p = new Y.Doc();
const q = new Y.Doc();
Y.applyUpdate(p, seedUpdate('<p>Hallo</p>'));
Y.applyUpdate(q, Y.encodeStateAsUpdate(p));

edit(p, '<p>Hallo Welt</p>');
edit(q, '<p>Hallo Erde</p>');

const up = Y.encodeStateAsUpdate(p);
const uq = Y.encodeStateAsUpdate(q);
Y.applyUpdate(p, uq);
Y.applyUpdate(q, up);

check('Kein Text verloren', p.getText('t').toString().includes('Welt') && p.getText('t').toString().includes('Erde'), true);
check('Beide sehen dasselbe', p.getText('t').toString(), q.getText('t').toString());

if (failed > 0) {
  console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Prüfungen bestanden.');
