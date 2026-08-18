// Browser Mock for Electron API
if (typeof window.api === 'undefined') {
  console.log('[WebAPI] Mocking Electron API for browser environment');
  
  window.api = {
    platform: 'web',
    
    saveSettings: async (settings) => {
      localStorage.setItem('inkwells_settings', JSON.stringify(settings));
    },
    
    loadSettings: async () => {
      try { 
        return JSON.parse(localStorage.getItem('inkwells_settings')); 
      } catch(e) { return null; }
    },
    
    getDefaultSavePath: async () => 'browser-local-storage',
    
    saveToPath: async (path, data) => {
      localStorage.setItem('inkwells_file_' + path, JSON.stringify(data));
      return { success: true };
    },
    
    loadFromPath: async (path) => {
      try {
        const d = localStorage.getItem('inkwells_file_' + path);
        if (d) return { success: true, data: JSON.parse(d) };
        return { success: false, error: 'File not found' };
      } catch (e) { return { success: false, error: e.message }; }
    },
    
    fileExists: async (path) => localStorage.getItem('inkwells_file_' + path) !== null,

    moveFile: async (oldPath, newPath) => {
      const data = localStorage.getItem('inkwells_file_' + oldPath);
      if (data === null) return { success: false, error: 'File not found' };
      localStorage.setItem('inkwells_file_' + newPath, data);
      localStorage.removeItem('inkwells_file_' + oldPath);
      return { success: true };
    },

    deleteFile: async (path) => {
      localStorage.removeItem('inkwells_file_' + path);
      return { success: true };
    },

    loadRegistry: async () => {
      try { return JSON.parse(localStorage.getItem('inkwells_registry')); } catch(e){ return null; }
    },
    
    saveRegistry: async (data) => {
      localStorage.setItem('inkwells_registry', JSON.stringify(data));
      return { success: true };
    },
    
    openExternal: async (url) => {
      window.location.href = url;
    },
    
    // Google antwortet im Fragment (#access_token=…), Microsoft als Query
    // (?code=…). Früher wurde nur das Fragment beachtet – die Anmeldung mit
    // Microsoft kam im Browser deshalb nie an.
    onOAuthCallback: (cb) => {
      const hash = window.location.hash || '';
      const search = window.location.search || '';

      const hasFragmentAnswer = /(?:^|[#&])(access_token|error)=/.test(hash);
      const hasQueryAnswer = /(?:^|[?&])(code|error)=/.test(search);
      if (!hasFragmentAnswer && !hasQueryAnswer) return;

      const url = window.location.href;
      setTimeout(() => {
        cb(url);
        // Adresszeile säubern, damit ein Neuladen die Anmeldung nicht wiederholt
        history.replaceState({}, document.title, window.location.pathname);
      }, 500);
    },
    
    onFileOpen: () => {},
    pickFolder: async () => null,
    showItemInFolder: () => {},
    openPath: async () => {}
  };
}
