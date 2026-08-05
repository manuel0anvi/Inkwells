'use strict';

/* ══════════════════════════════════════════════════════════════════════
   AUTOMATISCH SPEICHERN

   Gespeichert wird kurz nachdem man aufhoert – zwei Sekunden nach der
   letzten Aenderung. Das ist alles.

   >>> Was hier frueher stand, und warum es weg ist <<<
   Es gab zusaetzlich einen Taktgeber (setInterval) mit einer
   einstellbaren Weile: 15 Sekunden, 30, eine Minute, zwei. Beides
   nebeneinander, und die Einstellung war wirkungslos:

       delay = max(500, min(weile * 1000, 2000))

   Fuer jede waehlbare Weile ab zwei Sekunden kam da 2000 heraus. Ob man
   15 Sekunden oder zwei Minuten einstellte, aenderte also nichts – die
   Arbeit war immer nach zwei Sekunden auf der Platte. Der Taktgeber fand
   danach nichts mehr zu tun und meldete Runde um Runde „keine
   Aenderungen".

   Eine Aufgabe hatte er doch: einen FEHLGESCHLAGENEN Speichervorgang
   noch einmal versuchen. Dafuer gibt es jetzt einen ausdruecklichen
   zweiten Anlauf, statt eines Taktgebers, der die ganze Zeit
   mitlaeuft und dabei eine Einstellung vorgaukelt, die nichts bewirkt.
   ══════════════════════════════════════════════════════════════════════ */

/* Vorsilbe AUTOSAVE_, weil ui/sharedDocs.js in seinem eigenen Bereich
   ebenfalls ein SAVE_DELAY_MS fuehrt – fuer den Takt ins geteilte
   Dokument, mit anderem Wert. Zwei gleiche Namen waeren eine Falle. */
const AUTOSAVE_DELAY_MS = 2000;   // nach der letzten Aenderung
const AUTOSAVE_RETRY_MS = 5000;   // nach einem Fehlschlag
const AUTOSAVE_RETRIES = 3;

class AutoSaveEngine {
  constructor() {
    this.dirtyNotebooks = new Set();
    this.lastSaveTime = new Map(); // nbId -> timestamp
    this._listeners = [];
    this._changeVersions = new Map();
    this._debounceTimers = new Map();
    this._retries = new Map();     // nbId -> Zahl der Fehlversuche
  }

  init() {
    console.log('[AutoSave] Bereit – gespeichert wird', AUTOSAVE_DELAY_MS / 1000,
      'Sekunden nach der letzten Aenderung.');
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
    this._retries.delete(nbId);
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

  /**
   * @param {number} [delay] abweichende Wartezeit – fuer den zweiten
   *   Anlauf nach einem Fehlschlag
   */
  _scheduleDebouncedSave(nbId, delay = AUTOSAVE_DELAY_MS) {
    if (!Settings.get('autoSaveEnabled')) return;

    const expectedVersion = this._changeVersions.get(nbId) || 0;

    const timer = this._debounceTimers.get(nbId);
    if (timer) clearTimeout(timer);

    const nextTimer = setTimeout(() => {
      this._debounceTimers.delete(nbId);
      if (!this.isDirty(nbId)) return;
      if ((this._changeVersions.get(nbId) || 0) !== expectedVersion) return;
      this._saveNotebook(nbId, expectedVersion).then(res => {
        if (res && res.success === false) this._retryLater(nbId, res.error);
      }).catch(err => {
        console.error('[AutoSave] Speichern fehlgeschlagen:', err);
        this._retryLater(nbId, err && err.message);
      });
    }, delay);

    this._debounceTimers.set(nbId, nextTimer);
  }

  /* Noch einmal versuchen. Ohne das bliebe eine Aenderung nach einem
     Fehlschlag liegen, bis man das naechste Mal etwas tippt – frueher
     fing der Taktgeber das auf. Nach drei Anlaeufen wird aufgehoert; das
     Heft bleibt als „nicht gespeichert" stehen, und der Knopf in der
     Leiste zeigt es an. */
  _retryLater(nbId, grund) {
    const versuche = (this._retries.get(nbId) || 0) + 1;
    if (versuche > AUTOSAVE_RETRIES) {
      console.error('[AutoSave] Gibt auf nach', AUTOSAVE_RETRIES, 'Versuchen:', nbId, grund || '');
      this._retries.delete(nbId);
      return;
    }
    this._retries.set(nbId, versuche);
    console.warn('[AutoSave] Fehlgeschlagen, Anlauf', versuche, 'in',
      AUTOSAVE_RETRY_MS / 1000, 's:', grund || '');
    this._scheduleDebouncedSave(nbId, AUTOSAVE_RETRY_MS);
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

  /** Alles Ausstehende abbrechen – es laeuft kein Taktgeber mehr mit. */
  stop() {
    for (const timer of this._debounceTimers.values()) clearTimeout(timer);
    this._debounceTimers.clear();
    this._retries.clear();
  }
}

const AutoSave = new AutoSaveEngine();
