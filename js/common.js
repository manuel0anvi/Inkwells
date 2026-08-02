/* ══════════════════════════════════════════════════════════════════════
   Gemeinsame Logik aller Website-Seiten.
   Anmeldung wahlweise über Google oder Microsoft (siehe js/config.js
   und js/providers.js).
   ══════════════════════════════════════════════════════════════════════ */

const INKWELL_TOKEN_KEY = 'inkwell_cloud_token';
const INKWELL_REFRESH_KEY = 'inkwell_cloud_refresh';
const INKWELL_EXPIRY_KEY = 'inkwell_cloud_expiry';
const INKWELL_UID_KEY = 'inkwell_cloud_uid';
const INKWELL_EMAIL_KEY = 'inkwell_cloud_email';
const INKWELL_NAME_KEY = 'inkwell_cloud_name';
const INKWELL_PICTURE_KEY = 'inkwell_cloud_picture';
const INKWELL_PROVIDER_KEY = 'inkwell_cloud_provider';

/* ── Anbieter ─────────────────────────────────────────────────────── */

function getActiveProviderId() {
  const stored = localStorage.getItem(INKWELL_PROVIDER_KEY);
  if (stored && CLOUD_PROVIDERS.includes(stored)) return stored;
  return defaultCloudProvider();
}

function getActiveProvider() {
  return getCloudProvider(getActiveProviderId());
}

/* ── Session ──────────────────────────────────────────────────────── */

function getInkwellSession() {
  const token = localStorage.getItem(INKWELL_TOKEN_KEY);
  const uid = localStorage.getItem(INKWELL_UID_KEY);
  const expiry = Number(localStorage.getItem(INKWELL_EXPIRY_KEY) || 0);

  if (!token || !uid) return null;
  if (expiry && Date.now() >= expiry) {
    // Nur das abgelaufene Token verwerfen. E-Mail und Name bleiben, damit
    // die stille Erneuerung einen Hinweis auf das Konto hat und der Login
    // danach ein einziger Klick ist.
    expireInkwellToken();
    return null;
  }

  return {
    provider: getActiveProviderId(),
    accessToken: token,
    refreshToken: localStorage.getItem(INKWELL_REFRESH_KEY) || '',
    userId: uid,
    email: localStorage.getItem(INKWELL_EMAIL_KEY) || '',
    name: localStorage.getItem(INKWELL_NAME_KEY) || '',
    picture: localStorage.getItem(INKWELL_PICTURE_KEY) || '',
    expiry
  };
}

function saveInkwellSession(session) {
  localStorage.setItem(INKWELL_TOKEN_KEY, session.accessToken);
  localStorage.setItem(INKWELL_REFRESH_KEY, session.refreshToken || '');
  localStorage.setItem(INKWELL_UID_KEY, session.userId);
  localStorage.setItem(INKWELL_EXPIRY_KEY, String(session.expiry || 0));
  localStorage.setItem(INKWELL_EMAIL_KEY, session.email || '');
  localStorage.setItem(INKWELL_NAME_KEY, session.name || '');
  localStorage.setItem(INKWELL_PICTURE_KEY, session.picture || '');
  if (session.provider) localStorage.setItem(INKWELL_PROVIDER_KEY, session.provider);
}

// Nur das Token entwerten (Ablauf), Konto-Angaben behalten
function expireInkwellToken() {
  [INKWELL_TOKEN_KEY, INKWELL_UID_KEY, INKWELL_EXPIRY_KEY]
    .forEach(k => localStorage.removeItem(k));
}

// Vollständige Abmeldung: alles weg
function clearInkwellSession() {
  [INKWELL_TOKEN_KEY, INKWELL_REFRESH_KEY, INKWELL_UID_KEY, INKWELL_EXPIRY_KEY,
   INKWELL_EMAIL_KEY, INKWELL_NAME_KEY, INKWELL_PICTURE_KEY]
    .forEach(k => localStorage.removeItem(k));

  // Reste aus früheren Fassungen
  ['inkwell_web_token', 'inkwell_web_uid', 'inkwell_gdrive_token',
   'inkwell_google_token', 'inkwell_google_uid', 'inkwell_google_expiry',
   'inkwell_google_email', 'inkwell_google_name', 'inkwell_google_picture']
    .forEach(k => localStorage.removeItem(k));
}

function getRememberedEmail() {
  return localStorage.getItem(INKWELL_EMAIL_KEY) || '';
}

function isInkwellLoggedIn() {
  return !!getInkwellSession();
}

/* ── Stille Token-Erneuerung ──────────────────────────────────────────
   Ein Zugriffstoken ist nur etwa eine Stunde gültig. Ohne Erneuerung
   wirkt das wie ein zufälliges Abmelden.

   · Google  : über den Identity-Dienst (GIS), Fenster im Hintergrund.
   · Microsoft: über das Refresh-Token – das gibt Microsoft öffentlichen
               Anwendungen auch ohne Client-Secret heraus.
   ─────────────────────────────────────────────────────────────────────── */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let _gisPromise = null;
let _tokenClient = null;
let _refreshPromise = null;
let _pendingRequest = null;

function loadGis() {
  if (_gisPromise) return _gisPromise;

  _gisPromise = new Promise((resolve) => {
    if (window.google?.accounts?.oauth2) return resolve(true);
    // Über file:// funktioniert GIS nicht – dann direkt der Fallback
    if (window.location.protocol === 'file:') return resolve(false);

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve(!!window.google?.accounts?.oauth2);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return _gisPromise;
}

// Der Token-Client wird einmal erzeugt; die Rückmeldungen jeder einzelnen
// Anfrage laufen über _pendingRequest, damit callback und error_callback
// schon bei der Erzeugung feststehen.
async function getTokenClient() {
  if (_tokenClient) return _tokenClient;
  if (!cloudProviderIsConfigured('google')) return null;
  if (!(await loadGis())) return null;

  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: (response) => {
      const req = _pendingRequest;
      _pendingRequest = null;
      if (!req) return;
      if (response.error) req.reject(new Error(response.error));
      else req.resolve(response);
    },
    error_callback: (err) => {
      const req = _pendingRequest;
      _pendingRequest = null;
      if (req) req.reject(new Error(err?.type || 'token_request_failed'));
    }
  });
  return _tokenClient;
}

// prompt: '' = still, ohne Fenster. prompt: 'consent' = mit Zustimmungsdialog.
function requestToken(client, prompt, hint) {
  return new Promise((resolve, reject) => {
    if (_pendingRequest) return reject(new Error('request_in_progress'));
    _pendingRequest = { resolve, reject };

    const timer = setTimeout(() => {
      if (_pendingRequest) {
        _pendingRequest = null;
        reject(new Error('timeout'));
      }
    }, 30000);

    const done = () => clearTimeout(timer);
    _pendingRequest.resolve = (v) => { done(); resolve(v); };
    _pendingRequest.reject = (e) => { done(); reject(e); };

    try {
      client.requestAccessToken(hint ? { prompt, hint } : { prompt });
    } catch (err) {
      _pendingRequest = null;
      done();
      reject(err);
    }
  });
}

/** Speichert Tokens plus Profil als Sitzung. */
async function applyTokens(providerId, { accessToken, refreshToken, expiresIn, idToken, rawNonce }) {
  const provider = getCloudProvider(providerId);
  const profile = await provider.fetchProfile(accessToken);

  const session = {
    provider: providerId,
    accessToken,
    refreshToken: refreshToken || '',
    userId: profile.userId,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
    expiry: Date.now() + Math.max(0, (expiresIn || 3600) - 60) * 1000
  };
  saveInkwellSession(session);

  // Dieselbe Anmeldung auch gegenüber Firebase gültig machen. Bewusst ohne
  // await: schlägt es fehl, funktioniert das Dashboard ganz normal weiter,
  // nur eben ohne geteilte Dokumente.
  if (idToken) linkFirebaseIdentity(providerId, idToken, rawNonce);

  return session;
}

/* ── Firebase-Kennung ─────────────────────────────────────────────────
   js/share.js ist ein ES-Modul und meldet sich über das Ereignis
   "inkwell-share-ready". Auf Seiten ohne dieses Modul passiert hier
   schlicht nichts.
   ─────────────────────────────────────────────────────────────────── */

function whenInkwellShareReady(timeoutMs = 15000) {
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

async function linkFirebaseIdentity(providerId, idToken, rawNonce) {
  try {
    const api = await whenInkwellShareReady();
    await api.signInWithProviderToken({ provider: providerId, idToken, rawNonce });
    console.log('[Auth] Firebase-Kennung hergestellt:', api.currentIdentity()?.email || '?');

    // Freigaben, die noch der anonymen Gerätekennung gehören, dem Konto
    // zuschlagen – sonst ließen sie sich hier nicht mehr aufheben.
    try {
      const raw = JSON.parse(localStorage.getItem('inkwell_shares') || '{}');
      const ids = Object.values(raw || {}).map(e => e?.shareId).filter(Boolean);
      const claimed = await api.claimOwnShares(ids);
      if (claimed > 0) console.log('[Auth]', claimed, 'Freigabe(n) übernommen');
    } catch (e) { /* Merkliste kaputt – nicht schlimm */ }

    document.dispatchEvent(new CustomEvent('inkwell-identity-changed'));
    return true;
  } catch (err) {
    console.warn('[Auth] Firebase-Anmeldung fehlgeschlagen:', err?.message || err);
    return false;
  }
}

/**
 * Ist die Firebase-Kennung nutzbar? Sie hält sich von selbst über
 * Seitenwechsel hinweg; erst wenn sie fehlt, muss neu angemeldet werden.
 */
async function inkwellIdentityReady() {
  try {
    const api = await whenInkwellShareReady(8000);
    await api.whenIdentityReady();
    if (!api.hasRealIdentity()) return null;

    /* >>> Kennt Firebase noch jemand ANDEREN? <<<
       Eine Sitzung, die von einem früheren Konto stehen geblieben ist,
       würde die geteilten Dokumente dauerhaft unter der alten Adresse
       suchen. Sie wird weggeräumt; die Anmeldung mit der richtigen
       Adresse holt linkFirebaseIdentity() danach nach. */
    const known = api.currentIdentity();
    const wanted = api.normalizeEmail(getRememberedEmail() || '');
    if (wanted && known.email !== wanted) {
      console.warn('[Auth] Firebase kennt noch', known.email, '– erwartet wird', wanted);
      try { await api.signOutIdentity(); } catch (e) { /* ohne Netz: beim nächsten Mal */ }
      return null;
    }

    return known;
  } catch (err) {
    return null;
  }
}

/**
 * Sorgt für ein gültiges Token. Gibt die Sitzung zurück oder null, wenn
 * eine echte Neuanmeldung nötig ist. Mehrfachaufrufe teilen sich den Vorgang.
 */
async function ensureFreshToken(minRemainingMs = 5 * 60 * 1000) {
  const current = getInkwellSession();
  if (current && current.expiry - Date.now() > minRemainingMs) return current;

  if (_refreshPromise) return _refreshPromise;

  const providerId = getActiveProviderId();
  const provider = getCloudProvider(providerId);
  const hint = current?.email || getRememberedEmail();
  const storedRefresh = localStorage.getItem(INKWELL_REFRESH_KEY) || '';

  _refreshPromise = (async () => {
    try {
      // Microsoft: über das Refresh-Token
      if (provider.refresh && storedRefresh) {
        const tokens = await provider.refresh(storedRefresh);
        if (tokens?.accessToken) {
          const session = await applyTokens(providerId, tokens);
          console.log('[Auth] OneDrive-Sitzung still erneuert');
          return session;
        }
      }

      // Google: über den Identity-Dienst
      if (providerId === 'google') {
        const client = await getTokenClient();
        if (!client) return current || null;

        const response = await requestToken(client, '', hint);
        const session = await applyTokens('google', {
          accessToken: response.access_token,
          expiresIn: parseInt(response.expires_in || '3600', 10)
        });
        console.log('[Auth] Google-Token still erneuert');
        return session;
      }

      return getInkwellSession();
    } catch (err) {
      console.warn('[Auth] Stille Erneuerung nicht möglich:', err.message);
      return getInkwellSession();
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

/* ── Anmeldung ────────────────────────────────────────────────────── */

// Eigene Domain der Website (siehe website/CNAME). Wird nur gebraucht, wenn
// die Seite ohne echte Herkunftsadresse geöffnet wurde – etwa per Doppelklick
// auf die HTML-Datei. Im Normalbetrieb ergibt sie sich aus der Adresszeile.
const INKWELL_SITE_URL = 'https://inkwells.me/';

function inkwellLoginRedirectUri() {
  if (!window.location.origin || window.location.origin === 'null' || window.location.protocol === 'file:') {
    return INKWELL_SITE_URL;
  }
  // Der Login läuft immer über die Startseite, damit je Anbieter nur EINE
  // Weiterleitungs-Adresse hinterlegt werden muss.
  const path = window.location.pathname;
  const root = path.replace(/(dashboard|community|datenschutz)\/?$/, '');
  return window.location.origin + (root.endsWith('/') ? root : root + '/');
}

/**
 * Startet die Anmeldung.
 * @param {string} [returnTo] Ziel nach erfolgreicher Anmeldung
 * @param {string} [providerId] 'google' | 'microsoft'
 */
async function startCloudLogin(returnTo, providerId) {
  const id = providerId || getActiveProviderId();

  if (!cloudProviderIsConfigured(id)) {
    alert(`Zugangsdaten für ${getCloudProvider(id).label} fehlen. `
      + 'Bitte in website/js/config.js eintragen (Anleitung: CLOUD_SETUP.md).');
    return;
  }

  // Anbieter merken, damit die Rückleitung weiß, wer geantwortet hat
  localStorage.setItem(INKWELL_PROVIDER_KEY, id);

  const provider = getCloudProvider(id);
  const redirectUri = inkwellLoginRedirectUri();

  /* Google lief hier früher ohne Seitenwechsel über den Identity-Dienst.
     Der gibt aber nur ein Zugriffstoken heraus, kein ID-Token – und ohne
     das kennt Firebase den Nutzer nicht. Die erste Anmeldung geht deshalb
     jetzt über die Weiterleitung; die stille Erneuerung danach läuft
     weiterhin über den Identity-Dienst (ensureFreshToken). */

  const url = await provider.buildAuthUrl(redirectUri, {
    state: returnTo || 'dashboard/',
    loginHint: getRememberedEmail()
  });
  window.location.href = url;
}

// Alter Name, damit bestehende Aufrufe weiterlaufen
function startGoogleLogin(returnTo) {
  return startCloudLogin(returnTo, 'google');
}

/**
 * Verarbeitet die Rückleitung des Anmeldedienstes.
 * Liefert true, wenn eine Rückleitung erkannt und behandelt wurde.
 */
async function handleCloudCallback() {
  const providerId = getActiveProviderId();
  const provider = getCloudProvider(providerId);

  const params = provider.readCallback();
  if (!params) return false;

  const error = params.get('error');
  const state = params.get('state') || '';

  // Adresszeile sofort säubern
  history.replaceState({}, document.title, window.location.pathname);

  if (error) {
    console.error(`${provider.label} OAuth error:`, error, params.get('error_description') || '');
    alert(error === 'access_denied'
      ? 'Anmeldung abgebrochen.'
      : `Anmeldung bei ${provider.label} fehlgeschlagen: ${params.get('error_description') || error}`);
    return true;
  }

  try {
    const tokens = await provider.completeAuth(params);
    if (!tokens?.accessToken) throw new Error('Kein Zugriffstoken erhalten');

    await applyTokens(providerId, tokens);
    window.location.replace(state || 'dashboard/');
  } catch (err) {
    console.error('OAuth processing error:', err);
    alert(`Anmeldung bei ${provider.label} fehlgeschlagen: ${err.message}`);
  }

  return true;
}

// Alter Name
function handleGoogleCallback() {
  return handleCloudCallback();
}

function inkwellLogout() {
  const session = getInkwellSession();
  const providerId = getActiveProviderId();
  clearInkwellSession();

  // Zugriff zurückziehen – nur Google bietet dafür einen Endpunkt
  if (providerId === 'google' && session?.accessToken) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      mode: 'no-cors'
    }).catch(() => {});
  }

  /* >>> Auch bei Firebase abmelden <<<
     Die Anmeldung bei Google bzw. Microsoft und die bei Firebase sind zwei
     verschiedene Dinge. Blieb die Firebase-Sitzung stehen, wurden die
     geteilten Dokumente danach weiter unter der ALTEN Adresse gesucht –
     auch nachdem man sich längst mit einer anderen angemeldet hatte.

     Gibt ein Promise zurück, auf das der Aufrufer warten MUSS, bevor er
     die Seite wechselt: sonst schneidet die Navigation das Abmelden ab
     und die alte Kennung bleibt doch stehen. */
  return whenInkwellShareReady(3000)
    .then(api => api.signOutIdentity())
    .then(() => document.dispatchEvent(new CustomEvent('inkwell-identity-changed')))
    .catch(err => console.warn('[Auth] Firebase-Abmeldung übersprungen:', err?.message || err));
}

/* ── Navigation / Sprachmenü ──────────────────────────────────────── */

function toggleMobileLangMenu(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('lang-dropdown-mobile');
  if (!dropdown) return;
  const isShown = dropdown.style.display === 'block';
  dropdown.style.display = isShown ? 'none' : 'block';
}

document.addEventListener('click', (event) => {
  const dropdown = document.getElementById('lang-dropdown-mobile');
  const btn = document.getElementById('lang-btn-mobile');
  if (dropdown && btn && !dropdown.contains(event.target) && event.target !== btn && !btn.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});

// Zustand des Login-/Dashboard-Buttons in der Navigationsleiste
function checkCommonAuth(isLandingPage = false, relativePathToRoot = './') {
  const loggedIn = isInkwellLoggedIn();
  const isDashboard = window.location.pathname.includes('/dashboard/');

  const btnOpenLogin = document.getElementById('btn-open-login');
  if (!btnOpenLogin) return;

  const span = btnOpenLogin.querySelector('span');
  const userIcon = btnOpenLogin.querySelector('.nav-icon-user');
  const homeIcon = btnOpenLogin.querySelector('.nav-icon-home');

  /* Das Adminkonto hat kein Dashboard: es gehört zu keinem Google- oder
     Microsoft-Konto und hat deshalb auch keine Notizbücher in der Cloud.
     Statt eines Verweises, der ins Leere führt, führt der Knopf zurück in
     die Verwaltung. Gesetzt wird das Kennzeichen von js/admin.js, sobald
     Firebase die Anmeldung bestätigt hat. */
  if (document.body.dataset.inkwellAdmin === 'yes') {
    if (span) {
      span.textContent = window.t ? t('admin_page_title') : 'Verwaltung';
      span.removeAttribute('data-i18n');
    }
    if (userIcon) userIcon.style.display = 'inline-block';
    if (homeIcon) homeIcon.style.display = 'none';

    btnOpenLogin.onclick = (e) => {
      e.preventDefault();
      window.location.href = relativePathToRoot + 'admin/';
    };
    return;
  }

  if (loggedIn) {
    if (isDashboard) {
      if (span) {
        span.textContent = window.t ? t('dash_home', 'Startseite') : 'Startseite';
        span.setAttribute('data-i18n', 'dash_home');
      }
      if (userIcon) userIcon.style.display = 'none';
      if (homeIcon) homeIcon.style.display = 'inline-block';

      btnOpenLogin.onclick = (e) => {
        e.preventDefault();
        window.location.href = relativePathToRoot + '?home=true';
      };
    } else {
      if (span) {
        span.textContent = 'Dashboard';
        span.removeAttribute('data-i18n');
      }
      if (userIcon) userIcon.style.display = 'inline-block';
      if (homeIcon) homeIcon.style.display = 'none';

      btnOpenLogin.onclick = (e) => {
        e.preventDefault();
        window.location.href = `${relativePathToRoot}dashboard/`;
      };
    }
  } else {
    if (span) span.textContent = (window.t ? t('nav_login') : null) || 'Anmelden';
    if (userIcon) userIcon.style.display = 'inline-block';
    if (homeIcon) homeIcon.style.display = 'none';

    if (isLandingPage) {
      btnOpenLogin.onclick = null; // Startseite öffnet das Modal selbst
    } else {
      btnOpenLogin.onclick = (e) => {
        e.preventDefault();
        window.location.href = `${relativePathToRoot}?login=true`;
      };
    }
  }
}

function _inkwellNavContext() {
  const path = window.location.pathname;
  const isSub = path.includes('/dashboard/') || path.includes('/community/') || path.includes('/datenschutz/');
  return { rel: isSub ? '../' : './', isLanding: !isSub };
}

if (typeof addLangChangeListener === 'function') {
  addLangChangeListener(() => {
    const { rel, isLanding } = _inkwellNavContext();
    checkCommonAuth(isLanding, rel);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const { rel, isLanding } = _inkwellNavContext();
  checkCommonAuth(isLanding, rel);
});
