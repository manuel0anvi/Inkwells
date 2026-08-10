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

       Die eine Ausnahme steht ausdruecklich da: 700 px MIT offener
       Navigation lassen keine 510 px fuer die Leiste – das ist ein
       6,5 Zoll breites Fenster, kein umgeklappter Laptop. */
    abschnitt('Die Leiste passt hinein, ohne zu schieben');
    for (const [breite, hoehe, lage] of [[1400, 900, 'quer 1400'], [1200, 800, 'quer 1200'],
                                          [1000, 800, 'quer 1000'], [900, 1300, 'hoch 900'],
                                          [800, 1200, 'hoch 800'], [750, 1150, 'hoch 750'],
                                          [700, 1100, 'hoch 700']]) {
      win.setContentSize(breite, hoehe);
      await new Promise(r => setTimeout(r, 450));

      for (const navOffen of [false, true]) {
        if (breite === 700 && navOffen) continue;   // siehe oben
        await js(`document.getElementById('side-panel').classList.toggle('open', ${navOffen})`);
        await new Promise(r => setTimeout(r, 350));
        const m = await js(`(() => { const tb = document.querySelector('.toolbar');
          return { platz: Math.round(tb.clientWidth), noetig: Math.round(tb.scrollWidth) }; })()`);
        pruefe((lage + (navOffen ? ' + Navigation' : '')).padEnd(24)
          + m.noetig + ' von ' + m.platz + ' px',
          m.noetig <= m.platz, 'es stehen ' + (m.noetig - m.platz) + ' px heraus');
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

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH ' + ((err && err.stack) || err));
    fertig(3);
  }
});
