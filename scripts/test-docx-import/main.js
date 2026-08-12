/* ══════════════════════════════════════════════════════════════════════
   WORD-DOKUMENTE ÖFFNEN

   Prüft src/core/docxImport.js in einem echten Chromium. Nachbauen in
   Node ginge nicht: das Entpacken hängt an DecompressionStream, das
   Lesen an DOMParser, und der Seitenumbruch misst gerenderten Text.

   Geprüft wird:

     · DAS ARCHIV. Hin und zurück, mit beiden Verfahren – gespeichert
       (so schreibt core/docx.js) und deflate (so schreibt Word).
     · DER RUNDLAUF gegen den eigenen Export: ein Heft durch
       InkwellDocx.build() und wieder zurück. Das ist der schärfste
       Test, den es ohne Word gibt, weil beide Seiten im Haus sind.
     · DIE ÜBERSETZUNG einzelner Word-Bausteine: Überschriften über
       w:outlineLvl (nicht über den Vorlagennamen – der ist in jeder
       Sprache anders), Auszeichnungen samt ausdrücklichem „nicht fett",
       Farben, Listen über zwei Ecken, Tabellen mit verbundenen Zellen.
     · DER SANITIZER. Alles, was hier erzeugt wird, muss ihn
       UNVERÄNDERT überstehen – sonst fiele es beim ersten
       Cloud-Abgleich weg, und zwar unbemerkt.
     · DER SEITENUMBRUCH: kein Absatz geht verloren, keine Seite läuft
       über ihre Nutzhöhe hinaus.

   Läuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:docx
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

app.on('ready', () => {
  const win = new BrowserWindow({ width: 1000, height: 800, show: false });
  const fehler = [];

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    fehler.push(`Laden fehlgeschlagen: ${code} ${desc} ${url}`);
  });

  win.loadFile(path.join(__dirname, 'page.html'));

  win.webContents.once('did-finish-load', async () => {
    let bericht;
    try {
      /* Die Seite prüft asynchron (Entpacken gibt ein Versprechen
         zurück) – deshalb wird gewartet, bis sie fertig meldet, statt
         das Ergebnis sofort abzuholen. */
      bericht = await win.webContents.executeJavaScript(
        'window.__fertig ? window.__fertig.then(() => window.__ergebnis) : (window.__ergebnis || "")'
      );
    } catch (err) {
      bericht = 'ABBRUCH ' + err.message;
    }

    process.stdout.write('\nWord-Import\n');
    process.stdout.write(String(bericht).split('\n').map(l => '  ' + l).join('\n') + '\n');

    const gescheitert = String(bericht).split('\n').filter(l => /^(FEHL|ABBRUCH)/.test(l));
    if (!String(bericht).trim()) fehler.push('Die Seite hat kein Ergebnis geliefert.');
    fehler.push(...gescheitert);

    if (fehler.length) {
      process.stdout.write(`\n${fehler.length} Prüfung(en) fehlgeschlagen.\n`);
      app.exit(1);
      return;
    }
    process.stdout.write('\nAlle Prüfungen bestanden.\n');
    app.exit(0);
  });
});
