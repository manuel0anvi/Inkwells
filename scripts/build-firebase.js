#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   FIREBASE LIEGT BEI UNS

   Bisher kam das SDK zur Laufzeit von gstatic.com. Das hiess zweierlei:

     · Fremder Code: die Oberfläche trägt Cloud-Token und Dateizugriff, und was
       von dort kommt, läuft mit denselben Rechten.
     · Ohne Internet gestartet, konnte das Modul nicht laden, und der Browser
       merkt sich das bis zum nächsten Laden der Seite. Teilen blieb tot, auch
       wenn die Leitung längst wieder da war.

   Zwei Eingänge, damit die Realtime Database weiter erst geladen wird, wenn
   jemand einen Live-Raum betritt: die Leseansicht und das Dashboard sollen sie
   nicht mit herunterladen. Das Aufteilen hält dabei die gemeinsame Firebase-App
   in einem eigenen Stück – zwei Kopien kennten einander nicht, und getDatabase
   lehnte die App ab.

   Aufruf:  npm run build-firebase
   Danach:  src/lib/firebase/, und npm run sync-share kopiert es nach website/lib/
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const ziel = path.join(root, 'src', 'lib', 'firebase');

(async () => {
  const hier = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwells-firebase-'));
  const kern = path.join(hier, 'kern.js');
  const echtzeit = path.join(hier, 'echtzeit.js');
  fs.writeFileSync(kern, [
    "export * from 'firebase/app';",
    "export * from 'firebase/firestore';",
    "export * from 'firebase/auth';"
  ].join('\n'));
  fs.writeFileSync(echtzeit, "export * from 'firebase/database';\n");

  fs.rmSync(ziel, { recursive: true, force: true });
  await esbuild.build({
    entryPoints: [kern, echtzeit],
    outdir: ziel,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome110',
    minify: true,
    chunkNames: 'gemeinsam-[hash]',
    absWorkingDir: root,
    nodePaths: [path.join(root, 'node_modules')],
    legalComments: 'none',
    logLevel: 'warning'
  });
  fs.rmSync(hier, { recursive: true, force: true });

  const version = require(path.join(root, 'node_modules', 'firebase', 'package.json')).version;
  for (const name of fs.readdirSync(ziel)) {
    const groesse = fs.statSync(path.join(ziel, name)).size;
    console.log(`[build-firebase] ${name}: ${Math.round(groesse / 1024)} KB`);
  }
  console.log(`[build-firebase] Firebase ${version}. Jetzt: npm run sync-share`);
})().catch(err => { console.error(err); process.exit(1); });
