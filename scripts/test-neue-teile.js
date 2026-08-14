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

console.log('');
if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
