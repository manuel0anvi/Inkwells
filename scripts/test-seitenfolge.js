#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   EIN GEMISCHTES HEFT BLEIBT GEMISCHT

   >>> Gemeldet: „auf der Website kommen erst alle Seiten von Abschnitt 1,
   dann alle vom nächsten“ <<<
   Seit Abschnitte Etiketten sind, ist notebook.pages die Reihenfolge. Wer
   über section.pgIds geht, gruppiert die Seiten – das tat pagesInOrder()
   beim Teilen. Ältere Hefte haben dagegen KEINE andere Quelle als die
   Abschnitte; für sie muss der Umweg bleiben.

   Aufruf:  node scripts/test-seitenfolge.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const quelle = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'share.js'), 'utf8');

function extract(name) {
  const start = quelle.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Funktion ${name} nicht gefunden`);
  let tiefe = 0, gesehen = false;
  for (let i = start; i < quelle.length; i++) {
    if (quelle[i] === '{') { tiefe++; gesehen = true; }
    if (quelle[i] === '}' && --tiefe === 0 && gesehen) return quelle.slice(start, i + 1);
  }
  throw new Error(`Funktion ${name} nicht abgeschlossen`);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(extract('pagesInOrder') + extract('gruppierteSeitenfolge'), ctx);

let fehler = 0;
function pruefe(titel, ist, soll) {
  const gut = JSON.stringify(ist) === JSON.stringify(soll);
  console.log(`  ${gut ? '✓' : '✗'} ${titel}`);
  if (!gut) { fehler++; console.log('    ist: ', ist, ' soll:', soll); }
}
const ids = (nb) => Array.from(ctx.pagesInOrder(nb)).map(p => p.id);

const seiten = [
  { id: 'a', secId: 's1' }, { id: 'b', secId: 's2' },
  { id: 'c', secId: 's1' }, { id: 'd', secId: 's2' }
];
const abschnitte = [{ id: 's1', pgIds: ['a', 'c'] }, { id: 's2', pgIds: ['b', 'd'] }];

console.log('Reihenfolge beim Teilen');
pruefe('Umgestelltes Heft bleibt gemischt',
  ids({ schemaVersion: 2, pages: seiten, sections: abschnitte }), ['a', 'b', 'c', 'd']);
pruefe('Altes Heft folgt weiter den Abschnitten',
  ids({ pages: [{ id: 'x' }, { id: 'y' }, { id: 'z' }], sections: [{ id: 's', pgIds: ['z', 'x'] }] }),
  ['z', 'x', 'y']);
pruefe('Kein Heft: keine Seiten', ids(null), []);

console.log('Schon geteilte Hefte');
const heft = { schemaVersion: 2, pages: seiten, sections: abschnitte };
const korrektur = (oben) => {
  const r = ctx.gruppierteSeitenfolge(heft, oben);
  return r ? Array.from(r) : null;
};
pruefe('Die alte gruppierte Reihenfolge wird korrigiert', korrektur(['a', 'c', 'b', 'd']), ['a', 'b', 'c', 'd']);
pruefe('Stimmt sie schon, geschieht nichts', korrektur(['a', 'b', 'c', 'd']), null);
pruefe('Hat ein Bearbeiter umsortiert, bleibt es dabei', korrektur(['d', 'a', 'b', 'c']), null);
pruefe('Fehlt die Angabe, geschieht nichts', korrektur(undefined), null);
pruefe('Ein altes Heft wird nicht angefasst',
  ctx.gruppierteSeitenfolge({ pages: seiten, sections: abschnitte }, ['a', 'c', 'b', 'd']), null);

if (fehler) { console.error(`${fehler} Pruefung(en) fehlgeschlagen.`); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
