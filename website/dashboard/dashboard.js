/* ══════════════════════════════════════════════════════════════════════
   Dashboard: liest die Notizbücher aus der Cloud (Google Drive oder
   OneDrive, siehe js/providers.js) und stellt sie
   exakt so dar wie die Desktop-App.

   Die Render-Logik ist eine Portierung von:
     src/ui/homeGrid.js      -> renderNotebookCards()
     src/app.js              -> buildPageElement()   (appendPageDOM)
     src/canvas/drawing.js   -> redrawStrokes()/drawStroke()
     src/core/state.js       -> CFG / BG_STYLE
   ══════════════════════════════════════════════════════════════════════ */


/* ── Auth-Guard ───────────────────────────────────────────────────── */

let session = null;

/* Zurück zur Anmeldung. Wer schon einmal angemeldet war (gemerkte E-Mail),
   ist nicht "nicht angemeldet", sondern wurde abgemeldet – die Startseite
   sagt das dann auch, statt wortlos das Login-Fenster zu zeigen. */
function redirectToLogin() {
  const wasSignedIn = typeof getRememberedEmail === 'function' && !!getRememberedEmail();
  window.location.replace('../?login=true' + (wasSignedIn ? '&expired=1' : ''));
}

// Beim Öffnen erst eine stille Erneuerung versuchen, bevor zur
// Anmeldeseite geschickt wird – sonst landet man nach einer Stunde
// Pause grundlos wieder beim Login.
async function checkAuth() {
  session = await ensureFreshToken();
  if (!session) {
    redirectToLogin();
    return false;
  }
  return true;
}

async function requireSession() {
  session = await ensureFreshToken();
  if (!session) {
    redirectToLogin();
    clearInkwellSession();
    return false;
  }
  return true;
}

const webappDashboard = document.getElementById('webapp-dashboard');
const webappViewer = document.getElementById('webapp-viewer');
const viewerPages = document.getElementById('viewer-pages');
const viewerPageCountTop = document.getElementById('viewer-page-num-top');

if (typeof addLangChangeListener === 'function') {
  addLangChangeListener(() => {
    if (session) showDashboard();
  });
}


function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}


/* ── Cloud-Zugriff ────────────────────────────────────────────────── */

/** Ruft die Cloud auf – anbieter-unabhängig, mit Token-Erneuerung. */
async function cloudFetch(url) {
  // Läuft das Token bald ab, wird es vorher still erneuert (siehe common.js).
  let current = await ensureFreshToken();
  if (!current) throw new Error('SESSION_EXPIRED');

  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${current.accessToken}` }
  });

  // 401 trotz gültig geglaubtem Token: einmal erzwungen erneuern, dann aufgeben
  if (res.status === 401) {
    current = await ensureFreshToken(Infinity);
    if (current) {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${current.accessToken}` }
      });
    }
  }

  if (res.status === 401) {
    clearInkwellSession();
    throw new Error('SESSION_EXPIRED');
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || body?.error_description || '';
    } catch (e) { /* nicht-JSON Antwort */ }
    throw new Error(`${getActiveProvider().label} Fehler ${res.status}${detail ? ': ' + detail : ''}`);
  }

  return res;
}

/** Wie cloudFetch, gibt aber direkt das ausgewertete JSON zurück. */
async function cloudJson(url) {
  const res = await cloudFetch(url);
  return res.json();
}

// Speicherbelegung des Kontos. Liefert null, wenn der Anbieter die
// Auskunft verweigert – dann wird die Anzeige einfach ausgeblendet.
async function loadCloudQuota() {
  try {
    return await getActiveProvider().getQuota(cloudJson);
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') throw err;
    console.warn('Speicherinfo nicht verfügbar:', err.message);
    return null;
  }
}

function renderStorageBar(quota, ownBytes) {
  const box = document.getElementById('storage-info');
  const text = document.getElementById('storage-text');
  const bar = document.getElementById('storage-bar');
  const track = document.getElementById('storage-track');
  const own = document.getElementById('storage-own');
  if (!box) return;

  box.style.display = 'block';
  own.textContent = `${t('dash_storage_own')}: ${formatBytes(ownBytes)}`;

  if (!quota || quota.usage == null) {
    text.textContent = t('dash_storage_unavailable');
    track.style.display = 'none';
    return;
  }

  track.style.display = 'block';

  if (quota.limit == null) {
    text.textContent = `${formatBytes(quota.usage)} ${t('dash_storage_unlimited')}`;
    bar.style.width = '0%';
    return;
  }

  const percent = Math.min(100, (quota.usage / quota.limit) * 100);
  text.textContent = `${formatBytes(quota.usage)} / ${formatBytes(quota.limit)} `
    + `· ${t('dash_storage_free')}: ${formatBytes(quota.free)}`;
  bar.style.width = `${percent}%`;
  bar.style.background = percent > 90 ? '#d9534f' : percent > 75 ? '#e0a63a' : 'var(--gold)';
}

async function loadNotebooksFromCloud() {
  const provider = getActiveProvider();
  const folders = await provider.findFolders(cloudJson);

  if (!folders.length) return { notebooks: [], folderFound: false, ownBytes: 0 };

  const notebooks = [];
  const seenIds = new Set();
  let ownBytes = 0;

  // Bewusst über ALLE gefundenen Ordner: falls durch den früheren Fehler
  // zwei "Inkwell"-Ordner existieren, werden trotzdem alle Hefte gefunden.
  // Doppelte IDs werden dabei übersprungen.
  for (const folderId of folders) {
    const files = await provider.listNotebookFiles(cloudJson, folderId);

    for (const file of files) {
      try {
        const json = await cloudJson(provider.downloadUrl(file.id));
        const notebook = normalizeNotebookRecord({
          ...file,
          modifiedTime: file.modifiedTime,
          notebook_json: json
        });
        if (!notebook) continue;

        notebook.id = notebook.id || file.inkwellId || file.id;
        if (seenIds.has(notebook.id)) continue;

        seenIds.add(notebook.id);
        ownBytes += file.size || 0;
        notebooks.push(notebook);
      } catch (err) {
        if (err.message === 'SESSION_EXPIRED') throw err;
        console.warn('Notizbuch konnte nicht gelesen werden:', file.name, err);
      }
    }
  }

  return { notebooks, folderFound: true, ownBytes };
}

/* ── Übersicht ────────────────────────────────────────────────────── */

let allNotebooks = [];

async function showDashboard() {
  webappViewer.style.display = 'none';
  webappDashboard.style.display = 'block';

  const grid = document.getElementById('dashboard-grid');
  grid.innerHTML = `<p style="color:var(--text-muted)">${t('dash_loading') || 'Lade Notizbücher…'}</p>`;

  if (!await requireSession()) return;

  const driveLabel = document.getElementById('drive-connected-label');
  if (driveLabel) driveLabel.textContent = getActiveProvider().label;

  try {
    const { notebooks, folderFound, ownBytes } = await loadNotebooksFromCloud();
    allNotebooks = notebooks;

    // Erst einmal die normale Übersicht herstellen. Die frühen Ausstiege
    // weiter unten (kein Ordner / keine Hefte) müssen sonst nicht wissen,
    // dass die Suche das Raster ausgeblendet haben könnte.
    renderSearchResults(null);

    const quota = await loadCloudQuota();
    renderStorageBar(quota, ownBytes);

    const now = new Date();
    const locale = lang === 'de' ? 'de-DE' : lang === 'it' ? 'it-IT' : 'en-GB';
    const datetimeStr = `${now.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })} `
      + `${now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    document.getElementById('last-sync-time').innerHTML =
      tf('dash_last_sync', { datetime: datetimeStr }) + ' &bull; ' + getActiveProvider().label;

    if (!folderFound) {
      grid.innerHTML = `<p style="color:var(--text-muted); padding:20px;">${
        (t('dash_cloud_empty') || 'Noch kein Inkwell-Ordner in {provider}. Melde dich in der App mit demselben Konto an und aktiviere die Cloud-Sicherung.').replace('{provider}', getActiveProvider().label)
      }</p>`;
      return;
    }

    if (!notebooks.length) {
      grid.innerHTML = `<p style="color:var(--text-muted)">${t('dash_empty') || 'Keine Notizbücher gefunden.'}</p>`;
      return;
    }

    renderNotebookCards(notebooks, grid);

    // Nach einem Neuladen (etwa Sprachwechsel) die laufende Suche mit den
    // frischen Heften wiederholen, statt veraltete Treffer stehen zu lassen.
    const searchInput = document.getElementById('dash-search-input');
    if (isDashboardSearchActive() && searchInput) {
      renderSearchResults(runSearch(searchInput.value));
    }

    openNotebookFromUrl();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') {
      redirectToLogin();
      return;
    }
    grid.innerHTML = `<p style="color:#d9534f">${t('dash_err') || 'Fehler:'} ${err.message}</p>`;
  }
}

/* Portierung von src/ui/homeGrid.js: renderHomeGrid() */
function renderNotebookCards(notebooks, grid) {
  grid.innerHTML = '';

  for (const nb of notebooks) {
    const pageCount = getNotebookPages(nb).length;
    const pageLabel = pageCount !== 1 ? (t('pages') || 'Seiten') : (t('page') || 'Seite');

    const card = document.createElement('div');
    card.className = 'nb-card';
    card.style.setProperty('--nb-color', nb.color);

    const spine = document.createElement('div');
    spine.className = 'nb-card-spine';
    spine.style.background = nb.color;

    const body = document.createElement('div');
    body.className = 'nb-card-body';

    const name = document.createElement('div');
    name.className = 'nb-card-name';
    name.textContent = nb.name;

    const bgPreview = document.createElement('div');
    bgPreview.className = 'nb-card-bg';
    bgPreview.style.cssText = BG_STYLE[nb.defaultBg] || BG_STYLE.ruled;

    const meta = document.createElement('div');
    meta.className = 'nb-card-meta';
    meta.textContent = `${pageCount} ${pageLabel}`;

    body.append(name, bgPreview, meta);
    card.append(spine, body);

    card.addEventListener('click', () => renderNotebook(nb));
    grid.appendChild(card);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   VOLLTEXTSUCHE ÜBER ALLE HEFTE

   Portierung von src/ui/search.js. Gleiches Verhalten wie in der App:
   gesucht wird in Heftnamen, Abschnittsnamen und im Text aller Seiten,
   ein Klick auf einen Treffer öffnet das Heft an der richtigen Stelle.

   Gesucht wird ausschließlich im Browser – die Hefte liegen nach dem
   Laden ohnehin schon vollständig in allNotebooks. Es geht also keine
   einzige zusätzliche Anfrage an Drive bzw. OneDrive.
   ══════════════════════════════════════════════════════════════════════ */

const SEARCH_MAX_RESULTS = 60;
let searchDebounceTimer = null;

// Seitentext ist HTML (contenteditable). Für die Suche wird daraus
// Fließtext gemacht – Blockenden werden zu Leerzeichen, damit nicht
// "ZeileEins" und "ZeileZwei" zu einem Wort verschmelzen.
function searchPlainTextOf(page) {
  return (page.textContent || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Textausschnitt um den Treffer herum, damit man ihn im Zusammenhang sieht
function searchMakeSnippet(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text.slice(0, 120);

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 60);
  return (start > 0 ? '… ' : '') + text.slice(start, end) + (end < text.length ? ' …' : '');
}

function searchEscape(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function searchHighlight(snippet, query) {
  const idx = snippet.toLowerCase().indexOf(query);
  if (idx === -1) return searchEscape(snippet);

  return searchEscape(snippet.slice(0, idx))
    + '<mark>' + searchEscape(snippet.slice(idx, idx + query.length)) + '</mark>'
    + searchEscape(snippet.slice(idx + query.length));
}

/** Abschnitt, in dem eine Seite liegt – kennt beide Ablageformen. */
function searchSectionOf(notebook, page) {
  const sections = Array.isArray(notebook.sections) ? notebook.sections : [];
  return sections.find(sec =>
    (Array.isArray(sec.pgIds) && sec.pgIds.includes(page.id))
    || (Array.isArray(sec.pages) && sec.pages.some(p => p && p.id === page.id))
  ) || null;
}

function runSearch(rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return null;

  const hits = [];

  for (const nb of allNotebooks) {
    if (nb.name && nb.name.toLowerCase().includes(query)) {
      hits.push({ kind: 'notebook', nb, label: nb.name });
    }

    const sections = Array.isArray(nb.sections) ? nb.sections : [];
    for (const sec of sections) {
      if (sec.name && sec.name.toLowerCase().includes(query)) {
        hits.push({ kind: 'section', nb, sec, label: sec.name });
      }
    }

    // Dieselbe Reihenfolge wie im Betrachter, damit die angezeigte
    // Seitenzahl zu der in der Kopfzeile der Seite passt.
    const pages = getNotebookPages(nb);
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const text = searchPlainTextOf(page);
      if (!text || !text.toLowerCase().includes(query)) continue;

      hits.push({
        kind: 'page',
        nb,
        sec: searchSectionOf(nb, page),
        page,
        pageNo: i + 1,
        snippet: searchMakeSnippet(text, query)
      });

      if (hits.length >= SEARCH_MAX_RESULTS) break;
    }

    if (hits.length >= SEARCH_MAX_RESULTS) break;
  }

  return { query, hits };
}

function renderSearchResults(result) {
  const grid = document.getElementById('dashboard-grid');
  const results = document.getElementById('dashboard-search-results');
  if (!grid || !results) return;

  // Keine Suche aktiv: zurück zur normalen Übersicht
  if (!result) {
    results.style.display = 'none';
    results.innerHTML = '';
    grid.style.display = '';
    return;
  }

  grid.style.display = 'none';
  results.style.display = 'block';
  results.innerHTML = '';

  if (!result.hits.length) {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    empty.textContent = tf('dash_search_none', { q: result.query });
    results.appendChild(empty);
    return;
  }

  const head = document.createElement('div');
  head.className = 'search-count';
  head.textContent = result.hits.length >= SEARCH_MAX_RESULTS
    ? tf('dash_search_many', { n: SEARCH_MAX_RESULTS })
    : tf('dash_search_results', { n: result.hits.length });
  results.appendChild(head);

  for (const hit of result.hits) {
    const row = document.createElement('button');
    row.className = 'search-hit';
    row.type = 'button';

    const dot = document.createElement('span');
    dot.className = 'search-hit-dot';
    dot.style.background = hit.nb.color || 'var(--gold)';
    row.appendChild(dot);

    const body = document.createElement('span');
    body.className = 'search-hit-body';

    const title = document.createElement('span');
    title.className = 'search-hit-title';

    if (hit.kind === 'page') {
      title.textContent = `${hit.nb.name} · ${hit.sec ? hit.sec.name + ' · ' : ''}${t('page')} ${hit.pageNo}`;
      const snip = document.createElement('span');
      snip.className = 'search-hit-snippet';
      snip.innerHTML = searchHighlight(hit.snippet, result.query);
      body.append(title, snip);
    } else {
      title.textContent = hit.label;
      const kind = document.createElement('span');
      kind.className = 'search-hit-snippet';
      kind.textContent = hit.kind === 'notebook'
        ? t('dash_search_kind_notebook')
        : `${t('dash_search_kind_section')} · ${hit.nb.name}`;
      body.append(title, kind);
    }

    row.appendChild(body);
    row.addEventListener('click', () => openSearchHit(hit));
    results.appendChild(row);
  }
}

/** Öffnet das Heft und springt bei Seitentreffern zur Fundstelle. */
function openSearchHit(hit) {
  renderNotebook(hit.nb);

  if (hit.kind !== 'page' || !hit.page) return;

  // Erst nach dem Zeichnen scrollen – rescaleAllPages() läuft in einem
  // requestAnimationFrame, vorher stimmen die Höhen noch nicht.
  requestAnimationFrame(() => {
    setTimeout(() => {
      const pageEl = viewerPages.querySelector(`[data-pgid="${cssEscape(hit.page.id)}"]`);
      const target = pageEl ? (pageEl.closest('.j-page-scaler') || pageEl) : null;
      if (!target) return;

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('search-target');
      setTimeout(() => target.classList.remove('search-target'), 1800);
    }, 120);
  });
}

// Seiten-IDs stammen aus fremden Dateien und dürfen nicht ungeprüft in
// einen Selektor wandern. CSS.escape gibt es überall dort, wo diese Seite
// läuft; der Rückfall ist nur die Vorsicht für sehr alte Browser.
function cssEscape(value) {
  const text = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
  return text.replace(/["\\\]\[]/g, '\\$&');
}

function resetDashboardSearch() {
  const input = document.getElementById('dash-search-input');
  const clearBtn = document.getElementById('dash-search-clear');
  if (input) input.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  renderSearchResults(null);
}

function isDashboardSearchActive() {
  const input = document.getElementById('dash-search-input');
  return !!(input && input.value.trim().length >= 2);
}

function initDashboardSearch() {
  const input = document.getElementById('dash-search-input');
  const clearBtn = document.getElementById('dash-search-clear');
  if (!input || !clearBtn) return;

  input.addEventListener('input', () => {
    clearBtn.style.display = input.value ? 'block' : 'none';
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => renderSearchResults(runSearch(input.value)), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      resetDashboardSearch();
      input.blur();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = document.querySelector('#dashboard-search-results .search-hit');
      if (first) first.click();
    }
  });

  clearBtn.addEventListener('click', () => { resetDashboardSearch(); input.focus(); });

  // Strg+F / Cmd+F springt ins Suchfeld – wie in der App
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      if (webappDashboard.style.display === 'none') return;   // im Betrachter die Browsersuche lassen
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

/* ── Seitenansicht ────────────────────────────────────────────────── */

let currentNotebook = null;


function renderNotebook(nb) {
  const notebook = normalizeNotebookRecord(nb);
  if (!notebook) return;

  currentNotebook = notebook;
  webappDashboard.style.display = 'none';
  webappViewer.style.display = 'block';
  window.scrollTo(0, 0);

  const viewerTitle = document.getElementById('viewer-title');
  viewerTitle.textContent = notebook.name || 'Untitled';
  viewerTitle.style.borderBottom = `3px solid ${notebook.color || 'var(--gold)'}`;
  viewerTitle.style.paddingBottom = '4px';
  viewerTitle.style.display = 'inline-block';

  // Adresszeile mitführen, damit der Teilen-Link zum offenen Heft passt
  const shareUrl = `${window.location.pathname}?nb=${encodeURIComponent(notebook.id)}`;
  history.replaceState({}, document.title, shareUrl);

  viewerPages.innerHTML = '';
  pageScalers.length = 0;

  const pages = getNotebookPages(notebook);
  const pageLabel = pages.length === 1 ? (t('page') || 'Seite') : (t('pages') || 'Seiten');
  viewerPageCountTop.textContent = `${pages.length} ${pageLabel}`;

  if (!pages.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'max-width:960px;width:100%;margin:0 auto;padding:36px 24px;border-radius:18px;'
      + 'background:rgba(255,255,255,0.08);color:var(--cream);text-align:center;font-family:"Jost",sans-serif;';
    empty.textContent = lang === 'en' ? 'This notebook has no pages.'
      : lang === 'it' ? 'Questo quaderno non ha pagine.'
      : 'Dieses Notizbuch hat keine Seiten.';
    viewerPages.appendChild(empty);
    return;
  }

  pages.forEach((page, index) => {
    try {
      const { pageEl, width, height } = buildPageElement(notebook, page, index);
      viewerPages.appendChild(wrapScaled(pageEl, width, height));
    } catch (error) {
      console.error('Viewer render error:', error);
    }
  });

  requestAnimationFrame(rescaleAllPages);
}

/* ── Bedienelemente ───────────────────────────────────────────────── */

document.getElementById('viewer-back').addEventListener('click', () => {
  webappViewer.style.display = 'none';
  webappDashboard.style.display = 'block';
  history.replaceState({}, document.title, window.location.pathname);
});

/* ── Export ───────────────────────────────────────────────────────────
   Format und Seitenumfang wählt js/export-ui.js; der PDF-Weg läuft
   weiterhin über den Druckdialog des Browsers (die Seiten liegen bereits
   exakt im A4-Verhältnis vor), der Word-Weg über js/docx.js.
   ─────────────────────────────────────────────────────────────────── */

document.getElementById('viewer-pdf').addEventListener('click', () => {
  if (currentNotebook) InkwellExport.open(currentNotebook);
});

/* ── Heft freigeben ───────────────────────────────────────────────────
   Der frühere Knopf kopierte nur "?nb=<id>" – ein Link, der ohne
   Anmeldung ins Leere lief und beim Empfänger nur funktionierte, wenn er
   ohnehin Zugriff auf die Drive-Datei hatte. Jetzt wird eine echte
   Lesekopie in Firestore veröffentlicht (js/share.js), die jeder mit dem
   Link ohne Konto ansehen kann.
   ─────────────────────────────────────────────────────────────────── */

// Merkt sich je Heft die zuletzt erzeugte Freigabe, damit „aktualisieren"
// und „aufheben" nach einem Seitenwechsel weiter funktionieren.
//   neu :  { [nbId]: { docId, linkId, url, linkMode } }
//   alt :  { [nbId]: { shareId, url, mode } }   – eingefrorene Lesekopie
const SHARE_STORE_KEY = 'inkwell_shares';

function loadShareRegistry() {
  try { return JSON.parse(localStorage.getItem(SHARE_STORE_KEY)) || {}; }
  catch (e) { return {}; }
}

function rememberShare(notebookId, entry) {
  const all = loadShareRegistry();
  if (entry) all[notebookId] = { ...(all[notebookId] || {}), ...entry };
  else delete all[notebookId];
  try { localStorage.setItem(SHARE_STORE_KEY, JSON.stringify(all)); } catch (e) {}
}

function forgetShare(notebookId, keys) {
  const all = loadShareRegistry();
  if (!all[notebookId]) return;
  for (const key of keys) delete all[notebookId][key];
  if (!Object.keys(all[notebookId]).length) delete all[notebookId];
  try { localStorage.setItem(SHARE_STORE_KEY, JSON.stringify(all)); } catch (e) {}
}

function shareFor(notebookId) {
  return loadShareRegistry()[notebookId] || null;
}

function whenShareReady() {
  if (window.InkwellShare) return Promise.resolve(window.InkwellShare);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SHARE_OFFLINE')), 15000);
    document.addEventListener('inkwell-share-ready', () => {
      clearTimeout(timer);
      if (window.InkwellShare) resolve(window.InkwellShare); else reject(new Error('SHARE_OFFLINE'));
    }, { once: true });
  });
}

function describeShareError(err) {
  const msg = err?.message || '';
  if (msg === 'SHARE_NOT_OWNED') return t('share_not_owned');
  if (msg === 'SHARE_OFFLINE') return t('share_offline');
  if (msg === 'NEEDS_ACCOUNT') return t('share_needs_account');
  if (msg === 'BAD_EMAIL') return t('share_bad_email');
  if (msg === 'OWN_EMAIL') return t('share_own_email');
  if (msg === 'SHARE_NOT_FOUND') return t('shared_gone');
  return tf('share_failed', { msg: msg || 'unbekannt' });
}

// Der zuletzt gelesene Kopf des offenen Dokuments
let shareHead = null;

function shareEl(id) { return document.getElementById(id); }

function selectedLinkMode() {
  const checked = document.querySelector('input[name="share-link-mode"]:checked');
  return checked ? checked.value : 'off';
}

function setLinkModeRadio(mode) {
  const radio = document.querySelector(`input[name="share-link-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
}

async function openShareDialog() {
  if (!currentNotebook) return;

  shareHead = null;
  const overlay = shareEl('share-overlay');
  const entry = shareFor(currentNotebook.id);

  shareEl('share-dlg-title').textContent = t('share_title');
  shareEl('share-dlg-intro').textContent = t('share_intro');
  shareEl('share-dlg-warning').textContent = t('share_warning');
  shareEl('share-dlg-status').textContent = '';
  shareEl('share-dlg-people').innerHTML = '';
  shareEl('share-dlg-link-row').style.display = 'none';
  shareEl('share-dlg-link').value = '';
  shareEl('share-dlg-revoke').style.display = 'none';
  shareEl('share-dlg-create').textContent = t('share_create');
  setLinkModeRadio(entry?.linkMode || 'off');

  overlay.style.display = 'flex';

  // Ohne echte Firebase-Kennung geht nichts davon.
  const me = await inkwellIdentityReady();
  const needs = shareEl('share-dlg-needs-account');
  needs.textContent = t('share_needs_account');
  needs.style.display = me ? 'none' : 'block';
  shareEl('share-dlg-link-section').style.display = me ? '' : 'none';
  shareEl('share-dlg-people-section').style.display = me ? '' : 'none';
  shareEl('share-dlg-create').disabled = !me;
  if (!me) return;

  if (entry?.docId) await loadShareHead(entry.docId);
}

async function loadShareHead(docId) {
  const status = shareEl('share-dlg-status');
  try {
    const api = await whenShareReady();
    shareHead = await api.loadDocumentHead(docId);
    renderShareHead();
  } catch (err) {
    if (err?.message === 'SHARE_NOT_FOUND') {
      shareHead = null;
      forgetShare(currentNotebook.id, ['docId', 'linkId', 'url', 'linkMode']);
      status.textContent = t('shared_gone');
      return;
    }
    status.textContent = describeShareError(err);
  }
}

function renderShareHead() {
  if (!shareHead) return;

  setLinkModeRadio(shareHead.linkMode);
  shareEl('share-dlg-create').textContent = t('share_update');
  shareEl('share-dlg-revoke').style.display = 'inline-block';
  shareEl('share-dlg-status').textContent = t('share_active');

  const linkRow = shareEl('share-dlg-link-row');
  const linkInput = shareEl('share-dlg-link');
  if (shareHead.linkMode !== 'off' && shareHead.linkId) {
    linkRow.style.display = 'flex';
    linkInput.value = window.InkwellShare.docUrlFor(shareHead.linkId);
  } else {
    linkRow.style.display = 'none';
    linkInput.value = '';
  }

  renderSharePeople();
}

function renderSharePeople() {
  const box = shareEl('share-dlg-people');
  box.innerHTML = '';
  if (!shareHead) return;

  const rows = window.InkwellShare.listMembers(shareHead);

  if (!rows.length && !shareHead.blockedEmails.length) {
    const empty = document.createElement('p');
    empty.className = 'share-people-empty';
    empty.textContent = t('share_people_empty');
    box.appendChild(empty);
    return;
  }

  for (const person of rows) {
    const row = document.createElement('div');
    row.className = 'share-person';

    const mail = document.createElement('span');
    mail.className = 'share-person-mail';
    mail.textContent = person.email;
    mail.title = person.email;

    const via = document.createElement('span');
    via.className = 'share-person-via';
    via.textContent = person.via === 'link' ? t('share_via_link') : t('share_via_invite');

    const select = document.createElement('select');
    for (const value of ['view', 'edit']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value === 'edit' ? t('role_edit') : t('role_view');
      if (person.role === value) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => changeShareRole(person.email, select.value));

    const remove = document.createElement('button');
    remove.className = 'share-person-remove';
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = t('share_remove_person');
    remove.addEventListener('click', () => removeSharePerson(person.email));

    row.append(mail, via, select, remove);
    box.appendChild(row);
  }

  // Gesperrte Adressen sichtbar machen, sonst wundert man sich, warum
  // jemand über den Link nicht mehr hereinkommt.
  for (const email of shareHead.blockedEmails) {
    const row = document.createElement('div');
    row.className = 'share-person blocked';

    const mail = document.createElement('span');
    mail.className = 'share-person-mail';
    mail.textContent = email;

    const via = document.createElement('span');
    via.className = 'share-person-via';
    via.textContent = t('share_blocked');

    const undo = document.createElement('button');
    undo.className = 'share-person-remove';
    undo.type = 'button';
    undo.textContent = '↺';
    undo.title = t('share_unblock');
    undo.addEventListener('click', () => unblockSharePerson(email));

    row.append(mail, via, undo);
    box.appendChild(row);
  }
}

function closeShareDialog() {
  document.getElementById('share-overlay').style.display = 'none';
  shareHead = null;
}

async function submitShare() {
  if (!currentNotebook) return;

  const btn = shareEl('share-dlg-create');
  const status = shareEl('share-dlg-status');
  const entry = shareFor(currentNotebook.id);

  btn.disabled = true;
  status.textContent = t('share_working');

  try {
    const api = await whenShareReady();
    const result = await api.shareDocument(currentNotebook, {
      docId: entry?.docId,
      linkMode: selectedLinkMode()
    });

    rememberShare(currentNotebook.id, {
      docId: result.docId,
      linkId: result.linkId,
      url: result.url,
      linkMode: result.linkMode
    });

    await loadShareHead(result.docId);
    status.textContent = entry?.docId ? t('share_updated_ok') : t('share_done');
  } catch (err) {
    console.error('[Share]', err);
    status.textContent = describeShareError(err);
  } finally {
    btn.disabled = false;
  }
}

/** Nur das Linkrecht umstellen, ohne den Inhalt neu hochzuladen. */
async function applyShareLinkMode() {
  if (!shareHead) return;
  const wanted = selectedLinkMode();
  if (wanted === shareHead.linkMode) return;

  try {
    const api = await whenShareReady();
    await api.setLinkMode(shareHead.docId, wanted);
    rememberShare(currentNotebook.id, { linkMode: wanted });
    await loadShareHead(shareHead.docId);
  } catch (err) {
    shareEl('share-dlg-status').textContent = describeShareError(err);
  }
}

async function renewShareLink() {
  if (!shareHead || !shareHead.linkId) return;
  if (!window.confirm(t('share_renew_confirm'))) return;

  try {
    const api = await whenShareReady();
    const result = await api.rotateLink(shareHead.docId);
    rememberShare(currentNotebook.id, { linkId: result.linkId, url: result.url });
    await loadShareHead(shareHead.docId);
    shareEl('share-dlg-status').textContent = t('share_renewed');
  } catch (err) {
    shareEl('share-dlg-status').textContent = describeShareError(err);
  }
}

async function addSharePerson() {
  const status = shareEl('share-dlg-status');
  if (!shareHead) { status.textContent = t('share_create_first'); return; }

  const input = shareEl('share-dlg-mail');
  const role = shareEl('share-dlg-role').value === 'edit' ? 'edit' : 'view';

  try {
    const api = await whenShareReady();
    await api.setMember(shareHead.docId, input.value, role);
    const mail = api.normalizeEmail(input.value);
    input.value = '';
    await loadShareHead(shareHead.docId);
    status.textContent = tf('share_invited', { mail });
  } catch (err) {
    status.textContent = describeShareError(err);
  }
}

async function changeShareRole(email, role) {
  if (!shareHead) return;
  try {
    const api = await whenShareReady();
    await api.setMember(shareHead.docId, email, role);
    await loadShareHead(shareHead.docId);
  } catch (err) {
    shareEl('share-dlg-status').textContent = describeShareError(err);
  }
}

async function removeSharePerson(email) {
  if (!shareHead) return;
  if (!window.confirm(tf('share_remove_confirm', { mail: email }))) return;
  try {
    const api = await whenShareReady();
    await api.removeMember(shareHead.docId, email);
    await loadShareHead(shareHead.docId);
    shareEl('share-dlg-status').textContent = tf('share_removed', { mail: email });
  } catch (err) {
    shareEl('share-dlg-status').textContent = describeShareError(err);
  }
}

async function unblockSharePerson(email) {
  if (!shareHead) return;
  try {
    const api = await whenShareReady();
    await api.unblockMember(shareHead.docId, email);
    await loadShareHead(shareHead.docId);
  } catch (err) {
    shareEl('share-dlg-status').textContent = describeShareError(err);
  }
}

async function revokeCurrentShare() {
  if (!currentNotebook || !shareHead) return;
  if (!window.confirm(t('share_revoke_confirm'))) return;

  const status = shareEl('share-dlg-status');
  try {
    const api = await whenShareReady();
    await api.unshareDocument(shareHead.docId);
    forgetShare(currentNotebook.id, ['docId', 'linkId', 'url', 'linkMode']);

    shareHead = null;
    shareEl('share-dlg-link-row').style.display = 'none';
    shareEl('share-dlg-link').value = '';
    shareEl('share-dlg-revoke').style.display = 'none';
    shareEl('share-dlg-create').textContent = t('share_create');
    shareEl('share-dlg-people').innerHTML = '';
    setLinkModeRadio('off');
    status.textContent = t('share_revoked');
  } catch (err) {
    console.error('[Share]', err);
    status.textContent = describeShareError(err);
  }
}

async function copyShareLink() {
  const input = document.getElementById('share-dlg-link');
  const btn = document.getElementById('share-dlg-copy');
  if (!input.value) return;

  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(input.value);
    btn.textContent = t('share_copied');
    setTimeout(() => { btn.textContent = original; }, 2000);
  } catch (err) {
    // Zwischenablage verweigert (z. B. ohne HTTPS) – dann von Hand kopieren
    input.select();
  }
}

document.getElementById('viewer-share').addEventListener('click', openShareDialog);
document.getElementById('share-dlg-close').addEventListener('click', closeShareDialog);
document.getElementById('share-dlg-create').addEventListener('click', submitShare);
document.getElementById('share-dlg-revoke').addEventListener('click', revokeCurrentShare);
document.getElementById('share-dlg-copy').addEventListener('click', copyShareLink);
document.getElementById('share-dlg-renew').addEventListener('click', renewShareLink);
document.getElementById('share-dlg-add').addEventListener('click', addSharePerson);
document.getElementById('share-dlg-mail').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addSharePerson(); }
});
document.querySelectorAll('input[name="share-link-mode"]').forEach(radio => {
  radio.addEventListener('change', applyShareLinkMode);
});
document.getElementById('share-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('share-overlay')) closeShareDialog();
});

/* ══════════════════════════════════════════════════════════════════════
   TAB „GETEILTE DOKUMENTE"

   Die Liste kommt aus genau EINER Abfrage in Firestore:
       where('memberEmails', 'array-contains', meineAdresse)
   Es gibt bewusst keine zweite Datenhaltung. Nimmt der Besitzer jemanden
   heraus, verschwindet das Dokument hier von selbst.

   Auf der Website bleibt ein geteiltes Dokument IMMER schreibgeschützt –
   auch mit Bearbeitungsrecht. Dafür steht dort ein Knopf, der es in der
   Inkwell-App öffnet.
   ══════════════════════════════════════════════════════════════════════ */

const SHARED_SEEN_KEY = 'inkwell_shared_seen_at';

let sharedDocs = [];
let unwatchShared = null;
let dashTab = 'own';

function sharedLastSeen() {
  return Number(localStorage.getItem(SHARED_SEEN_KEY) || 0);
}

function markSharedSeen() {
  try { localStorage.setItem(SHARED_SEEN_KEY, String(Date.now())); } catch (e) {}
  renderSharedBadge();
}

function newSharedDocs() {
  const since = sharedLastSeen();
  if (!since) return sharedDocs.slice();     // erster Besuch: alles ist neu
  return sharedDocs.filter(d => {
    const at = d.sharedAt || d.updatedAt;
    return at instanceof Date && at.getTime() > since;
  });
}

function renderSharedBadge() {
  const badge = document.getElementById('dash-shared-count');
  if (!badge) return;
  const count = newSharedDocs().length;
  badge.textContent = String(count);
  badge.style.display = count > 0 ? 'inline-block' : 'none';
}

function switchDashTab(which) {
  dashTab = which === 'shared' ? 'shared' : 'own';

  document.getElementById('dash-tab-own').classList.toggle('active', dashTab === 'own');
  document.getElementById('dash-tab-shared').classList.toggle('active', dashTab === 'shared');

  const ownVisible = dashTab === 'own';
  document.getElementById('dashboard-grid').style.display = ownVisible ? '' : 'none';
  document.querySelector('.dash-search').style.display = ownVisible ? '' : 'none';
  document.getElementById('dashboard-search-results').style.display = 'none';
  document.getElementById('dashboard-shared').style.display = ownVisible ? 'none' : '';

  if (!ownVisible) {
    renderSharedDocs();
    markSharedSeen();
  }
}

function renderSharedDocs() {
  const grid = document.getElementById('shared-grid');
  const hint = document.getElementById('shared-hint');
  if (!grid) return;
  grid.innerHTML = '';

  const api = window.InkwellShare;
  if (!api || !api.hasRealIdentity()) {
    hint.textContent = t('shared_needs_account');
    return;
  }

  if (!sharedDocs.length) {
    hint.textContent = t('shared_empty');
    return;
  }
  hint.textContent = t('shared_hint');

  const myMail = api.currentIdentity()?.email || '';

  for (const head of sharedDocs) {
    const role = head.roleFor(myMail) === 'edit' ? 'edit' : 'view';

    const card = document.createElement('div');
    card.className = 'nb-card';
    card.style.setProperty('--nb-color', head.color);

    const spine = document.createElement('div');
    spine.className = 'nb-card-spine';
    spine.style.background = head.color;

    const body = document.createElement('div');
    body.className = 'nb-card-body';

    const name = document.createElement('div');
    name.className = 'nb-card-name';
    name.textContent = head.title || '?';

    const badge = document.createElement('span');
    badge.className = 'nb-card-role' + (role === 'edit' ? ' can-edit' : '');
    badge.textContent = role === 'edit' ? t('role_edit') : t('role_view');

    const meta = document.createElement('div');
    meta.className = 'nb-card-meta';
    const parts = [head.ownerName || head.ownerEmail || '?'];
    if (head.updatedAt) parts.push(fmtDate(head.updatedAt.toISOString()));
    meta.textContent = parts.join(' · ');

    body.append(name, badge, meta);
    card.append(spine, body);
    card.addEventListener('click', () => openSharedDoc(head));
    grid.appendChild(card);
  }
}

async function openSharedDoc(head) {
  const hint = document.getElementById('shared-hint');
  try {
    const api = await whenShareReady();
    const { notebook, head: fresh } = await api.loadDocument(head.docId);

    const record = normalizeNotebookRecord(notebook);
    if (!record) throw new Error('SHARE_BROKEN');

    // Der Betrachter zeigt ohnehin nur an – hier braucht es keine Sperre,
    // wohl aber den Hinweis, dass Bearbeiten in der App passiert.
    renderNotebook(record);

    const myMail = api.currentIdentity()?.email || '';
    if (fresh.roleFor(myMail) === 'edit' && fresh.linkId) {
      const bar = document.querySelector('.viewer-bar-actions');
      if (bar && !document.getElementById('viewer-open-app')) {
        const link = document.createElement('a');
        link.id = 'viewer-open-app';
        link.className = 'btn-m';
        link.style.textDecoration = 'none';
        link.textContent = t('share_open_app');
        link.href = api.appUrlFor(fresh.linkId);
        bar.insertBefore(link, bar.firstChild);
      }
    }
  } catch (err) {
    console.error('[SharedDocs]', err);
    if (hint) hint.textContent = describeShareError(err);
  }
}

async function startWatchingShared() {
  if (unwatchShared) { unwatchShared(); unwatchShared = null; }

  const me = await inkwellIdentityReady();
  if (!me) {
    sharedDocs = [];
    renderSharedBadge();
    if (dashTab === 'shared') renderSharedDocs();
    return;
  }

  const api = window.InkwellShare;
  unwatchShared = api.watchSharedDocs(me.email, (list) => {
    sharedDocs = list.sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
    renderSharedBadge();
    if (dashTab === 'shared') renderSharedDocs();
  });
}

document.getElementById('dash-tab-own').addEventListener('click', () => switchDashTab('own'));
document.getElementById('dash-tab-shared').addEventListener('click', () => switchDashTab('shared'));
document.addEventListener('inkwell-identity-changed', () => {
  startWatchingShared().catch(() => {});
});
startWatchingShared().catch(err => console.warn('[SharedDocs] Start:', err?.message || err));

// Notizbuch aus dem Link öffnen, sobald die Liste geladen ist
function openNotebookFromUrl() {
  const wanted = new URLSearchParams(window.location.search).get('nb');
  if (!wanted) return;
  const nb = allNotebooks.find(n => n.id === wanted);
  if (nb) renderNotebook(nb);
}

document.getElementById('logout-btn').addEventListener('click', () => {
  inkwellLogout();
  session = null;
  window.location.replace('../');
});

// Der "Zur Startseite"-Button wird von js/common.js belegt (checkCommonAuth).

initDashboardSearch();

checkAuth().then(ok => { if (ok) showDashboard(); });
