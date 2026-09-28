/* ══════════════════════════════════════════════════════════════════════
   WER WAS DARF: STIFT, FINGER, MAUS

   Auf einem umklappbaren Laptop liegen drei Eingabegeräte nebeneinander,
   und jedes meint etwas anderes. Was hier geprüft wird, ist genau diese
   Aufteilung – sie ist mehrfach gemeldet worden und lässt sich weder
   durch Lesen noch mit synthetischen Ereignissen beantworten: es geht um
   Fokus, Bildschirmtastatur und um Tasten am Stiftschaft.

     · Der STIFT malt, auch wenn gerade der Zeiger gewählt ist. Sonst
       setzt sein Antippen die Schreibmarke, und auf dem Tablet fährt die
       Bildschirmtastatur heraus.
     · Seine untere TASTE radiert – ebenfalls aus der Zeigerstellung
       heraus, ohne den Umweg über zwei Knöpfe in der Leiste.
     · Seine obere TASTE kreist ein, statt auch zu radieren.
     · Der FINGER wählt mit einem Tipp aus, statt einen Punkt zu malen.
     · Der RADIERER nimmt eine gerade Linie ganz weg statt stückweise.
     · HALTEN am Ende macht aus dem Strich eine Gerade, auch wenn die
       Hand dabei zittert.
     · Das TABELLEN-RASTER lässt sich mit dem Finger aufziehen.
     · Das FORMEL-Fenster zieht nicht die Tastatur hoch.
     · ZURÜCK und VOR stehen als Knöpfe da, für Geräte ohne Tastatur.

   Läuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:stift
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
app.disableHardwareAcceleration();

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
  process.stdout.write('\nWer was darf: Stift, Finger, Maus\n');
  process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');
  const fehl = zeilen.filter(l => /^(FEHL|ABBRUCH)/.test(l)).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : code);
}

/* Die Zeitgrenze war 150 s und reichte nicht mehr: der Prüfstand ist um
   die Tabellen und das Bild über die Seitengrenze gewachsen, und jedes
   Ereignis geht einzeln durchs DevTools-Protokoll. Auf einem beschäftigten
   Rechner kostet eine Bewegung dort schnell eine Sekunde. */
setTimeout(() => { zeilen.push('ABBRUCH: Zeitgrenze erreicht'); fertig(2); }, 420000);
const warte = ms => new Promise(r => setTimeout(r, ms));


/* Die Oberflaeche fragt beim Hochfahren nach einer beim Start
   mitgegebenen Datei (main.js, get-pending-file). Hier gibt es keine -
   ohne diesen Griff protokolliert Electron aber einen Fehler, der mit
   dem Geprueften nichts zu tun hat. */
try { ipcMain.handle('get-pending-file', () => null); } catch (e) {}

app.on('ready', async () => {
  try {
    const win = new BrowserWindow({
      width: 1240, height: 940, show: true, backgroundColor: '#12121a',
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
    });
    await win.loadFile(path.join(ROOT, 'src', 'index.html'));
    await warte(2000);

    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });
    const js = (code) => win.webContents.executeJavaScript(code);

    await js(`(() => {
      const nb = { id: 'probe', name: 'Probe', color: '#c8a96e', defaultBg: 'ruled',
                   pages: [makePage('ruled')], sections: [], created: Date.now() };
      S.notebooks = [nb];
      openNotebook('probe');
      return true;
    })()`);
    await warte(900);

    /* ── Werkzeuge zum Zeichnen ───────────────────────────────────────
       `tasten` ist die Bitmaske: 1 Spitze, 2 untere Schafttaste,
       32 Radierer-Zeichen (die obere). */
    async function stiftZieht(punkte, pause, tasten = 1) {
      const g = { pointerType: 'pen', force: 0.5 };
      /* Immer die Spitze („left"): sie ist es, die die Seite berührt. Die
         Schafttasten stehen daneben in der Maske – genau so meldet es ein
         echter Stift, der mit gedrückter Taste aufsetzt (buttons 3). Mit
         button: 'right' kommt gar kein pointerdown an, weil der Stift
         dabei nicht als aufgesetzt gilt. */
      const knopf = 'left';
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', clickCount: 1, button: knopf, buttons: tasten,
        x: Math.round(punkte[0].x), y: Math.round(punkte[0].y), ...g });
      for (let i = 1; i < punkte.length; i++) {
        if (pause) await warte(pause);
        await dbg.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved', button: knopf, buttons: tasten,
          x: Math.round(punkte[i].x), y: Math.round(punkte[i].y), ...g });
      }
      const l = punkte[punkte.length - 1];
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', clickCount: 1, button: knopf, buttons: 0,
        x: Math.round(l.x), y: Math.round(l.y), ...g });
      await warte(260);
    }

    /* ── Der Stift MIT gedrückter Schafttaste ─────────────────────────
       Über das DevTools-Protokoll geht das nicht: `buttons` mit Bit 2
       oder 32 kommt gar nicht erst als pointerdown an, und mit
       button: 'right' gilt der Stift als nicht aufgesetzt. Gemessen
       nachgestellt, nicht geraten – deshalb hier selbst gebaute
       Zeigerereignisse. Sie laufen durch dieselben Handgriffe wie ein
       echter Stift. Die Codes stammen vom Geraet selbst: 32 („Radierer-
       Zeichen") schickt dort die UNTERE Taste, 2 („Rechtsklick") die
       obere – umgekehrt, als man vermuten wuerde. */
    async function stiftMitTaste(punkte, tasten, ohneAbheben) {
      await js(`(() => {
        const pg = document.querySelector('.j-page');
        const p = ${JSON.stringify(punkte)};
        window.__stiftSchick = (art, x, y, b) => pg.dispatchEvent(new PointerEvent(art, {
          bubbles: true, cancelable: true, pointerId: 7, pointerType: 'pen',
          buttons: b, button: art === 'pointermove' ? -1 : 0,
          clientX: x, clientY: y, pressure: art === 'pointerup' ? 0 : .5 }));
        __stiftSchick('pointerdown', p[0].x, p[0].y, ${tasten});
        for (let i = 1; i < p.length; i++) __stiftSchick('pointermove', p[i].x, p[i].y, ${tasten});
        if (!${!!ohneAbheben}) __stiftSchick('pointerup', p[p.length - 1].x, p[p.length - 1].y, 0);
        return true; })()`);
      await warte(300);
    }

    const stiftAbheben = async (p) => {
      await js(`__stiftSchick('pointerup', ${p.x}, ${p.y}, 0)`);
      await warte(300);
    };

    /* Solange der Stift in der Naehe ist, gilt eine Beruehrung als die Hand,
       die beim Schreiben aufliegt (core/state.js, stiftInDerNaehe). Ein
       Finger kommt deshalb erst, wenn der Stift wirklich weg ist – wie in
       echt: erst den Stift absetzen, dann tippen. */
    async function bisStiftWeg() {
      for (let i = 0; i < 40 && await js('stiftInDerNaehe()'); i++) await warte(50);
    }

    async function fingerTippt(x, y) {
      await bisStiftWeg();
      await dbg.sendCommand('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y), id: 1, force: 1 }] });
      await warte(60);
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await warte(300);
    }

    async function fingerZieht(punkte, pause = 40) {
      await bisStiftWeg();
      await dbg.sendCommand('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: Math.round(punkte[0].x), y: Math.round(punkte[0].y), id: 1, force: 1 }] });
      for (let i = 1; i < punkte.length; i++) {
        await warte(pause);
        await dbg.sendCommand('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: Math.round(punkte[i].x), y: Math.round(punkte[i].y), id: 1, force: 1 }] });
      }
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await warte(300);
    }

    /** Eine gut sichtbare Stelle auf der Seite, unterhalb des Kopfes. */
    const stelle = (dy = 300) => js(`(() => {
      const r = document.querySelector('.j-page').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + ${dy}) }; })()`);

    /** Legt Striche in Seitenkoordinaten um eine Bildschirmstelle. */
    const legeHin = (m, art) => js(`(() => {
      const pg = document.querySelector('.j-page');
      const r = pg.getBoundingClientRect(), z = getZoom();
      const cx = (${m.x} - r.left) / z, cy = (${m.y} - r.top) / z;
      const punkte = [];
      if ('${art}' === 'gerade') {
        punkte.push({ x: cx - 90, y: cy, p: .5 }, { x: cx + 90, y: cy, p: .5 });
      } else {
        for (let i = 0; i <= 20; i++) {
          punkte.push({ x: cx - 90 + i * 9, y: cy + Math.sin(i) * 14, p: .5 });
        }
      }
      S.strokeHistory[S.activePgId] = [{ path: punkte, color: '#1a1510', width: 3, isHL: false }];
      const c = pg.querySelector('.j-canvas:not(.live-canvas)');
      redrawStrokes(c, S.strokeHistory[S.activePgId]);
      getPage(S.activePgId).page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[S.activePgId]));
      return true; })()`);

    const zahl = (was) => js(`(() => (${was}))()`);

    /* ══════════════════════════════════════════════════════════════════
       DER STIFT MALT VON SELBST
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Der Stift malt, auch aus der Zeigerstellung');
    await js(`switchMode('cursor'); S.strokeHistory[S.activePgId] = []; true`);
    await warte(200);
    let m = await stelle();
    await stiftZieht([m, { x: m.x + 60, y: m.y + 40 }, { x: m.x + 130, y: m.y + 10 }], 25);

    const nachStift = await js(`(() => ({
      striche: (S.strokeHistory[S.activePgId] || []).length,
      modus: S.mode,
      imText: !!(document.activeElement && document.activeElement.classList
                 && document.activeElement.classList.contains('j-text')) }))()`);
    pruefe('Ein Zug hinterlässt einen Strich (' + nachStift.striche + ')',
      nachStift.striche === 1, 'der Stift schrieb nicht');
    pruefe('Und das Werkzeug steht danach auf dem Stift (' + nachStift.modus + ')',
      nachStift.modus === 'pen1', 'es blieb auf ' + nachStift.modus);
    pruefe('Die Schreibmarke bleibt aus dem Text heraus',
      nachStift.imText === false, 'der Text hat den Fokus – die Tastatur fährt hoch');

    /* ══════════════════════════════════════════════════════════════════
       WO DER LAUFENDE STRICH LIEGT – UND WO ER LANDET

       Der Strich entsteht auf der VORSCHAU, in einem Zug je Bild, und
       geht erst beim Abheben auf das Blatt ueber (canvas/input.js,
       stiftVorschau). Das ist der Grund, warum eine duenne Linie nicht
       mehr fleckig aussieht – gemalt wird sie einmal statt Stueck fuer
       Stueck uebereinander.

       Beide Haelften sind hier zu pruefen, denn jede kann fuer sich
       kaputtgehen und die andere sieht dann noch richtig aus:
         · waehrend des Ziehens darf auf dem BLATT nichts stehen,
           sonst laege der Strich doppelt (und der Marker doppelt kraeftig)
         · nach dem Abheben MUSS er auf dem Blatt stehen, sonst waere er
           mit der Vorschau verschwunden
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Der laufende Strich liegt auf der Vorschau, der fertige auf dem Blatt');
    await js(`(() => {
      switchMode('pen1');
      const pg = document.querySelector('.j-page[data-pgid="' + S.activePgId + '"]');
      const c = pg.querySelector('.j-canvas:not(.live-canvas)');
      S.strokeHistory[S.activePgId] = [];
      redrawStrokes(c, []);
      return true; })()`);
    await warte(200);

    m = await stelle();
    const waagrecht = [];
    for (let i = 0; i <= 24; i++) waagrecht.push({ x: Math.round(m.x - 110 + i * 9), y: Math.round(m.y) });
    const mitte = waagrecht[12];

    /* Ein einzelnes Pixel zu befragen waere zu heikel: die duenne Linie
       liegt vielleicht einen halben Punkt daneben. Gesucht wird deshalb
       der kraeftigste Punkt in einem kleinen Fenster darum. */
    const messe = `(() => {
      const pg = document.querySelector('.j-page[data-pgid="' + S.activePgId + '"]');
      const bl = pg && pg.querySelector('.j-canvas:not(.live-canvas)');
      const lc = document.querySelector('.live-canvas');
      const staerkste = (c) => {
        if (!c) return -1;
        const r = c.getBoundingClientRect();
        const k = c.width / r.width;
        const x = Math.round((${mitte.x} - r.left) * k), y = Math.round((${mitte.y} - r.top) * k);
        const n = Math.max(1, Math.round(4 * k));
        const d = c.getContext('2d').getImageData(x - n, y - n, n * 2 + 1, n * 2 + 1).data;
        let max = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > max) max = d[i];
        return max;
      };
      return { blatt: staerkste(bl), vorschau: staerkste(lc),
               deckkraft: lc ? getComputedStyle(lc).opacity : '' }; })()`;

    await stiftMitTaste(waagrecht, 1, true);   // noch aufgesetzt
    const beimZiehen = await js(messe);
    pruefe('Beim Ziehen steht er auf der Vorschau (Alpha ' + beimZiehen.vorschau + ')',
      beimZiehen.vorschau > 200, 'die Vorschau ist leer – gar nichts zu sehen');
    pruefe('Und noch nicht auf dem Blatt (Alpha ' + beimZiehen.blatt + ')',
      beimZiehen.blatt === 0, 'er liegt doppelt: Vorschau UND Blatt');
    /* Die 38 % der Vorschau gehoeren dem Marker. Blieben sie auch fuer
       den Stift stehen, waere die Schrift beim Schreiben blass und
       spraenge beim Abheben auf ihre wirkliche Farbe. */
    pruefe('Und in seiner vollen Farbe (Deckkraft ' + beimZiehen.deckkraft + ')',
      Math.abs(+beimZiehen.deckkraft - 1) < 0.01, 'er wird blass gemalt wie ein Marker');

    await stiftAbheben(waagrecht[waagrecht.length - 1]);
    const nachAbheben = await js(messe);
    pruefe('Nach dem Abheben steht er auf dem Blatt (Alpha ' + nachAbheben.blatt + ')',
      nachAbheben.blatt > 200, 'er ist mit der Vorschau verschwunden');
    pruefe('Und die Vorschau ist leer (Alpha ' + nachAbheben.vorschau + ')',
      nachAbheben.vorschau <= 0, 'sie liegt noch darueber');

    /* ══════════════════════════════════════════════════════════════════
       DIE UNTERE TASTE RADIERT
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die untere Schafttaste radiert');
    await js(`switchMode('cursor'); true`);
    m = await stelle();
    await legeHin(m, 'krumm');
    /* buttons 33 = Spitze auf dem Blatt UND das Radierer-Zeichen. Genau
       das schickt die untere Taste – an diesem Stift gemessen, nicht aus
       der Spezifikation abgeleitet (canvas/input.js). */
    await stiftMitTaste([{ x: m.x - 100, y: m.y }, { x: m.x, y: m.y }, { x: m.x + 100, y: m.y }], 33);

    /* Der Radierer legt keinen eigenen Strich mehr an, er zerschneidet
       (canvas/input.js, radiereBei). Radiert hat er also, wenn der
       hingelegte Strich – der hat keine Kennung – nicht mehr unverändert
       dasteht; ein Radierstrich darf dabei nicht übrig bleiben. */
    const nachRadier = await js(`(() => { const L = S.strokeHistory[S.activePgId] || [];
      return { radierer: L.filter(s => s.isEraser).length,
               unveraendert: L.length === 1 && !L[0].id, modus: S.mode }; })()`);
    pruefe('Sie radiert auch, wenn der Zeiger gewählt war',
      !nachRadier.unveraendert, 'der Strich steht unverändert da');
    pruefe('Und hinterlässt keinen Radierstrich (' + nachRadier.radierer + ')',
      nachRadier.radierer === 0, 'es liegt ein Radierstrich in der Seite');
    pruefe('Und danach steht das Werkzeug wieder, wo es war (' + nachRadier.modus + ')',
      nachRadier.modus === 'cursor', 'es blieb auf ' + nachRadier.modus);

    /* ══════════════════════════════════════════════════════════════════
       EINE GERADE LINIE GEHT GANZ WEG
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Der Radierer nimmt eine gerade Linie ganz weg');
    await js(`switchMode('eraser'); S.eraser.type = 'pixel'; true`);
    await warte(200);
    m = await stelle();
    await legeHin(m, 'gerade');
    await stiftZieht([{ x: m.x - 10, y: m.y }, { x: m.x + 10, y: m.y }], 30);

    const nachGerade = await zahl(`(S.strokeHistory[S.activePgId] || []).filter(s => !s.isEraser).length`);
    pruefe('Sie ist ganz weg, nicht angeknabbert (' + nachGerade + ' übrig)',
      nachGerade === 0, 'es blieben Reste stehen');

    /* Und Handschrift bleibt punktweise – sonst wäre ein Wort schon beim
       Streifen verloren. */
    await js(`switchMode('pen1'); true`);
    m = await stelle(420);
    await legeHin(m, 'krumm');
    await js(`switchMode('eraser'); true`);
    await stiftZieht([{ x: m.x - 10, y: m.y }, { x: m.x + 10, y: m.y }], 30);
    const nachKrumm = await zahl(`(S.strokeHistory[S.activePgId] || []).filter(s => !s.isEraser).length`);
    // Zerschnitten: Reste links und rechts vom Radierer
    pruefe('Gekritzel dagegen wird nur angeknabbert (' + nachKrumm + ' Reste)', nachKrumm >= 2,
      nachKrumm === 0 ? 'auch die Handschrift verschwand ganz' : 'sie blieb unzerschnitten');

    /* ══════════════════════════════════════════════════════════════════
       HALTEN MACHT EINE GERADE – AUCH MIT ZITTERNDER HAND
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Halten am Ende macht eine Gerade');
    await js(`switchMode('pen1'); S.strokeHistory[S.activePgId] = []; true`);
    await warte(200);
    m = await stelle(500);
    const weg = [{ x: m.x - 120, y: m.y }];
    for (let i = 1; i <= 8; i++) weg.push({ x: m.x - 120 + i * 30, y: m.y + (i % 2 ? 6 : -6) });
    // Und dann liegen bleiben – aber nicht totenstill, wie eine echte Hand
    for (let i = 0; i < 10; i++) weg.push({ x: m.x + 120 + (i % 2 ? 1 : -1), y: m.y + (i % 2 ? 1 : -1) });
    await stiftZieht(weg, 60);

    const gerade = await js(`(() => { const s = (S.strokeHistory[S.activePgId] || [])[0];
      return s ? s.path.length : -1; })()`);
    pruefe('Aus dem Strich wird eine Gerade (' + gerade + ' Punkte)',
      gerade === 2, 'er blieb krumm – das Zittern zog die Uhr immer wieder auf');

    /* ══════════════════════════════════════════════════════════════════
       DIE OBERE TASTE KREIST EIN
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die obere Schafttaste kreist ein');
    await js(`switchMode('pen1'); true`);
    m = await stelle(300);
    await legeHin(m, 'krumm');
    const schlinge = [];
    for (let i = 0; i <= 16; i++) {
      const w = i / 16 * Math.PI * 2;
      schlinge.push({ x: Math.round(m.x + Math.cos(w) * 130), y: Math.round(m.y + Math.sin(w) * 60) });
    }
    // buttons 3 = Spitze plus Rechtsklick – das schickt die obere Taste
    await stiftMitTaste(schlinge, 3, true);

    /* Noch aufgesetzt: so sieht die Schlinge aus. Gefragt ist nicht das
       Aussehen im Einzelnen, sondern dass sie überhaupt auf der Vorschau
       landet und nicht auf dem Blatt – und dass deren Marker-Blässe für
       sie abgeschaltet ist. */
    const vorschau = await js(`(() => {
      const lc = document.querySelector('.live-canvas');
      if (!lc) return null;
      const r = lc.getBoundingClientRect();
      const proPx = lc.width / r.width;
      const lies = (x, y) => lc.getContext('2d').getImageData(
        Math.round((x - r.left) * proPx), Math.round((y - r.top) * proPx), 1, 1).data[3];
      return { deckkraft: getComputedStyle(lc).opacity,
               innen: lies(${m.x}, ${m.y}),
               aussen: lies(r.left + 4, r.top + 4) }; })()`);
    pruefe('Die Schlinge liegt auf der Vorschau, nicht auf dem Blatt',
      !!vorschau, 'es gibt keine Vorschau-Fläche');
    if (vorschau) {
      pruefe('Ihr Inneres ist blass gefüllt (Alpha ' + vorschau.innen + ')',
        vorschau.innen > 8 && vorschau.innen < 120,
        'entweder gar nicht oder viel zu kräftig gefüllt');
      pruefe('Draussen bleibt frei (Alpha ' + vorschau.aussen + ')',
        vorschau.aussen === 0, 'die Füllung läuft über die Schlinge hinaus');
      pruefe('Und die Marker-Blässe gilt nicht für sie (' + vorschau.deckkraft + ')',
        Math.abs(+vorschau.deckkraft - 1) < 0.01, 'sie wird zusätzlich durchsichtig gemalt');
    }
    await stiftAbheben(schlinge[schlinge.length - 1]);

    const nachLasso = await js(`(() => ({
      striche: (S.strokeHistory[S.activePgId] || []).length,
      auswahl: document.querySelectorAll('.ink-sel').length }))()`);
    pruefe('Die Schlinge bleibt nicht liegen (' + nachLasso.striche + ' Striche)',
      nachLasso.striche === 1, 'sie wurde als Strich gespeichert');
    pruefe('Und das Eingekreiste ist ausgewählt', nachLasso.auswahl === 1,
      'kein Auswahlrahmen – die obere Taste radierte wohl wieder');

    /* ══════════════════════════════════════════════════════════════════
       EIN TIPP MIT DEM FINGER WÄHLT AUS
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Ein Tipp mit dem Finger wählt aus');
    await js(`deselectStroke(); S.touchDraw = true; switchMode('pen1'); true`);
    await warte(200);
    m = await stelle(300);
    await legeHin(m, 'gerade');
    await fingerTippt(m.x, m.y);

    const nachTipp = await js(`(() => ({
      striche: (S.strokeHistory[S.activePgId] || []).length,
      auswahl: document.querySelectorAll('.ink-sel').length,
      modus: S.mode,
      imText: !!(document.activeElement && document.activeElement.classList
                 && document.activeElement.classList.contains('j-text')) }))()`);
    pruefe('Er malt keinen Punkt (' + nachTipp.striche + ' Striche)',
      nachTipp.striche === 1, 'es kam ein Punkt dazu');
    pruefe('Sondern wählt den Strich aus', nachTipp.auswahl === 1, 'kein Auswahlrahmen');
    pruefe('Und stellt dafür auf den Zeiger um (' + nachTipp.modus + ')',
      nachTipp.modus === 'cursor', 'das Werkzeug blieb auf ' + nachTipp.modus);
    pruefe('Ohne die Schreibmarke in die Zeile zu setzen',
      nachTipp.imText === false, 'der Text hat den Fokus – die Tastatur fährt hoch');

    /* Und mit AUSGESCHALTETEM „mit dem Finger malen" ebenso: dort
       entsteht gar kein Strich, aus dem man einen Tipp ablesen könnte –
       der Finger scrollt. Ohne einen eigenen Weg käme man an einen Strich
       dann überhaupt nicht mehr heran. */
    await js(`deselectStroke(); S.touchDraw = false; switchMode('pen1'); true`);
    await warte(200);
    m = await stelle(300);
    await legeHin(m, 'gerade');
    await fingerTippt(m.x, m.y);
    const ohneFingerMalen = await js(`(() => ({
      striche: (S.strokeHistory[S.activePgId] || []).length,
      auswahl: document.querySelectorAll('.ink-sel').length, modus: S.mode }))()`);
    pruefe('Auch ohne „mit dem Finger malen" wählt der Tipp aus',
      ohneFingerMalen.auswahl === 1 && ohneFingerMalen.striche === 1
      && ohneFingerMalen.modus === 'cursor', JSON.stringify(ohneFingerMalen));
    await js(`deselectStroke(); S.touchDraw = true; true`);

    /* Und ein gezogener Finger malt weiterhin, sonst wäre der Schalter
       „mit dem Finger malen" nutzlos geworden. */
    await js(`deselectStroke(); switchMode('pen1'); S.strokeHistory[S.activePgId] = []; true`);
    await warte(200);
    m = await stelle(560);
    await fingerZieht([m, { x: m.x + 60, y: m.y + 30 }, { x: m.x + 120, y: m.y }], 30);
    const fingerStrich = await zahl(`(S.strokeHistory[S.activePgId] || []).length`);
    pruefe('Ein gezogener Finger malt weiter', fingerStrich === 1, 'er malte nichts');

    /* ══════════════════════════════════════════════════════════════════
       UND SCHREIBEN GEHT WEITERHIN

       Der Finger ist das Zeigegerät – dazu gehört, die Schreibmarke zu
       setzen. Gemeldet wurde das Gegenteil: nach dem Zeichnen liess sich
       mit dem Finger in keine Zeile mehr tippen, nur noch mit der Maus.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Mit dem Finger in eine Zeile tippen');
    await js(`deselectStroke(); switchMode('pen1'); true`);
    await warte(200);
    m = await stelle(300);
    // Erst mit dem Finger etwas malen – das ist der Zustand, aus dem heraus
    // es gemeldet wurde
    await fingerZieht([{ x: m.x - 60, y: m.y }, { x: m.x, y: m.y + 20 }, { x: m.x + 60, y: m.y }], 30);
    await js(`switchMode('cursor');
      document.querySelector('.j-text').innerHTML = '<p>Erste Zeile</p><p>Zweite Zeile</p>';
      getSelection().removeAllRanges();
      document.activeElement && document.activeElement.blur(); true`);
    await warte(300);

    const zeile = await js(`(() => {
      const p = document.querySelectorAll('.j-text p')[1];
      const r = p.getBoundingClientRect();
      return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) }; })()`);
    await fingerTippt(zeile.x, zeile.y);

    const marke = await js(`(() => { const s = getSelection();
      const td = document.querySelector('.j-text');
      return { imText: !!(s.rangeCount && td.contains(s.getRangeAt(0).startContainer)),
               fokus: document.activeElement === td,
               durchlaessig: getComputedStyle(td).pointerEvents }; })()`);
    pruefe('Ein Tipp auf eine Zeile setzt die Schreibmarke',
      marke.imText === true, JSON.stringify(marke));
    pruefe('Und das Textfeld nimmt Zeiger überhaupt an ('
      + marke.durchlaessig + ')', marke.durchlaessig !== 'none',
      'es steht auf pointer-events: none – dann trifft nur noch die Maus');

    /* >>> Und dasselbe mit gewaehltem Stift <<<
       Das ist der Fall, aus dem heraus es gemeldet wurde: seit der Stift
       das Werkzeug selbst umstellt, steht fast immer ein Zeichenwerkzeug
       da – und dessen Zeichenflaeche liegt ueber dem Text. Beide Schalter
       fuer den Finger, denn die Wege dorthin sind verschieden. */
    for (const malen of [true, false]) {
      await js(`deselectStroke(); S.touchDraw = ${malen}; switchMode('pen1');
        getSelection().removeAllRanges();
        document.activeElement && document.activeElement.blur(); true`);
      await warte(250);
      const vorher = await zahl(`(S.strokeHistory[S.activePgId] || []).length`);
      await fingerTippt(zeile.x, zeile.y);
      const imStift = await js(`(() => { const s = getSelection();
        const td = document.querySelector('.j-text');
        return { imText: !!(s.rangeCount && td.contains(s.getRangeAt(0).startContainer)),
                 modus: S.mode,
                 punkte: (S.strokeHistory[S.activePgId] || []).length }; })()`);
      pruefe('Auch mit gewähltem Stift (Finger-Malen ' + (malen ? 'an' : 'aus') + ')',
        imStift.imText === true && imStift.modus === 'cursor',
        JSON.stringify(imStift));
      pruefe('  und es bleibt kein Punkt liegen', imStift.punkte === vorher,
        'aus dem Tipp wurde ein Strich: ' + vorher + ' auf ' + imStift.punkte);
    }
    await js(`S.touchDraw = true; true`);

    /* ══════════════════════════════════════════════════════════════════
       EINE FORM MIT DEM FINGER ANFASSEN

       Gemeldet als „entweder male ich die ganze Zeit, oder ich muss ganz
       genau den Rand der Form treffen". Beides: mit gewähltem Stift
       nehmen Objekte keine Zeiger an, und eine Ellipse ohne Füllung
       besteht nur aus ihrem Umriss.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Eine Form mit dem Finger anfassen');
    await js(`deselectStroke(); switchMode('pen1'); true`);
    await warte(200);
    await js(`(() => {
      const info = getPage(S.activePgId);
      const obj = { id: 'probe-form', kind: 'shape', shapeType: 'ellipse',
                    x: 260, y: 300, w: 220, h: 150, layer: 'front',
                    fill: 'none', stroke: '#1a1510', strokeWidth: 2 };
      info.page.objects = [obj];
      const el = document.querySelector('[data-pgid="' + info.page.id + '"] .j-objects');
      el.innerHTML = ''; placeObject(el, obj, info.page);
      return true; })()`);
    await warte(300);

    // Mitten in die Ellipse, wo nichts als Luft ist
    const inDerForm = await js(`(() => {
      const r = document.querySelector('.obj-wrap').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const vorForm = await zahl(`(S.strokeHistory[S.activePgId] || []).length`);
    await fingerTippt(inDerForm.x, inDerForm.y);

    const formLage = await js(`(() => ({
      gewaehlt: !!document.querySelector('.obj-wrap.selected'),
      modus: S.mode,
      striche: (S.strokeHistory[S.activePgId] || []).length }))()`);
    pruefe('Ein Tipp in die Fläche wählt die Form aus',
      formLage.gewaehlt === true, JSON.stringify(formLage));
    pruefe('Und stellt dafür auf den Zeiger um (' + formLage.modus + ')',
      formLage.modus === 'cursor', 'das Werkzeug blieb auf ' + formLage.modus);
    pruefe('Statt darauf zu malen', formLage.striche === vorForm,
      'es kam ein Strich dazu');

    /* ══════════════════════════════════════════════════════════════════
       TAB IM STICHPUNKT

       Der Unterpunkt entstand, aber die Marke sprang in die nächste
       Zeile: die gemerkte Stelle ist eine Zeichenposition im flachen
       Text, und eine Verschachtelungsebene mehr heisst dort ein
       Zeilenumbruch mehr (core/lists.js).
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Tab im Stichpunkt');
    await js(`(() => {
      switchMode('cursor');
      const td = document.querySelector('.j-text');
      td.innerHTML = '<ul class="j-list-disc"><li>Erster</li><li>Zweiter</li></ul>';
      td.focus();
      const li = td.querySelectorAll('li')[1];
      const r = document.createRange();
      r.selectNodeContents(li); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return true; })()`);
    await warte(250);
    await dbg.sendCommand('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
    await dbg.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
    await warte(350);

    const nachTab = await js(`(() => {
      const td = document.querySelector('.j-text');
      const s = getSelection();
      let k = s.rangeCount ? s.getRangeAt(0).startContainer : null;
      if (k && k.nodeType === 3) k = k.parentNode;
      const li = k && k.closest ? k.closest('li') : null;
      return { tiefe: td.querySelectorAll('ul ul').length,
               imPunkt: li ? (li.textContent || '').trim() : null }; })()`);
    pruefe('Tab macht einen Unterpunkt', nachTab.tiefe >= 1, JSON.stringify(nachTab));
    pruefe('Und die Marke bleibt in dieser Zeile („' + nachTab.imPunkt + '")',
      nachTab.imPunkt === 'Zweiter', 'sie ist woanders gelandet');

    /* ══════════════════════════════════════════════════════════════════
       DAS TABELLEN-RASTER MIT DEM FINGER
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Das Tabellen-Raster mit dem Finger');
    await js(`switchMode('cursor');
      const td = document.querySelector('.j-text');
      td.innerHTML = '<p>Text</p>';
      td.focus();
      setFlatCaret(td, 4); true`);
    await warte(300);
    await js(`document.getElementById('btn-table').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true })); true`);
    await warte(300);

    const feld = (r, c) => js(`(() => {
      const z = document.querySelector('.tbl-cell[data-r="${r}"][data-c="${c}"]');
      if (!z) return null; const b = z.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);

    const a1 = await feld(1, 1), a34 = await feld(3, 4);
    if (!a1 || !a34) {
      pruefe('Das Raster steht offen', false, 'die Felder sind nicht zu finden');
    } else {
      /* Erst ziehen, ohne abzuheben: dann steht in der Beschriftung, was
         das Raster gerade versteht. Beides getrennt zu prüfen sagt im
         Fehlerfall, woran es lag – am Verfolgen oder am Einsetzen. */
      const mitte = { x: Math.round((a1.x + a34.x) / 2), y: Math.round((a1.y + a34.y) / 2) };
      await bisStiftWeg();
      await dbg.sendCommand('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: a1.x, y: a1.y, id: 1, force: 1 }] });
      for (const p of [mitte, a34]) {
        await warte(60);
        await dbg.sendCommand('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1, force: 1 }] });
      }
      await warte(60);
      const marke = (await js(`document.getElementById('tbl-grid-label').textContent`)).trim();
      pruefe('Der gezogene Finger führt die Grösse mit („' + marke + '")',
        /^3\s*×\s*4/.test(marke), 'das Raster folgt dem Finger nicht');

      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await warte(400);
      const tab = await js(`(() => { const t = document.querySelector('.j-text table');
        if (!t) return null;
        return { zeilen: t.rows.length, spalten: t.rows[0] ? t.rows[0].cells.length : 0 }; })()`);
      pruefe('Und beim Abheben steht die Tabelle da ('
        + (tab ? tab.zeilen + '×' + tab.spalten : 'keine') + ')',
        !!tab && tab.zeilen === 3 && tab.spalten === 4,
        'es kam ' + JSON.stringify(tab) + ' statt 3×4');
    }

    /* Und ohne Schreibmarke? Dann kam gar nichts – „erst in den Text
       klicken" ist eine Absage, kein Ergebnis. Jetzt geht sie in die
       Mitte der Seite (core/tables.js). */
    await js(`(() => {
      const td = document.querySelector('.j-text');
      td.innerHTML = '<p>Text</p>';
      getSelection().removeAllRanges();
      td.blur();
      switchMode('pen1');
      return true; })()`);
    await warte(250);
    const ohneMarke = await js(`(() => {
      const vorher = document.querySelectorAll('.j-text table').length;
      insertTable(2, 2);
      return { vorher, nachher: document.querySelectorAll('.j-text table').length }; })()`);
    pruefe('Ohne Schreibmarke landet die Tabelle trotzdem auf der Seite',
      ohneMarke.nachher === ohneMarke.vorher + 1, JSON.stringify(ohneMarke));

    /* ══════════════════════════════════════════════════════════════════
       DIE TABELLE ANFASSEN

       Zwei Meldungen in einem: „das Verschieben geht überhaupt nicht"
       und „wenn man an einer Spalte zieht, skaliert sich alles auf
       einmal". Beides ist eine Zeigerfrage und deshalb nur mit echten
       Ereignissen zu messen.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Tabelle anfassen');

    const tabelleAufbauen = () => js(`(() => {
      switchMode('cursor');
      const td = document.querySelector('.j-text');
      td.innerHTML = '<p>oben</p>'
        + '<table class="j-table"><tbody>'
        + '<tr><td>a</td><td>b</td><td>c</td></tr>'
        + '<tr><td>d</td><td>e</td><td>f</td></tr>'
        + '</tbody></table><p>mitte</p><p>unten</p>';
      td.focus();
      const zelle = td.querySelector('td');
      const r = document.createRange();
      r.selectNodeContents(zelle); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return true; })()`);

    const kasten = (wahl) => js(`(() => {
      const el = document.querySelector('${wahl}');
      if (!el) return null; const b = el.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2),
               w: Math.round(b.width), h: Math.round(b.height) }; })()`);

    async function mausZieht(von, nach, schritte = 6) {
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, x: von.x, y: von.y });
      for (let i = 1; i <= schritte; i++) {
        await warte(30);
        await dbg.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved', button: 'left', buttons: 1,
          x: Math.round(von.x + (nach.x - von.x) * i / schritte),
          y: Math.round(von.y + (nach.y - von.y) * i / schritte) });
      }
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: nach.x, y: nach.y });
      await warte(300);
    }

    await tabelleAufbauen();
    await warte(400);
    const bewegKnopf = await kasten('.j-table-bar .j-table-btn');
    const vorher = await kasten('.j-text table');
    if (!bewegKnopf || !vorher) {
      pruefe('Die Leiste an der Tabelle steht da', false, 'kein Knopf gefunden');
    } else {
      /* Drücken, ziehen, loslassen – in EINER Bewegung. Genau die kam nie
         an, weil ein click Druck und Loslassen am selben Element braucht.
         Und sie muss LIEGEN BLEIBEN: einsortiert in den Textfluss landete
         sie wieder da, wo sie vorher stand. */
      await mausZieht(bewegKnopf, { x: bewegKnopf.x + 60, y: bewegKnopf.y + 180 });
      const nachher = await kasten('.j-text table');
      const dx = nachher.x - vorher.x, dy = nachher.y - vorher.y;
      pruefe('Drücken und Ziehen setzt die Tabelle um (' + dx + '/' + dy + ' px)',
        Math.abs(dx - 60) <= 14 && Math.abs(dy - 180) <= 14,
        'sie ist nicht dorthin gegangen, wo losgelassen wurde');

      const frei = await js(`(() => {
        const t = document.querySelector('.j-text table');
        const s = getComputedStyle(t);
        return { x: t.getAttribute('x'), y: t.getAttribute('y'),
                 wie: s.position, rand: /inset/.test(s.boxShadow) }; })()`);
      pruefe('Sie steht frei auf der Seite (' + frei.wie + ', x=' + frei.x + ')',
        frei.wie === 'absolute' && frei.x !== null && frei.y !== null,
        'sie hängt weiter im Textfluss');

      /* Und dabei bleibt sie GENAU so gross. Beim Freistellen bekam sie
         eigene Zeilenhöhen und Abstände und schrumpfte sichtbar zusammen –
         „wenn ich sie verschiebe, wird sie kleiner". */
      pruefe('Und behält ihre Größe (' + vorher.w + '×' + vorher.h
        + ' → ' + nachher.w + '×' + nachher.h + ')',
        Math.abs(nachher.w - vorher.w) <= 2 && Math.abs(nachher.h - vorher.h) <= 2,
        'sie ist beim Anfassen zusammengeschrumpft');

      /* Ihre obere und ihre linke Linie sind ein box-shadow: inset – und
         box-shadow ersetzt, es ergänzt nicht. Ein Schatten fürs Schweben
         nahm ihr damit zwei Ränder. */
      pruefe('Und ihre Ränder oben und links', frei.rand === true,
        'der Rahmen der Tabelle ist beim Verschieben verschwunden');

      /* Die Lage muss den Neuaufbau der Seite überleben – dort wird der
         gespeicherte Text durchs Bereinigen geschickt, und ein style
         überlebt das nicht. Deshalb steht sie als Attribut da. */
      const nachAufbau = await js(`(() => {
        const td = document.querySelector('.j-text');
        const pg = td.closest('[data-pgid]');
        const info = getPage(pg.dataset.pgid);
        td.innerHTML = sanitizePageHtml(info.page.textContent);
        return true; })()`);
      await warte(300);
      const wieder = await js(`(() => {
        const t = document.querySelector('.j-text table');
        if (!t) return null;
        return { x: t.getAttribute('x'), links: t.style.left, oben: t.style.top }; })()`);
      pruefe('Und sie überlebt den Neuaufbau der Seite ('
        + (wieder ? wieder.x + ' → ' + wieder.oben : 'weg') + ')',
        !!nachAufbau && !!wieder && wieder.x !== null && !!wieder.oben,
        'nach dem Bereinigen steht sie wieder irgendwo');
    }

    /* Und die Spalten: nur die angefasste darf sich ändern. */
    await tabelleAufbauen();
    await warte(400);
    const griff0 = await kasten('.j-tbl-griff[data-spalte="0"]');
    const letzterGriff = await kasten('.j-tbl-griff[data-spalte="2"]');
    pruefe('Auch die letzte Spalte hat einen Greifstreifen',
      !!letzterGriff, 'an der rechten Kante lässt sich nichts fassen');

    if (!griff0) {
      pruefe('Die Spaltengrenze lässt sich fassen', false, 'kein Streifen gefunden');
    } else {
      const vorher = await js(`(() => [...document.querySelectorAll('.j-text table tr:first-child > *')]
        .map(z => Math.round(z.getBoundingClientRect().width)))()`);
      await mausZieht(griff0, { x: griff0.x + 70, y: griff0.y });
      const nachher = await js(`(() => [...document.querySelectorAll('.j-text table tr:first-child > *')]
        .map(z => Math.round(z.getBoundingClientRect().width)))()`);
      pruefe('Ziehen verbreitert die angefasste Spalte ('
        + vorher[0] + ' auf ' + nachher[0] + ')',
        nachher[0] > vorher[0] + 40, 'sie ist nicht mitgegangen');
      pruefe('Und die daneben bleibt, wie sie war ('
        + vorher[1] + ' / ' + nachher[1] + ')',
        Math.abs(nachher[1] - vorher[1]) <= 2,
        'die ganze Tabelle hat sich neu verteilt');
    }

    /* Die Streifen sind da, sobald der Zeiger über der Tabelle steht –
       ohne dass man erst hineinklicken muss. */
    await js(`(() => { const td = document.querySelector('.j-text');
      getSelection().removeAllRanges(); td.blur();
      document.querySelectorAll('.j-tbl-griff,.j-tbl-zeilengriff').forEach(g => g.remove());
      return true; })()`);
    await warte(200);
    const zelleB = await kasten('.j-text table tr:first-child td:nth-child(2)');
    if (zelleB) {
      await dbg.sendCommand('Input.dispatchMouseEvent',
        { type: 'mouseMoved', button: 'none', buttons: 0, x: zelleB.x, y: zelleB.y });
      await warte(250);
    }
    const beimSchweben = await zahl(`document.querySelectorAll('.j-tbl-griff').length`);
    pruefe('Beim Darüberfahren stehen die Greifzonen bereit (' + beimSchweben + ')',
      beimSchweben >= 3, 'ohne Klick in die Tabelle gibt es nichts zu fassen');

    /* ══════════════════════════════════════════════════════════════════
       KEIN PLATZ FÜR DEN NAMEN? DANN BEIM DARÜBERFAHREN

       >>> Diese Prüfung mass lange ins Leere <<<
       Hier stand: „das Fenster ist 1240 px breit, also unter der Schwelle
       von 1300, ab der die Beschriftungen weichen (css/responsive.css)".
       Diese Schwelle gibt es nicht mehr. Die Leiste klappt seither in
       gemessenen Stufen zusammen, erst wenn sie wirklich zu eng wird
       (setzeStufe in ui/toolbar.js) – bei 1240 px passt sie noch, und die
       Namen stehen zu Recht da. Die beiden Prüfungen schlugen deshalb
       jedes Mal fehl, ohne dass irgendetwas kaputt gewesen wäre.

       Geprüft wird jetzt, worauf es ankommt, und zwar an beiden Enden:
       solange der Name im Knopf steht, braucht er KEINEN Hinweis (sonst
       stünde neben „Cursor" nach einer Sekunde noch einmal „Cursor");
       sobald die Leiste ihn wegklappt, MUSS er im Hinweis stehen, sonst
       bliebe ein Bildzeichen ohne Namen zurück.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Namen der Knöpfe beim Darüberfahren');

    const offen = await js(`(() => {
      const b = document.querySelector('.tb-mode[data-mode="cursor"]');
      const s = b.querySelector('span');
      return { verdeckt: getComputedStyle(s).display === 'none',
               name: (s.textContent || '').trim(),
               titel: b.getAttribute('title') || '' }; })()`);
    pruefe('Steht der Name im Knopf (' + (offen.name || '?') + '), fehlt der Hinweis',
      offen.verdeckt === true || !offen.titel,
      'der Name stünde sonst zweimal da: im Knopf und im Schild');

    /* Und jetzt so eng, dass die Namen weichen müssen. Gefahren wird über
       das Fenster, nicht über die Klasse von Hand – gemessen wird ja die
       wirkliche Breite. */
    await win.setBounds({ width: 700, height: 940 });
    await warte(700);
    const eng = await js(`(() => {
      const b = document.querySelector('.tb-mode[data-mode="cursor"]');
      const s = b.querySelector('span');
      return { stufe: document.querySelector('.toolbar').classList.contains('tb-ohne-namen'),
               verdeckt: getComputedStyle(s).display === 'none',
               name: (s.textContent || '').trim(),
               titel: b.getAttribute('title') || '' }; })()`);
    pruefe('Im engen Fenster klappt die Leiste die Namen weg',
      eng.stufe === true && eng.verdeckt === true,
      'die Beschriftungen stehen noch da, obwohl kein Platz ist');
    pruefe('Dafür steht der Name jetzt im Hinweis („' + eng.titel + '")',
      eng.titel === eng.name && !!eng.titel,
      'ein Bildzeichen ohne Namen – man sieht dem Knopf nicht mehr an, was er tut');

    await win.setBounds({ width: 1240, height: 940 });
    await warte(700);

    /* ══════════════════════════════════════════════════════════════════
       DAS FORMEL-FENSTER ZIEHT KEINE TASTATUR HOCH
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Das Formel-Fenster mit dem Finger');
    await js(`document.body.classList.add('touch-input');
      openFormulaEditor('', false, null, null); true`);
    await warte(300);
    const imFeld = await js(`document.activeElement && document.activeElement.id`);
    pruefe('Die Schreibmarke springt nicht ins Eingabefeld (' + (imFeld || 'nichts') + ')',
      imFeld !== 'formula-latex', 'die Bildschirmtastatur deckt die Palette zu');

    await js(`document.getElementById('formula-cancel').click();
      document.body.classList.remove('touch-input'); true`);
    await warte(200);

    /* ══════════════════════════════════════════════════════════════════
       ZURÜCK UND VOR
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Zurück und Vor als Knöpfe');
    await js(`switchMode('pen1'); S.strokeHistory[S.activePgId] = [];
      getPage(S.activePgId).page.inkStrokes = []; S.history[S.activePgId] = { undo: [], redo: [] };
      updateUndoRedoUI(); true`);
    await warte(200);
    const leerAus = await js(`document.getElementById('btn-undo').disabled`);
    pruefe('Ohne Verlauf sind sie grau', leerAus === true, 'der Knopf ist aktiv, obwohl es nichts gibt');

    m = await stelle(700);
    await stiftZieht([m, { x: m.x + 80, y: m.y + 30 }, { x: m.x + 150, y: m.y }], 25);
    const vorUndo = await zahl(`(S.strokeHistory[S.activePgId] || []).length`);

    await js(`document.getElementById('btn-undo').click(); true`);
    await warte(400);
    const nachUndo = await zahl(`(S.strokeHistory[S.activePgId] || []).length`);
    pruefe('Zurück nimmt den Strich weg (' + vorUndo + ' auf ' + nachUndo + ')',
      vorUndo === 1 && nachUndo === 0, 'der Knopf wirkte nicht');

    await js(`document.getElementById('btn-redo').click(); true`);
    await warte(400);
    const nachRedo = await zahl(`(S.strokeHistory[S.activePgId] || []).length`);
    pruefe('Und Vor holt ihn zurück (' + nachRedo + ')', nachRedo === 1, 'er blieb weg');

    /* ══════════════════════════════════════════════════════════════════
       EIN BILD AUF DIE SEITE DARÜBER

       Gemeldet: „von einer unteren Seite auf eine obere geschoben gehen
       die Bilder ganz oben hin und nicht dahin, wo ich den Finger
       gelassen habe." Der Abstand zwischen Zeiger und Bild muss den
       Seitenwechsel überleben – das lässt sich nur messen, nicht lesen.
       Steht bewusst am SCHLUSS: hier werden Seiten und Zoom verstellt.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Ein Bild auf die Seite darüber');
    await js(`(() => {
      const nb = S.notebooks[0];
      while (nb.pages.length < 2) nb.pages.push(makePage('ruled'));
      nb.pages[0].objects = [];
      nb.pages[1].objects = [{ id: 'probe-bild', kind: 'image', layer: 'front',
        src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="%23c00"/></svg>',
        x: 80, y: 120, w: 220, h: 180 }];
      openNotebook(nb.id);
      switchMode('cursor');
      setZoom(0.35);
      return true; })()`);
    await warte(900);

    const lage = await js(`(() => {
      const w = document.querySelector('.obj-wrap[data-objid="probe-bild"]');
      const s = document.querySelectorAll('.j-page');
      if (!w || s.length < 2) return null;
      const b = w.getBoundingClientRect(), o = s[0].getBoundingClientRect();
      return { bild: { x: Math.round(b.left + b.width / 2), oben: Math.round(b.top),
                       unten: Math.round(b.bottom) },
               obere: { unten: Math.round(o.bottom), oben: Math.round(o.top) } }; })()`);

    if (!lage) {
      pruefe('Zwei Seiten mit einem Bild stehen bereit', false, 'nichts zu finden');
    } else {
      /* Am UNTEREN Rand anfassen und ÜBER den oberen Seitenrand hinaus
         ziehen, dann wieder herunter. Über dem Rand muss das Bild
         festgehalten werden – aber nur auf dem Bildschirm. Wurde die
         zurechtgerückte Lage in den Bezugspunkt geschrieben, klebt es
         danach oben fest und kommt nicht mehr an den Finger zurück.
         Genau das war der gemeldete Fehler. */
      const griff = { x: lage.bild.x, y: lage.bild.unten - 8 };
      const abstand = griff.y - lage.bild.oben;
      const ziel = { x: lage.bild.x, y: lage.obere.unten - 100 };
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1,
        x: griff.x, y: griff.y });
      for (const y of [lage.obere.unten - 40, lage.obere.oben + 60,
                       lage.obere.oben + 20, ziel.y]) {
        await warte(50);
        await dbg.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved', button: 'left', buttons: 1, x: ziel.x, y });
      }
      await warte(60);
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: ziel.x, y: ziel.y });
      await warte(300);

      const danach = await js(`(() => {
        const nb = S.notebooks[0];
        const w = document.querySelector('.obj-wrap[data-objid="probe-bild"]');
        return { obenDrauf: (nb.pages[0].objects || []).length,
                 untenNoch: (nb.pages[1].objects || []).length,
                 oben: w ? Math.round(w.getBoundingClientRect().top) : null }; })()`);

      pruefe('Es liegt auf der oberen Seite', danach.obenDrauf === 1 && danach.untenNoch === 0,
        JSON.stringify(danach));
      const soll = ziel.y - abstand;
      pruefe('Und dort, wo der Finger war (' + danach.oben + ' statt ' + soll + ')',
        danach.oben !== null && Math.abs(danach.oben - soll) <= 14,
        'es ist beim Seitenwechsel weggesprungen');
    }

    /* ══════════════════════════════════════════════════════════════════
       DIE HAND KOMMT VOR DEM STIFT

       Gemeldet: „sobald die Hand angeht, springt die ganze Seite an einen
       anderen Punkt – der Stift wird ja nicht sofort erkannt, erst die
       Hand." Ein Handballen meldet sich als zwei dicht beieinander
       liegende Beruehrungen, und das war fuer app.js ein Zoomen.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Hand vor dem Stift');
    await js(`(() => { deselectStroke(); S.touchDraw = true; switchMode('pen1');
      S.strokeHistory[S.activePgId] = []; setZoom(1); return true; })()`);
    await warte(400);
    await bisStiftWeg();
    const ansicht = () => js(`(() => ({ zoom: Math.round(getZoom() * 1000) / 1000,
      oben: Math.round(document.getElementById('pg-scroll').scrollTop),
      striche: (S.strokeHistory[S.activePgId] || []).length }))()`);
    await js(`document.getElementById('pg-scroll').scrollTop = 150; true`);
    await warte(100);
    const vorHand = await ansicht();
    const handPunkt = await stelle(400);
    const ballen = (dx, dy) => ([
      { x: handPunkt.x + dx, y: handPunkt.y + dy, id: 1, force: 1 },
      { x: handPunkt.x + 28 - dx, y: handPunkt.y + 6, id: 2, force: 1 }
    ]);
    const handZiehe = async (touchPoints) => {
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints });
      await warte(40);
    };

    await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: ballen(0, 0) });
    await warte(40);
    for (const d of [3, -2, 5, 1]) await handZiehe(ballen(d, d));
    const gewackelt = await ansicht();
    pruefe('Ein aufliegender Handballen zoomt nicht (' + JSON.stringify(gewackelt) + ')',
      gewackelt.zoom === vorHand.zoom && Math.abs(gewackelt.oben - vorHand.oben) < 2,
      'vorher ' + JSON.stringify(vorHand));
    pruefe('Und malt keinen Punkt', gewackelt.striche === 0, gewackelt.striche + ' Striche');

    // Die Hand rollt ab – weit genug, dass es wie ein Zoomen aussieht
    for (let i = 1; i <= 6; i++) await handZiehe(ballen(-i * 12, 0));
    await warte(80);
    const gerollt = await ansicht();

    /* Jetzt setzt der Stift auf. Schweben allein genuegt nicht mehr: das
       tut er auch in der Hand, die gerade zoomt (siehe unten, DER STIFT
       IN DER ZOOMENDEN HAND). Geschickt ans Dokument, damit er dabei
       keinen Strich auf die Seite setzt. */
    await js(`(() => {
      const art = { bubbles: true, pointerType: 'pen', pointerId: 11, button: 0 };
      document.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ buttons: 1 }, art)));
      document.dispatchEvent(new PointerEvent('pointerup', Object.assign({ buttons: 0 }, art)));
      return true; })()`);
    await warte(120);
    const zurueck = await ansicht();
    pruefe('Setzt der Stift auf, steht die Seite wieder wie vor der Hand ('
      + gerollt.zoom + ' → ' + zurueck.zoom + ')',
      zurueck.zoom === vorHand.zoom && Math.abs(zurueck.oben - vorHand.oben) < 3,
      'vorher ' + JSON.stringify(vorHand) + ', danach ' + JSON.stringify(zurueck));

    for (let i = 7; i <= 10; i++) await handZiehe(ballen(-i * 12, 0));
    await warte(80);
    const weiter = await ansicht();
    pruefe('Und die Hand bewegt danach nichts mehr',
      weiter.zoom === zurueck.zoom && Math.abs(weiter.oben - zurueck.oben) < 2,
      JSON.stringify(weiter));
    await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await warte(100);

    // Schwebt der Stift schon, malt eine aufgesetzte Hand gar nicht erst
    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'none', buttons: 0, pointerType: 'pen',
      x: handPunkt.x - 150, y: handPunkt.y - 40 });
    await warte(30);
    await dbg.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: handPunkt.x, y: handPunkt.y, id: 1, force: 1 }] });
    for (let i = 1; i <= 4; i++) {
      await handZiehe([{ x: handPunkt.x + i * 15, y: handPunkt.y + i * 6, id: 1, force: 1 }]);
    }
    await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await warte(150);
    const schwebend = await ansicht();
    pruefe('Schwebt der Stift, malt die Hand nicht (' + schwebend.striche + ' Striche)',
      schwebend.striche === 0 && Math.abs(schwebend.oben - vorHand.oben) < 3,
      JSON.stringify(schwebend));

    /* ══════════════════════════════════════════════════════════════════
       UND DANACH GEHOEREN DIE FINGER GLEICH WIEDER DEM BLATT

       Gemeldet: „bin ich fertig mit Schreiben und will mit den Fingern
       scrollen oder herauszoomen, dauert es ein bis zwei Sekunden."
       Verlaesst der Stift den Bereich ueber dem Bildschirm, meldet er das
       mit pointerout ohne Ziel – danach bleibt nur ein kurzer Nachlauf.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Nach dem Schreiben zählen die Finger gleich wieder');
    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'none', buttons: 0, pointerType: 'pen',
      x: handPunkt.x - 150, y: handPunkt.y - 40 });
    await warte(30);
    const nochDa = await js('stiftInDerNaehe()');
    await js(`document.dispatchEvent(new PointerEvent('pointerout',
      { bubbles: true, pointerType: 'pen', pointerId: 9 })); true`);
    await warte(350);
    const stiftWeg = await js('stiftInDerNaehe()');
    pruefe('Schwebt der Stift, gilt er als nah', nochDa === true, String(nochDa));
    pruefe('Hat er den Bildschirm verlassen, ist er nach einer Drittelsekunde weg',
      stiftWeg === false, 'stiftInDerNaehe() ist noch ' + stiftWeg);

    /* ══════════════════════════════════════════════════════════════════
       ZOOMEN UM DIE FINGER

       Gemeldet: „wenn ich normal zoome, springt es auf einen anderen
       Punkt." setZoom hielt die Mitte des Rahmens fest, die Stelle unter
       den Fingern lief davon.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Zoomen hält die Stelle unter den Fingern');
    await bisStiftWeg();
    const unterFingern = (p) => js(`(() => {
      const r = document.getElementById('pages-wrap').getBoundingClientRect();
      const z = getZoom();
      return { x: (${p.x} - r.left) / z, y: (${p.y} - r.top) / z, z }; })()`);

    async function kneife(mitte, von, bis, schritte) {
      const finger = a => ([
        { x: Math.round(mitte.x - a), y: Math.round(mitte.y), id: 1, force: 1 },
        { x: Math.round(mitte.x + a), y: Math.round(mitte.y), id: 2, force: 1 }]);
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: finger(von) });
      await warte(40);
      for (let i = 1; i <= schritte; i++) {
        await dbg.sendCommand('Input.dispatchTouchEvent',
          { type: 'touchMove', touchPoints: finger(von + (bis - von) * i / schritte) });
        await warte(40);
      }
      const unter = await unterFingern(mitte);    // gemessen, solange sie liegen
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await warte(300);
      return unter;
    }

    for (const [name, anfang, von, bis, auchWaagerecht] of [
      ['bis 120 %, dort wird gerollt', 1, 60, 76, false],
      ['darueber, dort wird geschoben', 1.5, 60, 110, true]]) {
      await js(`(() => { deselectStroke(); switchMode('cursor'); setZoom(${anfang});
        document.getElementById('pg-scroll').scrollTop = 150; return true; })()`);
      await warte(500);
      const seite = await stelle(350);
      const mitte = { x: seite.x - 140, y: seite.y };
      const vorZoom = await unterFingern(mitte);
      const nachZoom = await kneife(mitte, von, bis, 8);
      const fehlY = Math.round((nachZoom.y - vorZoom.y) * nachZoom.z);
      const fehlX = Math.round((nachZoom.x - vorZoom.x) * nachZoom.z);
      pruefe('Zoom ' + name + ': er aendert sich (' + vorZoom.z.toFixed(2) + ' → ' + nachZoom.z.toFixed(2) + ')',
        nachZoom.z > vorZoom.z * 1.05, JSON.stringify(nachZoom));
      pruefe('Und die Stelle unter den Fingern bleibt stehen (' + fehlX + ' / ' + fehlY + ' px daneben)',
        Math.abs(fehlY) <= 6 && (!auchWaagerecht || Math.abs(fehlX) <= 6),
        JSON.stringify({ vorZoom, nachZoom }));

      /* Und NACH dem Loslassen. Gemeldet: „sobald ich die Finger loslasse,
         springt es dorthin zurueck, wo ich geschrieben habe" – die
         Nacharbeit beim Loslassen warf die Verschiebung weg. Gemessen
         wurde vorher nur, solange die Finger lagen. */
      const losgelassen = await unterFingern(mitte);
      const sprungY = Math.round((losgelassen.y - vorZoom.y) * losgelassen.z);
      const sprungX = Math.round((losgelassen.x - vorZoom.x) * losgelassen.z);
      pruefe('Auch nach dem Loslassen bleibt sie dort (' + sprungX + ' / ' + sprungY + ' px daneben)',
        Math.abs(sprungY) <= 6 && (!auchWaagerecht || Math.abs(sprungX) <= 6),
        JSON.stringify({ vorZoom, losgelassen }));
    }

    /* ══════════════════════════════════════════════════════════════════
       DER STIFT IN DER ZOOMENDEN HAND

       Gemeldet: „schreibe ich mit dem Stift und zoome dann woanders hin,
       springt es dorthin, wo ich zuletzt geschrieben habe." Beim Zoomen
       schwebte der Stift in derselben Hand knapp ueber dem Bildschirm –
       und das galt als die Hand, die vor dem Stift aufliegt: die Ansicht
       sprang auf den Stand beim Aufsetzen der Finger zurueck.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Der Stift in der zoomenden Hand holt die Ansicht nicht zurück');
    await bisStiftWeg();
    await js(`(() => { deselectStroke(); switchMode('pen1'); setZoom(1);
      document.getElementById('pg-scroll').scrollTop = 150; return true; })()`);
    await warte(500);
    {
      const seite = await stelle(350);
      const mitte = { x: seite.x - 140, y: seite.y };
      const vorher = await zahl(`getZoom()`);
      const finger = a => ([
        { x: Math.round(mitte.x - a), y: Math.round(mitte.y), id: 1, force: 1 },
        { x: Math.round(mitte.x + a), y: Math.round(mitte.y), id: 2, force: 1 }]);
      const zieheAuf = async (a) => {
        await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: finger(a) });
        await warte(40);
      };

      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: finger(60) });
      await warte(40);
      for (let i = 1; i <= 6; i++) await zieheAuf(60 + i * 8);
      const gezoomt = await zahl(`getZoom()`);

      // Die Hand mit dem Stift kommt dem Bildschirm nahe
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'none', buttons: 0, pointerType: 'pen',
        x: mitte.x + 220, y: mitte.y - 80 });
      await warte(120);
      const nachSchweben = await zahl(`getZoom()`);

      for (let i = 7; i <= 10; i++) await zieheAuf(60 + i * 8);
      const weiter = await zahl(`getZoom()`);
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await warte(300);

      const verlauf = [vorher, gezoomt, nachSchweben, weiter].map(z => z.toFixed(2)).join(' → ');
      pruefe('Schwebt der Stift beim Zoomen, springt es nicht zurück (' + verlauf + ')',
        gezoomt > vorher * 1.05 && Math.abs(nachSchweben - gezoomt) < 0.01, verlauf);
      pruefe('Und die Finger zoomen danach weiter', weiter > nachSchweben + 0.02, verlauf);
    }

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH ' + ((err && err.stack) || err));
    fertig(3);
  }
});
