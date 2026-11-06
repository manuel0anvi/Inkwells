/* ══════════════════════════════════════════════════════════════════════
   WAS IM PDF ANKOMMT

   Drei Dinge, die der Ausdruck lange still weggelassen oder verstellt
   hat:

     · FORMEN UND FORMELN. buildPdfPage gab jedes Objekt als <img src=…>
       aus. Eine Form ist aber ein SVG und eine Formel KaTeX-Auszeichnung
       – beide haben kein src und fielen durch ein `if (!obj.src)
       continue;`. Das Rechteck um die wichtige Stelle, der Pfeil im
       Diagramm, die Gleichung: alles weg, ohne einen Hinweis.

     · DIE SEITENGROESSE. @page trug fest A4 und printToPDF ebenfalls.
       Eine Querformatfolie wurde auf die Breite eines Hochformatblattes
       geschrumpft, mit einer grossen leeren Flaeche darunter.

     · DIE SEITENZAHLEN. exportPageList wirft leere Seiten heraus, behaelt
       in pageNo aber die Nummer aus dem vollstaendigen Heft. Der
       Exportdialog rechnete trotzdem mit dem Platz in der gefilterten
       Liste.

   Geprueft wird am ECHTEN Weg: das HTML kommt aus buildPdf, und daraus
   macht printToPDF ein wirkliches PDF, dessen MediaBox mit pdf.js
   nachgemessen wird. Ein reiner Textvergleich wuerde die Seitengroesse
   gar nicht erfassen – dort entscheidet Chromium.

   Laeuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:pdfexport
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
require('../stabile-fenster.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.disableHardwareAcceleration();

const zeilen = [];
let fehler = 0;
function pruefe(was, bedingung, hinweis) {
  zeilen.push((bedingung ? 'ok   ' : 'FEHL ') + was + (bedingung ? '' : '  -> ' + hinweis));
  if (!bedingung) fehler++;
}
function abschnitt(name) { zeilen.push(''); zeilen.push(name); }

/** Dasselbe wie der Hauptprozess der App: KaTeX-Stil mit Schriften. */
function katexStil() {
  try {
    const cssPfad = path.join(__dirname, '..', '..', 'src', 'lib', 'katex.min.css');
    let css = fs.readFileSync(cssPfad, 'utf-8');
    css = css.replace(/,\s*url\([^)]*\)\s*format\((['"])(woff|truetype|opentype)\1\)/g, '');
    const ordner = path.dirname(cssPfad);
    css = css.replace(/url\((['"]?)(fonts\/[^)'"]+)\1\)/g, (ganz, _q, rel) => {
      try {
        return 'url(data:font/woff2;base64,'
          + fs.readFileSync(path.join(ordner, rel)).toString('base64') + ')';
      } catch (err) { return ganz; }
    });
    return css;
  } catch (err) {
    return '';
  }
}

/** Das erzeugte PDF nachmessen – Seitenzahl und Blattmasse. */
async function messePdf(win, pdfPfad) {
  const daten = fs.readFileSync(pdfPfad).toString('base64');
  return win.webContents.executeJavaScript(`(async () => {
    const roh = atob(${JSON.stringify(daten)});
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const blaetter = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const s = await doc.getPage(n);
      const v = s.getViewport({ scale: 1 });
      blaetter.push({ b: Math.round(v.width), h: Math.round(v.height) });
    }
    return { seiten: doc.numPages, blaetter };
  })()`);
}

app.on('ready', () => {
  const win = new BrowserWindow({ width: 900, height: 700, show: false });

  win.webContents.on('console-message', (_e, level, message) => {
    // Die Sicherheitswarnung von Electron gilt dem Testfenster, nicht dem Code
    if (/Electron Security Warning/.test(message)) return;
    if (level >= 2) { zeilen.push('FEHL Konsole: ' + message); fehler++; }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    zeilen.push('FEHL Laden fehlgeschlagen: ' + code + ' ' + desc + ' ' + url);
    fehler++;
  });

  win.loadFile(path.join(__dirname, 'page.html'));

  win.webContents.once('did-finish-load', async () => {
    try {
      const stil = katexStil();
      pruefe('der KaTeX-Stil traegt eingebettete Schriften',
        /url\(data:font\/woff2;base64,/.test(stil), 'keine gefunden');

      const html = await win.webContents.executeJavaScript(
        'window.__baueHtml(' + JSON.stringify(stil) + ')');

      abschnitt('Formen und Formeln stehen im Dokument');
      pruefe('die Form ist als SVG da', /<svg/i.test(html), 'kein svg');
      pruefe('und in ihrem eigenen Kasten', /obj-shape/.test(html), 'keine Klasse');
      pruefe('die Formel ist da', /j-formula-obj/.test(html), 'nicht gefunden');
      pruefe('mit KaTeX-Auszeichnung darin', /class="katex/.test(html), 'nur Rohtext');
      pruefe('der Stil fuer die Formel steht im Kopf',
        html.indexOf('KaTeX_Main') > -1, 'fehlt');
      pruefe('das Bild kommt weiterhin als <img>', /<img class="obj"/.test(html), 'weg');
      pruefe('der Codekasten ebenfalls', /j-code-obj/.test(html), 'weg');

      abschnitt('Jedes Mass bekommt seine eigene Druckseite');
      pruefe('es gibt eine benannte Regel', /@page fmt1 \{ size: \d+px \d+px/.test(html),
        html.slice(html.indexOf('@page'), html.indexOf('@page') + 120));
      pruefe('und eine zweite fuers Querformat', /@page fmt2 \{ size: \d+px \d+px/.test(html),
        'nur eine');
      pruefe('die Seiten verweisen darauf',
        /class="pg bg-\w+ fmt1"/.test(html) && /class="pg bg-\w+ fmt2"/.test(html),
        'keine Verweise');

      /* Und jetzt der Ernstfall: ein wirkliches PDF, gedruckt mit genau
         den Einstellungen aus main.js. */
      abschnitt('Das erzeugte PDF');

      const tmpHtml = path.join(os.tmpdir(), 'inkwells-pruef-export-' + Date.now() + '.html');
      const tmpPdf = tmpHtml.replace(/\.html$/, '.pdf');
      fs.writeFileSync(tmpHtml, html, 'utf-8');

      const druck = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
      try {
        await druck.loadFile(tmpHtml);
        await druck.webContents.executeJavaScript(`(async () => {
          await Promise.all(Array.from(document.images).map(i => i.complete
            ? Promise.resolve() : new Promise(r => { i.onload = r; i.onerror = r; })));
          try { await document.fonts.ready; } catch (e) {}
        })()`);
        await new Promise(r => setTimeout(r, 300));

        const buf = await druck.webContents.printToPDF({
          printBackground: true, pageSize: 'A4', preferCSSPageSize: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 }
        });
        fs.writeFileSync(tmpPdf, buf);
      } finally {
        if (!druck.isDestroyed()) druck.close();
      }

      const mass = await messePdf(win, tmpPdf);

      pruefe('drei Seiten sind im PDF', mass.seiten === 3, 'gezaehlt: ' + mass.seiten);

      /* Die leere Seite 2 faellt aus dem Export heraus – im PDF ist die
         Querformatfolie deshalb das ZWEITE Blatt, nicht das dritte. */
      const hoch = mass.blaetter[0];
      const quer = mass.blaetter[1];
      const letztes = mass.blaetter[2];
      pruefe('das gewoehnliche Blatt steht hochkant',
        hoch && hoch.h > hoch.b, JSON.stringify(hoch));
      pruefe('die Querformatfolie liegt quer',
        quer && quer.b > quer.h, JSON.stringify(quer));
      pruefe('und sie ist wirklich breiter als das Hochformat',
        quer && hoch && quer.b > hoch.b,
        JSON.stringify({ quer: quer && quer.b, hoch: hoch && hoch.b }));
      pruefe('das Blatt danach steht wieder hochkant – gemischt geht',
        letztes && letztes.h > letztes.b, JSON.stringify(letztes));

      try { fs.unlinkSync(tmpHtml); } catch (e) {}
      try { fs.unlinkSync(tmpPdf); } catch (e) {}

      abschnitt('Der Exportdialog zaehlt wie das Heft');
      const bereich = await win.webContents.executeJavaScript('window.__bereichsProbe()');
      pruefe('Seite 3 des Hefts heisst im Dialog auch 3',
        bereich.hinweisNummer === 3, String(bereich.hinweisNummer));
      pruefe('und der Bereich "3" waehlt sie aus',
        JSON.stringify(bereich.bereich3) === JSON.stringify([3]),
        JSON.stringify(bereich.bereich3));
      pruefe('waehrend "2" nichts trifft – Seite 2 ist leer',
        bereich.bereich2 === null || JSON.stringify(bereich.bereich2) === '[]',
        JSON.stringify(bereich.bereich2));
    } catch (err) {
      zeilen.push('ABBRUCH ' + (err && err.message ? err.message : String(err)));
      fehler++;
    }

    process.stdout.write('\nPDF-Export\n');
    process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');

    if (fehler) {
      process.stdout.write('\n' + fehler + ' Prüfung(en) fehlgeschlagen.\n');
      app.exit(1);
      return;
    }
    process.stdout.write('\nAlle Prüfungen bestanden.\n');
    app.exit(0);
  });
});
