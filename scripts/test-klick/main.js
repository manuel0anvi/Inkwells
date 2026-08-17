'use strict';
/* ══════════════════════════════════════════════════════════════════════
   WO MAN HINKLICKT, KANN MAN AUCH SCHREIBEN

   Der Sinn von Inkwell ist, dass man irgendwo hindrückt und dort
   schreibt. Zweimal ist gemeldet worden, dass das nicht geht:

     · „sobald etwas geschrieben wurde, kann man nicht mehr hin, wo man
       möchte – der Cursor springt an den Anfang des einen oder ans Ende
       des anderen Wortes"
     · „beim Klick verschiebt sich alles, was darunter steht"

   Beides hing daran, dass ein angeklickter Absatz IM TEXTFLUSS stand.
   Seit dem 17.8.2026 steht er frei auf dem Blatt (left/top). Dieser
   Prüfstand misst genau die zwei Versprechen:

     1. der Text steht dort, wo geklickt wurde
     2. und nichts, was schon dastand, bewegt sich dabei

   Mit echten Klicks in einem echten Fenster – anders ist das nicht
   festzustellen, es hängt an der Geometrie des Textes.
   `npm run test:klick`; das Fenster muss sichtbar bleiben.
   ══════════════════════════════════════════════════════════════════════ */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');

const zeilen = [];
let fehl = 0;
const pruefe = (name, ok, info) => {
  zeilen.push((ok ? '  ok   ' : '  FEHL ') + name + (ok ? '' : '  -> ' + (info === undefined ? '' : info)));
  if (!ok) fehl++;
};
function fertig(code) {
  process.stdout.write('\n' + zeilen.join('\n') + '\n\n'
    + (fehl ? fehl + ' Pruefung(en) fehlgeschlagen.' : 'Alle Pruefungen bestanden.') + '\n');
  app.exit(code);
}
setTimeout(() => { zeilen.push('  ABBRUCH: Zeitgrenze'); fehl++; fertig(2); }, 120000);

const TMP = os.tmpdir();
const STUBS = {
  'load-settings': () => ({ saveLocation: TMP, language: 'de' }),
  'save-settings': () => ({ success: true }),
  'get-default-save-path': () => TMP,
  'load-registry': () => ({ notebooks: [] }),
  'save-registry': () => ({ success: true }),
  'check-internet': () => false,
  'get-pending-deep-link': () => null,
  'get-pending-share-link': () => null,
  'get-app-version': () => '0.0.0-probe',
  'check-for-updates': () => ({ ok: false }),
  'pick-folder': () => null,
  'notify-chat': () => true,
  'load': () => ({ notebooks: [] })
};
for (const [k, f] of Object.entries(STUBS)) ipcMain.handle(k, f);

app.on('ready', async () => {
 try {
  const win = new BrowserWindow({
    width: 1400, height: 950, show: true, backgroundColor: '#12121a',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });
  /* Ein Fehler im Fenster erklaert mehr als jede fehlgeschlagene
     Pruefung – ohne das sucht man ihn im Dunkeln. */
  win.webContents.on('console-message', (e, stufe, text) => {
    if (stufe >= 2) zeilen.push('  [Fenster] ' + text);
  });
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await new Promise(r => setTimeout(r, 2000));
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  const js = c => win.webContents.executeJavaScript(c);

  await js(`(() => {
    const nb = { id: 'probe', name: 'Probe', color: '#c8a96e', defaultBg: 'ruled',
                 pages: [makePage('ruled')], sections: [], created: Date.now() };
    S.notebooks = [nb]; openNotebook('probe'); return true; })()`);
  await new Promise(r => setTimeout(r, 1000));

  async function klick(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await dbg.sendCommand('Input.dispatchMouseEvent',
        { type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
          buttons: type === 'mousePressed' ? 1 : 0 });
    }
    await new Promise(r => setTimeout(r, 250));
  }
  async function tippe(text) {
    for (const ch of text) {
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp' });
    }
    await new Promise(r => setTimeout(r, 300));
  }
  async function enter() {
    await dbg.sendCommand('Input.dispatchKeyEvent',
      { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await dbg.sendCommand('Input.dispatchKeyEvent',
      { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await dbg.sendCommand('Input.dispatchKeyEvent',
      { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await new Promise(r => setTimeout(r, 300));
  }

  const inhalt = () => js(`document.querySelector('.j-text').innerHTML`);
  const roherText = () => js(`document.querySelector('.j-text').textContent`);

  /** Wo steht das Wort auf dem Bildschirm? {l, t} oder null */
  const wortOrt = (wort) => js(
    `(() => { const td = document.querySelector('.j-text');
       const lauf = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
       for (let n = lauf.nextNode(); n; n = lauf.nextNode()) {
         const i = n.nodeValue.indexOf(${JSON.stringify(wort)});
         if (i < 0) continue;
         const rg = document.createRange();
         rg.setStart(n, i); rg.setEnd(n, i + ${wort.length});
         const r = rg.getBoundingClientRect();
         return { l: Math.round(r.left), t: Math.round(r.top) };
       }
       return null; })()`);

  const feld = await js(
    `(() => { const r = document.querySelector('.j-text').getBoundingClientRect();
       const cs = getComputedStyle(document.querySelector('.j-text'));
       const td = document.querySelector('.j-text');
       const zoom = td.offsetHeight > 0 ? r.height / td.offsetHeight : 1;
       return { l: r.left, t: r.top, w: r.width,
                lh: parseFloat(cs.lineHeight) * zoom,
                pt: parseFloat(cs.paddingTop) * zoom }; })()`);
  // Mitte der n-ten Zeile auf dem Bildschirm
  const zeileY = n => feld.t + feld.pt + n * feld.lh + feld.lh / 2;

  // ── 1  Zwei Wörter, jedes dort, wo geklickt wurde ─────────────────
  zeilen.push('\n  1  Zwei Woerter an zwei gewaehlten Stellen');
  await klick(feld.l + 160, zeileY(2));
  await tippe('wort1');
  const ort1 = await wortOrt('wort1');
  pruefe('„wort1" steht, wo geklickt wurde',
    ort1 && Math.abs(ort1.l - (feld.l + 160)) < 14 && Math.abs(ort1.t - (zeileY(2) - feld.lh / 2)) < 14,
    JSON.stringify(ort1) + ' statt ' + Math.round(feld.l + 160) + ',' + Math.round(zeileY(2) - feld.lh / 2));

  await klick(feld.l + 520, zeileY(4));
  await tippe('wort2');
  const ort2 = await wortOrt('wort2');
  pruefe('„wort2" ebenso',
    ort2 && Math.abs(ort2.l - (feld.l + 520)) < 14, JSON.stringify(ort2));
  pruefe('Und „wort1" hat sich dabei nicht bewegt',
    JSON.stringify(await wortOrt('wort1')) === JSON.stringify(ort1),
    JSON.stringify(ort1) + ' -> ' + JSON.stringify(await wortOrt('wort1')));
  pruefe('Kein Leerzeichen im Text', !/[  ]/.test(await roherText()),
    JSON.stringify(await roherText()));

  // ── 2  Dazwischen – die gemeldete Stelle ──────────────────────────
  zeilen.push('\n  2  Zwischen die beiden geklickt');
  await klick(feld.l + 330, zeileY(3));
  await tippe('mitte');
  const ortM = await wortOrt('mitte');
  pruefe('Das Wort steht zwischen den beiden, wo gezeigt wurde',
    ortM && Math.abs(ortM.l - (feld.l + 330)) < 14, JSON.stringify(ortM));
  pruefe('Es springt nicht an „wort1"', ortM && ortM.l > ort1.l + 20, JSON.stringify(ortM));
  pruefe('Und nicht an „wort2"', ortM && ortM.t < ort2.t - 5, JSON.stringify(ortM));
  pruefe('„wort1" steht immer noch still',
    JSON.stringify(await wortOrt('wort1')) === JSON.stringify(ort1));
  pruefe('„wort2" auch',
    JSON.stringify(await wortOrt('wort2')) === JSON.stringify(ort2),
    JSON.stringify(ort2) + ' -> ' + JSON.stringify(await wortOrt('wort2')));

  // ── 3  Rechts neben ein Wort, links neben das andere ──────────────
  zeilen.push('\n  3  Rechts neben das eine, links neben das andere');
  await klick(feld.l + 300, zeileY(2));            // rechts neben wort1
  await tippe('rechts');
  const ortR = await wortOrt('rechts');
  pruefe('Rechts neben „wort1" steht es rechts davon',
    ortR && Math.abs(ortR.l - (feld.l + 300)) < 14 && Math.abs(ortR.t - ort1.t) < 6,
    JSON.stringify(ortR) + ' zu ' + JSON.stringify(ort1));

  await klick(feld.l + 300, zeileY(4));            // links neben wort2
  await tippe('links');
  const ortL = await wortOrt('links');
  pruefe('Links neben „wort2" steht es links davon',
    ortL && ortL.l < ort2.l - 20 && Math.abs(ortL.t - ort2.t) < 6,
    JSON.stringify(ortL) + ' zu ' + JSON.stringify(ort2));
  pruefe('Und „wort2" ist nicht ausgewichen',
    JSON.stringify(await wortOrt('wort2')) === JSON.stringify(ort2),
    JSON.stringify(ort2) + ' -> ' + JSON.stringify(await wortOrt('wort2')));
  pruefe('Nirgends ein Leerzeichen', !/[  ]/.test(await roherText()),
    JSON.stringify(await roherText()));

  // ── 4  Der Umbruch teilt den freien Absatz nicht ──────────────────
  zeilen.push('\n  4  Umbruch in einem freien Absatz');
  const vorUmbruch = (await js(`document.querySelectorAll('.j-text p.j-frei').length`));
  await enter();
  await tippe('zweite');
  pruefe('Es entsteht kein zweiter Absatz auf derselben Stelle',
    (await js(`document.querySelectorAll('.j-text p.j-frei').length`)) === vorUmbruch,
    'vorher ' + vorUmbruch + ', nachher ' + await js(`document.querySelectorAll('.j-text p.j-frei').length`));
  const ortZ = await wortOrt('zweite');
  pruefe('Die neue Zeile steht eine Zeile tiefer',
    ortZ && ortL && Math.abs((ortZ.t - ortL.t) - feld.lh) < 6,
    JSON.stringify(ortL) + ' -> ' + JSON.stringify(ortZ));
  pruefe('Zwei freie Absaetze liegen nie aufeinander', await js(
    `(() => { const ps = [...document.querySelectorAll('.j-text p.j-frei')];
       const gesehen = new Set();
       for (const p of ps) { const k = p.style.left + '|' + p.style.top;
         if (gesehen.has(k)) return false; gesehen.add(k); }
       return true; })()`),
    await inhalt());

  // ── 4c  Die drei Arten, aneinanderzustossen ──────────────────────
  /* Zwei Absaetze auf einer Zeile, dann im linken so viel schreiben,
     dass er den rechten wirklich erreicht – und danach wieder loeschen. */
  const NACHSCHUB = 'undnochvielmehrtextalsdazwischenpasst';

  async function stossen(art) {
    await js(`Settings.set ? Settings.set('textFluss', ${JSON.stringify(art)})
              : Settings.update({ textFluss: ${JSON.stringify(art)} })`);
    await js(`(() => { const td = document.querySelector('.j-text'); td.innerHTML = ''; return true; })()`);
    await klick(feld.l + 60, zeileY(2));
    await tippe('links');
    await klick(feld.l + 430, zeileY(2));
    await tippe('rechter');
    const vorher = await wortOrt('rechter');

    /* Erst den Fokus, dann die Marke: andersherum setzt focus() sie
       gelegentlich wieder an den Anfang des Feldes zurück, und dann
       landet das Getippte nirgends. */
    await js(`(() => { const td = document.querySelector('.j-text');
      td.focus();
      const p = td.querySelector('p.j-frei');
      const rg = document.createRange(); rg.selectNodeContents(p); rg.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
      return true; })()`);
    await tippe(NACHSCHUB);
    const nachher = await wortOrt('rechter');

    // Und genau so viel wieder wegnehmen
    for (let i = 0; i < NACHSCHUB.length; i++) {
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    }
    await new Promise(r => setTimeout(r, 400));
    const zurueck = await wortOrt('rechter');
    const bloecke = await js(`document.querySelectorAll('.j-text p.j-frei').length`);
    return { vorher, nachher, zurueck, bloecke, html: await inhalt() };
  }

  zeilen.push('\n  4c Die drei Arten, wenn Texte aneinanderstossen');
  const el = await stossen('elastisch');
  pruefe('elastisch: der Nachbar weicht aus',
    el.vorher && el.nachher && el.nachher.l > el.vorher.l + 10,
    JSON.stringify(el.vorher) + ' -> ' + JSON.stringify(el.nachher));
  pruefe('elastisch: und kommt wieder zurueck',
    el.zurueck && Math.abs(el.zurueck.l - el.vorher.l) <= 2,
    JSON.stringify(el.vorher) + ' -> ' + JSON.stringify(el.zurueck));
  pruefe('elastisch: die gewaehlte Stelle steht unveraendert im Heft',
    /left:\s*(43[0-9]|4[0-2][0-9])px/.test(el.html) || !/margin-left/.test(await js(
      `ohneGriffe(document.querySelector('.j-text'))`)),
    await js(`ohneGriffe(document.querySelector('.j-text'))`));

  const fe = await stossen('fest');
  pruefe('fest: der Nachbar weicht aus',
    fe.vorher && fe.nachher && fe.nachher.l > fe.vorher.l + 10,
    JSON.stringify(fe.vorher) + ' -> ' + JSON.stringify(fe.nachher));
  pruefe('fest: und bleibt, wo er hingerueckt ist',
    fe.zurueck && fe.zurueck.l > fe.vorher.l + 10,
    JSON.stringify(fe.nachher) + ' -> ' + JSON.stringify(fe.zurueck));

  const ve = await stossen('verschmelzen');
  pruefe('verschmelzen: aus zwei Absaetzen wird einer',
    ve.bloecke === 1, ve.bloecke + ' Absaetze: ' + ve.html);
  pruefe('verschmelzen: beide Texte stehen darin',
    /links/.test(ve.html) && /rechter/.test(ve.html), ve.html);

  await js(`Settings.set ? Settings.set('textFluss', 'elastisch')
            : Settings.update({ textFluss: 'elastisch' })`);

  // ── 5  Ein blosser Klick hinterlaesst nichts ──────────────────────
  zeilen.push('\n  5  Der blosse Klick');
  const vorher = await inhalt();
  await klick(feld.l + 600, zeileY(9));
  pruefe('Der Klick legt eine Stelle zum Schreiben an', (await inhalt()) !== vorher);
  await js(`(() => { document.querySelector('.j-text').blur(); return true; })()`);
  await new Promise(r => setTimeout(r, 300));
  pruefe('Ohne Tippen ist sie danach wieder weg', (await inhalt()) === vorher, await inhalt());

  // ── 6  Was der Rest der App daraus macht ──────────────────────────
  zeilen.push('\n  6  Sanitizer und Word-Export');
  const gereinigt = await js(
    `sanitizePageHtml('<p class="j-frei" style="left:120px;top:83px;color:#c04040">x</p>'
                    + '<p class="j-frei" style="left:9999999px;top:0px">y</p>')`);
  pruefe('Die Lage kommt durch', /left:\s*120px/.test(gereinigt) && /top:\s*83px/.test(gereinigt), gereinigt);
  pruefe('Die Klasse auch', /j-frei/.test(gereinigt), gereinigt);
  pruefe('Die Farbe bleibt', /color/.test(gereinigt), gereinigt);
  pruefe('Ein unsinniges Mass faellt weg', !/9999999/.test(gereinigt), gereinigt);

  /* Der Word-Export hat seinen eigenen Prüfstand (npm run test:docx) –
     htmlToParagraphs steht im Fenster gar nicht global. */

  fertig(fehl ? 1 : 0);
 } catch (err) {
  zeilen.push('  ABBRUCH: ' + (err && err.stack));
  fehl++;
  fertig(2);
 }
});
