# Hinweise für Claude Code

An diesem Projekt arbeiten zwei Leute gleichzeitig, jeder mit Claude Code.
Die Regeln hier sorgen dafür, dass sich das nicht in die Quere kommt.

## Offene Fehler

`BUGS.md` listet bekannte, noch nicht behobene Fehler mit Datei und Zeile.
Wer nach Fehlern gefragt wird oder „mach die Bugs“ hört: dort anfangen. Einen
behobenen Eintrag im selben Commit aus `BUGS.md` löschen.

## Git — vor und nach jeder Aufgabe

**Vor dem Anfangen:** `git pull`. Sonst wird auf einem veralteten Stand
gebaut und der Konflikt kommt später umso härter.

**Nach dem Fertigwerden:** festschreiben und hochladen, ohne vorher extra
nachzufragen — beide Nutzer haben das erlaubt.

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
- `src/core/share.js` und `website/js/share.js` gehören zusammen — dasselbe
  gilt für `docx.js`. Bearbeitet wird **immer die Fassung unter `src/core/`**,
  die ist die Quelle. `npm run sync-share` erzeugt daraus die Kopie unter
  `website/js/` und läuft vor `npm run deploy-web` von selbst.

  Nicht andersherum: `website/` steht in `.gitignore` und erreicht den anderen
  Rechner nie. Als Quelle würde es beim nächsten Abgleich den frisch geholten
  Stand des anderen überschreiben — zweimal schon geschehen.
- Regeländerungen an Firestore oder RTDB mit `npm run test:rules` im Emulator
  prüfen — dort laufen sie wirklich.
- In `website/firestore.rules` muss `adminUid()` die echte UID enthalten, nicht
  den Platzhalter. Vor jedem Deploy nachsehen.

## Testen bei sichtbaren Änderungen (CSS, UI)

Kurz das Wichtigste selbst prüfen, nicht jeden Zustand mit Headless-Browser
und Screenshots durchspielen — das kostet mehr Zeit, als es bringt. Danach in
zwei Sätzen sagen: was schon geprüft wurde und was der Nutzer selbst noch
ansehen soll.

Bei einer kleinen Nachbesserung direkt im Anschluss an eine bereits geprüfte
Änderung (z. B. nur noch eine Farbe oder ein Hover-Zustand) reicht ein Blick
in den Code — dafür keinen eigenen lokalen Server mehr starten und keine neuen
Screenshots machen.

## Schon behobene Meldungen

Wird einer dieser Fehler erneut gemeldet, ist er **nicht** neu: erst
nachsehen, ob die Behebung noch im Code steht (Commit bzw. Stelle unten),
und dann nach einer *anderen* Ursache suchen — nicht dieselbe Lösung ein
zweites Mal bauen.

Behoben am 20. 10. 2026:

| Meldung | Ursache und Behebung | Wo |
| --- | --- | --- |
| Halten beim Schreiben macht alles zur Geraden | Nur noch, wenn der Strich wie eine Gerade aussieht (Umweg, Abweichung) | `siehtWieGeradeAus`, `src/canvas/input.js`; Test `test-linie-halten.js` |
| Stift schreibt schon beim Schweben, nach Neustart wieder gut | Aufsetzen mit Druck 0 beginnt keinen Strich, anhaltender Druck 0 beendet ihn | `stiftOhneDruck`, `keinKontaktMehr`, `src/canvas/input.js` |
| Objekt mit dem Finger verschieben rollt die Seite mit | Hat ein Zug den Finger gefangen (`setPointerCapture`), rollt `app.js` nicht | „WER DEN FINGER FÄNGT“, `src/app.js` |
| Tabelle nach Verschieben nicht mehr auswählbar | Kleiner Knopf neben der Tabelle (Maus in der Nähe / Antippen) holt die Leiste | „DER KNOPF NEBEN DER TABELLE“, `src/core/tables.js` |
| Freigabe aktivieren lädt ewig / „schon freigegeben“, aber nichts änderbar | Stapel nach Gewicht (≤ 4 MB) statt nur nach Anzahl; laufendes Hochladen wird abgewartet | `stapel()`, `src/core/share.js`; `laufendeFreigaben`, `src/ui/share.js` |
| PDF-Export legt Text und Gezeichnetes übereinander | Druck-CSS kannte `p.j-frei`, `table.j-table[x]` und `.j-folie` nicht | `buildPdf`, `mitTabellenLage`, `src/core/importExport.js` |
| Website/iPhone: Freigeben geht nicht trotz Google-Anmeldung | ID-Token wird über den Seitenwechsel ins Dashboard mitgenommen | `website/js/common.js` (`loeseGemerkteKennungEin`) |
| Website/Safari: nach Verlassen abgemeldet | Google gibt der Website nur 1 h ohne Refresh-Token. Konto bleibt gemerkt, Knopf „Wieder verbinden“ | `isInkwellsKnown`, `erneuereMitKlick`; `website/dashboard/dashboard.js` |
| Website: farbige Abschnittslinie fehlt | `has-sec` und `--sec-color` am Seitenkopf | `website/js/viewer.js` |
| Website: Spalt über der klebenden Heftleiste | Navigationshöhe genau gemessen, Leiste 1 px darunter | `website/js/viewer.js`, `website/css/notebook.css` |

Die Website-Zeilen gelten erst, wenn `npm run deploy-web` gelaufen ist —
`website/` reist nicht über Git.

Noch **nicht** gelöst: „neben offener PDF-Ansicht verschwinden Zoomwert,
− und + aus der Werkzeugleiste“. Ließ sich nicht nachstellen. Versucht
und verworfen: `overflow: clip` an `.journal-layout` / `.editor-col` —
bricht `test:stift`, `test:lasso` und `test:touch`.

Electron-Tests aus Claude Code heraus: `ELECTRON_RUN_AS_NODE` ist dort
gesetzt, also `env -u ELECTRON_RUN_AS_NODE npm run test:…`.
