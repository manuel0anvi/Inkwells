'use strict';

/* ══════════════════════════════════════════════════════════════════════
   TASTENKÜRZEL – Registry, Prüfung und Speicherung

   Alle änderbaren Kürzel stehen hier an einer Stelle. Die Oberfläche
   (ui/shortcuts.js) zeigt sie an und lässt sie ändern, ausgeführt werden
   sie vom Verteiler dort.

   Nicht änderbar sind bewusst: Esc (überall abbrechen), Enter/Esc in
   Dialogen sowie Tab/Enter beim Schreiben – die gehören zur Texteingabe
   und würden beim Umbelegen mehr kaputt machen als helfen.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Tastenkombination als Text ──────────────────────────────────────
   Einheitliche Schreibweise: Modifikatoren immer in derselben Reihenfolge,
   damit "Shift+Strg+S" und "Strg+Shift+S" dieselbe Kombination ergeben.
   ──────────────────────────────────────────────────────────────────── */

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'];

// Tasten, die beim Schreiben keinen Text erzeugen und deshalb auch ohne
// Modifikator gefahrlos belegt werden dürfen
const NON_TEXT_KEYS = new Set([
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'PageUp', 'PageDown', 'Home', 'End', 'Insert', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
]);

// Vom Betriebssystem oder von Chromium belegt – ein Kürzel darauf käme
// entweder nie an oder würde etwas Unerwartetes auslösen.
const RESERVED_COMBOS = new Set([
  'Alt+F4', 'Ctrl+W', 'Ctrl+Q', 'Ctrl+Shift+W',
  'Ctrl+R', 'F5', 'Ctrl+Shift+R',
  'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C', 'F12',
  'Ctrl+P', 'Ctrl+T', 'Ctrl+Shift+T',
  'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A',
  'Alt+Tab', 'Ctrl+Tab', 'Ctrl+Shift+Tab',
  'F11'
]);

/** Wandelt ein Tastatur-Ereignis in eine einheitliche Schreibweise um. */
function eventToCombo(e) {
  const raw = e.key;
  if (!raw || MODIFIER_KEYS.includes(raw)) return null;

  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(normalizeKeyName(raw));

  return parts.join('+');
}

function normalizeKeyName(key) {
  if (key === ' ') return 'Space';
  if (key === '=' ) return '+';   // gleiche Taste auf vielen Layouts
  if (key === '_') return '-';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Zerlegt eine Kombination. Gibt null zurück, wenn sie unlesbar ist. */
function parseCombo(combo) {
  if (typeof combo !== 'string' || !combo.trim()) return null;

  const parts = combo.split('+').map(p => p.trim()).filter(Boolean);
  // "Ctrl++" zerfällt zu ['Ctrl',''] – das '+' am Ende retten
  if (combo.endsWith('++')) parts.push('+');
  if (!parts.length) return null;

  const mods = { ctrl: false, alt: false, shift: false };
  let key = null;

  for (const part of parts) {
    if (part === 'Ctrl') mods.ctrl = true;
    else if (part === 'Alt') mods.alt = true;
    else if (part === 'Shift') mods.shift = true;
    else key = part;
  }

  if (!key) return null;
  return { ...mods, key, hasModifier: mods.ctrl || mods.alt };
}

/** Anzeigeform, z. B. ['Strg', 'Shift', 'S'] */
function comboToKeys(combo, labels = {}) {
  const parsed = parseCombo(combo);
  if (!parsed) return [combo];

  const out = [];
  if (parsed.ctrl) out.push(labels.ctrl || 'Strg');
  if (parsed.alt) out.push(labels.alt || 'Alt');
  if (parsed.shift) out.push(labels.shift || 'Shift');
  out.push(labels[parsed.key] || KEY_LABELS[parsed.key] || parsed.key);
  return out;
}

const KEY_LABELS = {
  PageUp: 'Bild ↑',
  PageDown: 'Bild ↓',
  Home: 'Pos1',
  End: 'Ende',
  Escape: 'Esc',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Leer',
  Delete: 'Entf',
  Insert: 'Einfg'
};

/* ── Welche Aktionen es gibt ─────────────────────────────────────────
   scope        : wo das Kürzel gilt ('global' | 'home' | 'journal')
   whileTyping  : darf es auslösen, während geschrieben wird?
                  false = nur wenn der Cursor nicht im Text steht
   ──────────────────────────────────────────────────────────────────── */

const SHORTCUT_ACTIONS = [
  // Allgemein
  { id: 'help',        group: 'general', labelKey: 'scHelp',        default: 'F1',           scope: 'global',  whileTyping: true },
  { id: 'save',        group: 'general', labelKey: 'scSave',        default: 'Ctrl+S',       scope: 'global',  whileTyping: true },
  { id: 'search',      group: 'general', labelKey: 'scSearch',      default: 'Ctrl+F',       scope: 'home',    whileTyping: true },

  // Navigation
  { id: 'newNotebook', group: 'nav',     labelKey: 'scNewNotebook', default: 'Ctrl+N',       scope: 'home',    whileTyping: true },
  { id: 'home',        group: 'nav',     labelKey: 'scHome',        default: 'Ctrl+H',       scope: 'journal', whileTyping: true },
  { id: 'pageDown',    group: 'nav',     labelKey: 'scPageDown',    default: 'PageDown',     scope: 'journal', whileTyping: false },
  { id: 'pageUp',      group: 'nav',     labelKey: 'scPageUp',      default: 'PageUp',       scope: 'journal', whileTyping: false },
  { id: 'firstPage',   group: 'nav',     labelKey: 'scFirstPage',   default: 'Ctrl+Home',    scope: 'journal', whileTyping: true },
  { id: 'lastPage',    group: 'nav',     labelKey: 'scLastPage',    default: 'Ctrl+End',     scope: 'journal', whileTyping: true },

  // Werkzeuge
  { id: 'toolPen1',    group: 'tools',   labelKey: 'scPen1',        default: '1',            scope: 'journal', whileTyping: false, mode: 'pen1' },
  { id: 'toolPen2',    group: 'tools',   labelKey: 'scPen2',        default: '2',            scope: 'journal', whileTyping: false, mode: 'pen2' },
  { id: 'toolHl',      group: 'tools',   labelKey: 'scHighlighter', default: '3',            scope: 'journal', whileTyping: false, mode: 'hl' },
  { id: 'toolEraser',  group: 'tools',   labelKey: 'scEraser',      default: '4',            scope: 'journal', whileTyping: false, mode: 'eraser' },
  { id: 'toolCursor',  group: 'tools',   labelKey: 'scCursor',      default: '5',            scope: 'journal', whileTyping: false, mode: 'cursor' },
  { id: 'undo',        group: 'tools',   labelKey: 'scUndo',        default: 'Ctrl+Z',       scope: 'journal', whileTyping: true },
  { id: 'redo',        group: 'tools',   labelKey: 'scRedo',        default: 'Ctrl+Y',       scope: 'journal', whileTyping: true },

  // Ansicht
  { id: 'zoomIn',      group: 'view',    labelKey: 'scZoomIn',      default: 'Ctrl++',       scope: 'journal', whileTyping: true },
  { id: 'zoomOut',     group: 'view',    labelKey: 'scZoomOut',     default: 'Ctrl+-',       scope: 'journal', whileTyping: true },
  { id: 'zoomReset',   group: 'view',    labelKey: 'scZoomReset',   default: 'Ctrl+0',       scope: 'journal', whileTyping: true },
  { id: 'formatMarks', group: 'view',    labelKey: 'scFormatMarks', default: 'Ctrl+Shift+8', scope: 'journal', whileTyping: true }
];

const SHORTCUT_GROUPS = [
  { id: 'general', labelKey: 'scGroupGeneral' },
  { id: 'nav',     labelKey: 'scGroupNav' },
  { id: 'tools',   labelKey: 'scGroupTools' },
  { id: 'view',    labelKey: 'scGroupZoom' }
];

// Fest eingebaut, nicht änderbar – nur zur Anzeige
const FIXED_SHORTCUTS = [
  { labelKey: 'scFixedEscape',  combo: 'Escape' },
  { labelKey: 'scFixedConfirm', combo: 'Enter' },
  { labelKey: 'scFixedTab',     combo: 'Tab' }
];

const Shortcuts = {
  ACTIONS: SHORTCUT_ACTIONS,
  GROUPS: SHORTCUT_GROUPS,
  FIXED: FIXED_SHORTCUTS,

  _overrides: {},   // actionId -> Kombination, nur Abweichungen vom Standard

  /** Lädt die gespeicherten Abweichungen aus den Einstellungen. */
  load() {
    const stored = Settings.get('shortcuts');
    this._overrides = {};

    if (!stored || typeof stored !== 'object') return this._overrides;

    for (const [id, combo] of Object.entries(stored)) {
      const action = this.getAction(id);
      if (!action) {
        // Kürzel für eine Aktion, die es nicht mehr gibt
        console.warn('[Shortcuts] Unbekannte Aktion in den Einstellungen, ignoriert:', id);
        continue;
      }
      if (!parseCombo(combo)) {
        console.warn('[Shortcuts] Unlesbare Kombination, Standard wird benutzt:', id, combo);
        continue;
      }
      this._overrides[id] = combo;
    }

    this._resolveDuplicates();
    return this._overrides;
  },

  /**
   * Räumt doppelte Belegungen in gespeicherten Daten auf – etwa nach einem
   * Handeingriff in der Einstellungsdatei oder wenn sich ein Standard in
   * einer neuen Version geändert hat.
   *
   * Die Standardbelegungen sind untereinander eindeutig, an einer Kollision
   * ist also immer mindestens eine geänderte Belegung beteiligt. Aufgelöst
   * wird deshalb, indem geänderte Belegungen zurückgenommen werden – eine
   * Aktion, die ihren Standard benutzt, kann ja nicht weiter ausweichen.
   */
  _resolveDuplicates() {
    // Erst alles anwenden, damit ein bewusstes Vertauschen zweier Kürzel
    // (A bekommt Bs Kombination und umgekehrt) nicht fälschlich anschlägt.
    const byCombo = new Map();
    for (const action of SHORTCUT_ACTIONS) {
      const combo = this._overrides[action.id] || action.default;
      if (!byCombo.has(combo)) byCombo.set(combo, []);
      byCombo.get(combo).push(action.id);
    }

    for (const [combo, ids] of byCombo) {
      if (ids.length < 2) continue;

      // Wer keine geänderte Belegung hat, behält die Kombination
      const withoutOverride = ids.filter(id => !this._overrides[id]);
      const keep = withoutOverride.length ? withoutOverride[0] : ids[0];

      for (const id of ids) {
        if (id === keep) continue;
        if (this._overrides[id]) {
          console.warn(`[Shortcuts] Doppelte Belegung "${combo}" bereinigt: ${id} auf Standard zurückgesetzt`);
          delete this._overrides[id];
        } else {
          console.warn(`[Shortcuts] Doppelte Belegung "${combo}": ${id} nutzt bereits den Standard`);
        }
      }
    }

    // Das Zurücknehmen kann einen neuen Konflikt erzeugen (der Standard war
    // inzwischen anderweitig vergeben). Höchstens ein paar Runden, dann ist
    // alles aufgelöst oder es gibt nichts mehr zurückzunehmen.
    const stillDuplicated = () => {
      const seen = new Set();
      for (const action of SHORTCUT_ACTIONS) {
        const combo = this._overrides[action.id] || action.default;
        if (seen.has(combo)) return true;
        seen.add(combo);
      }
      return false;
    };

    let rounds = 0;
    while (stillDuplicated() && Object.keys(this._overrides).length && rounds < SHORTCUT_ACTIONS.length) {
      rounds++;
      const before = Object.keys(this._overrides).length;
      this._resolveDuplicatesOnce();
      if (Object.keys(this._overrides).length === before) break; // nichts mehr zu tun
    }
  },

  _resolveDuplicatesOnce() {
    const byCombo = new Map();
    for (const action of SHORTCUT_ACTIONS) {
      const combo = this._overrides[action.id] || action.default;
      if (!byCombo.has(combo)) byCombo.set(combo, []);
      byCombo.get(combo).push(action.id);
    }
    for (const [, ids] of byCombo) {
      if (ids.length < 2) continue;
      const withoutOverride = ids.filter(id => !this._overrides[id]);
      const keep = withoutOverride.length ? withoutOverride[0] : ids[0];
      for (const id of ids) {
        if (id !== keep && this._overrides[id]) delete this._overrides[id];
      }
    }
  },

  getAction(id) {
    return SHORTCUT_ACTIONS.find(a => a.id === id) || null;
  },

  /** Aktuelle Kombination einer Aktion. */
  get(id) {
    const action = this.getAction(id);
    if (!action) return null;
    return this._overrides[id] || action.default;
  },

  isCustom(id) {
    return Object.prototype.hasOwnProperty.call(this._overrides, id);
  },

  /** Alle Belegungen als { combo: actionId }. */
  buildLookup() {
    const map = new Map();
    for (const action of SHORTCUT_ACTIONS) {
      map.set(this.get(action.id), action.id);
    }
    return map;
  },

  /** Welche Aktion belegt diese Kombination? null, wenn frei. */
  findConflict(combo, exceptId = null) {
    for (const action of SHORTCUT_ACTIONS) {
      if (action.id === exceptId) continue;
      if (this.get(action.id) === combo) return action;
    }
    return null;
  },

  /**
   * Prüft, ob eine Kombination für eine Aktion zulässig ist.
   * @returns {{ok: true} | {ok: false, reason: string, params?: object}}
   */
  validate(actionId, combo) {
    const action = this.getAction(actionId);
    if (!action) return { ok: false, reason: 'unknownAction' };

    const parsed = parseCombo(combo);
    if (!parsed) return { ok: false, reason: 'unreadable' };

    // Reine Modifikatoren ergeben keine Kombination
    if (MODIFIER_KEYS.includes(parsed.key)) return { ok: false, reason: 'modifierOnly' };

    // Esc bleibt überall das Abbrechen
    if (parsed.key === 'Escape') return { ok: false, reason: 'escapeReserved' };

    // Enter und Tab gehören zur Texteingabe
    if ((parsed.key === 'Enter' || parsed.key === 'Tab') && !parsed.hasModifier) {
      return { ok: false, reason: 'textKey' };
    }

    if (RESERVED_COMBOS.has(combo)) return { ok: false, reason: 'systemReserved' };

    // Kürzel, die auch beim Schreiben gelten, brauchen einen Modifikator –
    // sonst würde jeder Tastendruck im Text sie auslösen.
    if (action.whileTyping && !parsed.hasModifier && !NON_TEXT_KEYS.has(parsed.key)) {
      return { ok: false, reason: 'needsModifier' };
    }

    const conflict = this.findConflict(combo, actionId);
    if (conflict) return { ok: false, reason: 'duplicate', params: { action: conflict } };

    return { ok: true };
  },

  /**
   * Belegt eine Aktion neu. Prüft vorher und speichert.
   * @returns {Promise<{ok: boolean, reason?: string, params?: object}>}
   */
  async set(actionId, combo) {
    const check = this.validate(actionId, combo);
    if (!check.ok) return check;

    const action = this.getAction(actionId);
    if (combo === action.default) delete this._overrides[actionId];
    else this._overrides[actionId] = combo;

    try {
      await Settings.update({ shortcuts: { ...this._overrides } });
    } catch (err) {
      console.error('[Shortcuts] Speichern fehlgeschlagen:', err);
      return { ok: false, reason: 'saveFailed', params: { message: err.message } };
    }

    return { ok: true };
  },

  /** Setzt eine Aktion auf ihren Standard zurück. */
  async reset(actionId) {
    if (!this.getAction(actionId)) return false;
    delete this._overrides[actionId];
    try {
      await Settings.update({ shortcuts: { ...this._overrides } });
      return true;
    } catch (err) {
      console.error('[Shortcuts] Zurücksetzen fehlgeschlagen:', err);
      return false;
    }
  },

  /** Setzt alle Kürzel zurück. */
  async resetAll() {
    this._overrides = {};
    try {
      await Settings.update({ shortcuts: {} });
      return true;
    } catch (err) {
      console.error('[Shortcuts] Zurücksetzen fehlgeschlagen:', err);
      return false;
    }
  },

  countCustom() {
    return Object.keys(this._overrides).length;
  },

  // Hilfsfunktionen nach außen
  eventToCombo,
  parseCombo,
  comboToKeys,
  KEY_LABELS,
  NON_TEXT_KEYS,
  RESERVED_COMBOS
};

if (typeof window !== 'undefined') window.Shortcuts = Shortcuts;
