'use strict';

(function(){
  const btn = document.getElementById('btn-update');
  if (!btn || !window.api) return;

  /* Store-Fassung: kein eigener Updater.

     Windows haelt sie selbst auf Stand, im Hintergrund und ohne Zutun.
     Der Knopf wird deshalb gar nicht erst verdrahtet - stuende er da,
     wuerde er einen Installierer holen, der neben dem Store-Paket eine
     zweite Installation anlegt. Siehe preload.js. */
  if (window.api.istStorefassung) { btn.style.display = 'none'; return; }
  
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
      /* Der Knopf bleibt anklickbar – und seit dieser Fassung führt der
         Klick auch irgendwohin (siehe unten). Die Beschriftung sagt
         deshalb, was er tut. */
      textEl.textContent = typeof t === 'function' ? t('updateRetry') : 'Nochmal versuchen';
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
        /* Ein FEHLER bei der Prüfung ist etwas anderes als "es gibt
           nichts". Beides führte hier in denselben Zweig, und der Knopf
           verschwand – der Nutzer erfuhr nie, dass die Prüfung gar nicht
           durchgekommen ist. */
        if (res && res.err) {
          console.warn('[Updater] Prüfung fehlgeschlagen:', res.err);
          setState('error');
        } else {
          setState('hidden');
        }
      }
    } catch (err) {
      setState('error');
      console.error('checkForUpdates error', err);
    }
  }

  btn.addEventListener('click', async () => {
    /* ══════════════════════════════════════════════════════════════════
       AUS DEM FEHLER FUEHRTE KEIN WEG

       Der Zustand 'error' setzt disabled = false – der Knopf sah also
       anklickbar aus. In dieser Kette stand dafuer aber kein Zweig:
       klicken tat schlicht gar nichts. Ein vorübergehender Fehler –
       Leitung weg, Server kurz nicht da – liess sich damit nur durch
       einen Neustart der App beheben.

       Jetzt geht es von vorn los: erst nachsehen, ob es überhaupt (noch)
       ein Update gibt, und dann herunterladen.
       ══════════════════════════════════════════════════════════════════ */
    if (state === 'error') {
      setState('checking');
      await checkNow();
      /* Meldet sich kein update-available (der Ereignisweg oben), war
         entweder nichts da oder es klemmt weiter – dann steht der Knopf
         danach auf 'hidden' bzw. wieder auf 'error'. */
      return;
    }

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
      const r = await window.api.installAndRestart();
      if (r && !r.ok && (r.err === 'SAC' || r.err === 'BLOCKED')) zeigeStoreWeg();
    }
  });

  /* ══ WENN WINDOWS DEN INSTALLIERER NICHT STARTEN LÄSST ═══════════════
     Die Intelligente App-Steuerung startet nur signierte Programme, und
     der Installierer ist nicht signiert (main.js, smartAppControlAn). Der
     Microsoft Store liefert dieselbe Fassung, von Microsoft signiert – der
     einzige Weg, der dann offensteht. */
  const STORE_URL = 'https://apps.microsoft.com/detail/9PNJSHB4N4JH';

  async function zeigeStoreWeg() {
    // Ist die Anzeige des Beendens schon angegangen, muss sie wieder weg
    document.getElementById('quitting')?.classList.remove('an');
    const frage = (typeof t === 'function' && t('updateBlockiert'))
      || 'Windows lässt das Update nicht starten (Intelligente App-Steuerung). Inkwells im Microsoft Store öffnen?';
    const ja = typeof showConfirm === 'function' ? await showConfirm(frage) : window.confirm(frage);
    if (ja && window.api.openExternal) window.api.openExternal(STORE_URL);
  }
  window.api.onUpdateBlockiert?.(() => zeigeStoreWeg());

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
