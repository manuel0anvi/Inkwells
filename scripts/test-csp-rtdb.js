#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DIE CSP MUSS DIE ECHTZEIT-DATENBANK DURCHLASSEN

   >>> Der Ausfall, den das hier verhindert <<<
   Die Absicherung gegen fremden Heft-Text brachte eine CSP in die App.
   Ihre script-src erlaubte gstatic und Google-Konten – nicht aber die
   Realtime Database. Das schien harmlos: von dort wird ja kein Script
   geladen.

   Doch: das Firebase-SDK spricht mit der RTDB nicht nur über WebSocket.
   Sein Rückfallweg ist LONG-POLLING, und der arbeitet, indem er
   <script src="https://…firebasedatabase.app/.lp?…"> in die Seite
   hängt. Die CSP hat genau das abgewiesen.

   Die Folge war eine Kette, die man dem ersten Fehler nicht ansieht:

     1. Beim Besitzer kam keine RTDB-Verbindung zustande
     2. Also schrieb seine App nie roles/{docId}
     3. Und weil die Presence-Regel genau darauf besteht, bekam der
        Eingeladene permission_denied

   Beim Eingeladenen sah es damit nach einem Rechteproblem aus, während
   die Ursache eine Zeile im <head> des ANDEREN war. Die Zusammenarbeit
   ging gar nicht mehr.

   Deshalb wird hier die Adresse aus share.js gegen die CSP jeder Seite
   gehalten, die den Raum benutzt. Beides liegt weit auseinander, und
   niemand denkt beim Ändern des einen an das andere.

   Aufruf:  node scripts/test-csp-rtdb.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

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

/** Die Adresse der Echtzeit-Datenbank, so wie der Code sie benutzt. */
function rtdbHost(datei) {
  const quelle = fs.readFileSync(path.join(root, datei), 'utf8');
  const treffer = /const RTDB_URL = '([^']+)'/.exec(quelle);
  if (!treffer) return null;
  try { return new URL(treffer[1]).hostname; } catch (e) { return null; }
}

/** Die script-src einer Seite als Liste von Quellen. */
function scriptSrc(datei) {
  const html = fs.readFileSync(path.join(root, datei), 'utf8');
  const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  if (!meta) return null;
  const teil = meta[1].split(';').map(s => s.trim()).find(s => s.startsWith('script-src'));
  if (!teil) return null;
  return teil.split(/\s+/).slice(1);
}

/**
 * Laesst diese script-src den Host durch?
 *
 * Beruecksichtigt den Platzhalter am Anfang, denn genau so steht es in
 * der CSP: https://*.firebasedatabase.app deckt die regionale Adresse
 * inkwell-…-default-rtdb.europe-west1.firebasedatabase.app ab.
 */
function laesstDurch(quellen, host) {
  if (!quellen) return false;
  return quellen.some((q) => {
    if (q === '*' || q === 'https:') return true;
    const ohneSchema = q.replace(/^https?:\/\//, '');
    if (ohneSchema === host) return true;
    if (ohneSchema.startsWith('*.')) {
      const rumpf = ohneSchema.slice(1);          // ".firebasedatabase.app"
      return host.endsWith(rumpf) && host.length > rumpf.length;
    }
    return false;
  });
}

console.log('Die CSP laesst die Echtzeit-Datenbank durch');

const hostApp = rtdbHost('src/core/share.js');
check('Die Adresse steht in src/core/share.js', typeof hostApp === 'string' && hostApp.length > 0, true);

/* Jede Seite, die den Raum benutzt. Die Uebersicht und das Forum kommen
   ohne aus - dort waere die Freigabe nur unnoetige Weite. */
const seiten = [
  'src/index.html',
  'website/s/index.html',
  'website/dashboard/index.html'
];

for (const seite of seiten) {
  const quellen = scriptSrc(seite);
  check(seite + ' hat ueberhaupt eine script-src', Array.isArray(quellen), true);
  check(seite + ' laesst ' + hostApp + ' durch', laesstDurch(quellen, hostApp), true);
}

/* ── Und die Gegenprobe ────────────────────────────────────────────────
   Eine Pruefung, die alles durchwinkt, prueft nichts. Ein Host, der
   nicht erlaubt sein soll, muss abgewiesen werden - sonst haette die
   Freigabe oben auch mit einer viel zu weiten Regel bestanden. */
console.log('\nUnd was NICHT durchkommen darf');

const engeQuellen = ["'self'", "'unsafe-inline'", 'https://www.gstatic.com'];
check('Ohne den Eintrag faellt sie durch', laesstDurch(engeQuellen, hostApp), false);
check('Ein fremder Host kommt nicht durch',
  laesstDurch(['https://*.firebasedatabase.app'], 'boese.example.com'), false);
check('Und der Platzhalter deckt nicht die nackte Domain',
  laesstDurch(['https://*.firebasedatabase.app'], 'firebasedatabase.app'), false);

/* Die Website fuehrt eine Kopie von share.js. Laufen die Adressen
   auseinander, zeigt die CSP der Website auf die falsche Datenbank. */
const hostWeb = rtdbHost('website/js/share.js');
if (hostWeb !== null) {
  check('App und Website meinen dieselbe Datenbank', hostWeb, hostApp);
}

if (failed > 0) {
  console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Prüfungen bestanden.');
