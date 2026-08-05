'use strict';

// Save Status Indicator
(function() {
  const saveStatusBtn = E('save-status');
  const saveIcon = E('save-icon');
  const saveText = E('save-text');

  let currentState = 'saved';

  /* ── Wartet dieses Heft noch auf die Cloud? ───────────────────────
     Nur wenn die Cloud-Sicherung überhaupt eingeschaltet ist. Wer nicht
     angemeldet ist, soll kein blaues „noch nicht oben" sehen – bei ihm
     ist örtlich gespeichert das Ziel und nicht die halbe Strecke.

     Zwei Anzeichen, und es genügt eines:
       · das Heft steht in der Warteschlange
       · der zuletzt hochgeladene Stand ist älter als der jetzige
     Das zweite fängt die Zeit ab, in der ohne Netz gearbeitet wurde –
     danach ist die Warteschlange zwar gefüllt, aber ein Neustart
     dazwischen hat sie schon einmal überlebt.
     ─────────────────────────────────────────────────────────────── */
  function waitingForCloud(nbId) {
    if (!nbId) return false;
    if (typeof CloudSync_ === 'undefined' || !CloudSync_) return false;
    if (!Settings.get('cloudEnabled') || !CloudSync_.isAuthenticated()) return false;

    // Ein fremdes Dokument bekommt keine Datei und keinen Cloud-Upload –
    // es lebt im Raum und wird von ui/sharedDocs.js gesichert.
    if (typeof isSharedNotebook === 'function' && isSharedNotebook(nbId)) return false;

    // syncQueue enthält jetzt Objekte {nbId, nbName, action, ...} –
    // oder im alten Format noch reine Strings. Beides abfangen.
    const inQueue = (CloudSync_.syncQueue || []).some(e => {
      return (typeof e === 'string' ? e : e.nbId) === nbId;
    });
    if (inQueue) return true;

    const nb = getNb(nbId);
    if (!nb) return false;
    if (!nb.syncedAt) return true;
    return Date.parse(nb.updatedAt || 0) > Date.parse(nb.syncedAt);
  }

  // Update save status display
  function updateSaveStatus() {
    if (!saveStatusBtn) return;

    // Remove all state classes
    saveStatusBtn.classList.remove('saved', 'unsaved', 'error', 'local-only');

    let displayState = 'saved';
    let icon = '✓';
    let text = t('saved');
    let title = t('saved');

    const isDirty = S.activeNbId && AutoSave.isDirty(S.activeNbId);

    if (isDirty) {
      displayState = 'unsaved';
      icon = '●';
      text = t('unsaved');
      title = t('unsaved');
    } else if (waitingForCloud(S.activeNbId)) {
      displayState = 'local-only';
      icon = '●';
      text = t('savedLocalOnly');
      title = t('savedLocalOnlyHint');
    }

    saveStatusBtn.classList.add(displayState);
    saveIcon.textContent = icon;
    saveText.textContent = text;
    saveStatusBtn.title = title;
  }

  // Manual save on click
  saveStatusBtn.addEventListener('click', async () => {
    console.log('[SaveStatus] Manual save clicked');
    console.log('[SaveStatus] Active notebook ID:', S.activeNbId);
    console.log('[SaveStatus] Is dirty:', AutoSave.isDirty(S.activeNbId));
    console.log('[SaveStatus] All notebooks:', S.notebooks ? S.notebooks.length : 0);
    
    if (!S.activeNbId) {
      console.error('[SaveStatus] No active notebook!');
      toast(t('noActiveNotebook'), true);
      return;
    }
    
    const nb = getNb(S.activeNbId);
    if (!nb) {
      console.error('[SaveStatus] Notebook not found!', S.activeNbId);
      toast(t('notebookNotFound'), true);
      return;
    }
    
    console.log('[SaveStatus] Found notebook:', nb.name);
    console.log('[SaveStatus] Save location:', Settings.get('saveLocation'));
    
    try {
      const result = await AutoSave.saveNow(S.activeNbId);
      console.log('[SaveStatus] Save result:', result);
      
      if (result.success) {
        toast(t('notebookSaved'));
        updateSaveStatus();
      } else {
        toast(t('saveError') + ': ' + result.error, true);
      }
    } catch (err) {
      console.error('[SaveStatus] Manual save exception:', err);
      toast(t('saveError'), true);
    }
  });

  // Listen to auto-save state changes
  AutoSave.onChange((state) => {
    updateSaveStatus();
  });

  // Listen to settings changes
  Settings.onChange(() => {
    updateSaveStatus();
  });

  // Der Weg von „örtlich gesichert" nach „auch oben" geht an AutoSave
  // vorbei – ohne diesen Hörer bliebe der blaue Punkt stehen, bis das
  // nächste Mal etwas getippt wird.
  if (window.CloudSync_ && typeof CloudSync_.onChange === 'function') {
    CloudSync_.onChange(() => updateSaveStatus());
  }

  // Update on active notebook change
  const originalOpenNb = window.openNotebook;
  if (originalOpenNb) {
    window.openNotebook = function(...args) {
      const result = originalOpenNb.apply(this, args);
      updateSaveStatus();
      return result;
    };
  }

  // Initial update
  updateSaveStatus();

  // Export for use in other modules
  window.updateSaveStatus = updateSaveStatus;
})();
