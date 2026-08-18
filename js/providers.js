/* ══════════════════════════════════════════════════════════════════════
   CLOUD-ANBIETER FÜR DIE WEBSITE

   Gegenstück zu src/core/providers/ in der App: dieselben Aufgaben,
   nur für den Browser. Das Dashboard kennt dadurch weder Drive- noch
   Graph-Adressen.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Google Drive ───────────────────────────────────────────────── */

const WebGoogleProvider = {
  id: 'google',
  label: 'Google Drive',
  clientId: () => GOOGLE_CLIENT_ID,
  scopes: () => GOOGLE_SCOPES,
  usesPkce: false,

  buildAuthUrl(redirectUri, { state, loginHint } = {}) {
    /* response_type: „token id_token" statt nur „token".

       Das Zugriffstoken allein reicht für Drive, aber nicht für Firebase –
       dort braucht es ein ID-Token, sonst kennen die Sicherheitsregeln nur
       eine anonyme Gerätekennung und die geteilten Dokumente sind nicht
       durchsetzbar. Google gibt das ID-Token nur zusammen mit einer nonce
       heraus; die muss den Seitenwechsel überleben. */
    const nonce = randomVerifier();
    try { sessionStorage.setItem('inkwells_auth_nonce', nonce); } catch (e) {}

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'token id_token',
      scope: GOOGLE_SCOPES,
      include_granted_scopes: 'true',
      nonce,
      prompt: 'select_account'
    });
    if (state) params.set('state', state);
    if (loginHint) params.set('login_hint', loginHint);
    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  },

  /** Google antwortet im Fragment (#access_token=…) */
  readCallback() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return null;
    const params = new URLSearchParams(hash.substring(1));
    if (!params.get('access_token') && !params.get('error')) return null;
    return params;
  },

  async completeAuth(params) {
    const nonce = (() => {
      try { return sessionStorage.getItem('inkwells_auth_nonce') || ''; }
      catch (e) { return ''; }
    })();
    try { sessionStorage.removeItem('inkwells_auth_nonce'); } catch (e) {}

    return {
      accessToken: params.get('access_token'),
      refreshToken: '',
      expiresIn: parseInt(params.get('expires_in') || '3600', 10),
      // Für die Firebase-Anmeldung. Fehlt es, läuft alles wie bisher –
      // nur der Tab „Geteilte Dokumente" bleibt leer.
      idToken: params.get('id_token') || '',
      rawNonce: nonce
    };
  },

  async fetchProfile(token) {
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Profil konnte nicht geladen werden (' + res.status + ')');
    const u = await res.json();
    return { userId: u.sub, email: u.email || '', name: u.name || u.email || '', picture: u.picture || '' };
  },

  /* ── Dateien ─────────────────────────────────────────────────── */

  async findFolders(http) {
    const q = encodeURIComponent(
      `name='${CLOUD_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const data = await http(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`);
    return (data.files || []).map(f => f.id);
  },

  async listNotebookFiles(http, folderId) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const data = await http(
      `https://www.googleapis.com/drive/v3/files?q=${q}`
      + '&fields=files(id,name,mimeType,modifiedTime,size,appProperties)&orderBy=modifiedTime desc&spaces=drive'
    );
    return (data.files || [])
      .filter(f => f.mimeType !== 'application/vnd.google-apps.folder')
      .filter(f => !f.name?.startsWith('inkwells-'))
      .filter(f => f.name?.endsWith('.json') || f.name?.endsWith('.jrnl') || f.appProperties?.inkwellsId)
      .map(f => ({
        id: f.id, name: f.name, modifiedTime: f.modifiedTime,
        size: Number(f.size) || 0, inkwellsId: f.appProperties?.inkwellsId || null
      }));
  },

  downloadUrl(fileId) {
    return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  },

  async getQuota(http) {
    const data = await http('https://www.googleapis.com/drive/v3/about?fields=storageQuota');
    const q = data.storageQuota || {};
    const limit = q.limit != null ? Number(q.limit) : NaN;
    const usage = q.usage != null ? Number(q.usage) : NaN;
    return {
      limit: Number.isFinite(limit) ? limit : null,
      usage: Number.isFinite(usage) ? usage : null,
      free: (Number.isFinite(limit) && Number.isFinite(usage)) ? Math.max(0, limit - usage) : null
    };
  }
};

/* ── Microsoft OneDrive ─────────────────────────────────────────── */

/**
 * Übersetzt die kryptischen AADSTS-Nummern in eine Anweisung, die man
 * tatsächlich befolgen kann. Unbekannte Meldungen bleiben unverändert.
 */
function describeMicrosoftTokenError(detail) {
  const text = String(detail || '');

  // Häufigster Stolperstein: die Adresse der Website ist in Azure unter der
  // Plattform "Web" eingetragen. Nur "Single-page application" erlaubt den
  // Tokentausch direkt aus dem Browser (CORS).
  if (/AADSTS90023|Cross-origin token redemption/i.test(text)) {
    return 'Die Adresse dieser Website ist in Azure als Plattform „Web" eingetragen. '
      + 'Für die Anmeldung im Browser muss sie unter „Single-page application" stehen: '
      + 'Azure Portal → App-Registrierungen → Inkwells → Authentifizierung → '
      + `„${window.location.origin}/" unter „Web" entfernen und unter „Single-page application" (SPA) neu hinzufügen. `
      + 'Siehe CLOUD_SETUP.md, Abschnitt B2.';
  }

  if (/AADSTS9002326/i.test(text)) {
    return 'Microsoft erwartet für diese Anmeldung die Plattform „Single-page application" (SPA). '
      + 'In Azure unter Authentifizierung die Adresse aus „Web" nach „Single-page application" verschieben '
      + '(CLOUD_SETUP.md, Abschnitt B2).';
  }

  if (/AADSTS50011/i.test(text)) {
    return `Die Weiterleitungs-Adresse „${window.location.origin}/" ist in Azure nicht hinterlegt. `
      + 'Sie muss zeichengenau unter „Single-page application" stehen (CLOUD_SETUP.md, Abschnitt B2).';
  }

  return text;
}

const WebMicrosoftProvider = {
  id: 'microsoft',
  label: 'OneDrive',
  clientId: () => MICROSOFT_CLIENT_ID,
  scopes: () => MICROSOFT_SCOPES,
  usesPkce: true,

  async buildAuthUrl(redirectUri, { state, loginHint } = {}) {
    const verifier = randomVerifier();
    const challenge = await pkceChallenge(verifier);

    // Die nonce landet im ID-Token; Firebase prüft sie beim Anmelden gegen
    // den mitgegebenen rawNonce und lehnt das Token ohne sie ab.
    const nonce = randomVerifier();

    // Muss den Seitenwechsel überleben
    sessionStorage.setItem('inkwells_pkce_verifier', verifier);
    sessionStorage.setItem('inkwells_pkce_redirect', redirectUri);
    sessionStorage.setItem('inkwells_auth_nonce', nonce);

    const params = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: MICROSOFT_SCOPES,
      response_mode: 'query',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      nonce,
      prompt: 'select_account'
    });
    if (state) params.set('state', state);
    if (loginHint) params.set('login_hint', loginHint);
    return `${MICROSOFT_AUTH_ENDPOINT}?${params.toString()}`;
  },

  /** Microsoft antwortet als Query (?code=…) */
  readCallback() {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('code') && !params.get('error')) return null;
    return params;
  },

  async completeAuth(params) {
    const code = params.get('code');
    const verifier = sessionStorage.getItem('inkwells_pkce_verifier');
    const redirectUri = sessionStorage.getItem('inkwells_pkce_redirect');
    const nonce = sessionStorage.getItem('inkwells_auth_nonce') || '';
    if (!verifier || !redirectUri) throw new Error('Anmeldedaten unvollständig – bitte erneut versuchen');

    const res = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        scope: MICROSOFT_SCOPES,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier
      }).toString()
    });

    const data = await res.json().catch(() => ({}));
    sessionStorage.removeItem('inkwells_pkce_verifier');
    sessionStorage.removeItem('inkwells_pkce_redirect');
    sessionStorage.removeItem('inkwells_auth_nonce');

    if (!res.ok) {
      throw new Error(describeMicrosoftTokenError(
        data?.error_description || data?.error || 'Anmeldung fehlgeschlagen'
      ));
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresIn: parseInt(data.expires_in || '3600', 10),
      idToken: data.id_token || '',
      rawNonce: nonce
    };
  },

  /**
   * Microsoft kann still erneuern – das gibt es bei Google nicht.
   * Für Single-Page-Anwendungen gibt Microsoft Refresh-Tokens mit 24 Stunden
   * Laufzeit heraus; danach ist eine echte Neuanmeldung nötig. In der
   * Desktop-App gilt stattdessen das gleitende 90-Tage-Fenster.
   */
  async refresh(refreshToken) {
    if (!refreshToken) return null;
    const res = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        scope: MICROSOFT_SCOPES,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[Auth] OneDrive-Erneuerung abgelehnt:',
        describeMicrosoftTokenError(err?.error_description || err?.error || `HTTP ${res.status}`));
      return null;
    }
    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: parseInt(data.expires_in || '3600', 10)
    };
  },

  async fetchProfile(token) {
    const res = await fetch(`${MICROSOFT_GRAPH}/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Profil konnte nicht geladen werden (' + res.status + ')');
    const u = await res.json();
    return {
      userId: u.id,
      email: u.mail || u.userPrincipalName || '',
      name: u.displayName || u.mail || '',
      picture: ''
    };
  },

  /* ── Dateien ─────────────────────────────────────────────────── */

  async findFolders(http) {
    try {
      const root = await http(`${MICROSOFT_GRAPH}/me/drive/special/approot`);
      return root?.id ? [root.id] : [];
    } catch (err) {
      return [];
    }
  },

  async listNotebookFiles(http, folderId) {
    const out = [];
    let url = `${MICROSOFT_GRAPH}/me/drive/items/${folderId}/children`
      + '?$select=id,name,lastModifiedDateTime,size,file,folder&$top=200';

    while (url) {
      const data = await http(url);
      for (const item of (data.value || [])) {
        if (item.folder) continue;
        if (!item.name?.endsWith('.json') && !item.name?.endsWith('.jrnl')) continue;
        if (item.name.startsWith('inkwells-')) continue;

        const base = item.name.replace(/\.(json|jrnl)$/i, '');
        const idx = base.lastIndexOf('__');
        out.push({
          id: item.id,
          name: item.name,
          modifiedTime: item.lastModifiedDateTime,
          size: Number(item.size) || 0,
          inkwellsId: idx >= 0 ? base.slice(idx + 2) : null
        });
      }
      url = data['@odata.nextLink'] || null;
    }
    return out;
  },

  downloadUrl(fileId) {
    return `${MICROSOFT_GRAPH}/me/drive/items/${fileId}/content`;
  },

  async getQuota(http) {
    const data = await http(`${MICROSOFT_GRAPH}/me/drive?$select=quota`);
    const q = data.quota || {};
    const limit = q.total != null ? Number(q.total) : NaN;
    const usage = q.used != null ? Number(q.used) : NaN;
    return {
      limit: Number.isFinite(limit) ? limit : null,
      usage: Number.isFinite(usage) ? usage : null,
      free: q.remaining != null ? Number(q.remaining)
        : (Number.isFinite(limit) && Number.isFinite(usage) ? Math.max(0, limit - usage) : null)
    };
  }
};

/* ── PKCE-Hilfen ────────────────────────────────────────────────── */

function randomVerifier() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ── Zugriff ────────────────────────────────────────────────────── */

const CLOUD_PROVIDER_MAP = {
  google: WebGoogleProvider,
  microsoft: WebMicrosoftProvider
};

function getCloudProvider(id) {
  return CLOUD_PROVIDER_MAP[id] || WebGoogleProvider;
}
