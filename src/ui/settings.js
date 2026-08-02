'use strict';

// Settings UI Management
(function() {
  const settingsOverlay = E('ov-settings');
  const settingsBtn = E('btn-settings');
  const settingsClose = E('settings-close');
  const settingsOk = E('settings-ok');
  
  const languageSelect = E('language-select');
  const saveLocationDisplay = E('save-location-display');
  const btnPickSaveLocation = E('btn-pick-save-location');
  
  const autosaveEnabled = E('autosave-enabled');
  const autosaveInterval = E('autosave-interval');
  const autosaveIntervalRow = E('autosave-interval-row');
  const settingsVersion = E('settings-version');
  // Cloud UI elements
  const cloudEnabledChk = E('cloud-enabled');
  const cloudConfigRow = E('cloud-config-row');
  const cloudGoogleBtn = E('cloud-google-signin');
  const cloudSignOutBtn = E('cloud-signout');
  const cloudStatus = E('cloud-status');
  const cloudSignupForm = E('cloud-signup-form');

  let _pendingNewLocation = null;

  // Open settings modal
  settingsBtn.addEventListener('click', () => {
    loadSettingsToUI();
    settingsOverlay.style.display = 'flex';
  });

  // Close settings modal
  const closeSettings = () => {
    settingsOverlay.style.display = 'none';
  };

  settingsClose.addEventListener('click', closeSettings);
  settingsOk.addEventListener('click', async () => {
    await saveSettingsFromUI();
    closeSettings();
    toast(t('settingsSaved'));
  });

  // Close on overlay click
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  // Pick save location - with migration dialog
  btnPickSaveLocation.addEventListener('click', async () => {
    const folder = await window.api.pickFolder();
    if (!folder) return;
    
    // Update display immediately
    saveLocationDisplay.value = folder;
    
    const currentLocation = Settings.get('saveLocation');
    const hasNotebooks = S.notebooks && S.notebooks.length > 0;
    
    // If same folder or no notebooks, just save it
    if (folder === currentLocation || !hasNotebooks) {
      await Settings.update({ saveLocation: folder });
      return;
    }
    
    // Show migration dialog (display already updated)
    _pendingNewLocation = folder;
    E('ov-migration').style.display = 'flex';
  });
  
  // Migration dialog handlers
  E('migration-keep').addEventListener('click', async () => {
    E('ov-migration').style.display = 'none';
    if (_pendingNewLocation) {
      // Save immediately
      await Settings.update({ saveLocation: _pendingNewLocation });
      _pendingNewLocation = null;
    }
  });
  
  E('migration-transfer').addEventListener('click', async () => {
    E('ov-migration').style.display = 'none';
    if (!_pendingNewLocation) return;
    
    const newLocation = _pendingNewLocation;
    const oldLocation = Settings.get('saveLocation');
    _pendingNewLocation = null;
    
    toast(t('transferring'));
    
    try {
      // Use S.notebooks directly - they're already loaded in memory
      console.log('[Settings] Transferring', S.notebooks.length, 'notebooks from', oldLocation, 'to', newLocation);
      
      let transferred = 0;
      for (const nb of S.notebooks) {
        // Get current path from registry or generate from old location
        const registryEntry = Registry.find(nb.id);
        const currentPath = registryEntry?.path || (oldLocation + '\\' + nb.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() + '.jrnl');
        
        // Get filename and create new path
        const fileName = currentPath.split('\\').pop();
        const newPath = newLocation + '\\' + fileName;
        
        console.log('[Settings] Moving:', currentPath, '->', newPath);
        
        // Check if source file exists
        const exists = await window.api.fileExists(currentPath);
        if (!exists) {
          console.log('[Settings] Source not found, saving fresh to new location');
          // Save notebook to new location instead
          const saveData = { notebooks: [nb] };
          const result = await window.api.saveToPath(newPath, saveData);
          if (result.success) {
            await Registry.add(nb, newPath);
            transferred++;
            console.log('[Settings] ✓ Saved fresh:', fileName);
          }
          continue;
        }
        
        // Move the file
        const result = await window.api.moveFile(currentPath, newPath);
        if (result.success) {
          // Update registry with new path
          await Registry.add(nb, newPath);
          transferred++;
          console.log('[Settings] ✓ Moved:', fileName);
        } else {
          console.error('[Settings] ✗ Failed to move:', currentPath, result.error);
        }
      }
      
      // Update setting immediately
      await Settings.update({ saveLocation: newLocation });
      
      console.log('[Settings] Transfer complete:', transferred, 'files moved');
      toast(t('transferComplete'));
    } catch (err) {
      console.error('[Settings] Transfer error:', err);
      toast(t('saveError'), true);
    }
  });
  
  // Close migration dialog on overlay click
  E('ov-migration').addEventListener('click', (e) => {
    if (e.target.id === 'ov-migration') {
      E('ov-migration').style.display = 'none';
      _pendingNewLocation = null;
    }
  });

  // Auto-save toggle
  autosaveEnabled.addEventListener('change', () => {
    autosaveIntervalRow.style.display = autosaveEnabled.checked ? 'flex' : 'none';
  });

  // Cloud toggle
  if (cloudEnabledChk) {
    cloudEnabledChk.addEventListener('change', () => {
      cloudConfigRow.style.display = cloudEnabledChk.checked ? 'flex' : 'none';
    });
  }

  if (cloudGoogleBtn) {
    cloudGoogleBtn.addEventListener('click', async () => {
      try {
        await window.CloudSync_.signInWithOAuth('google');
        toast('Anmeldung im Browser gestartet...');
      } catch (err) {
        toast('Fehler beim Starten der Google-Anmeldung: ' + err.message);
      }
    });
  }

  if (cloudSignOutBtn) {
    cloudSignOutBtn.addEventListener('click', async () => {
      await window.CloudSync_.signOut();
      refreshCloudUI();
      toast('Abgemeldet');
    });
  }

  // Language change - apply immediately for preview
  languageSelect.addEventListener('change', () => {
    setLanguage(languageSelect.value);
  });

  // Load settings into UI
  function loadSettingsToUI() {
    const settings = Settings.getAll();
    
    languageSelect.value = settings.language || 'de';
    saveLocationDisplay.value = settings.saveLocation || '';
    autosaveEnabled.checked = settings.autoSaveEnabled;
    autosaveInterval.value = settings.autoSaveInterval;
    autosaveIntervalRow.style.display = settings.autoSaveEnabled ? 'flex' : 'none';

    if (cloudEnabledChk) cloudEnabledChk.checked = !!settings.cloudEnabled;
    if (cloudConfigRow) cloudConfigRow.style.display = settings.cloudEnabled ? 'flex' : 'none';
    
    refreshCloudUI();

    if (settingsVersion && window.api?.getAppVersion) {
      window.api.getAppVersion().then((version) => {
        settingsVersion.textContent = `Version ${version}`;
      }).catch(() => {
        settingsVersion.textContent = '';
      });
    }
  }
  
  function refreshCloudUI() {
    if (!cloudSignupForm || !cloudSignOutBtn || !cloudStatus || !window.CloudSync_) return;
    const isAuth = window.CloudSync_.isAuthenticated();
    if (isAuth) {
      cloudSignupForm.style.display = 'none';
      if (cloudGoogleBtn) cloudGoogleBtn.style.display = 'none';
      cloudSignOutBtn.style.display = 'block';
      
      const session = window.CloudSync_.getSession();
      const mail = session?.userEmail || Settings.get('cloudEmail') || 'Nutzer';
      cloudStatus.textContent = `Mit Google angemeldet als: ${mail}`;
      // Let it try to sync now that we are looking
      window.CloudSync_.refreshRemote().catch(()=>{});
    } else {
      cloudSignupForm.style.display = 'flex';
      if (cloudGoogleBtn) cloudGoogleBtn.style.display = 'block';
      cloudSignOutBtn.style.display = 'none';
      cloudStatus.textContent = 'Nicht angemeldet.';
    }
  }

  // Save settings from UI
  async function saveSettingsFromUI() {
    const updates = {
      language: languageSelect.value,
      saveLocation: saveLocationDisplay.value || null,
      autoSaveEnabled: autosaveEnabled.checked,
      autoSaveInterval: parseInt(autosaveInterval.value)
    };
    
    // Cloud settings
    if (cloudEnabledChk) updates.cloudEnabled = !!cloudEnabledChk.checked;

    await Settings.update(updates);

    // If cloud enabled, init CloudSync
    try {
      if (typeof CloudSync_ !== 'undefined' && CloudSync_) {
        await CloudSync_.init();
      }
    } catch (e) {
      console.warn('[Settings] Cloud init error:', e);
    }
  }

  // Sign in/out handlers (bound once)
  if (cloudGoogleBtn) {
    cloudGoogleBtn.addEventListener('click', async () => {
      try {
        cloudStatus.textContent = 'Öffne Google-Anmeldung…';
        await Settings.update({ cloudEnabled: true });
        await CloudSync_.init();
        await CloudSync_.signInWithOAuth('google');
        cloudStatus.textContent = 'Ein neues Fenster wurde geöffnet. Schließe das Login ab und kehre zurück.';
      } catch (err) {
        console.error('[Settings] Google sign in failed:', err);
        cloudStatus.textContent = 'Google-Anmeldung fehlgeschlagen';
      }
    });
  }

  if (cloudSignOutBtn) {
    cloudSignOutBtn.addEventListener('click', async () => {
      try {
        await CloudSync_.signOut();
        cloudStatus.textContent = 'Abgemeldet';
        cloudSignOutBtn.style.display = 'none';
        cloudGoogleBtn.style.display = 'inline-block';
      } catch (err) { console.error('[Settings] Cloud sign out failed:', err); }
    });
  }

  // Toggle settings button visibility based on view
  function updateSettingsButtonVisibility() {
    const homeView = E('view-home');
    const isHomeVisible = homeView.style.display !== 'none';
    settingsBtn.style.display = isHomeVisible ? 'flex' : 'none';
  }

  // Monitor view changes
  const observer = new MutationObserver(() => {
    updateSettingsButtonVisibility();
  });

  observer.observe(E('view-home'), { attributes: true, attributeFilter: ['style'] });
  observer.observe(E('view-journal'), { attributes: true, attributeFilter: ['style'] });

  // Initial visibility check
  updateSettingsButtonVisibility();
})();
