'use strict';

/* ══════════════════════════════════════════════════════════════════════
   FREIHÄNDIG GEMALTE FORMEN GLATTZIEHEN

   Ein gemalter Kreis wird ein Kreis, ein gemaltes Rechteck ein Rechteck.

   ── Die Geste ist die, die es schon gibt ────────────────────────────
   NICHT automatisch beim Loslassen. Wer eine Skizze zeichnet, will seine
   krummen Linien behalten – ein Editor, der ungefragt etwas anderes
   daraus macht, ist der schlimmste Editor. Geglättet wird deshalb über
   dieselbe Geste, die aus einem Strich schon heute eine Gerade macht:
   am Ende kurz stehen bleiben, ohne abzusetzen (armLineTimer in
   canvas/input.js).

   Damit ist die Sache ausdrücklich: wer nichts tut, bekommt seinen
   Strich. Und wer die Geste kennt, bekommt jetzt mehr als nur Geraden.

   ── Woran eine Form erkannt wird ────────────────────────────────────
   Der Reihe nach, und die erste, die passt, gewinnt:

     1. ELLIPSE   jeder Punkt liegt ungefähr auf der Ellipse, die in das
                  umschließende Rechteck passt.
     2. VIERECK   der vereinfachte Umriss hat vier Ecken.
     3. DREIECK   … drei.

   Vereinfacht wird nach Douglas-Peucker: der Punkt mit dem größten
   Abstand zur Verbindung zweier Ecken wird selbst eine Ecke, solange er
   weit genug weg ist. Das ist das übliche Verfahren dafür und kommt
   ohne Winkelrechnerei aus.

   ── Warum keine Pfeile ──────────────────────────────────────────────
   Ein Pfeil ist eine Linie mit zwei kurzen Strichen am Ende, und die
   zieht man fast nie in einem Zug. Ihn aus einem OFFENEN Strich zu
   erraten hieße, jede Gerade mit einem Haken daran zum Pfeil zu machen –
   und die entsteht beim Schreiben ständig. Lieber gar nicht als oft
   falsch.

   ── Was hier NICHT geschieht ────────────────────────────────────────
   Die Form wird zu einem gewöhnlichen Strich mit vielen Punkten und
   NICHT zu einem Objekt (canvas/shapes.js). Das ist Absicht: sie soll
   sich radieren, verschieben und auswählen lassen wie alles andere von
   Hand Gezeichnete. Ein Objekt hätte Griffe und eine eigene Leiste – für
   einen Kreis in einer Skizze wäre das mehr Bedienteil als Inhalt.
   ══════════════════════════════════════════════════════════════════════ */

(function (global) {

  /* Wie weit Anfang und Ende auseinanderliegen dürfen, damit ein Strich
     als geschlossen gilt – gemessen an der Diagonale seines Kastens. */
  const SCHLUSS_ANTEIL = 0.30;

  /* Wie stark ein Punkt von der gedachten Ellipse abweichen darf.
     0.22 heißt: gut ein Fünftel des Radius. Großzügig, weil eine mit der
     Hand gezogene Rundung nie genau ist – und weil ein Kreis, der nicht
     einrastet, sofort auffällt, ein zu eifriges Einrasten aber auch. */
  const ELLIPSE_TOLERANZ = 0.22;

  /* Douglas-Peucker: ab welchem Abstand ein Punkt eine eigene Ecke wird,
     gemessen an der Diagonale. */
  const ECKEN_ANTEIL = 0.07;

  // Kürzer oder kleiner wird gar nicht erst geprüft
  const MIN_PUNKTE = 8;
  const MIN_GROESSE = 28;

  /* Wie viele Punkte die geglättete Form bekommt. Genug für eine runde
     Linie, wenig genug, dass die Seite davon nicht schwer wird. */
  const KREIS_PUNKTE = 64;

  function kasten(pts) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of pts) {
      if (p.x < x1) x1 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.x > x2) x2 = p.x;
      if (p.y > y2) y2 = p.y;
    }
    return { x1, y1, x2, y2, b: x2 - x1, h: y2 - y1 };
  }

  /** Abstand eines Punktes von der Strecke a–b. */
  function abstand(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const laenge2 = dx * dx + dy * dy;
    if (laenge2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / laenge2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /**
   * Douglas-Peucker: den Umriss auf seine Ecken eindampfen.
   * Bewusst als Schleife und nicht rekursiv – ein Strich kann tausende
   * Punkte haben, und der Stapel ist nicht dafür da.
   */
  function eckenVon(pts, epsilon) {
    if (pts.length < 3) return pts.slice();

    const behalten = new Array(pts.length).fill(false);
    behalten[0] = true;
    behalten[pts.length - 1] = true;

    const stapel = [[0, pts.length - 1]];
    while (stapel.length) {
      const [von, bis] = stapel.pop();
      if (bis <= von + 1) continue;

      let weiteste = -1;
      let maxAbstand = 0;
      for (let i = von + 1; i < bis; i++) {
        const d = abstand(pts[i], pts[von], pts[bis]);
        if (d > maxAbstand) { maxAbstand = d; weiteste = i; }
      }

      if (maxAbstand > epsilon && weiteste > 0) {
        behalten[weiteste] = true;
        stapel.push([von, weiteste], [weiteste, bis]);
      }
    }

    return pts.filter((_, i) => behalten[i]);
  }

  /** Liegen alle Punkte ungefähr auf der Ellipse im umschließenden Kasten? */
  function istEllipse(pts, k) {
    const rx = k.b / 2, ry = k.h / 2;
    if (rx < 6 || ry < 6) return false;

    // Sehr flach ist keine Ellipse mehr, sondern ein Strich
    const verhaeltnis = Math.max(rx, ry) / Math.min(rx, ry);
    if (verhaeltnis > 6) return false;

    const cx = k.x1 + rx, cy = k.y1 + ry;
    let daneben = 0;
    for (const p of pts) {
      const u = (p.x - cx) / rx;
      const v = (p.y - cy) / ry;
      // Auf der Ellipse ist u²+v² genau 1
      if (Math.abs(Math.hypot(u, v) - 1) > ELLIPSE_TOLERANZ) daneben++;
    }
    // Ein paar Ausreißer sind normal – am Anfang und am Ende zittert es
    return daneben <= pts.length * 0.12;
  }

  function ellipsePfad(k, druck) {
    const rx = k.b / 2, ry = k.h / 2;
    const cx = k.x1 + rx, cy = k.y1 + ry;
    const out = [];
    for (let i = 0; i <= KREIS_PUNKTE; i++) {
      const w = (i / KREIS_PUNKTE) * Math.PI * 2;
      out.push({ x: cx + Math.cos(w) * rx, y: cy + Math.sin(w) * ry, p: druck });
    }
    return out;
  }

  /* Ein Vieleck aus seinen Ecken – mit Zwischenpunkten, damit ein
     späteres Radieren und Auswählen die Kanten auch trifft (beides
     prüft Punkt für Punkt, siehe canvas/strokeSelect.js). */
  function vieleckPfad(ecken, druck) {
    const out = [];
    for (let i = 0; i < ecken.length; i++) {
      const a = ecken[i];
      const b = ecken[(i + 1) % ecken.length];
      const laenge = Math.hypot(b.x - a.x, b.y - a.y);
      const schritte = Math.max(2, Math.round(laenge / 8));
      for (let s = 0; s < schritte; s++) {
        const t = s / schritte;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: druck });
      }
    }
    out.push({ x: ecken[0].x, y: ecken[0].y, p: druck });
    return out;
  }

  /**
   * Ein Viereck begradigen.
   *
   * Steht es schon fast gerade im Blatt, wird es auf den umschließenden
   * Kasten gezogen – das ist es, was jemand meint, der ein Rechteck malt.
   * Ist es deutlich gedreht oder schief, bleiben die vier Ecken, wie sie
   * sind: aus einer Raute ein Rechteck zu machen wäre keine Glättung
   * mehr, sondern etwas anderes.
   */
  function viereckEcken(ecken, k) {
    const fastGerade = ecken.every(e =>
      (Math.abs(e.x - k.x1) < k.b * 0.22 || Math.abs(e.x - k.x2) < k.b * 0.22) &&
      (Math.abs(e.y - k.y1) < k.h * 0.22 || Math.abs(e.y - k.y2) < k.h * 0.22));

    if (!fastGerade) return ecken;
    return [
      { x: k.x1, y: k.y1 }, { x: k.x2, y: k.y1 },
      { x: k.x2, y: k.y2 }, { x: k.x1, y: k.y2 }
    ];
  }

  /**
   * Versucht, aus einem gemalten Strich eine Form zu machen.
   *
   * @param {object} stroke  der Strich, unverändert
   * @returns {{art:string, path:object[]}|null} null = keine Form erkannt
   */
  function erkenneForm(stroke) {
    const pts = stroke && stroke.path;
    if (!Array.isArray(pts) || pts.length < MIN_PUNKTE) return null;

    const k = kasten(pts);
    if (k.b < MIN_GROESSE && k.h < MIN_GROESSE) return null;

    const diagonale = Math.hypot(k.b, k.h);
    if (diagonale < MIN_GROESSE) return null;

    // Geschlossen? Sonst ist es ein Strich und keine Form – für den gibt
    // es die Gerade, die es schon gibt.
    const anfang = pts[0], ende = pts[pts.length - 1];
    if (Math.hypot(ende.x - anfang.x, ende.y - anfang.y) > diagonale * SCHLUSS_ANTEIL) return null;

    // Der Druck des Originals, damit die Form aussieht wie das Gemalte
    const druck = pts.reduce((s, p) => s + (p.p ?? 0.5), 0) / pts.length;

    if (istEllipse(pts, k)) return { art: 'ellipse', path: ellipsePfad(k, druck) };

    /* Für das Vieleck wird der Umriss GESCHLOSSEN vereinfacht: der Anfang
       muss auch das Ende sein, sonst zählt die Stelle, an der man
       angesetzt hat, als eigene Ecke. */
    const rund = pts.concat([{ x: anfang.x, y: anfang.y, p: anfang.p }]);
    let ecken = eckenVon(rund, diagonale * ECKEN_ANTEIL);

    // Der doppelte Anfangspunkt am Schluss zählt nicht mit
    if (ecken.length > 1) {
      const erste = ecken[0], letzte = ecken[ecken.length - 1];
      if (Math.hypot(letzte.x - erste.x, letzte.y - erste.y) < diagonale * 0.08) ecken.pop();
    }

    if (ecken.length === 4) {
      return { art: 'viereck', path: vieleckPfad(viereckEcken(ecken, k), druck) };
    }
    if (ecken.length === 3) {
      return { art: 'dreieck', path: vieleckPfad(ecken, druck) };
    }

    return null;
  }

  global.InkwellShapeSnap = { erkenneForm };

  // Für Tests unter Node
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { erkenneForm };
  }
})(typeof window !== 'undefined' ? window : globalThis);
