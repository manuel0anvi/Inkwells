#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   NUR EIN ECHTES UPDATE WIRD GESTARTET – UND TOKEN LIEGEN NICHT OFFEN

   Prüft die Unterschrift in main.js gegen das Werkzeug, das sie erzeugt
   (scripts/update-signatur.js), und das Verschlüsseln der Einstellungen.

   Aufruf:  node scripts/test-update-signatur.js
   ══════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const quelle = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function extract(kopf) {
  const start = quelle.indexOf(kopf);
  if (start === -1) throw new Error('Nicht gefunden: ' + kopf);
  let tiefe = 0, gesehen = false;
  for (let i = start; i < quelle.length; i++) {
    if (quelle[i] === '{') { tiefe++; gesehen = true; }
    if (quelle[i] === '}' && --tiefe === 0 && gesehen) return quelle.slice(start, i + 1);
  }
  throw new Error('Nicht abgeschlossen: ' + kopf);
}

let fehler = 0;
function pruefe(titel, gut, hinweis) {
  console.log(`  ${gut ? '✓' : '✗'} ${titel}`);
  if (!gut) { fehler++; if (hinweis !== undefined) console.log('    ', hinweis); }
}

console.log('Die Unterschrift');
const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwells-sig-'));
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pem = path.join(ordner, 'schluessel.pem');
fs.writeFileSync(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }));
process.env.INKWELLS_UPDATE_KEY = pem;
const { unterschreibe } = require('./update-signatur.js');

const exe = path.join(ordner, 'setup.exe');
fs.writeFileSync(exe, 'ECHTES PROGRAMM');
const log = console.log; console.log = () => {};
const sigDatei = unterschreibe(exe, '1.2.3');
console.log = log;
const angabe = JSON.parse(fs.readFileSync(sigDatei, 'utf8'));
const summe = (t) => crypto.createHash('sha256').update(t).digest('hex');

const ctx = { Buffer, crypto, console: { warn() {}, error() {}, log() {} },
  UPDATE_SCHLUESSEL: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
vm.createContext(ctx);
vm.runInContext(extract('function updateText(') + extract('function updateSignaturStimmt('), ctx);
const stimmt = (a, v, s, k) => k === undefined ? ctx.updateSignaturStimmt(a, v, s) : ctx.updateSignaturStimmt(a, v, s, k);

pruefe('Das echte Update kommt durch', stimmt(angabe, '1.2.3', summe('ECHTES PROGRAMM')) === true);
pruefe('Eine veränderte Datei nicht', stimmt(angabe, '1.2.3', summe('SCHADPROGRAMM')) === false);
pruefe('Eine alte Fassung als neue verkleidet nicht', stimmt(angabe, '9.9.9', summe('ECHTES PROGRAMM')) === false);
pruefe('Eine erfundene Angabe nicht',
  stimmt({ ...angabe, sha256: summe('SCHADPROGRAMM') }, '1.2.3', summe('SCHADPROGRAMM')) === false);
pruefe('Fehlt die Angabe, nicht', stimmt(null, '1.2.3', summe('ECHTES PROGRAMM')) === false);
const fremd = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
pruefe('Ein anderer Schlüssel nicht', stimmt(angabe, '1.2.3', summe('ECHTES PROGRAMM'), fremd) === false);
pruefe('Unbrauchbarer Schlüssel: kein Absturz, sondern nein',
  stimmt(angabe, '1.2.3', summe('ECHTES PROGRAMM'), 'NOCH_NICHT_ANGELEGT') === false);
pruefe('In main.js steht ein echter Schlüssel', !/UPDATE_SCHLUESSEL = 'NOCH_NICHT_ANGELEGT'/.test(quelle));
pruefe('Der private Schlüssel liegt nicht im Repo',
  !/BEGIN PRIVATE KEY/.test(quelle) && !fs.existsSync(path.join(__dirname, '..', 'update-signatur.pem')));
fs.rmSync(ordner, { recursive: true, force: true });

console.log('Die Anmeldedaten');
function verschluesselung(verfuegbar) {
  const c = { Buffer, console: { warn() {}, error() {}, log() {} },
    safeStorage: {
      isEncryptionAvailable: () => verfuegbar,
      encryptString: (s) => Buffer.from('X' + s),
      decryptString: (b) => {
        const s = b.toString();
        if (!s.startsWith('X')) throw new Error('kaputt');
        return s.slice(1);
      }
    } };
  vm.createContext(c);
  vm.runInContext("const VERSCHLUESSELT = 'enc:v1:';"
    + 'const istGeheimerSchluessel = (schluessel) => /token|secret|refresh|nonce/i.test(schluessel);'
    + extract('function geheimnisseVerschluesseln(') + extract('function geheimnisseEntschluesseln('), c);
  return c;
}
const c = verschluesselung(true);
const roh = { language: 'de', cloudRefreshToken: 'GEHEIM', cloudAccessToken: 'AUCH', cloudTokenExpiry: 123, cloudAuthNonce: '' };
const sicher = c.geheimnisseVerschluesseln(roh);
pruefe('Der Refresh-Token steht nicht mehr lesbar da', !JSON.stringify(sicher).includes('GEHEIM'));
pruefe('Der Rest bleibt, wie er ist',
  sicher.language === 'de' && sicher.cloudTokenExpiry === 123 && sicher.cloudAuthNonce === '');
const zurueck = c.geheimnisseEntschluesseln(sicher);
pruefe('Die Oberfläche bekommt dieselben Werte',
  zurueck.cloudRefreshToken === 'GEHEIM' && zurueck.cloudAccessToken === 'AUCH');
pruefe('Doppelt verschlüsselt wird nicht',
  c.geheimnisseVerschluesseln(sicher).cloudRefreshToken === sicher.cloudRefreshToken);
pruefe('Ein alter Klartext-Wert bleibt lesbar',
  c.geheimnisseEntschluesseln({ cloudRefreshToken: 'ALT' }).cloudRefreshToken === 'ALT');
pruefe('Ein unlesbarer Wert wird leer statt zum Absturz',
  c.geheimnisseEntschluesseln({ cloudRefreshToken: 'enc:v1:' + Buffer.from('Quatsch').toString('base64') }).cloudRefreshToken === '');
const ohne = verschluesselung(false);
pruefe('Ohne Verschlüsselung im System bleibt die Anmeldung erhalten',
  ohne.geheimnisseVerschluesseln(roh).cloudRefreshToken === 'GEHEIM');

if (fehler) { console.error(fehler + ' Pruefung(en) fehlgeschlagen.'); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
