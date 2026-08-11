'use strict';

/* ══════════════════════════════════════════════════════════════════════
   LINEAL

   Eine durchsichtige Zeichenhilfe, die über der Seite liegt und nicht
   gespeichert wird. Ein Finger oder die Maus verschieben sie, zwei
   Finger drehen sie dazu (wie ein Lineal, das man auf dem Papier
   zurechtlegt), und das Mausrad dreht sie in festen Schritten.

   Sie rastet ein: der Winkel bei 0°, 90°, 180° und 270°, und die Lage
   auf den Linien des Papiers, solange sie waagerecht liegt. Wie das
   ohne Klebenbleiben geht, steht unten bei „Zustand – roh und
   eingerastet".

   Und sie bleibt auf dem Blatt: über den Rand hinaus – nach oben wie
   zur Seite – lässt sie sich nicht schieben. Eine Zeichenhilfe neben
   dem Papier hilft bei keinem Strich (haltAufDemBlatt).

   >>> Warum sie auf einem eigenen Canvas gemalt werden <<<
   Ein DOM-Element mit vielen kleinen Strichen wäre ein ganzes Heer von
   <div>-Elementen. Ein Canvas malt alle Markierungen in einem Rutsch und
   lässt sich mit einem einzigen CSS-transform drehen und verschieben.

   >>> Und warum sie position:fixed sind <<<
   Innerhalb der transformierten Seitenhülle (zoom) wäre fixed wirkungslos.
   Deshalb hängen sie direkt im body und rechnen ihre Lage bei jedem
   Scrollen und Zoomen selbst um.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  /* ── Maße ──────────────────────────────────────────────────────────── */
  const LINEAL_H = 58;           // CSS-Pixel, gesamte Höhe
  const LINEAL_H_PAD = 16;       // Platz über den Strichen (für Griff)

  /* Die Breite ist NICHT fest: das Lineal ist so lang wie die Seite breit
     ist. Ein 420 px langes Stück auf einer 953 px breiten Seite reicht für
     keinen Rand bis Rand gezogenen Strich – genau so wurde es gemeldet.
     Weil der Zoom die Seite skaliert, wird die Breite bei jeder
     Zoom-Änderung neu gerechnet (passeGroesseAn). */
  let linealBreite = 794;

  function seitenBreite() {
    const z = typeof getZoom === 'function' ? getZoom() : 1;
    return Math.max(200, Math.round((CFG.PAGE_W || 794) * z));
  }

  /* echte mm je CSS-Pixel. A4-Seite: 794 px / 210 mm ≈ 3,78 px/mm.
     Bei Zoom z: 1 mm = 3.78 * z px. */
  function pxJeMm() {
    const z = typeof getZoom === 'function' ? getZoom() : 1;
    return (CFG.PAGE_W || 794) / 210 * z;
  }

  /* ══════════════════════════════════════════════════════════════════
     WO DAS LINEAL ERSCHEINT

     >>> Warum nicht mehr über #pages-wrap <<<
     Gemessen wurde der Seiten-Umschlag: seine Oberkante plus 180 px.
     Der Umschlag hält aber ALLE Seiten des Hefts und scrollt mit – auf
     Seite drei liegt seine Oberkante zweitausend Pixel über dem
     Fenster, und dort landete dann auch das Lineal. Der Knopf sah
     eingeschaltet aus, zu sehen war nichts. Genau so wurde es gemeldet.

     Gemessen wird jetzt der Ausschnitt, der wirklich zu sehen ist
     (#pg-scroll). Der bleibt stehen, egal wie weit man geblättert hat.
     ══════════════════════════════════════════════════════════════════ */
  function seitenMitte() {
    const feld = E('pg-scroll') || E('pages-wrap');
    if (!feld) return { x: 200, y: 300 };
    const r = feld.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(180, r.height / 3) };
  }

  /**
   * Holt das Lineal ins Fenster zurück.
   *
   * Nötig, weil seine Lage über das Ausschalten hinaus gemerkt wird: wer
   * es oben hinlegt, weit blättert und es dort wieder einschaltet, hätte
   * es sonst außerhalb des Bildes – und wüsste nicht, wohin damit.
   *
   * Ein Stück darf über den Rand hinausragen; das Lineal ist so breit
   * wie die Seite, und es ganz hineinzuzwingen hieße, es bei jedem
   * Einschalten zu verschieben.
   */
  function holeInsBild() {
    const luft = 60;
    const maxX = window.innerWidth - luft;
    const minX = luft - linealBreite;
    lineal.rohX = Math.max(minX, Math.min(maxX, lineal.rohX));
    lineal.rohY = Math.max(8, Math.min(window.innerHeight - LINEAL_H - 8, lineal.rohY));
  }

  /* ── Canvas anlegen ───────────────────────────────────────────────── */
  function neuesCanvas(w, h) {
    const dpr = typeof getCanvasDpr === 'function' ? getCanvasDpr() : (window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.style.cssText = 'position:fixed;z-index:700;pointer-events:auto;touch-action:none;display:none;'
      + 'width:' + w + 'px;height:' + h + 'px;';
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return { canvas: c, ctx: ctx, dpr: dpr };
  }

  /* ── Lineal malen ─────────────────────────────────────────────────── */
  const ln = neuesCanvas(linealBreite, LINEAL_H);
  document.body.appendChild(ln.canvas);

  /** Bringt das Canvas auf Seitenbreite. Gibt zurück, ob sich etwas
   *  geändert hat – dann muss neu gemalt werden. */
  function passeGroesseAn() {
    const w = seitenBreite();
    if (w === linealBreite) return false;
    linealBreite = w;

    const dpr = ln.dpr;
    ln.canvas.width = Math.round(w * dpr);
    ln.canvas.height = Math.round(LINEAL_H * dpr);
    ln.canvas.style.width = w + 'px';
    ln.canvas.style.height = LINEAL_H + 'px';
    // Das Setzen von width/height leert den Kontext samt Transformation
    ln.ctx.setTransform(1, 0, 0, 1, 0, 0);
    ln.ctx.scale(dpr, dpr);
    return true;
  }

  function maleLineal() {
    const ctx = ln.ctx;
    const dpr = ln.dpr;
    const w = linealBreite, h = LINEAL_H;
    const pmm = pxJeMm();
    const top = LINEAL_H_PAD;

    ctx.clearRect(0, 0, w * dpr, h * dpr);

    // Körper: abgerundetes Rechteck
    const pad = 2;
    ctx.fillStyle = 'rgba(245,235,200,0.88)';
    ctx.strokeStyle = 'rgba(160,130,70,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(pad, pad, w - pad * 2, h - pad * 2, 6);
    ctx.fill();
    ctx.stroke();

    // mm-Striche
    const maxMm = Math.floor((w - 20) / Math.max(pmm, 0.5));
    for (let mm = 0; mm <= maxMm; mm++) {
      const x = 10 + mm * pmm;
      if (x > w - 10) break;

      let len, sw, alpha;
      if (mm % 10 === 0) { len = 28; sw = 1.2; alpha = '0.9'; }
      else if (mm % 5 === 0) { len = 18; sw = 0.9; alpha = '0.7'; }
      else { len = 10; sw = 0.6; alpha = '0.55'; }

      ctx.strokeStyle = 'rgba(60,35,10,' + alpha + ')';
      ctx.lineWidth = sw;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + len);
      ctx.stroke();
    }

    // cm-Zahlen
    ctx.fillStyle = 'rgba(40,20,5,0.85)';
    ctx.font = '10px "DM Mono", monospace';
    ctx.textAlign = 'center';
    for (let cm = 0; cm <= Math.floor(maxMm / 10); cm++) {
      const x = 10 + cm * 10 * pmm;
      if (x > w - 10) break;
      ctx.fillText(String(cm), x, top + 38);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     ZUSTAND – ROH UND EINGERASTET

     Gefuehrt werden zwei Saetze Werte:

       rohX/rohY/rohWinkel   was die Finger gesagt haben
       x/y/winkel            was daraus wird, nachdem eingerastet wurde

     >>> Warum nicht einfach den eingerasteten Wert weiterfuehren <<<
     Dann waere jedes Einrasten endgueltig: die naechste Bewegung
     rechnete auf dem gerundeten Wert weiter, und aus vielen kleinen
     Drehungen um je zwei Grad wuerde gar keine mehr – das Lineal klebte
     fest. Mit dem rohen Wert daneben rastet es nur die ANZEIGE ein und
     springt sofort wieder heraus, sobald der Finger weit genug ist.
     ══════════════════════════════════════════════════════════════════ */
  const lineal = {
    rohX: 200, rohY: 300, rohWinkel: 0,
    x: 200, y: 300, winkel: 0,
    an: false, gesetzt: false
  };

  const WINKEL_TOLERANZ = 6;    // Grad bis zur Viertelmarke

  /* Bildschirmpixel bis zur Papierlinie. Bewusst knapp: es rasten BEIDE
     Kanten ein, und die liegen 58 px auseinander – bei einem Linien-
     abstand von 32 px decken zwei grosszuegige Fangbereiche zusammen
     schon fast die ganze Strecke ab, und das Lineal liesse sich gar
     nicht mehr zwischen die Linien legen. Mit 8 px bleibt dafuer ein
     knappes Drittel uebrig. */
  const LINIEN_TOLERANZ = 8;

  /**
   * Wo die Linien einer Seite liegen – in Seitenkoordinaten.
   *
   * Die Zahlen stehen so in css/pages.css: das liniierte Papier zeichnet
   * alle 32 px einen Strich, und das Muster faengt bei 83 px an; der
   * Strich selbst sitzt am unteren Rand der Kachel, also bei 83+31.
   * Kariert und gepunktet haben ihr eigenes Mass (canvas/text.js
   * lhForBg). Auf blankem Papier gibt es nichts zum Einrasten.
   */
  function linienRaster(pgEl) {
    if (!pgEl) return null;
    if (pgEl.classList.contains('bg-ruled')) return { periode: 32, versatz: 114 };
    if (pgEl.classList.contains('bg-grid')) return { periode: 24, versatz: 75 };
    if (pgEl.classList.contains('bg-dots')) return { periode: 24, versatz: 75 };
    return null;
  }

  /** Die Seite, ueber der die Mitte des Lineals gerade liegt. */
  function seiteUnterLineal() {
    const mx = lineal.rohX + linealBreite / 2;
    const my = lineal.rohY + LINEAL_H / 2;
    for (const pg of document.querySelectorAll('.j-page')) {
      const r = pg.getBoundingClientRect();
      if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) return pg;
    }
    return null;
  }

  /**
   * Aus den rohen Werten die eingerasteten machen.
   *
   * Zwei Dinge rasten ein, und das zweite haengt am ersten:
   *
   *   · Der WINKEL bei 0°, 90°, 180°, 270°. Das ist die Haltung, die man
   *     fast immer will – ein Lineal legt man gerade hin, nicht auf
   *     87 Grad.
   *   · Die LAGE auf den Linien des Papiers, aber nur, solange das
   *     Lineal waagerecht liegt. Schraeg gibt es keine Linie, auf der
   *     es liegen koennte, und ein Sprung waere dort nur im Weg.
   *
   * Eingerastet wird die Kante, die naeher dran ist – oben wie unten
   * laesst sich zeichnen (canvas/input.js kennt beide).
   */
  /**
   * Haelt das Lineal auf dem Blatt.
   *
   * >>> Warum das noetig ist <<<
   * Es liegt fest am Fenster und wusste vom Papier nichts: schieben
   * liess es sich beliebig weit hinaus, nach oben ueber den Blattrand
   * und seitlich neben die Seite. Dort ist es zu nichts mehr nuetze –
   * eine Zeichenhilfe neben dem Papier hilft bei keinem Strich.
   *
   * >>> Warum die MITTE und der gedrehte Umriss <<<
   * Gerechnet wird mit dem Platz, den das Lineal GEDREHT einnimmt, und
   * begrenzt wird sein Mittelpunkt. Wuerde stattdessen das ungedrehte
   * Rechteck begrenzt, saesse ein senkrecht gestelltes Lineal fuer
   * immer in der Blattmitte fest: gedreht wird um den Mittelpunkt, und
   * das Rechteck ist dann so breit wie das Blatt.
   *
   * Begrenzt werden die ROHEN Werte, nicht die angezeigten. Sonst liefe
   * der rohe Wert beim Weiterschieben davon, und beim Zurueckziehen
   * ruehrte sich das Lineal erst wieder, wenn er den Rand eingeholt hat.
   */
  function haltAufDemBlatt() {
    const seiten = document.querySelectorAll('.j-page');
    if (!seiten.length) return;

    const erste = seiten[0].getBoundingClientRect();
    const letzte = seiten[seiten.length - 1].getBoundingClientRect();

    const rad = (lineal.winkel || 0) * Math.PI / 180;
    const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    const breit = linealBreite * c + LINEAL_H * s;
    const hoch = linealBreite * s + LINEAL_H * c;

    let mx = lineal.rohX + linealBreite / 2;
    let my = lineal.rohY + LINEAL_H / 2;

    /* Ist das Lineal breiter als das Blatt – waagerecht ist es genau so
       breit –, gibt es keinen Spielraum. Dann sitzt es buendig, statt
       zwischen zwei widersprechenden Grenzen zu zappeln. */
    const halt = (wert, von, bis) => bis >= von
      ? Math.max(von, Math.min(bis, wert))
      : (von + bis) / 2;

    mx = halt(mx, erste.left + breit / 2, erste.right - breit / 2);
    my = halt(my, erste.top + hoch / 2, letzte.bottom - hoch / 2);

    lineal.rohX = mx - linealBreite / 2;
    lineal.rohY = my - LINEAL_H / 2;
  }

  function rasteEin() {
    /* Erst der Winkel: der Umriss haengt daran, und der Umriss
       entscheidet, wie weit das Lineal aufs Blatt passt. */
    const norm = ((lineal.rohWinkel % 360) + 360) % 360;
    const viertel = Math.round(norm / 90) * 90;
    const nahDran = Math.abs(norm - viertel) <= WINKEL_TOLERANZ;
    lineal.winkel = nahDran ? (viertel % 360) : lineal.rohWinkel;

    haltAufDemBlatt();

    lineal.x = lineal.rohX;
    lineal.y = lineal.rohY;

    // Auf die Papierlinien nur, wenn es waagerecht liegt
    const waagerecht = nahDran && (lineal.winkel === 0 || lineal.winkel === 180);
    if (!waagerecht) return;

    const pgEl = seiteUnterLineal();
    const raster = linienRaster(pgEl);
    if (!raster) return;

    const r = pgEl.getBoundingClientRect();
    const hoehe = (typeof getPage === 'function' && pgEl.dataset.pgid
      && getPage(pgEl.dataset.pgid)?.page?.h) || CFG.PAGE_H;
    const massstab = r.height / hoehe;
    if (!(massstab > 0)) return;

    /** Der Abstand dieser Bildschirm-Hoehe zur naechsten Papierlinie. */
    function abstandZurLinie(sy) {
      const aufSeite = (sy - r.top) / massstab;
      const k = Math.round((aufSeite - raster.versatz) / raster.periode);
      const linie = r.top + (raster.versatz + k * raster.periode) * massstab;
      return linie - sy;
    }

    const obenD = abstandZurLinie(lineal.rohY);
    const untenD = abstandZurLinie(lineal.rohY + LINEAL_H);
    const naeher = Math.abs(obenD) <= Math.abs(untenD) ? obenD : untenD;
    if (Math.abs(naeher) > LINIEN_TOLERANZ) return;

    /* Das Einrasten darf nicht ueber den Blattrand hinaus ziehen. Am
       obersten und untersten Rand liegt die naechste Linie schon
       ausserhalb – gemessen ragte das Lineal dort acht Pixel hinaus,
       genau die Fangweite. Passt es nicht, bleibt es, wo es ist. */
    const ziel = lineal.rohY + naeher;
    if (ziel < r.top || ziel + LINEAL_H > r.bottom) return;
    lineal.y = ziel;
  }

  function aktualisiereLinealPos() {
    rasteEin();
    ln.canvas.style.left = Math.round(lineal.x) + 'px';
    ln.canvas.style.top = Math.round(lineal.y) + 'px';
    ln.canvas.style.transform = 'rotate(' + (lineal.winkel || 0) + 'deg)';
  }

  /* ══════════════════════════════════════════════════════════════════
     SCHIEBEN UND DREHEN

     Ein Finger schiebt. Zwei Finger schieben UND drehen – so, wie man
     ein echtes Lineal auf dem Papier zurechtlegt: die Hand dreht sich,
     das Lineal dreht sich mit.

     >>> Warum es das brauchte <<<
     Gedreht wurde bisher allein mit dem Mausrad. Auf einem Tablet gibt
     es keines. Das Lineal liess sich dort also verschieben, aber nie
     schraeg stellen – und schraege Striche sind der halbe Zweck.

     >>> Woher der Winkel kommt <<<
     Aus der Linie zwischen den beiden Fingern: wie weit sie sich seit
     dem letzten Ereignis gedreht hat, so weit dreht sich das Lineal.
     Gerechnet wird jedes Mal die AENDERUNG und nicht der Winkel
     zwischen Anfang und Jetzt – damit stimmt es auch dann noch, wenn
     ein dritter Finger dazukommt oder einer zwischendurch abhebt.

     Gedreht wird um die Mitte des Lineals; das macht der CSS-Transform
     von selbst (kein transform-origin gesetzt). Dazu wandert es um das,
     was die Mitte zwischen den Fingern zuruecklegt. Beides zusammen
     ergibt die Bewegung, die man erwartet.
     ══════════════════════════════════════════════════════════════════ */
  function einfacheBewegung(canvasEl, state, aktualisiereFn) {
    /* Alle Finger, die gerade auf dem Lineal liegen. Eine Map, weil die
       Reihenfolge zaehlt: die zwei aeltesten fuehren die Geste. */
    const zeiger = new Map();   // pointerId -> { x, y }
    let letzte = null;          // { winkel, mx, my } der letzten Messung

    /** Winkel und Mitte der beiden fuehrenden Finger. */
    function messe() {
      const beide = [...zeiger.values()].slice(0, 2);
      if (beide.length < 2) return null;
      const [a, b] = beide;
      return {
        winkel: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2
      };
    }

    canvasEl.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { }
      zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Der zweite Finger setzt die Geste neu auf, statt sie fortzusetzen
      letzte = messe();
    });

    canvasEl.addEventListener('pointermove', e => {
      const alt = zeiger.get(e.pointerId);
      if (!alt) return;
      e.preventDefault();
      e.stopPropagation();

      const dx = e.clientX - alt.x;
      const dy = e.clientY - alt.y;
      alt.x = e.clientX;
      alt.y = e.clientY;

      if (zeiger.size < 2) {
        state.rohX += dx;
        state.rohY += dy;
        aktualisiereFn();
        return;
      }

      const jetzt = messe();
      if (!jetzt) return;
      if (letzte) {
        /* Ueber ±180° hinaus springt atan2 auf die andere Seite. Ohne
           das Zurechtruecken machte das Lineal an dieser Stelle einen
           halben Umlauf. */
        let dw = jetzt.winkel - letzte.winkel;
        if (dw > 180) dw -= 360;
        if (dw < -180) dw += 360;
        state.rohWinkel = (state.rohWinkel || 0) + dw;
        state.rohX += jetzt.mx - letzte.mx;
        state.rohY += jetzt.my - letzte.my;
      }
      letzte = jetzt;
      aktualisiereFn();
    });

    const beenden = e => {
      if (!zeiger.has(e.pointerId)) return;
      try { canvasEl.releasePointerCapture(e.pointerId); } catch (err) { }
      zeiger.delete(e.pointerId);
      /* Bleibt einer liegen, faengt fuer ihn eine neue Messung an –
         sonst schoebe der Sprung von zwei auf einen Finger das Lineal
         um die halbe Fingerdistanz. */
      letzte = messe();
    };
    canvasEl.addEventListener('pointerup', beenden);
    canvasEl.addEventListener('pointercancel', beenden);
    canvasEl.addEventListener('lostpointercapture', e => {
      zeiger.delete(e.pointerId);
      letzte = messe();
    });

    // Mausrad dreht: ohne Shift 1°-Schritte, mit Shift 15°-Schritte
    canvasEl.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      const schritt = e.shiftKey ? 15 : 1;
      state.rohWinkel = (state.rohWinkel || 0) + (e.deltaY > 0 ? schritt : -schritt);
      aktualisiereFn();
    }, { passive: false });
  }

  einfacheBewegung(ln.canvas, lineal, aktualisiereLinealPos);

  /* ── Neumalen bei Zoom-Änderung ────────────────────────────────────── */
  function beimZoomen() {
    if (!lineal.an) return;
    passeGroesseAn();   // Seitenbreite hat sich mit dem Zoom geändert
    maleLineal();
  }

  // Die App feuert kein eigenes Zoom-Ereignis. Der sicherste Weg ist,
  // einen ResizeObserver auf den Seiten-Umschlag zu setzen und bei jeder
  // Größenänderung neu zu malen.
  const wrap = E('pages-wrap');
  if (wrap && typeof ResizeObserver !== 'undefined') {
    let zoomTimer = 0;
    new ResizeObserver(() => {
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(beimZoomen, 150);
    }).observe(wrap);
  }

  /* ── Knöpfe in der Leiste ──────────────────────────────────────────── */

  /**
   * Den Knopf in die Stift- und Formen-Einstellungen hängen.
   *
   * >>> Warum nicht mehr rechts aussen <<<
   * Dort stand er neben Speichern, Teilen und Zoom und machte die Leiste
   * noch voller – gemeldet als „alles zugespammt". Ein Lineal ist eine
   * Zeichenhilfe: es gehört dorthin, wo Farbe und Strichstärke stehen,
   * und ist damit nur zu sehen, wenn wirklich gezeichnet wird.
   */
  /* Nur noch bei den Stift-Einstellungen. Bei den Formen stand er
     ebenfalls, solange man sie aufzog – seit sie eingesetzt statt
     gemalt werden, gibt es dort keinen Strich mehr, an dem ein Lineal
     helfen könnte. */
  function baueKnoepfe() {
    const ziele = ['pen-opts'].map(id => E(id)).filter(Boolean);
    if (!ziele.length) return setTimeout(baueKnoepfe, 200);

    for (const grp of ziele) {
      if (grp.querySelector('.btn-ruler')) continue;

      const teiler = document.createElement('div');
      teiler.className = 'v-div';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tb-opt btn-ruler';
      btn.textContent = '📏';
      btn.title = (typeof t === 'function' && t('ruler')) || 'Lineal';
      btn.addEventListener('click', umschaltenLineal);

      grp.appendChild(teiler);
      grp.appendChild(btn);
    }

    aktualisiereKnopfZustand();
    if (typeof window.updateToolbarOverflow === 'function') {
      window.updateToolbarOverflow();
    }
  }

  function aktualisiereKnopfZustand() {
    document.querySelectorAll('.btn-ruler')
      .forEach(b => b.classList.toggle('active', lineal.an));
  }

  /* ── Ein- und Ausschalten ─────────────────────────────────────────── */
  function umschaltenLineal() {
    lineal.an = !lineal.an;
    if (lineal.an) {
      passeGroesseAn();
      // Beim ersten Mal über der Seite platzieren
      if (!lineal.gesetzt) {
        const m = seitenMitte();
        lineal.rohX = m.x - linealBreite / 2;
        lineal.rohY = m.y - LINEAL_H / 2;
        lineal.gesetzt = true;
      }
      // Und jedes Mal sicherstellen, dass es auch zu sehen ist
      holeInsBild();
      maleLineal();
      ln.canvas.style.display = 'block';
      aktualisiereLinealPos();
    } else {
      ln.canvas.style.display = 'none';
    }
    aktualisiereKnopfZustand();
  }

  /** Ausblenden, ohne den Zustand zu behalten – für den Weg zur Startseite. */
  function versteckeLineal() {
    if (!lineal.an) return;
    lineal.an = false;
    ln.canvas.style.display = 'none';
    aktualisiereKnopfZustand();
  }

  /* Auf der Startseite hat das Lineal nichts zu suchen: es liegt fest am
     Fenster (position:fixen), die Heft-Übersicht schiebt es nicht weg, und
     der Knopf zum Ausschalten steht in der Editor-Leiste, die dort gar
     nicht da ist – man wurde es also nicht mehr los. */
  (function haengeAnSeitenwechsel() {
    const orig = window.showHome;
    if (typeof orig !== 'function') return setTimeout(haengeAnSeitenwechsel, 200);
    window.showHome = function () {
      versteckeLineal();
      return orig.apply(this, arguments);
    };
  })();

  /* ── Start ────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', baueKnoepfe);
  } else {
    baueKnoepfe();
  }

  /* ── Global erreichbar ────────────────────────────────────────────── */
  window.toggleRuler = umschaltenLineal;

  /** Gibt die aktuelle Lage des Lineals in Bildschirm-Koordinaten zurück,
   *  oder null, wenn es ausgeschaltet ist. Für das Einrasten gezeichneter
   *  Linien an der Lineal-Kante (siehe canvas/input.js). */
  window.getRulerState = function () {
    if (!lineal.an) return null;
    return { x: lineal.x, y: lineal.y, winkel: lineal.winkel || 0,
             w: linealBreite, h: LINEAL_H, hPad: LINEAL_H_PAD };
  };

})();
