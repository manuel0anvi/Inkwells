#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Prüft die Entscheidungen beim Melden und Sperren (src/core/melden.js).

   Vier Dinge dürfen nie schiefgehen:

     · Eine unsinnige Meldung geht nicht durch – sonst füllt sich die
       Verwaltung mit Meldungen ohne Grund oder gegen sich selbst.
     · Eine abgelaufene Sperre wirkt nicht mehr. Wer sie wirken liesse,
       sperrte für immer, ohne es zu merken.
     · Eine Sperre wirkt nur für das, was angekreuzt wurde. Der Admin
       sucht aus; „alles" ist keine stille Vorgabe.
     · Ein unlesbares Datum sperrt NICHT. Im Zweifel darf gearbeitet
       werden – andersherum als beim Postfach, und mit Absicht.

   Aufruf:  node scripts/test-melden.js
   ══════════════════════════════════════════════════════════════════════ */

const M = require('../src/core/melden.js');

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

const JETZT = Date.parse('2026-08-19T12:00:00.000Z');

function meldung(extra = {}) {
  return Object.assign({
    melderEmail: 'anna@example.com',
    gemeldetEmail: 'bert@example.com',
    docId: 'doc-1',
    grund: 'beleidigung',
    notiz: ''
  }, extra);
}

console.log('\nEine Meldung muss Hand und Fuss haben');
check('Die vollständige geht durch', M.pruefeMeldung(meldung()), { ok: true });
check('Ohne Anmeldung nicht',
  M.pruefeMeldung(meldung({ melderEmail: '' })), { ok: false, fehler: 'nichtAngemeldet' });
check('Ohne Empfänger nicht',
  M.pruefeMeldung(meldung({ gemeldetEmail: '  ' })), { ok: false, fehler: 'keinEmpfaenger' });
check('Sich selbst melden geht nicht',
  M.pruefeMeldung(meldung({ gemeldetEmail: 'ANNA@example.com' })), { ok: false, fehler: 'selbst' });
check('Ein erfundener Grund fällt durch',
  M.pruefeMeldung(meldung({ grund: 'weilichkann' })), { ok: false, fehler: 'keinGrund' });
check('Ohne Grund erst recht',
  M.pruefeMeldung(meldung({ grund: '' })), { ok: false, fehler: 'keinGrund' });
check('Ohne Dokument nicht',
  M.pruefeMeldung(meldung({ docId: '' })), { ok: false, fehler: 'keinDokument' });
check('Zu lange Notiz fällt durch',
  M.pruefeMeldung(meldung({ notiz: 'x'.repeat(M.NOTIZ_MAX + 1) })), { ok: false, fehler: 'notizZuLang' });
check('Genau die Höchstlänge geht noch',
  M.pruefeMeldung(meldung({ notiz: 'x'.repeat(M.NOTIZ_MAX) })), { ok: true });

console.log('\nEine Sperre läuft ab');
const umfangAlles = { neueFreigaben: true, selbstTeilen: true, laufendeRaus: true };
check('Ohne Enddatum unbegrenzt',
  M.sperreLaeuft({ bis: null, umfang: umfangAlles }, JETZT), true);
check('Zukunft gilt',
  M.sperreLaeuft({ bis: '2026-09-01T00:00:00.000Z', umfang: umfangAlles }, JETZT), true);
check('Vergangenheit gilt nicht',
  M.sperreLaeuft({ bis: '2026-08-01T00:00:00.000Z', umfang: umfangAlles }, JETZT), false);
check('Unlesbares Datum sperrt NICHT',
  M.sperreLaeuft({ bis: 'demnächst', umfang: umfangAlles }, JETZT), false);
check('Ohne jeden Haken ist es keine Sperre',
  M.sperreLaeuft({ bis: null, umfang: {} }, JETZT), false);
check('Gar keine Sperre',
  M.sperreLaeuft(null, JETZT), false);

console.log('\nEine Sperre wirkt nur, wofür sie gilt');
const nurBeitreten = { bis: null, umfang: { neueFreigaben: true, selbstTeilen: false, laufendeRaus: false } };
check('Beitreten gesperrt',
  M.gesperrtFuer(nurBeitreten, 'neueFreigaben', JETZT), true);
check('Selbst teilen nicht',
  M.gesperrtFuer(nurBeitreten, 'selbstTeilen', JETZT), false);
check('Laufende bleiben',
  M.gesperrtFuer(nurBeitreten, 'laufendeRaus', JETZT), false);
check('Erfundener Umfang trifft nie',
  M.gesperrtFuer({ bis: null, umfang: { alles: true } }, 'alles', JETZT), false);
check('Abgelaufen wirkt auch das Angekreuzte nicht',
  M.gesperrtFuer({ bis: '2026-08-01T00:00:00.000Z', umfang: umfangAlles }, 'neueFreigaben', JETZT), false);

console.log('\nDas Formular der Verwaltung');
const gebaut = M.baueSperre({ email: '  Bert@Example.COM ', tage: 14, umfang: { neueFreigaben: true }, grund: 'Beleidigung im Chat' });
check('Die Adresse kommt klein und ohne Rand an', gebaut.ok && gebaut.sperre.email, 'bert@example.com');
check('Nicht Angekreuztes steht ausdrücklich auf false',
  gebaut.ok && gebaut.sperre.umfang, { neueFreigaben: true, selbstTeilen: false, laufendeRaus: false });
check('Vierzehn Tage liegen in der Zukunft',
  gebaut.ok && Date.parse(gebaut.sperre.bis) > Date.now(), true);
check('Und nicht weiter als vierzehneinhalb',
  gebaut.ok && Date.parse(gebaut.sperre.bis) < Date.now() + 15 * 864e5, true);
check('Ohne Adresse nicht',
  M.baueSperre({ email: '', tage: 5, umfang: { neueFreigaben: true } }), { ok: false, fehler: 'keineAdresse' });
check('Ohne einen einzigen Haken nicht',
  M.baueSperre({ email: 'a@b.de', tage: 5, umfang: {} }), { ok: false, fehler: 'keinUmfang' });
check('Null Tage heisst unbegrenzt',
  M.baueSperre({ email: 'a@b.de', tage: 0, umfang: { selbstTeilen: true } }).sperre.bis, null);

console.log(failed === 0 ? '\nAlle Pruefungen bestanden.\n' : `\n${failed} Pruefung(en) fehlgeschlagen.\n`);
process.exit(failed === 0 ? 0 : 1);
