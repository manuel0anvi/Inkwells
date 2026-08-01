/* ══════════════════════════════════════════════════════════════════════
   FIREBASE / CLOUD FIRESTORE  ―  Datenbank des Community-Forums

   Löst die frühere Supabase-Anbindung ab (Tabellen community_posts /
   community_replies). Statt zweier Tabellen mit Fremdschlüssel liegt jetzt
   ein Dokumentenmodell zugrunde:

     community_posts/{postId}                 ← ein Beitrag
     community_posts/{postId}/replies/{id}    ← seine Antworten

   Dadurch entfällt das Feld `post_id`: die Zugehörigkeit steckt im Pfad.

   ── Warum eine ES-Modul-Datei? ──────────────────────────────────────
   Das Firebase v9+ SDK ist modular. Die Website hat keinen Bundler
   (statische Seiten auf GitHub Pages), deshalb kommt das SDK als ES-Modul
   direkt von Googles CDN. Weil ein <script type="module"> seinen eigenen
   Gültigkeitsbereich hat, die Forenseite ihre Funktionen aber aus
   onclick="…"-Attributen aufruft, wird hier eine kleine Fassade unter
   window.InkwellForum bereitgestellt.

   Version des SDK bewusst festgenagelt – so ändert sich nichts unter der
   Hand. Zum Aktualisieren nur die Nummer in beiden Import-Zeilen tauschen.
   ══════════════════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

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
 *  · ISO-Zeichenkette     – Altbestand aus der Supabase-Zeit
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

/**
 * Antworten eines Beitrags, älteste zuerst.
 * @param {string} postId
 * @returns {Promise<Reply[]>}
 */
async function listReplies(postId) {
  const snapshot = await getDocs(
    query(collection(db, POSTS, postId, REPLIES), orderBy('created_at', 'asc'))
  );
  return snapshot.docs.map(mapReply);
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

  return posts;
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
      onChange(posts);
    },
    (err) => { if (onError) onError(err); else console.error('[Forum] Live-Abgleich:', err); }
  );
}

/* ── Fassade für die Forenseite ─────────────────────────────────────
   community/index.html ist ein klassisches Script (die Bedienelemente
   rufen ihre Funktionen aus onclick="…" auf und brauchen deshalb den
   globalen Gültigkeitsbereich). Über window kommen beide Welten zusammen.
   ─────────────────────────────────────────────────────────────────── */

window.InkwellForum = {
  listPosts,
  listReplies,
  createPost,
  createReply,
  watchPosts,
  toDate,
  DEFAULT_AUTHOR
};

// Signal für die Seite: ab jetzt darf geladen werden. Wird auch dann
// gebraucht, wenn das Modul (Netz, Blocker) gar nicht erst hochkommt –
// dann bleibt window.InkwellForum leer und die Seite zeigt einen Fehler,
// statt endlos "Lade Beiträge…" anzuzeigen.
document.dispatchEvent(new Event('inkwell-forum-ready'));
