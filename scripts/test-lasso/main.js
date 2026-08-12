/* ══════════════════════════════════════════════════════════════════════
   EINKREISEN, AUF DEM BLATT BLEIBEN, LINEAL BEIM ZOOMEN

   Vier gemeldete Dinge, die alle nur im echten Chromium zu prüfen sind –
   sie hängen an Layout, an Zeigerereignissen und im ersten Fall sogar an
   der Uhr:

     · SCHNELL EINGEKREIST wählt aus, LANGSAM bleibt ein Strich
       (canvas/strokeSelect.js, versucheLasso). Der Unterschied ist allein
       das Tempo der Hand – ein Blick in den Code sagt darüber nichts.
     · Gezeichnetes und Objekte lassen sich NICHT mehr vom Blatt schieben
       (canvas/strokeSelect.js, canvas/objects.js).
     · Das LINEAL rechnet seine Länge und seine Millimeter beim Zoomen neu
       (ui/ruler.js an core/zoom.js). Vorher hing es an einem
       ResizeObserver, den ein transform:scale() nie auslöst.
     · Eine FORMEL als Objekt bekommt keinen Kasten mit zwei Zeilen Luft
       mehr (core/formula.js, measureFormula) und keine Wahl zwischen
       inline und Block (ui/formula.js).

   Gezeichnet wird mit ECHTEN Stift-Ereignissen über das
   Chrome-DevTools-Protokoll, nicht mit dispatchEvent: die Geste wird aus
   der Zeit zwischen den Ereignissen erkannt, und die entsteht nur, wenn
   sie wirklich vergeht.

   Läuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:lasso
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
app.disableHardwareAcceleration();

/* Die Handler des echten main.js gibt es hier nicht. Ohne Attrappen
   klagt die App beim Laden, und der Bericht geht im Rauschen unter. */
const ATTRAPPEN = {
  'load-settings': {}, 'save-settings': true, 'load-registry': { notebooks: [] },
  'save-registry': true, 'get-default-save-path': '', 'check-internet': false,
  'get-pending-deep-link': null, 'get-pending-share-link': null, 'pick-folder': null
};
for (const [kanal, wert] of Object.entries(ATTRAPPEN)) ipcMain.handle(kanal, async () => wert);

const zeilen = [];
const abschnitt = (name) => { zeilen.push(''); zeilen.push(name); };
const pruefe = (was, ok, hinweis) =>
  zeilen.push((ok ? 'ok   ' : 'FEHL ') + was + (ok ? '' : '  -> ' + hinweis));

function fertig(code) {
  process.stdout.write('\nEinkreisen und auf dem Blatt bleiben\n');
  process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');
  const fehl = zeilen.filter(l => /^(FEHL|ABBRUCH)/.test(l)).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : code);
}

setTimeout(() => { zeilen.push('ABBRUCH: Zeitgrenze erreicht'); fertig(2); }, 120000);

const warte = ms => new Promise(r => setTimeout(r, ms));

app.on('ready', async () => {
  try {
    /* Quer, damit sich die Seite nicht einpasst und der Zoom bei 1,2
       steht – die Rechnerei unten wird dadurch nachvollziehbar. */
    const win = new BrowserWindow({
      width: 1240, height: 940, show: true, backgroundColor: '#12121a',
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
    });
    await win.loadFile(path.join(ROOT, 'src', 'index.html'));
    await warte(2000);

    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    const js = (code) => win.webContents.executeJavaScript(code);

    // Ein Heft mit einer Seite – ohne Datei, ohne Cloud
    await js(`(() => {
      const nb = { id: 'probe', name: 'Probe', color: '#c8a96e', defaultBg: 'ruled',
                   pages: [makePage('ruled')], sections: [], created: Date.now() };
      S.notebooks = [nb];
      openNotebook('probe');
      return true;
    })()`);
    await warte(900);
    await js(`switchMode('pen1');
      window.__fehler = [];
      window.addEventListener('error', ev => window.__fehler.push(
        (ev.message || '') + ' @ ' + (ev.filename || '').split('/').pop() + ':' + ev.lineno));
      true`);
    await warte(200);

    /* ── Der Stift ────────────────────────────────────────────────────
       Aufsetzen, in Schritten ziehen, abheben. `pause` ist die Zeit
       zwischen zwei Punkten und damit das Tempo der Hand. */
    async function stiftZieht(punkte, pause) {
      const g = { button: 'left', pointerType: 'pen', force: 0.5 };
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', clickCount: 1, buttons: 1,
        x: Math.round(punkte[0].x), y: Math.round(punkte[0].y), ...g });
      for (let i = 1; i < punkte.length; i++) {
        if (pause) await warte(pause);
        await dbg.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved', buttons: 1,
          x: Math.round(punkte[i].x), y: Math.round(punkte[i].y), ...g });
      }
      const letzt = punkte[punkte.length - 1];
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', clickCount: 1, buttons: 0,
        x: Math.round(letzt.x), y: Math.round(letzt.y), ...g });
      await warte(250);
    }

    /* Ein Kreis aus 16 Punkten um eine Stelle des Bildschirms.

       >>> Warum er gross ist <<<
       Ob die Geste erkannt wird, haengt am Tempo, und das Tempo haengt
       hier daran, wie schnell das DevTools-Protokoll die sechzehn
       Ereignisse durchreicht – auf einem beschaeftigten Rechner sind das
       schnell ein paar hundert Millisekunden mehr. Ein grosser Kreis legt
       in derselben Zeit mehr Weg zurueck und haelt Abstand zur Schwelle;
       mit 110 px Radius kippte die Pruefung gelegentlich. */
    const kreis = (mx, my, r) => {
      const p = [];
      for (let i = 0; i <= 16; i++) {
        const w = (i / 16) * Math.PI * 2;
        p.push({ x: mx + Math.cos(w) * r, y: my + Math.sin(w) * r });
      }
      return p;
    };

    /** Eine gut sichtbare Stelle auf der Seite, unterhalb des Kopfes. */
    const stelle = () => js(`(() => {
      const r = document.querySelector('.j-page').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 300) }; })()`);

    /** Zwei kurze Striche um diese Bildschirmstelle herum – der Inhalt,
     *  der später eingekreist wird. */
    const legeStricheHin = (m) => js(`(() => {
      const pg = document.querySelector('.j-page');
      const r = pg.getBoundingClientRect(), z = getZoom();
      const cx = (${m.x} - r.left) / z, cy = (${m.y} - r.top) / z;
      const strich = (dy) => ({ path: [{x:cx-28,y:cy+dy,p:.5},{x:cx,y:cy+dy,p:.5},{x:cx+28,y:cy+dy,p:.5}],
                                color: '#1a1510', width: 3, isHL: false });
      S.strokeHistory[S.activePgId] = [strich(-14), strich(14)];
      const c = pg.querySelector('.j-canvas:not(.live-canvas)');
      redrawStrokes(c, S.strokeHistory[S.activePgId]);
      getPage(S.activePgId).page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[S.activePgId]));
      return true; })()`);

    const zustand = () => js(`(() => ({
      striche: (S.strokeHistory[S.activePgId] || []).length,
      auswahl: document.querySelectorAll('.ink-sel').length,
      leiste: document.querySelector('.ink-sel-bar') &&
              document.querySelector('.ink-sel-bar').style.display !== 'none' }))()`);

    /* ══════════════════════════════════════════════════════════════════
       SCHNELL EINGEKREIST
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Schnell einkreisen wählt aus');
    let m = await stelle();
    await legeStricheHin(m);
    await stiftZieht(kreis(m.x, m.y, 130), 0);

    let z = await zustand();
    pruefe('Die Schlinge bleibt nicht als Strich stehen (' + z.striche + ' Striche)',
      z.striche === 2, 'sie wurde gezeichnet statt verstanden; '
      + (await js(`(window.__fehler || []).join(' | ') || 'kein Fehler gemeldet'`)));
    pruefe('Stattdessen steht ein Auswahlrahmen da', z.auswahl === 1, 'kein .ink-sel');
    pruefe('Und die kleine Leiste dazu', z.leiste === true, 'sie fehlt');

    const drin = await js(`(() => {
      const h = document.querySelector('.ink-sel').getBoundingClientRect();
      const pg = document.querySelector('.j-page').getBoundingClientRect();
      return h.width > 20 && h.height > 20 && h.width < pg.width; })()`);
    pruefe('Der Rahmen umfasst das Eingekreiste', drin === true, 'er sitzt daneben');

    /* Und der Rückgängig-Stapel darf davon nichts wissen: hinzugefügt
       wurde ja nichts. */
    const schritte = await js(`(S.history[S.activePgId] || { undo: [] }).undo.length`);
    pruefe('Kein Rückgängig-Schritt für eine Geste (' + schritte + ')',
      schritte === 0, 'Strg+Z nähme jetzt etwas weg, das niemand hinzugefügt hat');

    /* ══════════════════════════════════════════════════════════════════
       LANGSAM GEZEICHNET
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Langsam gezeichnet bleibt ein Strich');
    await js(`deselectStroke()`);
    m = await stelle();
    await legeStricheHin(m);
    await stiftZieht(kreis(m.x, m.y, 130), 100);

    z = await zustand();
    pruefe('Der Kreis steht als dritter Strich da (' + z.striche + ')',
      z.striche === 3, 'er wurde als Auswahl verstanden');
    pruefe('Und niemand hat etwas ausgewählt', z.auswahl === 0, 'es kam ein Rahmen');

    /* ══════════════════════════════════════════════════════════════════
       NICHT VOM BLATT HERUNTER
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Ausgewähltes bleibt auf dem Blatt');
    await js(`deselectStroke()`);
    m = await stelle();
    await legeStricheHin(m);
    await stiftZieht(kreis(m.x, m.y, 130), 0);
    pruefe('Zum Verschieben liegt wieder eine Auswahl bereit',
      (await zustand()).auswahl === 1, 'keine Auswahl');

    // Weit über die rechte untere Ecke hinausziehen
    const huelle = await js(`(() => { const r = document.querySelector('.ink-sel').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await stiftZieht([
      huelle,
      { x: huelle.x + 400, y: huelle.y + 400 },
      { x: huelle.x + 900, y: huelle.y + 900 },
      { x: huelle.x + 1400, y: huelle.y + 1400 }
    ], 40);

    const lage = await js(`(() => {
      const info = getPage(S.activePgId);
      const pw = info.page.w || CFG.PAGE_W, ph = info.page.h || CFG.PAGE_H;
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (const s of S.strokeHistory[S.activePgId]) for (const p of s.path) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      return { minX: Math.round(minX), minY: Math.round(minY),
               maxX: Math.round(maxX), maxY: Math.round(maxY), pw, ph, hdr: CFG.HDR }; })()`);
    pruefe('Kein Strich liegt rechts oder unten neben dem Blatt ('
      + lage.maxX + '/' + lage.maxY + ' von ' + lage.pw + '/' + lage.ph + ')',
      lage.maxX <= lage.pw + 1 && lage.maxY <= lage.ph + 1, JSON.stringify(lage));

    /* Und dasselbe nach links oben, gegen den Seitenkopf. Mit einer
       FRISCHEN Auswahl: die eben verschobene liegt in der unteren rechten
       Ecke und damit ausserhalb des Fensters – ein Zug würde dort gar
       nicht mehr auf ihrem Rahmen aufsetzen, sondern einen neuen Strich
       malen. */
    await js(`deselectStroke()`);
    m = await stelle();
    await legeStricheHin(m);
    await stiftZieht(kreis(m.x, m.y, 130), 0);
    await stiftZieht([
      { x: m.x, y: m.y },
      { x: m.x - 350, y: m.y - 250 },
      { x: m.x - 700, y: m.y - 500 }
    ], 40);
    const lage2 = await js(`(() => {
      let minX = 1e9, minY = 1e9;
      for (const s of S.strokeHistory[S.activePgId]) for (const p of s.path) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      }
      return { minX: Math.round(minX), minY: Math.round(minY), hdr: CFG.HDR }; })()`);
    pruefe('Und keiner links oder im Seitenkopf ('
      + lage2.minX + '/' + lage2.minY + ', Kopf bis ' + lage2.hdr + ')',
      lage2.minX >= -1 && lage2.minY >= lage2.hdr - 1, JSON.stringify(lage2));

    /* ══════════════════════════════════════════════════════════════════
       EIN BILD BLEIBT EBENSO AUF DEM BLATT
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Ein Bild bleibt auf dem Blatt');
    await js(`deselectStroke(); switchMode('cursor')`);
    await warte(200);
    await js(`(() => {
      const info = getPage(S.activePgId);
      const obj = { id: 'probe-bild', kind: 'image', x: 300, y: 400, w: 200, h: 150, layer: 'front',
        src: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' };
      info.page.objects = [obj];
      const el = document.querySelector('[data-pgid="' + info.page.id + '"] .j-objects');
      el.innerHTML = '';
      placeObject(el, obj, info.page);
      return true; })()`);
    await warte(300);

    const bild = await js(`(() => { const r = document.querySelector('.obj-wrap').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const maus = async (punkte) => {
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', clickCount: 1, buttons: 1, button: 'left',
        x: Math.round(punkte[0].x), y: Math.round(punkte[0].y) });
      for (let i = 1; i < punkte.length; i++) {
        await warte(40);
        await dbg.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved', buttons: 1, button: 'left',
          x: Math.round(punkte[i].x), y: Math.round(punkte[i].y) });
      }
      const l = punkte[punkte.length - 1];
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', clickCount: 1, buttons: 0, button: 'left',
        x: Math.round(l.x), y: Math.round(l.y) });
      await warte(250);
    };
    await maus([bild, { x: bild.x - 500, y: bild.y - 400 }, { x: bild.x - 1000, y: bild.y - 800 }]);

    const bildLage = await js(`(() => { const o = getPage(S.activePgId).page.objects[0];
      return { x: Math.round(o.x), y: Math.round(o.y), hdr: CFG.HDR }; })()`);
    pruefe('Es stösst am linken Rand und am Seitenkopf an ('
      + bildLage.x + '/' + bildLage.y + ')',
      bildLage.x >= -1 && bildLage.y >= bildLage.hdr - 1, JSON.stringify(bildLage));

    /* ── Und trotzdem auf die nächste Seite ───────────────────────────
       Die Grenze darf den Weg zur nächsten Seite nicht verbauen: das
       Bild bleibt beim Ziehen zwar auf dem Blatt, entscheidend ist aber,
       wo LOSGELASSEN wird (canvas/objects.js, moveToPageAt). Sonst käme
       ein Bild nur noch über Ausschneiden und Einfügen weiter. */
    await js(`(() => {
      const nb = getNb();
      if (visiblePages(nb).length < 2) {
        const pg = makePage('ruled');
        insertPageInto(nb, activeSection(nb), pg);
        appendPageDOM(pg, visiblePages(nb).length - 1);
        renumberVisiblePages(); refreshSizer();
      }
      const erste = visiblePages(nb)[0];
      erste.objects[0].x = 280; erste.objects[0].y = 880;
      const el = document.querySelector('[data-pgid="' + erste.id + '"] .j-objects');
      el.innerHTML = ''; placeObject(el, erste.objects[0], erste);
      const s = document.querySelectorAll('.j-page'), sc = document.getElementById('pg-scroll');
      sc.scrollTop = Math.max(0, s[0].offsetTop * getZoom()
        + s[0].getBoundingClientRect().height - sc.clientHeight * 0.55);
      return true; })()`);
    await warte(500);

    const bild2 = await js(`(() => { const r = document.querySelector('.obj-wrap').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const ziel = await js(`(() => { const r = document.querySelectorAll('.j-page')[1].getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 120) }; })()`);
    await maus([bild2, { x: (bild2.x + ziel.x) / 2, y: (bild2.y + ziel.y) / 2 }, ziel]);

    const verteilt = await js(`(() => { const p = visiblePages(getNb());
      const o = (p[1].objects || [])[0];
      return { erste: (p[0].objects || []).length, zweite: (p[1].objects || []).length,
               y: o ? Math.round(o.y) : -1, hdr: CFG.HDR }; })()`);
    pruefe('Über den Rand gezogen springt es trotzdem auf die nächste Seite',
      verteilt.erste === 0 && verteilt.zweite === 1, JSON.stringify(verteilt));
    pruefe('Und fängt dort unter dem Seitenkopf an (y ' + verteilt.y + ')',
      verteilt.y >= verteilt.hdr - 1, JSON.stringify(verteilt));

    /* ══════════════════════════════════════════════════════════════════
       DIE SCHLINGE FÄNGT AUCH BILDER UND TEXT

       Sie kannte nur Gezeichnetes. Ein Bild mitten im Kreis blieb liegen,
       und Text ebenso – gemeldet als „beim Einkreisen sollten auch Bilder
       ausgewählt werden (und auch Text)".
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Schlinge fängt auch Bilder und Text');
    /* Auf der ERSTEN Seite: die Bild-Prüfung oben hat eine zweite
       angelegt, und gerechnet wird hier mit der ersten. */
    await js(`deselectStroke(); switchMode('pen1');
      document.getElementById('pg-scroll').scrollTop = 0;
      setActivePg(document.querySelector('.j-page').dataset.pgid); true`);
    await warte(400);
    m = await stelle(300);
    await js(`(() => {
      const info = getPage(S.activePgId);
      const pg = document.querySelector('.j-page');
      const r = pg.getBoundingClientRect(), z = getZoom();
      const cx = (${m.x} - r.left) / z, cy = (${m.y} - r.top) / z;
      S.strokeHistory[S.activePgId] = [];
      info.page.inkStrokes = [];
      const obj = { id: 'probe-bild2', kind: 'image', layer: 'front',
        x: Math.round(cx - 40), y: Math.round(cy - 30), w: 80, h: 60,
        src: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' };
      info.page.objects = [obj];
      const el = pg.querySelector('.j-objects');
      el.innerHTML = ''; placeObject(el, obj, info.page);
      return true; })()`);
    await warte(300);
    await stiftZieht(kreis(m.x, m.y, 130), 0);

    const mitBild = await js(`(() => ({
      auswahl: document.querySelectorAll('.ink-sel').length,
      striche: (S.strokeHistory[S.activePgId] || []).length,
      objekte: (getPage(S.activePgId).page.objects || []).length,
      imBaum: document.querySelectorAll('.obj-wrap').length,
      modus: S.mode }))()`);
    pruefe('Ein eingekreistes Bild wird ausgewählt', mitBild.auswahl === 1,
      JSON.stringify(mitBild));
    pruefe('Und die Schlinge bleibt nicht liegen', mitBild.striche === 0,
      JSON.stringify(mitBild));

    // Verschieben nimmt das Bild mit
    const vorZug = await js(`Math.round(getPage(S.activePgId).page.objects[0].x)`);
    const huelle2 = await js(`(() => { const r = document.querySelector('.ink-sel').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await stiftZieht([huelle2, { x: huelle2.x - 60, y: huelle2.y }, { x: huelle2.x - 120, y: huelle2.y }], 40);
    const nachZug = await js(`Math.round(getPage(S.activePgId).page.objects[0].x)`);
    pruefe('Und lässt sich mitverschieben (' + vorZug + ' auf ' + nachZug + ')',
      nachZug < vorZug - 40, 'es blieb liegen');

    /* Nur Text in der Schlinge: dann wird er markiert, denn verschieben
       lässt sich Text nicht – das ist eine Auswahl anderer Art. */
    await js(`(() => {
      deselectStroke();
      const info = getPage(S.activePgId);
      info.page.objects = [];
      document.querySelector('.j-objects').innerHTML = '';
      const td = document.querySelector('.j-text');
      td.innerHTML = '<p>Ein Satz zum Einkreisen hier.</p>';
      switchMode('pen1');
      return true; })()`);
    await warte(300);
    const wort = await js(`(() => { const p = document.querySelector('.j-text p');
      const r = p.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
               b: Math.round(r.width) }; })()`);
    await stiftZieht(kreis(wort.x, wort.y, Math.max(60, Math.round(wort.b / 2))), 0);
    const markiert = await js(`(() => { const s = getSelection();
      return { text: s.rangeCount ? s.getRangeAt(0).toString().trim() : '',
               modus: S.mode }; })()`);
    pruefe('Eingekreister Text wird markiert („' + markiert.text.slice(0, 24) + '")',
      markiert.text.length > 3, JSON.stringify(markiert));
    pruefe('Und das Werkzeug steht dafür auf dem Zeiger',
      markiert.modus === 'cursor', 'es blieb auf ' + markiert.modus);

    /* ══════════════════════════════════════════════════════════════════
       DAS LINEAL BEIM ZOOMEN
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Das Lineal wächst mit dem Zoom');
    await js(`toggleRuler()`);
    await warte(300);
    const vorZoom = await js(`(() => ({ z: getZoom(), w: getRulerState().w }))()`);
    await js(`setZoom(getZoom() * 1.5)`);
    await warte(400);
    const nachZoom = await js(`(() => ({ z: getZoom(), w: getRulerState().w }))()`);
    pruefe('Bei ' + vorZoom.z.toFixed(2) + ' ist es ' + vorZoom.w
      + ' px, bei ' + nachZoom.z.toFixed(2) + ' dann ' + nachZoom.w + ' px',
      nachZoom.w > vorZoom.w + 20,
      'die Länge blieb stehen – dann stimmen auch die Millimeter nicht mehr');

    const passt = await js(`(() => {
      const s = getRulerState(), sc = document.getElementById('pg-scroll').getBoundingClientRect();
      return s.x + s.w > sc.left + 60 && s.x < sc.right - 60
          && s.y + s.h > sc.top && s.y < sc.bottom; })()`);
    pruefe('Und es bleibt dabei im Sichtfeld', passt === true, 'es ist hinausgerutscht');
    await js(`toggleRuler(); zoomReset()`);
    await warte(300);

    /* ══════════════════════════════════════════════════════════════════
       DIE FORMEL
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Formel als Objekt');
    const mass = await js(`(() => {
      const mit = measureFormula('\\\\frac{1}{2}', true);
      // So wurde vorher gemessen: ohne die Klasse, also mit KaTeX' 1em
      // Aussenabstand oben und unten im Mess-Kasten
      const p = document.createElement('div');
      p.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap';
      p.innerHTML = renderFormula('\\\\frac{1}{2}', true).html;
      (document.querySelector('.j-text') || document.body).appendChild(p);
      const roh = Math.round(p.getBoundingClientRect().height / getZoom());
      p.remove();
      return { mit: mit.h, roh }; })()`);
    pruefe('Der Kasten misst die Formel, nicht ihren Aussenabstand ('
      + mass.mit + ' statt ' + mass.roh + ' px)',
      mass.mit < mass.roh - 8, 'oben und unten steht eine Zeile Luft im Rahmen');

    await js(`openFormulaEditor('x^2+1', false, null, null)`);
    await warte(300);
    const wahl = await js(`getComputedStyle(document.querySelector('.formula-display-row')).display`);
    pruefe('Inline oder Block wird gar nicht mehr gefragt', wahl === 'none',
      'die Wahl steht noch da – sie kommt bei einem freien Objekt aufs Gleiche heraus');

    await js(`document.getElementById('formula-ok').click()`);
    await warte(400);
    const formel = await js(`(() => {
      const o = (getPage(S.activePgId).page.objects || []).filter(o => o.kind === 'formula')[0];
      if (!o) return null;
      const el = document.querySelector('[data-objid="' + o.id + '"] .katex-display');
      return { display: o.display, h: Math.round(o.h),
               inhalt: el ? Math.round(el.getBoundingClientRect().height / getZoom()) : 0 }; })()`);
    pruefe('Sie wird in der grossen Setzweise gesetzt',
      !!formel && formel.display === true, JSON.stringify(formel));
    pruefe('Und ihr Rahmen sitzt eng darum (' + (formel ? formel.h + ' zu ' + formel.inhalt : '?') + ' px)',
      !!formel && Math.abs(formel.h - formel.inhalt) <= 6, JSON.stringify(formel));

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH ' + ((err && err.stack) || err));
    fertig(3);
  }
});
