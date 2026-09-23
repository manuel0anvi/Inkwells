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

  /* ══════════════════════════════════════════════════════════════════
     ZWEI HEFTE, EINE DATEI

     Der Pfad eines Hefts ohne Eintrag in der Übersicht entstand hier aus
     nichts als seinem Namen: <Speicherort>\<Name>.jrnl. Ob dort schon
     etwas lag, wurde nicht gefragt – und saveToPath ersetzt, was es
     findet.

     Zwei Wege führen genau dahin:
       · Ein Heft „Heft" löschen, ein neues „Heft" anlegen, das alte aus
         dem Papierkorb zurückholen. restore() merkt zwar, dass der alte
         Pfad belegt ist, und verschiebt die Datei NICHT zurück – ruft
         danach aber saveNotebook() auf, und hier wurde derselbe Pfad
         wieder erfunden. Der Inhalt des neuen Hefts war überschrieben.
       · Zwei gleichnamige Hefte aus der Cloud herunterladen. Beide
         landeten in derselben Datei; im Speicher gab es zwei Hefte, auf
         der Platte eines, und beim nächsten Start fehlte eines.

     Danach zeigten zwei Kennungen der Übersicht auf denselben Pfad und
     überschrieben sich bei jedem weiteren Speichern gegenseitig.

     Die Regel ist jetzt einfach und ohne Ausnahme: ein Pfad, den ein
     ANDERES Heft beansprucht oder unter dem schon eine Datei liegt, wird
     nicht genommen. Stattdessen „Heft (2).jrnl". Lieber eine Datei zu
     viel als eine überschriebene.
     ══════════════════════════════════════════════════════════════════ */

  /** Windows-Pfade unterscheiden keine Groß- und Kleinschreibung. */
  _pfadGleich(a, b) {
    return String(a || '').toLowerCase().replace(/\//g, '\\')
        === String(b || '').toLowerCase().replace(/\//g, '\\');
  }

  /** Beansprucht ein ANDERES Heft der Übersicht diesen Pfad? */
  _gehoertAnderem(pfad, nbId) {
    try {
      return Registry.getAll().some(e => e.id !== nbId && this._pfadGleich(e.path, pfad));
    } catch (err) {
      return false;
    }
  }

  /**
   * Ein Pfad, der garantiert niemandem sonst gehört.
   *
   * Auch eine Datei, die keinem Eintrag der Übersicht zuzuordnen ist,
   * gilt als belegt: sie kann von einer verlorenen Übersicht stammen oder
   * von Hand dort abgelegt worden sein. Was in ihr steht, weiß hier
   * niemand – und darüber zu schreiben ist die einzige Entscheidung, die
   * sich nicht zurücknehmen lässt.
   */
  async _freierPfad(ordner, wunschDatei, nbId) {
    const basis = wunschDatei.replace(/\.jrnl$/i, '');

    for (let n = 1; n <= 99; n++) {
      const datei = n === 1 ? `${basis}.jrnl` : `${basis} (${n}).jrnl`;
      const pfad = `${ordner}\\${datei}`;
      if (this._gehoertAnderem(pfad, nbId)) continue;

      let belegt = true;
      try { belegt = await window.api.fileExists(pfad); }
      catch (err) { belegt = false; }     // nicht nachsehen können heißt: frei
      if (!belegt) return pfad;
    }

    /* Neunundneunzig gleichnamige Hefte sind kein Alltag – aber ohne
       Notnagel käme hier null heraus, und das Speichern schlüge fehl. */
    return `${ordner}\\${basis} (${String(nbId).slice(-6)}).jrnl`;
  }

  // Ermittelt den Zielpfad und benennt die Datei mit um, wenn das Notizbuch
  // umbenannt wurde. Ohne das hieße die Datei auf der Festplatte für immer
  // wie beim Anlegen, während sie in Google Drive den neuen Namen trägt.
  async _resolvePathForSave(notebook) {
    const entry = Registry.find(notebook.id);
    const saveLocation = Settings.get('saveLocation');
    const desiredFile = `${this._sanitizeFilename(notebook.name || 'Unbenannt')}.jrnl`;

    if (!entry || !entry.path) {
      if (!saveLocation) return null;
      return await this._freierPfad(saveLocation, desiredFile, notebook.id);
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

    /* Was keine Seite mehr braucht, geht nicht mit auf die Platte: ein
       gelöschtes 40-MB-Buch blähte das Heft sonst für immer auf. */
    if (window.PdfSeiten) PdfSeiten.raeumeAuf(notebook);

    /* Verschobene, vergrösserte und empfangene Striche haben wieder lange
       Brüche – vor dem Schreiben kommen sie auf das Raster (core/data.js).
       Was schon passt, wird nur gelesen. */
    if (typeof stricheVerdichten === 'function') stricheVerdichten(notebook);

    try {
      /* ══ ALS TEXT UND NICHT ALS GEGENSTAND ════════════════════════════
         Hier ging das Heft als Objekt über die Brücke. Electron klont es
         dafür Feld für Feld – bei 5000 Strichen sind das Hunderttausende
         kleiner Objekte, und das auf dem Faden, der auch den Stift
         zeichnet. Danach verwandelte der Hauptprozess es noch einmal in
         Text, und zwar synchron: in der Zeit stand dort die Weiterleitung
         der Eingaben still. Beides zusammen war das Ruckeln, das alle zwei
         Sekunden durch Schreiben, Auswählen und Farbwahl ging.

         Jetzt wird hier einmal JSON gebaut – schnell und am Stück –, und
         über die Brücke geht nur noch eine Zeichenkette. main.js schreibt
         sie, ohne den Faden anzuhalten. */
      const saveData = JSON.stringify({ notebooks: [notebook] });
      const result = await window.api.saveToPath(filePath, saveData);

      if (!result.success) {
        console.error(`[FileManager] ✗ Save failed: ${result.error}`);
        throw new Error(result.error);
      }

      this.notebookPaths.set(notebook.id, filePath);
      await Registry.add(notebook, filePath);

      /* Ein Stand für den örtlichen Verlauf – höchstens alle zwanzig
         Minuten und nur bei wirklicher Änderung, die Bremsen stehen
         dort (core/versions.js). Bewusst ohne await und mit eigenem
         Auffangnetz: der Verlauf ist eine Bequemlichkeit, das Speichern
         des Hefts ist es nicht. Scheitert er, darf das Speichern
         trotzdem als gelungen gelten. */
      if (typeof Versions !== 'undefined' && Versions) {
        Versions.vielleichtSichern(notebook).catch(err =>
          console.warn('[FileManager] Versionsstand übersprungen:', err));
      }

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
