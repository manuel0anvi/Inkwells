'use strict';
/* ══════════════════════════════════════════════════════════════════════
   WO MAN HINKLICKT, KANN MAN AUCH SCHREIBEN

   Der Sinn von Inkwell ist, dass man irgendwo hindrückt und dort
   schreibt. Zweimal ist gemeldet worden, dass das nicht mehr geht:

     · „sobald etwas geschrieben wurde, kann man nicht mehr hin, wo man
       möchte – der Cursor geht an den Anfang oder ans Ende der Zeile"
     · „beim Klick verschiebt sich alles, was darunter steht, eine
       Zeile nach unten"

   Beides lässt sich nur mit echten Klicks in einem echten Fenster
   feststellen: es hängt an der Geometrie des Textes, und die kennt
   allein der Browser. scripts/test-neue-teile.js prüft daneben die
   Quelle – das fängt den stillen Rückfall ab, dieser Prüfstand die
   Wirkung.

   Läuft mit `npm run test:klick`. Das Fenster muss dabei sichtbar
   bleiben; ohne Bild misst man Chromiums gedrosselte Darstellung.
   ══════════════════════════════════════════════════════════════════════ */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const ROOT = 'c:/Users/emili/Desktop/code local/Inkwells';

const zeilen = [];
let fehl = 0;
const pruefe = (name, ok, info) => {
  zeilen.push((ok ? '  ok   ' : '  FEHL ') + name + (ok ? '' : '  -> ' + (info === undefined ? '' : info)));
  if (!ok) fehl++;
};
const BERICHT = path.join(__dirname, 'bericht.txt');
function fertig(code) {
  const text = '\n===PROBE===\n' + zeilen.join('\n') + '\n\n'
    + (fehl ? fehl + ' Pruefung(en) fehlgeschlagen.' : 'Alle Pruefungen bestanden.') + '\n';
  try { require('fs').writeFileSync(BERICHT, text); } catch (e) { /* dann nur stdout */ }
  process.stdout.write(text);
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
  const inhalt = () => js(`document.querySelector('.j-text').innerHTML`);
  const roherText = () => js(`document.querySelector('.j-text').textContent`);

  /** Setzt den Seiteninhalt und gibt den Kasten des Textfeldes zurueck. */
  async function seite(html) {
    await js(`(() => { const td = document.querySelector('.j-text');
      td.innerHTML = ${JSON.stringify(html)}; return true; })()`);
    await new Promise(r => setTimeout(r, 250));
    return await js(`(() => { const r = document.querySelector('.j-text').getBoundingClientRect();
      return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
  }
  const obenVon = (wahl) => js(
    `(() => { const el = document.querySelector('.j-text ' + ${JSON.stringify(wahl)});
       return el ? Math.round(el.getBoundingClientRect().top) : null; })()`);
  const linksVon = (wahl) => js(
    `(() => { const el = document.querySelector('.j-text ' + ${JSON.stringify(wahl)});
       return el ? Math.round(el.getBoundingClientRect().left) : null; })()`);

  // ── 4  Was darunter steht, bleibt stehen ──────────────────────────
  zeilen.push('\n  4  Klick in die Luecke ueber vorhandenem Text');
  let r = await seite('<p id="unten" style="margin-top:224px">Einkaufsliste</p>');
  const untenVorher = await obenVon('#unten');
  await klick(r.l + 120, r.t + 100);
  await tippe('Hallo');
  const untenNachher = await obenVon('#unten');

  pruefe('Der Text darunter steht noch genau dort',
    untenVorher === untenNachher, untenVorher + ' -> ' + untenNachher);
  pruefe('Das Getippte steht ueber ihm',
    (await roherText()).indexOf('Hallo') === 0, JSON.stringify(await roherText()));
  pruefe('Und wirklich auf der Hoehe des Klicks', await js(
    `(() => { const p = document.querySelector('.j-text p');
       return Math.abs(p.getBoundingClientRect().top - ${r.t + 100}) < 34; })()`),
    await inhalt());
  pruefe('Kein Leerzeichen dabei', !/[  ]/.test(await roherText()), JSON.stringify(await roherText()));

  // ── 4b  Ohne Luecke wird auch keine gemacht ───────────────────────
  zeilen.push('\n  4b Klick zwischen zwei Absaetze ohne Luft');
  r = await seite('<p>Erste</p><p id="zwei">Zweite</p>');
  const zweiVorher = await obenVon('#zwei');
  await klick(r.l + 300, zweiVorher - 2);
  await tippe('X');
  pruefe('Der zweite Absatz bleibt, wo er war',
    zweiVorher === await obenVon('#zwei'), zweiVorher + ' -> ' + await obenVon('#zwei'));

  // ── 2a  Rechts neben den Text ─────────────────────────────────────
  zeilen.push('\n  2a Rechts neben geschriebenen Text');
  r = await seite('<p>Milch</p>');
  const rechtsVomWort = await js(
    `(() => { const p = document.querySelector('.j-text p');
       const rg = document.createRange(); rg.selectNodeContents(p);
       const rr = rg.getBoundingClientRect();
       return { r: rr.right, y: rr.top + rr.height / 2 }; })()`);
  await klick(rechtsVomWort.r + 230, rechtsVomWort.y);
  await tippe('12');
  let html = await inhalt();
  let text = await roherText();
  pruefe('Ein Abstandshalter statt Leerzeichen', /j-luecke/.test(html), html);
  pruefe('Kein Leerzeichen im Text', !/[  ]/.test(text), JSON.stringify(text));
  pruefe('Das Getippte steht dahinter', /12$/.test(text.trim()), JSON.stringify(text));
  pruefe('Und wirklich dort, wo geklickt wurde', await js(
    `(() => { const h = document.querySelector('.j-luecke');
       return Math.abs(h.getBoundingClientRect().right - ${rechtsVomWort.r + 230}) < 14; })()`),
    html);

  // ── 2b  Links neben den Text ──────────────────────────────────────
  zeilen.push('\n  2b Links neben eingerueckten Text');
  r = await seite('<p id="satz" style="margin-left:320px">Hallo</p>');
  const satzLinksVorher = await linksVon('#satz span, #satz');
  const satzWortVorher = await js(
    `(() => { const p = document.querySelector('#satz');
       const rg = document.createRange(); rg.selectNodeContents(p);
       return Math.round(rg.getBoundingClientRect().left); })()`);
  await klick(r.l + 90, (await obenVon('#satz')) + 14);
  /* Gemessen wird VOR dem Tippen: dass geschriebene Zeichen die Zeile
     nach rechts schieben, ist richtig so – der blosse Klick darf es nicht. */
  const satzWortNachKlick = await js(
    `(() => { const p = document.querySelector('#satz');
       const t = [...p.childNodes].find(n => n.nodeType === 3 && n.nodeValue.includes('Hallo'));
       if (!t) return null;
       const rg = document.createRange(); rg.selectNodeContents(t);
       return Math.round(rg.getBoundingClientRect().left); })()`);
  await tippe('Ab');
  html = await inhalt();
  text = await roherText();
  const satzWortNachher = await js(
    `(() => { const p = document.querySelector('#satz');
       const t = [...p.childNodes].find(n => n.nodeType === 3 && n.nodeValue.includes('Hallo'));
       if (!t) return null;
       const rg = document.createRange(); rg.selectNodeContents(t);
       return Math.round(rg.getBoundingClientRect().left); })()`);

  pruefe('„Hallo" steht nach dem Klick noch genau dort',
    satzWortVorher !== null && Math.abs(satzWortNachKlick - satzWortVorher) <= 2,
    satzWortVorher + ' -> ' + satzWortNachKlick + '  ' + html);
  pruefe('Und rueckt danach genau um das Geschriebene',
    satzWortNachher > satzWortNachKlick && satzWortNachher - satzWortNachKlick < 40,
    satzWortNachKlick + ' -> ' + satzWortNachher);
  pruefe('Das Getippte steht links davon', /^Ab/.test(text.replace(/\u200b/g, '')),
    JSON.stringify(text));
  pruefe('Kein Leerzeichen dabei', !/[  ]/.test(text), JSON.stringify(text));
  pruefe('Und an der geklickten Stelle', await js(
    `(() => { const p = document.querySelector('#satz');
       return Math.abs(p.getBoundingClientRect().left - ${r.l + 90}) < 14; })()`),
    html);

  // ── 2c  Mitten in einen vorhandenen Abstand ───────────────────────
  zeilen.push('\n  2c Mitten in einen vorhandenen Abstand');
  r = await seite('<p>A<span class="j-luecke" contenteditable="false" style="width:300px">\u200b</span>B</p>');
  const bVorher = await js(
    `(() => { const p = document.querySelector('.j-text p');
       const t = [...p.childNodes].find(n => n.nodeType === 3 && n.nodeValue === 'B');
       const rg = document.createRange(); rg.selectNodeContents(t);
       return Math.round(rg.getBoundingClientRect().left); })()`);
  const luecke = await js(
    `(() => { const h = document.querySelector('.j-luecke').getBoundingClientRect();
       return { l: h.left, r: h.right, y: h.top + h.height / 2 }; })()`);
  await klick(luecke.l + (luecke.r - luecke.l) / 2, luecke.y);
  await tippe('M');
  html = await inhalt();
  text = await roherText();
  pruefe('Aus einem Abstand sind zwei geworden',
    (html.match(/j-luecke/g) || []).length === 2, html);
  pruefe('Das Getippte steht dazwischen',
    /A[^BM]*M[^A]*B/.test(text.replace(/\u200b/g, '')), JSON.stringify(text));
  pruefe('Kein Leerzeichen dabei', !/[  ]/.test(text), JSON.stringify(text));

  // ── 3  Ein blosser Klick raeumt sich wieder weg ───────────────────
  zeilen.push('\n  3  Der blosse Klick hinterlaesst nichts');
  r = await seite('<p id="unten2" style="margin-top:224px">Einkaufsliste</p>');
  const vorherHtml = await inhalt();
  const vorherOben = await obenVon('#unten2');
  await klick(r.l + 200, r.t + 96);
  pruefe('Der Klick legt etwas an', (await inhalt()) !== vorherHtml);
  await js(`(() => { document.querySelector('.j-text').blur(); return true; })()`);
  await new Promise(r2 => setTimeout(r2, 300));
  /* Verglichen ohne Leerraum und Strichpunkte: das Zuruecksetzen schreibt
     den Stil neu, und der Browser schreibt ihn dabei in seiner eigenen
     Schreibweise ("margin-top: 224px;"). Gemeint ist derselbe Wert. */
  const gleichArtig = (s) => String(s).replace(/[\s;]+/g, '');
  pruefe('Ohne Tippen ist es danach wieder weg',
    gleichArtig(await inhalt()) === gleichArtig(vorherHtml),
    'vorher: ' + JSON.stringify(vorherHtml) + '  nachher: ' + JSON.stringify(await inhalt()));
  pruefe('Und der Abstand darunter ist wiederhergestellt',
    vorherOben === await obenVon('#unten2'), vorherOben + ' -> ' + await obenVon('#unten2'));

  fertig(fehl ? 1 : 0);
 } catch (err) {
  zeilen.push('  ABBRUCH: ' + (err && err.message));
  fehl++;
  fertig(2);
 }
});
