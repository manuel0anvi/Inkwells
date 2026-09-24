const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  minimize:  ()  => ipcRenderer.send('win-min'),
  maximize:  ()  => ipcRenderer.send('win-max'),
  // Maximiert oder nicht – für das Symbol am Knopf (ui/titlebar.js)
  onMaximizedChange: (cb) => ipcRenderer.on('fenster-maximiert', (e, an) => cb(!!an)),
  close:     ()  => ipcRenderer.send('win-close'),
  pickFiles: ()  => ipcRenderer.invoke('pick-files'),
  // Eine .docx oder .pdf, aus der ein neues Heft wird (ui/homeGrid.js)
  pickDocument: () => ipcRenderer.invoke('pick-document'),
  exportPdf: (h, defaultName) => ipcRenderer.invoke('export-pdf', h, defaultName),
  // Fertige Binärdatei speichern (Word-Export)
  saveBinary: (payload) => ipcRenderer.invoke('save-binary', payload),
  save:      (d) => ipcRenderer.invoke('save', d),
  load:      ()  => ipcRenderer.invoke('load'),
  
  // Settings
  getDefaultSavePath: () => ipcRenderer.invoke('get-default-save-path'),
  loadSettings:       () => ipcRenderer.invoke('load-settings'),
  saveSettings:      (d) => ipcRenderer.invoke('save-settings', d),
  pickFolder:         (defaultPath) => ipcRenderer.invoke('pick-folder', defaultPath),
  
  // File operations
  saveToPath:    (p, d) => ipcRenderer.invoke('save-to-path', p, d),
  loadFromPath:     (p) => ipcRenderer.invoke('load-from-path', p),
  checkInternet:     () => ipcRenderer.invoke('check-internet'),
  // Das Bild aus der Zwischenablage als PNG-Datenadresse (core/importExport.js)
  clipboardImage:    () => ipcRenderer.invoke('clipboard-image'),
  deleteFile:        (p) => ipcRenderer.invoke('delete-file', p),
  moveFile:      (o, n) => ipcRenderer.invoke('move-file', o, n),
  fileExists:        (p) => ipcRenderer.invoke('file-exists', p),
  fileSize:          (p) => ipcRenderer.invoke('file-size', p),
  getAppVersion:     () => ipcRenderer.invoke('get-app-version'),
  // Das nächste Anmeldefenster bleibt unsichtbar (stiller Versuch beim Start)
  setSilentAuth:    (an) => ipcRenderer.send('silent-auth', !!an),

  /* In welcher Sprache die rote Wellenlinie prueft. Chromium nimmt sonst
     die des Betriebssystems – siehe main.js, setzeRechtschreibung. */
  setSpellLanguage: (sprache) => ipcRenderer.send('spell-language', String(sprache || '')),

  /* Laeuft diese Fassung aus dem Microsoft Store?

     Dort aktualisiert der Store selbst. Der eigene Updater darf gar
     nicht erst auftauchen: sein Installierer koennte das versiegelte
     Store-Paket nicht ersetzen, sondern legte eine ZWEITE Installation
     daneben - der Nutzer haette Inkwells doppelt, mit getrennten Daten. */
  istStorefassung: process.windowsStore === true,

  /* Postfach: der oertliche Merkzettel und der Erstvermerk.
     Die Nachrichten selbst holt core/share.js aus Firestore. */
  loadPostfach: () => ipcRenderer.invoke('load-postfach'),
  savePostfach: (stand) => ipcRenderer.invoke('save-postfach', stand),
  erstStart: () => ipcRenderer.invoke('erst-start'),
  ersteAnmeldung: () => ipcRenderer.invoke('erste-anmeldung'),

  // Updater controls
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:  () => ipcRenderer.invoke('download-update'),
  toggleDownloadPause: () => ipcRenderer.invoke('toggle-download-pause'),
  installAndRestart: () => ipcRenderer.invoke('install-and-restart'),
  startOAuthServer: () => ipcRenderer.invoke('start-oauth-server'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, info) => cb(info)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', (e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (e, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (e, err) => cb(err)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (e, progress) => cb(progress)),

  onOAuthCallback: (cb) => ipcRenderer.on('oauth-callback', (e, url) => cb(url)),
  getPendingDeepLink: () => ipcRenderer.invoke('get-pending-deep-link'),

  // Freigabe-Link (inkwells://share/<linkId>). Früher landete jeder Aufruf
  // des Protokolls beim OAuth-Rückruf; jetzt gibt es dafür einen eigenen Weg.
  onOpenShare: (cb) => ipcRenderer.on('open-share', (e, linkId) => cb(linkId)),
  getPendingShareLink: () => ipcRenderer.invoke('get-pending-share-link'),

  // Sauberes Beenden: Hauptprozess fragt an, Oberfläche speichert und bestätigt
  onBeforeQuit: (cb) => ipcRenderer.on('app-before-quit', () => cb()),
  // Der KaTeX-Stil mit eingebetteten Schriften – fuer den PDF-Export
  katexPrintCss: () => ipcRenderer.invoke('katex-druckstil'),
  confirmQuit:  () => ipcRenderer.send('confirm-quit'),
  // „Nicht schliessen" – etwas Ungesichertes ist offen, siehe core/init.js
  cancelQuit:   () => ipcRenderer.send('cancel-quit'),
  // Haelt die Zeitgrenze an, solange der Nutzer gefragt wird
  holdQuit:     () => ipcRenderer.send('quit-hold'),

  // Anmeldung: Tokentausch läuft im Hauptprozess (kein CORS im Fenster)
  oauthTokenRequest: (url, body) => ipcRenderer.invoke('oauth-token-request', url, body),
  msTokenRequest:    (url, body) => ipcRenderer.invoke('ms-token-request', url, body),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  /* Eine Chat-Nachricht melden, solange Inkwells im Hintergrund liegt.
     Ob wirklich gemeldet wird, entscheidet der Hauptprozess – nur der
     weiss, ob das Fenster gerade vorne steht (siehe dort). */
  notifyChat: (daten) => ipcRenderer.invoke('notify-chat', daten),
  onChatNotificationClicked: (cb) => ipcRenderer.on('chat-notification-clicked', () => cb()),

  // Registry
  loadRegistry:      () => ipcRenderer.invoke('load-registry'),
  saveRegistry:     (d) => ipcRenderer.invoke('save-registry', d),
  
  // Event listeners for file open
  onOpenFile: (callback) => ipcRenderer.on('open-file', (event, filePath) => callback(filePath)),
  // Die beim Start mitgegebene Datei – einmal abholbar, siehe main.js
  getPendingFile: () => ipcRenderer.invoke('get-pending-file'),

  /* ── Griffbereit: Unterlagen neben dem Heft ──────────────────────────
     PDFs und Bilder, die nur ANGESEHEN werden. Sie liegen weiterhin da,
     wo sie liegen; hier reist nur die Kennung hin und her. Wer welche
     Datei sein darf, entscheidet allein der Hauptprozess (main.js) –
     einen Pfad zum Lesen nimmt er von hier gar nicht erst an.

     >>> Warum pfadVon eine eigene Zeile ist <<<
     Bis Electron 31 stand der Pfad einer abgelegten Datei in `file.path`.
     Das gibt es nicht mehr; den Pfad kennt nur noch webUtils, und das
     wiederum nur hier im Vorlauf. Ohne diese Zeile gäbe es kein
     Hineinziehen, sondern nur das Auswahlfenster. */
  griffbereit: {
    /* Jede Auskunft gilt EINEM Heft: die Unterlagen gehoeren zu dem,
       woran gerade gearbeitet wird (main.js, griffHeft). Das Fenster
       nennt die Kennung, weil nur es weiss, welches Heft offen ist. */
    liste:       (nb)           => ipcRenderer.invoke('griff-liste', nb),
    waehlen:     ()             => ipcRenderer.invoke('griff-waehlen'),
    abgelegt:    (pfade)        => ipcRenderer.invoke('griff-abgelegt', pfade),
    uebernehmen: (nb, id, name) => ipcRenderer.invoke('griff-uebernehmen', nb, id, name),
    aendern:     (nb, id, patch)=> ipcRenderer.invoke('griff-aendern', nb, id, patch),
    entfernen:   (nb, id)       => ipcRenderer.invoke('griff-entfernen', nb, id),
    ordnen:      (nb, ids)      => ipcRenderer.invoke('griff-ordnen', nb, ids),
    verstecken:  (nb, an)       => ipcRenderer.invoke('griff-verstecken', nb, an),
    lesen:       (nb, id)       => ipcRenderer.invoke('griff-lesen', nb, id),
    pfadVon:     (datei)        => { try { return webUtils.getPathForFile(datei); } catch (e) { return ''; } }
  }
});
