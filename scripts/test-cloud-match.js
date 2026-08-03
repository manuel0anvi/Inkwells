#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ZUORDNUNG VON CLOUD-DATEI UND HEFT

   Prüft, ob eine Datei in der Cloud dem richtigen Heft zugeordnet wird –
   die Frage, an der Löschen, Papierkorb und Hochladen hängen.

   >>> Warum das eine eigene Prüfung wert ist <<<
   Es gab zwei Wege zu derselben Auskunft, und sie widersprachen sich.
   Beim HERUNTERLADEN kommt die Kennung eines Hefts aus dem Inhalt der
   Datei, beim SUCHEN aus dem Dateinamen. Solange beide dasselbe sagen,
   fällt nichts auf.

   Sagen sie es nicht, entsteht ein Heft, das sich herunterladen, aber
   nicht löschen lässt: der Papierkorb meldete „erledigt", ohne etwas
   getan zu haben. Die Datei blieb im Hauptordner, und sobald der Eintrag
   im Papierkorb weg war, kam das Heft beim nächsten Abgleich zurück.
   Genau das ist am 3.8.2026 mit OneDrive passiert.

   Aufruf:  node scripts/test-cloud-match.js
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

/** Einen Anbieter für sich laden – ohne Browser, ohne Netz. */
function loadProvider(file, globalName) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Array, Object,
    TextEncoder, encodeURIComponent, fetch: () => {}
  };
  // Die Datei hängt sich an window – das ist hier der Zusammenhang selbst,
  // sonst käme man an das Ergebnis gar nicht heran (const wird nicht sichtbar).
  ctx.self = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  return ctx[globalName];
}

const OneDrive = loadProvider('src/core/providers/oneDrive.js', 'OneDriveProvider');
const GoogleDrive = loadProvider('src/core/providers/googleDrive.js', 'GoogleDriveProvider');

/** Baut den Eintrag so, wie listNotebookFiles ihn liefert. */
function oneDriveFile(name) {
  return { id: 'graph-1', name, inkwellId: OneDrive._idFromFileName(name) };
}

(async () => {
  console.log('OneDrive: Kennung aus dem Dateinamen');

  check('Der Normalfall', OneDrive._idFromFileName('Mein Heft__abc123.json'), 'abc123');
  check('Ein Name, der selbst auf _ endet',
    OneDrive._idFromFileName('Kapitel___abc123.json'), 'abc123');
  check('Ein Name mit Trenner darin',
    OneDrive._idFromFileName('A__B__abc123.json'), 'abc123');
  check('Gar kein Trenner', OneDrive._idFromFileName('abc123.json'), null);

  console.log('\nOneDrive: Datei und Heft zusammenbringen');

  check('Über die Kennung im Namen',
    OneDrive.matchesNotebook(oneDriveFile('Mein Heft__abc123.json'), { id: 'abc123' }), true);
  check('Ein fremdes Heft passt nicht',
    OneDrive.matchesNotebook(oneDriveFile('Mein Heft__abc123.json'), { id: 'xyz789' }), false);

  /* Der Rückfall: so benennt Google Drive. Solche Dateien liegen im
     OneDrive-Ordner, wenn zwischen den Anbietern gewechselt wurde. Ohne
     ihn war die Datei weder zu finden noch zu löschen. */
  check('Ohne Trenner: der Name IST die Kennung',
    OneDrive.matchesNotebook(oneDriveFile('abc123.json'), { id: 'abc123' }), true);
  check('Und auch dann nur die richtige',
    OneDrive.matchesNotebook(oneDriveFile('abc123.json'), { id: 'xyz789' }), false);

  /* Der Fall, der den Fehler ausgelöst hat: OneDrive hängt bei
     Namensgleichheit eine Zahl an. Aus dem Namen ist die Kennung dann
     falsch zu lesen – auffangen kann das nur der Blick in den Inhalt. */
  console.log('\nVon OneDrive umbenannte Datei');

  const renamed = oneDriveFile('Mein Heft__abc123 1.json');
  check('Der Name gibt die falsche Kennung her', renamed.inkwellId, 'abc123 1');
  check('Über den Namen ist sie nicht zu finden',
    OneDrive.matchesNotebook(renamed, { id: 'abc123' }), false);

  console.log('\nGoogle Drive: derselbe Rückfall');

  check('Über die Kennung',
    GoogleDrive.matchesNotebook({ inkwellId: 'abc123', name: 'x.json' }, { id: 'abc123' }), true);
  check('Über den Namen',
    GoogleDrive.matchesNotebook({ inkwellId: null, name: 'abc123.json' }, { id: 'abc123' }), true);

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})();
