/* ══════════════════════════════════════════════════════════════════════
   EBENEN UND BEDIENTEILE EINES BILDES

   Prüft canvas/objects.js zusammen mit css/pages.css – in einem echten
   Chromium, denn hier geht es um Dinge, die ohne Layout gar nicht
   entstehen: welches Element an einer Bildschirmstelle obenauf liegt und
   ob ein Knopf den Zeiger überhaupt abbekommt.

   >>> Warum das eine eigene Prüfung wert ist <<<
   Ein Bild trägt zwei voneinander unabhängige Angaben:

     · vor oder hinter dem TEXT   (obj.layer)
     · seine Stelle unter den anderen BILDERN  (Reihenfolge in page.objects)

   Beide über einen einzigen z-index zu führen ging dreimal schief:
   erst lagen Griffe und Leiste mit dem Bild unter dem Text und waren
   nicht anzuklicken; dann sprang das Bild beim Auswählen vor den Text;
   dann taten die Knöpfe „ganz nach vorn/hinten" sichtbar nichts, weil
   alle Bilder eines Bandes dieselbe Zahl trugen. Die Fälle stehen alle
   hier drin.

   Läuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:objects
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const path = require('path');

// Ohne Fenster auf dem Bildschirm, aber mit echtem Layout
app.disableHardwareAcceleration();

app.on('ready', () => {
  const win = new BrowserWindow({ width: 1000, height: 1200, show: false });
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

    process.stdout.write('\nEbenen und Bedienteile eines Bildes\n');
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
