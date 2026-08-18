#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   WEBSITE VERÖFFENTLICHEN

   Schiebt den Inhalt von website/ in den GitHub-Branch "website".
   Von dort baut GitHub Pages die Seite unter inkwells.me.

   Aufruf:
     npm run deploy-web              vorbereiten, festschreiben, hochladen
     npm run deploy-web -- --dry-run alles außer dem Hochladen (zum Anschauen)

   ── Wie es arbeitet ────────────────────────────────────────────────
   Der Branch "website" enthält den INHALT von website/ direkt im
   Wurzelverzeichnis – nicht den Ordner selbst. Sonst würde aus
   inkwells.me/dashboard/ ein inkwells.me/website/dashboard/.

   Damit nichts Altes liegen bleibt (gelöschte oder umbenannte Dateien),
   wird der Branch jedes Mal vollständig geleert und neu befüllt. Die
   Historie bleibt dabei erhalten – es ist ein normaler Commit.

   Gearbeitet wird in .deploy-website/ neben dem Projekt. Dieser Ordner
   ist nur ein Arbeitsplatz und kann jederzeit gelöscht werden; beim
   nächsten Aufruf wird er neu geholt.
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'website');

/* Ziel. Notfalls ohne Bearbeiten der Datei umstellbar:
     npm run deploy-web -- --repo=https://github.com/wer/was.git --branch=gh-pages
   Wird ein anderes Ziel gewählt, wird auch ein eigener Arbeitsordner
   verwendet – sonst läge dort noch der Klon des alten Repos. */
function arg(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const REPO = arg('repo', 'https://github.com/manuel0anvi/Inkwells.git');
const BRANCH = arg('branch', 'website');

const isDefaultTarget = REPO.includes('manuel0anvi/Inkwells') && BRANCH === 'website';
const WORK = path.join(ROOT, isDefaultTarget ? '.deploy-website' : '.deploy-website-alt');

// Gehört zur Firebase-Einrichtung, nicht auf die Website
const EXCLUDE = new Set(['firestore.rules', 'database.rules.json']);

/* Sicherungskopien bleiben da, wo sie hingehören: auf dem eigenen Rechner.
   website/ steht in .gitignore, deshalb sammeln sich dort mit der Zeit
   Dateien wie share.js.alt an – die fielen bisher nicht auf und wären
   mit der Seite veröffentlicht worden. Eine alte Fassung von share.js
   öffentlich auszuliefern nützt niemandem und verwirrt beim Suchen. */
const EXCLUDE_ENDINGS = ['.alt', '.bak', '.orig', '.rej', '~'];

function isBackup(name) {
  return EXCLUDE_ENDINGS.some(ending => name.endsWith(ending));
}

const dryRun = process.argv.includes('--dry-run');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: opts.cwd || WORK,
    encoding: 'utf8',
    stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit']
  });
}

function fail(message, hint) {
  console.error('\n✗ ' + message);
  if (hint) console.error('  ' + hint);
  process.exit(1);
}

/* ── 1. Quelle prüfen ─────────────────────────────────────────────── */

if (!fs.existsSync(SOURCE)) fail('Ordner website/ nicht gefunden.');
if (!fs.existsSync(path.join(SOURCE, 'CNAME'))) {
  fail('website/CNAME fehlt.', 'Ohne diese Datei verliert GitHub Pages die eigene Domain inkwells.me.');
}

try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch (err) {
  fail('git ist nicht installiert oder nicht im PATH.');
}

/* ── Wohin und als wer? ───────────────────────────────────────────────
   Wird vor jedem Lauf angezeigt, damit nie unklar ist, welches Repo
   beschrieben wird und unter welchem Konto. Das sind ZWEI verschiedene
   Dinge: der Commit-Autor kommt aus der git-Konfiguration, angemeldet
   wird dagegen mit dem in Windows gespeicherten Zugang.
   ─────────────────────────────────────────────────────────────────── */

function quietly(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (err) { return ''; }
}

const authorName = quietly('git', ['config', '--global', 'user.name']) || '(nicht gesetzt)';
const authorMail = quietly('git', ['config', '--global', 'user.email']) || '(nicht gesetzt)';

// Windows merkt sich den GitHub-Zugang im Anmeldeinformations-Manager
let pushUser = '';
const creds = quietly('cmdkey', ['/list:git:https://github.com']);
const match = creds.match(/(?:Benutzer|User):\s*(\S+)/i);
if (match) pushUser = match[1];

console.log('Ziel      :', REPO.replace(/\.git$/, ''), '· Branch', BRANCH);
console.log('Commit als:', `${authorName} <${authorMail}>`);
console.log('Hochladen :', pushUser || '(kein gespeicherter Zugang – GitHub fragt beim Push)');
console.log('');

/* ── 2. Arbeitsplatz holen oder auffrischen ───────────────────────── */

if (!fs.existsSync(path.join(WORK, '.git'))) {
  console.log(`Hole Branch "${BRANCH}" …`);
  fs.rmSync(WORK, { recursive: true, force: true });
  execFileSync('git', ['clone', '--branch', BRANCH, '--single-branch', REPO, WORK], {
    cwd: ROOT, stdio: 'inherit'
  });
} else {
  console.log(`Frische Branch "${BRANCH}" auf …`);
  git(['fetch', 'origin', BRANCH]);
  git(['checkout', BRANCH], { quiet: true });
  git(['reset', '--hard', `origin/${BRANCH}`], { quiet: true });
  git(['clean', '-fd'], { quiet: true });
}

/* ── 3. Branch leeren (alles außer .git) ──────────────────────────── */

for (const entry of fs.readdirSync(WORK)) {
  if (entry === '.git') continue;
  fs.rmSync(path.join(WORK, entry), { recursive: true, force: true });
}

/* ── 4. website/ hineinkopieren ───────────────────────────────────── */

let copied = 0;

function copyInto(fromDir, toDir, relative = '') {
  fs.mkdirSync(toDir, { recursive: true });
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (EXCLUDE.has(rel)) { console.log('  übersprungen:', rel); continue; }
    if (!entry.isDirectory() && isBackup(entry.name)) {
      console.log('  übersprungen (Sicherungskopie):', rel);
      continue;
    }

    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);

    if (entry.isDirectory()) copyInto(from, to, rel);
    else { fs.copyFileSync(from, to); copied++; }
  }
}

copyInto(SOURCE, WORK);
console.log(`${copied} Dateien übernommen.`);

// Sicherheitsnetz: ohne diese drei ist die Seite kaputt
for (const must of ['CNAME', 'index.html', 'icon.png']) {
  if (!fs.existsSync(path.join(WORK, must))) fail(`${must} fehlt nach dem Kopieren.`);
}

/* ── 5. Was hat sich geändert? ────────────────────────────────────── */

git(['add', '-A'], { quiet: true });
const staged = git(['diff', '--cached', '--stat'], { quiet: true }).trim();

if (!staged) {
  console.log('\nKeine Änderungen – der Branch ist bereits aktuell.');
  process.exit(0);
}

console.log('\nÄnderungen:\n' + staged);

/* ── 6. Festschreiben und hochladen ───────────────────────────────── */

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
git(['commit', '-m', `Website aktualisiert (${stamp})`], { quiet: true });

if (dryRun) {
  console.log('\n--dry-run: nichts hochgeladen.');
  console.log(`Zum Hochladen:  git -C "${WORK}" push`);
  console.log(`Zum Verwerfen:  git -C "${WORK}" reset --hard origin/${BRANCH}`);
  process.exit(0);
}

console.log('\nLade hoch …');
try {
  git(['push', 'origin', BRANCH]);
} catch (err) {
  fail('Hochladen fehlgeschlagen.',
    'Meist fehlt die Anmeldung bei GitHub. Einmalig einrichten:\n'
    + '  git config --global credential.helper manager\n'
    + 'Beim nächsten Versuch fragt Windows nach deinem GitHub-Konto.\n'
    + `Der fertige Commit liegt in ${WORK} und geht nicht verloren.`);
}

console.log('\n✓ Fertig. GitHub Pages braucht ein bis zwei Minuten.');
console.log('  Danach inkwells.me mit Strg+Shift+R neu laden.');
