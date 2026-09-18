'use strict';

/* ══════════════════════════════════════════════════════════════════════
   GRIFFBEREIT — UNTERLAGEN NEBEN DEM HEFT

   Ein Skript als PDF, ein abfotografiertes Tafelbild: Sachen, die beim
   Schreiben danebenliegen sollen, ohne dass sie Teil des Hefts werden.

   >>> Sie werden NICHT kopiert <<<
   Gemerkt wird allein der Ort (main.js, Abschnitt „Griffbereit"). Damit
   gibt es keinen zweiten Stand, der still veraltet, und ein Heft wird
   nicht um ein 40-MB-Skript schwerer, das ohnehin schon auf der Platte
   liegt. Der Preis steht in der Anzeige: ist die Datei verschoben oder
   weg, sagt die Leiste das, statt etwas Altes zu zeigen.

   ── Die drei Stücke ────────────────────────────────────────────────
     Die LEISTE (griff-panel) geht über den Knopf in der Werkzeugzeile
     auf. Darin wird hinzugefügt, umbenannt, umsortiert, weggenommen.

     Die REITER (griff-reiter) stehen an der Kante, sobald die Leiste zu
     ist – hochkant, mit dem vergebenen Namen. Zusammen sind sie ein
     stehendes Rechteck auf gut drei Vierteln der Höhe, das fest am
     Fenster hängt und über dem Blatt liegt.

     Sie waren einmal ein Flex-Kind über die ganze Höhe. Ein fester
     Streifen von oben bis unten läge auf dem Blatt, sobald jemand
     hineinzoomt – auf drei Vierteln ist er eine Marke wie der
     Kommentar-Griff und lässt oben und unten frei.

     Die ANSICHT (griff-view) fährt aus einem Reiter heraus – nach links
     wischen oder antippen. Sie schiebt das Blatt zur Seite wie Chat und
     Kommentare und deckt es nie zu; breiter als das halbe Fenster wird
     sie nicht, sonst bliebe vom Heft zu wenig übrig.

     Solange sie offen steht, gehen Kommentare und Chat nicht auf
     (window.griffBlocksPanels): sie sitzen an derselben Kante, und drei
     Leisten nebeneinander liessen vom Blatt nichts übrig.

   ── Was sich je Datei merkt ────────────────────────────────────────
   Breite der Spalte, Vergrößerung und die Stelle darin – nach unten wie
   zur Seite. Wer ein Skript auf Seite 40 zuklappt, will beim nächsten
   Aufschlagen wieder dort stehen, und zwar so groß wie vorher.

   Beide Stellen werden als ANTEIL gespeichert (0 … 1) und nicht in
   Pixeln: bei einem PDF hängt die Gesamthöhe an Breite und Zoom, und
   eine gemerkte Pixelzahl zeigte nach dem Ziehen der Kante irgendwohin.

   ── Warum die Seiten erst beim Hinsehen entstehen ──────────────────
   Ein Skript hat schnell 300 Seiten. Alle vorab zu zeichnen dauert
   Minuten und legt den Speicher lahm. Stattdessen steht für jede Seite
   ein leerer Kasten in der richtigen Höhe, und gezeichnet wird, was in
   die Nähe des Ausschnitts kommt (IntersectionObserver).
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const api = () => (window.api && window.api.griffbereit) || null;

  /* ══════════════════════════════════════════════════════════════════
     UNTERLAGEN GEHÖREN ZU EINEM HEFT

     Die Liste galt einmal für die ganze App: wer in einem Heft ein
     Skript danebenlegte, hatte es in JEDEM Heft am Rand stehen. Jetzt
     hat jedes Heft sein eigenes Fach (main.js, griffHeft), und das
     Fenster nennt bei jeder Auskunft, um welches es geht – nur hier ist
     bekannt, welches offen ist.

     Auf der Übersicht ist keines offen. Dann ist die Kennung leer, die
     Liste bleibt leer, und an der Kante steht nichts – was richtig ist:
     eine Unterlage liegt neben einem Heft, nicht neben der Übersicht.
     ══════════════════════════════════════════════════════════════════ */
  const heftId = () => (typeof S !== 'undefined' && S.activeNbId) ? String(S.activeNbId) : '';

  /* ══ WER ZULETZT SPRICHT, HAT RECHT ═══════════════════════════════
     Jede Auskunft, die den Stand ersetzt, zählt einen Schritt weiter.
     Wer vor dem Warten seine Nummer nimmt und sie danach nicht mehr
     wiederfindet, hat eine überholte Antwort in der Hand und lässt sie
     fallen.

     Ohne das machte ein spät eintreffendes liste() ein gerade erfolgtes
     Ausblenden wieder rückgängig: das Heft wird aufgeschlagen, die Liste
     ist noch unterwegs, jemand blendet aus – und dann kommt die alte
     Liste an und stellt die Reiter zurück. Genau das war im Rundgang
     einmal in zwanzig Läufen zu sehen. */
  let _standLauf = 0;

  function standAnnehmen(neu) {
    _standLauf++;
    _stand = neu;
    return _stand;
  }

  /**
   * Eine Auskunft holen, ohne dass ein Fehler still verschluckt wird.
   *
   * >>> Warum das nötig war <<<
   * Im Hauptprozess stand im Rumpf von griff-uebernehmen einmal ein
   * Bezeichner, den es dort nicht gab. Der Kanal warf, das Versprechen
   * wurde abgelehnt – und weil hier niemand hinsah, brach das Hinzufügen
   * mittendrin ab: kein Neuzeichnen, keine Zeile, keine Meldung. Aus der
   * Sicht des Nutzers geschah beim Hinzufügen einfach nichts.
   *
   * Ein Kanal, der wirft, ist ein Fehler in der App und keiner des
   * Nutzers. Zu sehen sein muss er trotzdem – sonst sucht der Nutzer ihn
   * bei sich.
   */
  async function ueberBruecke(was, tun) {
    try {
      return await tun();
    } catch (err) {
      console.error('[Griffbereit] ' + was + ' fehlgeschlagen:', (err && err.message) || err);
      toast(txt('griffKanalKaputt', 'Das hat nicht geklappt.'), true);
      return null;
    }
  }

  /* Schmaler als das hier wird die Ansicht nicht – darunter passt keine
     PDF-Seite mehr, auf der man etwas lesen könnte. */
  const MIN_BREITE = 220;
  const VORGABE_BREITE = 420;

  /* Wie viele Seiten vorab vermessen werden. Hier standen 120, und jede
     davon ist seit dem stückweisen Laden eine eigene Anfrage: bei einem
     Buch war das rund eine Sekunde Warten vor dem ersten Blick, für
     Kästen, die sich beim Zeichnen ohnehin selbst nachmessen.

     Acht genügen, weil daraus nicht die ERSTE, sondern die HÄUFIGSTE
     Form gewählt wird (siehe ueblicheForm). Ein andersförmiges Deckblatt
     verzieht damit nicht mehr die Höhe aller übrigen Kästen – genau das
     tat es vorher, und zwar umso schlimmer, je weniger gemessen wurde. */
  const HOECHSTENS_GEMESSEN = 8;

  /* So breit wird eine Leinwand höchstens, in Bildpunkten. Bei
     vierfachem Zoom in einer breiten Spalte kämen sonst gut 5000 × 7000
     Punkte je Seite zusammen – 140 MB für ein Blatt, und es stehen
     mehrere gleichzeitig da. Darüber hinaus zieht der Browser das
     Vorhandene auf; das fällt nicht auf, weil die Grenze weit über der
     Auflösung des Schirms liegt. */
  const MAX_LEINWAND = 2600;

  /* ════════════════════════════════════════════════════════════════
     FEINER GEZEICHNET, ALS DER SCHIRM AUFLÖST

     >>> Gemeldet: „ohne ganz hineinzuzoomen ist die Qualität sehr
     schlecht – man sollte auch dann klar sehen können“ <<<
     Gezeichnet wurde in genau der Breite, in der die Seite dasteht, mal
     der Bildpunktdichte des Schirms. Auf einem gewöhnlichen Windows-
     Bildschirm ist die 1 – eine A4-Seite in einer 400 Punkte breiten
     Spalte bekam also 400 Bildpunkte. Das sind bei 21 cm Papierbreite
     gut 48 dpi. Ein Drucker macht 300, ein Buch 600; Fußnoten und feine
     Serifen fallen bei 48 schlicht unter den Tisch, und dagegen hilft
     keine Kantenglättung.

     Deshalb wird überabgetastet: die Leinwand ist ein Vielfaches der
     Anzeigebreite, der Browser rechnet sie beim Zeichnen sauber
     herunter. Das ist dieselbe Rechnung, die der Zuschnitt schon macht
     (SCHNITT_FEINHEIT weiter unten), nur muss sie hier auch für die
     Ansicht gelten und nicht erst beim Herausschneiden.

     Zwei Komma fünf ist der Punkt, an dem es aufhört, etwas zu bringen:
     Text wird ab da nicht mehr sichtbar besser, die Seite aber weiter
     teurer. Nach oben deckelt MAX_LEINWAND ohnehin.
     ════════════════════════════════════════════════════════════════ */
  const FEINHEIT = 2.5;

  /** Der Spiegel dessen, was der Hauptprozess hält. */
  let _stand = { versteckt: false, dateien: [] };

  let _offen = null;      // Kennung der aufgeschlagenen Datei
  /* Zu welchem Heft sie gehört. Beim Heftwechsel zeigt heftId() schon
     auf das neue (app.js setzt S.activeNbId vor dem Neuladen), und die
     Rollstelle der eben noch offenen Unterlage wäre ins Leere
     geschrieben worden. */
  let _offenHeft = '';
  let _rollTimer = null;
  let _breiteTimer = null;
  /* Jedes Aufschlagen bekommt eine Nummer. Eine Datei, die während des
     Ladens wieder zugemacht wurde, darf ihren Inhalt nicht mehr
     einhängen – sonst steht im Fenster das PDF von vorhin. */
  let _lauf = 0;
  /* ══════════════════════════════════════════════════════════════════
     ZUMACHEN HEISST NICHT WEGRÄUMEN

     >>> Warum die Datei stehen bleibt <<<
     Zugemacht hiess einmal: pdf.js beenden, den Kasten leeren, alles
     wegwerfen. Beim nächsten Aufschlagen fing das Buch von vorn an –
     Katalog holen, Seiten vermessen, Sichtbares neu zeichnen. Bei einem
     abfotografierten Buch sind das jedes Mal Sekunden für dasselbe Bild,
     und zugemacht wird oft: die Kommentare gehen daneben nicht auf.

     Jetzt bleibt der Inhalt einfach STEHEN. Zumachen nimmt nur die
     Klasse 'open' weg – der Kasten ist dann 0 px breit und schneidet ab
     (css/griffbereit.css), der Inhalt darin rührt sich nicht. Aufmachen
     setzt die Klasse wieder: kein Laden, kein Vermessen, kein Zeichnen,
     und die Rollstelle stimmt von selbst, weil nie etwas ausgehängt
     wurde.

     >>> Warum nicht ausgehängt und aufgehoben <<<
     Genau das stand hier zuerst: die Knoten wanderten beim Zumachen in
     ein Lager und beim Aufmachen zurück. Das ist dieselbe Ersparnis mit
     mehr Teilen – ausgehängte Knoten, ein Beobachter, der ins Leere
     zeigt, eine von Hand gemerkte Rollstelle. Jedes dieser Teile kann
     für sich verlorengehen, und dann lädt die Datei doch wieder neu.
     Stehenlassen hat keines davon.

     >>> Genau EINE Datei <<<
     Ein Buch hängt an Arbeitern, Puffern und Leinwänden. Wer eine andere
     Unterlage aufschlägt, räumt die bisherige damit weg – zwei
     nebeneinander wären schon spürbar, drei stünden dauerhaft im
     Speicher, obwohl höchstens eine angesehen wird.
     ══════════════════════════════════════════════════════════════════ */

  /* Erst wenn der Inhalt vollständig steht, darf er stehen bleiben –
     eine halb geladene Datei wieder aufzuschlagen zeigte halbe Arbeit.
     Gilt für den gerade GEZEIGTEN Satz; jeder Satz führt daneben sein
     eigenes _fertig, weil mehrere zugleich bereitstehen. */
  let _fertig = false;

  /* ══════════════════════════════════════════════════════════════════
     JEDE UNTERLAGE HAT IHREN EIGENEN SATZ

     Im Kasten liegt nicht mehr EINE Datei, sondern für jede
     aufgeschlagene ein eigener Stapel Seiten (.griff-satz). Zu sehen ist
     immer genau einer, die übrigen stehen ausgeblendet daneben.

     >>> Warum <<<
     Vorher blieb nur die zuletzt angesehene Datei liegen. Wer zwischen
     Skript und Tafelbild hin und her wechselte, lud damit jedes Mal neu –
     genau das, was das Stehenlassen verhindern sollte. Gemeldet wurde es
     als „eines auf, das andere auf, wieder das erste: lädt wieder".

     >>> Was an einem Satz hängt <<<
     Sein PDF (pdf.js), sein Beobachter, seine gezeichneten Seiten und
     seine Rollstelle. Das MUSS am Satz hängen und nicht in einer
     Variablen für alle: ein Beobachter meldet sich auch für einen Satz,
     der gerade nicht zu sehen ist, und zeichnete dann eine Seite aus dem
     falschen Dokument.

     >>> Wie viele <<<
     Höchstens so viele, wie es Unterlagen geben darf (drei). Mehr kann
     es gar nicht geben – wer eine wegnimmt, nimmt auch ihren Satz mit
     (zeichne). Ein Buch hängt an Arbeitern, Puffern und Leinwänden;
     drei davon sind der Preis dafür, dass Umschalten nichts kostet.
     ══════════════════════════════════════════════════════════════════ */
  const kasten = () => E('griff-view-body');

  function satzVon(id) {
    const k = kasten();
    return (k && k.querySelector('.griff-satz[data-id="' + CSS.escape(String(id)) + '"]')) || null;
  }

  /** Ein leerer Satz für eine Datei – der vorige für dieselbe weicht. */
  function satzAnlegen(id) {
    const k = kasten();
    if (!k) return null;
    const alt = satzVon(id);
    if (alt) raeumeSatz(alt);
    const satz = document.createElement('div');
    satz.className = 'griff-satz';
    satz.dataset.id = String(id);
    satz._sichtbar = new Set();
    k.appendChild(satz);
    return satz;
  }

  /** Alles weg, was an einem Satz hängt – Beobachter, Arbeiter, Puffer. */
  function raeumeSatz(satz) {
    if (!satz) return;
    if (satz._beobachter) { try { satz._beobachter.disconnect(); } catch (err) { /* egal */ } }
    if (satz._pdf) { try { satz._pdf.destroy(); } catch (err) { /* egal */ } }
    if (satz._bildUrl) { try { URL.revokeObjectURL(satz._bildUrl); } catch (err) { /* egal */ } }
    satz.remove();
  }

  /**
   * Den gezeigten Satz aus dem Blick nehmen.
   *
   * Seine Rollstelle wird dabei in Pixeln gemerkt – der Kasten ist für
   * alle Sätze derselbe, und wer zurückkommt, will genau dort stehen,
   * nicht ungefähr. Der Anteil in der Datei (merkeStelle) ist etwas
   * anderes: der überlebt das Beenden der App.
   */
  function satzWegblenden() {
    const k = kasten();
    if (!k) return;
    for (const satz of k.querySelectorAll('.griff-satz:not([hidden])')) {
      satz._rollte = k.scrollTop;
      satz._quer = k.scrollLeft;
      satz.hidden = true;
    }
  }

  /** Einen Satz zeigen und an seine gemerkte Stelle rollen. */
  function satzZeigen(satz) {
    const k = kasten();
    if (!k || !satz) return;
    satz.hidden = false;
    /* Erst nach dem Einblenden steht die Höhe wieder – vorher zeigte
       scrollTop ins Leere. */
    requestAnimationFrame(() => {
      k.scrollTop = satz._rollte || 0;
      k.scrollLeft = satz._quer || 0;
    });
  }

  const txt = (schluessel, ersatz) =>
    (typeof t === 'function' ? t(schluessel) : ersatz) || ersatz;

  /** Leert einen Kasten, ohne innerHTML anzufassen. */
  function leere(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function datei(id) {
    return _stand.dateien.find(d => d.id === String(id)) || null;
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE LEISTE

     Gebaut wie Chat und Kommentare und an derselben Kante. Sie schließt
     die beiden anderen und wird von ihnen geschlossen: drei Leisten
     nebeneinander liessen vom Blatt nichts übrig.
     ══════════════════════════════════════════════════════════════════ */
  const leiste = () => E('griff-panel');
  const leisteOffen = () => !!leiste() && leiste().classList.contains('open');

  function setzeLeiste(auf) {
    const p = leiste();
    if (!p || p.classList.contains('open') === auf) return;

    if (auf) {
      if (typeof window.closeCommentPanel === 'function') window.closeCommentPanel();
      if (typeof window.closeChatPanel === 'function') window.closeChatPanel();
    }

    p.classList.toggle('open', auf);
    E('btn-griff')?.classList.toggle('active', auf);
    // Solange die Leiste offen ist, sind die Namen dort zu lesen
    zeichneReiter();
    nachLayout();
  }

  /* ui/comments.js und ui/chat.js fragen das, bevor sie aufmachen.

     >>> Auch die aufgeschlagene Datei zählt <<<
     Hier stand nur die Leiste. Eine offene Unterlage ist aber genauso
     eine Spalte an derselben Kante: käme die Kommentarleiste daneben,
     bliebe vom Blatt ein Streifen. Wer die Kommentare braucht, macht die
     Unterlage zu – dann ist der Weg wieder frei. */
  window.griffBlocksPanels = () => leisteOffen() || ansichtOffen();
  window.closeGriffPanel = () => setzeLeiste(false);

  /** Die Blattspalte hat sich geändert: Zoom und Kommentarkarten nachziehen. */
  function nachLayout() {
    setTimeout(() => {
      if (typeof _applyZoom === 'function') _applyZoom();
      if (typeof window.refreshComments === 'function') window.refreshComments();
    }, 220);
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE LISTE IN DER LEISTE
     ══════════════════════════════════════════════════════════════════ */

  function knopf(klasse, beschriftung, titel, tun) {
    const b = document.createElement('button');
    b.className = klasse;
    b.textContent = beschriftung;
    if (titel) b.title = titel;
    b.addEventListener('click', (e) => { e.stopPropagation(); tun(); });
    return b;
  }

  function zeichneListe() {
    const liste = E('griff-liste');
    if (!liste) return;
    leere(liste);

    if (!_stand.dateien.length) {
      const leer = document.createElement('div');
      leer.className = 'griff-leer';
      leer.textContent = txt('griffLeer',
        'Noch nichts hinterlegt. Zieh ein PDF oder ein Bild hierher – es wird nicht kopiert.');
      liste.appendChild(leer);
      return;
    }

    for (const d of _stand.dateien) {
      const zeile = document.createElement('div');
      zeile.className = 'griff-zeile' + (d.da ? '' : ' fehlt');
      zeile.dataset.id = d.id;

      /* Gezogen wird am Griff, nicht an der Zeile: sonst liesse sich die
         Liste mit dem Finger nicht mehr rollen (dieselbe Überlegung wie
         im Abschnitts-Manager, ui/sidebar.js). */
      const griff = document.createElement('span');
      griff.className = 'griff-zeile-griff';
      griff.title = txt('griffOrdnen', 'Ziehen zum Umsortieren');
      griff.textContent = '⠿';
      griff.addEventListener('pointerdown', (e) => beginneZug(e, d.id));

      const art = document.createElement('span');
      art.className = 'griff-zeile-art';
      art.textContent = d.art === 'pdf' ? 'PDF' : 'BILD';

      const name = document.createElement('span');
      name.className = 'griff-zeile-name';
      name.textContent = d.name;
      name.title = d.da ? d.name : txt('griffFehlt', 'Datei konnte nicht gefunden werden');

      const werkzeug = document.createElement('span');
      werkzeug.className = 'griff-zeile-tools';
      werkzeug.appendChild(knopf('griff-mini', '✎', txt('griffUmbenennen', 'Umbenennen'),
        () => benenneUm(d.id)));
      werkzeug.appendChild(knopf('griff-mini gefahr', '✕', txt('griffEntfernen', 'Entfernen'),
        () => nimmWeg(d.id)));

      zeile.append(griff, art, name, werkzeug);

      /* Anklicken schlägt auf – dasselbe wie ein Wischen am Reiter. Nach
         einem Zug am Griff aber nicht: dort endet der Zeiger über einer
         Zeile, und Chromium macht daraus noch einen Klick. */
      zeile.addEventListener('click', () => {
        if (Date.now() - _zugEnde < 300) return;
        oeffne(d.id);
      });

      liste.appendChild(zeile);
    }
  }

  function zeichneFuss() {
    const voll = _stand.dateien.length >= 3;
    const feld = E('griff-ablage');
    if (feld) feld.classList.toggle('voll', voll);
    const waehl = E('griff-waehlen');
    if (waehl) waehl.disabled = voll;
    const text = feld?.querySelector('.griff-ablage-text');
    if (text) {
      text.textContent = voll
        ? txt('griffVoll', 'Drei Unterlagen sind das Höchste. Nimm zuerst eine weg.')
        : txt('griffZiehen', 'Datei hierher ziehen');
    }

    const schalter = E('griff-verstecken');
    const schalterText = E('griff-verstecken-text');
    if (schalterText) {
      schalterText.textContent = _stand.versteckt
        ? txt('griffEinblenden', 'Alle einblenden')
        : txt('griffAusblenden', 'Alle ausblenden');
    }
    if (schalter) {
      schalter.classList.toggle('an', _stand.versteckt);
      schalter.disabled = !_stand.dateien.length;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE REITER AN DER KANTE

     Sie teilen sich die Höhe zu gleichen Teilen (flex: 1) – bei drei
     Dateien also je ein Drittel. Zu sehen sind sie nur, solange die
     Leiste zu ist: dort stehen die Namen ohnehin, und beides zugleich
     wäre zweimal dasselbe an derselben Kante.
     ══════════════════════════════════════════════════════════════════ */
  /**
   * Die Breite des Rollbalkens der Blattspalte in --rollbalken schreiben.
   *
   * Sie schwankt: mit dem System, mit der Einstellung „Rollbalken immer
   * anzeigen" und damit, ob die Spalte gerade ueberhaupt rollt. Steht sie
   * auf 0 – etwa weil das Heft auf eine Seite passt – bleibt der zuletzt
   * gemessene Wert stehen, sonst ruckte das Rechteck bei jeder Seite hin
   * und her.
   */
  function messeRollbalken() {
    const k = E('pg-scroll');
    if (!k) return;
    const breit = Math.round(k.offsetWidth - k.clientWidth);
    if (breit > 0) document.documentElement.style.setProperty('--rollbalken', breit + 'px');
  }

  function zeichneReiter() {
    const streifen = E('griff-reiter');
    if (!streifen) return;
    leere(streifen);

    /* >>> Weg, sobald eine Datei offen ist <<<
       Sie liegt dann rechts daneben und trägt ihren Namen in der
       Kopfzeile. Ein Rechteck davor wäre derselbe Name ein zweites Mal –
       und es läge auf ihrem Rand. Zumachen bringt sie zurück. */
    const zeigen = !!(!_stand.versteckt && _stand.dateien.length
      && !leisteOffen() && !ansichtOffen());
    streifen.style.display = zeigen ? 'flex' : 'none';

    /* Der Rollbalken der Blattspalte bleibt an der Fensterkante; das
       Rechteck rueckt statt dessen um seine Breite nach innen. Wie breit
       er ist, entscheidet das System – also nachmessen, statt es in der
       Formatvorlage zu raten (css/griffbereit.css). */
    if (zeigen) messeRollbalken();
    if (!zeigen) return;

    for (const d of _stand.dateien) {
      const b = document.createElement('button');
      b.className = 'griff-reiter-btn'
        + (String(_offen) === d.id ? ' aktiv' : '')
        + (d.da ? '' : ' fehlt');
      b.dataset.id = d.id;
      b.title = d.da
        ? txt('griffAufschlagen', 'Nach links wischen zum Aufschlagen')
        : txt('griffFehlt', 'Datei konnte nicht gefunden werden');

      const name = document.createElement('span');
      name.className = 'griff-reiter-name';
      name.textContent = d.name;
      b.appendChild(name);

      haengeWischAn(b, d.id);
      streifen.appendChild(b);
    }
  }

  function zeichne() {
    zeichneListe();
    zeichneFuss();
    zeichneReiter();
    // Eine ausgeblendete oder weggenommene Datei bleibt nicht offen stehen
    if (_offen && (_stand.versteckt || !datei(_offen))) schliesse();
    /* Und was weggenommen oder ausgeblendet wurde, hat auch im Kasten
       nichts mehr zu suchen. Sonst hinge ein Buch im Speicher, das es
       nicht mehr gibt – oder eines, das gerade ausdrücklich aus dem Weg
       geräumt wurde. */
    const k = kasten();
    if (k) {
      for (const satz of k.querySelectorAll('.griff-satz')) {
        if (_stand.versteckt || !datei(satz.dataset.id)) raeumeSatz(satz);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     HINZUFÜGEN

     Zwei Wege, ein Ziel: der Hauptprozess bietet die Datei an, hier wird
     nach dem Namen gefragt, dann wird sie übernommen. Der Pfad geht
     dabei nie durch dieses Fenster (siehe main.js).
     ══════════════════════════════════════════════════════════════════ */
  async function frageUndUebernimm(angebot) {
    if (!angebot || !angebot.id) return;
    if (_stand.dateien.length >= 3) {
      toast(txt('griffVoll', 'Drei Unterlagen sind das Höchste. Nimm zuerst eine weg.'), true);
      return;
    }
    const name = await txtModal(txt('griffNameFrage', 'Wie soll die Unterlage heißen?'),
      angebot.vorschlag || '');
    if (!name) return;

    const antwort = await ueberBruecke('Übernehmen',
      () => api().uebernehmen(heftId(), angebot.id, name));
    if (!antwort) return;
    if (antwort.fehler) {
      toast(txt('griffVoll', 'Drei Unterlagen sind das Höchste. Nimm zuerst eine weg.'), true);
      return;
    }
    standAnnehmen(antwort);
    /* Frisch Hinzugefügtes soll man sehen – auch wenn gerade alles
       ausgeblendet ist. Sonst legt jemand eine Datei ab und nichts
       geschieht. */
    if (_stand.versteckt) standAnnehmen(await api().verstecken(heftId(), false));
    zeichne();

    /* >>> Und aufschlagen <<<
       Steht schon eine Unterlage offen, sind die Reiter weg (sie stünden
       sonst auf ihrem Rand, siehe zeichneReiter). Die neue Datei kam
       damit ins Heft, ohne dass irgendetwas darauf hindeutete – gemeldet
       als „sie liegt hinter der anderen und man sieht sie nicht".

       Wer eine Datei ablegt, will sie ansehen. Also wird sie
       aufgeschlagen, und das ist zugleich die Rückmeldung, dass sie
       angekommen ist.

       Steht KEINE offen und ist die Leiste da, bleibt es dabei: dort
       steht die neue Zeile in der Liste, das ist Rückmeldung genug. Wer
       gerade mehrere einsortiert, will nicht nach jeder einzelnen aus
       der Liste geworfen werden.

       Die Leiste schliesst die Ansicht nicht (setzeLeiste) – beides
       kann zugleich offen stehen, und genau dann trat der Fehler auf. */
    if (ansichtOffen() || !leisteOffen()) oeffne(angebot.id);
  }

  async function waehleAus() {
    if (!api()) return;
    const angebot = await api().waehlen();
    if (angebot) await frageUndUebernimm(angebot);
  }

  async function benenneUm(id) {
    const d = datei(id);
    if (!d) return;
    const name = await txtModal(txt('griffNameFrage', 'Wie soll die Unterlage heißen?'), d.name);
    if (!name || name === d.name) return;
    const neu = await ueberBruecke('Umbenennen', () => api().aendern(heftId(), id, { name }));
    if (!neu) return;
    standAnnehmen(neu);
    zeichne();
    if (String(_offen) === String(id)) {
      const anzeige = E('griff-view-name');
      if (anzeige) anzeige.textContent = datei(id)?.name || '';
    }
  }

  async function nimmWeg(id) {
    const d = datei(id);
    if (!d) return;
    const ok = await showConfirm(
      txt('griffWegFrage', 'Nur der Verweis wird entfernt – die Datei selbst bleibt liegen, wo sie ist.'));
    if (!ok) return;
    if (String(_offen) === String(id)) schliesse();
    const nachher = await ueberBruecke('Wegnehmen', () => api().entfernen(heftId(), id));
    if (!nachher) return;
    standAnnehmen(nachher);
    zeichne();
  }

  /* ══════════════════════════════════════════════════════════════════
     UMSORTIEREN

     Zeiger-Ereignisse und nicht HTML5-Drag: dragstart gibt es mit dem
     Finger nicht. Bei höchstens drei Zeilen genügt es, bei jeder
     Bewegung die Mitten abzufragen – die Rechnerei, die der
     Abschnitts-Manager für hundert Seiten treibt, wäre hier Aufwand
     ohne Gegenwert.
     ══════════════════════════════════════════════════════════════════ */
  let _zugId = null, _zugZeiger = null, _zugZiel = null, _zugEnde = 0;

  /**
   * Die neue Reihenfolge nach einem Zug.
   *
   * `ziel` ist eine Stelle in der Liste, WIE SIE DASTEHT – die gezogene
   * Zeile steht darin noch mit. Wird sie nach hinten getragen, rutscht
   * durch ihr Herausnehmen alles dahinter um eins vor; deshalb das
   * `ziel - 1`. Ohne diese Zeile landet man beim Ziehen nach unten immer
   * eine Stelle zu weit.
   */
  function neueFolge(ids, gezogen, ziel) {
    const folge = ids.map(String);
    const von = folge.indexOf(String(gezogen));
    if (von === -1) return folge;
    folge.splice(von, 1);
    folge.splice(ziel > von ? ziel - 1 : ziel, 0, String(gezogen));
    return folge;
  }

  function beginneZug(e, id) {
    const liste = E('griff-liste');
    if (!liste) return;
    e.preventDefault();
    _zugId = id;
    _zugZeiger = e.pointerId;
    _zugZiel = null;
    liste.classList.add('ordnet');
    liste.querySelector('.griff-zeile[data-id="' + CSS.escape(String(id)) + '"]')
      ?.classList.add('wandert');
    try { liste.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    ruesteZug(liste);
  }

  function stelleAn(liste, y) {
    const zeilen = [...liste.querySelectorAll('.griff-zeile')];
    for (let i = 0; i < zeilen.length; i++) {
      const r = zeilen[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return zeilen.length;
  }

  function ruesteZug(liste) {
    if (liste._zugBereit) return;
    liste._zugBereit = true;

    liste.addEventListener('pointermove', (e) => {
      if (!_zugId || e.pointerId !== _zugZeiger) return;
      e.preventDefault();
      _zugZiel = stelleAn(liste, e.clientY);
      const zeilen = [...liste.querySelectorAll('.griff-zeile')];
      zeilen.forEach((z, i) => {
        z.classList.toggle('davor', i === _zugZiel);
        z.classList.toggle('dahinter', _zugZiel === zeilen.length && i === zeilen.length - 1);
      });
    });

    const beenden = async (e) => {
      if (!_zugId || e.pointerId !== _zugZeiger) return;
      const gezogen = _zugId;
      const ziel = _zugZiel;
      _zugId = null; _zugZeiger = null; _zugZiel = null; _zugEnde = Date.now();
      liste.classList.remove('ordnet');
      liste.querySelectorAll('.griff-zeile')
        .forEach(z => z.classList.remove('wandert', 'davor', 'dahinter'));
      try { liste.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
      if (ziel === null) return;

      const folge = neueFolge(_stand.dateien.map(d => d.id), gezogen, ziel);
      const geordnet = await ueberBruecke('Umsortieren', () => api().ordnen(heftId(), folge));
      if (!geordnet) return;
      standAnnehmen(geordnet);
      zeichne();
    };

    liste.addEventListener('pointerup', beenden);
    liste.addEventListener('pointercancel', beenden);
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE ANSICHT AUF- UND ZUMACHEN
     ══════════════════════════════════════════════════════════════════ */

  function ansicht() { return E('griff-view'); }
  function ansichtOffen() { return !!ansicht() && ansicht().classList.contains('open'); }

  /** Breiter als das halbe Fenster geht es nicht – sonst bleibt vom Heft nichts. */
  function grenze() {
    return Math.max(MIN_BREITE, Math.round(window.innerWidth / 2));
  }

  function setzeBreite(px, sofort) {
    const v = ansicht();
    if (!v) return 0;
    const b = Math.min(grenze(), Math.max(MIN_BREITE, Math.round(px || VORGABE_BREITE)));
    if (sofort) v.classList.add('zieht');
    v.style.setProperty('--griff-breite', b + 'px');
    return b;
  }

  async function oeffne(id) {
    const d = datei(id);
    if (!d) return;
    if (String(_offen) === String(id) && ansichtOffen()) { schliesse(); return; }

    /* Eine Datei, die beim letzten Blick fehlte, wird trotzdem
       aufgeschlagen. `d.da` ist ein Stand von vorhin – der Stick kann
       wieder stecken, das Netzlaufwerk wieder da sein. Wer sie antippt,
       will genau das wissen, und das Lesen beantwortet es verbindlich. */

    /* Was an der rechten Kante offen steht, macht der Unterlage Platz –
       dieselbe Überlegung wie in setzeLeiste(). */
    if (typeof window.closeCommentPanel === 'function') window.closeCommentPanel();
    if (typeof window.closeChatPanel === 'function') window.closeChatPanel();

    // Erst die Stelle der bisher offenen Datei sichern, dann wechseln
    merkeStelle();

    /* Steht ihr Satz schon bereit, wird gar nichts geladen – aufschlagen
       heisst dann nur noch: einblenden. Ein halb gebauter Satz zählt
       nicht (satz._fertig), der taugt nur zum Wegwerfen. */
    let satz = satzVon(id);
    const stehtSchon = !!(satz && satz._fertig);

    // Die bisher gezeigte tritt zur Seite und merkt sich dabei ihre Stelle
    satzWegblenden();

    _offen = String(id);
    _offenHeft = heftId();
    _fertig = stehtSchon;
    const lauf = ++_lauf;

    const v = ansicht();
    v?.classList.remove('zieht');
    setzeBreite(d.breite || VORGABE_BREITE);
    /* VOR dem Einhängen des Inhalts: die Kästen sollen gleich in ihrer
       richtigen Breite entstehen. Nachträglich wäre es ein zweiter
       Umbruch und ein zweites Zeichnen. */
    zoomAnwenden(d.zoom);
    v?.classList.add('open');
    const anzeige = E('griff-view-name');
    if (anzeige) anzeige.textContent = d.name;
    zeichneReiter();
    nachLayout();

    /* Fuer die Reihenfolge beim Vorladen: die zuletzt benutzte Unterlage
       kommt beim naechsten Aufschlagen des Hefts zuerst dran. */
    api().aendern(heftId(), id, { zuletzt: true }).catch(() => { /* egal */ });

    /* Der kurze Weg: der Satz steht schon da, er muss nur wieder in den
       Blick. Nichts zu laden, nichts zu zeichnen – nur die Breite kann
       sich seither geändert haben. Der Zoom steht bereits: ihn hat
       zoomAnwenden oben gesetzt, und zeigeZoomWert lief dabei mit. */
    if (stehtSchon) {
      satzZeigen(satz);
      setTimeout(zeichneSichtbareNeu, 300);
      return;
    }

    satz = satzAnlegen(id);
    if (!satz) return;
    const laedt = document.createElement('div');
    laedt.className = 'griff-hinweis';
    laedt.textContent = txt('griffLaedt', 'wird geöffnet …');
    satz.appendChild(laedt);

    let antwort;
    try {
      antwort = await api().lesen(heftId(), id);
    } catch (err) {
      antwort = { ok: false, grund: 'fehlt' };
    }
    if (lauf !== _lauf) return;   // inzwischen wieder zugemacht

    if (!antwort || !antwort.ok) {
      const grund = antwort && antwort.grund;
      zeigeMeldung(d.name,
        grund === 'gross' ? txt('griffZuGross', 'Die Datei ist zu groß zum Anzeigen.')
        : grund === 'art' ? txt('griffKeineAnzeige', 'Diese Datei lässt sich hier nicht anzeigen.')
        : txt('griffFehlt', 'Datei konnte nicht gefunden werden'));
      // Der Reiter soll das ebenfalls zeigen
      standAnnehmen(await api().liste(heftId()));
      zeichne();
      return;
    }

    /* Der Hinweis bleibt stehen, bis der Inhalt da ist. Ein PDF misst
       vorher seine Seiten aus – wer ihn hier schon wegnähme, sähe bei
       einem Skript zwei Sekunden lang eine leere Fläche. */
    try {
      if (antwort.art === 'pdf') await zeigePdf(antwort.adresse, () => lauf === _lauf, satz);
      else zeigeBild(antwort.bytes, antwort.mime, satz);
    } catch (err) {
      console.warn('[Griffbereit] Anzeigen fehlgeschlagen:', err?.message || err);
      if (lauf === _lauf) {
        zeigeMeldung(d.name, txt('griffKaputt', 'Die Datei lässt sich nicht anzeigen.'));
      }
      return;
    }
    if (lauf !== _lauf) return;

    satz._fertig = true;
    _fertig = true;
    zeigeZoomWert();

    // Dort weitermachen, wo zuletzt aufgehört wurde
    requestAnimationFrame(() => {
      rolleZuAnteil(d.stelle || 0);
      rolleQuer(d.quer || 0);
    });

    /* Und noch einmal, wenn die Leiste ausgefahren ist. Während der
       Bewegung stimmt die Breite noch nicht ganz, und eine Seite, die in
       halber Breite gezeichnet wurde, bliebe unscharf stehen. */
    setTimeout(zeichneSichtbareNeu, 300);
  }

  function zeigeMeldung(name, text) {
    const v = ansicht();
    if (!v) return;
    v.classList.add('open');
    const anzeige = E('griff-view-name');
    if (anzeige) anzeige.textContent = name || '';
    /* Die Meldung steht in einem eigenen Satz. Als unfertiger fliegt er
       beim Zumachen von selbst weg – aufzuheben ist an ihm nichts. */
    const satz = _offen ? (satzVon(_offen) || satzAnlegen(_offen)) : null;
    if (satz) {
      leere(satz);
      satz._fertig = false;
      satz.hidden = false;
      const p = document.createElement('div');
      p.className = 'griff-fehlt-text';
      p.textContent = text;
      satz.appendChild(p);
    }
    _fertig = false;
    zeigeZoomWert();
    nachLayout();
  }

  /**
   * Zumachen.
   *
   * >>> Der Inhalt bleibt stehen <<<
   * Weggeräumt wird nur, was ohnehin nichts taugt: eine halb geladene
   * Datei oder eine Fehlermeldung. Alles Vollständige bleibt im Kasten
   * liegen und ist beim nächsten Aufschlagen sofort wieder da – samt
   * Rollstelle, denn es wurde ja nie ausgehängt.
   *
   * Auch der NAME bleibt in der Kopfzeile stehen. Er wurde hier einmal
   * geleert; zu sehen war das nie (der Kasten ist dann 0 px breit), aber
   * beim Aufschlagen flackerte die Zeile einmal leer auf.
   */
  function schliesse() {
    merkeStelle();
    /* Der Satz bleibt stehen, wo er steht – auch eingeblendet. Der Kasten
       ist zugemacht 0 px breit, also ist nichts zu sehen, und seine
       Rollstelle hält sich damit von selbst. Nur ein halb gebauter Satz
       oder eine Meldung fliegt weg: aufzuheben ist daran nichts. */
    const satz = _offen ? satzVon(_offen) : null;
    if (satz && !satz._fertig) raeumeSatz(satz);
    _offen = null;
    _lauf++;
    _fertig = false;
    zeigeZoomWert();

    const v = ansicht();
    if (v) v.classList.remove('open');
    zeichneReiter();
    nachLayout();
  }

  /* ══════════════════════════════════════════════════════════════════
     DER INHALT
     ══════════════════════════════════════════════════════════════════ */

  function zeigeBild(bytes, mime, satz) {
    leere(satz);
    satz._bildUrl = URL.createObjectURL(new Blob([bytes], { type: mime || 'image/png' }));
    const img = document.createElement('img');
    img.className = 'griff-blatt';
    img.alt = '';
    img.src = satz._bildUrl;
    satz.appendChild(img);
  }

  async function zeigePdf(adresse, gueltig, satz) {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js fehlt');

    /* >>> Nur die Adresse, nicht die Datei <<<
       Hier lag einmal das ganze PDF als Puffer, durch die Brücke
       gereicht. Bei einem abfotografierten Buch waren das ein paar
       hundert Megabyte – dreimal im Speicher, und deshalb stand ab
       einer Grenze nur „zu groß" da.

       Jetzt holt pdf.js die Datei selbst vom Oberflächen-Server
       (main.js, griffAusliefern), und der beantwortet Bereiche. Damit
       wandern nur die Stücke herüber, die für die gerade sichtbaren
       Seiten gebraucht werden.

       disableAutoFetch und disableStream gehören zusammen: ohne das
       erste holt pdf.js im Hintergrund doch wieder das ganze Buch,
       sobald es Zeit hat, ohne das zweite liest es die erste Anfrage
       einfach bis zum Ende durch. Beides zusammen heisst: nur Bereiche,
       nur bei Bedarf. */
    const doc = await pdfjsLib.getDocument({
      url: adresse,
      rangeChunkSize: 256 * 1024,
      disableAutoFetch: true,
      disableStream: true,
      // Kein eval – die Begruendung steht in core/importExport.js
      isEvalSupported: false
    }).promise;
    if (!gueltig()) { try { doc.destroy(); } catch (err) { /* egal */ } return; }
    satz._pdf = doc;

    // Die Verhältnisse vorab – daran hängt die Höhe der leeren Kästen
    const verhaeltnisse = [];
    const messen = Math.min(doc.numPages, HOECHSTENS_GEMESSEN);
    for (let n = 1; n <= messen; n++) {
      const seite = await doc.getPage(n);
      const v = seite.getViewport({ scale: 1 });
      verhaeltnisse.push(v.width / v.height);
      if (!gueltig()) return;
    }
    const ersatz = ueblicheForm(verhaeltnisse);

    leere(satz);
    for (let n = 1; n <= doc.numPages; n++) {
      const seitenkasten = document.createElement('div');
      seitenkasten.className = 'griff-seite';
      seitenkasten.dataset.nr = String(n);
      seitenkasten.style.aspectRatio = String(verhaeltnisse[n - 1] || ersatz);
      satz.appendChild(seitenkasten);
    }

    /* Was in die Nähe kommt, wird gezeichnet. 600 px Vorlauf: beim
       Rollen soll die Seite schon dastehen, nicht erst entstehen. */
    satz._beobachter = new IntersectionObserver((eintraege) => {
      for (const e of eintraege) {
        if (e.isIntersecting) { satz._sichtbar.add(e.target); zeichneSeite(e.target); }
        else satz._sichtbar.delete(e.target);
      }
    }, { root: kasten(), rootMargin: '600px 0px' });

    for (const k of satz.querySelectorAll('.griff-seite')) satz._beobachter.observe(k);
  }

  /**
   * Die Form, die unter den gemessenen Seiten am häufigsten vorkommt.
   *
   * Sie gilt für alles, was nicht gemessen wurde. Die erste Seite wäre
   * die naheliegende Wahl und die falsche: ein Deckblatt ist oft breiter
   * oder quadratischer als der Rest, und dann stünden hinter ihm hundert
   * Kästen in einer Höhe, die für keine einzige Seite stimmt.
   *
   * Gerundet auf zwei Stellen wird gezählt, damit ein Blatt, das um ein
   * Tausendstel abweicht, nicht als eigene Form durchgeht.
   */
  function ueblicheForm(verhaeltnisse) {
    if (!verhaeltnisse.length) return 0.7071;   // A4 hochkant
    const zaehlung = new Map();
    for (const v of verhaeltnisse) {
      const schluessel = v.toFixed(2);
      const bisher = zaehlung.get(schluessel);
      zaehlung.set(schluessel, bisher ? { wert: bisher.wert, wie: bisher.wie + 1 } : { wert: v, wie: 1 });
    }
    let beste = null;
    for (const eintrag of zaehlung.values()) {
      if (!beste || eintrag.wie > beste.wie) beste = eintrag;
    }
    return beste.wert;
  }

  /**
   * @param {Element} seitenkasten
   * @param {number} [breiteVorgabe]  für Stapel, die noch nicht zu sehen
   *   sind: ein ausgeblendeter Kasten misst 0, und ohne diese Angabe
   *   liesse sich im Voraus gar nichts zeichnen (vorladen).
   */
  async function zeichneSeite(seitenkasten, breiteVorgabe) {
    /* >>> Das Dokument kommt vom eigenen Satz <<<
       Hier stand eine Variable für alle. Seit mehrere Sätze zugleich
       bereitstehen, meldet sich auch der Beobachter eines Satzes, der
       gerade nicht zu sehen ist – und der zeichnete dann eine Seite aus
       dem falschen Buch. */
    const satz = seitenkasten.parentElement;
    const pdf = satz && satz._pdf;
    if (!pdf || seitenkasten._zeichnet) return;
    const kasten = seitenkasten;
    const breite = kasten.clientWidth || Math.round(breiteVorgabe || 0);
    if (breite < 10) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const leinwandBreite = Math.min(Math.round(breite * dpr * FEINHEIT), MAX_LEINWAND);

    /* Verglichen wird die LEINWAND und nicht die Kästchenbreite: jenseits
       der Obergrenze ändert sich die Breite weiter, das Bild aber nicht
       mehr – und jede weitere Stufe zeichnete dann dasselbe noch einmal. */
    if (kasten._beiLeinwand && Math.abs(kasten._beiLeinwand - leinwandBreite) < 8) return;

    kasten._zeichnet = true;
    /* >>> Wann eine begonnene Zeichnung nichts mehr taugt <<<
       Hier stand die Nummer des Aufschlagens – gedacht gegen ein Bild,
       das nach dem Zumachen noch hereinfällt. Seit jede Unterlage ihren
       eigenen Stapel behält, ist das kein Fehler mehr, sondern genau
       das, was das Vorladen will: fertig werden, ohne gezeigt zu sein.
       Falsch wäre nur ein Bild für einen Kasten, den es nicht mehr gibt,
       oder aus einem Dokument, das inzwischen ein anderes ist. */
    const gilt = () => kasten.isConnected && satz._pdf === pdf;
    try {
      const seite = await pdf.getPage(Number(kasten.dataset.nr));
      if (!gilt()) return;

      const roh = seite.getViewport({ scale: 1 });
      const viewport = seite.getViewport({ scale: leinwandBreite / roh.width });

      const leinwand = document.createElement('canvas');
      leinwand.width = Math.round(viewport.width);
      leinwand.height = Math.round(viewport.height);
      leinwand.className = 'griff-seite-bild';
      await seite.render({ canvasContext: leinwand.getContext('2d'), viewport }).promise;
      if (!gilt()) return;

      // Das gemessene Verhältnis ist genauer als die Schätzung von vorhin
      kasten.style.aspectRatio = String(roh.width / roh.height);
      leere(kasten);
      kasten.appendChild(leinwand);
      kasten._beiLeinwand = leinwandBreite;
    } catch (err) {
      console.warn('[Griffbereit] Seite', kasten.dataset.nr, err?.message || err);
    } finally {
      kasten._zeichnet = false;
    }
  }

  /** Nach dem Ziehen an der Kante: was im Ausschnitt liegt, neu und scharf. */
  function zeichneSichtbareNeu() {
    const satz = _offen ? satzVon(_offen) : null;
    if (!satz || !satz._sichtbar) return;
    for (const k of satz._sichtbar) zeichneSeite(k);
  }

  /* ══════════════════════════════════════════════════════════════════
     DER ZOOM

     Eine Unterlage steht in einer Spalte von vielleicht 400 px. Ein
     Skript in A4 ist darin lesbar, eine abfotografierte Doppelseite mit
     Fußnoten nicht. Deshalb lässt sich die Seite größer ziehen – und das
     ist etwas anderes, als die Spalte breiter zu machen: die nimmt sich
     ihren Platz vom Heft daneben.

     >>> Warum keine Transformation <<<
     `transform: scale()` wäre eine Zeile und sieht bei einem PDF nach
     nichts aus: vergrößert wird dabei das FERTIGE Bild, die Schrift also
     unscharf – genau das, wogegen man zoomt. Stattdessen wird der Kasten
     breiter, und `zeichneSeite()` zeichnet die Seite in der neuen Breite
     neu. Bei einem Bild macht der Browser dasselbe von selbst.

     Neu gezeichnet wird aber erst, wenn die Finger stillhalten. Während
     der Geste zieht der Browser die vorhandene Leinwand auf – das kostet
     eine Bildzeile statt einer Seitenberechnung je Schritt.
     ══════════════════════════════════════════════════════════════════ */

  /* Unter 0,5 wäre eine Seite ein Daumennagel, über 4 kommt nichts mehr
     dazu – die Leinwand ist bei dieser Stufe ohnehin abgeriegelt
     (MAX_LEINWAND). Dieselben Grenzen stehen in main.js. */
  const MIN_ZOOM = 0.5, MAX_ZOOM = 4;
  const ZOOM_SCHRITT = 1.25;

  let _zoom = 1;
  let _zoomTimer = null;

  /** Nur setzen und anzeigen – ohne Anker, ohne Merken. */
  function zoomAnwenden(z) {
    const wert = Number(z);
    _zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(wert) && wert ? wert : 1));
    ansicht()?.style.setProperty('--griff-zoom', String(_zoom));
    zeigeZoomWert();
  }

  function zeigeZoomWert() {
    // Ohne Inhalt gibt es nichts zu vergrössern – dann steht da auch nichts
    const feld = E('griff-zoom');
    if (feld) feld.hidden = !_fertig;
    const wert = E('griff-zoom-wert');
    if (wert) wert.textContent = Math.round(_zoom * 100) + '%';
    // Am Anschlag tut der Knopf nichts mehr, und das soll man sehen
    const raus = E('griff-zoom-raus'), rein = E('griff-zoom-rein');
    if (raus) raus.disabled = _zoom <= MIN_ZOOM + 0.001;
    if (rein) rein.disabled = _zoom >= MAX_ZOOM - 0.001;
  }

  /**
   * Auf einen neuen Zoom stellen.
   *
   * @param {number} neu      der gewünschte Faktor
   * @param {number} [ankerX] Punkt auf dem Schirm, der stehen bleiben
   * @param {number} [ankerY] soll (Finger, Mauszeiger). Sonst die Mitte.
   */
  function setzeZoom(neu, ankerX, ankerY) {
    const k = E('griff-view-body');
    const v = ansicht();
    if (!k || !v || !_fertig) return;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, neu));
    if (Math.abs(z - _zoom) < 0.002) return;

    /* Der Punkt unter dem Finger soll unter dem Finger bleiben. Gemerkt
       wird er als ANTEIL am Inhalt und nicht in Pixeln – dessen Höhe ist
       gleich eine andere. */
    const r = k.getBoundingClientRect();
    const ax = ankerX == null ? k.clientWidth / 2 : ankerX - r.left;
    const ay = ankerY == null ? k.clientHeight / 2 : ankerY - r.top;
    const vorX = (k.scrollLeft + ax) / Math.max(1, k.scrollWidth);
    const vorY = (k.scrollTop + ay) / Math.max(1, k.scrollHeight);

    zoomAnwenden(z);

    /* Das Lesen von scrollWidth erzwingt den neuen Umbruch – ohne diese
       Zeile stünden hier noch die Masse von vorhin, und der Anker
       sprünge. */
    k.scrollLeft = Math.max(0, vorX * k.scrollWidth - ax);
    k.scrollTop = Math.max(0, vorY * k.scrollHeight - ay);

    clearTimeout(_zoomTimer);
    _zoomTimer = setTimeout(() => {
      _zoomTimer = null;
      zeichneSichtbareNeu();
      merkeStelle();
    }, 260);
  }

  /* ── Mit zwei Fingern ────────────────────────────────────────────────
     Auf einem Tablett ist das der einzige naheliegende Weg. Gerechnet
     wird höchstens einmal je Bildzeile: setzeZoom() liest scrollWidth,
     und das erzwingt jedes Mal einen Umbruch – bei einem Buch mit 400
     Kästen nichts, was man dreimal pro Bildzeile tun will. */
  (function kneifen() {
    const k = E('griff-view-body');
    if (!k) return;
    let start = 0, zoomStart = 1, aktiv = false, geplant = 0, letzte = null;

    const abstand = (t) => Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);

    k.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2 || !_fertig || schneidetGerade()) { aktiv = false; return; }
      aktiv = true;
      start = abstand(e.touches) || 1;
      zoomStart = _zoom;
    }, { passive: true });

    k.addEventListener('touchmove', (e) => {
      if (!aktiv || e.touches.length !== 2) return;
      e.preventDefault();
      letzte = {
        d: abstand(e.touches),
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
      if (geplant) return;
      geplant = requestAnimationFrame(() => {
        geplant = 0;
        if (!aktiv || !letzte) return;
        setzeZoom(zoomStart * (letzte.d / start), letzte.x, letzte.y);
      });
    }, { passive: false });

    const ende = () => {
      aktiv = false; start = 0; letzte = null;
      if (geplant) { cancelAnimationFrame(geplant); geplant = 0; }
    };
    k.addEventListener('touchend', ende, { passive: true });
    k.addEventListener('touchcancel', ende, { passive: true });
  })();

  /* ── Mit Strg und dem Rad ────────────────────────────────────────────
     Ohne Strg bleibt das Rad das Rollen – in einem Dokument ist das die
     häufigere Absicht, und der Zoom hätte sie überall verdrängt. */
  E('griff-view-body')?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !ansichtOffen() || !_fertig) return;
    e.preventDefault();
    /* Kein fester Betrag je Rasten: ein Rollfeld schickt viele kleine
       Werte, ein Mausrad wenige grosse. exp() macht aus beidem dieselbe
       gefühlte Geschwindigkeit. */
    setzeZoom(_zoom * Math.exp(-e.deltaY / 400), e.clientX, e.clientY);
  }, { passive: false });

  E('griff-zoom-rein')?.addEventListener('click', () => setzeZoom(_zoom * ZOOM_SCHRITT));
  E('griff-zoom-raus')?.addEventListener('click', () => setzeZoom(_zoom / ZOOM_SCHRITT));
  E('griff-zoom-wert')?.addEventListener('click', () => setzeZoom(1));

  /* ══════════════════════════════════════════════════════════════════
     DIE STELLE MERKEN

     Als Anteil, nicht in Pixeln: die Gesamthöhe hängt an der Breite.
     Geschrieben wird verzögert – beim Rollen liefe sonst je Bildzeile
     ein Schreibvorgang auf die Platte.
     ══════════════════════════════════════════════════════════════════ */
  function anteilJetzt() {
    const k = E('griff-view-body');
    if (!k) return 0;
    const weg = k.scrollHeight - k.clientHeight;
    return weg > 0 ? Math.min(1, Math.max(0, k.scrollTop / weg)) : 0;
  }

  function rolleZuAnteil(anteil) {
    const k = E('griff-view-body');
    if (!k) return;
    const weg = k.scrollHeight - k.clientHeight;
    if (weg > 0) k.scrollTop = Math.round(weg * anteil);
  }

  /* Dasselbe zur Seite. Es gibt nur etwas zu merken, solange
     hineingezoomt ist – sonst ist die Seite so breit wie die Spalte und
     der Anteil immer 0. */
  function querJetzt() {
    const k = E('griff-view-body');
    if (!k) return 0;
    const weg = k.scrollWidth - k.clientWidth;
    return weg > 0 ? Math.min(1, Math.max(0, k.scrollLeft / weg)) : 0;
  }

  function rolleQuer(anteil) {
    const k = E('griff-view-body');
    if (!k) return;
    const weg = k.scrollWidth - k.clientWidth;
    if (weg > 0) k.scrollLeft = Math.round(weg * anteil);
  }

  function merkeStelle() {
    if (!_offen || !api()) return;
    const d = datei(_offen);
    if (!d) return;
    /* Alle drei zusammen: sie beschreiben EINE Ansicht. Getrennt
       geschrieben könnte ein Absturz dazwischenfallen und beim nächsten
       Aufschlagen stünde die alte Vergrößerung an der neuen Stelle. */
    const stand = { stelle: anteilJetzt(), quer: querJetzt(), zoom: _zoom };
    Object.assign(d, stand);                 // im Spiegel gleich mitziehen
    api().aendern(_offenHeft || heftId(), _offen, stand).catch(() => { /* egal */ });
  }

  /* ══════════════════════════════════════════════════════════════════
     WISCHEN

     Ein Zeiger-Ereignis spricht Maus, Finger und Stift gleich an – damit
     ist dieselbe Geste am Reiter zugleich das Antippen für die Maus:
     kaum bewegt heisst Klick, nach links gezogen heisst aufschlagen.
     ══════════════════════════════════════════════════════════════════ */
  const WISCH_MIN = 30;

  function haengeWischAn(el, id) {
    let x0 = 0, y0 = 0, zeiger = null;

    el.addEventListener('pointerdown', (e) => {
      zeiger = e.pointerId; x0 = e.clientX; y0 = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    });

    const los = (e) => {
      if (e.pointerId !== zeiger) return;
      zeiger = null;
      try { el.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { oeffne(id); return; }        // angetippt
      if (dx < -WISCH_MIN && Math.abs(dx) > Math.abs(dy)) { oeffne(id); return; } // nach links
      if (dx > WISCH_MIN && String(_offen) === String(id)) schliesse();           // nach rechts
    };

    el.addEventListener('pointerup', los);
    el.addEventListener('pointercancel', () => { zeiger = null; });
  }

  /* Nach rechts auf der offenen Datei fährt sie wieder ein. Mit dem
     Finger über den Berührungs-Ereignissen, weil senkrecht darin
     gerollt wird und das dem Browser überlassen bleiben muss. */
  (function wischeZu() {
    const v = ansicht();
    if (!v) return;
    let x0 = 0, y0 = 0, aktiv = false;

    /* >>> Nicht auf einem Knopf <<<
       Der Ziehknopf sitzt IN der Ansicht, und die Breite wird an ihm
       nach rechts kleiner gezogen. Ohne diese Zeile war genau das ein
       Wisch nach rechts: wer die Datei schmaler machen wollte, hatte sie
       zugemacht. Dasselbe gilt für das ✕ – wer daneben trifft und die
       Hand wegzieht, soll nichts anderes auslösen. */
    const aufKnopf = (ziel) => !!(ziel && ziel.closest && ziel.closest('button'));

    /* >>> Zugezoomt gibt es nichts zu wischen <<<
       Ist die Seite breiter als die Spalte, schiebt ein Finger nach
       rechts den Ausschnitt – wer links am Rand lesen will, hätte die
       Datei sonst zugemacht. Die Kopfzeile bleibt frei davon, dort geht
       der Wisch weiterhin, und das ✕ sowieso. */
    const kannQuer = () => {
      const k = E('griff-view-body');
      return !!k && k.scrollWidth > k.clientWidth + 1;
    };

    v.addEventListener('touchstart', (e) => {
      /* Beim Ausschneiden zieht der Finger ein Rechteck auf. Nach rechts
         ist das dieselbe Bewegung wie das Zumachen – und die Datei ging
         weg, während man noch auswählte. */
      aktiv = e.touches.length === 1 && ansichtOffen() && !aufKnopf(e.target)
        && !schneidetGerade()
        && !(kannQuer() && E('griff-view-body')?.contains(e.target));
      if (!aktiv) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });

    v.addEventListener('touchend', (e) => {
      if (!aktiv) return;
      aktiv = false;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t || aufKnopf(e.target) || schneidetGerade()) return;
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (dx > WISCH_MIN && Math.abs(dx) > Math.abs(dy)) schliesse();
    }, { passive: true });

    /* Mit der Maus dasselbe an der Kopfzeile. Auf dem Inhalt wäre es im
       Weg: dort markiert man Text und schiebt die Seite. */
    const kopf = v.querySelector('.griff-view-head');
    if (kopf) {
      let mx = 0, zeiger = null;
      kopf.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.target.closest('button')) return;
        zeiger = e.pointerId; mx = e.clientX;
      });
      kopf.addEventListener('pointerup', (e) => {
        if (e.pointerId !== zeiger) return;
        zeiger = null;
        if (e.clientX - mx > WISCH_MIN) schliesse();
      });
    }
  })();

  /* ══════════════════════════════════════════════════════════════════
     DIE BREITE ZIEHEN

     Der Knopf sitzt in der Mitte der Grenzleiste. Gezogen wird nach
     links = breiter, weil die Ansicht rechts hängt.
     ══════════════════════════════════════════════════════════════════ */
  (function ziehen() {
    const knopfEl = E('griff-zieher');
    const v = ansicht();
    if (!knopfEl || !v) return;

    let x0 = 0, b0 = 0, zeiger = null;

    knopfEl.addEventListener('pointerdown', (e) => {
      if (!ansichtOffen()) return;
      e.preventDefault();
      zeiger = e.pointerId;
      x0 = e.clientX;
      b0 = v.querySelector('.griff-view-inner').getBoundingClientRect().width;
      v.classList.add('zieht');
      try { knopfEl.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    });

    knopfEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== zeiger) return;
      e.preventDefault();
      setzeBreite(b0 + (x0 - e.clientX), true);
    });

    const fertig = async (e) => {
      if (e.pointerId !== zeiger) return;
      zeiger = null;
      try { knopfEl.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
      v.classList.remove('zieht');
      const breite = Math.round(v.querySelector('.griff-view-inner').getBoundingClientRect().width);
      nachLayout();
      zeichneSichtbareNeu();
      if (_offen && api()) {
        const d = datei(_offen);
        if (d) d.breite = breite;
        try { await api().aendern(_offenHeft || heftId(), _offen, { breite }); } catch (err) { /* egal */ }
      }
    };

    knopfEl.addEventListener('pointerup', fertig);
    knopfEl.addEventListener('pointercancel', fertig);
  })();

  /* ══════════════════════════════════════════════════════════════════
     HINEINZIEHEN

     Der Ableger fängt das Ereignis ab (stopPropagation): sonst nähme
     ui/titlebar.js dieselbe Datei zusätzlich und legte sie als Bild auf
     die Seite – genau das Kopieren, das hier nicht sein soll.
     ══════════════════════════════════════════════════════════════════ */
  (function ablegen() {
    const p = E('griff-panel');
    const feld = E('griff-ablage');
    if (!p || !feld) return;

    const hat = (e) => {
      const arten = e.dataTransfer && e.dataTransfer.types;
      return !!arten && Array.prototype.includes.call(arten, 'Files');
    };

    p.addEventListener('dragover', (e) => {
      if (!hat(e) || !leisteOffen()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      feld.classList.add('drueber');
    });

    p.addEventListener('dragleave', (e) => {
      if (e.target === p || !p.contains(e.relatedTarget)) feld.classList.remove('drueber');
    });

    p.addEventListener('drop', async (e) => {
      if (!hat(e) || !leisteOffen()) return;
      e.preventDefault();
      e.stopPropagation();
      feld.classList.remove('drueber');
      if (!api()) return;

      const pfade = [];
      for (const f of Array.from(e.dataTransfer.files || [])) {
        const p2 = api().pfadVon(f);
        if (p2) pfade.push(p2);
      }
      if (!pfade.length) return;

      /* Nur die erste: nach jeder wird nach dem Namen gefragt, und drei
         Fenster hintereinander für einen Zug wären eine Zumutung. */
      const angebote = await api().abgelegt(pfade.slice(0, 1));
      if (angebote && angebote.length) await frageUndUebernimm(angebote[0]);
      else toast(txt('griffKeineAnzeige', 'Diese Datei lässt sich hier nicht anzeigen.'), true);
    });
  })();

  /* ══════════════════════════════════════════════════════════════════
     ANSCHLÜSSE
     ══════════════════════════════════════════════════════════════════ */
  E('btn-griff')?.addEventListener('click', () => setzeLeiste(!leisteOffen()));
  E('griff-panel-close')?.addEventListener('click', () => setzeLeiste(false));
  E('griff-view-close')?.addEventListener('click', () => schliesse());
  E('griff-waehlen')?.addEventListener('click', () => waehleAus());

  E('griff-verstecken')?.addEventListener('click', async () => {
    if (!api()) return;
    const umgestellt = await ueberBruecke('Ausblenden',
      () => api().verstecken(heftId(), !_stand.versteckt));
    if (!umgestellt) return;
    standAnnehmen(umgestellt);
    if (_stand.versteckt) schliesse();
    zeichne();
    nachLayout();
  });

  E('griff-view-body')?.addEventListener('scroll', () => {
    clearTimeout(_rollTimer);
    _rollTimer = setTimeout(merkeStelle, 400);
  }, { passive: true });

  /* ══════════════════════════════════════════════════════════════════
     AUSSCHNEIDEN — EIN STÜCK DER UNTERLAGE INS HEFT

     >>> Die Geste <<<
     Lange auf eine Seite drücken (480 ms, wie im Chat). Dann legt sich
     ein Schleier über die Unterlage und die Seite unter dem Finger hebt
     sich ab. Von dort zwei Wege:

       ziehen           ein Rechteck aufziehen; loslassen legt den
                        Ausschnitt als Objekt auf die Heftseite
       gleich loslassen die GANZE Seite – dann die Frage, ob als Objekt
                        oder als neue Seite

     Ein Ausschnitt wird nie eine eigene Seite: ein Stück Tafelbild ist
     etwas, das man neben seine Notiz legt, kein Blatt.

     >>> Warum der Schleier <<<
     Ohne ihn wüsste niemand, ob das Ziehen jetzt die Seite verschiebt
     oder auswählt – beides ist ein Finger auf demselben Blatt.

     >>> Warum nicht aus der angezeigten Fläche geschnitten wird <<<
     Die ist auf MAX_LEINWAND gedeckelt und in Spaltenbreite gezeichnet.
     Ein Ausschnitt daraus wäre eine Briefmarke, sobald man ihn im Heft
     grösser zieht. Stattdessen zeichnet pdf.js das Stück NEU, in der
     Auflösung, die es im Heft braucht (schneideAusPdf).
     ══════════════════════════════════════════════════════════════════ */

  // Dieselben Werte wie beim langen Drücken im Chat (ui/chat.js)
  const HALTEN_MS = 480;
  const HALTEN_ZITTERN = 10;
  // Darunter war es kein Rechteck, sondern ein Tippen mit zittriger Hand
  const SCHNITT_MIN = 16;
  /* Wie breit das gerechnete Bild wird. Dreifach, damit es im Heft auch
     vergrössert und im Ausdruck scharf bleibt – gedeckelt, weil ein
     Ausschnitt sonst grösser würde als die Seite, aus der er stammt. */
  const SCHNITT_FEINHEIT = 3;
  const SCHNITT_MAX_PUNKTE = 2400;

  let _schnitt = null;   // { blatt, satz, zeiger, x0, y0, x1, y1, rahmen, zieht }

  const schneidetGerade = () => !!_schnitt;

  /** Die Ecken in Koordinaten des Blattes, immer von links oben. */
  function schnittRechteck() {
    if (!_schnitt) return null;
    const x = Math.min(_schnitt.x0, _schnitt.x1), y = Math.min(_schnitt.y0, _schnitt.y1);
    return {
      x, y,
      w: Math.abs(_schnitt.x1 - _schnitt.x0),
      h: Math.abs(_schnitt.y1 - _schnitt.y0)
    };
  }

  function schnittZeichnen() {
    const r = schnittRechteck();
    if (!_schnitt || !r) return;
    const blattRand = _schnitt.blatt.getBoundingClientRect();
    const satzRand = _schnitt.satz.getBoundingClientRect();
    const rahmen = _schnitt.rahmen;
    rahmen.style.left = (blattRand.left - satzRand.left + r.x) + 'px';
    rahmen.style.top = (blattRand.top - satzRand.top + r.y) + 'px';
    rahmen.style.width = r.w + 'px';
    rahmen.style.height = r.h + 'px';
    rahmen.hidden = !_schnitt.zieht;
  }

  function schnittBeginnen(blatt, x, y, zeiger) {
    const satz = blatt.closest('.griff-satz');
    const v = ansicht();
    if (!satz || !v) return;

    const rand = blatt.getBoundingClientRect();
    const rahmen = document.createElement('div');
    rahmen.className = 'griff-schnitt-rahmen';
    rahmen.hidden = true;
    satz.appendChild(rahmen);

    _schnitt = {
      blatt, satz, zeiger, rahmen, zieht: false,
      x0: x - rand.left, y0: y - rand.top,
      x1: x - rand.left, y1: y - rand.top
    };
    v.classList.add('schneidet');
    blatt.classList.add('griff-schnitt-blatt');
    /* Ein kurzer Ruck sagt auf dem Tablett, dass das Halten erkannt
       wurde. Nur nach einer echten Berührung: ohne die lehnt Chromium
       es ab und schreibt eine Warnung in die Konsole. */
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) {
      try { navigator.vibrate(12); } catch (err) { /* egal */ }
    }
  }

  function schnittAbbrechen() {
    if (!_schnitt) return;
    _schnitt.rahmen.remove();
    _schnitt.blatt.classList.remove('griff-schnitt-blatt');
    ansicht()?.classList.remove('schneidet');
    _schnitt = null;
  }

  (function haengeSchneidenAn() {
    const k = kasten();
    if (!k) return;
    let uhr = null, start = null;

    const uhrAus = () => { if (uhr) { clearTimeout(uhr); uhr = null; } start = null; };

    k.addEventListener('pointerdown', (e) => {
      if (!ansichtOffen() || !_fertig || _schnitt) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const blatt = e.target.closest('.griff-seite, .griff-blatt');
      if (!blatt) return;
      uhrAus();
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, blatt };
      uhr = setTimeout(() => {
        uhr = null;
        if (!start) return;
        schnittBeginnen(start.blatt, start.x, start.y, start.id);
        try { k.setPointerCapture(start.id); } catch (err) { /* egal */ }
        start = null;
      }, HALTEN_MS);
    });

    k.addEventListener('pointermove', (e) => {
      /* Vor dem Auslösen zählt jede Bewegung als Schieben – dann war es
         kein Halten, und die Seite soll ganz normal rollen. */
      if (start && e.pointerId === start.id
        && Math.hypot(e.clientX - start.x, e.clientY - start.y) > HALTEN_ZITTERN) uhrAus();

      if (!_schnitt || e.pointerId !== _schnitt.zeiger) return;
      const rand = _schnitt.blatt.getBoundingClientRect();
      _schnitt.x1 = Math.min(rand.width, Math.max(0, e.clientX - rand.left));
      _schnitt.y1 = Math.min(rand.height, Math.max(0, e.clientY - rand.top));
      const r = schnittRechteck();
      if (r.w > HALTEN_ZITTERN || r.h > HALTEN_ZITTERN) _schnitt.zieht = true;
      schnittZeichnen();
    });

    /* Der Finger würde die Seite sonst mitnehmen: welche Richtung ein
       Zug bedeutet, entscheidet der Browser beim Aufsetzen, und da war
       vom Halten noch nichts zu ahnen. Ein spätes touch-action käme zu
       spät, ein preventDefault hier nicht. */
    k.addEventListener('touchmove', (e) => {
      if (_schnitt) e.preventDefault();
    }, { passive: false });

    const fertig = async (e) => {
      if (start && e.pointerId === start.id) uhrAus();
      if (!_schnitt || e.pointerId !== _schnitt.zeiger) return;
      const blatt = _schnitt.blatt;
      const r = schnittRechteck();
      const gezogen = _schnitt.zieht && r.w >= SCHNITT_MIN && r.h >= SCHNITT_MIN;
      schnittAbbrechen();
      try { k.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
      /* Nichts darf hier still danebengehen: wer eine halbe Minute
         lang ein Rechteck aufzieht und dann gar nichts sieht, sucht den
         Fehler bei sich. */
      try {
        await schnittEinfuegen(blatt, gezogen ? r : null, !gezogen);
      } catch (err) {
        console.warn('[Griffbereit] Einfuegen:', (err && err.message) || err);
        toast(txt('griffSchnittFehler', 'Der Ausschnitt liess sich nicht rechnen'), true);
      }
    };

    k.addEventListener('pointerup', fertig);
    k.addEventListener('pointercancel', () => { uhrAus(); schnittAbbrechen(); });

    /* Zwei Finger heissen kneifen. Wer beim Halten den zweiten aufsetzt,
       wollte zoomen – dann tritt das Ausschneiden zurück. */
    k.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) { uhrAus(); schnittAbbrechen(); }
    }, { passive: true });
  })();

  /* ── Das Stück rechnen ──────────────────────────────────────────────
     Aus einem PDF wird NEU gezeichnet, aus einem Bild geschnitten.

     >>> Der Kniff mit transform <<<
     pdf.js zeichnet immer die ganze Seite. Wer nur ein Stück will,
     schiebt die Seite auf der Leinwand so weit nach links oben, dass
     genau dieses Stück darauf zu liegen kommt, und macht die Leinwand
     nur so gross wie das Stück. Das ist etwas anderes als hinterher
     zuzuschneiden: gezeichnet wird in voller Feinheit, nicht
     heruntergerechnet und wieder aufgezogen. */
  async function schneideAusPdf(blatt, r) {
    const satz = blatt.closest('.griff-satz');
    const pdf = satz && satz._pdf;
    if (!pdf) throw new Error('kein PDF');

    const seite = await pdf.getPage(Number(blatt.dataset.nr));
    const roh = seite.getViewport({ scale: 1 });

    // Vom Blatt auf dem Schirm in die Masse des Dokuments
    const jePunkt = roh.width / (blatt.clientWidth || 1);
    const xPt = r ? r.x * jePunkt : 0;
    const yPt = r ? r.y * jePunkt : 0;
    const bPt = r ? r.w * jePunkt : roh.width;
    const hPt = r ? r.h * jePunkt : roh.height;

    /* Die Feinheit richtet sich danach, wie breit das Stück im Heft
       liegen wird – nicht danach, wie gross es hier auf dem Schirm ist. */
    const zielBreite = Math.min(SCHNITT_MAX_PUNKTE,
      Math.round((r ? r.w : blatt.clientWidth) * SCHNITT_FEINHEIT * (window.devicePixelRatio || 1)));
    const skala = zielBreite / bPt;

    const lein = document.createElement('canvas');
    lein.width = Math.max(1, Math.round(bPt * skala));
    lein.height = Math.max(1, Math.round(hPt * skala));
    const ctx = lein.getContext('2d');
    // Weisser Grund: ein PDF zeichnet nur, was daraufsteht
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, lein.width, lein.height);

    await seite.render({
      canvasContext: ctx,
      viewport: seite.getViewport({ scale: skala }),
      transform: [1, 0, 0, 1, -xPt * skala, -yPt * skala]
    }).promise;
    return lein;
  }

  /** Aus einem Bild als Unterlage – da gibt es nichts neu zu zeichnen. */
  function schneideAusBild(blatt, r) {
    const bx = blatt.naturalWidth / (blatt.clientWidth || 1);
    const x = r ? r.x * bx : 0, y = r ? r.y * bx : 0;
    const b = r ? r.w * bx : blatt.naturalWidth;
    const h = r ? r.h * bx : blatt.naturalHeight;

    const lein = document.createElement('canvas');
    lein.width = Math.max(1, Math.round(b));
    lein.height = Math.max(1, Math.round(h));
    lein.getContext('2d').drawImage(blatt, x, y, b, h, 0, 0, lein.width, lein.height);
    return lein;
  }

  /**
   * Aus der Leinwand eine Bildadresse.
   *
   * >>> Warum nicht einfach PNG <<<
   * Ein abfotografiertes Blatt wird als PNG schnell zwei Megabyte, und
   * die liegen danach im Heft und gehen bei jedem Abgleich mit. Als JPEG
   * ist dasselbe ein Zehntel davon und für ein Foto nicht zu
   * unterscheiden. Umgekehrt zerfranst JPEG feine Striche und Schrift.
   *
   * Statt zu raten, welche Sorte vorliegt: PNG rechnen und nur dann auf
   * JPEG ausweichen, wenn es wirklich gross wird. Strichzeichnungen
   * bleiben dabei von selbst PNG – sie werden gar nicht erst gross.
   */
  const SCHNITT_PNG_GRENZE = 600 * 1024;

  function schnittAdresse(lein) {
    const png = lein.toDataURL('image/png');
    if (png.length <= SCHNITT_PNG_GRENZE) return png;
    return lein.toDataURL('image/jpeg', 0.85);
  }

  /* ── Und ins Heft damit ──────────────────────────────────────────────
     Derselbe Weg wie beim Einfügen eines Bildes über die Titelleiste
     (ui/titlebar.js): ein Objekt in page.objects, dann placeObject.

     Ein Ausschnitt wird IMMER ein Objekt. Nur bei der ganzen Seite gibt
     es die Frage, ob sie als Objekt daneben oder als eigenes Blatt ins
     Heft soll. */
  /* So viele Seiten werden im Voraus gezeichnet. Zwei genügen: mehr
     sieht man beim Aufschlagen ohnehin nicht, und jede weitere ist eine
     Leinwand im Speicher für einen Blick, der vielleicht nie kommt. */
  const VORAUS_SEITEN = 2;

  /**
   * Den Stapel einer Unterlage bauen, ohne ihn zu zeigen.
   *
   * Das ist derselbe Weg wie beim Aufschlagen, nur ohne alles, was mit
   * dem Blick zu tun hat: keine Ansicht auf, kein Name in der Kopfzeile,
   * kein Reiter, der sich färbt. Am Ende steht ein fertiger Stapel
   * ausgeblendet neben den anderen – und das nächste Antippen seines
   * Reiters ist ein Einblenden statt eines Ladevorgangs.
   */
  async function ladeStapel(id, laufNr) {
    const d = datei(id);
    if (!d || !api()) return null;

    const satz = satzAnlegen(id);
    if (!satz) return null;
    satz.hidden = true;

    /* Gültig heisst hier: es läuft noch dasselbe Vorladen, und der
       Stapel hängt noch im Kasten. Wer inzwischen das Heft gewechselt
       oder die Datei selbst aufgeschlagen hat, hat beides erledigt. */
    const gueltig = () => laufNr === _vorladeLauf && satz.isConnected;

    let antwort = null;
    try { antwort = await api().lesen(heftId(), id); } catch (err) { antwort = null; }
    if (!gueltig()) return null;
    if (!antwort || !antwort.ok) { raeumeSatz(satz); return null; }

    if (antwort.art === 'pdf') await zeigePdf(antwort.adresse, gueltig, satz);
    else zeigeBild(antwort.bytes, antwort.mime, satz);
    if (!gueltig()) { raeumeSatz(satz); return null; }

    satz._fertig = true;
    await zeichneVoraus(satz, d, gueltig);
    return satz;
  }

  /**
   * Die Seiten zeichnen, die beim Aufschlagen zuerst zu sehen wären.
   *
   * >>> Warum die Breite von Hand ausgerechnet wird <<<
   * Ein ausgeblendeter Stapel hat keine Ausdehnung – clientWidth ist 0,
   * und zeichneSeite käme gar nicht erst zum Zeichnen. Die Breite steht
   * aber fest: es ist die, in der die Unterlage zuletzt dastand.
   *
   * >>> Warum an der gemerkten Stelle <<<
   * Aufgeschlagen wird dort, wo zuletzt aufgehört wurde. Die erste Seite
   * vorzuzeichnen hülfe bei einem Buch, in dem jemand auf Seite 300
   * steht, überhaupt nicht.
   */
  async function zeichneVoraus(satz, d, gueltig) {
    const kaesten = [...satz.querySelectorAll('.griff-seite')];
    if (!kaesten.length) return;

    const spalte = Math.min(grenze(), Math.max(MIN_BREITE, d.breite || VORGABE_BREITE));
    const breite = Math.max(80, Math.round((spalte - 22) * (d.zoom || 1)));

    const erste = Math.max(0, Math.min(kaesten.length - 1,
      Math.round((d.stelle || 0) * (kaesten.length - 1))));
    for (const k of kaesten.slice(erste, erste + VORAUS_SEITEN)) {
      if (!gueltig()) return;
      await zeichneSeite(k, breite);
    }
  }

  /**
   * Die Heftseite, auf die der Ausschnitt soll.
   *
   * Drei Anläufe, vom Genauen zum Verlässlichen:
   *
   *   1. die zuletzt angesehene Seite
   *   2. die oberste, die gerade im Blick steht
   *   3. die erste Seite des offenen Hefts
   *
   * >>> Warum nicht der erste allein <<<
   * S.activePgId steht erst, wenn im Heft einmal gerollt oder getippt
   * wurde (setActivePg, ui/sidebar.js). Wer die App aufmacht und als
   * Erstes etwas aus der Unterlage holt, bekäme sonst „keine Seite
   * offen", obwohl eine vor ihm liegt.
   *
   * >>> Warum auch der zweite nicht genügt <<<
   * Was im Baum steht, muss es im Heft nicht mehr geben – nach einem
   * Wiederherstellen oder einem Abgleich zeigt der Baum für einen
   * Augenblick Seiten, die der Zustand nicht mehr kennt. Dann käme aus
   * getPage nichts zurück, und der Ausschnitt wäre verloren, obwohl das
   * Heft offen daliegt.
   *
   * >>> NICHT window.S <<<
   * Der Zustand steht als const auf oberster Ebene (core/state.js) und
   * landet damit gar nicht am Fenster. Hier stand einmal window.S, und
   * das Einfügen brach jedes Mal still ab.
   */
  function heftSeite() {
    if (typeof getPage !== 'function' || typeof S === 'undefined') return null;

    const direkt = getPage(S.activePgId);
    if (direkt && direkt.page) return direkt;

    const roll = E('pg-scroll');
    if (roll) {
      const oben = roll.getBoundingClientRect().top;
      const naheZuerst = [...roll.querySelectorAll('.j-page')].sort((a, b) =>
        Math.abs(a.getBoundingClientRect().top - oben)
        - Math.abs(b.getBoundingClientRect().top - oben));
      for (const el of naheZuerst) {
        const treffer = getPage(el.dataset.pgid);
        if (treffer && treffer.page) return treffer;
      }
    }

    const nb = (S.notebooks || []).find(n => n.id === S.activeNbId);
    if (!nb) return null;
    const seiten = (typeof visiblePages === 'function' ? visiblePages(nb) : nb.pages) || [];
    return seiten.length ? { nb, page: seiten[0] } : null;
  }

  async function schnittEinfuegen(blatt, r, ganzeSeite) {
    const info = heftSeite();
    if (!info || !info.page) { toast(txt('griffSchnittKeineSeite', 'Keine Heftseite offen'), true); return; }

    /* Ein Ausschnitt wird immer ein Objekt – ein Stück Tafelbild ist
       etwas, das man neben seine Notiz legt, kein Blatt. Gefragt wird nur
       bei der ganzen Seite. */
    let art = 'img';
    if (ganzeSeite && typeof showInsertChoice === 'function') {
      art = await showInsertChoice();
      if (!art) return;          // weggeklickt
    }

    let lein;
    try {
      lein = blatt.tagName === 'IMG' ? schneideAusBild(blatt, r) : await schneideAusPdf(blatt, r);
    } catch (err) {
      console.warn('[Griffbereit] Ausschnitt:', err && err.message);
      toast(txt('griffSchnittFehler', 'Der Ausschnitt liess sich nicht rechnen'), true);
      return;
    }
    const adresse = schnittAdresse(lein);
    const name = (datei(_offen) || {}).name || '';

    if (art === 'page') {
      /* getPage kennt nur Heft und Seite. Welcher Ausschnitt gerade
         gezeigt wird, steht am Heft (activeSection) – null heisst
         ‚alle Seiten‘ und ist der Normalfall. */
      const abschnitt = (typeof activeSection === 'function') ? activeSection(info.nb) : null;
      const pg = makeImagePage(adresse, lein.width, lein.height);
      insertPageInto(info.nb, abschnitt, pg, pageNumberOf(info.nb, info.page.id));
      if (typeof renderSideTree === 'function') renderSideTree();
      if (typeof openSection === 'function') openSection(abschnitt, pg.id);
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
      toast(txt('griffSchnittSeite', 'Als Seite eingefügt'));
      return;
    }

    /* Objekte liegen in Seitenkoordinaten. Ein Ausschnitt kommt auf gut
       die halbe Blattbreite – gross genug zum Lesen, klein genug, dass
       daneben noch etwas hinpasst –, und wenn er dann zu hoch wäre,
       bestimmt die Höhe das Mass. */
    const seitenBreite = info.page.w || CFG.PAGE_W;
    const seitenHoehe = info.page.h || CFG.PAGE_H;
    let ow = Math.round(seitenBreite * 0.55);
    let oh = Math.round(ow * (lein.height / (lein.width || 1)));
    if (oh > seitenHoehe * 0.7) {
      oh = Math.round(seitenHoehe * 0.7);
      ow = Math.round(oh * (lein.width / (lein.height || 1)));
    }

    /* Mittig – aber jedes weitere ein Stück versetzt, sonst läge das
       zweite genau auf dem ersten und sähe aus, als wäre nichts
       geschehen. */
    const wieviele = (info.page.objects || []).length;
    const versatz = (wieviele % 5) * 18;

    const obj = {
      id: uid(), kind: 'image', src: adresse, name,
      x: Math.max(8, Math.round((seitenBreite - ow) / 2) + versatz),
      y: Math.max(8, Math.round((seitenHoehe - oh) / 2) + versatz),
      w: ow, h: oh, rot: 0
    };
    if (typeof pushPageHistory === 'function') pushPageHistory(info.page);
    if (!info.page.objects) info.page.objects = [];
    info.page.objects.push(obj);

    const ebene = E('pg-scroll')?.querySelector('[data-pgid="' + CSS.escape(String(info.page.id)) + '"]')
      ?.querySelector('.j-objects');
    if (ebene && typeof placeObject === 'function') placeObject(ebene, obj, info.page);
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    toast(ganzeSeite ? txt('griffSchnittSeiteObjekt', 'Seite eingefügt')
      : txt('griffSchnittFertig', 'Ausschnitt eingefügt'));
  }

  /* Escape macht zu – aber nur, wenn nicht ohnehin ein Fenster darüber
     steht. Sonst hätte ein Abbrechen im Namensfeld zwei Wirkungen. */
  const fensterOffen = () => [...document.querySelectorAll('.overlay')]
    .some(o => o.style.display && o.style.display !== 'none');

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || fensterOffen()) return;
    if (schneidetGerade()) { schnittAbbrechen(); return; }
    if (leisteOffen()) { setzeLeiste(false); return; }
    if (ansichtOffen()) schliesse();
  });

  /* Das Fenster wird schmaler: die halbe Breite ist eine andere geworden,
     und die Seiten müssen in der neuen Breite noch einmal entstehen. */
  window.addEventListener('resize', () => {
    /* Der Rollbalken kann mit dem Fenster kommen und gehen – dann sitzt
       das Rechteck daneben falsch (messeRollbalken). */
    messeRollbalken();
    if (!ansichtOffen()) return;
    const inner = ansicht().querySelector('.griff-view-inner');
    setzeBreite(inner.getBoundingClientRect().width);
    clearTimeout(_breiteTimer);
    _breiteTimer = setTimeout(zeichneSichtbareNeu, 250);
  }, { passive: true });

  /* Vor dem Beenden nachholen, was der Verzögerer noch nicht geschrieben
     hat – sonst steht man beim nächsten Start wieder auf Seite 1. */
  window.addEventListener('beforeunload', () => { clearTimeout(_rollTimer); merkeStelle(); });

  /* Welches Heft zuletzt geholt wurde. Daran erkennt starte(), dass ein
     anderes offen ist und alles Bisherige weg muss. */
  let _heft = null;

  /**
   * Die Unterlagen des offenen Hefts holen und an die Kante stellen.
   *
   * Wird auch bei jedem Heftwechsel gerufen (app.js, openNotebook). Dann
   * fliegt weg, was vom vorigen Heft noch dasteht – die Stapel gehören
   * dorthin, nicht hierher, und ein Buch aus dem anderen Heft im
   * Speicher zu behalten hätte niemandem genützt.
   */
  async function starte() {
    if (!api()) return;
    const heft = heftId();
    const gewechselt = _heft !== null && _heft !== heft;
    _heft = heft;

    if (gewechselt) {
      schliesse();
      const k = kasten();
      if (k) for (const satz of k.querySelectorAll('.griff-satz')) raeumeSatz(satz);
      _fertig = false;
    }

    const meins = _standLauf;
    let antwort;
    try {
      antwort = await api().liste(heft);
    } catch (err) {
      console.warn('[Griffbereit] Liste nicht lesbar:', err?.message || err);
      return;
    }
    // Inzwischen hat jemand anders den Stand gesetzt – der gilt
    if (meins !== _standLauf) return;
    standAnnehmen(antwort);
    zeichne();
    vorladen();
  }

  /* ══════════════════════════════════════════════════════════════════
     IM VORAUS LADEN

     >>> Warum <<<
     Das erste Aufschlagen eines Buchs dauert Sekunden: Katalog holen,
     Seiten vermessen, das Sichtbare zeichnen. Diese Sekunden fallen
     genau dann an, wenn jemand etwas nachschlagen will – also im
     denkbar ungünstigsten Moment. Sie lassen sich vorziehen: das Heft
     ist offen, die Unterlagen dazu stehen fest, und die Zeit danach
     verbringt der Rechner ohnehin mit Warten.

     >>> Wann <<<
     Nicht sofort. Beim Aufschlagen eines Hefts zeichnet die App ihre
     eigenen Seiten, und ein Buch daneben nähme ihr dabei die Luft. Also
     erst, wenn es still geworden ist – und dann eine nach der anderen,
     nicht alle zugleich.

     >>> In welcher Reihenfolge <<<
     Die zuletzt benutzte zuerst. Wer drei Unterlagen hat, greift
     meistens wieder zu der, die er gerade zugemacht hat.

     >>> Was dabei NICHT geschieht <<<
     Aufgeschlagen wird nichts. Der Stapel entsteht ausgeblendet neben
     den anderen; zu sehen ist er erst, wenn jemand seinen Reiter
     antippt – und dann sofort.
     ══════════════════════════════════════════════════════════════════ */

  // So lange bleibt es nach dem Heftwechsel in Ruhe
  const VORLAUF_MS = 1200;
  let _vorladeUhr = null;
  let _vorladeLauf = 0;

  function vorladen() {
    if (_vorladeUhr) { clearTimeout(_vorladeUhr); _vorladeUhr = null; }
    const lauf = ++_vorladeLauf;
    if (_stand.versteckt || !_stand.dateien.length) return;

    _vorladeUhr = setTimeout(async () => {
      _vorladeUhr = null;
      /* Die zuletzt benutzte zuerst; wer noch nie offen war, kommt
         danach in der Reihenfolge der Liste. */
      const reihe = _stand.dateien.slice()
        .sort((a, b) => (b.zuletzt || 0) - (a.zuletzt || 0));

      for (const d of reihe) {
        // Heft gewechselt, Datei weg oder gerade selbst aufgeschlagen
        if (lauf !== _vorladeLauf) return;
        if (!d.da || satzVon(d.id)) continue;
        try {
          await ladeStapel(d.id, lauf);
        } catch (err) {
          console.warn('[Griffbereit] Vorladen:', err?.message || err);
        }
      }
    }, VORLAUF_MS);
  }

  window.addEventListener('language-changed', zeichne);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', starte);
  } else {
    starte();
  }

  window.Griffbereit = { neuLaden: starte, schliessen: schliesse };
})();
