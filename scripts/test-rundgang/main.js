/* ══════════════════════════════════════════════════════════════════════
   EIN RUNDGANG DURCH DIE GANZE APP

   >>> Wozu das gut ist <<<
   Die anderen Prüfstände nehmen sich je eine Sache vor und prüfen sie
   genau. Was dabei niemandem auffällt, ist der Fehler, der beim blossen
   ÖFFNEN einer Ansicht auftritt: eine Funktion, die es nicht mehr gibt,
   ein Feld, das seit einer Umbenennung leer ist, ein Aufruf, der auf
   `null` zugreift. Solche Fehler landen in der Entwicklerkonsole, und
   die sieht im Alltag niemand an – die Oberfläche bleibt einfach stehen,
   ohne zu sagen, warum.

   Hier wird deshalb die ECHTE App geladen und der Reihe nach durch ihre
   Ansichten geschickt: Übersicht, Heft, jedes Werkzeug, jeder Dialog,
   Suche, Kommentare, Formeln, Tabellen, Ausdruck. Geprüft wird nicht,
   ob das Ergebnis stimmt – dafür sind die anderen Prüfstände da –,
   sondern nur, ob dabei ein Fehler fällt.

   Alles, was in `window.onerror`, `unhandledrejection` oder als
   Konsolenfehler auftaucht, gilt als Durchfall.

   Läuft NICHT in `npm test` – braucht Electron.
   Aufruf:  npm run test:rundgang
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
app.disableHardwareAcceleration();

/* Die Handler des echten main.js gibt es hier nicht. Ohne Attrappen
   klagt die App beim Laden, und der Bericht geht im Rauschen unter.

   Ein Speicherort MUSS dabeisein: ohne ihn bricht jedes Sichern mit
   "Kein Speicherort festgelegt" ab, und dieser eine Fehler überdeckt
   dann jeden echten. Geschrieben wird trotzdem nichts – 'save-to-path'
   ist weiter eine Attrappe. */
const ABLAGE = path.join(app.getPath('temp'), 'inkwells-rundgang');

const ATTRAPPEN = {
  'load-settings': { saveLocation: ABLAGE }, 'save-settings': true,
  'load-registry': { notebooks: [] }, 'save-registry': true,
  'get-default-save-path': ABLAGE, 'check-internet': false,
  'get-pending-deep-link': null, 'get-pending-share-link': null, 'pick-folder': null,
  'get-app-version': '1.1.1', 'load': null, 'pick-files': [],
  'pick-document': null, 'load-from-path': null, 'file-exists': false,
  'delete-file': { success: true }, 'move-file': { success: true },
  'save-to-path': { success: true }, 'save': { success: true },
  'export-pdf': { success: true }, 'save-binary': { success: true },
  'postfach-lesen': null, 'postfach-schreiben': true, 'check-update': null,
  'erst-start': false, 'load-postfach': null, 'save-postfach': true,
  'get-locale': 'de', 'ist-storefassung': false
};
for (const [kanal, wert] of Object.entries(ATTRAPPEN)) {
  ipcMain.handle(kanal, async () => (typeof wert === 'object' && wert !== null ? JSON.parse(JSON.stringify(wert)) : wert));
}
ipcMain.on('silent-auth', () => {});
ipcMain.on('win-min', () => {});
ipcMain.on('win-max', () => {});
ipcMain.on('win-close', () => {});

const zeilen = [];
const abschnitt = (name) => { zeilen.push(''); zeilen.push(name); };
const pruefe = (was, ok, hinweis) =>
  zeilen.push((ok ? 'ok   ' : 'FEHL ') + was + (ok ? '' : '  -> ' + hinweis));

function fertig(code) {
  process.stdout.write('\nEin Rundgang durch die ganze App\n');
  process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');
  const fehl = zeilen.filter(l => /^(FEHL|ABBRUCH)/.test(l)).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : code);
}

setTimeout(() => { zeilen.push('ABBRUCH: Zeitgrenze erreicht'); fertig(2); }, 180000);

const warte = ms => new Promise(r => setTimeout(r, ms));

app.on('ready', async () => {
  try {
    const win = new BrowserWindow({
      width: 1440, height: 940, show: false, backgroundColor: '#12121a',
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
    });

    /* Konsolenfehler des Renderers einsammeln. Level 3 ist "error".
       Was hier ankommt, ist genau das, was im Alltag niemand sieht. */
    const konsole = [];
    win.webContents.on('console-message', (...args) => {
      /* Electron hat die Form dieses Ereignisses gewechselt: früher fünf
         Einzelwerte, jetzt ein Ereignisobjekt. Beides annehmen, sonst
         sammelt der Prüfstand still gar nichts ein. */
      let level, message, line, sourceId;
      if (args.length && args[0] && typeof args[0] === 'object' && 'message' in args[0]) {
        ({ level, message, lineNumber: line, sourceId } = args[0]);
      } else {
        [, level, message, line, sourceId] = args;
      }
      const schwer = level === 3 || level === 'error' || level === 'warning' && false;
      if (schwer) konsole.push(message + '  (' + String(sourceId || '').split('/').pop() + ':' + line + ')');
    });

    await win.loadFile(path.join(ROOT, 'src', 'index.html'));
    await warte(2500);

    const js = (code) => win.webContents.executeJavaScript(code);

    // Eigener Fehlerspeicher im Renderer
    await js(`
      window.__fehler = [];
      window.addEventListener('error', ev => window.__fehler.push(
        'onerror: ' + (ev.message || '') + ' @ ' + String(ev.filename || '').split('/').pop() + ':' + ev.lineno));
      window.addEventListener('unhandledrejection', ev => window.__fehler.push(
        'unhandled: ' + (ev.reason && (ev.reason.stack || ev.reason.message) || String(ev.reason))));
      true`);

    /* Jeder Schritt wird einzeln gefahren. Was er wirft, gehört zu ihm –
       sonst steht am Ende ein Fehler ohne Ort. */
    async function schritt(name, code, pause = 260) {
      const vorher = konsole.length;
      let r;
      try {
        r = await js(`(async () => { try { ${code} ; return 'ok'; }
                       catch (e) { return 'WURF: ' + (e && (e.stack || e.message) || e); } })()`);
      } catch (e) {
        r = 'WURF (aussen): ' + (e && e.message || e);
      }
      await warte(pause);
      const neu = konsole.slice(vorher);
      const rendererFehler = await js('window.__fehler.splice(0)');
      const probleme = [];
      if (r !== 'ok') probleme.push(String(r));
      for (const k of neu) probleme.push('Konsole: ' + k);
      for (const f of rendererFehler) probleme.push(String(f));
      pruefe(name, probleme.length === 0, probleme.join(' | ').slice(0, 400));
    }

    /* ── Start und Übersicht ──────────────────────────────────────── */
    abschnitt('Der Start');
    const gestartet = await js(`typeof S !== 'undefined' && typeof CFG !== 'undefined' && typeof openNotebook === 'function'`);
    pruefe('Die App ist hochgefahren', gestartet, 'S/CFG/openNotebook fehlen');
    if (!gestartet) {
      const lage = await js(`JSON.stringify({
        S: typeof S, CFG: typeof CFG,
        openNotebook: typeof window.openNotebook,
        skripte: [...document.scripts].length,
        fehler: (window.__fehler || []).slice(0, 8)
      })`);
      zeilen.push('     Lage: ' + lage);
      for (const k of konsole) zeilen.push('     Konsole: ' + k);
      fertig(1); return;
    }

    const startFehler = await js('window.__fehler.splice(0)');
    pruefe('Beim Hochfahren fällt kein Fehler',
      startFehler.length === 0 && konsole.length === 0,
      [...startFehler, ...konsole].join(' | ').slice(0, 400));
    konsole.length = 0;

    await schritt('Die Übersicht zeichnet sich', 'renderHomeGrid()');
    await schritt('Der Heft-Dialog geht auf', 'openNbModal()');
    await schritt('...und wieder zu', `document.querySelectorAll('.modal-overlay,.overlay').forEach(o => o.style.display='none')`);

    /* ── Ein Heft mit Inhalt ──────────────────────────────────────── */
    abschnitt('Ein Heft aufmachen');
    await schritt('Ein Heft entsteht und geht auf', `
      const nb = { id: 'probe', name: 'Probe', color: '#c8a96e', defaultBg: 'ruled',
                   pages: [makePage('ruled'), makePage('grid'), makePage('blank')],
                   sections: [], created: Date.now() };
      S.notebooks = [nb];
      openNotebook('probe');`, 900);

    await schritt('Es steht Text auf der ersten Seite', `
      const nb = getNb();
      const pg = nb.pages[0];
      pg.textContent = '<h1>Überschrift</h1><p>Ein Satz mit <b>fett</b> und <i>kursiv</i>.</p><ul><li>eins</li><li>zwei</li></ul>';
      openSection(null);`, 700);

    await schritt('Die Seitenleiste zeichnet ihren Baum', 'renderSideTree()');
    await schritt('Die Wortzählung rechnet', `typeof updateWordCount === 'function' && updateWordCount()`);

    /* ── Jedes Werkzeug einmal ────────────────────────────────────── */
    abschnitt('Die Werkzeuge');
    for (const m of ['cursor', 'pen1', 'pen2', 'highlighter', 'eraser', 'lasso', 'shape', 'text']) {
      await schritt('Werkzeug ' + m, `switchMode('${m}')`, 140);
    }
    await schritt('Zurück zum Zeiger', `switchMode('cursor')`);

    /* ── Rückgängig und Wiederholen ───────────────────────────────── */
    abschnitt('Rückgängig');
    await schritt('Ein Schritt wird gemerkt', `pushPageHistory(getNb().pages[0])`);
    await schritt('Rückgängig läuft', 'undoPage()', 400);
    await schritt('Wiederholen läuft', 'redoPage()', 400);

    /* ── Zoom und Lineal ──────────────────────────────────────────── */
    abschnitt('Zoom und Lineal');
    await schritt('Größer', `typeof setZoom === 'function' ? setZoom(1.4) : zoomIn()`);
    await schritt('Kleiner', `typeof setZoom === 'function' ? setZoom(0.8) : zoomOut()`);
    await schritt('Wieder normal', `typeof setZoom === 'function' ? setZoom(1) : true`);

    /* ── Objekte, Formeln, Tabellen ───────────────────────────────── */
    abschnitt('Was auf dem Blatt liegen kann');
    await schritt('Ein Bild als Objekt', `
      const pg = getNb().pages[0];
      const bild = { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', w: 100, h: 80 };
      setzeBildObjekt(pg, bild, 200);`);
    await schritt('Eine Tabelle', `typeof insertTable === 'function' ? insertTable(2, 2) : 'ok'`);
    await schritt('Eine Formel wird vermessen', `
      typeof measureFormula === 'function' ? JSON.stringify(measureFormula('x^2 + y^2')) : 'ok'`);

    /* ── Dialoge und Ansichten ────────────────────────────────────── */
    abschnitt('Die Dialoge');
    const dialoge = [
      ['Einstellungen', `typeof openSettings === 'function' && openSettings()`],
      ['Suche im Heft', `typeof openNbSearch === 'function' && openNbSearch()`],
      ['Suche zu', `typeof closeNbSearch === 'function' && closeNbSearch()`],
      ['Kommentare', `typeof renderComments === 'function' && renderComments()`],
      ['Papierkorb', `typeof openTrash === 'function' ? openTrash() : 'ok'`],
      ['Versionen', `typeof openVersions === 'function' ? openVersions() : 'ok'`],
      ['Postfach', `typeof oeffnePostfach === 'function' ? oeffnePostfach() : 'ok'`],
      ['Ausgabe-Dialog', `typeof openExportModal === 'function' ? openExportModal() : 'ok'`],
      ['Freigabe-Dialog', `typeof openShareModal === 'function' ? openShareModal() : 'ok'`]
    ];
    for (const [name, code] of dialoge) {
      await schritt(name, code, 320);
      await js(`document.querySelectorAll('.modal-overlay,.overlay').forEach(o => { o.style.display='none'; })`);
    }

    /* ── Ausgabe ──────────────────────────────────────────────────── */
    abschnitt('Ausgeben');
    await schritt('Ein PDF wird gebaut', `
      const nb = getNb();
      const html = buildPdf(nb, {});
      if (!html || html.length < 200) throw new Error('PDF-HTML ist leer');`, 700);
    await schritt('Die Seitenliste stimmt', `
      const liste = exportPageList(getNb());
      if (!Array.isArray(liste) || !liste.length) throw new Error('leere Seitenliste');`);
    await schritt('Ein Word-Dokument entsteht', `
      if (typeof buildDocx === 'function') {
        const b = await buildDocx(getNb(), {});
        if (!b) throw new Error('kein Ergebnis');
      }`, 900);

    /* ── Sprachen ─────────────────────────────────────────────────── */
    abschnitt('Die Sprachen');
    await schritt('Auf Englisch', `typeof setLanguage === 'function' ? setLanguage('en') : 'ok'`, 500);
    await schritt('Und zurück', `typeof setLanguage === 'function' ? setLanguage('de') : 'ok'`, 500);

    /* ── Handschrift ──────────────────────────────────────────────── */
    abschnitt('Die Handschrift');
    await schritt('Ein Strich landet auf der Seite', `
      const pg = getNb().pages[0];
      S.strokeHistory[pg.id] = S.strokeHistory[pg.id] || [];
      S.strokeHistory[pg.id].push({
        id: uid(), tool: 'pen', color: '#222', size: 2.5,
        points: [[100, 300], [140, 320], [180, 300], [220, 340]]
      });
      pg.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[pg.id]));
      if (typeof redrawPage === 'function') redrawPage(pg.id);`);
    await schritt('Die Handschrift wird zum Bild', `
      const bild = renderInkToDataUrl(getNb().pages[0]);
      if (bild && bild.slice(0, 11) !== 'data:image/') throw new Error('kein Bild: ' + String(bild).slice(0, 40));`);

    /* ── Seiten hinzufügen, verschieben, löschen ──────────────────── */
    abschnitt('Die Seiten');
    await schritt('Eine Seite kommt dazu', `
      const nb = getNb();
      const vorher = nb.pages.length;
      nb.pages.push(makePage('ruled'));
      openSection(null);
      if (getNb().pages.length !== vorher + 1) throw new Error('Seite fehlt');`, 500);
    await schritt('Eine leere Seite wird erkannt', `
      if (typeof pageIsVisuallyEmpty === 'function' &&
          !pageIsVisuallyEmpty(getNb().pages[getNb().pages.length - 1]))
        throw new Error('frische Seite gilt als voll');`);
    await schritt('Ein Seitenbereich wird gelesen', `
      const r = parsePageRange('1-2, 4', 5);
      if (!(r instanceof Set) || r.size !== 3) throw new Error('Bereich stimmt nicht: ' + JSON.stringify([...(r || [])]));
      if (parsePageRange('Unsinn', 5) !== null) throw new Error('Unsinn wurde angenommen');
      if (parsePageRange('4-2', 5).size !== 3) throw new Error('verdrehter Bereich falsch');`);

    /* ── Kommentare und Verweise ──────────────────────────────────── */
    abschnitt('Kommentare und Verweise');
    await schritt('Ein Kommentar entsteht', `
      if (typeof Comments === 'object' && Comments && typeof Comments.add === 'function') {
        Comments.add(getNb().pages[0].id, { text: 'Eine Bemerkung' });
      }`);
    await schritt('Der Text wird gesäubert', `
      const dreck = '<p onclick="boese()">gut</p><script>boese()<\\/script><a href="javascript:x">z</a>';
      const rein = sanitizePageHtml(dreck);
      if (/onclick|<script|javascript:/i.test(rein)) throw new Error('Dreck blieb drin: ' + rein);`);
    await schritt('Ein echter Verweis bleibt stehen', `
      const rein = sanitizePageHtml('<a href="https://example.org">hin</a>');
      if (!/href="https:\\/\\/example\\.org"/.test(rein)) throw new Error('Verweis weg: ' + rein);`);

    /* ── Was geändert wurde, muss auch gemerkt werden ─────────────── */
    /* Gespeichert wird NUR, was AutoSave als schmutzig kennt: jeder Weg
       (Takt, Heimknopf, Titelleiste) fragt vorher isDirty(). Wer eine
       Änderung schreibt, ohne das zu melden, verliert sie beim
       Zumachen – ohne Fehlermeldung. */
    abschnitt('Änderungen werden gemerkt');
    await schritt('Ein anderes Papier merkt sich das Heft', `
      const nb = getNb();
      AutoSave.markClean(nb.id);
      const pg = nb.pages[0];
      const vorher = pg.bg;

      // Genau der Weg des Nutzers: Menü der Seite, Papier wählen, OK
      const pgEl = document.querySelector('[data-pgid="' + pg.id + '"]');
      if (!pgEl) throw new Error('Seite nicht im Baum');
      showPgCtxMenu(300, 300, pg, pgEl);
      await new Promise(r => setTimeout(r, 120));
      E('pgctx-bg').click();
      await new Promise(r => setTimeout(r, 120));

      // Ein anderes Papier als das jetzige anklicken
      const knoepfe = [...E('pg-bg-picker-row').querySelectorAll('.bg-sw')];
      if (!knoepfe.length) throw new Error('die Papierauswahl ist leer');
      const ander = knoepfe.find(b => b.dataset.id && b.dataset.id !== vorher);
      if (!ander) throw new Error('keine zweite Papierart gefunden');
      ander.click();
      await new Promise(r => setTimeout(r, 80));
      E('pg-bg-ok').click();
      await new Promise(r => setTimeout(r, 200));

      if (pg.bg === vorher) throw new Error('Das Papier hat sich gar nicht geändert');
      if (!AutoSave.isDirty(nb.id))
        throw new Error('Papier von "' + vorher + '" auf "' + pg.bg + '" geändert, aber das Heft gilt als gespeichert - die Änderung geht beim Zumachen verloren');`, 600);

    /* ── Ein Heft als Datei und zurück ────────────────────────────── */
    abschnitt('Ein Heft als Datei');
    await schritt('Es lässt sich schreiben und wieder lesen', `
      const nb = getNb();
      const text = JSON.stringify({ notebooks: [nb] });
      const zurueck = JSON.parse(text);
      if (!zurueck.notebooks[0].pages.length) throw new Error('Seiten weg');
      const leer = { id: 'ausdatei', name: 'Aus Datei', pages: [], sections: [] };
      fillNotebookFromJrnl(leer, text);
      if (!leer.pages.length) throw new Error('fillNotebookFromJrnl gab nichts zurück');`, 500);

    /* ── Zurück zur Übersicht ─────────────────────────────────────── */
    abschnitt('Der Rückweg');
    await schritt('Zurück zur Übersicht', 'showHome()', 700);
    await schritt('Und nochmal hinein', `openNotebook('probe')`, 700);

    /* Was zum Schluss noch in der Konsole steht, gehört zu keinem
       einzelnen Schritt - meist ein verspäteter Netzfehler. */
    await warte(1200);
    const rest = await js('window.__fehler.splice(0)');
    pruefe('Danach bleibt es still', rest.length === 0 && konsole.length === 0,
      [...rest, ...konsole].join(' | ').slice(0, 500));

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH: ' + (err && err.stack || err));
    fertig(2);
  }
});
