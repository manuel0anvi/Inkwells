/* ══════════════════════════════════════════════════════════════════════
   DAS FENSTER BLEIBT BEI SICH

   Lädt das ECHTE main.js und prüft, was es nach aussen zulässt: Seitenwechsel,
   window.open, Berechtigungen und fremde Absender auf den Kanälen.

   Mit eigenem Profil, damit keine echten Hefte im Spiel sind. Das Protokoll
   inkwells:// bleibt, wie es ist, und kein Dialog wartet auf eine Eingabe.

   Läuft NICHT in `npm test` – braucht Electron.
   Aufruf:  npm run test:fenster
   ══════════════════════════════════════════════════════════════════════ */

process.env.INKWELLS_PROFILE = 'test-fensterschutz';

const electron = require('electron');
const { app, BrowserWindow, dialog, shell } = electron;
const path = require('path');

const nachAussen = [];
shell.openExternal = async (url) => { nachAussen.push(url); };
app.setAsDefaultProtocolClient = () => true;
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
dialog.showSaveDialog = async () => ({ canceled: true });
dialog.showMessageBox = async () => ({ response: 0 });
dialog.showErrorBox = () => {};

require(path.join(__dirname, '..', '..', 'main.js'));

const zeilen = [];
const pruefe = (was, gut, hinweis) => zeilen.push((gut ? 'ok   ' : 'FEHL ') + was + (gut ? '' : '  -> ' + hinweis));
const warte = (ms) => new Promise(r => setTimeout(r, ms));

function fertig(code) {
  process.stdout.write('\nDas Fenster bleibt bei sich\n' + zeilen.map(z => '  ' + z).join('\n') + '\n');
  const fehl = zeilen.filter(z => /^(FEHL|ABBRUCH)/.test(z)).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : code);
}

setTimeout(() => { zeilen.push('ABBRUCH: Zeitgrenze'); fertig(2); }, 90000);

app.whenReady().then(async () => {
  try {
    while (!BrowserWindow.getAllWindows().length) await warte(100);
    const win = BrowserWindow.getAllWindows()[0];
    if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
    await warte(1500);
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const start = win.webContents.getURL();

    const version = await js('window.api.getAppVersion()');
    pruefe('Die Oberfläche erreicht den Hauptprozess', typeof version === 'string' && !!version, String(version));

    await js("location.href = 'https://example.com/'; true").catch(() => {});
    await warte(800);
    pruefe('Ein Seitenwechsel nach aussen findet nicht statt', win.webContents.getURL() === start, win.webContents.getURL());
    pruefe('Die Adresse geht stattdessen in den Browser', nachAussen.includes('https://example.com/'), nachAussen.join(' '));

    await js("location.href = 'file:///C:/Windows/win.ini'; true").catch(() => {});
    await warte(600);
    pruefe('Eine Datei auch nicht', win.webContents.getURL() === start, win.webContents.getURL());

    nachAussen.length = 0;
    await js("window.open('file:///C:/Windows/notepad.exe'); window.open('ms-msdt:/id x'); window.open('https://example.org/'); true");
    await warte(600);
    pruefe('window.open reicht nur Netzadressen weiter',
      nachAussen.length === 1 && nachAussen[0] === 'https://example.org/', nachAussen.join(' '));

    const kamera = await js("navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'erlaubt', e => e.name)");
    pruefe('Die Kamera bleibt zu', kamera !== 'erlaubt', kamera);
    const melden = await js('Notification.requestPermission()');
    pruefe('Meldungen des Browsers bleiben zu (die App meldet über den Hauptprozess)', melden !== 'granted', melden);

    /* Ein zweites Fenster mit demselben Vorlauf, aber fremder Adresse */
    const fremd = new BrowserWindow({ show: false, webPreferences: {
      contextIsolation: true, sandbox: true, preload: path.join(__dirname, '..', '..', 'preload.js') } });
    await fremd.loadURL('data:text/html,<title>fremd</title>');
    const antwort = await fremd.webContents.executeJavaScript(
      "window.api.getAppVersion().then(v => 'bekam ' + v, () => 'abgewiesen')");
    pruefe('Ein fremder Absender wird abgewiesen', antwort === 'abgewiesen', antwort);
    const auchSettings = await fremd.webContents.executeJavaScript(
      "window.api.loadSettings().then(() => 'bekam', () => 'abgewiesen')");
    pruefe('Auch an die Einstellungen kommt er nicht', auchSettings === 'abgewiesen', auchSettings);
    fremd.destroy();

    const nochmal = await js('window.api.getAppVersion()');
    pruefe('Die Oberfläche selbst darf weiterhin', nochmal === version, String(nochmal));

    fertig(0);
  } catch (err) {
    zeilen.push('ABBRUCH: ' + (err && err.stack || err));
    fertig(2);
  }
});
