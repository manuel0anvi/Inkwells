const SUPABASE_URL = 'https://sdplctlpigzrscaepatk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9gAsGOmApJIB8gKeJzwPRg_L1dslM0V';

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

async function showDashboard() {
  webappViewer.style.display = 'none';
  webappDashboard.style.display = 'block';
  
  const grid = document.getElementById('dashboard-grid');
  grid.innerHTML = `<p style="color:var(--text-muted)" data-i18n="dash_loading">${t('dash_loading') || 'Lade Notebooks...'}</p>`;
  
  try {
    const gToken = localStorage.getItem('inkwell_gdrive_token');
    if (!gToken) {
        throw new Error(t('dash_drive_missing') || 'Google Drive Zugriff fehlt. Bitte erneut anmelden.');
    }
    
    // 1. Get Folder ID
    const q1 = encodeURIComponent("name='Inkwell' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q1}&spaces=drive`, {
        headers: { Authorization: `Bearer ${gToken}` }
    });
    if (!folderRes.ok) {
        if (folderRes.status === 401) throw new Error(t('dash_session_expired') || 'Sitzung abgelaufen. Bitte erneut anmelden.');
        throw new Error('Drive error');
    }
    const folderData = await folderRes.json();
    if (!folderData.files || folderData.files.length === 0) {
        // No notebooks yet
        grid.innerHTML = `<p style="color:var(--text-muted); padding:20px;">Keine Notizbücher in Google Drive gefunden.</p>`;
        return;
    }
    const folderId = folderData.files[0].id;
    
    // 2. Fetch Files
    const q2 = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const filesRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q2}&fields=files(id,name,appProperties)&spaces=drive`, {
        headers: { Authorization: `Bearer ${gToken}` }
    });
    const filesData = await filesRes.json();
    
    const notebooks = [];
    if (filesData.files) {
        for (const f of filesData.files) {
            if (!f.appProperties || !f.appProperties.inkwellId) continue;
            try {
                const nbReq = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { headers: { Authorization: `Bearer ${gToken}` }});
                if (nbReq.ok) notebooks.push(await nbReq.json());
            } catch (err) {}
        }
    }
    
    grid.innerHTML = '';
    
    // Set Last Sync time
    const now = new Date();
    const locale = lang === 'de' ? 'de-DE' : lang === 'it' ? 'it-IT' : 'en-GB';
    const dateOpts = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const timeOpts = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
    const datetimeStr = `${now.toLocaleDateString(locale, dateOpts)} ${now.toLocaleTimeString(locale, timeOpts)}`;
    document.getElementById('last-sync-time').innerHTML = tf('dash_last_sync', { datetime: datetimeStr });
    
    if (notebooks.length === 0) {
      grid.innerHTML = `<p style="color:var(--text-muted)" data-i18n="dash_empty">${t('dash_empty') || 'Keine Notebooks gefunden.'}</p>`;
      return;
    }

    notebooks.forEach(row => {
      const nb = row.notebook_json ? (typeof row.notebook_json === 'string' ? JSON.parse(row.notebook_json) : row.notebook_json) : row;
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
      
      const pageCount = (nb.pages || []).length;
      const pageLabel = pageCount !== 1 ? (t('pages') || 'Seiten') : (t('page') || 'Seite');
      
      const contentContainer = document.createElement('div');
      contentContainer.innerHTML = `<h3 style="margin-bottom:4px;">${nb.name || row.title}</h3>`
        + `<p style="font-size:12px;opacity:0.6;margin-bottom:8px;">${new Date(row.updated_at).toLocaleDateString()}</p>`
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
  currentNotebook = nb;
  webappDashboard.style.display = 'none';
  webappViewer.style.display = 'block';
  const viewerTitle = document.getElementById('viewer-title');
  viewerTitle.textContent = nb.name || 'Untitled';
  viewerTitle.style.borderBottom = `3px solid ${nb.color || 'var(--gold)'}`;
  viewerTitle.style.paddingBottom = '4px';
  viewerTitle.style.display = 'inline-block';
  viewerPages.innerHTML = '';

  const pages = Array.isArray(nb.pages) ? nb.pages : [];
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

// Configure Home redirection click for the home button
document.getElementById('btn-open-login').addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = '../?home=true';
});

if (checkAuth()) {
  showDashboard();
}
