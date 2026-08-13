#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ÖRTLICHER VERSIONSVERLAUF UND ZWEI FASSUNGEN

   Prüft core/versions.js und core/conflicts.js zusammen. Nachgebaut sind
   nur die Platte (window.api) und die paar Globalen, die beide anfassen –
   es gibt kein Fenster und keine Cloud.

   >>> Warum das einen Test verdient <<<
   Beide sind Netze unter einem Datenverlust, und ein Netz mit einem Loch
   ist schlimmer als gar keines: man verlässt sich darauf. Die Fälle unten
   sind genau die, bei denen etwas verschwinden würde.

   Besonders der letzte: der Merkzettel von Papierkorb, Übersicht UND
   Versionsverlauf steht in EINER Datei. Wer sie schreibt, ohne die
   fremden Felder mitzunehmen, löscht die Arbeit des anderen – und zwar
   lautlos.

   Aufruf:  node scripts/test-versions.js
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
function ok(label, cond) { check(label, !!cond, true); }

/* ── Die Welt drumherum ─────────────────────────────────────────────── */

function baueWelt() {
  // Die „Platte": Pfad -> Inhalt
  const platte = new Map();
  let registry = {};

  const api = {
    async saveToPath(pfad, daten) {
      platte.set(pfad, JSON.parse(JSON.stringify(daten)));
      return { success: true, path: pfad };
    },
    async loadFromPath(pfad) {
      if (!platte.has(pfad)) return { success: false, error: 'File not found' };
      return { success: true, data: JSON.parse(JSON.stringify(platte.get(pfad))) };
    },
    async deleteFile(pfad) {
      const da = platte.delete(pfad);
      return { success: da };
    },
    async loadRegistry() { return JSON.parse(JSON.stringify(registry)); },
    async saveRegistry(daten) { registry = JSON.parse(JSON.stringify(daten)); return true; }
  };

  const S = { notebooks: [] };
  const gespeichert = [];

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Array, Object, Set, Map, Promise,
    setTimeout, clearTimeout, isNaN, parseInt,
    S,
    Settings: { get: (k) => (k === 'saveLocation' ? 'C:\\Hefte' : null) },
    getNb: (id) => S.notebooks.find(nb => nb.id === id) || null,
    FileManager_: {
      async saveNotebook(nb) { gespeichert.push(nb.id); return { success: true, path: 'x' }; }
    },
    t: (k) => k,
    toast() {},
    renderHomeGrid() {},
    // conflicts.js sucht das Band; ohne Fenster gibt es keines
    document: { getElementById: () => null }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.window.api = api;

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core/versions.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core/conflicts.js'), 'utf8'), ctx);

  ctx._platte = platte;
  ctx._gespeichert = gespeichert;
  ctx._registry = () => registry;
  return ctx;
}

function heft(id, name, seiten = 1) {
  return {
    id, name, color: '#000', defaultBg: 'ruled',
    updatedAt: new Date().toISOString(),
    sections: [],
    pages: Array.from({ length: seiten }, (_, i) => ({
      id: `p${i}`, textContent: `<p>Seite ${i}</p>`, inkStrokes: [], objects: []
    }))
  };
}

(async () => {

  console.log('Ein Stand entsteht und laesst sich zurueckholen');
  {
    const w = baueWelt();
    const nb = heft('nb1', 'Mathe', 2);
    w.S.notebooks.push(nb);

    const stand = await w.Versions.sichere(nb, 'auto');
    ok('Der Stand ist da', !!stand);
    check('Er kennt die Zahl der Seiten', stand.seiten, 2);
    ok('Und liegt unter dem Speicherort', stand.pfad.startsWith('C:\\Hefte\\Versionen\\'));
    ok('Der Dateiname hat keinen Doppelpunkt', !stand.pfad.slice(3).includes(':'));

    const liste = await w.Versions.liste('nb1');
    check('Er steht in der Liste', liste.length, 1);
    check('Ein anderes Heft sieht ihn nicht', (await w.Versions.liste('nb2')).length, 0);

    // Jetzt das Heft veraendern und den Stand zurueckholen
    nb.name = 'Mathe (geaendert)';
    nb.pages.push({ id: 'p9', textContent: '<p>Neu</p>', inkStrokes: [], objects: [] });

    const res = await w.Versions.stelleHer(stand);
    ok('Das Zurueckholen gelingt', res.success);
    check('Der alte Name ist wieder da', w.getNb('nb1').name, 'Mathe');
    check('Und die alte Seitenzahl', w.getNb('nb1').pages.length, 2);
    check('Die Kennung bleibt', w.getNb('nb1').id, 'nb1');
  }

  console.log('\nDer aktuelle Stand geht beim Zurueckholen NICHT verloren');
  {
    const w = baueWelt();
    const nb = heft('nb1', 'Alt', 1);
    w.S.notebooks.push(nb);
    const alt = await w.Versions.sichere(nb, 'auto');

    nb.name = 'Neu';
    nb.pages.push({ id: 'p9', textContent: '<p>Wichtig</p>', inkStrokes: [], objects: [] });

    await w.Versions.stelleHer(alt);

    const liste = await w.Versions.liste('nb1');
    const vorher = liste.find(e => e.grund === 'vorher');
    ok('Es gibt einen Stand "vorher"', !!vorher);
    const gerettet = await w.Versions.lade(vorher);
    check('Er traegt den Stand von eben', gerettet.name, 'Neu');
    check('Samt der zusaetzlichen Seite', gerettet.pages.length, 2);
  }

  console.log('\nDie Bremse: nicht bei jedem Speichern ein Stand');
  {
    const w = baueWelt();
    const nb = heft('nb1', 'Mathe', 1);
    w.S.notebooks.push(nb);

    check('Der erste Aufruf legt einen an',
      !!(await w.Versions.vielleichtSichern(nb)), true);
    check('Der zweite gleich danach nicht',
      await w.Versions.vielleichtSichern(nb), null);

    // Die Zeitsperre aufheben, aber am Inhalt hat sich nichts getan
    w.Versions._zuletzt.clear();
    check('Auch nicht ohne Zeitsperre, solange nichts anders ist',
      await w.Versions.vielleichtSichern(nb), null);

    w.Versions._zuletzt.clear();
    nb.pages[0].textContent = '<p>Etwas ganz anderes und laenger</p>';
    ok('Nach einer echten Aenderung schon',
      !!(await w.Versions.vielleichtSichern(nb)));
  }

  console.log('\nZwei Fassungen: beide werden weggelegt');
  {
    const w = baueWelt();
    const meins = heft('nb1', 'Mathe', 3);
    const fremd = heft('nb1', 'Mathe', 5);
    w.S.notebooks.push(meins);

    await w.Conflicts.melde(meins, fremd);
    check('Es gibt genau einen offenen Konflikt', w.Conflicts.anzahl(), 1);

    const staende = await w.Versions.liste('nb1');
    check('Und zwei Staende dazu', staende.length, 2);
    ok('Einer ist die eigene Fassung', staende.some(e => e.grund === 'konflikt'));
    ok('Einer die fremde', staende.some(e => e.grund === 'fremd'));

    const fremdStand = staende.find(e => e.grund === 'fremd');
    const gelesen = await w.Versions.lade(fremdStand);
    check('Die fremde Fassung hat ihre Seiten behalten', gelesen.pages.length, 5);
    check('Und traegt die Kennung des eigenen Hefts', gelesen.id, 'nb1');
  }

  console.log('\nZwei Fassungen: die Entscheidung');
  {
    const w = baueWelt();
    const meins = heft('nb1', 'Meins', 3);
    const fremd = heft('nb1', 'Fremd', 5);
    w.S.notebooks.push(meins);
    await w.Conflicts.melde(meins, fremd);

    // Der Abgleich hat inzwischen die fremde Fassung eingesetzt
    w.S.notebooks[0] = JSON.parse(JSON.stringify(fremd));

    ok('"Meine behalten" gelingt', await w.Conflicts.behalteMeins('nb1'));
    check('Und meine Fassung steht wieder da', w.getNb('nb1').name, 'Meins');
    check('Der Konflikt ist erledigt', w.Conflicts.anzahl(), 0);
    check('Ein zweites Mal tut nichts', await w.Conflicts.behalteMeins('nb1'), false);
  }

  {
    const w = baueWelt();
    const meins = heft('nb1', 'Meins', 3);
    const fremd = heft('nb1', 'Fremd', 5);
    w.S.notebooks.push(meins);
    await w.Conflicts.melde(meins, fremd);

    ok('"Cloud behalten" gelingt', await w.Conflicts.behalteCloud('nb1'));
    check('Und die fremde Fassung steht da', w.getNb('nb1').name, 'Fremd');
    check('Mit ihren Seiten', w.getNb('nb1').pages.length, 5);
    check('Der Konflikt ist erledigt', w.Conflicts.anzahl(), 0);
  }

  console.log('\nVerwerfen wirft die Staende NICHT weg');
  {
    const w = baueWelt();
    const meins = heft('nb1', 'Meins', 3);
    w.S.notebooks.push(meins);
    await w.Conflicts.melde(meins, heft('nb1', 'Fremd', 5));

    w.Conflicts.verwirf('nb1');
    check('Kein offener Konflikt mehr', w.Conflicts.anzahl(), 0);
    check('Aber beide Staende liegen noch da', (await w.Versions.liste('nb1')).length, 2);
  }

  console.log('\nDas Aufraeumen laesst die Konflikt-Staende in Ruhe');
  {
    const w = baueWelt();
    const nb = heft('nb1', 'Mathe', 1);
    w.S.notebooks.push(nb);

    await w.Conflicts.melde(nb, heft('nb1', 'Fremd', 2));

    // Mehr gewoehnliche Staende anlegen, als aufbewahrt werden
    for (let i = 0; i < 30; i++) {
      nb.pages[0].textContent = '<p>' + 'x'.repeat(i + 1) + '</p>';
      await w.Versions.sichere(nb, 'auto');
    }

    const liste = await w.Versions.liste('nb1');
    const auto = liste.filter(e => e.grund === 'auto');
    ok('Die gewoehnlichen Staende sind begrenzt', auto.length <= 25);
    check('Die beiden Konflikt-Staende sind noch da',
      liste.filter(e => e.grund === 'konflikt' || e.grund === 'fremd').length, 2);
  }

  console.log('\nEin geloeschtes Heft nimmt seine Staende mit');
  {
    const w = baueWelt();
    const nb = heft('nb1', 'Mathe', 1);
    const nb2 = heft('nb2', 'Deutsch', 1);
    w.S.notebooks.push(nb, nb2);
    const a = await w.Versions.sichere(nb, 'auto');
    const b = await w.Versions.sichere(nb2, 'auto');

    await w.Versions.entferneHeft('nb1');
    check('Kein Stand mehr fuer nb1', (await w.Versions.liste('nb1')).length, 0);
    check('Die Datei ist weg', w._platte.has(a.pfad), false);
    check('Das andere Heft bleibt unberuehrt', (await w.Versions.liste('nb2')).length, 1);
    check('Und seine Datei auch', w._platte.has(b.pfad), true);
  }

  console.log('\nDer gemeinsame Merkzettel bleibt heil');
  {
    const w = baueWelt();
    const nb = heft('nb1', 'Mathe', 1);
    w.S.notebooks.push(nb);

    // So, wie Registry und Trash die Datei hinterlassen
    await w.window.api.saveRegistry({
      notebooks: [{ id: 'nb1', path: 'C:\\Hefte\\Mathe.jrnl' }],
      trash: [{ id: 'alt', name: 'Weg' }]
    });

    await w.Versions.sichere(nb, 'auto');

    const datei = w._registry();
    check('Die Uebersicht steht noch drin', datei.notebooks.length, 1);
    check('Der Papierkorb auch', datei.trash.length, 1);
    check('Und der Verlauf ist dazugekommen', datei.versions.length, 1);
  }

  console.log('');
  if (failed) {
    console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('Alle Pruefungen bestanden.');
})();
