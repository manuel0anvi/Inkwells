/* ══════════════════════════════════════════════════════════════════════
   ZWEI LEUTE, ECHTE TASTEN, DIE ECHTE APP

   >>> Warum es diesen Prüfstand zusätzlich gibt <<<
   scripts/test-collab-live prüft schon zwei Fenster mit dem echten
   ui/collab.js – aber auf einer NACHGEBAUTEN Seite und über
   pruefstand.setzeText(), also ohne Tastendruck. Sein eigener Kopf sagt
   das ausdrücklich: „Was hier NICHT mitläuft, ist der Weg über
   'beforeinput', also das Abweisen einer Eingabe in einer gesperrten
   Zeile."

   Genau dort wurde der Fehler gemeldet: beim SCHREIBEN und beim ENTER
   geht der Text des anderen kaputt, obwohl seine Zeile gesperrt ist.
   Diese Kette – Taste → app.js keydown → lockedHere → execCommand →
   'input' → uebernimmText → Collab.noteTextChange → textDelta → Yjs –
   lief in keinem Prüfstand.

   Hier laufen deshalb zwei Fenster mit der ECHTEN src/index.html, samt
   app.js und allem, was daran hängt. Ersetzt ist nur der Raum: die
   Nachrichten gehen über den Hauptprozess statt über die Realtime
   Database, und zwar ohne Verzögerung. Getippt wird über das
   Chrome-DevTools-Protokoll, also mit richtigen Tastenereignissen; das
   geht auch in ein Fenster, das gerade nicht den Tastaturfokus des
   Betriebssystems hat.

   Läuft NICHT in `npm test` – braucht Electron.
   Aufruf:  npm run test:tasten
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

/* ── Die Handgriffe des echten main.js, als Attrappe ───────────────── */
const ABLAGE = path.join(app.getPath('temp'), 'inkwells-tasten');
const ATTRAPPEN = {
  'load-settings': { saveLocation: ABLAGE }, 'save-settings': true,
  'load-registry': { notebooks: [] }, 'save-registry': true,
  'get-default-save-path': ABLAGE, 'check-internet': false,
  'get-pending-deep-link': null, 'get-pending-share-link': null, 'pick-folder': null,
  'get-app-version': '1.1.1', 'load': null, 'pick-files': [], 'pick-document': null,
  'load-from-path': null, 'file-exists': false,
  'delete-file': { success: true }, 'move-file': { success: true },
  'save-to-path': { success: true }, 'save': { success: true },
  'export-pdf': { success: true }, 'save-binary': { success: true },
  'postfach-lesen': null, 'postfach-schreiben': true, 'check-update': null,
  'erst-start': false, 'load-postfach': null, 'save-postfach': true,
  'get-locale': 'de', 'ist-storefassung': false
};
for (const [k, v] of Object.entries(ATTRAPPEN)) {
  ipcMain.handle(k, async () => (typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v));
}
for (const k of ['silent-auth', 'win-min', 'win-max', 'win-close']) ipcMain.on(k, () => {});

/* ── Der Raum, gebrückt zwischen den Fenstern ──────────────────────── */
const karten = new Map();
const fenster = [];

function schickePraesenz() {
  const liste = Array.from(karten.values());
  for (const w of fenster) if (!w.isDestroyed()) w.webContents.send('kollab-praesenz', liste);
}
ipcMain.on('kollab-praesenz', (e, karte) => { karten.set(karte.uid, karte); schickePraesenz(); });
ipcMain.on('kollab-op', (e, op) => {
  for (const w of fenster) {
    if (w.isDestroyed() || w.webContents.id === e.sender.id) continue;
    w.webContents.send('kollab-op', op);
  }
});

/* ── Bericht ───────────────────────────────────────────────────────── */
const zeilen = [];
const abschnitt = (name) => { zeilen.push(''); zeilen.push(name); };
const notiz = (text) => zeilen.push('     ' + text);
const pruefe = (was, ok, hinweis) =>
  zeilen.push((ok ? 'ok   ' : 'FEHL ') + was + (ok ? '' : '  -> ' + hinweis));

function fertig(code) {
  process.stdout.write('\nZwei Leute, echte Tasten\n');
  process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');
  const fehl = zeilen.filter(l => /^(FEHL|ABBRUCH)/.test(l)).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : code);
}
setTimeout(() => { zeilen.push('ABBRUCH: Zeitgrenze erreicht'); fertig(2); }, 240000);

const warte = ms => new Promise(r => setTimeout(r, ms));

/* Der Raum wird im Renderer eingesetzt, BEVOR Collab.start() laeuft.
   Dieselbe Schnittstelle wie joinDocRoom() in core/share.js. */
const RAUM_CODE = (wer, farbe) => `
(() => {
  const { ipcRenderer } = require('electron');
  const meineKarte = {
    uid: ${JSON.stringify(wer)}, name: ${JSON.stringify(wer)},
    email: ${JSON.stringify(wer.toLowerCase() + '@probe.example')},
    initials: ${JSON.stringify(wer)}, color: ${JSON.stringify(farbe)},
    pageId: '', offset: -1, lockFrom: -1, lockTo: -1, lockAt: 0, cx: '',
    objLock: '', objLockAt: 0, at: Date.now()
  };
  let presenceCb = null, opCb = null;
  ipcRenderer.on('kollab-praesenz', (_e, liste) => {
    if (presenceCb) presenceCb(liste.filter(p => p.uid !== meineKarte.uid));
  });
  ipcRenderer.on('kollab-op', (_e, op) => { if (opCb) opCb(op); });

  window.InkwellsShare = Object.assign({}, window.InkwellsShare, {
    joinDocRoom: async () => ({
      me: meineKarte,
      setPage(pageId, offset, lock, anchor) {
        meineKarte.pageId = pageId;
        if (Number.isFinite(offset)) meineKarte.offset = offset;
        meineKarte.lockFrom = lock && Number.isFinite(lock.from) ? lock.from : -1;
        meineKarte.lockTo = lock && Number.isFinite(lock.to) ? lock.to : -1;
        if (meineKarte.lockFrom >= 0) meineKarte.lockAt = Date.now();
        meineKarte.cx = String(anchor || '').slice(0, 64);
        meineKarte.at = Date.now();
        ipcRenderer.send('kollab-praesenz', { ...meineKarte });
      },
      setObjLock(pageId, objId) {
        const wert = (pageId && objId) ? (String(pageId) + '#' + String(objId)) : '';
        if (wert === meineKarte.objLock) return;
        meineKarte.objLock = wert;
        meineKarte.objLockAt = wert ? Date.now() : 0;
        meineKarte.at = Date.now();
        ipcRenderer.send('kollab-praesenz', { ...meineKarte });
      },
      onPresence(cb) { presenceCb = cb; return () => { presenceCb = null; }; },
      onOwnerAway(cb) { cb(false); return () => {}; },
      onConnection(cb) { cb(true); return () => {}; },
      sendOp(op) { ipcRenderer.send('kollab-op', { ...op, by: meineKarte.uid, at: Date.now() }); return Promise.resolve(true); },
      onOp(cb) { opCb = cb; return () => { opCb = null; }; },
      setRoles() {}, leave() {}
    })
  });
  return true;
})()`;

/* Ein Heft mit EINER Seite, in beiden Fenstern gleich. */
const HEFT_CODE = (text) => `
(() => {
  const nb = { id: 'gemeinsam', name: 'Gemeinsam', color: '#c8a96e',
               defaultBg: 'ruled', sections: [], created: Date.now(),
               pages: [{ id: 'seite1', date: new Date().toISOString(), bg: 'ruled',
                         textContent: ${JSON.stringify(text)}, inkStrokes: [], objects: [] }] };
  S.notebooks = [nb];
  openNotebook('gemeinsam');
  return true;
})()`;

app.on('ready', async () => {
  try {
    const mach = async (wer, x) => {
      const w = new BrowserWindow({
        width: 900, height: 800, show: true, x, y: 20,
        backgroundColor: '#12121a',
        webPreferences: {
          preload: path.join(ROOT, 'preload.js'),
          contextIsolation: false, nodeIntegration: true,
          backgroundThrottling: false
        }
      });
      fenster.push(w);
      await w.loadFile(path.join(ROOT, 'src', 'index.html'));
      return w;
    };

    const wa = await mach('A', 10);
    const wb = await mach('B', 930);
    await warte(3000);

    const A = (code) => wa.webContents.executeJavaScript(code);
    const B = (code) => wb.webContents.executeJavaScript(code);

    const fehlerA = [], fehlerB = [];
    const sammle = (args, ziel) => {
      const erst = args[0];
      const stufe = (erst && typeof erst === 'object' && 'level' in erst) ? erst.level : args[1];
      const text = (erst && typeof erst === 'object' && 'message' in erst) ? erst.message : args[2];
      if (Number(stufe) >= 3) ziel.push(String(text));
    };
    wa.webContents.on('console-message', (...a) => sammle(a, fehlerA));
    wb.webContents.on('console-message', (...a) => sammle(a, fehlerB));

    const dbgA = wa.webContents.debugger; dbgA.attach('1.3');
    const dbgB = wb.webContents.debugger; dbgB.attach('1.3');

    /* ── Tippen mit richtigen Tasten ──────────────────────────────── */
    async function tippe(dbg, text) {
      for (const ch of text) {
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp' });
        await warte(25);
      }
    }
    async function enter(dbg) {
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await warte(120);
    }

    /* Die Schreibmarke auf eine Stelle im flachen Text setzen und melden. */
    const markeAuf = (W, stelle) => W(`(() => {
      const td = document.querySelector('.j-text');
      td.focus();
      const ok = setFlatCaret(td, ${stelle});
      document.dispatchEvent(new Event('selectionchange'));
      return ok ? flatCaretPos(td) : null;
    })()`);

    const flach = (W) => W(`flatTextOf(document.querySelector('.j-text'))`);
    const roh = (W) => W(`document.querySelector('.j-text').innerHTML`);
    const yText = (W) => W(`Collab._ytextOf ? Collab._ytextOf('seite1') : null`);

    /* ── Beitreten ────────────────────────────────────────────────── */
    abschnitt('Beide betreten dasselbe Heft');
    const START = '<p>Alpha</p><p>Beta</p><p>Gamma</p><p>Delta</p>';

    await A(RAUM_CODE('A', '#c04040'));
    await B(RAUM_CODE('B', '#2a5fa8'));
    await A(HEFT_CODE(START));
    await B(HEFT_CODE(START));
    await warte(700);

    await A(`Collab.start('probe-doc', getNb(), null, true, { isOwner: true, ownerUid: 'A' })`);
    await B(`Collab.start('probe-doc', getNb(), null, true, { isOwner: false, ownerUid: 'A' })`);
    await warte(1200);

    const startA = await flach(A), startB = await flach(B);
    pruefe('Beide sehen denselben Text',
      startA === startB && /Alpha/.test(startA),
      JSON.stringify({ A: startA, B: startB }));

    /* ══════════════════════════════════════════════════════════════════
       1. GLEICHZEITIG SCHREIBEN, WEIT AUSEINANDER

       A schreibt in Zeile 1, B in Zeile 4. Zwei Änderungen an zwei
       Stellen – genau der Fall, den textDelta zu EINEM Block
       zusammenfasst (siehe der Kasten dort).
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Gleichzeitig schreiben, weit auseinander');

    await markeAuf(A, 5);      // hinter "Alpha"
    await markeAuf(B, 22);     // hinter "Delta" (Alpha\nBeta\nGamma\nDelta)
    await warte(300);

    await Promise.all([tippe(dbgA, '111'), tippe(dbgB, '999')]);
    await warte(1800);

    const nachA = await flach(A), nachB = await flach(B);
    notiz('A sieht: ' + JSON.stringify(nachA));
    notiz('B sieht: ' + JSON.stringify(nachB));

    pruefe('A sieht seine eigene Eingabe', /Alpha111/.test(nachA),
      'A hat "111" hinter Alpha getippt');
    pruefe('A sieht auch, was B geschrieben hat', /Delta999/.test(nachA),
      'B hat "999" hinter Delta getippt – bei A fehlt es');
    pruefe('B sieht seine eigene Eingabe', /Delta999/.test(nachB), '');
    pruefe('B sieht auch, was A geschrieben hat', /Alpha111/.test(nachB),
      'A hat "111" hinter Alpha getippt – bei B fehlt es');
    pruefe('Beide sehen am Ende dasselbe', nachA === nachB,
      JSON.stringify({ A: nachA, B: nachB }));

    /* ══════════════════════════════════════════════════════════════════
       2. ENTER, WÄHREND DER ANDERE SCHREIBT

       Das gemeldete Bild: „wenn man schreibt und Enter drückt, buggt es
       den ganzen Text des anderen".
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Enter, während der andere schreibt');

    const VOR_ENTER = '<p>Eins</p><p>Zwei</p><p>Drei</p><p>Vier</p>';
    await A(`(() => { const td = document.querySelector('.j-text');
      td.innerHTML = ${JSON.stringify(VOR_ENTER)};
      uebernimmText(getPage('seite1').page, td); return true; })()`);
    await warte(1200);
    const gleich = (await flach(A)) === (await flach(B));
    pruefe('Beide stehen auf demselben Stand', gleich,
      JSON.stringify({ A: await flach(A), B: await flach(B) }));

    // B schreibt am Ende, A drückt oben Enter
    await markeAuf(B, 19);     // hinter "Vier"
    await markeAuf(A, 4);      // hinter "Eins"
    await warte(300);

    const tippenB = tippe(dbgB, 'XYZ');
    await warte(60);
    await enter(dbgA);
    await tippenB;
    await warte(2000);

    const eA = await flach(A), eB = await flach(B);
    notiz('A sieht: ' + JSON.stringify(eA));
    notiz('B sieht: ' + JSON.stringify(eB));

    pruefe('Bs Text hat das Enter von A überlebt', /VierXYZ/.test(eA),
      'A hat oben Enter gedrückt und dabei Bs Eingabe unten mitgenommen');
    pruefe('Und A sieht seinen eigenen Umbruch', /Eins\n/.test(eA),
      'der Umbruch ist nicht angekommen');
    pruefe('Beide sehen dasselbe', eA === eB, JSON.stringify({ A: eA, B: eB }));

    /* ══════════════════════════════════════════════════════════════════
       3. IN DIE GESPERRTE ZEILE DES ANDEREN SCHREIBEN

       B schreibt in Zeile 3, damit gehört sie ihm (lockSpanFor). A stellt
       sich hinein und tippt – es darf nichts passieren.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('In die gesperrte Zeile des anderen schreiben');

    const VOR_SPERRE = '<p>Aaa</p><p>Bbb</p><p>Ccc</p><p>Ddd</p>';
    await A(`(() => { const td = document.querySelector('.j-text');
      td.innerHTML = ${JSON.stringify(VOR_SPERRE)};
      uebernimmText(getPage('seite1').page, td); return true; })()`);
    await warte(1400);

    // B tippt in Zeile 3 ("Ccc" beginnt bei 8) und beansprucht sie damit
    await markeAuf(B, 11);
    await warte(200);
    await tippe(dbgB, '!');
    await warte(900);

    const bandBeiA = await A(`(() => {
      const p = Collab.people ? Collab.people() : [];
      const s = Collab.lockOwner ? Collab.lockOwner('seite1', 8, 12) : null;
      return { leute: p.length, sperrt: s ? (s.name || s.uid) : null };
    })()`);
    notiz('bei A: ' + JSON.stringify(bandBeiA));
    pruefe('A sieht, dass B die Zeile hält', !!bandBeiA.sperrt,
      'ohne Sperre kann A hineinschreiben');

    const vorEingriff = await flach(A);
    await markeAuf(A, 11);     // mitten in Bs Zeile
    await warte(200);
    await tippe(dbgA, 'ZZZ');
    await warte(1200);

    const nachEingriff = await flach(A);
    const bNachEingriff = await flach(B);
    notiz('A vorher : ' + JSON.stringify(vorEingriff));
    notiz('A nachher: ' + JSON.stringify(nachEingriff));

    pruefe('As Tippen in der gesperrten Zeile bleibt wirkungslos',
      !/ZZZ/.test(nachEingriff),
      'A hat in die Zeile geschrieben, die B gehört: ' + JSON.stringify(nachEingriff));
    pruefe('Und bei B steht es auch nicht', !/ZZZ/.test(bNachEingriff),
      JSON.stringify(bNachEingriff));
    pruefe('Bs eigene Eingabe steht noch da', /Ccc!/.test(bNachEingriff),
      JSON.stringify(bNachEingriff));

    /* ══════════════════════════════════════════════════════════════════
       ...UND DANACH DARF MAN WIEDER SCHREIBEN

       Wer aus einer fremden Zeile herausgeschoben wird, muss in seiner
       EIGENEN weiterschreiben können. Bekam das Feld dabei den Fokus
       genommen und niemand gab ihn zurück, war die Seite für ihn tot:
       jeder weitere Anschlag ging ins Leere, ohne dass etwas darauf
       hindeutete.
       ══════════════════════════════════════════════════════════════════ */
    const fokusNachAbweisung = await A(`
      document.activeElement === document.querySelector('.j-text')`);
    notiz('A hat danach noch den Fokus: ' + fokusNachAbweisung);
    pruefe('A behält den Fokus – das Feld wird nicht stillgelegt',
      fokusNachAbweisung === true,
      'ohne Fokus geht jeder weitere Anschlag ins Leere, und niemand sagt warum');

    /* Die Marke in die eigene Zeile setzen – wie ein Klick es täte – und
       dort weiterschreiben. Das muss gehen, ohne dass A das Feld erst
       wieder „aufwecken" müsste. */
    await markeAuf(A, 3);
    await warte(250);
    await tippe(dbgA, 'OK');
    await warte(1200);

    const wiederA = await flach(A), wiederB = await flach(B);
    notiz('A danach: ' + JSON.stringify(wiederA));
    pruefe('A kann danach in seiner eigenen Zeile weiterschreiben',
      /AaaOK/.test(wiederA),
      'A wurde aus der fremden Zeile geschoben und kann seither gar nicht mehr tippen');
    pruefe('Und es kommt auch bei B an', /AaaOK/.test(wiederB),
      JSON.stringify(wiederB));

    /* ══════════════════════════════════════════════════════════════════
       4. LANGES DURCHTIPPEN AUF BEIDEN SEITEN

       Kein Kunstgriff, nur Dauerbetrieb: geht dabei etwas verloren?
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Beide tippen lange durch');

    const VOR_DAUER = '<p>Oben</p><p>Unten</p>';
    await A(`(() => { const td = document.querySelector('.j-text');
      td.innerHTML = ${JSON.stringify(VOR_DAUER)};
      uebernimmText(getPage('seite1').page, td); return true; })()`);
    await warte(1400);

    await markeAuf(A, 4);      // hinter "Oben"
    await markeAuf(B, 10);     // hinter "Unten"
    await warte(300);

    /* Mitschreiben, was mit dem Fokus und der Marke passiert: verliert
       das Feld ihn mittendrin, gehen alle weiteren Anschläge ins Leere. */
    await A(`(() => {
      window.__spur = [];
      const td = document.querySelector('.j-text');
      /* Wer ruft blur()? Der Aufrufstapel sagt es genau. */
      const echtesBlur = td.blur.bind(td);
      td.blur = function () {
        const stapel = (new Error().stack || '').split('\\n').slice(1, 4)
          .map(z => z.trim().replace(/^at\\s+/, '').replace(/.*[\\\\/]/, ''));
        let lage = {};
        try {
          const stelle = flatCaretPos(td);
          const fremde = (Collab.people() || []).map(p => {
            const c = Collab.caretOf ? Collab.caretOf('seite1', p.uid) : null;
            return { wer: p.name, marke: c };
          });
          lage = {
            text: JSON.stringify(flatTextOf(td)),
            meineMarke: stelle,
            sperrtHier: (() => { const s = Collab.lockOwner('seite1', stelle, stelle); return s ? s.name : null; })(),
            fremde
          };
        } catch (e) { lage = { fehler: String(e && e.message || e) }; }
        window.__spur.push('blur von: ' + stapel.join(' <- ') + '  ' + JSON.stringify(lage));
        return echtesBlur();
      };
      td.addEventListener('blur', () => window.__spur.push('-> Feld ist jetzt aus'));
      td.addEventListener('focus', () => window.__spur.push('-> Feld ist wieder an'));

      /* Laufend mitschreiben: wo steht meine Marke, und welchen Bereich
         sperrt der andere gerade? Der Bereich wird abgetastet, weil die
         gemeldeten Grenzen von aussen nicht zu sehen sind. */
      window.__proben = [];
      window.__takt = setInterval(() => {
        try {
          const text = flatTextOf(td);
          let marke = null;
          try { marke = flatCaretPos(td); } catch (e) {}
          let von = -1, bis = -1;
          for (let i = 0; i <= text.length; i++) {
            const s = Collab.lockOwner('seite1', i, i);
            if (s) { if (von < 0) von = i; bis = i; }
          }
          const letzte = window.__proben[window.__proben.length - 1];
          const jetzt = JSON.stringify({ t: text, m: marke, von, bis });
          if (!letzte || letzte !== jetzt) window.__proben.push(jetzt);
        } catch (e) { window.__proben.push('Fehler: ' + e.message); }
      }, 30);
      return true; })()`);

    await Promise.all([tippe(dbgA, 'abcdefghij'), tippe(dbgB, '0123456789')]);
    await warte(2500);

    await A(`clearInterval(window.__takt); true`);
    const spur = await A(`JSON.stringify(window.__spur)`);
    const proben = await A(`window.__proben.slice(0, 22)`);
    notiz('Fokus bei A: ' + spur);
    notiz('Verlauf (Text | meine Marke | fremde Sperre von..bis):');
    for (const p of proben) {
      try {
        const o = JSON.parse(p);
        notiz(`   ${JSON.stringify(o.t).padEnd(22)} Marke ${String(o.m).padStart(4)}   Sperre ${o.von}..${o.bis}`);
      } catch (e) { notiz('   ' + p); }
    }

    const dA = await flach(A), dB = await flach(B);
    notiz('A: ' + JSON.stringify(dA));
    notiz('B: ' + JSON.stringify(dB));
    pruefe('Alles von A ist da', /Obenabcdefghij/.test(dA), JSON.stringify(dA));
    pruefe('Alles von B ist da', /Unten0123456789/.test(dA), JSON.stringify(dA));
    pruefe('Und beide sehen dasselbe', dA === dB, JSON.stringify({ A: dA, B: dB }));

    /* Ein gemeinsamer Ausgangstext für die folgenden Läufe. */
    async function setzeBeide(html) {
      await A(`(() => { const td = document.querySelector('.j-text');
        td.innerHTML = ${JSON.stringify(html)};
        uebernimmText(getPage('seite1').page, td); return true; })()`);
      await warte(1500);
      return (await flach(A)) === (await flach(B));
    }

    /* ══════════════════════════════════════════════════════════════════
       5. BEIDE IN DERSELBEN ZEILE

       Der härteste Fall: A und B schreiben in dieselbe Zeile. Einer von
       beiden muss zurückstehen – aber es darf nichts VERSCHWINDEN, was
       schon dastand.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Beide in derselben Zeile');

    pruefe('Ausgangstext steht bei beiden', await setzeBeide('<p>Zusammen</p><p>Unten</p>'), '');
    await markeAuf(A, 8);      // hinter "Zusammen"
    await warte(400);
    await tippe(dbgA, 'A');
    await warte(800);          // A hat die Zeile jetzt beansprucht
    await markeAuf(B, 4);      // mitten in derselben Zeile
    await warte(300);
    await tippe(dbgB, 'B');
    await warte(1500);

    const sA = await flach(A), sB = await flach(B);
    notiz('A: ' + JSON.stringify(sA));
    notiz('B: ' + JSON.stringify(sB));
    pruefe('Der Ausgangstext ist unversehrt', /Zusammen/.test(sA) && /Unten/.test(sA),
      JSON.stringify(sA));
    pruefe('Wer zuerst da war, behält seine Eingabe', /ZusammenA/.test(sA),
      'As Eingabe ist verschwunden: ' + JSON.stringify(sA));
    pruefe('Und beide sehen dasselbe', sA === sB, JSON.stringify({ A: sA, B: sB }));

    /* ══════════════════════════════════════════════════════════════════
       6. DER EINE LÖSCHT, DER ANDERE SCHREIBT
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Der eine löscht, der andere schreibt');

    pruefe('Ausgangstext steht bei beiden',
      await setzeBeide('<p>Loeschen</p><p>Behalten</p>'), '');
    await markeAuf(A, 8);      // Ende von "Loeschen"
    await markeAuf(B, 17);     // Ende von "Behalten"
    await warte(400);

    const rueckwaerts = async (dbg, n) => {
      for (let i = 0; i < n; i++) {
        await dbg.sendCommand('Input.dispatchKeyEvent',
          { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await dbg.sendCommand('Input.dispatchKeyEvent',
          { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await warte(40);
      }
    };

    await Promise.all([rueckwaerts(dbgA, 3), tippe(dbgB, '!!')]);
    await warte(1800);

    const lA = await flach(A), lB = await flach(B);
    notiz('A: ' + JSON.stringify(lA));
    notiz('B: ' + JSON.stringify(lB));
    // "Loeschen" (8 Zeichen) minus drei Rückschritte = "Loesc"
    pruefe('Genau drei Zeichen sind weg', /^Loesc\n/.test(lA), JSON.stringify(lA));
    pruefe('Das Geschriebene ist da', /Behalten!!/.test(lA), JSON.stringify(lA));
    pruefe('Und beide sehen dasselbe', lA === lB, JSON.stringify({ A: lA, B: lB }));

    /* ══════════════════════════════════════════════════════════════════
       7. MEHRMALS ENTER HINTEREINANDER

       Ein Umbruch verschiebt alles darunter. Mehrere schnell
       hintereinander, während der andere unten schreibt, ist der Fall,
       bei dem sich die Stellen am ehesten verzählen.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Mehrmals Enter, während der andere unten schreibt');

    pruefe('Ausgangstext steht bei beiden',
      await setzeBeide('<p>Kopf</p><p>Fuss</p>'), '');
    await markeAuf(A, 4);      // hinter "Kopf"
    await markeAuf(B, 9);      // hinter "Fuss"
    await warte(400);

    const enters = (async () => { for (let i = 0; i < 3; i++) await enter(dbgA); })();
    await tippe(dbgB, 'unten');
    await enters;
    await warte(2000);

    const nA = await flach(A), nB = await flach(B);
    notiz('A: ' + JSON.stringify(nA));
    notiz('B: ' + JSON.stringify(nB));
    pruefe('Der Kopf steht noch', /^Kopf/.test(nA), JSON.stringify(nA));
    pruefe('Bs Eingabe unten ist unversehrt', /Fussunten/.test(nA),
      'die Umbrüche von A haben Bs Text mitgenommen: ' + JSON.stringify(nA));
    pruefe('Und beide sehen dasselbe', nA === nB, JSON.stringify({ A: nA, B: nB }));

    /* ══════════════════════════════════════════════════════════════════
       8. GANZ AM ANFANG SCHREIBEN

       Stelle 0 ist die, auf die Chromium die Marke legt, wenn es sie
       verloren hat – deshalb ausdrücklich geprüft.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Der eine schreibt ganz am Anfang');

    pruefe('Ausgangstext steht bei beiden',
      await setzeBeide('<p>Mitte</p><p>Ende</p>'), '');
    await markeAuf(A, 0);
    await markeAuf(B, 10);
    await warte(400);
    await Promise.all([tippe(dbgA, 'vor'), tippe(dbgB, 'nach')]);
    await warte(1800);

    const aA = await flach(A), aB = await flach(B);
    notiz('A: ' + JSON.stringify(aA));
    notiz('B: ' + JSON.stringify(aB));
    pruefe('Der Anfang ist da', /^vorMitte/.test(aA), JSON.stringify(aA));
    pruefe('Das Ende auch', /Endenach/.test(aA), JSON.stringify(aA));
    pruefe('Und beide sehen dasselbe', aA === aB, JSON.stringify({ A: aA, B: aB }));

    /* ══════════════════════════════════════════════════════════════════
       9. RÜCKGÄNGIG, WÄHREND DER ANDERE SCHREIBT

       Der Verlauf hält je Schritt ein vollständiges Abbild der Seite.
       Ein Schritt zurück setzt damit auch das zurück, was in der
       Zwischenzeit vom anderen hereingekommen ist – wenn niemand
       aufpasst. Bei der Handschrift hält behalteFremdeStriche dagegen;
       für den Text muss es der Weg über Yjs tun.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Rückgängig, während der andere schreibt');

    pruefe('Ausgangstext steht bei beiden',
      await setzeBeide('<p>Meins</p><p>Deins</p>'), '');

    await markeAuf(A, 5);      // hinter "Meins"
    await warte(300);
    await tippe(dbgA, 'XX');   // As eigener Schritt, den er gleich zurücknimmt
    await warte(900);

    await markeAuf(B, 13);     // hinter "Deins"
    await warte(300);
    await tippe(dbgB, 'BB');   // Bs Arbeit – die muss bleiben
    await warte(1200);

    const vorUndo = await flach(A);
    notiz('vor dem Rückgängig: ' + JSON.stringify(vorUndo));

    await A(`undoPage(); true`);
    await warte(1800);

    const uA = await flach(A), uB = await flach(B);
    notiz('A: ' + JSON.stringify(uA));
    notiz('B: ' + JSON.stringify(uB));

    pruefe('Bs Arbeit hat das Rückgängig von A überlebt', /DeinsBB/.test(uA),
      'A hat mit Strg+Z auch weggenommen, was B geschrieben hat: ' + JSON.stringify(uA));
    pruefe('Und beide sehen dasselbe', uA === uB, JSON.stringify({ A: uA, B: uB }));

    /* ── Fehler in der Konsole ────────────────────────────────────── */
    abschnitt('Die Konsole');
    const egal = /net::ERR_|Failed to load|Firebase|firestore|SHARE_OFFLINE|Kein Live-Betrieb|Realtime Database|InkwellsShare/i;
    const echtA = fehlerA.filter(f => !egal.test(f));
    const echtB = fehlerB.filter(f => !egal.test(f));
    pruefe('Bei A bleibt sie still', echtA.length === 0, echtA.slice(0, 3).join(' | ').slice(0, 300));
    pruefe('Bei B bleibt sie still', echtB.length === 0, echtB.slice(0, 3).join(' | ').slice(0, 300));

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH: ' + (err && err.stack || err));
    fertig(2);
  }
});
