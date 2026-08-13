#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   EIN PLATZHALTER DARF EIN ORIGINAL NICHT VERDRÄNGEN

   Prüft die Kommentar-Zusammenführung aus ui/collab.js zusammen mit
   istPlatzhalterKommentar() aus core/comments.js.

   >>> Der Fehler, um den es geht <<<
   Gemeldet als: „ich schreibe einen Kommentar, bei MIR steht als
   Ersteller ‚Unbekannt', und ich habe keinen Bearbeiten-Knopf – die
   anderen sehen aber meinen Namen."

   Der Ablauf dahinter:

     1. Ich schreibe einen Kommentar. Die MARKIERUNG geht sofort über
        Yjs hinaus, die Kommentardaten erst mit dem nächsten
        Struktur-Takt.
     2. Der andere sieht eine Markierung ohne Kommentar und baut sich
        einen Platzhalter: ohne Text, ohne Autorenkennung.
     3. SEIN Struktur-Takt läuft ab und schickt mir seine ganze Liste –
        mit dem Platzhalter darin.
     4. Meine Liste wurde eins zu eins ersetzt. Mein eigener Kommentar
        stand ab da bei mir als „Unbekannt" da.

   Und weil „gehört mir" die Autorenkennung vergleicht, verschwanden
   damit auch Bearbeiten und Löschen.

   Aufruf:  node scripts/test-kommentar-platzhalter.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

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

/* ── istPlatzhalterKommentar aus core/comments.js ──────────────────── */

const quelleComments = fs.readFileSync(path.join(root, 'src/core/comments.js'), 'utf8');

function schneide(quelle, name) {
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

/* ── Die Zusammenführung aus ui/collab.js ──────────────────────────────
   Sie steht dort mitten in einem grossen Griff und laesst sich nicht
   einzeln herausschneiden. Nachgebaut wird deshalb GENAU die Regel, und
   die Gegenprobe darunter haelt den Quelltext dagegen: steht dort keine
   Pruefung auf istPlatzhalterKommentar mehr, faellt der Test durch. */
const sandbox = { console, JSON, Number, String, Array, Boolean, Date };
vm.createContext(sandbox);
vm.runInContext(schneide(quelleComments, 'istPlatzhalterKommentar'), sandbox);
const { istPlatzhalterKommentar } = sandbox;

function fuehreZusammen(meine, fremde) {
  const bekannt = new Map(meine.map(c => [String(c.id), c]));
  return fremde.map(f => {
    const alt = bekannt.get(String(f.id));
    if (alt && istPlatzhalterKommentar(f) && !istPlatzhalterKommentar(alt)) return alt;
    return f;
  });
}

function echt(id, name) {
  return {
    id, pageId: 'p1', text: 'Mein Kommentar', zitat: 'Stelle',
    author: { uid: 'ich@example.org', name: name || 'Ich' },
    created: 1000, resolved: false, replies: []
  };
}

function platzhalter(id) {
  return {
    id, pageId: 'p1', text: '', zitat: 'Stelle',
    author: { uid: '', name: 'Unbekannt' },
    created: 2000, resolved: false, replies: []
  };
}

console.log('Was ein Platzhalter ist');
{
  check('Ohne Autorenkennung', istPlatzhalterKommentar(platzhalter('k1')), true);
  check('Mit Kennung nicht', istPlatzhalterKommentar(echt('k1')), false);
  check('Ganz ohne Autor', istPlatzhalterKommentar({ id: 'x' }), true);
  /* Ein oertliches Heft: die Kennung ist 'local', und das ist eine
     richtige Kennung. Waere sie hier ein Platzhalter, koennte niemand
     ohne Konto seine eigenen Kommentare bearbeiten. */
  check('„local" ist eine Kennung',
    istPlatzhalterKommentar({ id: 'x', author: { uid: 'local', name: 'Ich' } }), false);
}

console.log('\nDer gemeldete Fall');
{
  const meine = [echt('k1')];
  const vomAnderen = [platzhalter('k1')];
  const raus = fuehreZusammen(meine, vomAnderen);

  check('Mein Kommentar bleibt meiner', raus[0].author.uid, 'ich@example.org');
  check('Mit meinem Namen', raus[0].author.name, 'Ich');
  check('Und mit seinem Text', raus[0].text, 'Mein Kommentar');
}

console.log('\nUmgekehrt gewinnt das Original ebenfalls');
{
  // Ich halte den Platzhalter, der andere hat das Original
  const raus = fuehreZusammen([platzhalter('k1')], [echt('k1', 'Manuel')]);
  check('Das Original setzt sich durch', raus[0].author.name, 'Manuel');
  check('Samt Text', raus[0].text, 'Mein Kommentar');
}

console.log('\nWas weiterhin funktionieren muss');
{
  // Eine echte Aenderung des anderen kommt an
  const geaendert = { ...echt('k1'), text: 'Doch anders', edited: 5000 };
  const raus = fuehreZusammen([echt('k1')], [geaendert]);
  check('Eine echte Aenderung kommt durch', raus[0].text, 'Doch anders');

  // Geloeschtes bleibt geloescht: die fremde Liste sagt, WAS es gibt
  const leer = fuehreZusammen([echt('k1')], []);
  check('Geloescht bleibt geloescht', leer.length, 0);

  // Ein neuer fremder Kommentar kommt dazu
  const dazu = fuehreZusammen([echt('k1')], [echt('k1'), echt('k2', 'Lena')]);
  check('Ein neuer kommt dazu', dazu.length, 2);
  check('Mit seinem Verfasser', dazu[1].author.name, 'Lena');
}

console.log('\nDie Regel steht wirklich im Quelltext');
{
  const collab = fs.readFileSync(path.join(root, 'src/ui/collab.js'), 'utf8');
  check('collab.js fragt nach Platzhaltern',
    collab.includes('istPlatzhalterKommentar'), true);
  check('Und schickt keine hinaus',
    collab.includes('echteKommentare'), true);

  const share = fs.readFileSync(path.join(root, 'src/core/share.js'), 'utf8');
  check('share.js sichert keine Platzhalter',
    /c\.author && c\.author\.uid/.test(share), true);
}

console.log('');
if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
