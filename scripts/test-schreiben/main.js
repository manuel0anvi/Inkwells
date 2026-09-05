/* ══════════════════════════════════════════════════════════════════════
   SCHREIBEN  ―  tippen, umbrechen, löschen, zurücknehmen

   >>> Warum das einen eigenen Prüfstand braucht <<<
   Es ist das, was am häufigsten geschieht und am wenigsten geprüft war.
   test:klick sieht sich an, WOHIN die Marke durch einen Klick kommt;
   test:caret misst ihre Geometrie; test:tasten prüft das Schreiben zu
   zweit. Die schlichte Schleife dazwischen – ein Zeichen an einer
   bestimmten Stelle, ein Umbruch, eine Rücktaste, ein Strg+Z – lief in
   keinem davon.

   Getippt wird über das Chrome-DevTools-Protokoll, also mit richtigen
   Tastenereignissen. Nur so laufen alle Wege mit, die daran hängen:
   'beforeinput' mit der Zeilensperre und dem Sicherungspunkt, der
   'input'-Griff mit uebernimmText, die Aufzählungen, der Seitenumbruch.
   Ein dispatchEvent oder ein direkt gesetztes textContent ginge an allen
   vorbei – und genau dort sitzen die Fehler.

   Gemessen wird im FLACHEN Text (flatTextOf): das ist dasselbe Mass, in
   dem die Schreibmarken und die Sperrbänder rechnen, und es sagt, was
   auf dem Papier steht – ohne dass die Prüfung von der HTML-Struktur
   abhängt, die der Browser gerade gewählt hat.

   Läuft NICHT in `npm test` – braucht Electron.
   Aufruf:  npm run test:schreiben
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
app.disableHardwareAcceleration();

const ABLAGE = path.join(app.getPath('temp'), 'inkwells-schreiben');
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

const zeilen = [];
const abschnitt = (name) => { zeilen.push(''); zeilen.push(name); };
const notiz = (text) => zeilen.push('     ' + text);
const pruefe = (was, ok, hinweis) =>
  zeilen.push((ok ? 'ok   ' : 'FEHL ') + was + (ok ? '' : '  -> ' + hinweis));

function fertig(code) {
  process.stdout.write('\nSchreiben: tippen, umbrechen, loeschen, zuruecknehmen\n');
  process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');
  const fehl = zeilen.filter(l => /^(FEHL|ABBRUCH)/.test(l)).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : code);
}
setTimeout(() => { zeilen.push('ABBRUCH: Zeitgrenze erreicht'); fertig(2); }, 300000);

const warte = ms => new Promise(r => setTimeout(r, ms));

app.on('ready', async () => {
  try {
    const win = new BrowserWindow({
      width: 1240, height: 940, show: true, backgroundColor: '#12121a',
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
    });
    await win.loadFile(path.join(ROOT, 'src', 'index.html'));
    await warte(2500);

    const js = (code) => win.webContents.executeJavaScript(code);
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');

    const fehlerKonsole = [];
    win.webContents.on('console-message', (...a) => {
      const e = a[0];
      const stufe = (e && typeof e === 'object' && 'level' in e) ? e.level : a[1];
      const text = (e && typeof e === 'object' && 'message' in e) ? e.message : a[2];
      if (Number(stufe) >= 3) fehlerKonsole.push(String(text));
    });

    /* ── Ein Heft mit EINER Seite ─────────────────────────────────── */
    await js(`(() => {
      const nb = { id: 'schreib', name: 'Schreiben', color: '#c8a96e', defaultBg: 'ruled',
                   sections: [], created: Date.now(), pages: [makePage('ruled')] };
      S.notebooks = [nb];
      openNotebook('schreib');
      return true;
    })()`);
    await warte(900);

    /* ── Tasten ───────────────────────────────────────────────────── */
    const taste = async (key, code, vk) => {
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
      await warte(45);
    };

    const tippe = async (text, pause = 30) => {
      for (const ch of text) {
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp' });
        await warte(pause);
      }
    };

    const enter = async () => {
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await dbg.sendCommand('Input.dispatchKeyEvent',
        { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await warte(120);
    };

    const rueck = (n = 1) => (async () => {
      for (let i = 0; i < n; i++) await taste('Backspace', 'Backspace', 8);
    })();
    const entf = (n = 1) => (async () => {
      for (let i = 0; i < n; i++) await taste('Delete', 'Delete', 46);
    })();

    /* ── Die Seite in einen bekannten Zustand bringen ──────────────── */
    const setze = (html, stelle) => js(`(() => {
      const info = getPage(S.activePgId);
      const td = document.querySelector('[data-pgid="' + info.page.id + '"] .j-text');
      td.innerHTML = ${JSON.stringify(html)};
      uebernimmText(info.page, td);
      S.history[info.page.id] = { undo: [], redo: [] };
      td.focus();
      setFlatCaret(td, ${stelle});
      document.dispatchEvent(new Event('selectionchange'));
      return flatTextOf(td);
    })()`);

    const flach = () => js(`flatTextOf(document.querySelector('.j-text'))`);
    const marke = () => js(`flatCaretPos(document.querySelector('.j-text'))`);
    const imHeft = () => js(`(() => {
      const info = getPage(S.activePgId);
      const d = document.createElement('div');
      d.innerHTML = info.page.textContent || '';
      return d.textContent.replace(/\\u00a0/g, ' ');
    })()`);

    /* Ein Lauf: Ausgangstext, Marke, Handlung – dann vergleichen. */
    async function lauf(name, html, stelle, tun, erwartet, markeSoll) {
      await setze(html, stelle);
      /* Die Tipp-Uhr aus dem Lauf davor ablaufen lassen: pushTypingHistory
         fasst alles innerhalb von 700 ms zu EINEM Schritt zusammen, und
         ohne die Pause bekaeme der erste Anschlag hier keinen eigenen
         Sicherungspunkt – Rueckgaengig haette dann nichts zu tun. */
      await warte(800);
      try { await tun(); } catch (err) {
        pruefe(name, false, 'WURF: ' + (err && err.message || err));
        return;
      }
      await warte(320);
      const ist = await flach();
      const m = await marke();
      let ok = ist === erwartet;
      let hinweis = ok ? '' : JSON.stringify(ist) + '  statt  ' + JSON.stringify(erwartet);
      if (ok && markeSoll !== undefined && m !== markeSoll) {
        ok = false;
        hinweis = 'Text stimmt, aber die Marke steht auf ' + m + ' statt ' + markeSoll;
      }
      pruefe(name, ok, hinweis);
    }

    /* ══════════════════════════════════════════════════════════════════
       1. TIPPEN AN EINER BESTIMMTEN STELLE
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('1  Tippen an einer bestimmten Stelle');

    await lauf('Am Anfang des Dokuments',
      '<p>Hallo</p>', 0, () => tippe('X'), 'XHallo', 1);

    await lauf('Mitten im Wort',
      '<p>Hallo</p>', 2, () => tippe('X'), 'HaXllo', 3);

    await lauf('Am Ende der Zeile',
      '<p>Hallo</p>', 5, () => tippe('X'), 'HalloX', 6);

    await lauf('Am Anfang der zweiten Zeile',
      '<p>Eins</p><p>Zwei</p>', 5, () => tippe('X'), 'Eins\nXZwei', 6);

    await lauf('Am Ende des Dokuments',
      '<p>Eins</p><p>Zwei</p>', 9, () => tippe('X'), 'Eins\nZweiX', 10);

    await lauf('In einer leeren Zeile dazwischen',
      '<p>Eins</p><p><br></p><p>Drei</p>', 5, () => tippe('X'), 'Eins\nX\nDrei', 6);

    await lauf('Mehrere Zeichen hintereinander',
      '<p>ab</p>', 1, () => tippe('XYZ'), 'aXYZb', 4);

    await lauf('Umlaute und Sonderzeichen',
      '<p>Gruss</p>', 5, () => tippe('e äöüß'), 'Grusse äöüß', 11);

    /* ══════════════════════════════════════════════════════════════════
       2. DER UMBRUCH
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('2  Umbruch mit Enter');

    await lauf('Mitten in der Zeile teilt sie',
      '<p>Hallo</p>', 2, () => enter(), 'Ha\nllo', 3);

    await lauf('Am Zeilenende beginnt eine neue',
      '<p>Hallo</p>', 5, () => enter(), 'Hallo\n', 6);

    await lauf('Am Zeilenanfang schiebt die Zeile hinunter',
      '<p>Hallo</p>', 0, () => enter(), '\nHallo', 1);

    await lauf('Zweimal Enter gibt eine Leerzeile',
      '<p>ab</p>', 1, async () => { await enter(); await enter(); }, 'a\n\nb', 3);

    await lauf('Enter zwischen zwei Zeilen',
      '<p>Eins</p><p>Zwei</p>', 4, () => enter(), 'Eins\n\nZwei', 5);

    await lauf('Und danach laesst sich dort schreiben',
      '<p>Hallo</p>', 2, async () => { await enter(); await tippe('X'); }, 'Ha\nXllo', 4);

    /* ══════════════════════════════════════════════════════════════════
       3. LÖSCHEN
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('3  Loeschen mit Ruecktaste und Entf');

    await lauf('Ruecktaste mitten im Wort',
      '<p>Hallo</p>', 3, () => rueck(), 'Hallo'.replace('l', ''), 2);

    await lauf('Ruecktaste am Zeilenanfang holt die Zeile herauf',
      '<p>Eins</p><p>Zwei</p>', 5, () => rueck(), 'EinsZwei', 4);

    await lauf('Ruecktaste am Dokumentanfang tut nichts',
      '<p>Hallo</p>', 0, () => rueck(), 'Hallo', 0);

    await lauf('Entf mitten im Wort',
      '<p>Hallo</p>', 2, () => entf(), 'Halo', 2);

    await lauf('Entf am Zeilenende zieht die naechste herauf',
      '<p>Eins</p><p>Zwei</p>', 4, () => entf(), 'EinsZwei', 4);

    await lauf('Entf am Dokumentende tut nichts',
      '<p>Hallo</p>', 5, () => entf(), 'Hallo', 5);

    await lauf('Mehrere Ruecktasten hintereinander',
      '<p>Hallo</p>', 5, () => rueck(3), 'Ha', 2);

    await lauf('Eine ganze Zeile wegloeschen',
      '<p>Eins</p><p>Zwei</p>', 9, () => rueck(4), 'Eins\n', 5);

    /* ══════════════════════════════════════════════════════════════════
       4. TIPPEN UND LÖSCHEN IM WECHSEL

       Der Alltag: man schreibt, verbessert sich, schreibt weiter.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('4  Tippen und loeschen im Wechsel');

    await lauf('Schreiben, verbessern, weiterschreiben',
      '', 0,
      async () => { await tippe('Hallo'); await rueck(2); await tippe('lo Welt'); },
      'Hallo Welt', 10);

    await lauf('Ueber einen Umbruch hinweg verbessern',
      '<p>ab</p>', 2,
      async () => { await enter(); await tippe('cd'); await rueck(3); await tippe('X'); },
      'abX', 3);

    await lauf('Am Ende einer langen Folge',
      '', 0,
      async () => { await tippe('abcdefghij', 12); await rueck(4); await tippe('XY'); },
      'abcdefXY', 8);

    /* ══════════════════════════════════════════════════════════════════
       5. RÜCKGÄNGIG UND WIEDERHOLEN
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('5  Rueckgaengig und Wiederholen');

    await lauf('Getipptes zuruecknehmen',
      '<p>Hallo</p>', 5,
      async () => { await tippe('XYZ'); await warte(800); await js('undoPage()'); },
      'Hallo');

    await lauf('Einen Umbruch zuruecknehmen',
      '<p>Hallo</p>', 2,
      async () => { await enter(); await warte(800); await js('undoPage()'); },
      'Hallo');

    await lauf('Geloeschtes zuruecknehmen',
      '<p>Hallo</p>', 5,
      async () => { await rueck(2); await warte(800); await js('undoPage()'); },
      'Hallo');

    /* Tab geht denselben Weg wie Enter: preventDefault und danach
       selbst schreiben. Auch dafuer muss ein Sicherungspunkt entstehen. */
    await lauf('Einen Tabulator zuruecknehmen',
      '<p>ab</p>', 1,
      async () => {
        await taste('Tab', 'Tab', 9);
        await warte(800);
        await js('undoPage()');
      },
      'ab');

    await lauf('Und wieder vorwaerts',
      '<p>Hallo</p>', 5,
      async () => {
        await tippe('XY'); await warte(800);
        await js('undoPage()'); await warte(250);
        await js('redoPage()');
      },
      'HalloXY');

    /* ══════════════════════════════════════════════════════════════════
       5b. MEHRMALS HINTEREINANDER ZURUECK

       Ein einzelnes Strg+Z zu koennen genuegt nicht – man drueckt es
       mehrmals. Jeder Schritt muss dabei einen eigenen Stand haben.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('5b Mehrmals hintereinander zurueck');

    await setze('<p>Start</p>', 5);
    await warte(800);
    await tippe('AAA'); await warte(900);
    await tippe('BBB'); await warte(900);
    await tippe('CCC'); await warte(900);
    {
      const voll = await flach();
      pruefe('Drei Bloecke getippt', voll === 'StartAAABBBCCC', JSON.stringify(voll));

      await js('undoPage()'); await warte(300);
      const eins = await flach();
      pruefe('Ein Schritt zurueck nimmt nur den letzten Block',
        eins === 'StartAAABBB', JSON.stringify(eins));

      await js('undoPage()'); await warte(300);
      const zwei = await flach();
      pruefe('Und noch einer den davor', zwei === 'StartAAA', JSON.stringify(zwei));

      await js('undoPage()'); await warte(300);
      const drei = await flach();
      pruefe('Und der dritte bis zum Anfang', drei === 'Start', JSON.stringify(drei));

      await js('redoPage()'); await warte(300);
      await js('redoPage()'); await warte(300);
      const zurueck = await flach();
      pruefe('Zweimal vorwaerts kommt wieder hin',
        zurueck === 'StartAAABBB', JSON.stringify(zurueck));
    }

    /* ══════════════════════════════════════════════════════════════════
       5c. AN MEHREREN STELLEN SCHREIBEN

       Der Alltag: ein Wort oben, eines unten, dann wieder oben. Die
       Marke muss dabei jedes Mal dort landen, wo sie hingesetzt wurde.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('5c An mehreren Stellen nacheinander schreiben');

    await setze('<p>Eins</p><p>Zwei</p><p>Drei</p>', 0);
    await warte(800);

    const stelleUndTippe = async (stelle, text) => {
      await js(`(() => { const td = document.querySelector('.j-text');
        td.focus(); setFlatCaret(td, ${stelle});
        document.dispatchEvent(new Event('selectionchange')); return true; })()`);
      await warte(200);
      await tippe(text);
      await warte(300);
    };

    await stelleUndTippe(4, 'X');        // hinter "Eins"
    await stelleUndTippe(15, 'Z');       // hinter "Drei" (EinsX\nZwei\nDrei)
    await stelleUndTippe(0, 'A');        // ganz vorn
    {
      const ist = await flach();
      pruefe('Drei Stellen, drei Zeichen – jedes an seinem Platz',
        ist === 'AEinsX\nZwei\nDreiZ', JSON.stringify(ist));
    }

    /* ══════════════════════════════════════════════════════════════════
       6. WAS IM HEFT ANKOMMT

       Auf dem Blatt zu stehen genuegt nicht – es muss auch im
       Datenmodell stehen, sonst ist es beim Zumachen weg.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('6  Was auf dem Blatt steht, steht auch im Heft');

    await setze('<p>Anfang</p>', 6);
    await warte(150);
    await tippe(' und Ende');
    await warte(500);
    {
      const auf = await flach();
      const drin = await imHeft();
      pruefe('Getipptes steht im Heft',
        drin.includes('Anfang und Ende'),
        'auf dem Blatt: ' + JSON.stringify(auf) + ' — im Heft: ' + JSON.stringify(drin));
    }

    await enter();
    await tippe('Zweite');
    await warte(500);
    {
      const drin = await imHeft();
      pruefe('Auch die zweite Zeile',
        drin.includes('Zweite'), JSON.stringify(drin));
    }

    await rueck(3);
    await warte(500);
    {
      const drin = await imHeft();
      pruefe('Und das Loeschen ebenso',
        drin.includes('Zwe') && !drin.includes('Zweite'), JSON.stringify(drin));
    }

    /* ══════════════════════════════════════════════════════════════════
       7. SCHNELL TIPPEN

       Ohne Pause zwischen den Anschlaegen. Hier faellt auf, was an
       Zeitgebern haengt: Einfaerben, Umbrechen, Zusammenfassen.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('7  Schnell tippen');

    await setze('', 0);
    await warte(150);
    const schnell = 'Der schnelle braune Fuchs springt ueber den faulen Hund';
    await tippe(schnell, 0);
    await warte(700);
    {
      const ist = await flach();
      pruefe('Kein Zeichen geht verloren (' + ist.length + ' von ' + schnell.length + ')',
        ist === schnell, JSON.stringify(ist));
    }

    /* ══════════════════════════════════════════════════════════════════
       8. DIE KONSOLE
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('8  Die Konsole');
    const egal = /net::ERR_|Failed to load|Firebase|firestore|SHARE_OFFLINE|Kein Live-Betrieb|Realtime Database|InkwellsShare|No save location/i;
    const echt = fehlerKonsole.filter(f => !egal.test(f));
    pruefe('Beim Schreiben faellt kein Fehler', echt.length === 0,
      echt.slice(0, 3).join(' | ').slice(0, 300));

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH: ' + (err && err.stack || err));
    fertig(2);
  }
});
