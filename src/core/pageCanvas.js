'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ZEICHENFLÄCHEN-VERWALTUNG FÜR GROSSE HEFTE

   Beim Öffnen eines Abschnitts werden alle Seiten ins DOM gelegt. Jede
   Seite hat eine eigene Zeichenfläche in voller Größe – bei 794×1123 und
   doppelter Bildschirmauflösung sind das über 14 MB pro Seite. Bei 50
   Seiten läuft der Speicher voll und die App wird zäh.

   Hier werden deshalb die Zeichenflächen weit entfernter Seiten geleert
   (Breite/Höhe auf 0) und beim Heranscrollen aus S.strokeHistory neu
   gezeichnet. Das DOM-Gerüst bleibt vollständig erhalten, damit alle
   Abfragen, Ereignisse und Layout-Berechnungen weiter funktionieren.
   ══════════════════════════════════════════════════════════════════════ */

const PageCanvases = {
  // Unter dieser Seitenzahl bleibt alles wie bisher – der Aufwand lohnt sich
  // erst bei vielen Seiten, und kleine Hefte sollen sich nicht ändern.
  MIN_PAGES: 8,

  // Wie weit über den sichtbaren Bereich hinaus Seiten geladen bleiben
  MARGIN_PX: 1500,

  _observer: null,
  _observed: new Set(),
  _enabled: false,

  reset() {
    if (this._observer) this._observer.disconnect();
    this._observer = null;
    this._observed.clear();
    this._enabled = false;
  },

  _ensureObserver() {
    if (this._observer) return this._observer;

    const root = E('pg-scroll');
    if (!root || typeof IntersectionObserver === 'undefined') return null;

    this._observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this._load(entry.target);
        else this._unload(entry.target);
      }
    }, { root, rootMargin: `${this.MARGIN_PX}px 0px` });

    return this._observer;
  },

  observe(pageEl) {
    if (!pageEl) return;
    this._observed.add(pageEl);

    // Erst ab genügend Seiten überhaupt einschalten
    if (!this._enabled && this._observed.size > this.MIN_PAGES) {
      this._enabled = true;
      const obs = this._ensureObserver();
      if (obs) this._observed.forEach(el => obs.observe(el));
      return;
    }

    if (this._enabled && this._observer) this._observer.observe(pageEl);
  },

  _canvasOf(pageEl) {
    return pageEl.querySelector('.j-canvas:not(.live-canvas)');
  },

  _load(pageEl) {
    const canvas = this._canvasOf(pageEl);
    if (!canvas || canvas.dataset.unloaded !== '1') return;

    const pgId = pageEl.dataset.pgid;
    const info = typeof getPage === 'function' ? getPage(pgId) : null;
    const targetW = info?.page?.w || CFG.PAGE_W;
    const targetH = info?.page?.h || CFG.PAGE_H;
    const dpr = getCanvasDpr();

    canvas.width = Math.round(targetW * dpr);
    canvas.height = Math.round(targetH * dpr);
    canvas.style.width = targetW + 'px';
    canvas.style.height = targetH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    delete canvas.dataset.unloaded;
    redrawStrokes(canvas, S.strokeHistory[pgId] || []);
  },

  _unload(pageEl) {
    const canvas = this._canvasOf(pageEl);
    if (!canvas || canvas.dataset.unloaded === '1') return;

    // Seite, auf der gerade gearbeitet wird, bleibt geladen
    const pgId = pageEl.dataset.pgid;
    if (S.activePgId === pgId) return;
    if (S.isDrawing) return;
    if (pageEl.contains(document.activeElement)) return;

    // Die Striche liegen in S.strokeHistory, es geht also nichts verloren.
    // Die CSS-Größe bleibt stehen, damit das Layout unverändert bleibt.
    canvas.dataset.unloaded = '1';
    canvas.width = 0;
    canvas.height = 0;
  },

  /** Stellt sicher, dass die Zeichenfläche einer Seite bereit ist. */
  ensure(pgId) {
    if (!this._enabled) return;
    const pageEl = E('pg-scroll')?.querySelector(`[data-pgid="${pgId}"]`);
    if (pageEl) this._load(pageEl);
  },

  isUnloaded(canvas) {
    return !!canvas && canvas.dataset.unloaded === '1';
  }
};

window.PageCanvases = PageCanvases;
