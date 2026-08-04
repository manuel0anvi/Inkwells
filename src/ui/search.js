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

    /* Nur die eigenen Hefte. Ein geteiltes Dokument liegt zwar mit in
       S.notebooks, gehört aber nicht hierher: der Treffer würde es über
       openNotebook aufmachen, und zwar ohne den Nur-Lese-Zustand, den
       ui/sharedDocs.js dafür setzt. */
    const notebooks = typeof ownNotebooks === 'function' ? ownNotebooks() : S.notebooks;

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

    return { query, hits };
  }

  function render(result) {
    if (!result) {
      results.style.display = 'none';
      grid.style.display = '';
      results.innerHTML = '';
      return;
    }

    grid.style.display = 'none';
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
      dot.style.background = hit.nb.color || 'var(--gold)';
      row.appendChild(dot);

      const body = document.createElement('span');
      body.className = 'search-hit-body';

      const title = document.createElement('span');
      title.className = 'search-hit-title';

      if (hit.kind === 'page') {
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

      row.appendChild(body);
      row.addEventListener('click', () => openHit(hit));
      results.appendChild(row);
    }
  }

  function openHit(hit) {
    reset();

    if (hit.kind === 'notebook') {
      openNotebook(hit.nb.id);
      return;
    }

    // Heft öffnen, dann zum richtigen Abschnitt und zur Seite springen
    openNotebook(hit.nb.id);

    const sec = hit.sec || (hit.nb.sections || [])[0];
    if (!sec) return;

    setTimeout(() => {
      try {
        openSection(sec, hit.page ? hit.page.id : null);
        if (hit.page) {
          setTimeout(() => {
            const el = document.querySelector(`[data-pgid="${hit.page.id}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 120);
        }
      } catch (err) {
        console.error('[Search] Sprung zum Treffer fehlgeschlagen:', err);
      }
    }, 60);
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
