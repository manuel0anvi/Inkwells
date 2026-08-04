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

function renderSideTree() {
  const nb = getNb(); const tree = E('side-tree'); tree.innerHTML = ''; if (!nb) return;
  getSections(nb);

  const gesamt = notebookPages(nb).length;

  /* ─ „Alle Seiten" ─ */
  const alle = document.createElement('div');
  alle.className = 'sec-hdr filter-row' + (!nb.activeSecId ? ' active' : '');
  alle.innerHTML = '<span class="sec-dot all"></span>'
    + '<span class="sec-name">' + t('allPages') + '</span>'
    + '<span class="sec-pg-count">' + gesamt + '</span>'
    + '<button class="sec-edit-btn" title="' + t('manageSections') + '">✎</button>';
  alle.querySelector('.sec-edit-btn').addEventListener('click', e => {
    e.stopPropagation(); openSecMgr(activeSection(nb));
  });
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
    row.querySelector('.sec-dot').style.background = colorForSection(sec.id);
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
          : ([...((d => { d.innerHTML = pg.textContent || ''; return d; })(document.createElement('div'))).querySelectorAll('h1,h2,h3,p.j-title-1,p.j-title-2,p.j-title-3')]);
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

  menu.appendChild(mkBtn(t('open'), async () => { secMgrOpenPage(nb, page); }));

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

/** Eine neue Seite ans Ende des Hefts – mit Etikett (sec) oder ohne (null). */
function addPageToSection(sec) {
  const nb = getNb();
  if (!nb) return;
  if (!mgrCanEdit()) return;
  const pg = makePage(sec?.defaultBg || nb.defaultBg || 'ruled');
  insertPageInto(nb, sec, pg);

  // Zeigt die Ansicht einen Ausschnitt, zu dem die Seite nicht gehört,
  // bliebe sie unsichtbar – dann nur die Navigation nachziehen.
  const gezeigt = activeSection(nb);
  if (!gezeigt || (sec && String(gezeigt.id) === String(sec.id))) openSection(gezeigt, pg.id);
  else renderSideTree();

  renderSecMgrBody();
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

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

  const res = transferPages(nb, choice.pageIds, choice.toNb, { copy: choice.copy });
  if (!res.moved) return;

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

async function addSectionFromManager() {
  const nb = getNb();
  if (!nb) return;
  if (!mgrCanEdit()) return;
  const name = await txtModal(t('newSection'), t('newSection'));
  if (!name) return;

  getSections(nb);
  /* Ohne eigene Seite: ein Abschnitt ist ein Etikett, und ein Etikett, das
     noch auf keiner Seite klebt, ist voellig in Ordnung. Frueher musste
     zwingend eine Seite mit angelegt werden, weil ein Abschnitt ohne
     Seiten gar nicht anzuzeigen war. */
  const sec = { id: uid(), name, pgIds: [], defaultBg: nb.defaultBg };
  nb.sections.push(sec);
  renderSideTree();
  renderSecMgrBody(sec.id);
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

function closeSecMgr() {
  const ov = E('ov-sec-mgr');
  if (ov) ov.style.display = 'none';
  if (_secMgrCtxMenu) _secMgrCtxMenu.style.display = 'none';
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
    row.addEventListener('click', () => { _secMgrFilter = key; renderSecMgrBody(); });
    side.appendChild(row);
    return row;
  };

  zeile('*', null, t('allPages'), notebookPages(nb).length);

  for (const sec of nb.sections) {
    const row = zeile(String(sec.id), colorForSection(sec.id),
      getSectionDisplayName(sec), pagesOfSec(sec, nb).length);

    const tools = document.createElement('span');
    tools.className = 'mgr-side-tools';

    const ren = document.createElement('button');
    ren.type = 'button';
    ren.className = 'mgr-side-tool';
    ren.textContent = '✎';
    ren.title = t('rename');
    ren.addEventListener('click', async e => {
      e.stopPropagation();
      if (!mgrCanEdit()) return;
      const nextName = await txtModal(t('rename'), sec.name || '');
      if (!nextName) return;
      sec.name = nextName;
      renderSideTree();
      renderSecMgrBody();
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
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

  for (const pg of pages) {
    const sec = findSecForPage(pg.id, nb);
    const item = document.createElement('div');
    item.className = 'mgr-pg-item';
    if (sec) item.style.setProperty('--sec-color', colorForSection(sec.id));
    else item.classList.add('no-sec');

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

    // Das Etikett direkt hier umhängen – derselbe Weg wie am Seitenkopf
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mgr-pg-sec' + (sec ? '' : ' none');
    chip.textContent = sec ? getSectionDisplayName(sec) : t('noSection');
    chip.title = t('setSection');
    chip.addEventListener('click', e => {
      e.stopPropagation();
      if (!mgrCanEdit()) return;
      const r = chip.getBoundingClientRect();
      showPgSectionMenu(r.left, r.bottom + 4, pg, () => renderSecMgrBody());
    });

    const right = document.createElement('div');
    right.className = 'mgr-pg-right';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'mgr-mv-btn';
    openBtn.textContent = t('open');
    openBtn.addEventListener('click', () => { secMgrOpenPage(nb, pg); });

    const delPgBtn = document.createElement('button');
    delPgBtn.type = 'button';
    delPgBtn.className = 'mgr-pg-del';
    delPgBtn.textContent = '✕';
    delPgBtn.title = t('deletePage');
    delPgBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await deletePageFromManager(pg);
    });

    right.append(openBtn, delPgBtn);
    item.append(num, info, chip, right);

    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      showSecMgrPageMenu(e.clientX, e.clientY, pg);
    });
    body.appendChild(item);
  }
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
  const addPageBtn = E('sec-mgr-add-page');
  if (!ov || !closeBtn || !doneBtn || !addSecBtn || !addPageBtn) return;

  _secMgrFilter = sec ? String(sec.id) : '*';
  renderSecMgrBody();
  ov.style.display = 'grid';

  closeBtn.onclick = () => closeSecMgr();
  doneBtn.onclick = () => closeSecMgr();
  addSecBtn.onclick = async () => {
    await addSectionFromManager();
  };
  addPageBtn.onclick = () => {
    const nb = getNb();
    if (!nb) return;
    /* Die neue Seite bekommt das Etikett des gerade gezeigten Ausschnitts –
       und keines, wenn „Alle Seiten" oder „Ohne Abschnitt" gewählt ist.
       Vorher fiel sie ersatzweise in nb.sections[0], also in einen
       Abschnitt, den man gar nicht angesehen hatte. */
    const target = nb.sections.find(s => String(s.id) === _secMgrFilter) || null;
    addPageToSection(target);
  };
  const transferBtn = E('sec-mgr-transfer');
  if (transferBtn) {
    transferBtn.onclick = async () => {
      closeSecMgr();
      await openPageTransfer();
    };
  }
  ov.onclick = (e) => {
    if (e.target === ov) closeSecMgr();
  };
}

/* ── ADD SECTION ── */
E('btn-add-sec').addEventListener('click', () => {
  // Fremdes Dokument ohne Bearbeitungsrecht: nichts anlegen
  if (S.readOnly) { toast(t('sharedNoRight')); return; }

  txtModal(t('newSection'), t('newSection')).then(name => {
    if (!name) return; const nb = getNb(); if (!nb) return;
    getSections(nb);
    // Auch hier ohne eigene Seite – siehe addSectionFromManager
    const sec = { id: uid(), name, pgIds: [], defaultBg: nb.defaultBg };
    nb.sections.push(sec);
    renderSideTree();
    openSection(sec);
    toast(t('sectionCreated').replace('{name}', name));
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  });
});
