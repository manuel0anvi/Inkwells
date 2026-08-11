'use strict';

/* ══════════════════════════════════════════════════════════════════════
   AUFZÄHLUNGEN UND NUMMERIERUNGEN

   Ein Punkt oder eine Nummer vor jeder Zeile – an, aus, und in mehreren
   Formen. Bedient wird das über die zwei Knöpfe in der Leiste
   (ui/toolbar.js), über Tab/Enter/Rücktaste beim Schreiben (app.js) und
   über das Tippen von „1. " oder „- " am Zeilenanfang.

   >>> Warum der Stil an einer KLASSE hängt und nicht am style-Attribut <<<
   Der Seitentext geht durch core/sanitize.js, und von einem style bleibt
   dort allein die Farbe stehen – ein `list-style-type` würde also beim
   nächsten Öffnen eines geteilten Hefts verschwinden. Klassen dagegen
   sind ausdrücklich erlaubt (`j-list-…`), und die Darstellung steht in
   css/pages.css. Damit übersteht der Stil den Weg über Firestore, über
   eine .jrnl-Datei und über den Word-Export.

   >>> Warum das Verschachteln von Hand geschieht <<<
   Für „eine Ebene tiefer" gäbe es execCommand('indent'). Chromium legt
   dabei aber <ul> DIREKT in <ul> – ohne das <li> dazwischen. Das rendert
   zwar, doch beim Ausrücken steht dann kein Eltern-Punkt zur Verfügung,
   an dem die Zeile wieder auftauchen könnte, und der Word-Export zählt
   die Ebene falsch. indent()/outdent() unten bauen deshalb sauberes
   <li><ul>…</ul></li> und kommen mit dem Chromium-Gebilde in alten
   Heften trotzdem zurecht.
   ══════════════════════════════════════════════════════════════════════ */

(function (global) {

  /* ── Die Formen ────────────────────────────────────────────────────
     `id`     wird zur Klasse `j-list-<id>` (siehe css/pages.css)
     `tag`    UL für Punkte, OL für Nummern
     `probe`  was in der Auswahlliste der Leiste als Vorschau steht;
              bei Nummern die ersten drei Marken
     ────────────────────────────────────────────────────────────────── */
  const LIST_STYLES = [
    // Punkte
    { id: 'disc',        tag: 'UL', probe: ['●', '●', '●'],    labelKey: 'listDisc' },
    { id: 'circle',      tag: 'UL', probe: ['○', '○', '○'],    labelKey: 'listCircle' },
    { id: 'square',      tag: 'UL', probe: ['▪', '▪', '▪'],    labelKey: 'listSquare' },
    { id: 'dash',        tag: 'UL', probe: ['–', '–', '–'],    labelKey: 'listDash' },
    { id: 'arrow',       tag: 'UL', probe: ['➤', '➤', '➤'],    labelKey: 'listArrow' },
    { id: 'check',       tag: 'UL', probe: ['✓', '✓', '✓'],    labelKey: 'listCheck' },
    // Nummern
    { id: 'decimal',     tag: 'OL', probe: ['1.', '2.', '3.'], labelKey: 'listDecimal' },
    { id: 'paren',       tag: 'OL', probe: ['1)', '2)', '3)'], labelKey: 'listParen' },
    { id: 'lower-alpha', tag: 'OL', probe: ['a.', 'b.', 'c.'], labelKey: 'listLowerAlpha' },
    { id: 'alpha-paren', tag: 'OL', probe: ['a)', 'b)', 'c)'], labelKey: 'listAlphaParen' },
    { id: 'upper-alpha', tag: 'OL', probe: ['A.', 'B.', 'C.'], labelKey: 'listUpperAlpha' },
    { id: 'lower-roman', tag: 'OL', probe: ['i.', 'ii.', 'iii.'], labelKey: 'listLowerRoman' },
    { id: 'upper-roman', tag: 'OL', probe: ['I.', 'II.', 'III.'], labelKey: 'listUpperRoman' }
  ];

  const STYLE_BY_ID = new Map(LIST_STYLES.map(s => [s.id, s]));
  const DEFAULT_UL = 'disc';
  const DEFAULT_OL = 'decimal';

  const KLASSEN_PRAEFIX = 'j-list-';

  function styleById(id) {
    return STYLE_BY_ID.get(id) || STYLE_BY_ID.get(DEFAULT_UL);
  }

  /* Zuletzt gewählte Form je Art, und welche Art zuletzt an der Reihe
     war. Bleibt über Sitzungen erhalten – wer einmal auf Striche
     umgestellt hat, will sie beim nächsten Mal wieder, und wer Nummern
     benutzt, soll nicht bei jedem Start wieder Punkte bekommen.

     Die Art wird eigens gemerkt, seit es nur noch EINEN Knopf gibt
     (ui/toolbar.js): er muss ja wissen, was er beim Draufdrücken macht
     und welches Bild er zeigt. */
  let letzterUl = DEFAULT_UL;
  let letzterOl = DEFAULT_OL;
  let letzteArt = 'ul';

  function ladeGemerkteStile() {
    if (typeof Settings === 'undefined' || !Settings.get) return;
    const ul = Settings.get('listStyleUl');
    const ol = Settings.get('listStyleOl');
    const art = Settings.get('listKind');
    if (STYLE_BY_ID.has(ul) && styleById(ul).tag === 'UL') letzterUl = ul;
    if (STYLE_BY_ID.has(ol) && styleById(ol).tag === 'OL') letzterOl = ol;
    if (art === 'ul' || art === 'ol') letzteArt = art;
  }

  function merkeStil(style) {
    if (style.tag === 'OL') { letzterOl = style.id; letzteArt = 'ol'; }
    else { letzterUl = style.id; letzteArt = 'ul'; }
    if (typeof Settings !== 'undefined' && Settings.set) {
      Settings.set(style.tag === 'OL' ? 'listStyleOl' : 'listStyleUl', style.id);
      Settings.set('listKind', letzteArt);
    }
  }

  /* ── Wo stehen wir? ──────────────────────────────────────────────── */

  function istListe(el) {
    return !!el && el.nodeType === 1 && (el.tagName === 'UL' || el.tagName === 'OL');
  }

  /** Das Textfeld, in dem die Schreibmarke steht. */
  function aktivesTextfeld() {
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    const node = sel.getRangeAt(0).startContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !el.closest) return null;
    return el.closest('.j-text');
  }

  /**
   * Dasselbe, aber nur, wenn hier auch geschrieben werden darf.
   *
   * >>> Warum das eigens geprüft wird <<<
   * Ein geteiltes Dokument ohne Bearbeitungsrecht wird sonst doch
   * verändert: applyMode() (ui/toolbar.js) setzt contenteditable allein
   * nach dem Werkzeug und weiß von S.readOnly nichts, und der Riegel in
   * app.js hängt an 'beforeinput' – das feuert bei einem Umbau von Hand
   * gar nicht. Ein Klick auf „Aufzählung" hätte die fremde Seite also
   * umgebaut, und die Änderung wäre über Yjs bei allen gelandet.
   */
  function beschreibbaresTextfeld() {
    if (typeof S !== 'undefined' && S && S.readOnly) return null;
    const feld = aktivesTextfeld();
    if (!feld || feld.isContentEditable === false) return null;
    return feld;
  }

  function knotenAufwaerts(node, treffer, grenze) {
    let cur = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    while (cur && cur !== grenze) {
      if (treffer(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  /** Der Aufzählungspunkt, in dem die Marke steht. */
  function aktuellesLi(textDiv) {
    const feld = textDiv || aktivesTextfeld();
    if (!feld) return null;
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    return knotenAufwaerts(sel.getRangeAt(0).startContainer, el => el.tagName === 'LI', feld);
  }

  /** Die Liste, zu der ein Punkt gehört. */
  function listeVon(li) {
    return li && istListe(li.parentElement) ? li.parentElement : null;
  }

  function stilIdVon(list) {
    if (!list || !list.classList) return null;
    for (const c of list.classList) {
      if (c.indexOf(KLASSEN_PRAEFIX) === 0) {
        const id = c.slice(KLASSEN_PRAEFIX.length);
        if (STYLE_BY_ID.has(id)) return id;
      }
    }
    // Eine Liste ohne Klasse kommt aus einem alten Heft oder aus einer
    // eingefügten Fremdseite. Sie sieht aus wie die Voreinstellung.
    return list.tagName === 'OL' ? DEFAULT_OL : DEFAULT_UL;
  }

  function stempele(list, style) {
    if (!list || !list.classList) return;
    [...list.classList].forEach(c => { if (c.indexOf(KLASSEN_PRAEFIX) === 0) list.classList.remove(c); });
    list.classList.add(KLASSEN_PRAEFIX + style.id);
  }

  /**
   * Welche Listen soll ein Klick treffen?
   *
   * Bei gesetzter Marke genau die eine, in der sie steht. Bei einer
   * Auswahl über mehrere Zeilen alle, deren Punkte darin liegen – aber
   * nur die UNMITTELBAREN Eltern der getroffenen Punkte. Sonst würde
   * eine Auswahl in einer eingerückten Zeile auch die Liste darüber
   * umstellen, obwohl der Nutzer sie gar nicht angefasst hat.
   */
  function betroffeneListen(textDiv) {
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || !sel.rangeCount) return [];
    const range = sel.getRangeAt(0);

    const nah = listeVon(aktuellesLi(textDiv));
    if (sel.isCollapsed) return nah ? [nah] : [];

    const treffer = new Set();
    if (nah) treffer.add(nah);
    textDiv.querySelectorAll('li').forEach(li => {
      if (!range.intersectsNode(li)) return;
      const eltern = li.parentElement;
      if (istListe(eltern)) treffer.add(eltern);
    });
    return [...treffer];
  }

  /* ── Reiner Text wird zu Absätzen ───────────────────────────────────
     Solange nur getippt wurde, hält eine Seite ihren ganzen Inhalt als
     EINEN Textknoten mit echten \n (siehe canvas/text.js). Ein
     execCommand für Listen macht daraus einen einzigen Punkt über alle
     Zeilen – es gibt ja keine Blockgrenzen, an denen es trennen könnte.
     Deshalb vorher aufteilen; die Stelle der Marke bleibt dieselbe, weil
     ein Absatzwechsel im flachen Text genauso ein \n ist.
     ────────────────────────────────────────────────────────────────── */

  function reineZeilen(textDiv) {
    let out = '';
    const kinder = textDiv.childNodes;
    for (let i = 0; i < kinder.length; i++) {
      const n = kinder[i];
      if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue || '';
      else if (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR') {
        // Das letzte <br> ist der Platzhalter von contenteditable und
        // keine eigene Zeile – flatTextParts() sieht es genauso.
        if (i === kinder.length - 1) continue;
        out += '\n';
      }
    }
    return out.replace(/\r/g, '').split('\n');
  }

  function zuAbsaetzen(textDiv) {
    if (typeof isPlainTextEditable !== 'function' || !isPlainTextEditable(textDiv)) return false;

    const stelle = (typeof flatCaretPos === 'function') ? flatCaretPos(textDiv) : null;
    const zeilen = reineZeilen(textDiv);
    const stapel = document.createDocumentFragment();

    for (const zeile of zeilen) {
      const p = document.createElement('p');
      if (zeile) p.appendChild(document.createTextNode(zeile));
      else p.appendChild(document.createElement('br'));
      stapel.appendChild(p);
    }

    textDiv.textContent = '';
    textDiv.appendChild(stapel);
    if (stelle !== null && typeof setFlatCaret === 'function') setFlatCaret(textDiv, stelle);
    return true;
  }

  /* ── Ein Umbau am Stück ─────────────────────────────────────────────
     Einrücken, Ausrücken und der Formwechsel bauen Knoten von Hand um.
     Zwei Dinge gingen dabei ohne Zutun verloren:

       · Die AUSWAHL. Ein verschobenes <li> nimmt seine Textknoten mit,
         der Browser hält die Marke aber nicht überall daran fest.
         Gesichert wird deshalb in den flachen Stellen (canvas/text.js) –
         die ändern sich beim Verschachteln nicht, denn es kommt kein
         Zeichen und keine Zeile hinzu. Beide Enden, nicht nur der
         Anfang: sonst zerfiele eine Auswahl über mehrere Zeilen beim
         ersten Tab zu einer Schreibmarke, und der zweite Tab träfe nur
         noch eine Zeile.

       · RÜCKGÄNGIG. Ein Umbau von Hand löst kein 'beforeinput' aus, und
         genau dort setzt app.js den Sicherungspunkt. Ohne das hier wäre
         Strg+Z nach einem Tab wirkungslos.
     ────────────────────────────────────────────────────────────────── */

  let umbauTiefe = 0;

  function sichereRueckgaengig(textDiv) {
    const pgEl = textDiv && textDiv.closest ? textDiv.closest('.j-page') : null;
    const id = pgEl && pgEl.dataset ? pgEl.dataset.pgid : null;
    if (!id || typeof getPage !== 'function' || typeof pushPageHistory !== 'function') return;
    const info = getPage(id);
    if (info && info.page) pushPageHistory(info.page);
  }

  function markeSichern(textDiv) {
    if (typeof flatPosOfPoint !== 'function') return null;
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!textDiv.contains(r.startContainer)) return null;
    return {
      von: flatPosOfPoint(textDiv, r.startContainer, r.startOffset),
      bis: r.collapsed ? null : flatPosOfPoint(textDiv, r.endContainer, r.endOffset)
    };
  }

  function markeSetzen(textDiv, gemerkt) {
    if (!gemerkt || gemerkt.von === null || typeof setFlatCaret !== 'function') return;
    if (gemerkt.bis === null || gemerkt.bis === undefined || typeof flatRangeAt !== 'function') {
      setFlatCaret(textDiv, gemerkt.von);
      return;
    }
    const a = flatRangeAt(textDiv, gemerkt.von);
    const b = flatRangeAt(textDiv, gemerkt.bis);
    if (!a || !b) { setFlatCaret(textDiv, gemerkt.von); return; }
    try {
      const r = document.createRange();
      r.setStart(a.startContainer, a.startOffset);
      r.setEnd(b.startContainer, b.startOffset);
      const sel = global.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (err) {
      setFlatCaret(textDiv, gemerkt.von);
    }
  }

  /* Der Sicherungspunkt gehört an den ANFANG der ganzen Aktion, nicht an
     jede innere Runde – sonst bräuchte ein einziger Klick auf „Keine"
     bei einer dreifach verschachtelten Liste drei Mal Strg+Z. */
  function umbau(textDiv, tun) {
    const aeusserster = umbauTiefe === 0;
    umbauTiefe++;
    try {
      if (aeusserster) sichereRueckgaengig(textDiv);
      const gemerkt = markeSichern(textDiv);
      const ergebnis = tun();
      markeSetzen(textDiv, gemerkt);
      return ergebnis;
    } finally {
      umbauTiefe--;
    }
  }

  /** Sagt der Seite Bescheid: speichern, an die anderen schicken, umbrechen. */
  function meldeAenderung(textDiv) {
    if (!textDiv) return;
    textDiv.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ── An und aus ─────────────────────────────────────────────────── */

  /**
   * Setzt eine Form – oder nimmt sie weg, wenn sie schon da ist.
   * @param {string} styleId
   * @param {boolean} [immerSetzen] true: nur setzen, nie ausschalten
   *        (die Auswahlliste soll eine Form anwenden, nicht umschalten)
   */
  function apply(styleId, immerSetzen) {
    const textDiv = beschreibbaresTextfeld();
    if (!textDiv) return false;

    const style = styleById(styleId);
    const listen = betroffeneListen(textDiv);
    const gleicheForm = listen.length && listen.every(l => stilIdVon(l) === style.id);

    merkeStil(style);

    // Schon genau diese Form: der Klick schaltet sie aus.
    if (gleicheForm && !immerSetzen) return remove();

    // Schon eine Liste derselben Art (Punkte/Nummern): nur die Form wechseln
    if (listen.length && listen.every(l => l.tagName === style.tag)) {
      umbau(textDiv, () => listen.forEach(l => stempele(l, style)));
      meldeAenderung(textDiv);
      return true;
    }

    zuAbsaetzen(textDiv);

    /* Von Punkten auf Nummern (und umgekehrt) macht execCommand die
       Umwandlung mit – es ersetzt <ul> durch <ol> und behält die Punkte.
       Alles von Hand nachzubauen hieße, die Auswahl über mehrere Absätze,
       Überschriften und verschachtelte Auszeichnungen selbst zu zerlegen. */
    document.execCommand(style.tag === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');

    // Die eben entstandenen Listen tragen noch keine Form
    betroffeneListen(textDiv).forEach(l => { if (l.tagName === style.tag) stempele(l, style); });
    textDiv.querySelectorAll('ul,ol').forEach(l => {
      const hatForm = [...l.classList].some(c => c.indexOf(KLASSEN_PRAEFIX) === 0);
      if (!hatForm) stempele(l, styleById(l.tagName === 'OL' ? DEFAULT_OL : DEFAULT_UL));
    });

    meldeAenderung(textDiv);
    return true;
  }

  /**
   * Der Knopf in der Leiste.
   *
   * Ohne Angabe gilt die zuletzt benutzte Art – der Knopf trägt ja ihr
   * Bild. Steht die Marke schon in einer Liste, gilt DEREN Art, sonst
   * würde aus dem Ausschalten ein Umstellen: wer zuletzt Nummern gewählt
   * hat und dann in einer Punkteliste auf den Knopf drückt, will sie weg
   * haben und keine Nummern daraus machen.
   *
   * @param {'ul'|'ol'} [art]
   */
  function toggle(art) {
    const hier = activeStyleId();
    const hierArt = hier ? (styleById(hier).tag === 'OL' ? 'ol' : 'ul') : null;
    if (!art) art = hierArt || letzteArt;

    /* Schon eine Liste dieser Art: der Knopf heißt jetzt „weg damit" –
       und zwar bei JEDER Form, nicht nur bei der zuletzt gewählten.
       Sonst würde aus dem Ausschalten ein Umstellen: wer zuletzt Striche
       gewählt hat und in einer Punkteliste auf den Knopf drückt, bekäme
       Striche statt gar keiner Liste. */
    if (hierArt === art) return remove();

    return apply(art === 'ol' ? letzterOl : letzterUl, true);
  }

  /**
   * Nimmt die Liste ganz weg; aus jedem Punkt wird wieder ein Absatz.
   *
   * >>> Warum das über outdent() läuft und nicht über execCommand <<<
   * Ein zweites insertUnorderedList würde bei einer VERSCHACHTELTEN
   * Liste nur eine Ebene ausrücken – die Zeile bliebe ein Punkt, bloß
   * einen Schritt weiter links. „Keine" soll aber heißen: gar keine
   * Aufzählung mehr. Also so oft ausrücken, bis wirklich keiner mehr da
   * ist; das ist derselbe Weg, den die Rücktaste geht, und er ist
   * geprüft.
   */
  function remove() {
    const textDiv = beschreibbaresTextfeld();
    if (!textDiv || !aktuellesLi(textDiv)) return false;

    let etwas = false;
    umbau(textDiv, () => {
      /* Tiefer als eine Handvoll Ebenen verschachtelt niemand. Die
         Obergrenze steht trotzdem da: eine Endlosschleife wäre schlimmer
         als ein übrig gebliebener Punkt. */
      for (let runde = 0; runde < 12 && aktuellesLi(textDiv); runde++) {
        if (!outdent()) break;
        etwas = true;
      }
    });

    aufraeumen(textDiv);
    if (etwas) meldeAenderung(textDiv);
    return etwas;
  }

  /* Leere Listenhüllen, die beim Umbauen übrig bleiben. */
  function aufraeumen(textDiv) {
    if (!textDiv) return;
    textDiv.querySelectorAll('ul,ol').forEach(l => {
      if (!l.querySelector('li')) l.remove();
    });
  }

  /* ── Ebenen ─────────────────────────────────────────────────────── */

  /** Alle Punkte, die eine Einrück-Aktion betrifft – in Dokumentreihenfolge. */
  function betroffenePunkte(textDiv) {
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || !sel.rangeCount) return [];

    const nah = aktuellesLi(textDiv);
    if (sel.isCollapsed) return nah ? [nah] : [];

    const range = sel.getRangeAt(0);

    /* Ein Punkt zählt nur mit, wenn sein EIGENER Inhalt in der Auswahl
       liegt. Sonst wäre jeder Punkt betroffen, in dem bloß eine
       eingerückte Liste steckt – und beim Einrücken wanderte die ganze
       Verschachtelung eine Ebene tiefer, obwohl nur eine Zeile darin
       markiert war. */
    return [...textDiv.querySelectorAll('li')].filter(li => {
      if (!range.intersectsNode(li)) return false;
      const eigenes = [...li.childNodes].find(n => !istListe(n));
      return eigenes ? range.intersectsNode(eigenes) : true;
    });
  }

  /** Eine Ebene tiefer. */
  function indent() {
    const textDiv = beschreibbaresTextfeld();
    if (!textDiv) return false;
    const punkte = betroffenePunkte(textDiv);
    if (!punkte.length) return false;

    const geschafft = umbau(textDiv, () => {
      let etwas = false;
      for (const li of punkte) {
        const liste = listeVon(li);
        if (!liste) continue;

        const davor = li.previousElementSibling;

        /* ── Der gewöhnliche Fall: unter den Punkt davor ──────────── */
        if (davor && davor.tagName === 'LI') {
          let unter = davor.lastElementChild;
          if (!istListe(unter)) {
            unter = document.createElement(liste.tagName);
            unter.className = liste.className;
            davor.appendChild(unter);
          }
          unter.appendChild(li);
          etwas = true;
          continue;
        }

        /* ── Der ERSTE Punkt einer Liste ──────────────────────────────
           Hier stand: „kann nicht tiefer – unter welchen denn?" Das ist
           die Sicht von HTML, wo eine Ebene ein Punkt IN einem Punkt
           ist. Word sieht es anders: dort ist eine Ebene ein Einzug,
           und der erste Punkt rückt genauso ein wie jeder andere.

           Gemeldet wurde genau das – „Unterpunkte gehen nicht": wer
           eine Aufzählung anfängt und gleich Tab drückt, sah nichts
           geschehen. Und das ist der häufigste Weg überhaupt, denn die
           erste Zeile ist die, an der man anfängt.

           Gebaut wird dafür eine Hülle an der STELLE des Punktes, nicht
           in einem Vorgänger: <ul><ul><li>…  Das ist zwar nicht die
           sauberste Verschachtelung, aber die einzige ohne einen leeren
           Eltern-Punkt, der als Marke ohne Text dastünde. Alles
           Übrige kommt damit zurecht – einenAusruecken() kennt die Form
           ausdrücklich, css/pages.css staffelt über den Nachfahren-
           Selektor, und core/docx.js zählt die Ebene an den Listen und
           nicht an den Punkten dazwischen.

           Ist der Vorgänger schon so eine Hülle, geht der Punkt dort
           hinein – sonst stünden zwei Unterlisten nebeneinander, wo
           eine gemeint war. */
        let unter = davor;
        if (!istListe(unter)) {
          unter = document.createElement(liste.tagName);
          unter.className = liste.className;
          liste.insertBefore(unter, li);
        }
        unter.appendChild(li);
        etwas = true;
      }
      return etwas;
    });

    if (geschafft) meldeAenderung(textDiv);
    return geschafft;
  }

  /** Eine Ebene höher – auf der obersten heißt das: raus aus der Liste. */
  function outdent() {
    const textDiv = beschreibbaresTextfeld();
    if (!textDiv) return false;
    const punkte = betroffenePunkte(textDiv);
    if (!punkte.length) return false;

    // Von hinten nach vorn: das Aufteilen einer Liste verschiebt sonst
    // die noch nicht behandelten Punkte.
    const geschafft = umbau(textDiv, () => {
      let etwas = false;
      for (let i = punkte.length - 1; i >= 0; i--) {
        if (einenAusruecken(punkte[i])) etwas = true;
      }
      aufraeumen(textDiv);
      return etwas;
    });

    if (geschafft) meldeAenderung(textDiv);
    return geschafft;
  }

  function einenAusruecken(li) {
    const liste = listeVon(li);
    if (!liste) return false;

    // Was unter diesem Punkt noch kommt, muss unter ihm bleiben
    const nachfolger = [];
    for (let n = li.nextElementSibling; n; n = n.nextElementSibling) {
      if (n.tagName === 'LI') nachfolger.push(n);
    }

    const traeger = liste.parentElement;

    /* Sauber verschachtelt: <li><ul><li>…  Der Punkt wandert hinter
       seinen Eltern-Punkt. */
    if (traeger && traeger.tagName === 'LI') {
      if (nachfolger.length) {
        const rest = document.createElement(liste.tagName);
        rest.className = liste.className;
        nachfolger.forEach(n => rest.appendChild(n));
        li.appendChild(rest);
      }
      traeger.parentNode.insertBefore(li, traeger.nextSibling);
      if (!liste.querySelector('li')) liste.remove();
      return true;
    }

    /* Was Chromium früher erzeugt hat: <ul><li>…</li><ul><li>…  Die
       innere Liste hängt direkt in der äußeren. Dann geht der Punkt
       hinter die innere Liste. */
    if (istListe(traeger)) {
      if (nachfolger.length) {
        const rest = document.createElement(liste.tagName);
        rest.className = liste.className;
        nachfolger.forEach(n => rest.appendChild(n));
        li.appendChild(rest);
      }
      traeger.insertBefore(li, liste.nextSibling);
      if (!liste.querySelector('li')) liste.remove();
      return true;
    }

    // Oberste Ebene: der Punkt wird wieder ein gewöhnlicher Absatz
    return ausDerListe(li, liste, nachfolger);
  }

  function ausDerListe(li, liste, nachfolger) {
    const eltern = liste.parentNode;
    if (!eltern) return false;

    const absatz = document.createElement('p');
    while (li.firstChild) absatz.appendChild(li.firstChild);
    if (!absatz.firstChild) absatz.appendChild(document.createElement('br'));

    let restListe = null;
    if (nachfolger.length) {
      restListe = document.createElement(liste.tagName);
      restListe.className = liste.className;
      nachfolger.forEach(n => restListe.appendChild(n));
      eltern.insertBefore(restListe, liste.nextSibling);
    }

    eltern.insertBefore(absatz, restListe || liste.nextSibling);
    li.remove();
    if (!liste.querySelector('li')) liste.remove();
    return true;
  }

  /* ── Beim Schreiben ─────────────────────────────────────────────── */

  /** Steht die Marke ganz am Anfang dieses Punktes? */
  function amAnfangVon(li) {
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
    const marke = sel.getRangeAt(0);
    try {
      const bis = document.createRange();
      bis.selectNodeContents(li);
      bis.setEnd(marke.startContainer, marke.startOffset);
      return bis.toString().length === 0;
    } catch (err) { return false; }
  }

  /** Hat dieser Punkt außer der Verschachtelung gar keinen Inhalt? */
  function istLeer(li) {
    for (const kind of li.childNodes) {
      if (istListe(kind)) continue;
      if (kind.nodeType === Node.TEXT_NODE && (kind.nodeValue || '').trim()) return false;
      if (kind.nodeType === Node.ELEMENT_NODE && kind.tagName !== 'BR'
        && (kind.textContent || '').trim()) return false;
    }
    return true;
  }

  /**
   * Enter in einer Liste.
   * @returns {boolean} true, wenn hier schon alles getan ist
   */
  function handleEnter() {
    /* Ohne beschreibbares Feld sofort raus. Nicht bloss `!li` prüfen:
       aktuellesLi() sucht sich das Feld selbst, wenn keines mitkommt –
       und fände es dann auch in einem Dokument, das nur gelesen werden
       darf. */
    const textDiv = beschreibbaresTextfeld();
    if (!textDiv) return false;

    const li = aktuellesLi(textDiv);
    if (!li) return false;

    /* Ein leerer Punkt und noch einmal Enter heißt: fertig mit dieser
       Ebene. Genau so verlässt man in Word eine Aufzählung. */
    if (istLeer(li)) { outdent(); return true; }

    document.execCommand('insertParagraph', false, null);
    meldeAenderung(textDiv);
    return true;
  }

  /**
   * Tab / Shift+Tab in einer Liste.
   * @returns {boolean} true, wenn hier schon alles getan ist
   */
  function handleTab(shift) {
    const textDiv = beschreibbaresTextfeld();
    if (!textDiv || !aktuellesLi(textDiv)) return false;
    if (shift) { outdent(); return true; }
    indent();
    return true;
  }

  /** Steht die Marke am Anfang eines Aufzählungspunktes? */
  function atListItemStart() {
    const li = aktuellesLi(aktivesTextfeld());
    return !!li && amAnfangVon(li);
  }

  /**
   * Rücktaste am Anfang eines Punktes: erst eine Ebene zurück, auf der
   * obersten raus aus der Liste. Auch das ist Word-Verhalten.
   * @returns {boolean} true, wenn hier schon alles getan ist
   */
  function handleBackspace() {
    if (!atListItemStart()) return false;
    outdent();
    return true;
  }

  /* ── „1. " getippt, Liste daraus ────────────────────────────────────
     Word wandelt eine Zeile um, sobald am Anfang eine Marke und dann ein
     Leerzeichen steht. Nur dann, und nur solange dahinter noch nichts
     kommt – wer mitten im Satz „z. B." schreibt, meint keine Liste.

     Rückgängig geht es mit Strg+Z; die Sicherung dafür hat 'beforeinput'
     schon gesetzt, bevor das Leerzeichen im Text stand.
     ────────────────────────────────────────────────────────────────── */

  const AUTO_MARKEN = [
    [/^[*•]$/, 'disc'],
    [/^-$/, 'dash'],
    [/^>$/, 'arrow'],
    [/^\d{1,3}\.$/, 'decimal'],
    [/^\d{1,3}\)$/, 'paren'],
    [/^[iI]\.$/, 'lower-roman'],
    [/^[a-z]\.$/, 'lower-alpha'],
    [/^[a-z]\)$/, 'alpha-paren'],
    [/^[A-Z]\.$/, 'upper-alpha'],
    [/^[A-Z]\)$/, 'upper-alpha']
  ];

  function markeZuStil(text) {
    for (const [muster, id] of AUTO_MARKEN) {
      if (muster.test(text)) {
        // „I." ist römisch groß, „i." römisch klein
        if (id === 'lower-roman' && text[0] === 'I') return 'upper-roman';
        return id;
      }
    }
    return null;
  }

  let umbauLaeuft = false;

  /**
   * Prüft nach jedem Anschlag, ob gerade eine Marke fertig getippt wurde.
   * Wird aus dem 'input'-Ereignis der Seite gerufen (app.js).
   * @returns {boolean} true, wenn daraus eine Liste geworden ist
   */
  function autoFormat(textDiv) {
    if (umbauLaeuft || !textDiv) return false;
    if (typeof flatCaretPos !== 'function' || typeof flatTextOf !== 'function') return false;
    if (aktuellesLi(textDiv)) return false;      // in einer Liste schon erledigt

    const stelle = flatCaretPos(textDiv);
    if (stelle === null) return false;

    const inhalt = flatTextOf(textDiv);
    // Nur direkt nach dem Leerzeichen, nicht irgendwo mittendrin
    if (stelle > inhalt.length || inhalt[stelle - 1] !== ' ') return false;
    if (stelle < inhalt.length && inhalt[stelle] !== '\n') return false;

    const anfang = inhalt.lastIndexOf('\n', stelle - 1) + 1;
    const marke = inhalt.slice(anfang, stelle - 1);
    if (!marke || marke.length > 4) return false;

    const stilId = markeZuStil(marke);
    if (!stilId) return false;

    umbauLaeuft = true;
    try {
      // Die getippte Marke selbst muss weg – sie wird ja gemalt
      if (!loescheBereich(textDiv, anfang, stelle)) return false;
      apply(stilId, true);
    } finally {
      umbauLaeuft = false;
    }
    return true;
  }

  function loescheBereich(textDiv, von, bis) {
    if (typeof flatRangeAt !== 'function') return false;
    const a = flatRangeAt(textDiv, von);
    const b = flatRangeAt(textDiv, bis);
    if (!a || !b) return false;
    try {
      const bereich = document.createRange();
      bereich.setStart(a.startContainer, a.startOffset);
      bereich.setEnd(b.startContainer, b.startOffset);
      bereich.deleteContents();
      bereich.collapse(true);
      const sel = global.getSelection();
      sel.removeAllRanges();
      sel.addRange(bereich);
      return true;
    } catch (err) { return false; }
  }

  /* ── Auskunft für die Leiste ────────────────────────────────────── */

  /** Welche Form gilt an der Marke? null, wenn dort keine Liste ist. */
  function activeStyleId() {
    const textDiv = aktivesTextfeld();
    const liste = listeVon(aktuellesLi(textDiv));
    return liste ? stilIdVon(liste) : null;
  }

  global.Lists = {
    STYLES: LIST_STYLES,
    styleById,
    apply,
    toggle,
    remove,
    indent,
    outdent,
    handleEnter,
    handleTab,
    handleBackspace,
    atListItemStart,
    autoFormat,
    activeStyleId,
    lastStyleId(art) { return art === 'ol' ? letzterOl : letzterUl; },
    /** Welche Art war zuletzt an der Reihe? Das Bild auf dem Knopf. */
    lastKind() { return letzteArt; },
    loadSettings: ladeGemerkteStile
  };

  // Für Tests unter Node
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LIST_STYLES };
  }
})(typeof window !== 'undefined' ? window : globalThis);
