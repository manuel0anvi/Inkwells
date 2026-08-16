'use strict';

/* ── TEXT RENDERING & EDITING ── */
function lhForBg(bg) { return (bg === 'grid' || bg === 'dots') ? 24 : 32; }
function ptForBg(bg) { return Math.round(lhForBg(bg) - 17 * .78); }
function rightPadForBg(bg) { return (bg === 'grid' || bg === 'dots' || bg === 'blank' || bg === 'craft') ? 72 : 32; }

function applyTextLayoutForBg(textDiv, bgId) {
  if (!textDiv) return;
  const lh = lhForBg(bgId);
  textDiv.style.lineHeight = lh + 'px';
  // Muss mitziehen: die Tabellenzellen haengen daran (css/pages.css)
  textDiv.style.setProperty('--lh', lh + 'px');
  textDiv.style.paddingTop = ptForBg(bgId) + 'px';
  textDiv.style.right = rightPadForBg(bgId) + 'px';
}

function approxCharWidth(textDiv) {
  const cs = getComputedStyle(textDiv);
  const c = document.createElement('canvas').getContext('2d');
  c.font = cs.font || (cs.fontStyle + ' ' + cs.fontVariant + ' ' + cs.fontWeight + ' ' + cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontFamily);
  return Math.max(2, c.measureText(' ').width || 4);
}

/**
 * Setzt die Schreibmarke auf einen Abstand in sichtbaren Zeichen.
 *
 * >>> Warum das nicht mehr nur den ersten Kindknoten ansieht <<<
 * Der Editor hält reinen Text, sobald nur getippt wurde – dann ist
 * textDiv.firstChild ein Textknoten und alles war einfach. Sobald aber
 * Absätze oder Auszeichnungen dazukommen, ist der erste Kindknoten ein
 * <p>, und setStart(p, 37) warf einen Fehler. In geteilten Dokumenten
 * fiel das auf: nach jeder fremden Änderung sprang die eigene Marke an
 * den Anfang, weil genau dieser Fehler dort still verschluckt wurde.
 * rangeForTextOffset kann beides – also darüber gehen.
 */
function setPlainCaret(textDiv, charIndex) {
  if (!textDiv.firstChild) textDiv.appendChild(document.createTextNode(''));

  const range = rangeForTextOffset(textDiv, Math.max(0, charIndex));
  if (!range) return;

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function getCaretTextOffset(rootEl) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!rootEl.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(rootEl);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/**
 * Umkehrung von getCaretTextOffset: findet zu einem Textabstand die
 * Stelle im DOM. Gebraucht für die Schreibmarken der anderen in einem
 * geteilten Dokument (ui/collab.js) – dort kommt nur eine Zahl an, und
 * daraus muss eine Bildschirmposition werden.
 *
 * @param {HTMLElement} rootEl
 * @param {number} offset Abstand in sichtbaren Zeichen
 * @returns {Range|null}
 */
function rangeForTextOffset(rootEl, offset) {
  if (!rootEl) return null;
  const target = Math.max(0, offset);

  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  let seen = 0;
  let node = walker.nextNode();
  let last = null;

  while (node) {
    const len = (node.nodeValue || '').length;
    if (seen + len >= target) {
      const range = document.createRange();
      range.setStart(node, target - seen);
      range.collapse(true);
      return range;
    }
    seen += len;
    last = node;
    node = walker.nextNode();
  }

  // Hinter dem Ende: ans letzte Zeichen setzen. Kommt vor, wenn der andere
  // gerade etwas gelöscht hat und die Meldung noch unterwegs war.
  if (last) {
    const range = document.createRange();
    range.setStart(last, (last.nodeValue || '').length);
    range.collapse(true);
    return range;
  }

  const range = document.createRange();
  range.selectNodeContents(rootEl);
  range.collapse(true);
  return range;
}

/* ══════════════════════════════════════════════════════════════════════
   FLACHER TEXT  ―  eine Position, die bei allen dasselbe bedeutet

   getCaretTextOffset zählt nur die Zeichen in den Textknoten. Damit ist
   eine Position an einer Zeilengrenze MEHRDEUTIG: bei
   <p>abc</p><p>def</p> ergibt „hinter c" und „vor d" beide Male die
   Zahl 3, und ein leerer Absatz dazwischen hat gar keine eigene Zahl.

   Für die eigene Schreibmarke reicht das – sie wird im selben DOM wieder
   gesetzt, da fällt es nicht auf. Für die Marke eines ANDEREN reicht es
   nicht: rangeForTextOffset nimmt bei Gleichstand immer das frühere
   Stück, die fremde Marke landete dadurch verlässlich eine Zeile zu
   hoch, am Ende der Zeile davor. Genau deshalb saß sie „nie richtig".

   Hier deshalb ein zweites Maß: der Inhalt als eine Zeichenkette, in der
   jede Zeilengrenze ein echtes \n ist – so, wie der Text auf dem Papier
   steht. Anfang und Ende einer Zeile sind damit verschiedene Zahlen, und
   eine leere Zeile hat ihre eigene. Dasselbe Maß trägt die Zeilensperre
   (ui/collab.js): „diese und die nächste Zeile" ist darin ein einfacher
   Bereich von–bis.

   Eine Zeile ist ein Block ohne weitere Blöcke darin (Absatz, Überschrift,
   Listenpunkt) bzw. der Abschnitt zwischen zwei <br>.

   >>> Warum auch VERSCHACHTELTE Blöcke zählen müssen <<<
   Früher wurde nur die oberste Ebene als Zeile genommen; alles tiefer
   Liegende lief durch dieselbe Schleife wie <b> oder <i>, also OHNE
   Umbruch. Aus <ul><li>Eins</li><li>Zwei</li></ul> wurde damit
   „EinsZwei" – auf dem Papier zwei Zeilen, in dieser Rechnung eine.

   Jeder so verlorene Umbruch macht die gemeldete Zahl KLEINER. Die Marke
   des anderen und sein Sperrband landeten dadurch um genau so viele
   Zeilen zu weit oben, und seitlich irgendwo – und zwar dauerhaft, nicht
   nur beim gleichzeitigen Tippen. Sichtbar wurde das an allem, was
   Blöcke ineinander legt: Listen, eingerückte Absätze (execCommand
   'indent' macht daraus ein <blockquote> um die Absätze herum),
   Tabellen, und die <div>-Verschachtelungen, die contenteditable beim
   Umformatieren selbst anlegt.
   ══════════════════════════════════════════════════════════════════════ */

/* Rückfall, wenn der Browser nicht gefragt werden kann – in den Tests
   gibt es kein getComputedStyle, und ein losgelöster Knoten hat noch
   keine Darstellung. Die Liste ist bewusst großzügig. */
const FLAT_BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'SECTION', 'FIGURE', 'TABLE', 'TR', 'HR',
  'DL', 'DT', 'DD', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'MAIN',
  'ADDRESS', 'FIGCAPTION', 'FIELDSET', 'FORM', 'CENTER', 'DETAILS', 'SUMMARY',
  'CAPTION', 'THEAD', 'TBODY', 'TFOOT'
]);

/* Was NICHT auf einer eigenen Zeile steht, obwohl es ein Element ist.
   Nach der Darstellung geurteilt, nicht nach dem Namen. Tabellenzellen
   gehören dazu: sie stehen nebeneinander, nicht untereinander. */
const FLAT_INLINE_DISPLAYS = new Set([
  'inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table',
  'contents', 'none', 'table-cell', 'table-column', 'table-column-group',
  'ruby', 'ruby-base', 'ruby-text', 'ruby-base-container', 'ruby-text-container'
]);

/**
 * Fängt dieses Element eine neue Zeile an?
 *
 * >>> Warum das nicht mehr an der Liste der Namen hängt <<<
 * Vorher entschied allein FLAT_BLOCK_TAGS darüber. Jedes Element, das
 * nicht darin stand, galt als inline – also als Teil derselben Zeile.
 * Auf dem Papier war es aber sehr wohl eine eigene Zeile, und genau um
 * diesen einen Umbruch war die gemeldete Zahl dann zu klein.
 *
 * Das trifft nicht etwa Ausgefallenes: `<dl>/<dt>/<dd>` kommt aus Word,
 * `<article>/<header>/<address>` aus jeder Webseite, und Google Docs
 * fügt `<span style="display:block">` ein. Nach einem einzigen solchen
 * Einfügen sitzt jede fremde Schreibmarke unterhalb davon eine Zeile
 * daneben – und das Sperrband mit ihr, denn es rechnet aus derselben
 * Zahl. Dauerhaft, nicht nur beim gleichzeitigen Tippen.
 *
 * Gefragt wird deshalb der Browser: er weiß, was er umbricht. Nur wenn
 * es ihn nicht gibt (Tests, loser Knoten), zählt wieder die Namensliste.
 */
function istFlatBlockEl(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  if (node.tagName === 'BR') return false;

  if (typeof getComputedStyle === 'function') {
    let display = '';
    try { display = getComputedStyle(node).display || ''; } catch (err) { display = ''; }
    if (display) return !FLAT_INLINE_DISPLAYS.has(display);
  }
  return FLAT_BLOCK_TAGS.has(node.tagName);
}

/**
 * Zerlegt den Inhalt in Textstücke und Zeilengrenzen – in Lesereihenfolge.
 *
 * @returns {{text: string, parts: Array<object>}}
 *   text  der Inhalt mit \n an jeder Zeilengrenze
 *   parts Ankerpunkte: {type:'text', node, at, len} für Textknoten,
 *         {type:'empty', host, at} für eine leere Zeile (dort gibt es
 *         keinen Textknoten, auf den man zeigen könnte).
 */
function flatTextParts(root) {
  const parts = [];
  let text = '';

  const addText = (node) => {
    const value = node.nodeValue || '';
    if (!value.length) return;
    parts.push({ type: 'text', node, at: text.length, len: value.length });
    text += value;
  };

  const addBreak = () => { text += '\n'; };

  /* Je Knoten einmal nachsehen: istHuelle fragt alle Kinder ab, und
     gleich darauf wird jedes davon noch einmal geprüft. */
  const gemerkt = new Map();
  const istBlock = (node) => {
    if (gemerkt.has(node)) return gemerkt.get(node);
    const wert = istFlatBlockEl(node);
    gemerkt.set(node, wert);
    return wert;
  };

  /* Ein Block, in dem WEITERE Blöcke stecken, ist keine Zeile, sondern
     bloß die Hülle darum – <ul> um seine <li>, <blockquote> um seine
     Absätze. Die Zeilen sind die Blöcke darin. Ohne diese Unterscheidung
     bekäme die Hülle einen Umbruch und ihr erstes Kind gleich noch
     einen: eine Leerzeile, die niemand sieht. */
  const istHuelle = (el) => {
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) if (istBlock(kids[i])) return true;
    return false;
  };

  /* Steht nach diesem <br> im ganzen Block nichts mehr, ist es der
     Platzhalter, den contenteditable für eine leere Zeile setzt – und
     kein eigener Umbruch. Sonst zählte jede leere Zeile doppelt.
     Geprüft wird bis zum Block hinauf und nicht nur beim unmittelbaren
     Elternteil: in <p>abc<b>def<br></b></p> ist das <br> zwar letztes
     Kind des <b>, aber eben auch letztes im Absatz. */
  const letztesImBlock = (node, block) => {
    let cur = node;
    while (cur && cur !== block) {
      if (cur.nextSibling) return false;
      cur = cur.parentNode;
    }
    return true;
  };

  let started = false;

  const walk = (el, block) => {
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];

      if (child.nodeType === Node.TEXT_NODE) {
        addText(child);
        if (child.nodeValue) started = true;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.tagName === 'STYLE' || child.tagName === 'SCRIPT') continue;

      if (child.tagName === 'BR') {
        if (letztesImBlock(child, block)) continue;
        addBreak();
        started = true;
        continue;
      }

      if (istBlock(child)) {
        if (istHuelle(child)) { walk(child, block); continue; }

        if (started) addBreak();
        const before = text.length;
        walk(child, child);
        // Nichts herausgekommen? Dann ist das eine leere Zeile, und die
        // braucht trotzdem einen Anker – sonst ist sie nicht ansteuerbar.
        if (text.length === before) parts.push({ type: 'empty', host: child, at: before });
        started = true;
        continue;
      }

      walk(child, block);   // <b>, <i>, <span> … – bleibt in derselben Zeile
    }
  };

  walk(root, root);
  return { text, parts };
}

/** Nur der flache Text – für Zeilengrenzen und die Sperre. */
function flatTextOf(root) {
  return root ? flatTextParts(root).text : '';
}

/**
 * Wo steht die Schreibmarke im flachen Text?
 * @returns {number|null} null, wenn sie gar nicht in diesem Feld steht.
 */
function flatCaretPos(root) {
  if (!root) return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  return flatPosOfPoint(root, range.startContainer, range.startOffset);
}

/** Umrechnung DOM-Punkt → Position im flachen Text. */
function flatPosOfPoint(root, container, offset) {
  const info = flatTextParts(root);

  if (container.nodeType === Node.TEXT_NODE) {
    for (const part of info.parts) {
      if (part.type === 'text' && part.node === container) {
        return part.at + Math.max(0, Math.min(offset, part.len));
      }
    }
  }

  /* Der Punkt steht in einem Element – eine leere Zeile, oder zwischen
     zwei Kindknoten. Dann das erste Stück suchen, das im Dokument NICHT
     vor ihm liegt; dessen Anfang ist die gesuchte Stelle. */
  let probe;
  try {
    probe = document.createRange();
    probe.setStart(container, offset);
    probe.collapse(true);
  } catch (err) { return null; }

  for (const part of info.parts) {
    const at = document.createRange();
    if (part.type === 'text') at.setStart(part.node, 0);
    else at.selectNodeContents(part.host);
    at.collapse(true);
    if (probe.compareBoundaryPoints(Range.START_TO_START, at) <= 0) return part.at;
  }
  return info.text.length;
}

/**
 * Umkehrung: zu einer Position im flachen Text die Stelle im DOM.
 * @returns {Range|null}
 */
function flatRangeAt(root, pos) {
  if (!root) return null;
  const info = flatTextParts(root);
  const target = Math.max(0, Math.min(Number(pos) || 0, info.text.length));
  const range = document.createRange();

  /* Die Position liegt IN einem Stück: Anfang eingeschlossen, Ende
     ausgeschlossen. Dadurch gewinnt am Zeilenanfang die neue Zeile –
     genau der Fall, an dem die alte Umrechnung scheiterte. */
  for (const part of info.parts) {
    if (part.type === 'text' && target >= part.at && target < part.at + part.len) {
      range.setStart(part.node, target - part.at);
      range.collapse(true);
      return range;
    }
    if (part.type === 'empty' && part.at === target) {
      range.selectNodeContents(part.host);
      range.collapse(true);
      return range;
    }
  }

  // Zeilenende oder Textende: ans Ende des letzten Stücks davor
  let best = null;
  for (const part of info.parts) {
    const end = part.type === 'text' ? part.at + part.len : part.at;
    if (end <= target) best = part;
  }
  if (best && best.type === 'text') {
    range.setStart(best.node, best.len);
    range.collapse(true);
    return range;
  }
  if (best && best.type === 'empty') {
    range.selectNodeContents(best.host);
    range.collapse(true);
    return range;
  }

  range.selectNodeContents(root);
  range.collapse(true);
  return range;
}

/** Setzt die eigene Schreibmarke auf eine Position im flachen Text. */
function setFlatCaret(root, pos) {
  const range = flatRangeAt(root, pos);
  if (!range) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

/** Rechteck eines Zeichenbereichs; `kante` sagt, welche Seite gilt. */
function rectOfSpan(textDiv, von, bis, kante) {
  const a = flatRangeAt(textDiv, von);
  const b = flatRangeAt(textDiv, bis);
  if (!a || !b) return null;

  const span = document.createRange();
  try {
    span.setStart(a.startContainer, a.startOffset);
    span.setEnd(b.startContainer, b.startOffset);
  } catch (err) { return null; }

  const rects = span.getClientRects();
  if (!rects || !rects.length) return null;

  const r = kante === 'links' ? rects[0] : rects[rects.length - 1];
  if (!r || (!r.height && !r.width)) return null;
  return new DOMRect(kante === 'links' ? r.left : r.right, r.top, 0, r.height);
}

/**
 * Das Rechteck einer LEEREN Zeile im reinen Text.
 *
 * >>> Der Fall, an dem die fremde Marke nach oben links sprang <<<
 * Sobald nur getippt wurde, hält dieser Editor die ganze Seite als EINEN
 * Textknoten mit echten \n und white-space:pre-wrap – Absätze gibt es
 * dann keine. Eine leere Zeile hat damit kein eigenes Element, an dem
 * man messen könnte: flatRangeAt landet in diesem einen Textknoten, und
 * „das umgebende Element" ist das ganze Textfeld. Dessen Rechteck ist
 * die halbe Seite, nicht die Zeile. Die fremde Marke saß deshalb oben
 * links in der Ecke – und schlimmer: visualLineSpan (ui/collab.js)
 * rechnet aus genau diesem Rechteck aus, welche Zeilen gesperrt werden,
 * und legte das Band dadurch auf eine ganz andere Zeile.
 *
 * Ausgelöst wird das vom häufigsten Handgriff überhaupt: einmal Enter am
 * Textende, und schon steht die Marke auf einer leeren Zeile.
 *
 * Messbar ist stattdessen das letzte Zeichen davor, das kein Umbruch
 * ist. Zwischen ihm und der gesuchten Stelle stehen nur noch Umbrüche,
 * und jeder davon ist genau eine Bildschirmzeile tiefer – eine leere
 * Zeile kann nicht umbrechen, da ist ja nichts, was umbrechen könnte.
 *
 * @param {number} lh   Zeilenhöhe in BILDSCHIRM-Pixeln (mit Zoom)
 * @param {number} zoom
 */
function emptyLineRectAt(textDiv, inhalt, stelle, lh, zoom) {
  if (typeof textDiv.getBoundingClientRect !== 'function') return null;
  const feld = textDiv.getBoundingClientRect();

  // Wie viele Umbrüche liegen zwischen dem letzten Zeichen und hier?
  let i = stelle - 1;
  let tiefer = 0;
  while (i >= 0 && inhalt[i] === '\n') { tiefer++; i--; }

  if (i >= 0) {
    const davor = rectOfSpan(textDiv, i, i + 1, 'links');
    if (davor) return new DOMRect(feld.left, davor.top + tiefer * lh, 0, davor.height);
  }

  /* Nichts Messbares davor – die Seite fängt mit leeren Zeilen an oder
     ist ganz leer. Dann vom oberen Rand des Textbereichs aus zählen. */
  const cs = (typeof getComputedStyle === 'function') ? getComputedStyle(textDiv) : null;
  const oben = feld.top + (parseFloat(cs && cs.paddingTop) || 0) * zoom;
  return new DOMRect(feld.left, oben + tiefer * lh, 0, lh);
}

function caretRectAt(textDiv, pos, text) {
  const inhalt = (typeof text === 'string') ? text : flatTextOf(textDiv);
  const stelle = Math.max(0, Math.min(Number(pos) || 0, inhalt.length));

  /* Steht hinter der Stelle noch ein Zeichen DERSELBEN Zeile, gilt
     dessen linke Kante – dort erscheint auch das nächste Getippte. */
  if (stelle < inhalt.length && inhalt[stelle] !== '\n') {
    const r = rectOfSpan(textDiv, stelle, stelle + 1, 'links');
    if (r) return r;
  }

  // Am Zeilenende: hinter das Zeichen davor
  if (stelle > 0 && inhalt[stelle - 1] !== '\n') {
    const r = rectOfSpan(textDiv, stelle - 1, stelle, 'rechts');
    if (r) return r;
  }

  const zoom = (typeof getZoom === 'function') ? getZoom() : 1;
  const lh = (parseInt(textDiv.style.lineHeight) || 24) * zoom;

  /* Leere Zeile – es gibt kein Zeichen, an dem man sich festhalten
     könnte. Dann das umgebende Element; das IST hier die Zeile. */
  const range = flatRangeAt(textDiv, stelle);
  const host = range && (range.startContainer.nodeType === 1
    ? range.startContainer
    : range.startContainer.parentElement);

  /* Ist das „umgebende Element" das Textfeld selbst, gibt es keinen
     Absatz, der die Zeile wäre – siehe emptyLineRectAt. */
  if (!host || host === textDiv) {
    return emptyLineRectAt(textDiv, inhalt, stelle, lh, zoom);
  }
  if (typeof host.getBoundingClientRect !== 'function') return null;

  const box = host.getBoundingClientRect();
  if (!box.height && !box.width) return null;
  return new DOMRect(box.left, box.top, 0, Math.min(box.height || lh, lh));
}

/**
 * Rechnet ein gemessenes Rechteck auf die ZEILE um, in der es liegt –
 * in den Maßen der Seite, also ohne Zoom.
 *
 * >>> Warum nicht einfach rect.top nehmen <<<
 * Was getClientRects() für Text liefert, ist von Fall zu Fall
 * verschieden: mal das Kästchen der Buchstaben (bei Zeilenhöhe 32 und
 * Schriftgröße 17 nur rund 21 px hoch, mittig in der Zeile), mal die
 * ganze Zeile. Wer die Oberkante davon nimmt, sitzt im einen Fall 5 px
 * zu tief und im anderen 7 px zu hoch – und genau so sah es aus.
 *
 * Verlässlich ist dagegen die MITTE: sie ist in beiden Fällen dieselbe,
 * weil der Zeilendurchschuss gleichmäßig über und unter den Buchstaben
 * liegt. Von dort aus eine volle Zeilenhöhe – das deckt sich mit dem
 * Linienraster des Papiers.
 */
function lineBoxOf(pgEl, textDiv, rect, zoom) {
  const lh = parseInt(textDiv.style.lineHeight) || 32;
  const pageRect = pgEl.getBoundingClientRect();
  const links = (rect.left - pageRect.left) / zoom;

  /* >>> Kein Raster, sondern die Mitte – und warum das der Umweg wert war <<<
     Zwei Anläufe haben hier danebengelegen, beide gemeldet:

       1. Nur die Oberkante nehmen. Was getClientRects() liefert, ist mal
          das Kästchen der Buchstaben (bei Zeilenhöhe 32 und Schriftgröße
          17 rund 21 px, mittig in der Zeile), mal die ganze Zeile – die
          Oberkante bedeutet also nicht immer dasselbe.
       2. Auf ein Raster von Zeilenhöhen runden. Das Raster müsste dafür
          überall gelten, und das tut es nicht: eine Überschrift ist
          32,8 px hoch statt 32, und ab ihr ist jede Zeile darunter ein
          Stück verschoben. Genau das war „die Zeilen sind teilweise
          richtig, teilweise ein bisschen zu weit oben".

     Verlässlich ist die MITTE des gemessenen Rechtecks: der
     Zeilendurchschuss liegt gleichmäßig über und unter den Buchstaben,
     die Mitte des Kästchens ist also auch die Mitte der Zeile – ganz
     gleich, wo diese Zeile sitzt und wie hoch ihr Absatz ist. Von dort
     aus eine halbe Zeilenhöhe nach oben.

     Der Sonderfall, der den Rasterversuch ausgelöst hat: ein Rechteck
     OHNE Höhe. Eine Mitte gibt es dann nicht, und die alte Rechnung legte
     das Band eine Zeile zu hoch. Dafür steht die Abfrage darunter –
     ohne Höhe zählt die Oberkante unverändert. */
  if (!rect.height) {
    return { top: (rect.top - pageRect.top) / zoom, height: lh, left: links };
  }

  const mitte = (rect.top + rect.height / 2 - pageRect.top) / zoom;
  return { top: mitte - lh / 2, height: lh, left: links };
}

/* ══════════════════════════════════════════════════════════════════════
   Meldet, dass die Texte auseinanderlaufen – aber nur, wenn es etwas
   bedeutet.

   >>> Warum die Meldung so oft kam, ohne dass etwas kaputt war <<<
   Sie schlug bei JEDEM Vorsprung an. Zwei davon sind aber der
   Normalbetrieb und gehen von selbst vorbei:

     · Der andere tippt. Seine Stelle kommt über die Anwesenheit alle
       150 ms, sein Text über den Änderungsstrom alle 300 ms – die Stelle
       ist also regelmäßig ein paar Zeichen weiter als der Text hier.
       Beim nächsten Paket stimmt es wieder.
     · Die Seite ist hier noch leer. Dann ist ihr Inhalt schlicht noch
       nicht angekommen (frisch angelegt, gerade erst geöffnet). Über
       einen Versatz zu klagen, wenn es noch gar keinen Text gibt, sagt
       niemandem etwas.

   Gemeldet wird deshalb nur ein Vorsprung, der GROSS ist und BLEIBT.
   ══════════════════════════════════════════════════════════════════════ */

// So weit darf die Stelle vorauseilen, ohne dass es der Rede wert ist
const VERSATZ_TOLERANZ = 40;
// Und so lange muss es schon so stehen
const VERSATZ_DAUER_MS = 3000;

let letzterVersatz = 0;
const versatzSeit = new Map();      // uid -> seit wann es klemmt

function meldeVersatz(person, laenge) {
  const uid = person && person.uid ? person.uid : '?';

  // Noch gar kein Text hier: die Seite ist einfach noch nicht da
  if (!laenge) { versatzSeit.delete(uid); return; }

  const vorsprung = (Number(person.offset) || 0) - laenge;
  if (vorsprung <= VERSATZ_TOLERANZ) { versatzSeit.delete(uid); return; }

  const jetzt = Date.now();
  const seit = versatzSeit.get(uid);
  if (!seit) { versatzSeit.set(uid, jetzt); return; }
  if (jetzt - seit < VERSATZ_DAUER_MS) return;

  if (jetzt - letzterVersatz < 5000) return;
  letzterVersatz = jetzt;
  console.warn('[Collab] Die Fassungen laufen auseinander: '
    + (person.name || person.email || '?') + ' meldet Stelle ' + person.offset
    + ', hier ist der Text aber nur ' + laenge + ' Zeichen lang – und das '
    + 'seit ' + Math.round((jetzt - seit) / 1000) + ' Sekunden. '
    + 'Die fremde Schreibmarke kann dadurch nicht richtig sitzen.');
}

/**
 * Die Zeile an dieser Stelle – und die darauf folgenden.
 *
 * @param {string} text        flacher Text
 * @param {number} pos
 * @param {number} [extraLines=1] wie viele Zeilen danach noch dazugehören
 * @returns {{from:number, to:number}} to ist ausschließlich
 */
function flatLineSpan(text, pos, extraLines = 1) {
  const content = String(text || '');
  const at = Math.max(0, Math.min(Number(pos) || 0, content.length));
  const from = content.lastIndexOf('\n', at - 1) + 1;

  let end = content.indexOf('\n', at);
  if (end === -1) return { from, to: content.length };

  for (let i = 0; i < extraLines; i++) {
    const next = content.indexOf('\n', end + 1);
    if (next === -1) { end = content.length; break; }
    end = next;
  }
  return { from, to: end };
}

function getRenderedContentBottom(textDiv, top, pt, lh) {
  if (!textDiv) return top + pt + lh;
  const range = document.createRange();
  range.selectNodeContents(textDiv);
  const rects = range.getClientRects();
  if (!rects || !rects.length) return top + pt + lh;
  
  let bottom = top + pt + lh;
  for (const rc of rects) {
    if (Number.isFinite(rc.bottom)) bottom = Math.max(bottom, rc.bottom);
  }
  return bottom;
}

/* ══════════════════════════════════════════════════════════════════════
   ABSTAND STATT LEERZEICHEN

   Wer in einem Heft irgendwohin tippt und dort zu schreiben anfängt,
   soll das können – das ist der Kern von Inkwell. Bis hierher wurde der
   Weg dorthin mit ECHTEN ZEICHEN aufgefüllt: Zeilenumbrüche nach unten,
   Leerzeichen nach rechts. Das hatte Folgen, die niemand wollte:

     · Die Leerzeichen sind Inhalt. Sie zählen im Wortzähler, stehen im
       Word-Export, findet die Suche, und der Live-Abgleich schickt sie
       an alle anderen.
     · Eine Proportionalschrift hat ungleich breite Zeichen. Vierzig
       Leerzeichen sind nie genau die Stelle, auf die man gezeigt hat –
       der Text sass immer ein Stück daneben.
     · Wer davor etwas ändert, verschiebt alles dahinter. Und
       wegzubekommen war der Block nur mit vierzig Rückschritten.
     · Eine Seite bestand dadurch oft aus EINER sehr langen Zeile, die
       bloss umbricht. Die Zeilensperre der Live-Zusammenarbeit ist
       daran schon einmal gescheitert (ui/collab.js, visualLineSpan).

   Der Abstand ist jetzt eine EIGENSCHAFT und kein Inhalt:

     nach unten    margin-top am Block, auf ganze Zeilenhöhen gerundet,
                   damit der Text auf den Linien des Papiers sitzt
     nach rechts   margin-left am Block – wenn die Zeile neu ist
     mitten drin   ein leerer Abstandshalter <span class="j-luecke">,
                   wenn rechts neben schon geschriebenem Text geklickt
                   wird. Ein Element statt vierzig Zeichen: ein
                   Rückschritt nimmt ihn weg, und im Text steht nichts.

   Gehalten wird beides als geprüfter Zahlenwert im style-Attribut;
   core/sanitize.js lässt genau margin-left, margin-top und die Breite
   des Abstandshalters durch und wirft alles andere weg. core/docx.js
   schreibt daraus beim Ausgeben echte Word-Einzüge – das ist treuer als
   die Leerzeichen es je waren.
   ══════════════════════════════════════════════════════════════════════ */

/* Weiter als das wird nicht eingerückt. Eine A4-Seite ist keine 2000 px
   breit; die Grenze ist gegen Unsinn da, nicht gegen den Nutzer. */
const MAX_ABSTAND_PX = 2000;

function _abstandWert(px) {
  return Math.max(0, Math.min(MAX_ABSTAND_PX, Math.round(px)));
}

/**
 * Ein leerer Absatz, der an der gewünschten Stelle beginnt.
 *
 * @param {number} linksPx  Einzug von links, in Seiten-Pixeln
 * @param {number} obenPx   Abstand nach oben, in Seiten-Pixeln
 */
function _neuerAbsatz(linksPx = 0, obenPx = 0) {
  const p = document.createElement('p');
  /* Ein <br> muss hinein: ein leerer Absatz hat sonst keine Höhe, und
     die Schreibmarke findet in ihm keinen Platz. */
  p.appendChild(document.createElement('br'));
  const links = _abstandWert(linksPx);
  const oben = _abstandWert(obenPx);
  if (links > 0) p.style.marginLeft = links + 'px';
  if (oben > 0) p.style.marginTop = oben + 'px';
  return p;
}

/**
 * Der Abstandshalter für die Mitte einer Zeile.
 *
 * >>> Warum ein Element und keine Leerzeichen <<<
 * Weil er keiner ist: er trägt keinen Text, nur eine Breite. Der
 * Wortzähler sieht nichts, die Suche findet nichts, ein einziger
 * Rückschritt nimmt ihn weg – und er ist genau so breit, wie er sein
 * soll, statt „ungefähr vierzig Leerzeichen".
 */
function _neueLuecke(breitePx) {
  const s = document.createElement('span');
  s.className = 'j-luecke';
  s.style.width = _abstandWert(breitePx) + 'px';

  /* ── Er ist ein STÜCK, kein Ort zum Schreiben ─────────────────────
     Ohne das landete das Getippte IM Halter: „nach dem Element" ist für
     Chromium dieselbe Stelle wie „am Ende des Elements", solange nichts
     dahinter steht. Der Text sass dann in einem 183 px breiten Kasten
     statt dahinter.

     Nicht bearbeitbar heisst: der Halter ist ein Ding, keine Textstelle.
     Die Marke kann davor und dahinter stehen, aber nicht darin, und ein
     einziger Rückschritt nimmt ihn ganz weg. Genau so soll er sich
     anfühlen – wie ein Abstand, nicht wie vierzig Leerzeichen.
     core/sanitize.js lässt das Attribut deshalb an ihm stehen. */
  s.setAttribute('contenteditable', 'false');

  /* ── Warum ein Zeichen darin steht ────────────────────────────────
     Ein LEERES inline-Element überlebt in contenteditable nicht: sobald
     daneben getippt wird, räumt Chromium es als „leere Auszeichnung"
     weg. Gemessen: der Halter war nach dem ersten Buchstaben spurlos
     verschwunden und der Text stand wieder ganz links.

     Deshalb ein Nullbreiten-Leerzeichen. Es ist unsichtbar, EIN Zeichen
     statt vierzig, und es hält den Halter am Leben. Wo es stört, wird es
     ausdrücklich weggerechnet – der Wortzähler und der Word-Export tun
     das (ui/wordCount.js, core/docx.js). */
  s.appendChild(document.createTextNode(LUECKEN_ZEICHEN));
  return s;
}

/* Ausdrücklich als Fluchtfolge und nicht als Zeichen: es ist unsichtbar,
   und ein unsichtbares Zeichen im Quelltext ist eine Falle für jeden,
   der die Zeile später anfasst. */
const LUECKEN_ZEICHEN = '\u200b';

/* ══════════════════════════════════════════════════════════════════════
   WAS EIN BLOSSER KLICK HINTERLÄSST: NICHTS

   Ein Klick ins Leere legt einen Absatz an, damit die Schreibmarke
   irgendwo stehen kann. Wer sich verklickt und woandershin klickt, hätte
   damit einen leeren Absatz im Heft – und im geteilten Dokument bekämen
   ihn alle anderen mit.

   Deshalb gilt das Angelegte als VORLÄUFIG, bis wirklich etwas
   geschrieben wird. Beim nächsten Setzen der Marke und beim Verlassen
   des Feldes wird es wieder weggeräumt; der erste Anschlag macht es
   endgültig (app.js meldet das über markiereBleibend).

   Die Markierung steht in einer Eigenschaft am Element und nicht als
   Attribut: sie soll nie in page.textContent landen.
   ══════════════════════════════════════════════════════════════════════ */
const VORLAEUFIG = '_inkwellVorlaeufig';

/** Das vorläufig Angelegte wieder wegnehmen – falls es noch leer ist. */
function raeumeVorlaeufiges(textDiv, ausser) {
  if (!textDiv || !textDiv.querySelectorAll) return;
  for (const el of [...textDiv.querySelectorAll('p, span.j-luecke')]) {
    if (!el[VORLAEUFIG] || el === ausser) continue;
    /* Steht inzwischen etwas darin, bleibt es: dann war es kein blosser
       Klick mehr. Ein <br> allein zählt nicht als Inhalt. */
    if (el.tagName === 'P' && (el.textContent || '').trim()) { el[VORLAEUFIG] = false; continue; }
    el.remove();
  }
}

/** Der erste Anschlag macht aus „vorläufig" „bleibend". */
function markiereBleibend(textDiv) {
  if (!textDiv || !textDiv.querySelectorAll) return;
  for (const el of textDiv.querySelectorAll('p, span.j-luecke')) el[VORLAEUFIG] = false;
}

function _setRangeEndOfNode(range, node) {
  if (node.lastChild && node.lastChild.nodeType === Node.TEXT_NODE) {
    range.setStart(node.lastChild, node.lastChild.nodeValue.length);
  } else {
    range.selectNodeContents(node);
  }
  range.collapse(true);
}

function placeCaretAnywhere(textDiv, clientX, clientY, forceManual = false, page = null) {
  if (!textDiv) return;
  let didPad = false;
  /* Was der vorige Klick angelegt und niemand beschrieben hat, gehört
     weg, bevor der nächste etwas Neues anlegt (siehe VORLAEUFIG). */
  raeumeVorlaeufiges(textDiv);
  textDiv.focus();
  const r = textDiv.getBoundingClientRect();
  const cs = getComputedStyle(textDiv);
  const scaleX = textDiv.offsetWidth > 0 ? (r.width / textDiv.offsetWidth) : 1;
  const scaleY = textDiv.offsetHeight > 0 ? (r.height / textDiv.offsetHeight) : 1;
  const lh = (parseFloat(cs.lineHeight) || 32) * scaleY;
  const cw = approxCharWidth(textDiv) * scaleX;
  const pt = (parseFloat(cs.paddingTop) || 0) * scaleY;

  if (!isPlainTextEditable(textDiv)) {
    let range = null;
    const isInside = node => !!node && (node === textDiv || textDiv.contains(node));
    const blocks = [...textDiv.children].filter(el => el.nodeType === Node.ELEMENT_NODE);
    const lastRect = blocks.length ? blocks[blocks.length - 1].getBoundingClientRect() : null;
    const clickedClearlyBelow = !!lastRect && clientY > (lastRect.bottom + Math.max(4, lh * 0.2));

    if (!clickedClearlyBelow) {
      const pos = document.caretPositionFromPoint?.(clientX, clientY);
      const rPoint = document.caretRangeFromPoint?.(clientX, clientY);
      if (pos && isInside(pos.offsetNode)) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      } else if (rPoint && isInside(rPoint.startContainer)) {
        range = rPoint;
        range.collapse(true);
      }
    }

    if (range) {
      if (range.startContainer === textDiv) {
        const targetBlock = textDiv.childNodes[Math.min(range.startOffset, textDiv.childNodes.length - 1)];
        if (targetBlock && targetBlock.nodeType === Node.ELEMENT_NODE) {
          range.selectNodeContents(targetBlock);
          range.collapse(false);
        }
      }

      if (forceManual) {
        const block = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
        if (block?.nodeType === Node.ELEMENT_NODE && block !== textDiv) {
          const rect = block.getBoundingClientRect();
          if (clientY > rect.bottom + 4 || clientY < rect.top - 4) range = null;
        }
      }

      if (range) {
        let lineEndX = r.left;
        const ctrs = range.getClientRects();
        if (ctrs.length > 0 && ctrs[0].right > 0) lineEndX = ctrs[0].right;
        else if (range.getBoundingClientRect()?.right > 0) lineEndX = range.getBoundingClientRect().right;

        /* Rechts neben schon geschriebenem Text: ein Abstandshalter, kein
           Leerzeichenblock. Er trägt nur eine Breite, und die stimmt
           genau – anders als „ungefähr vierzig Leerzeichen" in einer
           Schrift mit ungleich breiten Zeichen. */
        if (clientX > lineEndX + cw * 0.7) {
          const halter = _neueLuecke((clientX - lineEndX) / Math.max(0.01, scaleX));
          halter[VORLAEUFIG] = true;
          range.insertNode(halter);
          // Die Marke gehört HINTER den Halter, sonst tippt man davor
          range.setStartAfter(halter);
          range.collapse(true);
          didPad = true;
        }
      }
    }

    if (!range && forceManual) {
      /* Der Einzug rechnet in Seiten-Pixeln, nicht in Bildschirm-Pixeln:
         die Seite ist gezoomt, der gespeicherte Wert darf das nicht sein. */
      const linksPx = Math.max(0, (clientX - r.left) / Math.max(0.01, scaleX));

      if (clickedClearlyBelow && blocks.length) {
        const pxBelow = Math.max(0, clientY - blocks[blocks.length - 1].getBoundingClientRect().bottom);
        /* Auf ganze Zeilenhöhen gerundet, sonst sässe der Text zwischen
           den Linien des Papiers. Genau das taten die leeren Absätze von
           selbst, die hier vorher entstanden – nur brauchte es dafür bis
           zu vierzig davon. */
        const zeilen = Math.min(40, Math.max(0, Math.round(pxBelow / Math.max(12, lh))));
        const neu = _neuerAbsatz(linksPx, zeilen * lh / Math.max(0.01, scaleY));
        neu[VORLAEUFIG] = true;
        textDiv.appendChild(neu);
        didPad = true;
        range = document.createRange();
        _setRangeEndOfNode(range, neu);
      } else {
        const block = blocks.find(c => clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height * 0.5) || blocks[blocks.length - 1];
        const neu = _neuerAbsatz(linksPx, 0);
        neu[VORLAEUFIG] = true;
        didPad = true;
        if (block) {
          if (clientY >= (block.getBoundingClientRect().top + block.getBoundingClientRect().height * 0.5)) block.insertAdjacentElement('afterend', neu);
          else block.insertAdjacentElement('beforebegin', neu);
        } else {
          textDiv.appendChild(neu);
        }
        range = document.createRange();
        _setRangeEndOfNode(range, neu);
      }
    }

    if (!range) {
      range = document.createRange();
      range.selectNodeContents(textDiv);
      range.collapse(false);
    }

    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    return didPad;
  }

  // Handle plain text mode
  const targetLine = Math.max(0, Math.floor((clientY - r.top - pt) / lh));
  let targetCol = Math.max(0, Math.floor((clientX - r.left) / cw));
  const nearLeftEdge = (clientX - r.left) <= Math.max(14, cw * 2.0);
  if (nearLeftEdge) targetCol = 0;

  const rawText = (textDiv.innerText || textDiv.textContent || '').replace(/\r/g, '');
  const lines = rawText.length ? rawText.split('\n') : [''];
  const isExistingLine = targetLine < lines.length;
  const colAnchor = (!forceManual && Number.isFinite(textDiv._colAnchor)) ? textDiv._colAnchor : null;

  if (nearLeftEdge && isExistingLine) {
    let idx = 0;
    for (let i = 0; i < targetLine; i++) idx += (lines[i]?.length || 0) + 1;
    setPlainCaret(textDiv, idx);
    textDiv._colAnchor = 0;
    return false;
  }

  if (!forceManual && isExistingLine && lines[targetLine].length > 0) {
    const farRight = clientX > (r.left + (lines[targetLine].length * cw) + cw * 0.7);
    if (!farRight) {
      const selPlain = window.getSelection();
      const pos = document.caretPositionFromPoint?.(clientX, clientY) || document.caretRangeFromPoint?.(clientX, clientY);
      const node = pos?.offsetNode || pos?.startContainer;
      
      if (pos && node && (node === textDiv || textDiv.contains(node)) && selPlain) {
        const range = document.createRange();
        range.setStart(node, pos.offset ?? pos.startOffset);
        range.collapse(true);
        selPlain.removeAllRanges();  
        selPlain.addRange(range);
        
        const caret = getCaretTextOffset(textDiv);
        if (caret !== null) {
          textDiv._colAnchor = Math.max(0, caret - (rawText.lastIndexOf('\n', Math.max(0, caret - 1)) + 1));
        }
        return false;
      }
    }
  }

  if (colAnchor !== null && Math.abs(targetCol - colAnchor) <= 2) targetCol = colAnchor;

  /* ══════════════════════════════════════════════════════════════════
     AUCH AUF EINER REINEN TEXTSEITE: ABSTAND STATT LEERZEICHEN

     Hier standen zwei Schleifen: leere Zeilen anhängen, bis die geklickte
     Zeile existiert, und dann Leerzeichen, bis die Spalte stimmt. Genau
     das ist die gemeldete Sache.

     Eine reine Textseite (nur Textknoten und <br>) hat aber gar nichts,
     woran ein Einzug hängen könnte. Deshalb bekommt sie an dieser Stelle
     ihren ersten Absatz – und zwar NUR sie, der vorhandene Text bleibt
     unangetastet. Die Seite ist damit von da an eine gewöhnliche
     Absatzseite, und das ist sie ohnehin, sobald jemand eine Überschrift
     oder eine Aufzählung benutzt.

     Umgebaut wird nur, wenn wirklich aufgefüllt werden müsste. Wer in
     vorhandenen Text klickt, merkt von alldem nichts – dieser Zweig wird
     dann gar nicht erreicht (siehe die beiden Rückgaben oben).
     ══════════════════════════════════════════════════════════════════ */
  const brauchtZeilen = targetLine >= lines.length;
  const brauchtSpalten = (lines[targetLine] || '').length < targetCol;

  let zeilenAnfang = 0;
  for (let i = 0; i < Math.min(targetLine, lines.length); i++) zeilenAnfang += lines[i].length + 1;

  /* ── Unter allem, was schon dasteht ────────────────────────────────
     Ein neuer Absatz mit Abstand nach oben und nach links. Er ist der
     erste Block dieser Seite; der vorhandene Text bleibt unangetastet. */
  if (brauchtZeilen) {
    const linksPx = Math.max(0, (clientX - r.left) / Math.max(0.01, scaleX));
    /* Wie weit unter dem vorhandenen Text? In ganzen Zeilen, damit der
       Text auf den Linien des Papiers sitzt. */
    const zeilenDrunter = Math.max(0, targetLine - lines.length + (rawText.length ? 0 : 1));
    const neu = _neuerAbsatz(linksPx, zeilenDrunter * lh / Math.max(0.01, scaleY));
    neu[VORLAEUFIG] = true;
    textDiv.appendChild(neu);

    const range = document.createRange();
    _setRangeEndOfNode(range, neu);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    textDiv._colAnchor = targetCol;
    return true;
  }

  /* ── Rechts neben eine Zeile, die es schon gibt ────────────────────
     Hier half kein Einzug: der Text der Zeile steht ja schon links. Ein
     Abstandshalter ans Ende dieser Zeile bringt die Marke genau dorthin,
     wo gezeigt wurde – mit einem Element statt vierzig Leerzeichen. */
  if (brauchtSpalten) {
    const ende = zeilenAnfang + lines[targetLine].length;
    const rand = rangeForTextOffset(textDiv, ende);
    if (rand) {
      const bis = rand.getBoundingClientRect();
      const rechts = (bis && bis.right > 0) ? bis.right : r.left;
      if (clientX > rechts + cw * 0.7) {
        const halter = _neueLuecke((clientX - rechts) / Math.max(0.01, scaleX));
        halter[VORLAEUFIG] = true;
        rand.insertNode(halter);
        rand.setStartAfter(halter);
        rand.collapse(true);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(rand); }
        textDiv._colAnchor = targetCol;
        return true;
      }
    }
    // Zu nah dran, um einen Abstand zu rechtfertigen: ans Zeilenende
    setPlainCaret(textDiv, ende);
    textDiv._colAnchor = lines[targetLine].length;
    return false;
  }

  if (isExistingLine) targetCol = Math.min(targetCol, lines[targetLine].length);

  setPlainCaret(textDiv, zeilenAnfang + targetCol);
  textDiv._colAnchor = targetCol;
  return false;
}

function isPlainTextEditable(textDiv) {
  return [...textDiv.childNodes].every(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR'));
}

function applyHangingIndentWrap(textDiv) {
  if (!isPlainTextEditable(textDiv)) return false;
  const caret = getCaretTextOffset(textDiv);
  if (caret === null) return false;
  const raw = (textDiv.textContent || '').replace(/\r/g, '');
  const lineStart = raw.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const lineEndIdx = raw.indexOf('\n', caret);
  const line = raw.slice(lineStart, lineEndIdx === -1 ? raw.length : lineEndIdx);
  const indent = (line.match(/^[ \t]*/) || [''])[0];
  if (!indent.length) return false;

  const cs = getComputedStyle(textDiv);
  const measureCanvas = document.createElement('canvas').getContext('2d');
  measureCanvas.font = cs.font || `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
  
  const avail = Math.max(24, textDiv.clientWidth - 2);
  if (measureCanvas.measureText(line).width <= avail) return false;

  let breakAt = line.lastIndexOf(' ');
  while (breakAt > indent.length && measureCanvas.measureText(line.slice(0, breakAt)).width > avail) breakAt = line.lastIndexOf(' ', breakAt - 1);
  if (breakAt <= indent.length) return false;

  const replaced = line.slice(0, breakAt) + '\n' + indent + line.slice(breakAt + 1);
  textDiv.textContent = raw.slice(0, lineStart) + replaced + raw.slice(lineEndIdx === -1 ? raw.length : lineEndIdx);

  setPlainCaret(textDiv, caret > (lineStart + breakAt) ? caret + indent.length : caret);
  return true;
}

function _visibleWhitespaceText(raw) {
  return raw.replace(/\t/g, '⇥\t').replace(/ /g, '·').replace(/\n/g, '↵\n');
}

function updateWhitespaceDebugOverlays() {
  if (typeof QA !== 'function') return;
  QA('.ws-debug-layer').forEach(el => el.remove());
  if (!window._showWhitespaceDebug) return;

  QA('.j-page').forEach(pgEl => {
    const textDiv = pgEl.querySelector('.j-text');
    if (!textDiv) return;
    const raw = (textDiv.innerText || textDiv.textContent || '').replace(/\r/g, '');

    const ov = document.createElement('pre');
    ov.className = 'ws-debug-layer';
    Object.assign(ov.style, {
      top: textDiv.style.top || '64px',
      left: textDiv.style.left || '72px',
      right: textDiv.style.right || '32px',
      bottom: textDiv.style.bottom || '24px',
      paddingTop: textDiv.style.paddingTop || '0px',
      lineHeight: textDiv.style.lineHeight || '32px',
      fontSize: textDiv.style.fontSize || '17px',
      fontFamily: textDiv.style.fontFamily || "'Crimson Pro', serif"
    });
    ov.textContent = _visibleWhitespaceText(raw);
    pgEl.appendChild(ov);
  });
}
