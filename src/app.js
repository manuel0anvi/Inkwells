'use strict';
/* ══════════════════════════════════════════════════════════
   JOURNAL v5 — unified nav+sections panel
   ══════════════════════════════════════════════════════════ */

/* An window, nicht als blosses `let`.

   Ein `let` auf oberster Ebene eines klassischen Scripts wird KEINE
   Eigenschaft von window – canvas/text.js liest aber genau
   window._showWhitespaceDebug ab. Der Wert war dort also immer undefined,
   und updateWhitespaceDebugOverlays() stieg jedes Mal sofort wieder aus:
   das Kuerzel meldete "Formatierungszeichen: EIN", gezeichnet wurde nie
   etwas. */
window._showWhitespaceDebug = false;

/* ══════════════════════════════════════════════════════════
   RÜCKGÄNGIG / WIEDERHOLEN

   Arbeitet je Seite mit vollständigen Zustandsabbildern: Text,
   Handschrift und eingefügte Bilder. Die Aufrufstellen dafür gibt es
   überall im Programm (Zeichnen, Radieren, Objekte, Einfügen), sie
   liefen bisher nur ins Leere.
   ══════════════════════════════════════════════════════════ */

// Wie lange Tippen zu einem Schritt zusammengefasst wird
const HISTORY_TYPING_GAP_MS = 700;
// Obergrenze für den Verlauf einer Seite. Ohne das würden 80 vollständige
// Abbilder einer Seite mit eingebetteten Bildern hunderte MB belegen.
const HISTORY_BUDGET_BYTES = 24 * 1024 * 1024;

const _lastTypingSnapshot = {};   // pageId -> Zeitpunkt

function _historyEntry(pageId) {
  if (!pageId) return null;
  if (!S.history[pageId]) S.history[pageId] = { undo: [], redo: [] };
  return S.history[pageId];
}

// Abbilder werden als JSON-Text abgelegt: kompakter als verschachtelte
// Objekte und die Größe lässt sich direkt messen.
function _snapshotPageState(page) {
  if (!page) return null;
  const strokes = S.strokeHistory[page.id] || page.inkStrokes || [];
  return {
    text: page.textContent || '',
    strokes: JSON.stringify(strokes),
    objects: JSON.stringify(page.objects || []),
    bg: page.bg ?? null,
    bgImg: page.bgImg ?? null
  };
}

function _snapshotSize(snap) {
  if (!snap) return 0;
  return (snap.text?.length || 0) + (snap.strokes?.length || 0)
       + (snap.objects?.length || 0) + (snap.bgImg?.length || 0);
}

/** Wirft die ältesten Schritte weg, bis der Verlauf wieder ins Budget passt. */
function _trimHistory(entry) {
  const limit = S._historyLimit || 80;
  while (entry.undo.length > limit) entry.undo.shift();

  let total = 0;
  for (const s of entry.undo) total += _snapshotSize(s);
  for (const s of entry.redo) total += _snapshotSize(s);

  // Mindestens einen Schritt behalten, sonst wäre Rückgängig wirkungslos
  while (total > HISTORY_BUDGET_BYTES && entry.undo.length > 1) {
    total -= _snapshotSize(entry.undo.shift());
  }
}

function _applyPageSnapshot(page, snap) {
  if (!page || !snap) return;

  page.textContent = snap.text || '';
  page.objects = JSON.parse(snap.objects || '[]');
  if (snap.bg !== null) page.bg = snap.bg;
  if (snap.bgImg !== null) page.bgImg = snap.bgImg; else delete page.bgImg;

  const strokes = JSON.parse(snap.strokes || '[]');
  S.strokeHistory[page.id] = strokes;
  page.inkStrokes = JSON.parse(snap.strokes || '[]');

  // Darstellung nachziehen
  const pgEl = document.querySelector('[data-pgid="' + page.id + '"]');
  if (!pgEl) return;

  const textDiv = pgEl.querySelector('.j-text');
  if (textDiv) textDiv.innerHTML = sanitizePageHtml(page.textContent);

  // Entlastete Zeichenflächen erst wieder aufbauen, sonst geht das Zeichnen ins Leere
  if (window.PageCanvases) PageCanvases.ensure(page.id);
  const canvas = pgEl.querySelector('.j-canvas:not(.live-canvas)');
  if (canvas) redrawStrokes(canvas, strokes);

  const objLayer = pgEl.querySelector('.j-objects');
  if (objLayer) {
    objLayer.innerHTML = '';
    for (const obj of (page.objects || [])) placeObject(objLayer, obj, page);
  }
}

/** Sichert den aktuellen Zustand einer Seite, bevor sie verändert wird. */
function pushPageHistory(page) {
  if (!page || S._isUndoingOrRedoing) return;

  const entry = _historyEntry(page.id);
  if (!entry) return;

  entry.undo.push(_snapshotPageState(page));
  entry.redo.length = 0;   // neuer Zweig – Wiederholen ist hinfällig
  _trimHistory(entry);

  updateUndoRedoUI();
}

/** Wie pushPageHistory, fasst aber schnelles Tippen zu einem Schritt zusammen. */
function pushTypingHistory(page) {
  if (!page || S._isUndoingOrRedoing) return;

  const now = Date.now();
  const last = _lastTypingSnapshot[page.id] || 0;
  _lastTypingSnapshot[page.id] = now;

  if (now - last < HISTORY_TYPING_GAP_MS) return;   // gehört zum selben Schritt
  pushPageHistory(page);
}

/* Setzt die Knöpfe für Rückgängig/Wiederholen auf verfügbar oder nicht.

   >>> Zurzeit tut das nichts <<<
   Die beiden Knöpfe sind aus der Werkzeugleiste entfernt (index.html);
   beides läuft über die Kürzel. Die Funktion bleibt trotzdem stehen, und
   zwar mit Absicht: sie wird an dreizehn Stellen gerufen (app.js,
   canvas/objects.js, core/importExport.js, ui/toolbar.js). Diese Aufrufe
   zu entfernen wäre viel Änderung ohne jede Wirkung – und käme ein Knopf
   je zurück, müsste man sie alle wieder einsetzen und würde welche
   vergessen. Hier steht deshalb der eine Ort, an dem es wieder greift. */
function updateUndoRedoUI() {
  const undoBtn = E('btn-undo');
  const redoBtn = E('btn-redo');
  if (!undoBtn && !redoBtn) return;

  const entry = S.activePgId ? S.history[S.activePgId] : null;
  for (const [btn, seite] of [[undoBtn, 'undo'], [redoBtn, 'redo']]) {
    if (!btn) continue;
    const moeglich = !!entry && entry[seite].length > 0;
    btn.disabled = !moeglich;
    btn.classList.toggle('disabled', !moeglich);
  }
}

function _stepHistory(fromKey, toKey, emptyMsgKey) {
  const pgId = S.activePgId;
  const info = pgId ? getPage(pgId) : null;
  if (!info) return false;

  const entry = _historyEntry(pgId);
  if (!entry || !entry[fromKey].length) {
    toast(t(emptyMsgKey) || (fromKey === 'undo' ? 'Nichts zum Rückgängigmachen.' : 'Nichts zum Wiederholen.'));
    return false;
  }

  S._isUndoingOrRedoing = true;
  try {
    // Aktuellen Stand auf die Gegenseite legen, damit der Schritt umkehrbar bleibt
    entry[toKey].push(_snapshotPageState(info.page));
    _applyPageSnapshot(info.page, entry[fromKey].pop());
  } catch (err) {
    console.error('[History] Schritt fehlgeschlagen:', err);
    return false;
  } finally {
    S._isUndoingOrRedoing = false;
    // Tipp-Zusammenfassung zurücksetzen, sonst verschluckt der nächste
    // Tastendruck seinen eigenen Sicherungspunkt
    delete _lastTypingSnapshot[pgId];
  }

  updateUndoRedoUI();
  renderSideTree();
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  return true;
}

function undoPage() { return _stepHistory('undo', 'redo', 'undoNothing'); }
function redoPage() { return _stepHistory('redo', 'undo', 'redoNothing'); }


/* HOME GRID, CTX MENU, NB MODAL moved to ui/homeGrid.js */

/* ── OPEN NOTEBOOK ── */
/**
 * @param {string} id
 * @param {{pageId?: string}} [opts] Sprungziel, z. B. aus der Suche.
 *   Es sticht die Merkstelle: die Seite MUSS danach zu sehen sein,
 *   notfalls wird dafür der Ausschnitt gewechselt.
 */
function openNotebook(id, opts = {}) {
  S.activeNbId = id; const nb = getNb();
  // Eine offene Suche gehoert zum vorigen Heft. Ohne Neuzeichnen – das
  // uebernimmt openSection weiter unten ohnehin.
  if (typeof closeNbSearch === 'function') closeNbSearch(false);

  // Ein eigenes Heft ist immer beschreibbar. Ohne diese Zeile bliebe der
  // Nur-Lese-Modus hängen, wenn vorher ein fremdes Dokument offen war.
  // Für geteilte Dokumente hat ui/sharedDocs.js den Zustand schon gesetzt.
  if (typeof isSharedNotebook === 'function' && !isSharedNotebook(nb)) {
    applyReadOnlyChrome(false, null);
  }

  showJournal(nb);
  /* Sicherheitsnetz: normalerweise ist das Heft schon beim Laden umgestellt
     (core/init.js, core/cloudSync.js). Ein Heft, das auf anderem Weg
     hereinkommt, wird hier nachgezogen – die Funktion tut nichts, wenn
     bereits umgestellt. */
  normalizeNotebook(nb);
  getSections(nb);

  /* ── Da weitermachen, wo man aufgehört hat ──────────────────────────
     Seite und Ausschnitt stehen örtlich (core/settings.js), nicht im
     Heft: bei einem geteilten Dokument ist beides Sache jedes Einzelnen.
     Beides wird geprüft, bevor es gilt – ein Abschnitt kann inzwischen
     gelöscht, eine Seite verschoben oder weg sein. */
  const merk = (typeof getNotebookView === 'function') ? getNotebookView(nb.id) : {};
  if (typeof merk.secId === 'string') nb.activeSecId = merk.secId;

  /* Ohne gültigen Ausschnitt werden ALLE Seiten gezeigt. Das ist der
     Normalfall: früher musste immer ein Abschnitt offen sein, heute ist
     das Heft eine durchgehende Folge und der Filter die Ausnahme. */
  if (nb.activeSecId && !nb.sections.find(s => s.id === nb.activeSecId)) nb.activeSecId = '';

  /* Ein Sprungziel aus der Suche geht vor. Verbirgt der gemerkte
     Ausschnitt die gesuchte Seite, wird er gewechselt – sonst führte der
     Treffer sichtbar ins Leere. */
  const ziel = opts.pageId
    ? notebookPages(nb).find(p => String(p.id) === String(opts.pageId))
    : null;
  if (ziel) {
    const jetzt = activeSection(nb);
    const zuSehen = jetzt ? pagesOfSec(jetzt, nb) : notebookPages(nb);
    if (!zuSehen.some(p => p.id === ziel.id)) nb.activeSecId = ziel.secId || '';
  }

  const sec = activeSection(nb);
  // Nur anspringen, wenn die Seite im gezeigten Ausschnitt auch vorkommt
  const sichtbar = sec ? pagesOfSec(sec, nb) : notebookPages(nb);
  const start = ziel ? ziel.id
    : (sichtbar.some(p => String(p.id) === String(merk.pageId || '')) ? merk.pageId : null);

  openSection(sec, start);
  renderSideTree();

  /* Ist dieses Heft freigegeben, wird daraus jetzt eine Live-Sitzung –
     auch beim Besitzer. Läuft im Hintergrund weiter; bis der Raum steht,
     verhält sich das Heft ganz gewöhnlich (ui/sharedDocs.js). */
  if (typeof window.onNotebookOpened === 'function') window.onNotebookOpened(nb);
}

/* ── OPEN SECTION (renders its pages) ── */
/**
 * Zeichnet das Heft – wahlweise nur einen Ausschnitt.
 *
 * @param {object|null} sec  Abschnitt, auf den eingeschränkt wird.
 *                           **null zeigt alle Seiten** – das ist der
 *                           Normalfall, seit Abschnitte Etiketten sind.
 * @param {string|null} scrollToPgId
 *
 * Früher hieß das „Abschnitt öffnen", und ein leerer Abschnitt bekam
 * ungefragt eine Seite angelegt. Beides ist entfallen: ein Etikett, das
 * gerade auf keiner Seite klebt, ist in Ordnung und darf nicht dazu
 * führen, dass Seiten entstehen.
 */
function openSection(sec = null, scrollToPgId = null) {
  const nb = getNb(); if (!nb) return;
  nb.activeSecId = sec ? sec.id : '';
  // Der gewählte Ausschnitt gilt auch beim nächsten Öffnen des Hefts
  if (typeof rememberNotebookView === 'function') {
    rememberNotebookView(nb.id, { secId: nb.activeSecId });
  }
  let pages = visiblePages(nb);

  // Ein Heft ganz ohne Seiten gibt es nicht – ein leerer AUSSCHNITT schon.
  if (!pages.length && !S.readOnly && !notebookPages(nb).length) {
    insertPageInto(nb, sec, makePage(sec?.defaultBg || nb.defaultBg || 'ruled'));
    pages = visiblePages(nb);
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  }
  E('pages-wrap').innerHTML = ''; S.strokeHistory = {};
  // Beobachtung zurücksetzen, bevor die Seiten neu aufgebaut werden
  if (window.PageCanvases) PageCanvases.reset();
  for (let i = 0; i < pages.length; i++)appendPageDOM(pages[i], i);
  renumberVisiblePages();
  // Im Nur-Lese-Modus kann ein Abschnitt leer bleiben, weil keine Seite
  // nachgelegt wird – dann gibt es auch keine aktive Seite.
  if (pages.length) setActivePg(scrollToPgId || pages[0].id);
  updateUndoRedoUI();
  E('pg-scroll').scrollTop = 0;
  setupScrollAutoPage();
  renderSideTree();
  requestAnimationFrame(() => {
    refreshSizer();
    updateAddPageBtnVisibility();
    if (scrollToPgId) {
      const pgEl = E('pages-wrap').querySelector('[data-pgid="' + scrollToPgId + '"]');
      if (pgEl) {
        // Find absolute top handling standard zoom offset
        pgEl.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }
  });
}

/* SIDE TREE rendering and SECTION MANAGER moved to ui/sidebar.js */

/**
 * Schreibt hier gerade jemand anderes?
 *
 * In einem geteilten Dokument gehören die Zeile, an der eine Person
 * schreibt, und die darauf folgende ihr allein (ui/collab.js). Fasst
 * jemand anderes sie an, geschieht nichts – und er bekommt gesagt, warum.
 *
 * Ohne Live-Sitzung ist das immer false, der Editor verhält sich dann
 * genau wie zuvor.
 */
function lockedHere(page, textDiv, inputType) {
  if (!window.Collab || typeof Collab.editBlockedBy !== 'function') return false;
  const person = Collab.editBlockedBy(page.id, textDiv, inputType);
  if (!person) return false;
  Collab.warnLocked(person);
  return true;
}

/* ══════════════════════════════════════════════════════════
   FREIGABE-ZEICHEN AM SEITENKOPF

   Zeigt im geöffneten Heft, dass es weitergegeben wurde: ein Mensch,
   wenn die anderen mitschreiben dürfen, sonst ein Auge für „nur lesen".

   Die Auskunft kommt aus der örtlichen Merkliste (ui/share.js) – der
   Seitenaufbau soll nicht auf Firestore warten müssen. Was die
   Eingeladenen dürfen, steht allerdings nur dort; ui/share.js schreibt
   es deshalb als `access` mit, sobald das Freigabefenster offen war.
   ══════════════════════════════════════════════════════════ */
const SHARE_MARK_SVG = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  view: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
};

/** 'edit', 'view' oder null (nicht freigegeben) für das offene Heft. */
function shareMarkFor(nb) {
  // Ein fremdes Dokument hat man nicht selbst freigegeben – dort kein Zeichen
  if (!nb) return null;
  if (typeof isSharedNotebook === 'function' && isSharedNotebook(nb)) return null;

  const entry = typeof window.notebookShareEntry === 'function'
    ? window.notebookShareEntry(nb.id)
    : null;
  if (!entry || !(entry.docId || entry.shareId)) return null;

  /* 'off' heißt: das Dokument gibt es zwar noch, aber es führt niemand mehr
     hinein – kein Link, niemand eingeladen. Dann ist es auch nicht mehr
     freigegeben und bekommt kein Zeichen. */
  if (entry.access === 'off') return null;
  if (entry.access === 'view' || entry.access === 'edit') return entry.access;

  // Noch kein `access` gemerkt: die alte Lesekopie ist immer nur lesbar,
  // sonst entscheidet das Linkrecht.
  if (!entry.docId && entry.shareId) return 'view';
  return entry.linkMode === 'view' ? 'view' : 'edit';
}

/* Die Klasse ist wählbar, weil dasselbe Zeichen an zwei Orten steht: auf
   dem hellen Papier des Seitenkopfs und auf der dunklen Karte der
   Übersicht. Die Farbe muss dort jeweils eine andere sein. */
function shareMarkHTML(mark, cls = 'j-share-mark') {
  if (!mark) return '';
  const label = mark === 'view'
    ? (t('shareMarkView') || 'Freigegeben – andere können nur lesen')
    : (t('shareMarkEdit') || 'Freigegeben – andere können mitschreiben');
  return '<span class="' + cls + '" title="' + label + '">' + SHARE_MARK_SVG[mark] + '</span>';
}

/** Nach dem Freigeben oder Aufheben die Zeichen nachziehen, ohne alles neu
    aufzubauen – ui/share.js ruft das auf. */
function refreshPageShareIcons() {
  const mark = shareMarkFor(getNb());
  for (const left of document.querySelectorAll('.j-page-left')) {
    left.querySelector('.j-share-mark')?.remove();
    if (mark) left.insertAdjacentHTML('beforeend', shareMarkHTML(mark));
  }
}
window.refreshPageShareIcons = refreshPageShareIcons;

/* ══════════════════════════════════════════════════════════
   PAGE DOM
   ══════════════════════════════════════════════════════════ */
function appendPageDOM(page, index) {
  const nb = getNb(); const activeSec = nb.sections?.find(s => s.id === nb.activeSecId); const bgId = page.bg || activeSec?.defaultBg || nb.defaultBg;
  const lh = lhForBg(bgId); const pt = ptForBg(bgId);
  const targetW = page.w || CFG.PAGE_W;
  const targetH = page.h || CFG.PAGE_H;

  const div = document.createElement('div'); div.className = 'j-page bg-' + bgId; div.dataset.pgid = page.id;
  div.style.width = targetW + 'px'; div.style.minHeight = targetH + 'px';
  const hdr = document.createElement('div'); hdr.className = 'j-page-hdr';
  /* Seitenzahl und Freigabe-Zeichen bleiben zusammen in einer Gruppe –
     sonst zöge das space-between des Kopfes das Zeichen in die Mitte. */
  /* Die Nummer kommt aus dem Heft, nicht aus der Zeichenschleife: sie muss
     dieselbe bleiben, gleich wie viele Seiten gerade gezeigt werden.
     renumberVisiblePages() rechnet mit derselben Quelle. */
  const pageNo = pageNumberOf(nb, page.id) || (index + 1);
  const sec = findSecForPage(page.id, nb);
  /* Der Farbstreifen sitzt als Rand am Seitenkopf und wird ueber eine
     Veraenderliche eingefaerbt – dasselbe Verfahren wie --nb-color bei den
     Karten der Startseite. Ohne Abschnitt bleibt der Kopf, wie er war. */
  if (sec) div.style.setProperty('--sec-color', colorForSection(sec));
  hdr.classList.toggle('has-sec', !!sec);

  hdr.innerHTML = '<span class="j-page-left"><span class="j-page-num">'
    + t('pageNo').replace('{n}', String(pageNo)) + '</span>'
    + shareMarkHTML(shareMarkFor(nb)) + '</span>'
    + '<span class="j-page-date">' + fmt(page.date) + '</span>'
    + '<span class="j-page-actions">'
    + '<button class="pg-sec-btn" title="' + (sec ? t('sectionOf').replace('{name}', sec.name) : t('setSection')) + '">'
    + '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
    + '<path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h7" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
    + '</svg></button>'
    + '<button class="pg-menu-btn" title="Seitenoptionen">⋯</button>'
    + '</span>';
  hdr.querySelector('.pg-menu-btn').addEventListener('click', e => {
    e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect();
    showPgCtxMenu(r.left, r.bottom + 4, page, div);
  });
  hdr.querySelector('.pg-sec-btn').addEventListener('click', e => {
    e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect();
    showPgSectionMenu(r.left, r.bottom + 4, page);
  });
  hdr.style.pointerEvents = 'auto';
  div.appendChild(hdr);
  if (page.bgImg) {
    const bgImgEl = document.createElement('img');
    bgImgEl.src = page.bgImg;
    bgImgEl.style.cssText = 'position:absolute;top:56px;left:0;width:100%;height:calc(100% - 56px);z-index:1;object-fit:contain;pointer-events:none;display:block';
    // hide default page pattern if we have a full page image
    div.style.backgroundImage = 'none';
    div.style.backgroundColor = '#fff';
    div.appendChild(bgImgEl);
  }

  const canvas = makeCanvas(targetW, targetH);
  canvas.style.pointerEvents = S.mode === 'cursor' ? 'none' : 'auto';
  div.appendChild(canvas);

  const objLayer = document.createElement('div');
  objLayer.className = 'j-objects';
  div.appendChild(objLayer);

  // Nur-lesen-Fall: ein geteiltes Dokument ohne Bearbeitungsrecht. Vorher
  // war jede Seite ausnahmslos beschreibbar.
  const textDiv = document.createElement('div'); textDiv.className = 'j-text';
  textDiv.contentEditable = S.readOnly ? 'false' : 'true';
  textDiv.spellcheck = !S.readOnly;
  textDiv.dataset.ph = (index === 0 && !S.readOnly) ? 'Tippe hier…' : '';
  const rightPad = rightPadForBg(bgId);
  textDiv.style.cssText = 'font-size:17px;font-family:' + S.fontFamily + ';color:' + S.textColor
    + ';line-height:' + lh + 'px;padding-top:' + pt + 'px'
    + ';top:64px;left:72px;right:' + rightPad + 'px;bottom:24px'
    + ';pointer-events:' + (S.mode === 'cursor' ? 'auto' : 'none')
    + ';white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  // Fremder Seitentext geht immer durch die Bereinigung (core/sanitize.js)
  textDiv.innerHTML = sanitizePageHtml(page.textContent);

  textDiv.querySelectorAll('h1,h2,h3').forEach(h => {
    const p = document.createElement('p');
    const level = h.tagName === 'H1' ? 1 : h.tagName === 'H2' ? 2 : 3;
    p.className = 'j-title-' + level;
    p.innerHTML = h.innerHTML;
    h.replaceWith(p);
  });

  const st = document.createElement('style');
  st.textContent = '[data-pgid="' + page.id + '"] .j-text p.j-title-1{font-size:' + Math.round(lh * .75) + 'px}[data-pgid="' + page.id + '"] .j-text p.j-title-2{font-size:' + Math.round(lh * .65) + 'px}[data-pgid="' + page.id + '"] .j-text p.j-title-3{font-size:' + Math.round(lh * .58) + 'px}[data-pgid="' + page.id + '"] .j-text h1{font-size:' + Math.round(lh * .75) + 'px}[data-pgid="' + page.id + '"] .j-text h2{font-size:' + Math.round(lh * .65) + 'px}[data-pgid="' + page.id + '"] .j-text h3{font-size:' + Math.round(lh * .58) + 'px}';
  div.appendChild(st);
  div.appendChild(textDiv);
  S.strokeHistory[page.id] = JSON.parse(JSON.stringify(page.inkStrokes || []));
  redrawStrokes(canvas, S.strokeHistory[page.id]);
  (page.objects || []).forEach(obj => placeObject(objLayer, obj, page));
  attachInput(canvas, textDiv, objLayer, page);
  textDiv.addEventListener('input', () => {
    if (S._isUndoingOrRedoing) return;
    S._lastPgAction = S._lastPgAction || {};
    S._lastPgAction[page.id] = 'text';
    // Der Sicherungspunkt wird schon in 'beforeinput' gesetzt (pushTypingHistory),
    // dort ist der Text noch im Zustand vor der Änderung.
    updateUndoRedoUI();
    let guard = 0;
    while (guard < 4 && applyHangingIndentWrap(textDiv)) guard++;
    if (!isPlainTextEditable(textDiv)) {
      textDiv.querySelectorAll('h1,h2,h3,p.j-title-1,p.j-title-2,p.j-title-3').forEach(h => {
        const txt = h.textContent || '';
        const trimmed = txt.replace(/^[\s\u00A0]+/, '');
        if (trimmed !== txt) h.textContent = trimmed;
      });
    }
    page.textContent = textDiv.innerHTML;
    // Geteiltes Dokument: die Änderung geht sofort an die anderen
    // (ui/collab.js bremst das auf einen sinnvollen Takt).
    if (window.Collab) Collab.noteTextChange(page.id, page.textContent);
    // Nicht bei jedem Anschlag den ganzen Baum neu bauen
    scheduleSideTree();
    maybeAutoPage();
    checkPageOverflow(textDiv, page);
    if (window._showWhitespaceDebug) updateWhitespaceDebugOverlays();
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  });
  /* Vor der Änderung sichern – hier ist der Text noch im alten Zustand.
     pushTypingHistory fasst schnelles Tippen zu einem Schritt zusammen.

     Davor steht die Zeilensperre: schreibt gerade jemand anderes an
     dieser Zeile, wird die Eingabe abgewiesen. Der Ort dafür ist
     'beforeinput', weil hier noch nichts geschehen ist – bei 'input'
     stünde die Änderung schon im Text und wäre über Yjs längst
     unterwegs. */
  textDiv.addEventListener('beforeinput', e => {
    if (S._isUndoingOrRedoing) return;
    /* Nur-lesen wird hier NOCH einmal geprüft, obwohl contenteditable
       schon auf false steht. Das Attribut wird beim Aufbau der Seite
       gesetzt; das Recht kann sich danach jederzeit ändern (der Besitzer
       stuft herab, der Besitzer verliert die Verbindung). Ein Riegel am
       Ereignis gilt unabhängig davon, wann er gebraucht wird. */
    if (S.readOnly) { e.preventDefault(); return; }
    if (lockedHere(page, textDiv, e.inputType)) { e.preventDefault(); return; }
    pushTypingHistory(page);
  });
  textDiv.addEventListener('keydown', e => {
    const commitPlainTextEdit = (nextText, nextCaret) => {
      textDiv.textContent = nextText;
      setPlainCaret(textDiv, nextCaret);
      textDiv.dispatchEvent(new Event('input', { bubbles: true }));
    };

    /* Tab und Enter schreiben weiter unten selbst in den Text, teils ohne
       Umweg über beforeinput (commitPlainTextEdit setzt textContent
       direkt). Ein solcher Schreibzugriff geht auch an contenteditable
       vorbei – ohne Recht darf er deshalb gar nicht erst anfangen. */
    if ((e.key === 'Tab' || e.key === 'Enter') && S.readOnly) {
      e.preventDefault();
      return;
    }

    // Dasselbe für die Zeilensperre des anderen
    if ((e.key === 'Tab' || e.key === 'Enter') && lockedHere(page, textDiv, 'insertText')) {
      e.preventDefault();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const caretOffset = getCaretTextOffset(textDiv);
      if (caretOffset !== null && isPlainTextEditable(textDiv)) {
        const raw = (textDiv.textContent || '').replace(/\r/g, '');
        const nextText = raw.slice(0, caretOffset) + '\t' + raw.slice(caretOffset);
        commitPlainTextEdit(nextText, caretOffset + 1);
      } else {
        document.execCommand('insertText', false, '\t');
        setTimeout(() => checkPageOverflow(textDiv, page), 20);
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      const caretOffset = getCaretTextOffset(textDiv);
      if (caretOffset !== null) {
        const raw = ((isPlainTextEditable(textDiv) ? textDiv.textContent : textDiv.innerText) || '').replace(/\r/g, '');
        const lineStart = raw.lastIndexOf('\n', Math.max(0, caretOffset - 1)) + 1;
        const lineEndIdx = raw.indexOf('\n', caretOffset);
        const lineEnd = lineEndIdx === -1 ? raw.length : lineEndIdx;
        const lineText = raw.slice(lineStart, lineEnd);
        const indent = (lineText.match(/^[ \t]*/) || [''])[0];
        e.preventDefault();

        if (isPlainTextEditable(textDiv)) {
          const nextText = raw.slice(0, caretOffset) + '\n' + indent + raw.slice(caretOffset);
          commitPlainTextEdit(nextText, caretOffset + 1 + indent.length);
        } else {
          document.execCommand('insertParagraph', false, null);
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            let currentBlock = sel.getRangeAt(0).startContainer;
            while (currentBlock && currentBlock.parentElement !== textDiv && currentBlock !== textDiv) {
              currentBlock = currentBlock.parentElement;
            }
            if (currentBlock && currentBlock.nodeType === 1 && currentBlock.className && typeof currentBlock.className === 'string' && currentBlock.className.includes('j-title')) {
              currentBlock.className = '';
            }
          }
          if (indent) {
            document.execCommand('insertText', false, indent);
          }
          setTimeout(() => checkPageOverflow(textDiv, page), 20);
        }
        return;
      }
    }
    if (e.key === 'Enter') setTimeout(() => checkPageOverflow(textDiv, page), 20);
  });
  textDiv.addEventListener('paste', e => {
    e.preventDefault();
    if (S.readOnly) return;
    if (lockedHere(page, textDiv, 'insertFromPaste')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text) return;

    // Smart indent: get current line indentation
    const caret = getCaretTextOffset(textDiv);
    let indent = '';
    if (caret !== null) {
      const raw = (textDiv.innerText || '').replace(/\r/g, '');
      const lineStart = raw.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
      const lineEndIdx = raw.indexOf('\n', caret);
      const lineEnd = lineEndIdx === -1 ? raw.length : lineEndIdx;
      const lineText = raw.slice(lineStart, lineEnd);
      indent = (lineText.match(/^[ \t]*/) || [''])[0]; // existing indent of current line
    }

    // Apply indent to all subsequent lines
    const lines = text.split(/\r?\n/);
    const indented = lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n');
    document.execCommand('insertText', false, indented);
    setTimeout(() => { checkPageOverflow(textDiv, page); renderSideTree(); }, 20);
  });
  /* Nur die Markierung umsetzen, nicht den ganzen Baum neu bauen. Hier
     stand renderSideTree() – bei hundert Seiten also ein vollstaendiger
     Neuaufbau je Seite, die beim Scrollen sichtbar wird. */
  const obs = new IntersectionObserver(entries => { if (entries[0].isIntersecting) { setActivePg(page.id); markActiveNavItem(); } }, { root: E('pg-scroll'), threshold: 0.4 }); obs.observe(div);
  updateUndoRedoUI();
  E('pages-wrap').appendChild(div);
  // Ab vielen Seiten werden weit entfernte Zeichenflächen entlastet
  if (window.PageCanvases) PageCanvases.observe(div);
  return div;
}

/* CANVAS drawing and INPUT handling moved to canvas/drawing.js and canvas/input.js */

/* ── AUTO PAGE ── */
function updateAddPageBtnVisibility() {
  const sc = E('pg-scroll');
  const btnWrap = E('add-page-btn-wrap');
  if (!sc || !btnWrap) return;
  const pw = E('pages-wrap');
  const lastEl = pw ? pw.lastElementChild : null;
  if (!lastEl) {
    btnWrap.style.opacity = '0';
    btnWrap.style.pointerEvents = 'none';
    return;
  }
  const scRect = sc.getBoundingClientRect();
  btnWrap.style.left = '';
  btnWrap.style.right = '';
  btnWrap.style.width = '';
  const lastRect = lastEl.getBoundingClientRect();
  if (lastRect.bottom <= scRect.bottom + 120) {
    btnWrap.style.opacity = '1';
    btnWrap.style.pointerEvents = 'auto';
  } else {
    btnWrap.style.opacity = '0';
    btnWrap.style.pointerEvents = 'none';
  }
}

function setupScrollAutoPage() {
  const sc = E('pg-scroll');
  if (!sc._hasScrollListener) {
    sc.addEventListener('scroll', () => {
      maybeAutoPage();
      updateAddPageBtnVisibility();
    }, { passive: true });
    sc._hasScrollListener = true;
  }
}
function maybeAutoPage() { if (S.readOnly) return; const nb = getNb(); if (!nb) return; const pages = visiblePages(nb); const last = pages[pages.length - 1]; if (!last || pageIsEmpty(last)) return; const wrap = E('pages-wrap'); const lastEl = wrap.lastElementChild; if (!lastEl) return; const sc = E('pg-scroll'); if (sc.scrollTop + sc.clientHeight >= lastEl.offsetTop + lastEl.offsetHeight - CFG.SCROLL_THRESH) addAutoPage(); }
function addAutoPage() {
  if (S.readOnly) return;
  const nb = getNb(); if (!nb) return; const sec = activeSection(nb); const pages = visiblePages(nb); const last = pages[pages.length - 1]; if (!last || pageIsEmpty(last)) return;
  /* Ans Ende des HEFTS, mit dem Etikett des gezeigten Ausschnitts – sonst
     verschwaende die neue Seite sofort aus der Ansicht, in der sie entstand. */
  const pg = makePage((sec?.defaultBg) || nb.defaultBg || 'ruled'); insertPageInto(nb, sec, pg); const pgEl = appendPageDOM(pg, pages.length); pgEl.style.opacity = '0'; pgEl.style.transform = 'translateY(16px)'; pgEl.style.transition = 'opacity .3s,transform .3s'; requestAnimationFrame(() => requestAnimationFrame(() => { pgEl.style.opacity = '1'; pgEl.style.transform = 'none'; })); renumberVisiblePages(); renderSideTree();
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/* ── PAGE OVERFLOW ── */
function checkPageOverflow(textDiv, page) {
  if (S.readOnly) return;
  const lh = parseInt(textDiv.style.lineHeight) || 32; const availH = CFG.PAGE_H - 64 - 24;
  if (textDiv.scrollHeight <= availH + lh) return;
  const nb = getNb(); if (!nb) return;
  const sec = activeSection(nb);
  const pages = visiblePages(nb);
  const pageIdx = pages.indexOf(page);
  let nextPage = pages[pageIdx + 1]; const isNew = !nextPage;
  /* Die Folgeseite kommt direkt HINTER die uebergelaufene, nicht ans Ende:
     der Text laeuft weiter, also muss sie dort stehen, wo er weitergeht. */
  if (isNew) {
    nextPage = makePage((sec?.defaultBg) || nb.defaultBg || 'ruled');
    insertPageInto(nb, sec, nextPage, pageNumberOf(nb, page.id));
  }
  const overflow = [];
  while (textDiv.scrollHeight > availH + lh && textDiv.children.length > 0) { const last = textDiv.lastElementChild; overflow.unshift(last.outerHTML); last.remove(); }
  if (!overflow.length) return;
  page.textContent = textDiv.innerHTML;
  if (isNew) { const pgEl = appendPageDOM(nextPage, pages.length); pgEl.style.opacity = '0'; pgEl.style.transform = 'translateY(12px)'; pgEl.style.transition = 'opacity .25s,transform .25s'; requestAnimationFrame(() => requestAnimationFrame(() => { pgEl.style.opacity = '1'; pgEl.style.transform = 'none'; })); }
  const nextPgEl = E('pg-scroll').querySelector('[data-pgid="' + nextPage.id + '"]'); if (!nextPgEl) return;
  const nextTD = nextPgEl.querySelector('.j-text'); if (!nextTD) return;
  nextTD.innerHTML = overflow.join('') + nextTD.innerHTML; nextPage.textContent = nextTD.innerHTML;
  nextTD.focus(); const r = document.createRange(); r.setStart(nextTD, 0); r.collapse(true); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  nextPgEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActivePg(nextPage.id); renderSideTree();
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/* ── PANEL TOGGLE ── */
E('btn-panel-toggle').addEventListener('click', () => {
  const p = E('side-panel'); p.classList.toggle('open');
  E('btn-panel-toggle').classList.toggle('active', p.classList.contains('open'));
  setTimeout(() => _applyZoom(), 220);
});

/* ── ZOOM BUTTONS ── */
E('btn-zoom-in').addEventListener('click', zoomIn);
E('btn-zoom-out').addEventListener('click', zoomOut);
E('btn-zoom-reset').addEventListener('click', zoomReset);


/* ── ADD PAGE BUTTON ── */
E('btn-add-page-end').addEventListener('click', async () => {
  if (S.readOnly) return;
  const nb = getNb(); if (!nb) return;
  const sec = activeSection(nb);
  const pages = visiblePages(nb);
  const last = pages[pages.length - 1];
  if (last && pageIsVisuallyEmpty(last)) {
    await showAlert('Die letzte Seite ist noch leer.');
    return;
  }
  const pg = makePage(sec?.defaultBg || nb.defaultBg || 'ruled');
  insertPageInto(nb, sec, pg);
  const pgEl = appendPageDOM(pg, pages.length);
  renumberVisiblePages();
  pgEl.style.opacity = '0'; pgEl.style.transition = 'opacity .3s';
  requestAnimationFrame(() => { pgEl.style.opacity = '1'; });
  setTimeout(() => pgEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  renderSideTree(); refreshSizer();
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
});

/* ══ TOUCH HANDLING ═══════════════════════════════════════
   ≤100%: scroll normally (native touch scroll)
   >100%: pan the pages-wrap with one finger
   2 fingers always = pinch zoom
══════════════════════════════════════════════════════════ */
(function () {
  let _pinchDist = 0, _pinchZoom = 1;
  let _panActive = false, _panStartX = 0, _panStartY = 0;
  let _panOriginX = 0, _panOriginY = 0; // current translate offset

  function isTouchUiTarget(target) {
    return !!target.closest('.pg-menu-btn, .pg-sec-btn, .j-page-actions, .j-page-hdr, .obj-wrap, .obj-handle, .obj-bar, #ctx-menu, .txt-color-dropdown, .custom-color-pop');
  }

  // Parse current translate from pages-wrap transform
  function getPanOffset() {
    const pw = E('pages-wrap'); if (!pw) return { x: 0, y: 0 };
    const t = pw.style.transform || '';
    const m = t.match(/translate\(([^,]+)px,([^)]+)px\)/);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
  }
  function setPan(x, y) {
    const pw = E('pages-wrap'); if (!pw) return;
    const sc = E('pg-scroll');
    const viewW = sc ? sc.clientWidth / _zoom : CFG.PAGE_W;
    const viewH = sc ? sc.clientHeight / _zoom : CFG.PAGE_H;
    const halfW = CFG.PAGE_W / 2;
    const pageH = (pw.offsetHeight || CFG.PAGE_H);
    const maxX = halfW;
    const minX = -halfW;
    const maxY = viewH / 2;
    const minY = -pageH + viewH / 2;
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    pw.style.transform = 'scale(' + _zoom + ') translate(' + x + 'px,' + y + 'px)';
    pw.style.transformOrigin = 'top center';
  }
  // Make resetPan globally accessible for zoom.js
  window.resetPan = function resetPan() {
    const pw = E('pages-wrap'); if (!pw) return;
    pw.style.transform = 'scale(' + _zoom + ')';
    pw.style.transformOrigin = 'top center';
  }

  const sc = E('pg-scroll');

  sc.addEventListener('touchstart', e => {
    if (penIsActive()) { e.preventDefault(); return; }

    /* Zeichnet der Finger, gehoert ihm der Strich – nicht das Scrollen.
       Zwei Finger bleiben aber das Zoomen, sonst kaeme man aus einer
       vergroesserten Seite nicht mehr heraus. */
    if (typeof touchDrawActive === 'function' && touchDrawActive()
        && e.touches.length === 1 && e.target.closest('.j-page')) {
      _panActive = false;
      return;
    }

    if (isTouchUiTarget(e.target)) {
      _panActive = false;
      return;
    }

    if (e.touches.length === 2) {
      _pinchDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      _pinchZoom = _zoom;
      _panActive = false;
      e.preventDefault();
    } else if (e.touches.length === 1 && _zoom > panThreshold()) {
      _panActive = true;
      _panStartX = e.touches[0].clientX;
      _panStartY = e.touches[0].clientY;
      const off = getPanOffset();
      _panOriginX = off.x; _panOriginY = off.y;
      e.preventDefault();
    }
    // ≤100% + 1 finger: native scroll
  }, { passive: false });

  sc.addEventListener('touchmove', e => {
    if (penIsActive()) { e.preventDefault(); return; }

    // Ein zeichnender Finger scrollt nicht mit
    if (typeof touchDrawActive === 'function' && touchDrawActive()
        && e.touches.length === 1 && S.isDrawing) { e.preventDefault(); return; }

    if (e.touches.length === 2 && _pinchDist > 0) {
      const d = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      if (isVerticalMode()) _verticalAutoFit = false;
      setZoom(_pinchZoom * (d / _pinchDist));
      resetPan();
      e.preventDefault();
    } else if (e.touches.length === 1 && _panActive && _zoom > panThreshold()) {
      const dx = (e.touches[0].clientX - _panStartX) / _zoom;
      const dy = (e.touches[0].clientY - _panStartY) / _zoom;
      setPan(_panOriginX + dx, _panOriginY + dy);
      updateAddPageBtnVisibility();
      e.preventDefault();
    }
  }, { passive: false });

  sc.addEventListener('touchend', e => {
    if (e.touches.length < 2) _pinchDist = 0;
    if (e.touches.length === 0) _panActive = false;
    updateAddPageBtnVisibility();
  }, { passive: true });

  // Also block touch on the pages-wrap level (belt+suspenders)
  E('pages-wrap').addEventListener('touchstart', e => {
    if (penIsActive()) e.preventDefault();
  }, { passive: false });

})();

showHome();

