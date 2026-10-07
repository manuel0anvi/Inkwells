# Offene Fehler

Gefunden am 7. 10. 2026 durch fünf Such-Agenten, die nur den Code gelesen haben, nicht die
laufende App. Zeilenangaben gelten für den Stand von damals – vor dem Beheben nachsehen.

**Wer einen Fehler behebt: Eintrag hier löschen** (im selben Commit). Was falsch war, steht
dann in der Commit-Nachricht. Sicherheit: ✔ sicher · ~ wahrscheinlich · ? Verdacht.

## 1. Kann Daten oder Hefte kosten

- [ ] ✔ **„Alle übertragen“ auf ein anderes Laufwerk scheitert immer und überschreibt gleichnamige Hefte.**
  `main.js:2594` (`move-file`) nutzt nur `fs.renameSync` → EXDEV zwischen Laufwerken; unter Windows
  ersetzt rename eine vorhandene Zieldatei. Lösung: bei EXDEV copyFileSync+unlinkSync; vorher prüfen,
  ob das Ziel existiert, dann freier Name (wie `_freierPfad`).
- [ ] ✔ **Ein Heft verschwindet still und dauerhaft, wenn seine Datei beim Start kurz fehlt** (USB, Netzlaufwerk).
  `src/core/init.js:430-461` ruft `Registry.remove`. Lösung: als „nicht erreichbar“ markieren und anzeigen,
  mindestens ein Toast mit den Namen.
- [ ] ✔ **Speicherort: nach abgebrochenem oder misslungenem Umzug stellt „OK“ den neuen Ordner trotzdem ein.**
  `src/ui/settings.js:57, 173-180, 195-198, 309` – das Feld behält den neuen Ordner, `saveSettingsFromUI`
  schreibt `saveLocation` aus dem Feld. Lösung: Feld bei Abbruch auf `Settings.get('saveLocation')` zurück.
- [ ] ✔ **Ein misslungener Dokument-Import legt trotzdem ein leeres Heft an.**
  `src/ui/homeGrid.js:284-295` fängt den Fehler selbst ab, der Aufrufer (`:691`) merkt nichts.
  Lösung: im inneren catch nach der Meldung `throw err`.
- [ ] ✔ **Beenden mit Speicherfehler: App hängt unter „Wird gesichert …“.**
  `src/core/init.js:256, 326, 339, 348` – die Rückfrage (z-index 950) liegt unter `.quitting` (99999,
  `src/css/modals.css:2088`); nach Abbruch wird die Klasse `an` nie entfernt. Lösung wie `update.js:136`.

## 2. Rückgängig macht das Falsche

- [ ] ✔ **Strg+Z nimmt den Schritt einer anderen Seite zurück und springt dorthin; „Wiederholen“ geht verloren.**
  `src/app.js:478-483` (`popPageHistory`) lässt die ID in `_schrittFolge` stehen; `pushPageHistory`
  (`:442-461`) leert Redo schon vorher. Aufrufer: `src/canvas/input.js:1636, 1682, 1693, 2032`.
- [ ] ✔ **Bild/Auswahl auf andere Seite ziehen, dann Strg+Z: auf beiden Seiten weg.**
  `src/canvas/objects.js:1526, 1565, 1673`, `src/canvas/strokeSelect.js:468, 533` – zwei getrennte
  Schritte. Lösung: gemeinsame `gruppe` (gibt es in `app.js:424-428`).
- [ ] ✔ **Strich-Radierer: Antippen löscht nichts, legt aber einen leeren Rückgängig-Schritt an.**
  `src/canvas/input.js:1049, 1067-1081, 1487-1491, 1575`. Formen erwischt er gar nicht.
- [ ] ✔ **Bloßes Antippen der Strichauswahl legt einen Rückgängig-Schritt an.**
  `src/canvas/strokeSelect.js:281, 408, 468` – erst bei echter Bewegung sichern (`_hasMutated` wie objects.js).
  Endgriff einer Geraden ohne `pointercancel` (`:426-433`).

## 3. Deutlich sichtbar

- [ ] ✔ **Namen mit `<` oder `&` zerschießen Heftkarte und Navigation – bei geteilten Dokumenten HTML-Einschleusung.**
  `src/ui/homeGrid.js:44`, `src/ui/sidebar.js:76-77` setzen Namen per `innerHTML`. Lösung: `textContent`.
- [ ] ✔ **Nur-Lese-Dokument: Stifttipp stellt auf „Stift“, danach kein Markieren und kein Zurück.**
  `src/canvas/input.js:1370` wechselt vor dem readOnly-Ausstieg; `src/ui/toolbar.js` `applyMode` setzt
  `contentEditable` ohne `S.readOnly`. Beim Öffnen eines Nur-Lese-Dokuments auf `cursor` schalten.
- [ ] ✔ **Gedrehte Bilder/Formen: Griffe ziehen falsch herum, Objekt wandert.**
  `src/canvas/objects.js:761, 810-811, 1031-1037`; `objectAt` (`:426-437`) prüft das ungedrehte Rechteck.
- [ ] ✔ **Hineingezoomt ist der linke Teil des Blatts mit Maus/Rollleiste nicht erreichbar.**
  `src/core/zoom.js` (`transformOrigin: 'top center'`) – der Überstand links ist negativ.
- [ ] ~ **Über 121 % springt das verschobene Blatt zurück, sobald der Zoom neu gerechnet wird.**
  `_applyZoom()` überschreibt das `translate` aus `setPan` (app.js).
- [ ] ✔ **Im Hochformat springt die Lesestelle beim Öffnen von Navigation/Kommentaren/Chat.**
  `src/app.js:1568-1576`, `src/ui/comments.js:366`, `src/ui/chat.js:117-120` rufen `_applyZoom()` statt
  `zoomNachrechnenAnDerStelle()`.
- [ ] ✔ **Chat geht neben dem offenen PDF auf** – `src/ui/chat.js:89-101` schließt die Unterlage nicht.
- [ ] ✔ **PDF-Reiter liegen über offener Kommentar-/Chatleiste** – `src/ui/griffbereit.js:492-494`.
- [ ] ✔ **Kommentar-Griff überdeckt Reiter und Rollleiste** – `src/css/pages.css:1894-1903`.
- [ ] ✔ **Kommentarkarten ziehen beim Zoomen/Navigation nicht nach** – `src/ui/comments.js:306-313`
  hört nicht auf `inkwells:zoom`.
- [ ] ~ **Kommentarkarten richten sich nach der ersten statt der aktiven Seite** – `comments.js:239, 271-274`.
- [ ] ~ **Schwebende Kommentar-Einzelkarte bleibt stehen** – `comments.js:548-558, 257, 262-268`.
- [ ] ~ **Kommentar-Griff/Einzelkarte bleiben auf der Startseite** – `showHome` (`src/core/dialogs.js:273`).
- [ ] ~ **Leisten legen sich über die Werkzeugleiste**: feste 60-px-Annahme in `src/core/tables.js:617`,
  `src/canvas/strokeSelect.js:902-905`, `src/ui/comments.js:519, 626`. Seit die Werkzeugleiste umbrechen
  kann (Stufe 7) noch häufiger. Lösung: Oberkante von `#pg-scroll` messen.
- [ ] ~ **Schwebende Kommentarkarte (z 1290) liegt über ihrem eigenen Lösch-Dialog (950).** `pages.css:1937`.
- [ ] ~ **PDF-Ansicht darf so breit werden, dass vom Heft fast nichts bleibt** – `griffbereit.js:723` `grenze()`
  rechnet Navigation und Ordnen-Leiste nicht ab.
- [ ] ✔ **Lineal lässt sich auf die eigene Rollleiste legen** – `src/ui/ruler.js:330` misst 0.
- [ ] ✔ **Escape schließt fast keinen Dialog/kein Popup** (Einstellungen, Export, Freigabe, Papierkorb,
  Fassungen, Konto, Kontextmenüs, alle Aufklapper der Werkzeugleiste). Lösung: ein zentraler Hörer.
- [ ] ~ **Enter in einer Rückfrage öffnet sie gleich noch einmal** – `src/core/dialogs.js:8, 20, 236`
  ohne `preventDefault`, kein Fokus auf OK.
- [ ] ✔ **Speicherplatz-Balken unsichtbar, Avatare ohne Kreis** – `--accent`, `--bg`, `--text`,
  `--text-muted` sind nirgends definiert (`index.html:132, 1900, 1941, 1952`, `auth.js:296`,
  `layout.css:170, 230`, `pages.css:2876`).
- [ ] ✔ **Reihenfolge der Hefte nach dem Ziehen geht beim Neustart verloren** – `homeGrid.js:451-456`;
  Marker hinter der letzten Karte fehlt (`:421`), `targetIdx` falsch mit geteilten Dokumenten (`:420`).
- [ ] ✔ **Textfarben-Menü markiert den Regenbogen statt der gewählten Farbe** – `toolbar.js:1674-1679`.
- [ ] ~ **„Eigene Farbe“-Fenster springt beim Rollen in die Ecke** – `toolbar.js:1314` (Anker unsichtbar).
- [ ] ✔ **„⋯“ an Seite/Heftkarte schließt das Menü nicht, es geht sofort wieder auf** –
  `app.js:957`, `contextMenu.js:160`, `homeGrid.js:49, 465`.
- [ ] ✔ **Kontextmenü der Heftkarte ragt aus dem Fenster** – `homeGrid.js:463`, `sharedDocs.js:398`
  (Klemmrechnung wie `showPgCtxMenu`).
- [ ] ✔ **Lange Heftnamen sprengen Karte und Titelleiste** – `layout.css:536-543`, `titlebar.css:24-38`,
  kein `maxlength` (`index.html:1044`).
- [ ] ✔ **Leere Startseite ohne Hinweis** – `homeGrid.js:26-66` (CSS `.nb-add-card` existiert, wird nie gebaut).

## 4. Offline, Anmeldung, Sync

- [ ] ✔ **„Frühere Fassungen“ ohne Netz löscht auch die lokale Liste.**
  `src/ui/notebookActions.js:252-258` (`innerHTML = ''` im catch); „Lädt…“ wird sofort gelöscht (`:195`).
- [ ] ~ **WLAN ohne Internet: nach ~10 s „Sync fehlgeschlagen“, danach „Alles gesichert“.**
  `src/core/cloudSync.js:177-178, 1930-1945` verwirft nach 3 Netzfehlern; `_onConnectivityChange(true)`
  glaubt dem `online`-Ereignis ungeprüft; `_request` wirft „401 – Sitzung abgelaufen“ (`:1303`) auch,
  wenn die Sitzung offline behalten wurde.
- [ ] ✔ **Geteiltes Dokument ohne Netz: „Verbindung zur Live-Datenbank blockiert“ statt „Kein Internet“.**
  `src/ui/collab.js:78-81, 101`, `src/core/share.js:3418`.
- [ ] ~ **Eigenes Netz weg → „Der Besitzer ist nicht mehr da“** – `src/ui/sharedDocs.js:837-845`.
- [ ] ~ **„Melden“ und Freigabe-Dialog ohne Netz hängen mit gesperrtem Knopf** – `src/ui/melden.js:132-139`,
  `share.js:4502` (`addDoc` ohne Zeitgrenze).
- [ ] ✔ **Einladungslink mit Microsoft-Konto fragt „Jetzt anmelden?“, obwohl angemeldet** –
  `sharedDocs.js:1629-1636`.
- [ ] ✔ **„Wieder online – „X“ und 0 weitere …“** bei genau einem Heft – `cloudSync.js:2848-2851`.
- [ ] ~ **„Offline-Änderungen wurden hochgeladen“ beim Start, ohne offline gewesen zu sein** – `cloudSync.js:1371, 1966-1974`.
- [ ] ? **Nach Offline-Start bleibt Teilen bis zum Neustart tot** (Firebase-Modul lädt nie nach; `share.js:32-42`).
- [ ] ? **Abmelden bei offenem fremdem Dokument beendet die Live-Sitzung nicht** – `sharedDocs.js:1673, 1690`.
- [ ] ~ **„Geteilte Dokumente“ sagt „niemand hat etwas geteilt“, während noch geladen wird** – `sharedDocs.js:323-331`.

## 5. Kleineres

- [ ] ✔ Beim Import stapeln sich Dutzende Fortschritts-Toasts; PDF-Text zählt zweimal von vorn
  (`homeGrid.js:243-246, 277-282`, `importExport.js:1477, 1514`, `dialogs.js:220-225`); PDF als Bild
  meldet gar keinen Fortschritt (`importExport.js:844`).
- [ ] ✔ Sprachänderung bleibt, obwohl Einstellungen mit ✕ geschlossen (`settings.js:228, 35-49`).
- [ ] ✔ Fehlender Übersetzungsschlüssel `tableMove` (`tables.js:532`) – Tooltip zeigt „tableMove“.
- [ ] ✔ `transferAll` doppelt in `translations.js` (350/458, 1361/1841, 2437/2917) – Knopf zeigt nur „Alle“.
- [ ] ✔ Fest eingebautes Deutsch: `index.html:183, 1014, 1380-1384`, `contextMenu.js:204`, `app.js:955`,
  `state.js:18`, `dialogs.js:247`, `shortcuts.js:103-112`, `homeGrid.js:652`. `btn-min`/`btn-close` ohne Tooltip.
- [ ] ~ Tabellenleiste und Maximieren-Tooltip bleiben nach Sprachwechsel alt (`tables.js:415-431`, `titlebar.js:22`).
- [ ] ✔ Datum fest `'de-DE'` (`sharedDocs.js:277`, `state.js:176`).
- [ ] ✔ „in 1 Tagen“, „1 Seiten“ (`notebookActions.js:427-429`, `versionPages`).
- [ ] ~ Doppel-Enter bei „Heft erstellen“ legt zwei Hefte an (`homeGrid.js:617-703, 716`).
- [ ] ~ „Name existiert bereits“ wegen eines geöffneten geteilten Dokuments (`homeGrid.js:622` → `ownNotebooks()`).
- [ ] ✔ Ordnerdialog beim Erststart ohne Titel (`main.js:2002`).
- [ ] ? Abbruch über fremder Seite beendet den Strich auf der falschen Seite (`input.js:1669-1708`).
- [ ] Nebenbei: Kommentarkarten am Ende verlängern den Rollbereich; Chat-Antwortleiste schiebt die
  letzte Nachricht aus dem Blick (`chat.js:648, 660-670`).
- [ ] ~ `npm run test:touch` bricht fast immer mit Zeitüberschreitung ab (auch vor dem 7. 10.) – der Test
  schützt die Touch-Bedienung damit kaum.
