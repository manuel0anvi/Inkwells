'use strict';

/* ══════════════════════════════════════════════════════════════════════
   GETEILTE DOKUMENTE  ―  Oberfläche in der App

   Der zweite Reiter auf der Startseite. Darin steht alles, was andere mit
   diesem Konto geteilt haben – Rolle, Besitzer und Änderungsdatum je Karte.

   ── Woher die Liste kommt ───────────────────────────────────────────
   Aus genau EINER Abfrage in Firestore:
       where('memberEmails', 'array-contains', meineAdresse)
   Es gibt bewusst keine zweite Datenhaltung. Nimmt der Besitzer jemanden
   aus der Liste, verschwindet das Dokument bei ihm von selbst – auch
   mitten in der Sitzung, weil hier auf Änderungen gehört wird.

   ── Warum ein geteiltes Dokument kein normales Heft ist ─────────────
   Es liegt zwar in S.notebooks (der Editor holt sich alles über getNb),
   trägt aber nb.origin = 'shared'. Daran erkennen fileManager, registry,
   autoSave, cloudSync und trash, dass sie die Finger davon lassen müssen
   – sonst lüde die App fremde Hefte in das EIGENE Google Drive.

   ── Warum Bearbeiten hier eine harte Sperre hat ─────────────────────
   Ein Heft liegt bis auf Weiteres als ein einziger JSON-Klumpen in
   Firestore. Zwei gleichzeitige Schreiber würden sich vollständig
   überschreiben. Deshalb trägt das Dokument eine laufende Nummer: wer auf
   einem älteren Stand sitzt, darf nicht speichern und bekommt es gesagt.
   Echtes gleichzeitiges Arbeiten braucht das zerlegte Datenmodell
   (COLLAB_SPEC.md, Abschnitt 2).
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const tabOwn = E('tab-own');
  const tabShared = E('tab-shared');
  const sharedPanel = E('shared-panel');
  const sharedGrid = E('shared-grid');
  const sharedHint = E('shared-hint');
  const newCountEl = E('shared-new-count');
  if (!tabOwn || !tabShared) return;

  // Zuletzt bekannter Stand der Liste
  let docs = [];
  let unwatchList = null;
  let unwatchOpen = null;
  let activeTab = 'own';
  let listError = '';

  // Wiederholung nach einem Abbruch, mit wachsendem Abstand
  let retryTimer = null;
  let retryDelay = 2000;

  /* ── Modul abwarten ─────────────────────────────────────────────────
     core/share.js ist ein ES-Modul und läuft nach den klassischen
     Scripts. Ohne Internet kommt es gar nicht hoch.
     ─────────────────────────────────────────────────────────────── */
  function whenShareReady(timeoutMs = 15000) {
    if (window.InkwellShare) return Promise.resolve(window.InkwellShare);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SHARE_OFFLINE')), timeoutMs);
      document.addEventListener('inkwell-share-ready', () => {
        clearTimeout(timer);
        if (window.InkwellShare) resolve(window.InkwellShare);
        else reject(new Error('SHARE_OFFLINE'));
      }, { once: true });
    });
  }

  /* ── Ohne Netz gibt es hier nichts ──────────────────────────────────
     Geteilte Dokumente liegen ausschließlich in Firestore – anders als
     die eigenen Hefte gibt es davon keine Fassung auf der Festplatte.
     Ohne Verbindung ist die Liste also nicht bloß leer, sondern nicht
     zu beantworten; wer sie dann sähe, sähe einen alten Stand, den er
     bearbeiten könnte, ohne dass es je ankommt.

     Gleiche Frage wie in ui/share.js: CloudSync sieht wirklich nach
     (main.js: check-internet), navigator.onLine kennt nur die Buchse. */
  function isOffline() {
    if (typeof CloudSync_ !== 'undefined' && CloudSync_ && CloudSync_.isOnline === false) return true;
    // typeof-Frage, weil das hier schon beim Laden aufgerufen wird – und
    // die Prüfumgebung kennt kein navigator (wie core/cloudSync.js).
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  /* ── Gelesen-Zeitpunkt ──────────────────────────────────────────────
     Es gibt keinen eigenen Benachrichtigungs-Speicher. Gemerkt wird nur,
     wann der Reiter zuletzt offen war; alles Neuere gilt als neu. Das
     kostet keinen einzigen zusätzlichen Schreibvorgang in Firestore.
     ─────────────────────────────────────────────────────────────── */

  function lastSeen() {
    return Number(Settings.get('sharedDocsSeenAt')) || 0;
  }

  async function markSeen() {
    await Settings.update({ sharedDocsSeenAt: Date.now() });
    renderBadge();
  }

  function newDocs() {
    const since = lastSeen();
    if (!since) return docs.slice();     // erster Besuch: alles ist neu
    return docs.filter(d => {
      const at = d.sharedAt || d.updatedAt;
      return at instanceof Date && at.getTime() > since;
    });
  }

  function renderBadge() {
    if (!newCountEl) return;
    const count = newDocs().length;
    newCountEl.textContent = String(count);
    newCountEl.style.display = count > 0 ? 'inline-block' : 'none';
  }

  /* ── Ohne Anmeldung kommt hier gar nichts an ────────────────────────
     Gefragt wird CloudSync_ und nicht die Firebase-Kennung: die beiden
     sind zweierlei, und genau daran lag der gemeldete Fehler. Die
     Firebase-Sitzung hält Wochen, das Zugriffstoken eine Stunde. Lief
     letzteres ab (oder meldete man sich ab, ohne dass die Abmeldung bei
     Firebase durchkam), war man in der App abgemeldet – die Beobachtung
     der Freigaben lief aber weiter und meldete munter neue Dokumente.
     ─────────────────────────────────────────────────────────────── */
  function cloudAngemeldet() {
    return typeof window.CloudSync_?.isAuthenticated === 'function'
      && window.CloudSync_.isAuthenticated();
  }

  /** Beim Start einmal kurz sagen, was dazugekommen ist. */
  let announced = false;
  function announceNew() {
    if (announced || activeTab === 'shared') return;
    if (!cloudAngemeldet()) return;
    const fresh = newDocs();
    if (!fresh.length) return;
    announced = true;

    const first = fresh[0];
    const who = first.ownerName || first.ownerEmail || '?';
    const msg = fresh.length === 1
      ? (t('sharedNotifyOne') || '{name} hat „{title}" mit dir geteilt.')
          .replace('{name}', who).replace('{title}', first.title || '?')
      : (t('sharedNotifyMany') || '{n} neue geteilte Dokumente.')
          .replace('{n}', String(fresh.length));

    if (typeof toast === 'function') toast(msg);
  }

  /* ── Reiter ─────────────────────────────────────────────────────── */

  function switchTab(which) {
    activeTab = which === 'shared' ? 'shared' : 'own';

    tabOwn.classList.toggle('active', activeTab === 'own');
    tabShared.classList.toggle('active', activeTab === 'shared');

    /* ── Die Suchleiste gilt für BEIDE Reiter ──────────────────────
       Hier stand `activeTab === 'own' ? '' : 'none'`: auf dem Reiter mit
       den geteilten Dokumenten war sie weg. Das war schlüssig, solange
       die Suche geteilte Hefte gar nicht ansah – seit sie das tut, ist
       es genau verkehrt herum: dort, wo die Treffer herkommen, konnte
       man nicht suchen.

       Eine gemeinsame Leiste und nicht zwei: gesucht wird ohnehin über
       alles, und zwei Felder mit demselben Inhalt wären nur die Frage,
       welches gerade gilt. */
    E('search-results').style.display = 'none';
    if (typeof window.resetHomeSearch === 'function') window.resetHomeSearch();

    E('nb-grid').style.display = activeTab === 'own' ? '' : 'none';
    if (sharedPanel) sharedPanel.style.display = activeTab === 'shared' ? '' : 'none';

    if (activeTab === 'shared') {
      renderShared();
      markSeen().catch(() => {});

      /* Läuft noch keine Beobachtung, jetzt anstoßen. Beim Start kann die
         Firebase-Kennung noch gefehlt haben; ohne diesen Anstoß bliebe der
         Tab bis zum nächsten Programmstart leer. */
      if (!unwatchList) startWatching().catch(() => {});
    }
  }

  tabOwn.addEventListener('click', () => switchTab('own'));
  tabShared.addEventListener('click', () => switchTab('shared'));

  /* Welcher Reiter offen ist. Die Suche braucht das: sie legt ihre
     Trefferliste über den Bereich darunter und muss danach den RICHTIGEN
     wieder aufdecken – sonst stünden nach dem Leeren des Feldes die
     eigenen Hefte da, obwohl man auf den geteilten war. */
  window.homeActiveTab = () => activeTab;

  /* ══════════════════════════════════════════════════════════════════
     DIE LISTE DER GETEILTEN DOKUMENTE FÜR DIE SUCHE

     Nur die Kopfdaten – Titel, Besitzer, Kennung. Der INHALT eines
     geteilten Dokuments liegt erst dann hier, wenn es einmal geöffnet
     wurde; er wird nicht auf Vorrat heruntergeladen.

     Die Suche kommt damit trotzdem weiter, als es zunächst aussieht:
     nach dem Namen findet sie jedes geteilte Dokument, auch ein nie
     geöffnetes. Nur im TEXT eines ungeöffneten kann sie nicht suchen –
     dafür müsste sie bei jedem Tastendruck jedes fremde Heft laden.
     ══════════════════════════════════════════════════════════════════ */
  window.sharedDocHeads = () => docs.slice();

  /* ── Reiter nur für Angemeldete ─────────────────────────────────────
     Ohne Anmeldung kann überhaupt nichts bei einem ankommen: die Liste
     wird über die eigene Adresse abgefragt. Der Reiter wäre dann ein
     leeres Versprechen und verschwindet deshalb ganz.

     Sichtbar bleibt er, sobald man angemeldet ist – auch wenn Firebase
     den Nutzer noch nicht kennt. Genau dann steht im Reiter, woran es
     liegt und wie es zu beheben ist; das wäre sonst nicht zu finden.
     ─────────────────────────────────────────────────────────────── */
  function refreshTabVisibility() {
    const signedIn = typeof window.CloudSync_?.isAuthenticated === 'function'
      && window.CloudSync_.isAuthenticated();
    tabShared.style.display = signedIn ? '' : 'none';
    // Verschwindet der Reiter unter einem, zurück auf die eigenen Hefte
    if (!signedIn && activeTab === 'shared') switchTab('own');
  }

  /* Der Verbindungszustand entscheidet mit, was im Reiter steht (siehe
     isOffline). Gemerkt wird der letzte Stand, damit nicht bei jeder
     Meldung von CloudSync neu gezeichnet wird – die kommen häufig. */
  let wasOffline = isOffline();

  /* Und derselbe Merkzettel für die Anmeldung. CloudSync_ meldet jede
     Kleinigkeit; gehandelt wird nur beim WECHSEL. */
  let warAngemeldet = cloudAngemeldet();

  function onCloudChange() {
    refreshTabVisibility();

    /* Abgemeldet oder Sitzung abgelaufen: Beobachtung beenden. Ohne das
       lief sie weiter, solange die Firebase-Kennung noch galt – der
       gemeldete Fehler „nach dem Abmelden kommen weiter Hinweise aus der
       Cloud". Andersherum genauso: nach der Anmeldung wieder anwerfen. */
    const jetztAngemeldet = cloudAngemeldet();
    if (jetztAngemeldet !== warAngemeldet) {
      warAngemeldet = jetztAngemeldet;
      if (jetztAngemeldet) startWatching().catch(() => {});
      else stopWatching();
    }

    const now = isOffline();
    if (now !== wasOffline) {
      wasOffline = now;
      if (activeTab === 'shared') renderShared();
    }
  }

  if (window.CloudSync_ && typeof CloudSync_.onChange === 'function') {
    CloudSync_.onChange(onCloudChange);
  }
  // Rückfall, falls CloudSync gar nicht da ist – der Reiter soll trotzdem
  // stimmen. Mit typeof gefragt, weil die Prüfumgebung nur ein knappes
  // window nachbildet.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('online', onCloudChange);
    window.addEventListener('offline', onCloudChange);
  }
  refreshTabVisibility();

  /* ── Liste ──────────────────────────────────────────────────────── */

  function myEmail() {
    const api = window.InkwellShare;
    return api?.currentIdentity()?.email || '';
  }

  function myRole(head) {
    return head.roleFor ? head.roleFor(myEmail()) : 'view';
  }

  function fmtDate(date) {
    if (!(date instanceof Date)) return '';
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  /* Bei Microsoft fehlt die Firebase-Kennung nicht aus Versehen; warum sie
     einen Klick braucht, steht bei microsoftLinkButton in ui/share.js. Der
     Knopf kommt von dort, weil ihn der Freigabe-Dialog genauso braucht. */
  function renderMicrosoftLinkButton() {
    if (!sharedGrid) return;
    const btn = window.microsoftLinkButton?.(async ok => {
      if (ok) { await startWatching().catch(() => {}); renderShared(); }
      else { sharedHint.textContent = window.describeShareIdentityProblem?.() || sharedHint.textContent; }
    });
    if (btn) sharedGrid.appendChild(btn);
  }

  function renderShared() {
    if (!sharedGrid) return;
    sharedGrid.innerHTML = '';

    /* Zuerst gefragt, weil ohne Netz jede weitere Auskunft geraten wäre:
       „nichts geteilt" und „nicht nachsehen können" sind zwei Dinge. */
    if (isOffline()) {
      sharedHint.textContent = t('sharedNeedsInternet');
      return;
    }

    const api = window.InkwellShare;
    const signedIn = !!(api && api.hasRealIdentity());

    /* >>> Warum hier so viel Text steht <<<
       Ein leerer Reiter hat vier ganz verschiedene Ursachen, und von
       außen sehen alle gleich aus: Firebase kennt den Nutzer nicht, es
       ist wirklich nichts geteilt, die Adresse passt nicht zu der, unter
       der eingeladen wurde, oder die Abfrage wird abgewiesen. Vorher
       stand in den ersten drei Fällen derselbe Satz – „melde dich an" –,
       auch wenn man längst angemeldet war. Damit ließ sich nicht
       herausfinden, woran es liegt. */
    if (!signedIn) {
      sharedHint.textContent = listError
        || (typeof window.describeShareIdentityProblem === 'function'
              ? window.describeShareIdentityProblem()
              : t('sharedNeedsAccount'));
      renderMicrosoftLinkButton();
      return;
    }

    if (!docs.length) {
      /* Die Adresse mit dazu. Eingeladen wird auf die Adresse genau –
         wer sich auf diesem Gerät mit einem anderen Konto angemeldet hat
         (oder wessen Adresse anders geschrieben wurde), sieht hier
         sofort, dass gesucht und eingeladen nicht dasselbe ist. */
      const mine = myEmail();
      sharedHint.textContent = listError
        || (t('sharedEmpty') + (mine ? ' ' + t('sharedLookingFor').replace('{mail}', mine) : ''));
      return;
    }
    sharedHint.textContent = listError || t('sharedHint');

    for (const head of docs) {
      const role = myRole(head) === 'edit' ? 'edit' : 'view';
      const card = document.createElement('div');
      card.className = 'nb-card';
      card.style.setProperty('--nb-color', head.color);

      const spine = document.createElement('div');
      spine.className = 'nb-card-spine';
      spine.style.background = head.color;

      const body = document.createElement('div');
      body.className = 'nb-card-body';

      const name = document.createElement('div');
      name.className = 'nb-card-name';
      name.textContent = head.title || '?';

      const badge = document.createElement('span');
      badge.className = 'nb-card-role' + (role === 'edit' ? ' can-edit' : '');
      badge.textContent = role === 'edit' ? t('roleEdit') : t('roleView');

      const meta = document.createElement('div');
      meta.className = 'nb-card-meta';
      const parts = [head.ownerName || head.ownerEmail || '?'];
      if (head.updatedAt) parts.push(fmtDate(head.updatedAt));
      meta.textContent = parts.join(' · ');

      /* Derselbe Punkteknopf wie an den eigenen Heften – nur dass hier
         genau ein Eintrag dahinter steht (siehe #shared-ctx-menu). Wer
         eine Freigabe loswerden will, sucht sie in der Übersicht am Heft
         und nicht in der Leiste des geöffneten Dokuments. */
      const punkte = document.createElement('button');
      punkte.className = 'nb-card-edit-btn';
      punkte.title = t('sharedLeave');
      punkte.textContent = '⋯';
      punkte.addEventListener('click', e => {
        e.stopPropagation();
        zeigeKartenMenue(e.clientX, e.clientY, head);
      });

      body.append(punkte, name, badge, meta);
      card.append(spine, body);
      card.addEventListener('click', () => openSharedDocument(head).catch(err => {
        console.error('[SharedDocs] Öffnen fehlgeschlagen:', err);
        toast(describeError(err), true);
      }));
      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        zeigeKartenMenue(e.clientX, e.clientY, head);
      });

      sharedGrid.appendChild(card);
    }
  }

  /* ── Das Punktemenü einer geteilten Karte ─────────────────────────── */

  let menueDoc = null;      // welches Heft gerade gemeint ist

  function zeigeKartenMenue(x, y, head) {
    const menue = E('shared-ctx-menu');
    if (!menue) return;
    menueDoc = head;
    menue.style.cssText = `display:block;left:${x}px;top:${y}px;position:fixed`;
    setTimeout(() => document.addEventListener('pointerdown', menueDraussen), 0);
  }

  function schliesseKartenMenue() {
    const menue = E('shared-ctx-menu');
    if (menue) menue.style.display = 'none';
    document.removeEventListener('pointerdown', menueDraussen);
  }

  function menueDraussen(e) {
    if (!e.target.closest('#shared-ctx-menu')) schliesseKartenMenue();
  }

  E('sharedctx-hide')?.addEventListener('click', async () => {
    const head = menueDoc;
    schliesseKartenMenue();
    if (!head) return;
    if (!await showConfirm(t('sharedLeaveConfirm'))) return;

    try {
      const api = await whenShareReady();
      await api.leaveDocument(head.docId);
      /* Steht ausgerechnet dieses Heft gerade offen, muss es auch zu:
         sonst schriebe man weiter in ein Dokument, das man eben aus der
         eigenen Liste genommen hat. */
      if (S.sharedDoc && S.sharedDoc.docId === head.docId) kickOut(t('sharedLeft'));
      else toast(t('sharedLeft'));
    } catch (err) {
      console.error('[SharedDocs] Verlassen fehlgeschlagen:', err);
      toast(describeError(err), true);
    }
  });

  function describeError(err) {
    const msg = err?.message || '';
    if (msg === 'SHARE_OFFLINE') return t('shareOffline');
    if (msg === 'NEEDS_ACCOUNT') return t('sharedNeedsAccount');
    if (msg === 'SHARE_NOT_FOUND') return t('sharedGone');
    if (msg === 'DOC_OUTDATED') return t('sharedOutdated');
    if (msg === 'NOT_ALLOWED') return t('sharedNoRight');
    return t('shareFailed').replace('{msg}', msg || '?');
  }

  /**
   * Beendet die Beobachtung und räumt alles weg, was aus ihr stammt.
   *
   * Wird beim Abmelden und beim Ablauf der Sitzung gebraucht. Die Liste
   * wird dabei ausdrücklich geleert: sonst stünden nach dem Abmelden
   * fremde Dokumente in der Übersicht und in der Suche, obwohl niemand
   * mehr das Recht hat, sie zu öffnen.
   */
  function stopWatching() {
    clearTimeout(retryTimer);
    retryTimer = null;
    retryDelay = 2000;
    if (unwatchList) { unwatchList(); unwatchList = null; }

    docs = [];
    listError = '';
    /* Zurücksetzen, damit die nächste Anmeldung wieder einmal sagen darf,
       was inzwischen dazugekommen ist. */
    announced = false;
    renderBadge();
    if (activeTab === 'shared') renderShared();
  }

  /** Startet (oder erneuert) die Beobachtung der eigenen Empfängerliste. */
  async function startWatching() {
    clearTimeout(retryTimer);
    if (unwatchList) { unwatchList(); unwatchList = null; }

    let api;
    try {
      api = await whenShareReady();
    } catch (err) {
      listError = t('shareOffline');
      renderShared();
      return;
    }

    // Auch hier erst versuchen, die Firebase-Kennung nachzuholen: wer schon
    // vor dieser Fassung angemeldet war, hat nie ein ID-Token abgegeben.
    const known = await CloudSync_.ensureFirebaseIdentity();
    if (!known) {
      docs = [];
      listError = '';
      renderBadge();
      if (activeTab === 'shared') renderShared();
      return;
    }

    /* ── Und jetzt erst: ist überhaupt noch jemand angemeldet? ────────
       Die Frage steht ausdrücklich HINTER den beiden Wartezeiten oben.
       Beim Start läuft dieser Aufruf, bevor Settings.init() durch ist
       (core/init.js) – davor wüsste CloudSync_ noch von keinem Token und
       würde jede Sitzung für beendet erklären.

       Dahinter ist die Auskunft verlässlich, und sie ist die
       entscheidende: die Firebase-Kennung von eben kann längst gelten,
       während das Zugriffstoken abgelaufen ist. Genau dann lief die
       Beobachtung bisher weiter und meldete neue Freigaben an jemanden,
       der gar nicht mehr angemeldet war. */
    if (!cloudAngemeldet()) { stopWatching(); return; }

    listError = '';
    unwatchList = api.watchSharedDocs(
      api.currentIdentity().email,
      (list) => {
        /* Zwischen dem Anmelden der Beobachtung und ihrer ersten Antwort
           kann die Sitzung geendet haben. Firestore schickt trotzdem –
           es kennt die Abmeldung in der App nicht. */
        if (!cloudAngemeldet()) { stopWatching(); return; }

        listError = '';
        retryDelay = 2000;
        docs = list.sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
        renderBadge();
        announceNew();
        if (activeTab === 'shared') renderShared();
        checkStillAllowed();
      },
      (err) => {
        /* Reißt die Beobachtung ab (Netz weg, Regeln abgelehnt), kommt sie
           von selbst nicht wieder. Vorher blieb der Tab dann stumm leer –
           genau das Verhalten von „erscheint erst ganz spät". */
        listError = t('sharedListError').replace('{msg}', err?.message || '?');
        if (activeTab === 'shared') renderShared();

        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 60000);
          startWatching().catch(() => {});
        }, retryDelay);
      }
    );
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE LAUFENDE LIVE-SITZUNG

     Ein Heft kann auf zwei Wegen im Raum landen:

       · als FREMDES Dokument – über den Reiter oder einen Link. Es
         bekommt origin = 'shared', keine Datei, keinen Eintrag in der
         eigenen Verwaltung.
       · als EIGENES, freigegebenes Heft – der Besitzer öffnet es ganz
         normal von der Startseite. Es behält seine Datei (die bleibt die
         Sicherung), wird aber zusätzlich in den Raum geschrieben.

     Der zweite Fall fehlte lange, und damit fehlte die halbe
     Zusammenarbeit: der Besitzer sah von den Änderungen der anderen
     nichts, und „Freigabe aktualisieren" hat sie überschrieben. Beide
     Fälle laufen jetzt durch dieselbe Sitzung.
     ══════════════════════════════════════════════════════════════════ */

  // { docId, nbId, isOwner } – solange etwas im Raum offen ist
  let live = null;

  /* ── Ein Dokument öffnen ────────────────────────────────────────── */

  /* ══════════════════════════════════════════════════════════════════
     GLEICHE FASSUNG ODER GAR NICHT

     Die Prüfung steht in openSharedDocument und nicht an den beiden
     Wegen davor (Kachel und Link), weil BEIDE hier hindurchkommen. Eine
     Sperre, die man über den Link umgehen kann, ist keine.

     Sie steht ganz am Anfang, vor dem Laden: was hier abgewiesen wird,
     soll gar nicht erst über die Leitung gehen.

     Warum das nötig ist, steht bei versionPasst() in core/share.js.
     ══════════════════════════════════════════════════════════════════ */
  async function versionsSperre(head) {
    const api = window.InkwellShare;
    if (!api || typeof api.versionPasst !== 'function') return false;

    const urteil = await api.versionPasst(head);
    if (urteil.ok) return false;

    const satz = urteil.wer === 'besitzer'
      ? (t('versionLockOwnerOlder')
          || 'Der Besitzer arbeitet mit einer älteren Fassung von Inkwell ({ihre}) als du ({meine}). '
           + 'Solange das so ist, lässt sich das Dokument nicht öffnen.')
      : (t('versionLockYouOlder')
          || 'Dieses Dokument gehört zu Inkwell {ihre}, du hast {meine}. '
           + 'Bitte aktualisiere die App, dann kannst du es öffnen.');

    const text = satz.replace('{ihre}', urteil.ihre).replace('{meine}', urteil.meine);
    if (typeof showAlert === 'function') await showAlert(text);
    else if (typeof toast === 'function') toast(text, true);

    console.warn('[SharedDocs] Versionssperre:', urteil.meine, 'vs', urteil.ihre);
    return true;
  }

  async function openSharedDocument(head) {
    if (await versionsSperre(head)) return;

    const api = await whenShareReady();

    /* Ohne Konto (oder mit einer Adresse, die nicht eingetragen ist) bleibt
       der Weg über den Link: solange der offen ist, darf gelesen werden –
       genau so steht es auch in den Regeln. Vorher endete dieser Fall mit
       „Freigabe gibt es nicht mehr", obwohl der Link einwandfrei war. */
    const role = myRole(head)
      || (head.linkMode === 'view' || head.linkMode === 'edit' ? 'view' : null);
    if (!role) throw new Error('SHARE_NOT_FOUND');

    toast(t('sharedOpening'));
    const { notebook, head: fresh, fingerprint, crdt } = await api.loadDocument(head.docId);

    // Merkzettel vom geladenen Stand. Daran erkennt das Speichern später,
    // WELCHE Seite sich geändert hat – geschrieben wird nur die.
    baseline = fingerprint;
    crdtState = crdt || {};
    dirty = false;
    // Ein neues Dokument, ein neuer Versuch – siehe keinSchreibrecht
    keinSchreibrecht = false;

    // Als geteiltes Dokument kennzeichnen, BEVOR es in S.notebooks landet:
    // sonst greifen die Bremsen in fileManager/registry/cloudSync nicht.
    notebook.origin = 'shared';
    notebook.id = 'shared:' + fresh.docId;

    /* Wie sich aneinanderstossende Texte verhalten, entscheidet der
       Besitzer für alle (canvas/text.js, ausweichArt). Steht im Kopf
       nichts, ist die Freigabe aus der Zeit davor – dann gilt die
       eigene Wahl, wie bei jedem anderen Heft auch. */
    if (fresh.textFluss) notebook.textFluss = fresh.textFluss;

    /* Von wem es stammt. Steht sonst nur in der Leiste über dem offenen
       Dokument (applyReadOnlyChrome) und in der Kachelliste – die Suche
       findet ihre Treffer aber quer über alles und braucht die Auskunft
       an der Zeile selbst. „Physik" allein sagt einem nichts, wenn drei
       Leute ein Heft so nennen. */
    notebook.sharedBy = fresh.ownerName || fresh.ownerEmail || '';

    const idx = S.notebooks.findIndex(nb => nb.id === notebook.id);
    if (idx >= 0) S.notebooks[idx] = notebook; else S.notebooks.push(notebook);

    live = { docId: fresh.docId, nbId: notebook.id, isOwner: false, ownerUid: fresh.owner };

    const finalRole = myRole(fresh) || role;

    /* ══════════════════════════════════════════════════════════════
       GESPERRT, BIS DER RAUM DAS GEGENTEIL SAGT

       Das Recht zu bearbeiten ruht, solange der Kontakt zum Besitzer
       nicht gesichert ist (applyOwnerHold weiter unten). Aufgehoben wird
       die Sperre allein durch onOwnerAway(false) – eine Meldung AUS dem
       Live-Raum.

       >>> Warum hier vorher offen stand <<<
       Es lief andersherum: offen ab dem ersten Augenblick, und erst wenn
       der Raum „der Besitzer ist weg" meldete, wurde zugemacht. Kam
       diese Meldung nie, blieb es offen – und sie kommt genau dann nie,
       wenn der Live-Betrieb GAR NICHT ZUSTANDE KOMMT:

         · der Besitzer hat den Raum noch nie betreten, es gibt keine
           Rollenliste und damit keinen Einlass (ROOM_NOT_ADMITTED),
         · die Realtime Database ist nicht erreichbar,
         · man ist über einen Link ohne Konto drin,
         · der Raum ist besetzt (ROOM_OWNER_MISMATCH).

       In allen vier Fällen konnte man munter weiterschreiben, ohne dass
       es irgendjemand mitbekam – und der Besitzer womöglich zugleich an
       derselben Seite. Genau so ist es gemeldet worden: „ich kann
       bearbeiten, obwohl der Besitzer nicht drin ist."

       Die sichere Seite ist die geschlossene. Wer nur lesen darf, merkt
       ohnehin nichts davon.
       ══════════════════════════════════════════════════════════════ */
    applyReadOnlyChrome(true, {
      docId: fresh.docId,
      role: finalRole,
      ownerName: fresh.ownerName,
      ownerEmail: fresh.ownerEmail,
      title: fresh.title,
      revision: fresh.revision,
      // Für den Streifen: das Recht besteht, es ruht nur
      ownerAway: finalRole === 'edit'
    });

    openNotebook(notebook.id);
    watchOpenDocument(fresh.docId);

    /* Live-Betrieb: Anwesenheit, Marker, gemeinsames Tippen, Handschrift.
       Läuft ohne Realtime Database nicht – dann bleibt es beim Speichern
       im 4-Sekunden-Takt, ohne dass etwas kaputtgeht.

       Ohne echtes Konto (Link ohne Anmeldung) gar nicht erst versuchen:
       der Raum verlangt eine Kennung, der Versuch endete nur mit einer
       roten Warnung im Streifen, obwohl alles in Ordnung ist. */
    /* Ohne Live-Betrieb bleibt es bei der Sperre von oben. Das ist keine
       Störung, sondern die einzige ehrliche Auskunft: ohne Raum kann
       niemand wissen, ob der Besitzer gerade selbst schreibt. */
    if (!window.Collab || !api.hasRealIdentity()) {
      if (finalRole === 'edit') {
        console.warn('[SharedDocs] Kein Live-Betrieb – Bearbeiten ruht');
      }
      return;
    }

    {
      /* Die eigene Firebase-Kennung in den Kopf eintragen. Der Besitzer
         baut daraus die Rollenliste des Raums – ohne sie gibt es fuer
         diese Person keinen Live-Betrieb (core/share.js, registerMyUid).
         Schlaegt es fehl, wird trotzdem geoeffnet: gespeichert wird
         weiterhin ueber Firestore. */
      /* >>> Abgewartet, nicht nebenher <<<
         Hier stand ein Aufruf ohne await, und gleich danach betrat
         Collab.start() den Raum. Der Besitzer kann die Kennung aber erst
         in die Rollenliste aufnehmen, wenn sie im Kopf steht - und
         solange sie fehlt, weist die Regel jede Anwesenheit ab. Der
         Eingeladene bekam deshalb verlaesslich permission_denied, und es
         half nur, das Dokument zuzumachen und neu zu oeffnen.

         Der Fehler wird jetzt auch gemeldet statt verschluckt: ohne
         Eintrag gibt es keinen Live-Betrieb, und das soll man sehen.

         Mit ?. gefragt: eine aeltere core/share.js kennt es noch nicht. */
      try {
        await api.registerMyUid?.(fresh.docId, fresh);
      } catch (err) {
        console.warn('[SharedDocs] Eigene Kennung nicht eingetragen:', err?.message || err);
      }

      Collab.start(fresh.docId, notebook, crdtState, finalRole === 'edit', {
        isOwner: false,
        ownerUid: fresh.owner,
        roomKey: fresh.roomKey || '',
        onOwnerAway: applyOwnerHold
      }).catch(err => {
        /* Kein Raum – dann bleibt die Sperre von oben stehen. Sie NICHT
           zu lösen ist hier die ganze Arbeit: onOwnerAway wird jetzt nie
           gerufen, und vorher hiess das „darf schreiben". */
        console.warn('[SharedDocs] Live-Betrieb aus:', err?.message || err);
        applyOwnerHold(true);
      });
    }
  }

  /* ── Der Kontakt zum Besitzer fehlt ──────────────────────────────────
     Egal ob ihm die Leitung abgerissen ist, er die App zugemacht hat,
     oder die eigene Verbindung fehlt: ohne gesicherten Kontakt könnte der
     Besitzer gerade örtlich weiterschreiben, ohne dass es jemand
     mitbekommt. Wer eingeladen ist, liest dann nur, damit nicht zwei
     Fassungen derselben Seite entstehen. Das Recht selbst bleibt
     bestehen; es ruht nur. Kehrt der Kontakt zurück, gilt wieder alles
     wie vorher. Erklärung in core/share.js (onOwnerAway).

     Gefragt wird S.sharedDoc.role und nicht das Recht von vorhin: der
     Besitzer kann es zwischendurch geändert haben (watchOpenDocument). */
  function applyOwnerHold(away) {
    if (!S.sharedDoc) return;
    const was = !!S.sharedDoc.ownerAway;
    const now = !!away;
    S.sharedDoc.ownerAway = now;

    applyReadOnlyChrome(now || S.sharedDoc.role !== 'edit', S.sharedDoc);
    if (window.Collab?.setCanWrite) {
      window.Collab.setCanWrite(!now && S.sharedDoc.role === 'edit');
    }

    // Nur beim Wechsel melden – der erste Rückruf kommt beim Betreten
    if (now !== was) {
      toast(now ? t('sharedOwnerOffline') : t('sharedOwnerBack'));
      if (!now) holeStandNach();
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     DER BESITZER IST WIEDER DA – UND HAT INZWISCHEN GESCHRIEBEN

     Solange er weg war, ging von ihm nichts in den Raum. Er hat
     woanders oder ohne Netz weitergearbeitet, und was dabei entstand,
     liegt in Firestore. Der Raum überträgt aber nur ÄNDERUNGEN AB DEM
     BEITRETEN: wer die ganze Zeit offen hatte, sieht davon nie etwas.
     Genau so gemeldet – „wenn der Besitzer zurückkommt, sehen die
     anderen nicht, was er gemacht hat, und bleiben im Lesemodus".

     Deshalb einmal frisch aufmachen, sobald er wieder da ist. Der
     eigene Stand kann dabei nicht verlorengehen: ohne Besitzer im Raum
     darf ohnehin niemand schreiben (onOwnerAway in core/share.js).

     >>> Warum an der Fassung und nicht an der Zeit <<<
     Eine kurz abgerissene Leitung meldet dasselbe wie ein
     Zurückkommen. Neu geladen wird deshalb nur, wenn der Kopf des
     Dokuments eine andere Fassung trägt als die, die hier steht – dann
     ist wirklich etwas passiert. Bei einem Aussetzer bleibt alles
     stehen, samt Bildlauf und Schreibmarke.
     ══════════════════════════════════════════════════════════════════ */
  let holtNach = false;

  async function holeStandNach() {
    const doc = S.sharedDoc;
    if (!doc || doc.isOwner || !doc.docId || holtNach) return;

    holtNach = true;
    try {
      const api = await whenShareReady();
      const head = await api.loadDocumentHead(doc.docId);
      // Inzwischen zugemacht oder ein anderes Dokument offen?
      if (!head || !S.sharedDoc || S.sharedDoc.docId !== doc.docId) return;
      if (head.revision && head.revision === doc.revision) return;

      if (window.Collab) await Collab.stop(doc.docId);
      await openSharedDocument(head);
    } catch (err) {
      console.warn('[SharedDocs] Der Stand des Besitzers kam nicht nach:',
        err?.message || err);
    } finally {
      holtNach = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     DER BESITZER MACHT MIT

     Der Besitzer öffnet sein Heft von der Startseite – aus der Datei,
     nicht aus dem Raum. Ist es freigegeben, wird daraus hier eine
     Live-Sitzung. Drei Schritte, und die Reihenfolge ist nicht beliebig:

       1. Was hier seit dem letzten Abgleich entstanden ist, geht ZUERST
          hinauf. Sonst ginge es beim nächsten Schritt verloren.
       2. Dann übernimmt der Raum. Er ist die maßgebliche Fassung – so ist
          es entschieden (COLLAB_SPEC, Abschnitt 7 und 9.4). Die Datei
          bleibt die Sicherung und wird vom Raum aus geschrieben, nicht
          umgekehrt; zwei Wahrheiten nebeneinander wären die Quelle jedes
          künftigen Fehlers.
       3. Erst danach der Raum selbst.

     Seiten, die es hier gibt und im Raum nicht, bleiben trotzdem stehen
     (siehe adoptRoom). Ohne das verlöre ein Besitzer, der ohne Netz
     gearbeitet hat, seine Arbeit beim nächsten Öffnen.
     ══════════════════════════════════════════════════════════════════ */

  /** Merkzettel je Dokument, damit Schritt 1 einen Vergleichsstand hat. */
  function fingerprintStore() {
    const raw = Settings.get('liveFingerprints');
    return (raw && typeof raw === 'object') ? raw : {};
  }

  async function rememberFingerprint(docId, fingerprint) {
    const all = fingerprintStore();
    all[docId] = fingerprint;
    await Settings.update({ liveFingerprints: all }).catch(() => {});
  }

  /**
   * Übernimmt den Stand aus dem Raum in das eigene Heft.
   *
   * Was der Raum nicht kennt, bleibt erhalten und geht beim nächsten
   * Sichern hinauf – der Fall „ohne Netz eine Seite angelegt".
   */
  function adoptRoom(nb, roomNb) {
    const roomIds = new Set((roomNb.pages || []).map(p => String(p.id)));

    /* Seiten, die es nur hier gibt – ohne Netz angelegt. Ihr Etikett steht
       an der Seite selbst und ueberlebt den Umbau von allein; frueher
       musste es aus den pgIds gerettet werden. */
    const extras = (nb.pages || []).filter(p => !roomIds.has(String(p.id)));

    // Der Raum ist die massgebliche Fassung, die eigenen Seiten haengen an
    nb.pages = (roomNb.pages || []).concat(extras);
    /* >>> Feldweise – also muss JEDES Feld hier stehen <<<
       Was nicht aufgezaehlt ist, faellt beim Uebernehmen still weg. Die
       Farbe fehlte: wer einem Abschnitt von Hand eine gab, verlor sie bei
       jedem Oeffnen seines freigegebenen Hefts. Leer heisst "nicht
       gewaehlt", dann rechnet colorForSection() eine aus der Kennung.
       Dieselbe Liste gibt es in applyStruct() (ui/collab.js) und
       splitNotebook() (core/share.js) – alle drei muessen gleich bleiben. */
    nb.sections = (roomNb.sections || []).map(sec => ({
      id: String(sec.id),
      name: String(sec.name || ''),
      pgIds: [],                       // gleich unten abgeleitet
      defaultBg: sec.defaultBg || nb.defaultBg || 'ruled',
      color: sec.color || ''
    }));

    /* Ein Etikett, das es im Raum nicht mehr gibt, wird abgenommen – die
       Seite bleibt, wo sie ist. Sie einem fremden Abschnitt zuzuschlagen
       waere geraten. */
    const bekannt = new Set(nb.sections.map(s => s.id));
    for (const page of nb.pages) {
      if (page.secId && !bekannt.has(String(page.secId))) delete page.secId;
    }
    if (typeof syncSectionIds === 'function') syncSectionIds(nb);

    if (nb.activeSecId && !bekannt.has(String(nb.activeSecId))) nb.activeSecId = '';
    return extras.length;
  }

  /**
   * Wird am Ende von openNotebook aufgerufen (app.js). Ist das Heft
   * freigegeben, wird daraus eine Live-Sitzung.
   */
  async function startOwnerSession(nb) {
    if (!nb || nb.origin === 'shared') return;

    const entry = (typeof window.notebookShareEntry === 'function')
      ? window.notebookShareEntry(nb.id) : null;
    if (!entry || !entry.docId) return;
    if (live && live.nbId === nb.id) return;              // läuft schon

    const api = await whenShareReady();
    const known = await CloudSync_.ensureFirebaseIdentity();
    if (!known) return;                                    // ohne Konto kein Raum

    const me = api.currentIdentity();
    const head = await api.loadDocumentHead(entry.docId);
    if (!me || head.owner !== me.uid) return;              // gehört uns nicht mehr

    /* Was im Editor steht, muss erst ins Datenmodell – sonst ginge genau
       das verloren, was in den Sekunden bis hierher getippt wurde. */
    if (S.activeNbId === nb.id && typeof syncAll === 'function') {
      try { syncAll(); } catch (e) { console.warn('[SharedDocs] syncAll:', e); }
    }

    /* 1. Eigenes zuerst hinauf – nur wenn wir wissen, WAS neu ist.

       Ein Überschreiben ohne Rückfrage ist hier zulässig, weil die
       Eingeladenen gar nicht geschrieben haben können: sobald der
       Besitzer nicht im Raum ist – abgestürzt oder zugemacht –, dürfen
       sie nur lesen (onOwnerAway in core/share.js). Was der Besitzer
       zuletzt gesehen hat, ist damit auch der Stand des Raums.

       Genau diese Zusicherung trägt die Regel. Fiele sie weg, müsste
       hier verglichen werden, statt zu überschreiben. */
    const stored = fingerprintStore()[entry.docId] || null;
    if (stored) {
      try {
        await api.saveDocumentContent(entry.docId, nb, { baseline: stored });
      } catch (err) {
        console.warn('[SharedDocs] Eigener Stand nicht hochgeladen:', err?.message || err);
      }
    }

    // 2. Der Raum übernimmt
    const loaded = await api.loadDocument(entry.docId);
    const extras = adoptRoom(nb, loaded.notebook);

    baseline = loaded.fingerprint;
    crdtState = loaded.crdt || {};
    dirty = extras > 0;                 // eigene Seiten müssen noch hinauf
    live = { docId: entry.docId, nbId: nb.id, isOwner: true };
    rememberFingerprint(entry.docId, loaded.fingerprint);

    applyReadOnlyChrome(false, {
      docId: entry.docId,
      role: 'edit',
      isOwner: true,
      ownerName: me.name || me.email,
      ownerEmail: me.email,
      title: loaded.head.title,
      revision: loaded.head.revision
    });

    /* Der Raum kann anders aussehen als die Datei – neu aufbauen.
       Ueber activeSection() und nicht ueber einen Rueckfall auf den ersten
       Abschnitt: null heisst "alle Seiten", und das ist der Normalfall.
       Derselbe Fehler stand in rerenderPages() (ui/collab.js) – ohne
       Abschnitte wurde dort gar nicht aufgebaut, mit Abschnitten sprang
       die Ansicht in den ersten. */
    if (S.activeNbId === nb.id && typeof openSection === 'function') {
      openSection(typeof activeSection === 'function' ? activeSection(nb) : null);
    }

    watchOpenDocument(entry.docId);

    /* 3. Der Raum. isOwner hinterlegt beim Betreten den Auftrag, der bei
       einem Verbindungsabbruch die Marke stehen lässt – daran erkennen die
       Eingeladenen, dass hier jemand ohne Netz weiterschreiben könnte
       (core/share.js, joinDocRoom). */
    if (window.Collab) {
      /* Die Rollenliste des Raums. Sie kommt aus dem Kopf und wird beim
         Betreten in die Realtime Database geschrieben – dort koennen die
         Regeln nicht in Firestore nachschlagen und brauchen deshalb
         Kennungen statt Adressen (website/database.rules.json). */
      Collab.start(entry.docId, nb, crdtState, true, {
        isOwner: true,
        ownerUid: me.uid,
        roomKey: loaded.head.roomKey || '',
        memberUids: api.roomRolesFrom ? api.roomRolesFrom(loaded.head) : {}
      }).catch(err => console.warn('[SharedDocs] Live-Betrieb aus:', err?.message || err));
    }
  }

  /**
   * Eine einzelne Seite aus Firestore nachholen. Ruft ui/collab.js auf,
   * wenn eine Änderung nicht durch den Live-Kanal passt – Bilder und
   * Seiten mit sehr viel Handschrift.
   *
   * Der TEXT wird bewusst nicht übernommen: der läuft über Yjs und ist
   * dort feiner und aktueller als alles, was in Firestore steht.
   */
  /**
   * Eine Änderung des anderen ist angekommen (ui/collab.js). Der
   * Merkzettel wird nachgezogen, damit sie NICHT als eigene, neue
   * Änderung gilt.
   *
   * >>> Warum das nicht bloß Sparsamkeit ist <<<
   * Der Merkzettel entscheidet in saveDocumentContent, was mit der
   * Handschrift geschieht. Eine Seite, die er nicht kennt, gilt als neu –
   * und für die werden die Bögen NEU GESCHRIEBEN. Käme also eine Seite
   * live herein und stünde nicht im Merkzettel, würde die nächste
   * Sicherung alle Striche löschen, die der andere seither darauf
   * gezeichnet hat.
   *
   * @param {string|null} pageId  null = alles neu bewerten (Reihenfolge,
   *   Abschnitte); sonst nur diese Seite.
   */
  window.noteRemoteApplied = function noteRemoteApplied(pageId) {
    const api = window.InkwellShare;
    if (!live || !baseline || !api) return;

    const nb = getNb(live.nbId);
    if (!nb) return;

    const fresh = api.fingerprintNotebook(nb);
    baseline.order = fresh.order;
    baseline.headSig = fresh.headSig;

    if (pageId === null || pageId === undefined) {
      baseline.pages = fresh.pages;
      return;
    }

    const key = String(pageId);
    if (fresh.pages[key]) baseline.pages[key] = fresh.pages[key];
    else delete baseline.pages[key];
  };

  window.reloadLivePage = async function reloadLivePage(pageId) {
    if (!live) return false;
    const api = await whenShareReady();
    const page = await api.loadPage(live.docId, String(pageId));
    if (!page) return false;

    const nb = getNb(live.nbId);
    if (!nb) return false;

    /* Die Seite fehlt hier noch? Dann ist sie eine, die für den
       Live-Kanal zu groß war und nur als Hinweis angekündigt wurde.
       Anlegen – wohin sie gehört, sagt die Reihenfolge, die gleich
       darauf kommt. */
    let local = (nb.pages || []).find(p => String(p.id) === String(pageId));
    const isNew = !local;
    if (!local) {
      local = { id: String(pageId), date: page.date || new Date().toISOString(),
                bg: null, textContent: page.textContent || '', inkStrokes: [], objects: [] };
      nb.pages.push(local);
    }

    /* ── Was von hier übernommen wird, und was nicht ──────────────────
       Firestore ist beim Nachladen NICHT die frischere Quelle. Es wird
       nur angefragt, weil Bilddaten nicht durch den Live-Kanal passen –
       alles Übrige ist über den Kanal längst da, und zwar aktueller.

       Vorher wurde die Seite komplett ersetzt. Wer ein Bild verschob,
       schickte deshalb erst die richtige neue Position über den Kanal
       und gleich darauf den Hinweis „lade neu" – und der holte den
       ALTEN Stand zurück. Beim Empfänger sprang das Bild wieder an
       seinen Platz. Genau das passiert hier jetzt nicht mehr: von der
       Seite kommen nur noch die Bilddaten. */
    let changed = isNew;

    if (isNew) {
      local.objects = page.objects || [];
      local.inkStrokes = page.inkStrokes || [];
      local.bg = page.bg ?? null;
      if (page.w) local.w = page.w;
      if (page.h) local.h = page.h;
      S.strokeHistory[String(pageId)] = JSON.parse(JSON.stringify(local.inkStrokes || []));
    } else {
      // Nur die Bilddaten in die bekannten Objekte einsetzen
      const withData = new Map(
        (page.objects || [])
          .filter(o => typeof o.src === 'string' && o.src.startsWith('data:'))
          .map(o => [String(o.id), o.src])
      );
      for (const obj of (local.objects || [])) {
        const src = withData.get(String(obj.id));
        if (src && obj.src !== src) { obj.src = src; changed = true; }
      }
      /* Ein Bild, dessen obj-Meldung noch unterwegs ist, gehört dazu.
         Bewusst NUR Bilder: alles andere kommt vollständig über den
         Live-Kanal, und würde man es hier ergänzen, käme ein gerade
         gelöschtes Objekt aus Firestore wieder zurück. */
      const known = new Set((local.objects || []).map(o => String(o.id)));
      for (const [id, src] of withData) {
        if (known.has(id)) continue;
        const source = (page.objects || []).find(o => String(o.id) === id);
        if (source) { (local.objects = local.objects || []).push({ ...source, src }); changed = true; }
      }
    }

    const bgBefore = local.bgImg || '';
    if (page.bgImg) local.bgImg = page.bgImg; else delete local.bgImg;
    if ((local.bgImg || '') !== bgBefore) changed = true;

    /* >>> Warum hier ehrlich „nichts gebracht" gemeldet werden muss <<<
       ui/collab.js versucht es noch einmal, wenn nichts herauskam – die
       Seite kann in Firestore stehen, ihre Bilder aber noch nicht. Würde
       hier immer „ja" gemeldet, bliebe der Abruf bei diesem einen Versuch
       und das Bild fehlte für immer. */
    return changed;
  };

  /**
   * Das offene Dokument im Auge behalten. Verschwindet die eigene Adresse
   * aus der Mitgliederliste, wird sofort geschlossen – auf den Anstand des
   * Clients verlässt sich dabei niemand, die Regeln blockieren jedes
   * weitere Schreiben ohnehin.
   */
  function watchOpenDocument(docId) {
    if (unwatchOpen) { unwatchOpen(); unwatchOpen = null; }
    const api = window.InkwellShare;
    if (!api) return;

    unwatchOpen = api.watchDocument(docId, (head) => {
      if (!S.sharedDoc || S.sharedDoc.docId !== docId) return;

      /* Der Besitzer kann sich nicht selbst aussperren. Ist das Dokument
         weg (auf einem anderen Gerät aufgehoben), endet nur die
         Live-Sitzung – sein Heft behält er. */
      if (S.sharedDoc.isOwner) {
        if (!head) { endLiveSession(); applyReadOnlyChrome(false, null); }
        else {
          S.sharedDoc.revision = head.revision;
          /* Wer dazukommt, traegt seine Kennung selbst ein – der Kopf
             aendert sich dadurch, und erst dann kann der Besitzer ihn in
             die Rollenliste des Raums aufnehmen. Ohne dieses Nachziehen
             bekaeme ein frisch Eingeladener bis zum naechsten Oeffnen
             keinen Live-Betrieb. */
          if (window.Collab?.refreshRoomRoles && window.InkwellShare?.roomRolesFrom) {
            window.Collab.refreshRoomRoles(window.InkwellShare.roomRolesFrom(head));
          }
        }
        return;
      }

      if (!head) { kickOut(t('sharedRevoked')); return; }

      const role = myRole(head);
      if (!role) { kickOut(t('sharedRevoked')); return; }

      /* Recht geändert – und zwar sofort, in beide Richtungen.

         applyReadOnlyChrome allein genügte nicht: der Raum hatte sein
         Schreibrecht beim Beitreten bekommen und behielt es. Wer
         herabgestuft wurde, konnte deshalb weiter in den Raum schreiben;
         wer heraufgestuft wurde, durfte laut Anzeige bearbeiten, aber
         seine Änderungen kamen nirgends an. */
      if (role !== S.sharedDoc.role) {
        S.sharedDoc.role = role;
        /* Fehlt gerade der Kontakt zum Besitzer, ruht das Schreibrecht –
           auch ein frisch heraufgestuftes. Sonst hübe diese Stelle die
           Sperre wieder auf, die applyOwnerHold eben gesetzt hat. */
        const held = !!S.sharedDoc.ownerAway;
        applyReadOnlyChrome(held || role !== 'edit', S.sharedDoc);
        if (window.Collab?.setCanWrite) window.Collab.setCanWrite(!held && role === 'edit');
        toast(role === 'edit' ? t('sharedNowEdit') : t('sharedNowView'));
      }

      /* Der Besitzer hat umgestellt, wie sich aneinanderstossende Texte
         verhalten (Einstellungen, textFluss). Das gilt für alle in
         diesem Dokument – sonst sähe dieselbe Seite bei jedem anders
         aus. Ohne dieses Nachziehen erst beim nächsten Öffnen. */
      const nb = getNb('shared:' + docId);
      if (nb && head.textFluss && nb.textFluss !== head.textFluss) {
        nb.textFluss = head.textFluss;
        if (typeof window.wendeTextFlussAn === 'function') window.wendeTextFlussAn();
      }

      S.sharedDoc.revision = head.revision;
    });
  }

  function kickOut(message) {
    const docId = S.sharedDoc?.docId;
    if (unwatchOpen) { unwatchOpen(); unwatchOpen = null; }
    if (docId) S.notebooks = S.notebooks.filter(nb => nb.id !== 'shared:' + docId);
    S.activeNbId = null;
    showHome();
    switchTab('shared');
    toast(message, true);
  }

  /** Ist das gerade offene Dokument noch in der Liste? */
  function checkStillAllowed() {
    const open = S.sharedDoc;
    if (!open || open.isOwner) return;      // der eigene Raum steht nie in der Liste
    if (docs.some(d => d.docId === open.docId)) return;
    kickOut(t('sharedRevoked'));
  }

  /* ── Zurückschreiben ────────────────────────────────────────────────
     autoSave.markDirty leitet Änderungen an geteilten Dokumenten hierher
     um. Gespeichert wird gebündelt, nicht bei jedem Tastendruck: jedes
     Mal geht das ganze Heft über die Leitung.
     ─────────────────────────────────────────────────────────────── */

  const SAVE_DELAY_MS = 4000;
  let saveTimer = null;
  let saving = false;
  let outdatedWarned = false;

  /* Stand des Dokuments beim Laden bzw. nach dem letzten Speichern.
     Ohne ihn müsste jedes Mal das ganze Heft hochgeladen werden. */
  let baseline = null;

  // Gespeicherte Yjs-Stände je Seite (für die Live-Bearbeitung)
  let crdtState = {};

  /* Gibt es überhaupt etwas zu sichern? Ohne diese Frage lief beim
     Schließen jedes Mal ein Speichervorgang an – auch wenn nur gelesen
     wurde. Zusammen mit dem Merkzettel-Fehler unten hieß das: das ganze
     Dokument wurde neu geschrieben, bloß weil man es geöffnet hatte. */
  let dirty = false;

  /* Der gerade laufende Speichervorgang – oder null.
     Gebraucht, damit jemand darauf warten KANN. saveOpenDocument steigt
     aus, solange schon einer läuft; wer danach auf das Ergebnis wartete,
     wartete in Wirklichkeit auf nichts. */
  let inFlight = null;

  /**
   * Speichern anstoßen und den Vorgang festhalten.
   *
   * Läuft bewusst synchron an: saveOpenDocument merkt sich Dokument,
   * Merkzettel und Heft im ersten Zug, noch vor dem ersten await. Beim
   * Schließen wird gleich nach dem Aufruf `live = null` gesetzt – käme
   * der Anfang erst eine Warteschlange später, fände er nichts mehr vor
   * und es würde gar nicht gespeichert.
   */
  function startSave() {
    const running = saveOpenDocument();
    inFlight = running;
    Promise.resolve(running).catch(() => {}).then(() => {
      if (inFlight === running) inFlight = null;
    });
    return running;
  }

  window.markSharedDocDirty = function markSharedDocDirty(nbId) {
    // Gehört das Heft zur laufenden Sitzung? Für ein fremdes Dokument ist
    // die Kennung 'shared:<docId>', für ein eigenes die des Hefts.
    if (!live || S.readOnly || nbId !== live.nbId) return;

    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { startSave().catch(() => {}); }, SAVE_DELAY_MS);
  };

  /**
   * Jetzt wirklich schreiben – und erst zurückkommen, wenn es durch ist.
   *
   * Gebraucht von ui/collab.js, bevor es der Gegenseite sagt, sie solle
   * eine Seite aus Firestore nachladen. Der Hinweis ist nur brauchbar,
   * wenn dort auch schon der neue Stand steht. Vorher ging er hinaus,
   * ohne dass je etwas geschrieben worden wäre – daran lagen die leeren
   * PDF-Seiten und die zurückspringenden Bilder beim anderen.
   *
   * `dirty` wird dabei bewusst gesetzt: ein verschobenes Bild meldet sich
   * nicht von selbst, und ohne die Marke stiege das Speichern gleich
   * wieder aus.
   */
  window.forceSharedDocSave = async function forceSharedDocSave() {
    if (!live || S.readOnly) return false;

    // Auf einen laufenden Vorgang warten – der kennt den jetzigen Stand nicht
    for (let guard = 0; inFlight && guard < 20; guard++) {
      try { await inFlight; } catch (err) { /* der nächste Versuch zählt */ }
    }
    if (!live || S.readOnly) return false;

    dirty = true;
    return await startSave();
  };

  /* ══════════════════════════════════════════════════════════════════
     WENN DAS RECHT FEHLT, WIRD NICHT WEITER GEKLOPFT

     Ein abgewiesener Schreibversuch setzte `dirty` zurück auf wahr. Die
     nächste Änderung stiess damit sofort den nächsten an, der genauso
     abgewiesen wurde – alle vier Sekunden eine rote Meldung, und keine
     davon sagte etwas Neues.

     Fehlt das Recht (die Rolle wurde entzogen, oder die Freigabe gilt
     nur zum Lesen), ändert sich daran auch beim zwanzigsten Versuch
     nichts. Dann wird einmal gesagt, warum, und danach Ruhe gegeben.
     Ein Netzfehler ist etwas anderes: der geht vorbei, dort bleibt es
     beim erneuten Versuch.
     ══════════════════════════════════════════════════════════════════ */
  let keinSchreibrecht = false;

  function rechtFehlt(err) {
    const msg = String(err?.message || '');
    if (msg === 'NOT_ALLOWED') return true;
    return /permission[-_ ]denied/i.test(msg) || err?.code === 'permission-denied';
  }

  /** @returns {boolean} ob wirklich geschrieben wurde */
  async function saveOpenDocument() {
    if (saving || !live || S.readOnly || !dirty || keinSchreibrecht) return false;
    const open = S.sharedDoc || { docId: live.docId };
    const nb = getNb(live.nbId);
    if (!nb) return;

    /* >>> Den Merkzettel JETZT festhalten <<<
       Beim Schließen wird gleich nach diesem Aufruf `baseline = null`
       gesetzt – synchron, also lange bevor die erste Antwort da ist. Wurde
       er erst später gelesen, stand dort null, und saveDocumentContent
       deutete das als „ich weiß nichts über den bisherigen Stand": es hat
       den gesamten Inhalt gelöscht und neu geschrieben. Damit war bei
       jedem Schließen alles weg, was ein anderer inzwischen geändert
       hatte – samt der Yjs-Stände aller Seiten. */
    const base = baseline;
    const states = crdtState;
    const session = live;

    /* ── Die eigene Wahl reist mit, aber nur als Besitzer ────────────
       Wie sich aneinanderstossende Texte verhalten, gilt für alle in
       diesem Dokument (canvas/text.js, ausweichArt). Der Besitzer legt
       es fest; hier wird sein jetziger Stand angehängt, damit eine
       Änderung in den Einstellungen beim nächsten Sichern hinausgeht.

       Ein Bearbeiter fasst das Feld nicht an – die Firestore-Regel
       lässt ihm am Kopf nur die Seitenliste durch, und ein fünfter
       Schlüssel würde seinen ganzen Schreibvorgang abweisen. */
    if (session.isOwner && typeof Settings !== 'undefined') {
      nb.textFluss = Settings.get('textFluss') || 'elastisch';
    }

    saving = true;
    dirty = false;
    try {
      /* Was im Live-Kanal noch wartet, gehört zuerst hinaus. Sonst ginge
         der Stand nach Firestore, bevor die anderen ihn überhaupt gesehen
         haben – und wer gerade dazukäme, sähe zwei verschiedene Fassungen. */
      if (window.Collab && typeof Collab.syncNow === 'function') {
        try { Collab.syncNow(); } catch (e) {}
      }

      // Der Editor-Stand muss erst ins Datenmodell, sonst fehlt genau das,
      // was gerade getippt wurde.
      if (S.activeNbId === nb.id && typeof syncAll === 'function') {
        try { syncAll(); } catch (e) { console.warn('[SharedDocs] syncAll:', e); }
      }

      const api = await whenShareReady();
      const result = await api.saveDocumentContent(open.docId, nb, { baseline: base });

      /* Den Yjs-Stand der Seiten mitsichern, auf denen getippt wurde. Er
         ist beim nächsten Öffnen die maßgebliche Fassung – nur er kann
         zwei gleichzeitige Änderungen zusammenführen. Der HTML-Text
         daneben bleibt für Betrachter, Export und Suche. */
      /* Bewusst NICHT von Collab.isLive() abhängig: der gemeinsame Text
         wird auch ohne Realtime Database mitgeführt (ui/collab.js), und
         beim Schließen ist der Raum ohnehin schon verlassen. Vorher fiel
         genau die letzte Sicherung dadurch aus – der Yjs-Stand blieb auf
         dem Stand der vorletzten. */
      if (window.Collab) {
        for (const page of (nb.pages || [])) {
          const pageId = String(page.id);
          const state = Collab.stateFor(pageId);
          if (!state || states[pageId] === state) continue;
          await api.savePageText(open.docId, pageId, {
            text: page.textContent || '',
            ycrdt: state
          });
          states[pageId] = state;
        }
      }

      /* Ab jetzt ist DAS der bekannte Stand – die nächste Änderung wird
         wieder nur gegen ihn verglichen. Nur, solange dasselbe Dokument
         noch offen ist: beim Schließen ist der Merkzettel absichtlich
         leer, und ein nachträglicher Eintrag würde den nächsten Öffner
         mit einem fremden Stand vergleichen lassen. */
      if (live === session) {
        baseline = result.fingerprint;
        // Damit der Besitzer beim nächsten Öffnen weiß, was er selbst
        // zuletzt hinaufgegeben hat (startOwnerSession, Schritt 1).
        if (session.isOwner) rememberFingerprint(session.docId, result.fingerprint);
      }
      open.revision = result.revision;
      outdatedWarned = false;
      if (result.written) console.log('[SharedDocs]', result.written, 'Teil(e) geschrieben');
      return true;
    } catch (err) {
      /* Nicht angekommen heißt: es steht weiterhin etwas aus – ausser
         das Recht fehlt, dann bringt kein weiterer Versuch etwas. */
      if (live === session && !rechtFehlt(err)) dirty = true;

      if (rechtFehlt(err)) {
        keinSchreibrecht = true;
        clearTimeout(saveTimer);
        console.warn('[SharedDocs] Kein Schreibrecht – es wird nicht weiter versucht');
        toast(t('sharedNoRight'), true);
      } else if (err?.message === 'DOC_OUTDATED') {
        // Nur noch bei Freigaben aus der Zeit vor dem zerlegten Modell.
        if (!outdatedWarned) {
          outdatedWarned = true;
          toast(t('sharedOutdated'), true);
        }
      } else {
        console.warn('[SharedDocs] Speichern fehlgeschlagen:', err?.message || err);
        toast(describeError(err), true);
      }
    } finally {
      saving = false;
    }
    return false;
  }

  /* Der Knopf „Freigabe verlassen" in der Leiste über dem Dokument ist
     entfallen; die Entscheidung sitzt jetzt im Punktemenü der Karte in
     der Übersicht (zeigeKartenMenue weiter oben). */

  /* ── Aus dem Browser heraus geöffnet ────────────────────────────────
     main.js schickt inkwell://share/<linkId> als eigenes Ereignis. Das
     landete früher beim OAuth-Rückruf und lief dort ins Leere.
     ─────────────────────────────────────────────────────────────── */

  async function openFromLink(linkId) {
    if (!linkId) return;
    try {
      const api = await whenShareReady();
      await api.whenIdentityReady();

      const { docId } = await api.resolveLink(linkId);
      if (!docId) throw new Error('SHARE_NOT_FOUND');

      if (api.hasRealIdentity()) {
        const outcome = await api.joinViaLink(docId);
        if (outcome === 'blocked') { toast(t('sharedBlocked'), true); return; }
      }

      const head = await api.loadDocumentHead(docId);
      await openSharedDocument(head);
    } catch (err) {
      console.error('[SharedDocs] Link konnte nicht geöffnet werden:', err);
      toast(describeError(err), true);
    }
  }

  if (window.api && typeof window.api.onOpenShare === 'function') {
    window.api.onOpenShare((linkId) => openFromLink(linkId));
  }
  if (window.api && typeof window.api.getPendingShareLink === 'function') {
    window.api.getPendingShareLink().then(linkId => {
      if (linkId) openFromLink(linkId);
    }).catch(() => {});
  }

  /* ── Verdrahtung ────────────────────────────────────────────────── */

  // Nach einer Anmeldung (oder deren Verlust) die Liste neu aufbauen
  document.addEventListener('inkwell-identity-changed', () => {
    refreshTabVisibility();
    startWatching().catch(() => {});
  });

  window.refreshSharedTab = function refreshSharedTab() {
    renderBadge();
    if (activeTab === 'shared') renderShared();
  };

  /**
   * Räumt auf, sobald ein geteiltes Dokument nicht mehr offen ist: noch
   * ausstehende Änderungen wegschreiben, Beobachtung beenden und das
   * fremde Heft wieder aus S.notebooks nehmen. Ohne das fände die Suche
   * es später wieder – und öffnete es dann beschreibbar.
   * Wird von showHome() aufgerufen (core/dialogs.js).
   */
  function endLiveSession() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

    /* Noch nicht gespeicherte Änderungen jetzt loswerden, bevor das Heft
       aus dem Zustand verschwindet. saveOpenDocument() merkt sich Dokument
       und Heft sofort, der Rest läuft im Hintergrund weiter.

       Reihenfolge: ERST sichern, DANN den Raum verlassen. Andersherum war
       der gemeinsame Text schon abgebaut, wenn das Sichern ihn holen
       wollte – der Yjs-Stand der letzten Minuten ging dabei verloren. */
    const closingId = live?.docId || '';
    const pending = (live && !S.readOnly)
      ? startSave().catch(() => {})
      : Promise.resolve();

    if (unwatchOpen) { unwatchOpen(); unwatchOpen = null; }
    pending.then(() => {
      // Mit der Kennung: bis hierher kann längst ein anderes Dokument
      // offen sein, und das darf dieser Aufruf nicht mit abräumen.
      if (window.Collab) return Collab.stop(closingId);
    }).catch(() => {});

    // Nur FREMDE Dokumente verschwinden aus dem Zustand – das eigene Heft
    // des Besitzers bleibt selbstverständlich, wo es ist.
    S.notebooks = S.notebooks.filter(nb => nb.origin !== 'shared');
    S.sharedDoc = null;
    live = null;
    baseline = null;
    crdtState = {};
    dirty = false;
    keinSchreibrecht = false;
  }

  /**
   * Räumt auf, sobald nichts mehr im Raum offen ist.
   * Wird von showHome() aufgerufen (core/dialogs.js).
   */
  window.closeOpenSharedDoc = endLiveSession;

  /**
   * Ein Heft wurde geöffnet (Ende von openNotebook, app.js). Gehört es zu
   * einer Freigabe, wird daraus eine Live-Sitzung – auch beim Besitzer.
   */
  window.onNotebookOpened = function onNotebookOpened(nb) {
    if (!nb) return;
    // Vorherige Sitzung beenden, wenn jetzt ein anderes Heft offen ist
    if (live && live.nbId !== nb.id) endLiveSession();
    if (nb.origin === 'shared') return;      // hat ui/sharedDocs selbst aufgesetzt

    startOwnerSession(nb).catch(err => {
      const msg = err?.message || String(err);
      if (msg !== 'SHARE_NOT_FOUND' && msg !== 'SHARE_OFFLINE') {
        console.warn('[SharedDocs] Eigene Live-Sitzung nicht gestartet:', msg);
      }
    });
  };

  window.openSharedDocumentByLink = openFromLink;

  /* ══════════════════════════════════════════════════════════════════
     EIN GETEILTES DOKUMENT ÜBER SEINE KENNUNG ÖFFNEN

     Für die Suche (ui/search.js). Sie darf openNotebook NICHT selbst
     aufrufen: ein geteiltes Dokument braucht den Nur-Lese-Zustand, den
     Live-Raum und die Aufsicht auf den Kopf, und all das hängt an
     openSharedDocument. Ohne diesen Weg wurden geteilte Hefte deshalb
     gar nicht erst durchsucht.

     @param {string} docId  ohne das „shared:" davor
     ══════════════════════════════════════════════════════════════════ */
  window.openSharedDocumentById = async function openSharedDocumentById(docId) {
    try {
      const api = await whenShareReady();
      const head = await api.loadDocumentHead(docId);
      await openSharedDocument(head);
    } catch (err) {
      console.error('[SharedDocs] Dokument konnte nicht geöffnet werden:', err);
      toast(describeError(err), true);
    }
  };
  window.flushSharedDocSave = startSave;

  /* Steht im offenen geteilten Dokument etwas zum Zurueckschreiben an?
     saveOpenDocument() steigt bei !dirty ohnehin sofort aus - fuer die
     Anzeige beim Beenden muss man es aber VORHER wissen. */
  window.sharedDocHatOffenes = () => !!(live && dirty && !S.readOnly);

  /* ══════════════════════════════════════════════════════════════════
     WELCHES HEFT STECKT GERADE IN EINEM LIVE-RAUM?

     Gefragt von core/cloudSync.js. Solange eine Freigabe läuft, ist der
     RAUM die Wahrheit und nicht die Datei im Drive: der Text kommt über
     Yjs, die Handschrift bogenweise, und beides landet im 4-Sekunden-
     Takt in Firestore.

     >>> Warum das gebraucht wird <<<
     Gemeldet worden: „während der Live-Freigabe kommt dauernd, das
     Dokument habe in der Cloud eine andere Fassung als hier." Und das
     stimmte sogar – nur war es kein Konflikt, sondern der Normalfall.
     Der Besitzer lädt seine Datei alle paar Sekunden hoch, während die
     anderen weiterschreiben; zwischen dem Ende eines Uploads und der
     nächsten Änderung liegen selten mehr als ein paar Augenblicke. Der
     Abgleich sah dann zwei frische Zeitstempel und zwei verschiedene
     Inhalte – genau seine Bedingung für „zwei Fassungen".

     Schlimmer als das Band wäre gewesen, was danach kam: das
     Herunterladen der Cloud-Fassung und ein openNotebook() mitten in die
     laufende Sitzung hinein. Damit wäre die Arbeit der letzten Minuten
     durch einen älteren Stand ersetzt worden.

     Der Wert ist leer, sobald die Sitzung endet – ab da gleicht sich
     das Heft wieder ganz gewöhnlich ab.
     ══════════════════════════════════════════════════════════════════ */
  window.liveShareNbId = () => (live && live.nbId) ? live.nbId : '';

  // Beim Start einmal nachsehen. Ohne Anmeldung passiert dabei nichts.
  startWatching().catch(err => console.warn('[SharedDocs] Start:', err?.message || err));
})();
