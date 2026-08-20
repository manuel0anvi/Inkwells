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

function schickePraesenz() {
  const liste = Array.from(karten.values());
  for (const w of fenster) if (!w.isDestroyed()) w.webContents.send('praesenz', liste);
}

ipcMain.on('praesenz', (e, karte) => {
  karten.set(karte.uid, karte);
  schickePraesenz();
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
      if (Number(stufe) >= 3 || /DIAG/.test(String(text))) ziel.push(String(text));
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
    /* ══════════════════════════════════════════════════════════════
       GESPERRT IST GENAU EINE ZEILE

       Hier stand „zwei Zeilen: die eigene und die nächste". Das war die
       Absicht, solange gedacht war, dass ein Anschlag am Zeilenende in
       die Zeile darunter läuft. In der Anwendung war es eine Zeile zu
       viel: das Band sperrt auch (trifftSperrband), und auf einer Seite
       mit wenig Text war damit alles zu, sobald einer eine Taste
       anfasste. Gemeldet als „der andere kann nicht mal die Marke
       setzen" (src/ui/collab.js, lockSpanFor). */
    pruefe('Gesperrt ist genau die eigene Zeile',
      baender.length === 1, baender.length + ' Band/Bänder');

    if (baender.length) {
      const z0 = await B(`pruefstand.zeileVon(${baender[0].top})`);
      pruefe('Das Band liegt auf Zeile 2 – gemessen ' + z0,
        Math.abs(z0 - 2) < 0.01, 'es liegt ' + (z0 - 2) + ' Zeilen daneben');
    }

    /* Und die Zeile DARUNTER ist frei – genau das war vorher nicht so.
       Der Takt, der die Marke herausschiebt, laeuft alle 600 ms; deshalb
       hier warten und danach nachsehen, wo sie wirklich steht. */
    await B('pruefstand.markeAuf(18)');
    await warte(900);
    const untenGelandet = await B('pruefstand.eigeneStelle()');
    notiz('in Zeile 4 auf 18 gesetzt, gelandet auf ' + untenGelandet);
    pruefe('In der Zeile darunter bleibt die Marke stehen',
      untenGelandet === 18, 'sie wurde herausgeschoben (' + untenGelandet + ')');

    /* ══════════════════════════════════════════════════════════════════
       2b. WER EINE FORM ANFASST, HAT SIE

       Die Zeilensperre schuetzt den Text. Bei Bildern, Formen und
       Formeln gibt es nichts zusammenzufuehren: ihre Lage sind zwei
       Zahlen im Kopf der Seite, und die werden schlicht ueberschrieben.
       Schieben zwei dasselbe Rechteck, zappelt es zwischen zwei Stellen
       hin und her. Genau so wurde es gemeldet.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Wer eine Form anfasst, hat sie');

    const freiVorher = await B('pruefstand.formGehoert("o1")');
    pruefe('Vorher gehoert sie niemandem', freiVorher === null,
      'sie gilt als gehalten von ' + freiVorher);

    await A('pruefstand.formAnfassen("o1")');
    await warte(300);
    const formBeiB = await B('pruefstand.formGehoert("o1")');
    notiz('B sieht: ' + JSON.stringify(formBeiB));
    pruefe('Faellt A sie an, ist sie fuer B gesperrt', formBeiB === 'A',
      'B sieht ' + JSON.stringify(formBeiB));

    const andere = await B('pruefstand.formGehoert("o2")');
    pruefe('Eine ANDERE Form bleibt frei', andere === null,
      'auch o2 gilt als gehalten (' + andere + ')');

    /* Und A selbst darf weiter – die eigene Sperre gilt nicht gegen
       einen selbst. others enthaelt nur die anderen. */
    const beiAselbst = await A('pruefstand.formGehoert("o1")');
    pruefe('A selbst wird nicht ausgesperrt', beiAselbst === null,
      'A sieht die eigene Sperre als fremd (' + beiAselbst + ')');

    await A('pruefstand.formLoslassen()');
    await warte(300);
    const wiederFrei = await B('pruefstand.formGehoert("o1")');
    pruefe('Laesst A los, ist sie wieder frei', wiederFrei === null,
      'sie gilt weiter als gehalten von ' + wiederFrei);

    /* ══════════════════════════════════════════════════════════════════
       2a. IN EINER GESPERRTEN ZEILE STEHT KEINE MARKE

       Abgewiesen wurde bisher erst der Anschlag ('beforeinput'). Die
       Marke durfte trotzdem dort stehen – es sah aus, als könnte man
       schreiben, und an 'beforeinput' vorbei (Rechtschreibhilfe,
       Einfügen über das System) ging es manchmal doch. Gemeldet als
       „manchmal buggt es und man kann trotzdem schreiben".
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('In einer gesperrten Zeile steht keine Marke');

    // Mitten in die gesperrte Zeile 2 zielen – dort tippt A gerade
    await B('pruefstand.markeAuf(12)');
    await warte(250);
    const gelandet = await B('pruefstand.eigeneStelle()');
    notiz('gesetzt auf 12, gelandet auf ' + gelandet);
    pruefe('Die Marke wird aus der gesperrten Zeile herausgeschoben',
      gelandet !== 12 && (gelandet === null || gelandet < 12),
      'sie steht mitten in der Zeile, an der der andere schreibt');

    /* Markieren muss erlaubt bleiben: eine Auswahl ändert nichts und ist
       zum Lesen und Kopieren da. */
    const markiert = await B(`(() => {
      const td = document.querySelector('.j-text');
      td.focus();
      const a = flatRangeAt(td, 11), b = flatRangeAt(td, 14);
      const r = document.createRange();
      r.setStart(a.startContainer, a.startOffset);
      r.setEnd(b.startContainer, b.startOffset);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      return true; })()`);
    await warte(250);
    const nochMarkiert = await B(`(() => { const s = getSelection();
      return !!(s.rangeCount && !s.isCollapsed); })()`);
    pruefe('Markieren bleibt trotzdem möglich', markiert && nochMarkiert === true,
      'die Auswahl wurde mit aufgehoben');

    /* ══════════════════════════════════════════════════════════════════
       2c. UND DER ANSCHLAG SELBST WIRD ABGEWIESEN

       Bis hierher war nur geprüft, dass die MARKE aus der Sperre
       herausgeht. Gemeldet wurde aber, man könne trotzdem schreiben –
       also gehört die Auskunft geprüft, auf die sich app.js in
       'beforeinput' verlässt (lockedHere → Collab.editBlockedBy). Der
       Editor selbst läuft in diesem Prüfstand nicht mit; diese eine
       Frage ist es, an der alles hängt.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Ein Anschlag in der gesperrten Zeile wird abgewiesen');

    // A tippt noch einmal, damit die Sperre frisch ist
    await A(`pruefstand.markeAuf(11)`);
    await A(`pruefstand.setzeText(${JSON.stringify('<p>Eins</p><p>Zwei</p><p>DXrei</p><p>Vier</p>')}, 12)`);
    await warte(700);

    const drin = await B('pruefstand.anschlagAn(12)');
    pruefe('Mitten in der gesperrten Zeile geht nichts (' + drin + ')', drin === 'A',
      'dort lässt sich schreiben, obwohl das Band darüberliegt');

    const rueck = await B(`pruefstand.anschlagAn(12, 'deleteContentBackward')`);
    pruefe('Auch Löschen nicht (' + rueck + ')', rueck === 'A',
      'die Zeile lässt sich von innen abräumen');

    const frei = await B('pruefstand.anschlagAn(2)');
    pruefe('Zwei Zeilen darüber schon (' + frei + ')', frei === null,
      'die Sperre greift zu weit');

    /* ══════════════════════════════════════════════════════════════════
       2b. WIE SCHNELL FOLGT DIE MARKE EINER REINEN BEWEGUNG?

       Beim Tippen gilt die Stelle aus der Textänderung – sie gehört zum
       selben Text. Wer den Cursor nur BEWEGT, tippt aber nicht, und lag
       dadurch bis zu 900 ms (OP_CARET_TTL_MS) hinter dem, was er tut:
       die Marke stand sichtbar zurück. Gemeldet als „der Cursor ist zu
       weit zurück".
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Eine reine Cursorbewegung kommt zügig an');

    /* Erst tippen, damit die Stelle aus der Textänderung frisch ist und
       ihren Vorrang wirklich ausübt – sonst prüft man ins Leere. */
    await A(`pruefstand.setzeText(${JSON.stringify('<p>Eins</p><p>Zwei</p><p>DXreiZ</p><p>Vier</p>')}, 13)`);
    await warte(150);
    const vorSprung = await B('pruefstand.fremdeMarken()');

    // Ans Ende von Zeile 3 („Vier"), ohne einen einzigen Anschlag
    const zielStelle = await A('pruefstand.text().length');
    const t1 = Date.now();
    await A(`pruefstand.markeAuf(${zielStelle})`);
    let gefolgt = null;
    while (Date.now() - t1 < 1500) {
      const m = await B('pruefstand.fremdeMarken()');
      if (m.length && (!vorSprung.length || m[0].top !== vorSprung[0].top)) {
        gefolgt = Date.now() - t1; break;
      }
      await warte(40);
    }
    pruefe('Die Marke folgt einer Bewegung nach '
      + (gefolgt === null ? 'GAR NICHT' : gefolgt + ' ms'),
      gefolgt !== null && gefolgt < 500,
      'sie hängt an der letzten Textänderung fest');

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

    /* Und das Abzeichen am Seitenrand ebenso. Es wurde bei JEDER
       Anwesenheitsmeldung weggeworfen und neu gesetzt – alle 150 ms fing
       damit seine Einblend-Bewegung von vorn an. Gemeldet als „das
       Symbol pulsiert die ganze Zeit". */
    const abz = await B('pruefstand.merkeAbzeichen()');
    notiz('Abzeichen am Seitenrand: ' + abz);
    for (let i = 0; i < 5; i++) {
      await A(`pruefstand.markeAuf(${14 + i})`);
      await warte(180);
    }
    pruefe('Das Abzeichen am Seitenrand steht still',
      abz > 0 && (await B('pruefstand.abzeichenUnveraendert()')) === true,
      'es wird bei jeder Meldung neu gebaut und pulsiert deshalb');

    /* ══════════════════════════════════════════════════════════════════
       4. BLEIBT DIE EIGENE MARKE, WO SIE WAR?

       B steht am Ende des Textes, A tippt WEITER OBEN. Die eigene Marke
       von B muss dort bleiben, wo sie steht – sie darf nicht dorthin
       rutschen, wo der fremde Text erscheint.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Die eigene Marke bleibt, wo sie war');

    /* Sechs Zeilen, nicht drei: A schreibt oben, B steht unten. Mit drei
       Zeilen deckte A's Sperre (eigene Zeile + die nächste) die Stelle von
       B mit ab, und die Marke wurde – richtigerweise – herausgeschoben.
       Geprüft werden soll hier aber das Nachführen bei fremdem Text. */
    const basis = '<p>Alpha</p><p>Beta</p><p>Gamma</p>'
      + '<p>Delta</p><p>Epsilon</p><p>Zeta</p>';
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
    await A(`pruefstand.setzeText(${JSON.stringify('<p>Alpha ZUSATZ</p><p>Beta</p><p>Gamma</p>'
      + '<p>Delta</p><p>Epsilon</p><p>Zeta</p>')}, 11)`);
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
    await B(`pruefstand.markeAuf(${bTextNeu.indexOf('Epsilon') + 3})`);
    const vor2 = await B('pruefstand.eigeneStelle()');
    const umgebung = await B(`pruefstand.text().slice(${vor2 - 3}, ${vor2})`);
    await A(`pruefstand.setzeText(${JSON.stringify('<p>Alpha ZUSATZ NOCHMAL</p><p>Beta</p><p>Gamma</p>'
      + '<p>Delta</p><p>Epsilon</p><p>Zeta</p>')}, 19)`);
    await warte(900);
    const nach2 = await B('pruefstand.eigeneStelle()');
    const umgebung2 = await B(`pruefstand.text().slice(${nach2 - 3}, ${nach2})`);
    pruefe('Auch mitten im Text steht sie hinter denselben Zeichen ('
      + JSON.stringify(umgebung) + ' → ' + JSON.stringify(umgebung2) + ')',
      umgebung === umgebung2, 'sie ist woandershin gewandert');

    /* ══════════════════════════════════════════════════════════════════
       EINE TABELLE KOMMT ALS TABELLE AN

       Der gefährlichste Weg für eine Tabelle ist der Abgleich: der Text
       geht als Zeichenkette durch Yjs und wird beim Empfänger durch
       core/sanitize.js geschickt. Stünden die Tabellen-Tags dort nicht
       auf der Liste, käme drüben eine Reihe loser Wörter an – und
       zurückverwandeln kann das niemand.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Eine Tabelle kommt als Tabelle an');

    await A('pruefstand.setzeTabelle(3, 4)');
    await warte(900);

    const drueben = await B('pruefstand.tabelle()');
    notiz('bei B: ' + JSON.stringify(drueben));
    pruefe('Das Gerüst steht auch drüben (3 Zeilen, 4 Spalten)',
      !!drueben && drueben.zeilen === 3 && drueben.spalten === 4,
      'die Tabelle ist unterwegs zerfallen');
    pruefe('Mit ihrer Klasse und der Kopfzeile',
      !!drueben && /j-table/.test(drueben.klasse) && drueben.kopfzellen === 4,
      JSON.stringify(drueben));

    /* Und die Rechnung der Schreibmarken muss weiterhin aufgehen: eine
       Tabellenzeile ist EINE Zeile im flachen Maß (canvas/text.js zählt
       <tr> als Block und <td> als inline). Sonst zeigten alle Marken in
       einem Heft mit Tabelle daneben. */
    const flach = await B(`pruefstand.text()`);
    const zeilenImText = flach.split('\n').length;
    notiz('flacher Text: ' + JSON.stringify(flach) + ' → ' + zeilenImText + ' Zeilen');
    pruefe('Eine Tabellenzeile ist eine Zeile im flachen Maß',
      zeilenImText === 4,     // 3 Tabellenzeilen + der Absatz dahinter
      zeilenImText + ' statt 4');

    /* ══════════════════════════════════════════════════════════════════
       WER IST ALLES DA?

       Höchstens fünf Abzeichen, danach eins mit einem Plus – und ein Tipp
       darauf zeigt alle mit vollem Namen. Steht am SCHLUSS: die
       erfundenen Gäste würden jede Messung davor verfälschen.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Wer ist alles da');

    for (let i = 1; i <= 6; i++) {
      karten.set('gast' + i, {
        uid: 'gast' + i, name: 'Gast ' + i, initials: 'G' + i,
        email: 'gast' + i + '@probe.example', color: '#2e8a46',
        pageId: 'p1', offset: -1, lockFrom: -1, lockTo: -1, lockAt: 0,
        cx: '', at: Date.now()
      });
    }
    schickePraesenz();
    await warte(400);

    const leiste = await B(`(() => {
      const bar = document.getElementById('collab-people');
      const mehr = bar.querySelector('.collab-dot-more');
      return { punkte: bar.querySelectorAll('.collab-dot').length,
               plus: mehr ? mehr.textContent : '' }; })()`);
    notiz('Leiste: ' + JSON.stringify(leiste));
    pruefe('Sieben Beteiligte ergeben fünf Abzeichen und ein Plus',
      leiste.punkte === 6 && leiste.plus === '+',
      'es sind ' + leiste.punkte + ' Abzeichen');

    const karteAuf = await B(`(() => {
      const bar = document.getElementById('collab-people');
      bar.firstElementChild.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const k = document.querySelector('.collab-card');
      if (!k) return { offen: false, zeilen: 0, erster: '' };
      return { offen: k.style.display !== 'none',
               zeilen: k.querySelectorAll('.collab-card-zeile').length,
               erster: (k.querySelector('.collab-card-text strong') || {}).textContent || '' };
    })()`);
    notiz('Fenster: ' + JSON.stringify(karteAuf));
    pruefe('Ein Tipp darauf zeigt alle acht mit Namen',
      karteAuf.offen && karteAuf.zeilen === 8,
      'es stehen ' + karteAuf.zeilen + ' Namen da');
    pruefe('Man selbst steht obenan („' + karteAuf.erster + '")',
      /^B\b/.test(karteAuf.erster), 'die eigene Zeile fehlt');

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
