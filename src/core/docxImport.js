'use strict';

/* ══════════════════════════════════════════════════════════════════════
   EIN WORD-DOKUMENT ALS HEFT ÖFFNEN

   Der Rückweg zu core/docx.js. Dort wird eine .docx geschrieben, hier
   wird eine gelesen – dieselbe Bauart (ein ZIP voller XML), dieselben
   Maße, nur andersherum.

   ── Was hier NICHT versucht wird ────────────────────────────────────
   Ein Word-Dokument so aussehen zu lassen wie in Word. Dafür bräuchte
   es Words Umbruch-Rechnung: Silbentrennung, Kerning, Absatzabstände,
   Tabellenhöhen. Die gibt es hier nicht, und eine halbe Nachbildung
   wäre schlechter als eine ehrliche Übersetzung.

   Stattdessen wird der INHALT in Inkwells-Text übersetzt und neu
   umbrochen. Das Ergebnis ist änderbar wie jeder andere Heftinhalt –
   das ist der Sinn der Sache. Was dabei nicht mitkommt, sagt der
   Bericht am Ende (ui/homeGrid.js).

   ── Die harte Grenze ────────────────────────────────────────────────
   core/sanitize.js. Jeder Seitentext läuft dort hindurch, bevor er
   gespeichert oder abgeglichen wird. Was dort nicht erlaubt ist,
   überlebt den ersten Cloud-Abgleich nicht – erzeugt wird deshalb
   ausschließlich, was dort in der Liste steht. Der Test
   scripts/test-docx-import prüft genau das: erzeugter Text durch den
   Sanitizer muss UNVERÄNDERT herauskommen.

   ── Aufbau ──────────────────────────────────────────────────────────
     1. entpacke()      ZIP lesen (Verfahren 0 und 8)
     2. leseBeziehungen/leseNummerierung/leseVorlagen
     3. baueHtml()      w:p, w:r, w:tbl → Inkwells-HTML
     4. Bilder sammeln, Platz im Text freihalten
   Der Seitenumbruch steht in core/docxPaginate.js – er braucht ein
   sichtbares Fenster zum Messen und gehört deshalb nicht hierher.
   ══════════════════════════════════════════════════════════════════════ */

(function (global) {

  /* ── Namensräume ───────────────────────────────────────────────────
     Fest verdrahtet und nicht aus dem Dokument gelesen: sie sind Teil
     des Standards, jede .docx benutzt genau diese. */
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

  const EMU_PER_PX = 9525;          // wie in core/docx.js

  /* ══════════════════════════════════════════════════════════════════
     1. DAS ARCHIV ÖFFNEN

     Gegenstück zu zip() in core/docx.js. Gelesen wird über das
     Zentralverzeichnis am Ende und nicht über die lokalen Köpfe am
     Anfang: nur dort stehen die Größen zuverlässig. Wird beim Schreiben
     ein Datenbeschreiber benutzt (Bit 3 der Fahnen), sind die Größen im
     lokalen Kopf schlicht null – Word macht das nicht, andere Programme
     schon, und der Fehler wäre schwer zu finden.
     ══════════════════════════════════════════════════════════════════ */

  const EOCD_SIG = 0x06054b50;      // Ende des Zentralverzeichnisses
  const CEN_SIG = 0x02014b50;       // ein Eintrag darin

  /* ── Wie gross ein Archiv werden darf ──────────────────────────────
     Ein ZIP sagt in seinem Verzeichnis, wie gross ein Eintrag AUSGEPACKT
     wird – und diese Angabe wurde bisher nicht angesehen. Damit liess
     sich eine .docx von wenigen hundert Kilobyte bauen, die beim Oeffnen
     Gigabyte ergibt: das Fenster friert ein oder stirbt, ohne dass man
     saehe, warum.

     Word-Dateien kommen von aussen – aus einer E-Mail, aus einem
     Klassenchat. Sie sind damit dieselbe Art Quelle wie ein fremdes
     geteiltes Heft, und die wird seit core/sanitize.js geprueft.

     Die Grenzen sind grosszuegig: ein Dokument mit hundert Fotos bleibt
     weit darunter. Es geht nicht darum, grosse Dateien abzuweisen,
     sondern das offene Ende zu schliessen. */
  const MAX_EINTRAG_BYTES = 80 * 1024 * 1024;    // je Datei im Archiv
  const MAX_GESAMT_BYTES = 250 * 1024 * 1024;    // alles zusammen
  const MAX_EINTRAEGE = 5000;

  /** Das Ende des Zentralverzeichnisses suchen – von hinten. */
  function findeEocd(view, laenge) {
    /* Der Kommentar am Schluss darf bis 65535 Bytes lang sein; weiter
       vorn kann das Ende nicht liegen. Von hinten, damit ein Fund im
       Kommentar (der wie eine Signatur aussehen darf) nicht gewinnt. */
    const frueheste = Math.max(0, laenge - 22 - 0xFFFF);
    for (let i = laenge - 22; i >= frueheste; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) return i;
    }
    return -1;
  }

  /**
   * Packt ein Archiv aus.
   *
   * @param {Uint8Array} bytes
   * @returns {Promise<Map<string, Uint8Array>>} Name → Inhalt
   */
  async function entpacke(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findeEocd(view, bytes.byteLength);
    if (eocd < 0) throw new Error('NO_ZIP');

    const anzahl = view.getUint16(eocd + 10, true);
    let stelle = view.getUint32(eocd + 16, true);

    if (anzahl > MAX_EINTRAEGE) throw new Error('ZIP_TOO_BIG');

    const dateien = new Map();
    let gesamt = 0;

    for (let i = 0; i < anzahl; i++) {
      if (stelle + 46 > bytes.byteLength) throw new Error('ZIP_BROKEN');
      if (view.getUint32(stelle, true) !== CEN_SIG) throw new Error('ZIP_BROKEN');

      const verfahren = view.getUint16(stelle + 10, true);
      const gepackt = view.getUint32(stelle + 20, true);
      const entpackt = view.getUint32(stelle + 24, true);
      const namenLaenge = view.getUint16(stelle + 28, true);
      const extraLaenge = view.getUint16(stelle + 30, true);
      const kommentarLaenge = view.getUint16(stelle + 32, true);
      const lokal = view.getUint32(stelle + 42, true);

      const name = new TextDecoder('utf-8')
        .decode(bytes.subarray(stelle + 46, stelle + 46 + namenLaenge));

      /* Die Daten fangen erst NACH dem lokalen Kopf an, und dessen Name
         und Extrafeld sind nicht zwingend so lang wie hier im
         Verzeichnis – deshalb wird dort noch einmal nachgesehen.

         Der lokale Kopf ist 30 Bytes lang; liegt sein Anfang schon
         ausserhalb der Datei, ist das Verzeichnis kaputt. Ohne diese
         Pruefung kam an dieser Stelle ein RangeError aus dem DataView –
         eine technische Meldung, wo ein schlichtes „Datei beschaedigt"
         hingehoert. */
      if (lokal + 30 > bytes.byteLength) throw new Error('ZIP_BROKEN');
      const lokalNameLaenge = view.getUint16(lokal + 26, true);
      const lokalExtraLaenge = view.getUint16(lokal + 28, true);
      const von = lokal + 30 + lokalNameLaenge + lokalExtraLaenge;
      const roh = bytes.subarray(von, von + gepackt);

      // Ordnereinträge enden auf / und haben keinen Inhalt
      if (!name.endsWith('/')) {
        /* Erst nachsehen, DANN auspacken. Andersherum waere die Grenze
           wirkungslos: der Speicher ist schon voll, wenn man sie prueft. */
        if (entpackt > MAX_EINTRAG_BYTES) throw new Error('ZIP_TOO_BIG');
        gesamt += entpackt;
        if (gesamt > MAX_GESAMT_BYTES) throw new Error('ZIP_TOO_BIG');

        const inhalt = verfahren === 0 ? roh : await blase(roh);

        /* Und noch einmal danach. Die Angabe im Verzeichnis ist nur eine
           BEHAUPTUNG des Schreibers – wer eine Bombe baut, schreibt dort
           eine kleine Zahl hinein. Was wirklich herauskam, weiss man erst
           jetzt. */
        if (inhalt.byteLength > MAX_EINTRAG_BYTES) throw new Error('ZIP_TOO_BIG');
        gesamt += Math.max(0, inhalt.byteLength - entpackt);
        if (gesamt > MAX_GESAMT_BYTES) throw new Error('ZIP_TOO_BIG');

        dateien.set(name, inhalt);
      }

      stelle += 46 + namenLaenge + extraLaenge + kommentarLaenge;
    }

    return dateien;
  }

  /**
   * Deflate rückgängig machen.
   *
   * 'deflate-raw', nicht 'deflate': im ZIP stehen die reinen
   * Deflate-Daten ohne zlib-Kopf. Mit 'deflate' scheitert jede echte
   * Word-Datei an den ersten zwei Bytes.
   */
  async function blase(roh) {
    if (typeof DecompressionStream !== 'function') throw new Error('NO_INFLATE');
    const strom = new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(strom).arrayBuffer());
  }

  const alsText = (bytes) => bytes ? new TextDecoder('utf-8').decode(bytes) : '';

  function alsXml(bytes) {
    const text = alsText(bytes);
    if (!text) return null;
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    // Ein Parser-Fehler kommt als <parsererror> zurück, nicht als Ausnahme
    if (doc.getElementsByTagName('parsererror').length) throw new Error('BAD_XML');
    return doc;
  }

  /* ══════════════════════════════════════════════════════════════════
     2. DIE NEBENDATEIEN
     ══════════════════════════════════════════════════════════════════ */

  /** rId → Zielpfad, z. B. "rId7" → "media/bild1.png". */
  function leseBeziehungen(dateien) {
    const map = new Map();
    const doc = alsXml(dateien.get('word/_rels/document.xml.rels'));
    if (!doc) return map;
    for (const rel of doc.getElementsByTagNameNS(PKG_REL, 'Relationship')) {
      map.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
    }
    return map;
  }

  /**
   * numId → je Ebene die Listenform.
   *
   * Word geht über zwei Ecken: der Absatz nennt eine numId, die zeigt
   * auf eine abstrakte Nummerierung, und erst dort steht je Ebene das
   * Format. Beide Schritte müssen mit, sonst bekommt jede Liste die
   * Voreinstellung.
   */
  function leseNummerierung(dateien) {
    const proNumId = new Map();
    const doc = alsXml(dateien.get('word/numbering.xml'));
    if (!doc) return proNumId;

    const abstrakt = new Map();
    for (const an of doc.getElementsByTagNameNS(W, 'abstractNum')) {
      const id = an.getAttributeNS(W, 'abstractNumId');
      const ebenen = new Map();
      for (const lvl of an.getElementsByTagNameNS(W, 'lvl')) {
        const ilvl = lvl.getAttributeNS(W, 'ilvl');
        const fmt = lvl.getElementsByTagNameNS(W, 'numFmt')[0];
        ebenen.set(ilvl, fmt ? fmt.getAttributeNS(W, 'val') : 'bullet');
      }
      abstrakt.set(id, ebenen);
    }

    for (const num of doc.getElementsByTagNameNS(W, 'num')) {
      const numId = num.getAttributeNS(W, 'numId');
      const zeiger = num.getElementsByTagNameNS(W, 'abstractNumId')[0];
      const ziel = zeiger ? zeiger.getAttributeNS(W, 'val') : null;
      if (ziel && abstrakt.has(ziel)) proNumId.set(numId, abstrakt.get(ziel));
    }
    return proNumId;
  }

  /**
   * Formatvorlage → Gliederungsebene (0 = Überschrift 1).
   *
   * >>> Warum nicht über den Namen <<<
   * Die Vorlage heißt in deutschem Word "berschrift1", in englischem
   * "Heading1", in italienischem "Titolo1". Über den Namen zu gehen
   * hiesse, für jede Sprache eine Liste zu pflegen – und beim ersten
   * unbekannten Word wären alle Überschriften weg. w:outlineLvl steht
   * in der Vorlage selbst und ist überall dieselbe Zahl.
   */
  function leseVorlagen(dateien) {
    const map = new Map();
    const doc = alsXml(dateien.get('word/styles.xml'));
    if (!doc) return map;

    for (const style of doc.getElementsByTagNameNS(W, 'style')) {
      if (style.getAttributeNS(W, 'type') !== 'paragraph') continue;
      const id = style.getAttributeNS(W, 'styleId');
      const lvl = style.getElementsByTagNameNS(W, 'outlineLvl')[0];
      if (id && lvl) {
        const n = parseInt(lvl.getAttributeNS(W, 'val'), 10);
        if (Number.isFinite(n)) map.set(id, n);
      }
    }
    return map;
  }

  /* ══════════════════════════════════════════════════════════════════
     3. HILFEN AM XML
     ══════════════════════════════════════════════════════════════════ */

  /** Direktes Kind mit diesem Namen – nicht irgendein Nachfahre. */
  function kind(el, name) {
    if (!el) return null;
    for (const k of el.children) {
      if (k.localName === name && k.namespaceURI === W) return k;
    }
    return null;
  }

  function kinder(el, name) {
    const out = [];
    if (!el) return out;
    for (const k of el.children) {
      if (k.localName === name && k.namespaceURI === W) out.push(k);
    }
    return out;
  }

  /**
   * Ist eine An/Aus-Eigenschaft gesetzt?
   *
   * In OOXML heißt <w:b/> „fett" und <w:b w:val="0"/> „ausdrücklich
   * nicht fett". Das zweite kommt vor, wenn eine Vorlage fett ist und
   * ein einzelnes Wort es nicht sein soll. Nur auf Vorhandensein zu
   * prüfen, macht dieses Wort fälschlich fett.
   */
  function anAus(el, name) {
    const k = kind(el, name);
    if (!k) return false;
    const val = k.getAttributeNS(W, 'val');
    return val === null || val === '' || val === '1' || val === 'true' || val === 'on';
  }

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /** Eine Word-Farbe als #rrggbb, oder null bei „automatisch". */
  function farbeVon(rPr) {
    const c = kind(rPr, 'color');
    if (!c) return null;
    const val = c.getAttributeNS(W, 'val');
    if (!val || val === 'auto' || !/^[0-9a-fA-F]{6}$/.test(val)) return null;
    return '#' + val.toLowerCase();
  }

  /* ══════════════════════════════════════════════════════════════════
     4. VOM WORD-ABSATZ ZUM HTML
     ══════════════════════════════════════════════════════════════════ */

  /** w:jc → die Klasse aus css/pages.css. Links bleibt ohne Klasse. */
  function ausrichtungsKlasse(pPr) {
    const jc = kind(pPr, 'jc');
    if (!jc) return '';
    switch (jc.getAttributeNS(W, 'val')) {
      case 'center': return ' class="j-align-center"';
      case 'right': case 'end': return ' class="j-align-right"';
      case 'both': case 'distribute': return ' class="j-align-justify"';
      default: return '';
    }
  }

  /* Word-Formate auf die Formen aus core/lists.js. Was hier fehlt,
     landet über den Rückfall bei Punkt bzw. Zahl – eine Liste mit
     anderer Marke ist immer noch eine Liste. */
  const LISTEN_FORM = {
    bullet: 'disc',
    decimal: 'decimal',
    decimalZero: 'decimal',
    lowerLetter: 'lower-alpha',
    upperLetter: 'upper-alpha',
    lowerRoman: 'lower-roman',
    upperRoman: 'upper-roman',
    none: 'disc'
  };

  const istAufzaehlung = (fmt) => fmt === 'bullet' || fmt === 'none' || !fmt;

  /**
   * Die Auszeichnungen eines Laufs um seinen Text legen.
   *
   * Reihenfolge fest: font außen, dann b/i/u/s. Warum das zählt: der
   * Test vergleicht erzeugten Text mit dem, was der Sanitizer daraus
   * macht, und eine wechselnde Schachtelung wäre nicht vergleichbar.
   */
  function laufZuHtml(run) {
    const rPr = kind(run, 'rPr');

    let inhalt = '';
    for (const k of run.children) {
      if (k.namespaceURI !== W) continue;
      if (k.localName === 't') inhalt += escapeHtml(k.textContent);
      else if (k.localName === 'tab') inhalt += '&nbsp;&nbsp;&nbsp;&nbsp;';
      else if (k.localName === 'br') inhalt += '<br>';
      else if (k.localName === 'noBreakHyphen') inhalt += '-';
      else if (k.localName === 'softHyphen') inhalt += '';
    }
    if (!inhalt) return '';

    if (rPr) {
      if (anAus(rPr, 'strike') || anAus(rPr, 'dstrike')) inhalt = '<s>' + inhalt + '</s>';
      // w:u ist keine An/Aus-Eigenschaft: val nennt die Art des Strichs
      const u = kind(rPr, 'u');
      if (u && u.getAttributeNS(W, 'val') && u.getAttributeNS(W, 'val') !== 'none') {
        inhalt = '<u>' + inhalt + '</u>';
      }
      if (anAus(rPr, 'i')) inhalt = '<i>' + inhalt + '</i>';
      if (anAus(rPr, 'b')) inhalt = '<b>' + inhalt + '</b>';

      const farbe = farbeVon(rPr);
      if (farbe) inhalt = '<font color="' + farbe + '">' + inhalt + '</font>';
    }
    return inhalt;
  }

  /** Enthält dieser Absatz einen ausdrücklichen Seitenumbruch? */
  function hatSeitenumbruch(p) {
    for (const br of p.getElementsByTagNameNS(W, 'br')) {
      if (br.getAttributeNS(W, 'type') === 'page') return true;
    }
    return false;
  }

  /* ══════════════════════════════════════════════════════════════════
     5. BILDER

     Word hängt ein Bild über zwei Ecken an: der Lauf enthält ein
     w:drawing, darin steht eine Beziehungs-Kennung (r:embed), und die
     zeigt über document.xml.rels auf eine Datei unter word/media/.
     ══════════════════════════════════════════════════════════════════ */

  const BILD_TYPEN = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff'
  };

  /** Uint8Array → data:-Adresse. In Stücken, weil String.fromCharCode
      mit einem Argument je Byte bei großen Bildern den Stapel sprengt. */
  function alsDataUrl(bytes, dateiname) {
    const endung = (dateiname.split('.').pop() || '').toLowerCase();
    const typ = BILD_TYPEN[endung];
    if (!typ) return null;               // emf/wmf u. Ä. kann der Browser nicht

    let roh = '';
    const stueck = 0x8000;
    for (let i = 0; i < bytes.length; i += stueck) {
      roh += String.fromCharCode.apply(null, bytes.subarray(i, i + stueck));
    }
    return 'data:' + typ + ';base64,' + btoa(roh);
  }

  /**
   * Die Bilder eines Absatzes, in der Reihenfolge, in der sie darin stehen.
   *
   * Maße aus wp:extent (EMU). Fehlen sie, wird die natürliche Größe
   * später beim Einsetzen ermittelt – deshalb hier 0 statt geraten.
   */
  function bilderIn(p, beziehungen, dateien) {
    const aus = [];
    for (const zeichnung of p.getElementsByTagNameNS(W, 'drawing')) {
      const blip = zeichnung.getElementsByTagNameNS(A, 'blip')[0];
      if (!blip) continue;
      const rId = blip.getAttributeNS(R, 'embed') || blip.getAttributeNS(R, 'link');
      if (!rId) continue;

      const ziel = beziehungen.get(rId);
      if (!ziel) continue;

      /* Die Ziele stehen relativ zu word/. Ein führendes ../ kommt vor,
         wenn das Bild außerhalb liegt – dann ist der Pfad schon vom
         Wurzelverzeichnis aus gemeint. */
      const pfad = ziel.startsWith('/') ? ziel.slice(1)
        : ziel.startsWith('../') ? ziel.slice(3)
          : 'word/' + ziel;
      const daten = dateien.get(pfad);
      if (!daten) continue;

      const src = alsDataUrl(daten, pfad);
      if (!src) continue;

      const extent = zeichnung.getElementsByTagNameNS(WP, 'extent')[0];
      aus.push({
        src,
        w: extent ? Math.round(parseInt(extent.getAttribute('cx'), 10) / EMU_PER_PX) : 0,
        h: extent ? Math.round(parseInt(extent.getAttribute('cy'), 10) / EMU_PER_PX) : 0
      });
    }
    return aus;
  }

  /* ══════════════════════════════════════════════════════════════════
     6. TABELLEN

     Zwei Dinge brauchen einen zweiten Blick:

     · Die SPALTENBREITEN stehen in Twips im tblGrid. Inkwells trägt sie
       als Zahl an <col> (core/tables.js) – ein style hielte den
       Sanitizer nicht aus.
     · Verbundene Zellen ÜBER Zeilen hinweg stehen in Word nicht als
       rowspan da, sondern als Kette: die oberste Zelle trägt
       vMerge="restart", jede Zelle darunter ein leeres vMerge. Erst das
       Zählen dieser Kette ergibt den rowspan – und die Fortsetzungen
       müssen weg, sonst hätte die Zeile eine Zelle zu viel.
     ══════════════════════════════════════════════════════════════════ */

  const TWIPS_PER_PX = 15;

  function tabelleZuHtml(tbl, ctx) {
    const gitter = kind(tbl, 'tblGrid');
    const breiten = gitter
      ? kinder(gitter, 'gridCol').map(c => {
        const w = parseInt(c.getAttributeNS(W, 'w'), 10);
        return Number.isFinite(w) ? Math.round(w / TWIPS_PER_PX) : 0;
      })
      : [];

    // Erst die Zellen einsammeln, dann die Verbünde ausrechnen
    const zeilen = kinder(tbl, 'tr').map(tr => {
      const trPr = kind(tr, 'trPr');
      const istKopf = !!trPr && anAus(trPr, 'tblHeader');
      const zellen = kinder(tr, 'tc').map(tc => {
        const tcPr = kind(tc, 'tcPr');
        const gridSpan = kind(tcPr, 'gridSpan');
        const vMerge = kind(tcPr, 'vMerge');
        const vVal = vMerge ? (vMerge.getAttributeNS(W, 'val') || 'continue') : null;

        return {
          istKopf,
          colspan: gridSpan ? Math.max(1, parseInt(gridSpan.getAttributeNS(W, 'val'), 10) || 1) : 1,
          vMerge: vVal,               // 'restart' | 'continue' | null
          rowspan: 1,
          inhalt: zellenInhalt(tc, ctx)
        };
      });
      return { istKopf, zellen };
    });

    /* Die Kette der Fortsetzungen zählen. Gearbeitet wird über die
       SPALTE, nicht über die Nummer der Zelle in der Zeile: sobald eine
       Zelle mehrere Spalten überspannt, sind das zwei verschiedene
       Zahlen, und über die Zellennummer landete der Verbund daneben. */
    for (let z = 0; z < zeilen.length; z++) {
      let spalte = 0;
      for (const zelle of zeilen[z].zellen) {
        if (zelle.vMerge === 'restart') {
          let tiefer = z + 1;
          while (tiefer < zeilen.length) {
            const passende = zelleBeiSpalte(zeilen[tiefer], spalte);
            if (!passende || passende.vMerge !== 'continue') break;
            passende.entfaellt = true;
            zelle.rowspan++;
            tiefer++;
          }
        }
        spalte += zelle.colspan;
      }
    }

    let html = '<table class="j-table">';
    if (breiten.length && breiten.every(b => b > 0)) {
      html += '<colgroup>' + breiten.map(b => '<col width="' + b + '">').join('') + '</colgroup>';
    }
    html += '<tbody>';
    for (const zeile of zeilen) {
      html += '<tr>';
      for (const zelle of zeile.zellen) {
        if (zelle.entfaellt) continue;
        const tag = zelle.istKopf ? 'th' : 'td';
        const attr = (zelle.colspan > 1 ? ' colspan="' + zelle.colspan + '"' : '')
          + (zelle.rowspan > 1 ? ' rowspan="' + zelle.rowspan + '"' : '');
        html += '<' + tag + attr + '>' + zelle.inhalt + '</' + tag + '>';
      }
      html += '</tr>';
    }
    return html + '</tbody></table>';
  }

  /**
   * Der Inhalt einer Zelle – ausschliesslich inline.
   *
   * >>> Warum hier KEIN <p> hinein darf <<<
   * canvas/text.js misst den Seitentext flach: dort ist eine Zeile <tr>
   * ein Block und eine Zelle <td> „inline", eine Tabellenzeile zaehlt
   * also als GENAU EINE Zeile. Steckte in der Zelle ein Absatz, waere
   * jede Zelle ein eigener Block – die Schreibmarken saessen daneben,
   * die der Mitschreibenden auch, und der Fehler faellt erst beim
   * gemeinsamen Schreiben auf.
   *
   * Mehrere Absaetze in einer Word-Zelle werden deshalb mit <br>
   * verbunden. Eine Aufzaehlung in einer Zelle verliert ihre Marken:
   * <ul> waere ebenfalls ein Block. Beides steht im Bericht.
   */
  function zellenInhalt(tc, ctx) {
    const stuecke = [];
    for (const el of tc.children) {
      if (el.namespaceURI !== W) continue;

      if (el.localName === 'p') {
        if (listenLage(el, ctx)) ctx.verloren.add('listenInTabellen');
        if (bilderIn(el, ctx.beziehungen, ctx.dateien).length) ctx.verloren.add('bilderInTabellen');

        const block = absatzZuHtml(el, ctx);
        // Nur den Inhalt, nicht die Absatzhuelle
        stuecke.push(block.html.replace(/^<(p|h[123])[^>]*>/, '').replace(/<\/(p|h[123])>$/, ''));
        continue;
      }

      /* Eine Tabelle in einer Tabelle kann Inkwells nicht – der Editor
         verbietet sie beim Einfuegen aus demselben Grund (core/tables.js).
         Der Text bleibt, das Gitter geht. */
      if (el.localName === 'tbl') {
        ctx.verloren.add('tabellenInTabellen');
        for (const p of el.getElementsByTagNameNS(W, 'p')) {
          const block = absatzZuHtml(p, ctx);
          stuecke.push(block.html.replace(/^<(p|h[123])[^>]*>/, '').replace(/<\/(p|h[123])>$/, ''));
        }
      }
    }

    /* Eine leere Zelle bleibt leer: ein <br> darin waere eine zweite
       Zeile und machte die ganze Tabellenzeile hoeher. */
    const zusammen = stuecke.filter(s => s !== '<br>').join('<br>');
    return zusammen;
  }

  /** Die Zelle, die in dieser Zeile an dieser Spalte beginnt. */
  function zelleBeiSpalte(zeile, spalte) {
    let s = 0;
    for (const zelle of zeile.zellen) {
      if (s === spalte) return zelle;
      s += zelle.colspan;
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════
     7. VOM DOKUMENT ZU BLÖCKEN

     Herauskommt eine Liste von Blöcken – ein Block ist ein Absatz, eine
     ganze Liste oder eine Tabelle. Der Seitenumbruch (core/docxPaginate.js)
     arbeitet auf genau dieser Körnung.

     Ein Block ist:
       { html }                      gewöhnlich
       { html, bild: {src,w,h} }     Platzhalter, an dessen Stelle später
                                     das Bild als Objekt gesetzt wird
       { html, umbruchDavor: true }  ausdrücklicher Seitenumbruch
     ══════════════════════════════════════════════════════════════════ */

  const TEXT_BREITE = CFG_TEXT_BREITE();

  /** Die nutzbare Textbreite einer Heftseite – wie in css/pages.css. */
  function CFG_TEXT_BREITE() {
    const seite = (typeof CFG !== 'undefined' && CFG.PAGE_W) ? CFG.PAGE_W : 794;
    return seite - 72 - 32;      // .j-text left und right
  }

  /**
   * Der Absatz als Block – oder null, wenn nichts darin steht.
   *
   * Leere Absätze bleiben ausdrücklich erhalten: in Word ist die
   * Leerzeile das übliche Mittel für Abstand, und sie wegzuwerfen
   * schöbe den ganzen Text zusammen.
   */
  function absatzZuHtml(p, ctx) {
    const pPr = kind(p, 'pPr');
    const ausrichtung = ausrichtungsKlasse(pPr);

    let inhalt = '';
    for (const k of p.children) {
      if (k.namespaceURI !== W) continue;
      if (k.localName === 'r') inhalt += laufZuHtml(k);
      /* Ein Link ist in Word ein eigener Knoten mit Läufen darin. <a>
         steht nicht in der Erlaubnisliste des Sanitizers (core/sanitize.js)
         – der Text bleibt, die Adresse geht verloren. Sie hier zu
         erzeugen hiesse, sie beim ersten Abgleich wieder zu verlieren. */
      else if (k.localName === 'hyperlink') {
        for (const r of kinder(k, 'r')) inhalt += laufZuHtml(r);
        ctx.verloren.add('links');
      }
    }

    // Überschrift? Steht in der Vorlage, nicht am Absatz
    const pStyle = kind(pPr, 'pStyle');
    const styleId = pStyle ? pStyle.getAttributeNS(W, 'val') : null;
    let ebene = styleId != null && ctx.vorlagen.has(styleId) ? ctx.vorlagen.get(styleId) : null;
    // w:outlineLvl darf auch direkt am Absatz stehen und geht dann vor
    const eigeneEbene = kind(pPr, 'outlineLvl');
    if (eigeneEbene) {
      const n = parseInt(eigeneEbene.getAttributeNS(W, 'val'), 10);
      if (Number.isFinite(n)) ebene = n;
    }

    const leer = !inhalt;
    if (leer) inhalt = '<br>';   // sonst fiele die Zeile beim Anzeigen zusammen

    /* Inkwells kennt drei Überschriftsebenen. Tiefere gibt es in Word
       (bis 9); sie werden zur dritten – eine vierte Ebene sähe aus wie
       gewöhnlicher Text, und die Gliederung ginge ganz verloren. */
    if (ebene !== null && ebene >= 0 && ebene <= 8 && !leer) {
      if (ebene > 2) ctx.verloren.add('tiefeUeberschriften');
      const stufe = Math.min(ebene + 1, 3);
      return { html: '<h' + stufe + ausrichtung + '>' + inhalt + '</h' + stufe + '>' };
    }

    return { html: '<p' + ausrichtung + '>' + inhalt + '</p>' };
  }

  /** Die Listenangaben eines Absatzes, oder null. */
  function listenLage(p, ctx) {
    const numPr = kind(kind(p, 'pPr'), 'numPr');
    if (!numPr) return null;
    const numId = kind(numPr, 'numId');
    const ilvl = kind(numPr, 'ilvl');
    if (!numId) return null;

    const id = numId.getAttributeNS(W, 'val');
    const ebene = ilvl ? (parseInt(ilvl.getAttributeNS(W, 'val'), 10) || 0) : 0;
    const formen = ctx.nummerierung.get(id);
    const fmt = formen ? formen.get(String(ebene)) : null;
    return { id, ebene, fmt: fmt || 'bullet' };
  }

  /**
   * Alle Blöcke unter einem Knoten (w:body oder eine Tabellenzelle).
   *
   * Aufeinanderfolgende Aufzählungspunkte werden zu EINER Liste
   * zusammengefasst – jeder für sich wäre je ein eigenes <ul> und damit
   * eine Liste, die bei jedem Punkt neu bei 1 anfängt.
   */
  function bloeckeIn(wurzel, ctx) {
    const bloecke = [];
    let offeneListe = null;      // { ebenen: [{tag, html:[]}], id }

    const listeSchliessen = () => {
      if (!offeneListe) return;
      while (offeneListe.ebenen.length > 1) faltenEine(offeneListe);
      const e = offeneListe.ebenen[0];
      bloecke.push({ html: '<' + e.tag + ' class="j-list-' + e.form + '">' + e.html.join('') + '</' + e.tag + '>' });
      offeneListe = null;
    };

    /* Eine Unterebene wird in den ZULETZT geöffneten Punkt der Ebene
       darüber hineingezogen – so schachtelt auch core/lists.js, und der
       Word-Export zählt die Ebene über genau diese Verschachtelung. */
    const faltenEine = (liste) => {
      const innen = liste.ebenen.pop();
      const aussen = liste.ebenen[liste.ebenen.length - 1];
      const fertig = '<' + innen.tag + ' class="j-list-' + innen.form + '">'
        + innen.html.join('') + '</' + innen.tag + '>';
      if (aussen.html.length) {
        // in den letzten Punkt hinein, vor dessen </li>
        const letzter = aussen.html.length - 1;
        aussen.html[letzter] = aussen.html[letzter].replace(/<\/li>$/, fertig + '</li>');
      } else {
        aussen.html.push('<li>' + fertig + '</li>');
      }
    };

    for (const el of wurzel.children) {
      if (el.namespaceURI !== W) continue;

      if (el.localName === 'p') {
        const lage = listenLage(el, ctx);

        if (lage) {
          const tag = istAufzaehlung(lage.fmt) ? 'ul' : 'ol';
          const form = LISTEN_FORM[lage.fmt] || (tag === 'ol' ? 'decimal' : 'disc');

          // Andere Nummerierung heißt: andere Liste
          if (offeneListe && offeneListe.id !== lage.id) listeSchliessen();
          if (!offeneListe) offeneListe = { id: lage.id, ebenen: [{ tag, form, html: [] }] };

          while (offeneListe.ebenen.length <= lage.ebene) {
            offeneListe.ebenen.push({ tag, form, html: [] });
          }
          while (offeneListe.ebenen.length > lage.ebene + 1) faltenEine(offeneListe);

          const innen = absatzZuHtml(el, ctx);
          // Der Punkt trägt den Inhalt ohne seine eigene Absatzhülle
          const nurInhalt = innen.html.replace(/^<(p|h[123])[^>]*>/, '').replace(/<\/(p|h[123])>$/, '');
          offeneListe.ebenen[offeneListe.ebenen.length - 1].html.push('<li>' + nurInhalt + '</li>');
          continue;
        }

        listeSchliessen();
        const block = absatzZuHtml(el, ctx);
        if (hatSeitenumbruch(el)) block.umbruchDavor = true;

        const bilder = bilderIn(el, ctx.beziehungen, ctx.dateien);

        /* Ein Absatz, in dem NUR ein Bild steht, ist in Word der
           Normalfall. Seine leere Hülle mit auszugeben hiesse: über
           jedem Bild eine Leerzeile, die niemand getippt hat. */
        const nurBild = bilder.length && /^<p[^>]*><br><\/p>$/.test(block.html);
        if (!nurBild) bloecke.push(block);

        for (const bild of bilder) {
          const platz = platzhalterFuer(bild, ctx);
          if (nurBild && block.umbruchDavor) platz.umbruchDavor = true;
          bloecke.push(platz);
        }
        continue;
      }

      if (el.localName === 'tbl') {
        listeSchliessen();
        bloecke.push({ html: tabelleZuHtml(el, ctx) });
        ctx.tabellen++;
        continue;
      }
    }

    listeSchliessen();
    return bloecke;
  }

  /**
   * Ein Block, der nur Platz freihält – dort kommt später das Bild hin.
   *
   * >>> Warum leere Absätze und keine Höhenangabe <<<
   * Ein style="height:…" überlebt den Sanitizer nicht, von einem style
   * bleibt allein die Farbe stehen. Leere Absätze sind gewöhnlicher
   * Text und kommen unverändert durch; jeder ist genau eine Zeilenhöhe
   * hoch, also reicht ihre Anzahl als Maß.
   */
  function platzhalterFuer(bild, ctx) {
    // Zu breite Bilder verhältnistreu auf die Textbreite ziehen
    let { w, h } = bild;
    if (!w || !h) { w = w || 200; h = h || 150; }
    if (w > TEXT_BREITE) {
      h = Math.round(h * (TEXT_BREITE / w));
      w = TEXT_BREITE;
    }
    /* Und was höher ist als eine Seite, wird ebenfalls kleiner. Sonst
       stünde der Platzhalter allein schon über die Seite hinaus – und
       weil ein Bild nicht geteilt werden darf (core/docxPaginate.js),
       ragte es unten hinaus und wäre abgeschnitten. */
    if (ctx.maxBildHoehe && h > ctx.maxBildHoehe) {
      w = Math.round(w * (ctx.maxBildHoehe / h));
      h = ctx.maxBildHoehe;
    }

    const zeilen = Math.max(1, Math.ceil(h / ctx.zeilenhoehe));
    ctx.bilder++;
    return {
      html: '<p><br></p>'.repeat(zeilen),
      bild: { src: bild.src, w, h }
    };
  }

  /* ══════════════════════════════════════════════════════════════════
     8. DER EINSTIEG
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Liest eine .docx und gibt die Blöcke zurück.
   *
   * @param {Uint8Array} bytes
   * @param {object} [optionen]
   * @param {number} [optionen.zeilenhoehe=32] Zeilenhöhe des Papiers
   * @returns {Promise<{bloecke:Array, bericht:object}>}
   */
  async function lese(bytes, optionen = {}) {
    const dateien = await entpacke(bytes);

    const doc = alsXml(dateien.get('word/document.xml'));
    if (!doc) throw new Error('NO_DOCUMENT');
    const body = doc.getElementsByTagNameNS(W, 'body')[0];
    if (!body) throw new Error('NO_BODY');

    const ctx = {
      dateien,
      beziehungen: leseBeziehungen(dateien),
      nummerierung: leseNummerierung(dateien),
      vorlagen: leseVorlagen(dateien),
      zeilenhoehe: optionen.zeilenhoehe || 32,
      maxBildHoehe: optionen.maxBildHoehe || 0,
      verloren: new Set(),
      bilder: 0,
      tabellen: 0
    };

    const bloecke = bloeckeIn(body, ctx);

    return {
      bloecke,
      bericht: {
        bloecke: bloecke.length,
        bilder: ctx.bilder,
        tabellen: ctx.tabellen,
        verloren: [...ctx.verloren]
      }
    };
  }

  global.InkwellsDocxImport = {
    lese,
    __intern: {
      entpacke, alsText, alsXml, leseBeziehungen, leseNummerierung, leseVorlagen,
      kind, kinder, anAus, farbeVon, ausrichtungsKlasse, laufZuHtml,
      hatSeitenumbruch, escapeHtml, LISTEN_FORM, istAufzaehlung,
      bloeckeIn, absatzZuHtml, tabelleZuHtml, alsDataUrl, platzhalterFuer,
      W, R, A, WP, EMU_PER_PX, TEXT_BREITE
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
