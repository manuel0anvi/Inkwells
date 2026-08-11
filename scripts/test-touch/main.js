/* ══════════════════════════════════════════════════════════════════════
   MIT FINGER UND STIFT BEDIENBAR

   Inkwell wird auf umklappbaren Laptops benutzt: Trackpad, Touchscreen
   und Stift am selben Geraet, mal aufgeklappt, mal als Tablet. Was mit
   der Maus geht, geht deshalb noch lange nicht.

   Geprueft wird mit ECHTEN Ereignissen ueber das
   Chrome-DevTools-Protokoll. Ein synthetisches dispatchEvent() taugt
   dafuer nicht: es loest keinen Fokuswechsel aus, und genau daran haengt
   die Frage, ob ein Knopf in der Leiste die Schreibmarke im Text
   stehen laesst.

   Vier Dinge:

     · TREFFERFLAECHEN. Ein Finger trifft keine 24 px. Die Groessen
       kommen aus css/responsive.css und haengen an einer Medienabfrage –
       faellt die um, merkt es sonst niemand.
     · SCHREIBEN UND FORMATIEREN mit Finger und Stift, bis hin zur
       Auswahlliste der Aufzaehlungszeichen.
     · UMKLAPPEN. Quer nach hoch: die Seite muss sich einpassen, die
       Werkzeugleiste einzeilig bleiben, die Auswahl auf dem Schirm.
     · DIE MEDIENABFRAGE SELBST. `pointer: coarse` fragt nach dem
       PRIMAEREN Zeiger – auf einem Laptop mit Touchscreen ist das das
       Trackpad, der Block greift dort also nie. Richtig ist
       `any-pointer: coarse`. Das steht unten als eigene Pruefung, weil
       ein Zurueckaendern sonst unbemerkt bliebe: dieser Rechner hat
       keinen Touchscreen, die Emulation stellt ein reines Tablet nach,
       und darin faellt der Unterschied nicht auf.

   Laeuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:touch
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
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
  process.stdout.write('\nMit Finger und Stift\n');
  process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');
  const fehl = zeilen.filter(l => l.startsWith('FEHL')).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : code);
}

setTimeout(() => { zeilen.push('ABBRUCH: Zeitgrenze erreicht'); fertig(2); }, 150000);

app.on('ready', async () => {
  try {
    /* ── Erst die Medienabfrage im Stilblock selbst ────────────────────
       Ohne Bildschirm zu messen: auf diesem Rechner gibt es keinen
       Touchscreen, und die Emulation stellt ein reines Tablet nach – da
       traefe auch die falsche Abfrage zu. Der Unterschied ist nur im
       Text der Datei sichtbar. */
    abschnitt('Die Abfrage trifft auch Laptops mit Touchscreen');
    const responsive = fs.readFileSync(path.join(ROOT, 'src', 'css', 'responsive.css'), 'utf8');
    pruefe('css/responsive.css fragt nach any-pointer',
      /@media\s*\(\s*any-pointer:\s*coarse\s*\)/.test(responsive),
      'nur (pointer: coarse) – das ist der PRIMAERE Zeiger und auf einem '
      + 'Laptop mit Trackpad immer fein, der Block greift dort nie');
    pruefe('Und nicht mehr allein nach dem primaeren Zeiger',
      !/@media\s*\(\s*pointer:\s*coarse\s*\)/.test(responsive), 'noch vorhanden');

    const win = new BrowserWindow({
      width: 760, height: 1000, show: true, backgroundColor: '#12121a',
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
    });
    await win.loadFile(path.join(ROOT, 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 2000));

    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });

    const js = (code) => win.webContents.executeJavaScript(code);

    // Ein Heft mit einer Seite – ohne Datei, ohne Cloud
    await js(`(() => {
      const nb = { id: 'probe', name: 'Probe', color: '#c8a96e', defaultBg: 'ruled',
                   pages: [makePage('ruled')], sections: [], created: Date.now() };
      S.notebooks = [nb];
      openNotebook('probe');
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 900));

    const mitte = (sel) => js(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null; const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
                 w: Math.round(r.width), h: Math.round(r.height) }; })()`);

    async function tippe(sel) {
      const p = await mitte(sel);
      if (!p) return null;
      await dbg.sendCommand('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1, force: 1 }] });
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await new Promise(r => setTimeout(r, 200));
      return p;
    }

    /** Ein Finger, der von A nach B zieht – mit Zwischenschritten. */
    async function ziehe(x0, y0, x1, y1, schritte = 10) {
      await dbg.sendCommand('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: Math.round(x0), y: Math.round(y0), id: 1, force: 1 }] });
      for (let i = 1; i <= schritte; i++) {
        await dbg.sendCommand('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{
            x: Math.round(x0 + (x1 - x0) * i / schritte),
            y: Math.round(y0 + (y1 - y0) * i / schritte), id: 1, force: 1 }] });
        await new Promise(r => setTimeout(r, 16));
      }
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await new Promise(r => setTimeout(r, 200));
    }

    async function stift(sel) {
      const p = await mitte(sel);
      if (!p) return null;
      const g = { x: p.x, y: p.y, button: 'left', pointerType: 'pen', force: 0.5 };
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 0, ...g, button: 'none' });
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', clickCount: 1, buttons: 1, ...g });
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', clickCount: 1, buttons: 0, ...g });
      await new Promise(r => setTimeout(r, 200));
      return p;
    }

    /* ── Trefferflaechen ──────────────────────────────────────────────
       32 px ist die untere Grenze, die ein Finger noch zuverlaessig
       trifft. Ohne die Regeln in responsive.css sind es 24. */
    abschnitt('Trefferflaechen (mindestens 32 px Kante)');
    for (const sel of ['#fmt-list', '#fmt-list-more',
                       '#fmt-bold', '#fmt-h1', '#fmt-p', '.tb-mode',
                       '.pg-menu-btn', '#btn-panel-toggle']) {
      const m = await mitte(sel);
      pruefe(sel.padEnd(20) + (m ? m.w + '×' + m.h : 'nicht sichtbar'),
        !!m && Math.min(m.w, m.h) >= 32, m ? 'zu klein fuer einen Finger' : 'fehlt');
    }

    /* ── Mit dem Finger ─────────────────────────────────────────────── */
    abschnitt('Mit dem Finger');
    await js(`(() => { const td = document.querySelector('.j-text');
      td.innerHTML = ''; td.textContent = 'Milch\\nBrot\\nEier'; return true; })()`);

    await tippe('.j-text');
    pruefe('Ein Tipp setzt die Schreibmarke in den Text',
      await js(`(() => { const s = getSelection();
        return !!(s.rangeCount && document.querySelector('.j-text').contains(s.getRangeAt(0).startContainer)); })()`),
      'keine Marke im Text');

    await js(`setFlatCaret(document.querySelector('.j-text'), 2)`);
    await tippe('#fmt-list');
    let html = await js(`document.querySelector('.j-text').innerHTML`);
    pruefe('Der Knopf laesst die Marke stehen und macht eine Liste',
      /<ul[^>]*j-list-/.test(html), html.slice(0, 140));

    await tippe('#fmt-list-more');
    pruefe('Der schmale Knopf oeffnet die Auswahl',
      (await js(`getComputedStyle(document.getElementById('list-style-pop')).display`)) === 'block',
      'blieb zu');

    /* Ein Fenster, zwei Gruppen: die Punkte und die Nummern. Beide
       muessen da sein, sonst braeuchte es doch wieder zwei Knoepfe. */
    const gruppen = await js(`({
      punkte: document.querySelectorAll('#list-style-grid-ul .list-style-cell').length,
      nummern: document.querySelectorAll('#list-style-grid-ol .list-style-cell').length })`);
    pruefe('Sie enthaelt beide Gruppen (' + gruppen.punkte + ' Punkte, '
      + gruppen.nummern + ' Nummern)', gruppen.punkte >= 6 && gruppen.nummern >= 7,
      JSON.stringify(gruppen));

    const zelle = await mitte('.list-style-cell');
    pruefe('Die Zellen der Auswahl sind '
      + (zelle ? zelle.w + '×' + zelle.h : '?') + ' gross',
      !!zelle && Math.min(zelle.w, zelle.h) >= 32, 'zu klein');

    // Eine NUMMERNform, obwohl der Knopf gerade Punkte zeigte
    await tippe('#list-style-grid-ol .list-style-cell:nth-child(2)');
    html = await js(`document.querySelector('.j-text').innerHTML`);
    pruefe('Ein Tipp auf eine Nummernform wendet sie an', /j-list-paren/.test(html), html.slice(0, 140));
    pruefe('Und die Auswahl schliesst sich',
      (await js(`getComputedStyle(document.getElementById('list-style-pop')).display`)) === 'none',
      'blieb offen');

    /* Der eine Knopf muss jetzt Nummern zeigen – sonst weiss niemand,
       was ein Druck darauf anrichtet. */
    pruefe('Der Knopf zeigt danach das Nummern-Bild',
      (await js(`getComputedStyle(document.getElementById('list-icon-ol')).display`)) !== 'none'
      && (await js(`getComputedStyle(document.getElementById('list-icon-ul')).display`)) === 'none',
      'falsches Bild');

    // Und noch einmal derselbe Knopf: die Liste muss WEG sein, nicht
    // umgestellt – auch wenn die zuletzt gewaehlte Form eine andere ist.
    await tippe('#fmt-list');
    html = await js(`document.querySelector('.j-text').innerHTML`);
    pruefe('Noch ein Druck nimmt die Liste weg', !/<(ul|ol)/.test(html), html.slice(0, 140));

    /* ── Mit dem Stift ──────────────────────────────────────────────── */
    abschnitt('Mit dem Stift');
    await js(`(() => { document.querySelector('.j-text').innerHTML = '<p>Eins</p><p>Zwei</p>'; return true; })()`);
    await stift('.j-text');
    pruefe('Ein Tipp setzt die Schreibmarke',
      await js(`(() => { const s = getSelection();
        return !!(s.rangeCount && document.querySelector('.j-text').contains(s.getRangeAt(0).startContainer)); })()`),
      'keine Marke');

    await stift('#fmt-list');
    html = await js(`document.querySelector('.j-text').innerHTML`);
    pruefe('Der Knopf wirkt auch mit dem Stift', /<(ul|ol)[^>]*j-list-/.test(html), html.slice(0, 140));

    /* ── Umgeklappt ─────────────────────────────────────────────────── */
    abschnitt('Umgeklappt (quer nach hoch)');
    win.setContentSize(1200, 800);
    await new Promise(r => setTimeout(r, 600));
    const zoomQuer = await js('getZoom()');
    win.setContentSize(800, 1200);
    await new Promise(r => setTimeout(r, 800));
    const zoomHoch = await js('getZoom()');

    pruefe('Die Seite passt sich in die Breite ein ('
      + zoomQuer.toFixed(2) + ' auf ' + zoomHoch.toFixed(2) + ')',
      (await js(`(() => { const sc = document.getElementById('pg-scroll');
        const pg = document.querySelector('.j-page');
        return !!pg && pg.getBoundingClientRect().width <= sc.clientWidth + 2; })()`)) === true,
      'die Seite ragt seitlich hinaus');

    const leiste = await js(`Math.round(document.querySelector('.toolbar').getBoundingClientRect().height)`);
    pruefe('Die Werkzeugleiste bleibt eine Zeile (' + leiste + ' px)', leiste < 70, String(leiste));

    const ul = await mitte('#fmt-list');
    pruefe('Der Listenknopf ist noch erreichbar',
      !!ul && ul.x > 0 && ul.x < 800 && Math.min(ul.w, ul.h) >= 32, JSON.stringify(ul));

    /* ── Nichts steht seitlich heraus ─────────────────────────────────
       Die Leiste KANN rollen (css/toolbar.css), aber was rechts
       heraussteht, findet niemand – und ein waagerechtes Schieben in
       einer 40 px hohen Leiste trifft mit dem Finger ohnehin kaum
       jemand. Geprueft wird deshalb ueber die Breiten, die ein
       umgeklappter Laptop wirklich hat, mit und ohne Navigation.

       >>> Seit dem Auffangknopf gibt es keine Ausnahme mehr <<<
       Hier stand 700 px MIT offener Navigation ausdruecklich als
       „geht nicht" – da bleiben keine 510 px fuer die Leiste. Mit dem
       Menue in ui/toolbar.js wandert stattdessen so lange eine Gruppe
       hinein, bis es passt. Deshalb wird jetzt auch dieser Fall
       geprueft: er ist der eigentliche Beweis, dass der Weg trägt. */
    abschnitt('Die Leiste passt hinein, ohne zu schieben');
    for (const [breite, hoehe, lage] of [[1400, 900, 'quer 1400'], [1200, 800, 'quer 1200'],
                                          [1000, 800, 'quer 1000'], [900, 1300, 'hoch 900'],
                                          [800, 1200, 'hoch 800'], [750, 1150, 'hoch 750'],
                                          [700, 1100, 'hoch 700']]) {
      win.setContentSize(breite, hoehe);
      await new Promise(r => setTimeout(r, 450));

      for (const navOffen of [false, true]) {
        await js(`document.getElementById('side-panel').classList.toggle('open', ${navOffen})`);
        await new Promise(r => setTimeout(r, 450));
        const m = await js(`(() => { const tb = document.querySelector('.toolbar');
          return { platz: Math.round(tb.clientWidth), noetig: Math.round(tb.scrollWidth),
                   imMenue: document.getElementById('tb-more-pop').childElementCount,
                   knopf: getComputedStyle(document.getElementById('btn-tb-more')).display }; })()`);
        pruefe((lage + (navOffen ? ' + Navigation' : '')).padEnd(24)
          + m.noetig + ' von ' + m.platz + ' px'
          + (m.imMenue ? '  (' + m.imMenue + ' im Menü)' : ''),
          m.noetig <= m.platz, 'es stehen ' + (m.noetig - m.platz) + ' px heraus');

        /* Und wenn etwas ausgelagert wurde, muss der Knopf dazu auch da
           sein – sonst waeren die Gruppen unerreichbar statt bloss
           weggeraeumt. */
        if (m.imMenue) {
          pruefe((lage + (navOffen ? ' + Navigation' : '')).padEnd(24) + 'Knopf „⋯" ist da',
            m.knopf !== 'none', 'ausgelagert, aber kein Weg hin');
        }
      }
      await js(`document.getElementById('side-panel').classList.remove('open')`);
    }

    win.setContentSize(800, 1200);
    await new Promise(r => setTimeout(r, 450));

    await js('openListStylePop()');
    await new Promise(r => setTimeout(r, 250));
    const kasten = await js(`(() => { const r = document.getElementById('list-style-pop').getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom),
               vw: innerWidth, vh: innerHeight }; })()`);
    pruefe('Die Auswahl bleibt ganz auf dem Schirm',
      kasten.l >= 0 && kasten.r <= kasten.vw && kasten.b <= kasten.vh, JSON.stringify(kasten));

    /* ══════════════════════════════════════════════════════════════════
       DER FINGER ZEICHNET WIRKLICH

       Lange ging das gar nicht, und niemandem fiel es auf: der Schalter
       in der Leiste stand da, die Regel in css/pages.css stand da – aber
       zwei Stellen setzten touch-action zusaetzlich als INLINE-Stil
       (canvas/drawing.js beim Anlegen, core/zoom.js bei jedem Einpassen),
       und der schlaegt jedes Stylesheet. Der Browser machte aus der
       Bewegung ein Scrollen und brach den Strich mit pointercancel ab.

       Deshalb wird hier nicht die Einstellung geprueft, sondern das
       Ergebnis: kommt nach einem gezogenen Finger ein Strich heraus?
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Der Finger zeichnet');
    win.setContentSize(800, 1200);
    await new Promise(r => setTimeout(r, 500));

    await js(`switchMode('pen1')`);
    await new Promise(r => setTimeout(r, 200));
    pruefe('Mit Zeichenwerkzeug gehoert die Bewegung dem Strich',
      (await js(`getComputedStyle(document.querySelector('.j-canvas')).touchAction`)) === 'none',
      'touch-action steht noch auf pan-y – der Browser scrollt und bricht den Strich ab');

    const seite = await mitte('.j-page');
    const vorher = await js(`(() => { const pg = getPage(S.activePgId);
      S.strokeHistory[S.activePgId] = []; if (pg) pg.page.inkStrokes = [];
      return document.getElementById('pg-scroll').scrollTop; })()`);
    await ziehe(seite.x - 80, seite.y - 40, seite.x + 90, seite.y + 60);

    const strich = await js(`(() => { const l = S.strokeHistory[S.activePgId] || [];
      return { anzahl: l.length, punkte: l[0] ? l[0].path.length : 0,
               scroll: document.getElementById('pg-scroll').scrollTop }; })()`);
    pruefe('Ein gezogener Finger hinterlaesst einen Strich ('
      + strich.anzahl + ' Strich, ' + strich.punkte + ' Punkte)',
      strich.anzahl === 1 && strich.punkte > 3, JSON.stringify(strich));
    pruefe('Und die Seite ist dabei nicht weggescrollt',
      Math.abs(strich.scroll - vorher) < 4, 'sie ist um ' + (strich.scroll - vorher) + ' px gerutscht');

    /* >>> Und der Weg zurueck: zwei Finger <<<
       Solange der Finger zeichnet, ist das Schieben mit zwei Fingern der
       einzige Weg, ueber der Seite weiterzukommen. Vorher zoomte das nur;
       ohne diese Pruefung kaeme man mit gewaehltem Stift nicht mehr von
       der Stelle. */
    const vorRoll = await js(`(() => { const sc = document.getElementById('pg-scroll');
      sc.scrollTop = 60; return sc.scrollTop; })()`);
    const zwei = (y, dy) => ([
      { x: seite.x - 60, y: y, id: 1, force: 1 },
      { x: seite.x + 60, y: y + dy, id: 2, force: 1 }
    ]);
    await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: zwei(seite.y, 0) });
    for (let i = 1; i <= 10; i++) {
      await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: zwei(seite.y - i * 12, 0) });
      await new Promise(r => setTimeout(r, 16));
    }
    await dbg.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await new Promise(r => setTimeout(r, 250));
    const nachRoll = await js(`document.getElementById('pg-scroll').scrollTop`);
    pruefe('Zwei Finger bewegen die Seite trotzdem ('
      + Math.round(vorRoll) + ' auf ' + Math.round(nachRoll) + ')',
      nachRoll > vorRoll + 30, 'die Seite steht fest, obwohl der Hinweis es verspricht');

    await js(`switchMode('cursor')`);
    await new Promise(r => setTimeout(r, 200));
    pruefe('Auf dem Zeiger scrollt der Finger wieder',
      (await js(`getComputedStyle(document.querySelector('.j-canvas')).touchAction`)) === 'pan-y',
      'die Seite laesst sich mit dem Finger nicht mehr bewegen');

    /* ══════════════════════════════════════════════════════════════════
       EIN BILD MIT DEM FINGER

       Zwei gemeldete Fehler auf einmal: das Verschieben scrollte die
       Seite, statt das Bild zu bewegen, und am Seitenende ging es
       „irgendwie weiter", statt auf die naechste Seite zu springen.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Ein Bild mit dem Finger');

    // Eine zweite Seite, damit es ueberhaupt ein Ziel zum Hinueberziehen gibt
    await js(`(() => {
      const nb = getNb();
      if (visiblePages(nb).length < 2) {
        const pg = makePage('ruled');
        insertPageInto(nb, activeSection(nb), pg);
        appendPageDOM(pg, visiblePages(nb).length - 1);
        renumberVisiblePages(); refreshSizer();
      }
      const seite1 = visiblePages(nb)[0];
      const obj = { id: 'probe-bild', kind: 'image', x: 260, y: 700, w: 240, h: 180,
        src: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' };
      seite1.objects = [obj];
      const el = document.querySelector('[data-pgid="' + seite1.id + '"] .j-objects');
      el.innerHTML = '';
      placeObject(el, obj, seite1);
      document.getElementById('pg-scroll').scrollTop = 0;
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 400));

    let bild = await mitte('.obj-wrap');
    await tippe('.obj-wrap');
    pruefe('Ein Tipp waehlt das Bild aus',
      (await js(`!!document.querySelector('.obj-wrap.selected')`)) === true, 'nicht ausgewaehlt');
    pruefe('Am ausgewaehlten Bild gehoert die Bewegung dem Bild',
      (await js(`getComputedStyle(document.querySelector('.obj-wrap.selected .obj-body')).touchAction`)) === 'none',
      'touch-action fehlt – der Finger scrollt weiter die Seite');

    const stand0 = await js(`(() => ({ x: Math.round(getNb().pages[0].objects[0].x),
      scroll: document.getElementById('pg-scroll').scrollTop }))()`);
    await ziehe(bild.x, bild.y, bild.x - 120, bild.y);
    const stand1 = await js(`(() => ({ x: Math.round(getNb().pages[0].objects[0].x),
      scroll: document.getElementById('pg-scroll').scrollTop }))()`);
    pruefe('Der Finger verschiebt es (' + stand0.x + ' auf ' + stand1.x + ')',
      Math.abs(stand1.x - stand0.x) > 40, 'es blieb liegen');
    pruefe('Statt die Seite zu scrollen',
      Math.abs(stand1.scroll - stand0.scroll) < 4,
      'die Seite ist um ' + (stand1.scroll - stand0.scroll) + ' px gerutscht');

    /* Und jetzt ueber den Seitenrand hinaus. Vorher so scrollen, dass die
       Fuge zwischen beiden Seiten wirklich zu sehen ist – gezogen wird
       auf dem Schirm, nicht im Modell. */
    const fuge = await js(`(() => {
      const s = document.querySelectorAll('.j-page');
      const sc = document.getElementById('pg-scroll');
      sc.scrollTop = Math.max(0, s[0].offsetTop * getZoom() + s[0].getBoundingClientRect().height - sc.clientHeight * 0.55);
      return true; })()`);
    await new Promise(r => setTimeout(r, 400));
    bild = await mitte('.obj-wrap');
    const ziel = await js(`(() => { const r = document.querySelectorAll('.j-page')[1].getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 60) }; })()`);
    await ziehe(bild.x, bild.y, ziel.x, ziel.y, 14);

    const verteilt = await js(`(() => { const p = visiblePages(getNb());
      return { erste: (p[0].objects || []).length, zweite: (p[1].objects || []).length,
               imBaum: document.querySelectorAll('[data-pgid="' + p[1].id + '"] .obj-wrap').length }; })()`);
    pruefe('Ueber den Rand gezogen springt es auf die naechste Seite',
      verteilt.erste === 0 && verteilt.zweite === 1, JSON.stringify(verteilt));
    pruefe('Und haengt dort auch im Baum', verteilt.imBaum === 1, JSON.stringify(verteilt));

    /* ══════════════════════════════════════════════════════════════════
       GROESSER UND KLEINER IM HOCHFORMAT

       − und + weichen der schmalen Leiste (css/responsive.css, Stufe 2).
       Was blieb, war der Prozentwert, und der setzte im Hochformat auf
       „eingepasst" zurueck – also auf den Zustand, in dem man ohnehin
       schon war. Ein Druck darauf tat sichtbar nichts.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Groesser und kleiner im Hochformat');
    pruefe('Die beiden Zoomknoepfe sind hier wirklich weg',
      (await mitte('#btn-zoom-in')) === null, 'sie sind noch da – dann braucht es die Auswahl nicht');

    /* >>> Die Pause gehoert dazu <<<
       Ein Tipp, der einer gezogenen Geste auf dem Fuss folgt, erzeugt in
       Chromium KEINEN Klick – er gilt als Anhalten der vorigen Bewegung.
       Der pointerdown kommt an, der click nie. Ohne diese Pause scheitert
       die Pruefung hier und sieht aus wie ein Fehler in der App. */
    await new Promise(r => setTimeout(r, 800));
    await tippe('#btn-zoom-reset');
    pruefe('Der Prozentwert oeffnet die Auswahl',
      (await js(`getComputedStyle(document.getElementById('zoom-pop')).display`)) === 'flex',
      'es passiert weiterhin nichts');

    const z0 = await js('getZoom()');
    await tippe('#zoom-pop-in');
    const z1 = await js('getZoom()');
    pruefe('Und darin vergroessert es sich (' + z0.toFixed(2) + ' auf ' + z1.toFixed(2) + ')',
      z1 > z0 + 0.01, 'der Zoom blieb stehen');

    await tippe('#zoom-pop-fit');
    pruefe('„Einpassen" holt die Seite zurueck und schliesst',
      (await js(`getComputedStyle(document.getElementById('zoom-pop')).display`)) === 'none'
      && (await js('getZoom()')) < z1, 'blieb offen oder blieb gross');

    /* ══════════════════════════════════════════════════════════════════
       DIE ABSCHNITTE MIT DEM FINGER AUFZIEHEN
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Abschnitte aufziehen');
    await js(`document.getElementById('side-panel').classList.remove('open')`);
    await new Promise(r => setTimeout(r, 300));
    const strip = await mitte('.side-strip');
    await ziehe(strip.x, strip.y + 120, strip.x + 140, strip.y + 130);
    pruefe('Nach rechts wischen zieht die Leiste auf',
      (await js(`document.getElementById('side-panel').classList.contains('open')`)) === true,
      'sie blieb zu');

    await ziehe(strip.x + 8, strip.y + 120, strip.x - 130, strip.y + 130);
    pruefe('Nach links wischen schliesst sie wieder',
      (await js(`document.getElementById('side-panel').classList.contains('open')`)) === false,
      'sie blieb offen');

    /* >>> Und jetzt mit Abstand zum Bildschirmrand <<<
       Am Rand selbst greift Windows zu (Widgets), die App sieht davon
       nichts. Deshalb muss es auch ein Stück weiter rechts anfangen
       koennen – sonst geht es auf einem Vollbild fast nie. */
    await ziehe(strip.x + 46, strip.y + 160, strip.x + 190, strip.y + 168);
    pruefe('Auch mit Abstand zum Bildschirmrand zieht es auf',
      (await js(`document.getElementById('side-panel').classList.contains('open')`)) === true,
      'nur unmittelbar am Rand – und dort fängt Windows es ab');

    /* Zumachen muss ueberall auf der offenen Leiste gehen, nicht nur auf
       den 36 px ganz aussen. */
    const inhalt = await mitte('#side-content');
    await ziehe(inhalt.x, inhalt.y, inhalt.x - 120, inhalt.y + 8);
    pruefe('Und aus dem Inhalt heraus geht sie wieder zu',
      (await js(`document.getElementById('side-panel').classList.contains('open')`)) === false,
      'sie blieb offen – genau das war „richtig schwer zuzumachen"');

    /* Senkrecht ist kein Wischen, sondern Scrollen. Ohne diese
       Gegenprobe wuerde jede Fingerbewegung links die Leiste bewegen. */
    await ziehe(strip.x + 40, strip.y + 200, strip.x + 52, strip.y + 60);
    pruefe('Senkrecht scrollt weiterhin, statt die Leiste zu bewegen',
      (await js(`document.getElementById('side-panel').classList.contains('open')`)) === false,
      'ein Scrollen hat die Leiste aufgezogen');

    /* ══════════════════════════════════════════════════════════════════
       DIE DREI PUNKTE AN DER HEFTKARTE

       Sie standen unter `any-pointer: coarse` dauerhaft auf jeder Karte –
       also auch auf einem aufgeklappten Laptop mit Maus, wo :hover
       tadellos arbeitet. Massgeblich ist jetzt, was gerade benutzt wird.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die drei Punkte an der Heftkarte');
    await js('showHome()');
    await new Promise(r => setTimeout(r, 400));

    /* >>> Im Hochformat schon VOR der ersten Beruehrung <<<
       Die Klasse am body kommt erst mit einem Ereignis. Wer den Laptop
       gerade umgeklappt hat, musste deshalb erst irgendwohin tippen,
       damit der Knopf ueberhaupt erscheint – genau so gemeldet. Geprueft
       wird deshalb mit einer frisch geladenen Seite, die noch nie
       beruehrt wurde: die Medienabfrage muss allein reichen. */
    await js(`document.body.classList.remove('touch-input')`);
    await new Promise(r => setTimeout(r, 150));
    pruefe('Im Hochformat stehen sie ohne jede Beruehrung da',
      (await js(`getComputedStyle(document.querySelector('.nb-card-edit-btn')).opacity`)) === '1',
      'erst nach dem ersten Antippen – dann findet sie niemand');

    await tippe('.nb-card-name');
    await js(`showHome()`);   // der Tipp oeffnet das Heft – wieder zurueck
    await new Promise(r => setTimeout(r, 400));
    pruefe('Mit dem Finger stehen sie da',
      (await js(`getComputedStyle(document.querySelector('.nb-card-edit-btn')).opacity`)) === '1',
      'unerreichbar: ein Finger schwebt nicht');

    /* Aufgeklappt, also quer: dort arbeitet :hover tadellos, und eine
       Karte ohne Knopf ist die aufgeraeumtere Uebersicht. */
    win.setContentSize(1200, 800);
    await new Promise(r => setTimeout(r, 500));
    await dbg.sendCommand('Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: 400, y: 300, button: 'none', buttons: 0 });
    await new Promise(r => setTimeout(r, 200));
    pruefe('Aufgeklappt und mit der Maus verschwinden sie wieder',
      (await js(`getComputedStyle(document.querySelector('.nb-card-edit-btn')).opacity`)) === '0',
      'sie stehen weiter auf jeder Karte');

    /* >>> Und der Zoom darf nicht klein bleiben <<<
       Im Hochformat passt sich die Seite ein. Beim Zurueckklappen blieb
       dieser Wert einfach stehen – der Laptop stand danach dauerhaft auf
       gut der Haelfte, ohne dass es jemand veranlasst haette. */
    abschnitt('Umklappen und zurueck');
    await js(`(() => { const nb = S.notebooks[0]; openNotebook(nb.id); return true; })()`);
    await new Promise(r => setTimeout(r, 600));
    const zoomQuer1 = await js('getZoom()');
    win.setContentSize(800, 1200);
    await new Promise(r => setTimeout(r, 700));
    const zoomHoch1 = await js('getZoom()');
    win.setContentSize(1200, 800);
    await new Promise(r => setTimeout(r, 700));
    const zoomQuer2 = await js('getZoom()');

    pruefe('Im Hochformat passt sich die Seite ein ('
      + zoomQuer1.toFixed(2) + ' auf ' + zoomHoch1.toFixed(2) + ')',
      zoomHoch1 < zoomQuer1, 'sie passt sich nicht ein');
    pruefe('Und zurueckgeklappt gilt wieder der alte Wert ('
      + zoomHoch1.toFixed(2) + ' auf ' + zoomQuer2.toFixed(2) + ')',
      Math.abs(zoomQuer2 - zoomQuer1) < 0.001,
      'der eingepasste Wert bleibt stehen – der Laptop wirkt „ganz klein eingestellt"');

    /* Und eingepasst heisst BREITE, nicht ganze Seite: eine A4-Seite in
       voller Hoehe auf einen Laptop zu quetschen macht den Text
       unlesbar klein. */
    win.setContentSize(800, 1200);
    await new Promise(r => setTimeout(r, 700));
    const passung = await js(`(() => {
      const sc = document.getElementById('pg-scroll');
      const pg = document.querySelector('.j-page').getBoundingClientRect();
      return { seite: Math.round(pg.width), platz: sc.clientWidth,
               anteil: pg.width / sc.clientWidth }; })()`);
    pruefe('Eingepasst wird die Breite (' + passung.seite + ' von '
      + passung.platz + ' px)', passung.anteil > 0.9 && passung.anteil <= 1.001,
      'die Seite nutzt nur ' + Math.round(passung.anteil * 100) + '% der Breite');

    /* >>> Und beim ÖFFNEN, nicht erst beim Umklappen <<<
       Wer die App im Tablet-Modus startet und ein Heft öffnet, bekam die
       Grundgröße: eingepasst wurde nur beim Wechsel des Formats und beim
       Zoomen. Hier wird deshalb der Zoom absichtlich auf die Grundgröße
       gestellt und dann ein Heft geöffnet – ohne jede Größenänderung. */
    await js(`(() => { _zoom = 1.2; _verticalAutoFit = true;
      openNotebook(S.notebooks[0].id); return true; })()`);
    await new Promise(r => setTimeout(r, 700));
    const zoomBeimOeffnen = await js('getZoom()');
    pruefe('Beim Öffnen im Hochformat passt es sich gleich ein ('
      + zoomBeimOeffnen.toFixed(2) + ')',
      zoomBeimOeffnen < 1.19, 'es bleibt bei der Grundgröße, bis man umklappt');

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH ' + ((err && err.stack) || err));
    fertig(3);
  }
});
