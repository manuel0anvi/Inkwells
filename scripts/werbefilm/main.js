/* ══════════════════════════════════════════════════════════════════════
   WERBEFILM — fuenfzehn Sekunden aus den echten Aufnahmen

   Baut film.html Einzelbild fuer Einzelbild ab und schiebt die Bilder
   durch ffmpeg. Herauskommt eine MP4, wie sie ein Schnittprogramm auch
   liefern wuerde – nur ohne Schnittprogramm.

   Aufruf:  npm run werbefilm

   Voraussetzung: die Aufnahmen liegen in werbebilder/. Fehlen sie,
   erst "npm run werbebilder" laufen lassen.

   >>> Warum Einzelbilder und keine Bildschirmaufnahme <<<
   Eine Aufnahme des laufenden Fensters haengt an der Uhr: wird der
   Rechner kurz beschaeftigt, fehlen Bilder und der Film ruckelt. Hier
   wird jedes Bild EINZELN gestellt und abfotografiert. Das dauert
   laenger als fuenfzehn Sekunden, aber das Ergebnis ist unabhaengig
   davon, was der Rechner nebenher tut – dieselbe Ueberlegung wie bei
   den Pruefstaenden (siehe scripts/test-collab-live).
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const QUELLE = path.join(ROOT, 'werbebilder');
const ZIEL = path.join(ROOT, 'werbefilm');
const ROH = path.join(ZIEL, 'einzelbilder');
const QUELLEN = path.join(ZIEL, 'quellen');

const FPS = 30, DAUER = 15;
const BILDER = FPS * DAUER;
const BREITE = 1920, HOEHE = 1080;

const warte = ms => new Promise(r => setTimeout(r, ms));

/* Nur die Bilder, die film.html wirklich einbindet. */
const GEBRAUCHT = ['A2-blatt-nah.png', 'B-uebersicht.png',
                   'F-tabelle-formel.png', 'C-zusammen.png'];

setTimeout(() => { console.error('ABBRUCH: Zeitgrenze'); app.exit(2); }, 900000);

process.on('unhandledRejection', (e) => {
  process.stderr.write('OFFENE ZUSAGE: ' + ((e && e.stack) || e) + '\n');
  setTimeout(() => app.exit(3), 200);
});

/** ffmpeg finden: im Pfad, sonst an der Stelle, wo es hier liegt. */
function ffmpegPfad() {
  const versuch = spawnSync('ffmpeg', ['-version'], { shell: true });
  if (versuch.status === 0) return 'ffmpeg';
  const fest = 'C:\\ffmpeg-7.1.1-essentials_build\\bin\\ffmpeg.exe';
  if (fs.existsSync(fest)) return fest;
  return null;
}

app.on('ready', async () => {
 try {
  const fehlt = GEBRAUCHT.filter(n => !fs.existsSync(path.join(QUELLE, n)));
  if (fehlt.length) {
    console.error('Es fehlen Aufnahmen in werbebilder/:\n  ' + fehlt.join('\n  ')
      + '\n\nErst "npm run werbebilder" laufen lassen.');
    return app.exit(1);
  }

  const ffmpeg = ffmpegPfad();
  if (!ffmpeg) {
    console.error('ffmpeg nicht gefunden. Ohne ffmpeg gibt es keine MP4.\n'
      + 'Installieren mit:  winget install Gyan.FFmpeg');
    return app.exit(1);
  }

  fs.rmSync(ROH, { recursive: true, force: true });
  fs.mkdirSync(ROH, { recursive: true });

  /* ── Die Vorlagen herunterrechnen ─────────────────────────────────
     Die Aufnahmen sind 2560 breit, die hochkante sogar 2483x3470. In
     dieser Groesse abzutasten war der Grund, warum der erste Anlauf
     nach fuenfzehn Minuten erst bei Bild 226 stand. Einmal auf 1920
     gebracht, kostet dasselbe nur noch Millisekunden. */
  fs.mkdirSync(QUELLEN, { recursive: true });
  console.log('Vorlagen rechnen ...');
  /* In VOLLER Groesse, nicht auf 1920 heruntergerechnet. Die Karten
     zeigen einen Ausschnitt – bei der Formel etwa nur das Blatt, nicht
     das halbe Fenster drumherum –, und dieser Ausschnitt wird auf
     Kartenbreite hochgezogen. Von einer 1920er Vorlage bliebe davon
     Matsch; die Aufnahmen sind 2560 breit, und genau die werden hier
     gebraucht. Als JPEG, weil PNG in dieser Groesse nur langsamer ist. */
  for (const [von, nach] of [
    ['A2-blatt-nah.png', 'blatt.jpg'],
    ['B-uebersicht.png', 'B-uebersicht.jpg'],
    ['F-tabelle-formel.png', 'F-tabelle-formel.jpg'],
    ['C-zusammen.png', 'C-zusammen.jpg']
  ]) {
    const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i',
      path.join(QUELLE, von), '-q:v', '2',
      path.join(QUELLEN, nach)], { shell: false });
    if (r.status !== 0) {
      console.error('ffmpeg konnte ' + von + ' nicht umrechnen.');
      return app.exit(1);
    }
  }

  /* Das Fenster ist nur noch Werkstatt: gemalt wird auf eine Leinwand
     mit festen 1920x1080, und die haengt nicht an seiner Groesse. */
  const win = new BrowserWindow({
    width: 1000, height: 620, show: true, backgroundColor: '#12121a',
    title: 'Inkwells – Werbefilm',
    webPreferences: { contextIsolation: false, nodeIntegration: false }
  });

  win.webContents.on('console-message', (_e, stufe, text) => {
    if (stufe >= 2) console.log('  [film] ' + text);
  });

  const dbg = win.webContents.debugger;
  dbg.attach('1.3');

  await win.loadFile(path.join(__dirname, 'film.html'));
  const js = (code) => win.webContents.executeJavaScript(code);

  const zustand = await js('window.__bereit');
  console.log('Leinwand bereit: ' + zustand);

  /* ── Die Leinwand liefert das Bild selbst ──────────────────────────
     Nicht mehr Page.captureScreenshot: das nahm den Umweg ueber das
     Fenster, und Chromium musste dafuer die ganze Seite neu rastern.
     canvas.toDataURL gibt genau das aus, was ohnehin schon gemalt ist –
     1920x1080, unabhaengig davon, wie gross das Fenster gerade ist. */
  const start = Date.now();
  for (let n = 0; n < BILDER; n++) {
    const b64 = await js('(window.__bild(' + n + '), window.__jpeg())');
    fs.writeFileSync(path.join(ROH, String(n).padStart(4, '0') + '.jpg'),
                     Buffer.from(b64, 'base64'));

    if (n % 90 === 0 || n === BILDER - 1) {
      const s = ((Date.now() - start) / 1000).toFixed(0);
      process.stdout.write('  ' + String(n + 1).padStart(3) + '/' + BILDER
        + '  (' + s + ' s)\n');
    }
  }

  win.hide();
  console.log('\nEinzelbilder fertig. ffmpeg laeuft ...');

  const datei = path.join(ZIEL, 'inkwells-15s.mp4');
  await new Promise((fertig, schiefgegangen) => {
    /* yuv420p und die geraden Masse: ohne beides spielt eine MP4 in
       Instagram, WhatsApp und QuickTime nicht ab, obwohl sie im
       VLC laeuft. faststart zieht den Kopf nach vorn, damit sie im
       Netz sofort losgeht statt erst nach dem vollen Download. */
    const p = spawn(ffmpeg, [
      '-y', '-framerate', String(FPS),
      '-i', path.join(ROH, '%04d.jpg'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
      /* ── Der Wertebereich ──────────────────────────────────────────
         Die Einzelbilder sind JPEG und damit VOLLER Bereich (0-255).
         Uebernimmt ffmpeg das, steht am Ende yuvj420p in der Datei –
         die laeuft zwar ueberall, aber Instagram und YouTube rechnen
         beim Umkodieren mit dem Fernsehbereich (16-235) und ziehen
         Schwarz und Weiss auseinander. Aus dem ruhigen Grund der App
         wird dann ein fleckiges Grau.

         Deshalb wird hier ausdruecklich umgerechnet statt nur
         umbenannt: scale mit in_range/out_range rechnet die Werte um,
         format legt sie fest. */
      '-vf', 'scale=in_range=full:out_range=limited,format=yuv420p',
      '-color_range', 'tv', '-colorspace', 'bt709',
      '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-movflags', '+faststart',
      datei
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let letzte = '';
    p.stderr.on('data', d => { letzte = String(d).trim().split('\n').pop(); });
    p.on('close', code => code === 0 ? fertig()
      : schiefgegangen(new Error('ffmpeg ' + code + ': ' + letzte)));
  });

  const mb = (fs.statSync(datei).size / 1048576).toFixed(1);
  console.log('\n  ' + datei);
  console.log('  ' + BREITE + 'x' + HOEHE + ' · ' + FPS + ' fps · '
    + DAUER + ' s · ' + mb + ' MB');
  console.log('\nEinzelbilder liegen in werbefilm/einzelbilder – zum '
    + 'Weiterschneiden brauchbar, sonst loeschbar.');
  app.exit(0);
 } catch (e) {
  console.error('FEHLER: ' + ((e && e.stack) || e));
  app.exit(1);
 }
});
