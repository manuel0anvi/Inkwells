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
  
  const settingsVersion = E('settings-version');
  const chatNotifyChk = E('chat-notify-on');
  const textFlussSel = E('text-fluss');
  const textFlussHinweis = E('text-fluss-hinweis');
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
        /* ── Fremde Dokumente bleiben, wo sie sind: nirgends ──────────
           Ein für mich freigegebenes Dokument gehört jemand anderem. Es
           hat hier keine .jrnl-Datei und steht auch nicht in der
           Übersicht (core/registry.js) – sein Zuhause ist der Raum in
           Firestore.

           Ohne diese Zeile lief es genau deshalb in den Zweig
           „Quelle nicht gefunden, dann eben frisch speichern" darunter:
           der Umzug legte eine Datei für ein Dokument an, das mir gar
           nicht gehört, und meldete dabei einen Fehler. Gemeldet aus der
           Nutzung, August 2026. */
        if (typeof isSharedNotebook === 'function' && isSharedNotebook(nb)) {
          console.log('[Settings] Übersprungen, gehört jemand anderem:', nb.name);
          continue;
        }

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

    /* Gespeichert wird das ABSCHALTEN, nicht das Anschalten: eine
       Einstellungsdatei aus der Zeit davor kennt den Wert nicht, und
       „nicht bekannt" muss hier „an" heissen. */
    if (chatNotifyChk) chatNotifyChk.checked = !settings.chatNotifyOff;

    if (textFlussSel) {
      textFlussSel.value = settings.textFluss || 'elastisch';
      zeigeFlussHinweis();
    }

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
  
  /* Der Satz unter der Auswahl sagt, was die gewählte Art tut – und in
     einem fremden Dokument, dass sie dort gar nichts tut: darin gilt
     die Wahl des Besitzers, solange man darin ist (canvas/text.js,
     ausweichArt). Eine Auswahl, die stillschweigend wirkungslos wäre,
     ist schlimmer als keine. */
  function zeigeFlussHinweis() {
    if (!textFlussHinweis || !textFlussSel) return;
    const nb = (typeof getNb === 'function') ? getNb() : null;
    const fremdBestimmt = !!(nb && nb.textFluss);
    const schluessel = {
      elastisch: 'textFlussHinweisElastisch',
      fest: 'textFlussHinweisFest'
    }[textFlussSel.value] || 'textFlussHinweisElastisch';

    textFlussHinweis.textContent = t(schluessel)
      + (fremdBestimmt ? ' ' + t('textFlussGeteilt') : '');
    textFlussHinweis.dataset.i18n = schluessel;
  }

  textFlussSel?.addEventListener('change', zeigeFlussHinweis);

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
      saveLocation: saveLocationDisplay.value || null
    };
    
    // Cloud settings
    if (cloudEnabledChk) updates.cloudEnabled = !!cloudEnabledChk.checked;
    if (chatNotifyChk) updates.chatNotifyOff = !chatNotifyChk.checked;
    if (textFlussSel) updates.textFluss = textFlussSel.value;

    await Settings.update(updates);

    /* ── Sofort sichtbar, und im geteilten Heft auch beim anderen ────
       Die Wahl greift beim nächsten Ordnen der freien Absätze. Ohne
       diesen Anstoss sähe man sie erst beim nächsten Anschlag – und im
       geteilten Dokument nie, weil der Kopf nur beim Sichern hinausgeht
       (ui/sharedDocs.js schreibt textFluss nur als Besitzer). */
    if (typeof window.wendeTextFlussAn === 'function') window.wendeTextFlussAn();

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
