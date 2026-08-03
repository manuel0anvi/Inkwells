#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   website/ vom Branch auffrischen — das Gegenstück zu deploy-web

   >>> Warum es das braucht <<<
   `website/` steht in .gitignore und reist deshalb NIE über den
   app-Branch mit. Wer nur `git pull` macht, hat den Ordner in dem Stand,
   in dem er ihn zuletzt selbst angefasst hat — beliebig alt, ohne
   Hinweis. Zwei Leute an einem Projekt laufen so zwangsläufig
   auseinander.

   Das ist nicht theoretisch: am 2.8.2026 hat ein `npm run sync-share`
   aus einem veralteten Ordner heraus 107 Zeilen Microsoft-Arbeit in
   src/core/share.js gelöscht, und am 3.8. wäre es 66 Zeilen ein weiteres
   Mal gewesen.

   Für die geteilten Module (share.js, docx.js) kann das seither nicht
   mehr passieren: dort ist src/core/ die Quelle und website/js/ die
   erzeugte Kopie, sync-share schreibt also nur noch in den örtlichen
   Ordner. Alles ANDERE in website/ — Dashboard, Leseansicht, i18n,
   Stile — hat weiterhin keinen anderen Weg von Rechner zu Rechner als
   diesen Aufruf.

   ── Was es NICHT tut ──────────────────────────────────────────────
   Es überschreibt den Ordner nicht blind. Wer hier eigene, noch nicht
   veröffentlichte Änderungen liegen hat, verlöre sie damit — und die
   Sicherheitsregeln liegen gar nicht auf dem Branch.

   Ohne Angaben werden deshalb nur die Unterschiede GEZEIGT. Erst
   `--apply` schreibt, und auch dann bleibt alles stehen, was der Branch
   nicht kennt.

   Aufruf:
     npm run pull-web              zeigt nur, was abweicht
     npm run pull-web -- --apply   holt die abweichenden Dateien
   ══════════════════════════════════════════════════════════════════════ */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCAL = path.join(ROOT, 'website');
const BRANCH = 'origin/website';

const apply = process.argv.includes('--apply');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    maxBuffer: 1 << 28,
    ...opts
  });
}

if (!fs.existsSync(LOCAL)) {
  console.error('✗ Der Ordner website/ fehlt ganz.');
  console.error('  git clone -b website https://github.com/manuel0anvi/Inkwell.git website');
  process.exit(1);
}

console.log(`Vergleiche website/ mit ${BRANCH} …\n`);
try {
  git(['fetch', 'origin', 'website'], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  console.error('✗ Branch nicht erreichbar:', err.message);
  process.exit(1);
}

const listed = git(['ls-tree', '-r', '--name-only', BRANCH], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

/* Zeilenenden zählen nicht als Unterschied.
   Git schreibt auf dem Branch LF, im Arbeitsordner unter Windows steht
   CRLF. Ohne diesen Ausgleich meldete die Prüfung dreizehn „abweichende"
   Dateien, die inhaltlich gleich sind – und die eine, auf die es
   ankommt, ging darin unter. */
function inhalt(buffer) {
  return buffer.toString('binary').replace(/\r\n/g, '\n');
}

const veraltet = [];
const fehlt = [];
let gleich = 0;
let nurZeilenenden = 0;

for (const rel of listed) {
  const ziel = path.join(LOCAL, rel);
  const vomBranch = git(['cat-file', 'blob', `${BRANCH}:${rel}`]);

  if (!fs.existsSync(ziel)) { fehlt.push({ rel, vomBranch }); continue; }

  const hier = fs.readFileSync(ziel);
  if (vomBranch.equals(hier)) { gleich++; continue; }
  if (inhalt(vomBranch) === inhalt(hier)) { gleich++; nurZeilenenden++; continue; }

  veraltet.push({ rel, vomBranch });
}

console.log(`  gleich          : ${gleich}`
  + (nurZeilenenden ? ` (davon ${nurZeilenenden} nur andere Zeilenenden)` : ''));
console.log(`  fehlt hier      : ${fehlt.length}`);
console.log(`  weicht ab       : ${veraltet.length}`);

const zuHolen = fehlt.concat(veraltet);
if (!zuHolen.length) {
  console.log('\n✓ website/ ist auf dem Stand des Branch.');
  process.exit(0);
}

console.log('');
for (const { rel } of zuHolen) console.log('  ~ ' + rel);

if (!apply) {
  console.log('\n>>> Abweichend heißt NICHT automatisch veraltet. <<<');
  console.log('Eigene, noch nicht veröffentlichte Änderungen stehen hier');
  console.log('genauso in der Liste. Sieh sie durch, bevor du sie überschreibst:');
  console.log('    git diff --no-index <(git show origin/website:<datei>) website/<datei>');
  console.log('\nZum Holen:  npm run pull-web -- --apply');
  process.exit(0);
}

for (const { rel, vomBranch } of zuHolen) {
  const ziel = path.join(LOCAL, rel);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, vomBranch);
  console.log('  geholt: ' + rel);
}

console.log(`\n✓ ${zuHolen.length} Dateien geholt.`);
console.log('Was der Branch nicht kennt, blieb unangetastet (Regeln, Sicherungskopien).');
/* Der Branch kann eine ältere share.js/docx.js mitgebracht haben. Die sind
   erzeugte Kopien – einmal neu schreiben, statt eine Abweichung zu melden,
   die niemand von Hand auflösen soll. */
console.log('\nGeteilte Module wieder aus src/core/ erzeugen:');
require('child_process').execFileSync(process.execPath,
  [path.join(__dirname, 'sync-share.js')], { stdio: 'inherit' });
