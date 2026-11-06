#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   JEDE DATEI DER OBERFLÄCHE LÄSST SICH WENIGSTENS LESEN

   Die Oberfläche besteht aus Skripten, die index.html der Reihe nach lädt.
   Ein einziger Syntaxfehler nimmt die ganze Datei mit, und mit ihr alles, was
   darin steht – der Rest der App startet dann ohne sie. Die übrigen Prüfungen
   in `npm test` ziehen sich nur einzelne Funktionen heraus und merken davon
   nichts; erst der Rundgang im echten Fenster fällt darüber.

   Module mit import (core/share.js) werden hier nur als Text geprüft: sie
   lassen sich nicht ohne ihre Abhängigkeiten aus dem Netz übersetzen.

   Aufruf:  node scripts/test-syntax.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function dateien(ordner, liste = []) {
  for (const e of fs.readdirSync(path.join(ROOT, ordner), { withFileTypes: true })) {
    const rel = path.join(ordner, e.name);
    if (e.isDirectory()) { if (e.name !== 'lib') dateien(rel, liste); }
    else if (e.name.endsWith('.js')) liste.push(rel);
  }
  return liste;
}

let fehler = 0, geprueft = 0;
for (const datei of ['main.js', 'preload.js', ...dateien('src')]) {
  const code = fs.readFileSync(path.join(ROOT, datei), 'utf8');
  const stumm = code.split(/\r?\n/).findIndex(z => /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(z));
  if (stumm !== -1) {
    fehler++;
    console.log(`  ✗ ${datei}:${stumm + 1}: leerer catch-Block. Melden oder in einem Kommentar sagen, warum nicht.`);
  }
  if (/^\s*import\s/m.test(code)) continue;
  geprueft++;
  try {
    new vm.Script(code, { filename: datei });
  } catch (err) {
    fehler++;
    console.log(`  ✗ ${datei}: ${err.message}`);
  }
}

if (fehler) { console.error(fehler + ' Stelle(n) zu beheben.'); process.exit(1); }
console.log(`  ✓ ${geprueft} Dateien lassen sich lesen`);
console.log('Alle Pruefungen bestanden.');
