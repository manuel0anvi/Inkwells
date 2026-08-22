#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ENTBANNEN HOLT ZURÜCK, WAS WAR

   Prüft entbannPlan() aus core/share.js.

   >>> Warum das einen eigenen Test verdient <<<
   Aufgehoben wurde bisher nur die Sperre. Die Person war danach weder
   Mitglied noch gesperrt und verschwand aus beiden Listen: wer per
   E-Mail eingeladen war, musste neu eingetippt werden; wer über den Link
   kam, musste den Link noch einmal öffnen, und bis dahin stand das
   Dokument bei ihm nirgends. Beides ist gemeldet worden.

   Vier Dinge dürfen nie schiefgehen:

     · Die Rolle kommt zurück, die derjenige hatte – nicht die Vorgabe.
       Ein Bearbeiter, der als Leser zurückkommt, merkt es erst, wenn er
       schreiben will.
     · Der WEG kommt zurück. Wer über den Link kam, muss ihn danach
       nicht noch einmal öffnen.
     · Die Sperre ist wirklich weg – sonst kommt er trotzdem nicht
       herein, und niemand sieht warum.
     · Eine Sperre aus der Zeit vor blockedInfo löst sich weiterhin,
       ohne die Mitgliedschaft zu erfinden.

   Geprüft wird gegen website/js/share.js, die von npm run sync-share
   erzeugte Kopie – dieselbe Quelle wie in test-ink-diff.js.

   Aufruf:  node scripts/test-entbannen.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'website', 'js', 'share.js'), 'utf8'
);

/** Schneidet eine Funktion samt Körper aus dem Quelltext.
    Wortgleich zu test-ink-diff.js – share.js ist ein ES-Modul, das beim
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

const NAMES = ['entbannPlan', 'normalizeEmail', 'normalizeRole'];
const sandbox = { console, JSON };
vm.createContext(sandbox);
vm.runInContext('const ROLES = ["view","edit"];\n' + NAMES.map(extract).join('\n\n'), sandbox);
const { entbannPlan } = sandbox;

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
    console.error(`      erwartet: ${JSON.stringify(expected)}`);
    console.error(`      bekommen: ${JSON.stringify(actual)}`);
  }
}

/** Ein Kopf, in dem zwei Leute hinausgeworfen wurden. */
function kopf(extra = {}) {
  return Object.assign({
    memberEmails: ['bleibt@example.com'],
    members: { 'bleibt@example.com': 'view' },
    memberVia: { 'bleibt@example.com': 'invite' },
    blockedEmails: ['perpost@example.com', 'perlink@example.com'],
    blockedInfo: {
      'perpost@example.com': { role: 'edit', via: 'invite' },
      'perlink@example.com': { role: 'view', via: 'link' }
    }
  }, extra);
}

console.log('\nWer eingeladen war, ist wieder eingeladen');
{
  const p = entbannPlan(kopf(), 'perpost@example.com');
  check('Er zaehlt wieder als Mitglied', p.wieder, 'mitglied');
  check('Mit seiner alten Rolle, nicht der Vorgabe', p.role, 'edit');
  check('Und auf demselben Weg', p.via, 'invite');
  check('Er steht wieder in der Liste',
    p.patch.memberEmails.includes('perpost@example.com'), true);
  check('Mit Bearbeitungsrecht', p.patch.members['perpost@example.com'], 'edit');
  check('Die Sperre ist weg', p.patch.blockedEmails, ['perlink@example.com']);
  check('Und der Merkzettel dazu auch',
    Object.keys(p.patch.blockedInfo), ['perlink@example.com']);
  check('Der andere Gesperrte bleibt gesperrt',
    p.patch.blockedEmails.includes('perlink@example.com'), true);
  check('Und wer nie weg war, bleibt unangetastet',
    p.patch.members['bleibt@example.com'], 'view');
}

console.log('\nWer ueber den Link kam, muss ihn nicht neu oeffnen');
{
  const p = entbannPlan(kopf(), 'perlink@example.com');
  check('Er zaehlt wieder als Mitglied', p.wieder, 'mitglied');
  check('Der Weg bleibt der Link', p.patch.memberVia['perlink@example.com'], 'link');
  check('Mit seiner alten Rolle', p.patch.members['perlink@example.com'], 'view');
  check('Er steht wieder in der Liste',
    p.patch.memberEmails.includes('perlink@example.com'), true);
}

console.log('\nGross- und Kleinschreibung, Leerzeichen');
{
  const p = entbannPlan(kopf(), '  PerPost@Example.COM ');
  check('Dieselbe Adresse wird erkannt', p.wieder, 'mitglied');
  check('Und klein eingetragen',
    p.patch.memberEmails.includes('perpost@example.com'), true);
}

console.log('\nEine Sperre ohne Merkzettel loest sich nur');
{
  const alt = kopf({ blockedInfo: {} });
  const p = entbannPlan(alt, 'perpost@example.com');
  check('Keine Mitgliedschaft erfunden', p.wieder, 'nurFrei');
  check('Die Mitgliederliste bleibt unberuehrt',
    p.patch.memberEmails, undefined);
  check('Aber die Sperre ist weg',
    p.patch.blockedEmails.includes('perpost@example.com'), false);
}

console.log('\nEin unsinniger Merkzettel wird zurechtgerueckt');
{
  const wirr = kopf({
    blockedInfo: { 'perpost@example.com': { role: 'chef', via: 'brieftaube' } }
  });
  const p = entbannPlan(wirr, 'perpost@example.com');
  check('Eine erfundene Rolle wird zur Leserolle', p.role, 'view');
  check('Und ein erfundener Weg zur Einladung', p.via, 'invite');
}

console.log('\nWer gar nicht gesperrt war');
{
  const p = entbannPlan(kopf(), 'niemand@example.com');
  check('Es wird nichts erfunden', p.wieder, 'nurFrei');
  check('Und die Sperrliste bleibt, wie sie war',
    p.patch.blockedEmails, ['perpost@example.com', 'perlink@example.com']);
}

console.log(failed === 0 ? '\nAlle Pruefungen bestanden.\n' : `\n${failed} Pruefung(en) fehlgeschlagen.\n`);
process.exit(failed === 0 ? 0 : 1);
