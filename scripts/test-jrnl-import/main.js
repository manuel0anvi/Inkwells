/* ══════════════════════════════════════════════════════════════════════
   EIN HEFT AUS EINER DATEI ÖFFNEN

   Prüft fillNotebookFromJrnl() aus core/importExport.js – den Weg, über
   den ein zugeschicktes Heft als KOPIE im eigenen Ordner landet.
   Nachbauen in Node ginge nicht: der Sanitizer arbeitet auf einem echten
   DOM.

   Geprüft wird an einem Heft, das der Test selbst baut – mitsamt allem,
   was eine fremde Datei mitbringen kann und nicht mitbringen darf:

     · JEDE KENNUNG IST NEU. getPage() sucht über alle offenen Hefte
       (core/data.js). Zwei Hefte mit derselben Seitenkennung heisst:
       geschriebener Text landet in der falschen Datei.
     · DER INHALT KOMMT MIT. Text, Bilder, Formen, Formeln, Striche,
       Abschnitte, Kommentare – und die Verweise dazwischen stimmen noch.
     · DER FILTER HÄLT. Ein <script> im Seitentext, ein javascript: als
       Bildquelle, ein url() als Farbe, eine erfundene Objektart: alles
       Dinge, die in einer Datei stehen KÖNNEN, weil sie niemand geprüft
       hat, bevor sie hier ankommt.

   Läuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:jrnl
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

    process.stdout.write('\nHeft aus Datei\n');
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
