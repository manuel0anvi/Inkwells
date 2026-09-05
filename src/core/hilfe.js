'use strict';

/* ══════════════════════════════════════════════════════════════════════
   HILFE – WELCHE THEMEN ES GIBT UND WANN EIN HINWEIS VON SELBST KOMMT

   Hier steht nur das Gerüst: die Reihenfolge der Themen, aus welchen
   Absätzen jedes besteht und welches Schaubild dazugehört. Die Texte
   selbst stehen in core/translations.js – es gibt sie dreimal, einmal je
   Sprache. Stünden sie hier, gäbe es sie einmal, auf Deutsch, für alle.

   >>> Warum die Hilfe nicht alles erklärt <<<
   Aufgenommen ist, worüber tatsächlich jemand gestolpert ist: dass ein
   Abschnitt kein Kapitel ist, dass das Papier von drei Stellen kommen
   kann, was die Farbe am Sync-Knopf bedeutet, wann der Finger zeichnet
   und wann er blättert, wozu ein Konto gut ist – und wer in einem
   geteilten Dokument schreiben darf und wer nur lesen. Was ohnehin klar
   ist, steht nicht drin: ein Handbuch, das alles sagt, liest niemand,
   und die sechs schwierigen Stellen gehen darin unter.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Wie ein Absatz aussehen kann ─────────────────────────────────────
     'schluessel'            ein gewöhnlicher Absatz
     { merk: 'schluessel' }  der eine Satz, auf den es ankommt
     { liste: [ … ] }        Aufzählung
     { bild: 'name' }        Schaubild, gezeichnet in ui/hilfe.js
   ──────────────────────────────────────────────────────────────────── */

const HILFE_THEMEN = [
  {
    id: 'start',
    titel: 'hilfeStartTitel',
    absaetze: [
      'hilfeStart1',
      { merk: 'hilfeStartMerk' },
      'hilfeStart2',
      'hilfeStart3'
    ]
  },

  /* Das schwierigste Thema der App und deshalb das erste nach dem
     Anfang. Ohne Bild bleibt es ein Satz, den man liest und trotzdem
     nicht glaubt. */
  {
    id: 'abschnitte',
    titel: 'hilfeAbschnitteTitel',
    absaetze: [
      'hilfeAbschnitte1',
      { merk: 'hilfeAbschnitteMerk' },
      { bild: 'abschnitte' },
      'hilfeAbschnitte2',
      'hilfeAbschnitte3',
      { liste: ['hilfeAbschnitteL1', 'hilfeAbschnitteL2', 'hilfeAbschnitteL3'] }
    ]
  },

  {
    id: 'papier',
    titel: 'hilfePapierTitel',
    absaetze: [
      'hilfePapier1',
      { bild: 'papier' },
      { merk: 'hilfePapierMerk' },
      'hilfePapier2'
    ]
  },

  {
    id: 'schreiben',
    titel: 'hilfeSchreibenTitel',
    absaetze: [
      'hilfeSchreiben1',
      'hilfeSchreiben2',
      { liste: ['hilfeSchreibenL1', 'hilfeSchreibenL2'] },
      'hilfeSchreiben3'
    ]
  },

  {
    id: 'finger',
    titel: 'hilfeFingerTitel',
    absaetze: [
      'hilfeFinger1',
      { merk: 'hilfeFingerMerk' },
      { liste: ['hilfeFingerL1', 'hilfeFingerL2', 'hilfeFingerL3'] },
      'hilfeFinger2'
    ]
  },

  {
    id: 'speichern',
    titel: 'hilfeSpeichernTitel',
    absaetze: [
      'hilfeSpeichern1',
      { bild: 'farben' },
      'hilfeSpeichern2',
      { merk: 'hilfeSpeichernMerk' }
    ]
  },

  /* „Brauche ich dafür ein Konto?" – die Frage kam beim ersten Öffnen
     des Anmeldefensters, und die Antwort ist für fast alles: nein. */
  {
    id: 'konto',
    titel: 'hilfeKontoTitel',
    absaetze: [
      { merk: 'hilfeKontoMerk' },
      'hilfeKonto1',
      { liste: ['hilfeKontoL1', 'hilfeKontoL2', 'hilfeKontoL3'] },
      'hilfeKonto2',
      'hilfeKonto3'
    ]
  },

  {
    id: 'teilen',
    titel: 'hilfeTeilenTitel',
    absaetze: [
      'hilfeTeilen1',
      { liste: ['hilfeTeilenL1', 'hilfeTeilenL2'] },
      'hilfeTeilen2',
      'hilfeTeilen3',
      { merk: 'hilfeTeilenMerk' }
    ]
  },

  /* Eigenes Thema und kein Absatz beim Teilen: die Rolle entscheidet,
     ob der Stift überhaupt etwas tut – das ist die Frage, die im
     geteilten Dokument tatsächlich gestellt wird. */
  {
    id: 'rollen',
    titel: 'hilfeRollenTitel',
    absaetze: [
      'hilfeRollen1',
      { bild: 'rollen' },
      'hilfeRollen2',
      { merk: 'hilfeRollenMerk' },
      'hilfeRollen3',
      'hilfeRollen4'
    ]
  }
];

/* ══════════════════════════════════════════════════════════════════════
   DIE EINMALIGEN HINWEISE

   Jeder hängt an EINER Funktion und kommt, wenn sie zum ersten Mal
   geöffnet wird. Kein Rundgang beim Start: dort will man anfangen und
   nicht lesen, und was man wegklickt, hat man nicht gelesen.

   `thema` sagt, wohin „Mehr dazu" führt. Deshalb hat jeder Hinweis eins –
   der kurze Text im Fenster ist die Zusammenfassung, nicht die Erklärung.
   ══════════════════════════════════════════════════════════════════════ */

const HILFE_HINWEISE = {
  // Beim ersten Öffnen der Abschnittsverwaltung (ui/sidebar.js)
  abschnitte: {
    titel: 'hinweisAbschnitteTitel',
    text: ['hinweisAbschnitte1', 'hinweisAbschnitte2'],
    thema: 'abschnitte'
  },
  // Beim ersten Öffnen der Papierauswahl einer Seite (ui/contextMenu.js)
  papier: {
    titel: 'hinweisPapierTitel',
    text: ['hinweisPapier1'],
    thema: 'papier'
  },
  // Beim ersten Öffnen des Sync-Fensters (ui/syncPanel.js)
  speichern: {
    titel: 'hinweisSpeichernTitel',
    text: ['hinweisSpeichern1', 'hinweisSpeichern2'],
    thema: 'speichern'
  },
  // Beim ersten Öffnen des Anmeldefensters (ui/auth.js)
  konto: {
    titel: 'hinweisKontoTitel',
    text: ['hinweisKonto1', 'hinweisKonto2'],
    thema: 'konto'
  },
  // Beim ersten Öffnen des Freigabe-Fensters (ui/share.js)
  teilen: {
    titel: 'hinweisTeilenTitel',
    text: ['hinweisTeilen1', 'hinweisTeilen2'],
    thema: 'rollen'
  }
};

/* ── Was schon gezeigt wurde ──────────────────────────────────────────
   Eine Liste in den Einstellungen, nicht ein Schalter je Hinweis: es
   kommen welche dazu, und jeder neue bräuchte sonst einen eigenen
   Standardwert in core/settings.js.

   Fehlen die Einstellungen noch (ganz früh im Start), gilt ein Hinweis
   als gesehen. Lieber einer zu wenig als einer, der aufgeht, bevor die
   App überhaupt steht – und gemerkt werden könnte er dann ohnehin nicht.
   ──────────────────────────────────────────────────────────────────── */

function hinweisGesehen(id) {
  try {
    const liste = Settings.get('hinweiseGesehen');
    return !Array.isArray(liste) || liste.includes(id);
  } catch (e) {
    return true;
  }
}

async function hinweisMerken(id) {
  try {
    const liste = Settings.get('hinweiseGesehen');
    if (!Array.isArray(liste) || liste.includes(id)) return;
    await Settings.set('hinweiseGesehen', [...liste, id]);
  } catch (e) {
    console.warn('[Hilfe] Hinweis liess sich nicht merken:', id, e);
  }
}

/** Das Thema zu einer Kennung – oder das erste, wenn es sie nicht gibt. */
function hilfeThema(id) {
  return HILFE_THEMEN.find(th => th.id === id) || HILFE_THEMEN[0];
}
