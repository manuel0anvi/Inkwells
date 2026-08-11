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

  /* Eine Datenzeile gehört nicht in den <thead>. Bei einer aus Word
     eingefügten Tabelle steht die Musterzeile dort, und die neue Zeile
     wäre sonst als Kopfzeile erschienen. */
  const eltern = muster.parentNode;
  if (eltern && eltern.tagName === 'THEAD') {
    let koerper = table.querySelector('tbody');
    if (!koerper) {
      koerper = document.createElement('tbody');
      eltern.after(koerper);
    }
    koerper.insertBefore(neu, koerper.firstChild);
  } else {
    eltern.insertBefore(neu, muster.nextSibling);
  }
  return neu;
}

/** Eine Spalte rechts neben der angegebenen – oder ganz hinten. */
function addColumn(table, nachIndex) {
  const zeilen = [...table.querySelectorAll('tr')];
  if (!zeilen.length) return false;
  if (zeilen[0].children.length >= TBL_MAX) return false;

  for (const zeile of zeilen) {
    const kopf = zeile.parentNode && zeile.parentNode.tagName === 'THEAD';
    const alsKopf = kopf || (zeile.children[0] && zeile.children[0].tagName === 'TH');
    const zelle = document.createElement(alsKopf ? 'th' : 'td');

    const bezug = (nachIndex >= 0) ? zeile.children[nachIndex] : null;
    if (bezug) zeile.insertBefore(zelle, bezug.nextSibling);
    else zeile.appendChild(zelle);
  }

  // Feste Breiten mitziehen, sonst rutschen sie um eine Spalte
  const grp = table.querySelector('colgroup');
  if (grp) {
    const col = document.createElement('col');
    const bezug = (nachIndex >= 0) ? grp.children[nachIndex] : null;
    if (bezug) grp.insertBefore(col, bezug.nextSibling);
    else grp.appendChild(col);
  }
  return true;
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

  /**
   * Führt einen Handgriff an der Tabelle aus und räumt danach auf.
   *
   * >>> Warum der Textbereich VORHER gemerkt wird <<<
   * „Tabelle löschen" nahm die Tabelle aus dem Baum und rief danach
   * notiereTabelle(pos.table) – das sucht sich seinen Textbereich über
   * table.closest('.j-text'), und an einer herausgelösten Tabelle ist der
   * null. Die Löschung wurde also NIE gespeichert: nach dem Neuladen war
   * die Tabelle wieder da.
   *
   * >>> Und warum danach auf isConnected geprüft wird <<<
   * Anschließend lief positionTableBar(cell) auf derselben herausgelösten
   * Zelle. cell.closest('table') findet die abgehängte Tabelle noch, also
   * galt sie als vorhanden, und getBoundingClientRect() liefert lauter
   * Nullen – die Leiste sprang auf 8/6 und klebte in der Ecke fest.
   * Genau so wurde es gemeldet.
   */
  const mitZelle = (fn) => () => {
    const cell = tblBar._zelle;
    if (!cell || !cell.isConnected) { versteckeTableBar(); return; }
    if (S.readOnly) {
      if (typeof toast === 'function') toast(t('sharedNoRight'), true);
      return;
    }

    const pos = cellPos(cell);
    if (!pos.table) { versteckeTableBar(); return; }

    // Vor dem Eingriff merken – danach kann die Tabelle weg sein
    const textDiv = pos.table.closest('.j-text');
    if (typeof pushPageHistory === 'function') {
      const pgEl = textDiv && textDiv.closest('[data-pgid]');
      const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
      if (info) pushPageHistory(info.page);
    }

    fn(pos, cell);

    notiereText(textDiv);
    if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();

    // Nur nachführen, wenn Zelle UND Tabelle noch im Baum hängen
    if (cell.isConnected && pos.table.isConnected) positionTableBar(cell);
    else versteckeTableBar();
  };

  const txt = (key, ersatz) => (typeof t === 'function' && t(key)) || ersatz;
  const meldung = (key, ersatz) => {
    if (typeof toast === 'function') toast(txt(key, ersatz), true);
  };

  knopf(TBL_ICONS.zeilePlus, txt('tableRowAdd', 'Zeile darunter'),
    mitZelle(pos => {
      const neu = addRow(pos.table, pos.zeile);
      // Ohne Rückmeldung wirkt ein stiller Anschlag wie ein kaputter Knopf
      if (!neu) return meldung('tableMaxRows', 'Mehr Zeilen passen nicht auf die Seite.');
      focusCell(neu.children[pos.spalte] || neu.children[0]);
    }));
  knopf(TBL_ICONS.zeileMinus, txt('tableRowDel', 'Zeile löschen'),
    mitZelle((pos) => {
      const nachbar = pos.zeile.nextElementSibling || pos.zeile.previousElementSibling;
      if (!removeRow(pos.table, pos.zeile)) return meldung('tableLastRow', 'Die letzte Zeile bleibt.');
      if (nachbar) {
        const ziel = nachbar.children[pos.spalte] || nachbar.children[0];
        focusCell(ziel);
        tblBar._zelle = ziel;
      }
    }));
  knopf(TBL_ICONS.spaltePlus, txt('tableColAdd', 'Spalte rechts'),
    mitZelle(pos => {
      if (!addColumn(pos.table, pos.spalte)) return meldung('tableMaxCols', 'Mehr Spalten passen nicht auf die Seite.');
      const ziel = pos.zeile.children[pos.spalte + 1];
      if (ziel) { focusCell(ziel); tblBar._zelle = ziel; }
    }));
  knopf(TBL_ICONS.spalteMinus, txt('tableColDel', 'Spalte löschen'),
    mitZelle(pos => {
      if (!removeColumn(pos.table, pos.spalte)) return meldung('tableLastCol', 'Die letzte Spalte bleibt.');
      const ziel = pos.zeile.children[Math.min(pos.spalte, pos.zeile.children.length - 1)];
      if (ziel) { focusCell(ziel); tblBar._zelle = ziel; }
    }));
  knopf(TBL_ICONS.weg, txt('tableDelete', 'Tabelle löschen'),
    mitZelle(pos => { pos.table.remove(); }));

  document.body.appendChild(tblBar);
  return tblBar;
}

function positionTableBar(cell) {
  const bar = tableBar();
  const table = cell && cell.closest('table');
  /* isConnected und nicht nur „gibt es eine Tabelle": eine herausgelöste
     Tabelle findet closest() noch, und ihr getBoundingClientRect() ist
     lauter Null – die Leiste landete dann in der linken oberen Ecke des
     Fensters und blieb dort kleben. */
  if (!table || !table.isConnected) { versteckeTableBar(); return; }

  bar._zelle = cell;
  bar.style.display = 'flex';
  const r = table.getBoundingClientRect();
  if (!r.width && !r.height) { versteckeTableBar(); return; }

  const h = bar.offsetHeight || 30;
  const b = bar.offsetWidth || 160;
  /* Über der Tabelle, und wenn dort kein Platz ist, darunter. Gemessen
     wird am Fenster, denn die Leiste hängt am body – sie soll nicht mit
     der Seite skalieren, sonst wäre sie im Hochformat winzig. */
  const oben = r.top - h - 6;
  // Rechts nicht hinauslaufen lassen (wie beim Einfügen-Menü)
  const links = Math.max(8, Math.min(window.innerWidth - b - 8, r.left));
  bar.style.left = Math.round(links) + 'px';
  bar.style.top = Math.round(oben > 60 ? oben : r.bottom + 6) + 'px';
}

function versteckeTableBar() {
  if (!tblBar) return;
  tblBar.style.display = 'none';
  tblBar._zelle = null;
}

/**
 * Eine Änderung im Text festhalten und weitergeben.
 *
 * Nimmt den TEXTBEREICH, nicht die Tabelle: nach einem „Tabelle löschen"
 * gibt es keine Tabelle mehr, von der aus man ihn finden könnte.
 */
function notiereText(textDiv) {
  if (!textDiv || !textDiv.isConnected) return;
  const pgEl = textDiv.closest('[data-pgid]');
  const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
  if (!info) return;

  // Ohne die Greifstreifen – sie sind Bedienteil, nicht Inhalt (app.js)
  info.page.textContent = typeof ohneGriffe === 'function'
    ? ohneGriffe(textDiv) : textDiv.innerHTML;
  if (window.Collab) Collab.noteTextChange(info.page.id, info.page.textContent);
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/** Wie notiereText, aber ausgehend von der Tabelle. */
function notiereTabelle(table) {
  notiereText(table && table.closest ? table.closest('.j-text') : null);
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

  /* Keine Tabelle in einer Tabelle: das bringt die Schreibmarken
     (canvas/text.js zählt <tr> als Block) und den Word-Export durcheinander. */
  if (currentCell()) {
    if (typeof toast === 'function') toast(t('tableInTable') || 'In einer Tabelle geht das nicht.', true);
    return false;
  }

  const pgEl = textDiv.closest('[data-pgid]');
  const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
  if (!info) return false;

  if (typeof pushPageHistory === 'function') pushPageHistory(info.page);

  /* Die vorhandenen Tabellen VORHER merken. Der data-ready-Umweg half
     nicht: das Attribut wurde gleich danach wieder entfernt, also traf
     :not([data-ready]) beim nächsten Mal wieder die erste Tabelle der
     Seite – die Marke landete in der falschen. */
  const vorher = new Set(textDiv.querySelectorAll('table.j-table'));

  /* Nach der Tabelle ein leerer Absatz, sonst käme man hinter ihr nicht
     mehr in den Text – eine Tabelle am Ende der Seite wäre eine Sackgasse. */
  document.execCommand('insertHTML', false,
    buildTableHtml(zeilen, spalten) + '<p><br></p>');

  const table = [...textDiv.querySelectorAll('table.j-table')].find(el => !vorher.has(el));
  if (table) focusCell(table.querySelector('th, td'));

  notiereTabelle(table || textDiv.querySelector('table'));
  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  return true;
}

/* ══════════════════════════════════════════════════════════════════════
   SPALTENBREITE ZIEHEN

   Wie in Word: an die Grenze zwischen zwei Spalten fahren, der Zeiger
   wird zum Doppelpfeil, ziehen.

   >>> Warum <colgroup> und nicht style="width" an der Zelle <<<
   core/sanitize.js laesst von einem style nur die Farbe stehen – eine
   Breite an der Zelle waere beim naechsten Abgleich weg. <col width="…">
   geht durch, seit sanitize.js COLGROUP/COL und das width-Attribut
   kennt. Ausserdem gilt eine col-Breite fuer die ganze Spalte; an der
   Zelle muesste sie in jeder Zeile stehen.
   ══════════════════════════════════════════════════════════════════════ */
const TBL_MIN_SPALTE = 28;  // schmaler wird keine Spalte

let tblZieh = null;

/**
 * Sorgt dafuer, dass die Tabelle ein <colgroup> mit festen Breiten hat.
 *
 * Erst damit wirkt das Ziehen: eine Tabelle mit <colgroup> schaltet in
 * css/pages.css auf `table-layout: fixed`. Bei `auto` – dem Ausgangswert –
 * ist eine Breite an <col> nur ein Vorschlag, den der Browser zugunsten
 * des Inhalts uebergeht. Genau deshalb sprang die Spalte bisher zurueck.
 */
function sichereColgroup(table) {
  const erste = table.querySelector('tr');
  const spalten = erste ? erste.children.length : 0;
  if (!spalten) return null;

  // Die jetzigen Breiten VOR dem Umschalten messen, sonst springt alles um
  const istBreiten = [...erste.children].map(z => z.getBoundingClientRect().width);
  const zoom = typeof getZoom === 'function' ? getZoom() : 1;

  let grp = table.querySelector('colgroup');
  if (!grp) {
    grp = document.createElement('colgroup');
    table.insertBefore(grp, table.firstChild);
  }
  while (grp.children.length < spalten) grp.appendChild(document.createElement('col'));
  while (grp.children.length > spalten) grp.lastElementChild.remove();

  [...grp.children].forEach((col, i) => {
    if (col.getAttribute('width')) return;
    col.setAttribute('width', Math.max(TBL_MIN_SPALTE, Math.round((istBreiten[i] || 80) / zoom)));
  });
  return grp;
}

/**
 * Die Greifstreifen an den Spaltengrenzen setzen.
 *
 * >>> Warum eigene Elemente und nicht die Kante messen <<<
 * Vorher wurde bei jeder Bewegung der Abstand zur Zellkante gerechnet und
 * ab fuenf Pixeln gegriffen. Fuenf Pixel trifft die Maus knapp und der
 * Finger gar nicht, und bei jedem Mausweg lief ein elementFromPoint mit.
 * Ein eigener Streifen ist ein echtes Ziel: breit genug, mit eigenem
 * Zeiger, und er kostet nichts, solange niemand ihn anfasst.
 *
 * Die Streifen stehen NICHT im gespeicherten Text: sie werden hier
 * angelegt und vor dem Sichern wieder entfernt (siehe notiereText).
 */
function setzeGriffe(table) {
  if (!table || S.readOnly) return;
  const erste = table.querySelector('tr');
  if (!erste) return;

  // In jede Zelle der ERSTEN Zeile einen Streifen, ausser in die letzte
  [...erste.children].forEach((zelle, i) => {
    if (i >= erste.children.length - 1) return;
    if (zelle.querySelector(':scope > .j-tbl-griff')) return;

    const griff = document.createElement('span');
    griff.className = 'j-tbl-griff';
    griff.contentEditable = 'false';
    griff.dataset.spalte = String(i);
    zelle.appendChild(griff);
  });
}

/** Alle Greifstreifen aus einem Baum nehmen – vor dem Sichern. */
function entferneGriffe(wurzel) {
  if (!wurzel || !wurzel.querySelectorAll) return;
  wurzel.querySelectorAll('.j-tbl-griff').forEach(g => g.remove());
}

/* Die Streifen kommen und gehen mit der Schreibmarke: nur die Tabelle,
   in der man gerade steht, zeigt sie. */
function aktualisiereGriffe(cell) {
  document.querySelectorAll('.j-tbl-griff').forEach(g => {
    if (!cell || g.closest('table') !== cell.closest('table')) g.remove();
  });
  if (cell) setzeGriffe(cell.closest('table.j-table'));
}

document.addEventListener('pointerdown', e => {
  const griff = e.target.closest && e.target.closest('.j-tbl-griff');
  if (!griff || S.readOnly) return;

  const table = griff.closest('table.j-table');
  const grp = sichereColgroup(table);
  if (!grp) return;
  const index = +griff.dataset.spalte;
  const col = grp.children[index];
  const nachbar = grp.children[index + 1];
  if (!col) return;

  e.preventDefault();
  e.stopPropagation();
  try { griff.setPointerCapture(e.pointerId); } catch (err) { }
  griff.classList.add('j-zieht');

  const textDiv = table.closest('.j-text');
  const pgEl = textDiv && textDiv.closest('[data-pgid]');
  const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
  if (info && typeof pushPageHistory === 'function') pushPageHistory(info.page);

  tblZieh = {
    table, grp, griff, index, col, nachbar,
    startX: e.clientX,
    startBreite: parseFloat(col.getAttribute('width')) || 100,
    nachbarBreite: nachbar ? (parseFloat(nachbar.getAttribute('width')) || 100) : 0,
    zoom: typeof getZoom === 'function' ? getZoom() : 1,
    textDiv
  };
}, true);

document.addEventListener('pointermove', e => {
  if (!tblZieh) return;
  e.preventDefault();

  /* In Seiten-Koordinaten rechnen: der Zoom ist ein CSS-transform, ein
     Pixel auf dem Schirm ist also nicht ein Pixel auf dem Papier. */
  let dx = (e.clientX - tblZieh.startX) / (tblZieh.zoom || 1);

  // Was die eine Spalte gewinnt, verliert die daneben – sonst wuechse die
  // Tabelle ueber den Blattrand hinaus
  if (tblZieh.nachbar) {
    dx = Math.max(TBL_MIN_SPALTE - tblZieh.startBreite,
         Math.min(tblZieh.nachbarBreite - TBL_MIN_SPALTE, dx));
    tblZieh.nachbar.setAttribute('width', Math.round(tblZieh.nachbarBreite - dx));
  } else {
    dx = Math.max(TBL_MIN_SPALTE - tblZieh.startBreite, dx);
  }
  tblZieh.col.setAttribute('width', Math.round(tblZieh.startBreite + dx));
}, { passive: false });

function beendeZiehen() {
  if (!tblZieh) return;
  tblZieh.griff.classList.remove('j-zieht');
  notiereText(tblZieh.textDiv);
  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  tblZieh = null;
}

document.addEventListener('pointerup', beendeZiehen);
document.addEventListener('pointercancel', beendeZiehen);

/* Die Leiste folgt der Schreibmarke. Über selectionchange und nicht über
   einen Klick: die Marke wandert auch mit den Pfeiltasten und mit Tab. */
document.addEventListener('selectionchange', () => {
  const cell = currentCell();
  if (cell) positionTableBar(cell);
  else versteckeTableBar();
  // Die Greifstreifen zeigt nur die Tabelle, in der die Marke steht
  if (!tblZieh) aktualisiereGriffe(cell);
});

// Beim Rollen und Zoomen zieht sie mit
document.addEventListener('scroll', () => {
  if (tblBar && tblBar._zelle && tblBar.style.display !== 'none') {
    positionTableBar(tblBar._zelle);
  }
}, true);

/* Beim Wechsel der Fenstergroesse ebenso – sonst steht sie schief, sobald
   der Seitenbereich anders sitzt. */
window.addEventListener('resize', () => {
  if (tblBar && tblBar._zelle && tblBar.style.display !== 'none') {
    positionTableBar(tblBar._zelle);
  }
}, { passive: true });

/* Wird die Seite neu aufgebaut (Abgleich, Seitenwechsel, Heftwechsel),
   zeigt _zelle auf eine Zelle, die es nicht mehr gibt. Die Leiste bliebe
   sonst stehen und haenge an einem Leichnam. */
window.versteckeTableBarWennWeg = function () {
  if (tblBar && tblBar._zelle && !tblBar._zelle.isConnected) versteckeTableBar();
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTableHtml, TBL_MAX, TBL_GRID_MAX };
}
