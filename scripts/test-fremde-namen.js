#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   FREMDE NAMEN GEHÖREN NICHT IN HTML-ZEICHENKETTEN

   Heftname, Heftfarbe, Abschnittsname und Anhangsname kommen auch aus
   geteilten Dokumenten und aus .jrnl-Dateien anderer Leute. Sie im
   innerHTML einzusetzen hiesse, fremden Code im Fenster mit window.api
   auszuführen: die CSP der Oberfläche erlaubt Inline-Code.

   Das Verhalten prüft npm run test:rundgang („Fremde Namen führen nichts
   aus“). Dieser Test läuft ohne Electron und hält die Stellen fest, damit
   das Muster nicht beim nächsten Umbau zurückkommt.

   Aufruf:  node scripts/test-fremde-namen.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), 'utf8');

function dateien(ordner, liste = []) {
  for (const e of fs.readdirSync(path.join(ROOT, ordner), { withFileTypes: true })) {
    const rel = path.join(ordner, e.name);
    if (e.isDirectory()) { if (e.name !== 'lib') dateien(rel, liste); }
    else if (e.name.endsWith('.js')) liste.push(rel);
  }
  return liste;
}

let fehler = 0;
function pruefe(titel, gut, hinweis) {
  console.log(`  ${gut ? '✓' : '✗'} ${titel}`);
  if (!gut) { fehler++; if (hinweis) console.log('    ' + hinweis); }
}

/* Eine HTML-Zeichenkette, in die ein fremder Name eingesetzt wird */
const VERBOTEN = [
  /['"`]\s*\+\s*getSectionDisplayName\(/,
  /<[a-z][^\x60]*\$\{\s*nb\.(name|color)\s*\}/,
  /<[a-z][^'"`]*['"`]\s*\+\s*\(?\s*(nb|sec|section|notebook)\.(name|color)\b/,
  /<[a-z][^'"`]*['"`]\s*\+\s*\(?\s*obj\.name\b/,
  /title="['"]\s*\+[^\n]*\.replace\(\s*'\{name\}'/
];

console.log('Fremde Namen im Quelltext');
const treffer = [];
for (const datei of dateien('src')) {
  lies(datei).split(/\r?\n/).forEach((zeile, i) => {
    if (VERBOTEN.some(re => re.test(zeile))) treffer.push(`${datei}:${i + 1}  ${zeile.trim().slice(0, 90)}`);
  });
}
pruefe('Kein fremder Name in einer HTML-Zeichenkette', treffer.length === 0, treffer.join('\n    '));

console.log('Die Prüfung beim Eingang');
const daten = lies('src', 'core', 'data.js');
pruefe('normalizeNotebook prüft Name und Farbe', /heftAngabenPruefen\(nb\)/.test(daten));
const farbe = daten.match(/IST_HEFTFARBE\s*=\s*(\/.*\/i);/);
pruefe('Die Farbregel ist vorhanden', !!farbe);
if (farbe) {
  const re = eval(farbe[1]);
  pruefe('Eine Farbe kommt durch', re.test('#c8a96e') && re.test('rgb(1, 2, 3)') && re.test('red'));
  pruefe('Etwas anderes nicht',
    !re.test('"><img src=x>') && !re.test('url(x)') && !re.test('red;background:url(x)'));
}

console.log('Das Forum');
const regeln = lies('website', 'firestore.rules');
pruefe('Beiträge nur mit erzeugter Kennung', /allow create: if istAutoKennung\(postId\)/.test(regeln));
pruefe('Antworten nur mit erzeugter Kennung', /allow create: if istAutoKennung\(replyId\)/.test(regeln));

if (fehler) { console.error(fehler + ' Pruefung(en) fehlgeschlagen.'); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
