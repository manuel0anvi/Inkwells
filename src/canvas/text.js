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

/**
 * Die erste Stelle im Text, die unterhalb dieser Höhe steht.
 *
 * Gebraucht für den Seitenumbruch bei REINEM Text (app.js): dort gibt es
 * keine Elemente, die man einzeln weiterreichen könnte – die ganze Seite
 * ist ein Textknoten, der bloss umbricht. Getrennt werden muss deshalb an
 * einer Stelle IM Text, und die kann nur gemessen werden.
 *
 * Halbieren geht, weil die Zeile einer Stelle mit der Stelle nur tiefer
 * werden kann. Herauskommt der Anfang der ersten Zeile, die nicht mehr
 * aufs Blatt passt – mitten in ein Wort trifft es also nie.
 *
 * @param {HTMLElement} textDiv
 * @param {number} grenzeY  in BILDSCHIRM-Pixeln (clientY)
 * @returns {number} −1, wenn alles darüber bleibt
 */
function stelleUnterhalb(textDiv, grenzeY) {
  const inhalt = flatTextOf(textDiv);
  if (!inhalt.length) return -1;

  let lo = 0, hi = inhalt.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    let r = null;
    try { r = caretRectAt(textDiv, mid, inhalt); } catch (err) { r = null; }
    if (r && r.top >= grenzeY) hi = mid;
    else lo = mid + 1;
  }
  return lo >= inhalt.length ? -1 : lo;
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
   soll das können – das ist der Kern von Inkwells. Bis hierher wurde der
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

/* ══════════════════════════════════════════════════════════════════════
   EIN KLICK SETZT EINEN FREI STEHENDEN ABSATZ

   >>> Warum er nicht mehr im Textfluss steht <<<
   Er stand dort, mit Einzug und Abstand nach oben. Solange nur unter
   allem Geschriebenen geklickt wurde, ging das gut. Sobald aber schon
   etwas darunter stand, war jede Antwort falsch:

     · Absatz einfügen  -> er braucht seine Zeile, und alles darunter
                           rutscht tiefer. Im geteilten Heft bei allen.
     · nichts einfügen  -> die Marke springt ans nächste Wort, und man
                           kann nicht mehr schreiben, wo man möchte.

   Beides ist gemeldet worden, und beides ist dieselbe Sache: im Fluss
   hängt jede Zeile an der davor. Ein A4-Blatt ist aber kein Fluss. Wer
   auf Papier zwischen zwei Zeilen etwas hinschreibt, schiebt damit
   nichts nach unten.

   Deshalb steht so ein Absatz jetzt NEBEN dem Fluss: mit left und top
   auf dem Blatt, wie die frei gesetzte Tabelle (css/pages.css). Er
   verschiebt nichts, weil er im Fluss keinen Platz einnimmt – und er
   lässt sich überall hinsetzen, auch dorthin, wo im Fluss gar kein
   Platz wäre.

   Der obere Wert rastet auf ganze Zeilen ein, damit der Text auf den
   Linien des Papiers sitzt und nicht dazwischen.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Ein leerer Absatz, der frei auf dem Blatt steht.
 *
 * @param {number} linksPx  von links, in Seiten-Pixeln
 * @param {number} obenPx   von oben, in Seiten-Pixeln
 */
function _freierAbsatz(linksPx = 0, obenPx = 0) {
  const p = document.createElement('p');
  p.className = 'j-frei';
  /* Ein <br> muss hinein: ein leerer Absatz hat sonst keine Höhe, und
     die Schreibmarke findet in ihm keinen Platz. */
  p.appendChild(document.createElement('br'));
  p.style.left = _abstandWert(linksPx) + 'px';
  p.style.top = _abstandWert(obenPx) + 'px';
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
const VORLAEUFIG = '_inkwellsVorlaeufig';

/* ── Was das vorläufige Stück ANDERSWO verändert hat ─────────────────
   Ein neuer Absatz zwischen zweien nimmt seinen Platz aus dem Abstand
   des unteren; ein Absatz, der nach links rückt, gibt seinen Einzug an
   einen Halter ab. Beides muss beim Wegräumen zurückgenommen werden,
   sonst bliebe von einem blossen Klick eine verschobene Seite. */
const ZURUECK = '_inkwellsZurueck';

function _merkeZurueck(el, ziel, name, alterWert) {
  el[ZURUECK] = { ziel, name, alterWert };
}

function _nimmZurueck(el) {
  const z = el && el[ZURUECK];
  if (!z || !z.ziel || !z.ziel.style) return;
  z.ziel.style[z.name] = z.alterWert || '';
  el[ZURUECK] = null;
}

/**
 * Das vorläufig Angelegte wieder wegnehmen – falls es noch leer ist.
 *
 * >>> Warum hier am Ende neu gerechnet wird <<<
 * Das Anlegen ruft ordneFreieAbsaetze, und das setzt den Nachbarn ein
 * margin-left, damit sie dem neuen Absatz ausweichen. Nahm man ihn
 * danach wieder weg, blieb dieses Ausweichen stehen – bis zum nächsten
 * Anschlag, der irgendwann kam oder auch nicht. Von aussen: man
 * verklickt sich, klickt zurück, und die Seite steht schief.
 *
 * Deshalb rechnet das Wegräumen selbst nach. So kann keine der drei
 * Stellen, die es rufen (placeCaretAnywhere, der blur-Griff in app.js,
 * ui/collab.js), es vergessen.
 */
function raeumeVorlaeufiges(textDiv, ausser) {
  if (!textDiv || !textDiv.querySelectorAll) return;
  let entfernt = false;
  for (const el of [...textDiv.querySelectorAll('p, span.j-luecke')]) {
    if (!el[VORLAEUFIG] || el === ausser) continue;
    /* Steht inzwischen etwas darin, bleibt es: dann war es kein blosser
       Klick mehr. Ein <br> allein zählt nicht als Inhalt. */
    if (el.tagName === 'P' && (el.textContent || '').trim()) { el[VORLAEUFIG] = false; continue; }
    _nimmZurueck(el);
    el.remove();
    entfernt = true;
  }
  if (entfernt) ordneFreieAbsaetze(textDiv);
}

/* ══════════════════════════════════════════════════════════════════════
   DIE ANGEKLICKTE STELLE ÜBERLEBT EINE FREMDE ÄNDERUNG

   >>> Der Fall, den das repariert <<<
   Man klickt auf eine freie Stelle. Der vorläufige Absatz entsteht, es
   geht aber kein 'input' hinaus – er steht in page.textContent also noch
   gar nicht. Tippt jetzt der andere, tauscht applyRemoteText das ganze
   innerHTML aus (ui/collab.js). Der eben angelegte Absatz ist damit weg,
   und die Marke wird irgendwo anders wiederhergestellt.

   Von aussen: „ich klicke hin, warte kurz, und schreibe dann woanders."
   In einer lebhaften Sitzung mehrmals in der Minute.

   Die Markierung liegt bewusst als JS-Eigenschaft am Element und nicht
   als Attribut – sie darf nie in page.textContent landen. Einen Tausch
   des innerHTML übersteht sie deshalb nicht von selbst; sie wird vorher
   abgeschrieben und danach wieder angelegt.
   ══════════════════════════════════════════════════════════════════════ */

/** Was gerade vorläufig dasteht – zum Wiederanlegen nach einem Tausch. */
function merkeVorlaeufiges(textDiv) {
  if (!textDiv || !textDiv.querySelectorAll) return null;
  for (const el of textDiv.querySelectorAll('p.j-frei')) {
    if (!el[VORLAEUFIG]) continue;
    if ((el.textContent || '').trim()) continue;   // dann ist es kein blosser Klick mehr
    return { links: parseFloat(el.style.left) || 0, oben: parseFloat(el.style.top) || 0 };
  }
  return null;
}

/**
 * Legt die gemerkte Stelle wieder an und setzt die Marke hinein.
 * @returns {boolean} ob etwas angelegt wurde
 */
function stelleVorlaeufigesWiederHer(textDiv, gemerkt) {
  if (!textDiv || !gemerkt) return false;

  const neu = _freierAbsatz(gemerkt.links, gemerkt.oben);
  neu[VORLAEUFIG] = true;
  textDiv.appendChild(neu);
  ordneFreieAbsaetze(textDiv);

  const range = document.createRange();
  _setRangeEndOfNode(range, neu);
  const sel = window.getSelection && window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  return true;
}

/** Der erste Anschlag macht aus „vorläufig" „bleibend". */
function markiereBleibend(textDiv) {
  if (!textDiv || !textDiv.querySelectorAll) return;
  for (const el of textDiv.querySelectorAll('p, span.j-luecke')) {
    el[VORLAEUFIG] = false;
    // Was es verschoben hat, bleibt jetzt auch verschoben
    el[ZURUECK] = null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   IN EINEN VORHANDENEN ABSTAND HINEIN GEKLICKT

   Wer rechts neben Text schreibt, hat dort einen Halter stehen. Klickt
   er danach mitten in diesen Abstand, soll die Marke dorthin – und
   nicht an dessen Rand springen. Der Halter wird dafür geteilt: der
   linke Teil so breit wie bis zum Klick, der rechte trägt den Rest.

   Zusammen sind beide genau so breit wie der eine vorher. Was rechts
   davon steht, bleibt deshalb stehen, wo es steht.
   ══════════════════════════════════════════════════════════════════════ */
function _lueckeUnter(textDiv, clientX, clientY) {
  for (const halter of textDiv.querySelectorAll('span.j-luecke')) {
    const rc = halter.getBoundingClientRect();
    if (rc.width < 4) continue;
    if (clientX >= rc.left && clientX <= rc.right
        && clientY >= rc.top && clientY <= rc.bottom) return halter;
  }
  return null;
}

function _teileLuecke(halter, clientX, scaleX) {
  const rc = halter.getBoundingClientRect();
  const teiler = Math.max(0.01, scaleX);
  const linksPx = (clientX - rc.left) / teiler;
  const restPx = (rc.width / teiler) - linksPx;
  // Zu nah am Rand: dann ist der vorhandene Halter schon die Antwort
  if (linksPx < 3 || restPx < 3) return null;

  const zweiter = _neueLuecke(restPx);
  _merkeZurueck(zweiter, halter, 'width', halter.style.width);
  halter.style.width = _abstandWert(linksPx) + 'px';
  halter.insertAdjacentElement('afterend', zweiter);
  return zweiter;
}

/* ══════════════════════════════════════════════════════════════════════
   EINE ÜBERSCHRIFT ENDET MIT IHRER ZEILE

   >>> Der Fall, den das repariert <<<
   Ein Umbruch teilt einen frei stehenden Absatz nicht, er lässt ihn nach
   unten wachsen (app.js, insertLineBreak) – für gewöhnlichen Text genau
   richtig. Bei einer ÜBERSCHRIFT sass die neue Zeile damit weiter in
   deren Absatz und trug deren Auszeichnung: dieselbe Schrift, dieselbe
   Kursive, dieselbe Grösse.

   Von aussen: „ich schreibe eine Überschrift, drücke Enter, und es
   schreibt in der Überschrift weiter. Schalte ich die Kursive ab, steht
   da immer noch die dünne Schrift der Überschrift und nicht die
   normale."

   Deshalb hört die Überschrift beim Umbruch auf: darunter entsteht ein
   NEUER freier Absatz ohne ihre Klasse, eine Zeile tiefer. Was rechts
   der Marke noch stand, zieht mit – wer mitten in einer Überschrift
   umbricht, will den Rest darunter haben, nicht verlieren.
   ══════════════════════════════════════════════════════════════════════ */

/** Die Überschrift, in der die Marke steht – oder null. */
function _ueberschriftUnterMarke(textDiv) {
  const sel = window.getSelection && window.getSelection();
  if (!sel || !sel.rangeCount || !textDiv) return null;
  let n = sel.getRangeAt(0).startContainer;
  if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  const p = (n && n.closest) ? n.closest('p.j-frei') : null;
  if (!p || !textDiv.contains(p)) return null;
  return /\bj-title-[123]\b/.test(p.className || '') ? p : null;
}

/**
 * Der Umbruch am Ende einer freien Überschrift: eine normale Zeile.
 *
 * @returns {boolean} ob der Umbruch hier erledigt wurde
 */
function beendeUeberschrift(textDiv) {
  const p = _ueberschriftUnterMarke(textDiv);
  if (!p) return false;

  const sel = window.getSelection();
  const marke = sel.getRangeAt(0);
  const rest = document.createRange();
  rest.setStart(marke.startContainer, marke.startOffset);
  rest.setEnd(p, p.childNodes.length);
  const mitgenommen = rest.extractContents();

  /* Ohne Platzhalter hat der leergeräumte Absatz keine Höhe mehr – und
     die neue Zeile sässe in ihm statt darunter. */
  if (!p.lastChild || p.lastChild.nodeName !== 'BR') p.appendChild(document.createElement('br'));

  /* Eine Zeile tiefer, nicht „so hoch wie die Überschrift" – ihr Kasten
     ist um ein, zwei Pixel höher als der Zeilenabstand, und der neue
     Absatz sässe damit knapp neben der Linie des Papiers. */
  const lh = parseFloat(getComputedStyle(textDiv).lineHeight) || 32;
  const hoch = Math.max(1, Math.round((p.offsetHeight || lh) / lh)) * lh;
  const neu = _freierAbsatz(parseFloat(p.style.left) || 0,
                            (parseFloat(p.style.top) || 0) + hoch);
  if ((mitgenommen.textContent || '').length) {
    neu.textContent = '';
    neu.appendChild(mitgenommen);
  }
  p.insertAdjacentElement('afterend', neu);
  ordneFreieAbsaetze(textDiv);

  const rg = document.createRange();
  rg.setStart(neu, 0);
  rg.collapse(true);
  sel.removeAllRanges();
  sel.addRange(rg);

  /* Der Umbruch ist eine echte Änderung – von Hand gesetzte Knoten
     melden das nicht von selbst. Ohne das stünde die neue Zeile weder
     im Heft noch beim Mitschreibenden (app.js, das 'input'-Ereignis). */
  textDiv.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** Steht die Schreibmarke gerade in einem frei stehenden Absatz? */
function imFreienAbsatz(textDiv) {
  const sel = window.getSelection && window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  let n = sel.getRangeAt(0).startContainer;
  if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  if (!n || !n.closest || !textDiv || !textDiv.contains(n)) return false;
  return !!n.closest('p.j-frei');
}

/* ══════════════════════════════════════════════════════════════════════
   ZWEI FREIE ABSÄTZE AUF DERSELBEN STELLE

   Ein Umbruch wird gar nicht erst zu einem zweiten Absatz (app.js). Aus
   der Zwischenablage kann trotzdem einer kommen, der Klasse und Lage
   eines vorhandenen geerbt hat – und der sässe genau auf ihm.

   Erkannt wird die Kopie daran, dass sie unmittelbar folgt und BEIDE
   Masse gleich sind; zwei Absätze, die jemand von Hand an dieselbe
   Stelle gesetzt hat, gibt es praktisch nicht, und eine eigene Stelle
   unterscheidet sich schon in einem Pixel.

   Gerechnet wird gegen die Lage, die der Vorgänger VOR dieser Runde
   hatte: sonst bliebe bei drei Kopien hintereinander die dritte liegen,
   weil die zweite gerade weggerückt ist.
   ══════════════════════════════════════════════════════════════════════ */
function richteFreieAbsaetze(textDiv) {
  if (!textDiv || !textDiv.querySelectorAll) return;
  let vorEl = null;
  let vorAltOben = null;

  for (const p of textDiv.querySelectorAll('p.j-frei')) {
    const oben = parseFloat(p.style.top) || 0;
    const istKopie = !!vorEl && p.previousElementSibling === vorEl
      && (vorEl.style.left || '') === (p.style.left || '')
      && oben === vorAltOben;

    vorAltOben = oben;
    if (istKopie) {
      const hoehe = vorEl.offsetHeight || 32;
      p.style.top = _abstandWert((parseFloat(vorEl.style.top) || 0) + hoehe) + 'px';
    }
    vorEl = p;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   WENN ZWEI TEXTE AUF EINER ZEILE ANEINANDERSTOSSEN

   Ein frei stehender Absatz verschiebt beim ANLEGEN nichts – das ist
   sein Sinn. Beim Wachsen stösst er aber irgendwann an den nächsten,
   und dann muss etwas geschehen. Was genau, entscheidet der Nutzer
   (Einstellungen, „Wenn Texte aneinanderstossen"):

     'elastisch'     Der Nachbar weicht nur so weit aus, dass ein
                     Wortabstand bleibt – und kommt von selbst zurück,
                     sobald wieder Platz ist. Seine gewählte Stelle
                     bleibt gespeichert, das Ausweichen wird gerechnet.
     'fest'          Dasselbe, aber der Nachbar behält seine neue Stelle.

   >>> Warum das Ausweichen gerechnet und nicht gespeichert wird <<<
   Weil sonst die Absicht verloren ginge. In `left`/`top` steht, wohin
   jemand geklickt hat; wo der Absatz dann wirklich landet, ergibt sich
   aus den Nachbarn und ändert sich mit jedem Anschlag. Gerechnet wird
   es in `margin-left`/`margin-top` – die nimmt ohneGriffe (app.js)
   wieder heraus, bevor der Text ins Heft geht.

   Gerechnet wird in Seiten-Pixeln (offsetLeft/-Top/-Width/-Height): die
   Seite wird über transform gezoomt, das lässt diese Werte unberührt.

   Senkrecht gilt dieselbe Regel wie waagerecht: wer von oben in einen
   anderen hineinwächst, schiebt ihn nach unten. Damit überlappt auf der
   Seite nie etwas.
   ══════════════════════════════════════════════════════════════════════ */

/* Luft zum Nachbarn – ungefähr ein Wortabstand. Ohne sie klebten zwei
   Texte zusammen und sähen aus wie einer. */
const FREI_LUFT_PX = 10;

/* Wie weit der Zeilenanfang anzieht. Dieselbe Weite gilt in
   canvas/input.js fuer das Anhaften an vorhandenen Text – wer das eine
   aendert, sollte das andere mitaendern. */
const ANHAFT_MM_TEXT = 10;
const PX_PRO_MM_TEXT = 96 / 25.4;

/** @returns {'elastisch'|'fest'} */
function ausweichArt(nb) {
  /* Ein FREMDES Dokument bringt die Entscheidung seines Besitzers mit.
     Sie gilt, solange man darin ist – sonst sähe die Seite bei jedem
     Beteiligten anders aus, und das ist bei gemeinsamer Arbeit
     schlimmer als eine Voreinstellung, die einem nicht gefällt.

     Im eigenen Heft gilt immer die eigene Wahl, auch wenn es freigegeben
     ist: dort steht zwar dasselbe Feld (es wird in den Kopf geschrieben,
     ui/sharedDocs.js), aber es ist nur die Abschrift der Einstellung und
     könnte zwischen zwei Sicherungen veraltet sein. */
  if (nb && nb.origin === 'shared' && nb.textFluss) return nb.textFluss;
  const wahl = (typeof Settings !== 'undefined' && Settings)
    ? Settings.get('textFluss') : '';
  /* Alles, was nicht 'fest' ist, gilt als 'elastisch' - auch das
     abgeschaffte 'verschmelzen'. In alten Einstellungen und in fremden
     Dokumenten kann es noch stehen; es soll dann kein Sonderfall sein,
     sondern schlicht die Vorgabe. */
  return (wahl === 'fest') ? 'fest' : 'elastisch';
}

/* ══════════════════════════════════════════════════════════════════════
   EIN ABSATZ IST NICHT EIN RECHTECK, SONDERN SEINE ZEILEN

   >>> Der Fall, den das repariert <<<
   Gemeldet: „ich schreibe in eine freie Zeile zwischen zwei Zeilen, und
   das Geschriebene darüber und darunter rutscht nach rechts."

   Ein Umbruch teilt einen frei stehenden Absatz nicht – er lässt ihn
   nach unten wachsen (app.js, insertLineBreak). „OBEN", Leerzeile,
   „UNTEN" ist damit EIN Element von drei Zeilen Höhe. Gemessen wurde
   hier aber nur der umschliessende Kasten: ein volles Rechteck über
   alle drei Zeilen, die leere in der Mitte eingeschlossen. Wer dort
   hineinschrieb, stiess also gegen einen Kasten, in dem an dieser Stelle
   gar nichts steht – und der ganze Absatz wich aus, mit der Zeile
   darüber und der darunter im Schlepptau.

   Gemessen: beide Zeilen sprangen von l=514 auf l=566.

   Gefragt wird deshalb nach den ZEILEN. Ein Range über den Inhalt
   liefert mit getClientRects() ein Rechteck je Bildschirmzeile, eng um
   die Zeichen – eine leere Zeile ist darin 0 px breit und stösst an
   nichts. Dieselbe Messung benutzt canvas/input.js für den Treffertest
   (beschriebeneKaesten); wer das eine ändert, sollte das andere ansehen.

   Der Schub bleibt eine Sache des ganzen Absatzes: er hat nur ein
   left/top. Gerechnet wird er als das Grösste über alle seine Zeilen.
   ══════════════════════════════════════════════════════════════════════ */

/* Ein Zeilenkasten, der schmaler ist als das, ist keiner: eine leere
   Zeile, ein blosser Umbruch. Deckt sich mit der Grenze in
   canvas/input.js (rc.width > 1) und mit dem min-width:1px, das ein
   frisch angelegter Absatz aus css/pages.css mitbekommt. */
const FREI_ZEILE_MIN_PX = 2;

/**
 * Die Zeilen eines Absatzes – in Seiten-Pixeln, gemessen am Inhalt.
 *
 * @returns {Array<{links:number, oben:number, breit:number, hoch:number}>}
 */
function _zeilenKaesten(p, feld, zoom) {
  const roh = [];
  if (typeof document !== 'undefined' && document.createRange) {
    try {
      const bereich = document.createRange();
      bereich.selectNodeContents(p);
      for (const rc of bereich.getClientRects()) roh.push(rc);
    } catch (err) { /* dann der Kasten, siehe unten */ }
  }

  /* Nichts Messbares – ein leerer Absatz, oder eine Umgebung ohne
     Layout (Prüfstand ohne Fenster). Dann gilt der Kasten selbst; er ist
     dank min-width nur ein Pixel breit und stösst damit an nichts. */
  const zeilen = [];
  for (const rc of roh) {
    const breit = rc.width / zoom;
    if (breit < FREI_ZEILE_MIN_PX) continue;
    zeilen.push({
      links: (rc.left - feld.left) / zoom,
      oben: (rc.top - feld.top) / zoom,
      breit,
      hoch: (rc.height / zoom) || 32
    });
  }
  if (zeilen.length) return zeilen;

  return [{ links: p.offsetLeft, oben: p.offsetTop,
            breit: p.offsetWidth, hoch: p.offsetHeight || 32 }];
}

/** Die freien Absätze, so wie sie gerade auf dem Blatt liegen. */
function _freieKaesten(alle, textDiv) {
  /* Gemessen wird in BILDSCHIRM-Pixeln, gerechnet in Seiten-Pixeln: die
     Seite wird über transform gezoomt, offsetLeft/-Top sind davon
     unberührt und die beiden dürfen nicht durcheinandergehen. */
  const feld = (textDiv && typeof textDiv.getBoundingClientRect === 'function')
    ? textDiv.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
  const zoom = (textDiv && textDiv.offsetWidth > 0 && feld.width)
    ? (feld.width / textDiv.offsetWidth) : 1;

  return alle.map(p => {
    const zeilen = _zeilenKaesten(p, feld, Math.max(0.01, zoom));
    return {
      p,
      zeilen,
      links: p.offsetLeft,
      oben: p.offsetTop,
      breit: p.offsetWidth,
      hoch: p.offsetHeight || 32
    };
  });
}

/* ══════════════════════════════════════════════════════════════════════
   AUSGEWICHEN WIRD NUR IN EINE RICHTUNG

   Die Reihenfolge, in der die Absätze durchgegangen werden, sagt bisher
   allein, wer stehen bleibt und wer weicht: sortiert wird nach dem
   KASTEN. Das genügte, solange ein Kasten eine Zeile war.

   Seit Zeile gegen Zeile geprüft wird, genügt es nicht mehr: der Kasten
   von „OBEN / Leerzeile / UNTEN" fängt oben an, seine dritte Zeile liegt
   aber UNTER allem, was auf der zweiten steht. Ohne die Frage nach der
   Richtung schob diese dritte Zeile den Text auf der zweiten nach unten –
   ein Absatz drückte also etwas weg, das über ihm liegt.

   Gemessen: der Text in der Lücke bekam margin-top: 51px und sass
   plötzlich unter „UNTEN" statt zwischen den beiden.

   Deshalb wird ausdrücklich gefragt, wer wo liegt. Waagerecht schiebt
   nur, was wirklich links steht; senkrecht nur, was wirklich darüber
   liegt.
   ══════════════════════════════════════════════════════════════════════ */

/** Stossen zwei Absätze auf irgendeiner ihrer Zeilen waagerecht zusammen? */
function _schubWaagerecht(steht, kommt) {
  let schub = 0;
  for (const a of steht.zeilen) {
    for (const b of kommt.zeilen) {
      // Verschiedene Zeilen berühren sich nie
      if (a.oben + a.hoch <= b.oben || a.oben >= b.oben + b.hoch) continue;
      // Und geschoben wird nur nach rechts – siehe oben
      if (a.links > b.links) continue;
      schub = Math.max(schub, (a.links + a.breit + FREI_LUFT_PX) - b.links);
    }
  }
  return schub;
}

/** Dasselbe senkrecht: wer von oben hineinwächst, schiebt nach unten. */
function _schubSenkrecht(steht, kommt) {
  let schub = 0;
  for (const a of steht.zeilen) {
    for (const b of kommt.zeilen) {
      if (a.links + a.breit <= b.links || a.links >= b.links + b.breit) continue;
      // Nur, was wirklich darüber liegt – siehe oben
      if (a.oben >= b.oben) continue;
      schub = Math.max(schub, (a.oben + a.hoch) - b.oben);
    }
  }
  return schub;
}

/**
 * Bringt die frei stehenden Absätze so auseinander, dass nichts
 * überlappt – auf die Art, die eingestellt ist.
 *
 * @param {HTMLElement} textDiv
 * @param {string} [art] siehe ausweichArt(); ohne Angabe die Einstellung
 */
function ordneFreieAbsaetze(textDiv, art) {
  if (!textDiv || !textDiv.querySelectorAll) return;
  const wahl = art || ausweichArt(typeof getNb === 'function' ? getNb() : null);

  let alle = [...textDiv.querySelectorAll('p.j-frei')];
  if (!alle.length) return;

  /* Zuerst zurück auf die gewählte Lage. Ohne das rechnete die nächste
     Runde mit dem Ergebnis der vorigen weiter, und die Absätze wanderten
     bei jedem Anschlag ein Stück weiter nach rechts. */
  for (const p of alle) {
    p.style.marginLeft = '';
    p.style.marginTop = '';
  }
  if (alle.length < 2) return;

  const fest = (wahl === 'fest');

  /* ── Waagerecht ────────────────────────────────────────────────────
     Von links nach rechts: jeder muss hinter allen bleiben, die schon
     stehen und sich mit ihm auf derselben Höhe befinden. Geprüft wird
     Zeile gegen Zeile – siehe _freieKaesten. */
  let kaesten = _freieKaesten(alle, textDiv).sort((a, b) => a.links - b.links);
  const gesetzt = [];
  for (const k of kaesten) {
    let schub = 0;
    for (const v of gesetzt) schub = Math.max(schub, _schubWaagerecht(v, k));
    schub = Math.max(0, Math.round(schub));
    if (schub > 0) {
      if (fest) k.p.style.left = _abstandWert((parseFloat(k.p.style.left) || 0) + schub) + 'px';
      else k.p.style.marginLeft = schub + 'px';
      k.links += schub;
      for (const z of k.zeilen) z.links += schub;
    }
    gesetzt.push(k);
  }

  /* ── Und senkrecht dasselbe ────────────────────────────────────────
     Neu gemessen, weil ein nach rechts gerückter Absatz schmaler werden
     und damit umbrechen kann – dann ist er höher als vorher. */
  kaesten = _freieKaesten([...textDiv.querySelectorAll('p.j-frei')], textDiv)
    .sort((a, b) => a.oben - b.oben);
  const drüber = [];
  for (const k of kaesten) {
    let schub = 0;
    for (const v of drüber) schub = Math.max(schub, _schubSenkrecht(v, k));
    schub = Math.max(0, Math.round(schub));
    if (schub > 0) {
      if (fest) k.p.style.top = _abstandWert((parseFloat(k.p.style.top) || 0) + schub) + 'px';
      else k.p.style.marginTop = schub + 'px';
      k.oben += schub;
      for (const z of k.zeilen) z.oben += schub;
    }
    drüber.push(k);
  }
}

function _setRangeEndOfNode(range, node) {
  if (node.lastChild && node.lastChild.nodeType === Node.TEXT_NODE) {
    range.setStart(node.lastChild, node.lastChild.nodeValue.length);
  } else {
    range.selectNodeContents(node);
  }
  range.collapse(true);
}

/** Was der Browser an diesem Punkt für eine Textstelle hält. */
function _stelleAmPunkt(x, y) {
  if (document.caretPositionFromPoint) return document.caretPositionFromPoint(x, y);
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  return null;
}

/**
 * Die geschriebene Zeile, die einem Punkt am nächsten liegt.
 *
 * Gemessen wird Textknoten für Textknoten, nicht am umschliessenden
 * Kasten: ein Absatz ist so breit wie die Seite, seine Zeilen sind es
 * nicht. Dieselbe Messung benutzt canvas/input.js für den Treffertest
 * (beschriebeneKaesten).
 *
 * @returns {DOMRect|null} in Bildschirm-Pixeln
 */
function _naechsteTextZeile(textDiv, clientX, clientY) {
  let beste = null;
  let besteWeite = Infinity;
  const bereich = document.createRange();
  const lauf = document.createTreeWalker(textDiv, NodeFilter.SHOW_TEXT);

  for (let n = lauf.nextNode(); n; n = lauf.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.length) continue;
    bereich.selectNodeContents(n);
    for (const rc of bereich.getClientRects()) {
      if (rc.width <= 1) continue;
      const dx = clientX < rc.left ? rc.left - clientX
        : (clientX > rc.right ? clientX - rc.right : 0);
      const dy = clientY < rc.top ? rc.top - clientY
        : (clientY > rc.bottom ? clientY - rc.bottom : 0);
      /* Senkrecht wiegt schwerer: das Ende DIESER Zeile ist näher
         gemeint als der Anfang der Zeile darüber, auch wenn der Weg
         dorthin in Pixeln länger ist. */
      const weite = dx + dy * 4;
      if (weite < besteWeite) { besteWeite = weite; beste = rc; }
    }
  }
  return beste;
}

/**
 * Setzt die Schreibmarke dorthin, wo gezeigt wurde – auch wenn dort noch
 * gar nichts steht.
 *
 * @param {boolean} forceManual  Der Klick liegt auf FREIER Fläche.
 *   Trifft er wirklich ein Zeichen, macht das der Browser selbst und
 *   besser (canvas/input.js, isFreeEditorAreaClick).
 * @returns {boolean} ob dafür etwas angelegt wurde
 */
function placeCaretAnywhere(textDiv, clientX, clientY, forceManual = false, page = null) {
  if (!textDiv) return false;
  /* Was der vorige Klick angelegt und niemand beschrieben hat, gehört
     weg, bevor der nächste etwas Neues anlegt (siehe VORLAEUFIG). */
  raeumeVorlaeufiges(textDiv);
  textDiv.focus();

  const r = textDiv.getBoundingClientRect();
  const cs = getComputedStyle(textDiv);
  const scaleX = textDiv.offsetWidth > 0 ? (r.width / textDiv.offsetWidth) : 1;
  const scaleY = textDiv.offsetHeight > 0 ? (r.height / textDiv.offsetHeight) : 1;
  const lh = parseFloat(cs.lineHeight) || 32;            // Seiten-Pixel
  const pt = parseFloat(cs.paddingTop) || 0;             // Seiten-Pixel

  /* ── Mitten in einen Abstandshalter geklickt ──────────────────────
     Den setzten ältere Fassungen rechts neben geschriebenen Text; in
     schon geschriebenen Heften steht er weiterhin. Ein Punkt IN einem
     nicht bearbeitbaren Stück liefert immer nur dessen Rand – also wäre
     die Marke wieder am Anfang oder Ende der Zeile. Deshalb wird er
     geteilt, und die Marke kommt dazwischen. */
  const getroffeneLuecke = _lueckeUnter(textDiv, clientX, clientY);
  if (getroffeneLuecke) {
    const zweiter = _teileLuecke(getroffeneLuecke, clientX, scaleX);
    const rg = document.createRange();
    if (zweiter) {
      zweiter[VORLAEUFIG] = true;
      rg.setStartBefore(zweiter);
    } else {
      rg.setStartAfter(getroffeneLuecke);
    }
    rg.collapse(true);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(rg); }
    return !!zweiter;
  }

  /* ── Der Klick sitzt auf einem Zeichen ────────────────────────────
     Dann weiss der Browser genau, an welche Stelle im Wort die Marke
     gehört – besser, als es sich hier aus Zeilenhöhe und Zeichenbreite
     ausrechnen liesse. Bei der Maus setzt er sie gleich selbst.

     Ein FINGERTIPP kommt aber ohne ihn hier an: über dem Text liegt das
     Zeichenblatt und fängt ihn ab (canvas/input.js, tippAufText). Für
     ihn wird die Stelle deshalb hier gesetzt – gemessen an derselben
     Stelle, die der Browser nehmen würde. */
  if (!forceManual) {
    let treffer = _stelleAmPunkt(clientX, clientY);
    let knoten = treffer ? (treffer.offsetNode || treffer.startContainer) : null;

    /* ── Neben dem Text weiss der Browser gar nichts ─────────────────
       >>> Der Fall, den das repariert <<<
       Ein frei stehender Absatz ist nur so breit wie sein Text. Klickt
       jemand rechts daneben, liegt der Punkt über KEINEM Inhalt, und
       caretPositionFromPoint antwortet mit dem Feld selbst und der
       Stelle 0. Die Marke sass damit am Anfang der Seite, und der
       nächste Buchstabe stand vor allem anderen.

       Gemessen: ein Klick acht Pixel rechts neben „problem:" lieferte
       DIV.j-text@0, und aus „problem:" wurde „Xproblem:". Genau so
       gemeldet – „ich klicke neben den Doppelpunkt und lande am Anfang
       des Textes".

       Hierher kommt nur, was innerhalb des Magneten liegt
       (canvas/input.js, isFreeEditorAreaClick) – der Klick will also an
       den Text und nicht daneben. Gefragt wird der Browser deshalb ein
       zweites Mal, mit einem Punkt, der in die nächstgelegene Zeile
       hineingerückt ist. So kommt wieder die genaue Stelle im Wort
       heraus, statt sie aus Zeichenbreiten zu schätzen. */
    if (!knoten || knoten === textDiv) {
      const zeile = _naechsteTextZeile(textDiv, clientX, clientY);
      if (zeile) {
        const nahX = Math.min(Math.max(clientX, zeile.left + 1), zeile.right - 1);
        const nahY = Math.min(Math.max(clientY, zeile.top + 1), zeile.bottom - 1);
        const zweiter = _stelleAmPunkt(nahX, nahY);
        const knoten2 = zweiter ? (zweiter.offsetNode || zweiter.startContainer) : null;
        if (knoten2 && knoten2 !== textDiv) { treffer = zweiter; knoten = knoten2; }
      }
    }

    if (knoten && textDiv.contains(knoten)) {
      const rg = document.createRange();
      rg.setStart(knoten, treffer.offset !== undefined ? treffer.offset : treffer.startOffset);
      rg.collapse(true);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(rg); }
    }
    return false;
  }

  /* ── Sonst: ein freier Absatz genau dort ──────────────────────────
     Waagerecht auf den Punkt, senkrecht auf die Zeile gerastet – der
     Text soll auf den Linien des Papiers sitzen. Beides in
     Seiten-Pixeln: die Seite ist gezoomt, der gespeicherte Wert darf
     das nicht sein. */
  let linksPx = Math.max(0, (clientX - r.left) / Math.max(0.01, scaleX));
  const obenRoh = (clientY - r.top) / Math.max(0.01, scaleY);
  const zeile = Math.max(0, Math.floor((obenRoh - pt) / lh));

  /* ── Der Zeilenanfang zieht an ─────────────────────────────────────
     Wer knapp neben den Anfang einer Zeile klickt, will an den Anfang.
     Ohne das saesse der Absatz drei Pixel weiter rechts als der darueber,
     und die Seite haette einen unruhigen linken Rand.

     Ein Zentimeter, dieselbe Weite wie beim Anhaften an vorhandenen Text
     (canvas/input.js). Gerechnet wird hier in SEITEN-Pixeln, deshalb ohne
     Zoom: der gespeicherte Wert soll vom Zoom unabhaengig sein. */
  if (linksPx < ANHAFT_MM_TEXT * PX_PRO_MM_TEXT) linksPx = 0;

  const neu = _freierAbsatz(linksPx, pt + zeile * lh);
  neu[VORLAEUFIG] = true;
  textDiv.appendChild(neu);
  // Steht rechts davon schon etwas, reicht er nur bis dorthin
  ordneFreieAbsaetze(textDiv);

  const range = document.createRange();
  _setRangeEndOfNode(range, neu);
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  return true;
}

function isPlainTextEditable(textDiv) {
  return [...textDiv.childNodes].every(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR'));
}

/* ══════════════════════════════════════════════════════════════════════
   EIN <br> IM REINEN TEXT WIRD ZU EINEM ECHTEN UMBRUCH

   >>> Der Fall, den das repariert <<<
   isPlainTextEditable lässt Textknoten UND <br> als „reinen Text"
   durchgehen. Alles, was danach kommt, liest und schreibt aber über
   textContent – und textContent kennt kein <br>: der Umbruch taucht beim
   Lesen nicht auf und ist beim Zurückschreiben fort. Zwei Zeilen wurden
   dabei stillschweigend zu einer.

   Betroffen sind applyHangingIndentWrap (gleich unten) und
   commitPlainTextEdit (app.js, Tab und Enter) – also der Weg, den fast
   jeder Anschlag auf einer noch unformatierten Seite nimmt.

   Das Feld steht auf white-space: pre-wrap (app.js), ein '\n' bricht
   dort genauso um wie ein <br>. Auf dem Papier ändert sich also nichts;
   textContent sagt danach nur die Wahrheit.

   >>> Warum das LETZTE <br> stehen bleibt <<<
   Das ist keine Zeile, sondern der Platzhalter, den contenteditable an
   das Ende eines Blocks setzt. Es zählt in flatTextParts ausdrücklich
   nicht mit (letztesImBlock); machte man ein '\n' daraus, wäre der flache
   Text plötzlich ein Zeichen länger und jede gemerkte Stelle – die eigene
   Marke, die fremde, das Sperrband – säße daneben. Chromium setzt es
   ohnehin von selbst wieder.
   ══════════════════════════════════════════════════════════════════════ */
function normalisiereUmbrueche(textDiv) {
  if (!textDiv || !isPlainTextEditable(textDiv)) return false;

  const brs = [...textDiv.childNodes].filter(
    n => n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR');
  // Das letzte ist der Platzhalter – siehe oben
  if (textDiv.lastChild && textDiv.lastChild.nodeName === 'BR') brs.pop();
  if (!brs.length) return false;

  /* Die Marke sitzt mitten darin. Der flache Text ändert sich durch den
     Tausch nicht (ein <br> zählt dort schon als '\n'), also lässt sie
     sich hinterher auf dieselbe Zahl zurücksetzen – normalize() legt
     Textknoten zusammen und würde sie sonst mitziehen. */
  let marke = null;
  try { marke = flatCaretPos(textDiv); } catch (err) { marke = null; }

  for (const br of brs) br.replaceWith(document.createTextNode('\n'));
  textDiv.normalize();

  if (marke !== null) { try { setFlatCaret(textDiv, marke); } catch (err) { /* egal */ } }
  return true;
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

/* ══════════════════════════════════════════════════════════════════════
   DER EINZUG DER ZEILE, IN DER DIE MARKE STEHT

   Gebraucht beim Umbruch und beim Einfügen (app.js): die neue Zeile
   bekommt denselben Einzug wie die, aus der sie kommt – wie in jedem
   Editor.

   >>> Warum das eine eigene Funktion geworden ist <<<
   An beiden Stellen standen zwei MASSE nebeneinander, die nicht
   dasselbe zählen:

     getCaretTextOffset   zählt nur die Zeichen in den Textknoten
     innerText            hat an jeder Blockgrenze ein zusätzliches \n

   Die beiden driften mit jedem Absatz um ein Zeichen auseinander –
   gemessen: getCaretTextOffset 36 gegen innerText 38 bei bloss zwei
   Absätzen. Bei sechs zeigte die Stelle schon in eine ganz andere Zeile.
   Fing DIE mit Leerzeichen an, wurde deren Einzug an die neue Zeile
   gehängt: Text rückte beim Umbruch grundlos nach rechts, und beim
   Einfügen gleich jede eingefügte Zeile.

   flatTextOf und flatCaretPos zählen beide die Zeilengrenzen mit und
   gehören zusammen. Nur solange der Inhalt reiner Text ist, sind die
   alten Masse gleichwertig – dort bleibt es bei textContent, weil der
   Umbruch gleich darauf ebenfalls darüber geschrieben wird.
   ══════════════════════════════════════════════════════════════════════ */
function einzugDerZeile(textDiv) {
  if (!textDiv) return '';

  let roh, bei;
  if (isPlainTextEditable(textDiv)) {
    roh = (textDiv.textContent || '').replace(/\r/g, '');
    bei = getCaretTextOffset(textDiv);
  } else {
    roh = (typeof flatTextOf === 'function') ? flatTextOf(textDiv) : '';
    bei = (typeof flatCaretPos === 'function') ? flatCaretPos(textDiv) : null;
  }
  if (bei === null) return '';

  const anfang = roh.lastIndexOf('\n', Math.max(0, bei - 1)) + 1;
  const ende = roh.indexOf('\n', bei);
  const zeile = roh.slice(anfang, ende === -1 ? roh.length : ende);
  return (zeile.match(/^[ \t]*/) || [''])[0];
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
