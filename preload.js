const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  minimize:  ()  => ipcRenderer.send('win-min'),
  maximize:  ()  => ipcRenderer.send('win-max'),
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
  deleteFile:        (p) => ipcRenderer.invoke('delete-file', p),
  moveFile:      (o, n) => ipcRenderer.invoke('move-file', o, n),
  fileExists:        (p) => ipcRenderer.invoke('file-exists', p),
  getAppVersion:     () => ipcRenderer.invoke('get-app-version'),
  // Das nächste Anmeldefenster bleibt unsichtbar (stiller Versuch beim Start)
  setSilentAuth:    (an) => ipcRenderer.send('silent-auth', !!an),

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
  confirmQuit:  () => ipcRenderer.send('confirm-quit'),

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
  onOpenFile: (callback) => ipcRenderer.on('open-file', (event, filePath) => callback(filePath))
});
