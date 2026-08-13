'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ÖRTLICHER VERSIONSVERLAUF

   „Wie sah das Heft gestern aus?" ging bisher nur über Google Drive
   (CloudSync_.listVersions). Das setzt dreierlei voraus: eine Anmeldung,
   eine Leitung, und dass Drive überhaupt der gewählte Anbieter ist. Wer
   ohne Konto arbeitet oder gerade im Zug sitzt, hatte gar nichts.

   Hier liegt deshalb ein zweiter, eigener Verlauf – auf der Platte, neben
   den Heften:

       <Speicherort>\Versionen\<nbId>__<zeitstempel>.jrnl

   Der Merkzettel dazu steht in derselben Registry-Datei wie der
   Papierkorb (window.api.loadRegistry), unter `versions`.

   ── Wann ein Stand entsteht ─────────────────────────────────────────
   NICHT bei jedem Speichern. Automatisch gespeichert wird zwei Sekunden
   nach der letzten Änderung; das wären hunderte Dateien am Tag, und
   keine davon hülfe beim Suchen. Stattdessen:

     · höchstens einmal je ABSTAND_MS und Heft,
     · und nur, wenn sich am Inhalt wirklich etwas getan hat.

   Damit entsteht ungefähr das, was man beim Zurückblättern sucht: der
   Stand von vorhin, von heute früh, von gestern.

   ── Warum die Dateien einzeln liegen ────────────────────────────────
   Ein Heft mit Bildern wiegt schnell einige Megabyte. Alle Stände in
   EINE Datei zu legen hieße, sie bei jedem Stand komplett neu zu
   schreiben – und ein Absturz mitten darin nähme den ganzen Verlauf mit.
   Einzelne Dateien kosten nichts und können einzeln kaputtgehen.

   ── Grenzen ────────────────────────────────────────────────────────
   Höchstens MAX_JE_HEFT Stände je Heft und keiner älter als MAX_TAGE.
   Beides wird beim Anlegen eines neuen Standes aufgeräumt; ein
   Hintergrundlauf dafür wäre eine Fehlerquelle ohne Gewinn.
   ══════════════════════════════════════════════════════════════════════ */

const VERSIONS_FOLDER = 'Versionen';

// Frühestens so lange nach dem letzten Stand entsteht der nächste
const VERSIONS_ABSTAND_MS = 20 * 60 * 1000;   // 20 Minuten
const VERSIONS_MAX_JE_HEFT = 25;
const VERSIONS_MAX_TAGE = 30;

const Versions = {
  MAX_TAGE: VERSIONS_MAX_TAGE,

  _entries: [],
  _loaded: false,

  /* Wann zuletzt ein Stand entstand – je Heft. Bewusst nur im Speicher:
     nach einem Neustart darf gleich wieder einer entstehen, der Stand vor
     dem Schließen ist der interessanteste überhaupt. */
  _zuletzt: new Map(),

  async load() {
    if (this._loaded) return this._entries;
    try {
      const data = await window.api.loadRegistry();
      this._entries = Array.isArray(data?.versions) ? data.versions : [];
    } catch (err) {
      console.error('[Versions] Laden fehlgeschlagen:', err);
      this._entries = [];
    }
    this._loaded = true;
    return this._entries;
  },

  /* Geschrieben wird in dieselbe Datei wie der Papierkorb. Deshalb wird
     sie vorher frisch gelesen und nur das eigene Feld ersetzt – sonst
     überschriebe der eine Teil die Änderungen des anderen. */
  async _speichern() {
    try {
      const data = (await window.api.loadRegistry()) || {};
      data.versions = this._entries;
      await window.api.saveRegistry(data);
    } catch (err) {
      console.error('[Versions] Merkzettel konnte nicht geschrieben werden:', err);
    }
  },

  /** Alle Stände eines Hefts, der neueste zuerst. */
  async liste(nbId) {
    await this.load();
    return this._entries
      .filter(e => e.nbId === nbId)
      .sort((a, b) => String(b.wann).localeCompare(String(a.wann)));
  },

  /* ── Einen Stand anlegen ─────────────────────────────────────────── */

  /**
   * Legt einen Stand an, wenn es sich lohnt.
   *
   * Aufgerufen nach jedem erfolgreichen Speichern (core/fileManager.js).
   * Die beiden Bremsen stehen hier und nicht beim Aufrufer, damit es nur
   * eine Stelle gibt, an der die Regel steht.
   *
   * @returns {Promise<object|null>} der Eintrag, oder null wenn nichts geschah
   */
  async vielleichtSichern(notebook, grund = 'auto') {
    if (!notebook || !notebook.id) return null;

    const letzter = this._zuletzt.get(notebook.id) || 0;
    if (Date.now() - letzter < VERSIONS_ABSTAND_MS) return null;

    await this.load();
    const neueste = (await this.liste(notebook.id))[0];
    const abdruck = this._abdruck(notebook);

    // Am Inhalt hat sich nichts getan – ein zweiter gleicher Stand
    // hilft beim Zurückblättern nicht, er verstellt nur die Liste.
    if (neueste && neueste.abdruck === abdruck) {
      this._zuletzt.set(notebook.id, Date.now());
      return null;
    }

    return this.sichere(notebook, grund);
  },

  /**
   * Legt einen Stand an – ohne Wenn und Aber.
   *
   * Für Gelegenheiten, bei denen der Stand wirklich gebraucht wird:
   * bevor eine Version zurückgeholt wird, und bei einem Konflikt
   * (core/conflicts.js).
   *
   * @param {object} notebook
   * @param {string} grund  'auto' | 'vorher' | 'konflikt' | 'fremd'
   */
  async sichere(notebook, grund = 'auto') {
    if (!notebook || !notebook.id) return null;
    await this.load();

    const ordner = this._ordner();
    if (!ordner) {
      console.warn('[Versions] Kein Speicherort – kein Verlauf');
      return null;
    }

    const wann = new Date().toISOString();
    const kennung = this._kennung();
    const pfad = `${ordner}\\${this._dateiname(notebook.id, wann, kennung)}`;

    try {
      const res = await window.api.saveToPath(pfad, { notebooks: [notebook] });
      if (!res || !res.success) {
        console.warn('[Versions] Stand konnte nicht geschrieben werden:', res && res.error);
        return null;
      }
    } catch (err) {
      console.warn('[Versions] Stand konnte nicht geschrieben werden:', err);
      return null;
    }

    const eintrag = {
      id: kennung,
      nbId: notebook.id,
      name: notebook.name || '',
      wann,
      grund,
      pfad,
      seiten: (notebook.pages || []).length,
      abdruck: this._abdruck(notebook)
    };

    this._entries.push(eintrag);
    this._zuletzt.set(notebook.id, Date.now());

    await this._raeumeAuf(notebook.id);
    await this._speichern();
    return eintrag;
  },

  /* ── Zurückholen ─────────────────────────────────────────────────── */

  /** Das Heft aus einem Stand – ohne es einzusetzen. */
  async lade(eintrag) {
    if (!eintrag || !eintrag.pfad) return null;
    try {
      const res = await window.api.loadFromPath(eintrag.pfad);
      if (!res || !res.success) return null;
      const nb = (res.data && res.data.notebooks && res.data.notebooks[0]) || null;
      return nb;
    } catch (err) {
      console.warn('[Versions] Stand konnte nicht gelesen werden:', err);
      return null;
    }
  },

  /**
   * Setzt einen Stand wieder ein.
   *
   * Der AKTUELLE Stand wird vorher gesichert. Ohne das wäre das
   * Zurückholen selbst ein Datenverlust – und zwar der überraschendste
   * von allen, weil man ihn absichtlich ausgelöst hat.
   */
  async stelleHer(eintrag) {
    const alt = await this.lade(eintrag);
    if (!alt) return { success: false, error: 'Stand nicht lesbar' };

    const jetzt = (typeof getNb === 'function') ? getNb(eintrag.nbId) : null;
    if (jetzt) await this.sichere(jetzt, 'vorher');

    /* Kennung und Platz bleiben, alles Übrige kommt aus dem Stand. Die
       Kennung MUSS bleiben: an ihr hängen die Datei, der Registry-Eintrag
       und die Cloud-Datei. */
    const neu = { ...alt, id: eintrag.nbId, updatedAt: new Date().toISOString() };
    delete neu.syncedAt;    // gilt nicht mehr, es ist ein anderer Inhalt

    const idx = S.notebooks.findIndex(nb => nb.id === eintrag.nbId);
    if (idx >= 0) S.notebooks[idx] = neu;
    else S.notebooks.push(neu);

    await FileManager_.saveNotebook(neu, { immediateCloud: true });
    return { success: true, notebook: neu };
  },

  /** Einen Stand loswerden. */
  async loesche(eintrag) {
    await this.load();
    this._entries = this._entries.filter(e => e.id !== eintrag.id);
    try { await window.api.deleteFile(eintrag.pfad); } catch (e) { /* egal */ }
    await this._speichern();
  },

  /* ── Innereien ───────────────────────────────────────────────────── */

  _ordner() {
    const ort = Settings.get('saveLocation');
    return ort ? `${ort}\\${VERSIONS_FOLDER}` : null;
  },

  /* ── Was einen Stand unverwechselbar macht ────────────────────────
     Hier stand allein der Zeitstempel im Dateinamen, und das ging
     schief: zwei Stände in derselben MILLISEKUNDE bekamen denselben
     Namen, der zweite überschrieb den ersten, und danach zeigten beide
     Einträge auf dieselbe Datei.

     Das war kein theoretischer Fall. Bei einem Konflikt werden beide
     Fassungen mit Promise.all nebeneinander weggelegt – sie landeten
     dadurch VERLÄSSLICH aufeinander. Die eigene Fassung war weg, und
     „Meine behalten" holte die fremde zurück. Gefunden hat das
     scripts/test-versions.js.

     Die Kennung geht deshalb in den Dateinamen UND in den Eintrag: das
     Aufräumen greift seither über sie und nicht über den Pfad. */
  _kennung() {
    return (typeof uid === 'function')
      ? uid()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  /* Der Zeitstempel geht in den Dateinamen, aber ohne Doppelpunkte –
     die sind unter Windows in Dateinamen verboten. */
  _dateiname(nbId, wann, kennung) {
    const sicher = String(nbId).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    return `${sicher}__${wann.replace(/[:.]/g, '-')}__${kennung}.jrnl`;
  },

  /* Woran erkannt wird, ob sich etwas getan hat. Bewusst grob: Text,
     Zahl der Striche und Zahl der Objekte je Seite. Bilddaten fließen
     nicht ein – die ändern sich nur zusammen mit den Objekten, und ein
     Hash über einige Megabyte bei jedem Speichern wäre spürbar. */
  _abdruck(notebook) {
    const teile = [notebook.name || '', (notebook.sections || []).length];
    for (const page of (notebook.pages || [])) {
      teile.push(page.id, (page.textContent || '').length,
        (page.inkStrokes || []).length, (page.objects || []).length);
    }
    const roh = teile.join('|');
    let hash = 0x811c9dc5;
    for (let i = 0; i < roh.length; i++) {
      hash ^= roh.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(36) + ':' + roh.length;
  },

  /**
   * Zu viele oder zu alte Stände wegräumen.
   *
   * Stände aus einem Konflikt sind ausgenommen: sie warten auf eine
   * Entscheidung, und sie stillschweigend wegzuräumen hieße, genau die
   * Fassung wegzuwerfen, um die es geht.
   */
  async _raeumeAuf(nbId) {
    const grenze = Date.now() - VERSIONS_MAX_TAGE * 24 * 60 * 60 * 1000;
    const meine = this._entries
      .filter(e => e.nbId === nbId)
      .sort((a, b) => String(b.wann).localeCompare(String(a.wann)));

    const weg = [];
    let behalten = 0;

    for (const e of meine) {
      if (e.grund === 'konflikt' || e.grund === 'fremd') continue;
      behalten++;
      const zuAlt = Date.parse(e.wann) < grenze;
      if (behalten > VERSIONS_MAX_JE_HEFT || zuAlt) weg.push(e);
    }

    if (!weg.length) return;
    /* Über die Kennung und nicht über den Pfad. Beim Pfad genügte ein
       einziger doppelter Dateiname, und das Aufräumen nahm einen
       fremden Eintrag mit – ausgerechnet die Konflikt-Stände, die es
       gerade verschonen soll. */
    const raus = new Set(weg.map(e => e.id));
    this._entries = this._entries.filter(e => !raus.has(e.id));
    for (const e of weg) {
      try { await window.api.deleteFile(e.pfad); } catch (err) { /* egal */ }
    }
  },

  /** Alles zu einem Heft loswerden – wenn das Heft selbst verschwindet. */
  async entferneHeft(nbId) {
    await this.load();
    const weg = this._entries.filter(e => e.nbId === nbId);
    if (!weg.length) return;
    this._entries = this._entries.filter(e => e.nbId !== nbId);
    for (const e of weg) {
      try { await window.api.deleteFile(e.pfad); } catch (err) { /* egal */ }
    }
    await this._speichern();
  }
};

window.Versions = Versions;
