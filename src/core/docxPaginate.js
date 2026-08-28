'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DEN TEXT AUF SEITEN VERTEILEN

   Word ist ein durchlaufender Text: eine Seite ist dort das Ergebnis
   des Umbruchs, kein Behälter. Inkwells hat feste Seiten, jede mit
   eigenem contenteditable. Wer ein Word-Dokument öffnet, muss den
   Umbruch also selbst rechnen.

   >>> Warum gemessen und nicht gerechnet <<<
   Wie hoch ein Absatz wird, hängt an der Schrift, am Umbruch, an
   Ligaturen, an der Sprache. Das nachzurechnen hiesse, Chromiums
   Textsatz nachzubauen. Stattdessen wird der Text tatsächlich gesetzt –
   in einem unsichtbaren Behälter mit exakt der Geometrie von .j-text –
   und dann gefragt, wie hoch er geworden ist.

   >>> Warum der Behälter sichtbar sein MUSS (im Sinne von: gelayoutet) <<<
   display:none misst nichts, alle Höhen wären 0. Er steht deshalb im
   Dokument, nur weit außerhalb des Bildes (left: -10000px). Sichtbar
   ist er dadurch nicht, gemessen wird er trotzdem.

   ── Was geteilt werden kann ─────────────────────────────────────────
   Blöcke wandern einzeln hinein, bis es überläuft. Was für sich allein
   schon zu hoch ist, wird weiter geteilt:

     · Ein ABSATZ an der Zeilengrenze. Die Stelle findet Range über die
       Rechtecke der einzelnen Zeilen – wieder gemessen, nicht gerechnet.
     · Eine TABELLE nach Zeilen, mit wiederholter Kopfzeile.
     · Ein PLATZHALTER für ein Bild gar nicht: er ist ein Stück, sonst
       stünde das Bild halb auf zwei Seiten.

   Aufgerufen aus core/importExport.js beim Öffnen eines Dokuments.
   Geprüft in scripts/test-docx-import.
   ══════════════════════════════════════════════════════════════════════ */

(function (global) {

  /* Die Maße von .j-text (css/pages.css). Stimmen sie hier nicht,
     stimmt der Umbruch nicht – die Zahlen stehen deshalb genau einmal
     an dieser Stelle und werden nicht verstreut nachgerechnet. */
  const TEXT_TOP = 64;
  const TEXT_LEFT = 72;
  const TEXT_RIGHT = 32;
  const TEXT_BOTTOM = 24;
  const TEXT_PADDING_TOP = 19;
  const SCHRIFT_PX = 17;

  /** Zeilenhöhe je Papier – muss zu canvas/text.js passen (lhForBg). */
  function zeilenhoeheFuer(bg) {
    return (bg === 'grid' || bg === 'dots') ? 24 : 32;
  }

  /**
   * Der unsichtbare Messplatz.
   *
   * Bekommt dieselben Klassen wie eine echte Seite, damit die Regeln
   * aus css/pages.css greifen – .j-text hängt dort an .j-page, und die
   * Papierart entscheidet über die Zeilenhöhe.
   */
  function baueMessplatz(seitenBreite, bg) {
    const seite = document.createElement('div');
    seite.className = 'j-page bg-' + (bg || 'ruled');
    seite.style.cssText = 'position:absolute;left:-10000px;top:0;'
      + 'width:' + seitenBreite + 'px;height:10px;overflow:visible;'
      + 'visibility:hidden;pointer-events:none';

    const feld = document.createElement('div');
    feld.className = 'j-text';
    /* position:static, damit der Behälter mit dem Inhalt wächst – als
       absolutes Element mit top/bottom hätte er die Höhe der Seite und
       verriete über seine eigene Höhe gar nichts. */
    feld.style.cssText = 'position:static;'
      + 'width:' + (seitenBreite - TEXT_LEFT - TEXT_RIGHT) + 'px;'
      + 'font-size:' + SCHRIFT_PX + 'px;'
      + 'line-height:' + zeilenhoeheFuer(bg) + 'px;'
      + 'padding-top:0;overflow:visible';

    seite.appendChild(feld);
    document.body.appendChild(seite);
    return { seite, feld };
  }

  /** Die Höhe, die auf einer Seite für Text übrig bleibt. */
  function nutzhoehe(seitenHoehe) {
    return seitenHoehe - TEXT_TOP - TEXT_BOTTOM - TEXT_PADDING_TOP;
  }

  /* ══════════════════════════════════════════════════════════════════
     EINEN ABSATZ AN DER ZEILENGRENZE TEILEN
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Sucht die Textstelle, an der ein Element die Grenze überschreitet.
   *
   * Gearbeitet wird über Range.getClientRects(): ein Bereich über
   * mehrere Zeilen liefert je Zeile ein Rechteck. Gesucht wird der
   * längste Anfang, der noch ganz oberhalb der Grenze liegt.
   *
   * Zurück kommt die Stelle im FLACHEN Text (alle Textknoten
   * hintereinander), denn nur die überlebt das Zerschneiden.
   */
  function stelleAnGrenze(el, grenzeY) {
    const knoten = [];
    const lauf = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = lauf.nextNode())) knoten.push(n);
    if (!knoten.length) return -1;

    let gesamt = 0;
    for (const k of knoten) gesamt += k.nodeValue.length;
    if (!gesamt) return -1;

    const bereich = document.createRange();

    /** Liegt der Text bis `pos` noch ganz über der Grenze? */
    const passt = (pos) => {
      let rest = pos;
      let knoten1 = knoten[0], versatz = 0;
      for (const k of knoten) {
        if (rest <= k.nodeValue.length) { knoten1 = k; versatz = rest; break; }
        rest -= k.nodeValue.length;
      }
      bereich.setStart(knoten[0], 0);
      bereich.setEnd(knoten1, versatz);
      const rechtecke = bereich.getClientRects();
      if (!rechtecke.length) return true;
      return rechtecke[rechtecke.length - 1].bottom <= grenzeY;
    };

    // Binäre Suche über die Textstellen – bei langen Absätzen zählt das
    let tief = 0, hoch = gesamt, beste = 0;
    while (tief <= hoch) {
      const mitte = (tief + hoch) >> 1;
      if (passt(mitte)) { beste = mitte; tief = mitte + 1; }
      else hoch = mitte - 1;
    }

    /* Nicht mitten im Wort trennen: zurück bis zum letzten Leerzeichen.
       Ohne das stünde „Zusammen-" am Seitenende und „arbeit" auf der
       nächsten, ohne Trennstrich und ohne Not. */
    const flach = knoten.map(k => k.nodeValue).join('');
    let schnitt = beste;
    while (schnitt > 0 && !/\s/.test(flach[schnitt - 1])) schnitt--;
    if (schnitt === 0) schnitt = beste;      // ein einziges langes Wort

    return schnitt > 0 && schnitt < gesamt ? schnitt : -1;
  }

  /**
   * Zerlegt ein Element an einer Textstelle in zwei.
   *
   * Beide Hälften behalten ihre Auszeichnung: geschnitten wird durch
   * den Baum hindurch, nicht an der Zeichenkette. Ein <b>, das über die
   * Stelle hinausreicht, steht danach in beiden Hälften.
   */
  function teileElement(el, stelle) {
    const kopie = el.cloneNode(true);

    const finde = (wurzel, pos) => {
      const lauf = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT);
      let rest = pos, k;
      while ((k = lauf.nextNode())) {
        if (rest <= k.nodeValue.length) return { knoten: k, versatz: rest };
        rest -= k.nodeValue.length;
      }
      return null;
    };

    const vorn = finde(el, stelle);
    const hinten = finde(kopie, stelle);
    if (!vorn || !hinten) return null;

    // Vorderteil: alles ab der Stelle weg
    const wegHinten = document.createRange();
    wegHinten.setStart(vorn.knoten, vorn.versatz);
    wegHinten.setEndAfter(el.lastChild || vorn.knoten);
    wegHinten.deleteContents();

    // Hinterteil: alles vor der Stelle weg
    const wegVorn = document.createRange();
    wegVorn.setStartBefore(kopie.firstChild || hinten.knoten);
    wegVorn.setEnd(hinten.knoten, hinten.versatz);
    wegVorn.deleteContents();

    return { erste: el, zweite: kopie };
  }

  /* ══════════════════════════════════════════════════════════════════
     DER UMBRUCH
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Verteilt Blöcke auf Seiten.
   *
   * @param {Array<{html:string, bild?:object, form?:object, umbruchDavor?:boolean}>} bloecke
   * @param {object} optionen
   * @param {number} [optionen.breite]   Seitenbreite
   * @param {number} [optionen.hoehe]    Seitenhöhe
   * @param {string} [optionen.bg]       Papierart
   * @param {(getan:number, gesamt:number)=>void} [optionen.onFortschritt]
   * @returns {Array<{html:string, bilder:Array<{src,w,h,x,y}>}>} je Seite
   */
  function verteile(bloecke, optionen = {}) {
    const breite = optionen.breite || (typeof CFG !== 'undefined' ? CFG.PAGE_W : 794);
    const hoehe = optionen.hoehe || (typeof CFG !== 'undefined' ? CFG.PAGE_H : 1123);
    const bg = optionen.bg || 'ruled';
    const grenze = nutzhoehe(hoehe);

    const { seite, feld } = baueMessplatz(breite, bg);

    const seiten = [];
    let aktuell = { teile: [], bilder: [] };

    const feldOben = () => feld.getBoundingClientRect().top;

    const seiteSchliessen = () => {
      if (!aktuell.teile.length && !aktuell.bilder.length) return;
      seiten.push({
        html: aktuell.teile.map(el => el.outerHTML).join(''),
        bilder: aktuell.bilder
      });
      aktuell = { teile: [], bilder: [] };
      feld.innerHTML = '';
    };

    try {
      for (let i = 0; i < bloecke.length; i++) {
        const block = bloecke[i];

        if (block.umbruchDavor && aktuell.teile.length) seiteSchliessen();

        /* Der Block wird angehängt und dann gemessen. Angehängt wird an
           den ECHTEN Messplatz und nicht an eine Kopie: nur so wirken
           Ränder und Abstände zu dem, was schon darauf steht. */
        const halter = document.createElement('div');
        halter.innerHTML = block.html;
        const neue = [...halter.children];
        if (!neue.length) continue;

        for (const el of neue) feld.appendChild(el);

        let ueber = feld.getBoundingClientRect().height > grenze;

        if (ueber) {
          /* Passt nichts von dem Block mehr auf diese Seite, kommt er
             ganz auf die nächste – aber nur, wenn dort schon etwas
             steht. Sonst liefe es endlos: eine leere Seite, auf die
             wieder nichts passt. */
          const warSchonWas = aktuell.teile.length > 0;

          if (warSchonWas) {
            for (const el of neue) el.remove();
            seiteSchliessen();
            for (const el of neue) feld.appendChild(el);
            ueber = feld.getBoundingClientRect().height > grenze;
          }
        }

        if (ueber) {
          /* Immer noch zu hoch, und die Seite ist leer: der Block muss
             selbst geteilt werden. */
          const rest = teileZuHohen(neue, feld, feldOben() + grenze, block);
          // Was gemessen auf die Seite passt, bleibt stehen
          aktuell.teile = [...feld.children];
          if (block.bild || block.form) aktuell.bilder.push(objektLage(feld, block, feldOben()));
          seiteSchliessen();

          if (rest && rest.length) {
            /* Der Rest wird wie ein neuer Block behandelt – auch er kann
               wieder zu hoch sein, deshalb zurück in die Schleife. */
            bloecke.splice(i + 1, 0, { html: rest.map(el => el.outerHTML).join('') });
          }
          continue;
        }

        aktuell.teile = [...feld.children];
        if (block.bild || block.form) aktuell.bilder.push(objektLage(feld, block, feldOben()));

        if (optionen.onFortschritt && (i % 25 === 0)) optionen.onFortschritt(i, bloecke.length);
      }

      seiteSchliessen();
    } finally {
      seite.remove();
    }

    return seiten.length ? seiten : [{ html: '', bilder: [] }];
  }

  /**
   * Wo genau liegt das Objekt zu diesem Platzhalter?
   *
   * Der Platzhalter besteht aus leeren Absätzen; sein oberster Rand ist
   * die Stelle, an der das Objekt anfangen soll. Gerechnet wird relativ
   * zum Textfeld und dann um dessen Lage auf der Seite verschoben –
   * Objekte sitzen in Seitenkoordinaten (canvas/objects.js).
   *
   * Eine Form mit Text hält keinen Platz frei, sondern legt sich um den
   * Text, der ohnehin dort steht (passtSichAn). Ihre Höhe steht deshalb
   * erst hier fest – vorher weiss niemand, wie viele Zeilen es werden.
   */
  function objektLage(feld, block, feldObenY) {
    const q = block.bild || block.form;
    const kinder = [...feld.children];

    if (q.passtSichAn) {
      const halter = document.createElement('div');
      halter.innerHTML = block.html;
      const anzahl = Math.max(1, halter.children.length);
      const erste = kinder[kinder.length - anzahl] || kinder[kinder.length - 1];
      const letzte = kinder[kinder.length - 1];
      if (!erste || !letzte) return { ...q, x: TEXT_LEFT, y: TEXT_TOP };
      const oben = erste.getBoundingClientRect().top - feldObenY;
      const unten = letzte.getBoundingClientRect().bottom - feldObenY;
      return {
        ...q,
        h: Math.max(8, Math.round(unten - oben)),
        x: TEXT_LEFT,
        y: Math.round(TEXT_TOP + TEXT_PADDING_TOP + oben)
      };
    }

    const anzahl = (block.html.match(/<p>/g) || []).length;
    const erste = kinder[kinder.length - anzahl] || kinder[kinder.length - 1];
    if (!erste) return { ...q, x: TEXT_LEFT, y: TEXT_TOP };

    const oben = erste.getBoundingClientRect().top - feldObenY;
    return {
      ...q,
      x: TEXT_LEFT,
      y: Math.round(TEXT_TOP + TEXT_PADDING_TOP + oben)
    };
  }

  /**
   * Teilt einen Block, der allein schon zu hoch ist.
   *
   * Gibt zurück, was NICHT mehr auf die Seite passt (als Elemente).
   * Was passt, bleibt im Messplatz stehen.
   */
  function teileZuHohen(neue, feld, grenzeY, block) {
    /* Ein Bild-Platzhalter wird nicht geteilt – ein halbes Bild auf zwei
       Seiten wäre schlimmer als eine kurze Seite davor. Für eine Form
       gilt dasselbe: ihr Rahmen liefe sonst über den Seitenrand. */
    if (block.bild || block.form) return null;

    const rest = [];

    for (const el of [...feld.children]) {
      const r = el.getBoundingClientRect();
      if (r.top >= grenzeY) {
        // Fängt schon unterhalb an: ganz auf die nächste Seite
        rest.push(el);
        el.remove();
        continue;
      }
      if (r.bottom <= grenzeY) continue;      // passt

      // Ragt hinüber: Tabellen nach Zeilen, alles andere nach Textstelle
      if (el.tagName === 'TABLE') {
        const uebrig = teileTabelle(el, grenzeY);
        if (uebrig) rest.push(uebrig);
        continue;
      }

      const stelle = stelleAnGrenze(el, grenzeY);
      if (stelle < 0) {
        /* Nicht teilbar (ein einziges Wort, ein Bild) – dann steht es
           ganz auf der nächsten Seite. */
        rest.push(el);
        el.remove();
        continue;
      }

      const zwei = teileElement(el, stelle);
      if (zwei) rest.push(zwei.zweite);
    }

    return rest;
  }

  /**
   * Schneidet eine Tabelle an der Grenze durch.
   *
   * Die Kopfzeile wird auf der Folgeseite wiederholt – ohne sie stünden
   * dort Zahlen ohne Spaltennamen. Genau das macht Word auch.
   */
  function teileTabelle(tabelle, grenzeY) {
    const koerper = tabelle.tBodies[0];
    if (!koerper) return null;

    const zeilen = [...koerper.rows];
    const kopf = zeilen[0] && zeilen[0].querySelector('th') ? zeilen[0] : null;

    let ersteRaus = -1;
    for (let i = 0; i < zeilen.length; i++) {
      if (zeilen[i].getBoundingClientRect().bottom > grenzeY) { ersteRaus = i; break; }
    }
    // Auch die Kopfzeile passt nicht mehr: die ganze Tabelle geht weiter
    if (ersteRaus <= 0) return null;

    const zweite = tabelle.cloneNode(false);
    const colgroup = tabelle.querySelector('colgroup');
    if (colgroup) zweite.appendChild(colgroup.cloneNode(true));
    const neuerKoerper = document.createElement('tbody');
    zweite.appendChild(neuerKoerper);

    if (kopf) neuerKoerper.appendChild(kopf.cloneNode(true));
    for (let i = ersteRaus; i < zeilen.length; i++) {
      neuerKoerper.appendChild(zeilen[i]);
    }

    return neuerKoerper.rows.length > (kopf ? 1 : 0) ? zweite : null;
  }

  global.InkwellsDocxPaginate = {
    verteile,
    zeilenhoeheFuer,
    nutzhoehe,
    __intern: { stelleAnGrenze, teileElement, teileTabelle, baueMessplatz, TEXT_TOP, TEXT_LEFT }
  };
})(typeof window !== 'undefined' ? window : globalThis);
