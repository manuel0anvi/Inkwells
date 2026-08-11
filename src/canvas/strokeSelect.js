'use strict';

/* ══════════════════════════════════════════════════════════════════════
   GEZEICHNETES AUSWÄHLEN

   Mit dem Zeiger auf einen Strich tippen wählt ihn aus. Danach:

     · eine GERADE Linie bekommt einen Griff an jedem Ende – damit lässt
       sie sich verlängern, kürzen und drehen, genau wie eine Linie aus
       dem Formen-Werkzeug
     · alles andere – Handschrift, Gekritzel – bekommt einen Rahmen und
       lässt sich verschieben, verdoppeln und löschen

   >>> Warum genau auf den Strich getroffen werden muss <<<
   Der Textbereich liegt über fast der ganzen Seite. Würde schon ein Klick
   in die Nähe auswählen, käme man neben einer Zeichnung nicht mehr in den
   Text. Deshalb wird gegen die Linie selbst geprüft (Abstand kleiner als
   die halbe Strichbreite plus ein paar Pixel Zugabe), nicht gegen ihr
   umschliessendes Rechteck.

   >>> Warum in der Abfangphase <<<
   Der Textbereich bekäme den Zeiger sonst zuerst und setzte die
   Schreibmarke, bevor hier überhaupt jemand nachsieht.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const ZUGABE = 5;          // Seiten-Pixel Zugabe um die Linie herum
  const MIN_LAENGE = 6;      // kürzer wird keine Linie gezogen

  let _sel = null;           // { pageId, stroke, pageEl, huelle, griffe[] }

  /* ── Treffer suchen ──────────────────────────────────────────────── */

  /** Liegt der Punkt auf diesem Strich? */
  function trifft(stroke, x, y) {
    const pts = stroke.path;
    if (!pts || !pts.length) return false;
    const tol = Math.max(3, (stroke.width || 2) / 2) + ZUGABE;

    if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y) < tol;

    for (let i = 0; i < pts.length - 1; i++) {
      if (pointToLineDistance(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < tol) {
        return true;
      }
    }
    return false;
  }

  /** Der oberste Strich unter dem Punkt – oder null. Von hinten nach vorn. */
  function strichUnter(pageId, x, y) {
    const liste = S.strokeHistory[pageId] || [];
    for (let i = liste.length - 1; i >= 0; i--) {
      const s = liste[i];
      if (s.isEraser) continue;
      if (trifft(s, x, y)) return s;
    }
    return null;
  }

  /** Ist das eine gerade Linie? Dann hat sie genau zwei Punkte. */
  const istGerade = stroke => stroke.path && stroke.path.length === 2;

  /** Das umschliessende Rechteck eines Strichs. */
  function rechteck(stroke) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of stroke.path) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rand = Math.max(3, (stroke.width || 2) / 2) + 3;
    return {
      x: minX - rand, y: minY - rand,
      w: (maxX - minX) + rand * 2, h: (maxY - minY) + rand * 2
    };
  }

  /* ── Auswahl aufheben ────────────────────────────────────────────── */
  function abwaehlen() {
    if (!_sel) return;
    if (_sel.huelle && _sel.huelle.parentNode) _sel.huelle.remove();
    _sel = null;
  }

  /* ── Nach einer Änderung: neu zeichnen und merken ────────────────── */
  function notiere(pageId, mitVerlauf) {
    const info = getPage(pageId);
    if (!info) return;
    const pageEl = document.querySelector('[data-pgid="' + CSS.escape(pageId) + '"]');
    const canvas = pageEl && pageEl.querySelector('.j-canvas:not(.live-canvas)');
    if (canvas) redrawStrokes(canvas, S.strokeHistory[pageId]);
    info.page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[pageId] || []));
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    if (mitVerlauf && typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE HÜLLE UM DEN AUSGEWÄHLTEN STRICH
     ══════════════════════════════════════════════════════════════════ */
  function zeichneHuelle() {
    if (!_sel) return;
    const r = rechteck(_sel.stroke);
    const h = _sel.huelle;
    h.style.left = r.x + 'px';
    h.style.top = r.y + 'px';
    h.style.width = r.w + 'px';
    h.style.height = r.h + 'px';

    if (istGerade(_sel.stroke)) {
      // Die Griffe sitzen an den ENDEN, nicht an den Ecken des Rechtecks
      _sel.griffe.forEach((g, i) => {
        const p = _sel.stroke.path[i];
        g.style.left = (p.x - r.x) + 'px';
        g.style.top = (p.y - r.y) + 'px';
      });
    }
  }

  function baueHuelle(pageEl, pageId, stroke) {
    const huelle = document.createElement('div');
    huelle.className = 'ink-sel';
    pageEl.appendChild(huelle);

    const griffe = [];
    _sel = { pageId, stroke, pageEl, huelle, griffe };

    /* ── Gerade Linie: ein Griff je Ende ──────────────────────────── */
    if (istGerade(stroke)) {
      huelle.classList.add('gerade');
      [0, 1].forEach(nr => {
        const g = document.createElement('div');
        g.className = 'ink-sel-end';
        huelle.appendChild(g);
        griffe.push(g);

        g.addEventListener('pointerdown', e => {
          e.stopPropagation(); e.preventDefault();
          g.setPointerCapture(e.pointerId);

          const info = getPage(pageId);
          if (info) pushPageHistory(info.page);

          const sx = e.clientX, sy = e.clientY;
          const start = { x: stroke.path[nr].x, y: stroke.path[nr].y };
          const fest = stroke.path[1 - nr];
          const zoom = typeof getZoom === 'function' ? getZoom() : 1;

          const mv = ev => {
            let nx = start.x + (ev.clientX - sx) / zoom;
            let ny = start.y + (ev.clientY - sy) / zoom;

            // Mit Umschalt in 15°-Schritten – für waagerecht und senkrecht
            if (ev.shiftKey) {
              const dx = nx - fest.x, dy = ny - fest.y;
              const len = Math.hypot(dx, dy);
              const schritt = Math.PI / 12;
              const w = Math.round(Math.atan2(dy, dx) / schritt) * schritt;
              nx = fest.x + Math.cos(w) * len;
              ny = fest.y + Math.sin(w) * len;
            }

            // Nicht auf null zusammenziehen – sonst ist sie nicht mehr zu fassen
            if (Math.hypot(nx - fest.x, ny - fest.y) < MIN_LAENGE) return;

            stroke.path[nr].x = nx;
            stroke.path[nr].y = ny;
            notiere(pageId, false);
            zeichneHuelle();
          };
          const up = ev => {
            try { g.releasePointerCapture(ev.pointerId); } catch (err) { }
            g.removeEventListener('pointermove', mv);
            g.removeEventListener('pointerup', up);
            notiere(pageId, true);
          };
          g.addEventListener('pointermove', mv);
          g.addEventListener('pointerup', up);
        });
      });
    }

    /* ── Verschieben: überall in der Hülle anfassen ───────────────── */
    huelle.addEventListener('pointerdown', e => {
      if (e.target !== huelle) return;    // nicht auf einem Griff
      e.stopPropagation(); e.preventDefault();
      huelle.setPointerCapture(e.pointerId);

      const info = getPage(pageId);
      if (info) pushPageHistory(info.page);

      const sx = e.clientX, sy = e.clientY;
      const anfang = stroke.path.map(p => ({ x: p.x, y: p.y }));
      const zoom = typeof getZoom === 'function' ? getZoom() : 1;

      const mv = ev => {
        const dx = (ev.clientX - sx) / zoom, dy = (ev.clientY - sy) / zoom;
        stroke.path.forEach((p, i) => { p.x = anfang[i].x + dx; p.y = anfang[i].y + dy; });
        notiere(pageId, false);
        zeichneHuelle();
        stelleLeiste();
      };
      const up = ev => {
        try { huelle.releasePointerCapture(ev.pointerId); } catch (err) { }
        huelle.removeEventListener('pointermove', mv);
        huelle.removeEventListener('pointerup', up);
        notiere(pageId, true);
      };
      huelle.addEventListener('pointermove', mv);
      huelle.addEventListener('pointerup', up);
    });

    zeichneHuelle();
    zeigeLeiste();
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE KLEINE LEISTE

     Am Fenster statt an der Seite – dieselbe Machart wie bei der Tabelle,
     damit sie im Hochformat nicht mit dem Zoom schrumpft.
     ══════════════════════════════════════════════════════════════════ */
  let leiste = null;

  function baueLeiste() {
    if (leiste) return leiste;
    leiste = document.createElement('div');
    leiste.className = 'ink-sel-bar';
    leiste.style.display = 'none';

    const knopf = (icon, titel, tun, extra) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ink-sel-btn' + (extra ? ' ' + extra : '');
      b.innerHTML = icon;
      b.title = titel;
      b.setAttribute('aria-label', titel);
      b.addEventListener('pointerdown', ev => ev.preventDefault());
      b.addEventListener('click', ev => { ev.stopPropagation(); tun(); });
      leiste.appendChild(b);
      return b;
    };

    const txt = (k, e) => (typeof t === 'function' && t(k)) || e;

    knopf('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.3"/><path d="M10.6 3.2A1.4 1.4 0 0 0 9.3 2.4H3.7a1.3 1.3 0 0 0-1.3 1.3v5.6c0 .6.35 1.1.85 1.3" stroke-linecap="round"/></svg>',
      txt('objDuplicate', 'Verdoppeln'), verdoppeln);

    knopf('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 4.2h10.8"/><path d="M6.4 4.2V2.9h3.2v1.3"/><path d="M3.9 4.2 4.5 13a.9.9 0 0 0 .9.8h5.2a.9.9 0 0 0 .9-.8l.6-8.8"/></svg>',
      txt('objDelete', 'Löschen'), loeschen, 'danger');

    document.body.appendChild(leiste);
    return leiste;
  }

  function zeigeLeiste() {
    const b = baueLeiste();
    b.style.display = 'flex';
    stelleLeiste();
  }

  function stelleLeiste() {
    if (!_sel || !leiste || leiste.style.display === 'none') return;
    const r = _sel.huelle.getBoundingClientRect();
    const h = leiste.offsetHeight || 30;
    const w = leiste.offsetWidth || 70;
    const oben = r.top - h - 6;
    leiste.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left))) + 'px';
    leiste.style.top = Math.round(oben > 60 ? oben : r.bottom + 6) + 'px';
  }

  function versteckeLeiste() {
    if (leiste) leiste.style.display = 'none';
  }

  /* ── Handgriffe der Leiste ───────────────────────────────────────── */
  function loeschen() {
    if (!_sel) return;
    const { pageId, stroke } = _sel;
    const info = getPage(pageId);
    if (info) pushPageHistory(info.page);
    S.strokeHistory[pageId] = (S.strokeHistory[pageId] || []).filter(s => s !== stroke);
    abwaehlen();
    versteckeLeiste();
    notiere(pageId, true);
  }

  function verdoppeln() {
    if (!_sel) return;
    const { pageId, stroke, pageEl } = _sel;
    const info = getPage(pageId);
    if (info) pushPageHistory(info.page);

    const kopie = JSON.parse(JSON.stringify(stroke));
    kopie.path.forEach(p => { p.x += 14; p.y += 14; });
    S.strokeHistory[pageId].push(kopie);

    abwaehlen();
    notiere(pageId, true);
    baueHuelle(pageEl, pageId, kopie);   // die Kopie ist gleich ausgewählt
  }

  /* ══════════════════════════════════════════════════════════════════
     ANFASSEN

     In der Abfangphase am Seitenbereich, damit der Textbereich nicht
     zuerst drankommt.
     ══════════════════════════════════════════════════════════════════ */
  document.addEventListener('pointerdown', e => {
    // Nur der Zeiger wählt aus; die Werkzeuge zeichnen weiter
    if (S.mode !== 'cursor' || S.readOnly) return;
    // Innerhalb der eigenen Bedienteile nichts tun
    if (e.target.closest('.ink-sel, .ink-sel-bar, .obj-wrap, .j-table-bar')) return;

    const pageEl = e.target.closest && e.target.closest('.j-page');
    if (!pageEl) { abwaehlen(); versteckeLeiste(); return; }

    const pageId = pageEl.dataset.pgid;
    const canvas = pageEl.querySelector('.j-canvas:not(.live-canvas)');
    if (!canvas) return;

    // Bildschirm → Seite
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const info = getPage(pageId);
    const pw = (info && info.page.w) || CFG.PAGE_W;
    const ph = (info && info.page.h) || CFG.PAGE_H;
    const x = (e.clientX - r.left) * (pw / r.width);
    const y = (e.clientY - r.top) * (ph / r.height);

    const treffer = strichUnter(pageId, x, y);
    if (!treffer) { abwaehlen(); versteckeLeiste(); return; }

    // Denselben noch einmal angetippt: stehen lassen
    if (_sel && _sel.stroke === treffer) return;

    e.preventDefault();
    e.stopPropagation();
    abwaehlen();
    baueHuelle(pageEl, pageId, treffer);
  }, true);

  /* Entf löscht, Esc hebt auf – wie bei jedem ausgewählten Ding. */
  document.addEventListener('keydown', e => {
    if (!_sel) return;
    // Nicht, während jemand im Text schreibt
    const a = document.activeElement;
    if (a && a.isContentEditable) return;
    if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;

    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); loeschen(); }
    else if (e.key === 'Escape') { abwaehlen(); versteckeLeiste(); }
  });

  // Beim Rollen und beim Werkzeugwechsel zieht die Leiste mit bzw. geht weg
  document.addEventListener('scroll', stelleLeiste, true);
  window.addEventListener('resize', stelleLeiste, { passive: true });

  /* ── Global erreichbar ───────────────────────────────────────────── */
  window.deselectStroke = function () { abwaehlen(); versteckeLeiste(); };
})();
