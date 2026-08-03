#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   VERSCHIEBEN IN DEN CLOUD-PAPIERKORB

   Prüft providers/oneDrive.js – moveFile(). Graph ist nachgebaut; es geht
   nur darum, WO die Datei hinterher liegt.

   >>> Warum das eine eigene Prüfung wert ist <<<
   Mit der Berechtigung Files.ReadWrite.AppFolder nimmt Graph den PATCH auf
   parentReference an und antwortet mit Erfolg – verschiebt die Datei aber
   nicht. Wer mit Microsoft angemeldet war und ein Heft löschte, hatte es
   danach in der App nicht mehr, im OneDrive und damit auf der Website aber
   weiterhin. Und weil der Papierkorb den Eintrag als erledigt abhakte,
   wurde es nie wieder versucht (gemeldet am 3.8.2026).

   Deshalb sieht moveFile nach, wo die Datei wirklich liegt, und legt sie
   im Zweifel am Zielort neu an. Dabei darf die alte erst verschwinden,
   wenn die neue steht – sonst wäre das Heft weg statt verschoben.

   Aufruf:  node scripts/test-cloud-trash-move.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const GRAPH = 'https://graph.test/v1.0';

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

/** Den Anbieter für sich laden – ohne Browser, ohne Netz. */
function loadOneDrive() {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Array, Object, Promise, Error,
    TextEncoder, encodeURIComponent, decodeURIComponent,
    fetch: () => { throw new Error('Kein Netz in der Prüfung'); },
    MICROSOFT_CONFIG: { GRAPH }
  };
  ctx.self = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core/providers/oneDrive.js'), 'utf8'), ctx);
  return ctx.OneDriveProvider;
}

const OneDrive = loadOneDrive();

/**
 * Ein nachgebautes OneDrive.
 * @param {boolean} moveWorks  ob der PATCH die Datei wirklich verschiebt
 * @param {boolean} [readable] ob sich der Inhalt lesen lässt
 */
function makeDrive(moveWorks, readable = true) {
  const items = {
    f1: {
      id: 'f1',
      name: 'Mein Heft__abc123.json',
      parent: 'ordner-haupt',
      body: readable ? { id: 'abc123', name: 'Mein Heft', pages: [] } : null
    }
  };
  const deleted = [];
  let nextId = 2;

  const rest = url => url.replace(`${GRAPH}/me/drive/items/`, '');

  const http = {
    async json(url, options = {}) {
      const tail = rest(url);
      const method = options.method || 'GET';

      // Neu anlegen: PUT .../{ordner}:/{name}:/content
      const create = tail.match(/^([^:/]+):\/(.+):\/content$/);
      if (create && method === 'PUT') {
        const id = 'f' + (nextId++);
        items[id] = {
          id,
          name: decodeURIComponent(create[2]),
          parent: create[1],
          body: JSON.parse(options.body)
        };
        return { id, name: items[id].name };
      }

      const idPart = tail.split('?')[0];

      if (idPart.endsWith('/content') && method === 'GET') {
        const item = items[idPart.slice(0, -'/content'.length)];
        if (!item) throw new Error('OneDrive Fehler 404: nicht gefunden');
        return item.body;
      }

      const item = items[idPart];
      if (!item) throw new Error('OneDrive Fehler 404: nicht gefunden');

      if (method === 'PATCH') {
        const patch = JSON.parse(options.body || '{}');
        // Der Kern des Fehlers: Erfolg gemeldet, nichts getan
        if (moveWorks && patch.parentReference?.id) item.parent = patch.parentReference.id;
        return { id: item.id, name: item.name };
      }

      if (method === 'GET') {
        return { id: item.id, name: item.name, parentReference: { id: item.parent } };
      }

      throw new Error(`Unerwarteter Aufruf: ${method} ${url}`);
    },

    async raw(url, options = {}) {
      const id = rest(url);
      if ((options.method || 'GET') !== 'DELETE') throw new Error(`Unerwarteter Aufruf: ${url}`);
      delete items[id];
      deleted.push(id);
      return { ok: true };
    }
  };

  return { http, items, deleted };
}

/**
 * Ein nachgebautes OneDrive für den Papierkorb-ORDNER.
 * Graph nimmt bei conflictBehavior nur fail, replace und rename an.
 */
function makeFolderApi(existing = null) {
  const created = [];
  let folder = existing;

  const http = {
    async json(url, options = {}) {
      const method = options.method || 'GET';

      if (method === 'GET' && url.endsWith(':/Papierkorb')) {
        if (!folder) throw new Error('OneDrive Fehler 404: nicht gefunden');
        return { id: folder, name: 'Papierkorb' };
      }

      if (method === 'POST' && url.endsWith('/children')) {
        const body = JSON.parse(options.body);
        const behavior = body['@microsoft.graph.conflictBehavior'];
        if (!['fail', 'replace', 'rename'].includes(behavior)) {
          throw new Error('OneDrive Fehler 400: The value for name@conflictBehavior is invalid.');
        }
        if (folder) throw new Error('OneDrive Fehler 409: nameAlreadyExists');
        folder = 'ordner-neu';
        created.push(body.name);
        return { id: folder, name: body.name };
      }

      throw new Error(`Unerwarteter Aufruf: ${method} ${url}`);
    },
    async raw() { throw new Error('Unerwartet'); }
  };

  return { http, created, folderNow: () => folder };
}

(async () => {
  console.log('Den Papierkorb-Ordner anlegen');

  /* >>> Der Fehler, der alles blockierte <<<
     Im Code stand conflictBehavior „return" – das gibt es nur in der alten
     OneDrive-Schnittstelle. Graph lehnte damit den ganzen Aufruf mit 400 ab,
     der Ordner entstand nie, und ohne ihn schlug unter Microsoft jedes
     Löschen in der Cloud fehl (gemeldet am 3.8.2026). */
  const fresh = makeFolderApi(null);
  const madeId = await OneDrive.findOrCreateSubfolder(fresh.http, 'approot', 'Papierkorb');

  check('Der Ordner wird angelegt', madeId, 'ordner-neu');
  check('Und heißt richtig', fresh.created, ['Papierkorb']);

  const there = makeFolderApi('ordner-alt');
  check('Ein vorhandener wird genommen',
    await OneDrive.findOrCreateSubfolder(there.http, 'approot', 'Papierkorb'), 'ordner-alt');
  check('Und nicht noch einmal angelegt', there.created, []);

  console.log('\nGraph verschiebt wirklich');

  const good = makeDrive(true);
  const sameId = await OneDrive.moveFile(good.http, 'f1', 'ordner-haupt', 'ordner-papierkorb');

  check('Die Kennung bleibt dieselbe', sameId, 'f1');
  check('Die Datei liegt im Papierkorb', good.items.f1.parent, 'ordner-papierkorb');
  check('Es wurde nichts gelöscht', good.deleted, []);

  console.log('\nGraph meldet Erfolg, verschiebt aber nicht');

  const stuck = makeDrive(false);
  const newId = await OneDrive.moveFile(stuck.http, 'f1', 'ordner-haupt', 'ordner-papierkorb');

  check('Es gibt eine neue Kennung', newId !== 'f1' && !!newId, true);
  check('Die alte Datei ist weg', stuck.deleted, ['f1']);
  check('Der Hauptordner ist leer',
    Object.values(stuck.items).filter(i => i.parent === 'ordner-haupt').map(i => i.id), []);

  const moved = stuck.items[newId];
  check('Die neue liegt im Papierkorb', moved.parent, 'ordner-papierkorb');
  check('Sie heißt noch genauso', moved.name, 'Mein Heft__abc123.json');
  check('Und hat denselben Inhalt', moved.body.id, 'abc123');

  console.log('\nDer Inhalt lässt sich nicht lesen');

  /* Hier darf nichts gelöscht werden. Der Weg läuft ausgerechnet dann,
     wenn ohnehin schon etwas schiefgegangen ist – ein Heft zu verlieren
     wäre schlimmer, als es liegen zu lassen. */
  const broken = makeDrive(false, false);
  let threw = false;
  try {
    await OneDrive.moveFile(broken.http, 'f1', 'ordner-haupt', 'ordner-papierkorb');
  } catch (err) {
    threw = true;
  }

  check('Das Verschieben meldet den Fehlschlag', threw, true);
  check('Die Datei ist noch da', broken.deleted, []);
  check('Und liegt unverändert im Hauptordner', broken.items.f1.parent, 'ordner-haupt');

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})();
