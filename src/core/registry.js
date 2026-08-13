// Notebook Registry - Persists which notebooks appear in the overview
// Stored in inkwell-registry.json in userData folder

const Registry = {
  _entries: [],
  _loaded: false,
  _rawTrash: [],   // Papierkorb-Einträge aus der Datei, falls Trash noch nicht geladen ist

  async load() {
    if (this._loaded) return this._entries;

    try {
      const data = await window.api.loadRegistry();
      this._entries = data?.notebooks || [];
      this._rawTrash = Array.isArray(data?.trash) ? data.trash : [];
      this._loaded = true;
      console.log('[Registry] Loaded', this._entries.length, 'entries');
    } catch (err) {
      console.error('[Registry] Load error:', err);
      this._entries = [];
      this._rawTrash = [];
      this._loaded = true;
    }
    return this._entries;
  },

  /* Übersicht, Papierkorb UND Versionsverlauf stehen in derselben Datei.
     Hier stand eine Aufzählung der Felder – und die musste bei jedem
     neuen Feld mitwachsen, sonst wäre es beim nächsten Speichern weg.
     Genau das ist mit `versions` beinahe passiert.

     Deshalb andersherum: die Datei wird frisch gelesen und nur das
     ersetzt, was dieser Datei wirklich gehört. Was ein anderer Teil
     hineingeschrieben hat, bleibt unangetastet, auch wenn hier niemand
     davon weiß. */
  async save() {
    try {
      const vorhanden = (await window.api.loadRegistry()) || {};
      const trash = (typeof Trash !== 'undefined' && Trash._loaded)
        ? Trash._entries
        : (Array.isArray(vorhanden.trash) ? vorhanden.trash : this._rawTrash);

      await window.api.saveRegistry({ ...vorhanden, notebooks: this._entries, trash });
      this._rawTrash = trash;
      console.log('[Registry] Saved', this._entries.length, 'entries,', trash.length, 'im Papierkorb');
    } catch (err) {
      console.error('[Registry] Save error:', err);
    }
  },

  getAll() {
    return this._entries;
  },

  find(id) {
    return this._entries.find(e => e.id === id);
  },

  findByPath(filePath) {
    const normalized = filePath.toLowerCase().replace(/\//g, '\\');
    return this._entries.find(e => e.path.toLowerCase().replace(/\//g, '\\') === normalized);
  },

  async add(notebook, filePath) {
    // Geteilte Dokumente gehören nicht in die Übersicht der eigenen Hefte.
    // Sie stehen im Tab „Geteilte Dokumente" und kommen bei jedem Start
    // frisch aus Firestore.
    if (typeof isSharedNotebook === 'function' && isSharedNotebook(notebook)) return;

    const existing = this.find(notebook.id);
    if (existing) {
      // Update existing entry
      existing.name = notebook.name;
      existing.path = filePath;
      existing.color = notebook.color;
      existing.updatedAt = new Date().toISOString();
    } else {
      // Add new entry
      this._entries.push({
        id: notebook.id,
        name: notebook.name,
        path: filePath,
        color: notebook.color,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    await this.save();
    console.log('[Registry] Added/updated:', notebook.name, 'at', filePath);
  },

  async remove(id) {
    const idx = this._entries.findIndex(e => e.id === id);
    if (idx !== -1) {
      const removed = this._entries.splice(idx, 1)[0];
      await this.save();
      console.log('[Registry] Removed:', removed.name);
      return removed;
    }
    return null;
  },

  async updatePath(id, newPath) {
    const entry = this.find(id);
    if (entry) {
      entry.path = newPath;
      entry.updatedAt = new Date().toISOString();
      await this.save();
      console.log('[Registry] Updated path for:', entry.name);
    }
  },

  async updateAllPaths(oldDir, newDir) {
    // When changing save location, update all paths
    let updated = 0;
    for (const entry of this._entries) {
      if (entry.path.toLowerCase().startsWith(oldDir.toLowerCase())) {
        const fileName = entry.path.substring(oldDir.length);
        entry.path = newDir + fileName;
        entry.updatedAt = new Date().toISOString();
        updated++;
      }
    }
    if (updated > 0) {
      await this.save();
      console.log('[Registry] Updated', updated, 'paths from', oldDir, 'to', newDir);
    }
    return updated;
  },

  clear() {
    this._entries = [];
    this._loaded = false;
  }
};

window.Registry = Registry;
