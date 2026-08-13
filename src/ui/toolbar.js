'use strict';

/* ── TOOLBAR ── */
QA('.tb-mode[data-mode]').forEach(btn => { btn.addEventListener('click', () => switchMode(btn.dataset.mode)); });

/* ══════════════════════════════════════════════════════════════════════
   MIT DEM FINGER ZEICHNEN

   An: wer ein Zeichenwerkzeug waehlt und die Seite anfasst, zeichnet –
   mit Stift wie mit Finger. Die Seite bewegen dann zwei Finger oder der
   Rand neben der Seite.

   >>> Warum es nicht mehr aus ist <<<
   Es war aus, umschaltbar ueber den Knopf hier. Gefunden hat den Knopf
   niemand; zurueckgemeldet wurde „zeichnen geht nur mit dem Stift, mit
   dem Finger gar nicht, egal was man drueckt". Dazu kam ein Fehler, der
   den Schalter selbst wirkungslos machte (core/zoom.js, touch-action).
   Wer den Finger lieber zum Blaettern hat, schaltet ihn hier ab – die
   Einstellung heisst seitdem touchDrawOff.

   Der Knopf erscheint nur, wo es ueberhaupt einen Finger gibt. Auf einem
   Rechner ohne Beruehrungsschirm waere er eine Frage ohne Gegenstand.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const btn = E('btn-touch-draw');

  /* Ob es hier ueberhaupt einen Finger gibt. Steht am window, weil
     updateTouchDrawUI() weiter unten es ebenfalls braucht – und das
     laeuft bei jedem Werkzeugwechsel, nicht nur einmal beim Aufbau. */
  window.hatFingerGeraet = (navigator.maxTouchPoints || 0) > 0
    || window.matchMedia('(pointer: coarse)').matches;

  S.touchDraw = !(typeof Settings !== 'undefined' && Settings.get && Settings.get('touchDrawOff'));
  updateTouchDrawUI();

  if (!btn || !window.hatFingerGeraet) return;

  btn.addEventListener('click', () => {
    S.touchDraw = !S.touchDraw;
    updateTouchDrawUI();
    toast(S.touchDraw ? t('touchDrawOn') : t('touchDrawOff'));
    if (typeof Settings !== 'undefined' && Settings.set) Settings.set('touchDrawOff', !S.touchDraw);
  });

  // Die Einstellung wird erst nach dem Laden der Datei richtig bekannt
  if (typeof Settings !== 'undefined' && Settings.onChange) {
    Settings.onChange(s => {
      if (!s.touchDrawOff === !!S.touchDraw) return;
      S.touchDraw = !s.touchDrawOff;
      updateTouchDrawUI();
    });
  }
})();

/* ══════════════════════════════════════════════════════════════════════
   WAS NICHT MEHR HINEINPASST, WIRD UMBLÄTTERT

   Die Leiste hat Stufen in css/responsive.css: erst weicht die
   Beschriftung, dann, was es anderswo auch gibt. Das reicht, solange die
   Zahl der Knöpfe feststeht – mit jedem neuen Werkzeug (Tabelle, Formel,
   Formen, Lineal) müsste eine weitere Stufe dazu, und jede davon ist
   geraten.

   Deshalb die Pfeil-Navigation: gemessen wird, ob die Leiste breiter ist
   als ihr Platz. Ist sie es, erscheint ▶ – ein Klick darauf blättert zur
   nächsten „Seite" an Knöpfen, ◀ führt zurück. Die echten Knöpfe bleiben
   in der Leiste und behalten ihre Handgriffe; sie werden nur gruppenweise
   ein- und ausgeblendet.

   >>> Warum nicht einfach seitlich rollen <<<
   Das kann die Leiste längst (css/toolbar.css), aber was rechts
   heraussteht, findet niemand – und ein waagerechtes Schieben in einer
   40 px hohen Leiste trifft mit dem Finger ohnehin kaum jemand. Genau
   deshalb gibt es die Stufen überhaupt.

   >>> Und warum kein ⋯-Menü mehr <<<
   Das Menü verbarg, dass es überhaupt etwas gibt. Die Pfeile zeigen
   sichtbar: hier ist noch mehr. Außerdem kostete das Menü einen Klick
   zum Öffnen und einen zum Auswählen – die Pfeile blättern mit einem
   Klick eine ganze Seite um.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const bar = E('toolbar');
  const btnPrev = E('btn-tb-prev');
  const btnNext = E('btn-tb-next');
  if (!bar || !btnPrev || !btnNext) return;

  const istTrenner = el => el.classList
    && (el.classList.contains('tb-sep') || el.classList.contains('tb-sep-sm'));

  /**
   * Die blätterbaren Stücke, von links nach rechts.
   *
   * >>> Gruppen, nicht Zonen <<<
   * Gezählt wurden bisher die drei Zonen (.tb-left/.tb-center/.tb-right).
   * Damit war das kleinste, was weichen konnte, eine ganze Zone – und die
   * Mitte trägt sowohl die Textformate ALS AUCH das Einfügen. Schon ein
   * Pixel Überlänge nahm also das „+" mit, obwohl daneben noch Platz war.
   * Genau so wurde es gemeldet. Jetzt ist eine Gruppe ein Stück.
   *
   * >>> Der Trenner reist mit seiner Gruppe <<<
   * Sonst bliebe ein Strich ohne Knöpfe daneben stehen.
   *
   * >>> Die Pfeile bleiben immer <<<
   * Sie liegen selbst in .tb-right. Wurde die Zone ausgeblendet, war auch
   * das ▶ weg – man kam nicht mehr zurück.
   */
  function sammleStuecke() {
    const alle = [];
    for (const zone of bar.querySelectorAll('.tb-zone')) {
      let offenerTrenner = null;
      for (const kind of zone.children) {
        if (kind === btnPrev || kind === btnNext) continue;
        if (istTrenner(kind)) { offenerTrenner = kind; continue; }

        const teile = offenerTrenner ? [offenerTrenner, kind] : [kind];
        offenerTrenner = null;

        /* >>> Die eigene Sichtbarkeit lesen, nicht überschreiben <<<
           #pen-opts, #eraser-opts und #shape-opts stehen auf display:none,
           bis ihr Werkzeug gewählt wird (applyMode). Was von sich aus
           verborgen ist, kostet keine Breite und ist kein Bewerber fürs
           Blättern.

           Das Blättern selbst fasst style.display NICHT an, sondern setzt
           eine Klasse (siehe setzeSichtbar). Vorher merkte es sich hier
           den „eigenen" Wert – und der war nach dem ersten Wegblättern
           'none'. Von da an galt die Gruppe als von sich aus verborgen und
           kam nie wieder: Teilen und Exportieren verschwanden auf einem
           schmalen Fenster dauerhaft, auch wenn wieder Platz war. */
        const eigenVerborgen = teile.every(el => el.style.display === 'none');

        /* data-tb-more sagt, was entbehrlich ist: 1 weicht zuerst
           (Speicher-Hinweis), dann 2 (Teilen, Exportieren), zuletzt 4
           (Rückgängig und Vor). Ohne Nummer ist die Gruppe unentbehrlich –
           die Werkzeuge, die Textformate, das Einfügen und der Zoom
           bleiben immer auf der ersten Seite, denn für das Einfügen gibt
           es keinen zweiten Weg. */
        alle.push({
          teile,
          rang: +(kind.dataset.tbMore || 0),
          eigenVerborgen
        });
      }
      if (offenerTrenner) {
        alle.push({
          teile: [offenerTrenner],
          rang: 99,
          eigenVerborgen: offenerTrenner.style.display === 'none'
        });
      }
    }
    return alle;
  }

  /* Ein Pixel Spielraum: Chromium rechnet Breiten in Bruchteilen, und
     scrollWidth rundet auf. Ohne das schöbe die Leiste beim Aufbau
     grundlos etwas ins Menü. */
  const zuEng = () => bar.scrollWidth > bar.clientWidth + 1;

  let aktuelleSeite = 0;     // 0 = erste Seite
  let seiten = [];           // [[stück, stück, ...], [stück, ...]]
  let alleStuecke = [];      // die Stücke dieser Messung (Identität zählt)
  let geplant = false;

  /* Weggeblättert wird über eine KLASSE, nicht über style.display. So
     bleibt der eigene Wert der Gruppe unangetastet – und eine Gruppe, die
     einmal weichen musste, gilt später nicht als von sich aus verborgen
     (siehe sammleStuecke). */
  function setzeSichtbar(stueck, an) {
    stueck.teile.forEach(el => el.classList.toggle('tb-weg', !an));
  }

  function versteckePfeile() {
    btnNext.style.display = 'none';
    btnPrev.style.display = 'none';
  }

  /** Alle Stücke sichtbar machen – Ausgangszustand vor der Messung. */
  function alleZeigen() {
    for (const s of alleStuecke) setzeSichtbar(s, true);
  }

  /* ══════════════════════════════════════════════════════════════════
     OHNE PLATZ FÜR DEN NAMEN: DER NAME BEIM DARÜBERFAHREN

     Ab 1300 px – mit offener Navigation schon ab 1350 – fallen die
     Beschriftungen weg und es bleiben die Sinnbilder. „Der Name steht
     weiterhin im Tooltip" stand als Absicht bereits im Stylesheet
     (css/responsive.css), nur gab es diesen Tooltip nie: die Knöpfe
     tragen ihren Namen im <span>, nicht in einem title.

     Gesetzt wird er genau dann, wenn der Name wirklich nicht zu lesen
     ist. Sonst stünde neben dem sichtbaren Wort „Cursor" nach einer
     Sekunde noch einmal „Cursor". Ein Knopf, der schon von sich aus
     einen title hat, behält ihn.
     ══════════════════════════════════════════════════════════════════ */
  function stelleKurznamen() {
    for (const btn of bar.querySelectorAll('button')) {
      const schild = btn.querySelector('span');
      const name = schild ? (schild.textContent || '').trim() : '';
      if (!name) continue;

      const verdeckt = getComputedStyle(schild).display === 'none';
      if (verdeckt) {
        if (!btn.title || btn.dataset.titelAusName) {
          btn.title = name;
          btn.dataset.titelAusName = '1';
        }
      } else if (btn.dataset.titelAusName) {
        btn.removeAttribute('title');
        delete btn.dataset.titelAusName;
      }
    }
  }

  /**
   * Misst, was weichen muss, und teilt in zwei Seiten.
   *
   * Weil die Pfeile selbst Platz brauchen, wird mit sichtbarem ▶ gemessen.
   */
  function anpassen() {
    geplant = false;
    alleStuecke = sammleStuecke();
    stelleKurznamen();

    if (!bar.offsetParent) { alleZeigen(); versteckePfeile(); return; }

    alleZeigen();
    versteckePfeile();
    aktuelleSeite = 0;
    seiten = [];

    if (!zuEng()) return;   // alles passt

    // ▶ braucht selbst Platz – erst zeigen, dann rechnen
    btnNext.style.display = '';
    if (!zuEng()) { btnNext.style.display = 'none'; return; }

    /* Nur Entbehrliches weicht, und zwar nach Rang. Solange es noch zu
       eng ist, geht das nächste Stück – nach jedem Schritt wird neu
       gemessen, sonst wanderte alles auf einmal weg. */
    const entbehrlich = alleStuecke.filter(s => s.rang > 0 && !s.eigenVerborgen)
      .sort((a, b) => a.rang - b.rang);
    const verdraengt = [];

    for (const s of entbehrlich) {
      if (!zuEng()) break;
      setzeSichtbar(s, false);
      verdraengt.push(s);
    }

    if (!verdraengt.length) {
      /* Es gibt nichts Entbehrliches – dann hilft kein Blättern, und die
         Leiste rollt eben seitlich weiter (css/toolbar.css). Lieber das
         als ein „+", das nirgends mehr zu finden ist. */
      alleZeigen();
      versteckePfeile();
      return;
    }

    seiten = [alleStuecke.filter(s => !verdraengt.includes(s)), verdraengt];
    zeigeSeite(0);
  }

  /** Blendet alle Stücke einer Seite ein, die anderen aus. */
  function zeigeSeite(nr) {
    aktuelleSeite = nr;
    const sichtbar = new Set(seiten[nr] || []);

    for (const s of alleStuecke) setzeSichtbar(s, sichtbar.has(s));

    btnPrev.style.display = nr > 0 ? '' : 'none';
    btnNext.style.display = nr < seiten.length - 1 ? '' : 'none';
  }

  function planen() {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(anpassen);
  }

  btnNext.addEventListener('click', () => {
    if (aktuelleSeite < seiten.length - 1) zeigeSeite(aktuelleSeite + 1);
  });

  btnPrev.addEventListener('click', () => {
    if (aktuelleSeite > 0) zeigeSeite(aktuelleSeite - 1);
  });

  window.addEventListener('resize', planen, { passive: true });

  /* ══════════════════════════════════════════════════════════════════
     UND WENN NUR DIE LEISTE SCHMALER WIRD

     Das Aufziehen der Navigation nimmt der Leiste über hundert Pixel,
     ohne dass sich das Fenster ändert – ein resize kommt dabei nicht.
     Die Aufteilung blieb deshalb stehen, wie sie ohne Navigation
     gerechnet war, und im Hochformat stand die Leiste danach über den
     Rand hinaus (scripts/test-touch, „hoch 700 + Navigation").

     Ein Beobachter auf der Leiste selbst deckt jeden Grund ab, aus dem
     sie schmaler wird. Eine Schleife entsteht daraus nicht: anpassen()
     blendet nur Kinder aus, die Breite der Leiste selbst rührt es nicht
     an – und planen() bündelt ohnehin auf ein Einzelbild.
     ══════════════════════════════════════════════════════════════════ */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(planen).observe(bar);
  }

  /* Der Werkzeugwechsel blendet ganze Gruppen ein und aus (applyMode) –
     danach ist die Rechnung eine andere. */
  window.updateToolbarOverflow = planen;

  document.addEventListener('DOMContentLoaded', planen);
  planen();
})();

/** Zeichnet der Finger gerade, statt zu scrollen? */
function touchDrawActive() {
  return !!S.touchDraw && typeof isDrawMode === 'function' && isDrawMode(S.mode);
}

/**
 * Knopf und Klasse am body auf den Stand bringen.
 *
 * >>> Warum die Klasse am WERKZEUG haengt und nicht am Schalter <<<
 * Sie schaltet touch-action der Zeichenflaechen ab (css/pages.css) – und
 * das darf nur gelten, solange wirklich gezeichnet wird. Stuende sie
 * schon in der Zeigerstellung, liesse sich die Seite dort nicht mehr mit
 * dem Finger schieben, ohne dass jemand einen Strich vorhat.
 *
 * Muss deshalb bei JEDEM Werkzeugwechsel mitlaufen: applyMode() ruft es.
 */
function updateTouchDrawUI() {
  const btn = E('btn-touch-draw');
  if (btn) {
    btn.classList.toggle('active', !!S.touchDraw);

    /* >>> In der Zeigerstellung hat er nichts zu sagen <<<
       Der Schalter entscheidet, ob der Finger ZEICHNET statt zu
       scrollen – und gezeichnet wird nur mit einem Zeichenwerkzeug
       (touchDrawActive prueft dasselbe). Mit dem Cursor in der Hand
       stand hier also ein Knopf, der auf nichts wirkte; gemeldet
       wurde genau das. Er kommt zurueck, sobald ein Stift, der
       Marker, der Radierer oder die Formen gewaehlt sind. */
    const zeigt = !!window.hatFingerGeraet
      && typeof isDrawMode === 'function' && isDrawMode(S.mode);
    btn.style.display = zeigt ? '' : 'none';
  }
  document.body.classList.toggle('touch-draw', touchDrawActive());
}

/* Pen color presets */
QA('.pen-sw[data-pcolor]').forEach(sw => {
  sw.addEventListener('click', () => {
    const c = sw.dataset.pcolor;
    if (S.mode === 'pen1') S.pen1.color = c;
    else if (S.mode === 'pen2') S.pen2.color = c;
    else if (S.mode === 'hl') S.hl.color = c;
    updatePenUI();
  });
});

function updatePenUI() {
  const m = S.mode, pen = m === 'pen1' ? S.pen1 : m === 'pen2' ? S.pen2 : m === 'hl' ? S.hl : null;
  if (!pen) return;
  if (!pen.customColor) pen.customColor = pen.color;
  // Der Rainbow-Ring bleibt bunt – nicht mehr die aktuelle Farbe zeigen
  E('pen-color-in').value = pen.customColor;
  QA('#pen-sz-row .sz-btn').forEach(b => b.classList.toggle('active', +b.dataset.sz === pen.szIdx));
  let hasNorm = false;
  QA('.pen-sw[data-pcolor]').forEach(sw => {
    const isMatch = sw.dataset.pcolor === pen.color;
    sw.classList.toggle('active', isMatch);
    if (isMatch) hasNorm = true;
  });
  E('pen-color-ring').classList.toggle('active', !hasNorm);
}
let _customColorTarget = null;
let _customColorAnchor = null;
let _customColorCallback = null;  // für Formen u.Ä., die eigene Apply-Logik brauchen
const _recentCustomColors = [];
const RECENT_CUSTOM_COLORS_MAX = 5;

function activePenState() {
  return S.mode === 'pen1' ? S.pen1 : S.mode === 'pen2' ? S.pen2 : S.mode === 'hl' ? S.hl : S.pen1;
}

function closeCustomColorPopover() {
  E('custom-color-pop').style.display = 'none';
  _customColorTarget = null;
  _customColorAnchor = null;
  _customColorCallback = null;
}

function positionCustomColorPopover(anchorEl) {
  const pop = E('custom-color-pop');
  if (!pop || !anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  pop.style.left = Math.round(r.left + r.width / 2) + 'px';
  pop.style.top = Math.round(r.bottom + 8) + 'px';
  pop.style.transform = 'translateX(-50%)';
}

function normalizeHexColor(color) {
  if (!color) return null;
  const hex = String(color).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

function currentCustomColor() {
  return normalizeHexColor(
    S.pen1.customColor ||
    S.pen2.customColor ||
    S.hl.customColor ||
    S.textCustomColor ||
    S.textColor
  );
}

function saveRecentCustomColor(color) {
  const hex = normalizeHexColor(color);
  if (!hex) return;
  const existingIndex = _recentCustomColors.indexOf(hex);
  if (existingIndex >= 0) _recentCustomColors.splice(existingIndex, 1);
  _recentCustomColors.unshift(hex);
  if (_recentCustomColors.length > RECENT_CUSTOM_COLORS_MAX) _recentCustomColors.length = RECENT_CUSTOM_COLORS_MAX;
}

function renderRecentCustomColors() {
  const wrap = E('custom-color-recent');
  if (!wrap) return;
  const colors = _recentCustomColors.slice(0, RECENT_CUSTOM_COLORS_MAX);
  const kopf = E('custom-color-recent-head');
  wrap.innerHTML = '';
  if (!colors.length) {
    wrap.style.display = 'none';
    if (kopf) kopf.style.display = 'none';
    return;
  }
  if (kopf) kopf.style.display = '';
  colors.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-color-recent-btn';
    btn.title = color;
    btn.style.background = color;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const input = E('custom-color-pop-input');
      input.value = color;
      applyCustomColorValue(color, true);
    });
    wrap.appendChild(btn);
  });
  wrap.style.display = 'flex';
}

let _savedTextRange = null;

function openCustomColorPopover(target, anchorEl, onApply) {
  _customColorTarget = target;
  _customColorAnchor = anchorEl;
  _customColorCallback = onApply || null;
  
  if (target === 'text') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) _savedTextRange = sel.getRangeAt(0);
    else _savedTextRange = null;
  }

  const pop = E('custom-color-pop');
  const input = E('custom-color-pop-input');
  const txt = (k, e) => (typeof t === 'function' && t(k)) || e;
  E('custom-color-pop-title').textContent = target === 'text'
    ? txt('textColor', 'Textfarbe') : txt('penColor', 'Stiftfarbe');

  /* Die Farbe der Stelle, an der die Marke steht – nicht irgendeine
     zuletzt benutzte. Beim Text steht sie im Dokument selbst
     (queryCommandValue), sonst im Werkzeug. */
  const start = target === 'text'
    ? (farbeUnterMarke() || S.textCustomColor || S.textColor)
    : (activePenState().customColor || activePenState().color);

  const c = normalizeHexColor(start) || '#1a1510';
  input.value = c;
  const hexFeld = E('custom-color-hex');
  if (hexFeld) hexFeld.value = c;

  // Keine Preset-Farben mehr – der native Picker öffnet direkt, der
  // Nutzer will keine vorgefertigten Felder davor.

  pop.style.display = 'block';
  positionCustomColorPopover(anchorEl);
  renderRecentCustomColors();
}

/**
 * Welche Textfarbe gilt an der Schreibmarke?
 *
 * Wie in Word: der Knopf zeigt, womit man gerade schreibt, nicht das
 * zuletzt Gewählte. queryCommandValue liefert rgb(…), das muss noch in
 * die Schreibweise mit dem Doppelkreuz umgerechnet werden.
 */
/* ══════════════════════════════════════════════════════════════════════
   DIE FARBE EINES VERWEISES IST KEINE TEXTFARBE

   >>> Der Fehler, den das behebt <<<
   Wer hinter einem Verweis weitertippte, schrieb in Blau weiter statt in
   seiner eigenen Farbe. Gemeldet als „die blaue Farbe wurde einfach
   mitgegeben".

   queryCommandValue('foreColor') liefert die BERECHNETE Farbe an der
   Marke. Steht sie an einem Verweis, ist das dessen Blau – und das kommt
   aus einer Stilregel (css/pages.css), nicht aus dem Text. Die App hielt
   es trotzdem für die gewählte Textfarbe: der Farbpunkt in der Leiste
   sprang auf Blau, das Farbfenster ging mit Blau auf, und die
   Sticky-Farbe verglich dagegen.

   Deshalb wird der Verweis übersprungen und die Farbe seiner Umgebung
   genommen – ausser der Verweis trägt eine eigene, ausdrücklich gesetzte
   Farbe. Dann ist sie gewollt und gilt.
   ══════════════════════════════════════════════════════════════════════ */

/** Das Element, in dem die Schreibmarke steht. */
function elementUnterMarke() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let k = sel.getRangeAt(0).startContainer;
  if (k && k.nodeType === 3) k = k.parentNode;
  return (k && k.nodeType === 1) ? k : null;
}

/**
 * Der Verweis, dessen Farbe die Marke gerade abbekommt – oder null.
 *
 * Zwei Stellen zählen, und die zweite ist die wichtigere:
 *
 *   · MITTEN im Verweis. Klar.
 *   · Direkt DAHINTER. Chromium meldet dort weiterhin die Farbe des
 *     Verweises, obwohl getippter Text schon ausserhalb landet. Und
 *     genau dort steht die Marke, nachdem man einen Verweis eingefügt
 *     hat (ui/links.js setzt sie hinter das Element) – das ist der Fall
 *     aus der Meldung.
 */
function verweisAnDerMarke() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;

  const el = elementUnterMarke();
  const drin = (el && el.closest) ? el.closest('a[href]') : null;
  if (drin) return drin;

  // Steht direkt davor ein Verweis?
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return null;

  const k = r.startContainer;
  let davor = null;
  if (k.nodeType === 1) davor = k.childNodes[r.startOffset - 1] || null;
  else if (k.nodeType === 3 && r.startOffset === 0) davor = k.previousSibling;

  return (davor && davor.nodeType === 1 && davor.matches && davor.matches('a[href]'))
    ? davor : null;
}

/**
 * Hat dieser Verweis eine eigene Farbe bekommen?
 *
 * Zwei Wege gibt es dafür: ein style="color:…" am Verweis selbst, oder
 * ein <font color> darin – so legt Chromium foreColor ab.
 */
function verweisHatEigeneFarbe(a) {
  if (!a) return false;
  if (a.style && a.style.color) return true;
  return !!a.querySelector('font[color], [style*="color"]');
}

function farbeUnterMarke() {
  const feld = document.activeElement;
  if (!feld || !feld.classList || !feld.classList.contains('j-text')) return null;

  const hexAus = (wert) => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(wert || ''));
    if (m) {
      const hex = n => ('0' + (+n).toString(16)).slice(-2);
      return '#' + hex(m[1]) + hex(m[2]) + hex(m[3]);
    }
    return normalizeHexColor(wert);
  };

  /* Steht die Marke an einem Verweis ohne eigene Farbe, gilt die Farbe
     der UMGEBUNG. Sie wird direkt am Elternteil abgelesen und nicht über
     queryCommandValue – das kennt den Unterschied nicht. */
  const verweis = verweisAnDerMarke();
  if (verweis && !verweisHatEigeneFarbe(verweis) && verweis.parentElement) {
    return hexAus(getComputedStyle(verweis.parentElement).color);
  }

  let wert = '';
  try { wert = document.queryCommandValue('foreColor') || ''; } catch (e) { return null; }
  return hexAus(wert);
}

/**
 * Setzt die gewählte Farbe – NUR dort, wo sie hingehört.
 *
 * >>> Warum nicht mehr überall zugleich <<<
 * Vorher schrieb diese Stelle die Farbe in Stift 1, Stift 2, den Marker
 * UND den Text, egal wofür sie gewählt worden war. Wer eine Textfarbe
 * einstellte, hatte danach auch einen andersfarbigen Stift und einen
 * andersfarbigen Marker. Jetzt gilt sie für das, was gefragt war.
 *
 * @param {string} color
 * @param {boolean} applyToSelection ob der markierte Text eingefärbt wird
 */
function syncGlobalCustomColor(color, applyToSelection) {
  const c = normalizeHexColor(color);
  if (!c) return;

  if (_customColorTarget === 'text') {
    S.textCustomColor = c;
    S.textColor = c;
    S._textColorChosen = c;   // sticky: explizit gewählte Farbe bleibt
    E('txt-color-dot').style.background = c;
    E('txt-custom-ring').classList.add('active');
    QA('.pen-sw[data-tcolor]').forEach(sw => sw.classList.remove('active'));
  } else {
    const stift = activePenState();
    stift.customColor = c;
    stift.color = c;
    QA('.pen-sw[data-pcolor]').forEach(sw => sw.classList.remove('active'));
  }

  // Den Zahlencode nachziehen, egal woher die Änderung kam
  const hexFeld = E('custom-color-hex');
  if (hexFeld && document.activeElement !== hexFeld) hexFeld.value = c;
  const wahl = E('custom-color-pop-input');
  if (wahl && wahl.value !== c) wahl.value = c;
  markierePresets(c);

  if (applyToSelection && _savedTextRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_savedTextRange);
  }
  if (applyToSelection && _customColorTarget === 'text') {
    document.execCommand('foreColor', false, c);
  }
  updatePenUI();
}

/* ── Vorgefertigte Farben im Auswahlfenster ──────────────────────────
   Damit man nicht für jedes Schwarz erst im Farbkreis suchen muss. */
const FARB_PRESETS = [
  '#1a1510', '#5a5148', '#8a8078', '#ffffff',
  '#c04040', '#e07020', '#e8c547', '#2e8a46',
  '#2a5fa8', '#5b3fa0', '#c0509a', '#7a4a28'
];

function markierePresets(c) {
  const wrap = E('custom-color-preset');
  if (!wrap) return;
  wrap.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.farbe === c));
}

function baueFarbPresets() {
  const wrap = E('custom-color-preset');
  if (!wrap || wrap.children.length) return;
  for (const farbe of FARB_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'custom-color-preset-btn';
    b.style.background = farbe;
    b.dataset.farbe = farbe;
    b.title = farbe;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => {
      e.stopPropagation();
      E('custom-color-pop-input').value = farbe;
      applyCustomColorValue(farbe, true);
    });
    wrap.appendChild(b);
  }
}

function applyCustomColorValue(color, commitHistory) {
  const c = normalizeHexColor(color);
  if (!c) return;
  if (_customColorCallback) {
    _customColorCallback(c, commitHistory);
  } else {
    syncGlobalCustomColor(c, _customColorTarget === 'text');
  }
  if (commitHistory) {
    saveRecentCustomColor(c);
    renderRecentCustomColors();
  }
}

/* applyPenCustomColor und applyTextCustomColor sind entfallen: sie waren
   die „kurzer Druck"-Hälfte des langen Drucks und setzten nur noch einmal
   dieselbe Farbe. Der Ring öffnet jetzt die Auswahl (bindColorPress). */

/**
 * Der Regenbogen-Ring öffnet die Farbwahl. Ein Klick, sonst nichts.
 *
 * >>> Warum der lange Druck weg ist <<<
 * Er dauerte eine ganze Sekunde und war nirgends angeschrieben. Ein
 * kurzer Klick setzte stattdessen die zuletzt gewählte Farbe noch einmal
 * – also meistens dieselbe, und damit sichtbar gar nichts. Genau so wurde
 * es gemeldet: „wenn man drückt passiert nichts".
 *
 * @param {HTMLElement} el
 * @param {Function} onOeffnen  bekommt das Element als Anker
 */
function bindColorPress(el, onOeffnen) {
  if (!el) return;
  // Die Schreibmarke darf beim Klick nicht aus dem Text fallen
  el.addEventListener('mousedown', e => e.preventDefault());
  el.addEventListener('click', e => {
    e.stopPropagation();
    onOeffnen(el);
  });
}

/* ── Pen-Rainbow-Ring: Ein Klick öffnet das Farb-Popover ──────────
   Mit nativem Picker, zuletzt verwendeten Farben und Hex-Code. Der
   darunterliegende input[type=color] wird weiterhin für sich selbst
   gehört – wer ihn erreicht (etwa per Tab), bekommt den nativen Dialog. */
bindColorPress(E('pen-color-ring'), el => {
  openCustomColorPopover('pen', el);
});

E('custom-color-pop-input').addEventListener('input', function () {
  applyCustomColorValue(this.value, false);
});

E('custom-color-pop-input').addEventListener('change', function () {
  applyCustomColorValue(this.value, true);
});

/* ── Der Zahlencode ───────────────────────────────────────────────────
   Zum Ablesen, Abschreiben und Eintippen. Wer eine Farbe aus einem
   anderen Programm übernehmen will, kommt sonst gar nicht an sie heran. */
const hexFeld = E('custom-color-hex');
if (hexFeld) {
  hexFeld.addEventListener('mousedown', e => e.stopPropagation());
  hexFeld.addEventListener('click', function (e) { e.stopPropagation(); this.select(); });
  hexFeld.addEventListener('input', function () {
    let v = this.value.trim();
    if (v && v[0] !== '#') v = '#' + v;
    // Kurzform #abc genauso annehmen wie #aabbcc
    const kurz = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
    if (kurz) v = '#' + kurz[1] + kurz[1] + kurz[2] + kurz[2] + kurz[3] + kurz[3];
    const c = normalizeHexColor(v);
    if (!c) return;                       // beim Tippen noch unvollständig
    E('custom-color-pop-input').value = c;
    applyCustomColorValue(c, false);
  });
  hexFeld.addEventListener('change', function () {
    const c = normalizeHexColor(this.value);
    if (c) applyCustomColorValue(c, true);
    else this.value = E('custom-color-pop-input').value;   // Unsinn zurücksetzen
  });
  hexFeld.addEventListener('keydown', e => {
    e.stopPropagation();                  // keine Tastenkürzel beim Tippen
    if (e.key === 'Enter') { e.preventDefault(); hexFeld.blur(); }
  });
}

const kopierKnopf = E('custom-color-copy');
if (kopierKnopf) {
  kopierKnopf.addEventListener('mousedown', e => e.preventDefault());
  kopierKnopf.addEventListener('click', async e => {
    e.stopPropagation();
    const c = E('custom-color-hex').value;
    try {
      await navigator.clipboard.writeText(c);
      if (typeof toast === 'function') {
        toast(((typeof t === 'function' && t('colorCopied')) || 'Farbcode kopiert') + ': ' + c);
      }
    } catch (err) {
      // Ohne Zwischenablage wenigstens markieren, dann geht Strg+C
      E('custom-color-hex').select();
    }
  });
}

E('custom-color-pop-close').addEventListener('click', e => {
  e.stopPropagation();
  closeCustomColorPopover();
});

QA('#pen-sz-row .sz-btn').forEach(btn => { btn.addEventListener('click', () => { const i = +btn.dataset.sz; if (S.mode === 'pen1') S.pen1.szIdx = i; else if (S.mode === 'pen2') S.pen2.szIdx = i; else if (S.mode === 'hl') S.hl.szIdx = i; QA('#pen-sz-row .sz-btn').forEach(b => b.classList.toggle('active', +b.dataset.sz === i)); }); });
QA('[data-eraser]').forEach(btn => { btn.addEventListener('click', () => { S.eraser.type = btn.dataset.eraser; QA('[data-eraser]').forEach(b => b.classList.remove('active')); btn.classList.add('active'); updateCursor(); }); });
QA('#er-sz-row .sz-btn').forEach(btn => { btn.addEventListener('click', () => { S.eraser.szIdx = +btn.dataset.esz; QA('#er-sz-row .sz-btn').forEach(b => b.classList.toggle('active', +b.dataset.esz === S.eraser.szIdx)); updateCursor(); }); });

function positionTextColorDropdown() {
  const dd = E('txt-color-dropdown');
  const anchor = E('txt-color-wrap') || E('txt-color-ring');
  if (!dd || !anchor) return;
  const r = anchor.getBoundingClientRect();
  dd.style.left = Math.round(r.left + r.width / 2) + 'px';
  dd.style.top = Math.round(r.bottom + 8) + 'px';
  dd.style.transform = 'translateX(-50%)';
}

/* Text color dropdown */
E('txt-color-dropdown').addEventListener('mousedown', e => e.preventDefault());
E('custom-color-pop').addEventListener('mousedown', e => e.preventDefault());
E('txt-color-ring').addEventListener('mousedown', e => e.preventDefault());
E('txt-color-ring').addEventListener('click', e => {
  e.stopPropagation();
  const dd = E('txt-color-dropdown');
  const willShow = dd.style.display === 'none';
  dd.style.display = willShow ? 'flex' : 'none';
  if (willShow) positionTextColorDropdown();
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#txt-color-dropdown') && !e.target.closest('#txt-color-ring')) {
    E('txt-color-dropdown').style.display = 'none';
  }
  if (!e.target.closest('#custom-color-pop') && !e.target.closest('#pen-color-ring') && !e.target.closest('#txt-custom-ring')) {
    closeCustomColorPopover();
  }
});
QA('.pen-sw[data-tcolor]').forEach(sw => {
  sw.addEventListener('mousedown', e => e.preventDefault());
  sw.addEventListener('click', () => {
    const c = sw.dataset.tcolor;
    S.textColor = c;
    S._textColorChosen = c;   // sticky: wer wählt, will in dieser Farbe schreiben
    E('txt-color-dot').style.background = c;
    // Vor dem Farbbefehl das Textfeld fokussieren – hat der Klick auf
    // den Farbring dem Textfeld den Fokus genommen, weiss execCommand
    // sonst nicht, worauf es wirken soll.
    const textFeld = document.activeElement &&
      document.activeElement.classList &&
      document.activeElement.classList.contains('j-text') ? document.activeElement
      : document.querySelector('.j-text:focus');
    if (!textFeld) {
      const erstes = document.querySelector('.j-text');
      if (erstes) erstes.focus();
    }
    document.execCommand('foreColor', false, c);
    QA('.pen-sw[data-tcolor]').forEach(s => s.classList.toggle('active', s.dataset.tcolor === c));
    E('txt-custom-ring').classList.remove('active');
    E('txt-color-dropdown').style.display = 'none';
  });
});
/* ── Text-Rainbow-Ring: Ein Klick öffnet das Farb-Popover ──────── */
bindColorPress(E('txt-custom-ring'), el => {
  openCustomColorPopover('text', el);
});
E('txt-color-in').addEventListener('input', function () {
  S.textColor = this.value; E('txt-color-dot').style.background = this.value;
  S.textCustomColor = this.value;
  document.execCommand('foreColor', false, this.value);
  QA('.pen-sw[data-tcolor]').forEach(s => s.classList.remove('active'));
  E('txt-color-dropdown').style.display = 'none';
});
window.addEventListener('resize', positionTextColorDropdown, { passive: true });
E('pg-scroll').addEventListener('scroll', () => {
  if (E('txt-color-dropdown').style.display !== 'none') positionTextColorDropdown();
  if (E('custom-color-pop').style.display !== 'none' && _customColorAnchor) positionCustomColorPopover(_customColorAnchor);
  if (_listPopOffen) positionListStylePop();
  if (_alignPopOffen) positionAlignPop();
}, { passive: true });

/* Heading toggles */
function curBlockTag() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const node = sel.anchorNode;
  const block = node?.nodeType === 3 ? node.parentElement : node;
  return block?.closest('[contenteditable] h1,[contenteditable] h2,[contenteditable] h3,[contenteditable] p,[contenteditable] div') || null;
}

function clearTitleClasses(block) {
  if (!block || !block.classList) return;
  block.classList.remove('j-title-1', 'j-title-2', 'j-title-3');
}

function getTitleLevel(block) {
  if (!block) return null;
  const tag = (block.tagName || '').toLowerCase();
  if (tag === 'h1') return 1;
  if (tag === 'h2') return 2;
  if (tag === 'h3') return 3;
  if (block.classList?.contains('j-title-1')) return 1;
  if (block.classList?.contains('j-title-2')) return 2;
  if (block.classList?.contains('j-title-3')) return 3;
  return null;
}

function normalizeActiveHeadingToLeft() {
  const block = curBlockTag();
  if (!block || !getTitleLevel(block)) return;
  const txt = block.textContent || '';
  const trimmed = txt.replace(/^[\s\u00A0]+/, '');
  if (trimmed !== txt) block.textContent = trimmed;
}

function toggleHeading(tag) {
  const targetLevel = tag === 'h1' ? 1 : tag === 'h2' ? 2 : 3;
  const current = curBlockTag();
  const currentLevel = getTitleLevel(current);
  
  // Undo/Redo-Logik entfernt
  
  document.execCommand('formatBlock', false, 'p');
  setTimeout(() => {
    const block = curBlockTag();
    if (!block) return;
    clearTitleClasses(block);
    if (currentLevel !== targetLevel) block.classList.add('j-title-' + targetLevel);
    normalizeActiveHeadingToLeft();
    updateHdrBtns();
    renderSideTree();
    // Sync page content after change
    if (info) {
      const pgEl = E('pages-wrap')?.querySelector('[data-pgid="' + info.page.id + '"]');
      const textDiv = pgEl?.querySelector('.j-text');
      if (textDiv) info.page.textContent = textDiv.innerHTML;
    }
  }, 50);
}

function updateHdrBtns() {
  const level = getTitleLevel(curBlockTag());
  E('fmt-h1').classList.toggle('active', level === 1);
  E('fmt-h2').classList.toggle('active', level === 2);
  E('fmt-h3').classList.toggle('active', level === 3);
  E('fmt-p').classList.toggle('active', !level);
  // Der Knopf zeigt, was gerade gilt – sonst müsste man die Auswahl öffnen,
  // nur um zu sehen, in welchem Format man schreibt
  const lbl = E('fmt-style-lbl');
  if (lbl) lbl.textContent = level ? ('H' + level) : '¶';

  /* Der Farbpunkt zeigt die Farbe an der Schreibmarke – wie in Word. Er
     stand vorher auf dem zuletzt GEWÄHLTEN Wert und log damit, sobald man
     in andersfarbigen Text klickte. */
  const farbe = farbeUnterMarke();
  if (farbe) {
    S.textColor = farbe;
    const punkt = E('txt-color-dot');
    if (punkt) punkt.style.background = farbe;
    QA('.pen-sw[data-tcolor]').forEach(s =>
      s.classList.toggle('active', s.dataset.tcolor === farbe));
  }
  E('fmt-bold').classList.toggle('active', document.queryCommandState('bold'));
  E('fmt-italic').classList.toggle('active', document.queryCommandState('italic'));
  E('fmt-under').classList.toggle('active', document.queryCommandState('underline'));
  updateListBtns();
  updateAlignBtns();
}

/* ══════════════════════════════════════════════════════════════════════
   LISTEN – EIN GETEILTER KNOPF FÜR BEIDES

   Die breite Hälfte schaltet die zuletzt benutzte Form an und aus, die
   schmale öffnet die Auswahl. Darin stehen Punkte und Nummern
   untereinander; welche Art es wird, entscheidet also die Zelle, die man
   antippt – nicht schon der Knopf davor.

   >>> Warum ein Knopf und nicht zwei <<<
   Zwei geteilte Knöpfe sind vier Trefferflächen für eine einzige
   Entscheidung. Nebeneinander sahen sie außerdem aus wie ein
   Entweder-oder, obwohl beide dasselbe tun. Und im Hochformat kostete
   das 71 px in einer Leiste, die dort ohnehin zu eng ist.

   Damit der Knopf trotzdem sagt, was er tut, trägt er das Bild der
   zuletzt benutzten Art: Punkte oder Nummern.

   Die Auswahl wird aus Lists.STYLES gebaut (core/lists.js) – die Formen
   stehen dort an einer Stelle, zusammen mit ihren Klassennamen und der
   Darstellung in css/pages.css. Eine zweite Liste hier würde beim
   nächsten Hinzufügen einer Form auseinanderlaufen.
   ══════════════════════════════════════════════════════════════════════ */

let _listPopOffen = false;

/** Zeigt der Knopf Punkte oder Nummern? */
function setListIcon(art) {
  const ul = E('list-icon-ul');
  const ol = E('list-icon-ol');
  if (!ul || !ol) return;
  ul.style.display = art === 'ol' ? 'none' : '';
  ol.style.display = art === 'ol' ? '' : 'none';
}

function updateListBtns() {
  if (typeof Lists === 'undefined') return;
  const aktiv = Lists.activeStyleId();
  E('fmt-list-wrap').classList.toggle('active', !!aktiv);
  /* Steht die Marke in einer Liste, zeigt der Knopf DEREN Art – sonst
     die zuletzt benutzte. So heißt ein Druck darauf immer sichtbar
     „diese Liste weg" bzw. „so eine Liste her". */
  setListIcon(aktiv ? (Lists.styleById(aktiv).tag === 'OL' ? 'ol' : 'ul') : Lists.lastKind());
}

/* Die Schreibmarke steht im Text, nicht im Knopf. Ein Klick würde sie
   verlieren, und damit wüsste execCommand nicht mehr, worauf es wirken
   soll – deshalb überall preventDefault auf mousedown. */
function listNoBlur(el) {
  if (el) el.addEventListener('mousedown', e => e.preventDefault());
}

function buildListStyleGrid(gridId, art) {
  const grid = E(gridId);
  const aktiv = Lists.activeStyleId();
  grid.innerHTML = '';

  Lists.STYLES.filter(s => (s.tag === 'OL') === (art === 'ol')).forEach(style => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'list-style-cell' + (style.id === aktiv ? ' active' : '');
    cell.title = (typeof t === 'function' && style.labelKey) ? t(style.labelKey) : style.id;

    style.probe.forEach(marke => {
      const row = document.createElement('span');
      row.className = 'lsp-row';
      const b = document.createElement('b');
      b.textContent = marke;
      const i = document.createElement('i');
      row.appendChild(b);
      row.appendChild(i);
      cell.appendChild(row);
    });

    cell.addEventListener('mousedown', e => e.preventDefault());
    cell.addEventListener('click', () => {
      Lists.apply(style.id, true);
      closeListStylePop();
      setTimeout(updateHdrBtns, 0);
    });
    grid.appendChild(cell);
  });
}

function positionListStylePop() {
  const pop = E('list-style-pop');
  const anchorEl = E('fmt-list-wrap');
  if (!pop || !anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  pop.style.left = Math.round(r.left + r.width / 2) + 'px';
  pop.style.top = Math.round(r.bottom + 8) + 'px';
  pop.style.transform = 'translateX(-50%)';

  // An keinem Rand aus dem Fenster laufen
  const box = pop.getBoundingClientRect();
  const zuVielRechts = box.right - (window.innerWidth - 8);
  if (zuVielRechts > 0) pop.style.left = Math.round(box.left - zuVielRechts + box.width / 2) + 'px';
  const nachLinks = pop.getBoundingClientRect().left;
  if (nachLinks < 8) pop.style.left = Math.round(8 + pop.getBoundingClientRect().width / 2) + 'px';
}

function openListStylePop() {
  if (typeof Lists === 'undefined') return;
  _listPopOffen = true;
  buildListStyleGrid('list-style-grid-ul', 'ul');
  buildListStyleGrid('list-style-grid-ol', 'ol');
  E('list-style-pop').style.display = 'block';
  positionListStylePop();
}

function closeListStylePop() {
  E('list-style-pop').style.display = 'none';
  _listPopOffen = false;
}

['fmt-list', 'fmt-list-more', 'list-style-pop'].forEach(id => listNoBlur(E(id)));

E('fmt-list').addEventListener('click', () => { Lists.toggle(); setTimeout(updateHdrBtns, 0); });

E('fmt-list-more').addEventListener('click', e => {
  e.stopPropagation();
  if (_listPopOffen) return closeListStylePop();
  openListStylePop();
});

E('list-style-off').addEventListener('click', () => {
  Lists.remove();
  closeListStylePop();
  setTimeout(updateHdrBtns, 0);
});

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#list-style-pop') && !e.target.closest('.tb-split')) closeListStylePop();
});
window.addEventListener('resize', () => {
  if (_listPopOffen) positionListStylePop();
}, { passive: true });

/* ══════════════════════════════════════════════════════════════════════
   AUSRICHTUNG – DERSELBE GETEILTE KNOPF

   Vier Möglichkeiten, von denen immer genau eine gilt. Als vier einzelne
   Knöpfe wären das vier Trefferflächen für eine Entscheidung – in einer
   Leiste, die im Hochformat ohnehin blättern muss, ist das der falsche
   Handel. Also gebaut wie der Listen-Knopf daneben: die breite Hälfte
   legt die GEZEIGTE Ausrichtung an und wieder ab, der Pfeil öffnet die
   Auswahl.

   >>> Warum eine Klasse und kein execCommand <<<
   document.execCommand('justifyCenter') erzeugt je nach Browser mal ein
   style="text-align", mal ein <div align>. Von einem style bleibt beim
   Bereinigen allein die Farbe stehen (core/sanitize.js) – die
   Ausrichtung wäre beim ersten Cloud-Abgleich weg. Die Klasse steht
   dort ausdrücklich in der Erlaubnisliste.

   >>> Warum links keine Klasse bekommt <<<
   Linksbündig IST der Zustand ohne Auszeichnung. Eine eigene Klasse
   dafür wäre eine zweite Schreibweise für dasselbe, und beim Öffnen
   fremder Hefte müsste man beide kennen.
   ══════════════════════════════════════════════════════════════════════ */

const AUSRICHTUNGEN = [
  { id: 'left', klasse: null, labelKey: 'alignLeft', probe: [13, 9, 13, 9], anker: 'start' },
  { id: 'center', klasse: 'j-align-center', labelKey: 'alignCenter', probe: [13, 9, 13, 9], anker: 'mitte' },
  { id: 'right', klasse: 'j-align-right', labelKey: 'alignRight', probe: [13, 9, 13, 9], anker: 'ende' },
  { id: 'justify', klasse: 'j-align-justify', labelKey: 'alignJustify', probe: [13, 13, 13, 13], anker: 'start' }
];

let _alignPopOffen = false;
let _letzteAusrichtung = 'center';   // was die breite Hälfte anlegt

/** Die Ausrichtung des Absatzes, in dem die Schreibmarke steht. */
function aktiveAusrichtung() {
  const block = curBlockTag();
  if (!block || !block.classList) return 'left';
  for (const a of AUSRICHTUNGEN) {
    if (a.klasse && block.classList.contains(a.klasse)) return a.id;
  }
  return 'left';
}

/** Zeichnet die vier Striche so, wie der Absatz danach stünde. */
function maleAusrichtungsIcon(svgOderPfad, id) {
  const art = AUSRICHTUNGEN.find(a => a.id === id) || AUSRICHTUNGEN[0];
  const zeilen = art.probe.map((breite, i) => {
    const y = 3 + i * 3.5;
    let x1 = 1.5;
    if (art.anker === 'mitte') x1 = 1.5 + (13 - breite) / 2;
    else if (art.anker === 'ende') x1 = 1.5 + (13 - breite);
    return `M${x1} ${y}h${breite}`;
  }).join('');
  svgOderPfad.setAttribute('d', zeilen);
}

function updateAlignBtns() {
  const wrap = E('fmt-align-wrap');
  const pfad = E('align-icon-lines');
  if (!wrap || !pfad) return;
  const aktiv = aktiveAusrichtung();
  wrap.classList.toggle('active', aktiv !== 'left');
  /* Steht die Marke in einem ausgerichteten Absatz, zeigt der Knopf
     DESSEN Ausrichtung – sonst die zuletzt benutzte. Ein Druck heißt
     damit immer sichtbar „so" bzw. „das wieder weg". */
  maleAusrichtungsIcon(pfad, aktiv !== 'left' ? aktiv : _letzteAusrichtung);
}

/**
 * Legt eine Ausrichtung an – auf allen Absätzen, die die Auswahl berührt.
 *
 * Über die berührten Blöcke und nicht nur über den einen an der Marke:
 * wer drei Absätze markiert und zentriert drückt, meint alle drei.
 */
function setzeAusrichtung(id) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const feld = curBlockTag()?.closest('.j-text');
  if (!feld || feld.isContentEditable === false) return;
  if (typeof S !== 'undefined' && S.readOnly) return;

  const pgEl = feld.closest('[data-pgid]');
  const info = pgEl && typeof getPage === 'function' ? getPage(pgEl.dataset.pgid) : null;
  if (info && typeof pushPageHistory === 'function') pushPageHistory(info.page);

  const bereich = sel.getRangeAt(0);
  const bloecke = [...feld.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,td,th')]
    .filter(el => bereich.intersectsNode(el)
      // Nur der innerste Block je Stelle – sonst bekäme ein <td> die
      // Klasse zusätzlich zu dem <p> darin, und beide richteten aus.
      && !el.querySelector('p,div,h1,h2,h3,h4,h5,h6,li'));
  if (!bloecke.length) {
    const einzeln = curBlockTag();
    if (einzeln) bloecke.push(einzeln);
  }

  for (const block of bloecke) {
    for (const a of AUSRICHTUNGEN) if (a.klasse) block.classList.remove(a.klasse);
    const art = AUSRICHTUNGEN.find(a => a.id === id);
    if (art && art.klasse) block.classList.add(art.klasse);
  }

  if (id !== 'left') _letzteAusrichtung = id;
  updateAlignBtns();

  // Der Umbau von Hand feuert kein 'input' – das Sichern muss also selbst
  // angestoßen werden, sonst wäre die Ausrichtung nach dem Neustart weg.
  if (info) {
    info.page.textContent = typeof ohneGriffe === 'function' ? ohneGriffe(feld) : feld.innerHTML;
    if (window.Collab) Collab.noteTextChange(info.page.id, info.page.textContent);
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
  }
  if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
}

function buildAlignRow() {
  const reihe = E('align-row');
  if (!reihe) return;
  const aktiv = aktiveAusrichtung();
  reihe.innerHTML = '';

  for (const art of AUSRICHTUNGEN) {
    const zelle = document.createElement('button');
    zelle.type = 'button';
    zelle.className = 'list-style-cell align-cell' + (art.id === aktiv ? ' active' : '');
    zelle.title = (typeof t === 'function' && art.labelKey) ? t(art.labelKey) : art.id;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 16 16');
    const pfad = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pfad.setAttribute('stroke', 'currentColor');
    pfad.setAttribute('stroke-width', '1.4');
    pfad.setAttribute('stroke-linecap', 'round');
    maleAusrichtungsIcon(pfad, art.id);
    svg.appendChild(pfad);
    zelle.appendChild(svg);

    zelle.addEventListener('mousedown', e => e.preventDefault());
    zelle.addEventListener('click', () => {
      setzeAusrichtung(art.id);
      closeAlignPop();
    });
    reihe.appendChild(zelle);
  }
}

function positionAlignPop() {
  const pop = E('align-pop');
  const anker = E('fmt-align-wrap');
  if (!pop || !anker) return;
  const r = anker.getBoundingClientRect();
  pop.style.left = Math.round(r.left + r.width / 2) + 'px';
  pop.style.top = Math.round(r.bottom + 8) + 'px';
  pop.style.transform = 'translateX(-50%)';

  // An keinem Rand aus dem Fenster laufen – wie beim Listen-Fenster
  const box = pop.getBoundingClientRect();
  const zuVielRechts = box.right - (window.innerWidth - 8);
  if (zuVielRechts > 0) pop.style.left = Math.round(box.left - zuVielRechts + box.width / 2) + 'px';
  if (pop.getBoundingClientRect().left < 8) {
    pop.style.left = Math.round(8 + pop.getBoundingClientRect().width / 2) + 'px';
  }
}

function openAlignPop() {
  _alignPopOffen = true;
  buildAlignRow();
  E('align-pop').style.display = 'block';
  positionAlignPop();
}

function closeAlignPop() {
  const pop = E('align-pop');
  if (pop) pop.style.display = 'none';
  _alignPopOffen = false;
}

['fmt-align', 'fmt-align-more', 'align-pop'].forEach(id => listNoBlur(E(id)));

/* Die breite Hälfte: die gezeigte Ausrichtung anlegen – oder wieder ab,
   wenn sie schon gilt. Genau wie beim Listen-Knopf. */
E('fmt-align').addEventListener('click', () => {
  const aktiv = aktiveAusrichtung();
  setzeAusrichtung(aktiv !== 'left' ? 'left' : _letzteAusrichtung);
});

E('fmt-align-more').addEventListener('click', e => {
  e.stopPropagation();
  if (_alignPopOffen) return closeAlignPop();
  openAlignPop();
});

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#align-pop') && !e.target.closest('.tb-split')) closeAlignPop();
});
window.addEventListener('resize', () => {
  if (_alignPopOffen) positionAlignPop();
}, { passive: true });

/* Die zuletzt gewählte Form überdauert das Schließen der App. Beim Laden
   der Leiste ist die Einstellungsdatei aber noch nicht gelesen – deshalb
   einmal jetzt und noch einmal, sobald sie da ist. */
if (typeof Lists !== 'undefined') {
  Lists.loadSettings();
  if (typeof Settings !== 'undefined' && Settings.onChange) Settings.onChange(() => Lists.loadSettings());
}
E('fmt-p').addEventListener('mousedown', e => {
  e.preventDefault();
  
  // Undo/Redo-Logik entfernt
  
  document.execCommand('formatBlock', false, 'p');
  setTimeout(() => {
    const block = curBlockTag();
    clearTitleClasses(block);
    updateHdrBtns();
    renderSideTree();
    // Sync page content after change
    if (info) {
      const pgEl = E('pages-wrap')?.querySelector('[data-pgid="' + info.page.id + '"]');
      const textDiv = pgEl?.querySelector('.j-text');
      if (textDiv) info.page.textContent = textDiv.innerHTML;
    }
  }, 50);
});
E('fmt-h1').addEventListener('mousedown', e => { e.preventDefault(); toggleHeading('h1'); });
E('fmt-h2').addEventListener('mousedown', e => { e.preventDefault(); toggleHeading('h2'); });
E('fmt-h3').addEventListener('mousedown', e => { e.preventDefault(); toggleHeading('h3'); });

/* ── Die Absatzformat-Auswahl ──────────────────────────────────────────
   Dieselbe Machart wie die Listen-Auswahl darüber: der Knopf öffnet, ein
   Klick daneben schließt. Die vier Einträge behalten ihre Kennungen und
   damit ihre Handgriffe – hier kommt nur das Auf und Zu dazu. */
(function () {
  const btn = E('fmt-style');
  const pop = E('style-pop');
  if (!btn || !pop) return;

  const offen = () => pop.style.display === 'block';

  function schliessen() {
    pop.style.display = 'none';
    btn.classList.remove('active');
    document.removeEventListener('pointerdown', draussen, true);
  }

  function draussen(e) {
    if (e.target.closest('#style-pop, #fmt-style')) return;
    schliessen();
  }

  // mousedown, nicht click: sonst ist die Schreibmarke schon aus dem Text
  btn.addEventListener('mousedown', e => {
    e.preventDefault();
    if (offen()) { schliessen(); return; }
    const r = btn.getBoundingClientRect();
    pop.style.display = 'block';
    const breite = pop.offsetWidth || 180;
    pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - breite - 8, r.left))) + 'px';
    pop.style.top = Math.round(r.bottom + 6) + 'px';
    btn.classList.add('active');
    setTimeout(() => document.addEventListener('pointerdown', draussen, true), 0);
  });

  // Nach der Wahl zugeht es von selbst
  pop.querySelectorAll('.style-pop-item').forEach(el => {
    el.addEventListener('mousedown', () => setTimeout(schliessen, 0));
  });
})();
E('fmt-bold').addEventListener('mousedown', e => { e.preventDefault(); document.execCommand('bold'); setTimeout(updateHdrBtns, 0); });
E('fmt-italic').addEventListener('mousedown', e => { e.preventDefault(); document.execCommand('italic'); setTimeout(updateHdrBtns, 0); });
E('fmt-under').addEventListener('mousedown', e => { e.preventDefault(); document.execCommand('underline'); setTimeout(updateHdrBtns, 0); });
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  const node = sel && sel.rangeCount ? sel.anchorNode : null;
  const el = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
  if (document.activeElement?.classList?.contains('j-text') || el?.closest('.j-text')) {
    updateHdrBtns();
    renderSideTree();
    /* ════════════════════════════════════════════════════════════════
       STICKY TEXTFARBE
       Wer eine Farbe gewählt hat, will in dieser Farbe weiterschreiben –
       egal wohin er danach klickt. Der updateHdrBtns()-Aufruf oben
       hätte S.textColor mit der Farbe unter der Marke überschrieben;
       das wird hier rückgängig gemacht. Die Sticky-Farbe gilt, bis der
       Nutzer eine andere wählt.
       ════════════════════════════════════════════════════════════════ */
    if (S._textColorChosen) {
      S.textColor = S._textColorChosen;
      E('txt-color-dot').style.background = S._textColorChosen;
      QA('.pen-sw[data-tcolor]').forEach(s => s.classList.remove('active'));
      E('txt-custom-ring').classList.add('active');
    }
  }
});

/* Sticky-Farbe beim Tippen: vor jedem druckbaren Zeichen die gewählte
   Farbe erneut zusichern. contenteditable erbt sonst die Farbe der
   Umgebung – die explizite Wahl ginge verloren. */
document.addEventListener('keydown', e => {
  if (!S._textColorChosen) return;
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
  const a = document.activeElement;
  if (!a || !a.classList || !a.classList.contains('j-text')) return;
  // Nur wenn die Marke in einer ANDEREN Farbe steht, nachfassen –
  // sonst schreibt es schon in der richtigen
  const aktFarbe = farbeUnterMarke();
  if (aktFarbe && aktFarbe !== S._textColorChosen) {
    document.execCommand('foreColor', false, S._textColorChosen);
  }
}, true);






/* ── APPLY MODE ── */
function applyMode() {
  const ic = S.mode === 'cursor';
  QA('.j-canvas').forEach(c => c.style.pointerEvents = ic ? 'none' : 'auto');
  QA('.j-text').forEach(t => {
    t.style.pointerEvents = 'auto';
    t.contentEditable = ic ? 'true' : 'false';
  });
  QA('.j-objects').forEach(o => o.style.pointerEvents = 'none');
  // Nur das Bild schaltet um; die Bedienteile regeln sich über .obj-chrome
  QA('.obj-body').forEach(o => o.style.pointerEvents = ic ? 'auto' : 'none');
  // Ob der Finger zeichnen darf, hängt am Werkzeug – siehe updateTouchDrawUI
  updateTouchDrawUI();
  updateCursor();
  // Andere Gruppen sichtbar, andere Breite – der Auffangknopf rechnet neu
  if (typeof window.updateToolbarOverflow === 'function') window.updateToolbarOverflow();
}

function updateCursor() {
  const ec = E('eraser-cursor');
  if (S.mode === 'eraser') {
    const r = ERASER_SIZES[S.eraser.szIdx];
    const z = getZoom();
    const size = Math.min(128, Math.max(8, Math.round(r * 2 * z)));
    if (ec) {
      ec.style.width = size + 'px';
      ec.style.height = size + 'px';
    }
    QA('.j-canvas').forEach(c => c.style.cursor = 'crosshair');
  } else {
    if (ec) ec.style.display = 'none';
    const cur = S.mode === 'cursor' ? 'text' : 'crosshair';
    QA('.j-canvas').forEach(c => c.style.cursor = cur);
  }
}

window.addEventListener('pointermove', e => {
  const ec = E('eraser-cursor');
  if (ec && S.mode === 'eraser') {
    if (e.pointerType === 'pen' && e.target.closest('.j-page')) {
      ec.style.display = 'block';
      ec.style.left = e.clientX + 'px';
      ec.style.top = e.clientY + 'px';
    } else {
      ec.style.display = 'none';
    }
  }
});

/** Malt dieses Werkzeug, statt Text zu setzen? */
function isDrawMode(mode) {
  /* 'shape' stand hier, solange Formen aufgezogen wurden. Sie werden
     jetzt eingesetzt wie eine Tabelle (canvas/shapes.js) – einen
     Formen-Modus gibt es nicht mehr. */
  return mode === 'pen1' || mode === 'pen2' || mode === 'hl' || mode === 'eraser';
}

function switchMode(mode) {
  S.mode = mode;
  /* Wozu der Stift greift, wenn er aus der Zeigerstellung heraus die
     Seite berührt (canvas/input.js, letztesZeichenwerkzeug). Der
     Radierer gehört nicht dazu – siehe dort. */
  if (mode === 'pen1' || mode === 'pen2' || mode === 'hl') S._letzterStift = mode;
  // Ein ausgewaehlter Strich gehoert zum Zeiger; mit dem Stift in der Hand
  // waere seine Huelle nur im Weg (canvas/strokeSelect.js)
  if (mode !== 'cursor' && typeof window.deselectStroke === 'function') window.deselectStroke();
  /* Nur die Werkzeug-Knoepfe. Ohne den Zusatz [data-mode] loeschte jeder
     Werkzeugwechsel auch die Markierung am Finger-Schalter – der hat
     keinen Modus, sein dataset.mode ist undefined und passt nie. */
  QA('.tb-mode[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const isPen = mode === 'pen1' || mode === 'pen2' || mode === 'hl';
  E('pen-opts').style.display = isPen ? 'flex' : 'none';
  E('eraser-opts').style.display = mode === 'eraser' ? 'flex' : 'none';
  E('text-opts').style.display = mode === 'cursor' ? 'flex' : 'none';
  /* Das Formen-Fenster hing hier am Werkzeugwechsel, solange die Formen
     ein Werkzeug waren. Es hängt jetzt an seinem eigenen Knopf beim
     Einfügen. Zumachen gehört trotzdem hierher: es liegt über der
     Seite, und wer zum Stift greift, will darauf zeichnen. */
  if (typeof setzeFormenFenster === 'function') setzeFormenFenster(false);
  updatePenUI();
  applyMode();
  updateUndoRedoUI();
}

/* ══════════════════════════════════════════════════════════════════════
   RÜCKGÄNGIG UND VOR

   Die beiden Knöpfe waren einmal weg, weil Strg+Z jeder kennt. Auf einem
   Tablet liegt aber keine Tastatur dabei: ein verrutschter Strich liess
   sich dort überhaupt nicht mehr zurücknehmen. Sie stehen wieder in der
   Leiste (index.html) und rufen dasselbe wie die Kürzel.

   >>> Warum pointerdown abgewehrt wird <<<
   Ein Druck auf einen Knopf nimmt dem Textfeld den Fokus und damit die
   Schreibmarke. Nach einem Rückgängig will man aber genau dort
   weiterschreiben, wo man war.
   ══════════════════════════════════════════════════════════════════════ */
[['btn-undo', () => undoPage()], ['btn-redo', () => redoPage()]].forEach(([id, tun]) => {
  const b = E(id);
  if (!b) return;
  b.addEventListener('pointerdown', e => e.preventDefault());
  b.addEventListener('click', e => { e.preventDefault(); tun(); });
});

/* TOOLBAR mode/pen/color/heading controls moved to ui/toolbar.js */

/* ══════════════════════════════════════════════════════════════════════
   DAS FORMEN-FENSTER

   Der Formen-Knopf steht beim Einfügen, neben der Tabelle, und öffnet
   dieses Fenster – genau wie der Tabellen-Knopf sein Raster öffnet. Ein
   Druck auf eine Form setzt sie auf die Seite (canvas/shapes.js), und
   man bleibt dabei, wo man war: im Text oder beim Stift.

   >>> Was hier vorher stand <<<
   Zuerst lagen die Einstellungen offen in der Leiste und kosteten dort
   dauerhaft eine Gruppe, obwohl sie nur beim Formen-Werkzeug etwas
   zeigten. Dann hingen sie an eben diesem Werkzeug. Das Werkzeug selbst
   war der eigentliche Fehler: eine Form ist nichts, was man malt,
   sondern etwas, das man einsetzt.

   >>> Wo es aufgeht <<<
   Am Formen-Knopf. Im Hochformat gibt es den nicht (dort sammelt „+"
   die Einfüge-Werkzeuge, css/responsive.css) – dann am „+", und wenn
   auch das nicht sichtbar ist, an der Leiste selbst. So steht es nie
   irgendwo im Nichts.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const pop = E('shape-pop');
  const knopf = E('btn-shape');
  if (!pop) return;

  /** Der Knopf, unter dem das Fenster hängt – je nach Ausrichtung. */
  function anker() {
    const kandidaten = [knopf, E('btn-insert-all'), E('toolbar')];
    return kandidaten.find(el => el && el.offsetParent !== null) || null;
  }

  function stelle() {
    const a = anker();
    if (!a) return;
    const r = a.getBoundingClientRect();
    const b = pop.offsetWidth || 260;
    pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - b - 8, r.left))) + 'px';
    pop.style.top = Math.round(r.bottom + 6) + 'px';
  }

  function draussen(e) {
    if (e.target.closest('#shape-pop, #btn-shape, #btn-insert-all')) return;
    setzeFormenFenster(false);
  }

  /* Global, weil switchMode() es bei jedem Werkzeugwechsel zumacht.

     Der Hörer aufs Draußen-Klicken wird erst im nächsten Durchlauf
     gesetzt: derselbe Druck, der das Fenster öffnet, würde es sonst
     sofort wieder schließen. */
  window.setzeFormenFenster = function (an) {
    document.removeEventListener('pointerdown', draussen, true);
    pop.style.display = an ? 'flex' : 'none';
    if (knopf) knopf.classList.toggle('active', !!an);
    if (!an) return;
    stelle();
    setTimeout(() => {
      if (window.formenFensterOffen()) {
        document.addEventListener('pointerdown', draussen, true);
      }
    }, 0);
  };

  window.formenFensterOffen = () => pop.style.display === 'flex';

  /* Auf- und zumachen am eigenen Knopf. In pointerdown und nicht in
     click, damit das Fenster ohne Verzögerung dasteht – dieselbe Stelle,
     an der auch der Tabellen-Knopf sein Raster öffnet (ui/insert.js). */
  knopf?.addEventListener('pointerdown', () => {
    setzeFormenFenster(!window.formenFensterOffen());
  });

  window.addEventListener('resize', () => { if (window.formenFensterOffen()) stelle(); },
    { passive: true });
})();

/* ── Formen-Optionen ────────────────────────────────────────────────────
   Die vier Knöpfe SETZEN eine Form ein – sie wählen kein Werkzeug mehr
   aus. Deshalb bleibt auch keiner davon markiert: es gibt nichts, was
   danach noch gälte, so wie im Tabellen-Raster auch keine Größe
   markiert bleibt.

   Die Linienstärke daneben ist dagegen eine Einstellung: sie gilt für
   die nächste Form. Farbe und Füllung stellt man an der ausgewählten
   Form ein (canvas/shapes.js, addShapeChrome). */

S.shapeFill = 'none';
S.shapeStroke = '#1a1510';
S.shapeStrokeWidth = 2;

QA('#shape-opts [data-shape]').forEach(btn => {
  btn.addEventListener('click', () => {
    /* Erst zumachen, dann einsetzen: das Fenster liegt über der Seite,
       und die neue Form soll sofort zu sehen sein. */
    if (typeof setzeFormenFenster === 'function') setzeFormenFenster(false);
    if (typeof insertShape === 'function') insertShape(btn.dataset.shape);
  });
});

/* Die Füllung wird an der AUSGEWÄHLTEN Form eingestellt, nicht am
   Werkzeug (canvas/shapes.js, addShapeChrome). Die beiden Knöpfe, die
   hier standen, schalteten S.shapeFill zwischen 'none' und 'none' um und
   taten damit sichtbar gar nichts. Neue Formen entstehen ohne Füllung –
   das ist der Fall, den man beim Zeichnen fast immer will. */

// Linienstärke
QA('#shape-sw-row [data-shape-sw]').forEach(btn => {
  btn.addEventListener('click', () => {
    S.shapeStrokeWidth = +btn.dataset.shapeSw;
    QA('#shape-sw-row [data-shape-sw]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

