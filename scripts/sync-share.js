#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Hält die gemeinsam genutzten Module von App und Website gleich.

   Manches wird an zwei Stellen gebraucht:
     · src/core/share.js  →  website/js/share.js   Freigabe über Firestore
     · src/core/docx.js   →  website/js/docx.js    Word-Export

   Die App wird ohne den Ordner website/ ausgeliefert (electron-builder
   nimmt nur src/**), deshalb geht es nicht mit einer einzigen Datei.
   Kopierte Logik läuft aber auseinander – genau daher kam der Fehler mit
   den PDF-Seiten, die im Web an der falschen Stelle standen. Dieses
   Skript hält beide gleich und meldet sich, wenn sie es nicht mehr sind.

   Aufruf:
     npm run sync-share                  kopiert App -> Website
     npm run check-share                 prüft nur, Rückgabewert 1 bei Abweichung

   Zum Prüfen NICHT `npm run sync-share --check` nehmen: npm behält das
   Flag für sich, das Skript schreibt dann doch. Siehe checkOnly unten.

   >>> Warum die App die Quelle ist und nicht die Website <<<
   src/core/ liegt in Git, website/ steht in .gitignore und bleibt auf
   dem jeweiligen Rechner. Andersherum wäre die Quelle also die Fassung,
   die den anderen Rechner NIE erreicht: wer `git pull` macht, bekommt
   die neue App-Datei, seine örtliche Website-Datei bleibt alt – und das
   nächste `npm run sync-share` schreibt den alten Stand über die frisch
   geholte Arbeit. Zweimal ist genau das passiert, einmal mit 123 und
   einmal mit 66 Zeilen Live-Zusammenarbeit.

   In dieser Richtung kann das nicht mehr vorkommen: geschrieben wird nur
   in die örtliche, ignorierte Kopie. Dort ist nichts zu verlieren, sie
   entsteht jederzeit neu.
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const PAIRS = [
  { source: ['src', 'core', 'share.js'], target: ['website', 'js', 'share.js'] },
  { source: ['src', 'core', 'docx.js'], target: ['website', 'js', 'docx.js'] }
];

function header(sourceRel) {
  return `/* ══════════════════════════════════════════════════════════════════════
   ⚠  ERZEUGTE DATEI – NICHT HIER BEARBEITEN

   Wortgleiche Kopie von ${sourceRel}. Die App wird ohne den
   Ordner website/ ausgeliefert (siehe electron-builder.config.js),
   deshalb braucht die Website ein eigenes Exemplar.

   Änderungen gehören nach ${sourceRel}. Danach:
       npm run sync-share
   Vor dem Veröffentlichen der Website läuft das von selbst.
   ══════════════════════════════════════════════════════════════════════ */

`;
}

/* >>> Warum hier auch die npm-Umgebung gelesen wird <<<
   `npm run sync-share --check` sieht aus wie eine Prüfung, ist aber
   keine: npm behält das Flag für sich und reicht es NICHT ans Skript
   weiter. Das Skript lief dadurch im Schreibmodus, und beide Male hat
   der Aufrufende eine Prüfung erwartet.

   npm legt das geschluckte Flag aber in der Umgebung ab. Von dort ist
   die Absicht eindeutig abzulesen, und der Fehlgriff kann nicht mehr
   passieren. Sauber ist weiterhin `npm run check-share`. */
const checkOnly = process.argv.includes('--check')
               || process.env.npm_config_check === 'true';
let stale = 0;

/* Ohne website/ ist nichts zu tun. Der Ordner steht in .gitignore; ein
   frisch geklontes Repo hat ihn nicht, und für die App allein wird er
   auch nicht gebraucht. Das ist kein Fehler, sondern der Normalfall auf
   einem Rechner, an dem nur an der App gearbeitet wird. */
if (!fs.existsSync(path.join(root, 'website'))) {
  console.log('[sync-share] Kein Ordner website/ – nichts zu tun.');
  process.exit(0);
}

for (const pair of PAIRS) {
  const source = path.join(root, ...pair.source);
  const target = path.join(root, ...pair.target);
  const sourceRel = pair.source.join('/');
  const targetRel = pair.target.join('/');

  if (!fs.existsSync(source)) {
    console.error(`[sync-share] Quelle fehlt: ${sourceRel}`);
    process.exit(1);
  }

  const expected = header(sourceRel) + fs.readFileSync(source, 'utf8');
  const actual = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

  if (expected === actual) {
    console.log(`[sync-share] ${targetRel} ist aktuell.`);
    continue;
  }

  if (checkOnly) {
    console.error(`[sync-share] ${targetRel} weicht von ${sourceRel} ab.`);
    stale++;
    continue;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, expected);
  console.log(`[sync-share] ${targetRel} aktualisiert.`);
}

if (stale > 0) {
  console.error('[sync-share] Bitte "npm run sync-share" ausführen.');
  process.exit(1);
}
