#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Hält die gemeinsam genutzten Module von Website und App gleich.

   Manches wird an zwei Stellen gebraucht:
     · website/js/share.js  ↔  src/core/share.js   Freigabe über Firestore
     · website/js/docx.js   ↔  src/core/docx.js    Word-Export

   Die App wird ohne den Ordner website/ ausgeliefert (electron-builder
   nimmt nur src/**), deshalb geht es nicht mit einer einzigen Datei.
   Kopierte Logik läuft aber auseinander – genau daher kam der Fehler mit
   den PDF-Seiten, die im Web an der falschen Stelle standen. Dieses
   Skript hält beide gleich und meldet sich, wenn sie es nicht mehr sind.

   Aufruf:
     node scripts/sync-share.js          kopiert Website -> App
     node scripts/sync-share.js --check  prüft nur, Rückgabewert 1 bei Abweichung
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const PAIRS = [
  { source: ['website', 'js', 'share.js'], target: ['src', 'core', 'share.js'] },
  { source: ['website', 'js', 'docx.js'], target: ['src', 'core', 'docx.js'] }
];

function header(sourceRel) {
  return `/* ══════════════════════════════════════════════════════════════════════
   ⚠  ERZEUGTE DATEI – NICHT HIER BEARBEITEN

   Wortgleiche Kopie von ${sourceRel}. Die App wird ohne den
   Ordner website/ ausgeliefert (siehe electron-builder.config.js),
   deshalb braucht sie ein eigenes Exemplar.

   Änderungen gehören nach ${sourceRel}. Danach:
       npm run sync-share
   Der Build prüft beim Packen, ob beide Fassungen gleich sind.
   ══════════════════════════════════════════════════════════════════════ */

`;
}

const checkOnly = process.argv.includes('--check');
let stale = 0;

for (const pair of PAIRS) {
  const source = path.join(root, ...pair.source);
  const target = path.join(root, ...pair.target);
  const sourceRel = pair.source.join('/');
  const targetRel = pair.target.join('/');

  if (!fs.existsSync(source)) {
    console.error(`[sync-share] Quelle fehlt: ${sourceRel}`);
    process.exit(1);
  }

  const expected = header(sourceRel) + fs.readFileSync(source, 'utf8');
  const actual = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

  if (expected === actual) {
    console.log(`[sync-share] ${targetRel} ist aktuell.`);
    continue;
  }

  if (checkOnly) {
    console.error(`[sync-share] ${targetRel} weicht von ${sourceRel} ab.`);
    stale++;
    continue;
  }

  fs.writeFileSync(target, expected);
  console.log(`[sync-share] ${targetRel} aktualisiert.`);
}

if (stale > 0) {
  console.error('[sync-share] Bitte "npm run sync-share" ausführen.');
  process.exit(1);
}
