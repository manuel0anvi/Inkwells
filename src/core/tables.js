'use strict';

/* ══════════════════════════════════════════════════════════════════════
   TABELLEN IM SEITENTEXT

   Eine Tabelle ist gewöhnliches HTML im contenteditable – ein <table>
   mit <tr> und <td>. Das ist keine Bequemlichkeit, sondern die
   Voraussetzung dafür, dass sie überhaupt mitspielt:

     · Der gemeinsame Text geht als HTML-Zeichenkette durch Yjs
       (ui/collab.js). Was im Text steht, wird damit ohne einen einzigen
       Handgriff mitgeteilt – auch die Tabelle.
     · Gespeichert wird derselbe Text (page.textContent).
     · Die Schreibmarken rechnen über flatTextParts (canvas/text.js).
       Dort ist eine Zeile <tr> ein Block und eine Zelle <td> „inline" –
       eine Tabellenzeile ist also GENAU EINE Zeile im flachen Maß, so
       wie sie auf dem Papier auch aussieht.

   >>> Was dafür an drei anderen Stellen stimmen musste <<<
     1. core/sanitize.js muss die Tabellen-Tags durchlassen. Vorher hat
        es sie ausgepackt („der Text bleibt, das Element geht") – eine
        Tabelle wäre beim ersten Abgleich zu einer Reihe loser Wörter
        zerfallen.
     2. css/pages.css gibt ihnen ihr Aussehen.
     3. Der Word-Export (core/docx.js) muss sie kennen, sonst kommt eine
        Tabelle dort als Wortsalat an.

   ── Was von Word übernommen ist ──────────────────────────────────────
     · Tab geht in die nächste Zelle, Umschalt+Tab in die vorige.
     · Tab in der LETZTEN Zelle hängt eine Zeile an.
     · Enter macht eine neue Zeile INNERHALB der Zelle, nicht darunter.
     · Die Spalten wachsen mit dem Inhalt (table-layout: auto).
     · Steht die Marke in einer Tabelle, erscheint eine kleine Leiste
       zum Einfügen und Löschen von Zeilen und Spalten.
   ══════════════════════════════════════════════════════════════════════ */

const TBL_MAX = 20;          // mehr als das ist auf A4 nicht lesbar
const TBL_GRID_MAX = 6;      // so groß ist das Raster im Menü

/** Baut das HTML einer leeren Tabelle. */
function buildTableHtml(zeilen, spalten, mitKopf = true) {
  const r = Math.max(1, Math.min(TBL_MAX, Math.round(zeilen) || 1));
  const c = Math.max(1, Math.min(TBL_MAX, Math.round(spalten) || 1));

  /* >>> Die Zellen bleiben LEER, ohne <br> <<<
     Naheliegend wäre ein <br> je Zelle – so macht contenteditable das
     mit einem leeren Absatz, und die Zelle bekommt damit Höhe. Für die
     Schreibmarken wäre es aber ein Unglück: canvas/text.js zählt ein
     <br> als Zeilengrenze, und eine leere Tabelle mit zwölf Zellen
     hätte dann zwölf Zeilen im flachen Maß, obwohl auf dem Papier drei
     zu sehen sind. Jede fremde Marke und jedes Sperrband säße daneben.

     Ohne <br> ist eine Zelle „inline" (display: table-cell) und eine
     ZEILE der Tabelle genau eine Zeile – so, wie man es sieht. Die Höhe
     einer leeren Zelle kommt aus css/pages.css. */
  let html = '<table class="j-table"><tbody>';
  for (let i = 0; i < r; i++) {
    html += '<tr>';
    for (let j = 0; j < c; j++) {
      html += (mitKopf && i === 0) ? '<th></th>' : '<td></td>';
    }
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

/** Die Zelle, in der die Schreibmarke steht – oder null. */
function currentCell() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  if (!node || typeof node.closest !== 'function') return null;
  const cell = node.closest('td, th');
  // Nur Tabellen im Seitentext, nicht die der Oberfläche
  return (cell && cell.closest('.j-text')) ? cell : null;
}

/** Alle Zellen einer Tabelle in Lesereihenfolge. */
function cellsOf(table) {
  return [...table.querySelectorAll('tr > td, tr > th')];
}

/** Setzt die Schreibmarke an den Anfang einer Zelle. */
function focusCell(cell) {
  if (!cell) return false;
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

/** Hängt unten eine Zeile an, mit derselben Spaltenzahl. */
function addRow(table, nachZeile) {
  const zeilen = [...table.querySelectorAll('tr')];
  const muster = nachZeile || zeilen[zeilen.length - 1];
  if (!muster) return null;
  if (zeilen.length >= TBL_MAX) return null;

  const neu = document.createElement('tr');
  for (let i = 0; i < muster.children.length; i++) {
    // Leer, ohne <br> – die Begründung steht in buildTableHtml
    neu.appendChild(document.createElement('td'));
  }
  muster.parentNode.insertBefore(neu, muster.nextSibling);
  return neu;
}

/** Eine Spalte rechts neben der angegebenen – oder ganz hinten. */
function addColumn(table, nachIndex) {
  const zeilen = [...table.querySelectorAll('tr')];
  if (!zeilen.length) return;
  if (zeilen[0].children.length >= TBL_MAX) return;

  for (const zeile of zeilen) {
    const kopf = zeile.parentNode && zeile.parentNode.tagName === 'THEAD';
    const alsKopf = kopf || (zeile.children[0] && zeile.children[0].tagName === 'TH');
    const zelle = document.createElement(alsKopf ? 'th' : 'td');

    const bezug = (nachIndex >= 0) ? zeile.children[nachIndex] : null;
    if (bezug) zeile.insertBefore(zelle, bezug.nextSibling);
    else zeile.appendChild(zelle);
  }
}

/** Die Zeile weg – die letzte nicht, sonst bliebe eine leere Tabelle. */
function removeRow(table, zeile) {
  const zeilen = [...table.querySelectorAll('tr')];
  if (zeilen.length <= 1 || !zeile) return false;
  zeile.remove();
  return true;
}

function removeColumn(table, index) {
  const zeilen = [...table.querySelectorAll('tr')];
  if (!zeilen.length || zeilen[0].children.length <= 1) return false;
  for (const zeile of zeilen) {
    const zelle = zeile.children[index];
    if (zelle) zelle.remove();
  }
  return true;
}

/** Die Stelle einer Zelle: in welcher Zeile, in welcher Spalte. */
function cellPos(cell) {
  const zeile = cell.parentNode;
  const table = cell.closest('table');
  return {
    table,
    zeile,
    spalte: [...zeile.children].indexOf(cell),
    zeileNr: [...table.querySelectorAll('tr')].indexOf(zeile)
  };
}

/**
 * Tab, Umschalt+Tab und Enter in einer Tabelle – wie in Word.
 *
 * @returns {boolean} ob der Anschlag hier erledigt wurde
 */
function handleTableKey(e) {
  const cell = currentCell();
  if (!cell) return false;

  const table = cell.closest('table');
  if (!table) return false;

  if (e.key === 'Tab') {
    e.preventDefault();
    const alle = cellsOf(table);
    const i = alle.indexOf(cell);

    if (e.shiftKey) {
      if (i > 0) focusCell(alle[i - 1]);
      return true;
    }

    if (i < alle.length - 1) { focusCell(alle[i + 1]); return true; }

    /* Letzte Zelle: eine Zeile anhängen. Das ist der Handgriff, mit dem
       in Word jede Tabelle wächst – ohne ihn müsste man für jede Zeile
       ins Menü. */
    const neu = addRow(table, null);
    if (neu) focusCell(neu.children[0]);
    return true;
  }

  /* Enter bleibt IN der Zelle. Ohne das setzt contenteditable einen
     Absatz hinter die Tabelle, und die Zeile, die man anfangen wollte,
     steht plötzlich darunter. */
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.execCommand('insertLineBreak');
    return true;
  }

  return false;
}

/* ── Die Leiste an der Tabelle ──────────────────────────────────────
   Sie erscheint, sobald die Marke in einer Tabelle steht, und sitzt über
   deren linker oberer Ecke. Bewusst dieselbe Machart wie die Leiste am
   Bild (canvas/objects.js): ein Element, das mitwandert, keine
   Werkzeugleiste am Fensterrand. */
const TBL_ICONS = {
  zeilePlus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="2" y="3" width="12" height="4" rx="1"/><path d="M8 10v4M6 12h4"/></svg>',
  zeileMinus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="2" y="3" width="12" height="4" rx="1"/><path d="M6 12h4"/></svg>',
  spaltePlus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="3" y="2" width="4" height="12" rx="1"/><path d="M12 6v4M10 8h4"/></svg>',
  spalteMinus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="3" y="2" width="4" height="12" rx="1"/><path d="M10 8h4"/></svg>',
  weg: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2.6 4.2h10.8M6.4 4.2V2.9h3.2v1.3M3.9 4.2 4.5 13a.9.9 0 0 0 .9.8h5.2a.9.9 0 0 0 .9-.8l.6-8.8"/></svg>'
};

let tblBar = null;

function tableBar() {
  if (tblBar) return tblBar;

  tblBar = document.createElement('div');
  tblBar.className = 'j-table-bar';
  tblBar.style.display = 'none';

  const knopf = (icon, titel, tun) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'j-table-btn';
    b.innerHTML = icon;
    b.title = titel;
    b.setAttribute('aria-label', titel);
    // Die Marke darf beim Klick nicht aus der Tabelle fallen
    b.addEventListener('mousedown', ev => ev.preventDefault());
    b.addEventListener('click', ev => { ev.stopPropagation(); tun(); });
    tblBar.appendChild(b);
    return b;
  };

  const mitZelle = (fn) => () => {
    const cell = tblBar._zelle;
    if (!cell || !cell.isConnected) return;
    const pos = cellPos(cell);
    fn(pos, cell);
    notiereTabelle(pos.table);
    positionTableBar(cell);
  };

  const txt = (key, ersatz) => (typeof t === 'function' && t(key)) || ersatz;

  knopf(TBL_ICONS.zeilePlus, txt('tableRowAdd', 'Zeile darunter'),
    mitZelle(pos => addRow(pos.table, pos.zeile)));
  knopf(TBL_ICONS.zeileMinus, txt('tableRowDel', 'Zeile löschen'),
    mitZelle((pos, cell) => {
      const nachbar = pos.zeile.nextElementSibling || pos.zeile.previousElementSibling;
      if (removeRow(pos.table, pos.zeile) && nachbar) focusCell(nachbar.children[pos.spalte] || nachbar.children[0]);
    }));
  knopf(TBL_ICONS.spaltePlus, txt('tableColAdd', 'Spalte rechts'),
    mitZelle(pos => addColumn(pos.table, pos.spalte)));
  knopf(TBL_ICONS.spalteMinus, txt('tableColDel', 'Spalte löschen'),
    mitZelle(pos => removeColumn(pos.table, pos.spalte)));
  knopf(TBL_ICONS.weg, txt('tableDelete', 'Tabelle löschen'),
    mitZelle(pos => { pos.table.remove(); versteckeTableBar(); }));

  document.body.appendChild(tblBar);
  return tblBar;
}

function positionTableBar(cell) {
  const bar = tableBar();
  const table = cell && cell.closest('table');
  if (!table) { versteckeTableBar(); return; }

  bar._zelle = cell;
  bar.style.display = 'flex';
  const r = table.getBoundingClientRect();
  const h = bar.offsetHeight || 30;
  /* Über der Tabelle, und wenn dort kein Platz ist, darunter. Gemessen
     wird am Fenster, denn die Leiste hängt am body – sie soll nicht mit
     der Seite skalieren, sonst wäre sie im Hochformat winzig. */
  const oben = r.top - h - 6;
  bar.style.left = Math.round(Math.max(8, r.left)) + 'px';
  bar.style.top = Math.round(oben > 60 ? oben : r.bottom + 6) + 'px';
}

function versteckeTableBar() {
  if (!tblBar) return;
  tblBar.style.display = 'none';
  tblBar._zelle = null;
}

/** Eine Änderung an der Tabelle ist eine Änderung der Seite. */
function notiereTabelle(table) {
  const textDiv = table && table.closest ? table.closest('.j-text') : null;
  if (!textDiv) return;
  const pgEl = textDiv.closest('[data-pgid]');
  const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
  if (!info) return;

  info.page.textContent = textDiv.innerHTML;
  if (window.Collab) Collab.noteTextChange(info.page.id, info.page.textContent);
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/**
 * Setzt eine Tabelle an der Schreibmarke ein.
 *
 * @returns {boolean} ob es geklappt hat
 */
function insertTable(zeilen, spalten) {
  const textDiv = document.activeElement;
  if (!textDiv || !textDiv.classList || !textDiv.classList.contains('j-text')) {
    if (typeof toast === 'function') toast(t('tableNeedsCaret') || 'Erst in den Text klicken.', true);
    return false;
  }
  if (S.readOnly) { if (typeof toast === 'function') toast(t('sharedNoRight'), true); return false; }

  const pgEl = textDiv.closest('[data-pgid]');
  const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
  if (!info) return false;

  if (typeof pushPageHistory === 'function') pushPageHistory(info.page);

  /* Nach der Tabelle ein leerer Absatz, sonst käme man hinter ihr nicht
     mehr in den Text – eine Tabelle am Ende der Seite wäre eine Sackgasse. */
  document.execCommand('insertHTML', false,
    buildTableHtml(zeilen, spalten) + '<p><br></p>');

  const table = textDiv.querySelector('table.j-table:not([data-ready])');
  if (table) {
    table.dataset.ready = '1';
    focusCell(table.querySelector('th, td'));
  }
  // dataset landet als Attribut im Text – wieder weg damit
  textDiv.querySelectorAll('table[data-ready]').forEach(el => el.removeAttribute('data-ready'));

  notiereTabelle(table || textDiv.querySelector('table'));
  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  return true;
}

/* Die Leiste folgt der Schreibmarke. Über selectionchange und nicht über
   einen Klick: die Marke wandert auch mit den Pfeiltasten und mit Tab. */
document.addEventListener('selectionchange', () => {
  const cell = currentCell();
  if (cell) positionTableBar(cell);
  else versteckeTableBar();
});

// Beim Rollen und Zoomen zieht sie mit
document.addEventListener('scroll', () => {
  if (tblBar && tblBar._zelle && tblBar.style.display !== 'none') {
    positionTableBar(tblBar._zelle);
  }
}, true);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTableHtml, TBL_MAX, TBL_GRID_MAX };
}
