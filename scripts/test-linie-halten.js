#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   WANN EIN STRICH ZUR GERADEN EINRASTEN DARF

   Prüft langGenugFuerLinie() aus canvas/input.js – die Grenze, ab der die
   Halte-Geste überhaupt greift.

   >>> Woher der Test kommt <<<
   Gemeldet als „manchmal verschwinden Sachen, die ich zeichne" und
   „während dem Zeichnen zeichnet es manchmal nicht alles".

   Der Grund war, dass die Geste keine Grenze hatte. Wer 320 ms lang
   still stand, bekam eine Gerade – und beim sorgfältigen Schreiben steht
   der Stift dauernd still: der Punkt auf dem i, der Querstrich am t, ein
   Komma. Der ganze bisherige Strich fiel dann auf eine Linie zwischen
   Anfang und jetziger Stelle zusammen, und ab da wurde nichts mehr
   aufgezeichnet.

   Die Prüfungen unten sind deshalb vor allem Gegenproben: was zu klein
   ist, DARF nicht einrasten.

   Aufruf:  node scripts/test-linie-halten.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const quelle = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'canvas', 'input.js'), 'utf8'
);

/** Schneidet eine Funktion samt Körper aus dem Quelltext. */
function extract(name) {
  const start = quelle.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Funktion ${name} nicht gefunden`);
  let depth = 0, seen = false;
  for (let i = start; i < quelle.length; i++) {
    const ch = quelle[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return quelle.slice(start, i + 1);
    }
  }
  throw new Error(`Ende von ${name} nicht gefunden`);
}

/* Die beiden Grenzwerte stehen als const im Modul und werden mit
   herausgeschnitten – sonst prüfte der Test andere Zahlen als die App. */
function extractConst(name) {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(quelle);
  if (!m) throw new Error(`Konstante ${name} nicht gefunden`);
  return `const ${name} = ${m[1]};`;
}

const sandbox = { Math, console };
vm.createContext(sandbox);
vm.runInContext([
  extractConst('LINIE_MIN_WEG'),
  extractConst('LINIE_MIN_SPANNE'),
  extract('istGeschlossen'),
  extract('langGenugFuerLinie')
].join('\n'), sandbox);

const { langGenugFuerLinie, istGeschlossen } = sandbox;

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failed++;
    console.error(`  ✗ ${label}`);
    console.error(`      erwartet: ${expected}`);
    console.error(`      bekommen: ${actual}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

/** Ein Strich aus Punkten – so, wie ihn buildStroke aufbaut. */
function strich(punkte) {
  return { path: punkte.map(p => ({ x: p[0], y: p[1], p: 0.5 })) };
}

/** Eine gerade Strecke mit n Zwischenpunkten. */
function strecke(x1, y1, x2, y2, n = 12) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return strich(pts);
}

console.log('Was beim Schreiben entsteht, rastet NICHT ein');

{
  // Der Punkt auf dem i: der Stift setzt auf und steht
  check('Ein Punkt', langGenugFuerLinie(strich([[100, 100], [100.5, 100.3]])), false);

  // Der Querstrich am t – kurz und waagerecht
  check('Querstrich am t', langGenugFuerLinie(strecke(100, 100, 112, 100)), false);

  // Ein Komma: kurz und gebogen
  check('Ein Komma', langGenugFuerLinie(strich([
    [100, 100], [101, 103], [101.5, 106], [101, 109], [99.5, 112]
  ])), false);

  // Eine kleine Schleife, wie im e oder o
  const schleife = [];
  for (let i = 0; i <= 20; i++) {
    const w = (i / 20) * Math.PI * 2;
    schleife.push([100 + Math.cos(w) * 6, 100 + Math.sin(w) * 6]);
  }
  check('Eine kleine Schleife', langGenugFuerLinie(strich(schleife)), false);

  // Ein einzelner Punkt ohne jede Bewegung
  check('Gar keine Bewegung', langGenugFuerLinie(strich([[50, 50]])), false);
  check('Kein Pfad', langGenugFuerLinie({}), false);
}

console.log('\nWer eine Gerade WILL, bekommt sie');

{
  check('Eine ordentliche Strecke', langGenugFuerLinie(strecke(50, 50, 300, 50)), true);
  check('Auch schraeg', langGenugFuerLinie(strecke(50, 50, 200, 180)), true);
  check('Knapp ueber der Grenze', langGenugFuerLinie(strecke(0, 0, 60, 0)), true);
}

console.log('\nDie Grenze sitzt zwischen beidem');

{
  // Knapp darunter: gelaufene Strecke unter LINIE_MIN_WEG
  check('Zu kurz gezogen', langGenugFuerLinie(strecke(0, 0, 40, 0)), false);

  /* Lang gelaufen, aber Anfang und Ende dicht beieinander: das ist
     KEINE Gerade, sondern eine Form. Sie muss durchkommen, sonst rastet
     ein gemalter Kreis nie ein (canvas/shapeSnap.js entscheidet danach,
     was daraus wird). */
  const kreis = [];
  for (let i = 0; i <= 40; i++) {
    const w = (i / 40) * Math.PI * 2;
    kreis.push([200 + Math.cos(w) * 60, 200 + Math.sin(w) * 60]);
  }
  check('Ein grosser Kreis kommt durch', langGenugFuerLinie(strich(kreis)), true);

  /* Ein langer, aber zusammengeknaeuelter Strich, dessen Enden weit
     genug auseinanderliegen – das ist gewollt eine Gerade. */
  check('Lang gelaufen und weit auseinander',
    langGenugFuerLinie(strich([
      [0, 0], [30, 5], [60, -5], [90, 5], [120, 0]
    ])), true);
}

console.log('');
/* ═══════════════════════════════════════════════════════════════════
   EINE RUNDE IST KEINE STRECKE

   Daran hing der gemeldete Fehler „ich halte für eine Form, und die
   Linie ist weg“: ein geschlossener Strich, dessen Form NICHT erkannt
   wird, fiel auf die Gerade zwischen Anfang und Ende zusammen – und die
   ist bei einer Runde null lang. Der Zeitgeber in canvas/input.js fragt
   deshalb istGeschlossen(), bevor er zusammenfallen lässt.
   ═══════════════════════════════════════════════════════════════════ */

console.log('\nWas eine Runde ist, wird als Runde erkannt');

{
  // Ein grosser Kreis – Anfang und Ende liegen aufeinander
  const kreis = [];
  for (let i = 0; i <= 40; i++) {
    const w = (i / 40) * Math.PI * 2;
    kreis.push([200 + Math.cos(w) * 60, 200 + Math.sin(w) * 60]);
  }
  check('Ein Kreis ist geschlossen', istGeschlossen(strich(kreis)), true);
  check('Und er kommt an der Uhr vorbei', langGenugFuerLinie(strich(kreis)), true);

  /* Ein Fuenfeck: geschlossen, aber erkenneForm() macht daraus nichts
     (es kennt nur Ellipse, Viereck, Dreieck). Genau dieser Strich fiel
     vorher auf einen Punkt von null Laenge zusammen. */
  const fuenfeck = [];
  for (let e = 0; e < 5; e++) {
    const w1 = (e / 5) * Math.PI * 2, w2 = ((e + 1) / 5) * Math.PI * 2;
    const x1 = 300 + Math.cos(w1) * 70, y1 = 300 + Math.sin(w1) * 70;
    const x2 = 300 + Math.cos(w2) * 70, y2 = 300 + Math.sin(w2) * 70;
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      fuenfeck.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
  }
  fuenfeck.push(fuenfeck[0]);
  check('Ein Fuenfeck ist geschlossen', istGeschlossen(strich(fuenfeck)), true);

  // Und eine ordentliche Gerade ist es NICHT
  check('Eine Strecke ist offen', istGeschlossen(strecke(50, 50, 300, 50)), false);
  check('Auch eine schraege', istGeschlossen(strecke(50, 50, 200, 180)), false);

  /* Ein leicht gebogener Strich bleibt offen – sonst bekaeme niemand
     mehr eine Gerade, der nicht mit dem Lineal zieht. */
  check('Ein leichter Bogen bleibt offen', istGeschlossen(strich([
    [50, 100], [110, 92], [170, 88], [230, 92], [290, 100]
  ])), false);

  check('Ohne Pfad gar nichts', istGeschlossen({}), false);
  check('Ein einzelner Punkt ist keine Runde', istGeschlossen(strich([[50, 50]])), false);
}

if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
