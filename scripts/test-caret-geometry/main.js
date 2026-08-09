/* ══════════════════════════════════════════════════════════════════════
   WO DIE FREMDE SCHREIBMARKE UND DAS SPERRBAND SITZEN

   scripts/test-collab-caret.js prüft die ZAHL: die Umrechnung zwischen
   DOM-Stelle und flachem Maß, mit einem nachgebauten DOM. Das genügt
   dafür, ist aber nur die halbe Miete.

   Die andere Hälfte sind die PIXEL – caretRectAt() und lineBoxOf() aus
   canvas/text.js. Genau dort saßen die gemeldeten Fehler: „der Text war
   an der richtigen Stelle, aber der Cursor des anderen und die gesperrte
   Zeile standen falsch". Das lässt sich ohne Layout nicht prüfen, und
   ohne Layout ist es auch nie geprüft worden.

   Gemessen wird gegen das Linienraster des Papiers: bei Zeilenhöhe 32
   und dem Textfeld bei top:64px muss Zeile n bei 64 + Innenabstand +
   n * 32 anfangen. Das ist eine harte Zahl, keine Toleranz.

   Zusätzlich wird gegen den Browser selbst gegengerechnet: setFlatCaret
   setzt eine echte Schreibmarke, und deren Rechteck muss in derselben
   Zeile liegen wie unsere gerechnete. Beides zusammen deckt sowohl einen
   Rechenfehler als auch einen falschen Bezugspunkt auf.

   Läuft NICHT in `npm test` – das ist reines Node und soll es bleiben.
   Aufruf:  npm run test:caret
   ══════════════════════════════════════════════════════════════════════ */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

app.on('ready', () => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  const fehler = [];

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    fehler.push(`Laden fehlgeschlagen: ${code} ${desc} ${url}`);
  });

  /* Ein Fehler in der Seite liess den Bericht sonst schlicht leer – man
     sieht "keine Ergebnisse" und nicht, was schiefging. Gezaehlt wird
     das NICHT als eigene fehlgeschlagene Pruefung: die Meldung steht
     schon in der Liste unten, und Chromium schreibt hier auch
     Belangloses hin (fehlende Schriften etwa). */
  const seitenMeldungen = [];
  win.webContents.on('console-message', (...args) => {
    // Electron reicht das je nach Fassung als Objekt oder als Einzelwerte
    const erst = args[0];
    const stufe = (erst && typeof erst === 'object' && 'level' in erst) ? erst.level : args[1];
    const text = (erst && typeof erst === 'object' && 'message' in erst) ? erst.message : args[2];
    if (Number(stufe) >= 2) seitenMeldungen.push(String(text));
  });

  win.loadFile(path.join(__dirname, 'page.html'));

  win.webContents.once('did-finish-load', async () => {
    let bericht;
    try {
      bericht = await win.webContents.executeJavaScript('window.__ergebnis || ""');
    } catch (err) {
      bericht = 'ABBRUCH ' + err.message;
    }

    process.stdout.write('\nWo die fremde Schreibmarke sitzt\n');
    process.stdout.write(bericht.split('\n').map(l => '  ' + l).join('\n') + '\n');

    const gescheitert = bericht.split('\n').filter(l => /^(FEHL|ABBRUCH)/.test(l));
    if (!bericht.trim()) fehler.push('Die Seite hat kein Ergebnis geliefert.');
    fehler.push(...gescheitert);

    if (seitenMeldungen.length) {
      process.stdout.write('\nMeldungen aus der Seite:\n');
      for (const m of seitenMeldungen) process.stdout.write('  ' + m + '\n');
    }

    if (fehler.length) {
      for (const f of fehler) process.stdout.write('  ' + f + '\n');
      process.stdout.write(`\n${fehler.length} Prüfung(en) fehlgeschlagen.\n`);
      app.exit(1);
      return;
    }
    process.stdout.write('\nAlle Prüfungen bestanden.\n');
    app.exit(0);
  });
});
