'use strict';

/* ══════════════════════════════════════════════════════════
   SIDE TREE — sections + headings unified
   ══════════════════════════════════════════════════════════ */
const _secCollapsed = new Set();
const _navCollapsed = new Set(); // h1 key → collapsed

// Helper to get display name for section (translates default "Allgemein")
function getSectionDisplayName(sec) {
  if (sec.name === 'Allgemein' || sec.name === 'General' || sec.name === 'Generale') {
    return t('general');
  }
  return sec.name;
}

function renderSideTree() {
  const nb = getNb(); const tree = E('side-tree'); tree.innerHTML = ''; if (!nb) return;
  getSections(nb);
  for (const sec of nb.sections) {
    const isActiveSec = nb.activeSecId === sec.id;
    const isCollapsed = _secCollapsed.has(sec.id);
    const pages = pagesOfSec(sec, nb);
    const displayName = getSectionDisplayName(sec);

    /* ─ Section header ─ */
    const hdr = document.createElement('div');
    hdr.className = 'sec-hdr' + (isActiveSec ? ' active' : '') + (isCollapsed ? ' collapsed' : '');
    hdr.innerHTML = '<span class="sec-arrow">▼</span><span class="sec-name">' + displayName + '</span>'
      + '<span class="sec-pg-count">' + pages.length + '</span>'
      + '<button class="sec-edit-btn" title="' + t('manageSections') + '">✎</button>';
    hdr.querySelector('.sec-edit-btn').addEventListener('click', e => { e.stopPropagation(); openSecMgr(sec); });
    // Double-click on name → rename
    hdr.querySelector('.sec-name').addEventListener('dblclick', e => { e.stopPropagation(); txtModal(t('rename'), sec.name).then(n => { if (n) { sec.name = n; renderSideTree(); if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty(); } }); });
    hdr.addEventListener('click', () => {
      const wasActive = nb.activeSecId === sec.id;
      if (wasActive) {
        // toggle collapse
        if (_secCollapsed.has(sec.id)) _secCollapsed.delete(sec.id); else _secCollapsed.add(sec.id);
        renderSideTree();
      } else {
        openSection(sec); // always renders pages + tree
      }
    });
    tree.appendChild(hdr);

    /* ─ Section body ─ */
    const body = document.createElement('div');
    body.className = 'sec-body' + (isCollapsed ? ' collapsed' : '');
    body.style.maxHeight = isCollapsed ? '0' : '2000px';

    if (isActiveSec) {
      /* Active heading: find which heading the cursor is currently in,
         then mark that nav-item as active after rendering */
      // (handled below via _activeHdgText)
      const _activePgEl = E('pg-scroll').querySelector('[data-pgid="' + (S.activePgId || '') + '"]');
      let _activeHdgText = '';
      if (_activePgEl) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          let node = sel.anchorNode;
          while (node && node !== _activePgEl) {
            if (node.nodeType === 1) {
              const el = node;
              if (/^H[123]$/.test(el.tagName) || el.classList?.contains('j-title-1') || el.classList?.contains('j-title-2') || el.classList?.contains('j-title-3')) {
                _activeHdgText = el.textContent;
                break;
              }
            }
            node = node.parentNode;
          }
        }
      }

      /* Headings from all pages in section */
      let h1Key = null, subWrap = null;
      for (let pi = 0; pi < pages.length; pi++) {
        const pg = pages[pi];
        const livePgEl = E('pg-scroll').querySelector('[data-pgid="' + pg.id + '"]');
        let hdgs = livePgEl ? [...livePgEl.querySelectorAll('.j-text h1,.j-text h2,.j-text h3,.j-text p.j-title-1,.j-text p.j-title-2,.j-text p.j-title-3')]
          : ([...((d => { d.innerHTML = pg.textContent || ''; return d; })(document.createElement('div'))).querySelectorAll('h1,h2,h3,p.j-title-1,p.j-title-2,p.j-title-3')]);
        if (!hdgs.length) continue;
        hdgs.forEach(h => {
          const lvl = h.classList?.contains('j-title-1') ? 'h1' : h.classList?.contains('j-title-2') ? 'h2' : h.classList?.contains('j-title-3') ? 'h3' : h.tagName.toLowerCase();
          if (lvl === 'h1') {
            h1Key = pi + '_' + h.textContent;
            const isColH1 = _navCollapsed.has(h1Key);
            const isActiveH1 = _activeHdgText && h.textContent === _activeHdgText;
            const row = document.createElement('li'); row.className = 'nav-item' + (isActiveH1 ? ' nav-active' : ''); row.dataset.level = 'h1';
            row.innerHTML = '<span class="nav-collapse-arrow">' + (isColH1 ? '▶' : '▼') + '</span><span class="nav-item-text">' + h.textContent + '</span><span class="nav-pg-badge">S.' + (pi + 1) + '</span>';
            const arr = row.querySelector('.nav-collapse-arrow');
            arr.addEventListener('click', ev => { ev.stopPropagation(); if (_navCollapsed.has(h1Key)) _navCollapsed.delete(h1Key); else _navCollapsed.add(h1Key); arr.textContent = _navCollapsed.has(h1Key) ? '▶' : '▼'; if (subWrap) subWrap.style.display = _navCollapsed.has(h1Key) ? 'none' : 'block'; });
            row.querySelector('.nav-item-text').addEventListener('click', () => scrollToHdg(h, lvl, pg));
            body.appendChild(row);
            subWrap = document.createElement('ul'); subWrap.style.cssText = 'list-style:none;padding:0;margin:0;display:' + (isColH1 ? 'none' : 'block');
            body.appendChild(subWrap);
          } else {
            const wrap = subWrap || body;
            const isActiveH = _activeHdgText && h.textContent === _activeHdgText;
            const item = document.createElement('li'); item.className = 'nav-item' + (isActiveH ? ' nav-active' : ''); item.dataset.level = lvl;
            item.innerHTML = '<span class="nav-dot"></span><span class="nav-item-text">' + h.textContent + '</span><span class="nav-pg-badge">S.' + (pi + 1) + '</span>';
            item.querySelector('.nav-item-text').addEventListener('click', () => scrollToHdg(h, lvl, pg));
            wrap.appendChild(item);
          }
        });
      }
    }

    tree.appendChild(body);
  }
}

function scrollToHdg(h, lvl, pg) {
  setActivePg(pg.id);
  const pgEl = E('pg-scroll').querySelector('[data-pgid="' + pg.id + '"]'); if (!pgEl) return;
  const t = pgEl.querySelector('.j-text'); if (!t) return;
  const selector = lvl === 'h1' ? 'h1,p.j-title-1' : lvl === 'h2' ? 'h2,p.j-title-2' : 'h3,p.j-title-3';
  const target = [...t.querySelectorAll(selector)].find(el => el.textContent === h.textContent);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setActivePg(pgId) {
  S.activePgId = pgId;
  // In einem geteilten Dokument zieht der eigene Marker mit auf die Seite,
  // auf der man gerade ist (ui/collab.js).
  if (window.Collab) Collab.notePage(pgId);
}

function renumberVisiblePages() {
  QA('#pages-wrap .j-page').forEach((pgEl, idx) => {
    const label = pgEl.querySelector('.j-page-num');
    if (label) label.textContent = 'Seite ' + (idx + 1);
  });
}

let _secMgrFocusSecId = null;
let _secMgrCtxMenu = null;

function ensureSecMgrCtxMenu() {
  if (_secMgrCtxMenu) return _secMgrCtxMenu;
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.display = 'none';
  document.body.appendChild(menu);
  _secMgrCtxMenu = menu;

  document.addEventListener('pointerdown', e => {
    if (!_secMgrCtxMenu) return;
    if (!_secMgrCtxMenu.contains(e.target)) _secMgrCtxMenu.style.display = 'none';
  });
  window.addEventListener('scroll', () => {
    if (_secMgrCtxMenu) _secMgrCtxMenu.style.display = 'none';
  }, { passive: true });
  return _secMgrCtxMenu;
}

function showSecMgrPageMenu(x, y, sec, page) {
  const nb = getNb();
  if (!nb || !sec || !page) return;
  const menu = ensureSecMgrCtxMenu();
  menu.innerHTML = '';

  const mkBtn = (label, handler, danger = false) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctx-item' + (danger ? ' danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      menu.style.display = 'none';
      await handler();
    });
    return btn;
  };

  menu.appendChild(mkBtn(t('open'), async () => {
    nb.activeSecId = sec.id;
    openSection(sec, page.id);
    closeSecMgr();
  }));

  if (nb.sections.length > 1) {
    menu.appendChild(mkBtn(t('moveToSection'), async () => {
      const candidates = nb.sections.filter(s => s.id !== sec.id);
      const names = candidates.map(s => getSectionDisplayName(s));
      const targetName = await txtModal(t('moveToSection'), names[0] || '');
      if (!targetName) return;
      const target = candidates.find(s => getSectionDisplayName(s) === targetName || s.name === targetName);
      if (!target) {
        toast(t('cancelled'), true);
        return;
      }
      sec.pgIds = (sec.pgIds || []).filter(id => id !== page.id);
      target.pgIds = [...(target.pgIds || []), page.id];
      if (nb.activeSecId === sec.id && S.activePgId === page.id) {
        nb.activeSecId = target.id;
        openSection(target, page.id);
      }
      renderSideTree();
      renderSecMgrBody(target.id);
    }));
  }

  menu.appendChild(mkBtn(t('deletePage'), async () => {
    await deletePageFromSection(sec, page);
  }, true));

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.display = 'block';
}

async function deletePageFromSection(sec, page) {
  const nb = getNb();
  if (!nb || !sec || !page) return;
  if ((nb.pages || []).length <= 1) {
    await showAlert('Mindestens eine Seite muss erhalten bleiben.');
    return;
  }

  const ok = await confModal(t('deletePage') + '?');
  if (!ok) return;

  sec.pgIds = (sec.pgIds || []).filter(id => id !== page.id);
  nb.pages = (nb.pages || []).filter(p => p.id !== page.id);

  if (!sec.pgIds.length) {
    const fallback = makePage(sec.defaultBg || nb.defaultBg || 'ruled');
    nb.pages.push(fallback);
    sec.pgIds.push(fallback.id);
  }

  if (S.activePgId === page.id) {
    const activeSec = nb.sections.find(s => s.id === nb.activeSecId) || sec;
    const nextId = activeSec.pgIds?.[0] || sec.pgIds?.[0];
    openSection(activeSec, nextId);
  }

  renderSideTree();
  renderSecMgrBody(sec.id);
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

function addPageToSection(sec) {
  const nb = getNb();
  if (!nb || !sec) return;
  const pg = makePage(sec.defaultBg || nb.defaultBg || 'ruled');
  nb.pages.push(pg);
  sec.pgIds = [...(sec.pgIds || []), pg.id];

  if (nb.activeSecId === sec.id) openSection(sec, pg.id);
  else renderSideTree();

  renderSecMgrBody(sec.id);
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

async function addSectionFromManager() {
  const nb = getNb();
  if (!nb) return;
  const name = await txtModal(t('newSection'), t('newSection'));
  if (!name) return;

  getSections(nb);
  const pg = makePage(nb.defaultBg || 'ruled');
  nb.pages.push(pg);
  const sec = { id: uid(), name, pgIds: [pg.id], defaultBg: nb.defaultBg };
  nb.sections.push(sec);
  renderSideTree();
  renderSecMgrBody(sec.id);
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

function closeSecMgr() {
  const ov = E('ov-sec-mgr');
  if (ov) ov.style.display = 'none';
  if (_secMgrCtxMenu) _secMgrCtxMenu.style.display = 'none';
}

function renderSecMgrBody(focusSecId) {
  const nb = getNb();
  const body = E('sec-mgr-body');
  if (!nb || !body) return;

  _secMgrFocusSecId = focusSecId || _secMgrFocusSecId;
  getSections(nb);
  body.innerHTML = '';

  const mk = (tag, cls, txt) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (txt) el.textContent = txt;
    return el;
  };

  for (const sec of nb.sections) {
    const secEl = mk('div', 'mgr-sec');
    const hdr = mk('div', 'mgr-sec-hdr');
    
    const dot = mk('span', 'mgr-sec-dot');
    dot.style.background = (nb.color || '#7a6f5c');
    
    const name = mk('span', 'mgr-sec-name', getSectionDisplayName(sec));
    const count = mk('span', 'mgr-sec-count', (sec.pgIds?.length || 0) + ' ' + t('pages'));
    const actions = mk('div', 'mgr-sec-actions');

    const renameBtn = mk('button', 'mgr-btn', t('rename'));
    renameBtn.addEventListener('click', async () => {
      const nextName = await txtModal(t('rename'), sec.name || '');
      if (!nextName) return;
      sec.name = nextName;
      renderSideTree();
      renderSecMgrBody(sec.id);
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    });

    const delBtn = mk('button', 'mgr-btn danger', t('delete'));
    delBtn.disabled = nb.sections.length <= 1;
    delBtn.addEventListener('click', async () => {
      if (nb.sections.length <= 1) return;
      const ok = await confModal(t('delete') + ' "' + getSectionDisplayName(sec) + '"?');
      if (!ok) return;

      const target = nb.sections.find(s => s.id !== sec.id);
      if (!target) return;

      target.pgIds = [...(target.pgIds || []), ...(sec.pgIds || [])];
      nb.sections = nb.sections.filter(s => s.id !== sec.id);

      if (nb.activeSecId === sec.id) {
        nb.activeSecId = target.id;
        openSection(target);
      }

      renderSideTree();
      renderSecMgrBody(target.id);
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    });

    const addPgBtn = mk('button', 'mgr-btn', '+ ' + t('addPage'));
    addPgBtn.addEventListener('click', () => addPageToSection(sec));

    actions.append(renameBtn, addPgBtn, delBtn);
    hdr.append(dot, name, count, actions);
    secEl.appendChild(hdr);

    const pgList = mk('div', 'mgr-pg-list');
    const secPages = pagesOfSec(sec, nb);
    if (!secPages.length) {
      pgList.appendChild(mk('div', 'mgr-sec-empty', 'Keine Seiten'));
    } else {
      secPages.forEach((pg, idx) => {
        const item = mk('div', 'mgr-pg-item');
        item.innerHTML = '<span class="mgr-pg-num">S.' + (idx + 1) + '</span>'
          + '<div class="mgr-pg-info"><span class="mgr-pg-date">' + new Date(pg.date).toLocaleDateString() + '</span>'
          + '<span class="mgr-pg-preview">' + (pagePreview(pg) || 'Leer') + '</span></div>';

        const right = mk('div', 'mgr-pg-right');

        const openBtn = mk('button', 'mgr-mv-btn', t('open'));
        openBtn.type = 'button';
        openBtn.addEventListener('click', () => {
          nb.activeSecId = sec.id;
          openSection(sec, pg.id);
          closeSecMgr();
        });

        const delPgBtn = mk('button', 'mgr-pg-del', '✕');
        delPgBtn.type = 'button';
        delPgBtn.title = t('deletePage');
        delPgBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await deletePageFromSection(sec, pg);
        });

        right.append(openBtn, delPgBtn);
        item.appendChild(right);

        item.addEventListener('contextmenu', e => {
          e.preventDefault();
          showSecMgrPageMenu(e.clientX, e.clientY, sec, pg);
        });
        pgList.appendChild(item);
      });
    }

    secEl.appendChild(pgList);
    body.appendChild(secEl);

    if (focusSecId && focusSecId === sec.id) {
      requestAnimationFrame(() => {
        secEl.scrollIntoView({ block: 'nearest' });
      });
    }
  }
}

function openSecMgr(sec) {
  const ov = E('ov-sec-mgr');
  const closeBtn = E('sec-mgr-close');
  const doneBtn = E('sec-mgr-done');
  const addSecBtn = E('sec-mgr-add-sec');
  const addPageBtn = E('sec-mgr-add-page');
  if (!ov || !closeBtn || !doneBtn || !addSecBtn || !addPageBtn) return;

  renderSecMgrBody(sec?.id || _secMgrFocusSecId);
  ov.style.display = 'grid';

  closeBtn.onclick = () => closeSecMgr();
  doneBtn.onclick = () => closeSecMgr();
  addSecBtn.onclick = async () => {
    await addSectionFromManager();
  };
  addPageBtn.onclick = () => {
    const nb = getNb();
    if (!nb) return;
    const target = nb.sections.find(s => s.id === (_secMgrFocusSecId || sec?.id)) || nb.sections[0];
    if (!target) return;
    addPageToSection(target);
  };
  ov.onclick = (e) => {
    if (e.target === ov) closeSecMgr();
  };
}

/* ── ADD SECTION ── */
E('btn-add-sec').addEventListener('click', () => {
  // Fremdes Dokument ohne Bearbeitungsrecht: nichts anlegen
  if (S.readOnly) { toast(t('sharedNoRight')); return; }

  txtModal(t('newSection'), t('newSection')).then(name => {
    if (!name) return; const nb = getNb(); if (!nb) return;
    getSections(nb);
    const pg = makePage(nb.defaultBg || 'ruled');
    nb.pages.push(pg);
    const sec = { id: uid(), name, pgIds: [pg.id], defaultBg: nb.defaultBg };
    nb.sections.push(sec);
    renderSideTree();
    openSection(sec);
    toast(t('sectionCreated').replace('{name}', name));
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  });
});
