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

    const expired = this._entries.filter(e => !e.purged && this.isExpired(e));
    if (!expired.length) return 0;

    /* Dieselbe Vorsicht wie beim Leeren von Hand: der Eintrag geht erst
       weg, wenn die Cloud-Datei nachweislich weg ist. Sonst verfällt er
       nach 30 Tagen still und lässt seine Datei für immer liegen. */
    for (const entry of expired) {
      if (await this._destroy(entry)) {
        this._entries = this._entries.filter(e => e !== entry);
        console.log(`[Trash] Nach ${TRASH_RETENTION_DAYS} Tagen entfernt: ${entry.name}`);
      } else {
        entry.purged = true;
        entry.trashPath = null;
        entry.snapshot = null;
        console.warn('[Trash] Abgelaufen, Cloud-Datei wird nachgeholt:', entry.name);
      }
    }

    await this.save();
    await this._pushIndex();

    return expired.length;
  },

  // Papierkorb und Übersicht liegen in derselben Datei; Registry.save()
  // schreibt beides zusammen (siehe core/registry.js).
  async save() {
    await Registry.save();
  },

  /* ── Grabsteine ───────────────────────────────────────────────────
     Zwei Sorten Eintrag sind örtlich erledigt, in der Cloud aber noch
     nicht. Sie stehen nicht mehr in der Anzeige, bleiben aber in der
     Liste, damit _catchUpCloudTrash die Cloud-Seite nachholen kann:

       purged   = endgültig gelöscht, die Cloud-Datei steht noch aus
       restored = zurückgeholt, die Cloud-Datei liegt noch im
                  Papierkorb-Ordner oder steht noch in der gemeinsamen
                  Liste

     Ohne den zweiten kam ein ohne Netz zurückgeholtes Heft beim nächsten
     Abgleich wieder in den Papierkorb: örtlich war der Eintrag weg, in
     der gemeinsamen Liste stand er noch, und „kennt nur die Wolke" heißt
     „auf einem anderen Gerät gelöscht". */
  _isTombstone(entry) {
    return !!(entry && (entry.purged || entry.restored));
  },

  getAll() {
    return this._entries
      .filter(e => !this._isTombstone(e))
      .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  },

  count() {
    return this._entries.filter(e => !this._isTombstone(e)).length;
  },

  /* ── Was am Papierkorb noch mit der Cloud abzugleichen ist ─────────
     Der Papierkorb fuehrt seine ausstehenden Sachen SELBST, nicht in der
     Warteschlange von CloudSync_. Drei Zustaende koennen offen sein, und
     alle drei holt _catchUpCloudTrash() spaeter nach:

       !cloudTrashed  die Cloud-Datei liegt noch im Hauptordner - das
                      Verschieben in den Papierkorb-Ordner ist nicht
                      durchgekommen (meist: kein Netz)
       restored       ohne Netz zurueckgeholt, die Cloud-Datei liegt noch
                      im Papierkorb-Ordner
       purged         endgueltig geloescht, die Cloud-Datei steht noch aus

     Bis dahin war davon nirgends etwas zu sehen: in der App war das Heft
     weg, in der Cloud noch da, und niemand konnte sagen, dass da noch
     etwas aussteht. Genau dafuer gibt es das Sync-Fenster
     (ui/syncPanel.js).

     Die Form ist bewusst dieselbe wie bei CloudSync_.getPendingActions(),
     damit beide Listen ohne Umrechnung nebeneinander stehen koennen.

     >>> Warum deletedAt als Zeitpunkt <<<
     Einen eigenen Zeitstempel fuers Zurueckholen oder endgueltige
     Loeschen gibt es nicht. deletedAt ist der einzige vorhandene und
     stimmt fuer den haeufigsten Fall (Loeschen ohne Netz) genau.

     @returns {Array<{nbId: string, nbName: string, action: string, queuedAt: string}>}
  */
  getPendingCloudActions() {
    const offen = [];
    for (const entry of this._entries) {
      let action = null;

      if (entry.restored) {
        /* Ohne Datei-Kennung gibt es in der Cloud nichts zurueckzuholen -
           _catchUpCloudTrash wirft so einen Eintrag beim naechsten Mal
           einfach weg. Er wartet also auf nichts. */
        if (entry.driveFileId) action = 'restore';
      } else if (entry.purged) {
        action = 'delete';
      } else if (!entry.cloudTrashed) {
        action = 'trash';
      }

      if (!action) continue;
      offen.push({
        nbId: entry.id,
        nbName: entry.name || '',
        action,
        queuedAt: entry.deletedAt || ''
      });
    }
    return offen;
  },

  /* Grabsteine bleiben außen vor: Zurückholen und endgültiges Löschen
     meinen immer den lebenden Eintrag, nie den nachzuholenden Rest. */
  find(id) {
    return this._entries.find(e => e.id === id && !this._isTombstone(e));
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

    /* >>> Ein freigegebenes Heft nimmt seine Freigabe mit <<<
       Vorher blieb sie stehen: das Heft lag beim Besitzer im Papierkorb,
       die Eingeladenen sahen es aber weiter in ihrer Liste, konnten es
       öffnen und darin schreiben – in ein Dokument, das seinen Besitzer
       verloren hatte. Jetzt wird die Freigabe zuerst zurückgezogen; die
       anderen fliegen dadurch hinaus (watchOpenDocument sieht den Kopf
       verschwinden) und das Dokument fällt aus ihrer Liste. */
    if (typeof window.unshareNotebook === 'function') {
      try {
        if (await window.unshareNotebook(notebook.id)) {
          console.log('[Trash] Freigabe zurückgezogen:', notebook.name);
        }
      } catch (err) {
        console.warn('[Trash] Freigabe nicht zurückgezogen:', err?.message || err);
      }
    }

    await this.load();

    /* Ein offener Grabstein „zurückgeholt" zu genau diesem Heft ist mit dem
       erneuten Löschen hinfällig. Bliebe er stehen, schöbe
       _catchUpCloudTrash die Cloud-Datei gleich wieder aus dem Papierkorb
       heraus, die der neue Eintrag gerade hineingelegt hat. */
    this._entries = this._entries.filter(e => !(e.id === notebook.id && e.restored));

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

    const entry = {
      id: notebook.id,
      name: notebook.name,
      color: notebook.color,
      pageCount: (notebook.pages || []).length,
      originalPath: originalPath || null,
      trashPath,
      driveFileId: null,
      // Ist die Cloud-Seite wirklich erledigt? Solange nicht, versucht es
      // syncWithCloud bei jedem Abgleich erneut.
      cloudTrashed: false,
      // Notweg genommen: die Cloud-Datei ist gelöscht statt verschoben
      cloudDeleted: false,
      deletedAt: new Date().toISOString(),
      // Sicherheitsnetz: falls die Datei fehlt, liegt der Inhalt hier
      snapshot: trashPath ? null : JSON.parse(JSON.stringify(notebook))
    };

    // In Drive in den Papierkorb-Unterordner verschieben. Ohne das käme das
    // Heft beim nächsten Abgleich zurück.
    try {
      if (typeof CloudSync_ !== 'undefined' && CloudSync_) {
        const res = await this._clearFromCloud(entry);
        entry.driveFileId = res.fileId;
        entry.cloudTrashed = res.done;
        entry.cloudDeleted = res.deleted;
      }
    } catch (err) {
      console.warn('[Trash] Drive-Verschieben übersprungen:', err.message);
    }

    /* ── Im Sync-Fenster muss das IMMER auftauchen ────────────────────
       Egal ob mit oder ohne Netz – wer ein Heft loescht, will sehen, was
       damit in der Cloud geschieht.

         · Cloud-Seite noch offen  -> in die Warteschlange, dort steht es
           als wartend (blau), bis es durchkommt
         · Cloud-Seite schon fertig -> ins Protokoll, dort steht es als
           erledigt (gruen)

       Der zweite Fall fehlte. Mit Internet klappt das Verschieben sofort,
       und dann wurde weder etwas eingereiht noch etwas vermerkt: die
       Loeschung war im Fenster ueberhaupt nicht zu sehen. Ohne Internet
       tauchte sie auf, mit Internet nicht – also genau verkehrt herum. */
    if (typeof CloudSync_ !== 'undefined' && CloudSync_) {
      if (!entry.cloudTrashed && typeof CloudSync_.queueNotebook === 'function') {
        CloudSync_.queueNotebook(notebook.id, { action: 'trash', nbName: notebook.name, silent: true });
      } else if (entry.cloudTrashed && typeof CloudSync_.noteSyncDone === 'function') {
        CloudSync_.noteSyncDone({
          nbId: notebook.id,
          nbName: notebook.name,
          action: 'trash',
          reason: (typeof t === 'function' && t('syncDoneTrash')) || 'In den Papierkorb verschoben'
        });
      }
    }

    this._entries.push(entry);

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

    /* >>> Gibt es die gemeinsame Liste überhaupt? <<<
       Ein fehlender Eintrag bedeutet nur dann „anderswo erledigt", wenn
       die Liste existiert. Gibt es sie gar nicht – frisch angemeldet, der
       Anbieter gewechselt, die Datei von Hand entfernt –, dann weiß die
       Cloud noch nichts, statt etwas anderes zu wissen.

       Ohne diesen Unterschied wurde beim Anmelden der gesamte Papierkorb
       geleert, samt der örtlichen Sicherungen. Danach hielt nichts mehr
       die gelöschten Hefte davon ab, beim nächsten Abgleich zurückzukommen
       – und zwar alle auf einmal. */
    const remoteById = new Map(remote.entries.map(e => [e.id, e]));
    const merged = [];
    let changed = false;

    for (const local of this._entries) {
      /* Grabsteine stehen bewusst NICHT in der gemeinsamen Liste (siehe
         _pushIndex). Sie dürfen hier deshalb nicht als „anderswo
         erledigt" weggeräumt werden – dann bliebe die Cloud-Seite wieder
         für immer offen.

         Aus der Wolken-Liste müssen sie trotzdem heraus: kam das
         Hochladen der Liste nicht durch (kein Netz), steht das Heft dort
         noch. Ohne diese Zeile käme es weiter unten als „kennt nur die
         Wolke" wieder herein – als sichtbarer Eintrag, neben dem
         Grabstein. Genau das machte ein ohne Netz zurückgeholtes Heft
         wieder rückgängig. */
      if (this._isTombstone(local)) {
        remoteById.delete(local.id);
        merged.push(local);
        continue;
      }

      const inRemote = remoteById.get(local.id);

      if (inRemote) {
        // Beide kennen den Eintrag – lokale Pfade behalten, Rest aus der Wolke
        merged.push({ ...inRemote, ...pickLocalFields(local), syncedToCloud: true });
        remoteById.delete(local.id);
        continue;
      }

      if (local.syncedToCloud && remote.exists) {
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
      // Über _pushIndex, damit die Grabsteine draußen bleiben – hier stand
      // vorher this._entries ungefiltert, womit ein endgültig gelöschtes
      // Heft auf den anderen Geräten wieder im Papierkorb auftauchte.
      await this._pushIndex();
    }

    return true;
  },

  /**
   * Holt für jeden Eintrag nach, was in der Cloud noch offen ist.
   * @returns {Promise<boolean>} ob sich etwas geändert hat
   */
  async _catchUpCloudTrash() {
    if (typeof CloudSync_ === 'undefined' || !CloudSync_) return false;

    /* >>> Auch die abgehakten Einträge nachsehen <<<
       Ein Eintrag mit cloudTrashed galt als erledigt und wurde nie wieder
       angefasst. Hatte das Verschieben in Wirklichkeit nichts bewirkt –
       unter Microsoft der Normalfall, siehe providers/oneDrive.js –, blieb
       die Datei für immer im Hauptordner: in der App gelöscht, auf der
       Website weiterhin da. Ein Blick in den Hauptordner räumt das auf. */
    const stillInMainFolder = await CloudSync_.listRemoteNotebookIds?.();

    let changed = false;
    for (const entry of [...this._entries]) {
      /* Ohne Netz zurückgeholt: die Cloud-Datei liegt noch im
         Papierkorb-Ordner. Jetzt zurückschieben – gelingt es, ist der
         Eintrag erledigt und fällt beim Hochladen aus der gemeinsamen
         Liste. Ohne Datei-Kennung gibt es dort nichts zu tun. */
      if (entry.restored) {
        if (!entry.driveFileId) {
          this._entries = this._entries.filter(e => e !== entry);
          changed = true;
          continue;
        }
        try {
          if (await CloudSync_.untrashRemoteNotebook(entry.driveFileId)) {
            this._entries = this._entries.filter(e => e !== entry);
            console.log('[Trash] Cloud-Datei nachträglich zurückgeholt:', entry.name);
            changed = true;
          }
        } catch (err) {
          console.warn('[Trash] Nachholen des Zurückholens:', err.message);
        }
        continue;
      }

      /* Endgültig gelöscht, aber die Cloud-Datei stand noch aus. Jetzt
         noch einmal – gelingt es, verschwindet der Eintrag ganz. */
      if (entry.purged) {
        try {
          if (await this._destroy(entry)) {
            this._entries = this._entries.filter(e => e !== entry);
            console.log('[Trash] Cloud-Datei nachträglich gelöscht:', entry.name);
            changed = true;
          }
        } catch (err) {
          console.warn('[Trash] Nachholen des endgültigen Löschens:', err.message);
        }
        continue;
      }

      if (entry.cloudTrashed && stillInMainFolder?.includes(entry.id)) {
        console.warn('[Trash] Liegt trotz Vermerk noch im Cloud-Hauptordner:', entry.name);
        entry.cloudTrashed = false;
        changed = true;
      }
      if (entry.cloudTrashed) continue;
      try {
        const res = await this._clearFromCloud(entry);
        if (!res.done) continue;                 // kein Netz – beim nächsten Mal
        entry.driveFileId = res.fileId;
        entry.cloudTrashed = true;
        entry.cloudDeleted = res.deleted;
        changed = true;
      } catch (err) {
        console.warn('[Trash] Drive-Verschieben nachgeholt fehlgeschlagen:', err.message);
      }
    }
    return changed;
  },

  /**
   * Sorgt dafür, dass das Heft aus dem Hauptordner der Cloud verschwindet.
   *
   * Der gute Weg ist das Verschieben in den Cloud-Papierkorb: von dort holt
   * es jedes Gerät zurück. Klappt das nicht, wird die Cloud-Datei gelöscht.
   *
   * >>> Warum es diesen Notweg braucht <<<
   * Bleibt die Datei im Hauptordner liegen, ist das der schlechteste
   * Ausgang: in der App ist das Heft gelöscht, in OneDrive und damit auf
   * der Website steht es weiterhin da – dauerhaft, denn der Abgleich hakt
   * den Eintrag irgendwann ab. Genau das ist unter Microsoft passiert.
   *
   * Gelöscht wird nur, solange der Inhalt hier örtlich liegt. Dann ist das
   * Heft nicht verloren, es lässt sich nur eben nur noch von diesem Gerät
   * aus zurückholen. Ohne örtliche Sicherung bleibt die Datei lieber liegen.
   *
   * @returns {Promise<{done: boolean, fileId: string|null, deleted: boolean}>}
   */
  async _clearFromCloud(entry) {
    const moved = await CloudSync_.trashRemoteNotebook(entry.id);
    if (moved?.done) return { done: true, fileId: moved.fileId || null, deleted: false };

    const offen = { done: false, fileId: moved?.fileId || null, deleted: false };
    if (!entry.trashPath && !entry.snapshot) return offen;

    // Ohne Netz meldet auch das hier Fehlschlag – dann wird nichts gelöscht
    const gone = await CloudSync_.deleteRemoteNotebookById(entry.id);
    if (!gone) return offen;

    console.warn('[Trash] Verschieben ging nicht – Cloud-Datei gelöscht:', entry.name);
    return { done: true, fileId: null, deleted: true };
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
    let cloudFertig = true;
    if (entry.driveFileId && typeof CloudSync_ !== 'undefined' && CloudSync_) {
      const fromDrive = await CloudSync_.untrashRemoteNotebook(entry.driveFileId);
      if (fromDrive && !notebook) {
        // Auf einem anderen Gerät gelöscht: der Inhalt kommt aus Drive
        notebook = Array.isArray(fromDrive?.notebooks) ? fromDrive.notebooks[0] : fromDrive;
      }
      cloudFertig = !!fromDrive;
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

    // Einen eventuellen Lösch-Eintrag aus der Sync-Queue entfernen – das Heft
    // lebt wieder und soll hochgeladen werden, nicht gelöscht.
    if (typeof CloudSync_ !== 'undefined' && CloudSync_
        && typeof CloudSync_.queueNotebook === 'function') {
      CloudSync_.queueNotebook(notebook.id, { action: 'restore', nbName: notebook.name, immediate: true, silent: true });
    }

    // Legt die Datei neu an, falls sie nicht zurückverschoben werden konnte,
    // und trägt das Heft wieder in die Übersicht ein
    await FileManager_.saveNotebook(notebook, { touch: false, immediateCloud: true });
    await this.save();

    // Gemeinsame Liste aktualisieren, damit der Eintrag auch auf den
    // anderen Geräten verschwindet
    const indexOk = await this._pushIndex();

    /* >>> Ohne Netz ist das Zurückholen erst halb geschehen <<<
       Örtlich liegt das Heft wieder da, in der Cloud aber noch im
       Papierkorb-Ordner und in der gemeinsamen Liste. Der nächste
       Abgleich hielte das für „auf einem anderen Gerät gelöscht" und
       würfe das Heft erneut in den Papierkorb – schon einmal so erlebt
       beim Löschen. Deshalb bleibt ein Grabstein stehen, bis
       _catchUpCloudTrash die Cloud-Seite nachgeholt hat. Aus Anzeige und
       Zählung ist er heraus (siehe _isTombstone).

       Nur nötig, wenn die Cloud von dem Heft überhaupt weiß. */
    if ((!cloudFertig || !indexOk) && (entry.driveFileId || entry.syncedToCloud)) {
      console.warn('[Trash] Zurückgeholt, Cloud-Seite wird nachgeholt:', entry.name);
      entry.restored = true;
      entry.trashPath = null;   // die Datei liegt jetzt wieder am Zielort
      entry.snapshot = null;
      this._entries.push(entry);
      await this.save();
    }

    return notebook;
  },

  /**
   * Entfernt einen Eintrag endgültig – lokal und in Drive.
   *
   * >>> Warum der Eintrag nicht immer sofort verschwindet <<<
   * Vorher wurde er aus der Liste geworfen, ganz gleich ob die Cloud-Seite
   * geklappt hat. War gerade kein Netz da, das Zugangsmerkmal abgelaufen
   * oder ging der Aufruf schief, blieb die Datei im Papierkorb-Ordner der
   * Cloud liegen – und der Eintrag, über den man es hätte nachholen
   * können, war weg. Damit war sie dort für immer. Genau das war „im
   * Google-Papierkorb bleiben die Dateien auch nach dem Leeren".
   *
   * Jetzt bleibt der Eintrag in dem Fall bestehen, nur als `purged`
   * gekennzeichnet: örtlich ist alles gelöscht, aus der Anzeige ist er
   * verschwunden, und beim nächsten Abgleich wird die Cloud-Datei erneut
   * gelöscht. Erst wenn das gelingt, ist er ganz weg.
   */
  async deleteForever(id, options = {}) {
    await this.load();
    const entry = this.find(id);
    if (!entry) return;

    const cloudFertig = await this._destroy(entry);

    /* Der oertliche Versionsverlauf gehoert zu diesem Heft und hat ohne
       es keinen Sinn mehr. Wuerde er liegen bleiben, wuechse der Ordner
       „Versionen" mit jedem geloeschten Heft weiter - unsichtbar, denn
       in der Uebersicht steht davon nichts.

       Auch dann, wenn die Cloud-Seite noch aussteht: oertlich ist die
       Datei schon weg, und um die geht es hier. */
    if (typeof Versions !== 'undefined' && Versions) {
      try { await Versions.entferneHeft(id); }
      catch (err) { console.warn('[Trash] Versionsstaende blieben liegen:', err); }
    }

    if (cloudFertig) {
      this._entries = this._entries.filter(e => e.id !== id);

      /* Ins Protokoll, sonst bliebe das endgueltige Loeschen unsichtbar.
         Derselbe Fall wie beim Verschieben in den Papierkorb: geht die
         Cloud-Seite sofort durch, wartet nichts mehr - und dann schrieb
         auch niemand etwas auf. Im Fenster sah es aus, als sei nichts
         geschehen, obwohl gerade eine Datei aus der Cloud verschwand.

         Schlaegt es fehl, bleibt entry.purged stehen; das taucht ueber
         getPendingCloudActions() als wartend auf. */
      if (typeof CloudSync_ !== 'undefined' && CloudSync_
          && typeof CloudSync_.noteSyncDone === 'function') {
        CloudSync_.noteSyncDone({
          nbId: entry.id,
          nbName: entry.name,
          action: 'delete',
          reason: (typeof t === 'function' && t('syncDoneDelete')) || 'Endgültig gelöscht'
        });
      }
    } else {
      console.warn('[Trash] Cloud-Datei noch nicht weg, wird nachgeholt:', entry.name);
      entry.purged = true;
      entry.trashPath = null;      // örtlich ist sie schon gelöscht
      entry.snapshot = null;
    }

    await this.save();
    if (options.pushIndex !== false) await this._pushIndex();
  },

  /**
   * Leert den ganzen Papierkorb.
   * @param {object} [options]
   * @param {(entry: object) => void} [options.onDeleted] nach jedem Eintrag.
   *   Die Anzeige braucht das: in der Cloud dauert jeder Eintrag seine Zeit,
   *   und die Zeilen sollen einzeln verschwinden statt alle am Ende.
   */
  async emptyAll(options = {}) {
    await this.load();
    for (const entry of [...this._entries]) {
      // Liste erst am Ende einmal hochladen statt nach jedem Eintrag
      await this.deleteForever(entry.id, { pushIndex: false });
      try { options.onDeleted?.(entry); } catch (e) { /* Anzeige darf nichts aufhalten */ }
    }
    await this._pushIndex();
  },

  /**
   * Löscht die Dateien eines Eintrags – lokal und in Drive.
   *
   * @returns {Promise<boolean>} ob die CLOUD-Seite erledigt ist. false
   *   heißt: die Datei liegt dort noch, später noch einmal versuchen.
   */
  async _destroy(entry) {
    if (entry.trashPath) {
      try {
        await window.api.deleteFile(entry.trashPath);
      } catch (err) {
        console.warn('[Trash] Datei konnte nicht gelöscht werden:', err);
      }
    }

    /* Ohne Cloud gibt es dort auch nichts zu löschen – das gilt als
       erledigt. Wer nie angemeldet war, soll seinen Papierkorb leeren
       können, ohne dass Einträge hängen bleiben. */
    if (typeof CloudSync_ === 'undefined' || !CloudSync_) return true;
    if (!Settings.get('cloudEnabled') || !CloudSync_.isAuthenticated?.()
        || !CloudSync_.isConfigured?.()) {
      /* Kein Konto verbunden. Eine Datei-Kennung heißt aber, dass sehr
         wohl etwas in der Cloud liegt – dann bleibt es offen, bis wieder
         jemand angemeldet ist. */
      return !entry.driveFileId;
    }

    /* >>> Die Kennung allein reicht nicht <<<
       Wer beim Löschen kein Netz hatte, hat keine Datei-Kennung. Endgültig
       gelöscht wurde dann nur örtlich – die Datei blieb in der Cloud und
       kam beim nächsten Abgleich als „neues" Heft zurück. Deshalb zusätzlich
       über die Heft-Kennung suchen, in beiden Ordnern. */
    if (entry.driveFileId) {
      await CloudSync_.deleteRemoteFile(entry.driveFileId);
    }
    /* Zusätzlich über die Heft-Kennung, in BEIDEN Ordnern. Bei einem
       Umzug legt die Cloud die Datei am Zielort mitunter neu an – die
       gemerkte Kennung zeigt dann auf die eine Fassung, während die
       andere liegen bleibt. */
    await CloudSync_.deleteRemoteNotebookById(entry.id);

    /* >>> Und jetzt nachsehen, statt es zu glauben <<<
       Beide Aufrufe melden auch dann Erfolg oder Misserfolg, wenn sie
       schlicht nichts gefunden haben. Erst diese Gegenprobe sagt, ob zu
       dem Heft wirklich nichts mehr in der Cloud liegt – im Hauptordner
       wie im Papierkorb-Unterordner. Nur dann darf der Eintrag weg.
       Sagt sie null (kein Netz, nicht lesbar), bleibt es offen. */
    return await CloudSync_.remoteNotebookExists(entry.id) === false;
  },

  /**
   * Schreibt die aktuelle Liste in die gemeinsame Datei in Drive.
   * @returns {Promise<boolean>} ob die Liste dort wirklich ankam. false
   *   heißt ohne Netz oder nicht angemeldet – dann später noch einmal.
   */
  async _pushIndex() {
    if (typeof CloudSync_ === 'undefined' || !CloudSync_) return true;
    try {
      /* Grabsteine gehören NICHT in die gemeinsame Liste – sonst sähe das
         andere Gerät ein Heft im Papierkorb, das es hier nicht mehr gibt. */
      const sichtbar = this._entries.filter(e => !this._isTombstone(e));
      return await CloudSync_.saveTrashIndex(sichtbar.map(stripLocalFields)) !== false;
    } catch (err) {
      console.warn('[Trash] Gemeinsame Liste nicht aktualisiert:', err.message);
      return false;
    }
  }
};

window.Trash = Trash;
