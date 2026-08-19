'use strict';

/* ══════════════════════════════════════════════════════════════════════
   MELDEN UND SPERREN — die Entscheidungen

   Hier steht nur, WAS gilt: welche Meldung überhaupt abgeschickt werden
   darf, was eine Sperre bedeutet und ob sie noch läuft. Kein Firestore,
   kein DOM — deshalb lässt sich die Datei mit node prüfen
   (scripts/test-melden.js).

   Das Holen und Schreiben erledigt core/share.js, das Zeigen
   ui/melden.js und die Verwaltungsseite.

   >>> Wer wirft wen hinaus <<<
   Eine Meldung wirft NIEMANDEN hinaus. Sie geht an zwei Stellen: an den
   Besitzer des Dokuments, der die Freigabe zurücknehmen kann, und an die
   Verwaltung. Das war eine bewusste Entscheidung gegen den sofortigen
   Rauswurf: in einem Dokument mit zwei Leuten könnte sonst jeder den
   anderen mit einem Druck entfernen, und wer zuerst meldet, gewinnt.

   >>> Was NICHT mitgeschickt wird <<<
   Keine Chatzeilen, keine Seiteninhalte. Die Meldung trägt einen Grund
   zum Ankreuzen und höchstens zwei Sätze dazu. Fremde Gespräche in der
   Verwaltung zu sammeln, wäre für das bisschen mehr Gewissheit ein zu
   hoher Preis — und müsste in der Datenschutzerklärung stehen.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Gründe ─────────────────────────────────────────────────────────
   Feste Kennungen, keine freien Zeichenketten: sie stehen in den
   Sicherheitsregeln noch einmal (website/firestore.rules) und werden
   übersetzt (core/translations.js, meldenGrund*). Wer hier einen
   hinzufügt, muss beide Stellen mitnehmen. */
const MELDE_GRUENDE = ['beleidigung', 'werbung', 'fremdeInhalte', 'zerstoerung', 'sonstiges'];

/** Höchstlänge der zwei Sätze, die man dazuschreiben darf. */
const NOTIZ_MAX = 300;

/* ── Umfang einer Sperre ────────────────────────────────────────────
   Die Verwaltung sucht aus, was gelten soll — nicht immer alles. Eine
   Sperre ohne jeden Haken wäre keine; sie wird deshalb abgelehnt.

     neueFreigaben   kommt in kein geteiltes Dokument mehr hinein
     selbstTeilen    gibt selbst nichts mehr frei
     laufendeRaus    verliert auch die Dokumente, in denen er schon ist

   Die drei stehen genauso in den Sicherheitsregeln. Dort wirken sie
   wirklich; die Prüfungen hier sind für die Oberfläche, damit sie sagen
   kann, warum etwas nicht geht, statt einen Fehler der Datenbank zu
   zeigen. */
const SPERR_UMFANG = ['neueFreigaben', 'selbstTeilen', 'laufendeRaus'];

/** Kleinschreibung und ohne Leerzeichen – so liegen Adressen überall. */
function schluessel(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Ist diese Meldung abschickbar?
 *
 * @returns {{ok: true}|{ok: false, fehler: string}}
 *   fehler ist eine Kennung, kein fertiger Satz – übersetzt wird in der
 *   Oberfläche.
 */
function pruefeMeldung(m) {
  const melder = schluessel(m && m.melderEmail);
  const gemeldet = schluessel(m && m.gemeldetEmail);

  if (!melder) return { ok: false, fehler: 'nichtAngemeldet' };
  if (!gemeldet) return { ok: false, fehler: 'keinEmpfaenger' };
  if (melder === gemeldet) return { ok: false, fehler: 'selbst' };
  if (!MELDE_GRUENDE.includes(m && m.grund)) return { ok: false, fehler: 'keinGrund' };
  if (!String((m && m.docId) || '').trim()) return { ok: false, fehler: 'keinDokument' };
  if (String((m && m.notiz) || '').length > NOTIZ_MAX) return { ok: false, fehler: 'notizZuLang' };

  return { ok: true };
}

/**
 * Läuft die Sperre gerade?
 *
 * Ohne `bis` gilt sie unbegrenzt. Ein unlesbares Datum zählt als
 * ABGELAUFEN – andersherum als beim Postfach, und das mit Absicht: eine
 * Nachricht zu viel ist harmlos, eine Sperre zu viel nicht. Im Zweifel
 * darf der Nutzer weiterarbeiten.
 */
function sperreLaeuft(sperre, jetzt) {
  if (!sperre || typeof sperre !== 'object') return false;
  if (!hatUmfang(sperre)) return false;

  const bis = sperre.bis;
  if (!bis) return true;

  const ende = Date.parse(bis);
  if (Number.isNaN(ende)) return false;
  return ende > (jetzt instanceof Date ? jetzt.getTime() : Number(jetzt) || Date.now());
}

/** Ist überhaupt etwas angekreuzt? Eine Sperre über nichts ist keine. */
function hatUmfang(sperre) {
  const u = (sperre && sperre.umfang) || {};
  return SPERR_UMFANG.some(k => u[k] === true);
}

/**
 * Gilt diese Sperre gerade für diese eine Sache?
 *
 * @param {object} sperre  wie in Firestore abgelegt
 * @param {'neueFreigaben'|'selbstTeilen'|'laufendeRaus'} was
 */
function gesperrtFuer(sperre, was, jetzt) {
  if (!SPERR_UMFANG.includes(was)) return false;
  if (!sperreLaeuft(sperre, jetzt)) return false;
  return ((sperre.umfang || {})[was]) === true;
}

/**
 * Eine Sperre aus dem Formular der Verwaltung.
 *
 * @returns {{ok: true, sperre: object}|{ok: false, fehler: string}}
 */
function baueSperre({ email, tage, umfang, grund }) {
  const key = schluessel(email);
  if (!key) return { ok: false, fehler: 'keineAdresse' };

  const gewaehlt = {};
  for (const k of SPERR_UMFANG) gewaehlt[k] = ((umfang || {})[k] === true);
  if (!SPERR_UMFANG.some(k => gewaehlt[k])) return { ok: false, fehler: 'keinUmfang' };

  /* Tage statt eines Datums: „vierzehn Tage" ist die Entscheidung, die
     man trifft. Aus ihr wird hier ein fester Zeitpunkt – sonst hinge die
     Länge der Sperre davon ab, wann der Nutzer das nächste Mal
     nachsieht. 0 oder nichts heisst unbegrenzt. */
  const n = Number(tage);
  const bis = (Number.isFinite(n) && n > 0)
    ? new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()
    : null;

  return {
    ok: true,
    sperre: {
      email: key,
      bis,
      umfang: gewaehlt,
      grund: String(grund || '').slice(0, NOTIZ_MAX),
      gesetztAm: new Date().toISOString()
    }
  };
}

/* ── Übergabe ───────────────────────────────────────────────────────
   Im Browser hängt alles an window, in node an module.exports. Dieselbe
   Datei liegt unverändert an beiden Orten (scripts/sync-share.js kopiert
   sie nicht – sie wird in der App als klassisches Script geladen und im
   Test mit require). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MELDE_GRUENDE, SPERR_UMFANG, NOTIZ_MAX,
    schluessel, pruefeMeldung, sperreLaeuft, hatUmfang, gesperrtFuer, baueSperre
  };
}
if (typeof window !== 'undefined') {
  window.Melden = {
    MELDE_GRUENDE, SPERR_UMFANG, NOTIZ_MAX,
    schluessel, pruefeMeldung, sperreLaeuft, hatUmfang, gesperrtFuer, baueSperre
  };
}
