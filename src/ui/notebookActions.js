'use strict';

/* ══════════════════════════════════════════════════════════════════════
   AKTIONEN AM HEFT: PDF-Export, frühere Fassungen, Papierkorb
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  /* ── PDF-Export ─────────────────────────────────────────────────── */

  // Führt jetzt in den Export-Dialog (ui/export.js): dort wird Format und
  // Seitenumfang gewählt, statt immer das ganze Heft als PDF auszugeben.
  const exportBtn = E('ctx-export-pdf');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      hideCtxMenu();
      const nb = getNb(_ctxNbId);
      if (!nb) return;
      if (typeof window.openExportDialog === 'function') openExportDialog(nb);
      else exportNotebookAsPdf(nb);
    });
  }

  /**
   * @param {object} nb
   * @param {object} [options]
   * @param {Set<string>} [options.pageIds] Nur diese Seiten ausgeben.
   */
  async function exportNotebookAsPdf(nb, options = {}) {
    if (!window.api?.exportPdf) { toast(t('electronOnly'), true); return; }

    // Offene Editor-Änderungen zuerst ins Datenmodell übernehmen,
    // sonst fehlt im PDF genau das zuletzt Geschriebene.
    if (S.activeNbId === nb.id && typeof syncAll === 'function') {
      try { syncAll(); } catch (e) { console.error('[PDF] syncAll:', e); }
    }

    toast(t('pdfBuilding') || 'PDF wird erstellt…');

    try {
      const html = buildPdf(nb, options);
      const defaultName = (typeof window.InkwellDocx?.safeFileName === 'function'
        ? InkwellDocx.safeFileName(nb.name)
        : 'inkwell') + '.pdf';
      const result = await window.api.exportPdf(html, defaultName);

      if (!result) return;                       // abgebrochen
      if (result.error) throw new Error(result.error);

      toast((t('pdfSaved') || 'PDF gespeichert: {path}').replace('{path}', result));
    } catch (err) {
      console.error('[PDF] Export fehlgeschlagen:', err);
      toast((t('pdfFailed') || 'PDF-Export fehlgeschlagen: {msg}').replace('{msg}', err.message), true);
    }
  }

  window.exportNotebookAsPdf = exportNotebookAsPdf;

  /* ── Frühere Fassungen ──────────────────────────────────────────── */

  const versionsOverlay = E('ov-versions');
  const versionsList = E('versions-list');
  const versionsBtn = E('ctx-versions');

  if (versionsBtn) {
    versionsBtn.addEventListener('click', async () => {
      hideCtxMenu();
      const nb = getNb(_ctxNbId);
      if (!nb) return;
      openVersions(nb);
    });
  }

  E('versions-close')?.addEventListener('click', () => versionsOverlay.style.display = 'none');
  versionsOverlay?.addEventListener('click', (e) => {
    if (e.target === versionsOverlay) versionsOverlay.style.display = 'none';
  });

  function infoRow(message) {
    const p = document.createElement('p');
    p.style.cssText = 'font-size:13px;color:var(--md);margin:0;padding:12px 0;';
    p.textContent = message;
    return p;
  }

  async function openVersions(nb) {
    versionsOverlay.style.display = 'flex';
    versionsList.innerHTML = '';
    versionsList.appendChild(infoRow(t('versionLoading') || 'Fassungen werden geladen…'));

    if (!CloudSync_.isConfigured() || !CloudSync_.isAuthenticated()) {
      versionsList.innerHTML = '';
      versionsList.appendChild(infoRow(t('versionNeedsLogin')));
      return;
    }

    try {
      const versions = await CloudSync_.listVersions(nb.id);
      versionsList.innerHTML = '';

      if (!versions.length) {
        versionsList.appendChild(infoRow(t('versionNone')));
        return;
      }

      versions.forEach((v, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;'
          + 'padding:10px 12px;background:var(--sidebar-bg);border-radius:6px;';

        const info = document.createElement('div');
        info.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';

        const when = document.createElement('span');
        when.style.cssText = 'font-size:13px;';
        const d = new Date(v.modifiedTime);
        when.textContent = Number.isNaN(d.getTime())
          ? '–'
          : d.toLocaleString(typeof getLanguage === 'function' ? getLanguage() : 'de');

        const meta = document.createElement('span');
        meta.style.cssText = 'font-size:11px;color:var(--md);';
        const sizeKb = v.size ? ` · ${(v.size / 1024).toFixed(0)} KB` : '';
        meta.textContent = (idx === 0 ? (t('versionCurrent') || 'aktuelle Fassung') : (t('versionOlder') || 'ältere Fassung')) + sizeKb;

        info.append(when, meta);
        row.appendChild(info);

        if (idx > 0) {
          const restore = document.createElement('button');
          restore.className = 'settings-btn';
          restore.style.cssText = 'flex-shrink:0;padding:6px 12px;font-size:12px;';
          restore.textContent = t('versionRestore') || 'Zurückholen';
          restore.addEventListener('click', async () => {
            const ok = await showConfirm((t('versionConfirm')
              || 'Diese Fassung zurückholen? Der aktuelle Stand wird vorher als Kopie gesichert.'));
            if (!ok) return;
            await restoreVersion(nb, v);
          });
          row.appendChild(restore);
        }

        versionsList.appendChild(row);
      });
    } catch (err) {
      versionsList.innerHTML = '';
      versionsList.appendChild(infoRow((t('versionFailed') || 'Fassungen konnten nicht geladen werden: {msg}')
        .replace('{msg}', err.message)));
    }
  }

  async function restoreVersion(nb, version) {
    try {
      toast(t('versionRestoring') || 'Fassung wird zurückgeholt…');

      // Aktuellen Stand vorher als eigenes Heft sichern – sonst wäre er weg
      const backup = JSON.parse(JSON.stringify(nb));
      backup.id = uid();
      backup.name = `${nb.name} (${t('versionBackupSuffix') || 'vorheriger Stand'} ${fmt(new Date().toISOString())})`;
      delete backup.syncedAt;
      S.notebooks.push(backup);
      await FileManager_.saveNotebook(backup, { immediateCloud: true });

      await CloudSync_.restoreVersion(nb.id, version.fileId, version.id);

      versionsOverlay.style.display = 'none';
      renderHomeGrid();
      if (S.activeNbId === nb.id) openNotebook(nb.id);
      toast(t('versionRestored') || 'Frühere Fassung wiederhergestellt.');
    } catch (err) {
      console.error('[Versions] Wiederherstellen fehlgeschlagen:', err);
      toast((t('versionFailed') || 'Fehler: {msg}').replace('{msg}', err.message), true);
    }
  }

  /* ── Papierkorb ─────────────────────────────────────────────────── */

  const trashOverlay = E('ov-trash');
  const trashList = E('trash-list');
  const trashCount = E('trash-count');

  E('btn-trash')?.addEventListener('click', () => openTrash());
  E('trash-close')?.addEventListener('click', () => trashOverlay.style.display = 'none');
  trashOverlay?.addEventListener('click', (e) => {
    if (e.target === trashOverlay) trashOverlay.style.display = 'none';
  });

  E('trash-empty')?.addEventListener('click', async () => {
    const entries = Trash.getAll();
    if (!entries.length) return;

    const ok = await showConfirm((t('trashEmptyConfirm')
      || '{n} Heft(e) endgültig löschen? Das lässt sich nicht rückgängig machen.')
      .replace('{n}', entries.length));
    if (!ok) return;

    /* Dasselbe Zeichen wie beim einzelnen endgültigen Löschen: jede Zeile
       blendet ab und bekommt einen Kreisel, erledigte verschwinden einzeln.
       Vorher stand die ganze Liste unverändert da, bis auch der letzte
       Eintrag in der Cloud weg war – bei einem vollen Papierkorb dauert
       das lange genug, dass der Klick ins Leere gegangen schien. */
    const emptyBtn = E('trash-empty');
    emptyBtn.disabled = true;
    for (const entry of entries) _busyEntries.add(entry.id);
    renderTrash();

    await Trash.emptyAll({
      onDeleted: (entry) => {
        _busyEntries.delete(entry.id);
        renderTrash();
        updateTrashCount();
      }
    });

    _busyEntries.clear();
    emptyBtn.disabled = false;
    renderTrash();
    updateTrashCount();
    toast(t('trashEmptied') || 'Papierkorb geleert.');
  });

  async function openTrash() {
    await Trash.load();
    trashOverlay.style.display = 'flex';
    renderTrash();

    // Gelöschtes von anderen Geräten nachladen und Abgelaufenes wegräumen.
    // Läuft nach dem ersten Zeichnen, damit sich das Fenster sofort öffnet.
    try {
      await Trash.syncWithCloud();
      await Trash.purgeExpired();
    } catch (err) {
      console.warn('[Trash] Abgleich beim Öffnen fehlgeschlagen:', err.message);
    }

    renderTrash();
    updateTrashCount();
  }

  /* Zurückholen und endgültiges Löschen fassen beide die Cloud an und
     brauchen ihre Zeit. Ohne Zeichen blieb die Zeile unverändert stehen,
     als wäre der Klick ins Leere gegangen. */
  /* Einträge, an denen gerade gearbeitet wird (zurückholen oder endgültig
     löschen).
     >>> Warum als Kennung und nicht an der Zeile <<<
     Wie im Raster der Startseite (ui/homeGrid.js): der Kreisel hing an dem
     DOM-Element. Sobald aber irgendein anderer Vorgang fertig wurde, baute
     renderTrash() die ganze Liste neu – und die Zeile des noch laufenden
     Eintrags war danach eine frische ohne Kreisel. Wer zwei Hefte kurz
     nacheinander endgültig löscht, sah den zweiten Kreisel verschwinden,
     obwohl der Vorgang noch lief. */
  const _busyEntries = new Set();

  // Aussehen steht in css/modals.css bei .trash-row-busy
  function setRowBusy(row, busy) {
    if (!row) return;
    row.classList.toggle('trash-row-busy', busy);
    row.querySelector('.trash-row-spinner')?.remove();
    if (!busy) return;

    const spinner = document.createElement('span');
    spinner.className = 'trash-row-spinner';
    row.appendChild(spinner);
  }

  /** Den Vorgang vormerken und die Zeile sofort abblenden. */
  function startEntryBusy(entryId, row) {
    _busyEntries.add(entryId);
    setRowBusy(row, true);
  }

  function endEntryBusy(entryId, row) {
    _busyEntries.delete(entryId);
    setRowBusy(row, false);
  }

  function renderTrash() {
    const entries = Trash.getAll();
    trashList.innerHTML = '';
    E('trash-empty').style.display = entries.length ? 'block' : 'none';

    if (!entries.length) {
      trashList.appendChild(infoRow(t('trashIsEmpty') || 'Der Papierkorb ist leer.'));
      return;
    }

    for (const entry of entries) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;'
        + 'background:var(--sidebar-bg);border-radius:6px;';
      // Läuft hier noch etwas, muss der Kreisel den Neuaufbau überleben
      const stillBusy = _busyEntries.has(entry.id);

      const dot = document.createElement('span');
      dot.style.cssText = `width:8px;height:32px;border-radius:3px;flex-shrink:0;background:${entry.color || 'var(--gold)'};`;
      row.appendChild(dot);

      const info = document.createElement('div');
      info.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;';

      const name = document.createElement('span');
      name.style.cssText = 'font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      name.textContent = entry.name;

      const meta = document.createElement('span');
      meta.style.cssText = 'font-size:11px;color:var(--md);';
      const d = new Date(entry.deletedAt);
      const when = Number.isNaN(d.getTime()) ? '' : d.toLocaleString(typeof getLanguage === 'function' ? getLanguage() : 'de');
      const pages = entry.pageCount != null
        ? `${entry.pageCount} ${entry.pageCount === 1 ? (t('page') || 'Seite') : (t('pages') || 'Seiten')} · `
        : '';
      meta.textContent = `${pages}${(t('trashDeletedAt') || 'gelöscht')} ${when}`;

      // Restfrist: läuft für jedes Heft einzeln ab seinem Löschzeitpunkt
      const left = Trash.daysLeft(entry);
      const expiry = document.createElement('span');
      expiry.style.cssText = `font-size:11px;color:${left <= 3 ? '#d9534f' : 'var(--lo)'};`;
      expiry.textContent = left === 0
        ? (t('trashExpiresToday') || 'Wird heute endgültig gelöscht')
        : (t('trashExpiresIn') || 'Wird in {n} Tagen endgültig gelöscht').replace('{n}', left);

      info.append(name, meta, expiry);

      /* Ohne lokale Datei stammt der Eintrag von einem anderen Gerät –
         der Inhalt kommt beim Zurückholen aus der Cloud. Liegt hier eine
         Sicherung im Eintrag selbst, ist alles da und die Zeile schweigt. */
      if (!entry.trashPath && !entry.snapshot) {
        const origin = document.createElement('span');
        origin.style.cssText = 'font-size:11px;color:var(--lo);';
        origin.textContent = entry.driveFileId
          ? t('trashFromOtherDevice')
          : (t('trashContentMissing') || 'Inhalt nicht mehr auffindbar');
        info.appendChild(origin);
      }
      row.appendChild(info);

      const restore = document.createElement('button');
      restore.className = 'settings-btn';
      restore.style.cssText = 'flex-shrink:0;padding:6px 12px;font-size:12px;';
      restore.textContent = t('trashRestore') || 'Zurückholen';
      // Ohne lokale Datei und ohne Drive-Datei gibt es nichts zurückzuholen
      if (!entry.trashPath && !entry.driveFileId && !entry.snapshot) {
        restore.disabled = true;
        restore.style.opacity = '0.4';
        restore.style.cursor = 'not-allowed';
      }
      restore.addEventListener('click', async () => {
        if (restore.disabled) return;
        restore.disabled = true;
        startEntryBusy(entry.id, row);
        const nb = await Trash.restore(entry.id);
        restore.disabled = false;
        if (!nb) {
          endEntryBusy(entry.id, row);
          toast(t('trashRestoreFailed') || 'Zurückholen fehlgeschlagen.', true);
          return;
        }
        _busyEntries.delete(entry.id);
        renderTrash();
        updateTrashCount();
        renderHomeGrid();
        toast((t('trashRestored') || '„{name}“ wurde zurückgeholt.').replace('{name}', nb.name));
      });
      row.appendChild(restore);

      const del = document.createElement('button');
      del.className = 'settings-btn';
      del.style.cssText = 'flex-shrink:0;padding:6px 12px;font-size:12px;color:#d9534f;border-color:rgba(217,83,79,0.3);';
      del.textContent = t('trashDeleteForever') || 'Endgültig';
      del.addEventListener('click', async () => {
        const ok = await showConfirm((t('trashDeleteConfirm')
          || '„{name}“ endgültig löschen? Das lässt sich nicht rückgängig machen.')
          .replace('{name}', entry.name));
        if (!ok) return;
        startEntryBusy(entry.id, row);
        await Trash.deleteForever(entry.id);
        _busyEntries.delete(entry.id);
        renderTrash();
        updateTrashCount();
        toast(t('trashDeletedForever') || 'Endgültig gelöscht.');
      });
      row.appendChild(del);

      // Erst ganz zum Schluss, damit der Kreisel hinter den Knöpfen sitzt
      if (stillBusy) setRowBusy(row, true);

      trashList.appendChild(row);
    }
  }

  async function updateTrashCount() {
    await Trash.load();
    const n = Trash.count();
    if (!trashCount) return;
    trashCount.textContent = String(n);
    trashCount.style.display = n ? 'inline-flex' : 'none';
  }

  window.updateTrashCount = updateTrashCount;
  document.addEventListener('DOMContentLoaded', () => updateTrashCount().catch(() => {}));
})();
