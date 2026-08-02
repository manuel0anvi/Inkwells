#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ZURÜCKSCHREIBEN EINES GETEILTEN DOKUMENTS

   Prüft ui/sharedDocs.js – die Stelle, an der Änderungen an einem
   geteilten Dokument nach Firestore gehen. Firestore selbst kommt nicht
   vor: InkwellShare ist nachgebaut und schreibt nur mit, WAS verlangt
   wurde.

   Warum ausgerechnet hier ein eigener Test steht: der schwerste Fehler
   des ganzen Vorhabens saß in dieser Datei, und er war von außen nicht zu
   sehen. Beim Schließen wurde erst das Speichern angestoßen und gleich
   danach – synchron, also lange vor der ersten Antwort – der Merkzettel
   geleert. Das Speichern las ihn zu spät, fand null und deutete das als
   „ich weiß nichts über den bisherigen Stand": es hat den GESAMTEN
   Inhalt gelöscht und neu geschrieben. Alles, was ein anderer inzwischen
   geändert hatte, war damit weg.

   Aufruf:  node scripts/test-shared-save.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'ui', 'sharedDocs.js'), 'utf8');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

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

/* ── So wenig DOM wie möglich ───────────────────────────────────────── */

function fakeElement() {
  return {
    style: {}, dataset: {}, innerHTML: '', textContent: '',
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, append() {}, appendChild() {},
    querySelector: () => null, setProperty() {}
  };
}

function makeNotebook(docId) {
  return {
    id: 'shared:' + docId, origin: 'shared', name: 'Geteilt', color: '#000',
    defaultBg: 'ruled',
    sections: [{ id: 's1', name: 'A', pgIds: ['p1', 'p2'], defaultBg: 'ruled' }],
    pages: [
      { id: 'p1', date: '', bg: null, textContent: '<p>Eins</p>', inkStrokes: [], objects: [] },
      { id: 'p2', date: '', bg: null, textContent: '<p>Zwei</p>', inkStrokes: [], objects: [] }
    ]
  };
}

/** Merkzettel in der Form, die core/share.js liefert. */
function fingerprintOf(notebook) {
  const pages = {};
  for (const page of notebook.pages) {
    pages[page.id] = { sig: 'sig:' + page.textContent, strokes: (page.inkStrokes || []).length };
  }
  return { pages, order: notebook.pages.map(p => p.id), headSig: 'head' };
}

/**
 * @param {object} [setup]
 * @param {object} [setup.ownNotebook]  eigenes, freigegebenes Heft
 *   (dann läuft der Weg des BESITZERS statt des Empfängers)
 * @param {object} [setup.roomNotebook] was im Raum steht
 * @param {object} [setup.storedFingerprint] letzter eigener Abgleich
 */
function makeApp(setup = {}) {
  // Was das nachgebaute Firestore zu sehen bekommt
  const calls = { save: [], pageText: [], collabStarts: [] };

  const notebook = setup.ownNotebook || makeNotebook('doc1');
  const roomNotebook = setup.roomNotebook || notebook;
  const isOwnerCase = !!setup.ownNotebook;
  const settings = { liveFingerprints: setup.storedFingerprint
    ? { doc1: setup.storedFingerprint } : {} };
  const elements = new Map();

  const ctx = {
    console: { log() {}, warn() {}, error(...a) { console.error('[app]', ...a); } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Date, Promise, Number, String, Array, Object, Math,

    S: { notebooks: [notebook], activeNbId: null, activePgId: null, readOnly: false, sharedDoc: null },
    t: (k) => k,
    toast() {},
    showConfirm: async () => true,
    getNb: (id) => ctx.S.notebooks.find(n => n.id === id),
    openNotebook(id) { ctx.S.activeNbId = id; },
    showHome() { ctx.window.closeOpenSharedDoc(); ctx.S.sharedDoc = null; ctx.S.readOnly = false; },
    applyReadOnlyChrome(readOnly, sharedDoc) {
      ctx.S.readOnly = !!readOnly;
      ctx.S.sharedDoc = sharedDoc || null;
    },
    syncAll() {},
    openSection() {},
    getSections: (nb) => nb.sections,
    Settings: {
      get: (key) => settings[key] ?? 0,
      update: async (patch) => { Object.assign(settings, patch); }
    },
    CloudSync_: { ensureFirebaseIdentity: async () => true },

    // Nur beim Besitzer belegt: sein Heft ist freigegeben
    notebookShareEntry: (nbId) => (isOwnerCase && nbId === notebook.id ? { docId: 'doc1' } : null),

    E(id) {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },

    document: {
      addEventListener() {}, removeEventListener() {},
      querySelectorAll: () => [], querySelector: () => null,
      createElement: () => fakeElement()
    }
  };
  ctx.self = ctx;
  ctx.window = ctx;

  /* Der nachgebaute Freigabe-Dienst. Wichtig ist nur, WAS er zu sehen
     bekommt – vor allem, ob ein Merkzettel mitgegeben wurde. */
  const head = {
    docId: 'doc1',
    // Beim Besitzer gehört der Raum uns selbst, sonst jemand anderem
    owner: isOwnerCase ? 'u1' : 'u2',
    ownerEmail: isOwnerCase ? 'ich@example.com' : 'chef@example.com',
    ownerName: isOwnerCase ? 'Ich' : 'Chef',
    title: 'Geteilt', revision: 7, linkMode: 'off',
    memberEmails: ['ich@example.com'], members: { 'ich@example.com': 'edit' },
    roleFor: () => 'edit'
  };

  ctx.window.InkwellShare = {
    currentIdentity: () => ({ uid: 'u1', email: 'ich@example.com', name: 'Ich', anonymous: false }),
    hasRealIdentity: () => true,
    whenIdentityReady: async () => ({ email: 'ich@example.com' }),
    watchSharedDocs: () => () => {},
    watchDocument: () => () => {},
    resolveLink: async () => ({ docId: 'doc1' }),
    joinViaLink: async () => 'already',
    loadDocumentHead: async () => head,
    fingerprintNotebook: fingerprintOf,
    async loadDocument() {
      return {
        notebook: JSON.parse(JSON.stringify(roomNotebook)),
        head, crdt: {}, fingerprint: fingerprintOf(roomNotebook)
      };
    },
    async saveDocumentContent(docId, nb, options = {}) {
      calls.save.push({ docId, baseline: options.baseline });
      await wait(20);                      // so wie ein echter Netzweg
      return { revision: 8, fingerprint: fingerprintOf(nb), written: 1 };
    },
    async savePageText(docId, pageId, patch) {
      calls.pageText.push({ pageId, ycrdt: patch.ycrdt });
    }
  };

  /* Yjs-Stände: hier reicht eine Zeichenkette je Seite. Nach dem Verlassen
     gibt es sie nicht mehr – genau wie im Echtbetrieb, wo stop() die
     gemeinsamen Texte abbaut. Nur so weist der Test nach, dass gesichert
     wird, BEVOR der Raum verlassen wird. */
  let states = { p1: 'Y1', p2: 'Y2' };
  ctx.window.Collab = {
    start: async (docId, nb, crdt, canEdit) => {
      calls.collabStarts.push({ docId, nbId: nb.id, pages: nb.pages.map(p => p.id), canEdit });
    },
    stop: async (expectedDocId) => {
      if (expectedDocId && expectedDocId !== 'doc1') return;
      ctx.collabStopped = true;
      states = {};
    },
    stateFor: (pageId) => states[pageId] || null,
    isLive: () => true,
    syncNow() {},
    noteTextChange() {}, noteStroke() {}, notePage() {}, noteChange() {}
  };

  // Die Reiter müssen da sein, sonst steigt das Modul gleich wieder aus
  ctx.E('tab-own');
  ctx.E('tab-shared');

  vm.createContext(ctx);
  vm.runInContext(source, ctx);

  return { ctx, calls, notebook, settings };
}

/** Öffnet das Dokument auf demselben Weg wie ein angeklickter Link. */
async function open(app) {
  await app.ctx.window.openSharedDocumentByLink('link1');
  await wait(20);
}

/* Das Heft, mit dem die App wirklich arbeitet. loadDocument liefert – wie
   in Wirklichkeit – eine eigene Fassung aus dem Raum, nicht dieselbe
   Instanz, die der Test vorher gebaut hat. */
function liveNb(app) {
  return app.ctx.S.notebooks.find(n => n.id === 'shared:doc1');
}

(async () => {
  /* ── 1. Beim Schließen wird der Merkzettel mitgegeben ─────────────── */

  console.log('Schließen mit ungesicherten Änderungen');

  const app = makeApp();
  await open(app);

  check('Dokument ist offen', app.ctx.S.sharedDoc?.docId, 'doc1');

  // Etwas ändern und sofort schließen – ohne die 4 Sekunden abzuwarten
  liveNb(app).pages[0].textContent = '<p>Eins, geändert</p>';
  app.ctx.window.markSharedDocDirty('shared:doc1');
  app.ctx.window.closeOpenSharedDoc();

  await wait(120);

  check('Einmal gesichert', app.calls.save.length, 1);
  check(
    'Merkzettel war dabei (kein Rundumschlag)',
    app.calls.save[0].baseline && typeof app.calls.save[0].baseline.pages === 'object',
    true
  );
  check('Yjs-Stände mitgesichert', app.calls.pageText.map(c => c.pageId), ['p1', 'p2']);
  check('Raum erst danach verlassen', app.ctx.collabStopped, true);

  /* ── 2. Ohne Änderung wird nichts geschrieben ─────────────────────── */

  console.log('\nSchließen ohne Änderung');

  const app2 = makeApp();
  await open(app2);
  app2.ctx.window.closeOpenSharedDoc();
  await wait(120);

  check('Nichts geschrieben', app2.calls.save.length, 0);

  /* ── 3. Der Merkzettel beschreibt den Stand beim Laden ───────────────
     Nicht den beim Speichern: nur so lässt sich sagen, WAS dazugekommen
     ist. Ein Strich, der seither auf der Seite gelandet ist, muss also im
     Merkzettel noch fehlen. */

  console.log('\nMerkzettel bleibt der Stand vom Laden');

  const app3 = makeApp();
  await open(app3);

  liveNb(app3).pages[0].inkStrokes = [{ a: 1 }, { a: 2 }, { a: 3 }];
  liveNb(app3).pages[1].textContent = '<p>Zwei, geändert</p>';
  app3.ctx.window.markSharedDocDirty('shared:doc1');
  app3.ctx.window.closeOpenSharedDoc();
  await wait(120);

  check('Gesichert', app3.calls.save.length, 1);
  check(
    'Die neuen Striche gelten als neu',
    app3.calls.save[0].baseline.pages.p1.strokes,
    0
  );

  /* ══════════════════════════════════════════════════════════════════
     DER BESITZER IST GANZ NORMAL MIT DABEI

     Der Besitzer öffnet sein Heft von der Startseite – aus der Datei. Ist
     es freigegeben, wird daraus eine Live-Sitzung. Lange fehlte genau
     das: er sah von den Änderungen der anderen nichts, und „Freigabe
     aktualisieren" hat sie überschrieben.
     ══════════════════════════════════════════════════════════════════ */

  console.log('\nBesitzer öffnet sein freigegebenes Heft');

  // Eigenes Heft: zwei Seiten. Im Raum steht eine dritte, die ein anderer
  // angelegt hat – und Seite 1 mit einem Text, den ein anderer geändert hat.
  const own = makeNotebook('doc1');
  own.id = 'nb-eigenes';
  own.origin = undefined;

  const room = makeNotebook('doc1');
  room.id = 'nb-eigenes';
  room.pages[0].textContent = '<p>Eins, von jemand anderem</p>';
  room.pages.push({ id: 'p3', date: '', bg: null, textContent: '<p>Drei</p>', inkStrokes: [], objects: [] });
  room.sections[0].pgIds = ['p1', 'p2', 'p3'];

  const owner = makeApp({ ownNotebook: own, roomNotebook: room });
  owner.ctx.S.activeNbId = own.id;
  await owner.ctx.window.onNotebookOpened(own);
  await wait(60);

  check('Der Raum hat übernommen', own.pages.map(p => p.id), ['p1', 'p2', 'p3']);
  check('Auch die fremde Änderung', own.pages[0].textContent, '<p>Eins, von jemand anderem</p>');
  check('Nicht nur lesen', owner.ctx.S.readOnly, false);
  check('Als Besitzer gekennzeichnet', owner.ctx.S.sharedDoc?.isOwner, true);
  check('Der Raum wurde betreten', owner.calls.collabStarts.length, 1);
  check('Und zwar mit dem eigenen Heft', owner.calls.collabStarts[0].nbId, 'nb-eigenes');
  check('Mit Schreibrecht', owner.calls.collabStarts[0].canEdit, true);
  check('Merkzettel gemerkt', !!owner.settings.liveFingerprints.doc1, true);

  /* ── Änderungen des Besitzers gehen in den Raum ───────────────────── */

  console.log('\nDer Besitzer ändert etwas');

  own.pages[1].textContent = '<p>Zwei, vom Besitzer</p>';
  owner.ctx.window.markSharedDocDirty('nb-eigenes');
  owner.ctx.window.closeOpenSharedDoc();
  await wait(120);

  check('In den Raum geschrieben', owner.calls.save.length, 1);
  check('Mit Merkzettel', typeof owner.calls.save[0].baseline?.pages, 'object');
  check('Das Heft bleibt beim Besitzer', owner.ctx.S.notebooks.some(n => n.id === 'nb-eigenes'), true);

  /* ── Ohne Netz angelegte Seiten überleben ────────────────────────────
     Der Raum ist die maßgebliche Fassung – aber was er gar nicht kennt,
     darf er nicht wegnehmen. Sonst verlöre ein Besitzer, der ohne
     Verbindung gearbeitet hat, seine Arbeit beim nächsten Öffnen. */

  console.log('\nSeite, die der Raum nicht kennt');

  const own2 = makeNotebook('doc1');
  own2.id = 'nb-eigenes';
  own2.origin = undefined;
  own2.pages.push({ id: 'offline', date: '', bg: null, textContent: '<p>Ohne Netz</p>', inkStrokes: [], objects: [] });
  own2.sections[0].pgIds.push('offline');

  const room2 = makeNotebook('doc1');
  room2.id = 'nb-eigenes';

  const owner2 = makeApp({ ownNotebook: own2, roomNotebook: room2 });
  owner2.ctx.S.activeNbId = own2.id;
  await owner2.ctx.window.onNotebookOpened(own2);
  await wait(60);

  check('Die eigene Seite ist noch da', own2.pages.map(p => p.id), ['p1', 'p2', 'offline']);
  check('Und hängt in einem Abschnitt', own2.sections[0].pgIds.includes('offline'), true);
  check('Sie gilt als ungesichert', owner2.calls.save.length, 0);

  owner2.ctx.window.closeOpenSharedDoc();
  await wait(120);
  check('Beim Schließen geht sie hinauf', owner2.calls.save.length, 1);

  /* ── Fremdes darf nicht als eigenes Neues gelten ─────────────────────
     Ohne diesen Nachzug hielte der Merkzettel eine live empfangene Seite
     für neu – und für neue Seiten werden die Handschrift-Bögen NEU
     geschrieben. Striche, die der andere seither gezeichnet hat, wären
     damit gelöscht. */

  console.log('\nEmpfangene Änderung landet im Merkzettel');

  const app4 = makeApp();
  await open(app4);

  liveNb(app4).pages[0].inkStrokes = [{ a: 1 }, { a: 2 }];
  app4.ctx.window.noteRemoteApplied('p1');

  liveNb(app4).pages[1].textContent = '<p>eigene Änderung</p>';
  app4.ctx.window.markSharedDocDirty('shared:doc1');
  app4.ctx.window.closeOpenSharedDoc();
  await wait(120);

  check('Die fremden Striche gelten als bekannt', app4.calls.save[0].baseline.pages.p1.strokes, 2);

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})();
