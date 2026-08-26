#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   WAS MIT DER HANDSCHRIFT EINER SEITE GESCHIEHT

   Prüft inkPlan() aus core/share.js – die Entscheidung, ob die Striche
   einer Seite unverändert bleiben, angehängt oder neu geschrieben werden.

   >>> Warum das einen eigenen Test verdient <<<
   Hier stand vorher nur ein Vergleich der ANZAHL, und der ging in zwei
   alltäglichen Fällen schief. Beide sind unten die ersten Prüfungen:

     · einen Strich radieren und einen neuen ziehen – die Anzahl bleibt
       gleich, die Seite galt als unverändert. Die Arbeit erreichte die
       anderen nie und war nach dem nächsten Laden auch beim Urheber weg.

     · einen alten Strich radieren und zwei neue ziehen – die Anzahl
       wächst, also wurde „ab Stelle n anhängen" gerechnet. Der Anfang war
       aber ein anderer: es ging der falsche Strich hinaus.

   Von außen sieht man davon nichts. Der Fehler zeigt sich erst beim
   anderen, und dann als „mein Strich ist verschwunden" – ohne dass
   irgendwo etwas gemeldet worden wäre. Genau dafür ist dieser Test da.

   Geprüft wird gegen website/js/share.js, die von npm run sync-share
   erzeugte Kopie – dieselbe Quelle wie in test-doc-split.js.

   Aufruf:  node scripts/test-ink-diff.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'website', 'js', 'share.js'), 'utf8'
);

/** Schneidet eine Funktion samt Körper aus dem Quelltext.
    Wortgleich zu test-doc-split.js – share.js ist ein ES-Modul, das beim
    Laden Firebase von einer CDN-Adresse holt, und das geht in Node nicht. */
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

const NAMES = ['inkPlan', 'inkSignatureOf', 'kurzhash', 'fingerprintNotebook',
  // Die beiden Hälften des Merkzettels; fingerprintNotebook ruft sie
  'fingerprintSeite', 'fingerprintRahmen',
  'signatureOf', 'isInlineData',
  // Die Unterschrift einer Seite zaehlt die Kommentare mit
  'commentsForPage'];

const sandbox = { console, JSON };
vm.createContext(sandbox);
vm.runInContext(NAMES.map(extract).join('\n\n'), sandbox);

const { inkPlan, inkSignatureOf, fingerprintNotebook } = sandbox;

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

/** Ein Strich, unterscheidbar an seiner Kennung. */
function strich(id) {
  return { id, path: [{ x: id.length, y: 1, p: 0.5 }], color: '#000', width: 2, isHL: false };
}

/** Der Merkzettel-Eintrag zu einer Strichliste. */
function merkzettel(strokes) {
  return { sig: 'egal', strokes: strokes.length, inkSig: inkSignatureOf(strokes) };
}

/** Wie der Plan ausfällt, wenn `vorher` gesichert war und jetzt `nachher` daliegt. */
function plan(vorher, nachher) {
  return inkPlan(nachher, merkzettel(vorher), inkSignatureOf(nachher));
}

console.log('Der alte Zaehlerstand hat zwei Faelle verschluckt');

{
  // 1. Radieren und neu zeichnen: die ANZAHL bleibt gleich
  const vorher = [strich('a'), strich('b'), strich('c')];
  const nachher = [strich('a'), strich('c'), strich('neu')];
  check('Gleiche Anzahl, andere Striche: neu schreiben',
    plan(vorher, nachher), { was: 'neu', ab: 0 });
}

{
  // 2. Einen alten radieren und zwei neue ziehen: die Anzahl WAECHST,
  //    der Anfang ist trotzdem ein anderer
  const vorher = [strich('a'), strich('b'), strich('c')];
  const nachher = [strich('a'), strich('c'), strich('n1'), strich('n2')];
  check('Gewachsen, aber der Anfang stimmt nicht: neu schreiben',
    plan(vorher, nachher), { was: 'neu', ab: 0 });
}

console.log('\nDer gewoehnliche Fall bleibt sparsam');

{
  const vorher = [strich('a'), strich('b')];
  const nachher = [strich('a'), strich('b'), strich('c'), strich('d')];
  check('Nur angehaengt: ab der bisherigen Laenge',
    plan(vorher, nachher), { was: 'anhaengen', ab: 2 });
}

{
  const strokes = [strich('a'), strich('b')];
  check('Unveraendert: gar nichts',
    plan(strokes, strokes), { was: 'nichts', ab: 0 });
}

{
  check('Leer geblieben: gar nichts',
    plan([], []), { was: 'nichts', ab: 0 });
}

{
  const vorher = [strich('a'), strich('b'), strich('c')];
  check('Alles radiert: neu schreiben',
    plan(vorher, []), { was: 'neu', ab: 0 });
}

{
  const vorher = [strich('a'), strich('b'), strich('c')];
  const nachher = [strich('a'), strich('b')];
  check('Der letzte radiert: neu schreiben',
    plan(vorher, nachher), { was: 'neu', ab: 0 });
}

{
  // Reihenfolge getauscht, sonst nichts – dieselbe Anzahl, dieselben Striche
  const vorher = [strich('a'), strich('b')];
  const nachher = [strich('b'), strich('a')];
  check('Umsortiert: neu schreiben',
    plan(vorher, nachher), { was: 'neu', ab: 0 });
}

console.log('\nEine Seite, die es im Raum noch nie gab');

{
  check('Neue Seite mit Handschrift: neu schreiben',
    inkPlan([strich('a')], undefined, inkSignatureOf([strich('a')])),
    { was: 'neu', ab: 0 });
  check('Neue Seite ohne Handschrift: gar nichts',
    inkPlan([], undefined, inkSignatureOf([])),
    { was: 'nichts', ab: 0 });
}

console.log('\nEin Merkzettel aus der Zeit vor der Unterschrift');

{
  /* Er liegt in den Einstellungen und ueberlebt das Update. Fuer diese
     eine Runde bleibt es beim alten Verhalten, danach traegt er die
     Unterschrift. Wichtig ist nur, dass nichts abstuerzt und dass die
     gewachsene Liste weiterhin angehaengt wird. */
  const alt = { sig: 'egal', strokes: 2 };
  const nachher = [strich('a'), strich('b'), strich('c')];
  check('Alter Merkzettel, gewachsen: anhaengen',
    inkPlan(nachher, alt, inkSignatureOf(nachher)), { was: 'anhaengen', ab: 2 });

  const gleich = [strich('a'), strich('b')];
  check('Alter Merkzettel, gleiche Anzahl: gar nichts',
    inkPlan(gleich, alt, inkSignatureOf(gleich)), { was: 'nichts', ab: 0 });

  check('Alter Merkzettel, geschrumpft: neu schreiben',
    inkPlan([strich('a')], alt, inkSignatureOf([strich('a')])), { was: 'neu', ab: 0 });
}

console.log('\nDer Merkzettel traegt die Unterschrift');

{
  const nb = {
    name: 'X', color: '#000', defaultBg: 'ruled', sections: [],
    pages: [{ id: 'p1', textContent: '<p>a</p>', objects: [], inkStrokes: [strich('a')] }]
  };
  const fp = fingerprintNotebook(nb);
  check('inkSig steht im Fingerabdruck',
    typeof fp.pages.p1.inkSig === 'string' && fp.pages.p1.inkSig.length > 0, true);
  check('Und passt zu inkSignatureOf',
    fp.pages.p1.inkSig, inkSignatureOf([strich('a')]));
  check('Die Anzahl steht weiterhin daneben', fp.pages.p1.strokes, 1);
}

console.log('');
if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
