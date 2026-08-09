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

/* ══════════════════════════════════════════════════════════════════════
   DIE NAVIGATION

   Oben die Ausschnitte: „Alle Seiten" und darunter die Abschnitte mit
   Farbpunkt und Anzahl. Ein Klick schaltet um, ein zweiter auf denselben
   zurück auf alles. Darunter die Überschriften der gerade gezeigten
   Seiten.

   Früher war das eine Liste von Kapiteln, zwischen denen man wechselte –
   und man sah immer nur eines. Jetzt ist es ein Filter über ein
   durchgehendes Heft.
   ══════════════════════════════════════════════════════════════════════ */

/* Die Ueberschriften einer Seite, die gerade NICHT aufgebaut ist.

   >>> Warum <template> und nicht ein loses <div> <<<
   Hier stand `document.createElement('div')` samt innerHTML. Ein loses
   div ist zwar nicht im Dokument, aber trotzdem lebendig: der Browser
   laedt darin Bilder und feuert onerror. Bei einem fremden Heft genuegte
   also das blosse Zeichnen des Baums, um dessen Code auszufuehren.

   Der Inhalt eines <template> ist inert – dort passiert nichts. Die
   Bereinigung kommt zusaetzlich dazu, damit hier dieselbe Regel gilt wie
   ueberall sonst (core/sanitize.js). */
function hdgsAusText(html) {
  const halter = document.createElement('template');
  halter.innerHTML = (typeof sanitizePageHtml === 'function')
    ? sanitizePageHtml(html)
    : '';
  return halter.content;
}

function renderSideTree() {
  const nb = getNb(); const tree = E('side-tree'); tree.innerHTML = ''; if (!nb) return;
  getSections(nb);

  /* Wird gerade gesucht, stehen hier die Treffer statt der Ueberschriften.
     Der Umweg ueber renderSideTree ist Absicht: die Funktion wird aus
     neun Dateien gerufen, und die Trefferliste soll dabei nicht
     verschwinden. */
  if (_nbSearchQuery) { renderNbSearchResults(nb, tree); return; }

  const gesamt = notebookPages(nb).length;

  /* ─ „Alle Seiten" ─ */
  const alle = document.createElement('div');
  alle.className = 'sec-hdr filter-row' + (!nb.activeSecId ? ' active' : '');
  // Die Verwaltung sitzt oben im Kopf neben „+ Abschnitt" – hier stand
  // sie auf der Zeile „Alle Seiten" und sah aus, als betreffe sie nur die
  alle.innerHTML = '<span class="sec-dot all"></span>'
    + '<span class="sec-name">' + t('allPages') + '</span>'
    + '<span class="sec-pg-count">' + gesamt + '</span>';
  alle.addEventListener('click', () => { if (nb.activeSecId) openSection(null); });
  tree.appendChild(alle);

  /* ─ Je Abschnitt eine Zeile ─ */
  for (const sec of nb.sections) {
    const isActiveSec = nb.activeSecId === sec.id;
    const anzahl = pagesOfSec(sec, nb).length;
    const row = document.createElement('div');
    row.className = 'sec-hdr filter-row' + (isActiveSec ? ' active' : '');
    row.innerHTML = '<span class="sec-dot"></span>'
      + '<span class="sec-name">' + getSectionDisplayName(sec) + '</span>'
      + '<span class="sec-pg-count">' + anzahl + '</span>';
    row.querySelector('.sec-dot').style.background = colorForSection(sec);
    row.querySelector('.sec-name').addEventListener('dblclick', e => {
      e.stopPropagation();
      txtModal(t('rename'), sec.name).then(n => {
        if (!n) return;
        sec.name = n; renderSideTree();
        if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
      });
    });
    // Noch einmal auf den gezeigten Ausschnitt: zurück auf alle Seiten
    row.addEventListener('click', () => openSection(isActiveSec ? null : sec));
    tree.appendChild(row);
  }

  /* ─ Überschriften der gezeigten Seiten ─ */
  {
    const pages = visiblePages(nb);
    const sec = activeSection(nb);
    const isActiveSec = true;

    const body = document.createElement('div');
    body.className = 'sec-body';

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

      /* Überschriften aller gezeigten Seiten.

         >>> Zwei Fehler, die hier steckten <<<
         1. h1Key und subWrap standen AUSSERHALB der Schleife. Alle
            Zuhörer teilten sich damit dieselbe Veränderliche – ab der
            zweiten h1 klappte jeder Pfeil die zuletzt erzeugte Gruppe zu
            und schrieb in den zuletzt gesetzten Schlüssel. Jetzt je
            Durchgang eine eigene Bindung.
         2. Der Schlüssel war der Seitenindex INNERHALB des Abschnitts
            plus Überschriftentext – über Abschnitte hinweg kollidierte
            das. Im Modus "alle Seiten" wäre es sofort aufgefallen.
            Jetzt die Seitenkennung, die ist eindeutig. */
      let subWrap = null;
      for (const pg of pages) {
        const pgNo = pageNumberOf(nb, pg.id);
        const livePgEl = E('pg-scroll').querySelector('[data-pgid="' + pg.id + '"]');
        let hdgs = livePgEl ? [...livePgEl.querySelectorAll('.j-text h1,.j-text h2,.j-text h3,.j-text p.j-title-1,.j-text p.j-title-2,.j-text p.j-title-3')]
          : ([...hdgsAusText(pg.textContent).querySelectorAll('h1,h2,h3,p.j-title-1,p.j-title-2,p.j-title-3')]);
        if (!hdgs.length) continue;
        hdgs.forEach(h => {
          const lvl = h.classList?.contains('j-title-1') ? 'h1' : h.classList?.contains('j-title-2') ? 'h2' : h.classList?.contains('j-title-3') ? 'h3' : h.tagName.toLowerCase();
          if (lvl === 'h1') {
            const h1Key = pg.id + '_' + h.textContent;
            const isColH1 = _navCollapsed.has(h1Key);
            const isActiveH1 = _activeHdgText && h.textContent === _activeHdgText;
            const row = document.createElement('li'); row.className = 'nav-item' + (isActiveH1 ? ' nav-active' : ''); row.dataset.level = 'h1';
            row.innerHTML = '<span class="nav-collapse-arrow">' + (isColH1 ? '▶' : '▼') + '</span><span class="nav-item-text"></span><span class="nav-pg-badge">S.' + pgNo + '</span>';
            row.querySelector('.nav-item-text').textContent = h.textContent;
            const arr = row.querySelector('.nav-collapse-arrow');
            const meinSubWrap = document.createElement('ul');
            meinSubWrap.style.cssText = 'list-style:none;padding:0;margin:0;display:' + (isColH1 ? 'none' : 'block');
            arr.addEventListener('click', ev => {
              ev.stopPropagation();
              if (_navCollapsed.has(h1Key)) _navCollapsed.delete(h1Key); else _navCollapsed.add(h1Key);
              const zu = _navCollapsed.has(h1Key);
              arr.textContent = zu ? '▶' : '▼';
              meinSubWrap.style.display = zu ? 'none' : 'block';
            });
            row.querySelector('.nav-item-text').addEventListener('click', () => scrollToHdg(h, lvl, pg));
            body.appendChild(row);
            subWrap = meinSubWrap;
            body.appendChild(meinSubWrap);
          } else {
            const wrap = subWrap || body;
            const isActiveH = _activeHdgText && h.textContent === _activeHdgText;
            const item = document.createElement('li'); item.className = 'nav-item' + (isActiveH ? ' nav-active' : ''); item.dataset.level = lvl;
            item.innerHTML = '<span class="nav-dot"></span><span class="nav-item-text"></span><span class="nav-pg-badge">S.' + pgNo + '</span>';
            item.querySelector('.nav-item-text').textContent = h.textContent;
            item.querySelector('.nav-item-text').addEventListener('click', () => scrollToHdg(h, lvl, pg));
            wrap.appendChild(item);
          }
        });
      }

      if (!body.children.length) {
        const leer = document.createElement('div');
        leer.className = 'nav-empty';
        leer.textContent = pages.length ? t('navNoHeadings') : t('navNoPages');
        body.appendChild(leer);
      }
    }

    tree.appendChild(body);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   SUCHE IM HEFT

   Dasselbe wie die Suche auf der Startseite, nur innerhalb eines Hefts –
   und mit dem Abschnitt an jedem Treffer, denn genau danach sucht man
   meistens: „wo stand das noch, in den Regeln oder in den Uebungen?"

   Die Treffer stehen in der Navigation, an der Stelle der
   Ueberschriften. Sie fuehren an dieselben Orte, also gehoeren sie
   dorthin – und nicht in ein weiteres Fenster.
   ══════════════════════════════════════════════════════════════════════ */

let _nbSearchQuery = '';
const NB_SEARCH_MAX = 80;

/** Der reine Text einer Seite – ohne Auszeichnung, ohne doppelte Leerzeichen. */
function nbSearchPlainText(page) {
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

function nbSearchSnippet(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text.slice(0, 90);
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + query.length + 50);
  return (start > 0 ? '… ' : '') + text.slice(start, end) + (end < text.length ? ' …' : '');
}

/** Baut den Ausschnitt mit hervorgehobenem Treffer – ohne innerHTML. */
function nbSearchSnippetNode(snippet, query) {
  const wrap = document.createElement('span');
  wrap.className = 'nbs-hit-snippet';
  const idx = snippet.toLowerCase().indexOf(query);
  if (idx === -1) { wrap.textContent = snippet; return wrap; }

  wrap.append(document.createTextNode(snippet.slice(0, idx)));
  const mark = document.createElement('mark');
  mark.textContent = snippet.slice(idx, idx + query.length);
  wrap.append(mark, document.createTextNode(snippet.slice(idx + query.length)));
  return wrap;
}

function renderNbSearchResults(nb, tree) {
  const query = _nbSearchQuery;
  const treffer = [];

  for (const page of notebookPages(nb)) {
    const text = nbSearchPlainText(page);
    if (!text || !text.toLowerCase().includes(query)) continue;
    treffer.push({
      page,
      sec: findSecForPage(page.id, nb),
      pageNo: pageNumberOf(nb, page.id),
      snippet: nbSearchSnippet(text, query)
    });
    if (treffer.length >= NB_SEARCH_MAX) break;
  }

  const kopf = document.createElement('div');
  kopf.className = 'nbs-count';
  kopf.textContent = treffer.length
    ? t('searchResults').replace('{n}', String(treffer.length))
    : t('searchNoResults').replace('{q}', query);
  tree.appendChild(kopf);

  for (const hit of treffer) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'nbs-hit';

    const kopfzeile = document.createElement('span');
    kopfzeile.className = 'nbs-hit-head';

    const nr = document.createElement('span');
    nr.className = 'nbs-hit-no';
    nr.textContent = t('pageNo').replace('{n}', String(hit.pageNo));
    kopfzeile.appendChild(nr);

    /* Der Abschnitt an jedem Treffer – mit seinem Farbpunkt, damit man
       ihn wiedererkennt, ohne den Namen zu lesen. */
    const sec = document.createElement('span');
    sec.className = 'nbs-hit-sec' + (hit.sec ? '' : ' none');
    const punkt = document.createElement('span');
    punkt.className = 'nbs-hit-dot';
    if (hit.sec) punkt.style.background = colorForSection(hit.sec);
    const name = document.createElement('span');
    name.textContent = hit.sec ? getSectionDisplayName(hit.sec) : t('noSection');
    sec.append(punkt, name);
    kopfzeile.appendChild(sec);

    row.append(kopfzeile, nbSearchSnippetNode(hit.snippet, query));
    row.addEventListener('click', () => jumpToSearchHit(nb, hit.page));
    tree.appendChild(row);
  }
}

/**
 * Zu einem Treffer springen – und dafür nötigenfalls den Ausschnitt
 * wechseln. Ohne das führte ein Treffer ins Leere, sobald die Ansicht
 * gerade auf einem Abschnitt stand, zu dem die Seite nicht gehört.
 */
function jumpToSearchHit(nb, page) {
  const gezeigt = activeSection(nb);
  const sichtbar = gezeigt ? pagesOfSec(gezeigt, nb) : notebookPages(nb);
  const drin = sichtbar.some(p => String(p.id) === String(page.id));

  if (drin) {
    // Schon zu sehen – nur hinscrollen, nichts neu zeichnen
    setActivePg(page.id);
    const el = E('pages-wrap').querySelector('[data-pgid="' + cssEscape(page.id) + '"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const ziel = page.secId
    ? (nb.sections || []).find(s => String(s.id) === String(page.secId)) || null
    : null;
  openSection(ziel, page.id);
}

function openNbSearch() {
  const box = E('side-search');
  const input = E('nb-search-input');
  if (!box || !input) return;

  // Die Leiste muss offen sein, sonst tippt man ins Unsichtbare
  const panel = E('side-panel');
  if (panel && !panel.classList.contains('open')) E('btn-panel-toggle')?.click();

  box.style.display = 'flex';
  input.focus();
  input.select();
}

/** @param {boolean} [neuZeichnen] false, wenn der Aufrufer ohnehin zeichnet */
function closeNbSearch(neuZeichnen = true) {
  const box = E('side-search');
  const input = E('nb-search-input');
  if (box) box.style.display = 'none';
  if (input) input.value = '';
  _nbSearchQuery = '';
  if (neuZeichnen) renderSideTree();
}

E('btn-nb-search')?.addEventListener('click', () => {
  const box = E('side-search');
  if (box && box.style.display !== 'none') closeNbSearch(); else openNbSearch();
});

E('nb-search-clear')?.addEventListener('click', () => closeNbSearch());

E('nb-search-input')?.addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  // Unter zwei Zeichen trifft alles – dann lieber der gewohnte Baum
  _nbSearchQuery = q.length >= 2 ? q : '';
  renderSideTree();
});

E('nb-search-input')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeNbSearch(); }
  if (e.key === 'Enter') {
    e.preventDefault();
    E('side-tree')?.querySelector('.nbs-hit')?.click();
  }
});

/* ══════════════════════════════════════════════════════════════════════
   DEN BAUM NICHT STAENDIG NEU BAUEN

   renderSideTree() wird aus neun Dateien gerufen – unter anderem vom
   Beobachter JEDER Seite, sobald sie sichtbar wird, und bei JEDEM
   Tastendruck. Jeder Aufruf laeuft ueber alle gezeigten Seiten, fragt fuer
   jede das DOM nach Ueberschriften und baut den ganzen Baum neu. Bei fuenf
   Seiten faellt das nicht auf; bei hundert ist es beim Scrollen und beim
   Schreiben der Engpass.

   Zwei Ausweichungen, beide ohne Verlust an Verhalten:
   ══════════════════════════════════════════════════════════════════════ */

/* Beim Scrollen aendert sich am Baum nur EINES: welche Zeile hervorgehoben
   ist. Also auch nur das umsetzen. */
function markActiveNavItem() {
  const nb = getNb();
  const tree = E('side-tree');
  if (!nb || !tree || !S.activePgId) return;

  const marke = 'S.' + pageNumberOf(nb, S.activePgId);
  let getroffen = false;
  for (const item of tree.querySelectorAll('.nav-item')) {
    const badge = item.querySelector('.nav-pg-badge');
    // Die erste Ueberschrift der Seite, auf der man gerade steht
    const treffer = !getroffen && badge && badge.textContent === marke;
    item.classList.toggle('nav-active', treffer);
    if (treffer) getroffen = true;
  }
}

/* Beim Tippen aendern sich Ueberschriften wirklich – der Baum muss also
   neu. Aber nicht bei jedem Anschlag. */
let _sideTreeTimer = null;
function scheduleSideTree(ms = 200) {
  if (_sideTreeTimer) return;
  _sideTreeTimer = setTimeout(() => {
    _sideTreeTimer = null;
    renderSideTree();
  }, ms);
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
  /* Damit das Heft beim naechsten Mal hier wieder aufgeht. Gemerkt wird
     oertlich und verzoegert geschrieben – core/settings.js. */
  if (typeof rememberNotebookView === 'function') {
    rememberNotebookView(S.activeNbId, { pageId: pgId });
  }
}

/* Die Nummer kommt aus dem HEFT, nicht aus der Bildschirmposition.
   Vorher zählte diese Stelle die gezeichneten Seiten durch – solange immer
   ein ganzer Abschnitt zu sehen war, fiel das nicht auf. Sobald aber nur
   ein Ausschnitt gezeigt wird, hieße die erste sichtbare Seite wieder
   „Seite 1", obwohl sie im Heft die siebte ist. */
function renumberVisiblePages() {
  const nb = getNb();
  if (!nb) return;
  const order = notebookPages(nb);
  QA('#pages-wrap .j-page').forEach((pgEl) => {
    const label = pgEl.querySelector('.j-page-num');
    if (!label) return;
    const no = order.findIndex(p => String(p.id) === pgEl.dataset.pgid) + 1;
    label.textContent = t('pageNo').replace('{n}', String(no || '?'));
  });
}

let _secMgrCtxMenu = null;

/* ── Darf hier überhaupt etwas geändert werden? ──────────────────────
   >>> Warum das nicht bloß Kosmetik ist <<<
   Die Abschnittsverwaltung veränderte das Heft bisher ohne jede Frage nach
   S.readOnly. In den Raum ging davon zwar nichts – syncStructure steigt bei
   fehlendem Schreibrecht aus –, aber es stand im örtlichen Modell. Sobald
   das Recht zurückkam, rief setCanWrite(true) sofort syncStructure() auf,
   und alles heimlich Entstandene ging auf einen Schlag hinaus.

   Damit war die Sperre für Eingeladene, deren Besitzer nicht da ist, durch
   eine Seitentür zu umgehen. Gemeldet wird es, statt still nichts zu tun –
   ein Knopf, der ohne Erklärung nicht reagiert, sieht wie ein Fehler aus. */
function mgrCanEdit() {
  if (!S.readOnly) return true;
  toast(t('sharedNoRight'), true);
  return false;
}

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

function showSecMgrPageMenu(x, y, page) {
  const nb = getNb();
  if (!nb || !page) return;
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

  menu.appendChild(mkBtn(t('goToPage'), async () => { secMgrOpenPage(nb, page); }));

  /* Frueher musste man den Zielnamen ABTIPPEN (txtModal) und die Eingabe
     wurde ueber den Namen verglichen – bei zwei aehnlich benannten
     Abschnitten ein Gluecksspiel. Jetzt derselbe Weg wie am Seitenkopf:
     ein Menue mit Farbpunkten. Es steht auch ohne vorhandene Abschnitte
     bereit, denn „Ohne Abschnitt" ist selbst eine Wahl. */
  menu.appendChild(mkBtn(t('setSection'), async () => {
    if (!mgrCanEdit()) return;
    menu.style.display = 'none';
    showPgSectionMenu(x, y, page, () => renderSecMgrBody());
  }));

  // Mit dieser Seite vorausgewählt – meist will man genau die übertragen
  menu.appendChild(mkBtn(t('transferOpen'), async () => {
    closeSecMgr();
    await openPageTransfer([String(page.id)]);
  }));

  // Von hier aus mehrere waehlen, ohne den langen Druck zu kennen
  menu.appendChild(mkBtn(t('pickSeveral'), async () => {
    if (!mgrCanEdit()) return;
    beginSecMgrPicking(String(page.id));
  }));

  menu.appendChild(mkBtn(t('deletePage'), async () => {
    await deletePageFromManager(page);
  }, true));

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.display = 'block';
}

/* Seite aus der Verwaltung löschen.
   Hieß deletePageFromSection und bekam den Abschnitt mit – unter Etiketten
   spielt der keine Rolle mehr: gelöscht wird aus dem Heft. */
async function deletePageFromManager(page) {
  const nb = getNb();
  if (!nb || !page) return;
  if (!mgrCanEdit()) return;
  if ((nb.pages || []).length <= 1) {
    await showAlert(t('lastPageStays'));
    return;
  }

  // confModal gibt es nicht – der Aufruf lief in einen ReferenceError,
  // und damit tat „Seite löschen" hier gar nichts.
  const ok = await showConfirm(t('deletePage') + '?');
  if (!ok) return;

  nb.pages = (nb.pages || []).filter(p => p.id !== page.id);
  syncSectionIds(nb);

  /* Nur das HEFT darf nicht leer werden. Ein Etikett, das gerade auf keiner
     Seite klebt, ist dagegen voellig in Ordnung – frueher wuchs hier eine
     Seite nach, sobald ein Abschnitt leer lief. */
  if (!nb.pages.length) {
    insertPageInto(nb, null, makePage(nb.defaultBg || 'ruled'));
  }

  if (S.activePgId === page.id) {
    const shown = visiblePages(nb);
    openSection(activeSection(nb), shown[0]?.id || notebookPages(nb)[0]?.id);
  }

  renderSideTree();
  renderSecMgrBody();
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/* „+ Seite" gibt es in der Verwaltung nicht mehr: Seiten entstehen beim
   Schreiben von selbst, und der Knopf am unteren Heftrand macht dasselbe
   an der Stelle, wo man ihn braucht. Er stand hier nur im Weg. */

/* ── Seiten in ein anderes Heft ──────────────────────────────────────
   Bewegt selbst nichts: fragt, lässt transferPages() (core/data.js) die
   Arbeit tun und meldet danach beide Hefte als geändert.

   >>> Welche Hefte als Ziel in Frage kommen <<<
   Alle eigenen außer dem Ausgangsheft – das ist der Normalfall und
   braucht weder Konto noch Netz. Ein geteiltes Dokument kommt nur dazu,
   wenn dort gerade wirklich geschrieben werden darf: ist der Besitzer
   nicht da, steht S.readOnly, und dann darf es gar nicht erst in der
   Auswahl auftauchen. Sonst wäre die Sperre über diesen Weg zu umgehen.
   ─────────────────────────────────────────────────────────────────── */
function transferTargetsFor(fromNb) {
  const targets = ownNotebooks().filter(nb => nb.id !== fromNb.id);
  for (const shared of sharedNotebooks()) {
    if (shared.id === fromNb.id) continue;
    if (S.readOnly) continue;                 // Besitzer weg oder nur Leserecht
    targets.push(shared);
  }
  return targets;
}

async function openPageTransfer(preselectedPageIds = []) {
  const nb = getNb();
  if (!nb) return;
  if (!mgrCanEdit()) return;                  // aus einem gesperrten Heft nichts herausnehmen

  const targets = transferTargetsFor(nb);
  if (!targets.length) { toast(t('transferNoTarget'), true); return; }

  const choice = await showPageTransferDialog(nb, targets, preselectedPageIds);
  if (!choice) return;

  const res = transferPages(nb, choice.pageIds, choice.toNb, {
    copy: choice.copy,
    keepSection: choice.keepSection
  });
  if (!res.moved) return;

  // Die uebertragenen Seiten sind weg oder woanders – die Auswahl endet
  endSecMgrPicking();

  /* Genau ein Anstoß je Heft, erst NACH allen Seiten. Der eine Aufruf
     deckt Datei, Live-Raum und geteiltes Dokument ab (core/autoSave.js);
     je Seite anzustoßen erzeugte ebenso viele Speichervorgänge. */
  if (typeof AutoSave !== 'undefined' && AutoSave) {
    if (!choice.copy) AutoSave.markDirty(nb.id);
    AutoSave.markDirty(choice.toNb.id);
  }

  // Das Ausgangsheft ist das offene – nur dort muss neu gezeichnet werden.
  if (!choice.copy) openSection(activeSection(nb));
  renderSideTree();
  renderSecMgrBody();

  toast((choice.copy ? t('transferDoneCopy') : t('transferDoneMove'))
    .replace('{n}', String(res.moved))
    .replace('{name}', choice.toNb.name));
}

/**
 * Einen Abschnitt anlegen – Name und Farbe in einem Aufwasch.
 *
 * @param {function} [danach] wird mit dem fertigen Abschnitt gerufen
 *
 * Ohne eigene Seite: ein Abschnitt ist ein Etikett, und ein Etikett, das
 * noch auf keiner Seite klebt, ist voellig in Ordnung. Frueher musste
 * zwingend eine Seite mit angelegt werden, weil ein Abschnitt ohne Seiten
 * gar nicht anzuzeigen war.
 */
function createSection(danach) {
  const nb = getNb();
  if (!nb) return;
  if (!mgrCanEdit()) return;
  getSections(nb);

  /* Erst nach dem Bestaetigen ins Heft – ein Abbruch soll nichts
     hinterlassen. Ohne defaultBg: das heisst „wie das Heft". */
  const sec = { id: uid(), name: t('newSection'), pgIds: [] };
  openSectionEditor(sec, () => {
    nb.sections.push(sec);
    renderSideTree();
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    if (danach) danach(sec);
  }, true);
}

function addSectionFromManager() {
  createSection(sec => renderSecMgrBody(sec.id));
}

function closeSecMgr() {
  const ov = E('ov-sec-mgr');
  if (ov) ov.style.display = 'none';
  if (_secMgrCtxMenu) _secMgrCtxMenu.style.display = 'none';
  // Eine Auswahl soll beim naechsten Aufmachen nicht noch dastehen
  _secMgrSel = null;
}

/* ══════════════════════════════════════════════════════════════════════
   DIE ABSCHNITTSVERWALTUNG

   Links die Abschnitte, rechts die Seiten. Ein Klick links schränkt die
   Liste rechts ein; rechts trägt jede Seite ihre echte Seitenzahl im Heft
   und ein anklickbares Etikett.

   >>> Warum das umgebaut wurde <<<
   Vorher war es je Abschnitt ein Kasten mit eigener Seitenliste – die
   Kapitel-Sicht. Unter Etiketten stimmte daran dreierlei nicht: Seiten
   ohne Abschnitt kamen ueberhaupt nicht vor, dieselbe Seite hätte in
   mehreren Kästen stehen müssen, um ihren Platz im Heft zu zeigen, und
   die Nummer links zählte je Abschnitt statt im Heft. Jetzt gibt es
   genau eine Liste, in der Reihenfolge des Hefts.
   ══════════════════════════════════════════════════════════════════════ */

/** Was rechts gezeigt wird: '*' alle, '' ohne Abschnitt, sonst eine secId. */
let _secMgrFilter = '*';

function secMgrFilteredPages(nb) {
  const alle = notebookPages(nb);
  if (_secMgrFilter === '*') return alle;
  if (_secMgrFilter === '') return alle.filter(p => !p.secId);
  return alle.filter(p => String(p.secId || '') === _secMgrFilter);
}

function renderSecMgrBody(focusSecId) {
  const nb = getNb();
  if (!nb) return;
  if (focusSecId) _secMgrFilter = String(focusSecId);
  getSections(nb);

  // Der gezeigte Abschnitt kann inzwischen gelöscht worden sein
  if (_secMgrFilter !== '*' && _secMgrFilter !== ''
      && !nb.sections.some(s => String(s.id) === _secMgrFilter)) _secMgrFilter = '*';

  renderSecMgrSide(nb);
  renderSecMgrPages(nb);
  // Muss NACH dem Aufbau laufen: die Klassen haengen an frischen Zeilen
  paintSecMgrPicks();
}

/* ── Name und Farbe eines Abschnitts ─────────────────────────────────
   Die Farbe wird sonst aus der Kennung gerechnet – so haben zwei frisch
   angelegte Abschnitte von selbst verschiedene Farben. Wer eine aussucht,
   ueberschreibt das; „Automatisch" nimmt die Wahl wieder zurueck. */
function openSectionEditor(sec, onDone, neu = false) {
  if (!mgrCanEdit()) return;
  const ov = E('ov-sec-edit');
  const nameIn = E('sec-edit-name');
  const pal = E('sec-edit-palette');
  const bgRow = E('sec-edit-bg-row');
  const okBtn = E('sec-edit-ok');
  if (!ov || !nameIn || !pal || !bgRow || !okBtn) return;

  /* Dasselbe Fenster fuers Anlegen. Sonst muesste man erst einen
     Abschnitt erzeugen und ihm dann in einem zweiten Schritt die Farbe
     geben – die Wahl gehoert dorthin, wo er entsteht. */
  E('sec-edit-title').textContent = neu ? t('newSection') : t('editSectionTitle');
  okBtn.textContent = neu ? t('create') : t('save');

  nameIn.value = sec.name || '';
  let gewaehlt = sec.color || '';

  const zeichnePalette = () => {
    pal.innerHTML = '';

    // Zuerst die gerechnete Farbe – erkennbar am gestrichelten Rand
    const auto = document.createElement('button');
    auto.type = 'button';
    auto.className = 'cp-swatch auto' + (gewaehlt ? '' : ' active');
    auto.style.background = colorForSection({ id: sec.id });
    auto.title = t('colorAuto');
    auto.addEventListener('click', () => { gewaehlt = ''; zeichnePalette(); });
    pal.appendChild(auto);

    for (const farbe of sectionPalette()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cp-swatch' + (gewaehlt === farbe ? ' active' : '');
      b.style.background = farbe;
      b.addEventListener('click', () => { gewaehlt = farbe; zeichnePalette(); });
      pal.appendChild(b);
    }
  };
  zeichnePalette();

  /* ── Das Papier des Abschnitts ────────────────────────────────────
     Leer heisst „wie das Heft", und das ist der Normalfall. Deshalb
     steht dafuer ein eigenes Feld ganz vorn, statt still eine Kopie des
     Heft-Papiers zu setzen – die bliebe stehen, wenn man spaeter das
     Papier des Hefts wechselt. */
  const nb = getNb();
  let bgWahl = sec.defaultBg || '';

  const zeichneBg = () => {
    buildBgRow(bgRow, bgWahl || bgForSection(null, nb), id => { bgWahl = id; markiereBgAuto(); });

    const auto = document.createElement('button');
    auto.type = 'button';
    auto.className = 'bg-sw bg-sw-auto' + (bgWahl ? '' : ' active');
    auto.title = t('bgLikeNotebook');
    auto.style.cssText = BG_STYLE[nb?.defaultBg || 'ruled'];
    auto.textContent = 'A';
    auto.addEventListener('click', () => {
      bgWahl = '';
      [...bgRow.querySelectorAll('.bg-sw')].forEach(x => x.classList.remove('active'));
      auto.classList.add('active');
    });
    bgRow.prepend(auto);
  };
  const markiereBgAuto = () => {
    const auto = bgRow.querySelector('.bg-sw-auto');
    if (auto) auto.classList.toggle('active', !bgWahl);
  };
  zeichneBg();

  const schliessen = () => { ov.style.display = 'none'; nameIn.onkeydown = null; };

  E('sec-edit-cancel').onclick = schliessen;
  ov.onclick = e => { if (e.target === ov) schliessen(); };
  okBtn.onclick = () => {
    const name = nameIn.value.trim();
    if (!name) { toast(t('enterName'), true); return; }
    sec.name = name;
    if (gewaehlt) sec.color = gewaehlt; else delete sec.color;
    if (bgWahl) sec.defaultBg = bgWahl; else delete sec.defaultBg;
    schliessen();
    if (onDone) onDone();
  };
  nameIn.onkeydown = e => { if (e.key === 'Enter') okBtn.click(); };

  ov.style.display = 'flex';
  setTimeout(() => { nameIn.focus(); nameIn.select(); }, 30);
}

/* ── Links: die Abschnitte als Filter ── */
function renderSecMgrSide(nb) {
  const side = E('sec-mgr-side');
  if (!side) return;
  side.innerHTML = '';

  const zeile = (key, farbe, name, anzahl) => {
    const row = document.createElement('div');
    row.className = 'mgr-side-row' + (_secMgrFilter === key ? ' active' : '');
    const dot = document.createElement('span');
    dot.className = 'mgr-side-dot' + (farbe ? '' : ' hollow');
    if (farbe) dot.style.background = farbe;
    const label = document.createElement('span');
    label.className = 'mgr-side-name';
    label.textContent = name;
    const cnt = document.createElement('span');
    cnt.className = 'mgr-side-count';
    cnt.textContent = String(anzahl);
    row.append(dot, label, cnt);
    row.addEventListener('click', () => {
      _secMgrFilter = key;
      /* Die Auswahl endet beim Umschalten. Sonst stuenden in der Zaehlung
         Seiten, die man gar nicht mehr sieht – und „Loeschen" traefe
         mehr, als vor Augen liegt. */
      _secMgrSel = null;
      renderSecMgrBody();
    });
    side.appendChild(row);
    return row;
  };

  zeile('*', null, t('allPages'), notebookPages(nb).length);

  for (const sec of nb.sections) {
    const row = zeile(String(sec.id), colorForSection(sec),
      getSectionDisplayName(sec), pagesOfSec(sec, nb).length);

    const tools = document.createElement('span');
    tools.className = 'mgr-side-tools';

    /* Ein Fenster fuer Name UND Farbe statt zweier Knoepfe. Die Farbe
       braucht eine Palette, und die passt nicht in eine 190px breite
       Spalte. */
    const ren = document.createElement('button');
    ren.type = 'button';
    ren.className = 'mgr-side-tool';
    ren.textContent = '✎';
    ren.title = t('editSectionTitle');
    ren.addEventListener('click', e => {
      e.stopPropagation();
      openSectionEditor(sec, () => {
        renderSideTree();
        renderSecMgrBody();
        refreshPageSectionMarks();
        if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
      });
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mgr-side-tool danger';
    del.textContent = '✕';
    del.title = t('delete');
    del.addEventListener('click', async e => {
      e.stopPropagation();
      if (!mgrCanEdit()) return;
      /* Frueher war der letzte Abschnitt unlöschbar und seine Seiten
         wanderten in einen anderen – beides Reste der Kapitel-Sicht. Ein
         Etikett darf man ersatzlos wegwerfen; die Seiten bleiben, wo sie
         sind, und stehen danach unter „Ohne Abschnitt". */
      const ok = await showConfirm(
        t('deleteSectionAsk').replace('{name}', getSectionDisplayName(sec)));
      if (!ok) return;

      for (const pg of pagesOfSec(sec, nb)) setSectionOfPage(nb, pg.id, '');
      nb.sections = nb.sections.filter(s => s.id !== sec.id);

      if (String(nb.activeSecId || '') === String(sec.id)) openSection(null);
      if (_secMgrFilter === String(sec.id)) _secMgrFilter = '*';

      renderSideTree();
      renderSecMgrBody();
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    });

    tools.append(ren, del);
    row.insertBefore(tools, row.querySelector('.mgr-side-count'));
  }

  // Ohne Abschnitte gäbe es hier zwei Zeilen mit derselben Bedeutung
  if (nb.sections.length) {
    zeile('', null, t('noSection'), notebookPages(nb).filter(p => !p.secId).length);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   SEITEN UMSORTIEREN – ZIEHEN UND ABLEGEN

   >>> Warum das mehr ist als drei Ereignisbehandler <<<
   dragover feuert im Dutzend pro Sekunde. Die naheliegende Fassung fragt
   dabei jede Zeile nach getBoundingClientRect() – bei 100 Seiten sind das
   100 erzwungene Layout-Rechnungen je Mausbewegung, und genau daran
   erstickt so eine Liste.

   Deshalb: einmal beim Aufnehmen alle Mitten messen (offsetTop, das ist
   scroll-unabhaengig) und danach nur noch binaer darin suchen. Die Marke
   ist ein innerer Schatten und keine eingeschobene Zeile – ein Schatten
   verschiebt nichts, die gemessenen Mitten bleiben also gueltig.
   ══════════════════════════════════════════════════════════════════════ */

let _dragPgId = null;      // welche Seite gerade wandert
let _dragPointerId = null; // welcher Zeiger sie haelt
let _dragRows = null;      // [{el, mitte}] in Listenkoordinaten
let _dragBodyTop = 0;      // Oberkante der Liste auf dem Schirm
let _markEl = null;        // wo die Marke gerade sitzt
let _markVor = false;      // davor (true) oder dahinter (false)

function messeZeilen(body) {
  _dragBodyTop = body.getBoundingClientRect().top;
  _dragRows = [];
  for (const el of body.children) {
    if (!el.classList.contains('mgr-pg-item')) continue;
    _dragRows.push({ el, mitte: el.offsetTop + el.offsetHeight / 2 });
  }
}

/** An welche Stelle der ANGEZEIGTEN Liste zeigt der Mauszeiger? */
function zielStelle(body, clientY) {
  if (!_dragRows || !_dragRows.length) return 0;
  const y = clientY - _dragBodyTop + body.scrollTop;
  let lo = 0, hi = _dragRows.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (_dragRows[m].mitte < y) lo = m + 1; else hi = m;
  }
  return lo;
}

function setzeMarke(stelle) {
  const el = (stelle === null || !_dragRows || !_dragRows.length) ? null
    : (stelle < _dragRows.length ? _dragRows[stelle].el
                                 : _dragRows[_dragRows.length - 1].el);
  const vor = stelle !== null && _dragRows && stelle < _dragRows.length;
  if (_markEl === el && _markVor === vor) return;

  if (_markEl) _markEl.classList.remove('drop-before', 'drop-after');
  _markEl = el;
  _markVor = vor;
  if (el) el.classList.add(vor ? 'drop-before' : 'drop-after');
}

/* Am Rand mitscrollen. Ohne das kaeme man in einer langen Liste nicht
   ueber den sichtbaren Ausschnitt hinaus – der Zeiger haelt ja die Seite. */
function randScroll(body, clientY) {
  const r = body.getBoundingClientRect();
  const zone = 44;
  if (clientY < r.top + zone) body.scrollTop -= 14;
  else if (clientY > r.bottom - zone) body.scrollTop += 14;
}

/* ── Der Zug selbst ──────────────────────────────────────────────────
   >>> Warum Zeiger-Ereignisse und nicht HTML5-Drag <<<
   draggable/dragstart gibt es mit dem FINGER nicht – auf einem Tablet
   liess sich damit keine Seite umsortieren. pointerdown/-move/-up
   sprechen alle drei Geraete gleich an, und die Rechnerei darunter
   (messeZeilen, zielStelle) bleibt dieselbe.

   Gezogen wird am Griff, nicht an der ganzen Zeile: mit dem Finger muss
   die Liste sich weiterhin scrollen lassen.

   Die Behandler haengen an der LISTE, nicht an den Zeilen – die Liste
   ueberlebt jedes Neuzeichnen. Sonst haetten sie sich bei jedem
   renderSecMgrBody() gestapelt. */
function ensureSecMgrDnd(body) {
  if (body._dndReady) return;
  body._dndReady = true;

  body.addEventListener('pointermove', e => {
    if (!_dragPgId || e.pointerId !== _dragPointerId) return;
    e.preventDefault();
    setzeMarke(zielStelle(body, e.clientY));
    randScroll(body, e.clientY);
  });

  const beenden = (e) => {
    if (!_dragPgId || e.pointerId !== _dragPointerId) return;
    const gezogen = _dragPgId;
    const stelle = zielStelle(body, e.clientY);

    setzeMarke(null);
    _dragRows?.forEach(r => r.el.classList.remove('dragging'));
    _dragPgId = null;
    _dragPointerId = null;
    _dragRows = null;
    body.classList.remove('dragging-now');

    const nb = getNb();
    if (!nb || !mgrCanEdit()) return;

    /* Die Stelle zaehlt in der ANGEZEIGTEN Liste, die womoeglich nur ein
       Ausschnitt ist. Uebersetzt wird sie ueber den Nachbarn: „vor dieser
       Seite" ist im Heft eindeutig, eine Zahl waere es nicht. */
    const gezeigt = secMgrFilteredPages(nb);
    let vorId;
    if (stelle < gezeigt.length) {
      vorId = gezeigt[stelle].id;
    } else {
      /* Ans Ende des Ausschnitts – nicht ans Ende des Hefts. Wer in
         „Regeln" nach unten zieht, meint hinter die letzte Regelseite. */
      const letzte = gezeigt[gezeigt.length - 1];
      const alle = notebookPages(nb);
      const j = alle.findIndex(p => String(p.id) === String(letzte?.id));
      vorId = (j >= 0 && alle[j + 1]) ? alle[j + 1].id : null;
    }

    if (!movePageBefore(nb, gezogen, vorId)) return;

    renderSecMgrBody();
    reorderPageDom(nb);
    renderSideTree();
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  };

  body.addEventListener('pointerup', beenden);
  body.addEventListener('pointercancel', e => {
    if (!_dragPgId || e.pointerId !== _dragPointerId) return;
    setzeMarke(null);
    _dragRows?.forEach(r => r.el.classList.remove('dragging'));
    _dragPgId = null; _dragPointerId = null; _dragRows = null;
    body.classList.remove('dragging-now');
  });
}

/** Einen Zug am Griff beginnen – Maus, Finger und Stift gleichermassen. */
function startSecMgrDrag(e, pgId, item, body) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (!mgrCanEdit()) return;
  if (_secMgrSel) return;              // im Auswahlmodus wird nicht sortiert

  e.preventDefault();
  e.stopPropagation();
  _dragPgId = String(pgId);
  _dragPointerId = e.pointerId;
  messeZeilen(body);
  item.classList.add('dragging');
  body.classList.add('dragging-now');

  /* Ohne Fangen verliert man den Zug, sobald der Finger die Zeile
     verlaesst – und das tut er sofort, es geht ja gerade darum. */
  try { body.setPointerCapture(e.pointerId); } catch (err) {}
  setzeMarke(zielStelle(body, e.clientY));
}

/* Die Seiten im Editor in die neue Reihenfolge bringen.
   >>> Warum nicht einfach openSection() <<<
   Das baut jede Seite neu auf – bei hundert Seiten samt Zeichenflaechen,
   Beobachtern und Bildern, und der Bildlauf springt an den Anfang. Hier
   hat sich aber genau EINE Seite bewegt. Also nur die verschieben; eine
   Zeichenflaeche behaelt ihr Bild dabei. */
function reorderPageDom(nb) {
  const wrap = E('pages-wrap');
  if (!wrap) return;

  let vorher = null;
  for (const pg of visiblePages(nb)) {
    const el = wrap.querySelector('[data-pgid="' + cssEscape(pg.id) + '"]');
    if (!el) continue;
    // Nur anfassen, was wirklich falsch steht
    const stehtRichtig = vorher ? vorher.nextElementSibling === el
                                : wrap.firstElementChild === el;
    if (!stehtRichtig) {
      if (vorher) vorher.after(el); else wrap.prepend(el);
    }
    vorher = el;
  }

  renumberVisiblePages();
}

/** Kennungen koennen alles enthalten – im Selektor muss das maskiert sein. */
function cssEscape(value) {
  const s = String(value);
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

/* ── Rechts: die Seiten, in Heft-Reihenfolge ── */
function renderSecMgrPages(nb) {
  const body = E('sec-mgr-body');
  if (!body) return;
  body.innerHTML = '';

  const pages = secMgrFilteredPages(nb);
  if (!pages.length) {
    const leer = document.createElement('div');
    leer.className = 'mgr-sec-empty';
    leer.textContent = t('noPagesYet');
    body.appendChild(leer);
    return;
  }

  ensureSecMgrDnd(body);

  for (const pg of pages) {
    const sec = findSecForPage(pg.id, nb);
    const item = document.createElement('div');
    item.className = 'mgr-pg-item';
    item.dataset.pgid = String(pg.id);
    if (sec) item.style.setProperty('--sec-color', colorForSection(sec));
    else item.classList.add('no-sec');

    /* Gezogen wird am Griff, nicht an der ganzen Zeile. Mit dem Finger
       muss die Liste sich weiterhin scrollen lassen – waere der ganze
       Streifen ziehbar, ginge das nicht mehr. Auf Beruehrungsschirmen ist
       der Griff deshalb groesser (css/responsive.css). */
    const griff = document.createElement('span');
    griff.className = 'mgr-pg-grip';
    griff.textContent = '⠿';
    griff.title = t('dragToReorder');
    griff.addEventListener('pointerdown', e => startSecMgrDrag(e, pg.id, item, body));

    // Die Zahl gilt im HEFT – vorher zählte sie je Abschnitt und
    // widersprach damit allem, was sonst „Seite 12" nennt
    const num = document.createElement('span');
    num.className = 'mgr-pg-num';
    num.textContent = String(pageNumberOf(nb, pg.id));

    const info = document.createElement('div');
    info.className = 'mgr-pg-info';
    const datum = document.createElement('span');
    datum.className = 'mgr-pg-date';
    datum.textContent = new Date(pg.date).toLocaleDateString();
    const vorschau = document.createElement('span');
    vorschau.className = 'mgr-pg-preview';
    vorschau.textContent = pagePreview(pg) || t('emptyPage');
    info.append(datum, vorschau);

    /* Das Etikett ist nur noch ein Schild, kein Knopf. Geaendert wird es
       ueber dieselben Befehle wie alles andere – ein Weg statt zweier. */
    const chip = document.createElement('span');
    chip.className = 'mgr-pg-sec' + (sec ? '' : ' none');
    chip.textContent = sec ? getSectionDisplayName(sec) : t('noSection');

    // Das Haekchen der Mehrfachauswahl; sichtbar nur im Auswahlmodus
    const haken = document.createElement('span');
    haken.className = 'mgr-pg-pick';
    haken.textContent = '✓';

    item.append(haken, griff, num, info, chip);

    /* ── Klicken, lange druecken ────────────────────────────────────
       Ein Klick oeffnet die Befehle dieser Seite. Lange draufbleiben
       schaltet in die Mehrfachauswahl, wie in einer Fotogalerie – dann
       waehlt jeder weitere Klick nur noch aus.

       Der Zeitgeber wird abgebrochen, sobald sich der Zeiger bewegt:
       sonst faenge jedes Ziehen zugleich eine Auswahl an. */
    let druckTimer = null, startX = 0, startY = 0;
    const druckEnde = () => { clearTimeout(druckTimer); druckTimer = null; };

    item.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY;
      druckEnde();
      druckTimer = setTimeout(() => {
        druckTimer = null;
        if (!mgrCanEdit()) return;
        beginSecMgrPicking(String(pg.id));
      }, 450);
    });
    item.addEventListener('pointermove', e => {
      if (!druckTimer) return;
      if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) druckEnde();
    });
    item.addEventListener('pointerup', druckEnde);
    item.addEventListener('pointercancel', druckEnde);

    item.addEventListener('click', e => {
      // Der lange Druck hat eben schon gewaehlt – nicht gleich wieder ab
      if (_secMgrClickSperre) return;
      if (_secMgrSel) { toggleSecMgrPick(String(pg.id)); return; }
      showSecMgrPageMenu(e.clientX, e.clientY, pg);
    });

    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (_secMgrSel) { toggleSecMgrPick(String(pg.id)); return; }
      showSecMgrPageMenu(e.clientX, e.clientY, pg);
    });

    body.appendChild(item);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   MEHRERE SEITEN AUF EINMAL

   Lange auf eine Seite druecken oeffnet die Auswahl, danach waehlt jeder
   Klick aus. Gearbeitet wird ueber die Fussleiste: uebertragen, Abschnitt
   festlegen, loeschen.

   >>> Warum hier nicht neu gezeichnet wird <<<
   Ein Neuaufbau der Liste bei jedem Antippen wuerde die fuer das Ziehen
   gemessenen Zeilenmitten ungueltig machen und bei hundert Seiten
   spuerbar ruckeln. Die Auswahl ist deshalb nur eine Klasse an der Zeile.
   ══════════════════════════════════════════════════════════════════════ */

let _secMgrSel = null;          // null = keine Auswahl, sonst Set von pgIds
let _secMgrClickSperre = false; // der lange Druck soll nicht doppelt wirken

function beginSecMgrPicking(pgId) {
  if (!_secMgrSel) _secMgrSel = new Set();
  _secMgrSel.add(String(pgId));

  /* Auf den langen Druck folgt noch ein Klick. Ohne diese Sperre naehme
     der die eben getroffene Wahl sofort wieder zurueck. */
  _secMgrClickSperre = true;
  setTimeout(() => { _secMgrClickSperre = false; }, 400);

  paintSecMgrPicks();
}

function endSecMgrPicking() {
  _secMgrSel = null;
  paintSecMgrPicks();
}

function toggleSecMgrPick(pgId) {
  if (!_secMgrSel) return;
  const key = String(pgId);
  if (_secMgrSel.has(key)) _secMgrSel.delete(key); else _secMgrSel.add(key);
  // Die letzte abgewaehlt: dann ist die Auswahl vorbei
  if (!_secMgrSel.size) _secMgrSel = null;
  paintSecMgrPicks();
}

/** Zeigt an, was gewaehlt ist – ohne die Liste neu zu bauen. */
function paintSecMgrPicks() {
  const body = E('sec-mgr-body');
  if (!body) return;

  body.classList.toggle('picking', !!_secMgrSel);
  for (const el of body.children) {
    if (!el.classList.contains('mgr-pg-item')) continue;
    el.classList.toggle('picked', !!_secMgrSel && _secMgrSel.has(el.dataset.pgid));
  }

  const normal = E('sec-mgr-bar-normal');
  const pick = E('sec-mgr-bar-pick');
  if (normal) normal.style.display = _secMgrSel ? 'none' : '';
  if (pick) pick.style.display = _secMgrSel ? '' : 'none';

  const zahl = E('sec-mgr-pick-count');
  if (zahl) zahl.textContent = t('transferCount').replace('{n}', String(_secMgrSel?.size || 0));
}

/* ── Was mit den gewaehlten Seiten geschieht ── */

function pickAllSecMgr() {
  const nb = getNb();
  if (!nb) return;
  _secMgrSel = new Set(secMgrFilteredPages(nb).map(p => String(p.id)));
  paintSecMgrPicks();
}

async function deletePickedPages() {
  const nb = getNb();
  if (!nb || !_secMgrSel?.size) return;
  if (!mgrCanEdit()) return;

  const gewaehlt = secMgrPickedPages(nb);
  /* Ein Heft ohne Seiten gibt es nicht. Statt hinterher eine leere
     nachwachsen zu lassen, wird hier ehrlich abgelehnt. */
  if (gewaehlt.length >= (nb.pages || []).length) {
    await showAlert(t('lastPageStays'));
    return;
  }

  const ok = await showConfirm(
    t('deletePagesAsk').replace('{n}', String(gewaehlt.length)));
  if (!ok) return;

  const weg = new Set(gewaehlt.map(p => String(p.id)));
  nb.pages = (nb.pages || []).filter(p => !weg.has(String(p.id)));
  for (const id of weg) delete S.strokeHistory[id];
  syncSectionIds(nb);

  endSecMgrPicking();
  renderSecMgrBody();
  // Gelöschte Seiten stehen sonst noch im Editor
  openSection(activeSection(nb));
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  toast(t('deletePagesDone').replace('{n}', String(weg.size)));
}

/** Allen gewaehlten Seiten dasselbe Etikett geben. */
function setSectionForPicked(x, y) {
  const nb = getNb();
  if (!nb || !_secMgrSel?.size) return;
  if (!mgrCanEdit()) return;

  const gewaehlt = secMgrPickedPages(nb);
  /* showPgSectionMenu arbeitet auf EINER Seite. Die erste bestimmt, was
     im Menue als aktuell angehakt erscheint; angewandt wird die Wahl dann
     auf alle – deshalb der Umweg ueber onDone. */
  const vorher = gewaehlt.map(p => String(p.secId || ''));
  showPgSectionMenu(x, y, gewaehlt[0], () => {
    const neu = String(gewaehlt[0].secId || '');
    for (let i = 1; i < gewaehlt.length; i++) setSectionOfPage(nb, gewaehlt[i].id, neu);
    // Hat sich gar nichts geaendert, war es ein Klick auf das Bestehende
    if (neu !== vorher[0] || gewaehlt.some((p, i) => String(p.secId || '') !== vorher[i])) {
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    }
    endSecMgrPicking();
    renderSecMgrBody();
    renderSideTree();
    refreshPageSectionMarks();
  });
}

/** Die gewaehlten Seiten, in Heft-Reihenfolge. */
function secMgrPickedPages(nb) {
  if (!_secMgrSel) return [];
  return notebookPages(nb).filter(p => _secMgrSel.has(String(p.id)));
}

/* Eine Seite aus der Verwaltung heraus aufschlagen.
   Steht die Ansicht auf einem Ausschnitt, zu dem die Seite nicht gehört,
   wird auf alle Seiten zurückgeschaltet – sonst spränge man auf eine
   Seite, die dort gar nicht zu sehen ist. */
function secMgrOpenPage(nb, pg) {
  const gezeigt = activeSection(nb);
  const drin = !gezeigt || String(pg.secId || '') === String(gezeigt.id);
  openSection(drin ? gezeigt : null, pg.id);
  closeSecMgr();
}

function openSecMgr(sec) {
  const ov = E('ov-sec-mgr');
  const closeBtn = E('sec-mgr-close');
  const doneBtn = E('sec-mgr-done');
  const addSecBtn = E('sec-mgr-add-sec');
  if (!ov || !closeBtn || !doneBtn || !addSecBtn) return;

  _secMgrFilter = sec ? String(sec.id) : '*';
  _secMgrSel = null;                       // frisch aufgemacht, nichts gewaehlt
  renderSecMgrBody();
  ov.style.display = 'grid';

  closeBtn.onclick = () => closeSecMgr();
  doneBtn.onclick = () => closeSecMgr();
  addSecBtn.onclick = () => addSectionFromManager();

  /* ── Die Sammelbefehle ── */
  E('sec-mgr-pick-all').onclick = () => pickAllSecMgr();
  E('sec-mgr-pick-done').onclick = () => endSecMgrPicking();
  E('sec-mgr-pick-del').onclick = () => deletePickedPages();
  E('sec-mgr-pick-sec').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    setSectionForPicked(r.left, r.top - 8);
  };
  E('sec-mgr-pick-move').onclick = async () => {
    const ids = [...(_secMgrSel || [])];
    if (!ids.length) return;
    closeSecMgr();
    await openPageTransfer(ids);
  };

  ov.onclick = (e) => {
    if (e.target === ov) closeSecMgr();
  };
}

/* ── ADD SECTION ── */
E('btn-add-sec').addEventListener('click', () => {
  createSection(sec => {
    openSection(sec);
    toast(t('sectionCreated').replace('{name}', sec.name));
  });
});

/* Die Verwaltung sitzt jetzt hier oben, neben dem Anlegen. */
E('btn-sec-mgr')?.addEventListener('click', () => openSecMgr(activeSection(getNb())));
