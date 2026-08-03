# Prompt für die nächste Sitzung

> Diesen Text vollständig als ersten Prompt in eine neue Sitzung einfügen.
> Er ist so geschrieben, dass kein früherer Verlauf gebraucht wird.
> Die technische Tiefe steht in `COLLAB_SPEC.md` im selben Ordner.

---

# Auftrag: Geteilte Dokumente & Live-Bearbeitung

Im Projektordner liegt `COLLAB_SPEC.md` — der ausgearbeitete Umsetzungsplan
mit Datenmodell, Firestore-Regeln und Dateiverweisen. **Lies ihn zuerst.**
Dieser Prompt sagt, *was* gebaut werden soll und *in welcher Reihenfolge*;
die Spezifikation sagt, *wie*.

---

## Teil A — Was am Ende dastehen soll

### A1. Tab „Geteilte Dokumente"

Ein eigener Tab neben den eigenen Heften — **in der App und auf der
Website**. Darin alle Dokumente, die mit mir geteilt wurden.

Je Dokument sofort sichtbar:

* **Bearbeiten** oder **Nur lesen**
* von wem geteilt
* zuletzt geändert

Wird die Freigabe aufgehoben, verschwindet das Dokument von selbst wieder
aus dem Tab.

### A2. Teilen — zwei Wege

**Weg 1: Freigabe per Link.**
Der Besitzer legt beim Erstellen fest, was der Link erlaubt:
*nur ansehen* oder *ansehen und bearbeiten*.

* *Im Browser geöffnet:* Das Dokument wird angezeigt. Ist der Besucher
  angemeldet, landet es zusätzlich automatisch in seinem Tab „Geteilte
  Dokumente" — der Link wird danach nicht mehr gebraucht.
* *In der App geöffnet:* Der Browser fragt, ob Inkwell geöffnet werden soll.
  Danach liegt das Dokument ebenfalls im Tab. Erlaubt der Link nur Lesen,
  ist es schreibgeschützt. Erlaubt er Bearbeiten und der Nutzer ist in der
  App angemeldet, kann er sofort mitarbeiten.

**Weg 2: Freigabe an bestimmte E-Mail-Adressen.**
Der Besitzer trägt einzelne Adressen ein und wählt je Adresse *Bearbeiten*
oder *Nur lesen*. Sobald diese Person App oder Website öffnet, erscheint das
Dokument in ihrem Tab — ganz ohne Link.

### A3. Zugriff wieder entziehen

Der Besitzer sieht eine Liste aller Personen, die Zugriff haben — **beide
Wege gemischt**, also eingeladene Adressen *und* Leute, die über den Link
dazugekommen sind. Zu jeder Person:

* Recht ändern (Bearbeiten ↔ Nur lesen)
* **Entfernen** — die Person fliegt sofort aus einer laufenden Sitzung und
  aus ihrem Tab

Wichtig: Wer über den Link kam und entfernt wird, darf **nicht** einfach
denselben Link erneut öffnen und wieder drin sein. Dafür braucht es eine
Sperrliste. Zusätzlich soll der Besitzer den Link **erneuern** können, um
auf einen Schlag alle Link-Zugänge ungültig zu machen.

### A4. Live-Bearbeitung — **nur in der App**

Auf der Website sind geteilte Dokumente **immer schreibgeschützt**, auch
wenn die Person Bearbeitungsrecht hat. Dort steht dann ein deutlicher
Hinweis: „Zum Bearbeiten in der Inkwell-App öffnen" mit Knopf.

In der App, während mehrere gleichzeitig arbeiten:

* Jede Person hat einen **Marker mit ihren Initialen** (z. B. „ES"), der
  zeigt, wo im Dokument sie gerade ist.
* Fremde **Textcursor müssen nicht sichtbar sein** — nur die Markierung.
* **Ganz oben im Dokument** eine Leiste mit allen, die gerade mitarbeiten(wie auf google docs).

### A5. Benachrichtigung

Wird ein Dokument mit mir geteilt, sehe ich das beim nächsten Öffnen von App
oder Website: ein Zähler am Tab und eine kurze Meldung
(„Manuel hat *Mathematik* mit dir geteilt").

---

## Teil B — Was schon entschieden ist

Nicht neu aufrollen:

* **Kein E-Mail-Versand.** Nur die Benachrichtigung in App und Website.
  Damit bleibt das Projekt im kostenlosen Firebase-Spark-Plan.
* **Keine Cloud Functions** (bräuchten den Blaze-Plan). Der in der
  Spezifikation erwähnte Weg über ein *Firebase Custom Token* entfällt
  deshalb — es bleibt beim **ID-Token-Weg**.
* **Live-Bearbeitung nur in der App.** Die Website bleibt Leseansicht.
  Das weicht von `COLLAB_SPEC.md` Abschnitt 5 ab, wo noch beides stand.

---

## Teil C — Die zwei Hürden, die vorher im Weg stehen

Beide sind in `COLLAB_SPEC.md` Abschnitt 0 ausführlich beschrieben. In Kurz:

**C1. Firebase weiß nicht, wer der Nutzer ist.**
Angemeldet wird bei Google/Microsoft — Firebase gegenüber meldet sich nur
das *Gerät* anonym (`ensureOwnerId()` in `website/js/share.js`). Die
Sicherheitsregeln kennen deshalb keine E-Mail-Adresse. **Ohne Lösung ist
Teil A2 Weg 2 und Teil A3 nicht durchsetzbar.**
→ Lösung: das `id_token`, das Google und Microsoft ohnehin schon mitliefern
(der `openid`-Scope wird bereits angefragt), nicht mehr wegwerfen, sondern
per `signInWithCredential` an Firebase weiterreichen.

**C2. Ein Heft ist ein einziger JSON-Klumpen.**
Beim Teilen wird das komplette Heft in einem Stück hochgeladen. Zwei Leute
gleichzeitig — selbst auf verschiedenen Seiten — überschreiben sich
vollständig. **Ohne Zerlegung geht Teil A4 nicht.**
→ Lösung: Seiten und Striche einzeln ablegen (Spezifikation Abschnitt 2).

**Wichtig:** C1 alleine schaltet A1, A2, A3 und A5 frei — also den Großteil
des Auftrags — **ohne C2 anzufassen**. Nur A4 braucht C2.

---

## Teil D — Was genau zu tun ist, in dieser Reihenfolge

### Stufe 1 — Echte Firebase-Identität *(löst C1)*

1. In der Firebase Console *Authentication → Anmeldemethode*: **Google** und
   **Microsoft** aktivieren; beim Microsoft-Anbieter dieselbe Client-ID wie
   in `src/core/cloudConfig.js`. → **Das muss der Nutzer tun. Sag ihm
   genau, was zu klicken ist, bevor du auf das Ergebnis baust.**
2. `id_token` durchreichen statt verwerfen — in `completeAuth()` von
   `src/core/providers/googleDrive.js` und `.../oneDrive.js` sowie im
   Web-Gegenstück `website/js/providers.js`.
   * Google liefert es nur im **Code-Flow**. Ohne Client-Secret
     (`GOOGLE_CONFIG.CAN_REFRESH === false`) läuft der Implicit-Flow und es
     gibt kein ID-Token → dann klaren Hinweis zeigen, nicht scheitern.
   * Microsoft verlangt eine **`nonce`** im Auth-Request, die beim
     `signInWithCredential` als `rawNonce` wieder mitgegeben wird.
3. In `website/js/share.js` neben `ensureOwnerId()` eine echte Anmeldung
   ergänzen. `signInAnonymously()` bleibt als Rückfall für Leser ohne Konto
   — die dürfen weiterhin nur lesen.
4. Bestehende Freigaben umschreiben: beim ersten Anmelden mit echter
   Identität den `owner` der eigenen Einträge auf die neue UID setzen
   (Quelle: `Settings.get('shares')` bzw. `localStorage.inkwell_shares`).

**Fertig, wenn:** in den Firestore-Regeln `request.auth.token.email` steht
und eine bestehende Freigabe sich auch auf einem zweiten Gerät aufheben
lässt.

### Stufe 2 — Tab „Geteilte Dokumente" + Link mit Leserecht *(A1, A2 Weg 1)*

* Tab in der App (`src/index.html` `#view-home`, `src/ui/homeGrid.js`) und
  im Dashboard (`website/dashboard/`).
* Die Liste kommt aus **einer** Abfrage:
  `where('memberEmails', 'array-contains', meineEmail)` — keine zweite
  Datenhaltung. Dadurch verschwindet Entzogenes von selbst.
* Beim Öffnen eines Links trägt sich der angemeldete Besucher selbst ein
  (Regel dafür steht in der Spezifikation, Abschnitt 4.1).
* **Nur-Lese-Modus in der App bauen** — gibt es noch gar nicht:
  `src/app.js` setzt `contentEditable = 'true'` ausnahmslos. Es braucht
  `S.readOnly`, gesperrtes Zeichnen (`src/canvas/input.js`) und eine
  abgeblendete Werkzeugleiste.

### Stufe 3 — Freigabe per E-Mail, Rollen, Entfernen *(A2 Weg 2, A3)*

* Im Freigabe-Dialog ein Bereich zum Hinzufügen von Adressen mit Rolle.
* Darunter die **Personenliste**: eingeladene Adressen und Link-Beitritte
  gemischt, je Zeile Rolle ändern und Entfernen.
* **Sperrliste** (`blockedEmails`), damit Entfernte nicht über denselben
  Link zurückkommen.
* **„Link erneuern"** — erzeugt eine neue `linkId` und macht alle alten
  Link-Zugänge ungültig.
* Adressen vor dem Speichern kleinschreiben und trimmen, sonst greift
  `array-contains` nicht. Zusätzlich `email_verified` prüfen.

### Stufe 4 — „In Inkwell öffnen" *(A2 Weg 1, Fall 2)*

* Das Protokoll `inkwell://` ist bereits registriert (`main.js`), aber
  **jeder** Aufruf landet heute beim OAuth-Callback. Eine Weiche für
  `inkwell://share/<linkId>` einbauen, eigenes Ereignis `open-share`,
  in `preload.js` ein `onOpenShare(cb)`.
* Auf `/s/` einen Knopf **„In Inkwell öffnen"**.
* Ist in der App niemand angemeldet: schreibgeschützt zeigen mit Hinweis.

### Stufe 5 — Benachrichtigung in der App *(A5)*

* Kein eigener Benachrichtigungs-Speicher. Zeitpunkt der letzten Ansicht
  lokal merken, alles Neuere gilt als neu → Zähler am Tab plus kurze
  Meldung beim Start. Kostet keinen zusätzlichen Schreibvorgang.

### **Hier anhalten und berichten.**

Stufe 6 (Datenmodell zerlegen) und alles Weitere für A4 ist ein Umbau. Erst
die offenen Fragen in Teil F klären.

### Später — Live-Bearbeitung *(A4, nur App)*

Reihenfolge laut Spezifikation Abschnitt 5.2: Anwesenheit und Marker →
Seitensperren → Handschrift anhängen → Text mit CRDT. Zeichengenaue Marker
ergeben erst im letzten Schritt Sinn; davor zeigt der Marker die **Seite**,
auf der die Person gerade ist.

---

## Teil E — Was dabei nicht kaputtgehen darf

* **Bestehende Freigaben** (`shared_notebooks`) müssen weiterlaufen. Neues
  kommt daneben, nicht darüber.
* **Geteilte Hefte dürfen nicht in die normale Heft-Verwaltung geraten** —
  sonst lädt die App des Empfängers fremde Hefte in *sein* Google Drive.
  Abzufangen in `fileManager.js`, `registry.js`, `autoSave.js`,
  `cloudSync.js`, `trash.js`. Vorschlag: Kennzeichen `nb.origin = 'shared'`
  und je eine Prüfung am Anfang der betroffenen Funktionen.
* **Die Anmeldung darf nicht brechen.** Wer kein Google-Client-Secret
  hinterlegt hat, muss die App normal weiter benutzen können — dann eben
  ohne die neuen Freigabe-Funktionen, mit klarem Hinweis statt Fehler.
* **Der Export** (PDF/Word) muss auch für geteilte Dokumente funktionieren.

---

## Teil F — Nicht selbst entscheiden, sondern fragen

1. Wie weit soll die Live-Bearbeitung gehen? Seitensperren („zu zweit an
   einem Heft, aber nicht auf derselben Seite") sind ein Bruchteil des
   Aufwands von echtem gleichzeitigem Tippen.
2. Was passiert mit der Drive-Datei des Besitzers, solange ein Heft geteilt
   ist — bleibt sie die Sicherung, oder ruht sie?

---

## Teil G — Arbeitsweise in diesem Projekt

* **Kommentare und Oberflächentexte auf Deutsch**, im Stil der vorhandenen
  Dateien: erklären, *warum* etwas so ist, nicht *was* die Zeile tut.
* **Drei Sprachen.** Neue Texte immer de/en/it — in
  `src/core/translations.js` (App) und `website/js/i18n.js` (Web).
* **Geteilte Module.** `src/core/share.js` und `src/core/docx.js` sind die
  Originale, `website/js/*` erzeugte Kopien. Nach jeder Änderung
  `npm run sync-share`; vor `npm run deploy-web` läuft es von selbst.
  Nie andersherum bearbeiten — `website/` liegt nur örtlich und würde den
  Stand des anderen überschreiben.
* **Kein `npm install` ohne Rückfrage.** Das Projekt kommt bewusst mit sehr
  wenigen Abhängigkeiten aus. (Gilt auch für Yjs — vorher fragen.)
* Lieber **eine Stufe fertig und geprüft** als fünf halb.

---

## Teil H — Wie geprüft wird

* `node --check <datei>` für jede geänderte JS-Datei.
* `node scripts/sync-share.js --check`
* Website ansehen: `node scripts/serve-website.js` starten, dann mit dem
  vorhandenen Electron ein Fenster beliebiger Breite laden und
  `capturePage()` aufrufen. Überlauf messen mit
  `document.documentElement.scrollWidth` gegen `clientWidth`.
* Dashboard ohne echtes Konto: Sitzung in `localStorage` vortäuschen
  (`inkwell_cloud_token/uid/expiry/email/provider`). Die Cloud-Abfrage
  scheitert dann, die Oberfläche baut sich trotzdem auf.
* **Die App nicht einfach starten** — sie läuft gegen echte Notizbücher und
  ein echtes Cloud-Konto und gleicht beim Start ab.
