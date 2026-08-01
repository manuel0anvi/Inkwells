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
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, orderBy, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged
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
  await step('Kopf schreiben', () => setDoc(doc(db, SHARES, shareId), {
    owner: ownerId,
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

/* ── Fassade ────────────────────────────────────────────────────────
   Die Seiten sind klassische Scripts (onclick-Attribute brauchen den
   globalen Gültigkeitsbereich), dieses Modul ist ein ES-Modul.
   ─────────────────────────────────────────────────────────────────── */

const InkwellShare = {
  publishNotebook,
  loadSharedNotebook,
  revokeShare,
  isOwnShare,
  ensureOwnerId,
  currentOwnerId,
  shareUrlFor,
  SHARE_BASE_URL
};

if (typeof window !== 'undefined') {
  window.InkwellShare = InkwellShare;
  document.dispatchEvent(new Event('inkwell-share-ready'));
}

export default InkwellShare;
export {
  publishNotebook, loadSharedNotebook, revokeShare, isOwnShare,
  ensureOwnerId, currentOwnerId, shareUrlFor
};
