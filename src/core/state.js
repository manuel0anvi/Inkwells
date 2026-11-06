'use strict';

/* ── HDR: der Seitenkopf ──────────────────────────────────────────────
   56 px hoch plus 2 px Trennlinie (css/pages.css, .j-page-hdr). Dort
   stehen Seitenzahl, Datum und die zwei Knoepfe – und sonst NICHTS.

   Angefangen zu zeichnen wird dort ohnehin nicht (der Kopf liegt ueber
   der Zeichenflaeche). Wer aber weiter unten ansetzt und nach oben
   zieht, malte bisher mitten durch den Kopf hindurch: der hat keinen
   eigenen Hintergrund, der Strich schien einfach darueberzuliegen.
   Dasselbe galt fuer ein Bild oder eine Form, die man hinaufschob.

   Die Zahl steht deshalb hier und nicht dreimal verstreut. Wer sie
   aendert, muss sie auch in css/pages.css aendern – dort steht die
   Hoehe des Kopfes selbst. */
const CFG = { PAGE_W: 794, PAGE_H: 1123, HDR: 58, SCROLL_THRESH: 180, DPR: Math.min(window.devicePixelRatio || 1, 3) };

const BG_TYPES = [{ id: 'ruled', label: 'Liniert' }, { id: 'grid', label: 'Kariert' }, { id: 'dots', label: 'Gepunktet' }, { id: 'blank', label: 'Weiß' }, { id: 'craft', label: 'Craft' }];
const BG_STYLE = { ruled: 'background:var(--paper);background-image:repeating-linear-gradient(to bottom,transparent,transparent 7px,#d4cdc0 7px,#d4cdc0 8px)', grid: 'background:var(--paper);background-image:repeating-linear-gradient(to bottom,transparent,transparent 7px,#d4cdc0 7px,#d4cdc0 8px),repeating-linear-gradient(to right,transparent,transparent 7px,#d4cdc0 7px,#d4cdc0 8px)', dots: 'background:var(--paper);background-image:radial-gradient(circle,#b0a898 1px,transparent 1px);background-size:8px 8px;background-position:4px 4px', blank: 'background:#fff', craft: 'background:#f0e8d5' };
const NB_COLORS = ['#c04040', '#c87a2a', '#2e8a46', '#2a5fa8', '#7a3aaa', '#8a5030', '#2a8a88', '#606060'];
const PEN_SIZES = [1.2, 2.5, 4.5, 8], ERASER_SIZES = [8, 18, 36], HL_SIZES = [12, 20, 32];

const _penPointers = new Set();
let _penLiftTime = 0;
const PEN_GRACE_MS = 500;

/* Handballen abweisen: liegt der Stift auf der Seite, gehoert sie ihm, und
   die Beruehrungen daneben werden verworfen (app.js).

   Aber NUR beim Zeichnen. Auf dem Zeiger soll der Stift schieben wie ein
   Finger – und Chromium meldet den Stift zusaetzlich als Beruehrung.
   Diese Sperre traf damit den Stift selbst: sie verwarf genau das
   Scrollen, das er gerade ausloesen wollte. */
function penIsActive() {
  if (typeof isDrawMode === 'function' && !isDrawMode(S.mode)) return false;
  return _penPointers.size > 0 || (Date.now() - _penLiftTime < PEN_GRACE_MS);
}

document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'pen') _penPointers.add(e.pointerId);
}, { capture: true, passive: true });

document.addEventListener('pointerup', e => {
  if (e.pointerType === 'pen') { _penPointers.delete(e.pointerId); _penLiftTime = Date.now(); }
}, { capture: true, passive: true });

document.addEventListener('pointercancel', e => {
  if (e.pointerType === 'pen') { _penPointers.delete(e.pointerId); _penLiftTime = Date.now(); }
}, { capture: true, passive: true });

/* ══════════════════════════════════════════════════════════════════════
   DER HANDBALLEN KOMMT VOR DEM STIFT

   >>> Gemeldet: „sobald die Hand angeht, springt die ganze Seite" <<<
   penIsActive greift erst, wenn der Stift AUFLIEGT. Beim Schreiben setzt
   aber die Hand zuerst auf – und ein Handballen meldet sich gern als
   zwei Beruehrungen. Das ist fuer app.js ein Zoomen mit zwei Fingern,
   und schon ein Wackeln der Hand zoomt dann die Seite woanders hin.

   Ein Stift, der knapp ueber dem Bildschirm schwebt, meldet sich aber
   schon: mit pointermove ohne Druck. Wer so nah ist, schreibt gleich –
   eine Beruehrung in dieser Zeit ist die Hand, nicht der Finger. Das
   gilt auch noch kurz danach: zwischen zwei Woertern hebt der Stift ab,
   die Hand bleibt liegen oder setzt neu auf.

   Gilt in jeder Stellung, nicht nur beim Zeichnen: der Stift greift aus
   der Zeigerstellung heraus ohnehin zum Stift (canvas/input.js).

   >>> Aber nur, solange er WIRKLICH schwebt <<<
   Zuerst galt eine feste Sekunde nach der letzten Meldung. Wer fertig
   geschrieben hatte und mit zwei Fingern scrollen oder herauszoomen
   wollte, wartete damit ein bis zwei Sekunden – gemeldet genau so. Der
   Stift sagt aber selbst, wann er den Bereich ueber dem Bildschirm
   verlaesst: pointerout ohne ein Ziel, in das er hinuebergeht. Danach
   bleibt nur ein kurzer Nachlauf. Die Frist nach der letzten Bewegung
   bleibt als Notbremse, falls diese Meldung einmal ausbleibt. */
let _stiftGesehen = 0;
let _stiftWeg = 0;
let _stiftSchwebt = false;
const STIFT_NACHLAUF_MS = 250;   // nach dem Verlassen des Schwebebereichs
const STIFT_STILL_MS = 800;      // ein schwebender Stift, der nichts mehr meldet

function stiftIstDa(e) {
  if (e.pointerType !== 'pen') return;
  _stiftSchwebt = true;
  _stiftGesehen = Date.now();
}
document.addEventListener('pointermove', stiftIstDa, { capture: true, passive: true });
document.addEventListener('pointerover', stiftIstDa, { capture: true, passive: true });
document.addEventListener('pointerdown', stiftIstDa, { capture: true, passive: true });

document.addEventListener('pointerout', e => {
  // Mit einem Ziel wechselt er nur das Element darunter
  if (e.pointerType !== 'pen' || e.relatedTarget) return;
  _stiftSchwebt = false;
  _stiftWeg = Date.now();
}, { capture: true, passive: true });

/** Ist ein Stift auf oder knapp ueber dem Bildschirm – oder war es gerade? */
function stiftInDerNaehe() {
  if (_penPointers.size > 0) return true;
  const jetzt = Date.now();
  if (_stiftSchwebt && jetzt - _stiftGesehen < STIFT_STILL_MS) return true;
  return jetzt - Math.max(_stiftWeg, _penLiftTime) < STIFT_NACHLAUF_MS;
}

/* ══════════════════════════════════════════════════════════════════════
   WIRD DAS GERAET GERADE ANGEFASST ODER GEZEIGT?

   Gebraucht fuer alles, was sich sonst erst bei :hover einblendet – der
   Punkteknopf einer Heftkarte, der Stift am Abschnitt. Ein Finger
   schwebt nicht, mit ihm waeren sie unerreichbar.

   >>> Warum das nicht die Medienabfrage macht <<<
   css/responsive.css hat sie deshalb unter `any-pointer: coarse`
   dauerhaft sichtbar gestellt. Auf einem umklappbaren Laptop trifft das
   aber IMMER zu, auch aufgeklappt mit Maus – und dann steht der Knopf auf
   jeder Karte, ohne dass ihn jemand braucht. Genau das wurde
   zurueckgemeldet.

   Die Frage ist nicht, was das Geraet KANN, sondern was gerade benutzt
   wird. Das steht erst im Ereignis.

   >>> Und bis das erste Ereignis kommt, gilt: angefasst <<<
   Umgekehrt war es falsch herum. Wer den Laptop umklappt, hat danach
   keine Maus mehr – aber auch noch kein Ereignis geschickt. Der Knopf
   fehlte deshalb genau dann, wenn er gebraucht wurde, und erschien erst,
   nachdem man irgendwohin getippt hatte. Gemeldet wurde das zweimal, im
   Tablet-Modus wie im Hochformat.

   Ein Geraet mit Beruehrungsschirm faengt jetzt im Finger-Zustand an.
   Sobald sich wirklich eine Maus bewegt, wechselt es – und das dauert
   keine Sekunde, wenn eine da ist. Windows meldet den Tablet-Modus
   nirgends nach aussen; die ausbleibende Mausbewegung ist das einzige
   verlaessliche Zeichen dafuer.
   ══════════════════════════════════════════════════════════════════════ */
function setzeEingabeArt(pointerType) {
  const anfassen = pointerType === 'touch';
  document.body.classList.toggle('touch-input', anfassen);
}

document.addEventListener('pointerdown', e => setzeEingabeArt(e.pointerType), { capture: true, passive: true });
// Ein Zeiger, der sich BEWEGT, ohne zu druecken, kann nur eine Maus sein
document.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse' && e.buttons === 0) setzeEingabeArt('mouse');
}, { capture: true, passive: true });

if ((navigator.maxTouchPoints || 0) > 0 || window.matchMedia('(pointer: coarse)').matches) {
  document.addEventListener('DOMContentLoaded', () => setzeEingabeArt('touch'));
}

const S = {
  notebooks: [], activeNbId: null, activePgId: null, mode: 'cursor',
  pen1: { color: '#1a1510', customColor: '#1a1510', szIdx: 1 },
  pen2: { color: '#1a3a6e', customColor: '#1a3a6e', szIdx: 2 },
  hl: { color: '#ffe066', customColor: '#ffe066', szIdx: 1 },
  eraser: { type: 'pixel', szIdx: 1 }, fontSize: 16, fontFamily: "'Crimson Pro',Georgia,serif",
  textColor: '#1a1510', textCustomColor: '#1a1510', isDrawing: false, strokeHistory: {},
  history: {},
  _historyLimit: 80,
  _cur: null,

  /* Nur lesen: für geteilte Dokumente ohne Bearbeitungsrecht. Bis dahin
     wurde jede Seite ausnahmslos beschreibbar aufgebaut. Ausgewertet in
     app.js (appendPageDOM), canvas/input.js und ui/toolbar.js. */
  readOnly: false,

  /* Das gerade geöffnete geteilte Dokument, sonst null.
     { docId, role, ownerName, ownerEmail, revision, title } */
  sharedDoc: null
};

const E = id => document.getElementById(id);
const QA = sel => [...document.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt = iso => new Date(iso).toLocaleDateString((typeof getLanguage === 'function' && getLanguage()) || 'de', { day: '2-digit', month: '2-digit', year: '2-digit' });
