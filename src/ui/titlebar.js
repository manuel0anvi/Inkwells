'use strict';

/* ── WINDOW CONTROLS ── */
E('btn-min').addEventListener('click', () => window.api?.minimize()); 
E('btn-max').addEventListener('click', () => window.api?.maximize()); 
E('btn-close').addEventListener('click', () => window.api?.close());

/* Ein Quadrat, solange das Fenster nicht maximiert ist, zwei versetzte,
   wenn es maximiert ist. Der Hauptprozess meldet jeden Wechsel, auch den
   über Windows selbst (Doppelklick, Snap). */
function zeigeFensterzustand(maximiert) {
  const knopf = E('btn-max');
  if (!knopf) return;
  knopf.classList.toggle('maximiert', maximiert);
  const titel = maximiert
    ? ((typeof t === 'function' && t('windowRestore')) || 'Verkleinern')
    : ((typeof t === 'function' && t('windowMaximize')) || 'Maximieren');
  knopf.title = titel;
  knopf.setAttribute('aria-label', titel);
}
// Das Fenster startet maximiert (main.js) – bis zur ersten Meldung gilt das
zeigeFensterzustand(true);
window.api?.onMaximizedChange?.(zeigeFensterzustand);

E('btn-home').addEventListener('click', async () => { 
  // Sync first to ensure we capture the latest editor edits before check/save
  if (typeof syncAll === 'function') {
    try {
      syncAll();
    } catch (e) {
      console.error('[Navigation] syncAll failed before nav:', e);
    }
  }

  /* Offenes zuerst sichern, dann gehen.

     >>> Warum hier nichts mehr gefragt wird <<<
     Es gab einen zweiten Zweig für den Fall, dass das automatische
     Speichern ausgeschaltet war: ein Fenster mit „Speichern / Verwerfen
     / Abbrechen". Den Schalter gibt es nicht mehr (core/autoSave.js) –
     und mit ihm entfällt die Frage. Auf dem Weg zur Übersicht ist eh
     schon alles gespeichert; das hier fängt nur die letzten zwei
     Sekunden ab, in denen der Takt noch nicht gelaufen ist. */
  if (S.activeNbId && AutoSave.isDirty(S.activeNbId)) {
    try {
      await AutoSave.saveNow(S.activeNbId);
      toast(t('notebookSaved'));
    } catch (err) {
      console.error('[Navigation] Auto-saving before leaving failed:', err);
      toast(t('saveError'), true);
    }
  }
  showHome();
});
// Speichern und Formatierungszeichen laufen jetzt über die änderbaren
// Kürzel (core/shortcuts.js). Hier bleibt nur Esc – das ist überall das
// Abbrechen und bewusst nicht umbelegbar.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    deselect();
    if (E('ctx-menu').style.display !== 'none') hideCtxMenu();
  }
});
document.addEventListener('dragover', e => e.preventDefault());
/* Abgelegte Bilder und PDFs gehen denselben Weg wie die aus dem
   Dateiwähler (core/importExport.js, fuegeDateienEin) – und zwar an die
   Stelle, an der sie losgelassen wurden. Was über den Unterlagen
   abgelegt wird, gehört dorthin (ui/griffbereit.js). */
document.addEventListener('drop', async e => {
  e.preventDefault();
  if (e.target && e.target.closest && e.target.closest('#griff-panel, #griff-view')) return;
  if (typeof S === 'undefined' || S.readOnly || !S.activePgId) return;

  const roh = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
  if (!roh.length) return;
  // Die Stelle sofort – nach der Rückfrage steht der Zeiger auf dem Dialog
  const stelle = typeof einfuegeStelle === 'function' ? einfuegeStelle({ punkt: { x: e.clientX, y: e.clientY } }) : null;

  const insertType = await showInsertChoice();
  if (!insertType) return;

  const files = [];
  for (const f of roh) {
    const dataUrl = await new Promise((ok, fehler) => {
      const r = new FileReader();
      r.onload = ev => ok(ev.target.result);
      r.onerror = () => fehler(r.error);
      r.readAsDataURL(f);
    }).catch(() => null);
    if (dataUrl) files.push({ kind: f.type === 'application/pdf' ? 'pdf' : 'image', dataUrl, name: f.name });
  }
  if (files.length) await fuegeDateienEin(files, insertType, stelle);
});

E('pen-opts').style.display = 'none'; E('eraser-opts').style.display = 'none'; E('text-opts').style.display = 'flex';

