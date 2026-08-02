'use strict';

// Save Status Indicator
(function() {
  const saveStatusBtn = E('save-status');
  const saveIcon = E('save-icon');
  const saveText = E('save-text');

  let currentState = 'saved';

  // Update save status display
  function updateSaveStatus() {
    if (!saveStatusBtn) return;
    
    // Remove all state classes
    saveStatusBtn.classList.remove('saved', 'unsaved', 'error');
    
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
