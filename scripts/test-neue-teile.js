#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DREI NEUE TEILE

     1. BILDER AUS DER ZWISCHENABLAGE. Was als Bild gilt und was nicht,
        und wo das Bild auf dem Blatt landet.
     2. DER ZÄHLER. Die vier Zahlen zu einem Stück Text – dort sitzen
        die Feinheiten (Zeilenenden, Umlaute, Leerzeilen).
     3. DER CHAT. Dass er offensteht, wo er offenstehen soll, und
        zubleibt, wo er zubleiben soll.

   Was hier NICHT geprüft wird, weil es ohne echtes Chromium nicht geht:
   das Verkleinern eines Bildes (braucht canvas), das Auspacken des
   HTML einer Seite (braucht ein DOM) und die Regeln der Realtime
   Database. Für die Regeln gibt es den Emulator: npm run test:rules.

   Aufruf:  node scripts/test-neue-teile.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wurzel = path.join(__dirname, '..');
const lies = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), 'utf8');

const importQuelle = lies('src', 'core', 'importExport.js');
const zaehlQuelle = lies('src', 'ui', 'wordCount.js');
const chatQuelle = lies('src', 'ui', 'chat.js');
const kommentarQuelle = lies('src', 'ui', 'comments.js');
const shareQuelle = lies('src', 'core', 'share.js');
const appQuelle = lies('src', 'app.js');

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`  ✗ ${label}`);
    console.error(`      erwartet: ${JSON.stringify(expected)}`);
    console.error(`      bekommen: ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function blockAb(quelle, start, wo) {
  if (start === -1) throw new Error(`${wo} nicht gefunden`);
  let depth = 0, seen = false;
  for (let i = start; i < quelle.length; i++) {
    const ch = quelle[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return quelle.slice(start, i + 1);
    }
  }
  throw new Error(`Ende von ${wo} nicht gefunden`);
}

function funktion(quelle, name) {
  return blockAb(quelle, quelle.search(new RegExp(`(async )?function ${name}\\(`)), name);
}

console.log('1. Bilder aus der Zwischenablage\n');
{
  /* ── Was gilt als Bild? ──────────────────────────────────────────
     Beide Listen werden durchgesehen: ein Bildschirmfoto kommt als
     `items`-Eintrag ohne Namen, eine kopierte Datei als `files`. */
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(funktion(importQuelle, 'zwischenablageHatBild'), ctx);
  const hatBild = ctx.zwischenablageHatBild;

  check('Nichts in der Hand', hatBild(null), false);
  check('Nur Text', hatBild({
    items: [{ kind: 'string', type: 'text/plain' }], files: []
  }), false);

  check('Ein Bildschirmfoto (items, ohne Datei-Eintrag)', hatBild({
    items: [{ kind: 'file', type: 'image/png' }], files: []
  }), true);
  check('Eine kopierte Datei (files, ohne items)', hatBild({
    items: [], files: [{ type: 'image/jpeg', name: 'urlaub.jpg' }]
  }), true);

  /* Ein Bildschirmfoto bringt oft AUCH Text mit – die Anwendung legt
     beides in die Zwischenablage. Das Bild gewinnt. */
  check('Bild und Text zusammen zählt als Bild', hatBild({
    items: [{ kind: 'string', type: 'text/html' }, { kind: 'file', type: 'image/png' }],
    files: []
  }), true);

  /* Eine PDF-Datei ist keine – sie geht den Weg über den Dateiwähler,
     wo man gefragt wird, ob Seiten oder Objekte daraus werden sollen. */
  check('Ein PDF nicht', hatBild({
    items: [{ kind: 'file', type: 'application/pdf' }], files: []
  }), false);
}
{
  /* ── Wo landet das Bild? ─────────────────────────────────────────
     Die Grenzen sind das Eigentliche: über dem Seitenkopf läge es unter
     der Kopfzeile, unter dem Blattrand ragte es hinaus. */
  const ctx = {
    console, Math, Number, String,
    CFG: { PAGE_W: 794, PAGE_H: 1123 },
    BILD_KOPF_PX: 56,
    uid: () => 'o-neu',
    E: () => null,                    // keine Objekt-Ebene: nur ins Heft legen
    placeObject: null
  };
  vm.createContext(ctx);
  vm.runInContext(funktion(importQuelle, 'setzeBildObjekt'), ctx);
  const setze = ctx.setzeBildObjekt;

  const seite = () => ({ id: 'p1', w: 794, h: 1123, objects: [] });

  {
    // Ein breites Bild wird auf die Blattbreite gebracht
    const o = setze(seite(), { url: 'data:x', w: 3840, h: 2160 }, 300);
    check('Breite gedeckelt', o.w, 420);
    check('Seitenverhältnis bleibt', Math.round((o.w / o.h) * 100), Math.round((3840 / 2160) * 100));
    check('Und es steht, wo die Marke war', o.y, 300);
  }
  {
    // Ein hohes Bild darf nicht die ganze Seite füllen
    const o = setze(seite(), { url: 'data:x', w: 400, h: 2000 }, 100);
    check('Höhe gedeckelt', o.h <= Math.round((1123 - 56) * 0.6), true);
  }
  {
    // Ohne Marke: unter den Seitenkopf
    const o = setze(seite(), { url: 'data:x', w: 200, h: 200 });
    check('Ohne Marke unter den Seitenkopf', o.y, 56 + 24);
  }
  {
    // Marke ganz unten: das Bild wird nach oben geschoben
    const o = setze(seite(), { url: 'data:x', w: 200, h: 200 }, 1100);
    check('Ragt nie über den Blattrand', o.y + o.h <= 1123, true);
  }
  {
    // Marke im Seitenkopf: darunter
    const o = setze(seite(), { url: 'data:x', w: 200, h: 200 }, 10);
    check('Und nie in den Seitenkopf hinein', o.y >= 56, true);
  }
  {
    const s = seite();
    setze(s, { url: 'data:x', w: 200, h: 200 }, 200);
    check('Es landet auch im Heft, nicht nur im Fenster', s.objects.length, 1);
    check('Als Bild', s.objects[0].kind, 'image');
  }
}
{
  /* ── Der Weg dorthin ─────────────────────────────────────────────
     Die Frage nach dem Bild steht VOR der Zeilensperre: ein Bild landet
     auf der Seite, nicht in der Zeile, an der ein anderer schreibt. */
  const griff = appQuelle.slice(appQuelle.indexOf("textDiv.addEventListener('paste'"));
  const bild = griff.indexOf('zwischenablageHatBild');
  const sperre = griff.indexOf('lockedHere');
  check('Der Einfüge-Griff fragt nach Bildern', bild > -1, true);
  check('Und zwar vor der Zeilensperre', bild < sperre, true);

  /* Und es gibt einen zweiten Weg für den Fall, dass die Marke gar
     nicht im Text steht (Zeigerwerkzeug, nach dem Rollen). */
  check('Auch ohne Marke im Text kommt ein Bild an',
    /document\.addEventListener\('paste'/.test(importQuelle), true);
  check('Der doppelte Weg ist ausgeschlossen',
    /ziel\.closest\('\.j-text'\)\) return;/.test(importQuelle), true);
}

console.log('\n2. Der Zähler\n');
{
  const ctx = { console, String };
  vm.createContext(ctx);
  vm.runInContext(funktion(zaehlQuelle, 'zaehleText'), ctx);
  const z = ctx.zaehleText;

  check('Nichts ist nichts', z(''), { zeichenMit: 0, zeichenOhne: 0, woerter: 0, absaetze: 0 });
  check('Auch nur Leerraum', z('   \n\n  '), { zeichenMit: 0, zeichenOhne: 0, woerter: 0, absaetze: 0 });

  check('Ein Satz', z('Die Alpen sind hoch.'),
    { zeichenMit: 20, zeichenOhne: 17, woerter: 4, absaetze: 1 });

  /* Zwei Leerzeichen hintereinander machen kein leeres Wort – ein
     naives split(' ') hätte hier fünf gezählt. */
  check('Zwei Leerzeichen sind ein Zwischenraum', z('a  b').woerter, 2);

  /* Ein \r\n wäre sonst zwei Zeichen für einen Umbruch, und die Zahl
     hinge daran, woher der Text kommt. */
  check('Windows-Zeilenenden zählen wie einfache',
    z('eins\r\nzwei').zeichenMit, z('eins\nzwei').zeichenMit);

  // Leerzeilen sind keine Absätze
  check('Leerzeilen zählen nicht als Absatz', z('eins\n\n\nzwei').absaetze, 2);

  // Umlaute sind EIN Zeichen, keine zwei Bytes
  check('Ein Umlaut ist ein Zeichen', z('Größe').zeichenMit, 5);

  // Ohne Leerzeichen heißt ohne JEDEN Leerraum, auch ohne Umbrüche
  check('Ohne Leerzeichen zählt auch Umbrüche nicht mit',
    z('ab\ncd').zeichenOhne, 4);
}
{
  /* Gezählt wird das HEFT, nicht das Fenster: auch die Seiten, die der
     gewählte Abschnitt gerade ausblendet. Ein Zähler, der beim
     Umschalten der Ansicht springt, zählt nichts, was jemand wissen
     will. */
  const zaehle = funktion(zaehlQuelle, 'zaehle');
  check('Über alle Seiten des Hefts', /notebookPages\(nb\)/.test(zaehle), true);
  check('Und nicht über die gerade sichtbaren',
    !/pagesOfSec|visiblePages/.test(zaehle), true);

  /* Die Handschrift steht doppelt. Die Wahrheit für ein offenes Heft
     ist S.strokeHistory – page.inkStrokes wird erst beim Sichern
     nachgezogen. */
  const striche = funktion(zaehlQuelle, 'stricheVon');
  check('Striche erst aus der laufenden Fassung',
    striche.indexOf('S.strokeHistory') < striche.indexOf('page.inkStrokes'), true);

  // Ein Seitenbild ist auch ein Bild, obwohl es nicht in objects steht
  check('Seitenbilder zählen mit', /page\.bgImg\) bilder\+\+/.test(zaehle), true);
}
{
  /* ── Und er liegt NIE auf dem Blatt ──────────────────────────────
     Zuerst hing das Schild frei in der Ecke der Blattspalte und lag je
     nach Fensterbreite, Zoom und geöffneter Navigation halb über dem
     Papier. Eine Rechnung wäre nicht zu halten gewesen – bei einem
     schmalen Fenster gibt es den Rand gar nicht.

     Jetzt ist es eine eigene Zeile UNTER dem Rollbereich. Das ist keine
     Einstellung, sondern Bauart: was ausserhalb von .pg-scroll steht,
     kann das Blatt nicht berühren. */
  const bau = funktion(zaehlQuelle, 'baueSchild');
  check('Das Schild sitzt in einer eigenen Zeile',
    /leiste\.className = 'count-bar'/.test(bau), true);
  check('Und die Zeile hängt an der Blattspalte',
    /spalte\.appendChild\(leiste\)/.test(bau), true);

  const css = lies('src', 'css', 'pages.css');
  const regel = css.slice(css.indexOf('.count-bar {'), css.indexOf('}', css.indexOf('.count-bar {')));
  check('Sie liegt im Fluss und schwebt nicht',
    !/position:\s*(absolute|fixed)/.test(regel), true);
  check('Und nimmt sich ihre Höhe', /min-height/.test(regel), true);

  // Auf der Startseite gibt es kein Blatt – dann ist die ganze Zeile weg
  const zeichne = funktion(zaehlQuelle, 'zeichneSchild');
  check('Ohne offenes Heft ist die Zeile weg',
    /leiste\.style\.display = 'none'/.test(zeichne), true);
}

console.log('\n3. Der Chat\n');
{
  /* ── Der Raum kann es ────────────────────────────────────────── */
  const rueckgabe = shareQuelle.slice(shareQuelle.indexOf('return {\n    me: card,'));
  for (const name of ['sendChat', 'onChat', 'setTyping', 'onTyping']) {
    check('Der Raum gibt ' + name + ' heraus',
      new RegExp('\\b' + name + '\\b').test(rueckgabe.slice(0, 400)), true);
  }

  /* >>> Der Unterschied zum Änderungsstrom <<<
     onOp lässt die EIGENEN Änderungen weg – sie sind örtlich schon
     eingearbeitet. Im Chat ist es umgekehrt: erst wenn die eigene Zeile
     aus dem Raum zurückkommt, steht sie wirklich dort. */
  const onChat = funktion(shareQuelle, 'onChat');
  check('Der Chat filtert die eigenen Zeilen NICHT weg',
    !/op\.by === me\.uid|m\.by === me\.uid\) return/.test(onChat), true);
  check('Sondern kennzeichnet sie', /selbst: m\.by === me\.uid/.test(onChat), true);

  const onOp = funktion(shareQuelle, 'onOp');
  check('Der Änderungsstrom dagegen schon',
    /op\.by === me\.uid\) return/.test(onOp), true);

  /* Name und Farbe reisen MIT. Sonst stünde über jeder Zeile von
     jemandem, der gegangen ist, ein Fragezeichen. */
  const sendChat = funktion(shareQuelle, 'sendChat');
  check('Name, Initialen und Farbe reisen mit',
    /nm:/.test(sendChat) && /ini:/.test(sendChat) && /col:/.test(sendChat), true);
  check('Und die Länge ist begrenzt', /slice\(0, CHAT_MAX_LEN\)/.test(sendChat), true);
}
{
  /* ── Die Regeln kennen den Baum ──────────────────────────────── */
  const regeln = lies('website', 'database.rules.json');
  check('chat/{docId} steht in den Regeln', /"chat":/.test(regeln), true);

  /* Der springende Punkt: lesen darf reicht zum Mitreden. ops verlangt
     `w`, der Chat nur `r` – wer nur zusehen darf, hat oft genau deshalb
     eine Frage. */
  const chatBlock = regeln.slice(regeln.indexOf('"chat":'));
  const schreiben = chatBlock.slice(chatBlock.indexOf('"$msgId"'), chatBlock.indexOf('"$msgId"') + 500);
  check('Schreiben verlangt nur Leserecht',
    /child\('r'\)\.child\(auth\.uid\)/.test(schreiben), true);
  check('Und nicht Schreibrecht am Dokument',
    !/child\('w'\)/.test(schreiben), true);
}
{
  /* ── Die Oberfläche ──────────────────────────────────────────── */
  check('Fremder Text wird als TEXT gesetzt, nicht als HTML',
    /text\.textContent = m\.text/.test(chatQuelle), true);
  check('Und nirgends im Chat als innerHTML',
    !/\.innerHTML\s*=\s*[^'"]/.test(chatQuelle.replace(/innerHTML = ''/g, '')), true);

  // Die Ikone ist nur da, wenn auch sonst jemand da ist
  const ikone = funktion(chatQuelle, 'zeichneIkone');
  check('Die Ikone hängt an der Anwesenheit', /jemandDa\(\)/.test(ikone), true);
  check('Geht der Letzte, geht auch die Leiste',
    /if \(!zeigen && offen\(\)\) setzeOffen\(false\)/.test(ikone), true);

  /* Beide Leisten sitzen an derselben Kante. Nebeneinander bliebe vom
     Blatt nichts übrig. */
  const setzeLeiste = funktion(kommentarQuelle, 'setzeLeiste');
  check('Die Kommentarleiste geht bei offenem Chat nicht auf',
    /window\.chatBlocksComments\(\)/.test(setzeLeiste), true);
  check('Zumachen bleibt aber immer erlaubt',
    /if \(offen && typeof window\.chatBlocksComments/.test(setzeLeiste), true);
  check('Und der Chat macht sie vorher zu',
    /window\.closeCommentPanel\(\)/.test(chatQuelle), true);

  // Enter schickt, Umschalt+Enter macht eine neue Zeile
  check('Enter schickt', /e\.key !== 'Enter' \|\| e\.shiftKey/.test(chatQuelle), true);

  /* Ein <textarea> und kein contenteditable: hier soll NUR Text hinein,
     kein eingefügtes Bild und keine Formatierung. */
  const html = lies('src', 'index.html');
  const ab = html.indexOf('id="chat-panel"');
  const leiste = html.slice(ab, html.indexOf('</aside>', ab));
  check('Das Eingabefeld ist ein textarea', /<textarea id="chat-input"/.test(leiste), true);
  // Als ATTRIBUT gefragt – im Kommentar darüber steht das Wort absichtlich
  check('Und kein contenteditable', !/contenteditable\s*=/.test(leiste), true);
}

console.log('\n4. Wenn die Regeln den Chat noch nicht kennen\n');
{
  /* Der Zweig `chat` ist in der Realtime Database neu. Solange die dort
     veröffentlichten Regeln ihn nicht haben, wird JEDER Zugriff
     abgewiesen – und kein Wiederholen der Welt ändert daran etwas.

     Vorher lief genau das: der Beobachter meldete sich alle halbe Minute
     neu an, die Tipp-Anzeige schickte im Takt des Tippens, und in der
     Konsole stand eine Wand aus permission_denied. */
  const ctx = { console, String };
  vm.createContext(ctx);
  vm.runInContext(funktion(shareQuelle, 'istVerboten'), ctx);
  const verboten = ctx.istVerboten;

  check('permission_denied wird erkannt',
    verboten(new Error('PERMISSION_DENIED: Permission denied')), true);
  check('Auch in der Schreibweise der Datenbank',
    verboten({ message: "permission_denied at /chat/abc/m: Client doesn't have permission" }), true);
  check('Ein Netzfehler dagegen nicht',
    verboten(new Error('network error')), false);
  check('Und gar kein Fehler auch nicht', verboten(null), false);

  /* Die Beharrlichkeit muss aufhören KÖNNEN. Ohne diesen Ausgang gäbe
     es keine Stelle, an der die Wiederholung endet. */
  const beharrlich = funktion(shareQuelle, 'beharrlich');
  check('Der Beobachter kann aufgeben', /typeof aufgeben === 'function'/.test(beharrlich), true);
  check('Und tut es dann endgültig', /beendet = true;\s*\n\s*return;/.test(beharrlich), true);

  // Beide Chat-Beobachter nehmen diesen Ausgang
  check('Der Chat-Strom gibt auf', /\), 'Chat', chatEndgueltig\)/.test(shareQuelle), true);
  check('Die Tipp-Anzeige auch', /\), 'Tipp-Anzeige', chatEndgueltig\)/.test(shareQuelle), true);

  /* Und es wird nichts mehr losgeschickt. setTyping ist dabei das
     Wichtigere: es kommt im Takt des Tippens. */
  const senden = funktion(shareQuelle, 'sendChat');
  const tippen = funktion(shareQuelle, 'setTyping');
  check('Nachrichten gehen dann nicht mehr hinaus', /if \(left \|\| chatAus\)/.test(senden), true);
  check('Und die Tipp-Anzeige erst recht nicht', /if \(left \|\| chatAus\)/.test(tippen), true);

  // Gesagt wird es genau einmal, samt Abhilfe
  const faellt = funktion(shareQuelle, 'chatFaelltAus');
  check('Gemeldet wird einmal', /if \(chatAus\) return true;/.test(faellt), true);
  check('Mit dem, was zu tun ist', /CHAT_HILFE/.test(faellt), true);
  check('Die Abhilfe nennt die Datei',
    /website\/database\.rules\.json/.test(shareQuelle.slice(
      shareQuelle.indexOf('const CHAT_HILFE'), shareQuelle.indexOf('const CHAT_HILFE') + 400)), true);
}
{
  /* Im Fenster darf das nicht als „ich habe nichts geschrieben"
     ankommen. Ein Eingabefeld, in das man tippen kann und aus dem nie
     etwas hinausgeht, ist schlimmer als eines, das gesperrt ist. */
  const sperre = funktion(chatQuelle, 'zeigeSperre');
  check('Der Grund steht in der Leiste', /chat-gesperrt/.test(sperre), true);
  check('Das Feld wird zugemacht', /feld\.disabled = !!gesperrt/.test(sperre), true);
  check('Der Senden-Knopf auch', /senden\.disabled = !!gesperrt/.test(sperre), true);
  check('Und beim Aufheben ist der Hinweis wieder weg',
    /if \(!gesperrt\) \{ leereHinweis\(\); return; \}/.test(sperre), true);

  check('Die Oberfläche hört auf den Zustand',
    /raum\.onChatStatus\(/.test(chatQuelle), true);
  check('Der Raum gibt ihn heraus',
    /onChatStatus/.test(shareQuelle.slice(shareQuelle.indexOf('return {\n    me: card,'),
      shareQuelle.indexOf('return {\n    me: card,') + 400)), true);

  // Kein zweiter Hinweis obendrauf – der Kasten sagt schon alles
  const sende = funktion(chatQuelle, 'sende');
  check('Kein zusätzlicher Toast, wenn der Grund schon dasteht',
    /if \(gesperrt\) return;/.test(sende), true);
}

console.log('\nAbstand statt Leerzeichen\n');
{
  /* ══════════════════════════════════════════════════════════════════
     ES DARF KEIN LEERZEICHEN MEHR AUFGEFUELLT WERDEN

     Wer irgendwohin klickt und dort schreibt, bekam bis dahin echte
     Zeichen: Zeilenumbrueche nach unten, Leerzeichen nach rechts. Die
     zaehlten im Wortzaehler mit, standen im Word-Export, fand die Suche
     und reisten durch Yjs zu allen Beteiligten.

     Geprueft wird die QUELLE und nicht das Verhalten: das Verhalten
     haengt an echten Klicks in einem echten Fenster (dafuer gibt es
     scripts/test-touch). Hier soll auffallen, wenn jemand die alten
     Schleifen wieder einbaut – der Rueckfall waere still. */
  const textQuelle = lies('src', 'canvas', 'text.js');

  check('Keine Leerzeichen-Schleife mehr in canvas/text.js',
    !/' '\.repeat\(/.test(textQuelle), true);
  check('Und keine leeren Zeilen zum Auffuellen',
    !/while \(lines\.length <= targetLine\)/.test(textQuelle), true);

  check('Stattdessen ein Absatz mit einer Lage auf dem Blatt',
    /function _freierAbsatz/.test(textQuelle)
    && /p\.style\.left/.test(textQuelle) && /p\.style\.top/.test(textQuelle), true);

  /* Die Lage rastet senkrecht auf ganze Zeilen ein, sonst saesse der
     Text zwischen den Linien des Papiers. */
  check('Senkrecht rastet sie auf ganze Zeilen ein',
    /Math\.floor\(\(obenRoh - pt\) \/ lh\)/.test(textQuelle), true);

  /* Ein blosser Klick darf nichts hinterlassen (Stufe C). */
  check('Angelegtes gilt erst als vorlaeufig',
    /const VORLAEUFIG/.test(textQuelle)
    && /function raeumeVorlaeufiges/.test(textQuelle), true);
  check('Der erste Anschlag macht es bleibend',
    /function markiereBleibend/.test(textQuelle)
    && /markiereBleibend\(textDiv\)/.test(appQuelle), true);
  check('Und das Verlassen des Feldes raeumt es weg',
    /addEventListener\('blur', \(\) => \{\s*if \(typeof raeumeVorlaeufiges/.test(appQuelle), true);

  /* Ohne die Masse im Sanitizer waere die Stelle beim ersten Abgleich
     verloren – genau das, was die Leerzeichen verhindern sollten. */
  const sauberQuelle = lies('src', 'core', 'sanitize.js');
  check('Der Sanitizer laesst Einzug und Abstand durch',
    /el\.style\.marginLeft = links/.test(sauberQuelle)
    && /el\.style\.marginTop = oben/.test(sauberQuelle), true);
  check('Und die Lage eines freien Absatzes',
    /el\.style\.left = vonLinks/.test(sauberQuelle)
    && /el\.style\.top = vonOben/.test(sauberQuelle), true);
  check('Nur als geprueftes Mass',
    /const istAbstand = \(wert\) => \/\^\\d\{1,4\}/.test(sauberQuelle), true);
  check('Der Abstandshalter bleibt ein Stueck',
    /name === 'contenteditable'/.test(sauberQuelle), true);

  /* Word kennt beides – der Export wird dadurch treuer als vorher. */
  const docxQuelle = lies('src', 'core', 'docx.js');
  check('Word bekommt einen echten Einzug',
    /w:ind w:left="\$\{klickEinzug\}"/.test(docxQuelle), true);
  check('Und einen echten Abstand nach oben',
    /w:spacing w:before="\$\{oben\}"/.test(docxQuelle), true);
  check('Auch fuer einen frei stehenden Absatz',
    /pxAusStil\(child, 'left'\)/.test(docxQuelle)
    && /letzteFreiUnten/.test(docxQuelle), true);

  /* Das Nullbreiten-Leerzeichen haelt den Halter am Leben, ist aber
     kein Inhalt: gezaehlt gehoert es nicht. */
  check('Der Wortzaehler rechnet das Nullbreiten-Leerzeichen heraus',
    /\\u200b/.test(zaehlQuelle), true);
}

console.log('\nWo man hinklickt, kann man auch schreiben\n');
{
  /* ══════════════════════════════════════════════════════════════════
     DREI STELLEN, AN DENEN DIE MARKE FRUEHER WEGSPRANG

     Gemeldet als „sobald etwas geschrieben wurde, kann man nicht mehr
     hin, wo man moechte: der Cursor geht an den Anfang oder ans Ende
     der Zeile" – und als „beim Klick verschiebt sich alles darunter
     eine Zeile nach unten".

     Auch hier wird die QUELLE geprueft. Das Verhalten haengt an echten
     Klicks in einem echten Fenster; hier soll auffallen, wenn eine der
     drei Vorkehrungen wieder herausfaellt. */
  const textQuelle = lies('src', 'canvas', 'text.js');
  const eingabeQuelle = lies('src', 'canvas', 'input.js');

  /* 1. Ein Absatz spannt sich ueber die ganze Breite. Wurde danach
     gefragt, galt jeder Klick auf seiner Hoehe als Klick auf Text. */
  check('Gefragt wird Textknoten fuer Textknoten',
    /function beschriebeneKaesten/.test(eingabeQuelle)
    && /createTreeWalker/.test(eingabeQuelle), true);
  check('Und nicht mehr ueber den ganzen Inhalt',
    !/range\.selectNodeContents\(textDiv\);\s*\n\s*const rects/.test(eingabeQuelle), true);

  /* 2. Der angeklickte Absatz steht NEBEN dem Fluss und nicht darin –
     nur so verschiebt er nichts, was schon dasteht. */
  check('Der angeklickte Absatz steht frei auf dem Blatt',
    /function _freierAbsatz/.test(textQuelle)
    && /p\.className = 'j-frei'/.test(textQuelle), true);
  check('Und die Anzeige stellt ihn auch so',
    /\.j-text p\.j-frei \{\s*\n\s*position: absolute/.test(lies('src', 'css', 'pages.css')), true);
  check('Er wird nie mehr in den Fluss eingehaengt',
    !/insertAdjacentElement\('beforebegin'/.test(textQuelle), true);

  /* 3. Mitten in einen Abstand aus einem aelteren Heft: der wird
     geteilt, statt die Marke an seinen Rand springen zu lassen. */
  check('Ein vorhandener Abstand laesst sich teilen',
    /function _teileLuecke/.test(textQuelle)
    && /function _lueckeUnter/.test(textQuelle), true);

  /* 4. Der Browser darf die Marke danach nicht noch einmal setzen. */
  check('Der Browser setzt die Marke nicht noch einmal',
    /addEventListener\('mousedown'/.test(eingabeQuelle)
    && /if \(!isFreeEditorAreaClick\(e\.clientX, e\.clientY\)\) return;\s*\n\s*e\.preventDefault\(\)/.test(eingabeQuelle), true);
  check('Und von Hand gesetzt wird nur auf freier Flaeche',
    /placeCaretAnywhere\(textDiv, clientX, clientY, forceManual, page\)/.test(eingabeQuelle), true);

  /* 5. Der Umbruch teilt einen freien Absatz nicht – sonst saessen
     beide Haelften auf derselben Stelle. */
  check('Der Umbruch laesst den freien Absatz wachsen',
    /imFreienAbsatz\(textDiv\)/.test(lies('src', 'app.js'))
    && /insertLineBreak/.test(lies('src', 'app.js')), true);
  check('Und zwei freie Absaetze werden auseinandergerueckt',
    /function richteFreieAbsaetze/.test(textQuelle), true);

  /* 6. Ein blosser Klick hinterlaesst nichts. */
  check('Der blosse Klick raeumt sich wieder weg',
    /function raeumeVorlaeufiges/.test(textQuelle)
    && /_nimmZurueck\(el\);\s*\n\s*el\.remove\(\)/.test(textQuelle), true);

  /* 7. Wenn zwei Texte aneinanderstossen: zwei Arten, waehlbar.

     Das Zusammenwachsen wie in Word ist wieder abgeschafft – es war die
     einzige Art, die den Text unwiderruflich veraenderte, und zurueck
     kam man nicht mehr. Deshalb wird hier ausdruecklich geprueft, dass
     die Funktion dafuer WEG ist: sonst schliche sie sich beim naechsten
     Umbau wieder ein. */
  check('Zwei Arten, wenn Texte aneinanderstossen',
    /function ordneFreieAbsaetze/.test(textQuelle)
    && /const fest = \(wahl === 'fest'\)/.test(textQuelle), true);
  check('Und das Zusammenwachsen ist draussen',
    /verschmelzeBeruehrende/.test(textQuelle), false);

  /* ══════════════════════════════════════════════════════════════════
     7a. EIN ABSATZ IST SEINE ZEILEN, NICHT SEIN KASTEN

     Gemeldet: „ich schreibe in eine freie Zeile zwischen zwei Zeilen,
     und das Geschriebene darueber und darunter rutscht nach rechts."

     Ein Umbruch teilt einen freien Absatz nicht, er laesst ihn wachsen
     (siehe oben). „OBEN", Leerzeile, „UNTEN" ist damit EIN Element von
     drei Zeilen Hoehe. Gemessen wurde aber nur der umschliessende
     Kasten – ein volles Rechteck, die leere Mitte eingeschlossen. Wer
     dort hineinschrieb, stiess gegen etwas, wo gar nichts steht, und
     der ganze Absatz wich aus: mit der Zeile darueber und der darunter.
     Gemessen mit echten Klicks, beide sprangen von l=514 auf l=566. */
  check('Gemessen werden die Zeilen eines freien Absatzes',
    /function _zeilenKaesten/.test(textQuelle)
    && /bereich\.selectNodeContents\(p\)/.test(textQuelle), true);
  check('Und verglichen wird Zeile gegen Zeile',
    /function _schubWaagerecht/.test(textQuelle)
    && /function _schubSenkrecht/.test(textQuelle), true);
  check('Eine leere Zeile stoesst an nichts',
    /if \(breit < FREI_ZEILE_MIN_PX\) continue;/.test(textQuelle), true);

  /* 7a2. Das Ausweichen der Nachbarn wird beim Anlegen gerechnet. Nahm
     man den vorlaeufigen Absatz wieder weg, blieb es stehen – bis zum
     naechsten Anschlag, der irgendwann kam oder auch nicht. */
  check('Wegraeumen rechnet die Nachbarn zurueck',
    /if \(entfernt\) ordneFreieAbsaetze\(textDiv\);/.test(textQuelle), true);

  /* 7a3. Die angeklickte, noch leere Stelle steht im Text noch nicht –
     ein Tausch des innerHTML durch eine fremde Aenderung warf sie weg,
     und wer eben hingezeigt hatte, schrieb danach woanders. */
  check('Die angeklickte Stelle ueberlebt eine fremde Aenderung',
    /function merkeVorlaeufiges/.test(textQuelle)
    && /function stelleVorlaeufigesWiederHer/.test(textQuelle)
    && /gemerkteStelle/.test(lies('src', 'ui', 'collab.js')), true);
  /* 7b. Der Magnet: knapp daneben geklickt heisst „hin". */
  check('Vorhandener Text zieht auf etwa einem Zentimeter an',
    /const ANHAFT_MM = 10/.test(lies('src', 'canvas', 'input.js'))
    && /clientX >= rc\.left - haft/.test(lies('src', 'canvas', 'input.js'))
    && /clientX <= rc\.right \+ haft/.test(lies('src', 'canvas', 'input.js')), true);
  /* Senkrecht darf er NICHT anziehen - sonst risse eine Zeile die Marke
     aus der Zeile darunter zu sich herueber. */
  check('Aber nur waagerecht, nicht nach oben und unten',
    /clientY >= rc\.top - 1/.test(lies('src', 'canvas', 'input.js'))
    && /clientY <= rc\.bottom \+ 1/.test(lies('src', 'canvas', 'input.js')), true);
  check('Und der Zeilenanfang zieht ebenso an',
    /if \(linksPx < ANHAFT_MM_TEXT \* PX_PRO_MM_TEXT\) linksPx = 0;/.test(textQuelle), true);

  /* 7c. Fremde Dokumente werden nie auf die Platte geschrieben.
     Der Umzug des Speicherorts ging alle Hefte durch und legte fuer
     jedes ohne Datei eine neue an - auch fuer die, die mir gar nicht
     gehoeren. Gemeldet aus der Nutzung. */
  check('Der Ordnerwechsel laesst fremde Dokumente aus',
    /\[Settings\] Übersprungen, gehört jemand anderem/
      .test(lies('src', 'ui', 'settings.js')), true);

  check('Waagerecht UND senkrecht wird ausgewichen',
    /style\.marginLeft = schub/.test(textQuelle)
    && /style\.marginTop = schub/.test(textQuelle), true);
  check('Das Ausweichen wird gerechnet, nicht gespeichert',
    /p\.style\.marginLeft = '';\s*\n\s*p\.style\.marginTop = '';/.test(lies('src', 'app.js')), true);
  check('Die Wahl steht in den Einstellungen',
    /textFluss: 'elastisch'/.test(lies('src', 'core', 'settings.js'))
    && /text-fluss/.test(lies('src', 'index.html')), true);
  check('Im fremden Dokument gilt die des Besitzers',
    /nb\.origin === 'shared' && nb\.textFluss/.test(textQuelle)
    && /textFluss: \(data\.textFluss/.test(lies('src', 'core', 'share.js')), true);
  check('Und nur der Besitzer schreibt sie in den Kopf',
    /isOwner && notebook\.textFluss \? \{ textFluss/.test(lies('src', 'core', 'share.js')), true);
}

console.log('\nWer schreibt, hat die Vollmacht ueber seine Zeile\n');
{
  /* ══════════════════════════════════════════════════════════════════
     DAS LOCH IN DER ZEILENSPERRE

     Gemeldet: „wenn ich oefter auf die gesperrte Zeile druecke und
     dabei tippe, kann man irgendwann trotzdem darin schreiben."

     Der Weg dahin ging ueber den eigenen Anspruch: er umfasste die
     eigene Zeile UND die naechste. Sass in dieser naechsten inzwischen
     jemand anderes und schrieb dort, deckte der eigene Anspruch sie
     immer noch – und damit liessen trifftSperrband, editBlockedBy und
     der Takt alles durch.

     >>> Wie das Loch heute zu ist <<<
     Die Zusatzzeile gibt es nicht mehr: lockSpanFor beansprucht ueber
     visualLineSpan(…, 0) nur die eine Zeile, in der man steht. Damit
     schlaegt schon der schlichte Bereichsvergleich in eigeneSperreDeckt
     zu, sobald man in eine andere Zeile klickt.

     Die Wache dagegen (fremdeZeileDeckt) ist weg – und zwar, weil sie
     inzwischen selbst Schaden anrichtete: sie fragte nach der ganzen
     sichtbaren Zeile des anderen, und die deckte auch die eigene Stelle
     mit ab, sobald jemand nur seinen Cursor dort ablegte. Wer zuerst da
     war und wirklich schrieb, verlor damit seine Vollmacht an den, der
     bloss hinzeigte. Gemeldet als „ich war doch als Erster auf dieser
     Zeile". Gefragt wird jetzt nach seinem GEMELDETEN Bereich. */
  const collabQuelle = lies('src', 'ui', 'collab.js');

  check('Der Anspruch umfasst nur die eigene Zeile',
    /span = visualLineSpan\(textDiv, offset, 0\)/.test(collabQuelle), true);
  check('Und endet an dem, was ein anderer ausdruecklich beansprucht',
    /function fremderAnspruchDeckt/.test(collabQuelle)
    && /return !fremderAnspruchDeckt\(pageId, stelle\)/.test(collabQuelle), true);
  check('Nach seinem Bereich, nicht nach seiner ganzen Zeile',
    /function fremdeZeileDeckt/.test(collabQuelle), false);
  check('Ausserhalb des eigenen Anspruchs gilt er nicht',
    /if \(stelle < eigen\.from \|\| stelle > eigen\.to\) return false;/.test(collabQuelle), true);
  check('Die Zeile laesst sich ohne die Zusatzzeile messen',
    /function visualLineSpan\(textDiv, offset, zeilenDanach = 1\)/.test(collabQuelle), true);
  check('Und der Anspruch faellt weg, sobald man aufhoert',
    /if \(!schreibtGerade\(pageId\)\) \{ eigeneSperre\.delete\(pageId\); return null; \}/.test(collabQuelle), true);

  /* ══════════════════════════════════════════════════════════════════
     EIN ANSPRUCH ENTSTEHT DURCH SCHREIBEN, NICHT DURCH HINZEIGEN

     Gemeldet: „ich habe auf einer Zeile geschrieben, jemand anders hat
     dort seinen Cursor hingelegt, und ICH konnte nicht mehr schreiben."

     schreibtGerade galt fuer die ganze SEITE und fuenf Sekunden lang.
     Wer eben irgendwo getippt hatte und dann in eine fremde Zeile
     klickte, meldete dort sofort eine volle Sperre. typedAt merkt sich
     deshalb jetzt auch, WO getippt wurde. */
  check('Gemerkt wird auch die Zeile des letzten Anschlags',
    /function merkeAnschlag/.test(collabQuelle)
    && /typedAt\.set\(pageId, zeile/.test(collabQuelle), true);
  check('Und ohne Anschlag an dieser Stelle kein Anspruch',
    /function tippteHier/.test(collabQuelle)
    && /if \(!tippteHier\(pageId, offset\)\) \{ eigeneSperre\.delete\(pageId\); return null; \}/
      .test(collabQuelle), true);

  /* Der Zuschnitt wich bis auf EIN Zeichen an die fremde Marke heran.
     Die ist aber nie taufrisch (CARET_THROTTLE_MS in core/share.js) –
     wer tippt, stand damit beim naechsten Anschlag mitten im Anspruch
     dessen, der eben noch woanders war.

     Zweierlei gehoert dazu: die Luft selbst, und dass sie nie ueber die
     EIGENE Stelle hinausschneidet – sonst warf die Abfrage darunter den
     ganzen Anspruch weg, und wer schrieb, hatte gar keine Zeile mehr. */
  check('Um eine fremde Marke bleibt Luft',
    /const FREMD_LUFT = \d+/.test(collabQuelle)
    && /bis = Math\.min\(bis, Math\.max\(offset, stelle - 1 - FREMD_LUFT\)\)/.test(collabQuelle), true);

  /* Und zurueckgewichen wird nur vor jemandem, der selbst schreibt. Vor
     jeder herumliegenden Marke zurueckzuweichen hiess, die eigene Zeile
     an den abzugeben, der nur hinzeigt. */
  check('Ein Anspruch weicht nur einem Anspruch',
    /for \(const person of activeLocks\(pageId\)\) \{\s*\n\s*const stelle = Number\(person\.offset\);/
      .test(collabQuelle), true);

  /* lockAt kommt von der Uhr des Absenders. Geht die vor, hielte seine
     Sperre laenger als die des anderen – bei sonst gleichem Verhalten. */
  check('Der Nachlauf laeuft auch nach der eigenen Uhr',
    /function sperreSeitHier/.test(collabQuelle)
    && /if \(seitHier && now - seitHier > LOCK_TTL_MS\) continue;/.test(collabQuelle), true);
}

console.log('\nEin fremdes Dokument wird nicht auf die Platte geschrieben\n');
{
  /* Gemeldet: „geteilte Dokumente, die fuer mich freigegeben sind,
     wurden zu speichern versucht, und dann kam ein Fehler." Von Hand
     speichern ging an den beiden Bremsen vorbei (markDirty und
     FileManager) und lief den ganzen Weg fuer die eigene Datei an. */
  const autoQuelle = lies('src', 'core', 'autoSave.js');
  const standQuelle = lies('src', 'ui', 'saveStatus.js');
  const geteiltQuelle = lies('src', 'ui', 'sharedDocs.js');

  check('saveNow steigt bei einem fremden Dokument sofort aus',
    /isSharedNotebook\(nbId\)\) \{\s*\n\s*return \{ success: true, shared: true \};/.test(autoQuelle), true);
  check('Von Hand speichern schreibt es in seinen Raum',
    /forceSharedDocSave/.test(standQuelle), true);
  check('Fehlt das Recht, wird nicht weiter geklopft',
    /function rechtFehlt/.test(geteiltQuelle)
    && /keinSchreibrecht = true/.test(geteiltQuelle), true);
  check('Ein Netzfehler bleibt dagegen ein Wiederholungsfall',
    /if \(live === session && !endgueltig\) dirty = true;/.test(geteiltQuelle), true);

  /* ══════════════════════════════════════════════════════════════════
     UND EINE EINZELNE ABWEISUNG IST NOCH KEIN VERLORENES RECHT

     „Kein Schreibrecht" stellt das Sichern fuer die ganze Sitzung ab.
     Wer es zu Unrecht bekommt, arbeitet weiter, sieht seine Aenderungen
     bei den anderen ankommen – und verliert sie beim Schliessen, weil
     nichts davon je in Firestore stand.

     Genau so lief es: eine Abweisung durch die Regeln hiess sofort „das
     Recht ist weg". Der haeufigste Grund dafuer war aber ein Wettlauf um
     die Fassungsnummer im Kopf, und der trifft zwei Bearbeitende, die
     beide im Vier-Sekunden-Takt sichern, zwangslaeufig.

     Zwei Wachen dagegen, und beide muessen stehen bleiben:
       · NOT_ALLOWED kommt aus saveDocumentContent mit frisch gelesenem
         Kopf – das ist geprueft und gilt sofort.
       · Eine rohe Abweisung wird gezaehlt und muss sich wiederholen.
     ══════════════════════════════════════════════════════════════════ */
  check('Eine geprüfte Absage gilt sofort',
    /const geprueft = String\(err\?\.message \|\| ''\) === 'NOT_ALLOWED';/.test(geteiltQuelle), true);
  check('Eine rohe Abweisung wird gezählt',
    /abweisungen = abgewiesen \? abweisungen \+ 1 : 0;/.test(geteiltQuelle)
    && /abweisungen >= ABWEISUNGEN_BIS_AUFGABE/.test(geteiltQuelle), true);
  check('Und ein Erfolg setzt den Zähler zurück',
    /outdatedWarned = false;\s*\n\s*abweisungen = 0;/.test(geteiltQuelle), true);

  /* Der Wettlauf selbst gehoert dorthin, wo die Nummer entsteht. */
  const shareQuelle = lies('src', 'core', 'share.js');
  check('Der Kopf wird gegen die JETZIGE Fassungsnummer fortgeschrieben',
    /async function schreibeKopfFort/.test(shareQuelle)
    && /revision = frisch\.revision \+ 1;/.test(shareQuelle), true);
  check('Und kein Aufruf rechnet die Nummer noch selbst aus',
    /revision,\s*\n\s*updatedAt: serverTimestamp\(\),/.test(shareQuelle), false);
}

console.log('\nDer eine Weg vom Editor ins Heft\n');
{
  /* ══════════════════════════════════════════════════════════════════
     Was am Text geaendert wurde, muss drei Dinge ausloesen, und zwar
     immer alle drei: ins Datenmodell schreiben, an die anderen melden,
     das Heft als geaendert markieren.

     Es waren sechs Abschriften, und drei davon hatten nur das Erste:
     der Seitenumbruch, Rueckgaengig und das Setzen einer Ueberschrift.
     Im geteilten Dokument kam davon beim anderen also nichts an. */
  const appQuelle = lies('src', 'app.js');
  const leisteQuelle = lies('src', 'ui', 'toolbar.js');

  check('Es gibt einen Weg, der alle drei Schritte tut',
    /function uebernimmText/.test(appQuelle)
    && /Collab\.noteTextChange\(page\.id, page\.textContent\)/.test(appQuelle)
    && /markCurrentNotebookDirty/.test(appQuelle), true);
  check('Der Seitenumbruch geht darueber',
    /uebernimmText\(page, textDiv\);/.test(appQuelle)
    && /uebernimmText\(nextPage, nextTD\);/.test(appQuelle), true);
  check('Rueckgaengig meldet sich im geteilten Dokument',
    /Collab\.noteTextChange\(page\.id, page\.textContent\);/.test(appQuelle), true);
  check('Und die Ueberschrift ebenso',
    /uebernimmText\(info\.page, textDiv\)/.test(leisteQuelle), true);

  /* ══════════════════════════════════════════════════════════════════
     WAS NICHT MEHR AUFS BLATT PASST

     Es stand eine Schleife da, die `lastElementChild` nahm. Freie
     Absaetze stehen im DOM aber in der Reihenfolge, in der sie ANGELEGT
     wurden – auf die Folgeseite wanderte damit womoeglich die oberste
     Zeile. Und bei reinem Text (der haeufigste Weg, ueberhaupt
     anzufangen) ist children.length null: die Schleife lief nie, und
     der Text lief unten aus dem Papier heraus. */
  check('Umgezogen wird nach der Lage, nicht nach der DOM-Reihenfolge',
    /function nimmUeberlauf/.test(appQuelle)
    && /unterkante\(el\) > unterkante\(tiefstes\)/.test(appQuelle), true);
  check('Und reiner Text wird an einer gemessenen Stelle getrennt',
    /function stelleUnterhalb/.test(lies('src', 'canvas', 'text.js'))
    && /const schnitt = stelleUnterhalb\(textDiv, grenzeY\);/.test(appQuelle), true);
  check('Ein umgezogener freier Absatz faengt oben wieder an',
    /el\.style\.top = Math\.max\(pt,/.test(appQuelle), true);
  check('Passt das Unterste noch aufs Blatt, wird nichts weggenommen',
    /if \(!tiefstes \|\| unterkante\(tiefstes\) <= availH\) break;/.test(appQuelle), true);

  /* ══════════════════════════════════════════════════════════════════
     ZWEI MASSE, DIE NICHT DASSELBE ZAEHLEN

     getCaretTextOffset zaehlt keine Zeilengrenzen, innerText hat an
     jeder Blockgrenze ein zusaetzliches \n. Der Umbruch holte den Einzug
     dadurch aus einer ganz anderen Zeile – und beim Einfuegen kam er
     gleich auf jede eingefuegte Zeile. */
  check('Der Einzug kommt aus einem einzigen Mass',
    /function einzugDerZeile/.test(lies('src', 'canvas', 'text.js'))
    && /const indent = einzugDerZeile\(textDiv\);/.test(appQuelle), true);
  check('Und innerText wird dafuer nicht mehr gegen die Marke gerechnet',
    /textDiv\.innerText \|\| ''\)\.replace\(\/\\r\/g, ''\);\s*\n\s*const lineStart/.test(appQuelle), false);

  /* Ein <br> ueberlebt textContent nicht – aus zwei Zeilen wurde eine. */
  check('Ein <br> im reinen Text wird zu einem echten Umbruch',
    /function normalisiereUmbrueche/.test(lies('src', 'canvas', 'text.js'))
    && /normalisiereUmbrueche\(textDiv\)/.test(appQuelle), true);
  check('Der Platzhalter am Ende bleibt aber stehen',
    /if \(textDiv\.lastChild && textDiv\.lastChild\.nodeName === 'BR'\) brs\.pop\(\);/
      .test(lies('src', 'canvas', 'text.js')), true);
}

console.log('');
if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
