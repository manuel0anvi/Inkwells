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

/* Abschnitte sind Etiketten – ein Heft braucht keine.

   Früher wurde hier bei fehlenden Abschnitten einer namens „Allgemein"
   angelegt, der ALLE Seiten enthielt. Das war nötig, solange die Anzeige
   an pgIds hing: ohne Abschnitt hätte man gar nichts gesehen. Heute zeigt
   „alle Seiten" ohnehin alles, und ein Zwangsetikett auf jeder Seite wäre
   nur im Weg. Angelegt wird deshalb nichts mehr. */
function getSections(nb) {
  if (!Array.isArray(nb.sections)) nb.sections = [];
  /* sec.defaultBg wird NICHT mehr vorsorglich gefuellt. Leer heisst jetzt
     „nimm den Standard des Hefts" – und das ist der Normalfall. Vorher
     stand hier eine Kopie von nb.defaultBg, und die blieb stehen, wenn
     man spaeter das Papier des Hefts wechselte. */
  return nb.sections;
}

/** Das Papier eines Abschnitts – seines, sonst das des Hefts. */
function bgForSection(sec, nb) {
  return sec?.defaultBg || nb?.defaultBg || 'ruled';
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

  /* Umgestelltes Heft: nb.pages IST die Reihenfolge. Hier noch einmal über
     die Abschnitte zu gehen wäre sogar falsch – die pgIds sind dort nur
     abgeleitet und würden die Seiten wieder nach Abschnitten gruppieren. */
  if (nb.schemaVersion === SCHEMA_VERSION) return nb.pages;

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

/* ══════════════════════════════════════════════════════════════════════
   ABSCHNITTE SIND ETIKETTEN, KEINE KAPITEL

   Früher bestimmte sec.pgIds beides: WELCHE Seiten zu einem Abschnitt
   gehören und in welcher REIHENFOLGE sie stehen. Man sah immer nur einen
   Abschnitt, und ein Wechsel zeigte einen ganz anderen Satz Seiten.

   Jetzt ist ein Heft eine durchgehende Folge (nb.pages), und ein
   Abschnitt nur noch ein Ausschnitt daraus (page.secId). Im Mathe-Heft
   trägt man Regelseiten als „Regeln" ein und Übungsseiten als „Übungen",
   ohne dass sich die Reihenfolge ändert – und die Seitenzahlen bleiben,
   wie sie sind, auch wenn nur ein Ausschnitt gezeigt wird.

   >>> pgIds wird trotzdem weiter mitgeschrieben <<<
   Abgeleitet, nicht als Wahrheit. Ein Stand ohne diesen Umbau hielte
   einen Abschnitt ohne pgIds für leer und legte ungefragt Füllseiten an –
   das wäre echte Datenverschmutzung, nicht bloß ein Anzeigefehler. Solange
   zwei Leute mit verschiedenen Ständen arbeiten, bleibt das Feld also
   gefüllt. Siehe syncSectionIds().
   ══════════════════════════════════════════════════════════════════════ */

const SCHEMA_VERSION = 2;

/**
 * Bringt ein Heft auf den heutigen Aufbau. Läuft an jedem Eingang, durch
 * den ein Heft in den Zustand gelangt (core/init.js, core/cloudSync.js),
 * und ist mehrfach anwendbar.
 *
 * Verlustfrei: die neue Reihenfolge ist genau die, die man vorher beim
 * Durchblättern gesehen hätte – erst Abschnitt für Abschnitt, dann was in
 * keinem stand.
 */
function normalizeNotebook(nb) {
  if (!nb || !Array.isArray(nb.pages)) return nb;

  /* Auch ein schon umgestelltes Heft kommt hier noch einmal durch: der
     Zwangsabschnitt wurde erst später abgeschafft, und Hefte, die die
     Umstellung davor mitgemacht haben, schleppen ihn sonst ewig mit. */
  if (nb.schemaVersion === SCHEMA_VERSION) {
    dropCatchAllSection(nb);
    syncSectionIds(nb);
    return nb;
  }

  // 1. Die angezeigte Reihenfolge wird die wirkliche
  nb.pages = notebookPages(nb);

  // 2. Jede Seite bekommt ihr Etikett
  for (const sec of (nb.sections || [])) {
    for (const pgId of (sec.pgIds || [])) {
      const page = nb.pages.find(p => String(p.id) === String(pgId));
      if (page && !page.secId) page.secId = sec.id;
    }
  }

  dropCatchAllSection(nb);

  nb.schemaVersion = SCHEMA_VERSION;
  syncSectionIds(nb);
  return nb;
}

/* Der Zwangsabschnitt „Allgemein" verschwindet.

   Solange die Anzeige an pgIds hing, brauchte jedes Heft mindestens einen
   Abschnitt – sonst hätte man gar nichts gesehen. getSections() legte
   deshalb ungefragt einen namens „Allgemein" an, der ALLE Seiten enthielt.
   Als Etikett ist er sinnlos: er sagt nichts aus, klebt aber auf jeder
   Seite und steht in der Navigation als Auswahl, die genau dasselbe zeigt
   wie „Alle Seiten".

   Weg damit – aber nur, wenn er wirklich der angelegte sein kann: der
   EINZIGE Abschnitt und einer der drei erzeugten Namen. Wer daneben noch
   andere Abschnitte hat, hat offenbar selbst geordnet; dann bleibt auch
   ein „Allgemein" stehen. Ein Heft mit genau einem selbst so genannten
   Abschnitt verliert das Etikett – die Seiten bleiben unberührt, nur die
   Zuordnung geht verloren, und das ist der Preis dafür, den Zwangs-
   abschnitt bei allen anderen loszuwerden. */
const AUTO_SEC_NAMES = ['Allgemein', 'General', 'Generale'];

function dropCatchAllSection(nb) {
  if (!Array.isArray(nb.sections) || nb.sections.length !== 1) return;
  const sec = nb.sections[0];
  if (!AUTO_SEC_NAMES.includes(sec.name)) return;

  for (const page of nb.pages) delete page.secId;
  nb.sections = [];
  if (String(nb.activeSecId || '') === String(sec.id)) nb.activeSecId = '';
}

/**
 * Schreibt die abgeleiteten pgIds neu – nach jeder Änderung an der
 * Reihenfolge oder an den Etiketten aufzurufen.
 *
 * Sie sind ab jetzt nur noch ein Abfallprodukt für ältere Stände; gelesen
 * wird die Zugehörigkeit aus page.secId.
 */
function syncSectionIds(nb) {
  if (!nb || !Array.isArray(nb.sections)) return;
  const order = nb.pages || [];
  for (const sec of nb.sections) {
    sec.pgIds = order.filter(p => String(p.secId || '') === String(sec.id)).map(p => p.id);
  }
}

/**
 * Der gerade gezeigte Ausschnitt – null heißt „alle Seiten".
 *
 * nb.activeSecId hat damit eine neue Bedeutung: früher „welcher Abschnitt
 * ist offen", heute „worauf ist die Ansicht eingeschränkt". Leer ist der
 * Normalfall, nicht die Ausnahme.
 */
function activeSection(nb) {
  if (!nb || !nb.activeSecId) return null;
  return (nb.sections || []).find(s => String(s.id) === String(nb.activeSecId)) || null;
}

/** Die Seiten, die gerade zu sehen sind – gefiltert oder alle. */
function visiblePages(nb) {
  const sec = activeSection(nb);
  return sec ? pagesOfSec(sec, nb) : notebookPages(nb);
}

/** Die Seiten eines Abschnitts – ein Ausschnitt aus der Heft-Reihenfolge. */
function pagesOfSec(sec, nb) {
  if (!sec) return [];
  return notebookPages(nb).filter(p => String(p.secId || '') === String(sec.id));
}

function findSecForPage(pgId, nb) {
  const page = (nb?.pages || []).find(p => String(p.id) === String(pgId));
  if (!page || !page.secId) return null;
  return (nb.sections || []).find(s => String(s.id) === String(page.secId)) || null;
}

/**
 * Setzt das Etikett einer Seite – oder nimmt es weg (secId leer).
 * Die Position im Heft bleibt dabei unangetastet; genau darum geht es.
 *
 * >>> Das Papier zieht mit <<<
 * Wer eine Seite einem Abschnitt zuschlaegt, will sie so aussehen lassen
 * wie den Rest davon. Sie bekommt deshalb sofort dessen Papier – und ohne
 * eigene Wahl des Abschnitts eben das des Hefts. Aendern laesst es sich
 * danach weiterhin je Seite (Rechtsklick auf die Seite).
 */
function setSectionOfPage(nb, pgId, secId) {
  const page = (nb?.pages || []).find(p => String(p.id) === String(pgId));
  if (!page) return false;
  const next = secId ? String(secId) : '';
  if (String(page.secId || '') === next) return false;
  if (next) page.secId = next; else delete page.secId;

  if (next && !page.bgImg) {
    const sec = (nb.sections || []).find(s => String(s.id) === next);
    if (sec) page.bg = bgForSection(sec, nb);
  }

  syncSectionIds(nb);
  return true;
}

/* Die Farbe eines Abschnitts – gewählt, sonst gerechnet.

   Wer keine aussucht, bekommt eine aus der Kennung: so haben zwei frisch
   angelegte Abschnitte von selbst verschiedene Farben, ohne dass jemand
   etwas tun muss. Sobald sec.color gesetzt ist, gilt die.

   >>> Was am Speichern zu beachten war <<<
   applyStruct() in ui/collab.js baut eingehende Abschnitte FELDWEISE neu
   auf. Ein Feld, das dort nicht aufgezählt ist, verschwindet bei jedem
   Struktur-Abgleich eines geteilten Hefts stillschweigend – genau deshalb
   war die Farbe zuerst nur gerechnet. Sie steht jetzt in beiden Listen:
   applyStruct und splitNotebook (core/share.js).

   Gleiches Verfahren wie colorForUid in core/share.js. */
function colorForSection(sec) {
  // Vertraegt beides: den Abschnitt oder bloss seine Kennung
  const gewaehlt = (sec && typeof sec === 'object') ? sec.color : null;
  if (gewaehlt) return gewaehlt;

  const palette = sectionPalette();
  let hash = 0;
  const key = String((sec && typeof sec === 'object') ? sec.id : (sec || ''));
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/**
 * Eine Seite an eine andere Stelle im Heft setzen.
 *
 * @param {object} nb
 * @param {string} pgId        die Seite, die wandert
 * @param {string|null} vorId  sie landet VOR dieser Seite; null = ans Ende
 * @returns {boolean} ob sich etwas geändert hat
 *
 * >>> Warum „vor dieser Seite" und keine Zahl <<<
 * Gezogen wird in der Abschnittsverwaltung, und die zeigt womöglich nur
 * einen Ausschnitt. Eine Zahl aus dieser Liste wäre im Heft die falsche.
 * Ein Nachbar dagegen ist eindeutig: er steht im Heft an genau einer
 * Stelle, gleich welcher Filter gerade wirkt.
 */
function movePageBefore(nb, pgId, vorId) {
  const pages = nb?.pages;
  if (!Array.isArray(pages)) return false;

  const von = pages.findIndex(p => String(p.id) === String(pgId));
  if (von < 0) return false;

  let nach = (vorId === null || vorId === undefined)
    ? pages.length
    : pages.findIndex(p => String(p.id) === String(vorId));
  if (nach < 0) nach = pages.length;

  // Sie liegt schon dort – auch „vor dem eigenen Nachfolger" heißt das
  if (nach === von || nach === von + 1) return false;

  const [page] = pages.splice(von, 1);
  // Nach dem Herausnehmen ist alles dahinter um eins gerückt
  if (nach > von) nach--;
  pages.splice(nach, 0, page);

  syncSectionIds(nb);
  return true;
}

/** Die Farben, die zur Auswahl stehen – dieselben wie bei den Heften. */
function sectionPalette() {
  return (typeof NB_COLORS !== 'undefined' && NB_COLORS.length)
    ? NB_COLORS
    : ['#c04040', '#c87a2a', '#2e8a46', '#2a5fa8', '#7a3aaa', '#8a5030', '#2a8a88', '#606060'];
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
 * Eine Seite in ein Heft einsetzen.
 *
 * @param {object} nb
 * @param {object|null} sec  Abschnitt, dessen Etikett die Seite bekommt
 *                           (null = ohne Zuordnung)
 * @param {object} page
 * @param {number} [index]   Stelle im HEFT; ohne Angabe ans Ende.
 *
 * >>> Der Index zählt jetzt im Heft, nicht im Abschnitt <<<
 * Solange Abschnitte Kapitel waren, hieß „an Stelle 3" die dritte Seite
 * DIESES Abschnitts. Unter Etiketten gibt es das nicht mehr – eine Seite
 * hat genau einen Platz, und der gilt im ganzen Heft.
 */
function insertPageInto(nb, sec, page, index) {
  if (!nb || !page) return null;
  if (sec) page.secId = sec.id;

  const at = Number.isInteger(index)
    ? Math.max(0, Math.min(index, nb.pages.length))
    : nb.pages.length;
  nb.pages.splice(at, 0, page);

  syncSectionIds(nb);
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
 * @param {boolean} [options.keepSection] Etikett mitnehmen; fehlt der
 *   Abschnitt im Ziel, wird er dort angelegt
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
  getSections(toNb);

  /* Das Etikett im Ziel: der gerade gezeigte Ausschnitt, sonst keins.
     Steht die Ansicht auf „alle Seiten", bekommt die Seite bewusst gar
     kein Etikett – ihr eines aufzudrängen wäre geraten. */
  const toSec = (toNb.sections || []).find(s => s.id === toNb.activeSecId) || null;

  /* ── Das Etikett mitnehmen ────────────────────────────────────────
     Verglichen wird über den NAMEN, nicht über die Kennung: die ist je
     Heft vergeben, dieselbe „Übungen" haben in zwei Heften zwangsläufig
     verschiedene.

     >>> Warum die Farbe festgeschrieben wird <<<
     Ohne eigene Wahl rechnet colorForSection() sie aus der Kennung. Der
     neue Abschnitt bekommt aber eine neue Kennung – und damit eine
     andere Farbe. Wer seine Seiten samt Abschnitt hinüberschiebt, will
     sie dort wiedererkennen; also wird die bisherige Farbe hier
     ausgerechnet und festgehalten. */
  const keepSec = !!options.keepSection;
  const gemerkt = new Map();               // Name → Abschnitt im Ziel

  const zielAbschnitt = (page) => {
    if (!keepSec || !page.secId) return toSec;
    const quelle = (fromNb.sections || []).find(s => String(s.id) === String(page.secId));
    if (!quelle) return toSec;

    const name = String(quelle.name || '');
    if (gemerkt.has(name)) return gemerkt.get(name);

    let ziel = (toNb.sections || []).find(s => String(s.name || '') === name);
    if (!ziel) {
      ziel = {
        id: uid(),
        name: quelle.name,
        pgIds: [],
        defaultBg: quelle.defaultBg || toNb.defaultBg || 'ruled',
        color: colorForSection(quelle)
      };
      toNb.sections.push(ziel);
    }
    gemerkt.set(name, ziel);
    return ziel;
  };

  /* In der Reihenfolge des Ausgangshefts, nicht in der des Anklickens –
     sonst stünden die Seiten im Ziel durcheinander. */
  const wanted = new Set(pageIds.map(String));
  const ordered = notebookPages(fromNb).filter(p => wanted.has(String(p.id)));

  for (const page of ordered) {
    const sec = zielAbschnitt(page);
    if (copy) {
      const kopie = clonePage(page);
      delete kopie.secId;                   // insertPageInto setzt das richtige
      insertPageInto(toNb, sec, kopie);
    } else {
      // Beim Verschieben behält die Seite ihre Kennung: sie gibt es
      // hinterher nur noch einmal, also kann nichts kollidieren.
      fromNb.pages = (fromNb.pages || []).filter(p => p.id !== page.id);
      if (S.strokeHistory) delete S.strokeHistory[page.id];
      delete page.secId;                    // das Etikett des alten Hefts gilt hier nicht
      insertPageInto(toNb, sec, page);
    }

    result.moved++;
    result.pages.push(page);
  }

  /* Ein Heft ohne Seiten gibt es nicht. Die frühere Regel „auch kein
     Abschnitt ohne Seiten" ist mit den Etiketten entfallen – ein Etikett,
     das gerade auf keiner Seite klebt, ist völlig in Ordnung. */
  if (!copy) {
    syncSectionIds(fromNb);
    if (!(fromNb.pages || []).length) {
      insertPageInto(fromNb, null, makePage(fromNb.defaultBg || 'ruled'));
    }
  }

  return result;
}
