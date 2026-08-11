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

        /* >>> Die eigene Sichtbarkeit merken <<<
           #pen-opts, #eraser-opts und #shape-opts stehen auf display:none,
           bis ihr Werkzeug gewählt wird (applyMode). Würde das Blättern sie
           einfach auf '' setzen, stünden alle drei gleichzeitig da – über
           850 px, die es gar nicht gibt, und die Leiste quillt über. Genau
           das passierte nach jeder Größenänderung.

           Deshalb wird der eigene Wert gemerkt und beim Einblenden wieder
           hergestellt, statt ihn zu überschreiben. */
        const eigen = teile.map(el => el.style.display);

        /* data-tb-more sagt, was entbehrlich ist: 1 weicht zuerst
           (Speicher-Hinweis), dann 2 (Teilen, Exportieren), dann 3 (Zoom).
           Ohne Nummer ist die Gruppe unentbehrlich – die Werkzeuge, die
           Textformate und das Einfügen bleiben immer auf der ersten Seite,
           denn für das Einfügen gibt es keinen zweiten Weg. */
        alle.push({
          teile, eigen,
          rang: +(kind.dataset.tbMore || 0),
          // Von sich aus verborgen? Dann kostet es keine Breite und ist
          // für das Blättern kein Bewerber.
          eigenVerborgen: eigen.every(v => v === 'none')
        });
      }
      if (offenerTrenner) {
        alle.push({
          teile: [offenerTrenner],
          eigen: [offenerTrenner.style.display],
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

  /* Einblenden heisst: auf den EIGENEN Wert zurück, nicht auf ''. Sonst
     macht das Blättern verborgene Gruppen sichtbar (siehe sammleStuecke). */
  function setzeSichtbar(stueck, an) {
    stueck.teile.forEach((el, i) => {
      el.style.display = an ? (stueck.eigen[i] || '') : 'none';
    });
  }

  function versteckePfeile() {
    btnNext.style.display = 'none';
    btnPrev.style.display = 'none';
  }

  /** Alle Stücke sichtbar machen – Ausgangszustand vor der Messung. */
  function alleZeigen() {
    for (const s of alleStuecke) setzeSichtbar(s, true);
  }

  /**
   * Misst, was weichen muss, und teilt in zwei Seiten.
   *
   * Weil die Pfeile selbst Platz brauchen, wird mit sichtbarem ▶ gemessen.
   */
  function anpassen() {
    geplant = false;
    alleStuecke = sammleStuecke();

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
function farbeUnterMarke() {
  const a = document.activeElement;
  if (!a || !a.classList || !a.classList.contains('j-text')) return null;
  let wert = '';
  try { wert = document.queryCommandValue('foreColor') || ''; } catch (e) { return null; }

  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(wert);
  if (m) {
    const hex = n => ('0' + (+n).toString(16)).slice(-2);
    return '#' + hex(m[1]) + hex(m[2]) + hex(m[3]);
  }
  return normalizeHexColor(wert);
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
  return mode === 'pen1' || mode === 'pen2' || mode === 'hl' || mode === 'eraser' || mode === 'shape';
}

function switchMode(mode) {
  S.mode = mode;
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
  /* Die Formen-Einstellungen sitzen in einem eigenen Fenster (#shape-pop)
     und nicht mehr in der Leiste. Es geht mit dem Werkzeug auf und mit
     jedem anderen wieder zu. */
  if (typeof setzeFormenFenster === 'function') setzeFormenFenster(mode === 'shape');
  updatePenUI();
  applyMode();
  updateUndoRedoUI();
}

/* Die Knöpfe für Rückgängig/Wiederholen gibt es nicht mehr (siehe
   index.html). Beide laufen über die änderbaren Kürzel
   (core/shortcuts.js) und rufen von dort undoPage()/redoPage() auf.
   Hier standen bis zuletzt zwei addEventListener auf Elemente, die es
   seit dem Entfernen der Knöpfe nicht mehr gibt. */

/* TOOLBAR mode/pen/color/heading controls moved to ui/toolbar.js */

/* ══════════════════════════════════════════════════════════════════════
   DAS FORMEN-FENSTER

   Die Einstellungen der Formen – welche Form, wie dick, das Lineal –
   standen offen in der Leiste und nahmen dort eine ganze Gruppe ein.
   Sie zeigten aber nur etwas, solange das Formen-Werkzeug gewählt war;
   die übrige Zeit war das eine leere Zone, die trotzdem Platz kostete.

   Jetzt hängen sie an einem Fenster am Formen-Knopf, genau wie das
   Raster am Tabellen-Knopf. Der Inhalt ist unverändert (#shape-opts in
   index.html) – nur sein Ort ist ein anderer, damit greifen alle
   bestehenden Handgriffe weiter, auch der Lineal-Knopf aus ui/ruler.js.

   >>> Wo es aufgeht <<<
   Am Formen-Knopf. Im Hochformat gibt es den nicht (dort sammelt „+"
   die Einfüge-Werkzeuge, css/responsive.css) – dann am „+", und wenn
   auch das nicht sichtbar ist, an der Leiste selbst. So steht es nie
   irgendwo im Nichts.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const pop = E('shape-pop');
  if (!pop) return;

  /** Der Knopf, unter dem das Fenster hängt – je nach Ausrichtung. */
  function anker() {
    const kandidaten = [
      document.querySelector('.tb-mode[data-mode="shape"]'),
      E('btn-insert-all'),
      E('toolbar')
    ];
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
    if (e.target.closest('#shape-pop, .tb-mode[data-mode="shape"], #btn-insert-all')) return;
    setzeFormenFenster(false);
  }

  /* Global, weil switchMode() es bei jedem Werkzeugwechsel ruft.

     Der Hörer aufs Draußen-Klicken wird erst im nächsten Durchlauf
     gesetzt: derselbe Druck, der das Fenster öffnet, würde es sonst
     sofort wieder schließen. Die Abfrage davor prüft, ob das Fenster
     dann überhaupt noch offen ist – ein zweiter Druck auf den
     Formen-Knopf schließt es in derselben Runde wieder, und ohne die
     Abfrage bliebe ein Hörer ohne Fenster stehen. */
  window.setzeFormenFenster = function (an) {
    document.removeEventListener('pointerdown', draussen, true);
    pop.style.display = an ? 'flex' : 'none';
    if (!an) return;
    stelle();
    setTimeout(() => {
      if (window.formenFensterOffen()) {
        document.addEventListener('pointerdown', draussen, true);
      }
    }, 0);
  };

  window.formenFensterOffen = () => pop.style.display === 'flex';

  /* ── Noch einmal derselbe Knopf schließt wieder ──────────────────
     Sonst ginge das Fenster nur zu, indem man ein anderes Werkzeug
     nimmt – und stünde bis dahin über der Seite.

     >>> Warum es dafür ZWEI Hörer braucht <<<
     Ganz oben in dieser Datei hängt schon ein click-Hörer, der
     switchMode() ruft, und der öffnet das Fenster bei jedem Klick neu.
     In der Auffangphase (capture) läuft er noch nicht – dort ist also
     abzulesen, wie der Zustand VOR dem Klick war. Gehandelt wird
     danach, in der Blasenphase, wenn switchMode() durch ist.
     Ein einzelner Hörer könnte nur eines von beidem. */
  const formenKnopf = document.querySelector('.tb-mode[data-mode="shape"]');
  if (formenKnopf) {
    let warSchonOffen = false;
    formenKnopf.addEventListener('pointerdown', () => {
      warSchonOffen = S.mode === 'shape' && window.formenFensterOffen();
    }, true);
    formenKnopf.addEventListener('click', () => {
      if (warSchonOffen) setzeFormenFenster(false);
    });
  }

  window.addEventListener('resize', () => { if (window.formenFensterOffen()) stelle(); },
    { passive: true });
})();

/* ── Formen-Optionen ────────────────────────────────────────────────────
   Welche Form gezeichnet wird, entscheiden diese Knöpfe. Farbe und
   Linienstärke teilen sich die Formen mit dem Stift – eigene Farbfelder
   wären nur eine Wiederholung des Vorhandenen. */

// Form-Typ: Rechteck, Ellipse, Linie, Pfeil
S.shapeType = 'rect';
S.shapeFill = 'none';
S.shapeStroke = '#1a1510';
S.shapeStrokeWidth = 2;

QA('#shape-opts [data-shape]').forEach(btn => {
  btn.addEventListener('click', () => {
    S.shapeType = btn.dataset.shape;
    QA('#shape-opts [data-shape]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
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

