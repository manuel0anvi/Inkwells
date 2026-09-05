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
    /* Der Hinweis „die letzte Seite ist noch leer“ muss weg, sobald sie
       es nicht mehr ist. Beim Schreiben rollt nichts, und ohne Rollen
       bemerkte er es nie – er bliebe stehen, bis man ihn wegrollt. */
    if (typeof pruefeLetzteLeer === 'function') pruefeLetzteLeer();
  }

  window.markCurrentNotebookDirty = markCurrentNotebookDirty;
})();
