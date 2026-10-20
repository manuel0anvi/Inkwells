#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   GLEICHER FORMATSTAND ODER GAR NICHT

   Prüft versionPasst() aus core/share.js – die Sperre, die ein geteiltes
   Dokument zumacht, wenn Dokument und Gast nicht denselben FORMATSTAND
   haben.

   >>> Was sich geändert hat <<<
   Verglichen wurde die Fassung der App. Das sperrte bei JEDER
   Auslieferung alle voneinander aus, auch wenn sich am geteilten Raum
   nichts geändert hatte – und weil der Kopf seine Angabe nur beim
   vollständigen Neu-Teilen bekam, sperrte sich am Ende der Besitzer
   selbst aus seinem eigenen Dokument aus. Jetzt entscheidet
   FORMAT_STAND, eine Zahl, die nur bei einer echten Formatänderung
   steigt; die App-Fassungen wandern nur noch in den Satz mit, den ein
   Ausgesperrter zu sehen bekommt.

   >>> Warum in BEIDE Richtungen gesperrt wird <<<
   Ein geteiltes Dokument ist kein Dateiformat, das man verträglich
   halten kann, sondern ein laufender Raum: Yjs-Stände, ein
   Änderungsstrom, eine Rollenliste, ein Merkzettel. Schreiben zwei
   verschiedene Fassungen hinein, merkt das niemand sofort – sondern
   Tage später an fehlender Arbeit. „Meine ist neuer, also darf ich
   wenigstens lesen" hilft dabei nicht: wer schreibt, schreibt in einer
   Form, die der andere nicht kennt.

   Aufruf:  node scripts/test-versionssperre.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const quelle = fs.readFileSync(
  /* ══════════════════════════════════════════════════════════════════
     GEPRUEFT WIRD DIE QUELLE, NICHT DIE KOPIE

     Hier stand website/js/share.js. Das ist aber die ERZEUGTE Fassung:
     sync-share schreibt sie aus src/core/share.js (CLAUDE.md, "Beim
     Aendern beachten"). Und der Ordner website/ steht in .gitignore – er
     liegt nur oertlich und wird von keinem git pull aktualisiert.

     Damit prueft dieser Test nach jedem Pull erst einmal den STAND VON
     GESTERN, bis jemand von Hand sync-share laufen laesst. Genau so ist
     es passiert: eine Funktion war in der App laengst da und im Test
     "nicht gefunden", und npm test war rot ohne einen Fehler im Code.

     Ein frisch geklontes Repo hat den Ordner ueberhaupt nicht – dort
     lief der Test gar nicht erst an.
     ══════════════════════════════════════════════════════════════════ */
  path.join(__dirname, '..', 'src', 'core', 'share.js'), 'utf8'
);

function extract(name) {
  const start = quelle.search(new RegExp(`(async )?function ${name}\\(`));
  if (start === -1) throw new Error(`Funktion ${name} nicht gefunden`);
  let depth = 0, seen = false;
  for (let i = start; i < quelle.length; i++) {
    const ch = quelle[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return quelle.slice(start, i + 1);
    }
  }
  throw new Error(`Ende von ${name} nicht gefunden`);
}

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

/* Der Stand, den die Quelle wirklich fuehrt. Nicht abgeschrieben,
   sondern ausgelesen: wird er hochgezaehlt, prueft der Prueftstand
   danach den neuen und nicht mehr eine Zahl von gestern. */
const FORMAT_STAND = (() => {
  const m = /const FORMAT_STAND = (\d+);/.exec(quelle);
  if (!m) throw new Error('FORMAT_STAND nicht gefunden');
  return Number(m[1]);
})();

/**
 * Baut versionPasst() mit einer vorgegebenen eigenen Fassung.
 *
 * @param {string} version  die App-Fassung, die hier zu laufen scheint
 * @param {number} [stand]  der eigene Formatstand; ohne Angabe der echte
 */
function mitEigener(version, stand = FORMAT_STAND) {
  const ctx = {
    console, Math, Number, String, JSON, Promise,
    // eigeneAppVersion() wird ersetzt: hier gibt es kein window.api
    eigeneAppVersion: async () => version,
    // und der Stand, gegen den verglichen wird
    FORMAT_STAND: stand
  };
  vm.createContext(ctx);
  vm.runInContext(extract('versionPasst'), ctx);
  return ctx.versionPasst;
}

(async () => {

  console.log('Derselbe Formatstand – herein');
  {
    const passt = mitEigener('1.1.2', 1);
    check('Gleicher Stand', (await passt({ formatStand: 1, appVersion: '1.1.2' })).ok, true);
  }

  console.log('\nDIE APP-FASSUNG ENTSCHEIDET NICHTS MEHR');
  {
    /* Der eigentliche Grund fuer den ganzen Umbau. Vorher sperrte jede
       Auslieferung alle voneinander aus – auch eine, die am geteilten
       Raum keinen Strich geaendert hatte. Wer die App eine Woche nicht
       aktualisiert hatte, kam an das gemeinsame Dokument nicht mehr
       heran.

       Solange der Stand derselbe ist, duerfen die Fassungen beliebig
       weit auseinanderliegen. */
    const passt = mitEigener('1.4.0', 1);
    const urteil = await passt({ formatStand: 1, appVersion: '1.1.2' });
    check('1.4.0 und 1.1.2 bei gleichem Stand: offen', urteil.ok, true);
    check('Und niemand wird als der Aeltere benannt', urteil.wer, '');

    const rueck = mitEigener('1.1.2', 1);
    check('Auch andersherum', (await rueck({ formatStand: 1, appVersion: '1.4.0' })).ok, true);
  }

  /* Bis Stand 2 sperrte jeder Unterschied in BEIDE Richtungen. Seit dem
     kompakten Strich (core/share.js, EIN STRICH IST EINE ZEILE) liest die
     neuere Fassung das ältere Format mit und schreibt dort nur dessen
     Form – sie darf also herein. Die ältere bleibt draussen. */
  console.log('\nVerschiedener Stand – die ältere Fassung bleibt draussen, die neuere darf herein');
  {
    // Das Dokument ist weiter als ich: ich bin der Aeltere
    const alt = mitEigener('1.1.2', 1);
    const u1 = await alt({ formatStand: 2, appVersion: '1.2.0' });
    check('Ich bin aelter: gesperrt', u1.ok, false);
    check('Und der Satz meint mich', u1.wer, 'ich');
    check('Beide Fassungen stehen im Urteil fuer den Satz',
      [u1.meine, u1.ihre], ['1.1.2', '1.2.0']);

    // Und der Gegenfall: das Dokument ist zurueck, ich bin weiter
    const neu = mitEigener('1.2.0', 2);
    const u2 = await neu({ formatStand: 1, appVersion: '1.1.2' });
    check('Ich bin neuer: herein', u2.ok, true);
    check('Und niemand wird als der Ältere benannt', u2.wer, '');
  }

  console.log('\nWo NICHT gesperrt wird');
  {
    /* Ein Dokument aus der Zeit vor der Sperre traegt keinen Stand.
       Wuerde es hier zugehen, waere jedes bestehende Dokument mit einem
       Schlag fuer alle zu – und niemand kaeme mehr an seine Sachen.
       Die App-Fassung im Kopf aendert daran nichts: sie entscheidet
       nicht mehr mit. */
    const passt = mitEigener('1.1.2', 1);
    check('Kopf ohne alles', (await passt({})).ok, true);
    check('Kein Stand, aber eine fremde Fassung',
      (await passt({ appVersion: '0.9.0' })).ok, true);
    check('Stand 0', (await passt({ formatStand: 0, appVersion: '0.9.0' })).ok, true);

    /* Was keine brauchbare Zahl ist, zaehlt wie keine Angabe – so
       normalisiert es auch describeDoc. Ein Kopf, an dem jemand
       herumgespielt hat, macht damit kein Dokument unzugaenglich. */
    check('Stand als Zeichenkette', (await passt({ formatStand: '2' })).ok, true);
    check('Stand als Kommazahl', (await passt({ formatStand: 1.5 })).ok, true);
    check('Stand negativ', (await passt({ formatStand: -3 })).ok, true);
  }

  console.log('\nDer Stand im Kopf bleibt aktuell');
  {
    /* >>> Warum das hier steht <<<
       Den Stand bekam der Kopf nur beim vollstaendigen Neu-Teilen. Er
       blieb auf dem Wert von damals stehen, waehrend die App weiterzog –
       und sperrte am Ende den Besitzer aus seinem eigenen Dokument aus,
       ohne Ausweg im Fenster. Deshalb zieht jetzt jedes gewoehnliche
       Speichern des Besitzers den Stand nach (besitzerStempel).

       Geprueft wird an der Quelle: ein Aufruf, der hier verschwindet,
       faellt sonst erst Wochen spaeter auf, wenn wieder jemand vor
       seinem eigenen Dokument steht. */
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'core', 'share.js'), 'utf8');

    check('Beim Teilen wandert der Stand in den Kopf',
      /formatStand: FORMAT_STAND/.test(src), true);

    const stempel = (src.match(/besitzerStempel\(/g) || []).length;
    check('Und besitzerStempel wird ueberall gerufen, wo der Kopf fortgeschrieben wird',
      stempel >= 4, true);   // Erklaerung + drei Aufrufe

    /* Nur der Besitzer. Stuenden die beiden Felder im Merkzettel eines
       BEARBEITERS, wiese editorUpdate() in website/firestore.rules sein
       ganzes Speichern ab – es zaehlt die erlaubten Felder einzeln auf. */
    check('Der Stempel bleibt dem Besitzer vorbehalten',
      /if \(!isOwner\) return \{\};/.test(src), true);

    const regeln = fs.readFileSync(
      path.join(__dirname, '..', 'website', 'firestore.rules'), 'utf8');
    const erlaubt = /hasOnly\(\[([^\]]*)\]\)/.exec(regeln);
    check('Und formatStand steht NICHT in der Liste des Bearbeiters',
      !!erlaubt && !/formatStand/.test(erlaubt[1]), true);
  }

  console.log('\nDie Sperre haengt am Oeffnen, nicht am Weg dorthin');
  {
    /* Kachel und Link laufen beide durch openSharedDocument – dort steht
       die Pruefung. Waere sie an einem der beiden Wege, liesse sie sich
       ueber den anderen umgehen. */
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'ui', 'sharedDocs.js'), 'utf8');
    const stelle = shared.indexOf('async function openSharedDocument(head)');
    check('openSharedDocument gibt es', stelle > -1, true);
    const kopf = shared.slice(stelle, stelle + 300);
    check('Und es fragt als Erstes die Sperre',
      /versionsSperre\(head\)/.test(kopf), true);
  }

  console.log('');
  if (failed) {
    console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('Alle Pruefungen bestanden.');
})();
