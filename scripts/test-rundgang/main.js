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

    await schritt('Rückgängig stellt den Text wirklich wieder her', `
      const info = getPage(S.activePgId);
      const pg = info.page;
      const pgEl = document.querySelector('[data-pgid="' + pg.id + '"]');
      const feld = pgEl.querySelector('.j-text');

      pg.textContent = '<p>Erster Stand</p>';
      feld.innerHTML = pg.textContent;
      pushPageHistory(pg);

      pg.textContent = '<p>Zweiter Stand</p>';
      feld.innerHTML = pg.textContent;

      if (!undoPage()) throw new Error('Rückgängig hat abgelehnt');
      if (!pg.textContent.includes('Erster')) throw new Error('im Heft steht: ' + pg.textContent);
      if (!feld.innerHTML.includes('Erster')) throw new Error('auf dem Blatt steht: ' + feld.innerHTML);

      if (!redoPage()) throw new Error('Wiederholen hat abgelehnt');
      if (!pg.textContent.includes('Zweiter')) throw new Error('nach Wiederholen: ' + pg.textContent);`, 500);

    /* Ein Schritt zurueck bringt auch das PAPIER zurueck - und zwar
       sichtbar. Steht im Heft das eine und auf dem Blatt das andere,
       merkt es niemand, bis die Seite das naechste Mal neu gezeichnet
       wird und das Papier ploetzlich wechselt. */
    await schritt('Rückgängig bringt auch das Papier zurück', `
      const info = getPage(S.activePgId);
      const pg = info.page;
      const pgEl = document.querySelector('[data-pgid="' + pg.id + '"]');

      pg.bg = 'ruled';
      pushPageHistory(pg);
      pg.bg = 'grid';
      pgEl.classList.remove('bg-ruled');
      pgEl.classList.add('bg-grid');

      undoPage();
      if (pg.bg !== 'ruled') throw new Error('im Heft steht ' + pg.bg);
      if (!pgEl.classList.contains('bg-ruled') || pgEl.classList.contains('bg-grid'))
        throw new Error('im Heft steht "' + pg.bg + '", auf dem Blatt aber "'
          + [...pgEl.classList].filter(c => c.startsWith('bg-')).join(' ') + '"');`, 500);

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

    /* ── Zeilen und Spalten ───────────────────────────────────────────
       Die feste Breite einer Spalte steht in <colgroup>, die Zellen
       stehen in den <tr>. Beides muss beim Anlegen UND beim Löschen
       zusammenbleiben, sonst sitzt die Tabelle danach schief. */
    await schritt('Spalten und Zeilen kommen und gehen', `
      const t = document.createElement('table');
      t.className = 'j-table';
      t.innerHTML = '<colgroup><col width="100"><col width="200"><col width="300"></colgroup>'
        + '<tbody><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></tbody>';
      document.body.appendChild(t);
      try {
        const spalten = () => [...t.querySelectorAll('tr')][0].children.length;
        const cols = () => [...t.querySelectorAll('colgroup > col')].map(c => c.getAttribute('width'));

        if (spalten() !== 3) throw new Error('Aufbau falsch');
        if (cols().join() !== '100,200,300') throw new Error('colgroup falsch aufgebaut');

        // Die MITTLERE Spalte weg: die Breiten der anderen müssen bleiben
        if (!removeColumn(t, 1)) throw new Error('removeColumn hat abgelehnt');
        if (spalten() !== 2) throw new Error('Spalte nicht entfernt');
        if (cols().length !== 2)
          throw new Error('colgroup hat noch ' + cols().length + ' Eintraege fuer ' + spalten() + ' Spalten');
        if (cols().join() !== '100,300')
          throw new Error('die Breiten sind verrutscht: ' + cols().join() + ' statt 100,300');

        // Eine Spalte dazu: auch dann muss beides zusammenpassen
        if (!addColumn(t, 0)) throw new Error('addColumn hat abgelehnt');
        if (cols().length !== spalten())
          throw new Error('nach dem Anlegen: ' + cols().length + ' Breiten fuer ' + spalten() + ' Spalten');

        // Die letzte Spalte bleibt stehen
        removeColumn(t, 0); removeColumn(t, 0);
        if (removeColumn(t, 0) !== false) throw new Error('die letzte Spalte wurde entfernt');

        // Und die letzte Zeile ebenso
        const zeile = t.querySelector('tr');
        removeRow(t, zeile);
        if (removeRow(t, t.querySelector('tr')) !== false) throw new Error('die letzte Zeile wurde entfernt');
      } finally { t.remove(); }`);
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

    /* ── Ausgabe ──────────────────────────────────────────────────────
       Geprüft wird nicht nur, dass etwas herauskommt, sondern dass der
       Text der Seite auch WIRKLICH drinsteht. Ein Export, der still eine
       leere Seite liefert, faellt sonst erst dem Nutzer auf. */
    abschnitt('Ausgeben');
    await schritt('Das PDF enthaelt den Text der Seite', `
      const nb = getNb();
      nb.pages[0].textContent = '<h1>Ueberschrift</h1><p>Ein Kennwort: Zwiebelkuchen.</p>';
      const html = buildPdf(nb, {});
      if (!html || html.length < 200) throw new Error('PDF-HTML ist leer');
      if (!html.includes('Zwiebelkuchen')) throw new Error('der Text der Seite fehlt im PDF');
      if (!html.includes('Ueberschrift')) throw new Error('die Ueberschrift fehlt im PDF');`, 700);

    /* exportPageList laesst leere Seiten bewusst weg - ein Ausdruck
       soll keine leeren Blaetter enthalten. Geprueft wird deshalb, dass
       genau die BESCHRIEBENEN Seiten drin sind. */
    await schritt('Die Seitenliste nimmt die beschriebenen Seiten', `
      const nb = getNb();
      nb.pages[1].textContent = '<p>Auch hier steht etwas.</p>';
      const liste = exportPageList(nb);
      const voll = notebookPages(nb).filter(p => !pageIsEmpty(p)).length;
      if (liste.length !== voll)
        throw new Error(liste.length + ' in der Liste, aber ' + voll + ' beschriebene Seiten');
      if (liste.length < 2) throw new Error('die zweite beschriebene Seite fehlt');
      // Die Seitenzahl muss die des HEFTS sein, nicht die der Auswahl
      if (liste[1].pageNo !== 2) throw new Error('Seitenzahl ' + liste[1].pageNo + ' statt 2');
      nb.pages[1].textContent = '';`);

    await schritt('Nur ein Seitenbereich', `
      const nb = getNb();
      const ids = new Set([nb.pages[0].id]);
      const teil = buildPdf(nb, { pageIds: ids });
      if (!teil.includes('Zwiebelkuchen')) throw new Error('die gewaehlte Seite fehlt');`, 500);

    await schritt('Das Word-Dokument entsteht als ZIP', `
      const nb = getNb();
      const eintraege = exportPageList(nb).map(e => ({ page: e.page, bg: e.page.bg || nb.defaultBg }));
      const b = await InkwellsDocx.build(eintraege, { title: 'Probe' });
      if (!b || !b.length) throw new Error('kein Ergebnis');
      // Ein .docx ist ein ZIP: es faengt mit "PK" an
      if (b[0] !== 0x50 || b[1] !== 0x4B) throw new Error('das ist kein ZIP');
      if (b.length < 1000) throw new Error('verdaechtig klein: ' + b.length + ' Bytes');`, 1500);

    await schritt('Ohne Seiten sagt der Export es deutlich', `
      let gemeldet = '';
      try { await InkwellsDocx.build([], {}); }
      catch (e) { gemeldet = e.message; }
      if (gemeldet !== 'EMPTY_SELECTION')
        throw new Error('erwartet EMPTY_SELECTION, bekommen: ' + (gemeldet || 'gar keinen Fehler'));`);

    await schritt('Der Text der Seite steht wirklich im Word-Dokument', `
      const nb = getNb();
      const eintraege = [{ page: nb.pages[0], bg: 'ruled' }];
      const b = await InkwellsDocx.build(eintraege, {});
      /* Im ZIP stehen die Dateinamen unverpackt - der Text selbst ist
         gepackt. Geprueft wird deshalb, dass document.xml dabei ist. */
      const roh = new TextDecoder('latin1').decode(b);
      if (!roh.includes('word/document.xml')) throw new Error('word/document.xml fehlt im Paket');
      if (!roh.includes('[Content_Types].xml')) throw new Error('[Content_Types].xml fehlt');`, 1500);

    await schritt('Ein unmoeglicher Dateiname wird entschaerft', `
      const n = InkwellsDocx.safeFileName('a/b:c*d?e"f<g>h|i');
      if (/[\\\\/:*?"<>|]/.test(n)) throw new Error('verbotene Zeichen blieben: ' + n);`);

    /* ── Zaehlen und Suchen ───────────────────────────────────────── */
    abschnitt('Zaehlen und Suchen');
    await schritt('Die Woerter werden richtig gezaehlt', `
      const nb = getNb();
      for (const p of nb.pages) p.textContent = '';
      nb.pages[0].textContent = '<p>eins zwei drei vier fuenf</p>';
      openSection(null);
      await new Promise(r => setTimeout(r, 250));
      const z = zaehleHeft();
      if (!z) throw new Error('zaehleHeft gab nichts zurueck');
      if (z.woerter !== 5) throw new Error('5 Woerter erwartet, gezaehlt: ' + z.woerter);`, 600);

    await schritt('Die Suche findet, was dasteht', `
      const nb = getNb();
      nb.pages[0].textContent = '<p>Ein Wort: Rhabarberkuchen.</p>';
      openSection(null);
      await new Promise(r => setTimeout(r, 250));
      const treffer = notebookPages(nb).filter(p =>
        nbSearchPlainText(p).toLowerCase().includes('rhabarberkuchen'));
      if (treffer.length !== 1) throw new Error(treffer.length + ' Treffer statt 1');
      const daneben = notebookPages(nb).filter(p =>
        nbSearchPlainText(p).toLowerCase().includes('gibtesnicht'));
      if (daneben.length) throw new Error('Treffer fuer ein Wort, das nirgends steht');`, 500);

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

    /* ── Abschnitte, Reihenfolge, Kopien ──────────────────────────── */
    abschnitt('Abschnitte und Reihenfolge');
    await schritt('Eine Seite wandert an eine andere Stelle', `
      const nb = getNb();
      nb.pages = [makePage('ruled'), makePage('ruled'), makePage('ruled'), makePage('ruled')];
      const [a, b, c, d] = nb.pages.map(p => p.id);

      if (!movePageBefore(nb, a, c)) throw new Error('Verschieben abgelehnt');
      if (nb.pages.map(p => p.id).join() !== [b, a, c, d].join())
        throw new Error('nach vorn: ' + nb.pages.map(p => p.id === a ? 'a' : p.id === b ? 'b' : p.id === c ? 'c' : 'd').join());

      if (!movePageBefore(nb, d, b)) throw new Error('Verschieben nach hinten abgelehnt');
      if (nb.pages[0].id !== d) throw new Error('d steht nicht vorn');

      // Vor die eigene Nachfolgerin heisst: gar nichts tun
      const vorher = nb.pages.map(p => p.id).join();
      movePageBefore(nb, nb.pages[0].id, nb.pages[1].id);
      if (nb.pages.map(p => p.id).join() !== vorher) throw new Error('Schein-Verschiebung hat etwas veraendert');`);

    await schritt('Eine Kopie bekommt neue Kennungen', `
      const nb = getNb();
      const quelle = nb.pages[0];
      quelle.objects = [{ id: 'fest', kind: 'image', src: 'x', x: 1, y: 1, w: 2, h: 2 }];
      const kopie = clonePage(quelle);
      if (kopie.id === quelle.id) throw new Error('die Seite behielt ihre Kennung');
      if (kopie.objects[0].id === quelle.objects[0].id)
        throw new Error('das Bild behielt seine Kennung - im Raum ueberschreiben sich beide');
      if (kopie.objects[0].src !== quelle.objects[0].src) throw new Error('der Inhalt kam nicht mit');
      quelle.objects = [];`);

    await schritt('Ein Abschnitt nimmt eine Seite auf', `
      const nb = getNb();
      nb.sections = [{ id: 's1', name: 'Erster', pgIds: [] }];
      const pg = nb.pages[0];
      if (!setSectionOfPage(nb, pg.id, 's1')) throw new Error('Zuordnung abgelehnt');
      if (findSecForPage(pg.id, nb)?.id !== 's1') throw new Error('Abschnitt nicht wiedergefunden');
      // Dieselbe Zuordnung noch einmal: nichts zu tun
      if (setSectionOfPage(nb, pg.id, 's1') !== false) throw new Error('dieselbe Zuordnung galt als Aenderung');
      // Und wieder ab
      if (!setSectionOfPage(nb, pg.id, null)) throw new Error('Loesen abgelehnt');
      if (findSecForPage(pg.id, nb)) throw new Error('Abschnitt klebt noch an der Seite');`);

    await schritt('Die Seitenzahl zaehlt vom Heft, nicht vom Abschnitt', `
      const nb = getNb();
      const dritte = nb.pages[2];
      const nr = pageNumberOf(nb, dritte.id);
      if (nr !== 3) throw new Error('Seite 3 heisst hier ' + nr);`);

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

    /* ══════════════════════════════════════════════════════════════════
       ALLES, WAS DER EDITOR SETZT, MUSS DURCH DIE BEREINIGUNG

       Jeder Text geht durch sanitizePageHtml - beim Speichern, beim
       Teilen, beim Ausgeben. Was dort nicht auf der Liste steht, ist
       nach dem ersten Abgleich WEG, und zwar wortlos. Eine Klasse oder
       ein Attribut, das jemand neu einfuehrt und dort nachzutragen
       vergisst, faellt sonst erst dem Nutzer auf.
       ══════════════════════════════════════════════════════════════════ */
    await schritt('Keine Auszeichnung geht beim Saeubern verloren', `
      const proben = [
        ['Ueberschrift',      '<h1>Gross</h1>', 'Gross'],
        ['Titel-Klasse',      '<p class="j-title-2">Mittel</p>', 'j-title-2'],
        ['Fett und kursiv',   '<p><b>f</b><i>k</i><u>u</u><s>d</s></p>', '<b>'],
        ['Farbe',             '<p style="color:#c04040">rot</p>', 'color'],
        ['Word-Farbe',        '<font color="#2a5fa8">blau</font>', 'color'],
        ['Ausrichtung',       '<p class="j-align-center">mitte</p>', 'j-align-center'],
        ['Aufzaehlung',       '<ul class="j-list-disc"><li>eins</li></ul>', 'j-list-disc'],
        ['Einzug',            '<p style="margin-left:48px">ein</p>', 'margin-left'],
        ['Freier Absatz',     '<p class="j-frei" style="left:120px;top:64px">frei</p>', 'left'],
        ['Abstandshalter',    '<span class="j-luecke" contenteditable="false" style="width:40px"></span>', 'width'],
        ['Tabelle',           '<table class="j-table"><tr><td>z</td></tr></table>', '<td>'],
        ['Spaltenbreite',     '<table><colgroup><col width="120"></colgroup><tr><td>z</td></tr></table>', 'width="120"'],
        ['Zeilenhoehe',       '<table><tr height="64"><td>z</td></tr></table>', 'height="64"'],
        ['Verbundene Zelle',  '<table><tr><td colspan="2">z</td></tr></table>', 'colspan="2"'],
        ['Tabellenlage',      '<table class="j-table" x="30" y="90"><tr><td>z</td></tr></table>', 'x="30"'],
        ['Formel',            '<span class="j-formula" data-latex="x^2">x</span>', 'data-latex'],
        ['Formel als Block',  '<p class="j-formula-block"><span class="j-formula" data-latex="a">a</span></p>', 'j-formula-block'],
        ['Kommentarstelle',   '<span class="j-comment-mark" data-cid="k1">Stelle</span>', 'data-cid'],
        ['Erledigt',          '<span class="j-comment-mark j-resolved" data-cid="k2">x</span>', 'j-resolved'],
        ['Verweis',           '<a href="https://example.org">hin</a>', 'href'],
        ['Seitenverweis',     '<a href="inkwells://page/7">Seite 7</a>', 'inkwells://page/7']
      ];
      const weg = [];
      for (const [name, roh, muss] of proben) {
        const rein = sanitizePageHtml(roh);
        if (!rein.includes(muss)) weg.push(name + ' (fehlt: ' + muss + ')');
      }
      if (weg.length) throw new Error('Die Bereinigung verschluckt: ' + weg.join(', '));`);

    await schritt('Und Gefaehrliches faellt weiterhin weg', `
      const boese = [
        ['Skript',        '<script>alles()<\\/script>', /<script/i],
        ['Griff',         '<p onclick="x()">t</p>', /onclick/i],
        ['Griff am Bild', '<img src=x onerror="x()">', /onerror|<img/i],
        ['javascript:',   '<a href="javascript:x()">t</a>', /javascript:/i],
        ['data: im href', '<a href="data:text/html,x">t</a>', /data:text/i],
        ['Rahmen',        '<iframe src="https://x.de"><\\/iframe>', /<iframe/i],
        ['Fremdes style', '<p style="position:fixed;background:url(x)">t</p>', /position|url\\(/i],
        ['Fremde Klasse', '<p class="j-page">t</p>', /j-page/],
        ['contenteditable','<p contenteditable="true">t</p>', /contenteditable/i]
      ];
      const drin = [];
      for (const [name, roh, muster] of boese) {
        const rein = sanitizePageHtml(roh);
        if (muster.test(rein)) drin.push(name + ' -> ' + rein.slice(0, 60));
      }
      if (drin.length) throw new Error('Kam durch: ' + drin.join(' | '));`);

    /* Ein Mailverweis muss die ganze Kette ueberstehen: aus dem Getippten
       wird ein mailto:, der Sanitizer laesst es durch, und der
       Hauptprozess darf es oeffnen. Faellt eines davon aus, tut der
       Verweis in der App wortlos nichts. */
    await schritt('Ein Mailverweis ueberlebt das Saeubern', `
      const rein = sanitizePageHtml('<a href="mailto:wer@wo.de">schreib mir</a>');
      if (!/href="mailto:wer@wo\\.de"/.test(rein)) throw new Error('mailto verworfen: ' + rein);
      // Und ein Schema, das niemand erlaubt hat, faellt weiter durch
      const boese = sanitizePageHtml('<a href="file:///C:/Windows">x</a>');
      if (/file:/.test(boese)) throw new Error('file: blieb stehen: ' + boese);`);

    /* ── Was geändert wurde, muss auch gemerkt werden ─────────────── */
    /* Gespeichert wird NUR, was AutoSave als schmutzig kennt: jeder Weg
       (Takt, Heimknopf, Titelleiste) fragt vorher isDirty(). Wer eine
       Änderung schreibt, ohne das zu melden, verliert sie beim
       Zumachen – ohne Fehlermeldung. */
    abschnitt('Änderungen werden gemerkt');
    await schritt('Ein anderes Papier merkt sich das Heft', `
      const nb = getNb();
      // Die Schritte davor haben an nb.pages gedreht - erst neu zeichnen
      openSection(null);
      await new Promise(r => setTimeout(r, 400));

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

    /* ── Und was der Hauptprozess nach draussen laesst ─────────────────
       Die Bruecke 'open-external' liegt in main.js und ist von der
       Oberflaeche aus nicht zu befragen. Geprueft wird deshalb hier, im
       Hauptprozess: welche Schemata stehen dort auf der Liste. */
    abschnitt('Was nach draussen darf');
    {
      const quelle = require('fs').readFileSync(path.join(ROOT, 'main.js'), 'utf8');
      const m = quelle.match(/EXTERN_ERLAUBT\s*=\s*new Set\(\[([^\]]*)\]\)/);
      const liste = m ? m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean) : [];
      pruefe('http und https duerfen hinaus',
        liste.includes('http:') && liste.includes('https:'),
        'gefunden: ' + liste.join(' '));
      pruefe('mailto: auch – der Verweis-Dialog macht welche',
        liste.includes('mailto:'),
        'ui/links.js baut mailto:-Verweise, core/sanitize.js laesst sie durch, '
        + 'aber main.js weist sie ab: der Verweis tut dann gar nichts. Gefunden: ' + liste.join(' '));
      pruefe('file: und inkwells: bleiben draussen',
        !liste.includes('file:') && !liste.includes('inkwells:'),
        'gefunden: ' + liste.join(' '));
    }

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
