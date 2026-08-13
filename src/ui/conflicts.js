'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DAS BAND UND DIE ANSICHT ZU ZWEI FASSUNGEN

   Die Entscheidung selbst liegt in core/conflicts.js. Hier steht nur,
   was man sieht und anklickt.

   ── Der Weg, den der Nutzer geht ────────────────────────────────────
   Band erscheint  →  „Verwerfen"  →  fertig, es bleibt beim Abgleich
                   →  „Anzeigen"   →  beide Fassungen  →  eine wählen

   Bei mehreren Konflikten auf einmal wird der Reihe nach gefragt: nach
   jeder Entscheidung kommt das nächste Heft. Alle gleichzeitig zu zeigen
   wäre eine Tabelle mit Häkchen, und damit genau die Art Fenster, vor der
   man die App zumacht.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const band = document.getElementById('conflict-bar');
  const overlay = document.getElementById('ov-conflict');
  const seiten = document.getElementById('conflict-sides');
  const nameFeld = document.getElementById('conflict-nb-name');

  if (!band || !overlay) return;

  const zu = () => { overlay.style.display = 'none'; };

  document.getElementById('conflict-close')?.addEventListener('click', zu);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) zu(); });

  document.getElementById('conflict-dismiss')?.addEventListener('click', () => {
    Conflicts.verwirfAlle();
  });

  document.getElementById('conflict-show')?.addEventListener('click', () => {
    zeigeNaechsten();
  });

  /** Datum und Uhrzeit in der eingestellten Sprache. */
  function zeitText(wert) {
    const d = new Date(wert);
    return Number.isNaN(d.getTime())
      ? '–'
      : d.toLocaleString(typeof getLanguage === 'function' ? getLanguage() : 'de');
  }

  /**
   * Was an einer Fassung zu sehen ist.
   *
   * Bewusst Zahlen und kein Textauszug: die Fassungen unterscheiden sich
   * oft an einer Stelle mitten im Heft, und ein Auszug der ersten Zeilen
   * wäre auf beiden Seiten derselbe – das sähe aus, als wäre es dasselbe
   * Heft, und wäre eine Auskunft, die in die Irre führt.
   */
  async function kennzahlen(stand) {
    const nb = await Versions.lade(stand);
    if (!nb) return null;

    let striche = 0;
    let zeichen = 0;
    let objekte = 0;
    for (const page of (nb.pages || [])) {
      striche += (page.inkStrokes || []).length;
      objekte += (page.objects || []).length;
      // Nur der sichtbare Text – die Auszeichnung zählt nicht mit
      zeichen += String(page.textContent || '').replace(/<[^>]*>/g, '').length;
    }
    return { seiten: (nb.pages || []).length, striche, zeichen, objekte };
  }

  /** Eine der beiden Karten. */
  function baueSeite(titel, wann, zahlen, andere, aufWahl) {
    const karte = document.createElement('div');
    karte.className = 'conflict-side';

    const kopf = document.createElement('div');
    kopf.className = 'conflict-side-title';
    kopf.textContent = titel;

    const zeit = document.createElement('div');
    zeit.className = 'conflict-side-when';
    zeit.textContent = zeitText(wann);

    const meta = document.createElement('div');
    meta.className = 'conflict-side-meta';

    if (!zahlen) {
      meta.textContent = t('conflictUnreadable') || 'Diese Fassung lässt sich nicht mehr lesen.';
    } else {
      /* Wo eine Seite mehr hat, wird die Zahl hervorgehoben. Das ist die
         eine Auskunft, die die Entscheidung wirklich trägt. */
      const zeile = (schluessel, vorlage) => {
        const wert = zahlen[schluessel];
        const zeileEl = document.createElement('div');
        const mehr = andere && wert > andere[schluessel];
        const text = (t(vorlage) || '{n}').replace('{n}', wert);
        if (mehr) {
          const b = document.createElement('b');
          b.textContent = text;
          zeileEl.appendChild(b);
        } else {
          zeileEl.textContent = text;
        }
        return zeileEl;
      };
      meta.append(
        zeile('seiten', 'conflictPages'),
        zeile('zeichen', 'conflictChars'),
        zeile('striche', 'conflictStrokes'),
        zeile('objekte', 'conflictObjects')
      );
    }

    const knopf = document.createElement('button');
    knopf.className = 'conflict-side-pick';
    knopf.textContent = t('conflictPick') || 'Diese behalten';
    knopf.disabled = !zahlen;
    knopf.addEventListener('click', aufWahl);

    karte.append(kopf, zeit, meta, knopf);
    return karte;
  }

  /** Den ersten offenen Konflikt zeigen – oder schließen, wenn keiner mehr da ist. */
  async function zeigeNaechsten() {
    const offen = Conflicts.liste();
    if (!offen.length) { zu(); return; }

    const eintrag = offen[0];
    overlay.style.display = 'flex';
    nameFeld.textContent = eintrag.name || '';
    seiten.innerHTML = '';

    const lade = document.createElement('div');
    lade.className = 'conflict-side-meta';
    lade.textContent = t('conflictLoading') || 'Fassungen werden gelesen…';
    seiten.appendChild(lade);

    const [zahlenMeins, zahlenFremd] = await Promise.all([
      kennzahlen(eintrag.meins),
      kennzahlen(eintrag.fremd)
    ]);

    // Inzwischen anderswo entschieden? Dann nicht dazwischenfunken.
    if (!Conflicts.liste().some(e => e.nbId === eintrag.nbId)) { zeigeNaechsten(); return; }

    seiten.innerHTML = '';
    seiten.append(
      baueSeite(t('conflictMine') || 'Auf diesem Gerät', eintrag.meins.wann,
        zahlenMeins, zahlenFremd, async () => {
          await Conflicts.behalteMeins(eintrag.nbId);
          zeigeNaechsten();
        }),
      baueSeite(t('conflictTheirs') || 'Aus der Cloud', eintrag.fremd.wann,
        zahlenFremd, zahlenMeins, async () => {
          await Conflicts.behalteCloud(eintrag.nbId);
          zeigeNaechsten();
        })
    );
  }

  window.zeigeKonflikte = zeigeNaechsten;
})();
