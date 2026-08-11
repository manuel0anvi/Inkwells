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

  /* Zeigen und Antippen laufen über dasselbe: mit dem Finger gibt es kein
     Schweben, dort wählt die Berührung schon aus. */
  raster.addEventListener('pointermove', e => {
    const z = e.target.closest('.tbl-cell');
    if (z) markiere(+z.dataset.r, +z.dataset.c);
  });
  raster.addEventListener('pointerleave', () => markiere(0, 0));
  raster.addEventListener('click', e => {
    const z = e.target.closest('.tbl-cell');
    if (!z) return;
    schliessen();
    if (!stelleWiederher()) return;
    insertTable(+z.dataset.r, +z.dataset.c);
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
    if (!stelleWiederher()) return;
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
    markiere(0, 0);
    document.removeEventListener('pointerdown', draussen, true);
  }

  function draussen(e) {
    if (e.target.closest('#insert-pop, #btn-table')) return;
    schliessen();
  }

  btn.addEventListener('pointerdown', () => {
    if (offen()) { schliessen(); return; }
    merkeStelle();
    const r = btn.getBoundingClientRect();
    pop.style.display = 'flex';
    const breite = pop.offsetWidth || 220;
    pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - breite - 8, r.left))) + 'px';
    pop.style.top = Math.round(r.bottom + 6) + 'px';
    btn.classList.add('active');
    setTimeout(() => document.addEventListener('pointerdown', draussen, true), 0);
  });
})();
