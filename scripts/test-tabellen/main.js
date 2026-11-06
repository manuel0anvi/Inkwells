/* ══════════════════════════════════════════════════════════════════════
   TABELLEN MIT VERBUNDENEN ZELLEN

   Zeile und Spalte wurden in core/tables.js als Platz im DOM gerechnet:
   zeile.children[index] war „die Spalte index". Solange jede Zelle genau
   ein Feld belegt, stimmt das.

   Aus Word kommen aber Tabellen mit colspan und rowspan – der Import
   unterstuetzt beides ausdruecklich. Damit fiel die Rechnung
   auseinander:

     Kopfzeile:  [ AB (colspan 2) ] [ C ]     zwei Kinder, drei Spalten
     Datenzeile: [ D ] [ E ] [ F ]            drei Kinder, drei Spalten

   „Spalte 2 loeschen" traf oben C (die logisch dritte) und unten E (die
   logisch zweite) – Inhalt weg, und zwar der falsche. Eine neue Zeile
   nach der Kopfzeile bekam eine Zelle statt dreien.

   Geprueft wird an einem echten DOM; ohne eines gibt es keine Tabelle.
   Laeuft NICHT in `npm test`.
   Aufruf:  npm run test:tabellen
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
require('../stabile-fenster.js');
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

    process.stdout.write('\nTabellen\n');
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
