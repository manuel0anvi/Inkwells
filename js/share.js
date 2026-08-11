/* ══════════════════════════════════════════════════════════════════════
   ⚠  ERZEUGTE DATEI – NICHT HIER BEARBEITEN

   Wortgleiche Kopie von src/core/share.js. Die App wird ohne den
   Ordner website/ ausgeliefert (siehe electron-builder.config.js),
   deshalb braucht die Website ein eigenes Exemplar.

   Änderungen gehören nach src/core/share.js. Danach:
       npm run sync-share
   Vor dem Veröffentlichen der Website läuft das von selbst.
   ══════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════
   HEFT-FREIGABE ÜBER EINEN LINK  ―  Cloud Firestore

   Ein Heft kann als schreibgeschützte Kopie veröffentlicht werden. Wer den
   Link hat, sieht das Heft ohne Anmeldung. Der Empfänger bekommt NUR die
   Kopie zu sehen – an das Original in Drive bzw. OneDrive kommt er nicht.

   ── Warum Firestore und nicht Firebase Storage ──────────────────────
   Storage verlangt bei neuen Projekten den Blaze-Plan (Kreditkarte).
   Firestore läuft im kostenlosen Spark-Plan. Der Haken: ein Dokument darf
   höchstens 1 MiB groß sein. Hefte mit Bildern sind schnell größer,
   deshalb wird der Inhalt in Stücke zerlegt:

     shared_notebooks/{shareId}              ← Kopf: Titel, Modus, Anzahl
     shared_notebooks/{shareId}/chunks/{i}   ← der JSON-Text in Stücken

   ── Wer darf ändern und aufheben ────────────────────────────────────
   Es gibt keine Anmeldung an Firebase. Damit nicht jeder, der den Link
   kennt, die Freigabe löschen oder überschreiben kann, meldet sich das
   Gerät anonym an (Anonymous Auth, ebenfalls kostenlos). Die Freigabe
   merkt sich diese Kennung als Besitzer; nur sie darf später ändern.

   >>> Grenze, die man kennen muss <<<
   Die anonyme Kennung gehört zum GERÄT, nicht zum Google-Konto. Eine
   Freigabe lässt sich deshalb nur dort aufheben, wo sie erstellt wurde.
   Auf anderen Geräten ist sie sichtbar, aber nicht änderbar; dort weist
   die Oberfläche darauf hin.

   Passendes Regelwerk: website/firestore.rules
   ══════════════════════════════════════════════════════════════════════ */

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, writeBatch, serverTimestamp, arrayUnion
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  getAuth, signInAnonymously, signInWithCredential, linkWithCredential,
  GoogleAuthProvider, OAuthProvider, onAuthStateChanged, signOut as fbSignOut,
  signInWithPopup
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

/* ── Zugangsdaten ───────────────────────────────────────────────────
   Kein Geheimnis – siehe die ausführliche Begründung in js/firebase.js.
   ─────────────────────────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey: 'AIzaSyDUoA5cET9qRoMEdi3K9hItLY7HkVL23z8',
  authDomain: 'inkwell-53ab9.firebaseapp.com',
  projectId: 'inkwell-53ab9',
  storageBucket: 'inkwell-53ab9.firebasestorage.app',
  messagingSenderId: '536044175658',
  appId: '1:536044175658:web:4e6ca9939202839580de53',
  measurementId: 'G-5DE5V3MM5X'
};

const SHARES = 'shared_notebooks';
const CHUNKS = 'chunks';

/* ── Geteilte Dokumente ─────────────────────────────────────────────
   Neben den eingefrorenen Lesekopien (shared_notebooks) gibt es seit
   der Zusammenarbeit die "Dokumente": ein Heft, das mit bestimmten
   Leuten geteilt ist, mit Rolle je Person.

     docs/{docId}                Kopf: Titel, Rechte, Mitglieder
     docs/{docId}/chunks/{i}     der Inhalt, wie bei den Lesekopien
     doc_links/{linkId}          Nachschlagewerk Link -> Dokument

   Warum der Link eine eigene Kennung bekommt und nicht einfach die
   Dokumentkennung ist: nur so lässt sich "Link erneuern" bauen. Beim
   Erneuern wird der alte Eintrag in doc_links gelöscht, die alte
   Adresse läuft danach ins Leere – ohne dass jemand, der schon
   eingetragen ist, seinen Zugang verliert.
   ─────────────────────────────────────────────────────────────────── */
const DOCS = 'docs';
const DOC_LINKS = 'doc_links';

/* ── Zerlegtes Datenmodell ──────────────────────────────────────────
   Bis Stufe 5 lag ein geteiltes Heft als EIN JSON-Klumpen in Stücken.
   Zwei Leute, die gleichzeitig auf verschiedenen Seiten schrieben,
   überschrieben sich vollständig. Deshalb liegt der Inhalt jetzt
   kleinteilig:

     docs/{docId}/pages/{pageId}     eine Seite = ein Dokument
     docs/{docId}/ink/{sheetId}      Handschrift, bogenweise angehängt
     docs/{docId}/blobs/{blobKey}    Bilder und PDF-Seiten, gestückelt

   >>> Warum die Handschrift in Bögen statt ein Strich = ein Dokument <<<
   Ein Strich je Dokument wäre die sauberste Form und stand so auch im
   Plan. Die Rechnung dagegen: eine handgeschriebene Seite hat schnell
   200–400 Striche, ein Heft mit 20 Seiten also mehrere tausend. Jedes
   Öffnen wäre dann ebenso viele Lesevorgänge – der kostenlose Spark-Plan
   erlaubt 50.000 pro Tag für das GANZE Projekt. Damit wären ein paar
   Dutzend Öffnungen am Tag das Limit.

   Deshalb: je Seite ein oder mehrere Bögen mit einer Strichliste. Neue
   Striche werden mit arrayUnion angehängt – und genau das ist auch beim
   gleichzeitigen Zeichnen konfliktfrei, denn Firestore führt zwei
   arrayUnion auf demselben Feld zusammen. Wird ein Bogen zu groß, fängt
   der nächste an (ein Dokument darf höchstens 1 MiB haben).
   ─────────────────────────────────────────────────────────────────── */
const PAGES = 'pages';
const INK = 'ink';
const BLOBS = 'blobs';

// Ab hier bekommt die Handschrift einer Seite einen neuen Bogen.
// Deutlich unter der Dokumentgrenze, weil arrayUnion die Prüfung erst
// beim Schreiben macht und ein voller Bogen sonst nicht mehr wächst.
const INK_SHEET_LIMIT = 600000;

// Kennzeichen im Kopf: 'pages' = zerlegt, sonst die alte Klumpenform.
const DOC_FORMAT = 'pages';

// Rollen. 'off' gibt es nur für linkMode: dann führt kein Link mehr hin.
const ROLES = ['view', 'edit'];
const LINK_MODES = ['off', 'view', 'edit'];

// Firestore erlaubt 1 MiB je Dokument. Mit Abstand darunter bleiben:
// dazu kommen noch Feldnamen, Indexe und der UTF-8-Aufschlag.
const CHUNK_SIZE = 700000;

// Ein Stapelschreibvorgang fasst höchstens 500 Änderungen.
const MAX_BATCH = 450;

// Öffentliche Adresse der Freigabe-Seite
const SHARE_BASE_URL = 'https://inkwells.me/s/';

/* ── Start ──────────────────────────────────────────────────────────
   getApps() prüfen, weil auf der Forenseite js/firebase.js dieselbe
   Anwendung schon gestartet haben kann – ein zweiter initializeApp()-
   Aufruf mit gleichem Namen wirft sonst.
   ─────────────────────────────────────────────────────────────────── */
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Reihenfolge ist wichtig: getAuth() MUSS vor getFirestore() stehen.
// Andersherum baut Firestore seine Anmeldeanbindung auf, bevor das
// Auth-Bauteil registriert ist, und schickt danach jede Anfrage ohne
// Token los – Firestore meldet dann "Missing or insufficient permissions",
// obwohl man angemeldet ist.
const auth = getAuth(app);
const db = getFirestore(app);

/* ── Anonyme Kennung ────────────────────────────────────────────────── */

let _authPromise = null;

/**
 * Liefert die anonyme Benutzerkennung dieses Geräts. Firebase legt sie
 * beim ersten Mal an und merkt sie sich danach lokal.
 * @returns {Promise<string>}
 */
function ensureOwnerId() {
  if (_authPromise) return _authPromise;

  _authPromise = new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) { stop(); resolve(user.uid); }
    }, reject);

    signInAnonymously(auth).catch((err) => {
      stop();
      // Häufigster Grund: "Anonyme Anmeldung" ist in der Firebase Console
      // unter Authentication → Sign-in method nicht eingeschaltet.
      reject(new Error(
        'Anonyme Anmeldung bei Firebase fehlgeschlagen: ' + (err?.message || err)
        + ' – in der Firebase Console unter Authentication → Anmeldemethode '
        + '"Anonym" aktivieren.'
      ));
    });
  }).catch((err) => { _authPromise = null; throw err; });

  return _authPromise;
}

/** Die Kennung, sofern schon bekannt – ohne Anmeldeversuch. */
function currentOwnerId() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

/* ── Echte Kennung: das ID-Token weiterreichen ──────────────────────
   Angemeldet wird bei Google bzw. Microsoft. Firebase gegenüber meldete
   sich bisher nur das Gerät anonym – die Sicherheitsregeln kannten
   deshalb keine E-Mail-Adresse, und "Freigabe für bestimmte Adressen"
   war schlicht nicht durchsetzbar.

   Beide Anbieter liefern bei der Anmeldung ohnehin ein `id_token` mit
   (der Bereich `openid` wird längst angefragt). Das wird jetzt nicht
   mehr weggeworfen, sondern hier an Firebase weitergereicht. Danach
   stehen in den Regeln request.auth.uid UND request.auth.token.email.
   ─────────────────────────────────────────────────────────────────── */

/**
 * @param {object} args
 * @param {'google'|'microsoft'} args.provider
 * @param {string} args.idToken   das id_token aus der Anmeldung
 * @param {string} [args.rawNonce] nur Microsoft: die nonce aus dem
 *   Anmeldeaufruf. Ohne sie lehnt Firebase das Token ab.
 * @returns {Promise<object>} der angemeldete Firebase-Nutzer
 */
/**
 * Liest die Adresse aus einem id_token, ohne es zu prüfen – das macht
 * Firebase. Hier geht es allein um die Frage, ob schon DASSELBE Konto
 * angemeldet ist. Gibt '' zurück, wenn sich nichts ablesen lässt.
 */
function emailFromIdToken(idToken) {
  try {
    const payload = String(idToken).split('.')[1];
    if (!payload) return '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json);
    return normalizeEmail(claims.email || claims.preferred_username || '');
  } catch (err) {
    return '';
  }
}

/* >>> Was bei Microsoft NICHT funktioniert – bitte nicht erneut versuchen <<<

   Firebase nimmt für microsoft.com KEINE selbst besorgte Anmeldung an.
   Am 02.08.2026 gegen den echten Endpunkt durchgemessen, mit einem
   frischen Token und eingeschaltetem Anbieter:

     id_token allein                → INVALID_CREDENTIAL_OR_PROVIDER_ID
     id_token + access_token        → INVALID_CREDENTIAL_OR_PROVIDER_ID
     access_token allein            → INVALID_CREDENTIAL_OR_PROVIDER_ID

   Dass der Anbieter eingeschaltet ist, wurde dabei ebenfalls belegt:
   accounts:createAuthUri liefert für microsoft.com eine Adresse mit
   genau unserer Anwendungs-ID zurück.

   Der Grund ist bauartbedingt: Google ist bei Firebase ein
   eigenständiger Anbieter, dessen Token direkt geprüft werden.
   Microsoft ist ein generischer OAuth-Anbieter – dessen Anmeldung muss
   Firebase SELBST begonnen haben (createAuthUri liefert dazu eine
   sessionId). Ohne die gibt es keinen Weg hinein.

   Die Meldung dazu lautet ausgerechnet
   „invalid-credential-or-provider-id" – dieselbe wie bei einem
   abgeschalteten Anbieter. Das hat schon einmal zu einer langen,
   ergebnislosen Suche in der Firebase Console geführt. */
async function signInWithProviderToken({ provider, idToken, rawNonce } = {}) {
  if (!idToken) throw new Error('NO_ID_TOKEN');

  const credential = provider === 'microsoft'
    ? new OAuthProvider('microsoft.com').credential({ idToken, rawNonce: rawNonce || undefined })
    : GoogleAuthProvider.credential(idToken);

  const existing = auth.currentUser;
  const wanted = emailFromIdToken(idToken);

  /* Schon mit DERSELBEN Adresse angemeldet? Dann nichts tun – ein zweiter
     Anmeldeversuch würde nur eine neue Sitzung anlegen.

     >>> Der Vergleich der Adresse ist der Kern <<<
     Vorher genügte es, dass überhaupt irgendein echtes Konto angemeldet
     war. Nach einem Wechsel – abmelden, mit einer anderen Adresse
     anmelden – blieb die ALTE Firebase-Sitzung dadurch bestehen, und die
     geteilten Dokumente wurden weiter unter der alten Adresse gesucht.

     Lässt sich die Adresse nicht ablesen, wird neu angemeldet. Das kostet
     eine Anfrage, ist aber richtig – die Kennung stammt dann sicher aus
     dem Token, das gerade hereingereicht wurde. */
  if (existing && !existing.isAnonymous && wanted
      && normalizeEmail(existing.email) === wanted) {
    return existing;
  }

  /* Der Bestandsfall: dieses Gerät war bisher anonym angemeldet, und alle
     hier erstellten Freigaben hängen an genau dieser Kennung.
     linkWithCredential hebt dieselbe Kennung auf das echte Konto – die
     Freigaben ziehen dadurch von selbst mit, ganz ohne Umschreiben. */
  if (existing && existing.isAnonymous) {
    try {
      const result = await linkWithCredential(existing, credential);
      return result.user;
    } catch (err) {
      // Das Konto gehört bereits zu einer anderen Firebase-Kennung – also
      // ein zweites Gerät. Dann normal anmelden; die eigenen Freigaben holt
      // sich claimOwnShares() über die hinterlegte E-Mail-Adresse zurück.
      const code = String(err?.code || '');
      if (!/credential-already-in-use|provider-already-linked|email-already-in-use/.test(code)) {
        throw err;
      }
      console.warn('[Share] Anonyme Kennung nicht übertragbar, melde neu an:', code);
    }
  }

  const result = await signInWithCredential(auth, credential);
  return result.user;
}

/** Wer ist gerade angemeldet? null, solange Firebase noch nichts weiß. */
function currentIdentity() {
  const user = auth.currentUser;
  if (!user) return null;
  return {
    uid: user.uid,
    email: normalizeEmail(user.email),
    name: user.displayName || '',
    verified: !!user.emailVerified,
    anonymous: !!user.isAnonymous
  };
}

/** Angemeldet mit einem echten Konto (nicht nur anonym als Gerät)? */
function hasRealIdentity() {
  const me = currentIdentity();
  return !!(me && !me.anonymous && me.email);
}

/**
 * Auch bei Firebase abmelden. Beim Abmelden aufgerufen – in der App von
 * CloudSync.signOut(), auf der Website von inkwellLogout().
 *
 * Ohne das blieb die Firebase-Sitzung nach dem Abmelden bestehen. Wer sich
 * danach mit einer anderen Adresse anmeldete, bekam die geteilten Dokumente
 * weiterhin für die alte gesucht – die Anmeldung bei Google bzw. Microsoft
 * und die bei Firebase sind zwei verschiedene Dinge.
 */
async function signOutIdentity() {
  if (!auth.currentUser) return;
  await fbSignOut(auth);
}

/**
 * Microsoft-Anmeldung über Firebases EIGENEN Ablauf.
 *
 * Der einzige Weg, der bei Microsoft funktioniert: Firebase muss die
 * Anmeldung selbst begonnen haben (Begründung ausführlich über
 * signInWithProviderToken). Es öffnet dafür ein Fenster auf
 * inkwell-53ab9.firebaseapp.com.
 *
 * >>> Setzt eine in Firebase erlaubte Herkunft voraus <<<
 * Firebase Console → Authentication → Settings → Authorized domains.
 *   · App     : liefert ihre Oberfläche deshalb über http://localhost aus
 *               statt über file:// – siehe startUiServer() in main.js.
 *               main.js gibt zusätzlich das Anmeldefenster frei, sonst
 *               blockt Electron window.open.
 *   · Website : steht inkwells.me dort nicht, kommt
 *               auth/unauthorized-domain zurück.
 *
 * Muss aus einem Klick heraus aufgerufen werden; ein Fenster ohne
 * Zutun des Nutzers wird geblockt.
 *
 * @param {string} [loginHint] Adresse, die vorgeschlagen wird
 */
async function signInMicrosoftInteractive(loginHint = '') {
  const provider = new OAuthProvider('microsoft.com');
  provider.addScope('email');

  /* Nur persönliche Konten, wie überall sonst in Inkwell (TENANT in
     src/core/cloudConfig.js bzw. website/js/config.js). Ein Geschäfts-
     oder Schulkonto liefe hier sonst in dieselbe unerklärte Fehlerseite
     wie bei der Anmeldung. */
  const params = { tenant: 'consumers' };
  if (loginHint) params.login_hint = loginHint;
  provider.setCustomParameters(params);

  try {
    const result = await signInWithPopup(auth, provider);
    offeneVerknuepfung = null;
    return result.user;
  } catch (err) {
    if (err?.code !== 'auth/account-exists-with-different-credential') throw err;

    /* ══════════════════════════════════════════════════════════════════
       DIESELBE ADRESSE, SCHON ÜBER GOOGLE ANGEMELDET

       Firebase führt je E-Mail-Adresse EIN Konto. Wer sein
       Microsoft-Konto auf eine Adresse angelegt hat, mit der er hier
       schon einmal über Google angemeldet war (bei einer @gmail.com als
       Microsoft-Konto keine Seltenheit), bekommt beim
       Microsoft-Anmelden genau diesen Fehler.

       Auflösen lässt sich das nur so, wie Firebase es vorsieht: einmal
       mit dem BEKANNTEN Anbieter anmelden und die Microsoft-Anmeldung
       daran anhängen. Danach gehören beide Wege zu einem Konto, und
       Inkwell sieht dieselbe Person – wichtig, weil die Freigaben an der
       Adresse hängen, nicht an der Anmeldeart.

       Der Anhang bleibt hier liegen, statt gleich weiterzumachen: das
       Fenster für Google braucht einen eigenen Klick. Ein zweites
       Fenster ohne Zutun des Nutzers wird geblockt – es geht sonst
       stumm nichts mehr. Die Oberfläche macht daraus den Knopf
       „Mit Google bestätigen" (ui/share.js).
       ══════════════════════════════════════════════════════════════════ */
    /* Der Anhang darf FEHLEN. credentialFromError liefert ihn nicht in
       jedem Fall zurück, und daran darf der zweite Schritt nicht
       scheitern: worauf es ankommt, ist, dass Firebase den Nutzer unter
       DIESER Adresse kennt – und das erledigt schon die Anmeldung über
       Google. Der Anhang macht daraus zusätzlich ein Konto mit beiden
       Wegen. Ohne ihn ging bisher gar nichts weiter: der Knopf blieb auf
       Schritt eins stehen, und niemand kam je zu Schritt zwei. */
    offeneVerknuepfung = {
      credential: OAuthProvider.credentialFromError(err) || null,
      email: normalizeEmail(err?.customData?.email) || normalizeEmail(loginHint),
      at: Date.now()
    };
    const fehler = new Error('MICROSOFT_NEEDS_GOOGLE');
    fehler.code = 'inkwell/microsoft-needs-google';
    fehler.email = offeneVerknuepfung.email;
    throw fehler;
  }
}

/* Die Microsoft-Anmeldung, die auf ihre Verknüpfung wartet. Nur im
   Speicher: eine Anmeldung von Microsoft ist Minuten gültig, nicht Tage. */
let offeneVerknuepfung = null;

/** Wartet gerade eine Microsoft-Anmeldung auf das Ja über Google? */
function microsoftWartetAufGoogle() {
  if (!offeneVerknuepfung) return null;
  // Nach fünf Minuten ist die Anmeldung von Microsoft ohnehin abgelaufen
  if (Date.now() - offeneVerknuepfung.at > 5 * 60 * 1000) {
    offeneVerknuepfung = null;
    return null;
  }
  return { email: offeneVerknuepfung.email };
}

/**
 * Holt das Ja über Google und hängt Microsoft an dasselbe Konto.
 *
 * Muss aus einem KLICK heraus gerufen werden – es öffnet ein Fenster.
 *
 * @returns {Promise<object>} der jetzt angemeldete Nutzer
 */
async function linkMicrosoftWithGoogle(emailHint = '') {
  const wartet = microsoftWartetAufGoogle();
  const credential = offeneVerknuepfung ? offeneVerknuepfung.credential : null;
  const email = (wartet && wartet.email) || normalizeEmail(emailHint);

  const google = new GoogleAuthProvider();
  google.addScope('email');
  if (email) google.setCustomParameters({ login_hint: email });

  await signInWithPopup(auth, google);

  /* Ab hier kennt Firebase den Nutzer unter seiner Adresse – das ist das
     Ziel, und die geteilten Dokumente gehen damit. Das Anhängen von
     Microsoft ist die Zugabe: es erspart den Umweg beim nächsten Mal.
     Scheitert sie, wird das nicht zum Fehler des Ganzen gemacht. */
  if (credential) {
    try {
      await linkWithCredential(auth.currentUser, credential);
    } catch (err) {
      /* Schon verknüpft? Dann ist genau das erreicht, was gewollt war.
         Kommt vor, wenn der Knopf zweimal gedrückt wurde. */
      if (err?.code !== 'auth/provider-already-linked'
          && err?.code !== 'auth/credential-already-in-use') {
        console.warn('[Share] Microsoft liess sich nicht anhängen:',
          err?.code || '', err?.message || err);
      }
    }
  }
  offeneVerknuepfung = null;
  return auth.currentUser;
}

/* Antworten, die schlicht heissen „dafuer braucht es einen Menschen". Kein
   Fehler, sondern das erwartete Ende eines stillen Versuchs. */
const STILL_GESCHEITERT = /login_required|interaction_required|consent_required|account_selection_required|popup-blocked|popup-closed-by-user|cancelled-popup-request|user-cancelled/i;

/**
 * Derselbe Ablauf, aber ohne Zutun – fuer den Start der App.
 *
 * Microsoft kennt dafuer prompt=none: entweder es liegt eine gueltige
 * Sitzung vor (als Cookie, aus der OneDrive-Anmeldung derselben
 * Electron-Sitzung), dann kommt sofort ein Token zurueck. Oder es kommt
 * login_required – dann ist eine Eingabe noetig und wir lassen es.
 *
 * Firebase oeffnet dafuer trotzdem sein Fenster. Damit beim Start nichts
 * aufblitzt, meldet der Aufrufer das vorher an (siehe
 * linkMicrosoftSilently in core/cloudSync.js); main.js laesst das Fenster
 * dann unsichtbar.
 *
 * @param {string} [loginHint] Adresse, unter der es versucht wird
 * @returns {Promise<object|null>} null, wenn es ohne Eingabe nicht geht
 */
async function signInMicrosoftSilently(loginHint = '') {
  const provider = new OAuthProvider('microsoft.com');
  provider.addScope('email');

  const params = { tenant: 'consumers', prompt: 'none' };
  if (loginHint) params.login_hint = loginHint;
  provider.setCustomParameters(params);

  try {
    const result = await signInWithPopup(auth, provider);
    offeneVerknuepfung = null;
    return result.user;
  } catch (err) {
    /* Dieselbe Adresse gehört schon zu einer Anmeldung über Google. Die
       Anmeldung von Microsoft ist damit gültig, aber heimatlos – hier
       aufheben, damit der Knopf in der Oberfläche daraus den zweiten
       Schritt machen kann, ohne noch einmal bei Microsoft zu fragen. */
    if (err?.code === 'auth/account-exists-with-different-credential') {
      const anhang = OAuthProvider.credentialFromError(err);
      if (anhang) {
        offeneVerknuepfung = {
          credential: anhang,
          email: normalizeEmail(err?.customData?.email) || normalizeEmail(loginHint),
          at: Date.now()
        };
      }
      return null;
    }

    const text = String(err?.code || '') + ' ' + String(err?.message || '');
    if (STILL_GESCHEITERT.test(text)) return null;
    throw err;
  }
}

/**
 * Meldet sich, sobald Firebase den Anmeldestand kennt und bei jedem
 * weiteren Wechsel. Gibt die Abmeldefunktion zurück.
 */
function onIdentityChanged(callback) {
  return onAuthStateChanged(auth, () => callback(currentIdentity()));
}

/**
 * Wartet auf den ersten Anmeldestand. Firebase stellt seine Sitzung beim
 * Laden aus dem lokalen Speicher wieder her – das dauert einen Moment,
 * und vorher ist auth.currentUser noch null.
 */
function whenIdentityReady() {
  if (auth.currentUser) return Promise.resolve(currentIdentity());
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, () => { stop(); resolve(currentIdentity()); });
  });
}

/**
 * Holt Freigaben zurück, die noch einer anonymen Gerätekennung gehören.
 * Möglich, weil beim Veröffentlichen die E-Mail des Kontos mitgeschrieben
 * wird (ownerEmail) – die Regel erlaubt dem Inhaber dieser Adresse, sich
 * selbst als Besitzer einzutragen.
 *
 * @param {string[]} shareIds die eigenen Freigaben (aus der Merkliste)
 * @returns {Promise<number>} wie viele übernommen wurden
 */
async function claimOwnShares(shareIds = []) {
  const me = currentIdentity();
  if (!me || me.anonymous || !me.email) return 0;

  let claimed = 0;
  for (const shareId of shareIds) {
    if (!shareId) continue;
    try {
      const ref = doc(db, SHARES, shareId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;

      const data = snap.data() || {};
      if (data.owner === me.uid) continue;
      if (normalizeEmail(data.ownerEmail) !== me.email) continue;

      await updateDoc(ref, { owner: me.uid, ownerEmail: me.email });
      claimed++;
    } catch (err) {
      console.warn('[Share] Freigabe konnte nicht übernommen werden:', shareId, err?.message || err);
    }
  }
  return claimed;
}

/* ── Hilfsmittel ────────────────────────────────────────────────────── */

/** Lange, nicht erratbare Kennung für die Adresse (~131 Bit). */
function makeShareId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function shareUrlFor(shareId) {
  return `${SHARE_BASE_URL}?id=${encodeURIComponent(shareId)}`;
}

/** Adresse eines geteilten Dokuments. Trägt die Link- statt der Dokumentkennung. */
function docUrlFor(linkId) {
  return `${SHARE_BASE_URL}?d=${encodeURIComponent(linkId)}`;
}

/** Adresse, die statt des Browsers die App öffnet (siehe main.js). */
function appUrlFor(linkId) {
  return `inkwell://share/${encodeURIComponent(linkId)}`;
}

/**
 * Adressen werden kleingeschrieben und getrimmt abgelegt. Ohne das greift
 * array-contains nicht: "Max@Example.de" und "max@example.de" wären für
 * Firestore zwei verschiedene Einträge.
 */
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(value));
}

/** Zerlegt eine Zeichenkette in Stücke unter der Dokumentgrenze. */
function splitIntoChunks(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return chunks.length ? chunks : [''];
}

/**
 * Führt einen Firestore-Schritt aus und macht aus "permission-denied" eine
 * Meldung, mit der man etwas anfangen kann. Ohne das steht in der Konsole
 * nur "Missing or insufficient permissions" – ohne zu verraten, welcher
 * Schritt es war und woran es lag.
 */
async function step(label, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code === 'permission-denied') {
      const uid = currentOwnerId();
      const detail = new Error(
        `Firestore hat "${label}" abgelehnt. Übliche Ursachen: `
        + '(1) die Regeln aus website/firestore.rules sind noch nicht veröffentlicht, '
        + '(2) unter Authentication → Anmeldemethode ist "Anonym" nicht aktiviert, '
        + '(3) das Projekt in der Console ist ein anderes als in js/share.js. '
        + `Angemeldet als: ${uid || '(nicht angemeldet)'} · Projekt: ${firebaseConfig.projectId}`
      );
      detail.code = 'permission-denied';
      detail.step = label;
      throw detail;
    }
    throw err;
  }
}

/** Alle Stücke einer Freigabe löschen – stapelweise. */
async function deleteChunks(shareId) {
  const existing = await getDocs(collection(db, SHARES, shareId, CHUNKS));
  let batch = writeBatch(db);
  let count = 0;

  for (const snap of existing.docs) {
    batch.delete(snap.ref);
    if (++count >= MAX_BATCH) { await batch.commit(); batch = writeBatch(db); count = 0; }
  }
  if (count > 0) await batch.commit();
}

/* ── Veröffentlichen ────────────────────────────────────────────────── */

/**
 * Legt eine Freigabe an oder ersetzt ihren Inhalt.
 *
 * @param {object}  notebook          das vollständige Heft
 * @param {object}  [options]
 * @param {'frozen'|'live'} [options.mode='frozen']
 *   'frozen' = der Link zeigt genau diesen Stand, bis man ihn aktualisiert.
 *   'live'   = der Stand wird bei jedem Cloud-Abgleich mitgeschrieben.
 * @param {string}  [options.shareId] vorhandene Freigabe ersetzen
 * @returns {Promise<{shareId: string, url: string, mode: string, bytes: number, chunks: number}>}
 */
async function publishNotebook(notebook, options = {}) {
  const ownerId = await ensureOwnerId();
  const mode = options.mode === 'live' ? 'live' : 'frozen';
  const shareId = options.shareId || makeShareId();

  const payload = JSON.stringify(notebook);
  const chunks = splitIntoChunks(payload);

  // Beim Ersetzen zuerst prüfen, ob dieses Gerät überhaupt darf – sonst
  // scheitert erst der halbe Schreibvorgang und lässt Bruchstücke zurück.
  if (options.shareId) {
    const head = await step('Freigabe prüfen', () => getDoc(doc(db, SHARES, shareId)));
    if (head.exists() && head.data().owner !== ownerId) {
      throw new Error('SHARE_NOT_OWNED');
    }
  }

  /* Reihenfolge: erst der Kopf, dann die Stücke.
     Der Kopf trägt den Besitzer – erst dadurch kann die Regel für die
     Stücke überhaupt prüfen, wem sie gehören. Andersherum müsste sie beim
     ersten Anlegen jedem anonym Angemeldeten das Schreiben erlauben.

     Dass ein Leser den Link genau dazwischen öffnet, fängt die Leseseite
     ab: sie vergleicht die Zahl der gefundenen Stücke mit chunkCount und
     versucht es bei Bedarf noch einmal. */
  // Die E-Mail des Kontos wandert mit in den Kopf. Sie ist der einzige
  // Anker, über den eine Freigabe von einem anderen Gerät aus wieder dem
  // richtigen Konto zugeordnet werden kann (siehe claimOwnShares).
  const ownerEmail = normalizeEmail(
    currentIdentity()?.email || options.ownerEmail || ''
  );

  await step('Kopf schreiben', () => setDoc(doc(db, SHARES, shareId), {
    owner: ownerId,
    ...(ownerEmail ? { ownerEmail } : {}),
    mode,
    title: String(notebook.name || 'Notizbuch').slice(0, 200),
    color: String(notebook.color || '#c8a96e'),
    notebookId: String(notebook.id || ''),
    pageCount: Array.isArray(notebook.pages) ? notebook.pages.length : 0,
    chunkCount: chunks.length,
    updatedAt: serverTimestamp(),
    ...(options.shareId ? {} : { createdAt: serverTimestamp() })
  }, { merge: !!options.shareId }));

  // Reste einer früheren, längeren Fassung wegräumen
  if (options.shareId) await step('Alte Stücke entfernen', () => deleteChunks(shareId));

  let batch = writeBatch(db);
  let count = 0;
  for (let i = 0; i < chunks.length; i++) {
    batch.set(doc(db, SHARES, shareId, CHUNKS, String(i)), { i, data: chunks[i] });
    if (++count >= MAX_BATCH) {
      const b = batch; await step('Stücke schreiben', () => b.commit());
      batch = writeBatch(db); count = 0;
    }
  }
  if (count > 0) { const b = batch; await step('Stücke schreiben', () => b.commit()); }

  return {
    shareId,
    url: shareUrlFor(shareId),
    mode,
    bytes: payload.length,
    chunks: chunks.length
  };
}

/* ── Lesen (ohne Anmeldung) ─────────────────────────────────────────── */

/**
 * Holt ein freigegebenes Heft. Braucht keine Anmeldung – genau dafür ist
 * die Freigabe da.
 *
 * @param {string} shareId
 * @returns {Promise<{notebook: object, title: string, mode: string, updatedAt: Date|null}>}
 */
async function loadSharedNotebook(shareId) {
  if (!shareId) throw new Error('SHARE_NOT_FOUND');

  const head = await getDoc(doc(db, SHARES, shareId));
  if (!head.exists()) throw new Error('SHARE_NOT_FOUND');

  const meta = head.data() || {};
  const expected = Number(meta.chunkCount) || 0;

  // Der Kopf steht vor den Stücken in der Datenbank. Wird der Link genau
  // während des Veröffentlichens geöffnet, fehlen noch Stücke – dann lieber
  // einmal kurz warten als ein halbes Heft anzeigen.
  let snapshot = await getDocs(
    query(collection(db, SHARES, shareId, CHUNKS), orderBy('i', 'asc'))
  );
  if (expected && snapshot.docs.length < expected) {
    await new Promise(r => setTimeout(r, 1500));
    snapshot = await getDocs(
      query(collection(db, SHARES, shareId, CHUNKS), orderBy('i', 'asc'))
    );
  }

  if (snapshot.empty) throw new Error('SHARE_EMPTY');
  if (expected && snapshot.docs.length < expected) throw new Error('SHARE_INCOMPLETE');

  const text = snapshot.docs.map(d => (d.data() || {}).data || '').join('');

  let notebook;
  try {
    notebook = JSON.parse(text);
  } catch (err) {
    throw new Error('SHARE_BROKEN');
  }

  const updatedAt = meta.updatedAt && typeof meta.updatedAt.toDate === 'function'
    ? meta.updatedAt.toDate()
    : null;

  return { notebook, title: meta.title || notebook?.name || '', mode: meta.mode || 'frozen', updatedAt };
}

/* ── Aufheben ───────────────────────────────────────────────────────── */

/**
 * Hebt eine Freigabe auf. Danach läuft der Link ins Leere.
 * @param {string} shareId
 */
async function revokeShare(shareId) {
  const ownerId = await ensureOwnerId();

  const head = await getDoc(doc(db, SHARES, shareId));
  if (!head.exists()) return true;                       // schon weg
  if (head.data().owner !== ownerId) throw new Error('SHARE_NOT_OWNED');

  await deleteChunks(shareId);
  await deleteDoc(doc(db, SHARES, shareId));
  return true;
}

/** Gehört diese Freigabe dem aktuellen Gerät? */
async function isOwnShare(shareId) {
  try {
    const ownerId = await ensureOwnerId();
    const head = await getDoc(doc(db, SHARES, shareId));
    return head.exists() && head.data().owner === ownerId;
  } catch (err) {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   GETEILTE DOKUMENTE

   Anders als die Lesekopie oben ist ein Dokument mit bestimmten Leuten
   geteilt und trägt je Person eine Rolle. Die Empfängerliste steht in
   EINEM Feld (memberEmails); der Tab „Geteilte Dokumente" ist genau eine
   Abfrage darauf. Wird jemand entfernt, verschwindet das Dokument bei ihm
   von selbst – es braucht keine zweite Liste, die auseinanderlaufen kann.
   ══════════════════════════════════════════════════════════════════════ */

/** Wirft, wenn kein echtes Konto angemeldet ist. */
function requireIdentity() {
  const me = currentIdentity();
  if (!me || me.anonymous || !me.email) throw new Error('NEEDS_ACCOUNT');
  return me;
}

function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'view';
}

function normalizeLinkMode(mode) {
  return LINK_MODES.includes(mode) ? mode : 'off';
}

/** Kopf eines Dokuments in eine Form bringen, mit der die Oberfläche arbeitet. */
function describeDoc(docId, data) {
  const members = (data.members && typeof data.members === 'object') ? data.members : {};
  const via = (data.memberVia && typeof data.memberVia === 'object') ? data.memberVia : {};
  const toDate = (value) => (value && typeof value.toDate === 'function') ? value.toDate() : null;

  return {
    docId,
    owner: data.owner || '',
    ownerEmail: normalizeEmail(data.ownerEmail),
    ownerName: data.ownerName || '',
    title: data.title || '',
    color: data.color || '#c8a96e',
    defaultBg: data.defaultBg || 'ruled',
    notebookId: data.notebookId || '',
    pageCount: Number(data.pageCount) || 0,
    chunkCount: Number(data.chunkCount) || 0,
    revision: Number(data.revision) || 0,
    // 'pages' = zerlegt abgelegt. Freigaben aus der Zeit davor haben hier
    // nichts stehen und werden weiterhin aus den Stücken gelesen.
    format: data.format || '',
    pageOrder: Array.isArray(data.pageOrder) ? data.pageOrder : [],
    sections: Array.isArray(data.sections) ? data.sections : [],
    activeSecId: data.activeSecId || '',
    linkMode: normalizeLinkMode(data.linkMode),
    linkId: data.linkId || '',
    memberEmails: Array.isArray(data.memberEmails) ? data.memberEmails : [],
    members,
    memberVia: via,
    /* Firebase-Kennung je Adresse: { uid: email }.
       Die Mitgliedschaft steht als ADRESSE im Kopf, die Regeln der
       Realtime Database kennen aber nur auth.uid. Jeder trägt seine
       eigene Kennung beim Öffnen selbst ein (registerMyUid), damit der
       Besitzer daraus die Rollenliste des Raums bauen kann. */
    memberUids: (data.memberUids && typeof data.memberUids === 'object') ? data.memberUids : {},
    blockedEmails: Array.isArray(data.blockedEmails) ? data.blockedEmails : [],
    updatedAt: toDate(data.updatedAt),
    createdAt: toDate(data.createdAt),
    sharedAt: toDate(data.sharedAt) || toDate(data.createdAt),
    /** Welche Rolle hat diese Adresse? null = gar keinen Zugriff. */
    roleFor(email) {
      const key = normalizeEmail(email);
      if (!key) return null;
      if (key === normalizeEmail(data.ownerEmail)) return 'edit';
      if (!this.memberEmails.includes(key)) return null;
      return normalizeRole(members[key]);
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════
   UMWANDLER  ―  Heft ⇄ zerlegtes Dokument

   Bewusst reine Funktionen ohne Firestore: nur so lässt sich der Hin- und
   Rückweg prüfen, ohne etwas zu schreiben. Ein Heft, das durch beide
   Richtungen läuft, muss wieder dasselbe Heft sein.
   ══════════════════════════════════════════════════════════════════════ */

/** Erkennt eingebettete Bilddaten (data:…) – die gehören nicht in die Seite. */
function isInlineData(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

/* ── Die Seiten eines Hefts in Heft-Reihenfolge ──────────────────────
   Gegenstück zu notebookPages() in core/data.js. Bewusst hier noch einmal
   und nicht von dort geholt: diese Datei läuft auch auf der Website, und
   dort gibt es kein data.js. Sie muss für sich allein stehen.

   >>> Was das behebt <<<
   head.pageOrder wurde bisher aus notebook.pages gebildet – und das ist
   reine Einfüge-Reihenfolge. Wer eine Seite in die Mitte einfügte, hatte
   sie dort ganz hinten. In der Cloud stand damit die FALSCHE Reihenfolge;
   website/js/viewer.js beschreibt das als Warnung und rechnet sie sich
   selbst aus den Abschnitten zusammen. */
function pagesInOrder(notebook) {
  const pages = Array.isArray(notebook?.pages) ? notebook.pages : [];
  const byId = new Map(pages.map(p => [String(p.id), p]));
  const out = [];
  const seen = new Set();

  for (const sec of (notebook?.sections || [])) {
    for (const pgId of (sec?.pgIds || [])) {
      const key = String(pgId);
      if (seen.has(key) || !byId.has(key)) continue;
      seen.add(key);
      out.push(byId.get(key));
    }
  }
  for (const page of pages) {
    if (!seen.has(String(page.id))) out.push(page);
  }
  return out;
}

/**
 * Zerlegt ein Heft in die Teile, die einzeln abgelegt werden.
 *
 * @param {object} notebook
 * @returns {{head:object, pages:object[], ink:object[], blobs:object[]}}
 */
function splitNotebook(notebook) {
  const pagesIn = pagesInOrder(notebook);
  const pages = [];
  const ink = [];
  const blobs = [];

  const addBlob = (ref, pageId, data) => {
    const parts = splitIntoChunks(String(data));
    parts.forEach((part, i) => {
      blobs.push({ key: `${ref}__${i}`, ref, pageId, i, total: parts.length, data: part });
    });
  };

  pagesIn.forEach((page, index) => {
    const pageId = String(page.id);

    // Bilder heraustrennen: ein Foto darf nicht bei jeder Textänderung
    // erneut über die Leitung gehen.
    const objects = (page.objects || []).map((obj, objIdx) => {
      const copy = { ...obj };
      if (isInlineData(copy.src)) {
        const ref = `obj_${pageId}_${obj.id || objIdx}`;
        addBlob(ref, pageId, copy.src);
        copy.src = `blob:${ref}`;
      }
      return copy;
    });

    let hasBg = false;
    if (isInlineData(page.bgImg)) {
      addBlob(`bg_${pageId}`, pageId, page.bgImg);
      hasBg = true;
    }

    pages.push({
      id: pageId,
      index,
      bg: page.bg ?? null,
      w: page.w ?? null,
      h: page.h ?? null,
      date: page.date || '',
      text: page.textContent || '',
      objects,
      hasBg
    });

    // Handschrift bogenweise. Die Aufteilung richtet sich nach der Größe,
    // nicht nach einer festen Anzahl – ein Strich mit 2000 Punkten wiegt
    // so viel wie fünfzig kurze.
    const strokes = Array.isArray(page.inkStrokes) ? page.inkStrokes : [];
    let sheet = [];
    let sheetBytes = 0;
    let sheetNo = 0;

    const flush = () => {
      if (!sheet.length) return;
      ink.push({ id: `${pageId}__${sheetNo}`, pageId, no: sheetNo, strokes: sheet });
      sheetNo++;
      sheet = [];
      sheetBytes = 0;
    };

    for (const stroke of strokes) {
      const size = JSON.stringify(stroke).length;
      if (sheetBytes + size > INK_SHEET_LIMIT && sheet.length) flush();
      sheet.push(stroke);
      sheetBytes += size;
    }
    flush();
  });

  const head = {
    title: String(notebook.name || 'Notizbuch').slice(0, 200),
    color: String(notebook.color || '#c8a96e'),
    defaultBg: String(notebook.defaultBg || 'ruled'),
    notebookId: String(notebook.id || ''),
    pageCount: pagesIn.length,
    pageOrder: pagesIn.map(p => String(p.id)),
    // Abschnitte sind nur Namen und Seitenlisten – klein genug für den Kopf
    sections: (notebook.sections || []).map(sec => {
      const eintrag = {
        id: String(sec.id),
        name: String(sec.name || ''),
        pgIds: (sec.pgIds || []).map(String),
        defaultBg: sec.defaultBg || notebook.defaultBg || 'ruled'
      };
      /* Nur wenn wirklich eine ausgesucht wurde. Ohne Wahl rechnet
         colorForSection() eine aus der Kennung – ein leeres Feld
         mitzuschreiben waere Rauschen im Kopf. */
      if (sec.color) eintrag.color = String(sec.color);
      return eintrag;
    }),
    activeSecId: notebook.activeSecId || ''
  };

  return { head, pages, ink, blobs };
}

/**
 * Setzt aus den Teilen wieder ein Heft zusammen – genau die Form, mit der
 * Editor, Betrachter und Export ohnehin arbeiten. Dadurch muss außerhalb
 * dieser Datei niemand das zerlegte Modell kennen.
 *
 * @param {object} head    Kopfdaten (describeDoc-Form oder roh)
 * @param {object[]} pages
 * @param {object[]} ink
 * @param {object[]} blobs
 * @returns {object} notebook
 */
function assembleNotebook(head, pages = [], ink = [], blobs = []) {
  // Bilddaten je Verweis wieder zusammensetzen
  const byRef = new Map();
  for (const blob of blobs) {
    if (!byRef.has(blob.ref)) byRef.set(blob.ref, []);
    byRef.get(blob.ref).push(blob);
  }
  const dataFor = (ref) => {
    const parts = byRef.get(ref);
    if (!parts) return null;
    return parts.slice().sort((a, b) => (a.i || 0) - (b.i || 0)).map(p => p.data || '').join('');
  };

  // Striche je Seite, Bögen in ihrer Reihenfolge
  const strokesByPage = new Map();
  for (const sheet of ink.slice().sort((a, b) => (a.no || 0) - (b.no || 0))) {
    if (!strokesByPage.has(sheet.pageId)) strokesByPage.set(sheet.pageId, []);
    strokesByPage.get(sheet.pageId).push(...(sheet.strokes || []));
  }

  const order = Array.isArray(head.pageOrder) ? head.pageOrder : [];
  const sorted = pages.slice().sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    if (ia !== -1 && ib !== -1) return ia - ib;
    return (a.index || 0) - (b.index || 0);
  });

  const notebookPages = sorted.map(page => {
    const objects = (page.objects || []).map(obj => {
      const copy = { ...obj };
      if (typeof copy.src === 'string' && copy.src.startsWith('blob:')) {
        copy.src = dataFor(copy.src.slice(5)) || '';
      }
      return copy;
    });

    const out = {
      id: page.id,
      date: page.date || new Date().toISOString(),
      bg: page.bg ?? null,
      textContent: page.text || '',
      inkStrokes: strokesByPage.get(page.id) || [],
      objects
    };
    if (page.w) out.w = page.w;
    if (page.h) out.h = page.h;
    if (page.hasBg) {
      const data = dataFor(`bg_${page.id}`);
      if (data) out.bgImg = data;
    }
    return out;
  });

  const notebook = {
    id: head.notebookId || '',
    name: head.title || 'Notizbuch',
    color: head.color || '#c8a96e',
    defaultBg: head.defaultBg || 'ruled',
    pages: notebookPages,
    sections: Array.isArray(head.sections) ? head.sections.map(s => ({ ...s })) : []
  };
  if (head.activeSecId) notebook.activeSecId = head.activeSecId;

  /* Abschnitte sind Etiketten: die Zugehoerigkeit gehoert an die Seite.
     Uebertragen wird sie weiterhin in den abgeleiteten pgIds des Kopfes –
     hier wird sie zurueckgerechnet. Ein Dokument ganz ohne Abschnitte
     braucht keinen Ersatz mehr: "alle Seiten" zeigt ohnehin alles. */
  for (const sec of notebook.sections) {
    for (const pgId of (sec.pgIds || [])) {
      const page = notebookPages.find(p => String(p.id) === String(pgId));
      if (page && !page.secId) page.secId = String(sec.id);
    }
  }
  for (const sec of notebook.sections) {
    sec.pgIds = notebookPages.filter(p => String(p.secId || '') === String(sec.id)).map(p => p.id);
  }
  notebook.schemaVersion = 2;

  return notebook;
}

/* ── Besitzerseite ──────────────────────────────────────────────────── */

/**
 * Legt ein geteiltes Dokument an oder schreibt seinen Inhalt neu.
 *
 * @param {object} notebook das vollständige Heft
 * @param {object} [options]
 * @param {string} [options.docId]     bestehendes Dokument ersetzen
 * @param {'off'|'view'|'edit'} [options.linkMode='off']
 * @param {string} [options.ownerName] Anzeigename für die Empfänger
 * @returns {Promise<{docId:string, linkId:string, url:string, linkMode:string}>}
 */
async function shareDocument(notebook, options = {}) {
  const me = requireIdentity();
  const docId = options.docId || makeShareId();
  const isNew = !options.docId;
  const linkMode = normalizeLinkMode(options.linkMode);

  const parts = splitNotebook(notebook);

  let existing = null;
  if (!isNew) {
    const snap = await step('Dokument prüfen', () => getDoc(doc(db, DOCS, docId)));
    if (snap.exists()) {
      existing = describeDoc(docId, snap.data() || {});
      if (existing.owner !== me.uid) throw new Error('SHARE_NOT_OWNED');
    }
  }

  // Der Link behält seine Kennung, solange er nicht ausdrücklich erneuert
  // wird – sonst würde jedes Speichern alle verschickten Adressen entwerten.
  let linkId = existing?.linkId || '';
  if (linkMode !== 'off' && !linkId) linkId = makeShareId();

  const head = {
    ...parts.head,
    owner: me.uid,
    ownerEmail: me.email,
    ownerName: options.ownerName || me.name || me.email,
    format: DOC_FORMAT,
    revision: (existing?.revision || 0) + 1,
    linkMode,
    linkId,
    updatedAt: serverTimestamp()
  };

  if (isNew || !existing) {
    head.memberEmails = [];
    head.members = {};
    head.memberVia = {};
    head.blockedEmails = [];
    head.createdAt = serverTimestamp();
  }

  await step('Kopf schreiben', () => setDoc(doc(db, DOCS, docId), head, { merge: !isNew }));

  // Beim Ersetzen zuerst alles Alte weg – auch die Stücke einer Freigabe
  // aus der Zeit vor dem zerlegten Modell.
  if (!isNew) await step('Alten Inhalt entfernen', () => clearDocContent(docId));

  await step('Inhalt schreiben', () => writeDocParts(docId, parts, me.uid));

  if (linkId) await step('Link eintragen', () => writeLinkEntry(linkId, docId, me.uid));

  return { docId, linkId, url: linkId ? docUrlFor(linkId) : '', linkMode };
}

/** Schreibt Seiten, Handschrift und Bilder stapelweise. */
async function writeDocParts(docId, parts, byUid) {
  let batch = writeBatch(db);
  let count = 0;
  const flush = async () => {
    if (!count) return;
    const b = batch; batch = writeBatch(db); count = 0;
    await b.commit();
  };

  for (const page of parts.pages) {
    batch.set(doc(db, DOCS, docId, PAGES, page.id), { ...page, by: byUid, updatedAt: serverTimestamp() });
    if (++count >= MAX_BATCH) await flush();
  }
  for (const sheet of parts.ink) {
    batch.set(doc(db, DOCS, docId, INK, sheet.id), { ...sheet, by: byUid });
    if (++count >= MAX_BATCH) await flush();
  }
  for (const blob of parts.blobs) {
    batch.set(doc(db, DOCS, docId, BLOBS, blob.key), blob);
    if (++count >= MAX_BATCH) await flush();
  }
  await flush();
}

/** Räumt Seiten, Handschrift, Bilder und alte Stücke weg. */
async function clearDocContent(docId) {
  for (const sub of [PAGES, INK, BLOBS, CHUNKS]) {
    const existing = await getDocs(collection(db, DOCS, docId, sub));
    let batch = writeBatch(db);
    let count = 0;
    for (const snap of existing.docs) {
      batch.delete(snap.ref);
      if (++count >= MAX_BATCH) { await batch.commit(); batch = writeBatch(db); count = 0; }
    }
    if (count > 0) await batch.commit();
  }
}

/**
 * Merkzettel über den Stand eines Hefts. Damit lässt sich beim nächsten
 * Speichern feststellen, WAS sich geändert hat – ohne das ganze Heft mit
 * der Fassung im Raum vergleichen zu müssen.
 *
 * Bewusst klein: je Seite eine kurze Unterschrift über Text und Objekte
 * plus die Zahl der Striche. Bilddaten fließen nicht ein, die ändern sich
 * ohnehin nur zusammen mit den Objekten.
 */
function fingerprintNotebook(notebook) {
  const pages = {};
  for (const page of (notebook.pages || [])) {
    pages[String(page.id)] = {
      sig: signatureOf(page),
      strokes: (page.inkStrokes || []).length
    };
  }
  return {
    pages,
    order: (notebook.pages || []).map(p => String(p.id)),
    headSig: JSON.stringify({
      name: notebook.name, color: notebook.color, defaultBg: notebook.defaultBg,
      sections: notebook.sections || []
    })
  };
}

/** Kurze, stabile Unterschrift über den änderbaren Teil einer Seite. */
function signatureOf(page) {
  const objects = (page.objects || []).map(o => ({ ...o, src: isInlineData(o.src) ? o.src.length : o.src }));
  const text = page.textContent || '';
  const raw = JSON.stringify([text, objects, page.bg ?? null, (page.bgImg || '').length]);

  // Einfacher Hash (FNV-1a). Es geht nur um „gleich oder nicht", nicht um
  // Fälschungssicherheit – die Unterschrift verlässt das Gerät nie.
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36) + ':' + raw.length;
}

/**
 * Schreibt Änderungen an einem geteilten Dokument zurück.
 *
 * >>> Was sich mit dem zerlegten Modell geändert hat <<<
 * Vorher ging bei jedem Speichern das GANZE Heft hoch, und wer auf einem
 * älteren Stand saß, wurde abgewiesen (DOC_OUTDATED) – sonst hätte er die
 * Arbeit des anderen gelöscht. Jetzt wird nur geschrieben, was sich
 * geändert hat: eine Seite, ein Bogen Handschrift. Zwei Leute auf
 * verschiedenen Seiten stören sich dadurch nicht mehr.
 *
 * Was noch offen bleibt: auf DERSELBEN Seite gewinnt beim Text weiterhin
 * der Letzte. Handschrift dagegen ist schon jetzt konfliktfrei, weil neue
 * Striche nur angehängt werden. Zeichengenaues gemeinsames Tippen braucht
 * das CRDT (COLLAB_SPEC.md, Abschnitt 5.2, Stufe 10).
 *
 * @param {string} docId
 * @param {object} notebook
 * @param {object} [options]
 * @param {object} [options.baseline] Merkzettel vom letzten Stand
 * @returns {Promise<{revision:number, fingerprint:object, written:number}>}
 */
async function saveDocumentContent(docId, notebook, options = {}) {
  const me = requireIdentity();
  const head = await loadDocumentHead(docId);

  const isOwner = head.owner === me.uid;
  const role = head.roleFor(me.email);
  if (!isOwner && role !== 'edit') throw new Error('NOT_ALLOWED');

  const parts = splitNotebook(notebook);
  const fingerprint = fingerprintNotebook(notebook);

  /* Eine Freigabe aus der Zeit vor dem zerlegten Modell: einmal komplett
     umschreiben. Danach läuft sie wie alle anderen. Das darf nur der
     Besitzer, weil dabei der Kopf mit angefasst wird. */
  if (head.format !== DOC_FORMAT) {
    if (!isOwner) throw new Error('NEEDS_OWNER_UPGRADE');
    await step('Alten Inhalt entfernen', () => clearDocContent(docId));
    await step('Inhalt schreiben', () => writeDocParts(docId, parts, me.uid));
    await step('Kopf fortschreiben', () => updateDoc(doc(db, DOCS, docId), {
      ...parts.head,
      format: DOC_FORMAT,
      chunkCount: 0,
      revision: head.revision + 1,
      updatedAt: serverTimestamp()
    }));
    return { revision: head.revision + 1, fingerprint, written: parts.pages.length };
  }

  const base = options.baseline || null;
  let written = 0;

  /* Ohne Merkzettel lässt sich nicht sagen, was sich geändert hat. Dann
     wird alles neu geschrieben – nicht nur die Seiten, sondern auch
     Handschrift und Bilder. Ein Teil-Schreiben wäre hier gefährlich: neue
     Seiten kämen ohne ihre Striche an. */
  if (!base) {
    await step('Alten Inhalt entfernen', () => clearDocContent(docId));
    await step('Inhalt schreiben', () => writeDocParts(docId, parts, me.uid));
    const rev = head.revision + 1;
    await step('Stand fortschreiben', () => updateDoc(doc(db, DOCS, docId), {
      pageOrder: parts.head.pageOrder,
      pageCount: parts.head.pageCount,
      sections: parts.head.sections,
      revision: rev,
      updatedAt: serverTimestamp()
    }));
    return { revision: rev, fingerprint, written: parts.pages.length };
  }

  const changedPages = parts.pages.filter(
    p => !base.pages[p.id] || base.pages[p.id].sig !== fingerprint.pages[p.id].sig
  );

  for (const page of changedPages) {
    const blobs = parts.blobs.filter(b => b.pageId === page.id);
    await step('Seite schreiben', async () => {
      const batch = writeBatch(db);
      // merge, damit der CRDT-Stand (ycrdt) stehen bleibt – der gehört
      // der Live-Bearbeitung und wird hier nicht angefasst.
      batch.set(doc(db, DOCS, docId, PAGES, page.id), {
        ...page, by: me.uid, updatedAt: serverTimestamp()
      }, { merge: true });
      for (const blob of blobs) batch.set(doc(db, DOCS, docId, BLOBS, blob.key), blob);
      await batch.commit();
    });
    written++;
  }

  // Handschrift: dazugekommene Striche anhängen, sonst nichts anfassen.
  for (const page of (notebook.pages || [])) {
    const pageId = String(page.id);
    const strokes = page.inkStrokes || [];
    const before = base.pages[pageId]?.strokes;

    // Seite ist neu: ihre Striche gab es im Raum noch nie. Ohne diesen Fall
    // käme eine frisch angelegte Seite ohne Handschrift beim anderen an.
    if (before === undefined) {
      if (strokes.length) await rewritePageInk(docId, pageId, strokes, me.uid);
      continue;
    }

    if (strokes.length === before) continue;

    if (strokes.length > before) {
      await appendStrokes(docId, pageId, strokes.slice(before), me.uid);
    } else {
      // Radiert: die Bögen dieser Seite neu schreiben. Nur hier wird
      // überschrieben – Radieren IST nun einmal ein Entfernen.
      await rewritePageInk(docId, pageId, strokes, me.uid);
    }
    written++;
  }

  // Gelöschte Seiten wegräumen
  const gone = base.order.filter(id => !fingerprint.order.includes(id));
  for (const pageId of gone) await deletePageContent(docId, pageId);

  /* Der Kopf trägt nur noch Reihenfolge, Abschnitte und den Zeitstempel.
     Er wird auch geschrieben, wenn sich am Inhalt nichts getan hat – daran
     erkennen die anderen Clients, dass es etwas Neues gibt. */
  const revision = head.revision + 1;
  await step('Stand fortschreiben', () => updateDoc(doc(db, DOCS, docId), {
    pageOrder: parts.head.pageOrder,
    pageCount: parts.head.pageCount,
    sections: parts.head.sections,
    revision,
    updatedAt: serverTimestamp()
  }));

  return { revision, fingerprint, written };
}

/**
 * Sichert Text und CRDT-Stand einer einzelnen Seite.
 *
 * Warum beides nebeneinander:
 * · `text` ist der fertige HTML-Stand. Damit arbeiten Betrachter, Export,
 *   Suche und die Website – die brauchen kein Yjs und sollen es auch
 *   nicht laden müssen.
 * · `ycrdt` ist der Yjs-Zustand. Der ist beim Bearbeiten maßgeblich, denn
 *   nur er kann zwei gleichzeitige Änderungen zusammenführen.
 *
 * Beim Laden gilt: gibt es `ycrdt`, wird daraus gearbeitet. Sonst wird
 * der Text einmal hineingegossen (siehe seedText in ui/collab.js).
 */
async function savePageText(docId, pageId, { text, ycrdt }) {
  requireIdentity();
  const patch = { text: String(text || ''), updatedAt: serverTimestamp() };
  if (ycrdt) patch.ycrdt = ycrdt;
  await step('Seitentext sichern', () => setDoc(doc(db, DOCS, docId, PAGES, pageId), patch, { merge: true }));
}

/**
 * Hängt Striche an. Zwei Leute, die gleichzeitig auf derselben Seite
 * zeichnen, stören sich dabei NICHT: Firestore führt zwei arrayUnion auf
 * demselben Feld zusammen, es kommen also beide Striche an. Genau das ist
 * beim Zeichnen auch das richtige Ergebnis.
 */
async function appendStrokes(docId, pageId, strokes, byUid) {
  if (!strokes.length) return;

  const sheets = await getDocs(
    query(collection(db, DOCS, docId, INK), where('pageId', '==', pageId))
  );
  const rows = sheets.docs
    .map(d => ({ id: d.id, ...(d.data() || {}) }))
    .sort((a, b) => (a.no || 0) - (b.no || 0));

  let last = rows[rows.length - 1] || null;
  let bytes = last ? JSON.stringify(last.strokes || []).length : 0;
  let nextNo = last ? (last.no || 0) + 1 : 0;

  for (const stroke of strokes) {
    const size = JSON.stringify(stroke).length;

    if (!last || bytes + size > INK_SHEET_LIMIT) {
      const id = `${pageId}__${nextNo}`;
      await step('Handschrift anlegen', () => setDoc(doc(db, DOCS, docId, INK, id), {
        pageId, no: nextNo, strokes: [stroke], by: byUid
      }));
      last = { id, no: nextNo, strokes: [stroke] };
      bytes = size;
      nextNo++;
      continue;
    }

    await step('Handschrift anhängen', () => updateDoc(doc(db, DOCS, docId, INK, last.id), {
      strokes: arrayUnion(stroke)
    }));
    bytes += size;
  }
}

/** Alle Bögen einer Seite neu schreiben – nach dem Radieren. */
async function rewritePageInk(docId, pageId, strokes, byUid) {
  const sheets = await getDocs(
    query(collection(db, DOCS, docId, INK), where('pageId', '==', pageId))
  );

  let batch = writeBatch(db);
  let count = 0;
  for (const snap of sheets.docs) {
    batch.delete(snap.ref);
    if (++count >= MAX_BATCH) { await batch.commit(); batch = writeBatch(db); count = 0; }
  }

  let sheet = [];
  let bytes = 0;
  let no = 0;
  const put = () => {
    if (!sheet.length) return;
    batch.set(doc(db, DOCS, docId, INK, `${pageId}__${no}`), {
      pageId, no, strokes: sheet, by: byUid
    });
    count++;
    no++;
    sheet = [];
    bytes = 0;
  };

  for (const stroke of strokes) {
    const size = JSON.stringify(stroke).length;
    if (bytes + size > INK_SHEET_LIMIT && sheet.length) put();
    sheet.push(stroke);
    bytes += size;
  }
  put();

  await step('Handschrift neu schreiben', () => batch.commit());
}

/** Seite samt Handschrift und Bildern entfernen. */
async function deletePageContent(docId, pageId) {
  const batch = writeBatch(db);
  batch.delete(doc(db, DOCS, docId, PAGES, pageId));

  for (const sub of [INK, BLOBS]) {
    const rows = await getDocs(
      query(collection(db, DOCS, docId, sub), where('pageId', '==', pageId))
    );
    for (const snap of rows.docs) batch.delete(snap.ref);
  }

  await step('Seite entfernen', () => batch.commit());
}

/** Nachschlage-Eintrag Link -> Dokument. Öffentlich lesbar, das ist der Zweck. */
async function writeLinkEntry(linkId, docId, ownerUid) {
  await setDoc(doc(db, DOC_LINKS, linkId), {
    docId,
    owner: ownerUid,
    createdAt: serverTimestamp()
  });
}

/** Den Kopf eines Dokuments holen – ohne den Inhalt. */
async function loadDocumentHead(docId) {
  const snap = await getDoc(doc(db, DOCS, docId));
  if (!snap.exists()) throw new Error('SHARE_NOT_FOUND');
  return describeDoc(docId, snap.data() || {});
}

/** Nur der Besitzer darf hier schreiben – so steht es in den Regeln. */
async function updateDocHead(docId, patch) {
  requireIdentity();
  await updateDoc(doc(db, DOCS, docId), { ...patch, updatedAt: serverTimestamp() });
}

/**
 * Was darf, wer den Link hat? 'off' nimmt den Link ganz aus dem Verkehr.
 *
 * >>> Warum dabei auch die MITGLIEDER angefasst werden <<<
 * Wer über den Link hereinkommt, wird von joinViaLink zum Mitglied
 * gemacht – mit `memberVia: 'link'` und der Rolle, die der Link in dem
 * Augenblick hergab. Danach hängt sein Zugriff nur noch an diesem
 * Eintrag, nicht mehr am Link.
 *
 * Der Schalter änderte bisher aber nur `linkMode`. Wer schon drin war,
 * behielt deshalb alles:
 *
 *   · Link auf „aus": es flog niemand hinaus, nur neue Besucher kamen
 *     nicht mehr herein.
 *   · Link von „lesen" auf „bearbeiten" (oder zurück): die Rolle der
 *     bereits Eingetretenen blieb stehen.
 *
 * Es sah deshalb so aus, als wirke der Link-Schalter nur bei den per
 * E-Mail Eingeladenen – bei denen wird `members` ja unmittelbar
 * geschrieben. Jetzt zieht der Schalter alle über den Link Eingetretenen
 * mit. Wer ausdrücklich per E-Mail eingeladen wurde (`memberVia` ist
 * nicht 'link'), bleibt unberührt – seine Einladung hat mit dem Link
 * nichts zu tun.
 */
async function setLinkMode(docId, mode) {
  const me = requireIdentity();
  const wanted = normalizeLinkMode(mode);
  const head = await loadDocumentHead(docId);
  if (head.owner !== me.uid) throw new Error('SHARE_NOT_OWNED');

  // Alle, die über den Link hereingekommen sind
  const ueberLink = head.memberEmails.filter(e => head.memberVia[e] === 'link');

  const members = { ...head.members };
  const memberVia = { ...head.memberVia };
  let memberEmails = head.memberEmails.slice();

  if (wanted === 'off') {
    for (const e of ueberLink) {
      delete members[e];
      delete memberVia[e];
    }
    memberEmails = memberEmails.filter(e => !ueberLink.includes(e));

    if (head.linkId) await deleteDoc(doc(db, DOC_LINKS, head.linkId)).catch(() => {});
    await updateDocHead(docId, {
      linkMode: 'off', linkId: '', memberEmails, members, memberVia
    });
    return { linkMode: 'off', linkId: '', url: '' };
  }

  for (const e of ueberLink) members[e] = wanted;

  const linkId = head.linkId || makeShareId();
  await updateDocHead(docId, { linkMode: wanted, linkId, members });
  await writeLinkEntry(linkId, docId, me.uid);
  return { linkMode: wanted, linkId, url: docUrlFor(linkId) };
}

/**
 * Erzeugt eine neue Link-Kennung. Alle verschickten Adressen laufen danach
 * ins Leere. Wer schon eingetragen ist, bleibt drin – das ist gewollt:
 * "Erneuern" richtet sich gegen weitergereichte Links, nicht gegen die
 * Leute, denen man den Zugang bewusst gegeben hat.
 */
async function rotateLink(docId) {
  const me = requireIdentity();
  const head = await loadDocumentHead(docId);
  if (head.owner !== me.uid) throw new Error('SHARE_NOT_OWNED');
  if (head.linkMode === 'off') throw new Error('LINK_DISABLED');

  const linkId = makeShareId();
  await writeLinkEntry(linkId, docId, me.uid);
  await updateDocHead(docId, { linkId });
  if (head.linkId) await deleteDoc(doc(db, DOC_LINKS, head.linkId)).catch(() => {});

  return { linkId, url: docUrlFor(linkId) };
}

/** Adresse einladen oder ihre Rolle ändern. */
async function setMember(docId, email, role) {
  const me = requireIdentity();
  const key = normalizeEmail(email);
  if (!looksLikeEmail(key)) throw new Error('BAD_EMAIL');
  if (key === me.email) throw new Error('OWN_EMAIL');

  const head = await loadDocumentHead(docId);
  if (head.owner !== me.uid) throw new Error('SHARE_NOT_OWNED');

  const memberEmails = head.memberEmails.includes(key)
    ? head.memberEmails.slice()
    : head.memberEmails.concat(key);

  await updateDocHead(docId, {
    memberEmails,
    members: { ...head.members, [key]: normalizeRole(role) },
    memberVia: { ...head.memberVia, [key]: head.memberVia[key] || 'invite' },
    // Wer wieder eingeladen wird, ist nicht mehr gesperrt
    blockedEmails: head.blockedEmails.filter(e => e !== key)
  });
}

/**
 * Zugriff entziehen. Die Adresse kommt auf die Sperrliste, sonst könnte
 * die Person denselben Link einfach noch einmal öffnen und wäre über den
 * Selbsteintrag sofort wieder drin.
 */
async function removeMember(docId, email) {
  const me = requireIdentity();
  const key = normalizeEmail(email);

  const head = await loadDocumentHead(docId);
  if (head.owner !== me.uid) throw new Error('SHARE_NOT_OWNED');

  const members = { ...head.members };
  const memberVia = { ...head.memberVia };
  delete members[key];
  delete memberVia[key];

  await updateDocHead(docId, {
    memberEmails: head.memberEmails.filter(e => e !== key),
    members,
    memberVia,
    blockedEmails: head.blockedEmails.includes(key)
      ? head.blockedEmails
      : head.blockedEmails.concat(key)
  });
}

/**
 * Selbst aussteigen. Für Empfänger heißt „Löschen" genau das: nicht das
 * fremde Heft wegwerfen, sondern die eigene Adresse aus der Liste nehmen.
 * Kommt keine Sperre dazu – wer den Link noch hat, darf wieder herein.
 */
async function leaveDocument(docId) {
  const me = requireIdentity();
  const head = await loadDocumentHead(docId);
  if (head.owner === me.uid) throw new Error('OWNER_CANNOT_LEAVE');
  if (!head.memberEmails.includes(me.email)) return true;

  const members = { ...head.members };
  const memberVia = { ...head.memberVia };
  delete members[me.email];
  delete memberVia[me.email];

  await updateDoc(doc(db, DOCS, docId), {
    memberEmails: head.memberEmails.filter(e => e !== me.email),
    members,
    memberVia
  });
  return true;
}

/** Sperre aufheben, ohne gleich wieder einzuladen. */
async function unblockMember(docId, email) {
  const me = requireIdentity();
  const key = normalizeEmail(email);
  const head = await loadDocumentHead(docId);
  if (head.owner !== me.uid) throw new Error('SHARE_NOT_OWNED');
  await updateDocHead(docId, { blockedEmails: head.blockedEmails.filter(e => e !== key) });
}

/** Beide Wege gemischt: Eingeladene und über den Link Dazugekommene. */
function listMembers(head) {
  return head.memberEmails.map(email => ({
    email,
    role: normalizeRole(head.members[email]),
    via: head.memberVia[email] === 'link' ? 'link' : 'invite'
  })).sort((a, b) => a.email.localeCompare(b.email));
}

/** Dokument ganz zurückziehen: Inhalt, Kopf und Link verschwinden. */
async function unshareDocument(docId) {
  const me = requireIdentity();
  const head = await loadDocumentHead(docId).catch(() => null);
  if (!head) return true;
  if (head.owner !== me.uid) throw new Error('SHARE_NOT_OWNED');

  if (head.linkId) await deleteDoc(doc(db, DOC_LINKS, head.linkId)).catch(() => {});
  await clearDocContent(docId);
  await deleteDoc(doc(db, DOCS, docId));
  return true;
}

/**
 * Alle Dokumente, die MIR gehören.
 *
 * Abgefragt wird nur nach dem Besitzer, nicht zusätzlich nach dem Heft:
 * eine Abfrage über zwei Felder verlangt in Firestore einen von Hand
 * angelegten Index, eine über ein Feld nicht. Aussortiert wird deshalb
 * hier – ein Konto hat eine Handvoll Freigaben, keine Tausende.
 */
async function listOwnedDocs() {
  const me = currentIdentity();
  if (!me || me.anonymous || !me.uid) return [];

  const snapshot = await getDocs(
    query(collection(db, DOCS), where('owner', '==', me.uid))
  );
  return snapshot.docs.map(d => describeDoc(d.id, d.data() || {}));
}

/**
 * Ist dieses Heft schon freigegeben? Fragt Firestore, nicht den Merkzettel
 * im Browser.
 *
 * >>> Warum der Merkzettel nicht reicht <<<
 * Freigegeben wird mal aus der App, mal aus dem Browser, mal aus einem
 * zweiten Browser. Der Merkzettel (localStorage bzw. Einstellungsdatei)
 * kennt aber immer nur die Freigaben, die an genau DIESER Stelle erzeugt
 * wurden. Überall sonst stand das Fenster deshalb auf „noch nicht
 * freigegeben", obwohl das Heft längst geteilt war – und ein zweites
 * „Freigeben" hätte eine zweite Freigabe daneben gelegt.
 *
 * @param {string} notebookId
 * @returns {Promise<object|null>} der Kopf des Dokuments oder null
 */
async function findOwnedDocForNotebook(notebookId) {
  const wanted = String(notebookId || '');
  if (!wanted) return null;

  const mine = await listOwnedDocs();
  const hits = mine.filter(head => head.notebookId === wanted);
  if (!hits.length) return null;

  // Sollten aus einer früheren Fassung zwei Freigaben zum selben Heft
  // herumliegen, gewinnt die zuletzt geänderte.
  hits.sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
  return hits[0];
}

/* ── Empfängerseite ─────────────────────────────────────────────────── */

/**
 * Alle Dokumente, die mit dieser Adresse geteilt sind. Genau eine Abfrage –
 * es gibt bewusst keine zweite Datenhaltung, die veralten könnte.
 */
async function listSharedDocs(email) {
  const key = normalizeEmail(email || currentIdentity()?.email);
  if (!key) return [];

  const snapshot = await getDocs(
    query(collection(db, DOCS), where('memberEmails', 'array-contains', key))
  );
  return snapshot.docs.map(d => describeDoc(d.id, d.data() || {}));
}

/**
 * Wie listSharedDocs, meldet sich aber bei jeder Änderung erneut. Damit
 * verschwindet ein entzogenes Dokument noch während der Sitzung.
 * @returns {Function} zum Abbestellen
 */
function watchSharedDocs(email, callback, onError) {
  const key = normalizeEmail(email || currentIdentity()?.email);
  if (!key) return () => {};

  return onSnapshot(
    query(collection(db, DOCS), where('memberEmails', 'array-contains', key)),
    (snapshot) => callback(snapshot.docs.map(d => describeDoc(d.id, d.data() || {}))),
    (err) => {
      /* Wichtig: eine abgebrochene Beobachtung kommt von selbst NICHT
         wieder. Vorher landete das nur in der Konsole – der Tab blieb
         einfach leer, und das sah aus wie „es hat niemand geteilt".
         Jetzt erfährt die Oberfläche davon und versucht es erneut. */
      console.warn('[Share] Beobachtung der geteilten Dokumente beendet:', err?.message || err);
      if (typeof onError === 'function') onError(err);
    }
  );
}

/** Ein einzelnes Dokument beobachten – für „aus der Sitzung geworfen". */
function watchDocument(docId, callback) {
  return onSnapshot(
    doc(db, DOCS, docId),
    (snap) => callback(snap.exists() ? describeDoc(docId, snap.data() || {}) : null),
    (err) => {
      // Der übliche Grund ist genau der interessante Fall: die Regeln lassen
      // uns nicht mehr an das Dokument, weil die Freigabe entzogen wurde.
      console.warn('[Share] Dokument nicht mehr lesbar:', err?.message || err);
      callback(null);
    }
  );
}

/** Link-Kennung nachschlagen. */
async function resolveLink(linkId) {
  if (!linkId) throw new Error('SHARE_NOT_FOUND');
  const snap = await getDoc(doc(db, DOC_LINKS, linkId));
  if (!snap.exists()) throw new Error('SHARE_NOT_FOUND');
  return { docId: (snap.data() || {}).docId || '' };
}

/**
 * Trägt den angemeldeten Besucher selbst in das Dokument ein. Danach steht
 * es in seinem Tab und der Link wird nicht mehr gebraucht.
 *
 * Gibt still auf, wenn niemand angemeldet ist oder der Link nur zum Lesen
 * gedacht ist und der Besucher schon Mitglied ist – Lesen geht ohnehin.
 *
 * @returns {Promise<'joined'|'already'|'blocked'|'anonymous'|'closed'>}
 */
async function joinViaLink(docId) {
  const me = currentIdentity();
  if (!me || me.anonymous || !me.email) return 'anonymous';

  const head = await loadDocumentHead(docId);
  if (head.linkMode === 'off') return 'closed';
  if (head.ownerEmail === me.email) return 'already';
  if (head.blockedEmails.includes(me.email)) return 'blocked';

  const role = head.linkMode === 'edit' ? 'edit' : 'view';
  if (head.memberEmails.includes(me.email) && normalizeRole(head.members[me.email]) === role) {
    return 'already';
  }

  const memberEmails = head.memberEmails.includes(me.email)
    ? head.memberEmails.slice()
    : head.memberEmails.concat(me.email);

  // Nur die eigene Adresse und nur mit der Rolle, die der Link hergibt –
  // die Regel prüft beides noch einmal.
  await updateDoc(doc(db, DOCS, docId), {
    memberEmails,
    members: { ...head.members, [me.email]: role },
    memberVia: { ...head.memberVia, [me.email]: head.memberVia[me.email] || 'link' }
  });

  return 'joined';
}

/**
 * Trägt die eigene Firebase-Kennung im Kopf des Dokuments ein.
 *
 * >>> Wozu das gut ist <<<
 * Wer dazugehört, steht als E-MAIL-ADRESSE im Kopf. Die Regeln der
 * Realtime Database können damit nichts anfangen – dort gibt es nur
 * auth.uid. Der Besitzer braucht aber genau diese Zuordnung, um die
 * Rollenliste des Raums zu schreiben (joinDocRoom).
 *
 * Eingetragen wird ausschließlich der EIGENE Eintrag; die Regel prüft
 * das noch einmal, genau wie beim Selbsteintrag über den Link.
 *
 * Schlägt es fehl, ist das kein Grund zum Abbrechen: dann gibt es für
 * diese Person eben vorerst keine Live-Übertragung, gespeichert wird
 * weiterhin über Firestore.
 */
async function registerMyUid(docId, head) {
  const me = currentIdentity();
  if (!me || me.anonymous || !me.email || !me.uid) return false;
  if (head && head.memberUids && head.memberUids[me.uid] === me.email) return true;

  try {
    await updateDoc(doc(db, DOCS, docId), {
      [`memberUids.${me.uid}`]: me.email
    });
    return true;
  } catch (err) {
    console.warn('[Share] Eigene Kennung nicht eingetragen:', err?.message || err);
    return false;
  }
}

/**
 * Die Rollen des Raums, aus dem Kopf abgeleitet: { uid: 'view'|'edit' }.
 *
 * Nur der Besitzer braucht das – er schreibt daraus roles/{docId} in die
 * Realtime Database. Wessen Kennung noch nicht eingetragen ist, fehlt
 * hier und bekommt vorerst keinen Live-Betrieb; sobald er das Dokument
 * einmal geöffnet hat, ist er beim nächsten Betreten des Besitzers dabei.
 */
function roomRolesFrom(head) {
  const out = {};
  for (const [uid, email] of Object.entries(head.memberUids || {})) {
    const key = normalizeEmail(email);
    if (!key || !head.memberEmails.includes(key)) continue;   // entfernt
    out[uid] = normalizeRole(head.members[key]);
  }
  return out;
}

/**
 * Holt Kopf und Inhalt eines Dokuments.
 * @returns {Promise<{notebook:object, head:object}>}
 */
async function loadDocument(docId) {
  const head = await loadDocumentHead(docId);

  // Freigabe aus der Zeit vor dem zerlegten Modell
  if (head.format !== DOC_FORMAT) {
    const notebook = await loadLegacyDocument(docId, head);
    return { notebook, head, fingerprint: fingerprintNotebook(notebook) };
  }

  // Drei Abfragen statt einer je Seite – und zwar gleichzeitig.
  const [pageSnap, inkSnap, blobSnap] = await Promise.all([
    getDocs(collection(db, DOCS, docId, PAGES)),
    getDocs(collection(db, DOCS, docId, INK)),
    getDocs(collection(db, DOCS, docId, BLOBS))
  ]);

  if (pageSnap.empty) throw new Error('SHARE_EMPTY');

  const pageRows = pageSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));

  const notebook = assembleNotebook(
    head,
    pageRows,
    inkSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) })),
    blobSnap.docs.map(d => (d.data() || {}))
  );

  // Der CRDT-Stand je Seite wandert getrennt mit: nur die Live-Bearbeitung
  // braucht ihn, Betrachter und Export nicht.
  const crdt = {};
  for (const row of pageRows) if (row.ycrdt) crdt[row.id] = row.ycrdt;

  return { notebook, head, crdt, fingerprint: fingerprintNotebook(notebook) };
}

/**
 * Holt EINE Seite mit allem, was dazugehört.
 *
 * Gebraucht für den Live-Betrieb: Bilder und Seiten mit sehr viel
 * Handschrift passen nicht durch den Änderungsstrom der Realtime Database
 * (dort gilt eine Längengrenze je Meldung). Statt sie zu stückeln,
 * schickt der Absender nur den Hinweis „hol dir diese Seite neu" und
 * sichert sie vorher nach Firestore – von dort kommt sie hierüber.
 *
 * @returns {Promise<object|null>} die Seite in Heft-Form, oder null
 */
async function loadPage(docId, pageId) {
  const [pageSnap, inkSnap, blobSnap] = await Promise.all([
    getDoc(doc(db, DOCS, docId, PAGES, pageId)),
    getDocs(query(collection(db, DOCS, docId, INK), where('pageId', '==', pageId))),
    getDocs(query(collection(db, DOCS, docId, BLOBS), where('pageId', '==', pageId)))
  ]);
  if (!pageSnap.exists()) return null;

  const row = { id: pageSnap.id, ...(pageSnap.data() || {}) };

  /* Über assembleNotebook gehen und nicht von Hand zusammensetzen: dann
     gelten für eine einzelne Seite genau dieselben Regeln wie für ein
     ganzes Heft – Bilder aus blob:-Verweisen, Handschrift in der
     Reihenfolge der Bögen. Zwei Wege wären zwei Gelegenheiten für
     Unterschiede. */
  const notebook = assembleNotebook(
    { pageOrder: [pageId], sections: [] },
    [row],
    inkSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) })),
    blobSnap.docs.map(d => (d.data() || {}))
  );

  const page = notebook.pages[0] || null;
  if (page && row.ycrdt) page.ycrdt = row.ycrdt;
  return page;
}

/** Der alte Weg: ein JSON-Klumpen in Stücken. */
async function loadLegacyDocument(docId, head) {
  const expected = head.chunkCount;

  let snapshot = await getDocs(
    query(collection(db, DOCS, docId, CHUNKS), orderBy('i', 'asc'))
  );

  // Wie bei den Lesekopien: der Kopf steht vor den Stücken in der Datenbank.
  // Wird genau dazwischen gelesen, fehlt noch etwas – dann einmal warten.
  if (snapshot.empty || (expected && snapshot.docs.length < expected)) {
    await new Promise(r => setTimeout(r, 1200));
    snapshot = await getDocs(
      query(collection(db, DOCS, docId, CHUNKS), orderBy('i', 'asc'))
    );
  }
  if (snapshot.empty) throw new Error('SHARE_EMPTY');
  if (expected && snapshot.docs.length < expected) throw new Error('SHARE_INCOMPLETE');

  const text = snapshot.docs.map(d => (d.data() || {}).data || '').join('');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('SHARE_BROKEN');
  }
}

/* ══════════════════════════════════════════════════════════════════════
   LIVE-BEARBEITUNG  ―  Anwesenheit und Änderungsstrom

   Läuft NICHT über Firestore, sondern über die Realtime Database. Zwei
   Gründe, und der erste ist der wichtigere:

   1. Die RTDB kennt onDisconnect(). Schließt jemand die App oder fällt
      das Netz aus, verschwindet sein Marker von selbst. Firestore kann
      das nicht – dort bräuchte es Herzschläge und jemanden, der die
      Leichen wegräumt.

   2. Die Kosten. Firestore erlaubt im kostenlosen Plan 20.000
      Schreibvorgänge am Tag. Ein Marker, der der Schreibmarke folgt,
      schreibt etwa einmal pro Sekunde – eine Person, die drei Stunden an
      einem Heft sitzt, wäre allein damit bei über 10.000. In der RTDB
      zählt die übertragene Menge, und die ist hier winzig.

   Der Änderungsstrom trägt zweierlei:
     { k: 'y',   p: pageId, u: <Yjs-Änderung, base64> }   Text
     { k: 'ink', p: pageId, s: <Strich> }                 Handschrift

   Beides ist flüchtig. Die dauerhafte Fassung steht weiterhin in
   Firestore und wird im gewohnten Takt geschrieben.
   ══════════════════════════════════════════════════════════════════════ */

/* Adresse der Realtime Database. Steht in der Firebase Console unter
   Realtime Database ganz oben. Muss zur gewählten Region passen –
   europe-west1 sieht so aus, us-central1 endet auf firebaseio.com. */
const RTDB_URL = 'https://inkwell-53ab9-default-rtdb.europe-west1.firebasedatabase.app';

/* So oft höchstens eine Meldung, wenn sich nur die SEITE ändert. Das
   passiert beim Blättern und darf gemächlich sein. */
const PRESENCE_THROTTLE_MS = 1000;

/* Für die Stelle im Text gilt ein deutlich kürzerer Takt. Mit einer
   Sekunde hinkte die fremde Schreibmarke dem Text hinterher: der Text
   ging alle 300 ms über den Änderungsstrom hinaus, die Position nur jede
   Sekunde über die Anwesenheit – beim Tippen stand die Marke dadurch
   dauerhaft mehrere Wörter zu weit links. Dieselbe Meldung trägt auch
   die Zeilensperre, und die muss erst recht zügig ankommen. */
const CARET_THROTTLE_MS = 150;

/* Eine Sperre, die sich nicht bewegt, muss trotzdem hin und wieder neu
   gemeldet werden – sonst läuft ihr Nachlauf ab, während die Person noch
   an derselben Zeile sitzt. Deutlich kürzer als LOCK_TTL_MS in
   ui/collab.js, damit sich beides überlappt. */
const LOCK_REFRESH_MS = 2000;

/* So oft schreibt sich der Anwesenheitseintrag neu, auch wenn sich nichts
   geändert hat – siehe setPage. Deutlich unter PRESENCE_STALE_MS
   (90 s in ui/collab.js), damit ein Eintrag nie als alt gilt, solange
   jemand wirklich da ist. */
const PRESENCE_HEARTBEAT_MS = 5000;  // war 12000 – schneller erholen nach Besitzer-Wiedereinstieg

/* Angaben, die an einer Änderung MITREISEN dürfen, aber nicht müssen:
   Stelle der Schreibmarke (c) und die beanspruchten Zeilen (lf, lt).
   Kennt die veröffentlichte Regel sie nicht, geht die Änderung ohne sie
   noch einmal hinaus – siehe sendOp. */
const OP_EXTRAS = ['c', 'lf', 'lt', 'cx'];

/* Dasselbe für die Anwesenheit. Hier wiegt es schwerer: eine abgewiesene
   Karte lässt joinDocRoom scheitern, und damit gäbe es überhaupt keine
   Live-Sitzung mehr. */
const PRESENCE_EXTRAS = ['lockFrom', 'lockTo', 'lockAt', 'cx'];

// So viele zurückliegende Änderungen werden beim Betreten nachgeholt.
const OP_BACKLOG = 200;

// Änderungen, die älter sind, räumt der Client beim Betreten weg.
const OP_MAX_AGE_MS = 10 * 60 * 1000;

let _rtdbPromise = null;

/**
 * Lädt das Realtime-Database-Teil von Firebase – erst dann, wenn es
 * wirklich gebraucht wird. Die Leseansicht und das Dashboard kommen ohne
 * aus und sollen es nicht mit herunterladen müssen.
 */
function loadRealtime() {
  if (_rtdbPromise) return _rtdbPromise;

  _rtdbPromise = import('https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js')
    .then((mod) => ({ mod, db: mod.getDatabase(app, RTDB_URL) }))
    .catch((err) => {
      _rtdbPromise = null;
      throw new Error('RTDB_UNAVAILABLE: ' + (err?.message || err));
    });

  return _rtdbPromise;
}

/** Initialen aus Anzeigename oder E-Mail – für den Marker. */
function initialsOf(name, email) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1 && words[0].length >= 2) return words[0].slice(0, 2).toUpperCase();
  return String(email || '?').slice(0, 2).toUpperCase();
}

/**
 * Farbe aus der Kennung ableiten, damit sie über Sitzungen hinweg
 * dieselbe bleibt. Zufall wäre hier verwirrend: derselbe Mensch hätte
 * morgen eine andere Farbe.
 */
function colorForUid(uid) {
  const palette = ['#c04040', '#c87a2a', '#2e8a46', '#2a5fa8', '#7a3aaa', '#8a5030', '#2a8a88', '#606060'];
  let hash = 0;
  for (let i = 0; i < String(uid).length; i++) hash = (hash * 31 + String(uid).charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/**
 * Betritt den Raum eines Dokuments: meldet die eigene Anwesenheit an und
 * öffnet den Änderungsstrom.
 *
 * @param {string} docId
 * @param {object} [options]
 * @param {boolean} [options.isOwner]  ist DIESE Person der Besitzer?
 * @param {string}  [options.ownerUid] Kennung des Besitzers, für onOwnerAway
 * @returns {Promise<object>} Raum mit setPage/onPresence/onOwnerAway/sendOp/onOp/leave
 */
/** Ein Versprechen, das nach der Frist auf jeden Fall zurueckkommt. */
function mitZeitgrenze(versprechen, ms) {
  return Promise.race([
    Promise.resolve(versprechen).catch(() => {}),
    new Promise((fertig) => setTimeout(fertig, ms))
  ]);
}

/**
 * Wartet, bis die Realtime Database wirklich erreichbar ist.
 *
 * .info/connected ist die einzige verlässliche Auskunft darüber – ein
 * Schreibvorgang meldet auch dann Erfolg, wenn er nur zwischengelagert
 * wurde.
 *
 * @throws {Error} RTDB_UNREACHABLE, wenn binnen der Frist nichts steht
 */
function warteAufLeitung(mod, rtdb, timeoutMs = 12000) {
  const { ref, onValue } = mod;
  return new Promise((fertig, fehler) => {
    let stop = null;
    let erledigt = false;
    const schluss = (fn, arg) => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      if (typeof stop === 'function') stop();
      fn(arg);
    };
    // Kein Fehler, nur eine Auskunft: false heisst "noch nicht", nicht
    // "geht nicht". Siehe die Begruendung an der Aufrufstelle.
    const uhr = setTimeout(() => schluss(fertig, false), timeoutMs);

    stop = onValue(ref(rtdb, '.info/connected'),
      (snap) => { if (snap.val() === true) schluss(fertig, true); },
      () => schluss(fertig, false));

    // Kam die Antwort synchron, ist stop erst jetzt gesetzt
    if (erledigt && typeof stop === 'function') stop();
  });
}

/**
 * Wartet, bis der Besitzer diese Kennung in die Rollenliste des Raums
 * aufgenommen hat.
 *
 * @throws {Error} ROOM_NOT_ADMITTED, wenn binnen der Frist nichts kommt
 */
function warteAufEinlass(mod, rtdb, docId, uid, timeoutMs = 25000) {
  const { ref, onValue } = mod;
  return new Promise((fertig, fehler) => {
    let stop = null;
    let erledigt = false;
    const schluss = (fn, arg) => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      if (typeof stop === 'function') stop();
      fn(arg);
    };
    const uhr = setTimeout(() => schluss(fehler, new Error(
      'ROOM_NOT_ADMITTED: Der Besitzer hat diese Kennung noch nicht '
      + 'aufgenommen.')), timeoutMs);

    stop = onValue(ref(rtdb, `roles/${docId}/r/${uid}`),
      (snap) => { if (snap.val() === true) schluss(fertig); },
      (err) => schluss(fehler, err));

    if (erledigt && typeof stop === 'function') stop();
  });
}

async function joinDocRoom(docId, options = {}) {
  const me = requireIdentity();
  const { mod, db: rtdb } = await loadRealtime();
  const { ref, child, push, set, remove, onValue, onChildAdded, onDisconnect,
          query: rtQuery, limitToLast, serverTimestamp: rtNow, get: rtGet } = mod;

  const meRef = ref(rtdb, `presence/${docId}/${me.uid}`);
  const opsRef = ref(rtdb, `ops/${docId}`);
  const rolesRef = ref(rtdb, `roles/${docId}`);

  /* ── Steht die Leitung? ───────────────────────────────────────────
     Die Realtime Database nimmt Schreibvorgaenge auch ohne Verbindung
     entgegen und stellt sie zurueck. Beim Arbeiten ist das richtig; beim
     BETRETEN ist es eine Falle, denn set() kaeme nie zurueck und
     joinDocRoom haenge fuer immer.

     >>> Warum das hier NICHT abbricht <<<
     Zuerst stand hier ein Abbruch mit RTDB_UNREACHABLE. Das war zu
     streng: auf einer traegen Leitung - Long-Polling statt WebSocket,
     wie es hinter manchen Netzen noetig ist - dauert der Aufbau laenger
     als jede Frist, die man ansetzen mag. Aus "langsam" wurde damit
     "kaputt", und der Streifen meldete eine Blockade, wo nur Geduld
     gefehlt hat.

     Also: nachsehen, aber weitermachen. Steht die Leitung nicht, wird
     unten nirgends darauf gewartet, und der Streifen sagt es - solange,
     bis sie steht. Das Nachreichen erledigt die Datenbank selbst. */
  const verbunden = await warteAufLeitung(mod, rtdb);
  if (!verbunden) console.warn('[Share] Live-Datenbank noch nicht erreichbar – wird nachgereicht');


  /* ── Wer darf hier lesen und schreiben? ────────────────────────────
     Die Mitgliedschaft steht in Firestore, und die Realtime Database
     kann dort nicht nachschlagen (Begründung in
     website/database.rules.json). Der Besitzer legt sie deshalb hier ab.

     Geschrieben wird sie beim Betreten des Besitzers – und genau dann
     ist sie auch nötig: ohne ihn dürfen die Eingeladenen ohnehin nur
     lesen (onOwnerAway weiter unten). Es gibt also keinen Zustand, in
     dem jemand schreiben dürfte, aber noch nicht eingetragen ist. */
  if (options.isOwner) {
    const r = { [me.uid]: true };
    const w = { [me.uid]: true };
    for (const [uid, rolle] of Object.entries(options.memberUids || {})) {
      if (!uid) continue;
      r[uid] = true;
      if (rolle === 'edit') w[uid] = true;
    }
    /* Ohne Zeitgrenze: steht die Leitung nicht, kommt set() nie zurueck
       und das Oeffnen des Hefts bliebe haengen. Der Schreibvorgang ist
       damit nicht verloren - die Datenbank reicht ihn nach, sobald sie
       wieder kann. */
    await mitZeitgrenze(set(rolesRef, { owner: me.uid, r, w }), 8000);
  } else {
    /* >>> Gehört dieser Raum wirklich dem, dem das Dokument gehört? <<<
       roles/{docId} darf anlegen, wer sich selbst als owner einträgt.
       Ein Fremder könnte einen Raum also besetzen, bevor der echte
       Besitzer ihn zum ersten Mal betritt – und sich damit Lese- und
       Schreibrecht an einer fremden Sitzung geben. Die Regeln können das
       nicht entscheiden, sie kennen den Firestore-Kopf nicht. Hier ist
       die Stelle, an der beides zusammenkommt. */
    const wanted = options.ownerUid || '';
    if (wanted) {
      const snap = await rtGet(rolesRef);
      const eingetragen = snap.exists() ? (snap.val() || {}).owner : null;
      if (eingetragen && eingetragen !== wanted) {
        throw new Error('ROOM_OWNER_MISMATCH: Der Raum gehört einer anderen '
          + 'Kennung als das Dokument – Live-Betrieb bleibt aus.');
      }
    }

    /* ── Warten, bis der Besitzer uns eingetragen hat ────────────────
       Die Regel für presence verlangt roles/{docId}/r/{uid} === true,
       und schreiben darf das nur der Besitzer. Bis dahin wird jeder
       Versuch abgewiesen.

       >>> Der Wettlauf, der hier verloren ging <<<
       Beim Öffnen trägt der Eingeladene seine Kennung in den Kopf ein
       (registerMyUid). Damit sie in der Rollenliste des Raums landet,
       muss der Besitzer die Änderung erst bemerken und die Liste neu
       schreiben – über Firestore zu ihm, dann in die Datenbank. Das
       dauert einen Moment.

       Vorher wurde sofort danach die Anwesenheit geschrieben: abgewiesen,
       und dann aufgegeben. Es half nur, das Dokument zuzumachen und neu
       zu öffnen – dann war die Kennung vom letzten Mal schon da. Genau
       so hat es sich gemeldet.

       Jetzt wird gewartet, statt zu raten. Kommt nichts, ist das keine
       Störung: ohne anwesenden Besitzer dürfen die Eingeladenen ohnehin
       nur lesen. Der Streifen sagt es dann. */
    try {
      await warteAufEinlass(mod, rtdb, docId, me.uid);
    } catch (err) {
      /* Ohne Leitung ist "der Besitzer hat dich nicht aufgenommen" die
         falsche Auskunft - wir haben schlicht nie nachsehen koennen. */
      if (!verbunden) {
        throw new Error('RTDB_UNREACHABLE: Keine Verbindung zur Live-Datenbank.');
      }
      throw err;
    }
  }

  const card = {
    uid: me.uid,
    initials: initialsOf(me.name, me.email),
    name: me.name || me.email,
    email: me.email,
    color: colorForUid(me.uid),
    pageId: '',
    /* Stelle der Schreibmarke im flachen Text (canvas/text.js). -1 heißt:
       gerade nicht im Text (zeichnet, blättert, Fenster nicht im
       Vordergrund). */
    offset: -1,
    /* Die Zeile, an der gerade geschrieben wird, und die darauf folgende.
       Solange lockAt frisch ist, fassen die anderen diesen Bereich nicht
       an (ui/collab.js). -1 heißt: nichts gesperrt. */
    lockFrom: -1,
    lockTo: -1,
    lockAt: 0,
    /* Ein kurzes Stück Text um die Marke herum. Damit findet die
       Gegenseite die Stelle auch dann wieder, wenn sich der Text seither
       verschoben hat – etwa weil dort jemand gleichzeitig tippt. */
    cx: '',
    at: rtNow()
  };

  /* Ob die Zeilensperre überhaupt gemeldet werden darf. Weist die Regel
     die Felder ab (ältere Fassung veröffentlicht), wird ohne sie
     weitergearbeitet – ohne Sperre, aber mit allem Übrigen. Vorher wäre
     hier die gesamte Live-Sitzung gescheitert. */
  let lockFieldsOk = true;
  try {
    await set(meRef, card);
  } catch (err) {
    lockFieldsOk = false;
    for (const key of PRESENCE_EXTRAS) delete card[key];
    await set(meRef, card);
    console.warn('[Share] Die veröffentlichten Regeln kennen die Felder '
      + PRESENCE_EXTRAS.join(', ') + ' noch nicht – die Zeilensperre bleibt aus. '
      + 'Abhilfe: website/database.rules.json in der Firebase Console unter '
      + 'Realtime Database → Regeln veröffentlichen.');
  }

  /* ── Was geschieht, wenn die Leitung abreißt? ──────────────────────
     Der Auftrag wird JETZT hinterlegt und vom Server ausgeführt, sobald
     die Verbindung wegfällt. Genau deshalb greift er auch bei einem
     Rechner, der schon offline ist und nichts mehr senden kann.

     Bei allen anderen verschwindet der Eintrag einfach.

     >>> Beim Besitzer bleibt eine Marke stehen (lost = 1) <<<
     Sie unterscheidet einen Abbruch vom ordentlichen Verlassen und ist
     damit in der Konsole zu erkennen.

     Für die Frage, ob die Eingeladenen schreiben dürfen, macht das aber
     KEINEN Unterschied – dort zählt schon die blosse Abwesenheit
     (onOwnerAway). Der Grund steht dort ausführlich: ob abgestürzt oder
     zugemacht, der Besitzer kann das Heft gleich darauf ohne Netz wieder
     öffnen und örtlich weiterschreiben. Diesen einen Weg kann nichts
     anderes absichern, denn eine App, die offline startet, hatte nie
     eine Leitung, über die sie sich hätte melden können.

     Registriert wird ERST nach dem set() oben: dort steht fest, welche
     Felder die veröffentlichten Regeln annehmen. Bis zu diesem Punkt
     gibt es auch nichts wegzuräumen – ohne das set() existiert der
     Eintrag ja gar nicht. */
  let ownerMarkOk = false;
  if (options.isOwner) {
    try {
      await onDisconnect(meRef).set({ ...card, lost: 1, at: rtNow() });
      ownerMarkOk = true;
    } catch (err) {
      console.warn('[Share] Die veröffentlichten Regeln kennen das Feld lost '
        + 'noch nicht – ein Abbruch beim Besitzer fällt den Eingeladenen '
        + 'dann nicht auf. Abhilfe: website/database.rules.json in der '
        + 'Firebase Console unter Realtime Database → Regeln veröffentlichen.');
    }
    // Etwaigen lost-Vermerk der VORIGEN Verbindung überschreiben.
    // Schließt der Besitzer die App und öffnet sie sofort wieder, feuert
    // das alte onDisconnect serverseitig NACH der neuen Verbindung und
    // setzt lost:1 auf den frischen Eintrag – das hier löscht es wieder.
    await set(meRef, { ...card, lost: null, at: rtNow() });
  }
  if (!ownerMarkOk) await onDisconnect(meRef).remove();

  const stops = [];
  let lastPageWrite = 0;
  let pendingPage = null;
  let pageTimer = null;
  let left = false;

  // Nur einmal darüber klagen, nicht bei jedem Tastendruck
  let extrasWarned = false;

  /* ── Anwesenheit ── */

  /**
   * Meldet, wo diese Person gerade ist: auf welcher Seite, an welcher
   * Stelle im Text und welche Zeilen sie dabei belegt.
   *
   * Gebremst wird nach Art der Änderung: eine reine Seitenänderung darf
   * warten, eine Positionsänderung nicht. Mit einem gemeinsamen Takt von
   * einer Sekunde lief die fremde Schreibmarke dem Text hinterher, und
   * die Zeilensperre kam zu spät, um noch etwas zu verhindern.
   *
   * @param {string} pageId
   * @param {number} [offset] Stelle im flachen Text, -1 = nicht im Text
   * @param {{from:number,to:number}|null} [lock] gesperrter Bereich
   * @param {string} [anchor] Zeichen um die Marke herum, als Anker
   */
  function setPage(pageId, offset, lock, anchor) {
    if (left || !pageId) return;

    const nextOffset = Number.isFinite(offset) ? offset : card.offset;
    // Ohne die passenden Regeln bleibt die Sperre ganz aus – siehe oben
    const claim = lockFieldsOk ? lock : null;
    const from = claim && Number.isFinite(claim.from) ? claim.from : -1;
    const to = claim && Number.isFinite(claim.to) ? claim.to : -1;

    const cx = lockFieldsOk ? String(anchor || '').slice(0, 64) : '';
    const samePlace = pageId === card.pageId && nextOffset === card.offset
                      && cx === card.cx;
    const sameLock = !lockFieldsOk || (from === card.lockFrom && to === card.lockTo);

    /* Nichts Neues – aber eine bestehende Sperre muss trotzdem regelmäßig
       aufgefrischt werden, sonst läuft sie mitten im Schreiben ab. */
    const stale = from >= 0 && (Date.now() - card.lockAt) > LOCK_REFRESH_MS;

    /* ══════════════════════════════════════════════════════════════════
       UND EIN LEBENSZEICHEN, AUCH WENN SICH NICHTS ÄNDERT

       >>> Der Fall, den das repariert <<<
       Der Besitzer macht die App zu und gleich wieder auf. Sein
       onDisconnect-Auftrag von der ALTEN Verbindung läuft beim Server
       erst Sekunden später ab – also NACH dem Beitreten der neuen. Er
       setzt dann seinen Eintrag wieder auf `lost: 1`, obwohl er längst
       wieder da ist. Für alle anderen bleibt er damit „nicht erreichbar",
       und sie lesen nur noch.

       Herauskommen konnte man daraus nicht: geschrieben wurde die
       Anwesenheit nur bei einer Änderung, und wer gerade zusieht, ändert
       nichts. Genau so wurde es gemeldet – „kurz raus und wieder rein,
       bei den anderen steht immer noch Nur-Lesen".

       Deshalb schreibt sich der Eintrag alle paar Sekunden von selbst neu.
       Das kostet fast nichts und heilt jeden Fall, in dem er jemandem
       abhandengekommen ist.
       ══════════════════════════════════════════════════════════════════ */
    const verblasst = Date.now() - lastPageWrite > PRESENCE_HEARTBEAT_MS;

    if (samePlace && sameLock && !stale && !verblasst) return;

    const wasPage = card.pageId;
    card.pageId = pageId;
    card.offset = nextOffset;
    if (lockFieldsOk) {
      card.lockFrom = from;
      card.lockTo = to;
      card.cx = cx;
      if (from >= 0) card.lockAt = Date.now();
    }

    pendingPage = lockFieldsOk
      ? { pageId, offset: nextOffset, lockFrom: from, lockTo: to, lockAt: card.lockAt, cx }
      : { pageId, offset: nextOffset };

    if (pageTimer) return;
    const quick = pageId === wasPage;   // nur die Stelle hat sich verschoben
    const gap = quick ? CARET_THROTTLE_MS : PRESENCE_THROTTLE_MS;
    const wait = Math.max(0, gap - (Date.now() - lastPageWrite));
    pageTimer = setTimeout(() => {
      pageTimer = null;
      if (left) return;
      lastPageWrite = Date.now();
      set(meRef, { ...card, ...pendingPage, at: rtNow() }).catch(() => {});
    }, wait);
  }

  function onPresence(callback) {
    const stop = onValue(ref(rtdb, `presence/${docId}`), (snap) => {
      const all = snap.val() || {};
      // lost = die stehen gebliebene Marke eines Besitzers, dem die
      // Leitung abgerissen ist. Anwesend ist er damit gerade nicht.
      callback(Object.values(all).filter(p => p && p.uid !== me.uid && !p.lost));
    }, () => callback([]));
    stops.push(stop);
    return stop;
  }

  /**
   * Meldet, ob der Kontakt zum Besitzer fehlt. Solange das der Fall ist,
   * dürfen Eingeladene nur lesen (ui/sharedDocs.js).
   *
   * >>> Zwei Gründe, dasselbe Ergebnis <<<
   * Gesperrt wird nur, wenn der Kontakt UNGEWOLLT fehlt:
   *
   *   · Dem Besitzer ist die Leitung abgerissen oder er ist abgestürzt.
   *     Dann steht sein Eintrag mit lost = 1 da (siehe onDisconnect
   *     oben): er hat die App offen und schreibt womöglich örtlich
   *     weiter, ohne dass es ankommt. Wer jetzt hier tippt, baut einen
   *     Konflikt auf, den nachher niemand auflösen kann.
   *   · Die EIGENE Leitung ist weg. Dann sagt der Anwesenheitseintrag
   *     nichts mehr aus – er steht nur noch im Zwischenspeicher und
   *     könnte längst überholt sein. Gefragt wird deshalb zusätzlich
   *     `.info/connected`; das ist der einzige Wert, der auch ohne
   *     Verbindung stimmt, weil ihn die Bibliothek örtlich führt.
   *
   * >>> Und wann NICHT gesperrt wird <<<
   * Wenn der Besitzer den Raum ordentlich verlässt oder die App zumacht.
   * Dann räumt leave() seinen Eintrag weg und hebt den Auftrag auf – es
   * bleibt gar nichts stehen. Weitergearbeitet wird wie bei Google Docs;
   * dass der Besitzer gerade nicht da ist, geht niemanden etwas an.
   *
   * Bewusst NICHT über das Alter des Eintrags: setPage schreibt nur bei
   * einer Änderung, ein untätiger Besitzer frischt `at` also gar nicht
   * auf. Er gälte nach kurzer Zeit als weg, obwohl er dasitzt.
   *
   * Beim Besitzer selbst wird einmal `false` gemeldet und nichts weiter
   * beobachtet: er darf immer schreiben, auch offline.
   *
   * @param {(away: boolean) => void} callback
   */
  function onOwnerAway(callback) {
    const ownerUid = options.ownerUid || '';
    if (!ownerUid || ownerUid === me.uid) { callback(false); return () => {}; }

    let connected = true;
    let ownerHere = true;
    const report = () => callback(!connected || !ownerHere);

    const stopConn = onValue(ref(rtdb, '.info/connected'), (snap) => {
      connected = snap.val() === true;
      report();
    }, () => { connected = false; report(); });

    const stopOwner = onValue(ref(rtdb, `presence/${docId}/${ownerUid}`), (snap) => {
      /* >>> Kein Eintrag zählt schon als weg <<<
         Ob der Besitzer abgestürzt ist oder ordentlich zugemacht hat,
         macht für die Gefahr keinen Unterschied: in beiden Fällen kann
         er das Heft gleich darauf ohne Netz wieder öffnen und örtlich
         weiterschreiben, ohne dass es irgendjemand mitbekommt. Genau
         dieser Weg lässt sich durch nichts anderes absichern – eine App,
         die offline startet, hatte nie eine Leitung, über die sie sich
         hätte melden können.

         Die Marke (lost) bleibt trotzdem stehen und zählt hier mit: sie
         schadet nicht, und ohne veröffentlichte Regel fällt der Auftrag
         auf „Eintrag entfernen" zurück – was hier dasselbe bedeutet. */
      const eintrag = snap.val();
      ownerHere = snap.exists() && !eintrag?.lost;
      report();
    }, () => { ownerHere = false; report(); });

    stops.push(stopConn, stopOwner);
    return () => { stopConn(); stopOwner(); };
  }

  /* ── Änderungsstrom ── */

  /**
   * Schickt eine Änderung in den Raum.
   *
   * >>> Warum hier ein zweiter Versuch steht <<<
   * An einer Textänderung reisen Zusatzangaben mit: die Stelle der
   * Schreibmarke und die beanspruchten Zeilen (OP_EXTRAS). Die Regel der
   * Realtime Database weist aber JEDES Feld ab, das sie nicht kennt.
   * Sind die veröffentlichten Regeln älter als die App, scheiterte damit
   * die gesamte Textübertragung – wegen einer Zugabe, die nur die fremde
   * Schreibmarke genauer macht. Der Text kam beim anderen nie an, und was
   * man sah, war eine Marke, die auf Zeichen zeigte, die es dort nicht
   * gab.
   *
   * Eine Zugabe darf die Hauptsache nicht umbringen. Also: scheitert es,
   * geht dieselbe Änderung ohne die Zusatzangaben noch einmal hinaus.
   *
   * >>> Warum das Ergebnis zurückgemeldet wird <<<
   * Vorher endete jeder Fehlschlag in einer Warnung in der Konsole, und
   * der Aufrufer hielt die Änderung für zugestellt. Sie war damit für
   * immer verloren – der andere sah den Text nie, während Anwesenheit
   * und Sperrband weiter ankamen. Wer das Ergebnis kennt, kann den
   * Notweg über Firestore nehmen (ui/collab.js).
   *
   * @returns {Promise<boolean>} ob die Änderung im Raum steht
   */
  function sendOp(op) {
    if (left) return Promise.resolve(false);
    const full = { ...op, by: me.uid, at: rtNow() };

    return push(opsRef, full).then(() => true).catch((err) => {
      const extras = OP_EXTRAS.filter(key => key in op);
      if (!extras.length) {
        console.warn('[Share] Änderung konnte nicht gesendet werden:', err?.message || err);
        return false;
      }

      const plain = { ...full };
      for (const key of extras) delete plain[key];

      return push(opsRef, plain).then(() => {
        if (extrasWarned) return true;
        extrasWarned = true;
        console.warn('[Share] Die veröffentlichten Regeln kennen die Felder '
          + OP_EXTRAS.join(', ') + ' noch nicht. Der Text wird übertragen, die fremde '
          + 'Schreibmarke bleibt aber ungenau. Abhilfe: website/database.rules.json '
          + 'in der Firebase Console unter Realtime Database → Regeln veröffentlichen.');
        return true;
      }).catch((zweiter) => {
        console.warn('[Share] Änderung konnte nicht gesendet werden:',
          zweiter?.message || zweiter);
        return false;
      });
    });
  }

  function onOp(callback) {
    const stop = onChildAdded(
      rtQuery(opsRef, limitToLast(OP_BACKLOG)),
      (snap) => {
        const op = snap.val();
        if (!op || op.by === me.uid) return;   // eigene Änderungen nicht doppelt
        callback(op);
      },
      (err) => console.warn('[Share] Änderungsstrom beendet:', err?.message || err)
    );
    stops.push(stop);
    return stop;
  }

  /** Alte Einträge wegräumen – sonst wächst der Strom endlos. */
  async function pruneOps() {
    try {
      const snap = await rtGet(opsRef);
      const all = snap.val() || {};
      const cutoff = Date.now() - OP_MAX_AGE_MS;
      for (const [key, op] of Object.entries(all)) {
        if (typeof op?.at === 'number' && op.at < cutoff) {
          await remove(child(opsRef, key)).catch(() => {});
        }
      }
    } catch (err) { /* nicht wichtig genug für eine Meldung */ }
  }

  async function leave() {
    if (left) return;
    left = true;
    clearTimeout(pageTimer);
    for (const stop of stops) { try { stop(); } catch (e) {} }
    try { await onDisconnect(meRef).cancel(); } catch (e) {}
    try { await remove(meRef); } catch (e) {}

    /* Der Besitzer nimmt die Rollenliste wieder mit. Sie gilt nur,
       solange er da ist – wer eingeladen ist, darf ohne ihn ohnehin nur
       lesen. Bleibt sie stehen, behielte ein später Entfernter seinen
       Zugang zum Raum bis zum nächsten Betreten des Besitzers. */
    if (options.isOwner) {
      try { await remove(rolesRef); } catch (e) { /* dann beim nächsten Mal */ }
    }
  }

  pruneOps();

  /**
   * Die Rollenliste des Raums neu schreiben. Nur der Besitzer darf das,
   * und nur er ruft es auf: wer neu dazukommt, traegt seine Kennung im
   * Kopf des Dokuments ein, und erst danach kann sie hier landen
   * (ui/sharedDocs.js, watchOpenDocument).
   */
  async function setRoles(rollen) {
    if (!options.isOwner || left) return;
    const r = { [me.uid]: true };
    const w = { [me.uid]: true };
    for (const [uid, rolle] of Object.entries(rollen || {})) {
      if (!uid) continue;
      r[uid] = true;
      if (rolle === 'edit') w[uid] = true;
    }
    try { await set(rolesRef, { owner: me.uid, r, w }); }
    catch (err) { console.warn('[Share] Rollenliste nicht geschrieben:', err?.message || err); }
  }

  /**
   * Meldet laufend, ob die Verbindung zur Live-Datenbank steht.
   *
   * >>> Wofuer das da ist <<<
   * Ein Raum, der betreten ist, heisst noch nicht, dass etwas ankommt.
   * Reisst die Leitung - oder kam sie nie zustande, weil das Netz den
   * Weg der Datenbank sperrt -, laeuft alles weiter, als sei nichts:
   * geschrieben wird in eine Warteschlange, die niemand sieht.
   *
   * Damit kann der Streifen ueber dem Dokument den Zustand zeigen,
   * solange er anhaelt, und ihn von selbst wieder wegnehmen.
   */
  function onConnection(cb) {
    return onValue(ref(rtdb, '.info/connected'), (snap) => {
      try { cb(snap.val() === true); } catch (e) { /* Anzeige darf nichts kosten */ }
    });
  }

  return { me: card, setPage, onPresence, onOwnerAway, sendOp, onOp, setRoles, onConnection, leave };
}

/* ── Fassade ────────────────────────────────────────────────────────
   Die Seiten sind klassische Scripts (onclick-Attribute brauchen den
   globalen Gültigkeitsbereich), dieses Modul ist ein ES-Modul.
   ─────────────────────────────────────────────────────────────────── */

const InkwellShare = {
  // Lesekopien (unverändert)
  publishNotebook,
  loadSharedNotebook,
  revokeShare,
  isOwnShare,
  ensureOwnerId,
  currentOwnerId,
  shareUrlFor,
  SHARE_BASE_URL,

  // Anmeldung
  signInWithProviderToken,
  signInMicrosoftInteractive,
  signInMicrosoftSilently,
  // Dieselbe Adresse gehört schon zu einer Google-Anmeldung
  microsoftWartetAufGoogle,
  linkMicrosoftWithGoogle,
  signOutIdentity,
  currentIdentity,
  hasRealIdentity,
  onIdentityChanged,
  whenIdentityReady,
  claimOwnShares,

  // Geteilte Dokumente – Besitzerseite
  shareDocument,
  saveDocumentContent,
  unshareDocument,
  loadDocumentHead,
  setLinkMode,
  rotateLink,
  setMember,
  removeMember,
  leaveDocument,
  unblockMember,
  listMembers,
  listOwnedDocs,
  findOwnedDocForNotebook,

  // Geteilte Dokumente – Empfängerseite
  listSharedDocs,
  watchSharedDocs,
  watchDocument,
  resolveLink,
  joinViaLink,
  loadDocument,
  loadPage,
  registerMyUid,
  roomRolesFrom,

  // Hilfsmittel
  docUrlFor,
  appUrlFor,
  normalizeEmail,
  looksLikeEmail,

  // Umwandler – reine Funktionen, für Tests und die Oberfläche
  splitNotebook,
  assembleNotebook,
  fingerprintNotebook,

  // Live-Bearbeitung
  joinDocRoom,
  savePageText,
  initialsOf,
  colorForUid
};

if (typeof window !== 'undefined') {
  window.InkwellShare = InkwellShare;
  document.dispatchEvent(new Event('inkwell-share-ready'));
}

export default InkwellShare;
export {
  publishNotebook, loadSharedNotebook, revokeShare, isOwnShare,
  ensureOwnerId, currentOwnerId, shareUrlFor,
  signInWithProviderToken, signInMicrosoftInteractive, signInMicrosoftSilently,
  microsoftWartetAufGoogle, linkMicrosoftWithGoogle,
  signOutIdentity, currentIdentity, hasRealIdentity,
  onIdentityChanged, whenIdentityReady, claimOwnShares,
  shareDocument, saveDocumentContent, unshareDocument, loadDocumentHead,
  setLinkMode, rotateLink,
  setMember, removeMember, leaveDocument, unblockMember, listMembers,
  listSharedDocs, watchSharedDocs, watchDocument, resolveLink, joinViaLink,
  loadDocument, loadPage, registerMyUid, roomRolesFrom,
  docUrlFor, appUrlFor, normalizeEmail, looksLikeEmail,
  splitNotebook, assembleNotebook, fingerprintNotebook,
  joinDocRoom, savePageText, initialsOf, colorForUid
};
