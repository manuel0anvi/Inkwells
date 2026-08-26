#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ZWEI CLIENTS, EIN DOKUMENT

   Die bisherigen Tests prüfen einzelne Funktionen. Dieser hier prüft das
   ZUSAMMENSPIEL: zwei vollständige Exemplare von src/ui/collab.js laufen
   nebeneinander, über einen nachgebauten Raum verbunden. Getippt wird bei
   A, geprüft wird bei B.

   Genau diese Fehlerklasse blieb sonst unentdeckt – etwa dass Leser gar
   keine Änderungen bekamen, weil für sie nie ein gemeinsamer Text
   angelegt wurde. Einzeln war jede Funktion richtig, zusammen kam nichts
   an.

   Was nachgebaut wird: so wenig DOM wie möglich, aber genug, dass
   collab.js unverändert läuft. Firestore und die Realtime Database kommen
   nicht vor – der Raum ist ein Briefkasten zwischen den beiden.

   Aufruf:  node scripts/test-collab-sync.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const yjsSource = fs.readFileSync(path.join(root, 'src', 'lib', 'yjs.bundle.js'), 'utf8');
const collabSource = fs.readFileSync(path.join(root, 'src', 'ui', 'collab.js'), 'utf8');
const textSource = fs.readFileSync(path.join(root, 'src', 'canvas', 'text.js'), 'utf8');
/* collab.js schickt eingehenden Text durch die Bereinigung, bevor er ins
   DOM geht (core/sanitize.js). Ohne diese Zeile faende es die Funktion
   nicht. Im nachgebauten document reicht sie den Text unveraendert
   durch – geprueft wird sie da, wo sie wirkt: npm run test:sanitize. */
const sanitizeSource = fs.readFileSync(path.join(root, 'src', 'core', 'sanitize.js'), 'utf8');

/* ── Der Briefkasten zwischen den Clients ───────────────────────────── */

const bus = { listeners: [], log: [] };

// Jeder Client hält einen Zeitgeber am Laufen (Marker auffrischen). Ohne
// Aufräumen am Ende bliebe der Prozess hängen.
const clients = [];

function publish(op) {
  bus.log.push(op);
  /* Nachbildung des Streams: jeder bekommt alles, außer den eigenen.
     Zugestellt wird NACH dem laufenden Zug – die Realtime Database tut
     das auch, und synchron würde das Empfangen mitten im Senden landen,
     was es in Wirklichkeit nie tut. */
  const listeners = bus.listeners.slice();
  setImmediate(() => { for (const l of listeners) l(op); });
}

/* ── Anwesenheit ────────────────────────────────────────────────────── */

const presence = new Map();                 // uid -> Eintrag
const presenceListeners = [];               // { uid, cb }

function announcePresence() {
  const all = Array.from(presence.values());
  for (const { uid, cb } of presenceListeners.slice()) {
    cb(all.filter(p => p.uid !== uid));
  }
}

/* ── Ein Client ─────────────────────────────────────────────────────── */

function makeClient(name, uid, notebook) {
  /* Sehr einfacher Seiten-„DOM": je Seite ein Textfeld und eine
     Objektschicht. buildPages() entspricht openSection() – es baut den
     Bereich neu auf, und genau das tut collab.js nach einer fremden
     Struktur-Änderung. */
  const elements = new Map();

  function buildPages() {
    for (const page of notebook.pages) {
      if (elements.has(page.id)) continue;
      const objLayer = { innerHTML: '', appendChild() {}, querySelector: () => null };
      const textNode = { nodeType: 3, nodeValue: page.textContent || '' };
      const textDiv = {
        className: 'j-text',
        classList: { contains: (c) => c === 'j-text' },
        /* Ein echter Textknoten dahinter: flatTextOf läuft über
           childNodes, und daran hängt die Umrechnung der Stellen. */
        childNodes: [textNode],
        get innerHTML() { return textNode.nodeValue; },
        set innerHTML(v) { textNode.nodeValue = String(v); },
        contains: (n) => n === textNode || n === undefined,
        style: { lineHeight: '32px' },
        closest: () => pageEl,
        querySelector: () => null,
        getBoundingClientRect: () => ({ left: 72, top: 64, width: 690, height: 1035 })
      };
      const pageEl = {
        dataset: { pgid: page.id },
        querySelector: (sel) => {
          if (sel.includes('j-text')) return textDiv;
          if (sel.includes('j-objects')) return objLayer;
          return null;
        },
        appendChild() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 794, height: 1123 })
      };
      elements.set(page.id, { pageEl, textDiv, objLayer });
    }
    for (const id of Array.from(elements.keys())) {
      if (!notebook.pages.some(p => p.id === id)) elements.delete(id);
    }
  }
  buildPages();

  // Wonach die Gegenseite in Firestore fragt (Bilder, sehr viel Handschrift)
  const fetched = [];

  const ctx = {
    console: { log() {}, warn() {}, error(...a) { console.error(`[${name}]`, ...a); }, table() {} },
    crypto: require('node:crypto').webcrypto,
    performance,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout, clearTimeout, setInterval, clearInterval,

    // Zustand der App
    S: {
      strokeHistory: {}, activePgId: notebook.pages[0].id, readOnly: false,
      notebooks: [notebook], activeNbId: notebook.id
    },
    t: (k) => k,
    E: () => null,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 },
    getZoom: () => 1,
    getCaretTextOffset: () => null,
    setPlainCaret: () => {},
    rangeForTextOffset: () => null,
    renderSideTree: () => {},
    redrawStrokes: () => {},
    placeObject: () => {},

    // Entspricht app.js: baut den offenen Abschnitt neu auf
    openSection: () => buildPages(),

    getPage(pgId) {
      const page = notebook.pages.find(p => p.id === pgId);
      return page ? { nb: notebook, page } : null;
    },

    document: {
      activeElement: null,
      addEventListener() {}, removeEventListener() {},
      querySelectorAll: () => [],
      querySelector(sel) {
        const m = /data-pgid="([^"]+)"/.exec(sel);
        if (m && elements.has(m[1])) return elements.get(m[1]).pageEl;
        return null;
      },
      /* Genug Element, um die Anzeige durchlaufen zu lassen: children,
         dataset und querySelector fehlten, und die Marker am Seitenrand
         (renderMarkers in ui/collab.js) fuehren ihre Abzeichen seither
         nach, statt sie wegzuwerfen – dafuer sehen sie nach, was schon
         dasteht. Ohne diese Handvoll Felder scheiterte das Zeichnen und
         riss den Abgleich mit. */
      createElement: () => ({
        style: {}, classList: { add() {} }, append() {}, appendChild() {},
        dataset: {}, children: [], firstElementChild: null,
        querySelector: () => null, querySelectorAll: () => [], remove() {},
        set textContent(v) { this._t = v; }, get textContent() { return this._t; }
      })
    }
  };
  ctx.self = ctx;
  ctx.window = ctx;

  /* Der Weg über Firestore, wenn eine Änderung nicht durch den Live-Kanal
     passt. Hier nur nachgebildet: gesichert wird nichts, aber es wird
     festgehalten, WELCHE Seite nachgeholt werden sollte. */
  ctx.window.flushSharedDocSave = () => Promise.resolve();
  ctx.window.reloadLivePage = (pageId) => { fetched.push(pageId); return Promise.resolve(false); };
  ctx.window.noteRemoteApplied = () => {};

  /* Der nachgebaute Raum. Anwesenheit läuft wie in Wirklichkeit über eine
     eigene Ablage: jeder schreibt seinen Eintrag, alle bekommen die Liste
     ohne den eigenen. Daran hängen Schreibmarken und Zeilensperren. */
  ctx.window.InkwellsShare = {
    joinDocRoom: async () => ({
      me: { uid },
      setPage(pageId, offset, lock) {
        presence.set(uid, {
          uid, name, initials: name.slice(0, 2), color: '#c8a96e',
          pageId, offset,
          lockFrom: lock && Number.isFinite(lock.from) ? lock.from : -1,
          lockTo: lock && Number.isFinite(lock.to) ? lock.to : -1,
          lockAt: lock ? Date.now() : 0,
          at: Date.now()
        });
        announcePresence();
      },
      onPresence(cb) {
        presenceListeners.push({ uid, cb });
        cb(Array.from(presence.values()).filter(p => p.uid !== uid));
        return () => {};
      },
      onOp(cb) {
        const wrapped = (op) => { if (op.by !== uid) cb(op); };
        bus.listeners.push(wrapped);
        return () => {};
      },
      // true wie der echte Raum: sendOp meldet, OB die Änderung ankam
      sendOp(op) { publish({ ...op, by: uid }); return Promise.resolve(true); },
      leave: async () => {}
    })
  };

  vm.createContext(ctx);
  vm.runInContext(yjsSource, ctx);
  /* canvas/text.js liefert flatTextOf und die Umrechnung der Stellen.
     Ohne sie könnte collab.js die Marken der anderen nicht auf den
     hiesigen Text beziehen – genau das wird hier geprüft. */
  vm.runInContext(sanitizeSource, ctx);
  vm.runInContext(textSource, ctx);
  vm.runInContext(collabSource, ctx);

  const client = {
    name,
    ctx,
    Collab: ctx.window.Collab,
    notebook,
    fetched,
    textOf: (pageId) => elements.get(pageId).textDiv.innerHTML,
    pageOf: (pageId) => notebook.pages.find(p => p.id === pageId),
    pageIds: () => notebook.pages.map(p => p.id),
    /** Setzt den sichtbaren Text einer Seite – wie ein Tastendruck hier. */
    setText(pageId, text) {
      const page = notebook.pages.find(p => p.id === pageId);
      if (page) page.textContent = text;
      const el = elements.get(pageId);
      if (el) el.textDiv.innerHTML = text;
    },
    /** Wie markCurrentNotebookDirty in der App: „irgendetwas hat sich geändert". */
    touch() { ctx.window.Collab.noteChange(notebook.id); }
  };
  clients.push(client);
  return client;
}

function makeNotebook(inkOnP1 = []) {
  return {
    id: 'shared:doc1', origin: 'shared', name: 'Test', color: '#000', defaultBg: 'ruled',
    sections: [{ id: 's1', name: 'A', pgIds: ['p1', 'p2'], defaultBg: 'ruled' }],
    pages: [
      { id: 'p1', date: '', bg: null, textContent: '<p>Anfang</p>', inkStrokes: inkOnP1, objects: [] },
      { id: 'p2', date: '', bg: null, textContent: '<p>Zweite</p>', inkStrokes: [], objects: [] }
    ]
  };
}

function makeStroke(x) {
  return { path: [{ x, y: 2, p: .5 }, { x: x + 2, y: 4, p: .5 }], color: '#000', width: 2, isHL: false };
}

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

(async () => {
  /* ── 1. Bearbeiter tippt, Bearbeiter sieht es ────────────────────── */

  console.log('Zwei Bearbeiter');

  const a = makeClient('A', 'uidA', makeNotebook());
  const b = makeClient('B', 'uidB', makeNotebook());

  await a.Collab.start('doc1', a.notebook, {}, true);
  await b.Collab.start('doc1', b.notebook, {}, true);

  check('A ist live', a.Collab.isLive(), true);
  check('B ist live', b.Collab.isLive(), true);

  // A tippt
  a.pageOf('p1').textContent = '<p>Anfang und mehr</p>';
  a.Collab.noteTextChange('p1', '<p>Anfang und mehr</p>');
  await wait(500);

  check('B sieht A’s Text im Datenmodell', b.pageOf('p1').textContent, '<p>Anfang und mehr</p>');
  check('B sieht A’s Text im Feld', b.textOf('p1'), '<p>Anfang und mehr</p>');

  // B tippt auf der anderen Seite zurück
  b.pageOf('p2').textContent = '<p>Zweite Seite von B</p>';
  b.Collab.noteTextChange('p2', '<p>Zweite Seite von B</p>');
  await wait(500);

  check('A sieht B’s Text auf Seite 2', a.pageOf('p2').textContent, '<p>Zweite Seite von B</p>');

  /* ── 2. Gleichzeitig auf derselben Seite ─────────────────────────── */

  console.log('\nGleichzeitig auf derselben Seite');

  a.pageOf('p1').textContent = '<p>Anfang und mehr AAA</p>';
  a.Collab.noteTextChange('p1', '<p>Anfang und mehr AAA</p>');
  b.pageOf('p1').textContent = '<p>BBB Anfang und mehr</p>';
  b.Collab.noteTextChange('p1', '<p>BBB Anfang und mehr</p>');
  await wait(700);

  const textA = a.pageOf('p1').textContent;
  const textB = b.pageOf('p1').textContent;
  check('Beide sehen dasselbe', textA, textB);
  check('A’s Zusatz erhalten', textA.includes('AAA'), true);
  check('B’s Zusatz erhalten', textA.includes('BBB'), true);

  /* ── 3. Der Fall, der lange kaputt war: Leser bekommt Änderungen ── */

  console.log('\nLeser (nur lesen) bekommt Änderungen');

  bus.listeners.length = 0;
  const writer = makeClient('Schreiber', 'uidW', makeNotebook());
  const reader = makeClient('Leser', 'uidR', makeNotebook());

  await writer.Collab.start('doc2', writer.notebook, {}, true);
  await reader.Collab.start('doc2', reader.notebook, {}, false);   // darf NICHT schreiben

  writer.pageOf('p1').textContent = '<p>Anfang mit Neuigkeit</p>';
  writer.Collab.noteTextChange('p1', '<p>Anfang mit Neuigkeit</p>');
  await wait(500);

  check('Leser sieht die Änderung', reader.pageOf('p1').textContent, '<p>Anfang mit Neuigkeit</p>');
  check('Leser sieht sie auch im Feld', reader.textOf('p1'), '<p>Anfang mit Neuigkeit</p>');

  /* ── 4. Handschrift ─────────────────────────────────────────────── */

  console.log('\nHandschrift');

  bus.listeners.length = 0;
  const c = makeClient('C', 'uidC', makeNotebook());
  const d = makeClient('D', 'uidD', makeNotebook());
  await c.Collab.start('doc3', c.notebook, {}, true);
  await d.Collab.start('doc3', d.notebook, {}, true);

  const stroke = makeStroke(1);
  c.Collab.noteStroke('p1', stroke);
  await wait(300);

  check('D hat den Strich', d.pageOf('p1').inkStrokes.length, 1);
  check('Strich unverändert', d.pageOf('p1').inkStrokes[0], stroke);

  /* ── 4b. Seite, die noch nie aufgebaut wurde ─────────────────────────
     S.strokeHistory gibt es nur für Seiten, die im Editor stehen. Bei
     einer Seite aus einem anderen Abschnitt fehlt sie – vorher wurde
     deshalb mit einer LEEREN Liste angefangen und die gesamte bisherige
     Handschrift der Seite überschrieben. */

  console.log('\nFremder Strich auf einer nicht aufgebauten Seite');

  bus.listeners.length = 0;
  const alt = [makeStroke(10), makeStroke(20)];
  const e1 = makeClient('E', 'uidE', makeNotebook([]));
  const f1 = makeClient('F', 'uidF', makeNotebook(JSON.parse(JSON.stringify(alt))));
  await e1.Collab.start('doc5', e1.notebook, {}, true);
  await f1.Collab.start('doc5', f1.notebook, {}, true);

  // F hat die Seite nie aufgebaut: kein Eintrag in S.strokeHistory
  delete f1.ctx.S.strokeHistory['p1'];

  e1.Collab.noteStroke('p1', makeStroke(30));
  await wait(300);

  check('Alte Striche bleiben erhalten', f1.pageOf('p1').inkStrokes.length, 3);
  check('Erster alter Strich unverändert', f1.pageOf('p1').inkStrokes[0], alt[0]);

  /* ── 4c. Nachgeholter Änderungsstrom darf nicht doppeln ──────────────
     Beim Betreten holt onOp die letzten Einträge nach (OP_BACKLOG). Darin
     stehen auch Striche, die längst in Firestore liegen und beim Laden
     schon angekommen sind. */

  console.log('\nStrich kommt zweimal an');

  const twice = makeStroke(40);
  e1.Collab.noteStroke('p1', twice);
  await wait(200);
  e1.Collab.noteStroke('p1', twice);
  await wait(200);

  check('Nur einmal auf der Seite', f1.pageOf('p1').inkStrokes.length, 4);

  /* ── 4d. Seite, die erst während der Sitzung entsteht ────────────────
     Für sie gab es beim Betreten noch keinen gemeinsamen Text. Vorher
     brach noteTextChange hier ab: getippt werden konnte, nur kam beim
     anderen nichts an und beim Sichern fehlte der Yjs-Stand. */

  console.log('\nNeue Seite während der Sitzung');

  e1.notebook.pages.push({
    id: 'p3', date: '', bg: null, textContent: '', inkStrokes: [], objects: []
  });
  e1.Collab.noteTextChange('p3', '<p>Ganz neu</p>');
  await wait(400);

  check('Yjs-Stand für die neue Seite', typeof e1.Collab.stateFor('p3'), 'string');

  /* ── 4e. Verlassen mit Kennung ───────────────────────────────────────
     Beim Schließen wird erst gesichert und erst danach verlassen. Bis
     dahin kann längst ein anderes Dokument offen sein – der Aufruf von
     vorhin darf das nicht mit abräumen. */

  console.log('\nVerlassen betrifft nur das gemeinte Dokument');

  await e1.Collab.stop('doc-von-vorhin');
  check('Fremde Kennung lässt den Raum stehen', e1.Collab.isLive(), true);
  await e1.Collab.stop('doc5');
  check('Eigene Kennung verlässt ihn', e1.Collab.isLive(), false);

  /* ══════════════════════════════════════════════════════════════════
     5. ALLES ÜBRIGE IST AUCH LIVE

     Bis hierher ging es um Text und Handschrift. Ab jetzt um das, was
     lange gar nicht ankam: Seiten, Reihenfolge, Abschnitte, Radieren,
     Bilder. Übertragen wird das über einen Vergleich des Hefts, deshalb
     genügt es, das Heft zu verändern und „es hat sich etwas getan" zu
     melden – so wie es die App über markDirty tut.
     ══════════════════════════════════════════════════════════════════ */

  console.log('\nSeite anlegen');

  bus.listeners.length = 0;
  const g1 = makeClient('G', 'uidG', makeNotebook());
  const h1 = makeClient('H', 'uidH', makeNotebook());
  await g1.Collab.start('doc6', g1.notebook, {}, true);
  await h1.Collab.start('doc6', h1.notebook, {}, true);

  g1.notebook.pages.push({
    id: 'p9', date: '', bg: 'grid', textContent: '<p>Neue Seite</p>',
    inkStrokes: [makeStroke(60)], objects: []
  });
  g1.notebook.sections[0].pgIds.push('p9');
  g1.touch();
  await wait(500);

  check('H kennt die neue Seite', h1.pageIds(), ['p1', 'p2', 'p9']);
  check('Mit Text', h1.pageOf('p9').textContent, '<p>Neue Seite</p>');
  check('Mit Hintergrund', h1.pageOf('p9').bg, 'grid');
  check('Mit Handschrift', h1.pageOf('p9').inkStrokes.length, 1);
  check('Im selben Abschnitt', h1.notebook.sections[0].pgIds, ['p1', 'p2', 'p9']);

  /* ── 5b. Und auf der neuen Seite wird gemeinsam getippt ───────────── */

  console.log('\nTippen auf der neu angelegten Seite');

  h1.pageOf('p9').textContent = '<p>Neue Seite, ergänzt</p>';
  h1.Collab.noteTextChange('p9', '<p>Neue Seite, ergänzt</p>');
  await wait(500);

  check('G sieht die Ergänzung', g1.pageOf('p9').textContent, '<p>Neue Seite, ergänzt</p>');

  /* ── 5c. Reihenfolge und Abschnittsname ──────────────────────────── */

  console.log('\nReihenfolge und Abschnitt');

  g1.notebook.pages.reverse();
  g1.notebook.sections[0].pgIds = ['p9', 'p2', 'p1'];
  g1.notebook.sections[0].name = 'Umbenannt';
  g1.notebook.name = 'Heft, neu benannt';
  g1.touch();
  await wait(500);

  check('H hat dieselbe Reihenfolge', h1.pageIds(), ['p9', 'p2', 'p1']);
  check('H kennt den neuen Abschnittsnamen', h1.notebook.sections[0].name, 'Umbenannt');
  check('H kennt den neuen Heftnamen', h1.notebook.name, 'Heft, neu benannt');

  /* ── 5d. Radieren ────────────────────────────────────────────────── */

  console.log('\nRadieren');

  g1.pageOf('p1').inkStrokes = [makeStroke(1), makeStroke(2), makeStroke(3)];
  g1.touch();
  await wait(500);
  check('H hat die drei Striche', h1.pageOf('p1').inkStrokes.length, 3);

  // Der mittlere wird wegradiert – das ist der einzige Fall, der überschreibt
  g1.pageOf('p1').inkStrokes = [makeStroke(1), makeStroke(3)];
  g1.touch();
  await wait(500);

  check('H hat nur noch zwei', h1.pageOf('p1').inkStrokes.length, 2);
  check('Und zwar die richtigen', h1.pageOf('p1').inkStrokes[1], makeStroke(3));

  /* ── 5e. Objekte ohne Bild gehen ganz über den Live-Kanal ─────────── */

  console.log('\nObjekt verschieben');

  g1.pageOf('p2').objects = [{ id: 'o1', kind: 'file', name: 'Anhang', x: 10, y: 20, w: 100, h: 50 }];
  g1.touch();
  await wait(500);
  check('H hat das Objekt', h1.pageOf('p2').objects.length, 1);

  g1.pageOf('p2').objects[0].x = 300;
  g1.touch();
  await wait(500);
  check('H sieht die neue Stelle', h1.pageOf('p2').objects[0].x, 300);

  /* ── 5f. Bilder gehen über Firestore ─────────────────────────────────
     Bilddaten haben im Änderungsstrom nichts verloren – die Regel der
     Realtime Database lässt je Meldung nur 200.000 Zeichen zu, und ein
     Foto ist schnell größer. Übertragen wird die Lage sofort, das Bild
     selbst über Firestore. */

  console.log('\nBild einfügen');

  h1.fetched.length = 0;
  g1.pageOf('p2').objects.push({
    id: 'o2', kind: 'image', x: 5, y: 5, w: 200, h: 150,
    src: 'data:image/png;base64,' + 'A'.repeat(400)
  });
  g1.touch();
  await wait(500);

  check('H kennt Lage und Größe sofort', h1.pageOf('p2').objects.length, 2);
  check('Aber nicht die Bilddaten', h1.pageOf('p2').objects[1].src, '');
  check('Bilddaten werden nachgeholt', h1.fetched, ['p2']);

  /* ── 5f1. Ein Bild VERSCHIEBEN darf nichts nachladen ─────────────────
     Der Umweg über Firestore gilt den Bilddaten, nicht der Lage. Wurde
     er auch beim Verschieben gegangen, holte sich die Gegenseite die
     Seite neu – mit dem Stand, der dort noch stand – und überschrieb
     damit die gerade richtig angekommene neue Stelle. Beim anderen sprang
     das Bild also zurück, sobald man es bewegte. */

  console.log('\nBild verschieben');

  h1.fetched.length = 0;
  g1.pageOf('p2').objects[1].x = 444;
  g1.pageOf('p2').objects[1].w = 260;
  g1.touch();
  await wait(500);

  check('H sieht die neue Stelle', h1.pageOf('p2').objects[1].x, 444);
  check('Und die neue Größe', h1.pageOf('p2').objects[1].w, 260);
  check('Ohne Umweg über Firestore', h1.fetched, []);
  check('Die Bilddaten bleiben, wie sie waren', h1.pageOf('p2').objects[1].src, '');

  /* ── 5f2. Eine Seite aus einem PDF ───────────────────────────────────
     Der Inhalt einer PDF-Seite steckt in page.bgImg und passt nicht durch
     den Kanal. Vorher stand davon nichts in der Ankündigung: die Seiten
     kamen an, ihr Inhalt nie. Jetzt sagt die Ankündigung, dass noch etwas
     fehlt – und der Empfänger holt es sich selbst, ohne auf einen Hinweis
     des Absenders angewiesen zu sein. */

  console.log('\nPDF-Seite: der Inhalt kommt mit');

  const pdfBild = 'data:image/jpeg;base64,' + 'B'.repeat(300);
  h1.fetched.length = 0;

  /* Beim Empfänger den Weg über Firestore nachbilden – und zwar mit dem
     Wettrennen, an dem es in Wirklichkeit scheiterte: beim ERSTEN Zugriff
     steht die Seite dort noch gar nicht. Wer daraufhin aufgibt, zeigt für
     immer eine leere Seite. */
  let inFirestore = false;
  h1.ctx.window.reloadLivePage = (pageId) => {
    h1.fetched.push(pageId);
    const page = h1.pageOf(pageId);
    if (!page || pageId !== 'pdf1') return Promise.resolve(false);
    if (!inFirestore) { inFirestore = true; return Promise.resolve(false); }
    page.bgImg = pdfBild;
    return Promise.resolve(true);
  };

  g1.notebook.pages.push({
    id: 'pdf1', date: '', bg: 'blank', w: 794, h: 1000,
    textContent: '', inkStrokes: [], objects: [], bgImg: pdfBild
  });
  g1.notebook.sections[0].pgIds.push('pdf1');
  g1.touch();
  await wait(1800);          // lang genug für den zweiten Versuch

  check('Die Seite ist da', h1.pageIds().includes('pdf1'), true);
  check('Der Inhalt wurde angefordert', h1.fetched.includes('pdf1'), true);
  check('Und ist angekommen', h1.pageOf('pdf1').bgImg, pdfBild);
  check('Das Bild ging nicht durch den Kanal',
    bus.log.some(op => typeof op.u === 'string' && op.u.includes(pdfBild)), false);

  // Hinter sich aufräumen – die folgenden Prüfungen zählen Seiten ab
  h1.ctx.window.reloadLivePage = (pageId) => { h1.fetched.push(pageId); return Promise.resolve(false); };
  g1.notebook.pages = g1.notebook.pages.filter(p => p.id !== 'pdf1');
  g1.notebook.sections[0].pgIds = g1.notebook.sections[0].pgIds.filter(id => id !== 'pdf1');
  g1.touch();
  await wait(400);

  /* ── 5f2. Eine Seite, die für den Live-Kanal zu groß ist ─────────────
     Eine schon vollgeschriebene Seite (eingefügt, aus einem PDF) passt
     nicht durch. Sie muss trotzdem SOFORT beim anderen erscheinen –
     ohne Handschrift, die kommt über Firestore nach. Sie ganz
     wegzulassen wäre falsch: der andere erführe nie von ihr. */

  console.log('\nNeue Seite mit sehr viel Handschrift');

  h1.fetched.length = 0;
  const viele = [];
  for (let i = 0; i < 4000; i++) viele.push(makeStroke(i));
  g1.notebook.pages.push({
    id: 'pgross', date: '', bg: null, textContent: '<p>Voll</p>',
    inkStrokes: viele, objects: []
  });
  g1.notebook.sections[0].pgIds.push('pgross');
  g1.touch();
  await wait(500);

  check('Die Seite ist trotzdem sofort da', h1.pageIds().includes('pgross'), true);
  check('Mit Text', h1.pageOf('pgross').textContent, '<p>Voll</p>');
  check('Handschrift kommt über Firestore nach', h1.fetched, ['pgross']);

  // Wieder weg, damit die folgenden Prüfungen übersichtlich bleiben
  g1.notebook.pages = g1.notebook.pages.filter(p => p.id !== 'pgross');
  g1.notebook.sections[0].pgIds = g1.notebook.sections[0].pgIds.filter(id => id !== 'pgross');
  g1.touch();
  await wait(500);

  /* ── 5g. Seite löschen ───────────────────────────────────────────── */

  console.log('\nSeite löschen');

  g1.notebook.pages = g1.notebook.pages.filter(p => p.id !== 'p2');
  g1.notebook.sections[0].pgIds = g1.notebook.sections[0].pgIds.filter(id => id !== 'p2');
  g1.touch();
  await wait(500);

  check('H hat die Seite nicht mehr', h1.pageIds(), ['p9', 'p1']);
  check('Auch nicht im Abschnitt', h1.notebook.sections[0].pgIds, ['p9', 'p1']);

  /* ── 5h. Kein Widerhall ──────────────────────────────────────────────
     Was H von G bekommt, darf H nicht zurückschicken. Sonst schaukeln
     sich zwei Clients gegenseitig hoch, bis nichts mehr geht. */

  console.log('\nKein Widerhall');

  const before = bus.log.length;
  await wait(600);
  h1.touch();
  g1.touch();
  await wait(600);

  check('Nichts läuft im Kreis', bus.log.length, before);

  /* ── 5i. Drei Personen gleichzeitig ──────────────────────────────── */

  console.log('\nDrei Personen an einem Heft');

  bus.listeners.length = 0;
  const p1c = makeClient('P1', 'uid1', makeNotebook());
  const p2c = makeClient('P2', 'uid2', makeNotebook());
  const p3c = makeClient('P3', 'uid3', makeNotebook());
  await p1c.Collab.start('doc7', p1c.notebook, {}, true);
  await p2c.Collab.start('doc7', p2c.notebook, {}, true);
  await p3c.Collab.start('doc7', p3c.notebook, {}, true);

  // Alle drei ändern im selben Moment etwas anderes
  p1c.pageOf('p1').textContent = '<p>Anfang von EINS</p>';
  p1c.Collab.noteTextChange('p1', '<p>Anfang von EINS</p>');

  p2c.notebook.pages.push({ id: 'pz', date: '', bg: null, textContent: '<p>von ZWEI</p>', inkStrokes: [], objects: [] });
  p2c.notebook.sections[0].pgIds.push('pz');
  p2c.touch();

  p3c.pageOf('p2').inkStrokes = [makeStroke(7)];
  p3c.touch();

  await wait(900);

  check('Alle drei kennen die neue Seite', [p1c.pageIds().includes('pz'), p2c.pageIds().includes('pz'), p3c.pageIds().includes('pz')], [true, true, true]);
  check('Alle drei sehen den Text von EINS', [p2c.pageOf('p1').textContent, p3c.pageOf('p1').textContent], ['<p>Anfang von EINS</p>', '<p>Anfang von EINS</p>']);
  check('Alle drei haben den Strich von DREI', [p1c.pageOf('p2').inkStrokes.length, p2c.pageOf('p2').inkStrokes.length], [1, 1]);

  /* ── 5j. Ein Leser bekommt auch den Aufbau mit ────────────────────── */

  console.log('\nLeser sieht auch neue Seiten');

  bus.listeners.length = 0;
  const w2 = makeClient('Schreiber2', 'uidW2', makeNotebook());
  const r2 = makeClient('Leser2', 'uidR2', makeNotebook());
  await w2.Collab.start('doc8', w2.notebook, {}, true);
  await r2.Collab.start('doc8', r2.notebook, {}, false);

  w2.notebook.pages.push({ id: 'pr', date: '', bg: null, textContent: '<p>Für den Leser</p>', inkStrokes: [], objects: [] });
  w2.notebook.sections[0].pgIds.push('pr');
  w2.touch();
  await wait(500);

  check('Leser hat die neue Seite', r2.pageIds().includes('pr'), true);

  const readerOps = bus.log.filter(op => op.by === 'uidR2').length;
  check('Und schickt selbst nichts', readerOps, 0);

  /* ── 5j. Zeilensperre ────────────────────────────────────────────────
     Die Zeile, an der jemand schreibt, und die darauf folgende gehören
     ihm. Gemeldet wird das über die Anwesenheit, zusammen mit der
     Schreibmarke. Geprüft wird hier die Auswertung beim EMPFÄNGER: wo
     greift die Sperre, wo nicht, und wann verfällt sie wieder.

     Sie ist bewusst eine Sache der Oberfläche: Yjs führt gleichzeitige
     Änderungen ohnehin verlustfrei zusammen. Verhindert werden soll, dass
     zwei Leute denselben Satz gleichzeitig umformulieren. */

  console.log('\nZeilensperre');

  const s1 = makeClient('S', 'uidS', makeNotebook([]));
  await s1.Collab.start('doc9', s1.notebook, {}, true);

  // So sieht der Eintrag aus, den ein Schreibender hinterlässt
  presence.set('uidW', {
    uid: 'uidW', name: 'Wanda', initials: 'W', color: '#e07a5f',
    pageId: 'p1', offset: 4, lockFrom: 0, lockTo: 12,
    lockAt: Date.now(), at: Date.now()
  });
  announcePresence();

  check('Mitten in der Zeile gesperrt', s1.Collab.lockOwner('p1', 3, 3)?.name, 'Wanda');
  check('Am Anfang gesperrt', !!s1.Collab.lockOwner('p1', 0, 0), true);
  check('An der hinteren Grenze noch gesperrt', !!s1.Collab.lockOwner('p1', 12, 12), true);
  check('Eine Auswahl, die hineinragt', !!s1.Collab.lockOwner('p1', 10, 30), true);
  check('Dahinter ist frei', s1.Collab.lockOwner('p1', 13, 20), null);
  check('Auf einer anderen Seite ist frei', s1.Collab.lockOwner('p2', 3, 3), null);

  /* Wer aufhört zu schreiben, gibt die Zeile nach dem Nachlauf wieder
     frei. Der Nachlauf ist LOCK_TTL_MS in ui/collab.js – 10 Sekunden.
     Kurz davor muss sie noch stehen, deutlich danach weg sein. */
  presence.get('uidW').lockAt = Date.now() - 8000;
  announcePresence();
  check('Kurz vor Ablauf noch gesperrt', !!s1.Collab.lockOwner('p1', 3, 3), true);

  presence.get('uidW').lockAt = Date.now() - 14000;
  announcePresence();
  check('Nach dem Nachlauf wieder frei', s1.Collab.lockOwner('p1', 3, 3), null);

  // Eine Meldung ohne Zeitstempel sperrt gar nicht – lieber offen als für immer zu
  presence.set('uidW', { ...presence.get('uidW'), lockAt: null, at: Date.now() });
  announcePresence();
  check('Ohne Zeitstempel keine Sperre', s1.Collab.lockOwner('p1', 3, 3), null);

  presence.delete('uidW');
  announcePresence();

  /* ── 5k. Zwei Quellen für dieselbe Stelle ────────────────────────────
     Die Stelle der Schreibmarke kommt auf zwei Wegen herein: an der
     Textänderung (genau, weil sie zum selben Text gehört) und über die
     Anwesenheit (auch ohne Tippen). Die Anwesenheit meldet öfter als der
     Text – beim Tippen traf deshalb regelmäßig eine Stelle ein, die zu
     einem Text gehörte, den es hier noch gar nicht gab. Die Marke sprang
     ans Dokumentende und mit der nächsten Textänderung wieder zurück.

     Solange Textänderungen hereinkommen, muss die Stelle von DORT
     gelten. */

  console.log('\nStelle aus zwei Quellen');

  const karte = (offset) => ({
    uid: 'uidV', name: 'Vera', initials: 'V', color: '#3d5a80',
    pageId: 'p1', offset, lockFrom: -1, lockTo: -1, lockAt: 0, at: Date.now()
  });

  presence.set('uidV', karte(10));
  announcePresence();
  check('Ohne Textänderung gilt die Anwesenheit', s1.Collab.caretOf('uidV'), 10);

  // Eine Textänderung bringt die Stelle mit (u leer: nur die Zahl zählt hier)
  publish({ k: 'y', p: 'p1', u: '', c: 25, by: 'uidV', at: Date.now() });
  await wait(40);
  check('Die Zahl aus der Textänderung gilt', s1.Collab.caretOf('uidV'), 25);

  /* Und eine Anwesenheitsmeldung darf sie nicht wieder überschreiben,
     solange der Vorrang der Textänderung gilt (OP_CARET_TTL_MS).

     >>> Warum hier noch einmal gesendet wird <<<
     Der Vorrang läuft nach knapp einer Sekunde ab, gemessen an der echten
     Uhr. Steht der Rechner in genau diesem Moment (Virenscanner,
     Dateisynchronisation), war er beim Prüfen schon abgelaufen und die
     Anwesenheit galt zu Recht – die Prüfung schlug fehl, ohne dass etwas
     kaputt war. Genau einmal beobachtet und lange gesucht.

     Die Absicht bleibt dieselbe: die Anwesenheit trifft NACH der
     Textänderung ein und darf sie trotzdem nicht verdrängen. Nur die
     Uhr wird davor zurückgesetzt. */
  publish({ k: 'y', p: 'p1', u: '', c: 25, by: 'uidV', at: Date.now() });
  await wait(40);
  presence.set('uidV', karte(12));
  announcePresence();
  check('Die Anwesenheit überschreibt sie nicht', s1.Collab.caretOf('uidV'), 25);

  // Hört das Tippen auf, läuft der Vorrang ab und die Anwesenheit übernimmt
  await wait(1000);
  presence.set('uidV', karte(31));
  announcePresence();
  check('Nach dem Tippen gilt wieder die Anwesenheit', s1.Collab.caretOf('uidV'), 31);

  presence.delete('uidV');
  announcePresence();

  /* ── 5l. Gleichzeitig auf derselben Seite tippen ─────────────────────
     Eine Stelle ist eine Zahl, und Zahlen verrutschen: schreibt jemand
     weiter vorn, steht alles dahinter später. Die fremde Marke säße dann
     um genau diese Länge daneben.

     Deshalb reist ein kurzes Stück Text als Anker mit. Hier wird geprüft,
     dass die Stelle damit auch dann gefunden wird, wenn sich der Text
     seither verschoben hat – nach vorn wie nach hinten. */

  console.log('\nMarke beim gleichzeitigen Tippen');

  const t1 = makeClient('T', 'uidT', makeNotebook([]));
  await t1.Collab.start('doc10', t1.notebook, {}, true);

  // So sieht die Seite bei T aus
  const satz = 'Anfang und dann kommt HIERHIN der Rest';
  t1.setText('p1', satz);

  const stelle = 'Anfang und dann kommt '.length;          // 22, direkt vor HIERHIN
  // Genauso baut ankerAt in collab.js den Anker: zwölf Zeichen je Seite
  const anker = satz.slice(Math.max(0, stelle - 12), stelle + 12);

  presence.set('uidU', {
    uid: 'uidU', name: 'Udo', initials: 'U', color: '#81b29a',
    pageId: 'p1', offset: stelle, cx: anker,
    lockFrom: stelle, lockTo: stelle + 4, lockAt: Date.now(), at: Date.now()
  });
  announcePresence();

  check('Unverschoben: die gemeldete Stelle gilt', t1.Collab.caretOf('uidU'), stelle);

  check('Die Sperre sitzt, wo sie soll',
    !!t1.Collab.lockOwner('p1', stelle, stelle), true);

  /* Jetzt schreibt HIER jemand fünf Zeichen weiter vorn dazu. Die
     gemeldete Zahl 22 zeigt danach fünf Zeichen zu früh. */
  t1.setText('p1', 'AnfangXXXXX und dann kommt HIERHIN der Rest');
  check('Nach eigenem Einfügen davor: Stelle wandert mit',
    t1.Collab.caretOf('uidU'), stelle + 5);

  // Und die Sperre wandert um denselben Betrag mit
  check('Sperre wandert mit', !!t1.Collab.lockOwner('p1', stelle + 5, stelle + 5), true);
  check('Und gilt nicht mehr an der alten Stelle',
    t1.Collab.lockOwner('p1', stelle - 1, stelle - 1), null);

  // Und andersherum: hier wird etwas davor gelöscht
  t1.setText('p1', 'Anf und dann kommt HIERHIN der Rest');
  check('Nach eigenem Löschen davor: Stelle wandert zurück',
    t1.Collab.caretOf('uidU'), stelle - 3);

  // Ist der Anker gar nicht mehr da, bleibt es bei der gemeldeten Zahl
  t1.setText('p1', 'etwas ganz anderes steht hier jetzt');
  check('Ohne Anker im Text: die gemeldete Stelle', t1.Collab.caretOf('uidU'), stelle);

  presence.delete('uidU');
  announcePresence();

  /* ── 6. Ohne Live-Verbindung darf nichts krachen ─────────────────── */

  console.log('\nOhne Live-Verbindung');

  const lonely = makeClient('Allein', 'uidL', makeNotebook());
  lonely.ctx.window.InkwellsShare.joinDocRoom = async () => { throw new Error('RTDB_UNAVAILABLE'); };
  await lonely.Collab.start('doc4', lonely.notebook, {}, true);

  check('Meldet sich als nicht live', lonely.Collab.isLive(), false);

  let crashed = false;
  try {
    lonely.pageOf('p1').textContent = '<p>Trotzdem tippen</p>';
    lonely.Collab.noteTextChange('p1', '<p>Trotzdem tippen</p>');
    await wait(400);
  } catch (err) { crashed = true; }
  check('Tippen läuft trotzdem', crashed, false);
  check('Yjs-Stand wird trotzdem geführt', typeof lonely.Collab.stateFor('p1'), 'string');

  for (const client of clients) {
    try { await client.Collab.stop(); } catch (err) { /* war nie live */ }
  }

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
})();
