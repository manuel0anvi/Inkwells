/* ══════════════════════════════════════════════════════════════════════
   CLOUD-KONFIGURATION (WEBSITE)  ―  HIER DIE ZUGANGSDATEN EINTRAGEN

   Es müssen DIESELBEN Werte sein wie in src/core/cloudConfig.js!
   Nur so sieht die Website die Notizbücher, die die App anlegt.

   Anleitung: CLOUD_SETUP.md im Projekt-Hauptordner.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Google ─────────────────────────────────────────────────────── */
const GOOGLE_CLIENT_ID = '435761207155-gk6o9kk7ivsqa2h4fdhqeabtnigv9f4u.apps.googleusercontent.com';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file'
].join(' ');

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/* ── Microsoft ──────────────────────────────────────────────────────
   >>>>>>>>>>>>>>  HIER DIE ANWENDUNGS-ID EINTRAGEN  <<<<<<<<<<<<<<
   Azure Portal -> Microsoft Entra ID -> App-Registrierungen
   ─────────────────────────────────────────────────────────────────── */
const MICROSOFT_CLIENT_ID = '148248d2-3bb9-441f-ba32-879453f5881c';

const MICROSOFT_TENANT = 'consumers';

// Muss mit src/core/cloudConfig.js übereinstimmen. User.Read gehört dazu:
// ohne diese Berechtigung antwortet Microsoft Graph auf /me mit 403, und
// das Dashboard könnte Name und E-Mail des Kontos nicht anzeigen.
const MICROSOFT_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'User.Read',
  'Files.ReadWrite.AppFolder'
].join(' ');

const MICROSOFT_AUTH_ENDPOINT = `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize`;
const MICROSOFT_TOKEN_ENDPOINT = `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`;
const MICROSOFT_GRAPH = 'https://graph.microsoft.com/v1.0';

/* ── Adminkonto (Community-Moderation) ──────────────────────────────
   Die Anmeldung läuft über Firebase Authentication. Das Passwort steht
   deshalb NICHT hier, sondern liegt bei Firebase – die Website sieht es
   nie. Hier steht nur, welche Kennung das Adminkonto trägt.

   Einzurichten ist das Konto einmal in der Firebase-Konsole; die
   Anleitung dazu steht oben in website/firestore.rules.

   >>>>>>>>>>>  HIER DIE E-MAIL DES ADMINKONTOS EINTRAGEN  <<<<<<<<<<<
   Dieselbe Adresse wie in Firebase → Authentication → Users.
   ─────────────────────────────────────────────────────────────────── */
const ADMIN_EMAIL = 'admin@inkwells.me';

// Anzeigename, unter dem der Admin im Forum antwortet.
const ADMIN_DISPLAY_NAME = 'Inkwell Team';

/* Namen, die normalen Nutzern verwehrt bleiben.

   Geprüft wird gegen eine vereinfachte Fassung des Namens: klein
   geschrieben, ohne Leer- und Sonderzeichen, und mit den üblichen
   Zahlen-für-Buchstaben-Ersetzungen zurückübersetzt. Sonst käme man mit
   "1nkwell", "I.n.k.w.e.l.l" oder "ınkwell" an der Sperre vorbei.

   Dieselbe Sperre steht noch einmal in website/firestore.rules. Das ist
   Absicht: hier sorgt sie für eine verständliche Fehlermeldung, dort
   dafür, dass sie sich nicht umgehen lässt. */
const RESERVED_AUTHOR_WORDS = [
  'inkwell',
  'anvi',
  'admin',
  'administrator',
  'moderator',
  'support',
  'offiziell',
  'official'
];

function normalizeAuthorName(name) {
  return String(name || '')
    .toLowerCase()
    // Zeichen mit Akzent auf ihren Grundbuchstaben zurückführen (é -> e)
    .normalize('NFKD').replace(/\p{Diacritic}/gu, '')
    // Verwechslungszeichen: 1nkwell, !nkwell, 0fficial, m0derator …
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4|@/g, 'a')
    .replace(/5|\$/g, 's')
    .replace(/7/g, 't')
    // alles, was kein Buchstabe und keine Ziffer ist, fällt weg
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Ist dieser Anzeigename dem Adminkonto vorbehalten?
 * @param {string} name
 * @returns {boolean}
 */
function isReservedAuthorName(name) {
  const normalized = normalizeAuthorName(name);
  if (!normalized) return false;
  return RESERVED_AUTHOR_WORDS.some((word) => normalized.includes(word));
}

/* ── Gemeinsames ────────────────────────────────────────────────── */

const CLOUD_FOLDER = 'Inkwell';
const CLOUD_TRASH_FOLDER = 'Papierkorb';
const CLOUD_PROVIDERS = ['google', 'microsoft'];

function cloudProviderIsConfigured(providerId) {
  if (providerId === 'google') return typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim().length > 0;
  if (providerId === 'microsoft') return typeof MICROSOFT_CLIENT_ID === 'string' && MICROSOFT_CLIENT_ID.trim().length > 0;
  return false;
}

function anyCloudProviderConfigured() {
  return CLOUD_PROVIDERS.some(cloudProviderIsConfigured);
}

function defaultCloudProvider() {
  return CLOUD_PROVIDERS.find(cloudProviderIsConfigured) || 'google';
}

// Alter Name aus der Google-only-Zeit
function googleIsConfigured() {
  return cloudProviderIsConfigured('google');
}
