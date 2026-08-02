'use strict';

(function(){
  const btn = document.getElementById('btn-update');
  if (!btn || !window.api) return;
  
  const textEl = document.getElementById('btn-update-text');
  const bgEl = document.getElementById('btn-update-progress');

  let state = 'hidden';
  let progress = 0;

  function setState(s, data) {
    state = s;
    if (s === 'hidden') { btn.style.display = 'none'; }
    else { btn.style.display = 'flex'; }

    if (s === 'checking') { 
      textEl.textContent = typeof t === 'function' ? t('updateChecking') : 'Sucht…'; 
      btn.disabled = true; 
      bgEl.style.width = '0%';
    } else if (s === 'available') { 
      textEl.textContent = typeof t === 'function' ? t('updateAvailable') : 'Update laden'; 
      btn.disabled = false; 
      bgEl.style.width = '0%';
    } else if (s === 'downloading') { 
      const p = Math.round((data?.percent || progress) * 100) / 100;
      textEl.textContent = typeof t === 'function' ? t('updateDownloading').replace('{p}', p) : `Lade… ${p}%`; 
      btn.disabled = false; // allow pausing
      bgEl.style.width = `${p}%`;
    } else if (s === 'paused') {
      const p = Math.round(progress * 100) / 100;
      textEl.textContent = typeof t === 'function' ? t('updatePaused').replace('{p}', p) : `Pausiert ${p}%`; 
      btn.disabled = false; // allow resuming
      bgEl.style.width = `${p}%`;
    } else if (s === 'downloaded') { 
      textEl.textContent = typeof t === 'function' ? t('updateDownloaded') : 'Neustart & Update'; 
      btn.disabled = false; 
      bgEl.style.width = '100%';
    } else if (s === 'up-to-date') { 
      textEl.textContent = typeof t === 'function' ? t('updateUpToDate') : 'Aktuell'; 
      btn.disabled = true; 
      bgEl.style.width = '0%';
      setTimeout(()=> setState('hidden'), 3000); 
    } else if (s === 'error') { 
      textEl.textContent = typeof t === 'function' ? t('updateError') : 'Fehler!'; 
      btn.disabled = false; 
      bgEl.style.width = '0%';
    } else if (s === 'idle') { 
      textEl.textContent = typeof t === 'function' ? t('updateIdle') : 'Update'; 
      btn.disabled = false; 
      bgEl.style.width = '0%';
    }
  }

  async function checkNow() {
    try {
      const res = await window.api.checkForUpdates();
      if (!res || !res.ok) {
        setState('hidden');
      }
    } catch (err) {
      setState('error');
      console.error('checkForUpdates error', err);
    }
  }

  btn.addEventListener('click', async () => {
    if (state === 'available') {
      setState('downloading', { percent: 0 });
      const r = await window.api.downloadUpdate();
      if (!r || !r.ok) setState('error');
    } else if (state === 'downloading' || state === 'paused') {
      if (window.api.toggleDownloadPause) {
        const r = await window.api.toggleDownloadPause();
        if (r && r.ok) {
          setState(r.paused ? 'paused' : 'downloading');
        }
      }
    } else if (state === 'downloaded') {
      await window.api.installAndRestart();
    }
  });

  // Wire up events from main
  window.api.onUpdateAvailable?.((info) => {
    console.log('[Updater] update-available', info);
    setState('available');
  });
  window.api.onUpdateNotAvailable?.((info) => {
    console.log('[Updater] update-not-available', info);
    setState('up-to-date');
  });
  window.api.onUpdateDownloaded?.((info) => {
    console.log('[Updater] update-downloaded', info);
    setState('downloaded');
  });
  window.api.onUpdateError?.((err) => {
    console.warn('[Updater] error', err);
    setState('error');
  });
  window.api.onDownloadProgress?.((p) => {
    progress = p.percent || progress || 0;
    if (p.paused) {
      setState('paused', p);
    } else {
      setState('downloading', p);
    }
  });

  window.addEventListener('language-changed', () => {
    if (state !== 'hidden') setState(state, { percent: progress });
  });

  // On startup, check if online and then check for updates
  (async function startupCheck(){
    try {
      const online = await window.api.checkInternet();
      if (online) checkNow();
      else setState('hidden');
    } catch (err) { setState('hidden'); }
  })();
})();
