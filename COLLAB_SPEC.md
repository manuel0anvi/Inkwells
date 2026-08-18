# Live-Bearbeitung & Geteilte Dokumente — Umsetzungsplan

> Stand: 1. August 2026 · Ergänzt die Wunschliste um das, was technisch
> dazugehört, damit es am Ende wirklich funktioniert.
>
> Reihenfolge ist nicht beliebig: Abschnitt 1 und 2 sind Voraussetzung für
> alles Weitere. Wer bei Abschnitt 4 anfängt, baut auf Sand.

---

## 0. Die drei Blockaden, die zuerst gelöst werden müssen

Die Wunschliste ist umsetzbar, aber drei Dinge stehen dem heutigen Stand
grundsätzlich im Weg. Sie sind keine Details, sondern bestimmen, was
überhaupt gebaut werden kann.

### 0.1 Inkwells kennt bei Firebase niemanden

Angemeldet wird über Google bzw. Microsoft — aber **nicht bei Firebase**.
Für die Freigabe meldet sich das Gerät bei Firebase *anonym* an
([`website/js/share.js`](website/js/share.js), `ensureOwnerId()`). In den
Sicherheitsregeln steht deshalb nur eine zufällige Gerätekennung zur
Verfügung, keine E-Mail-Adresse.

**Folge:** „Freigabe für bestimmte E-Mail-Adressen" ist heute schlicht
nicht durchsetzbar. Eine Regel wie
`allow read: if request.auth.token.email in resource.data.memberEmails`
braucht eine echte Firebase-Identität.

**Zweite Folge:** Der Besitz einer Freigabe hängt am Gerät, nicht am Konto.
Wer den Browser-Speicher leert oder das Gerät wechselt, kann seine eigene
Freigabe nicht mehr aufheben.

→ Lösung in **Abschnitt 1**. Ohne diesen Schritt geht von der Wunschliste
nur „Freigabe per Link, nur lesen" — also genau das, was es schon gibt.

### 0.2 Ein Heft ist ein einziger JSON-Klumpen

Beim Freigeben wird das komplette Heft als ein `JSON.stringify` erzeugt und
in 700-KB-Stücke geschnitten. Zwei Personen, die gleichzeitig auf
*verschiedenen* Seiten schreiben, überschreiben sich vollständig — der
Letzte gewinnt, und zwar über das ganze Heft.

→ Lösung in **Abschnitt 2**. Ohne Zerlegung ist Live-Bearbeitung nur mit
harten Sperren möglich (immer nur einer schreibt).

### 0.3 ~~E-Mails verschicken braucht einen Server~~ — entschieden: entfällt

Ein Versand von Benachrichtigungs-E-Mails bräuchte den kostenpflichtigen
Blaze-Plan. **Bewusst verworfen.** Es bleibt bei der Benachrichtigung in der
App und auf der Website — die kostet nichts und deckt den Zweck ab.
Damit bleibt das Projekt im kostenlosen Spark-Plan. Siehe **Abschnitt 6**.

---

## 1. Fundament: echte Identität bei Firebase

**Ziel:** `request.auth.uid` und `request.auth.token.email` stehen in den
Firestore-Regeln zur Verfügung — auf der Website *und* in der App.

### Was zu tun ist

1. **Firebase Console:** Unter *Authentication → Anmeldemethode* die
   Anbieter **Google** und **Microsoft** aktivieren. Beim Microsoft-Anbieter
   dieselbe Anwendungs-ID (Client-ID) eintragen wie in
   [`src/core/cloudConfig.js`](src/core/cloudConfig.js).

2. **ID-Token einsammeln.** Heute wird es weggeworfen:
   - [`src/core/providers/googleDrive.js`](src/core/providers/googleDrive.js)
     `completeAuth()` gibt nur `accessToken`, `refreshToken`, `expiresIn`
     zurück. Die Antwort des Token-Endpunkts enthält bei `openid`-Scope auch
     ein `id_token` — dieses Feld mit durchreichen.
   - Dasselbe in
     [`src/core/providers/oneDrive.js`](src/core/providers/oneDrive.js).
   - **Achtung:** Google liefert ein `id_token` nur im *Code-Flow*. Ohne
     hinterlegtes Client-Secret (`GOOGLE_CONFIG.CAN_REFRESH === false`)
     läuft die Anmeldung als Implicit-Flow und liefert **kein** ID-Token.
     Das Client-Secret wird damit von „optional" zu „Voraussetzung".
   - **Achtung Microsoft:** Firebase verlangt beim Prüfen des Microsoft-
     ID-Tokens eine `nonce`. Die muss in `buildAuthRequest()` mitgeschickt
     und beim `signInWithCredential` als `rawNonce` wieder mitgegeben
     werden. Fehlt sie, lehnt Firebase das Token ab.

3. **Bei Firebase anmelden**, sobald ein ID-Token vorliegt:
   ```js
   // Google
   signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
   // Microsoft
   signInWithCredential(auth,
     new OAuthProvider('microsoft.com').credential({ idToken, rawNonce }));
   ```
   Der Aufruf gehört in `share.js` neben `ensureOwnerId()`.
   `signInAnonymously()` bleibt als Rückfall für Leser, die den Link ohne
   Konto öffnen — die dürfen weiterhin nur lesen.

4. **Bestandsschutz.** Freigaben, die heute existieren, gehören einer
   anonymen UID. Beim ersten Anmelden mit echter Identität die eigenen
   Einträge aus `Settings.get('shares')` bzw. `localStorage.inkwells_shares`
   durchgehen und den `owner` auf die neue UID umschreiben. Die Regel für
   `update` erlaubt das dem bisherigen Besitzer.

### Falls das zu mühsam wird

Alternative: eine Cloud Function, die den vorhandenen Google-/Microsoft-
Zugriffstoken prüft und daraus ein *Firebase Custom Token* erzeugt. Deutlich
weniger Fummelei an den Anbietern — aber Blaze-Plan. Wenn ohnehin für die
E-Mails auf Blaze gewechselt wird, ist das der sauberere Weg.

**Entscheidung nötig:** ID-Token-Weg (kostenlos, fummelig) oder
Custom-Token-Weg (bequem, Blaze). → siehe Abschnitt 9.

---

## 2. Fundament: Datenmodell zerlegen

**Ziel:** Änderungen sind kleinteilig, damit sich zwei Personen nicht
gegenseitig überschreiben.

### Struktur in Firestore — umgesetzt

```
docs/{docId}                          Kopf
  ├─ owner, ownerEmail, ownerName
  ├─ title, color, defaultBg, notebookId
  ├─ format           'pages' = zerlegt (ohne = alte Klumpenform)
  ├─ linkMode         'off' | 'view' | 'edit'
  ├─ linkId           zufällige 22 Zeichen (nur wenn linkMode ≠ 'off')
  ├─ memberEmails     ['a@x.de', 'b@y.de']      ← für die Abfrage
  ├─ members          { 'a@x.de': 'edit' }      memberVia, blockedEmails
  ├─ pageOrder [pageId, …], sections, pageCount
  ├─ revision         Zähler, kein Schloss mehr
  │
  ├─ pages/{pageId}                   eine Seite = ein Dokument
  │    ├─ index, bg, w, h, date
  │    ├─ text          HTML-String (ab Stufe 10: CRDT-Zustand)
  │    ├─ objects       ohne Bilddaten – die stehen als "blob:<ref>" drin
  │    └─ hasBg, by, updatedAt
  │
  ├─ ink/{pageId__n}                  Handschrift, bogenweise
  │    └─ pageId, no, strokes[], by
  │
  ├─ blobs/{ref__i}                   Bilder/PDF-Seiten, gestückelt
  │    └─ ref, pageId, i, total, data
  │
  └─ chunks/{i}                       alte Klumpenform, nur noch zum Lesen
```

### Warum so

- **Seiten einzeln:** Zwei Leute auf verschiedenen Seiten stören sich nicht.
- **Bilder getrennt:** Ein Foto darf nicht bei jeder Textänderung erneut
  übertragen werden. Deshalb raus aus der Seite.
- **Handschrift in Bögen statt ein Strich = ein Dokument.** Hier weicht die
  Umsetzung bewusst vom ursprünglichen Plan ab. Die Rechnung: eine
  handgeschriebene Seite hat 200–400 Striche, ein Heft mit 20 Seiten also
  mehrere tausend. Ein Strich je Dokument hieße ebenso viele Lesevorgänge
  je Öffnen — der Spark-Plan erlaubt 50.000 pro Tag für das *ganze*
  Projekt. Das wären ein paar Dutzend Öffnungen täglich, für alle Nutzer
  zusammen.

  Stattdessen: je Seite ein oder mehrere Bögen mit einer Strichliste, neue
  Striche werden per `arrayUnion` angehängt. Die entscheidende Eigenschaft
  bleibt erhalten — Firestore führt zwei gleichzeitige `arrayUnion` auf
  demselben Feld zusammen, zwei Leute können also gleichzeitig auf
  derselben Seite zeichnen und es kommen **beide** Striche an. Wird ein
  Bogen zu groß (Dokumentgrenze 1 MiB), fängt der nächste an.

  Radieren ist der einzige Fall, der überschreibt: dann werden die Bögen
  dieser Seite neu geschrieben. Radieren *ist* nun einmal ein Entfernen.

### Was umgesetzt ist

- Umwandler in beide Richtungen: `splitNotebook()` / `assembleNotebook()`
  in [`website/js/share.js`](website/js/share.js) — bewusst reine
  Funktionen ohne Firestore, geprüft von
  [`scripts/test-doc-split.js`](scripts/test-doc-split.js) (`npm test`,
  läuft auch im Build).
- `loadDocument()` liefert weiterhin ein vollständiges `notebook`-Objekt.
  Dadurch mussten Betrachter, Editor, Export und `docx.js` **nicht**
  angefasst werden — nur die Ablage ist zerlegt, nicht die Oberfläche.
- Freigaben in der alten Klumpenform werden weiter gelesen und beim ersten
  Speichern durch den Besitzer auf das neue Format gehoben.
- `saveDocumentContent()` schreibt nur noch, was sich geändert hat. Der
  Vergleich läuft über einen Merkzettel (`fingerprintNotebook()`), den der
  Client beim Laden bekommt.
- `publishNotebook()` für die eingefrorene Lesekopie bleibt unverändert
  daneben bestehen.

---

## 3. Tab „Geteilte Dokumente"

**In der App:** neben „Meine Hefte" auf der Startseite
([`src/ui/homeGrid.js`](src/ui/homeGrid.js),
[`src/index.html`](src/index.html) `#view-home`).
**Auf der Website:** neben dem Raster im Dashboard
([`website/dashboard/index.html`](website/dashboard/index.html)).

### Inhalt je Karte

- Heftname und Farbe wie gewohnt
- **Rolle als Abzeichen:** `Bearbeiten` (gold) / `Nur lesen` (grau)
- Besitzer: Name oder E-Mail
- Zuletzt geändert
- Bei entzogener Freigabe: verschwindet die Karte beim nächsten Laden

### Wie die Liste zustande kommt

Eine einzige Abfrage, keine zweite Datenhaltung:

```js
query(collection(db, 'docs'),
      where('memberEmails', 'array-contains', meineEmail))
```

Passende Regel:

```
match /docs/{docId} {
  allow list, get: if request.auth != null
                   && request.auth.token.email in resource.data.memberEmails;
}
```

**Der Vorteil:** Wird jemand aus `memberEmails` entfernt, verschwindet das
Dokument beim nächsten Laden von selbst — es braucht kein Aufräumen und
keine zweite Liste, die auseinanderlaufen kann. Genau das fordert die
Wunschliste („Entfernte Freigaben verschwinden automatisch wieder").

### Wichtig: geteilte Hefte sind keine eigenen Hefte

Das ist die Stelle, an der es sonst still kaputtgeht. Ein geteiltes Dokument
darf **nicht** in die vorhandene Heft-Verwaltung geraten, sonst lädt die App
des Empfängers fremde Hefte in *sein* Google Drive hoch.

Zu sperren sind:

| Datei | Was |
|---|---|
| [`src/core/fileManager.js`](src/core/fileManager.js) | `saveNotebook()` — kein `.jrnl` schreiben |
| [`src/core/registry.js`](src/core/registry.js) | nicht in die Übersichtsliste aufnehmen |
| [`src/core/autoSave.js`](src/core/autoSave.js) | `markDirty()` → in den Raum schreiben, nicht in die Datei |
| [`src/core/cloudSync.js`](src/core/cloudSync.js) | `queueNotebook()` überspringen |
| [`src/core/trash.js`](src/core/trash.js) | „Löschen" heißt hier „Freigabe verlassen" |

Vorschlag: ein Kennzeichen `nb.origin = 'shared'` und je eine Prüfung
gleich am Anfang der genannten Funktionen.

---

## 4. Teilen

### 4.1 Per Link

Der Freigabe-Dialog bekommt eine zweite Frage neben „Was zeigt der Link?":

> **Was darf, wer den Link hat?**
> ○ Nur ansehen  ○ Ansehen und bearbeiten

Betrifft [`src/index.html`](src/index.html) `#ov-share`,
[`src/ui/share.js`](src/ui/share.js) und den Dialog im
[Dashboard](website/dashboard/index.html).

**Fall 1 — im Browser bleiben**
`/s/?id=<linkId>` öffnet das Dokument wie bisher. Ist der Besucher
angemeldet, wird seine E-Mail beim Öffnen in `memberEmails` aufgenommen
(Rolle aus `linkMode`). Damit taucht es ab sofort im Tab auf und der Link
wird nicht mehr gebraucht.

Nötige Regel — nur *sich selbst* darf man eintragen, und nur wenn ein Link
mit passendem Recht besteht:

```
allow update: if request.auth != null
              && resource.data.linkMode in ['view', 'edit']
              && request.resource.data.diff(resource.data)
                   .affectedKeys().hasOnly(['memberEmails', 'members'])
              && request.auth.token.email in request.resource.data.memberEmails;
```

**Fall 2 — in der App öffnen**
Die Grundlage ist schon da: `inkwells://` ist als Protokoll registriert
([`main.js:553`](main.js#L553)), Aufrufe kommen über `second-instance`,
`open-url` und `getPendingDeepLink` an.

Zu tun:
- In [`main.js`](main.js) die Weiche einbauen. Heute landet **jeder**
  `inkwells://`-Aufruf beim Ereignis `oauth-callback`. Künftig:
  `inkwells://share/<linkId>` → eigenes Ereignis `open-share`.
- In [`preload.js`](preload.js): `onOpenShare(cb)` ergänzen.
- Auf der Seite `/s/` einen Knopf **„In Inkwells öffnen"**, der auf
  `inkwells://share/<linkId>` zeigt. Der Browser fragt dann selbst, ob die
  App geöffnet werden soll.
- Ist in der App niemand angemeldet: Dokument im Nur-Lese-Modus zeigen und
  einen Hinweis einblenden, dass Bearbeiten eine Anmeldung braucht.

### 4.2 Per E-Mail

Im selben Dialog ein zweiter Bereich:

```
E-Mail hinzufügen  [____________________]  [Nur lesen ▾]  [+]

manuel@example.com      Bearbeiten ▾   ✕
sarah@example.com       Nur lesen  ▾   ✕
```

- Schreibt in `memberEmails` (Feld für die Abfrage) und `members`
  (Rolle je Adresse).
- Nur der Besitzer darf diese Felder frei ändern:
  `allow update: if resource.data.owner == request.auth.uid`
- `✕` entfernt die Adresse — das ist zugleich „Nutzer aus der Sitzung
  entfernen" aus der Wunschliste.
- Adressen normalisieren (Kleinschreibung, trimmen), sonst greift
  `array-contains` nicht.

**Grenze, die man kennen muss:** E-Mail-Adressen sind in den Regeln nur so
verlässlich wie der Anbieter. `request.auth.token.email` stammt aus dem
Google-/Microsoft-Konto und ist dort bestätigt — das ist in Ordnung.
Zusätzlich `email_verified` prüfen.

### 4.3 Zugriff entziehen — auch bei Link-Zugängen

Die Personenliste zeigt **beide Wege gemischt**: eingeladene Adressen und
alle, die über den Link dazugekommen sind. Sonst könnte der Besitzer genau
die Leute nicht entfernen, die er nie eingeladen hat.

Zwei Felder mehr im Kopf-Dokument:

```
blockedEmails   ['weg@example.com']   Entfernte kommen per Link nicht zurück
linkId          wird beim Erneuern ausgetauscht
```

- **Entfernen** streicht die Adresse aus `memberEmails`/`members` und setzt
  sie auf `blockedEmails`. Ohne diese Sperrliste könnte die Person den Link
  einfach noch einmal öffnen und wäre wieder drin — der Selbsteintrag aus
  Abschnitt 4.1 würde sie erneut aufnehmen.
- Die Regel für den Selbsteintrag muss das prüfen:
  `&& !(request.auth.token.email in resource.data.blockedEmails)`
- **„Link erneuern"** erzeugt eine neue `linkId`. Damit sind alle alten
  Link-Zugänge auf einen Schlag ungültig, ohne jede Adresse einzeln
  entfernen zu müssen. Bereits eingetragene Mitglieder bleiben.
- **Aus der laufenden Sitzung werfen:** Jeder Client hört ohnehin auf das
  Kopf-Dokument. Verschwindet die eigene Adresse aus `memberEmails`,
  schließt er das Dokument und zeigt einen Hinweis. Die Regeln blockieren
  parallel jedes weitere Schreiben — auf den Anstand des Clients wird sich
  also nicht verlassen.

---

## 5. Live-Bearbeitung

> **Nur in der App.** Auf der Website bleiben geteilte Dokumente immer
> schreibgeschützt — auch für Personen mit Bearbeitungsrecht. Dort steht
> stattdessen ein Hinweis „Zum Bearbeiten in der Inkwells-App öffnen" mit
> Knopf auf `inkwells://share/<linkId>`.
>
> Das spart den gesamten Abschnitt 5 auf der Website: keine Anwesenheit,
> keine Sperren, kein CRDT im Browser. Die Leseansicht muss lediglich
> mitbekommen, wenn sich etwas geändert hat, und neu zeichnen.

### 5.1 Anwesenheit und Marker

**Vorschlag: Firebase Realtime Database statt Firestore** für diesen Teil.
Grund: Die RTDB kennt `onDisconnect()` — verschwindet jemand, wird sein
Eintrag automatisch entfernt. Firestore kann das nicht; dort bräuchte es
Herzschläge und Aufräumen. Außerdem ist die RTDB für viele winzige
Änderungen deutlich billiger.

```
presence/{docId}/{uid}
  ├─ initials   "ES"
  ├─ name, email
  ├─ color      aus der uid abgeleitet, damit sie stabil bleibt
  ├─ pageId     wo die Person gerade ist
  ├─ offset     Position im Text (erst ab Stufe 3 sinnvoll)
  └─ at         Zeitstempel
```

- **Leiste oben im Dokument:** runde Abzeichen mit Initialen, Tooltip mit
  vollem Namen. Bei mehr als fünf Personen `+3`.
- **Marker am Seitenrand:** kleines Abzeichen mit den Initialen, zeigt, wer
  auf dieser Seite ist. Sitzt *innerhalb* der Seite, weil `.j-page` alles
  abschneidet, was darüber hinausragt.
- **Schreibmarken im Text:** ein farbiger Strich genau an der Stelle, an der
  die Person steht, mit Namensschild darüber — wie bei Google Docs.

  Ursprünglich war das ausdrücklich *nicht* gewollt („kein fremder Cursor
  im Text"), später doch. Möglich wurde es erst mit Stufe 10: die Position
  ist ein Abstand in Zeichen, und der ergibt nur dann bei allen dasselbe,
  wenn auch der Text bei allen derselbe ist. Genau das stellt das CRDT
  sicher.

  Die Umrechnung Abstand → Bildschirmposition macht `rangeForTextOffset()`
  in [`src/canvas/text.js`](src/canvas/text.js) — die Umkehrung des schon
  vorhandenen `getCaretTextOffset()`. Der Zoom wird herausgerechnet, weil
  die Marke innerhalb der Seite sitzt und dort die Grundgröße gilt.
- **Schreibtakt begrenzen:** höchstens ein Positions-Update pro Sekunde,
  sonst wird jeder Tastendruck zu einem Schreibvorgang. Gemeldet wird über
  `selectionchange` — das einzige Ereignis, das auch bei Pfeiltasten und
  Klicks kommt.
- Initialen aus dem Anzeigenamen: erste Buchstaben der ersten zwei Wörter,
  ersatzweise die ersten zwei Zeichen der E-Mail.

### 5.2 Gleichzeitig ändern — umgesetzt

**Handschrift.** Striche werden nur angehängt, nie überschrieben. Beim
Loslassen des Stifts geht der fertige Strich sofort über die RTDB an die
anderen; dauerhaft landet er beim nächsten Speichern in Firestore, per
`arrayUnion` in den Bogen der Seite. Firestore führt zwei gleichzeitige
`arrayUnion` zusammen — zwei Leute auf derselben Seite ergeben also
*beide* Striche, und das ist das richtige Ergebnis.

Radieren ist der einzige Fall, der überschreibt (die Bögen der Seite
werden neu geschrieben). Radieren *ist* nun einmal ein Entfernen.

**Text.** Der Editor bleibt ein `contenteditable` mit einem HTML-String je
Seite — er musste **nicht** umgebaut werden. Stattdessen hält Yjs genau
diesen String als `Y.Text`:

- Beim Tippen wird verglichen, *welche eine Stelle* sich geändert hat
  (`textDelta` in [`src/ui/collab.js`](src/ui/collab.js)), und nur die
  wandert in den gemeinsamen Text. Möglichst wenig anfassen ist hier keine
  Sparsamkeit, sondern Voraussetzung: jede angefasste Stelle kann mit der
  Änderung eines anderen kollidieren.
- Änderungen fließen als Yjs-Updates über die RTDB.
- Kommt etwas von außen, wird der Absatz neu gesetzt und die Schreibmarke
  über ihren Textabstand wiederhergestellt (`getCaretTextOffset` /
  `setPlainCaret`, beide gab es schon).
- Gesichert wird zweierlei: `text` (fertiges HTML, für Betrachter, Export,
  Suche und die Website) und `ycrdt` (der Yjs-Zustand, beim Bearbeiten
  maßgeblich).

> **Der Fallstrick, der fast übersehen wurde:** Öffnen zwei Leute
> gleichzeitig ein Dokument ohne `ycrdt`, legen beide einen ersten Stand
> an. Mit zufälliger Client-Kennung wären das für Yjs zwei *verschiedene*
> Texte — nach dem Zusammenführen stünde alles doppelt da. Deshalb wird
> der erste Stand mit einer **festen** Kennung erzeugt: beide erzeugen
> dann exakt dasselbe, und das Zusammenführen ist wirkungslos. Geprüft in
> [`scripts/test-collab-text.js`](scripts/test-collab-text.js).

**Grenze, die man kennen muss:** Zwei Leute, die im selben Moment dieselbe
Stelle *formatieren* (fett, Überschrift), können ein Tag-Paar
ineinanderschieben. Der Text bleibt erhalten, die Auszeichnung kann
verrutschen. Beim Arbeiten an verschiedenen Absätzen — dem Normalfall —
tritt das nicht auf. Wer das ausschließen will, bräuchte eine
CRDT-Darstellung des Dokumentbaums (`Y.XmlFragment`) und damit doch den
Umbau des Editors.

### 5.3 Nur-Lese-Modus

Gibt es bisher nicht — [`src/app.js:262`](src/app.js#L262) setzt
`contentEditable = 'true'` ausnahmslos.

Zu tun:
- `S.readOnly` einführen und dort auswerten
- Zeichnen sperren: `attachInput()` in
  [`src/canvas/input.js`](src/canvas/input.js)
- Werkzeugleiste abblenden bis auf Zoom und Export
- Sichtbarer Hinweis oben: „Nur lesen — freigegeben von Manuel"

### 5.4 Ohne Internet

Ein geteiltes Dokument ohne Netz zu bearbeiten geht in Stufe 1 und 2 nicht
sicher — die Sperre lässt sich nicht halten. Dann: Nur-Lese-Modus mit
Hinweis. Erst ein CRDT (Stufe 3) kann das ehrlich, weil es beim
Wiederverbinden von selbst zusammenführt.

---

## 6. Benachrichtigungen

### In der App und auf der Website — ohne Zusatzkosten

Kein eigener Benachrichtigungs-Speicher nötig. Der Zeitpunkt der letzten
Ansicht des Tabs wird lokal gemerkt; alles, was neuer ist, gilt als neu:

- Zähler-Abzeichen am Tab „Geteilte Dokumente"
- Beim Start eine kurze Meldung: „Manuel hat *Mathematik* mit dir geteilt"
- Gelesen-Zeitpunkt in `Settings` bzw. `localStorage`

Kostet keinen einzigen zusätzlichen Schreibvorgang.

### Per E-Mail — verworfen

Bräuchte den Blaze-Plan (Cloud Function oder die Erweiterung *Trigger
Email* plus SMTP-Zugang). **Ist nicht Teil des Vorhabens.** Falls es später
doch gewünscht wird, ist es ein Anbau, kein Umbau — die Freigabe weiß
ohnehin schon, wen sie betrifft.

---

## 7. Was dabei nicht kaputtgehen darf

- **Bestehende Freigaben** (`shared_notebooks`) müssen weiter funktionieren.
  Die neue Struktur (`docs`) kommt daneben, nicht darüber.
- **Der Export** (PDF/Word) muss auch für geteilte Dokumente laufen —
  [`website/js/docx.js`](website/js/docx.js) erwartet
  `{ page, bg, headerLeft, headerRight }`, das lässt sich aus der neuen
  Struktur genauso bauen.
- **Zwei Wahrheiten vermeiden.** Für ein geteiltes Dokument ist der Raum in
  Firestore die maßgebliche Fassung, nicht die Drive-Datei. Beides parallel
  zu pflegen wäre die Quelle künftiger Fehler. Beim Besitzer: entweder das
  Heft ist geteilt (Raum führt) oder nicht (Datei führt) — kein Zwischending.
- **Papierkorb und Konfliktkopien** aus `cloudSync.js` dürfen geteilte
  Dokumente nicht anfassen.

---

## 8. Reihenfolge der Umsetzung

> **Alle Stufen sind umgesetzt.** Stand: 1. August 2026.

| Stufe | Inhalt | Ergebnis | wo |
|---|---|---|---|
| ✅ **1** | Firebase-Identität (Abschnitt 1) | Regeln kennen E-Mails; Freigabe hängt am Konto, nicht am Gerät | `share.js`, `providers/*`, `cloudSync.js` |
| ✅ **2** | Tab „Geteilte Dokumente" + Link mit Leserecht | Geteiltes taucht von selbst auf und verschwindet wieder | `ui/sharedDocs.js`, `dashboard.js` |
| ✅ **3** | Freigabe per E-Mail + Rollen + Entfernen | Sperrliste und „Link erneuern" inbegriffen | `ui/share.js`, `dashboard.js` |
| ✅ **4** | `inkwells://share/<id>` + „In Inkwells öffnen" | Weiche in `main.js`, Ereignis `open-share` | `main.js`, `preload.js`, `s/index.html` |
| ✅ **5** | Benachrichtigung in der App | Zähler am Reiter, Meldung beim Start | `ui/sharedDocs.js` |
| ✅ **6** | Datenmodell zerlegen (Abschnitt 2) | Seiten, Handschrift und Bilder einzeln; nur Geändertes geht hoch | `share.js`, `scripts/test-doc-split.js` |
| ✅ **7** | Anwesenheit + Marker + Schreibmarken | Leiste oben, Marker am Seitenrand, farbige Cursor mit Namen im Text | `ui/collab.js`, `database.rules.json` |
| ⤳ **8** | ~~Seitensperren~~ **ersetzt** | siehe unten | — |
| ✅ **9** | Handschrift live (anhängen) | Striche erscheinen sofort beim anderen | `ui/collab.js`, `canvas/input.js` |
| ✅ **10** | Text per CRDT (Yjs) | Zeichengenaues gemeinsames Tippen | `ui/collab.js`, `lib/yjs.bundle.js` |
| ✅ **11** | **Alles ist live** | Seiten, Reihenfolge, Abschnitte, Objekte, Radieren — und der Besitzer ist dabei | `ui/collab.js`, `ui/sharedDocs.js`, `app.js` |
| ✅ **12** | Marke sitzt richtig, Bilder bleiben liegen, PDF-Inhalt kommt an, Zeilensperre | siehe Nachtrag unten | `canvas/text.js`, `ui/collab.js`, `ui/sharedDocs.js`, `canvas/objects.js` |

### Nachtrag vom 2. August 2026: Stufe 11

Die Stufen 1–10 waren umgesetzt, aber zwei Dinge fehlten, ohne die die
Zusammenarbeit im Alltag halb blieb:

**Der Besitzer war nicht dabei.** Er öffnet sein Heft aus der Datei, nicht
aus dem Raum — `Collab.start()` lief für ihn nie. Er sah von den Änderungen
der anderen nichts, und „Freigabe aktualisieren" hat sie überschrieben.
Jetzt ruft `openNotebook()` am Ende `window.onNotebookOpened(nb)`; ist das
Heft freigegeben, wird daraus eine Live-Sitzung: erst geht das Eigene
hinauf (Vergleich gegen `Settings.liveFingerprints`), dann übernimmt der
Raum, dann wird er betreten. Die Datei bleibt die Sicherung.

**Live war nur Text und Handschrift.** Seiten anlegen und löschen,
Reihenfolge, Abschnitte, Hintergrund, Bilder und Radieren kamen erst beim
nächsten Öffnen an. Übertragen wird das jetzt über einen **Vergleich des
Hefts** (`syncStructure` in `ui/collab.js`), nicht über Haken an den
Änderungsstellen — die liegen an über zwanzig Stellen, und manche Änderung
meldet sich gar nicht (ein verschobenes Bild setzt nur `obj.x`). Was nicht
durch den Kanal passt — Bilder, sehr viel Handschrift —, geht über
Firestore: der Absender sichert und schickt `k:'get'`, die Gegenseite holt
die Seite mit `loadPage()`.

### Nachtrag vom 2. August 2026: Stufe 12

Vier Dinge aus dem Alltagsbetrieb, drei davon Fehler.

**Die fremde Schreibmarke saß nie richtig.** Zwei Ursachen, die sich
addierten. Erstens war die Position ein reiner Zeichenabstand, und der
ist an einer Zeilengrenze **mehrdeutig**: bei `<p>abc</p><p></p><p>def</p>`
ergaben das Ende der ersten Zeile, die leere Zeile und der Anfang der
dritten alle dieselbe Zahl 3. `rangeForTextOffset` nahm bei Gleichstand
immer die früheste – die Marke landete also verlässlich eine Zeile zu
hoch. Zweitens liefen Text und Position über **verschiedene Kanäle** in
verschiedenem Takt: der Text alle 300 ms über `ops/`, die Position nur
jede Sekunde über `presence/`. Beim Tippen stand die Marke dadurch
dauerhaft mehrere Wörter zu weit links.

Jetzt gibt es in [`src/canvas/text.js`](src/canvas/text.js) ein zweites
Maß: den Inhalt als eine Zeichenkette, in der jede Zeilengrenze ein echtes
`\n` ist (`flatTextParts` und die Umrechnung in beide Richtungen). Anfang
und Ende einer Zeile sind darin verschiedene Zahlen, eine leere Zeile hat
ihre eigene. Für die Stelle im Text gilt außerdem ein eigener, kurzer
Takt (`CARET_THROTTLE_MS`, 150 ms) statt der Sekunde fürs Blättern.
Geprüft von [`scripts/test-collab-caret.js`](scripts/test-collab-caret.js).

**Ein verschobenes Bild sprang beim anderen zurück.** Der Umweg über
Firestore galt bisher jeder Objektänderung, sobald auf der Seite
überhaupt ein Bild lag. Die Gegenseite lud die Seite daraufhin neu – und
überschrieb damit die gerade richtig angekommene neue Stelle mit dem
Stand, der in Firestore noch stand. Dass dort der alte stand, hatte einen
eigenen Grund: [`src/canvas/objects.js`](src/canvas/objects.js) meldete
Verschieben, Skalieren und Drehen überhaupt nicht als Änderung, das
Speichern stieg mangels `dirty` sofort wieder aus.

Jetzt trägt der Vergleich eine eigene Unterschrift **nur über die
Bilddaten** (`imageSig`). Der Umweg wird nur noch gegangen, wenn die sich
ändern. Und `reloadLivePage` übernimmt von der nachgeladenen Seite nur
noch das, was nicht durch den Kanal passt – die Bilddaten –, nicht mehr
die ganze Seite.

**PDF-Seiten kamen leer an.** Der Inhalt einer PDF-Seite steckt in
`page.bgImg`, und das stand weder in der `pg+`-Meldung noch in
`pageMeta()`. Nachgereicht wurde er nur über einen `get`-Hinweis – der
aber losging, **bevor** irgendetwas geschrieben war: `flushSharedDocSave()`
stieg aus, solange schon ein Speichervorgang lief. Beim Empfänger fand
`loadPage()` nichts, gab `false` zurück, und es gab keinen zweiten
Versuch. Jetzt sagt die Ankündigung, dass noch etwas fehlt (`hasBg`,
`needsFetch`), der Empfänger holt es sich **selbst**, versucht es
gestaffelt erneut, und `forceSharedDocSave()` wartet einen laufenden
Speichervorgang ab, statt ihn zu übergehen.

**Zeilensperre (neu).** Die Zeile, an der jemand schreibt, und die darauf
folgende gehören ihm; für alle anderen sind sie gesperrt. Sichtbar als
zartes Band in seiner Farbe mit Schloss und Namen, durchgesetzt in
`beforeinput` (`Collab.editBlockedBy`). Gemeldet wird der Bereich mit der
Anwesenheit (`lockFrom`, `lockTo`, `lockAt` – die Felder mussten in
[`website/database.rules.json`](website/database.rules.json) ergänzt
werden, die Regel weist unbekannte Felder ab).

Gemeint ist die **sichtbare** Zeile, nicht die logische. Der erste Anlauf
nahm die logische, und das ging in diesem Editor gründlich daneben: beim
Klicken werden keine Umbrüche gesetzt, sondern Leerzeichen aufgefüllt
(`placeCaretAnywhere`). Eine Seite besteht dadurch oft aus einer
**einzigen** sehr langen Zeile, die bloß umbricht — „die logische Zeile"
hieß in der Praxis „von hier bis zum Seitenende", und das Band begann weit
über der Marke. Wo der Text tatsächlich umbricht, weiß der Browser; gefragt
wird er mit `caretRangeFromPoint` an den Rändern der Zeile
(`visualLineSpan`). Übertragen werden weiterhin Zeichenpositionen — nur die
bedeuten bei allen dasselbe.

**Drei Gründe, warum die Marke danach immer noch zuckte.**

1. *Zwei Quellen stritten sich.* Die Stelle kommt an der Textänderung
   (alle 300 ms) **und** über die Anwesenheit (alle 150 ms). Die
   Anwesenheit war öfter dran und meldete regelmäßig eine Stelle, die zu
   einem Text gehörte, den es beim Empfänger noch gar nicht gab — die
   Marke sprang ans Dokumentende und mit der nächsten Textänderung zurück.
   Jetzt hat die Stelle aus der Textänderung Vorrang, solange getippt wird
   (`opCarets`, `peopleNow`); danach übernimmt die Anwesenheit wieder.

2. *Der Umbruch war mehrdeutig.* An einer Umbruchstelle ist Stelle *n*
   zugleich Ende der einen und Anfang der nächsten Bildschirmzeile. Welche
   ein zusammengefallener `Range` zurückgibt, entscheidet der Browser über
   seine „Affinität", und die wechselt. `caretRectAt` fragt deshalb nicht
   mehr nach der Stelle, sondern nach dem **Zeichen dahinter** — das liegt
   eindeutig, und dort erscheint auch das nächste Getippte. Vor einem
   echten `\n` wird das Zeichen davor genommen, sonst rutschte die Marke
   in die nächste Zeile.

3. *Die Sperre fiel ins Bodenlose.* Scheiterte die Trefferprüfung für die
   sichtbare Zeile — etwa weil gerade weggescrollt wurde —, galt die
   logische Zeile, und die reicht hier oft über die halbe Seite. Jetzt
   gibt es in dem Fall **keine** Sperre; keine ist ehrlicher als eine
   falsche.

**Ein Anker macht die Stelle unverschiebbar.** Eine Zahl allein verrutscht:
schreibt jemand weiter vorn, steht alles dahinter später, und die fremde
Marke säße um genau diese Länge daneben — beim Tippen zu zweit auf
derselben Seite ununterbrochen.

`Y.RelativePosition` wäre dafür das richtige Werkzeug, ist hier aber nicht
anwendbar: Yjs zählt im **HTML-Text**, gemeldet wird die Stelle im
**sichtbaren**. Beides ineinander umzurechnen ginge nur über ein Zerlegen
des HTML an beliebiger Stelle — brüchig, und bei jeder Auszeichnung anders.

Stattdessen reisen zwölf Zeichen je Seite als Anker mit (`cx`). Passt der
Anker an der gemeldeten Stelle, ist alles gut — das ist der Normalfall und
kostet einen Vergleich. Passt er nicht, wird die nächstgelegene Stelle
gesucht, an der er passt. Die Sperre wandert um denselben Betrag mit
(`peopleOnPage`). Das heilt nicht nur das gleichzeitige Tippen, sondern
jede Verschiebung — auch die durch die eigenen Änderungen hier.

Findet sich der Anker gar nicht mehr, gilt die gemeldete Zahl wie zuvor.
Geprüft in [`scripts/test-collab-sync.js`](scripts/test-collab-sync.js),
Abschnitt „Marke beim gleichzeitigen Tippen".

**Marke und Text reisen zusammen.** Ursprünglich ging der Text über den
Änderungsstrom und die Stelle über die Anwesenheit. Welcher Weg zuerst
ankommt, ist offen: mal zeigte die Marke auf Zeichen, die es beim anderen
noch gar nicht gab, mal hinkte sie sichtbar hinterher. Die Stelle hängt
deshalb jetzt am Yjs-Op selbst (`c`, `lf`, `lt`; auch diese Felder mussten
in die Regeln). Die Anwesenheit trägt sie weiterhin — für die Zeit, in der
gerade niemand tippt.

Bewusst mit **Nachlauf** statt am Cursor hängend: eine Sperre, die bloß
am abgelegten Cursor hinge, blockierte eine Zeile, weil jemand das
Fenster offen liegen lässt. Sie gilt daher nur, solange getippt wird,
plus rund fünf Sekunden.

Und bewusst **nur in der Oberfläche**, nicht als Absicherung: Yjs führt
gleichzeitige Änderungen ohnehin verlustfrei zusammen. Verhindert werden
soll nicht Datenverlust, sondern dass zwei Leute denselben Satz
gleichzeitig umformulieren und hinterher beide Fassungen ineinander
stehen. Damit ist auch klar, was die Sperre *nicht* leistet: zwei Clients
können im selben Augenblick überlappende Bereiche beanspruchen. Das
kostet nichts – es führt nur dazu, dass beide kurz schreiben dürfen.

### Nachtrag vom 11. August 2026: fünf Fehler, und erst jetzt ein Prüfstand

Rückmeldung aus dem Betrieb zu zweit: „zu zweit ist alles eher buggy und
kaputt". Fünf Punkte, alle bestätigt — und alle **gemessen**, nicht
erschlossen. Dazu gibt es jetzt
[`scripts/test-collab-live`](scripts/test-collab-live) (`npm run
test:live`): zwei echte Fenster mit dem echten `ui/collab.js`,
`canvas/text.js` und Yjs; nur der Raum ist durch eine Brücke über den
Hauptprozess ersetzt, und die gibt Nachrichten **ohne Verzögerung**
weiter. Was danach an Wartezeit bleibt, ist die der App.

**Die Marke und das Band saßen eine halbe Zeile zu tief.** Die Korrektur
vom 10.8. rundete die Zeile auf ein Raster (`lineBoxOf`) — aber auf eines,
das am oberen **Seitenrand** anfängt. Der Text beginnt dort nicht: `.j-text`
sitzt bei `top:64` und hat 19 px Innenabstand, die erste Zeile also bei 83,
und 83 ist kein Vielfaches von 32. Jede Marke und jedes Band landete 13 px
daneben. Gezählt wird jetzt von der Oberkante der ersten Zeile aus.
[`scripts/test-caret-geometry`](scripts/test-caret-geometry) hatte das
sofort gemeldet — es war nach der Korrektur nur niemand mehr gelaufen.

**Es flackerte.** `_renderCaretsNow` und `_renderLocksNow` warfen bei
**jedem Bild** alle Elemente weg und bauten sie neu. Ein frisches Element
hat keinen vorigen Zustand, von dem aus es sich bewegen könnte — die
weichen Übergänge in `css/layout.css` liefen deshalb nie, die Marke sprang
jedes Mal neu ins Bild. Jetzt gibt es je Person ein Element, das bleibt und
nur seine Werte bekommt.

**Beim Durchtippen kam gar nichts an.** Der Takt für den Text war eine
**Entprellung**: jeder Anschlag stellte die 300 ms zurück. Wer schneller
tippt als das — also jeder —, schickte während des Schreibens nichts; beim
anderen erschien der Text erst in der Tipp-Pause. Im Prüfstand: zwei
Sekunden Dauertippen, null Zeichen angekommen. Jetzt eine **Drossel mit
sofortigem ersten Schlag** — gemessen 60 ms bis zum ersten Zeichen.

**Die eigene Marke sprang in den fremden Text.** `applyRemoteText` suchte
den Anker nur, wenn die Marke **nicht** am Textende stand
(`caret < vorher.length`). Genau dort steht sie aber meistens. Sonst blieb
die Stelle dieselbe **Zahl**, während der Text durch die fremde Änderung
länger wurde — die Marke stand plötzlich mittendrin, und zwar dort, wo der
andere gerade tippt. Jetzt gilt: Anker zuerst, und wenn der andere mitten
in ihn hineingeschrieben hat und er dadurch verschwunden ist, der
Textvergleich (`shiftedPos`). Beide Lücken waren je einmal gemeldet worden;
erst zusammen decken sie den Fall ab.

**Die Sperre umfasst die eigene Zeile und die nächste** — das galt schon,
sah durch den 13-px-Versatz aber falsch aus. Jetzt nachgemessen: Band eins
auf der Zeile des Schreibenden, Band zwei direkt darunter.

> **Für den nächsten Fehler hier:** erst `npm run test:live` und
> `npm run test:caret` laufen lassen, dann eine Ursache behaupten. Dieser
> Bereich hat zweimal eine Runde Codelesen gekostet, die fünf echte, aber
> jeweils falsche Ursachen gefunden hat.

### Warum Stufe 8 entfällt

Seitensperren waren als *Ersatz* gedacht, solange es kein CRDT gibt: immer
nur einer schreibt, die anderen sehen die Seite gesperrt. Mit Stufe 10 ist
dieser Ersatz nicht nur überflüssig, sondern schädlich — eine Sperre würde
genau das verhindern, was Yjs möglich macht.

Übrig bleibt der nützliche Teil davon: man **sieht**, wer auf welcher Seite
ist (Stufe 7), ohne dass es einen aussperrt. Der Nur-Lese-Modus, der in
Stufe 8 mit stand, ist bereits in Stufe 2 gebaut worden.

---

## 9. Was vor dem Start entschieden werden muss — entschieden

> Stand: 1. August 2026, nach Abschluss der Stufen 1–5.

1. **Firebase-Anmeldung:** ~~ID-Token oder Custom Token?~~ → **ID-Token.**
   Umgesetzt in `website/js/share.js` (`signInWithProviderToken`). Cloud
   Functions entfallen, das Projekt bleibt im Spark-Plan. Das
   Google-Client-Secret ist damit Voraussetzung, nicht mehr optional.

   Zwei Abweichungen von Abschnitt 1, die sich beim Bauen ergaben:
   - Der Bestandsschutz läuft über `linkWithCredential`: die anonyme
     Gerätekennung wird auf das Konto *gehoben*, statt Freigaben
     umzuschreiben. Dieselbe UID, kein Datenschritt.
   - Erst wenn das fehlschlägt (zweites Gerät), wird normal angemeldet.
     Dafür trägt jede Freigabe jetzt `ownerEmail`; die Regel erlaubt dem
     Inhaber dieser Adresse, sich als Besitzer einzutragen
     (`claimOwnShares`). Ohne diesen Anker wäre ein Besitzerwechsel per
     Regel gar nicht durchsetzbar.

2. **Spark-Grenzen im Blick behalten.** 50.000 Lese- und 20.000
   Schreibvorgänge pro Tag in Firestore. Live-Bearbeitung mit vielen kleinen
   Änderungen kommt dem näher, als man denkt — deshalb Anwesenheit und
   Op-Strom über die Realtime Database führen.

3. **Wie weit soll die Live-Bearbeitung gehen?** → **Bis Stufe 10, echtes
   gleichzeitiges Tippen mit CRDT.** Umgesetzt mit **Yjs** (zugesagt am
   1. August 2026, siehe `COLLAB_PROMPT.md` Teil G).

   Yjs ist eine *Entwicklungs*-Abhängigkeit: `scripts/build-yjs.js` bündelt
   es einmalig zu `src/lib/yjs.bundle.js`, und nur diese Datei wird
   ausgeliefert. Nötig, weil Yjs seine Teile über Kurznamen aus `lib0`
   holt, die ein Browser nicht auflösen kann — die Oberfläche von Inkwells
   besteht aber bewusst aus klassischen `<script>`-Dateien ohne Bauschritt.

   Wie der Text durch Yjs geht, steht in Abschnitt 5.2.

   Seitensperren (Stufe 8) sind damit hinfällig — siehe Abschnitt 8.

4. **Was passiert mit einem geteilten Heft beim Besitzer?** → **Die
   Drive-Datei bleibt die Sicherung, wird aber vom Raum aus geschrieben —
   nicht umgekehrt.** Der Raum in Firestore ist die maßgebliche Fassung.
   Kein Zwischending, keine zwei Wahrheiten, und ein Backup bleibt.

   Beim Empfänger bleibt es dabei, dass gar nichts in dessen Cloud landet
   (`nb.origin = 'shared'`, siehe Abschnitt 3).

---

## Anhang: Die Wunschliste, abgehakt

| Wunsch | Wo |
|---|---|
| Tab „Geteilte Dokumente" in App und Web | Abschnitt 3, Stufe 2 |
| Anzeige Bearbeiten / Nur lesen | Abschnitt 3, Stufe 2 |
| Freigabe per Link | Abschnitt 4.1, Stufe 2 |
| Link öffnen → Browser, landet im Tab | Abschnitt 4.1 Fall 1, Stufe 2 |
| Link öffnen → App, landet im Tab | Abschnitt 4.1 Fall 2, Stufe 4 |
| Link mit Bearbeitungsrecht | Abschnitt 4.1, Stufe 2 |
| Freigabe per E-Mail mit Rollen | Abschnitt 4.2, Stufe 3 |
| Entzogene Freigabe verschwindet | Abschnitt 3 (`array-contains`), Stufe 2 |
| Marker mit Initialen an der Position | Abschnitt 5.1, Stufe 7 |
| Kein fremder Cursor, nur Markierung | Abschnitt 5.1, Stufe 7 |
| Liste der Mitbearbeitenden oben | Abschnitt 5.1, Stufe 7 |
| Besitzer kann Nutzer entfernen | Abschnitt 4.3, Stufe 3 |
| Besitzer kann auch Link-Nutzer entfernen | Abschnitt 4.3 (Sperrliste, Link erneuern), Stufe 3 |
| Benachrichtigung in der App | Abschnitt 6, Stufe 5 |
| Live-Bearbeitung **nur in der App** | Abschnitt 5.2, Stufen 8–10 |
