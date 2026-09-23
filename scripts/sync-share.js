#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Hält die gemeinsam genutzten Module von App und Website gleich.

   Manches wird an zwei Stellen gebraucht:
     · src/core/share.js     →  website/js/share.js      Freigabe über Firestore
     · src/core/docx.js      →  website/js/docx.js       Word-Export
     · src/core/sanitize.js  →  website/js/sanitize.js   Seitentext bereinigen
     · src/core/formula.js   →  website/js/formula.js    Formeln (KaTeX)
     · src/canvas/shapes.js  →  website/js/shapes.js     Formen
     · src/core/code.js      →  website/js/code.js       Code-Kästen
     · src/core/pdfSeiten.js →  website/js/pdfSeiten.js  Seiten aus einem PDF
     · src/core/inkSvg.js    →  website/js/inkSvg.js     Handschrift als Vektor
     · src/css/pages.css     →  website/css/pages.css    wie eine Seite aussieht

   Dazu unverändert die Bibliotheken, die davon gebraucht werden (LIBS).

   Die App wird ohne den Ordner website/ ausgeliefert (electron-builder
   nimmt nur src/**), deshalb geht es nicht mit einer einzigen Datei.
   Kopierte Logik läuft aber auseinander – genau daher kam der Fehler mit
   den PDF-Seiten, die im Web an der falschen Stelle standen. Dieses
   Skript hält beide gleich und meldet sich, wenn sie es nicht mehr sind.

   >>> Warum die Darstellung dazugekommen ist <<<
   Die Web-Ansicht (website/js/viewer.js) hat ihre Seiten lange selbst
   nachgebaut und kannte nur Text, Handschrift und Bilder. Formeln,
   Formen und Code-Kästen sind in der App aber eigene Objekte geworden,
   dazu Tabellen, Ankreuzlisten und PDF-Seiten – auf der Website kam
   nichts davon an, und gemerkt hat es erst, wer dort ein Heft mit Formeln
   öffnete. Seither zeichnet die Website mit denselben Funktionen und
   denselben Regeln wie die App.

   Aufruf:
     npm run sync-share                  kopiert App -> Website
     npm run check-share                 prüft nur, Rückgabewert 1 bei Abweichung

   Zum Prüfen NICHT `npm run sync-share --check` nehmen: npm behält das
   Flag für sich, das Skript schreibt dann doch. Siehe checkOnly unten.

   >>> Warum die App die Quelle ist und nicht die Website <<<
   src/ liegt in Git, website/ steht in .gitignore und bleibt auf dem
   jeweiligen Rechner. Andersherum wäre die Quelle also die Fassung, die
   den anderen Rechner NIE erreicht: wer `git pull` macht, bekommt die
   neue App-Datei, seine örtliche Website-Datei bleibt alt – und das
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
  { source: ['src', 'core', 'docx.js'], target: ['website', 'js', 'docx.js'] },
  { source: ['src', 'core', 'sanitize.js'], target: ['website', 'js', 'sanitize.js'] },
  { source: ['src', 'core', 'formula.js'], target: ['website', 'js', 'formula.js'] },
  { source: ['src', 'canvas', 'shapes.js'], target: ['website', 'js', 'shapes.js'] },
  { source: ['src', 'core', 'code.js'], target: ['website', 'js', 'code.js'] },
  { source: ['src', 'core', 'pdfSeiten.js'], target: ['website', 'js', 'pdfSeiten.js'] },
  { source: ['src', 'core', 'inkSvg.js'], target: ['website', 'js', 'inkSvg.js'] },
  { source: ['src', 'css', 'pages.css'], target: ['website', 'css', 'pages.css'] }
];

/* Fremde Bibliotheken gehen Byte für Byte hinüber, ohne Kopf: vor einer
   Schriftdatei zerstörte ein Kommentar sie, und in eine .min-Datei soll
   ohnehin niemand hineinbearbeiten. Ein Ordner wird Datei für Datei
   abgeglichen.

   Die Schriften liegen unter lib/fonts/, weil katex.min.css sie genau
   dort sucht (url(fonts/…)). Sie lagen früher unter katex-fonts/ – in der
   App wie hier wurden sie dadurch nie geladen, und Formeln erschienen in
   einer Ersatzschrift. */
const LIBS = [
  { source: ['src', 'lib', 'katex.min.js'], target: ['website', 'lib', 'katex.min.js'] },
  { source: ['src', 'lib', 'katex.min.css'], target: ['website', 'lib', 'katex.min.css'] },
  { source: ['src', 'lib', 'fonts'], target: ['website', 'lib', 'fonts'] },
  { source: ['src', 'lib', 'pdf.min.js'], target: ['website', 'lib', 'pdf.min.js'] },
  { source: ['src', 'lib', 'pdf.worker.min.js'], target: ['website', 'lib', 'pdf.worker.min.js'] }
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

/**
 * Bringt eine Zieldatei auf den erwarteten Inhalt – oder meldet nur,
 * dass sie abweicht.
 *
 * @returns {'gleich'|'geschrieben'|'abweichend'}
 */
function abgleichen(pair, erwartet) {
  const target = path.join(root, ...pair.target);
  const targetRel = pair.target.join('/');
  const actual = fs.existsSync(target) ? fs.readFileSync(target) : null;

  if (actual && actual.equals(erwartet)) return 'gleich';

  if (checkOnly) {
    console.error(`[sync-share] ${targetRel} weicht von ${pair.source.join('/')} ab.`);
    stale++;
    return 'abweichend';
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, erwartet);
  console.log(`[sync-share] ${targetRel} aktualisiert.`);
  return 'geschrieben';
}

for (const pair of PAIRS) {
  const source = path.join(root, ...pair.source);
  const sourceRel = pair.source.join('/');

  if (!fs.existsSync(source)) {
    console.error(`[sync-share] Quelle fehlt: ${sourceRel}`);
    process.exit(1);
  }

  const erwartet = Buffer.from(header(sourceRel) + fs.readFileSync(source, 'utf8'), 'utf8');
  if (abgleichen(pair, erwartet) === 'gleich') {
    console.log(`[sync-share] ${pair.target.join('/')} ist aktuell.`);
  }
}

/* Ein Ordner wird zu seinen Dateien aufgefaltet. Nur eine Ebene tief –
   mehr hat keine der Bibliotheken. */
function dateienVon(lib) {
  const source = path.join(root, ...lib.source);
  if (!fs.existsSync(source)) {
    console.error(`[sync-share] Quelle fehlt: ${lib.source.join('/')}`);
    process.exit(1);
  }
  if (!fs.statSync(source).isDirectory()) return [lib];
  return fs.readdirSync(source).sort().map(name => ({
    source: [...lib.source, name],
    target: [...lib.target, name]
  }));
}

// Bei sechzig Schriftdateien nur eine Zeile, solange alles stimmt
let libsGleich = 0;
for (const lib of LIBS) {
  for (const datei of dateienVon(lib)) {
    const erwartet = fs.readFileSync(path.join(root, ...datei.source));
    if (abgleichen(datei, erwartet) === 'gleich') libsGleich++;
  }
}
if (libsGleich) console.log(`[sync-share] ${libsGleich} Bibliotheksdateien unter website/lib/ sind aktuell.`);

if (stale > 0) {
  console.error('[sync-share] Bitte "npm run sync-share" ausführen.');
  process.exit(1);
}
