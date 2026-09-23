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

  /* ══════════════════════════════════════════════════════════════════
     DIE FORM WAECHST, SOLANGE DIE SPITZE UNTEN BLEIBT

     Aus dem gemalten Kreis ist gerade ein Kreis geworden – und die Hand
     liegt noch auf dem Blatt. Genau dieser Augenblick war bisher tot:
     S._cur ist weg, jede weitere Bewegung lief ins Leere, und wer die
     Groesse aendern wollte, musste absetzen, aufs Zeigerwerkzeug
     wechseln, die Form anfassen und an einer Ecke ziehen.

     Naeher heisst jetzt kleiner, weiter heisst groesser. Gemessen wird
     der Abstand zur MITTE der Form – nicht zu einer Kante. Eine Kante
     zoege nur an einer Seite und machte aus dem Kreis ein Ei; die Mitte
     haelt das Verhaeltnis und laesst die Form dort, wo sie gemalt wurde.

     { obj, cx, cy, startW, startH, startAbstand, geaendert }
     ══════════════════════════════════════════════════════════════════ */
  let _formZieht = null;

  /* Steht die Spitze fast auf der Mitte, ist der Abstand ein Zufallswert
     und jeder Millimeter ein Vielfaches davon. Darunter wird deshalb mit
     diesem Mindestmass gerechnet. */
  const FORM_MIN_ABSTAND = 14;   // Seiten-Pixel

  /* ══════════════════════════════════════════════════════════════════
     DAS RECHTECK DER SEITE WIRD EINEN LIDSCHLAG LANG GEMERKT

     coords() rechnet Bildschirm → Seite und holte sich dafür bei JEDER
     Bewegung getBoundingClientRect(). Das ist keine harmlose Abfrage:
     der Browser muss dafür das Layout fertig gerechnet haben und hält
     alles andere so lange an. Ein Stift meldet 120- bis 240-mal in der
     Sekunde – so oft geschah es also auch, und genau davon fühlte sich
     das Schreiben zäh an.

     Gemessen wird deshalb höchstens einmal je Bild (16 ms). Länger darf
     der Wert nicht stehen bleiben: die Seite kann unter dem Strich noch
     rollen oder gezoomt werden, und ein veraltetes Rechteck setzte den
     Strich dann daneben. Ein Bild Verzug sieht niemand, eine ganze
     Sekunde schon. */
  const RECT_HALTBAR_MS = 16;
  let _seitenRect = null;
  let _seitenRectZeit = 0;

  function seitenRect() {
    const jetzt = performance.now();
    if (!_seitenRect || jetzt - _seitenRectZeit > RECT_HALTBAR_MS) {
      _seitenRect = canvas.getBoundingClientRect();
      _seitenRectZeit = jetzt;
    }
    return _seitenRect;
  }

  function activateTextEditingAt(clientX, clientY, forceManual = false) {
    if (S.mode !== 'cursor') switchMode('cursor');
    textDiv.style.pointerEvents = 'auto';
    // Im Nur-Lese-Modus darf der Zeiger stehen (Markieren und Kopieren
    // bleiben möglich), aber es wird nichts gesetzt oder verändert.
    if (S.readOnly) { setActivePg(page.id); return; }

    /* ══════════════════════════════════════════════════════════════
       AUF EIN FREMDES SPERRBAND SETZT SICH GAR KEINE MARKE

       Dort gehört die Zeile jemand anderem. Vorher setzte der Klick die
       Marke trotzdem – placeCaretAnywhere füllte dabei bis dorthin auf
       (und verschob damit die Stellen für alle Beteiligten, auch die
       Sperre selbst), und erst der Takt in ui/collab.js schob sie
       wieder heraus. Das Aufgefüllte blieb stehen.

       Jetzt passiert an dieser Stelle schlicht nichts, und die Marke
       verschwindet sichtbar: es ist nichts da, wo man nichts darf.
       ══════════════════════════════════════════════════════════════ */
    const pgEl = textDiv.closest('[data-pgid]');
    const sperrt = (window.Collab && typeof Collab.trifftSperrband === 'function')
      ? Collab.trifftSperrband(clientX, clientY, pgEl) : null;
    if (sperrt) {
      Collab.markeWeg(textDiv);
      // Sagen, wem die Zeile gehört – warnLocked hält den Takt selbst ein
      if (typeof Collab.warnLocked === 'function') Collab.warnLocked(sperrt);
      setActivePg(page.id);
      return;
    }

    /* >>> Weitergereicht wird jetzt die ehrliche Auskunft <<<
       Hier stand `forceManual || richMode`: auf einer Seite mit Absätzen
       wurde die Marke IMMER von Hand gesetzt, auch mitten in einem Wort.
       placeCaretAnywhere musste sich die Stelle im Wort dann aus
       Zeilenhöhe und Zeichenbreite ausrechnen – und rechnete sie bei
       jeder Schrift, die nicht gleichmässig breit ist, daneben.

       Trifft der Klick ein Zeichen, weiss der Browser die Stelle genau.
       Von Hand gesetzt wird nur, was auf FREIER Fläche liegt – und dort
       gibt es kein Zeichen, das man verfehlen könnte. */
    placeCaretAnywhere(textDiv, clientX, clientY, forceManual, page);
    setActivePg(page.id);
  }

  /* ══════════════════════════════════════════════════════════════════
     DER MAGNET

     Wer knapp neben ein Wort klickt, will fast immer AN das Wort und
     nicht daneben. Vorher galten zwei Pixel als „getroffen"; alles
     darueber legte einen frei stehenden Absatz an, und man stand mit
     der Marke einen Fingerbreit neben dem Text, wo man doch hinein
     wollte.

     Jetzt zieht der Text auf etwa einem Zentimeter an. Waagerecht,
     nicht senkrecht: nach oben und unten bleibt es eng, sonst risse
     eine Zeile die Marke aus der Zeile darunter zu sich herueber.

     Gemessen wird in Bildschirm-Pixeln, deshalb wird der Zentimeter mit
     dem Zoom der Seite mitskaliert – sonst haftete es bei 50 % doppelt
     so weit wie bei 100 %. */
  const ANHAFT_MM = 10;
  const PX_PRO_MM = 96 / 25.4;            // CSS rechnet mit 96 dpi

  function anhaftPx() {
    const r = textDiv.getBoundingClientRect();
    const zoom = textDiv.offsetWidth > 0 ? (r.width / textDiv.offsetWidth) : 1;
    return ANHAFT_MM * PX_PRO_MM * zoom;
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
      const rects = beschriebeneKaesten();
      if (!rects.length) return true;

      const haft = anhaftPx();
      /* ── Senkrecht zieht die ganze Zeile an, nicht nur die Zeichen ──
         Der Kasten um die Zeichen ist niedriger als der Zeilenabstand:
         bei 17 px Schrift auf 32 px Zeile sind es 18,5 px, also gut
         sechs Pixel Luft über und unter dem Text. Wer dort klickte,
         galt als „daneben" und bekam einen frei stehenden Absatz mitten
         auf einer beschriebenen Zeile. Von aussen sah das aus, als
         hafte der Text mal an und mal nicht.

         Die Luft wird an der Zeile gemessen und nicht geraten – so
         bleibt sie bei einer Überschrift, die höhere Zeichen hat,
         entsprechend kleiner und greift nie in die Nachbarzeile. */
      const lh = parseFloat(getComputedStyle(textDiv).lineHeight) || 32;
      const zoom = textDiv.offsetHeight > 0 ? (divRect.height / textDiv.offsetHeight) : 1;
      const trifftText = rects.some(rc => {
        const luft = Math.max(1, (lh * zoom - rc.height) / 2);
        return rc.width > 1 &&
          clientX >= rc.left - haft &&
          clientX <= rc.right + haft &&
          clientY >= rc.top - luft &&
          clientY <= rc.bottom + luft;
      });
      return !trifftText;
    } catch (err) {
      return true;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     WO STEHEN AUF DIESER SEITE WIRKLICH ZEICHEN?

     >>> Warum nicht mehr über den ganzen Inhalt <<<
     Hier stand ein Bereich über den gesamten Inhalt von .j-text und
     dessen getClientRects(). Für einen ABSATZ liefert das aber den
     ganzen Kasten – über die volle Breite der Seite, auch dort, wo
     hinter dem letzten Wort nichts mehr steht.

     Damit galt jeder Klick auf der Höhe einer beschriebenen Zeile als
     Klick auf Text, und die Marke ging an das nächstgelegene Zeichen –
     an den Anfang oder ans Ende der Zeile. Genau so wurde es gemeldet:
     „sobald etwas geschrieben wurde, kann man nicht mehr hin, wo man
     möchte."

     Gefragt wird deshalb Textknoten für Textknoten. Deren Rechtecke
     liegen eng um die Zeichen; rechts und links davon ist wieder freie
     Fläche, und dort setzt placeCaretAnywhere die Marke genau dorthin,
     wo gezeigt wurde.

     Bilder, Tabellen und Trennlinien tragen keinen Text, sind aber
     trotzdem etwas: sie zählen mit ihrem Kasten mit.
     ══════════════════════════════════════════════════════════════════ */
  function beschriebeneKaesten() {
    const kaesten = [];
    const lauf = document.createTreeWalker(textDiv,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const bereich = document.createRange();

    for (let n = lauf.nextNode(); n; n = lauf.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (!n.nodeValue || !n.nodeValue.length) continue;
        bereich.selectNodeContents(n);
        for (const rc of bereich.getClientRects()) kaesten.push(rc);
      } else if (n.tagName === 'IMG' || n.tagName === 'TABLE' || n.tagName === 'HR') {
        kaesten.push(n.getBoundingClientRect());
      }
    }
    return kaesten;
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
  /* ══════════════════════════════════════════════════════════════════
     WIE WEIT EIN STRICH GEKOMMEN SEIN MUSS, BEVOR ER EINRASTEN DARF

     >>> Warum es diese Grenze gibt <<<
     Ohne sie rastete JEDER Strich ein, der lange genug stillstand – auch
     ein winziger. Und beim sorgfältigen Schreiben steht der Stift oft
     still: der Punkt auf dem i, der Querstrich am t, ein Komma, das
     Ansetzen einer kleinen Schleife. Sobald die Uhr dabei ablief, fiel
     der ganze bisherige Strich auf eine gerade Linie zwischen Anfang und
     jetziger Stelle zusammen – alles dazwischen war weg, und ab da wurde
     nichts mehr aufgezeichnet, denn der Strich blieb festgestellt.

     Von aussen sieht das aus wie „manchmal verschwindet, was ich
     zeichne" und „manchmal zeichnet es nicht alles". Genau so ist es
     gemeldet worden.

     Wer eine Gerade WILL, zieht sie über eine ordentliche Strecke. Ein
     Buchstabe kommt nie über diese Grenze.
     ══════════════════════════════════════════════════════════════════ */
  const LINIE_MIN_WEG = 46;      // gelaufene Strecke, Seiten-Pixel
  const LINIE_MIN_SPANNE = 30;   // Abstand Anfang ↔ Ende

  /**
   * Liegt das Ende wieder beim Anfang? Dann ist der Strich eine Runde
   * und keine Strecke.
   *
   * Gemessen am gelaufenen Weg und nicht an einer festen Zahl: ein
   * kleiner Kreis darf ebenso geschlossen sein wie ein grosser.
   */
  function istGeschlossen(stroke) {
    const pts = stroke && stroke.path;
    if (!pts || pts.length < 2) return false;
    let weg = 0;
    for (let i = 1; i < pts.length; i++) {
      weg += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (weg <= 0) return false;
    const a = pts[0], b = pts[pts.length - 1];
    return Math.hypot(b.x - a.x, b.y - a.y) < weg * 0.3;
  }

  function langGenugFuerLinie(stroke) {
    const pts = stroke && stroke.path;
    if (!pts || pts.length < 2) return false;

    let weg = 0;
    for (let i = 1; i < pts.length; i++) {
      weg += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (weg < LINIE_MIN_WEG) return false;

    /* Bei einer FORM liegen Anfang und Ende dicht beieinander – die
       Spanne darf sie deshalb nicht ausschliessen. Ob daraus dann
       wirklich eine Form wird, entscheidet die Uhr; was NICHT wird,
       fängt sie jetzt auch selbst ab (siehe dort). */
    if (istGeschlossen(stroke)) return true;

    const a = pts[0], b = pts[pts.length - 1];
    return Math.hypot(b.x - a.x, b.y - a.y) >= LINIE_MIN_SPANNE;
  }

  function armLineTimer(stroke, punkt) {
    if (!stroke || stroke.isEraser || stroke._lasso) return;

    /* Die Uhr wird zoomabhängig gemessen: HALTE_ZITTERN sind
       Seiten-Pixel, und bei starker Vergrösserung entspricht das einer
       viel grösseren Strecke auf dem Schirm. Ein zoomender Nutzer stand
       dadurch fast immer „still", und die Uhr lief bei jedem zweiten
       Strich ab. */
    const zoom = (typeof getZoom === 'function' ? getZoom() : 1) || 1;
    const zittern = HALTE_ZITTERN / zoom;

    if (punkt && _halteBei && stroke._lineTimer
        && Math.hypot(punkt.x - _halteBei.x, punkt.y - _halteBei.y) < zittern) {
      return;   // gilt noch als Stillstand – die laufende Uhr darf zu Ende gehen
    }
    clearTimeout(stroke._lineTimer);
    _halteBei = punkt ? { x: punkt.x, y: punkt.y } : null;
    stroke._lineTimer = setTimeout(() => {
      if (!S.isDrawing || S._cur !== stroke) return;

      /* Zu kurz? Dann war das kein Halten, sondern Schreiben. Die Uhr
         wird neu aufgezogen, statt aufzugeben: wer weiterzieht und DANN
         stehen bleibt, soll seine Gerade trotzdem bekommen. */
      if (!langGenugFuerLinie(stroke)) {
        _halteBei = null;
        stroke._lineTimer = null;
        return;
      }

      stroke._lineLocked = true;
      const pts = stroke.path || [];
      if (pts.length <= 1) return;

      /* ── Erst nach einer FORM sehen, dann die Gerade ────────────────
         Dieselbe Geste trägt beides: wer am Ende stehen bleibt, bekommt
         aus einem gemalten Kreis einen Kreis und aus allem anderen die
         Gerade, die es hier schon immer gab.

         Die Reihenfolge muss so sein. Eine geschlossene Rundung würde
         als Gerade zu einem Strich zwischen Anfang und Ende zusammen-
         fallen – also fast zu nichts, denn bei einer Form liegen die
         beiden aufeinander. Genau deshalb prüft erkenneForm() als
         Erstes, ob der Strich überhaupt geschlossen ist
         (canvas/shapeSnap.js).

         Ein Marker wird nie zur Form: mit ihm fährt man um Wörter
         herum, um sie hervorzuheben, nicht um einen Kreis zu malen. */
      const form = (!stroke.isHL && typeof InkwellsShapeSnap !== 'undefined')
        ? InkwellsShapeSnap.erkenneForm(stroke) : null;

      if (form && machDarausEinObjekt(stroke, form)) return;

      /* ═════════════════════════════════════════════════════════════
         WAS EINE RUNDE WAR, WIRD KEINE GERADE

         >>> Hier verschwanden die Striche <<<
         Gemeldet: „ich ziehe eine Linie, halte für eine Form – und die
         Linie ist weg.“ Genau das steht hier.

         Der Weg dorthin: langGenugFuerLinie lässt einen GESCHLOSSENEN
         Strich durch, ohne auf die Spanne zu sehen – richtig, denn bei
         einer Form liegen Anfang und Ende aufeinander. Erkennt
         erkenneForm() die Form dann aber NICHT (fünf Ecken statt vier,
         eine zu flache Ellipse, eine Schleife), fiel der Strich in den
         Zweig darunter: Pfad = [Anfang, Ende]. Bei einer Runde liegen
         die beiden aufeinander – aus dem ganzen Gemalten wurde ein
         Punkt von null Länge. Weg.

         Also: bleibt es eine Runde, bleibt sie stehen, wie sie gemalt
         wurde. Die Uhr wird dabei nicht festgestellt (_lineLocked bleibt
         aus) – wer weiterzieht und die Runde wieder öffnet, bekommt
         seine Gerade danach trotzdem.
         ═════════════════════════════════════════════════════════════ */
      if (istGeschlossen(stroke)) {
        stroke._lineLocked = false;
        _halteBei = null;
        stroke._lineTimer = null;
        return;
      }

      stroke._shapeDetected = false;
      stroke.isGeometric = false;
      const start = pts[0], end = pts[pts.length - 1];
      stroke.path = [start, end];

      /* Der Strich liegt noch auf der Vorschau, nicht auf der Seite –
         also wird auch nur sie neu gezeichnet. Ein redrawStrokes hier
         brachte ihn ein zweites Mal auf die Seite, und beim Marker
         hiesse zweimal: doppelt so kraeftig. */
      // Ein angemeldetes Bild traegt noch die krumme Fassung – weg damit
      stopVorschau();
      stiftVorschau(stroke);
    }, LINE_HOLD_MS);
  }

  function stopLineTimer(stroke) {
    if (!stroke) return;
    clearTimeout(stroke._lineTimer);
    stroke._lineTimer = null;
  }

  /* ══════════════════════════════════════════════════════════════════
     AUS DEM GEMALTEN STRICH WIRD EIN FORM-OBJEKT

     >>> Warum ein Objekt und nicht ein glattgezogener Strich <<<
     Zuerst blieb es ein Strich mit sauberen Punkten – das schien
     bescheidener, und man konnte ihn radieren wie jedes Gekritzel.
     Gemeldet wurde genau das als Fehler: „Formen verhalten sich wie
     Linien, sie sollten sich wie Formen verhalten." Stimmt. Wer die
     Geste macht, will einen Kreis und alles, was dazugehört –
     Füllfarbe, Linienfarbe, Linienstärke, an den Ecken ziehen, drehen.
     Nichts davon kann ein Strich.

     Farbe und Strichstärke kommen aus dem STIFT, mit dem gemalt wurde.
     Alles andere wäre eine Überraschung: man hat gerade rot gezeichnet,
     und plötzlich steht dort etwas Schwarzes. Die Füllung bleibt leer –
     gemalt hat man einen Umriss.

     @returns {boolean} true, wenn daraus wirklich ein Objekt wurde
     ══════════════════════════════════════════════════════════════════ */
  const FORM_ART = { ellipse: 'ellipse', viereck: 'rect', dreieck: 'triangle' };

  function machDarausEinObjekt(stroke, form) {
    if (typeof placeObject !== 'function' || typeof uid !== 'function') return false;
    const art = FORM_ART[form.art];
    if (!art || !form.kasten) return false;

    const k = form.kasten;
    const obj = {
      id: uid(),
      kind: 'shape',
      shapeType: art,
      x: Math.round(k.x1),
      y: Math.round(k.y1),
      w: Math.max(12, Math.round(k.b)),
      h: Math.max(12, Math.round(k.h)),
      rot: 0,
      fill: 'none',
      stroke: stroke.color || '#1a1510',
      strokeWidth: Math.max(1, Math.round((stroke.width || 2) * 10) / 10),
      layer: 'front'
    };

    // Der Strich selbst hat ausgedient – an seine Stelle tritt die Form
    S.strokeHistory[page.id] = (S.strokeHistory[page.id] || []).filter(s => s !== stroke);
    stroke._wurdeForm = true;

    /* Nur S._cur weg, S.isDrawing NICHT anfassen: pointerup steigt sonst
       gleich in der ersten Zeile aus und lässt den gefangenen Zeiger und
       den vorübergehend gewechselten Modus stehen. Mit S._cur = null
       läuft es normal durch und überspringt alles, was einen Strich
       bräuchte – gezeichnet wird ab jetzt trotzdem nichts mehr, denn
       jede Bewegung fragt vorher nach S._cur. */
    S._cur = null;

    (page.objects || (page.objects = [])).push(obj);
    page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[page.id] || []));

    clearLiveCanvas();
    redrawStrokes(canvas, S.strokeHistory[page.id]);
    placeObject(objLayer, obj, page);

    /* Die Spitze ist noch unten – ab jetzt bestimmt sie die Groesse
       (siehe der Kasten bei _formZieht und ziehFormWeiter). Als
       Ausgangsabstand gilt die Stelle, an der stillgehalten wurde; sie
       steht in _halteBei, weil genau sie die Uhr hat ablaufen lassen. */
    const spitze = _halteBei || (stroke.path && stroke.path[stroke.path.length - 1]);
    const mx = obj.x + obj.w / 2, my = obj.y + obj.h / 2;
    _formZieht = {
      obj, cx: mx, cy: my,
      startW: obj.w, startH: obj.h,
      startAbstand: Math.max(FORM_MIN_ABSTAND,
        spitze ? Math.hypot(spitze.x - mx, spitze.y - my) : FORM_MIN_ABSTAND),
      geaendert: false
    };

    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
    return true;
  }

  /**
   * Die eben entstandene Form auf den Abstand zur Spitze bringen.
   *
   * @param {{x:number,y:number}} c  Stelle der Spitze, in Seiten-Pixeln
   * @returns {boolean} true, solange eine Form am Zeiger haengt
   */
  function ziehFormWeiter(c) {
    const z = _formZieht;
    if (!z) return false;

    const abstand = Math.max(FORM_MIN_ABSTAND, Math.hypot(c.x - z.cx, c.y - z.cy));
    /* Nach oben und unten begrenzt: ein Faktor von 30 waere eine Form,
       die das Blatt zehnmal ueberdeckt, einer von 0,02 ein Staubkorn. */
    const faktor = Math.min(6, Math.max(0.2, abstand / z.startAbstand));

    const o = z.obj;
    const nw = Math.max(12, Math.round(z.startW * faktor));
    const nh = Math.max(12, Math.round(z.startH * faktor));
    if (nw === o.w && nh === o.h) return true;

    o.w = nw; o.h = nh;
    o.x = Math.round(z.cx - nw / 2);
    o.y = Math.round(z.cy - nh / 2);
    // Aus der Mitte heraus gewachsen kann sie ueber den Rand geraten
    if (typeof haltAufBlatt === 'function') haltAufBlatt(o, page);
    z.geaendert = true;

    const wrap = objLayer && objLayer.querySelector(
      '.obj-wrap[data-objid="' + CSS.escape(String(o.id)) + '"]');
    if (wrap) {
      wrap.style.left = o.x + 'px';
      wrap.style.top = o.y + 'px';
      wrap.style.width = o.w + 'px';
      wrap.style.height = o.h + 'px';
    }
    return true;
  }

  /** Die Spitze hebt ab: was gewachsen ist, gilt und geht an die anderen. */
  function beendeFormZug() {
    const z = _formZieht;
    _formZieht = null;
    if (!z) return;
    if (!z.geaendert) return;
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    if (typeof noteObjectChanged === 'function') noteObjectChanged();
  }

  function coords(e) {
    const r = seitenRect();
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

  /* ══════════════════════════════════════════════════════════════════
     DER LAUFENDE STRICH WIRD IN EINEM ZUG GEZEICHNET

     >>> Warum die duenne Linie pixelig aussah <<<
     Gemeldet: „mit einer ganz duennen Einstellung sieht das Geschriebene
     komisch aus, so pixelig." Der Grund stand in liveDrawIncr: bei jeder
     Bewegung wurde nur das NEUE Stueck auf die Seite gemalt, ueber das
     vorige hinweg. Die Kantenglaettung deckt sich dabei jedes Mal mit
     sich selbst – dieselben Randpixel bekommen zwei, drei, vier Anstriche
     und laufen voll. Bei 1,2 px Strichbreite ist der Rand fast der ganze
     Strich: er wird fleckig, dicker als bestellt und ausgefranst.

     Und er BLIEB so. redrawStrokes lief beim Abheben nur fuer Marker und
     Radierer; die zusammengestueckelte Fassung stand also auf der Seite,
     bis irgendetwas anderes sie neu zeichnete – ein Zoom, ein Blaettern.
     Danach sah derselbe Strich ploetzlich sauber aus.

     Jetzt entsteht der laufende Strich auf der VORSCHAU-Flaeche, und zwar
     jedes Bild als EIN Pfad von Anfang bis Ende: eine Glaettung, keine
     Ueberdeckung. Beim Abheben wird die Flaeche geleert und die Seite
     einmal richtig neu gezeichnet – was man beim Schreiben sieht, ist
     damit genau das, was stehen bleibt.
     ══════════════════════════════════════════════════════════════════ */
  function stiftVorschau(stroke, vorhersage) {
    if (!stroke) return;
    const pw = page.w || CFG.PAGE_W;
    const ph = page.h || CFG.PAGE_H;
    const lctx = getLiveCtx(div, pw, ph);
    // Die 38 % gehoeren dem Marker; alles andere deckt
    setLiveOpacity(stroke.isHL ? 0.38 : 1);

    /* ── Geleert wird nur, wo etwas stand ──────────────────────────
       Hier stand clearRect ueber das ganze Blatt. Bei zwei- bis
       dreifacher Bildpunktdichte sind das gut acht Millionen Punkte –
       je Bild, und das neben dem Zeichnen des Strichs selbst. Genau
       diese Sorte Arbeit macht sich als Nachlaufen der Spitze
       bemerkbar, und je laenger man schreibt, desto mehr.

       Gemerkt wird deshalb der Kasten, in dem zuletzt gezeichnet
       wurde; geleert wird er und sonst nichts. Ein Kasten reicht: auf
       der Vorschau liegt immer nur EIN Strich. */
    const alt = stroke._vorschauKasten;
    if (alt) lctx.clearRect(alt.x, alt.y, alt.w, alt.h);

    /* Die vorhergesagten Punkte werden nur GEZEICHNET, nicht behalten:
       angehaengt, gezeichnet, wieder abgeschnitten. Was gespeichert
       wird, ist ausschliesslich das, was die Hand wirklich getan hat. */
    const dazu = (vorhersage && vorhersage.length) ? vorhersage : null;
    if (dazu) for (const p of dazu) stroke.path.push(p);
    try {
      lctx.save();
      applyStrokeStyles(lctx, stroke);
      traceStrokePath(lctx, stroke);
      lctx.restore();
      stroke._vorschauKasten = strichKasten(stroke, pw, ph);
    } finally {
      if (dazu) stroke.path.length -= dazu.length;
    }
  }

  /** Der Kasten um einen Strich, mit Platz fuer Strichbreite und Kanten. */
  function strichKasten(stroke, pw, ph) {
    const pts = stroke.path;
    if (!pts || !pts.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of pts) {
      if (p.x < x1) x1 = p.x;
      if (p.x > x2) x2 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.y > y2) y2 = p.y;
    }
    // Die halbe Strichbreite plus zwei Punkte fuer die Kantenglaettung
    const luft = (stroke.width || 2) / 2 + 2;
    x1 = Math.max(0, Math.floor(x1 - luft));
    y1 = Math.max(0, Math.floor(y1 - luft));
    x2 = Math.min(pw, Math.ceil(x2 + luft));
    y2 = Math.min(ph, Math.ceil(y2 + luft));
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
  }

  /* ══════════════════════════════════════════════════════════════════
     EIN BILD, EIN STRICH

     >>> Gemeldet: „oft kommt die Zeichnung spaeter, als ich sie
     geschrieben habe" <<<
     Ein Stift meldet sich 120- bis 240-mal je Sekunde, der Bildschirm
     zeigt 60 Bilder. Die ueberzaehligen Meldungen haengt der Browser an
     ein pointermove an (getCoalescedEvents) – das wurde hier schon
     richtig abgeholt. Ausgeliefert werden die Buendel aber trotzdem
     oefter als einmal je Bild, und JEDES zeichnete die ganze Vorschau
     neu. Zwei bis vier vollstaendige Zeichnungen fuer ein einziges
     Bild: die letzte sieht man, die davor sind verlorene Zeit – und
     genau diese Zeit fehlt der Spitze.

     Die Punkte werden deshalb weiterhin bei JEDER Meldung angehaengt
     (nichts geht verloren), gezeichnet wird aber erst, wenn der
     Browser das naechste Bild anfordert.
     ══════════════════════════════════════════════════════════════════ */
  let _vorschauBild = 0, _vorschauStrich = null, _vorschauPunkte = null;

  function planeVorschau(stroke, vorhersage) {
    _vorschauStrich = stroke;
    _vorschauPunkte = vorhersage || null;
    if (_vorschauBild) return;
    _vorschauBild = requestAnimationFrame(() => {
      _vorschauBild = 0;
      const s = _vorschauStrich;
      _vorschauStrich = null;
      // Zwischenzeitlich abgehoben oder abgebrochen: nichts mehr zu malen
      if (!s || S._cur !== s) return;
      stiftVorschau(s, _vorschauPunkte);
      _vorschauPunkte = null;
    });
  }

  /** Vor dem Leeren der Flaeche: ein angemeldetes Bild darf nicht mehr kommen. */
  function stopVorschau() {
    if (_vorschauBild) cancelAnimationFrame(_vorschauBild);
    _vorschauBild = 0;
    _vorschauStrich = null;
    _vorschauPunkte = null;
  }

  /* ══════════════════════════════════════════════════════════════════
     EIN STÜCK VORAUS – SO HOLT WORD DIE TINTE AN DIE SPITZE

     Zwischen dem Aufsetzen der Spitze und dem Bild auf dem Schirm liegen
     immer ein paar Millisekunden: melden, rechnen, zeichnen, anzeigen.
     Ganz wegbekommt sie niemand. Windows Ink und OneNote machen deshalb
     etwas anderes – sie RATEN, wo die Spitze im nächsten Augenblick sein
     wird, und malen schon einmal bis dorthin. Der Strich holt die Spitze
     damit ein, obwohl die Rechnerei genauso lange dauert wie vorher.

     Chromium rechnet dieselbe Vorhersage aus und legt sie an jedes
     pointermove (getPredictedEvents). Sie kostet uns also nichts als das
     Abholen.

     >>> Warum nur zwei Punkte und nur bei Tempo <<<
     Geraten wird an einer Kurve zwangsläufig zu weit; je weiter voraus,
     desto mehr. Zwei Punkte sind gut eine Sechzigstelsekunde – genug,
     um es zu merken, zu wenig, um daneben zu liegen. Und wer langsam
     zieht, hat gar keinen Rückstand zu verstecken: dort wäre die
     Vorhersage nur ein Zappeln an der Spitze. Sie bleibt deshalb aus,
     solange sich wenig bewegt.

     Falsch geraten ist billig: der nächste Durchlauf leert die Fläche
     und zeichnet neu, und in den Strich selbst kommt nie ein geratener
     Punkt (siehe stiftVorschau).
     ══════════════════════════════════════════════════════════════════ */
  const VORHERSAGE_MAX = 2;
  const VORHERSAGE_AB_TEMPO = 1.5;   // Seiten-Pixel je Meldung

  function vorhergesagtePunkte(e, stroke) {
    if (typeof e.getPredictedEvents !== 'function') return null;
    if (stroke._lineLocked || stroke.isEraser) return null;

    /* ── Am Lineal wird nicht geraten ─────────────────────────────────
       Zwei Gruende. Der Strich liegt dort ohnehin auf einer Kante, ein
       Stueck voraus sieht also genauso aus wie das Stueck davor. Und
       amLinealAusrichten fuehrt nebenbei Buch darueber, ob der Strich
       gerade an der Kante KLEBT (S._rulerKlebt) – ein geratener Punkt
       wuerde in diesem Buch stehen wie ein echter und die Hysterese
       durcheinanderbringen, die genau das verhindern soll. */
    if (window.getRulerState && window.getRulerState()) return null;

    const pts = stroke.path;
    if (pts.length < 2) return null;
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < VORHERSAGE_AB_TEMPO) return null;

    let roh;
    try { roh = e.getPredictedEvents(); } catch (err) { return null; }
    if (!roh || !roh.length) return null;

    const raus = [];
    for (let i = 0; i < roh.length && raus.length < VORHERSAGE_MAX; i++) {
      const c = coords(roh[i]);
      raus.push({ x: c.x, y: c.y, p: c.p });
    }
    return raus.length ? raus : null;
  }

  /* ══════════════════════════════════════════════════════════════════
     AUS ZITTERN WIRD SCHRIFT

     Zwei kleine Handgriffe, die zusammen den Unterschied machen zwischen
     „gescanntem Gekritzel" und dem, was Word und OneNote aus derselben
     Hand machen:

     1. WAS ZU NAH LIEGT, KOMMT NICHT DAZU. Eine ruhig gehaltene Spitze
        meldet 240-mal je Sekunde eine Stelle, die sich um Bruchteile
        eines Pixels bewegt hat. Diese Punkte tragen nichts bei – sie
        machen die Kurve nur unruhig und den Strich lang.

     2. DER VORLETZTE PUNKT RUECKT ZU SEINEN NACHBARN. Ein leichter
        Mittelwert (1:2:1) nimmt das Zittern heraus, das jede Hand hat.

     >>> Warum der VORLETZTE und nicht der letzte <<<
     Der letzte Punkt ist die Stelle, an der die Spitze GERADE steht.
     Wer den verschiebt, laesst den Strich hinter dem Stift herlaufen –
     und genau darueber wurde schon einmal geklagt. Der vorletzte liegt
     bereits fest, ihn zurechtzuruecken sieht niemand als Verzoegerung.
     Jeder Punkt wird dabei genau einmal angefasst, nicht bei jeder
     Bewegung erneut: sonst wanderte die Schrift mit der Zeit in sich
     zusammen.
     ══════════════════════════════════════════════════════════════════ */
  const PUNKT_MIN_ABSTAND = 0.6;   // Bildschirm-Pixel

  function weitGenugWeg(pts, c) {
    const letzter = pts[pts.length - 1];
    if (!letzter) return true;
    const zoom = (typeof getZoom === 'function' ? getZoom() : 1) || 1;
    const schwelle = PUNKT_MIN_ABSTAND / zoom;
    return Math.hypot(c.x - letzter.x, c.y - letzter.y) >= schwelle;
  }

  function glaetteVorletzten(pts) {
    const n = pts.length;
    if (n < 3) return;
    const a = pts[n - 3], b = pts[n - 2], c = pts[n - 1];
    b.x = (a.x + 2 * b.x + c.x) / 4;
    b.y = (a.y + 2 * b.y + c.y) / 4;
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

    // Ein neuer Strich beendet einen offen gebliebenen Form-Zug
    beendeFormZug();

    const radiert = istRadierTaste(e);
    const lasso = !radiert && istLassoTaste(e);

    if (radiert) {
      if (S.mode !== 'eraser') { S._restoreMode = S.mode; switchMode('eraser'); }
    } else if (S._restoreMode) {
      S._restoreMode = null;
    }
    S._drawPointerId = e.pointerId;
    // Ein Strich der Hand wird verworfen, sobald der Stift kommt (app.js)
    S._drawPointerTyp = e.pointerType;
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
      /* Der Radierer arbeitet auf der Seite selbst – er nimmt weg
         (destination-out), und wegnehmen kann man nur dort, wo etwas
         liegt. Alles andere entsteht auf der Vorschau (stiftVorschau). */
      if (stroke.isEraser) {
        const ctx = canvas.getContext('2d'); ctx.save(); ctx.fillStyle = stroke.color;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(c.x, c.y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else {
        stiftVorschau(stroke);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     MARKIEREN DARF NEBEN DEM TEXT ANFANGEN

     >>> Gemeldet: „wenn man nicht genau auf den Anfang des Textes
     klickt, wird nichts ausgewaehlt" <<<
     Und die Vermutung dazu stimmte: es lag ausserhalb des Textfeldes.
     .j-text ist die Textspalte, nicht die Seite – links davon liegen
     72 Pixel Rand, rechts 32, oben und unten noch mehr. Wer eine Zeile
     markieren will, setzt aber genau dort an: im Rand daneben, und
     zieht dann quer darueber.

     Der Browser markiert nur, wenn der Druck IM bearbeitbaren Feld
     angefangen hat. Im Rand fing er also nie an, und es sah aus, als
     muesse man das erste Zeichen auf den Punkt treffen.

     Das Ziehen wird deshalb selbst gefuehrt. Anfangs nur von dort, im
     Text blieb es beim Browser – inzwischen auch dort, siehe IN
     LESERICHTUNG weiter unten.

     >>> Der Punkt wird in die Spalte hineingeschoben <<<
     Ein Punkt im Rand gehoert zu keinem Zeichen. Statt dort aufzugeben,
     wird er auf die naechste Stelle INNERHALB der Spalte geklemmt – und
     das ist genau die Stelle, die man meint: links vom Text der
     Zeilenanfang, rechts davon das Zeilenende, unterhalb das Ende des
     Textes.

     >>> Und auch IN der Spalte, neben dem Zeilenende <<<
     Gemeldet ein zweites Mal: „man muss genau beim letzten Zeichen
     sein". Rechts neben einer kurzen Zeile, zwischen frei stehenden
     Absaetzen oder unter dem Text liegt der Druck zwar im Feld, aber auf
     keinem Zeichen – und genau dort bricht der mousedown-Hoerer unten den
     Browser ab, damit er die Marke nicht an den Anfang setzt. Mit der
     Marke fiel dabei das Markieren weg. Von dort fuehrt das Ziehen jetzt
     ebenfalls dieser Lauf (siehe den pointerdown-Hoerer an textDiv).

     Der Treffertest hilft dort nicht weiter: neben einem frei stehenden
     Absatz antwortet er mit „das Feld selbst, Stelle N", und das ist
     irgendwo. Gefragt wird dann die naechste geschriebene Zeile – wie
     beim Setzen der Marke (canvas/text.js, placeCaretAnywhere).
     ══════════════════════════════════════════════════════════════════ */
  const MARKIER_WEG = 4;      // so weit muss der Zeiger, damit es zaehlt
  let _markieren = null;

  /* Eine Stelle, von der aus sich markieren laesst: im Text, aber weder
     das Feld selbst noch der Absatz, den der Klick eben erst angelegt hat
     – der verschwindet, sobald gezogen wird. */
  function markierbareStelle(knoten) {
    if (!knoten || knoten === textDiv || !textDiv.contains(knoten)) return false;
    for (let n = knoten; n && n !== textDiv; n = n.parentNode) {
      if (n[VORLAEUFIG]) return false;
    }
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════
     IN LESERICHTUNG, ZEILE FUER ZEILE

     >>> Gemeldet: „markiere ich Woerter auf verschiedenen Hoehen von
     unten nach oben, springt die Markierung auf andere Woerter" <<<
     Gemessen waren es zwei Dinge:

       · Der Treffertest des Browsers weiss ueber leerer Flaeche nichts.
         Die Markierung blieb stehen, solange der Zeiger zwischen den
         Absaetzen war – neun Schritte lang „unten rec" – und sprang dann.
       · Eine Markierung reicht im DOM von hier bis dort, und freie
         Absaetze stehen dort in der Reihenfolge ihres Anlegens. Nach
         „unten rechts" angelegt, kam „oben links" sofort mit
         („htsoben "), obwohl dazwischen die halbe Seite lag.

     Gesucht wird die Stelle deshalb selbst: erst die REIHE, die dem
     Zeiger senkrecht am naechsten liegt, in ihr die Zeile, die ihm
     waagerecht am naechsten liegt, und darin die Stelle im Wort. Sobald
     gezogen wird, stehen die freien Absaetze im DOM in Leserichtung
     (canvas/text.js, freieAbsaetzeInLeserichtung).

     Gilt fuer JEDES Ziehen mit der Maus, auch fuer das auf einem Zeichen
     angefangene: der Browser liess sich mitten im Zug nicht mehr
     ablösen, und zwei, die dieselbe Markierung setzen, zappeln.
     ══════════════════════════════════════════════════════════════════ */

  /** Alle geschriebenen Zeilen, bezogen auf das Textfeld. */
  function messeZeilen() {
    const r = textDiv.getBoundingClientRect();
    const zeilen = [];
    const bereich = document.createRange();
    const lauf = document.createTreeWalker(textDiv, NodeFilter.SHOW_TEXT);
    for (let n = lauf.nextNode(); n; n = lauf.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.trim() || !markierbareStelle(n)) continue;
      bereich.selectNodeContents(n);
      for (const rc of bereich.getClientRects()) {
        if (rc.width <= 1) continue;
        zeilen.push({ knoten: n, l: rc.left - r.left, r: rc.right - r.left,
                      o: rc.top - r.top, u: rc.bottom - r.top });
      }
    }
    return zeilen;
  }

  /**
   * Die Stelle, die einem Punkt in Leserichtung entspricht.
   * Die Zeilen stehen relativ zum Feld – gerollt werden darf dazwischen.
   */
  function stelleInLeserichtung(x, y, zeilen) {
    if (typeof document.caretRangeFromPoint !== 'function') return null;
    const r = textDiv.getBoundingClientRect();
    const lx = x - r.left, ly = y - r.top;
    let beste = null, besteDy = Infinity, besteDx = Infinity;
    for (const z of zeilen) {
      const dy = ly < z.o ? z.o - ly : (ly > z.u ? ly - z.u : 0);
      const dx = lx < z.l ? z.l - lx : (lx > z.r ? lx - z.r : 0);
      // Erst die Reihe, dann in ihr die naechste Zeile
      if (dy < besteDy - 1 || (dy <= besteDy + 1 && dx < besteDx)) {
        beste = z; besteDy = dy; besteDx = dx;
      }
    }
    if (!beste || !beste.knoten.isConnected) return null;

    const rc = { left: beste.l + r.left, right: beste.r + r.left,
                 top: beste.o + r.top, bottom: beste.u + r.top };
    let rg = null;
    try {
      rg = document.caretRangeFromPoint(
        Math.min(Math.max(x, rc.left + 1), rc.right - 1), (rc.top + rc.bottom) / 2);
    } catch (err) { rg = null; }
    if (rg && markierbareStelle(rg.startContainer)) return rg;

    // Der Treffertest kommt nicht durch (fremde Marken darueber) – messen
    const stelle = _stelleInZeile(beste.knoten, rc, x);
    if (stelle === null) return null;
    rg = document.createRange();
    rg.setStart(beste.knoten, stelle);
    rg.collapse(true);
    return rg;
  }

  function markiereBis(m) {
    const ziel = stelleInLeserichtung(m.x, m.y, m.zeilen);
    const sel = window.getSelection();
    if (!ziel || !sel || !m.node.isConnected) return;
    try { sel.setBaseAndExtent(m.node, m.offset, ziel.startContainer, ziel.startOffset); }
    catch (err) { randMarkierenAbbrechen(); }
  }

  /* Am Rand des Rahmens rollt es weiter. Das hat bisher der Browser
     getan, solange das Ziehen im Text ihm gehoerte. */
  function rolleBeimMarkieren(m) {
    if (m.rollBild) return;
    const schritt = () => {
      m.rollBild = 0;
      const sc = E('pg-scroll');
      if (_markieren !== m || !sc) return;
      const r = sc.getBoundingClientRect();
      const RAND = 24;
      let d = 0;
      if (m.y < r.top + RAND) d = m.y - (r.top + RAND);
      else if (m.y > r.bottom - RAND) d = m.y - (r.bottom - RAND);
      if (!d) return;
      const vorher = sc.scrollTop;
      sc.scrollTop += Math.max(-30, Math.min(30, d / 2));
      if (sc.scrollTop === vorher) return;
      markiereBis(m);
      m.rollBild = requestAnimationFrame(schritt);
    };
    m.rollBild = requestAnimationFrame(schritt);
  }

  function randMarkierenZieht(ev) {
    const m = _markieren;
    if (!m || ev.pointerId !== m.id) return;

    /* ══ DER LAUF ENDET AUCH OHNE LOSLASSEN ══════════════════════════
       Ein pointerup kann ausbleiben: das System nimmt den Zeiger an
       sich, das Fenster verliert den Fokus, ein anderer Faenger haelt
       ihn fest. Ohne diese Frage bliebe der Lauf armiert – und die
       naechste blosse MAUSBEWEGUNG, ganz ohne gedrueckte Taste, haette
       angefangen zu markieren und dabei preventDefault gerufen.

       Beim Ausprobieren hat genau das reihenweise Dinge zerlegt, die
       mit Markieren nichts zu tun haben: der Radierer knabberte nur
       noch, die Schlinge waehlte nichts mehr aus. Die gedrueckte Taste
       ist die Bedingung, unter der das hier ueberhaupt gilt. */
    if (!(ev.buttons & 1)) { randMarkierenEnde(ev); return; }

    m.x = ev.clientX;
    m.y = ev.clientY;
    if (!m.laeuft && Math.hypot(ev.clientX - m.sx, ev.clientY - m.sy) < MARKIER_WEG) return;

    /* Erst jetzt abfangen, nicht schon beim Aufsetzen: ein blosser Klick
       soll ein Klick bleiben. */
    ev.preventDefault();

    if (!m.laeuft) {
      m.laeuft = true;
      /* Der Druck auf freie Flaeche hat einen vorlaeufigen Absatz angelegt.
         Wird gezogen, war es kein Klick zum Schreiben – er kommt weg, bevor
         er in die Markierung geraet. */
      if (typeof raeumeVorlaeufiges === 'function') raeumeVorlaeufiges(textDiv);
      if (typeof freieAbsaetzeInLeserichtung === 'function') freieAbsaetzeInLeserichtung(textDiv);
      // Das Aufraeumen kann Nachbarn verrueckt haben (Ausweichen) – neu messen
      m.zeilen = messeZeilen();
    }
    markiereBis(m);
    rolleBeimMarkieren(m);
  }

  function randMarkierenEnde(ev) {
    if (!_markieren || (ev && ev.pointerId !== _markieren.id)) return;
    randMarkierenAbbrechen();
  }

  function randMarkierenAbbrechen() {
    if (!_markieren) return;
    if (_markieren.rollBild) cancelAnimationFrame(_markieren.rollBild);
    _markieren = null;
    document.removeEventListener('pointermove', randMarkierenZieht, true);
    document.removeEventListener('pointerup', randMarkierenEnde, true);
    document.removeEventListener('pointercancel', randMarkierenEnde, true);
    document.removeEventListener('pointerdown', randMarkierenAbbrechen, true);
  }

  /**
   * Ein Druck mit der Maus: von hier aus soll sich markieren lassen.
   *
   * @param {{startContainer: Node, startOffset: number}} [festerAnker]
   *   Mit gedrueckter Umschalttaste der Anfang der bestehenden Markierung.
   */
  function starteRandMarkieren(e, festerAnker) {
    /* ── Der Anker kommt vom PUNKT, nicht von der gesetzten Marke ──────
       activateTextEditingAt legt auf freier Flaeche einen Absatz an und
       setzt die Marke hinein (canvas/text.js, VORLAEUFIG). Als Anker
       waere das der falsche Ort: markiert werden soll ab der Stelle im
       Text, auf die gezeigt wurde, nicht ab dem eben Angelegten. */
    if (e.pointerType !== 'mouse') return;
    const zeilen = messeZeilen();
    const anker = festerAnker || stelleInLeserichtung(e.clientX, e.clientY, zeilen);
    if (!anker) return;

    randMarkierenAbbrechen();   // ein etwaiger alter Lauf endet hier
    _markieren = {
      id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      node: anker.startContainer, offset: anker.startOffset, laeuft: false,
      zeilen, rollBild: 0
    };
    /* In der Abfangphase und am Dokument: der Zeiger verlaesst beim
       Ziehen regelmaessig die Seite, und dann kaeme an ihr nichts mehr an. */
    document.addEventListener('pointermove', randMarkierenZieht, true);
    document.addEventListener('pointerup', randMarkierenEnde, true);
    document.addEventListener('pointercancel', randMarkierenEnde, true);
    // Ein neuer Druck heisst in jedem Fall: der alte Lauf ist vorbei
    document.addEventListener('pointerdown', randMarkierenAbbrechen, true);
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
      /* Nur die linke Taste markiert; die rechte gehoert dem Kontextmenue.
         Und nicht auf einem Bild: dessen Zug gehoert dem Bild. Der Lauf
         rollt am Rahmenrand mit – ein Bild, das ueber den Seitenrand
         gezogen wurde, landete damit ganz woanders. */
      if (e.button === 0 && !target.closest('.obj-wrap')) starteRandMarkieren(e);
      return;
    }

    if (e.pointerType === 'touch') {
      /* Schwebt der Stift, ist das die Hand, die beim Schreiben aufliegt:
         sie malt nicht und tippt nichts an (core/state.js). */
      if (stiftInDerNaehe()) return;
      /* Ein zweiter Finger faengt keinen zweiten Strich an. Sonst blieb vom
         Handballen, der mit zwei Auflagen zugleich aufsetzt, der erste
         Strich als Punkt liegen: das Zoomen (app.js) nimmt nur den
         laufenden zurueck, und das war schon der zweite. */
      if (S.isDrawing) return;
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
    // Die Hand hebt ab, waehrend der Stift schreibt – das war kein Tipp
    if (stiftInDerNaehe()) return;
    if (Math.hypot(e.clientX - start.sx, e.clientY - start.sy) > TIPP_WEG) return;
    if (typeof window.strichBeiPunkt !== 'function') return;

    const c = coords(e);
    const treffer = window.strichBeiPunkt(page.id, c.x, c.y, null);
    if (!treffer) { if (!tippAufObjekt(e)) tippAufText(e); return; }
    if (S.mode !== 'cursor') switchMode('cursor');
    if (typeof window.waehleStriche === 'function') window.waehleStriche(page.id, [treffer]);
    unterdrueckeTextTipp();
  });

  /* ══════════════════════════════════════════════════════════════════
     ALLE PUNKTE, NICHT NUR DEN LETZTEN

     Ein Stift meldet schneller, als der Bildschirm neue Bilder zeigt –
     120 bis 240 Meldungen je Sekunde gegen 60 Bilder. Der Browser wirft
     die überzähligen deshalb nicht weg, sondern hängt sie an das eine
     pointermove an, das er ausliefert (getCoalescedEvents).

     Wer sie nicht abholt, zeichnet aus jedem Bild EINE lange Sehne statt
     der wirklich gefahrenen Kurve. Genau das machte schnelle Schrift
     eckig und liess sie hinterherhinken: sichtbar wurde immer nur jeder
     zweite bis vierte Punkt.

     Teuer ist an einer Bewegung nicht das Anhängen eines Punktes,
     sondern das Neuzeichnen der ganzen Seite. Deshalb läuft die
     Schleife nur über das Anhängen und das Stück Strich dazwischen;
     alles Ganzflächige steht dahinter und geschieht einmal je Bewegung.
     ══════════════════════════════════════════════════════════════════ */
  div.addEventListener('pointermove', e => {
    // Nur der Zeiger, der den Strich begonnen hat – ein zweiter Finger
    // beim Zoomen darf nicht mitmalen
    if (!S.isDrawing || e.pointerId !== S._drawPointerId) return;
    e.preventDefault();

    const gesammelt = (typeof e.getCoalescedEvents === 'function')
      ? e.getCoalescedEvents() : null;
    const meldungen = (gesammelt && gesammelt.length) ? gesammelt : [e];

    /* Die Schlinge geht ihren eigenen Weg: kein Lineal, keine Gerade nach
       dem Halten, kein Strich auf der Seite – nur die Vorschau. */
    if (S._cur && S._cur._lasso) {
      for (const ev of meldungen) {
        const p = coords(ev);
        S._cur.path.push({ x: p.x, y: p.y, p: p.p });
      }
      maleLasso(S._cur);
      return;
    }

    const ctx = canvas.getContext('2d');

    /* Der Radierer bleibt bei EINEM Punkt je Bewegung – so war es und so
       soll es bleiben. Was er trifft, wird ganz weggenommen, und jedes
       Wegnehmen zeichnet die Seite neu und schreibt sie in page.inkStrokes
       um. Zehnmal je Bild waere das teuer fuer einen Gewinn, den niemand
       sieht: wer eine Zeile wegwischt, faehrt ohnehin mehrfach hin und her. */
    if (S.mode === 'eraser' && S.eraser.type === 'stroke' && !S._cur?._lasso) {
      // An der Lineal-Kante einrasten (siehe ui/ruler.js)
      strokeErase(amLinealAusrichten(coords(e), canvas, page), page, canvas);
      return;
    }

    /* Gerade ist aus dem Strich eine Form geworden und die Spitze ist
       noch unten: dann gehoert die Bewegung der Form (siehe oben). */
    if (!S._cur && _formZieht) {
      ziehFormWeiter(coords(e));
      return;
    }

    const stroke = S._cur;
    if (!stroke) return;

    if (stroke.isEraser) {
      const ce = amLinealAusrichten(coords(e), canvas, page);
      geradeGanzWeg(ce, page, canvas);
      stroke.path.push({ x: ce.x, y: ce.y, p: ce.p });
      liveDrawIncr(ctx, ce);
      return;
    }

    let c = null;
    let gewachsen = false;
    for (const ev of meldungen) {
      c = amLinealAusrichten(coords(ev), canvas, page);
      // Fuers Eindampfen beim Abheben – siehe linealStrichEindampfen
      if (S._rulerKlebt) stroke._amLineal = true;
      /* Steht die Gerade fest, zählt nur noch ihr Ende – die Punkte
         dazwischen wirft der Zweig unten ohnehin weg. */
      if (stroke._lineLocked) continue;
      if (!weitGenugWeg(stroke.path, c)) continue;
      stroke.path.push({ x: c.x, y: c.y, p: c.p });
      glaetteVorletzten(stroke.path);
      gewachsen = true;
    }
    if (!c) return;

    armLineTimer(stroke, c);

    // If a shape was detected, don't override it with line logic
    if (stroke._lineLocked && !stroke._shapeDetected) {
      const start = stroke.path[0] || { x: c.x, y: c.y, p: c.p };
      stroke.path = [start, { x: c.x, y: c.y, p: c.p }];
      gewachsen = true;
    }

    /* Nichts dazugekommen heisst nichts zu zeichnen. Ohne diese Frage
       liefe bei jeder ruhig gehaltenen Spitze die ganze Vorschau neu –
       fuer ein Bild, das genauso aussieht wie das davor. */
    if (gewachsen && !stroke._shapeDetected) planeVorschau(stroke, vorhergesagtePunkte(e, stroke));
  }, { passive: false });

  div.addEventListener('pointerup', e => {
    if (!S.isDrawing || e.pointerId !== S._drawPointerId) return;
    S.isDrawing = false;
    S._drawPointerId = null;
    S._rulerKlebt = false;    // der nächste Strich fängt frei an
    beendeFormZug();
    stopLineTimer(S._cur);
    stopVorschau();
    clearLiveCanvas();
    if (S.mode === 'eraser' && S._restoreMode) { switchMode(S._restoreMode); S._restoreMode = null; }

    /* ── Und jetzt gehoert er der Seite ───────────────────────────────
       Hier stand `if (isHL || isEraser)`. Der gewoehnliche Strich lag zu
       diesem Zeitpunkt naemlich schon auf der Seite – Stueck fuer Stueck
       waehrend des Zeichnens hingemalt, und genau davon war er fleckig
       (siehe stiftVorschau). Jetzt liegt er auf der Vorschau, und die ist
       eine Zeile darueber gerade geleert worden. Ohne dieses Neuzeichnen
       waere der Strich beim Abheben schlicht verschwunden. */
    linealStrichEindampfen(S._cur);
    if (S._cur && !S._cur._lasso) redrawStrokes(canvas, S.strokeHistory[page.id]);

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

    /* Was stehen bleibt, geht ohne Ballast an die anderen und in die
       Seite: gerundete Punkte, kein Druck, keine Hilfsfelder (core/data.js,
       strichVerdichten). Erst hier – die Schlinge oben liest noch _lasso. */
    if (finished && !alsAuswahl && typeof strichVerdichten === 'function') strichVerdichten(finished);

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
  /* ══════════════════════════════════════════════════════════════════
     ABGEBROCHEN – ABER DER STRICH IST TROTZDEM DA

     Ein pointercancel kommt, wenn das System den Zeiger an sich nimmt:
     der Handballen wird erkannt, das Blatt fängt an zu scrollen, ein
     Systemfenster geht auf. Das passiert auf einem Tablet regelmässig.

     >>> Warum hier Striche verschwunden sind <<<
     Es wurde nur aufgeräumt: S._cur auf null, fertig. Der Strich lag zu
     diesem Zeitpunkt aber SCHON in S.strokeHistory – dorthin kommt er
     beim Aufsetzen (handleDrawStart). Was fehlte, war der zweite Teil,
     den sonst pointerup erledigt: ihn nach page.inkStrokes zu
     übernehmen.

     Und genau daraus wird gelesen, wenn eine Seite neu aufgebaut wird
     (app.js: strokeHistory = page.inkStrokes). Beim nächsten Blättern,
     Zoomen oder Abschnittswechsel war der Strich damit weg – sichtbar
     gezeichnet, und dann ohne Zutun verschwunden. Genau so gemeldet.

     Der Strich BLEIBT deshalb. Er ist gezeichnet worden; dass das System
     dazwischenging, ist kein Grund, die Arbeit wegzuwerfen.
     ══════════════════════════════════════════════════════════════════ */
  div.addEventListener('pointercancel', () => {
    beendeFormZug();
    stopLineTimer(S._cur);
    stopVorschau();
    const abgebrochen = S._cur;
    S.isDrawing = false; S._cur = null; S._drawPointerId = null;
    S._rulerKlebt = false;
    clearLiveCanvas();
    if (S.mode === 'eraser' && S._restoreMode) { switchMode(S._restoreMode); S._restoreMode = null; }

    // Die Schlinge ist kein Strich – von ihr bleibt nie etwas stehen
    if (abgebrochen && abgebrochen._lasso) {
      S.strokeHistory[page.id] = (S.strokeHistory[page.id] || []).filter(s => s !== abgebrochen);
      if (typeof popPageHistory === 'function') popPageHistory(page.id);
      redrawStrokes(canvas, S.strokeHistory[page.id]);
      return;
    }

    if (!abgebrochen) return;

    // Auch ein abgebrochener Strich ist am Lineal eine Linie – siehe dort
    linealStrichEindampfen(abgebrochen);
    if (typeof strichVerdichten === 'function') strichVerdichten(abgebrochen);
    redrawStrokes(canvas, S.strokeHistory[page.id]);
    page.inkStrokes = JSON.parse(JSON.stringify(S.strokeHistory[page.id] || []));
    if (!abgebrochen.isEraser && window.Collab) Collab.noteStroke(page.id, abgebrochen);
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  });

  /* ══════════════════════════════════════════════════════════════════
     DER BROWSER DARF DIE MARKE NICHT NOCH EINMAL SETZEN

     Nach 'pointerdown' kommt 'mousedown', und dessen Voreinstellung ist:
     Marke an die nächstgelegene Textstelle. Sie lief also JEDES MAL nach
     unserer und überschrieb sie.

     Aufgefallen ist das erst mit dem frei stehenden Absatz: der ist im
     Augenblick des Klicks noch leer und damit null Pixel breit, der
     Treffertest des Browsers geht durch ihn hindurch und landet beim
     nächsten geschriebenen Wort. Getippt wurde dann dort – „ich klicke
     zwischen die Wörter und lande am Anfang des anderen".

     >>> Warum auch neben dem Text, nicht nur weit weg davon <<<
     Zwischen beidem liegt der Magnet: nah genug am Text, um an ihn zu
     gehören, aber über keinem Kasten. Dort setzt placeCaretAnywhere die
     Marke an die nächstgelegene Zeile (canvas/text.js) – und der
     Browser schob sie danach an den Anfang des Feldes zurück, weil er
     an dieser Stelle selbst nichts findet. Gemeldet als „ich klicke
     neben den Doppelpunkt und lande am Anfang des Textes".

     >>> Und inzwischen im ganzen Text <<<
     Auf einem Zeichen durfte der Browser lange weitermachen. Sein
     Ziehen folgte aber über leerer Fläche dem Zeiger nicht, und sein
     Doppelklick lief über das Ende eines frei stehenden Absatzes hinaus
     (siehe IN LESERICHTUNG und DOPPELKLICK). Marke, Ziehen, Doppel- und
     Dreifachklick kommen deshalb alle von hier. Nur, was im Text seinen
     eigenen Griff hat, bekommt den Druck unverändert.
     ══════════════════════════════════════════════════════════════════ */

  /* Schalter, Formeln und die Griffe der Tabelle behandeln den Druck selbst. */
  function eigenerGriff(el) {
    return !!(el && el.closest && el.closest(
      'input, button, select, textarea, [contenteditable="false"], .j-formula, [class*="griff"]'));
  }

  /* ══════════════════════════════════════════════════════════════════
     DOPPELKLICK: DAS WORT, NICHT DER NACHBAR

     >>> Gemeldet: „ein Doppelklick auf ein Wort waehlt alle Woerter" <<<
     Gemessen: auf „links" in „oben links" markierte der Browser
     „linksdie " – das erste Wort des Absatzes, der im DOM folgt. Frei
     stehende Absaetze liegen ausserhalb des Textflusses, und zwischen
     ihnen sieht er keine Wortgrenze: das Ende des einen und der Anfang
     des naechsten laufen fuer ihn zu einem Wort zusammen.

     Das Wort wird deshalb selbst bestimmt – nur innerhalb des Absatzes,
     in dem geklickt wurde, und ohne das Leerzeichen dahinter.
     ══════════════════════════════════════════════════════════════════ */
  const WORTGRENZEN = (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function')
    ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

  /** Der Absatz um einen Textknoten – null, wenn der Text frei im Feld steht. */
  function absatzUm(knoten) {
    for (let el = knoten.parentElement; el && el !== textDiv; el = el.parentElement) {
      if (/^(P|LI|TD|TH|H[1-6]|DIV|BLOCKQUOTE|PRE)$/.test(el.tagName)) return el;
    }
    return null;
  }

  /** Der Text des Absatzes am Stueck, dazu wo jeder Knoten darin anfaengt. */
  function textStuecke(knoten) {
    const absatz = absatzUm(knoten);
    if (!absatz) return { text: knoten.nodeValue, stuecke: [{ n: knoten, ab: 0 }] };
    const stuecke = [];
    let text = '';
    const lauf = document.createTreeWalker(absatz, NodeFilter.SHOW_TEXT);
    for (let n = lauf.nextNode(); n; n = lauf.nextNode()) {
      stuecke.push({ n, ab: text.length });
      text += n.nodeValue;
    }
    return { text, stuecke };
  }

  /* Eine Stelle im zusammengesetzten Text zurueck in Knoten und Versatz.
     An der Naht zweier Knoten gehoert der Anfang zum hinteren, das Ende
     zum vorderen. */
  function stelleImStueck(stuecke, pos, amEnde) {
    for (const s of stuecke) {
      const laenge = s.n.nodeValue.length;
      if (pos < s.ab + laenge || (amEnde && pos === s.ab + laenge)) return { n: s.n, o: pos - s.ab };
    }
    const letzter = stuecke[stuecke.length - 1];
    return { n: letzter.n, o: letzter.n.nodeValue.length };
  }

  function markiereWortAn(x, y) {
    let rg = null;
    try { rg = document.caretRangeFromPoint(x, y); } catch (err) { return; }
    if (!rg || rg.startContainer.nodeType !== Node.TEXT_NODE || !markierbareStelle(rg.startContainer)) return;
    const { text, stuecke } = textStuecke(rg.startContainer);
    const eigen = stuecke.find(s => s.n === rg.startContainer);
    if (!eigen) return;
    const pos = eigen.ab + rg.startOffset;

    let anfang, ende;
    if (WORTGRENZEN) {
      const teile = [...WORTGRENZEN.segment(text)];
      let teil = teile.find(g => pos >= g.index && pos < g.index + g.segment.length);
      /* In die rechte Haelfte des letzten Buchstabens geklickt: die Stelle
         liegt dann schon HINTER dem Wort. Gemeint war trotzdem das Wort. */
      const davor = teile.find(g => g.index + g.segment.length === pos);
      if (!(teil && teil.isWordLike) && davor && davor.isWordLike) teil = davor;
      if (!teil) return;
      anfang = teil.index;
      ende = teil.index + teil.segment.length;
    } else {
      const wortZeichen = /[\p{L}\p{N}_]/u;
      anfang = ende = pos;
      while (anfang > 0 && wortZeichen.test(text[anfang - 1])) anfang--;
      while (ende < text.length && wortZeichen.test(text[ende])) ende++;
      if (anfang === ende) return;
    }
    const a = stelleImStueck(stuecke, anfang, false);
    const b = stelleImStueck(stuecke, ende, true);
    const sel = window.getSelection();
    if (sel) sel.setBaseAndExtent(a.n, a.o, b.n, b.o);
  }

  /* ══════════════════════════════════════════════════════════════════
     DREIMAL: DIE ZEILE – VIERMAL: DIE SEITE

     >>> Gewuenscht: „dreimal druecken waehlt die ganze Zeile, viermal
     die ganze Seite" <<<
     Dreimal markierte vorher den ABSATZ – und bei einem frei stehenden
     Wort ist das genau dasselbe wie das Wort vom Doppelklick: es sah
     aus, als passiere nichts.

     Zeile heisst, was auf dem Blatt in EINER Reihe steht, auch zwei frei
     stehende Absaetze nebeneinander. Gemessen wird deshalb an den Zeilen
     selbst (messeZeilen) und nicht am Absatz: ein umbrochener Absatz hat
     mehrere Zeilen, und gemeint ist nur die angeklickte.
     ══════════════════════════════════════════════════════════════════ */
  function markiereZeileAn(x, y) {
    if (typeof raeumeVorlaeufiges === 'function') raeumeVorlaeufiges(textDiv);
    const zeilen = messeZeilen();
    const r = textDiv.getBoundingClientRect();
    const lx = x - r.left, ly = y - r.top;

    // Die Zeile unter dem Zeiger – wie beim Ziehen: erst die Reihe, dann die naechste
    let beste = null, besteDy = Infinity, besteDx = Infinity;
    for (const z of zeilen) {
      const dy = ly < z.o ? z.o - ly : (ly > z.u ? ly - z.u : 0);
      const dx = lx < z.l ? z.l - lx : (lx > z.r ? lx - z.r : 0);
      if (dy < besteDy - 1 || (dy <= besteDy + 1 && dx < besteDx)) {
        beste = z; besteDy = dy; besteDx = dx;
      }
    }
    if (!beste) return;

    // Alles, was auf ihrer Hoehe steht
    const mitte = (beste.o + beste.u) / 2;
    const reihe = zeilen.filter(z => z.o <= mitte && z.u >= mitte);
    const links = reihe.reduce((a, b) => (b.l < a.l ? b : a));
    const rechts = reihe.reduce((a, b) => (b.r > a.r ? b : a));

    // Eine Markierung reicht im DOM von hier bis dort – siehe IN LESERICHTUNG
    freieAbsaetzeInLeserichtung(textDiv);
    const anfang = stelleInLeserichtung(r.left + links.l, r.top + (links.o + links.u) / 2, zeilen);
    const ende = stelleInLeserichtung(r.left + rechts.r, r.top + (rechts.o + rechts.u) / 2, zeilen);
    const sel = window.getSelection();
    if (!anfang || !ende || !sel) return;
    sel.setBaseAndExtent(anfang.startContainer, anfang.startOffset, ende.startContainer, ende.startOffset);
  }

  function markiereSeite() {
    if (typeof raeumeVorlaeufiges === 'function') raeumeVorlaeufiges(textDiv);
    const sel = window.getSelection();
    if (!sel) return;
    const ganz = document.createRange();
    ganz.selectNodeContents(textDiv);
    sel.removeAllRanges();
    sel.addRange(ganz);
  }

  /* Nur ein Druck der MAUS. Nach einem Fingertipp schickt der Browser
     ein nachgereichtes mousedown hinterher – und genau dessen
     Voreinstellung setzt fuer den Finger die Marke (siehe unten, MIT DEM
     FINGER). Abgebrochen stand der Tipp ohne Schreibmarke da. */
  let druckMitMaus = true;

  /* Die Druecke werden auch selbst gezaehlt. e.detail zaehlt der Browser,
     und dass er ueber zwei hinaus weiterzaehlt, wenn sein mousedown jedes
     Mal abgebrochen wird, ist nirgends zugesagt – gemeldet war „dreimal
     druecken, und nichts passiert". Gilt als Folge, was kurz nacheinander
     an derselben Stelle gedrueckt wird. */
  const MEHRFACH_MS = 500;
  const MEHRFACH_PX = 6;
  let letzterDruck = null;     // { zeit, x, y, anzahl }

  textDiv.addEventListener('pointerdown', e => {
    druckMitMaus = e.pointerType === 'mouse';
    if (!druckMitMaus || e.button !== 0) return;
    const jetzt = performance.now();
    const v = letzterDruck;
    const folgt = !!v && jetzt - v.zeit < MEHRFACH_MS
      && Math.hypot(e.clientX - v.x, e.clientY - v.y) < MEHRFACH_PX;
    letzterDruck = { zeit: jetzt, x: e.clientX, y: e.clientY, anzahl: folgt ? v.anzahl + 1 : 1 };
  }, true);

  textDiv.addEventListener('mousedown', e => {
    if (!druckMitMaus || S.mode !== 'cursor' || S.readOnly || e.button !== 0) return;
    if (!textDiv.contains(e.target) || eigenerGriff(e.target)) return;
    e.preventDefault();
    if (e.shiftKey) return;   // erweitert schon im pointerdown
    const anzahl = Math.max(e.detail || 1, letzterDruck ? letzterDruck.anzahl : 1);
    if (anzahl === 2) markiereWortAn(e.clientX, e.clientY);
    else if (anzahl >= 4) markiereSeite();
    else if (anzahl >= 3) markiereZeileAn(e.clientX, e.clientY);
  });

  /* ══════════════════════════════════════════════════════════════════
     MIT DEM FINGER GILT DASSELBE VERSPRECHEN

     In der Zeigerstellung liegt das Zeichenblatt auf `pointer-events:
     none`, ein Fingertipp geht also unmittelbar an den Text. Der Browser
     setzt die Marke dann an das nächstgelegene Zeichen – auf einer fast
     leeren Seite ist das irgendwo weit weg von der Stelle, auf die
     jemand getippt hat.

     Ein Tipp auf freie Fläche setzt deshalb auch hier die Stelle selbst.
     Ein SCHIEBEN nicht: das ist Scrollen, und wer scrollt, will nichts
     schreiben. Deshalb wird beim Aufsetzen gemerkt und erst beim Abheben
     entschieden. */
  let tippAufFrei = null;

  textDiv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || S.mode !== 'cursor' || S.readOnly) { tippAufFrei = null; return; }
    tippAufFrei = { x: e.clientX, y: e.clientY, frei: isFreeEditorAreaClick(e.clientX, e.clientY) };
  }, true);

  textDiv.addEventListener('pointercancel', () => { tippAufFrei = null; });

  textDiv.addEventListener('pointerup', e => {
    const anfang = tippAufFrei;
    tippAufFrei = null;
    if (!anfang || !anfang.frei) return;
    if (e.pointerType === 'touch' && stiftInDerNaehe()) return;   // die Hand, siehe oben
    if (Math.abs(e.clientX - anfang.x) > TIPP_WEG
        || Math.abs(e.clientY - anfang.y) > TIPP_WEG) return;   // geschoben
    activateTextEditingAt(e.clientX, e.clientY, true);
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

    if (!textDiv.contains(e.target) || eigenerGriff(e.target)) return;

    /* Der mousedown-Hoerer oben bricht den Browser ab – Marke und Ziehen
       kommen deshalb von hier (DER BROWSER DARF DIE MARKE NICHT NOCH
       EINMAL SETZEN). */
    const sel = window.getSelection();
    if (e.shiftKey && sel && sel.anchorNode && textDiv.contains(sel.anchorNode)) {
      // Mit Umschalttaste: die bestehende Markierung bis hierher verlaengern
      starteRandMarkieren(e, { startContainer: sel.anchorNode, startOffset: sel.anchorOffset });
      if (_markieren) {
        freieAbsaetzeInLeserichtung(textDiv);
        markiereBis(_markieren);
      }
      return;
    }
    const forceManual = isFreeEditorAreaClick(e.clientX, e.clientY);
    activateTextEditingAt(e.clientX, e.clientY, forceManual);
    starteRandMarkieren(e);
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
    /* ── Wo die Vorschau liegt ────────────────────────────────────────
       Hier stand z-index 11 – UNTER dem Text (1000) und unter der
       Zeichenflaeche (1100). Der laufende Strich lag damit woanders als
       der fertige: geschrieben ueber getippten Text, sprang er beim
       Abheben davor. Eine Zahl ueber der Zeichenflaeche zeigt ihn dort,
       wo er nachher wirklich steht; Bilder im vorderen Band (2000)
       bleiben weiter obenauf, auch das wie beim fertigen Strich. */
    _liveCanvas.style.cssText = 'pointer-events:none;z-index:1101;position:absolute;inset:0;opacity:0.38;';
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
/* ══════════════════════════════════════════════════════════════════════
   GELEERT, NICHT WEGGEWORFEN

   Hier wurde die Flaeche bei jedem Abheben aus dem Dokument genommen und
   verworfen; die naechste getLiveCtx baute eine neue. Solange nur Marker
   und Schlinge sie benutzten, fiel das nicht auf – jetzt laeuft JEDER
   Strich darueber, und eine Seite in voller Aufloesung sind gut zwanzig
   Megabyte, die dann bei jedem einzelnen Wort neu angefordert und wieder
   freigegeben wuerden. Das ist genau die Sorte Arbeit, die sich als
   Stocken beim Aufsetzen bemerkbar macht.

   Es gibt ohnehin nur EINE solche Flaeche; sie wandert mit (getLiveCtx
   haengt sie an die Seite um, auf der gerade gezeichnet wird). Geleert
   liegt sie unsichtbar da und kostet nichts.
   ══════════════════════════════════════════════════════════════════════ */
function clearLiveCanvas() {
  if (!_liveCanvas) return;
  const ctx = _liveCanvas.getContext('2d');
  ctx.save();
  // Ohne die Einheitsmatrix waere die Flaeche um den DPR-Faktor zu klein
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, _liveCanvas.width, _liveCanvas.height);
  ctx.restore();
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
/* ══════════════════════════════════════════════════════════════════════
   EINE AM LINEAL GEZOGENE LINIE IST EINE LINIE

   >>> Gemeldet: „sie verhaelt sich nicht wie eine gerade Linie" <<<
   Wer sie auswaehlte, bekam die gewoehnliche Huelle statt der zwei
   Griffe an den Enden. Der Grund: canvas/strokeSelect.js erkennt eine
   Gerade daran, dass sie GENAU ZWEI Punkte hat (istGerade) – so entsteht
   sie beim Halten am Ende. Am Lineal entsteht sie anders: dort wird
   jeder einzelne Punkt auf die Kante geschoben, und am Ende liegen
   zweihundert davon aufgereiht auf einer Linie. Dasselbe Bild, ein
   anderer Inhalt.

   Sie wird deshalb beim Abheben auf ihre zwei Enden eingedampft. Das
   ist keine Vereinfachung, die etwas verliert – die Punkte dazwischen
   liegen ohnehin alle auf der Verbindung.

   >>> Warum die AEUSSERSTEN und nicht der erste und der letzte <<<
   Am Lineal faehrt man gern zweimal hin und her, um die Linie
   nachzuziehen. Dann liegt der letzte Punkt irgendwo in der Mitte, und
   „erster bis letzter" waere die halbe Linie. Gesucht sind die beiden,
   die am weitesten auseinanderliegen: erst der weiteste vom Anfang aus,
   dann der weiteste von dem aus. Bei Punkten auf einer Geraden findet
   das die echten Enden.
   ══════════════════════════════════════════════════════════════════════ */
function aeussereEnden(pts) {
  const weitesterVon = (q) => {
    let best = pts[0], weit = -1;
    for (const p of pts) {
      const d = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);
      if (d > weit) { weit = d; best = p; }
    }
    return best;
  };
  const a = weitesterVon(pts[0]);
  return { a: weitesterVon(a), b: a };
}

/**
 * Einen am Lineal gezogenen Strich auf seine zwei Enden bringen.
 * @returns {boolean} ob etwas geaendert wurde
 */
function linealStrichEindampfen(stroke) {
  if (!stroke || !stroke._amLineal) return false;
  delete stroke._amLineal;   // gehoert nicht in die gespeicherte Seite

  const pts = stroke.path;
  if (!pts || pts.length < 3 || stroke.isEraser || stroke.isHL) return false;

  const { a, b } = aeussereEnden(pts);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 12) return false;
  for (const p of pts) {
    if (pointToLineDistance(p.x, p.y, a.x, a.y, b.x, b.y) > 2.5) return false;
  }

  stroke.path = [{ x: a.x, y: a.y, p: a.p }, { x: b.x, y: b.y, p: b.p }];
  return true;
}

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
  const formenWeg = radiereFormen(c, page, r, canvas);

  if (bleibt.length === liste.length && !formenWeg) return;
  S.strokeHistory[page.id] = bleibt;
  redrawStrokes(canvas, bleibt);
  page.inkStrokes = JSON.parse(JSON.stringify(bleibt));
  if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
}

/* ══════════════════════════════════════════════════════════════════════
   DER RADIERER ERWISCHT AUCH FORMEN

   Eine erkannte Form ist kein Strich mehr, sondern ein Objekt in
   page.objects (machDarausEinObjekt). Der Radierer arbeitete nur auf
   strokeHistory und ging deshalb glatt durch jedes Viereck hindurch -
   gemeldet aus der Nutzung.

   >>> Warum ganz und nicht stueckweise <<<
   Aus demselben Grund wie beim geraden Strich: eine Form ist ein
   geometrisches Ding, kein Farbauftrag. Ein halb weggeriebenes Viereck
   waere kein Viereck mehr, sondern Bruch.

   Getroffen ist, wer den RAND beruehrt - nicht die Flaeche. Sonst
   loeschte ein Wisch quer ueber die Seite jedes Rechteck, ueber dessen
   Inneres er zufaellig lief.
   ══════════════════════════════════════════════════════════════════════ */
function radiereFormen(c, page, radius, canvas) {
  const objekte = page.objects;
  if (!Array.isArray(objekte) || !objekte.length) return false;

  const trifftRand = (o) => {
    const x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    // Weit ausserhalb des Kastens? Dann gar nicht erst rechnen.
    if (c.x < x1 - radius || c.x > x2 + radius ||
        c.y < y1 - radius || c.y > y2 + radius) return false;

    /* Nah an einer der vier Kanten - und bei Ellipse und Dreieck ebenso,
       denn deren Rand liegt innerhalb desselben Kastens. Genauer waere
       schoener, aber ein Radierer ist ein grobes Werkzeug; die Kante des
       Kastens liegt nie mehr als eine Strichbreite daneben. */
    const nahSenkrecht = (Math.abs(c.x - x1) <= radius || Math.abs(c.x - x2) <= radius)
      && c.y >= y1 - radius && c.y <= y2 + radius;
    const nahWaagerecht = (Math.abs(c.y - y1) <= radius || Math.abs(c.y - y2) <= radius)
      && c.x >= x1 - radius && c.x <= x2 + radius;
    return nahSenkrecht || nahWaagerecht;
  };

  const weg = objekte.filter(o => o && o.kind === 'shape' && trifftRand(o));
  if (!weg.length) return false;

  const raus = new Set(weg.map(o => String(o.id)));
  page.objects = objekte.filter(o => !raus.has(String(o.id)));

  /* Derselbe Weg wie beim Loeschen ueber die Auswahlleiste
     (canvas/strokeSelect.js): Huelle weg, dann neu stapeln und melden. */
  const pageEl = canvas && canvas.closest ? canvas.closest('[data-pgid]') : null;
  if (pageEl) {
    /* Dieselbe Auswahl wie objHuelle() in canvas/strokeSelect.js - die
       Funktion dort ist oertlich und von hier nicht erreichbar. */
    for (const o of weg) {
      const h = pageEl.querySelector('.obj-wrap[data-objid="' + CSS.escape(String(o.id)) + '"]');
      if (h) h.remove();
    }
    const layer = pageEl.querySelector('.j-objects');
    if (layer && typeof restackObjects === 'function') restackObjects(layer, page);
  }
  if (typeof noteObjectChanged === 'function') noteObjectChanged();
  return true;
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

/**
 * Abstand eines Punktes von einer Strecke.
 *
 * >>> Warum die Laenge abgefangen wird <<<
 * Liegen Anfang und Ende einer Strecke aufeinander – der Stift hat
 * zweimal dieselbe Stelle gemeldet, das kommt bei langsamem Aufsetzen
 * regelmaessig vor –, dann ist dx*dx + dy*dy null. Die Rechnung darunter
 * teilte dadurch durch null, t wurde NaN und das Ergebnis ebenfalls. Und
 * ein Vergleich MIT NaN ist immer falsch: der Strich galt an dieser
 * Stelle als „weit weg" und liess sich weder anwaehlen (strokeSelect.js)
 * noch als ganze Linie wegnehmen (geradeGanzWeg). Ohne Fehlermeldung,
 * es tat einfach nichts.
 *
 * Bei einer Strecke ohne Laenge ist der Abstand schlicht der Abstand zum
 * Punkt selbst.
 */
function pointToLineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const laenge2 = dx * dx + dy * dy;
  if (laenge2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / laenge2));
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

/* ══════════════════════════════════════════════════════════════════════
   JEDER STRICH BEKOMMT EINE KENNUNG

   >>> Warum das noetig ist <<<
   Ein Strich geht ueber Firestore mit arrayUnion hinaus (appendStrokes in
   core/share.js), und arrayUnion nimmt nur auf, was noch nicht drinsteht –
   bei TIEFEM Vergleich. Zwei wirklich gleiche Striche galten damit als
   einer: zweimal derselbe Punkt an derselben Stelle, ein Doppeltipp mit
   dem Stift, zwei kurze Striche im Raster. Der zweite kam beim anderen nie
   an und war nach dem naechsten Laden auch beim Urheber weg.

   Mit einer Kennung sind zwei gleich AUSSEHENDE Striche verschieden. Der
   Schutz gegen den Doppelversand bleibt trotzdem: derselbe Strich, zweimal
   geschickt, traegt beide Male dieselbe Kennung.

   Alte Hefte haben sie nicht. Das ist in Ordnung – die Kennung wird
   nirgends vorausgesetzt, sie geht nur in den Vergleich ein.
   ══════════════════════════════════════════════════════════════════════ */
function strichKennung() {
  return (typeof uid === 'function')
    ? uid()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function buildStroke(c) {
  const m = S.mode;
  const start = { path: [{ x: c.x, y: c.y, p: c.p }], id: strichKennung() };
  if (m === 'pen1') return { ...start, color: S.pen1.color, width: PEN_SIZES[S.pen1.szIdx], isHL: false };
  if (m === 'pen2') return { ...start, color: S.pen2.color, width: PEN_SIZES[S.pen2.szIdx], isHL: false };
  if (m === 'hl')   return { ...start, color: S.hl.color,   width: HL_SIZES[S.hl.szIdx],   isHL: true };
  return { ...start, color: '#000', width: 4, isHL: false };
}
/* ══════════════════════════════════════════════════════════════════════
   NUR NOCH FUER DEN RADIERER

   Das neue Stueck Strich auf die Seite malen – das machte einmal jedes
   Werkzeug, und davon wurde die duenne Linie fleckig (stiftVorschau).
   Der Radierer braucht es weiter: er nimmt weg (destination-out), und
   wegnehmen laesst sich nur dort, wo etwas liegt.

   Die Breite kommt aus `s.width`. Hier stand `s.width * (0.5 + cur.p)`,
   also mit dem Druck dicker und duenner – fertig gezeichnet wird aber
   ueberall sonst gleichmaessig (canvas/drawing.js, applyStrokeStyles),
   und ein Strich, der beim Abheben seine Form wechselt, fuehlt sich
   falscher an als einer ohne Druckstaerke.
   ══════════════════════════════════════════════════════════════════════ */
function liveDrawIncr(ctx, c) { const s = S._cur; if (!s) return; const pts = s.path; if (pts.length < 2) return; const prev = pts[pts.length - 2], cur = pts[pts.length - 1]; ctx.save(); ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; if (s.isHL) ctx.globalAlpha = 0.38; if (s.isEraser) ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); if (pts.length >= 3) { const pp = pts[pts.length - 3]; ctx.moveTo((pp.x + prev.x) / 2, (pp.y + prev.y) / 2); ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + cur.x) / 2, (prev.y + cur.y) / 2); } else { ctx.moveTo(prev.x, prev.y); ctx.lineTo(cur.x, cur.y); } ctx.stroke(); ctx.restore(); }

