'use strict';

/* ══════════════════════════════════════════════════════════════════════
   FORMEL-EDITOR

   Ein Modal mit LaTeX-Eingabe und Live-Vorschau – ähnlich dem
   Word-Formel-Editor, nur dass man hier LaTeX schreibt statt Knöpfe zu
   drücken.

   Aufgerufen wird er:
     · aus dem Einfügen-Menü (neue Formel)
     · per Doppelklick auf eine bestehende Formel (core/formula.js)

   >>> Drei Wege zur selben Formel <<<
   „Man muss in dieser speziellen Schreibweise schreiben, das kann nicht
   jeder" – deshalb gibt es jetzt drei:

     1. Die Zeichen-Palette: anklicken, fertig. Wer nichts weiß, kommt
        hier durch.
     2. Normale Schreibweise: 1/2, sqrt(x), x^2, pi. Wird beim Tippen
        nach LaTeX übersetzt (core/formula.js, normalToLatex).
     3. LaTeX selbst – für die, die es können. Vorhandene \befehle rührt
        die Übersetzung nicht an, die drei Wege stehen sich also nicht
        im Weg.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  /* ── Das Modal im HTML aufbauen ──────────────────────────────────── */
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'ov-formula';
  overlay.style.display = 'none';

  const label = (text) => {
    const l = document.createElement('label');
    l.className = 'modal-label';
    l.textContent = text;
    return l;
  };

  const titel = document.createElement('h3');
  titel.id = 'formula-title';
  titel.textContent = (typeof t === 'function' && t('formulaEditor')) || 'Formel';

  const schliessenBtn = document.createElement('button');
  schliessenBtn.className = 'modal-close-x';
  schliessenBtn.id = 'formula-close';
  schliessenBtn.textContent = '✕';

  const latexFeld = document.createElement('textarea');
  latexFeld.id = 'formula-latex';
  latexFeld.rows = 3;
  latexFeld.spellcheck = false;
  latexFeld.autocomplete = 'off';
  latexFeld.placeholder = 'z. B. \\frac{1}{\\sqrt{2\\pi}} e^{-\\frac{x^2}{2}}';

  /* ── Die Zeichen-Palette ──────────────────────────────────────────────
     Ein senkrechter Strich in der Vorlage sagt, wohin die Schreibmarke
     danach soll. Ist gerade etwas ausgewählt, wandert die Auswahl an
     diese Stelle – wer „x" markiert und auf die Wurzel drückt, bekommt
     die Wurzel aus x. */
  const B = String.fromCharCode(92);   // Rückstrich, ohne Escape-Salat
  const PALETTE = [
    {
      schluessel: 'formulaGrpBasic', ersatz: 'Grundlagen', zeichen: [
        [B + 'frac{|}{ }', B + 'frac{a}{b}'],
        [B + 'sqrt{|}', B + 'sqrt{x}'],
        [B + 'sqrt[3]{|}', B + 'sqrt[3]{x}'],
        ['^{|}', 'x^{n}'],
        ['_{|}', 'x_{n}'],
        [B + 'left(|' + B + 'right)', '(' + B + ';)'],
        [B + 'cdot ', B + 'cdot'],
        [B + 'div ', B + 'div'],
        [B + 'pm ', B + 'pm']
      ]
    },
    {
      schluessel: 'formulaGrpCompare', ersatz: 'Vergleich', zeichen: [
        [B + 'leq ', B + 'leq'], [B + 'geq ', B + 'geq'], [B + 'neq ', B + 'neq'],
        [B + 'approx ', B + 'approx'], [B + 'equiv ', B + 'equiv'],
        [B + 'to ', B + 'to'], [B + 'Rightarrow ', B + 'Rightarrow'],
        [B + 'Leftrightarrow ', B + 'Leftrightarrow'], [B + 'propto ', B + 'propto']
      ]
    },
    {
      schluessel: 'formulaGrpGreek', ersatz: 'Griechisch', zeichen: [
        [B + 'alpha ', B + 'alpha'], [B + 'beta ', B + 'beta'], [B + 'gamma ', B + 'gamma'],
        [B + 'delta ', B + 'delta'], [B + 'theta ', B + 'theta'], [B + 'lambda ', B + 'lambda'],
        [B + 'mu ', B + 'mu'], [B + 'pi ', B + 'pi'], [B + 'rho ', B + 'rho'],
        [B + 'sigma ', B + 'sigma'], [B + 'phi ', B + 'phi'], [B + 'omega ', B + 'omega'],
        [B + 'Delta ', B + 'Delta'], [B + 'Sigma ', B + 'Sigma'], [B + 'Omega ', B + 'Omega']
      ]
    },
    {
      schluessel: 'formulaGrpCalc', ersatz: 'Analysis', zeichen: [
        [B + 'int_{|}^{ } ', B + 'int_a^b'],
        [B + 'sum_{|}^{ } ', B + 'sum_i^n'],
        [B + 'prod_{|}^{ } ', B + 'prod_i^n'],
        [B + 'lim_{|} ', B + 'lim_x'],
        [B + 'frac{d}{dx}|', B + 'frac{d}{dx}'],
        [B + 'partial ', B + 'partial'],
        [B + 'nabla ', B + 'nabla'],
        [B + 'infty ', B + 'infty']
      ]
    },
    {
      schluessel: 'formulaGrpSets', ersatz: 'Mengen', zeichen: [
        [B + 'in ', B + 'in'], [B + 'notin ', B + 'notin'], [B + 'subset ', B + 'subset'],
        [B + 'cup ', B + 'cup'], [B + 'cap ', B + 'cap'], [B + 'emptyset ', B + 'emptyset'],
        [B + 'forall ', B + 'forall'], [B + 'exists ', B + 'exists'],
        [B + 'mathbb{R}', B + 'mathbb{R}'], [B + 'mathbb{N}', B + 'mathbb{N}']
      ]
    },
    {
      schluessel: 'formulaGrpMore', ersatz: 'Mehr', zeichen: [
        [B + 'vec{|}', B + 'vec{v}'], [B + 'hat{|}', B + 'hat{x}'], [B + 'bar{|}', B + 'bar{x}'],
        [B + 'begin{pmatrix} | & ' + B + B + ' & ' + B + 'end{pmatrix}',
         B + 'begin{pmatrix}a&b' + B + B + 'c&d' + B + 'end{pmatrix}'],
        [B + 'begin{cases} | ' + B + B + ' ' + B + 'end{cases}',
         B + 'begin{cases}a' + B + B + 'b' + B + 'end{cases}'],
        [B + 'text{|}', B + 'text{abc}'],
        ['^' + B + 'circ ', '^' + B + 'circ']
      ]
    }
  ];

  const palette = document.createElement('div');
  palette.className = 'formula-palette';

  const paletteReiter = document.createElement('div');
  paletteReiter.className = 'formula-palette-tabs';

  const paletteFeld = document.createElement('div');
  paletteFeld.className = 'formula-palette-grid';

  palette.appendChild(paletteReiter);
  palette.appendChild(paletteFeld);

  /* ── Normale Schreibweise ─────────────────────────────────────────── */
  const einfachZeile = document.createElement('label');
  einfachZeile.className = 'formula-simple-row';
  const einfachHaken = document.createElement('input');
  einfachHaken.type = 'checkbox';
  einfachHaken.id = 'formula-simple';
  einfachHaken.checked = true;
  const einfachText = document.createElement('span');
  einfachZeile.appendChild(einfachHaken);
  einfachZeile.appendChild(einfachText);

  // Zeigt, was aus der normalen Schreibweise geworden ist
  const uebersetztZeile = document.createElement('div');
  uebersetztZeile.className = 'formula-translated';
  uebersetztZeile.style.display = 'none';

  const vorschau = document.createElement('div');
  vorschau.id = 'formula-preview';
  vorschau.className = 'formula-preview';

  const vorschauLabel = document.createElement('label');
  vorschauLabel.className = 'modal-label';
  vorschauLabel.style.marginTop = '12px';
  vorschauLabel.textContent = (typeof t === 'function' && t('formulaPreview')) || 'Vorschau';

  /* ══════════════════════════════════════════════════════════════════
     INLINE ODER BLOCK – NUR NOCH IM TEXT

     „Wieso gibt es bei Formel Inline und Block, man kann ja beide zoomen,
     kommt aufs Gleiche" – für eine Formel als OBJEKT stimmt das. Sie
     liegt frei auf der Seite, fliesst in keiner Zeile mit und wird an den
     Ecken gezogen; „eigene Zeile, zentriert" heisst dort gar nichts mehr.
     Übrig blieb ein Unterschied, den man kaum sieht: die Setzweise von
     KaTeX. Zwei Knöpfe für so wenig sind zwei zu viel.

     Ein Objekt wird deshalb immer in der grossen Setzweise gerendert –
     die, die man von einer freistehenden Formel erwartet: Summen- und
     Integralgrenzen stehen über und unter dem Zeichen, Brüche in voller
     Höhe.

     Die Wahl bleibt für Formeln, die IM TEXT stehen (ältere Hefte). Dort
     ist sie ein echter Unterschied: mitten im Satz oder als eigener,
     zentrierter Absatz.
     ══════════════════════════════════════════════════════════════════ */
  const displayRow = document.createElement('div');
  displayRow.className = 'formula-display-row';

  const displayInline = document.createElement('label');
  displayInline.className = 'formula-display-label';
  const radioInline = document.createElement('input');
  radioInline.type = 'radio';
  radioInline.name = 'formula-display';
  radioInline.value = 'inline';
  radioInline.checked = true;
  displayInline.appendChild(radioInline);
  displayInline.appendChild(document.createTextNode(' ' + ((typeof t === 'function' && t('formulaInline')) || 'Inline')));

  const displayBlock = document.createElement('label');
  displayBlock.className = 'formula-display-label';
  const radioBlock = document.createElement('input');
  radioBlock.type = 'radio';
  radioBlock.name = 'formula-display';
  radioBlock.value = 'block';
  displayBlock.appendChild(radioBlock);
  displayBlock.appendChild(document.createTextNode(' ' + ((typeof t === 'function' && t('formulaBlock')) || 'Block')));

  displayRow.appendChild(displayInline);
  displayRow.appendChild(displayBlock);

  const btnReihe = document.createElement('div');
  btnReihe.className = 'modal-btns';

  const abbrechenBtn = document.createElement('button');
  abbrechenBtn.id = 'formula-cancel';
  abbrechenBtn.textContent = (typeof t === 'function' && t('cancel')) || 'Abbrechen';

  const einfuegenBtn = document.createElement('button');
  einfuegenBtn.id = 'formula-ok';
  einfuegenBtn.className = 'ok-btn';
  einfuegenBtn.textContent = (typeof t === 'function' && t('formulaInsert')) || 'Einfügen';

  btnReihe.appendChild(abbrechenBtn);
  btnReihe.appendChild(einfuegenBtn);

  /* ── Überschrift und Schließkreuz in EINER Zeile ──────────────────
     Beide hingen einzeln im Modal und standen deshalb untereinander:
     das ✕ saß unter der Überschrift statt oben rechts, wo man es
     sucht und wo es in jedem anderen Fenster steht.

     Nicht .modal-head: die Klasse bringt eigenen Rand und eigenen
     Innenabstand mit und ist für Fenster gedacht, die selbst keinen
     haben (.settings-modal, padding 0). Hier hat das Modal seinen
     Innenabstand – es fehlt nur die Zeile. */
  const kopf = document.createElement('div');
  kopf.className = 'formula-head';
  kopf.appendChild(titel);
  kopf.appendChild(schliessenBtn);

  overlay.innerHTML = '';
  const modal = document.createElement('div');
  modal.className = 'modal modal-nb';
  modal.style.maxWidth = '580px';
  modal.appendChild(kopf);
  modal.appendChild(palette);
  modal.appendChild(label((typeof t === 'function' && t('formulaLatexLabel')) || 'Formel'));
  modal.appendChild(latexFeld);
  modal.appendChild(einfachZeile);
  modal.appendChild(uebersetztZeile);
  modal.appendChild(displayRow);
  modal.appendChild(vorschauLabel);
  modal.appendChild(vorschau);
  modal.appendChild(btnReihe);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  /* ── Zustand ────────────────────────────────────────────────────── */
  let _editSpan = null;       // eine Formel im TEXT (ältere Hefte)
  let _editObj = null;        // ein Formel-OBJEKT { obj, page, neuZeichnen }
  let _savedRange = null;     // Schreibmarke vor dem Öffnen
  let _vorschauTimer = 0;

  /* ── Was am Ende eingesetzt wird ──────────────────────────────────────
     Mit Haken durch die Übersetzung, ohne Haken wörtlich. Beides läuft
     durch dieselbe Stelle, damit Vorschau und Ergebnis nie auseinander
     gehen können. */
  function fertigesLatex() {
    const roh = latexFeld.value;
    if (!einfachHaken.checked) return roh;
    return (typeof window.normalToLatex === 'function')
      ? window.normalToLatex(roh) : roh;
  }

  /** Die Setzweise: im Text die gewählte, als Objekt immer die grosse. */
  function istBlock() {
    return _editSpan ? radioBlock.checked : true;
  }

  /* ── Vorschau ────────────────────────────────────────────────────── */
  function aktualisiereVorschau() {
    const roh = latexFeld.value;
    const latex = fertigesLatex();
    const displayMode = istBlock();

    // Nur zeigen, wenn die Übersetzung wirklich etwas geändert hat
    if (latex && latex !== roh.trim()) {
      uebersetztZeile.textContent = latex;
      uebersetztZeile.style.display = '';
    } else {
      uebersetztZeile.style.display = 'none';
    }

    if (!latex.trim()) { vorschau.innerHTML = ''; return; }

    const { html, fehler } = window.renderFormula(latex, displayMode);
    if (fehler) {
      vorschau.innerHTML = '<span style="color:#c04040;font-size:13px">'
        + (typeof t === 'function' && t('formulaError') || 'Fehler') + ': '
        + fehler.replace(/</g, '&lt;') + '</span>';
    } else {
      vorschau.innerHTML = html;
    }
  }

  latexFeld.addEventListener('input', () => {
    clearTimeout(_vorschauTimer);
    _vorschauTimer = setTimeout(aktualisiereVorschau, 300);
  });

  radioInline.addEventListener('change', aktualisiereVorschau);
  radioBlock.addEventListener('change', aktualisiereVorschau);
  einfachHaken.addEventListener('change', aktualisiereVorschau);

  /* ── Palette: einsetzen an der Schreibmarke ───────────────────────────
     setRangeText löst KEIN input-Ereignis aus, die Vorschau muss also von
     Hand nachgezogen werden. */
  function einsetzenAnMarke(vorlage) {
    const stelle = vorlage.indexOf('|');
    const text = stelle >= 0 ? vorlage.replace('|', '') : vorlage;

    const a = latexFeld.selectionStart;
    const b = latexFeld.selectionEnd;
    const auswahl = latexFeld.value.slice(a, b);

    let einzusetzen = text;
    let neuePos;

    if (auswahl && stelle >= 0) {
      // Markiertes wandert in die Lücke: „x" + Wurzel = Wurzel aus x
      einzusetzen = text.slice(0, stelle) + auswahl + text.slice(stelle);
      neuePos = a + stelle + auswahl.length;
    } else {
      neuePos = a + (stelle >= 0 ? stelle : text.length);
    }

    latexFeld.setRangeText(einzusetzen, a, b, 'end');
    latexFeld.selectionStart = latexFeld.selectionEnd = neuePos;
    latexFeld.focus();
    aktualisiereVorschau();
  }

  /* ── Palette aufbauen ────────────────────────────────────────────── */
  let _paletteGruppe = 0;

  function zeigeGruppe(nr) {
    _paletteGruppe = nr;
    [...paletteReiter.children].forEach((b, i) => b.classList.toggle('active', i === nr));

    paletteFeld.innerHTML = '';
    for (const [vorlage, anzeige] of PALETTE[nr].zeichen) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'formula-sym';
      // Das Zeichen selbst als Bild: verständlicher als sein Quelltext
      const gerendert = window.renderFormula(anzeige, false);
      b.innerHTML = gerendert.html || anzeige;
      b.title = vorlage.replace('|', '');
      // Der Klick darf dem Textfeld nicht den Fokus nehmen
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => einsetzenAnMarke(vorlage));
      paletteFeld.appendChild(b);
    }
  }

  function baueReiter() {
    paletteReiter.innerHTML = '';
    PALETTE.forEach((grp, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'formula-palette-tab' + (i === 0 ? ' active' : '');
      b.textContent = (typeof t === 'function' && t(grp.schluessel)) || grp.ersatz;
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => zeigeGruppe(i));
      paletteReiter.appendChild(b);
    });
  }

  /* ── Tastatur ───────────────────────────────────────────────────── */
  latexFeld.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      einfuegen();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      schliessen();
    }
  });

  /* ── Schreibmarke merken ────────────────────────────────────────────
     Dasselbe Muster wie in ui/insert.js: die Marke muss das Öffnen des
     Modals überleben, sonst weiss niemand mehr, wohin die Formel soll. */
  function merkeStelle() {
    _savedRange = null;
    const el = document.activeElement;
    if (!el || !el.classList || !el.classList.contains('j-text')) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    _savedRange = { feld: el, range: sel.getRangeAt(0).cloneRange() };
  }

  function stelleWiederher() {
    if (!_savedRange || !_savedRange.feld.isConnected) return false;
    _savedRange.feld.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_savedRange.range);
    return true;
  }

  /**
   * Auf dem Tablet den Fokus im Seitentext wieder abgeben.
   *
   * Die Stelle wird gebraucht (dorthin kommt die Formel), der Fokus nicht:
   * mit ihm steht die Bildschirmtastatur im Bild, obwohl gerade niemand
   * schreiben will. Gemerkt ist die Stelle da längst (merkeStelle).
   */
  function fingerFokusLoesen() {
    if (!document.body.classList.contains('touch-input')) return;
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('j-text')) a.blur();
  }

  /* ── Öffnen / Schließen ─────────────────────────────────────────── */
  function schliessen() {
    overlay.style.display = 'none';
    _editSpan = null;
    _editObj = null;
    _savedRange = null;
  }

  function einfuegen() {
    const latex = fertigesLatex().trim();
    if (!latex) { schliessen(); return; }
    const displayMode = istBlock();

    /* Ein Formel-OBJEKT wird an Ort und Stelle geändert – es liegt in
       page.objects[] und nicht im Text, also gibt es hier nichts
       einzusetzen (core/formula.js). */
    if (_editObj) {
      const { obj, page, neuZeichnen } = _editObj;
      if (typeof pushPageHistory === 'function') pushPageHistory(page);
      if (typeof updateFormulaObject === 'function') updateFormulaObject(obj, latex, displayMode);
      if (typeof neuZeichnen === 'function') neuZeichnen();
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
      if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
      schliessen();
      return;
    }

    if (_editSpan) {
      // Bestehende Formel ersetzen
      const neu = window.buildFormulaHtml(latex, displayMode);
      // buildFormulaHtml gibt für Block ein <p>…</p> zurück – das
      // ersetzt den ganzen Absatz. Für Inline nur das <span>.
      if (displayMode) {
        const block = _editSpan.closest('.j-formula-block');
        if (block) {
          block.outerHTML = neu;
        } else {
          // Die Formel war inline, soll jetzt Block werden
          const p = _editSpan.closest('p');
          if (p) p.outerHTML = neu;
          else _editSpan.outerHTML = neu;
        }
      } else {
        // Inline – ersetze nur das Span, lasse den umgebenden Absatz
        _editSpan.outerHTML = neu;
      }

      // Text-Inhalt der Seite nachziehen
      const textDiv = _editSpan.closest('.j-text');
      if (textDiv) {
        const pgEl = textDiv.closest('[data-pgid]');
        const info = pgEl && typeof getPage === 'function' ? getPage(pgEl.dataset.pgid) : null;
        if (info) {
          info.page.textContent = textDiv.innerHTML;
          if (window.Collab && typeof Collab.noteTextChange === 'function') {
            Collab.noteTextChange(info.page.id, info.page.textContent);
          }
          if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
        }
      }
      schliessen();
      return;
    }

    // Neue Formel
    stelleWiederher();
    if (typeof window.insertFormula === 'function') window.insertFormula(latex, displayMode);
    // Die Formel liegt jetzt da – die Tastatur hat nichts mehr zu tun
    fingerFokusLoesen();
    schliessen();
  }

  /**
   * Öffnet den Editor – für eine neue Formel oder zum Bearbeiten.
   *
   * @param {string} [latex='']    vorausgefüllter Quelltext
   * @param {boolean} [displayMode=false]
   * @param {HTMLSpanElement} [editSpan=null]  zu bearbeitende Formel
   */
  function openFormulaEditor(latex, displayMode, editSpan, editObj) {
    _editSpan = editSpan || null;
    _editObj = editObj || null;
    merkeStelle();
    // Erst merken, dann loslassen: die Stelle bleibt, die Tastatur geht
    fingerFokusLoesen();
    latexFeld.value = latex || '';

    /* Beim Bearbeiten einer bestehenden Formel steht dort fertiges LaTeX.
       Würde die Übersetzung darüberlaufen, machte sie aus einem gewollten
       a/b ein \frac – deshalb ist der Haken dann von vornherein aus. */
    einfachHaken.checked = !latex;

    radioInline.checked = !displayMode;
    radioBlock.checked = !!displayMode;
    // Die Wahl gibt es nur für Formeln im Text (siehe oben)
    displayRow.style.display = _editSpan ? '' : 'none';
    titel.textContent = (_editSpan || _editObj)
      ? ((typeof t === 'function' && t('formulaEdit')) || 'Formel bearbeiten')
      : ((typeof t === 'function' && t('formulaEditor')) || 'Formel');

    einfachText.textContent = ' ' + ((typeof t === 'function' && t('formulaSimpleMode'))
      || 'Normale Schreibweise übersetzen (1/2, sqrt(x), x^2, pi)');
    baueReiter();
    zeigeGruppe(_paletteGruppe);

    overlay.style.display = 'flex';
    /* ══════════════════════════════════════════════════════════════
       DIE SCHREIBMARKE NICHT INS FELD SETZEN, SOLANGE GETIPPT WIRD

       Mit der Maus ist das Feld der richtige Ort: wer LaTeX kann,
       schreibt sofort los. Mit dem Finger fährt dadurch die
       Bildschirmtastatur heraus und deckt das halbe Fenster zu –
       ausgerechnet die Palette, die für den Finger da ist. Genau so
       wurde es gemeldet.

       Wer dann doch tippen will, tippt ins Feld; die Tastatur kommt
       von selbst.
       ══════════════════════════════════════════════════════════════ */
    if (!document.body.classList.contains('touch-input')) latexFeld.focus();
    aktualisiereVorschau();
  }

  /* ── Knöpfe ─────────────────────────────────────────────────────── */
  abbrechenBtn.addEventListener('click', schliessen);
  einfuegenBtn.addEventListener('click', einfuegen);
  schliessenBtn.addEventListener('click', schliessen);

  overlay.addEventListener('mousedown', e => {
    if (e.target === overlay) schliessen();
  });

  /* ── Global erreichbar ──────────────────────────────────────────── */
  window.openFormulaEditor = openFormulaEditor;
})();
