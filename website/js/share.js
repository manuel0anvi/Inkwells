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
  GoogleAuthProvider, OAuthProvider, onAuthStateChanged
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
async function signInWithProviderToken({ provider, idToken, rawNonce } = {}) {
  if (!idToken) throw new Error('NO_ID_TOKEN');

  const credential = provider === 'microsoft'
    ? new OAuthProvider('microsoft.com').credential({ idToken, rawNonce: rawNonce || undefined })
    : GoogleAuthProvider.credential(idToken);

  const existing = auth.currentUser;

  // Schon angemeldet mit demselben Konto? Dann nichts tun – ein zweiter
  // Anmeldeversuch würde nur eine neue Sitzung anlegen.
  if (existing && !existing.isAnonymous && normalizeEmail(existing.email)) {
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

/**
 * Zerlegt ein Heft in die Teile, die einzeln abgelegt werden.
 *
 * @param {object} notebook
 * @returns {{head:object, pages:object[], ink:object[], blobs:object[]}}
 */
function splitNotebook(notebook) {
  const pagesIn = Array.isArray(notebook.pages) ? notebook.pages : [];
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
    sections: (notebook.sections || []).map(sec => ({
      id: String(sec.id),
      name: String(sec.name || ''),
      pgIds: (sec.pgIds || []).map(String),
      defaultBg: sec.defaultBg || notebook.defaultBg || 'ruled'
    })),
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

  // Kein Abschnitt hinterlegt (sehr alte Fassung): einen aufmachen, sonst
  // steht der Editor ohne Navigation da.
  if (!notebook.sections.length && notebookPages.length) {
    notebook.sections = [{
      id: 'sec_' + (notebook.id || 'doc'),
      name: 'Allgemein',
      pgIds: notebookPages.map(p => p.id),
      defaultBg: notebook.defaultBg
    }];
  }

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

/** Was darf, wer den Link hat? 'off' nimmt den Link ganz aus dem Verkehr. */
async function setLinkMode(docId, mode) {
  const me = requireIdentity();
  const wanted = normalizeLinkMode(mode);
  const head = await loadDocumentHead(docId);
  if (head.owner !== me.uid) throw new Error('SHARE_NOT_OWNED');

  if (wanted === 'off') {
    if (head.linkId) await deleteDoc(doc(db, DOC_LINKS, head.linkId)).catch(() => {});
    await updateDocHead(docId, { linkMode: 'off', linkId: '' });
    return { linkMode: 'off', linkId: '', url: '' };
  }

  const linkId = head.linkId || makeShareId();
  await updateDocHead(docId, { linkMode: wanted, linkId });
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
 * @returns {Promise<object>} Raum mit setPage/onPresence/sendOp/onOp/leave
 */
async function joinDocRoom(docId) {
  const me = requireIdentity();
  const { mod, db: rtdb } = await loadRealtime();
  const { ref, child, push, set, remove, onValue, onChildAdded, onDisconnect,
          query: rtQuery, limitToLast, serverTimestamp: rtNow, get: rtGet } = mod;

  const meRef = ref(rtdb, `presence/${docId}/${me.uid}`);
  const opsRef = ref(rtdb, `ops/${docId}`);

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

  // Verschwindet von selbst, sobald die Verbindung abreißt. Genau dafür
  // gibt es die Realtime Database hier.
  await onDisconnect(meRef).remove();

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
    if (samePlace && sameLock && !stale) return;

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
      callback(Object.values(all).filter(p => p && p.uid !== me.uid));
    }, () => callback([]));
    stops.push(stop);
    return stop;
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
   */
  function sendOp(op) {
    if (left) return Promise.resolve();
    const full = { ...op, by: me.uid, at: rtNow() };

    return push(opsRef, full).catch((err) => {
      const extras = OP_EXTRAS.filter(key => key in op);
      if (!extras.length) {
        console.warn('[Share] Änderung konnte nicht gesendet werden:', err?.message || err);
        return;
      }

      const plain = { ...full };
      for (const key of extras) delete plain[key];

      return push(opsRef, plain).then(() => {
        if (extrasWarned) return;
        extrasWarned = true;
        console.warn('[Share] Die veröffentlichten Regeln kennen die Felder '
          + OP_EXTRAS.join(', ') + ' noch nicht. Der Text wird übertragen, die fremde '
          + 'Schreibmarke bleibt aber ungenau. Abhilfe: website/database.rules.json '
          + 'in der Firebase Console unter Realtime Database → Regeln veröffentlichen.');
      }).catch((zweiter) => {
        console.warn('[Share] Änderung konnte nicht gesendet werden:',
          zweiter?.message || zweiter);
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
  }

  pruneOps();

  return { me: card, setPage, onPresence, sendOp, onOp, leave };
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

  // Geteilte Dokumente – Empfängerseite
  listSharedDocs,
  watchSharedDocs,
  watchDocument,
  resolveLink,
  joinViaLink,
  loadDocument,
  loadPage,

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
  signInWithProviderToken, currentIdentity, hasRealIdentity,
  onIdentityChanged, whenIdentityReady, claimOwnShares,
  shareDocument, saveDocumentContent, unshareDocument, loadDocumentHead,
  setLinkMode, rotateLink,
  setMember, removeMember, leaveDocument, unblockMember, listMembers,
  listSharedDocs, watchSharedDocs, watchDocument, resolveLink, joinViaLink,
  loadDocument, loadPage, docUrlFor, appUrlFor, normalizeEmail, looksLikeEmail,
  splitNotebook, assembleNotebook, fingerprintNotebook,
  joinDocRoom, savePageText, initialsOf, colorForUid
};
