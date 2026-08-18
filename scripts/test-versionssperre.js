#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   GLEICHE FASSUNG ODER GAR NICHT

   Prüft versionPasst() aus core/share.js – die Sperre, die ein geteiltes
   Dokument zumacht, wenn Besitzer und Gast nicht dieselbe Fassung von
   Inkwells haben.

   >>> Warum in BEIDE Richtungen gesperrt wird <<<
   Ein geteiltes Dokument ist kein Dateiformat, das man verträglich
   halten kann, sondern ein laufender Raum: Yjs-Stände, ein
   Änderungsstrom, eine Rollenliste, ein Merkzettel. Schreiben zwei
   verschiedene Fassungen hinein, merkt das niemand sofort – sondern
   Tage später an fehlender Arbeit. „Meine ist neuer, also darf ich
   wenigstens lesen" hilft dabei nicht: wer schreibt, schreibt in einer
   Form, die der andere nicht kennt.

   Aufruf:  node scripts/test-versionssperre.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const quelle = fs.readFileSync(
  path.join(__dirname, '..', 'website', 'js', 'share.js'), 'utf8'
);

function extract(name) {
  const start = quelle.search(new RegExp(`(async )?function ${name}\\(`));
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

/** Baut versionPasst() mit einer vorgegebenen eigenen Fassung. */
function mitEigener(version) {
  const ctx = {
    console, Math, Number, String, JSON, Promise,
    // eigeneAppVersion() wird ersetzt: hier gibt es kein window.api
    eigeneAppVersion: async () => version
  };
  vm.createContext(ctx);
  vm.runInContext(extract('versionPasst'), ctx);
  return ctx.versionPasst;
}

(async () => {

  console.log('Dieselbe Fassung – herein');
  {
    const passt = mitEigener('1.1.1');
    check('Genau gleich', (await passt({ appVersion: '1.1.1' })).ok, true);
  }

  console.log('\nVerschiedene Fassungen – zu, egal welche Richtung');
  {
    const alt = mitEigener('1.1.0');
    const u1 = await alt({ appVersion: '1.1.1' });
    check('Ich bin aelter: gesperrt', u1.ok, false);
    check('Und der Satz meint mich', u1.wer, 'ich');
    check('Beide Fassungen stehen im Urteil', [u1.meine, u1.ihre], ['1.1.0', '1.1.1']);

    const neu = mitEigener('1.2.0');
    const u2 = await neu({ appVersion: '1.1.1' });
    check('Ich bin neuer: trotzdem gesperrt', u2.ok, false);
    check('Und der Satz meint den Besitzer', u2.wer, 'besitzer');
  }

  console.log('\nDie Zahlen werden als ZAHLEN verglichen');
  {
    /* 1.10.0 kommt NACH 1.9.0. Als Zeichenkette waere es davor, und der
       Satz saehe genau verkehrt herum aus. */
    const zehn = mitEigener('1.10.0');
    check('1.10.0 ist neuer als 1.9.0', (await zehn({ appVersion: '1.9.0' })).wer, 'besitzer');

    const neun = mitEigener('1.9.0');
    check('Und andersherum', (await neun({ appVersion: '1.10.0' })).wer, 'ich');
  }

  console.log('\nWo NICHT gesperrt wird');
  {
    /* Ein Dokument aus der Zeit vor der Sperre traegt keine Angabe.
       Wuerde es hier zugehen, waere jedes bestehende Dokument mit einem
       Schlag fuer alle zu – und niemand kaeme mehr an seine Sachen. */
    const passt = mitEigener('1.1.1');
    check('Kopf ohne Angabe', (await passt({})).ok, true);
    check('Leere Angabe', (await passt({ appVersion: '' })).ok, true);
    check('Nur Leerzeichen', (await passt({ appVersion: '   ' })).ok, true);

    // Und wenn die eigene Fassung nicht zu ermitteln ist: auch offen
    const ohne = mitEigener('');
    check('Eigene Fassung unbekannt', (await ohne({ appVersion: '1.1.1' })).ok, true);
  }

  console.log('\nDie Sperre haengt am Oeffnen, nicht am Weg dorthin');
  {
    /* Kachel und Link laufen beide durch openSharedDocument – dort steht
       die Pruefung. Waere sie an einem der beiden Wege, liesse sie sich
       ueber den anderen umgehen. */
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'ui', 'sharedDocs.js'), 'utf8');
    const stelle = shared.indexOf('async function openSharedDocument(head)');
    check('openSharedDocument gibt es', stelle > -1, true);
    const kopf = shared.slice(stelle, stelle + 300);
    check('Und es fragt als Erstes die Sperre',
      /versionsSperre\(head\)/.test(kopf), true);
  }

  console.log('');
  if (failed) {
    console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('Alle Pruefungen bestanden.');
})();
