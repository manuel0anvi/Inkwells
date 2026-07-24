let session = null;

// Auth Guard Check
function checkAuth() {
  const token = localStorage.getItem('inkwell_web_token');
  const uid = localStorage.getItem('inkwell_web_uid');
  
  if (!token || !uid) {
    // If not authenticated, redirect to landing page and show login modal
    window.location.replace('../?login=true');
    return false;
  }
  
  session = { accessToken: token, userId: uid };
  return true;
}

const webappDashboard = document.getElementById('webapp-dashboard');
const webappViewer = document.getElementById('webapp-viewer');
const viewerPages = document.getElementById('viewer-pages');
const viewerPageCountTop = document.getElementById('viewer-page-num-top');

// Hook into translation switcher to reload notebooks with updated date locales
if (typeof addLangChangeListener === 'function') {
  addLangChangeListener(() => {
    if (session) {
      showDashboard();
    }
  });
}

function fmtDate(iso){
  return new Date(iso).toLocaleDateString(lang==='de'?'de-AT':lang==='it'?'it-IT':'en-GB',{year:'numeric',month:'short',day:'numeric'});
}

function getNotebookPages(notebook) {
  if (!notebook || typeof notebook !== 'object') return [];

  if (Array.isArray(notebook.pages) && notebook.pages.length) {
    return notebook.pages.filter(Boolean);
  }

  const pagesById = new Map();
  if (Array.isArray(notebook.pages)) {
    for (const page of notebook.pages) {
      if (page && page.id) pagesById.set(page.id, page);
    }
  }

  const collected = [];
  const seen = new Set();
  const sections = Array.isArray(notebook.sections) ? notebook.sections : [];

  for (const section of sections) {
    if (Array.isArray(section?.pages)) {
      for (const page of section.pages) {
        if (!page || !page.id || seen.has(page.id)) continue;
        seen.add(page.id);
        collected.push(page);
      }
      continue;
    }

    if (Array.isArray(section?.pgIds)) {
      for (const pageId of section.pgIds) {
        const page = pagesById.get(pageId);
        if (!page || !page.id || seen.has(page.id)) continue;
        seen.add(page.id);
        collected.push(page);
      }
    }
  }

  return collected;
}

function normalizeNotebookRecord(row) {
  let raw = row?.notebook_json
    ? (typeof row.notebook_json === 'string' ? JSON.parse(row.notebook_json) : row.notebook_json)
    : row;

  if (!raw || typeof raw !== 'object') return null;

  let notebook = raw;
  if (Array.isArray(raw?.notebooks)) {
    notebook = raw.notebooks[0] || null;
  } else if (Array.isArray(raw?.data)) {
    notebook = raw.data[0] || null;
  } else if (raw?.notebook) {
    notebook = raw.notebook;
  } else if (raw?.notebook_json) {
    notebook = raw.notebook_json;
  } else if (Array.isArray(raw)) {
    notebook = raw[0] || null;
  }

  if (!notebook || typeof notebook !== 'object') return null;

  const normalized = JSON.parse(JSON.stringify(notebook));
  normalized.name = normalized.name || normalized.title || normalized.notebookName || row?.title || 'Untitled';
  normalized.updatedAt = normalized.updatedAt || normalized.updated_at || row?.updated_at || row?.modifiedTime || row?.modified_time || new Date().toISOString();
  normalized.pages = getNotebookPages(normalized);
  return normalized;
}

async function showDashboard() {
  webappViewer.style.display = 'none';
  webappDashboard.style.display = 'block';
  
  const grid = document.getElementById('dashboard-grid');
  grid.innerHTML = `<p style="color:var(--text-muted)" data-i18n="dash_loading">${t('dash_loading') || 'Lade Notebooks...'}</p>`;
  
  try {
    const gToken = localStorage.getItem('inkwell_gdrive_token');
    const notebooks = [];
    if (!gToken) {
      grid.innerHTML = `<p style="color:var(--text-muted); padding:20px;">${t('login_sub') || 'Melde dich mit Google an, um deine Notizbücher in Google Drive anzusehen.'}</p>`;
      return;
    }

    document.getElementById('auth-connect-drive-web').style.display = 'none';
    document.getElementById('drive-connected-indicator').style.display = 'flex';

    const folderQuery = encodeURIComponent("name='Inkwell' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id,name,modifiedTime)&spaces=drive&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${gToken}` }
    });

    if (!folderRes.ok) {
      if (folderRes.status === 401 || folderRes.status === 403) {
        localStorage.removeItem('inkwell_gdrive_token');
      }
      throw new Error(`Google Drive konnte nicht gelesen werden (${folderRes.status}).`);
    }

    const folderData = await folderRes.json();
    const folders = Array.isArray(folderData.files) ? folderData.files : [];

    let selectedFolder = null;
    for (const folder of folders) {
      const fileQuery = encodeURIComponent(`'${folder.id}' in parents and trashed=false`);
      const filesRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${fileQuery}&fields=files(id,name,mimeType,modifiedTime,appProperties)&orderBy=modifiedTime desc&spaces=drive&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${gToken}` }
      });

      if (!filesRes.ok) {
        console.warn('Drive file listing failed for folder', folder.id, filesRes.status);
        continue;
      }

      const filesData = await filesRes.json();
      const fileEntries = Array.isArray(filesData.files) ? filesData.files : [];
      const notebookFiles = fileEntries.filter((file) => file.name?.endsWith('.jrnl') || file.name?.endsWith('.json') || file.appProperties?.inkwellId || file.mimeType === 'application/json');

      if (notebookFiles.length === 0) {
        continue;
      }

      selectedFolder = folder;
      for (const file of notebookFiles) {
        try {
          const fRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, {
            headers: { Authorization: `Bearer ${gToken}` }
          });
          if (!fRes.ok) {
            console.warn('Could not load notebook file', file.name, fRes.status);
            continue;
          }
          const json = await fRes.json();
          console.log('[Dashboard] Raw Drive payload for', file.name, json);
          const notebook = normalizeNotebookRecord({
            ...file,
            notebook_json: json
          });
          console.log('[Dashboard] Normalized notebook for', file.name, notebook);
          if (notebook) {
            notebooks.push(notebook);
          }
        } catch (e) {
          console.warn('Could not parse notebook', file.name, e);
        }
      }

      if (notebooks.length > 0) {
        break;
      }
    }

    if (!selectedFolder) {
      grid.innerHTML = `<p style="color:var(--text-muted); padding:20px;">${t('dash_gdrive_empty') || 'Keine Notizbücher im Inkwell-Ordner gefunden.'}</p>`;
      return;
    }
    
    grid.innerHTML = '';
    
    // Set Last Sync time
    const now = new Date();
    const locale = lang === 'de' ? 'de-DE' : lang === 'it' ? 'it-IT' : 'en-GB';
    const dateOpts = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const timeOpts = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
    const datetimeStr = `${now.toLocaleDateString(locale, dateOpts)} ${now.toLocaleTimeString(locale, timeOpts)}`;
    const sourceStr = 'Google Drive';
    document.getElementById('last-sync-time').innerHTML = tf('dash_last_sync', { datetime: datetimeStr }) + ` &bull; Quelle: <span style="color:var(--gold-light)">${sourceStr}</span>`;
    
    if (notebooks.length === 0) {
      grid.innerHTML = `<p style="color:var(--text-muted)" data-i18n="dash_empty">${t('dash_empty') || 'Keine Notebooks gefunden.'}</p>`;
      return;
    }

    notebooks.forEach(row => {
      const nb = normalizeNotebookRecord(row);
      if (!nb) return;
      const card = document.createElement('div');
      card.className = 'fc'; // reuse feature card style
      card.style.cursor = 'pointer';
      card.style.position = 'relative';
      card.style.overflow = 'hidden';
      card.style.borderRadius = '8px';
      card.style.paddingLeft = '42px'; // make space for premium spine
      
      const spineColor = nb.color || 'var(--gold)';
      const spine = document.createElement('div');
      spine.style.position = 'absolute';
      spine.style.left = '0';
      spine.style.top = '0';
      spine.style.bottom = '0';
      spine.style.width = '10px';
      spine.style.background = spineColor;
      spine.style.boxShadow = '1px 0 6px rgba(0,0,0,0.4)';
      card.appendChild(spine);
      
      const pageCount = getNotebookPages(nb).length;
      const pageLabel = pageCount !== 1 ? (t('pages') || 'Seiten') : (t('page') || 'Seite');
      
      const contentContainer = document.createElement('div');
      contentContainer.innerHTML = `<h3 style="margin-bottom:4px;">${nb.name}</h3>`
        + `<p style="font-size:12px;opacity:0.6;margin-bottom:8px;">${fmtDate(nb.updatedAt)}</p>`
        + `<p style="font-size:11px;color:var(--gold);letter-spacing:0.05em;text-transform:uppercase;margin:0;">${pageCount} ${pageLabel}</p>`;
      card.appendChild(contentContainer);
      
      card.addEventListener('click', () => renderNotebook(nb));
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<p style="color:#d9534f"><span data-i18n="dash_err">${t('dash_err') || 'Fehler:'}</span> ${err.message}</p>`;
  }
}

let currentNotebook = null;

function loadViewerImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function extractPlainText(html = '') {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n');
  return tempDiv.textContent || '';
}

async function renderNotebookPage(page, pageNumber, totalPages) {
  const card = document.createElement('section');
  card.style.cssText = 'width: min(100%, 1040px); background: #f7f1e6; border-radius: 18px; box-shadow: 0 18px 45px rgba(0,0,0,0.35); overflow: hidden; border: 1px solid rgba(0,0,0,0.08);';

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,240,225,0.96)); border-bottom: 1px solid rgba(0,0,0,0.06); font-family: "Jost", sans-serif;';
  
  const pageWord = t('page') || 'Seite';
  const ofWord = lang === 'en' ? 'of' : lang === 'it' ? 'di' : 'von';
  header.innerHTML = `<strong style="font-size: 14px; color: #443327;">${pageWord} ${pageNumber} ${ofWord} ${totalPages}</strong><span style="font-size: 13px; color: #7b6652;">${Math.round((page.w || 794) / 10)} × ${Math.round((page.h || 1123) / 10)} mm</span>`;

  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'overflow: auto; padding: 22px; background: #efe4d0;';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display: block; margin: 0 auto; background: #fff; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.18); max-width: 100%; height: auto;';
  canvasWrap.appendChild(canvas);
  card.appendChild(header);
  card.appendChild(canvasWrap);
  viewerPages.appendChild(card);

  const ctx = canvas.getContext('2d');
  const cssW = page.w || 794;
  const cssH = page.h || 1123;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = '100%';
  canvas.style.maxWidth = `${cssW}px`;
  canvas.style.aspectRatio = `${cssW} / ${cssH}`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const bgImg = await loadViewerImage(page.bgImg);
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, cssW, cssH);
  }

  if (Array.isArray(page.objects)) {
    for (const obj of page.objects) {
      if (!obj || !obj.src) continue;
      const objImg = await loadViewerImage(obj.src);
      if (objImg) {
        ctx.drawImage(objImg, obj.x || 0, obj.y || 0, obj.w || cssW, obj.h || cssH);
      }
    }
  }

  if (Array.isArray(page.inkStrokes)) {
    for (const stroke of page.inkStrokes) {
      const path = stroke.path || stroke.points || [];
      if (!path.length) continue;

      ctx.beginPath();
      ctx.strokeStyle = stroke.color || '#000';
      ctx.lineWidth = stroke.width || stroke.size || 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = stroke.isHL || stroke.isHighlighter ? 0.4 : 1;
      if (stroke.isHL || stroke.isHighlighter) {
        ctx.lineWidth = stroke.width || 15;
      }

      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();
    }
  }

  if (page.textContent) {
    const plainText = extractPlainText(page.textContent);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#101010';
    ctx.font = '16px "Jost", sans-serif';
    const lines = plainText.split('\n').map((line) => line.trimEnd());
    let y = 78;
    for (const line of lines) {
      ctx.fillText(line, 72, y);
      y += 24;
    }
  }

  ctx.globalAlpha = 0.52;
  ctx.fillStyle = '#7b6a58';
  ctx.font = '12px "Jost", sans-serif';
  ctx.fillText('Inkwell Web Viewer', 22, 22);
  ctx.globalAlpha = 1;
}

function renderNotebook(nb) {
  const notebook = normalizeNotebookRecord(nb);
  if (!notebook) return;

  currentNotebook = notebook;
  webappDashboard.style.display = 'none';
  webappViewer.style.display = 'block';
  const viewerTitle = document.getElementById('viewer-title');
  viewerTitle.textContent = notebook.name || 'Untitled';
  viewerTitle.style.borderBottom = `3px solid ${notebook.color || 'var(--gold)'}`;
  viewerTitle.style.paddingBottom = '4px';
  viewerTitle.style.display = 'inline-block';
  viewerPages.innerHTML = '';

  const pages = getNotebookPages(notebook);
  const pageLabel = pages.length === 1 ? (t('page') || 'Seite') : (t('pages') || 'Seiten');
  viewerPageCountTop.textContent = `${pages.length} ${pageLabel}`;

  if (!pages.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'max-width: 960px; width: 100%; margin: 0 auto; padding: 36px 24px; border-radius: 18px; background: rgba(255,255,255,0.08); color: var(--cream); text-align: center; font-family: "Jost", sans-serif;';
    empty.textContent = lang === 'en' ? 'This notebook has no pages.' : lang === 'it' ? 'Questo quaderno non ha pagine.' : 'Dieses Notebook hat keine Seiten.';
    viewerPages.appendChild(empty);
    return;
  }

  pages.forEach((page, index) => {
    renderNotebookPage(page, index + 1, pages.length).catch((error) => {
      console.error('Viewer render error:', error);
    });
  });
}

document.getElementById('viewer-back').addEventListener('click', () => {
  webappViewer.style.display = 'none';
  webappDashboard.style.display = 'block';
});

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('inkwell_web_token');
  localStorage.removeItem('inkwell_web_uid');
  session = null;
  window.location.replace('../');
});

document.getElementById('auth-connect-drive-web').addEventListener('click', () => {
  const currentUrl = window.location.origin + window.location.pathname;
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(currentUrl)}&prompt=consent%20select_account&scopes=https://www.googleapis.com/auth/drive.file%20https://www.googleapis.com/auth/drive.appdata`;
  window.location.href = url;
});

// Configure Home redirection click for the home button
document.getElementById('btn-open-login').addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = '../?home=true';
});

if (checkAuth()) {
  showDashboard();
}
