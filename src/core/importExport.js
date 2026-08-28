'use strict';

/* ── PDF TO IMAGES Helper ── */
async function parsePdfToImages(pdfDataUrl) {
  const base64 = pdfDataUrl.split(',')[1];
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const images = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    images.push({
      url: canvas.toDataURL('image/jpeg', 0.65),
      w: Math.round(viewport.width / 1.5), // native width (at scale 1.0)
      h: Math.round(viewport.height / 1.5) // native height
    });
  }
  return images;
}

/**
 * Baut aus einem Seitenbild eine Heftseite.
 *
 * Die Rechnung stand zweimal fast gleich da – einmal fuers PDF, einmal
 * fuers Bild. Sie ist nicht offensichtlich: die Breite wird auf das
 * Heftmass gezogen, die Hoehe folgt dem Seitenverhaeltnis, und der Platz
 * des Seitenkopfs kommt obendrauf. Ohne ihn saesse das Bild unter dem
 * Kopf und waere unten abgeschnitten.
 *
 * >>> Warum 56 und nicht CFG.HDR (58) <<<
 * Weil das Bild selbst bei 56 px anfaengt und `calc(100% - 56px)` hoch
 * ist (app.js, beim Aufbau der Seite). CFG.HDR zaehlt die 2 px Trennlinie
 * mit – die richtige Zahl dort, wo es um den freizuhaltenden Kopfbereich
 * geht, hier aber 2 px Luft unter dem Bild. Die beiden Zahlen meinen
 * verschiedene Dinge und duerfen nicht zusammengelegt werden.
 *
 * Papier: immer 'blank'. Ein Linienraster hinter einem fertigen
 * Seitenbild ergibt kein Bild, sondern ein Durcheinander.
 */
const BILD_KOPF_PX = 56;

function makeImagePage(dataUrl, breite, hoehe) {
  const pg = makePage('blank');
  pg.bgImg = dataUrl;
  pg.w = CFG.PAGE_W;
  pg.h = Math.round(CFG.PAGE_W * (hoehe / (breite || 1))) + BILD_KOPF_PX;
  return pg;
}
window.makeImagePage = makeImagePage;

/* ══════════════════════════════════════════════════════════════════════
   EIN BILD AUS DER ZWISCHENABLAGE

   Ein Bildschirmfoto machen und es einsetzen ist der häufigste Weg, wie
   ein Bild in ein Heft kommt – über den Dateiwähler ginge es nur als
   Umweg über eine Datei, die niemand haben will.

   >>> Warum große Bilder verkleinert werden <<<
   Ein Bildschirmfoto von einem 4K-Schirm sind rund 3840×2160 Punkte. Als
   PNG in einer Zeichenkette (data:) wird daraus schnell ein zweistelliger
   Megabyte-Betrag, und der liegt danach in JEDER Kopie des Hefts: in der
   Datei, in der Cloud, in jedem abgelegten Stand und bei jedem, der das
   Dokument geteilt bekommt. Auf einem Blatt von 794 Punkten Breite sieht
   man von der Auflösung nichts.

   Verkleinert wird deshalb auf MAX_KANTE, und zwar nur nach unten – ein
   kleines Bild bleibt, wie es ist. Das Format bleibt PNG, solange es
   dabei unter der Schwelle bleibt; darüber wird JPEG daraus. PNG hält
   Text und Striche scharf (ein Bildschirmfoto besteht meist daraus),
   JPEG rettet den Fall, in dem jemand ein Foto einsetzt.
   ══════════════════════════════════════════════════════════════════════ */

const BILD_MAX_KANTE = 1600;      // längere Seite, in Bildpunkten
const BILD_JPEG_AB = 900 * 1024;  // ab dieser Größe lieber JPEG

/** Lädt eine Bilddatei und gibt sie als data:-Zeichenkette zurück. */
function leseBildDatei(datei) {
  return new Promise((fertig, schief) => {
    const leser = new FileReader();
    leser.onload = () => fertig(String(leser.result || ''));
    leser.onerror = () => schief(new Error('BILD_UNLESBAR'));
    leser.readAsDataURL(datei);
  });
}

/** Wartet, bis ein Bild wirklich Maße hat. */
function ladeBild(dataUrl) {
  return new Promise((fertig, schief) => {
    const bild = new Image();
    bild.onload = () => fertig(bild);
    bild.onerror = () => schief(new Error('BILD_UNLESBAR'));
    bild.src = dataUrl;
  });
}

/**
 * Verkleinert, falls nötig. Gibt immer `{ url, w, h }` zurück – auch
 * dann, wenn nichts zu tun war.
 */
async function passeBildAn(dataUrl) {
  const bild = await ladeBild(dataUrl);
  const bw = bild.naturalWidth || bild.width;
  const bh = bild.naturalHeight || bild.height;
  if (!bw || !bh) throw new Error('BILD_UNLESBAR');

  const laengste = Math.max(bw, bh);
  const klein = laengste <= BILD_MAX_KANTE && dataUrl.length < BILD_JPEG_AB;
  if (klein) return { url: dataUrl, w: bw, h: bh };

  const faktor = Math.min(1, BILD_MAX_KANTE / laengste);
  const zw = Math.max(1, Math.round(bw * faktor));
  const zh = Math.max(1, Math.round(bh * faktor));

  const flaeche = document.createElement('canvas');
  flaeche.width = zw;
  flaeche.height = zh;
  const ctx = flaeche.getContext('2d');
  ctx.drawImage(bild, 0, 0, zw, zh);

  let url = flaeche.toDataURL('image/png');
  if (url.length > BILD_JPEG_AB) url = flaeche.toDataURL('image/jpeg', 0.82);
  return { url, w: zw, h: zh };
}

/**
 * Wo steht die Schreibmarke auf dem Blatt? In Seitenkoordinaten.
 *
 * Damit landet ein eingesetztes Bild dort, wo man gerade ist, und nicht
 * blind oben links über der Überschrift. Ist die Marke nirgends (Zeiger-
 * werkzeug, gerade gerollt), kommt null zurück.
 */
function markeAufSeite(page) {
  const pgEl = E('pg-scroll')?.querySelector('[data-pgid="' + page.id + '"]');
  if (!pgEl) return null;

  const sel = window.getSelection ? window.getSelection() : null;
  if (!sel || !sel.rangeCount) return null;

  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r || (!r.height && !r.width)) return null;

  // Gehört die Marke überhaupt zu DIESER Seite?
  const pr = pgEl.getBoundingClientRect();
  if (r.top < pr.top || r.top > pr.bottom) return null;

  const zoom = (typeof getZoom === 'function' && getZoom()) || 1;
  return Math.round((r.bottom - pr.top) / zoom) + 10;
}

/**
 * Setzt ein Bild als Objekt auf eine Seite.
 *
 * Die Rechnung ist dieselbe wie beim Einfügen über den Dateiwähler, nur
 * mit einer Obergrenze: ein Bild, das breiter als das Blatt ist, wäre
 * halb daneben und man käme an seine Griffe nicht mehr heran.
 *
 * @param {number} [ab] Höhe, ab der es stehen soll (Seitenkoordinaten)
 * @returns {object|null} das angelegte Objekt
 */
function setzeBildObjekt(page, bild, ab) {
  if (!page || !bild || !bild.url) return null;

  const nutzbar = (page.w || CFG.PAGE_W) - 160;
  let ow = Math.min(420, nutzbar);
  let oh = ow * (bild.h / (bild.w || 1));

  // Hochkant: nicht über die halbe Seitenhöhe hinaus
  const hoehe = page.h || CFG.PAGE_H;
  const hoechstens = (hoehe - BILD_KOPF_PX) * 0.6;
  if (oh > hoechstens) { oh = hoechstens; ow = oh * (bild.w / (bild.h || 1)); }

  /* Unter der Marke, aber nie unter den Blattrand hinaus und nie in den
     Seitenkopf hinein. Ohne diese beiden Grenzen läge das Bild bei einer
     Marke am Seitenende halb außerhalb. */
  let y = Number.isFinite(ab) ? ab : (BILD_KOPF_PX + 24);
  y = Math.min(Math.max(y, BILD_KOPF_PX + 24), Math.max(BILD_KOPF_PX + 24, hoehe - oh - 24));

  const obj = {
    id: uid(), kind: 'image', src: bild.url, name: bild.name || 'Bild',
    x: 80, y: Math.round(y),
    w: Math.round(ow), h: Math.round(oh), rot: 0
  };

  if (!page.objects) page.objects = [];
  page.objects.push(obj);

  /* Die Objekt-Ebene fehlt, wenn die Seite gerade nicht gezeichnet ist.
     Das Bild liegt dann trotzdem im Heft – dieselbe Vorsicht wie in
     insertFilesFlow, wo genau das einmal ein verlorenes Bild war. */
  const objLayer = E('pg-scroll')
    ?.querySelector('[data-pgid="' + page.id + '"]')
    ?.querySelector('.j-objects');
  if (objLayer && typeof placeObject === 'function') placeObject(objLayer, obj, page);

  return obj;
}

/**
 * Holt die Bilder aus einer Zwischenablage und setzt sie auf die Seite.
 *
 * >>> Warum `items` UND `files` durchgesehen werden <<<
 * Was in der Zwischenablage liegt, sieht je nach Herkunft anders aus. Ein
 * Bildschirmfoto kommt als `items`-Eintrag ohne Dateinamen, eine im
 * Explorer kopierte Datei als `files`-Eintrag. Chromium füllt mal das
 * eine, mal beides – gesammelt wird deshalb aus beiden, und Doppelte
 * werden über ihre Größe ausgesiebt.
 *
 * @returns {Promise<number>} wie viele Bilder eingesetzt wurden
 */
async function fuegeBilderAusZwischenablage(dataTransfer, page) {
  if (!dataTransfer || !page) return 0;
  if (S.readOnly) return 0;

  const dateien = [];
  const gesehen = new Set();
  const merke = (datei) => {
    if (!datei || !/^image\//.test(datei.type || '')) return;
    const schluessel = (datei.name || '') + ':' + datei.size + ':' + datei.type;
    if (gesehen.has(schluessel)) return;
    gesehen.add(schluessel);
    dateien.push(datei);
  };

  for (const eintrag of Array.from(dataTransfer.items || [])) {
    if (eintrag.kind !== 'file') continue;
    merke(eintrag.getAsFile());
  }
  for (const datei of Array.from(dataTransfer.files || [])) merke(datei);

  if (!dateien.length) return 0;

  /* Die Stelle JETZT messen, vor dem Einlesen: das dauert einen Moment,
     und bis dahin kann die Marke längst woanders stehen. */
  let ab = markeAufSeite(page);

  /* Der Schritt in den Verlauf steht VOR der ersten Änderung und gilt für
     alle Bilder zusammen: einmal Rückgängig nimmt das Einsetzen zurück,
     nicht Bild für Bild. */
  if (typeof pushPageHistory === 'function') pushPageHistory(page);

  let gesetzt = 0;
  for (const datei of dateien) {
    try {
      const roh = await leseBildDatei(datei);
      const bild = await passeBildAn(roh);
      bild.name = datei.name || 'Bild';
      const obj = setzeBildObjekt(page, bild, ab);
      if (!obj) continue;
      gesetzt++;
      // Mehrere auf einmal: das nächste kommt unter das vorige
      ab = obj.y + obj.h + 16;
    } catch (err) {
      console.warn('[Einfügen] Bild aus der Zwischenablage:', err?.message || err);
    }
  }

  if (!gesetzt) return 0;

  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  toast(gesetzt + ' ' + t('objectsInserted'));
  return gesetzt;
}
window.fuegeBilderAusZwischenablage = fuegeBilderAusZwischenablage;

/** Liegt in dieser Zwischenablage überhaupt ein Bild? */
function zwischenablageHatBild(dataTransfer) {
  if (!dataTransfer) return false;
  for (const eintrag of Array.from(dataTransfer.items || [])) {
    if (eintrag.kind === 'file' && /^image\//.test(eintrag.type || '')) return true;
  }
  for (const datei of Array.from(dataTransfer.files || [])) {
    if (/^image\//.test(datei.type || '')) return true;
  }
  return false;
}
window.zwischenablageHatBild = zwischenablageHatBild;

/* ── Einsetzen, ohne im Text zu stehen ──────────────────────────────
   Strg+V mit dem Zeigerwerkzeug, nach dem Rollen, nach dem Anklicken
   eines Bildes: die Schreibmarke ist dann nirgends, und der Griff am
   Textfeld (app.js) bekommt gar nichts zu sehen. Das Bild soll trotzdem
   ankommen – auf der Seite, die gerade im Bild steht.

   Steht die Marke IM Text, ist der Griff dort schon zuständig; hier wird
   dann nichts getan, sonst käme das Bild zweimal. Und in einem Eingabe-
   feld (Suche, Freigabe-Dialog) gilt das gewöhnliche Einsetzen. */
document.addEventListener('paste', (e) => {
  if (typeof S === 'undefined' || !S.activePgId || S.readOnly) return;

  const ziel = e.target;
  if (ziel && ziel.closest) {
    if (ziel.closest('.j-text')) return;                     // app.js macht das
    if (ziel.closest('input, textarea, [contenteditable]')) return;
  }
  if (!zwischenablageHatBild(e.clipboardData)) return;

  const info = typeof getPage === 'function' ? getPage(S.activePgId) : null;
  if (!info || !info.page) return;

  e.preventDefault();
  fuegeBilderAusZwischenablage(e.clipboardData, info.page)
    .catch(err => console.warn('[Einfügen] Bild:', err?.message || err));
});

/* ══════════════════════════════════════════════════════════════════════
   EIN PDF ALS NEUES HEFT

   Derselbe Weg wie beim Einfuegen – parsePdfToImages malt jede Seite in
   ein Bild –, nur landen die Seiten in einem frischen Heft statt in
   einem offenen. Aufgerufen aus ui/homeGrid.js, wenn in der Uebersicht
   „Dokument oeffnen" gewaehlt wurde.

   @param {object} nb        das frische Heft; seine Seiten werden ersetzt
   @param {string} dataUrl   die PDF-Datei
   @returns {Promise<{seiten:number}>}
   ══════════════════════════════════════════════════════════════════════ */
async function fillNotebookFromPdf(nb, dataUrl) {
  const bilder = await parsePdfToImages(dataUrl);
  if (!bilder.length) throw new Error(t('pdfNoPages') || 'Das PDF hat keine Seiten.');

  /* Die leere Startseite faellt weg – sie stuende sonst vor der ersten
     Seite des Dokuments, und niemand hat sie bestellt. */
  nb.pages = bilder.map(b => makeImagePage(b.url, b.w, b.h));
  nb.sections = [];
  return { seiten: nb.pages.length };
}
window.fillNotebookFromPdf = fillNotebookFromPdf;

/* ══════════════════════════════════════════════════════════════════════
   EIN PDF ALS ÄNDERBARER TEXT

   Der zweite Weg neben fillNotebookFromPdf. Der Unterschied ist kein
   technischer, sondern was man mit dem Ergebnis vorhat:

     als Bild  jede Seite bleibt, wie sie ist, und man schreibt mit dem
               Stift darauf – Arbeitsblätter, Skripte zum Markieren.
     als Text  der Inhalt wird herausgelöst und neu umbrochen; er ist
               danach änderbar und durchsuchbar wie jeder Hefttext.

   Beides hat seinen Preis, und der gehört gesagt: als Bild kann man den
   Text nicht ändern und die Suche findet ihn nicht. Als Text geht das
   Aussehen verloren – Spalten, Tabellen, die genaue Stelle jedes Wortes.
   Die Wahl trifft deshalb der Nutzer (ui/homeGrid.js) und nicht der Code.

   ── Was hier NICHT versucht wird ────────────────────────────────────
   Das Layout nachzubauen. Ein PDF weiß nichts von Absätzen, Überschriften
   oder Listen – es weiß nur, welches Zeichen an welcher Stelle steht.
   Alles darüber ist geraten, und eine halbe Nachbildung wäre schlechter
   als eine ehrliche Übersetzung: Text in Absätzen, Überschriften an der
   Schriftgröße erkannt, Seitenumbruch beim Seitenumbruch.

   ── Was aber sehr wohl mitkommt ─────────────────────────────────────
   Alles, was auf dem Blatt kein Text ist: Schaubilder, Fotos, Formeln
   als Grafik, eingescannte Ausschnitte. Sie werden aus der gemalten
   Seite geschnitten (pdfBildbereiche, pdfSeitenBilder). Vorher fiel bei
   einem bebilderten Dokument der größere Teil des Inhalts weg, und
   niemand sah, dass er je da war – „als Text" hieß in Wahrheit „nur
   die Buchstaben".

   >>> Jedes Bild bekommt eine eigene Seite <<<
   Und nicht einen Platz im Textfluss. Als Objekt zwischen den Absätzen
   lag es ÜBER dem Text (canvas/objects.js, z-index 2000), ließ sich
   verschieben und verrutschte beim nächsten Umbruch – ein Bild, das
   niemand dorthin gelegt hat, aber jeder wieder wegräumen muss. Als
   eigene Seite steht es dort, wo es im PDF stand, in voller Breite und
   ohne etwas zu verdecken. Das Heft wird dadurch länger als das PDF;
   das ist der Preis und er ist sichtbar, was besser ist als ein Bild,
   das heimlich einen Absatz zudeckt.

   Ein PDF ohne Textebene (ein eingescanntes Blatt) hat für diesen Weg
   gar nichts zu holen. Das wird erkannt und gesagt – der Nutzer bekommt
   dann das Heft aus Seitenbildern, das er eigentlich wollte, statt eines
   Hefts voller Bild-Objekte ohne ein Wort dazwischen.
   ══════════════════════════════════════════════════════════════════════ */

/** Text in etwas verwandeln, das gefahrlos in HTML stehen darf. */
function alsHtmlText(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ══════════════════════════════════════════════════════════════════════
   DIE BILDSTELLEN EINER PDF-SEITE

   Ein PDF besteht nicht nur aus Text. Schaubilder, Fotos, Formeln als
   Grafik, eingescannte Ausschnitte – die waren beim Weg „als Text"
   bisher alle weg, und bei einem bebilderten Dokument ist das der
   größere Teil des Inhalts.

   >>> Warum aus dem gemalten Blatt geschnitten und nicht ausgepackt <<<
   pdf.js kann die eingebetteten Bilddaten herausgeben. Sie sind dann
   aber roh – mit Farbraum, Maske und Beschnitt, die erst wieder
   angewandt werden müssten, und eine Vektorzeichnung ist überhaupt kein
   Bild und bliebe weiterhin verloren. Die Seite einmal zu malen und die
   Stelle herauszuschneiden gibt genau das, was der Leser sieht.

   Gefunden werden die Stellen über die Zeichenbefehle der Seite: jeder
   Bildbefehl malt in das Einheitsquadrat, seine Lage steckt in der
   gerade gültigen Matrix.
   ══════════════════════════════════════════════════════════════════════ */

/** So fein wird zum Ausschneiden gemalt – wie beim Weg „als Bild". */
const PDF_MAL_STUFE = 1.5;

/** Zwei Matrizen hintereinander – wie ctx.transform() sie verkettet. */
function pdfMatMal(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}

/** Das Einheitsquadrat durch eine Matrix – dort liegt das Bild. */
function pdfQuadratLage(m) {
  const xs = [];
  const ys = [];
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return {
    x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
    y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys)
  };
}

/**
 * Rechtecke zusammenfassen, die aneinanderstoßen.
 *
 * Ein eingescanntes Blatt steckt oft nicht als ein Bild im PDF, sondern
 * als Dutzende waagerechter Streifen. Einzeln eingefügt gäben sie
 * Dutzende Bildchen mit Fugen dazwischen; zusammengefasst sind sie
 * wieder das eine Blatt.
 */
function pdfBereicheVereinen(bereiche) {
  const rand = 2;                 // Fugen unter 2 pt zählen als „stößt an"
  const offen = bereiche.slice();
  let wieder = true;

  while (wieder) {
    wieder = false;
    for (let i = 0; i < offen.length && !wieder; i++) {
      for (let j = i + 1; j < offen.length; j++) {
        const a = offen[i];
        const b = offen[j];
        const trennt = a.x1 + rand < b.x0 || b.x1 + rand < a.x0 ||
                       a.y1 + rand < b.y0 || b.y1 + rand < a.y0;
        if (trennt) continue;
        offen[i] = {
          x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1),
          y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1)
        };
        offen.splice(j, 1);
        wieder = true;
        break;
      }
    }
  }
  return offen;
}

/**
 * Wo auf der Seite steht ein Bild, und steht überhaupt etwas darauf?
 *
 * @returns {Promise<{bereiche:Array<{x0,y0,x1,y1}>, gezeichnet:boolean}>}
 *   in PDF-Koordinaten (Nullpunkt unten links), noch ungemalt
 */
async function pdfBildbereiche(seite) {
  const OPS = (typeof pdfjsLib !== 'undefined' && pdfjsLib.OPS) || null;
  if (!OPS) return { bereiche: [], gezeichnet: false };

  let befehle;
  try {
    befehle = await seite.getOperatorList();
  } catch (err) {
    /* Eine Seite, deren Befehle sich nicht lesen lassen, kostet nur ihre
       Bilder – der Text ist davon unberührt und längst geholt. */
    console.warn('[PDF] Bildstellen einer Seite nicht lesbar:', err && err.message || err);
    return { bereiche: [], gezeichnet: false };
  }

  let m = [1, 0, 0, 1, 0, 0];
  const stapel = [];
  const roh = [];
  let gezeichnet = false;

  const fn = befehle.fnArray || [];
  const args = befehle.argsArray || [];

  for (let i = 0; i < fn.length; i++) {
    switch (fn[i]) {
      case OPS.save:
        stapel.push(m.slice());
        break;
      case OPS.restore:
        if (stapel.length) m = stapel.pop();
        break;
      case OPS.transform:
        if (args[i]) m = pdfMatMal(m, args[i]);
        break;

      /* Ein Form-XObject ist eine eingebettete Teilzeichnung. Sie bringt
         ihre eigene Matrix mit, und die gilt nur bis zu ihrem Ende –
         sonst säßen alle folgenden Bilder verschoben. */
      case OPS.paintFormXObjectBegin:
        stapel.push(m.slice());
        if (args[i] && args[i][0]) m = pdfMatMal(m, args[i][0]);
        break;
      case OPS.paintFormXObjectEnd:
        if (stapel.length) m = stapel.pop();
        break;

      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
        roh.push(pdfQuadratLage(m));
        gezeichnet = true;
        break;

      /* Gekachelte und gruppierte Bilder werden nicht einzeln verfolgt –
         das sind Muster und Symbole, keine Schaubilder. Sie zählen aber
         als „hier steht etwas", damit eine Seite ohne Textebene nicht
         fälschlich als leer durchgeht. */
      case OPS.paintImageXObjectRepeat:
      case OPS.paintImageMaskXObjectRepeat:
      case OPS.paintImageMaskXObjectGroup:
      case OPS.paintInlineImageXObjectGroup:
      case OPS.constructPath:
      case OPS.shadingFill:
        gezeichnet = true;
        break;
    }
  }

  if (!roh.length) return { bereiche: [], gezeichnet };

  /* Bei einem Wald aus winzigen Masken – manche PDF setzen so ihre
     Schrift – wäre das paarweise Zusammenfassen teuer und das Ergebnis
     wertlos. Dann zählen nur die größten Stellen. */
  roh.sort((a, b) => ((b.x1 - b.x0) * (b.y1 - b.y0)) - ((a.x1 - a.x0) * (a.y1 - a.y0)));
  const bereiche = pdfBereicheVereinen(roh.slice(0, 200));

  return { bereiche, gezeichnet };
}

/** Steht diese Zeile innerhalb des Bildes? */
function pdfZeileImBereich(z, b) {
  if (z.y < b.y0 || z.y > b.y1) return false;
  const breite = Math.max(1, z.x1 - z.x0);
  const gemeinsam = Math.min(z.x1, b.x1) - Math.max(z.x0, b.x0);
  /* Nur was fast ganz drinsteht – eine Zeile, die daneben weiterläuft,
     gehört zum Fließtext und nicht zum Bild. */
  return gemeinsam / breite >= 0.7;
}

/**
 * Malt die Bildstellen einer Seite aus und schneidet sie heraus.
 *
 * @param {object} seite   die PDF-Seite
 * @param {Array}  zeilen  ihre Textzeilen (aus pdfZeilen)
 * @param {object} lage    das Ergebnis von pdfBildbereiche
 * @returns {Promise<{bilder:Array<{y:number, bild:{src,w,h}}>, zeilen:Array}>}
 *   w und h sind das Maß auf dem Blatt in PDF-Punkten – daraus wird
 *   später das Seitenverhältnis der Bildseite. zeilen = die übrigen;
 *   was im Bild steht, fällt heraus
 */
async function pdfSeitenBilder(seite, zeilen, lage) {
  const blatt = seite.view || [0, 0, 612, 792];
  const blattBreite = Math.max(1, blatt[2] - blatt[0]);
  const blattFlaeche = Math.max(1, blattBreite * (blatt[3] - blatt[1]));
  const flaecheVon = b => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

  /* Zu klein, um Inhalt zu sein: Trennstriche, Aufzählungspunkte, das
     Logo in der Kopfzeile. Sie einzufügen ergäbe eine Seite voller
     Schnipsel. Gemessen wird erst NACH dem Zusammenfassen – ein Streifen
     eines gescannten Blatts ist für sich genommen auch nur ein Strich. */
  let bereiche = lage.bereiche
    .filter(b => (b.x1 - b.x0) >= 24 && (b.y1 - b.y0) >= 24 && flaecheVon(b) >= 1600)
    .sort((a, b) => flaecheVon(b) - flaecheVon(a))
    .slice(0, 12);

  /* Ein Blatt, das fast ganz von einem Bild bedeckt ist, ist ein
     eingescanntes Blatt – auch wenn oben eine Seitenzahl als echter Text
     steht. Was daneben an Text gefunden wird, ist im Bild ohnehin zu
     sehen; ihn zusätzlich zu übernehmen legte Buchstaben unter ein Bild,
     das sie verdeckt. */
  const grossesBild = bereiche.length > 0 && flaecheVon(bereiche[0]) >= blattFlaeche * 0.85;
  const wenigText = zeilen.reduce((n, z) => n + z.text.length, 0) < 300;
  let seiteIstBild = false;

  if (grossesBild && wenigText) {
    bereiche = [bereiche[0]];
    seiteIstBild = true;
  } else if (grossesBild) {
    /* Viel Text UND ein blattfüllendes Bild: das ist ein Wasserzeichen
       oder ein Rahmen. Es läge sonst als Objekt über dem ganzen Text und
       machte die Seite unlesbar. */
    bereiche = bereiche.slice(1);
  }

  /* Keine Textebene, aber es steht etwas auf dem Blatt: dann ist die
     ganze Seite das Bild. Einzelne Stellen auszuschneiden hilft hier
     nicht – bei einer reinen Vektorzeichnung gäbe es gar keine. */
  if (!zeilen.length && lage.gezeichnet && !bereiche.length) {
    bereiche = [{ x0: blatt[0], y0: blatt[1], x1: blatt[2], y1: blatt[3] }];
    seiteIstBild = true;
  }

  if (!bereiche.length) return { bilder: [], zeilen };

  // Einmal malen; aus diesem einen Blatt werden alle Stellen geschnitten
  const mal = seite.getViewport({ scale: PDF_MAL_STUFE });
  const blattCanvas = document.createElement('canvas');
  blattCanvas.width = Math.max(1, Math.round(mal.width));
  blattCanvas.height = Math.max(1, Math.round(mal.height));
  await seite.render({
    canvasContext: blattCanvas.getContext('2d'), viewport: mal
  }).promise;

  const bilder = [];
  let uebrig = zeilen;

  for (const b of bereiche) {
    const e1 = mal.convertToViewportPoint(b.x0, b.y0);
    const e2 = mal.convertToViewportPoint(b.x1, b.y1);
    const sx = Math.round(Math.max(0, Math.min(e1[0], e2[0])));
    const sy = Math.round(Math.max(0, Math.min(e1[1], e2[1])));
    const sw = Math.round(Math.min(blattCanvas.width, Math.max(e1[0], e2[0]))) - sx;
    const sh = Math.round(Math.min(blattCanvas.height, Math.max(e1[1], e2[1]))) - sy;
    if (sw < 8 || sh < 8) continue;

    const teil = document.createElement('canvas');
    teil.width = sw;
    teil.height = sh;
    const tctx = teil.getContext('2d');
    /* Weiß unterlegen: ein JPEG kennt kein Durchsichtig, und was ein PDF
       nicht selbst färbt, käme sonst schwarz heraus. */
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0, 0, sw, sh);
    tctx.drawImage(blattCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    /* Das Maß auf dem Blatt, in PDF-Punkten. Gebraucht wird davon nur
       das Verhältnis: die Bildseite ist so breit wie jede Heftseite,
       ihre Höhe folgt daraus (makeImagePage). */
    const w = Math.round(sw / PDF_MAL_STUFE);
    const h = Math.round(sh / PDF_MAL_STUFE);
    if (w < 8 || h < 8) continue;

    bilder.push({ y: b.y1, bild: { src: teil.toDataURL('image/jpeg', 0.72), w, h } });

    /* Die Beschriftung IN einem Schaubild steht jetzt schon im Bild. Sie
       zusätzlich als Text zu übernehmen, streute zwischen die Absätze
       eine Reihe zusammenhangloser Wortfetzen – Achsenbeschriftungen
       ergeben ohne ihr Bild keinen Satz. */
    if (flaecheVon(b) < blattFlaeche * 0.7) {
      uebrig = uebrig.filter(z => !pdfZeileImBereich(z, b));
    }
  }

  if (seiteIstBild) uebrig = [];

  return { bilder, zeilen: uebrig };
}

/**
 * Die Textzeilen einer PDF-Seite.
 *
 * pdf.js liefert Textstücke mit ihrer Stelle auf dem Blatt, nicht
 * Zeilen – ein Wort kann ein eigenes Stück sein. Zusammengefasst wird
 * über die Grundlinie (transform[5]); was auf derselben Höhe steht,
 * gehört in dieselbe Zeile.
 *
 * @returns {Array<{text:string, y:number, groesse:number, x0:number, x1:number}>}
 */
function pdfZeilen(inhalt) {
  const stuecke = (inhalt.items || []).filter(it => it && typeof it.str === 'string');

  const zeilen = [];
  for (const it of stuecke) {
    const y = Math.round(it.transform[5]);
    const groesse = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
    const x = it.transform[4];

    /* Zwei Zeichen Toleranz: eine Zeile ist nie zeichengenau auf einer
       Höhe – Hoch- und Tiefgestelltes, andere Schriften, Rundungen. */
    const passend = zeilen.find(z => Math.abs(z.y - y) <= 2);
    if (passend) {
      passend.stuecke.push({ x, str: it.str, breite: it.width || 0 });
      passend.groesse = Math.max(passend.groesse, groesse);
    } else {
      zeilen.push({ y, groesse, stuecke: [{ x, str: it.str, breite: it.width || 0 }] });
    }
  }

  // Von oben nach unten. Der Nullpunkt eines PDF liegt UNTEN links.
  zeilen.sort((a, b) => b.y - a.y);

  return zeilen.map(z => {
    z.stuecke.sort((a, b) => a.x - b.x);
    let text = '';
    let letztesEnde = null;
    for (const s of z.stuecke) {
      /* Ein Leerzeichen nur dort, wo auf dem Blatt wirklich eine Lücke
         ist. Sonst wird aus „Wort-" + „teil" ein „Wort- teil". */
      if (letztesEnde !== null && s.x - letztesEnde > 1 && !/\s$/.test(text) && !/^\s/.test(s.str)) {
        text += ' ';
      }
      text += s.str;
      letztesEnde = s.x + s.breite;
    }
    /* Wo die Zeile anfängt und aufhört: daran erkennt pdfZeileImBereich,
       ob sie in einem Bild steht und dort schon zu sehen ist. */
    const x0 = z.stuecke[0].x;
    const x1 = z.stuecke.reduce((m, s) => Math.max(m, s.x + s.breite), x0);
    return { text: text.replace(/\s+/g, ' ').trim(), y: z.y, groesse: z.groesse, x0, x1 };
  }).filter(z => z.text);
}

/**
 * Macht aus dem Inhalt einer Seite Absätze, Überschriften und Bilder.
 *
 * @param {Array} eintraege   Textzeilen und Bilder, von oben nach unten
 * @param {number} normal     die übliche Schriftgröße des Dokuments
 * @returns {Array} Blöcke; ein Bild steht als { bildSeite } darin und
 *   trennt den Text davor von dem danach
 */
function pdfBloeckeAusZeilen(eintraege, normal) {
  const bloecke = [];
  let absatz = [];
  let letztesY = null;
  let letzteGroesse = null;

  const schliesse = () => {
    if (!absatz.length) return;
    bloecke.push({ html: '<p>' + alsHtmlText(absatz.join(' ')) + '</p>' });
    absatz = [];
  };

  for (const z of eintraege) {
    /* Ein Bild steht für sich – und zwar auf einer eigenen Seite. Hier
       wird nur die Stelle vermerkt; die Seite entsteht in
       fillNotebookFromPdfText, das den Text davor und danach getrennt
       umbricht. */
    if (z.bild) {
      schliesse();
      bloecke.push({ bildSeite: z.bild });
      letztesY = null;
      letzteGroesse = null;
      continue;
    }

    /* Deutlich größer als der Rest? Dann ist es eine Überschrift. Der
       Schwellwert ist grob, und das ist Absicht: feiner geraten hieße,
       oft daneben zu liegen, und eine falsche Überschrift stört mehr
       als eine fehlende. */
    const stufe = z.groesse >= normal * 1.45 ? 1 : (z.groesse >= normal * 1.18 ? 2 : 0);

    if (stufe) {
      schliesse();
      bloecke.push({ html: `<p class="j-title-${stufe}">${alsHtmlText(z.text)}</p>` });
      letztesY = z.y;
      letzteGroesse = z.groesse;
      continue;
    }

    /* Ein neuer Absatz beginnt bei einer größeren Lücke als dem üblichen
       Zeilenabstand – anderthalb Zeilen sind die Grenze. Und immer dann,
       wenn die Schriftgröße wechselt. */
    const lueckeZuGross = letztesY !== null && (letztesY - z.y) > z.groesse * 1.8;
    const andereGroesse = letzteGroesse !== null && Math.abs(letzteGroesse - z.groesse) > 0.6;
    if (lueckeZuGross || andereGroesse) schliesse();

    absatz.push(z.text);
    letztesY = z.y;
    letzteGroesse = z.groesse;
  }

  schliesse();
  return bloecke;
}

/**
 * Liest den Text eines PDF und baut daraus die Seiten eines Hefts.
 *
 * @returns {Promise<{seiten:number, quellseiten:number, leer:boolean}>}
 *   leer = das PDF hatte keine Textebene (eingescannt)
 */
async function fillNotebookFromPdfText(nb, dataUrl, onFortschritt) {
  if (typeof InkwellsDocxPaginate === 'undefined') throw new Error('NO_DOCX_MODULE');

  const base64 = String(dataUrl).split(',')[1] || '';
  const roh = window.atob(base64);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

  const bg = nb.defaultBg || 'ruled';

  /* Erst den Text aller Seiten und die Lage ihrer Bilder sammeln. Die
     übliche Schriftgroesse laesst sich erst danach bestimmen: ohne sie
     waere „gross" ein Wert aus der Luft. Gemalt wird in diesem Durchgang
     noch nicht – hat das PDF gar keine Textebene, endet die Sache gleich
     darauf, und die Arbeit waere umsonst gewesen. */
  const proSeite = [];
  for (let nr = 1; nr <= pdf.numPages; nr++) {
    const seite = await pdf.getPage(nr);
    const zeilen = pdfZeilen(await seite.getTextContent());
    proSeite.push({ seite, zeilen, lage: await pdfBildbereiche(seite), bilder: [] });
    if (onFortschritt) onFortschritt(nr, pdf.numPages);
  }

  const alleZeilen = proSeite.flatMap(s => s.zeilen);
  if (!alleZeilen.length) return { seiten: 0, quellseiten: pdf.numPages, leer: true };

  /* Die haeufigste Groesse ist der Fliesstext. Der Mittelwert waere
     schlechter: ein einziger grosser Titel zieht ihn nach oben, und
     danach gilt der halbe Text als Ueberschrift. */
  const zaehler = new Map();
  for (const z of alleZeilen) {
    const k = Math.round(z.groesse * 2) / 2;
    zaehler.set(k, (zaehler.get(k) || 0) + z.text.length);
  }
  let normal = 10;
  let beste = -1;
  for (const [groesse, gewicht] of zaehler) {
    if (gewicht > beste) { beste = gewicht; normal = groesse; }
  }

  /* Zweiter Durchgang: die Bildstellen ausschneiden. Erst jetzt, weil
     jede Seite dafuer gemalt werden muss – der teure Schritt. */
  let bilderZahl = 0;
  for (let i = 0; i < proSeite.length; i++) {
    const s = proSeite[i];
    try {
      const ausbeute = await pdfSeitenBilder(s.seite, s.zeilen, s.lage);
      s.zeilen = ausbeute.zeilen;
      s.bilder = ausbeute.bilder;
      bilderZahl += ausbeute.bilder.length;
    } catch (err) {
      /* Ein Bild weniger ist kein Grund, den ganzen Import hinzuwerfen –
         der Text der Seite steht laengst und bleibt. */
      console.warn('[PDF] Bilder einer Seite uebersprungen:', err && err.message || err);
    }
    if (onFortschritt) onFortschritt(i + 1, pdf.numPages);
  }

  const bloecke = [];
  proSeite.forEach((s, idx) => {
    /* Text und Bilder in die Reihenfolge bringen, in der sie auf dem
       Blatt stehen. Der Nullpunkt eines PDF liegt UNTEN links, ein
       groesseres y heisst also weiter oben. */
    const eintraege = s.zeilen.concat(s.bilder).sort((a, b) => b.y - a.y);
    const teil = pdfBloeckeAusZeilen(eintraege, normal);
    // Jede PDF-Seite faengt eine neue Heftseite an. Alles andere waere
    // eine Vermutung darueber, ob der Text weiterlaeuft.
    if (idx > 0 && teil.length) teil[0].umbruchDavor = true;
    bloecke.push(...teil);
  });

  if (!bloecke.length) return { seiten: 0, quellseiten: pdf.numPages, leer: true };

  /* Der Text wird abschnittsweise umbrochen: alles bis zum nächsten Bild,
     dann die Bildseite, dann weiter. Ein Umbruch über das Bild hinweg
     wäre falsch – was danach kommt, stand im PDF unter dem Bild und darf
     nicht davor rutschen. */
  const heftSeiten = [];
  let puffer = [];

  const textAbladen = () => {
    if (!puffer.length) return;
    const teile = InkwellsDocxPaginate.verteile(puffer, {
      breite: CFG.PAGE_W, hoehe: CFG.PAGE_H, bg
    });
    for (const t of teile) {
      const pg = makePage(bg);
      // Durch den Sanitizer, obwohl der Text aus dem eigenen Umwandler
      // kommt: gebaut ist er aus einer FREMDEN Datei.
      pg.textContent = typeof sanitizePageHtml === 'function'
        ? sanitizePageHtml(t.html) : t.html;
      heftSeiten.push(pg);
    }
    puffer = [];
  };

  for (const block of bloecke) {
    if (block.bildSeite) {
      textAbladen();
      /* Dieselbe Seite wie beim Weg „als Bild": das Bild IST die Seite,
         nicht ein Ding darauf. Es lässt sich damit nicht versehentlich
         verschieben, und der Stift schreibt darauf. */
      heftSeiten.push(makeImagePage(block.bildSeite.src, block.bildSeite.w, block.bildSeite.h));
      continue;
    }
    puffer.push(block);
  }
  textAbladen();

  if (!heftSeiten.length) return { seiten: 0, quellseiten: pdf.numPages, leer: true };

  nb.pages = heftSeiten;
  nb.sections = [];

  return {
    seiten: nb.pages.length,
    quellseiten: pdf.numPages,
    bilder: bilderZahl,
    leer: false
  };
}
window.fillNotebookFromPdfText = fillNotebookFromPdfText;

/* ══════════════════════════════════════════════════════════════════════
   EIN INKWELLS-HEFT ALS NEUES HEFT

   Der dritte Weg neben Word und PDF, und der einzige, bei dem die Datei
   schon ein Heft IST. Trotzdem wird sie nicht einfach übernommen,
   sondern abgeschrieben:

   >>> Warum eine Kopie und nicht die Datei selbst <<<
   Dafür gibt es „Laden" (doLoad). Dort bleibt die Datei, wo sie liegt,
   und das Heft merkt sich ihren Pfad. Das ist richtig für ein eigenes
   Heft, das nur gerade woanders liegt – und falsch für eines, das man
   geschickt bekommen hat: es läge dann weiter im Download-Ordner, und
   jede Änderung ginge dorthin. Hier entsteht deshalb ein neues Heft im
   eigenen Speicherort, mit eigenem Namen und eigener Farbe.

   >>> Warum jede Kennung neu vergeben wird <<<
   getPage() sucht eine Seite über ALLE offenen Hefte (core/data.js).
   Zwei Hefte mit derselben Seitenkennung – und genau das entsteht beim
   Öffnen derselben Datei zweimal – lieferten dann einmal die eine und
   einmal die andere Seite. Das ist kein Anzeigefehler, sondern
   geschriebener Text, der in der falschen Datei landet.

   >>> Warum alles durch einen Filter geht <<<
   Die Datei kommt von ausserhalb. Sie ist zwar in unserem Format, aber
   niemand hat sie geprüft: ein <script> im Seitentext, ein
   javascript:-Verweis in einem Bild, eine Farbe, die in Wahrheit ein
   url() ist. Übernommen wird deshalb nur, was auf der Liste steht –
   ausdrücklich die Liste des ERLAUBTEN, wie im Sanitizer.
   ══════════════════════════════════════════════════════════════════════ */

/** Eine Zahl, die auch wirklich eine ist. */
function jrnlZahl(wert, ersatz) {
  const n = Number(wert);
  return Number.isFinite(n) ? n : ersatz;
}

/** Eine Farbe und sonst nichts – kein url(), kein Ausdruck. */
function jrnlFarbe(wert, ersatz) {
  return (typeof wert === 'string'
    && wert.length <= 64
    && /^(none|transparent|#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/]+\)|[a-z]{3,20})$/i.test(wert.trim()))
    ? wert.trim() : ersatz;
}

/** Ein Bild, das im Heft liegt – und nicht irgendwo im Netz. */
function jrnlBildDaten(wert) {
  return (typeof wert === 'string' && /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,/i.test(wert))
    ? wert : null;
}

/** Eine der bekannten Papierarten. */
function jrnlPapier(wert, ersatz) {
  const liste = (typeof BG_TYPES !== 'undefined' && Array.isArray(BG_TYPES))
    ? BG_TYPES.map(b => b.id) : ['ruled', 'grid', 'dots', 'blank', 'craft'];
  return liste.includes(wert) ? wert : ersatz;
}

/** Ein Objekt der Seite – nur die Arten, die es wirklich gibt. */
function jrnlObjekt(o) {
  if (!o || typeof o !== 'object') return null;

  const lage = {
    id: uid(),
    x: jrnlZahl(o.x, 0), y: jrnlZahl(o.y, 0),
    w: Math.max(1, jrnlZahl(o.w, 100)), h: Math.max(1, jrnlZahl(o.h, 100)),
    rot: jrnlZahl(o.rot, 0)
  };
  if (o.layer === 'back') lage.layer = 'back';

  if (o.kind === 'image') {
    const src = jrnlBildDaten(o.src);
    if (!src) return null;
    return { ...lage, kind: 'image', src, name: String(o.name || '').slice(0, 120) };
  }

  if (o.kind === 'shape') {
    const arten = ['rect', 'ellipse', 'triangle', 'line', 'arrow'];
    const form = {
      ...lage, kind: 'shape',
      shapeType: arten.includes(o.shapeType) ? o.shapeType : 'rect',
      fill: jrnlFarbe(o.fill, 'none'),
      stroke: jrnlFarbe(o.stroke, '#1a1510'),
      strokeWidth: Math.max(0.5, jrnlZahl(o.strokeWidth, 2))
    };
    /* Die Enden einer Linie liegen als Anteile 0…1 im Rechteck
       (canvas/shapes.js). Fehlen sie, gilt dort die alte Diagonale. */
    if (o.p1 && o.p2) {
      form.p1 = { x: jrnlZahl(o.p1.x, 0), y: jrnlZahl(o.p1.y, 1) };
      form.p2 = { x: jrnlZahl(o.p2.x, 1), y: jrnlZahl(o.p2.y, 0) };
    }
    return form;
  }

  if (o.kind === 'formula') {
    return {
      ...lage, kind: 'formula',
      latex: String(o.latex || '').slice(0, 4000),
      display: !!o.display,
      natW: Math.max(1, jrnlZahl(o.natW, lage.w)),
      natH: Math.max(1, jrnlZahl(o.natH, lage.h))
    };
  }

  return null;
}

/** Ein Stiftstrich mit seinem Weg über das Blatt. */
function jrnlStrich(s) {
  if (!s || !Array.isArray(s.path) || !s.path.length) return null;
  const path = s.path
    .filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    .map(p => ({ x: Number(p.x), y: Number(p.y), p: jrnlZahl(p.p, 0.6) }));
  if (!path.length) return null;
  return {
    id: uid(),
    path,
    color: jrnlFarbe(s.color, '#1a1510'),
    width: Math.max(0.5, jrnlZahl(s.width, 3)),
    isHL: !!s.isHL,
    isGeometric: !!s.isGeometric
  };
}

/**
 * Liest eine .jrnl-Datei und füllt damit ein frisches Heft.
 *
 * @param {object} nb    das frische Heft aus dem Anlegen-Fenster
 * @param {string} text  der Dateiinhalt
 * @returns {{seiten:number, abschnitte:number, kommentare:number}}
 */
function fillNotebookFromJrnl(nb, text) {
  let daten;
  try {
    daten = JSON.parse(String(text || ''));
  } catch (err) {
    throw new Error(t('jrnlBroken') || 'Die Datei lässt sich nicht lesen.');
  }

  /* Zwei Schreibweisen: { notebooks: [ … ] } schreibt der Speicherweg
     (core/fileManager.js), ein blosses Heft kommt aus älteren Ständen. */
  const quelle = Array.isArray(daten && daten.notebooks)
    ? daten.notebooks[0]
    : daten;

  if (!quelle || !Array.isArray(quelle.pages) || !quelle.pages.length) {
    throw new Error(t('jrnlEmpty') || 'In der Datei steht kein Heft.');
  }

  // Abschnitte zuerst: die Seiten verweisen darauf
  const secKennung = new Map();
  nb.sections = (Array.isArray(quelle.sections) ? quelle.sections : []).map(s => {
    const id = uid();
    secKennung.set(String(s && s.id), id);
    return { id, name: String((s && s.name) || '').slice(0, 120), pgIds: [] };
  });

  const seitenKennung = new Map();
  nb.pages = quelle.pages.map(p => {
    const pg = makePage(jrnlPapier(p && p.bg, nb.defaultBg || 'ruled'));
    seitenKennung.set(String(p && p.id), pg.id);

    if (typeof p.date === 'string' && p.date) pg.date = p.date;

    /* Durch den Sanitizer, wie bei jedem Text aus fremder Hand – das ist
       derselbe Riegel wie bei geteilten Heften. */
    pg.textContent = typeof sanitizePageHtml === 'function'
      ? sanitizePageHtml(String(p.textContent || ''))
      : String(p.textContent || '');

    const bgImg = jrnlBildDaten(p.bgImg);
    if (bgImg) pg.bgImg = bgImg;

    // Bildseiten haben ein eigenes Mass (makeImagePage)
    if (p.w) pg.w = Math.max(100, jrnlZahl(p.w, CFG.PAGE_W));
    if (p.h) pg.h = Math.max(100, jrnlZahl(p.h, CFG.PAGE_H));

    pg.objects = (Array.isArray(p.objects) ? p.objects : []).map(jrnlObjekt).filter(Boolean);
    pg.inkStrokes = (Array.isArray(p.inkStrokes) ? p.inkStrokes : []).map(jrnlStrich).filter(Boolean);

    const sec = secKennung.get(String(p.secId));
    if (sec) pg.secId = sec;

    return pg;
  });

  /* pgIds wird abgeleitet mitgeschrieben – ein Stand ohne die Umstellung
     auf page.secId hielte einen Abschnitt ohne pgIds sonst für leer und
     legte ungefragt Füllseiten an (core/data.js). */
  for (const pg of nb.pages) {
    const sec = nb.sections.find(s => s.id === pg.secId);
    if (sec) sec.pgIds.push(pg.id);
  }
  nb.sections = nb.sections.filter(s => s.pgIds.length);
  nb.schemaVersion = typeof SCHEMA_VERSION !== 'undefined' ? SCHEMA_VERSION : 2;

  /* Kommentare hängen an einer Marke im Seitentext, und die trägt die
     Kennung des Kommentars – die bleibt deshalb, wie sie ist. Nur die
     Seite, auf die sie zeigt, ist eine neue. */
  const kommentare = (Array.isArray(quelle.comments) ? quelle.comments : [])
    .map(c => {
      const seite = seitenKennung.get(String(c && c.pageId));
      if (!seite) return null;
      return {
        id: String(c.id || uid()),
        pageId: seite,
        text: String(c.text || '').slice(0, 4000),
        zitat: String(c.zitat || '').slice(0, 160),
        author: String(c.author || '').slice(0, 120),
        created: jrnlZahl(c.created, Date.now()),
        resolved: !!c.resolved,
        replies: (Array.isArray(c.replies) ? c.replies : []).map(r => ({
          id: String((r && r.id) || uid()),
          text: String((r && r.text) || '').slice(0, 4000),
          author: String((r && r.author) || '').slice(0, 120),
          created: jrnlZahl(r && r.created, Date.now())
        }))
      };
    })
    .filter(Boolean);
  if (kommentare.length) nb.comments = kommentare;

  return {
    seiten: nb.pages.length,
    abschnitte: nb.sections.length,
    kommentare: kommentare.length
  };
}
window.fillNotebookFromJrnl = fillNotebookFromJrnl;

/* ══════════════════════════════════════════════════════════════════════
   EIN WORD-DOKUMENT ALS NEUES HEFT

   Drei Schritte, jeder in seiner eigenen Datei:
     1. core/docxImport.js   liest die .docx und macht Bloecke daraus
     2. core/docxPaginate.js misst und verteilt sie auf Seiten
     3. hier                 baut daraus Heftseiten samt Bild-Objekten

   Getrennt, weil nur der mittlere Schritt ein Fenster zum Messen
   braucht und nur der letzte das Datenmodell kennt.
   ══════════════════════════════════════════════════════════════════════ */

/** data:-Adresse → Bytes. */
function dataUrlZuBytes(dataUrl) {
  const roh = atob(String(dataUrl).split(',')[1] || '');
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return bytes;
}

async function fillNotebookFromDocx(nb, dataUrl, onFortschritt) {
  if (typeof InkwellsDocxImport === 'undefined' || typeof InkwellsDocxPaginate === 'undefined') {
    throw new Error('NO_DOCX_MODULE');
  }

  const bg = nb.defaultBg || 'ruled';
  const zeilenhoehe = InkwellsDocxPaginate.zeilenhoeheFuer(bg);
  const nutz = InkwellsDocxPaginate.nutzhoehe(CFG.PAGE_H);

  /* Die Kennungen aus dem Auspacker in etwas uebersetzen, das man lesen
     kann. Sie kamen bisher roh bis in die Meldung durch – „ZIP_BROKEN"
     sagt niemandem etwas, und bei ZIP_TOO_BIG (der Grenze gegen eine
     aufgeblasene Datei, siehe core/docxImport.js) waere es sogar
     irrefuehrend: die Datei ist ja klein, nur ihr Inhalt nicht. */
  let gelesen;
  try {
    gelesen = await InkwellsDocxImport.lese(dataUrlZuBytes(dataUrl), {
      zeilenhoehe,
      maxBildHoehe: nutz
    });
  } catch (err) {
    const kennung = String(err && err.message || '');
    if (kennung === 'ZIP_TOO_BIG') throw new Error(t('docxTooBig') || 'Das Dokument ist zu groß zum Öffnen.');
    if (kennung === 'ZIP_BROKEN' || kennung === 'NO_ZIP' || kennung === 'BAD_XML') {
      throw new Error(t('docxBroken') || 'Die Datei ist beschädigt und lässt sich nicht lesen.');
    }
    throw err;
  }
  const { bloecke, bericht, hintergrund } = gelesen;

  if (!bloecke.length) throw new Error(t('docxEmpty') || 'Das Dokument ist leer.');

  const seiten = InkwellsDocxPaginate.verteile(bloecke, {
    breite: CFG.PAGE_W,
    hoehe: CFG.PAGE_H,
    bg,
    onFortschritt
  });

  nb.pages = seiten.map(s => {
    const pg = makePage(bg);
    /* Durch den Sanitizer, obwohl der Text aus dem eigenen Umwandler
       kommt: er ist aus einer FREMDEN Datei gebaut, und deren Inhalt
       hat niemand geprueft. Derselbe Riegel wie bei geteilten Heften. */
    pg.textContent = typeof sanitizePageHtml === 'function'
      ? sanitizePageHtml(s.html) : s.html;
    /* Aus dem Umbruch kommen Bilder und Formen in einer Liste – beide
       sind Objekte auf der Seite, nur eben verschiedene. */
    pg.objects = (s.bilder || []).map(b => {
      const lage = { id: uid(), x: b.x, y: b.y, w: b.w, h: b.h, rot: 0 };
      if (b.shapeType) {
        return {
          ...lage, kind: 'shape', shapeType: b.shapeType,
          fill: b.fill || 'none',
          stroke: b.stroke || '#1a1510',
          strokeWidth: b.strokeWidth || 2,
          layer: b.layer === 'back' ? 'back' : 'front'
        };
      }
      return { ...lage, kind: 'image', src: b.src, name: '' };
    });
    /* Der Hintergrund des Dokuments wiederholt sich auf jeder Seite –
       so hält Word ihn, und so sieht man ihn dort. Als bgImg liegt er
       unter dem Text (app.js) und nicht als Bild darüber. */
    if (hintergrund && hintergrund.src) pg.bgImg = hintergrund.src;
    return pg;
  });
  nb.sections = [];

  return {
    seiten: nb.pages.length,
    bilder: bericht.bilder,
    formen: bericht.formen,
    tabellen: bericht.tabellen,
    hintergrund: bericht.hintergrund,
    verloren: bericht.verloren
  };
}
window.fillNotebookFromDocx = fillNotebookFromDocx;

/* ── INSERT ── */
/* Aufgerufen aus dem Einfügen-Menü (ui/insert.js). Hier hing bis dahin
   der Knopf selbst; seit es dort auch Tabellen gibt, ist der Knopf ein
   Menü und dies einer seiner Einträge. */
async function insertFilesFlow() {
  if (!window.api) { toast(t('electronOnly'), true); return; }
  /* Ohne Schreibrecht gar nicht erst anfangen. Sonst entstünden Seiten nur
     örtlich – und gingen gesammelt hinaus, sobald das Recht zurückkommt
     (setCanWrite ruft syncStructure). Gleicher Riegel wie in ui/sidebar.js. */
  if (S.readOnly) { toast(t('sharedNoRight'), true); return; }
  const files = await window.api.pickFiles();
  if (!files || !files.length) return;

  const insertType = await showInsertChoice();
  if (!insertType) return;

  toast(t('processingFiles'));
  const nb = getNb();
  /* Der gezeigte Ausschnitt – darf leer sein. Steht die Ansicht auf
     "alle Seiten", bekommen neue Seiten kein Etikett; frueher brach der
     Einfuegevorgang hier ab, weil immer ein Abschnitt offen sein musste. */
  const sec = activeSection(nb);
  const info = getPage(S.activePgId);
  if (!info) return;

  let addedPages = false;
  let firstNewPageId = null;
  let addedObjects = 0;

  for (const f of files) {
    if (f.kind === 'pdf') {
      try {
        const pdfImageUrls = await parsePdfToImages(f.dataUrl);

        if (insertType === 'page') {
          // Die Stelle zaehlt im HEFT, nicht im Abschnitt
          const insertIdx = pageNumberOf(nb, info.page.id);

          pdfImageUrls.forEach((imgObj, i) => {
            const newPg = makeImagePage(imgObj.url, imgObj.w, imgObj.h);
            insertPageInto(nb, sec, newPg, insertIdx + i);
            if (!firstNewPageId) firstNewPageId = newPg.id;
          });
          addedPages = true;
          if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
        } else {
          const pages = pagesOfSec(sec, nb);
          let curIdx = pages.indexOf(info.page);
          const MAX_PER_PAGE = 5;
          for (let start = 0; start < pdfImageUrls.length; start += MAX_PER_PAGE) {
            const chunk = pdfImageUrls.slice(start, start + MAX_PER_PAGE);
            let targetPgInfo;
            if (start === 0) {
              targetPgInfo = info;
            } else {
              curIdx++;
              if (curIdx < pages.length) {
                targetPgInfo = getPage(pages[curIdx].id);
              } else {
                const newPg = makePage(sec.defaultBg || nb.defaultBg || 'ruled');
                insertPageInto(nb, sec, newPg, pageNumberOf(nb, pages[curIdx - 1]?.id));
                targetPgInfo = { page: newPg };
                addedPages = true;
                if (!firstNewPageId) firstNewPageId = newPg.id;
                pages.splice(curIdx, 0, newPg);
              }
            }

            const objLayer = E('pg-scroll').querySelector(`[data-pgid="${targetPgInfo.page.id}"]`)?.querySelector('.j-objects');
            let currY = 80;
            let pageHLimit = (targetPgInfo.page.h || CFG.PAGE_H);
            let ohLimit = (pageHLimit - 120) / chunk.length - 20;

            pushPageHistory(targetPgInfo.page);
            chunk.forEach((imgObj, idx) => {
              let oh = Math.min(ohLimit, 400);
              let ow = oh * (imgObj.w / imgObj.h);
              if (ow > 600) { ow = 600; oh = ow * (imgObj.h / imgObj.w); }

              const obj = { id: uid(), kind: 'image', src: imgObj.url, name: f.name, x: 80, y: currY, w: ow, h: oh, rot: 0 };
              if (!targetPgInfo.page.objects) targetPgInfo.page.objects = [];
              targetPgInfo.page.objects.push(obj);
              if (objLayer) placeObject(objLayer, obj, targetPgInfo.page);
              addedObjects++;
              currY += oh + 20;
            });
          }
        }
      } catch (err) {
        console.error('PDF Parse error:', err);
        toast(t('pdfError'), true);
      }
    } else if (f.kind === 'image') {
      if (insertType === 'page') {
        const tmpImg = new Image();
        tmpImg.src = f.dataUrl;
        await new Promise(r => tmpImg.onload = r);
        const newPg = makeImagePage(f.dataUrl, tmpImg.naturalWidth, tmpImg.naturalHeight);
        insertPageInto(nb, sec, newPg, pageNumberOf(nb, info.page.id));
        if (!firstNewPageId) firstNewPageId = newPg.id;
        addedPages = true;
        if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
      } else {
        // Die Objekt-Ebene fehlt, wenn die Zielseite gerade nicht gezeichnet
        // ist. Das Bild trotzdem ins Datenmodell legen – vorher wurde es in
        // dem Fall stillschweigend ganz verworfen.
        const objLayer = E('pg-scroll').querySelector('[data-pgid="' + info.page.id + '"]')?.querySelector('.j-objects');
        pushPageHistory(info.page);
        const tmpImg = new Image();
        tmpImg.src = f.dataUrl;
        await new Promise(r => tmpImg.onload = r);
        let ow = 200;
        let oh = ow * (tmpImg.naturalHeight / (tmpImg.naturalWidth || 1));
        const obj = { id: uid(), kind: 'image', src: f.dataUrl, name: f.name, x: 80, y: 80, w: ow, h: oh, rot: 0 };
        if (!info.page.objects) info.page.objects = [];
        info.page.objects.push(obj);
        if (objLayer) placeObject(objLayer, obj, info.page);
        addedObjects++;
      }
    }
  }

  // Ein einziger Ort für „es hat sich etwas geändert“.
  // Vorher hing das an mehreren Stellen im Ablauf und wurde ausgerechnet
  // beim häufigsten Fall vergessen: ein PDF als Objekte einfügen, das noch
  // auf die vorhandenen Seiten passt. Dann war addedPages false, das Heft
  // galt als unverändert – und die Bilder wurden weder gespeichert noch in
  // die Cloud geladen. In der App sah man sie (sie hingen im DOM), auf der
  // Website tauchten sie nie auf und nach einem Neustart waren sie weg.
  if ((addedPages || addedObjects > 0) && window.markCurrentNotebookDirty) {
    window.markCurrentNotebookDirty();
  }

  if (addedPages) {
    renderSideTree();
    openSection(sec, firstNewPageId);
    toast(t('insertedAsPages'));
  } else if (addedObjects > 0) {
    updateUndoRedoUI();
    S.mode = 'cursor';
    applyMode();
    QA('.tb-mode').forEach(b => b.classList.toggle('active', b.dataset.mode === 'cursor'));
    E('pen-opts').style.display = 'none';
    E('eraser-opts').style.display = 'none';
    E('text-opts').style.display = 'flex';
    toast(addedObjects + ' ' + t('objectsInserted'));
  }
}
window.insertFilesFlow = insertFilesFlow;

/* ── SAVE / LOAD / PDF ── */
/* Der Editor ins Datenmodell, Seite für Seite. Über ohneGriffe, sonst
   reisen Greifstreifen und der Zustand kommentierter Stellen mit – die
   Begründung steht dort (app.js). */
function syncAll() { QA('.j-page').forEach(pgEl => { const info = getPage(pgEl.dataset.pgid); if (!info) return; const txt = pgEl.querySelector('.j-text'); if (txt) info.page.textContent = typeof ohneGriffe === 'function' ? ohneGriffe(txt) : txt.innerHTML; info.page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[info.page.id] || [])); }); }
async function doLoad() { 
  if (!window.api) { toast(t('electronOnly'), true); return; } 
  const data = await window.api.load(); 
  if (!data) { toast(t('cancelled'), true); return; } 
  
  // Treat either an explicit "loadedSingle" flag OR a file that contains
  // exactly one notebook in the `notebooks` array as a single-notebook load.
  if ((data.loadedSingle && data.notebooks && data.notebooks.length === 1) || (data.notebooks && data.notebooks.length === 1 && !data.loadedSingle)) {
    // Single notebook loaded - add to existing notebooks if not already present
    const loadedNb = data.notebooks[0];
    const existing = S.notebooks.find(nb => nb.id === loadedNb.id);
    if (existing) {
      // Replace existing notebook with loaded one
      const idx = S.notebooks.indexOf(existing);
      S.notebooks[idx] = loadedNb;
      toast(t('notebookUpdated'));
    } else {
      // Check if name already exists
      const nameExists = S.notebooks.find(nb => nb.name === loadedNb.name);
      if (nameExists) {
        toast(t('nameExists'), true);
        return;
      }
      S.notebooks.push(loadedNb);
      toast(t('notebookLoaded'));
    }

    // Persist the loaded notebook in the overview registry so it comes back after restart
    if (data.sourcePath) {
      await Registry.add(loadedNb, data.sourcePath);
    }
  } else {
    // Old format - replace all
    S.notebooks = data.notebooks || []; 
  }
  S.activeNbId = null; 
  showHome(); 
}
// Der Knopf in der Übersicht ist weg; der im Heft bleibt.
if (E('btn-load')) E('btn-load').addEventListener('click', doLoad);
if (E('btn-load-home')) E('btn-load-home').addEventListener('click', doLoad);
/* ══════════════════════════════════════════════════════════════════
   PDF-EXPORT
   Die Seiten werden genauso aufgebaut wie in der App: Papierhintergrund,
   Handschrift, eingefügte Bilder und Text. Die frühere Fassung gab nur
   Text und Hintergrundbild aus – Zeichnungen fehlten im PDF komplett.

   794 × 1123 px entsprechen bei 96 dpi genau DIN A4, deshalb passen die
   Seiten ohne Umrechnung in die Druckausgabe (printToPDF, A4, ohne Rand).
   ══════════════════════════════════════════════════════════════════ */

// Zeichnet die Striche einer Seite auf ein durchsichtiges Bild.
// Gleiche Logik wie redrawStrokes(), aber mit fester Skalierung statt
// Bildschirm-Pixelverhältnis, damit die Auflösung fürs Drucken reicht.
function renderInkToDataUrl(page, scale = 2) {
  const strokes = page.inkStrokes || [];
  if (!strokes.length) return null;

  const w = page.w || CFG.PAGE_W;
  const h = page.h || CFG.PAGE_H;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  /* Im Seitenkopf steht nie ein Strich – dieselbe Grenze wie auf dem
     Bildschirm (css/pages.css, .j-canvas) und im Word-Export
     (core/docx.js, drawInk). Ohne das laege im Ausdruck ein Strich
     quer ueber Seitenzahl und Datum. */
  ctx.beginPath();
  ctx.rect(0, CFG.HDR, w, h - CFG.HDR);
  ctx.clip();

  let i = 0;
  while (i < strokes.length) {
    const s = strokes[i];

    if (s.isHL) {
      // Marker gruppiert und gemeinsam transparent, sonst überlagern sie sich
      const chunk = [];
      while (i < strokes.length && strokes[i].isHL) { chunk.push(strokes[i]); i++; }

      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const oc = off.getContext('2d');
      oc.scale(scale, scale);
      chunk.forEach(hs => {
        applyStrokeStyles(oc, hs);
        oc.globalAlpha = 1;
        traceStrokePath(oc, hs);
      });

      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.drawImage(off, 0, 0, w, h);
      ctx.restore();
    } else if (s.isEraser) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      applyStrokeStyles(ctx, { ...s, color: 'rgba(0,0,0,1)' });
      traceStrokePath(ctx, s);
      ctx.restore();
      i++;
    } else {
      ctx.save();
      applyStrokeStyles(ctx, s);
      ctx.globalAlpha = s.alpha || 1;
      traceStrokePath(ctx, s);
      ctx.restore();
      i++;
    }
  }

  return canvas.toDataURL('image/png');
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {number} pageNo Seitenzahl des HEFTS (1-basiert), nicht des Abschnitts */
function buildPdfPage(nb, sec, page, pageNo) {
  const bgId = page.bg || sec?.defaultBg || nb.defaultBg || 'ruled';
  const lh = lhForBg(bgId);
  const pt = ptForBg(bgId);
  const rightPad = rightPadForBg(bgId);
  const w = page.w || CFG.PAGE_W;
  const h = page.h || CFG.PAGE_H;

  let html = `<div class="pg bg-${bgId}" data-pgid="${escapeAttr(page.id)}" style="width:${w}px;height:${h}px">`;

  if (page.bgImg) {
    html += `<img class="pg-bgimg" src="${escapeAttr(page.bgImg)}">`;
  }

  html += `<div class="ph"><span>${t('page') || 'Seite'} ${pageNo}</span><span>${fmt(page.date)}</span></div>`;

  // Text mit derselben Geometrie wie im Editor
  /* Auch hier bereinigt: das erzeugte HTML wird in main.js in ein
     eigenes Fenster geladen (export-pdf). Das traegt zwar kein
     preload und damit kein window.api, koennte aber immer noch nach
     aussen funken – ein fremdes Heft zu exportieren darf nichts
     ausloesen. */
  const exportText = sanitizePageHtml(page.textContent);
  if (exportText) {
    /* --lh muss mit: die Tabellenzellen halten darüber ihre Mindesthöhe
       auf genau eine Zeile (siehe die Regeln im Kopf von buildPdf). Ohne
       das wäre eine leere Zelle im Ausdruck ein Strich ohne Höhe. */
    html += `<div class="tx" style="line-height:${lh}px;--lh:${lh}px;padding-top:${pt}px;right:${rightPad}px">`
      + exportText + '</div>';
  }

  /* Eingefügte Bilder. Die Ebene entscheidet, ob sie über oder unter Text
     und Handschrift liegen – genau wie in der App (canvas/objects.js). Die
     Reihenfolge im Dokument bleibt die aus page.objects, damit sich zwei
     Bilder derselben Ebene hier genauso überdecken wie dort. */
  for (const obj of (page.objects || [])) {
    if (!obj || !obj.src) continue;
    const rot = obj.rot ? `transform:rotate(${obj.rot}deg);` : '';
    const cls = obj.layer === 'back' ? 'obj behind' : 'obj';
    html += `<img class="${cls}" src="${escapeAttr(obj.src)}" style="left:${obj.x || 0}px;top:${obj.y || 0}px;`
      + `width:${obj.w || 200}px;height:${obj.h || 200}px;${rot}">`;
  }

  const ink = renderInkToDataUrl(page);
  if (ink) html += `<img class="ink" src="${ink}">`;

  html += '</div>';

  // Überschriftengrößen hängen an der Zeilenhöhe des Hintergrunds
  const sel = `[data-pgid="${page.id}"] .tx`;
  html += `<style>${sel} h1,${sel} p.j-title-1{font-size:${Math.round(lh * .75)}px}`
    + `${sel} h2,${sel} p.j-title-2{font-size:${Math.round(lh * .65)}px}`
    + `${sel} h3,${sel} p.j-title-3{font-size:${Math.round(lh * .58)}px}</style>`;

  return html;
}

/* ══════════════════════════════════════════════════════════════════
   WELCHE SEITEN WERDEN EXPORTIERT?

   Ein Export umfasst nicht mehr zwangsläufig das ganze Heft: man kann
   eine einzelne Seite, einen Bereich oder alles ausgeben. Damit sich
   Auswahl und Ergebnis decken, gibt es genau EINE maßgebliche Liste –
   dieselbe, aus der auch das PDF gebaut wird.

   Leere Seiten stehen nicht drin: sie landeten noch nie im PDF, und sie
   mitzuzählen würde die Seitenzahlen der Auswahl verschieben.
   ══════════════════════════════════════════════════════════════════ */

/**
 * @returns {Array<{page: object, sec: object, pageNo: number}>}
 *   in Heft-Reihenfolge. `pageNo` ist die Seitenzahl des HEFTS – dieselbe,
 *   die im Editor über der Seite steht.
 *
 * >>> Warum die Nummer jetzt vom Heft kommt <<<
 * Vorher wurde je Abschnitt gezählt (`indexInSection`), im Export-Dialog
 * dagegen über die ganze Liste. Der Dialog sagte deshalb „Seite 12 von 30",
 * während auf ebendieser Seite im PDF „Seite 3" stand. Beide Zahlen kommen
 * jetzt aus derselben Quelle: notebookPages() in core/data.js.
 *
 * Leere Seiten stehen weiterhin nicht in der Liste – sie landeten noch nie
 * im PDF. Ihre Nummer wird aber NICHT übersprungen: eine herausgegriffene
 * Seite 7 heißt im PDF weiterhin „Seite 7", auch wenn Seite 6 leer war.
 */
function exportPageList(nb) {
  if (!nb) return [];
  getSections(nb);

  const list = [];
  notebookPages(nb).forEach((page, idx) => {
    if (pageIsEmpty(page)) return;
    list.push({ page, sec: findSecForPage(page.id, nb) || null, pageNo: idx + 1 });
  });
  return list;
}

/**
 * Liest eine Eingabe wie „1-3, 5, 8-10" als Menge von Seitenzahlen.
 * @returns {Set<number>|null} null, wenn die Eingabe unbrauchbar ist.
 */
function parsePageRange(text, total) {
  if (typeof text !== 'string') return null;

  // Auch Gedankenstriche und Semikolons annehmen – die tippt man leicht
  const cleaned = text.replace(/[–—]/g, '-').replace(/;/g, ',').trim();
  if (!cleaned) return null;

  const numbers = new Set();

  for (const rawPart of cleaned.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;

    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let from = parseInt(range[1], 10);
      let to = parseInt(range[2], 10);
      if (from > to) [from, to] = [to, from];
      for (let n = from; n <= to; n++) {
        if (n >= 1 && n <= total) numbers.add(n);
      }
      continue;
    }

    if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= total) numbers.add(n);
      continue;
    }

    return null;   // etwas, das keine Seitenangabe ist
  }

  return numbers.size ? numbers : null;
}

/**
 * @param {object} nb
 * @param {object} [options]
 * @param {Set<string>} [options.pageIds] Nur diese Seiten ausgeben. Ohne
 *   Angabe das ganze Heft. Die Seitenzahl in der Kopfzeile bleibt dabei
 *   die des vollständigen Hefts – eine herausgegriffene Seite 7 heißt im
 *   PDF also weiterhin „Seite 7" und nicht „Seite 1".
 */
/* >>> Warum nicht mehr nach Abschnitten gruppiert wird <<<
   Das PDF gibt das Heft wieder, wie es ist: eine durchgehende Folge, mit
   den Seitenzahlen des Hefts. Vorher standen erst alle Seiten des einen
   Abschnitts, dann die des nächsten, jeweils wieder ab 1 gezählt – und der
   Export-Dialog zählte gleichzeitig durch. Er sagte „Seite 12 von 30",
   während auf ebendieser Seite „Seite 3" stand.

   Beide kommen jetzt aus exportPageList(), und die Website gibt ohnehin
   schon flach aus – damit sind alle drei endlich einig. */
function buildPdf(nb, options = {}) {
  getSections(nb);

  const selected = options.pageIds instanceof Set ? options.pageIds : null;

  let body = '';
  for (const entry of exportPageList(nb)) {
    if (selected && !selected.has(entry.page.id)) continue;
    body += buildPdfPage(nb, entry.sec, entry.page, entry.pageNo);
  }

  if (!body) {
    body = `<div class="pg bg-blank" style="width:${CFG.PAGE_W}px;height:${CFG.PAGE_H}px">`
      + `<div class="tx" style="line-height:32px;padding-top:19px;right:32px">${t('pdfEmpty') || 'Dieses Notizbuch enthält noch keine Inhalte.'}</div></div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;1,400&family=DM+Mono:wght@400&family=Cormorant+Garamond:ital,wght@0,400;1,400&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0 }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { background: #fff; font-family: 'Crimson Pro', Georgia, serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }

  .sh { padding: 6mm 18mm 3mm; font-size: 17pt; font-style: italic; color: #8a6030;
        border-bottom: 1px solid #d4c8b0; page-break-after: avoid }

  .pg { position: relative; overflow: hidden; page-break-after: always; break-after: page }
  .pg:last-child { page-break-after: auto }

  .pg.bg-ruled, .pg.bg-grid, .pg.bg-dots { background: #faf7f0 }
  .pg.bg-blank { background: #fff }
  .pg.bg-craft { background: #f0e8d5 }

  .pg.bg-ruled::before { content: ''; position: absolute; inset: 0; z-index: 1;
    background-image: repeating-linear-gradient(to bottom, transparent, transparent 31px, #e2dbd0 31px, #e2dbd0 32px);
    background-position: 0 83px }
  .pg.bg-ruled::after { content: ''; position: absolute; left: 64px; top: 0; bottom: 0; width: 1px;
    background: rgba(190,120,120,.18); z-index: 1 }
  .pg.bg-grid::before { content: ''; position: absolute; inset: 0; z-index: 1;
    background-image: linear-gradient(to bottom, #ddd6c8 1px, transparent 1px), linear-gradient(to right, #ddd6c8 1px, transparent 1px);
    background-size: 24px 24px; background-position: 0 75px, 0 0 }
  .pg.bg-dots::before { content: ''; position: absolute; inset: 0; z-index: 1;
    background-image: radial-gradient(circle, #ddd6c8 1.2px, transparent 1.2px);
    background-size: 24px 24px; background-position: 0 63px }

  .pg-bgimg { position: absolute; top: 56px; left: 0; width: 100%; height: calc(100% - 56px);
              object-fit: contain; z-index: 1 }

  .ph { position: absolute; top: 0; left: 0; right: 0; height: 56px; padding: 0 72px; z-index: 1300;
        display: flex; align-items: center; justify-content: space-between;
        border-bottom: 2px solid #e2dbd0;
        font-family: 'DM Mono', Consolas, monospace; font-size: 9px; color: #b0a898; letter-spacing: .5px }

  .tx { position: absolute; top: 64px; left: 72px; bottom: 24px; z-index: 1000;
        font-family: 'Crimson Pro', Georgia, serif; font-size: 17px; color: #1a1510;
        white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word }
  .tx * { line-height: inherit }
  .tx h1, .tx p.j-title-1 { font-family: 'Cormorant Garamond', 'Crimson Pro', serif; font-weight: 400;
        font-style: italic; color: #2a1f14; border-bottom: 1px solid #e2dbd0; display: block }
  .tx h2, .tx p.j-title-2 { font-weight: 600; color: #2a1f14; display: block }
  .tx h3, .tx p.j-title-3 { font-weight: 600; font-style: italic; color: #3a2e22; display: block }

  /* ── Aufzaehlungen und Tabellen ──────────────────────────────────────
     ACHTUNG: Dieser Block steht INNERHALB einer Schablonenzeichenkette.
     Ein Gegenstrich-Anfuehrungszeichen beendete sie hier mitten im
     Kommentar – deshalb steht im Folgenden keines.

     Beide Regelsaetze standen hier gar nicht, und das ist im Ausdruck zu
     sehen: der Rundumschlag ganz oben (Sternchen, margin 0, padding 0)
     nimmt einer Liste ihren Einzug – die Punkte klebten am linken Rand –
     und eine Tabelle bekam die Voreinstellung des Browsers, also keine
     Linien.

     Die Regeln sind dieselben wie in css/pages.css – auch der Grund
     dafuer, dass die Zellenlinien aus einem box-shadow kommen und nicht
     aus einem border: ein Rand nimmt Platz ein und schoebe den Text
     unter der Tabelle neben die Linien des Papiers. */
  /* Ausrichtung. Dieselben Klassen wie in css/pages.css, samt !important
     aus demselben Grund: Kopfzelle und Block-Formel richten selbst aus
     und sind genauer als eine einzelne Klasse. */
  .tx .j-align-center { text-align: center !important }
  .tx .j-align-right { text-align: right !important }
  .tx .j-align-justify { text-align: justify !important }

  /* Der Abstandshalter aus einem Klick rechts neben bestehenden Text
     (canvas/text.js). Seine Breite steht am Element; ohne diese Regel
     hätte er keine, und der Text ruckte im Ausdruck nach links. */
  .tx .j-luecke { display: inline-block; height: 1px; vertical-align: baseline }

  .tx ul, .tx ol { margin: 0; padding: 0 0 0 32px; line-height: inherit }
  .tx li { margin: 0; padding: 0; line-height: inherit }
  .tx ul.j-list-disc { list-style-type: disc }
  .tx ul.j-list-circle { list-style-type: circle }
  .tx ul.j-list-square { list-style-type: square }
  .tx ul.j-list-dash { list-style-type: '– ' }
  .tx ul.j-list-arrow { list-style-type: '➤ ' }
  .tx ul.j-list-check { list-style-type: '✓ ' }
  .tx ol.j-list-decimal { list-style-type: decimal }
  .tx ol.j-list-lower-alpha { list-style-type: lower-alpha }
  .tx ol.j-list-upper-alpha { list-style-type: upper-alpha }
  .tx ol.j-list-lower-roman { list-style-type: lower-roman }
  .tx ol.j-list-upper-roman { list-style-type: upper-roman }
  .tx ol.j-list-paren { list-style-type: decimal }
  .tx ol.j-list-paren > li::marker { content: counter(list-item) ') ' }
  .tx ol.j-list-alpha-paren { list-style-type: lower-alpha }
  .tx ol.j-list-alpha-paren > li::marker { content: counter(list-item, lower-alpha) ') ' }
  .tx ul.j-list-disc ul.j-list-disc { list-style-type: circle }
  .tx ul.j-list-disc ul.j-list-disc ul.j-list-disc { list-style-type: square }
  .tx ol.j-list-decimal ol.j-list-decimal { list-style-type: lower-alpha }
  .tx ol.j-list-decimal ol.j-list-decimal ol.j-list-decimal { list-style-type: lower-roman }

  .tx table.j-table { border-collapse: collapse; table-layout: auto; max-width: 100%;
        margin: 0; font-size: inherit; box-shadow: inset 1px 1px 0 0 rgba(28,20,10,.72) }
  .tx table.j-table:has(colgroup) { table-layout: fixed }
  .tx table.j-table td, .tx table.j-table th { border: 0;
        box-shadow: inset -1px -1px 0 0 rgba(28,20,10,.72);
        padding: 0 7px; vertical-align: middle; word-break: break-word;
        overflow-wrap: break-word; min-width: 28px; height: var(--lh, 32px) }
  .tx table.j-table th { font-weight: 600; text-align: left; background: rgba(28,20,10,.07) }

  /* Dieselbe Staffelung wie in der App (css/pages.css): Muster 1 ·
     Bild hinten 100 · Text 1000 · Handschrift 1100 · Seitenkopf 1300 ·
     Bild vorne 2000. Die Reihenfolge innerhalb eines Bandes steckt hier
     in der Dokumentreihenfolge – buildPdfPage gibt die Bilder in der
     Reihenfolge aus page.objects aus. */
  .obj { position: absolute; object-fit: contain; z-index: 2000 }
  .obj.behind { z-index: 100 }
  .ink { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1100 }
</style></head><body>${body}</body></html>`;
}

function pageIsVisuallyEmpty(page) {
  if (pageIsEmpty(page)) return true;
  if (!page || page.bgImg || page.objects?.length) return false;

  const plainText = (page.textContent || '').replace(/<[^>]+>/g, '').replace(/\s/g, '');
  if (plainText.length) return false;

  // Zeichenfläche ggf. erst wieder aufbauen, sonst wäre eine entlastete
  // Seite fälschlich "leer"
  if (window.PageCanvases) PageCanvases.ensure(page.id);

  const canvas = E('pg-scroll')?.querySelector('[data-pgid="' + page.id + '"]')?.querySelector('.j-canvas');
  if (!canvas) return false;

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const w = canvas.width || 0;
  const h = canvas.height || 0;
  if (!w || !h) return true;

  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

