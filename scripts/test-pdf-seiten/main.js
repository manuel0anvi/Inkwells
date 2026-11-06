/* ══════════════════════════════════════════════════════════════════════
   EIN PDF ALS HEFTSEITEN — OHNE ES ZU BILDERN ZU RECHNEN

   Ein eingefügtes PDF wurde früher beim Import einmal zu JPEGs gerechnet
   (anderthalbfach, Güte 0,65) und die Datei weggeworfen. Damit stand für
   immer fest, wie scharf eine Seite sein kann: 892 Punkte für ein
   A4-Blatt, das auf einem heutigen Schirm schon bei 100 % mehr braucht.

   Jetzt liegt das PDF im Heft und die Seite wird beim Ansehen gezeichnet
   (core/pdfSeiten.js). Geprüft wird hier, was daran leise kaputtgehen
   kann:

     · DIE SEITE TRÄGT KEIN BILD. Bliebe beim Import doch eines liegen,
       wäre das Heft so gross wie vorher – der halbe Grund fiele weg.
     · DIE DATEI LIEGT EINMAL DA. Zweimal dasselbe Buch eingefügt sind
       sonst 80 statt 40 MB.
     · SIE WIRD WIRKLICH GEZEICHNET, und zwar in der Feinheit, die der
       Zoom verlangt. Genau das ist der ganze Umbau.
     · ZOOMEN ZEICHNET NEU statt aufzuziehen.
     · WAS HINAUSGEHT, IST EIN BILD. Freigabe und Live-Bearbeitung kennen
       kein pdfRef; ohne materialisiere() sähe der andere leere Seiten.
     · DER AUSDRUCK bekommt Druckauflösung statt der alten 108 dpi.
     · WEGGEWORFENE SEITEN nehmen ihre Datei mit, sonst bleibt ein Buch
       für immer unsichtbar im Heft liegen.

   Läuft NICHT in `npm test` – braucht Chromium für Canvas und pdf.js.
   Aufruf:  npm run test:pdfseiten
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
require('../stabile-fenster.js');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
app.disableHardwareAcceleration();

const ABLAGE = path.join(app.getPath('temp'), 'inkwells-pdfseiten');
const ATTRAPPEN = {
  'load-settings': { saveLocation: ABLAGE }, 'save-settings': true,
  'load-registry': { notebooks: [] }, 'save-registry': true,
  'get-default-save-path': ABLAGE, 'check-internet': false,
  'get-pending-deep-link': null, 'get-pending-share-link': null, 'pick-folder': null,
  'get-app-version': '1.1.2', 'load': null, 'pick-files': [],
  'pick-document': null, 'load-from-path': null, 'file-exists': false,
  'delete-file': { success: true }, 'move-file': { success: true },
  'save-to-path': { success: true }, 'save': { success: true },
  'export-pdf': { success: true }, 'save-binary': { success: true },
  'erst-start': false, 'load-postfach': null, 'save-postfach': true,
  'erste-anmeldung': false, 'check-for-updates': null,
  'griff-liste': { versteckt: false, dateien: [] }
};
for (const [k, v] of Object.entries(ATTRAPPEN)) {
  ipcMain.handle(k, async () => (typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v));
}
for (const kanal of ['silent-auth', 'win-min', 'win-max', 'win-close', 'spell-language']) {
  ipcMain.on(kanal, () => {});
}

/* Ein PDF von Hand, Byte für Byte – wie in scripts/test-pdf-bilder. Nur
   so steht vorher fest, was herauskommen muss: zwei A4-Seiten hochkant
   mit lesbarem Text darauf. */
function baueTestPdf(seiten) {
  const stellen = [];
  let pdf = '%PDF-1.4\n';
  const schreib = (id, koerper) => {
    stellen[id] = pdf.length;
    pdf += id + ' 0 obj\n' + koerper + '\nendobj\n';
  };

  const seitenIds = [];
  let n = 3;
  const teile = [];
  for (let i = 1; i <= seiten; i++) {
    const inhalt = 'BT /F1 28 Tf 57 700 Td (Seite ' + i + ' von ' + seiten + ') Tj ET\n'
      + 'BT /F1 11 Tf 57 660 Td (Stetigkeit, Abschnitt ' + i + '.2) Tj ET\n'
      + '2 w 57 640 m 538 640 l S';
    teile.push({ inhaltId: ++n, seitenId: ++n, inhalt });
    seitenIds.push(n);
  }

  schreib(1, '<< /Type /Catalog /Pages 2 0 R >>');
  schreib(2, '<< /Type /Pages /Kids [' + seitenIds.map(i => i + ' 0 R').join(' ')
    + '] /Count ' + seiten + ' >>');
  schreib(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const t of teile) {
    schreib(t.inhaltId, '<< /Length ' + t.inhalt.length + ' >>\nstream\n' + t.inhalt + '\nendstream');
    schreib(t.seitenId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 3 0 R >> >> /Contents ' + t.inhaltId + ' 0 R >>');
  }

  const xref = pdf.length;
  pdf += 'xref\n0 ' + stellen.length + '\n0000000000 65535 f \n';
  for (let i = 1; i < stellen.length; i++) {
    pdf += String(stellen[i] || 0).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + stellen.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf, 'latin1').toString('base64');
}

const PDF64 = baueTestPdf(4);
const warte = ms => new Promise(r => setTimeout(r, ms));

const zeilen = [];
let fehl = 0;
const abschnitt = (name) => { zeilen.push(''); zeilen.push(name); };
const pruefe = (was, ok, hinweis) => {
  if (!ok) fehl++;
  zeilen.push((ok ? 'ok   ' : 'FEHL ') + was + (ok ? '' : '  ->  ' + hinweis));
};

function fertig() {
  process.stdout.write('\nEin PDF als Heftseiten\n');
  process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : 0);
}

setTimeout(() => { pruefe('Zeitgrenze', false, 'nach 120 s nicht fertig'); fertig(); }, 120000);


/* Die Oberflaeche fragt beim Hochfahren nach einer beim Start
   mitgegebenen Datei (main.js, get-pending-file). Hier gibt es keine -
   ohne diesen Griff protokolliert Electron aber einen Fehler, der mit
   dem Geprueften nichts zu tun hat. */
try { ipcMain.handle('get-pending-file', () => null); } catch (e) {}

app.on('ready', async () => {
  const win = new BrowserWindow({
    width: 1300, height: 900, show: false, backgroundColor: '#12121a',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });

  const konsole = [];
  win.webContents.on('console-message', (...args) => {
    const e = (args.length === 1 && typeof args[0] === 'object') ? args[0] : null;
    const level = e ? e.level : args[1];
    const text = e ? e.message : args[2];
    if (level === 3 || level === 'error') konsole.push(String(text).slice(0, 200));
  });

  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await warte(2600);
  const js = (code) => win.webContents.executeJavaScript(code);

  try {
    /* ── Import ──────────────────────────────────────────────────── */
    abschnitt('Der Import');
    const nachImport = JSON.parse(await js(`(async () => {
      const dataUrl = 'data:application/pdf;base64,' + ${JSON.stringify(PDF64)};
      const nb = { id: 'nb-pdf', name: 'Skript', pages: [], sections: [] };
      S.notebooks = [nb];
      await fillNotebookFromPdf(nb, dataUrl, 'Skript.pdf');

      // Dieselbe Datei ein zweites Mal – sie darf nicht doppelt liegen
      await pdfInsHeft(nb, dataUrl, 'Skript-Kopie.pdf');

      return JSON.stringify({
        seiten: nb.pages.length,
        mitRef: nb.pages.filter(p => p.pdfRef && p.pdfRef.datei).length,
        mitBild: nb.pages.filter(p => p.bgImg).length,
        dateien: Object.keys(nb.pdfs || {}).length,
        ersteSeite: nb.pages[0] ? nb.pages[0].pdfRef.seite : null,
        breite: nb.pages[0] ? nb.pages[0].w : 0,
        hatText: !!(nb.pages[0] && /j-folie/.test(nb.pages[0].textContent || '')),
        leer: typeof pageIsEmpty === 'function' ? pageIsEmpty(nb.pages[0]) : null
      });
    })()`));

    pruefe('Alle vier Seiten entstehen', nachImport.seiten === 4, 'es sind ' + nachImport.seiten);
    pruefe('Jede zeigt auf das PDF', nachImport.mitRef === 4, nachImport.mitRef + ' von 4');
    pruefe('Keine trägt ein Bild', nachImport.mitBild === 0,
      nachImport.mitBild + ' Seite(n) mit bgImg – das Heft bliebe so gross wie vorher');
    pruefe('Die Datei liegt genau einmal im Heft', nachImport.dateien === 1,
      nachImport.dateien + ' Eintraege – dieselbe Datei zweimal abgelegt');
    pruefe('Die erste Seite ist Seite 1', nachImport.ersteSeite === 1, String(nachImport.ersteSeite));
    pruefe('Sie hat A4-Breite', nachImport.breite === 794, String(nachImport.breite));
    pruefe('Der Text liegt unsichtbar darueber', nachImport.hatText, 'keine Folie – die Suche fände nichts');
    pruefe('Sie gilt nicht als leer', nachImport.leer === false, 'pageIsEmpty sagt leer');

    /* ── Anzeige ─────────────────────────────────────────────────── */
    abschnitt('Die Anzeige');
    const gezeichnet = JSON.parse(await js(`(async () => {
      openNotebook('nb-pdf');
      await new Promise(r => setTimeout(r, 1800));
      const pgEl = document.querySelector('.j-page');
      const c = pgEl && pgEl.querySelector('canvas.j-page-bgcanvas');
      const gebraucht = Math.round((getNb().pages[0].w || 794) * Math.min(getCanvasDpr(), 3));
      return JSON.stringify({
        hatFlaeche: !!c, punkte: c ? c.width : 0, gebraucht,
        keinBild: !pgEl.querySelector('img.j-page-bgimg')
      });
    })()`));

    pruefe('Die Seite hat eine Zeichenflaeche', gezeichnet.hatFlaeche, 'keine canvas.j-page-bgcanvas');
    pruefe('Und kein Bild daneben', gezeichnet.keinBild, 'es haengt noch ein img an der Seite');
    pruefe('Sie ist in der verlangten Feinheit gezeichnet',
      Math.abs(gezeichnet.punkte - gezeichnet.gebraucht) < 12,
      gezeichnet.punkte + ' Punkte statt ' + gezeichnet.gebraucht);
    /* >>> Der Kern der Sache <<<
       892 war die alte, fest eingebackene Zahl. Alles darunter hiesse,
       dass der Umbau nichts gebracht hat. */
    pruefe('Und damit schaerfer als die alten 892 Punkte', gezeichnet.punkte > 1200,
      'nur ' + gezeichnet.punkte + ' Punkte');

    /* ── Zoom ────────────────────────────────────────────────────── */
    abschnitt('Der Zoom');
    const nachZoom = JSON.parse(await js(`(async () => {
      const vorher = document.querySelector('canvas.j-page-bgcanvas').width;
      setZoom(2.4);
      await new Promise(r => setTimeout(r, 1500));
      const nachher = document.querySelector('canvas.j-page-bgcanvas').width;
      setZoom(1.2);
      await new Promise(r => setTimeout(r, 900));
      return JSON.stringify({ vorher, nachher });
    })()`));
    pruefe('Hineinzoomen zeichnet feiner statt aufzuziehen',
      nachZoom.nachher > nachZoom.vorher,
      nachZoom.vorher + ' -> ' + nachZoom.nachher + ' Punkte');

    /* ── Was hinausgeht ──────────────────────────────────────────── */
    abschnitt('Was das Heft verlaesst');
    const raus = JSON.parse(await js(`(async () => {
      const nb = getNb();
      const bild = await PdfSeiten.bild(nb, nb.pages[0], PdfSeiten.DRUCK_FEINHEIT);
      const img = new Image();
      await new Promise(r => { img.onload = r; img.src = bild; });

      const karte = await PdfSeiten.bilderFuer(nb, PdfSeiten.DRUCK_FEINHEIT);
      const wie = await PdfSeiten.materialisiere(nb);
      return JSON.stringify({
        druckBreite: img.naturalWidth,
        istJpeg: bild.startsWith('data:image/jpeg'),
        inDerKarte: karte.size,
        materialisiert: wie,
        habenJetztBild: nb.pages.filter(p => p.bgImg).length,
        dpi: Math.round(img.naturalWidth / (210 / 25.4))
      });
    })()`));

    pruefe('Der Ausdruck bekommt Druckaufloesung', raus.dpi >= 250, raus.dpi + ' dpi');
    pruefe('Als JPEG', raus.istJpeg, 'anderes Format');
    pruefe('Die Karte hat jede Seite', raus.inDerKarte === 4, String(raus.inDerKarte));
    pruefe('Fuer die Freigabe bekommt jede Seite ein Bild', raus.materialisiert === 4,
      String(raus.materialisiert));
    pruefe('Und traegt es danach', raus.habenJetztBild === 4, String(raus.habenJetztBild));

    /* ── Ältere Hefte ────────────────────────────────────────────── */
    abschnitt('Ein Heft aus der Zeit davor');
    const alteArt = JSON.parse(await js(`(async () => {
      // Ein Blatt, wie es der alte Import hinterlassen hat: nur ein Bild
      const nb = { id: 'nb-alt', name: 'Alt', sections: [], pages: [{
        id: 'p-alt', date: new Date().toISOString(), bg: 'blank',
        textContent: '', inkStrokes: [], objects: [],
        w: 794, h: 1179,
        bgImg: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
      }] };
      S.notebooks.push(nb);
      openNotebook('nb-alt');
      await new Promise(r => setTimeout(r, 1200));
      const pgEl = document.querySelector('.j-page');
      return JSON.stringify({
        hatBild: !!pgEl.querySelector('img.j-page-bgimg'),
        hatFlaeche: !!pgEl.querySelector('canvas.j-page-bgcanvas'),
        leer: pageIsEmpty(nb.pages[0])
      });
    })()`));
    pruefe('Sie wird weiterhin als Bild gezeigt', alteArt.hatBild, 'kein img mehr');
    pruefe('Und bekommt keine Zeichenflaeche', !alteArt.hatFlaeche, 'unnoetige canvas');
    pruefe('Sie gilt nicht als leer', alteArt.leer === false, 'pageIsEmpty sagt leer');

    await js(`openNotebook('nb-pdf'); 'ok'`);
    await warte(1200);

    /* ── Aufräumen ───────────────────────────────────────────────── */
    abschnitt('Was niemand mehr braucht');
    const aufgeraeumt = JSON.parse(await js(`(() => {
      const nb = getNb();
      const vorher = Object.keys(nb.pdfs || {}).length;
      nb.pages = [];
      PdfSeiten.raeumeAuf(nb);
      return JSON.stringify({ vorher, nachher: Object.keys(nb.pdfs || {}).length });
    })()`));
    pruefe('Ohne Seiten geht auch die Datei', aufgeraeumt.vorher === 1 && aufgeraeumt.nachher === 0,
      aufgeraeumt.vorher + ' -> ' + aufgeraeumt.nachher);

    abschnitt('Die Konsole');
    pruefe('Dabei faellt kein Fehler', konsole.length === 0, konsole.join(' | ').slice(0, 300));
  } catch (err) {
    pruefe('Durchlauf', false, String(err && err.message || err));
  }

  fertig();
});
