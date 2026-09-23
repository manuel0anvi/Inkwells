'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DIE ROLLLEISTE DER BLATTSPALTE

   >>> Gemeldet: „wenn ich mit dem Stift schreibe und mit der Hand aus
   Versehen an die Scrollleiste komme, rollt es weg von der Stelle, an
   der ich gerade schreibe" <<<

   Die Handballensperre (core/state.js, app.js) hilft dort nicht, und
   das liegt nicht an ihr: eine Beruehrung, die auf dem Rollbalken des
   Browsers landet, bekommt die Seite ueberhaupt nicht zu sehen. Chromium
   leitet sie am Seitenskript vorbei direkt an den Balken
   (PointerEventManager, HandleScrollbarTouchDrag) – kein touchstart,
   kein pointerdown, nichts, woran sich ein preventDefault haengen liesse.

   Deshalb ist der Balken des Browsers aus (css/layout.css) und dieser
   hier an seiner Stelle. Er sieht aus wie vorher, rollt wie vorher –
   aber er fragt, WER ihn anfasst: eine Beruehrung, waehrend der Stift auf
   oder ueber dem Bildschirm ist, ist die Hand und bewegt nichts.

   Und wie in app.js (DIE HAND, DIE VOR DEM STIFT DA WAR): setzt die Hand
   zuerst auf und meldet sich der Stift erst danach, kommt die Ansicht
   dorthin zurueck, wo sie beim Aufsetzen war.

   Zwei Leisten, eine Rechnung: senkrecht immer, waagerecht nur, wenn die
   Seite breiter ist als die Spalte (core/zoom.js schaltet overflow-x).
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const sc = E('pg-scroll');
  const spalte = sc && sc.parentElement;
  if (!sc || !spalte) return;

  const MIN_GRIFF = 32;   // kleiner wird der Griff nicht, sonst trifft ihn keiner

  /** Die Hand liegt auf – der Stift ist da oder war es gerade eben. */
  function istHand(e) {
    if (e.pointerType !== 'touch') return false;
    return (typeof stiftInDerNaehe === 'function' && stiftInDerNaehe())
      || (typeof penIsActive === 'function' && penIsActive());
  }

  function baue(senkrecht) {
    const A = senkrecht
      ? { pos: 'scrollTop', gesamt: 'scrollHeight', sicht: 'clientHeight', maus: 'clientY', seite: 'top', groesse: 'height' }
      : { pos: 'scrollLeft', gesamt: 'scrollWidth', sicht: 'clientWidth', maus: 'clientX', seite: 'left', groesse: 'width' };

    const leiste = document.createElement('div');
    leiste.className = 'rollleiste ' + (senkrecht ? 'senkrecht' : 'waagerecht');
    leiste.setAttribute('aria-hidden', 'true');
    const griff = document.createElement('div');
    griff.className = 'rollleiste-griff';
    leiste.appendChild(griff);
    spalte.appendChild(leiste);

    let griffLaenge = 0, bahn = 0;

    /** Lage und Grösse an Spalte und Rollstand anpassen. */
    function stelle() {
      const gesamt = sc[A.gesamt], sicht = sc[A.sicht];
      const noetig = gesamt > sicht + 1
        && (senkrecht || sc.style.overflowX === 'auto');
      leiste.style.display = noetig ? '' : 'none';
      if (!noetig) return;

      // Die Leiste deckt genau den Rand der Blattspalte, nicht der ganzen Spalte
      if (senkrecht) {
        leiste.style.top = sc.offsetTop + 'px';
        leiste.style.height = sc.clientHeight + 'px';
      } else {
        leiste.style.left = sc.offsetLeft + 'px';
        leiste.style.width = sc.clientWidth + 'px';
        leiste.style.top = (sc.offsetTop + sc.clientHeight - leiste.offsetHeight) + 'px';
      }
      bahn = senkrecht ? sc.clientHeight : sc.clientWidth;
      griffLaenge = Math.max(MIN_GRIFF, Math.round(bahn * sicht / gesamt));
      const weg = Math.max(1, gesamt - sicht);
      const lage = (bahn - griffLaenge) * Math.min(1, Math.max(0, sc[A.pos] / weg));
      griff.style[A.groesse] = griffLaenge + 'px';
      griff.style.transform = senkrecht ? `translateY(${lage}px)` : `translateX(${lage}px)`;
    }

    /* ── Ziehen ────────────────────────────────────────────────────── */
    let zug = null;   // { id, typ, von, start, anfang }

    function rolleAufPunkt(e) {
      const r = leiste.getBoundingClientRect();
      const gesamt = sc[A.gesamt], sicht = sc[A.sicht];
      const anteil = (e[A.maus] - r[A.seite] - griffLaenge / 2) / Math.max(1, bahn - griffLaenge);
      sc[A.pos] = Math.min(1, Math.max(0, anteil)) * (gesamt - sicht);
    }

    leiste.addEventListener('pointerdown', e => {
      // Die Hand beim Schreiben: nichts rollen, nichts weiterreichen
      if (istHand(e)) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const aufGriff = e.target === griff;
      const anfang = { oben: sc.scrollTop, links: sc.scrollLeft };

      /* Mit der Maus neben den Griff: eine Bildschirmseite weiter, wie
         bei jedem Rollbalken unter Windows. Mit Finger und Stift springt
         der Griff dorthin – eine Seite je Tipp waere dort muehsam. */
      if (!aufGriff && e.pointerType === 'mouse') {
        const r = griff.getBoundingClientRect();
        const richtung = e[A.maus] < r[A.seite] ? -1 : 1;
        sc[A.pos] += richtung * sc[A.sicht] * 0.9;
        return;
      }
      if (!aufGriff) rolleAufPunkt(e);

      zug = { id: e.pointerId, typ: e.pointerType, von: e[A.maus], start: sc[A.pos], anfang };
      try { leiste.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      leiste.classList.add('zieht');
    });

    leiste.addEventListener('pointermove', e => {
      if (!zug || e.pointerId !== zug.id) return;
      const gesamt = sc[A.gesamt], sicht = sc[A.sicht];
      const proPixel = (gesamt - sicht) / Math.max(1, bahn - griffLaenge);
      sc[A.pos] = zug.start + (e[A.maus] - zug.von) * proPixel;
    });

    function zugEnde(e) {
      if (!zug || (e && e.pointerId !== zug.id)) return;
      try { leiste.releasePointerCapture(zug.id); } catch (err) { /* egal */ }
      zug = null;
      leiste.classList.remove('zieht');
    }
    leiste.addEventListener('pointerup', zugEnde);
    leiste.addEventListener('pointercancel', zugEnde);

    /* Die Hand war zuerst da, jetzt meldet sich der Stift: dann war der
       Zug keiner. Zurueck an den Anfang, und der Rest zaehlt nicht. */
    document.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'pen' || !zug || zug.typ !== 'touch') return;
      sc.scrollTop = zug.anfang.oben;
      sc.scrollLeft = zug.anfang.links;
      zugEnde();
    }, { capture: true, passive: true });

    return stelle;
  }

  const stellen = [baue(true), baue(false)];

  let geplant = 0;
  function planeStellen() {
    if (geplant) return;
    geplant = requestAnimationFrame(() => {
      geplant = 0;
      for (const s of stellen) s();
    });
  }

  sc.addEventListener('scroll', planeStellen, { passive: true });
  window.addEventListener('resize', planeStellen, { passive: true });
  window.addEventListener('inkwells:zoom', planeStellen);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(planeStellen);
    ro.observe(sc);
    const pw = E('pages-wrap');
    if (pw) ro.observe(pw);
  }
  /* Die Rollhoehe haengt am unteren Rand von #pages-wrap (core/zoom.js,
     passeRollhoeheAn) und an overflow-x der Spalte. Beides steht im
     style-Attribut, und das meldet kein ResizeObserver. */
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(planeStellen);
    mo.observe(sc, { attributes: true, attributeFilter: ['style'] });
    const pw = E('pages-wrap');
    if (pw) mo.observe(pw, { attributes: true, attributeFilter: ['style'], childList: true });
  }
  planeStellen();

  window.stelleRollleiste = planeStellen;
})();
