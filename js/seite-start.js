const GH_USER = 'manuel0anvi';
const GH_REPO = 'Inkwells';

let releases = [];
let pendingDowngrade = null;
const loginModal = document.getElementById('login-modal');

// Hook into translation updates specifically for releases & downloads
addLangChangeListener(() => {
  updateDownloadButtonText();
  renderVersions();
  if (pendingDowngrade?.version) {
    const versionLabel = document.getElementById('downgrade-version');
    if (versionLabel) versionLabel.textContent = tf('downgrade_version', { version: pendingDowngrade.version });
  }
});

function updateDownloadButtonText() {
  if (releases.length > 0) {
    const asset = releases[0].assets.find(a => a.name.endsWith('.exe'));
    if (asset) {
      const btnSpan = document.querySelector('#main-dl span');
      if (btnSpan) {
        btnSpan.textContent = `${asset.name} ${t('dl_btn')}`;
      }
    }
  }
}

function fmtDate(iso){
  return new Date(iso).toLocaleDateString(lang==='de'?'de-AT':lang==='it'?'it-IT':'en-GB',{year:'numeric',month:'short',day:'numeric'});
}

function renderVersions(){
  const c = document.getElementById('ver-list');
  if(!releases.length){ c.innerHTML = `<div class="v-error">${t('ver_error')}</div>`; return; }
  
  c.innerHTML = releases.map((r,i)=>{
    const asset = r.assets.find(a=>a.name.endsWith('.exe'));
    const url = asset ? asset.browser_download_url : null;
    const isNew = i===0;
    
    return `<div class="vr${isNew?' latest':''}">
      <span class="v-tag">${r.tag_name}</span>
      <span class="v-date">${fmtDate(r.published_at)}</span>
      ${url
        ? `<button type="button" class="v-dl" data-old-version="${isNew ? 'false' : 'true'}" data-asset-name="${asset.name}" data-version-tag="${r.tag_name}" data-download-url="${url}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${t('ver_dl')}</button>`
        : `<span style="font-size:11px;color:var(--text-muted)">${t('ver_noexe')}</span>`}
    </div>`;
  }).join('');
}

function triggerDownload(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  if (filename) link.setAttribute('download', filename);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function closeDowngradeModal(){
  const modal = document.getElementById('downgrade-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  pendingDowngrade = null;
}

function openDowngradeModal(url, filename, version){
  pendingDowngrade = { url, filename, version };
  const modal = document.getElementById('downgrade-modal');
  const versionLabel = document.getElementById('downgrade-version');
  if (!modal || !versionLabel) return;

  versionLabel.textContent = tf('downgrade_version', { version: version || '-' });
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function setupDowngradeGuard(){
  document.addEventListener('click', (event) => {
    const control = event.target.closest('button.v-dl');
    if (!control) return;

    const url = control.getAttribute('data-download-url');
    const filename = control.getAttribute('data-asset-name');
    const isOldVersion = control.getAttribute('data-old-version') === 'true';

    if (!url) return;

    event.preventDefault();

    if (isOldVersion) {
      openDowngradeModal(url, filename, control.getAttribute('data-version-tag'));
      return;
    }

    triggerDownload(url, filename);
  });

  const cancelBtn = document.getElementById('downgrade-cancel');
  const confirmBtn = document.getElementById('downgrade-confirm');
  const modal = document.getElementById('downgrade-modal');

  cancelBtn?.addEventListener('click', closeDowngradeModal);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeDowngradeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDowngradeModal();
  });
  confirmBtn?.addEventListener('click', () => {
    if (!pendingDowngrade) return;
    triggerDownload(pendingDowngrade.url, pendingDowngrade.filename);
    closeDowngradeModal();
  });
}

async function loadReleases(){
  try{
    const r = await fetch(`https://api.github.com/repos/${GH_USER}/${GH_REPO}/releases`);
    if(!r.ok) throw new Error();
    releases = await r.json();
    if(releases.length){
      const tag = releases[0].tag_name;
      document.getElementById('hv').textContent = tag;
      document.getElementById('vbadge').textContent = 'Version '+tag;
      document.getElementById('dm-ver').textContent = 'Version '+tag;
      
      const asset = releases[0].assets.find(a=>a.name.endsWith('.exe'));
      if(asset){
        const mainDl = document.getElementById('main-dl');
        
        mainDl.href = asset.browser_download_url;
        
        mainDl.setAttribute('download', asset.name);
        
        updateDownloadButtonText();
      }
    }
    renderVersions();
  }catch{
    document.getElementById('ver-list').innerHTML=`<div class="v-error">${t('ver_error')}</div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   WER HIER LÄDT, HAT NICHT UNBEDINGT WINDOWS

   Die Datei ist ein NSIS-Installierer. Auf einem iPhone oder Android
   landet sie im Download-Ordner und tut dort nichts; auf einem Mac
   ebenso. Ohne ein Wort dazu sieht das aus, als sei der Download kaputt
   – und die Seite sagte bis hierher nur im Kleingedruckten, wofür das
   Programm gemacht ist.

   Erkannt wird über die User-Agent-Angaben. Sie sind nicht verlässlich,
   und genau deshalb HALTEN sie niemanden auf: es ist eine Rückfrage mit
   „Trotzdem herunterladen“, kein Riegel. Ein Windows-Rechner, der sich
   falsch meldet, verliert höchstens einen Klick.
   ═══════════════════════════════════════════════════════════════════════ */
function geraeteArt() {
  const uaD = navigator.userAgentData;
  const plat = ((uaD && uaD.platform) || navigator.platform || '').toLowerCase();
  const ua = (navigator.userAgent || '').toLowerCase();

  if (/windows|win32|win64/.test(plat) || /windows nt/.test(ua)) return 'windows';
  if (uaD && uaD.mobile === true) return 'mobile';
  if (/android|iphone|ipod|ipad/.test(ua)) return 'mobile';
  /* Ein iPad meldet sich seit iPadOS 13 als „Macintosh“. Auseinander
     hält beide nur die Frage, ob der Schirm Berührungen kennt. */
  if (/macintosh|mac os x/.test(ua) || /mac/.test(plat)) {
    return navigator.maxTouchPoints > 1 ? 'mobile' : 'apple';
  }
  if (/mobile/.test(ua)) return 'mobile';
  if (/linux|cros/.test(plat) || /linux|cros/.test(ua)) return 'other';
  return 'windows';
}

const GERAET = geraeteArt();
let plattformBestaetigt = false;
let plattformWeiter = null;

function schliessePlatModal() {
  const m = document.getElementById('plat-modal');
  if (!m) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  plattformWeiter = null;
}

function zeigePlatModal(weiter) {
  const m = document.getElementById('plat-modal');
  if (!m) { weiter(); return; }
  plattformWeiter = weiter;

  const art = GERAET === 'mobile' ? 'mobile' : (GERAET === 'apple' ? 'apple' : 'other');
  document.getElementById('plat-title').textContent = t('plat_title_' + art);
  document.getElementById('plat-body').textContent = t('plat_body_' + art);
  document.getElementById('plat-hint').textContent = t('plat_hint');
  document.getElementById('plat-soon').textContent = t('plat_soon');
  // Der Satz über Mac und iPad gehört nur dorthin, wo er etwas verspricht
  document.getElementById('plat-soon').style.display =
    (art === 'apple' || art === 'mobile') ? '' : 'none';

  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
}

function setupPlattformGuard() {
  document.getElementById('plat-cancel')?.addEventListener('click', schliessePlatModal);
  document.getElementById('plat-modal')?.addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) schliessePlatModal();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') schliessePlatModal();
  });
  document.getElementById('plat-confirm')?.addEventListener('click', () => {
    const weiter = plattformWeiter;
    plattformBestaetigt = true;
    schliessePlatModal();
    if (weiter) weiter();
  });

  if (GERAET === 'windows') return;

  /* In der ABFANGPHASE, damit die Rückfrage vor allen anderen kommt –
     auch vor der Downgrade-Warnung, die am selben Knopf hängt. Ist sie
     einmal beantwortet, läuft der nächste Klick ungehindert durch und
     die Downgrade-Warnung ist wieder an der Reihe. */
  document.addEventListener('click', (ev) => {
    if (plattformBestaetigt) return;
    const ziel = ev.target.closest('#hero-dl, #main-dl, button.v-dl');
    if (!ziel) return;
    ev.preventDefault();
    ev.stopPropagation();
    zeigePlatModal(() => ziel.click());
  }, true);
}

setupPlattformGuard();
setupDowngradeGuard();
loadReleases();

// --- Auth Handling (nur Google) ---
const btnOpenLogin = document.getElementById('btn-open-login');

function openLoginModal(reason) {
  loginModal.classList.add('open');
  loginModal.setAttribute('aria-hidden', 'false');

  // Wer aus dem Dashboard hierher zurückgeworfen wurde, weil die Sitzung
  // still abgelaufen ist, soll das auch erfahren.
  const expiredBox = document.getElementById('login-expired');
  if (expiredBox) {
    const expired = reason === 'expired';
    expiredBox.style.display = expired ? 'block' : 'none';
    if (expired) {
      document.getElementById('login-expired-title').textContent = t('login_expired_title');
      document.getElementById('login-expired-text').textContent = t('login_expired_text');
    }
  }

  // Je Anbieter zeigen, ob er eingerichtet ist – statt still zu scheitern
  const setBtn = (id, ready) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !ready;
    btn.style.opacity = ready ? '1' : '0.4';
    btn.style.cursor = ready ? 'pointer' : 'not-allowed';
  };

  const googleReady = cloudProviderIsConfigured('google');
  const msReady = cloudProviderIsConfigured('microsoft');
  setBtn('login-google-btn', googleReady);
  setBtn('login-microsoft-btn', msReady);

  const warn = document.getElementById('login-config-warning');
  if (!warn) return;

  const missing = [];
  if (!googleReady) missing.push('GOOGLE_CLIENT_ID');
  if (!msReady) missing.push('MICROSOFT_CLIENT_ID');

  if (!googleReady && !msReady) {
    warn.style.display = 'block';
    warn.textContent = 'Es sind noch keine Zugangsdaten hinterlegt ('
      + missing.join(', ') + ' in website/js/config.js). Anleitung: CLOUD_SETUP.md';
  } else if (missing.length) {
    warn.style.display = 'block';
    warn.style.color = 'var(--text-muted)';
    warn.style.borderColor = 'var(--navy-border)';
    warn.textContent = 'Noch nicht eingerichtet: ' + missing.join(', ');
  } else {
    warn.style.display = 'none';
  }
}

btnOpenLogin.addEventListener('click', () => {
  if (!isInkwellsKnown()) openLoginModal();
});

// Google leitet auf die Startseite zurück – Callback zuerst behandeln.
(async () => {
  const landing = document.getElementById('landing-content');
  const isCallback = window.location.hash.includes('access_token')
    || window.location.hash.includes('error=')
    || new URLSearchParams(window.location.search).has('code')
    || new URLSearchParams(window.location.search).has('error');

  if (isCallback) {
    landing.style.display = 'none';
    const handled = await handleCloudCallback();
    if (handled) landing.style.display = 'block';
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.get('login') === 'true') {
    openLoginModal(urlParams.get('expired') === '1' ? 'expired' : null);
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  // Bewusst auf der Startseite (Logo-Klick, "Zur Startseite") -> nichts tun
  if (urlParams.get('home') === 'true') {
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  // Sonst: angemeldete Nutzer direkt ins Dashboard – auch mit abgelaufenem
  // Token. Dort wird erneuert oder auf einen Tipp hin wieder verbunden
  // (js/common.js, ANGEMELDET BLEIBT). Hier still zu erneuern scheiterte
  // in Safari am blockierten Fenster, und man stand auf der Startseite.
  if (isInkwellsKnown()) window.location.replace('dashboard/');
})();

document.getElementById('login-google-btn').addEventListener('click', () => {
  startGoogleLogin('dashboard/');
});

/* Microsoft-Anmeldung: erst der Hinweis, dann weiter zu Microsoft.
   Abbrechen schließt nur das Hinweisfenster – das Anmeldefenster bleibt
   offen, damit man ohne Umweg Google wählen kann. */
const msHintModal = document.getElementById('ms-hint-modal');

function closeMsHint() {
  msHintModal.classList.remove('open');
  msHintModal.setAttribute('aria-hidden', 'true');
}

document.getElementById('login-microsoft-btn').addEventListener('click', () => {
  msHintModal.classList.add('open');
  msHintModal.setAttribute('aria-hidden', 'false');
  document.getElementById('ms-hint-confirm').focus();
});

document.getElementById('ms-hint-confirm').addEventListener('click', () => {
  closeMsHint();
  startCloudLogin('dashboard/', 'microsoft');
});

document.getElementById('ms-hint-cancel').addEventListener('click', closeMsHint);

msHintModal.addEventListener('click', (event) => {
  if (event.target === msHintModal) closeMsHint();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && msHintModal.classList.contains('open')) closeMsHint();
});

document.getElementById('login-cancel').addEventListener('click', () => {
  loginModal.classList.remove('open');
  loginModal.setAttribute('aria-hidden', 'true');
});

/* ══════════════════════════════════════════════════════════════════════
   ADMINZUGANG

   Dreimal auf die Kopfzeile des Anmeldefensters klicken öffnet die
   Passwortabfrage. Es gibt keinen Verweis darauf und keinen Eintrag im
   Menü – wer den Griff nicht kennt, stolpert nicht darüber.

   Das ist ausdrücklich nur Bequemlichkeit, kein Schutz. Geschützt wird der
   Adminbereich dadurch, dass das Passwort bei Firebase liegt und Firestore
   jede Änderung an der angemeldeten Kennung misst (website/firestore.rules).
   ══════════════════════════════════════════════════════════════════════ */

const adminModal = document.getElementById('admin-modal');
const adminError = document.getElementById('admin-modal-error');

// Firebase wird erst geladen, wenn es wirklich gebraucht wird. Sonst zahlt
// jeder Besucher der Startseite für etwas, das ihn nichts angeht.
let adminApiPromise = null;
function loadAdminApi() {
  if (!adminApiPromise) {
    adminApiPromise = import('./js/firebase.js').then(() => whenAdminApiReady());
  }
  return adminApiPromise;
}

function applyAdminModalLabels() {
  document.getElementById('admin-modal-kicker').textContent = t('admin_login_kicker');
  document.getElementById('admin-modal-title').textContent = t('admin_login_title');
  document.getElementById('admin-modal-sub').textContent = t('admin_login_sub');
  document.getElementById('admin-modal-pw-label').textContent = t('admin_login_password');
  document.getElementById('admin-submit').textContent = t('admin_login_submit');
}

function openAdminModal() {
  applyAdminModalLabels();
  setupPasswordEyes(adminModal);
  adminError.style.display = 'none';

  // Beim erneuten Öffnen wieder verdeckt starten, auch wenn zuletzt das
  // Auge aktiv war – sonst steht das Passwort beim nächsten Mal offen da.
  const passwordInput = document.getElementById('admin-password');
  passwordInput.value = '';
  passwordInput.type = 'password';
  const eye = adminModal.querySelector('.pw-eye');
  if (eye) eye.classList.remove('revealed');

  loginModal.classList.remove('open');
  loginModal.setAttribute('aria-hidden', 'true');

  adminModal.classList.add('open');
  adminModal.setAttribute('aria-hidden', 'false');
  document.getElementById('admin-password').focus();

  // Schon im Hintergrund laden, während das Passwort getippt wird
  loadAdminApi().catch(() => {});
}

function closeAdminModal() {
  adminModal.classList.remove('open');
  adminModal.setAttribute('aria-hidden', 'true');
}

/* Drei Klicks zählen, aber nur solange sie zusammengehören: nach einer
   Sekunde Pause beginnt die Zählung von vorn. Ohne das würden drei über
   den Tag verteilte Klicks irgendwann ebenfalls auslösen. */
let kickerClicks = 0;
let kickerTimer = null;

document.getElementById('login-kicker').addEventListener('click', () => {
  kickerClicks += 1;
  clearTimeout(kickerTimer);
  kickerTimer = setTimeout(() => { kickerClicks = 0; }, 1000);

  if (kickerClicks >= 3) {
    kickerClicks = 0;
    clearTimeout(kickerTimer);
    openAdminModal();
  }
});

document.getElementById('admin-cancel').addEventListener('click', closeAdminModal);

adminModal.addEventListener('click', (event) => {
  if (event.target === adminModal) closeAdminModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && adminModal.classList.contains('open')) closeAdminModal();
});

document.getElementById('admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const password = document.getElementById('admin-password').value;
  const submit = document.getElementById('admin-submit');

  submit.disabled = true;
  adminError.style.display = 'none';

  try {
    const api = await loadAdminApi();
    await api.adminSignIn(password);
    window.location.href = 'admin/';
  } catch (err) {
    adminError.textContent = describeAdminError(err);
    adminError.style.display = 'block';
    document.getElementById('admin-password').select();
  } finally {
    submit.disabled = false;
  }
});

if (typeof addLangChangeListener === 'function') {
  addLangChangeListener(() => {
    if (adminModal.classList.contains('open')) applyAdminModalLabels();
  });
}
