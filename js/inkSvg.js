/* ══════════════════════════════════════════════════════════════════════
   ⚠  ERZEUGTE DATEI – NICHT HIER BEARBEITEN

   Wortgleiche Kopie von src/core/inkSvg.js. Die App wird ohne den
   Ordner website/ ausgeliefert (siehe electron-builder.config.js),
   deshalb braucht die Website ein eigenes Exemplar.

   Änderungen gehören nach src/core/inkSvg.js. Danach:
       npm run sync-share
   Vor dem Veröffentlichen der Website läuft das von selbst.
   ══════════════════════════════════════════════════════════════════════ */

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

  /* ══════════════════════════════════════════════════════════════════════
     DRUCK MACHT DEN STRICH DICKER – WIE IN WORD

     >>> Gemeldet: „nicht so smooth wie in Word, und mit Druck soll die
     Linie stärker werden" <<<
     Word zeichnet über Windows Ink, und das tut von Haus aus zweierlei
     (DrawingAttributes): die Breite folgt dem Druck (IgnorePressure ist
     aus), und der Weg wird als Kurve gelegt statt als Kette von Strecken
     (FitToCurve). Die Kurve hatten wir schon; der Druck wurde zwar
     gemessen, aber nirgends gezeichnet – ein Strich war überall gleich
     dick, und genau das lässt Handschrift nach Plotter aussehen.

     >>> Warum ein Umriss und nicht viele kurze Striche <<<
     Eine Canvas-Linie hat EINE Breite. Die naheliegende Abhilfe – jedes
     Stück einzeln mit eigener Breite – malt an jeder Naht die geglätteten
     Randpixel zweimal, und genau davon war die dünne Schrift schon einmal
     fleckig (canvas/input.js, stiftVorschau). Hier entsteht deshalb die
     FLÄCHE des Strichs und wird in einem Zug gefüllt: eine Kantenglättung,
     keine Naht.

     Die Fläche ist die Vereinigung aus
       · je Stück dem Trapez, das zwei aufeinanderfolgende Kreise berührt
         (ein Kreis je Abtastpunkt, Radius aus dem Druck),
       · je Naht zwei Dreiecken vom Mittelpunkt zu den Ecken beider
         Trapeze. Biegt der Weg, gehen die Trapeze an der Aussenseite
         auseinander wie Fächerblätter; ohne die Dreiecke blieb dort ein
         Keil leer, und an jeder Kurve standen feine helle Haare ab,
       · Kreisen an den Enden und überall, wo der Weg so scharf abknickt,
         dass auch das Dreieck den Bogen nicht mehr deckt.
     Alle Teile laufen im selben Drehsinn, die Füllregel „nonzero" legt
     sie also ohne Löcher übereinander – auch dort, wo sich der Strich
     selbst kreuzt oder in einer engen Schleife umkehrt. Ein Umriss aus
     linkem und rechtem Rand, wie ihn manche Zeichenprogramme legen,
     klappt dort auf der Innenseite um und stanzt Löcher in die Schrift.

     >>> Welche Striche ihn bekommen <<<
     Nur Stiftstriche, deren Druck sich wirklich ändert. Marker und
     Radierer bleiben gleich breit wie in Word; Maus und Finger melden
     keinen Druck. Ein Strich ohne Druckwerte sieht damit Punkt für Punkt
     aus wie bisher – alte Hefte ändern sich nicht.

     Dieselbe Regel steht in core/data.js (strichHatDruck): dort wird
     entschieden, ob der Druck mitgespeichert wird. Doppelt, weil diese
     Datei auch auf der Website läuft, wo es data.js nicht gibt.
     ══════════════════════════════════════════════════════════════════════ */
  const DRUCK_SPANNE = 0.05;   // darunter gilt der Druck als gleichbleibend
  const ABTAST_SCHRITT = 3;    // Seitenpunkte zwischen zwei Kreisen höchstens
  const KNICK = 0.3;           // Bogenmaß; darüber bekommt die Naht einen Kreis

  /* >>> Warum 0,35 die Mitte ist und nicht 0,5 <<<
     Nachgemessen an drei Millionen Punkten aus echten Heften: beim
     gewöhnlichen Schreiben drückt die Hand um 0,34, neun von zehn Punkten
     liegen unter 0,5. Mit 0,5 als Mitte wäre fast alles dünner geworden,
     als in der Leiste eingestellt ist. So hat gewöhnliche Schrift genau
     die eingestellte Breite, leicht aufgesetzt gut die Hälfte davon und
     kräftig gedrückt bis zum Doppelten.

     Der Exponent unter 1 macht die Kurve unten steiler: das Ansetzen
     und Abheben – wo der Druck gegen null geht – läuft spitz aus wie
     bei Tinte. Ohne Druckwert (0,5 ist dann nur Platzhalter) wird hier
     ohnehin nicht gerechnet, siehe hatDruck. */
  const DRUCK_MITTE = 0.35;

  function druckFaktor(p) {
    const q = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : DRUCK_MITTE;
    return Math.min(2, 0.25 + 0.75 * Math.pow(q / DRUCK_MITTE, 0.85));
  }

  function hatDruck(s) {
    if (!s || istMarker(s) || s.isEraser || s.isGeometric) return false;
    const pts = s.path;
    if (!Array.isArray(pts) || pts.length < 2) return false;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
      if (!p || !Number.isFinite(p.p)) continue;
      if (p.p < lo) lo = p.p;
      if (p.p > hi) hi = p.p;
    }
    return hi - lo > DRUCK_SPANNE;
  }

  /* Dieselbe Kurve wie traceStrokePath – Quadratkurven durch die
     Mittelpunkte, am Ende eine Strecke –, nur in kleinen Schritten
     abgelaufen. Der Druck läuft auf derselben Kurve mit, er springt
     also nicht von Punkt zu Punkt. */
  function abtasten(pts, halb) {
    const xs = [], ys = [], rs = [];
    const dr = p => (p && Number.isFinite(p.p)) ? p.p : 0.5;
    const nimm = (x, y, p) => { xs.push(x); ys.push(y); rs.push(Math.max(0.25, halb * druckFaktor(p))); };
    const n = pts.length;
    let ax = pts[0].x, ay = pts[0].y, ap = dr(pts[0]);
    nimm(ax, ay, ap);
    for (let i = 1; i < n - 1; i++) {
      const c = pts[i], d = pts[i + 1];
      const cp = dr(c);
      const bx = (c.x + d.x) / 2, by = (c.y + d.y) / 2, bp = (cp + dr(d)) / 2;
      const lang = Math.hypot(c.x - ax, c.y - ay) + Math.hypot(bx - c.x, by - c.y);
      const k = Math.min(16, Math.max(1, Math.ceil(lang / ABTAST_SCHRITT)));
      for (let j = 1; j <= k; j++) {
        const t = j / k, u = 1 - t;
        nimm(u * u * ax + 2 * u * t * c.x + t * t * bx,
             u * u * ay + 2 * u * t * c.y + t * t * by,
             u * u * ap + 2 * u * t * cp + t * t * bp);
      }
      ax = bx; ay = by; ap = bp;
    }
    const z = pts[n - 1], zp = dr(z);
    const lang = Math.hypot(z.x - ax, z.y - ay);
    const k = Math.min(16, Math.max(1, Math.ceil(lang / ABTAST_SCHRITT)));
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      nimm(ax + (z.x - ax) * t, ay + (z.y - ay) * t, ap + (zp - ap) * t);
    }
    return { xs, ys, rs };
  }

  /** Winkel auf (-π, π] gebracht. */
  const winkel = w => Math.atan2(Math.sin(w), Math.cos(w));

  /**
   * Die Fläche eines Strichs mit Druck.
   *
   * @param {Array<{x,y,p}>} pts
   * @param {number} breite   die eingestellte Breite (bei halbem Druck)
   * @returns {{vierecke:number[], kreise:number[]}}  je Viereck acht Zahlen
   *   (vier Ecken; ein Dreieck wiederholt seine erste), je Kreis drei
   *   (Mitte, Radius) – flach, weil eine Seite voller Handschrift schnell
   *   Zehntausende davon hat
   */
  function umriss(pts, breite) {
    const { xs, ys, rs } = abtasten(pts, breite / 2);
    const m = xs.length;
    const vierecke = [], kreise = [];
    const kreisBei = new Uint8Array(m);
    kreisBei[0] = 1; kreisBei[m - 1] = 1;

    /* Ein Dreieck im selben Drehsinn wie alles andere – sonst höbe es
       unter „nonzero" das Trapez auf, über dem es liegt. */
    const dreieck = (cx, cy, ax, ay, bx, by) => {
      if ((ax - cx) * (by - cy) - (ay - cy) * (bx - cx) >= 0) vierecke.push(cx, cy, ax, ay, bx, by, cx, cy);
      else vierecke.push(cx, cy, bx, by, ax, ay, cx, cy);
    };

    // Je Stück: Richtung, Winkel der Tangenten und wo das Trapez endete
    let vorPhi = null, vorA = null;
    let vpx = 0, vpy = 0, vmx = 0, vmy = 0;
    for (let j = 0; j < m - 1; j++) {
      const dx = xs[j + 1] - xs[j], dy = ys[j + 1] - ys[j];
      const d = Math.hypot(dx, dy);
      const r1 = rs[j], r2 = rs[j + 1];
      /* Ein Kreis liegt ganz im anderen: kein Trapez, das ihn berührt.
         Dann tragen die beiden Kreise selbst das Stück. */
      if (d <= Math.abs(r1 - r2) + 1e-6) {
        kreisBei[j] = 1; kreisBei[j + 1] = 1;
        vorPhi = null;
        continue;
      }
      const ux = dx / d, uy = dy / d;
      const nx = -uy, ny = ux;
      const cos = (r1 - r2) / d, sin = Math.sqrt(Math.max(0, 1 - cos * cos));
      const pX = ux * cos + nx * sin, pY = uy * cos + ny * sin;   // Tangente auf der einen Seite
      const mX = ux * cos - nx * sin, mY = uy * cos - ny * sin;   // und auf der anderen
      // In dieser Reihenfolge läuft das Viereck im selben Sinn wie arc()
      vierecke.push(
        xs[j] + r1 * mX, ys[j] + r1 * mY,
        xs[j + 1] + r2 * mX, ys[j + 1] + r2 * mY,
        xs[j + 1] + r2 * pX, ys[j + 1] + r2 * pY,
        xs[j] + r1 * pX, ys[j] + r1 * pY
      );
      const phi = Math.atan2(dy, dx), A = Math.acos(cos);
      if (vorPhi !== null) {
        /* Den Keil zwischen dem vorigen Trapez und diesem decken die
           Dreiecke bis auf ein Bogenstück. Bis KNICK ist das flacher als
           ein Prozent des Radius; darüber kommt der Kreis dazu. */
        dreieck(xs[j], ys[j], vpx, vpy, xs[j] + r1 * pX, ys[j] + r1 * pY);
        dreieck(xs[j], ys[j], vmx, vmy, xs[j] + r1 * mX, ys[j] + r1 * mY);
        const plus = winkel((phi + A) - (vorPhi + vorA));
        const minus = winkel((phi - A) - (vorPhi - vorA));
        if (Math.abs(plus) > KNICK || Math.abs(minus) > KNICK) kreisBei[j] = 1;
      }
      vorPhi = phi; vorA = A;
      vpx = xs[j + 1] + r2 * pX; vpy = ys[j + 1] + r2 * pY;
      vmx = xs[j + 1] + r2 * mX; vmy = ys[j + 1] + r2 * mY;
    }
    for (let j = 0; j < m; j++) if (kreisBei[j]) kreise.push(xs[j], ys[j], rs[j]);
    return { vierecke, kreise };
  }

  /* ── Einmal ausrechnen, oft zeichnen ──────────────────────────────
     Die Seite wird bei jedem Strich, jedem Radieren und jedem Blättern
     ganz neu gezeichnet. Die Fläche auszurechnen kostet ein Mehrfaches
     dessen, was eine Linie kostet – bei allen Strichen jedes Mal wäre
     das auf schwachen Geräten zu spüren. Sie wird deshalb je Strich
     gemerkt und nur neu gebaut, wenn er sich verändert hat.

     Woran das zu sehen ist: Anzahl der Punkte, erster, mittlerer und
     letzter Punkt und die Breite. Verschieben und Vergrössern bewegen den ersten mit,
     der laufende Strich wächst, Radieren und Verdichten legen eine neue
     Liste an – und die Liste selbst ist der Schlüssel. */
  const _flaechen = typeof WeakMap === 'function' ? new WeakMap() : null;

  function flaecheVon(pts, breite) {
    const a = pts[0], h = pts[pts.length >> 1], z = pts[pts.length - 1];
    const merk = _flaechen && _flaechen.get(pts);
    if (merk && merk.n === pts.length && merk.b === breite
      && merk.ax === a.x && merk.ay === a.y && merk.hx === h.x && merk.hy === h.y
      && merk.zx === z.x && merk.zy === z.y) return merk.weg;

    const { vierecke: v, kreise: k } = umriss(pts, breite);
    const weg = new Path2D();
    for (let i = 0; i < v.length; i += 8) {
      weg.moveTo(v[i], v[i + 1]);
      weg.lineTo(v[i + 2], v[i + 3]);
      weg.lineTo(v[i + 4], v[i + 5]);
      weg.lineTo(v[i + 6], v[i + 7]);
      weg.closePath();
    }
    for (let i = 0; i < k.length; i += 3) {
      weg.moveTo(k[i] + k[i + 2], k[i + 1]);
      weg.arc(k[i], k[i + 1], k[i + 2], 0, Math.PI * 2);
    }
    if (_flaechen) _flaechen.set(pts, { n: pts.length, b: breite, ax: a.x, ay: a.y, hx: h.x, hy: h.y, zx: z.x, zy: z.y, weg });
    return weg;
  }

  /** Die Fläche auf ein Canvas – fillStyle muss schon gesetzt sein. */
  function fuelle(ctx, pts, breite) {
    ctx.fill(flaecheVon(pts, breite), 'nonzero');
  }

  /** Dieselbe Fläche als SVG-Weg. Bogen mit sweep=1 läuft wie arc(). */
  function umrissWeg(pts, breite) {
    const { vierecke: v, kreise: k } = umriss(pts, breite);
    let d = '';
    for (let i = 0; i < v.length; i += 8) {
      d += 'M' + zahl(v[i]) + ' ' + zahl(v[i + 1]) + 'L' + zahl(v[i + 2]) + ' ' + zahl(v[i + 3])
        + 'L' + zahl(v[i + 4]) + ' ' + zahl(v[i + 5]) + 'L' + zahl(v[i + 6]) + ' ' + zahl(v[i + 7]) + 'Z';
    }
    for (let i = 0; i < k.length; i += 3) {
      const x = k[i], y = k[i + 1], r = zahl(k[i + 2]);
      d += 'M' + zahl(x + k[i + 2]) + ' ' + zahl(y) + 'A' + r + ' ' + r + ' 0 1 1 ' + zahl(x - k[i + 2]) + ' ' + zahl(y)
        + 'A' + r + ' ' + r + ' 0 1 1 ' + zahl(x + k[i + 2]) + ' ' + zahl(y) + 'Z';
    }
    return d;
  }

  global.StrichForm = { hatDruck, fuelle, umriss, druckFaktor };

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
              for (let k = 1; k < n; k++) {
                const t = k / n;
                const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
                // Ohne Druck wäre der eingefügte Punkt plötzlich halb gedrückt
                if (Number.isFinite(a.p) && Number.isFinite(b.p)) q.p = a.p + (b.p - a.p) * t;
                nimm(q);
              }
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
    // Am Strich entschieden, nicht am Stück: ein Rest hinter dem Radierer
    // gehört weiter zu einem Strich mit Druck, auch wenn er gleichmässig ist
    const druck = hatDruck(s);
    let aus = '';
    for (const pts of teil.stuecke) {
      if (!pts.length) continue;
      if (druck && pts.length > 1) {
        aus += '<path d="' + umrissWeg(pts, b) + '" fill="' + f + '"' + op + '/>';
      } else if (pts.length === 1) {
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
