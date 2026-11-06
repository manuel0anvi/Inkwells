# Offene Fehler

Die Liste vom 7. 10. 2026 ist am 6. 11. 2026 abgearbeitet worden (siehe Commits von diesem Tag).
Hier steht nur, was danach noch offen ist.

**Wer einen Fehler behebt: Eintrag hier löschen** (im selben Commit). Was falsch war, steht
dann in der Commit-Nachricht. Sicherheit: ✔ sicher · ~ wahrscheinlich · ? Verdacht.

## Kleineres

- [ ] ~ Die Eingabe-Prüfstände schwanken (`test:stift` „Und malt keinen Punkt“, `test:touch`, `test:schreiben`,
  `test:klick`): dieselben Meldungen kommen auch ohne Änderung am Code und verschwinden beim Wiederholen. Sie hängen
  an Zeit und Fokus. Vor einem Urteil zwei-, dreimal laufen lassen; sauber wären Warten auf Ereignisse statt fester Pausen.

## Verbesserungen, bewusst noch nicht gemacht

- [ ] Firebase kommt zur Laufzeit von gstatic (`src/core/share.js`, `website/js/firebase.js`). Gebündelt
  wäre kein fremder Code mehr im Spiel, und Teilen ginge auch nach einem Offline-Start ohne Neuladen. Heikel: es
  berührt Anmeldung und Teilen auf App UND Website, und das lässt sich nur mit echten Konten prüfen.
- [ ] Die CSP erlaubt weiter `'unsafe-inline'` bei Skripten. Der Rückfallweg der Realtime Database (Long-Polling)
  braucht es. Der eigentliche Schutz ist, dass fremde Texte nie als HTML eingesetzt werden (`scripts/test-fremde-namen.js`).
- [ ] Beim Start werden alle Hefte ganz geladen (`loadNotebooksFromRegistry`). Erst bei Bedarf laden spart Zeit und Speicher,
  ist aber ein grösserer Umbau: Suche, Sync und Papierkorb gehen davon aus, dass alles im Speicher liegt.
- [ ] 126 leere `catch`-Blöcke. Nicht auf einen Schlag, sondern beim Bearbeiten der jeweiligen Datei prüfen.
- [ ] `doLoad` in `src/core/importExport.js` hat keinen Knopf mehr (`btn-load` fehlt in `index.html`).
- [ ] Geteilte Hefte behalten ihre gruppierte `pageOrder`, bis der Besitzer sie das nächste Mal speichert.
