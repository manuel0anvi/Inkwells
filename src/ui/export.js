'use strict';

/* ══════════════════════════════════════════════════════════════════════
   EXPORT-DIALOG

   Ein Heft muss nicht immer als Ganzes heraus. Hier wird gewählt:
     · Format  – PDF oder Word (.docx)
     · Umfang  – alles, nur die aktuelle Seite oder ein Bereich („1-3, 5")

   Die maßgebliche Seitenliste kommt aus core/importExport.js
   (exportPageList). Dieselbe Liste baut auch das PDF – dadurch stimmt
   die Nummer im Dialog immer mit dem überein, was hinten herauskommt.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const overlay = E('ov-export');
  if (!overlay) return;

  const statusEl = E('export-status');
  const totalEl = E('export-total');
  const rangeInput = E('export-range-in');
  const currentRow = E('export-scope-current-row');
  const currentHint = E('export-current-hint');
  const startBtn = E('export-start');

  let exportNb = null;
  let entries = [];        // aus exportPageList()
  let currentIndex = -1;   // 0-basiert, Position der offenen Seite

  /* ── Öffnen und Schließen ─────────────────────────────────────────── */

  function close() {
    overlay.style.display = 'none';
    exportNb = null;
  }

  function open(nb) {
    if (!nb) { toast(t('noActiveNotebook'), true); return; }

    exportNb = nb;
    entries = exportPageList(nb);

    if (!entries.length) {
      toast(t('pdfEmpty'), true);
      return;
    }

    totalEl.textContent = ` · ${entries.length} ${entries.length === 1 ? t('page') : t('pages')}`;

    // „Nur die aktuelle Seite" ergibt nur Sinn, wenn dieses Heft offen ist
    currentIndex = (S.activeNbId === nb.id)
      ? entries.findIndex(e => e.page.id === S.activePgId)
      : -1;

    const currentRadio = overlay.querySelector('input[name="export-scope"][value="current"]');
    if (currentIndex >= 0) {
      currentRow.style.display = '';
      currentRadio.disabled = false;
      currentHint.textContent = t('exportPageOf')
        .replace('{n}', currentIndex + 1)
        .replace('{total}', entries.length);
    } else {
      currentRow.style.display = 'none';
      currentRadio.disabled = true;
      currentHint.textContent = '';
    }

    overlay.querySelector('input[name="export-scope"][value="all"]').checked = true;
    overlay.querySelector('input[name="export-format"][value="pdf"]').checked = true;
    rangeInput.value = '';
    rangeInput.disabled = true;
    statusEl.textContent = '';
    startBtn.disabled = false;

    overlay.style.display = 'flex';
  }

  E('export-close')?.addEventListener('click', close);
  E('export-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Das Eingabefeld gehört zur Auswahl „Bestimmte Seiten" – solange eine
  // andere Zeile gewählt ist, bleibt es abgeblendet.
  overlay.querySelectorAll('input[name="export-scope"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isRange = overlay.querySelector('input[name="export-scope"]:checked')?.value === 'range';
      rangeInput.disabled = !isRange;
      if (isRange) rangeInput.focus();
      statusEl.textContent = '';
    });
  });

  rangeInput.addEventListener('input', () => { statusEl.textContent = ''; });
  rangeInput.addEventListener('focus', () => {
    const radio = overlay.querySelector('input[name="export-scope"][value="range"]');
    if (radio && !radio.checked) { radio.checked = true; rangeInput.disabled = false; }
  });

  /* ── Auswahl auswerten ────────────────────────────────────────────── */

  /** @returns {Array|null} die gewählten Einträge, null bei Fehleingabe */
  function selectedEntries() {
    const scope = overlay.querySelector('input[name="export-scope"]:checked')?.value || 'all';

    if (scope === 'all') return entries;

    if (scope === 'current') {
      if (currentIndex < 0) return null;
      return [entries[currentIndex]];
    }

    const numbers = parsePageRange(rangeInput.value, entries.length);
    if (!numbers) {
      statusEl.textContent = t('exportRangeInvalid');
      return null;
    }

    const chosen = entries.filter((_, index) => numbers.has(index + 1));
    if (!chosen.length) {
      statusEl.textContent = t('exportNoPages');
      return null;
    }
    return chosen;
  }

  /* ── Ausgabe ──────────────────────────────────────────────────────── */

  async function runExport() {
    if (!exportNb) return;

    // Der Editor-Stand muss erst ins Datenmodell, sonst fehlt im Export
    // genau das, was gerade getippt wurde.
    if (S.activeNbId === exportNb.id && typeof syncAll === 'function') {
      try { syncAll(); } catch (e) { console.warn('[Export] syncAll:', e); }
    }
    // Nach syncAll() kann eine bis eben leere Seite Inhalt haben und damit
    // in der Liste auftauchen – dann verschieben sich die Seitenzahlen.
    entries = exportPageList(exportNb);
    currentIndex = (S.activeNbId === exportNb.id)
      ? entries.findIndex(e => e.page.id === S.activePgId)
      : -1;

    const chosen = selectedEntries();
    if (!chosen) return;

    const format = overlay.querySelector('input[name="export-format"]:checked')?.value || 'pdf';
    const pageIds = new Set(chosen.map(e => e.page.id));

    startBtn.disabled = true;
    try {
      if (format === 'docx') {
        await exportAsDocx(exportNb, chosen);
      } else {
        await exportNotebookAsPdf(exportNb, { pageIds });
      }
      close();
    } finally {
      startBtn.disabled = false;
    }
  }

  startBtn?.addEventListener('click', () => { runExport().catch(err => {
    console.error('[Export] fehlgeschlagen:', err);
    statusEl.textContent = String(err.message || err);
  }); });

  /* ── Word ─────────────────────────────────────────────────────────── */

  async function exportAsDocx(nb, chosen) {
    if (!window.InkwellDocx) { toast(t('docxUnavailable'), true); return; }
    if (!window.api?.saveBinary) { toast(t('electronOnly'), true); return; }

    toast(t('docxBuilding'));
    statusEl.textContent = t('docxBuilding');

    // core/docx.js kennt weder Abschnitte noch Übersetzungen – die
    // Kopfzeile wird deshalb hier zusammengesetzt, genau wie im PDF.
    const docxEntries = chosen.map(entry => ({
      page: entry.page,
      bg: entry.page.bg || entry.sec?.defaultBg || nb.defaultBg || 'ruled',
      headerLeft: `${t('page')} ${entry.indexInSection + 1}`,
      headerRight: fmt(entry.page.date)
    }));

    try {
      const bytes = await InkwellDocx.build(docxEntries, {
        title: nb.name,
        onProgress: (done, total) => {
          statusEl.textContent = `${t('docxBuilding')} ${done}/${total}`;
        }
      });

      const result = await window.api.saveBinary({
        defaultName: InkwellDocx.safeFileName(nb.name) + '.docx',
        filterName: 'Word',
        extension: 'docx',
        data: bytes
      });

      if (!result) return;                        // abgebrochen
      if (result.error) throw new Error(result.error);

      toast(t('docxSaved').replace('{path}', result));
    } catch (err) {
      console.error('[Export] Word-Export fehlgeschlagen:', err);
      toast(t('docxFailed').replace('{msg}', err.message || err), true);
      throw err;
    }
  }

  // Aus dem geöffneten Heft heraus exportieren
  E('btn-doc-export')?.addEventListener('click', () => open(getNb()));

  window.openExportDialog = open;
})();
