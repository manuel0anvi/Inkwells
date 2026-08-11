'use strict';

/* ══════════════════════════════════════════════════════════════════════
   IST MEINE ARBEIT SICHER?

   Diese Datei kennt die Antwort, zeigt sie aber nicht mehr selbst an.

   >>> Was hier frueher stand <<<
   Ein eigener Knopf in der Werkzeugleiste („Gespeichert" mit Punkt), der
   den oertlichen Stand anzeigte und auf Druck von Hand speicherte.
   Daneben, in der Titelleiste, ein zweiter Knopf fuer den Cloud-Stand.
   Zwei Anzeigen fuer dieselbe Frage – und die Antworten widersprachen
   sich regelmaessig, weil sie verschiedene Halbstrecken meinten.

   Seit automatisch gespeichert wird und sich das nicht mehr abschalten
   laesst (core/autoSave.js), war am Speicher-Knopf ausserdem nichts mehr
   zu druecken: er tat von sich aus, was er anbot. Uebrig blieb die
   AUSKUNFT, und die gehoert an eine Stelle.

   Sie steht jetzt am Sync-Knopf in der Titelleiste (ui/syncPanel.js).
   Der ist auch auf der Startseite da, wo es gar keine Werkzeugleiste
   gibt, und faellt beim Abmelden nicht weg: ohne Cloud ist „oertlich
   gespeichert" das Ziel und nicht die halbe Strecke.

   Hier bleiben die zwei Fragen, aus denen sich die Antwort ergibt –
   ui/syncPanel.js ruft sie fuer den Knopf und fuer das Fenster ab.
   ══════════════════════════════════════════════════════════════════════ */

(function () {

  /** Wartet dieses Heft noch darauf, ueberhaupt auf die Platte zu kommen? */
  function istUngesichert(nbId) {
    return !!nbId && typeof AutoSave !== 'undefined' && AutoSave.isDirty(nbId);
  }

  /* ── Wartet dieses Heft noch auf die Cloud? ───────────────────────
     Nur wenn die Cloud-Sicherung überhaupt eingeschaltet ist. Wer nicht
     angemeldet ist, soll kein blaues „noch nicht oben" sehen – bei ihm
     ist örtlich gespeichert das Ziel und nicht die halbe Strecke.

     Zwei Anzeichen, und es genügt eines:
       · das Heft steht in der Warteschlange
       · der zuletzt hochgeladene Stand ist älter als der jetzige
     Das zweite fängt die Zeit ab, in der ohne Netz gearbeitet wurde –
     danach ist die Warteschlange zwar gefüllt, aber ein Neustart
     dazwischen hat sie schon einmal überlebt.
     ─────────────────────────────────────────────────────────────── */
  function wartetAufCloud(nbId) {
    if (!nbId) return false;
    if (typeof CloudSync_ === 'undefined' || !CloudSync_) return false;
    if (!Settings.get('cloudEnabled') || !CloudSync_.isAuthenticated()) return false;

    // Ein fremdes Dokument bekommt keine Datei und keinen Cloud-Upload –
    // es lebt im Raum und wird von ui/sharedDocs.js gesichert.
    if (typeof isSharedNotebook === 'function' && isSharedNotebook(nbId)) return false;

    // syncQueue enthält jetzt Objekte {nbId, nbName, action, ...} –
    // oder im alten Format noch reine Strings. Beides abfangen.
    const inQueue = (CloudSync_.syncQueue || []).some(e => {
      return (typeof e === 'string' ? e : e.nbId) === nbId;
    });
    if (inQueue) return true;

    const nb = getNb(nbId);
    if (!nb) return false;
    if (!nb.syncedAt) return true;
    return Date.parse(nb.updatedAt || 0) > Date.parse(nb.syncedAt);
  }

  /**
   * Der Zustand des GEOEFFNETEN Hefts, in einem Wort.
   *
   * 'unsaved'    – noch nicht auf der Platte (hoechstens zwei Sekunden)
   * 'local-only' – auf der Platte, aber noch nicht in der Cloud
   * 'saved'      – so weit gesichert, wie es hier gehen kann
   */
  function saveState() {
    const nbId = (typeof S !== 'undefined' && S) ? S.activeNbId : null;
    if (istUngesichert(nbId)) return 'unsaved';
    if (wartetAufCloud(nbId)) return 'local-only';
    return 'saved';
  }

  /* Von Hand speichern gibt es weiterhin – nur nicht mehr als Knopf in
     der Leiste, sondern im Sync-Fenster und ueber das Tastenkuerzel. */
  async function saveNowWithFeedback() {
    if (!S.activeNbId) { toast(t('noActiveNotebook'), true); return false; }
    const nb = getNb(S.activeNbId);
    if (!nb) { toast(t('notebookNotFound'), true); return false; }

    try {
      const result = await AutoSave.saveNow(S.activeNbId);
      if (result && result.success) {
        toast(t('notebookSaved'));
        if (window.updateSaveStatus) window.updateSaveStatus();
        return true;
      }
      toast(t('saveError') + ': ' + (result && result.error), true);
      return false;
    } catch (err) {
      console.error('[SaveStatus] Speichern von Hand fehlgeschlagen:', err);
      toast(t('saveError'), true);
      return false;
    }
  }

  window.saveState = saveState;
  window.waitingForCloud = wartetAufCloud;
  window.saveNowWithFeedback = saveNowWithFeedback;

  /* Der Name bleibt: core/integration.js und ui/sharedDocs.js rufen ihn
     nach jeder Aenderung. Er zeigt jetzt auf den Sync-Knopf, der die
     Auskunft uebernommen hat. ui/syncPanel.js haengt sich hier ein –
     bis dahin ist es ein Platzhalter, der nichts tut. */
  if (!window.updateSaveStatus) window.updateSaveStatus = function () { };
})();
