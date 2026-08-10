'use strict';

/* ══════════════════════════════════════════════════════════════════════
   FORMEL-EDITOR

   Ein Modal mit LaTeX-Eingabe und Live-Vorschau – ähnlich dem
   Word-Formel-Editor, nur dass man hier LaTeX schreibt statt Knöpfe zu
   drücken.

   Aufgerufen wird er:
     · aus dem Einfügen-Menü (neue Formel)
     · per Doppelklick auf eine bestehende Formel (core/formula.js)

   >>> Warum ein Textfeld und kein grafischer Editor <<<
   Ein grafischer Formel-Editor (wie in Word) ist ein eigenes Programm.
   Die Tastatur ist für LaTeX schneller, und wer kein LaTeX kann, findet
   im Netz für jede Formel die passende Zeichenkette.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  /* ── Das Modal im HTML aufbauen ──────────────────────────────────── */
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'ov-formula';
  overlay.style.display = 'none';

  const label = (text) => {
    const l = document.createElement('label');
    l.className = 'modal-label';
    l.textContent = text;
    return l;
  };

  const titel = document.createElement('h3');
  titel.id = 'formula-title';
  titel.textContent = (typeof t === 'function' && t('formulaEditor')) || 'Formel';

  const schliessenBtn = document.createElement('button');
  schliessenBtn.className = 'modal-close-x';
  schliessenBtn.id = 'formula-close';
  schliessenBtn.textContent = '✕';

  const latexFeld = document.createElement('textarea');
  latexFeld.id = 'formula-latex';
  latexFeld.rows = 3;
  latexFeld.spellcheck = false;
  latexFeld.autocomplete = 'off';
  latexFeld.placeholder = 'z. B. \\frac{1}{\\sqrt{2\\pi}} e^{-\\frac{x^2}{2}}';

  const vorschau = document.createElement('div');
  vorschau.id = 'formula-preview';
  vorschau.className = 'formula-preview';

  const vorschauLabel = document.createElement('label');
  vorschauLabel.className = 'modal-label';
  vorschauLabel.style.marginTop = '12px';
  vorschauLabel.textContent = (typeof t === 'function' && t('formulaPreview')) || 'Vorschau';

  const displayRow = document.createElement('div');
  displayRow.className = 'formula-display-row';

  const displayInline = document.createElement('label');
  displayInline.className = 'formula-display-label';
  const radioInline = document.createElement('input');
  radioInline.type = 'radio';
  radioInline.name = 'formula-display';
  radioInline.value = 'inline';
  radioInline.checked = true;
  displayInline.appendChild(radioInline);
  displayInline.appendChild(document.createTextNode(' ' + ((typeof t === 'function' && t('formulaInline')) || 'Inline')));

  const displayBlock = document.createElement('label');
  displayBlock.className = 'formula-display-label';
  const radioBlock = document.createElement('input');
  radioBlock.type = 'radio';
  radioBlock.name = 'formula-display';
  radioBlock.value = 'block';
  displayBlock.appendChild(radioBlock);
  displayBlock.appendChild(document.createTextNode(' ' + ((typeof t === 'function' && t('formulaBlock')) || 'Block')));

  displayRow.appendChild(displayInline);
  displayRow.appendChild(displayBlock);

  const btnReihe = document.createElement('div');
  btnReihe.className = 'modal-btns';

  const abbrechenBtn = document.createElement('button');
  abbrechenBtn.id = 'formula-cancel';
  abbrechenBtn.textContent = (typeof t === 'function' && t('cancel')) || 'Abbrechen';

  const einfuegenBtn = document.createElement('button');
  einfuegenBtn.id = 'formula-ok';
  einfuegenBtn.className = 'ok-btn';
  einfuegenBtn.textContent = (typeof t === 'function' && t('formulaInsert')) || 'Einfügen';

  btnReihe.appendChild(abbrechenBtn);
  btnReihe.appendChild(einfuegenBtn);

  overlay.innerHTML = '';
  const modal = document.createElement('div');
  modal.className = 'modal modal-nb';
  modal.style.maxWidth = '520px';
  modal.appendChild(titel);
  modal.appendChild(schliessenBtn);
  modal.appendChild(label((typeof t === 'function' && t('formulaLatexLabel')) || 'LaTeX'));
  modal.appendChild(latexFeld);
  modal.appendChild(displayRow);
  modal.appendChild(vorschauLabel);
  modal.appendChild(vorschau);
  modal.appendChild(btnReihe);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  /* ── Zustand ────────────────────────────────────────────────────── */
  let _editSpan = null;       // null = neue Formel, sonst die zu bearbeitende
  let _savedRange = null;     // Schreibmarke vor dem Öffnen
  let _vorschauTimer = 0;

  /* ── Vorschau ────────────────────────────────────────────────────── */
  function aktualisiereVorschau() {
    const latex = latexFeld.value;
    const displayMode = radioBlock.checked;
    if (!latex.trim()) { vorschau.innerHTML = ''; return; }

    const { html, fehler } = window.renderFormula(latex, displayMode);
    if (fehler) {
      vorschau.innerHTML = '<span style="color:#c04040;font-size:13px">'
        + (typeof t === 'function' && t('formulaError') || 'Fehler') + ': '
        + fehler.replace(/</g, '&lt;') + '</span>';
    } else {
      vorschau.innerHTML = html;
    }
  }

  latexFeld.addEventListener('input', () => {
    clearTimeout(_vorschauTimer);
    _vorschauTimer = setTimeout(aktualisiereVorschau, 300);
  });

  radioInline.addEventListener('change', aktualisiereVorschau);
  radioBlock.addEventListener('change', aktualisiereVorschau);

  /* ── Tastatur ───────────────────────────────────────────────────── */
  latexFeld.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      einfuegen();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      schliessen();
    }
  });

  /* ── Schreibmarke merken ────────────────────────────────────────────
     Dasselbe Muster wie in ui/insert.js: die Marke muss das Öffnen des
     Modals überleben, sonst weiss niemand mehr, wohin die Formel soll. */
  function merkeStelle() {
    _savedRange = null;
    const el = document.activeElement;
    if (!el || !el.classList || !el.classList.contains('j-text')) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    _savedRange = { feld: el, range: sel.getRangeAt(0).cloneRange() };
  }

  function stelleWiederher() {
    if (!_savedRange || !_savedRange.feld.isConnected) return false;
    _savedRange.feld.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_savedRange.range);
    return true;
  }

  /* ── Öffnen / Schließen ─────────────────────────────────────────── */
  function schliessen() {
    overlay.style.display = 'none';
    _editSpan = null;
    _savedRange = null;
  }

  function einfuegen() {
    const latex = latexFeld.value.trim();
    if (!latex) { schliessen(); return; }
    const displayMode = radioBlock.checked;

    if (_editSpan) {
      // Bestehende Formel ersetzen
      const neu = window.buildFormulaHtml(latex, displayMode);
      // buildFormulaHtml gibt für Block ein <p>…</p> zurück – das
      // ersetzt den ganzen Absatz. Für Inline nur das <span>.
      if (displayMode) {
        const block = _editSpan.closest('.j-formula-block');
        if (block) {
          block.outerHTML = neu;
        } else {
          // Die Formel war inline, soll jetzt Block werden
          const p = _editSpan.closest('p');
          if (p) p.outerHTML = neu;
          else _editSpan.outerHTML = neu;
        }
      } else {
        // Inline – ersetze nur das Span, lasse den umgebenden Absatz
        _editSpan.outerHTML = neu;
      }

      // Text-Inhalt der Seite nachziehen
      const textDiv = _editSpan.closest('.j-text');
      if (textDiv) {
        const pgEl = textDiv.closest('[data-pgid]');
        const info = pgEl && typeof getPage === 'function' ? getPage(pgEl.dataset.pgid) : null;
        if (info) {
          info.page.textContent = textDiv.innerHTML;
          if (window.Collab && typeof Collab.noteTextChange === 'function') {
            Collab.noteTextChange(info.page.id, info.page.textContent);
          }
          if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
        }
      }
      schliessen();
      return;
    }

    // Neue Formel
    stelleWiederher();
    if (typeof window.insertFormula === 'function') window.insertFormula(latex, displayMode);
    schliessen();
  }

  /**
   * Öffnet den Editor – für eine neue Formel oder zum Bearbeiten.
   *
   * @param {string} [latex='']    vorausgefüllter Quelltext
   * @param {boolean} [displayMode=false]
   * @param {HTMLSpanElement} [editSpan=null]  zu bearbeitende Formel
   */
  function openFormulaEditor(latex, displayMode, editSpan) {
    _editSpan = editSpan || null;
    merkeStelle();
    latexFeld.value = latex || '';
    radioInline.checked = !displayMode;
    radioBlock.checked = !!displayMode;
    titel.textContent = _editSpan
      ? ((typeof t === 'function' && t('formulaEdit')) || 'Formel bearbeiten')
      : ((typeof t === 'function' && t('formulaEditor')) || 'Formel');
    overlay.style.display = 'flex';
    latexFeld.focus();
    aktualisiereVorschau();
  }

  /* ── Knöpfe ─────────────────────────────────────────────────────── */
  abbrechenBtn.addEventListener('click', schliessen);
  einfuegenBtn.addEventListener('click', einfuegen);
  schliessenBtn.addEventListener('click', schliessen);

  overlay.addEventListener('mousedown', e => {
    if (e.target === overlay) schliessen();
  });

  /* ── Global erreichbar ──────────────────────────────────────────── */
  window.openFormulaEditor = openFormulaEditor;
})();
