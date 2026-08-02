'use strict';

/* ══════════════════════════════════════════════════════════════════════
   HEFT FREIGEBEN  ―  Oberfläche

   Bedient den Dialog #ov-share und den Eintrag „Heft freigeben" im
   Kontextmenü der Startseite. Die eigentliche Arbeit macht
   core/share.js (Firestore), das als ES-Modul geladen wird und sich
   unter window.InkwellShare meldet.

   ── Zwei Wege in einem Dialog ───────────────────────────────────────
   Oben der Link („Was darf, wer den Link hat?"), darunter einzelne
   E-Mail-Adressen mit Rolle. Die Personenliste zeigt beide gemischt –
   sonst könnte der Besitzer genau die Leute nicht entfernen, die er nie
   eingeladen hat.

   ── Was aus der Zeit davor bleibt ──────────────────────────────────
   Die alten, eingefrorenen Lesekopien (shared_notebooks) laufen weiter.
   Existiert für ein Heft noch eine, taucht sie unten im Dialog auf und
   lässt sich dort aufheben. Neue Freigaben gehen ausschließlich über die
   geteilten Dokumente.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const overlay = E('ov-share');
  if (!overlay) return;

  const closeBtn = E('share-close');
  const createBtn = E('share-create');
  const revokeBtn = E('share-revoke');
  const copyBtn = E('share-copy');
  const renewBtn = E('share-renew');
  const linkRow = E('share-link-row');
  const linkInput = E('share-link');
  const statusEl = E('share-status');
  const peopleEl = E('share-people');
  const inviteMail = E('share-invite-mail');
  const inviteRole = E('share-invite-role');
  const inviteAdd = E('share-invite-add');
  const needsAccountEl = E('share-needs-account');
  const linkSection = E('share-link-section');
  const peopleSection = E('share-people-section');
  const legacyBox = E('share-legacy');
  const legacyRevokeBtn = E('share-legacy-revoke');

  // Welches Heft im Dialog steht und der zuletzt gelesene Stand aus Firestore
  let shareNb = null;
  let head = null;

  /* ── Merkliste der eigenen Freigaben ──────────────────────────────
     Steht in den Einstellungen, damit „aktualisieren" und „aufheben"
     einen Neustart überleben.
       neu :  { [nbId]: { docId, linkId, url, linkMode } }
       alt :  { [nbId]: { shareId, url, mode } }
     ─────────────────────────────────────────────────────────────── */

  function registry() {
    const raw = Settings.get('shares');
    return (raw && typeof raw === 'object') ? raw : {};
  }

  async function remember(nbId, entry) {
    const all = registry();
    if (entry) all[nbId] = { ...(all[nbId] || {}), ...entry };
    else delete all[nbId];
    await Settings.update({ shares: all });
  }

  async function forget(nbId, keys) {
    const all = registry();
    if (!all[nbId]) return;
    for (const key of keys) delete all[nbId][key];
    if (!Object.keys(all[nbId]).length) delete all[nbId];
    await Settings.update({ shares: all });
  }

  function shareFor(nbId) {
    return registry()[nbId] || null;
  }

  /* ── Modul abwarten ───────────────────────────────────────────────
     core/share.js ist ein ES-Modul und läuft deshalb erst nach den
     klassischen Scripts. Ohne Internet kommt es gar nicht hoch – dann
     bricht der Aufruf nach 15 Sekunden mit einer klaren Meldung ab.
     ─────────────────────────────────────────────────────────────── */
  function whenShareReady() {
    if (window.InkwellShare) return Promise.resolve(window.InkwellShare);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SHARE_OFFLINE')), 15000);
      document.addEventListener('inkwell-share-ready', () => {
        clearTimeout(timer);
        if (window.InkwellShare) resolve(window.InkwellShare);
        else reject(new Error('SHARE_OFFLINE'));
      }, { once: true });
    });
  }

  function describeError(err) {
    if (!err) return t('shareFailed').replace('{msg}', '?');
    const msg = err.message || '';
    if (msg === 'SHARE_NOT_OWNED') return t('shareNotOwned');
    if (msg === 'SHARE_OFFLINE') return t('shareOffline');
    if (msg === 'NEEDS_ACCOUNT') return t('shareNeedsAccount');
    if (msg === 'BAD_EMAIL') return t('shareBadEmail');
    if (msg === 'OWN_EMAIL') return t('shareOwnEmail');
    if (msg === 'SHARE_NOT_FOUND') return t('sharedGone');
    return t('shareFailed').replace('{msg}', msg || '?');
  }

  /**
   * Sagt, WARUM nicht geteilt werden kann. Vorher stand hier immer
   * derselbe Satz – auch dann, wenn man längst angemeldet war und nur
   * Firebase den Nutzer nicht kannte. Damit war der graue Knopf nicht zu
   * erklären.
   */
  function describeIdentityProblem() {
    const problem = (typeof CloudSync_ !== 'undefined' && CloudSync_)
      ? CloudSync_.identityProblem
      : 'offline';

    if (problem === 'offline') return t('shareOffline');
    if (problem === 'signedOut') return t('shareNeedsAccount');
    if (problem === 'noIdToken') return t('shareNoIdToken');
    if (problem === 'failed') {
      const detail = CloudSync_.identityError || '';

      /* Der mit Abstand häufigste Stolperstein: Inkwells OAuth-Client liegt
         in einem anderen Google-Cloud-Projekt als Firebase. Ohne Eintrag in
         der Freigabeliste weist Firebase jedes ID-Token ab. Die Meldung
         dazu ist englisch und sperrig – deshalb hier die Anweisung, die
         man tatsächlich befolgen kann. */
      if (/audience|not authorized to be used in the project/i.test(detail)) {
        return t('shareClientNotAllowed');
      }

      /* Nur das sagt Firebase eindeutig: der Anbieter ist in der Console
         wirklich nicht eingeschaltet. */
      if (/operation-not-allowed/i.test(detail)) {
        return t('shareProviderOff');
      }

      /* >>> „invalid-credential-or-provider-id" sagt NICHT, was los ist <<<
         Firebase nennt diese eine Zeichenkette für mehrere ganz
         verschiedene Ursachen: abgeschalteter Anbieter, nicht passende
         nonce, ein Token für eine andere Anwendungs-ID, oder ein
         Aussteller, den der Anbieter in der Console nicht abdeckt.

         Vorher stand hier trotzdem „Anbieter nicht eingeschaltet". Wer ihn
         längst eingeschaltet hatte, suchte damit an der falschen Stelle –
         genau das ist bei Microsoft passiert. Deshalb jetzt die möglichen
         Ursachen und die Originalmeldung dazu. */
      if (/invalid-credential|provider-id/i.test(detail)) {
        return t('shareCredentialRejected') + (detail ? ' (' + detail + ')' : '');
      }

      return t('shareIdentityFailed') + (detail ? ' (' + detail + ')' : '');
    }
    return t('shareNeedsAccount');
  }

  function selectedLinkMode() {
    const checked = document.querySelector('input[name="app-link-mode"]:checked');
    return checked ? checked.value : 'off';
  }

  function setLinkModeRadio(mode) {
    const radio = document.querySelector(`input[name="app-link-mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
  }

  /* ── Dialog ───────────────────────────────────────────────────────── */

  async function openShareDialog(nb) {
    if (!nb) return;
    shareNb = nb;
    head = null;

    statusEl.textContent = '';
    peopleEl.innerHTML = '';
    linkRow.style.display = 'none';
    linkInput.value = '';
    revokeBtn.style.display = 'none';
    createBtn.textContent = t('shareCreate');

    const entry = shareFor(nb.id);
    setLinkModeRadio(entry?.linkMode || 'off');

    // Ältere Lesekopie? Dann unten den Knopf zum Aufheben zeigen.
    legacyBox.style.display = entry?.shareId ? 'block' : 'none';

    overlay.style.display = 'flex';

    /* Ohne echte Anmeldung bei Firebase geht nichts davon. Vorher aber
       einen Versuch, sie nachzuholen: das ID-Token wird beim Anmelden
       eingesammelt, und wer schon vorher angemeldet war, hatte nie eines. */
    statusEl.textContent = t('shareCheckingAccount');

    let api = null;
    let signedIn = false;
    try {
      api = await whenShareReady();
      signedIn = await CloudSync_.ensureFirebaseIdentity();
    } catch (err) {
      statusEl.textContent = describeError(err);
    }
    if (statusEl.textContent === t('shareCheckingAccount')) statusEl.textContent = '';

    needsAccountEl.textContent = describeIdentityProblem();
    needsAccountEl.style.display = signedIn ? 'none' : 'block';
    linkSection.style.display = signedIn ? '' : 'none';
    peopleSection.style.display = signedIn ? '' : 'none';
    createBtn.disabled = !signedIn;
    if (!signedIn) return;

    if (entry?.docId) await loadHead(entry.docId);
  }

  async function loadHead(docId) {
    try {
      const api = await whenShareReady();
      head = await api.loadDocumentHead(docId);
      renderFromHead();
      await noteAccess();
    } catch (err) {
      // Dokument gibt es nicht mehr (auf einem anderen Gerät aufgehoben)
      if (err?.message === 'SHARE_NOT_FOUND') {
        head = null;
        await forget(shareNb.id, ['docId', 'linkId', 'url', 'linkMode', 'access']);
        markPagesChanged();
        statusEl.textContent = t('sharedGone');
        return;
      }
      statusEl.textContent = describeError(err);
    }
  }

  /* ── Recht für das Zeichen am Seitenkopf ──────────────────────────
     Was die Eingeladenen dürfen, steht nur in Firestore. app.js baut
     die Seiten aber auch ohne Netz auf. Deshalb wird das höchste
     vergebene Recht hier örtlich mitgeschrieben, sobald der Kopf
     geladen ist – siehe shareMarkFor() in app.js.
     ─────────────────────────────────────────────────────────────── */

  function highestAccess() {
    if (!head) return 'off';
    if (head.linkMode === 'edit') return 'edit';
    const roles = window.InkwellShare.listMembers(head).map(p => p.role);
    if (roles.includes('edit')) return 'edit';
    if (head.linkMode === 'view' || roles.length) return 'view';
    return 'off';
  }

  async function noteAccess() {
    if (!shareNb || !head) return;
    await remember(shareNb.id, { access: highestAccess() });
    markPagesChanged();
  }

  /* Das Zeichen steht an zwei Orten: am Seitenkopf im offenen Heft und auf
     der Karte in der Übersicht. Freigeben geht von beiden aus, also müssen
     auch beide nachziehen. */
  function markPagesChanged() {
    if (typeof window.refreshPageShareIcons === 'function') window.refreshPageShareIcons();
    if (typeof renderHomeGrid === 'function' && E('view-home')?.style.display !== 'none') {
      renderHomeGrid();
    }
  }

  function renderFromHead() {
    if (!head) return;

    setLinkModeRadio(head.linkMode);
    createBtn.textContent = t('shareUpdate');
    revokeBtn.style.display = 'inline-block';
    statusEl.textContent = t('shareActive');

    if (head.linkMode !== 'off' && head.linkId) {
      linkRow.style.display = 'flex';
      linkInput.value = window.InkwellShare.docUrlFor(head.linkId);
    } else {
      linkRow.style.display = 'none';
      linkInput.value = '';
    }

    renderPeople();
  }

  function renderPeople() {
    peopleEl.innerHTML = '';
    if (!head) return;

    const api = window.InkwellShare;
    const rows = api.listMembers(head);

    if (!rows.length && !head.blockedEmails.length) {
      const empty = document.createElement('p');
      empty.className = 'share-people-empty';
      empty.textContent = t('sharePeopleEmpty');
      peopleEl.appendChild(empty);
      return;
    }

    for (const person of rows) {
      const row = document.createElement('div');
      row.className = 'share-person';

      const mail = document.createElement('span');
      mail.className = 'share-person-mail';
      mail.textContent = person.email;
      mail.title = person.email;

      const via = document.createElement('span');
      via.className = 'share-person-via';
      via.textContent = person.via === 'link' ? t('shareViaLink') : t('shareViaInvite');

      const select = document.createElement('select');
      for (const value of ['view', 'edit']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === 'edit' ? t('roleEdit') : t('roleView');
        if (person.role === value) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => changeRole(person.email, select.value));

      const remove = document.createElement('button');
      remove.className = 'share-person-remove';
      remove.type = 'button';
      remove.textContent = '✕';
      remove.title = t('shareRemovePerson');
      remove.addEventListener('click', () => removePerson(person.email));

      row.append(mail, via, select, remove);
      peopleEl.appendChild(row);
    }

    // Gesperrte Adressen: sichtbar machen, sonst wundert man sich, warum
    // jemand über den Link nicht mehr hereinkommt.
    for (const email of head.blockedEmails) {
      const row = document.createElement('div');
      row.className = 'share-person blocked';

      const mail = document.createElement('span');
      mail.className = 'share-person-mail';
      mail.textContent = email;

      const via = document.createElement('span');
      via.className = 'share-person-via';
      via.textContent = t('shareBlocked');

      const undo = document.createElement('button');
      undo.className = 'share-person-remove';
      undo.type = 'button';
      undo.textContent = '↺';
      undo.title = t('shareUnblock');
      undo.addEventListener('click', () => unblock(email));

      row.append(mail, via, undo);
      peopleEl.appendChild(row);
    }
  }

  function closeShareDialog() {
    overlay.style.display = 'none';
    shareNb = null;
    head = null;
  }

  /* ── Aktionen ─────────────────────────────────────────────────────── */

  async function submitShare() {
    if (!shareNb) return;

    const linkMode = selectedLinkMode();
    const entry = shareFor(shareNb.id);

    /* >>> Nachfragen, bevor fremde Arbeit verschwindet <<<
       „Freigabe aktualisieren" schreibt den Inhalt vollständig neu – der
       Stand aus diesem Heft ersetzt alles, was im Raum steht. Solange der
       Besitzer selbst nicht an der Live-Bearbeitung teilnimmt (er öffnet
       sein eigenes Heft aus der Datei, nicht aus dem Raum), kennt er die
       Änderungen der anderen gar nicht. Vorher passierte das lautlos. */
    if (head && head.memberEmails.length) {
      const ok = await showConfirm(
        t('shareOverwriteConfirm').replace('{n}', String(head.memberEmails.length))
      );
      if (!ok) return;
    }

    createBtn.disabled = true;
    statusEl.textContent = t('shareWorking');

    try {
      // Der Editor-Stand muss erst ins Datenmodell, sonst fehlt in der
      // Freigabe genau das, was gerade getippt wurde.
      if (S.activeNbId === shareNb.id && typeof syncAll === 'function') {
        try { syncAll(); } catch (e) { console.warn('[Share] syncAll:', e); }
      }

      const api = await whenShareReady();
      const result = await api.shareDocument(shareNb, {
        docId: entry?.docId,
        linkMode
      });

      await remember(shareNb.id, {
        docId: result.docId,
        linkId: result.linkId,
        url: result.url,
        linkMode: result.linkMode
      });

      await loadHead(result.docId);
      statusEl.textContent = entry?.docId ? t('shareUpdated') : t('shareDone');
      toast(entry?.docId ? t('shareUpdated') : t('shareDone'));
    } catch (err) {
      console.error('[Share] Freigeben fehlgeschlagen:', err);
      statusEl.textContent = describeError(err);
    } finally {
      createBtn.disabled = false;
    }
  }

  /** Nur das Linkrecht umstellen, ohne den Inhalt neu hochzuladen. */
  async function applyLinkMode() {
    if (!head) return;                       // noch gar nicht freigegeben
    const wanted = selectedLinkMode();
    if (wanted === head.linkMode) return;

    try {
      const api = await whenShareReady();
      await api.setLinkMode(head.docId, wanted);
      await remember(shareNb.id, { linkMode: wanted });
      await loadHead(head.docId);
    } catch (err) {
      console.error('[Share] Linkrecht ändern fehlgeschlagen:', err);
      statusEl.textContent = describeError(err);
    }
  }

  async function renewLink() {
    if (!head || !head.linkId) return;
    if (!await showConfirm(t('shareRenewConfirm'))) return;

    try {
      const api = await whenShareReady();
      const result = await api.rotateLink(head.docId);
      await remember(shareNb.id, { linkId: result.linkId, url: result.url });
      await loadHead(head.docId);
      statusEl.textContent = t('shareRenewed');
      toast(t('shareRenewed'));
    } catch (err) {
      console.error('[Share] Link erneuern fehlgeschlagen:', err);
      statusEl.textContent = describeError(err);
    }
  }

  async function addPerson() {
    if (!head) { statusEl.textContent = t('shareCreateFirst'); return; }

    const email = (inviteMail.value || '').trim();
    const role = inviteRole.value === 'edit' ? 'edit' : 'view';

    inviteAdd.disabled = true;
    try {
      const api = await whenShareReady();
      await api.setMember(head.docId, email, role);
      inviteMail.value = '';
      await loadHead(head.docId);
      statusEl.textContent = t('shareInvited').replace('{mail}', api.normalizeEmail(email));
    } catch (err) {
      statusEl.textContent = describeError(err);
    } finally {
      inviteAdd.disabled = false;
    }
  }

  async function changeRole(email, role) {
    if (!head) return;
    try {
      const api = await whenShareReady();
      await api.setMember(head.docId, email, role);
      await loadHead(head.docId);
    } catch (err) {
      statusEl.textContent = describeError(err);
    }
  }

  async function removePerson(email) {
    if (!head) return;
    if (!await showConfirm(t('shareRemoveConfirm').replace('{mail}', email))) return;
    try {
      const api = await whenShareReady();
      await api.removeMember(head.docId, email);
      await loadHead(head.docId);
      statusEl.textContent = t('shareRemoved').replace('{mail}', email);
    } catch (err) {
      statusEl.textContent = describeError(err);
    }
  }

  async function unblock(email) {
    if (!head) return;
    try {
      const api = await whenShareReady();
      await api.unblockMember(head.docId, email);
      await loadHead(head.docId);
    } catch (err) {
      statusEl.textContent = describeError(err);
    }
  }

  async function revokeShare() {
    if (!shareNb || !head) return;
    if (!await showConfirm(t('shareRevokeConfirm'))) return;

    revokeBtn.disabled = true;
    try {
      const api = await whenShareReady();
      await api.unshareDocument(head.docId);
      await forget(shareNb.id, ['docId', 'linkId', 'url', 'linkMode', 'access']);
      markPagesChanged();

      head = null;
      linkRow.style.display = 'none';
      linkInput.value = '';
      revokeBtn.style.display = 'none';
      createBtn.textContent = t('shareCreate');
      peopleEl.innerHTML = '';
      setLinkModeRadio('off');
      statusEl.textContent = t('shareRevoked');
      toast(t('shareRevoked'));
    } catch (err) {
      console.error('[Share] Aufheben fehlgeschlagen:', err);
      statusEl.textContent = describeError(err);
    } finally {
      revokeBtn.disabled = false;
    }
  }

  /** Die alte, eingefrorene Lesekopie aufheben. */
  async function revokeLegacyShare() {
    const entry = shareFor(shareNb?.id);
    if (!entry?.shareId) return;
    if (!await showConfirm(t('shareRevokeConfirm'))) return;

    try {
      const api = await whenShareReady();
      await api.revokeShare(entry.shareId);
      await forget(shareNb.id, ['shareId', 'mode']);
      markPagesChanged();
      legacyBox.style.display = 'none';
      toast(t('shareRevoked'));
    } catch (err) {
      console.error('[Share] Ältere Freigabe aufheben fehlgeschlagen:', err);
      statusEl.textContent = describeError(err);
    }
  }

  async function copyLink() {
    if (!linkInput.value) return;
    try {
      await navigator.clipboard.writeText(linkInput.value);
      const original = copyBtn.textContent;
      copyBtn.textContent = t('shareCopied');
      setTimeout(() => { copyBtn.textContent = original; }, 2000);
    } catch (err) {
      linkInput.select();
    }
  }

  /* ── „Immer aktueller Stand": beim Speichern mitschreiben ─────────
     Hefte mit einer älteren Lesekopie im Modus 'live' werden nach jedem
     Cloud-Abgleich neu veröffentlicht. Bewusst an CloudSync gehängt und
     nicht an jedes Tippen – sonst gäbe es pro Sitzung hunderte
     Schreibvorgänge.
     ─────────────────────────────────────────────────────────────── */

  let republishTimer = null;

  async function republishLiveShares() {
    const all = registry();
    const live = Object.entries(all).filter(([, entry]) => entry?.mode === 'live' && entry?.shareId);
    if (!live.length) return;
    if (!window.InkwellShare) return;   // ohne Netz einfach beim nächsten Mal

    for (const [nbId, entry] of live) {
      const nb = getNb(nbId);
      if (!nb) continue;
      try {
        await window.InkwellShare.publishNotebook(nb, { mode: 'live', shareId: entry.shareId });
        console.log('[Share] Freigabe mitgeschrieben:', nb.name);
      } catch (err) {
        // Nicht mehr unsere Freigabe (anderes Gerät) -> aus der Liste nehmen
        if (err.message === 'SHARE_NOT_OWNED') await forget(nbId, ['shareId', 'mode']);
        else console.warn('[Share] Mitschreiben übersprungen:', err.message);
      }
    }
  }

  if (window.CloudSync_ && typeof CloudSync_.onChange === 'function') {
    CloudSync_.onChange((payload) => {
      if (payload.status !== 'ready') return;
      clearTimeout(republishTimer);
      republishTimer = setTimeout(() => republishLiveShares().catch(() => {}), 3000);
    });
  }

  /* ── Verdrahtung ──────────────────────────────────────────────────── */

  closeBtn?.addEventListener('click', closeShareDialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeShareDialog(); });
  createBtn?.addEventListener('click', submitShare);
  revokeBtn?.addEventListener('click', revokeShare);
  copyBtn?.addEventListener('click', copyLink);
  renewBtn?.addEventListener('click', renewLink);
  inviteAdd?.addEventListener('click', addPerson);
  legacyRevokeBtn?.addEventListener('click', revokeLegacyShare);

  inviteMail?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPerson(); }
  });

  document.querySelectorAll('input[name="app-link-mode"]').forEach(radio => {
    radio.addEventListener('change', applyLinkMode);
  });

  // Aus dem geöffneten Heft heraus freigeben. Bisher führte der einzige Weg
  // über das Kontextmenü auf der Startseite – man musste das Heft also erst
  // wieder schließen, um es weitergeben zu können.
  E('btn-doc-share')?.addEventListener('click', () => {
    const nb = getNb();
    if (!nb) { toast(t('noActiveNotebook'), true); return; }
    // Ein fremdes Dokument gibt man nicht selbst weiter.
    if (typeof isSharedNotebook === 'function' && isSharedNotebook(nb)) {
      toast(t('shareNotYours'), true);
      return;
    }
    openShareDialog(nb);
  });

  // Vom Kontextmenü der Startseite aus aufgerufen (ui/homeGrid.js)
  window.openShareDialog = openShareDialog;
  window.notebookShareEntry = shareFor;

  /* Auch die Empfängerseite braucht diese Auskunft (ui/sharedDocs.js).
     Dort stand bisher in JEDEM Fall „melde dich an" – auch dann, wenn man
     längst angemeldet war und nur Firebase den Nutzer nicht kannte. Damit
     war der leere Reiter nicht zu erklären. */
  window.describeShareIdentityProblem = describeIdentityProblem;
})();
