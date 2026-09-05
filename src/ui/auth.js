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

    /* Beim ersten Öffnen steht hier, dass ein Konto freiwillig ist – aber
       nur, solange keines da ist. Wer schon angemeldet ist, hat die Frage
       längst für sich beantwortet, und der Hinweis wäre eine Belehrung. */
    const schonAngemeldet = !!(window.CloudSync_ && CloudSync_.isAuthenticated
      && CloudSync_.isAuthenticated());
    if (!schonAngemeldet && typeof zeigeErsthinweis === 'function') zeigeErsthinweis('konto');

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

    // Fuehrt ins Sync-Fenster (ui/syncPanel.js), nur bei Anmeldung sinnvoll
    if (syncPanelBtn) syncPanelBtn.style.display = 'block';

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
    updateAutoLinkRow();
  }

  /* Der Schalter „angemeldet bleiben" gilt nur für Microsoft: nur dort
     verlangt Firebase den zweiten Schritt, den die App beim Start still
     nachholen kann (core/cloudSync.js, linkMicrosoftSilently). Bei Google
     läuft die Anmeldung ohnehin über das Token – da gäbe es nichts zu
     entscheiden, und ein Schalter ohne Wirkung ist schlimmer als keiner. */
  function updateAutoLinkRow() {
    const row = E('auth-autolink-row');
    const box = E('auth-autolink');
    if (!row || !box) return;

    const microsoft = CloudSync_.getProviderId() === 'microsoft';
    row.style.display = microsoft ? 'flex' : 'none';
    if (microsoft) box.checked = !!Settings.get('autoLinkShare');
  }

  E('auth-autolink')?.addEventListener('change', (e) => {
    Settings.update({ autoLinkShare: !!e.target.checked }).catch(() => {});
  });

  /* Das Häkchen unter dem Anmeldeknopf schreibt dieselbe Einstellung.
     Ohne das stünde der Schalter hier auf dem alten Stand, sobald man
     beides in derselben Sitzung anfasst. */
  if (typeof Settings?.onChange === 'function') {
    Settings.onChange(() => updateAutoLinkRow());
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

    ownEl.textContent = `${t('storageOwnShare') || 'Davon Inkwells-Notizbücher:'} ${formatBytes(own)}`;

    if (!quota || quota.usage == null) {
      // Drive konnte die Gesamtbelegung nicht liefern
      text.textContent = formatBytes(own);
      track.style.display = 'none';
      freeEl.textContent = (t('storageFolderHint') || 'Notizbücher liegen in {provider} im Ordner „Inkwells“.')
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

  const syncPanelBtn = E('auth-sync-panel-btn');

  function refreshProfileBadge() {
    const badge = E('profile-badge');
    if (!badge) return;

    /* Zaehlt NUR noch den ungelesenen Hinweis im Kontofenster.

       Hier stand zusaetzlich die Zahl der ausstehenden Sync-Vorgaenge.
       Seit der Sync-Knopf daneben seinen eigenen Zaehler hat, stuenden
       zwei Abzeichen mit derselben Zahl nebeneinander – und das eine
       davon am falschen Knopf. */
    const hasExpiredNotice = expiredNoticePending();
    badge.style.display = hasExpiredNotice ? 'block' : 'none';
    if (hasExpiredNotice) badge.textContent = '1';
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

  /* Das Sync-Fenster steht seit dieser Fassung fuer sich (ui/syncPanel.js)
     und haengt an einem eigenen Knopf in der Titelleiste. Hier lag es als
     ausgeklappter Abschnitt im Kontofenster, hinter einem zweiten Knopf –
     wer nachsehen wollte, ob seine Hefte oben sind, musste erst das
     Fenster zum ANMELDEN oeffnen. Gefunden hat es so kaum jemand.

     Der Knopf "Synchronisation anzeigen" bleibt hier stehen und oeffnet
     jetzt jenes Fenster; syncPanel.js haengt sich selbst daran.
     Zaehler, Listen und Anschluesse liegen vollstaendig dort. */

  if (window.CloudSync_) {
    /* Beim Kontowechsel gehört die Übersicht neu gezeichnet: sie zeigt
       nur die Hefte des angemeldeten Kontos (fremdesKonto in
       core/data.js). Gerechnet wird das erst beim Zeichnen, also muss
       gezeichnet werden. */
    let letztesKonto = window.CloudSync_.kontoSchluessel?.() || '';

    window.CloudSync_.onChange(() => {
      refreshTitleBarAvatar();
      const jetzt = window.CloudSync_.kontoSchluessel?.() || '';
      if (jetzt !== letztesKonto) {
        letztesKonto = jetzt;
        if (typeof renderHomeGrid === 'function') renderHomeGrid();
      }
      // Zaehler und Listen des Sync-Fensters versorgt ui/syncPanel.js
      // selbst – es haengt an derselben Meldung.
      if (accountOverlay.style.display === 'flex') refreshUI();
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
