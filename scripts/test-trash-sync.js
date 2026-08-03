#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   PAPIERKORB GEGEN DIE GEMEINSAME LISTE ABGLEICHEN

   Prüft core/trash.js – syncWithCloud(). Die Cloud ist nachgebaut; es
   geht nur darum, WAS mit den Einträgen geschieht.

   >>> Warum das eine eigene Prüfung wert ist <<<
   Ein Eintrag, der in der gemeinsamen Liste fehlt, gilt als „auf einem
   anderen Gerät zurückgeholt oder endgültig gelöscht" und fliegt aus dem
   Papierkorb – samt der örtlichen Sicherung.

   Dieser Schluss ist nur dann richtig, wenn es die Liste ÜBERHAUPT gibt.
   Gibt es sie nicht – frisch angemeldet, Anbieter gewechselt, Datei von
   Hand entfernt –, dann weiß die Cloud noch nichts, statt etwas anderes
   zu wissen. Vorher kam in beiden Fällen dieselbe leere Liste zurück.

   Die Folge war schwer: beim Anmelden wurde der gesamte Papierkorb
   geleert. Danach hielt nichts mehr die gelöschten Hefte davon ab, beim
   nächsten Abgleich zurückzukommen – alle auf einmal, auch die von vor
   Monaten (gemeldet am 3.8.2026).

   Aufruf:  node scripts/test-trash-sync.js
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

/**
 * @param {object[]} entries      was örtlich im Papierkorb liegt
 * @param {object|null} index     was loadTrashIndex() liefert
 * @param {string[]|null} [inMainFolder]  was noch im Cloud-Hauptordner liegt
 */
function makeTrash(entries, index, inMainFolder = [], cloud = {}) {
  const deletedFiles = [];
  const saved = {};
  const trashed = [];
  const deletedRemote = [];

  const ctx = {
    console: { log() {}, warn() {}, error(...a) { console.error('[trash]', ...a); } },
    JSON, Date, Math, Number, String, Array, Object, Promise,
    setTimeout, clearTimeout,

    CloudSync_: {
      loadTrashIndex: async () => index,
      saveTrashIndex: async (list) => { saved.list = list; return true; },
      // canMove: ob sich in den Cloud-Papierkorb verschieben lässt
      trashRemoteNotebook: async (id) => {
        trashed.push(id);
        return cloud.canMove === false ? { done: false, fileId: null } : { done: true, fileId: 'f1' };
      },
      listRemoteNotebookIds: async () => inMainFolder,
      deleteRemoteFile: async () => true,
      deleteRemoteNotebookById: async (id) => {
        deletedRemote.push(id);
        return cloud.canDelete !== false;
      },
      untrashRemoteNotebook: async () => null
    },

    Registry: { remove: async () => {}, add: async () => {}, save: async () => { saved.calls = (saved.calls || 0) + 1; } },
    S: { notebooks: [] },
    getNb: () => null
  };
  ctx.self = ctx;
  ctx.window = ctx;
  ctx.window.api = {
    // Der Papierkorb hängt mit in der Registry-Datei
    loadRegistry: async () => ({ trash: entries }),
    deleteFile: async (p) => { deletedFiles.push(p); return { success: true }; },
    fileExists: async () => true,
    moveFile: async () => ({ success: true })
  };

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core/trash.js'), 'utf8'), ctx);

  return { ctx, Trash: ctx.Trash, deletedFiles, saved, trashed, deletedRemote };
}

/** Ein Eintrag, der schon einmal in der gemeinsamen Liste stand. */
function syncedEntry(id, name) {
  return {
    id, name, color: '#000', pageCount: 2,
    originalPath: `C:/Hefte/${name}.jrnl`,
    trashPath: `C:/Hefte/.trash/${name}.jrnl`,
    driveFileId: 'drive-' + id,
    cloudTrashed: true,
    syncedToCloud: true,
    deletedAt: new Date().toISOString()
  };
}

(async () => {
  console.log('Die gemeinsame Liste gibt es noch gar nicht');

  /* Der Fall nach dem Anmelden: der Ordner ist da, die Listendatei nicht.
     Hier darf NICHTS aus dem Papierkorb fliegen. */
  const fresh = makeTrash(
    [syncedEntry('nb1', 'Tagebuch'), syncedEntry('nb2', 'Rezepte')],
    { entries: [], exists: false }
  );
  await fresh.Trash.syncWithCloud();

  // Sortiert verglichen: der Papierkorb ordnet nach Löschzeitpunkt,
  // und darauf kommt es hier nicht an.
  check('Beide Einträge bleiben liegen',
    fresh.Trash.getAll().map(e => e.id).sort(), ['nb1', 'nb2']);
  check('Keine örtliche Sicherung wurde gelöscht', fresh.deletedFiles, []);

  console.log('\nDie Liste gibt es, der Eintrag fehlt darin');

  /* Jetzt ist der Schluss richtig: ein anderes Gerät hat das Heft
     zurückgeholt oder endgültig gelöscht. */
  const resolved = makeTrash(
    [syncedEntry('nb1', 'Tagebuch'), syncedEntry('nb2', 'Rezepte')],
    { entries: [{ id: 'nb2', name: 'Rezepte', deletedAt: new Date().toISOString() }], exists: true }
  );
  await resolved.Trash.syncWithCloud();

  check('Der anderswo erledigte fliegt raus',
    resolved.Trash.getAll().map(e => e.id), ['nb2']);
  check('Und seine örtliche Sicherung wird geräumt',
    resolved.deletedFiles, ['C:/Hefte/.trash/Tagebuch.jrnl']);

  console.log('\nDie Liste ist lesbar und leer');

  /* Eine vorhandene, aber leere Liste heißt wirklich: alles erledigt. */
  const emptied = makeTrash([syncedEntry('nb1', 'Tagebuch')], { entries: [], exists: true });
  await emptied.Trash.syncWithCloud();

  check('Der Eintrag fliegt raus', emptied.Trash.getAll().map(e => e.id), []);

  console.log('\nNoch nie hochgeladene Einträge');

  /* Ohne syncedToCloud war der Eintrag nie in der Liste – er bleibt und
     wird beim nächsten Mal hochgeladen. Das galt schon vorher. */
  const local = syncedEntry('nb3', 'Neu');
  local.syncedToCloud = false;
  const pending = makeTrash([local], { entries: [], exists: true });
  await pending.Trash.syncWithCloud();

  check('Bleiben liegen', pending.Trash.getAll().map(e => e.id), ['nb3']);

  console.log('\nAbgehakt, aber in der Cloud noch da');

  /* Der Fehler unter Microsoft: das Verschieben meldete Erfolg, ohne etwas
     zu tun. Der Eintrag galt als erledigt und wurde nie wieder angefasst –
     in der App war das Heft weg, auf der Website stand es weiter da.
     Liegt die Datei noch im Hauptordner, ist die Cloud-Seite eben offen. */
  // So steht der Eintrag in der gemeinsamen Liste: abgehakt (stripLocalFields
  // nimmt nur die Pfade heraus, den Vermerk nicht).
  const nowInIndex = [{
    id: 'nb1', name: 'Tagebuch', driveFileId: 'drive-nb1',
    cloudTrashed: true, deletedAt: new Date().toISOString()
  }];
  const stuck = makeTrash([syncedEntry('nb1', 'Tagebuch')], { entries: nowInIndex, exists: true }, ['nb1']);
  await stuck.Trash.syncWithCloud();

  check('Es wird noch einmal verschoben', stuck.trashed, ['nb1']);
  check('Der Eintrag bleibt im Papierkorb', stuck.Trash.getAll().map(e => e.id), ['nb1']);

  console.log('\nAbgehakt und in der Cloud wirklich weg');

  const clean = makeTrash([syncedEntry('nb1', 'Tagebuch')], { entries: nowInIndex, exists: true }, []);
  await clean.Trash.syncWithCloud();

  check('Es wird nichts unnötig wiederholt', clean.trashed, []);

  console.log('\nVerschieben geht nicht – der Notweg');

  /* Wenn das Verschieben in den Cloud-Papierkorb scheitert, bliebe die
     Datei im Hauptordner liegen: in der App gelöscht, auf der Website
     weiterhin da. Solange der Inhalt hier örtlich liegt, wird sie deshalb
     in der Cloud gelöscht. */
  const noMove = makeTrash(
    [syncedEntry('nb1', 'Tagebuch')], { entries: nowInIndex, exists: true }, ['nb1'],
    { canMove: false }
  );
  await noMove.Trash.syncWithCloud();

  check('Die Cloud-Datei wird gelöscht', noMove.deletedRemote, ['nb1']);
  check('Der Eintrag gilt als erledigt',
    noMove.Trash.getAll().map(e => [e.cloudTrashed, e.cloudDeleted]), [[true, true]]);
  check('Die örtliche Sicherung bleibt', noMove.deletedFiles, []);

  console.log('\nOhne örtliche Sicherung wird nichts gelöscht');

  /* Ein Eintrag von einem anderen Gerät: hier liegt kein Inhalt. Würde die
     Cloud-Datei gelöscht, wäre das Heft endgültig weg – dann bleibt sie
     lieber liegen und der nächste Abgleich versucht es erneut. */
  const remoteOnly = syncedEntry('nb1', 'Tagebuch');
  remoteOnly.trashPath = null;
  remoteOnly.originalPath = null;
  remoteOnly.cloudTrashed = false;

  const foreign = makeTrash(
    [remoteOnly], { entries: nowInIndex, exists: true }, ['nb1'], { canMove: false }
  );
  await foreign.Trash.syncWithCloud();

  check('Es wurde nichts in der Cloud gelöscht', foreign.deletedRemote, []);
  check('Der Eintrag bleibt offen',
    foreign.Trash.getAll().map(e => !!e.cloudTrashed), [false]);

  console.log('\nOhne Netz wird nichts angefasst');

  const offline = makeTrash([syncedEntry('nb1', 'Tagebuch')], null);
  const ok = await offline.Trash.syncWithCloud();

  check('Der Abgleich meldet Fehlschlag', ok, false);
  check('Der Papierkorb bleibt unberührt', offline.Trash.getAll().map(e => e.id), ['nb1']);

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})();
