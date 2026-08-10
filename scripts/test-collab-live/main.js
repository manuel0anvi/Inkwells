/* ══════════════════════════════════════════════════════════════════════
   ZWEI LEUTE AN EINEM HEFT  ―  echte Fenster, echter Code

   >>> Warum das sein muss <<<
   Die Fehler an Schreibmarke, Sperrband und Wartezeit sind DURCH LESEN
   NICHT ZU FINDEN. Ein früherer Anlauf hat auf diese Weise fünf echte,
   aber jeweils falsche Ursachen gefunden; der Nutzer musste dreizehnmal
   nachfragen. Und die Korrektur von gestern hat es schlimmer gemacht:
   sie rundete die Zeile auf ein Raster, das am oberen SEITENrand anfängt,
   während der Text erst 83 px darunter beginnt – jede Marke und jedes
   Band saß danach 13 px daneben, also fast eine halbe Zeile.

   Hier laufen deshalb zwei Fenster mit dem ECHTEN ui/collab.js,
   canvas/text.js und Yjs. Nur der Raum ist ersetzt: die Nachrichten gehen
   über den Hauptprozess statt über die Realtime Database, und zwar OHNE
   Verzögerung. Was danach an Wartezeit übrig bleibt, ist die der App.

   Gemessen wird in Seitenmaßen (die Zeile des Papiers), denn nur das
   sieht der Nutzer.

   >>> Was dieser Prüfstand NICHT nachstellt <<<
   Getippt wird über pruefstand.setzeText(), nicht mit echten
   Tastenanschlägen: von zwei Fenstern kann nur eines den Tastaturfokus
   haben. Gerufen wird dabei genau das, was der Editor in app.js auch
   ruft (Collab.noteTextChange) – für Wartezeit, Marke und Band ist das
   dieselbe Kette. Was hier NICHT mitläuft, ist der Weg über
   'beforeinput', also das Abweisen einer Eingabe in einer gesperrten
   Zeile. Wer daran etwas ändert, braucht dafür einen eigenen Weg.

   Läuft NICHT in `npm test` – braucht Electron.
   Aufruf:  npm run test:live
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

const zeilen = [];
const abschnitt = (name) => { zeilen.push(''); zeilen.push(name); };
const notiz = (text) => zeilen.push('     ' + text);
const pruefe = (was, ok, hinweis) =>
  zeilen.push((ok ? 'ok   ' : 'FEHL ') + was + (ok ? '' : '  -> ' + hinweis));

function fertig(code) {
  process.stdout.write('\nZwei Leute an einem Heft\n');
  process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');
  const fehl = zeilen.filter(l => /^(FEHL|ABBRUCH)/.test(l)).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : code);
}

setTimeout(() => { zeilen.push('ABBRUCH: Zeitgrenze erreicht'); fertig(2); }, 120000);

/* ── Der Raum, gebrückt zwischen den Fenstern ──────────────────────── */
const karten = new Map();      // uid -> Anwesenheitskarte
const fenster = [];

ipcMain.on('praesenz', (e, karte) => {
  karten.set(karte.uid, karte);
  const liste = Array.from(karten.values());
  for (const w of fenster) if (!w.isDestroyed()) w.webContents.send('praesenz', liste);
});

ipcMain.on('op', (e, op) => {
  for (const w of fenster) {
    if (w.isDestroyed() || w.webContents.id === e.sender.id) continue;
    w.webContents.send('op', op);
  }
});

const warte = ms => new Promise(r => setTimeout(r, ms));

app.on('ready', async () => {
  try {
    const mach = (wer) => {
      /* >>> Die Fenster müssen SICHTBAR sein <<<
           Ein verstecktes Fenster bekommt nur etwa ein
           requestAnimationFrame je Sekunde – und genau darin sammelt
           ui/collab.js das Zeichnen der Marken (scheduleCaretsAndLocks).
           Mit show:false misst man deshalb die Drosselung von Chromium
           statt das Verhalten der App: die Prüfung auf das Flackern ging
           durch, obwohl der Fehler nachweislich dastand.
           backgroundThrottling:false allein genügt dafür nicht. */
      const w = new BrowserWindow({
        width: 700, height: 800, show: true,
        x: wer === 'A' ? 20 : 740, y: 20,
        webPreferences: {
          nodeIntegration: true, contextIsolation: false,
          backgroundThrottling: false
        }
      });
      fenster.push(w);
      return w.loadFile(path.join(__dirname, 'page.html'), { search: wer }).then(() => w);
    };

    const [wa, wb] = await Promise.all([mach('A'), mach('B')]);
    const A = (code) => wa.webContents.executeJavaScript(code);
    const B = (code) => wb.webContents.executeJavaScript(code);

    const fehlerA = [], fehlerB = [];
    wa.webContents.on('console-message', (...args) => sammle(args, fehlerA));
    wb.webContents.on('console-message', (...args) => sammle(args, fehlerB));
    function sammle(args, ziel) {
      const erst = args[0];
      const stufe = (erst && typeof erst === 'object' && 'level' in erst) ? erst.level : args[1];
      const text = (erst && typeof erst === 'object' && 'message' in erst) ? erst.message : args[2];
      if (Number(stufe) >= 3) ziel.push(String(text));
    }

    await Promise.all([A('pruefstand.beitreten()'), B('pruefstand.beitreten()')]);
    await warte(400);

    /* ══════════════════════════════════════════════════════════════════
       1. WIE LANGE DAUERT ES, BIS ETWAS ANKOMMT

       Der Takt in ui/collab.js war eine ENTPRELLUNG: jeder Anschlag
       stellte die Uhr zurück. Wer durchtippt, schickt damit gar nichts –
       beim anderen erscheint der Text erst, wenn man eine Pause macht.
       Genau das wurde als „laggy" gemeldet.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Wie lange es dauert, bis beim anderen etwas ankommt');

    const t0 = Date.now();
    // Zwei Sekunden lang durchtippen, ohne Pause – 20 Anschläge à 100 ms
    const tippen = (async () => {
      for (let i = 1; i <= 20; i++) {
        await A(`pruefstand.setzeText(${JSON.stringify('<p>' + 'x'.repeat(i) + '</p>')}, ${i + 0})`);
        await warte(100);
      }
    })();

    // Nebenher schauen, wann drüben zum ersten Mal etwas steht
    let ersteAnkunft = null;
    while (Date.now() - t0 < 2400) {
      const txt = await B('pruefstand.text()');
      if (txt && txt.length && ersteAnkunft === null) { ersteAnkunft = Date.now() - t0; break; }
      await warte(50);
    }
    await tippen;
    await warte(500);

    pruefe('Beim Durchtippen kommt das Erste nach '
      + (ersteAnkunft === null ? 'GAR NICHTS' : ersteAnkunft + ' ms') + ' an',
      ersteAnkunft !== null && ersteAnkunft < 800,
      'erst nach der Tipp-Pause – die Drossel ist eine Entprellung');

    const beiB = await B('pruefstand.text()');
    pruefe('Und am Ende steht drüben derselbe Text', beiB === 'x'.repeat(20),
      JSON.stringify(beiB));

    /* ══════════════════════════════════════════════════════════════════
       2. WO DIE FREMDE MARKE SITZT

       In Zeilen des Papiers gerechnet: A steht in Zeile 2, also muss die
       Marke bei B auf Zeile 2 liegen – nicht dazwischen.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Wo die fremde Marke und das Band sitzen');

    const text = '<p>Eins</p><p>Zwei</p><p>Drei</p><p>Vier</p>';
    await A(`pruefstand.setzeText(${JSON.stringify(text)}, 0)`);
    await warte(600);
    await B(`pruefstand.setzeText(${JSON.stringify(text)}, 0)`);
    await warte(600);

    // A stellt sich in Zeile 2 ("Drei" fängt bei Stelle 10 an) und tippt dort
    await A(`pruefstand.markeAuf(11)`);
    await A(`pruefstand.setzeText(${JSON.stringify('<p>Eins</p><p>Zwei</p><p>DXrei</p><p>Vier</p>')}, 12)`);
    await warte(900);

    const marken = await B('pruefstand.fremdeMarken()');
    notiz('gezeichnet: ' + JSON.stringify(marken));
    pruefe('Genau eine fremde Marke ist zu sehen', marken.length === 1,
      marken.length + ' Stück');

    if (marken.length === 1) {
      const zeile = await B(`pruefstand.zeileVon(${marken[0].top})`);
      pruefe('Sie sitzt auf Zeile 2 (dort tippt A) – gemessen ' + zeile,
        Math.abs(zeile - 2) < 0.01, 'sie steht ' + (zeile - 2) + ' Zeilen daneben');
      pruefe('Und ist genau eine Zeile hoch', marken[0].hoehe === 32, marken[0].hoehe + ' px');
    }

    const baender = await B('pruefstand.baender()');
    notiz('Bänder: ' + JSON.stringify(baender));
    pruefe('Gesperrt sind zwei Zeilen: die eigene und die nächste',
      baender.length >= 2, baender.length + ' Band/Bänder');

    if (baender.length >= 2) {
      const z0 = await B(`pruefstand.zeileVon(${baender[0].top})`);
      const z1 = await B(`pruefstand.zeileVon(${baender[1].top})`);
      pruefe('Das erste Band liegt auf Zeile 2 – gemessen ' + z0,
        Math.abs(z0 - 2) < 0.01, 'es liegt ' + (z0 - 2) + ' Zeilen daneben');
      pruefe('Das zweite direkt darunter auf Zeile 3 – gemessen ' + z1,
        Math.abs(z1 - 3) < 0.01, 'es liegt ' + (z1 - 3) + ' Zeilen daneben');
    }

    /* ══════════════════════════════════════════════════════════════════
       3. FLACKERT ES?

       Wird bei jedem Bild ein neues Element gebaut, gibt es keinen
       weichen Übergang – die Marke springt jedes Mal neu ins Bild. Geprüft
       wird deshalb, ob es NACH mehreren Meldungen noch DIESELBEN Elemente
       sind.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die Marke wird bewegt, nicht neu gebaut');
    const gemerkt = await B('pruefstand.merkeElemente()');
    notiz('gemerkt: ' + gemerkt.marken + ' Marke(n), ' + gemerkt.gesamt + ' Elemente');
    for (let i = 0; i < 4; i++) {
      await A(`pruefstand.markeAuf(${12 + i})`);
      await warte(180);
    }
    pruefe('Nach vier Meldungen sind es noch dieselben Elemente',
      (await B('pruefstand.nochDieselben()')) === true,
      'sie werden weggeworfen und neu gebaut – daher das Flackern');

    /* Und dasselbe unter echtem Tippen: dabei kommen Anwesenheit (alle
       150 ms) und Textänderungen durcheinander herein, und der Text wird
       drüben ausgetauscht. Verschwindet die Marke dazwischen auch nur für
       einen Augenblick, sieht man genau das Blinken. */
    await B('pruefstand.merkeElemente()');
    let verschwunden = 0, neuGebaut = 0;
    const dauerTippen = (async () => {
      for (let i = 1; i <= 12; i++) {
        const s = 'Zeile eins' + 'y'.repeat(i);
        await A(`pruefstand.setzeText(${JSON.stringify('<p>Eins</p><p>Zwei</p><p>')}+${JSON.stringify('y'.repeat(i))}+${JSON.stringify('</p><p>Vier</p>')}, ${10 + i})`);
        await warte(90);
      }
    })();
    while (true) {
      const stand = await B('({ da: pruefstand.markenElemente().length, gleich: pruefstand.nochDieselben() })');
      if (!stand.da) verschwunden++;
      else if (!stand.gleich) { neuGebaut++; await B('pruefstand.merkeElemente()'); }
      await warte(60);
      if (verschwunden > 4 || neuGebaut > 4) break;
      let fertigDamit = false;
      await Promise.race([dauerTippen.then(() => { fertigDamit = true; }), warte(1)]);
      if (fertigDamit) break;
    }
    await dauerTippen;
    notiz('während des Tippens: ' + verschwunden + ' mal weg, ' + neuGebaut + ' mal neu gebaut');
    pruefe('Während der andere tippt, bleibt die Marke stehen',
      verschwunden === 0 && neuGebaut === 0,
      'sie verschwindet oder wird neu gebaut – das ist das Flackern');

    /* ══════════════════════════════════════════════════════════════════
       4. BLEIBT DIE EIGENE MARKE, WO SIE WAR?

       B steht am Ende des Textes, A tippt WEITER OBEN. Die eigene Marke
       von B muss dort bleiben, wo sie steht – sie darf nicht dorthin
       rutschen, wo der fremde Text erscheint.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die eigene Marke bleibt, wo sie war');

    const basis = '<p>Alpha</p><p>Beta</p><p>Gamma</p>';
    await A(`pruefstand.setzeText(${JSON.stringify(basis)}, 0)`);
    await warte(700);
    await B(`pruefstand.setzeText(${JSON.stringify(basis)}, 0)`);
    await warte(700);

    // B stellt sich ans ENDE (hinter "Gamma")
    const bText = await B('pruefstand.text()');
    const endStelle = bText.length;
    await B(`pruefstand.markeAuf(${endStelle})`);
    const vorher = await B('pruefstand.eigeneStelle()');
    notiz('B steht auf Stelle ' + vorher + ' von ' + endStelle
      + ' – hinter ' + JSON.stringify(bText.slice(-6)));

    // A schiebt oben etwas ein
    await A(`pruefstand.setzeText(${JSON.stringify('<p>Alpha ZUSATZ</p><p>Beta</p><p>Gamma</p>')}, 11)`);
    await warte(900);

    const nachher = await B('pruefstand.eigeneStelle()');
    const bTextNeu = await B('pruefstand.text()');
    notiz('nach der fremden Änderung: Stelle ' + nachher + ' von ' + bTextNeu.length
      + ' – dahinter steht ' + JSON.stringify(bTextNeu.slice(nachher)));
    pruefe('B steht immer noch am Ende, nicht im fremden Text',
      nachher === bTextNeu.length,
      'die Marke ist um ' + (nachher - bTextNeu.length) + ' Zeichen verrutscht');

    /* Und derselbe Fall mit der Marke MITTEN im Text, hinter der Stelle,
       an der der andere schreibt. */
    await B(`pruefstand.markeAuf(${bTextNeu.indexOf('Gamma') + 3})`);
    const vor2 = await B('pruefstand.eigeneStelle()');
    const umgebung = await B(`pruefstand.text().slice(${vor2 - 3}, ${vor2})`);
    await A(`pruefstand.setzeText(${JSON.stringify('<p>Alpha ZUSATZ NOCHMAL</p><p>Beta</p><p>Gamma</p>')}, 19)`);
    await warte(900);
    const nach2 = await B('pruefstand.eigeneStelle()');
    const umgebung2 = await B(`pruefstand.text().slice(${nach2 - 3}, ${nach2})`);
    pruefe('Auch mitten im Text steht sie hinter denselben Zeichen ('
      + JSON.stringify(umgebung) + ' → ' + JSON.stringify(umgebung2) + ')',
      umgebung === umgebung2, 'sie ist woandershin gewandert');

    if (fehlerA.length || fehlerB.length) {
      abschnitt('Fehler aus den Fenstern');
      for (const m of fehlerA.slice(0, 5)) zeilen.push('     A: ' + m);
      for (const m of fehlerB.slice(0, 5)) zeilen.push('     B: ' + m);
    }

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH ' + ((err && err.stack) || err));
    fertig(3);
  }
});
