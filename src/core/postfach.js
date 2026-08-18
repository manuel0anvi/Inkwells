'use strict';

/* ══════════════════════════════════════════════════════════════════════
   POSTFACH — die Entscheidungen

   Hier steht nur, WAS gilt: welche Nachricht diesen Nutzer überhaupt
   angeht, welche noch gültig ist, welche schon gesehen wurde und wie
   zwei Stände zusammenkommen.

   Bewusst ohne Firestore und ohne DOM. Das Holen erledigt core/share.js,
   das Zeigen ui/postfach.js — und diese Datei lässt sich dadurch mit
   node prüfen (scripts/test-postfach.js).

   >>> Warum die Listen nur wachsen <<<
   „gelesen" und „geloescht" sind Mengen, die nie kleiner werden. Was
   einmal gelesen ist, wird nie wieder ungelesen. Dadurch ist der
   Abgleich zwischen zwei Rechnern eine Vereinigung – es gibt kein „wer
   war zuletzt dran", keine verlorenen Schreibvorgänge und keinen
   Sonderfall, wenn beide gleichzeitig etwas tun.
   ══════════════════════════════════════════════════════════════════════ */

/** Der Text in der gewünschten Sprache, sonst auf Deutsch. */
function textFuer(feld, sprache) {
  if (!feld || typeof feld !== 'object') return String(feld || '');
  const gewuenscht = String(feld[sprache] || '').trim();
  if (gewuenscht) return gewuenscht;
  return String(feld.de || '').trim();
}

/** Zwei Kennungslisten zu einer machen – ohne Doppelte, Reihenfolge bleibt. */
function vereinige(a, b) {
  const raus = [];
  const gesehen = new Set();
  for (const liste of [a, b]) {
    if (!Array.isArray(liste)) continue;
    for (const id of liste) {
      const s = String(id || '');
      if (!s || gesehen.has(s)) continue;
      gesehen.add(s);
      raus.push(s);
    }
  }
  return raus;
}

/** Zwei Postfachstände zusammenführen. */
function vereinigeStand(a, b) {
  return {
    gelesen: vereinige(a && a.gelesen, b && b.gelesen),
    geloescht: vereinige(a && a.geloescht, b && b.geloescht)
  };
}

/**
 * Ist die Nachricht noch gültig?
 *
 * Ohne gueltigBis gilt sie unbegrenzt. Ein unlesbares Datum zählt
 * ebenfalls als unbegrenzt – lieber eine Nachricht zu viel als eine
 * verschluckte, weil im Formular ein Tippfehler stand.
 */
function istGueltig(nachricht, jetzt) {
  const bis = nachricht && nachricht.gueltigBis;
  if (!bis) return true;
  const ende = Date.parse(bis);
  if (Number.isNaN(ende)) return true;
  return ende >= (jetzt instanceof Date ? jetzt.getTime() : Number(jetzt) || Date.now());
}

/**
 * Geht diese Nachricht den hier sitzenden Nutzer an?
 *
 * lage = { angemeldet, anbieter, store, erstesMal }
 *
 * Die Häkchen sind UND-verknüpft: „nur Angemeldete" plus „nur Store"
 * trifft angemeldete Store-Nutzer. Ohne Häkchen geht sie an alle.
 *
 * >>> Das ist eine Höflichkeit, keine Sperre <<<
 * Die Nachrichten liegen in einem öffentlich lesbaren Dokument. Wer die
 * Datenbank direkt abfragt, sieht auch, was nicht für ihn gedacht war.
 * Für Ankündigungen reicht das; Vertrauliches gehört hier nicht hinein.
 */
function trifftZu(nachricht, lage) {
  const ziel = (nachricht && nachricht.ziel) || {};
  const l = lage || {};
  const anbieter = Array.isArray(l.anbieter) ? l.anbieter : [];

  if (ziel.nurAngemeldete && !l.angemeldet) return false;
  if (ziel.nurStore && !l.store) return false;
  if (ziel.nurWebsite && l.store) return false;
  if (ziel.nurNeue && !l.erstesMal) return false;

  /* Womit angemeldet? Die Kennungen kommen unveraendert von Firebase
     (providerData), deshalb hier die vollen Namen und keine eigenen
     Kuerzel - was Firebase liefert, muss hier eins zu eins passen.

     "Microsoft" und "OneDrive" sind dasselbe Konto: die Cloud-Sicherung
     in OneDrive haengt an der Microsoft-Anmeldung. */
  if (ziel.nurGoogle && !anbieter.includes('google.com')) return false;
  if (ziel.nurMicrosoft && !anbieter.includes('microsoft.com')) return false;

  return true;
}

/** Alles, was für diesen Nutzer zählt – auch das schon Gelesene. */
function fuersPostfach(liste, stand, lage, jetzt) {
  const geloescht = new Set((stand && stand.geloescht) || []);
  return (Array.isArray(liste) ? liste : [])
    .filter(n => n && n.id)
    .filter(n => !geloescht.has(String(n.id)))
    .filter(n => istGueltig(n, jetzt))
    .filter(n => trifftZu(n, lage))
    .sort((a, b) => String(b.erstellt || '').localeCompare(String(a.erstellt || '')));
}

/** Wie viele davon hat der Nutzer noch nicht gesehen? */
function ungelesen(liste, stand) {
  const gelesen = new Set((stand && stand.gelesen) || []);
  return liste.filter(n => !gelesen.has(String(n.id)));
}

/**
 * Was soll jetzt als Fenster aufgehen?
 *
 * beimStart = true  → alles Ungelesene mit art "fenster"
 * beimStart = false → nur das, was ausdrücklich "sofort" verlangt;
 *                     der Rest wartet auf den nächsten Start
 */
function alsFenster(liste, stand, beimStart) {
  return ungelesen(liste, stand)
    .filter(n => n.art === 'fenster')
    .filter(n => (beimStart ? true : !!n.sofort))
    /* Älteste zuerst durchklicken, das liest sich wie ein Verlauf.

       Ausdrücklich selbst sortiert und nicht bloß die Eingabe umgedreht:
       sonst hinge das Ergebnis daran, in welcher Reihenfolge der Aufrufer
       die Liste übergibt – und fuersPostfach() liefert sie neueste zuerst,
       eine rohe Liste aus Firestore dagegen nicht. */
    .slice()
    .sort((a, b) => String(a.erstellt || '').localeCompare(String(b.erstellt || '')));
}

/* Im Browser stehen sie als Globale bereit, in node über module.exports.
   Denselben Weg gehen die anderen Kernbausteine auch. */
if (typeof window !== 'undefined') {
  window.Postfach_ = {
    textFuer, vereinige, vereinigeStand, istGueltig,
    trifftZu, fuersPostfach, ungelesen, alsFenster
  };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    textFuer, vereinige, vereinigeStand, istGueltig,
    trifftZu, fuersPostfach, ungelesen, alsFenster
  };
}
