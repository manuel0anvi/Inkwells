'use strict';

/* ══════════════════════════════════════════════════════════════════════
   HANDSCHRIFT ALS VEKTOR – FÜR DEN AUSDRUCK

   >>> Gemeldet: „beim Exportieren ist Gezeichnetes pixelig, sobald man
   hineinzoomt“ <<<
   Beide Wege legten die Handschrift als RASTERBILD ins PDF: die App mit
   doppelter Auflösung (core/importExport.js), die Website sogar nur in
   der Auflösung des Bildschirms – auf einem Laptop also einfach. Wer im
   PDF-Betrachter hineinzoomt, sieht die Treppen.

   Hier wird daraus SVG: jeder Strich ein Pfad, genau so geformt wie auf
   dem Bildschirm (canvas/drawing.js, traceStrokePath – dieselben
   Quadratkurven durch die Mittelpunkte). Chromium schreibt das beim
   Drucken als Vektor ins PDF: scharf bei jedem Zoom, und die Datei wird
   dabei eher kleiner als groesser.

   ── Wie Marker und Radierer hier aussehen ──────────────────────────
     · MARKER: eine zusammenhaengende Folge liegt in EINER Gruppe mit 38 %
       Deckkraft. Die Gruppe wird als Ganzes durchsichtig – Stellen, an
       denen sich zwei Markerstriche kreuzen, werden also nicht dunkler.
       Genau das tut auf dem Bildschirm die Zwischenflaeche.
     · RADIERER: auf dem Bildschirm nimmt er Bildpunkte weg (destination-
       out). Die naheliegende Uebersetzung waere eine SVG-Maske – die
       rechnet Chromium beim Drucken aber in RASTERBILDER um: an einer
       Probeseite mit 20 Radierstrichen 44 Bilder und fast die dreifache
       Dateigroesse, also genau das Pixelige, um das es geht.
       Stattdessen werden die Striche, die VOR dem Radierer gezeichnet
       wurden, dort aufgetrennt, wo er darueberging. Uebrig bleiben
       Stuecke, jedes wieder ein Pfad – alles bleibt Vektor.

   Wird in die Website gespiegelt (scripts/sync-share.js) und dort beim
   Drucken benutzt (js/export-ui.js). Bearbeitet wird diese Fassung.
   ══════════════════════════════════════════════════════════════════════ */

(function (global) {
  const KOPF = 58;   // CFG.HDR in der App – im Seitenkopf steht nie ein Strich
  let _lauf = 0;     // Kennungen muessen im ganzen Dokument eindeutig sein

  const zahl = v => Math.round(v * 100) / 100;

  /* Die Farbe kommt aus einer Datei, bei einer Freigabe aus einer fremden.
     In ein Attribut darf deshalb nur, was wirklich eine Farbe ist. */
  function farbe(wert) {
    const s = String(wert || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    if (/^rgba?\(\s*[\d.\s,%]+\)$/i.test(s)) return s;
    return '#1a1510';
  }

  // Alte Hefte speichern die Punkte unter „points" und die Breite unter „size"
  function punkte(s) {
    const roh = Array.isArray(s.path) ? s.path : (Array.isArray(s.points) ? s.points : []);
    return roh.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  }

  function breite(s) {
    const b = Number(s.width || s.size || 2);
    return Number.isFinite(b) && b > 0 ? b : 2;
  }

  const istMarker = s => !!(s.isHL || s.isHighlighter);

  /* ══ RADIEREN OHNE MASKE ═════════════════════════════════════════════
     Ein Punkt eines Strichs faellt weg, wenn er naeher am Weg des
     Radierers liegt als dessen halbe Breite plus ein Viertel der Breite
     des Strichs. Warum dieses Mass: ein uebrig gebliebenes Stueck endet
     mit einer runden Kappe, die um die halbe Strichbreite ueber seinen
     letzten Punkt hinausreicht. Mit der vollen halben Breite laege die
     Kante bei einem Querstrich genau am Rand des Radierers – ein Radierer,
     der eine Linie nur am Rand streift, wuerde sie dann aber ganz
     durchtrennen, wo der Bildschirm sie nur duenner macht. Die Haelfte
     ist der Ausgleich zwischen beiden; der Unterschied liegt bei einem
     gewoehnlichen Stift unter anderthalb Punkten.

     Zwischen zwei weit auseinanderliegenden Punkten koennte der Radierer
     hindurchgehen, ohne einen zu treffen. In seiner Naehe wird der Weg
     deshalb vorher verdichtet. */
  function abstandZuStrecke(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function abstandZumRadierer(p, rp) {
    if (rp.length === 1) return Math.hypot(p.x - rp[0].x, p.y - rp[0].y);
    let d = Infinity;
    for (let i = 0; i < rp.length - 1; i++) {
      const e = abstandZuStrecke(p.x, p.y, rp[i].x, rp[i].y, rp[i + 1].x, rp[i + 1].y);
      if (e < d) d = e;
    }
    return d;
  }

  function radiere(teile, radierer) {
    const rp = punkte(radierer);
    if (!rp.length) return;
    const rh = breite(radierer) / 2;
    let kx0 = Infinity, ky0 = Infinity, kx1 = -Infinity, ky1 = -Infinity;
    for (const p of rp) {
      if (p.x < kx0) kx0 = p.x; if (p.x > kx1) kx1 = p.x;
      if (p.y < ky0) ky0 = p.y; if (p.y > ky1) ky1 = p.y;
    }
    const schritt = Math.max(0.5, Math.min(2, rh / 2));

    for (const teil of teile) {
      const grenze = rh + breite(teil.s) / 4;
      const bx0 = kx0 - grenze, by0 = ky0 - grenze, bx1 = kx1 + grenze, by1 = ky1 + grenze;
      const imKasten = p => p.x >= bx0 && p.x <= bx1 && p.y >= by0 && p.y <= by1;
      const trifft = p => imKasten(p) && abstandZumRadierer(p, rp) < grenze;
      const neu = [];

      for (const stueck of teil.stuecke) {
        // Liegt nichts davon im Kasten des Radierers, bleibt es, wie es ist
        let nah = false;
        for (let i = 0; i < stueck.length && !nah; i++) {
          if (imKasten(stueck[i])) nah = true;
          else if (i && (Math.min(stueck[i - 1].x, stueck[i].x) <= bx1 && Math.max(stueck[i - 1].x, stueck[i].x) >= bx0
            && Math.min(stueck[i - 1].y, stueck[i].y) <= by1 && Math.max(stueck[i - 1].y, stueck[i].y) >= by0)) nah = true;
        }
        if (!nah) { neu.push(stueck); continue; }

        let geschnitten = false;
        let aktuell = [];
        const nimm = (p) => {
          if (trifft(p)) {
            geschnitten = true;
            if (aktuell.length) neu.push(aktuell);
            aktuell = [];
          } else aktuell.push(p);
        };
        for (let i = 0; i < stueck.length; i++) {
          if (i) {
            const a = stueck[i - 1], b = stueck[i];
            const l = Math.hypot(b.x - a.x, b.y - a.y);
            if (l > schritt && (imKasten(a) || imKasten(b) || l > grenze)) {
              const n = Math.ceil(l / schritt);
              for (let k = 1; k < n; k++) nimm({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
            }
          }
          nimm(stueck[i]);
        }
        // Nichts getroffen: das Original behalten, ohne die eingefuegten Zwischenpunkte
        if (!geschnitten) { neu.push(stueck); continue; }
        if (aktuell.length) neu.push(aktuell);
      }
      teil.stuecke = neu;
    }
  }

  /** Der Weg eines Stücks – dieselbe Form wie traceStrokePath. */
  function weg(gerade, pts) {
    let d = 'M' + zahl(pts[0].x) + ' ' + zahl(pts[0].y);
    if (gerade) {
      for (let i = 1; i < pts.length; i++) d += 'L' + zahl(pts[i].x) + ' ' + zahl(pts[i].y);
      return d;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      d += 'Q' + zahl(pts[i].x) + ' ' + zahl(pts[i].y) + ' ' + zahl(mx) + ' ' + zahl(my);
    }
    const z = pts[pts.length - 1];
    return d + 'L' + zahl(z.x) + ' ' + zahl(z.y);
  }

  /** Ein Strich (alle seine Stücke) als SVG – ein einzelner Punkt als Tupfer. */
  function elemente(teil) {
    const s = teil.s;
    const b = breite(s);
    const f = farbe(s.color);
    const alpha = Number(s.alpha);
    const op = !istMarker(s) && Number.isFinite(alpha) && alpha > 0 && alpha < 1 ? ' opacity="' + zahl(alpha) + '"' : '';
    let aus = '';
    for (const pts of teil.stuecke) {
      if (!pts.length) continue;
      if (pts.length === 1) {
        aus += '<circle cx="' + zahl(pts[0].x) + '" cy="' + zahl(pts[0].y) + '" r="' + zahl(b / 2) + '" fill="' + f + '"' + op + '/>';
      } else {
        aus += '<path d="' + weg(!!s.isGeometric, pts) + '" fill="none" stroke="' + f + '" stroke-width="' + zahl(b)
          + '" stroke-linecap="round" stroke-linejoin="round"' + op + '/>';
      }
    }
    return aus;
  }

  /**
   * Die Striche einer Seite als SVG.
   *
   * @param {Array} strokes   page.inkStrokes
   * @param {number} w        Seitenbreite
   * @param {number} h        Seitenhöhe
   * @param {object} [opt]
   * @param {string} [opt.klasse]  class-Attribut für das <svg>
   * @returns {string} leer, wenn es nichts zu zeichnen gibt
   */
  function inkSvg(strokes, w, h, opt = {}) {
    const liste = Array.isArray(strokes) ? strokes.filter(Boolean) : [];

    // Erst radieren: was übrig bleibt, sind Stücke in der alten Reihenfolge
    const teile = [];
    let bruch = false;   // ein Radierer trennt eine Markerfolge wie auf dem Bildschirm
    for (const s of liste) {
      if (s.isEraser) { radiere(teile, s); bruch = true; continue; }
      const pts = punkte(s);
      if (!pts.length) continue;
      teile.push({ s, stuecke: [pts], neueFolge: bruch });
      bruch = false;
    }
    if (!teile.some(t => t.stuecke.some(p => p.length))) return '';

    let inhalt = '';
    let i = 0;
    while (i < teile.length) {
      if (istMarker(teile[i].s)) {
        let gruppe = elemente(teile[i]);
        i++;
        while (i < teile.length && istMarker(teile[i].s) && !teile[i].neueFolge) { gruppe += elemente(teile[i]); i++; }
        if (gruppe) inhalt += '<g opacity=".38">' + gruppe + '</g>';
        continue;
      }
      inhalt += elemente(teile[i]);
      i++;
    }

    const kopf = 'ink' + (++_lauf) + '_kopf';
    const klasse = opt.klasse ? ' class="' + String(opt.klasse).replace(/[^\w -]/g, '') + '"' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg"' + klasse + ' viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '"'
      + ' preserveAspectRatio="none" aria-hidden="true">'
      + '<defs><clipPath id="' + kopf + '"><rect x="0" y="' + KOPF + '" width="' + w + '" height="' + Math.max(0, h - KOPF) + '"/></clipPath></defs>'
      + '<g clip-path="url(#' + kopf + ')">' + inhalt + '</g></svg>';
  }

  global.InkSvg = { svg: inkSvg };
})(typeof window !== 'undefined' ? window : globalThis);
