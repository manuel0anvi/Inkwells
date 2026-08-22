'use strict';

/* ══════════════════════════════════════════════════════════════════════
   MELDEN — die Oberfläche

   Zwei Wege hinein:

     · aus der Anwesenheitsliste einer Zusammenarbeit (ui/collab.js,
       zeigeLeute) – dort steht, wer gerade mitschreibt
     · aus dem Menü an einer fremden Chatzeile (ui/chat.js)

   Und einer heraus: der Besitzer eines Dokuments bekommt beim Öffnen der
   App gesagt, dass etwas vorliegt, und kann die Person aus seiner
   Freigabe nehmen.

   >>> Warum die Meldung niemanden hinauswirft <<<
   Weil sie sonst eine Waffe wäre. In einem Dokument mit zwei Leuten
   könnte jeder den anderen mit einem Druck entfernen, und wer zuerst
   meldet, gewinnt. Hinauswerfen darf deshalb nur, wem das Dokument
   gehört – das ist ohnehin schon so (ui/share.js, removeMember). Die
   Meldung sagt ihm bloss, dass es etwas zu entscheiden gibt.

   Die Verwaltung bekommt sie ebenfalls und kann darüber hinaus sperren
   (website/admin). Was gilt, steht in core/melden.js.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const E = (id) => document.getElementById(id);
  const T = (schluessel, rueckfall) =>
    (typeof t === 'function' ? (t(schluessel) || rueckfall) : rueckfall);

  /* Wen wir gerade melden. Steht hier und nicht im Formular, weil das
     Formular nur Grund und Notiz trägt – alles Übrige weiss der Aufrufer. */
  let ziel = null;

  /* ══════════════════════════════════════════════════════════════════
     DER DIALOG
     ══════════════════════════════════════════════════════════════════ */

  function schliesse() {
    const ov = E('ov-melden');
    if (ov) ov.style.display = 'none';
    ziel = null;
  }

  function zaehlerStellen() {
    const feld = E('melden-notiz');
    const zaehler = E('melden-zaehler');
    if (!feld || !zaehler) return;
    const uebrig = 300 - (feld.value || '').length;
    zaehler.textContent = T('meldenZeichenUebrig', '{n} Zeichen übrig').replace('{n}', uebrig);
  }

  /**
   * Den Dialog aufmachen.
   *
   * @param {{email: string, name?: string}} person
   */
  function oeffne(person) {
    const ov = E('ov-melden');
    if (!ov) return;

    const email = String((person && person.email) || '').trim().toLowerCase();
    if (!email) {
      melde(T('meldenOhneAdresse', 'Von dieser Person ist keine Adresse bekannt – sie lässt sich nicht melden.'));
      return;
    }

    const offen = (window.Collab && window.Collab.offenesDokument)
      ? window.Collab.offenesDokument() : null;
    if (!offen) {
      melde(T('meldenNurInZusammenarbeit', 'Melden geht nur aus einem geteilten Dokument heraus.'));
      return;
    }

    const ich = window.InkwellsShare && window.InkwellsShare.currentIdentity
      ? window.InkwellsShare.currentIdentity() : null;
    if (!ich || !ich.email) {
      melde(T('meldenNurAngemeldet', 'Zum Melden musst du angemeldet sein.'));
      return;
    }
    if (String(ich.email).toLowerCase() === email) {
      melde(T('meldenNichtSelbst', 'Sich selbst kann man nicht melden.'));
      return;
    }

    ziel = {
      gemeldetEmail: email,
      gemeldetName: String((person && person.name) || ''),
      docId: offen.docId,
      ownerUid: offen.ownerUid,
      docTitel: aktuellerHeftName()
    };

    const wen = E('melden-wen');
    if (wen) {
      const anzeige = ziel.gemeldetName || email;
      wen.textContent = T('meldenWen', 'Es geht um {n}.').replace('{n}', anzeige);
    }

    // Immer frisch: ein alter Grund und eine alte Notiz gehören nicht
    // zur nächsten Meldung
    const ersterGrund = document.querySelector('#melden-gruende input[value="beleidigung"]');
    if (ersterGrund) ersterGrund.checked = true;
    const notiz = E('melden-notiz');
    if (notiz) notiz.value = '';
    zaehlerStellen();

    ov.style.display = 'flex';
  }

  function aktuellerHeftName() {
    try {
      const nb = (S.notebooks || []).find(n => n.id === S.activeNbId);
      return (nb && nb.name) || '';
    } catch (err) { return ''; }
  }

  function melde(text) {
    if (typeof toast === 'function') toast(text);
    else console.log('[Melden]', text);
  }

  async function abschicken() {
    if (!ziel) { schliesse(); return; }

    const gewaehlt = document.querySelector('#melden-gruende input[name="melden-grund"]:checked');
    const grund = gewaehlt ? gewaehlt.value : '';
    const notiz = ((E('melden-notiz') || {}).value || '').trim();

    const knopf = E('melden-ok');
    if (knopf) knopf.disabled = true;

    const S_ = window.InkwellsShare;
    const antwort = (S_ && S_.meldeNutzer)
      ? await S_.meldeNutzer({ ...ziel, grund, notiz })
      : { ok: false, fehler: 'nichtGespeichert' };

    if (knopf) knopf.disabled = false;

    if (antwort.ok) {
      schliesse();
      melde(T('meldenDanke', 'Danke. Die Meldung ist angekommen.'));
      return;
    }

    /* Die Kennungen kommen aus core/melden.js. Jede bekommt hier ihren
       Satz; eine unbekannte fällt auf den allgemeinen zurück, damit ein
       neuer Fehlerfall nicht als leerer Hinweis erscheint. */
    const saetze = {
      nichtAngemeldet: T('meldenNurAngemeldet', 'Zum Melden musst du angemeldet sein.'),
      keinEmpfaenger:  T('meldenOhneAdresse', 'Von dieser Person ist keine Adresse bekannt – sie lässt sich nicht melden.'),
      selbst:          T('meldenNichtSelbst', 'Sich selbst kann man nicht melden.'),
      keinGrund:       T('meldenOhneGrund', 'Bitte einen Grund auswählen.'),
      keinDokument:    T('meldenNurInZusammenarbeit', 'Melden geht nur aus einem geteilten Dokument heraus.'),
      notizZuLang:     T('meldenNotizZuLang', 'Der Text ist zu lang.')
    };
    melde(saetze[antwort.fehler]
      || T('meldenFehler', 'Die Meldung ließ sich nicht abschicken. Später noch einmal versuchen.'));
  }

  E('melden-abbruch')?.addEventListener('click', schliesse);
  E('melden-ok')?.addEventListener('click', abschicken);
  E('melden-notiz')?.addEventListener('input', zaehlerStellen);
  E('ov-melden')?.addEventListener('pointerdown', (e) => {
    if (e.target === E('ov-melden')) schliesse();
  });

  /* ══════════════════════════════════════════════════════════════════
     WAS DER BESITZER SIEHT

     Beim Start wird einmal nachgesehen, ob zu einem der eigenen
     Dokumente etwas vorliegt. Wenn ja, geht das Fenster auf – nicht als
     Hinweis am Rand, den man wegklickt, sondern als etwas, das eine
     Entscheidung will.

     Der Name des Gemeldeten steht darin, weil der Besitzer ihn braucht,
     um ihn aus der Freigabe zu nehmen. Die Adresse des MELDENDEN steht
     NICHT darin: sonst wüsste jeder Besitzer sofort, wer ihn oder seinen
     Freund gemeldet hat, und melden würde niemand mehr.
     ══════════════════════════════════════════════════════════════════ */

  function grundText(grund) {
    const namen = {
      beleidigung:   T('meldenGrundBeleidigung', 'Beleidigung oder Bedrohung'),
      fremdeInhalte: T('meldenGrundFremdeInhalte', 'Unangemessene Inhalte'),
      zerstoerung:   T('meldenGrundZerstoerung', 'Zerstört die gemeinsame Arbeit'),
      werbung:       T('meldenGrundWerbung', 'Werbung'),
      sonstiges:     T('meldenGrundSonstiges', 'Etwas anderes')
    };
    return namen[grund] || grund;
  }

  /* ══════════════════════════════════════════════════════════════════
     KEIN 1. JANUAR 1970

     `erstellt` wird mit serverTimestamp() gesetzt – der Wert entsteht
     erst beim Server. Der Strom liefert die Meldung aber SOFORT aus,
     noch ohne ihn. new Date(null) ist dann der Beginn der Zeitrechnung,
     und genau der stand im Fenster.

     Fehlt der Zeitstempel, ist die Meldung gerade eben entstanden –
     dann steht das da und keine erfundene Zahl. */
  function datumText(iso) {
    if (!iso) return T('meldungGerade', 'gerade eben');
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return T('meldungGerade', 'gerade eben');
    return d.toLocaleString(undefined,
      { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* Fuer die Sperre: dort ist ein fehlendes Datum etwas anderes als
     „gerade eben", naemlich „unbegrenzt". Der Aufrufer entscheidet. */
  function nurDatum(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  async function zeigeMeldungen(liste) {
    const ov = E('ov-meldungen');
    const box = E('meldungen-liste');
    if (!ov || !box) return;

    /* Steht schon eines offen, kommt das Neue dazu, statt das Alte zu
       ersetzen: sonst verschwaende eine Meldung, die gerade gelesen
       wird, weil im selben Augenblick die naechste eintrifft. */
    if (ov.style.display !== 'flex') box.innerHTML = '';

    /* ── Und nie eine Meldung ueber mich selbst ────────────────────
       Die Regel haelt sie schon zurueck (website/firestore.rules,
       gegenBesitzer). Meldungen aus der Zeit davor tragen den Vermerk
       aber nicht und kaemen durch – dann staende hier "Gemeldet: ich"
       samt Knopf, mich selbst zu verbannen. */
    const S_ = window.InkwellsShare;
    const ich = (S_ && S_.currentIdentity) ? S_.currentIdentity() : null;
    const meine = String((ich && ich.email) || '').trim().toLowerCase();
    if (meine) liste = liste.filter(m => String(m.gemeldetEmail || '').toLowerCase() !== meine);
    if (!liste.length) return;

    for (const m of liste) {
      const karte = document.createElement('div');
      karte.className = 'meldung-karte';

      const kopf = document.createElement('div');
      kopf.className = 'meldung-kopf';
      kopf.textContent = grundText(m.grund);
      karte.appendChild(kopf);

      const wer = document.createElement('div');
      wer.className = 'meldung-wer';
      wer.textContent = T('meldungGegen', 'Gemeldet: {n}')
        .replace('{n}', m.gemeldetName ? (m.gemeldetName + ' · ' + m.gemeldetEmail) : m.gemeldetEmail);
      karte.appendChild(wer);

      /* ══════════════════════════════════════════════════════════
         WER GEMELDET HAT

         Zuerst stand das hier bewusst NICHT: wer den Melder kennt,
         koennte es ihm heimzahlen. Nur ist das eine Sorge fuer ein
         grosses Forum – in einem geteilten Heft sitzen zwei oder drei
         Leute, und wer gemeldet hat, weiss der Besitzer ohnehin nach
         zwei Sekunden Nachdenken. Verschwiegen wurde damit nichts,
         es fehlte nur die Auskunft, die er zum Beurteilen braucht.
         Ausdruecklich so gewuenscht. */
      const von = document.createElement('div');
      von.className = 'meldung-wer';
      von.textContent = T('meldungVon', 'Gemeldet von: {n}').replace('{n}', m.melderEmail || '?');
      karte.appendChild(von);

      const wo = document.createElement('div');
      wo.className = 'meldung-wo';
      wo.textContent = [m.docTitel, datumText(m.erstellt)].filter(Boolean).join(' · ');
      karte.appendChild(wo);

      if (m.notiz) {
        const notiz = document.createElement('div');
        notiz.className = 'meldung-notiz';
        notiz.textContent = m.notiz;
        karte.appendChild(notiz);
      }

      const knoepfe = document.createElement('div');
      knoepfe.className = 'meldung-knoepfe';

      const raus = document.createElement('button');
      raus.className = 'gefaehrlich';
      raus.textContent = T('meldungEntfernen', 'Aus diesem Dokument verbannen');
      raus.title = T('meldungEntfernenHinweis',
        'Nimmt die Freigabe zurück und lässt die Person auch über den Link nicht wieder herein.');
      raus.addEventListener('click', async () => {
        raus.disabled = true;
        const ok = await entferneAusFreigabe(m);
        if (ok) { await abhaken(m, karte, 'verbannt'); }
        else { raus.disabled = false; melde(T('meldungEntfernenFehler', 'Das hat nicht geklappt.')); }
      });
      knoepfe.appendChild(raus);

      const lassen = document.createElement('button');
      lassen.textContent = T('meldungLassen', 'Alles in Ordnung');
      lassen.addEventListener('click', async () => {
        lassen.disabled = true;
        await abhaken(m, karte, 'nichts');
      });
      knoepfe.appendChild(lassen);

      karte.appendChild(knoepfe);
      box.appendChild(karte);
    }

    ov.style.display = 'flex';
  }

  async function entferneAusFreigabe(m) {
    const S_ = window.InkwellsShare;
    if (!S_ || !S_.removeMember) return false;
    try {
      await S_.removeMember(m.docId, m.gemeldetEmail);
      return true;
    } catch (err) {
      console.warn('[Melden] Nicht entfernt:', err.message);
      return false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     WAS DER BESITZER ENTSCHIEDEN HAT, ERFAEHRT AUCH DIE VERWALTUNG

     Vorher wurde die Meldung nur abgehakt. In der Verwaltung stand
     danach „erledigt" – aber nicht, WIE. Ob der Besitzer jemanden
     verbannt oder die Sache für harmlos gehalten hat, ist genau der
     Unterschied, an dem sich entscheidet, ob die Verwaltung noch etwas
     tun muss. Ausdruecklich so gewuenscht.

     @param {'verbannt'|'nichts'} massnahme
     ══════════════════════════════════════════════════════════════════ */
  async function abhaken(m, karte, massnahme) {
    const S_ = window.InkwellsShare;

    /* ══════════════════════════════════════════════════════════════
       EIN FEHLSCHLAG DARF NICHT WIE ERLEDIGT AUSSEHEN

       Hier stand `await hakeMeldungAb(...)` ohne Blick auf das Ergebnis,
       und die Karte verschwand danach in jedem Fall. Weist die Datenbank
       das Schreiben ab – etwa weil die Regeln noch nicht veroeffentlicht
       sind –, war die Meldung damit vom Bildschirm, aber nicht erledigt.
       Beim naechsten Start stand sie wieder da, und niemand wusste warum.

       Jetzt bleibt die Karte stehen, und es steht dabei, was los ist.
       ══════════════════════════════════════════════════════════════ */
    const ok = (S_ && S_.hakeMeldungAb) ? await S_.hakeMeldungAb(m.id, massnahme) : false;
    if (!ok) {
      melde(T('meldungNichtAbgehakt',
        'Das ließ sich nicht speichern. Die Meldung bleibt offen.'));
      for (const knopf of karte ? karte.querySelectorAll('button') : []) knopf.disabled = false;
      return;
    }

    if (karte) karte.remove();
    const box = E('meldungen-liste');
    if (box && !box.children.length) E('ov-meldungen').style.display = 'none';
  }

  E('meldungen-zu')?.addEventListener('click', () => {
    E('ov-meldungen').style.display = 'none';
  });

  /* ══════════════════════════════════════════════════════════════════
     BEIM START EINMAL NACHSEHEN

     Und danach bei jedem Anmeldewechsel: die Meldungen hängen an der
     Firebase-Kennung des Besitzers, und die wechselt beim Anmelden.

     Verzögert, damit es nicht mit dem Postfach um dasselbe Fenster
     streitet. Wer beides bekommt, sieht erst die Ankündigung und dann
     die Meldung – nicht zwei Fenster übereinander.
     ══════════════════════════════════════════════════════════════════ */
  let schonNachgesehen = '';
  let abbestellen = null;
  /* Welche Meldungen schon gezeigt wurden. Ohne das ginge das Fenster bei
     jeder Kleinigkeit wieder auf – der Strom meldet sich auch, wenn sich
     an einer bestehenden Meldung nur das Häkchen ändert. */
  const gezeigt = new Set();

  async function nachsehen() {
    const S_ = window.InkwellsShare;
    if (!S_ || !S_.ladeMeldungenFuerMich) return;

    const ich = S_.currentIdentity ? S_.currentIdentity() : null;
    const kennung = (ich && ich.uid) || '';
    if (!kennung || kennung === schonNachgesehen) return;
    schonNachgesehen = kennung;
    gezeigt.clear();

    /* ══════════════════════════════════════════════════════════════
       ZUHOEREN, NICHT EINMAL NACHSEHEN

       Hier stand eine einzelne Abfrage beim Start. Wer als Besitzer im
       Dokument sass und dort jemanden meldete, bekam davon nichts mit:
       die Meldung lag zwar in der Datenbank, aber nachgesehen wurde
       erst beim naechsten Start. Genau so wurde es gemeldet.

       Jetzt ein Strom. Er liefert sofort den bestehenden Stand mit –
       der Fall „beim Start liegt etwas vor" ist damit derselbe Weg und
       kein zweiter. */
    if (abbestellen) { try { abbestellen(); } catch (e) { } }

    if (!S_.beobachteMeldungenFuerMich) {
      const liste = await S_.ladeMeldungenFuerMich();
      if (liste.length) setTimeout(() => zeigeMeldungen(liste), 2500);
      return;
    }

    abbestellen = S_.beobachteMeldungenFuerMich((liste) => {
      const neu = liste.filter(m => !gezeigt.has(m.id));
      if (!neu.length) return;
      for (const m of neu) gezeigt.add(m.id);
      /* Kurz warten, damit sich das Fenster nicht mit dem Postfach um
         denselben Platz streitet (ui/postfach.js). */
      setTimeout(() => zeigeMeldungen(neu), 1800);
    });
  }

  function anlaufen() {
    nachsehen();
    const S_ = window.InkwellsShare;
    if (S_ && S_.onIdentityChanged) S_.onIdentityChanged(() => nachsehen());
  }

  if (window.InkwellsShare) anlaufen();
  else document.addEventListener('inkwells-share-ready', anlaufen, { once: true });

  /* ══════════════════════════════════════════════════════════════════
     WAS DER GESPERRTE ZU SEHEN BEKOMMT

     Ohne das stünde er vor einem „Missing or insufficient permissions"
     und wüsste nicht, warum sein Heft sich nicht mehr teilen lässt. Die
     Sperre wirkt in den Regeln (website/firestore.rules); hier steht nur
     der Satz dazu.

     Gefragt wird kurz vor der Handlung, nicht auf Vorrat: eine Sperre
     kann zwischendurch ablaufen, und dann soll nichts Altes im Weg
     stehen.
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Der Satz zur laufenden Sperre – oder null, wenn keine gilt.
   *
   * >>> Warum das getrennt von darfIch() steht <<<
   * Weil es zwei Wege gibt, an einer Sperre anzustossen. Der eine ist
   * die Frage vorher: „darf ich das ueberhaupt" – dort will man den Satz
   * ALS Meldung. Der andere ist eine Regel, die eine Anfrage abweist,
   * die schon unterwegs war; dort steht der Satz an der Stelle, wo sonst
   * die Fehlermeldung der Datenbank stuende (ui/sharedDocs.js).
   *
   * Genau dieser zweite Weg fehlte: wer gesperrt war und ein geteiltes
   * Dokument oeffnete, las „Missing or insufficient permissions". Genau
   * so wurde es gemeldet.
   *
   * @param {'neueFreigaben'|'selbstTeilen'|'laufendeRaus'} was
   * @returns {Promise<string|null>}
   */
  async function sperrSatz(was) {
    const S_ = window.InkwellsShare;
    if (!S_ || !S_.ladeMeineSperre || !window.Melden) return null;

    const sperre = await S_.ladeMeineSperre();
    if (!window.Melden.gesperrtFuer(sperre, was, Date.now())) return null;

    const bis = sperre.bis ? nurDatum(sperre.bis) : '';
    const saetze = {
      neueFreigaben: bis
        ? T('sperreBeitretenBis', 'Du kannst bis zum {d} keinen geteilten Dokumenten mehr beitreten.')
        : T('sperreBeitreten', 'Du kannst geteilten Dokumenten zurzeit nicht beitreten.'),
      selbstTeilen: bis
        ? T('sperreTeilenBis', 'Du kannst bis zum {d} nichts freigeben.')
        : T('sperreTeilen', 'Du kannst zurzeit nichts freigeben.'),
      laufendeRaus: bis
        ? T('sperreRausBis', 'Dein Zugang zu geteilten Dokumenten ruht bis zum {d}.')
        : T('sperreRaus', 'Dein Zugang zu geteilten Dokumenten ruht zurzeit.')
    };
    return (saetze[was] || '').replace('{d}', bis)
      + ' ' + T('sperreNachlesen', 'Mehr steht im Postfach.');
  }

  /**
   * Irgendeine laufende Sperre, die erklaeren wuerde, warum eine Anfrage
   * abgewiesen wurde. Der Reihe nach: erst das Naheliegendste.
   *
   * Gedacht fuer den Fall, dass eine REGEL abgewiesen hat und man nur
   * weiss „keine Berechtigung", aber nicht wofuer.
   *
   * @returns {Promise<string|null>}
   */
  async function sperrSatzIrgendeiner() {
    for (const was of ['laufendeRaus', 'neueFreigaben', 'selbstTeilen']) {
      const satz = await sperrSatz(was);
      if (satz) return satz;
    }
    return null;
  }

  /**
   * Darf ich das gerade? Sagt es auch gleich, wenn nicht.
   *
   * @param {'neueFreigaben'|'selbstTeilen'|'laufendeRaus'} was
   * @returns {Promise<boolean>} true = erlaubt
   */
  async function darfIch(was) {
    const satz = await sperrSatz(was);
    if (!satz) return true;
    melde(satz);
    return false;
  }

  window.Melden_ = { oeffne, darfIch, sperrSatz, sperrSatzIrgendeiner };
})();
