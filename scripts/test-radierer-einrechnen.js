#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ALTE RADIERSTRICHE WERDEN EINGERECHNET

   Prüft radierstricheEinrechnen aus core/data.js. Ein Radierstrich aus
   der Zeit vor dem 28. 9. lag als eigener Strich in der Seite und stanzte
   ein Loch in alles, was später darübergeschoben wurde. Beim Laden wird
   er jetzt angewandt und fällt weg.

   >>> Worauf es ankommt <<<
     · Nur was VOR dem Radierer gezeichnet wurde, wird zerschnitten –
       was danach kam, lag ja obendrauf und war zu sehen.
     · Unberührte Striche bleiben derselbe Gegenstand, nicht nur gleich.
     · Die Kennungen der Reste sind jedes Mal dieselben. Dasselbe Heft
       wird auf zwei Geräten unabhängig eingerechnet; mit zufälligen
       Kennungen sähe der Abgleich lauter neue Striche und verdoppelte sie.
     · Eine echte Linie verliert nur das Stück unter dem Radierer, anders
       als beim Radieren von Hand – so sah das alte Loch aus.

   Aufruf:  node scripts/test-radierer-einrechnen.js
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

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  JSON, Date, Math, Number, String, Array, Object, Set,
  uid: () => 'neu',
  S: { notebooks: [], activeNbId: null, activePgId: null, strokeHistory: {} }
};
ctx.self = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src/core/data.js'), 'utf8'), ctx);

/** Eine waagrechte Linie aus vielen Punkten, wie eine Hand sie zieht. */
function waagrecht(id, y, x1, x2, extra = {}) {
  const path = [];
  for (let x = x1; x <= x2; x += 2) path.push({ x, y });
  return { id, path, color: '#000', width: 2, isHL: false, ...extra };
}

/** Ein senkrechter Radierstrich bei x, so breit wie der mittlere Radierer. */
function radierer(x, y1, y2) {
  return { isEraser: true, color: 'rgba(0,0,0,1)', width: 36, path: [{ x, y: y1 }, { x, y: (y1 + y2) / 2 }, { x, y: y2 }] };
}

console.log('\nAlte Radierstriche werden eingerechnet');

// ── Ohne Radierer: nichts zu tun ─────────────────────────────────────
check('Eine Seite ohne Radierstrich bleibt unberührt (null)',
  ctx.radierstricheEinrechnen([waagrecht('a', 100, 0, 200)]), null);

// ── Mitten durch: zwei Reste, der Radierer ist weg ───────────────────
{
  const davor = waagrecht('a', 100, 0, 200);
  const weitWeg = waagrecht('w', 600, 0, 200);
  const danach = waagrecht('d', 100, 0, 200);
  const liste = [davor, weitWeg, radierer(100, 50, 150), danach];
  const neu = ctx.radierstricheEinrechnen(liste);

  ok('Kein Radierstrich mehr in der Seite', neu.every(s => !s.isEraser));
  const reste = neu.filter(s => s.id.startsWith('a~'));
  check('Der Strich davor zerfällt in zwei Reste', reste.length, 2);
  // 18 Radius + 1 halbe Strichbreite: bis 81 links, ab 119 rechts
  const linksEnde = Math.max(...reste[0].path.map(p => p.x));
  const rechtsAnfang = Math.min(...reste[1].path.map(p => p.x));
  ok('Links endet er am Kreis (' + linksEnde.toFixed(1) + ')', Math.abs(linksEnde - 81) < 0.5);
  ok('Rechts fängt er am Kreis an (' + rechtsAnfang.toFixed(1) + ')', Math.abs(rechtsAnfang - 119) < 0.5);
  ok('Farbe und Breite bleiben', reste.every(s => s.color === '#000' && s.width === 2));
  ok('Ein Strich weit weg bleibt derselbe Gegenstand', neu.includes(weitWeg));
  ok('Der Strich DANACH bleibt ganz – er lag obendrauf', neu.includes(danach) && danach.path.length === 101);
  check('Die Reihenfolge bleibt: Reste, weit weg, danach',
    neu.map(s => s.id), ['a~2.0', 'a~2.1', 'w', 'd']);

  const nochmal = ctx.radierstricheEinrechnen(liste);
  check('Ein zweites Mal ergibt dieselben Kennungen', nochmal.map(s => s.id), neu.map(s => s.id));
  check('Und das Ergebnis lässt sich nicht weiter einrechnen', ctx.radierstricheEinrechnen(neu), null);
}

// ── Ganz bedeckt: weg ────────────────────────────────────────────────
{
  const kurz = waagrecht('k', 100, 95, 105);
  const neu = ctx.radierstricheEinrechnen([kurz, radierer(100, 50, 150)]);
  check('Was ganz unter dem Radierer lag, ist weg', neu.length, 0);
}

// ── Eine echte Linie verliert nur das Stück darunter ─────────────────
{
  const linie = { id: 'l', path: [{ x: 0, y: 100 }, { x: 200, y: 100 }], color: '#000', width: 2 };
  const neu = ctx.radierstricheEinrechnen([linie, radierer(100, 50, 150)]);
  check('Die Linie zerfällt in zwei, statt ganz zu gehen', neu.length, 2);
}

// ── Zwei Radierer nacheinander, und Druck an der Schnittkante ────────
{
  const mitDruck = waagrecht('p', 100, 0, 300);
  mitDruck.path.forEach((p, i) => { p.p = i / 150; });
  const neu = ctx.radierstricheEinrechnen([mitDruck, radierer(100, 50, 150), radierer(200, 50, 150)]);
  check('Zwei Radierer machen drei Reste', neu.length, 3);
  check('Die Kennung trägt jeden Schnitt, den das Stück abbekam', neu.map(s => s.id), ['p~1.0', 'p~1.1~2.0', 'p~1.1~2.1']);
  const kante = neu[0].path[neu[0].path.length - 1];
  ok('Die Schnittkante hat den Druck, der dort war (' + kante.p.toFixed(3) + ')',
    Math.abs(kante.p - kante.x / 300) < 0.01);
}

// ── Beim Laden eines Hefts ───────────────────────────────────────────
{
  const nb = {
    id: 'nb', name: 'Test', schemaVersion: ctx.SCHEMA_VERSION,
    pages: [{ id: 'p1', inkStrokes: [waagrecht('a', 100, 0, 200), radierer(100, 50, 150)] }]
  };
  ctx.normalizeNotebook(nb);
  check('normalizeNotebook rechnet sie ein', nb.pages[0].inkStrokes.map(s => s.id), ['a~1.0', 'a~1.1']);
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(failed ? 1 : 0);
