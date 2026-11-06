# Offene Fehler

Gefunden am 7. 10. 2026 durch fünf Such-Agenten, die nur den Code gelesen haben, nicht die
laufende App. Zeilenangaben gelten für den Stand von damals – vor dem Beheben nachsehen.

**Wer einen Fehler behebt: Eintrag hier löschen** (im selben Commit). Was falsch war, steht
dann in der Commit-Nachricht. Sicherheit: ✔ sicher · ~ wahrscheinlich · ? Verdacht.

## 1. Kann Daten oder Hefte kosten


## 2. Rückgängig macht das Falsche


## 3. Deutlich sichtbar


## 4. Offline, Anmeldung, Sync

- [ ] ✔ **„Frühere Fassungen“ ohne Netz löscht auch die lokale Liste.**
  `src/ui/notebookActions.js:252-258` (`innerHTML = ''` im catch); „Lädt…“ wird sofort gelöscht (`:195`).
- [ ] ~ **WLAN ohne Internet: nach ~10 s „Sync fehlgeschlagen“, danach „Alles gesichert“.**
  `src/core/cloudSync.js:177-178, 1930-1945` verwirft nach 3 Netzfehlern; `_onConnectivityChange(true)`
  glaubt dem `online`-Ereignis ungeprüft; `_request` wirft „401 – Sitzung abgelaufen“ (`:1303`) auch,
  wenn die Sitzung offline behalten wurde.
- [ ] ~ **„Melden“ und Freigabe-Dialog ohne Netz hängen mit gesperrtem Knopf** – `src/ui/melden.js:132-139`,
  `share.js:4502` (`addDoc` ohne Zeitgrenze).
- [ ] ✔ **„Wieder online – „X“ und 0 weitere …“** bei genau einem Heft – `cloudSync.js:2848-2851`.
- [ ] ~ **„Offline-Änderungen wurden hochgeladen“ beim Start, ohne offline gewesen zu sein** – `cloudSync.js:1371, 1966-1974`.
- [ ] ? **Nach Offline-Start bleibt Teilen bis zum Neustart tot** (Firebase-Modul lädt nie nach; `share.js:32-42`).
- [ ] ? **Abmelden bei offenem fremdem Dokument beendet die Live-Sitzung nicht** – `sharedDocs.js:1673, 1690`.

## 5. Kleineres

- [ ] ✔ Beim Import stapeln sich Dutzende Fortschritts-Toasts; PDF-Text zählt zweimal von vorn
  (`homeGrid.js:243-246, 277-282`, `importExport.js:1477, 1514`, `dialogs.js:220-225`); PDF als Bild
  meldet gar keinen Fortschritt (`importExport.js:844`).
- [ ] ✔ Sprachänderung bleibt, obwohl Einstellungen mit ✕ geschlossen (`settings.js:228, 35-49`).
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
