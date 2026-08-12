#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   EIN ANDERES KONTO, EINE ANDERE ÜBERSICHT

   Ein Heft, das in einer Cloud liegt, gehört zu dem Konto, in dem es
   liegt. Wer sich mit einer anderen Adresse anmeldet, sah bisher trotzdem
   den ganzen alten Bestand: die Dateien liegen weiter auf der Platte, und
   die Übersicht kommt aus der örtlichen Merkliste.

   >>> Warum das eine Prüfung wert ist <<<
   Es sind zwei Fehler in einem, und der zweite ist der schlimmere:

     · Man SIEHT die Hefte des anderen Kontos.
     · Der nächste Abgleich hätte sie in die neue Cloud KOPIERT – jedes
       Heft des einen Menschen im Konto des anderen. Deshalb hält
       dieselbe Frage auch das Hochladen an (queueNotebook).

   Geprüft wird core/data.js für sich, mit einem nachgebauten CloudSync_.

   Aufruf:  node scripts/test-account-switch.js
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

/* ── core/data.js für sich laden ────────────────────────────────────
   Nachgebaut wird nur, was die Frage „gehört das hierher?" anfasst. */
function ladeDaten() {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Array, Object, Set, Map,
    S: { notebooks: [], activeNbId: null },
    CloudSync_: { _konto: '', kontoSchluessel() { return this._konto; } },
    t: (k) => k,
    uid: () => 'x' + Math.random().toString(36).slice(2),
    CFG: { PAGE_W: 794, PAGE_H: 1123, HDR: 64 }
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core/data.js'), 'utf8'), ctx);
  return ctx;
}

console.log('Ein anderes Konto, eine andere Uebersicht');

const ctx = ladeDaten();
ctx.S.notebooks = [
  { id: 'nie', name: 'Nie hochgeladen', pages: [] },
  { id: 'einsA', name: 'Konto A', pages: [], syncedAt: '2026-01-01', cloudKonto: 'google:A' },
  { id: 'zweiA', name: 'Auch Konto A', pages: [], syncedAt: '2026-01-01', cloudKonto: 'google:A' },
  { id: 'einsB', name: 'Konto B', pages: [], syncedAt: '2026-01-01', cloudKonto: 'google:B' },
  { id: 'geteilt', name: 'Fremdes Dokument', pages: [], origin: 'shared' }
];

const sichtbar = () => ctx.ownNotebooks().map(nb => nb.id);

ctx.CloudSync_._konto = 'google:A';
check('Mit Konto A stehen nur A und das nie hochgeladene da',
  sichtbar(), ['nie', 'einsA', 'zweiA']);

ctx.CloudSync_._konto = 'google:B';
check('Nach dem Wechsel zu B ebenso, nur eben Bs',
  sichtbar(), ['nie', 'einsB']);

ctx.CloudSync_._konto = 'microsoft:A';
check('Dieselbe Kennung bei einem anderen Anbieter ist ein anderer Mensch',
  sichtbar(), ['nie']);

ctx.CloudSync_._konto = '';
check('Ohne Anmeldung gibt es kein fremdes Konto – alles steht da',
  sichtbar(), ['nie', 'einsA', 'zweiA', 'einsB']);

// Und die Frage selbst, wie cloudSync sie vor jedem Hochladen stellt
ctx.CloudSync_._konto = 'google:A';
check('Ein Heft aus B darf nicht in die Cloud von A',
  ctx.fremdesKonto(ctx.S.notebooks[3]), true);
check('Ein Heft aus A schon',
  ctx.fremdesKonto(ctx.S.notebooks[1]), false);
check('Und ein nie hochgeladenes immer',
  ctx.fremdesKonto(ctx.S.notebooks[0]), false);

if (failed) {
  console.error(`\n${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
