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

/* ── Die Seiten eines Hefts, in Heft-Reihenfolge ─────────────────────
   >>> Warum es diese Funktion braucht <<<
   Es gibt heute ZWEI Reihenfolgen, und sie stimmen nicht überein:

     · nb.pages ist reine Einfüge-Reihenfolge – überall nur push()
     · angezeigt wird aneinandergehängt, was in den pgIds steht

   Wer eine PDF-Seite in die Mitte einfügt, hat sie in pgIds an der
   richtigen Stelle und in nb.pages ganz hinten. Weil head.pageOrder für
   die Cloud aus nb.pages gebildet wird, steht dort die FALSCHE
   Reihenfolge – website/js/viewer.js beschreibt das als Warnung und
   umgeht es.

   Dieselbe Schleife stand deshalb viermal im Haus abgeschrieben
   (exportPageList, der Übertragungs-Dialog, getNotebookPages der Website
   und sinngemäß head.pageOrder). Ab jetzt gibt es eine Stelle.

   Seiten, die in keinem Abschnitt stehen, gehen nicht verloren: sie
   hängen hinten an, in ihrer bisherigen Reihenfolge. */
function notebookPages(nb) {
  if (!nb || !Array.isArray(nb.pages)) return [];

  const byId = new Map(nb.pages.map(p => [String(p.id), p]));
  const out = [];
  const seen = new Set();

  for (const sec of (nb.sections || [])) {
    for (const pgId of (sec.pgIds || [])) {
      const key = String(pgId);
      if (seen.has(key)) continue;          // in zwei Abschnitten: der erste gilt
      const page = byId.get(key);
      if (!page) continue;                  // Karteileiche
      seen.add(key);
      out.push(page);
    }
  }

  for (const page of nb.pages) {
    if (seen.has(String(page.id))) continue;
    out.push(page);
  }

  return out;
}

/** Die Seitenzahl, wie sie im ganzen Heft gilt – 1-basiert, 0 = unbekannt. */
function pageNumberOf(nb, pgId) {
  return notebookPages(nb).findIndex(p => String(p.id) === String(pgId)) + 1;
}

function pagesOfSec(sec, nb) {
  return (sec.pgIds || []).map(id => nb.pages.find(p => p.id === id)).filter(Boolean);
}

function findSecForPage(pgId, nb) {
  return (nb.sections || []).find(s => (s.pgIds || []).includes(pgId));
}

/* ══════════════════════════════════════════════════════════════════════
   SEITEN ZWISCHEN HEFTEN BEWEGEN

   Reine Arbeit am Datenmodell: keine Oberfläche, keine Cloud, keine
   Freigabe. Was danach damit geschieht – Datei sichern, in den Raum
   melden –, erledigt ein einziges AutoSave.markDirty() je betroffenem
   Heft (core/autoSave.js).
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Tiefe Kopie einer Seite mit NEUEN Kennungen.
 *
 * >>> Warum die Kennungen zwingend neu sein müssen <<<
 * Sie sind nicht bloß Namen, sondern Schlüssel:
 *
 *   · getPage() sucht über ALLE offenen Hefte und nimmt den ersten
 *     Treffer. Zwei Hefte mit derselben Seitenkennung greifen sich
 *     gegenseitig ins Steuer.
 *   · In Firestore heißen die Bild-Ablagen `obj_<seite>_<objekt>` und
 *     `bg_<seite>`, die Handschrift-Bögen `<seite>__<nr>`
 *     (core/share.js). Gleiche Kennung heißt: sie überschreiben einander.
 *   · Der Empfänger im Raum verwirft eine Seite, deren Kennung er schon
 *     kennt, STILLSCHWEIGEND (ui/collab.js, applyPageAdd).
 *
 * Deshalb bekommt auch jedes Objekt auf der Seite eine neue Kennung.
 * Die Bilddaten selbst stehen als data:-URL mitten in der Seite, ein
 * JSON-Umweg kopiert sie also vollständig mit.
 */
function clonePage(page) {
  const copy = JSON.parse(JSON.stringify(page));
  copy.id = uid();
  copy.date = new Date().toISOString();
  copy.objects = (copy.objects || []).map(obj => ({ ...obj, id: uid() }));
  return copy;
}

/**
 * Eine Seite in ein Heft einsetzen – in die Seitenliste UND in einen
 * Abschnitt. Beides gehört zusammen: eine Seite, die nur in pgIds steht,
 * gibt es nicht wirklich, und eine, die nur in pages steht, taucht
 * nirgends auf.
 *
 * @param {number} [index] Stelle im Abschnitt; ohne Angabe ans Ende.
 */
function insertPageInto(nb, sec, page, index) {
  if (!nb || !sec || !page) return null;
  nb.pages.push(page);
  const at = Number.isInteger(index) ? index : (sec.pgIds || []).length;
  sec.pgIds = [...(sec.pgIds || [])];
  sec.pgIds.splice(at, 0, page.id);
  return page;
}

/**
 * Seiten von einem Heft in ein anderes bewegen.
 *
 * @param {object} fromNb   Ausgangsheft
 * @param {string[]} pageIds Welche Seiten (Reihenfolge des Hefts gewinnt)
 * @param {object} toNb     Zielheft
 * @param {object} [options]
 * @param {boolean} [options.copy] true = kopieren, sonst verschieben
 * @returns {{moved: number, pages: object[]}}
 *
 * >>> Was hier NICHT passieren darf <<<
 * nb.pages wird ausschließlich ERGÄNZT, nie ersetzt. Beim Sichern eines
 * freigegebenen Hefts löscht saveDocumentContent in Firestore jede Seite,
 * die im Vergleichsstand steht und im neuen Stand fehlt – samt
 * Handschrift und Bildern. Ein Ablauf, der die Liste neu zusammensetzt,
 * löschte damit die Arbeit der anderen.
 */
function transferPages(fromNb, pageIds, toNb, options = {}) {
  const result = { moved: 0, pages: [] };
  if (!fromNb || !toNb || !pageIds?.length) return result;
  if (fromNb === toNb) return result;

  const copy = !!options.copy;
  getSections(fromNb);
  const toSec = getSections(toNb).find(s => s.id === toNb.activeSecId)
    || getSections(toNb)[0];
  if (!toSec) return result;

  /* In der Reihenfolge des Ausgangshefts, nicht in der des Anklickens –
     sonst stünden die Seiten im Ziel durcheinander. */
  const wanted = new Set(pageIds.map(String));
  const ordered = (fromNb.pages || []).filter(p => wanted.has(String(p.id)));

  for (const page of ordered) {
    const fromSec = findSecForPage(page.id, fromNb);

    if (copy) {
      insertPageInto(toNb, toSec, clonePage(page));
    } else {
      // Beim Verschieben behält die Seite ihre Kennung: sie gibt es
      // hinterher nur noch einmal, also kann nichts kollidieren.
      if (fromSec) fromSec.pgIds = (fromSec.pgIds || []).filter(id => id !== page.id);
      fromNb.pages = (fromNb.pages || []).filter(p => p.id !== page.id);
      if (S.strokeHistory) delete S.strokeHistory[page.id];
      insertPageInto(toNb, toSec, page);
    }

    result.moved++;
    result.pages.push(page);
  }

  /* Ein Heft ohne Seiten gibt es nicht – dieselbe Regel wie beim Löschen
     einer Seite (ui/sidebar.js). Betrifft nur das Verschieben. */
  if (!copy) {
    for (const sec of getSections(fromNb)) {
      if ((sec.pgIds || []).length) continue;
      insertPageInto(fromNb, sec, makePage(sec.defaultBg || fromNb.defaultBg || 'ruled'));
    }
    if (!(fromNb.pages || []).length) {
      const sec = getSections(fromNb)[0];
      insertPageInto(fromNb, sec, makePage(fromNb.defaultBg || 'ruled'));
    }
  }

  return result;
}
