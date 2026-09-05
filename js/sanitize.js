/* ══════════════════════════════════════════════════════════════════════
   ⚠  ERZEUGTE DATEI – NICHT HIER BEARBEITEN

   Wortgleiche Kopie von src/core/sanitize.js. Die App wird ohne den
   Ordner website/ ausgeliefert (siehe electron-builder.config.js),
   deshalb braucht die Website ein eigenes Exemplar.

   Änderungen gehören nach src/core/sanitize.js. Danach:
       npm run sync-share
   Vor dem Veröffentlichen der Website läuft das von selbst.
   ══════════════════════════════════════════════════════════════════════ */

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

    /* ── Code ────────────────────────────────────────────────────────
       Ein Codeblock ist ein <pre class="j-code" data-lang="python">.
       Darin steht NUR der nackte Code – die Farben werden erst beim
       Anzeigen darübergelegt und von ohneGriffe() in app.js wieder
       abgezogen, bevor etwas gespeichert oder geteilt wird. Sonst ginge
       bei jedem Tastendruck ein neues Farbgeruest durch Yjs, und die
       Zusammenarbeit erstickte daran.

       Ohne diese zwei Tags packte die Bereinigung den Block aus: aus
       eingeruecktem Code wurde eine Reihe loser Woerter, und zwar
       unwiederbringlich. Fuer eine Schule mit dreizehn Wochenstunden
       Informatik, Systemen und Telekommunikation ist das der
       Unterschied zwischen brauchbar und unbrauchbar. */
    'PRE', 'CODE',

    /* ── Verweise ────────────────────────────────────────────────────
       Sie standen bewusst nicht hier: ein <a> traegt eine ADRESSE, und
       eine Adresse ist der uebliche Weg, ueber den in einer Seite etwas
       Ausfuehrbares landet (javascript:, data:, vbscript:).

       Seit es sie im Editor gibt (ui/links.js), gehoeren sie dazu – aber
       nur mit der Pruefung in istAdresse() weiter unten. Was dort nicht
       durchkommt, verliert sein href und bleibt als blosser Text stehen:
       lieber ein toter Verweis als ein gefaehrlicher. */
    'A',

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
     Stellen nachgetragen werden muss.

     `j-align-…` traegt die Ausrichtung eines Absatzes (ui/toolbar.js).
     Auch sie MUSS hier stehen: ein style="text-align" waere keine
     Alternative, von einem style bleibt unten allein die Farbe uebrig.
     Gebraucht wird sie vor allem beim Oeffnen von Word-Dokumenten –
     dort ist eine zentrierte Ueberschrift der Normalfall. */
  /* `j-code` ist der Codeblock, `j-code-hell` seine helle Fassung (die
     Voreinstellung ist dunkel, wie in einer Entwicklungsumgebung). Die
     Farbklassen `j-tok-…` stehen hier bewusst NICHT: sie sind reine
     Anzeige und werden vor dem Speichern abgezogen. Käme eine davon
     doch einmal durch, fiele sie hier weg – richtig so.

     `j-erledigt` ist der gesetzte Haken einer Ankreuzliste. Er gehört
     zum Inhalt und nicht zur Anzeige: ob eine Aufgabe erledigt ist,
     sollen alle sehen und das Heft soll es behalten. */
  const ERLAUBTE_KLASSEN = /^j-(title-[123]|list-[a-z]{3,8}(-[a-z]{3,8})?|align-(center|right|justify)|table|formula(-block)?|comment-mark|resolved|luecke|frei|code|code-hell|erledigt|folie|folie-z)$/;

  /* ── Abstand statt Leerzeichen ──────────────────────────────────────
     `j-luecke` ist der Abstandshalter, den ein Klick rechts neben schon
     geschriebenen Text setzt (canvas/text.js). Er traegt keinen Text,
     nur eine Breite – und die MUSS hier durchkommen, sonst waere er nach
     dem ersten Abgleich null Pixel breit und die Stelle verloren.

     Welche Elemente einen Einzug tragen duerfen. Ein Mass an einem
     <span> mitten im Satz waere etwas anderes als ein Absatzeinzug und
     hat hier nichts zu suchen – der Abstandshalter ist die einzige
     Ausnahme, und er wird eigens geprueft. */
  const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                              'LI', 'UL', 'OL', 'BLOCKQUOTE']);

  /* Nur eine nackte Pixelzahl, hoechstens vier Stellen. Kein calc(), kein
     var(), keine andere Einheit – gebraucht wird nur, was canvas/text.js
     selbst schreibt, und das ist immer „<Zahl>px". */
  const istAbstand = (wert) => /^\d{1,4}(\.\d{1,2})?px$/.test(String(wert || '').trim());

  /* KaTeX erzeugt beim Rendern eine Vielzahl innerer Elemente mit eigenen
     Klassen. Sie alle aufzuzählen wäre brüchig – jede neue KaTeX-Version
     kann andere mitbringen. Weil KaTeX-Ausgabe aber reine Darstellung ist
     (keine Handler, keine URLs), bekommt sie einen eigenen, breiteren
     Filter: alles, was mit 'katex' beginnt, und alle kurzen Mathe-Klassen
     der Form m… (mord, mfrac etc.) und Hilfsklassen (base, strut, vlist). */
  const KATEX_KLASSEN = /^(katex|katex-(html|mathml|display)|base|strut|vlist|accent|overline|reset-size|sizing|delimsizing|nulldelimiter|op-symbol|m[a-z]{2,10}(-[a-z]{2,10})?)$/;

  /* Die Sprachen, die der Einfaerber kennt (core/code.js). Bewusst eine
     Liste und kein Muster: was hier durchkommt, wird zu einer CSS-Klasse. */
  const SPRACHEN = new Set(['text', 'java', 'python', 'c', 'cpp', 'csharp',
    'javascript', 'typescript', 'html', 'css', 'sql', 'bash', 'json', 'xml', 'php']);
  const istSprache = (wert) => SPRACHEN.has(String(wert || '').trim().toLowerCase());

  /* Nur an Tabellenzellen, nur diese zwei, und nur als kleine Zahl. Ohne
     sie ginge eine verbundene Zelle beim ersten Abgleich auseinander –
     eingefügt aus Word kommt so etwas regelmäßig. */
  const ZELLEN_ATTRIBUTE = new Set(['colspan', 'rowspan']);
  const istSpanne = (wert) => /^[1-9]\d{0,1}$/.test(String(wert).trim());

  /* Die gezogene Spaltenbreite an <col> und die gezogene Zeilenhoehe an
     <tr> (core/tables.js). Beide stehen als Attribut da und nicht als
     style, denn von einem style bleibt unten allein die Farbe stehen –
     Breite und Hoehe waeren beim ersten Abgleich weg.
     Erlaubt ist eine nackte Zahl, nichts weiter. */
  const istMass = (wert) => /^[1-9]\d{0,3}$/.test(String(wert).trim());

  /* Die Stelle einer frei gesetzten Tabelle (core/tables.js). Sie steht
     aus demselben Grund als Attribut da wie Breite und Hoehe – und darf,
     anders als ein Mass, auch 0 sein: links oben ist eine gueltige Lage. */
  const istStelle = (wert) => /^\d{1,4}$/.test(String(wert).trim());

  /* ══════════════════════════════════════════════════════════════════
     WELCHE ADRESSE AN EINEM VERWEIS STEHEN DARF

     Ausdruecklich eine Liste des ERLAUBTEN und nicht des Verbotenen.
     Eine Sperrliste waere hier besonders truegerisch: sie muesste
     javascript: treffen, aber auch  java\nscript: ,  JaVaScRiPt: ,
     &#106;avascript: und was der Browser sonst noch als dasselbe liest.

     Drei Arten kommen durch:

       http:  und  https:   das gewoehnliche Netz
       mailto:              eine Mailadresse
       inkwells:             die eigene Adresse der App, ueber die ein
                            Freigabe-Link geoeffnet wird (main.js)

     Gepruefte wird ueber den URL-Parser des Browsers und nicht mit einem
     eigenen regulaeren Ausdruck: der Parser liest die Adresse GENAU SO,
     wie sie spaeter auch benutzt wird, und faellt auf keine der
     Schreibweisen oben herein.

     >>> Warum relative Adressen durchfallen <<<
     Sie brauchen eine Grundlage, und die ist in der App der oertliche
     Server und auf der Website inkwells.me. Ein Verweis auf die eigene
     Seite ergibt in einem Heft keinen Sinn und waere nur ein Weg, auf
     Dateien der Oberflaeche zu zeigen.
     ══════════════════════════════════════════════════════════════════ */
  const ERLAUBTE_SCHEMATA = new Set(['http:', 'https:', 'mailto:', 'inkwells:']);

  function istAdresse(wert) {
    if (typeof wert !== 'string') return false;
    const roh = wert.trim();
    if (!roh || roh.length > 2048) return false;
    try {
      return ERLAUBTE_SCHEMATA.has(new URL(roh).protocol);
    } catch (err) {
      return false;   // ohne Schema, also relativ – siehe oben
    }
  }

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
      /* ══════════════════════════════════════════════════════════════
         VOM style BLEIBT DIE FARBE – UND DER ABSTAND

         Lange blieb hier nur die Farbe stehen. Dazugekommen sind drei
         Masse, mit denen Inkwells seit der Umstellung auf „Abstand statt
         Leerzeichen" die Stelle hält, an die jemand geklickt hat
         (canvas/text.js):

           margin-left  Einzug eines Absatzes
           margin-top   Abstand nach oben, auf ganze Zeilen gerundet
           width        die Breite eines Abstandshalters (span.j-luecke)

         Vorher stand dort, wo diese Masse jetzt stehen, ein Block aus
         Leerzeichen im TEXT. Fielen die Masse hier weg, käme das aufs
         Gleiche hinaus wie damals: die Stelle wäre beim ersten Abgleich
         verloren.

         Durchgelassen wird nur eine geprüfte Zahl in Pixeln (istAbstand)
         und nur an einem Element, das sie tragen darf. Ein Mass kann
         nichts ausführen; das Schlimmste, was ein zu grosser Wert
         anrichtet, ist ein Absatz, der weit rechts steht – deshalb die
         Obergrenze. */
      if (name === 'style') {
        const farbe = el.style && el.style.color;
        const links = el.style && el.style.marginLeft;
        const oben = el.style && el.style.marginTop;
        const breite = el.style && el.style.width;
        const vonLinks = el.style && el.style.left;
        const vonOben = el.style && el.style.top;
        const istBlock = BLOCK_TAGS.has(el.tagName);
        const istHalter = el.tagName === 'SPAN' && el.classList.contains('j-luecke');
        /* Ein frei stehender Absatz traegt seine Lage im style. Sie MUSS
           durchkommen: ohne sie stuende er beim naechsten Abgleich in der
           linken oberen Ecke, und zwar bei allen Beteiligten. Gepruefte
           Pixelzahl wie der Einzug auch – ein Mass kann nichts ausfuehren,
           und die Obergrenze haelt ihn auf dem Blatt. */
        const istFrei = istBlock && el.classList.contains('j-frei');

        /* ── Eine Stelle der unsichtbaren Folien-Textebene ─────────────
           Sie traegt Lage UND Schriftgroesse: nur damit sitzt die
           unsichtbare Schrift genau auf der sichtbaren im Bild
           darunter, und nur dann stimmt beim Markieren der Rahmen mit
           dem, was man sieht (core/importExport.js, folienTextEbene).

           Die Groesse ist die einzige Stelle, an der ein font-size
           durchkommt. Sie ist geprueft wie jedes andere Mass hier – ein
           Mass kann nichts ausfuehren, und die Obergrenze haelt es auf
           dem Blatt. */
        const istFolienStelle = el.tagName === 'SPAN' && el.classList.contains('j-folie-z');
        const groesse = el.style && el.style.fontSize;

        el.removeAttribute('style');
        if (istFarbe(farbe)) el.style.color = farbe;
        if (istBlock && istAbstand(links)) el.style.marginLeft = links;
        if (istBlock && istAbstand(oben)) el.style.marginTop = oben;
        if (istHalter && istAbstand(breite)) el.style.width = breite;
        if (istFrei && istAbstand(vonLinks)) el.style.left = vonLinks;
        if (istFrei && istAbstand(vonOben)) el.style.top = vonOben;
        if (istFolienStelle && istAbstand(vonLinks)) el.style.left = vonLinks;
        if (istFolienStelle && istAbstand(vonOben)) el.style.top = vonOben;
        if (istFolienStelle && istAbstand(groesse)) el.style.fontSize = groesse;
        continue;
      }

      // <font color="…"> – der Weg, auf dem Chromium foreColor ablegt
      if (name === 'color' && el.tagName === 'FONT' && istFarbe(wert)) continue;

      /* Die Adresse eines Verweises, siehe istAdresse(). Kommt sie nicht
         durch, faellt sie unten mit allem anderen weg – der Text des
         Verweises bleibt stehen, er ist dann nur nicht mehr anklickbar. */
      if (name === 'href' && el.tagName === 'A' && istAdresse(wert)) continue;

      /* Ein Verweis oeffnet sich im Standardbrowser (ui/links.js). Die
         beiden Angaben sind reine Vorsorge fuer die Website, wo er in
         einem neuen Reiter aufgeht: ohne noopener bekaeme die fremde
         Seite ueber window.opener Zugriff auf die unsere. */
      if (name === 'target' && el.tagName === 'A' && wert === '_blank') continue;
      if (name === 'rel' && el.tagName === 'A' && wert === 'noopener noreferrer') continue;

      // Verbundene Zellen, siehe ZELLEN_ATTRIBUTE
      if (ZELLEN_ATTRIBUTE.has(name) && (el.tagName === 'TD' || el.tagName === 'TH')
          && istSpanne(wert)) continue;

      // Gezogene Spaltenbreite und Zeilenhoehe, siehe istMass
      if (name === 'width' && el.tagName === 'COL' && istMass(wert)) continue;
      if (name === 'height' && el.tagName === 'TR' && istMass(wert)) continue;

      // Die Stelle einer frei gesetzten Tabelle, siehe istStelle
      if ((name === 'x' || name === 'y') && el.tagName === 'TABLE' && istStelle(wert)) continue;

      // data-latex auf Formel-Spans: der LaTeX-Quelltext, aus dem KaTeX rendert.
      // Ohne ihn wäre die Formel nach dem ersten Abgleich nicht mehr editierbar.
      if (name === 'data-latex' && el.tagName === 'SPAN'
          && el.classList.contains('j-formula')) continue;

      /* Der Abstandshalter ist ein Stück und keine Textstelle. Ohne
         dieses Attribut landete Getipptes IN ihm statt dahinter – für
         Chromium ist „hinter dem Element" dieselbe Stelle wie „am Ende
         des Elements", solange nichts dahinter steht (canvas/text.js).
         Nur an ihm und nur mit diesem einen Wert: 'true' wäre das
         Gegenteil und machte aus jedem Element ein Eingabefeld. */
      if (name === 'contenteditable' && el.tagName === 'SPAN'
          && el.classList.contains('j-luecke') && String(wert) === 'false') continue;

      /* Und derselbe Riegel an der Folien-Textebene: auswaehlen und
         kopieren ja, hineinschreiben nein. Ohne ihn tippte man beim
         Antippen der Folie mitten in den unsichtbaren Text hinein.
         Wieder nur 'false' – 'true' waere das Gegenteil. */
      if (name === 'contenteditable' && el.tagName === 'DIV'
          && el.classList.contains('j-folie') && String(wert) === 'false') continue;

      /* Die Sprache eines Codeblocks. Nur an einem <pre class="j-code">
         und nur einer aus der Liste – sie landet als Klasse im DOM und
         steuert die Einfärbung, da hat nichts Freies etwas zu suchen. */
      if (name === 'data-lang' && el.tagName === 'PRE'
          && el.classList.contains('j-code') && istSprache(wert)) continue;

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
