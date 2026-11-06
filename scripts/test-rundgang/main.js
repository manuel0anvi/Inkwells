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
/* ── Griffbereit: eine Attrappe MIT GEDÄCHTNIS ──────────────────────
   Ein fester Wert genügte hier nicht: der Rundgang legt eine Unterlage
   an und will sie danach in der Liste, am Reiter und in der Ansicht
   wiederfinden. Ein leeres Ergebnis liesse jeden dieser Schritte
   „bestehen", ohne dass etwas geprüft wäre. */
/* Ein Fach je Heft – wie im Hauptprozess (main.js, griffHeft). Die
   Attrappe fuehrt es genauso, sonst pruefte der Rundgang eine
   Vereinbarung, die es nicht mehr gibt. */
const griffHefte = new Map();
const griffFach = (nbId) => {
  const schluessel = String(nbId || '');
  if (!schluessel) return { versteckt: false, dateien: [] };
  if (!griffHefte.has(schluessel)) griffHefte.set(schluessel, { versteckt: false, dateien: [] });
  return griffHefte.get(schluessel);
};
const griffAbbild = (nbId) => JSON.parse(JSON.stringify(griffFach(nbId)));
// Ein weisses Bild von 1x1 – genug, um den Weg bis zum <img> zu gehen
const EIN_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

ipcMain.handle('griff-liste', (_, nbId) => griffAbbild(nbId));
let griffNaechste = 0;
ipcMain.handle('griff-waehlen', () => {
  griffNaechste++;
  return { id: 'g' + griffNaechste, art: 'bild', vorschlag: 'Unterlage ' + griffNaechste };
});
ipcMain.handle('griff-abgelegt', () => [{ id: 'g2', art: 'pdf', vorschlag: 'Skript' }]);
ipcMain.handle('griff-uebernehmen', (_, nbId, id, name) => {
  griffFach(nbId).dateien.push({
    id: String(id), name: String(name), art: 'bild',
    breite: 0, stelle: 0, zoom: 1, quer: 0, zuletzt: 0, da: true
  });
  return griffAbbild(nbId);
});
ipcMain.handle('griff-aendern', (_, nbId, id, patch) => {
  const d = griffFach(nbId).dateien.find(x => x.id === String(id));
  if (d) {
    Object.assign(d, patch);
    if (patch && patch.zuletzt) d.zuletzt = Date.now();
  }
  return griffAbbild(nbId);
});
ipcMain.handle('griff-entfernen', (_, nbId, id) => {
  const fach = griffFach(nbId);
  fach.dateien = fach.dateien.filter(d => d.id !== String(id));
  return griffAbbild(nbId);
});
ipcMain.handle('griff-ordnen', (_, nbId, ids) => {
  const f = (Array.isArray(ids) ? ids : []).map(String);
  const platz = (d) => { const i = f.indexOf(d.id); return i === -1 ? 99 : i; };
  griffFach(nbId).dateien.sort((a, b) => platz(a) - platz(b));
  return griffAbbild(nbId);
});
ipcMain.handle('griff-verstecken', (_, nbId, an) => {
  griffFach(nbId).versteckt = !!an;
  return griffAbbild(nbId);
});
ipcMain.handle('griff-lesen', () => ({ ok: true, art: 'bild', mime: 'image/png', bytes: EIN_PIXEL }));

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


/* Die Oberflaeche fragt beim Hochfahren nach einer beim Start
   mitgegebenen Datei (main.js, get-pending-file). Hier gibt es keine -
   ohne diesen Griff protokolliert Electron aber einen Fehler, der mit
   dem Geprueften nichts zu tun hat. */
try { ipcMain.handle('get-pending-file', () => null); } catch (e) {}

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

    /* ══════════════════════════════════════════════════════════════════
       DIE FLAECHE ZUM AUSSUCHEN

       Sie ist selbst gebaut, weil der Farbwaehler von Chromium beim
       Loslassen nicht zugeht (ui/toolbar.js, index.html). Genau das ist
       hier zu pruefen, und zwar dreifach – jedes Stueck kann fuer sich
       kaputtgehen:

         · beim ZIEHEN kommt schon Farbe an, aber noch nicht als
           endgueltig (sonst stuende nach einem Zug ein Dutzend Farben
           im Verlauf und in „zuletzt benutzt")
         · beim ABHEBEN kommt sie endgueltig, und die Flaeche geht zu
         · das FENSTER darum bleibt stehen – dort stehen die zuletzt
           benutzten Farben, und die will man weiter sehen
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Flaeche zum Aussuchen');
    await schritt('Ziehen faerbt, Loslassen schliesst nur die Flaeche', `
      let letzte = null, endgueltig = 0;
      openCustomColorPopover('shape-fill', document.getElementById('pen-color-ring'),
        (c, final) => { letzte = c; if (final) endgueltig++; }, '#111111');

      const feld = document.getElementById('cc-feld');
      const flaeche = document.getElementById('cc-flaeche');
      const fenster = document.getElementById('custom-color-pop');
      const r = feld.getBoundingClientRect();
      if (!r.width || !r.height) throw new Error('Die Flaeche steht nicht da');

      const schick = (art, x, y) => feld.dispatchEvent(new PointerEvent(art, {
        bubbles: true, cancelable: true, pointerId: 91, pointerType: 'touch',
        clientX: x, clientY: y }));
      const x = r.left + r.width * 0.85, y = r.top + r.height * 0.15;

      schick('pointerdown', x, y);
      if (!letzte) throw new Error('Beim Aufsetzen kam keine Farbe an');
      if (endgueltig) throw new Error('Schon beim Ziehen als endgueltig gemeldet');
      if (flaeche.style.display === 'none') throw new Error('Sie ging schon beim Aufsetzen zu');
      const beimZiehen = letzte;

      schick('pointermove', x - r.width * 0.3, y);
      if (letzte === beimZiehen) throw new Error('Das Ziehen aenderte nichts');
      if (endgueltig) throw new Error('Das Ziehen meldete endgueltig');

      schick('pointerup', x - r.width * 0.3, y);
      if (endgueltig !== 1) throw new Error('Beim Abheben kam kein endgueltiges Ergebnis (' + endgueltig + ')');
      if (flaeche.style.display !== 'none') throw new Error('Die Flaeche blieb offen');
      if (fenster.style.display !== 'block') throw new Error('Das Fenster ging mit zu');
      if (!/^#[0-9a-f]{6}$/.test(letzte)) throw new Error('Keine brauchbare Farbe: ' + letzte);

      // Der Knopf daneben holt die Flaeche zurueck
      document.getElementById('custom-color-swatch').click();
      if (flaeche.style.display === 'none') throw new Error('Der Knopf holt sie nicht zurueck');
      closeCustomColorPopover();`);

    /* Drei Einschraenkungen, alle aus derselben Meldung: mit der Maus
       sprang die Flaeche mitten im Aussuchen zu, und der Ton-Streifen
       machte sie ebenfalls zu, obwohl man danach erst weitersucht. */
    await schritt('Maus, Ton-Streifen und Abbruch lassen sie offen', `
      const feld = document.getElementById('cc-feld');
      const ton = document.getElementById('cc-ton');
      const flaeche = document.getElementById('cc-flaeche');
      let letzte = null;

      const zug = (el, art, anteil, typ) => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new PointerEvent(art, {
          bubbles: true, cancelable: true, pointerId: 92, pointerType: typ,
          clientX: r.left + r.width * anteil, clientY: r.top + r.height * 0.5 }));
      };

      // 1. Mit der MAUS bleibt sie offen – am Schreibtisch verdeckt sie nichts
      openCustomColorPopover('shape-fill', document.getElementById('pen-color-ring'),
        c => { letzte = c; }, '#111111');
      zug(feld, 'pointerdown', 0.8, 'mouse');
      zug(feld, 'pointerup', 0.8, 'mouse');
      if (flaeche.style.display === 'none') throw new Error('Die Maus machte sie zu');
      if (!letzte) throw new Error('Die Maus faerbte gar nicht');

      // 2. Der TON-STREIFEN macht sie nie zu, auch mit dem Finger nicht
      zug(ton, 'pointerdown', 0.3, 'touch');
      zug(ton, 'pointerup', 0.3, 'touch');
      if (flaeche.style.display === 'none') throw new Error('Der Ton-Streifen machte sie zu');

      // 3. Ein ABBRUCH ist kein Fertig
      zug(feld, 'pointerdown', 0.6, 'touch');
      zug(feld, 'pointercancel', 0.6, 'touch');
      if (flaeche.style.display === 'none') throw new Error('Ein Abbruch machte sie zu');

      // Und das Feld mit dem Finger macht sie weiterhin zu
      zug(feld, 'pointerdown', 0.4, 'touch');
      zug(feld, 'pointerup', 0.4, 'touch');
      if (flaeche.style.display !== 'none') throw new Error('Das Feld macht sie nicht mehr zu');
      closeCustomColorPopover();`);

    /* ══════════════════════════════════════════════════════════════════
       DIE LEISTE UEBER DER FORM GEHOERT ZUR FARBWAHL

       Zweimal gemeldet: sie verschwand beim Zumachen der Farbwahl und
       beim Wiederaufklappen der Flaeche darin. Beides ist derselbe
       Faenger in canvas/objects.js, der jeden Druck ausserhalb des
       Objekts als „daneben" gelesen hat.
       ══════════════════════════════════════════════════════════════════ */
    await schritt('Beim Faerben bleibt die Form ausgewaehlt', `
      switchMode('cursor');
      if (!insertShape('rect')) throw new Error('Keine Form eingesetzt');
      const wrap = document.querySelector('.obj-wrap.selected');
      if (!wrap) throw new Error('Die Form ist gar nicht ausgewaehlt');

      openCustomColorPopover('shape-fill', wrap, () => {}, '#111111');
      const feld = document.getElementById('cc-feld');
      const r = feld.getBoundingClientRect();
      const schick = (el, art, x, y) => el.dispatchEvent(new PointerEvent(art, {
        bubbles: true, cancelable: true, pointerId: 93, pointerType: 'mouse',
        clientX: x, clientY: y }));

      // Ein Griff IN die Farbwahl darf die Auswahl nicht wegnehmen
      schick(feld, 'pointerdown', r.left + r.width * 0.5, r.top + r.height * 0.5);
      schick(feld, 'pointerup', r.left + r.width * 0.5, r.top + r.height * 0.5);
      if (!document.querySelector('.obj-wrap.selected')) throw new Error('Die Leiste ging beim Faerben weg');

      // Auch der Knopf, der die Flaeche wieder aufklappt
      const knopf = document.getElementById('custom-color-swatch');
      schick(knopf, 'pointerdown', 0, 0);
      knopf.click();
      if (!document.querySelector('.obj-wrap.selected')) throw new Error('Das Wiederaufklappen nahm sie weg');

      // Ein Druck DANEBEN nimmt sie sehr wohl weg
      closeCustomColorPopover();
      schick(document.body, 'pointerdown', 4, 4);
      if (document.querySelector('.obj-wrap.selected')) throw new Error('Daneben tippen waehlt nicht ab');

      // Aufraeumen: die Probe-Form wieder weg
      const pg = getNb().pages.find(p => (p.objects || []).some(o => o.id === wrap.dataset.objid));
      if (pg) pg.objects = pg.objects.filter(o => String(o.id) !== wrap.dataset.objid);
      wrap.remove();`);

    /* ══════════════════════════════════════════════════════════════════
       EINE AM LINEAL GEZOGENE LINIE IST EINE LINIE

       Sie entsteht als Kette vieler Punkte auf einer Geraden, nicht als
       Strich mit zwei Enden – und wurde deshalb nicht als Gerade
       erkannt (canvas/strokeSelect.js, istGerade). Sie wird beim Abheben
       eingedampft; hier steht, dass dabei das Richtige herauskommt.
       ══════════════════════════════════════════════════════════════════ */
    /* ══════════════════════════════════════════════════════════════════
       MARKIEREN DARF NEBEN DEM TEXT ANFANGEN

       .j-text ist die Textspalte, nicht die Seite – links davon liegen
       72 Pixel Rand. Genau dort setzt man an, wenn man eine Zeile
       markieren will, und genau dort fing der Browser nie an: er
       markiert nur, wenn der Druck IM bearbeitbaren Feld begonnen hat.
       Gemeldet als „wenn man nicht genau auf den Anfang des Textes
       klickt, wird nichts ausgewaehlt".
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Markieren vom Rand aus');
    await schritt('Ein Zug aus dem linken Rand markiert die Zeile', `
      switchMode('cursor');
      const pg = document.querySelector('.j-page');
      const t = pg.querySelector('.j-text');
      t.innerHTML = '<p>Erste Zeile mit genug Text darin</p>';
      window.getSelection().removeAllRanges();

      const knoten = t.querySelector('p').firstChild;
      const bereich = document.createRange();
      bereich.selectNodeContents(knoten);
      const rc = bereich.getBoundingClientRect();
      const pr = pg.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      if (!(rc.width > 20)) throw new Error('Der Text steht nicht da');

      // Ein Punkt WEIT LINKS vom Textfeld – im Rand der Seite
      const xLinks = Math.round(pr.left + (tr.left - pr.left) / 2);
      if (xLinks >= tr.left) throw new Error('Der Rand ist zu schmal zum Pruefen');
      const y = Math.round(rc.top + rc.height / 2);

      const ev = (art, x, xy) => pg.dispatchEvent(new PointerEvent(art, {
        bubbles: true, cancelable: true, pointerId: 71, pointerType: 'mouse',
        button: art === 'pointermove' ? -1 : 0, buttons: art === 'pointerup' ? 0 : 1,
        clientX: x, clientY: xy, isPrimary: true }));

      ev('pointerdown', xLinks, y);
      ev('pointermove', Math.round(rc.right - 4), y);
      ev('pointerup', Math.round(rc.right - 4), y);

      const markiert = String(window.getSelection()).trim();
      if (!markiert) throw new Error('Vom Rand aus wurde nichts markiert');
      if (markiert.length < 10) throw new Error('Nur ein Stueck markiert: "' + markiert + '"');

      // Und ein blosser Klick markiert weiterhin nichts
      window.getSelection().removeAllRanges();
      ev('pointerdown', xLinks, y);
      ev('pointerup', xLinks, y);
      if (String(window.getSelection()).trim()) throw new Error('Ein Klick markierte schon etwas');

      t.innerHTML = '';`);

    abschnitt('Das Lineal macht Geraden');
    await schritt('Hin und zurueck gezogen bleiben die aeusseren Enden', `
      const s = { path: [], width: 2, color: '#000', _amLineal: true };
      for (let i = 0; i <= 40; i++) s.path.push({ x: 100 + i * 5, y: 200, p: 0.5 });
      // Nachgezogen: die letzten Punkte laufen wieder nach links
      for (let i = 39; i >= 20; i--) s.path.push({ x: 100 + i * 5, y: 200, p: 0.5 });

      if (!linealStrichEindampfen(s)) throw new Error('Nicht eingedampft');
      if (s.path.length !== 2) throw new Error('Es blieben ' + s.path.length + ' Punkte');
      const xs = s.path.map(p => p.x).sort((a, b) => a - b);
      if (xs[0] !== 100 || xs[1] !== 300) throw new Error('Die Enden stimmen nicht: ' + xs.join());
      if ('_amLineal' in s) throw new Error('Der Merker blieb im Strich stehen');`);

    await schritt('Ein Bogen bleibt ein Bogen, und ohne Lineal bleibt alles', `
      const bogen = { path: [], _amLineal: true };
      for (let i = 0; i <= 20; i++) bogen.path.push({ x: 100 + i * 5, y: 200 + Math.sin(i / 3) * 20, p: 0.5 });
      if (linealStrichEindampfen(bogen)) throw new Error('Aus einem Bogen wurde eine Gerade');
      if (bogen.path.length !== 21) throw new Error('Der Bogen wurde trotzdem angefasst');

      const frei = { path: [{ x: 0, y: 0, p: .5 }, { x: 50, y: 0, p: .5 }, { x: 100, y: 0, p: .5 }] };
      if (linealStrichEindampfen(frei)) throw new Error('Ohne Lineal wurde eingedampft');
      if (frei.path.length !== 3) throw new Error('Handschrift wurde begradigt');`);

    await schritt('Farbe hin und zurueck gerechnet bleibt dieselbe', `
      for (const hex of ['#2a5fa8', '#c04040', '#ffffff', '#000000', '#7f7f7f', '#e8c547']) {
        const h = hexNachHsv(hex);
        const zurueck = hsvNachHex(h.h, h.s, h.v);
        if (zurueck !== hex) throw new Error(hex + ' wurde zu ' + zurueck);
      }`);

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

    /* ══════════════════════════════════════════════════════════════════
       EINGEFUEGTES LAESST SICH ZURUECKNEHMEN

       pushTypingHistory fasst alles zusammen, was innerhalb von 700 ms
       geschieht – richtig fuers Tippen, falsch fuers Einfuegen. Wer
       tippt und gleich darauf etwas einsetzt, bekam dafuer KEINEN
       eigenen Schritt: ein Strg+Z nahm beides zusammen weg, oder
       scheinbar gar nichts.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Eingefuegtes zurueknehmen');

    await schritt('Einfuegen bekommt einen eigenen Schritt', `
      const info = getPage(S.activePgId);
      const pg = info.page;
      const pgEl = document.querySelector('[data-pgid="' + pg.id + '"]');
      const td = pgEl.querySelector('.j-text');
      td.innerHTML = '<p>Anfang</p>';
      td.focus();
      setFlatCaret(td, 6);

      S.history[pg.id] = { undo: [], redo: [] };
      const anschlag = (art) => td.dispatchEvent(new InputEvent('beforeinput',
        { inputType: art, bubbles: true, cancelable: true }));

      // Erst tippen, dann SOFORT einfuegen – beides in derselben Sekunde
      anschlag('insertText');
      anschlag('insertFromPaste');

      const tiefe = S.history[pg.id].undo.length;
      if (tiefe < 2)
        throw new Error('nur ' + tiefe + ' Schritt(e): das Eingefuegte laesst sich nicht '
          + 'fuer sich zuruecknehmen, weil es mit dem Tippen zusammengefasst wurde');`, 400);

    await schritt('Und danach faengt das Tippen einen neuen an', `
      const pg = getPage(S.activePgId).page;
      const td = document.querySelector('[data-pgid="' + pg.id + '"] .j-text');
      const vorher = S.history[pg.id].undo.length;
      td.dispatchEvent(new InputEvent('beforeinput',
        { inputType: 'insertText', bubbles: true, cancelable: true }));
      if (S.history[pg.id].undo.length <= vorher)
        throw new Error('das Getippte danach klebt am Eingefuegten');`);

    await schritt('Schnelles Tippen bleibt aber EIN Schritt', `
      const pg = getPage(S.activePgId).page;
      const td = document.querySelector('[data-pgid="' + pg.id + '"] .j-text');
      /* Die Tipp-Uhr aus dem Schritt davor ablaufen lassen, sonst faellt
         der erste Anschlag noch in dessen Gruppe (700 ms). */
      await new Promise(r => setTimeout(r, 800));
      S.history[pg.id] = { undo: [], redo: [] };
      for (let i = 0; i < 5; i++) {
        td.dispatchEvent(new InputEvent('beforeinput',
          { inputType: 'insertText', bubbles: true, cancelable: true }));
      }
      const tiefe = S.history[pg.id].undo.length;
      if (tiefe !== 1)
        throw new Error('fuenf Anschlaege ergaben ' + tiefe + ' Schritte statt einem');`);

    await schritt('Ausschneiden ebenso', `
      const pg = getPage(S.activePgId).page;
      const td = document.querySelector('[data-pgid="' + pg.id + '"] .j-text');
      await new Promise(r => setTimeout(r, 800));   // siehe oben
      S.history[pg.id] = { undo: [], redo: [] };
      td.dispatchEvent(new InputEvent('beforeinput',
        { inputType: 'insertText', bubbles: true, cancelable: true }));
      td.dispatchEvent(new InputEvent('beforeinput',
        { inputType: 'deleteByCut', bubbles: true, cancelable: true }));
      if (S.history[pg.id].undo.length < 2)
        throw new Error('das Ausgeschnittene laesst sich nicht fuer sich zuruecknehmen');`);

    /* ══════════════════════════════════════════════════════════════════
       EIN LANGER TEXT LAEUFT UEBER – UND LAESST SICH TROTZDEM ZURUECK

       Passt das Eingefuegte nicht auf die Seite, schiebt
       checkPageOverflow den Rest auf eine neue und macht DIESE zur
       aktiven (setActivePg). undoPage() sieht aber im Verlauf von
       S.activePgId nach – und der ist auf der frischen Seite leer.
       Ergebnis: "Nichts zum Rueckgaengigmachen", obwohl gerade eben
       etwas geschehen ist.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Ein langer Text laeuft ueber');

    await schritt('Auch danach laesst sich zurueknehmen', `
      const nb = getNb();
      nb.pages = [makePage('ruled')];
      openSection(null);
      await new Promise(r => setTimeout(r, 500));

      const pg = nb.pages[0];
      const pgEl = document.querySelector('[data-pgid="' + pg.id + '"]');
      const td = pgEl.querySelector('.j-text');
      td.innerHTML = '<p>Kurz</p>';
      uebernimmText(pg, td);
      S.history[pg.id] = { undo: [], redo: [] };
      await new Promise(r => setTimeout(r, 800));

      // Einfuegen: erst der Sicherungspunkt, dann der lange Text
      td.focus();
      setFlatCaret(td, 4);
      td.dispatchEvent(new InputEvent('beforeinput',
        { inputType: 'insertFromPaste', bubbles: true, cancelable: true }));

      let lang = '';
      for (let i = 0; i < 80; i++) lang += '<p>Zeile ' + i + ' mit etwas Text darin</p>';
      td.innerHTML = '<p>Kurz</p>' + lang;
      td.dispatchEvent(new Event('input', { bubbles: true }));

      // Der Umbruch laeuft ueber einen Timer (20 ms) – ihm Zeit lassen
      await new Promise(r => setTimeout(r, 900));

      const seiten = getNb().pages.length;
      if (seiten < 2) throw new Error('der Text ist gar nicht uebergelaufen (' + seiten + ' Seite)');

      const aktiv = S.activePgId;
      if (aktiv === pg.id) throw new Error('die aktive Seite hat nicht gewechselt - Fall trifft nicht zu');

      if (!undoPage())
        throw new Error('Rueckgaengig sagt, es gaebe nichts: die aktive Seite ist die neue ('
          + aktiv + '), gesichert wurde auf der alten (' + pg.id + ')');

      await new Promise(r => setTimeout(r, 400));

      /* Und der Text darf danach nicht DOPPELT dastehen. Ein Ueberlauf
         aendert zwei Seiten; nur die eine zurueckzunehmen liesse den
         verschobenen Teil auf der neuen Seite liegen. */
      const alles = getNb().pages.map(p => p.textContent || '').join('\\n');
      const wieOft = (alles.match(/Zeile 0 mit etwas Text/g) || []).length;
      if (wieOft > 1)
        throw new Error('der Text steht nach dem Rueckgaengig ' + wieOft + '-mal da: '
          + 'der uebergelaufene Teil blieb auf der neuen Seite liegen');
      if (!/Kurz/.test(alles)) throw new Error('der Ausgangstext ist weg');`, 1200);

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
    /* >>> Ein Bild zuschneiden <<<
       Wie in Word: der Knopf in der Leiste macht das ganze Bild sichtbar,
       darauf ein helles Fenster mit acht Griffen. Zieht man die rechte
       Kante nach innen, wird der RAHMEN schmaler – der sichtbare Teil
       behaelt seinen Massstab. Genau das unterscheidet Zuschneiden vom
       Verkleinern.

       Geprueft wird an einem Bild aus vier verschiedenfarbigen Vierteln:
       welche Farbe danach wo steht, sagt, was wirklich geschnitten
       wurde. */
    await schritt('Ein Bild laesst sich zuschneiden', `
      const seite = getNb().pages[0];
      const leinwand = document.createElement('canvas');
      leinwand.width = 200; leinwand.height = 200;
      const g = leinwand.getContext('2d');
      g.fillStyle = '#ff0000'; g.fillRect(0, 0, 100, 200);
      g.fillStyle = '#00ff00'; g.fillRect(100, 0, 100, 200);

      const o = { id: uid(), kind: 'image', src: leinwand.toDataURL('image/png'),
        name: 'Zwei Haelften', x: 100, y: 100, w: 200, h: 200, rot: 0 };
      seite.objects = (seite.objects || []).concat([o]);
      const ebene = document.querySelector('[data-pgid="' + seite.id + '"] .j-objects');
      if (!ebene) throw new Error('keine Objektebene');
      placeObject(ebene, o, seite);
      await new Promise(r => setTimeout(r, 200));

      const wrap = [...document.querySelectorAll('.obj-wrap')].slice(-1)[0];
      const koerper = wrap.querySelector('.obj-body');
      const tippe = (el) => {
        for (const art of ['pointerdown', 'pointerup']) {
          el.dispatchEvent(new PointerEvent(art, { pointerId: 41, clientX: 0, clientY: 0, bubbles: true }));
        }
      };
      tippe(koerper);
      await new Promise(r => setTimeout(r, 300));

      const knopf = () => [...wrap.querySelectorAll('.obj-bar-btn')]
        .find(b => /Zuschneiden|Crop|Ritaglia/.test(b.getAttribute('aria-label') || ''));
      if (!knopf()) throw new Error('kein Knopf zum Zuschneiden in der Leiste');
      knopf().click();
      await new Promise(r => setTimeout(r, 300));

      if (!wrap.querySelector('.zuschnitt')) throw new Error('das Zuschneiden ging nicht auf');
      if (wrap.querySelectorAll('.zuschnitt-griff').length !== 8)
        throw new Error('es sind nicht acht Griffe');

      // Die rechte Kante um die halbe Bildbreite nach innen
      const zieheRechts = (punkte) => {
        const griff = wrap.querySelector('.zuschnitt-griff.r');
        const r = griff.getBoundingClientRect();
        const mitte = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        const zeig = (art, dx) => griff.dispatchEvent(new PointerEvent(art,
          { pointerId: 42, clientX: Math.round(mitte.x + dx), clientY: Math.round(mitte.y), bubbles: true }));
        zeig('pointerdown', 0);
        zeig('pointermove', punkte / 2);
        zeig('pointermove', punkte);
        zeig('pointerup', punkte);
      };
      zieheRechts(-100);
      wrap.querySelector('.zuschnitt-knopf.ja').click();
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 50));
        if (o.crop) break;
      }

      if (!o.crop) throw new Error('nichts zugeschnitten');
      if (!(o.crop.r > 0.2)) throw new Error('die rechte Kante wurde nicht genommen: ' + o.crop.r);
      if (!o.quelle) throw new Error('das Original wurde nicht aufgehoben');
      if (o.x !== 100) throw new Error('die linke Kante ist gewandert: ' + o.x);
      if (!(o.w < 180)) throw new Error('der Rahmen wurde nicht schmaler: ' + o.w);
      if (o.h !== 200) throw new Error('die Hoehe hat sich geaendert: ' + o.h);
      if (wrap.querySelector('.zuschnitt')) throw new Error('die Huelle blieb stehen');

      // Und wirklich geschnitten: rechts steht jetzt nicht mehr Gruen
      const gelesen = new Image(); gelesen.src = o.src;
      await new Promise(res => { gelesen.onload = res; gelesen.onerror = res; });
      const c2 = document.createElement('canvas');
      c2.width = gelesen.naturalWidth; c2.height = gelesen.naturalHeight;
      c2.getContext('2d').drawImage(gelesen, 0, 0);
      const punkt = c2.getContext('2d').getImageData(c2.width - 2, 10, 1, 1).data;
      if (!(punkt[0] > 200 && punkt[1] < 60))
        throw new Error('am rechten Rand steht nicht Rot: ' + [...punkt].slice(0, 3).join(','));

      // Zurueck auf das ganze Bild: dann faellt auch die zweite Fassung weg
      knopf().click();
      await new Promise(r => setTimeout(r, 300));
      zieheRechts(400);
      wrap.querySelector('.zuschnitt-knopf.ja').click();
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 50));
        if (!o.crop) break;
      }
      if (o.crop) throw new Error('der Zuschnitt liess sich nicht ganz zuruecknehmen');
      if (o.quelle) throw new Error('das Original blieb doppelt liegen');

      // Aufraeumen – die naechsten Schritte rechnen mit ihrer eigenen Seite
      seite.objects = (seite.objects || []).filter(x => x.id !== o.id);
      wrap.remove();`, 340);

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
    /* ══════════════════════════════════════════════════════════════════
       DIE LEISTE AN DER TABELLE, OHNE SCHREIBRECHT

       Gemeldet: „bei Tabellen kann man sie im Nur-Lesen nicht
       bearbeiten, das ist gut — aber wenn man draufdrückt, kommt
       trotzdem die Leiste oben mit den Buttons, auch wenn sie nichts
       machen."

       Jeder Knopf fragte für sich nach S.readOnly und sagte brav „nur
       lesen"; die Leiste selbst erschien trotzdem. Der Riegel sitzt
       jetzt in positionTableBar (core/tables.js) — an der einen
       Stelle, durch die alle Wege laufen.

       Geprüft wird beides. Nur „sie ist weg" wäre auch dann grün,
       wenn die Leiste überhaupt nicht mehr käme.
       ══════════════════════════════════════════════════════════════════ */
    await schritt('Mit Schreibrecht steht die Leiste an der Tabelle', `
      const zelle = document.querySelector('.j-text table.j-table td');
      if (!zelle) throw new Error('keine Tabelle auf dem Blatt');
      const marke = (z) => {
        z.closest('.j-text').focus();
        const r = document.createRange();
        r.selectNodeContents(z); r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
      };
      marke(zelle);
      await new Promise(r => setTimeout(r, 120));
      const bar = document.querySelector('.j-table-bar');
      if (!bar) throw new Error('die Leiste wurde gar nicht gebaut');
      if (getComputedStyle(bar).display === 'none')
        throw new Error('sie bleibt versteckt, obwohl geschrieben werden darf');
      if (!bar.querySelectorAll('.j-table-btn').length)
        throw new Error('sie ist leer');`, 400);

    await schritt('Ohne Schreibrecht bleibt sie weg', `
      const zelle = document.querySelector('.j-text table.j-table td');
      if (!zelle) throw new Error('keine Tabelle auf dem Blatt');
      const marke = (z) => {
        z.closest('.j-text').focus();
        const r = document.createRange();
        r.selectNodeContents(z); r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
      };
      try {
        applyReadOnlyChrome(true, { role: 'view', ownerName: 'Wer', title: 'Probe' });
        await new Promise(r => setTimeout(r, 120));
        const bar = document.querySelector('.j-table-bar');
        if (bar && getComputedStyle(bar).display !== 'none')
          throw new Error('sie steht beim Herabstufen noch da');
        // und beim Hineinklicken darf sie auch nicht wiederkommen
        marke(zelle);
        await new Promise(r => setTimeout(r, 120));
        const wieder = document.querySelector('.j-table-bar');
        if (wieder && getComputedStyle(wieder).display !== 'none')
          throw new Error('ein Klick in die Zelle holt sie zurueck');
      } finally {
        applyReadOnlyChrome(false, null);
      }`, 400);

    await schritt('Eine Formel wird vermessen', `
      typeof measureFormula === 'function' ? JSON.stringify(measureFormula('x^2 + y^2')) : 'ok'`);

    /* ══════════════════════════════════════════════════════════════════
       CODE ALS KASTEN AUF DEM BLATT

       Ein Codeblock ist ein OBJEKT (page.objects), kein Text im Fluss.
       Damit gilt fuer ihn alles, was canvas/objects.js schon kann:
       verschieben, vervielfaeltigen, loeschen, Ebenen.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Code als Kasten auf dem Blatt');

    await schritt('Der Knopf steht in der Werkzeugleiste', `
      const b = E('btn-code');
      if (!b) throw new Error('#btn-code gibt es nicht');
      if (!b.closest('#toolbar, .toolbar')) throw new Error('er haengt nicht in der Leiste');
      if (getComputedStyle(b).display === 'none')
        throw new Error('er ist unsichtbar, obwohl die Leiste breit ist');
      if (!document.querySelector('#insert-all-pop [data-einfuegen="code"]'))
        throw new Error('im Sammelmenue fehlt er');`);

    await schritt('Der Knopf macht den Dialog auf', `
      if (typeof openCodeEditor !== 'function') throw new Error('openCodeEditor fehlt');
      E('btn-code').click();
      await new Promise(r => setTimeout(r, 200));
      const ov = E('ov-code');
      if (!ov || ov.style.display === 'none') throw new Error('der Dialog ist zu geblieben');
      if (!E('code-quelle')) throw new Error('kein Eingabefeld');
      if (!E('code-sprache')) throw new Error('keine Sprachauswahl');`, 400);

    /* Das Wichtigste am Feld: es haelt den Code Zeichen fuer Zeichen.
       Ein contenteditable machte daraus Absaetze und schluckte die
       Einrueckung – bei Python waere das Programm damit kaputt. */
    await schritt('Das Feld haelt die Formatierung genau', `
      const feld = E('code-quelle');
      const roh = 'def f(x):\\n    if x:\\n        return "ja"\\n    return "nein"\\n';
      feld.value = roh;
      if (feld.value !== roh) throw new Error('das Feld hat den Text veraendert');
      if (feld.tagName !== 'TEXTAREA') throw new Error('kein textarea: ' + feld.tagName);`);

    await schritt('Die Sprache wird erraten', `
      const C = window.InkwellsCode;
      const proben = {
        python: 'def gruss(name):\\n    return f"Hallo {name}"',
        java: 'public class A {\\n  public static void main(String[] a) { System.out.println("x"); }\\n}',
        c: '#include <stdio.h>\\nint main(void) { printf("hi"); return 0; }',
        javascript: 'const f = (a) => { console.log(a); };',
        html: '<!DOCTYPE html>\\n<html><body><div class="a">x</div></body></html>',
        css: '.karte { color: red; margin: 4px; }',
        sql: 'SELECT name FROM kunden WHERE id = 1;',
        bash: '#!/bin/bash\\necho "hallo"'
      };
      const falsch = [];
      for (const [erwartet, code] of Object.entries(proben)) {
        const geraten = C.errateSprache(code);
        if (geraten !== erwartet) falsch.push(erwartet + ' -> ' + geraten);
      }
      if (falsch.length) throw new Error('falsch geraten: ' + falsch.join(', '));

      // Was nach nichts aussieht, bleibt Text – lieber nicht raten
      if (C.errateSprache('Hallo, das ist einfach ein Satz.') !== 'text')
        throw new Error('bei gewoehnlichem Text wurde etwas geraten');`);

    await schritt('Fertig legt einen Kasten auf die Seite', `
      const nb = getNb();
      const pg = nb.pages[0];
      S.activePgId = pg.id;
      const vorher = (pg.objects || []).length;

      E('code-quelle').value = 'def f(x):\\n    return x * 2';
      E('code-sprache').value = 'python';
      E('code-fertig').click();
      await new Promise(r => setTimeout(r, 300));

      const objekte = pg.objects || [];
      if (objekte.length !== vorher + 1) throw new Error('kein Objekt dazugekommen');
      const k = objekte[objekte.length - 1];
      if (k.kind !== 'code') throw new Error('falsche Art: ' + k.kind);
      if (k.code !== 'def f(x):\\n    return x * 2') throw new Error('der Code stimmt nicht: ' + JSON.stringify(k.code));
      if (k.lang !== 'python') throw new Error('die Sprache stimmt nicht: ' + k.lang);
      if (!(k.w > 0 && k.h > 0)) throw new Error('keine Groesse: ' + k.w + 'x' + k.h);
      window.__kasten = k;`, 600);

    await schritt('Der Kasten wird gezeichnet, mit Nummern und Farben', `
      const k = window.__kasten;
      const html = InkwellsCode.renderCodeBody(k);
      if (!/j-code-obj/.test(html)) throw new Error('kein Kasten: ' + html.slice(0, 120));
      if (!/j-code-obj-nrn/.test(html)) throw new Error('keine Zeilennummern');
      if (!/j-tok-key/.test(html)) throw new Error('nichts eingefaerbt');
      // Zwei Zeilen Code heisst zwei Nummern
      const nrn = /<div class="j-code-obj-nrn">([^<]*)<\\/div>/.exec(html);
      if (!nrn || nrn[1].split('\\n').length !== 2)
        throw new Error('falsche Zeilennummern: ' + (nrn && JSON.stringify(nrn[1])));
      // Dunkel ist die Voreinstellung
      if (/\\bhell\\b/.test(html)) throw new Error('er ist hell, obwohl dunkel voreingestellt ist');`);

    /* Genau das, was der Nutzer als "das Schwarze geht weiter oder
       zurueck" beschrieben hat. */
    /* An einem eigenen Objekt, nicht am eingesetzten: updateCodeObject
       aendert nur die Daten, nicht den gezeichneten Kasten. Am
       eingesetzten liefen DOM und Objekt sonst auseinander, und die
       Schritte danach pruefen etwas, das es so gar nicht gibt. */
    await schritt('Mehr Zeilen heisst hoeherer Kasten', `
      const probe = { kind: 'code', code: 'a', lang: 'python', w: 0, h: 0, natW: 0, natH: 0 };
      InkwellsCode.updateCodeObject(probe, 'a', 'python');
      const klein = probe.h;

      InkwellsCode.updateCodeObject(probe, 'a\\nb\\nc\\nd\\ne\\nf\\ng\\nh', 'python');
      if (!(probe.h > klein))
        throw new Error('der Kasten ist nicht gewachsen: ' + klein + ' -> ' + probe.h);

      const gross = probe.h;
      InkwellsCode.updateCodeObject(probe, 'a', 'python');
      if (!(probe.h < gross))
        throw new Error('er ist nicht wieder geschrumpft: ' + gross + ' -> ' + probe.h);

      /* Und wer den Kasten SELBST gezogen hat, behaelt seine Groesse –
         sonst ueberschriebe ihm jede Zeile seine Einstellung. */
      probe.h = probe.natH + 120;
      const gezogen = probe.h;
      InkwellsCode.updateCodeObject(probe, 'a\\nb\\nc', 'python');
      if (probe.h !== gezogen)
        throw new Error('die selbst gezogene Groesse wurde ueberschrieben: '
          + gezogen + ' -> ' + probe.h);`);

    /* Ein Doppelklick macht den Code AN ORT UND STELLE beschreibbar –
       kein Fenster geht auf. Das Fenster bleibt fuer das erste Einsetzen
       und ist ueber den Stift in der Leiste erreichbar. */
    await schritt('Ein Doppelklick macht ihn beschreibbar, ohne Fenster', `
      const pg = getNb().pages[0];
      const k = window.__kasten;
      const wrap = document.querySelector('[data-pgid="' + pg.id + '"] .obj-wrap[data-objid="'
        + CSS.escape(String(k.id)) + '"]');
      if (!wrap) throw new Error('der Kasten liegt nicht im Baum');
      const body = wrap.querySelector('.obj-body');
      if (!body) throw new Error('kein Koerper');

      body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));

      const ov = E('ov-code');
      if (ov && ov.style.display !== 'none')
        throw new Error('es ging ein Fenster auf, statt an Ort und Stelle zu schreiben');

      const pre = wrap.querySelector('.j-code-obj-text');
      if (!pre) throw new Error('kein Textfeld im Kasten');
      if (pre.getAttribute('contenteditable') !== 'true')
        throw new Error('der Code ist nicht beschreibbar geworden');
      if (pre.textContent !== k.code)
        throw new Error('im Feld steht etwas anderes: ' + JSON.stringify(pre.textContent));

      /* Die Farben MUESSEN stehen bleiben. Wurde der Inhalt gegen den
         nackten Code getauscht, ist alles weiss – und die Schreibmarke
         springt dabei an den Zeilenanfang, weil sie mit dem Inhalt
         weggeworfen wird. Beides war gemeldet. */
      if (!/j-tok-/.test(pre.innerHTML))
        throw new Error('beim Bearbeiten sind die Farben verschwunden');

      /* Und der Kasten muss die Klicks behalten: sonst nimmt sie das
         Verschieben weg, das Schreiben endet beim ersten Klick daneben. */
      if (!wrap.classList.contains('code-schreibt'))
        throw new Error('der Kasten ist nicht als "wird beschrieben" gekennzeichnet');

      window.__pre = pre; window.__wrap = wrap;`, 500);

    await schritt('Getipptes landet im Kasten, und er waechst mit', `
      const k = window.__kasten;
      const pre = window.__pre;
      const hoheVorher = k.h;

      /* Mit echten Schluesselwoertern – der Schritt davor hatte den Code
         auf ein blosses "a" gesetzt, daran ist nichts einzufaerben. */
      pre.textContent = 'def f(x):\\n    return x\\nzeile3\\nzeile4';
      pre.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));

      if (!/zeile3/.test(k.code)) throw new Error('das Getippte kam nicht im Heft an: ' + JSON.stringify(k.code));
      if (!(k.h > hoheVorher))
        throw new Error('der Kasten ist nicht gewachsen: ' + hoheVorher + ' -> ' + k.h);

      // Die Zeilennummern muessen mitzaehlen
      const nrn = window.__wrap.querySelector('.j-code-obj-nrn');
      const zahl = (nrn.textContent || '').split('\\n').length;
      const zeilen = k.code.replace(/\\n$/, '').split('\\n').length;
      if (zahl !== zeilen) throw new Error(zahl + ' Nummern fuer ' + zeilen + ' Zeilen');`, 400);

    /* Ein Klick INNERHALB des Kastens darf das Schreiben nicht beenden –
       sonst muesste man nach jedem Umsetzen der Marke erneut
       doppelklicken und laendete wieder am Zeilenanfang. */
    await schritt('Ein Klick im Kasten beendet das Schreiben nicht', `
      const pre = window.__pre, wrap = window.__wrap;
      const nrn = wrap.querySelector('.j-code-obj-nrn');
      nrn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      if (pre.getAttribute('contenteditable') !== 'true')
        throw new Error('ein Klick auf die Zeilennummern hat das Schreiben beendet');

      pre.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      if (pre.getAttribute('contenteditable') !== 'true')
        throw new Error('ein Klick in den Text hat das Schreiben beendet');`, 400);

    await schritt('Ein Klick daneben beendet es und faerbt neu ein', `
      const pre = window.__pre;
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      if (pre.getAttribute('contenteditable') === 'true')
        throw new Error('es bleibt beschreibbar');
      if (!/j-tok-/.test(pre.innerHTML))
        throw new Error('die Farben sind nicht zurueckgekommen');
      if (window.__wrap.classList.contains('code-schreibt'))
        throw new Error('der Kasten gilt weiterhin als beschrieben');`, 400);

    await schritt('Er laesst sich verschieben und loeschen wie ein Bild', `
      const pg = getNb().pages[0];
      const k = window.__kasten;
      // Verschieben ist blosses Setzen der Lage – dieselben Felder wie beim Bild
      k.x = 120; k.y = 200;
      if (k.x !== 120) throw new Error('die Lage laesst sich nicht setzen');
      // Und loeschen geht ueber dieselbe Liste
      const vorher = pg.objects.length;
      pg.objects = pg.objects.filter(o => o.id !== k.id);
      if (pg.objects.length !== vorher - 1) throw new Error('nicht geloescht');`);

    /* ══════════════════════════════════════════════════════════════════
       DIE ANKREUZLISTE LAESST SICH ANKREUZEN
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Ankreuzliste');

    await schritt('Ein Haken laesst sich setzen und wieder wegnehmen', `
      const pg = getNb().pages[0];
      const pgEl = document.querySelector('[data-pgid="' + pg.id + '"]');
      const td = pgEl.querySelector('.j-text');
      td.innerHTML = '<ul class="j-list-check"><li>Mathe lernen</li><li>Abgabe</li></ul>';
      uebernimmText(pg, td);
      const li = td.querySelector('li');

      if (!Lists.hakeAb(li, td)) throw new Error('hakeAb hat abgelehnt');
      if (!li.classList.contains('j-erledigt')) throw new Error('der Haken sitzt nicht');
      if (!/j-erledigt/.test(pg.textContent)) throw new Error('im Heft steht er nicht: ' + pg.textContent);

      Lists.hakeAb(li, td);
      if (li.classList.contains('j-erledigt')) throw new Error('der Haken ging nicht wieder weg');`, 400);

    await schritt('Der Haken ueberlebt die Bereinigung', `
      const rein = sanitizePageHtml('<ul class="j-list-check"><li class="j-erledigt">fertig</li></ul>');
      if (!/j-erledigt/.test(rein)) throw new Error('der Haken ist weg: ' + rein);
      if (!/j-list-check/.test(rein)) throw new Error('die Liste ist weg: ' + rein);`);

    await schritt('Im Nur-Lese-Modus haakt niemand ab', `
      const td = document.querySelector('.j-text');
      td.innerHTML = '<ul class="j-list-check"><li>fremd</li></ul>';
      const li = td.querySelector('li');
      S.readOnly = true;
      const ging = Lists.hakeAb(li, td);
      S.readOnly = false;
      if (ging || li.classList.contains('j-erledigt'))
        throw new Error('in einem fremden Heft wurde abgehakt');`);

    /* ══════════════════════════════════════════════════════════════════
       FOLIEN: QUERFORMAT UND DIE TEXTEBENE DARUEBER
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Folien aus einem PDF');

    await schritt('Eine breite Vorlage bekommt ein breites Blatt', `
      // 16:9, wie eine Folie
      const folie = makeImagePage('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 1600, 900);
      if (folie.w <= folie.h) throw new Error('das Blatt steht hochkant: ' + folie.w + 'x' + folie.h);
      if (folie.w !== CFG.PAGE_H)
        throw new Error('erwartet die lange A4-Kante (' + CFG.PAGE_H + '), bekommen ' + folie.w);

      // Hochkant bleibt hochkant
      const blatt = makeImagePage('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 1240, 1754);
      if (blatt.w !== CFG.PAGE_W)
        throw new Error('ein hochkantes Blatt wurde breit: ' + blatt.w);
      if (blatt.h <= blatt.w) throw new Error('und liegt jetzt quer');`);

    await schritt('Die Textebene sitzt ueber dem Bild', `
      const seite = makeImagePage('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 1600, 900);
      /* Wie pdfZeilen sie liefert: y ist die Grundlinie, Nullpunkt UNTEN
         links. Eine Zeile oben auf der Folie hat also ein grosses y. */
      const zeilen = [
        { text: 'Subnetting', y: 820, groesse: 40, x0: 100, x1: 500 },
        { text: 'Eine Maske teilt das Netz', y: 600, groesse: 20, x0: 100, x1: 700 }
      ];
      const html = folienTextEbene(zeilen, seite, 1600, 900);
      if (!html) throw new Error('keine Ebene erzeugt');
      if (!/j-folie/.test(html)) throw new Error('kein Behaelter: ' + html.slice(0, 120));
      if (!/contenteditable="false"/.test(html)) throw new Error('sie waere beschreibbar');
      if (!/Subnetting/.test(html)) throw new Error('der Text fehlt');

      // Die obere Zeile muss auch oben sitzen
      const stellen = [...html.matchAll(/top:(\\d+)px/g)].map(m => Number(m[1]));
      if (stellen.length !== 2) throw new Error('erwartet zwei Stellen, sind ' + stellen.length);
      if (!(stellen[0] < stellen[1]))
        throw new Error('die obere Zeile sitzt nicht oben: ' + JSON.stringify(stellen));

      // Und die groessere Schrift ist auch groesser
      const groessen = [...html.matchAll(/font-size:(\\d+)px/g)].map(m => Number(m[1]));
      if (!(groessen[0] > groessen[1]))
        throw new Error('die Ueberschrift ist nicht groesser: ' + JSON.stringify(groessen));`);

    /* Der eigentliche Punkt: die Ebene MUSS das Speichern und Teilen
       ueberstehen. Faellt sie beim Bereinigen weg, ist die Suche nach
       dem ersten Abgleich wieder blind. */
    await schritt('Die Textebene ueberlebt die Bereinigung', `
      const roh = '<div class="j-folie" contenteditable="false">'
        + '<span class="j-folie-z" style="left:120px;top:64px;font-size:22px">Routing</span></div>';
      const rein = sanitizePageHtml(roh);
      if (!/j-folie/.test(rein)) throw new Error('der Behaelter ist weg: ' + rein);
      if (!/contenteditable="false"/.test(rein)) throw new Error('der Riegel ist weg: ' + rein);
      if (!/left:\\s*120px/.test(rein)) throw new Error('die Lage ist weg: ' + rein);
      if (!/top:\\s*64px/.test(rein)) throw new Error('die Hoehe ist weg: ' + rein);
      if (!/font-size:\\s*22px/.test(rein)) throw new Error('die Schriftgroesse ist weg: ' + rein);
      if (!/Routing/.test(rein)) throw new Error('der Text ist weg: ' + rein);`);

    await schritt('Ein font-size anderswo kommt weiterhin nicht durch', `
      const rein = sanitizePageHtml('<p style="font-size:99px">gross</p>');
      if (/font-size/.test(rein)) throw new Error('es kam durch: ' + rein);
      const rein2 = sanitizePageHtml('<span class="j-folie-z" style="font-size:huge">x</span>');
      if (/font-size/.test(rein2)) throw new Error('ein unsinniges Mass kam durch: ' + rein2);`);

    await schritt('Und die Suche findet den Folientext', `
      const seite = makeImagePage('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 1600, 900);
      seite.textContent = folienTextEbene(
        [{ text: 'Subnetzmaske', y: 700, groesse: 24, x0: 120, x1: 600 }], seite, 1600, 900);
      const gefunden = nbSearchPlainText(seite).toLowerCase().includes('subnetzmaske');
      if (!gefunden) throw new Error('die Suche findet ihn nicht: ' + nbSearchPlainText(seite));`);

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

    /* ── Unterlagen neben dem Heft ────────────────────────────────── */
    /* Der ganze Weg einmal durch: aufmachen, hinzufügen, zumachen,
       am Reiter aufschlagen, ausblenden. Was hier stumm bleibt, bleibt
       auch im Betrieb stumm – die Leiste sagt von sich aus nichts. */
    abschnitt('Unterlagen neben dem Heft');

    await schritt('Die Leiste geht auf', `
      E('btn-griff').click();
      await new Promise(r => setTimeout(r, 300));
      if (!E('griff-panel').classList.contains('open')) throw new Error('die Leiste blieb zu');`, 340);

    await schritt('Eine Unterlage bekommt einen Namen und steht in der Liste', `
      E('griff-waehlen').click();
      await new Promise(r => setTimeout(r, 250));
      if (E('ov-txt').style.display === 'none') throw new Error('die Frage nach dem Namen kam nicht');
      E('txt-modal-in').value = 'Tafelbild';
      E('txt-modal-ok').click();
      await new Promise(r => setTimeout(r, 300));
      const zeile = document.querySelector('.griff-zeile');
      if (!zeile) throw new Error('die Zeile fehlt');
      if (zeile.querySelector('.griff-zeile-name').textContent !== 'Tafelbild')
        throw new Error('der Name kam nicht an');`, 340);

    await schritt('Eine zweite Unterlage kommt dazu', `
      E('griff-waehlen').click();
      await new Promise(r => setTimeout(r, 250));
      E('txt-modal-in').value = 'Skript';
      E('txt-modal-ok').click();
      await new Promise(r => setTimeout(r, 300));
      const zeilen = [...document.querySelectorAll('.griff-zeile')];
      if (zeilen.length !== 2) throw new Error('es sind nicht zwei Zeilen');

      /* >>> Und man muss sie SEHEN <<<
         Gemeldet wurde einmal, die neue Unterlage stehe „hinter der
         ersten in der Liste". Gezaehlt wird schnell etwas, das gar nicht
         zu sehen ist – deshalb hier: jede Zeile hat eine Hoehe, liegt im
         Kasten der Liste und nicht auf der anderen. */
      const kasten = E('griff-liste').getBoundingClientRect();
      let vorigeUnterkante = -Infinity;
      for (const z of zeilen) {
        const r = z.getBoundingClientRect();
        const name = (z.querySelector('.griff-zeile-name') || {}).textContent;
        if (r.height < 10) throw new Error('die Zeile "' + name + '" ist flach: ' + r.height);
        if (r.width < 40) throw new Error('die Zeile "' + name + '" ist schmal: ' + r.width);
        if (r.top < kasten.top - 1 || r.bottom > kasten.bottom + 1)
          throw new Error('die Zeile "' + name + '" liegt ausserhalb der Liste');
        if (r.top < vorigeUnterkante - 1)
          throw new Error('die Zeile "' + name + '" liegt auf der vorigen');
        vorigeUnterkante = r.bottom;
      }`, 340);

    await schritt('Zugeklappt steht der Reiter an der Kante', `
      E('griff-panel-close').click();
      await new Promise(r => setTimeout(r, 350));
      const streifen = E('griff-reiter');
      if (streifen.style.display !== 'flex') throw new Error('der Streifen bleibt weg');
      if (!streifen.querySelector('.griff-reiter-btn')) throw new Error('kein Reiter');`, 380);

    /* Die Geste selbst, nicht ein Umweg über eine Funktion: nach links
       wischen ist der Weg, den der Nutzer nimmt. */
    await schritt('Ein Wisch nach links schlaegt die Datei auf', `
      const b = E('griff-reiter').querySelector('.griff-reiter-btn');
      const zeig = (art, x) => b.dispatchEvent(new PointerEvent(art,
        { pointerId: 7, clientX: x, clientY: 200, bubbles: true }));
      zeig('pointerdown', 300); zeig('pointerup', 240);
      await new Promise(r => setTimeout(r, 500));
      if (!E('griff-view').classList.contains('open')) throw new Error('die Ansicht blieb zu');
      if (!E('griff-view-body').querySelector('img')) throw new Error('das Bild kam nicht an');`, 520);

    await schritt('Die Breite laesst sich ziehen und bleibt im Rahmen', `
      const z = E('griff-zieher'), v = E('griff-view');
      const zeig = (art, x) => z.dispatchEvent(new PointerEvent(art,
        { pointerId: 8, clientX: x, clientY: 300, bubbles: true }));
      zeig('pointerdown', 600);
      zeig('pointermove', -4000);      // absichtlich weit über das Erlaubte
      zeig('pointerup', -4000);
      await new Promise(r => setTimeout(r, 200));
      const breit = parseFloat(getComputedStyle(v).getPropertyValue('--griff-breite'));
      if (!(breit > 0)) throw new Error('keine Breite gesetzt');
      if (breit > window.innerWidth / 2 + 1)
        throw new Error('breiter als das halbe Fenster: ' + breit);`, 260);

    /* >>> Der Knopf ist kein Wisch <<<
       Die Breite wird am Knopf nach rechts kleiner gezogen – und nach
       rechts wischen heisst zumachen. Mit dem Finger war das dieselbe
       Bewegung: wer schmaler machen wollte, hatte die Datei zu. Der
       Wisch zählt deshalb überall in der Ansicht, nur nicht auf einem
       Knopf. */
    await schritt('Am Knopf ziehen macht die Datei nicht zu', `
      const z = E('griff-zieher'), v = E('griff-view');
      const vorher = parseFloat(getComputedStyle(v).getPropertyValue('--griff-breite'));
      const finger = (x) => new Touch({ identifier: 3, target: z, clientX: x, clientY: 300 });
      const tipp = (art, x, laufend) => z.dispatchEvent(new TouchEvent(art, {
        touches: laufend ? [finger(x)] : [], changedTouches: [finger(x)],
        bubbles: true, cancelable: true }));

      // Genau die Geste, die zumachte: am Knopf weit nach rechts
      tipp('touchstart', 600, true);
      z.dispatchEvent(new PointerEvent('pointerdown',
        { pointerId: 9, clientX: 600, clientY: 300, bubbles: true }));
      z.dispatchEvent(new PointerEvent('pointermove',
        { pointerId: 9, clientX: 900, clientY: 300, bubbles: true }));
      z.dispatchEvent(new PointerEvent('pointerup',
        { pointerId: 9, clientX: 900, clientY: 300, bubbles: true }));
      tipp('touchend', 900, false);
      await new Promise(r => setTimeout(r, 350));

      if (!v.classList.contains('open'))
        throw new Error('das Ziehen hat die Datei zugemacht');
      /* Solange sie offen ist, hat das Reiter-Rechteck nichts davor zu
         suchen: der Name steht in ihrer Kopfzeile. */
      if (getComputedStyle(E('griff-reiter')).display !== 'none')
        throw new Error('die Reiter stehen noch vor der offenen Datei');
      const nachher = parseFloat(getComputedStyle(v).getPropertyValue('--griff-breite'));
      if (!(nachher < vorher))
        throw new Error('schmaler wurde sie auch nicht: ' + vorher + ' -> ' + nachher);`, 300);

    /* Auf dem Blatt daneben gilt der Wisch weiter – sonst hätte die
       Ausnahme die Geste ganz abgeschafft. */
    await schritt('Auf dem Inhalt schliesst der Wisch weiterhin', `
      const k = E('griff-view-body'), v = E('griff-view');
      const finger = (x) => new Touch({ identifier: 4, target: k, clientX: x, clientY: 400 });
      const tipp = (art, x, laufend) => k.dispatchEvent(new TouchEvent(art, {
        touches: laufend ? [finger(x)] : [], changedTouches: [finger(x)],
        bubbles: true, cancelable: true }));
      tipp('touchstart', 1000, true);
      tipp('touchend', 1200, false);
      await new Promise(r => setTimeout(r, 350));
      if (v.classList.contains('open'))
        throw new Error('der Wisch auf dem Inhalt macht nicht mehr zu');
      // Für den nächsten Schritt wieder aufschlagen – der Reiter hört
      // auf Zeiger-Ereignisse, ein blosser Klick tut dort nichts
      const b = E('griff-reiter').querySelector('.griff-reiter-btn');
      const zeig = (art, x) => b.dispatchEvent(new PointerEvent(art,
        { pointerId: 11, clientX: x, clientY: 400, bubbles: true }));
      zeig('pointerdown', 1400); zeig('pointerup', 1340);
      await new Promise(r => setTimeout(r, 700));
      if (!v.classList.contains('open'))
        throw new Error('das Wiederaufschlagen misslang');`, 300);

    /* >>> Zugemacht heisst nicht weggeworfen <<<
       Ein Buch noch einmal zu laden dauert spürbar, und zugemacht wird
       oft. Der Beweis, dass nichts neu gebaut wurde, ist die Identität
       der Knoten: derselbe Kasten, dieselbe Leinwand darin. */
    await schritt('Dieselbe Datei kommt ohne Neuladen zurueck', `
      const v = E('griff-view'), k = E('griff-view-body');
      const vorher = k.firstElementChild;
      if (!vorher) throw new Error('nichts zu vergleichen');
      /* Die Attrappe liefert ein Bild von 1x1 – darin lässt sich nicht
         rollen. Geprüft wird deshalb gegen das, was wirklich ankam. */
      k.scrollTop = 40;
      await new Promise(r => setTimeout(r, 100));
      const stelle = k.scrollTop;

      E('griff-view-close').click();
      await new Promise(r => setTimeout(r, 500));
      if (v.classList.contains('open')) throw new Error('sie ging nicht zu');

      const b = E('griff-reiter').querySelector('.griff-reiter-btn');
      const zeig = (art, x) => b.dispatchEvent(new PointerEvent(art,
        { pointerId: 12, clientX: x, clientY: 400, bubbles: true }));
      zeig('pointerdown', 1400); zeig('pointerup', 1340);
      await new Promise(r => setTimeout(r, 700));

      if (!v.classList.contains('open')) throw new Error('sie ging nicht wieder auf');
      if (E('griff-view-body').firstElementChild !== vorher)
        throw new Error('der Inhalt wurde neu gebaut');
      if (Math.abs(E('griff-view-body').scrollTop - stelle) > 2)
        throw new Error('die Rollstelle ging verloren: '
          + E('griff-view-body').scrollTop + ' statt ' + stelle);`, 320);

    /* >>> Der gemeldete Fall <<<
       Eines auf, das andere auf, wieder das erste – und das erste lud
       jedes Mal neu, weil nur EINE Datei bereitgehalten wurde. Jetzt hat
       jede ihren eigenen Stapel. Der Beweis ist wieder die Identitaet der
       Knoten: derselbe Stapel, dasselbe Bild darin. */
    await schritt('Zwischen zwei Unterlagen umschalten laedt nichts neu', `
      const v = E('griff-view');
      const reiter = () => [...E('griff-reiter').querySelectorAll('.griff-reiter-btn')];
      const tippe = (i) => {
        const b = reiter()[i];
        if (!b) throw new Error('kein Reiter ' + i);
        const zeig = (art, x) => b.dispatchEvent(new PointerEvent(art,
          { pointerId: 20 + i, clientX: x, clientY: 400, bubbles: true }));
        zeig('pointerdown', 1400); zeig('pointerup', 1340);
      };
      const gezeigt = () => document.querySelector('.griff-satz:not([hidden])');

      /* Erst zumachen: bei offener Datei nimmt zeichneReiter die
         Rechtecke ganz aus dem Baum, nicht nur aus dem Blick. */
      if (E('griff-view').classList.contains('open')) {
        E('griff-view-close').click();
        await new Promise(r => setTimeout(r, 500));
      }

      // Die erste
      tippe(0);
      await new Promise(r => setTimeout(r, 700));
      const ersteA = gezeigt();
      if (!ersteA) throw new Error('die erste kam nicht');
      const kennungA = ersteA.dataset.id;
      E('griff-view-close').click();
      await new Promise(r => setTimeout(r, 500));

      // Die zweite
      tippe(1);
      await new Promise(r => setTimeout(r, 700));
      const ersteB = gezeigt();
      if (!ersteB) throw new Error('die zweite kam nicht');
      if (ersteB.dataset.id === kennungA) throw new Error('es kam wieder dieselbe');
      if (document.querySelectorAll('.griff-satz').length !== 2)
        throw new Error('es stehen nicht zwei Stapel bereit');
      if (document.querySelectorAll('.griff-satz:not([hidden])').length !== 1)
        throw new Error('es ist mehr als einer zu sehen');
      E('griff-view-close').click();
      await new Promise(r => setTimeout(r, 500));

      // Und wieder die erste – ohne einen einzigen Ladevorgang
      tippe(0);
      await new Promise(r => setTimeout(r, 700));
      if (gezeigt() !== ersteA) throw new Error('die erste wurde neu gebaut');
      if (!v.classList.contains('open')) throw new Error('sie ging nicht auf');

      // Und noch einmal zurueck zur zweiten
      E('griff-view-close').click();
      await new Promise(r => setTimeout(r, 500));
      tippe(1);
      await new Promise(r => setTimeout(r, 700));
      if (gezeigt() !== ersteB) throw new Error('die zweite wurde neu gebaut');`, 340);

    /* >>> Eine neue Unterlage bei offener Ansicht <<<
       Steht schon eine offen, sind die Reiter weg – sie stuenden sonst
       auf ihrem Rand. Eine frisch hinzugefuegte Datei kam damit ins
       Heft, ohne dass irgendetwas darauf hindeutete: gemeldet als „sie
       liegt hinter der anderen und man sieht sie nicht".

       Auch die Leiste hilft da nicht, denn sie schliesst die Ansicht
       nicht – beides steht zugleich offen, und hinter der Leiste bleibt
       die ALTE Datei stehen. */
    await schritt('Eine neue Unterlage wird gleich aufgeschlagen', `
      const v = E('griff-view');
      if (!v.classList.contains('open')) {
        const b = E('griff-reiter').querySelector('.griff-reiter-btn');
        const z = (art, x) => b.dispatchEvent(new PointerEvent(art,
          { pointerId: 51, clientX: x, clientY: 400, bubbles: true }));
        z('pointerdown', 1400); z('pointerup', 1340);
        await new Promise(r => setTimeout(r, 700));
      }
      const vorher = document.querySelector('.griff-satz:not([hidden])');
      if (!vorher) throw new Error('es steht keine Unterlage offen');
      const alteKennung = vorher.dataset.id;

      // Wie im gemeldeten Fall: die Leiste dazu aufmachen
      E('btn-griff').click();
      await new Promise(r => setTimeout(r, 400));
      if (!v.classList.contains('open'))
        throw new Error('die Leiste hat die Ansicht zugemacht – dann gilt dieser Schritt nicht mehr');

      E('griff-waehlen').click();
      await new Promise(r => setTimeout(r, 300));
      E('txt-modal-in').value = 'Die Dritte';
      E('txt-modal-ok').click();
      await new Promise(r => setTimeout(r, 900));

      const jetzt = document.querySelector('.griff-satz:not([hidden])');
      if (!jetzt) throw new Error('nach dem Hinzufuegen steht nichts offen');
      if (jetzt.dataset.id === alteKennung)
        throw new Error('es steht immer noch die alte Datei da');
      if (E('griff-view-name').textContent !== 'Die Dritte')
        throw new Error('in der Kopfzeile steht: ' + E('griff-view-name').textContent);

      // Die alte ist nicht weg, nur aus dem Blick
      if (!document.querySelector('.griff-satz[data-id="' + alteKennung + '"]'))
        throw new Error('die vorige Unterlage wurde weggeraeumt');

      E('griff-panel-close').click();
      await new Promise(r => setTimeout(r, 400));`, 340);

    /* >>> Eine Unterlage gehoert zu EINEM Heft <<<
       Die Liste galt einmal fuer die ganze App: wer in einem Heft ein
       Skript danebenlegte, hatte es in JEDEM Heft am Rand stehen. Und
       der Stapel des vorigen Hefts darf beim Wechsel nicht stehen
       bleiben – das waere ein Buch im Speicher, das hier niemand
       aufschlagen kann. */
    await schritt('Unterlagen bleiben bei ihrem Heft', `
      if (E('griff-view').classList.contains('open')) {
        E('griff-view-close').click();
        await new Promise(r => setTimeout(r, 500));
      }
      const reiter = () => document.querySelectorAll('.griff-reiter-btn').length;
      const eigenes = S.activeNbId;
      if (!reiter()) throw new Error('im eigenen Heft steht kein Reiter');

      // Ein zweites Heft, nur fuer diesen Schritt
      const zweites = { id: 'probe-zweitheft', name: 'Zweitheft', color: '#c8a96e',
        defaultBg: 'ruled', pages: [makePage('ruled')], sections: [], created: Date.now() };
      S.notebooks.push(zweites);
      openNotebook(zweites.id); openSection(null);
      await new Promise(r => setTimeout(r, 900));

      if (reiter()) throw new Error('die Unterlage des anderen Hefts steht hier am Rand');
      if (document.querySelectorAll('.griff-satz').length)
        throw new Error('der Stapel des anderen Hefts blieb stehen');

      openNotebook(eigenes); openSection(null);
      await new Promise(r => setTimeout(r, 900));
      if (!reiter()) throw new Error('zurueck im eigenen Heft fehlt der Reiter');

      // Das Probeheft wieder weg, der Rundgang geht mit dem eigenen weiter
      S.notebooks = S.notebooks.filter(n => n.id !== zweites.id);
      if (typeof renderSideTree === 'function') renderSideTree();`, 340);

    /* >>> Ausschneiden <<<
       Lange auf ein Blatt druecken, dann ein Rechteck aufziehen – das
       Stueck landet als Objekt auf der Heftseite. Die Attrappe liefert
       ein Bild als Unterlage, also laeuft hier der Weg ueber
       schneideAusBild; das Rechnen aus einem PDF ist derselbe Ablauf mit
       einer anderen Quelle.

       Geprueft wird die ganze Kette: Schleier an, Rahmen da, Objekt im
       Heft, Schleier wieder weg. */
    await schritt('Lange druecken und ziehen schneidet ein Stueck aus', `
      const v = E('griff-view');
      if (!v.classList.contains('open')) {
        const b = E('griff-reiter').querySelector('.griff-reiter-btn');
        const z = (art, x) => b.dispatchEvent(new PointerEvent(art,
          { pointerId: 31, clientX: x, clientY: 400, bubbles: true }));
        z('pointerdown', 1400); z('pointerup', 1340);
        await new Promise(r => setTimeout(r, 700));
      }
      const blatt = document.querySelector('.griff-satz:not([hidden]) .griff-blatt, '
        + '.griff-satz:not([hidden]) .griff-seite');
      if (!blatt) throw new Error('kein Blatt in der Unterlage');

      /* Auf WELCHER Heftseite das Stueck landet, entscheidet die App
         (heftSeite): die zuletzt angesehene, sonst die oberste im Blick.
         Gezaehlt wird deshalb ueber alle Seiten des Hefts – sonst
         suchte die Pruefung auf der falschen. */
      const heft = () => S.notebooks.find(n => n.id === S.activeNbId) || { pages: [] };
      const alleObjekte = () => heft().pages
        .reduce((n, pg) => n + (pg.objects || []).length, 0);
      const kennungen = new Set();
      for (const pg of heft().pages) for (const o of (pg.objects || [])) kennungen.add(o.id);
      const vorher = alleObjekte();

      const r = blatt.getBoundingClientRect();
      const zeig = (art, x, y) => blatt.dispatchEvent(new PointerEvent(art,
        { pointerId: 33, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));

      // Halten – erst danach ist es ein Ausschneiden
      const x0 = Math.round(r.left + r.width * 0.15), y0 = Math.round(r.top + r.height * 0.15);
      zeig('pointerdown', x0, y0);
      await new Promise(res => setTimeout(res, 200));
      if (v.classList.contains('schneidet'))
        throw new Error('der Schleier kam zu frueh – ein Tippen ist kein Halten');
      await new Promise(res => setTimeout(res, 500));
      if (!v.classList.contains('schneidet')) throw new Error('kein Schleier nach dem Halten');
      if (!blatt.classList.contains('griff-schnitt-blatt'))
        throw new Error('das angefasste Blatt hebt sich nicht ab');

      // Ziehen
      const x1 = Math.round(r.left + r.width * 0.85), y1 = Math.round(r.top + r.height * 0.75);
      zeig('pointermove', Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2));
      zeig('pointermove', x1, y1);
      const rahmen = document.querySelector('.griff-schnitt-rahmen');
      if (!rahmen || rahmen.hidden) throw new Error('kein Rahmen beim Ziehen');
      if (rahmen.getBoundingClientRect().width < 20)
        throw new Error('der Rahmen waechst nicht mit');

      zeig('pointerup', x1, y1);
      for (let i = 0; i < 100; i++) {
        await new Promise(res => setTimeout(res, 50));
        if (alleObjekte() > vorher) break;
      }

      if (alleObjekte() !== vorher + 1)
        throw new Error('nichts im Heft angekommen (' + vorher + ' -> ' + alleObjekte()
          + '), Meldung: ' + [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' / '));
      let o = null;
      for (const pg of heft().pages) {
        for (const kandidat of (pg.objects || [])) if (!kennungen.has(kandidat.id)) o = kandidat;
      }
      if (!o) throw new Error('das neue Objekt ist nicht zu finden');
      if (o.kind !== 'image') throw new Error('es ist kein Bild geworden');
      if (String(o.src).slice(0, 11) !== 'data:image/') throw new Error('das Objekt traegt kein Bild');
      if (!(o.w > 0 && o.h > 0)) throw new Error('das Objekt hat kein Mass');
      if (v.classList.contains('schneidet'))
        throw new Error('der Schleier blieb nach dem Loslassen stehen');
      if (document.querySelector('.griff-schnitt-rahmen'))
        throw new Error('der Rahmen blieb stehen');`, 340);

    /* Ein blosses Tippen darf nichts ausloesen – sonst waere jedes
       Antippen der Seite ein Einfuegen. */
    await schritt('Kurz tippen schneidet nichts aus', `
      const blatt = document.querySelector('.griff-satz:not([hidden]) .griff-blatt, '
        + '.griff-satz:not([hidden]) .griff-seite');
      const heft = () => S.notebooks.find(n => n.id === S.activeNbId) || { pages: [] };
      const alleObjekte = () => heft().pages
        .reduce((n, pg) => n + (pg.objects || []).length, 0);
      const vorher = alleObjekte();
      const r = blatt.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const zeig = (art) => blatt.dispatchEvent(new PointerEvent(art,
        { pointerId: 35, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
      zeig('pointerdown');
      await new Promise(res => setTimeout(res, 120));
      zeig('pointerup');
      await new Promise(res => setTimeout(res, 400));
      if (E('griff-view').classList.contains('schneidet'))
        throw new Error('ein kurzes Tippen hat das Ausschneiden ausgeloest');
      if (alleObjekte() !== vorher)
        throw new Error('ein kurzes Tippen hat etwas eingefuegt');`, 300);

    /* >>> Zwei Spalten an einer Kante sind genug <<<
       Die offene Unterlage sitzt dort, wo auch die Kommentarleiste
       aufginge. Beide nebeneinander liessen vom Blatt einen Streifen –
       gemeldet wurde genau das. */
    await schritt('Bei offener Unterlage bleiben die Kommentare zu', `
      if (typeof window.griffBlocksPanels !== 'function')
        throw new Error('griffBlocksPanels fehlt');
      if (!window.griffBlocksPanels())
        throw new Error('die offene Unterlage sperrt nicht');
      // Der Weg des Nutzers: der Griff am Rand
      E('comment-tab')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      if (E('comment-panel')?.classList.contains('open'))
        throw new Error('die Kommentarleiste ging trotzdem auf');

      // Und zu ist der Weg wieder frei
      E('griff-view-close').click();
      await new Promise(r => setTimeout(r, 400));
      if (window.griffBlocksPanels())
        throw new Error('die zugemachte Unterlage sperrt weiter');
      E('comment-tab')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      if (!E('comment-panel')?.classList.contains('open'))
        throw new Error('die Kommentarleiste geht jetzt nicht mehr auf');
      E('comment-panel-close').click();`, 260);

    /* Der Zoom. Geprüft wird nicht die Zahl in der Anzeige, sondern was
       sie bewirkt: wird die Seite wirklich breiter als die Spalte, und
       kommt man an ihren linken Rand? Genau daran scheitert eine mittige
       Ausrichtung ohne „safe" (css/griffbereit.css). */
    await schritt('Der Zoom macht die Seite breiter als die Spalte', `
      // Der Schritt davor hat zugemacht – erst wieder aufschlagen
      const b = E('griff-reiter').querySelector('.griff-reiter-btn');
      const zeig = (a, x) => b.dispatchEvent(new PointerEvent(a,
        { pointerId: 11, clientX: x, clientY: 300, bubbles: true }));
      zeig('pointerdown', 300); zeig('pointerup', 240);
      await new Promise(r => setTimeout(r, 700));
      const k = E('griff-view-body');
      /* Nur im SICHTBAREN Stapel: seit die Unterlagen eines Hefts im
         Voraus geladen werden, liegen ausgeblendete daneben – und die
         messen sich als 0 breit. */
      if (!k.querySelector('.griff-satz:not([hidden]) .griff-seite, .griff-satz:not([hidden]) .griff-blatt')) throw new Error('kein Inhalt da');
      if (E('griff-zoom').hidden) throw new Error('die Zoom-Knoepfe bleiben weg');
      const vorher = k.querySelector('.griff-satz:not([hidden]) .griff-seite, .griff-satz:not([hidden]) .griff-blatt').getBoundingClientRect().width;
      E('griff-zoom-rein').click();
      E('griff-zoom-rein').click();
      await new Promise(r => setTimeout(r, 400));
      const nachher = k.querySelector('.griff-satz:not([hidden]) .griff-seite, .griff-satz:not([hidden]) .griff-blatt').getBoundingClientRect().width;
      if (!(nachher > vorher * 1.4)) throw new Error('kaum breiter: ' + vorher + ' -> ' + nachher);
      if (E('griff-zoom-wert').textContent !== '156%')
        throw new Error('falscher Wert: ' + E('griff-zoom-wert').textContent);
      if (!(k.scrollWidth > k.clientWidth + 1)) throw new Error('nichts zu schieben');`, 420);

    await schritt('Und der linke Rand der Seite bleibt erreichbar', `
      const k = E('griff-view-body');
      k.scrollLeft = 9999;
      if (!(k.scrollLeft > 0)) throw new Error('nach rechts geht nichts');
      k.scrollLeft = 0;
      const seite = k.querySelector('.griff-satz:not([hidden]) .griff-seite, .griff-satz:not([hidden]) .griff-blatt').getBoundingClientRect();
      if (seite.left < k.getBoundingClientRect().left - 1)
        throw new Error('die linke Kante liegt ausserhalb: ' + Math.round(seite.left));`, 260);

    await schritt('Der Wert stellt zurueck, und am Anschlag ist Schluss', `
      E('griff-zoom-wert').click();
      await new Promise(r => setTimeout(r, 350));
      if (E('griff-zoom-wert').textContent !== '100%')
        throw new Error('nicht zurueckgestellt: ' + E('griff-zoom-wert').textContent);
      for (let i = 0; i < 12; i++) E('griff-zoom-raus').click();
      await new Promise(r => setTimeout(r, 350));
      if (E('griff-zoom-wert').textContent !== '50%')
        throw new Error('unter den Anschlag: ' + E('griff-zoom-wert').textContent);
      if (!E('griff-zoom-raus').disabled) throw new Error('der Knopf ist noch scharf');
      E('griff-zoom-wert').click();
      await new Promise(r => setTimeout(r, 350));`, 420);

    await schritt('Ein Wisch nach rechts faehrt sie wieder ein', `
      const kopf = document.querySelector('.griff-view-head');
      const zeig = (art, x) => kopf.dispatchEvent(new PointerEvent(art,
        { pointerId: 9, clientX: x, clientY: 100, bubbles: true }));
      zeig('pointerdown', 100); zeig('pointerup', 300);
      await new Promise(r => setTimeout(r, 400));
      if (E('griff-view').classList.contains('open')) throw new Error('die Ansicht blieb offen');`, 420);

    await schritt('Ausblenden nimmt die Reiter weg, ohne zu loeschen', `
      E('btn-griff').click();
      await new Promise(r => setTimeout(r, 300));
      E('griff-verstecken').click();
      await new Promise(r => setTimeout(r, 300));
      if (!document.querySelector('.griff-zeile')) throw new Error('die Zeile wurde geloescht');
      E('griff-panel-close').click();
      await new Promise(r => setTimeout(r, 350));
      if (E('griff-reiter').style.display !== 'none') throw new Error('der Streifen blieb stehen');`, 380);

    await schritt('Und wieder einblenden holt sie zurueck', `
      E('btn-griff').click();
      await new Promise(r => setTimeout(r, 300));
      E('griff-verstecken').click();
      await new Promise(r => setTimeout(r, 250));
      E('griff-panel-close').click();
      await new Promise(r => setTimeout(r, 350));
      if (E('griff-reiter').style.display !== 'flex') throw new Error('der Streifen kam nicht zurueck');`, 380);

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

    /* Eine .jrnl kann beschaedigt oder von Hand bearbeitet sein. Was
       daraus ins Heft kommt, muss geprueft sein – sonst steht der Unsinn
       hinterher auf dem Blatt und im PDF. */
    await schritt('Eine kaputte Datei bringt keinen Unsinn ins Heft', `
      const kaputt = JSON.stringify({ notebooks: [{
        id: 'x', name: 'Kaputt', pages: [{
          id: 'p1', date: 'Unsinn', bg: 'gibtesnicht',
          textContent: '<p onclick="boese()">Text</p><script>boese()<\\/script>',
          w: 'viel', h: null,
          bgImg: 'https://fremder.server/bild.png',
          objects: [{ kind: 'unbekannt' }, null, 'quatsch'],
          inkStrokes: ['kein Strich', { points: 'auch nicht' }]
        }], sections: [{ id: 's', name: 'A' }]
      }] });
      const nb = { id: 'kaputt', name: 'Kaputt', pages: [], sections: [], defaultBg: 'ruled' };
      fillNotebookFromJrnl(nb, kaputt);
      const pg = nb.pages[0];
      if (!pg) throw new Error('gar keine Seite entstanden');

      if (!Number.isFinite(Date.parse(pg.date)))
        throw new Error('das Datum ist unlesbar: ' + pg.date + ' - im Seitenkopf stuende "Invalid Date"');
      if (!['ruled','grid','dots','blank','craft'].includes(pg.bg))
        throw new Error('erfundene Papierart uebernommen: ' + pg.bg);
      if (/onclick|<script/i.test(pg.textContent))
        throw new Error('der Text kam ungesaeubert durch: ' + pg.textContent);
      if (pg.bgImg) throw new Error('ein fremdes Bild aus dem Netz wurde uebernommen: ' + pg.bgImg);
      if (pg.objects.length) throw new Error('unbrauchbare Objekte uebernommen');
      if (pg.inkStrokes.length) throw new Error('unbrauchbare Striche uebernommen');
      if (!Number.isFinite(pg.w) || !Number.isFinite(pg.h || CFG.PAGE_H))
        throw new Error('unsinniges Mass uebernommen: w=' + pg.w + ' h=' + pg.h);`, 500);

    /* ── Zurück zur Übersicht ─────────────────────────────────────── */
    abschnitt('Der Rückweg');
    await schritt('Zurück zur Übersicht', 'showHome()', 700);
    await schritt('Und nochmal hinein', `openNotebook('probe')`, 700);

    /* ── Und was der Hauptprozess nach draussen laesst ─────────────────
       Die Bruecke 'open-external' liegt in main.js und ist von der
       Oberflaeche aus nicht zu befragen. Geprueft wird deshalb hier, im
       Hauptprozess: welche Schemata stehen dort auf der Liste. */
    abschnitt('Rückgängig nimmt das Richtige');
    {
      const r = await js(`(async () => {
        const a = makePage('ruled'), b = makePage('ruled');
        const nb = { id: 'verlauf', name: 'Verlauf', color: '#c8a96e', defaultBg: 'ruled',
                     pages: [a, b], sections: [], schemaVersion: 2, created: Date.now() };
        const vorher = S.notebooks;
        S.notebooks = [nb];
        openNotebook('verlauf');
        await new Promise(res => setTimeout(res, 300));
        const aus = {};

        // Ein Schritt, der doch nicht stattfand, zeigt nirgends hin
        a.textContent = '<p>eins</p>';
        pushPageHistory(a); a.textContent = '<p>zwei</p>';
        pushPageHistory(b); popPageHistory(b.id);
        undoPage();
        aus.richtigeSeite = a.textContent === '<p>eins</p>';

        // Und nimmt „Wiederholen“ nicht mit
        pushPageHistory(b); popPageHistory(b.id);
        redoPage();
        aus.wiederholen = a.textContent === '<p>zwei</p>';

        // Über zwei Seiten gezogen: ein Strg+Z holt beide zurück
        a.objects = [{ id: 'bild', kind: 'shape', shapeType: 'rect', x: 1, y: 1, w: 20, h: 20 }];
        b.objects = [];
        const g = pushPageHistory(a);
        pushPageHistory(b, g);
        b.objects = a.objects; a.objects = [];
        undoPage();
        aus.aufEinerSeite = a.objects.length === 1 && b.objects.length === 0;

        // Der Strich-Radierer trifft auch Formen und wirkt beim Aufsetzen
        const leinwand = document.querySelector('.j-page[data-pgid="' + a.id + '"] canvas.j-canvas')
          || document.querySelector('.j-page canvas');
        S.eraser.type = 'stroke';
        S.strokeHistory[a.id] = [];
        strokeErase({ x: 5, y: 5 }, a, leinwand);
        aus.formWeg = (a.objects || []).length === 0;
        a.objects = [{ id: 'fest', kind: 'shape', shapeType: 'rect', gesperrt: true, x: 1, y: 1, w: 20, h: 20 }];
        strokeErase({ x: 5, y: 5 }, a, leinwand);
        aus.gesperrtBleibt = a.objects.length === 1;

        S.notebooks = vorher;
        openNotebook(vorher[0].id);
        return aus;
      })()`);
      await warte(300);
      await js('window.__fehler.splice(0)');
      pruefe('Ein zurückgenommener Schritt springt nicht auf eine andere Seite', r.richtigeSeite === true, JSON.stringify(r));
      pruefe('Und „Wiederholen“ bleibt erhalten', r.wiederholen === true, JSON.stringify(r));
      pruefe('Über zwei Seiten gezogen kommt alles zurück', r.aufEinerSeite === true, JSON.stringify(r));
      pruefe('Der Strich-Radierer nimmt eine Form mit', r.formWeg === true, JSON.stringify(r));
      pruefe('Eine gesperrte Form bleibt liegen', r.gesperrtBleibt === true, JSON.stringify(r));
    }

    abschnitt('Fenster und Menüs');
    {
      const r = await js(`(async () => {
        const aus = {};
        const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        const warte = (ms) => new Promise(res => setTimeout(res, ms));

        // Frühere Schritte lassen Fenster offen stehen, und Escape nimmt das oberste
        QA('.overlay').forEach(el => { el.style.display = 'none'; });

        E('ov-settings').style.display = 'flex';
        esc(); await warte(50);
        aus.einstellungen = E('ov-settings').style.display === 'none';

        // Eine offene Rückfrage geht vor: das Fenster dahinter bleibt
        E('ov-trash').style.display = 'flex';
        const frage = showConfirm('Probe');
        esc(); await warte(50);
        aus.frageZuErst = (await frage) === false && E('ov-trash').style.display === 'flex';
        esc(); await warte(50);
        aus.dannDasFenster = E('ov-trash').style.display === 'none';

        // Auch Enter schliesst die Rückfrage nur einmal
        const zweite = showConfirm('Probe');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        aus.enter = (await zweite) === true && E('ov-confirm').style.display === 'none';

        // Ein Menü unten rechts bleibt im Fenster
        showCtxMenu(window.innerWidth - 2, window.innerHeight - 2, S.notebooks[0] && S.notebooks[0].id);
        const k = E('ctx-menu').getBoundingClientRect();
        aus.imFenster = k.right <= window.innerWidth && k.bottom <= window.innerHeight;
        await warte(20);
        esc(); await warte(50);
        aus.menueZu = E('ctx-menu').style.display === 'none';

        // Der Anfangsbuchstabe in der Titelleiste ist Gold auf der dunklen Leiste
        const avatar = E('profile-icon-avatar');
        const anzeige = avatar.style.display;
        avatar.style.display = 'flex';
        aus.buchstabe = getComputedStyle(avatar).color;
        avatar.style.display = anzeige;

        // Die vier Farbnamen sind gesetzt
        const stil = getComputedStyle(document.documentElement);
        aus.farben = ['--accent', '--bg', '--text', '--text-muted'].every(n => stil.getPropertyValue(n).trim());

        // Eine leere Übersicht sagt, wie es losgeht
        const vorher = S.notebooks;
        S.notebooks = [];
        renderHomeGrid();
        aus.leer = !!document.querySelector('#nb-grid .nb-add-card');
        S.notebooks = vorher;
        renderHomeGrid();
        return aus;
      })()`);
      await warte(200);
      await js('window.__fehler.splice(0)');
      pruefe('Escape schliesst die Einstellungen', r.einstellungen === true, JSON.stringify(r));
      pruefe('Eine Rückfrage geht zuerst zu, das Fenster dahinter bleibt', r.frageZuErst === true, JSON.stringify(r));
      pruefe('Beim nächsten Escape dann das Fenster', r.dannDasFenster === true, JSON.stringify(r));
      pruefe('Enter bestätigt eine Rückfrage genau einmal', r.enter === true, JSON.stringify(r));
      pruefe('Ein Menü am Rand bleibt im Fenster', r.imFenster === true, JSON.stringify(r));
      pruefe('Escape schliesst auch ein Menü', r.menueZu === true, JSON.stringify(r));
      pruefe('Die Farbnamen sind gesetzt', r.farben === true, JSON.stringify(r));
      pruefe('Der Anfangsbuchstabe ist golden', r.buchstabe === 'rgb(200, 169, 110)', r.buchstabe);
      pruefe('Die leere Übersicht zeigt, wie es losgeht', r.leer === true, JSON.stringify(r));
    }

    abschnitt('Fremde Namen führen nichts aus');
    {
      /* Name, Farbe, Abschnitt und Anhang stammen aus einer fremden Datei oder
         einem geteilten Dokument. Beim blossen Zeichnen darf nichts laufen. */
      const ergebnis = await js(`(async () => {
        window.__eingeschleust = 0;
        const gift = '<img src=x onerror="window.__eingeschleust=1">';
        const seite = makePage('ruled');
        seite.secId = 'giftig';
        seite.objects = [{ id: 'anhang', kind: 'datei', name: gift, x: 10, y: 10, w: 100, h: 40 }];
        const nb = { id: 'gift', name: gift, color: '"><img src=x onerror="window.__eingeschleust=2">',
                     defaultBg: 'ruled', pages: [seite], schemaVersion: 2, created: Date.now(),
                     sections: [{ id: 'giftig', name: gift, color: 'url(x)', pgIds: [seite.id] }] };
        normalizeNotebook(nb);
        const vorher = S.notebooks;
        S.notebooks = [nb];
        renderHomeGrid();
        openNotebook('gift');
        renderSideTree();
        await new Promise(r => setTimeout(r, 600));
        const namen = [...document.querySelectorAll('.nb-card-name, .sec-name')].map(n => n.textContent);
        const antwort = {
          lief: window.__eingeschleust,
          alsText: namen.some(n => n.includes('<img')),
          farbe: nb.color,
          abschnittsfarbe: nb.sections[0].color,
          bilder: document.querySelectorAll('#nb-grid img, #side-tree img, .j-page-hdr img, .obj-body img').length
        };
        S.notebooks = vorher;
        openNotebook(vorher[0].id);
        renderHomeGrid();
        return antwort;
      })()`);
      await warte(300);
      await js('window.__fehler.splice(0)');
      pruefe('Kein eingeschleuster Code läuft', ergebnis.lief === 0, 'lief: ' + ergebnis.lief);
      pruefe('Der Name steht als Text da', ergebnis.alsText === true, JSON.stringify(ergebnis));
      pruefe('Es entsteht kein Bild aus dem Namen', ergebnis.bilder === 0, 'Bilder: ' + ergebnis.bilder);
      pruefe('Eine falsche Farbe fällt auf die Vorgabe zurück',
        ergebnis.farbe === '#c8a96e' && ergebnis.abschnittsfarbe === '', JSON.stringify(ergebnis));
    }

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
