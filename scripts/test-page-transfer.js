#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   SEITEN ZWISCHEN HEFTEN BEWEGEN

   Prüft den Kern aus core/data.js: clonePage, insertPageInto,
   transferPages. Keine Oberfläche, keine Cloud, keine Freigabe – die
   Funktionen kennen davon nichts, und genau das soll hier festgehalten
   werden.

   >>> Worauf es ankommt <<<
   Kopierte Seiten MÜSSEN neue Kennungen bekommen, für die Seite und für
   jedes Objekt darauf. Die Kennungen sind keine Namen, sondern Schlüssel:
   getPage() sucht über alle offenen Hefte, in Firestore heißen die
   Bild-Ablagen `obj_<seite>_<objekt>` und `bg_<seite>`, und der Empfänger
   im Raum verwirft eine bereits bekannte Seitenkennung stillschweigend.

   Und: nb.pages darf nur ERGÄNZT werden. Beim Sichern löscht
   saveDocumentContent in Firestore jede Seite, die im Vergleichsstand
   steht und im neuen fehlt – samt Handschrift und Bildern.

   Aufruf:  node scripts/test-page-transfer.js
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

/* ── core/data.js für sich laden ─────────────────────────────────────
   Die Datei ist ein klassisches Script und erwartet uid(), S und ein
   paar Helfer aus state.js. Nachgebaut wird nur, was sie wirklich
   anfasst. */
function loadData() {
  let counter = 0;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Array, Object, Set,
    // Aufsteigend statt zufällig: so sind die Kennungen im Fehlerfall
    // lesbar, und Doppelte fielen sofort auf.
    uid: () => 'id' + (++counter),
    S: { notebooks: [], activeNbId: null, activePgId: null, strokeHistory: {} }
  };
  ctx.self = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core/data.js'), 'utf8'), ctx);
  return ctx;
}

/** Ein Heft mit n Seiten, die erste mit Bild und Handschrift. */
function makeNotebook(ctx, name, n) {
  const pages = [];
  for (let i = 0; i < n; i++) {
    pages.push({
      id: `${name}-p${i + 1}`,
      date: '2026-08-01T00:00:00.000Z',
      bg: 'ruled',
      textContent: `<p>${name} Seite ${i + 1}</p>`,
      inkStrokes: i === 0 ? [{ pts: [1, 2, 3] }] : [],
      objects: i === 0 ? [{ id: `${name}-o1`, kind: 'image', src: 'data:image/png;base64,AAAA', x: 1, y: 2 }] : []
    });
  }
  const nb = {
    id: name, name, color: '#000', defaultBg: 'ruled',
    pages,
    sections: [{ id: `${name}-s1`, name: 'A', pgIds: pages.map(p => p.id), defaultBg: 'ruled' }]
  };
  nb.activeSecId = nb.sections[0].id;
  ctx.S.notebooks.push(nb);
  return nb;
}

(async () => {
  console.log('Kopieren');

  {
    const ctx = loadData();
    const from = makeNotebook(ctx, 'A', 3);
    const to = makeNotebook(ctx, 'B', 1);

    const res = ctx.transferPages(from, ['A-p1', 'A-p3'], to, { copy: true });

    check('Zwei Seiten übertragen', res.moved, 2);
    check('Die Quelle bleibt unverändert', from.pages.map(p => p.id), ['A-p1', 'A-p2', 'A-p3']);
    check('Das Ziel hat jetzt drei Seiten', to.pages.length, 3);

    const neue = to.pages.slice(1);
    ok('Die Kopien haben NEUE Seitenkennungen',
      neue.every(p => !['A-p1', 'A-p3'].includes(p.id)));
    ok('Auch die Objekte bekamen neue Kennungen',
      neue[0].objects.every(o => o.id !== 'A-o1'));
    check('Der Inhalt ist mitgekommen', neue[0].textContent, '<p>A Seite 1</p>');
    check('Die Bilddaten auch', neue[0].objects[0].src, 'data:image/png;base64,AAAA');
    check('Die Handschrift auch', neue[0].inkStrokes.length, 1);

    /* Tiefe Kopie: am Original zu drehen darf die Kopie nicht berühren.
       Sonst hingen zwei Hefte an denselben Objekten. */
    from.pages[0].objects[0].x = 999;
    check('Die Kopie hängt nicht am Original', neue[0].objects[0].x, 1);

    check('Der Abschnitt des Ziels führt alle drei',
      to.sections[0].pgIds.length, 3);
    check('Reihenfolge des Ausgangshefts, nicht des Anklickens',
      [neue[0].textContent, neue[1].textContent],
      ['<p>A Seite 1</p>', '<p>A Seite 3</p>']);
  }

  console.log('\nVerschieben');

  {
    const ctx = loadData();
    const from = makeNotebook(ctx, 'A', 3);
    const to = makeNotebook(ctx, 'B', 1);
    ctx.S.strokeHistory['A-p1'] = [{ irgendwas: true }];

    const res = ctx.transferPages(from, ['A-p1'], to);

    check('Eine Seite übertragen', res.moved, 1);
    check('In der Quelle ist sie weg', from.pages.map(p => p.id), ['A-p2', 'A-p3']);
    check('Und aus dem Abschnitt heraus', from.sections[0].pgIds, ['A-p2', 'A-p3']);
    check('Im Ziel ist sie da', to.pages.map(p => p.id), ['B-p1', 'A-p1']);
    check('Und im Abschnitt des Ziels', to.sections[0].pgIds, ['B-p1', 'A-p1']);
    check('Die Kennung bleibt beim Verschieben', to.pages[1].id, 'A-p1');
    ok('Der Rückgängig-Verlauf wurde geräumt', !ctx.S.strokeHistory['A-p1']);
  }

  console.log('\nAlle Seiten aus einem Heft heraus');

  {
    const ctx = loadData();
    const from = makeNotebook(ctx, 'A', 2);
    const to = makeNotebook(ctx, 'B', 1);

    ctx.transferPages(from, ['A-p1', 'A-p2'], to);

    check('Eine leere Seite wächst nach', from.pages.length, 1);
    ok('Sie hängt auch im Abschnitt', from.sections[0].pgIds.length === 1);
    check('Und sie ist wirklich leer', from.pages[0].textContent, '');
    check('Das Ziel hat alle drei', to.pages.length, 3);
  }

  console.log('\nWas nicht passieren darf');

  {
    const ctx = loadData();
    const from = makeNotebook(ctx, 'A', 2);
    const to = makeNotebook(ctx, 'B', 2);
    const zielVorher = to.pages.map(p => p.id);

    ctx.transferPages(from, ['A-p1'], to);

    /* nb.pages darf nur ergänzt werden. Beim Sichern löscht Firestore
       sonst die Seiten der anderen samt Handschrift und Bildern. */
    check('Die vorhandenen Seiten des Ziels bleiben unangetastet',
      to.pages.slice(0, 2).map(p => p.id), zielVorher);

    check('Ins selbe Heft übertragen tut nichts',
      ctx.transferPages(from, ['A-p2'], from).moved, 0);
    check('Ohne Seiten passiert nichts', ctx.transferPages(from, [], to).moved, 0);
    check('Unbekannte Kennungen werden übergangen',
      ctx.transferPages(from, ['gibtsnicht'], to).moved, 0);
  }

  /* ── Die Reihenfolge des Hefts ───────────────────────────────────────
     Es gab zwei Reihenfolgen, und sie stimmten nicht überein: nb.pages ist
     reine Einfüge-Reihenfolge, angezeigt wurde aneinandergehängt, was in
     den pgIds steht. Wer eine Seite in die Mitte einfügte, hatte sie in
     pgIds richtig und in nb.pages ganz hinten – und weil head.pageOrder
     aus nb.pages gebildet wird, stand in der Cloud die falsche.

     notebookPages() ist ab jetzt die eine Wahrheit. */

  console.log('\nDie Reihenfolge des Hefts');

  {
    const ctx = loadData();
    const nb = {
      id: 'nb', name: 'Mathe', defaultBg: 'ruled',
      pages: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'mitte' }],
      sections: [
        { id: 's1', name: 'Regeln', pgIds: ['p1', 'mitte', 'p2'], defaultBg: 'ruled' },
        { id: 's2', name: 'Übungen', pgIds: ['p3'], defaultBg: 'ruled' }
      ]
    };

    check('Nicht die Einfüge-Reihenfolge, sondern die des Hefts',
      ctx.notebookPages(nb).map(p => p.id), ['p1', 'mitte', 'p2', 'p3']);
    check('Die Seitenzahl folgt daraus', ctx.pageNumberOf(nb, 'mitte'), 2);
    check('Und für die letzte Seite', ctx.pageNumberOf(nb, 'p3'), 4);
    check('Eine unbekannte Seite hat keine Nummer', ctx.pageNumberOf(nb, 'weg'), 0);

    // Eine Seite, die in keinem Abschnitt steht, darf nicht verschwinden
    const heimatlos = {
      pages: [{ id: 'a' }, { id: 'ohne' }, { id: 'b' }],
      sections: [{ id: 's1', pgIds: ['a', 'b'] }]
    };
    check('Seiten ohne Abschnitt hängen hinten an',
      ctx.notebookPages(heimatlos).map(p => p.id), ['a', 'b', 'ohne']);

    // Steht eine Seite versehentlich in zwei Abschnitten, zählt der erste
    const doppelt = {
      pages: [{ id: 'x' }, { id: 'y' }],
      sections: [{ id: 's1', pgIds: ['x', 'y'] }, { id: 's2', pgIds: ['y'] }]
    };
    check('Doppelt eingetragene Seiten erscheinen nur einmal',
      ctx.notebookPages(doppelt).map(p => p.id), ['x', 'y']);

    check('Ein Heft ohne Abschnitte behält seine Reihenfolge',
      ctx.notebookPages({ pages: [{ id: 'e' }, { id: 'f' }] }).map(p => p.id), ['e', 'f']);
    check('Und ohne Seiten kommt nichts', ctx.notebookPages({ pages: [] }), []);
  }

  console.log('\nEinsetzen an einer bestimmten Stelle');

  {
    const ctx = loadData();
    const nb = makeNotebook(ctx, 'A', 3);
    const sec = nb.sections[0];

    ctx.insertPageInto(nb, sec, ctx.makePage('ruled'), 1);

    check('Die neue Seite sitzt an zweiter Stelle', sec.pgIds[1], nb.pages[3].id);
    check('Und die Liste kennt sie', nb.pages.length, 4);
  }

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})();
