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

/* Das Seitenbild eines Vollbild-Imports (PDF, Word). Es entsteht an zwei
   Stellen – beim Aufbau der Seite und beim Rückgängigmachen –, und beide
   müssen dasselbe Mass verwenden: die 56 px oben sind der Seitenkopf,
   siehe BILD_KOPF_PX in core/importExport.js. */
const BGIMG_STIL = 'position:absolute;top:56px;left:0;width:100%;'
  + 'height:calc(100% - 56px);z-index:1;object-fit:contain;'
  + 'pointer-events:none;display:block';

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

  /* ── Was der andere gezeichnet hat, bleibt ───────────────────────────
     Der Verlauf hält je Schritt die VOLLSTÄNDIGE Strichliste. Ein
     Rückgängig setzte sie deshalb auch bei den Strichen zurück, die in
     der Zwischenzeit vom anderen hereingekommen sind – und weil der
     Vergleich das gleich darauf als geänderte Liste sieht, ging sie
     hinaus und löschte seine Arbeit auch bei ihm. Für ihn sah es aus,
     als habe man ihm den Strich weggewischt.

     Welche Striche von aussen kamen, weiss ui/collab.js. Ohne
     Live-Sitzung kommt hier unverändert zurück, was im Verlauf steht. */
  const zurueck = JSON.parse(snap.strokes || '[]');
  const strokes = (window.Collab && typeof Collab.behalteFremdeStriche === 'function')
    ? Collab.behalteFremdeStriche(page.id, S.strokeHistory[page.id] || [], zurueck)
    : zurueck;
  S.strokeHistory[page.id] = strokes;
  page.inkStrokes = JSON.parse(JSON.stringify(strokes));

  // Darstellung nachziehen
  const pgEl = document.querySelector('[data-pgid="' + page.id + '"]');
  if (!pgEl) return;

  /* ── Auch das PAPIER gehört zur Darstellung ────────────────────────
     Oben werden page.bg und page.bgImg zurückgesetzt, unten der Text,
     die Handschrift und die Bilder neu gezeichnet – das Papier stand
     dazwischen nirgends. Nach einem Strg+Z stand im Heft dann das eine
     und auf dem Blatt das andere, und das fiel erst auf, wenn die Seite
     das nächste Mal neu gezeichnet wurde: dann wechselte das Papier
     plötzlich von selbst.

     Nur die bg-Klasse tauschen, nicht das ganze class-Attribut: das
     Element trägt auch andere (obj-dragging). */
  const nbHier = getNb();
  const secHier = nbHier?.sections?.find(s => s.id === nbHier.activeSecId);
  const bgJetzt = page.bg || secHier?.defaultBg || nbHier?.defaultBg || 'ruled';
  for (const cls of [...pgEl.classList]) {
    if (cls.startsWith('bg-')) pgEl.classList.remove(cls);
  }
  pgEl.classList.add('bg-' + bgJetzt);

  const textFeld = pgEl.querySelector('.j-text');
  if (textFeld && typeof applyTextLayoutForBg === 'function') applyTextLayoutForBg(textFeld, bgJetzt);

  /* Und das Seitenbild, das ein Vollbild-Import auf die Seite legt.
     Es hängt am selben Schritt: _snapshotPageState hält es fest, oben
     wird es zurückgesetzt – ohne das hier bliebe ein zurückgenommenes
     Bild sichtbar oder ein wiederhergestelltes unsichtbar. */
  const altesBild = pgEl.querySelector('img.j-page-bgimg');
  if (page.bgImg) {
    if (altesBild) altesBild.src = page.bgImg;
    else {
      const bild = document.createElement('img');
      bild.className = 'j-page-bgimg';
      bild.src = page.bgImg;
      bild.style.cssText = BGIMG_STIL;
      pgEl.style.backgroundImage = 'none';
      pgEl.style.backgroundColor = '#fff';
      pgEl.insertBefore(bild, pgEl.querySelector('.j-page-hdr')?.nextSibling || pgEl.firstChild);
    }
  } else if (altesBild) {
    altesBild.remove();
    pgEl.style.backgroundImage = '';
    pgEl.style.backgroundColor = '';
  }

  const textDiv = pgEl.querySelector('.j-text');
  if (textDiv) {
    textDiv.innerHTML = sanitizePageHtml(page.textContent);
    // Die Spaltenbreite der freien Absätze gehört nicht ins Heft, sie
    // wird gerechnet – siehe ordneFreieAbsaetze in canvas/text.js
    if (typeof ordneFreieAbsaetze === 'function') ordneFreieAbsaetze(textDiv);

    /* ── Und im geteilten Dokument gehört es hinaus ────────────────────
       Der 'input'-Griff steigt bei S._isUndoingOrRedoing aus, gemeldet
       wurde hier also nichts: Strg+Z wirkte nur örtlich. Der Yjs-Stand
       behielt derweil den alten Text, die nächste eingehende Änderung
       holte ihn zurück, und irgendwann schickte ein zufälliger Anschlag
       den ganzen Unterschied auf einmal hinaus. */
    if (window.Collab && typeof Collab.noteTextChange === 'function') {
      Collab.noteTextChange(page.id, page.textContent);
    }
  }

  // Entlastete Zeichenflächen erst wieder aufbauen, sonst geht das Zeichnen ins Leere
  if (window.PageCanvases) PageCanvases.ensure(page.id);
  const canvas = pgEl.querySelector('.j-canvas:not(.live-canvas)');
  if (canvas) redrawStrokes(canvas, strokes);

  const objLayer = pgEl.querySelector('.j-objects');
  if (objLayer) {
    objLayer.innerHTML = '';
    for (const obj of (page.objects || [])) placeObject(objLayer, obj, page);
  }

  // Kommentar-Marken aus Firestore-Text wiederfinden
  if (typeof ensureCommentsFromMarkers === 'function') ensureCommentsFromMarkers(pgEl);
}

/* Die Bedienteile im Text: die Greifstreifen an den Spaltengrenzen und
   an den Zeilenunterkanten (core/tables.js). */
const GRIFF_WAHL = '.j-tbl-griff, .j-tbl-zeilengriff';

/* ══════════════════════════════════════════════════════════════════════
   WAS IM TEXT STEHT UND WAS NUR DARÜBERLIEGT

   Im .j-text steht zweierlei durcheinander: der Text des Hefts und die
   Anzeige, die die Oberfläche gerade darüberlegt. Gespeichert und
   verschickt werden darf nur das Erste.

   Zweierlei liegt darüber:

     · DIE GREIFSTREIFEN an Spalten- und Zeilenkanten (core/tables.js).
       Sie liegen als Kind in der Zelle, damit sie sich mit ihr bewegen.
       Kämen sie mit, reisten sie durch Yjs zu den anderen und kämen bei
       jedem Abgleich ein weiteres Mal dazu.

     · DER ZUSTAND EINER KOMMENTIERTEN STELLE: `j-aktiv` und `j-cursor`,
       solange man darüber schwebt oder mit der Schreibmarke darin steht,
       und der `title` mit Verfasser und Anmerkung (ui/comments.js). Das
       ist Anzeige, keine Auszeichnung – sie hängt daran, wo gerade die
       Maus liegt.

   >>> Warum das Zweite dazugekommen ist <<<
   Weil es sonst mitreist. Der `title` landete im gespeicherten Text und
   damit im geteilten Dokument: schon das blosse Darüberfahren machte
   aus einer unveränderten Seite eine geänderte, und der Abgleich schob
   sie hinaus. Beim anderen nahm die Bereinigung den `title` wieder weg
   (er steht nicht auf der Liste in core/sanitize.js) – seine Fassung
   unterschied sich damit wieder von unserer, und das Spiel begann von
   vorn. Ein Text, der sich beim Hinsehen ändert, ist für einen
   zeichengenauen Abgleich das Schlimmste, was es gibt.

   Kopiert wird der Baum, statt am lebenden herumzunehmen: das
   Herausnehmen und Zurückhängen verschöbe die Schreibmarke mitten im
   Tippen.
   ══════════════════════════════════════════════════════════════════════ */

/* Klassen und Attribute, die nur die Anzeige betreffen. `j-resolved`
   steht bewusst NICHT dabei: die kommt aus dem Kommentar selbst und ist
   für alle gleich. */
const NUR_ANZEIGE_KLASSEN = ['j-aktiv', 'j-cursor'];
const MARKEN_WAHL = '.j-comment-mark';

/**
 * Der HTML-Inhalt eines Textbereichs, so wie er ins Heft gehört.
 *
 * Jede Stelle, die den Editor ins Datenmodell schreibt, geht hier
 * hindurch – sonst rutscht die Anzeige an einer davon doch wieder mit
 * hinein (es sind sechs, und fünf hatten es einmal falsch).
 */
function ohneGriffe(textDiv) {
  if (!textDiv) return '';

  const griffe = textDiv.querySelector(GRIFF_WAHL);
  const marken = textDiv.querySelector(MARKEN_WAHL);
  /* Das AUSWEICHEN eines frei stehenden Absatzes ist das Dritte dieser
     Art: es steht im style, ist aber nichts Geschriebenes – es folgt
     daraus, wo die Nachbarn stehen (ordneFreieAbsaetze in
     canvas/text.js), und wird bei jeder Änderung neu gerechnet. Käme es
     mit, stünde in zwei Heften derselbe Text mit verschiedenen Massen,
     und der Abgleich hätte ohne Grund etwas zu tun.

     Gemeint sind margin-left und margin-top. In left/top steht dagegen
     die gewählte Stelle – die gehört ins Heft. */
  const geschoben = textDiv.querySelector('p.j-frei[style*="margin"]');
  if (!griffe && !marken && !geschoben) return textDiv.innerHTML;   // der Normalfall, ohne Kopie

  const kopie = textDiv.cloneNode(true);
  kopie.querySelectorAll('p.j-frei').forEach(p => {
    p.style.marginLeft = '';
    p.style.marginTop = '';
    if (!p.getAttribute('style')) p.removeAttribute('style');
  });
  kopie.querySelectorAll(GRIFF_WAHL).forEach(g => g.remove());
  kopie.querySelectorAll(MARKEN_WAHL).forEach(m => {
    m.removeAttribute('title');
    m.classList.remove(...NUR_ANZEIGE_KLASSEN);
    // Ein leer gewordenes class-Attribut nicht als class="" stehen lassen
    if (!m.getAttribute('class')) m.removeAttribute('class');
  });
  return kopie.innerHTML;
}

/* ══════════════════════════════════════════════════════════════════════
   DER EINE WEG VOM EDITOR INS HEFT

   Was am Text geändert wurde, muss DREI Dinge auslösen, und zwar immer
   alle drei: ins Datenmodell schreiben, an die anderen melden, das Heft
   als geändert markieren.

   >>> Warum das jetzt an einer Stelle steht <<<
   Es waren sechs Abschriften, und drei davon hatten nur den ersten
   Schritt. Gefunden beim Durchgehen, alle drei mit demselben Muster:

     · Der SEITENUMBRUCH (checkPageOverflow). Der Yjs-Stand der Quellseite
       enthielt weiterhin, was gerade weitergereicht worden war; beim
       anderen blieb es stehen, und die nächste eingehende Änderung holte
       es hier wieder zurück.
     · RÜCKGÄNGIG (_applyPageSnapshot). Der 'input'-Griff steigt wegen
       S._isUndoingOrRedoing vorher aus, gemeldet wurde also nichts.
       Strg+Z wirkte damit nur örtlich – bis irgendein späterer Anschlag
       zufällig einen riesigen Unterschied hinausschickte.
     · ÜBERSCHRIFT SETZEN (ui/toolbar.js). Dort fehlte zusätzlich das
       Markieren als geändert; die Auszeichnung konnte beim Schliessen
       verloren gehen.

   Wer von hier aus schreibt, kann keines der drei vergessen.

   @param {object} page
   @param {HTMLElement} textDiv
   @param {boolean} [stillOhneMelden] Nur ins Modell – für die Stelle in
     checkPageOverflow, die den Text gleich noch einmal anfasst.
   ══════════════════════════════════════════════════════════════════════ */
function uebernimmText(page, textDiv, stillOhneMelden = false) {
  if (!page || !textDiv) return;
  page.textContent = ohneGriffe(textDiv);
  if (stillOhneMelden) return;

  // Geteiltes Dokument: die Änderung geht sofort an die anderen
  // (ui/collab.js bremst das auf einen sinnvollen Takt).
  if (window.Collab && typeof Collab.noteTextChange === 'function') {
    Collab.noteTextChange(page.id, page.textContent);
  }
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}
window.uebernimmText = uebernimmText;

/* ══════════════════════════════════════════════════════════════════════
   DIE EINSTELLUNG WIRKT SOFORT – UND IM GETEILTEN HEFT BEI ALLEN

   Aufgerufen, wenn jemand in den Einstellungen umstellt, wie sich
   aneinanderstossende Texte verhalten (ui/settings.js), und wenn die
   Umstellung eines Besitzers hereinkommt (ui/sharedDocs.js).

   Von den beiden Arten ändert nur 'fest' wirklich etwas am Text: sie
   schreibt die neue Lage hinein. Deshalb geht dafür ein 'input' hinaus –
   daran hängt alles Weitere (ins Heft schreiben, an die anderen melden,
   sichern). Bei 'elastisch' bleibt der Text, wie er ist; dort wird nur
   neu gerechnet.
   ══════════════════════════════════════════════════════════════════════ */
window.wendeTextFlussAn = function wendeTextFlussAn() {
  if (typeof ordneFreieAbsaetze !== 'function') return;
  const art = (typeof ausweichArt === 'function') ? ausweichArt(getNb()) : 'elastisch';

  document.querySelectorAll('.j-text').forEach(textDiv => {
    ordneFreieAbsaetze(textDiv, art);
    if (art !== 'elastisch') textDiv.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* Als Besitzer eines offenen geteilten Dokuments: die Wahl gehört
     jetzt hinaus, nicht erst bei der nächsten Änderung am Text. */
  const nb = getNb();
  if (nb && nb.origin !== 'shared' && typeof window.forceSharedDocSave === 'function') {
    window.forceSharedDocSave().catch(() => { /* der nächste Takt holt es nach */ });
  }
};

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

/**
 * Nimmt den zuletzt gesicherten Schritt wieder herunter.
 *
 * Für Änderungen, die doch nicht stattfanden: ein Strich, den ein zweiter
 * Finger noch vor dem Absetzen abbricht (canvas/input.js). Ohne das bliebe
 * ein Rückgängig-Schritt stehen, der nichts rückgängig macht – und der
 * nächste Druck auf Strg+Z nähme dem Nutzer etwas weg, das er behalten
 * wollte.
 */
function popPageHistory(pageId) {
  const entry = pageId ? S.history[pageId] : null;
  if (!entry || !entry.undo.length) return;
  entry.undo.pop();
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

  /* Der Zähler unten links gehört zu DIESEM Heft. Ohne den Anstoß hier
     stünde nach dem Wechsel noch der Umfang des vorigen da – und das
     eine Sekunde lang, bis der Takt in ui/wordCount.js ihn einholt. */
  if (typeof window.refreshWordCount === 'function') window.refreshWordCount(true);
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
    /* >>> Erst einpassen, dann messen <<<
       Im Hochformat gehört die Seite auf die Breite des Schirms
       (core/zoom.js). Das lief bisher nur beim Umklappen und beim Zoomen –
       wer die App im Tablet-Modus startet und ein Heft öffnet, bekam
       deshalb die Grundgröße und musste selbst zurechtrücken. refreshSizer
       braucht den gültigen Zoom ohnehin, sonst stimmt die Rollhöhe nicht. */
    _applyZoom();
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
    // Die Klasse ist der Griff für _applyPageSnapshot – ohne sie liesse
    // sich das Bild beim Rückgängigmachen nicht wiederfinden.
    bgImgEl.className = 'j-page-bgimg';
    bgImgEl.src = page.bgImg;
    bgImgEl.style.cssText = BGIMG_STIL;
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
  // --lh reist mit: die Tabellenzellen richten ihre Hoehe danach
  // (css/pages.css), damit eine Tabellenzeile eine Textzeile hoch ist
  textDiv.style.cssText = 'font-size:17px;font-family:' + S.fontFamily + ';color:' + S.textColor
    + ';--lh:' + lh + 'px'
    + ';line-height:' + lh + 'px;padding-top:' + pt + 'px'
    + ';top:64px;left:72px;right:' + rightPad + 'px;bottom:24px'
    + ';pointer-events:' + (S.mode === 'cursor' ? 'auto' : 'none')
    + ';white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  // Fremder Seitentext geht immer durch die Bereinigung (core/sanitize.js)
  textDiv.innerHTML = sanitizePageHtml(page.textContent);
  /* Die Breite der frei stehenden Absätze steht nicht im Heft – sie
     ergibt sich aus der Lage der Nachbarn (canvas/text.js). Ohne diesen
     Aufruf liefen sie nach dem Öffnen ineinander, bis jemand tippt.

     Ein Bild später, weil die Seite hier noch gebaut wird: solange sie
     nicht hängt, sind alle offsetLeft null und es gäbe nichts zu
     rechnen. */
  if (typeof ordneFreieAbsaetze === 'function') {
    requestAnimationFrame(() => ordneFreieAbsaetze(textDiv));
  }

  textDiv.querySelectorAll('h1,h2,h3').forEach(h => {
    const p = document.createElement('p');
    const level = h.tagName === 'H1' ? 1 : h.tagName === 'H2' ? 2 : 3;
    p.className = 'j-title-' + level;
    p.innerHTML = h.innerHTML;
    h.replaceWith(p);
  });

  // Kommentar-Marken aus fremdem Text wiederfinden (noch bevor die
  // Kommentardaten im Heft sind – siehe core/comments.js)
  if (typeof ensureCommentsFromMarkers === 'function') ensureCommentsFromMarkers(div);

  const st = document.createElement('style');
  st.textContent = '[data-pgid="' + page.id + '"] .j-text p.j-title-1{font-size:' + Math.round(lh * .75) + 'px}[data-pgid="' + page.id + '"] .j-text p.j-title-2{font-size:' + Math.round(lh * .65) + 'px}[data-pgid="' + page.id + '"] .j-text p.j-title-3{font-size:' + Math.round(lh * .58) + 'px}[data-pgid="' + page.id + '"] .j-text h1{font-size:' + Math.round(lh * .75) + 'px}[data-pgid="' + page.id + '"] .j-text h2{font-size:' + Math.round(lh * .65) + 'px}[data-pgid="' + page.id + '"] .j-text h3{font-size:' + Math.round(lh * .58) + 'px}';
  div.appendChild(st);
  div.appendChild(textDiv);
  S.strokeHistory[page.id] = JSON.parse(JSON.stringify(page.inkStrokes || []));
  redrawStrokes(canvas, S.strokeHistory[page.id]);
  (page.objects || []).forEach(obj => placeObject(objLayer, obj, page));
  attachInput(canvas, textDiv, objLayer, page);
  /* Ein Klick ins Leere legt einen Absatz an, damit die Marke irgendwo
     stehen kann – aber nur VORLÄUFIG (canvas/text.js). Der erste
     Anschlag macht ihn endgültig, das Verlassen des Feldes räumt ihn
     weg. Ohne das hinterliesse jeder verirrte Klick einen leeren Absatz
     im Heft, im geteilten Dokument bei allen Beteiligten. */
  textDiv.addEventListener('blur', () => {
    if (typeof raeumeVorlaeufiges !== 'function') return;
    raeumeVorlaeufiges(textDiv);
  });

  textDiv.addEventListener('input', () => {
    if (S._isUndoingOrRedoing) return;
    if (typeof markiereBleibend === 'function') markiereBleibend(textDiv);
    /* Auffangnetz für alles, was doch einen freien Absatz kopiert hat –
       Einfügen aus der Zwischenablage etwa (canvas/text.js). */
    if (typeof richteFreieAbsaetze === 'function') richteFreieAbsaetze(textDiv);
    /* Und die Breite: ein wachsender Absatz reicht nur bis zu seinem
       Nachbarn und bricht dort um, statt in ihn hineinzulaufen. */
    if (typeof ordneFreieAbsaetze === 'function') ordneFreieAbsaetze(textDiv);
    S._lastPgAction = S._lastPgAction || {};
    S._lastPgAction[page.id] = 'text';
    // Der Sicherungspunkt wird schon in 'beforeinput' gesetzt (pushTypingHistory),
    // dort ist der Text noch im Zustand vor der Änderung.
    updateUndoRedoUI();
    /* Ein <br>, das contenteditable hinterlassen hat, wird zu einem
       echten Umbruch – sonst löscht ihn die nächste Runde über
       textContent stillschweigend weg (canvas/text.js). */
    if (typeof normalisiereUmbrueche === 'function') normalisiereUmbrueche(textDiv);
    let guard = 0;
    while (guard < 4 && applyHangingIndentWrap(textDiv)) guard++;
    /* „1. " oder „- " am Zeilenanfang wird zur Aufzählung – wie in Word.
       Muss VOR dem Merken von page.textContent laufen, sonst ginge die
       Umwandlung erst beim nächsten Anschlag an die anderen raus. */
    if (typeof Lists !== 'undefined') Lists.autoFormat(textDiv);
    if (!isPlainTextEditable(textDiv)) {
      textDiv.querySelectorAll('h1,h2,h3,p.j-title-1,p.j-title-2,p.j-title-3').forEach(h => {
        const txt = h.textContent || '';
        const trimmed = txt.replace(/^[\s\u00A0]+/, '');
        if (trimmed !== txt) h.textContent = trimmed;
      });
    }
    /* Ins Heft, an die anderen und auf den Merkzettel fürs Sichern – über
       uebernimmText, damit alle drei zusammen geschehen. Die Greifstreifen
       an den Spalten bleiben dabei draussen (core/tables.js): sie sind
       Bedienteil, kein Inhalt, und wüchsen sonst bei jedem Abgleich nach. */
    uebernimmText(page, textDiv);
    // Nicht bei jedem Anschlag den ganzen Baum neu bauen
    scheduleSideTree();
    maybeAutoPage();
    checkPageOverflow(textDiv, page);
    if (window._showWhitespaceDebug) updateWhitespaceDebugOverlays();
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
       vorbei – ohne Recht darf er deshalb gar nicht erst anfangen.

       Die Rücktaste braucht hier nichts: sie geht nur in einer
       Aufzählung einen eigenen Weg, und der ist unten zweifach
       verriegelt (die Abfrage auf S.readOnly und noch einmal in
       core/lists.js). Sonst läuft sie über contenteditable und wird in
       'beforeinput' abgefangen. */
    if ((e.key === 'Tab' || e.key === 'Enter') && S.readOnly) {
      e.preventDefault();
      return;
    }

    // Dasselbe für die Zeilensperre des anderen
    if ((e.key === 'Tab' || e.key === 'Enter') && lockedHere(page, textDiv, 'insertText')) {
      e.preventDefault();
      return;
    }

    /* ── In einer Tabelle gelten Word-Regeln (core/tables.js) ──────
       Tab in die nächste Zelle, in der letzten eine Zeile mehr; Enter
       bleibt in der Zelle. Muss VOR den Aufzählungen stehen: eine Liste
       in einer Tabellenzelle gibt es, und dann gewinnt die Tabelle –
       sonst rückte Tab die Aufzählung ein, statt die Zelle zu wechseln. */
    if (typeof handleTableKey === 'function' && !S.readOnly
        && (e.key === 'Tab' || e.key === 'Enter')) {
      if (handleTableKey(e)) {
        textDiv.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

    /* ── In einer Aufzählung gelten andere Regeln (core/lists.js) ──
       Tab rückt eine Ebene tiefer statt einen Tabulator zu setzen,
       Enter macht den nächsten Punkt und beendet auf einem leeren die
       Liste, die Rücktaste am Zeilenanfang nimmt die Einrückung zurück.
       Alles wie in Word. Trifft nichts davon zu, meldet Lists false und
       es bleibt beim bisherigen Verhalten. */
    if (typeof Lists !== 'undefined' && !S.readOnly) {
      let erledigt = false;
      if (e.key === 'Tab') erledigt = Lists.handleTab(e.shiftKey);
      else if (e.key === 'Enter' && !e.shiftKey) erledigt = Lists.handleEnter();
      else if (e.key === 'Backspace') {
        /* Erst fragen, ob es hier überhaupt um eine Liste geht: sonst
           würde die Sperre auch bei ganz gewöhnlichem Löschen ein
           zweites Mal warnen (das erste Mal in 'beforeinput'). */
        if (Lists.atListItemStart()) {
          if (lockedHere(page, textDiv, 'deleteContentBackward')) { e.preventDefault(); return; }
          erledigt = Lists.handleBackspace();
        }
      }
      if (erledigt) {
        e.preventDefault();
        setTimeout(() => checkPageOverflow(textDiv, page), 20);
        return;
      }
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
        /* Der Einzug der jetzigen Zeile – über einzugDerZeile, weil hier
           zwei verschiedene Masse aufeinandertrafen und die neue Zeile
           dadurch den Einzug einer ganz anderen bekam (canvas/text.js). */
        const indent = einzugDerZeile(textDiv);
        e.preventDefault();

        if (isPlainTextEditable(textDiv)) {
          const raw = (textDiv.textContent || '').replace(/\r/g, '');
          const nextText = raw.slice(0, caretOffset) + '\n' + indent + raw.slice(caretOffset);
          commitPlainTextEdit(nextText, caretOffset + 1 + indent.length);
        } else if (typeof beendeUeberschrift === 'function' && beendeUeberschrift(textDiv)) {
          /* Eine Überschrift hört mit ihrer Zeile auf: darunter beginnt
             ein neuer, gewöhnlicher Absatz (canvas/text.js). Der Einzug
             gilt weiter – er gehört zur Stelle, nicht zur Auszeichnung. */
          if (indent) document.execCommand('insertText', false, indent);
          setTimeout(() => checkPageOverflow(textDiv, page), 20);
        } else if (typeof imFreienAbsatz === 'function' && imFreienAbsatz(textDiv)) {
          /* ── Umbruch IN einem frei stehenden Absatz ──────────────────
             Ein Absatz, der frei auf dem Blatt steht (left/top, siehe
             canvas/text.js), ist ein Kästchen und keine Zeile im Fluss.
             Teilte man ihn, bekäme die zweite Hälfte Klasse und Lage der
             ersten mit – beide sässen genau aufeinander, der Text läge
             übereinander.

             Also wächst das Kästchen nach unten, statt sich zu teilen.
             Auf Papier ist es genauso: man schreibt unter der Zeile
             weiter, nicht in einem neuen Absatz. */
          document.execCommand('insertLineBreak');
          if (indent) document.execCommand('insertText', false, indent);
          setTimeout(() => checkPageOverflow(textDiv, page), 20);
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
    const daten = e.clipboardData || window.clipboardData;

    /* ── Ein Bild wird zum Objekt, kein Text ────────────────────────
       Und zwar VOR der Zeilensperre gefragt: ein Bild landet auf der
       Seite, nicht in der Zeile, an der ein anderer gerade schreibt.
       Es würde dort niemandem ins Gehege kommen.

       Ein Bildschirmfoto bringt nebenbei oft auch Text mit (die
       Anwendung legt beides in die Zwischenablage). Wer ein Bild
       kopiert hat, will das Bild – deshalb steht diese Frage zuerst
       und der Textzweig darunter kommt dann gar nicht mehr dran. */
    if (typeof zwischenablageHatBild === 'function' && zwischenablageHatBild(daten)) {
      fuegeBilderAusZwischenablage(daten, page)
        .then(n => { if (n) setTimeout(() => checkPageOverflow(textDiv, page), 20); })
        .catch(err => console.warn('[App] Bild einsetzen:', err?.message || err));
      return;
    }

    if (lockedHere(page, textDiv, 'insertFromPaste')) return;
    const text = daten.getData('text');
    if (!text) return;

    /* Der Einzug der jetzigen Zeile. Über einzugDerZeile und nicht mehr
       über innerText gegen getCaretTextOffset gerechnet: die beiden
       zählen die Zeilengrenzen verschieden, und der Einzug kam dadurch
       aus einer ganz anderen Zeile (canvas/text.js). Beim Einfügen wog
       das doppelt – er kam auf JEDE eingefügte Zeile. */
    const indent = einzugDerZeile(textDiv);

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
  const uebersteht = nimmUeberlauf(textDiv, availH, lh);
  if (!uebersteht) return;
  uebernimmText(page, textDiv);
  if (isNew) { const pgEl = appendPageDOM(nextPage, pages.length); pgEl.style.opacity = '0'; pgEl.style.transform = 'translateY(12px)'; pgEl.style.transition = 'opacity .25s,transform .25s'; requestAnimationFrame(() => requestAnimationFrame(() => { pgEl.style.opacity = '1'; pgEl.style.transform = 'none'; })); }
  const nextPgEl = E('pg-scroll').querySelector('[data-pgid="' + nextPage.id + '"]'); if (!nextPgEl) return;
  const nextTD = nextPgEl.querySelector('.j-text'); if (!nextTD) return;
  /* Reiner Text stiesse sonst an das, was auf der Folgeseite schon steht,
     und aus zwei Zeilen würde eine. Ein Umbruch dazwischen. */
  const letztes = uebersteht.lastChild;
  if (letztes && letztes.nodeType === Node.TEXT_NODE && nextTD.firstChild) letztes.nodeValue += '\n';
  nextTD.insertBefore(uebersteht, nextTD.firstChild);
  /* Frei stehende Absätze liegen nach dem Umzug womöglich auf dem, was
     auf der Folgeseite schon stand – ordneFreieAbsaetze bringt sie
     auseinander (canvas/text.js). */
  if (typeof ordneFreieAbsaetze === 'function') ordneFreieAbsaetze(nextTD);
  uebernimmText(nextPage, nextTD);
  nextTD.focus(); const r = document.createRange(); r.setStart(nextTD, 0); r.collapse(true); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  nextPgEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActivePg(nextPage.id); renderSideTree();
}

/* ══════════════════════════════════════════════════════════════════════
   WAS NICHT MEHR AUFS BLATT PASST

   Nimmt aus dem Textbereich heraus, was unter der Unterkante steht, und
   gibt es als Fragment zurück – bereit, oben auf der Folgeseite
   eingehängt zu werden.

   >>> Was hier vorher schiefging <<<
   Es stand eine Schleife da, die `textDiv.lastElementChild` nahm, bis es
   wieder passte. Zwei Fehler in einer Zeile:

     · DAS FALSCHE STÜCK. Frei stehende Absätze stehen im DOM in der
       Reihenfolge, in der sie ANGELEGT wurden – nicht in der, in der sie
       auf dem Blatt liegen (canvas/text.js). Der zuletzt angeklickte kann
       ganz oben sitzen. Auf die Folgeseite wanderte damit womöglich die
       oberste Zeile, während die unterste blieb.

     · GAR KEIN STÜCK. Wer einfach lostippt, ohne vorher irgendwohin zu
       klicken, füllt .j-text mit einem reinen Textknoten – Enter schreibt
       dort ein echtes '\n' (white-space: pre-wrap). Dann ist
       `children.length === 0`, die Schleife lief nie, und der Text lief
       unten aus dem Papier heraus, ohne dass je eine Folgeseite entstand.
       Das ist der häufigste Weg, überhaupt anzufangen.

   Deshalb zwei Wege: Elemente nach ihrer LAGE aussuchen, reinen Text an
   einer gemessenen Stelle trennen.

   @returns {DocumentFragment|null} null, wenn nichts übersteht
   ══════════════════════════════════════════════════════════════════════ */
function nimmUeberlauf(textDiv, availH, lh) {
  const feld = textDiv.getBoundingClientRect();
  const zoom = textDiv.offsetHeight > 0 ? (feld.height / textDiv.offsetHeight) : 1;
  // Unterkante des Blattes, in Bildschirm-Pixeln
  const grenzeY = feld.top + availH * Math.max(0.01, zoom);

  const frag = document.createDocumentFragment();

  /* ── Reiner Text: an einer gemessenen Stelle trennen ──────────────── */
  if (isPlainTextEditable(textDiv) && typeof stelleUnterhalb === 'function') {
    const schnitt = stelleUnterhalb(textDiv, grenzeY);
    if (schnitt <= 0) return null;

    const roh = (textDiv.textContent || '');
    /* Der Umbruch vor der Trennstelle gehört zur alten Seite und bliebe
       dort als leere Zeile stehen – er wird mit weggenommen. */
    const bis = (roh[schnitt - 1] === '\n') ? schnitt - 1 : schnitt;
    textDiv.textContent = roh.slice(0, bis);
    frag.appendChild(document.createTextNode(roh.slice(schnitt)));
    return frag;
  }

  /* ── Sonst: Elemente, das unterste zuerst ─────────────────────────── */
  const unterkante = el => (el.offsetTop || 0) + (el.offsetHeight || 0);
  const umgezogen = [];
  let schutz = 0;
  while (textDiv.scrollHeight > availH + lh && textDiv.children.length > 0 && schutz++ < 400) {
    let tiefstes = null;
    for (const el of textDiv.children) {
      if (!tiefstes || unterkante(el) > unterkante(tiefstes)) tiefstes = el;
    }
    /* Steht auch das unterste noch ganz auf dem Blatt, kommt der Überlauf
       von etwas anderem her – dann darf hier nichts weggenommen werden.
       Ohne diese Bremse räumte die Schleife die Seite leer. */
    if (!tiefstes || unterkante(tiefstes) <= availH) break;
    umgezogen.unshift(tiefstes);
    tiefstes.remove();
  }
  if (!umgezogen.length) return null;

  /* ── Und die Lage auf die neue Seite umrechnen ─────────────────────
     Ein frei stehender Absatz trägt seine Höhe in `top`. Ohne diese
     Rechnung säße er auf der Folgeseite wieder ganz unten – und liefe
     dort beim nächsten Anschlag gleich wieder über. Alle rücken um
     denselben Betrag hoch, damit ihr Abstand zueinander bleibt; der
     oberste landet auf der ersten Zeile. */
  const pt = parseFloat(getComputedStyle(textDiv).paddingTop) || 0;
  const freie = umgezogen.filter(el => el.classList && el.classList.contains('j-frei'));
  if (freie.length) {
    const hoechstes = Math.min(...freie.map(el => parseFloat(el.style.top) || 0));
    const hoch = Math.round((hoechstes - pt) / lh) * lh;
    if (hoch > 0) {
      for (const el of freie) {
        el.style.top = Math.max(pt, (parseFloat(el.style.top) || 0) - hoch) + 'px';
      }
    }
  }

  for (const el of umgezogen) frag.appendChild(el);
  return frag;
}

/* ── PANEL TOGGLE ── */
function setSidePanel(offen) {
  const p = E('side-panel');
  if (!p || p.classList.contains('open') === offen) return;
  p.classList.toggle('open', offen);
  E('btn-panel-toggle').classList.toggle('active', offen);
  setTimeout(() => _applyZoom(), 220);
}

E('btn-panel-toggle').addEventListener('click', () => {
  setSidePanel(!E('side-panel').classList.contains('open'));
});

/* ══════════════════════════════════════════════════════════════════════
   DIE ABSCHNITTE MIT DEM FINGER AUFZIEHEN

   Mit der Maus ist der Knopf am Rand der Weg; mit dem Finger sucht man
   ihn: 28 px in einer 36 px schmalen Leiste, weit weg vom Daumen.

   >>> Warum es NICHT an der Leiste selbst anfangen darf <<<
   Der erste Anlauf horchte nur auf der Leiste. Die ist 36 px breit und
   klebt am linken Fensterrand – bei einem Vollbild also am
   BILDSCHIRMrand. Genau dort greift Windows selbst zu: ein Wischen von
   links holt die Widgets herein. Gemeldet wurde beides, was daraus
   folgt: „geht ganz selten" und „stattdessen geht dieses Microsoft-Ding
   auf". Was Windows abfängt, sieht die App nie.

   Deshalb reicht das Band jetzt RAND px über die Leiste hinaus. Der
   Finger kann mitten im Fenster ansetzen, wo ihm niemand dazwischenkommt.
   Zumachen geht überall auf der offenen Leiste – auch das war „richtig
   schwer", solange es nur auf den 36 px am Bildschirmrand ging.

   Waagerecht muss die Bewegung sein: senkrecht wird gescrollt. Und beim
   Zeichnen gilt sie gar nicht, sonst würde jeder Strich am linken
   Seitenrand die Leiste aufziehen.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const panel = E('side-panel');
  const layout = document.querySelector('.journal-layout');
  if (!panel || !layout) return;

  const WISCH_MIN = 32;      // darunter ist es ein Tippen, kein Wischen
  const RAND = 56;           // so weit rechts der Leiste darf es anfangen
  let x0 = 0, y0 = 0, aktiv = false;

  layout.addEventListener('touchstart', e => {
    aktiv = false;
    if (e.touches.length !== 1) return;
    // Ein Zeichenwerkzeug hat Vorrang – der Strich gehört dem Papier
    if (typeof touchDrawActive === 'function' && touchDrawActive()) return;

    const t = e.touches[0];
    const r = panel.getBoundingClientRect();
    if (t.clientX > r.right + RAND) return;

    aktiv = true;
    x0 = t.clientX;
    y0 = t.clientY;
  }, { passive: true });

  layout.addEventListener('touchend', e => {
    if (!aktiv) return;
    aktiv = false;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < WISCH_MIN || Math.abs(dx) <= Math.abs(dy)) return;

    /* Das Wischen fängt oft auf dem Knopf selbst an – er füllt die
       Leiste fast aus. Ohne das hier folgte dem Wischen sein Klick, und
       der schloss die gerade aufgezogene Leiste sofort wieder. */
    e.preventDefault();

    /* >>> Und die Bildschirmtastatur bleibt zu <<<
       Das Band reicht bis in die Seite hinein. Endete das Wischen über
       dem Text, hat der Browser dort die Schreibmarke gesetzt – und
       Windows fährt daraufhin die Tastatur aus. Mitten in einer Geste,
       die mit Schreiben nichts zu tun hat. Der Fokus gehört danach
       niemandem. */
    const fokus = document.activeElement;
    if (fokus && fokus.classList && fokus.classList.contains('j-text')) {
      try { fokus.blur(); } catch (err) { /* egal */ }
    }

    setSidePanel(dx > 0);
  }, { passive: false });
})();

/* ── ZOOM ──────────────────────────────────────────────────────────
   − und + stehen wieder fest in der Leiste (index.html) und werden nie
   weggeblaettert. Der Prozentwert dazwischen setzt zurueck: quer auf
   100 %, im Hochformat auf „eingepasst" (core/zoom.js, zoomReset). */
E('btn-zoom-in')?.addEventListener('click', zoomIn);
E('btn-zoom-out')?.addEventListener('click', zoomOut);
E('btn-zoom-reset')?.addEventListener('click', zoomReset);



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
  let _pinchMidX = 0, _pinchMidY = 0;
  let _panActive = false, _panStartX = 0, _panStartY = 0;
  let _panOriginX = 0, _panOriginY = 0; // current translate offset

  const mitte = (e) => ({
    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
  });

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
    /* getZoom() und nicht _zoom: im schmalen Fenster gilt weniger, als
       eingestellt ist (core/zoom.js). Mit dem eingestellten Wert stünde
       hier ein zu grosser Massstab und das Blatt spränge beim Schieben. */
    const z = getZoom();
    const viewW = sc ? sc.clientWidth / z : CFG.PAGE_W;
    const viewH = sc ? sc.clientHeight / z : CFG.PAGE_H;
    const halfW = CFG.PAGE_W / 2;
    const pageH = (pw.offsetHeight || CFG.PAGE_H);
    const maxX = halfW;
    const minX = -halfW;
    const maxY = viewH / 2;
    const minY = -pageH + viewH / 2;
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    pw.style.transform = 'scale(' + z + ') translate(' + x + 'px,' + y + 'px)';
    pw.style.transformOrigin = 'top center';
  }
  // Make resetPan globally accessible for zoom.js
  window.resetPan = function resetPan() {
    const pw = E('pages-wrap'); if (!pw) return;
    /* Ebenfalls getZoom(): resetPan() laeuft am Ende von _applyZoom() und
       hat dessen gerade gesetzten Massstab damit ueberschrieben – im
       schmalen Fenster stand danach wieder der zu grosse Wert auf dem
       Blatt, obwohl der Zoom laengst kleiner war. */
    pw.style.transform = 'scale(' + getZoom() + ')';
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
      /* Der zweite Finger beendet einen laufenden Strich. Ohne das bliebe
         von jedem Zoomen ein Strich stehen: Finger eins zeichnet weiter,
         waehrend Finger zwei die Seite groesser zieht. */
      if (S.isDrawing && typeof cancelActiveStroke === 'function') cancelActiveStroke();
      _pinchDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      _pinchZoom = _zoom;
      const m = mitte(e); _pinchMidX = m.x; _pinchMidY = m.y;
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
      // Vor setZoom lesen: _applyZoom schreibt transform neu und wirft die
      // Verschiebung dabei weg
      const vorher = getPanOffset();
      setZoom(_pinchZoom * (d / _pinchDist));

      /* ── Zwei Finger bewegen die Seite auch ───────────────────────
         Hier wurde nur gezoomt. Solange der Finger noch scrollen durfte,
         fiel das nicht auf; seit er zeichnet, ist das Schieben mit zwei
         Fingern der einzige Weg, ueber der Seite weiterzukommen – und
         genau das verspricht der Hinweis beim Einschalten. */
      const m = mitte(e);
      const dx = m.x - _pinchMidX, dy = m.y - _pinchMidY;
      _pinchMidX = m.x; _pinchMidY = m.y;
      if (_zoom > panThreshold()) {
        setPan(vorher.x + dx / _zoom, vorher.y + dy / _zoom);
      } else {
        resetPan();
        sc.scrollTop -= dy;
        sc.scrollLeft -= dx;
      }
      updateAddPageBtnVisibility();
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

