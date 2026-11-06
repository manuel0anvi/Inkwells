# Offene Fehler

Die Liste vom 7. 10. 2026 ist am 6. 11. 2026 abgearbeitet worden (siehe Commits von diesem Tag).
Hier steht nur, was danach noch offen ist.

**Wer einen Fehler behebt: Eintrag hier löschen** (im selben Commit). Was falsch war, steht
dann in der Commit-Nachricht. Sicherheit: ✔ sicher · ~ wahrscheinlich · ? Verdacht.

## Noch offen

- [ ] Firebase kommt zur Laufzeit von gstatic (`src/core/share.js`, `website/js/firebase.js`). Gebündelt
  wäre kein fremder Code mehr im Spiel, und Teilen ginge auch nach einem Offline-Start ohne Neuladen. Heikel: es
  berührt Anmeldung und Teilen auf App UND Website, und das lässt sich nur mit echten Konten prüfen.
- [ ] Die CSP erlaubt weiter `'unsafe-inline'` bei Skripten. Der Rückfallweg der Realtime Database (Long-Polling)
  braucht es. Der eigentliche Schutz ist, dass fremde Texte nie als HTML eingesetzt werden (`scripts/test-fremde-namen.js`).
