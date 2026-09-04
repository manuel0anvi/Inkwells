#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   WAS NUR DIE ANZEIGE IST, DARF NICHT INS HEFT

   Im `.j-text` steht zweierlei durcheinander: der Text des Hefts und
   das, was die Oberfläche gerade darüberlegt. Gespeichert und
   verschickt werden darf nur das Erste.

   Darüber liegen:

     · die GREIFSTREIFEN an Spalten- und Zeilenkanten (core/tables.js),
     · der ZUSTAND einer kommentierten Stelle: `j-aktiv`/`j-cursor`,
       solange man darüber schwebt oder mit der Marke darin steht, und
       der `title` mit Verfasser und Anmerkung (ui/comments.js).

   >>> Warum das eine eigene Prüfung wert ist <<<
   Weil es an SECHS Stellen schiefgehen kann und fünf davon es einmal
   falsch hatten: jede Stelle, die den Editor ins Datenmodell schreibt,
   muss durch ohneGriffe() gehen. Wer eine neue dazuschreibt und `.
   innerHTML` nimmt, merkt nichts – bis der `title` im geteilten
   Dokument steht und schon das blosse Darüberfahren eine unveränderte
   Seite zu einer geänderten macht. Beim anderen nimmt die Bereinigung
   ihn wieder weg, seine Fassung unterscheidet sich damit wieder von
   unserer, und das Spiel beginnt von vorn.

   Gemessen wird deshalb am Verbot und nicht am Vorhandensein: NIRGENDS
   im Quelltext darf `page.textContent` roh aus einem `innerHTML`
   kommen.

   Aufruf:  node scripts/test-anzeige-bleibt-draussen.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const wurzel = path.join(__dirname, '..');

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

/** Alle .js unter src/, ohne die mitgelieferten Bibliotheken. */
function quellen(ordner = path.join(wurzel, 'src'), raus = []) {
  for (const name of fs.readdirSync(ordner)) {
    const voll = path.join(ordner, name);
    const stat = fs.statSync(voll);
    if (stat.isDirectory()) {
      if (name === 'lib') continue;
      quellen(voll, raus);
    } else if (name.endsWith('.js')) {
      raus.push(voll);
    }
  }
  return raus;
}

console.log('Kein roher Editor-Inhalt im Datenmodell\n');
{
  /* Gesucht wird zeilenweise nach `page.textContent = …innerHTML`.
     Erlaubt ist das nur mit ohneGriffe in derselben Zeile – so steht es
     an allen sechs Stellen. */
  const sünder = [];
  for (const datei of quellen()) {
    fs.readFileSync(datei, 'utf8').split('\n').forEach((zeile, nr) => {
      if (!/page\.textContent\s*=/.test(zeile)) return;
      if (!/\.innerHTML/.test(zeile)) return;
      if (/ohneGriffe/.test(zeile)) return;
      sünder.push(path.relative(wurzel, datei) + ':' + (nr + 1) + '  ' + zeile.trim().slice(0, 90));
    });
  }

  check('Keine Stelle schreibt rohes innerHTML ins Heft', sünder, []);
}
{
  /* Und die eine erlaubte Stelle muss auch wirklich aufräumen. */
  const app = fs.readFileSync(path.join(wurzel, 'src', 'app.js'), 'utf8');
  const von = app.indexOf('function ohneGriffe(');
  const bis = app.indexOf('\n}', von);
  const fn = app.slice(von, bis);

  check('ohneGriffe gibt es', von > -1, true);
  check('Es wirft die Greifstreifen weg', /GRIFF_WAHL\).forEach/.test(fn), true);
  check('Und den Zustand der kommentierten Stellen',
    /MARKEN_WAHL\).forEach/.test(fn), true);
  check('Namentlich: der title', /removeAttribute\('title'\)/.test(fn), true);
  check('Und j-aktiv / j-cursor',
    /classList\.remove\(\.\.\.NUR_ANZEIGE_KLASSEN\)/.test(fn), true);

  /* j-resolved gehört NICHT dazu: die kommt aus dem Kommentar selbst
     und ist für alle gleich. Sie wegzuwerfen hiesse, sie bei jedem
     Speichern neu ausrechnen zu müssen. */
  const liste = app.slice(app.indexOf('const NUR_ANZEIGE_KLASSEN'),
    app.indexOf('\n', app.indexOf('const NUR_ANZEIGE_KLASSEN')));
  check('j-resolved bleibt stehen', /j-resolved/.test(liste), false);

  /* Der schnelle Weg ohne Kopie darf nur greifen, wenn es wirklich
     nichts aufzuräumen gibt – sonst käme die Anzeige doch durch.
     Seit dem 17.8.2026 sind es drei Fälle: dazu kam die gerechnete
     Spaltenbreite der frei stehenden Absätze (canvas/text.js).

     >>> Der Codeblock steht hier bewusst NICHT <<<
     Kurz war er als <pre> im Seitentext gebaut, und dann musste seine
     Einfärbung hier abgezogen werden. Seit er ein OBJEKT ist
     (core/code.js), steht sein Quelltext in obj.code und nicht im Text –
     durch diese Funktion geht davon gar nichts mehr. Genau das war der
     Grund für die Umstellung: die Farben im Text hätten bei jedem
     Anschlag ein neues Gerüst durch Yjs geschickt. */
  check('Der Weg ohne Kopie fragt ALLE Fälle ab',
    /if \(!griffe && !marken && !geschoben\) return textDiv\.innerHTML;/.test(fn), true);
  /* Gemeint sind margin-left und margin-top. Ein max-width stand hier
     auch einmal – vergeben hat es aber nie jemand, ordneFreieAbsaetze
     setzte es nur bei jedem Durchgang zurueck. Beides ist raus. */
  check('Und das gerechnete Ausweichen bleibt draussen',
    /p\.style\.marginLeft = '';/.test(fn) && /p\.style\.marginTop = '';/.test(fn), true);
}

console.log('');
if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
