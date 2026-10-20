#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   EIN STRICH IST EINE ZEILE – UND KOMMT GENAU SO ZURÜCK

   Prüft strichKompakt() und strichLesbar() aus core/share.js.

   >>> Woher der Test kommt <<<
   Gemeldet: „Freigeben dauert ein bis zwei Minuten, Öffnen auch“. Seit
   Formatstand 2 steht der Pfad eines Strichs als Zeichenkette in
   Firestore. Das darf NICHTS verändern: jeder Punkt muss als dieselbe
   Zahl zurückkommen, sonst verrutscht die Handschrift beim Empfänger um
   Bruchteile – und beim nächsten Speichern hielte der Abgleich jeden
   Strich für geändert.

   Aufruf:  node scripts/test-ink-kompakt.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const quelle = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'share.js'), 'utf8');

function extract(name) {
  const start = quelle.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Funktion ${name} nicht gefunden`);
  let depth = 0, seen = false;
  for (let i = start; i < quelle.length; i++) {
    const ch = quelle[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return quelle.slice(start, i + 1);
    }
  }
  throw new Error(`Ende von ${name} nicht gefunden`);
}

const sandbox = { Number, Set, parseFloat, String };
vm.createContext(sandbox);
vm.runInContext([
  /const PUNKT_FELDER = [^;]+;/.exec(quelle)[0],
  extract('strichKompakt'),
  extract('strichLesbar'),
  'this.kompakt = strichKompakt; this.lesbar = strichLesbar;'
].join('\n'), sandbox);
const { kompakt, lesbar } = sandbox;

let failed = 0;
function check(label, ok, info) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed++; console.error(`  ✗ ${label}${info ? '  (' + info + ')' : ''}`); }
}
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hinUndZurueck = (s) => lesbar(JSON.parse(JSON.stringify(kompakt(s))));

console.log('Hin und zurück ohne Verlust');
{
  const s = { path: [{ x: 71.72, y: 92.78 }, { x: 70.61, y: 94.44 }, { x: 0, y: -3.5 }], color: '#1a1510', width: 2.5 };
  check('Gewöhnlicher Strich', gleich(hinUndZurueck(s), s));
  check('Der Pfad ist wirklich eine Zeile', typeof kompakt(s).path === 'string');
  check('Farbe und Breite bleiben', kompakt(s).color === '#1a1510' && kompakt(s).width === 2.5);

  const druck = { path: [{ x: 10, y: 20, p: 0.35 }, { x: 11.25, y: 21, p: 0.5 }], color: 'red', width: 4, isHL: true };
  check('Mit Druck', gleich(hinUndZurueck(druck), druck));

  const gemischt = { path: [{ x: 1, y: 2 }, { x: 3, y: 4, p: 0.2 }] };
  check('Druck nur an manchen Punkten', gleich(hinUndZurueck(gemischt), gemischt));

  // Zufällige Zahlen in voller Genauigkeit – auch die müssen exakt zurück
  let alleGleich = true;
  for (let n = 0; n < 2000; n++) {
    const pfad = [];
    for (let i = 0; i < 20; i++) pfad.push({ x: Math.random() * 1200 - 100, y: Math.random() * 1700, p: Math.random() });
    const st = { path: pfad, width: Math.random() * 8 };
    if (!gleich(hinUndZurueck(st), st)) { alleGleich = false; break; }
  }
  check('2000 zufällige Striche in voller Genauigkeit', alleGleich);

  check('Sehr kleine und sehr grosse Zahlen', gleich(hinUndZurueck({ path: [{ x: 1e-7, y: 123456789.125 }] }),
    { path: [{ x: 1e-7, y: 123456789.125 }] }));
  check('Leerer Pfad', gleich(hinUndZurueck({ path: [], color: 'a' }), { path: [], color: 'a' }));
}

console.log('\nWas sich nicht verlustfrei kürzen lässt, bleibt, wie es ist');
{
  const fremd = { path: [{ x: 1, y: 2, t: 99 }] };
  check('Punkt mit weiterem Feld', kompakt(fremd) === fremd);
  const kaputt = { path: [{ x: 1, y: NaN }] };
  check('Punkt ohne Zahl', kompakt(kaputt) === kaputt);
  check('Strich ohne Pfad', gleich(kompakt({ color: 'x' }), { color: 'x' }));
}

console.log('\nLesen versteht beide Formen');
{
  const alt = { path: [{ x: 5, y: 6 }], color: 'b' };
  check('Eine Liste bleibt eine Liste', lesbar(alt) === alt);
  check('null und Unsinn stören nicht', lesbar(null) === null && lesbar(undefined) === undefined);
}

console.log('\nUnd es lohnt sich');
{
  const pfad = [];
  for (let i = 0; i < 40; i++) pfad.push({ x: Math.round((80 + i * 3.17) * 100) / 100, y: Math.round((300 + Math.sin(i) * 9) * 100) / 100 });
  const s = { path: pfad, color: '#1a1510', width: 2.5 };
  const leitung = (w) => typeof w === 'string' ? JSON.stringify({ stringValue: w }).length
    : typeof w === 'number' ? 22 : Array.isArray(w) ? 30 + w.reduce((n, e) => n + leitung(e) + 1, 0)
    : 30 + Object.keys(w).reduce((n, k) => n + k.length + 3 + leitung(w[k]), 0);
  const vorher = leitung(s), nachher = leitung(kompakt(s));
  check('Auf der Leitung mindestens dreimal kleiner', vorher / nachher >= 3, vorher + ' → ' + nachher);
}

if (failed) { console.error(`${failed} Pruefung(en) fehlgeschlagen.`); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
