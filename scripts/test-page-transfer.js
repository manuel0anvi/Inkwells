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
  // So, wie ein Heft nach dem Laden vorliegt: umgestellt, mit Etiketten
  ctx.normalizeNotebook(nb);
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
    /* Sie bekommt bewusst KEIN Etikett: welches sollte es sein? Unter
       Etiketten ist eine Seite ohne Zuordnung völlig in Ordnung, und eine
       geratene wäre schlechter als keine. */
    ok('Und zwar ohne Etikett', !from.pages[0].secId);
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

  /* ── Aus Kapiteln werden Etiketten ───────────────────────────────────
     Ein altes Heft trägt seine Reihenfolge in den pgIds der Abschnitte.
     normalizeNotebook macht daraus eine durchgehende Folge und hängt jeder
     Seite ihr Etikett an. Verlustfrei: die neue Reihenfolge ist genau die,
     die man vorher beim Durchblättern gesehen hätte. */

  console.log('\nMigration eines alten Hefts');

  {
    const ctx = loadData();
    const alt = {
      id: 'nb', name: 'Mathe', defaultBg: 'ruled',
      // Einfüge-Reihenfolge, absichtlich durcheinander
      pages: [{ id: 'u1' }, { id: 'r1' }, { id: 'ohne' }, { id: 'r2' }, { id: 'u2' }],
      sections: [
        { id: 'sR', name: 'Regeln', pgIds: ['r1', 'r2'], defaultBg: 'ruled' },
        { id: 'sU', name: 'Übungen', pgIds: ['u1', 'u2'], defaultBg: 'grid' }
      ]
    };

    ctx.normalizeNotebook(alt);

    check('Die Reihenfolge ist die, die man gesehen hätte',
      alt.pages.map(p => p.id), ['r1', 'r2', 'u1', 'u2', 'ohne']);
    check('Jede Seite trägt ihr Etikett',
      alt.pages.map(p => p.secId || '-'), ['sR', 'sR', 'sU', 'sU', '-']);
    check('Das Heft ist als umgestellt vermerkt', alt.schemaVersion, 2);

    // Nochmal anwenden darf nichts verändern
    const vorher = JSON.stringify(alt);
    ctx.normalizeNotebook(alt);
    check('Ein zweiter Durchlauf ändert nichts', JSON.stringify(alt), vorher);

    /* pgIds werden weiter mitgeschrieben, damit ein Stand ohne diesen
       Umbau die Abschnitte nicht für leer hält und Füllseiten anlegt. */
    check('pgIds bleiben abgeleitet gefüllt',
      alt.sections.map(s => s.pgIds.join(',')), ['r1,r2', 'u1,u2']);

    check('Ein Abschnitt ist ein Ausschnitt',
      ctx.pagesOfSec(alt.sections[0], alt).map(p => p.id), ['r1', 'r2']);
    check('Und die Seitenzahlen bleiben die des Hefts',
      ctx.pagesOfSec(alt.sections[1], alt).map(p => ctx.pageNumberOf(alt, p.id)), [3, 4]);
  }

  /* ── Der Zwangsabschnitt „Allgemein" verschwindet ────────────────────
     Solange die Anzeige an pgIds hing, legte getSections() ungefragt einen
     Abschnitt dieses Namens an, der ALLE Seiten enthielt. Als Etikett sagt
     er nichts aus, klebt aber auf jeder Seite und steht in der Navigation
     als Auswahl, die dasselbe zeigt wie „Alle Seiten". */

  console.log('\nDer Zwangsabschnitt wird abgeräumt');

  {
    const ctx = loadData();
    const alt = {
      id: 'nb', defaultBg: 'ruled', activeSecId: 'sA',
      pages: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      sections: [{ id: 'sA', name: 'Allgemein', pgIds: ['p1', 'p2', 'p3'], defaultBg: 'ruled' }]
    };
    ctx.normalizeNotebook(alt);

    check('Der Abschnitt ist weg', alt.sections, []);
    check('Keine Seite trägt noch ein Etikett',
      alt.pages.map(p => p.secId || '-'), ['-', '-', '-']);
    check('Die Seiten sind vollzählig und in Reihenfolge',
      alt.pages.map(p => p.id), ['p1', 'p2', 'p3']);
    check('Die Ansicht steht auf allen Seiten', alt.activeSecId, '');
  }

  {
    // Auch ein bereits umgestelltes Heft wird noch abgeräumt – die
    // Abschaffung kam später als die Umstellung selbst.
    const ctx = loadData();
    const schon = {
      id: 'nb', defaultBg: 'ruled', schemaVersion: 2,
      pages: [{ id: 'p1', secId: 'sA' }, { id: 'p2', secId: 'sA' }],
      sections: [{ id: 'sA', name: 'General', pgIds: ['p1', 'p2'], defaultBg: 'ruled' }]
    };
    ctx.normalizeNotebook(schon);
    check('Auch nachträglich', schon.sections, []);
    check('Und die Etiketten sind ab', schon.pages.map(p => p.secId || '-'), ['-', '-']);
  }

  {
    // Wer selbst geordnet hat, behält seinen Abschnitt – auch wenn er
    // zufällig so heißt.
    const ctx = loadData();
    const eigen = {
      id: 'nb', defaultBg: 'ruled',
      pages: [{ id: 'p1' }, { id: 'p2' }],
      sections: [
        { id: 'sA', name: 'Allgemein', pgIds: ['p1'], defaultBg: 'ruled' },
        { id: 'sB', name: 'Anhang', pgIds: ['p2'], defaultBg: 'ruled' }
      ]
    };
    ctx.normalizeNotebook(eigen);
    check('Neben anderen bleibt er stehen',
      eigen.sections.map(s => s.id), ['sA', 'sB']);
    check('Und die Etiketten sitzen',
      eigen.pages.map(p => p.secId), ['sA', 'sB']);
  }

  /* ── Seiten umsortieren ──────────────────────────────────────────────
     Gezogen wird in einer Liste, die womoeglich nur ein Ausschnitt ist.
     Deshalb nimmt movePageBefore keinen Index, sondern den Nachbarn: der
     steht im Heft an genau einer Stelle, gleich welcher Filter wirkt. */

  /* ── Das Etikett mit ins andere Heft ─────────────────────────────────
     Verglichen wird ueber den NAMEN: Kennungen sind je Heft vergeben,
     dieselbe „Uebungen" hat in zwei Heften zwangslaeufig verschiedene.
     Und die Farbe muss festgeschrieben werden – ohne eigene Wahl haengt
     sie an der Kennung, und die ist im Ziel eine andere. */

  console.log('\nAbschnitt beim Uebertragen mitnehmen');

  {
    const ctx = loadData();
    const von = {
      id: 'A', name: 'A', defaultBg: 'ruled',
      pages: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
      sections: [
        { id: 'aR', name: 'Regeln', pgIds: ['a1', 'a2'], defaultBg: 'grid' },
        { id: 'aU', name: 'Uebungen', pgIds: ['a3'], defaultBg: 'ruled' }
      ]
    };
    const nach = { id: 'B', name: 'B', defaultBg: 'ruled', pages: [{ id: 'b1' }], sections: [] };
    ctx.normalizeNotebook(von);
    ctx.normalizeNotebook(nach);
    ctx.S.notebooks.push(von, nach);

    const farbeVorher = ctx.colorForSection(von.sections[0]);

    ctx.transferPages(von, ['a1', 'a3'], nach, { keepSection: true });

    check('Beide Abschnitte sind im Ziel entstanden',
      nach.sections.map(s => s.name), ['Regeln', 'Uebungen']);
    check('Die Seiten tragen die neuen Etiketten',
      nach.pages.map(p => p.secId || '-'),
      ['-', nach.sections[0].id, nach.sections[1].id]);
    check('Die Farbe bleibt dieselbe', nach.sections[0].color, farbeVorher);
    ok('Und die Kennung ist eine andere', nach.sections[0].id !== 'aR');
    check('Der Hintergrund kommt mit', nach.sections[0].defaultBg, 'grid');
  }

  {
    // Gibt es den Abschnitt im Ziel schon, wird er benutzt statt verdoppelt
    const ctx = loadData();
    const von = {
      id: 'A', name: 'A', defaultBg: 'ruled',
      pages: [{ id: 'a1' }],
      sections: [{ id: 'aR', name: 'Regeln', pgIds: ['a1'], defaultBg: 'ruled' }]
    };
    const nach = {
      id: 'B', name: 'B', defaultBg: 'ruled',
      pages: [{ id: 'b1' }],
      sections: [{ id: 'bR', name: 'Regeln', pgIds: [], defaultBg: 'ruled' }]
    };
    ctx.normalizeNotebook(von);
    ctx.normalizeNotebook(nach);
    ctx.S.notebooks.push(von, nach);

    ctx.transferPages(von, ['a1'], nach, { keepSection: true });

    check('Kein zweiter gleichen Namens', nach.sections.length, 1);
    check('Die Seite haengt am vorhandenen', nach.pages[1].secId, 'bR');
    check('Und die pgIds stimmen', nach.sections[0].pgIds, ['a1']);
  }

  {
    // Ohne die Option bleibt es beim alten Verhalten: kein Etikett
    const ctx = loadData();
    const von = {
      id: 'A', name: 'A', defaultBg: 'ruled',
      pages: [{ id: 'a1' }],
      sections: [{ id: 'aR', name: 'Regeln', pgIds: ['a1'], defaultBg: 'ruled' }]
    };
    const nach = { id: 'B', name: 'B', defaultBg: 'ruled', pages: [{ id: 'b1' }], sections: [] };
    ctx.normalizeNotebook(von);
    ctx.normalizeNotebook(nach);
    ctx.S.notebooks.push(von, nach);

    ctx.transferPages(von, ['a1'], nach, {});
    check('Kein Abschnitt entsteht', nach.sections, []);
    ok('Und die Seite traegt keinen', !nach.pages[1].secId);

  }

  {
    /* Beim KOPIEREN trug die Kopie bisher die Kennung aus dem
       Ausgangsheft weiter – ein Etikett, das es im Ziel gar nicht gibt
       und das dort auf keinen Abschnitt zeigt. */
    const ctx = loadData();
    const von = {
      id: 'A', name: 'A', defaultBg: 'ruled',
      pages: [{ id: 'a1' }],
      sections: [{ id: 'aR', name: 'Regeln', pgIds: ['a1'], defaultBg: 'ruled' }]
    };
    const nach = { id: 'C', name: 'C', defaultBg: 'ruled', pages: [{ id: 'c1' }], sections: [] };
    ctx.normalizeNotebook(von);
    ctx.normalizeNotebook(nach);
    ctx.S.notebooks.push(von, nach);

    ctx.transferPages(von, ['a1'], nach, { copy: true });
    ok('Auch eine Kopie schleppt kein fremdes Etikett mit', !nach.pages[1].secId);
    ok('Das Original behaelt seines', von.pages[0].secId === 'aR');
  }

  console.log('\nSeiten umsortieren');

  {
    const ctx = loadData();
    const nb = {
      id: 'nb', defaultBg: 'ruled', schemaVersion: 2, sections: [],
      pages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    };

    ctx.movePageBefore(nb, 'd', 'b');
    check('Nach vorn gezogen', nb.pages.map(p => p.id), ['a', 'd', 'b', 'c']);

    ctx.movePageBefore(nb, 'a', null);
    check('Ans Ende gezogen', nb.pages.map(p => p.id), ['d', 'b', 'c', 'a']);

    ctx.movePageBefore(nb, 'c', 'd');
    check('Nach ganz vorn', nb.pages.map(p => p.id), ['c', 'd', 'b', 'a']);

    ok('Auf den eigenen Platz aendert nichts', !ctx.movePageBefore(nb, 'd', 'b'));
    ok('Vor sich selbst auch nicht', !ctx.movePageBefore(nb, 'd', 'd'));
    ok('Eine unbekannte Seite bewegt sich nicht', !ctx.movePageBefore(nb, 'x', 'a'));
    check('Und die Reihenfolge steht noch', nb.pages.map(p => p.id), ['c', 'd', 'b', 'a']);
  }

  {
    // Die Etiketten bleiben, wo sie sind – die pgIds ziehen mit
    const ctx = loadData();
    const nb = {
      id: 'nb', defaultBg: 'ruled',
      pages: [{ id: 'r1' }, { id: 'u1' }, { id: 'r2' }],
      sections: [
        { id: 'sR', name: 'Regeln', pgIds: ['r1', 'r2'], defaultBg: 'ruled' },
        { id: 'sU', name: 'Uebungen', pgIds: ['u1'], defaultBg: 'ruled' }
      ]
    };
    ctx.normalizeNotebook(nb);

    ctx.movePageBefore(nb, 'r2', 'u1');
    check('Die Reihenfolge stimmt', nb.pages.map(p => p.id), ['r1', 'r2', 'u1']);
    check('Die Etiketten kleben weiter', nb.pages.map(p => p.secId), ['sR', 'sR', 'sU']);
    check('Und die abgeleiteten pgIds ziehen mit',
      nb.sections.map(s => s.pgIds.join(',')), ['r1,r2', 'u1']);
    check('Die Seitenzahl folgt der neuen Stelle', ctx.pageNumberOf(nb, 'u1'), 3);
  }

  /* ── Die Farbe eines Abschnitts ──────────────────────────────────────
     Gewaehlt schlaegt gerechnet. Ohne Wahl bekommen zwei Abschnitte von
     selbst verschiedene Farben – sonst muesste man bei jedem neuen erst
     eine aussuchen. */

  /* ── Das Papier eines Abschnitts ─────────────────────────────────────
     Leer heisst „wie das Heft" – und das ist der Normalfall. Wer eine
     Seite einem Abschnitt zuschlaegt, will sie aussehen wie den Rest
     davon; sie bekommt dessen Papier also sofort. */

  console.log('\nPapier eines Abschnitts');

  {
    const ctx = loadData();
    const nb = {
      id: 'nb', defaultBg: 'ruled', schemaVersion: 2,
      pages: [{ id: 'p1', bg: 'ruled' }, { id: 'p2', bg: 'blank' }],
      sections: [
        { id: 'sK', name: 'Kariert', pgIds: [], defaultBg: 'grid' },
        { id: 'sA', name: 'Automatisch', pgIds: [] }
      ]
    };

    check('Ein Abschnitt mit eigenem Papier', ctx.bgForSection(nb.sections[0], nb), 'grid');
    check('Einer ohne nimmt das des Hefts', ctx.bgForSection(nb.sections[1], nb), 'ruled');
    check('Und ohne Abschnitt auch', ctx.bgForSection(null, nb), 'ruled');

    ctx.setSectionOfPage(nb, 'p2', 'sK');
    check('Das Papier zieht beim Etikettieren mit', nb.pages[1].bg, 'grid');

    ctx.setSectionOfPage(nb, 'p2', 'sA');
    check('Beim Wechsel auf „automatisch" das des Hefts', nb.pages[1].bg, 'ruled');

    // Etikett abnehmen laesst das Papier stehen – es war eine bewusste Wahl
    nb.pages[1].bg = 'dotted';
    ctx.setSectionOfPage(nb, 'p2', '');
    check('Abnehmen ruehrt das Papier nicht an', nb.pages[1].bg, 'dotted');
  }

  {
    // Eine Seite mit eigenem Bild behaelt es – dort gaebe es nichts zu malen
    const ctx = loadData();
    const nb = {
      id: 'nb', defaultBg: 'ruled', schemaVersion: 2,
      pages: [{ id: 'p1', bg: 'ruled', bgImg: 'data:image/png;base64,AAAA' }],
      sections: [{ id: 'sK', name: 'K', pgIds: [], defaultBg: 'grid' }]
    };
    ctx.setSectionOfPage(nb, 'p1', 'sK');
    check('Eine Seite mit Bildhintergrund bleibt unberuehrt', nb.pages[0].bg, 'ruled');
  }

  {
    // getSections fuellt defaultBg nicht mehr vorsorglich
    const ctx = loadData();
    const nb = { id: 'nb', defaultBg: 'grid', pages: [], sections: [{ id: 's1', name: 'A', pgIds: [] }] };
    ctx.getSections(nb);
    ok('Kein stilles Kopieren des Heft-Papiers', !nb.sections[0].defaultBg);
  }

  console.log('\nAbschnittsfarbe');

  {
    const ctx = loadData();
    const eins = { id: 'sA', name: 'A' };
    const zwei = { id: 'sB', name: 'B' };

    ok('Ohne Wahl kommt eine Farbe heraus', /^#/.test(ctx.colorForSection(eins)));
    ok('Zweimal dieselbe Kennung, dieselbe Farbe',
      ctx.colorForSection(eins) === ctx.colorForSection({ id: 'sA' }));
    ok('Verschiedene Kennungen, verschiedene Farben',
      ctx.colorForSection(eins) !== ctx.colorForSection(zwei));

    eins.color = '#123456';
    check('Die gewaehlte gewinnt', ctx.colorForSection(eins), '#123456');

    delete eins.color;
    ok('Und ohne sie wieder die gerechnete',
      ctx.colorForSection(eins) === ctx.colorForSection({ id: 'sA' }));

    // Aeltere Aufrufer gaben bloss die Kennung mit
    ok('Eine blosse Kennung geht auch noch',
      ctx.colorForSection('sA') === ctx.colorForSection({ id: 'sA' }));
  }

  console.log('\nEtikett wechseln');

  {
    const ctx = loadData();
    const nb = {
      id: 'nb', defaultBg: 'ruled',
      pages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      sections: [{ id: 's1', name: 'Eins', pgIds: ['a', 'b', 'c'], defaultBg: 'ruled' },
                 { id: 's2', name: 'Zwei', pgIds: [], defaultBg: 'ruled' }]
    };
    ctx.normalizeNotebook(nb);

    ctx.setSectionOfPage(nb, 'b', 's2');

    check('Die Reihenfolge bleibt unangetastet', nb.pages.map(p => p.id), ['a', 'b', 'c']);
    check('Die Seitenzahl auch', ctx.pageNumberOf(nb, 'c'), 3);
    check('Das Etikett sitzt', ctx.findSecForPage('b', nb).id, 's2');
    check('Und die abgeleiteten pgIds stimmen',
      nb.sections.map(s => s.pgIds.join(',')), ['a,c', 'b']);

    ctx.setSectionOfPage(nb, 'b', '');
    check('Etikett abnehmen geht auch', ctx.findSecForPage('b', nb), null);
    check('Die Seite bleibt trotzdem im Heft', nb.pages.map(p => p.id), ['a', 'b', 'c']);
  }

  /* Der Index zählt jetzt im HEFT, nicht im Abschnitt. Solange Abschnitte
     Kapitel waren, hieß „an Stelle 1" die zweite Seite dieses Abschnitts;
     unter Etiketten hat eine Seite genau einen Platz, und der gilt im
     ganzen Heft. */

  console.log('\nEinsetzen an einer bestimmten Stelle');

  {
    const ctx = loadData();
    const nb = makeNotebook(ctx, 'A', 3);
    const sec = nb.sections[0];
    const neu = ctx.makePage('ruled');

    ctx.insertPageInto(nb, sec, neu, 1);

    check('Die neue Seite sitzt an zweiter Stelle im Heft',
      nb.pages.map(p => p.id), ['A-p1', neu.id, 'A-p2', 'A-p3']);
    check('Sie hat die Seitenzahl 2', ctx.pageNumberOf(nb, neu.id), 2);
    check('Und trägt das Etikett des Abschnitts', neu.secId, sec.id);
    check('Die abgeleiteten pgIds folgen der Heft-Reihenfolge',
      sec.pgIds, ['A-p1', neu.id, 'A-p2', 'A-p3']);

    // Ohne Abschnitt eingesetzt: die Seite ist da, bleibt aber unetikettiert
    const frei = ctx.makePage('ruled');
    ctx.insertPageInto(nb, null, frei);
    check('Auch ohne Etikett landet sie im Heft', ctx.pageNumberOf(nb, frei.id), 5);
    ok('Und bekommt keins aufgedrängt', !frei.secId);
  }

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})();
