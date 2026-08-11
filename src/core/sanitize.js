'use strict';

/* ══════════════════════════════════════════════════════════════════════
   SEITENTEXT BEREINIGEN

   Der Text einer Seite ist HTML und wird mit innerHTML eingesetzt – in
   der App (app.js, ui/collab.js) wie auf der Website (js/viewer.js).
   Solange er aus dem eigenen Editor stammt, ist das harmlos.

   Er stammt aber nicht immer von dort:

     · aus einem geteilten Dokument (docs/{docId}/pages/{id}.text),
     · aus einer Yjs-Aenderung ueber die Realtime Database,
     · aus einer .jrnl-Datei, die jemand geschickt hat.

   Alle drei kommen von aussen. Ohne Pruefung genuegt ein
   <img src=x onerror="…"> in einer fremden Seite, und der Code laeuft:

     · In der App im Fenster, das window.api traegt – darueber sind die
       Cloud-Token und die Dateien auf der Platte erreichbar (preload.js).
     · Auf inkwells.me auf derselben Herkunft, deren localStorage die
       Zugriffs- und Erneuerungstoken fuer Drive bzw. OneDrive haelt
       (js/common.js).

   Deshalb geht ab jetzt jeder Seitentext hier durch.

   >>> Erlaubt ist genau das, was der Editor selbst erzeugt <<<
   Die Liste unten ist nicht geraten, sondern aus zwei Quellen abgeleitet:
   den execCommand-Aufrufen in ui/toolbar.js (bold, italic, underline,
   foreColor, formatBlock) und aus core/docx.js, das denselben HTML-Text
   wieder auseinandernimmt. Was dort gelesen wird, muss hier stehen
   bleiben – sonst verliert der Word-Export etwas.

   `font` mit `color` gehoert ausdruecklich dazu: styleWithCSS ist nicht
   eingeschaltet, Chromium erzeugt fuer foreColor also <font color="…">.
   Das steht in jedem bestehenden Heft; wuerde es hier wegfallen, waere
   die Textfarbe rueckwirkend weg.

   >>> Warum ueber <template> <<<
   Der Inhalt eines <template> ist inert: Bilder werden nicht geladen,
   Scripte laufen nicht, onerror feuert nicht. Erst wird also in einer
   toten Ecke geparst und aufgeraeumt, und nur das Ergebnis geht in die
   Seite. Ein DOMParser taete es auch, ist aber teurer.

   Wortgleiche Kopie unter website/js/sanitize.js – erzeugt von
   `npm run sync-share`. Bearbeitet wird IMMER diese Fassung hier.
   ══════════════════════════════════════════════════════════════════════ */

(function (global) {
  /* Bloecke und Inline-Auszeichnung. Die Bloecke stimmen mit BLOCK_TAGS in
     core/docx.js ueberein, die Inline-Tags mit dessen walk(). */
  const ERLAUBTE_TAGS = new Set([
    'P', 'DIV', 'BR', 'SPAN',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'B', 'STRONG', 'I', 'EM', 'U', 'INS', 'S', 'STRIKE', 'DEL',
    'FONT',
    'UL', 'OL', 'LI', 'BLOCKQUOTE', 'SECTION',

    /* ── Tabellen ────────────────────────────────────────────────────
       Sie standen bewusst NICHT hier: bis es sie im Editor gab, war ein
       <table> in einem Seitentext etwas Fremdes, und die Bereinigung hat
       es ausgepackt (Text blieb, Element weg). Seit core/tables.js
       gehören sie dazu – ohne diese Zeilen zerfiele jede Tabelle beim
       ersten Abgleich in eine Reihe loser Wörter, und zwar unwiederbringlich. */
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION',
    'COLGROUP', 'COL'
  ]);

  /* Nur die Ueberschriften- und die Aufzaehlungsklassen. Alles andere
     waere ohne Wirkung – die Stilbloecke der Seite kennen nur diese.

     `j-list-…` traegt die Form der Aufzaehlung (core/lists.js): welcher
     Punkt, welche Nummer. Sie MUSS hier durchkommen, sonst saehe eine
     Liste aus einem geteilten Heft nach dem Oeffnen anders aus als beim
     Schreiben – ein style="list-style-type" waere keine Alternative, von
     einem style bleibt unten allein die Farbe stehen. Das Muster ist
     bewusst allgemein gehalten, damit eine neue Form nicht an zwei
     Stellen nachgetragen werden muss. */
  const ERLAUBTE_KLASSEN = /^j-(title-[123]|list-[a-z]{3,8}(-[a-z]{3,8})?|table|formula(-block)?|comment-mark|resolved)$/;

  /* KaTeX erzeugt beim Rendern eine Vielzahl innerer Elemente mit eigenen
     Klassen. Sie alle aufzuzählen wäre brüchig – jede neue KaTeX-Version
     kann andere mitbringen. Weil KaTeX-Ausgabe aber reine Darstellung ist
     (keine Handler, keine URLs), bekommt sie einen eigenen, breiteren
     Filter: alles, was mit 'katex' beginnt, und alle kurzen Mathe-Klassen
     der Form m… (mord, mfrac etc.) und Hilfsklassen (base, strut, vlist). */
  const KATEX_KLASSEN = /^(katex|katex-(html|mathml|display)|base|strut|vlist|accent|overline|reset-size|sizing|delimsizing|nulldelimiter|op-symbol|m[a-z]{2,10}(-[a-z]{2,10})?)$/;

  /* Nur an Tabellenzellen, nur diese zwei, und nur als kleine Zahl. Ohne
     sie ginge eine verbundene Zelle beim ersten Abgleich auseinander –
     eingefügt aus Word kommt so etwas regelmäßig. */
  const ZELLEN_ATTRIBUTE = new Set(['colspan', 'rowspan']);
  const istSpanne = (wert) => /^[1-9]\d{0,1}$/.test(String(wert).trim());

  /* Die gezogene Spaltenbreite (core/tables.js). Sie steht an <col> und
     nicht als style an der Zelle, denn von einem style bleibt unten allein
     die Farbe stehen – die Breite waere beim ersten Abgleich weg.
     Erlaubt ist eine nackte Zahl, nichts weiter. */
  const istBreite = (wert) => /^[1-9]\d{0,3}$/.test(String(wert).trim());

  /** Ist das eine Farbe und sonst nichts? Kein url(), kein Ausdruck. */
  function istFarbe(wert) {
    return typeof wert === 'string'
      && wert.length <= 64
      && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/]+\)|[a-z]{3,20})$/i.test(wert.trim());
  }

  /**
   * Wirft aus einem Element alles heraus, was nicht auf die Liste gehoert.
   * Ein verbotenes Element verschwindet, sein TEXT bleibt – wer eine Seite
   * mit einem <table> bekommt, soll nicht den Inhalt verlieren.
   */
  function saeubereElement(el) {
    // Attribute rueckwaerts, weil das Entfernen die Sammlung veraendert
    for (let i = el.attributes.length - 1; i >= 0; i--) {
      const name = el.attributes[i].name.toLowerCase();
      const wert = el.attributes[i].value;

      if (name === 'class') {
        const behalten = String(wert).split(/\s+/).filter(c => ERLAUBTE_KLASSEN.test(c) || KATEX_KLASSEN.test(c));
        if (behalten.length) el.setAttribute('class', behalten.join(' '));
        else el.removeAttribute('class');
        continue;
      }

      /* Vom style bleibt allein die Farbe stehen. Gelesen wird ueber
         el.style, das der Browser schon geparst hat – damit kann keine
         merkwuerdige Schreibweise durchrutschen. */
      if (name === 'style') {
        const farbe = el.style && el.style.color;
        el.removeAttribute('style');
        if (istFarbe(farbe)) el.style.color = farbe;
        continue;
      }

      // <font color="…"> – der Weg, auf dem Chromium foreColor ablegt
      if (name === 'color' && el.tagName === 'FONT' && istFarbe(wert)) continue;

      // Verbundene Zellen, siehe ZELLEN_ATTRIBUTE
      if (ZELLEN_ATTRIBUTE.has(name) && (el.tagName === 'TD' || el.tagName === 'TH')
          && istSpanne(wert)) continue;

      // Gezogene Spaltenbreite, siehe istBreite
      if (name === 'width' && el.tagName === 'COL' && istBreite(wert)) continue;

      // data-latex auf Formel-Spans: der LaTeX-Quelltext, aus dem KaTeX rendert.
      // Ohne ihn wäre die Formel nach dem ersten Abgleich nicht mehr editierbar.
      if (name === 'data-latex' && el.tagName === 'SPAN'
          && el.classList.contains('j-formula')) continue;

      /* data-cid an der kommentierten Stelle: die Kennung des Kommentars,
         zu dem sie gehört. Ohne sie ginge die Verknüpfung zwischen Text und
         Karte nach dem ersten Abgleich verloren – die Markierung bliebe
         stehen, wüsste aber nicht mehr, wovon sie handelt. */
      if (name === 'data-cid' && el.tagName === 'SPAN'
          && el.classList.contains('j-comment-mark')) continue;

      /* Alles Uebrige faellt weg: on*-Handler, src, href, srcset, formaction,
         data-*, xlink:href … Eine Liste des Verbotenen waere immer
         unvollstaendig, deshalb andersherum. */
      el.removeAttribute(el.attributes[i].name);
    }
  }

  let gewarnt = false;

  /** Hat diese Umgebung alles, was die Bereinigung braucht? */
  function kannBereinigen() {
    return typeof document !== 'undefined'
      && typeof document.createElement === 'function'
      && typeof document.createTreeWalker === 'function'
      && typeof NodeFilter !== 'undefined'
      && !!(document.createElement('template') || {}).content;
  }

  /**
   * Bereinigt den HTML-Text einer Seite.
   *
   * @param {string} html roher Seitentext, moeglicherweise fremd
   * @returns {string} derselbe Text ohne alles, was ausfuehrbar waere
   */
  function sanitizePageHtml(html) {
    if (html === null || html === undefined) return '';
    const roh = String(html);
    if (!roh) return '';

    /* Ohne DOM unveraendert durchreichen. Das trifft Node und die
       Testumgebungen, die ein knappes document nachbauen – dort wird
       nichts gerendert, und ein halbherziger Ersatz mit regulaeren
       Ausdruecken waere schlechter als gar keiner.

       Gefragt wird nach GENAU dem, was unten gebraucht wird, nicht bloss
       nach "gibt es ein document". Sonst haelt ein nachgebautes document
       die Bereinigung fuer moeglich und sie scheitert mittendrin. */
    if (!kannBereinigen()) {
      if (typeof document !== 'undefined' && !gewarnt) {
        gewarnt = true;
        // Ein echter Browser kann das alles. Steht das hier, ist etwas faul.
        console.warn('[Sanitize] Kein vollstaendiges DOM – der Seitentext geht '
          + 'ungeprueft durch. In der App darf das nie vorkommen.');
      }
      return roh;
    }

    const halter = document.createElement('template');
    halter.innerHTML = roh;

    /* Erst einsammeln, dann anfassen: ein TreeWalker mag es nicht, wenn
       ihm unter den Fuessen Knoten verschwinden. */
    const alle = [];
    const lauf = document.createTreeWalker(halter.content, NodeFilter.SHOW_ELEMENT);
    for (let el = lauf.nextNode(); el; el = lauf.nextNode()) alle.push(el);

    for (const el of alle) {
      // Schon entfernt, weil ein Elternteil verschwunden ist
      if (!el.parentNode) continue;

      const tag = el.tagName;

      /* Inhalt und Element weg: was in <script> oder <style> steht, ist
         Code, kein Text. Bei allen anderen bleibt der Text erhalten. */
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE'
          || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') {
        el.remove();
        continue;
      }

      if (!ERLAUBTE_TAGS.has(tag)) {
        // Auspacken: die Kinder ruecken an die Stelle des Elements
        const eltern = el.parentNode;
        while (el.firstChild) eltern.insertBefore(el.firstChild, el);
        el.remove();
        continue;
      }

      saeubereElement(el);
    }

    return halter.innerHTML;
  }

  global.sanitizePageHtml = sanitizePageHtml;

  // Fuer Tests unter Node
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sanitizePageHtml };
  }
})(typeof window !== 'undefined' ? window : globalThis);
