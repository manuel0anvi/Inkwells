'use strict';

class FileManager {
  constructor() {
    this.notebookPaths = new Map(); // nbId -> filePath
  }

  getNotebookPath(notebook) {
    // First check if we have a registered path for this notebook
    const registryEntry = Registry.find(notebook.id);
    if (registryEntry && registryEntry.path) {
      console.log(`[FileManager] Using registry path: ${registryEntry.path}`);
      return registryEntry.path;
    }
    
    // Otherwise generate a new path
    const saveLocation = Settings.get('saveLocation');
    if (!saveLocation) return null;
    
    const safeName = this._sanitizeFilename(notebook.name || 'Unbenannt');
    const fileName = `${safeName}.jrnl`;
    const filePath = `${saveLocation}\\${fileName}`;
    console.log(`[FileManager] Generated path: ${filePath}`);
    return filePath;
  }

  // Ermittelt den Zielpfad und benennt die Datei mit um, wenn das Notizbuch
  // umbenannt wurde. Ohne das hieße die Datei auf der Festplatte für immer
  // wie beim Anlegen, während sie in Google Drive den neuen Namen trägt.
  async _resolvePathForSave(notebook) {
    const entry = Registry.find(notebook.id);
    const saveLocation = Settings.get('saveLocation');
    const desiredFile = `${this._sanitizeFilename(notebook.name || 'Unbenannt')}.jrnl`;

    if (!entry || !entry.path) {
      return saveLocation ? `${saveLocation}\\${desiredFile}` : null;
    }

    const currentPath = entry.path;
    const currentFile = currentPath.split(/[\\/]/).pop();
    if (currentFile === desiredFile) return currentPath;

    const dir = currentPath.slice(0, currentPath.length - currentFile.length);
    const desiredPath = dir + desiredFile;

    try {
      // Datei noch nicht angelegt -> einfach direkt unter dem neuen Namen speichern
      if (!await window.api.fileExists(currentPath)) {
        await Registry.updatePath(notebook.id, desiredPath);
        this.notebookPaths.set(notebook.id, desiredPath);
        return desiredPath;
      }

      // Zielname schon von einer anderen Datei belegt -> lieber beim alten bleiben
      if (await window.api.fileExists(desiredPath)) {
        console.warn(`[FileManager] "${desiredFile}" existiert bereits, behalte ${currentFile}`);
        return currentPath;
      }

      const moved = await window.api.moveFile(currentPath, desiredPath);
      if (!moved?.success) {
        console.warn('[FileManager] Umbenennen fehlgeschlagen:', moved?.error);
        return currentPath;
      }

      await Registry.updatePath(notebook.id, desiredPath);
      this.notebookPaths.set(notebook.id, desiredPath);
      console.log(`[FileManager] Datei umbenannt: ${currentFile} -> ${desiredFile}`);
      return desiredPath;
    } catch (err) {
      console.warn('[FileManager] Umbenennen übersprungen:', err);
      return currentPath;
    }
  }

  /**
   * @param {object} notebook
   * @param {object} [options]
   * @param {boolean} [options.syncCloud=true] In die Cloud-Warteschlange legen.
   *   Beim Übernehmen einer heruntergeladenen Version false – sonst wird das
   *   eben Geladene sofort wieder hochgeladen.
   * @param {boolean} [options.touch=true] updatedAt auf jetzt setzen.
   *   Ebenfalls false beim Übernehmen aus der Cloud, damit der Zeitstempel
   *   der Cloud-Version erhalten bleibt.
   * @param {boolean} [options.immediateCloud=false] Sofort hochladen, ohne
   *   den üblichen Mindestabstand abzuwarten. Für manuelles Speichern,
   *   Wechsel zur Startseite und Beenden.
   */
  async saveNotebook(notebook, options = {}) {
    const { syncCloud = true, touch = true, immediateCloud = false } = options;

    // Ein geteiltes Dokument gehört jemand anderem. Es bekommt keine
    // .jrnl-Datei und keinen Platz in der eigenen Übersicht; sein Zuhause
    // ist der Raum in Firestore (ui/sharedDocs.js).
    if (typeof isSharedNotebook === 'function' && isSharedNotebook(notebook)) {
      return { success: true, path: null, shared: true };
    }

    // Ohne diesen Zeitstempel hielt der Cloud-Abgleich die lokale Fassung
    // immer für die ältere und überschrieb sie mit der Cloud-Version.
    if (touch) notebook.updatedAt = new Date().toISOString();

    const filePath = await this._resolvePathForSave(notebook);
    if (!filePath) {
      console.error('[FileManager] No save location configured');
      throw new Error('Kein Speicherort festgelegt');
    }

    try {
      const saveData = { notebooks: [notebook] };
      const result = await window.api.saveToPath(filePath, saveData);

      if (!result.success) {
        console.error(`[FileManager] ✗ Save failed: ${result.error}`);
        throw new Error(result.error);
      }

      this.notebookPaths.set(notebook.id, filePath);
      await Registry.add(notebook, filePath);

      if (syncCloud) {
        try {
          if (typeof CloudSync_ !== 'undefined' && CloudSync_) {
            CloudSync_.queueNotebook(notebook.id, { immediate: immediateCloud });
          }
        } catch (e) { console.warn('[FileManager] Cloud queue failed:', e); }
      }

      return { success: true, path: filePath };
    } catch (err) {
      console.error('[FileManager] Save exception:', err);
      throw err;
    }
  }

  async loadNotebook(filePath) {
    try {
      const result = await window.api.loadFromPath(filePath);
      
      if (result.success) {
        console.log(`[FileManager] Loaded: ${filePath}`);
        return result.data;
      } else {
        throw new Error(result.error);
      }
    } catch (err) {
      console.error('[FileManager] Load failed:', err);
      throw err;
    }
  }

  async saveAllNotebooks() {
    const notebooks = S.notebooks || [];
    const results = [];
    
    for (const nb of notebooks) {
      try {
        const result = await this.saveNotebook(nb);
        results.push({ id: nb.id, success: true, path: result.path });
      } catch (err) {
        results.push({ id: nb.id, success: false, error: err.message });
      }
    }
    
    return results;
  }

  getNotebookFilePath(nbId) {
    // First check registry
    const registryEntry = Registry.find(nbId);
    if (registryEntry) return registryEntry.path;
    
    // Fallback to in-memory map
    return this.notebookPaths.get(nbId);
  }

  _sanitizeFilename(name) {
    // Remove invalid filename characters
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  }
}

const FileManager_ = new FileManager();
