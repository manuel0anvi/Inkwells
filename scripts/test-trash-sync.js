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
  const vermerkt = [];
  const eingereiht = [];
  const saved = {};
  const trashed = [];
  const deletedRemote = [];
  const untrashed = [];

  const ctx = {
    console: { log() {}, warn() {}, error(...a) { console.error('[trash]', ...a); } },
    JSON, Date, Math, Number, String, Array, Object, Promise,
    setTimeout, clearTimeout,

    CloudSync_: {
      // Neu: Vorgaenge, die gar nicht erst warten mussten, landen im
      // Protokoll (siehe noteSyncDone in core/cloudSync.js)
      noteSyncDone: (v) => { vermerkt.push(v); },
      queueNotebook: (id, o) => { eingereiht.push({ id, action: (o || {}).action }); },
      loadTrashIndex: async () => index,
      // canSaveIndex: ob sich die gemeinsame Liste schreiben lässt
      saveTrashIndex: async (list) => {
        if (cloud.canSaveIndex === false) return false;
        saved.list = list;
        return true;
      },
      // canMove: ob sich in den Cloud-Papierkorb verschieben lässt
      trashRemoteNotebook: async (id) => {
        trashed.push(id);
        return cloud.canMove === false ? { done: false, fileId: null } : { done: true, fileId: 'f1' };
      },
      listRemoteNotebookIds: async () => inMainFolder,
      deleteRemoteFile: async () => true,
      /* Fuer _destroy(): ohne verbundenes Konto gibt es dort nichts zu
         loeschen. "angemeldet" schaltet den Fall ein, in dem wirklich
         eine Cloud dranhaengt; "nochInCloud" laesst die Gegenprobe
         melden, dass die Datei trotz allem noch da ist. */
      isAuthenticated: () => cloud.angemeldet === true,
      isConfigured: () => cloud.angemeldet === true,
      remoteNotebookExists: async () => cloud.nochInCloud === true,
      deleteRemoteNotebookById: async (id) => {
        deletedRemote.push(id);
        return cloud.canDelete !== false;
      },
      // canUntrash: ob sich die Cloud-Datei zurückschieben lässt
      untrashRemoteNotebook: async (fileId) => {
        untrashed.push(fileId);
        if (cloud.canUntrash !== true) return null;
        return { notebooks: [{ id: cloud.restoreId || 'nb1', name: 'Tagebuch', pages: [] }] };
      }
    },

    Registry: { remove: async () => {}, add: async () => {}, save: async () => { saved.calls = (saved.calls || 0) + 1; } },
    FileManager_: {
      saveNotebook: async () => {},
      getNotebookFilePath: () => null,
      getNotebookPath: () => null
    },
    // cloudEnabled steuert, ob _destroy die Cloud ueberhaupt anfasst.
    // Ohne "angemeldet" bleibt es falsch - genau wie bisher.
    Settings: { get: (k) => (k === 'cloudEnabled' ? cloud.angemeldet === true : '') },
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
    moveFile: async () => ({ success: true }),
    loadFromPath: async () => ({
      success: true,
      data: { notebooks: [{ id: cloud.restoreId || 'nb1', name: 'Tagebuch', pages: [] }] }
    })
  };

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core/trash.js'), 'utf8'), ctx);

  return { ctx, Trash: ctx.Trash, deletedFiles, saved, trashed, deletedRemote, untrashed, vermerkt, eingereiht };
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

  /* ════════════════════════════════════════════════════════════════
     ZURÜCKHOLEN OHNE NETZ

     Örtlich liegt das Heft danach wieder da, in der Cloud aber noch im
     Papierkorb-Ordner und in der gemeinsamen Liste. Vorher war der
     Eintrag hier einfach weg – und weil „kennt nur die Wolke" als „auf
     einem anderen Gerät gelöscht" gilt, warf der nächste Abgleich das
     Heft erneut in den Papierkorb.
     ════════════════════════════════════════════════════════════════ */

  console.log('\nOhne Netz zurückgeholt');

  const restoredOffline = makeTrash(
    [syncedEntry('nb1', 'Tagebuch')], { entries: nowInIndex, exists: true }, [],
    { canUntrash: false, canSaveIndex: false }
  );
  const back = await restoredOffline.Trash.restore('nb1');

  check('Das Heft kommt zurück', !!back, true);
  check('Es steht nicht mehr im Papierkorb', restoredOffline.Trash.getAll().map(e => e.id), []);
  check('Aber der Rest wird vermerkt',
    restoredOffline.Trash._entries.map(e => [e.id, !!e.restored]), [['nb1', true]]);

  console.log('\nDer Vermerk übersteht den nächsten Abgleich');

  /* Die gemeinsame Liste kennt das Heft noch. Der Grabstein darf davon
     nicht wieder zu einem sichtbaren Eintrag werden. */
  restoredOffline.ctx.CloudSync_.saveTrashIndex = async (list) => {
    restoredOffline.saved.list = list;
    return true;
  };
  await restoredOffline.Trash.syncWithCloud();

  check('Es bleibt aus dem Papierkorb heraus',
    restoredOffline.Trash.getAll().map(e => e.id), []);
  check('Und steht auch nicht in der gemeinsamen Liste',
    (restoredOffline.saved.list || []).map(e => e.id), []);

  console.log('\nWieder online: die Cloud-Datei wird zurückgeschoben');

  const catchUp = makeTrash(
    [syncedEntry('nb1', 'Tagebuch')], { entries: nowInIndex, exists: true }, [],
    { canUntrash: false, canSaveIndex: false }
  );
  await catchUp.Trash.restore('nb1');

  // Netz ist wieder da
  catchUp.ctx.CloudSync_.untrashRemoteNotebook = async (fileId) => {
    catchUp.untrashed.push(fileId);
    return { notebooks: [{ id: 'nb1', name: 'Tagebuch', pages: [] }] };
  };
  catchUp.ctx.CloudSync_.saveTrashIndex = async (list) => { catchUp.saved.list = list; return true; };
  await catchUp.Trash.syncWithCloud();

  check('Die Cloud-Datei wurde zurückgeschoben',
    catchUp.untrashed.includes('drive-nb1'), true);
  check('Und der Vermerk ist verschwunden', catchUp.Trash._entries.map(e => e.id), []);

  console.log('\nErneut gelöscht, bevor der Vermerk abgearbeitet war');

  /* Sonst schöbe _catchUpCloudTrash die Datei gleich wieder aus dem
     Papierkorb heraus, die das erneute Löschen gerade hineingelegt hat. */
  const twice = makeTrash(
    [syncedEntry('nb1', 'Tagebuch')], { entries: nowInIndex, exists: true }, [],
    { canUntrash: false, canSaveIndex: false }
  );
  await twice.Trash.restore('nb1');
  await twice.Trash.moveToTrash({ id: 'nb1', name: 'Tagebuch', pages: [] });

  check('Es gibt genau einen Eintrag', twice.Trash._entries.length, 1);
  check('Und der ist kein Grabstein', !!twice.Trash._entries[0].restored, false);

  /* ══════════════════════════════════════════════════════════════════
     WAS AM PAPIERKORB NOCH AUSSTEHT

     getPendingCloudActions() ist die Auskunft, aus der das Sync-Fenster
     seine Papierkorb-Zeilen baut (ui/syncPanel.js). Sie ist die EINZIGE
     Quelle dafuer: der Papierkorb fuehrt seine offenen Sachen selbst und
     steht nicht in der Warteschlange von CloudSync_.

     Faellt sie falsch aus, sieht der Nutzer entweder etwas, das laengst
     erledigt ist, oder – schlimmer – er sieht nichts, obwohl in der
     Cloud noch eine Datei liegt.
     ══════════════════════════════════════════════════════════════════ */

  console.log('\n' + 'Was am Papierkorb noch aussteht');

  {
    const t = makeTrash([], { entries: [], exists: true }).Trash;
    t._entries = [
      // Ohne Netz geloescht: die Cloud-Datei liegt noch im Hauptordner
      { id: 'a', name: 'Ohne Netz geloescht', cloudTrashed: false, deletedAt: '2026-01-01T10:00:00Z' },
      // Erledigt – darf NICHT auftauchen
      { id: 'b', name: 'Sauber verschoben', cloudTrashed: true, deletedAt: '2026-01-01T09:00:00Z' },
      // Ohne Netz zurueckgeholt, Datei liegt noch im Papierkorb-Ordner
      { id: 'c', name: 'Zurueckgeholt', restored: true, driveFileId: 'f9', deletedAt: '2026-01-01T08:00:00Z' },
      // Endgueltig geloescht, Cloud-Datei steht noch aus
      { id: 'd', name: 'Endgueltig weg', purged: true, deletedAt: '2026-01-01T07:00:00Z' }
    ];

    const offen = t.getPendingCloudActions();
    check('Nur die offenen Faelle, nicht der erledigte',
      offen.map(e => e.nbId), ['a', 'c', 'd']);
    check('Die Art stimmt je Fall',
      offen.map(e => e.action), ['trash', 'restore', 'delete']);
    check('Der Name reist mit', offen[0].nbName, 'Ohne Netz geloescht');
    check('Und ein Zeitpunkt auch', offen[0].queuedAt, '2026-01-01T10:00:00Z');
  }

  {
    /* Ein zurueckgeholter Eintrag OHNE Datei-Kennung wartet auf nichts:
       _catchUpCloudTrash wirft ihn beim naechsten Mal einfach weg. Stuende
       er in der Liste, zeigte das Fenster dauerhaft einen Vorgang an, der
       nie fertig wird. */
    const t = makeTrash([], { entries: [], exists: true }).Trash;
    t._entries = [{ id: 'e', name: 'Nie in der Cloud', restored: true, driveFileId: null }];
    check('Zurueckgeholt ohne Cloud-Datei steht nicht aus',
      t.getPendingCloudActions(), []);
  }

  {
    const t = makeTrash([], { entries: [], exists: true }).Trash;
    t._entries = [];
    check('Leerer Papierkorb: nichts offen', t.getPendingCloudActions(), []);
  }

  /* ══════════════════════════════════════════════════════════════════
     EINE LOESCHUNG IST IMMER ZU SEHEN

     Wer ein Heft loescht, will im Sync-Fenster sehen, was damit in der
     Cloud geschieht - mit Netz wie ohne.

     >>> Der Fehler, der hier festgehalten wird <<<
     Mit Netz klappt das Verschieben in den Cloud-Papierkorb sofort. Dann
     wurde WEDER etwas eingereiht (es wartet ja nichts mehr) NOCH etwas
     vermerkt (ins Protokoll schreibt sonst nur _runQueue). Die Loeschung
     war im Fenster ueberhaupt nicht zu sehen.

     Ohne Netz tauchte sie dagegen auf. Also genau verkehrt herum: mit
     Internet unsichtbar, ohne Internet sichtbar.
     ══════════════════════════════════════════════════════════════════ */

  console.log('\n' + 'Eine Loeschung ist immer zu sehen');

  {
    // MIT Netz: das Verschieben klappt sofort
    const mitNetz = makeTrash([], { entries: [], exists: true });
    await mitNetz.Trash.moveToTrash({ id: 'nb9', name: 'Tagebuch', pages: [] });

    check('Mit Netz wird nichts eingereiht - es wartet ja nichts',
      mitNetz.eingereiht, []);
    check('Aber es steht als erledigt im Protokoll',
      mitNetz.vermerkt.map(v => [v.nbId, v.action]), [['nb9', 'trash']]);
    check('Mit dem Namen des Hefts', mitNetz.vermerkt[0].nbName, 'Tagebuch');
  }

  {
    /* OHNE Netz scheitern BEIDE Wege: das Verschieben in den
       Cloud-Papierkorb und der Notweg ueber das Loeschen. Nur canMove
       abzuschalten hiesse "Verschieben geht nicht, Loeschen schon" - das
       ist ein anderer Fall (so verhaelt sich OneDrive) und endet
       richtigerweise ebenfalls als erledigt. */
    const ohneNetz = makeTrash([], { entries: [], exists: true }, [],
      { canMove: false, canDelete: false });
    await ohneNetz.Trash.moveToTrash({ id: 'nb8', name: 'Notizen', pages: [] });

    check('Ohne Netz wandert es in die Warteschlange',
      ohneNetz.eingereiht.map(e => [e.id, e.action]), [['nb8', 'trash']]);
    check('Und wird NICHT schon als erledigt vermerkt', ohneNetz.vermerkt, []);
  }

  /* ══════════════════════════════════════════════════════════════════
     ENDGUELTIG LOESCHEN IST AUCH ZU SEHEN

     Derselbe blinde Fleck wie beim Verschieben in den Papierkorb: geht
     die Cloud-Seite sofort durch, wartet nichts mehr - und dann schrieb
     niemand etwas auf. Im Fenster sah es aus, als sei nichts geschehen,
     obwohl gerade eine Datei aus der Cloud verschwand.
     ══════════════════════════════════════════════════════════════════ */

  console.log('\n' + 'Endgueltig loeschen ist auch zu sehen');

  {
    const w = makeTrash([], { entries: [], exists: true }, [], { angemeldet: true });
    await w.Trash.moveToTrash({ id: 'nb7', name: 'Alte Notizen', pages: [] });
    w.vermerkt.length = 0;                 // das Verschieben ist hier nicht das Thema

    await w.Trash.deleteForever('nb7');

    check('Das endgueltige Loeschen steht im Protokoll',
      w.vermerkt.map(v => [v.nbId, v.action]), [['nb7', 'delete']]);
    check('Mit dem Namen des Hefts', w.vermerkt[0].nbName, 'Alte Notizen');
    check('Und der Eintrag ist weg', w.Trash._entries.length, 0);
  }

  {
    /* Kommt die Cloud-Seite NICHT durch, bleibt ein Grabstein stehen -
       und der taucht ueber getPendingCloudActions als wartend auf. Dann
       darf nichts als erledigt vermerkt werden. */
    const w = makeTrash([], { entries: [], exists: true }, [],
      { angemeldet: true, canMove: false, canDelete: false, nochInCloud: true });
    await w.Trash.moveToTrash({ id: 'nb6', name: 'Reste', pages: [] });
    w.vermerkt.length = 0;

    await w.Trash.deleteForever('nb6');

    check('Ohne Netz wird nichts als erledigt vermerkt', w.vermerkt, []);
    check('Stattdessen bleibt es wartend',
      w.Trash.getPendingCloudActions().map(e => [e.nbId, e.action]), [['nb6', 'delete']]);
  }

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})();
