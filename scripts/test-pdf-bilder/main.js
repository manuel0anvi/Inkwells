/* ══════════════════════════════════════════════════════════════════════
   BILDER AUS EINEM PDF

   Prüft, was core/importExport.js beim Weg „PDF als Text" mit allem
   macht, was kein Text ist. Nachbauen in Node ginge nicht: pdf.js
   braucht einen Canvas zum Malen, und der Seitenumbruch misst
   gerenderten Text.

   Geprüft wird gegen ein PDF, das der Test selbst baut – von Hand, Byte
   für Byte. Nur so steht die Lage jedes Bildes vorher fest und lässt
   sich mit dem vergleichen, was herauskommt:

     · DIE LAGE. Ein Bild wird über die Matrix des Zeichenbefehls
       gefunden. Sitzt sie falsch, sitzt jedes Bild falsch – und das
       fiele sonst erst am fertigen Heft auf.
     · DIE REIHENFOLGE. Ein Bild steht zwischen dem Text, der auf dem
       Blatt darüber und darunter steht, nicht am Ende der Seite.
     · DAS EINGESCANNTE BLATT. Eine Seite ohne Textebene wird ganz zum
       Bild, statt leer zu bleiben.
     · DIE BESCHRIFTUNG IM BILD. Was innerhalb eines Schaubilds steht,
       ist im Bild schon zu sehen und darf nicht noch einmal als
       Wortfetzen zwischen den Absätzen landen.

   Läuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:pdf
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
      /* Die Seite prüft asynchron – pdf.js gibt nur Versprechen zurück –,
         deshalb wird gewartet, bis sie fertig meldet. */
      bericht = await win.webContents.executeJavaScript(
        'window.__fertig ? window.__fertig.then(() => window.__ergebnis) : (window.__ergebnis || "")'
      );
    } catch (err) {
      bericht = 'ABBRUCH ' + err.message;
    }

    process.stdout.write('\nPDF-Bilder\n');
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
