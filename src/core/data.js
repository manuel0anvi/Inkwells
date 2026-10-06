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

/* ══════════════════════════════════════════════════════════════════════
   EIN HEFT AUS EINEM ANDEREN KONTO

   Ein Heft, das in einer Cloud liegt, gehört zu dem Konto, in dem es
   liegt. Wer sich mit einer anderen Adresse anmeldete, sah bisher
   trotzdem die Hefte der vorigen: die Dateien liegen ja weiter auf der
   Platte, und die Übersicht kommt aus der örtlichen Merkliste. Genau so
   wurde es gemeldet.

   Ausgeblendet, nicht gelöscht: auf der Platte und im alten Konto bleibt
   alles stehen, und mit der Anmeldung von vorhin sind sie wieder da. Wer
   gar nicht angemeldet ist, sieht ebenfalls alles – ohne Konto gibt es
   kein fremdes. Ein Heft, das nie hochgeladen wurde, trägt gar kein
   Konto und bleibt immer.

   Dieselbe Frage hält auch das Hochladen an (core/cloudSync.js): sonst
   wanderten die Hefte des einen Kontos beim nächsten Abgleich in die
   Cloud des anderen.
   ══════════════════════════════════════════════════════════════════════ */
function fremdesKonto(nb) {
  if (!nb || !nb.cloudKonto) return false;
  const cs = (typeof CloudSync_ !== 'undefined') ? CloudSync_ : null;
  const jetzt = (cs && typeof cs.kontoSchluessel === 'function') ? cs.kontoSchluessel() : '';
  if (!jetzt) return false;
  return nb.cloudKonto !== jetzt;
}

/** Nur die eigenen Hefte – das, was auf der Startseite steht. */
function ownNotebooks() {
  return S.notebooks.filter(nb => nb.origin !== 'shared' && !fremdesKonto(nb));
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
  if (p.bgImg || p.pdfRef || p.inkStrokes?.length || p.objects?.length) return false;
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
/* ══════════════════════════════════════════════════════════════════════
   EIN STRICH BRAUCHT KEINE FÜNFZEHN NACHKOMMASTELLEN

   >>> Gemeldet: „17 Seiten mit dem Stift, dazu zwei, drei Bilder – und
   die Datei hat 13 MB" <<<
   Nachgemessen an genau so einem Heft: 12,7 der 14,1 MB waren Striche,
   die Bilder nur 1,4. Ein einziger Punkt kostete rund 65 Zeichen:

       {"x":71.72225584593518,"y":92.77777522005222,"p":0.046875}

   Drei Dinge daran sind Ballast:
     · die STELLEN. Der Stift liefert Bildschirmpunkte, geteilt durch den
       Zoom – daher die langen Brueche. Auf ein Hundertstel eines
       Seitenpunkts gerundet ist die Abweichung selbst bei 400 % noch
       ein Zwanzigstel eines Bildpunkts. Das sieht niemand.
     · der DRUCK `p` – jedenfalls dort, wo er nichts sagt. Bei Maus und
       Finger steht er überall auf demselben Wert, und gleichbleibender
       Druck zeichnet genauso wie gar keiner. Ändert er sich aber, macht
       er den Strich dicker und dünner (core/inkSvg.js, StrichForm) und
       bleibt – auf zwei Stellen gerundet, mehr unterscheidet kein Auge.
     · die HILFSFELDER mit Unterstrich (`_lineTimer`, `_vorschauKasten`,
       `_lineLocked` …). Sie gehoeren dem laufenden Strich in
       canvas/input.js und hatten auf der Platte nie etwas verloren.

   Die Form bleibt dieselbe – `path` ist weiterhin eine Liste aus {x, y},
   bei Strichen mit Druck {x, y, p}. Ein aelterer Stand der App liest das
   ohne jede Aenderung; er zeichnet den Strich nur gleich breit.

   Verdichtet wird an drei Stellen: am fertigen Strich (canvas/input.js),
   beim Laden (normalizeNotebook, unten) und vor dem Speichern
   (core/fileManager.js) – dort fuer alles, was sich seither bewegt hat:
   verschobene, vergroesserte, von anderen empfangene Striche.
   ══════════════════════════════════════════════════════════════════════ */
const STRICH_RASTER = 100;   // 1/100 Seitenpunkt

function strichRund(v) {
  return Math.round(v * STRICH_RASTER) / STRICH_RASTER;
}

/* Dieselbe Regel wie StrichForm.hatDruck in core/inkSvg.js – hier noch
   einmal, weil die Prüfungen data.js ohne die Zeichnerei laden. Ändert
   sich die eine, muss die andere mit: sonst zeichnet die App einen Druck,
   den sie beim Speichern wegwirft, oder speichert einen, den sie nicht
   zeichnet. */
const STRICH_DRUCK_SPANNE = 0.05;

function strichHatDruck(s) {
  if (!s || s.isHL || s.isHighlighter || s.isEraser || s.isGeometric) return false;
  const pts = s.path;
  if (!Array.isArray(pts) || pts.length < 2) return false;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    if (!p || !Number.isFinite(p.p)) continue;
    if (p.p < lo) lo = p.p;
    if (p.p > hi) hi = p.p;
  }
  return hi - lo > STRICH_DRUCK_SPANNE;
}

/** Braucht dieser Strich die Kur? Liest nur, schreibt nichts. */
function strichUnverdichtet(s) {
  if (!s || typeof s !== 'object') return false;
  for (const k in s) if (k.charCodeAt(0) === 95 /* _ */) return true;
  const pts = s.path;
  if (!Array.isArray(pts)) return false;
  const druck = strichHatDruck(s);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p || strichRund(p.x) !== p.x || strichRund(p.y) !== p.y) return true;
    if (druck ? (!Number.isFinite(p.p) || strichRund(p.p) !== p.p) : p.p !== undefined) return true;
  }
  return false;
}

/**
 * Einen Strich verdichten – an Ort und Stelle, derselbe Gegenstand bleibt.
 *
 * Die ANZAHL der Punkte bleibt, auch wo zwei hintereinander nach dem
 * Runden gleich sind: die Live-Bearbeitung erkennt eine geaenderte Seite
 * unter anderem an ihr (ui/collab.js, inkSig), und der Gewinn waere
 * winzig – gemessen 62 von knapp 200 000 Punkten.
 */
function strichVerdichten(s) {
  if (!strichUnverdichtet(s)) return s;
  for (const k of Object.keys(s)) if (k.charCodeAt(0) === 95) delete s[k];
  if (Array.isArray(s.path)) {
    const druck = strichHatDruck(s);
    s.path = s.path.filter(Boolean).map(p => {
      const q = { x: strichRund(Number(p.x) || 0), y: strichRund(Number(p.y) || 0) };
      // Ein Punkt ohne Wert mitten in einem Strich mit Druck: der Platzhalter
      if (druck) q.p = strichRund(Number.isFinite(p.p) ? p.p : 0.35);
      return q;
    });
  }
  return s;
}

/* ══════════════════════════════════════════════════════════════════════
   DER RADIERER ZERSCHNEIDET – DIE GEOMETRIE

   Gebraucht vom Radierer selbst (canvas/input.js, radiereBei) und beim
   Laden alter Hefte (radierstricheEinrechnen, unten). Steht deshalb hier
   und nicht beim Zeichnen: data.js ist vor allem anderen geladen, und
   die Prüfungen laufen ohne Canvas.
   ══════════════════════════════════════════════════════════════════════ */

/** Quadrat des Abstands von (x,y) zur Radierstrecke a–b. */
function radierAbstand2(x, y, a, b) {
  // Hier nicht pointToLineDistance: das steht erst in canvas/input.js
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  const ex = x - (a.x + t * dx), ey = y - (a.y + t * dy);
  return ex * ex + ey * ey;
}

/**
 * Welcher Teil der Strecke p–q liegt näher als R an der Radierstrecke a–b?
 *
 * Der Abstand zu einer Strecke ist entlang einer anderen Strecke eine
 * konvexe Grösse – der getroffene Teil ist also immer EIN Stück. Gesucht
 * wird erst die engste Stelle, dann von dort aus beide Ränder.
 *
 * @returns {[number, number]|null} Anfang und Ende als Anteil 0…1
 */
function radierIntervall(p, q, a, b, R) {
  const R2 = R * R;
  const f = t => radierAbstand2(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, a, b);
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (f(m1) < f(m2)) hi = m2; else lo = m1;
  }
  const tm = (lo + hi) / 2;
  if (f(tm) >= R2) return null;
  const rand = (aussen, innen) => {
    for (let i = 0; i < 40; i++) {
      const m = (aussen + innen) / 2;
      if (f(m) < R2) innen = m; else aussen = m;
    }
    /* Die Seite AUSSERHALB des Kreises. Mit der inneren lag die neue
       Schnittkante um einen Hauch im Kreis, und das nächste Stück des
       Radierwegs traf sie gleich noch einmal – jedes Mal ein Punkt weg. */
    return aussen;
  };
  return [f(0) < R2 ? 0 : rand(0, tm), f(1) < R2 ? 1 : rand(1, tm)];
}

function wegStrecke(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

/**
 * Zerschneidet einen Linienzug an der Radierstrecke a–b mit Radius R.
 *
 * @returns {Array<Array<{x,y}>>|null}  die Reste – oder null, wenn er gar
 *   nicht getroffen wurde (dann bleibt der Strich, wie er ist)
 */
function zerschneide(pts, a, b, R) {
  const R2 = R * R;
  const drin = p => radierAbstand2(p.x, p.y, a, b) < R2;
  if (pts.length === 1) return drin(pts[0]) ? [] : null;

  // Weit weg? Dann nicht erst rechnen – die meisten Striche sind es
  const minX = Math.min(a.x, b.x) - R, maxX = Math.max(a.x, b.x) + R;
  const minY = Math.min(a.y, b.y) - R, maxY = Math.max(a.y, b.y) + R;
  const zwischen = (p, q, t) => {
    const z = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    // Die Schnittkante bekommt den Druck, der dort war – sonst verdickte sie sich
    if (Number.isFinite(p.p) && Number.isFinite(q.p)) z.p = p.p + (q.p - p.p) * t;
    return z;
  };

  let getroffen = false;
  const teile = [];
  let cur;
  if (drin(pts[0])) { getroffen = true; cur = []; } else cur = [pts[0]];

  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const weit = Math.max(p.x, q.x) < minX || Math.min(p.x, q.x) > maxX
      || Math.max(p.y, q.y) < minY || Math.min(p.y, q.y) > maxY;
    const iv = weit ? null : radierIntervall(p, q, a, b, R);
    if (!iv) { cur.push(q); continue; }
    getroffen = true;
    if (iv[0] > 0) cur.push(zwischen(p, q, iv[0]));
    if (cur.length >= 2) teile.push(cur);
    cur = iv[1] < 1 ? [zwischen(p, q, iv[1]), q] : [];
  }
  if (cur.length >= 2) teile.push(cur);
  if (!getroffen) return null;
  // Ein Rest von weniger als einem halben Punkt wäre nur noch ein Klecks
  return teile.filter(t => wegStrecke(t) >= 0.5);
}

/* ══════════════════════════════════════════════════════════════════════
   ALTE RADIERSTRICHE WERDEN EINGERECHNET

   >>> Gemeldet: „der Löscher zeichnet selber etwas – schiebt man etwas
   Gezeichnetes auf die gelöschte Fläche, sieht es gelöscht aus" <<<
   Bis zum 28. 9. radierte die App mit einem eigenen Strich, der Bildpunkte
   wegnahm (destination-out) und in der Seite liegen blieb – unsichtbar,
   aber wirksam auf alles, was in der Liste vor ihm stand. Seither
   zerschneidet der Radierer die Striche selbst (canvas/input.js). Die
   alten Radierstriche lagen aber weiter in den Heften: nachgezählt 232
   in einem einzigen Matheheft. Jeder davon stanzte ein Loch in alles,
   was man später darüberschob.

   Hier wird jeder von ihnen so angewandt, wie der heutige Radierer es
   täte: die Striche VOR ihm werden an seinem Weg zerschnitten, danach
   fällt er weg. Was zu sehen war, bleibt zu sehen; was weg war, ist
   jetzt wirklich weg.

   >>> Was anders ist als beim Radieren von Hand <<<
   Eine echte Linie (zwei Punkte) geht beim Radieren ganz weg. Hier
   nicht: das alte Loch nahm nur ein Stück heraus, und so soll es auch
   nach dem Einrechnen aussehen.

   Schnell genug für Tausende Striche: geschnitten wird nur, wessen
   Kasten den Weg des Radierers überhaupt berührt.
   ══════════════════════════════════════════════════════════════════════ */
function strichKastenVon(pts) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) {
    if (p.x < x1) x1 = p.x;
    if (p.x > x2) x2 = p.x;
    if (p.y < y1) y1 = p.y;
    if (p.y > y2) y2 = p.y;
  }
  return { x1, y1, x2, y2 };
}

/* Die Kennung eines Reststücks ergibt sich aus dem Strich, dem Radierer
   und der Reihenfolge – nicht aus dem Zufall. Dasselbe Heft wird auf zwei
   Geräten, aus der Datei und aus der Cloud, unabhängig eingerechnet; mit
   zufälligen Kennungen sähe jeder Abgleich lauter neue Striche und legte
   sie doppelt hin. */
function radierKennung(strich, stelle, radierer, n) {
  return (strich.id || ('s' + stelle)) + '~' + radierer + '.' + n;
}

/**
 * @param {Array} liste  die Striche einer Seite, in Zeichenreihenfolge
 * @returns {Array|null} die neue Liste – oder null, wenn kein Radierstrich darin war
 */
function radierstricheEinrechnen(liste) {
  if (!Array.isArray(liste) || !liste.some(s => s && s.isEraser)) return null;
  const okPunkt = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  let aus = [];
  for (let ri = 0; ri < liste.length; ri++) {
    const radierer = liste[ri];
    if (!radierer) continue;
    if (!radierer.isEraser) { aus.push(radierer); continue; }

    const rp = (Array.isArray(radierer.path) ? radierer.path : []).filter(okPunkt);
    if (!rp.length) continue;
    const r = (Number(radierer.width) > 0 ? Number(radierer.width) : 16) / 2;
    const strecken = rp.length === 1 ? [[rp[0], rp[0]]] : rp.slice(1).map((q, i) => [rp[i], q]);
    const rk = strichKastenVon(rp);

    const neu = [];
    for (let si = 0; si < aus.length; si++) {
      const s = aus[si];
      const pts = Array.isArray(s.path) ? s.path.filter(okPunkt) : [];
      if (!pts.length) { neu.push(s); continue; }
      // Bis an den Kreis heran, wie beim Radieren von Hand (radiereBei)
      const R = r + (Number(s.width) > 0 ? Number(s.width) : 2) / 2;
      const sk = strichKastenVon(pts);
      if (sk.x1 > rk.x2 + R || sk.x2 < rk.x1 - R || sk.y1 > rk.y2 + R || sk.y2 < rk.y1 - R) {
        neu.push(s);
        continue;
      }

      let stuecke = [pts];
      let getroffen = false;
      for (const [a, b] of strecken) {
        if (Math.min(a.x, b.x) - R > sk.x2 || Math.max(a.x, b.x) + R < sk.x1
          || Math.min(a.y, b.y) - R > sk.y2 || Math.max(a.y, b.y) + R < sk.y1) continue;
        const weiter = [];
        for (const st of stuecke) {
          const teile = zerschneide(st, a, b, R);
          if (!teile) { weiter.push(st); continue; }
          getroffen = true;
          for (const t of teile) weiter.push(t);
        }
        stuecke = weiter;
        if (!stuecke.length) break;
      }
      if (!getroffen) { neu.push(s); continue; }
      stuecke.forEach((t, n) => neu.push({ ...s, id: radierKennung(s, si, ri, n), path: t }));
    }
    aus = neu;
  }
  return aus;
}

/** Alle Striche eines Hefts, wie sie gespeichert werden (page.inkStrokes). */
function stricheVerdichten(nb) {
  for (const page of ((nb && nb.pages) || [])) {
    const liste = page && page.inkStrokes;
    if (!Array.isArray(liste)) continue;
    for (const s of liste) strichVerdichten(s);
  }
  return nb;
}

function normalizeNotebook(nb) {
  if (!nb || !Array.isArray(nb.pages)) return nb;

  // Alte Radierstriche verschwinden, die Löcher bleiben (siehe oben)
  for (const page of nb.pages) {
    const neu = page && radierstricheEinrechnen(page.inkStrokes);
    if (neu) page.inkStrokes = neu;
  }

  // Alte Hefte werden beim ersten Laden kleiner (siehe oben)
  stricheVerdichten(nb);

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

  if (next && !page.bgImg && !page.pdfRef) {
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

  /* ══════════════════════════════════════════════════════════════════
     DIE PDF-DATEI MUSS MIT

     Seit dem zerlegten PDF-Modell liegt die Datei EINMAL im Heft
     (nb.pdfs[kennung]); die Seite trägt nur einen Verweis darauf
     (page.pdfRef). Hier wanderte aber nur die Seite. Im Zielheft zeigte
     ihr Verweis damit auf eine Datei, die es dort gar nicht gibt: die
     Vorlage fehlte, übrig blieb allenfalls die unsichtbare Textebene.

     Beim VERSCHIEBEN war es schlimmer. Hatte die letzte Seite eines PDFs
     das Ausgangsheft verlassen, zeigte dort niemand mehr darauf – und der
     nächste ganz gewöhnliche Speichervorgang räumte die Datei über
     PdfSeiten.raeumeAuf() weg. Danach hatte sie keines von beiden Heften
     mehr.

     PdfSeiten.lege() vergleicht den INHALT: dieselbe Datei zweimal
     einzufügen legt sie nicht zweimal ab, und eine Kennung, die im Ziel
     schon anders belegt ist, bekommt dabei von selbst eine neue.
     ══════════════════════════════════════════════════════════════════ */
  const nimmPdfMit = (seite) => {
    if (!seite || !seite.pdfRef || !seite.pdfRef.datei) return;
    if (typeof PdfSeiten === 'undefined' || !PdfSeiten) return;

    const quelle = (fromNb.pdfs || {})[seite.pdfRef.datei];
    if (!quelle || !quelle.daten) return;

    const neueKennung = PdfSeiten.lege(toNb, quelle.daten, quelle.name);
    if (neueKennung) seite.pdfRef = { ...seite.pdfRef, datei: neueKennung };
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
      nimmPdfMit(kopie);
      insertPageInto(toNb, sec, kopie);
    } else {
      // Beim Verschieben behält die Seite ihre Kennung: sie gibt es
      // hinterher nur noch einmal, also kann nichts kollidieren.
      fromNb.pages = (fromNb.pages || []).filter(p => p.id !== page.id);
      if (S.strokeHistory) delete S.strokeHistory[page.id];
      delete page.secId;                    // das Etikett des alten Hefts gilt hier nicht
      nimmPdfMit(page);
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
