'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ZWEI FASSUNGEN DESSELBEN HEFTS

   Wer auf zwei Geräten arbeitet, ändert früher oder später beide Male
   dasselbe Heft, bevor sich die Geräte einig geworden sind. Beim
   nächsten Abgleich stehen dann zwei Fassungen nebeneinander, und keine
   ist „die richtige".

   ── Was hier vorher geschah ────────────────────────────────────────
   Nichts, was der Nutzer bemerkt hätte. Der Abgleich legte still eine
   Kopie mit „(Konflikt …)" im Namen an – und selbst das nur, wenn er
   überhaupt bis dorthin kam. Der häufigste Fall lief anders: „hier ist
   noch etwas offen" führte weiter oben aus der Funktion heraus, die
   fremde Fassung wurde verworfen, und der spätere Upload überschrieb
   sie endgültig. Die Arbeit vom anderen Gerät war weg, ohne dass
   irgendwo etwas gestanden hätte.

   ── Wie es jetzt läuft ─────────────────────────────────────────────
   1. Der Abgleich meldet den Konflikt hierher, BEVOR er etwas ändert.
   2. Beide Fassungen werden als Stand weggelegt (core/versions.js) –
      die eigene und die fremde. Ab hier kann nichts mehr verloren gehen.
   3. Der Abgleich läuft normal weiter: die neuere Fassung gewinnt
      vorläufig. Das ist die alte, vorsichtige Regel; sie bleibt.
   4. Der Nutzer sieht ein Band: „Verwerfen" oder „Anzeigen".
        · Verwerfen  → es bleibt beim vorläufigen Ergebnis.
        · Anzeigen   → beide Fassungen nebeneinander, und man wählt EINE.

   >>> Warum man nur EINE wählen kann <<<
   Weil jede andere Antwort neue Konflikte macht. „Beide behalten" heißt
   zwei Hefte, die weiter auseinanderlaufen; „seitenweise mischen" heißt,
   dieselbe Frage noch einmal für jede Seite. Eine Entscheidung, ein
   Ergebnis – und die verworfene Fassung liegt weiterhin im
   Versionsverlauf, falls man sich anders besinnt.
   ══════════════════════════════════════════════════════════════════════ */

const Conflicts = {
  /* Offene Konflikte, je Heft höchstens einer. Ein zweiter Abgleich
     desselben Hefts ersetzt den Eintrag – die fremde Fassung darin ist
     dann veraltet, und die eigene liegt ohnehin schon als Stand. */
  _offen: new Map(),   // nbId -> { nbId, name, meins, fremd, wann }

  /**
   * Der Abgleich hat einen Konflikt gefunden.
   *
   * Kehrt sofort zurück und hält den Abgleich NICHT an. Alles, was hier
   * geschieht, muss ohne den Nutzer auskommen – seine Entscheidung
   * kommt später, oder gar nicht.
   *
   * @param {object} meins  die örtliche Fassung, noch unangetastet
   * @param {object} fremd  die Fassung aus der Cloud
   */
  async melde(meins, fremd) {
    if (!meins || !meins.id) return;

    try {
      const [standMeins, standFremd] = await Promise.all([
        Versions.sichere(meins, 'konflikt'),
        Versions.sichere({ ...fremd, id: meins.id }, 'fremd')
      ]);

      /* Ohne die beiden Stände hat die Ansicht nichts zu zeigen, und
         „Meine Fassung behalten" hätte nichts zum Zurückholen. Dann
         lieber gar kein Band als eines, dessen Knöpfe ins Leere greifen. */
      if (!standMeins || !standFremd) {
        console.warn('[Conflicts] Stände konnten nicht abgelegt werden – kein Band');
        return;
      }

      this._offen.set(meins.id, {
        nbId: meins.id,
        name: meins.name || '',
        meins: standMeins,
        fremd: standFremd,
        wann: new Date().toISOString()
      });

      console.warn('[Conflicts] Zwei Fassungen von', meins.name);
      this._zeigeBand();
    } catch (err) {
      console.error('[Conflicts] Konflikt konnte nicht abgelegt werden:', err);
    }
  },

  liste() {
    return Array.from(this._offen.values());
  },

  anzahl() {
    return this._offen.size;
  },

  /* ── Die Entscheidung ────────────────────────────────────────────── */

  /**
   * Die eigene Fassung gewinnt.
   *
   * Sie wird aus dem Stand zurückgeholt und mit frischem Zeitstempel
   * gespeichert – damit ist sie überall die neuere, und der nächste
   * Abgleich trägt sie hinaus.
   */
  async behalteMeins(nbId) {
    const eintrag = this._offen.get(nbId);
    if (!eintrag) return false;

    const res = await Versions.stelleHer(eintrag.meins);
    if (!res.success) {
      if (typeof toast === 'function') toast(t('conflictRestoreFailed'), true);
      return false;
    }

    this._erledigt(nbId);
    if (typeof renderHomeGrid === 'function') renderHomeGrid();
    if (typeof toast === 'function') toast(t('conflictKeptMine'));
    return true;
  },

  /**
   * Die Fassung aus der Cloud gewinnt.
   *
   * Sie steht meistens schon da – der Abgleich hat sie vorläufig
   * übernommen. „Meistens" reicht hier aber nicht: war die eigene
   * Fassung die neuere, blieb sie stehen. Deshalb wird sie ausdrücklich
   * eingesetzt und nicht bloß der Konflikt abgehakt.
   */
  async behalteCloud(nbId) {
    const eintrag = this._offen.get(nbId);
    if (!eintrag) return false;

    const res = await Versions.stelleHer(eintrag.fremd);
    if (!res.success) {
      if (typeof toast === 'function') toast(t('conflictRestoreFailed'), true);
      return false;
    }

    this._erledigt(nbId);
    if (typeof renderHomeGrid === 'function') renderHomeGrid();
    if (typeof toast === 'function') toast(t('conflictKeptCloud'));
    return true;
  },

  /**
   * Verwerfen: es bleibt beim vorläufigen Ergebnis des Abgleichs.
   *
   * Die Stände bleiben liegen. Wer in einer Stunde merkt, dass er sich
   * vertan hat, findet beide Fassungen im Versionsverlauf – das ist der
   * ganze Sinn davon, dass sie vorher weggelegt wurden.
   */
  verwirf(nbId) {
    this._erledigt(nbId);
  },

  verwirfAlle() {
    for (const nbId of Array.from(this._offen.keys())) this._erledigt(nbId);
  },

  _erledigt(nbId) {
    this._offen.delete(nbId);
    this._zeigeBand();
  },

  /* ── Das Band am oberen Rand ─────────────────────────────────────── */

  /* ══════════════════════════════════════════════════════════════════
     DAS BAND GILT ÜBERALL

     Es steht im gewöhnlichen Fluss über beiden Ansichten – Übersicht wie
     offenes Heft. Das war ausdrücklich gewünscht: die Frage betrifft ein
     Heft, und wer gerade darin arbeitet, ist der Erste, der sie sehen
     sollte. Vorher war es nur in der Übersicht zu sehen, weil man dorthin
     zurück musste, um überhaupt etwas zu bemerken.

     `hat-konflikt` am body nimmt den Ansichten dieselbe Höhe wieder weg,
     die das Band ihnen nimmt. Ohne die Marke rutscht der untere Rand aus
     dem Bild – in einem Heft wäre das der Seitenfuß.
     ══════════════════════════════════════════════════════════════════ */
  _zeigeBand() {
    const band = document.getElementById('conflict-bar');
    if (!band) return;

    const offen = this.liste();
    if (!offen.length) {
      band.style.display = 'none';
      document.body.classList.remove('hat-konflikt');
      return;
    }
    document.body.classList.add('hat-konflikt');

    const text = band.querySelector('.conflict-bar-text');
    if (text) {
      text.textContent = offen.length === 1
        ? (t('conflictBarOne') || 'Ein Heft wurde auf einem anderen Gerät geändert.')
            .replace('{name}', offen[0].name)
        : (t('conflictBarMany') || '{n} Hefte wurden auf einem anderen Gerät geändert.')
            .replace('{n}', offen.length);
    }
    band.style.display = 'flex';
  }
};

window.Conflicts = Conflicts;
