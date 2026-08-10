/* ══════════════════════════════════════════════════════════════════════
   AUFZÄHLUNGEN UND NUMMERIERUNGEN

   Prüft src/core/lists.js in einem echten Chromium. Nachbauen ginge
   nicht: die Umschaltung benutzt document.execCommand, die Marke steckt
   in einer echten Selection, und ob eine Zeile weiterhin genau eine
   Zeilenhöhe hoch ist, weiß nur der Browser, der sie setzt.

   Geprüft wird viererlei:

     · An, aus, Form wechseln – auch aus reinem Text heraus, denn solange
       nur getippt wurde, hat eine Seite gar keine Absätze.
     · Tab, Enter und Rücktaste verhalten sich wie in Word.
     · Aus getipptem „1. " oder „- " wird eine Liste.
     · DAS RASTER: jede Zeile bleibt genau eine Zeilenhöhe hoch. Geht das
       verloren, sitzt der ganze Text darunter neben den Linien des
       Papiers – und die Schreibmarken der Mitschreiber rechnen aus
       derselben Zeilenhöhe.

   Läuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:lists
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

app.on('ready', () => {
  const win = new BrowserWindow({ width: 900, height: 700, show: false });
  const fehler = [];

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    fehler.push(`Laden fehlgeschlagen: ${code} ${desc} ${url}`);
  });

  win.loadFile(path.join(__dirname, 'page.html'));

  win.webContents.once('did-finish-load', async () => {
    let bericht;
    try {
      bericht = await win.webContents.executeJavaScript('window.__ergebnis || ""');
    } catch (err) {
      bericht = 'ABBRUCH ' + err.message;
    }

    process.stdout.write('\nAufzaehlungen\n');
    process.stdout.write(bericht.split('\n').map(l => '  ' + l).join('\n') + '\n');

    const gescheitert = bericht.split('\n').filter(l => /^(FEHL|ABBRUCH)/.test(l));
    if (!bericht.trim()) fehler.push('Die Seite hat kein Ergebnis geliefert.');
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
