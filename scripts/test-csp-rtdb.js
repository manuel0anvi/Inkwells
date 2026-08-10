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

/** Die Quellen einer Direktive aus einer CSP-Regel. */
function quellenAus(regel, direktive) {
  const teil = regel.split(';').map(s => s.trim()).find(s => s.startsWith(direktive + ' '));
  if (!teil) return null;
  return teil.split(/\s+/).slice(1);
}

/** Die script-src aus dem <meta> einer Seite. */
function scriptSrc(datei, direktive) {
  const html = fs.readFileSync(path.join(root, datei), 'utf8');
  const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  return meta ? quellenAus(meta[1], direktive) : null;
}

/**
 * Die script-src der KOPFZEILE, die der oertliche Server mitschickt.
 *
 * >>> Warum das eigens geprueft wird <<<
 * Es gibt die Regel ZWEIMAL: als <meta> in src/index.html und als
 * UI_CSP in main.js. Der Browser wendet beide an, und die strengere
 * gewinnt - eine Erlaubnis nur an einer Stelle bringt gar nichts.
 *
 * Genau daran ist die Zusammenarbeit ein zweites Mal gescheitert: die
 * Datenbank war im <meta> freigegeben, in der Kopfzeile nicht. Die
 * Konsole nannte dabei die Regel aus der Kopfzeile, was aussah, als
 * haette die Korrektur nichts bewirkt.
 */
function scriptSrcKopfzeile(direktive) {
  const js = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const m = /const UI_CSP = "([^"]+)"/.exec(js);
  return m ? quellenAus(m[1], direktive) : null;
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

/* Beide Direktiven werden gebraucht: Long-Polling laedt ein <script>
   UND baut einen Rahmen auf. Fehlt eine, bleibt der Weg zu. */
for (const direktive of ['script-src', 'frame-src']) {
  for (const seite of seiten) {
    const quellen = scriptSrc(seite, direktive);
    check(seite + ' · ' + direktive + ' vorhanden', Array.isArray(quellen), true);
    check(seite + ' · ' + direktive + ' laesst die Datenbank durch',
      laesstDurch(quellen, hostApp), true);
  }

  /* Die zweite Regel: die Kopfzeile des oertlichen Servers. Sie gilt
     ZUSAETZLICH zum <meta> - beide muessen erlauben. */
  const kopf = scriptSrcKopfzeile(direktive);
  check('main.js · UI_CSP hat ' + direktive, Array.isArray(kopf), true);
  check('main.js · UI_CSP laesst die Datenbank durch (' + direktive + ')',
    laesstDurch(kopf, hostApp), true);
}

/* ── Und dasselbe fuer die Microsoft-Anmeldung ─────────────────────────
   Zweiter Weg, der still an der CSP haengenbleibt: die Anmeldung bei
   Firebase mit einem Microsoft-Konto (signInWithPopup in share.js).
   Firebase nimmt die Antwort nicht aus dem Fenster entgegen, sondern
   ueber einen versteckten Rahmen auf …firebaseapp.com/__/auth/iframe -
   und den baut es mit GAPI auf, nachgeladen von apis.google.com.

   Fehlt die Freigabe, meldet die Konsole einen Verstoss wegen
   api.js und danach auth/internal-error. Beides nennt GOOGLE, obwohl es
   um MICROSOFT geht - deshalb steht die Pruefung hier, statt sich beim
   naechsten Mal wieder erraten zu lassen. */
console.log('\nDie CSP laesst die Microsoft-Anmeldung durch');

// Nur Seiten, die den Anmeldeschritt wirklich anbieten. Die Lesekopie
// unter s/ fragt die Kennung nur ab und oeffnet nie ein Fenster.
const anmeldeSeiten = ['src/index.html', 'website/dashboard/index.html'];

for (const direktive of ['script-src', 'frame-src']) {
  for (const seite of anmeldeSeiten) {
    check(seite + ' · ' + direktive + ' laesst GAPI durch',
      laesstDurch(scriptSrc(seite, direktive), 'apis.google.com'), true);
  }
  check('main.js · UI_CSP laesst GAPI durch (' + direktive + ')',
    laesstDurch(scriptSrcKopfzeile(direktive), 'apis.google.com'), true);
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
