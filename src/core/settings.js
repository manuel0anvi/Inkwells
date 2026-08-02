'use strict';

const SETTINGS_FILE = 'journal-settings.json';

const DEFAULT_SETTINGS = {
  saveLocation: null, // null means user needs to set it
  autoSaveEnabled: true,
  autoSaveInterval: 30, // seconds
  language: 'en', // de, en, it
  cloudEnabled: false,
  // Cloud-Anbieter: 'google' (Drive) oder 'microsoft' (OneDrive).
  // Siehe core/cloudConfig.js und core/providers/.
  cloudProvider: '',
  cloudEmail: '',
  cloudAccessToken: '',   // läuft nach etwa einer Stunde ab
  cloudRefreshToken: '',  // nur Microsoft – damit hält die Sitzung länger
  cloudTokenExpiry: 0,    // Zeitstempel in ms, ab wann das Token ungültig ist
  cloudUserId: '',
  cloudUserName: '',
  cloudUserPicture: '',
  cloudLastSync: '',
  // Nur abweichende Tastenkürzel: { aktionId: 'Ctrl+S' }. Leer = alles Standard.
  shortcuts: {},
  /* Eigene Heft-Freigaben, zwei Arten nebeneinander:
       { [heftId]: { docId, linkId, url, linkMode } }  geteiltes Dokument
       { [heftId]: { shareId, url, mode } }            ältere Lesekopie
     Siehe core/share.js und ui/share.js. */
  shares: {},
  /* Wann der Tab „Geteilte Dokumente" zuletzt offen war. Alles, was neuer
     ist, gilt als neu – dadurch braucht es keinen eigenen
     Benachrichtigungs-Speicher und keinen zusätzlichen Schreibvorgang in
     Firestore (COLLAB_SPEC.md, Abschnitt 6). */
  sharedDocsSeenAt: 0,
  /* Merkzettel je geteiltem Dokument: der Stand, den dieses Gerät zuletzt
     in den Raum gegeben hat. { [docId]: fingerprint }
     Nur der Besitzer braucht ihn, und nur beim Öffnen: daran erkennt
     ui/sharedDocs.js, was hier seit dem letzten Mal entstanden ist – etwa
     eine Seite, die ohne Verbindung angelegt wurde. Ohne diesen Zettel
     gäbe es dafür keinen Vergleich, und der Raum würde sie verdrängen. */
  liveFingerprints: {},
  /* Wahr, wenn bei der letzten Anmeldung kein ID-Token kam. Dann kennt
     Firebase den Nutzer nicht und die geteilten Dokumente bleiben aus.
     Bei Google passiert das ohne hinterlegtes Client-Secret. */
  cloudIdentityMissing: false,
  /* Nur Microsoft: die nonce aus dem Anmeldeaufruf. Firebase prüft das
     ID-Token dagegen – auch ein später nachgeholtes. */
  cloudAuthNonce: '',
  // Hefte, die noch in die Cloud müssen. Überlebt bewusst einen Neustart:
  // wer ohne Internet arbeitet und die App schließt, hätte sonst nach dem
  // Wiederverbinden nichts, woran der Upload noch hängt.
  cloudPendingUploads: [],
  // Wird gesetzt, sobald eine Sitzung ungewollt endet (Token abgelaufen,
  // Zugriff entzogen). Beim nächsten Start weist die App darauf hin.
  cloudSessionLost: false,
  /* Wahr, sobald der Hinweis auf die abgelaufene Sitzung weggedrückt wurde.
     Sonst stünde er dauerhaft im Kontofenster, auch wenn gar keine erneute
     Anmeldung mehr gewollt ist. Eine neue Anmeldung setzt ihn zurück, damit
     ein späterer Ablauf wieder auffällt. */
  cloudExpiredNoticeDismissed: false
};

// Einstellungen aus früheren Fassungen, die beim Laden entfernt werden.
// cloudProvider und cloudRefreshToken stehen bewusst NICHT hier: die gibt
// es seit der Unterstützung von OneDrive wieder mit neuer Bedeutung.
const OBSOLETE_SETTINGS = [
  'cloudUrl', 'cloudAnonKey',
  'cloudProviderToken', 'cloudProviderRefreshToken', 'useDrive', '_pendingDriveConnect'
];

class SettingsManager {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this._listeners = [];
    this._initialized = false;
    this._loadedFromFile = false;
  }

  async init() {
    console.log('[Settings] Starting initialization...');
    
    // Wait for window.api to be available
    if (!window.api) {
      console.warn('[Settings] window.api not available yet, using defaults');
      return;
    }

    await this.load();
    
    // Set save location if not set yet (first run)
    if (!this.settings.saveLocation) {
      try {
        const defaultPath = await window.api.getDefaultSavePath();
        const selectedPath = window.api.pickFolder ? await window.api.pickFolder(defaultPath) : null;
        this.settings.saveLocation = selectedPath || defaultPath;
        this._loadedFromFile = true;
        await this.save();
        console.log('[Settings] Set save location:', this.settings.saveLocation);
      } catch (err) {
        console.error('[Settings] Failed to get default path:', err);
      }
    }
    
    this._initialized = true;
    console.log('[Settings] Initialization complete:', this.settings);
  }

  async load() {
    if (!window.api) {
      console.warn('[Settings] Cannot load, window.api not available');
      return;
    }
    
    try {
      const data = await window.api.loadSettings();
      if (data) {
        this.settings = { ...DEFAULT_SETTINGS, ...data };

        // Reste alter Fassungen wegräumen. Deren Token taugt für Google Drive
        // bzw. OneDrive nichts, deshalb wird eine solche Altsitzung verworfen
        // und der Nutzer meldet sich einmalig neu an.
        let hadObsolete = false;
        for (const key of OBSOLETE_SETTINGS) {
          if (key in this.settings) {
            delete this.settings[key];
            hadObsolete = true;
          }
        }
        if (hadObsolete) {
          this.settings.cloudAccessToken = '';
          this.settings.cloudTokenExpiry = 0;
          console.log('[Settings] Einstellungen aus einer früheren Fassung bereinigt');
        }

        this._loadedFromFile = true;
        console.log('[Settings] Loaded from file:', this.settings);
      }
    } catch (err) {
      console.warn('[Settings] Failed to load, using defaults:', err);
    }
  }

  // Returns true if settings were loaded from disk (not just defaults)
  hasSavedSettings() {
    return !!this._loadedFromFile;
  }

  async save() {
    if (!window.api) {
      console.error('[Settings] Cannot save, window.api not available');
      return;
    }
    
    try {
      await window.api.saveSettings(this.settings);
      this._notify();
      console.log('[Settings] Saved successfully');
    } catch (err) {
      console.error('[Settings] Failed to save:', err);
      throw err;
    }
  }

  get(key) {
    return this.settings[key];
  }

  async set(key, value) {
    this.settings[key] = value;
    await this.save();
  }

  async update(updates) {
    Object.assign(this.settings, updates);
    console.log('[Settings] Updated:', updates);
    await this.save();
  }

  getAll() {
    return { ...this.settings };
  }

  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      const idx = this._listeners.indexOf(callback);
      if (idx > -1) this._listeners.splice(idx, 1);
    };
  }

  _notify() {
    this._listeners.forEach(cb => cb(this.settings));
  }
}

const Settings = new SettingsManager();
