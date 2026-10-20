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
     · Spaltenbreite und Zeilenhöhe lassen sich an der Kante ziehen.
       Die Höhe rastet dabei auf ganze Zeilen ein, damit der Text
       darunter auf den Linien des Papiers bleibt.
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

/* ══════════════════════════════════════════════════════════════════════
   VERBUNDENE ZELLEN BRAUCHEN EIN LOGISCHES RASTER

   Zeile und Spalte wurden hier als Platz im DOM gerechnet:
   zeile.children[index] war „die Spalte index", children.length „die
   Spaltenzahl". Solange jede Zelle genau ein Feld belegt, stimmt das.

   Aus Word kommen aber Tabellen mit colspan und rowspan – der Import
   unterstützt beides ausdrücklich (core/docxImport.js). Damit fällt die
   Rechnung auseinander:

     Kopfzeile:  [ AB (colspan 2) ] [ C ]     ← zwei Kinder, drei Spalten
     Datenzeile: [ D ] [ E ] [ F ]            ← drei Kinder, drei Spalten

   „Spalte 2 löschen" traf in der ersten Zeile C (die logisch dritte) und
   in der zweiten E (die logisch zweite). Eine neue Zeile bekam so viele
   Zellen, wie die Musterzeile KINDER hatte – nach der Kopfzeile oben also
   eine statt drei.

   Das Raster unten bildet jede Zelle auf die Felder ab, die sie wirklich
   belegt. Darauf rechnen alle Aktionen, und die Spannen werden
   mitgezogen statt übergangen.
   ══════════════════════════════════════════════════════════════════════ */

/** colspan/rowspan als Zahl – fehlend, leer oder unsinnig heisst 1. */
function spanne(zelle, name) {
  const roh = parseInt(zelle.getAttribute(name) || '1', 10);
  return (Number.isFinite(roh) && roh > 0) ? roh : 1;
}

/** Setzt eine Spanne – oder nimmt das Attribut weg, wenn sie 1 ist. */
function setzeSpanne(zelle, name, wert) {
  if (wert > 1) zelle.setAttribute(name, String(wert));
  else zelle.removeAttribute(name);
}

/**
 * Welche Zelle liegt auf welchem Feld?
 *
 * @returns {{trs: Element[], raster: Array<Array>, spalten: number}}
 *   raster[zeile][spalte] = { zelle, ursprung, r, c, cs, rs } oder leer
 */
function logischesRaster(table) {
  const trs = [...table.querySelectorAll('tr')];
  const raster = trs.map(() => []);

  trs.forEach((tr, r) => {
    let c = 0;
    for (const zelle of [...tr.children]) {
      while (raster[r][c]) c++;               // schon von oben belegt
      const cs = spanne(zelle, 'colspan');
      const rs = spanne(zelle, 'rowspan');
      for (let dr = 0; dr < rs && r + dr < trs.length; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          raster[r + dr][c + dc] = { zelle, ursprung: dr === 0 && dc === 0, r, c, cs, rs };
        }
      }
      c += cs;
    }
  });

  const spalten = raster.reduce((m, z) => Math.max(m, z.length), 0);
  return { trs, raster, spalten };
}

/** Hängt eine Zeile an – mit so vielen Zellen, wie logisch frei sind. */
function addRow(table, nachZeile) {
  const { trs, raster, spalten } = logischesRaster(table);
  const muster = nachZeile || trs[trs.length - 1];
  if (!muster) return null;
  if (trs.length >= TBL_MAX) return null;

  const nr = trs.indexOf(muster);
  const neu = document.createElement('tr');

  /* Felder, die eine Zelle von oben her überdeckt, bekommen keine neue
     Zelle – die Zelle darüber wächst stattdessen um eine Zeile. Genau
     das tut Word auch. */
  const gewachsen = new Set();
  for (let c = 0; c < spalten; c++) {
    const feld = nr >= 0 ? (raster[nr] || [])[c] : null;
    const deckt = feld && (feld.r + feld.rs - 1) > nr;
    if (deckt) {
      if (!gewachsen.has(feld.zelle)) {
        setzeSpanne(feld.zelle, 'rowspan', feld.rs + 1);
        gewachsen.add(feld.zelle);
      }
      continue;
    }
    // Leer, ohne <br> – die Begründung steht in buildTableHtml
    neu.appendChild(document.createElement('td'));
  }

  // Eine Tabelle ohne jede freie Spalte gibt es nicht – dann eine Zelle
  if (!neu.children.length) neu.appendChild(document.createElement('td'));

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
  const { trs, raster, spalten } = logischesRaster(table);
  if (!trs.length) return false;
  if (spalten >= TBL_MAX) return false;

  const breiter = new Set();

  trs.forEach((zeile, r) => {
    const kopf = zeile.parentNode && zeile.parentNode.tagName === 'THEAD';
    const alsKopf = kopf || (zeile.children[0] && zeile.children[0].tagName === 'TH');

    const feld = (nachIndex >= 0) ? (raster[r] || [])[nachIndex] : null;

    /* Reicht die Zelle an dieser Stelle über die Grenze hinaus, wird sie
       breiter statt eine neue daneben zu bekommen – sonst zerrisse die
       neue Spalte eine verbundene Zelle. */
    if (feld && (feld.c + feld.cs - 1) > nachIndex) {
      if (!breiter.has(feld.zelle)) {
        setzeSpanne(feld.zelle, 'colspan', feld.cs + 1);
        breiter.add(feld.zelle);
      }
      return;
    }

    const zelle = document.createElement(alsKopf ? 'th' : 'td');
    if (feld && feld.zelle.parentNode === zeile) {
      zeile.insertBefore(zelle, feld.zelle.nextSibling);
    } else if (feld) {
      /* Das Feld gehört einer Zelle aus einer Zeile darüber (rowspan).
         Hier gehört die neue Zelle an die Stelle, an der die Zeile das
         nächste eigene Feld rechts davon hat. */
      const naechste = [...zeile.children].find(k => {
        const f = (raster[r] || []).find(x => x && x.zelle === k);
        return f && f.c > nachIndex;
      });
      if (naechste) zeile.insertBefore(zelle, naechste);
      else zeile.appendChild(zelle);
    } else {
      zeile.appendChild(zelle);
    }
  });

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
  const { trs, raster } = logischesRaster(table);
  if (trs.length <= 1 || !zeile) return false;

  const nr = trs.indexOf(zeile);
  if (nr < 0) return false;

  /* Zellen, die von oben in diese Zeile hineinreichen, werden um eine
     Zeile kürzer. Und eine Zelle, die HIER anfängt und weiter nach unten
     reicht, zieht in die nächste Zeile um – sonst verlöre die Tabelle
     ihren Inhalt und die Zeilen darunter bekämen ein Loch. */
  const behandelt = new Set();
  const naechste = trs[nr + 1] || null;

  for (const feld of (raster[nr] || [])) {
    if (!feld || behandelt.has(feld.zelle)) continue;
    behandelt.add(feld.zelle);
    if (feld.rs <= 1) continue;

    if (feld.r < nr) {
      setzeSpanne(feld.zelle, 'rowspan', feld.rs - 1);
    } else if (naechste) {
      setzeSpanne(feld.zelle, 'rowspan', feld.rs - 1);
      // An die Stelle, an der sie in der nächsten Zeile hingehört
      const davor = [...naechste.children].find(k => {
        const f = (raster[nr + 1] || []).find(x => x && x.zelle === k);
        return f && f.c > feld.c;
      });
      if (davor) naechste.insertBefore(feld.zelle, davor);
      else naechste.appendChild(feld.zelle);
    }
  }

  zeile.remove();
  return true;
}

function removeColumn(table, index) {
  const { trs, raster, spalten } = logischesRaster(table);
  if (!trs.length || spalten <= 1) return false;

  /* Eine Zelle, die mehrere Felder belegt, wird schmaler statt zu
     verschwinden – und eine, die über mehrere Zeilen reicht, darf nicht
     mehrfach angefasst werden. */
  const behandelt = new Set();
  for (let r = 0; r < trs.length; r++) {
    const feld = (raster[r] || [])[index];
    if (!feld || behandelt.has(feld.zelle)) continue;
    behandelt.add(feld.zelle);

    if (feld.cs > 1) setzeSpanne(feld.zelle, 'colspan', feld.cs - 1);
    else feld.zelle.remove();
  }

  /* Die feste Breite MUSS mitgehen – dasselbe wie in addColumn, nur
     andersherum. Ohne das blieb ein <col> zu viel stehen, und jede
     Spalte rechts der gelöschten bekam die Breite ihrer linken
     Nachbarin: nach dem Löschen sass die ganze Tabelle schief.
     Sichtbar wird es erst, sobald jemand einmal eine Spaltengrenze
     gezogen hat – vorher gibt es gar keine colgroup (sichereColgroup). */
  const grp = table.querySelector('colgroup');
  const col = grp && grp.children[index];
  if (col) col.remove();

  return true;
}

/**
 * Die Stelle einer Zelle: in welcher Zeile, in welcher Spalte.
 *
 * `spalte` ist die LOGISCHE Spalte – bei verbundenen Zellen ist das
 * etwas anderes als der Platz unter den Geschwistern, und die Aktionen
 * darüber rechnen alle logisch (siehe logischesRaster).
 */
function cellPos(cell) {
  const zeile = cell.parentNode;
  const table = cell.closest('table');
  const { trs, raster } = logischesRaster(table);
  const zeileNr = trs.indexOf(zeile);

  let spalte = [...zeile.children].indexOf(cell);
  const reihe = raster[zeileNr] || [];
  for (let c = 0; c < reihe.length; c++) {
    if (reihe[c] && reihe[c].zelle === cell && reihe[c].ursprung) { spalte = c; break; }
  }

  return { table, zeile, spalte, zeileNr };
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
  bewegen: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v12M4 6l4-4 4 4M4 10l4 4 4-4"/><path d="M2 8h12"/></svg>',
  zeileMinus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="2" y="3" width="12" height="4" rx="1"/><path d="M6 12h4"/></svg>',
  spaltePlus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="3" y="2" width="4" height="12" rx="1"/><path d="M12 6v4M10 8h4"/></svg>',
  spalteMinus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="3" y="2" width="4" height="12" rx="1"/><path d="M10 8h4"/></svg>',
  tabelle: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M2 6.6h12M2 9.8h12M6.5 3v10"/></svg>',
  weg: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2.6 4.2h10.8M6.4 4.2V2.9h3.2v1.3M3.9 4.2 4.5 13a.9.9 0 0 0 .9.8h5.2a.9.9 0 0 0 .9-.8l.6-8.8"/></svg>'
};

let tblBar = null;

function tableBar() {
  if (tblBar) return tblBar;

  tblBar = document.createElement('div');
  tblBar.className = 'j-table-bar';
  tblBar.style.display = 'none';

  /**
   * @param {boolean} [aufDruck] auf pointerdown statt auf click hören –
   *   für den Bewegen-Knopf, siehe dort.
   */
  const knopf = (icon, titel, tun, aufDruck) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'j-table-btn';
    b.innerHTML = icon;
    b.title = titel;
    b.setAttribute('aria-label', titel);
    // Die Marke darf beim Klick nicht aus der Tabelle fallen
    b.addEventListener('mousedown', ev => ev.preventDefault());
    if (aufDruck) {
      b.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        tun(ev);
      });
    } else {
      b.addEventListener('click', ev => { ev.stopPropagation(); tun(ev); });
    }
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

  /* ── Tabelle frei verschieben ──────────────────────────────────────
     Ein Knopf wählt die Tabelle aus – dann lässt sie sich mit Maus oder
     Finger über die Seite ziehen wie ein Bild. Sobald man loslässt, sitzt
     sie an der neuen Stelle und ist wieder editierbar. Keine ▲▼-Pfeile,
     kein heimlicher Ziehgriff – ein sichtbarer Knopf und los. */

  /* Der Bewegen-Knopf umgeht mitZelle, weil der Ziehvorgang asynchron
     läuft. mitZelle würde sofort nach dem Start notiereText() und
     positionTableBar() aufrufen – auf einer schon versteckten Tabelle.

     >>> Warum pointerdown und nicht click <<<
     Am Knopf DRÜCKEN UND ZIEHEN ist die Bewegung, die jeder zuerst
     versucht – und genau die kam nie an: ein click entsteht nur, wenn
     Druck und Loslassen dasselbe Element treffen. Wer den Finger vom
     Knopf wegzog, löste gar nichts aus, und das Verschieben sah aus, als
     gäbe es es nicht. Genau so wurde es gemeldet.

     Jetzt fängt es beim Aufsetzen an. Wer nur tippt, statt zu ziehen,
     bekommt weiterhin den alten Weg: die Tabelle bleibt in der Luft und
     wird mit dem nächsten Druck abgesetzt. */
  const startMove = (ev) => {
    const cell = tblBar._zelle;
    if (!cell || !cell.isConnected) { versteckeTableBar(); return; }
    if (S.readOnly) {
      if (typeof toast === 'function') toast(t('sharedNoRight'), true);
      return;
    }
    const pos = cellPos(cell);
    if (!pos.table) { versteckeTableBar(); return; }
    versteckeTableBar();
    starteTabelleVerschieben(pos.table, pos, ev);
  };
  knopf(TBL_ICONS.bewegen, txt('tableMove', 'Tabelle verschieben'), startMove, true);

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

/* ══════════════════════════════════════════════════════════════════
   OHNE SCHREIBRECHT GIBT ES DIE LEISTE NICHT

   Jeder Knopf darin fragte für sich nach S.readOnly und sagte brav
   „Du darfst dieses Dokument nur lesen." Die Leiste selbst erschien
   trotzdem, sobald die Marke in eine Zelle kam — sechs Knöpfe, von
   denen keiner etwas tut. Genau so wurde es gemeldet.

   Eine Leiste, die nur noch Fehlermeldungen gibt, ist schlechter als
   keine: sie verspricht etwas, das es nicht gibt, und verdeckt dabei
   die Tabelle darunter. Der Riegel gehört deshalb HIERHER, an die
   eine Stelle, die sie zeigt — die Schreibmarke, das Rollen, das
   Ändern der Fenstergröße und das Einsetzen laufen alle hier durch.

   Die Abfragen in den Knöpfen bleiben trotzdem stehen. Sie sind die
   Wache, die wirklich zählt: das Recht kann sich ändern, während die
   Leiste schon offen dasteht (der Besitzer stuft herab, der Besitzer
   verliert die Verbindung). Dasselbe Muster wie am Text, wo
   contenteditable und 'beforeinput' beide fragen.

   Die Greifstreifen zum Ziehen von Spalten und Zeilen brauchen hier
   nichts: setzeGriffe() steigt bei S.readOnly schon selbst aus.
   ══════════════════════════════════════════════════════════════════ */
function positionTableBar(cell) {
  if (typeof S !== 'undefined' && S.readOnly) { versteckeTableBar(); return; }
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
  // Die Leiste steht – der Knopf, der sie holt, hat seine Arbeit getan
  if (knopfTabelle === table) versteckeTabellenKnopf();
}

function versteckeTableBar() {
  if (!tblBar) return;
  tblBar.style.display = 'none';
  tblBar._zelle = null;
}

/* ══════════════════════════════════════════════════════════════════════
   EINE FREI GESETZTE TABELLE

   >>> Warum sie den Textfluss verlässt <<<
   Verschoben wurde bisher IM Text: beim Loslassen wurde die Stelle
   gesucht, an der man losgelassen hat, und die Tabelle davor oder
   dahinter einsortiert. Das ging zweimal schief.

     · Fand sich keine solche Stelle – und auf einer Seite, deren Text
       über placeCaretAnywhere entstanden ist, findet sie sich meistens
       nicht –, landete die Tabelle am Ende der Seite. Da stand sie
       vorher auch schon. Es sah aus, als ginge das Verschieben gar
       nicht: „man lässt los und sie geht einfach zurück."
     · Und selbst wenn es klappte, konnte sie nur ZWISCHEN zwei Absätzen
       stehen. „Genau dort, wo man sie fallen lässt" ist im Textfluss
       nicht zu haben.

   Deshalb: einmal angefasst, steht sie frei auf der Seite – wie ein
   Bild. Damit ist sie an keine Zeile mehr gebunden, und ihr Inhalt
   ebenso wenig: die Zeilen der Zellen richten sich nach der Zelle statt
   nach dem Linienraster des Papiers (css/pages.css). Genau darum ging
   die Rückmeldung.

   >>> Warum x/y als Attribut und nicht als style <<<
   Aus demselben Grund wie die Spaltenbreite an <col>: von einem style
   bleibt beim Bereinigen allein die Farbe stehen (core/sanitize.js). Die
   Lage stünde nach dem ersten Abgleich nicht mehr da. Auf left/top
   übertragen wird sie in stelleTabellenAus() – einmal beim Aufbau jeder
   Seite, danach beim Ziehen.

   Eine Tabelle OHNE x steht weiter im Text, genau wie bisher. Frei wird
   sie erst, wenn man sie das erste Mal anfasst.
   ══════════════════════════════════════════════════════════════════════ */

/** Wie weit darf sie? In Seitenmaßen, bezogen auf das Textfeld. */
function tabellenGrenzen(table) {
  const textDiv = table.closest('.j-text');
  const zoom = (typeof getZoom === 'function' ? getZoom() : 1) || 1;
  if (!textDiv) return { maxX: 0, maxY: 0 };
  const r = textDiv.getBoundingClientRect();
  return {
    maxX: Math.max(0, Math.round(r.width / zoom - table.offsetWidth)),
    maxY: Math.max(0, Math.round(r.height / zoom - table.offsetHeight))
  };
}

/** Setzt die Tabelle an eine feste Stelle – und aufs Blatt geklemmt. */
function setzeTabellenLage(table, x, y) {
  const g = tabellenGrenzen(table);
  const nx = Math.round(Math.max(0, Math.min(g.maxX, x)));
  const ny = Math.round(Math.max(0, Math.min(g.maxY, y)));
  table.setAttribute('x', String(nx));
  table.setAttribute('y', String(ny));
  table.style.left = nx + 'px';
  table.style.top = ny + 'px';
  return { x: nx, y: ny };
}

/**
 * Überträgt x/y auf left/top – für jede frei gesetzte Tabelle im Baum.
 *
 * Muss nach JEDEM Aufbau eines Textfelds laufen: der gespeicherte Text
 * trägt nur die Attribute, das Bereinigen wirft den style weg.
 */
function stelleTabellenAus(wurzel) {
  const wo = (wurzel && wurzel.querySelectorAll) ? wurzel : document;
  wo.querySelectorAll('table.j-table[x]').forEach(t => {
    t.style.left = (parseInt(t.getAttribute('x'), 10) || 0) + 'px';
    t.style.top = (parseInt(t.getAttribute('y'), 10) || 0) + 'px';
  });
}
window.stelleTabellenAus = stelleTabellenAus;

/* Der Aufbau einer Seite geschieht an einem halben Dutzend Stellen –
   beim Öffnen, beim Zurücknehmen, beim Eintreffen einer fremden
   Änderung, beim Seitenumbruch. Statt sie alle zu kennen, wird
   zugesehen: was neu in den Baum kommt, wird ausgerichtet. */
if (typeof MutationObserver === 'function') {
  const aufpasser = new MutationObserver(saetze => {
    for (const satz of saetze) {
      for (const knoten of satz.addedNodes) {
        if (knoten.nodeType !== 1) continue;
        if (knoten.matches && knoten.matches('table.j-table[x]')) stelleTabellenAus(knoten.parentNode);
        else if (knoten.querySelector && knoten.querySelector('table.j-table[x]')) stelleTabellenAus(knoten);
      }
    }
  });
  const beobachte = () => {
    const ziel = document.getElementById('pg-scroll') || document.body;
    if (ziel) aufpasser.observe(ziel, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', beobachte);
  else beobachte();
}

/**
 * Nimmt die Tabelle auf und lässt sie mit Maus oder Finger über die Seite
 * ziehen. Beim Loslassen bleibt sie genau dort liegen.
 *
 * Wer nur auf den Knopf TIPPT, statt zu ziehen, trägt sie weiter: sie
 * folgt dem Zeiger, bis irgendwo abgesetzt wird. Das ist der Weg für den
 * Finger, bei dem zwischen Knopf und Ziehen kein durchgehender Zeiger
 * liegt.
 */
function starteTabelleVerschieben(table, pos, startEv) {
  if (!table || !table.isConnected) return;
  if (S.readOnly) {
    if (typeof toast === 'function') toast(t('sharedNoRight'), true);
    return;
  }

  const textDiv = table.closest('.j-text');
  if (!textDiv) return;

  const pgEl = textDiv.closest('[data-pgid]');
  const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
  if (info && typeof pushPageHistory === 'function') pushPageHistory(info.page);

  const zoom = (typeof getZoom === 'function' ? getZoom() : 1) || 1;

  /* Beim ersten Anfassen genau dort festmachen, wo sie gerade steht –
     sonst spränge sie im Augenblick des Griffs in die linke obere Ecke. */
  const tr = table.getBoundingClientRect();
  const dr = textDiv.getBoundingClientRect();
  let lage = setzeTabellenLage(table, (tr.left - dr.left) / zoom, (tr.top - dr.top) / zoom);

  let startX = lage.x, startY = lage.y;
  let griffX = startEv ? startEv.clientX : 0;
  let griffY = startEv ? startEv.clientY : 0;
  let zeiger = startEv ? startEv.pointerId : null;
  let gezogen = !startEv;

  /* Solange sie in der Luft ist, gehört die Bewegung ihr: kein Scrollen,
     keine Schreibmarke, keine Bildschirmtastatur. */
  const alteAction = textDiv.style.touchAction;
  textDiv.style.touchAction = 'none';
  textDiv.contentEditable = 'false';
  document.body.classList.add('j-tbl-zieht');
  versteckeTabellenKnopf();

  const zieh = ev => {
    if (ev.cancelable) ev.preventDefault();

    /* Ein anderer Finger hat übernommen (getippt statt gezogen): der
       Abstand wird neu genommen, sonst spränge die Tabelle um die
       Strecke zwischen Knopf und Finger. */
    if (ev.pointerId !== zeiger) {
      zeiger = ev.pointerId;
      griffX = ev.clientX; griffY = ev.clientY;
      startX = lage.x; startY = lage.y;
    }

    if (Math.abs(ev.clientX - griffX) + Math.abs(ev.clientY - griffY) > 8) gezogen = true;
    lage = setzeTabellenLage(table,
      startX + (ev.clientX - griffX) / zoom,
      startY + (ev.clientY - griffY) / zoom);
  };

  const los = () => {
    // Nur getippt: die Tabelle schwebt weiter und wartet auf das Absetzen
    if (!gezogen) { gezogen = true; return; }

    document.removeEventListener('pointermove', zieh);
    document.removeEventListener('pointerup', los);
    document.removeEventListener('pointercancel', los);
    textDiv.style.touchAction = alteAction;
    textDiv.contentEditable = S.readOnly ? 'false' : 'true';
    document.body.classList.remove('j-tbl-zieht');

    notiereText(textDiv);
    if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();

    // Schreibmarke zurück in die erste Zelle – die Tabelle ist wieder editierbar
    setTimeout(() => {
      if (!table.isConnected) { versteckeTableBar(); return; }
      const ersteZelle = table.querySelector('th, td');
      if (ersteZelle) { focusCell(ersteZelle); positionTableBar(ersteZelle); }
    }, 20);
  };

  document.addEventListener('pointermove', zieh, { passive: false });
  document.addEventListener('pointerup', los);
  document.addEventListener('pointercancel', los);
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
/**
 * Wohin die Tabelle soll, wenn die Schreibmarke nirgends steht.
 *
 * Sie kam dann gar nicht – „erst in den Text klicken" ist eine Absage,
 * kein Ergebnis, und mit dem Finger hat man die Marke sowieso ständig
 * verloren. Stattdessen wird sie in die Mitte der sichtbaren Seite
 * gesetzt, so als hätte man dorthin geklickt (canvas/text.js macht aus
 * einem Klick ins Leere die nötigen Zeilen).
 *
 * @returns {HTMLElement|null} das Textfeld, in dem die Marke jetzt steht
 */
function tabelleOhneMarke() {
  /* Erst zum Zeiger: mit gewähltem Stift ist der Text gar nicht
     beschreibbar (ui/toolbar.js setzt contentEditable), und dann nimmt
     er weder Fokus noch Schreibmarke an. Eine Tabelle ist Text – wer
     eine einsetzt, will an ihr schreiben. */
  if (S.mode !== 'cursor' && typeof switchMode === 'function') switchMode('cursor');

  const pgEl = S.activePgId
    ? document.querySelector('[data-pgid="' + CSS.escape(S.activePgId) + '"]')
    : document.querySelector('.j-page');
  const textDiv = pgEl && pgEl.querySelector('.j-text');
  if (!textDiv) return null;

  /* ── Die Marke ans Ende des Vorhandenen ───────────────────────────
     Hier stand ein Klick in die MITTE der Seite. Seit ein Klick auf
     freie Fläche einen frei stehenden Absatz setzt (canvas/text.js),
     entstünde dabei einer mitten auf dem Blatt – und die Tabelle käme
     hinein. Eine Tabelle gehört aber ans Ende dessen, was schon da
     steht; genau dorthin setzt jedes Textprogramm sie auch. */
  textDiv.focus();
  try {
    const bereich = document.createRange();
    bereich.selectNodeContents(textDiv);
    bereich.collapse(false);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(bereich); }
  } catch (err) { /* dann steht sie, wo sie steht */ }
  return document.activeElement === textDiv ? textDiv : null;
}

function insertTable(zeilen, spalten) {
  let textDiv = document.activeElement;
  if (!textDiv || !textDiv.classList || !textDiv.classList.contains('j-text')) {
    textDiv = tabelleOhneMarke();
    if (!textDiv) {
      if (typeof toast === 'function') toast(t('tableNeedsCaret') || 'Erst in den Text klicken.', true);
      return false;
    }
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

  const zoom = typeof getZoom === 'function' ? getZoom() : 1;
  // Die jetzigen Verhältnisse VOR dem Umschalten messen
  const istBreiten = [...erste.children].map(z => z.getBoundingClientRect().width / zoom);

  let grp = table.querySelector('colgroup');
  const frisch = !grp;
  if (!grp) {
    grp = document.createElement('colgroup');
    table.insertBefore(grp, table.firstChild);
  }
  while (grp.children.length < spalten) grp.appendChild(document.createElement('col'));
  while (grp.children.length > spalten) grp.lastElementChild.remove();

  if (frisch) {
    /* >>> Die Breiten bleiben, wie sie sind <<<
       Hier wurde beim ersten Anfassen auf die volle Textbreite verteilt.
       Damit sprang die ganze Tabelle auf, sobald man EINE Grenze
       berührte – gemeldet als „wenn man draufdrückt, skaliert sich alles
       auf einmal". Festgehalten wird deshalb genau das, was man sieht.

       Dass eine leere Spalte damit am Mindestmaß steht, macht nichts
       mehr: gezogen wird seither nur noch die angefasste Spalte, ihr
       Nachbar muss nichts abgeben (siehe pointermove weiter unten). */
    [...grp.children].forEach((col, i) => {
      col.setAttribute('width', Math.max(TBL_MIN_SPALTE, Math.round(istBreiten[i] || TBL_MIN_SPALTE)));
    });
  }
  return grp;
}

/** Wie breit der Text auf der Seite sein darf – die Grenze der Tabelle. */
function platzFuerTabelle(table) {
  const zoom = typeof getZoom === 'function' ? getZoom() : 1;
  const textDiv = table.closest('.j-text');
  return textDiv
    ? Math.max(120, textDiv.getBoundingClientRect().width / zoom - 4)
    : 640;
}

/**
 * Die Greifstreifen an den Spalten- und Zeilengrenzen setzen.
 *
 * >>> Warum eigene Elemente und nicht die Kante messen <<<
 * Vorher wurde bei jeder Bewegung der Abstand zur Zellkante gerechnet und
 * ab fuenf Pixeln gegriffen. Fuenf Pixel trifft die Maus knapp und der
 * Finger gar nicht, und bei jedem Mausweg lief ein elementFromPoint mit.
 * Ein eigener Streifen ist ein echtes Ziel: breit genug, mit eigenem
 * Zeiger, und er kostet nichts, solange niemand ihn anfasst.
 *
 * >>> Warum man sie nicht sieht <<<
 * Sie waren als goldene Striche gezeichnet und sahen aus wie Knoepfe, die
 * zur Tabelle gehoeren – genau so wurde es gemeldet. Wie in Word gibt es
 * jetzt nur den Zeigerwechsel beim Darueberfahren (css/pages.css).
 *
 * >>> Warum sie ueber die GANZE Kante gehen <<<
 * Der senkrechte Streifen sitzt in der ersten ZEILE, der waagerechte in
 * der ersten SPALTE – ein Streifen je Zelle waere ein Element je Zelle im
 * beschreibbaren Text und damit eine Stelle mehr, an der die Schreibmarke
 * haengen bleibt. Damit man trotzdem ueberall an der Kante greifen kann,
 * wird er ueber die volle Hoehe bzw. Breite der Tabelle gezogen; ein
 * absolut gesetztes Kind darf aus seiner Zelle herausragen.
 *
 * Die Streifen stehen NICHT im gespeicherten Text: sie werden hier
 * angelegt und vor dem Sichern wieder entfernt (siehe notiereText).
 */
function setzeGriffe(table) {
  if (!table || S.readOnly) return;
  const erste = table.querySelector('tr');
  if (!erste) return;

  const hoch = table.offsetHeight;
  const breit = table.offsetWidth;

  /* In JEDE Zelle der ersten Zeile einen Streifen, auch in die letzte:
     die letzte Spalte breiter zu machen ist genauso naheliegend wie jede
     andere, und sie ging bisher als einzige nicht. */
  [...erste.children].forEach((zelle, i) => {
    let griff = zelle.querySelector(':scope > .j-tbl-griff');
    if (!griff) {
      griff = document.createElement('span');
      griff.className = 'j-tbl-griff';
      griff.contentEditable = 'false';
      zelle.appendChild(griff);
    }
    griff.dataset.spalte = String(i);
    if (hoch) griff.style.height = hoch + 'px';
  });

  // Und ein waagerechter Streifen an der Unterkante jeder Zeile
  [...table.querySelectorAll('tr')].forEach(zeile => {
    const zelle = zeile.firstElementChild;
    if (!zelle) return;
    let griff = zelle.querySelector(':scope > .j-tbl-zeilengriff');
    if (!griff) {
      griff = document.createElement('span');
      griff.className = 'j-tbl-zeilengriff';
      griff.contentEditable = 'false';
      zelle.appendChild(griff);
    }
    if (breit) griff.style.width = breit + 'px';
  });
}

/** Alle Greifstreifen aus einem Baum nehmen – vor dem Sichern. */
function entferneGriffe(wurzel) {
  if (!wurzel || !wurzel.querySelectorAll) return;
  wurzel.querySelectorAll('.j-tbl-griff, .j-tbl-zeilengriff').forEach(g => g.remove());
}

/* Genau eine Tabelle traegt Streifen: die, ueber der der Zeiger steht –
   und wenn er ueber keiner steht, die mit der Schreibmarke. Mehr braucht
   es nicht, und weniger Elemente im beschreibbaren Text ist besser. */
let griffTabelle = null;

function griffeFuer(table) {
  if (griffTabelle && griffTabelle !== table) entferneGriffe(griffTabelle);
  griffTabelle = table || null;
  if (table) setzeGriffe(table);
}

function aktualisiereGriffe(cell) {
  griffeFuer(cell ? cell.closest('table.j-table') : null);
}

/* Wie in Word: an die Kante fahren, der Zeiger wird zum Doppelpfeil.
   Dafuer muessen die Streifen schon dasein, bevor jemand in die Tabelle
   geklickt hat – mit der Schreibmarke allein waeren sie erst nach einem
   Klick da, und ein Klick ist genau das, was man sich sparen will. */
document.addEventListener('pointerover', e => {
  if (tblZieh || zeilenZieh) return;
  const ziel = e.target && e.target.closest ? e.target.closest('table.j-table') : null;
  if (ziel && ziel.closest('.j-text')) { griffeFuer(ziel); return; }
  aktualisiereGriffe(currentCell());
});

/* ══════════════════════════════════════════════════════════════════════
   ZEILENHÖHE ZIEHEN

   Dasselbe wie bei den Spalten, nur senkrecht – und mit einem Zusatz,
   den die Spalten nicht brauchen: die Höhe RASTET EIN.

   >>> Warum sie einrastet <<<
   Der ganze Seitentext sitzt in einem Raster von einer Zeilenhöhe
   (--lh, meist 32 px). Eine Tabellenzeile von 47 px würde alles darunter
   um 15 px neben die Linien des Papiers schieben – genau der Fehler, der
   für die Ränder eigens behoben wurde (css/pages.css). Eine gezogene
   Zeile ist deshalb immer ein ganzes Vielfaches einer Zeilenhöhe, und
   das fühlt sich beim Ziehen auch richtig an: sie springt von Zeile zu
   Zeile, wie das Papier darunter.

   Die Höhe steht als height am <tr> und nicht als style: von einem style
   bleibt beim Bereinigen allein die Farbe stehen (core/sanitize.js).
   ══════════════════════════════════════════════════════════════════════ */
let zeilenZieh = null;

/** Die Zeilenhöhe der Seite, in der diese Tabelle steht. */
function zeilenhoeheVon(table) {
  const textDiv = table && table.closest ? table.closest('.j-text') : null;
  if (!textDiv) return 32;
  const wert = parseFloat(getComputedStyle(textDiv).lineHeight);
  return wert > 0 ? wert : 32;
}

document.addEventListener('pointerdown', e => {
  const zGriff = e.target.closest && e.target.closest('.j-tbl-zeilengriff');
  if (zGriff && !S.readOnly) {
    const zeile = zGriff.closest('tr');
    const table = zGriff.closest('table.j-table');
    if (!zeile || !table) return;

    e.preventDefault();
    e.stopPropagation();
    try { zGriff.setPointerCapture(e.pointerId); } catch (err) { }
    zGriff.classList.add('j-zieht');

    const textDiv = table.closest('.j-text');
    const pgEl = textDiv && textDiv.closest('[data-pgid]');
    const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
    if (info && typeof pushPageHistory === 'function') pushPageHistory(info.page);

    const zoom = typeof getZoom === 'function' ? getZoom() : 1;
    zeilenZieh = {
      zeile, griff: zGriff, textDiv, zoom,
      lh: zeilenhoeheVon(table),
      startY: e.clientY,
      startHoehe: zeile.getBoundingClientRect().height / (zoom || 1)
    };
    return;
  }

  const griff = e.target.closest && e.target.closest('.j-tbl-griff');
  if (!griff || S.readOnly) return;

  const table = griff.closest('table.j-table');
  const grp = sichereColgroup(table);
  if (!grp) return;
  const index = +griff.dataset.spalte;
  const col = grp.children[index];
  if (!col) return;

  e.preventDefault();
  e.stopPropagation();
  try { griff.setPointerCapture(e.pointerId); } catch (err) { }
  griff.classList.add('j-zieht');

  const textDiv = table.closest('.j-text');
  const pgEl = textDiv && textDiv.closest('[data-pgid]');
  const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
  if (info && typeof pushPageHistory === 'function') pushPageHistory(info.page);

  const breiten = [...grp.children].map(c => parseFloat(c.getAttribute('width')) || TBL_MIN_SPALTE);
  const summe = breiten.reduce((a, b) => a + b, 0);

  tblZieh = {
    table, grp, griff, index, col,
    startX: e.clientX,
    startBreite: breiten[index],
    // So breit darf die angefasste Spalte hoechstens werden, ohne dass die
    // Tabelle ueber den Textrand hinauslaeuft
    maxBreite: Math.max(TBL_MIN_SPALTE, platzFuerTabelle(table) - (summe - breiten[index])),
    zoom: typeof getZoom === 'function' ? getZoom() : 1,
    textDiv
  };
}, true);

document.addEventListener('pointermove', e => {
  if (zeilenZieh) {
    e.preventDefault();
    const dy = (e.clientY - zeilenZieh.startY) / (zeilenZieh.zoom || 1);
    const lh = zeilenZieh.lh;
    // Auf ganze Zeilenhöhen runden, mindestens eine – siehe Kopf oben
    const stufen = Math.max(1, Math.round((zeilenZieh.startHoehe + dy) / lh));
    zeilenZieh.zeile.setAttribute('height', String(Math.round(stufen * lh)));
    return;
  }

  if (!tblZieh) return;
  e.preventDefault();

  /* In Seiten-Koordinaten rechnen: der Zoom ist ein CSS-transform, ein
     Pixel auf dem Schirm ist also nicht ein Pixel auf dem Papier. */
  const dx = (e.clientX - tblZieh.startX) / (tblZieh.zoom || 1);

  /* >>> Nur die angefasste Spalte <<<
     Vorher gab der Nachbar ab, was diese Spalte gewann. Wer eine Spalte
     breiter zog, machte damit unweigerlich die daneben schmaler – zwei
     Aenderungen fuer einen Handgriff, und die Tabelle sah danach ueberall
     anders aus. Jetzt wandert nur diese eine Kante, alles rechts davon
     rueckt mit; die Tabelle wird dabei breiter oder schmaler, aber nie
     breiter als der Text auf der Seite. */
  const breite = Math.max(TBL_MIN_SPALTE,
    Math.min(tblZieh.maxBreite, tblZieh.startBreite + dx));
  tblZieh.col.setAttribute('width', Math.round(breite));
}, { passive: false });

function beendeZiehen() {
  if (zeilenZieh) {
    zeilenZieh.griff.classList.remove('j-zieht');
    notiereText(zeilenZieh.textDiv);
    if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
    zeilenZieh = null;
    // Die Tabelle ist jetzt anders hoch – die Streifen gehen sonst daneben
    setzeGriffe(griffTabelle);
    return;
  }
  if (!tblZieh) return;
  tblZieh.griff.classList.remove('j-zieht');
  notiereText(tblZieh.textDiv);
  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  tblZieh = null;
  setzeGriffe(griffTabelle);
}

document.addEventListener('pointerup', beendeZiehen);
document.addEventListener('pointercancel', beendeZiehen);

/* Die Leiste folgt der Schreibmarke. Über selectionchange und nicht über
   einen Klick: die Marke wandert auch mit den Pfeiltasten und mit Tab. */
document.addEventListener('selectionchange', () => {
  const cell = currentCell();
  if (cell) positionTableBar(cell);
  else versteckeTableBar();
  // Die Greifstreifen zeigt nur die Tabelle, in der die Marke steht.
  // Waehrend gezogen wird nicht: das Neusetzen naehme den Streifen weg,
  // an dem der Finger gerade haengt.
  if (!tblZieh && !zeilenZieh) aktualisiereGriffe(cell);
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

/* ══════════════════════════════════════════════════════════════════════
   DER KNOPF NEBEN DER TABELLE

   >>> Gemeldet: „Tabelle verschoben, Leiste weg – und danach lässt sie
   sich nicht mehr auswählen“ <<<
   Die Leiste hing allein an der Schreibmarke: nur wer sie in eine Zelle
   brachte, bekam sie zu sehen. Bei einer frei gesetzten Tabelle trifft
   ein Klick aber oft nicht in die Zelle, sondern setzt die Marke in den
   Text darunter – und mit dem Finger, wo jedes Antippen die Tastatur
   hochholt, will man die Marke dort gar nicht haben. Damit gab es
   schlicht keinen Weg mehr zur Leiste.

   Jetzt steht neben der Tabelle ein kleiner Knopf, der sie holt:
     · mit der Maus, sobald der Zeiger in die Nähe der Tabelle kommt,
     · mit Finger oder Stift, sobald man die Tabelle antippt.
   Er braucht keine Schreibmarke – die Leiste arbeitet dann an der ersten
   Zelle, und jeder ihrer Knöpfe setzt die Marke selbst.
   ══════════════════════════════════════════════════════════════════════ */
const KNOPF_NAEHE = 48;   // Bildschirm-Pixel um die Tabelle herum
let tblKnopf = null;
let knopfTabelle = null;

function tabellenKnopf() {
  if (tblKnopf) return tblKnopf;
  tblKnopf = document.createElement('button');
  tblKnopf.type = 'button';
  tblKnopf.className = 'j-table-knopf';
  tblKnopf.style.display = 'none';
  tblKnopf.innerHTML = TBL_ICONS.tabelle;
  // Weder Marke noch Fokus dürfen beim Druck wandern
  tblKnopf.addEventListener('mousedown', ev => ev.preventDefault());
  tblKnopf.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); });
  tblKnopf.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const table = knopfTabelle;
    versteckeTabellenKnopf();
    if (!table || !table.isConnected) return;
    const zelle = table.querySelector('th, td');
    if (zelle) positionTableBar(zelle);
  });
  document.body.appendChild(tblKnopf);
  return tblKnopf;
}

function zeigeTabellenKnopf(table) {
  if (!table || !table.isConnected || (typeof S !== 'undefined' && S.readOnly)
      || document.body.classList.contains('j-tbl-zieht')) {
    versteckeTabellenKnopf();
    return;
  }
  // Steht die Leiste schon an dieser Tabelle, braucht es den Knopf nicht
  if (tblBar && tblBar.style.display !== 'none' && tblBar._zelle
      && tblBar._zelle.closest('table') === table) {
    versteckeTabellenKnopf();
    return;
  }
  const r = table.getBoundingClientRect();
  if (!r.width && !r.height) { versteckeTabellenKnopf(); return; }

  const k = tabellenKnopf();
  const titel = (typeof t === 'function' && t('tableEdit')) || 'Tabelle bearbeiten';
  k.title = titel;
  k.setAttribute('aria-label', titel);
  k.style.display = 'flex';
  const g = k.offsetWidth || 28;

  /* Links neben die obere Ecke; reicht der Platz dort nicht, rechts
     daneben. Nicht unter die Werkzeugleiste: die Oberkante des
     Seitenbereichs ist die Grenze, nicht die des Fensters. */
  let links = r.left - g - 6;
  if (links < 8) links = Math.min(window.innerWidth - g - 8, r.right + 6);
  const sc = document.getElementById('pg-scroll');
  const decke = sc ? sc.getBoundingClientRect().top + 6 : 8;
  const oben = Math.min(Math.max(r.top, decke), r.bottom - g);
  k.style.left = Math.round(links) + 'px';
  k.style.top = Math.round(oben) + 'px';
  knopfTabelle = table;
}

function versteckeTabellenKnopf() {
  if (tblKnopf) tblKnopf.style.display = 'none';
  knopfTabelle = null;
}

/** Die Tabelle, der die Stelle am nächsten ist – innerhalb von KNOPF_NAEHE. */
function tabelleNahe(x, y) {
  let beste = null, kuerzeste = Infinity;
  document.querySelectorAll('.j-text table.j-table').forEach(table => {
    const r = table.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = Math.max(dx, dy);
    if (d <= KNOPF_NAEHE && d < kuerzeste) { kuerzeste = d; beste = table; }
  });
  return beste;
}

/* Die Maus: einmal je Bild nachsehen, nicht bei jeder Meldung */
let _knopfPunkt = null, _knopfPlan = 0;
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  _knopfPunkt = { x: e.clientX, y: e.clientY, ziel: e.target };
  if (_knopfPlan) return;
  _knopfPlan = requestAnimationFrame(() => {
    _knopfPlan = 0;
    const p = _knopfPunkt;
    if (!p) return;
    // Auf dem Knopf selbst: stehen lassen
    if (tblKnopf && p.ziel && tblKnopf.contains(p.ziel)) return;
    // Nur am Zeiger – beim Zeichnen wäre er ein Störenfried
    if (typeof S !== 'undefined' && S.mode !== 'cursor') { versteckeTabellenKnopf(); return; }
    // Über der Leiste oder einem Menü zählt die Tabelle darunter nicht
    const ueberSeite = p.ziel && p.ziel.closest && p.ziel.closest('#pg-scroll');
    const table = ueberSeite ? tabelleNahe(p.x, p.y) : null;
    if (table) zeigeTabellenKnopf(table);
    else versteckeTabellenKnopf();
  });
}, { passive: true });

/* Finger und Stift: wer die Tabelle antippt, bekommt den Knopf; wer
   woanders hin tippt, ist mit ihr fertig. */
document.addEventListener('pointerup', e => {
  if (e.pointerType === 'mouse') return;
  if (tblKnopf && tblKnopf.contains(e.target)) return;
  if (typeof S !== 'undefined' && S.mode !== 'cursor') return;
  const table = e.target && e.target.closest && e.target.closest('.j-text table.j-table');
  if (table) zeigeTabellenKnopf(table);
  else versteckeTabellenKnopf();
}, true);

document.addEventListener('scroll', () => {
  if (knopfTabelle) zeigeTabellenKnopf(knopfTabelle);
}, true);

window.versteckeTabellenKnopf = versteckeTabellenKnopf;

/* Wird die Seite neu aufgebaut (Abgleich, Seitenwechsel, Heftwechsel),
   zeigt _zelle auf eine Zelle, die es nicht mehr gibt. Die Leiste bliebe
   sonst stehen und haenge an einem Leichnam. */
/* Von aussen: core/dialogs.js nimmt sie beim Herabstufen auf „nur
   lesen" weg — dort bewegt sich die Schreibmarke nicht, und ohne
   diesen Griff bliebe die Leiste stehen. */
window.versteckeTableBar = versteckeTableBar;

window.versteckeTableBarWennWeg = function () {
  if (tblBar && tblBar._zelle && !tblBar._zelle.isConnected) versteckeTableBar();
  if (knopfTabelle && !knopfTabelle.isConnected) versteckeTabellenKnopf();
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTableHtml, TBL_MAX, TBL_GRID_MAX };
}
