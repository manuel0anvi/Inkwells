/* ══════════════════════════════════════════════════════════════════════
   EXPORT-DIALOG DER WEBSITE

   Wird von zwei Seiten benutzt, die dieselbe Darstellung verwenden
   (js/viewer.js):

     dashboard/  – die eigenen Hefte
     s/          – ein freigegebenes Heft

   Auswählbar sind Format (PDF oder Word) und Umfang (alles, nur die
   erste Seite, oder ein Bereich wie „1-3, 5"). Vorher gab es nur einen
   Knopf „Als PDF", der immer das ganze Heft in den Druckdialog schob.

   PDF entsteht weiterhin über den Druckdialog des Browsers – die Seiten
   liegen bereits im A4-Verhältnis im Dokument. Für eine Auswahl werden
   die übrigen Seiten nur fürs Drucken ausgeblendet.

   Word entsteht über js/docx.js, dieselbe Datei wie in der App.
   ══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  let overlay = null;
  let current = null;   // { notebook, pages }

  /* ── Dialog aufbauen (einmalig) ───────────────────────────────────── */

  // Aufbau und Aussehen wie der Freigabe-Dialog; die Klassen stehen in
  // css/style.css (.opt-radio*) und css/notebook.css (.web-dialog*),
  // damit auf schmalen Bildschirmen dieselben Regeln greifen.
  function radioRow(name, value, labelKey, hintKey, checked) {
    return `
      <label class="opt-radio">
        <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}>
        <span class="opt-radio-body">
          <span class="opt-radio-title" data-i18n="${labelKey}"></span>
          ${hintKey ? `<span class="opt-radio-hint" data-i18n="${hintKey}"></span>` : ''}
        </span>
      </label>`;
  }

  function build() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'export-overlay';
    overlay.className = 'web-dialog-backdrop';
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="web-dialog">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="font-family:'Cormorant Garamond',serif; font-size:26px; font-style:italic;
                     color:var(--gold-light); margin:0;" data-i18n="export_title"></h3>
          <button id="export-dlg-close" style="background:none; border:0; color:var(--text-muted);
                  font-size:18px; cursor:pointer; line-height:1;">✕</button>
        </div>

        <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase;
                    color:var(--gold-light); margin-bottom:10px;" data-i18n="export_format_label"></div>
        <div class="opt-radio-list" style="margin-bottom:20px;">
          ${radioRow('export-format', 'pdf', 'export_format_pdf', 'export_format_pdf_hint', true)}
          ${radioRow('export-format', 'docx', 'export_format_docx', 'export_format_docx_hint', false)}
        </div>

        <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase;
                    color:var(--gold-light); margin-bottom:10px;">
          <span data-i18n="export_scope_label"></span>
          <span id="export-dlg-total" style="text-transform:none; letter-spacing:0; color:var(--text-muted);"></span>
        </div>
        <div class="opt-radio-list">
          ${radioRow('export-scope', 'all', 'export_scope_all', null, true)}
          ${radioRow('export-scope', 'current', 'export_scope_current', null, false)}
          <label class="opt-radio">
            <input type="radio" name="export-scope" value="range">
            <span class="opt-radio-body">
              <span class="opt-radio-title" data-i18n="export_scope_range"></span>
              <span class="opt-radio-hint" data-i18n="export_range_hint"></span>
            </span>
            <input class="opt-radio-input" id="export-dlg-range" type="text" disabled
                   autocomplete="off" spellcheck="false" data-i18n-ph="export_range_ph">
          </label>
        </div>

        <div id="export-dlg-status" style="font-size:12px; color:var(--gold-light);
             min-height:18px; margin:16px 0 14px;"></div>

        <div class="web-dialog-actions">
          <button id="export-dlg-cancel" class="btn-m" style="padding:8px 16px; font-size:12px;"
                  data-i18n="downgrade_cancel"></button>
          <button id="export-dlg-start" class="btn-m" style="padding:8px 18px; font-size:12px;
                  background:var(--gold-dim); border-color:var(--gold-light); color:var(--gold-light);"
                  data-i18n="export_start"></button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#export-dlg-close').addEventListener('click', close);
    overlay.querySelector('#export-dlg-cancel').addEventListener('click', close);
    overlay.querySelector('#export-dlg-start').addEventListener('click', run);

    const rangeInput = overlay.querySelector('#export-dlg-range');
    overlay.querySelectorAll('input[name="export-scope"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isRange = scopeValue() === 'range';
        rangeInput.disabled = !isRange;   // .opt-radio-input:disabled blendet es ab
        if (isRange) rangeInput.focus();
        setStatus('');
      });
    });
    rangeInput.addEventListener('focus', () => {
      const radio = overlay.querySelector('input[name="export-scope"][value="range"]');
      if (radio && !radio.checked) { radio.checked = true; rangeInput.disabled = false; }
    });

    return overlay;
  }

  const scopeValue = () => overlay.querySelector('input[name="export-scope"]:checked')?.value || 'all';
  const formatValue = () => overlay.querySelector('input[name="export-format"]:checked')?.value || 'pdf';
  const setStatus = (text) => { overlay.querySelector('#export-dlg-status').textContent = text || ''; };

  /** Setzt die Beschriftungen – auch nach einem Sprachwechsel. */
  function translate() {
    if (!overlay) return;
    overlay.querySelectorAll('[data-i18n]').forEach(el => {
      const value = t(el.getAttribute('data-i18n'));
      if (value) el.textContent = value;
    });
    overlay.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const value = t(el.getAttribute('data-i18n-ph'));
      if (value) el.placeholder = value;
    });
  }

  /* ── Seitenauswahl ────────────────────────────────────────────────── */

  /** „1-3, 5, 8-10" -> Menge von Seitenzahlen. null bei Unsinn. */
  function parseRange(text, total) {
    if (typeof text !== 'string') return null;
    const cleaned = text.replace(/[–—]/g, '-').replace(/;/g, ',').trim();
    if (!cleaned) return null;

    const numbers = new Set();
    for (const rawPart of cleaned.split(',')) {
      const part = rawPart.trim();
      if (!part) continue;

      const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        let from = parseInt(range[1], 10);
        let to = parseInt(range[2], 10);
        if (from > to) [from, to] = [to, from];
        for (let n = from; n <= to; n++) if (n >= 1 && n <= total) numbers.add(n);
        continue;
      }
      if (/^\d+$/.test(part)) {
        const n = parseInt(part, 10);
        if (n >= 1 && n <= total) numbers.add(n);
        continue;
      }
      return null;
    }
    return numbers.size ? numbers : null;
  }

  /** @returns {Set<number>|null} 1-basierte Seitenzahlen */
  function selectedNumbers() {
    const total = current.pages.length;
    const scope = scopeValue();

    if (scope === 'all') return new Set(Array.from({ length: total }, (_, i) => i + 1));
    if (scope === 'current') return new Set([1]);

    const numbers = parseRange(overlay.querySelector('#export-dlg-range').value, total);
    if (!numbers) { setStatus(t('export_range_invalid')); return null; }
    return numbers;
  }

  /* ── PDF über den Druckdialog ─────────────────────────────────────── */

  function printSelection(numbers) {
    const previousTitle = document.title;
    document.title = (current.notebook.name || 'Inkwells').replace(/[\\/:*?"<>|]/g, '_');

    // Für den Druck in Originalgröße darstellen und alles ausblenden,
    // was nicht zur Auswahl gehört.
    let lastVisible = null;
    pageScalers.forEach(({ scaler, pageEl, width, height }, index) => {
      const wanted = numbers.has(index + 1);
      scaler.classList.toggle('print-skip', !wanted);
      scaler.classList.remove('print-last');
      if (!wanted) return;

      lastVisible = scaler;
      pageEl.style.transform = 'none';
      scaler.style.width = width + 'px';
      scaler.style.height = height + 'px';
    });
    // Ohne das bekäme die letzte gedruckte Seite einen Umbruch und damit
    // eine leere Seite hinterher.
    if (lastVisible) lastVisible.classList.add('print-last');

    document.body.classList.add('printing');

    const cleanup = () => {
      document.body.classList.remove('printing');
      document.title = previousTitle;
      pageScalers.forEach(({ scaler }) => {
        scaler.classList.remove('print-skip', 'print-last');
      });
      rescaleAllPages();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    // Kurz warten, damit das Layout vor dem Druckdialog steht
    setTimeout(() => {
      window.print();
      // Sicherheitsnetz, falls afterprint ausbleibt (manche Browser)
      setTimeout(() => { if (document.body.classList.contains('printing')) cleanup(); }, 1000);
    }, 60);
  }

  /* ── Word ─────────────────────────────────────────────────────────── */

  async function downloadDocx(numbers) {
    if (!global.InkwellsDocx) { setStatus(t('export_docx_unavailable')); return; }

    setStatus(t('export_working'));

    const notebook = current.notebook;
    const entries = current.pages
      .map((page, index) => ({ page, number: index + 1 }))
      .filter(item => numbers.has(item.number))
      .map(item => ({
        page: item.page,
        bg: resolvePageBg(notebook, item.page),
        headerLeft: `${t('page')} ${item.number}`,
        headerRight: fmtPageDate(item.page.date)
      }));

    const bytes = await InkwellsDocx.build(entries, {
      title: notebook.name,
      onProgress: (done, total) => setStatus(`${t('export_working')} ${done}/${total}`)
    });

    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = InkwellsDocx.safeFileName(notebook.name) + '.docx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    setStatus(t('export_docx_done'));
  }

  /* ── Ablauf ───────────────────────────────────────────────────────── */

  async function run() {
    if (!current) return;

    const numbers = selectedNumbers();
    if (!numbers) return;
    if (!numbers.size) { setStatus(t('export_none')); return; }

    const startBtn = overlay.querySelector('#export-dlg-start');
    startBtn.disabled = true;

    try {
      if (formatValue() === 'docx') {
        await downloadDocx(numbers);
        setTimeout(close, 900);
      } else {
        close();
        printSelection(numbers);
      }
    } catch (err) {
      console.error('[Export]', err);
      setStatus(tf('export_docx_failed', { msg: err.message || 'unbekannt' }));
    } finally {
      startBtn.disabled = false;
    }
  }

  function close() {
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * @param {object} notebook  normalisiertes Heft (js/viewer.js)
   */
  function open(notebook) {
    if (!notebook) return;

    build();
    translate();

    const pages = getNotebookPages(notebook);
    current = { notebook, pages };

    overlay.querySelector('#export-dlg-total').textContent =
      ` · ${pages.length} ${pages.length === 1 ? t('page') : t('pages')}`;

    overlay.querySelector('input[name="export-format"][value="pdf"]').checked = true;
    overlay.querySelector('input[name="export-scope"][value="all"]').checked = true;

    const rangeInput = overlay.querySelector('#export-dlg-range');
    rangeInput.value = '';
    rangeInput.disabled = true;

    setStatus('');
    overlay.style.display = 'flex';
  }

  if (typeof addLangChangeListener === 'function') addLangChangeListener(translate);

  global.InkwellsExport = { open, close };
})(window);
