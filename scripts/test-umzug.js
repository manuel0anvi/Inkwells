#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Prüft den Umzug des Datenordners von "Inkwell" nach "Inkwells".

   Die App hieß bis 1.1.1 Inkwell. Wer aktualisiert, muss seine Hefte,
   Einstellungen und Anmeldung wiederfinden – sonst sieht es aus, als
   wäre alles weg. Genau das darf nie passieren, und deshalb steht die
   Prüfung hier und nicht nur im Kopf.

   Warum die Funktionen von Hand herausgeschnitten werden:
   main.js ist der Hauptprozess von Electron und lässt sich in Node nicht
   laden. Der Umzug selbst kennt weder app noch BrowserWindow – er
   arbeitet nur mit fs, path und LOCALAPPDATA und lässt sich deshalb
   einzeln herauslösen.

   Aufruf:  node scripts/test-umzug.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const quelle = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

/** Schneidet eine Funktion samt Körper aus dem Quelltext. */
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

/** Baut einen frischen Spielplatz und führt den Umzug darin aus. */
function umzugMit(aufbau) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwells-umzug-'));
  aufbau(wurzel);

  const sandbox = {
    fs, path, console: { log() {}, warn() {}, error() {} },
    process: { platform: 'win32', env: { LOCALAPPDATA: wurzel } }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    [extract('benenneUm'), extract('migriereAltenDatenordner')].join('\n\n')
      + '\nmigriereAltenDatenordner();',
    sandbox
  );

  return wurzel;
}

const schreib = (datei, inhalt) => {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, inhalt, 'utf-8');
};
const gibt = (p) => fs.existsSync(p);
const lies = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null);

/* ── 1. Der übliche Fall ────────────────────────────────────────────── */

console.log('Ein Nutzer aktualisiert von Inkwell auf Inkwells');

let w = umzugMit((wurzel) => {
  const alt = path.join(wurzel, 'Inkwell', 'UserData');
  schreib(path.join(alt, 'inkwell-settings.json'),
    JSON.stringify({ saveLocation: 'C:\\Users\\x\\Documents\\Inkwell', language: 'de' }));
  schreib(path.join(alt, 'inkwell-registry.json'),
    JSON.stringify({ notebooks: [{ id: 'a', path: path.join(wurzel, 'Inkwell', 'UserData', 'Hefte', 'Mathe.jrnl') }] }));
  schreib(path.join(alt, 'Hefte', 'Mathe.jrnl'), '{"notebooks":[]}');
});

check('Der alte Ordner ist weg', gibt(path.join(w, 'Inkwell')), false);
check('Der neue Ordner ist da', gibt(path.join(w, 'Inkwells')), true);
check('Das Heft ist mitgekommen',
  gibt(path.join(w, 'Inkwells', 'UserData', 'Hefte', 'Mathe.jrnl')), true);
check('Die Einstellungen heißen jetzt inkwells-',
  gibt(path.join(w, 'Inkwells', 'UserData', 'inkwells-settings.json')), true);
check('Die Übersicht heißt jetzt inkwells-',
  gibt(path.join(w, 'Inkwells', 'UserData', 'inkwells-registry.json')), true);
check('Kein alter Dateiname bleibt liegen',
  gibt(path.join(w, 'Inkwells', 'UserData', 'inkwell-settings.json')), false);

/* Der Pfad in der Übersicht zeigte in den ALTEN Ordner. Bleibt er stehen,
   findet die App das Heft nicht mehr – die Karte wäre da, das Heft leer. */
const uebersicht = JSON.parse(lies(path.join(w, 'Inkwells', 'UserData', 'inkwells-registry.json')));
check('Der Pfad in der Übersicht zeigt in den neuen Ordner',
  uebersicht.notebooks[0].path.includes(path.join(w, 'Inkwells')), true);

/* Der Speicherort unter Dokumente wird NICHT umgezogen – der bleibt, wo
   er ist, damit die absoluten Pfade dorthin gültig bleiben. */
const einst = JSON.parse(lies(path.join(w, 'Inkwells', 'UserData', 'inkwells-settings.json')));
check('Der Ordner unter Dokumente bleibt unangetastet',
  einst.saveLocation, 'C:\\Users\\x\\Documents\\Inkwell');

/* ── 2. Zweiter Start ───────────────────────────────────────────────── */

console.log('\nBeim zweiten Start passiert nichts mehr');

w = umzugMit((wurzel) => {
  schreib(path.join(wurzel, 'Inkwells', 'UserData', 'inkwells-settings.json'), '{"language":"de"}');
  // Ein alter Ordner liegt noch daneben – der darf NICHT den neuen ersetzen
  schreib(path.join(wurzel, 'Inkwell', 'UserData', 'inkwell-settings.json'), '{"language":"it"}');
});

check('Der neue Ordner bleibt unberührt',
  JSON.parse(lies(path.join(w, 'Inkwells', 'UserData', 'inkwells-settings.json'))).language, 'de');
check('Der alte Ordner wird nicht angefasst',
  gibt(path.join(w, 'Inkwell', 'UserData', 'inkwell-settings.json')), true);

/* ── 3. Frische Installation ────────────────────────────────────────── */

console.log('\nEine frische Installation hat nichts umzuziehen');

w = umzugMit(() => {});
check('Es entsteht kein Ordner aus dem Nichts', gibt(path.join(w, 'Inkwells')), false);

/* ── 4. Profile ─────────────────────────────────────────────────────── */

console.log('\nProfile kommen mit');

w = umzugMit((wurzel) => {
  schreib(path.join(wurzel, 'Inkwell', 'UserData', 'inkwell-settings.json'), '{"language":"de"}');
  schreib(path.join(wurzel, 'Inkwell', 'Profiles', 'zweite', 'UserData', 'inkwell-settings.json'),
    '{"language":"en"}');
});

check('Das Profil ist mitgekommen',
  gibt(path.join(w, 'Inkwells', 'Profiles', 'zweite', 'UserData', 'inkwells-settings.json')), true);
check('Auch dort ist der alte Name weg',
  gibt(path.join(w, 'Inkwells', 'Profiles', 'zweite', 'UserData', 'inkwell-settings.json')), false);

/* ── Urteil ─────────────────────────────────────────────────────────── */

if (failed) {
  console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
