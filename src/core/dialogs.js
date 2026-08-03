'use strict';

function showAlert(msg) {
  E('alert-msg').textContent = msg;
  E('ov-alert').style.display = 'flex';
  return new Promise(res => {
    const ok = () => { E('ov-alert').style.display = 'none'; res(); off(); };
    const kd = e => { if (e.key === 'Enter' || e.key === 'Escape') ok(); };
    function off() { E('alert-ok').onclick = null; document.removeEventListener('keydown', kd); }
    E('alert-ok').onclick = ok; document.addEventListener('keydown', kd);
  });
}

function showConfirm(msg) {
  E('confirm-msg').textContent = msg;
  E('ov-confirm').style.display = 'flex';
  return new Promise(res => {
    const ok = () => { E('ov-confirm').style.display = 'none'; res(true); off(); };
    const cancel = () => { E('ov-confirm').style.display = 'none'; res(false); off(); };
    const kd = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); };
    function off() { E('confirm-ok').onclick = null; E('confirm-cancel').onclick = null; document.removeEventListener('keydown', kd); }
    E('confirm-ok').onclick = ok; E('confirm-cancel').onclick = cancel;
    document.addEventListener('keydown', kd);
  });
}

/* Hinweis vor der Microsoft-Anmeldung. Der Text steht fest im Fenster
   (index.html), deshalb nimmt die Funktion keine Nachricht entgegen.
   Liefert true, wenn weitergemacht werden soll. */
function showMsHint() {
  E('ov-ms-hint').style.display = 'flex';
  return new Promise(res => {
    const ok = () => { E('ov-ms-hint').style.display = 'none'; res(true); off(); };
    const cancel = () => { E('ov-ms-hint').style.display = 'none'; res(false); off(); };
    const kd = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); };
    function off() { E('ms-hint-ok').onclick = null; E('ms-hint-cancel').onclick = null; document.removeEventListener('keydown', kd); }
    E('ms-hint-ok').onclick = ok; E('ms-hint-cancel').onclick = cancel;
    document.addEventListener('keydown', kd);
  });
}

// Returns 'save', 'leave', or null (cancelled)
function showSaveConfirm(msg) {
  E('save-confirm-msg').textContent = msg;
  E('ov-save-confirm').style.display = 'flex';
  return new Promise(res => {
    const save = () => { E('ov-save-confirm').style.display = 'none'; res('save'); off(); };
    const leave = () => { E('ov-save-confirm').style.display = 'none'; res('leave'); off(); };
    const cancel = () => { E('ov-save-confirm').style.display = 'none'; res(null); off(); };
    const kd = e => { if (e.key === 'Escape') cancel(); };
    function off() { 
      E('save-confirm-save').onclick = null; 
      E('save-confirm-leave').onclick = null; 
      document.removeEventListener('keydown', kd); 
    }
    E('save-confirm-save').onclick = save; 
    E('save-confirm-leave').onclick = leave;
    document.addEventListener('keydown', kd);
  });
}

function showInsertChoice() {
  E('ov-insert-choice').style.display = 'flex';
  return new Promise(res => {
    const asImg = () => { E('ov-insert-choice').style.display = 'none'; res('img'); off(); };
    const asPage = () => { E('ov-insert-choice').style.display = 'none'; res('page'); off(); };
    function off() { E('insert-as-img').onclick = null; E('insert-as-page').onclick = null; }
    E('insert-as-img').onclick = asImg; E('insert-as-page').onclick = asPage;
  });
}

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  E('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function txtModal(title, val = '') {
  E('txt-modal-h').textContent = title;
  E('txt-modal-in').value = val;
  E('ov-txt').style.display = 'flex';
  setTimeout(() => { E('txt-modal-in').focus(); E('txt-modal-in').select(); }, 30);
  return new Promise(res => {
    const ok = () => { E('ov-txt').style.display = 'none'; res(E('txt-modal-in').value.trim() || null); off(); };
    const cancel = () => { E('ov-txt').style.display = 'none'; res(null); off(); };
    const kd = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); };
    function off() { E('txt-modal-ok').onclick = null; E('txt-modal-cancel').onclick = null; document.removeEventListener('keydown', kd); }
    E('txt-modal-ok').onclick = ok; E('txt-modal-cancel').onclick = cancel; document.addEventListener('keydown', kd);
  });
}

function buildBgRow(cont, cur, onChange) {
  cont.innerHTML = '';
  for (const bg of BG_TYPES) {
    const b = document.createElement('button');
    b.className = 'bg-sw' + (cur === bg.id ? ' active' : '');
    b.title = bg.label;
    b.style.cssText = BG_STYLE[bg.id];
    b.dataset.id = bg.id;
    b.addEventListener('click', () => {
      [...cont.querySelectorAll('.bg-sw')].forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      onChange(bg.id);
    });
    cont.appendChild(b);
  }
}

function setTitleBar(name, color) {
  const txt = E('tbar-title-text');
  if (txt) txt.textContent = name || 'Inkwell';
  const accent = E('tbar-title-accent');
  if (!accent) return;
  if (color) {
    accent.style.display = 'inline-block';
    accent.style.background = color;
  } else {
    accent.style.display = 'none';
    accent.style.background = '';
  }
}

function showHome() {
  E('view-home').style.display = 'flex';
  E('view-journal').style.display = 'none';
  E('btn-home').style.display = 'none';
  E('app-logo').style.display = '';
  setTitleBar('Inkwell', null);
  /* Reihenfolge: erst aufräumen, dann den Nur-Lese-Modus abschalten.
     Das Aufräumen schreibt noch ausstehende Änderungen weg und braucht
     dafür S.sharedDoc – applyReadOnlyChrome(false, null) setzt es auf null. */
  if (typeof window.closeOpenSharedDoc === 'function') window.closeOpenSharedDoc();
  applyReadOnlyChrome(false, null);
  renderHomeGrid();
  if (typeof window.refreshSharedTab === 'function') window.refreshSharedTab();
}

function showJournal(nb) {
  E('view-home').style.display = 'none';
  E('view-journal').style.display = 'flex';
  E('btn-home').style.display = 'flex';
  E('app-logo').style.display = 'none';
  setTitleBar(nb.name, nb.color);
}

/**
 * Schaltet die Oberfläche zwischen „ganz normal" und „nur lesen" um.
 * Der Streifen über dem Editor sagt, von wem das Dokument kommt; die
 * Werkzeugleiste wird über die Klasse am <body> abgeblendet (layout.css).
 *
 * @param {boolean} readOnly
 * @param {object|null} sharedDoc { role, ownerName, ownerEmail, title }
 */
function applyReadOnlyChrome(readOnly, sharedDoc) {
  S.readOnly = !!readOnly;
  S.sharedDoc = sharedDoc || null;

  document.body.classList.toggle('read-only', !!readOnly);

  const bar = E('shared-bar');
  if (!bar) return;

  if (!sharedDoc) {
    bar.style.display = 'none';
    return;
  }

  /* Der Besitzer ist mitten in der Arbeit weggebrochen: das Recht steht
     weiter auf „bearbeiten", ausgeübt wird es gerade nicht. Der Streifen
     muss den ruhenden Zustand zeigen, sonst steht dort „bearbeiten",
     während nichts geht (Erklärung in ui/sharedDocs.js). */
  const canEdit = sharedDoc.role === 'edit' && !sharedDoc.ownerLost;
  bar.style.display = 'flex';

  const roleEl = E('shared-bar-role');
  if (roleEl) {
    roleEl.textContent = sharedDoc.ownerLost
      ? (t('roleOwnerOffline') || t('roleView'))
      : (canEdit ? t('roleEdit') : t('roleView'));
  }

  /* Beim Besitzer steht dort nicht „freigegeben von …" – er ist es ja
     selbst. Stattdessen der Hinweis, dass das Heft gerade live geteilt
     ist, und der Knopf zum Verlassen verschwindet. */
  const textEl = E('shared-bar-text');
  if (textEl) {
    if (sharedDoc.isOwner) {
      textEl.textContent = t('sharedOwnerLine') || 'Live geteilt';
    } else {
      const who = sharedDoc.ownerName || sharedDoc.ownerEmail || '?';
      textEl.textContent = (t('sharedByLine') || 'Freigegeben von {name}').replace('{name}', who);
    }
  }

  const leaveBtn = E('shared-bar-leave');
  if (leaveBtn) leaveBtn.style.display = sharedDoc.isOwner ? 'none' : '';
}
