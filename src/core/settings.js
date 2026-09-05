'use strict';

const SETTINGS_FILE = 'journal-settings.json';

const DEFAULT_SETTINGS = {
  saveLocation: null, // null means user needs to set it
  /* autoSaveEnabled ist entfallen – automatisch gespeichert wird
     immer. Ein alter Wert in der Datei stoert nicht: er wird
     nirgends mehr gelesen (core/autoSave.js). */
  language: 'en', // de, en, it
  /* ── Zeichnet der Finger, oder bewegt er die Seite? ────────────────
     Der Finger ZEICHNET, sobald ein Zeichenwerkzeug gewählt ist. Zum
     Bewegen der Seite bleiben zwei Finger und der Rand neben der Seite.

     >>> Warum die Frage jetzt andersherum steht <<<
     Vorher hiess sie touchDraw und war aus, solange niemand den Schalter
     in der Werkzeugleiste fand – und niemand fand ihn. Gemeldet wurde
     das als „mit dem Finger geht es gar nicht". Wer den Finger doch lieber
     zum Blättern hat (etwa mit einem Stift in der Hand), schaltet ihn in
     der Werkzeugleiste weiterhin ab; DIESE Entscheidung steht hier.
     Der alte Wert wird beim Laden weggeräumt (STALE_SETTINGS). */
  touchDrawOff: false,
  /* ── Meldet Windows eine Chat-Nachricht? ──────────────────────────
     Ja, solange nichts anderes gesagt wird – und deshalb steht hier das
     ABSCHALTEN und nicht das Anschalten. Eine Einstellungsdatei aus der
     Zeit davor kennt den Wert nicht, und „nicht bekannt" muss „an"
     heissen; andersherum bekäme niemand, der die App schon benutzt,
     jemals eine Meldung, ohne sie erst zu suchen.

     Gemeldet wird nur, solange das Fenster nicht vorne steht – das
     entscheidet main.js, nicht diese Einstellung. */
  chatNotifyOff: false,
  /* ── Was geschieht, wenn zwei Texte aneinanderstossen? ─────────────
     Ein angeklickter Absatz steht frei auf dem Blatt (canvas/text.js).
     Beim Wachsen stösst er irgendwann an den nächsten:

       'elastisch'     der Nachbar weicht aus und kommt wieder zurück
       'fest'          er weicht aus und bleibt, wo er hingerückt ist

     'elastisch' ist die Vorgabe, weil sie nichts endgültig macht: die
     Stelle, die jemand gewählt hat, bleibt in jedem Fall gespeichert.

     In einem GETEILTEN Dokument gilt die Wahl des Besitzers, solange
     man darin ist (nb.textFluss, siehe ausweichArt). Sonst sähe die
     Seite bei jedem Beteiligten anders aus. */
  textFluss: 'elastisch',
  cloudEnabled: false,
  // Cloud-Anbieter: 'google' (Drive) oder 'microsoft' (OneDrive).
  // Siehe core/cloudConfig.js und core/providers/.
  cloudProvider: '',
  cloudEmail: '',
  cloudAccessToken: '',   // läuft nach etwa einer Stunde ab
  cloudRefreshToken: '',  // nur Microsoft – damit hält die Sitzung länger
  cloudTokenExpiry: 0,    // Zeitstempel in ms, ab wann das Token ungültig ist
  cloudUserId: '',
  cloudUserName: '',
  cloudUserPicture: '',
  cloudLastSync: '',
  /* Darf sich die App beim Start von selbst bei den geteilten Dokumenten
     anmelden? Nur bei Microsoft von Belang – dort geht es sonst nicht
     ohne Klick (core/share.js, signInMicrosoftSilently). Aus, bis der
     Nutzer ausdrücklich zustimmt: es öffnet eine Verbindung zu Microsoft,
     und das tut man nicht ungefragt. */
  autoLinkShare: false,
  // Nur abweichende Tastenkürzel: { aktionId: 'Ctrl+S' }. Leer = alles Standard.
  shortcuts: {},
  /* Welche einmaligen Hinweise schon dagewesen sind (core/hilfe.js).
     Eine Liste und nicht ein Schalter je Hinweis: es kommen welche dazu,
     und jeder neue bräuchte sonst hier einen eigenen Standardwert – und
     eine Einstellungsdatei aus der Zeit davor kennt ihn nicht. */
  hinweiseGesehen: [],
  /* Eigene Heft-Freigaben, zwei Arten nebeneinander:
       { [heftId]: { docId, linkId, url, linkMode } }  geteiltes Dokument
       { [heftId]: { shareId, url, mode } }            ältere Lesekopie
     Siehe core/share.js und ui/share.js. */
  shares: {},
  /* ── Freigaben, die noch zurueckgezogen werden muessen ────────────
     Wer ein freigegebenes Heft ohne Internet loescht, kann die Freigabe
     in dem Augenblick nicht aufheben. Vorher war sie damit fuer immer
     verloren: der Eintrag wurde vergessen, und die Eingeladenen behielten
     das Dokument. Jetzt landet die Kennung hier und wird beim naechsten
     Start nachgeholt (ui/share.js, holeRueckzugNach).
       [{ docId, nbId, name, seit }] */
  offeneRueckzuege: [],
  /* Wann der Tab „Geteilte Dokumente" zuletzt offen war. Alles, was neuer
     ist, gilt als neu – dadurch braucht es keinen eigenen
     Benachrichtigungs-Speicher und keinen zusätzlichen Schreibvorgang in
     Firestore (COLLAB_SPEC.md, Abschnitt 6). */
  sharedDocsSeenAt: 0,
  /* Merkzettel je geteiltem Dokument: der Stand, den dieses Gerät zuletzt
     in den Raum gegeben hat. { [docId]: fingerprint }
     Nur der Besitzer braucht ihn, und nur beim Öffnen: daran erkennt
     ui/sharedDocs.js, was hier seit dem letzten Mal entstanden ist – etwa
     eine Seite, die ohne Verbindung angelegt wurde. Ohne diesen Zettel
     gäbe es dafür keinen Vergleich, und der Raum würde sie verdrängen. */
  liveFingerprints: {},
  /* Wahr, wenn bei der letzten Anmeldung kein ID-Token kam. Dann kennt
     Firebase den Nutzer nicht und die geteilten Dokumente bleiben aus.
     Bei Google passiert das ohne hinterlegtes Client-Secret. */
  cloudIdentityMissing: false,
  /* Nur Microsoft: die nonce aus dem Anmeldeaufruf. Firebase prüft das
     ID-Token dagegen – auch ein später nachgeholtes. */
  cloudAuthNonce: '',
  // Hefte, die noch in die Cloud müssen. Überlebt bewusst einen Neustart:
  // wer ohne Internet arbeitet und die App schließt, hätte sonst nach dem
  // Wiederverbinden nichts, woran der Upload noch hängt.
  cloudPendingUploads: [],
  // Protokoll der letzten Sync-Vorgänge – was wurde wann mit der Cloud
  // abgeglichen? Auch für die Anzeige im Konto-Modal.
  cloudSyncLog: [],
  // Wird gesetzt, sobald eine Sitzung ungewollt endet (Token abgelaufen,
  // Zugriff entzogen). Beim nächsten Start weist die App darauf hin.
  cloudSessionLost: false,
  /* Wahr, sobald der Hinweis auf die abgelaufene Sitzung weggedrückt wurde.
     Sonst stünde er dauerhaft im Kontofenster, auch wenn gar keine erneute
     Anmeldung mehr gewollt ist. Eine neue Anmeldung setzt ihn zurück, damit
     ein späterer Ablauf wieder auffällt. */
  cloudExpiredNoticeDismissed: false
};

// Einstellungen aus früheren Fassungen, die beim Laden entfernt werden.
// cloudProvider und cloudRefreshToken stehen bewusst NICHT hier: die gibt
// es seit der Unterstützung von OneDrive wieder mit neuer Bedeutung.
const OBSOLETE_SETTINGS = [
  'cloudUrl', 'cloudAnonKey',
  'cloudProviderToken', 'cloudProviderRefreshToken', 'useDrive', '_pendingDriveConnect'
];

/* Reste, die nur wegzuräumen sind – ohne Folgen für die Anmeldung.
   >>> Warum getrennt von OBSOLETE_SETTINGS <<<
   Dort zieht ein Fund das Verwerfen der Cloud-Sitzung nach sich, und das
   ist bei diesen Werten richtig: ihr Token taugt nichts mehr. Ein
   ausgemustertes Speicherintervall meldet dagegen niemanden ab. Stünde
   es in derselben Liste, müsste sich beim nächsten Start JEDER neu
   anmelden – jede vorhandene Einstellungsdatei enthält den Wert. */
const STALE_SETTINGS = [
  // Ohne Wirkung: gespeichert wurde ohnehin immer zwei Sekunden nach der
  // letzten Änderung, gleich was dort stand (core/autoSave.js).
  'autoSaveInterval',
  /* Abgelöst von touchDrawOff, das die Frage umdreht. Muss weg, nicht nur
     unbeachtet bleiben: in JEDER vorhandenen Datei steht touchDraw: false,
     und stünde der Wert weiter da, hätte die Umstellung genau bei denen
     keine Wirkung, die sich beschwert haben. */
  'touchDraw'
];

/* Fürs Protokoll: die Einstellungen tragen cloudAccessToken und
   cloudRefreshToken. Sie standen hier im Klartext in der Konsole, und
   main.js reicht die Ausgaben des Fensters zusätzlich ans Terminal
   weiter. Ob ein Token da ist, bleibt ablesbar – der Wert nicht. */
function redactSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  for (const key of Object.keys(out)) {
    if (!/token|secret|refresh|nonce/i.test(key)) continue;
    out[key] = out[key] ? '<gesetzt, ' + String(out[key]).length + ' Zeichen>' : '';
  }
  return out;
}

class SettingsManager {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this._listeners = [];
    this._initialized = false;
    this._loadedFromFile = false;
  }

  async init() {
    console.log('[Settings] Starting initialization...');
    
    // Wait for window.api to be available
    if (!window.api) {
      console.warn('[Settings] window.api not available yet, using defaults');
      return;
    }

    await this.load();

    /* ── Erster Start: Speicherort setzen, aber NICHT fragen ───────────
       Hier stand ein pickFolder() - ein Dialog des Betriebssystems,
       mitten im Hochfahren. Solange er offen stand, kam der ganze Ablauf
       in core/init.js nicht weiter: keine Registry, kein Auto-Speichern,
       keine Cloud. Und vor allem kein Beenden-Handler, weshalb ein
       Zumachen in dieser Zeit acht Sekunden lang wie ein Absturz aussah.

       Ein Dialog, auf den das Programm wartet, gehoert nicht in den
       Start. Genommen wird deshalb sofort der Standardordner
       (Dokumente\Inkwells), und die Frage kommt danach - siehe
       frageNachSpeicherort() unten. Wer nichts aussucht, hat trotzdem
       einen brauchbaren Ort. */
    if (!this.settings.saveLocation) {
      try {
        this.settings.saveLocation = await window.api.getDefaultSavePath();
        this._loadedFromFile = true;
        this.speicherortIstVorgabe = true;   // die Frage steht noch aus
        await this.save();
        console.log('[Settings] Speicherort vorerst:', this.settings.saveLocation);
      } catch (err) {
        console.error('[Settings] Failed to get default path:', err);
      }
    }

    this._initialized = true;
    console.log('[Settings] Initialization complete:', redactSettings(this.settings));
  }

  async load() {
    if (!window.api) {
      console.warn('[Settings] Cannot load, window.api not available');
      return;
    }
    
    try {
      const data = await window.api.loadSettings();
      if (data) {
        this.settings = { ...DEFAULT_SETTINGS, ...data };

        // Reste alter Fassungen wegräumen. Deren Token taugt für Google Drive
        // bzw. OneDrive nichts, deshalb wird eine solche Altsitzung verworfen
        // und der Nutzer meldet sich einmalig neu an.
        let hadObsolete = false;
        for (const key of OBSOLETE_SETTINGS) {
          if (key in this.settings) {
            delete this.settings[key];
            hadObsolete = true;
          }
        }
        if (hadObsolete) {
          this.settings.cloudAccessToken = '';
          this.settings.cloudTokenExpiry = 0;
          console.log('[Settings] Einstellungen aus einer früheren Fassung bereinigt');
        }

        // Still wegräumen, ohne jemanden abzumelden
        for (const key of STALE_SETTINGS) delete this.settings[key];

        this._loadedFromFile = true;
        console.log('[Settings] Loaded from file:', redactSettings(this.settings));
      }
    } catch (err) {
      console.warn('[Settings] Failed to load, using defaults:', err);
    }
  }

  // Returns true if settings were loaded from disk (not just defaults)
  hasSavedSettings() {
    return !!this._loadedFromFile;
  }

  async save() {
    if (!window.api) {
      console.error('[Settings] Cannot save, window.api not available');
      return;
    }
    
    try {
      await window.api.saveSettings(this.settings);
      this._notify();
      console.log('[Settings] Saved successfully');
    } catch (err) {
      console.error('[Settings] Failed to save:', err);
      throw err;
    }
  }

  get(key) {
    return this.settings[key];
  }

  async set(key, value) {
    this.settings[key] = value;
    await this.save();
  }

  async update(updates) {
    Object.assign(this.settings, updates);
    console.log('[Settings] Updated:', updates);
    await this.save();
  }

  getAll() {
    return { ...this.settings };
  }

  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      const idx = this._listeners.indexOf(callback);
      if (idx > -1) this._listeners.splice(idx, 1);
    };
  }

  /* Nur in den Speicher, ohne zu schreiben. Fuer Werte, die sich haeufig
     aendern und deren Verlust nichts kostet – siehe die Merkstelle unten. */
  stash(key, value) {
    this.settings[key] = value;
  }

  _notify() {
    this._listeners.forEach(cb => cb(this.settings));
  }
}

const Settings = new SettingsManager();

/**
 * Holt beim ERSTEN Start die Frage nach dem Speicherort nach.
 *
 * Aufgerufen erst, wenn alles andere steht (core/init.js). Bis dahin
 * arbeitet die App bereits mit dem Standardordner - wer den Dialog
 * wegklickt, verliert also nichts.
 *
 * @returns {Promise<boolean>} ob ein anderer Ort gewaehlt wurde
 */
async function frageNachSpeicherort() {
  if (!Settings.speicherortIstVorgabe) return false;
  Settings.speicherortIstVorgabe = false;      // nur einmal fragen

  if (!window.api || !window.api.pickFolder) return false;

  try {
    const jetzt = Settings.get('saveLocation');
    const gewaehlt = await window.api.pickFolder(jetzt);
    if (!gewaehlt || gewaehlt === jetzt) return false;

    /* Der Ordner wechselt, die Hefte sollen mit. updateAllPaths schreibt
       die Eintraege um; die Dateien selbst bewegt ui/settings.js beim
       gewoehnlichen Wechsel des Ortes. Beim ersten Start gibt es noch
       keine, deshalb genuegt hier der Eintrag. */
    await Settings.update({ saveLocation: gewaehlt });
    if (typeof Registry !== 'undefined' && Registry?.updateAllPaths) {
      await Registry.updateAllPaths(jetzt, gewaehlt);
    }
    console.log('[Settings] Speicherort gewaehlt:', gewaehlt);
    return true;
  } catch (err) {
    console.warn('[Settings] Frage nach dem Speicherort uebersprungen:', err?.message || err);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   WO MAN EIN HEFT ZULETZT VERLASSEN HAT

   Die Seite und der gewaehlte Abschnitt, je Heft.

   >>> Warum das nicht ins Heft gehoert <<<
   Bei einem geteilten Dokument ist es Sache jedes Einzelnen, wo er
   gerade liest. ui/collab.js haelt activeSecId aus genau diesem Grund
   aus dem Struktur-Abgleich heraus – stuende es darin, riss einen das
   Blaettern des anderen mit. Also oertlich, neben den uebrigen
   Einstellungen.

   Geschrieben wird verzoegert: setActivePg laeuft beim Scrollen an jeder
   Seite, und dafuer jedes Mal eine Datei anzufassen waere unsinnig.
   Beim Verlassen des Hefts und vor dem Beenden wird nachgeholt.
   ══════════════════════════════════════════════════════════════════════ */

const VIEW_STATE_KEY = 'notebookViewState';
const VIEW_STATE_MAX = 200;      // sonst waechst die Datei ohne Ende
let _viewStateTimer = null;

function getNotebookView(nbId) {
  if (!nbId) return {};
  const all = Settings.get(VIEW_STATE_KEY);
  return (all && all[String(nbId)]) || {};
}

/** @param {{pageId?: string, secId?: string}} patch */
function rememberNotebookView(nbId, patch) {
  if (!nbId || !patch) return;
  const all = { ...(Settings.get(VIEW_STATE_KEY) || {}) };
  const key = String(nbId);
  const vorher = all[key] || {};
  const nachher = { ...vorher, ...patch };

  if (vorher.pageId === nachher.pageId && vorher.secId === nachher.secId) return;

  // Neu einsortieren, damit das zuletzt Benutzte hinten steht
  delete all[key];
  all[key] = nachher;

  const schluessel = Object.keys(all);
  for (let i = 0; i < schluessel.length - VIEW_STATE_MAX; i++) delete all[schluessel[i]];

  Settings.stash(VIEW_STATE_KEY, all);

  clearTimeout(_viewStateTimer);
  _viewStateTimer = setTimeout(() => { _viewStateTimer = null; Settings.save(); }, 2000);
}

/** Ausstehendes sofort wegschreiben – beim Verlassen und vor dem Beenden. */
function flushNotebookView() {
  if (!_viewStateTimer) return Promise.resolve();
  clearTimeout(_viewStateTimer);
  _viewStateTimer = null;
  return Settings.save();
}
