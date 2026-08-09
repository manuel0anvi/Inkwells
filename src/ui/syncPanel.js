'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DAS SYNC-FENSTER

   Beantwortet eine einzige Frage: ist meine Arbeit oben, und wenn nicht,
   was fehlt noch?

   >>> Warum das ein eigenes Fenster ist <<<
   Es gab die Anzeige schon – als ausgeklappten Abschnitt im Kontofenster,
   hinter einem zweiten Knopf. Wer nachsehen wollte, ob seine Hefte
   gesichert sind, musste also erst das Fenster zum ANMELDEN öffnen und
   dort weiterklicken. Gefunden hat es so gut wie niemand. Der Inhalt war
   nie das Problem, der Weg dorthin schon.

   ── Woher die Angaben kommen ────────────────────────────────────────
   Aus zwei Quellen, und beide führen ihre offenen Sachen getrennt:

     · core/cloudSync.js   Hefte hochladen, löschen (getPendingActions)
                           und das Protokoll (getSyncHistory)
     · core/trash.js       was am Papierkorb noch aussteht
                           (getPendingCloudActions)

   Der Papierkorb steht NICHT in der Warteschlange von CloudSync_ – er
   holt seine Cloud-Seite selbst nach (_catchUpCloudTrash). Ohne die
   zweite Quelle wäre ein ohne Netz zurückgeholtes Heft nirgends zu
   sehen.

   ── Was hier bewusst NICHT steht ────────────────────────────────────
   Geteilte Dokumente. Die schreiben in ihren Raum zurück, nicht in die
   eigene Cloud-Ablage, und führen ihren Stand in ui/sharedDocs.js. Sie
   hier mit aufzuzählen hieße, zwei verschiedene Dinge unter einer
   Überschrift zu vermischen.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const overlay = E('ov-sync');
  const btn = E('btn-sync');
  const badge = E('sync-badge');
  if (!overlay || !btn) return;

  const stateBox = E('sync-state');
  const pendingSection = E('sync-pending-section');
  const pendingList = E('sync-pending-list');
  const recentList = E('sync-recent-list');
  const recentEmpty = E('sync-recent-empty');
  const retryAllBtn = E('sync-retry-all-btn');
  const clearLogBtn = E('sync-clear-log-btn');

  /* ── Hilfsmittel ──────────────────────────────────────────────────── */

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Kurze Uhrzeit aus einem ISO-Zeitstempel. */
  function fmtTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const lang = typeof getLanguage === 'function' ? getLanguage() : 'de';
      return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  const istLoeschen = (action) => action === 'delete' || action === 'trash';

  /** Das Zeichen zur Art des Vorgangs. */
  function symbolFor(action) {
    if (action === 'restore') return '↩';
    if (istLoeschen(action)) return '🗑';
    return '📤';
  }

  /**
   * Was in der Zeile steht, solange der Vorgang noch aussteht.
   *
   * >>> Ohne den Namen <<<
   * Die Zeile traegt ihn schon als Ueberschrift. Die langen Fassungen
   * (syncQueuedItem und Geschwister) setzen ihn mit ein – die gehoeren
   * in die Toasts, wo es keine Ueberschrift gibt. Hier stuende er sonst
   * zweimal untereinander.
   */
  function wartetText(eintrag) {
    if (eintrag.action === 'restore') return t('syncWaitingRestore') || 'Zurückholen ausstehend';
    if (eintrag.action === 'trash') return t('syncWaitingTrash') || 'Verschieben in den Papierkorb ausstehend';
    if (eintrag.action === 'delete') return t('syncWaitingDelete') || 'Löschung ausstehend';
    return t('syncWaitingUpload') || 'wartet auf Upload';
  }

  /* ── Was steht aus? ───────────────────────────────────────────────── */

  /**
   * Die offenen Vorgänge aus BEIDEN Quellen, ohne Doppelte.
   *
   * >>> Warum Doppelte auftreten können <<<
   * Ein ohne Netz gelöschtes Heft meldet sich zweimal: Trash.moveToTrash
   * legt es in die Warteschlange von CloudSync_ UND behält den eigenen
   * Eintrag mit cloudTrashed = false. Beide meinen denselben Vorgang;
   * zweimal untereinander sähe nach doppelter Arbeit aus.
   *
   * Die Warteschlange gewinnt: sie trägt den Zeitpunkt, zu dem der
   * Vorgang eingereiht wurde, und lässt sich über „Alle jetzt hochladen"
   * anstoßen.
   */
  function offeneVorgaenge() {
    const aus = [];
    const gesehen = new Set();

    const nimm = (liste) => {
      for (const e of (liste || [])) {
        const key = String(e.nbId || '');
        if (!key || gesehen.has(key)) continue;
        gesehen.add(key);
        aus.push(e);
      }
    };

    if (window.CloudSync_ && typeof CloudSync_.getPendingActions === 'function') {
      nimm(CloudSync_.getPendingActions());
    }
    if (typeof Trash !== 'undefined' && Trash && typeof Trash.getPendingCloudActions === 'function') {
      nimm(Trash.getPendingCloudActions());
    }
    return aus;
  }

  /* ── Der Streifen oben ────────────────────────────────────────────── */

  /**
   * Ein Satz, der die Frage beantwortet, ohne dass man die Listen liest.
   *
   * Die Reihenfolge der Fälle ist nicht beliebig: „ohne Internet" sticht
   * alles, denn dann ändert sich von selbst nichts mehr. Danach kommt,
   * was gerade läuft, dann was wartet, und zuletzt der Normalfall.
   */
  function zeichneStreifen(offen) {
    if (!stateBox) return;

    const online = !window.CloudSync_ || CloudSync_.isOnline !== false;
    const laeuft = !!(window.CloudSync_ && CloudSync_.syncing);
    const n = offen.length;

    let klasse, zeichen, text;

    if (!online) {
      klasse = 'offline';
      zeichen = '⚠';
      text = n
        ? (t('syncStateOffline') || 'Ohne Internet — {n} Änderung(en) warten.').replace('{n}', n)
        : (t('syncStateOfflineIdle') || 'Ohne Internet. Alles Bisherige ist gesichert.');
    } else if (laeuft) {
      klasse = 'warten';
      zeichen = '⟳';
      text = t('syncStateWorking') || 'Wird hochgeladen …';
    } else if (n) {
      klasse = 'warten';
      zeichen = '⧗';
      text = (t('syncStateWaiting') || '{n} Änderung(en) warten').replace('{n}', n);
    } else {
      klasse = 'ok';
      zeichen = '✓';
      /* Wann zuletzt wirklich etwas abgeglichen wurde. Ohne diese Angabe
         steht dort nur „alles gesichert" – und das sagt nichts darüber,
         ob das vor einer Minute oder vor drei Tagen galt. */
      const zuletzt = (typeof Settings !== 'undefined' && Settings)
        ? fmtTime(Settings.get('cloudLastSync')) : '';
      text = zuletzt
        ? (t('syncStateAllDoneAt') || 'Alles gesichert · zuletzt {time}').replace('{time}', zuletzt)
        : (t('syncStateAllDone') || 'Alles gesichert');
    }

    stateBox.className = 'sync-state ' + klasse;
    stateBox.innerHTML = '<span class="sync-state-icon">' + zeichen + '</span>'
      + '<span>' + escHtml(text) + '</span>';
  }

  /* ── Die Listen ───────────────────────────────────────────────────── */

  function zeileWartet(eintrag) {
    const cls = eintrag.action === 'restore' ? 'restore'
      : istLoeschen(eintrag.action) ? 'delete' : 'upload';
    const zeit = fmtTime(eintrag.queuedAt);
    return '<div class="sync-item sync-item-status queued">'
      + '<div class="sync-item-icon ' + cls + '">' + symbolFor(eintrag.action) + '</div>'
      + '<div class="sync-item-body">'
      + '<div class="sync-item-name">' + escHtml(eintrag.nbName || eintrag.nbId) + '</div>'
      + '<div class="sync-item-detail">' + escHtml(wartetText(eintrag)) + '</div>'
      + '</div>'
      + (zeit ? '<div class="sync-item-time">' + zeit + '</div>' : '')
      + '</div>';
  }

  function zeileErledigt(h) {
    const geschafft = h.status === 'completed';
    const grund = geschafft
      ? (h.reason || t('syncActionUpload') || 'Fertig')
      : (h.reason || 'Fehler');
    const zeit = fmtTime(h.at);
    return '<div class="sync-item sync-item-status ' + (geschafft ? 'success' : 'failed') + '">'
      + '<div class="sync-item-icon ' + escHtml(h.action || 'upload') + '">'
      + (geschafft ? '✓' : '✗') + '</div>'
      + '<div class="sync-item-body">'
      + '<div class="sync-item-name">' + escHtml(h.nbName || h.nbId) + '</div>'
      + '<div class="sync-item-detail">' + escHtml(grund) + '</div>'
      + '</div>'
      + (zeit ? '<div class="sync-item-time">' + zeit + '</div>' : '')
      + '</div>';
  }

  /** Baut das Fenster neu auf. Tut nichts, solange es zu ist. */
  function render() {
    if (overlay.style.display === 'none') return;

    const offen = offeneVorgaenge();
    zeichneStreifen(offen);

    if (pendingSection && pendingList) {
      if (offen.length) {
        pendingSection.style.display = 'block';
        pendingList.innerHTML = offen.map(zeileWartet).join('');
      } else {
        pendingSection.style.display = 'none';
      }
    }

    /* „Alle jetzt hochladen" nur, wenn es auch gehen kann. Ohne Netz
       wäre der Knopf ein Versprechen, das er nicht halten kann – der
       Streifen sagt dann ohnehin, dass es von selbst nachgeholt wird. */
    if (retryAllBtn) {
      const geht = offen.length > 0 && window.CloudSync_ && CloudSync_.isOnline !== false;
      retryAllBtn.style.display = geht ? 'block' : 'none';
    }

    if (recentList && recentEmpty) {
      const verlauf = (window.CloudSync_ && typeof CloudSync_.getSyncHistory === 'function')
        ? CloudSync_.getSyncHistory() : [];
      const fertig = verlauf
        .filter(h => h.status === 'completed' || h.status === 'failed')
        .slice(0, 12);

      if (fertig.length) {
        recentEmpty.style.display = 'none';
        recentList.style.display = 'flex';
        recentList.innerHTML = fertig.map(zeileErledigt).join('');
      } else {
        recentList.style.display = 'none';
        recentEmpty.style.display = 'block';
      }
    }
  }

  /* ── Knopf und Zähler in der Titelleiste ──────────────────────────── */

  /**
   * Der Knopf gehört nur dorthin, wo er etwas zu sagen hat: bei
   * bestehender Anmeldung. Wer nicht angemeldet ist, hat keine Cloud –
   * ein Knopf, der dann „nichts ausstehend" meldet, wäre irreführend.
   */
  function refreshButton() {
    const angemeldet = !!(window.CloudSync_ && CloudSync_.isAuthenticated
      && CloudSync_.isAuthenticated());

    btn.style.display = angemeldet ? 'flex' : 'none';
    if (!angemeldet) {
      if (badge) badge.style.display = 'none';
      // Ein offenes Fenster gehört zu, wenn die Anmeldung wegfällt
      if (overlay.style.display !== 'none') overlay.style.display = 'none';
      return;
    }

    if (!badge) return;
    const n = offeneVorgaenge().length;
    if (n) {
      badge.style.display = 'inline';
      badge.textContent = n > 99 ? '99+' : String(n);
      // Ohne Netz ein anderer Ton: die Zahl liegt dann fest
      badge.classList.toggle('offline', CloudSync_.isOnline === false);
    } else {
      badge.style.display = 'none';
      badge.classList.remove('offline');
    }
  }

  /* ── Öffnen und Schließen ─────────────────────────────────────────── */

  function open() {
    overlay.style.display = 'flex';
    render();
    refreshButton();
  }

  function close() {
    overlay.style.display = 'none';
  }

  btn.addEventListener('click', open);
  E('sync-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  /* Der Weg über das Kontofenster bleibt bestehen – nur führt er jetzt
     hierher, statt einen zweiten Abschnitt aufzuklappen. */
  E('auth-sync-panel-btn')?.addEventListener('click', () => {
    const konto = E('ov-account');
    if (konto) konto.style.display = 'none';
    open();
  });

  /* ── Anschluss ───────────────────────────────────────────────────── */

  E('sync-retry-all-btn')?.addEventListener('click', async () => {
    if (!window.CloudSync_) return;
    await CloudSync_.flushPending();
    render();
    refreshButton();
  });

  E('sync-clear-log-btn')?.addEventListener('click', async () => {
    if (typeof showConfirm === 'function') {
      const ok = await showConfirm(t('syncClearLogConfirm') || 'Das Sync-Protokoll löschen?');
      if (!ok) return;
    }
    if (window.CloudSync_ && typeof CloudSync_.clearSyncLog === 'function') {
      await CloudSync_.clearSyncLog();
    }
    if (typeof toast === 'function') toast(t('syncLogCleared') || 'Sync-Protokoll gelöscht.');
    render();
  });

  /* CloudSync_ meldet jede Änderung: Warteschlange, Verbindung, Anmeldung.
     Damit läuft das Fenster von selbst mit, ohne eigenen Taktgeber. */
  if (window.CloudSync_ && typeof CloudSync_.onChange === 'function') {
    CloudSync_.onChange(() => { refreshButton(); render(); });
  }

  /* ── Warum es trotzdem einen Taktgeber braucht ────────────────────
     Der Papierkorb meldet sich NICHT über CloudSync_.onChange. Zwei
     seiner Zustände entstehen und vergehen ganz ohne die Warteschlange:
     ein ohne Netz zurückgeholtes Heft (restored) und ein endgültig
     gelöschtes, dessen Cloud-Datei noch aussteht (purged). Erledigt
     werden sie von _catchUpCloudTrash() im Hintergrund.

     Ohne diesen Blick bliebe der Zähler stehen, bis zufällig etwas
     anderes den Abgleich anstößt – er zeigte also eine Zahl, die längst
     nicht mehr stimmt. Das ist schlimmer als gar keine.

     Der Zähler wird IMMER aufgefrischt, nicht nur bei offenem Fenster:
     er ist der einzige Hinweis, solange man nicht hineinsieht. Neu
     gezeichnet wird dagegen nur, was auch jemand ansieht. Beides ist
     billig – zwei Listen abfragen, mehr passiert nicht. */
  setInterval(() => {
    refreshButton();
    if (overlay.style.display !== 'none') render();
  }, 5000);

  document.addEventListener('inkwell-identity-changed', refreshButton);
  window.addEventListener('language-changed', () => {
    if (overlay.style.display !== 'none') render();
  });

  refreshButton();

  // Für ui/auth.js und die Tastenkürzel
  window.openSyncPanel = open;
})();
