'use strict';

const getNb = (id = S.activeNbId) => S.notebooks.find(n => n.id === id);

/* ── Eigene Hefte und geteilte Dokumente auseinanderhalten ───────────
   Ein geteiltes Dokument liegt zwar wie ein Heft in S.notebooks – es
   wird schließlich mit derselben Oberfläche angezeigt –, darf aber
   nirgends in die eigene Verwaltung geraten: keine .jrnl-Datei, kein
   Eintrag in der Übersicht, kein Upload ins eigene Drive, kein
   Papierkorb. Sonst lädt die App des Empfängers fremde Hefte in SEIN
   Konto hoch. Das Kennzeichen dafür ist nb.origin.
   ─────────────────────────────────────────────────────────────────── */

/** @param {object|string} nbOrId Heft oder Heft-Kennung */
function isSharedNotebook(nbOrId) {
  const nb = (nbOrId && typeof nbOrId === 'object')
    ? nbOrId
    : S.notebooks.find(n => n.id === nbOrId);
  return !!(nb && nb.origin === 'shared');
}

/** Nur die eigenen Hefte – das, was auf der Startseite steht. */
function ownNotebooks() {
  return S.notebooks.filter(nb => nb.origin !== 'shared');
}

/** Alle gerade geöffneten geteilten Dokumente. */
function sharedNotebooks() {
  return S.notebooks.filter(nb => nb.origin === 'shared');
}

function getPage(pgId) {
  for (const nb of S.notebooks) {
    const p = nb.pages.find(p => p.id === pgId);
    if (p) return { nb, page: p };
  }
  return null;
}

function makePage(bgId = null) {
  return { id: uid(), date: new Date().toISOString(), bg: bgId, textContent: '', inkStrokes: [], objects: [] };
}

function pageIsEmpty(p) {
  if (p.bgImg || p.inkStrokes?.length || p.objects?.length) return false;
  return !(p.textContent || '').replace(/<[^>]+>/g, '').replace(/\s/g, '');
}

function pagePreview(p) {
  return (p.textContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function getSections(nb) {
  if (!nb.sections || !nb.sections.length) {
    nb.sections = [{ id: uid(), name: 'Allgemein', pgIds: nb.pages.map(p => p.id), defaultBg: nb.defaultBg || 'ruled' }];
  }
  nb.sections.forEach(s => { if (!s.defaultBg) s.defaultBg = nb.defaultBg || 'ruled'; });
  return nb.sections;
}

function pagesOfSec(sec, nb) {
  return (sec.pgIds || []).map(id => nb.pages.find(p => p.id === id)).filter(Boolean);
}

function findSecForPage(pgId, nb) {
  return (nb.sections || []).find(s => s.pgIds.includes(pgId));
}
