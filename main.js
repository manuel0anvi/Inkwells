const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

let releaseInfo = null;
let downloadedUpdatePath = null;
let activeDownloadRes = null;
let isDownloadPaused = false;

function normalizeVersion(v) {
  return String(v).replace(/^v/i, '').trim();
}
function compareVersions(v1, v2) {
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0, n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Inkwell-Updater' } }, res => {
      let data = '';
      if (res.statusCode === 301 || res.statusCode === 302) return fetchJson(res.headers.location).then(resolve).catch(reject);
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
      
      activeDownloadRes = res;
      isDownloadPaused = false;
      
      const file = fs.createWriteStream(dest);
      const total = parseInt(res.headers['content-length'], 10) || 0;
      let downloaded = 0;
      res.on('data', chunk => {
        downloaded += chunk.length;
        if (total > 0 && win) {
          try { win.webContents.send('download-progress', { percent: (downloaded / total) * 100, paused: isDownloadPaused }); } catch (e) {}
        }
      });
      res.pipe(file);
      file.on('finish', () => { 
        activeDownloadRes = null;
        file.close(); resolve(); 
      });
    }).on('error', err => { 
      activeDownloadRes = null;
      fs.unlink(dest, () => {}); reject(err); 
    });
  });
}
async function getLatestGitHubRelease() {
  try {
    const data = await fetchJson('https://api.github.com/repos/manuel0anvi/Inkwell/releases/latest');
    if (!data || !data.tag_name) return null;
    const exeAsset = data.assets && data.assets.find(a => a.name.endsWith('.exe'));
    if (!exeAsset) return null;
    return { version: normalizeVersion(data.tag_name), url: exeAsset.browser_download_url, name: exeAsset.name };
  } catch (err) {
    console.error('Update check failed:', err);
    return null;
  }
}

let win;
let pendingFilePath = null; // File to open when app is ready
let pendingDeepLink = null; // Protocol deep link (inkwell://) received before renderer ready
// Freigabe-Link (inkwell://share/<linkId>), der vor dem Fensterstart ankam
let pendingShareLink = null;

/* ── Zweites Exemplar mit eigenen Daten ───────────────────────────────
   Inkwell läuft normalerweise nur einmal: ein zweiter Start meldet sich
   beim ersten und beendet sich selbst. Das ist richtig so – zwei Fenster
   auf denselben Dateien wären eine Fehlerquelle.

   Zum Ausprobieren der Zusammenarbeit braucht man aber genau das: zwei
   Exemplare nebeneinander, mit ZWEI verschiedenen Konten. Dafür gibt es
   ein eigenes Profil:

       Inkwell.exe --profile=zweite
       set INKWELL_PROFILE=zweite && Inkwell.exe
       npm start -- --profile=zweite

   Ein Profil bekommt einen eigenen Ordner unter
   %LOCALAPPDATA%\Inkwell\Profiles\<name> – eigene Einstellungen, eigene
   Anmeldung, eigene Heft-Übersicht. Damit ist es für Firebase eine
   andere Person, und man kann sich selbst etwas freigeben.

   Ohne Angabe bleibt alles wie bisher: derselbe Ordner, dieselbe Sperre
   gegen ein zweites Exemplar.
   ─────────────────────────────────────────────────────────────────── */
function readProfileName() {
  const fromArgs = process.argv.find(a => typeof a === 'string' && a.startsWith('--profile='));
  const raw = fromArgs ? fromArgs.slice('--profile='.length) : (process.env.INKWELL_PROFILE || '');
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
    if (arg.endsWith('.jrnl') && fs.existsSync(arg)) {
      return arg;
    }
  }
  return null;
}

// Check command line args on startup
pendingFilePath = getFileFromArgs(process.argv);
// Capture any protocol deep-link passed on startup (Windows: first run with protocol)
for (const a of process.argv) {
  if (typeof a === 'string' && a.startsWith('inkwell://')) {
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
  const base = path.join(localRoot, 'Inkwell');
  return profile ? path.join(base, 'Profiles', profile) : base;
}

function configureAppStoragePaths() {
  if (process.platform !== 'win32') return;

  const storageRoot = storageRootFor(PROFILE);

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
          'Cache-Control': 'no-store'
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
  for (const ch of `inkwell-ui:${PROFILE || ''}`) {
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
    title: PROFILE ? `Inkwell — ${PROFILE}` : 'Inkwell',
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

  /* Die Seite trägt <title>Inkwell</title> und überschreibt damit den
     Titel, den das Fenster mitbekommen hat. Bei einem Profil muss der
     Name aber stehen bleiben – sonst heißen beide Fenster gleich. */
  if (PROFILE) {
    win.on('page-title-updated', (event) => {
      event.preventDefault();
      win.setTitle(`Inkwell — ${PROFILE}`);
    });
  }

  win.loadURL(`${uiOrigin}/index.html`);
  Menu.setApplicationMenu(null);

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
     eigenen, teils technischen Überschriften. */
  win.webContents.on('did-create-window', (child) => {
    child.once('ready-to-show', () => child.show());
    // Falls die Seite gar nicht lädt, soll das Fenster trotzdem erscheinen
    setTimeout(() => { if (!child.isDestroyed() && !child.isVisible()) child.show(); }, 4000);
    child.on('page-title-updated', (event) => {
      event.preventDefault();
      child.setTitle('Bei Microsoft anmelden');
    });
  });

  // Start maximized/fullscreen
  win.maximize();

  // Show only when fully loaded (prevents white/transparent flash)
  win.once('ready-to-show', () => win.show());

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

    try {
      win.webContents.send('app-before-quit');
    } catch (err) {
      console.warn('[Quit] Renderer nicht erreichbar, schließe direkt:', err);
      forceClose();
      return;
    }

    // Antwortet die Oberfläche nicht (hängt/abgestürzt), trotzdem schließen.
    // Großzügig bemessen: erst wird lokal gespeichert, danach bekommt der
    // Cloud-Upload noch bis zu 3 Sekunden (siehe core/init.js).
    clearTimeout(closeFallbackTimer);
    closeFallbackTimer = setTimeout(() => {
      console.warn('[Quit] Keine Antwort beim Speichern, schließe nach Zeitablauf');
      forceClose();
    }, 8000);
  });
}

// Steuert, ob win.on('close') noch einmal abbricht, um speichern zu lassen
let allowClose = false;
let closeFallbackTimer = null;

function forceClose() {
  clearTimeout(closeFallbackTimer);
  allowClose = true;
  if (win && !win.isDestroyed()) win.close();
}

// Die Oberfläche meldet: alles gespeichert, es kann geschlossen werden
ipcMain.on('confirm-quit', () => {
  forceClose();
});

// IPC handlers for update control
ipcMain.handle('check-for-updates', async () => {
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

ipcMain.handle('install-and-restart', () => {
  if (!downloadedUpdatePath || !fs.existsSync(downloadedUpdatePath)) return { ok: false, err: 'Update file not found' };
  try {
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

ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url);
  return true;
});

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

/* ── Weiche für inkwell:// ─────────────────────────────────────────────
   Bisher landete JEDER Aufruf des Protokolls beim OAuth-Rückruf. Seit es
   geteilte Dokumente gibt, kommt auch "inkwell://share/<linkId>" an – das
   ist keine Anmeldung, sondern ein Dokument, das geöffnet werden soll.

   Rückgabe: 'share' (mit Kennung) oder 'oauth'.
   ─────────────────────────────────────────────────────────────────── */
function classifyDeepLink(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return { kind: 'oauth' };

  const match = /^inkwell:\/\/share\/([^/?#]+)/i.exec(urlStr.trim());
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

function extractOAuthCallback(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;

  let paramStr = '';
  if (urlStr.includes('#')) {
    paramStr = urlStr.split('#')[1] || '';
  } else if (urlStr.includes('?')) {
    paramStr = urlStr.split('?')[1] || '';
  }

  const params = new URLSearchParams(paramStr);
  return {
    url: urlStr,
    accessToken: params.get('access_token') || '',
    refreshToken: params.get('refresh_token') || '',
    providerToken: params.get('provider_token') || '',
    providerRefreshToken: params.get('provider_refresh_token') || ''
  };
}

let oauthServer = null;

ipcMain.handle('start-oauth-server', async () => {
  return new Promise((resolve, reject) => {
    if (oauthServer) {
      oauthServer.close();
      oauthServer = null;
    }

    oauthServer = http.createServer((req, res) => {
      console.log(`[OAuthServer] Received request: ${req.method} ${req.url}`);
      // Google liefert den Access-Token im URL-Fragment (#access_token=...).
      // Fragmente erreichen den Server nie, deshalb wird eine kleine HTML-Seite
      // ausgeliefert, die das Fragment per JS ausliest und zurück-POSTet.
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="de">
            <head>
              <meta charset="utf-8">
              <title>Inkwell — Anmeldung</title>
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

                // 1. Fall: Ein Fehler wurde übergeben (egal ob Google oder Microsoft)
                if (search && search.includes('error=')) {
                  fetch('/callback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: search.substring(1)
                  }).finally(() => {
                    msg.innerHTML = 'Anmeldung abgebrochen. Du kannst dieses Fenster schlie&szlig;en.';
                  });
                } 
                // 2. Fall: Erfolgreicher Microsoft-Login (liefert ?code=...)
                else if (search) {
                  fetch('/callback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: search.substring(1)
                  }).then(() => {
                    msg.innerHTML = 'Anmeldung erfolgreich! Du kannst dieses Fenster schlie&szlig;en und zu <span class="gold">Inkwell</span> zur&uuml;ckkehren.';
                    setTimeout(() => window.close(), 1500);
                  }).catch((err) => {
                    msg.innerHTML = 'Fehler bei der Anmeldung.';
                    console.error("Fetch error:", err);
                  });
                } 
                // 3. Fall: Erfolgreicher Google-Login (liefert #access_token=...)
                else if (hash) {
                  fetch('/callback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: hash.substring(1)
                  }).then(() => {
                    msg.innerHTML = 'Anmeldung erfolgreich! Du kannst dieses Fenster schlie&szlig;en und zu <span class="gold">Inkwell</span> zur&uuml;ckkehren.';
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
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
          console.log(`[OAuthServer] Received POST with token length: ${body.length}`);
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
          res.end('ok');
          
          if (win) {
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


ipcMain.handle('start-oauth', async (_, url) => {
  if (!win) return { ok: false, err: 'Main window not ready' };
  if (!url || typeof url !== 'string') return { ok: false, err: 'Missing OAuth URL' };

  const popup = new BrowserWindow({
    width: 540,
    height: 760,
    parent: win,
    modal: false,
    show: true,
    backgroundColor: '#12121a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:oauth'
    }
  });

  const finishIfCallback = async (candidateUrl) => {
    const result = extractOAuthCallback(candidateUrl);
    if (!result || !result.accessToken) return false;

    console.log('[Auth] OAuth callback captured in popup:', candidateUrl);
    try { win.webContents.send('oauth-callback', candidateUrl); } catch (e) { console.warn('[main] Failed to forward oauth callback:', e); }
    if (!popup.isDestroyed()) popup.close();
    return true;
  };

  popup.webContents.on('will-redirect', (event, candidateUrl) => {
    if (extractOAuthCallback(candidateUrl)) {
      event.preventDefault();
      finishIfCallback(candidateUrl).catch(err => console.error('[main] OAuth callback handling failed:', err));
    }
  });

  popup.webContents.on('will-navigate', (event, candidateUrl) => {
    if (extractOAuthCallback(candidateUrl)) {
      event.preventDefault();
      finishIfCallback(candidateUrl).catch(err => console.error('[main] OAuth callback handling failed:', err));
    }
  });

  popup.webContents.on('did-navigate', (event, candidateUrl) => {
    finishIfCallback(candidateUrl).catch(err => console.error('[main] OAuth callback handling failed:', err));
  });

  popup.on('closed', () => {
    if (win && !win.isDestroyed()) {
      try { win.webContents.send('oauth-popup-closed'); } catch (e) {}
    }
  });

  try {
    await popup.loadURL(url);
    return { ok: true };
  } catch (err) {
    if (!popup.isDestroyed()) popup.close();
    return { ok: false, err: String(err) };
  }
});

/* Ensure custom protocol is registered.

   Ein Exemplar mit Profil meldet sich NICHT an. inkwell://-Adressen
   sollen weiter bei der gewöhnlichen Installation landen; ein zum
   Ausprobieren nebenherlaufendes zweites Exemplar würde die Anmeldung
   sonst an sich reißen und behielte sie auch, nachdem es beendet ist. */
if (PROFILE) {
  console.log('[main] Profil "' + PROFILE + '" – Protokoll inkwell:// wird nicht beansprucht');
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
    app.setAsDefaultProtocolClient('inkwell', process.execPath, args);
  }
} else {
  app.setAsDefaultProtocolClient('inkwell');
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
    dialog.showErrorBox('Inkwell', 'Die Oberfläche konnte nicht gestartet werden:\n' + err.message);
    app.quit();
    return;
  }

  createWindow();
  
  // If started with a file, open it after window is ready
  if (pendingFilePath) {
    console.log('[journal] Opening file from args:', pendingFilePath);
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        win.webContents.send('open-file', pendingFilePath);
      }, 500); // Small delay to ensure app is initialized
    });
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
  const urlArg = argv.find(arg => arg.startsWith('inkwell://'));
  if (urlArg) {
    routeDeepLink(urlArg);
    return;
  }

  // Check if second instance was opened with a file
  const filePath = getFileFromArgs(argv);
  if (filePath) {
    console.log('[journal] Opening file from second instance:', filePath);
    win.webContents.send('open-file', filePath);
  }
});
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url && url.startsWith('inkwell://')) routeDeepLink(url);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  // Ohne laufenden Server gäbe es nichts zu laden (macOS: Klick aufs Symbol)
  if (BrowserWindow.getAllWindows().length) return;
  (uiOrigin ? Promise.resolve() : startUiServer()).then(createWindow).catch(err => {
    console.error('[UI] Örtlicher Server konnte nicht starten:', err);
  });
});

ipcMain.on('win-min',   () => win.minimize());
ipcMain.on('win-max',   () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('win-close', () => win.close());

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

ipcMain.handle('export-pdf', async (_, html, defaultName) => {
  const r = await dialog.showSaveDialog(win, {
    // Der Heftname als Vorschlag – „inkwell.pdf" für jedes Heft war beim
    // Exportieren mehrerer Hefte reichlich unbrauchbar.
    defaultPath: typeof defaultName === 'string' && defaultName ? defaultName : 'inkwell.pdf',
    filters: [{name:'PDF', extensions:['pdf']}]
  });
  if (r.canceled) return null;

  // Über eine temporäre Datei statt data:-URL. Mit eingebetteter Handschrift
  // und Bildern wird das HTML schnell viele MB groß – als data:-URL scheitert
  // das Laden dann stillschweigend.
  const tmpHtml = path.join(app.getPath('temp'), `inkwell-export-${Date.now()}.html`);
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

    const buf = await w.webContents.printToPDF({
      printBackground: true, pageSize: 'A4',
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
    defaultPath: typeof defaultName === 'string' && defaultName ? defaultName : `inkwell.${ext}`,
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
    defaultPath: 'inkwell.jrnl',
    filters: [{name:'Inkwell', extensions:['jrnl']}]
  });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data));
  return r.filePath;
});

ipcMain.handle('load', async () => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{name:'Inkwell', extensions:['jrnl']}],
    properties: ['openFile']
  });
  if (r.canceled) return null;
  
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf-8'));
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
const settingsPath = path.join(app.getPath('userData'), 'inkwell-settings.json');
console.log('[Settings] Settings file path:', settingsPath);

ipcMain.handle('get-default-save-path', () => {
  const documentsPath = app.getPath('documents');
  const inkwellPath = path.join(documentsPath, 'Inkwell');
  console.log('[Settings] Default save path:', inkwellPath);
  if (!fs.existsSync(inkwellPath)) {
    fs.mkdirSync(inkwellPath, { recursive: true });
    console.log('[Settings] Created Inkwell directory');
  }
  return inkwellPath;
});

ipcMain.handle('load-settings', () => {
  console.log('[Settings] Loading settings...');
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      console.log('[Settings] Loaded:', settings);
      return settings;
    }
    console.log('[Settings] No settings file found');
  } catch (err) {
    console.error('[Settings] Load error:', err);
  }
  return null;
});

ipcMain.handle('save-settings', (_, data) => {
  console.log('[Settings] Saving settings:', data);
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
  return r.filePaths[0];
});

// File operations for auto-save
// Schreibt immer erst vollständig in eine Nebendatei und ersetzt das Original
// dann in einem Zug. Vorher wurde direkt in die .jrnl geschrieben – ein
// Absturz oder Stromausfall mitten im Schreiben hinterließ eine abgeschnittene
// Datei, das Notizbuch war damit verloren.
ipcMain.handle('save-to-path', async (_, filePath, data) => {
  const tmpPath = `${filePath}.tmp`;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const jsonData = JSON.stringify(data);

    // Schreiben und auf die Platte durchdrücken, bevor ersetzt wird
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeFileSync(fd, jsonData, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // rename ersetzt eine vorhandene Datei atomar (auch unter Windows)
    fs.renameSync(tmpPath, filePath);

    const stats = fs.statSync(filePath);
    console.log(`[Save] ✓ ${filePath} (${stats.size} Bytes)`);
    return { success: true, path: filePath };
  } catch (err) {
    console.error('[Save] ✗ Error:', err);
    // Halbfertige Nebendatei nicht liegen lassen
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { /* egal */ }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-from-path', async (_, filePath) => {
  console.log('[Load] Loading from:', filePath);
  try {
    if (!fs.existsSync(filePath)) {
      console.log('[Load] File not found:', filePath);
      return { success: false, error: 'File not found' };
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log('[Load] ✓ Successfully loaded:', filePath);
    return { success: true, data };
  } catch (err) {
    console.error('[Load] ✗ Error:', err);
    return { success: false, error: err.message };
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
const registryPath = path.join(app.getPath('userData'), 'inkwell-registry.json');
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
  return fs.existsSync(filePath);
});
