'use strict';

const CFG = { PAGE_W: 794, PAGE_H: 1123, SCROLL_THRESH: 180, DPR: Math.min(window.devicePixelRatio || 1, 3) };

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
const fmt = iso => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
