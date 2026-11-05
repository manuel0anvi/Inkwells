#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DIE UNTERSCHRIFT UNTER EINEM UPDATE

   Schlüssel anlegen (einmalig):
     node scripts/update-signatur.js --anlegen

   Eine Fassung unterschreiben (macht npm run build von selbst):
     node scripts/update-signatur.js "<Pfad zur .exe>" <Fassung>

   >>> Der private Schlüssel gehört NICHT ins Repo <<<
   Er liegt unter ~/.inkwells/update-signatur.pem oder dort, wohin
   INKWELLS_UPDATE_KEY zeigt. Wer Fassungen baut, braucht diese Datei. Geht sie
   verloren, nehmen installierte Fassungen keine Updates mehr an und man muss
   einmal von Hand neu installieren: sichern, zum Beispiel im Passwortmanager.
   ══════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHLUESSEL = process.env.INKWELLS_UPDATE_KEY
  || path.join(os.homedir(), '.inkwells', 'update-signatur.pem');

function anlegen() {
  if (fs.existsSync(SCHLUESSEL)) {
    console.error('Es gibt schon einen Schlüssel: ' + SCHLUESSEL);
    console.error('Ein neuer würde alle installierten Fassungen vom Update abschneiden.');
    process.exit(1);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(SCHLUESSEL), { recursive: true });
  fs.writeFileSync(SCHLUESSEL, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

  const oeffentlich = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const main = path.join(ROOT, 'main.js');
  const vorher = fs.readFileSync(main, 'utf8');
  const nachher = vorher.replace(/const UPDATE_SCHLUESSEL = '[^']*';/, `const UPDATE_SCHLUESSEL = '${oeffentlich}';`);
  if (vorher === nachher) throw new Error('UPDATE_SCHLUESSEL in main.js nicht gefunden');
  fs.writeFileSync(main, nachher);
  console.log('Privater Schlüssel: ' + SCHLUESSEL + '  (sichern, nie ins Repo)');
  console.log('Öffentlicher Schlüssel steht jetzt in main.js.');
}

function unterschreibe(exe, version) {
  if (!fs.existsSync(SCHLUESSEL)) {
    console.error('Kein Signaturschlüssel unter ' + SCHLUESSEL);
    console.error('Ohne .exe.sig nehmen installierte Fassungen dieses Update nicht an.');
    process.exit(1);
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  const text = `inkwells-update\n${version}\n${sha256}`;
  const privat = crypto.createPrivateKey(fs.readFileSync(SCHLUESSEL));
  const signatur = crypto.sign(null, Buffer.from(text), privat).toString('base64');
  const ziel = exe + '.sig';
  fs.writeFileSync(ziel, JSON.stringify({ version, sha256, signatur }, null, 2));
  console.log('Unterschrieben: ' + ziel);
  return ziel;
}

if (require.main === module) {
  const [a, b] = process.argv.slice(2);
  if (a === '--anlegen') anlegen();
  else if (a && b) unterschreibe(a, b);
  else {
    console.error('Aufruf: --anlegen  oder  "<exe>" <Fassung>');
    process.exit(1);
  }
}

module.exports = { unterschreibe };
