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

    async function fingerTippt(x, y) {
      await dbg.sendCommand('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y), id: 1, force: 1 }] });
      await warte(60);
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await warte(300);
    }

    async function fingerZieht(punkte, pause = 40) {
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

    const nachRadier = await js(`(() => ({
      radierer: (S.strokeHistory[S.activePgId] || []).filter(s => s.isEraser).length,
      modus: S.mode }))()`);
    pruefe('Sie radiert auch, wenn der Zeiger gewählt war',
      nachRadier.radierer === 1, 'es entstand kein Radierstrich');
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
    pruefe('Gekritzel dagegen bleibt stehen', nachKrumm === 1,
      'auch die Handschrift verschwand ganz');

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

       Das Fenster ist 1240 px breit – unter der Schwelle von 1300, ab der
       die Beschriftungen der Werkzeuge weichen (css/responsive.css).
       Genau dann muss der Name im Hinweis stehen.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Namen der Knöpfe beim Darüberfahren');
    const namen = await js(`(() => {
      const b = document.querySelector('.tb-mode[data-mode="cursor"]');
      const s = b.querySelector('span');
      return { verdeckt: getComputedStyle(s).display === 'none',
               name: (s.textContent || '').trim(), titel: b.title }; })()`);
    pruefe('Der Name ist im schmalen Fenster wirklich verdeckt', namen.verdeckt === true,
      'die Beschriftung steht noch da – die Prüfung misst ins Leere');
    pruefe('Dafür steht er im Hinweis („' + namen.titel + '")',
      namen.titel === namen.name, 'der Knopf hat keinen Namen mehr, nirgends');

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

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH ' + ((err && err.stack) || err));
    fertig(3);
  }
});
