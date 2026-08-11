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
  if (!overlay || !btn) return;

  const huelle = E('tbar-sync');
  const mehrBtn = E('btn-sync-more');
  const svgZeichen = btn.querySelector('.sync-zeichen-cloud');
  const platteZeichen = E('sync-zeichen-platte');
  const stateBox = E('sync-state');
  const localBox = E('sync-local');
  const saveNowBtn = E('sync-save-now-btn');
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

  /* ── Die Zeichen ──────────────────────────────────────────────────
     Gezeichnet wie überall sonst in der App: 24er-Raster, keine Füllung,
     Strichstärke 2, Farbe über currentColor. Hier standen Emoji – die
     bringen ihre eigene Farbe und ihre eigene Anmutung mit und sahen
     neben dem übrigen Haus aus wie hereingeweht.
     ───────────────────────────────────────────────────────────────── */

  const SVG_AUF = '<path d="M4 20h16"/><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/>';
  const SVG_AB = '<path d="M4 20h16"/><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/>';
  const SVG_KORB = '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>';
  const SVG_HAKEN = '<path d="M20 6L9 17l-5-5"/>';
  const SVG_KREUZ = '<path d="M18 6L6 18M6 6l12 12"/>';

  function svg(pfade) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
      + ' stroke-linecap="round" stroke-linejoin="round">' + pfade + '</svg>';
  }

  /** Das Zeichen zur Art des Vorgangs. */
  function symbolFor(action) {
    if (action === 'restore') return svg(SVG_AB);
    if (istLoeschen(action)) return svg(SVG_KORB);
    return svg(SVG_AUF);
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

    /* >>> Warum hier eine Wartezeit stehen darf <<<
       Hochgeladen wird von selbst – zwei Sekunden nach der letzten
       Aenderung meldet AutoSave das Heft an, und die Warteschlange
       laeuft alle fuenf Sekunden. Gebremst wird nur die WIEDERHOLUNG
       desselben Hefts: hoechstens einmal je Minute, weil jedes Mal das
       ganze Heft ueber die Leitung geht (MIN_UPLOAD_INTERVAL_MS).

       Ohne diese Angabe sah das aus, als haenge es – und der Knopf
       darunter las sich wie eine Aufforderung. Steht die Zeit da, ist
       klar: es passiert von selbst, man muss nur nichts tun. */
    const grund = t('syncWaitingUpload') || 'wird automatisch hochgeladen';
    const rest = (window.CloudSync_ && typeof CloudSync_.getSecondsUntilNextUpload === 'function')
      ? CloudSync_.getSecondsUntilNextUpload(eintrag.nbId) : 0;

    // Auf fünf Sekunden gerundet: der Blick wird alle fünf aufgefrischt,
    // eine sekundengenaue Zahl stünde die meiste Zeit falsch da.
    if (rest > 5) {
      return grund + ' ' + (t('syncInSeconds') || '(in ~{s} s)')
        .replace('{s}', String(Math.round(rest / 5) * 5));
    }
    return grund;
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
      zeichen = svg('<path d="M12 9v4"/><path d="M12 17h.01"/>'
        + '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>');
      text = n
        ? (t('syncStateOffline') || 'Ohne Internet — {n} Änderung(en) warten.').replace('{n}', n)
        : (t('syncStateOfflineIdle') || 'Ohne Internet. Alles Bisherige ist gesichert.');
    } else if (laeuft) {
      klasse = 'warten';
      zeichen = svg('<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>'
        + '<path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>');
      text = t('syncStateWorking') || 'Wird hochgeladen …';
    } else if (n) {
      klasse = 'warten';
      zeichen = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
      text = (t('syncStateWaiting') || '{n} Änderung(en) warten').replace('{n}', n);
    } else {
      klasse = 'ok';
      zeichen = svg(SVG_HAKEN);
      /* Wann zuletzt wirklich etwas abgeglichen wurde. Ohne diese Angabe
         steht dort nur „alles gesichert" – und das sagt nichts darüber,
         ob das vor einer Minute oder vor drei Tagen galt. */
      const zuletzt = (typeof Settings !== 'undefined' && Settings)
        ? fmtTime(Settings.get('cloudLastSync')) : '';
      text = zuletzt
        ? (t('syncStateAllDoneAt') || 'Alles gesichert · zuletzt {time}').replace('{time}', zuletzt)
        : (t('syncStateAllDone') || 'Alles gesichert');
    }

    stateBox.className = 'sync-state ' + klasse + (laeuft && online ? ' laeuft' : '');
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
      + svg(geschafft ? SVG_HAKEN : SVG_KREUZ) + '</div>'
      + '<div class="sync-item-body">'
      + '<div class="sync-item-name">' + escHtml(h.nbName || h.nbId) + '</div>'
      + '<div class="sync-item-detail">' + escHtml(grund) + '</div>'
      + '</div>'
      + (zeit ? '<div class="sync-item-time">' + zeit + '</div>' : '')
      + '</div>';
  }

  /* ── Auf diesem Geraet ──────────────────────────────────────────────
     Die halbe Strecke vor der Cloud. Der Zustand kommt aus
     ui/saveStatus.js, damit ihn Knopf und Fenster aus derselben Quelle
     lesen und nicht auseinanderlaufen koennen. */
  function zeichneOertlich() {
    if (!localBox) return;
    const zustand = typeof window.saveState === 'function' ? window.saveState() : 'saved';
    const offenesHeft = typeof S !== 'undefined' && S && S.activeNbId;

    let klasse, zeichen, text;
    if (!offenesHeft) {
      klasse = 'ok';
      zeichen = svg(SVG_HAKEN);
      text = t('syncLocalNoDoc') || 'Kein Heft geöffnet.';
    } else if (zustand === 'unsaved') {
      klasse = 'warten';
      zeichen = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
      text = t('syncLocalPending') || 'Wird gleich gespeichert …';
    } else {
      klasse = 'ok';
      zeichen = svg(SVG_HAKEN);
      text = t('syncLocalDone') || 'Auf diesem Gerät gespeichert.';
    }

    localBox.className = 'sync-state ' + klasse;
    localBox.innerHTML = '<span class="sync-state-icon">' + zeichen + '</span>'
      + '<span>' + escHtml(text) + '</span>';

    /* Der Knopf ist die Abkuerzung fuer Ungeduldige, so wie „Alle jetzt
       hochladen" darunter. Er erscheint nur, wenn es wirklich etwas zu
       tun gibt – sonst waere er eine Aufforderung ohne Anlass. */
    if (saveNowBtn) saveNowBtn.style.display = (offenesHeft && zustand === 'unsaved') ? 'block' : 'none';
  }

  /** Baut das Fenster neu auf. Tut nichts, solange es zu ist. */
  function render() {
    if (overlay.style.display === 'none') return;

    zeichneOertlich();
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
   * Der eine Knopf für „ist meine Arbeit sicher?".
   *
   * >>> Warum er jetzt IMMER da ist <<<
   * Er erschien nur bei bestehender Anmeldung – die Begründung war, ein
   * Knopf ohne Cloud könne nichts melden. Das stimmte nicht: ohne Cloud
   * gibt es sehr wohl etwas zu melden, nämlich ob die Arbeit auf der
   * Platte liegt. Diese Auskunft stand in einem ZWEITEN Knopf in der
   * Werkzeugleiste, und zwei Anzeigen für dieselbe Frage widersprachen
   * sich regelmäßig, weil jede nur ihre halbe Strecke kannte. Es gibt
   * jetzt eine, und die kennt beide Hälften (ui/saveStatus.js).
   *
   * >>> Die Reihenfolge der Fälle <<<
   * Noch nicht auf der Platte sticht alles: das ist die Hälfte, die
   * einem Absturz zum Opfer fällt. Danach kommt, was gerade hochgeht,
   * dann was auf die Cloud wartet, und zuletzt der Normalfall.
   *
   * Der Zustand steckt in der FARBE, nicht in einer Zahl daneben. Grün
   * heißt gesichert, blau heißt „da ist noch etwas" – und weil es von
   * selbst weitergeht, ist das eine Auskunft und keine Aufforderung.
   */
  function refreshButton() {
    const angemeldet = !!(window.CloudSync_ && CloudSync_.isAuthenticated
      && CloudSync_.isAuthenticated());

    if (huelle) huelle.style.display = 'flex';
    /* Die Zustandsklasse traegt die HUELLE, damit sich beide Haelften
       faerben – der Knopf und der Pfeil (css/titlebar.css). */
    const traeger = huelle || btn;
    traeger.classList.remove('ist-gesichert', 'ist-offen', 'laeuft', 'nicht-gespeichert');

    const zustand = typeof window.saveState === 'function' ? window.saveState() : 'saved';
    const offen = angemeldet ? offeneVorgaenge().length : 0;

    /* ── Welches Zeichen ──────────────────────────────────────────────
       Angemeldet die Kreispfeile, sonst der Haken bzw. der Punkt vom
       alten Speicher-Knopf. Ohne Anmeldung gibt es nichts abzugleichen –
       ein Zeichen dafuer waere ein Versprechen, das keiner einloest. */
    if (svgZeichen) svgZeichen.style.display = angemeldet ? '' : 'none';
    if (platteZeichen) {
      platteZeichen.style.display = angemeldet ? 'none' : '';
      platteZeichen.textContent = zustand === 'saved' ? '✓' : '●';
    }

    /* Auch die Beschriftung: ohne Anmeldung wird nur gespeichert. */
    btn.title = angemeldet
      ? (t('syncSaveAndUpload') || 'Speichern und synchronisieren')
      : (t('saveNow') || 'Speichern');

    /* ── Welche Farbe ─────────────────────────────────────────────────
       Die Reihenfolge ist nicht beliebig: noch nicht auf der Platte
       sticht alles, das ist die Haelfte, die ein Absturz kostet. */
    if (zustand === 'unsaved') {
      traeger.classList.add('nicht-gespeichert');
      return;
    }

    if (angemeldet && window.CloudSync_ && CloudSync_.syncing) {
      traeger.classList.add('laeuft');
      return;
    }

    /* Ohne Netz bleibt es blau: „nicht alles ist oben" stimmt dann ja
       genauso. Warum es wartet, sagt der Streifen im Fenster – dafür ist
       am Knopf kein Platz, und zwei Blautöne wären keine Auskunft,
       sondern ein Rätsel. */
    traeger.classList.add(offen ? 'ist-offen' : 'ist-gesichert');

    /* Der Pfeil sagt, was im Fenster steht – die Zahl gehoert an ihn und
       nicht an die Haelfte, die speichert. */
    if (mehrBtn) {
      mehrBtn.title = offen
        ? (t('syncStateWaiting') || '{n} Änderung(en) warten').replace('{n}', offen)
        : (t('syncWindowOpen') || 'Synchronisation');
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

  /* ══════════════════════════════════════════════════════════════════
     DER DRUCK AUF DEN KNOPF TUT ETWAS

     Vorher oeffnete er nur das Fenster. Wer auf einen Knopf drueckt, an
     dem „nicht gespeichert" steht, will aber speichern – und nicht
     lesen, dass etwas aussteht. Also: erst auf die Platte, dann, wenn
     angemeldet, die Warteschlange leeren.

     Beides ohne Anmeldung sinnvoll: dann ist die Platte das Ziel und
     nicht die halbe Strecke.

     Das Fenster oeffnet der Pfeil daneben.
     ══════════════════════════════════════════════════════════════════ */
  let laeuftGerade = false;

  async function speichernUndAbgleichen() {
    if (laeuftGerade) return;          // Doppelklick soll nicht zweimal laufen
    laeuftGerade = true;
    (huelle || btn).classList.add('laeuft');
    try {
      /* Auch wenn nichts ausstehend erscheint: syncAll() im Speichern
         holt den Stand aus dem Editor ins Datenmodell, und erst danach
         weiss ueberhaupt jemand, ob es etwas gab. */
      if (typeof window.saveNowWithFeedback === 'function') {
        await window.saveNowWithFeedback();
      }

      const angemeldet = !!(window.CloudSync_ && CloudSync_.isAuthenticated
        && CloudSync_.isAuthenticated());
      if (angemeldet && typeof CloudSync_.flushPending === 'function') {
        await CloudSync_.flushPending();
      }
    } catch (err) {
      console.error('[Sync] Speichern und Abgleichen fehlgeschlagen:', err);
    } finally {
      laeuftGerade = false;
      refreshButton();
      render();
    }
  }

  btn.addEventListener('click', speichernUndAbgleichen);
  mehrBtn?.addEventListener('click', () => {
    if (overlay.style.display !== 'none') { close(); return; }
    open();
  });
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

  /* Von Hand speichern – der Rest des alten Speicher-Knopfs. Gebraucht
     wird er selten (nach zwei Sekunden geschieht es ohnehin), aber wer
     gleich den Rechner zuklappt, will nicht zaehlen muessen. */
  saveNowBtn?.addEventListener('click', async () => {
    if (typeof window.saveNowWithFeedback === 'function') await window.saveNowWithFeedback();
    render();
    refreshButton();
  });

  /* Der oertliche Stand aendert sich bei jedem Anschlag – ohne diesen
     Hoerer bliebe der Knopf orange stehen, bis zufaellig die Cloud etwas
     meldet. */
  if (typeof AutoSave !== 'undefined' && AutoSave && typeof AutoSave.onChange === 'function') {
    AutoSave.onChange(() => { refreshButton(); render(); });
  }

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
  /* Der Sprachwechsel setzt die Beschriftungen aus data-i18n-title neu –
     und ueberschreibt damit die, die refreshButton je nach Zustand
     gesetzt hat. Deshalb hier noch einmal hinterher. */
  window.addEventListener('language-changed', () => {
    refreshButton();
    if (overlay.style.display !== 'none') render();
  });

  refreshButton();

  // Für ui/auth.js und die Tastenkürzel
  window.openSyncPanel = open;

  /* Der Name kommt aus der Zeit des Speicher-Knopfs; core/integration.js
     und ui/sharedDocs.js rufen ihn nach jeder Aenderung. Er zeigt jetzt
     hierher – der Knopf hat die Auskunft uebernommen. */
  window.updateSaveStatus = function () { refreshButton(); render(); };
})();
