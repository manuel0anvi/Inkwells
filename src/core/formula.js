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

/* ══════════════════════════════════════════════════════════════════════
   EINE FORMEL IST EIN OBJEKT, KEIN TEXT

   Eine eingesetzte Formel liegt in page.objects[] – wie ein Bild und wie
   eine Form. Damit gilt für sie alles, was es dort schon gibt:
   auswählen, verschieben, größer und kleiner ziehen, verdoppeln,
   löschen, vor oder hinter den Text legen, rückgängig machen.

   >>> Warum nicht mehr im Text <<<
   Als Text war sie ein Zeichen unter vielen: man konnte sie weder fassen
   noch bewegen noch in der Größe ändern, und zum Ändern musste man sie
   genau treffen. Genau so wurde es gemeldet.

   Ältere Hefte tragen ihre Formeln weiterhin im Text (<span class=
   "j-formula">). Die werden unverändert angezeigt und lassen sich per
   Doppelklick bearbeiten – bestehende Hefte sollen nicht anders aussehen
   als vorher.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Wie groß ist diese Formel in ihrer natürlichen Größe?
 *
 * Der Mess-Div wird in eine Textzelle der Seite gehängt, nicht in den Body,
 * damit er dieselbe Schriftgröße und -art vorfindet wie die spätere Formel.
 * KaTeX richtet seine Matheschrift nach der Umgebung – misst man im Body,
 * kann die Größe abweichen und der Auswahlrahmen sitzt daneben.
 */
function measureFormula(latex, displayMode) {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;'
    + 'visibility:hidden;white-space:nowrap';
  probe.innerHTML = renderFormula(latex, displayMode).html || '';

  // In den Seitenkontext hängen, damit KaTeX die richtige Schriftumgebung hat
  let eltern = null;
  if (typeof S !== 'undefined' && S.activePgId) {
    eltern = document.querySelector('[data-pgid="' + CSS.escape(S.activePgId) + '"] .j-text');
  }
  if (!eltern) {
    eltern = document.querySelector('.j-text');
  }
  (eltern || document.body).appendChild(probe);

  const r = probe.getBoundingClientRect();
  const zoom = typeof getZoom === 'function' ? getZoom() : 1;
  probe.remove();
  // Auf Seiten-Koordinaten zurückrechnen; ein Mindestmaß, damit eine
  // leere oder fehlerhafte Formel noch zu fassen ist
  return {
    w: Math.max(24, Math.round(r.width / zoom)) || 60,
    h: Math.max(18, Math.round(r.height / zoom)) || 24
  };
}

/**
 * Das Innere eines Formel-Objekts.
 *
 * KaTeX rendert in seiner natürlichen Größe. Größer und kleiner wird die
 * Formel über transform: scale – so bleibt sie in jeder Größe gestochen,
 * während eine gestreckte Schrift ausgefranst wäre.
 */
function renderFormulaBody(obj) {
  const { html, fehler } = renderFormula(obj.latex || '', !!obj.display);
  const natW = obj.natW || obj.w || 60;
  const k = natW ? (obj.w || natW) / natW : 1;

  if (!html && fehler) {
    return '<div class="j-formula-obj fehler" style="transform:scale(' + k + ')">'
      + escapeHtml(obj.latex || '') + '</div>';
  }
  return '<div class="j-formula-obj" style="transform:scale(' + k + ')">' + html + '</div>';
}

/**
 * Setzt eine Formel als Objekt auf die Seite.
 *
 * @param {string} latex
 * @param {boolean} displayMode
 * @returns {boolean} ob es geklappt hat
 */
function insertFormula(latex, displayMode) {
  if (typeof S !== 'undefined' && S.readOnly) {
    if (typeof toast === 'function') toast(
      (typeof t === 'function' && t('sharedNoRight')) || 'Kein Schreibrecht.', true);
    return false;
  }

  /* Auf welche Seite? Die, in der die Schreibmarke steht – sonst die
     gerade aktive. Anders als früher braucht es die Marke nicht mehr
     zwingend: ein Objekt kann überall liegen. */
  const textDiv = document.activeElement;
  let pgEl = (textDiv && textDiv.closest) ? textDiv.closest('[data-pgid]') : null;
  if (!pgEl && S.activePgId) {
    pgEl = document.querySelector('[data-pgid="' + CSS.escape(S.activePgId) + '"]');
  }
  if (!pgEl) {
    if (typeof toast === 'function') toast(
      (typeof t === 'function' && t('formulaNeedsCaret')) || 'Erst eine Seite öffnen.', true);
    return false;
  }

  const info = typeof getPage === 'function' ? getPage(pgEl.dataset.pgid) : null;
  if (!info) return false;
  if (typeof pushPageHistory === 'function') pushPageHistory(info.page);

  const mass = measureFormula(latex, displayMode);

  /* Wohin? Wenn die Schreibmarke im Text steht, direkt darunter – dort
     hat der Nutzer hingesehen. Sonst in die Mitte des sichtbaren Teils. */
  let x = 72, y = 120;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && textDiv && textDiv.classList
      && textDiv.classList.contains('j-text')) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const pr = pgEl.getBoundingClientRect();
    if (r.width || r.height) {
      const zoom = typeof getZoom === 'function' ? getZoom() : 1;
      x = Math.max(8, (r.left - pr.left) / zoom);
      y = Math.max(8, (r.bottom - pr.top) / zoom + 4);
    }
  }
  // Nicht über den Blattrand hinaus
  const pw = info.page.w || CFG.PAGE_W;
  const ph = info.page.h || CFG.PAGE_H;
  x = Math.min(x, Math.max(8, pw - mass.w - 8));
  y = Math.min(y, Math.max(8, ph - mass.h - 8));

  const obj = {
    id: uid(),
    kind: 'formula',
    latex: String(latex || ''),
    display: !!displayMode,
    x, y,
    w: mass.w, h: mass.h,
    natW: mass.w, natH: mass.h,
    rot: 0,
    layer: 'front'
  };

  const liste = info.page.objects || (info.page.objects = []);
  liste.push(obj);

  const objLayer = pgEl.querySelector('.j-objects');
  if (objLayer && typeof placeObject === 'function') placeObject(objLayer, obj, info.page);

  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  return true;
}

/**
 * Eine Formel neu setzen, nachdem ihr Quelltext geändert wurde.
 *
 * Die natürliche Größe wird neu gemessen und die gezogene Größe im
 * gleichen Verhältnis mitgeführt: wer eine Formel doppelt so groß gezogen
 * hat, will sie nach dem Ändern auch doppelt so groß.
 */
function updateFormulaObject(obj, latex, displayMode) {
  if (!obj) return;
  const alterFaktor = obj.natW ? (obj.w || obj.natW) / obj.natW : 1;

  obj.latex = String(latex || '');
  obj.display = !!displayMode;

  const mass = measureFormula(obj.latex, obj.display);
  obj.natW = mass.w;
  obj.natH = mass.h;
  obj.w = Math.round(mass.w * alterFaktor);
  obj.h = Math.round(mass.h * alterFaktor);
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

/* ══════════════════════════════════════════════════════════════════════
   NORMALE SCHREIBWEISE → LaTeX

   „Man muss in dieser speziellen Schreibweise schreiben, das kann nicht
   jeder" – stimmt. Deshalb versteht der Editor jetzt auch das, was man
   in einen Taschenrechner tippen würde:

     1/2        →  \frac{1}{2}
     sqrt(x+1)  →  \sqrt{x+1}
     x^10       →  x^{10}
     pi r^2     →  \pi r^{2}
     a <= b     →  a \leq b

   >>> Warum vorhandenes LaTeX unangetastet bleibt <<<
   Wer LaTeX kann, soll weiter LaTeX schreiben dürfen. Deshalb werden im
   ersten Schritt alle \befehle aus dem Text genommen und durch
   Platzhalter ersetzt; sie kommen am Ende unverändert zurück. Ein
   \frac{1}{2} wird also nicht noch einmal angefasst, und ein 1/2 INNEN
   in einem \sqrt{} wird trotzdem übersetzt.
   ══════════════════════════════════════════════════════════════════════ */

/* Wörter, die für sich stehen. Nur ganze Wörter – ein „pi" in „pilz"
   bleibt, was es ist. */
const FORMEL_WOERTER = {
  pi: '\\pi', tau: '\\tau', phi: '\\phi', theta: '\\theta', lambda: '\\lambda',
  alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta',
  epsilon: '\\epsilon', mu: '\\mu', nu: '\\nu', rho: '\\rho', sigma: '\\sigma',
  omega: '\\omega', Delta: '\\Delta', Sigma: '\\Sigma', Omega: '\\Omega',
  Phi: '\\Phi', Lambda: '\\Lambda', Gamma: '\\Gamma',
  inf: '\\infty', infinity: '\\infty', infty: '\\infty',
  int: '\\int', sum: '\\sum', prod: '\\prod', lim: '\\lim',
  sin: '\\sin', cos: '\\cos', tan: '\\tan', log: '\\log', ln: '\\ln',
  exp: '\\exp', min: '\\min', max: '\\max',
  deg: '^\\circ', grad: '^\\circ'
};

/**
 * Übersetzt normale Schreibweise nach LaTeX.
 *
 * @param {string} quelle  was der Nutzer getippt hat
 * @returns {string}       gültiges LaTeX
 */
function normalToLatex(quelle) {
  let s = String(quelle == null ? '' : quelle);
  if (!s) return '';

  /* 1. Vorhandenes LaTeX aus dem Weg räumen. \x01 kommt in keinem
        vernünftigen Formeltext vor und übersteht die Schritte darunter,
        weil keine der Regeln Steuerzeichen anfasst. */
  const bewahrt = [];
  s = s.replace(/\\[a-zA-Z]+|\\./g, treffer => {
    bewahrt.push(treffer);
    return '\x01' + (bewahrt.length - 1) + '\x01';
  });

  // 2. Zeichenpaare, die eindeutig sind
  s = s.replace(/<=/g, ' \\leq ')
       .replace(/>=/g, ' \\geq ')
       .replace(/!=/g, ' \\neq ')
       .replace(/\+-/g, ' \\pm ')
       .replace(/->/g, ' \\to ')
       .replace(/\*/g, ' \\cdot ');

  /* 3. Funktionen mit Klammern. Von innen nach außen, damit auch
        sqrt(sqrt(x)) durchkommt – deshalb die Schleife. */
  for (let runde = 0; runde < 4; runde++) {
    const vorher = s;
    s = s.replace(/\bsqrt\s*\(([^()]*)\)/g, '\\sqrt{$1}');
    s = s.replace(/\babs\s*\(([^()]*)\)/g, '\\left|$1\\right|');
    if (s === vorher) break;
  }

  /* 4. Ganze Wörter. NICHT über \b abgegrenzt: für einen regulären
        Ausdruck ist der Unterstrich ein Wortzeichen, „int_0" hätte damit
        keine Grenze nach „int" und wäre nie erkannt worden – gerade die
        Integrale mit Grenzen also nicht. */
  s = s.replace(/(?<![A-Za-z])[a-zA-Z]{2,}(?![A-Za-z])/g, wort =>
    Object.prototype.hasOwnProperty.call(FORMEL_WOERTER, wort)
      ? FORMEL_WOERTER[wort] + ' '
      : wort);

  /* 5. Brüche. Ein Operand ist entweder eine Klammer oder eine Folge aus
        Buchstaben, Ziffern und Punkten – auch ein bereits übersetzter
        Platzhalter zählt dazu, damit \pi/2 funktioniert.
        Mehrfach, damit a/b/c von links nach rechts zusammenfällt. */
  const OPERAND = '(?:\\([^()]*\\)|\\{[^{}]*\\}|[A-Za-z0-9.\\x01]+)';
  const bruch = new RegExp('(' + OPERAND + ')\\s*/\\s*(' + OPERAND + ')');
  for (let runde = 0; runde < 8 && bruch.test(s); runde++) {
    s = s.replace(bruch, (m, a, b) => {
      const schale = w => w.replace(/^\((.*)\)$/s, '$1');
      return '\\frac{' + schale(a) + '}{' + schale(b) + '}';
    });
  }

  /* 6. Hoch- und Tiefstellung. Erst die Klammerform e^(-x^2), dann alles
        mit mehr als einem Zeichen: x^2 kann LaTeX selbst, x^10 wäre ohne
        Klammern „x hoch 1, dann 0". */
  s = s.replace(/\^\s*\(([^()]*)\)/g, '^{$1}');
  s = s.replace(/_\s*\(([^()]*)\)/g, '_{$1}');
  s = s.replace(/\^\s*([A-Za-z0-9.]{2,})/g, '^{$1}');
  s = s.replace(/_\s*([A-Za-z0-9.]{2,})/g, '_{$1}');

  // 7. Platzhalter zurück
  s = s.replace(/\x01(\d+)\x01/g, (m, i) => bewahrt[+i] || '');

  return s.replace(/\s{2,}/g, ' ').trim();
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
