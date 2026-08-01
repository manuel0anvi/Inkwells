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

// Beim Öffnen erst eine stille Erneuerung versuchen, bevor zur
// Anmeldeseite geschickt wird – sonst landet man nach einer Stunde
// Pause grundlos wieder beim Login.
async function checkAuth() {
  session = await ensureFreshToken();
  if (!session) {
    window.location.replace('../?login=true');
    return false;
  }
  return true;
}

async function requireSession() {
  session = await ensureFreshToken();
  if (!session) {
    clearInkwellSession();
    window.location.replace('../?login=true');
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
      window.location.replace('../?login=true');
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

/* ── PDF-Ausgabe ──────────────────────────────────────────────────────
   Kein eigener PDF-Erzeuger nötig: die Seiten liegen bereits exakt im
   A4-Verhältnis (794×1123 px = A4 bei 96 dpi) im Dokument. Für den Druck
   wird alles außer den Seiten ausgeblendet und die Skalierung aufgehoben,
   dann übernimmt "Als PDF speichern" im Druckdialog des Browsers.
   ─────────────────────────────────────────────────────────────────── */

function printNotebook() {
  if (!currentNotebook) return;

  const previousTitle = document.title;
  // Der Browser schlägt den Dokumenttitel als Dateinamen vor
  document.title = (currentNotebook.name || 'Inkwell').replace(/[\\/:*?"<>|]/g, '_');

  // Für den Druck in Originalgröße darstellen
  for (const { scaler, pageEl, width, height } of pageScalers) {
    pageEl.style.transform = 'none';
    scaler.style.width = width + 'px';
    scaler.style.height = height + 'px';
  }

  document.body.classList.add('printing');

  const cleanup = () => {
    document.body.classList.remove('printing');
    document.title = previousTitle;
    rescaleAllPages();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // Kurz warten, damit das Layout vor dem Druckdialog steht
  setTimeout(() => {
    window.print();
    // Sicherheitsnetz, falls afterprint ausbleibt (manche Browser)
    setTimeout(() => { if (document.body.classList.contains('printing')) cleanup(); }, 1000);
  }, 60);
}

document.getElementById('viewer-pdf').addEventListener('click', printNotebook);

/* ── Heft freigeben ───────────────────────────────────────────────────
   Der frühere Knopf kopierte nur "?nb=<id>" – ein Link, der ohne
   Anmeldung ins Leere lief und beim Empfänger nur funktionierte, wenn er
   ohnehin Zugriff auf die Drive-Datei hatte. Jetzt wird eine echte
   Lesekopie in Firestore veröffentlicht (js/share.js), die jeder mit dem
   Link ohne Konto ansehen kann.
   ─────────────────────────────────────────────────────────────────── */

// Merkt sich je Heft die zuletzt erzeugte Freigabe, damit „aktualisieren"
// und „aufheben" nach einem Seitenwechsel weiter funktionieren.
const SHARE_STORE_KEY = 'inkwell_shares';

function loadShareRegistry() {
  try { return JSON.parse(localStorage.getItem(SHARE_STORE_KEY)) || {}; }
  catch (e) { return {}; }
}

function rememberShare(notebookId, entry) {
  const all = loadShareRegistry();
  if (entry) all[notebookId] = entry; else delete all[notebookId];
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

function openShareDialog() {
  if (!currentNotebook) return;

  const overlay = document.getElementById('share-overlay');
  const existing = shareFor(currentNotebook.id);

  document.getElementById('share-dlg-title').textContent = t('share_title');
  document.getElementById('share-dlg-intro').textContent = t('share_intro');
  document.getElementById('share-dlg-warning').textContent = t('share_warning');
  document.getElementById('share-dlg-status').textContent = existing ? t('share_active') : '';

  // Modus vorbelegen: bestehende Freigabe behält ihren, sonst eingefroren
  const mode = existing?.mode === 'live' ? 'live' : 'frozen';
  document.querySelector(`input[name="share-mode"][value="${mode}"]`).checked = true;

  const linkRow = document.getElementById('share-dlg-link-row');
  const linkInput = document.getElementById('share-dlg-link');
  if (existing) {
    linkRow.style.display = 'flex';
    linkInput.value = existing.url;
  } else {
    linkRow.style.display = 'none';
    linkInput.value = '';
  }

  document.getElementById('share-dlg-create').textContent = existing ? t('share_update') : t('share_create');
  document.getElementById('share-dlg-revoke').style.display = existing ? 'inline-block' : 'none';

  overlay.style.display = 'flex';
}

function closeShareDialog() {
  document.getElementById('share-overlay').style.display = 'none';
}

async function submitShare() {
  if (!currentNotebook) return;

  const btn = document.getElementById('share-dlg-create');
  const status = document.getElementById('share-dlg-status');
  const mode = document.querySelector('input[name="share-mode"]:checked')?.value === 'live' ? 'live' : 'frozen';
  const existing = shareFor(currentNotebook.id);

  btn.disabled = true;
  status.textContent = t('share_working');

  try {
    const api = await whenShareReady();
    const result = await api.publishNotebook(currentNotebook, {
      mode,
      shareId: existing?.shareId
    });

    rememberShare(currentNotebook.id, { shareId: result.shareId, url: result.url, mode: result.mode });

    document.getElementById('share-dlg-link-row').style.display = 'flex';
    document.getElementById('share-dlg-link').value = result.url;
    document.getElementById('share-dlg-revoke').style.display = 'inline-block';
    btn.textContent = t('share_update');
    status.textContent = existing ? t('share_updated_ok') : t('share_done');
  } catch (err) {
    console.error('[Share]', err);
    status.textContent = err.message === 'SHARE_NOT_OWNED'
      ? t('share_not_owned')
      : tf('share_failed', { msg: err.message || 'unbekannt' });
  } finally {
    btn.disabled = false;
  }
}

async function revokeCurrentShare() {
  if (!currentNotebook) return;
  const existing = shareFor(currentNotebook.id);
  if (!existing) return;
  if (!window.confirm(t('share_revoke_confirm'))) return;

  const status = document.getElementById('share-dlg-status');
  try {
    const api = await whenShareReady();
    await api.revokeShare(existing.shareId);
    rememberShare(currentNotebook.id, null);

    document.getElementById('share-dlg-link-row').style.display = 'none';
    document.getElementById('share-dlg-revoke').style.display = 'none';
    document.getElementById('share-dlg-create').textContent = t('share_create');
    status.textContent = t('share_revoked');
  } catch (err) {
    console.error('[Share]', err);
    status.textContent = err.message === 'SHARE_NOT_OWNED'
      ? t('share_not_owned')
      : tf('share_failed', { msg: err.message || 'unbekannt' });
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
document.getElementById('share-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('share-overlay')) closeShareDialog();
});

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
