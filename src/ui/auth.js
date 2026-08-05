'use strict';

/* Konto-Modal: Anmeldung wahlweise bei Google Drive oder OneDrive.
   Eine eigene Anmeldung mit E-Mail und Passwort gibt es nicht.

   Alle Texte hier sind anbieter-neutral: der Name des aktiven Dienstes
   kommt über den Platzhalter {provider} aus core/translations.js. */

(function() {
  const profileBtn = E('btn-profile');
  const accountOverlay = E('ov-account');
  const accountClose = E('account-close');

  const authLoggedOut = E('auth-logged-out');
  const authLoggedIn = E('auth-logged-in');
  const authWorking = E('auth-working');
  const authWorkingText = E('auth-working-text');
  const authWorkingCancel = E('auth-working-cancel');

  const googleBtn = E('auth-google-btn');
  const microsoftBtn = E('auth-microsoft-btn');
  const providerHint = E('auth-provider-hint');
  const separateHint = E('auth-separate-hint');
  const configWarning = E('auth-config-warning');

  const userName = E('auth-user-name');
  const userEmail = E('auth-user-email');
  const avatar = E('auth-avatar');

  const cloudStatus = E('auth-cloud-status');
  const signoutBtn = E('auth-signout-btn');

  const profileIconSvg = E('profile-icon-svg');
  const profileIconAvatar = E('profile-icon-avatar');

  // Wichtig: refreshUI() zeichnet nur neu und löst selbst KEINEN Abgleich aus.
  // Sonst würde der Abgleich am Ende _notify() feuern, das wieder refreshUI()
  // aufruft – und das Konto-Fenster würde endlos Anfragen an Drive schicken.
  profileBtn.addEventListener('click', () => {
    refreshUI();
    accountOverlay.style.display = 'flex';
    syncNow();
  });

  function syncNow() {
    if (!window.CloudSync_) return;
    if (!Settings.get('cloudEnabled') || !CloudSync_.isAuthenticated()) return;
    CloudSync_.refreshRemote().catch(() => {});
  }

  accountClose.addEventListener('click', () => {
    accountOverlay.style.display = 'none';
  });

  /* Hinweis auf die abgelaufene Sitzung wegdrücken. Bleibt weg, bis man
     sich das nächste Mal anmeldet – gemerkt wird das in den Einstellungen,
     sonst stünde er nach jedem Neustart wieder da. */
  E('auth-expired-close')?.addEventListener('click', async () => {
    E('auth-expired-notice').style.display = 'none';
    await Settings.update({ cloudExpiredNoticeDismissed: true });
    refreshProfileBadge();
  });
  accountOverlay.addEventListener('click', (e) => {
    if (e.target === accountOverlay) accountOverlay.style.display = 'none';
  });

  /* ── Laufende Anmeldung ───────────────────────────────────────────
     Vom Klick auf „Mit Google anmelden" bis zum fertigen Konto vergehen
     mehrere Sekunden: der Systembrowser geht auf, man meldet sich an,
     kommt zurück, und erst dann holt die App Token und Profil. Solange
     stand hier weiter die Anmeldeseite – es sah aus, als sei der Klick
     ins Leere gegangen.

     Beendet wird der Zustand vom Kontowechsel selbst: CloudSync_ meldet
     jede Änderung, und refreshUI() räumt ihn dann weg. Zusätzlich eine
     Zeitgrenze, falls jemand den Browser einfach zuklappt.
     ─────────────────────────────────────────────────────────────── */

  const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;
  let signingIn = false;
  let signInTimer = null;

  function startSignInWait(providerLabel) {
    signingIn = true;
    clearTimeout(signInTimer);
    signInTimer = setTimeout(() => stopSignInWait(), SIGN_IN_TIMEOUT_MS);

    if (authWorkingText) {
      authWorkingText.textContent = t('authWorkingFor').replace('{provider}', providerLabel);
    }
    refreshUI();
  }

  function stopSignInWait() {
    if (!signingIn) return;
    signingIn = false;
    clearTimeout(signInTimer);
    signInTimer = null;
    refreshUI();
  }

  function refreshUI() {
    if (!window.CloudSync_) return;

    // Angekommen? Dann ist das Warten vorbei, egal wodurch.
    if (signingIn && CloudSync_.isAuthenticated()) {
      signingIn = false;
      clearTimeout(signInTimer);
      signInTimer = null;
    }

    if (authWorking) authWorking.style.display = signingIn ? 'flex' : 'none';
    if (signingIn) {
      authLoggedOut.style.display = 'none';
      authLoggedIn.style.display = 'none';
      return;
    }

    // Je Anbieter zeigen, ob er eingerichtet ist – statt still zu scheitern
    const googleReady = cloudProviderIsConfigured('google');
    const microsoftReady = cloudProviderIsConfigured('microsoft');
    const anyReady = googleReady || microsoftReady;

    setProviderButton(googleBtn, googleReady);
    setProviderButton(microsoftBtn, microsoftReady);

    if (providerHint) providerHint.style.display = anyReady ? 'block' : 'none';
    if (separateHint) separateHint.style.display = (googleReady && microsoftReady) ? 'block' : 'none';

    if (configWarning) {
      const missing = [];
      if (!googleReady) missing.push('Google (src/core/cloudConfig.js → GOOGLE_CONFIG.CLIENT_ID)');
      if (!microsoftReady) missing.push('Microsoft (src/core/cloudConfig.js → MICROSOFT_CONFIG.CLIENT_ID)');

      if (!anyReady) {
        configWarning.style.display = 'block';
        configWarning.textContent = (t('cloudNotConfigured')
          || 'Es sind noch keine Zugangsdaten hinterlegt. Anleitung: CLOUD_SETUP.md') + ' — ' + missing.join(', ');
      } else if (missing.length) {
        // Einer fehlt: nur als Hinweis, der andere funktioniert ja
        configWarning.style.display = 'block';
        configWarning.style.color = 'var(--text-muted)';
        configWarning.style.borderColor = 'var(--sb)';
        configWarning.textContent = (t('cloudProviderMissing')
          || 'Noch nicht eingerichtet: {list}').replace('{list}', missing.join(', '));
      } else {
        configWarning.style.display = 'none';
      }
    }

    const isAuth = CloudSync_.isAuthenticated();
    const session = CloudSync_.getSession();

    if (!isAuth) {
      authLoggedOut.style.display = 'flex';
      authLoggedIn.style.display = 'none';
      if (syncPanelBtn) syncPanelBtn.style.display = 'none';
      if (syncPanel) syncPanel.style.display = 'none';

      // Nach Ablauf der Sitzung: Konto benennen, damit der erneute Login
      // ein einzelner Klick ist (die E-Mail geht als login_hint mit).
      const expiredBox = E('auth-expired-notice');
      const expiredText = E('auth-expired-text');
      const rememberedEmail = Settings.get('cloudEmail');
      if (expiredBox) {
        if (expiredNoticePending() && anyReady) {
          expiredBox.style.display = 'flex';
          if (expiredText) expiredText.textContent = t('sessionExpiredFor').replace('{mail}', rememberedEmail);
        } else {
          expiredBox.style.display = 'none';
        }
      }
      return;
    }

    authLoggedOut.style.display = 'none';
    authLoggedIn.style.display = 'flex';

    // Sync-Status-Knopf zeigen, wenn angemeldet
    if (syncPanelBtn) syncPanelBtn.style.display = 'block';
    // Sync-Panel schließen, wenn es offen war – der Zustand wird beim
    // Öffnen des Kontos neu aufgebaut
    if (syncPanel) syncPanel.style.display = 'none';

    /* Angemeldet heißt online speichern. Früher gab es dafür einen
       Schalter; wer ihn übersah oder versehentlich umlegte, arbeitete
       tagelang nur örtlich und merkte es erst, als das zweite Gerät
       nichts fand. Sollte er aus einer älteren Fassung noch aus stehen,
       wird er hier still nachgezogen. */
    ensureCloudOn();

    const email = session?.userEmail || Settings.get('cloudEmail') || 'Benutzer';
    const name = session?.userName || email;
    userName.textContent = name;
    userEmail.textContent = email;
    avatar.textContent = (name[0] || '?').toUpperCase();

    const providerEl = E('auth-user-provider');
    if (providerEl) providerEl.textContent = CloudSync_.providerLabel();

    updateStatusText();
    updateStorageUI();
    updateSessionInfo();
  }

  function setProviderButton(btn, ready) {
    if (!btn) return;
    btn.disabled = !ready;
    btn.style.opacity = ready ? '1' : '0.4';
    btn.style.cursor = ready ? 'pointer' : 'not-allowed';
    btn.title = ready ? '' : (t('cloudProviderNotSetUp') || 'Für diesen Dienst fehlen die Zugangsdaten.');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '–';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return `${value.toFixed(value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
  }

  function updateStorageUI() {
    const container = E('auth-cloud-usage-container');
    const label = E('auth-cloud-usage-label');
    const text = E('auth-cloud-usage-text');
    const track = E('auth-cloud-usage-track');
    const bar = E('auth-cloud-usage-bar');
    const freeEl = E('auth-cloud-usage-free');
    const ownEl = E('auth-cloud-usage-own');
    if (!container || !text || !track || !bar || !freeEl || !ownEl) return;

    container.style.display = 'flex';

    // Beschriftung trägt den Namen des aktiven Dienstes ("OneDrive belegt:")
    if (label) label.textContent = t('storageUsed');

    const quota = CloudSync_.getDriveQuota();
    const own = CloudSync_.getStorageUsage();

    ownEl.textContent = `${t('storageOwnShare') || 'Davon Inkwell-Notizbücher:'} ${formatBytes(own)}`;

    if (!quota || quota.usage == null) {
      // Drive konnte die Gesamtbelegung nicht liefern
      text.textContent = formatBytes(own);
      track.style.display = 'none';
      freeEl.textContent = (t('storageFolderHint') || 'Notizbücher liegen in {provider} im Ordner „Inkwell“.')
        .replace('{provider}', CloudSync_.providerLabel());
      return;
    }

    track.style.display = 'block';

    if (quota.limit == null) {
      // Konto ohne Speicherlimit
      text.textContent = `${formatBytes(quota.usage)} ${t('storageUnlimited') || '(kein Limit)'}`;
      bar.style.width = '0%';
      freeEl.textContent = '';
      return;
    }

    const percent = Math.min(100, (quota.usage / quota.limit) * 100);
    text.textContent = `${formatBytes(quota.usage)} / ${formatBytes(quota.limit)}`;
    bar.style.width = `${percent}%`;
    bar.style.background = percent > 90 ? '#d9534f' : percent > 75 ? '#e0a63a' : 'var(--accent)';
    freeEl.textContent = `${t('storageFree') || 'Noch frei:'} ${formatBytes(quota.free)}`;
  }

  function updateSessionInfo() {
    const el = E('auth-session-info');
    if (!el) return;

    const session = CloudSync_.getSession();
    if (!session || !session.expiry) {
      el.style.display = 'none';
      return;
    }

    el.style.display = 'block';

    // Erneuerbare Sitzungen (Microsoft) laufen nicht wirklich nach einer
    // Stunde ab – nur das Zugriffstoken tut das, und das wird im Hintergrund
    // still ausgetauscht. Eine Restlaufzeit anzuzeigen wäre irreführend.
    if (CloudSync_.sessionIsRenewable()) {
      el.textContent = t('sessionStaysActive');
      return;
    }

    const minutes = Math.max(0, Math.round((session.expiry - Date.now()) / 60000));
    el.textContent = minutes > 0
      ? t('sessionRemaining').replace('{min}', minutes)
      : t('sessionExpired');
  }

  /* Steht der Hinweis auf die abgelaufene Sitzung noch aus? Es gibt eine
     gemerkte E-Mail, aber kein gültiges Token mehr – und weggedrückt wurde
     er auch nicht. Daran hängen beide Anzeigen: der Kasten im Kontofenster
     und die 1 am Knopf in der Titelleiste. */
  function expiredNoticePending() {
    if (!window.CloudSync_ || CloudSync_.isAuthenticated()) return false;
    if (!Settings.get('cloudEmail')) return false;
    return !Settings.get('cloudExpiredNoticeDismissed');
  }

  function refreshProfileBadge() {
    const badge = E('profile-badge');
    if (!badge) return;

    // Ausstehende Sync-Vorgänge zählen (nur wenn offline)
    let pendingCount = 0;
    if (window.CloudSync_ && !window.CloudSync_.isOnline
        && typeof window.CloudSync_.getPendingActions === 'function') {
      pendingCount = window.CloudSync_.getPendingActions().length;
    }

    const hasExpiredNotice = expiredNoticePending();
    const showBadge = hasExpiredNotice || pendingCount > 0;

    badge.style.display = showBadge ? 'block' : 'none';
    if (pendingCount > 0) {
      badge.textContent = pendingCount;
    } else if (hasExpiredNotice) {
      badge.textContent = '1';
    }
  }

  function refreshTitleBarAvatar() {
    if (!window.CloudSync_ || !profileIconSvg || !profileIconAvatar) return;

    refreshProfileBadge();

    if (CloudSync_.isAuthenticated()) {
      const session = CloudSync_.getSession();
      const email = session?.userEmail || Settings.get('cloudEmail') || 'Benutzer';
      const name = session?.userName || email;

      profileIconSvg.style.display = 'none';
      profileIconAvatar.style.display = 'flex';
      profileIconAvatar.textContent = (name[0] || '?').toUpperCase();
      profileIconAvatar.style.background = '';
      profileIconAvatar.title = email;
      profileBtn.title = email;
      return;
    }

    profileIconSvg.style.display = '';
    profileIconAvatar.style.display = 'none';

    // Abgelaufene Sitzung sichtbar machen: es gibt eine gemerkte E-Mail,
    // aber kein gültiges Token mehr.
    const rememberedEmail = Settings.get('cloudEmail');
    if (rememberedEmail) {
      profileIconSvg.style.color = '#d9534f';
      profileBtn.title = t('sessionExpired');
    } else {
      profileIconSvg.style.color = '';
      profileBtn.title = t('account') || 'Konto & Cloud';
    }
  }

  function updateStatusText() {
    const s = CloudSync_.getStatus();
    const map = {
      'disabled': t('syncDisabled') || 'Deaktiviert',
      'offline': t('syncOffline') || 'Offline',
      'signed-out': t('syncSignedOut') || 'Abgemeldet',
      'syncing': t('syncSyncing') || 'Synchronisiert...',
      'pending': t('syncPending') || 'Ausstehend',
      'ready': t('syncReady') || 'Bereit (✓)'
    };
    const dt = Settings.get('cloudLastSync');

    let txt = map[s] || s;
    if (s === 'ready' && dt) {
      const d = new Date(dt);
      const langCode = typeof getLanguage === 'function' ? getLanguage() : 'de';
      const tf = typeof Intl !== 'undefined'
        ? new Intl.DateTimeFormat(langCode, { hour: '2-digit', minute: '2-digit' }).format(d)
        : d.toLocaleTimeString();
      txt += ` - ${t('syncLast') || 'Zuletzt'}: ${tf}`;
    }

    cloudStatus.textContent = txt;
  }

  /* ══════════════════════════════════════════════════════════════════
     Sync-Status-Anzeige im Konto-Modal
     ══════════════════════════════════════════════════════════════════ */

  const syncPanelBtn = E('auth-sync-panel-btn');
  const syncPanel = E('auth-sync-panel');
  const syncPendingBadge = E('auth-sync-pending-badge');
  const syncCloseBtn = E('sync-panel-close-btn');
  const syncRetryAllBtn = E('sync-retry-all-btn');
  const syncClearLogBtn = E('sync-clear-log-btn');

  /** Baut die Sync-Status-Liste im Konto-Modal neu auf. */
  function renderSyncPanel() {
    if (!syncPanel || syncPanel.style.display === 'none') return;
    if (!window.CloudSync_) return;

    const pending = CloudSync_.getPendingActions ? CloudSync_.getPendingActions() : [];
    const history = CloudSync_.getSyncHistory ? CloudSync_.getSyncHistory() : [];

    // Ausstehend
    const pendingSection = E('sync-pending-section');
    const pendingList = E('sync-pending-list');
    if (pendingSection && pendingList) {
      if (pending.length > 0) {
        pendingSection.style.display = 'block';
        pendingList.innerHTML = pending.map(e => {
          const icon = e.action === 'delete' || e.action === 'trash' ? '🗑' : '📤';
          const cls = e.action === 'delete' || e.action === 'trash' ? 'delete' : 'upload';
          const label = e.action === 'delete' || e.action === 'trash'
            ? (t('syncQueuedDelete') || 'Löschung ausstehend').replace('{name}', e.nbName || e.nbId)
            : (t('syncQueuedItem') || 'wartet auf Upload').replace('{name}', e.nbName || e.nbId);
          const time = fmtTime(e.queuedAt);
          return `<div class="sync-item sync-item-status queued">
            <div class="sync-item-icon ${cls}">${icon}</div>
            <div class="sync-item-body">
              <div class="sync-item-name">${escHtml(e.nbName || e.nbId)}</div>
              <div class="sync-item-detail">${escHtml(label)}</div>
            </div>
            ${time ? `<div class="sync-item-time">${time}</div>` : ''}
          </div>`;
        }).join('');
        if (syncRetryAllBtn && CloudSync_.isOnline) {
          syncRetryAllBtn.style.display = 'block';
        } else if (syncRetryAllBtn) {
          syncRetryAllBtn.style.display = 'none';
        }
      } else {
        pendingSection.style.display = 'none';
      }
    }

    // Kürzlich synchronisiert
    const recentList = E('sync-recent-list');
    const recentEmpty = E('sync-recent-empty');
    if (recentList && recentEmpty) {
      const recent = history.filter(h => h.status === 'completed' || h.status === 'failed').slice(0, 10);
      if (recent.length > 0) {
        recentEmpty.style.display = 'none';
        recentList.style.display = 'flex';
        recentList.innerHTML = recent.map(h => {
          const iconMap = { upload: '📤', delete: '🗑', trash: '🗑', restore: '📥' };
          const icon = iconMap[h.action] || '📤';
          const statusCls = h.status === 'completed' ? 'success' : 'failed';
          const reason = h.status === 'completed'
            ? (h.reason || (t('syncActionUpload') || 'Fertig'))
            : (h.reason || 'Fehler');
          const time = fmtTime(h.at);
          return `<div class="sync-item sync-item-status ${statusCls}">
            <div class="sync-item-icon ${h.action}">${h.status === 'completed' ? '✓' : '✗'}</div>
            <div class="sync-item-body">
              <div class="sync-item-name">${escHtml(h.nbName || h.nbId)}</div>
              <div class="sync-item-detail">${escHtml(reason)}</div>
            </div>
            ${time ? `<div class="sync-item-time">${time}</div>` : ''}
          </div>`;
        }).join('');
      } else {
        recentList.style.display = 'none';
        recentEmpty.style.display = 'block';
      }
    }

    // Badge am Knopf
    updateSyncBadge();
  }

  function updateSyncBadge() {
    if (!syncPendingBadge || !syncPanelBtn) return;
    if (!window.CloudSync_) return;

    const pending = CloudSync_.getPendingActions ? CloudSync_.getPendingActions() : [];
    if (pending.length > 0) {
      syncPendingBadge.style.display = 'inline';
      syncPendingBadge.textContent = pending.length;
    } else {
      syncPendingBadge.style.display = 'none';
    }
  }

  function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Kurze Uhrzeit aus einem ISO-Zeitstempel. */
  function fmtTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString(typeof getLanguage === 'function' ? getLanguage() : 'de', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  // Sync-Panel öffnen / schließen
  if (syncPanelBtn && syncPanel) {
    syncPanelBtn.addEventListener('click', () => {
      const isOpen = syncPanel.style.display !== 'none';
      syncPanel.style.display = isOpen ? 'none' : 'flex';
      syncPanelBtn.style.display = isOpen ? 'block' : 'none';
      if (!isOpen) renderSyncPanel();
    });
  }

  if (syncCloseBtn && syncPanel && syncPanelBtn) {
    syncCloseBtn.addEventListener('click', () => {
      syncPanel.style.display = 'none';
      syncPanelBtn.style.display = 'block';
    });
  }

  // Alle jetzt hochladen
  if (syncRetryAllBtn) {
    syncRetryAllBtn.addEventListener('click', async () => {
      if (!window.CloudSync_) return;
      await CloudSync_.flushPending();
      renderSyncPanel();
    });
  }

  // Protokoll löschen
  if (syncClearLogBtn) {
    syncClearLogBtn.addEventListener('click', async () => {
      if (typeof showConfirm === 'function') {
        const ok = await showConfirm(t('syncClearLogConfirm') || 'Das Sync-Protokoll löschen?');
        if (!ok) return;
      }
      if (window.CloudSync_ && typeof CloudSync_.clearSyncLog === 'function') {
        await CloudSync_.clearSyncLog();
      }
      if (typeof toast === 'function') {
        toast(t('syncLogCleared') || 'Sync-Protokoll gelöscht.');
      }
      renderSyncPanel();
    });
  }

  if (window.CloudSync_) {
    window.CloudSync_.onChange(() => {
      refreshTitleBarAvatar();
      updateSyncBadge();
      if (accountOverlay.style.display === 'flex') {
        refreshUI();
        renderSyncPanel();
      }
    });
    refreshTitleBarAvatar();
  }

  window.addEventListener('language-changed', () => {
    if (accountOverlay.style.display === 'flex') refreshUI();
  });

  /* Einmalig nachziehen, wenn eine ältere Fassung den Schalter aus
     gelassen hat. Bewusst ohne await im Aufrufer: refreshUI() zeichnet
     nur, und der Abgleich startet von selbst, sobald er darf. */
  let cloudFixRunning = false;
  function ensureCloudOn() {
    if (cloudFixRunning) return;
    if (!CloudSync_.isAuthenticated() || Settings.get('cloudEnabled')) return;

    cloudFixRunning = true;
    Settings.update({ cloudEnabled: true })
      .then(() => CloudSync_.init())
      .then(() => syncNow())
      .catch(err => console.warn('[Auth] Cloud-Speicher nicht eingeschaltet:', err))
      .finally(() => { cloudFixRunning = false; });
  }

  async function signIn(providerId) {
    const label = providerId === 'microsoft' ? 'Microsoft' : 'Google';
    startSignInWait(label);

    try {
      await CloudSync_.signInWithOAuth(providerId);
      toast(t('authBrowserWait') || t('authGoogleWait'));
    } catch (err) {
      stopSignInWait();
      toast(t('updateError') + ' ' + err.message, true);
    }
  }

  // Der Browser bleibt offen – hier wird nur das Warten beendet, damit
  // man wieder an die Knöpfe kommt.
  authWorkingCancel?.addEventListener('click', stopSignInWait);

  googleBtn?.addEventListener('click', () => { if (!googleBtn.disabled) signIn('google'); });

  /* Microsoft: erst der Hinweis, dann weiter.

     Das Kontofenster geht dafür zu. Beide liegen auf derselben Ebene
     (z-index 900) und das Kontofenster steht weiter unten im Dokument –
     bliebe es offen, läge der Hinweis unsichtbar dahinter.

     Danach ist es wieder da: nach dem Abbrechen, um ohne Umweg Google
     zu wählen, sonst als Anzeige der laufenden Anmeldung. */
  microsoftBtn?.addEventListener('click', async () => {
    if (microsoftBtn.disabled) return;
    accountOverlay.style.display = 'none';
    const goOn = await showMsHint();
    accountOverlay.style.display = 'flex';
    if (goOn) signIn('microsoft');
  });

  // Von anderen Stellen aus zu öffnen (z. B. dem Abgemeldet-Hinweis beim Start)
  window.openAccountDialog = () => {
    refreshUI();
    accountOverlay.style.display = 'flex';
    syncNow();
  };

  signoutBtn.addEventListener('click', async () => {
    await CloudSync_.signOut();
    toast(t('authSignoutSuccess'));
    refreshUI();
  });
})();
