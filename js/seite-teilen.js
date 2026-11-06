/* Öffentliche Leseansicht eines freigegebenen Hefts.

   Bewusst ohne js/common.js, js/config.js und js/providers.js: hier wird
   nichts angemeldet und nichts aus Drive bzw. OneDrive geholt. Die Seite
   liest ausschließlich die Kopie aus Firestore. */

const viewerPages = document.getElementById('viewer-pages');
let sharedNotebook = null;

function whenShareReady() {
  if (window.InkwellsShare) return Promise.resolve(window.InkwellsShare);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('SHARE_OFFLINE')),
      15000
    );
    document.addEventListener('inkwells-share-ready', () => {
      clearTimeout(timer);
      if (window.InkwellsShare) resolve(window.InkwellsShare);
      else reject(new Error('SHARE_OFFLINE'));
    }, { once: true });
  });
}

function showError(titleKey, textKey) {
  document.getElementById('share-loading').style.display = 'none';
  document.getElementById('share-view').style.display = 'none';

  const box = document.getElementById('share-error');
  const title = document.getElementById('share-error-title');
  const text = document.getElementById('share-error-text');
  title.setAttribute('data-i18n', titleKey);
  text.setAttribute('data-i18n', textKey);
  title.textContent = t(titleKey);
  text.textContent = t(textKey);
  box.style.display = 'block';
}

function renderShared(notebook, meta) {
  document.getElementById('share-loading').style.display = 'none';
  document.getElementById('share-error').style.display = 'none';
  document.getElementById('share-view').style.display = 'block';

  const title = notebook.name || meta.title || 'Notizbuch';
  document.getElementById('share-title').textContent = title;
  document.title = `${title} — Inkwells`;

  const pages = getNotebookPages(notebook);
  const pageLabel = pages.length === 1 ? t('page') : t('pages');
  const parts = [`${pages.length} ${pageLabel}`];
  if (meta.updatedAt) parts.push(tf('share_updated', { date: fmtDate(meta.updatedAt.toISOString()) }));
  document.getElementById('share-meta').textContent = parts.join(' · ');

  viewerPages.innerHTML = '';
  pageScalers.length = 0;

  if (!pages.length) {
    const empty = document.createElement('div');
    empty.className = 'share-state';
    empty.textContent = t('share_empty');
    viewerPages.appendChild(empty);
    return;
  }

  // Die ersten Seiten sofort, der Rest beim Hinscrollen (js/viewer.js)
  renderPagesLazy(notebook, pages, viewerPages);
  zeigeAbschnitte(notebook, pages, document.getElementById('viewer-abschnitte'), (sichtbar, gesamt) => {
    parts[0] = sichtbar === gesamt ? `${gesamt} ${gesamt === 1 ? t('page') : t('pages')}`
      : tf('view_pages_of', { n: sichtbar, total: gesamt });
    document.getElementById('share-meta').textContent = parts.join(' · ');
  });
}

/* Export: identisch zum Dashboard (js/export-ui.js). PDF läuft über den
   Druckdialog des Browsers, Word über js/docx.js. */
document.getElementById('share-pdf').addEventListener('click', () => {
  if (sharedNotebook) InkwellsExport.open(sharedNotebook);
});

if (typeof addLangChangeListener === 'function') {
  addLangChangeListener(() => {
    if (sharedNotebook) renderShared(sharedNotebook, window.__shareMeta || {});
  });
}

/* ── Ein geteiltes Dokument (?d=<linkId>) ──────────────────────────────
   Neben der alten, eingefrorenen Lesekopie (?id=<shareId>) gibt es seit
   den geteilten Dokumenten den Weg über eine Link-Kennung. Der Ablauf:

     1. Link-Kennung nachschlagen -> Dokumentkennung
     2. Ist ein Konto angemeldet, trägt es sich selbst ein. Danach steht
        das Dokument im Tab „Geteilte Dokumente" und der Link wird nicht
        mehr gebraucht.
     3. Anzeigen – immer schreibgeschützt. Bearbeitet wird nur in der App.
   ─────────────────────────────────────────────────────────────────── */
/* ── Mitbekommen, wenn sich etwas ändert ──────────────────────────────
   Bearbeitet wird nur in der App – gelesen wird aber hier, und wer
   zusieht, während drüben jemand schreibt, soll das auch sehen. Beobachtet
   wird nur der KOPF; erst wenn die laufende Nummer steigt, wird der Inhalt
   neu geholt.

   Der Abstand von fünf Sekunden ist keine Bequemlichkeit: das Neuladen
   holt Seiten, Handschrift und Bilder: im kostenlosen Firebase-Plan sind
   50.000 Lesevorgänge am Tag für das ganze Projekt vorgesehen. Die App
   speichert alle vier Sekunden, ein ungebremster Betrachter läge also bei
   einem vollen Neuladen im selben Takt.
   ─────────────────────────────────────────────────────────────────── */
let watchStop = null;

function watchForChanges(api, docId, knownRevision) {
  if (watchStop) { watchStop(); watchStop = null; }

  const MIN_GAP_MS = 5000;
  let lastAt = Date.now();
  let seen = knownRevision || 0;
  let pending = null;
  let busy = false;

  const refresh = async () => {
    if (busy) return;
    busy = true;
    try {
      const { notebook, head } = await api.loadDocument(docId);
      const next = normalizeNotebookRecord(notebook);
      if (!next) return;
      sharedNotebook = next;
      window.__shareMeta = { title: head.title, mode: head.linkMode, updatedAt: head.updatedAt };
      renderShared(sharedNotebook, window.__shareMeta);
      lastAt = Date.now();
    } catch (err) {
      console.warn('[Share] Neu laden fehlgeschlagen:', err?.message || err);
    } finally {
      busy = false;
    }
  };

  watchStop = api.watchDocument(docId, (head) => {
    if (!head || !head.revision || head.revision <= seen) return;
    seen = head.revision;

    clearTimeout(pending);
    pending = setTimeout(refresh, Math.max(0, MIN_GAP_MS - (Date.now() - lastAt)));
  });
}

async function openSharedDocument(api, linkId) {
  const { docId } = await api.resolveLink(linkId);
  if (!docId) throw new Error('SHARE_NOT_FOUND');

  // Angemeldet? Dann selbst eintragen. Ohne Konto wird nur gelesen.
  let joined = 'anonymous';
  try {
    await api.whenIdentityReady();
    joined = await api.joinViaLink(docId);
  } catch (err) {
    console.warn('[Share] Selbsteintrag übersprungen:', err?.message || err);
  }
  if (joined === 'blocked') { showError('share_blocked_title', 'share_blocked_text'); return; }

  const { notebook, head } = await api.loadDocument(docId);
  sharedNotebook = normalizeNotebookRecord(notebook);
  if (!sharedNotebook) { showError('share_broken_title', 'share_broken_text'); return; }

  window.__shareMeta = { title: head.title, mode: head.linkMode, updatedAt: head.updatedAt };
  renderShared(sharedNotebook, window.__shareMeta);

  // „In Inkwells öffnen" führt über das Protokoll inkwells://share/<linkId>.
  // Der Browser fragt dann selbst, ob die App gestartet werden soll.
  const openApp = document.getElementById('share-open-app');
  if (openApp) {
    openApp.href = api.appUrlFor(linkId);
    openApp.style.display = 'inline-flex';
  }

  // Ab jetzt bei jeder Änderung neu zeichnen
  watchForChanges(api, docId, head.revision);

  const me = api.currentIdentity();
  const role = head.roleFor(me?.email || '');
  const badge = document.getElementById('share-role-badge');
  const hint = document.getElementById('share-edit-hint');

  if (role === 'edit') {
    // Auf der Website bleibt es trotzdem beim Lesen – so ist es entschieden.
    if (badge) { badge.textContent = t('share_may_edit'); badge.removeAttribute('data-i18n'); }
    if (hint) { hint.textContent = t('share_edit_in_app'); hint.style.display = 'block'; }
  } else if (joined === 'joined' && hint) {
    hint.textContent = t('share_added_to_tab');
    hint.style.display = 'block';
  }
}

(async () => {
  const params = new URLSearchParams(window.location.search);
  const linkId = params.get('d');
  const shareId = params.get('id');

  if (!linkId && !shareId) {
    showError('share_missing_title', 'share_missing_text');
    return;
  }

  try {
    const api = await whenShareReady();

    if (linkId) {
      await openSharedDocument(api, linkId);
      return;
    }

    const { notebook, title, mode, updatedAt } = await api.loadSharedNotebook(shareId);

    sharedNotebook = normalizeNotebookRecord(notebook);
    window.__shareMeta = { title, mode, updatedAt };

    if (!sharedNotebook) { showError('share_broken_title', 'share_broken_text'); return; }
    renderShared(sharedNotebook, window.__shareMeta);
  } catch (err) {
    console.error('[Share]', err);
    if (err.message === 'SHARE_OFFLINE') showError('share_offline_title', 'share_offline_text');
    else if (err.message === 'SHARE_BROKEN' || err.message === 'SHARE_EMPTY') showError('share_broken_title', 'share_broken_text');
    else showError('share_gone_title', 'share_gone_text');
  }
})();
