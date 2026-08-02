'use strict';

/* ══════════════════════════════════════════════════════════════════════
   PAPIERKORB
   Gelöschte Hefte werden nicht mehr sofort von der Festplatte entfernt,
   sondern in den Unterordner "Papierkorb" verschoben und hier vermerkt.
   Von dort lassen sie sich zurückholen oder endgültig löschen.

   Wichtig: Ist die Cloud-Sicherung an, wird die Datei auch in Google Drive
   in den Papierkorb gelegt. Sonst würde der nächste Abgleich das gelöschte
   Heft wieder herunterladen.
   ══════════════════════════════════════════════════════════════════════ */

const TRASH_FOLDER = 'Papierkorb';

// Aufbewahrungsfrist. Sie läuft für jedes Heft einzeln ab dem Zeitpunkt,
// an dem es gelöscht wurde – nicht für den Papierkorb als Ganzes.
const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Diese Felder gelten nur auf dem Gerät, auf dem gelöscht wurde, und
// gehören nicht in die gemeinsame Liste.
const LOCAL_ONLY_FIELDS = ['originalPath', 'trashPath', 'snapshot'];

function pickLocalFields(entry) {
  const out = {};
  for (const key of LOCAL_ONLY_FIELDS) {
    if (entry[key] != null) out[key] = entry[key];
  }
  return out;
}

function stripLocalFields(entry) {
  const out = { ...entry };
  for (const key of LOCAL_ONLY_FIELDS) delete out[key];
  return out;
}

const Trash = {
  RETENTION_DAYS: TRASH_RETENTION_DAYS,

  _entries: [],
  _loaded: false,

  async load() {
    if (this._loaded) return this._entries;
    try {
      const data = await window.api.loadRegistry();
      this._entries = Array.isArray(data?.trash) ? data.trash : [];
    } catch (err) {
      console.error('[Trash] Laden fehlgeschlagen:', err);
      this._entries = [];
    }
    this._loaded = true;
    return this._entries;
  },

  /** Verbleibende Tage für einen Eintrag. 0 = heute fällig. */
  daysLeft(entry) {
    const deleted = entry?.deletedAt ? Date.parse(entry.deletedAt) : NaN;
    // Ohne verwertbares Datum wird nichts weggeworfen
    if (!Number.isFinite(deleted)) return TRASH_RETENTION_DAYS;
    const msLeft = deleted + TRASH_RETENTION_MS - Date.now();
    return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
  },

  isExpired(entry) {
    const deleted = entry?.deletedAt ? Date.parse(entry.deletedAt) : NaN;
    if (!Number.isFinite(deleted)) return false;
    return Date.now() - deleted >= TRASH_RETENTION_MS;
  },

  /**
   * Entfernt alle Einträge, deren 30 Tage abgelaufen sind.
   * Wird beim Start und beim Öffnen des Papierkorbs aufgerufen.
   * @returns {Promise<number>} Anzahl der endgültig gelöschten Hefte
   */
  async purgeExpired() {
    await this.load();

    const expired = this._entries.filter(e => this.isExpired(e));
    if (!expired.length) return 0;

    for (const entry of expired) {
      await this._destroy(entry);
      console.log(`[Trash] Nach ${TRASH_RETENTION_DAYS} Tagen entfernt: ${entry.name}`);
    }

    this._entries = this._entries.filter(e => !this.isExpired(e));
    await this.save();
    await this._pushIndex();

    return expired.length;
  },

  // Papierkorb und Übersicht liegen in derselben Datei; Registry.save()
  // schreibt beides zusammen (siehe core/registry.js).
  async save() {
    await Registry.save();
  },

  getAll() {
    return [...this._entries].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  },

  count() {
    return this._entries.length;
  },

  find(id) {
    return this._entries.find(e => e.id === id);
  },

  _trashPathFor(notebook, originalPath) {
    const saveLocation = Settings.get('saveLocation');
    const dir = saveLocation
      ? `${saveLocation}\\${TRASH_FOLDER}`
      : originalPath.slice(0, originalPath.lastIndexOf('\\')) + `\\${TRASH_FOLDER}`;
    const safe = String(notebook.name || 'Unbenannt').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    // Zeitstempel im Namen, damit zweimal gelöschte gleichnamige Hefte
    // sich im Papierkorb nicht gegenseitig überschreiben
    return `${dir}\\${safe}__${Date.now()}.jrnl`;
  },

  /** Verschiebt ein Heft in den Papierkorb. Gibt true zurück, wenn es geklappt hat. */
  async moveToTrash(notebook) {
    // Ein geteiltes Dokument gehört jemand anderem – es gibt hier weder
    // eine Datei noch eine Drive-Fassung zum Verschieben. „Löschen" heißt
    // dort „Freigabe verlassen" und steht in ui/sharedDocs.js.
    if (typeof isSharedNotebook === 'function' && isSharedNotebook(notebook)) {
      console.warn('[Trash] Geteiltes Dokument kann nicht in den Papierkorb.');
      return false;
    }

    await this.load();

    const originalPath = FileManager_.getNotebookFilePath(notebook.id) || FileManager_.getNotebookPath(notebook);
    let trashPath = null;

    if (originalPath && await window.api.fileExists(originalPath)) {
      trashPath = this._trashPathFor(notebook, originalPath);
      const moved = await window.api.moveFile(originalPath, trashPath);
      if (!moved?.success) {
        console.error('[Trash] Verschieben fehlgeschlagen:', moved?.error);
        return false;
      }
    }

    // In Drive in den Papierkorb-Unterordner verschieben. Ohne das käme das
    // Heft beim nächsten Abgleich zurück.
    let driveFileId = null;
    let cloudTrashed = false;
    try {
      if (typeof CloudSync_ !== 'undefined' && CloudSync_) {
        const moved = await CloudSync_.trashRemoteNotebook(notebook.id);
        driveFileId = moved?.fileId || null;
        cloudTrashed = !!moved?.done;
      }
    } catch (err) {
      console.warn('[Trash] Drive-Verschieben übersprungen:', err.message);
    }

    this._entries.push({
      id: notebook.id,
      name: notebook.name,
      color: notebook.color,
      pageCount: (notebook.pages || []).length,
      originalPath: originalPath || null,
      trashPath,
      driveFileId,
      // Ist die Cloud-Seite wirklich erledigt? Solange nicht, versucht es
      // syncWithCloud bei jedem Abgleich erneut.
      cloudTrashed,
      deletedAt: new Date().toISOString(),
      // Sicherheitsnetz: falls die Datei fehlt, liegt der Inhalt hier
      snapshot: trashPath ? null : JSON.parse(JSON.stringify(notebook))
    });

    await Registry.remove(notebook.id);   // schreibt die Registry-Datei
    await this.save();                    // ergänzt den Papierkorb darin
    await this.syncWithCloud();           // andere Geräte informieren

    return true;
  },

  /* ══════════════════════════════════════════════════════════════════
     ABGLEICH MIT DER GEMEINSAMEN LISTE IN DRIVE
     Dadurch sieht jedes Gerät dieselben gelöschten Hefte.
     Einträge ohne lokale Datei lassen sich trotzdem zurückholen – der
     Inhalt kommt dann aus dem Papierkorb-Ordner in Drive.
     ══════════════════════════════════════════════════════════════════ */

  async syncWithCloud() {
    if (typeof CloudSync_ === 'undefined' || !CloudSync_) return false;

    await this.load();

    const remote = await CloudSync_.loadTrashIndex();
    if (remote === null) return false;   // offline oder nicht angemeldet

    const remoteById = new Map(remote.map(e => [e.id, e]));
    const merged = [];
    let changed = false;

    for (const local of this._entries) {
      const inRemote = remoteById.get(local.id);

      if (inRemote) {
        // Beide kennen den Eintrag – lokale Pfade behalten, Rest aus der Wolke
        merged.push({ ...inRemote, ...pickLocalFields(local), syncedToCloud: true });
        remoteById.delete(local.id);
        continue;
      }

      if (local.syncedToCloud) {
        // War schon in der gemeinsamen Liste, ist dort aber weg: anderswo
        // zurückgeholt oder endgültig gelöscht. Also auch hier entfernen.
        console.log('[Trash] Auf einem anderen Gerät erledigt:', local.name);
        if (local.trashPath) {
          try { await window.api.deleteFile(local.trashPath); } catch (e) { /* egal */ }
        }
        changed = true;
        continue;
      }

      merged.push({ ...local, syncedToCloud: true });
      changed = true;
    }

    // Was nur die Wolke kennt: auf diesem Gerät gelöschte Hefte anderer Geräte
    for (const remoteEntry of remoteById.values()) {
      merged.push({ ...remoteEntry, originalPath: null, trashPath: null, syncedToCloud: true });
      changed = true;
    }

    this._entries = merged;

    // Erst jetzt die Cloud-Seite nachziehen – für ALLE Einträge, auch die
    // von anderen Geräten. Ein Gerät, das beim Löschen kein Netz hatte,
    // hinterlässt die Datei sonst im Hauptordner, und der nächste Abgleich
    // holt das gelöschte Heft überall wieder herunter.
    if (await this._catchUpCloudTrash()) changed = true;

    if (changed) {
      await this.save();
      await CloudSync_.saveTrashIndex(this._entries.map(stripLocalFields));
    }

    return true;
  },

  /**
   * Holt für jeden Eintrag nach, was in der Cloud noch offen ist.
   * @returns {Promise<boolean>} ob sich etwas geändert hat
   */
  async _catchUpCloudTrash() {
    if (typeof CloudSync_ === 'undefined' || !CloudSync_) return false;

    let changed = false;
    for (const entry of this._entries) {
      if (entry.cloudTrashed) continue;
      try {
        const moved = await CloudSync_.trashRemoteNotebook(entry.id);
        if (!moved?.done) continue;              // kein Netz – beim nächsten Mal
        if (moved.fileId) entry.driveFileId = moved.fileId;
        entry.cloudTrashed = true;
        changed = true;
      } catch (err) {
        console.warn('[Trash] Drive-Verschieben nachgeholt fehlgeschlagen:', err.message);
      }
    }
    return changed;
  },

  /** Holt ein Heft zurück. Gibt das Heft zurück oder null. */
  async restore(id) {
    await this.load();
    const entry = this.find(id);
    if (!entry) return null;

    let notebook = entry.snapshot ? JSON.parse(JSON.stringify(entry.snapshot)) : null;

    // 1. Lokale Kopie, falls auf diesem Gerät gelöscht wurde
    if (entry.trashPath && await window.api.fileExists(entry.trashPath)) {
      const result = await window.api.loadFromPath(entry.trashPath);
      if (result.success && result.data?.notebooks?.length) {
        notebook = result.data.notebooks[0];
      }
    }

    // 2. Drive-Datei aus dem Papierkorb-Ordner zurückschieben. Das muss auch
    //    dann geschehen, wenn es lokal schon geklappt hat – sonst legt der
    //    nächste Upload eine zweite Datei an und die alte bleibt verwaist.
    if (entry.driveFileId && typeof CloudSync_ !== 'undefined' && CloudSync_) {
      const fromDrive = await CloudSync_.untrashRemoteNotebook(entry.driveFileId);
      if (fromDrive && !notebook) {
        // Auf einem anderen Gerät gelöscht: der Inhalt kommt aus Drive
        notebook = Array.isArray(fromDrive?.notebooks) ? fromDrive.notebooks[0] : fromDrive;
      }
    }

    if (!notebook) {
      console.error('[Trash] Inhalt nicht mehr auffindbar:', id);
      return null;
    }

    // Datei zurück an den ursprünglichen Ort, falls dort nichts im Weg ist
    let restoredPath = null;
    if (entry.trashPath && entry.originalPath) {
      const blocked = await window.api.fileExists(entry.originalPath);
      if (!blocked) {
        const moved = await window.api.moveFile(entry.trashPath, entry.originalPath);
        if (moved?.success) restoredPath = entry.originalPath;
      }
    }

    this._entries = this._entries.filter(e => e.id !== id);

    if (!S.notebooks.some(n => n.id === notebook.id)) {
      S.notebooks.push(notebook);
    }

    // Pfad vorher wieder eintragen, sonst legt saveNotebook eine zweite
    // Datei am Standardort an und die zurückgeschobene bleibt verwaist.
    if (restoredPath) await Registry.add(notebook, restoredPath);

    // Legt die Datei neu an, falls sie nicht zurückverschoben werden konnte,
    // und trägt das Heft wieder in die Übersicht ein
    await FileManager_.saveNotebook(notebook, { touch: false, immediateCloud: true });
    await this.save();

    // Gemeinsame Liste aktualisieren, damit der Eintrag auch auf den
    // anderen Geräten verschwindet
    await this._pushIndex();

    return notebook;
  },

  /** Entfernt einen Eintrag endgültig – lokal und in Drive. */
  async deleteForever(id, options = {}) {
    await this.load();
    const entry = this.find(id);
    if (!entry) return;

    await this._destroy(entry);

    this._entries = this._entries.filter(e => e.id !== id);
    await this.save();
    if (options.pushIndex !== false) await this._pushIndex();
  },

  async emptyAll() {
    await this.load();
    for (const entry of [...this._entries]) {
      // Liste erst am Ende einmal hochladen statt nach jedem Eintrag
      await this.deleteForever(entry.id, { pushIndex: false });
    }
    await this._pushIndex();
  },

  /** Löscht die Dateien eines Eintrags – lokal und in Drive. */
  async _destroy(entry) {
    if (entry.trashPath) {
      try {
        await window.api.deleteFile(entry.trashPath);
      } catch (err) {
        console.warn('[Trash] Datei konnte nicht gelöscht werden:', err);
      }
    }

    if (typeof CloudSync_ === 'undefined' || !CloudSync_) return;

    /* >>> Die Kennung allein reicht nicht <<<
       Wer beim Löschen kein Netz hatte, hat keine Datei-Kennung. Endgültig
       gelöscht wurde dann nur örtlich – die Datei blieb in der Cloud und
       kam beim nächsten Abgleich als „neues" Heft zurück. Deshalb zusätzlich
       über die Heft-Kennung suchen, in beiden Ordnern. */
    let gone = false;
    if (entry.driveFileId) {
      gone = await CloudSync_.deleteRemoteFile(entry.driveFileId);
    }
    if (!gone) {
      await CloudSync_.deleteRemoteNotebookById(entry.id);
    }
  },

  /** Schreibt die aktuelle Liste in die gemeinsame Datei in Drive. */
  async _pushIndex() {
    if (typeof CloudSync_ === 'undefined' || !CloudSync_) return;
    try {
      await CloudSync_.saveTrashIndex(this._entries.map(stripLocalFields));
    } catch (err) {
      console.warn('[Trash] Gemeinsame Liste nicht aktualisiert:', err.message);
    }
  }
};

window.Trash = Trash;
