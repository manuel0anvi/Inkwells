const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  minimize:  ()  => ipcRenderer.send('win-min'),
  maximize:  ()  => ipcRenderer.send('win-max'),
  close:     ()  => ipcRenderer.send('win-close'),
  pickFiles: ()  => ipcRenderer.invoke('pick-files'),
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

  // Freigabe-Link (inkwell://share/<linkId>). Früher landete jeder Aufruf
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

  // Registry
  loadRegistry:      () => ipcRenderer.invoke('load-registry'),
  saveRegistry:     (d) => ipcRenderer.invoke('save-registry', d),
  
  // Event listeners for file open
  onOpenFile: (callback) => ipcRenderer.on('open-file', (event, filePath) => callback(filePath))
});
