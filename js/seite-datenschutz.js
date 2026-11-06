(function () {
  const el = (tag, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };

  function renderSummary(data) {
    const box = document.getElementById('privacy-summary');
    box.innerHTML = '';

    const title = el('h2');
    title.textContent = data.summaryTitle;
    box.appendChild(title);

    const list = el('dl', 'privacy-summary-list');
    for (const [term, desc] of data.summary) {
      const dt = el('dt');
      dt.textContent = term;
      const dd = el('dd');
      dd.textContent = desc;
      list.append(dt, dd);
    }
    box.appendChild(list);
  }

  function renderSections(data) {
    const box = document.getElementById('privacy-content');
    box.innerHTML = '';

    /* Ein Abschnitt ohne jeden Inhalt wird uebersprungen.

       Im Verwaltungsbereich lassen sich Abschnitte anlegen (admin/), und
       ein neuer ist zunaechst leer – in allen drei Sprachen, denn er
       entsteht ueberall zugleich. Wer ihn auf Deutsch ausfuellt und
       speichert, haette sonst auf der englischen Seite eine leere
       Ueberschrift stehen. Hier faellt sie einfach weg, bis dort etwas
       drinsteht. */
    const hatInhalt = (s) => !!(
      (s.h && s.h.trim())
      || (s.p && s.p.length) || (s.p2 && s.p2.length)
      || (s.ul && s.ul.length) || s.table
      || (s.note && s.note.trim()) || (s.links && s.links.length)
    );

    for (const section of data.sections) {
      if (!hatInhalt(section)) continue;
      const wrap = el('section', 'privacy-section');

      const h = el('h2');
      h.textContent = section.h;
      wrap.appendChild(h);

      const addParagraphs = (list) => {
        for (const text of (list || [])) {
          const p = el('p');
          p.textContent = text;
          wrap.appendChild(p);
        }
      };

      addParagraphs(section.p);

      if (section.ul) {
        const ul = el('ul');
        for (const item of section.ul) {
          const li = el('li');
          // Nur <strong> aus dem eigenen Text – kein Fremdinhalt
          li.innerHTML = item;
          ul.appendChild(li);
        }
        wrap.appendChild(ul);
      }

      addParagraphs(section.p2);

      if (section.table) {
        const scroll = el('div', 'privacy-table-scroll');
        const table = el('table', 'privacy-table');

        const thead = el('thead');
        const headRow = el('tr');
        for (const head of section.table.head) {
          const th = el('th');
          th.textContent = head;
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = el('tbody');
        for (const row of section.table.rows) {
          const tr = el('tr');
          for (const cell of row) {
            const td = el('td');
            td.textContent = cell;
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        scroll.appendChild(table);
        wrap.appendChild(scroll);
      }

      if (section.links) {
        const list = el('ul', 'privacy-links');
        for (const link of section.links) {
          const li = el('li');
          const a = el('a');
          a.href = link.href;
          a.textContent = link.label;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          li.appendChild(a);
          list.appendChild(li);
        }
        wrap.appendChild(list);
      }

      if (section.note) {
        const note = el('p', 'privacy-note');
        note.textContent = section.note;
        wrap.appendChild(note);
      }

      box.appendChild(wrap);
    }
  }

  /* Der Text steht fest in js/privacy-content.js. Wurde die Erklärung über
     die Adminseite bearbeitet, liegt eine neuere Fassung in Firestore und
     hat Vorrang. Die feste Fassung bleibt der Rückfall: Ist die Datenbank
     nicht erreichbar, ist die Seite trotzdem vollständig lesbar – bei einer
     Datenschutzerklärung ist eine leere Seite keine Option. */
  let activeContent = PRIVACY;
  let activeUpdated = PRIVACY_UPDATED;

  function renderPrivacy() {
    const data = activeContent[lang] || activeContent.de || PRIVACY.de;

    document.getElementById('privacy-title').textContent = data.title;
    document.getElementById('privacy-subtitle').textContent = data.subtitle;

    const locale = lang === 'de' ? 'de-AT' : lang === 'it' ? 'it-IT' : 'en-GB';
    const updated = new Date(activeUpdated);
    document.getElementById('privacy-updated').textContent = Number.isNaN(updated.getTime())
      ? data.updatedLabel
      : `${data.updatedLabel}: ${updated.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })}`;

    document.documentElement.lang = lang;

    renderSummary(data);
    renderSections(data);
  }

  renderPrivacy();
  if (typeof addLangChangeListener === 'function') addLangChangeListener(renderPrivacy);

  // Nachladen und, falls es eine bearbeitete Fassung gibt, neu zeichnen.
  (async () => {
    try {
      const api = await whenAdminApiReady();
      const stored = await api.loadPrivacy();
      if (!stored || !stored.content) return;

      activeContent = stored.content;
      activeUpdated = stored.updated || PRIVACY_UPDATED;
      renderPrivacy();
    } catch (err) {
      // Bewusst nur eine Notiz in der Konsole: der Rückfalltext steht schon.
      console.warn('[Datenschutz] Bearbeitete Fassung nicht ladbar:', err.message);
    }
  })();
})();
