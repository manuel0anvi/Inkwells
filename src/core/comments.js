'use strict';

/* ══════════════════════════════════════════════════════════════════════
   KOMMENTARE

   Anmerkungen zu einer Stelle im Text, wie in Word: die kommentierte
   Stelle ist farbig unterlegt, die Karte steht rechts daneben.

   Kommentare leben in nb.comments[] und gehen mit dem Heft überall hin –
   örtlich, in die Cloud und zu anderen Bearbeitern.

   >>> Warum im Heft und nicht in Firestore <<<
   Ein Heft ohne Cloud hat keinen Firestore. Der Kommentar soll trotzdem
   da sein und mit der Datei weitergegeben werden können.

   >>> Warum die Stelle im HTML steht und nicht als Zahl <<<
   Ein Kommentar hängt an einer Textstelle, und die verschiebt sich, sobald
   jemand davor schreibt. Eine gemerkte Zeichenzahl wäre nach der ersten
   fremden Änderung falsch. Deshalb wird der kommentierte Text in ein
   <span class="j-comment-mark" data-cid="…"> gefasst: es reist im Text
   mit, durch Yjs wie durch die Datei, und sitzt immer an der richtigen
   Stelle – auch wenn davor ein ganzer Absatz dazukommt.

   core/sanitize.js lässt genau diese Klasse und dieses Attribut durch.
   ══════════════════════════════════════════════════════════════════════ */

/** Wer schreibt? Name und Kennung des angemeldeten Nutzers. */
function getCommentAuthor() {
  let kennung = 'local';
  let name = '';

  /* Die Anmeldung liegt in CloudSync_ (klassisches Global, überall da).
     core/share.js hätte die schöneren Angaben, ist aber ein ES-Modul und
     aus einem klassischen Skript nicht synchron erreichbar. */
  try {
    if (window.CloudSync_ && typeof CloudSync_.getSession === 'function') {
      const s = CloudSync_.getSession();
      if (s && s.userEmail) {
        kennung = s.userEmail;
        name = String(s.userName || s.userEmail).split('@')[0];
      }
    }
  } catch (e) { /* nicht angemeldet – dann eben örtlich */ }

  if (!name && typeof Settings !== 'undefined' && Settings.get) {
    const mail = Settings.get('cloudEmail');
    if (mail) { kennung = mail; name = String(mail).split('@')[0]; }
  }

  return { uid: kennung, name: name || (typeof t === 'function' ? t('commentMe') : 'Ich') };
}

/** Gehört dieser Kommentar mir? Nur dann darf ich ihn löschen. */
function istMeinKommentar(c) {
  if (!c || !c.author) return false;
  const ich = getCommentAuthor();
  // Örtliche Hefte: alles gehört dem, der davorsitzt
  if (ich.uid === 'local' && c.author.uid === 'local') return true;
  return String(c.author.uid) === String(ich.uid);
}

/**
 * Einen neuen Kommentar anlegen.
 *
 * @param {string} pageId  Seite, zu der der Kommentar gehört
 * @param {string} text    der Kommentartext
 * @param {string} zitat   der kommentierte Textausschnitt (für die Karte)
 * @returns {object|null}  der neue Kommentar
 */
function addComment(pageId, text, zitat) {
  if (!pageId || !text) return null;

  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb) return null;

  const comment = {
    id: uid(),
    pageId: String(pageId),
    text: String(text),
    zitat: String(zitat || '').slice(0, 160),
    author: getCommentAuthor(),
    created: Date.now(),
    resolved: false,
    replies: []
  };

  if (!nb.comments) nb.comments = [];
  nb.comments.push(comment);

  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  return comment;
}

/** Die Kommentare einer Seite, nach Erstellungszeit. */
function getPageComments(pageId) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !nb.comments) return [];
  return nb.comments
    .filter(c => String(c.pageId) === String(pageId))
    .sort((a, b) => (a.created || 0) - (b.created || 0));
}

/** Anzahl der unerledigten Kommentare einer Seite. */
function unresolvedCommentCount(pageId) {
  return getPageComments(pageId).filter(c => !c.resolved).length;
}

/**
 * Den ausgewählten Text als kommentiert markieren.
 *
 * Legt ein <span class="j-comment-mark" data-cid="…"> um die Auswahl.
 * Gibt den Text zurück, der markiert wurde – oder null.
 */
function markSelection(commentId) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;

  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;

  const textDiv = bereichsFeld(range);
  if (!textDiv) return null;

  const zitat = range.toString();
  if (!zitat.trim()) return null;

  const mark = document.createElement('span');
  mark.className = 'j-comment-mark';
  mark.dataset.cid = String(commentId);

  try {
    /* surroundContents scheitert, sobald die Auswahl über eine
       Elementgrenze läuft („teilweise enthaltener Knoten"). Das ist der
       Normalfall, sobald jemand über ein fettes Wort hinweg markiert –
       deshalb der Umweg über extractContents. */
    range.surroundContents(mark);
  } catch (e) {
    const inhalt = range.extractContents();
    mark.appendChild(inhalt);
    range.insertNode(mark);
  }

  // Auswahl aufheben, sonst bleibt der blaue Balken über der Markierung
  sel.removeAllRanges();

  notiereKommentarText(textDiv);
  return zitat;
}

/** Das .j-text, in dem eine Auswahl liegt – oder null. */
function bereichsFeld(range) {
  let knoten = range.commonAncestorContainer;
  if (knoten.nodeType === Node.TEXT_NODE) knoten = knoten.parentNode;
  if (!knoten || typeof knoten.closest !== 'function') return null;
  return knoten.closest('.j-text');
}

/** Eine Änderung an den Marken ist eine Änderung des Seitentexts. */
function notiereKommentarText(textDiv) {
  if (!textDiv || !textDiv.isConnected) return;
  const pgEl = textDiv.closest('[data-pgid]');
  const info = pgEl && typeof getPage === 'function' ? getPage(pgEl.dataset.pgid) : null;
  if (!info) return;

  info.page.textContent = textDiv.innerHTML;
  if (window.Collab && typeof Collab.noteTextChange === 'function') {
    Collab.noteTextChange(info.page.id, info.page.textContent);
  }
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/** Kommentar erledigen oder wieder öffnen. */
function toggleCommentResolved(commentId) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !nb.comments) return;

  const c = nb.comments.find(x => String(x.id) === String(commentId));
  if (!c) return;
  c.resolved = !c.resolved;
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/** Auf einen Kommentar antworten. */
function replyToComment(commentId, text) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !nb.comments || !text) return null;

  const c = nb.comments.find(x => String(x.id) === String(commentId));
  if (!c) return null;

  const reply = {
    id: uid(),
    text: String(text),
    author: getCommentAuthor(),
    created: Date.now()
  };

  if (!c.replies) c.replies = [];
  c.replies.push(reply);
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  return reply;
}

/**
 * Kommentar löschen – samt Markierung im Text.
 *
 * Nur der Verfasser darf das. Ohne die Prüfung könnte in einem geteilten
 * Heft jeder die Anmerkungen der anderen wegräumen.
 */
function deleteComment(commentId) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !nb.comments) return false;

  const c = nb.comments.find(x => String(x.id) === String(commentId));
  if (!c) return false;
  if (!istMeinKommentar(c)) {
    if (typeof toast === 'function') {
      toast((typeof t === 'function' && t('commentNotMine')) || 'Das ist nicht dein Kommentar.', true);
    }
    return false;
  }

  nb.comments = nb.comments.filter(x => String(x.id) !== String(commentId));
  entferneMarke(commentId);
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  return true;
}

/** Die Markierung aus dem Text nehmen, den Text selbst behalten. */
function entferneMarke(commentId) {
  const wahl = '.j-comment-mark[data-cid="' + CSS.escape(String(commentId)) + '"]';
  document.querySelectorAll(wahl).forEach(mark => {
    const textDiv = mark.closest('.j-text');
    // Auspacken: der Inhalt rückt an die Stelle des Spans
    const eltern = mark.parentNode;
    while (mark.firstChild) eltern.insertBefore(mark.firstChild, mark);
    mark.remove();
    if (eltern.normalize) eltern.normalize();
    notiereKommentarText(textDiv);
  });
}

/**
 * Markierungen im HTML wiederfinden, deren Kommentar noch fehlt.
 *
 * Das kommt vor, wenn der Text eines anderen Bearbeiters ankommt, bevor
 * das Heft mit seinen Kommentardaten da ist.
 */
function ensureCommentsFromMarkers(pageEl) {
  const nb = typeof getNb === 'function' ? getNb() : null;
  if (!nb || !pageEl) return;
  if (!nb.comments) nb.comments = [];

  pageEl.querySelectorAll('.j-comment-mark[data-cid]').forEach(mark => {
    const cid = mark.dataset.cid;
    if (nb.comments.some(c => String(c.id) === cid)) return;
    nb.comments.push({
      id: cid,
      pageId: pageEl.dataset.pgid || '',
      text: '',
      zitat: (mark.textContent || '').slice(0, 160),
      author: { uid: '', name: (typeof t === 'function' && t('commentUnknown')) || 'Unbekannt' },
      created: Date.now(),
      resolved: false,
      replies: []
    });
  });
}
