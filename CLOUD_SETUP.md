# Cloud-Anmeldung einrichten

Inkwell hat keine eigene Benutzerverwaltung. Man meldet sich wahlweise bei
**Google** oder bei **Microsoft** an; die Notizbücher liegen dann im jeweils
eigenen Cloud-Speicher.

| Anbieter  | Anmeldung               | Speicherort               | Sitzung hält (App) | Sitzung hält (Website) |
|-----------|-------------------------|---------------------------|--------------------|------------------------|
| Google    | OAuth 2.0 (Implicit)    | Google Drive → `Inkwell`  | ~1 Stunde \*       | dauerhaft (still erneuert) |
| Microsoft | OAuth 2.0 (Code + PKCE) | OneDrive → `Apps/Inkwell` | ~90 Tage           | ~24 Stunden            |

\* verlängerbar — siehe [Abschnitt 4](#4-sitzungsdauer).

Beide Anbieter sind **unabhängig voneinander** — es genügt, einen davon
einzurichten. App und Website sehen jeweils dieselben Notizbücher.

> **Wichtig:** Die beiden Konten sind getrennte Welten. Ein Heft in Google
> Drive taucht bei Microsoft-Anmeldung nicht auf und umgekehrt.

## Stand

| Anbieter  | Zugangsdaten |
|-----------|--------------|
| Google    | ✅ eingetragen — `435761207155-…apps.googleusercontent.com` |
| Microsoft | ✅ eingetragen — `148248d2-…-879453f5881c` |

> **Wenn die Anmeldung auf der Website mit `AADSTS90023` scheitert**, fehlt
> nicht die ID, sondern die Plattform-Einstellung in Azure —
> siehe [Abschnitt B2](#b2-plattformen-eintragen).

Eingetragen wird jeweils an **zwei** Stellen:
`src/core/cloudConfig.js` (App) und `website/js/config.js` (Website).

---

# Teil A — Google

> Die Google-Zugangsdaten sind bereits hinterlegt. Die folgenden Schritte
> sind die Anleitung, falls sie einmal neu erstellt werden müssen —
> **prüfe aber unbedingt Schritt 1.3 und 1.4**: Freigaben, Testnutzer und
> die erlaubten Adressen müssen in der Google Cloud Console hinterlegt
> sein, sonst schlägt die Anmeldung fehl.

---

## 1. OAuth-Client in der Google Cloud Console anlegen

1. <https://console.cloud.google.com/> öffnen und ein Projekt auswählen
   oder neu anlegen (Name z. B. `Inkwell`).

2. **APIs & Dienste → Bibliothek** → nach „Google Drive API" suchen →
   **Aktivieren**.

3. **APIs & Dienste → OAuth-Zustimmungsbildschirm**
   - Nutzertyp: **Extern**
   - App-Name: `Inkwell`, Support-E-Mail eintragen
   - **Bereiche (Scopes)** hinzufügen:
     - `openid`
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
     - `.../auth/drive.file`

     > `drive.file` ist kein sensibler Scope – es gibt Zugriff **nur** auf
     > Dateien, die Inkwell selbst anlegt. Deshalb ist keine aufwendige
     > Google-Überprüfung nötig.
   - Solange die App im Status **Testing** ist: unter **Testnutzer** alle
     Google-Konten eintragen, die sich anmelden dürfen (max. 100).
     Für den öffentlichen Betrieb den Status auf **In Produktion** setzen.

4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen →
   OAuth-Client-ID**
   - Anwendungstyp: **Webanwendung** ← wichtig, nicht „Desktop"!
   - Name: `Inkwell`

   Die beiden Listen haben **unterschiedliche Regeln** und werden leicht
   verwechselt — sie stehen direkt untereinander:

   **Autorisierte JavaScript-Quellen** — nur Adresse, **kein** Schrägstrich,
   **kein** Pfad:
   ```
   https://inkwells.me
   http://localhost:8080
   ```

   **Autorisierte Weiterleitungs-URIs** — hier gehört der Pfad hin:
   ```
   https://inkwells.me/
   http://localhost:8080/
   http://127.0.0.1:3000/callback
   http://localhost:3000/callback
   ```

   > **Eigene Domain:** Die Website läuft unter `inkwells.me` (eingestellt in
   > `website/CNAME`). Falls ihr zusätzlich die GitHub-Adresse offen halten
   > wollt, kommen `https://manuel0anvi.github.io` (Quelle) und
   > `https://manuel0anvi.github.io/Inkwell/` (Weiterleitung) dazu.
   >
   > **`localhost` ≠ `127.0.0.1`:** Für Google sind das zwei verschiedene
   > Adressen. Die Desktop-App verwendet `127.0.0.1` – fehlt der Eintrag,
   > kommt „Error 400: redirect_uri_mismatch“.
   >
   > `localhost:8080` wird für die lokale Vorschau gebraucht (`npm run web`).
   >
   > Die JavaScript-Quelle ist **nicht** verzichtbar: ohne sie kann die
   > Website das Google-Token nicht im Hintergrund erneuern, und man wird
   > nach etwa einer Stunde abgemeldet.

   > Kurz: `inkwells.me` gehört zur Website, `127.0.0.1:3000` zur
   > Desktop-App (dort läuft der Login über den System-Browser und wird von
   > einem kurzlebigen lokalen Server abgefangen).

5. Die erzeugte **Client-ID** kopieren
   (Form: `1234567890-abcdef….apps.googleusercontent.com`).
   Ein Client-Secret wird **nicht** gebraucht.

---

## 2. Client-ID an zwei Stellen eintragen

Es muss an beiden Stellen **dieselbe** ID sein — sonst sieht die Website die
Dateien der App nicht (`drive.file` gilt pro OAuth-Client).

**Desktop-App** — `src/core/cloudConfig.js`:
```js
const GOOGLE_CONFIG = {
  CLIENT_ID: 'HIER_DIE_ID_EINFÜGEN.apps.googleusercontent.com',
  ...
```

**Website** — `website/js/config.js`:
```js
const GOOGLE_CLIENT_ID = 'HIER_DIE_ID_EINFÜGEN.apps.googleusercontent.com';
```

Danach Website neu deployen und die App neu starten. Fertig.

Solange die ID leer ist, zeigen App und Website an der Login-Stelle einen
roten Hinweis statt still zu scheitern.

---

## 3. Wie es dann läuft

**Desktop-App**
1. Titelleiste → Profil-Symbol → *Mit Google anmelden*
2. Der System-Browser öffnet sich mit der Google-Anmeldung
3. Nach der Bestätigung leitet Google auf `http://127.0.0.1:3000/callback`
   zurück; die App fängt das ab und schließt die Anmeldung ab
4. Notizbücher werden nach `Google Drive → Inkwell` synchronisiert

**Website**
1. *Anmelden* → *Mit Google anmelden*
2. Nach der Rückleitung landet man direkt im Dashboard
3. Das Dashboard liest denselben Drive-Ordner und stellt Karten und Seiten
   genauso dar wie die App

---

## 4. Sitzungsdauer

Ein Google-Zugriffstoken ist immer nur etwa **eine Stunde** gültig. Das ist von
Google so vorgegeben und lässt sich nicht abschalten.

**Website:** kein Problem. Läuft das Token ab, holt die Seite über den
Google-Identity-Dienst im Hintergrund automatisch ein neues — ohne Klick und
ohne Umleitung. Voraussetzung ist, dass die Seiten-Adresse unter
„Autorisierte JavaScript-Quellen" eingetragen ist (Schritt 1.4) und man bei
Google angemeldet ist. Klappt das einmal nicht, erscheint wieder der normale
Login-Knopf.

**Desktop-App:** hier ist im Auslieferungszustand nach etwa einer Stunde eine
erneute Anmeldung nötig. Die App macht das aber vorhersehbar statt überraschend:

- fünf Minuten vorher erscheint ein Hinweis,
- läuft die Sitzung ab, wird das deutlich gemeldet und das Profil-Symbol in der
  Titelleiste färbt sich rot,
- im Konto-Fenster steht, wie lange die Sitzung noch gilt,
- **es gehen dabei keine Daten verloren:** Notizbücher werden weiter lokal
  gespeichert, und was noch nicht hochgeladen war, wandert nach dem erneuten
  Anmelden automatisch nach oben,
- die E-Mail bleibt gemerkt, der erneute Login ist ein einziger Klick.

### Dauerhafte Google-Sitzung (optional)

Ein Login ohne stündliche Neuanmeldung braucht ein Refresh-Token, und Google
gibt das nur gegen ein **Client-Secret** heraus. Die App kann das inzwischen —
der Weg ist eingebaut, aber bewusst **standardmäßig aus**:

Das Secret steht **nicht** in `cloudConfig.js`, denn diese Datei liegt im
öffentlichen Repo. Es kommt in eine eigene Datei daneben, die `.gitignore`
aussperrt — jeder trägt seinen Wert also selbst ein:

```js
// src/core/cloudConfig.local.js   (nicht im Repo)
window.GOOGLE_CLIENT_SECRET_LOCAL = 'GOCSPX-…';
```

Anlegen lässt sie sich am schnellsten, indem man die Vorlage
`src/core/cloudConfig.local.example.js` kopiert und in
`cloudConfig.local.js` umbenennt.

Fehlt die Datei, bleibt `GOOGLE_CONFIG.CLIENT_SECRET` leer und alles läuft
weiter — nur eben mit stündlicher Neuanmeldung. In der Konsole steht dann ein
404 auf `cloudConfig.local.js`; der ist erwartet und harmlos.

Steht ein Secret darin, wechselt die App automatisch vom Implicit-Flow zu
*Authorization Code + PKCE* mit `access_type=offline` und erneuert das Token
still im Hintergrund — genau wie bei Microsoft.

Das Secret steht in der Cloud Console beim **selben** OAuth-Client
(Anmeldedaten → Inkwell → *Clientschlüssel*). Es muss derselbe Client bleiben:
`drive.file` gilt pro Client, mit einer zweiten Client-ID würde die Website die
Hefte der App nicht mehr sehen.

> **Abwägung:** Das Secret landet in der ausgelieferten `.exe` und ist dort
> auslesbar. Für einen Client vom Typ „Webanwendung" heißt das: wer es
> ausliest, kann damit Anmeldungen im Namen dieser Client-ID durchführen. Die
> Notizbücher anderer Nutzer sind dadurch nicht zugänglich (dafür braucht es
> weiterhin deren eigene Google-Anmeldung), der Client-Name im
> Zustimmungsbildschirm ließe sich aber missbrauchen.
>
> Für eine private Installation ist das meist vertretbar, für eine öffentlich
> verteilte `.exe` eher nicht. Deshalb die Entscheidung bewusst offen gelassen.

**Website:** dort ist nichts einzutragen. Die Seite nutzt den Google-Identity-
Dienst und erneuert ohne Secret (siehe oben).

## 5. Was in Google Drive angelegt wird

Im Ordner `Inkwell` deines Drive liegen:

| Was | Wozu |
|-----|------|
| `<Heftname>.json` | je ein Notizbuch |
| `Papierkorb/` | gelöschte Hefte, 30 Tage lang |
| `inkwell-papierkorb.json` | Liste der gelöschten Hefte |

Gelöschte Hefte landen bewusst **nicht** im Papierkorb von Google, sondern im
eigenen Unterordner. Dadurch ist die Aufbewahrung unabhängig von Googles
Regeln und der Papierkorb sieht auf allen Geräten gleich aus: löschst du ein
Heft am Laptop, siehst du es auch am zweiten Rechner im Papierkorb und kannst
es dort zurückholen.

Ohne Cloud-Sicherung bleibt der Papierkorb rein lokal — dann gilt er nur für
das Gerät, auf dem gelöscht wurde.

## 6. Wenn die Anmeldung fehlschlägt

### „Error 400: redirect_uri_mismatch"

Die Adresse, an die Google zurückleiten soll, steht nicht in der Cloud
Console. Die App schreibt beim Anmeldeversuch ins Log, welche das ist:

```
[CloudSync] redirect_uri = http://127.0.0.1:3000/callback
```

Diese Adresse muss **zeichengenau** unter *Autorisierte Weiterleitungs-URIs*
stehen. Häufigste Ursachen:

- Nur `http://localhost:3000/callback` eingetragen, aber nicht
  `http://127.0.0.1:3000/callback`. Für Google sind das zwei verschiedene
  Adressen — die App nutzt `127.0.0.1`.
- Als Eintrag unter *JavaScript-Quellen* statt unter
  *Weiterleitungs-URIs* gelandet. Beides sind getrennte Listen.
- Schrägstrich am Ende vergessen oder zu viel.
- Änderungen in der Cloud Console brauchen manchmal ein paar Minuten.

### „Error 403: access_denied"

Die App steht auf *Testing* und dein Konto ist nicht als Testnutzer
eingetragen. Unter *OAuth-Zustimmungsbildschirm → Testnutzer* hinzufügen.

### „invalid_client"

Die Client-ID stimmt nicht oder der Client wurde gelöscht. Vergleiche den
Wert im Log mit dem in der Cloud Console.

### Auf der lokalen Website klappt der Login nicht

`http://localhost:8080` muss sowohl als *JavaScript-Quelle* als auch —
mit Schrägstrich — als *Weiterleitungs-URI* eingetragen sein. Die Seite muss
über `npm run web` laufen, nicht per Doppelklick auf die HTML-Datei.

## 7. Bekannte Eigenheiten

- **Eine Anmeldung mit E-Mail und Passwort gibt es nicht.** Angemeldet wird
  ausschließlich über Google oder Microsoft. Gespeicherte Sitzungen aus sehr
  alten Fassungen werden beim ersten Start automatisch verworfen.

- **Notizbücher liegen immer zuerst lokal.** Beim ersten Abgleich werden sie
  von dort nach Google Drive bzw. OneDrive hochgeladen.

- **Das Community-Forum** nutzt Google Firebase (Cloud Firestore) als reine
  Datenbank für Beiträge — aber nicht zum Anmelden. Der angezeigte
  Autorenname kommt weiterhin aus dem Google- bzw. Microsoft-Profil.
  Aufbau: `community_posts/{postId}` mit der Unter-Sammlung
  `community_posts/{postId}/replies/{replyId}`. Code in
  [`website/js/firebase.js`](website/js/firebase.js), Sicherheitsregeln in
  [`website/firestore.rules`](website/firestore.rules).

---

# Teil C — Hefte über einen Link freigeben

Ein Heft kann als **schreibgeschützte Kopie** veröffentlicht werden. Wer den
Link hat, liest es ohne Anmeldung; an das Original in Drive bzw. OneDrive
kommt niemand heran.

| Wo | Wie |
|----|-----|
| App | Rechtsklick auf ein Heft → *Heft freigeben* |
| Website | Heft öffnen → *Link kopieren* |

Der Link sieht so aus: `https://inkwells.me/s/?id=<22 Zufallszeichen>`

## C1. Warum Firestore und nicht Firebase Storage

Storage verlangt bei neu angelegten Projekten den **Blaze-Plan**
(Kreditkarte). Firestore läuft im kostenlosen **Spark-Plan**. Der Haken:
ein Firestore-Dokument darf höchstens 1 MiB groß sein — Hefte mit Bildern
sind schnell größer. Der Inhalt wird deshalb in Stücke zerlegt:

```
shared_notebooks/{shareId}              Kopf: Titel, Modus, Anzahl der Stücke
shared_notebooks/{shareId}/chunks/{i}   der JSON-Text in Stücken à 700 000 Zeichen
```

Grenze im Spark-Plan: **1 GiB** für alle Freigaben zusammen und 50 000
Lesevorgänge pro Tag. Ein Heft mit 10 MB belegt 15 Stücke; das reicht für
rund hundert bildlastige Hefte.

## C2. Einmalige Einstellung in der Firebase Console

**Authentication → Anmeldemethode → Anonym → aktivieren.**

Ohne diesen Schalter schlägt das Freigeben mit einer entsprechenden Meldung
fehl. Er wird gebraucht, damit Firestore erkennt, **wem** eine Freigabe
gehört: nur das Gerät, das sie erstellt hat, darf sie später aktualisieren
oder aufheben. Ein Konto legt dabei niemand an — die Kennung ist anonym und
gehört zum Gerät.

Danach die Regeln aus [`website/firestore.rules`](website/firestore.rules)
neu veröffentlichen (sie enthalten jetzt auch den Abschnitt
`shared_notebooks`).

> **Grenze, die man kennen muss:** Die anonyme Kennung gehört zum **Gerät**,
> nicht zum Google-Konto. Eine Freigabe lässt sich deshalb nur dort aufheben,
> wo sie erstellt wurde. Auf anderen Geräten weist die Oberfläche darauf hin.
> Im Notfall geht es immer über die Firebase Console (Firestore Database →
> `shared_notebooks` → Dokument löschen).

## C3. Die zwei Betriebsarten

| Modus | Verhalten |
|-------|-----------|
| **Eingefroren** (Standard) | Der Link zeigt genau den Stand vom Freigeben. Spätere Änderungen bleiben privat, bis man auf *Freigabe aktualisieren* klickt. |
| **Immer aktuell** | Nach jedem Cloud-Abgleich wird die Kopie mitgeschrieben. Bequem, aber alles im Heft ist sofort öffentlich sichtbar. |

Umschalten geht jederzeit im selben Dialog.

## C4. Was öffentlich ist — und was nicht

- Die Kennung im Link ist 22 Zeichen aus 62 Zeichen Alphabet (~131 Bit) und
  damit nicht erratbar. Eine Liste aller Freigaben gibt es nicht.
- Die Seite `s/` trägt `noindex, nofollow` — Suchmaschinen nehmen sie nicht auf.
- Trotzdem gilt: **Wer den Link weitergibt, gibt das Heft weiter.** Es gibt
  kein Passwort und keine Ablauffrist.
- *Freigabe aufheben* löscht Kopf und Stücke endgültig; der Link führt danach
  auf „Diese Freigabe gibt es nicht mehr".

## C5. Geteilte Dokumente — was einmalig einzurichten ist

Die Freigabe an **bestimmte E-Mail-Adressen** und der Tab **„Geteilte
Dokumente"** brauchen mehr als die anonyme Kennung aus C2: Firebase muss
wissen, **wer** da ist. Dafür wird das `id_token`, das Google und Microsoft
bei der Anmeldung ohnehin mitliefern, an Firebase weitergereicht.

### Schritt 1 — Google einschalten

Firebase Console → Projekt `inkwell-53ab9` → **Authentication** →
**Sign-in method** → **Google** → *Aktivieren* → Support-E-Mail wählen.

**Der Punkt, an dem es sonst scheitert:** Inkwell benutzt einen eigenen
OAuth-Client, der in einem *anderen* Google-Cloud-Projekt liegt als
Firebase:

| | Projektnummer |
|---|---|
| OAuth-Client der App (`cloudConfig.js`) | `435761207155` |
| Firebase-Projekt (`messagingSenderId`) | `536044175658` |

Firebase nimmt ein ID-Token aus einem fremden Projekt nur an, wenn dessen
Client-ID ausdrücklich erlaubt ist. Im Google-Anbieter aufklappen:
**„Web SDK configuration"** → Feld **„Whitelist client IDs from external
projects"** (deutsch: *Client-IDs aus externen Projekten zulassen*) → dort
eintragen:

```
435761207155-gk6o9kk7ivsqa2h4fdhqeabtnigv9f4u.apps.googleusercontent.com
```

Ohne diesen Eintrag lautet der Fehler beim Anmelden sinngemäß
*„audience is not a valid client ID"* — die App läuft weiter, aber der Tab
„Geteilte Dokumente" bleibt leer.

### Schritt 1b — Microsoft einschalten

> ### ⚠ Das führt derzeit trotzdem nicht zum Ziel
>
> **Geteilte Dokumente gehen zurzeit nur mit einem Google-Konto.** Die
> folgenden Schritte sind richtig ausgeführt und trotzdem wirkungslos —
> daran ist in der Console nichts einzustellen.
>
> Am 02.08.2026 gegen den echten Endpunkt durchgemessen, mit frischem
> Token und eingeschaltetem Anbieter:
>
> | Was geschickt wurde | Antwort |
> | --- | --- |
> | `id_token` allein | `INVALID_CREDENTIAL_OR_PROVIDER_ID` |
> | `id_token` + `access_token` | `INVALID_CREDENTIAL_OR_PROVIDER_ID` |
> | `access_token` allein | `INVALID_CREDENTIAL_OR_PROVIDER_ID` |
>
> Dass der Anbieter **eingeschaltet** ist, wurde dabei mitbewiesen:
> `accounts:createAuthUri` liefert für `microsoft.com` eine Adresse mit
> genau unserer Anwendungs-ID zurück.
>
> Der Grund ist bauartbedingt: Google ist bei Firebase ein eigenständiger
> Anbieter, dessen Token direkt geprüft werden. Microsoft ist ein
> generischer OAuth-Anbieter — dessen Anmeldung muss Firebase **selbst**
> begonnen haben. Inkwell besorgt das Token aber selbst, für OneDrive.
>
> Die Fehlermeldung lautet ausgerechnet
> `invalid-credential-or-provider-id` — dieselbe wie bei einem
> *abgeschalteten* Anbieter. Genau das hat schon zu einer langen,
> ergebnislosen Suche hier in der Console geführt. Nicht wiederholen.
>
> Die Anmeldung bei OneDrive und die Sicherung der Hefte sind davon
> **nicht** betroffen; nur Teilen und Empfangen bleiben aus.
>
> **Der Ausweg, der seit dem 02.08.2026 eingebaut ist:** Firebase macht
> die Microsoft-Anmeldung selbst — über `signInWithPopup`. Im Reiter
> „Geteilte Dokumente" steht dafür ein eigener Knopf; ein zweiter,
> meist unsichtbarer Anmeldeschritt. Damit das geht, wird die
> Oberfläche seit derselben Änderung über einen örtlichen Server unter
> `http://localhost` ausgeliefert statt über `file://` — Firebase lässt
> seinen Ablauf nur von erlaubten Herkünften aus zu, und `file://` hat
> gar keine. Siehe `startUiServer()` in `main.js`.
>
> Die Schritte unten bleiben also nötig: Firebase braucht die
> Anwendungs-ID und das Geheimnis, um den Tokentausch selbst zu machen.
> Und die Weiterleitungs-URL `https://inkwell-53ab9.firebaseapp.com/__/auth/handler`
> muss in Azure eingetragen sein — für diesen Weg wird sie **wirklich**
> gebraucht, anders als früher hier stand.

Zuerst in Azure ein Geheimnis anlegen (Firebase verlangt eines, auch wenn
die App selbst ohne auskommt):

Azure Portal → **App-Registrierungen** → *Inkwell* → **Zertifikate & Geheimnisse**
→ *Neuer geheimer Clientschlüssel* → Beschreibung + Laufzeit → *Hinzufügen*
→ den **Wert** sofort kopieren (er wird nur einmal angezeigt).

Dann Firebase Console → **Authentication → Sign-in method** →
*Neuen Anbieter hinzufügen* → **Microsoft** → *Aktivieren*:

- **Anwendungs-ID:** `148248d2-3bb9-441f-ba32-879453f5881c`
  (dieselbe wie `MICROSOFT_CONFIG.CLIENT_ID`)
- **Anwendungsgeheimnis:** der eben kopierte Wert

Firebase zeigt darunter eine Weiterleitungs-URL der Form
`https://inkwell-53ab9.firebaseapp.com/__/auth/handler`. Die gehört in
Azure unter **Authentifizierung → Plattform „Web" → Umleitungs-URIs**.

> **Die ist Pflicht**, nicht optional: genau über diese Adresse läuft der
> zweite Anmeldeschritt (`signInWithPopup`). Fehlt sie, bleibt das
> Anmeldefenster auf einer Microsoft-Fehlerseite stehen.

> **Zu `email_verified`:** Microsoft liefert die Angabe bei persönlichen
> Konten nicht verlässlich. Die Regeln lassen deshalb auch Anmeldungen
> durch, deren `sign_in_provider` `google.com` oder `microsoft.com` ist.
> Eine anonyme Gerätekennung fällt weiterhin durch.

### Schritt 1c — Anonym bleibt an

**Anonym** nicht abschalten (siehe C2) — Leser, die einen Link ohne Konto
öffnen, brauchen sie.

### Schritt 2 — Regeln neu veröffentlichen

Firestore Database → **Regeln** → Inhalt von
[`website/firestore.rules`](website/firestore.rules) einfügen →
**Veröffentlichen**. Dazugekommen sind die Abschnitte `docs` und
`doc_links`.

### Schritt 3 — Google-Client-Secret ist jetzt Voraussetzung

Google gibt ein ID-Token **nur im Code-Flow** heraus. Ohne
`GOOGLE_CONFIG.CLIENT_SECRET` (siehe Abschnitt 4) läuft die Anmeldung als
Implicit-Flow und liefert keines. Die App sagt das dann klar und arbeitet
ohne die geteilten Dokumente weiter — alles Übrige bleibt unverändert.

### Schritt 4 — Realtime Database für die Live-Bearbeitung

Nur nötig, wenn mehrere gleichzeitig an einem Heft arbeiten sollen. Ohne
diesen Schritt funktioniert alles Übrige weiter; es fehlen dann die
Anwesenheits-Marker und die sofortige Übertragung.

Firebase Console → **Realtime Database** → *Datenbank erstellen* →
Region **europe-west1** → *Im gesperrten Modus starten*.

Danach **Regeln** → Inhalt von
[`website/database.rules.json`](website/database.rules.json) einfügen →
*Veröffentlichen*.

Zum Schluss die angezeigte Adresse mit der Zeile `RTDB_URL` in
[`website/js/share.js`](website/js/share.js) vergleichen. Bei
europe-west1 sieht sie so aus:

```
https://inkwell-53ab9-default-rtdb.europe-west1.firebasedatabase.app
```

Bei us-central1 endet sie stattdessen auf `firebaseio.com`. Weicht sie
ab, dort eintragen und `npm run sync-share` laufen lassen.

> **Kostet das etwas?** Nein. Die Realtime Database ist im Spark-Plan
> enthalten: 1 GB Speicher, 10 GB Übertragung im Monat, 100 gleichzeitige
> Verbindungen. Hier liegen nur Anwesenheit und Tastenanschläge, beides
> winzig und flüchtig. Nicht verwechseln mit *Firebase Storage* — das
> verlangt bei neuen Projekten den Blaze-Plan.

### Was danach möglich ist

| Wunsch | Ergebnis |
|--------|----------|
| Link mit *Nur ansehen* oder *Ansehen und bearbeiten* | Empfänger landet beim Öffnen automatisch im eigenen Tab |
| Freigabe an einzelne Adressen mit Rolle | erscheint beim Empfänger ohne Link |
| Zugriff entziehen | Adresse kommt auf `blockedEmails` und auch über den Link nicht zurück |
| *Link erneuern* | neue Link-Kennung, alle verschickten Adressen laufen ins Leere |
| Gleichzeitig tippen | zeichengenau, über Yjs zusammengeführt |
| Gleichzeitig zeichnen | Striche werden nur angehängt, beide kommen an |
| Wer ist gerade dabei | Leiste oben und Marker mit Initialen am Seitenrand |
| Wo die anderen stehen | farbige Schreibmarke mit Namensschild im Text |

> **Grenze, die man kennen muss:** Bearbeitet wird nur in der App. Auf der
> Website bleibt ein geteiltes Dokument immer schreibgeschützt — dort
> steht stattdessen ein Knopf „In Inkwell öffnen".

## C6. Wo der Code liegt

| Datei | Aufgabe |
|-------|---------|
| [`website/js/share.js`](website/js/share.js) | Anmeldung bei Firebase, Freigaben, geteilte Dokumente (die einzige Fassung) |
| `src/core/share.js` | **erzeugte Kopie** für die App — `npm run sync-share` |
| [`website/js/viewer.js`](website/js/viewer.js) | Seitendarstellung, geteilt von Dashboard und Freigabe-Seite |
| [`website/s/index.html`](website/s/index.html) | die öffentliche Leseansicht |
| [`src/ui/share.js`](src/ui/share.js) | Freigabe-Dialog in der App |
| [`src/ui/sharedDocs.js`](src/ui/sharedDocs.js) | Tab „Geteilte Dokumente" in der App |
| [`website/dashboard/dashboard.js`](website/dashboard/dashboard.js) | derselbe Tab im Dashboard |

Die App wird ohne den Ordner `website/` ausgeliefert, deshalb braucht sie ein
eigenes Exemplar von `share.js`. `npm run build` bricht ab, wenn die beiden
Fassungen auseinanderlaufen.

---

# Teil B — Microsoft / OneDrive

Die Anwendungs-ID ist eingetragen. Die folgenden Schritte sind die Anleitung,
falls die Registrierung neu erstellt werden muss — **prüfe aber unbedingt
Schritt B2 und B3**: Plattformen und Berechtigungen müssen in Azure stimmen,
sonst schlägt die Anmeldung fehl (`AADSTS90023` kommt genau von dort).

Ist keine ID hinterlegt, ist der Knopf „Mit Microsoft anmelden" ausgegraut;
alles andere funktioniert normal weiter.

## B1. Anwendung in Azure registrieren

1. <https://portal.azure.com> öffnen → **Microsoft Entra ID** →
   **App-Registrierungen** → **Neue Registrierung**

2. **Name:** `Inkwell`

3. **Unterstützte Kontotypen:**
   > *Konten in einem beliebigen Organisationsverzeichnis und persönliche
   > Microsoft-Konten*

   Damit funktionieren private Konten (outlook.com, hotmail.com) und
   Geschäftskonten. Nur private Konten wären auch möglich — dann in
   `cloudConfig.js` zusätzlich `TENANT: 'consumers'` setzen.

4. **Registrieren** klicken. Auf der Übersichtsseite steht danach die
   **Anwendungs-ID (Client)** — die wird gleich gebraucht.

## B2. Plattformen eintragen

Links im Menü **Authentifizierung** → **Plattform hinzufügen**.

**Erste Plattform: „Single-page application"** (für die Website)

Weiterleitungs-URIs:
```
https://inkwells.me/
http://localhost:8080/
```

> ⚠️ **Das ist die häufigste Fehlerquelle.** Azure bietet auch eine Plattform
> namens **„Web"** an, und die Adresse `https://inkwells.me/` rutscht dort
> schnell hinein — Azure verwendet den ersten Treffer und **verweigert dann
> den Tokentausch aus dem Browser**:
>
> ```
> AADSTS90023: Cross-origin token redemption is permitted only for the
> 'Single-Page Application' client-type …
> ```
>
> **Behebung:** Authentifizierung öffnen → unter **Web** die Adresse
> `https://inkwells.me/` (und ggf. `http://localhost:8080/`) **entfernen** →
> unter **Single-page application** neu eintragen → **Speichern**.
> Danach im Browser einmal neu laden; Änderungen greifen meist sofort,
> gelegentlich dauern sie ein paar Minuten.
>
> Der Grund: nur der SPA-Client-Typ schickt die CORS-Kopfzeilen mit, die der
> Browser für den Aufruf des Token-Endpunkts braucht. Die Plattform „Web" ist
> für Server gedacht, die zusätzlich ein Client-Secret mitschicken.

**Zweite Plattform: „Mobile Anwendungen und Desktopanwendungen"**
(für die App)

Weiterleitungs-URI:
```
http://127.0.0.1:3000/callback
```

Zusätzlich auf derselben Seite ganz unten:

> **Öffentliche Clientflows zulassen** → **Ja**

Ohne diesen Schalter lehnt Microsoft die Anmeldung aus der Desktop-App mit
`unauthorized_client` ab.

**Dritte Plattform: „Web"** (für Firebase)

Weiterleitungs-URI:
```
https://inkwell-53ab9.firebaseapp.com/__/auth/handler
```

Diese Adresse zeigt Firebase selbst an, wenn dort der Microsoft-Anbieter
eingerichtet wird (Abschnitt C5, Schritt 1b). Sie gehört hierher und
**nirgendwo sonst hin**: Firebase tauscht den Code auf seinem eigenen
Server ein und schickt dabei das Anwendungsgeheimnis mit — genau dafür ist
die Plattform „Web" da.

> Das ist kein Widerspruch zur Warnung oben. Dort ging es um
> `https://inkwells.me/`, die aus dem Browser ohne Geheimnis arbeitet und
> deshalb unter SPA gehört. Beides kann nebeneinander stehen.

Zur Kontrolle sollte die Seite *Authentifizierung* danach so aussehen:

| Plattform | Adressen |
|-----------|----------|
| Single-page application | `https://inkwells.me/`, `http://localhost:8080/` |
| Mobile Anwendungen und Desktopanwendungen | `http://127.0.0.1:3000/callback` |
| Web | `https://inkwell-53ab9.firebaseapp.com/__/auth/handler` |

Drei Plattformen, drei verschiedene Aufgaben: die SPA-Plattform aktiviert
die CORS-Kopfzeilen für die Website, die Desktop-Plattform erlaubt die
Loopback-Adresse der App, die Web-Plattform gehört Firebase.

## B3. Berechtigungen

**API-Berechtigungen** → **Berechtigung hinzufügen** → **Microsoft Graph**
→ **Delegierte Berechtigungen**:

```
openid
email
profile
offline_access
User.Read
Files.ReadWrite.AppFolder
```

`User.Read` wird für `GET /me` gebraucht — daraus kommen Name und E-Mail des
Kontos. Ohne diese Berechtigung antwortet Microsoft Graph mit `403`.

`Files.ReadWrite.AppFolder` gibt Zugriff **nur** auf den eigenen Ordner
`Apps/Inkwell` — nicht auf das übrige OneDrive. Anders als bei Google ist
dieser Ordner für den Nutzer sichtbar. Eine Administrator-Zustimmung ist
dafür normalerweise nicht nötig.

`offline_access` sorgt für das Refresh-Token, dank dem die Sitzung nicht
stündlich abläuft.

**Ein Client-Secret wird nicht gebraucht** — bitte auch keines anlegen. Es
würde in der ausgelieferten .exe landen und wäre auslesbar.

## B4. Anwendungs-ID eintragen

Die ID sieht aus wie `11111111-2222-3333-4444-555555555555`.

**App** — `src/core/cloudConfig.js`:
```js
const MICROSOFT_CONFIG = {
  CLIENT_ID: 'HIER_DIE_ID_EINFÜGEN',
  ...
```

**Website** — `website/js/config.js`:
```js
const MICROSOFT_CLIENT_ID = 'HIER_DIE_ID_EINFÜGEN';
```

Beide Male **dieselbe** ID. Danach App neu starten und Website neu
deployen — fertig.

## B5. Was in OneDrive angelegt wird

Unter `OneDrive/Apps/Inkwell`:

| Was | Wozu |
|-----|------|
| `<Heftname>__<id>.json` | je ein Notizbuch |
| `Papierkorb/` | gelöschte Hefte, 30 Tage lang |
| `inkwell-papierkorb.json` | Liste der gelöschten Hefte |

> Die Kennung im Dateinamen ist nötig, weil OneDrive keine unsichtbaren
> Zusatzeigenschaften kennt wie Google Drive. Beim Umbenennen eines Hefts
> ändert sich nur der vordere Teil, die Zuordnung bleibt erhalten.

## B6. Wenn es nicht klappt

| Meldung | Ursache |
|---------|---------|
| `AADSTS90023` / „Cross-origin token redemption…" | Die Website-Adresse steht in Azure unter der Plattform **Web** statt unter **Single-page application** → Schritt B2 |
| `AADSTS9002326` | dasselbe: Microsoft erwartet den SPA-Client-Typ → Schritt B2 |
| `unauthorized_client` | „Öffentliche Clientflows zulassen" steht auf Nein (Schritt B2) |
| `invalid_request` / `AADSTS50011` | Adresse fehlt oder steht in der falschen Plattform |
| `invalid_client` | Anwendungs-ID falsch oder nicht eingetragen |
| `consent_required` | Geschäftskonto, dessen Organisation eine Freigabe verlangt |
| Graph antwortet `403` auf `/me` | Berechtigung `User.Read` fehlt (Schritt B3) |
| „Nicht verifizierte App" | Normal ohne Verlagsverifizierung — man kann trotzdem fortfahren |

Die App schreibt beim Anmeldeversuch die verwendete Adresse ins Log:
```
[CloudSync] redirect_uri = http://127.0.0.1:3000/callback
```
Genau diese muss in Azure hinterlegt sein.

## B7. Wie lange die Microsoft-Sitzung hält

Das Zugriffstoken ist auch bei Microsoft nur etwa eine Stunde gültig — das
sieht man aber nicht, weil im Hintergrund still ein neues geholt wird
(`offline_access` liefert das Refresh-Token dafür).

| Wo | Laufzeit des Refresh-Tokens |
|----|-----------------------------|
| Desktop-App | gleitendes 90-Tage-Fenster — wer die App regelmäßig benutzt, bleibt dauerhaft angemeldet |
| Website (SPA) | 24 Stunden, danach einmal neu anmelden (Vorgabe von Microsoft für Single-Page-Anwendungen, nicht abschaltbar) |

Im Konto-Fenster der App steht deshalb bei Microsoft **keine Restlaufzeit**
mehr, sondern der Hinweis, dass die Sitzung automatisch erneuert wird. Die
frühere Anzeige „Sitzung läuft in 59 Min. ab" bezog sich nur auf das
Zugriffstoken und war irreführend.

Eine echte Neuanmeldung verlangt Microsoft erst, wenn das Refresh-Token
ungültig wird (Passwort geändert, Zugriff unter
<https://account.live.com/consent/Manage> entzogen, lange nicht benutzt).
Die App erkennt das an `invalid_grant` und fordert dann gezielt zum
erneuten Anmelden auf, statt es still weiter zu versuchen.
