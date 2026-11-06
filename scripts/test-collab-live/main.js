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
require('../stabile-fenster.js');
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
       GESPERRT IST DIE ZEILE – UND DIE DARÜBER UND DARUNTER

       Hier stand erst „die eigene und die naechste", dann „genau eine".
       Beides war zu wenig, und der Grund steht in der Meldung, die zu
       dieser Fassung gefuehrt hat: wer am Ende seiner Zeile
       weiterschreibt oder Enter drueckt, schiebt den Text darunter nach
       unten und landet selbst in der naechsten Zeile – beides trifft
       den anderen, ohne dass je in seine Zeile getippt worden waere.

       Der Schutzstreifen von einer Zeile nach oben und unten faengt das
       ab, BEVOR etwas verrutscht. Dass damit nicht gleich die halbe
       Seite zu ist, sorgt der Anspruch selbst: der bleibt eine Zeile,
       und nur darueber wird der Streit zweier Ansprueche entschieden
       (src/ui/collab.js, sperrBereich). */
    pruefe('Gesperrt ist die Zeile samt Nachbarzeilen',
      baender.length === 3, baender.length + ' Band/Bänder statt 3');

    if (baender.length) {
      const z0 = await B(`pruefstand.zeileVon(${baender[0].top})`);
      pruefe('Das Band beginnt eine Zeile darueber (Zeile 1) – gemessen ' + z0,
        Math.abs(z0 - 1) < 0.01, 'es liegt ' + (z0 - 1) + ' Zeilen daneben');
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
    /* ══════════════════════════════════════════════════════════════════
       IN EINER GESPERRTEN ZEILE DARF MAN STEHEN, ABER NICHT SCHREIBEN

       Hier stand „Die Marke wird aus der gesperrten Zeile
       herausgeschoben": haltCaretAusSperre rief markeWeg, also Auswahl
       weg UND Fokus weg. Den Fokus gab danach niemand zurueck – das Feld
       blieb tot, bis der Nutzer von sich aus wieder hineinklickte. Beim
       gleichzeitigen Tippen traf das auch den, der gar nichts falsch
       gemacht hatte (scripts/test-collab-tasten weist das nach: von zehn
       Anschlaegen kam einer an).

       Die Marke bleibt jetzt, wo hingezeigt wurde. Sie schreibt ja
       nichts – das tut die Eingabe, und die wird gleich darunter
       abgewiesen. Genau diese Wache ist die, auf die es ankommt.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('In einer gesperrten Zeile steht die Marke, schreiben geht nicht');

    // Mitten in die gesperrte Zeile 2 zielen – dort tippt A gerade
    await B('pruefstand.markeAuf(12)');
    await warte(900);          // laenger als der 600-ms-Takt
    const gelandet = await B('pruefstand.eigeneStelle()');
    notiz('gesetzt auf 12, gelandet auf ' + gelandet);
    pruefe('Die Marke bleibt stehen, wo hingezeigt wurde',
      gelandet === 12,
      'sie wurde weggenommen (' + gelandet + ') – dann ist das Feld fuer B tot');

    const fokusB = await B(`document.activeElement === document.querySelector('.j-text')`);
    pruefe('Und das Feld behaelt den Fokus', fokusB === true,
      'ohne Fokus geht jeder weitere Anschlag ins Leere, ohne Hinweis');

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
       2d. WER ZUERST DA WAR UND SCHREIBT, BEHÄLT SEINE ZEILE

       Gemeldet: „ich habe auf einer Zeile geschrieben, jemand anders hat
       dort seinen Cursor hingelegt, und ICH konnte nicht mehr schreiben.
       Gut, dass gesperrt wird – aber es sollte den anderen aussperren,
       ich war ja als Erster auf dieser Zeile."

       Drei Dinge kamen dafür zusammen (ui/collab.js):

         · schreibtGerade galt für die ganze SEITE und fünf Sekunden
           lang. Wer eben irgendwo getippt hatte und dann in eine fremde
           Zeile klickte, meldete dort sofort eine volle Sperre.
         · Der Zuschnitt (ohneFremdeStellen) wich bis auf EIN Zeichen an
           die fremde Marke heran. Die ist beim Tippen aber nie taufrisch,
           also stand der Schreibende beim nächsten Anschlag mitten im
           Anspruch dessen, der nur dasass.
         · Und eigeneSperreDeckt hob die eigene Vollmacht auf, sobald ein
           fremder Cursor irgendwo auf derselben Zeile stand – also genau
           in dem Fall, für den sie da ist.

       Geprüft wird der gemeldete Ablauf, in dieser Reihenfolge: B tippt
       zuerst, A legt danach nur seinen Cursor daneben.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Wer zuerst da war und schreibt, behaelt seine Zeile');

    /* A tippt in Zeile 0 – A ist also auf dieser SEITE gerade taetig.
       Genau das liess A gleich darauf jede Zeile beanspruchen, in die er
       nur hineinklickte. */
    await A('pruefstand.markeAuf(2)');
    await A(`pruefstand.setzeText(${JSON.stringify('<p>EAins</p><p>Zwei</p><p>Drei</p><p>Vier</p>')}, 3)`);
    await warte(700);

    // B schreibt in Zeile 2 – und ist damit als Erster dort
    await B('pruefstand.markeAuf(12)');
    await B(`pruefstand.setzeText(${JSON.stringify('<p>EAins</p><p>Zwei</p><p>DBrei</p><p>Vier</p>')}, 13)`);
    await warte(700);

    // Und jetzt legt A bloss seinen Cursor auf B's Zeile – ohne zu tippen
    await A('pruefstand.markeAuf(14)');
    await warte(700);

    const aSperrtB = await B('pruefstand.anschlagAn(13)');
    pruefe('B schreibt weiter, obwohl A den Cursor daneben legt (' + aSperrtB + ')',
      aSperrtB === null, 'B wird von A ausgesperrt, obwohl B zuerst dort war');

    const bSperrtA = await A('pruefstand.anschlagAn(14)');
    pruefe('A dagegen wird abgewiesen (' + bSperrtA + ')', bSperrtA === 'B',
      'A kann in B\'s Zeile schreiben, obwohl B dort arbeitet');

    /* Und B behält die Zeile auch, wenn er weitertippt – die fremde
       Stelle darf nicht mit jedem Anschlag näher heranrücken. */
    await B('pruefstand.markeAuf(13)');
    await B(`pruefstand.setzeText(${JSON.stringify('<p>EAins</p><p>Zwei</p><p>DBBrei</p><p>Vier</p>')}, 14)`);
    await warte(500);
    const nochFrei = await B('pruefstand.anschlagAn(14)');
    pruefe('Auch nach dem naechsten Anschlag (' + nochFrei + ')', nochFrei === null,
      'B laeuft in den Anspruch dessen hinein, der nur dasitzt');

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

    /* >>> Warum hier erst getippt wird <<<
       Ein Anspruch entsteht durch SCHREIBEN und endet, sobald man die
       Zeile verlässt (ui/collab.js, tippteHier). Der Abschnitt davor
       schickt A ans Textende – dort hat A zu Recht keine Sperre mehr,
       und das Band ist weg. Zählte man von da an, waere das Auftauchen
       des Bandes bei der Rueckkehr ein „neu gebautes Element", ohne dass
       irgendetwas flackert: die Sperre ist wirklich erst weg und dann
       wieder da.

       Gemessen werden soll aber, ob sich bei UNVERAENDERTEM Zustand
       etwas neu aufbaut. Also erst wieder in Zeile 2 tippen, und dann
       nur noch INNERHALB dieser Zeile wandern. */
    await A(`pruefstand.setzeText(${JSON.stringify('<p>Eins</p><p>Zwei</p><p>DXreiZ</p><p>Vier</p>')}, 12)`);
    await warte(400);

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
    /* ══════════════════════════════════════════════════════════════════
       DER ANKER FINDET DIE STELLE WIEDER

       Gemeldet: „einer schreibt, der andere faengt eine Zeile weiter oben
       an, drueckt Enter – und dann schreiben beide auf derselben Zeile."

       Der Weg dorthin: eine fremde Stelle wird in ZEICHEN gemeldet, und
       der Empfaenger sucht sie in SEINEM Text ueber einen Anker wieder –
       zwoelf Zeichen vor und zwoelf nach der Marke. Ein Umbruch eine
       Zeile hoeher faellt mitten in dieses Fenster. Der Anker war damit
       als Ganzes nirgends mehr zu finden, und der Rueckfall lautete
       „Stelle unveraendert lassen". Das ist nach einem eingefuegten
       Umbruch genau eine Stelle zu frueh – also die Zeile darueber, die
       des anderen.

       Geprueft wird die Rechnung selbst, nicht das Bild: Pixel sind hier
       truegerisch, weil ein Sperrband eine ganze Zeile hoch ist und eine
       Textzeile nicht.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Der Anker findet die Stelle wieder');

    {
      const faelle = [
        {
          was: 'Umbruch eine Zeile darueber',
          alt: 'Eins\nZwei\nDrei\nVXier\nFuenf',
          neu: 'Eins\nZwei\nDrei\n\nVXier\nFuenf',
          pos: 17, soll: 18
        },
        {
          /* Beide Haelften unbrauchbar: davor steht das eingefuegte
             Wort, das Stueck dahinter ist zu kurz fuer einen Halt.
             Dann gibt es KEINE Antwort - und das ist richtig: eine
             erfundene Stelle waere schlimmer als gar keine. Der
             Aufrufer behaelt dann die gemeldete (findeStelle). */
          was: 'Beide Haelften unbrauchbar: lieber keine Antwort',
          alt: 'Alpha\nBeta\nGamma',
          neu: 'Alpha ZUSATZ\nBeta\nGamma',
          pos: 12, soll: null
        },
        {
          was: 'Aenderung dahinter laesst die Stelle stehen',
          alt: 'Alpha\nBeta\nGamma',
          neu: 'Alpha\nBeta\nGamma NOCHWAS',
          pos: 3, soll: 3
        },
        {
          was: 'Nichts geaendert',
          alt: 'Alpha\nBeta\nGamma',
          neu: 'Alpha\nBeta\nGamma',
          pos: 8, soll: 8
        }
      ];

      for (const f of faelle) {
        const ergebnis = await B(`(() => {
          const CTX = 12;
          const anker = ${JSON.stringify(f.alt)}.slice(Math.max(0, ${f.pos} - CTX), ${f.pos} + CTX);
          return Collab._stelleAusAnker(${JSON.stringify(f.neu)}, ${f.pos}, anker);
        })()`);
        pruefe(f.was + ' → ' + ergebnis,
          ergebnis === f.soll, 'erwartet ' + f.soll + ', bekommen ' + ergebnis);
      }
    }

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

    /* ══════════════════════════════════════════════════════════════════
       AM ZEILENENDE STEHT DIE MARKE NOCH IN DIESER ZEILE

       Gemeldet: „wenn ich den Cursor irgendwohin setze, kommt das Zeichen
       von seinem Cursor dorthin – sein Cursor sollte aber dort bleiben,
       wo er schreibt."

       >>> Was wirklich geschah <<<
       Die Marke folgte dem Klick nicht. Sie stand nur systematisch EINE
       ZEILE ZU TIEF, jeweils ganz links – und wer dorthin klickte, fand
       sie genau bei sich.

       Schuld war die Umrechnung zwischen flachem Text und Quelltext
       (flatHtmlMap). Eine Zeilengrenze hat im Quelltext kein eigenes
       Zeichen, dort steht ein Tag; sie fiel deshalb auf den Anfang des
       naechsten Zeichens. „Ende von Absatz 1" und „Anfang von Absatz 2"
       waren damit dieselbe Stelle. Wer am Zeilenende schrieb – also
       praktisch jeder, immer –, meldete Stelle 6, und beim anderen kam
       7 heraus.

       In reinem Text fiel es nicht auf: dort ist der Umbruch ein echtes
       Zeichen. Erst mit Absaetzen, also nach jeder Formatierung, brach es.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Am Zeilenende bleibt die Marke in ihrer Zeile');
    {
      const mitAbsaetzen = (eins) =>
        '<p>' + eins + '</p><p>Zwei</p><p>Drei</p><p>Vier</p>';

      await A(`pruefstand.setzeText(${JSON.stringify(mitAbsaetzen('Einsa'))}, 5)`);
      await warte(400);
      // A steht am ENDE der ersten Zeile – die haeufigste Stelle ueberhaupt
      await A(`pruefstand.setzeText(${JSON.stringify(mitAbsaetzen('Einsab'))}, 6)`);
      await warte(600);

      const marken = await B('pruefstand.fremdeMarken()');
      const baender = await B('pruefstand.baender()');
      const zeileM = marken.length ? await B(`pruefstand.zeileVon(${marken[0].top})`) : null;
      const zeileB = baender.length ? await B(`pruefstand.zeileVon(${baender[0].top})`) : null;
      notiz('Marke auf Zeile ' + zeileM + ', Band auf Zeile ' + zeileB);

      pruefe('Die Marke steht in der Zeile, in der A schreibt',
        zeileM === 0, 'sie steht auf Zeile ' + zeileM + ' statt 0');
      pruefe('Und nicht am Zeilenanfang, sondern hinter dem Getippten',
        marken.length > 0 && marken[0].left > 72,
        'sie steht ganz links (' + (marken[0] || {}).left + ') – das ist der Anfang der naechsten Zeile');
      pruefe('Das Band liegt auf derselben Zeile',
        zeileB === 0, 'es liegt auf Zeile ' + zeileB);

      /* Und die eigene Marke von B darf daran nichts aendern: sie
         irgendwohin zu setzen ist kein Ereignis fuer die fremde. */
      await B('pruefstand.markeAuf(17)');
      await warte(500);
      const danach = await B('pruefstand.fremdeMarken()');
      pruefe('Ein eigener Klick verschiebt die fremde Marke nicht',
        danach.length > 0 && danach[0].top === marken[0].top
          && danach[0].left === marken[0].left,
        JSON.stringify(marken[0]) + ' → ' + JSON.stringify(danach[0]));
    }

    /* ══════════════════════════════════════════════════════════════════
       ENTER AN DER GRENZE WIRD ABGEWIESEN

       Gemeldet: „wenn er mit Enter oder einfach weiterschreiben zu
       meiner Zeile kommt, sollte er nicht weitermachen koennen – jeder
       Versuch sollte gestoppt werden."

       Tippen mitten in einer freien Zeile aendert nichts an fremdem
       Text und bleibt erlaubt. Enter dagegen schiebt alles darunter
       eine Zeile tiefer: steht die Marke am Zeilenende, ist das
       Zeichen dahinter schon die gesperrte Zeile. Genau darauf prueft
       editBlockedBy (src/ui/collab.js).
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Enter an der Grenze wird abgewiesen');
    {
      // A schreibt auf Zeile 3 – gesperrt sind damit die Zeilen 2, 3 und 4
      const vier = '<p>Eins</p><p>Zwei</p><p>Drei</p><p>Vier</p>';
      await A(`pruefstand.setzeText(${JSON.stringify(vier)}, 12)`);
      await warte(500);
      await A(`pruefstand.setzeText(${JSON.stringify('<p>Eins</p><p>Zwei</p><p>Dreix</p><p>Vier</p>')}, 14)`);
      await warte(600);

      const frage = (stelle, art) => B(`(function(){
        pruefstand.markeAuf(${stelle});
        var td = document.querySelector('.j-text');
        var wer = window.Collab.editBlockedBy('p1', td, ${JSON.stringify(art)});
        return wer ? wer.name : null;
      })()`);

      notiz('gesperrt: ' + await B('(function(){var a=[];for(var i=0;i<=25;i++){if(window.Collab.lockOwner("p1",i,i))a.push(i);}return a.length?a[0]+"–"+a[a.length-1]:"nichts";})()'));

      pruefe('Mitten in der freien Zeile 1 darf getippt werden',
        await frage(2, 'insertText') === null, 'dort wurde abgewiesen');

      pruefe('Enter am Ende von Zeile 1 wird abgewiesen',
        await frage(4, 'insertParagraph') !== null,
        'Enter ging durch, obwohl es die gesperrte Zeile 2 nach unten schiebt');

      pruefe('Tippen in der gesperrten Zeile wird abgewiesen',
        await frage(11, 'insertText') !== null, 'dort ging es durch');

      /* ── Und die eigene Zeile bleibt einem, auch im Schutzstreifen ───
         Die Zeile darueber gehoert zum Streifen. Wer aber SELBST dort
         steht und schreibt, wird nicht abgewiesen – sonst koennten zwei,
         die eine Zeile auseinander sitzen, beide nicht mehr schreiben:
         jeder laege im Streifen des anderen, und der eigene Anspruch
         entsteht erst durch das Schreiben, das gerade abgewiesen wuerde.
         Gemessen in scripts/test-collab-tasten: von „unten" kam nur
         „nten" an. */
      pruefe('In der eigenen Zeile darf man schreiben, auch im Streifen',
        await frage(6, 'insertText') === null,
        'wer selbst dort steht, wurde ausgesperrt');

      /* Enter dagegen reicht ueber die eigene Zeile hinaus – und landet
         damit in der Zeile des anderen. */
      pruefe('Enter aus der Nachbarzeile in seine Zeile wird abgewiesen',
        await frage(9, 'insertParagraph') !== null, 'Enter ging durch');
    }

    /* ══════════════════════════════════════════════════════════════════
       EINE STELLE, DIE ES HIER NICHT GIBT, WIRD NICHT GEZEICHNET

       Gemeldet: „wenn ich irgendwo druecke, geht der Cursor meines
       Kollegen dorthin, wo mein Cursor ist – er sollte dort bleiben, wo
       er schreibt."

       >>> Was wirklich geschah <<<
       Meldet der andere eine Stelle, die im hiesigen Text noch gar nicht
       existiert (seine Aenderung ist unterwegs), klemmte caretRectAt sie
       ans Textende. Das Ende ist aber, wonach es aussieht: das letzte
       Element im Feld. Und ein Klick auf freie Flaeche legt dort einen
       FREI STEHENDEN Absatz an – absolut positioniert, genau an der
       Klickstelle. Die fremde Marke sprang damit auf den eigenen Klick.

       Nachgemessen: Text fuenf Zeichen, gemeldete Stelle 45, gezeichnet
       bei [499,797] – dem Punkt des freien Absatzes, auf das Pixel genau.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Eine Stelle hinter dem Textende wird nicht gezeichnet');
    {
      const seite = '<p>Eins</p><p class="j-frei" style="left:400px;top:600px"><br></p>';
      await B(`pruefstand.setzeText(${JSON.stringify(seite)}, 0)`);
      await warte(500);

      const laenge = (await B('pruefstand.text()')).length;

      /* Ein Anwesender, dessen Stelle es hier nicht gibt – so sieht es
         aus, solange seine Aenderung noch unterwegs ist. */
      const geist = (stelle) => {
        karten.set('uidGeist', {
          uid: 'uidGeist', name: 'Geist', initials: 'G', color: '#8a2e46',
          pageId: 'p1', offset: stelle, lockFrom: stelle, lockTo: stelle + 3,
          lockAt: Date.now(), cx: '', objLock: '', objLockAt: 0, at: Date.now()
        });
        schickePraesenz();
        return warte(500);
      };

      await geist(laenge + 40);
      const nurGeist = (l) => l.filter(m => /Geist/.test(m.name || ''));
      const weit = nurGeist(await B('pruefstand.fremdeMarken()'));
      const baenderWeit = await B('pruefstand.baender()');
      const freiPunkt = await B('(function(){var f=document.querySelector("p.j-frei");if(!f)return null;var r=f.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top)];})()');
      notiz('Stelle ' + (laenge + 40) + ' bei Text der Laenge ' + laenge
        + ': ' + JSON.stringify(weit) + ', freier Absatz bei ' + JSON.stringify(freiPunkt));
      pruefe('Keine Marke fuer eine Stelle, die es nicht gibt',
        weit.length === 0,
        'sie wurde gezeichnet – und zwar am letzten Element: ' + JSON.stringify(weit));
      pruefe('Und auch kein Sperrband', baenderWeit.length === 0,
        JSON.stringify(baenderWeit));

      /* Und genau auf der Leerzeile des freien Absatzes: die Stelle gibt
         es, sie ist nur die, die der eigene Klick eben angelegt hat. Fuer
         den Nutzer sieht es genauso aus – die Marke springt auf den Klick. */
      await geist(laenge);
      const aufFrei = nurGeist(await B('pruefstand.fremdeMarken()'));
      pruefe('Auch nicht auf dem leeren Absatz, den ein Klick anlegt',
        aufFrei.length === 0, JSON.stringify(aufFrei));

      /* Und der Gegenbeweis: eine Stelle, die es gibt, wird gezeichnet –
         sonst pruefte das oben nur, dass ueberhaupt nichts erscheint. */
      await geist(2);
      const drin = nurGeist(await B('pruefstand.fremdeMarken()'));
      pruefe('Eine Stelle im Text dagegen schon', drin.length === 1,
        JSON.stringify(drin));

      karten.delete('uidGeist');
      schickePraesenz();
      await warte(300);
    }

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

    /* Und die Rechnung der Schreibmarken muss weiterhin aufgehen: seit
       dem Umbau ist jede ZELLE eine Zeile im flachen Maß (canvas/text.js
       zählt <td> als Block, <tr> ist nur die Hülle darum). Vorher lief
       eine ganze Reihe zu einer Zeile zusammen – dann hatte eine Zelle
       keine Grenze, an der ein Anspruch enden konnte. */
    const flach = await B(`pruefstand.text()`);
    const zeilenImText = flach.split('\n').length;
    notiz('flacher Text: ' + JSON.stringify(flach) + ' → ' + zeilenImText + ' Zeilen');
    pruefe('Jede Tabellenzelle ist eine Zeile im flachen Maß',
      zeilenImText === 13,    // 3 Reihen à 4 Zellen + der Absatz dahinter
      zeilenImText + ' statt 13');

    /* ══════════════════════════════════════════════════════════════════
       EINE ZELLE GEHOERT EINEM – DIE NACHBARZELLE NICHT

       Gemeldet: „in einer Tabelle nie in der gleichen Zelle."

       >>> Warum das lange gar nicht formulierbar war <<<
       Eine Tabellenzelle galt im flachen Text als inline. Die Zellen
       einer Reihe liefen damit zu EINER Zeichenkette zusammen: aus
       |AA|BB|CC| wurde „AABBCC". Das Ende der zweiten Zelle und der
       Anfang der dritten waren dieselbe Zahl – eine Zelle hatte gar
       keine Grenze, an der sich ein Anspruch festmachen liesse.

       Gemessen wurde damals genau das: wer in der mittleren Zelle
       tippte, beanspruchte sie samt dem ersten Zeichen der Nachbarzelle;
       stand die Marke am Zellenrand, beanspruchte er die Nachbarzelle
       statt der eigenen.

       Seit jede Zelle eine eigene Zeile ist, beschneidet flatLineSpan
       jeden Anspruch auf sie. Hier wird nachgemessen, dass er wirklich
       drin bleibt.
       ══════════════════════════════════════════════════════════════════ */
    abschnitt('Eine Zelle gehoert einem, die Nachbarzelle nicht');
    {
      const tab = (bb) => '<table class="j-table"><tbody>'
        + '<tr><td>AA</td><td>' + bb + '</td><td>CC</td></tr>'
        + '<tr><td>DD</td><td>EE</td><td>FF</td></tr>'
        + '</tbody></table><p>Danach</p>';

      await A(`pruefstand.setzeText(${JSON.stringify(tab('BB'))}, 3)`);
      await warte(600);

      const flach = await B('pruefstand.text()');
      notiz('flacher Text: ' + JSON.stringify(flach));
      pruefe('Jede Zelle ist eine eigene Zeile',
        flach === 'AA\nBB\nCC\nDD\nEE\nFF\nDanach',
        JSON.stringify(flach));

      /* A tippt in der MITTLEREN Zelle der ersten Reihe. Danach steht
         dort „BBxy": Zelle 1 auf 0..1, Zelle 2 auf 3..6, Zelle 3 auf 8..9. */
      await A(`pruefstand.setzeText(${JSON.stringify(tab('BBx'))}, 5)`);
      await warte(400);
      await A(`pruefstand.setzeText(${JSON.stringify(tab('BBxy'))}, 6)`);
      await warte(600);

      const gesperrt = await B('(function(){var a=[];for(var i=0;i<30;i++){if(window.Collab.lockOwner("p1",i,i))a.push(i);}return a;})()');
      notiz('gesperrt bei B: ' + JSON.stringify(gesperrt));

      pruefe('Ueberhaupt gesperrt', gesperrt.length > 0,
        'niemand beansprucht etwas – dann sagt die Pruefung darunter nichts');
      pruefe('Die Nachbarzellen bleiben frei',
        gesperrt.length > 0 && gesperrt[0] >= 3 && gesperrt[gesperrt.length - 1] <= 7,
        'der Anspruch reicht in eine Nachbarzelle: ' + JSON.stringify(gesperrt));

      /* Und das Band darf auch nicht ueber die ganze Reihe laufen: sonst
         sieht die freie Nachbarzelle belegt aus. Es bleibt in der Zelle. */
      const band = await B('(function(){var e=document.getElementsByClassName("collab-lock")[0];if(!e)return null;var t=document.querySelector(".j-text").getBoundingClientRect();return {b:parseFloat(e.style.width), t:t.width};})()');
      notiz('Bandbreite: ' + JSON.stringify(band));
      pruefe('Das Band bleibt in der Zelle',
        !!band && band.b < band.t * 0.8,
        'es laeuft ueber die ganze Textbreite: ' + JSON.stringify(band));
    }


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
