/* ══════════════════════════════════════════════════════════════════════
   SEITENTEXT BEREINIGEN

   Prüft src/core/sanitize.js in einem echten Chromium. Das muss so sein:
   die Bereinigung arbeitet mit <template>, TreeWalker und el.style, und
   genau darauf beruht ihre Wirkung. Ein nachgebautes DOM würde etwas
   anderes prüfen als das, was in der App läuft.

   Geprüft wird beides, und beides ist gleich wichtig:

     · Nichts Ausführbares kommt durch (das ist der Zweck).
     · Alles, was der Editor erzeugt, bleibt erhalten – Überschriften,
       Fett/Kursiv/Unterstrichen und die Textfarbe in BEIDEN Formen,
       als <font color> und als style="color". Eine Bereinigung, die
       bestehende Hefte entstellt, wäre die schlechtere Krankheit.

   Läuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:sanitize
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

app.on('ready', () => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
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

    process.stdout.write('\nSeitentext bereinigen\n');
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
