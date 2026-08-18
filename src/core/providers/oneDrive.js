'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ANBIETER: MICROSOFT ONEDRIVE (Microsoft Graph)

   Anmeldung: Authorization Code + PKCE. Microsoft gibt öffentlichen
   Anwendungen ein Refresh-Token ohne Client-Secret – deshalb hält die
   Sitzung hier deutlich länger als bei Google.

   Gespeichert wird im App-Ordner (`/me/drive/special/approot`). Der liegt
   im OneDrive des Nutzers sichtbar unter "Apps/Inkwells", die Berechtigung
   reicht aber nur für genau diesen Ordner.

   Besonderheit: OneDrive kennt keine unsichtbaren Zusatzeigenschaften wie
   Google (appProperties). Die Zugehörigkeit einer Datei zu einem Heft
   steckt deshalb im Dateinamen: "Mein Heft__a1b2c3.json". Beim Umbenennen
   ändert sich nur der vordere Teil.
   ══════════════════════════════════════════════════════════════════════ */

const ONEDRIVE_ID_SEPARATOR = '__';

/**
 * Übersetzt die kryptischen AADSTS-Nummern in eine Anweisung, die man
 * tatsächlich befolgen kann. Unbekannte Meldungen bleiben unverändert.
 */
function describeMicrosoftTokenError(detail) {
  const text = String(detail || '');

  // Der mit Abstand häufigste Stolperstein auf der Website: die Adresse ist
  // in Azure unter "Web" statt unter "Single-page application" eingetragen.
  // Nur die SPA-Plattform erlaubt den Tokentausch direkt aus dem Browser.
  if (/AADSTS90023|Cross-origin token redemption/i.test(text)) {
    return 'Die Weiterleitungs-Adresse ist in Azure als Plattform „Web" eingetragen. '
      + 'Für die Anmeldung aus dem Browser muss sie unter „Single-page application" stehen: '
      + 'Azure Portal → App-Registrierungen → Inkwells → Authentifizierung → die Adresse unter '
      + '„Web" entfernen und unter „Single-page application" (SPA) neu hinzufügen. '
      + 'Siehe CLOUD_SETUP.md, Abschnitt B2.';
  }

  if (/AADSTS9002326/i.test(text)) {
    return 'Microsoft erwartet für diese Anmeldung die Plattform „Single-page application" (SPA). '
      + 'In Azure unter Authentifizierung die Adresse aus „Web" nach „Single-page application" verschieben '
      + '(CLOUD_SETUP.md, Abschnitt B2).';
  }

  if (/AADSTS50011|redirect.?uri/i.test(text)) {
    return 'Die Weiterleitungs-Adresse ist in Azure nicht (oder nicht zeichengenau) hinterlegt. '
      + 'Sie steht beim Anmeldeversuch im Log: [CloudSync] redirect_uri = … (CLOUD_SETUP.md, Abschnitt B2). '
      + `Ursprüngliche Meldung: ${text}`;
  }

  return text;
}

if (typeof window !== 'undefined') window.describeMicrosoftTokenError = describeMicrosoftTokenError;

const OneDriveProvider = {
  id: 'microsoft',
  labelKey: 'providerMicrosoft',
  label: 'OneDrive',

  /** Der Anmeldefluss liefert einen Code als Query-Parameter (?code=…). */
  authResponseMode: 'query',

  supportsRefresh: true,

  isConfigured() {
    return cloudProviderIsConfigured('microsoft');
  },

  folderName() {
    return MICROSOFT_CONFIG.DRIVE_FOLDER;
  },

  /* ── Anmeldung (PKCE) ──────────────────────────────────────────── */

  async buildAuthRequest(redirectUri, options = {}) {
    const verifier = this._randomVerifier();
    const challenge = await this._challengeFor(verifier);

    /* Die nonce landet unverändert im ID-Token. Firebase prüft sie beim
       signInWithCredential gegen den mitgegebenen rawNonce und lehnt das
       Token ohne sie ab. Sie muss deshalb den Seitenwechsel überleben und
       wird zusammen mit dem PKCE-Prüfwert weitergereicht. */
    const nonce = this._randomVerifier();

    const params = new URLSearchParams({
      client_id: MICROSOFT_CONFIG.CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: MICROSOFT_CONFIG.SCOPES,
      response_mode: 'query',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      nonce,
      prompt: options.prompt || 'select_account'
    });
    if (options.loginHint) params.set('login_hint', options.loginHint);

    /* Die Wiedererkennung der eigenen Anfrage. Microsoft gibt sie
       unverändert zurück, cloudSync.js vergleicht sie – siehe dort
       _neuerState(). */
    if (options.state) params.set('state', options.state);

    return {
      url: `${MICROSOFT_CONFIG.AUTH_ENDPOINT}?${params.toString()}`,
      verifier,
      nonce
    };
  },

  _randomVerifier() {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return this._base64Url(bytes);
  },

  async _challengeFor(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return this._base64Url(new Uint8Array(digest));
  },

  _base64Url(bytes) {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  /**
   * Tauscht den Code gegen Tokens.
   * In der Desktop-App läuft das über den Hauptprozess: Microsofts
   * Token-Endpunkt erlaubt für Desktop-Weiterleitungen kein CORS, ein
   * fetch aus dem Fenster würde blockiert.
   */
  async completeAuth({ params, redirectUri, verifier, nonce }) {
    const code = params.get('code');
    if (!code) throw new Error('Kein Anmeldecode in der Microsoft-Antwort gefunden');
    if (!verifier) throw new Error('PKCE-Prüfwert fehlt – bitte erneut anmelden');

    const body = {
      client_id: MICROSOFT_CONFIG.CLIENT_ID,
      scope: MICROSOFT_CONFIG.SCOPES,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    };

    const data = await this._postToken(body);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresIn: parseInt(data.expires_in || '3600', 10),
      // Für die Anmeldung bei Firebase. Ohne die passende nonce ist das
      // Token dort wertlos, deshalb reisen beide zusammen weiter.
      idToken: data.id_token || '',
      rawNonce: nonce || ''
    };
  },

  async refreshSession(refreshToken) {
    if (!refreshToken) return null;

    try {
      const data = await this._postToken({
        client_id: MICROSOFT_CONFIG.CLIENT_ID,
        scope: MICROSOFT_CONFIG.SCOPES,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });

      return {
        accessToken: data.access_token,
        // Microsoft schickt oft ein neues Refresh-Token mit; sonst gilt das alte weiter
        refreshToken: data.refresh_token || refreshToken,
        expiresIn: parseInt(data.expires_in || '3600', 10)
      };
    } catch (err) {
      console.warn('[OneDrive] Sitzung konnte nicht erneuert werden:', err.message);

      // Zwischen "gerade kein Netz" (später nochmal) und "Microsoft hat das
      // Refresh-Token verworfen" (echte Neuanmeldung nötig) unterscheiden.
      if (/invalid_grant|interaction_required|AADSTS50173|AADSTS50078|AADSTS54005|AADSTS700082/i.test(err.message || '')) {
        const fatal = new Error(err.message);
        fatal.needsReauth = true;
        throw fatal;
      }
      return null;
    }
  },

  async _postToken(bodyObj) {
    const isDesktop = !!(window.api && window.api.msTokenRequest);

    if (isDesktop) {
      const result = await window.api.msTokenRequest(MICROSOFT_CONFIG.TOKEN_ENDPOINT, bodyObj);
      if (!result?.ok) {
        throw new Error(result?.error || 'Microsoft-Anmeldung fehlgeschlagen');
      }
      return result.data;
    }

    // Website: die Weiterleitung ist als "Single-page application"
    // registriert, dort erlaubt Microsoft den Aufruf aus dem Browser.
    const res = await fetch(MICROSOFT_CONFIG.TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(bodyObj).toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.error_description || data?.error || `Token-Anfrage fehlgeschlagen (${res.status})`;
      throw new Error(describeMicrosoftTokenError(detail));
    }
    return data;
  },

  async fetchProfile(accessToken) {
    const res = await fetch(`${MICROSOFT_CONFIG.GRAPH}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || 'Microsoft-Profil konnte nicht geladen werden');
    }
    return {
      userId: data.id || '',
      email: data.mail || data.userPrincipalName || '',
      name: data.displayName || data.mail || data.userPrincipalName || 'Microsoft-Konto',
      picture: ''   // Graph liefert das Bild nur als Binärdaten, das sparen wir uns
    };
  },

  async revoke() {
    // Microsoft kennt keinen Widerruf-Endpunkt wie Google. Das Token wird
    // lokal verworfen; Berechtigungen entzieht man unter
    // https://account.live.com/consent/Manage
  },

  describeAuthError(code) {
    const map = {
      access_denied: 'Zugriff wurde abgelehnt.',
      invalid_client: 'Die Anwendungs-ID ist ungültig oder fehlt (siehe CLOUD_SETUP.md).',
      unauthorized_client: 'Diese Anwendung darf den Anmeldeweg nicht nutzen – in Azure "Öffentliche Clientflows zulassen" einschalten.',
      invalid_request: 'Die Weiterleitungs-URL ist in Azure nicht eingetragen.',
      consent_required: 'Die Organisation verlangt eine Freigabe durch die Administration.',
      interaction_required: 'Bitte erneut anmelden.'
    };
    return map[code] || `Microsoft meldet: ${code}`;
  },

  /* ── Ordner ────────────────────────────────────────────────────── */

  async findOrCreateFolder(http) {
    // Der App-Ordner wird beim ersten Zugriff automatisch angelegt
    const root = await http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive/special/approot`);
    return root.id;
  },

  async findOrCreateSubfolder(http, parentId, name) {
    const byPath = async () => {
      try {
        const existing = await http.json(
          `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${parentId}:/${encodeURIComponent(name)}`
        );
        return existing?.id || null;
      } catch (err) {
        if (/404/.test(err.message)) return null;   // nur "nicht gefunden" ist erwartbar
        throw err;
      }
    };

    const found = await byPath();
    if (found) return found;

    /* >>> conflictBehavior kennt nur fail, replace und rename <<<
       Hier stand „return" – das gibt es in der alten OneDrive-Schnittstelle,
       Graph lehnt damit den GANZEN Aufruf mit 400 ab. Der Papierkorb-Ordner
       entstand dadurch nie, und ohne ihn schlug unter Microsoft jedes
       Löschen in der Cloud fehl: das Heft war in der App weg und lag in
       OneDrive und auf der Website weiterhin da. */
    try {
      const created = await http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${parentId}/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail'
        })
      });
      if (created?.id) return created.id;
    } catch (err) {
      // 409 heißt: inzwischen angelegt. Dann steht der Ordner ja da.
      if (!/409/.test(err.message)) throw err;
    }

    const again = await byPath();
    if (again) return again;
    throw new Error(`Ordner „${name}“ konnte nicht angelegt werden`);
  },

  /* ── Dateien ───────────────────────────────────────────────────── */

  async listNotebookFiles(http, folderId) {
    const out = [];
    let url = `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${folderId}/children`
      + '?$select=id,name,lastModifiedDateTime,size,file,folder&$top=200';

    // Graph liefert lange Listen seitenweise
    while (url) {
      const data = await http.json(url);
      for (const item of (data.value || [])) {
        if (item.folder) continue;
        if (!item.name?.endsWith('.json') && !item.name?.endsWith('.jrnl')) continue;
        if (item.name.startsWith('inkwells-')) continue;   // Index-Dateien

        out.push({
          id: item.id,
          name: item.name,
          modifiedTime: item.lastModifiedDateTime,
          size: Number(item.size) || 0,
          inkwellsId: this._idFromFileName(item.name)
        });
      }
      url = data['@odata.nextLink'] || null;
    }

    return out;
  },

  _idFromFileName(name) {
    const base = String(name || '').replace(/\.(json|jrnl)$/i, '');
    const idx = base.lastIndexOf(ONEDRIVE_ID_SEPARATOR);
    if (idx < 0) return null;
    const id = base.slice(idx + ONEDRIVE_ID_SEPARATOR.length);
    return id || null;
  },

  async downloadFile(http, fileId) {
    return http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${fileId}/content`);
  },

  fileNameFor(notebook) {
    const safe = String(notebook.name || 'Notizbuch')
      .replace(/[<>:"/\\|?*\x00-\x1F#%&{}~]/g, '_')
      .trim() || 'Notizbuch';
    return `${safe}${ONEDRIVE_ID_SEPARATOR}${notebook.id}.json`;
  },

  matchesNotebook(file, notebook) {
    if (file.inkwellsId) return file.inkwellsId === notebook.id;

    /* Ohne Trenner im Namen: die Form, die Google Drive schreibt. Solche
       Dateien liegen hier, wenn zwischen den Anbietern gewechselt wurde.
       Google Drive kennt denselben Rückfall (googleDrive.js) – hier fehlte
       er, und die Datei war damit weder zu finden noch zu löschen. */
    const base = String(file.name || '').replace(/\.(json|jrnl)$/i, '');
    return !!notebook.id && base === notebook.id;
  },

  async upsertNotebook(http, { folderId, notebook, existingFileId }) {
    const content = JSON.stringify(notebook);
    const desiredName = this.fileNameFor(notebook);

    // Kleine Dateien direkt hochladen, große über eine Upload-Sitzung.
    // Graph nimmt per PUT nur bis 4 MB an.
    const bytes = new TextEncoder().encode(content).length;
    const target = existingFileId
      ? `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${existingFileId}`
      : `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${folderId}:/${encodeURIComponent(desiredName)}:`;

    let fileId = existingFileId;

    if (bytes < 4 * 1024 * 1024) {
      const saved = await http.json(`${target}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: content
      });
      fileId = saved?.id || fileId;
    } else {
      fileId = await this._uploadLarge(http, { folderId, existingFileId, desiredName, content });
    }

    // Umbenennen, falls das Heft inzwischen anders heißt
    if (existingFileId) {
      try {
        const current = await http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${existingFileId}?$select=name`);
        if (current?.name && current.name !== desiredName) {
          await http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${existingFileId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: desiredName })
          });
        }
      } catch (err) {
        console.warn('[OneDrive] Umbenennen übersprungen:', err.message);
      }
    }

    return fileId;
  },

  /** Fortsetzbarer Upload für Dateien über 4 MB. */
  async _uploadLarge(http, { folderId, existingFileId, desiredName, content }) {
    const base = existingFileId
      ? `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${existingFileId}`
      : `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${folderId}:/${encodeURIComponent(desiredName)}:`;

    const session = await http.json(`${base}/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
    });

    if (!session?.uploadUrl) throw new Error('Upload-Sitzung konnte nicht gestartet werden');

    const data = new TextEncoder().encode(content);
    const CHUNK = 5 * 320 * 1024;   // Vielfaches von 320 KiB, von Graph verlangt
    let offset = 0;
    let result = null;

    while (offset < data.length) {
      const end = Math.min(offset + CHUNK, data.length);
      const chunk = data.slice(offset, end);

      // Die Upload-URL trägt die Berechtigung bereits in sich – hier kein Token
      const res = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${offset}-${end - 1}/${data.length}`
        },
        body: chunk
      });

      if (!res.ok && res.status !== 202) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Upload fehlgeschlagen (${res.status}) ${detail.slice(0, 200)}`);
      }

      if (res.status !== 202) result = await res.json().catch(() => null);
      offset = end;
    }

    return result?.id || existingFileId;
  },

  /**
   * Verschiebt eine Datei in einen anderen Ordner.
   *
   * >>> Warum das mehr ist als ein PATCH <<<
   * Mit der Berechtigung Files.ReadWrite.AppFolder nimmt Graph den PATCH
   * auf parentReference zwar an, führt ihn aber nicht zuverlässig aus: die
   * Antwort sieht nach Erfolg aus, die Datei liegt danach unverändert im
   * alten Ordner. Daran scheiterte das Löschen unter Microsoft – in der App
   * war das Heft weg, im OneDrive und damit auf der Website stand es weiter.
   *
   * Deshalb wird nachgesehen, wo die Datei WIRKLICH liegt, und im Zweifel am
   * Zielort neu angelegt und die alte entfernt. Anlegen und Löschen erlaubt
   * die App-Ordner-Berechtigung immer, denn beide Ordner liegen darin.
   *
   * @returns {Promise<string>} die Kennung der Datei am Zielort. Beim
   *   Neuanlegen ist das eine ANDERE als vorher – der Aufrufer muss sie
   *   übernehmen, sonst zeigt sein Vermerk auf eine gelöschte Datei.
   */
  async moveFile(http, fileId, fromFolderId, toFolderId) {
    try {
      await http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentReference: { id: toFolderId } })
      });
      if (await this._parentFolderOf(http, fileId) === toFolderId) return fileId;
      console.warn('[OneDrive] Verschieben blieb ohne Wirkung – Datei wird am Zielort neu angelegt');
    } catch (err) {
      console.warn('[OneDrive] Verschieben abgelehnt:', err.message);
    }

    return this._recreateInFolder(http, fileId, toFolderId);
  },

  /** In welchem Ordner liegt die Datei gerade? null = keine Auskunft. */
  async _parentFolderOf(http, fileId) {
    try {
      const item = await http.json(
        `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${fileId}?$select=id,parentReference`
      );
      return item?.parentReference?.id || null;
    } catch (err) {
      // Ohne Auskunft gilt das Verschieben als ungeklärt, nicht als erledigt
      return null;
    }
  },

  /** Legt die Datei im Zielordner neu an und entfernt danach die alte. */
  async _recreateInFolder(http, fileId, toFolderId) {
    const meta = await http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${fileId}?$select=id,name`);
    const name = meta?.name;
    const data = await this.downloadFile(http, fileId);

    /* Ohne Namen oder lesbaren Inhalt wird weder etwas angelegt noch etwas
       gelöscht. Sonst wäre das Heft weg statt verschoben – und der Weg hier
       läuft ausgerechnet dann, wenn ohnehin schon etwas schiefging. */
    if (!name || data == null) throw new Error('Datei konnte zum Verschieben nicht gelesen werden');

    const content = JSON.stringify(data);
    const bytes = new TextEncoder().encode(content).length;

    let newId;
    if (bytes < 4 * 1024 * 1024) {
      const saved = await http.json(
        `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${toFolderId}:/${encodeURIComponent(name)}:/content`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: content }
      );
      newId = saved?.id || null;
    } else {
      newId = await this._uploadLarge(http, {
        folderId: toFolderId, existingFileId: null, desiredName: name, content
      });
    }

    if (!newId) throw new Error('Datei konnte im Zielordner nicht angelegt werden');

    // Erst jetzt – vorher gäbe es die Fassung am Zielort noch gar nicht
    await this.deleteFile(http, fileId);
    return newId;
  },

  async deleteFile(http, fileId) {
    await http.raw(`${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${fileId}`, { method: 'DELETE' });
  },

  /* ── Index-Datei ───────────────────────────────────────────────── */

  async findIndexFile(http, folderId, name) {
    try {
      const item = await http.json(
        `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${folderId}:/${encodeURIComponent(name)}?$select=id`
      );
      return item?.id || null;
    } catch (err) {
      if (/404/.test(err.message)) return null;
      throw err;
    }
  },

  async saveIndexFile(http, { folderId, existingId, name, payload }) {
    const target = existingId
      ? `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${existingId}/content`
      : `${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${folderId}:/${encodeURIComponent(name)}:/content`;

    await http.json(target, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  /* ── Frühere Fassungen ─────────────────────────────────────────── */

  async listVersions(http, fileId) {
    const data = await http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${fileId}/versions`);
    const versions = Array.isArray(data.value) ? data.value : [];
    return versions.map(v => ({
      id: v.id,
      modifiedTime: v.lastModifiedDateTime,
      size: Number(v.size) || 0
    }));
  },

  async downloadVersion(http, fileId, versionId) {
    return http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive/items/${fileId}/versions/${versionId}/content`);
  },

  /* ── Speicherplatz ─────────────────────────────────────────────── */

  async getQuota(http) {
    const data = await http.json(`${MICROSOFT_CONFIG.GRAPH}/me/drive?$select=quota`);
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

if (typeof window !== 'undefined') window.OneDriveProvider = OneDriveProvider;
