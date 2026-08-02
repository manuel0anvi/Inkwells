# Inkwell - Notizen & Handschrift App

Inkwell ist eine hybride Notiz-App, die es ermöglicht, sowohl getippten Text als auch handschriftliche Notizen in einer Oberfläche zu vereinen.

## Funktionen
- **Text & Handschrift:** Kombiniere klassische Textnotizen mit handschriftlichen Zeichnungen direkt auf einem digitalen Canvas.
- **Canvas-Unterstützung:** Zeichnen, Skizzieren und Schreiben per Stift/Maus (integriert im `canvas/` Modul).
- **PDF-Support:** Integrierter PDF-Viewer (via `pdf.js`), um Dokumente anzuzeigen und darauf zu schreiben.
- **Auto-Save & State Management:** Notizen werden im Hintergrund gespeichert und synchronisiert (`core/autoSave.js`, `core/state.js`).
- **Modulare UI:** Aufgeräumte Benutzeroberfläche mit Sidebar, Toolbar und einem Home-Grid für alle Notizen.

## Projektstruktur
- `main.js` / `preload.js`: Electron-Setup und sichere Brücke zwischen Backend und Frontend.
- `src/` - Quellcode der App:
  - `core/`: Geschäftslogik (Speichern, Datenhaltung, Synchronisation, Settings).
  - `canvas/`: Zeichenlogik, Werkzeuge und Input-Handling für Handschrift.
  - `ui/`: Benutzeroberfläche, Grid-Ansichten, Sidebar und Toolbars.
  - `css/`: Styling der verschiedenen Module.
  - `lib/`: Externe Bibliotheken wie PDF.js.

## Branches

| Branch | Inhalt |
| --- | --- |
| `app` | die Desktop-App — alles außer dem Ordner `website/` |
| `website` | ausschließlich der *Inhalt* von `website/`, direkt im Wurzelverzeichnis. Daraus baut GitHub Pages inkwells.me |
| `main` | nur die README |

Die beiden Branches sind bewusst getrennt und haben nichts gemeinsam. `website/`
steht deshalb in `.gitignore` und liegt nur örtlich. Wer die Website bearbeiten
will, holt sie sich dorthin:

```
git clone -b website https://github.com/manuel0anvi/Inkwell.git website
```

Danach funktionieren `npm run web` und `npm run deploy-web` wie gehabt.

## Zu zweit arbeiten

```
git pull            # holen, was der andere hochgeladen hat
git push            # eigenes hochladen
```

VS Code fragt alle drei Minuten von selbst nach (`.vscode/settings.json`).
Hat der andere etwas hochgeladen, steht unten links im blauen Balken ein Pfeil
mit Zahl — z. B. `↓ 2` für zwei wartende Commits. Ein Klick auf **Sync
Changes** holt sie und lädt gleichzeitig die eigenen hoch.

Wichtig: **erst festschreiben, dann holen.** Ein `git pull` mit ungespeicherten
Änderungen bricht ab oder erzeugt unnötige Konflikte.

```
git add -A
git commit -m "was ich gemacht habe"
git pull
git push
```

Wer wann was geändert hat:

```
git log --oneline --graph        # Verlauf
git blame src/core/share.js      # wer schrieb welche Zeile
```

## Entwicklung

Node.js wird benötigt. Einmalig:

```
npm install
```

### Zugangsdaten eintragen

Das Google-Client-Secret liegt **nicht** im Repo. Ohne diesen Schritt läuft
alles, nur muss die Google-Anmeldung stündlich erneuert werden.

Die Vorlage `src/core/cloudConfig.local.example.js` kopieren, in
`src/core/cloudConfig.local.js` umbenennen und das Secret eintragen. Die
Datei steht in `.gitignore` und bleibt auf dem eigenen Rechner. Wo das
Secret herkommt, steht in `CLOUD_SETUP.md`, Abschnitt 4.

### Desktop-App starten

```
npm start
```

### Website lokal ansehen

```
npm run web
```

Danach im Browser <http://localhost:8080> öffnen. Die Seite muss über einen
Server laufen — wird die HTML-Datei direkt per Doppelklick geöffnet
(`file://`), verweigert Google die Anmeldung.

Falls 8080 belegt ist (meist läuft der Server schon), den blockierenden
Vorgang beenden — in PowerShell:

```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080 -State Listen).OwningProcess -Force
```

Oder einen anderen Port nehmen:

```powershell
$env:PORT=8081; npm run web
```

> Ein anderer Port muss ebenfalls in der Google Cloud Console eingetragen
> sein, sonst funktioniert dort die Anmeldung nicht.

> **Für den Google-Login beim lokalen Testen** muss `http://localhost:8080`
> in der Google Cloud Console eingetragen sein — als *autorisierte
> JavaScript-Quelle* **und** als *Weiterleitungs-URI* (mit Schrägstrich am
> Ende: `http://localhost:8080/`). Siehe `CLOUD_SETUP.md`.
>
> Ohne diesen Eintrag funktioniert auf der lokalen Seite alles außer der
> Anmeldung.

### Installer bauen

```
npm run build
```

## Weitere Dokumentation
- `CLOUD_SETUP.md` — Google-Anmeldung und Drive-Synchronisation einrichten
- `src/ARCHITECTURE.md` — Aufbau der Module
