'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ANBIETER: GOOGLE DRIVE

   Kapselt alles, was speziell mit Google zu tun hat. cloudSync.js kennt
   nur noch diese Schnittstelle und weiß nichts über Drive-Adressen.

   Anmeldung: zwei Wege, gesteuert über GOOGLE_CONFIG.CLIENT_SECRET
   (siehe core/cloudConfig.js):

     · ohne Secret: Implicit Flow – das Token kommt im URL-Fragment
       zurück, ein Refresh-Token gibt Google nicht heraus. Die Sitzung
       endet nach etwa einer Stunde.
     · mit Secret: Authorization Code + PKCE mit access_type=offline –
       dann gibt es ein Refresh-Token und die Sitzung hält dauerhaft.
   ══════════════════════════════════════════════════════════════════════ */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

// Bis hierhin geht der einfache Upload in einem Zug, darüber muss der
// fortsetzbare Weg genommen werden (Google-Grenze: 5 MB).
const SIMPLE_UPLOAD_LIMIT = 5 * 1024 * 1024;

const GoogleDriveProvider = {
  id: 'google',
  labelKey: 'providerGoogle',
  label: 'Google Drive',

  /** Ohne Secret kommt das Token im Fragment (#), mit Secret als Code (?). */
  get authResponseMode() {
    return GOOGLE_CONFIG.CAN_REFRESH ? 'query' : 'fragment';
  },

  /** Ein Refresh-Token gibt Google nur gegen ein Client-Secret heraus. */
  get supportsRefresh() {
    return GOOGLE_CONFIG.CAN_REFRESH;
  },

  isConfigured() {
    return cloudProviderIsConfigured('google');
  },

  folderName() {
    return GOOGLE_CONFIG.DRIVE_FOLDER;
  },

  /* ── Anmeldung ─────────────────────────────────────────────────── */

  async buildAuthRequest(redirectUri, options = {}) {
    const params = new URLSearchParams({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      redirect_uri: redirectUri,
      scope: GOOGLE_CONFIG.SCOPES,
      include_granted_scopes: 'true',
      prompt: options.prompt || 'select_account'
    });
    if (options.loginHint) params.set('login_hint', options.loginHint);

    if (!GOOGLE_CONFIG.CAN_REFRESH) {
      params.set('response_type', 'token');
      return { url: `${GOOGLE_CONFIG.AUTH_ENDPOINT}?${params.toString()}`, verifier: null };
    }

    // Mit Secret: Code-Flow. access_type=offline liefert das Refresh-Token,
    // und "consent" erzwingt es auch bei einer wiederholten Anmeldung –
    // sonst schickt Google es nur beim allerersten Mal mit.
    const verifier = this._randomVerifier();
    params.set('response_type', 'code');
    params.set('access_type', 'offline');
    params.set('prompt', options.prompt === 'none' ? 'none' : 'consent');
    params.set('code_challenge', await this._challengeFor(verifier));
    params.set('code_challenge_method', 'S256');

    return { url: `${GOOGLE_CONFIG.AUTH_ENDPOINT}?${params.toString()}`, verifier };
  },

  _randomVerifier() {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return this._base64Url(bytes);
  },

  async _challengeFor(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return this._base64Url(new Uint8Array(digest));
  },

  _base64Url(bytes) {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  /** Wertet die Rückleitung aus. params = URLSearchParams aus Fragment/Query. */
  async completeAuth({ params, redirectUri, verifier }) {
    // Der Implicit-Flow liefert das Token direkt – auch dann, wenn inzwischen
    // ein Secret hinterlegt wurde und noch eine alte Rückleitung eintrudelt.
    const accessToken = params.get('access_token');
    if (accessToken) {
      return {
        accessToken,
        refreshToken: '',
        expiresIn: parseInt(params.get('expires_in') || '3600', 10),
        // Im Implicit-Flow gibt Google kein ID-Token heraus. Ohne das kennt
        // Firebase den Nutzer nicht – die geteilten Dokumente bleiben dann
        // aus, alles Übrige läuft normal weiter (siehe core/share.js).
        idToken: params.get('id_token') || ''
      };
    }

    const code = params.get('code');
    if (!code) throw new Error('Kein access_token in der Google-Antwort gefunden');
    if (!GOOGLE_CONFIG.CAN_REFRESH) {
      throw new Error('Google hat einen Anmeldecode geschickt, aber es ist kein Client-Secret hinterlegt (siehe CLOUD_SETUP.md).');
    }

    const data = await this._postToken({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      client_secret: GOOGLE_CONFIG.CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      ...(verifier ? { code_verifier: verifier } : {})
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresIn: parseInt(data.expires_in || '3600', 10),
      // Kommt wegen des Bereichs "openid" ohne Zutun mit. Wurde früher
      // weggeworfen; damit meldet sich die App jetzt bei Firebase an.
      idToken: data.id_token || ''
    };
  },

  async refreshSession(refreshToken) {
    if (!GOOGLE_CONFIG.CAN_REFRESH || !refreshToken) return null;

    try {
      const data = await this._postToken({
        client_id: GOOGLE_CONFIG.CLIENT_ID,
        client_secret: GOOGLE_CONFIG.CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });

      return {
        accessToken: data.access_token,
        // Google schickt kein neues Refresh-Token – das alte gilt weiter
        refreshToken: data.refresh_token || refreshToken,
        expiresIn: parseInt(data.expires_in || '3600', 10),
        idToken: data.id_token || ''
      };
    } catch (err) {
      console.warn('[GoogleDrive] Sitzung konnte nicht erneuert werden:', err.message);

      // invalid_grant heißt: widerrufen, abgelaufen oder Passwort geändert.
      // Weiterversuchen bringt nichts, es braucht eine echte Neuanmeldung.
      if (/invalid_grant|invalid_client|unauthorized_client/i.test(err.message || '')) {
        const fatal = new Error(err.message);
        fatal.needsReauth = true;
        throw fatal;
      }
      return null;
    }
  },

  /**
   * Tokentausch. In der Desktop-App über den Hauptprozess: das Fenster hat
   * die Herkunft "null" (file://), Googles Token-Endpunkt lehnt das ab.
   */
  async _postToken(bodyObj) {
    if (window.api && window.api.oauthTokenRequest) {
      const result = await window.api.oauthTokenRequest(GOOGLE_CONFIG.TOKEN_ENDPOINT, bodyObj);
      if (!result?.ok) throw new Error(result?.error || 'Google-Anmeldung fehlgeschlagen');
      return result.data;
    }

    const res = await fetch(GOOGLE_CONFIG.TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(bodyObj).toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error_description || data?.error || `Token-Anfrage fehlgeschlagen (${res.status})`);
    }
    return data;
  },

  async fetchProfile(accessToken) {
    const res = await fetch(GOOGLE_CONFIG.USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error_description || data?.error || 'Google-Profil konnte nicht geladen werden');
    }
    return {
      userId: data.sub || '',
      email: data.email || '',
      name: data.name || data.email || 'Google-Konto',
      picture: data.picture || ''
    };
  },

  async revoke(token) {
    if (!token) return;
    await fetch(`${GOOGLE_CONFIG.REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  },

  describeAuthError(code) {
    const map = {
      access_denied: 'Zugriff wurde abgelehnt.',
      admin_policy_enforced: 'Die Google-Organisation erlaubt diesen Zugriff nicht.',
      redirect_uri_mismatch: 'Die Weiterleitungs-URL ist in der Google Cloud Console nicht eingetragen.',
      invalid_client: 'Die Google Client-ID ist ungültig oder fehlt (siehe CLOUD_SETUP.md).'
    };
    return map[code] || `Google meldet: ${code}`;
  },

  /* ── Ordner ────────────────────────────────────────────────────── */

  async findOrCreateFolder(http) {
    const name = this.folderName();
    const q = encodeURIComponent(
      `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );

    const data = await http.json(`${DRIVE_API}/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime&spaces=drive`);
    const folders = Array.isArray(data.files) ? data.files : [];

    if (folders.length === 1) return folders[0].id;

    // Mehrere gleichnamige Ordner: den mit den meisten Dateien nehmen
    if (folders.length > 1) {
      console.warn(`[GoogleDrive] ${folders.length} Ordner "${name}" gefunden – wähle den mit Inhalt`);
      let best = folders[0];
      let bestCount = -1;
      for (const folder of folders) {
        let count = 0;
        try {
          const files = await this.listNotebookFiles(http, folder.id);
          count = files.length;
        } catch (err) { /* unzugänglich = 0 */ }
        if (count > bestCount) { best = folder; bestCount = count; }
      }
      return best.id;
    }

    const created = await http.json(`${DRIVE_API}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
    });
    return created.id;
  },

  async findOrCreateSubfolder(http, parentId, name) {
    const q = encodeURIComponent(
      `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const data = await http.json(`${DRIVE_API}/files?q=${q}&fields=files(id)&spaces=drive`);
    if (data.files?.length) return data.files[0].id;

    const created = await http.json(`${DRIVE_API}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    return created.id;
  },

  /* ── Dateien ───────────────────────────────────────────────────── */

  /** Einheitliche Form: { id, name, modifiedTime, size, inkwellId } */
  async listNotebookFiles(http, folderId) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const data = await http.json(
      `${DRIVE_API}/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,size,appProperties)&orderBy=modifiedTime desc&spaces=drive`
    );

    const files = Array.isArray(data.files) ? data.files : [];
    return files
      .filter(f => {
        if (f.appProperties?.inkwellKind === 'index') return false;
        if (f.name?.startsWith('inkwell-') && f.name?.endsWith('.json')) return false;
        if (f.mimeType === 'application/vnd.google-apps.folder') return false;
        return f.name?.endsWith('.json') || f.name?.endsWith('.jrnl') || !!f.appProperties?.inkwellId;
      })
      .map(f => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime,
        size: Number(f.size) || 0,
        inkwellId: f.appProperties?.inkwellId || null
      }));
  },

  async downloadFile(http, fileId) {
    return http.json(`${DRIVE_API}/files/${fileId}?alt=media`);
  },

  fileNameFor(notebook) {
    const safe = String(notebook.name || 'Notizbuch')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .trim() || 'Notizbuch';
    return `${safe}.json`;
  },

  /** Findet die Datei zu einem Heft, auch nach Umbenennen. */
  matchesNotebook(file, notebook) {
    return file.inkwellId === notebook.id || file.name === `${notebook.id}.json`;
  },

  async upsertNotebook(http, { folderId, notebook, existingFileId }) {
    const content = JSON.stringify(notebook);
    const metadata = {
      name: this.fileNameFor(notebook),
      mimeType: 'application/json',
      appProperties: {
        inkwellId: notebook.id,
        inkwellName: String(notebook.name || ''),
        inkwellUpdatedAt: notebook.updatedAt || ''
      }
    };
    if (!existingFileId) metadata.parents = [folderId];

    // Der einfache Upload nimmt bei Google höchstens 5 MB an. Ein Heft mit
    // eingebetteten Fotos ist schnell größer – dann muss der fortsetzbare
    // Weg genommen werden, sonst schlägt das Speichern fehl.
    const bytes = new TextEncoder().encode(content).length;
    if (bytes >= SIMPLE_UPLOAD_LIMIT) {
      return this._uploadResumable(http, { metadata, content, existingFileId });
    }

    const boundary = '-------inkwell' + Date.now();
    const body =
      `\r\n--${boundary}\r\n`
      + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
      + JSON.stringify(metadata)
      + `\r\n--${boundary}\r\n`
      + 'Content-Type: application/json\r\n\r\n'
      + content
      + `\r\n--${boundary}--`;

    const url = existingFileId
      ? `${DRIVE_UPLOAD_API}/files/${existingFileId}?uploadType=multipart`
      : `${DRIVE_UPLOAD_API}/files?uploadType=multipart`;

    const result = await http.json(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    return result?.id || existingFileId;
  },

  /** Fortsetzbarer Upload für Dateien ab 5 MB. */
  async _uploadResumable(http, { metadata, content, existingFileId }) {
    const startUrl = existingFileId
      ? `${DRIVE_UPLOAD_API}/files/${existingFileId}?uploadType=resumable`
      : `${DRIVE_UPLOAD_API}/files?uploadType=resumable`;

    const data = new TextEncoder().encode(content);

    // 1. Sitzung eröffnen – die Adresse steht in der Location-Kopfzeile
    const start = await http.raw(startUrl, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/json',
        'X-Upload-Content-Length': String(data.length)
      },
      body: JSON.stringify(metadata)
    });

    const sessionUrl = start.headers.get('Location') || start.headers.get('location');
    if (!sessionUrl) throw new Error('Google Drive: Upload-Sitzung konnte nicht gestartet werden');

    // 2. In Blöcken senden. Google verlangt Vielfache von 256 KiB.
    const CHUNK = 8 * 256 * 1024;
    let offset = 0;
    let result = null;

    while (offset < data.length) {
      const end = Math.min(offset + CHUNK, data.length);
      const chunk = data.slice(offset, end);

      // Die Sitzungsadresse trägt die Berechtigung bereits in sich
      const res = await fetch(sessionUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${data.length}` },
        body: chunk
      });

      // 308 = Block angekommen, weiter geht's
      if (res.status === 308) {
        offset = end;
        continue;
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Google Drive Upload fehlgeschlagen (${res.status}) ${detail.slice(0, 200)}`);
      }

      result = await res.json().catch(() => null);
      offset = end;
    }

    return result?.id || existingFileId;
  },

  /**
   * Verschiebt eine Datei in einen anderen Ordner.
   * Drive behält dabei die Kennung – sie wird trotzdem zurückgegeben, damit
   * beide Anbieter dieselbe Zusage geben (bei OneDrive kann sie sich
   * ändern, siehe providers/oneDrive.js).
   */
  async moveFile(http, fileId, fromFolderId, toFolderId) {
    await http.json(
      `${DRIVE_API}/files/${fileId}?addParents=${toFolderId}&removeParents=${fromFolderId}&fields=id`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    return fileId;
  },

  async deleteFile(http, fileId) {
    await http.raw(`${DRIVE_API}/files/${fileId}`, { method: 'DELETE' });
  },

  /* ── Index-Datei (gemeinsamer Papierkorb) ──────────────────────── */

  async findIndexFile(http, folderId, name) {
    const q = encodeURIComponent(`'${folderId}' in parents and name='${name}' and trashed=false`);
    const data = await http.json(`${DRIVE_API}/files?q=${q}&fields=files(id)&spaces=drive`);
    return data.files?.length ? data.files[0].id : null;
  },

  async saveIndexFile(http, { folderId, existingId, name, payload }) {
    const metadata = {
      name,
      mimeType: 'application/json',
      appProperties: { inkwellKind: 'index' }
    };
    if (!existingId) metadata.parents = [folderId];

    const boundary = '-------inkwellidx' + Date.now();
    const body =
      `\r\n--${boundary}\r\n`
      + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
      + JSON.stringify(metadata)
      + `\r\n--${boundary}\r\n`
      + 'Content-Type: application/json\r\n\r\n'
      + JSON.stringify(payload)
      + `\r\n--${boundary}--`;

    const url = existingId
      ? `${DRIVE_UPLOAD_API}/files/${existingId}?uploadType=multipart`
      : `${DRIVE_UPLOAD_API}/files?uploadType=multipart`;

    await http.json(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
  },

  /* ── Frühere Fassungen ─────────────────────────────────────────── */

  async listVersions(http, fileId) {
    const data = await http.json(`${DRIVE_API}/files/${fileId}/revisions?fields=revisions(id,modifiedTime,size)`);
    const revisions = Array.isArray(data.revisions) ? data.revisions : [];
    return revisions.map(r => ({
      id: r.id,
      modifiedTime: r.modifiedTime,
      size: Number(r.size) || 0
    }));
  },

  async downloadVersion(http, fileId, versionId) {
    return http.json(`${DRIVE_API}/files/${fileId}/revisions/${versionId}?alt=media`);
  },

  /* ── Speicherplatz ─────────────────────────────────────────────── */

  async getQuota(http) {
    const data = await http.json(`${DRIVE_API}/about?fields=storageQuota`);
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

if (typeof window !== 'undefined') window.GoogleDriveProvider = GoogleDriveProvider;
