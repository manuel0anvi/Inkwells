'use strict';

// Initialize all systems after DOM and core modules are loaded
(async function initializeApp() {
  console.log('[Init] Initializing Journal systems...');

  // Wait for DOM to be fully loaded
  if (document.readyState !== 'complete') {
    console.log('[Init] Waiting for DOM load...');
    await new Promise(resolve => window.addEventListener('load', resolve));
    console.log('[Init] DOM loaded');
  }

  // Wait for window.api to be available (from preload)
  let apiWaitAttempts = 0;
  while (!window.api && apiWaitAttempts < 50) {
    await new Promise(resolve => setTimeout(resolve, 100));
    apiWaitAttempts++;
  }
  
  if (!window.api) {
    console.error('[Init] ✗ window.api not available after waiting!');
    return;
  }
  console.log('[Init] window.api is available');

  // Initialize settings
  try {
    await Settings.init();
    console.log('[Init] ✓ Settings initialized');
    console.log('[Init] Save location:', Settings.get('saveLocation'));
  } catch (err) {
    console.error('[Init] ✗ Settings init failed:', err);
  }

  // Initialize language/translations
  try {
    let lang;
    // Only auto-detect on fresh installs (no saved settings file)
    if (typeof Settings.hasSavedSettings === 'function' && !Settings.hasSavedSettings()) {
      const sys = (navigator.language || navigator.userLanguage || 'en').slice(0,2).toLowerCase();
      lang = ['de','it','en'].includes(sys) ? sys : 'en';
      Settings.settings.language = lang;
      try { await Settings.save(); } catch (e) { console.warn('[Init] Could not persist detected language', e); }
      console.log('[Init] Detected system language (first run):', lang);
    } else {
      // Use stored preference or fallback to 'en'
      lang = Settings.get('language') || 'en';
    }
    setLanguage(lang);
    console.log('[Init] ✓ Language set to:', lang);
  } catch (err) {
    console.error('[Init] ✗ Language init failed:', err);
  }

  // Load notebooks from registry
  try {
    await loadNotebooksFromRegistry();
    console.log('[Init] ✓ Notebooks loaded from registry');
  } catch (err) {
    console.error('[Init] ✗ Failed to load notebooks from registry:', err);
  }

  // Tastenkürzel laden – erst jetzt, weil dafür die Einstellungen dasein müssen
  try {
    if (typeof window.reloadShortcuts === 'function') {
      window.reloadShortcuts();
      console.log('[Init] ✓ Tastenkürzel geladen (' + Shortcuts.countCustom() + ' geändert)');
    }
  } catch (err) {
    console.error('[Init] ✗ Tastenkürzel konnten nicht geladen werden:', err);
  }

  // Abgelaufene Papierkorb-Einträge aufräumen (30 Tage je Heft)
  try {
    const purged = await Trash.purgeExpired();
    if (purged > 0) {
      console.log('[Init] ✓', purged, 'abgelaufene Hefte aus dem Papierkorb entfernt');
    }
  } catch (err) {
    console.error('[Init] ✗ Papierkorb-Aufräumen fehlgeschlagen:', err);
  }

  // Initialize auto-save
  try {
    AutoSave.init();
    console.log('[Init] ✓ Auto-save initialized');
    console.log('[Init] Auto-save enabled:', Settings.get('autoSaveEnabled'));
  } catch (err) {
    console.error('[Init] ✗ Auto-save init failed:', err);
  }

  // Initialize cloud sync (if module present)
  try {
    if (typeof CloudSync_ !== 'undefined' && CloudSync_) {
      await CloudSync_.init();
      console.log('[Init] ✓ CloudSync initialized');
    }
  } catch (err) {
    console.error('[Init] ✗ CloudSync init failed:', err);
  }

  /* Firebase muss wissen, wer angemeldet ist – sonst bleibt der
     Freigabe-Dialog gesperrt. Das ID-Token dafür wird beim Anmelden
     eingesammelt; wer schon vorher angemeldet war, hatte nie eines.
     Deshalb hier still nachholen. Bewusst ohne await, damit der Start
     nicht auf die Cloud wartet. */
  try {
    if (typeof CloudSync_ !== 'undefined' && CloudSync_) {
      CloudSync_.ensureFirebaseIdentity().then(ok => {
        console.log('[Init] Firebase-Kennung:', ok ? 'vorhanden' : ('fehlt (' + (CloudSync_.identityProblem || '?') + ')'));
        if (ok) document.dispatchEvent(new CustomEvent('inkwell-identity-changed'));
      }).catch(err => console.warn('[Init] Firebase-Kennung:', err?.message || err));
    }
  } catch (err) {
    console.error('[Init] ✗ Firebase-Kennung fehlgeschlagen:', err);
  }

  // Sitzung im Hintergrund verloren? Dann jetzt darauf hinweisen, statt es
  // erst auffallen zu lassen, wenn tagelang nichts mehr gesichert wurde.
  try {
    if (typeof window.checkSignedOutOnStartup === 'function') {
      await window.checkSignedOutOnStartup();
    }
  } catch (err) {
    console.error('[Init] ✗ Abgemeldet-Hinweis fehlgeschlagen:', err);
  }

  // Set up file open handler (for "Open with" functionality)
  try {
    if (window.api.onOpenFile) {
      window.api.onOpenFile(async (filePath) => {
        console.log('[Init] Received open-file event:', filePath);
        await openNotebookFromFile(filePath);
      });
      console.log('[Init] ✓ File open handler registered');
    }
  } catch (err) {
    console.error('[Init] ✗ File open handler failed:', err);
  }

  // Beim Schließen alles Offene speichern.
  // Bewusst NICHT über beforeunload: dort läuft asynchrones Speichern nicht
  // mehr zu Ende, und ein preventDefault dort verhindert in Electron das
  // Schließen ganz. Stattdessen fragt der Hauptprozess hier an und wartet
  // auf die Bestätigung (mit Zeitgrenze, siehe main.js).
  if (window.api.onBeforeQuit) {
    window.api.onBeforeQuit(async () => {
      try {
        // 1. Lokal speichern – das hat Vorrang und geht schnell
        if (AutoSave.dirtyNotebooks.size > 0) {
          console.log('[Init] Speichere', AutoSave.dirtyNotebooks.size, 'Notizbuch/Notizbücher vor dem Schließen');
          await AutoSave.saveNow();
        }
      } catch (err) {
        console.error('[Init] Speichern vor dem Schließen fehlgeschlagen:', err);
      }

      try {
        /* Wo man zuletzt gelesen hat. Wird sonst verzoegert geschrieben –
           beim Beenden bliebe das letzte Stueck sonst liegen. */
        if (typeof flushNotebookView === 'function') await flushNotebookView();
      } catch (err) {
        console.warn('[Init] Merkstelle nicht geschrieben:', err);
      }

      try {
        // Ein offenes geteiltes Dokument hat keine Datei – es wird in den
        // Raum zurückgeschrieben und taucht deshalb in AutoSave gar nicht auf.
        if (S.sharedDoc && !S.readOnly && typeof window.flushSharedDocSave === 'function') {
          await Promise.race([
            window.flushSharedDocSave(),
            new Promise(resolve => setTimeout(resolve, 3000))
          ]);
        }
      } catch (err) {
        console.warn('[Init] Geteiltes Dokument nicht vollständig gesichert:', err);
      }

      try {
        // 2. Cloud-Upload noch versuchen, aber das Schließen nicht blockieren.
        //    Was nicht mehr durchgeht, holt der nächste Start nach.
        if (typeof CloudSync_ !== 'undefined' && CloudSync_) {
          await Promise.race([
            CloudSync_.flushPending(),
            new Promise(resolve => setTimeout(resolve, 3000))
          ]);
        }
      } catch (err) {
        console.warn('[Init] Cloud-Upload vor dem Schließen unvollständig:', err);
      }

      try {
        /* >>> Den Raum ORDENTLICH verlassen <<<
           Ohne das reißt beim Zumachen einfach die Leitung ab, und der
           Server führt den hinterlegten Auftrag aus: beim Besitzer bleibt
           die Marke lost = 1 stehen. Für alle Eingeladenen sieht das aus
           wie ein Absturz, und sie dürfen nur noch lesen – obwohl er die
           App bloß zugemacht hat.

           leave() hebt den Auftrag auf und räumt den Eintrag weg. Kurze
           Zeitgrenze: das Schließen darf daran nicht hängen bleiben. */
        if (window.Collab?.isLive?.()) {
          await Promise.race([
            window.Collab.stop(),
            new Promise(resolve => setTimeout(resolve, 1500))
          ]);
        }
      } catch (err) {
        console.warn('[Init] Raum nicht sauber verlassen:', err);
      }

      window.api.confirmQuit();
    });
    console.log('[Init] ✓ Quit-Handler registriert');
  }

  console.log('[Init] ✓ All systems initialized successfully');
})();

// Load all notebooks from registry on startup
async function loadNotebooksFromRegistry() {
  const entries = await Registry.load();
  console.log('[Init] Registry has', entries.length, 'entries');
  
  const toRemove = [];
  
  for (const entry of entries) {
    try {
      console.log('[Init] Checking entry:', entry.name, 'at', entry.path);
      
      // Check if file still exists
      const exists = await window.api.fileExists(entry.path);
      if (!exists) {
        console.log('[Init] File not found, will remove:', entry.path);
        toRemove.push(entry.id);
        continue;
      }
      
      // Load the notebook
      const result = await window.api.loadFromPath(entry.path);
      if (result.success && result.data?.notebooks?.length > 0) {
        const nb = result.data.notebooks[0];
        
        // Check if already in S.notebooks (by id)
        const existing = S.notebooks.find(n => n.id === nb.id);
        if (!existing) {
          // Abschnitte sind Etiketten – ein aelteres Heft wird hier umgestellt
          normalizeNotebook(nb);
          S.notebooks.push(nb);
          console.log('[Init] ✓ Loaded notebook:', nb.name);
        }
      } else {
        console.log('[Init] Failed to load notebook data, removing:', entry.path);
        toRemove.push(entry.id);
      }
    } catch (err) {
      console.error('[Init] Error loading notebook:', entry.path, err);
      toRemove.push(entry.id);
    }
  }
  
  // Remove entries for missing/invalid files
  for (const id of toRemove) {
    await Registry.remove(id);
  }
  
  // Refresh the home grid if visible
  if (typeof renderHomeGrid === 'function') {
    renderHomeGrid();
  }
}

// Open a notebook from a .jrnl file path
async function openNotebookFromFile(filePath) {
  console.log('[Init] Opening notebook from file:', filePath);
  
  try {
    const result = await window.api.loadFromPath(filePath);
    
    if (!result.success || !result.data?.notebooks?.length) {
      console.error('[Init] Failed to load notebook:', result.error);
      toast(t('saveError'), true);
      return;
    }
    
    const loadedNb = result.data.notebooks[0];
    console.log('[Init] Loaded notebook:', loadedNb.name, 'id:', loadedNb.id);
    
    // Check if notebook already exists by ID
    const existingIdx = S.notebooks.findIndex(nb => nb.id === loadedNb.id);
    
    if (existingIdx !== -1) {
      // Update existing notebook
      S.notebooks[existingIdx] = loadedNb;
      console.log('[Init] Updated existing notebook');
      
      // Update registry with new path if changed
      await Registry.add(loadedNb, filePath);
    } else {
      // Add new notebook
      normalizeNotebook(loadedNb);
      S.notebooks.push(loadedNb);
      console.log('[Init] Added new notebook to S.notebooks');
      
      // Add to registry
      await Registry.add(loadedNb, filePath);
    }
    
    // Refresh home grid
    if (typeof renderHomeGrid === 'function') {
      renderHomeGrid();
    }
    
    // Open the notebook
    S.activeNbId = loadedNb.id;
    if (typeof openNotebook === 'function') {
      openNotebook(loadedNb.id);
    }
    
    toast(t('notebookLoaded'));
    
  } catch (err) {
    console.error('[Init] Error opening notebook file:', err);
    toast(t('saveError'), true);
  }
}

// Make functions globally available
window.loadNotebooksFromRegistry = loadNotebooksFromRegistry;
window.openNotebookFromFile = openNotebookFromFile;
