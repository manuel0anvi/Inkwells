'use strict';

/* ── HOME GRID ── */
let _dragState = null;

function renderHomeGrid() {
  // Geteilte Dokumente liegen zwar mit in S.notebooks (der Editor holt sich
  // alles über getNb), gehören aber nicht auf die Seite „Meine Hefte".
  const own = typeof ownNotebooks === 'function' ? ownNotebooks() : S.notebooks;
  console.log('[HomeGrid] Rendering home grid. Notebooks in state:', own.length);
  const grid = E('nb-grid'); grid.innerHTML = '';
  for (const nb of own) {
    const pageCount = (nb.pages || []).length;
    const pageLabel = pageCount !== 1 ? t('pages') : t('page');
    const card = document.createElement('div'); card.className = 'nb-card' + (S.activeNbId === nb.id ? ' active' : ''); card.dataset.nbId = nb.id;
    card.style.setProperty('--nb-color', nb.color);
    card.innerHTML = `<div class="nb-card-spine" style="background:${nb.color}"></div>`
      + `<div class="nb-card-body">`
      + `<button class="nb-card-edit-btn" title="${t('edit')}">⋯</button>`
      + `<div class="nb-card-name">${nb.name}</div>`
      + `<div class="nb-card-bg" style="${BG_STYLE[nb.defaultBg]}"></div>`
      + `<div class="nb-card-meta">${pageCount} ${pageLabel}</div>`
      + `</div>`;
    card.querySelector('.nb-card-edit-btn').addEventListener('click', e => { e.stopPropagation(); showCtxMenu(e.clientX, e.clientY, nb.id); });
    card.addEventListener('click', (e) => { if (!_dragState) openNotebook(nb.id); });
    card.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, nb.id); });
    
    // Drag events (pointer events for mouse + touch)
    card.addEventListener('pointerdown', handleDragStart);
    
    grid.appendChild(card);
  }
  
  // Add placeholder element (hidden by default)
  const placeholder = document.createElement('div');
  placeholder.className = 'nb-drop-placeholder';
  placeholder.id = 'nb-drop-placeholder';
  grid.appendChild(placeholder);
}

// New notebook button click handler
E('btn-new-nb').addEventListener('click', () => openNbModal(null));

/* ── DRAG & DROP (Mouse + Touch) ── */
function handleDragStart(e) {
  // Ignore if clicking edit button
  if (e.target.closest('.nb-card-edit-btn')) return;
  
  const card = e.currentTarget;
  const nbId = card.dataset.nbId;
  
  // Start drag after a small delay (to distinguish from click)
  const startX = e.clientX;
  const startY = e.clientY;
  const rect = card.getBoundingClientRect();
  
  let dragStarted = false;
  let longPressTimer = null;
  
  const startDrag = () => {
    if (dragStarted) return;
    dragStarted = true;
    
    // Create floating clone
    const clone = card.cloneNode(true);
    clone.className = 'nb-card nb-drag-clone';
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    document.body.appendChild(clone);
    
    // Hide original
    card.classList.add('dragging');
    
    _dragState = {
      nbId,
      card,
      clone,
      offsetX: startX - rect.left,
      offsetY: startY - rect.top,
      startIdx: S.notebooks.findIndex(nb => nb.id === nbId),
      targetIdx: -1
    };
    
    updateClonePosition(startX, startY);
  };
  
  const onMove = (moveE) => {
    const x = moveE.clientX || (moveE.touches && moveE.touches[0]?.clientX) || startX;
    const y = moveE.clientY || (moveE.touches && moveE.touches[0]?.clientY) || startY;
    
    // Start drag if moved more than 8px
    if (!dragStarted && (Math.abs(x - startX) > 8 || Math.abs(y - startY) > 8)) {
      clearTimeout(longPressTimer);
      startDrag();
    }
    
    if (_dragState) {
      moveE.preventDefault();
      updateClonePosition(x, y);
      updateDropTarget(x, y);
    }
  };
  
  const onEnd = (endE) => {
    clearTimeout(longPressTimer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
    
    if (_dragState) {
      finishDrag();
    }
  };
  
  // For touch: start drag on long press
  longPressTimer = setTimeout(startDrag, 200);
  
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onEnd);
  document.addEventListener('pointercancel', onEnd);
  
  // Prevent text selection
  e.preventDefault();
}

function updateClonePosition(x, y) {
  if (!_dragState || !_dragState.clone) return;
  _dragState.clone.style.left = (x - _dragState.offsetX) + 'px';
  _dragState.clone.style.top = (y - _dragState.offsetY) + 'px';
}

function updateDropTarget(x, y) {
  const grid = E('nb-grid');
  const cards = Array.from(grid.querySelectorAll('.nb-card:not(.dragging):not(.nb-drag-clone)'));
  const placeholder = E('nb-drop-placeholder');
  
  let targetIdx = -1;
  let insertBefore = null;
  
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const rect = card.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    
    if (x < centerX) {
      targetIdx = S.notebooks.findIndex(nb => nb.id === card.dataset.nbId);
      insertBefore = card;
      break;
    }
  }
  
  // If no card found, insert at end (before add button).
  // Gezählt werden nur die eigenen Hefte: geteilte Dokumente hängen hinten
  // in S.notebooks und dürfen die Reihenfolge hier nicht verschieben.
  if (targetIdx === -1) {
    targetIdx = (typeof ownNotebooks === 'function' ? ownNotebooks() : S.notebooks).length;
    insertBefore = grid.querySelector('.nb-add-card');
  }
  
  _dragState.targetIdx = targetIdx;
  
  // Show placeholder
  if (insertBefore && placeholder) {
    placeholder.style.display = 'block';
    grid.insertBefore(placeholder, insertBefore);
  }
}

function finishDrag() {
  if (!_dragState) return;
  
  const { card, clone, startIdx, targetIdx, nbId } = _dragState;
  
  // Remove clone
  if (clone && clone.parentNode) {
    clone.parentNode.removeChild(clone);
  }
  
  // Hide placeholder
  const placeholder = E('nb-drop-placeholder');
  if (placeholder) placeholder.style.display = 'none';
  
  // Show original
  card.classList.remove('dragging');
  
  // Reorder if position changed
  if (targetIdx !== -1 && targetIdx !== startIdx && targetIdx !== startIdx + 1) {
    const actualTarget = targetIdx > startIdx ? targetIdx - 1 : targetIdx;
    const [removed] = S.notebooks.splice(startIdx, 1);
    S.notebooks.splice(actualTarget, 0, removed);
    renderHomeGrid();
  }
  
  _dragState = null;
}

/* ── CTX MENU ── */
let _ctxNbId = null;
function showCtxMenu(x, y, id) { _ctxNbId = id; E('ctx-menu').style.cssText = `display:block;left:${x}px;top:${y}px;position:fixed`; setTimeout(() => document.addEventListener('pointerdown', hideCtxOut), 0); }
function hideCtxMenu() { E('ctx-menu').style.display = 'none'; document.removeEventListener('pointerdown', hideCtxOut); }
function hideCtxOut(e) { if (!e.target.closest('#ctx-menu')) hideCtxMenu(); }
E('ctx-edit').addEventListener('click', () => { hideCtxMenu(); openNbModal(_ctxNbId); });

// Freigabe-Dialog (ui/share.js)
E('ctx-share')?.addEventListener('click', () => {
  hideCtxMenu();
  const nb = getNb(_ctxNbId);
  if (nb && typeof openShareDialog === 'function') openShareDialog(nb);
});

// Remove from overview (keep file)
E('ctx-remove').addEventListener('click', async () => {
  hideCtxMenu();
  const nb = getNb(_ctxNbId);
  if (!nb) return;
  
  // Remove from S.notebooks
  S.notebooks = S.notebooks.filter(n => n.id !== nb.id);
  
  // Remove from registry (but don't delete file)
  await Registry.remove(nb.id);
  
  // Update UI
  if (S.activeNbId === nb.id) {
    S.activeNbId = null;
    showHome();
  } else {
    renderHomeGrid();
  }
  
  toast(t('removedFromOverview'));
});

// In den Papierkorb legen. Die Datei wird nicht mehr sofort gelöscht,
// sondern in den Unterordner "Papierkorb" verschoben (siehe core/trash.js)
// und lässt sich von dort zurückholen.
E('ctx-delete').addEventListener('click', async () => {
  hideCtxMenu();
  const nb = getNb(_ctxNbId);
  if (!nb) return;

  const warningMsg = `"${nb.name}" ${t('moveToTrashConfirm') || 'in den Papierkorb legen?'}\n\n`
    + (t('moveToTrashHint') || 'Du kannst es dort jederzeit zurückholen.');

  if (!await showConfirm(warningMsg)) return;

  const ok = await Trash.moveToTrash(nb);
  if (!ok) { toast(t('saveError'), true); return; }

  S.notebooks = S.notebooks.filter(n => n.id !== nb.id);

  if (S.activeNbId === nb.id) {
    S.activeNbId = null;
    showHome();
  } else {
    renderHomeGrid();
  }

  if (window.updateTrashCount) window.updateTrashCount();
  if (window.resetHomeSearch) window.resetHomeSearch();
  toast(t('movedToTrash') || 'In den Papierkorb gelegt.');
});

/* ── NB MODAL ── */
let _nbEditId = null, _nbColor = NB_COLORS[0], _nbBg = 'ruled';
function openNbModal(editId) {
  _nbEditId = editId; const nb = editId ? getNb(editId) : null;
  E('nb-modal-title').textContent = nb ? t('editNotebookTitle') : t('newNotebookTitle'); 
  E('nb-modal-ok').textContent = nb ? t('save') : t('create');
  E('nb-name-in').value = nb ? nb.name : ''; 
  E('nb-name-in').placeholder = t('notebookNamePlaceholder');
  _nbColor = nb ? nb.color : NB_COLORS[S.notebooks.length % NB_COLORS.length]; _nbBg = nb ? nb.defaultBg : 'ruled';
  const pal = E('nb-color-palette'); pal.innerHTML = '';
  for (const c of NB_COLORS) { const b = document.createElement('button'); b.className = 'cp-swatch' + (c === _nbColor ? ' active' : ''); b.style.background = c; b.addEventListener('click', () => { _nbColor = c;[...pal.querySelectorAll('.cp-swatch')].forEach(x => x.classList.remove('active')); b.classList.add('active'); }); pal.appendChild(b); }
  buildBgRow(E('nb-bg-row'), _nbBg, id => { _nbBg = id; });
  E('ov-nb').style.display = 'flex'; setTimeout(() => E('nb-name-in').focus(), 30);
}
E('nb-modal-cancel').addEventListener('click', () => E('ov-nb').style.display = 'none');
E('nb-modal-ok').addEventListener('click', async () => {
  const name = E('nb-name-in').value.trim(); 
  if (!name) { toast(t('enterName'), true); return; }
  
  // Check for duplicate names in memory
  const duplicate = S.notebooks.find(nb => nb.name.toLowerCase() === name.toLowerCase() && nb.id !== _nbEditId);
  if (duplicate) { toast(t('nameExists'), true); return; }
  
  if (_nbEditId) { 
    const nb = getNb(_nbEditId); 
    nb.name = name; nb.color = _nbColor; nb.defaultBg = _nbBg; 
    getSections(nb).forEach(s => s.defaultBg = _nbBg); 
    E('ov-nb').style.display = 'none'; 
    if (S.activeNbId === _nbEditId) { setTitleBar(name, _nbColor); renderSideTree(); } 
    renderHomeGrid(); 
    toast(t('notebookUpdated')); 
    
    // Save immediately after edit
    const editedNb = getNb(_nbEditId);
    if (editedNb) {
      FileManager_.saveNotebook(editedNb).catch(err => console.error('[HomeGrid] Save after edit failed:', err));
    }
  }
  else { 
    // Ensure we have a save location; if not, prompt the user (default: Documents/Inkwell)
    let saveLocation = Settings.get('saveLocation');
    if (!saveLocation) {
      try {
        const defaultPath = await window.api.getDefaultSavePath();
        const picked = await window.api.pickFolder(defaultPath);
        if (!picked) {
          toast('Speicherort erforderlich', true);
          return; // don't create notebook without a save location
        }
        await Settings.update({ saveLocation: picked });
        saveLocation = picked;
      } catch (err) {
        console.error('[HomeGrid] Failed to pick folder:', err);
        toast(t('saveError'), true);
        return;
      }
    }

    // Check if file already exists on disk (now that we have a saveLocation)
    if (saveLocation) {
      const safeName = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
      const filePath = `${saveLocation}\\${safeName}.jrnl`;
      const exists = await window.api.fileExists(filePath);
      if (exists) {
        toast(t('fileExists'), true);
        return;
      }
    }
    
    const nb = { id: uid(), name, color: _nbColor, defaultBg: _nbBg, pages: [], sections: [] }; 
    const pg = makePage(nb.defaultBg); 
    nb.pages.push(pg); 
    nb.sections = [{ id: uid(), name: 'Allgemein', pgIds: [pg.id], defaultBg: nb.defaultBg }]; 
    S.notebooks.push(nb);
    // Refresh home grid so new notebook appears immediately in overview
    try { renderHomeGrid(); } catch (err) { console.error('[HomeGrid] renderHomeGrid after create failed:', err); }
    E('ov-nb').style.display = 'none'; 
    
    // Save immediately after creation
    try {
      await FileManager_.saveNotebook(nb);
      console.log('[HomeGrid] Notebook saved immediately after creation');
    } catch (err) {
      console.error('[HomeGrid] Failed to save new notebook:', err);
    }
    
    openNotebook(nb.id); 
  }
});
document.addEventListener('keydown', e => { if (E('ov-nb').style.display !== 'none' && e.key === 'Enter') E('nb-modal-ok').click(); if (E('ov-nb').style.display !== 'none' && e.key === 'Escape') E('ov-nb').style.display = 'none'; });
