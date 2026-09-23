const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Notification } = require('electron');
const path = require('path');
const fs   = require('fs');
const zlib = require('zlib');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

let releaseInfo = null;
let downloadedUpdatePath = null;
let activeDownloadRes = null;
let isDownloadPaused = false;

function normalizeVersion(v) {
  return String(v).replace(/^v/i, '').trim();
}

/* Ein Versionsteil als Zahl.
   Hier stand nur Number(), und das ergibt fuer "0-beta" NaN. Weiter unten
   wurde daraus mit `|| 0` eine Null – "1.2.0-beta" und "1.2.0" galten
   damit als GLEICH, eine Vorabversion wurde also nie angeboten und beim
   Zurueckgehen auch nicht erkannt. parseInt liest die Ziffern vorn und
   laesst den Rest liegen, was hier genau das Richtige ist. */
function versionsTeil(wert) {
  const n = Number.parseInt(wert, 10);
  return Number.isFinite(n) ? n : 0;
}

function compareVersions(v1, v2) {
  const p1 = String(v1).split('.');
  const p2 = String(v2).split('.');
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = versionsTeil(p1[i]), n2 = versionsTeil(p2[i]);
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

/* Wie oft einer Weiterleitung gefolgt wird. Ohne Grenze laeuft ein Server,
   der im Kreis verweist, bis zum Stapelueberlauf – beide Funktionen unten
   riefen sich dafuer selbst auf. */
const MAX_REDIRECTS = 5;

/* Ohne Zeitgrenze wartet eine haengende Leitung fuer immer, und der Knopf
   stuende bis zum Programmende auf "wird geprueft". */
const FETCH_TIMEOUT_MS = 15000;

function fetchJson(url, rest = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const anfrage = https.get(url, { headers: { 'User-Agent': 'Inkwells-Updater' } }, res => {
      let data = '';
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();   // sonst bleibt die Verbindung offen
        if (rest <= 0) return reject(new Error('Zu viele Weiterleitungen'));
        if (!res.headers.location) return reject(new Error('Weiterleitung ohne Ziel'));
        return fetchJson(res.headers.location, rest - 1).then(resolve).catch(reject);
      }
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);

    anfrage.setTimeout(FETCH_TIMEOUT_MS, () => {
      anfrage.destroy(new Error('Zeitgrenze beim Nachsehen ueberschritten'));
    });
  });
}

/**
 * Laedt die Installationsdatei herunter.
 *
 * >>> Warum hier so viel Sorgfalt steckt <<<
 * Was hier herauskommt, wird spaeter als Programm GESTARTET
 * (install-and-restart). Eine halb geladene Datei ist deshalb nicht bloss
 * unbrauchbar, sie ist gefaehrlich. Vorher fehlte dreierlei:
 *
 *   · kein Griff fuer Fehler beim SCHREIBEN – ging die Platte voll,
 *     wurde nichts davon gemeldet,
 *   · resolve() lief los, bevor file.close() fertig war, das Ende der
 *     Datei stand also womoeglich noch gar nicht auf der Platte,
 *   · niemand verglich die geladene Groesse mit der angekuendigten. Riss
 *     die Leitung mitten im Laden ab, galt der Abbruch als Erfolg.
 *
 * Geschrieben wird jetzt in eine Nebendatei und erst am Ende umbenannt –
 * dasselbe Vorgehen wie beim Sichern eines Hefts (save-to-path).
 */
function downloadFile(url, dest, rest = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.part`;

    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        if (rest <= 0) return reject(new Error('Zu viele Weiterleitungen'));
        if (!res.headers.location) return reject(new Error('Weiterleitung ohne Ziel'));
        return downloadFile(res.headers.location, dest, rest - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Status ${res.statusCode}`));
      }

      activeDownloadRes = res;
      isDownloadPaused = false;

      const file = fs.createWriteStream(tmp);
      const total = parseInt(res.headers['content-length'], 10) || 0;
      let downloaded = 0;
      let erledigt = false;

      const abbrechen = (err) => {
        if (erledigt) return;
        erledigt = true;
        activeDownloadRes = null;
        try { res.destroy(); } catch (e) { /* egal */ }
        file.destroy();
        fs.unlink(tmp, () => {});
        reject(err);
      };

      res.on('data', chunk => {
        downloaded += chunk.length;
        if (total > 0 && win && !win.isDestroyed()) {
          try { win.webContents.send('download-progress', { percent: (downloaded / total) * 100, paused: isDownloadPaused }); } catch (e) {}
        }
      });
      res.on('error', abbrechen);
      file.on('error', abbrechen);

      res.pipe(file);

      file.on('close', () => {
        if (erledigt) return;
        activeDownloadRes = null;

        // Abgerissen: dann ist die Datei kuerzer als angekuendigt
        if (total > 0 && downloaded !== total) {
          erledigt = true;
          fs.unlink(tmp, () => {});
          reject(new Error(`Abgebrochen bei ${downloaded} von ${total} Bytes`));
          return;
        }

        try {
          fs.renameSync(tmp, dest);
          erledigt = true;
          resolve();
        } catch (err) {
          abbrechen(err);
        }
      });
    }).on('error', err => {
      activeDownloadRes = null;
      fs.unlink(tmp, () => {}); reject(err);
    });
  });
}
/**
 * @returns {Promise<object|null>} null heisst: es gibt dort nichts
 *   Passendes. Kommt die Anfrage gar nicht durch, WIRFT die Funktion.
 *
 * >>> Warum der Unterschied zaehlt <<<
 * Hier wurde jeder Fehler geschluckt und null zurueckgegeben. "Kein
 * Release" und "nicht nachsehen koennen" waren damit dasselbe, und die
 * Oberflaeche blendete den Knopf in beiden Faellen aus. Der Nutzer erfuhr
 * nie, dass die Pruefung nicht durchgekommen ist - und der einzige Weg
 * zurueck war ein Neustart der App.
 */
async function getLatestGitHubRelease() {
  const data = await fetchJson('https://api.github.com/repos/manuel0anvi/Inkwells/releases/latest');
  if (!data || !data.tag_name) return null;
  const exeAsset = data.assets && data.assets.find(a => a.name.endsWith('.exe'));
  if (!exeAsset) return null;
  return { version: normalizeVersion(data.tag_name), url: exeAsset.browser_download_url, name: exeAsset.name };
}

let win;
let pendingFilePath = null; // File to open when app is ready
let pendingDeepLink = null; // Protocol deep link (inkwells://) received before renderer ready
// Freigabe-Link (inkwells://share/<linkId>), der vor dem Fensterstart ankam
let pendingShareLink = null;

/* Bis wann ein Anmeldefenster STILL bleiben soll. Als Zeitpunkt und nicht
   als Schalter, damit eine Marke, die niemand zurücknimmt, von selbst
   verfällt – sonst bliebe ein späteres, gewolltes Anmeldefenster für
   immer unsichtbar. */
const SILENT_AUTH_MS = 10000;
let stilleAnmeldungBis = 0;

/* ── Zweites Exemplar mit eigenen Daten ───────────────────────────────
   Inkwells läuft normalerweise nur einmal: ein zweiter Start meldet sich
   beim ersten und beendet sich selbst. Das ist richtig so – zwei Fenster
   auf denselben Dateien wären eine Fehlerquelle.

   Zum Ausprobieren der Zusammenarbeit braucht man aber genau das: zwei
   Exemplare nebeneinander, mit ZWEI verschiedenen Konten. Dafür gibt es
   ein eigenes Profil:

       Inkwells.exe --profile=zweite
       set INKWELLS_PROFILE=zweite && Inkwells.exe
       npm start -- --profile=zweite

   Ein Profil bekommt einen eigenen Ordner unter
   %LOCALAPPDATA%\Inkwells\Profiles\<name> – eigene Einstellungen, eigene
   Anmeldung, eigene Heft-Übersicht. Damit ist es für Firebase eine
   andere Person, und man kann sich selbst etwas freigeben.

   Ohne Angabe bleibt alles wie bisher: derselbe Ordner, dieselbe Sperre
   gegen ein zweites Exemplar.
   ─────────────────────────────────────────────────────────────────── */
function readProfileName() {
  const fromArgs = process.argv.find(a => typeof a === 'string' && a.startsWith('--profile='));
  const raw = fromArgs ? fromArgs.slice('--profile='.length) : (process.env.INKWELLS_PROFILE || '');
  // Der Name wird ein Ordnername – nur Unverfängliches durchlassen
  return String(raw).trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

const PROFILE = readProfileName();

/* Die Ablage MUSS vor der Sperre eingerichtet werden: die Sperre hängt am
   Datenordner. Andersherum hätten beide Exemplare dieselbe Sperre, und
   das zweite würde sich beenden, bevor es seinen eigenen Ordner je
   gesehen hätte. */
configureAppStoragePaths();

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

// Handle file open from command line (Windows: "Open with")
function getFileFromArgs(args) {
  // Skip electron executable and script path
  for (const arg of args) {
    // Ohne Ansehen der Schreibung: Windows liefert auch "Heft.JRNL"
    if (/\.jrnl$/i.test(String(arg)) && fs.existsSync(arg)) {
      return arg;
    }
  }
  return null;
}

// Check command line args on startup
pendingFilePath = getFileFromArgs(process.argv);
// Capture any protocol deep-link passed on startup (Windows: first run with protocol)
for (const a of process.argv) {
  if (typeof a === 'string' && a.startsWith('inkwells://')) {
    pendingDeepLink = a;
    console.log('[main] Captured startup deep-link:', pendingDeepLink);
    break;
  }
}

function ensureWritableDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.accessSync(dirPath, fs.constants.W_OK);
  return dirPath;
}

/** Wo dieses Exemplar seine Daten ablegt. Ohne Profil wie eh und je. */
function storageRootFor(profile) {
  const localRoot = process.env.LOCALAPPDATA || app.getPath('temp');
  const base = path.join(localRoot, 'Inkwells');
  return profile ? path.join(base, 'Profiles', profile) : base;
}

/* ══════════════════════════════════════════════════════════════════════
   UMZUG VON "Inkwell" NACH "Inkwells"

   Die App hiess bis 1.1.1 Inkwell und legte ihre Sachen unter
   %LOCALAPPDATA%\Inkwell ab. Wer aktualisiert, haette danach in einen
   leeren Ordner geschaut: Hefte, Einstellungen und Anmeldung waeren
   scheinbar weg - in Wahrheit nur unerreichbar.

   Deshalb wird EINMAL umgezogen, bevor irgendetwas den Ordner anfasst.

   >>> Warum umbenennen und nicht kopieren <<<
   Ein Kopiervorgang laesst zwei Staende nebeneinander liegen. Wer danach
   einmal die alte Fassung startet, schreibt in den alten - und beim
   naechsten Start der neuen ist diese Aenderung nicht da. Umbenennen
   kennt diesen Zustand nicht.

   >>> Warum bei Misserfolg nichts geloescht wird <<<
   Schlaegt der Umzug fehl (Ordner offen, Virenwaechter, volle Platte),
   bleibt der alte Stand unangetastet liegen. Die App startet dann mit
   leerem Ordner - aergerlich, aber nichts ist verloren, und ein zweiter
   Versuch beim naechsten Start kann noch gelingen.
   ══════════════════════════════════════════════════════════════════════ */

/** Benennt eine Datei um, wenn es sie gibt. Fehler sind nicht schlimm. */
function benenneUm(vonPfad, nachPfad) {
  try {
    if (fs.existsSync(vonPfad) && !fs.existsSync(nachPfad)) {
      fs.renameSync(vonPfad, nachPfad);
      return true;
    }
  } catch (err) {
    console.warn('[Umzug] ' + path.basename(vonPfad) + ':', err.message);
  }
  return false;
}

/**
 * Holt den Datenordner der Fassungen bis 1.1.1 herueber.
 * Tut nichts, wenn es den neuen Ordner schon gibt oder den alten nicht.
 */
/**
 * @returns {string|null} der Ordner, mit dem dieser Lauf arbeiten soll,
 *   wenn er vom Ueblichen abweicht. Das ist genau ein Fall: der Umzug
 *   ist gescheitert, und die alten Daten liegen noch drueben.
 */
function migriereAltenDatenordner() {
  if (process.platform !== 'win32') return null;

  const localRoot = process.env.LOCALAPPDATA;
  if (!localRoot) return null;

  const alt = path.join(localRoot, 'Inkwell');
  const neu = path.join(localRoot, 'Inkwells');

  try {
    if (fs.existsSync(neu)) return null;      // schon umgezogen
    if (!fs.existsSync(alt)) return null;     // nichts da, frische Installation

    fs.renameSync(alt, neu);
    console.log('[Umzug] Datenordner Inkwell -> Inkwells');
  } catch (err) {
    /* ══════════════════════════════════════════════════════════════════
       EIN GESCHEITERTER UMZUG DARF SICH NICHT SELBST BEGRABEN

       Hier stand nur ein return. Danach legte configureAppStoragePaths
       den NEUEN Ordner trotzdem an – und beim naechsten Start war
       "neuer Ordner vorhanden" die Abbruchbedingung oben. Der Umzug fand
       also nie wieder statt, obwohl er nie stattgefunden hatte.

       Fuer den Nutzer heisst das: Einstellungen, Anmeldung und Uebersicht
       aus der Zeit vor 1.1.2 bleiben dauerhaft unerreichbar. Geloescht
       ist nichts, aber der im Kommentar versprochene "zweite Anlauf"
       kommt nie.

       Deshalb arbeitet dieser Lauf mit dem ALTEN Ordner weiter. Es wird
       nichts Neues angelegt, nichts geht verloren, und der naechste Start
       versucht es wieder – dann vielleicht ohne die Dateisperre, an der
       es gerade lag.
       ══════════════════════════════════════════════════════════════════ */
    console.error('[Umzug] Datenordner blieb liegen, dieser Lauf bleibt beim alten:',
      err.message);
    return alt;
  }

  /* Die Dateien darin tragen den Namen ebenfalls. Sie liegen im
     UserData-Ordner des Hauptexemplars UND in jedem Profil darunter. */
  const ordner = [path.join(neu, 'UserData')];
  try {
    const profile = path.join(neu, 'Profiles');
    if (fs.existsSync(profile)) {
      for (const name of fs.readdirSync(profile)) {
        ordner.push(path.join(profile, name, 'UserData'));
      }
    }
  } catch (err) { /* dann eben nur das Hauptexemplar */ }

  let umbenannt = 0;
  for (const userData of ordner) {
    for (const kurz of ['settings', 'registry', 'papierkorb']) {
      if (benenneUm(path.join(userData, 'inkwell-' + kurz + '.json'),
                    path.join(userData, 'inkwells-' + kurz + '.json'))) umbenannt++;
    }
  }
  if (umbenannt) console.log('[Umzug]', umbenannt, 'Dateien umbenannt');

  /* Zum Schluss die Pfade IN den Dateien. saveLocation und die Eintraege
     der Uebersicht stehen dort absolut; zeigt einer davon in den alten
     Ordner, findet die App die Hefte sonst nicht mehr. */
  for (const userData of ordner) {
    for (const datei of ['inkwells-settings.json', 'inkwells-registry.json']) {
      const voll = path.join(userData, datei);
      try {
        if (!fs.existsSync(voll)) continue;
        const roh = fs.readFileSync(voll, 'utf-8');

        /* Nur den Ordnernamen tauschen, nicht jedes Vorkommen von "Inkwell".

           >>> Und zwar in BEIDEN Schreibweisen <<<
           In der JSON-Datei steht der Pfad mit verdoppelten Trennzeichen
           ("C:\\\\Users\\\\...\\\\Inkwell"), weil JSON den Backslash
           maskiert. Ein Vergleich mit dem einfachen Pfad findet dort gar
           nichts - der Eintrag bliebe stehen und die Uebersicht zeigte
           auf einen Ordner, den es nicht mehr gibt. Genau das hat der
           Test in scripts/test-umzug.js aufgedeckt.

           Erst die maskierte Form, dann die einfache: nach dem ersten
           Durchgang kann die einfache nicht mehr versehentlich greifen. */
        const maskiert = (p) => JSON.stringify(p).slice(1, -1);
        const neuRoh = roh
          .split(maskiert(alt)).join(maskiert(neu))
          .split(alt).join(neu);
        if (neuRoh !== roh) {
          fs.writeFileSync(voll, neuRoh, 'utf-8');
          console.log('[Umzug] Pfade angepasst in', datei);
        }
      } catch (err) {
        console.warn('[Umzug] Pfade in ' + datei + ':', err.message);
      }
    }
  }
}

function configureAppStoragePaths() {
  if (process.platform !== 'win32') return;

  // MUSS vor dem ersten Zugriff stehen, sonst legt ensureWritableDir
  // einen leeren neuen Ordner an und der Umzug findet ihn schon vor.
  const ausweichOrdner = migriereAltenDatenordner();

  /* Der Umzug ist gescheitert: dann bleibt dieser Lauf beim alten Ordner,
     statt einen neuen anzulegen und den naechsten Anlauf damit fuer immer
     auszuschliessen (siehe migriereAltenDatenordner). */
  const storageRoot = ausweichOrdner
    ? (PROFILE ? path.join(ausweichOrdner, 'Profiles', PROFILE) : ausweichOrdner)
    : storageRootFor(PROFILE);

  const userDataDir = ensureWritableDir(path.join(storageRoot, 'UserData'));
  const cacheDir = ensureWritableDir(path.join(storageRoot, 'Cache'));

  app.setPath('userData', userDataDir);
  app.setPath('sessionData', cacheDir);
  app.commandLine.appendSwitch('user-data-dir', userDataDir);
  app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.disableHardwareAcceleration();
}

/* ══════════════════════════════════════════════════════════════════════
   OBERFLÄCHE ÜBER EINEN ÖRTLICHEN SERVER

   Die Oberfläche lag früher unter file://. Das hat einen Haken, der von
   außen nicht zu sehen ist: eine file://-Seite hat die Herkunft "null",
   und Firebase lässt seinen eigenen Anmeldeablauf nur von erlaubten
   Herkünften aus zu (localhost, inkwell-53ab9.firebaseapp.com,
   inkwell-53ab9.web.app). Die Anmeldung bei Microsoft ging dadurch
   überhaupt nicht – siehe CLOUD_SETUP.md, Abschnitt C5.

   Deshalb wird src/ jetzt örtlich ausgeliefert. Der Server hört
   ausschließlich auf 127.0.0.1 und gibt nur Dateien aus src/ heraus.
   ══════════════════════════════════════════════════════════════════════ */

let uiServer = null;
let uiOrigin = null;

const UI_ROOT = path.join(__dirname, 'src');

const UI_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm'
};

/* ── Content-Security-Policy der Oberflaeche ──────────────────────────

   >>> ACHTUNG: es gibt sie ZWEIMAL <<<
   Hier als Kopfzeile, und in src/index.html noch einmal als <meta>. Der
   Browser wendet BEIDE an, und die strengere gewinnt - eine Erlaubnis
   nur an einer Stelle bringt gar nichts.

   Genau daran ist die Zusammenarbeit gescheitert: die Realtime Database
   wurde im <meta> freigegeben, hier nicht, und der Rueckfallweg der
   Datenbank (Long-Polling laedt <script src=".lp?...">) blieb weiter
   gesperrt. Die Meldung in der Konsole nannte die Regel von HIER, was
   wie ein unwirksamer Fix aussah.

   scripts/test-csp-rtdb.js haelt beide Stellen gegen die Adresse aus
   share.js.
   Zweite Schicht unter der Bereinigung des Seitentextes
   (src/core/sanitize.js). Die Bereinigung ist die eigentliche
   Absicherung; hier steht, was selbst dann noch nicht geht, wenn sie
   einmal eine Luecke haette.

   >>> Warum connect-src so weit bleibt <<<
   Die App redet mit Google Drive, Microsoft Graph, Firestore, der
   Realtime Database und beiden Anmeldediensten – teils ueber Adressen,
   die die Bibliotheken selbst zusammensetzen. Eine enge Liste haette
   genau eine Art von Fehler zur Folge: die Cloud faellt still aus, und
   zwar erst beim Nutzer. Eingeschraenkt wird deshalb das, was einem
   eingeschleusten Schnipsel wirklich nuetzt:

     · script-src   kein <script src="https://fremd"> mehr
     · object-src   keine Plugins
     · base-uri     kein <base>, das alle relativen Pfade umbiegt
     · form-action  kein Formular, das Daten nach aussen schickt

   Wer connect-src spaeter enger fassen will, muss vorher Anmeldung,
   Hochladen und ein geteiltes Dokument einmal wirklich durchspielen.

   >>> Warum apis.google.com dabeisteht <<<
   Die Microsoft-Anmeldung bei Firebase laeuft ueber signInWithPopup
   (core/share.js). Firebase nimmt die Antwort aus dem Fenster aber nicht
   direkt entgegen, sondern ueber einen versteckten Rahmen auf
   inkwell-53ab9.firebaseapp.com/__/auth/iframe - und diesen Rahmen baut
   es mit GAPI auf, das es als https://apis.google.com/js/api.js
   nachlaedt. Ohne die Freigabe kommt in der Konsole eine CSP-Meldung
   ueber api.js und danach auth/internal-error: der Fehler nennt Google,
   obwohl es um die Anmeldung bei MICROSOFT geht. Beides wird gebraucht,
   script-src fuer api.js und frame-src fuer den Rahmen, den es setzt. */
const UI_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://accounts.google.com https://apis.google.com https://*.firebasedatabase.app https://*.firebaseio.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' https: wss:; frame-src https://*.firebaseapp.com https://accounts.google.com https://apis.google.com https://login.microsoftonline.com https://*.firebasedatabase.app; object-src 'none'; base-uri 'self'; form-action 'none'";

function startUiServer() {
  return new Promise((resolve, reject) => {
    uiServer = http.createServer((req, res) => {
      let rel;
      try {
        rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      } catch (err) {
        res.writeHead(400); res.end('Bad request'); return;
      }
      if (rel === '/') rel = '/index.html';

      /* Unterlagen kommen NICHT aus src/, sondern von irgendwo auf der
         Platte. Sie haben deshalb ihren eigenen Weg – siehe
         griffAusliefern() weiter unten. */
      if (rel.startsWith('/griff/')) { griffAusliefern(rel, req, res); return; }

      /* Nichts außerhalb von src/ herausgeben. path.resolve löst "..\" auf,
         der Vergleich danach fängt jeden Ausbruch ab. */
      const abs = path.resolve(UI_ROOT, '.' + rel);
      if (abs !== UI_ROOT && !abs.startsWith(UI_ROOT + path.sep)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      fs.readFile(abs, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Nicht gefunden: ' + rel);
          return;
        }
        res.writeHead(200, {
          'Content-Type': UI_MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
          // Sonst zeigt die App nach einem Update noch die alten Dateien
          'Cache-Control': 'no-store',
          'Content-Security-Policy': UI_CSP
        });
        res.end(data);
      });
    });

    /* >>> Der Port muss über Neustarts hinweg derselbe bleiben <<<
       Hier stand Port 0, also jedes Mal ein anderer freier Port. Damit
       änderte sich die HERKUNFT der Oberfläche bei jedem Start –
       http://localhost:54321, beim nächsten Mal :54987. Firebase legt
       seine Anmeldung im localStorage ab, und der gehört zur Herkunft:
       die Microsoft-Anmeldung für die geteilten Dokumente war nach jedem
       Neustart weg und musste von Hand wiederholt werden.

       Der Port hängt am Profilnamen, damit ein zweites Exemplar nicht in
       dasselbe Loch greift. Ist er trotzdem belegt, weicht der Server auf
       einen freien aus – dann ist es wie vorher, aber die App startet.

       Gebunden wird auf "localhost", nicht auf 127.0.0.1: unter Windows
       löst localhost oft zuerst auf ::1 auf. Wäre nur 127.0.0.1 gebunden,
       liefe die Oberfläche ins Leere. Der Name muss außerdem localhost
       bleiben – nur der steht in Firebases Liste erlaubter Herkünfte. */
    const listen = (port, onError) => {
      const onListening = () => {
        uiServer.off('error', onError);
        uiOrigin = `http://localhost:${uiServer.address().port}`;
        console.log('[UI] Oberfläche liegt unter', uiOrigin);
        resolve(uiOrigin);
      };
      uiServer.once('listening', onListening);
      uiServer.once('error', (err) => {
        uiServer.off('listening', onListening);
        onError(err);
      });
      uiServer.listen(port, 'localhost');
    };

    listen(preferredUiPort(), (err) => {
      if (err?.code !== 'EADDRINUSE') return reject(err);
      console.warn('[UI] Bevorzugter Port belegt – es wird ein freier genommen. Die '
        + 'Microsoft-Anmeldung für geteilte Dokumente gilt dann nur für diesen Start.');
      listen(0, reject);
    });
  });
}

/**
 * Immer derselbe Port für dasselbe Profil.
 *
 * Gewählt aus dem Bereich für kurzlebige Verbindungen, damit nichts
 * Bekanntes im Weg steht. Der Profilname geht als einfache Streuung ein –
 * es geht nur darum, dass zwei Profile nicht denselben Port wollen.
 */
function preferredUiPort() {
  let hash = 0x811c9dc5;
  for (const ch of `inkwells-ui:${PROFILE || ''}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 49200 + (hash % 600);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 820, minHeight: 600,
    // Mit Profil steht der Name im Fenstertitel – sonst sind zwei
    // Exemplare in der Taskleiste nicht auseinanderzuhalten.
    title: PROFILE ? `Inkwells — ${PROFILE}` : 'Inkwells',
    // Use default frame on Windows — our custom titlebar sits inside the window
    frame: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#12121a',
    show: false, // wait for ready-to-show
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  /* Die Seite trägt <title>Inkwells</title> und überschreibt damit den
     Titel, den das Fenster mitbekommen hat. Bei einem Profil muss der
     Name aber stehen bleiben – sonst heißen beide Fenster gleich. */
  if (PROFILE) {
    win.on('page-title-updated', (event) => {
      event.preventDefault();
      win.setTitle(`Inkwells — ${PROFILE}`);
    });
  }

  win.loadURL(`${uiOrigin}/index.html`);
  Menu.setApplicationMenu(null);

  /* Ohne das pruefte Chromium bis zur ersten Meldung aus der Oberflaeche
     in der Sprache des Systems – auf einem italienischen Rechner also
     eine Seite lang alles rot. */
  setzeRechtschreibung('');

  /* Firebase öffnet für die Anmeldung ein Fenster auf seiner eigenen
     Adresse und redet per postMessage mit uns zurück. Electron blockt
     window.open ohne diese Freigabe – die Anmeldung bliebe stumm hängen.
     Freigegeben wird ausschließlich Firebases Anmeldehelfer.

     >>> Warum das Fenster vorher schwarz war <<<
     Es ging sofort auf, mit der dunklen Hintergrundfarbe der App, und
     blieb so, bis Microsofts Anmeldeseite geladen war – über eine
     langsame Leitung sekundenlang. Jetzt bleibt es unsichtbar, bis
     wirklich etwas zu sehen ist, und die Farbe darunter ist hell wie die
     Seite selbst. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/[a-z0-9-]+\.firebaseapp\.com\/__\/auth\//i.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 700,
          parent: win, modal: false, center: true,
          autoHideMenuBar: true, minimizable: false, maximizable: false,
          title: 'Bei Microsoft anmelden',
          backgroundColor: '#ffffff',
          show: false,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        }
      };
    }
    // Alles andere gehört in den Standardbrowser, nicht in die App
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  /* Mit show:false muss jemand das Fenster zeigen – das ist hier. Der
     Titel wird festgehalten: die Anmeldeseiten setzen unterwegs ihre
     eigenen, teils technischen Überschriften.

     >>> Ausser bei einem stillen Versuch <<<
     Beim Start probiert die App die Microsoft-Anmeldung mit prompt=none
     (signInMicrosoftSilently). Firebase macht auch dafür sein Fenster
     auf – sichtbar wäre das ein Aufblitzen bei jedem Start, für etwas,
     das den Nutzer nichts angeht. Also bleibt es zu, und wenn nach der
     Zeitgrenze nichts geschehen ist, wird es geschlossen: ein
     unsichtbares Fenster, das auf eine Eingabe wartet, kann niemand
     bedienen. */
  win.webContents.on('did-create-window', (child) => {
    if (stilleAnmeldungBis > Date.now()) {
      setTimeout(() => { if (!child.isDestroyed()) child.close(); }, SILENT_AUTH_MS);
      return;
    }
    child.once('ready-to-show', () => child.show());
    // Falls die Seite gar nicht lädt, soll das Fenster trotzdem erscheinen
    setTimeout(() => { if (!child.isDestroyed() && !child.isVisible()) child.show(); }, 4000);
    child.on('page-title-updated', (event) => {
      event.preventDefault();
      child.setTitle('Bei Microsoft anmelden');
    });
  });

  /* ══ IMMER MAXIMIERT STARTEN ═════════════════════════════════════
     Hier stand win.maximize() gleich nach dem Anlegen, also an einem
     noch UNSICHTBAREN Fenster. Unter Windows zeigt Electron es dabei
     schon an – und das show() aus ready-to-show traf dann ein Fenster,
     dessen Zustand je nach Zeitpunkt noch nicht als maximiert galt. Es
     ging dann in der normalen Groesse auf, nicht jedes Mal, aber oft
     genug, um aufzufallen.

     Jetzt geschieht beides an derselben Stelle, wenn die Seite steht:
     maximieren, zeigen, und falls das System es doch zurueckgenommen
     hat, noch einmal nachfassen. */
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.maximize();
    if (!win.isVisible()) win.show();
    if (!win.isMaximized()) win.maximize();
    meldeFensterzustand();
  });

  /* Der Knopf in der eigenen Titelleiste zeigt ein Quadrat oder zwei
     (ui/titlebar.js). Er muss es auch erfahren, wenn das Fenster ueber
     Windows selbst maximiert wird – Doppelklick, Snap, Win+Pfeil. */
  const meldeFensterzustand = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('fenster-maximiert', win.isMaximized());
  };
  win.on('maximize', meldeFensterzustand);
  win.on('unmaximize', meldeFensterzustand);
  win.on('restore', meldeFensterzustand);
  win.webContents.on('did-finish-load', meldeFensterzustand);

  // Log renderer console to terminal
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  /* Entwicklerwerkzeuge mit F12 bzw. Strg+Umschalt+I.
     Nötig, weil Menu.setApplicationMenu(null) weiter oben nicht nur das
     Menü entfernt, sondern auch Electrons eingebaute Tastenkürzel – und
     damit war die Konsole überhaupt nicht mehr erreichbar. Der Griff über
     before-input-event kommt vor der Oberfläche dran, es kann sie also
     auch kein Kürzel der App wegfangen. */
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const wanted = key === 'f12' || (input.control && input.shift && key === 'i');
    if (!wanted) return;
    win.webContents.toggleDevTools();
    event.preventDefault();
  });

  // Vor dem Schließen bekommt die Oberfläche Gelegenheit, offene Änderungen
  // zu speichern. Ein beforeunload-Handler im Renderer taugt dafür nicht:
  // dort kann nicht auf asynchrones Speichern gewartet werden.
  win.on('close', (event) => {
    if (allowClose) return;

    event.preventDefault();
    /* >>> Ein Abbruch ist eine Antwort, kein Ausbleiben <<<
       Hier stand .then(forceClose) ohne Ansehen des Ergebnisses. Konnte
       die Oberflaeche ein Heft nicht speichern, schloss die App trotzdem
       - gerade in dem Augenblick, in dem sie es haette retten sollen.
       Sagt sie jetzt "nicht schliessen", bleibt das Fenster offen. */
    bitteSpeichern().then((ergebnis) => {
      if (ergebnis === 'abbruch') {
        console.log('[Quit] Die Oberflaeche haelt das Beenden auf');
        return;
      }
      forceClose();
    });
  });
}

// Steuert, ob win.on('close') noch einmal abbricht, um speichern zu lassen
let allowClose = false;
let closeFallbackTimer = null;
let speicherFertig = null;   // loest die laufende Bitte auf (siehe unten)
let quitAbbrechen = null;    // dasselbe, aber mit "nicht schliessen"
let quitAnhalten = null;     // haelt die Zeitgrenze an, solange gefragt wird

function forceClose() {
  clearTimeout(closeFallbackTimer);
  allowClose = true;
  if (win && !win.isDestroyed()) win.close();
}

/**
 * Bittet die Oberfläche, alles Offene zu sichern, und wartet darauf.
 *
 * >>> Warum das eine eigene Funktion ist <<<
 * Es gibt ZWEI Wege aus der App: das Fenster zumachen und „Update
 * installieren". Der zweite ging bisher an dieser Bitte vorbei – er
 * setzte allowClose und rief app.quit(), womit der close-Handler sofort
 * aussteigt. Wer beim Aktualisieren gerade noch getippt hatte, verlor
 * die letzten Sekunden: automatisch gespeichert wird erst zwei Sekunden
 * nach der letzten Änderung.
 *
 * Jetzt nehmen beide denselben Weg.
 *
 * Die Zeitgrenze ist großzügig: erst wird örtlich gespeichert (ohne
 * Grenze, das hat Vorrang), danach bekommen geteiltes Dokument, Cloud
 * und der Live-Raum zusammen noch einige Sekunden – siehe core/init.js.
 *
 * @returns {Promise<'fertig'|'abbruch'|'zeit'>} auch dann erfüllt, wenn
 *   niemand antwortet. 'abbruch' heißt: die Oberfläche will NICHT, dass
 *   geschlossen wird – etwa weil ein Heft nicht gespeichert werden konnte.
 */
function bitteSpeichern(timeoutMs = 8000) {
  if (!win || win.isDestroyed()) return Promise.resolve('fertig');

  return new Promise((resolve) => {
    let erledigt = false;
    const fertig = (ausgang, grund) => {
      if (erledigt) return;
      erledigt = true;
      speicherFertig = null;
      quitAbbrechen = null;
      quitAnhalten = null;
      clearTimeout(closeFallbackTimer);
      if (grund) console.warn('[Quit]', grund);
      resolve(ausgang);
    };

    speicherFertig = () => fertig('fertig', null);
    quitAbbrechen = () => fertig('abbruch', null);

    /* ══════════════════════════════════════════════════════════════
       SOLANGE DER NUTZER GEFRAGT WIRD, LÄUFT KEINE UHR

       Die Zeitgrenze unten ist dafür da, dass eine hängende oder
       abgestürzte Oberfläche das Beenden nicht für immer aufhält. Ein
       Rückfragefenster ist aber das Gegenteil davon: dort wartet die
       App auf einen Menschen, und acht Sekunden sind zu knapp, um eine
       Frage zu lesen. Ohne diese Möglichkeit hätte der Fallback genau
       die Entscheidung überfahren, um die gerade gebeten wird.
       ══════════════════════════════════════════════════════════════ */
    quitAnhalten = () => clearTimeout(closeFallbackTimer);

    try {
      win.webContents.send('app-before-quit');
    } catch (err) {
      fertig('fertig', 'Renderer nicht erreichbar: ' + err.message);
      return;
    }

    // Antwortet die Oberfläche nicht (hängt/abgestürzt), trotzdem weiter
    closeFallbackTimer = setTimeout(
      () => fertig('zeit', 'Keine Antwort beim Speichern, weiter nach Zeitablauf'),
      timeoutMs
    );
  });
}

// Die Oberfläche meldet: alles gespeichert
ipcMain.on('confirm-quit', () => {
  if (speicherFertig) speicherFertig();
  else forceClose();     // kam ohne laufende Bitte – dann eben direkt
});

/* Die Oberfläche meldet: bitte NICHT schließen. Es ist etwas offen, das
   nicht gespeichert werden konnte, und der Nutzer hat sich dagegen
   entschieden, es aufzugeben. */
ipcMain.on('cancel-quit', () => {
  if (quitAbbrechen) quitAbbrechen();
});

/* Die Oberfläche fragt gerade nach – die Zeitgrenze darf nicht
   dazwischenfunken. Siehe bitteSpeichern(). */
ipcMain.on('quit-hold', () => {
  if (quitAnhalten) quitAnhalten();
});

/* ── Der eigene Updater und der Microsoft Store ──────────────────────
   Aus dem Store installiert Windows die App als versiegeltes Paket unter
   Program Files\WindowsApps. Dort kann der NSIS-Installierer nichts
   ersetzen - er wuerde stattdessen eine zweite Installation unter
   LOCALAPPDATA anlegen. Der Nutzer haette Inkwells dann doppelt, mit
   getrennten Heften, und wuesste nicht warum.

   Der Riegel steht hier UND in src/ui/update.js. Doppelt, weil die
   Oberflaeche aus einer aelteren Fassung stammen kann: der Knopf waere
   dann noch da, und ohne diese Pruefung liefe der Installierer los. */
const STOREFASSUNG = process.windowsStore === true;

// IPC handlers for update control
ipcMain.handle('check-for-updates', async () => {
  if (STOREFASSUNG) return { ok: true, updateInfo: null };
  try {
    const release = await getLatestGitHubRelease();
    if (!release) return { ok: true, updateInfo: null };
    const currentStatus = normalizeVersion(app.getVersion());
    if (compareVersions(release.version, currentStatus) > 0) {
      releaseInfo = release;
      try { win.webContents.send('update-available', { version: release.version }); } catch (e) {}
      return { ok: true, updateInfo: { version: release.version } };
    }
    return { ok: true, updateInfo: null };
  } catch (err) {
    return { ok: false, err: String(err) };
  }
});

ipcMain.handle('download-update', async () => {
  if (STOREFASSUNG) return { ok: false, err: 'Store-Fassung: Updates kommen ueber den Store' };
  if (!releaseInfo) return { ok: false, err: 'No update available to download' };
  try {
    const tempDir = app.getPath('temp');
    downloadedUpdatePath = path.join(tempDir, releaseInfo.name);
    await downloadFile(releaseInfo.url, downloadedUpdatePath);
    try { win.webContents.send('update-downloaded', { version: releaseInfo.version }); } catch (e) {}
    return { ok: true };
  } catch (err) {
    return { ok: false, err: String(err) };
  }
});

ipcMain.handle('toggle-download-pause', () => {
  if (!activeDownloadRes) return { ok: false, err: 'No active download' };
  isDownloadPaused = !isDownloadPaused;
  if (isDownloadPaused) {
    activeDownloadRes.pause();
  } else {
    activeDownloadRes.resume();
  }
  return { ok: true, paused: isDownloadPaused };
});

ipcMain.handle('install-and-restart', async () => {
  if (STOREFASSUNG) return { ok: false, err: 'Store-Fassung: Updates kommen ueber den Store' };
  if (!downloadedUpdatePath || !fs.existsSync(downloadedUpdatePath)) return { ok: false, err: 'Update file not found' };
  try {
    /* >>> Erst sichern, DANN den Installierer starten <<<
       Hier stand nur allowClose = true und app.quit() – der close-
       Handler stieg damit sofort aus, ohne die Oberfläche zu fragen. Wer
       gerade noch getippt hatte, verlor die letzten Sekunden.

       Die Reihenfolge ist ebenfalls wichtig: der Installierer lief
       vorher ZUERST los. Er ersetzt Dateien im Programmordner, während
       die App noch schreibt – das ist ein Rennen, das man nicht braucht. */
    /* Sagt die Oberflaeche "nicht schliessen", wird auch nicht
       aktualisiert: der Installierer beendet die App, und ungesicherte
       Arbeit waere genauso weg wie beim gewoehnlichen Schliessen. */
    if (await bitteSpeichern() === 'abbruch') {
      return { ok: false, err: 'QUIT_CANCELLED' };
    }

    spawn(downloadedUpdatePath, ['/S', '/force-run'], { detached: true, stdio: 'ignore' }).unref();
    // Ohne dieses Flag würde der close-Handler das Beenden abbrechen
    allowClose = true;
    app.quit();
    return { ok: true };
  } catch (err) {
    return { ok: false, err: String(err) };
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

/* ══════════════════════════════════════════════════════════════════════
   EINE CHAT-NACHRICHT, WÄHREND INKWELLS IM HINTERGRUND LIEGT

   Wer zu zweit an einem Heft schreibt, hat Inkwells nicht dauernd vorne.
   Eine Nachricht kam bisher nur im Fenster an – man sah sie, wenn man
   ohnehin schon hinsah, und sonst nie.

   >>> Warum die Entscheidung HIER faellt und nicht in der Oberflaeche <<<
   Ob das Fenster gerade vorne ist, weiss nur der Hauptprozess sicher.
   `document.hasFocus()` im Fenster sagt es zwar auch, aber es sagt
   nichts darueber, ob das Fenster minimiert ist oder auf einem anderen
   Schreibtisch liegt. Und eine Meldung, die aufpoppt, waehrend man das
   Gespraech offen vor sich hat, ist genau die Sorte Laerm, wegen der
   Leute Meldungen abschalten.

   Zurueckgemeldet wird, ob wirklich gemeldet wurde – die Oberflaeche
   braucht das nicht, aber die Pruefung schon.
   ══════════════════════════════════════════════════════════════════════ */
ipcMain.handle('notify-chat', (_, daten = {}) => {
  if (!Notification.isSupported()) return false;
  // Vorne und nicht minimiert: dann sieht man die Nachricht ohnehin
  if (win && !win.isDestroyed() && win.isFocused() && !win.isMinimized()) return false;

  const titel = String(daten.title || 'Inkwells').slice(0, 120);
  const text = String(daten.body || '').slice(0, 300);
  if (!text) return false;

  try {
    const meldung = new Notification({ title: titel, body: text, silent: false });
    /* Ein Klick holt das Heft nach vorn. Ohne das muesste man die
       Meldung lesen und danach das Fenster selbst suchen. */
    meldung.on('click', () => {
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('chat-notification-clicked');
    });
    meldung.show();
    return true;
  } catch (err) {
    console.warn('[Meldung] Nicht angezeigt:', err.message);
    return false;
  }
});

/* Der nächste Anmeldeversuch läuft ohne Zutun – das Fenster dazu bleibt
   unsichtbar. Siehe did-create-window weiter oben. */
ipcMain.on('silent-auth', (_, an) => {
  stilleAnmeldungBis = an ? Date.now() + SILENT_AUTH_MS : 0;
});

/* ══════════════════════════════════════════════════════════════════════
   IN WELCHER SPRACHE DIE ROTE WELLENLINIE PRUEFT

   >>> Hier war auf einem italienischen Rechner alles rot <<<
   Gemeldet: „auf Italienisch wird der Text im Dokument als falsch
   angezeigt, dasselbe mit Englisch, wenn man auf Deutsch schreibt."
   Der Grund: Chromium nimmt ungefragt die Sprache des Betriebssystems.
   Wer darin Deutsch schreibt, hat unter jedem zweiten Wort eine rote
   Welle – und die kommt nicht von einem Fehler, sondern vom falschen
   Woerterbuch.

   Das `lang`-Merkmal am Textfeld hilft dabei NICHT: Chromium liest es
   fuer die Rechtschreibung nicht aus, es entscheidet allein hier.

   >>> Warum mehrere Sprachen zugleich <<<
   Chromium kann gegen mehrere Woerterbuecher pruefen und markiert nur,
   was in KEINEM steht. Genau das ist hier richtig: die App gibt es auf
   Deutsch, Englisch und Italienisch, und wer sie auf Italienisch
   bedient, schreibt darin trotzdem womoeglich deutsche Notizen. Die
   eingestellte Sprache steht vorn – bei einem Wort, das es in mehreren
   gibt, entscheidet die Reihenfolge ueber die Vorschlaege.

   Auf macOS geht das an die Rechtschreibpruefung des Systems und wird
   dort still uebergangen; das ist in Ordnung, dort stellt der Nutzer
   sie selbst ein.
   ══════════════════════════════════════════════════════════════════════ */
const SPRACH_WOERTERBUCH = { de: 'de', en: 'en-US', it: 'it' };

function setzeRechtschreibung(sprache) {
  if (!win || win.isDestroyed()) return;
  const ses = win.webContents.session;
  if (typeof ses.setSpellCheckerLanguages !== 'function') return;

  const gewuenscht = [];
  const zuerst = SPRACH_WOERTERBUCH[sprache];
  if (zuerst) gewuenscht.push(zuerst);
  for (const code of Object.values(SPRACH_WOERTERBUCH)) {
    if (!gewuenscht.includes(code)) gewuenscht.push(code);
  }

  /* Nur nehmen, was dieser Build wirklich mitbringt – eine unbekannte
     Kennung laesst setSpellCheckerLanguages werfen, und dann bliebe gar
     keine Pruefung uebrig. */
  let moeglich = [];
  try { moeglich = ses.availableSpellCheckerLanguages || []; } catch (err) { moeglich = []; }
  const liste = moeglich.length ? gewuenscht.filter(c => moeglich.includes(c)) : gewuenscht;
  if (!liste.length) return;

  try { ses.setSpellCheckerLanguages(liste); }
  catch (err) { console.warn('[Rechtschreibung] Nicht gesetzt:', err.message); }
}

ipcMain.on('spell-language', (_, sprache) => setzeRechtschreibung(String(sprache || '')));

/* Nur das Netz und die Post, nichts von der Platte.
   shell.openExternal reicht ALLES an das Betriebssystem weiter – auch
   file:///…, einen Netzpfad oder ein fremdes Protokoll. Hier kommt zwar
   nur die Anmeldeadresse an (core/cloudSync.js), aber die Bruecke selbst
   nahm bisher jeden Wert. Das ist dieselbe zweite Schicht, die es fuer
   die Dateizugriffe schon gibt: die Oberflaeche soll auch dann nichts
   anrichten koennen, wenn in ihr einmal fremder Code laeuft.

   >>> Warum mailto: dazugehoert <<<
   Ein Verweis auf eine Mailadresse ist an DREI Stellen ausdruecklich
   vorgesehen: ui/links.js macht aus "wer@wo.de" von selbst ein
   mailto:, core/sanitize.js laesst das Schema durch, damit der Verweis
   das Speichern und das Teilen uebersteht, und zielText() zeigt ihn
   ohne das mailto: davor an. Nur hier fiel er durch – ein Mailverweis
   tat in der App also gar nichts, wortlos. Im Browser ging derselbe
   Verweis (dort gibt es kein window.api, und window.open uebernimmt).

   inkwells: bleibt bewusst DRAUSSEN. Was die App selbst kennt – eine
   Seite im Heft, ein Freigabe-Link – faengt folge() in ui/links.js
   vorher ab. Alles andere waere ein Protokoll-Aufruf, den sich ein
   fremdes Heft ausdenken koennte. */
const EXTERN_ERLAUBT = new Set(['https:', 'http:', 'mailto:']);

ipcMain.handle('open-external', async (_, url) => {
  let ziel;
  try { ziel = new URL(String(url)); }
  catch (err) { console.error('[Extern] Keine gueltige Adresse:', url); return false; }

  if (!EXTERN_ERLAUBT.has(ziel.protocol)) {
    console.error('[Sicherheit] Nur http/https/mailto – abgelehnt:', ziel.protocol);
    return false;
  }

  try {
    await shell.openExternal(ziel.href);
  } catch (err) {
    console.error('[Extern] Konnte nicht geoeffnet werden:', err.message);
    return false;
  }

  holeBrowserNachVorn();
  return true;
});

/* ══════════════════════════════════════════════════════════════════════
   DEN BROWSER WIRKLICH NACH VORN HOLEN

   shell.openExternal oeffnet die Seite verlaesslich – aber unter Windows
   blieb Inkwells davor stehen, und der Reiter ging unsichtbar im
   Hintergrund auf.

   >>> Warum das so ist <<<
   Windows laesst nur das Programm, das gerade VORNE ist, ein anderes
   nach vorne holen. Laeuft der Browser schon, reicht der Aufruf bloss
   eine Adresse an das bestehende Exemplar weiter – und das hat dieses
   Recht nicht. Der Reiter entsteht, das Fenster bleibt hinten.

   >>> Was NICHT funktioniert hat <<<
   win.blur(). Damit gibt Inkwells den Vordergrund ab, aber Windows
   vergibt ihn dann nach der Stapelreihenfolge – man landete in dem
   Programm, das VOR Inkwells dran war, und der Browser blieb hinten.
   Genau so wurde es gemeldet.

   >>> Was funktioniert <<<
   Das Browserfenster ausdruecklich ansprechen. PowerShell kann das ohne
   zusaetzliche Bauteile: SetForegroundWindow aus der user32, dazu
   ShowWindow, falls das Fenster als Symbol in der Leiste liegt.

   Gesucht wird der Prozess ueber die Fenster-Ueberschrift, nicht ueber
   den Namen des Browsers: welcher es ist, weiss hier niemand, und die
   frisch geoeffnete Seite ist ohnehin das Fenster, das zuletzt etwas
   getan hat. Genommen wird das neueste sichtbare Hauptfenster unter den
   bekannten Browsern.

   Scheitert das, bleibt es beim alten Verhalten – die Seite ist offen,
   nur eben hinten. Ein Verweis darf daran nicht hängen bleiben, deshalb
   laeuft alles im Hintergrund und ohne Rueckmeldung.
   ══════════════════════════════════════════════════════════════════════ */
const BROWSER_PROZESSE = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc'];

function holeBrowserNachVorn() {
  if (process.platform !== 'win32') return;

  const namen = BROWSER_PROZESSE.map(n => `'${n}'`).join(',');
  const skript = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Vordergrund {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
      }
"@
    $p = Get-Process -Name ${namen} -ErrorAction SilentlyContinue |
         Where-Object { $_.MainWindowHandle -ne 0 } |
         Sort-Object StartTime -Descending |
         Select-Object -First 1
    if ($p) {
      $h = $p.MainWindowHandle
      if ([Vordergrund]::IsIconic($h)) { [Vordergrund]::ShowWindow($h, 9) | Out-Null }
      [Vordergrund]::SetForegroundWindow($h) | Out-Null
    }`;

  /* Kurz warten: ein eben gestarteter Browser hat sein Fenster noch
     nicht, und ein laufender braucht einen Moment fuer den neuen Reiter.
     Ohne die Pause griffe der Aufruf ins Leere. */
  setTimeout(() => {
    try {
      const ps = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', skript],
        { detached: true, stdio: 'ignore', windowsHide: true });
      ps.on('error', (err) => console.warn('[Extern] Vordergrund:', err.message));
      ps.unref();
    } catch (err) {
      console.warn('[Extern] Vordergrund nicht moeglich:', err.message);
    }
  }, 600);
}

/**
 * Token-Anfragen der Anmeldedienste. Muss hier laufen und nicht im Fenster:
 * die Token-Endpunkte setzen für Desktop-Weiterleitungen keine CORS-
 * Kopfzeilen (das Fenster hat die Herkunft "null"), ein fetch aus dem
 * Renderer würde blockiert.
 *
 * Es sind bewusst nur die beiden Anmeldedienste erlaubt – so kann über
 * diesen Kanal nichts anderes nach außen geschickt werden.
 */
const TOKEN_ENDPOINT_HOSTS = new Set([
  'login.microsoftonline.com',   // Microsoft
  'oauth2.googleapis.com'        // Google
]);

async function handleTokenRequest(url, bodyObj) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !TOKEN_ENDPOINT_HOSTS.has(parsed.hostname)) {
      return { ok: false, error: 'Unerlaubte Adresse für die Token-Anfrage' };
    }

    const body = new URLSearchParams(bodyObj || {}).toString();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error_description || data?.error || `HTTP ${res.status}`;
      console.error('[Auth] Token-Anfrage abgelehnt:', parsed.hostname, msg);
      return { ok: false, error: msg };
    }

    return { ok: true, data };
  } catch (err) {
    console.error('[Auth] Token-Anfrage fehlgeschlagen:', err);
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('oauth-token-request', (_, url, bodyObj) => handleTokenRequest(url, bodyObj));

// Alter Name aus der Zeit, als nur Microsoft diesen Weg brauchte
ipcMain.handle('ms-token-request', (_, url, bodyObj) => handleTokenRequest(url, bodyObj));

ipcMain.handle('get-pending-deep-link', () => {
  const link = pendingDeepLink;
  pendingDeepLink = null; // consume it
  return link || null;
});

ipcMain.handle('get-pending-share-link', () => {
  const link = pendingShareLink;
  pendingShareLink = null; // consume it
  return link || null;
});

/* ── Weiche für inkwells:// ─────────────────────────────────────────────
   Bisher landete JEDER Aufruf des Protokolls beim OAuth-Rückruf. Seit es
   geteilte Dokumente gibt, kommt auch "inkwells://share/<linkId>" an – das
   ist keine Anmeldung, sondern ein Dokument, das geöffnet werden soll.

   Rückgabe: 'share' (mit Kennung) oder 'oauth'.
   ─────────────────────────────────────────────────────────────────── */
function classifyDeepLink(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return { kind: 'oauth' };

  const match = /^inkwells:\/\/share\/([^/?#]+)/i.exec(urlStr.trim());
  if (!match) return { kind: 'oauth' };

  let linkId = match[1];
  try { linkId = decodeURIComponent(linkId); } catch (e) { /* roh nehmen */ }
  return { kind: 'share', linkId };
}

/**
 * Schickt einen Protokoll-Aufruf an die richtige Stelle im Fenster. Ist
 * das Fenster noch nicht so weit, wird der Aufruf gemerkt und beim Start
 * abgeholt (get-pending-deep-link / get-pending-share-link).
 */
function routeDeepLink(urlStr, { buffer = true } = {}) {
  const info = classifyDeepLink(urlStr);

  /* Ist die Oberfläche schon da, kommt der Aufruf sofort an und muss NICHT
     zusätzlich gemerkt werden. Vorher blieb er liegen und wurde beim
     nächsten Laden des Fensters ein zweites Mal geöffnet – das Dokument
     ging dann von selbst auf, ohne dass jemand einen Link angeklickt
     hatte. */
  const delivered = !!(win && win.webContents && !win.webContents.isLoading());

  if (info.kind === 'share') {
    console.log('[main] Freigabe-Link erhalten:', info.linkId);
    if (buffer && !delivered) pendingShareLink = info.linkId;
    if (win) {
      try { win.webContents.send('open-share', info.linkId); }
      catch (e) { console.warn('[main] open-share konnte nicht gesendet werden:', e); }
    }
    return info;
  }

  console.log('[Auth] Anmelde-Rückleitung über das Protokoll erhalten');
  if (buffer) pendingDeepLink = urlStr;
  if (win) {
    try { win.webContents.send('oauth-callback', urlStr); }
    catch (e) { console.warn('[main] oauth-callback konnte nicht gesendet werden:', e); }
  }
  return info;
}

let oauthServer = null;

/* ══════════════════════════════════════════════════════════════════════
   DER RÜCKWEG DER POST-ANTWORT

   Der Server hört auf 127.0.0.1:3000/callback. Diese Adresse MUSS so
   bleiben – sie ist bei Google und Microsoft zeichengenau hinterlegt,
   jede Abweichung endet in „redirect_uri_mismatch".

   Der zweite Schritt ist aber unserer: die ausgelieferte Seite liest das
   Fragment aus und schickt es per POST zurück. Dieser Pfad war ebenfalls
   fest „/callback", und die Antwort trug „Access-Control-Allow-Origin: *".
   Damit konnte JEDE Seite im Browser des Nutzers einen eigenen
   Anmeldecode hineinschicken, solange der Server lief – die App haette
   ihn eingetauscht und waere beim Konto des Angreifers gelandet.

   Jetzt wird der POST-Pfad bei jedem Start gewuerfelt und steht nur in
   der Seite, die wir selbst ausgeliefert haben. Der CORS-Kopf faellt weg;
   gebraucht wurde er nie, die Seite hat dieselbe Herkunft.

   Zweite Haelfte derselben Absicherung: der `state`-Wert in
   core/cloudSync.js. Beide zusammen, weil jede fuer sich eine Luecke
   laesst – der Pfad schuetzt den Kanal, der state die Anfrage.
   ══════════════════════════════════════════════════════════════════════ */
let oauthPostPath = null;

ipcMain.handle('start-oauth-server', async () => {
  return new Promise((resolve, reject) => {
    if (oauthServer) {
      oauthServer.close();
      oauthServer = null;
    }

    oauthPostPath = '/r-' + require('crypto').randomBytes(18).toString('hex');
    const postPfad = oauthPostPath;
    let schonBenutzt = false;

    oauthServer = http.createServer((req, res) => {
      let pfad = '/';
      try { pfad = new URL(req.url, 'http://127.0.0.1').pathname; } catch (e) { /* bleibt / */ }
      console.log(`[OAuthServer] Received request: ${req.method} ${pfad}`);

      // Google liefert den Access-Token im URL-Fragment (#access_token=...).
      // Fragmente erreichen den Server nie, deshalb wird eine kleine HTML-Seite
      // ausgeliefert, die das Fragment per JS ausliest und zurück-POSTet.
      if (req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          // Die Seite traegt gleich den Anmeldecode – nichts davon in einen Zwischenspeicher
          'Cache-Control': 'no-store'
        });
        res.end(`
          <!DOCTYPE html>
          <html lang="de">
            <head>
              <meta charset="utf-8">
              <title>Inkwells — Anmeldung</title>
              <style>
                body { font-family: system-ui, sans-serif; background:#12121a; color:#ede8e0;
                       display:flex; align-items:center; justify-content:center;
                       height:100vh; margin:0; text-align:center; }
                .box { max-width: 420px; padding: 24px; }
                h3 { font-weight: 500; }
                .gold { color:#c8a96e; }
              </style>
            </head>
            <body>
              <div class="box"><h3 id="msg">Anmeldung wird abgeschlossen…</h3></div>
              <script>
                const msg = document.getElementById('msg');
                const hash = window.location.hash;
                const search = window.location.search;
                // Nur diese Seite kennt den Pfad – siehe oauthPostPath in main.js
                const ZURUECK = ${JSON.stringify(postPfad)};

                // 1. Fall: Ein Fehler wurde übergeben (egal ob Google oder Microsoft)
                if (search && search.includes('error=')) {
                  fetch(ZURUECK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: search.substring(1)
                  }).finally(() => {
                    msg.innerHTML = 'Anmeldung abgebrochen. Du kannst dieses Fenster schlie&szlig;en.';
                  });
                }
                // 2. Fall: Erfolgreicher Microsoft-Login (liefert ?code=...)
                else if (search) {
                  fetch(ZURUECK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: search.substring(1)
                  }).then(() => {
                    msg.innerHTML = 'Anmeldung erfolgreich! Du kannst dieses Fenster schlie&szlig;en und zu <span class="gold">Inkwells</span> zur&uuml;ckkehren.';
                    setTimeout(() => window.close(), 1500);
                  }).catch((err) => {
                    msg.innerHTML = 'Fehler bei der Anmeldung.';
                    console.error("Fetch error:", err);
                  });
                } 
                // 3. Fall: Erfolgreicher Google-Login (liefert #access_token=...)
                else if (hash) {
                  fetch(ZURUECK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: hash.substring(1)
                  }).then(() => {
                    msg.innerHTML = 'Anmeldung erfolgreich! Du kannst dieses Fenster schlie&szlig;en und zu <span class="gold">Inkwells</span> zur&uuml;ckkehren.';
                    setTimeout(() => window.close(), 1500);
                  }).catch((err) => {
                    msg.innerHTML = 'Fehler bei der Anmeldung.';
                    console.error("Fetch error:", err);
                  });
                } 
                // 4. Fall: Weder Parameter noch Hash da
                else {
                  msg.innerHTML = 'Kein Token gefunden.';
                }
              </script>
            </body>
          </html>
        `);
      } else if (req.method === 'POST') {
        /* Nur der gewuerfelte Pfad, und nur einmal. Alles andere ist
           nicht von unserer eigenen Seite gekommen. */
        if (pfad !== postPfad || schonBenutzt) {
          console.warn('[Sicherheit] Fremder POST am Anmelde-Server abgewiesen:', pfad);
          res.writeHead(404); res.end('Nicht gefunden');
          return;
        }
        schonBenutzt = true;

        let body = '';
        let zuLang = false;
        req.on('data', chunk => {
          body += chunk.toString();
          // Ein Anmeldecode ist wenige Kilobyte gross. Alles darueber ist
          // kein Anmeldecode, sondern jemand, der Speicher fuellen will.
          if (body.length > 64 * 1024) { zuLang = true; req.destroy(); }
        });
        req.on('end', () => {
          if (zuLang) { res.writeHead(413); res.end('Zu lang'); return; }
          console.log(`[OAuthServer] Received POST with token length: ${body.length}`);
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('ok');

          if (win && !win.isDestroyed()) {
             console.log(`[OAuthServer] Sending token to window`);
             win.webContents.send('oauth-callback', 'http://localhost/#' + body);
          }

          // Close server shortly after
          setTimeout(() => {
            if (oauthServer) {
              console.log(`[OAuthServer] Closing server`);
              oauthServer.close();
              oauthServer = null;
            }
          }, 2000);
        });
      } else {
        res.writeHead(405); res.end('Nicht erlaubt');
      }
    });

    // Ohne diesen Handler bliebe die Anmeldung bei belegtem Port stumm
    // hängen und im Hauptprozess landete ein unbehandelter Fehler.
    oauthServer.on('error', (err) => {
      oauthServer = null;
      if (err.code === 'EADDRINUSE') {
        console.error('[OAuthServer] Port 3000 ist belegt');
        reject(new Error(
          'Port 3000 wird von einem anderen Programm belegt – die Anmeldung kann nicht starten. '
          + 'Bitte das Programm beenden (oft ein Entwicklungsserver) und erneut versuchen.'
        ));
        return;
      }
      console.error('[OAuthServer] Fehler:', err);
      reject(new Error('Anmelde-Server konnte nicht gestartet werden: ' + err.message));
    });

    oauthServer.listen(3000, '127.0.0.1', () => {
      console.log('[OAuthServer] Bereit auf http://127.0.0.1:3000/callback');
      resolve('http://127.0.0.1:3000/callback');
    });
  });
});


/* Ensure custom protocol is registered.

   Ein Exemplar mit Profil meldet sich NICHT an. inkwells://-Adressen
   sollen weiter bei der gewöhnlichen Installation landen; ein zum
   Ausprobieren nebenherlaufendes zweites Exemplar würde die Anmeldung
   sonst an sich reißen und behielte sie auch, nachdem es beendet ist. */
if (PROFILE) {
  console.log('[main] Profil "' + PROFILE + '" – Protokoll inkwells:// wird nicht beansprucht');
} else if (process.defaultApp) {
  if (process.argv.length >= 2) {
    const args = [path.resolve(process.argv[1])];
    // Copy any relevant custom flags so the protocol handler joins the same instance
    if (process.platform === 'win32') {
      const storageRoot = storageRootFor('');
      args.push('--user-data-dir=' + path.join(storageRoot, 'UserData'));
      args.push('--disk-cache-dir=' + path.join(storageRoot, 'Cache'));
      args.push('--disable-gpu-shader-disk-cache');
    }
    app.setAsDefaultProtocolClient('inkwells', process.execPath, args);
  }
} else {
  app.setAsDefaultProtocolClient('inkwells');
}

app.whenReady().then(async () => {
  if (PROFILE) console.log('[journal] Profil:', PROFILE);
  console.log('[journal] userData:', app.getPath('userData'));
  console.log('[journal] sessionData:', app.getPath('sessionData'));

  /* Erst der Server, dann das Fenster – createWindow() lädt von uiOrigin.
     Scheitert er, bleibt die App ohne Oberfläche stehen; das muss man
     sehen, statt vor einem leeren Fenster zu sitzen. */
  try {
    await startUiServer();
  } catch (err) {
    console.error('[UI] Örtlicher Server konnte nicht starten:', err);
    dialog.showErrorBox('Inkwells', 'Die Oberfläche konnte nicht gestartet werden:\n' + err.message);
    app.quit();
    return;
  }

  createWindow();
  
  /* ══════════════════════════════════════════════════════════════════
     DIE OBERFLÄCHE HOLT SICH DEN AUFTRAG SELBST

     Hier wurde nach did-finish-load pauschal 500 ms gewartet und dann
     gesendet. Der Empfänger meldet sich aber erst nach Einstellungen,
     Übersicht und Cloud an (core/init.js) – bei einer grossen Übersicht
     dauert das länger als eine halbe Sekunde. Dann ging der Auftrag ins
     Leere: Doppelklick auf eine .jrnl, und es geschah gar nichts.

     Der Auftrag bleibt jetzt liegen, bis er abgeholt wird – derselbe
     Weg, den der Protokollaufruf schon nimmt (get-pending-deep-link).
     ══════════════════════════════════════════════════════════════════ */
  if (pendingFilePath) {
    console.log('[journal] Datei aus den Startargumenten wartet:', pendingFilePath);
  }
  /* Beim Start über das Protokoll aufgerufen. Nur zwischenspeichern und
     NICHT zusätzlich senden: die Oberfläche holt sich den Aufruf beim
     Hochfahren selbst ab (get-pending-deep-link bzw. get-pending-share-link).
     Beides zusammen hätte das Dokument doppelt geöffnet. */
  if (pendingDeepLink) {
    const startupLink = pendingDeepLink;
    pendingDeepLink = null;
    console.log('[journal] Protokoll-Aufruf beim Start:', startupLink);
    routeDeepLink(startupLink, { buffer: true });
  }
});

// Handle second instance (app already running, user double-clicks another file or deep link)
app.on('second-instance', (event, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  
  // Custom protocol deep link: entweder Anmeldung oder ein Freigabe-Link
  const urlArg = argv.find(arg => arg.startsWith('inkwells://'));
  if (urlArg) {
    routeDeepLink(urlArg);
    return;
  }

  // Check if second instance was opened with a file
  const filePath = getFileFromArgs(argv);
  if (filePath) {
    console.log('[journal] Opening file from second instance:', filePath);
    // Ausdrücklich geöffnet heisst: diese eine Datei ist erlaubt
    erlaubeDatei(filePath);
    win.webContents.send('open-file', filePath);
  }
});
/* Die beim Start mitgegebene Datei – einmal abholbar. Sie wird dabei
   ausdrücklich erlaubt: sie liegt fast nie im Speicherort (erlaubeDatei). */
ipcMain.handle('get-pending-file', () => {
  const datei = pendingFilePath;
  pendingFilePath = null;
  if (!datei) return null;
  erlaubeDatei(datei);
  return datei;
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url && url.startsWith('inkwells://')) routeDeepLink(url);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  // Ohne laufenden Server gäbe es nichts zu laden (macOS: Klick aufs Symbol)
  if (BrowserWindow.getAllWindows().length) return;
  (uiOrigin ? Promise.resolve() : startUiServer()).then(createWindow).catch(err => {
    console.error('[UI] Örtlicher Server konnte nicht starten:', err);
  });
});

/* Die drei Knoepfe der eigenen Titelleiste. Ueber `win` und nicht ueber
   den Absender, weil es nur dieses eine Hauptfenster gibt – aber es kann
   schon zerstoert sein, wenn eine Nachricht noch unterwegs ist. Ohne die
   Pruefung wirft der Hauptprozess dann eine Ausnahme. */
function amFenster(tu) {
  if (!win || win.isDestroyed()) return;
  try { tu(win); } catch (err) { console.warn('[Fenster]', err.message); }
}
ipcMain.on('win-min',   () => amFenster(w => w.minimize()));
ipcMain.on('win-max',   () => amFenster(w => w.isMaximized() ? w.unmaximize() : w.maximize()));
ipcMain.on('win-close', () => amFenster(w => w.close()));

ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile','multiSelections'],
    filters: [
      { name:'Bilder & PDFs', extensions:['jpg','jpeg','png','gif','webp','bmp','pdf'] },
      { name:'Alle Dateien', extensions:['*'] }
    ]
  });
  if (r.canceled) return null;
  return r.filePaths.map(p => {
    const ext  = path.extname(p).toLowerCase();
    const name = path.basename(p);
    const imgs = ['.jpg','.jpeg','.png','.gif','.webp','.bmp'];
    const mime = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
      '.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp', '.pdf':'application/pdf'};
    
    if (imgs.includes(ext)) {
      return { kind:'image', name, dataUrl:`data:${mime[ext]};base64,${fs.readFileSync(p).toString('base64')}` };
    } else if (ext === '.pdf') {
      return { kind:'pdf', name, dataUrl:`data:application/pdf;base64,${fs.readFileSync(p).toString('base64')}` };
    } else {
      return { kind:'file', name };
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════
   EIN DOKUMENT ZUM ÖFFNEN WÄHLEN

   Getrennt von 'pick-files', obwohl beide eine Datei aussuchen. Der
   Unterschied ist die Absicht, und die steckt schon im Fenster: dort
   sucht man EINE Vorlage für ein neues Heft, hier mehrere Dateien zum
   Einfügen in ein offenes. Ein gemeinsamer Aufruf müsste beide Fälle
   über eine Fahne auseinanderhalten und böte im Öffnen-Fenster
   Bilddateien an, aus denen gar kein Heft entsteht.

   .doc fehlt mit Absicht: das alte Binärformat ist etwas ganz anderes
   als .docx und lässt sich nicht nebenbei lesen. Es hier anzubieten
   hiesse, ein Versprechen zu geben, das erst beim Öffnen bricht.

   .jrnl ist dagegen ein eigenes Heft – und steht hier aus einem
   anderen Grund als bei „Laden": dort wird die Datei an ihrem Platz
   weiterbenutzt, hier entsteht eine KOPIE im eigenen Ordner. Wer ein
   Heft geschickt bekommt, will meistens das zweite.
   ══════════════════════════════════════════════════════════════════════ */
ipcMain.handle('pick-document', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Word, PDF & Inkwells', extensions: ['docx', 'pdf', 'jrnl'] },
      { name: 'Word-Dokument', extensions: ['docx'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Inkwells-Heft', extensions: ['jrnl'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return null;

  const p = r.filePaths[0];
  const ext = path.extname(p).toLowerCase();
  const name = path.basename(p, path.extname(p));   // ohne Endung: der Heftname

  /* Ein Heft bringt seinen Namen selbst mit. Der Dateiname ist nur der
     Rückfall – er kann umbenannt worden sein und sagt dann etwas
     anderes als das Heft darin. */
  if (ext === '.jrnl') {
    const text = await leseHeftDatei(p);
    let heftName = name;
    try {
      const d = JSON.parse(text);
      const q = Array.isArray(d && d.notebooks) ? d.notebooks[0] : d;
      if (q && typeof q.name === 'string' && q.name.trim()) heftName = q.name.trim();
    } catch (err) {
      /* Kaputtes JSON faellt erst drueben auf – dort gibt es eine
         Meldung dafuer, hier nur den Namen. */
    }
    return { kind: 'jrnl', name: heftName, text };
  }

  const mime = ext === '.pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  return {
    kind: ext === '.pdf' ? 'pdf' : 'docx',
    name,
    dataUrl: `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`
  };
});

/* ══════════════════════════════════════════════════════════════════════
   DER KATEX-STIL FUER DEN AUSDRUCK

   Das Export-HTML wird als temporaere Datei im TEMP-Ordner abgelegt und
   dort geladen. Ein <link> auf lib/katex.min.css ginge damit ins Leere,
   und die Schriftverweise darin erst recht – sie sind relativ.

   Deshalb kommt der Stil von hier, mit den Schriften als data:-URI
   darin. Nur woff2: die anderen beiden Fassungen derselben Schrift sind
   fuer Chromium ueberfluessig und wuerden die Datei ohne Not verdoppeln.

   Gelesen wird genau einmal – der Stil aendert sich nicht, solange die
   App laeuft.
   ══════════════════════════════════════════════════════════════════════ */
let katexDruckStil = null;

ipcMain.handle('katex-druckstil', async () => {
  if (katexDruckStil !== null) return katexDruckStil;

  try {
    const cssPfad = path.join(__dirname, 'src', 'lib', 'katex.min.css');
    let css = fs.readFileSync(cssPfad, 'utf-8');

    // Die Fassungen, die Chromium nicht braucht, fallen weg
    css = css.replace(/,\s*url\([^)]*\)\s*format\((['"])(woff|truetype|opentype)\1\)/g, '');

    const ordner = path.dirname(cssPfad);
    css = css.replace(/url\((['"]?)(fonts\/[^)'"]+)\1\)/g, (ganz, _q, rel) => {
      try {
        const datei = path.join(ordner, rel);
        const daten = fs.readFileSync(datei).toString('base64');
        return 'url(data:font/woff2;base64,' + daten + ')';
      } catch (err) {
        return ganz;      // fehlt sie, bleibt der Verweis stehen
      }
    });

    katexDruckStil = css;
  } catch (err) {
    console.warn('[PDF] KaTeX-Stil nicht lesbar:', err.message);
    katexDruckStil = '';
  }
  return katexDruckStil;
});

ipcMain.handle('export-pdf', async (_, html, defaultName) => {
  const r = await dialog.showSaveDialog(win, {
    // Der Heftname als Vorschlag – „inkwells.pdf" für jedes Heft war beim
    // Exportieren mehrerer Hefte reichlich unbrauchbar.
    defaultPath: typeof defaultName === 'string' && defaultName ? defaultName : 'inkwells.pdf',
    filters: [{name:'PDF', extensions:['pdf']}]
  });
  if (r.canceled) return null;

  // Über eine temporäre Datei statt data:-URL. Mit eingebetteter Handschrift
  // und Bildern wird das HTML schnell viele MB groß – als data:-URL scheitert
  // das Laden dann stillschweigend.
  const tmpHtml = path.join(app.getPath('temp'), `inkwells-export-${Date.now()}.html`);
  const w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });

  try {
    fs.writeFileSync(tmpHtml, html, 'utf-8');
    await w.loadFile(tmpHtml);

    // Warten, bis Bilder und Schriften wirklich da sind – sonst fehlen im
    // PDF genau die Zeichnungen, die wir exportieren wollen.
    await w.webContents.executeJavaScript(`
      (async () => {
        const imgs = Array.from(document.images);
        await Promise.all(imgs.map(img => img.complete
          ? Promise.resolve()
          : new Promise(res => { img.onload = res; img.onerror = res; })));
        try { await document.fonts.ready; } catch (e) {}
      })();
    `);
    await new Promise(res => setTimeout(res, 200));

    /* ══════════════════════════════════════════════════════════════
       DIE SEITENGROESSE STEHT IM DOKUMENT

       Hier stand pageSize: 'A4', fest. Eine Querformatfolie wurde damit
       auf die Breite eines Hochformatblattes geschrumpft, egal was das
       Dokument sagte. preferCSSPageSize laesst Chromium die @page-Regeln
       benutzen, die buildPdf je vorkommendem Mass schreibt – auch bei
       gemischten Formaten in einem Heft.

       pageSize bleibt als Rueckfall stehen: hat ein Dokument keine
       brauchbare Angabe, kommt weiterhin A4 heraus. */
    const buf = await w.webContents.printToPDF({
      printBackground: true, pageSize: 'A4', preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    fs.writeFileSync(r.filePath, buf);
    return r.filePath;
  } catch (err) {
    console.error('[PDF] Export fehlgeschlagen:', err);
    return { error: err.message };
  } finally {
    if (!w.isDestroyed()) w.close();
    try { if (fs.existsSync(tmpHtml)) fs.unlinkSync(tmpHtml); } catch (e) { /* egal */ }
  }
});

/* Beliebige Binärdatei speichern (derzeit: der Word-Export).
   Die Datei wird im Fenster erzeugt und kommt hier fertig an – der
   Hauptprozess fragt nur nach dem Ort und schreibt sie weg. */
ipcMain.handle('save-binary', async (_, payload = {}) => {
  const { defaultName, filterName, extension, data } = payload;
  if (!data) return { error: 'Keine Daten erhalten' };

  const ext = typeof extension === 'string' && extension ? extension : 'bin';
  const r = await dialog.showSaveDialog(win, {
    defaultPath: typeof defaultName === 'string' && defaultName ? defaultName : `inkwells.${ext}`,
    filters: [{ name: filterName || ext.toUpperCase(), extensions: [ext] }]
  });
  if (r.canceled) return null;

  try {
    fs.writeFileSync(r.filePath, Buffer.from(data));
    return r.filePath;
  } catch (err) {
    console.error('[Export] Datei konnte nicht geschrieben werden:', err);
    return { error: err.message };
  }
});

ipcMain.handle('save', async (_, data) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: 'inkwells.jrnl',
    filters: [{name:'Inkwells', extensions:['jrnl']}]
  });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data));
  return r.filePath;
});

ipcMain.handle('load', async () => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{name:'Inkwells', extensions:['jrnl']}],
    properties: ['openFile']
  });
  if (r.canceled) return null;
  
  try {
    const data = JSON.parse(await leseHeftDatei(r.filePaths[0]));
    console.log('[Load] Loaded file:', r.filePaths[0]);
    
    // Handle both old format {notebooks: [...]} and new format (single notebook)
    if (data.notebooks) {
      // Old format
      return { ...data, sourcePath: r.filePaths[0] };
    } else if (data.id && data.sections) {
      // New format - single notebook
      return { notebooks: [data], loadedSingle: true, sourcePath: r.filePaths[0] };
    } else {
      console.error('[Load] Unknown file format');
      return null;
    }
  } catch (err) {
    console.error('[Load] Error:', err);
    return null;
  }
});

// Settings management
const settingsPath = path.join(app.getPath('userData'), 'inkwells-settings.json');

/* Die Einstellungen enthalten cloudAccessToken und cloudRefreshToken. Sie
   standen hier im Klartext im Protokoll – und main.js reicht zusätzlich
   die Ausgaben des Fensters ans Terminal weiter, wo sie beim Vorführen,
   in einem Bildschirmfoto oder in einer Fehlermeldung landen. Mit dem
   Refresh-Token kommt man an das ganze Drive bzw. OneDrive.

   Was der Wert IST, ist nie interessant – nur, ob überhaupt einer da ist.
   Genau das bleibt lesbar. */
function redactSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  for (const key of Object.keys(out)) {
    if (!/token|secret|refresh|nonce/i.test(key)) continue;
    out[key] = out[key] ? '<gesetzt, ' + String(out[key]).length + ' Zeichen>' : '';
  }
  return out;
}
console.log('[Settings] Settings file path:', settingsPath);

ipcMain.handle('get-default-save-path', () => {
  const documentsPath = app.getPath('documents');
  const inkwellsPath = path.join(documentsPath, 'Inkwells');
  console.log('[Settings] Default save path:', inkwellsPath);
  if (!fs.existsSync(inkwellsPath)) {
    fs.mkdirSync(inkwellsPath, { recursive: true });
    console.log('[Settings] Created Inkwells directory');
  }
  return inkwellsPath;
});

ipcMain.handle('load-settings', () => {
  console.log('[Settings] Loading settings...');
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      console.log('[Settings] Loaded:', redactSettings(settings));
      return settings;
    }
    console.log('[Settings] No settings file found');
  } catch (err) {
    console.error('[Settings] Load error:', err);
  }
  return null;
});

ipcMain.handle('save-settings', (_, data) => {
  console.log('[Settings] Saving settings:', redactSettings(data));
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
    console.log('[Settings] ✓ Settings saved');
    return true;
  } catch (err) {
    console.error('[Settings] Save error:', err);
    throw err;
  }
});

ipcMain.handle('pick-folder', async (_, defaultPath) => {
  const options = {
    properties: ['openDirectory', 'createDirectory']
  };
  if (defaultPath) options.defaultPath = defaultPath;
  const r = await dialog.showOpenDialog(win, options);
  if (r.canceled) return null;

  /* Der Nutzer hat ihn im Fenster des Betriebssystems ausgewählt – das
     ist die einzige Stelle, an der ein neuer Ordner dazukommt. Sie liegt
     VOR dem Umzug der Dateien: sonst weist move-file das Ziel ab, die
     Oberfläche meldet trotzdem Erfolg, und danach ist weder der alte noch
     der neue Ort erreichbar (siehe erlaubteOrdner). */
  erlaubeOrdner(r.filePaths[0]);
  return r.filePaths[0];
});

/* ══════════════════════════════════════════════════════════════════════
   WOHIN DIE OBERFLÄCHE SCHREIBEN DARF

   Die Dateizugriffe hängen am Fenster (preload.js). Sie nahmen bisher
   jeden Pfad an – wer im Fenster Code ausführen kann, konnte damit jede
   Datei des Nutzers lesen, überschreiben oder löschen. Genau das ist der
   Grund, warum fremder Seitentext jetzt bereinigt wird
   (src/core/sanitize.js); hier steht die zweite Schicht darunter.

   Erlaubt sind der eingestellte Speicherort (dort liegen die Hefte) und
   der Datenordner der App. Ein Pfad, der weder unter dem einen noch unter
   dem anderen liegt, wird abgewiesen.

   Der Vergleich läuft über path.resolve und mit dem Trennzeichen dahinter
   – sonst käme "…\Inkwells-heimlich" an "…\Inkwells" vorbei.
   ══════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════
   C:\ORDNER UND c:\ordner SIND DERSELBE ORDNER

   Verglichen wurde zeichengenau. Auf den üblichen Windows-Dateisystemen
   ist die Schreibung aber gleichgültig: ein Pfad, der einmal mit grossem
   und einmal mit kleinem Laufwerksbuchstaben durchs Haus geht – und das
   tut er, sobald einer aus einem Dialog und einer aus der Übersicht
   kommt –, galt hier als zwei verschiedene. Die Folge ist eine Absage
   beim Speichern, für die es keinen Grund gibt.
   ══════════════════════════════════════════════════════════════════════ */
function pfadSchluessel(p) {
  const aufgeloest = path.resolve(p);
  return process.platform === 'win32' ? aufgeloest.toLowerCase() : aufgeloest;
}

function liegtUnter(kandidat, ordner) {
  if (!ordner) return false;
  const a = pfadSchluessel(kandidat);
  const b = pfadSchluessel(ordner);
  return a === b || a.startsWith(b + path.sep);
}

/* ══════════════════════════════════════════════════════════════════════
   DIE ERLAUBNIS GEHÖRT DEM HAUPTPROZESS

   Hier wurde der Speicherort aus der EINSTELLUNGSDATEI gelesen – und die
   darf die Oberfläche über save-settings vollständig und ungeprüft
   schreiben. Damit war die Liste keine zweite Sicherheitsgrenze mehr:
   fremder Code im Fenster setzte saveLocation auf einen beliebigen Ordner
   und las oder überschrieb danach dessen Dateien über dieselben
   Datei-APIs. Ein Nachweis für eine Einschleusung ist das nicht – aber
   eine Grenze, die nur solange hält, wie niemand sie anfasst, ist keine.

   Die erlaubten Orte stehen deshalb in einer eigenen Datei, die nur der
   Hauptprozess schreibt, und sie wachsen an genau zwei Stellen:

     · der Nutzer wählt einen Ordner im Auswahlfenster (pick-folder),
     · der Nutzer öffnet ausdrücklich eine Datei (siehe erlaubeDatei).

   Beides sind Fenster des Betriebssystems oder Handgriffe daran. Code im
   Renderer kommt an keines von beiden vorbei.

   Die Liste wächst nur. Das ist Absicht: wer den Speicherort wechselt,
   hat alte Hefte weiterhin dort liegen, und ohne den alten Ort in der
   Liste wären sie beim nächsten Start "verschwunden" (P01).
   ══════════════════════════════════════════════════════════════════════ */
const ortePfad = path.join(app.getPath('userData'), 'inkwells-orte.json');
let _orte = null;

function ladeOrte() {
  if (_orte) return _orte;
  _orte = [];
  try {
    if (fs.existsSync(ortePfad)) {
      const roh = JSON.parse(fs.readFileSync(ortePfad, 'utf-8'));
      if (Array.isArray(roh)) _orte = roh.filter(o => typeof o === 'string' && o);
    }
  } catch (err) {
    console.warn('[Sicherheit] Orte-Datei nicht lesbar:', err.message);
  }

  /* Einmalige Übernahme: wer vor dieser Fassung einen Speicherort
     gewählt hat, hat ihn nur in den Einstellungen stehen. Ihn jetzt
     nicht zu übernehmen hiesse, ihm seine Hefte wegzunehmen. */
  if (!fs.existsSync(ortePfad)) {
    try {
      if (fs.existsSync(settingsPath)) {
        const gespeichert = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const alt = gespeichert && gespeichert.saveLocation;
        if (typeof alt === 'string' && alt) _orte.push(alt);
      }
    } catch (err) { /* dann eben nur die Vorgabeorte */ }
    schreibeOrte();
  }
  return _orte;
}

function schreibeOrte() {
  try {
    fs.writeFileSync(ortePfad, JSON.stringify(_orte || [], null, 2));
  } catch (err) {
    console.error('[Sicherheit] Orte-Datei nicht schreibbar:', err.message);
  }
}

/** Einen vom Nutzer gewählten Ordner dauerhaft erlauben. */
function erlaubeOrdner(ordner) {
  if (typeof ordner !== 'string' || !ordner) return;
  ladeOrte();
  if (_orte.some(o => pfadSchluessel(o) === pfadSchluessel(ordner))) return;
  _orte.push(ordner);
  schreibeOrte();
  console.log('[Sicherheit] Ordner erlaubt:', ordner);
}

/* ══════════════════════════════════════════════════════════════════════
   EINE AUSDRÜCKLICH GEÖFFNETE DATEI

   "Öffnen mit Inkwells" gibt eine einzelne Datei mit, meist aus
   Downloads oder vom Schreibtisch – also fast nie aus dem Speicherort.
   Die Pfadsperre wies sie deshalb ab, und statt des Hefts erschien ein
   Speicherfehler. Der Doppelklick war trotzdem angeboten: das Format ist
   beim Betriebssystem angemeldet.

   Erlaubt wird deshalb GENAU DIESE Datei, nicht ihr Ordner. Sie ist
   nur für diesen Lauf freigegeben und steht in keiner Datei.
   ══════════════════════════════════════════════════════════════════════ */
const erlaubteDateien = new Set();

function erlaubeDatei(datei) {
  if (typeof datei !== 'string' || !datei) return;
  erlaubteDateien.add(pfadSchluessel(datei));
  console.log('[Sicherheit] Datei einmalig erlaubt:', datei);
}

/** Der eingestellte Speicherort – aus der Liste, die nur hier wächst. */
function erlaubteOrdner() {
  const ordner = [app.getPath('userData')];
  for (const o of ladeOrte()) ordner.push(o);
  // Der Vorgabeort gilt immer, auch bevor er zum ersten Mal gespeichert ist
  try { ordner.push(path.join(app.getPath('documents'), 'Inkwells')); } catch (err) {}

  /* Und der Vorgabeort der Fassungen bis 1.1.1, als die App noch Inkwell
     hiess. Dort liegen die Hefte bestehender Nutzer weiterhin - dieser
     Ordner wird NICHT umgezogen, weil die Uebersicht absolute Pfade
     speichert und ein Umbenennen sie alle ins Leere zeigen liesse.

     Wer nie einen Speicherort gesichert hat, haette ihn sonst nicht mehr
     in der Liste und bekaeme beim Speichern des eigenen Hefts eine
     Absage. */
  try { ordner.push(path.join(app.getPath('documents'), 'Inkwell')); } catch (err) {}
  return ordner;
}

function pfadErlaubt(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (erlaubteDateien.has(pfadSchluessel(filePath))) return true;
  return erlaubteOrdner().some(o => liegtUnter(filePath, o));
}

/** Einheitliche Absage – und ein Eintrag im Protokoll, denn das ist nie normal. */
function pfadAbgelehnt(was, filePath) {
  console.error(`[Sicherheit] ${was} außerhalb des Speicherorts abgelehnt:`, filePath);
  return { success: false, error: 'Pfad liegt außerhalb des Speicherorts' };
}

// File operations for auto-save
// Schreibt immer erst vollständig in eine Nebendatei und ersetzt das Original
// dann in einem Zug. Vorher wurde direkt in die .jrnl geschrieben – ein
// Absturz oder Stromausfall mitten im Schreiben hinterließ eine abgeschnittene
// Datei, das Notizbuch war damit verloren.
/* ══════════════════════════════════════════════════════════════════════
   EIN HEFT SCHREIBEN, OHNE DIE APP ANZUHALTEN

   >>> Gemeldet: „wenn es laggt, laggt alles – Schreiben, Zeichnen,
   Farbe waehlen, Verschieben" <<<
   Hier stand alles synchron: JSON.stringify, writeFileSync, fsyncSync.
   Der Hauptprozess ist aber auch der, der die Eingaben an die Oberflaeche
   weiterreicht. Bei einem Heft von 14 MB stand er bei jedem Speichern
   (zwei Sekunden nach der letzten Aenderung) eine spuerbare Weile still –
   und mit ihm Stift, Maus und Finger, egal was man gerade tat.

   Jetzt kommt das Heft schon als Text (core/fileManager.js), und
   geschrieben wird ueber die Warteschlange des Betriebssystems. Weil
   dabei zwei Speichervorgaenge desselben Pfads ineinanderlaufen koennten
   – beide schreiben in dieselbe .tmp-Datei –, stehen sie je Pfad in einer
   Reihe. Ein Objekt nimmt der Kanal weiterhin an (core/versions.js).
   ══════════════════════════════════════════════════════════════════════ */
const _schreibReihe = new Map();   // Pfad (klein) -> Versprechen des letzten Schreibens

async function schreibeHeftDatei(filePath, jsonData) {
  const tmpPath = `${filePath}.tmp`;
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    // Schreiben und auf die Platte durchdrücken, bevor ersetzt wird
    const fh = await fs.promises.open(tmpPath, 'w');
    try {
      await fh.writeFile(jsonData, 'utf-8');
      await fh.sync();
    } finally {
      await fh.close();
    }

    // rename ersetzt eine vorhandene Datei atomar (auch unter Windows)
    await fs.promises.rename(tmpPath, filePath);

    const stats = await fs.promises.stat(filePath);
    console.log(`[Save] ✓ ${filePath} (${stats.size} Bytes)`);
    return { success: true, path: filePath };
  } catch (err) {
    console.error('[Save] ✗ Error:', err);
    // Halbfertige Nebendatei nicht liegen lassen
    try { await fs.promises.unlink(tmpPath); } catch (e) { /* egal */ }
    return { success: false, error: err.message };
  }
}

ipcMain.handle('save-to-path', async (_, filePath, data) => {
  if (!pfadErlaubt(filePath)) return pfadAbgelehnt('Schreiben', filePath);
  let jsonData;
  try {
    jsonData = typeof data === 'string' ? data : JSON.stringify(data);
  } catch (err) {
    return { success: false, error: err.message };
  }
  const schluessel = String(filePath).toLowerCase();
  const davor = _schreibReihe.get(schluessel) || Promise.resolve();
  const jetzt = davor.catch(() => {}).then(() => schreibeHeftDatei(filePath, jsonData));
  _schreibReihe.set(schluessel, jetzt);
  try {
    return await jetzt;
  } finally {
    if (_schreibReihe.get(schluessel) === jetzt) _schreibReihe.delete(schluessel);
  }
});

/* ══════════════════════════════════════════════════════════════════════
   EIN HEFT LESEN – AUCH EIN GEPACKTES

   Geschrieben wird ein Heft als reines JSON (schreibeHeftDatei). Gelesen
   wird hier aber auch eines, das mit gzip gepackt ist – erkennbar an den
   zwei ersten Bytes 1F 8B, die JSON nie haben kann.

   >>> Warum lesen, bevor irgendwer so schreibt <<<
   Gepackt waere ein Heft mit viel Handschrift noch einmal etwa ein
   Drittel so gross. Eine aeltere App koennte eine solche Datei aber gar
   nicht oeffnen – und die Hefte liegen oft in einem Ordner, den mehrere
   Geraete teilen (OneDrive). Deshalb zwei Schritte: erst lernt jede App
   das Lesen, und erst wenn diese Fassung ueberall angekommen ist, darf
   das Schreiben folgen. Dies hier ist der erste Schritt.
   ══════════════════════════════════════════════════════════════════════ */
function heftTextAus(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = zlib.gunzipSync(bytes);
  }
  let text = bytes.toString('utf-8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // BOM
  return text;
}

async function leseHeftDatei(filePath) {
  return heftTextAus(await fs.promises.readFile(filePath));
}

ipcMain.handle('load-from-path', async (_, filePath) => {
  if (!pfadErlaubt(filePath)) return pfadAbgelehnt('Lesen', filePath);
  console.log('[Load] Loading from:', filePath);
  try {
    if (!fs.existsSync(filePath)) {
      console.log('[Load] File not found:', filePath);
      return { success: false, error: 'File not found' };
    }
    const data = JSON.parse(await leseHeftDatei(filePath));
    console.log('[Load] ✓ Successfully loaded:', filePath);
    return { success: true, data };
  } catch (err) {
    console.error('[Load] ✗ Error:', err);
    return { success: false, error: err.message };
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   DAS BILD AUS DER ZWISCHENABLAGE

   Die Oberflaeche fragt zuerst navigator.clipboard.read(); das ist der
   Weg, der auch im Browser geht (website/). In Electron haengt er aber
   an einer Erlaubnis, die der Nutzer nie zu Gesicht bekommt - wird sie
   abgeschlagen, kaeme gar nichts an, ohne dass jemand erfuehrt, warum.

   Hier liegt deshalb der zweite Weg: der Hauptprozess darf die
   Zwischenablage ohne Umweg lesen. Zurueck geht nur ein PNG als
   Datenadresse, kein Text und keine Dateiliste - eingesetzt wird auf
   dem Blatt ohnehin nur ein Bild (core/importExport.js).
   ═══════════════════════════════════════════════════════════════════════ */
ipcMain.handle('clipboard-image', async () => {
  try {
    const { clipboard } = require('electron');
    const bild = clipboard.readImage();
    if (!bild || bild.isEmpty()) return null;
    return bild.toDataURL();
  } catch (err) {
    console.warn('[Zwischenablage]', err?.message || err);
    return null;
  }
});

ipcMain.handle('check-internet', async () => {
  try {
    const { net } = require('electron');
    return net.isOnline();
  } catch {
    return false;
  }
});

// Registry management
/* ══════════════════════════════════════════════════════════════════════
   POSTFACH — der oertliche Merkzettel

   Welche Nachricht gelesen und welche geloescht ist, steht doppelt: hier
   als Arbeitsstand und in der Cloud unter der Firebase-Kennung, damit es
   auf einem zweiten Rechner ankommt.

   >>> Warum ueberhaupt oertlich, wenn es die Cloud gibt <<<
   Zwei Gruende. Erstens arbeitet das Postfach damit ohne Internet und
   ohne Konto weiter. Zweitens - und das ist der eigentliche - wechselt
   beim Anmelden auf einem ZWEITEN Geraet die Firebase-Kennung
   (credential-already-in-use, siehe core/share.js). Das Dokument unter
   der alten Kennung waere danach nicht mehr lesbar, denn die Regel gibt
   jedem nur sein eigenes. Dieser Merkzettel haengt am Rechner statt an
   der Kennung und ueberlebt den Wechsel.

   erstStart haelt fest, wann diese Installation zum ersten Mal lief.
   Daran haengt der Empfaengerkreis "nur Erstinstallation".
   ══════════════════════════════════════════════════════════════════════ */
const postfachPath = path.join(app.getPath('userData'), 'inkwells-postfach.json');

const POSTFACH_LEER = { gelesen: [], geloescht: [], erstStart: null, erstAnmeldung: null };

ipcMain.handle('load-postfach', () => {
  try {
    if (fs.existsSync(postfachPath)) {
      const stand = JSON.parse(fs.readFileSync(postfachPath, 'utf-8'));
      return {
        gelesen: Array.isArray(stand.gelesen) ? stand.gelesen : [],
        geloescht: Array.isArray(stand.geloescht) ? stand.geloescht : [],
        erstStart: stand.erstStart || null,
        erstAnmeldung: stand.erstAnmeldung || null
      };
    }
  } catch (err) {
    console.error('[Postfach] Laden fehlgeschlagen:', err.message);
  }
  return { ...POSTFACH_LEER };
});

ipcMain.handle('save-postfach', (_, stand) => {
  try {
    const sauber = {
      gelesen: Array.isArray(stand && stand.gelesen) ? stand.gelesen.map(String) : [],
      geloescht: Array.isArray(stand && stand.geloescht) ? stand.geloescht.map(String) : [],
      erstStart: (stand && stand.erstStart) || null,
      erstAnmeldung: (stand && stand.erstAnmeldung) || null
    };
    fs.writeFileSync(postfachPath, JSON.stringify(sauber, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    console.error('[Postfach] Sichern fehlgeschlagen:', err.message);
    return { ok: false, err: err.message };
  }
});

/**
 * Wann lief diese Installation zum ersten Mal - und ist das JETZT?
 *
 * Der Vermerk wird beim allerersten Aufruf gesetzt. Die Oberflaeche
 * fragt einmal beim Start; "erstesMal" ist danach fuer die restliche
 * Sitzung wahr, auch wenn nochmal gefragt wird.
 */
let erstesMalGemeldet = null;

ipcMain.handle('erst-start', () => {
  if (erstesMalGemeldet !== null) return erstesMalGemeldet;

  let stand = { ...POSTFACH_LEER };
  try {
    if (fs.existsSync(postfachPath)) stand = JSON.parse(fs.readFileSync(postfachPath, 'utf-8'));
  } catch (err) { /* dann gilt es als frisch */ }

  const schonDa = !!stand.erstStart;
  if (!schonDa) {
    stand.erstStart = new Date().toISOString();
    try {
      fs.writeFileSync(postfachPath, JSON.stringify({
        gelesen: stand.gelesen || [],
        geloescht: stand.geloescht || [],
        erstStart: stand.erstStart
      }, null, 2), 'utf-8');
      console.log('[Postfach] Erstinstallation vermerkt:', stand.erstStart);
    } catch (err) {
      console.error('[Postfach] Erstvermerk nicht sicherbar:', err.message);
    }
  }

  erstesMalGemeldet = { erstesMal: !schonDa, seit: stand.erstStart };
  return erstesMalGemeldet;
});

/**
 * Wurde auf dieser Installation zum ERSTEN Mal ein Konto verbunden - und
 * ist das jetzt gerade?
 *
 * Die Oberflaeche ruft das erst, wenn wirklich ein echtes Konto angemeldet
 * ist; die anonyme Geraetekennung zaehlt nicht. Wie beim Erststart gilt
 * die Antwort fuer die ganze Sitzung, damit ein zweites Nachfragen nicht
 * ploetzlich "nein" sagt.
 */
let erstAnmeldungGemeldet = null;

ipcMain.handle('erste-anmeldung', () => {
  if (erstAnmeldungGemeldet !== null) return erstAnmeldungGemeldet;

  let stand = { ...POSTFACH_LEER };
  try {
    if (fs.existsSync(postfachPath)) stand = JSON.parse(fs.readFileSync(postfachPath, 'utf-8'));
  } catch (err) { /* dann gilt es als frisch */ }

  const schonDa = !!stand.erstAnmeldung;
  if (!schonDa) {
    stand.erstAnmeldung = new Date().toISOString();
    try {
      fs.writeFileSync(postfachPath, JSON.stringify({
        gelesen: stand.gelesen || [],
        geloescht: stand.geloescht || [],
        erstStart: stand.erstStart || null,
        erstAnmeldung: stand.erstAnmeldung
      }, null, 2), 'utf-8');
      console.log('[Postfach] Erste Anmeldung vermerkt:', stand.erstAnmeldung);
    } catch (err) {
      console.error('[Postfach] Anmeldevermerk nicht sicherbar:', err.message);
    }
  }

  erstAnmeldungGemeldet = { erstmalsAngemeldet: !schonDa, seit: stand.erstAnmeldung };
  return erstAnmeldungGemeldet;
});

const registryPath = path.join(app.getPath('userData'), 'inkwells-registry.json');
console.log('[Registry] Registry file path:', registryPath);

ipcMain.handle('load-registry', () => {
  console.log('[Registry] Loading registry...');
  try {
    if (fs.existsSync(registryPath)) {
      const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      console.log('[Registry] Loaded', data.notebooks?.length || 0, 'entries');
      return data;
    }
    console.log('[Registry] No registry file found');
  } catch (err) {
    console.error('[Registry] Load error:', err);
  }
  return { notebooks: [] };
});

ipcMain.handle('save-registry', (_, data) => {
  console.log('[Registry] Saving registry with', data.notebooks?.length || 0, 'entries');
  try {
    fs.writeFileSync(registryPath, JSON.stringify(data, null, 2));
    console.log('[Registry] ✓ Registry saved');
    return true;
  } catch (err) {
    console.error('[Registry] Save error:', err);
    throw err;
  }
});

ipcMain.handle('delete-file', async (_, filePath) => {
  if (!pfadErlaubt(filePath)) return pfadAbgelehnt('Löschen', filePath);
  console.log('[Delete] Deleting file:', filePath);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[Delete] ✓ File deleted');
      return { success: true };
    } else {
      console.log('[Delete] File not found:', filePath);
      return { success: false, error: 'File not found' };
    }
  } catch (err) {
    console.error('[Delete] ✗ Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('move-file', async (_, oldPath, newPath) => {
  if (!pfadErlaubt(oldPath)) return pfadAbgelehnt('Verschieben (Quelle)', oldPath);
  if (!pfadErlaubt(newPath)) return pfadAbgelehnt('Verschieben (Ziel)', newPath);
  console.log('[Move] Moving file:', oldPath, '->', newPath);
  try {
    if (!fs.existsSync(oldPath)) {
      return { success: false, error: 'Source file not found' };
    }
    const newDir = path.dirname(newPath);
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }
    fs.renameSync(oldPath, newPath);
    console.log('[Move] ✓ File moved');
    return { success: true };
  } catch (err) {
    console.error('[Move] ✗ Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('file-exists', async (_, filePath) => {
  if (!pfadErlaubt(filePath)) return false;
  return fs.existsSync(filePath);
});

/* ══════════════════════════════════════════════════════════════════════
   GRIFFBEREIT — UNTERLAGEN NEBEN DEM HEFT

   Wer mitschreibt, hat meistens etwas daneben liegen: ein Skript als
   PDF, ein abfotografiertes Tafelbild. Bisher blieb nur, es in eine
   Seite einzufügen – damit lag es IM Heft, wurde mitgespeichert und
   mitsynchronisiert, obwohl es nur zum Nachsehen da war.

   Griffbereit heisst deshalb: NICHT kopieren. Gemerkt wird der Pfad,
   sonst nichts. Ist die Datei verschoben oder weg, sagt die Oberfläche
   das – ein zweiter Stand, der still veraltet, entsteht gar nicht erst.

   >>> Warum die Liste hier liegt und nicht in den Einstellungen <<<
   Sie ist zugleich die Erlaubnisliste. 'load-from-path' nimmt nur Pfade
   unter dem Speicherort an (pfadErlaubt) – hier geht es dagegen um
   Dateien, die überall liegen dürfen. Der Hauptprozess muss deshalb
   selbst wissen, welche das sind. Stünde die Liste in der
   Einstellungsdatei, die das Fenster schreibt, könnte sich das Fenster
   die Erlaubnis für jeden beliebigen Pfad selbst ausstellen.

   Ein Pfad kommt darum nur über 'griffAngebote' herein, und die füllen
   sich auf zwei Wegen: aus dem Auswahlfenster des Betriebssystems (der
   Pfad entsteht hier drüben, das Fenster nennt ihn nie) und aus einer
   abgelegten Datei. Beim Ablegen nennt das Fenster den Pfad – anders
   geht es nicht, ein Ereignis der Maus sieht der Hauptprozess nicht.
   Dort bleibt als Schranke die Endung: lesbar wird dadurch höchstens
   ein Bild oder ein PDF, nicht die Schlüsseldatei daneben.

   Gelesen wird immer über die Kennung, nie über einen Pfad aus dem
   Fenster. Was nicht in der Liste steht, gibt es für 'griff-lesen' nicht.
   ══════════════════════════════════════════════════════════════════════ */
const griffPath = path.join(app.getPath('userData'), 'inkwells-griffbereit.json');

// Drei Dateien. Mehr Reiter wären am rechten Rand nur noch Streifen.
const GRIFF_MAX = 3;

// Was sich anzeigen lässt. Alles andere wird gar nicht erst angeboten.
const GRIFF_ARTEN = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf'
};

/* >>> Die Grenze gilt nur noch für BILDER <<<
   Sie stand einmal bei 120 MB für alles, weil der Inhalt am Stück durch
   die Brücke ging: einmal gelesen, einmal für das Fenster kopiert,
   einmal in pdf.js – ein abfotografiertes Buch sprengte das, und statt
   des Buchs stand „zu groß" da.

   Ein PDF geht jetzt gar nicht mehr durch die Brücke, sondern über den
   Oberflächen-Server (griffAusliefern). pdf.js holt sich daraus nur die
   Stücke, die es für die gerade sichtbaren Seiten braucht; wie dick das
   Buch ist, spielt für den Speicher keine Rolle mehr. Deshalb hat es
   auch keine Grenze mehr.

   Ein Bild dagegen liegt beim Anzeigen immer ganz im Speicher – dort
   bleibt eine Grenze sinnvoll. */
const GRIFF_BILD_MAX_BYTES = 120 * 1024 * 1024;

/* Die Zufallsfolge in der Adresse einer Unterlage. Sie entsteht mit
   jedem Start neu und steht nirgends auf der Platte.

   Der Oberflächen-Server hört auf localhost und gibt sonst nur das
   heraus, was in src/ liegt. Ab hier gibt er auch Dateien heraus, die
   irgendwo auf der Platte liegen – dann soll ein anderes Programm auf
   demselben Rechner nicht durch Raten von /griff/g123 an sie kommen. */
const GRIFF_TOKEN = crypto.randomBytes(24).toString('hex');

/* Ohne Herkunft: die Oberfläche liegt auf demselben Server, und relativ
   bleibt die Adresse auch dann richtig, wenn der bevorzugte Port belegt
   war und ein anderer genommen wurde. */
function griffAdresse(nbId, id) {
  return '/griff/' + GRIFF_TOKEN
    + '/' + encodeURIComponent(String(nbId || ''))
    + '/' + encodeURIComponent(String(id));
}

function griffArt(p) {
  const mime = GRIFF_ARTEN[path.extname(String(p || '')).toLowerCase()];
  if (!mime) return null;
  return { mime, art: mime === 'application/pdf' ? 'pdf' : 'bild' };
}

/** Was das Fenster schicken darf – der Rest der Zeile bleibt, wie er ist. */
function griffMass(wert, klein, gross, vorgabe) {
  const n = Number(wert);
  if (!Number.isFinite(n)) return vorgabe;
  return Math.min(gross, Math.max(klein, n));
}

/* ══ DER GEMERKTE STAND ═══════════════════════════════════════════════

   >>> Warum die Datei nicht mehr bei jedem Zugriff gelesen wird <<<
   Seit ein PDF stückweise geholt wird, geht JEDE Bereichsanfrage durch
   griffAusliefern – und die rief griffLies, also einmal statSync,
   einmal readFileSync, einmal JSON.parse pro Anfrage. Beim Rollen in
   einem Buch sind das Dutzende Lesevorgänge derselben unveränderten
   Datei in der Sekunde.

   Das kostet nicht nur; es geht auch schief. Unter Windows schlägt ein
   Dateizugriff hin und wieder mit EPERM oder EBUSY fehl, weil der
   Virenscanner oder die Ordnersynchronisierung die Datei gerade offen
   hat. Beim Bauen dieser Änderung ist genau das hier aufgetreten.

   >>> Und warum das so schlimm war <<<
   Der Fehler wurde gefangen, und zurück kam eine LEERE LISTE. Eine leere
   Liste ist aber keine Auskunft, sondern eine Falschaussage: das Fenster
   liest daraus, dass es die Unterlage nicht mehr gibt. Die Reiter
   verschwinden, die offene Datei geht zu, ihr Inhalt wird weggeräumt –
   und das nächste Aufschlagen lädt das ganze Buch neu. Genau so wurde es
   gemeldet: „es bleibt nicht offen, und dann lädt es wieder".

   Jetzt wird nur gelesen, wenn sich die Datei wirklich geändert hat, und
   ein Fehlschlag lässt den letzten guten Stand stehen, statt ihn durch
   eine Unwahrheit zu ersetzen. */
/* ══ EIN FACH JE HEFT ══════════════════════════════════════════════════

   >>> Warum die Unterlagen nicht mehr für alle gelten <<<
   Die Liste stand einmal für die ganze App. Wer in einem Heft ein Skript
   danebenlegte, hatte es damit in JEDEM Heft am Rand stehen – auch in
   dem, in dem es nichts zu suchen hat. Unterlagen gehören aber zu dem,
   woran man gerade arbeitet.

   Die Datei trägt deshalb jetzt:

     { hefte: { "<Heft-Kennung>": { versteckt, dateien: [...] } } }

   >>> Warum trotzdem hier und nicht im Heft <<<
   Weil darin PFADE stehen. Ein Pfad gilt auf diesem Rechner und sonst
   nirgends: im Heft läge er in der Freigabe, im Abgleich und beim
   Kollegen, wo er nichts bedeutet und nichts öffnet. Örtlich bleibt
   örtlich – verbunden wird über die Kennung des Hefts.
   ══════════════════════════════════════════════════════════════════════ */

let griffStand = null;      // der Stand, wie er zuletzt richtig gelesen wurde
let griffStandZeit = -1;    // Änderungszeit der Datei dazu

function griffLeer() { return { hefte: {}, erbe: null }; }

/** Ein Heftfach in Form bringen – aus beliebigem Inhalt der Datei. */
function griffFach(roh) {
  const dateien = Array.isArray(roh && roh.dateien) ? roh.dateien : [];
  return {
    versteckt: !!(roh && roh.versteckt),
    dateien: dateien.filter(d => d && d.id && d.pfad).slice(0, GRIFF_MAX)
  };
}

/**
 * Den ganzen Stand in Form bringen.
 *
 * Eine Datei aus der Zeit vor den Fächern trägt die Liste unmittelbar.
 * Weggeworfen wird sie nicht – sie wandert als „Erbe" zur Seite und geht
 * an das erste Heft, das danach fragt (griffHeft). Welches das ist, kann
 * hier niemand wissen; das offene Heft ist die einzige sinnvolle Antwort.
 */
function griffForm(roh) {
  if (roh && roh.hefte && typeof roh.hefte === 'object') {
    const hefte = {};
    for (const [id, fach] of Object.entries(roh.hefte)) hefte[String(id)] = griffFach(fach);
    return { hefte, erbe: (roh.erbe && Array.isArray(roh.erbe.dateien)) ? griffFach(roh.erbe) : null };
  }
  if (roh && Array.isArray(roh.dateien)) return { hefte: {}, erbe: griffFach(roh) };
  return griffLeer();
}

function griffLies() {
  try {
    const stat = fs.statSync(griffPath);
    // Unverändert: der gemerkte Stand ist derselbe, den die Datei enthält
    if (griffStand && stat.mtimeMs === griffStandZeit) return griffStand;

    griffStand = griffForm(JSON.parse(fs.readFileSync(griffPath, 'utf-8')));
    griffStandZeit = stat.mtimeMs;
    return griffStand;
  } catch (err) {
    /* >>> Keine Datei heisst NICHT: nichts da <<<
       Hier wurde bei ENOENT ein frischer, leerer Stand angelegt – und
       damit alles weggeworfen, was schon im Speicher stand und nur noch
       nicht geschrieben war. Genau das passierte beim allerersten
       Hinzufügen auf einem Rechner ohne diese Datei:

         griffHeft()   legt das Fach des Hefts an – im Speicher
         push          die Unterlage kommt hinein
         griffSchreib  ruft griffLies() … und bekommt einen LEEREN Stand
                       zurück, der dann gespeichert wird

       Die Antwort ans Fenster trug die Datei noch, die Platte nicht. Beim
       nächsten Blick war sie weg. Gemeldet als „ich kann nichts mehr
       hinzufügen, es taucht in der Liste nicht auf".

       Fehlt die Datei, gilt deshalb weiter, was im Speicher steht; leer
       wird es nur, wenn dort auch nichts ist. Die Zeit auf -1, damit der
       nächste erfolgreiche Blick wirklich neu liest. */
    if (err && err.code === 'ENOENT') {
      if (!griffStand) griffStand = griffLeer();
      griffStandZeit = -1;
      return griffStand;
    }
    console.error('[Griffbereit] Laden fehlgeschlagen:', err.message);
  }
  return griffStand || griffLeer();
}

/**
 * Das Fach eines Hefts – und legt es an, wenn es noch keines gibt.
 *
 * Ohne Heft gibt es nichts: auf der Übersicht liegt keine Unterlage
 * daneben, und ein Fach unter leerer Kennung wäre wieder eine Liste für
 * alle.
 */
function griffHeft(nbId) {
  const schluessel = String(nbId || '').trim();
  if (!schluessel) return griffFach(null);

  const stand = griffLies();
  if (!stand.hefte[schluessel]) {
    stand.hefte[schluessel] = stand.erbe || griffFach(null);
    if (stand.erbe) { stand.erbe = null; griffSichere(stand); }
  }
  return stand.hefte[schluessel];
}

function griffSichere(stand) {
  try {
    fs.writeFileSync(griffPath, JSON.stringify(stand, null, 2), 'utf-8');
    /* Den eigenen Schreibvorgang gleich übernehmen, statt ihn im nächsten
       Zug wieder einzulesen. Die Zeit dazu kommt aus der Datei selbst –
       geraten wäre sie beim nächsten Vergleich falsch. */
    griffStand = stand;
    try { griffStandZeit = fs.statSync(griffPath).mtimeMs; }
    catch (err2) { griffStandZeit = -1; }
  } catch (err) {
    console.error('[Griffbereit] Sichern fehlgeschlagen:', err.message);
  }
}

/** Sichern und dem Fenster den Stand DIESES Hefts zurückgeben. */
function griffSchreib(fach) {
  griffSichere(griffLies());
  return griffAntwort(fach);
}

/* Ob die Datei noch da ist, wird bei JEDER Antwort nachgesehen und nie
   gespeichert: sie kann zwischen zwei Blicken verschwinden, und ein
   gemerktes „ist da" wäre dann eine Auskunft, die bis zum Neustart hält
   und nicht stimmt. */
function griffAntwort(stand) {
  return {
    versteckt: !!stand.versteckt,
    dateien: stand.dateien.map(d => {
      let da = false;
      try { da = fs.existsSync(d.pfad); } catch (err) { da = false; }
      return {
        id: d.id, name: d.name, art: d.art,
        breite: d.breite, stelle: d.stelle, zoom: d.zoom, quer: d.quer,
        zuletzt: d.zuletzt || 0, da
      };
    })
  };
}

/* ══ DER WEG INS FENSTER ═══════════════════════════════════════════════

   Aufgerufen aus startUiServer für jede Adresse unter /griff/. Sie
   lautet /griff/<Zufallsfolge>/<Kennung> – die Kennung ist dieselbe wie
   in der Liste, ein Pfad steht nie darin. Was nicht in der Liste steht,
   gibt es hier nicht.

   Bereiche (Range) werden beantwortet, und daran hängt alles: erst
   dadurch kann pdf.js sich Seite 400 holen, ohne die 399 davor gelesen
   zu haben.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Was aus einer Range-Kopfzeile wirklich geschickt werden soll.
 *
 * Rückgabe: null (alles), 'kaputt' (416) oder { von, bis } einschliesslich.
 * Mehrere Bereiche in einer Anfrage beantwortet auch dieser Server mit
 * der ganzen Datei – erlaubt ist das, und pdf.js fragt nie danach.
 */
function griffBereich(kopfzeile, groesse) {
  if (!kopfzeile) return null;
  const m = /^bytes=([0-9]*)-([0-9]*)$/.exec(String(kopfzeile).trim());
  if (!m) return null;
  const hatVon = m[1] !== '';
  const hatBis = m[2] !== '';
  if (!hatVon && !hatBis) return 'kaputt';

  let von, bis;
  if (!hatVon) {
    // "bytes=-500" heisst: die letzten 500 Byte. So sucht pdf.js den Katalog.
    const n = Number(m[2]);
    if (!n) return 'kaputt';
    von = Math.max(0, groesse - n);
    bis = groesse - 1;
  } else {
    von = Number(m[1]);
    bis = hatBis ? Math.min(Number(m[2]), groesse - 1) : groesse - 1;
  }
  if (!Number.isFinite(von) || !Number.isFinite(bis)) return 'kaputt';
  if (von < 0 || von > bis || von >= groesse) return 'kaputt';
  return { von, bis };
}

function griffAusliefern(rel, req, res) {
  // '', 'griff', Zufallsfolge, Heft, Kennung
  const teile = rel.split('/');
  const weg = () => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Nicht gefunden'); };
  if (teile.length !== 5 || teile[2] !== GRIFF_TOKEN || !teile[3] || !teile[4]) return weg();

  /* Gesucht wird im Fach DIESES Hefts. Eine Kennung aus einem anderen
     Heft gibt es hier nicht – das ist dieselbe Schranke wie bisher, nur
     eine Ebene enger. */
  const d = griffHeft(decodeURIComponent(teile[3])).dateien.find(x => x.id === teile[4]);
  if (!d) return weg();

  /* Die Endung entscheidet auch hier noch einmal: die Datei am gemerkten
     Pfad kann seit dem Aufnehmen eine andere geworden sein. */
  const art = griffArt(d.pfad);
  if (!art) return weg();

  let stat;
  try { stat = fs.statSync(d.pfad); } catch (err) { return weg(); }
  if (!stat.isFile()) return weg();

  const kopf = {
    'Content-Type': art.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    // Die Endung sagt, was es ist – der Inhalt soll nicht mitreden dürfen
    'X-Content-Type-Options': 'nosniff'
  };

  const bereich = griffBereich(req.headers.range, stat.size);
  if (bereich === 'kaputt') {
    res.writeHead(416, Object.assign({}, kopf, { 'Content-Range': 'bytes */' + stat.size }));
    res.end();
    return;
  }

  const von = bereich ? bereich.von : 0;
  const bis = bereich ? bereich.bis : stat.size - 1;
  if (bereich) {
    kopf['Content-Range'] = 'bytes ' + von + '-' + bis + '/' + stat.size;
  }
  kopf['Content-Length'] = bis - von + 1;
  res.writeHead(bereich ? 206 : 200, kopf);
  if (req.method === 'HEAD') { res.end(); return; }

  /* Gestreamt und nicht am Stück gelesen: sonst läge das Buch beim
     Ausliefern doch wieder ganz im Speicher. */
  const strom = fs.createReadStream(d.pfad, { start: von, end: bis });
  strom.on('error', () => res.destroy());
  res.on('close', () => strom.destroy());
  strom.pipe(res);
}

/* Ausgesuchte Dateien, die noch keinen Namen haben. Sie liegen hier, bis
   das Fenster nach dem Namen gefragt hat – erst dann werden sie
   übernommen. Ein abgebrochener Dialog lässt den Eintrag zurück; er
   kostet ein paar Zeichen und ist mit dem Beenden weg. */
const griffAngebote = new Map();

function griffBiete(pfad) {
  const art = griffArt(pfad);
  if (!art) return null;
  const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  griffAngebote.set(id, { pfad, art: art.art });
  // Ohne Endung: der Vorschlag steht im Namensfeld, dort ist „.pdf" Ballast
  return { id, art: art.art, vorschlag: path.basename(pfad, path.extname(pfad)) };
}

ipcMain.handle('griff-liste', (_, nbId) => griffAntwort(griffHeft(nbId)));

ipcMain.handle('griff-waehlen', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Bilder & PDFs', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return null;
  return griffBiete(r.filePaths[0]);
});

/* Abgelegte Dateien. Der Pfad kommt aus dem Fenster (webUtils, siehe
   preload.js) und wird deshalb hier auf Endung und Vorhandensein
   geprüft, bevor ein Angebot daraus wird. */
ipcMain.handle('griff-abgelegt', (_, pfade) => {
  const liste = Array.isArray(pfade) ? pfade : [pfade];
  const raus = [];
  for (const p of liste) {
    if (typeof p !== 'string' || !p) continue;
    if (!griffArt(p)) continue;
    try { if (!fs.statSync(p).isFile()) continue; } catch (err) { continue; }
    const angebot = griffBiete(p);
    if (angebot) raus.push(angebot);
  }
  return raus;
});

function griffUebernimm(nbId, id, name) {
  if (!String(nbId || '').trim()) return { fehler: 'kein Heft' };
  const angebot = griffAngebote.get(String(id));
  if (!angebot) return { fehler: 'unbekannt' };
  griffAngebote.delete(String(id));

  const fach = griffHeft(nbId);
  if (fach.dateien.length >= GRIFF_MAX) return { fehler: 'voll' };

  fach.dateien.push({
    id: String(id),
    name: String(name || '').trim().slice(0, 40) || path.basename(angebot.pfad),
    pfad: angebot.pfad,
    art: angebot.art,
    breite: 0,     // 0 heisst „noch nie eingestellt" – dann gilt die Vorgabe
    stelle: 0,     // wie weit hineingerollt, als Anteil (0 … 1)
    zoom: 1,       // 1 heisst: eine Seite so breit wie die Spalte
    quer: 0        // wie weit nach rechts geschoben, ebenfalls als Anteil
  });
  return griffSchreib(fach);
}
ipcMain.handle('griff-uebernehmen', (_, nbId, id, name) => griffUebernimm(nbId, id, name));

function griffAendere(nbId, id, patch) {
  const fach = griffHeft(nbId);
  const d = fach.dateien.find(x => x.id === String(id));
  if (!d) return griffAntwort(fach);

  if (patch && typeof patch.name === 'string') {
    const n = patch.name.trim().slice(0, 40);
    if (n) d.name = n;
  }
  if (patch && 'breite' in patch) d.breite = Math.round(griffMass(patch.breite, 0, 4000, d.breite));
  if (patch && 'stelle' in patch) d.stelle = griffMass(patch.stelle, 0, 1, d.stelle);
  /* Dieselben Grenzen wie in der Oberfläche (ui/griffbereit.js). Sie
     stehen hier ein zweites Mal, weil eine von Hand geänderte Datei
     sonst eine Unterlage in 40-facher Vergrößerung aufschlüge – und
     eine Leinwand in dieser Größe legt die Anzeige lahm. */
  if (patch && 'zoom' in patch) d.zoom = griffMass(patch.zoom, 0.5, 4, d.zoom);
  if (patch && 'quer' in patch) d.quer = griffMass(patch.quer, 0, 1, d.quer);
  /* Wann sie zuletzt offen stand. Daran hängt, welche Unterlage beim
     Aufschlagen des Hefts als Erste im Hintergrund geladen wird – die
     zuletzt benutzte ist die, die man gleich wieder braucht. */
  if (patch && patch.zuletzt) d.zuletzt = Date.now();
  return griffSchreib(fach);
}
ipcMain.handle('griff-aendern', (_, nbId, id, patch) => griffAendere(nbId, id, patch));

function griffEntferne(nbId, id) {
  const fach = griffHeft(nbId);
  fach.dateien = fach.dateien.filter(d => d.id !== String(id));
  return griffSchreib(fach);
}
ipcMain.handle('griff-entfernen', (_, nbId, id) => griffEntferne(nbId, id));

/* Umsortieren. Das Fenster schickt die Kennungen in der neuen Folge; was
   nicht darin vorkommt, hängt sich hinten an – so kann eine Liste, die
   im Fenster gerade veraltet ist, keinen Eintrag verschlucken. Unter
   sich behalten diese Nachzügler ihre Reihenfolge (sort ist stabil). */
function griffOrdne(dateien, ids) {
  const folge = Array.isArray(ids) ? ids.map(String) : [];
  const platz = (d) => { const i = folge.indexOf(d.id); return i === -1 ? 99 : i; };
  return dateien.slice().sort((a, b) => platz(a) - platz(b));
}

function griffOrdneHeft(nbId, ids) {
  const fach = griffHeft(nbId);
  fach.dateien = griffOrdne(fach.dateien, ids);
  return griffSchreib(fach);
}
ipcMain.handle('griff-ordnen', (_, nbId, ids) => griffOrdneHeft(nbId, ids));

function griffVerstecke(nbId, an) {
  const fach = griffHeft(nbId);
  fach.versteckt = !!an;
  return griffSchreib(fach);
}
ipcMain.handle('griff-verstecken', (_, nbId, an) => griffVerstecke(nbId, an));

ipcMain.handle('griff-lesen', (_, nbId, id) => {
  const d = griffHeft(nbId).dateien.find(x => x.id === String(id));
  if (!d) return { ok: false, grund: 'unbekannt' };

  /* Die Endung entscheidet auch beim Lesen noch einmal: die Datei am
     gemerkten Pfad kann seit dem Aufnehmen durch eine andere ersetzt
     worden sein. */
  const art = griffArt(d.pfad);
  if (!art) return { ok: false, grund: 'art' };

  try {
    const stat = fs.statSync(d.pfad);
    if (!stat.isFile()) return { ok: false, grund: 'fehlt' };

    /* Ein PDF bekommt nur die Adresse: es wird stückweise geholt
       (griffAusliefern), und wie dick es ist, ist damit gleichgültig.
       Ein Bild kommt weiter am Stück – es liegt beim Anzeigen ohnehin
       ganz im Speicher, und ein Bild von über 120 MB ist keins mehr,
       das sich neben dem Heft anschauen liesse. */
    if (d.art === 'pdf') {
      return { ok: true, art: 'pdf', mime: art.mime, adresse: griffAdresse(nbId, d.id) };
    }
    if (stat.size > GRIFF_BILD_MAX_BYTES) return { ok: false, grund: 'gross' };
    return { ok: true, art: d.art, mime: art.mime, bytes: fs.readFileSync(d.pfad) };
  } catch (err) {
    return { ok: false, grund: 'fehlt' };
  }
});
