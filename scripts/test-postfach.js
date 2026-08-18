#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Prüft die Entscheidungen des Postfachs (src/core/postfach.js).

   Vier Dinge dürfen nie schiefgehen:

     · Eine Nachricht erreicht niemanden, für den sie nicht gedacht war.
     · Eine gelöschte kommt nicht zurück.
     · Eine abgelaufene wird nicht mehr zugestellt.
     · Zwei Rechner, die dasselbe Postfach führen, verlieren nichts.

   Aufruf:  node scripts/test-postfach.js
   ══════════════════════════════════════════════════════════════════════ */

const P = require('../src/core/postfach.js');

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

const JETZT = Date.parse('2026-08-18T12:00:00.000Z');

function nachricht(id, extra = {}) {
  return Object.assign({
    id,
    titel: { de: 'Titel ' + id, en: '', it: '' },
    text: { de: 'Text ' + id, en: '', it: '' },
    art: 'fenster',
    sofort: false,
    ziel: {},
    erstellt: '2026-08-0' + id + 'T10:00:00.000Z',
    gueltigBis: null
  }, extra);
}

const LEER = { gelesen: [], geloescht: [] };
const ALLE = { angemeldet: false, store: false, erstesMal: false };

/* ── Sprache ────────────────────────────────────────────────────────── */

console.log('Die Sprache faellt auf Deutsch zurueck');

check('Gewünschte Sprache gewinnt',
  P.textFuer({ de: 'Hallo', en: 'Hello', it: '' }, 'en'), 'Hello');
check('Leeres Feld fällt auf Deutsch zurück',
  P.textFuer({ de: 'Hallo', en: 'Hello', it: '' }, 'it'), 'Hallo');
check('Unbekannte Sprache fällt auf Deutsch zurück',
  P.textFuer({ de: 'Hallo', en: 'Hello', it: '' }, 'fr'), 'Hallo');
check('Nur Leerzeichen zählen als leer',
  P.textFuer({ de: 'Hallo', en: '   ', it: '' }, 'en'), 'Hallo');

/* ── Empfängerkreis ─────────────────────────────────────────────────── */

console.log('\nDer Empfaengerkreis trifft die Richtigen');

const nurAngemeldete = nachricht('1', { ziel: { nurAngemeldete: true } });
check('Angemeldete bekommen sie', P.trifftZu(nurAngemeldete, { angemeldet: true }), true);
check('Nicht Angemeldete nicht', P.trifftZu(nurAngemeldete, { angemeldet: false }), false);

const nurStore = nachricht('2', { ziel: { nurStore: true } });
check('Store-Fassung bekommt sie', P.trifftZu(nurStore, { store: true }), true);
check('Website-Fassung nicht', P.trifftZu(nurStore, { store: false }), false);

const nurWebsite = nachricht('3', { ziel: { nurWebsite: true } });
check('Website-Fassung bekommt sie', P.trifftZu(nurWebsite, { store: false }), true);
check('Store-Fassung nicht', P.trifftZu(nurWebsite, { store: true }), false);

const nurNeue = nachricht('4', { ziel: { nurNeue: true } });
check('Beim allerersten Start', P.trifftZu(nurNeue, { erstesMal: true }), true);
check('Sonst nicht', P.trifftZu(nurNeue, { erstesMal: false }), false);

/* Die Haken sind UND-verknuepft – das ist die Stelle, an der eine
   Nachricht sonst bei Leuten landet, fuer die sie nicht gedacht war. */
const beides = nachricht('5', { ziel: { nurAngemeldete: true, nurStore: true } });
check('Beide Bedingungen erfüllt',
  P.trifftZu(beides, { angemeldet: true, store: true }), true);
check('Nur angemeldet reicht nicht',
  P.trifftZu(beides, { angemeldet: true, store: false }), false);
check('Nur Store reicht nicht',
  P.trifftZu(beides, { angemeldet: false, store: true }), false);

check('Ohne Haken geht sie an alle', P.trifftZu(nachricht('6'), ALLE), true);

/* ── Womit angemeldet ───────────────────────────────────────────────── */

console.log('\nDer Anmeldeweg trennt Google von Microsoft');

const GOOGLE = { angemeldet: true, anbieter: ['google.com'] };
const MICROSOFT = { angemeldet: true, anbieter: ['microsoft.com'] };
const ANONYM = { angemeldet: false, anbieter: [] };

const nurGoogle = nachricht('11', { ziel: { nurGoogle: true } });
check('Google bekommt sie', P.trifftZu(nurGoogle, GOOGLE), true);
check('Microsoft nicht', P.trifftZu(nurGoogle, MICROSOFT), false);
check('Anonyme erst recht nicht', P.trifftZu(nurGoogle, ANONYM), false);

const nurMicrosoft = nachricht('12', { ziel: { nurMicrosoft: true } });
check('Microsoft bekommt sie', P.trifftZu(nurMicrosoft, MICROSOFT), true);
check('Google nicht', P.trifftZu(nurMicrosoft, GOOGLE), false);

/* Ein Konto kann mit BEIDEN Anbietern verknuepft sein – linkWithCredential
   haengt einen zweiten an dieselbe Kennung. Dann zaehlt es fuer beide. */
const BEIDE = { angemeldet: true, anbieter: ['google.com', 'microsoft.com'] };
check('Verknuepftes Konto zaehlt fuer Google', P.trifftZu(nurGoogle, BEIDE), true);
check('Und fuer Microsoft', P.trifftZu(nurMicrosoft, BEIDE), true);

/* Fehlt die Angabe ganz (alte Fassung der App), darf eine Nachricht mit
   Anbieter-Haken NICHT bei jedem landen. */
check('Ohne Anbieterangabe lieber nicht zustellen',
  P.trifftZu(nurGoogle, { angemeldet: true }), false);

/* ── Ablaufdatum ────────────────────────────────────────────────────── */

console.log('\nAbgelaufene Nachrichten werden nicht mehr zugestellt');

check('Ohne Datum unbegrenzt',
  P.istGueltig(nachricht('7'), JETZT), true);
check('Zukunft gilt',
  P.istGueltig(nachricht('8', { gueltigBis: '2026-12-01T00:00:00.000Z' }), JETZT), true);
check('Vergangenheit gilt nicht',
  P.istGueltig(nachricht('9', { gueltigBis: '2026-08-01T00:00:00.000Z' }), JETZT), false);

/* Ein Tippfehler im Formular darf keine Nachricht verschlucken. */
check('Unlesbares Datum gilt als unbegrenzt',
  P.istGueltig(nachricht('10', { gueltigBis: 'morgen vielleicht' }), JETZT), true);

/* ── Postfach ───────────────────────────────────────────────────────── */

console.log('\nDas Postfach zeigt das Richtige');

const liste = [
  nachricht('1'),
  nachricht('2', { gueltigBis: '2026-08-01T00:00:00.000Z' }),   // abgelaufen
  nachricht('3', { ziel: { nurStore: true } }),                 // nicht für uns
  nachricht('4')
];

const imFach = P.fuersPostfach(liste, LEER, ALLE, JETZT);
check('Abgelaufene und fremde fallen weg', imFach.map(n => n.id), ['4', '1']);

check('Gelöschte kommen nicht zurück',
  P.fuersPostfach(liste, { gelesen: [], geloescht: ['4'] }, ALLE, JETZT).map(n => n.id),
  ['1']);

check('Gelesene bleiben im Fach stehen',
  P.fuersPostfach(liste, { gelesen: ['1'], geloescht: [] }, ALLE, JETZT).map(n => n.id),
  ['4', '1']);

check('Aber sie zählen nicht mehr als ungelesen',
  P.ungelesen(imFach, { gelesen: ['1'], geloescht: [] }).map(n => n.id), ['4']);

/* ── Wann geht ein Fenster auf ──────────────────────────────────────── */

console.log('\nFenster gehen zur richtigen Zeit auf');

const gemischt = [
  nachricht('1', { art: 'fenster', sofort: false }),
  nachricht('2', { art: 'banner', sofort: true }),
  nachricht('3', { art: 'fenster', sofort: true })
];

check('Beim Start: alle Fenster, aelteste zuerst',
  P.alsFenster(gemischt, LEER, true).map(n => n.id), ['1', '3']);

/* Waehrend der Arbeit darf nur aufspringen, was ausdruecklich "sofort"
   verlangt – sonst reisst eine Ankuendigung jemanden mitten im Satz aus
   dem Schreiben. */
check('Waehrenddessen: nur die mit sofort',
  P.alsFenster(gemischt, LEER, false).map(n => n.id), ['3']);

check('Banner geht nie als Fenster auf',
  P.alsFenster([nachricht('9', { art: 'banner', sofort: true })], LEER, true), []);

check('Gelesene gehen nicht noch einmal auf',
  P.alsFenster(gemischt, { gelesen: ['1', '3'], geloescht: [] }, true), []);

/* ── Abgleich zwischen zwei Rechnern ────────────────────────────────── */

console.log('\nZwei Rechner verlieren nichts');

check('Vereinigung ohne Doppelte',
  P.vereinige(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
check('Leere Seite stoert nicht', P.vereinige(['a'], null), ['a']);
check('Beide leer', P.vereinige(null, undefined), []);

const hier = { gelesen: ['1', '2'], geloescht: ['5'] };
const dort = { gelesen: ['2', '3'], geloescht: ['6'] };
check('Staende kommen vollstaendig zusammen',
  P.vereinigeStand(hier, dort),
  { gelesen: ['1', '2', '3'], geloescht: ['5', '6'] });

/* Die Vereinigung muss in beide Richtungen dasselbe ergeben, sonst
   haengt das Ergebnis davon ab, wer zufaellig zuerst hochlaedt. */
const einWeg = P.vereinigeStand(hier, dort);
const andersHerum = P.vereinigeStand(dort, hier);
check('Reihenfolge aendert das Ergebnis nicht',
  [...einWeg.gelesen].sort(), [...andersHerum.gelesen].sort());

/* ── Urteil ─────────────────────────────────────────────────────────── */

if (failed) {
  console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
