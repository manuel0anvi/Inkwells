'use strict';

/* ══════════════════════════════════════════════════════════════════════
   VOLLTEXTSUCHE ÜBER ALLE HEFTE
   Sucht in Heftnamen, Abschnittsnamen und im Text aller Seiten.
   Ein Treffer führt direkt zur betreffenden Seite.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const input = E('home-search-input');
  const clearBtn = E('home-search-clear');
  const grid = E('nb-grid');
  const results = E('search-results');

  if (!input || !results) return;

  const MAX_RESULTS = 60;
  let debounceTimer = null;

  /* ── Was unter der Trefferliste liegt ──────────────────────────────
     Die Startseite hat zwei Reiter, und die Suche gilt für beide. Die
     Trefferliste deckt den Bereich darunter zu und muss hinterher den
     RICHTIGEN wieder aufdecken – vorher wurde blind `nb-grid` gezeigt,
     und wer auf den geteilten Dokumenten stand, landete nach dem Leeren
     des Feldes bei seinen eigenen Heften. */
  function zeigeGrund(sichtbar) {
    const reiter = (typeof window.homeActiveTab === 'function')
      ? window.homeActiveTab() : 'own';
    const panel = E('shared-panel');

    if (!sichtbar) {
      if (grid) grid.style.display = 'none';
      if (panel) panel.style.display = 'none';
      return;
    }
    if (grid) grid.style.display = reiter === 'own' ? '' : 'none';
    if (panel) panel.style.display = reiter === 'shared' ? '' : 'none';
  }

  function plainTextOf(page) {
    return (page.textContent || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|h[1-6]|li)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Textausschnitt um den Treffer herum, damit man ihn im Zusammenhang sieht
  function makeSnippet(text, query) {
    const idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return text.slice(0, 120);

    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + 60);
    return (start > 0 ? '… ' : '') + text.slice(start, end) + (end < text.length ? ' …' : '');
  }

  function highlight(snippet, query) {
    const lower = snippet.toLowerCase();
    const idx = lower.indexOf(query);
    if (idx === -1) return escapeText(snippet);

    return escapeText(snippet.slice(0, idx))
      + '<mark>' + escapeText(snippet.slice(idx, idx + query.length)) + '</mark>'
      + escapeText(snippet.slice(idx + query.length));
  }

  function escapeText(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  function search(rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    if (query.length < 2) return null;

    const hits = [];

    /* ── Auch die geteilten Dokumente ──────────────────────────────
       Sie waren hier ausgeschlossen, und zwar aus einem guten Grund: der
       Treffer hätte sie über openNotebook aufgemacht – ohne den
       Nur-Lese-Zustand, ohne Live-Raum, ohne Aufsicht auf den Kopf. Man
       hätte in einem fremden Heft geschrieben, und nichts davon wäre
       angekommen.

       Der Grund ist weg: openHit() nimmt für sie jetzt den richtigen Weg
       (openSharedDocumentById in ui/sharedDocs.js). Und der Ausschluss
       war teuer – man sucht etwas, es ist da, und es wird nicht
       gefunden.

       Gesucht wird in dem, was schon HIER liegt: ein geteiltes Dokument
       steht erst dann in S.notebooks, wenn es einmal geöffnet wurde. Die
       ungeöffneten mitzusuchen hieße, bei jeder Eingabe jedes fremde
       Heft herunterzuladen. */
    const eigene = typeof ownNotebooks === 'function' ? ownNotebooks() : S.notebooks;
    const geteilte = typeof sharedNotebooks === 'function' ? sharedNotebooks() : [];
    const notebooks = eigene.concat(geteilte);

    for (const nb of notebooks) {
      if (nb.name && nb.name.toLowerCase().includes(query)) {
        hits.push({ kind: 'notebook', nb, label: nb.name });
      }

      const sections = Array.isArray(nb.sections) ? nb.sections : [];

      for (const sec of sections) {
        if (sec.name && sec.name.toLowerCase().includes(query)) {
          hits.push({ kind: 'section', nb, sec, label: sec.name });
        }
      }

      for (const page of (nb.pages || [])) {
        const text = plainTextOf(page);
        if (!text || !text.toLowerCase().includes(query)) continue;

        const sec = findSecForPage(page.id, nb);
        // Die Seitenzahl des HEFTS – dieselbe, die ueber der Seite steht
        const pageNo = pageNumberOf(nb, page.id);

        hits.push({
          kind: 'page',
          nb, sec, page, pageNo,
          snippet: makeSnippet(text, query)
        });

        if (hits.length >= MAX_RESULTS) break;
      }

      if (hits.length >= MAX_RESULTS) break;
    }

    /* ── Geteilte Dokumente, die noch nie offen waren ──────────────
       Von ihnen liegt hier nur der Kopf: Titel und Besitzer. Nach dem
       NAMEN lassen sie sich damit trotzdem finden, und das ist der
       häufigere Fall – man sucht „Physik", weil man weiß, dass es das
       gibt. Im Text eines ungeöffneten kann nicht gesucht werden; dafür
       müsste bei jedem Tastendruck jedes fremde Heft geladen werden.

       Schon geöffnete stehen weiter oben mit ihrem vollen Inhalt und
       werden hier übersprungen – sonst stünde jedes zweimal da. */
    const heads = typeof window.sharedDocHeads === 'function' ? window.sharedDocHeads() : [];
    const schonOffen = new Set(geteilte.map(nb => String(nb.id)));

    for (const head of heads) {
      if (hits.length >= MAX_RESULTS) break;
      if (!head || !head.docId) continue;
      if (schonOffen.has('shared:' + head.docId)) continue;

      const titel = String(head.title || '');
      const wer = String(head.ownerName || head.ownerEmail || '');
      if (!titel.toLowerCase().includes(query) && !wer.toLowerCase().includes(query)) continue;

      hits.push({ kind: 'sharedDoc', head, label: titel || '?', sharedBy: wer });
    }

    return { query, hits };
  }

  function render(result) {
    if (!result) {
      results.style.display = 'none';
      zeigeGrund(true);
      results.innerHTML = '';
      return;
    }

    zeigeGrund(false);
    results.style.display = 'block';
    results.innerHTML = '';

    if (!result.hits.length) {
      const empty = document.createElement('p');
      empty.className = 'search-empty';
      empty.textContent = (t('searchNoResults') || 'Nichts gefunden für „{q}“.').replace('{q}', result.query);
      results.appendChild(empty);
      return;
    }

    const head = document.createElement('div');
    head.className = 'search-count';
    head.textContent = result.hits.length >= MAX_RESULTS
      ? (t('searchManyResults') || 'Über {n} Treffer').replace('{n}', MAX_RESULTS)
      : (t('searchResults') || '{n} Treffer').replace('{n}', result.hits.length);
    results.appendChild(head);

    for (const hit of result.hits) {
      const row = document.createElement('button');
      row.className = 'search-hit';

      const dot = document.createElement('span');
      dot.className = 'search-hit-dot';
      /* Ein noch nie geöffnetes geteiltes Dokument hat kein Heft und
         damit auch keine Farbe – hit.nb ist dort undefined. */
      dot.style.background = (hit.nb && hit.nb.color) || 'var(--gold)';
      row.appendChild(dot);

      const body = document.createElement('span');
      body.className = 'search-hit-body';

      const title = document.createElement('span');
      title.className = 'search-hit-title';

      /* Woher der Treffer kommt. Ohne den Hinweis saehen ein eigenes und
         ein geteiltes Heft gleich aus – und beim geteilten geht nach dem
         Anklicken der Nur-Lese-Zustand an, was ohne Vorwarnung wie ein
         Fehler wirkt. */
      const geteilt = hit.kind === 'sharedDoc'
        || (typeof isSharedNotebook === 'function' && isSharedNotebook(hit.nb));
      const wer = hit.kind === 'sharedDoc' ? hit.sharedBy : (hit.nb && hit.nb.sharedBy);

      if (hit.kind === 'sharedDoc') {
        /* Nur der Kopf ist bekannt. Statt eines Textausschnitts steht
           deshalb da, warum keiner da ist – sonst sähe die Zeile aus wie
           ein Treffer, dem der Inhalt fehlt. */
        title.textContent = hit.label;
        const hinweis = document.createElement('span');
        hinweis.className = 'search-hit-snippet';
        hinweis.textContent = t('searchSharedNotOpen')
          || 'Zum Durchsuchen des Inhalts einmal öffnen.';
        body.append(title, hinweis);
      } else if (hit.kind === 'page') {
        title.textContent = `${hit.nb.name} · ${hit.sec ? hit.sec.name + ' · ' : ''}${t('page') || 'Seite'} ${hit.pageNo}`;
        const snip = document.createElement('span');
        snip.className = 'search-hit-snippet';
        snip.innerHTML = highlight(hit.snippet, result.query);
        body.append(title, snip);
      } else {
        title.textContent = hit.label;
        const kind = document.createElement('span');
        kind.className = 'search-hit-snippet';
        kind.textContent = hit.kind === 'notebook'
          ? (t('searchKindNotebook') || 'Heft')
          : `${t('searchKindSection') || 'Abschnitt'} · ${hit.nb.name}`;
        body.append(title, kind);
      }

      /* ── Von wem das Heft ist ─────────────────────────────────────
         Hier stand nur „geteilt" als kleine Marke am rechten Rand. Das
         beantwortet die falsche Frage: DASS es geteilt ist, sieht man
         nach dem Anklicken ohnehin – wissen will man, VON WEM. Bei drei
         Heften namens „Physik" ist der Name des Besitzers das Einzige,
         woran man sie auseinanderhält.

         Deshalb steht es jetzt als eigene Zeile im Treffer und nicht
         mehr als Etikett daneben. Fehlt der Name (ein Dokument aus einer
         älteren Fassung, das noch keinen mitbekommen hat), bleibt es bei
         der schlichten Auskunft. */
      if (geteilt) {
        const von = document.createElement('span');
        von.className = 'search-hit-shared';
        von.textContent = wer
          ? (t('searchSharedBy') || 'geteiltes Heft von: {name}').replace('{name}', wer)
          : (t('searchFromShared') || 'geteiltes Heft');
        body.appendChild(von);
      }

      row.appendChild(body);

      row.addEventListener('click', () => openHit(hit));
      results.appendChild(row);
    }
  }

  /* ── Zum Treffer springen ────────────────────────────────────────
     >>> Was hier nicht stimmte <<<
     Es lief ueber `hit.sec || nb.sections[0]` und stieg bei `!sec` ganz
     aus. Eine Seite ohne Etikett wurde damit NIE angesprungen – man
     landete bloss irgendwo im Heft. Und eine Seite mit Etikett landete
     notfalls im ERSTEN Abschnitt, in dem sie gar nicht steht.

     Jetzt bekommt openNotebook das Ziel gleich mit und waehlt selbst den
     Ausschnitt, in dem die Seite zu sehen ist. Das spart auch die beiden
     Zeitgeber: gezeichnet wird einmal, nicht dreimal. */
  function openHit(hit) {
    reset();

    /* Ein geteiltes Dokument geht seinen eigenen Weg: es braucht den
       Nur-Lese-Zustand und den Live-Raum, und beides haengt an
       openSharedDocument. Die Seite wird dabei NICHT angesprungen – das
       Dokument wird erst geladen, und wo die Seite dann sitzt, weiss
       ui/sharedDocs.js besser als wir. */
    const istGeteilt = hit.kind === 'sharedDoc'
      || (typeof isSharedNotebook === 'function' && isSharedNotebook(hit.nb));

    if (istGeteilt) {
      const docId = hit.kind === 'sharedDoc'
        ? String(hit.head.docId)
        : String(hit.nb.id).replace(/^shared:/, '');
      if (typeof window.openSharedDocumentById === 'function') {
        window.openSharedDocumentById(docId);
      }
      return;
    }

    if (hit.kind === 'notebook') { openNotebook(hit.nb.id); return; }

    if (hit.kind === 'section') {
      openNotebook(hit.nb.id);
      const nb = getNb(hit.nb.id) || hit.nb;
      const sec = (nb.sections || []).find(s => String(s.id) === String(hit.sec.id));
      if (sec) openSection(sec);
      return;
    }

    openNotebook(hit.nb.id, { pageId: hit.page.id });
  }

  function reset() {
    input.value = '';
    clearBtn.style.display = 'none';
    render(null);
  }

  input.addEventListener('input', () => {
    clearBtn.style.display = input.value ? 'block' : 'none';
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => render(search(input.value)), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      reset();
      input.blur();
    }
    if (e.key === 'Enter') {
      const first = results.querySelector('.search-hit');
      if (first) first.click();
    }
  });

  clearBtn.addEventListener('click', () => { reset(); input.focus(); });

  // Der Sprung ins Suchfeld läuft über das änderbare Kürzel
  // (core/shortcuts.js, Aktion "search"), Standard: Strg+F.

  // Nach Änderungen an der Heftliste die Trefferliste nicht stehen lassen
  window.resetHomeSearch = reset;
})();
