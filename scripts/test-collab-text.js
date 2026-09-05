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

/* Ersetzt jemand genau den Bereich, in dem die Marke steht, gibt es
   keine Stelle mehr, die ihr entspricht – weder davor noch dahinter ist
   etwas wiederzufinden. Dann bleibt sie ungefähr stehen. Früher ging sie
   ans Ende des Neuen; siehe den nächsten Abschnitt, warum das schädlich
   war. */
check('Mitten im Ersetzten', shiftedPos('abcdef', 'aXYZf', 3), 3);

// Eine ganze Zeile weiter vorn – der Fall aus der Live-Sitzung
check('Neue Zeile davor', shiftedPos('eins\nzwei', 'eins\nneu\nzwei', 7), 11);

/* ══ Die eigene Marke darf NICHT zum anderen springen ════════════════

   >>> Der Fehler, der hier festgehalten wird <<<
   textDelta vergleicht über gemeinsamen Anfang und gemeinsames Ende und
   fasst alles dazwischen zu EINEM Block zusammen. Unterscheiden sich die
   beiden Fassungen an zwei Stellen – er tippt oben, ich unten, der
   Normalfall beim gemeinsamen Schreiben –, reicht dieser Block über den
   halben Text und die eigene Marke liegt darin.

   Sie wurde dann „ans Ende des Neuen" gesetzt, und das ist genau die
   Stelle, an der der ANDERE schreibt. Weil reportCaret die verrutschte
   Stelle danach weitermeldet, saß auch sein Bild meiner Marke und mein
   Sperrband falsch.
   ══════════════════════════════════════════════════════════════════ */

console.log('\nZwei Leute tippen gleichzeitig an verschiedenen Stellen');

{
  // Er hängt " XX" an Zeile 1, ich stehe in Zeile 3 hinter „Dri"
  const vorher  = 'Erste\nZweite\nDritte';
  const nachher = 'Erste XX\nZweite\nDritte YY';
  const ziel = shiftedPos(vorher, nachher, 16);

  check('Die Marke bleibt hinter „Dri"', nachher.slice(0, ziel), 'Erste XX\nZweite\nDri');
  check('Und landet NICHT an seinem Text', ziel === nachher.length, false);
}

{
  // Umgekehrt: er schreibt unten, ich stehe oben
  const vorher  = 'Erste\nZweite\nDritte';
  const nachher = 'Erste XX\nZweite\nDritte YY';
  const ziel = shiftedPos(vorher, nachher, 3);
  check('Marke vor beiden Änderungen bleibt stehen', ziel, 3);
}

{
  /* Der Halt DAHINTER: ausgerechnet das Wort vor der Marke wird ersetzt,
     der Text danach steht noch. Dann zählt der Text danach. */
  const vorher  = 'Hallo Welt\nZweite';
  const nachher = 'Servus Welt\nZweite XX';
  const ziel = shiftedPos(vorher, nachher, 6);   // vor „Welt"
  check('Marke bleibt vor „Welt"', nachher.slice(ziel, ziel + 4), 'Welt');
}

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

/* ══════════════════════════════════════════════════════════════════════
   4. ZWEI ÄNDERUNGEN AUF EINMAL

   Der Fall, der den Text zweier Leute durcheinanderbrachte. Gemeldet:
   „ich schreibe eine Zeile über dem anderen, komme in seine Zeile – und
   der ganze Text von uns beiden wird verschoben."

   Unterscheiden sich die hiesige Fassung und der gemeinsame Stand an
   ZWEI Stellen, spannt textDelta einen einzigen Block über alles
   dazwischen. Der geht als Löschen-und-neu-Einfügen nach Yjs, und was
   der andere gerade mittendrin geschrieben hat, steht in Zeichen, die
   dabei gelöscht werden. Daran kann Yjs nichts mehr retten.

   feinDelta zerlegt den Block in Abschnitte und liefert je Abweichung
   eine eigene, kleine Änderung. Genau das wird hier geprüft.
   ══════════════════════════════════════════════════════════════════════ */

console.log('\nZwei Änderungen auf einmal werden nicht zu einer');

const { _feinDelta: feinDelta, _inAbschnitte: inAbschnitte } = ctx.window.Collab;

/** Wendet an, was feinDelta liefert – von hinten nach vorn, wie in collab.js. */
function wendeAn(text, deltas) {
  for (let i = deltas.length - 1; i >= 0; i--) {
    const d = deltas[i];
    text = text.slice(0, d.at) + d.insert + text.slice(d.at + d.remove);
  }
  return text;
}

/** Bildet nach, was applyLocalText seit der feinen Zerlegung tut. */
function editFein(ydoc, next) {
  const ytext = ydoc.getText('t');
  const deltas = feinDelta(ytext.toString(), next);
  if (!deltas.length) return;
  ydoc.transact(() => {
    for (let i = deltas.length - 1; i >= 0; i--) {
      const d = deltas[i];
      if (d.remove > 0) ytext.delete(d.at, d.remove);
      if (d.insert) ytext.insert(d.at, d.insert);
    }
  });
}

/* Eine Seite, wie sie mit frei stehenden Absätzen aussieht: oben einer,
   unten einer, dazwischen gewöhnlicher Text. */
const fuellung = (mitte) =>
  '<p>Zeile eins mit einer ordentlichen Menge Text darin</p>'
  + '<p>' + mitte + '</p>'
  + '<p>Zeile drei mit einer ordentlichen Menge Text darin</p>'
  + '<p>Zeile vier mit einer ordentlichen Menge Text darin</p>';

const seiteAlt = '<p class="j-frei" style="left:100px;top:40px">Oben</p>'
  + fuellung('Zeile zwei')
  + '<p class="j-frei" style="left:100px;top:400px">Unten</p>';

{
  /* Zwei Abweichungen in einer Runde: der freie Absatz oben ist
     verschoben (das tut ordneFreieAbsaetze in der Einstellung „fest“),
     und unten wurde getippt. Dazwischen liegt unveränderter Text. */
  const seiteNeu = '<p class="j-frei" style="left:100px;top:70px">Oben</p>'
    + fuellung('Zeile zwei')
    + '<p class="j-frei" style="left:100px;top:400px">UntenX</p>';

  const grob = textDelta(seiteAlt, seiteNeu);
  const fein = feinDelta(seiteAlt, seiteNeu);

  // Der grobe Vergleich fasst wirklich alles dazwischen an – das ist der Fehler
  check('Der grobe Block reicht über die Mitte', grob.remove > 150, true);

  check('Fein zerlegt sind es zwei Änderungen', fein.length, 2);
  check('Und zusammen fassen sie fast nichts an',
    fein.reduce((n, d) => n + d.remove, 0) < 20, true);
  check('Angewandt ergibt es die neue Fassung', wendeAn(seiteAlt, fein), seiteNeu);
}

/* ══════════════════════════════════════════════════════════════════════
   … UND DER MITARBEITER SCHREIBT MITTENDRIN

   A hat die zweite Abweichung im Text stehen (den verschobenen freien
   Absatz oben) und tippt unten weiter. B schreibt im selben Augenblick
   in einer Zeile DAZWISCHEN. Mit dem groben Block war Bs Zeile danach
   weg; mit der feinen Zerlegung steht sie noch da.
   ══════════════════════════════════════════════════════════════════════ */

console.log('\nDer Mitarbeiter schreibt mittendrin');

{
  const a1 = new Y.Doc();
  const b1 = new Y.Doc();
  Y.applyUpdate(a1, seedUpdate(seiteAlt));
  Y.applyUpdate(b1, seedUpdate(seiteAlt));

  // B schreibt in der mittleren Zeile
  editFein(b1, '<p class="j-frei" style="left:100px;top:40px">Oben</p>'
    + fuellung('Zeile zwei BBB')
    + '<p class="j-frei" style="left:100px;top:400px">Unten</p>');

  // A verschiebt oben und tippt unten – zwei Abweichungen auf einmal
  editFein(a1, '<p class="j-frei" style="left:100px;top:70px">Oben</p>'
    + fuellung('Zeile zwei')
    + '<p class="j-frei" style="left:100px;top:400px">UntenAAA</p>');

  const ua = Y.encodeStateAsUpdate(a1);
  const ub = Y.encodeStateAsUpdate(b1);
  Y.applyUpdate(a1, ub);
  Y.applyUpdate(b1, ua);

  const ergebnis = a1.getText('t').toString();
  check('Bs Zeile ist noch da', ergebnis.includes('Zeile zwei BBB'), true);
  check('As Zeile ist auch da', ergebnis.includes('UntenAAA'), true);
  check('Und As Verschiebung ist angekommen', ergebnis.includes('top:70px'), true);
  check('Beide sehen dasselbe', b1.getText('t').toString(), ergebnis);
}

console.log('\nAbschnitte zerlegen ergibt wieder den Ausgangstext');

{
  const proben = [
    '<p>eins</p><p>zwei</p><h2>drei</h2>',
    '<p>eins<br>zwei</p>',
    '<ul><li>a</li><li>b</li></ul>',
    'ganz ohne Auszeichnung',
    ''
  ];
  for (const probe of proben) {
    check('Verkettet wieder ' + JSON.stringify(probe),
      inAbschnitte(probe).join(''), probe);
  }
  check('Drei Absätze sind drei Abschnitte',
    inAbschnitte('<p>a</p><p>b</p><p>c</p>').length, 3);
}

if (failed > 0) {
  console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Prüfungen bestanden.');
