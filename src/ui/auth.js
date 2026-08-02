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

  const googleBtn = E('auth-google-btn');
  const microsoftBtn = E('auth-microsoft-btn');
  const providerHint = E('auth-provider-hint');
  const separateHint = E('auth-separate-hint');
  const configWarning = E('auth-config-warning');

  const userName = E('auth-user-name');
  const userEmail = E('auth-user-email');
  const avatar = E('auth-avatar');

  const cloudEnabledChk = E('auth-cloud-enabled');
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
  accountOverlay.addEventListener('click', (e) => {
    if (e.target === accountOverlay) accountOverlay.style.display = 'none';
  });

  function refreshUI() {
    if (!window.CloudSync_) return;

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

      // Nach Ablauf der Sitzung: Konto benennen, damit der erneute Login
      // ein einzelner Klick ist (die E-Mail geht als login_hint mit).
      const expiredBox = E('auth-expired-notice');
      const rememberedEmail = Settings.get('cloudEmail');
      if (expiredBox) {
        if (rememberedEmail && anyReady) {
          expiredBox.style.display = 'block';
          expiredBox.textContent = t('sessionExpiredFor').replace('{mail}', rememberedEmail);
        } else {
          expiredBox.style.display = 'none';
        }
      }
      return;
    }

    authLoggedOut.style.display = 'none';
    authLoggedIn.style.display = 'flex';

    const settings = Settings.getAll();
    cloudEnabledChk.checked = !!settings.cloudEnabled;

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

  function refreshTitleBarAvatar() {
    if (!window.CloudSync_ || !profileIconSvg || !profileIconAvatar) return;

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

  if (window.CloudSync_) {
    window.CloudSync_.onChange(() => {
      refreshTitleBarAvatar();
      if (accountOverlay.style.display === 'flex') refreshUI();
    });
    refreshTitleBarAvatar();
  }

  window.addEventListener('language-changed', () => {
    if (accountOverlay.style.display === 'flex') refreshUI();
  });

  cloudEnabledChk.addEventListener('change', async () => {
    await Settings.update({ cloudEnabled: cloudEnabledChk.checked });
    if (cloudEnabledChk.checked) {
      await CloudSync_.init();
      syncNow();
    }
    refreshUI();
  });

  async function signIn(providerId) {
    try {
      await CloudSync_.signInWithOAuth(providerId);
      toast(t('authBrowserWait') || t('authGoogleWait'));
    } catch (err) {
      toast(t('updateError') + ' ' + err.message, true);
    }
  }

  googleBtn?.addEventListener('click', () => { if (!googleBtn.disabled) signIn('google'); });

  /* Microsoft: erst der Hinweis, dann weiter. Wer abbricht, bleibt im
     Kontofenster und kann ohne Umweg Google wählen. */
  microsoftBtn?.addEventListener('click', async () => {
    if (microsoftBtn.disabled) return;
    if (await showMsHint()) signIn('microsoft');
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
