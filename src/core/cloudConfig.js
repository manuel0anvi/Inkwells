'use strict';

/* ══════════════════════════════════════════════════════════════════════
   CLOUD-KONFIGURATION  ―  HIER DIE ZUGANGSDATEN EINTRAGEN

   Inkwells kann die Notizbücher in Google Drive oder in Microsoft OneDrive
   sichern. Beide sind unabhängig voneinander; es genügt, einen davon
   einzurichten. Anleitung: CLOUD_SETUP.md im Projekt-Hauptordner.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Google ─────────────────────────────────────────────────────────
   Zwei Anmeldewege, je nachdem ob unten ein CLIENT_SECRET steht:

   · CLIENT_SECRET leer (Standard): "Implicit Flow" – das Token kommt
     direkt im URL-Fragment. Ohne Secret gibt Google kein Refresh-Token,
     deshalb ist nach etwa einer Stunde eine erneute Anmeldung nötig.

   · CLIENT_SECRET gesetzt: "Authorization Code + PKCE" mit
     access_type=offline. Google liefert dann ein Refresh-Token und die
     Sitzung hält, bis der Zugriff widerrufen wird – wie bei Microsoft.

   >>> Wo das Secret steht <<<
   NICHT hier. Es liegt in cloudConfig.local.js daneben, und die Datei
   steht in .gitignore – sonst läge das Secret im öffentlichen Repo.
   Vorlage zum Kopieren: cloudConfig.local.example.js.

   Fehlt die Datei, ist CLIENT_SECRET leer und alles läuft weiter, nur
   eben mit stündlicher Neuanmeldung.

   >>> Abwägung, bevor das Secret eingetragen wird <<<
   Das Secret landet in der ausgelieferten .exe und ist dort auslesbar.
   Bei einem Client vom Typ "Webanwendung" könnte damit jemand fremde
   Anmeldungen für diese Client-ID durchführen. Es ist derselbe Client
   wie für die Website – das muss so bleiben, weil der Scope drive.file
   pro Client gilt und die Website sonst die Hefte der App nicht sieht.
   Details: CLOUD_SETUP.md, Abschnitt 4.
   ─────────────────────────────────────────────────────────────────── */
const GOOGLE_CONFIG = {
  id: 'google',
  CLIENT_ID: '435761207155-gk6o9kk7ivsqa2h4fdhqeabtnigv9f4u.apps.googleusercontent.com',

  // Kommt aus cloudConfig.local.js (nicht im Repo).
  // Leer = Sitzung ~1 Stunde. Gesetzt = dauerhafte Sitzung.
  CLIENT_SECRET:
    (typeof window !== 'undefined' && window.GOOGLE_CLIENT_SECRET_LOCAL) || '',

  SCOPES: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.file'
  ].join(' '),

  AUTH_ENDPOINT: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
  USERINFO_ENDPOINT: 'https://www.googleapis.com/oauth2/v3/userinfo',
  REVOKE_ENDPOINT: 'https://oauth2.googleapis.com/revoke',

  DRIVE_FOLDER: 'Inkwells',

  /** Kann die Google-Sitzung still erneuert werden? */
  get CAN_REFRESH() {
    return !!String(this.CLIENT_SECRET || '').trim();
  }
};

/* ── Microsoft ──────────────────────────────────────────────────────
   Anmeldung: OAuth 2.0 "Authorization Code + PKCE".
   Microsoft gibt öffentlichen Anwendungen ein Refresh-Token OHNE
   Client-Secret – die Sitzung hält dadurch deutlich länger als bei Google.

   >>>>>>>>>>>>>>  HIER DIE ANWENDUNGS-ID EINTRAGEN  <<<<<<<<<<<<<<
   Azure Portal -> Microsoft Entra ID -> App-Registrierungen
   (Form: 8 Zeichen - 4 - 4 - 4 - 12, z. B. 11111111-2222-3333-4444-555555555555)
   ─────────────────────────────────────────────────────────────────── */
const MICROSOFT_CONFIG = {
  id: 'microsoft',
  CLIENT_ID: '148248d2-3bb9-441f-ba32-879453f5881c',

  // "consumers" ist für reine persönliche Microsoft-Konten (Outlook, Hotmail etc.).
  // Dies verhindert den userAudience-Fehler bei der Anmeldung.
  TENANT: 'consumers',

  // Scopes für Profil, Offline-Zugriff und OneDrive-Dateizugriff
  SCOPES: [
    'openid',
    'email',
    'profile',
    'offline_access',
    'User.Read',
    'Files.ReadWrite.AppFolder'
  ].join(' '),

  get AUTH_ENDPOINT() {
    return `https://login.microsoftonline.com/${this.TENANT}/oauth2/v2.0/authorize`;
  },
  get TOKEN_ENDPOINT() {
    return `https://login.microsoftonline.com/${this.TENANT}/oauth2/v2.0/token`;
  },
  get LOGOUT_ENDPOINT() {
    return `https://login.microsoftonline.com/${this.TENANT}/oauth2/v2.0/logout`;
  },

  GRAPH: 'https://graph.microsoft.com/v1.0',

  // Der App-Ordner heißt in OneDrive immer wie die Anwendung; dieser Name
  // wird nur für Anzeigen gebraucht.
  DRIVE_FOLDER: 'Inkwells'
};

const CLOUD_PROVIDERS = ['google', 'microsoft'];

function cloudProviderIsConfigured(providerId) {
  if (providerId === 'google') return !!GOOGLE_CONFIG.CLIENT_ID.trim();
  if (providerId === 'microsoft') return !!MICROSOFT_CONFIG.CLIENT_ID.trim();
  return false;
}

/** Gibt es überhaupt einen eingerichteten Anbieter? */
function anyCloudProviderConfigured() {
  return CLOUD_PROVIDERS.some(cloudProviderIsConfigured);
}

/** Der zuerst eingerichtete Anbieter – Vorauswahl im Anmeldefenster. */
function defaultCloudProvider() {
  return CLOUD_PROVIDERS.find(cloudProviderIsConfigured) || 'google';
}

// Für den Übergang: alter Name aus der Google-only-Zeit
function googleIsConfigured() {
  return cloudProviderIsConfigured('google');
}

if (typeof window !== 'undefined') {
  window.GOOGLE_CONFIG = GOOGLE_CONFIG;
  window.MICROSOFT_CONFIG = MICROSOFT_CONFIG;
  window.CLOUD_PROVIDERS = CLOUD_PROVIDERS;
  window.cloudProviderIsConfigured = cloudProviderIsConfigured;
  window.anyCloudProviderConfigured = anyCloudProviderConfigured;
  window.defaultCloudProvider = defaultCloudProvider;
  window.googleIsConfigured = googleIsConfigured;
}