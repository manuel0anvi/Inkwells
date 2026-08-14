'use strict';

/* ══════════════════════════════════════════════════════════════════════
   WAS STEHT IN DIESEM HEFT?  ―  Zähler unten links

   Zwei Stufen, und das ist Absicht:

     1. Ein kleines, ruhiges Schild in der unteren linken Ecke des
        Blattbereichs: Zeichen und Wörter. Mehr will man beim Schreiben
        nicht wissen, und mehr darf dort auch nicht stehen – es liegt
        neben dem Text und muss übersehbar bleiben.

     2. Ein Klick darauf öffnet die vollständige Aufstellung in der
        Mitte: Zeichen mit und ohne Leerzeichen, Wörter, Absätze,
        Seiten, Striche, Bilder, Formen, Formeln und Kommentare.

   ── Woher die Zahlen kommen ────────────────────────────────────────
   Aus dem HEFT, nicht aus dem Fenster. Gezählt wird über alle Seiten,
   auch die, die gerade nicht gezeichnet sind und auch die, die der
   gewählte Abschnitt ausblendet. Ein Zähler, der beim Umschalten der
   Ansicht springt, zählt nichts, was jemand wissen will.

   Der Text einer Seite liegt als HTML in `page.textContent`. Er wird
   deshalb in einem freistehenden Element ausgepackt und daraus der reine
   Text genommen – die Blockgrenzen werden dabei zu Zeilenumbrüchen,
   sonst klebte das Ende eines Absatzes am Anfang des nächsten und aus
   zwei Wörtern würde eines.

   Die HANDSCHRIFT steht doppelt: die Wahrheit für ein offenes Heft ist
   `S.strokeHistory`, die Fassung in `page.inkStrokes` wird erst beim
   Sichern nachgezogen. Gefragt wird deshalb erst die eine, dann die
   andere.

   ── Warum gebremst gerechnet wird ──────────────────────────────────
   Beim Tippen käme das sonst bei jedem Anschlag, und jedes Mal würde
   das HTML jeder Seite des Hefts neu ausgepackt. Bei hundert Seiten ist
   das spürbar. Ein Schild, das eine halbe Sekunde nachhängt, stört
   dagegen niemanden.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const BREMSE_MS = 500;

  const txt = (key, ersatz) => (typeof t === 'function' && t(key)) || ersatz;

  /* Ein einziges Element zum Auspacken des HTML. Ein neues je Seite wäre
     bei hundert Seiten hundert Mal Aufräumarbeit für nichts. */
  const auspacker = document.createElement('div');

  /**
   * Der reine Text einer Seite.
   *
   * `<br>` und die Blockenden werden zu Zeilenumbrüchen. Ohne das zählte
   * „Ende</p><p>Anfang" als ein einziges Wort.
   */
  function textAusHtml(html) {
    const roh = String(html || '');
    if (!roh) return '';

    // Kein HTML? Dann ist es schon Text (ältere Seiten, reine Textseiten)
    if (roh.indexOf('<') === -1) return roh;

    auspacker.innerHTML = roh;
    auspacker.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    auspacker.querySelectorAll('p, div, li, h1, h2, h3, tr, blockquote, pre')
      .forEach(el => el.appendChild(document.createTextNode('\n')));
    const text = auspacker.textContent || '';
    auspacker.innerHTML = '';      // nichts liegen lassen
    return text;
  }

  /**
   * Die vier Zahlen zu einem Stück Text.
   *
   * Eigene Funktion, weil hier die Feinheiten sitzen und sie sich sonst
   * nicht prüfen ließen (scripts/test-neue-teile.js):
   *
   *   · Zeilenenden werden vereinheitlicht. Ein \r\n wären sonst ZWEI
   *     Zeichen für einen Umbruch, und die Zahl hinge daran, woher der
   *     Text stammt.
   *   · Gezählt werden Zeichen, nicht Bytes – „ä" ist eines.
   *   · Ein Wort ist alles ohne Leerraum dazwischen. Zwei Leerzeichen
   *     hintereinander machen daraus kein leeres Wort.
   *   · Ein Absatz ist eine Zeile, in der etwas steht. Leerzeilen zählen
   *     nicht mit – sonst hätte jedes Heft doppelt so viele.
   */
  function zaehleText(roh) {
    const sauber = String(roh || '').replace(/\r\n?/g, '\n').trim();
    return {
      zeichenMit: sauber.length,
      zeichenOhne: sauber.replace(/\s/g, '').length,
      woerter: sauber ? (sauber.match(/[^\s]+/g) || []).length : 0,
      absaetze: sauber ? sauber.split('\n').filter(z => z.trim().length > 0).length : 0
    };
  }

  /** Die Striche einer Seite – erst die laufende Fassung, dann die abgelegte. */
  function stricheVon(page) {
    const laufend = (typeof S !== 'undefined' && S.strokeHistory)
      ? S.strokeHistory[page.id] : null;
    const liste = laufend || page.inkStrokes || [];
    return Array.isArray(liste) ? liste.length : 0;
  }

  /**
   * Zählt das ganze Heft durch.
   *
   * @returns {object|null} alle Zahlen – oder null, wenn kein Heft offen ist
   */
  function zaehle() {
    const nb = (typeof getNb === 'function') ? getNb() : null;
    if (!nb) return null;

    const seiten = (typeof notebookPages === 'function')
      ? notebookPages(nb) : (nb.pages || []);

    const stuecke = [];
    let striche = 0, bilder = 0, formen = 0, formeln = 0, dateien = 0;

    for (const page of seiten) {
      if (!page) continue;
      stuecke.push(textAusHtml(page.textContent));
      striche += stricheVon(page);

      for (const obj of (page.objects || [])) {
        if (obj.kind === 'image') bilder++;
        else if (obj.kind === 'shape') formen++;
        else if (obj.kind === 'formula') formeln++;
        else dateien++;
      }

      /* Ein Seitenbild ist auch ein Bild. Es steht nicht in `objects`,
         sondern ist der Hintergrund der Seite – so entstehen Seiten aus
         einem PDF oder aus einem eingefügten Bild. Wer nachzählt, was in
         seinem Heft steckt, meint die auch. */
      if (page.bgImg) bilder++;
    }

    let kommentare = 0;
    if (Array.isArray(nb.comments)) kommentare = nb.comments.length;

    return {
      ...zaehleText(stuecke.join('\n')),
      seiten: seiten.length,
      striche, bilder, formen, formeln, dateien, kommentare
    };
  }
  window.zaehleHeft = zaehle;

  /* ── Das Schild ───────────────────────────────────────────────────── */

  let schild = null;
  let letzte = null;

  function baueSchild() {
    if (schild) return schild;
    const spalte = document.querySelector('.editor-col');
    if (!spalte) return null;

    schild = document.createElement('button');
    schild.type = 'button';
    schild.id = 'count-badge';
    schild.className = 'count-badge';
    schild.style.display = 'none';
    schild.addEventListener('click', oeffne);
    spalte.appendChild(schild);
    return schild;
  }

  /** 12345 → „12 345". Ein schmales Leerzeichen, damit nichts umbricht. */
  function zahl(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function zeichneSchild() {
    const el = baueSchild();
    if (!el) return;

    /* Nur im offenen Heft. Auf der Startseite gibt es kein Blatt, neben
       dem das Schild stehen könnte. */
    const imHeft = document.getElementById('view-journal');
    const offen = imHeft && imHeft.style.display !== 'none';
    if (!offen || !letzte) { el.style.display = 'none'; return; }

    el.style.display = 'inline-flex';
    el.innerHTML = '';

    const a = document.createElement('span');
    a.textContent = zahl(letzte.zeichenMit) + ' ' + txt('countCharsShort', 'Zeichen');
    const punkt = document.createElement('span');
    punkt.className = 'count-badge-sep';
    punkt.textContent = '·';
    const b = document.createElement('span');
    b.textContent = zahl(letzte.woerter) + ' ' + txt('countWordsShort', 'Wörter');

    el.append(a, punkt, b);
    el.title = txt('countOpenDetails', 'Für Einzelheiten anklicken');
  }

  /* ── Neu rechnen, aber gebremst ───────────────────────────────────── */

  let timer = null;

  function frischAuf(sofort) {
    clearTimeout(timer);
    const tun = () => {
      timer = null;
      letzte = zaehle();
      zeichneSchild();
      if (fensterOffen()) fuelleFenster();
    };
    if (sofort) tun();
    else timer = setTimeout(tun, BREMSE_MS);
  }
  window.refreshWordCount = frischAuf;

  /* Was den Zähler bewegt. Bewusst am Dokument und in der Erfassungs-
     phase: die Seiten werden ununterbrochen neu gebaut, und ein Griff an
     jedem einzelnen Textfeld ginge bei jedem Neuaufbau verloren. */
  document.addEventListener('input', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('j-text')) frischAuf();
  }, true);

  /* Handschrift, Radieren, verschobene Objekte: alles endet mit dem
     Loslassen des Zeigers. Ein einzelner Griff dafür ist genauer als der
     Versuch, jede zeichnende Stelle einzeln zu benachrichtigen. */
  document.addEventListener('pointerup', () => frischAuf(), true);
  document.addEventListener('pointercancel', () => frischAuf(), true);

  window.addEventListener('language-changed', () => frischAuf(true));

  /* ── Das Fenster mit allen Zahlen ─────────────────────────────────── */

  let fenster = null;

  function fensterOffen() {
    return !!fenster && fenster.style.display !== 'none';
  }

  function baueFenster() {
    if (fenster) return fenster;

    fenster = document.createElement('div');
    fenster.className = 'overlay';
    fenster.id = 'ov-count';
    fenster.style.display = 'none';
    /* Der schlichte Fenster-Bauplan (wie die Rückfragen): .modal bringt
       den Innenabstand selbst mit. Der Kopf mit Trennlinie (.modal-head)
       gehört zu Fenstern OHNE eigenen Abstand – hier wäre er doppelt. */
    fenster.innerHTML =
      '<div class="modal count-modal">'
      + '<h3 id="count-title"></h3>'
      + '<div class="count-body" id="count-body"></div>'
      + '<div class="modal-btns"><button class="ok-btn" id="count-ok"></button></div>'
      + '</div>';
    document.body.appendChild(fenster);

    fenster.querySelector('#count-ok').addEventListener('click', schliesse);
    fenster.addEventListener('click', (e) => { if (e.target === fenster) schliesse(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && fensterOffen()) schliesse();
    });
    return fenster;
  }

  /** Eine Zeile der Aufstellung. `stark` hebt die drei wichtigsten hervor. */
  function zeile(name, wert, stark) {
    const z = document.createElement('div');
    z.className = 'count-row' + (stark ? ' stark' : '');
    const n = document.createElement('span');
    n.className = 'count-row-name';
    n.textContent = name;
    const w = document.createElement('span');
    w.className = 'count-row-val';
    w.textContent = zahl(wert);
    z.append(n, w);
    return z;
  }

  function gruppe(titel) {
    const g = document.createElement('div');
    g.className = 'count-group';
    g.textContent = titel;
    return g;
  }

  function fuelleFenster() {
    const koerper = fenster && fenster.querySelector('#count-body');
    if (!koerper) return;

    const kopf = fenster.querySelector('#count-title');
    if (kopf) kopf.textContent = txt('countTitle', 'Umfang');
    const ok = fenster.querySelector('#count-ok');
    if (ok) ok.textContent = txt('done', 'Fertig');

    koerper.innerHTML = '';
    const z = letzte;
    if (!z) {
      const leer = document.createElement('div');
      leer.className = 'count-empty';
      leer.textContent = txt('countNothing', 'Hier ist noch nichts zu zählen.');
      koerper.appendChild(leer);
      return;
    }

    koerper.appendChild(gruppe(txt('countGroupText', 'Text')));
    koerper.appendChild(zeile(txt('countWords', 'Wörter'), z.woerter, true));
    koerper.appendChild(zeile(txt('countChars', 'Zeichen (mit Leerzeichen)'), z.zeichenMit, true));
    koerper.appendChild(zeile(txt('countCharsNoSpace', 'Zeichen (ohne Leerzeichen)'), z.zeichenOhne));
    koerper.appendChild(zeile(txt('countParagraphs', 'Absätze'), z.absaetze));

    koerper.appendChild(gruppe(txt('countGroupRest', 'Auf dem Papier')));
    koerper.appendChild(zeile(txt('countPages', 'Seiten'), z.seiten, true));
    koerper.appendChild(zeile(txt('countStrokes', 'Striche'), z.striche));
    koerper.appendChild(zeile(txt('countImages', 'Bilder'), z.bilder));
    koerper.appendChild(zeile(txt('countShapes', 'Formen'), z.formen));
    koerper.appendChild(zeile(txt('countFormulas', 'Formeln'), z.formeln));
    if (z.dateien) koerper.appendChild(zeile(txt('countFiles', 'Dateien'), z.dateien));
    koerper.appendChild(zeile(txt('comments', 'Kommentare'), z.kommentare));
  }

  function oeffne() {
    baueFenster();
    frischAuf(true);          // im Fenster sollen die Zahlen stimmen
    fuelleFenster();
    fenster.style.display = 'flex';
  }
  window.openWordCount = oeffne;

  function schliesse() {
    if (fenster) fenster.style.display = 'none';
  }

  /* Beim Öffnen eines Hefts und beim Zurück zur Übersicht neu stellen.
     Beide Wege gehen durch showJournal bzw. showHome (core/dialogs.js);
     ein Griff daran wäre aber ein Eingriff in fremden Code – der Zustand
     ist am Fenster selbst abzulesen, und dieser Takt kostet nichts. */
  setInterval(() => {
    const imHeft = document.getElementById('view-journal');
    const offen = !!imHeft && imHeft.style.display !== 'none';
    if (!offen) { if (schild) schild.style.display = 'none'; return; }
    if (!letzte) frischAuf(true);
    else if (schild && schild.style.display === 'none') zeichneSchild();
  }, 1000);
})();
