'use strict';

/* ══════════════════════════════════════════════════════════════════════
   CLOUD SYNC  ―  anbieter-unabhängig

   Diese Datei kennt keine Cloud-Adressen mehr. Alles Anbieterspezifische
   steckt in core/providers/*.js:
     · googleDrive.js  – Google Drive
     · oneDrive.js     – Microsoft OneDrive

   Hier bleibt: Sitzung, Warteschlange, Upload-Bremse, Zusammenführen,
   Konfliktbehandlung und der Papierkorb-Abgleich.
   ══════════════════════════════════════════════════════════════════════ */

// Mindestabstand zwischen zwei Uploads desselben Notizbuchs.
// Lokal wird weiterhin alle paar Sekunden gespeichert; nur das Hochladen
// wird gebremst, weil jedes Mal das komplette Notizbuch übertragen wird.
const MIN_UPLOAD_INTERVAL_MS = 60 * 1000;

// Unterordner für gelöschte Hefte, innerhalb des Inkwell-Ordners
const CLOUD_TRASH_FOLDER = 'Papierkorb';

// Gemeinsame Liste der gelöschten Hefte
const TRASH_INDEX_NAME = 'inkwell-papierkorb.json';

// So lange vor Ablauf wird ein erneuerbares Token still ausgetauscht.
// Großzügig gewählt, damit ein einzelner fehlgeschlagener Versuch (kurz
// offline) noch mehrere Wiederholungen übrig lässt.
const TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000;

class CloudSyncManager {
  constructor() {
    this.syncQueue = [];
    this.syncing = false;
    this.isOnline = true;
    this._listeners = [];
    this._session = null;
    this._initialized = false;
    this._oauthCallbackRegistered = false;

    this._folderId = null;
    this._folderPromise = null;
    this._trashFolderId = null;
    this._trashFolderPromise = null;

    this.totalStorageUsed = 0;
    this.driveQuota = null;
    this._expiryWarned = false;
    this.retryCounts = {};

    this.lastUploadAt = new Map();
    this.immediateUploads = new Set();
    this._activeRun = null;
    this._rerunRequested = false;

    this._refreshPromise = null;

    /* Warum Firebase den Nutzer (noch) nicht kennt. Wird im Freigabe-Dialog
       angezeigt, damit dort nicht nur ein toter Knopf steht:
       null | 'offline' | 'signedOut' | 'noIdToken' | 'failed' */
    this.identityProblem = null;

    // Offline-Änderungen: was hier drin steht, muss noch hochgeladen werden –
    // auch nach einem Neustart. Siehe _persistQueue().
    this._persistedQueue = [];
    this._hadOfflineBacklog = false;
    this._offlineToastShown = false;

    // Sync-Verlauf: die letzten abgeschlossenen/fehlgeschlagenen Vorgänge.
    // Wird beim Start aus Settings geladen und bei jedem Vorgang ergänzt.
    this._syncHistory = [];
  }

  /* ══════════════════════════════════════════════════════════════════
     ANBIETER
     ══════════════════════════════════════════════════════════════════ */

  /** Der gerade eingestellte Anbieter ('google' | 'microsoft'). */
  getProviderId() {
    const stored = Settings.get('cloudProvider');
    if (stored && CLOUD_PROVIDERS.includes(stored)) return stored;
    return defaultCloudProvider();
  }

  get provider() {
    return this.getProviderId() === 'microsoft' ? OneDriveProvider : GoogleDriveProvider;
  }

  providerLabel() {
    return this.provider.label;
  }

  /** Wechselt den Anbieter. Meldet vorher ab, die Konten sind getrennt. */
  async setProvider(providerId) {
    if (!CLOUD_PROVIDERS.includes(providerId)) return false;
    if (providerId === this.getProviderId()) return true;

    if (this.isAuthenticated()) await this.signOut();

    this._resetCloudState();
    await Settings.update({ cloudProvider: providerId });
    this._notify();
    return true;
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.keepQueue=false] Ausstehende Uploads behalten.
   *   Nach einer Anmeldung ist das richtig: was hier noch nicht in der Cloud
   *   ist, soll gerade jetzt hochgeladen werden. Beim Abmelden und beim
   *   Anbieterwechsel wird die Warteschlange dagegen geleert.
   */
  _resetCloudState(options = {}) {
    this._folderId = null;
    this._folderPromise = null;
    this._trashFolderId = null;
    this._trashFolderPromise = null;
    this.totalStorageUsed = 0;
    this.driveQuota = null;
    this.lastUploadAt.clear();

    if (options.keepQueue) return;

    this.immediateUploads.clear();
    this.syncQueue = [];
    this._hadOfflineBacklog = false;
    this._persistQueue();
  }

  /* ══════════════════════════════════════════════════════════════════
     START
     ══════════════════════════════════════════════════════════════════ */

  _registerOAuthCallback() {
    if (this._oauthCallbackRegistered) return;
    if (!window.api || !window.api.onOAuthCallback) return;
    window.api.onOAuthCallback((url) => this._handleOAuthCallback(url));
    this._oauthCallbackRegistered = true;
    console.log('[CloudSync] OAuth callback listener registered');

    if (window.api.getPendingDeepLink) {
      window.api.getPendingDeepLink().then(url => {
        if (url) this._handleOAuthCallback(url);
      }).catch(() => {});
    }
  }

  async init() {
    this._registerOAuthCallback();

    if (this._initialized) return;
    this._initialized = true;

    await this._restoreSession();

    /* >>> Angemeldet heißt online speichern <<<
       Den Schalter dafür gibt es nicht mehr. Steht er aus einer älteren
       Fassung noch auf „aus", wäre die Anmeldung folgenlos: es würde
       nichts hochgeladen, nichts heruntergeladen, und der Freigabe-Dialog
       bliebe ohne erkennbaren Grund gesperrt. Deshalb hier nachziehen. */
    if (this.isAuthenticated() && !Settings.get('cloudEnabled')) {
      await Settings.update({ cloudEnabled: true });
      console.log('[CloudSync] Cloud-Speicher eingeschaltet (Konto vorhanden)');
    }

    this._restorePendingQueue();
    this._loadSyncHistory();
    this.isOnline = await this._checkConnectivity();

    window.addEventListener('online', () => this._onConnectivityChange(true));
    window.addEventListener('offline', () => this._onConnectivityChange(false));
    setInterval(() => this._checkConnectivity(), 30000);
    setInterval(() => this._processQueue(), 5000);
    setInterval(() => this._watchSessionExpiry(), 20000);

    // Was beim letzten Mal ohne Internet liegen blieb, soll nicht erst
    // beim nächsten Tippen hochgehen. Bewusst ohne await, damit der Start
    // nicht auf die Cloud wartet.
    this._catchUpAfterStart().catch(err => {
      console.warn('[CloudSync] Nachholen beim Start fehlgeschlagen:', err.message);
    });

    // Nach Ruhezustand oder langer Pause kann das Token abgelaufen sein,
    // bevor der Intervall-Wecker wieder zum Zug kommt. Sobald das Fenster
    // wieder sichtbar ist, deshalb sofort nachsehen.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._watchSessionExpiry();
    });
    window.addEventListener('focus', () => this._watchSessionExpiry());

    this._watchSessionExpiry();
    this._notify();
  }

  /** Kann die Sitzung dieses Anbieters still verlängert werden? */
  sessionIsRenewable() {
    return !!(this.provider.supportsRefresh && Settings.get('cloudRefreshToken'));
  }

  /**
   * Das Zugriffstoken läuft nach etwa einer Stunde ab. Bei Microsoft wird
   * es still erneuert – die Anmeldung hält dadurch Monate. Bei Google geht
   * das nur mit hinterlegtem Client-Secret (siehe cloudConfig.js); sonst
   * wird rechtzeitig gewarnt.
   */
  async _watchSessionExpiry() {
    const hasToken = !!Settings.get('cloudAccessToken');

    // Kein gültiges Token mehr, aber ein Refresh-Token übrig: das ist der
    // Normalfall nach einem verpassten Erneuerungsfenster (z. B. Ruhezustand
    // oder Programm war zu). Dann still neu holen statt abgemeldet bleiben.
    if (!hasToken) {
      if (this.sessionIsRenewable()) await this._refreshSession();
      return;
    }

    const expiry = Number(Settings.get('cloudTokenExpiry')) || 0;
    if (!expiry) return;

    const msLeft = expiry - Date.now();

    // Erneuerbar: rechtzeitig vorher im Hintergrund auffrischen
    if (this.provider.supportsRefresh) {
      if (msLeft > TOKEN_REFRESH_LEAD_MS) return;
      if (await this._refreshSession()) return;

      // Erneuern war nicht möglich – etwa weil zur laufenden Sitzung noch gar
      // kein Refresh-Token gehört (Anmeldung stammt von vor dem Umstellen) oder
      // weil der Anbieter es verworfen hat. Solange noch Zeit ist, wird es beim
      // nächsten Durchlauf erneut versucht; ist die Zeit um, muss der Nutzer es
      // erfahren, statt still abgemeldet zu werden.
      if (msLeft <= 0) {
        this._expiryWarned = false;
        await this._handleExpiredToken();
      }
      return;
    }

    if (msLeft > 0 && msLeft <= 5 * 60 * 1000 && !this._expiryWarned) {
      this._expiryWarned = true;
      const minutes = Math.max(1, Math.round(msLeft / 60000));
      const msg = (typeof t === 'function')
        ? t('sessionExpiringSoon').replace('{min}', minutes)
        : `Sitzung läuft in ${minutes} Min. ab – danach pausiert die Cloud-Sicherung.`;
      if (typeof toast === 'function') toast(msg);
      this._notify();
      return;
    }

    if (msLeft <= 0) {
      this._expiryWarned = false;
      await this._handleExpiredToken();
    }
  }

  /** Holt still ein neues Token (nur bei Anbietern mit Refresh-Token). */
  async _refreshSession() {
    if (!this.provider.supportsRefresh) return false;
    if (this._refreshPromise) return this._refreshPromise;

    const refreshToken = Settings.get('cloudRefreshToken');
    if (!refreshToken) return false;

    this._refreshPromise = (async () => {
      try {
        const tokens = await this.provider.refreshSession(refreshToken);
        if (!tokens?.accessToken) return false;

        const expiry = Date.now() + Math.max(0, tokens.expiresIn - 60) * 1000;
        await Settings.update({
          cloudAccessToken: tokens.accessToken,
          cloudRefreshToken: tokens.refreshToken || refreshToken,
          cloudTokenExpiry: expiry
        });
        if (this._session) {
          this._session.accessToken = tokens.accessToken;
          this._session.expiry = expiry;
        } else {
          // Die Sitzung war zwischenzeitlich verworfen (Ablauf ohne Netz).
          // Aus den gespeicherten Konto-Angaben wieder aufbauen, sonst stünde
          // die Oberfläche trotz gültigem Token ohne Namen und E-Mail da.
          this._session = {
            provider: this.getProviderId(),
            accessToken: tokens.accessToken,
            expiry,
            userId: Settings.get('cloudUserId') || '',
            userEmail: Settings.get('cloudEmail') || '',
            userName: Settings.get('cloudUserName') || Settings.get('cloudEmail') || '',
            userPicture: Settings.get('cloudUserPicture') || ''
          };
        }

        /* Firebase hält seine eigene Sitzung. Fehlt sie trotzdem – weil die
           Anmeldung von vor dieser Fassung stammt, der Speicher geleert
           wurde oder es eine Neuinstallation ist –, wird sie hier mit dem
           frischen ID-Token nachgeholt. Genau das ist der übliche Fall
           nach dem Update: das ID-Token wird beim Anmelden eingesammelt,
           und wer schon angemeldet war, hatte nie eines. */
        if (tokens.idToken && window.InkwellShare && !window.InkwellShare.hasRealIdentity()) {
          await this._linkFirebaseIdentity(
            this.getProviderId(),
            tokens.idToken,
            tokens.rawNonce || Settings.get('cloudAuthNonce') || ''
          );
        }

        console.log('[CloudSync] Sitzung still erneuert');
        this._expiryWarned = false;
        this._notify();
        return true;
      } catch (err) {
        console.warn('[CloudSync] Stille Erneuerung fehlgeschlagen:', err.message);

        // Der Anbieter hat das Refresh-Token endgültig verworfen (Passwort
        // geändert, Zugriff entzogen, zu lange nicht benutzt). Weiter zu
        // versuchen bringt nichts – wegwerfen, damit eine echte Neuanmeldung
        // verlangt wird statt stiller Fehlversuche im Minutentakt.
        if (err?.needsReauth) {
          await Settings.update({ cloudRefreshToken: '' });
        }
        return false;
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  }

  /* ══════════════════════════════════════════════════════════════════
     ZUSTAND
     ══════════════════════════════════════════════════════════════════ */

  isConfigured() {
    return this.provider.isConfigured();
  }

  isAuthenticated() {
    return !!(Settings.get('cloudAccessToken') && Settings.get('cloudUserId')) && !this.isTokenExpired();
  }

  isTokenExpired() {
    const exp = Settings.get('cloudTokenExpiry');
    if (!exp) return false;
    return Date.now() >= Number(exp);
  }

  getSession() {
    return this._session;
  }

  /**
   * Wurde die Sitzung ungewollt beendet (abgelaufen, Zugriff entzogen)?
   * Ausdrückliches Abmelden zählt nicht – dort wird die Merk-E-Mail und das
   * Kennzeichen mit gelöscht.
   */
  sessionWasLost() {
    return !!Settings.get('cloudSessionLost')
      && !!Settings.get('cloudEmail')
      && !this.isAuthenticated();
  }

  /** Hinweis wurde gezeigt – nicht bei jedem Start erneut. */
  async acknowledgeSessionLoss() {
    if (Settings.get('cloudSessionLost')) {
      await Settings.update({ cloudSessionLost: false });
    }
  }

  getStatus() {
    if (!Settings.get('cloudEnabled')) return 'disabled';
    if (!this.isOnline) return 'offline';
    if (!this.isAuthenticated()) return 'signed-out';
    if (this.syncing) return 'syncing';
    if (this.syncQueue.length > 0) return 'pending';
    return 'ready';
  }

  /* ══════════════════════════════════════════════════════════════════
     ANMELDUNG
     ══════════════════════════════════════════════════════════════════ */

  /**
   * @param {string} [providerId] 'google' | 'microsoft'. Ohne Angabe der
   *   eingestellte Anbieter. ('google' wurde früher als einziger Wert
   *   übergeben, alte Aufrufe funktionieren dadurch weiter.)
   */
  async signInWithOAuth(providerId, options = {}) {
    if (providerId && CLOUD_PROVIDERS.includes(providerId) && providerId !== this.getProviderId()) {
      await this.setProvider(providerId);
    }

    const provider = this.provider;
    if (!provider.isConfigured()) {
      throw new Error(`Zugangsdaten für ${provider.label} fehlen – siehe CLOUD_SETUP.md`);
    }

    const isWeb = !!(window.api && window.api.platform === 'web');
    let redirectUri;

    if (isWeb) {
      redirectUri = window.location.origin + window.location.pathname;
    } else {
      // Desktop: lokaler Loopback-Server fängt die Weiterleitung ab.
      // Beide Anbieter verbieten OAuth in eingebetteten Fenstern, der
      // Login geht deshalb bewusst über den System-Browser.
      if (!window.api || !window.api.startOAuthServer) {
        throw new Error('OAuth-Server nicht verfügbar');
      }
      redirectUri = await window.api.startOAuthServer();
    }

    const request = await provider.buildAuthRequest(redirectUri, {
      prompt: options.prompt || 'select_account',
      loginHint: options.loginHint || Settings.get('cloudEmail') || ''
    });

    // Für den Abschluss der Anmeldung gebraucht (PKCE-Prüfwert, Adresse,
    // bei Microsoft zusätzlich die nonce für das ID-Token)
    this._pendingAuth = {
      redirectUri,
      verifier: request.verifier,
      nonce: request.nonce || '',
      providerId: provider.id
    };

    // Bei "redirect_uri_mismatch" muss genau diese Adresse beim Anbieter
    // hinterlegt sein – zeichengenau, inklusive Port und Pfad.
    console.log(`[CloudSync] Starte Anmeldung bei ${provider.label}`);
    console.log('[CloudSync] redirect_uri =', redirectUri);

    if (!isWeb && window.api && window.api.openExternal) {
      await window.api.openExternal(request.url);
      return { started: true, mode: 'external-browser' };
    }

    // Website: der Prüfwert muss den Seitenwechsel überleben
    if (request.verifier) {
      try { sessionStorage.setItem('inkwell_pkce_verifier', request.verifier); } catch (e) {}
      try { sessionStorage.setItem('inkwell_pkce_redirect', redirectUri); } catch (e) {}
      try { sessionStorage.setItem('inkwell_auth_nonce', request.nonce || ''); } catch (e) {}
    }

    window.location.href = request.url;
    return { started: true, mode: 'redirect' };
  }

  async signOut() {
    const token = Settings.get('cloudAccessToken');
    const provider = this.provider;

    this._session = null;
    this.syncing = false;
    this._resetCloudState();

    await Settings.update({
      cloudEnabled: false,
      cloudEmail: '',
      cloudAccessToken: '',
      cloudRefreshToken: '',
      cloudTokenExpiry: 0,
      cloudUserId: '',
      cloudUserName: '',
      cloudUserPicture: '',
      // Ausdrücklich abgemeldet – das ist keine verlorene Sitzung, beim
      // nächsten Start soll deshalb kein Hinweis erscheinen.
      cloudSessionLost: false
    });

    try {
      await provider.revoke(token);
    } catch (err) {
      console.warn('[CloudSync] Zugriff konnte nicht zurückgezogen werden (ignoriert):', err.message);
    }

    /* >>> Auch bei Firebase abmelden <<<
       Die Anmeldung bei Google bzw. Microsoft und die bei Firebase sind
       zwei verschiedene Dinge. Blieb die Firebase-Sitzung stehen, wurden
       die geteilten Dokumente danach weiter unter der ALTEN Adresse
       gesucht – auch nachdem man sich längst mit einer anderen angemeldet
       hatte. Ohne Netz schlägt das fehl; dann bleibt es beim Alten, und
       die nächste Anmeldung räumt es auf (signInWithProviderToken). */
    try {
      const api = await this._whenShareReady(3000);
      await api.signOutIdentity();
      document.dispatchEvent(new CustomEvent('inkwell-identity-changed'));
    } catch (err) {
      console.warn('[CloudSync] Firebase-Abmeldung übersprungen:', err.message);
    }

    this._notify();
  }

  async _handleOAuthCallback(urlStr) {
    const provider = this.provider;

    try {
      console.log('[CloudSync] Verarbeite Anmelde-Rückleitung');

      // Google antwortet im Fragment (#), Microsoft als Query (?)
      let paramStr = '';
      if (urlStr.includes('#') && urlStr.split('#')[1]) paramStr = urlStr.split('#')[1];
      else if (urlStr.includes('?')) paramStr = urlStr.split('?')[1];

      const params = new URLSearchParams(paramStr);

      const oauthError = params.get('error');
      if (oauthError) throw new Error(provider.describeAuthError(oauthError));

      const pending = this._pendingAuth || {};
      const verifier = pending.verifier
        || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('inkwell_pkce_verifier') : null);
      const redirectUri = pending.redirectUri
        || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('inkwell_pkce_redirect') : null);
      const nonce = pending.nonce
        || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('inkwell_auth_nonce') : '');

      const tokens = await provider.completeAuth({ params, redirectUri, verifier, nonce });
      if (!tokens?.accessToken) throw new Error('Kein Zugriffstoken erhalten');

      this._pendingAuth = null;
      try {
        sessionStorage.removeItem('inkwell_pkce_verifier');
        sessionStorage.removeItem('inkwell_pkce_redirect');
        sessionStorage.removeItem('inkwell_auth_nonce');
      } catch (e) {}

      await this._applyTokens(tokens);
    } catch (err) {
      console.error('[CloudSync] Anmeldung fehlgeschlagen:', err);
      const msgErr = typeof t === 'function' ? t('updateError') : 'Fehler';
      if (typeof toast === 'function') toast(`${msgErr} ${provider.label}: ${err.message}`, true);
    }
  }

  async _applyTokens({ accessToken, refreshToken, expiresIn, idToken, rawNonce }) {
    const provider = this.provider;
    const profile = await provider.fetchProfile(accessToken);

    // Ablauf 60s früher ansetzen, damit kein Aufruf mitten im Flug abläuft
    const expiry = Date.now() + Math.max(0, (expiresIn || 3600) - 60) * 1000;

    this._session = {
      provider: provider.id,
      accessToken,
      expiry,
      userId: profile.userId,
      userEmail: profile.email,
      userName: profile.name,
      userPicture: profile.picture
    };

    await Settings.update({
      cloudEnabled: true,
      cloudProvider: provider.id,
      cloudEmail: profile.email,
      cloudAccessToken: accessToken,
      cloudRefreshToken: refreshToken || '',
      cloudTokenExpiry: expiry,
      cloudUserId: profile.userId,
      cloudUserName: profile.name,
      cloudUserPicture: profile.picture,
      cloudSessionLost: false,
      // Neue Sitzung: ein späterer Ablauf soll wieder auffallen dürfen
      cloudExpiredNoticeDismissed: false,
      // Nur Microsoft: Firebase prüft das ID-Token gegen diese nonce. Sie
      // muss aufgehoben werden, weil auch ein später über das Refresh-Token
      // nachgeholtes ID-Token dieselbe nonce trägt.
      cloudAuthNonce: rawNonce || ''
    });

    console.log(`[CloudSync] Angemeldet bei ${provider.label} als ${profile.email}`);

    const msgSuccess = typeof t === 'function' ? t('authSuccess') : 'Anmeldung erfolgreich';
    if (typeof toast === 'function') toast(`${msgSuccess}: ${profile.email}`);

    // Dieselbe Anmeldung auch gegenüber Firebase gültig machen. Ohne das
    // kennen die Sicherheitsregeln nur eine anonyme Gerätekennung und die
    // geteilten Dokumente wären nicht durchsetzbar. Bewusst ohne await
    // dahinter: schlägt es fehl, arbeitet die App ganz normal weiter.
    this._linkFirebaseIdentity(provider.id, idToken, rawNonce);

    this._resetCloudState({ keepQueue: true });
    this._expiryWarned = false;
    for (const e of this.syncQueue) {
      this.immediateUploads.add(typeof e === 'string' ? e : e.nbId);
    }
    await this.refreshRemote();
    this._notify();
    return this._session;
  }

  /**
   * Reicht das ID-Token an Firebase weiter (core/share.js). Das Modul ist ein
   * ES-Modul und deshalb möglicherweise noch nicht geladen – dann wird auf
   * sein Bereitschaftssignal gewartet.
   *
   * Ohne ID-Token (Google im Implicit-Flow, also ohne hinterlegtes
   * Client-Secret) wird nur eine Notiz geschrieben. Alles außer den
   * geteilten Dokumenten funktioniert dann weiter wie bisher.
   */
  _linkFirebaseIdentity(providerId, idToken, rawNonce) {
    if (!idToken) {
      console.warn('[CloudSync] Kein ID-Token erhalten – geteilte Dokumente bleiben aus.'
        + (providerId === 'google'
          ? ' Google liefert es nur im Code-Flow, also mit hinterlegtem Client-Secret (siehe core/cloudConfig.js).'
          : ''));
      Settings.update({ cloudIdentityMissing: true }).catch(() => {});
      return Promise.resolve(false);
    }

    return this._whenShareReady()
      .then(async (api) => {
        await api.signInWithProviderToken({ provider: providerId, idToken, rawNonce });
        await Settings.update({ cloudIdentityMissing: false });
        console.log('[CloudSync] Firebase-Kennung hergestellt:', api.currentIdentity()?.email || '?');

        // Freigaben, die noch der alten Gerätekennung gehören, jetzt dem
        // Konto zuschlagen – sonst ließen sie sich auf einem zweiten Gerät
        // nicht mehr aufheben.
        try {
          const shares = Settings.get('shares');
          const ids = shares && typeof shares === 'object'
            ? Object.values(shares).map(entry => entry?.shareId).filter(Boolean)
            : [];
          const claimed = await api.claimOwnShares(ids);
          if (claimed > 0) console.log('[CloudSync]', claimed, 'Freigabe(n) übernommen');
        } catch (err) {
          console.warn('[CloudSync] Freigaben übernehmen fehlgeschlagen:', err?.message || err);
        }

        document.dispatchEvent(new CustomEvent('inkwell-identity-changed'));
        return true;
      })
      .catch(err => {
        /* Die genaue Meldung ist hier Gold wert: sie sagt, ob der Anbieter
           in der Firebase Console fehlt oder die Client-ID nicht zugelassen
           ist. Ohne sie steht man vor einem stummen Knopf.

           Der Code (err.code) wird eigens mitgeschrieben: "auth/invalid-
           credential" und "auth/operation-not-allowed" sehen in der
           Meldung fast gleich aus, meinen aber zwei verschiedene Dinge –
           abgelehntes Token gegenüber abgeschaltetem Anbieter. */
        console.warn('[CloudSync] Firebase-Anmeldung fehlgeschlagen:',
          providerId, err?.code || '(ohne Code)', err?.message || err);
        this.identityError = (err?.code ? err.code + ': ' : '') + (err?.message || String(err));
        this.identityProblem = 'failed';
        Settings.update({ cloudIdentityMissing: true }).catch(() => {});
        return false;
      });
  }

  /**
   * Sorgt dafür, dass Firebase den angemeldeten Nutzer kennt – auch dann,
   * wenn die Anmeldung schon vor dieser Fassung bestand.
   *
   * Das ID-Token wird beim Anmelden eingesammelt. Wer bereits angemeldet
   * war, hatte deshalb nie eines: der Freigabe-Dialog stünde ohne diesen
   * Nachholer für immer auf „du musst dich anmelden", obwohl man es ist.
   * Hier wird über das Refresh-Token still ein frisches ID-Token geholt.
   *
   * @returns {Promise<boolean>} true, wenn Firebase den Nutzer jetzt kennt
   */
  async ensureFirebaseIdentity() {
    let api;
    try {
      api = await this._whenShareReady();
    } catch (err) {
      this.identityProblem = 'offline';
      return false;
    }

    await api.whenIdentityReady();

    /* >>> Kennt Firebase noch jemand ANDEREN? <<<
       Eine Sitzung, die von einem früheren Konto stehen geblieben ist,
       würde die geteilten Dokumente dauerhaft unter der alten Adresse
       suchen – genau so, wie es nach einem Wechsel von Google auf
       Microsoft passierte. Sie wird erst weggeräumt; die Anmeldung mit
       der richtigen Adresse holt der Rest dieser Funktion nach. */
    const known = api.currentIdentity();
    const wanted = api.normalizeEmail(Settings.get('cloudEmail') || '');
    const fremd = known && !known.anonymous && wanted && known.email !== wanted;

    /* >>> Nur abmelden, wenn wir uns auch wieder anmelden koennen <<<
       Bei Microsoft geht das nicht: der Rest dieser Funktion laeuft in
       signInWithProviderToken, und das weist Firebase fuer microsoft.com
       grundsaetzlich ab (Begruendung dort). Abmelden hiesse hier also,
       eine brauchbare Sitzung durch nichts zu ersetzen – und weil das bei
       JEDEM Start laeuft, waere der Knopf jedes Mal wieder faellig.

       Ein Wechsel des Kontos raeumt die Sitzung ohnehin auf: signOut()
       weiter oben meldet auch bei Firebase ab. Was hier bliebe, waere
       eine Abweichung ohne Wechsel – und die ist den Verlust nicht wert. */
    const kannWiederAnmelden = this.getProviderId() !== 'microsoft';

    if (fremd && !kannWiederAnmelden) {
      /* Die Sitzung ist brauchbar – nur eben unter dieser Adresse. Das ist
         allemal besser als gar keine, und die Adressen weichen bei
         Microsoft schon dann ab, wenn Graph einen anderen Alias nennt als
         das Token. Ein echter Kontowechsel raeumt ohnehin ueber signOut(). */
      console.warn('[CloudSync] Firebase kennt', known.email, '– erwartet wird', wanted,
        '· Sitzung bleibt stehen, bei Microsoft gibt es keinen Weg zurueck');
      this.identityProblem = null;
      return true;
    } else if (fremd) {
      console.warn('[CloudSync] Firebase kennt noch', known.email, '– erwartet wird', wanted);
      try {
        await api.signOutIdentity();
      } catch (err) {
        console.warn('[CloudSync] Alte Firebase-Sitzung nicht abmeldbar:', err.message);
      }
    } else if (api.hasRealIdentity()) {
      this.identityProblem = null;
      return true;
    }

    if (!this.isAuthenticated()) {
      // Gar nicht bei Google/Microsoft angemeldet – dann ist das kein Fehler,
      // sondern schlicht der Ausgangszustand.
      this.identityProblem = 'signedOut';
      return false;
    }

    if (!this.provider.supportsRefresh || !Settings.get('cloudRefreshToken')) {
      // Google ohne Client-Secret: es gibt keinen Weg an ein ID-Token.
      this.identityProblem = 'noIdToken';
      await Settings.update({ cloudIdentityMissing: true });
      return false;
    }

    console.log('[CloudSync] Firebase kennt den Nutzer noch nicht – hole ein frisches ID-Token');
    await this._refreshSession();

    const ok = api.hasRealIdentity();
    this.identityProblem = ok ? null : 'failed';
    return ok;
  }

  /**
   * Zweiter Anmeldeschritt für Microsoft, aus einem Klick heraus.
   *
   * Firebase nimmt bei Microsoft nur eine Anmeldung an, die es selbst
   * begonnen hat (Begründung in core/share.js). Deshalb hier ein eigener,
   * bewusst ausgelöster Schritt statt eines stillen Nachholers.
   *
   * @returns {Promise<boolean>} true, wenn Firebase den Nutzer jetzt kennt
   */
  async linkMicrosoftInteractively() {
    let api;
    try {
      api = await this._whenShareReady();
    } catch (err) {
      this.identityProblem = 'offline';
      return false;
    }

    try {
      await api.signInMicrosoftInteractive(Settings.get('cloudEmail') || '');
      await this._merkeKennung(api);
      return true;
    } catch (err) {
      const code = err?.code || '';
      // Fenster zugemacht oder abgebrochen ist kein Fehler, den man melden muss
      if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/i.test(code)) return false;

      /* Dieselbe Adresse gehört hier schon zu einer Anmeldung über Google.
         Kein Fehler, sondern ein zweiter Schritt – und der braucht einen
         eigenen Klick, weil er wieder ein Fenster öffnet (core/share.js). */
      if (code === 'inkwell/microsoft-needs-google') {
        console.log('[CloudSync] Adresse gehört schon zu einer Google-Anmeldung –',
          'es fehlt die Bestätigung über Google');
        this.identityProblem = 'needsGoogle';
        this.identityError = '';
        this._notify();
        return false;
      }

      console.warn('[CloudSync] Microsoft-Anmeldung bei Firebase fehlgeschlagen:', code, err?.message || err);
      this.identityError = (code ? code + ': ' : '') + (err?.message || String(err));
      this.identityProblem = 'failed';
      return false;
    }
  }

  /**
   * Zweiter Teil davon: das Ja über Google, damit Microsoft an dasselbe
   * Firebase-Konto kommt. Braucht einen eigenen Klick – es öffnet ein
   * Fenster, und ein ungefragtes wird geblockt.
   */
  async finishMicrosoftLinkWithGoogle() {
    let api;
    try {
      api = await this._whenShareReady();
    } catch (err) {
      this.identityProblem = 'offline';
      return false;
    }

    try {
      await api.linkMicrosoftWithGoogle(Settings.get('cloudEmail') || '');
      await this._merkeKennung(api);
      return true;
    } catch (err) {
      const code = err?.code || '';
      if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/i.test(code)) return false;
      console.warn('[CloudSync] Verknüpfung über Google fehlgeschlagen:', code, err?.message || err);
      this.identityError = (code ? code + ': ' : '') + (err?.message || String(err));
      this.identityProblem = 'failed';
      this._notify();
      return false;
    }
  }

  /**
   * Wartet die Microsoft-Anmeldung noch auf das Ja über Google?
   *
   * Auch der stille Versuch beim Start kann darauf stoßen – der meldet
   * aber nichts nach außen, damit beim Hochfahren nichts aufblitzt.
   * Deshalb wird zusätzlich dort nachgesehen, wo die wartende Anmeldung
   * wirklich liegt (core/share.js).
   */
  microsoftNeedsGoogle() {
    if (this.identityProblem === 'needsGoogle') return true;
    try { return !!window.InkwellShare?.microsoftWartetAufGoogle?.(); }
    catch (err) { return false; }
  }

  /**
   * Ist der Umweg über Google gerade überhaupt einen Knopf wert?
   *
   * Nicht nur beim erkannten Konflikt: Firebase nennt für Microsoft
   * mehrere ganz verschiedene Ursachen mit derselben Zeichenkette, und
   * gemeldet wurde, dass der Knopf „auf Schritt eins stehen bleibt".
   * Nach JEDEM gescheiterten Versuch steht der Weg deshalb offen – er
   * kostet nichts und führt sicher ans Ziel, weil die Freigaben an der
   * Adresse hängen und nicht an der Anmeldeart.
   */
  microsoftCanUseGoogle() {
    if (this.getProviderId() !== 'microsoft') return false;
    return this.microsoftNeedsGoogle() || this.identityProblem === 'failed';
  }

  /** Gemeinsamer Abschluss beider Wege: Firebase kennt den Nutzer jetzt. */
  async _merkeKennung(api) {
    await Settings.update({ cloudIdentityMissing: false });
    this.identityProblem = null;
    this.identityError = '';
    console.log('[CloudSync] Firebase-Kennung hergestellt:', api.currentIdentity()?.email || '?');
    document.dispatchEvent(new CustomEvent('inkwell-identity-changed'));
    this._notify();
  }

  /**
   * Derselbe Schritt, aber ohne Zutun – beim Start der App.
   *
   * Läuft nur, wenn der Nutzer ausdrücklich einverstanden ist
   * (Einstellung autoLinkShare). Klappt es nicht, passiert nichts:
   * kein Fenster, keine Meldung, der Knopf bleibt wie bisher stehen.
   *
   * @returns {Promise<boolean>} true, wenn Firebase den Nutzer jetzt kennt
   */
  async linkMicrosoftSilently() {
    if (this.getProviderId() !== 'microsoft') return false;
    if (!Settings.get('autoLinkShare')) return false;
    if (!this.isAuthenticated()) return false;

    let api;
    try {
      api = await this._whenShareReady();
    } catch (err) {
      return false;
    }

    /* Dem Hauptprozess Bescheid geben, sonst blitzt Firebases
       Anmeldefenster beim Start kurz auf. Die Marke verfällt von selbst –
       ein späteres, gewolltes Fenster darf nicht darunter leiden. */
    try { window.api?.setSilentAuth?.(true); } catch (e) { /* ohne Brücke egal */ }

    try {
      const user = await api.signInMicrosoftSilently(Settings.get('cloudEmail') || '');
      if (!user) {
        console.log('[CloudSync] Stille Anmeldung nicht möglich – dafür braucht es einen Klick');
        return false;
      }
      await Settings.update({ cloudIdentityMissing: false });
      this.identityProblem = null;
      this.identityError = '';
      console.log('[CloudSync] Firebase-Kennung still hergestellt:', api.currentIdentity()?.email || '?');
      document.dispatchEvent(new CustomEvent('inkwell-identity-changed'));
      this._notify();
      return true;
    } catch (err) {
      // Beim Start darf das nichts kosten – nur ins Log, nicht auf den Schirm
      console.warn('[CloudSync] Stille Anmeldung fehlgeschlagen:', err?.code || '', err?.message || err);
      return false;
    } finally {
      try { window.api?.setSilentAuth?.(false); } catch (e) { /* siehe oben */ }
    }
  }

  /** core/share.js ist ein ES-Modul und läuft nach den klassischen Scripts. */
  _whenShareReady(timeoutMs = 15000) {
    if (window.InkwellShare) return Promise.resolve(window.InkwellShare);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SHARE_OFFLINE')), timeoutMs);
      document.addEventListener('inkwell-share-ready', () => {
        clearTimeout(timer);
        if (window.InkwellShare) resolve(window.InkwellShare);
        else reject(new Error('SHARE_OFFLINE'));
      }, { once: true });
    });
  }

  /**
   * Wird bei Ablauf und bei einer 401-Antwort aufgerufen. Bei Anbietern mit
   * Refresh-Token wird zuerst still erneuert. Die E-Mail bleibt gespeichert,
   * damit die erneute Anmeldung ein Klick ist; die Warteschlange bleibt
   * erhalten und läuft danach weiter.
   */
  async _handleExpiredToken() {
    if (!Settings.get('cloudAccessToken')) return;

    if (this.provider.supportsRefresh && await this._refreshSession()) return;

    console.warn('[CloudSync] Sitzung abgelaufen');
    this._session = null;
    this._folderId = null;
    this._folderPromise = null;
    this._trashFolderId = null;
    this._trashFolderPromise = null;

    // Merken, dass die Sitzung ungewollt endete. Beim nächsten Start weist
    // ui/signedOut.js darauf hin – sonst fällt es erst auf, wenn Tage später
    // nichts mehr in der Cloud ankommt.
    await Settings.update({ cloudAccessToken: '', cloudTokenExpiry: 0, cloudSessionLost: true });

    if (typeof toast === 'function') {
      toast(typeof t === 'function' ? t('sessionExpired') : 'Sitzung abgelaufen – bitte erneut anmelden.', true);
    }
    this._notify();
  }

  /* ══════════════════════════════════════════════════════════════════
     HTTP – kümmert sich um Token, Erneuerung und Fehlermeldungen
     ══════════════════════════════════════════════════════════════════ */

  get _http() {
    const self = this;
    return {
      async raw(url, options = {}) { return self._request(url, options); },
      async json(url, options = {}) {
        const res = await self._request(url, options);
        if (res.status === 204) return null;
        return res.json().catch(() => null);
      }
    };
  }

  async _request(url, options = {}, isRetry = false) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${Settings.get('cloudAccessToken')}`,
        ...(options.headers || {})
      }
    });

    if (res.status === 401 && !isRetry) {
      // Erst still erneuern, erst danach aufgeben
      if (this.provider.supportsRefresh && await this._refreshSession()) {
        return this._request(url, options, true);
      }
      await this._handleExpiredToken();
      throw new Error('401 – Sitzung abgelaufen');
    }

    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error?.message || body?.error_description || body?.error || '';
      } catch (e) { /* nicht-JSON Antwort */ }

      if (res.status === 403 && /quota|storage|insufficient/i.test(detail)) {
        throw new Error(`${this.provider.label}: Speicherplatz voll – ${detail}`);
      }
      throw new Error(`${this.provider.label} Fehler ${res.status}${detail ? ': ' + detail : ''}`);
    }

    return res;
  }

  /* ══════════════════════════════════════════════════════════════════
     ORDNER
     ══════════════════════════════════════════════════════════════════ */

  async _getFolder() {
    if (this._folderId) return this._folderId;
    if (this._folderPromise) return this._folderPromise;

    this._folderPromise = this.provider.findOrCreateFolder(this._http)
      .then(id => { this._folderId = id; return id; })
      .finally(() => { this._folderPromise = null; });

    return this._folderPromise;
  }

  async _getTrashFolder() {
    if (this._trashFolderId) return this._trashFolderId;
    if (this._trashFolderPromise) return this._trashFolderPromise;

    this._trashFolderPromise = (async () => {
      const parentId = await this._getFolder();
      return this.provider.findOrCreateSubfolder(this._http, parentId, CLOUD_TRASH_FOLDER);
    })()
      .then(id => { this._trashFolderId = id; return id; })
      .finally(() => { this._trashFolderPromise = null; });

    return this._trashFolderPromise;
  }

  /* ══════════════════════════════════════════════════════════════════
     WARTESCHLANGE UND UPLOAD-BREMSE
     ══════════════════════════════════════════════════════════════════ */

  /* ── Offline-Warteschlange, die einen Neustart übersteht ─────────────
     Vorher lebte die Warteschlange nur im Arbeitsspeicher und wurde nur
     befüllt, wenn gerade hochgeladen werden KONNTE. Wer ohne Internet
     schrieb und die App schloss, hatte danach nichts mehr, woran der
     Upload hing: die Änderung lag lokal, in der Cloud fehlte sie – bis
     zufällig irgendwann wieder in dasselbe Heft geschrieben wurde.

     Jetzt wird jede Änderung vorgemerkt, unabhängig von Netz und
     Anmeldung, und die Liste liegt in den Einstellungen.
     ─────────────────────────────────────────────────────────────────── */

  _restorePendingQueue() {
    const stored = Settings.get('cloudPendingUploads');
    if (!Array.isArray(stored) || !stored.length) return;

    this._persistedQueue = [];
    this._hadOfflineBacklog = true;

    for (const item of stored) {
      // Abwärtskompatibel: alte Einträge sind reine Strings (nbId),
      // neue sind { nbId, action, queuedAt }
      const entry = typeof item === 'string'
        ? { nbId: item, action: 'upload', nbName: '', queuedAt: new Date().toISOString() }
        : { nbId: item.nbId, action: item.action || 'upload', nbName: '', queuedAt: item.queuedAt || new Date().toISOString() };

      if (!entry.nbId) continue;

      // Heft-Name ergänzen, falls das Heft noch lebt
      const nb = getNb(entry.nbId);
      if (nb) entry.nbName = nb.name;

      // Gibt es diesen Eintrag schon? Nur dann nicht doppelt.
      const exists = this.syncQueue.some(e => {
        const id = typeof e === 'string' ? e : e.nbId;
        return id === entry.nbId;
      });
      if (!exists) this.syncQueue.push(entry);

      // Nachzügler aus einer früheren Sitzung sollen nicht noch eine
      // Minute Mindestabstand abwarten.
      this.immediateUploads.add(entry.nbId);
    }
    console.log('[CloudSync]', this.syncQueue.length, 'Einträge aus der letzten Sitzung warten noch');
  }

  _persistQueue() {
    // Nur die IDs und Aktionen merken – Namen können sich ändern und werden
    // beim Laden aus den Heften ergänzt.
    const slim = this.syncQueue.map(e => ({ nbId: e.nbId, action: e.action || 'upload', queuedAt: e.queuedAt }));
    const same = slim.length === this._persistedQueue.length
      && slim.every((e, i) => e.nbId === this._persistedQueue[i]?.nbId
        && (e.action || 'upload') === (this._persistedQueue[i]?.action || 'upload'));
    if (same) return;

    this._persistedQueue = slim;
    // Bewusst ohne await: das Schreiben der Einstellungsdatei darf den
    // Abgleich nicht ausbremsen.
    Settings.update({ cloudPendingUploads: slim }).catch(err => {
      console.warn('[CloudSync] Warteschlange nicht speicherbar:', err.message);
    });
  }

  /**
   * Einen Vorgang als ERLEDIGT ins Protokoll schreiben, der gar nicht
   * erst durch die Warteschlange musste.
   *
   * >>> Wofuer das gebraucht wird <<<
   * Trash.moveToTrash() schiebt die Cloud-Datei selbst in den
   * Papierkorb-Ordner, gleich beim Loeschen. Mit Netz klappt das sofort –
   * und genau dann wurde bisher NICHTS vermerkt: nicht in der
   * Warteschlange (es wartet ja nichts mehr) und nicht im Protokoll
   * (dorthin schreibt sonst nur _runQueue).
   *
   * Fuer den Nutzer sah es deshalb so aus, als sei beim Loeschen mit
   * Internet ueberhaupt nichts mit der Cloud geschehen. Ohne Internet
   * tauchte es auf, mit Internet nicht – also genau andersherum, als man
   * es erwartet.
   *
   * @param {{nbId: string, nbName?: string, action?: string, reason?: string}} vorgang
   */
  noteSyncDone(vorgang) {
    if (!vorgang || !vorgang.nbId) return;
    this._addSyncHistoryEntry({
      nbId: vorgang.nbId,
      nbName: vorgang.nbName || '',
      action: vorgang.action || 'upload',
      status: 'completed',
      reason: vorgang.reason || ''
    });
    this._notify();
  }

  /**
   * Steht ueberhaupt etwas an, das die Cloud braucht?
   *
   * Gebraucht beim Beenden: ohne diese Frage lief dort jedes Mal ein
   * Abgleich los, und die App brauchte immer eine Weile zum Zumachen -
   * auch wenn schon alles oben war.
   */
  hatOffeneArbeit() {
    if (!this._canSync() || !this.isOnline) return false;
    if (this.syncQueue.length > 0) return true;
    if (typeof Trash !== 'undefined' && Trash?.getPendingCloudActions) {
      return Trash.getPendingCloudActions().length > 0;
    }
    return false;
  }

  /** Wie viele Hefte warten noch auf den Upload? */
  getPendingCount() {
    return this.syncQueue.filter(e => {
      const entry = typeof e === 'string' ? { nbId: e, action: 'upload' } : e;
      return entry.action !== 'delete'; // Löschungen zählen nicht als Upload
    }).length;
  }

  /** Beim Start alles nachholen, was offline liegen geblieben ist. */
  async _catchUpAfterStart() {
    if (!this._canSync() || !this.isOnline) return;

    if (this.syncQueue.length) {
      await this._processQueue();
      // refreshRemote() bleibt aus, also den Papierkorb hier eigens nachziehen
      await this._catchUpTrash();
      return;
    }

    // Keine gemerkte Liste (etwa nach einem Absturz): über die Zeitstempel
    // herausfinden, welche Hefte hier neuer sind als in der Cloud.
    await this.refreshRemote();
  }

  /**
   * Reiht ein Heft in die Upload-Warteschlange ein.
   *
   * @param {string} nbId Heft-Kennung
   * @param {object} [options]
   * @param {'upload'|'delete'|'trash'|'restore'} [options.action='upload']
   *   Was soll mit dem Heft in der Cloud geschehen?
   * @param {string} [options.nbName] Name zum Anzeigen (wird sonst aus dem Heft gelesen)
   * @param {boolean} [options.immediate] Sofort hochladen, ohne Mindestabstand
   * @param {boolean} [options.silent] Keinen Toast zeigen
   */
  queueNotebook(nbId, options = {}) {
    if (!nbId) return;

    // Geteilte Hefte gehören nicht in das eigene Drive bzw. OneDrive. Ohne
    // diese Bremse lüde die App des Empfängers fremde Hefte in SEIN Konto.
    if (typeof isSharedNotebook === 'function' && isSharedNotebook(nbId)) return;

    let action = options.action || 'upload';
    const nb = getNb(nbId);
    const nbName = options.nbName || (nb ? nb.name : '');

    /* ── Randfall: offline erstellen + offline löschen ────────────────
       Steht dasselbe Heft bereits mit action 'upload' in der Schlange und
       wird jetzt als 'delete' oder 'trash' gemeldet, dann war es nie in der
       Cloud. Der Upload-Eintrag wird entfernt – es gibt nichts zu löschen. */
    if (action === 'delete' || action === 'trash') {
      const uploadIdx = this.syncQueue.findIndex(e => {
        const id = typeof e === 'string' ? e : e.nbId;
        return id === nbId && (typeof e === 'string' || (e.action || 'upload') === 'upload');
      });
      if (uploadIdx > -1) {
        // Nur wenn das Heft VORHER schon in der Cloud war (syncedAt), muss
        // es dort auch gelöscht werden. Sonst: Upload streichen, nichts tun.
        const hadSynced = nb && nb.syncedAt;
        if (!hadSynced) {
          this.syncQueue.splice(uploadIdx, 1);
          this._persistQueue();
          this.immediateUploads.delete(nbId);
          this._notify();
          return;
        }
        // Es war schon oben → Upload durch Delete ersetzen
        this.syncQueue.splice(uploadIdx, 1);
      }
    }

    /* ── Randfall: offline löschen + offline wiederherstellen ─────────
       Ein 'restore' macht einen vorherigen 'delete'-Eintrag rückgängig. */
    if (action === 'restore' || action === 'upload') {
      const deleteIdx = this.syncQueue.findIndex(e => {
        const id = typeof e === 'string' ? e : e.nbId;
        const a = typeof e === 'string' ? 'upload' : (e.action || 'upload');
        return id === nbId && (a === 'delete' || a === 'trash');
      });
      if (deleteIdx > -1) {
        this.syncQueue.splice(deleteIdx, 1);
        // Wiederherstellen heißt: das Heft soll jetzt hochgeladen werden
        action = 'upload';
      }
    }

    // Gibt es diesen Eintrag schon? Dann nur ggf. Namen aktualisieren.
    const existing = this.syncQueue.find(e => {
      const id = typeof e === 'string' ? e : e.nbId;
      return id === nbId;
    });
    if (existing && typeof existing === 'object') {
      if (nbName) existing.nbName = nbName;
      if (options.immediate) this.immediateUploads.add(nbId);
    } else if (!existing) {
      this.syncQueue.push({ nbId, nbName, action, queuedAt: new Date().toISOString() });
    } else {
      // Alter String-Eintrag → umwandeln
      const idx = this.syncQueue.indexOf(nbId);
      if (idx > -1) this.syncQueue[idx] = { nbId, nbName, action, queuedAt: new Date().toISOString() };
    }

    if (options.immediate) this.immediateUploads.add(nbId);
    this._persistQueue();

    if (!this._canSync()) {
      // Ohne Anmeldung oder mit abgeschalteter Sicherung bleibt der Eintrag
      // einfach stehen. Er wird abgearbeitet, sobald beides wieder passt.
      this._notify();
      return;
    }

    if (!this.isOnline && !options.silent) {
      this._hadOfflineBacklog = true;
      if (!this._offlineToastShown) {
        this._offlineToastShown = true;
        if (typeof toast === 'function') {
          const count = this.syncQueue.length;
          if (count === 1 && nbName) {
            const key = action === 'delete' || action === 'trash' ? 'syncQueuedDelete' : 'syncOfflineToastNamed';
            toast(typeof t === 'function' ? t(key).replace('{name}', nbName)
              : `Ohne Internet: „${nbName}" wird hochgeladen, sobald du wieder online bist.`);
          } else if (count > 1) {
            toast(typeof t === 'function' ? t('syncOfflineToastCount').replace('{n}', count)
              : `Ohne Internet: ${count} Änderungen warten auf Internet.`);
          } else {
            toast(typeof t === 'function' ? t('syncQueuedOffline')
              : 'Ohne Internet gespeichert. Wird hochgeladen, sobald du wieder online bist.');
          }
        }
      }
    }

    // Sync-Verlauf: vermerken, dass dieser Vorgang vorgemerkt wurde
    this._addSyncHistoryEntry({
      nbId, nbName, action,
      status: this.isOnline ? 'pending' : 'queued',
      reason: this.isOnline ? '' : 'offline'
    });

    this._notify();
    this._processQueue();
  }

  /**
   * Ein einzelnes wartendes Heft SOFORT hochladen, ohne den
   * Mindestabstand abzuwarten.
   *
   * >>> Wofuer das da ist <<<
   * Der Mindestabstand (MIN_UPLOAD_INTERVAL_MS) bremst nur die
   * WIEDERHOLUNG desselben Hefts – sinnvoll, solange man darin
   * weiterschreibt, denn jedes Mal geht das ganze Heft hinaus.
   *
   * Beim Zumachen ist er aber falsch: dort wird gerade nicht mehr
   * geschrieben, und das Heft bliebe bis zu einer Minute ungesichert
   * liegen. Wer die App in dieser Minute beendet, verliert zwar nichts
   * (beim Beenden wird ohnehin alles hinausgedrueckt) – aber wer sein
   * Heft zumacht, will es oben wissen, nicht "gleich".
   *
   * Nur was ohnehin schon wartet: ein Heft, an dem sich nichts geaendert
   * hat, wird dadurch NICHT hochgeladen. Sonst ginge bei jedem Weg
   * zurueck zur Uebersicht das ganze Heft ueber die Leitung.
   *
   * @param {string} nbId
   * @returns {boolean} ob wirklich etwas angestossen wurde
   */
  flushNotebook(nbId) {
    if (!nbId) return false;

    const wartet = this.syncQueue.some(e => (typeof e === 'string' ? e : e.nbId) === nbId);
    if (!wartet) return false;

    this.immediateUploads.add(nbId);
    this._processQueue();
    return true;
  }

  async flushPending() {
    if (!this._canSync() || !this.isOnline) return;

    /* ── Den Papierkorb nur anfassen, wenn dort wirklich etwas offen ist ──
       Hier stand ein bedingungsloses _catchUpTrash(). Das ist ein voller
       Abgleich ueber das Netz - die gemeinsame Liste holen, den
       Hauptordner auflisten - und er lief bei JEDEM Beenden, auch wenn
       gar nichts anlag.

       Beim Beenden ist das der Unterschied zwischen "geht sofort zu" und
       "haengt eine Sekunde". Und noetig ist es nicht: was hier liegen
       bleibt, holt der naechste Start nach, ebenso das Wiederverbinden. */
    const papierkorbOffen = (typeof Trash !== 'undefined' && Trash?.getPendingCloudActions)
      ? Trash.getPendingCloudActions().length > 0
      : false;
    if (papierkorbOffen) await this._catchUpTrash();

    if (this.syncQueue.length === 0) return;

    for (const e of this.syncQueue) {
      const id = typeof e === 'string' ? e : e.nbId;
      this.immediateUploads.add(id);
    }
    await this._processQueue().catch(() => {});
  }

  _isUploadDue(nbId) {
    if (this.immediateUploads.has(nbId)) return true;
    const last = this.lastUploadAt.get(nbId);
    if (!last) return true;
    return Date.now() - last >= MIN_UPLOAD_INTERVAL_MS;
  }

  getSecondsUntilNextUpload(nbId) {
    if (this._isUploadDue(nbId)) return 0;
    const last = this.lastUploadAt.get(nbId) || 0;
    return Math.max(0, Math.ceil((MIN_UPLOAD_INTERVAL_MS - (Date.now() - last)) / 1000));
  }

  _canSync() {
    return !!Settings.get('cloudEnabled') && this.isAuthenticated() && this.isConfigured();
  }

  _processQueue() {
    if (this._activeRun) {
      this._rerunRequested = true;
      return this._activeRun;
    }

    this._activeRun = (async () => {
      do {
        this._rerunRequested = false;
        await this._runQueue();
      } while (this._rerunRequested);
    })().finally(() => { this._activeRun = null; });

    return this._activeRun;
  }

  _removeFromQueue(nbId) {
    const idx = this.syncQueue.findIndex(e => {
      const id = typeof e === 'string' ? e : e.nbId;
      return id === nbId;
    });
    if (idx > -1) this.syncQueue.splice(idx, 1);
    this._persistQueue();
  }

  async _runQueue() {
    if (this.syncQueue.length === 0) return;
    if (!this._canSync() || !this.isOnline) return;

    // Normalisieren: alte String-Einträge in Objekte umwandeln
    for (let i = 0; i < this.syncQueue.length; i++) {
      if (typeof this.syncQueue[i] === 'string') {
        const nb = getNb(this.syncQueue[i]);
        this.syncQueue[i] = {
          nbId: this.syncQueue[i],
          nbName: nb ? nb.name : '',
          action: 'upload',
          queuedAt: new Date().toISOString()
        };
      }
    }

    const due = this.syncQueue.filter(e => this._isUploadDue(e.nbId));
    if (due.length === 0) return;

    this.syncing = true;
    this._notify();

    let completedCount = 0;

    for (const entry of due) {
      if (!this.syncQueue.some(e => e.nbId === entry.nbId)) continue;

      const { nbId, nbName, action } = entry;

      try {
        if (action === 'delete' || action === 'trash') {
          // Cloud-Löschung: Datei in der Cloud löschen
          await this.deleteRemoteNotebookById(nbId);
          this._addSyncHistoryEntry({
            nbId, nbName, action,
            status: 'completed',
            reason: action === 'trash'
              ? (typeof t === 'function' ? t('syncDoneTrash') : 'In den Papierkorb verschoben')
              : (typeof t === 'function' ? t('syncDoneDelete') : 'Gelöscht')
          });
          if (action === 'trash' && typeof toast === 'function') {
            toast(typeof t === 'function'
              ? t('syncSuccessItem').replace('{name}', nbName || nbId).replace('{reason}', t('syncDoneTrash'))
              : `„${nbName || nbId}" in den Cloud-Papierkorb verschoben.`);
          }
        } else {
          // Hochladen. Auch ein 'restore' landet hier: das Heft lebt
          // wieder und muss deshalb in die Cloud - nur heisst der Vorgang
          // fuer den Nutzer eben "wiederhergestellt".
          await this._syncNotebook(nbId);
          this._addSyncHistoryEntry({
            nbId, nbName,
            /* Die Art wird UEBERNOMMEN, nicht auf 'upload' festgenagelt.
               Vorher stand jedes Zurueckholen im Protokoll als gewoehnlicher
               Upload mit der Begruendung "Fertig" - wer eben ein Heft aus
               dem Papierkorb geholt hatte, fand davon keine Spur. */
            action: action === 'restore' ? 'restore' : 'upload',
            status: 'completed',
            reason: action === 'restore'
              ? (typeof t === 'function' ? t('syncDoneRestore') : 'Wiederhergestellt')
              : (typeof t === 'function' ? t('syncDoneUpload') : 'Fertig')
          });
        }

        this._removeFromQueue(nbId);
        this.lastUploadAt.set(nbId, Date.now());
        this.immediateUploads.delete(nbId);
        delete this.retryCounts[nbId];
        completedCount++;
      } catch (err) {
        console.error('[CloudSync] Vorgang fehlgeschlagen für', nbId, action, err);

        this.retryCounts[nbId] = (this.retryCounts[nbId] || 0) + 1;
        const count = this.retryCounts[nbId];
        const msg = err.message || '';

        const isFatal = msg.includes('401') || msg.includes('403')
          || msg.includes('abgelaufen') || msg.includes('Speicherplatz')
          || msg.includes('quota') || count >= 3;

        if (isFatal) {
          this._removeFromQueue(nbId);
          this.immediateUploads.delete(nbId);
          delete this.retryCounts[nbId];
          this._addSyncHistoryEntry({
            nbId, nbName, action,
            status: 'failed',
            reason: count >= 3 ? `Nach ${count} Versuchen: ${msg}` : msg
          });
          if (typeof toast === 'function') {
            toast(count >= 3 ? `Sync fehlgeschlagen nach 3 Versuchen: ${msg}` : msg, true);
          }
        } else {
          this._addSyncHistoryEntry({
            nbId, nbName, action,
            status: 'failed',
            reason: msg
          });
          break;   // temporärer Fehler – später erneut
        }
      }
    }

    this.syncing = false;

    // Der Rückstand aus der Offline-Zeit ist abgearbeitet – einmal Bescheid
    // geben, sonst bleibt unklar, ob die Änderungen angekommen sind.
    if (this._hadOfflineBacklog && this.syncQueue.length === 0) {
      this._hadOfflineBacklog = false;
      if (typeof toast === 'function' && completedCount > 0) {
        const key = completedCount === 1 ? 'syncCaughtUp' : 'syncBacklogCleared';
        toast(typeof t === 'function'
          ? t(key).replace('{n}', completedCount)
          : `${completedCount} Offline-Änderung(en) hochgeladen.`);
      }
    }

    this._notify();
  }

  async _syncNotebook(nbId) {
    const notebook = getNb(nbId);
    if (!notebook) {
      this._removeFromQueue(nbId);
      return;
    }

    const localCopy = this._normalizeNotebook(notebook);
    localCopy.updatedAt = localCopy.updatedAt || new Date().toISOString();
    delete localCopy.syncedAt;   // reine Merkhilfe dieses Geräts

    await this._upsertRemoteNotebook(localCopy);

    notebook.syncedAt = localCopy.updatedAt;
    await Settings.update({ cloudLastSync: new Date().toISOString() });
  }

  /* ══════════════════════════════════════════════════════════════════
     DATEIEN
     ══════════════════════════════════════════════════════════════════ */

  async _listNotebookFiles() {
    const folderId = await this._getFolder();
    return this.provider.listNotebookFiles(this._http, folderId);
  }

  /**
   * Gehört diese Datei zu diesem Heft?
   *
   * >>> Warum es dafür zwei Wege braucht <<<
   * Beim HERUNTERLADEN kommt die Kennung eines Hefts aus dem Inhalt der
   * Datei (_denormalizeNotebook). Beim SUCHEN kam sie bisher nur aus dem
   * Dateinamen. Solange beide dasselbe sagen, fällt das nicht auf.
   *
   * Sagen sie es nicht – eine Datei aus einer älteren Fassung, eine von
   * OneDrive bei Namensgleichheit umbenannte („… 1.json"), oder eine, die
   * nach einem Wechsel des Anbieters unter dem anderen Muster liegt –,
   * dann entsteht ein Heft, das sich herunterladen, aber nicht löschen
   * lässt: der Papierkorb meldete „erledigt", ohne etwas getan zu haben,
   * die Datei blieb im Hauptordner liegen, und sobald der Eintrag im
   * Papierkorb weg war, kam das Heft beim nächsten Abgleich zurück.
   *
   * Der Inhalt wird nur gelesen, wenn der Name gar keine Kennung hergibt.
   * Ein Name, der eine nennt, gilt – dann ist die Antwort schon klar.
   */
  async _fileBelongsTo(file, nbId) {
    if (this.provider.matchesNotebook(file, { id: nbId, name: '' })) return true;
    if (file.inkwellId) return false;

    try {
      const json = await this.provider.downloadFile(this._http, file.id);
      return this._denormalizeNotebook(json, file)?.id === nbId;
    } catch (err) {
      console.warn('[CloudSync] Datei nicht lesbar:', file.name, err.message);
      return false;
    }
  }

  async _findRemoteFile(notebook) {
    const files = await this._listNotebookFiles();

    // Der schnelle Weg zuerst – er trifft in aller Regel
    const byName = files.find(f => this.provider.matchesNotebook(f, notebook));
    if (byName) return byName;

    for (const file of files) {
      if (!await this._fileBelongsTo(file, notebook.id)) continue;
      console.log('[CloudSync] Datei über ihren Inhalt zugeordnet:', file.name);
      return file;
    }

    return null;
  }

  async _loadRemoteNotebooks() {
    const files = await this._listNotebookFiles();
    const notebooks = [];

    for (const file of files) {
      try {
        const json = await this.provider.downloadFile(this._http, file.id);
        const notebook = this._denormalizeNotebook(json, file);
        if (notebook) notebooks.push(notebook);
      } catch (err) {
        console.warn('[CloudSync] Datei nicht lesbar:', file.name, err.message);
      }
    }

    return notebooks;
  }

  async _upsertRemoteNotebook(notebook) {
    const folderId = await this._getFolder();
    const existing = await this._findRemoteFile(notebook);
    return this.provider.upsertNotebook(this._http, {
      folderId,
      notebook,
      existingFileId: existing?.id || null
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     ABGLEICH
     ══════════════════════════════════════════════════════════════════ */

  async refreshRemote() {
    if (!this._canSync() || !this.isOnline) return [];

    // Papierkorb zuerst: erst danach ist bekannt, welche Hefte anderswo
    // gelöscht wurden und deshalb nicht wieder auftauchen dürfen.
    try {
      if (typeof Trash !== 'undefined' && Trash) await Trash.syncWithCloud();
    } catch (err) {
      console.warn('[CloudSync] Papierkorb-Abgleich übersprungen:', err.message);
    }

    const remote = await this._loadRemoteNotebooks();
    this._updateStorageUsage(remote);
    await this.refreshDriveQuota();

    if (typeof S !== 'undefined' && S.notebooks) {
      for (const localNb of S.notebooks) {
        const remoteNb = remote.find(r => r.id === localNb.id);
        const localTime = this._toTime(localNb.updatedAt);
        const remoteTime = remoteNb ? this._toTime(remoteNb.updatedAt) : 0;

        if (!remoteNb || localTime > remoteTime) {
          const inQueue = this.syncQueue.some(e => {
            return (typeof e === 'string' ? e : e.nbId) === localNb.id;
          });
          if (!inQueue) this.syncQueue.push({ nbId: localNb.id, nbName: localNb.name, action: 'upload', queuedAt: new Date().toISOString() });
        }
      }
      this._persistQueue();
      this._processQueue();
    }

    for (const remoteNotebook of remote) {
      await this._mergeRemoteNotebook(remoteNotebook);
    }

    await this._markSyncTime();
    this._notify();
    return remote;
  }

  async _mergeRemoteNotebook(remoteNotebook) {
    // Liegt das Heft im Papierkorb, darf es nicht wieder auftauchen
    if (typeof Trash !== 'undefined' && Trash?.find?.(remoteNotebook.id)) {
      console.log('[CloudSync] Übersprungen, liegt im Papierkorb:', remoteNotebook.id);
      return;
    }

    const existing = getNb(remoteNotebook.id);
    const remoteTime = this._toTime(remoteNotebook.updatedAt);
    const localTime = this._toTime(existing?.updatedAt);

    if (existing && AutoSave?.isDirty?.(existing.id)) return;

    if (existing && this._shouldKeepLocalNotebook(existing, remoteNotebook)) {
      console.warn('[CloudSync] Lokale Fassung ist reichhaltiger, nicht überschrieben:', existing.id);
      return;
    }

    if (existing && localTime >= remoteTime) return;

    // Konflikt: seit dem letzten Abgleich wurde hier und anderswo geändert
    if (existing) {
      const syncedTime = this._toTime(existing.syncedAt);
      if (localTime > syncedTime && remoteTime > syncedTime) {
        await this._saveConflictCopy(existing);
      }
    }

    const normalized = this._normalizeNotebook(remoteNotebook);
    normalized.updatedAt = remoteNotebook.updatedAt || normalized.updatedAt || new Date().toISOString();
    normalized.syncedAt = normalized.updatedAt;

    const index = S.notebooks.findIndex(nb => nb.id === normalized.id);
    if (index >= 0) S.notebooks[index] = normalized;
    else S.notebooks.push(normalized);

    try {
      await FileManager_.saveNotebook(normalized, { syncCloud: false, touch: false });
    } catch (err) {
      console.warn('[CloudSync] Konnte nicht lokal gespeichert werden:', err);
    }
  }

  async _saveConflictCopy(localNotebook) {
    try {
      const copy = JSON.parse(JSON.stringify(localNotebook));
      copy.id = uid();
      copy.name = `${localNotebook.name} (${t('conflictSuffix') || 'Konflikt'} ${fmt(new Date().toISOString())})`;
      copy.updatedAt = new Date().toISOString();
      delete copy.syncedAt;

      S.notebooks.push(copy);
      await FileManager_.saveNotebook(copy, { touch: false, immediateCloud: true });

      console.warn('[CloudSync] Konfliktkopie angelegt:', copy.name);
      if (typeof toast === 'function') {
        toast((t('conflictCreated') || 'Ein Heft wurde auf einem anderen Gerät geändert. Deine Fassung wurde als „{name}“ gesichert.')
          .replace('{name}', copy.name), true);
      }
      if (typeof renderHomeGrid === 'function') renderHomeGrid();
    } catch (err) {
      console.error('[CloudSync] Konfliktkopie fehlgeschlagen:', err);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     PAPIERKORB IN DER CLOUD
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Schiebt die Cloud-Datei eines Hefts in den Papierkorb-Unterordner.
   *
   * >>> Warum die Antwort zwei Angaben braucht <<<
   * Vorher kam in drei ganz verschiedenen Fällen dasselbe `null` zurück:
   * „kein Netz", „nicht angemeldet" und „es gibt dort gar keine Datei".
   * Der Papierkorb konnte daran nicht erkennen, ob die Cloud-Seite erledigt
   * ist – er hakte den Eintrag in allen drei Fällen ab. Blieb die Datei in
   * Wirklichkeit liegen, brachte sie der nächste Abgleich zurück, sobald
   * der Papierkorb-Eintrag ablief oder geleert wurde.
   *
   * @returns {Promise<{done: boolean, fileId: string|null}>}
   *   done = die Cloud ist auf dem gewünschten Stand (verschoben oder es
   *   war nichts da). false heißt: später noch einmal versuchen.
   */
  async trashRemoteNotebook(nbId) {
    if (!this._canSync() || !this.isOnline) return { done: false, fileId: null };

    this._removeFromQueue(nbId);
    this.immediateUploads.delete(nbId);
    this.lastUploadAt.delete(nbId);

    try {
      const file = await this._findRemoteFile({ id: nbId, name: '' });
      if (!file) return { done: true, fileId: null };

      const folderId = await this._getFolder();
      const trashFolderId = await this._getTrashFolder();

      /* Die Kennung kann sich beim Verschieben ändern: OneDrive führt den
         Umzug im App-Ordner nicht immer aus und legt die Datei dann am
         Zielort neu an. Der alte Wert zeigte danach ins Leere, und das
         endgültige Löschen fand nichts mehr. */
      const movedId = await this.provider.moveFile(this._http, file.id, folderId, trashFolderId) || file.id;

      /* >>> Nachsehen, ob es wirklich weg ist <<<
         Ein Verschieben, das die Cloud stillschweigend nicht ausführt, sah
         bisher wie ein Erfolg aus: der Eintrag galt als erledigt und wurde
         nie wieder versucht, während die Datei im Hauptordner liegen
         blieb. Dort sieht sie die Website weiterhin, und beim nächsten
         Abgleich holt sie das Heft zurück.

         _findRemoteFile sieht nur im Hauptordner nach – ist die Datei
         danach noch da, hat das Verschieben nichts bewirkt. */
      if (await this._findRemoteFile({ id: nbId, name: '' })) {
        console.warn('[CloudSync] Datei liegt nach dem Verschieben noch im Hauptordner:', nbId);
        return { done: false, fileId: movedId };
      }

      console.log('[CloudSync] Heft in den Cloud-Papierkorb verschoben:', nbId);
      return { done: true, fileId: movedId };
    } catch (err) {
      console.warn('[CloudSync] Cloud-Papierkorb fehlgeschlagen:', err.message);
      return { done: false, fileId: null };
    }
  }

  /**
   * Die Kennungen aller Hefte, die noch im HAUPTORDNER der Cloud liegen.
   *
   * >>> Wofür der Papierkorb das braucht <<<
   * Der Vermerk „cloudTrashed" hieß bisher nur „es wurde versucht". Blieb
   * die Datei dabei liegen, wurde der Eintrag nie wieder angefasst: in der
   * App war das Heft weg, in der Cloud und damit auf der Website stand es
   * für immer weiter da. Damit lässt sich das nachträglich erkennen.
   *
   * @returns {Promise<string[]|null>} null = nicht angemeldet, ohne Netz
   *   oder nicht lesbar. Eine leere Liste heißt: der Hauptordner ist leer.
   */
  async listRemoteNotebookIds() {
    if (!this._canSync() || !this.isOnline) return null;

    try {
      const files = await this._listNotebookFiles();
      // Derselbe Rückfall wie in matchesNotebook: ohne eigene Kennung ist
      // der Dateiname ohne Endung die Kennung.
      return files
        .map(f => f.inkwellId || String(f.name || '').replace(/\.(json|jrnl)$/i, ''))
        .filter(Boolean);
    } catch (err) {
      console.warn('[CloudSync] Hauptordner nicht lesbar:', err.message);
      return null;
    }
  }

  /**
   * Löscht jede Cloud-Datei zu einem Heft – im Hauptordner UND im
   * Papierkorb-Unterordner.
   *
   * Gebraucht für Einträge, deren Datei-Kennung nie ankam (Löschen ohne
   * Netz). Ohne diesen Weg bliebe die Datei nach dem endgültigen Löschen
   * im Hauptordner liegen und der nächste Abgleich lüde das Heft wieder
   * herunter.
   */
  async deleteRemoteNotebookById(nbId) {
    if (!this._canSync() || !this.isOnline || !nbId) return false;

    /* >>> Die beiden Ordner getrennt behandeln <<<
       Vorher wurden beide vorab geholt. War der Papierkorb-Ordner nicht zu
       bekommen, brach der ganze Aufruf ab – auch für den HAUPTORDNER, und
       genau der ist der, den die Website zeigt. Ein unerreichbarer
       Nebenschauplatz darf das Wichtigste nicht verhindern. */
    let deleted = false;

    for (const getFolder of [() => this._getFolder(), () => this._getTrashFolder()]) {
      try {
        const folderId = await getFolder();
        if (!folderId) continue;

        const files = await this.provider.listNotebookFiles(this._http, folderId);
        for (const file of files) {
          // Notfalls über den Inhalt – siehe _fileBelongsTo. Ohne das blieb
          // genau die Datei liegen, die das Heft zurückgebracht hat.
          if (!await this._fileBelongsTo(file, nbId)) continue;
          await this.provider.deleteFile(this._http, file.id);
          deleted = true;
        }
      } catch (err) {
        console.warn('[CloudSync] Endgültiges Löschen über die Kennung fehlgeschlagen:', err.message);
      }
    }

    return deleted;
  }

  /**
   * Liegt zu diesem Heft noch IRGENDEINE Datei in der Cloud – im
   * Hauptordner oder im Papierkorb-Unterordner?
   *
   * Gebraucht beim endgültigen Löschen: erst wenn das sicher verneint
   * ist, darf der Papierkorb-Eintrag verschwinden. Sonst bliebe die
   * Datei liegen und niemand versuchte es je wieder.
   *
   * @returns {Promise<boolean|null>} null = nicht feststellbar (kein
   *   Netz, nicht angemeldet, Ordner nicht lesbar). Dann NICHTS annehmen.
   */
  async remoteNotebookExists(nbId) {
    if (!this._canSync() || !this.isOnline || !nbId) return null;

    for (const getFolder of [() => this._getFolder(), () => this._getTrashFolder()]) {
      let folderId;
      try {
        folderId = await getFolder();
      } catch (err) {
        return null;
      }
      if (!folderId) return null;

      let files;
      try {
        files = await this.provider.listNotebookFiles(this._http, folderId);
      } catch (err) {
        console.warn('[CloudSync] Ordner nicht lesbar:', err.message);
        return null;
      }

      for (const file of files) {
        if (await this._fileBelongsTo(file, nbId)) return true;
      }
    }

    return false;
  }

  async untrashRemoteNotebook(fileId) {
    if (!this._canSync() || !this.isOnline || !fileId) return null;

    try {
      const folderId = await this._getFolder();
      const trashFolderId = await this._getTrashFolder();
      // Auch hier kann die Datei am Zielort eine neue Kennung bekommen –
      // heruntergeladen wird die, die jetzt wirklich im Hauptordner liegt.
      const movedId = await this.provider.moveFile(this._http, fileId, trashFolderId, folderId) || fileId;
      return this.provider.downloadFile(this._http, movedId);
    } catch (err) {
      console.warn('[CloudSync] Zurückholen aus dem Cloud-Papierkorb fehlgeschlagen:', err.message);
      return null;
    }
  }

  async deleteRemoteFile(fileId) {
    if (!this._canSync() || !this.isOnline || !fileId) return false;
    try {
      await this.provider.deleteFile(this._http, fileId);
      return true;
    } catch (err) {
      console.warn('[CloudSync] Endgültiges Löschen fehlgeschlagen:', err.message);
      return false;
    }
  }

  /**
   * Die gemeinsame Papierkorb-Liste aus der Cloud.
   *
   * @returns {Promise<{entries: object[], exists: boolean}|null>}
   *   null = nicht angemeldet, ohne Netz oder nicht lesbar.
   *
   * >>> Warum „gibt es nicht" und „ist leer" auseinandergehalten werden <<<
   * Beides lieferte früher dieselbe leere Liste. Trash.syncWithCloud
   * schließt aus einem fehlenden Eintrag aber, das Heft sei auf einem
   * anderen Gerät zurückgeholt oder endgültig gelöscht worden – und wirft
   * es aus dem Papierkorb.
   *
   * Gibt es die Liste gar nicht, ist dieser Schluss falsch: dann weiß die
   * Cloud noch gar nichts, statt etwas anderes zu wissen. Genau das
   * passierte nach einem Ab- und Anmelden und beim Wechsel des Anbieters –
   * der Papierkorb wurde vollständig geleert, und beim nächsten Abgleich
   * kam jedes je gelöschte Heft zurück.
   */
  async loadTrashIndex() {
    if (!this._canSync() || !this.isOnline) return null;

    try {
      const folderId = await this._getFolder();
      const fileId = await this.provider.findIndexFile(this._http, folderId, TRASH_INDEX_NAME);
      if (!fileId) return { entries: [], exists: false };

      const json = await this.provider.downloadFile(this._http, fileId);
      return { entries: Array.isArray(json?.entries) ? json.entries : [], exists: true };
    } catch (err) {
      console.warn('[CloudSync] Papierkorb-Liste nicht lesbar:', err.message);
      return null;
    }
  }

  async saveTrashIndex(entries) {
    if (!this._canSync() || !this.isOnline) return false;

    try {
      const folderId = await this._getFolder();
      const existingId = await this.provider.findIndexFile(this._http, folderId, TRASH_INDEX_NAME);
      await this.provider.saveIndexFile(this._http, {
        folderId,
        existingId,
        name: TRASH_INDEX_NAME,
        payload: { updatedAt: new Date().toISOString(), entries }
      });
      return true;
    } catch (err) {
      console.warn('[CloudSync] Papierkorb-Liste nicht speicherbar:', err.message);
      return false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     FRÜHERE FASSUNGEN
     ══════════════════════════════════════════════════════════════════ */

  async listVersions(nbId) {
    if (!this.isConfigured()) throw new Error(`Zugangsdaten für ${this.provider.label} fehlen.`);
    if (!this.isAuthenticated()) throw new Error('Nicht angemeldet.');
    if (!this.isOnline) throw new Error('Keine Internetverbindung.');

    const file = await this._findRemoteFile({ id: nbId, name: '' });
    if (!file) return [];

    const versions = await this.provider.listVersions(this._http, file.id);
    return versions
      .map(v => ({ ...v, fileId: file.id }))
      .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
  }

  async loadVersion(fileId, versionId) {
    return this.provider.downloadVersion(this._http, fileId, versionId);
  }

  async restoreVersion(nbId, fileId, versionId) {
    const json = await this.loadVersion(fileId, versionId);
    const notebook = this._denormalizeNotebook(json, { inkwellId: nbId });
    if (!notebook) throw new Error('Diese Fassung lässt sich nicht lesen.');

    notebook.id = nbId;
    notebook.updatedAt = new Date().toISOString();

    const index = S.notebooks.findIndex(nb => nb.id === nbId);
    if (index >= 0) S.notebooks[index] = notebook;
    else S.notebooks.push(notebook);

    await FileManager_.saveNotebook(notebook, { touch: false, immediateCloud: true });
    return notebook;
  }

  /* ══════════════════════════════════════════════════════════════════
     SPEICHERPLATZ
     ══════════════════════════════════════════════════════════════════ */

  getStorageUsage() {
    return this.totalStorageUsed || 0;
  }

  getDriveQuota() {
    return this.driveQuota;
  }

  async refreshDriveQuota() {
    if (!this._canSync() || !this.isOnline) return null;

    try {
      this.driveQuota = await this.provider.getQuota(this._http);
    } catch (err) {
      console.warn('[CloudSync] Speicherinfo nicht verfügbar:', err.message);
      this.driveQuota = null;
    }
    return this.driveQuota;
  }

  _updateStorageUsage(remoteNotebooks) {
    let bytes = 0;
    for (const nb of remoteNotebooks) {
      try {
        bytes += new Blob([JSON.stringify(nb)]).size;
      } catch (e) {
        bytes += JSON.stringify(nb).length;
      }
    }
    this.totalStorageUsed = bytes;
  }

  /* ══════════════════════════════════════════════════════════════════
     VERBINDUNG UND SITZUNG
     ══════════════════════════════════════════════════════════════════ */

  /**
   * navigator.onLine meldet nur, ob überhaupt ein Netzwerk anliegt – ein
   * Hotelnetz mit Anmeldeseite gilt dort als "online". Wo es geht, wird
   * deshalb zusätzlich wirklich nachgesehen (main.js: check-internet).
   */
  async _checkConnectivity() {
    const wasOnline = this.isOnline;
    let online = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (online && window.api?.checkInternet) {
      try {
        const reachable = await window.api.checkInternet();
        online = reachable === false ? false : true;
      } catch (e) { /* im Zweifel als online behandeln */ }
    }

    if (online !== wasOnline) {
      await this._onConnectivityChange(online);
      return online;
    }

    this.isOnline = online;
    this._notify();
    return online;
  }

  async _onConnectivityChange(online) {
    const wasOffline = !this.isOnline;
    this.isOnline = online;
    this._notify();

    if (!online) return;

    this._offlineToastShown = false;

    // Zurück im Netz: was liegen geblieben ist, sofort hochladen statt den
    // üblichen Mindestabstand abzuwarten.
    if (wasOffline && this.syncQueue.length && this._canSync()) {
      this._hadOfflineBacklog = true;
      for (const e of this.syncQueue) {
        const id = typeof e === 'string' ? e : e.nbId;
        this.immediateUploads.add(id);
      }
      if (typeof toast === 'function') {
        const count = this.syncQueue.length;
        const first = this.syncQueue[0];
        const name = typeof first === 'object' ? first.nbName : '';
        if (count === 1 && name) {
          toast(typeof t === 'function'
            ? t('syncBackOnlineNamed').replace('{name}', name).replace('{n}', '0')
            : `Wieder online – „${name}" wird hochgeladen…`);
        } else if (count > 1 && name) {
          toast(typeof t === 'function'
            ? t('syncBackOnlineNamed').replace('{name}', name).replace('{n}', count - 1)
            : `Wieder online – „${name}" und ${count - 1} weitere werden hochgeladen…`);
        } else {
          toast(typeof t === 'function' ? t('syncBackOnline') : 'Wieder online – ausstehende Änderungen werden hochgeladen…');
        }
      }
    }

    await this._processQueue();

    /* >>> Auch der Papierkorb war offline liegen geblieben <<<
       Ein Heft, das ohne Netz gelöscht wurde, liegt in der Cloud noch im
       Hauptordner: das Verschieben in den Cloud-Papierkorb ist schlicht
       nicht durchgekommen. Der Eintrag merkt sich das (cloudTrashed:
       false) und Trash._catchUpCloudTrash() holt es nach – nur wurde das
       bis hierher ausschließlich beim Programmstart und von Hand
       ausgelöst. Wer die App durchlaufen ließ, bekam das Löschen deshalb
       nie in die Cloud, während normale Speicherungen längst oben waren.
       Genau der Unterschied, der aufgefallen ist. */
    await this._catchUpTrash();
  }

  /** Holt nach, was der Papierkorb ohne Netz nicht erledigen konnte. */
  async _catchUpTrash() {
    if (!this._canSync() || !this.isOnline) return;
    if (typeof Trash === 'undefined' || !Trash) return;

    try {
      await Trash.syncWithCloud();
    } catch (err) {
      console.warn('[CloudSync] Papierkorb-Abgleich fehlgeschlagen:', err?.message || err);
    }
  }

  async _restoreSession() {
    const token = Settings.get('cloudAccessToken');
    if (!token || !this.isConfigured()) {
      this._session = null;
      return;
    }

    if (this.isTokenExpired()) {
      // Erneuerbar? Dann still auffrischen statt abmelden.
      if (this.provider.supportsRefresh && await this._refreshSession()) {
        // weiter unten die Sitzung aufbauen
      } else {
        console.log('[CloudSync] Gespeichertes Token ist abgelaufen');
        this._session = null;
        await Settings.update({ cloudAccessToken: '', cloudTokenExpiry: 0, cloudSessionLost: true });
        return;
      }
    }

    this._session = {
      provider: this.getProviderId(),
      accessToken: Settings.get('cloudAccessToken'),
      expiry: Number(Settings.get('cloudTokenExpiry')) || 0,
      userId: Settings.get('cloudUserId') || '',
      userEmail: Settings.get('cloudEmail') || '',
      userName: Settings.get('cloudUserName') || Settings.get('cloudEmail') || '',
      userPicture: Settings.get('cloudUserPicture') || ''
    };
  }

  /* ══════════════════════════════════════════════════════════════════
     HILFSFUNKTIONEN
     ══════════════════════════════════════════════════════════════════ */

  _normalizeNotebook(notebook) {
    return JSON.parse(JSON.stringify({
      ...notebook,
      updatedAt: notebook.updatedAt || new Date().toISOString()
    }));
  }

  _denormalizeNotebook(json, file) {
    if (!json || typeof json !== 'object') return null;
    // Manche Dateien liegen im alten Format { notebooks: [...] } vor
    const raw = Array.isArray(json.notebooks) ? json.notebooks[0] : json;
    if (!raw || typeof raw !== 'object') return null;

    const notebook = JSON.parse(JSON.stringify(raw));
    notebook.id = notebook.id || file?.inkwellId || file?.id;
    notebook.name = notebook.name
      || (file?.name || 'Untitled').replace(/\.(json|jrnl)$/i, '').split('__')[0];
    notebook.updatedAt = notebook.updatedAt || file?.modifiedTime || new Date().toISOString();

    /* Aus der Cloud kommt, was ein anderes Gerät hochgeladen hat – auch von
       einem Stand ohne den Etiketten-Umbau. Hier ist der Eingang, an dem so
       ein Heft umgestellt wird (core/data.js). */
    if (typeof normalizeNotebook === 'function') normalizeNotebook(notebook);
    return notebook;
  }

  _shouldKeepLocalNotebook(localNotebook, remoteNotebook) {
    const localPages = Array.isArray(localNotebook?.pages) ? localNotebook.pages : [];
    const remotePages = Array.isArray(remoteNotebook?.pages) ? remoteNotebook.pages : [];

    if (!remotePages.length && localPages.length) return true;
    if (localPages.length > remotePages.length) return true;

    const l = this._notebookContentStats(localNotebook);
    const r = this._notebookContentStats(remoteNotebook);

    const remoteScore = r.textChars + r.inkPoints + r.objectCount + (r.pageCount * 1000);
    const localScore = l.textChars + l.inkPoints + l.objectCount + (l.pageCount * 1000);

    return localScore > remoteScore * 1.25;
  }

  _notebookContentStats(notebook) {
    const pages = Array.isArray(notebook?.pages) ? notebook.pages : [];
    let textChars = 0, inkPoints = 0, objectCount = 0;

    for (const page of pages) {
      const text = typeof page?.textContent === 'string' ? page.textContent : '';
      textChars += text.replace(/<[^>]+>/g, '').replace(/\s/g, '').length;

      if (Array.isArray(page?.inkStrokes)) {
        for (const stroke of page.inkStrokes) {
          const path = Array.isArray(stroke?.path) ? stroke.path
            : Array.isArray(stroke?.points) ? stroke.points : [];
          inkPoints += path.length;
        }
      }
      if (Array.isArray(page?.objects)) objectCount += page.objects.length;
    }

    return { pageCount: pages.length, textChars, inkPoints, objectCount };
  }

  _toTime(value) {
    const time = value ? Date.parse(value) : 0;
    return Number.isFinite(time) ? time : 0;
  }

  async _markSyncTime() {
    await Settings.update({ cloudLastSync: new Date().toISOString() });
  }

  /* ══════════════════════════════════════════════════════════════════
     SYNC-VERLAUF
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Hängt einen Eintrag an das Sync-Protokoll an. Maximal 30 Einträge;
   * ältere werden entfernt. Das Protokoll überlebt einen Neustart.
   */
  _addSyncHistoryEntry({ nbId, nbName, action, status, reason }) {
    const entry = {
      id: typeof uid === 'function' ? uid() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      nbId,
      nbName: nbName || '',
      action: action || 'upload',
      status: status || 'pending',
      reason: reason || '',
      at: new Date().toISOString()
    };

    this._syncHistory.push(entry);
    if (this._syncHistory.length > 30) {
      this._syncHistory = this._syncHistory.slice(-30);
    }

    // Ohne await: das Protokollieren darf den Abgleich nicht bremsen
    Settings.update({ cloudSyncLog: this._syncHistory }).catch(() => {});
  }

  /** Lädt das Sync-Protokoll aus den Einstellungen. */
  _loadSyncHistory() {
    const stored = Settings.get('cloudSyncLog');
    if (Array.isArray(stored)) this._syncHistory = stored.slice(-30);
  }

  /**
   * Gibt die ausstehenden Vorgänge als lesbare Liste zurück.
   * @returns {Array<{nbId, nbName, action, queuedAt}>}
   */
  getPendingActions() {
    return this.syncQueue.map(e => {
      if (typeof e === 'string') {
        const nb = getNb(e);
        return { nbId: e, nbName: nb ? nb.name : '', action: 'upload', queuedAt: '' };
      }
      return { ...e };
    });
  }

  /**
   * Gibt das Sync-Protokoll zurück (max. 30 Einträge, neueste zuerst).
   * @returns {Array<{id, nbId, nbName, action, status, reason, at}>}
   */
  getSyncHistory() {
    return [...this._syncHistory].reverse();
  }

  /** Löscht das Sync-Protokoll. */
  async clearSyncLog() {
    this._syncHistory = [];
    await Settings.update({ cloudSyncLog: [] });
    this._notify();
  }

  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      const index = this._listeners.indexOf(callback);
      if (index > -1) this._listeners.splice(index, 1);
    };
  }

  _notify() {
    // Feste Texte tragen den Anbieternamen ("OneDrive belegt:") – nach einem
    // Wechsel müssen sie neu übersetzt werden.
    if (typeof refreshProviderTexts === 'function') {
      try { refreshProviderTexts(); } catch (e) { /* Anzeige darf nie den Sync stoppen */ }
    }

    const payload = {
      status: this.getStatus(),
      provider: this.getProviderId(),
      isOnline: this.isOnline,
      queueLength: this.syncQueue.length,
      syncing: this.syncing,
      session: this._session,
      pendingActions: this.getPendingActions(),
      syncHistory: this.getSyncHistory()
    };

    for (const callback of this._listeners) {
      try {
        callback(payload);
      } catch (err) {
        console.error('[CloudSync] Listener error:', err);
      }
    }
  }
}

const CloudSync_ = new CloudSyncManager();
window.CloudSync_ = CloudSync_;

// Callback-Listener sofort registrieren, damit eine Anmeldung auch dann
// ankommt, wenn Cloud-Sync vorher noch nie aktiv war.
if (window.api && window.api.onOAuthCallback) {
  CloudSync_._registerOAuthCallback();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    CloudSync_._registerOAuthCallback();
  }, { once: true });
}
