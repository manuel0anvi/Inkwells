/* ══════════════════════════════════════════════════════════════════════
   WERBEBILDER — echte Aufnahmen der echten App

   Fuer die Anzeige und den Auftritt braucht es Bilder, auf denen das
   Heft nicht leer ist. Ein frisch gestartetes Inkwells zeigt eine weisse
   Seite und acht graue Kaesten – davon laesst sich nichts erzaehlen.

   Hier wird die App deshalb geladen, mit Inhalt gefuellt und
   abfotografiert. ECHTE App, echtes Chromium, echtes Layout: was hier
   herauskommt, gibt es auch wirklich. Nachgebaut wird nichts — auch die
   Anwesenden und der Chat entstehen aus denselben Klassen, die
   ui/collab.js und ui/chat.js im Betrieb setzen.

   Aufruf:  npm run werbebilder            (englisch)
            npm run werbebilder -- --de    (deutsch)

   Die Bilder landen in  werbebilder/  im Wurzelverzeichnis.

   >>> Warum das Fenster im Vollbild laeuft und nicht emuliert wird <<<
   Der naheliegende Weg waere Emulation.setDeviceMetricsOverride: damit
   liesse sich jede Groesse einstellen, unabhaengig vom Bildschirm. Er
   funktioniert hier NICHT – der Renderer stuerzt beim Start ab, weil
   ohne Grafikbeschleunigung (app.disableHardwareAcceleration, noetig
   fuer verlaessliche Aufnahmen) der Bildspeicher nicht zustande kommt.
   Der Abbruch kam ohne Meldung, nur als Exit-Code.

   Das Vollbild liefert dasselbe ohne Umweg: der Ausschnitt ist genau
   der Bildschirm, und Windows' Anzeigeskalierung ist die Schaerfe.
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const ZIEL = path.join(ROOT, 'werbebilder');
app.disableHardwareAcceleration();

/* Englisch ist der Regelfall: die Anzeige richtet sich an alle. */
const SPRACHE = process.argv.includes('--de') ? 'de'
  : process.argv.includes('--it') ? 'it' : 'en';

/* Nur fuer die AUSSCHNITTE. Ein Ausschnitt wird neu gerastert, und
   doppelt gerastert bleibt eine Werkzeugleiste auch dann lesbar, wenn
   sie im Schnitt formatfuellend steht. */
const SCHAERFE = Number(process.env.WB_SCHAERFE || 2);

/* Die Handler des echten main.js gibt es hier nicht. Ohne Attrappen
   klagt die App beim Laden. */
const ATTRAPPEN = {
  'load-settings': {}, 'save-settings': true, 'load-registry': { notebooks: [] },
  'save-registry': true, 'get-default-save-path': '', 'check-internet': false,
  'get-pending-deep-link': null, 'get-pending-share-link': null, 'pick-folder': null,
  'save-notebook': true, 'load-notebook': null, 'list-notebooks': [],
  'erst-start': false, 'load-postfach': null, 'save-postfach': true
};
for (const [kanal, wert] of Object.entries(ATTRAPPEN)) ipcMain.handle(kanal, async () => wert);

const warte = ms => new Promise(r => setTimeout(r, ms));
const bericht = [];

setTimeout(() => { console.error('ABBRUCH: Zeitgrenze'); app.exit(2); }, 300000);

process.on('unhandledRejection', (e) => {
  process.stderr.write('OFFENE ZUSAGE: ' + ((e && e.stack) || e) + '\n');
  setTimeout(() => app.exit(3), 200);
});

app.on('ready', async () => {
 try {
  fs.mkdirSync(ZIEL, { recursive: true });

  /* ── Wie gross das Bild wird ──────────────────────────────────────
     Vollbild ohne Rahmen. Die App bringt ihre eigene Titelleiste mit
     (frame:false im echten main.js); ein zusaetzlicher Windows-Rahmen
     darueber saehe auf einem Werbebild aus wie ein Fehler. */
  const flaeche = screen.getPrimaryDisplay();
  console.log('Bildschirm: ' + flaeche.size.width + 'x' + flaeche.size.height
    + ' @' + flaeche.scaleFactor + '  Sprache: ' + SPRACHE);

  const win = new BrowserWindow({
    width: flaeche.workAreaSize.width, height: flaeche.workAreaSize.height,
    x: 0, y: 0, frame: false, fullscreen: true, show: true,
    backgroundColor: '#12121a',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });

  /* Was der Renderer meldet, gehoert hierher – sonst scheitert der Aufbau
     still und es liegen nur leere Bilder da. */
  win.webContents.on('console-message', (_e, stufe, text) => {
    if (stufe >= 2) console.log('  [renderer] ' + text);
  });
  win.webContents.on('render-process-gone', (_e, d) =>
    console.error('RENDERER WEG: ' + JSON.stringify(d)));

  const dbg = win.webContents.debugger;
  dbg.attach('1.3');

  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await warte(2500);

  const js = (code) => win.webContents.executeJavaScript(code);

  /** Ein Bild schreiben. `clip` schneidet einen Ausschnitt in CSS-Pixeln. */
  async function schuss(name, clip) {
    const arg = { format: 'png', captureBeyondViewport: false };
    if (clip) arg.clip = Object.assign({}, clip, { scale: SCHAERFE });
    const { data } = await dbg.sendCommand('Page.captureScreenshot', arg);
    const datei = path.join(ZIEL, name + '.png');
    fs.writeFileSync(datei, Buffer.from(data, 'base64'));
    const kb = Math.round(fs.statSync(datei).size / 1024);
    bericht.push('  ' + name.padEnd(26) + kb + ' KB');
  }

  /** Der Kasten eines Elements, fuer den Ausschnitt. */
  const kasten = (wahl, luft) => js('(() => {'
    + 'const el = document.querySelector(' + JSON.stringify(wahl) + ');'
    + 'if (!el) return null;'
    + 'const r = el.getBoundingClientRect(); const L = ' + (luft || 0) + ';'
    + 'return { x: Math.max(0, Math.round(r.left - L)), y: Math.max(0, Math.round(r.top - L)),'
    + '         width: Math.round(r.width + L * 2), height: Math.round(r.height + L * 2) };'
    + '})()');

  try {
    await js('setLanguage(' + JSON.stringify(SPRACHE) + '); true');
    await warte(500);

    await js(inhaltScript(texte(SPRACHE)));
    await warte(1400);

    // ── B · Die Uebersicht ────────────────────────────────────────────
    await schuss('B-uebersicht');

    // ── A · Das Hauptbild: Text und Handschrift auf einer Seite ───────
    await js('openNotebook(window.__W.heft); true');
    await warte(2000);
    /* Erst jetzt lassen sich die Anmerkungen setzen: wo ein Wort steht,
       weiss man erst, wenn der Text umbrochen ist. */
    await js(anmerkungScript());
    await warte(900);
    await js('switchMode("pen1"); true');
    await warte(800);
    await schuss('A-hauptbild');

    // Nur das Blatt – fuer Einblendungen im Schnitt
    const blatt = await kasten('.j-page', 20);
    if (blatt) await schuss('A2-blatt-nah', blatt);

    // ── D · Die Werkzeugleiste ────────────────────────────────────────
    const leiste = await kasten('#toolbar', 6);
    if (leiste) await schuss('D-werkzeugleiste', leiste);

    // ── I · Die Titelleiste ───────────────────────────────────────────
    const titel = await kasten('.tbar-r', 8);
    if (titel) await schuss('I-titelleiste', titel);

    // ── E · Das Lineal ────────────────────────────────────────────────
    const linealDa = await js('(() => { const b = document.querySelector(".btn-ruler");'
      + 'if (b) b.click(); return !!b; })()');
    await warte(1200);
    if (linealDa) await schuss('E-lineal');
    await js('(() => { const b = document.querySelector(".btn-ruler");'
      + 'if (b && b.classList.contains("active")) b.click(); return true; })()');
    await warte(500);

    // ── F · Tabelle und Formel ────────────────────────────────────────
    await js('(() => { const el = document.querySelector("[data-pgid=\\"" + window.__W.p2 + "\\"]");'
      + 'if (el) el.scrollIntoView({ block: "start" }); return true; })()');
    await warte(1200);
    /* Noch einmal: beim ersten Mal war Seite 2 gar nicht im DOM. Die
       Seiten kommen erst dazu, wenn man in ihre Naehe rollt. */
    await js(FORMELN);
    await warte(700);
    await schuss('F-tabelle-formel');

    // ── G · Kommentare ────────────────────────────────────────────────
    await js('(() => { const el = document.querySelector("[data-pgid=\\"" + window.__W.p1 + "\\"]");'
      + 'if (el) el.scrollIntoView({ block: "start" });'
      + 'if (typeof refreshComments === "function") refreshComments(); return true; })()');
    await warte(1200);
    /* Die Leiste auf und die Karte im Rand weg: solange beide da sind,
       steht derselbe Kommentar zweimal im Bild – und die im Rand ragt
       oben aus dem Fenster heraus. */
    await js('(() => { const p = document.querySelector(".comment-panel");'
      + 'if (p) p.classList.add("open");'
      + 'document.querySelectorAll(".comment-card").forEach(k => {'
      + '  if (!k.closest("#comment-panel-list")) k.remove(); });'
      + 'return true; })()');
    await warte(1000);
    await schuss('G-kommentare');
    await js('(() => { const p = document.querySelector(".comment-panel");'
      + 'if (p) p.classList.remove("open"); return true; })()');
    await warte(600);

    /* ── H · Exportieren ──────────────────────────────────────────────
       VOR dem Bild zu zweit: der Streifen mit den Anwesenden und die
       Chatleiste bleiben stehen, sobald sie einmal da sind, und lagen
       sonst hinter dem Fenster. Und die schwebende Kommentarkarte muss
       weg – sie steht ausserhalb der Abdunklung und ist deshalb das
       einzig Scharfe neben dem Fenster. */
    await js('(() => { document.querySelectorAll(".comment-card.schwebend")'
      + '.forEach(k => k.remove());'
      + 'if (typeof openExportDialog === "function") openExportDialog(getNb());'
      + 'return true; })()');
    await warte(1300);
    await schuss('H-export');
    await js('(() => { document.querySelectorAll(".overlay")'
      + '.forEach(o => o.style.display = "none"); return true; })()');
    await warte(600);

    // ── C · Zu zweit am selben Dokument ───────────────────────────────
    await js(zusammenScript(texte(SPRACHE)));
    await warte(1200);
    await schuss('C-zusammen');

    console.log('\nWerbebilder (' + SPRACHE + ')\n' + bericht.join('\n'));
    console.log('\nOrdner: ' + ZIEL);
    app.exit(0);
  } catch (e) {
    console.error('FEHLER: ' + ((e && e.stack) || e));
    console.log(bericht.join('\n'));
    app.exit(1);
  }
 } catch (e) {
  console.error('FEHLER BEIM AUFBAU: ' + ((e && e.stack) || e));
  app.exit(1);
 }
});

/* Eine Formel aus ihrer Quelle aufbauen. Muss laufen, NACHDEM die Seite
   im DOM steht – im Text selbst kann das fertige KaTeX-HTML nicht
   stehen, core/sanitize.js nimmt ihm die Stile (siehe bei Seite 2). */
const FORMELN = `(() => {
  let n = 0;
  document.querySelectorAll('.j-formula').forEach(sp => {
    const quelle = sp.getAttribute('data-latex');
    if (!quelle || sp.childNodes.length) return;
    const erg = renderFormula(quelle, !!sp.closest('.j-formula-block'));
    if (erg && erg.html) { sp.innerHTML = erg.html; n++; }
  });
  return n;
})()`;

/* ══════════════════════════════════════════════════════════════════════
   DIE HANDSCHRIFT

   Sie ist der Grund fuer die ganze Uebung: ein Werbebild von Inkwells
   ohne Handschrift zeigt einen Texteditor. Der erste Versuch war eine
   langsame Sinuswelle – die sah aus wie ein Kardiogramm, nicht wie
   Schrift. Es fehlten die Groessenverhaeltnisse:

     · ein Buchstabe ist etwa so breit wie hoch (~7 px bei 9 px x-Hoehe),
       nicht 80 px wie eine halbe Sinusperiode
     · Woerter haben Luecken, weil die Hand absetzt — jedes Wort ist
       deshalb ein eigener Strich
     · Ober- und Unterlaengen (l, h, g, p) geben der Zeile ihr Muster
     · und alles neigt sich nach rechts

   Die Zufallszahlen sind gesaet (mulberry32), damit zwei Laeufe
   dieselben Bilder ergeben – sonst liesse sich ein Bild nicht
   nachziehen, wenn im Schnitt eines fehlt.
   ══════════════════════════════════════════════════════════════════════ */
const HANDSCHRIFT = `
  function saat(n) {
    let s = n >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Eine Zeile Handschrift ab (x, y) – y ist die Grundlinie.
     Ergibt ein Feld von Strichen, einen je Wort. */
  function handschrift(x, y, breite, xh, farbe, dicke, n) {
    const z = saat(n), striche = [];
    const NEIGUNG = 0.24;
    let cx = x;
    while (cx < x + breite - xh) {
      const laenge = 3 + Math.floor(z() * 5);
      const drift = (z() - 0.5) * 1.8;
      const p = [];
      let bx = cx;
      for (let b = 0; b < laenge && bx < x + breite; b++) {
        const ober = z() < 0.24 ? 1.8 + z() * 0.5 : 1;
        const unter = z() < 0.16 ? 0.85 : 0;
        const bw = xh * 0.68 + z() * xh * 0.16;
        for (let i = 0; i <= 11; i++) {
          const t = i / 11;
          /* (1 − cos)/2 statt sin: der Bogen laeuft mit STEIGUNG NULL
             los und kommt so auch wieder an. Zwei Buchstaben stossen
             dadurch rund aneinander statt in einer Spitze – mit sin
             sah die Zeile aus wie ein Saegeblatt, nicht wie Schrift. */
          const hoch = -(1 - Math.cos(t * Math.PI * 2)) / 2 * xh * ober;
          const tief = t > 0.6 ? (t - 0.6) / 0.4 * unter * xh : 0;
          p.push({
            x: bx + t * bw - hoch * NEIGUNG,
            y: y + drift + hoch + tief + (z() - 0.5) * 0.5,
            p: 0.42 + 0.22 * Math.sin(t * Math.PI)
          });
        }
        bx += bw;
      }
      if (p.length > 3) striche.push({ path: p, color: farbe, width: dicke, isHL: false });
      cx = bx + xh * 0.7 + z() * xh * 0.3;
    }
    return striche;
  }

  /* Ein Kringel um ein Wort – wie ihn eine Hand zieht: nicht ganz
     geschlossen und nicht ganz rund. */
  function kringel(mx, my, rx, ry, farbe, dicke) {
    const p = [];
    for (let i = 0; i <= 40; i++) {
      const w = (i / 40) * Math.PI * 2.15 - 0.35;
      p.push({ x: mx + Math.cos(w) * rx * (1 + Math.sin(w * 3) * 0.04),
               y: my + Math.sin(w) * ry * (1 + Math.cos(w * 2) * 0.06), p: 0.5 });
    }
    return { path: p, color: farbe, width: dicke, isHL: false };
  }

  /* Ein Pfeil, der sich zum Ziel hinbiegt. */
  function pfeil(x1, y1, x2, y2, farbe, dicke) {
    const p = [];
    const bauch = Math.min(40, Math.abs(x2 - x1) * 0.4 + 14);
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      p.push({ x: x1 + (x2 - x1) * t - Math.sin(t * Math.PI) * bauch * 0.25,
               y: y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * bauch, p: 0.5 });
    }
    const wx = x2 - x1, wy = y2 - y1;
    const l = Math.hypot(wx, wy) || 1;
    const ux = wx / l, uy = wy / l;
    const S = 13;
    p.push({ x: x2 - (ux * 0.85 + uy * 0.5) * S, y: y2 - (uy * 0.85 - ux * 0.5) * S, p: 0.5 });
    p.push({ x: x2, y: y2, p: 0.5 });
    p.push({ x: x2 - (ux * 0.85 - uy * 0.5) * S, y: y2 - (uy * 0.85 + ux * 0.5) * S, p: 0.5 });
    return { path: p, color: farbe, width: dicke, isHL: false };
  }
`;

/* ══════════════════════════════════════════════════════════════════════
   DER INHALT

   Als Zeichenkette, weil er im Renderer laufen muss – dort stehen
   makePage(), renderHomeGrid() und buildFormulaHtml().
   ══════════════════════════════════════════════════════════════════════ */
function inhaltScript(T) {
  return '(() => {\n'
    + 'window.__W = {};\n'
    + 'const T = ' + JSON.stringify(T) + ';\n'
    + HANDSCHRIFT
    + `
    /* Was die Anmerkungen spaeter suchen sollen – sie laufen in einem
       eigenen Aufruf, wenn der Umbruch steht. */
    window.__W.T = T;
    window.__W.suchKringel = T.kringel;
    window.__W.suchMarker = T.marker;

    /* ── Ein kleines Diagramm als Bild ────────────────────────────────
       Statt eines Fotos: gezeichnet im Renderer, als data-URI ins
       Objekt. Damit haengt an den Bildern keine fremde Datei. */
    function diagramm(w, h) {
      const c = document.createElement('canvas');
      c.width = w * 2; c.height = h * 2;
      const g = c.getContext('2d'); g.scale(2, 2);
      g.fillStyle = '#f4efe4'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d8cfbc'; g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, w - 1, h - 1);
      const werte = [0.32, 0.5, 0.42, 0.66, 0.78, 0.6, 0.9];
      const bw = (w - 44) / werte.length;
      werte.forEach((v, i) => {
        const bh = (h - 46) * v;
        g.fillStyle = i === werte.length - 1 ? '#c8a96e' : '#a8968a';
        g.fillRect(24 + i * bw + 4, h - 24 - bh, bw - 10, bh);
      });
      g.strokeStyle = '#8a7f70'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(20, 14); g.lineTo(20, h - 24); g.lineTo(w - 14, h - 24); g.stroke();
      g.fillStyle = '#6b6055'; g.font = '10px sans-serif';
      g.fillText(T.diagrammTitel, 24, 12);
      return c.toDataURL('image/png');
    }

    /* ── Die Hefte der Uebersicht ─────────────────────────────────────
       Sechzehn, damit zwei Reihen stehen: eine einzelne Reihe liess
       zwei Drittel des Bildes leer. */
    const PAPIER = ['ruled', 'grid', 'dots', 'ruled', 'craft', 'grid', 'ruled', 'dots'];
    const hefte = T.hefte.map((h, i) => {
      const nb = { id: 'w-nb-' + i, name: h.name, color: h.farbe,
                   defaultBg: PAPIER[i % PAPIER.length],
                   pages: [], sections: [], comments: [],
                   created: Date.now() - i * 864e5 };
      for (let s = 0; s < h.seiten; s++) {
        const pg = makePage(PAPIER[i % PAPIER.length]);
        pg.textContent = '<p class="j-title-1">' + h.name + '</p><p>' + h.vorschau + '</p>';
        nb.pages.push(pg);
      }
      return nb;
    });
    S.notebooks = hefte;

    /* ── Das Heft fuer die Nahaufnahmen ───────────────────────────────
       Es ist das erste: was oben links steht, macht man auch auf. */
    const heft = hefte[0];
    heft.sections = [
      { id: 'w-s1', name: T.abschnitte[0], color: '#c8a96e' },
      { id: 'w-s2', name: T.abschnitte[1], color: '#2a5fa8' },
      { id: 'w-s3', name: T.abschnitte[2], color: '#2e8a46' }
    ];

    // Seite 1: getippter Text oben – die Handschrift kommt spaeter dazu,
    // wenn feststeht, wo die Woerter stehen.
    const p1 = makePage('ruled');
    p1.textContent = T.seite1;
    p1.secId = 'w-s1';
    p1.inkStrokes = [];
    /* Das Bild steht NEBEN der Handschrift, nicht darunter: getippter
       Text oben, links davon geschrieben, rechts eingesetzt – auf einem
       Blick sieht man, dass dreierlei auf derselben Seite Platz hat. */
    p1.objects = [{ id: 'w-o1', kind: 'image', src: diagramm(250, 168),
                    x: 462, y: 502, w: 250, h: 168, layer: 'front' }];

    /* ── Seite 2: Formel und Tabelle ──────────────────────────────────
       Im Text steht NUR die Quelle (data-latex), nicht das fertige
       KaTeX-HTML. Der Grund steht in core/sanitize.js: von einem style
       bleibt allein die Farbe stehen – und KaTeX baut seine Bruchstriche
       und Hochstellungen genau daraus. Fertig eingesetzt kam ein Haufen
       uebereinanderliegender Zeichen heraus.

       Gerendert wird deshalb erst im DOM, aus data-latex. Das ist auch
       der Weg, den die App selbst geht, wenn ein Heft geladen wird. */
    const p2 = makePage('grid');
    p2.textContent = T.seite2a
      + '<p class="j-formula-block"><span class="j-formula" data-latex="'
      + '\\\\sum_{n=1}^{\\\\infty} \\\\frac{1}{n^{2}} = \\\\frac{\\\\pi^{2}}{6}'
      + '"></span></p>'
      + T.seite2b;
    p2.secId = 'w-s2';
    p2.inkStrokes = [];

    // Seite 3: nur Handschrift – die Skizzenseite
    const p3 = makePage('dots');
    p3.secId = 'w-s3';
    p3.textContent = '<p class="j-title-2">' + T.skizzeTitel + '</p>';
    p3.inkStrokes = [];
    for (let i = 0; i < 8; i++) {
      p3.inkStrokes.push(...handschrift(112, 268 + i * 42, 330 + (i % 3) * 96,
                                        9, '#1a1510', 2.2, 900 + i));
    }
    p3.inkStrokes.push(kringel(512, 560, 138, 104, '#2e8a46', 2.6));
    p3.inkStrokes.push(kringel(512, 560, 96, 70, '#2e8a46', 2.4));
    for (let i = 0; i < 3; i++) {
      p3.inkStrokes.push(...handschrift(150, 740 + i * 42, 420, 9, '#2a5fa8', 2.2, 950 + i));
    }

    const p4 = makePage('ruled'); p4.secId = 'w-s1';
    p4.textContent = '<p class="j-title-1">' + T.hefte[0].name + '</p><p>'
                   + T.hefte[0].vorschau + '</p>';

    heft.pages = [p1, p2, p3, p4];
    window.__W.heft = heft.id;
    window.__W.p1 = p1.id; window.__W.p2 = p2.id; window.__W.p3 = p3.id;

    // Der Kommentar an einer Stelle von Seite 1
    heft.comments = [{
      id: 'w-k1', pageId: p1.id, text: T.kommentar, zitat: T.kommentarZitat,
      author: { uid: 'w-a', name: T.leute[1].name },
      created: Date.now() - 36e5, resolved: false,
      replies: [{ id: 'w-k1r', text: T.kommentarAntwort,
                  author: { uid: 'w-b', name: T.leute[0].name },
                  created: Date.now() - 12e5 }]
    }];

    /* ── Ruhe in der Titelleiste ──────────────────────────────────────
       Der Zaehler am Postfach und am Profil meldet Ungelesenes. Auf
       einem Werbebild ist das ein roter Fleck, den niemand einordnen
       kann – und die Nachricht aus der Verwaltung hat mit dem Heft
       nichts zu tun. Beides bleibt weg; die Knoepfe selbst stehen
       weiterhin da, sie gehoeren zur App. */
    ['postfach-badge', 'profile-badge'].forEach(id => {
      const b = E(id); if (b) { b.style.display = 'none'; b.textContent = ''; }
    });
    const pf = E('btn-postfach'); if (pf) pf.style.display = 'none';

    /* ── Die Nachricht aus der Verwaltung ─────────────────────────────
       Steht eine im Postfach, legt sie sich als Fenster ueber alles –
       mitten in die Aufnahme, mit einem Text, der nur die Entwickler
       angeht. Sie kommt aus Firestore und damit erst, wenn eine Leitung
       da ist: beim ersten Lauf ohne Netz fehlte sie, beim naechsten
       stand sie ueber der Formel.

       Einmal wegdruecken genuegt nicht. Das Gelesen-Zeichen wird ueber
       load-/save-postfach gehalten, und beides ist hier eine Attrappe –
       beim naechsten Lauf waere sie wieder da. Deshalb bleibt sie
       dauerhaft zu; in der echten App aendert das nichts. */
    const nachrichtZu = () => {
      ['ov-nachricht', 'ov-postfach'].forEach(id => {
        const ov = E(id);
        if (ov && ov.style.display !== 'none') ov.style.display = 'none';
      });
    };
    nachrichtZu();
    setInterval(nachrichtZu, 150);

    renderHomeGrid();
    showHome();
    return true;
  })()`;
}

/* ══════════════════════════════════════════════════════════════════════
   DIE ANMERKUNGEN AUF SEITE 1

   Sie koennen erst gesetzt werden, wenn die Seite steht: ein Kringel um
   ein Wort muss um DIESES Wort liegen, und wo es steht, entscheidet der
   Umbruch. Im ersten Anlauf standen die Striche auf festen Koordinaten –
   der rote Kringel lag daneben, im Leeren, und der Pfeil zeigte auf
   nichts.

   Gemessen wird ueber eine Range: Textknoten durchgehen, die Stelle
   suchen, Rechteck holen, in Seitenkoordinaten umrechnen.
   ══════════════════════════════════════════════════════════════════════ */
function anmerkungScript() {
  return '(() => {\n' + HANDSCHRIFT + `
    const T = window.__W.T || {};
    const pgEl = document.querySelector('[data-pgid="' + window.__W.p1 + '"]');
    if (!pgEl) return 'keine Seite';
    const txt = pgEl.querySelector('.j-text');
    const pr = pgEl.getBoundingClientRect();
    const z = (typeof getZoom === 'function') ? getZoom() : 1;

    /* Das Rechteck einer Textstelle, in Seitenkoordinaten. */
    function stelle(suche) {
      const lauf = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT);
      let k;
      while ((k = lauf.nextNode())) {
        const i = k.nodeValue.indexOf(suche);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(k, i); r.setEnd(k, i + suche.length);
        const b = r.getBoundingClientRect();
        if (!b.width) continue;
        return { x: (b.left - pr.left) / z, y: (b.top - pr.top) / z,
                 w: b.width / z, h: b.height / z };
      }
      return null;
    }

    const striche = [];

    // Der rote Kringel um die Stelle, die im Kommentar gemeint ist
    const k = stelle(window.__W.suchKringel);
    if (k) striche.push(kringel(k.x + k.w / 2, k.y + k.h / 2,
                                k.w / 2 + 16, k.h / 2 + 9, '#c04040', 2.6));

    // Der Marker ueber einer anderen Stelle
    const m = stelle(window.__W.suchMarker);
    if (m) striche.push({ path: [{ x: m.x - 3, y: m.y + m.h * 0.62, p: 0.5 },
                                 { x: m.x + m.w + 3, y: m.y + m.h * 0.62, p: 0.5 }],
                          color: '#e8c96a', width: Math.max(14, m.h * 0.85), isHL: true });

    /* Die Randnotiz und der Pfeil dorthin. Sie steht LINKS neben dem
       Satzspiegel – genau dafuer ist der Rand da. */
    if (k) {
      striche.push(...handschrift(74, k.y + 74, 118, 8, '#2a5fa8', 2.0, 41));
      striche.push(...handschrift(74, k.y + 100, 96, 8, '#2a5fa8', 2.0, 42));
      striche.push(pfeil(150, k.y + 62, k.x + 24, k.y + k.h + 14, '#2a5fa8', 1.9));
    }

    /* Und unter dem getippten Text geht es mit der Hand weiter – das
       ist der Satz, um den es der App geht. Die Hoehe haengt an der
       gemessenen Zeile und nicht an einer festen Zahl: sonst klafft
       zwischen Getipptem und Geschriebenem eine leere Bahn, sobald der
       Text eine Zeile mehr oder weniger braucht. */
    const unten = (k ? k.y : 340) + 150;
    for (let i = 0; i < 4; i++) {
      striche.push(...handschrift(112, unten + i * 42, 280 + (i % 2) * 50,
                                  9.5, '#1a1510', 2.3, 11 + i));
    }
    for (let i = 0; i < 2; i++) {
      striche.push(...handschrift(112, unten + 180 + i * 42, 250 + i * 36,
                                  9.5, '#2e8a46', 2.3, 21 + i));
    }

    S.strokeHistory[window.__W.p1] = striche;
    const c = pgEl.querySelector('.j-canvas:not(.live-canvas)');
    if (c) redrawStrokes(c, striche);
    getPage(window.__W.p1).page.inkStrokes = JSON.parse(JSON.stringify(striche));
    return striche.length + ' Striche';
  })()`;
}

/* ══════════════════════════════════════════════════════════════════════
   ZU ZWEIT AM SELBEN DOKUMENT

   Der Streifen ueber dem Blatt, die Abzeichen der Anwesenden und das
   Gespraech daneben. Aufgebaut mit GENAU den Klassen, die ui/collab.js
   (collab-dot) und ui/chat.js (chat-msg, chat-face, chat-bubble,
   chat-text, chat-time) im Betrieb setzen – was hier steht, sieht
   deshalb aus wie das Echte, weil es dieselben Regeln trifft.

   Warum nicht der echte Weg: der braucht Firestore, die Realtime
   Database und zwei angemeldete Konten. Auf einem Rechner ohne Leitung
   gibt es das nicht, und fuer ein Bild ist es auch nicht noetig.
   ══════════════════════════════════════════════════════════════════════ */
function zusammenScript(T) {
  return '(() => {\n'
    + 'const T = ' + JSON.stringify(T) + ';\n'
    + `
    /* Die schwebende Kommentarkarte aus dem Bild davor muss weg: hier
       geht es um das Gespraech, und zwei Kaesten mit fremdem Text
       nebeneinander erklaeren keinen von beiden. */
    document.querySelectorAll('.comment-card').forEach(k => k.remove());

    // Der Streifen: von wem das Dokument kommt und was man darf
    const bar = E('shared-bar');
    if (bar) bar.style.display = 'flex';
    const rolle = E('shared-bar-role');
    if (rolle) rolle.textContent = T.rolleBearbeiten;
    const wer = E('shared-bar-text');
    if (wer) wer.textContent = T.geteiltVon;

    // Die Anwesenden
    const leute = E('collab-people');
    if (leute) {
      leute.style.display = 'flex';
      leute.textContent = '';
      T.anwesend.forEach(p => {
        const dot = document.createElement('span');
        dot.className = 'collab-dot';
        dot.style.background = p.farbe;
        dot.textContent = p.kurz;
        dot.title = p.name;
        leute.appendChild(dot);
      });
    }
    const co = E('chat-open'); if (co) co.style.display = 'flex';

    // Das Gespraech
    const liste = E('chat-list');
    if (liste) {
      liste.textContent = '';
      T.chat.forEach(m => {
        const zeile = document.createElement('div');
        zeile.className = 'chat-msg' + (m.selbst ? ' selbst' : '');
        const kreis = document.createElement('span');
        kreis.className = 'chat-face';
        kreis.style.background = m.farbe;
        kreis.textContent = m.kurz;
        const blase = document.createElement('div');
        blase.className = 'chat-bubble';
        const text = document.createElement('div');
        text.className = 'chat-text';
        text.textContent = m.text;
        const zeit = document.createElement('span');
        zeit.className = 'chat-time';
        zeit.textContent = m.zeit;
        blase.append(text, zeit);
        zeile.append(kreis, blase);
        liste.appendChild(zeile);
      });
      liste.scrollTop = liste.scrollHeight;
    }
    const tippt = E('chat-typing');
    if (tippt) {
      tippt.style.display = 'flex';
      const gesichter = E('chat-typing-faces');
      if (gesichter) {
        gesichter.textContent = '';
        const k = document.createElement('span');
        k.className = 'chat-face klein';
        k.style.background = T.anwesend[0].farbe;
        k.textContent = T.anwesend[0].kurz;
        gesichter.appendChild(k);
      }
    }
    const panel = document.querySelector('.chat-panel');
    if (panel) panel.classList.add('open');

    /* Die Schreibmarke des anderen im Text – das Zeichen dafuer, dass
       hier zwei Leute gleichzeitig tippen. */
    const pgEl = document.querySelector('[data-pgid="' + window.__W.p1 + '"]');
    const txt = pgEl && pgEl.querySelector('.j-text');
    if (txt) {
      const lauf = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT);
      let k, ziel = null;
      while ((k = lauf.nextNode())) {
        const i = k.nodeValue.indexOf(T.markeNach);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(k, i + T.markeNach.length); r.setEnd(k, i + T.markeNach.length);
        ziel = r.getBoundingClientRect();
        break;
      }
      if (ziel) {
        const el = document.createElement('div');
        el.className = 'collab-caret';
        el.style.cssText = 'position:fixed;left:' + Math.round(ziel.left) + 'px;top:'
          + Math.round(ziel.top) + 'px;height:' + Math.round(ziel.height || 20)
          + 'px;background:' + T.anwesend[0].farbe + ';z-index:60';
        const lab = document.createElement('span');
        lab.className = 'collab-caret-label';
        lab.textContent = T.anwesend[0].name;
        lab.style.background = T.anwesend[0].farbe;
        el.appendChild(lab);
        document.body.appendChild(el);
      }
    }
    return true;
  })()`;
}

/** Der sichtbare Inhalt, je Sprache. */
function texte(sprache) {
  const gemeinsam = {
    anwesend: [
      { name: 'Nora Vance', kurz: 'NV', farbe: '#7a3aaa' },
      { name: 'Theo Marsh', kurz: 'TM', farbe: '#2a8a88' }
    ],
    leute: [{ name: 'Sam Reed', kurz: 'SR' }, { name: 'Nora Vance', kurz: 'NV' }]
  };

  const en = Object.assign({}, gemeinsam, {
    hefte: [
      { name: 'Biology', farbe: '#2e8a46', seiten: 4, vorschau: 'Cellular respiration, photosynthesis and the carbon path.' },
      { name: 'Analysis II', farbe: '#2a5fa8', seiten: 41, vorschau: 'Series, convergence and the theorems behind them.' },
      { name: 'Term Plan', farbe: '#c87a2a', seiten: 8, vorschau: 'Deadlines, exams and what has to be done when.' },
      { name: 'Project Northlight', farbe: '#7a3aaa', seiten: 17, vorschau: 'Meeting notes, sketches, open questions.' },
      { name: 'Reading Notes', farbe: '#8a5030', seiten: 33, vorschau: 'What should stick, in my own words.' },
      { name: 'Organic Chemistry', farbe: '#c04040', seiten: 28, vorschau: 'Mechanisms, and why they run the way they do.' },
      { name: 'Norway Trip', farbe: '#2a8a88', seiten: 9, vorschau: 'Route, cabins and what to pack.' },
      { name: 'Thoughts', farbe: '#606060', seiten: 56, vorschau: 'Unsorted, and that is exactly why they are here.' },
      { name: 'Lab Journal', farbe: '#2e8a46', seiten: 62, vorschau: 'Every run, every number, in order.' },
      { name: 'Linear Algebra', farbe: '#2a5fa8', seiten: 37, vorschau: 'Bases, maps and the proofs that go with them.' },
      { name: 'Thesis', farbe: '#7a3aaa', seiten: 84, vorschau: 'Outline, sources and the chapters as they grow.' },
      { name: 'Recipes', farbe: '#c04040', seiten: 12, vorschau: 'Everything that has worked at least once.' },
      { name: 'Piano', farbe: '#c87a2a', seiten: 15, vorschau: 'Fingerings, tempos and what still needs work.' },
      { name: 'Interviews', farbe: '#8a5030', seiten: 21, vorschau: 'Quotes, timestamps and first impressions.' },
      { name: 'Garden', farbe: '#2a8a88', seiten: 7, vorschau: 'Beds, sowing dates and what actually came up.' },
      { name: 'Archive 2025', farbe: '#606060', seiten: 118, vorschau: 'Kept, because you never know.' }
    ],
    abschnitte: ['Lecture', 'Exercises', 'Sketches'],
    seite1: '<p class="j-title-1">Cellular Respiration</p>'
      + '<p>The cell gains its energy in three steps. Each one happens in a '
      + 'different place, and only the last delivers the bulk of the yield.</p>'
      + '<p class="j-title-3">1 · Glycolysis</p>'
      + '<p>In the cytoplasm, glucose is split into two molecules of pyruvate. '
      + 'Two ATP and two NADH remain — little, but no oxygen required.</p>'
      + '<p class="j-title-3">2 · Citric acid cycle</p>'
      + '<p>In the mitochondrial matrix the pyruvate is broken down fully to CO₂. '
      + 'The energy moves into NADH and FADH₂ — the actual currency of the next '
      + 'step.</p>',
    kringel: 'the actual currency',
    marker: 'Two ATP and two NADH',
    markeNach: 'broken down fully',
    seite2a: '<p class="j-title-1">Problem Set 4</p>'
      + '<p>The series converges exactly when the limit of the partial sums '
      + 'exists:</p>',
    seite2b: '<p>Comparing the three tests:</p>'
      + '<table class="j-table"><tbody>'
      + '<tr><td><b>Test</b></td><td><b>Condition</b></td><td><b>Result</b></td></tr>'
      + '<tr><td>Ratio</td><td>|a<sub>n+1</sub>/a<sub>n</sub>| → q</td><td>q &lt; 1 converges</td></tr>'
      + '<tr><td>Root</td><td>√|a<sub>n</sub>| → q</td><td>q &lt; 1 converges</td></tr>'
      + '<tr><td>Leibniz</td><td>alternating, decreasing</td><td>converges</td></tr>'
      + '</tbody></table>'
      + '<p>The ratio test fails at q = 1 — there only comparison with a known '
      + 'series helps.</p>',
    diagrammTitel: 'ATP yield per step',
    skizzeTitel: 'Structure of the mitochondrion',
    kommentar: 'The balance is still missing — how much ATP actually comes out?',
    kommentarZitat: 'the actual currency',
    kommentarAntwort: 'True, I will add it tonight.',
    rolleBearbeiten: 'Can edit',
    geteiltVon: 'Shared by Nora Vance',
    chat: [
      { kurz: 'NV', farbe: '#7a3aaa', zeit: '14:02', text: 'Added the mitochondrion sketch on page 3.' },
      { kurz: 'SR', farbe: '#c8a96e', zeit: '14:03', selbst: true, text: 'Nice — I am rewriting the citric acid part right now.' },
      { kurz: 'NV', farbe: '#7a3aaa', zeit: '14:04', text: 'Go ahead, I will stay off that paragraph.' },
      { kurz: 'TM', farbe: '#2a8a88', zeit: '14:06', text: 'Do we need the ATP balance for Friday?' },
      { kurz: 'SR', farbe: '#c8a96e', zeit: '14:07', selbst: true, text: 'Yes. I left a comment on it.' }
    ]
  });

  const de = Object.assign({}, gemeinsam, {
    hefte: [
      { name: 'Biologie', farbe: '#2e8a46', seiten: 4, vorschau: 'Zellatmung, Photosynthese und der Weg des Kohlenstoffs.' },
      { name: 'Analysis II', farbe: '#2a5fa8', seiten: 41, vorschau: 'Reihen, Konvergenz und die Sätze dazu.' },
      { name: 'Semesterplan', farbe: '#c87a2a', seiten: 8, vorschau: 'Fristen, Prüfungen und was bis wann fertig sein muss.' },
      { name: 'Projekt Nordlicht', farbe: '#7a3aaa', seiten: 17, vorschau: 'Notizen aus den Besprechungen, Skizzen, offene Fragen.' },
      { name: 'Lesenotizen', farbe: '#8a5030', seiten: 33, vorschau: 'Was hängen bleiben soll, in eigenen Worten.' },
      { name: 'Organische Chemie', farbe: '#c04040', seiten: 28, vorschau: 'Mechanismen, und warum sie so ablaufen.' },
      { name: 'Reise Norwegen', farbe: '#2a8a88', seiten: 9, vorschau: 'Route, Hütten und was mit muss.' },
      { name: 'Gedanken', farbe: '#606060', seiten: 56, vorschau: 'Ungeordnet und genau deshalb hier.' },
      { name: 'Laborbuch', farbe: '#2e8a46', seiten: 62, vorschau: 'Jeder Durchgang, jede Zahl, der Reihe nach.' },
      { name: 'Lineare Algebra', farbe: '#2a5fa8', seiten: 37, vorschau: 'Basen, Abbildungen und die Beweise dazu.' },
      { name: 'Abschlussarbeit', farbe: '#7a3aaa', seiten: 84, vorschau: 'Gliederung, Quellen und die Kapitel im Wachsen.' },
      { name: 'Rezepte', farbe: '#c04040', seiten: 12, vorschau: 'Alles, was schon einmal gelungen ist.' },
      { name: 'Klavier', farbe: '#c87a2a', seiten: 15, vorschau: 'Fingersätze, Tempi und was noch hakt.' },
      { name: 'Interviews', farbe: '#8a5030', seiten: 21, vorschau: 'Zitate, Zeitmarken und erste Eindrücke.' },
      { name: 'Garten', farbe: '#2a8a88', seiten: 7, vorschau: 'Beete, Aussaat und was wirklich gekommen ist.' },
      { name: 'Archiv 2025', farbe: '#606060', seiten: 118, vorschau: 'Aufgehoben, weil man nie weiss.' }
    ],
    abschnitte: ['Vorlesung', 'Übungen', 'Skizzen'],
    seite1: '<p class="j-title-1">Zellatmung</p>'
      + '<p>Die Zelle gewinnt ihre Energie in drei Schritten. Jeder davon findet '
      + 'an einem anderen Ort statt, und erst der letzte liefert den grossen '
      + 'Teil der Ausbeute.</p>'
      + '<p class="j-title-3">1 · Glykolyse</p>'
      + '<p>Im Zytoplasma wird Glucose in zwei Moleküle Pyruvat zerlegt. Netto '
      + 'bleiben zwei ATP und zwei NADH übrig — wenig, dafür ohne Sauerstoff.</p>'
      + '<p class="j-title-3">2 · Citratzyklus</p>'
      + '<p>In der Mitochondrienmatrix wird das Pyruvat vollständig zu CO₂ '
      + 'abgebaut. Die Energie wandert dabei in NADH und FADH₂ — die eigentliche '
      + 'Währung des nächsten Schritts.</p>',
    kringel: 'die eigentliche',
    marker: 'zwei ATP und zwei NADH',
    markeNach: 'vollständig zu',
    seite2a: '<p class="j-title-1">Übungsblatt 4</p>'
      + '<p>Die Reihe konvergiert genau dann, wenn der Grenzwert der '
      + 'Partialsummen existiert:</p>',
    seite2b: '<p>Vergleich der drei Kriterien:</p>'
      + '<table class="j-table"><tbody>'
      + '<tr><td><b>Kriterium</b></td><td><b>Bedingung</b></td><td><b>Aussage</b></td></tr>'
      + '<tr><td>Quotient</td><td>|a<sub>n+1</sub>/a<sub>n</sub>| → q</td><td>q &lt; 1 konvergent</td></tr>'
      + '<tr><td>Wurzel</td><td>√|a<sub>n</sub>| → q</td><td>q &lt; 1 konvergent</td></tr>'
      + '<tr><td>Leibniz</td><td>alternierend, fallend</td><td>konvergent</td></tr>'
      + '</tbody></table>'
      + '<p>Der Quotiententest versagt bei q = 1 — dort hilft nur der Vergleich '
      + 'mit einer bekannten Reihe.</p>',
    diagrammTitel: 'ATP je Schritt',
    skizzeTitel: 'Aufbau des Mitochondriums',
    kommentar: 'Hier fehlt noch die Bilanz — wie viel ATP kommt am Ende wirklich heraus?',
    kommentarZitat: 'die eigentliche Währung',
    kommentarAntwort: 'Stimmt, ich trage das heute Abend nach.',
    rolleBearbeiten: 'Bearbeiten',
    geteiltVon: 'Geteilt von Nora Vance',
    chat: [
      { kurz: 'NV', farbe: '#7a3aaa', zeit: '14:02', text: 'Die Skizze vom Mitochondrium steht auf Seite 3.' },
      { kurz: 'SR', farbe: '#c8a96e', zeit: '14:03', selbst: true, text: 'Gut — ich schreibe gerade den Citratzyklus um.' },
      { kurz: 'NV', farbe: '#7a3aaa', zeit: '14:04', text: 'Mach ruhig, ich lasse den Absatz in Ruhe.' },
      { kurz: 'TM', farbe: '#2a8a88', zeit: '14:06', text: 'Brauchen wir die ATP-Bilanz bis Freitag?' },
      { kurz: 'SR', farbe: '#c8a96e', zeit: '14:07', selbst: true, text: 'Ja. Ich habe einen Kommentar dazu gesetzt.' }
    ]
  });

  return sprache === 'de' ? de : en;
}
