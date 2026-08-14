#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DREI MELDUNGEN, DIE NICHT KOMMEN DÜRFEN

   Alle drei sind gemeldet worden, und alle drei haben dieselbe Gestalt:
   ein Hinweis erscheint in einem Zustand, in dem er nichts zu sagen hat.
   Eine Warnung, die zu oft kommt, liest niemand mehr – auch dann nicht,
   wenn sie einmal stimmt.

     1. ABGEMELDET, UND DIE CLOUD REDET WEITER
        „Jemand hat ein Dokument mit dir geteilt" kam auch nach dem
        Abmelden und nach dem Ablauf der Sitzung. Grund: die Anmeldung
        beim Anbieter (eine Stunde) und die bei Firebase (Wochen) sind
        zwei verschiedene Dinge. Lief die erste ab, blieb die zweite
        stehen – und mit ihr die Beobachtung der Freigaben.

     2. LIVE-FREIGABE UND ZWEI FASSUNGEN
        Während der gemeinsamen Arbeit meldete der Abgleich, das Heft
        habe in der Cloud eine andere Fassung als hier. Das stimmte
        sogar, war aber kein Konflikt: der Besitzer lädt im Takt hoch,
        während die anderen weiterschreiben. Solange der Raum läuft, ist
        er die Wahrheit und nicht die Datei.

     3. ZEILENSPERRE OHNE EIGENES ZUTUN
        „{name} schreibt gerade an dieser Zeile" kam, ohne dass man das
        Heft angefasst hatte: der 600-ms-Takt schob die ruhende Marke aus
        der fremden Sperre und meldete das jedes Mal. Der Hinweis gehört
        an den VERSUCH zu schreiben, nicht an die Sperre.

   Aufruf:  node scripts/test-stille-cloud.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wurzel = path.join(__dirname, '..');
const lies = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), 'utf8');

const collabQuelle = lies('src', 'ui', 'collab.js');
const cloudQuelle = lies('src', 'core', 'cloudSync.js');
const sharedQuelle = lies('src', 'ui', 'sharedDocs.js');

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

/**
 * Schneidet einen Block ab `start` heraus, indem geschweifte Klammern
 * gezählt werden. Reicht hier: in keiner der geprüften Funktionen steht
 * eine Klammer in einer Zeichenkette.
 */
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

/** Eine gewöhnliche Funktionsdeklaration. */
function funktion(quelle, name) {
  return blockAb(quelle, quelle.search(new RegExp(`(async )?function ${name}\\(`)), name);
}

/** Eine Methode einer Klasse (`  name(args) {`). */
function methode(quelle, name) {
  return blockAb(quelle, quelle.search(new RegExp(`\\n  (async )?${name}\\(`)) + 1, name);
}

console.log('1. Abgemeldet heisst still\n');
{
  /* ── Die Frage wird an CloudSync gestellt, nicht an Firebase ────── */
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(funktion(sharedQuelle, 'cloudAngemeldet'), ctx);

  check('Ohne CloudSync: nicht angemeldet', ctx.cloudAngemeldet(), false);

  ctx.window.CloudSync_ = { isAuthenticated: () => false };
  check('Sitzung abgelaufen: nicht angemeldet', ctx.cloudAngemeldet(), false);

  ctx.window.CloudSync_ = { isAuthenticated: () => true };
  check('Gueltiges Token: angemeldet', ctx.cloudAngemeldet(), true);
}
{
  /* ── Die Beobachtung fragt danach, und zwar an beiden Stellen ───── */
  const start = funktion(sharedQuelle, 'startWatching');
  check('startWatching fragt nach der Anmeldung',
    /if \(!cloudAngemeldet\(\)\) \{ stopWatching\(\); return; \}/.test(start), true);

  /* Die Frage steht HINTER ensureFirebaseIdentity: davor waeren beim
     Start die Einstellungen noch nicht geladen und jede Sitzung gaelte
     als beendet. */
  check('Und zwar erst nach dem Warten auf die Kennung',
    start.indexOf('ensureFirebaseIdentity') < start.indexOf('cloudAngemeldet'), true);

  check('Auch die Antwort aus Firestore wird geprueft',
    /\(list\) => \{[\s\S]{0,400}?if \(!cloudAngemeldet\(\)\) \{ stopWatching\(\); return; \}/.test(start), true);

  const ansage = funktion(sharedQuelle, 'announceNew');
  check('Und der Hinweis selbst ebenso',
    /if \(!cloudAngemeldet\(\)\) return;/.test(ansage), true);
}
{
  /* ── Beim Wechsel wird gehandelt ────────────────────────────────── */
  const wechsel = funktion(sharedQuelle, 'onCloudChange');
  check('Der Kontowechsel startet und beendet die Beobachtung',
    /stopWatching\(\)/.test(wechsel) && /startWatching\(\)/.test(wechsel), true);

  const stop = funktion(sharedQuelle, 'stopWatching');
  check('Beenden raeumt die Liste weg', /docs = \[\]/.test(stop), true);
  check('Und laesst die naechste Anmeldung wieder ansagen',
    /announced = false/.test(stop), true);
}
{
  /* ── Die Meldung geht auch ohne Netz hinaus ─────────────────────── */
  const abmelden = methode(cloudQuelle, 'signOut');
  const wurf = abmelden.indexOf('catch (err)');
  const meldung = abmelden.indexOf("new CustomEvent('inkwell-identity-changed')");
  check('signOut meldet den Wechsel', meldung > -1, true);
  check('Und zwar ausserhalb des try um die Firebase-Abmeldung',
    meldung > wurf, true);

  /* Der Ablauf der Sitzung ist genauso ein Ende wie das Abmelden von
     Hand – hier fehlte die Meldung ganz. */
  const abgelaufen = methode(cloudQuelle, '_handleExpiredToken');
  check('Auch die abgelaufene Sitzung meldet den Wechsel',
    /new CustomEvent\('inkwell-identity-changed'\)/.test(abgelaufen), true);
}

console.log('\n2. Waehrend der Live-Freigabe gleicht sich nichts ab\n');
{
  const ctx = { window: {} };
  vm.createContext(ctx);
  // Kurzschreibweise für Methoden gilt im Objektliteral unverändert
  const traeger = vm.runInContext(`({ ${methode(cloudQuelle, '_laeuftLive')} })`, ctx);
  const laeuftLive = (nbId) => traeger._laeuftLive(nbId);

  check('Ohne Auskunft: kein Live-Betrieb', laeuftLive('nb1'), false);

  ctx.window.liveShareNbId = () => 'nb1';
  check('Das offene Heft laeuft live', laeuftLive('nb1'), true);
  check('Ein anderes nicht', laeuftLive('nb2'), false);

  // Sitzung beendet: der Wert ist leer, und leer trifft auf nichts zu
  ctx.window.liveShareNbId = () => '';
  check('Nach dem Schliessen wieder gewoehnlich', laeuftLive('nb1'), false);
  check('Und eine leere Kennung fragt gar nicht erst', laeuftLive(''), false);

  ctx.window.liveShareNbId = () => { throw new Error('kaputt'); };
  check('Ein Fehler dort haelt den Abgleich nicht auf', laeuftLive('nb1'), false);
}
{
  const merge = methode(cloudQuelle, '_mergeRemoteNotebook');
  check('Der Abgleich steigt bei laufender Freigabe aus',
    /if \(this\._laeuftLive\(remoteNotebook\.id\)\) \{/.test(merge), true);

  /* Der Ausstieg muss VOR der Konfliktpruefung stehen – sonst kaeme das
     Band trotzdem, und darum ging es. */
  check('Und zwar vor der Frage nach zwei Fassungen',
    merge.indexOf('_laeuftLive') < merge.indexOf('_pruefeKonflikt'), true);

  const suche = methode(cloudQuelle, 'sucheNeuesAusDerCloud');
  check('Der 45-Sekunden-Takt laedt die Datei gar nicht erst',
    /if \(this\._laeuftLive\(treffer\.id\)\) continue;/.test(suche), true);

  check('Und ui/sharedDocs.js gibt die Auskunft dafuer heraus',
    /window\.liveShareNbId = \(\)/.test(sharedQuelle), true);
}

console.log('\n3. Die Zeilensperre meldet sich nur beim Versuch\n');
{
  /* haltCaretAusSperre in einer nachgebauten Umgebung: eine fremde
     Sperre liegt ueber der eigenen Marke. Gezaehlt wird, wie oft ein
     Hinweis herausgeht. */
  function baueLauf({ getippt }) {
    const ctx = {
      console, Date, Number, Math,
      hinweise: 0,
      gesetzt: [],
      others: [{ uid: 'fremd' }],
      LOCK_HINT_MS: 2500,
      letzterAusweich: 0,
      warnLocked: () => { ctx.hinweise++; },
      lockOwner: () => ({ uid: 'fremd', lockFrom: 10, lockTo: 40 }),
      schreibtGerade: () => getippt,
      flatCaretPos: () => 20,
      setFlatCaret: (el, ziel) => { ctx.gesetzt.push(ziel); return true; },
      window: {
        getSelection: () => ({ rangeCount: 1, isCollapsed: true })
      },
      document: {
        activeElement: {
          classList: { contains: (c) => c === 'j-text' },
          closest: () => ({ dataset: { pgid: 'p1' } }),
          blur() {}
        }
      }
    };
    vm.createContext(ctx);
    vm.runInContext(funktion(collabQuelle, 'haltCaretAusSperre'), ctx);
    return ctx;
  }

  {
    // Der Takt: laeuft alle 600 ms, ob man etwas tut oder nicht
    const ctx = baueLauf({ getippt: false });
    ctx.haltCaretAusSperre(false);
    ctx.haltCaretAusSperre(false);
    check('Der Takt meldet nie', ctx.hinweise, 0);
    check('Schiebt die Marke aber trotzdem heraus', ctx.gesetzt, [9, 9]);
  }
  {
    // Marke bewegt, aber nicht geschrieben – auch das ist kein Versuch
    const ctx = baueLauf({ getippt: false });
    ctx.haltCaretAusSperre(true);
    check('Eine blosse Bewegung ohne Tippen auch nicht', ctx.hinweise, 0);
  }
  {
    // Wer wirklich schreibt, soll erfahren, warum die Marke wegspringt
    const ctx = baueLauf({ getippt: true });
    ctx.haltCaretAusSperre(true);
    check('Wer gerade schreibt, bekommt den Hinweis', ctx.hinweise, 1);

    // Und nicht bei jedem Anschlag erneut
    ctx.haltCaretAusSperre(true);
    check('Aber nicht zweimal hintereinander', ctx.hinweise, 1);
  }
}
{
  /* Der Takt darf nicht versehentlich wieder auf true gesetzt werden. */
  check('Der 600-ms-Takt ruft ausdruecklich ohne Meldung auf',
    /haltCaretAusSperre\(false\);/.test(collabQuelle), true);
  check('Die eigene Bewegung dagegen mit',
    /haltCaretAusSperre\(true\); reportCaret\(\);/.test(collabQuelle), true);

  /* Der Weg ueber app.js bleibt unangetastet: wer wirklich tippt, wird
     weiterhin abgewiesen UND bekommt es gesagt. */
  const app = lies('src', 'app.js');
  check('Ein abgewiesener Anschlag meldet weiterhin',
    /Collab\.warnLocked\(person\);/.test(app), true);
}

console.log('');
if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
