'use strict';

/* ══════════════════════════════════════════════════════════════════════
   HILFE – DAS FENSTER UND DIE EINMALIGEN HINWEISE

   Zwei Wege zu denselben Texten:

     · Das Fenster hinter dem „?" in der Titelleiste. Links die Themen,
       rechts der Text – wer etwas nachschlagen will, findet hier alles.
     · Der einmalige Hinweis, der beim ERSTEN Öffnen einer Funktion von
       selbst kommt und danach nie wieder. Er sagt in zwei Sätzen, worum
       es geht, und führt über „Mehr dazu" ins Fenster.

   >>> Warum die Schaubilder aus HTML sind und nicht aus SVG <<<
   In ihnen steht Text – „Das Heft", „Nur lesen", die Papiernamen –, und
   der muss durch t() gehen wie jeder andere. In einer SVG-Grafik wäre er
   fest eingebaut und stünde in jeder Sprache auf Deutsch da. Als
   gewöhnliche Elemente lassen sie sich beim Sprachwechsel einfach neu
   zeichnen.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const ov = E('ov-hilfe');
  const themenEl = E('hilfe-themen');
  const inhaltEl = E('hilfe-inhalt');
  const hinweisOv = E('ov-ersthinweis');
  if (!ov || !themenEl || !inhaltEl) return;

  let offenesThema = HILFE_THEMEN[0].id;

  function neu(tag, klasse, text) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE SCHAUBILDER

     Eines je Thema, das sich mit Worten allein nicht erklären lässt.
     Kein Bild um des Bildes willen: die vier hier zeigen jeweils genau
     die Stelle, an der sonst jemand hängenbleibt.
     ══════════════════════════════════════════════════════════════════ */

  /* Abschnitte: dass die Seitenzahlen beim Filtern STEHENBLEIBEN, ist
     der ganze Unterschied zwischen einem Etikett und einem Kapitel. */
  function bildAbschnitte() {
    const GOLD = '#c8a96e', BLAU = '#5b8fd4';
    const marken = { 2: GOLD, 4: BLAU, 5: GOLD };

    const box = neu('div', 'hilfe-bild');

    const reiheAlle = neu('div', 'hb-zeile');
    reiheAlle.appendChild(neu('span', 'hb-mark', t('hilfeBildHeft')));
    const alle = neu('div', 'hb-seiten');
    for (let i = 1; i <= 6; i++) {
      const s = neu('span', 'hb-seite', String(i));
      if (marken[i]) {
        s.classList.add('hb-getaggt');
        s.style.borderBottomColor = marken[i];
      }
      alle.appendChild(s);
    }
    reiheAlle.appendChild(alle);
    box.appendChild(reiheAlle);

    const legende = neu('div', 'hb-legende');
    [[GOLD, t('hilfeBildFormeln')], [BLAU, t('hilfeBildUebungen')]].forEach(function (paar) {
      const l = neu('span', 'hb-leg');
      const punkt = neu('span', 'hb-leg-punkt');
      punkt.style.background = paar[0];
      l.appendChild(punkt);
      l.appendChild(neu('span', null, paar[1]));
      legende.appendChild(l);
    });
    box.appendChild(legende);

    const reiheFilter = neu('div', 'hb-zeile');
    reiheFilter.appendChild(neu('span', 'hb-mark', t('hilfeBildAngeklickt')));
    const gefiltert = neu('div', 'hb-seiten');
    [2, 5].forEach(function (i) {
      const s = neu('span', 'hb-seite hb-getaggt', String(i));
      s.style.borderBottomColor = GOLD;
      gefiltert.appendChild(s);
    });
    reiheFilter.appendChild(gefiltert);
    box.appendChild(reiheFilter);

    box.appendChild(neu('p', 'hb-unter', t('hilfeBildAbschnitteUnter')));
    return box;
  }

  /* Papier: drei Ebenen, und die nächstgelegene gewinnt. */
  function bildPapier() {
    const box = neu('div', 'hilfe-bild');
    const kette = neu('div', 'hb-kette');

    const stufen = [
      [t('hilfeBildPapierHeft'), t('bgRuled')],
      [t('hilfeBildPapierAbschnitt'), t('bgGrid')],
      [t('hilfeBildPapierSeite'), t('bgBlank')]
    ];

    stufen.forEach(function (stufeDaten, i) {
      if (i) kette.appendChild(neu('span', 'hb-pfeil', '→'));
      const letzte = (i === stufen.length - 1);
      const stufe = neu('div', 'hb-stufe' + (letzte ? ' hb-stufe-gilt' : ''));
      stufe.appendChild(neu('span', 'hb-stufe-wo', stufeDaten[0]));
      stufe.appendChild(neu('span', 'hb-stufe-was', stufeDaten[1]));
      kette.appendChild(stufe);
    });

    box.appendChild(kette);
    box.appendChild(neu('p', 'hb-unter', t('hilfeBildPapierUnter')));
    return box;
  }

  /* Die Farben am Sync-Knopf. Sie stehen nirgends sonst geschrieben –
     die Farbe IST die Auskunft (ui/syncPanel.js). */
  function bildFarben() {
    const box = neu('div', 'hilfe-bild');
    const liste = neu('div', 'hb-farben');

    [
      ['var(--sync-ok)', 'hilfeFarbeGruen', 'hilfeFarbeGruenWas'],
      ['var(--sync-warn)', 'hilfeFarbeOrange', 'hilfeFarbeOrangeWas'],
      ['var(--sync-wait)', 'hilfeFarbeBlau', 'hilfeFarbeBlauWas']
    ].forEach(function (zeileDaten) {
      const zeile = neu('div', 'hb-farbe');
      const punkt = neu('span', 'hb-farbe-punkt');
      punkt.style.background = zeileDaten[0];
      zeile.appendChild(punkt);
      zeile.appendChild(neu('span', 'hb-farbe-name', t(zeileDaten[1])));
      zeile.appendChild(neu('span', 'hb-farbe-was', t(zeileDaten[2])));
      liste.appendChild(zeile);
    });

    box.appendChild(liste);
    return box;
  }

  /* Wer darf was? Die Rolle entscheidet, ob der Stift überhaupt etwas
     tut – geprüft an S.readOnly (ui/sharedDocs.js). */
  function bildRollen() {
    const box = neu('div', 'hilfe-bild');
    const tab = neu('div', 'hb-rollen');

    const kopf = neu('div', 'hb-r-zeile hb-r-kopf');
    kopf.appendChild(neu('span', 'hb-r-was', ''));
    kopf.appendChild(neu('span', 'hb-r-spalte', t('roleEdit')));
    kopf.appendChild(neu('span', 'hb-r-spalte', t('roleView')));
    tab.appendChild(kopf);

    /* Der Chat steht bewusst mit drin: er ist neben dem Lesen das
       einzige, was auch der Leser darf – und genau das vermutet
       niemand von selbst. */
    [
      ['hilfeRolleLesen', true, true],
      ['hilfeRolleSchreiben', true, false],
      ['hilfeRolleKommentieren', true, false],
      ['hilfeRolleChat', true, true]
    ].forEach(function (zeileDaten) {
      const zeile = neu('div', 'hb-r-zeile');
      zeile.appendChild(neu('span', 'hb-r-was', t(zeileDaten[0])));
      [zeileDaten[1], zeileDaten[2]].forEach(function (darf) {
        zeile.appendChild(neu('span', 'hb-r-spalte ' + (darf ? 'hb-ja' : 'hb-nein'), darf ? '✓' : '–'));
      });
      tab.appendChild(zeile);
    });

    box.appendChild(tab);
    return box;
  }

  const BILDER = {
    abschnitte: bildAbschnitte,
    papier: bildPapier,
    farben: bildFarben,
    rollen: bildRollen
  };

  /* ══════════════════════════════════════════════════════════════════
     DAS FENSTER
     ══════════════════════════════════════════════════════════════════ */

  function zeichneThemen() {
    themenEl.innerHTML = '';
    HILFE_THEMEN.forEach(function (thema) {
      const knopf = neu('button', 'hilfe-thema' + (thema.id === offenesThema ? ' aktiv' : ''), t(thema.titel));
      knopf.onclick = function () {
        offenesThema = thema.id;
        zeichneThemen();
        zeichneInhalt();
      };
      themenEl.appendChild(knopf);
    });
  }

  function zeichneInhalt() {
    const thema = hilfeThema(offenesThema);
    inhaltEl.innerHTML = '';
    inhaltEl.scrollTop = 0;
    inhaltEl.appendChild(neu('h4', 'hilfe-h', t(thema.titel)));

    thema.absaetze.forEach(function (teil) {
      if (typeof teil === 'string') {
        inhaltEl.appendChild(neu('p', 'hilfe-p', t(teil)));
        return;
      }
      if (teil.merk) {
        inhaltEl.appendChild(neu('p', 'hilfe-merk', t(teil.merk)));
        return;
      }
      if (teil.liste) {
        const ul = neu('ul', 'hilfe-liste');
        teil.liste.forEach(function (k) { ul.appendChild(neu('li', null, t(k))); });
        inhaltEl.appendChild(ul);
        return;
      }
      if (teil.bild && BILDER[teil.bild]) {
        inhaltEl.appendChild(BILDER[teil.bild]());
      }
    });
  }

  function oeffneHilfe(themaId) {
    const kennt = HILFE_THEMEN.some(function (th) { return th.id === themaId; });
    if (themaId && kennt) offenesThema = themaId;
    zeichneThemen();
    zeichneInhalt();
    ov.style.display = 'flex';
    // Einmal offen gewesen: der Punkt am Knopf hat seine Arbeit getan.
    hinweisMerken('hilfeEntdeckt').then(setzePunkt);
  }

  function schliesseHilfe() {
    ov.style.display = 'none';
  }

  E('btn-hilfe') && E('btn-hilfe').addEventListener('click', function () { oeffneHilfe(null); });
  E('hilfe-close') && E('hilfe-close').addEventListener('click', schliesseHilfe);
  ov.addEventListener('click', function (e) { if (e.target === ov) schliesseHilfe(); });

  /* ── Der Punkt am Fragezeichen ────────────────────────────────────
     Er sagt nur: es gibt hier etwas. Nach dem ersten Öffnen ist er weg
     und kommt nie wieder – ein Zeichen, das man nicht loswird, ist eine
     Aufforderung und keine Auskunft.

     Gesetzt wird er nachträglich aus core/init.js: beim Laden dieser
     Datei stehen die Einstellungen noch nicht, und ohne sie wäre die
     Antwort immer „schon gesehen". */
  function setzePunkt() {
    const punkt = E('hilfe-punkt');
    if (!punkt) return;
    punkt.style.display = hinweisGesehen('hilfeEntdeckt') ? 'none' : '';
  }
  window.hilfePunktPruefen = setzePunkt;

  /* ══════════════════════════════════════════════════════════════════
     DER EINMALIGE HINWEIS

     Aufgerufen aus der Funktion, um die es geht – dort und nicht hier
     steht, wann sie zum ersten Mal geöffnet wird.

     Er wird SOFORT gemerkt, nicht erst beim Wegklicken: wer ihn mit Esc
     schließt oder das Fenster daneben zumacht, hat ihn trotzdem gesehen,
     und ein zweites Mal wäre lästig.
     ══════════════════════════════════════════════════════════════════ */

  async function zeigeErsthinweis(id) {
    const hinweis = HILFE_HINWEISE[id];
    if (!hinweis || !hinweisOv) return;
    if (hinweisGesehen(id)) return;

    await hinweisMerken(id);

    E('hinweis-titel').textContent = t(hinweis.titel);
    const textEl = E('hinweis-text');
    textEl.innerHTML = '';
    hinweis.text.forEach(function (k) { textEl.appendChild(neu('p', 'hilfe-p', t(k))); });

    const mehr = E('hinweis-mehr');
    mehr.style.display = hinweis.thema ? '' : 'none';
    mehr.onclick = function () {
      hinweisOv.style.display = 'none';
      oeffneHilfe(hinweis.thema);
    };

    hinweisOv.style.display = 'flex';
    setzePunkt();
  }

  E('hinweis-ok') && E('hinweis-ok').addEventListener('click', function () {
    hinweisOv.style.display = 'none';
  });
  hinweisOv && hinweisOv.addEventListener('click', function (e) {
    if (e.target === hinweisOv) hinweisOv.style.display = 'none';
  });

  /* Esc schließt beide. Der allgemeine Esc-Handler in ui/titlebar.js
     räumt nur die Auswahl weg und kennt diese Fenster nicht. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (hinweisOv && hinweisOv.style.display === 'flex') {
      hinweisOv.style.display = 'none';
      return;
    }
    if (ov.style.display === 'flex') schliesseHilfe();
  });

  /* Nach einem Sprachwechsel stünde im Fenster noch die alte Sprache:
     die Texte kommen aus t() und nicht aus data-i18n, applyTranslations()
     sieht sie also nicht. */
  window.addEventListener('language-changed', function () {
    if (ov.style.display === 'flex') {
      zeichneThemen();
      zeichneInhalt();
    }
  });

  window.oeffneHilfe = oeffneHilfe;
  window.zeigeErsthinweis = zeigeErsthinweis;
})();
