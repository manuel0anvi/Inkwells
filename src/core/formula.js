'use strict';

/* ══════════════════════════════════════════════════════════════════════
   MATHEMATISCHE FORMELN

   Eine Formel ist ein <span class="j-formula" data-latex="…"> mit dem
   von KaTeX gerenderten HTML darin. Als Block steht sie in einem
   <p class="j-formula-block"> – dann ist sie zentriert und hat mehr
   Abstand, wie $$…$$ in LaTeX.

   >>> Warum KaTeX und nicht MathJax <<<
   KaTeX ist kleiner (280 KB), schneller und läuft ohne Server. MathJax
   wäre für ein Desktop-Heft zu schwer.

   >>> Warum der LaTeX-Quelltext im data-Attribut <<<
   Ohne ihn wäre die Formel nach dem ersten Abgleich nicht mehr
   editierbar – beim nächsten Öffnen käme nur noch das gerenderte HTML
   an, und der Editor müsste raten, welches LaTeX dazu gehört.

   >>> Sync <<<
   Formeln sind Teil des HTML-Texts – Yjs überträgt sie automatisch mit.
   Kein zusätzlicher Sync nötig.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Rendert einen LaTeX-Ausdruck zu HTML.
 *
 * @param {string} latex  der Quelltext, z. B. "\\frac{1}{2}"
 * @param {boolean} displayMode  true = Block (zentriert), false = inline
 * @returns {{ html: string, fehler: string|null }}
 *   html ist der gerenderte KaTeX-Teil (nur innen), fehler die Nachricht
 */
function renderFormula(latex, displayMode) {
  if (!latex || typeof latex !== 'string') return { html: '', fehler: 'Leer' };
  try {
    const html = katex.renderToString(latex.trim(), {
      displayMode: !!displayMode,
      throwOnError: false,
      strict: false
    });
    return { html, fehler: null };
  } catch (e) {
    return { html: '', fehler: e.message || 'Unbekannter Fehler' };
  }
}

/**
 * Baut das fertige HTML-Element für eine Formel.
 *
 * @returns {string}  z. B. '<span class="j-formula" data-latex="x^2">…</span>'
 */
function buildFormulaHtml(latex, displayMode) {
  const { html, fehler } = renderFormula(latex, displayMode);
  const quelle = escapeHtmlAttr(latex);

  if (!html && fehler) {
    // Zeige den Quelltext mit roter Umrandung, damit der Fehler sichtbar ist
    return '<span class="j-formula" data-latex="' + quelle + '"'
      + ' style="border:2px dashed #c04040;padding:2px 4px;border-radius:3px">'
      + escapeHtml(latex) + '</span>';
  }

  if (displayMode) {
    return '<p class="j-formula-block"><span class="j-formula" data-latex="'
      + quelle + '">' + html + '</span></p>';
  }
  return '<span class="j-formula" data-latex="' + quelle + '">' + html + '</span>';
}

/**
 * Setzt eine Formel an der Schreibmarke ein.
 *
 * Wird vom Formel-Editor (ui/formula.js) aufgerufen, nachdem der Nutzer
 * den LaTeX-Quelltext bestätigt hat.
 *
 * @param {string} latex
 * @param {boolean} displayMode
 * @returns {boolean} ob es geklappt hat
 */
function insertFormula(latex, displayMode) {
  const textDiv = document.activeElement;
  if (!textDiv || !textDiv.classList || !textDiv.classList.contains('j-text')) {
    if (typeof toast === 'function') toast(
      (typeof t === 'function' && t('formulaNeedsCaret')) || 'Erst in den Text klicken.',
      true);
    return false;
  }
  if (typeof S !== 'undefined' && S.readOnly) {
    if (typeof toast === 'function') toast(
      (typeof t === 'function' && t('sharedNoRight')) || 'Kein Schreibrecht.', true);
    return false;
  }

  const pgEl = textDiv.closest('[data-pgid]');
  const info = pgEl && typeof getPage === 'function' ? getPage(pgEl.dataset.pgid) : null;
  if (info && typeof pushPageHistory === 'function') pushPageHistory(info.page);

  const html = buildFormulaHtml(latex, displayMode);

  if (displayMode) {
    // Block-Formel: setze einen Absatz mit der Formel ein. Nach der Formel
    // ein leerer Absatz, sonst kommt man nicht mehr dahinter.
    document.execCommand('insertHTML', false, html + '<p><br></p>');
  } else {
    document.execCommand('insertHTML', false, html);
  }

  if (info) {
    info.page.textContent = textDiv.innerHTML;
    if (window.Collab && typeof Collab.noteTextChange === 'function') {
      Collab.noteTextChange(info.page.id, info.page.textContent);
    }
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  }
  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  return true;
}

/**
 * Öffnet den Formel-Editor für eine bestehende Formel.
 *
 * @param {HTMLSpanElement} span  das .j-formula-Element
 */
function editFormula(span) {
  if (!span || !span.classList.contains('j-formula')) return;
  const latex = span.getAttribute('data-latex') || span.textContent || '';
  const displayMode = !!(span.closest('.j-formula-block'));
  if (typeof openFormulaEditor === 'function') openFormulaEditor(latex, displayMode, span);
}

/* ── Hilfen ─────────────────────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Formeln im Text finden und durch Doppelklick editierbar machen ── */

/**
 * Macht alle Formel-Elemente im Text durch Doppelklick editierbar.
 *
 * Wird nach jedem Neuaufbau des Seitentexts aufgerufen (appendPageDOM).
 */
function bindFormulaClicks(textDiv) {
  if (!textDiv) return;
  textDiv.querySelectorAll('.j-formula').forEach(span => {
    if (span.dataset._formulaBound) return;
    span.dataset._formulaBound = '1';
    span.style.cursor = 'pointer';
    span.title = (typeof t === 'function' && t('formulaEdit')) || 'Formel bearbeiten';
    span.addEventListener('dblclick', e => {
      e.preventDefault();
      e.stopPropagation();
      editFormula(span);
    });
  });
}

/* Doppelklick auf eine Formel öffnet den Editor. Der Handler hängt am
   Seitentext, damit er auch für Formeln gilt, die später dazukommen. */
document.addEventListener('dblclick', e => {
  const span = e.target.closest('.j-formula');
  if (span && span.closest('.j-text')) {
    e.preventDefault();
    e.stopPropagation();
    editFormula(span);
  }
});
