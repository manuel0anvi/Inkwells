'use strict';

/* ══════════════════════════════════════════════════════════════════════
   TASTENKÜRZEL – Anzeige, Änderung und Ausführung

   Die Belegungen kommen aus core/shortcuts.js. Hier wird nur noch
   nachgeschlagen, welche Aktion zu einer gedrückten Kombination gehört,
   und ausgeführt. Dadurch wirkt jede Änderung sofort, ohne Neustart.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  // Die Kürzel wohnen im Einstellungen-Dialog unter dem Reiter "Tastenkürzel"
  const settingsOverlay = E('ov-settings');
  const body = E('settings-panel-shortcuts');

  // Während der Aufnahme einer neuen Kombination darf nichts ausgelöst werden
  let capturingId = null;
  let lookup = new Map();

  function isSettingsOpen() {
    return !!settingsOverlay && settingsOverlay.style.display === 'flex';
  }

  function isShortcutsTabActive() {
    return !!body && body.style.display !== 'none';
  }

  /* ── Was die Aktionen tun ──────────────────────────────────────── */

  function isTyping(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function inJournal() {
    const view = E('view-journal');
    return !!view && view.style.display !== 'none';
  }

  function anyOverlayOpen() {
    return [...document.querySelectorAll('.overlay')].some(o => o.style.display === 'flex');
  }

  function scrollPages(direction) {
    const sc = E('pg-scroll');
    if (!sc) return;
    const pages = [...sc.querySelectorAll('.j-page')];
    if (!pages.length) return;

    const current = pages.findIndex(p => p.offsetTop + p.offsetHeight > sc.scrollTop + 8);
    const targetIdx = Math.max(0, Math.min(pages.length - 1, (current < 0 ? 0 : current) + direction));
    pages[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToEdge(toEnd) {
    const sc = E('pg-scroll');
    if (!sc) return;
    sc.scrollTo({ top: toEnd ? sc.scrollHeight : 0, behavior: 'smooth' });
  }

  // switchMode kümmert sich selbst um die Knopf-Hervorhebung und die
  // passenden Werkzeugleisten-Optionen
  function selectTool(mode) {
    if (typeof switchMode === 'function') switchMode(mode);
  }

  const RUNNERS = {
    help:        () => openShortcutsTab(),
    save:        () => saveNow(),
    // Im Heft die Suche darin, sonst die ueber alle Hefte
    search:      () => {
      if (inJournal() && typeof openNbSearch === 'function') { openNbSearch(); return; }
      const i = E('home-search-input'); if (i) { i.focus(); i.select(); }
    },
    newNotebook: () => E('btn-new-nb')?.click(),
    home:        () => E('btn-home')?.click(),
    pageDown:    () => scrollPages(1),
    pageUp:      () => scrollPages(-1),
    firstPage:   () => scrollToEdge(false),
    lastPage:    () => scrollToEdge(true),
    toolPen1:    () => selectTool('pen1'),
    toolPen2:    () => selectTool('pen2'),
    toolHl:      () => selectTool('hl'),
    toolEraser:  () => selectTool('eraser'),
    toolCursor:  () => selectTool('cursor'),
    undo:        () => { if (typeof undoPage === 'function') undoPage(); },
    redo:        () => { if (typeof redoPage === 'function') redoPage(); },
    zoomIn:      () => { if (typeof zoomIn === 'function') zoomIn(); },
    zoomOut:     () => { if (typeof zoomOut === 'function') zoomOut(); },
    zoomReset:   () => { if (typeof zoomReset === 'function') zoomReset(); },
    formatMarks: () => toggleFormatMarks()
  };

  function saveNow() {
    if (typeof syncAll === 'function') syncAll();
    if (!S.activeNbId) { toast(t('savedShort')); return; }

    /* Ein fremdes Dokument hat keine Datei – es gehoert in seinen Raum.
       ui/saveStatus.js kennt beide Wege; hier ginge sonst der Weg fuer
       die eigene Platte an und meldete am Ende „gespeichert", ohne dass
       irgendwo etwas geschrieben worden waere. */
    if (typeof isSharedNotebook === 'function' && isSharedNotebook(S.activeNbId)) {
      if (typeof window.saveNowWithFeedback === 'function') window.saveNowWithFeedback();
      return;
    }

    AutoSave.saveNow(S.activeNbId)
      .then(r => toast(r?.success === false ? t('saveError') + ': ' + r.error : t('savedShort'), r?.success === false))
      .catch(err => toast(t('saveError') + ': ' + err.message, true));
  }

  function toggleFormatMarks() {
    // Ueber window: canvas/text.js liest von dort, app.js schreibt dorthin
    window._showWhitespaceDebug = !window._showWhitespaceDebug;
    if (typeof updateWhitespaceDebugOverlays === 'function') updateWhitespaceDebugOverlays();
    toast(window._showWhitespaceDebug ? t('formattingOn') : t('formattingOff'));
  }

  /* ── Verteiler ─────────────────────────────────────────────────── */

  function refreshLookup() {
    lookup = Shortcuts.buildLookup();
  }

  document.addEventListener('keydown', (e) => {
    // Während der Aufnahme fängt der Dialog alle Tasten ab
    if (capturingId) return;

    const combo = Shortcuts.eventToCombo(e);
    if (!combo) return;

    const actionId = lookup.get(combo);
    if (!actionId) return;

    const action = Shortcuts.getAction(actionId);
    if (!action) return;

    // Die Kürzel-Übersicht ist auch bei offenem Dialog erreichbar,
    // alles andere ruht, solange ein Fenster offen ist.
    if (actionId !== 'help' && anyOverlayOpen()) return;

    if (action.scope === 'journal' && !inJournal()) return;
    if (action.scope === 'home' && inJournal()) return;
    if (!action.whileTyping && isTyping(e.target)) return;

    const run = RUNNERS[actionId];
    if (!run) return;

    e.preventDefault();
    try {
      run();
    } catch (err) {
      console.error('[Shortcuts] Aktion fehlgeschlagen:', actionId, err);
      toast((t('scActionFailed') || 'Kürzel fehlgeschlagen: {msg}').replace('{msg}', err.message), true);
    }
  });

  /* ── Übersicht ─────────────────────────────────────────────────── */

  function keyLabels() {
    return { ctrl: t('scKeyCtrl') || 'Strg', alt: 'Alt', shift: 'Shift' };
  }

  function renderKeys(container, combo) {
    container.innerHTML = '';
    const parts = Shortcuts.comboToKeys(combo, keyLabels());
    parts.forEach((k, i) => {
      if (i > 0) {
        const plus = document.createElement('span');
        plus.className = 'sc-sep';
        plus.textContent = '+';
        container.appendChild(plus);
      }
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      container.appendChild(kbd);
    });
  }

  function render() {
    body.innerHTML = '';

    for (const group of Shortcuts.GROUPS) {
      const actions = Shortcuts.ACTIONS.filter(a => a.group === group.id);
      if (!actions.length) continue;

      const section = document.createElement('div');
      section.className = 'sc-group';

      const h = document.createElement('h4');
      h.className = 'sc-group-title';
      h.textContent = t(group.labelKey) || group.id;
      section.appendChild(h);

      for (const action of actions) section.appendChild(renderRow(action));
      body.appendChild(section);
    }

    // Fest eingebaute Tasten, nur zur Information
    const fixed = document.createElement('div');
    fixed.className = 'sc-group';
    const fh = document.createElement('h4');
    fh.className = 'sc-group-title';
    fh.textContent = t('scGroupFixed') || 'Fest eingebaut';
    fixed.appendChild(fh);

    for (const item of Shortcuts.FIXED) {
      const row = document.createElement('div');
      row.className = 'sc-row';

      const label = document.createElement('span');
      label.className = 'sc-label';
      label.textContent = t(item.labelKey) || item.labelKey;

      const keys = document.createElement('span');
      keys.className = 'sc-keys sc-keys-fixed';
      renderKeys(keys, item.combo);

      row.append(label, keys);
      fixed.appendChild(row);
    }
    body.appendChild(fixed);

    renderFooter();
  }

  function renderRow(action) {
    const row = document.createElement('div');
    row.className = 'sc-row';
    row.dataset.actionId = action.id;

    const label = document.createElement('span');
    label.className = 'sc-label';
    label.textContent = t(action.labelKey) || action.id;
    if (Shortcuts.isCustom(action.id)) {
      const dot = document.createElement('span');
      dot.className = 'sc-changed-dot';
      dot.title = t('scChanged') || 'Geändert';
      label.appendChild(dot);
    }

    const right = document.createElement('span');
    right.className = 'sc-row-right';

    const btn = document.createElement('button');
    btn.className = 'sc-keys sc-keys-btn';
    btn.type = 'button';
    btn.title = t('scClickToChange') || 'Klicken, um zu ändern';
    renderKeys(btn, Shortcuts.get(action.id));
    btn.addEventListener('click', () => startCapture(action, btn, row));
    right.appendChild(btn);

    if (Shortcuts.isCustom(action.id)) {
      const undoBtn = document.createElement('button');
      undoBtn.className = 'sc-reset-btn';
      undoBtn.type = 'button';
      undoBtn.textContent = '↺';
      undoBtn.title = t('scResetOne') || 'Auf Standard zurücksetzen';
      undoBtn.addEventListener('click', async () => {
        await Shortcuts.reset(action.id);
        refreshLookup();
        render();
      });
      right.appendChild(undoBtn);
    }

    row.append(label, right);
    return row;
  }

  function renderFooter() {
    const footer = document.createElement('div');
    footer.className = 'sc-footer';

    const hint = document.createElement('p');
    hint.className = 'sc-hint';
    hint.textContent = t('scHint')
      || 'Klicke auf eine Tastenkombination und drücke die neue. Esc bricht ab.';
    footer.appendChild(hint);

    const custom = Shortcuts.countCustom();
    if (custom > 0) {
      const resetAll = document.createElement('button');
      resetAll.className = 'settings-btn';
      resetAll.type = 'button';
      resetAll.textContent = (t('scResetAll') || 'Alle zurücksetzen ({n})').replace('{n}', custom);
      resetAll.addEventListener('click', async () => {
        const ok = await showConfirm(t('scResetAllConfirm')
          || 'Alle Tastenkürzel auf die Standardbelegung zurücksetzen?');
        if (!ok) return;
        await Shortcuts.resetAll();
        refreshLookup();
        render();
        toast(t('scResetAllDone') || 'Tastenkürzel zurückgesetzt.');
      });
      footer.appendChild(resetAll);
    }

    body.appendChild(footer);
  }

  /* ── Neue Kombination aufnehmen ────────────────────────────────── */

  function showRowError(row, message) {
    let err = row.querySelector('.sc-error');
    if (!err) {
      err = document.createElement('div');
      err.className = 'sc-error';
      row.appendChild(err);
    }
    err.textContent = message;
    err.style.display = 'block';
  }

  function clearRowError(row) {
    const err = row.querySelector('.sc-error');
    if (err) err.style.display = 'none';
  }

  function errorMessage(result) {
    const map = {
      unreadable:     t('scErrUnreadable')     || 'Diese Taste lässt sich nicht verwenden.',
      modifierOnly:   t('scErrModifierOnly')   || 'Bitte zusätzlich eine normale Taste drücken.',
      escapeReserved: t('scErrEscape')         || 'Esc bleibt zum Abbrechen reserviert.',
      textKey:        t('scErrTextKey')        || 'Enter und Tab werden zum Schreiben gebraucht.',
      systemReserved: t('scErrSystem')         || 'Diese Kombination ist vom System belegt.',
      needsModifier:  t('scErrNeedsModifier')  || 'Dieses Kürzel gilt auch beim Schreiben – bitte mit Strg oder Alt kombinieren.',
      unknownAction:  t('scErrUnknown')        || 'Unbekannte Aktion.',
      saveFailed:     t('scErrSaveFailed')     || 'Konnte nicht gespeichert werden.'
    };

    if (result.reason === 'duplicate') {
      const other = t(result.params.action.labelKey) || result.params.action.id;
      return (t('scErrDuplicate') || 'Schon belegt durch „{name}“.').replace('{name}', other);
    }

    return map[result.reason] || (t('scErrUnreadable') || 'Ungültige Kombination.');
  }

  function startCapture(action, btn, row) {
    if (capturingId) return;

    capturingId = action.id;
    clearRowError(row);

    btn.classList.add('capturing');
    btn.innerHTML = '';
    const hint = document.createElement('span');
    hint.className = 'sc-capture-hint';
    hint.textContent = t('scPressKeys') || 'Taste drücken…';
    btn.appendChild(hint);

    const finish = (rerender) => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onCancel);
      capturingId = null;
      if (rerender) { refreshLookup(); render(); }
      else { btn.classList.remove('capturing'); renderKeys(btn, Shortcuts.get(action.id)); }
    };

    const onCancel = () => finish(false);

    const onKey = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Reine Modifikatoren: weiter warten, nicht als Fehler werten
      if (!e.key || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return;

      if (e.key === 'Escape') { finish(false); return; }

      const combo = Shortcuts.eventToCombo(e);
      if (!combo) { showRowError(row, errorMessage({ reason: 'unreadable' })); finish(false); return; }

      // Gleiche Kombination wie bisher: einfach abbrechen
      if (combo === Shortcuts.get(action.id)) { finish(false); return; }

      const result = await Shortcuts.set(action.id, combo);
      if (!result.ok) {
        finish(false);
        showRowError(row, errorMessage(result));
        return;
      }

      finish(true);
      toast((t('scSaved') || 'Kürzel gespeichert: {combo}')
        .replace('{combo}', Shortcuts.comboToKeys(combo, keyLabels()).join('+')));
    };

    // capture:true, damit die Aufnahme vor allen anderen Handlern greift
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onCancel);
  }

  /* ── Reiter in den Einstellungen ───────────────────────────────── */

  const tabs = [...document.querySelectorAll('.settings-tab')];

  function showPanel(name) {
    for (const tab of tabs) {
      const active = tab.dataset.panel === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }

    const general = E('settings-panel-general');
    if (general) general.style.display = name === 'general' ? '' : 'none';
    if (body) body.style.display = name === 'shortcuts' ? '' : 'none';

    // Erst beim Öffnen zeichnen – die Liste ändert sich ja nur hier
    if (name === 'shortcuts') render();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      if (capturingId) return;   // erst die laufende Aufnahme beenden
      showPanel(tab.dataset.panel);
    });
  }

  // F1 öffnet die Einstellungen direkt auf dem Kürzel-Reiter
  function openShortcutsTab() {
    if (isSettingsOpen() && isShortcutsTabActive()) {
      settingsOverlay.style.display = 'none';
      return;
    }
    E('btn-settings')?.click();          // lädt die Einstellungen und öffnet den Dialog
    if (!isSettingsOpen()) settingsOverlay.style.display = 'flex';
    showPanel('shortcuts');
  }

  window.openShortcutsOverlay = openShortcutsTab;
  window.showSettingsPanel = showPanel;

  // Beim Schließen wieder auf den ersten Reiter stellen
  E('settings-close')?.addEventListener('click', () => showPanel('general'));
  E('settings-ok')?.addEventListener('click', () => showPanel('general'));

  window.addEventListener('language-changed', () => {
    if (isSettingsOpen() && isShortcutsTabActive()) render();
  });

  // Belegungen laden, sobald die Einstellungen da sind
  function init() {
    try {
      Shortcuts.load();
    } catch (err) {
      console.error('[Shortcuts] Laden fehlgeschlagen, Standard wird benutzt:', err);
    }
    refreshLookup();
  }

  if (window.Settings && Settings.getAll && Settings.get('shortcuts') !== undefined) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });

  window.reloadShortcuts = init;
})();
