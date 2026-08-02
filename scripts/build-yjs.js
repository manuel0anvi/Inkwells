#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Packt Yjs zu EINER Datei zusammen: src/lib/yjs.bundle.js

   Warum überhaupt ein Schritt dazwischen?
   Yjs wird als ES-Modul geliefert und holt sich intern Dutzende Teile
   aus dem Paket „lib0" über Kurznamen (import … from 'lib0/observable').
   Solche Kurznamen kann ein Browser nicht auflösen – dafür braucht es
   einen Bündler. Die Oberfläche von Inkwell besteht bewusst aus
   klassischen <script>-Dateien ohne Bauschritt; deshalb wird Yjs EINMAL
   hier gebündelt und das Ergebnis mitgeliefert.

   Dadurch bleibt Yjs eine Entwicklungs-Abhängigkeit: in die fertige .exe
   wandert nur die gebündelte Datei, nicht node_modules.

   Aufruf:  npm run build-yjs
   Danach:  src/lib/yjs.bundle.js liegt als Global „Y" bereit.
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outFile = path.join(root, 'src', 'lib', 'yjs.bundle.js');

let esbuild;
try {
  esbuild = require('esbuild');
} catch (err) {
  console.error('[build-yjs] esbuild fehlt. Einmalig: npm install --save-dev esbuild');
  process.exit(1);
}

const banner = `/* ══════════════════════════════════════════════════════════════════════
   ⚠  ERZEUGTE DATEI – NICHT HIER BEARBEITEN

   Yjs, gebündelt zu einer Datei. Erzeugt von scripts/build-yjs.js.
   Neu erzeugen nach einem Yjs-Update:  npm run build-yjs

   Meldet sich als globales Objekt "Y" (Y.Doc, Y.Text, Y.applyUpdate, …).
   ══════════════════════════════════════════════════════════════════════ */`;

esbuild.buildSync({
  stdin: {
    contents: "export * from 'yjs';",
    resolveDir: root,
    loader: 'js'
  },
  bundle: true,
  format: 'iife',
  globalName: 'Y',
  target: ['chrome110'],
  outfile: outFile,
  banner: { js: banner },
  legalComments: 'none',
  minify: false
});

const bytes = fs.statSync(outFile).size;
console.log(`[build-yjs] src/lib/yjs.bundle.js erzeugt (${Math.round(bytes / 1024)} KB).`);
