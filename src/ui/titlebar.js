'use strict';

/* ── WINDOW CONTROLS ── */
E('btn-min').addEventListener('click', () => window.api?.minimize()); 
E('btn-max').addEventListener('click', () => window.api?.maximize()); 
E('btn-close').addEventListener('click', () => window.api?.close()); 

E('btn-home').addEventListener('click', async () => { 
  // Sync first to ensure we capture the latest editor edits before check/save
  if (typeof syncAll === 'function') {
    try {
      syncAll();
    } catch (e) {
      console.error('[Navigation] syncAll failed before nav:', e);
    }
  }

  // Check if there are unsaved changes
  const hasUnsavedChanges = S.activeNbId && AutoSave.isDirty(S.activeNbId);
  const autoSaveEnabled = Settings.get('autoSaveEnabled');
  
  if (hasUnsavedChanges) {
    if (autoSaveEnabled) {
      // Auto-save is on, save and immediately leave
      console.log('[Navigation] Auto-saving and leaving...');
      try {
        await AutoSave.saveNow(S.activeNbId);
        toast(t('notebookSaved'));
      } catch (err) {
        console.error('[Navigation] Auto-save failed:', err);
        toast(t('saveError'), true);
      }
      showHome();
    } else {
      // Auto-save is off, show save confirm dialog
      const result = await showSaveConfirm(t('unsavedChanges'));
      
      if (result === 'save') {
        // Save and leave
        try {
          await AutoSave.saveNow(S.activeNbId);
          toast(t('notebookSaved'));
        } catch (err) {
          console.error('[Navigation] Save failed:', err);
          toast(t('saveError'), true);
        }
        showHome();
      } else if (result === 'leave') {
        // Leave without saving
        AutoSave.markClean(S.activeNbId); // Clear dirty flag
        showHome();
      }
      // If result is null (cancelled), do nothing
    }
  } else {
    // No unsaved changes, just go home
    showHome();
  }
});
// Speichern und Formatierungszeichen laufen jetzt über die änderbaren
// Kürzel (core/shortcuts.js). Hier bleibt nur Esc – das ist überall das
// Abbrechen und bewusst nicht umbelegbar.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    deselect();
    if (E('ctx-menu').style.display !== 'none') hideCtxMenu();
  }
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
  e.preventDefault();
  const info = getPage(S.activePgId);
  const nb = getNb();
  const sec = nb?.sections?.find(s => s.id === nb.activeSecId);
  if (!info || !sec) return;

  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
  if (!files.length) return;

  const insertType = await showInsertChoice();
  if (!insertType) return;
  toast(t('processingFiles'));

  let addedPages = false;
  let firstNewPageId = null;
  let addedObjects = 0;

  for (const f of files) {
    const r = new FileReader();
    const dataUrl = await new Promise(res => { r.onload = ev => res(ev.target.result); r.readAsDataURL(f); });

    if (f.type === 'application/pdf') {
      try {
        const pdfImageUrls = await parsePdfToImages(dataUrl);
        if (insertType === 'page') {
          const pages = pagesOfSec(sec, nb);
          const curIdx = pages.indexOf(info.page);
          const insertIdx = curIdx + 1;
          pdfImageUrls.forEach((imgObj, i) => {
            const newPg = makePage('blank');
            newPg.bgImg = imgObj.url;
            newPg.w = CFG.PAGE_W;
            newPg.h = Math.round(CFG.PAGE_W * (imgObj.h / (imgObj.w || 1))) + 56;
            nb.pages.push(newPg);
            sec.pgIds.splice(insertIdx + i, 0, newPg.id);
            if (!firstNewPageId) firstNewPageId = newPg.id;
          });
          addedPages = true;
          if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
        } else {
          const pages = pagesOfSec(sec, nb);
          let curIdx = pages.indexOf(info.page);
          const MAX_PER_PAGE = 5;
          for (let start = 0; start < pdfImageUrls.length; start += MAX_PER_PAGE) {
            const chunk = pdfImageUrls.slice(start, start + MAX_PER_PAGE);
            let targetPgInfo;
            if (start === 0) {
              targetPgInfo = info;
            } else {
              curIdx++;
              if (curIdx < pages.length) {
                targetPgInfo = getPage(pages[curIdx].id);
              } else {
                const newPg = makePage(sec.defaultBg || nb.defaultBg || 'ruled');
                nb.pages.push(newPg);
                sec.pgIds.splice(curIdx, 0, newPg.id);
                targetPgInfo = { page: newPg };
                addedPages = true;
                if (!firstNewPageId) firstNewPageId = newPg.id;
                pages.splice(curIdx, 0, newPg);
              }
            }

            const objLayer = E('pg-scroll').querySelector(`[data-pgid="${targetPgInfo.page.id}"]`)?.querySelector('.j-objects');
            let currY = 80;
            let pageHLimit = (targetPgInfo.page.h || CFG.PAGE_H);
            let ohLimit = (pageHLimit - 120) / chunk.length - 20;

            pushPageHistory(targetPgInfo.page);
            chunk.forEach((imgObj, idx) => {
              let oh = Math.min(ohLimit, 400);
              let ow = oh * (imgObj.w / imgObj.h);
              if (ow > 600) { ow = 600; oh = ow * (imgObj.h / imgObj.w); }

              const obj = { id: uid(), kind: 'image', src: imgObj.url, name: f.name, x: 80, y: currY, w: ow, h: oh, rot: 0 };
              if (!targetPgInfo.page.objects) targetPgInfo.page.objects = [];
              targetPgInfo.page.objects.push(obj);
              if (objLayer) placeObject(objLayer, obj, targetPgInfo.page);
              addedObjects++;
              currY += oh + 20;
            });
          }
          if (addedPages && window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
        }
      } catch (err) {
        toast(t('pdfError'), true);
      }
    } else {
      if (insertType === 'page') {
        const pages = pagesOfSec(sec, nb);
        const curIdx = pages.indexOf(info.page);
        const newPg = makePage('blank');
        newPg.bgImg = dataUrl;
        const tmpImg = new Image();
        tmpImg.src = dataUrl;
        await new Promise(r => tmpImg.onload = r);
        newPg.w = CFG.PAGE_W; // normalize to standard page
        newPg.h = Math.round(CFG.PAGE_W * (tmpImg.naturalHeight / (tmpImg.naturalWidth || 1))) + 56;
        nb.pages.push(newPg);
        sec.pgIds.splice(curIdx + 1, 0, newPg.id);
        if (!firstNewPageId) firstNewPageId = newPg.id;
        addedPages = true;
        if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
      } else {
        const objLayer = E('pg-scroll').querySelector(`[data-pgid="${info.page.id}"]`)?.querySelector('.j-objects');
        if (objLayer) {
          pushPageHistory(info.page);
          const tmpImg = new Image();
          tmpImg.src = dataUrl;
          await new Promise(r => tmpImg.onload = r);
          let ow = 200;
          let oh = ow * (tmpImg.naturalHeight / (tmpImg.naturalWidth || 1));
          const obj = { id: uid(), kind: 'image', src: dataUrl, name: f.name, x: 80, y: 80, w: ow, h: oh, rot: 0 };
          if (!info.page.objects) info.page.objects = [];
          info.page.objects.push(obj);
          placeObject(objLayer, obj, info.page);
          addedObjects++;
          if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
        }
      }
    }
  }

  if (addedPages) {
    renderSideTree();
    openSection(sec, firstNewPageId);
    toast(t('insertedAsPages'));
  } else if (addedObjects > 0) {
    S.mode = 'cursor';
    applyMode();
    QA('.tb-mode').forEach(b => b.classList.toggle('active', b.dataset.mode === 'cursor'));
    E('pen-opts').style.display = 'none';
    E('eraser-opts').style.display = 'none';
    E('text-opts').style.display = 'flex';
    toast(addedObjects + ' ' + t('objectsInserted'));
  }
});

E('pen-opts').style.display = 'none'; E('eraser-opts').style.display = 'none'; E('text-opts').style.display = 'flex';

