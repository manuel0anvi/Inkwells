#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   BEIM ZUMACHEN GEHT DAS HEFT SOFORT HINAUF

   Prüft flushNotebook() in core/cloudSync.js.

   >>> Worum es geht <<<
   Hochgeladen wird von selbst: zwei Sekunden nach der letzten Änderung
   meldet AutoSave das Heft an, die Warteschlange läuft alle fünf
   Sekunden. Gebremst wird nur die WIEDERHOLUNG desselben Hefts –
   höchstens einmal je Minute, weil jedes Mal das ganze Heft über die
   Leitung geht (MIN_UPLOAD_INTERVAL_MS).

   Solange man im Heft schreibt, ist das richtig. Beim Zumachen ist es
   falsch: dort schreibt niemand mehr, und ein fertiges Heft bliebe bis
   zu einer Minute ungesichert liegen.

   >>> Die Lücke, die das hier festhält <<<
   ui/titlebar.js rief AutoSave.saveNow() nur, wenn das Heft als GEÄNDERT
   galt. War es lokal längst gespeichert und hing nur der Upload an der
   Bremse, geschah gar nichts – genau dazwischen fiel das Heft hindurch.
   showHome() deckt jetzt beide Fälle ab.

   >>> Und was NICHT passieren darf <<<
   Ein Heft, an dem sich nichts geändert hat, darf beim Weg zur Übersicht
   nicht hochgeladen werden. Sonst ginge bei jedem Blick auf die
   Startseite das ganze Heft über die Leitung.

   Aufruf:  node scripts/test-cloud-flush.js
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

/**
 * core/cloudSync.js für sich laden. Nachgebaut wird nur, was die Datei
 * beim Laden anfasst – nicht das halbe Programm: init() läuft hier nie,
 * also gibt es weder Taktgeber noch Netz.
 */
function ladeCloudSync() {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Array, Object, Set, Map, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Blob: function () { return { size: 0 }; },

    // Was cloudSync.js aus dem übrigen Haus erwartet
    Settings: { get: () => '', update: async () => {} },
    getNb: () => null,
    isSharedNotebook: () => false,
    uid: () => 'x',
    t: (k) => k,
    toast: () => {},
    CLOUD_PROVIDERS: ['google', 'microsoft'],
    defaultCloudProvider: () => 'google',
    GoogleDriveProvider: { id: 'google', label: 'Google Drive', isConfigured: () => true },
    OneDriveProvider: { id: 'microsoft', label: 'OneDrive', isConfigured: () => true },
    navigator: { onLine: true },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    document: { addEventListener() {} }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src', 'core', 'cloudSync.js'), 'utf8'), ctx);
  return ctx.CloudSync_;
}

/** Ein Exemplar, bei dem das Abarbeiten nur mitgeschrieben wird. */
function frisch() {
  const cs = ladeCloudSync();
  cs.laeufe = 0;
  cs._processQueue = () => { cs.laeufe++; };
  return cs;
}

(async () => {
  console.log('Ein wartendes Heft sofort hochladen');

  {
    const cs = frisch();
    cs.syncQueue = [{ nbId: 'nb1', nbName: 'Mathematik', action: 'upload', queuedAt: '' }];
    // Gerade eben hochgeladen: die Bremse greift
    cs.lastUploadAt.set('nb1', Date.now());
    check('Die Bremse greift zunächst', cs._isUploadDue('nb1'), false);

    check('flushNotebook meldet, dass es etwas angestossen hat',
      cs.flushNotebook('nb1'), true);
    check('Danach ist es fällig, trotz Bremse', cs._isUploadDue('nb1'), true);
    check('Und die Warteschlange wurde angestossen', cs.laeufe, 1);
  }

  console.log('\nWas dabei NICHT passieren darf');

  {
    const cs = frisch();
    // Nichts wartet – der Weg zur Uebersicht darf nichts hochladen
    cs.syncQueue = [];
    check('Ein Heft ohne offene Aenderung wird nicht hochgeladen',
      cs.flushNotebook('nb1'), false);
    check('Und die Warteschlange bleibt in Ruhe', cs.laeufe, 0);
    check('Es wird auch nichts vorgemerkt', cs.immediateUploads.has('nb1'), false);
  }

  {
    const cs = frisch();
    cs.syncQueue = [{ nbId: 'nb2', nbName: 'Physik', action: 'upload', queuedAt: '' }];
    check('Ein FREMDES Heft stösst nichts an', cs.flushNotebook('nb1'), false);
    check('Die Warteschlange bleibt in Ruhe', cs.laeufe, 0);
  }

  {
    const cs = frisch();
    check('Ohne Kennung passiert nichts', cs.flushNotebook(null), false);
    check('Und auch nichts bei leerer Kennung', cs.flushNotebook(''), false);
    check('Die Warteschlange bleibt in Ruhe', cs.laeufe, 0);
  }

  console.log('\nAeltere Eintraege in der Warteschlange');

  {
    /* Eintraege aus einer frueheren Fassung sind reine Zeichenketten.
       flushNotebook muss sie genauso finden - sonst bliebe genau das
       Heft liegen, das einen Neustart ueberdauert hat. */
    const cs = frisch();
    cs.syncQueue = ['nb1'];
    cs.lastUploadAt.set('nb1', Date.now());
    check('Auch ein alter String-Eintrag wird gefunden',
      cs.flushNotebook('nb1'), true);
    check('Und ist danach fällig', cs._isUploadDue('nb1'), true);
  }

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})();
