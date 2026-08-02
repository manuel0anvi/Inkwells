# Hinweise für Claude Code

An diesem Projekt arbeiten zwei Leute gleichzeitig, jeder mit Claude Code.
Die Regeln hier sorgen dafür, dass sich das nicht in die Quere kommt.

## Git — vor und nach jeder Aufgabe

**Vor dem Anfangen:** `git pull`. Sonst wird auf einem veralteten Stand
gebaut und der Konflikt kommt später umso härter.

**Nach dem Fertigwerden:** festschreiben und hochladen — aber erst, wenn der
Nutzer es sagt. Nicht ungefragt committen oder pushen.

Wird ein Push abgelehnt (*„updates were rejected"*), ist der andere schneller
gewesen. Dann `git pull`, den Konflikt lösen, `git push`. **Niemals**
`git push --force` und niemals `git reset --hard` auf gemeinsame Branches —
damit wird die Arbeit des anderen gelöscht.

Lieber viele kleine Commits als einen großen. Kleine Änderungen führt Git
problemlos zusammen, ein Tagewerk am Stück nicht.

Commit-Nachrichten auf Deutsch, im Präsens, mit einem Satz zum *Warum*.

## Die drei Branches

| Branch | Inhalt |
| --- | --- |
| `app` | die Desktop-App — alles außer `website/`. Hier wird gearbeitet |
| `website` | ausschließlich der Inhalt von `website/`, im Wurzelverzeichnis |
| `main` | nur die README |

Der Branch `website` wird **nicht von Hand** angefasst. Er entsteht aus
`npm run deploy-web`, das den Inhalt von `website/` dorthin schiebt.

`website/` steht in `.gitignore` und liegt nur örtlich. Der Ordner ist trotzdem
da und wird von `npm run web` gebraucht — nicht wundern, dass Git ihn nicht
anzeigt, und nicht versuchen, ihn hinzuzufügen.

## Zugangsdaten

Das Repo ist **öffentlich**. Es darf deshalb kein Geheimnis in den Code.

Das Google-Client-Secret steht in `src/core/cloudConfig.local.js` — die Datei
ist in `.gitignore` und bleibt auf dem jeweiligen Rechner. Im Repo liegt nur
die leere Vorlage `cloudConfig.local.example.js`.

Client-IDs, Firebase-Web-Keys und die OAuth-Endpunkte sind dagegen öffentlich
und dürfen im Code stehen. Geschützt wird über `website/firestore.rules`, nicht
über Geheimhaltung der Keys.

Vor einem Push, der neue Konfigurationswerte enthält: kurz prüfen, dass kein
`GOCSPX-`, kein privater Schlüssel und kein Token dabei ist.

## Vor dem Festschreiben prüfen

```
npm test
```

Läuft die Aufteilung der Hefte, den Textabgleich, die Schreibmarken und das
gemeinsame Speichern durch. Schlägt etwas fehl: nicht committen, sondern die
Ursache suchen. Die Tests sind der einzige Schutz davor, dass eine Änderung an
der Live-Zusammenarbeit still etwas kaputt macht.

## Beim Ändern beachten

- Kommentare und Bezeichner sind auf Deutsch und erklären das *Warum*, nicht
  das *Was*. Diesen Ton beibehalten.
- `src/core/share.js` und `website/js/share.js` gehören zusammen. Wird an der
  Live-Zusammenarbeit etwas geändert, muss `npm run sync-share` laufen.
- Regeländerungen an Firestore oder RTDB mit `npm run test:rules` im Emulator
  prüfen — dort laufen sie wirklich.
- In `website/firestore.rules` muss `adminUid()` die echte UID enthalten, nicht
  den Platzhalter. Vor jedem Deploy nachsehen.
