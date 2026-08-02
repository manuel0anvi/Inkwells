'use strict';

class AutoSaveEngine {
  constructor() {
    this.dirtyNotebooks = new Set();
    this.saveTimer = null;
    this.lastSaveTime = new Map(); // nbId -> timestamp
    this._listeners = [];
    this._changeVersions = new Map();
    this._debounceTimers = new Map();
  }

  init() {
    console.log('[AutoSave] Initializing...');
    
    Settings.onChange((settings) => {
      console.log('[AutoSave] Settings changed, restarting timer');
      this._restartTimer();
    });
    
    this._restartTimer();
    console.log('[AutoSave] Started with interval:', Settings.get('autoSaveInterval'), 'seconds');
  }

  // Wird bei jeder Änderung aufgerufen (Tippen, Zeichnen, Seiten, Abschnitte),
  // also sehr häufig – deshalb bewusst ohne Konsolenausgabe.
  markDirty(nbId) {
    if (!nbId) {
      console.warn('[AutoSave] markDirty called with no nbId');
      return;
    }

    /* Gehört das Heft zu einer laufenden Live-Sitzung, geht die Änderung
       sofort an die anderen. Was genau sich geändert hat, weiß hier
       niemand – Collab vergleicht das selbst. Das gilt für ein fremdes
       Dokument genauso wie für ein EIGENES, freigegebenes: der Besitzer
       ist seit dieser Fassung ganz normal mit dabei. */
    if (typeof window.Collab !== 'undefined' && window.Collab) window.Collab.noteChange(nbId);

    // Dauerhaft gesichert wird ein Dokument in den Raum, nicht in eine
    // Datei. Das übernimmt ui/sharedDocs.js mit eigenem Takt.
    if (typeof window.markSharedDocDirty === 'function') window.markSharedDocDirty(nbId);

    // Ein FREMDES Dokument bekommt keine eigene Datei – sonst lüde die App
    // des Empfängers fremde Hefte in sein eigenes Drive.
    if (typeof isSharedNotebook === 'function' && isSharedNotebook(nbId)) return;

    this.dirtyNotebooks.add(nbId);
    this._changeVersions.set(nbId, (this._changeVersions.get(nbId) || 0) + 1);
    this._scheduleDebouncedSave(nbId);
    this._notifyStateChange();
  }

  markClean(nbId) {
    this.dirtyNotebooks.delete(nbId);
    this.lastSaveTime.set(nbId, Date.now());
    this._notifyStateChange();
  }

  isDirty(nbId) {
    return this.dirtyNotebooks.has(nbId);
  }

  getLastSaveTime(nbId) {
    return this.lastSaveTime.get(nbId);
  }

  // Ausdrückliches Speichern (Knopf, Startseite, Beenden). Lädt sofort in die
  // Cloud, ohne den Mindestabstand abzuwarten – anders als das automatische
  // Speichern im Hintergrund.
  async saveNow(nbId = null) {
    if (nbId) {
      const timer = this._debounceTimers.get(nbId);
      if (timer) clearTimeout(timer);
      this._debounceTimers.delete(nbId);
      return await this._saveNotebook(nbId, this._changeVersions.get(nbId) || 0, { immediateCloud: true });
    }
    return await this._saveAllDirty({ immediateCloud: true });
  }

  async _saveNotebook(nbId, expectedVersion = null, saveOptions = {}) {
    const versionAtStart = expectedVersion ?? (this._changeVersions.get(nbId) || 0);
    const timer = this._debounceTimers.get(nbId);
    if (timer) clearTimeout(timer);
    this._debounceTimers.delete(nbId);

    if (typeof S !== 'undefined' && S.activeNbId === nbId && typeof syncAll === 'function') {
      try {
        // Überträgt den Stand aus dem Editor ins Datenmodell.
        // Läuft jetzt bei jedem Speichern, deshalb ohne Konsolenausgabe.
        syncAll();
      } catch (e) {
        console.error('[AutoSave] syncAll failed before save:', e);
      }
    }

    const nb = getNb(nbId);
    if (!nb) return { success: false, error: 'Notebook not found' };

    try {
      const result = await FileManager_.saveNotebook(nb, saveOptions);
      const currentVersion = this._changeVersions.get(nbId) || 0;
      if (currentVersion === versionAtStart) {
        this.markClean(nbId);
      } else {
        this._notifyStateChange();
      }
      return { success: true, path: result.path };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async _saveAllDirty(saveOptions = {}) {
    const dirtyIds = Array.from(this.dirtyNotebooks);
    if (dirtyIds.length === 0) return [];

    const results = [];
    for (const nbId of dirtyIds) {
      const result = await this._saveNotebook(nbId, null, saveOptions);
      results.push({ nbId, ...result });
    }

    return results;
  }

  _restartTimer() {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    if (!Settings.get('autoSaveEnabled')) return;

    const interval = Settings.get('autoSaveInterval') * 1000;
    this.saveTimer = setInterval(() => {
      this._autoSaveTick();
    }, interval);
  }

  async _autoSaveTick() {
    if (this.dirtyNotebooks.size === 0) {
      console.log('[AutoSave] Tick - no dirty notebooks');
      return;
    }
    
    console.log(`[AutoSave] Tick - saving ${this.dirtyNotebooks.size} notebook(s)...`);
    const results = await this._saveAllDirty();
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    if (successful > 0) {
      console.log(`[AutoSave] ✓ Saved ${successful} notebook(s)`);
    }
    if (failed > 0) {
      console.warn(`[AutoSave] ✗ Failed to save ${failed} notebook(s)`);
      results.filter(r => !r.success).forEach(r => {
        console.error(`[AutoSave] Failed notebook ${r.nbId}:`, r.error);
      });
    }
  }

  _scheduleDebouncedSave(nbId) {
    if (!Settings.get('autoSaveEnabled')) return;

    const delay = Math.max(500, Math.min((Settings.get('autoSaveInterval') || 30) * 1000, 2000));
    const expectedVersion = this._changeVersions.get(nbId) || 0;

    const timer = this._debounceTimers.get(nbId);
    if (timer) clearTimeout(timer);

    const nextTimer = setTimeout(() => {
      this._debounceTimers.delete(nbId);
      if (!this.isDirty(nbId)) return;
      if ((this._changeVersions.get(nbId) || 0) !== expectedVersion) return;
      this._saveNotebook(nbId, expectedVersion).catch(err => {
        console.error('[AutoSave] Debounced save failed:', err);
      });
    }, delay);

    this._debounceTimers.set(nbId, nextTimer);
  }

  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      const idx = this._listeners.indexOf(callback);
      if (idx > -1) this._listeners.splice(idx, 1);
    };
  }

  _notifyStateChange() {
    this._listeners.forEach(cb => {
      cb({
        dirty: Array.from(this.dirtyNotebooks),
        lastSave: Object.fromEntries(this.lastSaveTime)
      });
    });
  }

  stop() {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }
}

const AutoSave = new AutoSaveEngine();
