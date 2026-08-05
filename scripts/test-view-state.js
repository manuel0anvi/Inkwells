#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   WO MAN EIN HEFT ZULETZT VERLASSEN HAT

   Prüft die Merkstelle aus core/settings.js: Seite und gewählter
   Abschnitt, je Heft.

   >>> Worauf es ankommt <<<
   Das steht ÖRTLICH und nicht im Heft. Bei einem geteilten Dokument ist
   es Sache jedes Einzelnen, wo er gerade liest – stünde es im Heft, risse
   einen das Blättern des anderen mit. Genau deshalb hält ui/collab.js
   activeSecId auch aus dem Struktur-Abgleich heraus.

   Und: geschrieben wird verzögert. setActivePg läuft beim Scrollen an
   jeder Seite; dafür jedes Mal eine Datei anzufassen wäre unsinnig.

   Aufruf:  node scripts/test-view-state.js
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

/* ── core/settings.js für sich laden ──────────────────────────────────
   Die Datei erwartet window.api zum Speichern. Nachgebaut wird nur, was
   die Merkstelle wirklich anfasst; gezählt wird dabei, wie oft wirklich
   geschrieben wurde. */
function loadSettings() {
  const geschrieben = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Array, Object, Set, Promise,
    setTimeout, clearTimeout,
    window: {
      api: {
        async saveSettings(data) { geschrieben.push(JSON.parse(JSON.stringify(data))); },
        async loadSettings() { return null; }
      }
    }
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core/settings.js'), 'utf8'), ctx);
  ctx._geschrieben = geschrieben;
  return ctx;
}

const warte = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  console.log('Merken und Wiederfinden');

  {
    const ctx = loadSettings();

    check('Ein unbekanntes Heft hat nichts', ctx.getNotebookView('nb1'), {});

    ctx.rememberNotebookView('nb1', { pageId: 'p7' });
    check('Die Seite ist gemerkt', ctx.getNotebookView('nb1').pageId, 'p7');

    ctx.rememberNotebookView('nb1', { secId: 'sR' });
    check('Der Abschnitt kommt dazu', ctx.getNotebookView('nb1'), { pageId: 'p7', secId: 'sR' });

    ctx.rememberNotebookView('nb1', { pageId: 'p9' });
    check('Die Seite wird ueberschrieben, der Abschnitt bleibt',
      ctx.getNotebookView('nb1'), { pageId: 'p9', secId: 'sR' });

    ctx.rememberNotebookView('nb2', { pageId: 'x1' });
    check('Jedes Heft fuer sich', ctx.getNotebookView('nb1').pageId, 'p9');
    check('Und das zweite auch', ctx.getNotebookView('nb2').pageId, 'x1');

    // „Alle Seiten" ist eine gueltige Wahl und muss sich merken lassen
    ctx.rememberNotebookView('nb1', { secId: '' });
    check('Leerer Abschnitt heisst alle Seiten', ctx.getNotebookView('nb1').secId, '');
  }

  console.log('\nGeschrieben wird verzoegert');

  {
    const ctx = loadSettings();

    // Beim Scrollen laeuft das an jeder Seite – das darf keine Datei kosten
    for (let i = 0; i < 40; i++) ctx.rememberNotebookView('nb1', { pageId: 'p' + i });
    check('Vierzig Male, keine Schreibung', ctx._geschrieben.length, 0);
    check('Im Speicher steht trotzdem der letzte Stand',
      ctx.getNotebookView('nb1').pageId, 'p39');

    await ctx.flushNotebookView();
    check('Nachholen schreibt genau einmal', ctx._geschrieben.length, 1);
    check('Und zwar den letzten Stand',
      ctx._geschrieben[0].notebookViewState.nb1.pageId, 'p39');

    // Ohne Ausstehendes gibt es nichts nachzuholen
    await ctx.flushNotebookView();
    check('Ein zweites Nachholen schreibt nicht noch einmal', ctx._geschrieben.length, 1);
  }

  {
    const ctx = loadSettings();
    ctx.rememberNotebookView('nb1', { pageId: 'p1' });
    await warte(2300);
    check('Von selbst wird nach der Wartezeit geschrieben', ctx._geschrieben.length, 1);
  }

  {
    // Derselbe Stand noch einmal ist keine Aenderung
    const ctx = loadSettings();
    ctx.rememberNotebookView('nb1', { pageId: 'p1' });
    await ctx.flushNotebookView();
    const vorher = ctx._geschrieben.length;
    ctx.rememberNotebookView('nb1', { pageId: 'p1' });
    await ctx.flushNotebookView();
    check('Unveraendert loest nichts aus', ctx._geschrieben.length, vorher);
  }

  console.log('\nDie Datei waechst nicht ohne Ende');

  {
    const ctx = loadSettings();
    for (let i = 0; i < 260; i++) ctx.rememberNotebookView('nb' + i, { pageId: 'p' + i });

    /* Der ganze Bestand ist von aussen nicht zu greifen: `const Settings`
       bleibt im Skript-Bereich der vm. Also ueber die Merkstelle selbst
       zaehlen – das ist ohnehin der Weg, den die App nimmt. */
    let vorhanden = 0;
    for (let i = 0; i < 260; i++) if (ctx.getNotebookView('nb' + i).pageId) vorhanden++;

    check('Hoechstens 200 Hefte', vorhanden, 200);
    ok('Das aelteste ist weg', !ctx.getNotebookView('nb0').pageId);
    ok('Das neueste steht drin', !!ctx.getNotebookView('nb259').pageId);
  }

  {
    // Ein wieder benutztes Heft rutscht ans Ende und faellt nicht heraus
    const ctx = loadSettings();
    ctx.rememberNotebookView('alt', { pageId: 'p1' });
    for (let i = 0; i < 199; i++) ctx.rememberNotebookView('nb' + i, { pageId: 'p' + i });
    ctx.rememberNotebookView('alt', { pageId: 'p2' });      // wieder benutzt
    for (let i = 200; i < 260; i++) ctx.rememberNotebookView('nb' + i, { pageId: 'p' + i });

    check('Das Wiederbenutzte hat ueberlebt', ctx.getNotebookView('alt').pageId, 'p2');
  }

  if (failed > 0) {
    console.error(`\n${failed} Pruefung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Pruefungen bestanden.');
})();
