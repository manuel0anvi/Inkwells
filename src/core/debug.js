'use strict';

// Debug commands for console
window.journalDebug = {
  // Check if all systems are initialized
  status: function() {
    console.log('=== JOURNAL DEBUG STATUS ===');
    console.log('Settings:', Settings ? '✓' : '✗');
    console.log('  - Save Location:', Settings?.get('saveLocation'));
    console.log('  - Auto-save Enabled:', Settings?.get('autoSaveEnabled'));
    console.log('  - Auto-save Interval:', Settings?.get('autoSaveInterval'), 'seconds');
    
    console.log('\nAutoSave:', AutoSave ? '✓' : '✗');
    console.log('  - Dirty notebooks:', AutoSave?.dirtyNotebooks?.size || 0);
    console.log('  - Timer running:', AutoSave?.saveTimer ? '✓' : '✗');
    
    console.log('\nState:');
    console.log('  - Active Notebook ID:', S?.activeNbId || 'none');
    console.log('  - Total Notebooks:', S?.notebooks?.length || 0);
    
    if (S?.activeNbId) {
      const nb = getNb(S.activeNbId);
      console.log('  - Active Notebook Name:', nb?.name || 'not found');
      console.log('  - Is Dirty:', AutoSave?.isDirty(S.activeNbId));
    }
    
    console.log('\nFileManager:', FileManager_ ? '✓' : '✗');
    console.log('  - Tracked paths:', FileManager_?.notebookPaths?.size || 0);
    
    console.log('\nAPI:', window.api ? '✓' : '✗');
    console.log('===========================');
  },
  
  // Force a save right now
  save: async function() {
    console.log('[Debug] Forcing save...');
    if (!S?.activeNbId) {
      console.error('[Debug] No active notebook!');
      return;
    }
    try {
      const result = await AutoSave.saveNow(S.activeNbId);
      console.log('[Debug] Save result:', result);
      return result;
    } catch (err) {
      console.error('[Debug] Save failed:', err);
      throw err;
    }
  },
  
  // Mark current notebook as dirty
  markDirty: function() {
    if (!S?.activeNbId) {
      console.error('[Debug] No active notebook!');
      return;
    }
    console.log('[Debug] Marking notebook dirty:', S.activeNbId);
    AutoSave.markDirty(S.activeNbId);
    if (window.updateSaveStatus) {
      window.updateSaveStatus();
    }
  },
  
  // Check what would be saved
  preview: function() {
    if (!S?.activeNbId) {
      console.error('[Debug] No active notebook!');
      return;
    }
    const nb = getNb(S.activeNbId);
    if (!nb) {
      console.error('[Debug] Notebook not found!');
      return;
    }
    
    console.log('=== SAVE PREVIEW ===');
    console.log('Notebook:', nb.name);
    console.log('ID:', nb.id);
    console.log('Pages:', nb.pages?.length || 0);
    console.log('Sections:', nb.sections?.length || 0);
    
    const path = FileManager_.getNotebookPath(nb);
    console.log('Would save to:', path);
    
    console.log('\nNotebook data size:', JSON.stringify(nb).length, 'bytes');
    console.log('===================');
    
    return { notebook: nb, path };
  },
  
  // Test file operations
  testSave: async function() {
    console.log('[Debug] Testing file operations...');
    
    const testData = {
      test: true,
      timestamp: new Date().toISOString()
    };
    
    const saveLocation = Settings.get('saveLocation');
    if (!saveLocation) {
      console.error('[Debug] No save location set!');
      return;
    }
    
    const testPath = `${saveLocation}\\test_${Date.now()}.jrnl`;
    console.log('[Debug] Test path:', testPath);
    
    try {
      const result = await window.api.saveToPath(testPath, testData);
      console.log('[Debug] Test save result:', result);
      return result;
    } catch (err) {
      console.error('[Debug] Test save failed:', err);
      throw err;
    }
  }
};

console.log('[Debug] Debug commands available:');
console.log('  journalDebug.status()    - Check system status');
console.log('  journalDebug.save()      - Force save now');
console.log('  journalDebug.markDirty() - Mark as dirty');
console.log('  journalDebug.preview()   - Preview what would be saved');
console.log('  journalDebug.testSave()  - Test file operations');
