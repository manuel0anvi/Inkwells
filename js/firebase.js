/* ══════════════════════════════════════════════════════════════════════
   FIREBASE / CLOUD FIRESTORE  ―  Datenbank des Community-Forums

   Zugrunde liegt ein Dokumentenmodell, keine Tabellen mit Fremdschlüssel:

     community_posts/{postId}                 ← ein Beitrag
     community_posts/{postId}/replies/{id}    ← seine Antworten

   Die Zugehörigkeit einer Antwort steckt damit im Pfad; ein Feld wie
   `post_id` braucht es nicht.

   ── Warum eine ES-Modul-Datei? ──────────────────────────────────────
   Das Firebase v9+ SDK ist modular. Die Website hat keinen Bundler
   (statische Seiten auf GitHub Pages), deshalb kommt das SDK als ES-Modul
   direkt von Googles CDN. Weil ein <script type="module"> seinen eigenen
   Gültigkeitsbereich hat, die Forenseite ihre Funktionen aber aus
   onclick="…"-Attributen aufruft, wird hier eine kleine Fassade unter
   window.InkwellsForum bereitgestellt.

   Version des SDK bewusst festgenagelt – so ändert sich nichts unter der
   Hand. Zum Aktualisieren nur die Nummer in beiden Import-Zeilen tauschen.
   ══════════════════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

/* ── Zugangsdaten ───────────────────────────────────────────────────
   Diese Werte sind KEIN Geheimnis. Der Firebase-"apiKey" ist nur eine
   Projektkennung – er landet zwangsläufig im Browser jedes Besuchers und
   ist von Google auch so gedacht. Ihn in eine .env zu legen würde hier
   nichts schützen (die Seite hat keinen Build-Schritt, der Wert stünde
   danach genauso im ausgelieferten JavaScript).

   Geschützt wird die Datenbank stattdessen durch:
     · die Firestore-Sicherheitsregeln (siehe website/firestore.rules),
     · optional eine Beschränkung des API-Schlüssels auf die eigenen
       Domains: Google Cloud Console → APIs & Dienste → Anmeldedaten →
       Browser-Key → HTTP-Referrer auf https://inkwells.me/* begrenzen.
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

// Sammlungsnamen an einer Stelle – so bleiben sie mit den
// Sicherheitsregeln in website/firestore.rules synchron.
const POSTS = 'community_posts';
const REPLIES = 'replies';
const SITE_CONTENT = 'site_content';
const PRIVACY_DOC = 'privacy';

// Fällt der Name weg, steht laut Datenmodell "Gast" im Dokument.
const DEFAULT_AUTHOR = 'Gast';

/* ── Typen (JSDoc statt TypeScript) ─────────────────────────────────
   Das Projekt ist reines JavaScript ohne Übersetzungsschritt. JSDoc-Typen
   erfüllen hier denselben Zweck: VS Code prüft damit Feldnamen und
   Aufrufe, ohne dass eine Toolchain nötig wird.
   ─────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} Post
 * @property {string}      id         Von Firestore vergebene Dokument-ID
 * @property {'question'|'bug'} type
 * @property {string}      title
 * @property {string}      author     Anzeigename, Pseudonym oder "Gast"
 * @property {string}      content
 * @property {Date|null}   created_at Aus dem Firestore-Timestamp gelesen
 * @property {Reply[]}     replies    Aus der Unter-Sammlung nachgeladen
 */

/**
 * @typedef {Object} Reply
 * @property {string}    id
 * @property {string}    author
 * @property {string}    content
 * @property {Date|null} created_at
 */

/* ── Start ──────────────────────────────────────────────────────────
   Analytics wird bewusst NICHT initialisiert, obwohl die measurementId
   vorhanden ist: die Datenschutzerklärung sagt zu, dass keine Dienste zum
   Wiedererkennen oder Beobachten von Besuchern eingesetzt werden.
   ─────────────────────────────────────────────────────────────────── */
const app = initializeApp(firebaseConfig);

// Reihenfolge wie in js/share.js: getAuth() vor getFirestore(). Sonst baut
// Firestore seine Verbindung auf, bevor eine gespeicherte Anmeldung wieder
// hergestellt ist, und die ersten Schreibzugriffe gelten als nicht angemeldet.
const auth = getAuth(app);
const db = getFirestore(app);

/* ── Umwandlung ─────────────────────────────────────────────────────── */

/**
 * Macht aus dem Zeitstempel eines Dokuments ein Date.
 *
 * Muss mehrere Formen abfangen:
 *  · Firestore-Timestamp  – der Normalfall, hat .toDate()
 *  · null                 – direkt nach dem Anlegen, solange serverTimestamp()
 *                           vom Server noch nicht bestätigt wurde
 *  · { seconds, … }       – einfaches Objekt, etwa aus einem Export
 *  · ISO-Zeichenkette     – Altbestand aus einer früheren Fassung
 *
 * @param {unknown} value
 * @returns {Date|null}
 */
function toDate(value) {
  if (!value) return null;

  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }

  const parsed = new Date(/** @type {string|number} */ (value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** @returns {Post} */
function mapPost(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    type: data.type === 'bug' ? 'bug' : 'question',
    title: String(data.title || ''),
    author: String(data.author || DEFAULT_AUTHOR),
    content: String(data.content || ''),
    created_at: toDate(data.created_at),
    replies: []
  };
}

/** @returns {Reply} */
function mapReply(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    author: String(data.author || DEFAULT_AUTHOR),
    content: String(data.content || ''),
    created_at: toDate(data.created_at)
  };
}

/* ── Lesen ──────────────────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════════════
   WAS OBEN STEHT

   BEITRÄGE und ANTWORTEN laufen absichtlich verschieden herum:

     · Beiträge  – neueste zuerst. Ein Forum ist eine Liste von Themen,
                   und das jüngste Thema interessiert zuerst.
     · Antworten – älteste zuerst, wie ein Gespräch. Eine Antwort bezieht
                   sich auf die davor; von hinten gelesen ergibt sie
                   keinen Sinn. Die neueste steht also unten.

   Eine Ausnahme steht über beidem: die Antwort des Teams. Sie ist meist
   DIE Antwort auf die Frage – wer den Beitrag öffnet, soll sie sehen,
   ohne erst zu suchen. Untereinander bleiben auch sie in der
   Reihenfolge, in der sie geschrieben wurden.

   >>> Warum hier und nicht in der Abfrage <<<
   Den Fall „Zeitstempel fehlt noch" kann Firestore nicht ausdrücken.
   Direkt nach dem Absenden steht created_at auf null, weil
   serverTimestamp() erst beim nächsten Abgleich einen Wert bekommt. So
   eine Antwort ist die allerjüngste: unter den Antworten gehört sie ganz
   nach unten, unter den Beiträgen ganz nach oben. Beides fällt hier
   heraus, weil „ohne Datum" als „gerade eben" gilt.
   ══════════════════════════════════════════════════════════════════════ */

/* Der Name des Teams. Früher hiess die App „Inkwell", deshalb stehen in
   älteren Antworten beide Schreibweisen – beide bleiben angeheftet.
   Gross- und Kleinschreibung spielt keine Rolle. */
const TEAM_NAMEN = ['inkwells team', 'inkwell team'];

/** @param {{author?: string}} eintrag */
function istVomTeam(eintrag) {
  return TEAM_NAMEN.includes(String((eintrag && eintrag.author) || '').trim().toLowerCase());
}

/** Ohne Zeitstempel gilt „gerade eben" – siehe oben. */
function zeitWert(eintrag) {
  const d = eintrag && eintrag.created_at;
  return d instanceof Date ? d.getTime() : Number.MAX_SAFE_INTEGER;
}

/** Neueste zuerst – für die Beiträge. */
function neuesteZuerst(a, b) {
  return zeitWert(b) - zeitWert(a);
}

/** Älteste zuerst – für die Antworten, damit sie sich lesen lassen. */
function aeltesteZuerst(a, b) {
  return zeitWert(a) - zeitWert(b);
}

/** Der Reihe nach, das Team darüber. */
function sortiereAntworten(liste) {
  return liste.slice().sort((a, b) => {
    const ta = istVomTeam(a) ? 1 : 0;
    const tb = istVomTeam(b) ? 1 : 0;
    if (ta !== tb) return tb - ta;
    return aeltesteZuerst(a, b);
  });
}

/**
 * Antworten eines Beitrags: das Team zuerst, dahinter der Reihe nach.
 * @param {string} postId
 * @returns {Promise<Reply[]>}
 */
async function listReplies(postId) {
  const snapshot = await getDocs(
    query(collection(db, POSTS, postId, REPLIES), orderBy('created_at', 'asc'))
  );
  return sortiereAntworten(snapshot.docs.map(mapReply));
}

/**
 * Alle Beiträge, neueste zuerst, jeweils samt Antworten.
 *
 * Die Antworten liegen in Unter-Sammlungen und brauchen deshalb je Beitrag
 * eine eigene Abfrage. Sie laufen parallel, damit die Ladezeit nicht mit
 * der Zahl der Beiträge wächst. Schlägt eine davon fehl, bleibt der Beitrag
 * trotzdem sichtbar – nur eben ohne seine Antworten.
 *
 * @returns {Promise<Post[]>}
 */
async function listPosts() {
  const snapshot = await getDocs(
    query(collection(db, POSTS), orderBy('created_at', 'desc'))
  );
  const posts = snapshot.docs.map(mapPost);

  await Promise.all(posts.map(async (post) => {
    try {
      post.replies = await listReplies(post.id);
    } catch (err) {
      console.warn('[Forum] Antworten nicht lesbar für', post.id, err);
      post.replies = [];
    }
  }));

  /* Die Abfrage sortiert schon absteigend; nachgezogen wird nur der Fall,
     den sie nicht kennt – der eben abgeschickte Beitrag ohne Zeitstempel. */
  return posts.sort(neuesteZuerst);
}

/* ── Schreiben ──────────────────────────────────────────────────────── */

/**
 * Legt einen Beitrag an.
 * @param {{ type: string, title: string, author?: string, content: string }} input
 * @returns {Promise<string>} die neue Dokument-ID
 */
async function createPost({ type, title, author, content }) {
  const ref = await addDoc(collection(db, POSTS), {
    type: type === 'bug' ? 'bug' : 'question',
    title: String(title || '').trim(),
    author: String(author || '').trim() || DEFAULT_AUTHOR,
    content: String(content || '').trim(),
    created_at: serverTimestamp()
  });
  return ref.id;
}

/**
 * Legt eine Antwort in der Unter-Sammlung des Beitrags an.
 * Ein Feld post_id gibt es nicht mehr – die Zuordnung steckt im Pfad.
 *
 * @param {string} postId
 * @param {{ author?: string, content: string }} input
 * @returns {Promise<string>}
 */
async function createReply(postId, { author, content }) {
  const ref = await addDoc(collection(db, POSTS, postId, REPLIES), {
    author: String(author || '').trim() || DEFAULT_AUTHOR,
    content: String(content || '').trim(),
    created_at: serverTimestamp()
  });
  return ref.id;
}

/* ══════════════════════════════════════════════════════════════════════
   ADMIN

   Die Website ist statisch – ein Passwort im JavaScript wäre für jeden
   Besucher lesbar. Die Prüfung übernimmt deshalb Firebase Authentication,
   und ob jemand löschen darf, entscheidet Firestore anhand der UID (siehe
   website/firestore.rules). Alles hier ist nur Bedienoberfläche: Wer die
   Funktionen unten ohne gültige Anmeldung aufruft, bekommt von der
   Datenbank ein "permission-denied" zurück.
   ══════════════════════════════════════════════════════════════════════ */

/** Ist gerade das Adminkonto angemeldet? */
function isAdmin() {
  const user = auth.currentUser;
  if (!user || !user.email) return false;
  return user.email.toLowerCase() === String(ADMIN_EMAIL || '').toLowerCase();
}

/**
 * Meldet die Adminsitzung an.
 * Die E-Mail steht fest in js/config.js – eingegeben wird nur das Passwort.
 *
 * @param {string} password
 * @returns {Promise<void>}
 */
async function adminSignIn(password) {
  await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password);
}

/** Meldet die Adminsitzung ab. */
async function adminSignOut() {
  await signOut(auth);
}

/**
 * Wartet, bis Firebase die gespeicherte Anmeldung wiederhergestellt hat.
 *
 * Direkt nach dem Laden ist auth.currentUser noch null, auch wenn eine
 * gültige Sitzung existiert. Ohne dieses Warten würde die Adminseite beim
 * Neuladen kurz aufblitzen und dann fälschlich zur Startseite werfen.
 *
 * @returns {Promise<boolean>} ob das Adminkonto angemeldet ist
 */
function adminReady() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, () => {
      stop();
      resolve(isAdmin());
    });
  });
}

/**
 * Meldet Änderungen der Anmeldung.
 * @param {(admin: boolean) => void} callback
 * @returns {() => void} Abmeldefunktion
 */
function onAdminChange(callback) {
  return onAuthStateChanged(auth, () => callback(isAdmin()));
}

/**
 * Ändert das Passwort des Adminkontos.
 *
 * Firebase verlangt für diesen Schritt eine frische Anmeldung. Statt den
 * Fehler abzuwarten und dann nachzufragen, wird hier immer zuerst mit dem
 * aktuellen Passwort bestätigt – das ist ohnehin die Rückfrage, die man
 * bei einer Passwortänderung erwartet.
 *
 * @param {string} currentPassword
 * @param {string} newPassword
 */
async function adminChangePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_SIGNED_IN');

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

/* ── Löschen ────────────────────────────────────────────────────────── */

/**
 * Löscht eine einzelne Antwort.
 * @param {string} postId
 * @param {string} replyId
 */
async function deleteReply(postId, replyId) {
  await deleteDoc(doc(db, POSTS, postId, REPLIES, replyId));
}

/**
 * Löscht einen Beitrag samt seiner Antworten.
 *
 * Firestore löscht Unter-Sammlungen NICHT mit: würde nur das
 * Beitragsdokument verschwinden, blieben die Antworten als verwaiste
 * Dokumente in der Datenbank liegen. Sie werden deshalb zuerst entfernt,
 * gebündelt in einem Schreibvorgang.
 *
 * @param {string} postId
 */
async function deletePost(postId) {
  const replies = await getDocs(collection(db, POSTS, postId, REPLIES));

  // Ein Batch fasst höchstens 500 Schreibvorgänge; bei mehr Antworten wird
  // in Blöcken gelöscht. Der Beitrag selbst kommt zum Schluss, damit er bei
  // einem Abbruch nicht ohne seine Antworten verschwindet.
  const docs = replies.docs;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = writeBatch(db);
    for (const snap of docs.slice(i, i + 450)) batch.delete(snap.ref);
    await batch.commit();
  }

  await deleteDoc(doc(db, POSTS, postId));
}

/* ── Datenschutzerklärung ────────────────────────────────────────────
   Der Text steht als Rückfall fest in js/privacy-content.js. Sobald über
   die Adminseite gespeichert wurde, liegt eine überarbeitete Fassung in
   Firestore und hat Vorrang. So bleibt die Seite auch dann lesbar, wenn
   die Datenbank nicht erreichbar ist.
   ─────────────────────────────────────────────────────────────────── */

/**
 * Holt die gespeicherte Fassung, falls es eine gibt.
 * @returns {Promise<{content: object, updated: string}|null>}
 */
async function loadPrivacy() {
  const snap = await getDoc(doc(db, SITE_CONTENT, PRIVACY_DOC));
  if (!snap.exists()) return null;

  const data = snap.data() || {};
  if (!data.content) return null;

  return {
    content: typeof data.content === 'string' ? JSON.parse(data.content) : data.content,
    updated: String(data.updated || '')
  };
}

/**
 * Speichert eine überarbeitete Fassung.
 *
 * Der Inhalt wird als JSON-Zeichenkette abgelegt, nicht als verschachteltes
 * Objekt: Firestore erlaubt nur 20 Verschachtelungsebenen und keine Listen
 * in Listen – die Tabellenzeilen der Erklärung sind aber genau das.
 *
 * @param {object} content  gleiche Form wie PRIVACY in js/privacy-content.js
 * @param {string} updated  Datum als JJJJ-MM-TT
 */
async function savePrivacy(content, updated) {
  await setDoc(doc(db, SITE_CONTENT, PRIVACY_DOC), {
    content: JSON.stringify(content),
    updated: String(updated || ''),
    updated_at: serverTimestamp()
  });
}

/** Verwirft die gespeicherte Fassung – danach gilt wieder js/privacy-content.js. */
async function resetPrivacy() {
  await deleteDoc(doc(db, SITE_CONTENT, PRIVACY_DOC));
}

/* ── Nachrichten an die App ──────────────────────────────────────────
   Alle Nachrichten stehen in EINEM Dokument, site_content/nachrichten.
   Das ist Absicht: site_content ist von den Sicherheitsregeln schon
   abgedeckt – öffentlich lesbar, nur vom Admin beschreibbar. Für die
   Nachrichten selbst brauchte es dort keine Änderung.

   >>> Öffentlich lesbar heißt: nichts Vertrauliches hineinschreiben <<<
   Der Empfängerkreis („nur Angemeldete", „nur Store") wird von der App
   ausgewertet, nicht vom Server. Wer die Datenbank direkt abfragt, sieht
   alles. Für Ankündigungen reicht das.

   Die Liste bleibt ein Feld im Dokument statt einer Untersammlung: so
   liest die App sie mit EINEM Zugriff, und ein Firestore-Dokument fasst
   1 MB – das reicht für einige hundert Nachrichten. Abgelaufene sollten
   trotzdem regelmäßig weg, dafür gibt es raeumeNachrichtenAuf().
   ─────────────────────────────────────────────────────────────────── */

const NACHRICHTEN_DOC = 'nachrichten';

/** Alle Nachrichten, neueste zuerst. */
async function ladeNachrichten() {
  const snap = await getDoc(doc(db, SITE_CONTENT, NACHRICHTEN_DOC));
  if (!snap.exists()) return [];
  const daten = snap.data() || {};
  const liste = Array.isArray(daten.liste) ? daten.liste : [];
  return liste.slice().sort((a, b) =>
    String(b.erstellt || '').localeCompare(String(a.erstellt || '')));
}

/** Schreibt die ganze Liste zurück. */
async function sichreNachrichten(liste) {
  await setDoc(doc(db, SITE_CONTENT, NACHRICHTEN_DOC), {
    liste: Array.isArray(liste) ? liste : [],
    updated_at: serverTimestamp()
  });
}

/** Hängt eine neue Nachricht an. Die Kennung kommt aus der Uhrzeit. */
async function verschickeNachricht(nachricht) {
  const liste = await ladeNachrichten();
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  liste.unshift({ ...nachricht, id, erstellt: new Date().toISOString() });
  await sichreNachrichten(liste);
  return id;
}

/**
 * Zieht eine Nachricht zurück.
 *
 * Sie verschwindet damit aus jedem Postfach – auch bei denen, die sie
 * schon gesehen haben. Was jemand bereits gelesen hat, lässt sich nicht
 * zurückholen; ab jetzt wird sie nur nicht mehr angezeigt.
 */
async function ziehNachrichtZurueck(id) {
  const liste = await ladeNachrichten();
  await sichreNachrichten(liste.filter(n => String(n.id) !== String(id)));
}

/** Wirft alles weg, dessen Ablaufdatum vorbei ist. */
async function raeumeNachrichtenAuf() {
  const liste = await ladeNachrichten();
  const jetzt = Date.now();
  const bleibt = liste.filter(n => {
    if (!n.gueltigBis) return true;
    const ende = Date.parse(n.gueltigBis);
    return Number.isNaN(ende) || ende >= jetzt;
  });
  const weg = liste.length - bleibt.length;
  if (weg > 0) await sichreNachrichten(bleibt);
  return weg;
}

/* ── Echtzeit (vorbereitet, aktuell ungenutzt) ───────────────────────
   Die Forenseite lädt bewusst auf Anforderung neu statt über onSnapshot:
   ein Live-Update würde die Liste neu zeichnen und dabei ein gerade
   offenes Antwortfeld mitsamt getipptem Text verwerfen. Wer das ändern
   möchte, hat hier den fertigen Anschluss.
   ─────────────────────────────────────────────────────────────────── */

/**
 * @param {(posts: Post[]) => void} onChange
 * @param {(err: Error) => void} [onError]
 * @returns {() => void} Abmeldefunktion
 */
function watchPosts(onChange, onError) {
  return onSnapshot(
    query(collection(db, POSTS), orderBy('created_at', 'desc')),
    async (snapshot) => {
      const posts = snapshot.docs.map(mapPost);
      await Promise.all(posts.map(async (post) => {
        try {
          post.replies = await listReplies(post.id);
        } catch (err) {
          post.replies = [];
        }
      }));
      onChange(posts.sort(neuesteZuerst));
    },
    (err) => { if (onError) onError(err); else console.error('[Forum] Live-Abgleich:', err); }
  );
}

/* ── Fassade für die Forenseite ─────────────────────────────────────
   community/index.html ist ein klassisches Script (die Bedienelemente
   rufen ihre Funktionen aus onclick="…" auf und brauchen deshalb den
   globalen Gültigkeitsbereich). Über window kommen beide Welten zusammen.
   ─────────────────────────────────────────────────────────────────── */

window.InkwellsForum = {
  listPosts,
  listReplies,
  createPost,
  createReply,
  watchPosts,
  toDate,
  DEFAULT_AUTHOR,

  // Admin. Die Datenbank entscheidet, ob diese Aufrufe durchgehen –
  // hier stehen sie nur bereit.
  isAdmin,
  adminReady,
  adminSignIn,
  adminSignOut,
  onAdminChange,
  adminChangePassword,
  deletePost,
  deleteReply,
  loadPrivacy,
  savePrivacy,
  resetPrivacy,

  // Nachrichten an die App
  ladeNachrichten,
  verschickeNachricht,
  ziehNachrichtZurueck,
  raeumeNachrichtenAuf
};

// Signal für die Seite: ab jetzt darf geladen werden. Wird auch dann
// gebraucht, wenn das Modul (Netz, Blocker) gar nicht erst hochkommt –
// dann bleibt window.InkwellsForum leer und die Seite zeigt einen Fehler,
// statt endlos "Lade Beiträge…" anzuzeigen.
document.dispatchEvent(new Event('inkwells-forum-ready'));
