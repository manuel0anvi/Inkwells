'use strict';

/* ══════════════════════════════════════════════════════════════════════
   KOMMENTARE

   Kurze Notizen am Seitenrand, die an einer Stelle im Text hängen.
   Sie erscheinen als Marke im Text und als Karte am rechten Rand.

   Kommentare leben in nb.comments[] und gehen mit dem Heft überall hin –
   örtlich, in die Cloud und zu anderen Bearbeitern.

   >>> Warum im Heft und nicht in Firestore <<<
   Ein Heft ohne Cloud hat keinen Firestore. Der Kommentar soll trotzdem
   da sein und mit der Datei weitergegeben werden können.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Einen neuen Kommentar anlegen.
 *
 * @param {string} pageId  Seite, zu der der Kommentar gehört
 * @param {string} text    HTML-Inhalt (einfach)
 * @returns {object}       der neue Kommentar
 */
function addComment(pageId, text) {
  if (!pageId) return null;

  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb) return null;

  const author = getCommentAuthor();
  const comment = {
    id: uid(),
    pageId: String(pageId),
    text: text || '',
    author: author,
    created: Date.now(),
    resolved: false,
    replies: []
  };

  if (!nb.comments) nb.comments = [];
  nb.comments.push(comment);

  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  return comment;
}

/**
 * Die Kommentare einer Seite, nach Erstellungszeit.
 */
function getPageComments(pageId) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !nb.comments) return [];
  return nb.comments
    .filter(c => String(c.pageId) === String(pageId))
    .sort((a, b) => (a.created || 0) - (b.created || 0));
}

/**
 * Anzahl der unerledigten Kommentare einer Seite – für die Marke am Rand.
 */
function unresolvedCommentCount(pageId) {
  return getPageComments(pageId).filter(c => !c.resolved).length;
}

/** Wer schreibt? Name und Kennung des angemeldeten Nutzers. */
function getCommentAuthor() {
  let uid = 'local';
  let name = 'Ich';

  if (typeof window.getUserInfo === 'function') {
    const info = window.getUserInfo();
    if (info && info.uid) uid = info.uid;
    if (info && info.name) name = info.name;
  }

  return { uid: uid, name: name };
}

/**
 * Marke im Text setzen – ein nicht löschbares Span mit dem Verweis.
 *
 * contenteditable="false" sorgt dafür, dass der Nutzer die Marke nicht
 * versehentlich überschreibt. Sie verhält sich wie ein einzelnes Zeichen:
 * einmal Entfernen löscht sie ganz.
 */
function insertCommentMarker(commentId) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;

  const range = sel.getRangeAt(0);
  const marker = document.createElement('span');
  marker.className = 'j-comment-marker';
  marker.dataset.cid = String(commentId);
  marker.contentEditable = 'false';
  marker.textContent = '⁠';   // WORD JOINER – unsichtbar, aber ein Zeichen
  marker.title = (typeof t === 'function' && t('commentMarker')) || 'Kommentar';

  range.insertNode(marker);

  // Marke hinter die Marke setzen, damit weitergeschrieben werden kann
  range.setStartAfter(marker);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  // Text-Inhalt der Seite nachziehen
  const textDiv = marker.closest('.j-text');
  if (textDiv) {
    const pgEl = textDiv.closest('[data-pgid]');
    const info = pgEl && typeof getPage === 'function' ? getPage(pgEl.dataset.pgid) : null;
    if (info) {
      info.page.textContent = textDiv.innerHTML;
      if (window.Collab && typeof Collab.noteTextChange === 'function') {
        Collab.noteTextChange(info.page.id, info.page.textContent);
      }
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    }
  }

  return true;
}

/**
 * Kommentar erledigen oder wieder öffnen.
 */
function toggleCommentResolved(commentId) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !nb.comments) return;

  const c = nb.comments.find(c => String(c.id) === String(commentId));
  if (!c) return;
  c.resolved = !c.resolved;
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/**
 * Auf einen Kommentar antworten.
 */
function replyToComment(commentId, text) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !nb.comments || !text) return null;

  const c = nb.comments.find(c => String(c.id) === String(commentId));
  if (!c) return null;

  const reply = {
    id: uid(),
    text: text,
    author: getCommentAuthor(),
    created: Date.now()
  };

  if (!c.replies) c.replies = [];
  c.replies.push(reply);
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  return reply;
}

/**
 * Kommentar löschen – auch die Marke im Text.
 */
function deleteComment(commentId) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !nb.comments) return;

  nb.comments = nb.comments.filter(c => String(c.id) !== String(commentId));

  // Marke im Text entfernen
  const markers = document.querySelectorAll('.j-comment-marker[data-cid="' + CSS.escape(String(commentId)) + '"]');
  markers.forEach(m => {
    const textDiv = m.closest('.j-text');
    m.remove();
    if (textDiv) {
      const pgEl = textDiv.closest('[data-pgid]');
      const info = pgEl && typeof getPage === 'function' ? getPage(pgEl.dataset.pgid) : null;
      if (info) info.page.textContent = textDiv.innerHTML;
    }
  });

  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/**
 * Bestehende Marken im HTML einer Seite wiederfinden und als Kommentare
 * ohne Text anlegen, falls der Kommentar noch nicht in nb.comments steht.
 *
 * Das kommt vor, wenn ein Kommentar von einem anderen Bearbeiter kommt
 * und die Daten über den Text-Kanal ankommen, bevor die Kommentardaten da
 * sind.
 */
function ensureCommentsFromMarkers(pageEl) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !pageEl) return;

  if (!nb.comments) nb.comments = [];

  const markers = pageEl.querySelectorAll('.j-comment-marker[data-cid]');
  markers.forEach(m => {
    const cid = m.dataset.cid;
    if (!nb.comments.some(c => String(c.id) === cid)) {
      nb.comments.push({
        id: cid,
        pageId: pageEl.dataset.pgid || '',
        text: '',
        author: { uid: '', name: 'Unbekannt' },
        created: Date.now(),
        resolved: false,
        replies: []
      });
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════
   KOMMENTAR-SYNCHRONISATION (LIVE)

   Wenn eine Seite von einem anderen Bearbeiter kommt oder über Firestore
   geladen wird, können darin Marken stecken, deren Kommentardaten noch
   nicht im Heft sind. ensureCommentsFromMarkers() füllt die Lücken.

   Die eigentliche Übertragung läuft über den Text-Kanal (Yjs/Firestore):
   die Marken sind Teil des HTML-Texts der Seite und reisen mit ihm mit.
   Die Kommentardaten (nb.comments) reisen mit dem Heft beim Speichern.

   Für Echtzeit: Änderungen an nb.comments[] melden wir über den
   normalen Heft-Sync (save → Firestore → andere laden nach).
   ══════════════════════════════════════════════════════════════════════ */
