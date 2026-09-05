'use strict';

/* ══════════════════════════════════════════════════════════════════════
   GEZEICHNETES AUSWÄHLEN

   Zwei Wege führen zu einer Auswahl:

     · Mit dem ZEIGER auf einen Strich tippen – dann ist genau dieser
       eine gemeint.
     · Mit dem STIFT etwas schnell EINKREISEN – dann ist alles gemeint,
       was in der Schlinge liegt (siehe „Schnell eingekreist" unten).

   Danach gilt:

     · eine GERADE Linie bekommt einen Griff an jedem Ende – damit lässt
       sie sich verlängern, kürzen und drehen, genau wie eine Linie aus
       dem Formen-Werkzeug
     · alles andere – Handschrift, Gekritzel, mehrere Striche zusammen –
       bekommt einen Rahmen und lässt sich verschieben, verdoppeln und
       löschen

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

  // { pageId, strokes[], objekte[], pageEl, huelle, griffe[] }
  let _sel = null;

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
  function strichUnter(pageId, x, y, ausser) {
    const liste = S.strokeHistory[pageId] || [];
    for (let i = liste.length - 1; i >= 0; i--) {
      const s = liste[i];
      if (s.isEraser || s === ausser) continue;
      if (trifft(s, x, y)) return s;
    }
    return null;
  }

  /** Ist das eine einzelne gerade Linie? Dann hat sie genau zwei Punkte. */
  function istGerade(strokes, objekte) {
    return !(objekte && objekte.length)
      && strokes.length === 1 && strokes[0].path && strokes[0].path.length === 2;
  }

  /** Das Rechteck eines Bildes, einer Form oder einer Formel. */
  function objRechteck(o) {
    return { minX: o.x || 0, minY: o.y || 0,
             maxX: (o.x || 0) + (o.w || 0), maxY: (o.y || 0) + (o.h || 0) };
  }

  /** Das umschliessende Rechteck – nackt, ohne Zugabe für die Strichbreite. */
  function rohRechteck(strokes, objekte) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const dazu = (x, y) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    for (const stroke of (strokes || [])) for (const p of stroke.path) dazu(p.x, p.y);
    for (const o of (objekte || [])) {
      const r = objRechteck(o);
      dazu(r.minX, r.minY);
      dazu(r.maxX, r.maxY);
    }
    return { minX, minY, maxX, maxY };
  }

  /** Dasselbe Rechteck als Lage und Grösse, mit Platz für die Strichbreite. */
  function rechteck(strokes, objekte) {
    const r = rohRechteck(strokes, objekte);
    const dick = (strokes || []).reduce((m, s) => Math.max(m, s.width || 2), 2);
    const rand = Math.max(3, dick / 2) + 3;
    return {
      x: r.minX - rand, y: r.minY - rand,
      w: (r.maxX - r.minX) + rand * 2, h: (r.maxY - r.minY) + rand * 2
    };
  }

  /** Der Rahmen im DOM, in dem dieses Objekt steckt. */
  function objHuelle(pageEl, o) {
    return pageEl.querySelector('.obj-wrap[data-objid="' + CSS.escape(String(o.id)) + '"]');
  }

  /** Breite und Höhe der Seite – für die Grenzen beim Verschieben. */
  function seitenMass(pageId) {
    const info = typeof getPage === 'function' ? getPage(pageId) : null;
    return {
      w: (info && info.page.w) || CFG.PAGE_W,
      h: (info && info.page.h) || CFG.PAGE_H
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
     DIE HÜLLE UM DAS AUSGEWÄHLTE
     ══════════════════════════════════════════════════════════════════ */
  function zeichneHuelle() {
    if (!_sel) return;
    const r = rechteck(_sel.strokes, _sel.objekte);
    const h = _sel.huelle;
    h.style.left = r.x + 'px';
    h.style.top = r.y + 'px';
    h.style.width = r.w + 'px';
    h.style.height = r.h + 'px';

    if (istGerade(_sel.strokes, _sel.objekte)) {
      // Die Griffe sitzen an den ENDEN, nicht an den Ecken des Rechtecks
      _sel.griffe.forEach((g, i) => {
        const p = _sel.strokes[0].path[i];
        g.style.left = (p.x - r.x) + 'px';
        g.style.top = (p.y - r.y) + 'px';
      });
    }
  }

  function baueHuelle(pageEl, pageId, strokes, objekte) {
    strokes = strokes || [];
    objekte = objekte || [];
    if (!strokes.length && !objekte.length) return;

    /* Es darf immer nur EINES ausgewaehlt sein. Hier laufen alle Wege
       zusammen – Antippen, Einkreisen, Auswahl von aussen –, deshalb
       steht es hier und nicht an jedem Weg einzeln (canvas/objects.js). */
    if (typeof window.deselectObject === 'function') window.deselectObject();
    const huelle = document.createElement('div');
    huelle.className = 'ink-sel';
    pageEl.appendChild(huelle);

    const griffe = [];
    _sel = { pageId, strokes, objekte, pageEl, huelle, griffe };
    const mass = seitenMass(pageId);

    /* ── Gerade Linie: ein Griff je Ende ──────────────────────────── */
    if (istGerade(strokes, objekte)) {
      const stroke = strokes[0];
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

            // Auf dem Blatt bleiben – nach dem Einrasten, sonst zöge der
            // Winkelschritt das Ende wieder hinaus
            nx = klemme(nx, 0, mass.w);
            ny = klemme(ny, CFG.HDR, mass.h);

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
      const anfang = strokes.map(s => s.path.map(p => ({ x: p.x, y: p.y })));
      const objAnfang = objekte.map(o => ({ x: o.x || 0, y: o.y || 0 }));
      const zoom = typeof getZoom === 'function' ? getZoom() : 1;

      /* ══════════════════════════════════════════════════════════
         NICHT VOM BLATT HERUNTER

         Verschoben wurde bisher ohne jede Grenze. Die Zeichenfläche
         ist aber so gross wie die Seite und schneidet ab: was man
         hinausschob, war weg – nicht gelöscht, sondern unsichtbar auf
         Koordinaten ausserhalb des Blatts. Genau so wurde es gemeldet.

         Begrenzt wird die VERSCHIEBUNG, nicht der einzelne Punkt:
         sonst würde die Auswahl am Rand zusammengedrückt statt
         anzustossen.

         klemme() steht in canvas/objects.js – dort gilt dieselbe
         Grenze für Bilder, Formen und Formeln.
         ══════════════════════════════════════════════════════════ */
      const box = rohRechteck(strokes, objekte);

      const mv = ev => {
        let dx = (ev.clientX - sx) / zoom, dy = (ev.clientY - sy) / zoom;
        dx = klemme(dx, -box.minX, mass.w - box.maxX);
        dy = klemme(dy, CFG.HDR - box.minY, mass.h - box.maxY);
        strokes.forEach((s, i) => {
          s.path.forEach((p, k) => { p.x = anfang[i][k].x + dx; p.y = anfang[i][k].y + dy; });
        });
        objekte.forEach((o, i) => {
          o.x = objAnfang[i].x + dx;
          o.y = objAnfang[i].y + dy;
          const w = objHuelle(pageEl, o);
          if (w) { w.style.left = o.x + 'px'; w.style.top = o.y + 'px'; }
        });
        notiere(pageId, false);
        zeichneHuelle();
        stelleLeiste();
      };
      const up = ev => {
        try { huelle.releasePointerCapture(ev.pointerId); } catch (err) { }
        huelle.removeEventListener('pointermove', mv);
        huelle.removeEventListener('pointerup', up);
        notiere(pageId, true);
        if (objekte.length && typeof noteObjectChanged === 'function') noteObjectChanged();
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
  let farbKnopf = null;
  let dickKnoepfe = [];

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

    /* ══════════════════════════════════════════════════════════════════
       FARBE UND DICKE GEHÖREN AN DIE AUSWAHL

       Hier standen nur Verdoppeln und Löschen. Gemeldet wurde der Fall,
       in dem das am meisten fehlt: man zieht eine Linie, hält am Ende
       kurz still, damit sie gerade wird – und will sie dann dicker oder
       in einer anderen Farbe haben. Ein Strich behält aber Farbe und
       Dicke des Stiftes, mit dem er gezogen wurde, und es gab keinen Weg
       dorthin ausser: löschen, Stift umstellen, neu ziehen.

       Eine FORM kann das längst (canvas/shapes.js, addShapeChrome). Dass
       eine glattgezogene Linie es nicht kann, ist von aussen nicht zu
       erklären – sie sieht genauso aus.

       Es gilt für die ganze Auswahl, nicht nur für Geraden: bei
       Handschrift ist „das da soll rot sein" dieselbe Bitte. Der Marker
       bleibt dabei Marker (seine Durchsichtigkeit steckt in der Farbe
       selbst) – deshalb wird nur die Farbe gesetzt, nicht die Art.
       ══════════════════════════════════════════════════════════════════ */

    farbKnopf = document.createElement('button');
    farbKnopf.type = 'button';
    farbKnopf.className = 'ink-sel-btn';
    farbKnopf.innerHTML = '<span class="ink-sel-farbe"></span>';
    farbKnopf.addEventListener('pointerdown', ev => ev.preventDefault());
    farbKnopf.addEventListener('click', ev => { ev.stopPropagation(); farbeWaehlen(); });
    leiste.appendChild(farbKnopf);

    /* Dieselben vier Stärken wie beim Stift (core/state.js, PEN_SIZES) –
       eine eigene Auswahl daneben wäre eine zweite Wahrheit. */
    dickKnoepfe = [];
    for (const dick of (typeof PEN_SIZES !== 'undefined' ? PEN_SIZES : [1.2, 2.5, 4.5, 8])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ink-sel-btn ink-sel-dick';
      b.dataset.dick = String(dick);
      b.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><line x1="2.5" y1="8" x2="13.5" y2="8"'
        + ' stroke="currentColor" stroke-width="' + dick + '" stroke-linecap="round"/></svg>';
      b.title = dick + ' px';
      b.setAttribute('aria-label', dick + ' px');
      b.addEventListener('pointerdown', ev => ev.preventDefault());
      b.addEventListener('click', ev => { ev.stopPropagation(); setzeDicke(dick); });
      leiste.appendChild(b);
      dickKnoepfe.push(b);
    }

    const trenner = document.createElement('span');
    trenner.className = 'ink-sel-trenner';
    leiste.appendChild(trenner);

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
    spiegleAuswahl();
    stelleLeiste();
  }

  /** Die aktuelle Farbe im Knopf, die aktuelle Dicke hervorgehoben. */
  function spiegleAuswahl() {
    if (!_sel || !farbKnopf) return;
    const striche = _sel.strokes || [];

    /* Ohne Strich (nur Objekte in der Auswahl) gibt es hier nichts zu
       stellen – Form und Bild haben ihre eigene Leiste. */
    const zeigen = striche.length > 0 ? '' : 'none';
    farbKnopf.style.display = zeigen;
    for (const b of dickKnoepfe) b.style.display = zeigen;
    if (!striche.length) return;

    const farbe = striche[0].color || '#1a1510';
    const feld = farbKnopf.firstElementChild;
    if (feld) feld.style.background = farbe;
    farbKnopf.title = (typeof t === 'function' && t('penColor')) || 'Stiftfarbe';

    /* Bei gemischten Stärken bleibt keiner hervorgehoben – sonst stünde
       dort eine Zahl, die nur für einen der Striche gilt. */
    const dick = striche[0].width;
    const einheitlich = striche.every(st => st.width === dick);
    for (const b of dickKnoepfe) {
      b.classList.toggle('active', einheitlich && Number(b.dataset.dick) === dick);
    }
  }

  /** Farbe der ganzen Auswahl ändern. */
  function farbeWaehlen() {
    if (!_sel || !_sel.strokes.length || typeof openCustomColorPopover !== 'function') return;
    const { pageId, strokes } = _sel;
    const info = getPage(pageId);
    let gesichert = false;

    openCustomColorPopover('pen', farbKnopf, (farbe, endgueltig) => {
      /* Der Verlauf bekommt EINEN Schritt, nicht einen je Bewegung im
         Farbrad: der Rückruf läuft beim Ziehen ununterbrochen. */
      if (!gesichert && info) { gesichert = true; pushPageHistory(info.page); }
      for (const st of strokes) st.color = farbe;
      const feld = farbKnopf.firstElementChild;
      if (feld) feld.style.background = farbe;
      notiere(pageId, endgueltig);
      if (endgueltig) meldeStriche();
    });
  }

  /** Strichstärke der ganzen Auswahl ändern. */
  function setzeDicke(dick) {
    if (!_sel || !_sel.strokes.length) return;
    const { pageId, strokes } = _sel;
    const info = getPage(pageId);
    if (info) pushPageHistory(info.page);

    /* Der Marker behält sein Verhältnis zum Stift: er ist dicker, weil
       er ein Marker ist, und soll es nach dem Umstellen auch bleiben. */
    for (const st of strokes) st.width = st.isHL ? dick * 4 : dick;

    for (const b of dickKnoepfe) {
      b.classList.toggle('active', Number(b.dataset.dick) === dick);
    }
    notiere(pageId, true);
    meldeStriche();
    // Die Hülle sitzt an der Dicke – ein dickerer Strich braucht mehr Platz
    zeichneHuelle();
    stelleLeiste();
  }

  /* ══════════════════════════════════════════════════════════════════
     GEÄNDERTE STRICHE MÜSSEN AUCH BEIM ANDEREN ANKOMMEN

     noteStroke hängt einen NEUEN Strich an – für einen geänderten taugt
     es nicht, beim anderen stünde er danach zweimal da. Was hier
     geschieht, ist dasselbe wie Radieren: die Liste der Seite ist eine
     andere geworden. Genau dafür gibt es den Heft-Vergleich, und den
     stösst markCurrentNotebookDirty an (notiere() tut das schon).

     Ausdrücklich angestossen wird er trotzdem: der Vergleich läuft
     gebremst, und eine Farbe, die erst in ein paar Sekunden ankommt,
     sieht aus wie eine, die gar nicht ankommt.
     ══════════════════════════════════════════════════════════════════ */
  function meldeStriche() {
    if (window.Collab && typeof Collab.noteChange === 'function') Collab.noteChange();
  }

  function stelleLeiste() {
    if (!_sel || !leiste || leiste.style.display === 'none') return;
    const r = _sel.huelle.getBoundingClientRect();
    const h = leiste.offsetHeight || 30;
    const w = leiste.offsetWidth || 70;
    /* ── Sie muss GANZ zu sehen sein ────────────────────────────────
       Ueber der Form, wenn dort Platz ist, sonst darunter. Beides wird
       danach ins Fenster geklemmt: eine Form ganz unten schob die Leiste
       sonst unter den unteren Rand, wo niemand mehr hinkommt.

       Die 60 Pixel oben sind die Werkzeugleiste - darunter darf sie
       nicht rutschen, sonst steht sie hinter den Knoepfen. */
    const OBEN_FREI = 60, RAND = 8;
    const darueber = r.top - h - 6;
    let y = darueber > OBEN_FREI ? darueber : r.bottom + 6;
    y = Math.max(OBEN_FREI, Math.min(window.innerHeight - h - RAND, y));

    const x = Math.max(RAND, Math.min(window.innerWidth - w - RAND, r.left));

    leiste.style.left = Math.round(x) + 'px';
    leiste.style.top = Math.round(y) + 'px';
  }

  function versteckeLeiste() {
    if (leiste) leiste.style.display = 'none';
  }

  /* ── Handgriffe der Leiste ───────────────────────────────────────── */
  function loeschen() {
    if (!_sel) return;
    const { pageId, strokes, objekte, pageEl } = _sel;
    const info = getPage(pageId);
    if (info) pushPageHistory(info.page);

    S.strokeHistory[pageId] = (S.strokeHistory[pageId] || []).filter(s => !strokes.includes(s));

    if (objekte.length && info) {
      const weg = new Set(objekte.map(o => String(o.id)));
      info.page.objects = (info.page.objects || []).filter(o => !weg.has(String(o.id)));
      objekte.forEach(o => { const w = objHuelle(pageEl, o); if (w) w.remove(); });
      const layer = pageEl.querySelector('.j-objects');
      if (layer && typeof restackObjects === 'function') restackObjects(layer, info.page);
      if (typeof noteObjectChanged === 'function') noteObjectChanged();
    }

    abwaehlen();
    versteckeLeiste();
    notiere(pageId, true);
  }

  function verdoppeln() {
    if (!_sel) return;
    const { pageId, strokes, objekte, pageEl } = _sel;
    const info = getPage(pageId);
    if (info) pushPageHistory(info.page);

    const kopien = strokes.map(s => {
      const k = JSON.parse(JSON.stringify(s));
      k.path.forEach(p => { p.x += 14; p.y += 14; });
      return k;
    });
    if (kopien.length) S.strokeHistory[pageId].push(...kopien);

    const objKopien = [];
    if (objekte.length && info) {
      const layer = pageEl.querySelector('.j-objects');
      const liste = info.page.objects || (info.page.objects = []);
      for (const o of objekte) {
        const k = { ...o, id: uid(), x: (o.x || 0) + 14, y: (o.y || 0) + 14 };
        if (typeof haltAufBlatt === 'function') haltAufBlatt(k, info.page);
        liste.push(k);
        objKopien.push(k);
        if (layer && typeof placeObject === 'function') placeObject(layer, k, info.page);
      }
      if (typeof noteObjectChanged === 'function') noteObjectChanged();
    }

    abwaehlen();
    notiere(pageId, true);
    // Die Kopie ist gleich ausgewählt
    baueHuelle(pageEl, pageId, kopien, objKopien);
  }

  /* ══════════════════════════════════════════════════════════════════
     SCHNELL EINGEKREIST = AUSGEWÄHLT

     Wer mit dem Stift schnell eine Schlinge um etwas zieht, meint nicht
     die Schlinge, sondern das, was darin liegt. Wer langsam zeichnet,
     meint den Strich. Dieselbe Geste kennt Microsoft Journal, und so
     wurde sie auch gewünscht.

     >>> Woran sich beides unterscheidet <<<
     Am TEMPO der Hand, gemessen in Bildschirm-Pixeln je Millisekunde.
     Bewusst am Bildschirm und nicht am Blatt: eine Schlinge um dasselbe
     Wort ist beim Vergrössern die gleiche Handbewegung, auf dem Blatt
     aber ein kürzerer Weg. Geschrieben wird mit etwa 0,2–0,4, eine
     hingeworfene Schlinge liegt bei 1 und darüber.

     Tempo allein reicht nicht – ein schneller Zickzack wäre sonst auch
     eine Auswahl. Es müssen alle vier Dinge zusammenkommen:

       · schnell genug
       · GESCHLOSSEN – Anfang und Ende nah beieinander
       · halbwegs RUND – die Fläche muss zum Umfang passen; ein Gekritzel
         umschliesst fast nichts, egal wie lang es ist
       · und es muss etwas DRIN liegen

     Das letzte ist die wichtigste Bremse: eine Schlinge um nichts bleibt
     ein Strich. Wer wirklich einen Kreis malen will, malt ihn also aufs
     leere Blatt – und wenn er dabei etwas einschliesst, malt er langsam.
     ══════════════════════════════════════════════════════════════════ */
  const LASSO_TEMPO = 0.8;       // Bildschirm-Pixel je Millisekunde
  const LASSO_MIN_WEG = 120;     // Seiten-Pixel; darunter ist es ein Buchstabe
  const LASSO_MIN_KANTE = 24;    // Seiten-Pixel, kleinste Seite des Rechtecks
  const LASSO_LUECKE = 0.3;      // Anteil des Weges zwischen Anfang und Ende
  const LASSO_RUNDHEIT = 0.2;    // 4πA/U²: Kreis 1, Quadrat 0,79, Gekritzel ~0
  const LASSO_ANTEIL = 0.7;      // so viel eines Strichs muss innen liegen

  function wegLaenge(pts) {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return l;
  }

  /** Fläche des Vielecks nach Gauss – das Vorzeichen sagt den Umlaufsinn. */
  function flaeche(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(a / 2);
  }

  /** Liegt der Punkt im Vieleck? Strahlenverfahren. */
  function imVieleck(pts, x, y) {
    let drin = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) drin = !drin;
    }
    return drin;
  }

  /** Wie viel von diesem Strich liegt in der Schlinge? 0 bis 1. */
  function anteilDrin(stroke, schlinge) {
    const pts = stroke.path || [];
    if (!pts.length) return 0;
    let drin = 0;
    for (const p of pts) if (imVieleck(schlinge, p.x, p.y)) drin++;
    return drin / pts.length;
  }

  /** Alle Striche der Seite, die in der Schlinge liegen. */
  function imKreisGefangen(pageId, schlinge, ausser) {
    return (S.strokeHistory[pageId] || []).filter(s =>
      s !== ausser && !s.isEraser && !s._lasso && anteilDrin(s, schlinge) >= LASSO_ANTEIL);
  }

  /**
   * Alle Objekte der Seite, die in der Schlinge liegen.
   *
   * Gefragt wird die MITTE und die vier Ecken: ein Bild gilt als
   * eingekreist, wenn seine Mitte drin liegt und mindestens zwei Ecken.
   * Alle vier zu verlangen hiesse, dass man um jedes Bild großzügig
   * herumfahren muss – gemeint ist aber „das da", und dafür zieht man
   * eine Schlinge grob darum.
   */
  function objekteImKreis(pageId, schlinge) {
    const info = typeof getPage === 'function' ? getPage(pageId) : null;
    const liste = (info && info.page.objects) || [];
    return liste.filter(o => {
      const r = objRechteck(o);
      const mx = (r.minX + r.maxX) / 2, my = (r.minY + r.maxY) / 2;
      if (!imVieleck(schlinge, mx, my)) return false;
      const ecken = [[r.minX, r.minY], [r.maxX, r.minY], [r.minX, r.maxY], [r.maxX, r.maxY]];
      return ecken.filter(([x, y]) => imVieleck(schlinge, x, y)).length >= 2;
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     UND DER TEXT

     Text lässt sich nicht in dieselbe Hülle packen: er wird nicht
     verschoben, sondern markiert – das ist eine Auswahl anderer Art, und
     zwei gleichzeitig gäbe es in keinem Programm.

     Deshalb die Reihenfolge: liegt Gezeichnetes oder ein Objekt in der
     Schlinge, gilt die Hülle. Liegt darin NUR Text, wird er markiert –
     dann greifen Fett, Kursiv, Farbe und Kopieren wie gewohnt.

     Markiert wird von der ersten bis zur letzten eingeschlossenen
     Stelle, nicht Zeichen für Zeichen: eine Auswahl im Text ist immer
     zusammenhängend, und alles andere liesse sich gar nicht darstellen.
     ══════════════════════════════════════════════════════════════════ */
  function markiereTextImKreis(pageEl, schlinge) {
    const textDiv = pageEl.querySelector('.j-text');
    if (!textDiv || !schlinge.length) return false;

    const canvas = pageEl.querySelector('.j-canvas:not(.live-canvas)');
    const r = canvas && canvas.getBoundingClientRect();
    if (!r || !r.width) return false;
    const info = typeof getPage === 'function' ? getPage(pageEl.dataset.pgid) : null;
    const pw = (info && info.page.w) || CFG.PAGE_W;
    const ph = (info && info.page.h) || CFG.PAGE_H;

    // Bildschirm → Seite, dieselbe Rechnung wie canvas/input.js coords()
    const aufSeiteX = sx => (sx - r.left) * (pw / r.width);
    const aufSeiteY = sy => (sy - r.top) * (ph / r.height);

    const kasten = rohRechteck([{ path: schlinge }], null);

    let ersteStelle = null, letzteStelle = null;

    const walker = document.createTreeWalker(textDiv, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const laenge = (n.textContent || '').length;
      if (!laenge) continue;

      /* Erst grob: liegt der ganze Knoten neben der Schlinge, muss kein
         einziges Zeichen einzeln gemessen werden. Auf einer vollen Seite
         sind das ein paar tausend Rechtecke, die so gar nicht anfallen. */
      const grob = document.createRange();
      grob.selectNodeContents(n);
      const gr = grob.getBoundingClientRect();
      if (aufSeiteX(gr.right) < kasten.minX || aufSeiteX(gr.left) > kasten.maxX
          || aufSeiteY(gr.bottom) < kasten.minY || aufSeiteY(gr.top) > kasten.maxY) continue;

      for (let i = 0; i < laenge; i++) {
        const probe = document.createRange();
        probe.setStart(n, i);
        probe.setEnd(n, i + 1);
        const rect = probe.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        const mx = aufSeiteX(rect.left + rect.width / 2);
        const my = aufSeiteY(rect.top + rect.height / 2);
        if (!imVieleck(schlinge, mx, my)) continue;
        if (!ersteStelle) ersteStelle = { node: n, offset: i };
        letzteStelle = { node: n, offset: i + 1 };
      }
    }

    if (!ersteStelle || !letzteStelle) return false;

    try {
      const bereich = document.createRange();
      bereich.setStart(ersteStelle.node, ersteStelle.offset);
      bereich.setEnd(letzteStelle.node, letzteStelle.offset);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(bereich);
    } catch (err) {
      return false;
    }
    // Damit die Textwerkzeuge greifen, gehört das Werkzeug auf den Zeiger
    if (S.mode !== 'cursor' && typeof switchMode === 'function') switchMode('cursor');
    return true;
  }

  /**
   * Wählt aus, was in dieser Schlinge liegt – ohne jede Prüfung, ob sie
   * schnell oder rund genug war.
   *
   * Für den Lasso an der oberen Stifttaste (canvas/input.js): dort hat der
   * Nutzer die Absicht schon mit der Taste erklärt, da braucht es keine
   * Geste mehr, die sie errät.
   *
   * @returns {boolean} ob etwas gefunden wurde
   */
  function waehleEingekreiste(pageId, schlinge, ausser) {
    if (!schlinge || schlinge.length < 3) return false;
    const pageEl = document.querySelector('[data-pgid="' + CSS.escape(pageId) + '"]');
    if (!pageEl) return false;

    const striche = imKreisGefangen(pageId, schlinge, ausser || null);
    const objekte = objekteImKreis(pageId, schlinge);

    if (striche.length || objekte.length) return waehleStriche(pageId, striche, objekte);

    // Nichts Gezeichnetes drin? Dann vielleicht Text (siehe oben)
    abwaehlen(); versteckeLeiste();
    return markiereTextImKreis(pageEl, schlinge);
  }

  /** Legt den Auswahlrahmen um diese Striche und Objekte. */
  function waehleStriche(pageId, strokes, objekte) {
    const pageEl = document.querySelector('[data-pgid="' + CSS.escape(pageId) + '"]');
    if (!pageEl) return false;
    if (!(strokes && strokes.length) && !(objekte && objekte.length)) return false;
    abwaehlen();
    baueHuelle(pageEl, pageId, strokes, objekte);
    return true;
  }

  /**
   * Prüft einen fertigen Strich auf die Einkreis-Geste.
   *
   * Erkennt sie, nimmt sie den Strich aus der Seite heraus und wählt
   * stattdessen aus, was er umschlossen hat.
   *
   * @param {string} pageId
   * @param {object} stroke  der eben gezeichnete Strich
   * @param {number} dauer   Millisekunden vom Aufsetzen bis zum Abheben
   * @returns {boolean} ob der Strich als Auswahl verbraucht wurde
   */
  function versucheLasso(pageId, stroke, dauer) {
    const pts = stroke && stroke.path;
    if (!pts || pts.length < 8 || !(dauer > 0)) return false;

    const weg = wegLaenge(pts);
    if (weg < LASSO_MIN_WEG) return false;

    const zoom = typeof getZoom === 'function' ? getZoom() : 1;
    if ((weg * zoom) / dauer < LASSO_TEMPO) return false;

    const a = pts[0], b = pts[pts.length - 1];
    const luecke = Math.hypot(b.x - a.x, b.y - a.y);
    if (luecke > weg * LASSO_LUECKE) return false;

    const kasten = rohRechteck([stroke]);
    if (Math.min(kasten.maxX - kasten.minX, kasten.maxY - kasten.minY) < LASSO_MIN_KANTE) return false;

    const umfang = weg + luecke;
    if ((4 * Math.PI * flaeche(pts)) / (umfang * umfang) < LASSO_RUNDHEIT) return false;

    /* Liegt nichts darin, bleibt es ein Strich – das ist die wichtigste
       Bremse gegen ein versehentliches Auswählen. Gezeichnetes, Bilder
       und Text zählen gleichermassen; was davon gilt, entscheidet
       waehleEingekreiste(). */
    if (!waehleEingekreiste(pageId, pts, stroke)) return false;

    // Die Schlinge selbst ist nur die Geste – sie bleibt nicht stehen
    S.strokeHistory[pageId] = (S.strokeHistory[pageId] || []).filter(s => s !== stroke);
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════
     ANFASSEN

     In der Abfangphase am Seitenbereich, damit der Textbereich nicht
     zuerst drankommt.
     ══════════════════════════════════════════════════════════════════ */
  document.addEventListener('pointerdown', e => {
    // Nur der Zeiger wählt durch Antippen aus; die Werkzeuge zeichnen weiter
    if (S.mode !== 'cursor' || S.readOnly) return;
    /* >>> Der Stift wählt nicht aus, er malt <<<
       Seit er auch aus der Zeigerstellung heraus zeichnet (canvas/input.js),
       darf er hier nicht abgefangen werden. Diese Stelle läuft in der
       ABFANGPHASE und hält die Bewegung mit stopPropagation an – ein Stift,
       der auf einem Strich aufsetzte, kam damit nie beim Zeichnen an. Mit
       gedrückter Schafttaste hiess das: radieren ging überall, nur nicht
       dort, wo wirklich etwas steht. */
    if (e.pointerType === 'pen') return;
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
    if (_sel && !_sel.objekte.length && _sel.strokes.length === 1
        && _sel.strokes[0] === treffer) return;

    e.preventDefault();
    e.stopPropagation();
    /* Mit dem Finger reicht das nicht: der Klick, der aus der Berührung
       entsteht, käme trotzdem und setzte die Schreibmarke in die Zeile
       darunter – samt Bildschirmtastatur (canvas/input.js). */
    if (e.pointerType === 'touch' && typeof unterdrueckeTextTipp === 'function') {
      unterdrueckeTextTipp();
    }
    abwaehlen();
    baueHuelle(pageEl, pageId, [treffer]);
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
  window.versucheLasso = versucheLasso;
  window.waehleEingekreiste = waehleEingekreiste;
  window.waehleStriche = waehleStriche;
  window.strichBeiPunkt = strichUnter;
})();
