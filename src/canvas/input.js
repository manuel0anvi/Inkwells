'use strict';

/* ── INPUT ── */
function attachInput(canvas, textDiv, objLayer, page) {
  const div = canvas.parentElement;
  const LINE_HOLD_MS = 320;

  /* Wann der laufende Strich angesetzt hat. Aus der Dauer wird beim
     Abheben das Tempo – und daraus, ob eine Schlinge eine Auswahl war
     (canvas/strokeSelect.js, versucheLasso). Bewusst NICHT am Strich
     selbst: der wandert unverändert in page.inkStrokes und damit in die
     gespeicherte Datei. */
  let _strichAnfang = 0;

  /* Wo die Uhr für die Gerade zuletzt aufgezogen wurde – siehe
     armLineTimer. Auch das gehört nicht in den Strich. */
  let _halteBei = null;
  const HALTE_ZITTERN = 4;   // Seiten-Pixel, die noch als Stillstand gelten

  /* Ein Tipp ist kein Strich: so weit darf der Finger dabei wandern. */
  const TIPP_WEG = 9;

  /* Ein Finger, der aufgesetzt hat, ohne zu zeichnen: { id, sx, sy }. */
  let _tippStart = null;

  function activateTextEditingAt(clientX, clientY, forceManual = false) {
    if (S.mode !== 'cursor') switchMode('cursor');
    textDiv.style.pointerEvents = 'auto';
    // Im Nur-Lese-Modus darf der Zeiger stehen (Markieren und Kopieren
    // bleiben möglich), aber es wird nichts gesetzt oder verändert.
    if (S.readOnly) { setActivePg(page.id); return; }
    const richMode = !isPlainTextEditable(textDiv);
    placeCaretAnywhere(textDiv, clientX, clientY, forceManual || richMode, page);
    setActivePg(page.id);
  }

  function isFreeEditorAreaClick(clientX, clientY) {
    const plain = (textDiv.innerText || '').replace(/\r/g, '');
    if (!plain.trim().length) return true;

    const divRect = textDiv.getBoundingClientRect();
    const pad = 2;
    if (clientX < divRect.left - pad ||
        clientX > divRect.right + pad ||
        clientY < divRect.top - pad ||
        clientY > divRect.bottom + pad) {
      return true;
    }

    try {
      const range = document.createRange();
      range.selectNodeContents(textDiv);
      const rects = Array.from(range.getClientRects());

      if (!rects.length) {
        return true;
      }

      const hitsVisibleText = rects.some(rc => (
        rc.width > 1 &&
        clientX >= rc.left - 2 &&
        clientX <= rc.right + 2 &&
        clientY >= rc.top - 1 &&
        clientY <= rc.bottom + 1
      ));
      return !hitsVisibleText;
    } catch (err) {
      return true;
    }
  }

  /**
   * Zieht die Uhr auf, nach der aus dem Strich eine Gerade wird.
   *
   * >>> Warum sie nicht bei jeder Meldung neu aufgezogen wird <<<
   * Ein aufgesetzter Stift steht nie ganz still: er zittert um ein, zwei
   * Pixel, und jede dieser Bewegungen stellte die Uhr wieder auf null.
   * Die Gerade kam damit nur zustande, wenn die Hand zufällig ruhig genug
   * war – „funktioniert schon, aber nicht immer" ist genau das. Erst eine
   * Bewegung über HALTE_ZITTERN hinaus gilt jetzt als Weiterzeichnen.
   *
   * @param {object} stroke
   * @param {{x:number,y:number}} [punkt]  wo der Stift gerade steht
   */
  function armLineTimer(stroke, punkt) {
    if (!stroke || stroke.isEraser || stroke._lasso) return;
    if (punkt && _halteBei && stroke._lineTimer
        && Math.hypot(punkt.x - _halteBei.x, punkt.y - _halteBei.y) < HALTE_ZITTERN) {
      return;   // gilt noch als Stillstand – die laufende Uhr darf zu Ende gehen
    }
    clearTimeout(stroke._lineTimer);
    _halteBei = punkt ? { x: punkt.x, y: punkt.y } : null;
    stroke._lineTimer = setTimeout(() => {
      if (!S.isDrawing || S._cur !== stroke) return;
      stroke._lineLocked = true;
      const pts = stroke.path || [];
      if (pts.length > 1) {
        stroke._shapeDetected = false;
        stroke.isGeometric = false;
        const start = pts[0], end = pts[pts.length - 1];
        stroke.path = [start, end];
        clearLiveCanvas();
        redrawStrokes(canvas, S.strokeHistory[page.id]);
      }
    }, LINE_HOLD_MS);
  }

  function stopLineTimer(stroke) {
    if (!stroke) return;
    clearTimeout(stroke._lineTimer);
    stroke._lineTimer = null;
  }

  function coords(e) {
    const r = canvas.getBoundingClientRect();
    const pw = page.w || CFG.PAGE_W;
    const ph = page.h || CFG.PAGE_H;
    const scaleX = pw / r.width, scaleY = ph / r.height;
    return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY, p: e.pressure > 0 ? e.pressure : 0.5 };
  }

  /* ── Am Lineal einrasten ─────────────────────────────────────────────
     Ein echtes Lineal lässt den Stift nicht los, nur weil die Hand einen
     Millimeter abrutscht – es ist eine Kante, an der er anliegt. Genau das
     fehlte: gemessen wurde bei jeder Bewegung neu, und einen Pixel neben
     der Schwelle zeichnete es wieder frei.

     Deshalb zwei Schwellen statt einer:
       · FASSEN – so nah muss man kommen, damit es überhaupt greift
       · LOSLASSEN – so weit muss man weg, damit es wieder freigibt
     Dazwischen bleibt der Strich an der Kante, auch wenn die Hand wandert.
     Das ist dieselbe Hysterese, die auch ein Schalter braucht, damit er
     nicht flattert. */
  const RULER_FASSEN = 14;      // CSS-Pixel
  const RULER_LOSLASSEN = 48;   // CSS-Pixel

  /**
   * Punkt an der Lineal-Kante einrasten lassen.
   *
   * @param {{x:number,y:number,p:number}} pt  Punkt in Seiten-Koordinaten
   * @param {{x:number,y:number,winkel:number,w:number,h:number}} rs
   *        Lineal-Zustand in Bildschirm-Koordinaten (von getRulerState)
   * @param {HTMLCanvasElement} canvas
   * @param {object} page   { w, h }
   * @param {boolean} klebt ob der Strich gerade schon an der Kante liegt
   * @returns {null|{x:number,y:number,p:number}} eingerasteter Punkt oder null
   */
  function snapToRuler(pt, rs, canvas, page, klebt) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const scaleX = (page.w || CFG.PAGE_W) / r.width;
    const scaleY = (page.h || CFG.PAGE_H) / r.height;

    // Bildschirm → Seite: Umkehrung von coords()
    function toPage(sx, sy) {
      return { x: (sx - r.left) * scaleX, y: (sy - r.top) * scaleY };
    }

    const rad = (rs.winkel * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const cx = rs.x + rs.w / 2;   // Lineal-Mitte (Bildschirm)
    const cy = rs.y + rs.h / 2;

    // Zwei Punkte einer Kante um den Mittelpunkt drehen
    function kante(sx1, sy1, sx2, sy2) {
      const rx1 = sx1 - cx, ry1 = sy1 - cy;
      const rx2 = sx2 - cx, ry2 = sy2 - cy;
      const dx1 = rx1 * cos - ry1 * sin;
      const dy1 = rx1 * sin + ry1 * cos;
      const dx2 = rx2 * cos - ry2 * sin;
      const dy2 = rx2 * sin + ry2 * cos;
      return { a: toPage(cx + dx1, cy + dy1), b: toPage(cx + dx2, cy + dy2) };
    }

    const schwell = (klebt ? RULER_LOSLASSEN : RULER_FASSEN) * scaleX;

    const kanten = [
      kante(rs.x, rs.y, rs.x + rs.w, rs.y),                 // obere Kante
      kante(rs.x, rs.y + rs.h, rs.x + rs.w, rs.y + rs.h)    // untere Kante
    ];

    let beste = null, besteDist = Infinity;

    for (const k of kanten) {
      const dx = k.b.x - k.a.x, dy = k.b.y - k.a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 0.001) continue;

      /* KEINE Klammerung auf die Strecke: die Kante wirkt als unendliche
         Gerade. Sonst hörte das Einrasten am Ende des Lineals auf und die
         Punkte stauten sich an der Ecke – ein Strich über das Lineal
         hinaus knickte dort ab. */
      const t = ((pt.x - k.a.x) * dx + (pt.y - k.a.y) * dy) / len2;
      const projX = k.a.x + t * dx;
      const projY = k.a.y + t * dy;
      const dist = Math.hypot(pt.x - projX, pt.y - projY);

      if (dist < schwell && dist < besteDist) {
        besteDist = dist;
        beste = { x: projX, y: projY, p: pt.p };
      }
    }

    return beste;
  }

  /* ══════════════════════════════════════════════════════════════════
     WIE EINE SCHLINGE AUSSIEHT

     Nicht wie ein Strich: gestrichelte Kante und blass gefülltes Inneres
     – dieselbe Sprache, die jedes Auswahlwerkzeug spricht, und man sieht
     schon beim Ziehen, was drin liegen wird.

     >>> Warum auf der Vorschau-Fläche <<<
     Sie liegt über der Zeichenfläche und wird beim Abheben weggeworfen.
     Damit muss nichts zurückgenommen werden, und die Seite selbst bekommt
     von der Schlinge nie etwas zu sehen. Ihre 38 % Deckkraft gelten dem
     Marker; für die Schlinge wird sie auf voll gestellt (die Fläche
     entsteht für jeden Strich neu, ein Zurücksetzen erübrigt sich).

     Gefüllt wird die GESCHLOSSENE Form, gestrichelt nur der wirklich
     gezogene Weg – die Sehne zurück zum Anfang zu malen sähe aus wie
     ein Strich, den man nicht gezogen hat.
     ══════════════════════════════════════════════════════════════════ */
  function maleLasso(stroke) {
    const pts = stroke.path;
    if (!pts || !pts.length) return;
    const pw = page.w || CFG.PAGE_W, ph = page.h || CFG.PAGE_H;
    const lctx = getLiveCtx(div, pw, ph);
    setLiveOpacity(1);
    lctx.clearRect(0, 0, pw, ph);

    const weg = ctx2 => {
      ctx2.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx2.lineTo(pts[i].x, pts[i].y);
    };

    lctx.save();
    lctx.beginPath();
    weg(lctx);
    lctx.closePath();
    lctx.fillStyle = 'rgba(140,140,155,.16)';
    lctx.fill();

    lctx.beginPath();
    weg(lctx);
    lctx.setLineDash([8, 6]);
    lctx.lineWidth = 1.6;
    lctx.lineJoin = 'round';
    lctx.lineCap = 'round';
    lctx.strokeStyle = 'rgba(60,60,75,.8)';
    lctx.stroke();
    lctx.restore();
  }

  /**
   * Ein Fingertipp auf ein Bild, eine Form oder eine Formel: auswählen.
   *
   * Mit gewähltem Zeichenwerkzeug nehmen Objekte keine Zeiger an
   * (ui/toolbar.js, applyMode) – der Finger malte also über sie hinweg.
   * „Entweder male ich die ganze Zeit, oder ich muss ganz genau den Rand
   * der Form treffen": das Zweite galt in der Zeigerstellung, wo eine
   * Ellipse ohne Füllung nur aus ihrem Umriss besteht. Beides erledigt
   * sich hier – gefragt wird das Rechteck des Objekts (canvas/objects.js,
   * objectAt), und danach steht das Werkzeug auf dem Zeiger.
   *
   * @returns {boolean} ob der Tipp als Auswahl verbraucht wurde
   */
  function tippAufObjekt(e) {
    if (S.readOnly || typeof window.objectAt !== 'function') return false;
    const wrap = window.objectAt(div, e.clientX, e.clientY);
    if (!wrap) return false;
    if (S.mode !== 'cursor') switchMode('cursor');
    wrap._beginObjInteraction(e);
    unterdrueckeTextTipp();
    return true;
  }

  /**
   * Ein Fingertipp auf geschriebenen Text: dorthin gehört die Marke.
   *
   * >>> Warum das hier stehen muss <<<
   * In der Zeigerstellung erledigt das der Browser von selbst – der Tipp
   * landet auf .j-text, und dort gehört er hin. Sobald aber ein
   * Zeichenwerkzeug gewählt ist, liegt die Zeichenfläche darüber und
   * fängt ihn ab: mit dem Finger liess sich dann in keine Zeile mehr
   * tippen, nur noch mit der Maus. Genau so wurde es gemeldet, und zwar
   * unmittelbar nachdem der Stift anfing, das Werkzeug selbst
   * umzustellen – seither ist das der Normalfall, nicht die Ausnahme.
   *
   * Nur auf WIRKLICH geschriebenem Text (isFreeEditorAreaClick), sonst
   * käme bei jedem Punkt, den jemand malen will, die Tastatur hoch.
   *
   * @returns {boolean} ob der Tipp als Schreibmarke verbraucht wurde
   */
  function tippAufText(e) {
    if (S.readOnly) return false;
    if (isFreeEditorAreaClick(e.clientX, e.clientY)) return false;
    activateTextEditingAt(e.clientX, e.clientY, false);
    return true;
  }

  /** Nimmt den eben gezogenen Strich wieder aus der Seite heraus. */
  function nimmStrichZurueck(stroke) {
    S.strokeHistory[page.id] = (S.strokeHistory[page.id] || []).filter(s => s !== stroke);
  }

  /** Wie weit ist der Strich gewandert? Darunter war es ein Tipp. */
  function spannweite(stroke) {
    const pts = (stroke && stroke.path) || [];
    if (pts.length < 2) return 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return Math.hypot(maxX - minX, maxY - minY);
  }

  /** Einen Punkt am Lineal ausrichten und den Klebe-Zustand fortschreiben. */
  function amLinealAusrichten(c, canvas, page) {
    const rs = window.getRulerState && window.getRulerState();
    if (!rs) { S._rulerKlebt = false; return c; }
    const s = snapToRuler(c, rs, canvas, page, S._rulerKlebt);
    S._rulerKlebt = !!s;
    return s || c;
  }

  /**
   * Einen Strich beginnen – mit Stift, Maus oder Finger.
   *
   * Hiess handlePenStart und lief nur fuer den Stift. Gezeichnet wird
   * inzwischen mit allem, was der Nutzer dafuer nimmt; welches Geraet
   * ueberhaupt hierher kommt, entscheidet der Verteiler unten.
   */
  function handleDrawStart(e) {
    // Fremdes Dokument ohne Bearbeitungsrecht: der Stift schreibt nicht.
    // Ohne diese Bremse landeten die Striche zwar nur lokal, wären aber
    // sichtbar – und wirkten dadurch wie eine gespeicherte Änderung.
    if (S.readOnly) return;

    const radiert = istRadierTaste(e);
    const lasso = !radiert && istLassoTaste(e);

    if (radiert) {
      if (S.mode !== 'eraser') { S._restoreMode = S.mode; switchMode('eraser'); }
    } else if (S._restoreMode) {
      S._restoreMode = null;
    }
    S._drawPointerId = e.pointerId;
    _strichAnfang = performance.now();
    /* Eine Auswahl aus einer vorigen Schlinge gilt nur, bis wieder
       gezeichnet wird – sonst bliebe ihr Rahmen als Fremdkörper stehen,
       während schon der nächste Strich entsteht. */
    if (typeof window.deselectStroke === 'function') window.deselectStroke();
    e.preventDefault();
    /* Gefangen wird an der SEITE, nicht am getroffenen Element. Der Stift
       setzt aus der Zeigerstellung heraus auf dem Textfeld auf, und das
       stellen wir gleich darauf auf pointer-events: none – ein Fang daran
       waere heikel. Die Seite traegt ohnehin die Hoerer fuer Bewegung und
       Abheben. */
    try { div.setPointerCapture(e.pointerId); } catch (err) { }
    textDiv.style.pointerEvents = 'none';
    textDiv.dataset.ph = '';
    setActivePg(page.id);
    /* Auch der ERSTE Punkt gehört ans Lineal. Ohne das setzte der Strich
       daneben an, und bei einer festgestellten Geraden hing die ganze
       Linie an diesem schiefen Anfang. */
    S._rulerKlebt = false;
    const c = amLinealAusrichten(coords(e), canvas, page);
    S.isDrawing = true;
    // Zustand vor dem Strich sichern – ein Strich ist ein Rückgängig-Schritt
    pushPageHistory(page);
    /* ══════════════════════════════════════════════════════════════
       DIE SCHLINGE IST KEIN STRICH

       Sie kommt gar nicht erst in die Seite: gemalt wird sie auf der
       Vorschau-Fläche (maleLasso), und beim Abheben bleibt von ihr
       nichts als die Auswahl. So kann sie auch nirgends versehentlich
       mitgespeichert oder mitgezeichnet werden.
       ══════════════════════════════════════════════════════════════ */
    if (lasso) {
      S._cur = baueLassoStrich(c);
      maleLasso(S._cur);
      return;
    }
    // Eine gerade Linie wird ganz weggenommen, nicht angeknabbert
    if (S.mode === 'eraser' && S.eraser.type === 'pixel') geradeGanzWeg(c, page, canvas);
    if (S.mode !== 'eraser' || S.eraser.type === 'pixel') {
      if (!S.strokeHistory[page.id]) S.strokeHistory[page.id] = [];
      const stroke = buildStroke(c);
      if (S.mode === 'eraser') {
        stroke.isEraser = true; stroke.color = 'rgba(0,0,0,1)'; stroke.width = ERASER_SIZES[S.eraser.szIdx] * 2;
      }
      S.strokeHistory[page.id].push(stroke); S._cur = stroke;
      _halteBei = null;
      armLineTimer(stroke, c);
      if (stroke.isHL) {
        const pw = page.w || CFG.PAGE_W;
        const ph = page.h || CFG.PAGE_H;
        const lctx = getLiveCtx(div, pw, ph);
        lctx.save(); lctx.fillStyle = stroke.color;
        lctx.beginPath(); lctx.arc(c.x, c.y, stroke.width / 2, 0, Math.PI * 2); lctx.fill(); lctx.restore();
      } else {
        const ctx = canvas.getContext('2d'); ctx.save(); ctx.fillStyle = stroke.color;
        if (stroke.isEraser) ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(c.x, c.y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     WELCHES GERAET WAS TUT

     >>> Der Stift MALT – immer <<<
     Er berührt die Seite, also will jemand etwas darauf haben. Steht das
     Werkzeug gerade auf dem Zeiger, greift er von selbst zum zuletzt
     benutzten Stift; seine Tasten radieren und kreisen ein, ebenfalls
     ohne Umweg über die Leiste.

     Das war schon einmal so, wurde entfernt („mit dem Stift liess sich
     nichts mehr antippen") und ist jetzt zurück – aus einem Grund, der
     damals fehlte: Antippen mit dem Stift setzte die Schreibmarke, und
     auf einem Tablet fährt dann die Bildschirmtastatur heraus, obwohl
     niemand schreiben wollte. Was der Stift nicht mehr kann, kann der
     Finger: antippen, auswählen, blättern.

     >>> Der Finger ist das Zeigegerät <<<
     Er scrollt, tippt an und wählt aus – und er zeichnet, solange der
     Schalter in der Leiste an ist (S.touchDraw, an, bis jemand ihn
     ausschaltet). Ein TIPP auf einen vorhandenen Strich zählt dabei
     nicht als Punkt, sondern als Auswahl (siehe pointerup).

     Die Maus bleibt, was sie war: sie folgt dem gewählten Werkzeug.
     ══════════════════════════════════════════════════════════════════ */
  div.addEventListener('pointerdown', e => {
    const target = e.target;
    if (target.closest('.j-page-hdr') || target.closest('.obj-handle') || target.closest('.obj-bar')) return;

    if (e.pointerType === 'pen') {
      const radiert = istRadierTaste(e), lasso = istLassoTaste(e);
      if (e.button !== 0 && !radiert && !lasso) return;
      /* Zur Zeigerstellung gehört keine Zeichenfläche: der Stift landet
         dort auf dem Textfeld. Deshalb steht die Abfrage auf .j-text
         erst unter diesem Zweig – für Maus und Finger gilt sie weiter. */
      if (!isDrawMode(S.mode) && !radiert && !lasso) switchMode(letztesZeichenwerkzeug());
      handleDrawStart(e);
      return;
    }

    if (target.closest('.j-text')) return;

    if (e.pointerType === 'mouse') {
      // Die rechte Maustaste bleibt dem Kontextmenue, sonst waere das
      // Markieren von Text kaputt – sie radiert nur beim Zeichnen.
      const radiert = e.button === 2 || (e.buttons & 2);
      if (e.button !== 0 && !radiert) return;

      if (isDrawMode(S.mode)) { handleDrawStart(e); return; }

      // We don't preventDefault here to allow native selection to work.
      // But we call activeTextEditingAt immediately so the cursor appears
      // where we want it before the browser has a chance to place its own.
      activateTextEditingAt(e.clientX, e.clientY, false);
      return;
    }

    if (e.pointerType === 'touch') {
      if (touchDrawActive()) { handleDrawStart(e); return; }
      /* Der Finger scrollt hier – abgefangen wird nichts. Gemerkt wird
         nur, wo er aufgesetzt hat: bleibt er liegen und lag dort ein
         Strich, war es ein Tipp und damit eine Auswahl (siehe unten).
         Ohne das gäbe es mit ausgeschaltetem „mit dem Finger malen"
         überhaupt keinen Weg, einen Strich anzufassen. */
      _tippStart = { id: e.pointerId, sx: e.clientX, sy: e.clientY };
      return;
    }
    // sonst bleibt der Finger fuers Scrollen und Zoomen (app.js)
  });

  /** Ein Finger, der ohne zu zeichnen aufgesetzt hat – siehe oben. */
  div.addEventListener('pointerup', e => {
    const start = _tippStart;
    _tippStart = null;
    if (!start || e.pointerId !== start.id || S.readOnly) return;
    if (Math.hypot(e.clientX - start.sx, e.clientY - start.sy) > TIPP_WEG) return;
    if (typeof window.strichBeiPunkt !== 'function') return;

    const c = coords(e);
    const treffer = window.strichBeiPunkt(page.id, c.x, c.y, null);
    if (!treffer) { if (!tippAufObjekt(e)) tippAufText(e); return; }
    if (S.mode !== 'cursor') switchMode('cursor');
    if (typeof window.waehleStriche === 'function') window.waehleStriche(page.id, [treffer]);
    unterdrueckeTextTipp();
  });

  div.addEventListener('pointermove', e => {
    // Nur der Zeiger, der den Strich begonnen hat – ein zweiter Finger
    // beim Zoomen darf nicht mitmalen
    if (!S.isDrawing || e.pointerId !== S._drawPointerId) return;
    e.preventDefault();
    /* Die Schlinge geht ihren eigenen Weg: kein Lineal, keine Gerade nach
       dem Halten, kein Strich auf der Seite – nur die Vorschau. */
    if (S._cur && S._cur._lasso) {
      const p = coords(e);
      S._cur.path.push({ x: p.x, y: p.y, p: p.p });
      maleLasso(S._cur);
      return;
    }
    // An der Lineal-Kante einrasten (siehe ui/ruler.js)
    const c = amLinealAusrichten(coords(e), canvas, page);
    const ctx = canvas.getContext('2d');
    if (S.mode === 'eraser' && S.eraser.type === 'stroke' && !S._cur?._lasso) {
      strokeErase(c, page, canvas);
    }
    else {
      if (S._cur?.isEraser) geradeGanzWeg(c, page, canvas);
      if (S._cur) {
        const stroke = S._cur;
        if (!stroke.isEraser) armLineTimer(stroke, c);
        // If a shape was detected, don't override it with line logic
        if (stroke._lineLocked && !stroke._shapeDetected && !stroke.isEraser) {
          const start = stroke.path[0] || { x: c.x, y: c.y, p: c.p };
          stroke.path = [start, { x: c.x, y: c.y, p: c.p }];
          clearLiveCanvas();
          redrawStrokes(canvas, S.strokeHistory[page.id]);
        } else if (!stroke._lineLocked) {
          stroke.path.push({ x: c.x, y: c.y, p: c.p });
        }
        // Draw preview
        if (stroke._lineLocked && !stroke._shapeDetected) {
          // already redrawn above for line
        } else if (stroke._shapeDetected) {
          // Shape is already rendered, don't update
        } else if (S._cur.isHL) {
          const pw = page.w || CFG.PAGE_W;
          const ph = page.h || CFG.PAGE_H;
          const lctx = getLiveCtx(div, pw, ph);
          lctx.clearRect(0, 0, pw, ph);
          lctx.save();
          applyStrokeStyles(lctx, S._cur);
          traceStrokePath(lctx, S._cur);
          lctx.restore();
        } else {
          liveDrawIncr(ctx, c);
        }
      }
    }
  }, { passive: false });

  div.addEventListener('pointerup', e => {
    if (!S.isDrawing || e.pointerId !== S._drawPointerId) return;
    S.isDrawing = false;
    S._drawPointerId = null;
    S._rulerKlebt = false;    // der nächste Strich fängt frei an
    stopLineTimer(S._cur);
    clearLiveCanvas();
    if (S.mode === 'eraser' && S._restoreMode) { switchMode(S._restoreMode); S._restoreMode = null; }
    if (S._cur?.isHL || S._cur?.isEraser) redrawStrokes(canvas, S.strokeHistory[page.id]);

    const finished = S._cur;

    /* ══════════════════════════════════════════════════════════════
       WAR DAS EINE SCHLINGE?

       Drei Wege führen dazu, dass aus dem eben Gezogenen eine Auswahl
       wird statt eines Strichs (canvas/strokeSelect.js):

         · die TASTE am Stift – dann war es von vornherein eine Schlinge
         · schnell um etwas HERUMGEZOGEN – „das da meine ich" und nicht
           „male einen Kreis". Der Marker bleibt aussen vor: mit ihm
           fährt man um Wörter herum, ohne etwas auswählen zu wollen
         · ein TIPP mit dem Finger auf einen vorhandenen Strich

       Der eben gezogene Strich verschwindet dann wieder – und mit ihm
       sein Rückgängig-Schritt, der in handleDrawStart schon gesetzt
       wurde. Sonst nähme das erste Strg+Z danach etwas weg, das der
       Nutzer nie hinzugefügt hat. (Die Schlinge an der Stifttaste stand
       nie in der Seite, bei ihr genügt der Rückgängig-Schritt.)
       ══════════════════════════════════════════════════════════════ */
    let alsAuswahl = false;

    if (finished && finished._lasso) {
      if (typeof window.waehleEingekreiste === 'function') {
        window.waehleEingekreiste(page.id, finished.path);
      }
      alsAuswahl = true;
    } else if (finished && !finished.isEraser && e.pointerType === 'touch'
               && spannweite(finished) < TIPP_WEG) {
      const c = coords(e);
      const treffer = typeof window.strichBeiPunkt === 'function'
        && window.strichBeiPunkt(page.id, c.x, c.y, finished);
      if (treffer) {
        nimmStrichZurueck(finished);
        /* Auf den Zeiger umstellen: was jetzt ausgewählt daliegt, will
           verschoben oder gelöscht werden, nicht übermalt. */
        if (S.mode !== 'cursor') switchMode('cursor');
        if (typeof window.waehleStriche === 'function') window.waehleStriche(page.id, [treffer]);
        // Der Tipp darf nicht gleich noch die Schreibmarke setzen
        unterdrueckeTextTipp();
        alsAuswahl = true;
      } else if (tippAufObjekt(e) || tippAufText(e)) {
        // Kein Punkt, sondern ein Tipp auf etwas – der Punkt kommt weg
        nimmStrichZurueck(finished);
        alsAuswahl = true;
      }
    }

    if (!alsAuswahl) {
      alsAuswahl = !!finished && !finished.isEraser && !finished.isHL
        && typeof window.versucheLasso === 'function'
        && window.versucheLasso(page.id, finished, performance.now() - _strichAnfang);
    }

    if (alsAuswahl) {
      redrawStrokes(canvas, S.strokeHistory[page.id]);
      if (typeof popPageHistory === 'function') popPageHistory(page.id);
    } else if (finished && !finished.isEraser && window.Collab) {
      // Der fertige Strich geht sofort an die anderen. Erst beim Loslassen –
      // während des Zeichnens wäre es ein Sturm aus Zwischenständen, und der
      // Strich sieht ohnehin erst am Ende richtig aus.
      Collab.noteStroke(page.id, finished);
    }

    S._cur = null; page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[page.id] || []));
    if (!alsAuswahl && window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  });
  div.addEventListener('pointercancel', () => {
    stopLineTimer(S._cur);
    S.isDrawing = false; S._cur = null; S._drawPointerId = null;
    S._rulerKlebt = false;
    clearLiveCanvas();
    if (S.mode === 'eraser' && S._restoreMode) { switchMode(S._restoreMode); S._restoreMode = null; }
  });

  textDiv.addEventListener('pointerdown', e => {
    setActivePg(page.id);
    /* Das gewaehlte Zeichenwerkzeug bleibt stehen. Hier stand frueher ein
       bedingungsloses switchMode('cursor') – damit war das Zeichnen mit
       der Maus unmoeglich: der erste Klick auf die Seite schaltete sofort
       wieder auf Text. */
    if (S.mode !== 'cursor') return;
    textDiv.style.pointerEvents = 'auto';

    if (S.readOnly) return;
    /* Nur die Maus setzt die Marke selbst. Stift und Finger ueberlaesst
       das den Browser: er entscheidet zwischen Antippen und Schieben, und
       nur so bleibt das Scrollen ueber dem Text erhalten. Setzten wir sie
       hier, war jede Bewegung ein Markieren. */
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;

    // Direct clicks on the editor container:
    // normal text hits stay native, free-area hits use corrected manual caret.
    if (textDiv.contains(e.target)) {
      const forceManual = isFreeEditorAreaClick(e.clientX, e.clientY);
      if (forceManual || e.target === textDiv) {
        // No preventDefault to allow selection, but update DOM immediately
        activateTextEditingAt(e.clientX, e.clientY, forceManual);
      }
    }
  });
}

/**
 * Einen begonnenen Strich verwerfen, als haette es ihn nie gegeben.
 *
 * Gebraucht, sobald ein zweiter Finger dazukommt: der will zoomen oder
 * schieben, nicht malen. Ohne das blieb von jedem Doppelgriff ein Strich
 * quer ueber die Seite stehen – der erste Finger zeichnete ja weiter.
 *
 * Der Strich wird wieder herausgenommen, nicht nur beendet: er war ein
 * Versehen, und rueckgaengig machen muesste man ihn sonst von Hand.
 */
function cancelActiveStroke() {
  const stroke = S._cur;
  S.isDrawing = false;
  S._drawPointerId = null;
  S._cur = null;
  clearLiveCanvas();
  if (!stroke) return;
  clearTimeout(stroke._lineTimer);

  const pgId = S.activePgId;
  const liste = pgId ? S.strokeHistory[pgId] : null;
  if (liste) {
    const idx = liste.indexOf(stroke);
    if (idx >= 0) liste.splice(idx, 1);
    const pgEl = document.querySelector('.j-page[data-pgid="' + CSS.escape(pgId) + '"]');
    const canvas = pgEl ? pgEl.querySelector('.j-canvas:not(.live-canvas)') : null;
    if (canvas) redrawStrokes(canvas, liste);
  }
  // Der Zustand vor dem Strich liegt schon auf dem Stapel (handleDrawStart)
  if (typeof popPageHistory === 'function') popPageHistory(pgId);
}

let _liveCanvas = null;
function getLiveCtx(parentDiv, dw = CFG.PAGE_W, dh = CFG.PAGE_H) {
  const dpr = getCanvasDpr();
  if (!_liveCanvas) {
    _liveCanvas = document.createElement('canvas');
    _liveCanvas.className = 'j-canvas live-canvas';
    _liveCanvas.style.cssText = 'pointer-events:none;z-index:11;position:absolute;inset:0;opacity:0.38;';
    _liveCanvas.width = Math.round(dw * dpr); _liveCanvas.height = Math.round(dh * dpr);
    _liveCanvas.style.width = dw + 'px'; _liveCanvas.style.height = dh + 'px';
    const ctx = _liveCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  const expectedW = Math.round(dw * dpr), expectedH = Math.round(dh * dpr);
  if (_liveCanvas.width !== expectedW || _liveCanvas.height !== expectedH) {
    _liveCanvas.width = expectedW;
    _liveCanvas.height = expectedH;
    _liveCanvas.style.width = dw + 'px'; 
    _liveCanvas.style.height = dh + 'px';
    const ctx = _liveCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  if (_liveCanvas.parentElement !== parentDiv) parentDiv.appendChild(_liveCanvas);
  return _liveCanvas.getContext('2d');
}
function clearLiveCanvas() {
  if (_liveCanvas) {
    _liveCanvas.remove();
    _liveCanvas = null;
  }
}

/* Die Vorschau-Fläche liegt mit 38 % Deckkraft da – das ist der Marker.
   Die Schlinge bringt ihre eigene Blässe mit und braucht sie voll. */
function setLiveOpacity(wert) {
  if (_liveCanvas) _liveCanvas.style.opacity = String(wert);
}

/* ══════════════════════════════════════════════════════════════════════
   DIE TASTEN AM STIFTSCHAFT

   Ein Stift meldet seine Tasten als ZWEI verschiedene Dinge:

     button 5  / buttons & 32   das „Radierer-Zeichen"
     button 2  / buttons & 2    die Taste am Schaft („Rechtsklick")

   Bisher hiess beides „radieren". Damit tat die obere Taste dasselbe wie
   die untere, obwohl sie anderswo (Word, OneNote) den Lasso aufzieht.

   >>> Welche Taste welchen Code schickt, steht in keinem Datenblatt <<<
   Es haengt am Treiber, und die naheliegende Annahme war falsch: an dem
   Stift, um den es hier geht, meldet die UNTERE Taste das
   Radierer-Zeichen und die obere den Rechtsklick – nicht umgekehrt.
   Gemessen, nicht geraten; die erste Fassung tat prompt das Gegenteil
   von dem, was draufstand.

   Deshalb: 32 radiert, 2 kreist ein. Ein Stift mit umgedrehtem
   Radierer-Ende meldet ebenfalls 32 und radiert damit auch – das passt.
   Wer bei anderer Hardware nachsehen will: `window.stiftTastenZeigen =
   true` in der Konsole, dann meldet jeder Druck seinen Code.
   ══════════════════════════════════════════════════════════════════════ */
window.stiftTastenZeigen = false;

function istRadierTaste(e) {
  // Beim Stift das Radierer-Zeichen, bei der Maus die rechte Taste
  if (e.pointerType === 'pen') return e.button === 5 || !!(e.buttons & 32);
  return e.button === 2 || !!(e.buttons & 2);
}

function istLassoTaste(e) {
  return e.pointerType === 'pen' && (e.button === 2 || !!(e.buttons & 2));
}

document.addEventListener('pointerdown', e => {
  if (!window.stiftTastenZeigen || e.pointerType !== 'pen') return;
  if (typeof toast === 'function') toast('Stift: button ' + e.button + ', buttons ' + e.buttons);
}, true);

/** Der Strich, mit dem eingekreist wird: duenn und blass, er bleibt nicht. */
function baueLassoStrich(c) {
  return {
    path: [{ x: c.x, y: c.y, p: c.p }],
    color: 'rgba(90,90,110,.7)', width: 1.4, isHL: false, _lasso: true
  };
}

/**
 * Das Zeichenwerkzeug, zu dem der Stift greift, wenn gerade der Zeiger
 * gewaehlt ist. Der Radierer zaehlt nicht dazu: wer ihn zuletzt hatte und
 * dann auf den Zeiger ging, will beim naechsten Aufsetzen schreiben und
 * nicht weglöschen.
 */
function letztesZeichenwerkzeug() {
  const m = S._letzterStift;
  return (m === 'pen1' || m === 'pen2' || m === 'hl') ? m : 'pen1';
}

/**
 * Ist das eine gerade Linie?
 *
 * Nicht ueber die Anzahl der Punkte: eine am Lineal gezogene Linie hat
 * hundert davon und ist trotzdem schnurgerade. Gemessen wird, wie weit
 * der weiteste Punkt von der Verbindung zwischen Anfang und Ende abweicht.
 */
function istGeraderStrich(s) {
  const pts = s && s.path;
  if (!pts || pts.length < 2) return false;
  const a = pts[0], b = pts[pts.length - 1];
  if (Math.hypot(b.x - a.x, b.y - a.y) < 12) return false;
  if (pts.length === 2) return true;
  for (const p of pts) {
    if (pointToLineDistance(p.x, p.y, a.x, a.y, b.x, b.y) > 2.5) return false;
  }
  return true;
}

/**
 * Nimmt eine gerade Linie GANZ weg, statt ein Loch hineinzuradieren.
 *
 * Der Radierer arbeitet sonst punktweise, und das ist bei Handschrift
 * auch richtig. Eine Linie ist aber ein Ding und kein Gekritzel: ein
 * Stueck aus ihrer Mitte herauszuwischen laesst zwei Reste stehen, die
 * niemand haben wollte. Genau so wurde es gemeldet.
 */
function geradeGanzWeg(c, page, canvas) {
  const r = ERASER_SIZES[S.eraser.szIdx];
  const liste = S.strokeHistory[page.id] || [];
  const bleibt = liste.filter(s => {
    if (s === S._cur || s.isEraser || !istGeraderStrich(s)) return true;
    const pts = s.path;
    for (let i = 0; i < pts.length - 1; i++) {
      if (pointToLineDistance(c.x, c.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < r) return false;
    }
    return true;
  });
  if (bleibt.length === liste.length) return;
  S.strokeHistory[page.id] = bleibt;
  redrawStrokes(canvas, bleibt);
  page.inkStrokes = JSON.parse(JSON.stringify(bleibt));
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/* ══════════════════════════════════════════════════════════════════════
   NACH DEM AUSWAEHLEN NICHT AUCH NOCH IN DEN TEXT TIPPEN

   Mit dem Finger etwas auszuwaehlen setzte gleich darauf die
   Schreibmarke in die Zeile darunter – und auf einem Tablet faehrt dann
   die Bildschirmtastatur heraus, obwohl niemand schreiben wollte. Zweimal
   gemeldet: fuer Striche und fuer Formen.

   >>> Warum preventDefault am pointerdown dafuer nicht reicht <<<
   Bei einer BERUEHRUNG entstehen die Maus-Ersatzereignisse nicht aus dem
   Zeiger-, sondern aus dem Beruehrungsereignis. Ein abgewehrtes
   pointerdown haelt sie nicht auf; der Klick kommt trotzdem, und mit ihm
   der Fokus. Abgewehrt werden muss deshalb das mousedown selbst – und nur
   dieses eine, nur wenn es im Text landet.
   ══════════════════════════════════════════════════════════════════════ */
function unterdrueckeTextTipp() {
  const imText = ev => ev.target && ev.target.closest && ev.target.closest('.j-text');

  const aus = () => {
    document.removeEventListener('mousedown', aufMausdruck, true);
    document.removeEventListener('click', aufKlick, true);
    clearTimeout(uhr);
  };
  function aufMausdruck(ev) { if (imText(ev)) { ev.preventDefault(); ev.stopPropagation(); } }
  function aufKlick(ev) { if (imText(ev)) { ev.preventDefault(); ev.stopPropagation(); } aus(); }

  const uhr = setTimeout(aus, 600);
  document.addEventListener('mousedown', aufMausdruck, true);
  document.addEventListener('click', aufKlick, true);

  /* Stand die Marke schon vorher im Text, ist die Tastatur bereits
     draussen – dann hilft nur, den Fokus wirklich abzugeben. */
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains('j-text')) a.blur();
}

// Helper: distance from point to line segment
function pointToLineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function strokeErase(c, page, canvas) {
  const r = ERASER_SIZES[S.eraser.szIdx]; const before = S.strokeHistory[page.id].length;
  S.strokeHistory[page.id] = S.strokeHistory[page.id].filter(s => {
    if (s.isEraser) return true;
    const pts = s.path;
    if (!pts || pts.length === 0) return true;
    // Check all points
    if (pts.some(pt => Math.hypot(pt.x - c.x, pt.y - c.y) < r)) return false;
    // Also check line segments (important for straight lines with few points)
    for (let i = 0; i < pts.length - 1; i++) {
      const dist = pointToLineDistance(c.x, c.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (dist < r) return false;
    }
    return true;
  });
  if (S.strokeHistory[page.id].length < before) {
    redrawStrokes(canvas, S.strokeHistory[page.id]);
    page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[page.id]));
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  }
}

function buildStroke(c) { const m = S.mode; if (m === 'pen1') return { path: [{ x: c.x, y: c.y, p: c.p }], color: S.pen1.color, width: PEN_SIZES[S.pen1.szIdx], isHL: false }; if (m === 'pen2') return { path: [{ x: c.x, y: c.y, p: c.p }], color: S.pen2.color, width: PEN_SIZES[S.pen2.szIdx], isHL: false }; if (m === 'hl') return { path: [{ x: c.x, y: c.y, p: c.p }], color: S.hl.color, width: HL_SIZES[S.hl.szIdx], isHL: true }; return { path: [{ x: c.x, y: c.y, p: c.p }], color: '#000', width: 4, isHL: false }; }
function liveDrawIncr(ctx, c) { const s = S._cur; if (!s) return; const pts = s.path; if (pts.length < 2) return; const prev = pts[pts.length - 2], cur = pts[pts.length - 1]; ctx.save(); ctx.strokeStyle = s.color; ctx.lineWidth = s.isEraser ? s.width : s.width * (0.5 + cur.p); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; if (s.isHL) ctx.globalAlpha = 0.38; if (s.isEraser) ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); if (pts.length >= 3) { const pp = pts[pts.length - 3]; ctx.moveTo((pp.x + prev.x) / 2, (pp.y + prev.y) / 2); ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + cur.x) / 2, (prev.y + cur.y) / 2); } else { ctx.moveTo(prev.x, prev.y); ctx.lineTo(cur.x, cur.y); } ctx.stroke(); ctx.restore(); }

