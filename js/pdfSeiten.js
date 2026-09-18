/* ══════════════════════════════════════════════════════════════════════
   ⚠  ERZEUGTE DATEI – NICHT HIER BEARBEITEN

   Wortgleiche Kopie von src/core/pdfSeiten.js. Die App wird ohne den
   Ordner website/ ausgeliefert (siehe electron-builder.config.js),
   deshalb braucht die Website ein eigenes Exemplar.

   Änderungen gehören nach src/core/pdfSeiten.js. Danach:
       npm run sync-share
   Vor dem Veröffentlichen der Website läuft das von selbst.
   ══════════════════════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════════════════════════
   PDF-SEITEN IM HEFT

   >>> Warum eine Seite kein Bild mehr ist <<<
   Ein eingefügtes PDF wurde bisher beim Import einmal zu JPEGs gerechnet
   – anderthalbfache Größe, Güte 0,65 – und die Datei danach weggeworfen.
   Damit stand für jede Seite ein für alle Mal fest, wie scharf sie sein
   kann: 892 Bildpunkte für ein A4-Blatt, das auf einem Schirm mit dpr
   1,5 schon bei 100 % 1191 bräuchte. Beim Zoomen wurde es schlimmer, im
   Ausdruck blieben 108 dpi, und zurücknehmen liess sich nichts – das
   Original war weg.

   Jetzt liegt das PDF EINMAL im Heft, und eine Seite ist nur noch ein
   Verweis darauf:

     nb.pdfs = { "<kennung>": { name, daten } }   daten = base64, ohne Kopf
     page.pdfRef = { datei: "<kennung>", seite: 3 }

   Gezeichnet wird beim Ansehen, in der Auflösung, die der Zoom gerade
   verlangt – dieselbe Rechnung wie für die Handschrift daneben
   (getCanvasDpr, core/zoom.js). Zoomt jemand hinein, wird die Seite neu
   gezeichnet statt aufgezogen.

   Nebenbei wird das Heft kleiner: ein Skript mit Vektortext trägt seine
   300 Seiten in wenigen Megabyte, die 300 JPEGs waren 45.

   ── Was NACH AUSSEN geht, bleibt ein Bild ──────────────────────────
   Freigabe, Live-Bearbeitung, Word- und PDF-Export lesen weiterhin
   page.bgImg. Für sie wird die Seite vorher gezeichnet (materialisiere,
   bild). Der Empfänger eines geteilten Hefts, die Web-Ansicht und ein
   älterer Stand der App brauchen dafür nichts zu wissen – und der
   Empfänger bekommt dabei mehr Punkte als früher, nicht weniger.

   ── Ältere Hefte ───────────────────────────────────────────────────
   Wer schon PDF-Seiten hat, behält sie: eine Seite mit `bgImg` und ohne
   `pdfRef` läuft überall den alten Weg. Nachschärfen lässt sie sich
   nicht – dafür fehlt das Original.
   ══════════════════════════════════════════════════════════════════════ */

const PdfSeiten = {
  /* Höchstens dreifache Auflösung. getCanvasDpr() geht bis 6; ein ganzes
     Blatt in dieser Feinheit wären 4764 × 6740 Punkte, also gut 120 MB –
     je Seite, und es sind immer mehrere geladen. Bei 3 liegt eine
     PDF-Seite in derselben Größenordnung wie die Zeichenfläche darüber. */
  MAX_FEINHEIT: 3,

  /* Womit eine Seite für Ausdruck und Word gerechnet wird. 3 × 794 sind
     2382 Punkte auf 210 mm, also rund 290 dpi – Druckauflösung. */
  DRUCK_FEINHEIT: 3,

  /* Und was ein geteiltes Dokument bekommt. Weniger als für den Druck,
     weil es über die Leitung geht und beim anderen im Speicher liegt –
     aber immer noch fast doppelt so viel wie die 892 Punkte von früher. */
  FREIGABE_FEINHEIT: 2,

  _docs: new Map(),     // "heftId/pdfId" -> Promise<pdf.js-Dokument>
  _nbId: null,

  /** Beim Heftwechsel: die Dokumente des vorigen Hefts freigeben. */
  reset(nbId) {
    if (String(nbId || '') === String(this._nbId || '')) return;
    for (const p of this._docs.values()) {
      Promise.resolve(p).then(d => { try { d && d.destroy(); } catch (err) { /* egal */ } },
        () => { /* nie geladen */ });
    }
    this._docs.clear();
    this._nbId = nbId ? String(nbId) : null;
  },

  /** Hat diese Seite ihr Bild aus einem PDF im Heft? */
  hat(page) {
    return !!(page && page.pdfRef && page.pdfRef.datei);
  },

  /**
   * Legt ein PDF ins Heft und gibt seine Kennung zurück.
   *
   * Dieselbe Datei zweimal einzufügen legt sie nicht zweimal ab – bei
   * einem Buch wäre das der Unterschied zwischen 40 und 80 MB. Verglichen
   * wird der Inhalt, nicht der Name: derselbe Scan unter zwei Namen ist
   * dieselbe Datei.
   */
  lege(nb, base64, name) {
    if (!nb || !base64) return '';
    if (!nb.pdfs || typeof nb.pdfs !== 'object') nb.pdfs = {};
    for (const [id, eintrag] of Object.entries(nb.pdfs)) {
      if (eintrag && eintrag.daten === base64) return id;
    }
    const id = (typeof uid === 'function' ? uid() : 'p' + Date.now().toString(36));
    nb.pdfs[id] = { name: String(name || '').slice(0, 120), daten: base64 };
    return id;
  },

  /**
   * Räumt PDFs weg, auf die keine Seite mehr zeigt.
   *
   * Ohne das bliebe ein 40-MB-Buch für immer im Heft, nachdem seine
   * Seiten gelöscht wurden – unsichtbar, aber bei jedem Speichern und
   * jedem Abgleich dabei.
   */
  raeumeAuf(nb) {
    if (!nb || !nb.pdfs) return;
    const gebraucht = new Set();
    for (const p of (nb.pages || [])) {
      if (this.hat(p)) gebraucht.add(String(p.pdfRef.datei));
    }
    let weg = 0;
    for (const id of Object.keys(nb.pdfs)) {
      if (!gebraucht.has(id)) { delete nb.pdfs[id]; weg++; }
    }
    if (weg) console.log('[PDF-Seite]', weg, 'nicht mehr gebrauchte Datei(en) weggeräumt');
    if (!Object.keys(nb.pdfs).length) delete nb.pdfs;
  },

  /** Das pdf.js-Dokument zu einer Kennung – beim ersten Bedarf geladen. */
  doc(nb, pdfId) {
    if (!nb || !pdfId || typeof pdfjsLib === 'undefined') return Promise.resolve(null);
    this.reset(nb.id);
    const schluessel = String(nb.id) + '/' + String(pdfId);
    if (this._docs.has(schluessel)) return this._docs.get(schluessel);

    const eintrag = nb.pdfs && nb.pdfs[pdfId];
    if (!eintrag || !eintrag.daten) return Promise.resolve(null);

    const geladen = (async () => {
      /* Eine eigene Kopie der Bytes: pdf.js darf den Puffer übernehmen
         und leeren, und die Zeichenkette im Heft brauchen wir noch. */
      const roh = window.atob(eintrag.daten);
      const bytes = new Uint8Array(roh.length);
      for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
      // Kein eval – die Begruendung steht in core/importExport.js
      return pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    })();

    this._docs.set(schluessel, geladen);
    geladen.catch(err => {
      console.warn('[PDF-Seite] Datei nicht lesbar:', err?.message || err);
      this._docs.delete(schluessel);
    });
    return geladen;
  },

  /** Wie fein gezeichnet wird – der Zoom steckt schon darin. */
  feinheit() {
    const roh = (typeof getCanvasDpr === 'function') ? getCanvasDpr() : 2.5;
    return Math.min(roh, this.MAX_FEINHEIT);
  },

  /**
   * Zeichnet die Seite in die Hintergrundfläche ihres Seiten-Elements.
   *
   * >>> Warum eine zweite Fläche und kein Austausch der ersten <<<
   * Eine Leinwand zu vergrössern löscht sie. Beim Zoomen stünde das
   * Blatt deshalb einen Augenblick leer da, und zwar genau in dem
   * Moment, in dem man hinsieht. Gezeichnet wird darum daneben, und erst
   * die fertige Fläche tritt an die Stelle der alten.
   */
  async zeichne(pgEl, page) {
    if (!pgEl || !this.hat(page)) return;
    const alt = pgEl.querySelector('canvas.j-page-bgcanvas');
    if (!alt) return;

    const nb = typeof getNb === 'function' ? getNb() : null;
    if (!nb) return;

    const breiteCss = page.w || CFG.PAGE_W;
    const ziel = Math.round(breiteCss * this.feinheit());
    // Steht schon in dieser Feinheit da: dann gibt es nichts zu tun
    if (alt.width && Math.abs((alt._beiBreite || 0) - ziel) < 8) return;

    /* Wer zuletzt kam, gewinnt. Beim schnellen Zoomen laufen sonst zwei
       Aufträge, und der langsamere überschreibt am Ende den neueren. */
    const marke = (pgEl._pdfMarke = (pgEl._pdfMarke || 0) + 1);

    try {
      const doc = await this.doc(nb, page.pdfRef.datei);
      if (!doc || marke !== pgEl._pdfMarke) return;

      const nr = Math.min(Math.max(1, Number(page.pdfRef.seite) || 1), doc.numPages);
      const seite = await doc.getPage(nr);
      if (marke !== pgEl._pdfMarke) return;

      const roh = seite.getViewport({ scale: 1 });
      const viewport = seite.getViewport({ scale: ziel / roh.width });

      const neu = document.createElement('canvas');
      neu.className = alt.className;
      neu.style.cssText = alt.style.cssText;
      neu.width = Math.max(1, Math.round(viewport.width));
      neu.height = Math.max(1, Math.round(viewport.height));

      const ctx = neu.getContext('2d');
      /* Weiss unterlegen: ein PDF färbt nur, was daraufsteht, und eine
         leere Leinwand ist durchsichtig – das Papiermuster schiene sonst
         durch die Seite. */
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, neu.width, neu.height);
      await seite.render({ canvasContext: ctx, viewport }).promise;
      if (marke !== pgEl._pdfMarke) return;

      neu._beiBreite = ziel;
      alt.replaceWith(neu);
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      console.warn('[PDF-Seite] Seite nicht gezeichnet:', err?.message || err);
    }
  },

  /**
   * Gibt die Fläche einer weit entfernten Seite frei.
   *
   * Dasselbe Verfahren wie bei den Zeichenflächen (core/pageCanvas.js):
   * das Element bleibt stehen, damit sich am Layout nichts ändert, nur
   * die Bildpunkte verschwinden.
   */
  entlaste(pgEl) {
    const c = pgEl && pgEl.querySelector('canvas.j-page-bgcanvas');
    if (!c || !c.width) return;
    pgEl._pdfMarke = (pgEl._pdfMarke || 0) + 1;   // laufende Aufträge verwerfen
    c.width = 0;
    c.height = 0;
    c._beiBreite = 0;
  },

  /**
   * Ein Bild dieser Seite, als data-URL – für alles, was kein PDF lesen
   * kann: Ausdruck, Word, Freigabe, Live-Bearbeitung.
   *
   * @param {number} feinheit  Bildpunkte je Punkt der Heftseite
   */
  async bild(nb, page, feinheit) {
    if (!this.hat(page)) return page && page.bgImg ? page.bgImg : '';
    const doc = await this.doc(nb, page.pdfRef.datei);
    if (!doc) return '';

    const nr = Math.min(Math.max(1, Number(page.pdfRef.seite) || 1), doc.numPages);
    const seite = await doc.getPage(nr);
    const roh = seite.getViewport({ scale: 1 });
    const breiteCss = page.w || CFG.PAGE_W;
    const viewport = seite.getViewport({ scale: (breiteCss * feinheit) / roh.width });

    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(viewport.width));
    c.height = Math.max(1, Math.round(viewport.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    await seite.render({ canvasContext: ctx, viewport }).promise;

    /* JPEG mit ordentlicher Güte statt der früheren 0,65: bei Text
       erzeugt eine niedrige Güte Ringe an den Buchstabenkanten, und
       genau die liest man als „unscharf", auch wenn die Auflösung
       stimmt. Derselbe Wert wie beim Verkleinern eingefügter Bilder
       (core/importExport.js). */
    return c.toDataURL('image/jpeg', 0.82);
  },

  /**
   * Alle PDF-Seiten eines Hefts als Bilder – in einer Karte, nicht am
   * Heft. Für Ausdruck und Word: die brauchen die Bilder nur für diesen
   * einen Vorgang, und in Druckauflösung dauerhaft an der Seite wären
   * sie genau das, was hier abgeschafft werden sollte.
   */
  async bilderFuer(nb, feinheit) {
    const karte = new Map();
    if (!nb || !Array.isArray(nb.pages)) return karte;
    for (const page of nb.pages) {
      if (!this.hat(page)) continue;
      try {
        const url = await this.bild(nb, page, feinheit || this.DRUCK_FEINHEIT);
        if (url) karte.set(page.id, url);
      } catch (err) {
        console.warn('[PDF-Seite] Seite', page.id, 'nicht gerechnet:', err?.message || err);
      }
    }
    return karte;
  },

  /**
   * Legt allen PDF-Seiten eines Hefts ihr Bild bei.
   *
   * Gebraucht vor allem, was das Heft VERLÄSST. Das Ergebnis bleibt an
   * der Seite stehen: die Live-Bearbeitung vergleicht Seiten über die
   * Länge von bgImg (ui/collab.js), und ein Wert, der sich bei jedem
   * Abgleich neu ergäbe, sähe dort wie eine Änderung aus – jede Seite
   * ginge bei jedem Takt erneut über die Leitung.
   */
  async materialisiere(nb, feinheit) {
    if (!nb || !Array.isArray(nb.pages)) return 0;
    let wie = 0;
    for (const page of nb.pages) {
      if (!this.hat(page) || page.bgImg) continue;
      try {
        const url = await this.bild(nb, page, feinheit || this.FREIGABE_FEINHEIT);
        if (url) { page.bgImg = url; wie++; }
      } catch (err) {
        console.warn('[PDF-Seite] Seite', page.id, 'nicht gerechnet:', err?.message || err);
      }
    }
    if (wie) console.log('[PDF-Seite]', wie, 'Seite(n) als Bild beigelegt');
    return wie;
  }
};

window.PdfSeiten = PdfSeiten;
