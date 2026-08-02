'use strict';

// Integration between app changes and auto-save system
(function() {
  console.log('[Integration] Setting up change detection...');
  
  // Wird bei jeder Änderung aufgerufen – ohne Konsolenausgabe, sonst
  // entsteht bei jedem Tastendruck ein Log-Eintrag.
  function markCurrentNotebookDirty() {
    if (!S.activeNbId) return;
    AutoSave.markDirty(S.activeNbId);
    if (window.updateSaveStatus) window.updateSaveStatus();
  }

  window.markCurrentNotebookDirty = markCurrentNotebookDirty;
})();
