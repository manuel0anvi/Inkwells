#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   FREIHÄNDIG GEMALTE FORMEN GLATTZIEHEN

   Prüft canvas/shapeSnap.js. Reine Rechnerei ohne Fenster – gemalt wird
   hier mit einem Zufallszittern, das eine Hand nachstellt.

   >>> Wonach hier vor allem gesucht wird <<<
   Nicht danach, ob ein Kreis erkannt wird. Sondern danach, ob etwas
   erkannt wird, das GAR KEINE Form ist. Ein Editor, der aus einem
   Buchstaben ungefragt ein Rechteck macht, ist unbrauchbar – und der
   Fehler fällt erst auf, wenn man mitten in einer Skizze steckt.

   Deshalb stehen die Gegenproben zuerst.

   Aufruf:  node scripts/test-shape-snap.js
   ══════════════════════════════════════════════════════════════════════ */

const path = require('path');
const { erkenneForm } = require(path.join(__dirname, '..', 'src', 'canvas', 'shapeSnap.js'));

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

/* ── Eine Hand, die nicht ganz ruhig ist ────────────────────────────
   Fester Startwert, damit ein Fehlschlag reproduzierbar ist. Ein Test,
   der mal durchgeht und mal nicht, ist schlimmer als keiner. */
let saat = 12345;
function zittern(staerke) {
  saat = (saat * 1103515245 + 12345) & 0x7fffffff;
  return ((saat / 0x7fffffff) - 0.5) * 2 * staerke;
}

function strich(punkte) {
  return { path: punkte.map(p => ({ x: p.x, y: p.y, p: 0.5 })), color: '#000', width: 2 };
}

function kreis(cx, cy, r, unruhe = 2, anteil = 1) {
  const pts = [];
  const n = 60;
  for (let i = 0; i <= n * anteil; i++) {
    const w = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(w) * r + zittern(unruhe), y: cy + Math.sin(w) * r + zittern(unruhe) });
  }
  return strich(pts);
}

function vieleck(ecken, unruhe = 2) {
  const pts = [];
  for (let i = 0; i < ecken.length; i++) {
    const a = ecken[i], b = ecken[(i + 1) % ecken.length];
    const schritte = 14;
    for (let s = 0; s < schritte; s++) {
      const t = s / schritte;
      pts.push({
        x: a.x + (b.x - a.x) * t + zittern(unruhe),
        y: a.y + (b.y - a.y) * t + zittern(unruhe)
      });
    }
  }
  pts.push({ x: ecken[0].x, y: ecken[0].y });
  return strich(pts);
}

function art(stroke) {
  const f = erkenneForm(stroke);
  return f ? f.art : null;
}

console.log('Was KEINE Form ist, bleibt in Ruhe');

{
  // Eine gerade Linie – dafuer gibt es die Gerade, nicht die Formerkennung
  check('Gerade Linie', art(strich([
    { x: 20, y: 20 }, { x: 60, y: 21 }, { x: 100, y: 20 }, { x: 140, y: 22 },
    { x: 180, y: 20 }, { x: 220, y: 21 }, { x: 260, y: 20 }, { x: 300, y: 21 }
  ])), null);

  // Ein offener Bogen: Anfang und Ende weit auseinander
  check('Offener Bogen', art(kreis(200, 200, 80, 2, 0.55)), null);

  // Handschrift: ein „e", also klein und krakelig
  const e = [];
  for (let i = 0; i < 20; i++) {
    e.push({ x: 10 + Math.cos(i) * 6 + i * 0.4, y: 10 + Math.sin(i * 1.7) * 5 });
  }
  check('Ein kleiner Buchstabe', art(strich(e)), null);

  // Zu wenige Punkte
  check('Nur drei Punkte', art(strich([
    { x: 0, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 0 }
  ])), null);

  // Gross, geschlossen, aber ohne jede Form: ein Gekritzel
  const kritzel = [];
  for (let i = 0; i <= 70; i++) {
    const w = (i / 70) * Math.PI * 2;
    const r = 90 + Math.sin(w * 5) * 55;   // stark gewellter Rand
    kritzel.push({ x: 300 + Math.cos(w) * r, y: 300 + Math.sin(w) * r });
  }
  check('Gekritzel mit Wellenrand', art(strich(kritzel)), null);
}

console.log('\nWas eine Form IST, rastet ein');

{
  check('Kreis', art(kreis(200, 200, 90)), 'ellipse');
  check('Kreis mit unruhiger Hand', art(kreis(200, 200, 90, 8)), 'ellipse');
  check('Breite Ellipse', art((() => {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const w = (i / 60) * Math.PI * 2;
      pts.push({ x: 300 + Math.cos(w) * 150 + zittern(3), y: 200 + Math.sin(w) * 60 + zittern(3) });
    }
    return strich(pts);
  })()), 'ellipse');

  check('Rechteck', art(vieleck([
    { x: 50, y: 50 }, { x: 350, y: 52 }, { x: 348, y: 250 }, { x: 52, y: 248 }
  ])), 'viereck');

  check('Dreieck', art(vieleck([
    { x: 200, y: 40 }, { x: 350, y: 300 }, { x: 50, y: 300 }
  ])), 'dreieck');
}

console.log('\nDie eingerastete Form sitzt richtig');

{
  const form = erkenneForm(vieleck([
    { x: 50, y: 50 }, { x: 350, y: 52 }, { x: 348, y: 250 }, { x: 52, y: 248 }
  ]));

  const xs = form.path.map(p => p.x), ys = form.path.map(p => p.y);
  const x1 = Math.min(...xs), x2 = Math.max(...xs);
  const y1 = Math.min(...ys), y2 = Math.max(...ys);

  // Ein fast gerade gemaltes Viereck wird auf den umschliessenden Kasten
  // gezogen – das ist es, was jemand meint, der ein Rechteck malt.
  check('Das Rechteck steht gerade im Blatt',
    Math.abs((x2 - x1) - 300) < 12 && Math.abs((y2 - y1) - 200) < 12, true);

  // Und es ist wirklich geschlossen
  const a = form.path[0], e = form.path[form.path.length - 1];
  check('Anfang und Ende liegen aufeinander', Math.hypot(e.x - a.x, e.y - a.y) < 1, true);

  // Genug Punkte, damit Radierer und Auswahl die Kanten treffen
  check('Genug Punkte auf den Kanten', form.path.length > 40, true);
}

{
  const form = erkenneForm(kreis(200, 200, 90));
  const mitte = form.path.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
  mitte.x /= form.path.length; mitte.y /= form.path.length;
  check('Der Kreis sitzt an seiner Stelle',
    Math.abs(mitte.x - 200) < 8 && Math.abs(mitte.y - 200) < 8, true);

  const radien = form.path.map(p => Math.hypot(p.x - mitte.x, p.y - mitte.y));
  const min = Math.min(...radien), max = Math.max(...radien);
  check('Und er ist wirklich rund', (max - min) < max * 0.08, true);

  check('Der Druck kommt aus dem Original', form.path[0].p, 0.5);
}

console.log('');
if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
