'use strict';

/* ══════════════════════════════════════════════════════════════════════
   POSTFACH — die Oberfläche

   Holt die Nachrichten, entscheidet mit core/postfach.js, was diesen
   Nutzer angeht, zeigt Fenster und Fach, und hält den Gelesen-Stand an
   zwei Orten gleich.

   >>> Der Stand liegt doppelt, und warum das kein Umweg ist <<<
   Örtlich (UserData/inkwells-postfach.json) und in der Cloud unter
   postfach/{uid}. Der örtliche Stand arbeitet ohne Internet und ohne
   Konto weiter — und er überlebt den Fall, an dem sonst alles hinge:
   beim Anmelden auf einem ZWEITEN Rechner wechselt die Firebase-Kennung
   (credential-already-in-use, siehe core/share.js). Das Dokument unter
   der alten Kennung ist danach nicht mehr lesbar. Der örtliche Stand
   hängt am Rechner statt an der Kennung und wird nach dem Wechsel
   einfach in die neue Kennung hochvereinigt.

   Beide Listen wachsen nur. Der Abgleich ist deshalb eine Vereinigung —
   ohne „wer war zuletzt dran", ohne verlorene Schreibvorgänge.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const E = (id) => document.getElementById(id);

  const btn = E('btn-postfach');
  const badge = E('postfach-badge');
  if (!btn || !window.api) return;

  const P = window.Postfach_;
  if (!P) { console.warn('[Postfach] core/postfach.js fehlt'); return; }

  let nachrichten = [];                       // wie sie in Firestore stehen
  let stand = { gelesen: [], geloescht: [] }; // vereinigt, örtlich + Cloud
  let lage = { angemeldet: false, anbieter: [], store: false, erstesMal: false };
  let bereit = false;
  let zeigtGerade = false;                    // ein Fenster nach dem anderen
  let letzteKennung = null;                   // gegen doppeltes Auswerten

  /* ── Übersetzung ──────────────────────────────────────────────────── */

  const T = (schluessel, rueckfall) =>
    (typeof t === 'function' ? (t(schluessel) || rueckfall) : rueckfall);

  const sprache = () => {
    try {
      return (typeof Settings !== 'undefined' && Settings.get)
        ? (Settings.get('language') || 'de') : 'de';
    } catch (err) { return 'de'; }
  };

  const datumText = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  /* ── Stand halten ─────────────────────────────────────────────────── */

  /** Örtlich sichern und, wenn möglich, hochschreiben. */
  async function standSichern() {
    try {
      const oertlich = await window.api.loadPostfach();
      const vereint = P.vereinigeStand(stand, oertlich);
      stand = vereint;
      await window.api.savePostfach({ ...vereint, erstStart: oertlich.erstStart });
    } catch (err) {
      console.warn('[Postfach] örtlich nicht sicherbar:', err.message);
    }

    /* Immer den GANZEN Stand hochschreiben, nicht nur das Neue: nach
       einem Kennungswechsel ist das neue Dokument leer, und nur so
       kommt das oben an, was hier längst feststand. */
    try {
      const S = window.InkwellsShare;
      if (S && S.sichrePostfachStand) await S.sichrePostfachStand(stand);
    } catch (err) {
      console.warn('[Postfach] Cloud-Stand nicht sicherbar:', err.message);
    }
  }

  async function alsGelesen(id) {
    if (stand.gelesen.includes(id)) return;
    stand.gelesen = P.vereinige(stand.gelesen, [id]);
    zeichneAbzeichen();
    await standSichern();
  }

  async function wegwerfen(id) {
    stand.geloescht = P.vereinige(stand.geloescht, [id]);
    stand.gelesen = P.vereinige(stand.gelesen, [id]);
    zeichneAbzeichen();
    await standSichern();
  }

  /* ── Abzeichen ────────────────────────────────────────────────────── */

  function meine() {
    return P.fuersPostfach(nachrichten, stand, lage, Date.now());
  }

  function zeichneAbzeichen() {
    const liste = meine();
    // Ohne eine einzige Nachricht bleibt der Knopf ganz weg
    btn.style.display = liste.length ? 'flex' : 'none';

    const offen = P.ungelesen(liste, stand).length;
    if (offen > 0) {
      badge.textContent = offen > 9 ? '9+' : String(offen);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  /* ── Eine Nachricht als Fenster ───────────────────────────────────── */

  function zeigeNachricht(n) {
    return new Promise((fertig) => {
      const ov = E('ov-nachricht');
      const spr = sprache();

      E('nachricht-titel').textContent = P.textFuer(n.titel, spr);
      E('nachricht-datum').textContent = datumText(n.erstellt);

      /* textContent, nicht innerHTML: der Text kommt aus einem Formular
         im Netz. Absätze bleiben trotzdem stehen, dafür sorgt
         white-space: pre-wrap in modals.css. */
      E('nachricht-text').textContent = P.textFuer(n.text, spr);

      const ok = E('nachricht-ok');
      const weg = E('nachricht-loeschen');

      const schliessen = async (auchLoeschen) => {
        ok.removeEventListener('click', beiOk);
        weg.removeEventListener('click', beiWeg);
        ov.style.display = 'none';
        if (auchLoeschen) await wegwerfen(n.id);
        else await alsGelesen(n.id);
        fertig();
      };

      const beiOk = () => schliessen(false);
      const beiWeg = () => schliessen(true);

      ok.addEventListener('click', beiOk);
      weg.addEventListener('click', beiWeg);
      ov.style.display = 'flex';
    });
  }

  /** Alles Fällige nacheinander zeigen – nie zwei Fenster übereinander. */
  async function zeigeFaellige(beimStart) {
    if (zeigtGerade) return;
    zeigtGerade = true;
    try {
      const faellig = P.alsFenster(meine(), stand, beimStart);
      for (const n of faellig) await zeigeNachricht(n);
    } finally {
      zeigtGerade = false;
    }
  }

  /* ── Das Fach ─────────────────────────────────────────────────────── */

  function zeichneFach() {
    const kasten = E('postfach-liste');
    const leer = E('postfach-leer');
    const liste = meine();
    const spr = sprache();

    kasten.innerHTML = '';
    leer.style.display = liste.length ? 'none' : 'block';

    for (const n of liste) {
      const zeile = document.createElement('div');
      zeile.className = 'postfach-eintrag'
        + (stand.gelesen.includes(String(n.id)) ? '' : ' ungelesen');

      const titel = document.createElement('div');
      titel.className = 'postfach-titel';
      titel.textContent = P.textFuer(n.titel, spr);

      const datum = document.createElement('div');
      datum.className = 'postfach-datum';
      datum.textContent = datumText(n.erstellt);

      const text = document.createElement('div');
      text.className = 'postfach-text';
      text.textContent = P.textFuer(n.text, spr);

      const weg = document.createElement('button');
      weg.className = 'postfach-weg';
      weg.type = 'button';
      weg.textContent = '×';
      weg.title = T('postfachLoeschen', 'Löschen');
      weg.addEventListener('click', async () => {
        await wegwerfen(String(n.id));
        zeichneFach();
      });

      zeile.append(titel, weg, datum, text);
      kasten.appendChild(zeile);
    }
  }

  async function fachOeffnen() {
    zeichneFach();
    E('ov-postfach').style.display = 'flex';

    /* Wer das Fach öffnet, hat alles gesehen. Das nimmt dem Zähler die
       Aufdringlichkeit – sonst müsste man jede einzeln anklicken. */
    const offen = P.ungelesen(meine(), stand);
    if (offen.length) {
      stand.gelesen = P.vereinige(stand.gelesen, offen.map(n => String(n.id)));
      zeichneAbzeichen();
      zeichneFach();
      await standSichern();
    }
  }

  btn.addEventListener('click', fachOeffnen);
  E('postfach-zu').addEventListener('click', () => {
    E('ov-postfach').style.display = 'none';
  });

  /* ── Anlauf ───────────────────────────────────────────────────────── */

  /** Kennung samt Anmeldeweg – daran erkennt man einen echten Wechsel. */
  function kennungJetzt() {
    try {
      const S = window.InkwellsShare;
      const ich = S && S.currentIdentity ? S.currentIdentity() : null;
      if (!ich) return '';
      return ich.uid + '|' + (ich.anbieter || []).join(',') + '|' + (ich.anonymous ? 'a' : 'e');
    } catch (err) { return ''; }
  }

  async function lageErmitteln() {
    let erstesMal = false;
    try {
      const e = await window.api.erstStart();
      erstesMal = !!(e && e.erstesMal);
    } catch (err) { /* dann eben nicht */ }

    /* „Angemeldet" heißt: echtes Konto, nicht bloß die anonyme
       Gerätekennung. Die hat nämlich jeder — sonst gäbe es für Nutzer
       ohne Konto gar kein Postfach. */
    let angemeldet = false;
    let anbieter = [];
    try {
      const S = window.InkwellsShare;
      const ich = S && S.currentIdentity ? S.currentIdentity() : null;
      angemeldet = !!(ich && !ich.anonymous && ich.email);
      anbieter = (ich && ich.anbieter) || [];
    } catch (err) { /* dann gilt anonym */ }

    return {
      angemeldet,
      anbieter,
      store: window.api.istStorefassung === true,
      erstesMal
    };
  }

  async function anlaufen() {
    if (bereit) return;
    const S = window.InkwellsShare;
    if (!S || !S.ladeNachrichten) return;
    bereit = true;

    lage = await lageErmitteln();
    letzteKennung = kennungJetzt();

    // Örtlich zuerst: das steht auch ohne Internet zur Verfügung
    try {
      const oertlich = await window.api.loadPostfach();
      stand = P.vereinigeStand(stand, oertlich);
    } catch (err) { /* dann leer */ }

    // Dann die Cloud dazu – und gleich wieder hoch, damit ein
    // Kennungswechsel den örtlichen Stand mitnimmt
    try {
      const oben = await S.ladePostfachStand();
      const vorher = JSON.stringify(stand);
      stand = P.vereinigeStand(stand, oben);
      if (JSON.stringify(stand) !== vorher) await standSichern();
      else await S.sichrePostfachStand(stand);
    } catch (err) { /* offline, macht nichts */ }

    nachrichten = await S.ladeNachrichten();
    zeichneAbzeichen();
    await zeigeFaellige(true);

    /* ── Und auf den Anmeldestand hören ──────────────────────────────
       Wer sich WÄHREND der Sitzung anmeldet, gehört ab da zu einem
       anderen Empfängerkreis. Ohne dieses Nachfassen bliebe die Lage auf
       dem Stand des Starts stehen — und eine Nachricht an „nur neu
       installierte UND nur angemeldete" erreichte niemanden: beim
       allerersten Start ist noch niemand angemeldet, und beim nächsten
       Start ist „neu installiert" schon nicht mehr wahr.

       >>> Warum hier beimStart = true steht <<<
       Der Filter schlägt nicht um, weil Zeit vergangen ist, sondern weil
       wir jetzt mehr über den Nutzer wissen. Der Start hat längst
       stattgefunden; wir konnten ihn nur noch nicht auswerten. Und
       angemeldet hat man sich gerade selbst — ein Fenster ist dann keine
       Überrumpelung.

       Nebenbei erledigt das den Kennungswechsel: auf einem zweiten
       Rechner bekommt man beim Anmelden eine neue Firebase-Kennung, und
       hier wird der örtliche Stand in deren Dokument hochvereinigt. */
    S.onIdentityChanged(async () => {
      const jetzt = kennungJetzt();
      if (jetzt === letzteKennung) return;
      letzteKennung = jetzt;

      lage = await lageErmitteln();

      try {
        const oben = await S.ladePostfachStand();
        stand = P.vereinigeStand(stand, oben);
      } catch (err) { /* offline, macht nichts */ }
      await standSichern();

      zeichneAbzeichen();
      if (E('ov-postfach').style.display === 'flex') zeichneFach();
      await zeigeFaellige(true);
    });

    /* Ab jetzt lauschen. Was hereinkommt, springt nur auf, wenn es
       ausdrücklich "sofort" verlangt – der Rest wartet auf den nächsten
       Start, damit niemand mitten im Satz unterbrochen wird. */
    S.beobachteNachrichten(async (liste) => {
      nachrichten = liste;
      zeichneAbzeichen();
      if (E('ov-postfach').style.display === 'flex') zeichneFach();
      await zeigeFaellige(false);
    });
  }

  if (window.InkwellsShare) anlaufen();
  else document.addEventListener('inkwells-share-ready', anlaufen, { once: true });

  window.addEventListener('language-changed', () => {
    zeichneAbzeichen();
    if (E('ov-postfach').style.display === 'flex') zeichneFach();
  });
})();
