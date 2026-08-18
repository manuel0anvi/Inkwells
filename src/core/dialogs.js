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

/**
 * Fragt, welche Seiten in welches Heft sollen.
 *
 * @param {object} fromNb          Ausgangsheft
 * @param {object[]} targets       Hefte, die als Ziel in Frage kommen
 * @param {string[]} [preselected] Seiten, die schon angehakt sein sollen
 * @returns {Promise<{pageIds: string[], toNb: object, copy: boolean,
 *          keepSection: boolean}|null>} null = abgebrochen
 *
 * Baut nur die Liste auf und liefert die Entscheidung zurück – bewegt
 * selbst nichts. Das tut transferPages() in core/data.js.
 */
function showPageTransferDialog(fromNb, targets, preselected = []) {
  const list = E('pt-list');
  const sel = E('pt-target-sel');
  const countEl = E('pt-count');
  list.innerHTML = '';
  sel.innerHTML = '';

  for (const nb of targets) {
    const opt = document.createElement('option');
    opt.value = nb.id;
    // Geteilte Dokumente kenntlich machen – sie sehen sonst aus wie eigene
    opt.textContent = nb.name + (nb.origin === 'shared' ? ' (' + t('sharedWithMe') + ')' : '');
    sel.appendChild(opt);
  }

  const picked = new Set(preselected.map(String));

  // Die Seiten in der Reihenfolge des Hefts – dieselbe Quelle wie überall
  const rows = notebookPages(fromNb).map(page => ({ page }));

  const keepRow = E('pt-keepsec-row');
  const keepBox = E('pt-keepsec');

  const refreshCount = () => {
    countEl.textContent = t('transferCount').replace('{n}', String(picked.size));
    E('pt-move').disabled = picked.size === 0 || !sel.value;
    E('pt-copy').disabled = picked.size === 0 || !sel.value;

    /* Die Frage nach dem Abschnitt nur stellen, wenn es einen gibt.
       Sonst stünde da eine Wahl ohne Gegenstand. */
    if (keepRow) {
      const mitAbschnitt = notebookPages(fromNb)
        .some(p => picked.has(String(p.id)) && p.secId);
      keepRow.style.display = mitAbschnitt ? '' : 'none';
    }
  };

  rows.forEach((row, idx) => {
    const item = document.createElement('div');
    item.className = 'mgr-pg-item';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'pt-check';
    box.checked = picked.has(String(row.page.id));

    const num = document.createElement('span');
    num.className = 'mgr-pg-num';
    num.textContent = 'S.' + (idx + 1);

    const info = document.createElement('div');
    info.className = 'mgr-pg-info';
    const date = document.createElement('span');
    date.className = 'mgr-pg-date';
    date.textContent = new Date(row.page.date).toLocaleDateString();
    const prev = document.createElement('span');
    prev.className = 'mgr-pg-preview';
    prev.textContent = pagePreview(row.page) || t('emptyPage');
    info.append(date, prev);

    const paint = () => {
      item.classList.toggle('picked', box.checked);
      if (box.checked) picked.add(String(row.page.id));
      else picked.delete(String(row.page.id));
      refreshCount();
    };

    box.addEventListener('click', e => e.stopPropagation());
    box.addEventListener('change', paint);
    // Die ganze Zeile schaltet mit – ein 15px-Kästchen zu treffen nervt
    item.addEventListener('click', () => { box.checked = !box.checked; paint(); });

    item.append(box, num, info);
    item.classList.toggle('picked', box.checked);
    list.appendChild(item);
  });

  if (keepBox) keepBox.checked = true;   // der Normalfall: mitnehmen
  refreshCount();
  E('ov-page-transfer').style.display = 'flex';

  return new Promise(res => {
    const finish = (copy) => {
      if (!picked.size || !sel.value) return;
      const toNb = targets.find(nb => nb.id === sel.value);
      if (!toNb) return;
      const keepSection = !!(keepBox && keepBox.checked
        && keepRow && keepRow.style.display !== 'none');
      close();
      res({ pageIds: [...picked], toNb, copy, keepSection });
    };
    const cancel = () => { close(); res(null); };
    const setAll = (on) => {
      picked.clear();
      if (on) for (const row of rows) picked.add(String(row.page.id));
      for (const [i, item] of [...list.children].entries()) {
        item.querySelector('.pt-check').checked = on;
        item.classList.toggle('picked', on);
        void i;
      }
      refreshCount();
    };
    const kd = e => { if (e.key === 'Escape') cancel(); };

    function close() {
      E('ov-page-transfer').style.display = 'none';
      E('pt-close').onclick = null;
      E('pt-move').onclick = null;
      E('pt-copy').onclick = null;
      E('pt-all').onclick = null;
      E('pt-none').onclick = null;
      sel.onchange = null;
      document.removeEventListener('keydown', kd);
    }

    E('pt-close').onclick = cancel;
    E('pt-move').onclick = () => finish(false);
    E('pt-copy').onclick = () => finish(true);
    E('pt-all').onclick = () => setAll(true);
    E('pt-none').onclick = () => setAll(false);
    sel.onchange = refreshCount;
    document.addEventListener('keydown', kd);
  });
}

/* showSaveConfirm ist entfallen – die Frage „speichern oder verwerfen?"
   gibt es nicht mehr. Gestellt wurde sie nur, solange sich das
   automatische Speichern abschalten liess (core/autoSave.js); ohne den
   Schalter ist auf dem Weg zur Uebersicht ohnehin alles gesichert. */

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
  if (txt) txt.textContent = name || 'Inkwells';
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
  // Seite und Ausschnitt festhalten, bevor das Heft aus dem Blick gerät
  if (typeof flushNotebookView === 'function') flushNotebookView();

  /* ── Beim Zumachen geht das Heft SOFORT hinauf ──────────────────────
     Der Mindestabstand von einer Minute (MIN_UPLOAD_INTERVAL_MS) bremst
     die Wiederholung desselben Hefts, solange man darin schreibt. Beim
     Zumachen schreibt aber niemand mehr – dort ist er nur noch eine
     Wartezeit, in der ein fertiges Heft ungesichert liegen bleibt.

     Zwei Faelle, und beide muessen hier durch:

       · noch nicht gespeichert  -> saveNow() schreibt die Datei UND
         laedt sofort hoch (immediateCloud)
       · schon gespeichert, aber der Upload haengt an der Bremse
         -> flushNotebook() nimmt sie fuer dieses eine Heft zurueck

     Der zweite Fall war die Luecke: ui/titlebar.js rief saveNow() nur
     bei ungespeicherten Aenderungen. Lokal gespeichert, aber noch nicht
     oben – genau dazwischen fiel das Heft hindurch.

     Hier und nicht im Heim-Knopf, weil jeder Weg zurueck durch diese
     Funktion laeuft: der Knopf, das Tastenkuerzel, ein entzogenes
     geteiltes Dokument.

     Ohne await: die Ansicht soll nicht auf die Leitung warten. */
  const verlassen = (typeof S !== 'undefined') ? S.activeNbId : null;
  if (verlassen && typeof AutoSave !== 'undefined' && AutoSave) {
    try {
      if (AutoSave.isDirty(verlassen)) {
        AutoSave.saveNow(verlassen).catch(err =>
          console.warn('[Home] Speichern beim Verlassen:', err?.message || err));
      } else if (typeof CloudSync_ !== 'undefined' && CloudSync_?.flushNotebook) {
        CloudSync_.flushNotebook(verlassen);
      }
    } catch (err) {
      console.warn('[Home] Hochladen beim Verlassen:', err?.message || err);
    }
  }
  E('view-home').style.display = 'flex';
  E('view-journal').style.display = 'none';
  E('btn-home').style.display = 'none';
  E('app-logo').style.display = '';
  setTitleBar('Inkwells', null);
  /* Reihenfolge: erst aufräumen, dann den Nur-Lese-Modus abschalten.
     Das Aufräumen schreibt noch ausstehende Änderungen weg und braucht
     dafür S.sharedDoc – applyReadOnlyChrome(false, null) setzt es auf null. */
  if (typeof window.closeOpenSharedDoc === 'function') window.closeOpenSharedDoc();
  applyReadOnlyChrome(false, null);
  renderHomeGrid();
  if (typeof window.refreshSharedTab === 'function') window.refreshSharedTab();
  /* Der Sync-Knopf haengt an der Ansicht: ohne Anmeldung steht er nur
     im geoeffneten Heft (ui/syncPanel.js). Ohne diesen Anstoss bliebe
     er, bis der Taktgeber ihn zufaellig auffrischt. */
  if (typeof window.updateSaveStatus === 'function') window.updateSaveStatus();
}

function showJournal(nb) {
  E('view-home').style.display = 'none';
  E('view-journal').style.display = 'flex';
  E('btn-home').style.display = 'flex';
  E('app-logo').style.display = 'none';
  setTitleBar(nb.name, nb.color);
  if (typeof window.updateSaveStatus === 'function') window.updateSaveStatus();
}

/**
 * Setzt das Schreibrecht an allen Seiten, die schon auf dem Bildschirm
 * stehen.
 *
 * >>> Warum das nötig ist <<<
 * `contenteditable` wurde bisher nur EINMAL gesetzt, beim Aufbau der
 * Seite (appendPageDOM in app.js). Stufte der Besitzer jemanden während
 * der laufenden Sitzung auf „nur lesen" herab, wurde zwar S.readOnly
 * umgelegt und die Werkzeugleiste abgeblendet – die Textfelder blieben
 * aber beschreibbar. Die Oberfläche sah gesperrt aus, getippt werden
 * konnte trotzdem, und beim nächsten Heraufstufen wäre das Getippte
 * über syncStructure sogar noch bei allen anderen gelandet.
 *
 * @param {boolean} readOnly
 */
function applyEditableToPages(readOnly) {
  const wrap = E('pages-wrap');
  if (!wrap) return;

  const felder = wrap.querySelectorAll('.j-text');
  felder.forEach((textDiv, index) => {
    textDiv.contentEditable = readOnly ? 'false' : 'true';
    textDiv.spellcheck = !readOnly;
    // Der Hinweis „Tippe hier…" steht nur auf der ersten Seite
    textDiv.dataset.ph = (index === 0 && !readOnly) ? 'Tippe hier…' : '';
  });

  /* Wer gerade in einem Feld stand, das eben gesperrt wurde, schreibt
     sonst munter weiter – der Fokus bleibt beim Umschalten stehen. */
  if (readOnly) {
    const aktiv = document.activeElement;
    if (aktiv && aktiv.classList && aktiv.classList.contains('j-text')) aktiv.blur();
  }
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
  applyEditableToPages(!!readOnly);

  const bar = E('shared-bar');
  if (!bar) return;

  if (!sharedDoc) {
    bar.style.display = 'none';
    return;
  }

  /* Fehlt der Kontakt zum Besitzer, steht das Recht weiter auf
     „bearbeiten", ausgeübt wird es gerade nicht. Der Streifen muss den
     ruhenden Zustand zeigen, sonst steht dort „bearbeiten", während
     nichts geht (Erklärung in ui/sharedDocs.js). */
  const canEdit = sharedDoc.role === 'edit' && !sharedDoc.ownerAway;
  bar.style.display = 'flex';

  const roleEl = E('shared-bar-role');
  if (roleEl) {
    roleEl.textContent = sharedDoc.ownerAway
      ? (t('roleOwnerOffline') || t('roleView'))
      : (canEdit ? t('roleEdit') : t('roleView'));
  }

  /* Beim Besitzer steht dort nicht „freigegeben von …" – er ist es ja
     selbst. Stattdessen der Hinweis, dass das Heft gerade live geteilt
     ist. */
  const textEl = E('shared-bar-text');
  if (textEl) {
    if (sharedDoc.isOwner) {
      textEl.textContent = t('sharedOwnerLine') || 'Live geteilt';
    } else {
      const who = sharedDoc.ownerName || sharedDoc.ownerEmail || '?';
      textEl.textContent = (t('sharedByLine') || 'Freigegeben von {name}').replace('{name}', who);
    }
  }

}
