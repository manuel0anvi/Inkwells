'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DER DIALOG ZUM CODE

   Aufmachen, Code hineinsetzen, fertig – daraus wird ein Kasten auf dem
   Blatt (core/code.js). Ein Doppelklick auf den Kasten macht ihn wieder
   auf, und dann steht der bisherige Code darin.

   >>> Warum ein Fenster und nicht gleich auf dem Blatt tippen <<<
   Weil Code EINGESETZT wird, nicht getippt: man hat ihn in der
   Entwicklungsumgebung geschrieben und will ihn hierher bringen, mit
   jeder Einrückung genau so, wie er dort steht. Ein <textarea> tut
   das von selbst – es hält den Text Zeichen für Zeichen. Ein
   contenteditable auf dem Blatt täte es gerade nicht: der Browser macht
   daraus Absätze, schluckt führende Leerzeichen und ersetzt Tabulatoren.

   Gebaut wie der Formel-Editor (ui/formula.js): das Fenster entsteht
   hier in JavaScript und nicht in index.html, damit alles, was dazu
   gehört, an einer Stelle steht.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const txt = (schluessel, ersatz) =>
    (typeof t === 'function' && t(schluessel)) || ersatz;

  /* ── Das Fenster ──────────────────────────────────────────────────── */
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'ov-code';
  overlay.style.display = 'none';

  /* Dieselbe Hülle wie der Formel-Editor: `modal modal-nb` bringt Rand,
     Innenabstand und Schatten mit. `code-modal` kommt nur für die Breite
     dazu – ein Codefeld braucht mehr Platz als ein Formelfeld. */
  const kasten = document.createElement('div');
  kasten.className = 'modal modal-nb code-modal';

  /* Überschrift und Schließkreuz gehören in EINE Zeile. Einzeln ins
     Modal gehängt stünden sie untereinander, und das ✕ säße unter der
     Überschrift statt oben rechts, wo man es sucht. Dieselbe Lösung wie
     .formula-head in ui/formula.js. */
  const kopf = document.createElement('div');
  kopf.className = 'code-head';

  const titel = document.createElement('h3');
  titel.id = 'code-title';

  const schliessenX = document.createElement('button');
  schliessenX.className = 'modal-close-x';
  schliessenX.textContent = '✕';

  kopf.appendChild(titel);
  kopf.appendChild(schliessenX);

  /* Das Eingabefeld. spellcheck aus – eine rote Wellenlinie unter jedem
     Bezeichner macht Code unlesbar. */
  const feld = document.createElement('textarea');
  feld.id = 'code-quelle';
  feld.className = 'code-quelle';
  feld.rows = 14;
  feld.spellcheck = false;
  feld.autocapitalize = 'off';
  feld.autocomplete = 'off';
  feld.setAttribute('autocorrect', 'off');

  /* ── Die Zeile darunter: Sprache, Aussehen ────────────────────────── */
  const leiste = document.createElement('div');
  leiste.className = 'code-leiste';

  const sprachLabel = document.createElement('label');
  sprachLabel.className = 'modal-label';

  const sprachWahl = document.createElement('select');
  sprachWahl.id = 'code-sprache';

  /* Der Hinweis, was erkannt wurde. Er sagt auch, dass man es ändern
     darf – sonst hält man das Geratene für gesetzt. */
  const erkannt = document.createElement('span');
  erkannt.className = 'code-erkannt';

  /* ── Hell oder dunkel: ein Schalter, kein Kästchen ─────────────
     Ein Kästchen beantwortet die Frage „ist das an?“. Hier geht es aber
     nicht um ein Merkmal, das man dazuschaltet, sondern um eine von
     zwei Fassungen desselben Kastens – und dafür ist der Schalter das
     eingeführte Bild. Dieselben Klassen wie sonst in der App
     (css/modals.css, .toggle-switch); die sichtbare Bahn MUSS als
     Geschwister unmittelbar hinter dem Feld stehen, sonst greift die
     Regel für den umgelegten Zustand nicht.

     Die Beschriftung steht links, der Schalter rechts: so liest man
     erst, worum es geht, und sieht dann den Zustand. */
  const hellLabel = document.createElement('label');
  hellLabel.className = 'code-hell-zeile';
  const hellText = document.createElement('span');
  const hellSchalter = document.createElement('span');
  hellSchalter.className = 'toggle-switch';
  const hellHaken = document.createElement('input');
  hellHaken.type = 'checkbox';
  hellHaken.id = 'code-hell';
  const hellBahn = document.createElement('span');
  hellBahn.className = 'toggle-slider';
  hellSchalter.appendChild(hellHaken);
  hellSchalter.appendChild(hellBahn);
  hellLabel.appendChild(hellText);
  hellLabel.appendChild(hellSchalter);

  /* ── Die Knöpfe ───────────────────────────────────────────────────
     `modal-btns` gibt der Reihe ihre Lage; Grösse, Schrift und
     Innenabstand der Knöpfe kommen von `.modal-btns button`. Der
     Abbrechen-Knopf bekommt deshalb bewusst KEINE Klasse – nur der
     bestätigende trägt `ok-btn` und damit die Farbe. Genau so macht es
     der Formel-Editor. */
  const knopfZeile = document.createElement('div');
  knopfZeile.className = 'modal-btns';

  const abbrechen = document.createElement('button');
  abbrechen.id = 'code-abbrechen';

  const fertig = document.createElement('button');
  fertig.className = 'ok-btn';
  fertig.id = 'code-fertig';

  knopfZeile.appendChild(abbrechen);
  knopfZeile.appendChild(fertig);

  leiste.appendChild(sprachLabel);
  leiste.appendChild(sprachWahl);
  leiste.appendChild(erkannt);
  leiste.appendChild(hellLabel);

  kasten.appendChild(kopf);
  kasten.appendChild(feld);
  kasten.appendChild(leiste);
  kasten.appendChild(knopfZeile);
  overlay.appendChild(kasten);
  document.body.appendChild(overlay);

  /* ── Zustand ──────────────────────────────────────────────────────── */
  let _obj = null;          // der Kasten, der bearbeitet wird – oder null
  let _page = null;
  let _neuZeichnen = null;  // wie der Kasten sich neu malt
  let _vonHand = false;     // hat der Nutzer die Sprache selbst gesetzt?

  function fuelleSprachen() {
    if (sprachWahl.options.length) return;
    for (const id of window.InkwellsCode.SPRACH_LISTE) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = window.InkwellsCode.SPRACHEN[id].name;
      sprachWahl.appendChild(o);
    }
  }

  /* Raten, solange der Nutzer nicht selbst gewählt hat. Sobald er es tut,
     bleibt seine Wahl – sonst überschriebe der nächste Tastendruck sie. */
  function rateNach() {
    if (_vonHand) return;
    const geraten = window.InkwellsCode.errateSprache(feld.value);
    sprachWahl.value = geraten;
    erkannt.textContent = geraten === 'text'
      ? txt('codeGuessNone', 'nicht erkannt – bitte selbst wählen')
      : txt('codeGuessed', 'automatisch erkannt').replace('{n}',
          window.InkwellsCode.SPRACHEN[geraten].name);
  }

  function beschrifte() {
    titel.textContent = _obj
      ? txt('codeEdit', 'Code bearbeiten')
      : txt('codeInsert', 'Code einfügen');
    sprachLabel.textContent = txt('codeLanguage', 'Sprache');
    hellText.textContent = txt('codeLight', 'Heller Kasten');
    abbrechen.textContent = txt('cancel', 'Abbrechen');
    fertig.textContent = txt('done', 'Fertig');
    feld.placeholder = txt('codePlaceholder', 'Code hier einfügen …');
  }

  function zu() {
    overlay.style.display = 'none';
    _obj = null; _page = null; _neuZeichnen = null;
  }

  /**
   * @param {object} [bearbeiten] { obj, page, neuZeichnen } – dann wird ein
   *   bestehender Kasten geändert statt eines neuen angelegt.
   */
  function openCodeEditor(bearbeiten) {
    if (!window.InkwellsCode) return;
    if (typeof S !== 'undefined' && S.readOnly) {
      if (typeof toast === 'function') toast(txt('sharedNoRight', 'Nur Lesen.'), true);
      return;
    }

    fuelleSprachen();
    _obj = bearbeiten?.obj || null;
    _page = bearbeiten?.page || null;
    _neuZeichnen = bearbeiten?.neuZeichnen || null;

    feld.value = _obj ? (_obj.code || '') : '';
    hellHaken.checked = _obj ? !!_obj.hell : false;

    /* Bei einem bestehenden Kasten steht die Sprache schon fest – dann
       wird nicht geraten, sonst überschriebe das Raten eine Wahl, die
       jemand einmal bewusst getroffen hat. */
    _vonHand = !!_obj;
    if (_obj) {
      sprachWahl.value = _obj.lang || 'text';
      erkannt.textContent = '';
    } else {
      rateNach();
    }

    beschrifte();
    overlay.style.display = 'flex';
    setTimeout(() => { feld.focus(); if (!_obj) feld.select(); }, 30);
  }

  function uebernehmen() {
    const code = feld.value;
    if (!code.trim()) { zu(); return; }

    const sprache = sprachWahl.value;
    const hell = hellHaken.checked;

    if (_obj) {
      const seite = _page;
      if (seite && typeof pushPageHistory === 'function') pushPageHistory(seite);
      window.InkwellsCode.updateCodeObject(_obj, code, sprache, hell);
      if (typeof _neuZeichnen === 'function') _neuZeichnen();
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
      /* Ein Objekt ändert sich nicht über den Text – ui/collab.js merkt
         es über den Heft-Vergleich, den markDirty anstösst. */
    } else {
      window.InkwellsCode.insertCodeObject(code, sprache, hell);
    }
    zu();
  }

  /* ── Handgriffe ───────────────────────────────────────────────────── */
  feld.addEventListener('input', rateNach);
  sprachWahl.addEventListener('change', () => {
    _vonHand = true;
    erkannt.textContent = '';
  });

  fertig.addEventListener('click', uebernehmen);
  abbrechen.addEventListener('click', zu);
  schliessenX.addEventListener('click', zu);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) zu(); });

  /* Strg+Enter schliesst ab – im Feld selbst ist Enter ein Zeilenumbruch
     und darf es auch bleiben. Esc bricht ab, wie überall. */
  feld.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); uebernehmen(); }
    if (e.key === 'Escape') { e.preventDefault(); zu(); }

    /* Tab rückt ein, statt aus dem Feld zu springen. In einem Codefeld
       ist das Einrücken das Erwartete – zum Verlassen gibt es Esc. */
    if (e.key === 'Tab') {
      e.preventDefault();
      const a = feld.selectionStart, b = feld.selectionEnd;
      feld.value = feld.value.slice(0, a) + '    ' + feld.value.slice(b);
      feld.selectionStart = feld.selectionEnd = a + 4;
    }
  });

  window.addEventListener('language-changed', beschrifte);

  window.openCodeEditor = openCodeEditor;
})();
