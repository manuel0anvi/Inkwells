'use strict';

/* ══════════════════════════════════════════════════════════════════════
   EINFÜGEN: DREI KNÖPFE

   Medien, Tabelle, Formel stehen einzeln in der Leiste.

   >>> Warum kein Sammelknopf mehr <<<
   Es gab einen: ein „+", das ein Menü mit denselben drei Einträgen
   öffnete. Damit war nicht mehr zu sehen, dass es die drei überhaupt gibt
   – man musste den Knopf erst aufmachen, um es zu erfahren. Und für die
   Formel, die man am häufigsten braucht, waren es zwei Klicks statt einem.
   Passt die Leiste nicht mehr, blättern die Pfeile (ui/toolbar.js); das
   ist der Weg, auf dem knapper Platz hier gelöst wird.

   Ein Menü bleibt: das Raster der Tabelle. Es ist das aus Word –
   darüberfahren wählt die Größe, ein Klick setzt sie. Sechs mal sechs
   reichen für alles, was auf ein A4-Blatt gehört; wer mehr braucht, nimmt
   „Benutzerdefiniert".
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const btn = E('btn-table');
  const pop = E('insert-pop');
  const raster = E('tbl-grid');
  const anzeige = E('tbl-grid-label');
  if (!btn || !pop || !raster) return;

  const MAX = (typeof TBL_GRID_MAX === 'number') ? TBL_GRID_MAX : 6;

  /* >>> Die Marke muss die Öffnung überleben <<<
     Ein Klick in ein Menü nimmt dem Textfeld den Fokus, und damit ist die
     Stelle weg, an der die Tabelle hin soll. Deshalb wird sie beim Öffnen
     gemerkt und vor dem Einsetzen wiederhergestellt. */
  let gemerkteStelle = null;

  function merkeStelle() {
    gemerkteStelle = null;
    const el = document.activeElement;
    if (!el || !el.classList || !el.classList.contains('j-text')) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    gemerkteStelle = { feld: el, range: sel.getRangeAt(0).cloneRange() };
  }

  function stelleWiederher() {
    if (!gemerkteStelle || !gemerkteStelle.feld.isConnected) return false;
    gemerkteStelle.feld.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(gemerkteStelle.range);
    return true;
  }

  /* ── Das Raster ─────────────────────────────────────────────────── */
  const zellen = [];
  for (let r = 1; r <= MAX; r++) {
    for (let c = 1; c <= MAX; c++) {
      const zelle = document.createElement('span');
      zelle.className = 'tbl-cell';
      zelle.dataset.r = String(r);
      zelle.dataset.c = String(c);
      raster.appendChild(zelle);
      zellen.push(zelle);
    }
  }
  raster.style.gridTemplateColumns = 'repeat(' + MAX + ', 1fr)';

  function markiere(r, c) {
    for (const z of zellen) {
      z.classList.toggle('an', +z.dataset.r <= r && +z.dataset.c <= c);
    }
    if (anzeige) {
      anzeige.textContent = (r && c)
        ? r + ' × ' + c + '  ' + ((typeof t === 'function' && t('insertTable')) || 'Tabelle')
        : ' ';
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     MIT DEM FINGER ÜBER DAS RASTER FAHREN

     Mit der Maus fährt man darüber und sieht die Größe wachsen. Mit dem
     Finger ging das nicht – gemeldet als „man kann mit dem Finger schwer
     auswählen, wie groß die Tabelle sein soll".

     >>> Woran es lag <<<
     Eine Berührung wird beim ersten Element FESTGEHALTEN (implizites
     Pointer-Capture): jede weitere Meldung kommt mit demselben Ziel an,
     auch wenn der Finger längst drei Felder weiter ist. e.target sagt
     also immer „Feld 1×1". Deshalb wird die Stelle unter dem Finger
     selbst gesucht statt dem Ziel geglaubt.

     Gewählt wird beim Abheben und nicht per Klick: nach einer gezogenen
     Berührung meldet Chromium den Klick auf dem ANFANGS-Element – man
     bekäme also immer 1×1, egal wie weit man gezogen hat.
     ══════════════════════════════════════════════════════════════════ */
  let gewaehlt = null;

  function zelleBei(e) {
    if (e.pointerType === 'mouse' && e.target.closest) {
      const z = e.target.closest('.tbl-cell');
      if (z) return z;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el && el.closest ? el.closest('.tbl-cell') : null;
  }

  function zeige(e) {
    const z = zelleBei(e);
    if (!z) return;
    gewaehlt = { r: +z.dataset.r, c: +z.dataset.c };
    markiere(gewaehlt.r, gewaehlt.c);
  }

  raster.addEventListener('pointerdown', e => { e.preventDefault(); zeige(e); });
  raster.addEventListener('pointermove', zeige);
  // Nur die Maus verlässt das Raster, ohne etwas zu wollen
  raster.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') { gewaehlt = null; markiere(0, 0); }
  });
  raster.addEventListener('pointerup', e => {
    zeige(e);
    if (!gewaehlt) return;
    const { r, c } = gewaehlt;
    schliessen();
    /* Ohne gemerkte Marke wird trotzdem eingesetzt: insertTable() legt
       sie dann in die Mitte der Seite (core/tables.js). Hier stand ein
       „return" – wer vorher nirgends geklickt hatte, drückte auf das
       Raster und es passierte einfach nichts. */
    stelleWiederher();
    insertTable(r, c);
  });

  /* ── Benutzerdefiniert ──────────────────────────────────────────── */
  E('ins-table-custom')?.addEventListener('click', async () => {
    schliessen();
    const antwort = await txtModal(
      (typeof t === 'function' && t('insertTableAsk')) || 'Zeilen × Spalten (z. B. 8x3)',
      '8x3');
    if (!antwort) return;
    const m = /^\s*(\d+)\s*[x×*,\s]\s*(\d+)\s*$/.exec(antwort);
    if (!m) { toast((typeof t === 'function' && t('insertTableBad')) || 'Bitte etwas wie 8x3.', true); return; }
    stelleWiederher();
    insertTable(+m[1], +m[2]);
  });

  /* ── Formel und Medien: eigene Knöpfe, kein Umweg über ein Menü ────
     merkeStelle läuft in pointerdown, also BEVOR der Fokus zum Knopf
     wandert – im click wäre die Schreibmarke schon weg (derselbe Grund
     wie beim Tabellen-Knopf unten). */
  const btnFormel = E('btn-formula');
  if (btnFormel) {
    btnFormel.addEventListener('pointerdown', merkeStelle);
    btnFormel.addEventListener('click', () => {
      schliessen();
      stelleWiederher();
      if (typeof openFormulaEditor === 'function') openFormulaEditor('', false, null);
    });
  }

  const btnMedien = E('btn-media');
  if (btnMedien) {
    btnMedien.addEventListener('pointerdown', merkeStelle);
    btnMedien.addEventListener('click', () => {
      schliessen();
      stelleWiederher();
      if (typeof window.insertFilesFlow === 'function') window.insertFilesFlow();
    });
  }

  /* ── Öffnen und Schließen ───────────────────────────────────────── */
  function offen() { return pop.style.display === 'flex'; }

  function schliessen() {
    pop.style.display = 'none';
    btn.classList.remove('active');
    gewaehlt = null;
    markiere(0, 0);
    document.removeEventListener('pointerdown', draussen, true);
  }

  function draussen(e) {
    if (e.target.closest('#insert-pop, #btn-table')) return;
    schliessen();
  }

  /* ── Woran das Raster haengt ────────────────────────────────────────
     Gewoehnlich am Tabellen-Knopf. Im Hochformat gibt es den nicht: dort
     sammelt „+" die vier Einfuege-Werkzeuge (css/responsive.css), und
     der Tabellen-Knopf steht auf display:none. Sein Rechteck ist dann
     0×0 an der Stelle 0,0 – das Raster sass in der linken oberen Ecke
     des Fensters. Deshalb der Rueckfall auf den Knopf, der wirklich zu
     sehen ist. */
  function ankerKnopf() {
    if (btn.offsetParent !== null) return btn;
    const sammel = E('btn-insert-all');
    if (sammel && sammel.offsetParent !== null) return sammel;
    return E('toolbar') || btn;
  }

  btn.addEventListener('pointerdown', () => {
    if (offen()) { schliessen(); return; }
    merkeStelle();
    const r = ankerKnopf().getBoundingClientRect();
    pop.style.display = 'flex';
    const breite = pop.offsetWidth || 220;
    pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - breite - 8, r.left))) + 'px';
    pop.style.top = Math.round(r.bottom + 6) + 'px';
    btn.classList.add('active');
    setTimeout(() => document.addEventListener('pointerdown', draussen, true), 0);
  });

  /* ══════════════════════════════════════════════════════════════════
     DAS SAMMELMENUE IM HOCHFORMAT

     Quer bleibt es bei vier einzelnen Knoepfen – dort ist Platz, und
     man sieht, was es gibt. Im Hochformat ist die Leiste dafuer zu
     schmal; dann traegt ein „+" die vier, und css/responsive.css
     blendet die Einzelknoepfe weg.

     >>> Warum das Menue die KNOEPFE drueckt und nicht selbst handelt <<<
     Jeder der vier bringt eigenes Beiwerk mit: der Tabellen-Knopf sein
     Raster, der Formen-Knopf sein Einstellungsfenster, Medien und
     Formel das Merken der Schreibmarke. Das hier noch einmal
     nachzubauen hiesse, dieselbe Sache an zwei Stellen zu pflegen –
     und die zweite laeuft irgendwann der ersten hinterher. Ein
     .click() auf den echten Knopf hat all das schon.
     ══════════════════════════════════════════════════════════════════ */
  (function sammelMenue() {
    const sammelKnopf = E('btn-insert-all');
    const sammelPop = E('insert-all-pop');
    if (!sammelKnopf || !sammelPop) return;

    const sammelOffen = () => sammelPop.style.display === 'flex';

    function sammelZu() {
      sammelPop.style.display = 'none';
      sammelKnopf.classList.remove('active');
      document.removeEventListener('pointerdown', sammelDraussen, true);
    }

    function sammelDraussen(e) {
      if (e.target.closest('#insert-all-pop, #btn-insert-all')) return;
      sammelZu();
    }

    /* Der angesteuerte Knopf ist im Hochformat auf display:none. Ein
       .click() darauf wirkt trotzdem – der Handgriff haengt am Element,
       nicht an seiner Sichtbarkeit. Nur POINTER-Ereignisse bekaeme er
       nicht mehr, und genau die brauchen #btn-table und #btn-media, um
       ihr Fenster zu oeffnen bzw. die Schreibmarke zu merken. Deshalb
       wird beides geschickt: erst pointerdown, dann click. */
    function druecke(el) {
      if (!el) return;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      el.click();
    }

    /* Die zuletzt gewählte Sprache überdauert das Schliessen der App –
       wer Informatik hat, setzt zwanzig Blöcke in derselben Sprache und
       soll sie nicht zwanzigmal auswählen müssen. */
    const letzteSprache = () => {
      const gemerkt = (typeof Settings !== 'undefined' && Settings.get)
        ? Settings.get('codeSprache') : null;
      return (window.InkwellsCode && window.InkwellsCode.SPRACHEN[gemerkt])
        ? gemerkt : 'python';
    };

    const ZIELE = {
      shape: () => druecke(E('btn-shape')),
      table: () => druecke(E('btn-table')),
      media: () => druecke(E('btn-media')),
      formula: () => druecke(E('btn-formula')),
      /* Der Codeblock hat keinen eigenen Knopf in der Leiste – dort ist
         kein Platz mehr, und er wird seltener gebraucht als Tabelle oder
         Bild. Er entsteht deshalb unmittelbar. Die zuletzt gewählte
         Sprache merkt sich core/code.js. */
      code: () => window.InkwellsCode?.insertCode(letzteSprache()),
      /* Der Verweis hört auf mousedown und nicht auf click (ui/links.js
         merkt sich dort die Auswahl, bevor der Knopf dem Textfeld den
         Fokus nimmt). druecke() schickt pointerdown und click – das
         käme bei ihm nie an. */
      link: () => E('fmt-link')?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    };

    /* Die Schreibmarke muss die Oeffnung ueberleben – derselbe Grund wie
       oben beim Tabellen-Knopf, nur eine Ebene frueher. */
    sammelKnopf.addEventListener('pointerdown', () => {
      if (sammelOffen()) { sammelZu(); return; }
      merkeStelle();
      const r = sammelKnopf.getBoundingClientRect();
      sammelPop.style.display = 'flex';
      const b = sammelPop.offsetWidth || 200;
      sammelPop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - b - 8, r.left))) + 'px';
      sammelPop.style.top = Math.round(r.bottom + 6) + 'px';
      sammelKnopf.classList.add('active');
      setTimeout(() => document.addEventListener('pointerdown', sammelDraussen, true), 0);
    });

    sammelPop.addEventListener('click', e => {
      const eintrag = e.target.closest('[data-einfuegen]');
      if (!eintrag) return;
      sammelZu();
      /* Erst die Marke zurueck, dann den Knopf druecken: #btn-media und
         #btn-formula setzen sie beim Einfuegen voraus. Der Tabellen- und
         der Formen-Knopf merken sie sich selbst noch einmal. */
      stelleWiederher();
      ZIELE[eintrag.dataset.einfuegen]?.();
    });
  })();
})();
