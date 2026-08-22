#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DIE SICHERHEITSREGELN, WIRKLICH AUSGEFÜHRT

   Alle anderen Prüfungen laufen gegen nachgebaute Dienste. Regeln lassen
   sich so nicht prüfen – sie sind eine eigene Sprache und werden von
   Google ausgewertet, nicht von unserem Code. Ein Fehler darin fällt
   sonst erst im Betrieb auf, und dann als „Missing or insufficient
   permissions" ohne Hinweis worauf.

   Deshalb hier der Emulator. Geprüft wird BEIDES:

     website/firestore.rules        wer ein Dokument lesen und ändern darf
     website/database.rules.json    Anwesenheit und der Änderungsstrom

   Voraussetzung: Java und firebase-tools (beides über npx). Fehlt eines
   davon, überspringt der Test sich selbst statt den Build anzuhalten –
   ein fehlender Emulator ist kein Fehler im Programm.

   Aufruf:  node scripts/test-rules.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PROJECT = 'inkwell-rules-test';

let rules;
try {
  rules = require('@firebase/rules-unit-testing');
} catch (err) {
  console.log('Regelprüfung übersprungen: @firebase/rules-unit-testing fehlt.');
  console.log('  npm install --save-dev @firebase/rules-unit-testing firebase');
  process.exit(0);
}

const {
  initializeTestEnvironment, assertSucceeds, assertFails
} = rules;

const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs,
  serverTimestamp
} = require('firebase/firestore');

const { ref, set, get, remove } = require('firebase/database');

/* ── Prüfgerüst ─────────────────────────────────────────────────────── */

let failed = 0;
let group = '';

function section(name) { group = name; console.log('\n' + name); }

async function ok(label, promise) {
  try { await assertSucceeds(promise); console.log('  ✓ ' + label); }
  catch (err) {
    failed++;
    console.error('  ✗ ' + label + ' — hätte erlaubt sein müssen');
    console.error('      ' + (err && err.message ? err.message.split('\n')[0] : err));
  }
}

async function denied(label, promise) {
  try { await assertFails(promise); console.log('  ✓ ' + label); }
  catch (err) {
    failed++;
    console.error('  ✗ ' + label + ' — hätte verweigert werden müssen');
  }
}

/* ── Konten ──────────────────────────────────────────────────────────
   Das Token bildet nach, was Google und Microsoft mitschicken. Wichtig
   ist email_verified: die Regeln lassen daneben auch den Anbieter gelten,
   weil Microsoft die Angabe bei persönlichen Konten weglässt.
   ─────────────────────────────────────────────────────────────────── */

function person(env, uid, email, extra = {}) {
  return env.authenticatedContext(uid, {
    email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...extra
  });
}

const OWNER = { uid: 'uid-besitzer', mail: 'besitzer@example.com' };
const EDITOR = { uid: 'uid-bearbeiter', mail: 'bearbeiter@example.com' };
const READER = { uid: 'uid-leser', mail: 'leser@example.com' };
const STRANGER = { uid: 'uid-fremd', mail: 'fremd@example.com' };
const BLOCKED = { uid: 'uid-gesperrt', mail: 'gesperrt@example.com' };
/* Der von der VERWALTUNG Gesperrte – nicht zu verwechseln mit BLOCKED,
   den der Besitzer aus SEINEM Dokument geworfen hat (blockedEmails). */
const GESPERRT = { uid: 'uid-verwarnt', mail: 'verwarnt@example.com' };
const MELDER = { uid: 'uid-melder', mail: 'melder@example.com' };

/* Dieselbe Kennung, die adminUid() in website/firestore.rules zurueckgibt.
   Steht dort der Platzhalter statt der echten UID, faellt es hier auf. */
const ADMIN = { uid: '9czynXNXAlfs8bGtx5hEOO9dRCd2', mail: 'admin@example.com' };

/** Ein Dokument, wie es shareDocument anlegt. */
function headData(overrides = {}) {
  return {
    owner: OWNER.uid,
    ownerEmail: OWNER.mail,
    ownerName: 'Besitzer',
    title: 'Mathematik',
    color: '#c8a96e',
    defaultBg: 'ruled',
    notebookId: 'nb1',
    format: 'pages',
    revision: 3,
    linkMode: 'off',
    linkId: '',
    pageCount: 2,
    pageOrder: ['p1', 'p2'],
    sections: [],
    activeSecId: '',
    memberEmails: [EDITOR.mail, READER.mail],
    members: { [EDITOR.mail]: 'edit', [READER.mail]: 'view' },
    memberVia: { [EDITOR.mail]: 'invite', [READER.mail]: 'invite' },
    blockedEmails: [BLOCKED.mail],
    ...overrides
  };
}

/* ── Los ─────────────────────────────────────────────────────────────── */

(async () => {
  let env;
  try {
    env = await initializeTestEnvironment({
      projectId: PROJECT,
      firestore: {
        rules: fs.readFileSync(path.join(root, 'website', 'firestore.rules'), 'utf8'),
        host: '127.0.0.1', port: 8089
      },
      database: {
        rules: fs.readFileSync(path.join(root, 'website', 'database.rules.json'), 'utf8'),
        host: '127.0.0.1', port: 9009
      }
    });
  } catch (err) {
    console.log('Regelprüfung übersprungen: kein Emulator erreichbar.');
    console.log('  Starten mit:  npx firebase emulators:exec --project ' + PROJECT
      + ' "node scripts/test-rules.js"');
    process.exit(0);
  }

  // Ausgangslage ohne Regeln einrichten
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'docs/dok1'), headData());
    await setDoc(doc(db, 'docs/dok1/pages/p1'), { index: 0, text: '<p>Eins</p>', objects: [] });
    await setDoc(doc(db, 'docs/dok1/ink/p1__0'), { pageId: 'p1', no: 0, strokes: [] });

    // Ein zweites mit offenem Link
    await setDoc(doc(db, 'docs/dok2'), headData({
      linkMode: 'edit', linkId: 'link2', memberEmails: [], members: {}, memberVia: {}
    }));

    /* ── Fuer die Sperren ──────────────────────────────────────────
       Ein drittes Dokument, in dem der spaeter Gesperrte Mitglied ist.
       Die Sperre wird erst im Abschnitt weiter unten gesetzt, damit die
       Pruefungen davor den ungesperrten Zustand sehen. */
    await setDoc(doc(db, 'docs/dok3'), headData({
      linkMode: 'edit', linkId: 'link3',
      memberEmails: [EDITOR.mail, GESPERRT.mail],
      members: { [EDITOR.mail]: 'edit', [GESPERRT.mail]: 'edit' },
      memberVia: { [EDITOR.mail]: 'invite', [GESPERRT.mail]: 'invite' },
      blockedEmails: []
    }));
    await setDoc(doc(db, 'docs/dok3/pages/p1'), { index: 0, text: '<p>Drei</p>', objects: [] });
    await setDoc(doc(db, 'docs/dok2/pages/p1'), { index: 0, text: '<p>Offen</p>', objects: [] });
    await setDoc(doc(db, 'doc_links/link2'), { docId: 'dok2', owner: OWNER.uid });
  });

  const fsOf = (who) => person(env, who.uid, who.mail).firestore();

  /* ── Lesen ───────────────────────────────────────────────────────── */

  section('Firestore: wer darf ein Dokument lesen');

  await ok('Besitzer', getDoc(doc(fsOf(OWNER), 'docs/dok1')));
  await ok('Bearbeiter', getDoc(doc(fsOf(EDITOR), 'docs/dok1')));
  await ok('Leser', getDoc(doc(fsOf(READER), 'docs/dok1')));
  await denied('Fremder ohne Link', getDoc(doc(fsOf(STRANGER), 'docs/dok1')));
  await ok('Fremder bei offenem Link', getDoc(doc(fsOf(STRANGER), 'docs/dok2')));
  await ok('Gar nicht angemeldet, offener Link',
    getDoc(doc(env.unauthenticatedContext().firestore(), 'docs/dok2')));
  await denied('Gar nicht angemeldet, kein Link',
    getDoc(doc(env.unauthenticatedContext().firestore(), 'docs/dok1')));

  section('Firestore: die eigene Liste');

  await ok('Über die Mitgliedschaft auflisten', getDocs(query(
    collection(fsOf(EDITOR), 'docs'), where('memberEmails', 'array-contains', EDITOR.mail))));
  await denied('Fremde Liste ist nicht abfragbar', getDocs(query(
    collection(fsOf(STRANGER), 'docs'), where('memberEmails', 'array-contains', EDITOR.mail))));
  await denied('Alles auflisten geht nicht', getDocs(collection(fsOf(EDITOR), 'docs')));

  /* Der Besitzer braucht seine eigene Liste, damit das Freigabe-Fenster
     nachsehen kann, ob ein Heft schon geteilt ist – siehe
     findOwnedDocForNotebook in core/share.js. Die Abfrage muss auf die
     eigene Kennung eingeschränkt sein; ohne diese Einschränkung wäre sie
     eine Liste aller Dokumente und wird abgewiesen. */
  await ok('Der Besitzer listet seine eigenen', getDocs(query(
    collection(fsOf(OWNER), 'docs'), where('owner', '==', OWNER.uid))));
  await denied('Aber nicht die eines anderen', getDocs(query(
    collection(fsOf(STRANGER), 'docs'), where('owner', '==', OWNER.uid))));

  /* ── Inhalt ──────────────────────────────────────────────────────── */

  section('Firestore: der Inhalt');

  await ok('Leser liest eine Seite', getDoc(doc(fsOf(READER), 'docs/dok1/pages/p1')));
  await denied('Fremder liest keine Seite', getDoc(doc(fsOf(STRANGER), 'docs/dok1/pages/p1')));

  await ok('Bearbeiter schreibt eine Seite',
    setDoc(doc(fsOf(EDITOR), 'docs/dok1/pages/p1'), { text: '<p>geändert</p>' }, { merge: true }));
  await denied('Leser schreibt keine Seite',
    setDoc(doc(fsOf(READER), 'docs/dok1/pages/p1'), { text: '<p>heimlich</p>' }, { merge: true }));
  await ok('Bearbeiter hängt Handschrift an',
    updateDoc(doc(fsOf(EDITOR), 'docs/dok1/ink/p1__0'), { strokes: [{ x: 1 }] }));
  await denied('Leser hängt nichts an',
    updateDoc(doc(fsOf(READER), 'docs/dok1/ink/p1__0'), { strokes: [{ x: 2 }] }));
  await ok('Besitzer schreibt den Inhalt',
    setDoc(doc(fsOf(OWNER), 'docs/dok1/pages/p2'), { index: 1, text: '' }));

  /* ── Der Kopf ────────────────────────────────────────────────────── */

  section('Firestore: der Kopf');

  await ok('Bearbeiter schreibt Reihenfolge und Stand fort',
    updateDoc(doc(fsOf(EDITOR), 'docs/dok1'), {
      pageOrder: ['p2', 'p1'], pageCount: 2, sections: [], revision: 4,
      updatedAt: serverTimestamp()
    }));

  await denied('Bearbeiter ändert den Titel nicht',
    updateDoc(doc(fsOf(EDITOR), 'docs/dok1'), { title: 'Gekapert', revision: 5 }));
  await denied('Bearbeiter lädt niemanden ein',
    updateDoc(doc(fsOf(EDITOR), 'docs/dok1'), {
      memberEmails: [EDITOR.mail, READER.mail, STRANGER.mail], revision: 5
    }));
  await denied('Bearbeiter schreibt nicht rückwärts',
    updateDoc(doc(fsOf(EDITOR), 'docs/dok1'), { revision: 1, updatedAt: serverTimestamp() }));
  await denied('Leser schreibt gar nicht am Kopf',
    updateDoc(doc(fsOf(READER), 'docs/dok1'), { revision: 9, updatedAt: serverTimestamp() }));

  await ok('Besitzer lädt jemanden ein',
    updateDoc(doc(fsOf(OWNER), 'docs/dok1'), {
      memberEmails: [EDITOR.mail, READER.mail, STRANGER.mail],
      members: { [EDITOR.mail]: 'edit', [READER.mail]: 'view', [STRANGER.mail]: 'view' },
      updatedAt: serverTimestamp()
    }));
  await denied('Besitzer gibt den Besitz nicht ab',
    updateDoc(doc(fsOf(OWNER), 'docs/dok1'), { owner: STRANGER.uid, updatedAt: serverTimestamp() }));

  /* ── Selbsteintrag über den Link ─────────────────────────────────── */

  section('Firestore: Selbsteintrag über den Link');

  await ok('Öffentlich nachschlagen', getDoc(doc(env.unauthenticatedContext().firestore(), 'doc_links/link2')));

  await ok('Fremder trägt sich selbst ein',
    updateDoc(doc(fsOf(STRANGER), 'docs/dok2'), {
      memberEmails: [STRANGER.mail],
      members: { [STRANGER.mail]: 'edit' },
      memberVia: { [STRANGER.mail]: 'link' }
    }));

  await denied('Und niemand trägt einen anderen ein',
    updateDoc(doc(fsOf(READER), 'docs/dok2'), {
      memberEmails: [STRANGER.mail, 'wer@anders.de'],
      members: { [STRANGER.mail]: 'edit', 'wer@anders.de': 'edit' },
      memberVia: {}
    }));

  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'docs/dok3'), headData({
      linkMode: 'view', linkId: 'link3', memberEmails: [], members: {}, memberVia: {}
    }));
    await setDoc(doc(ctx.firestore(), 'docs/dok3/pages/p1'), { index: 0, text: '' });
  });

  await denied('Gesperrte kommen über den Link nicht zurück',
    updateDoc(doc(fsOf(BLOCKED), 'docs/dok3'), {
      memberEmails: [BLOCKED.mail],
      members: { [BLOCKED.mail]: 'view' },
      memberVia: { [BLOCKED.mail]: 'link' }
    }));

  await denied('Ein Nur-lesen-Link macht niemanden zum Bearbeiter',
    updateDoc(doc(fsOf(STRANGER), 'docs/dok3'), {
      memberEmails: [STRANGER.mail],
      members: { [STRANGER.mail]: 'edit' },
      memberVia: { [STRANGER.mail]: 'link' }
    }));

  /* Die Lücke, die dieser Test zuerst gefunden hat: der Selbsteintrag
     darf `members` anfassen. Wer sich selbst korrekt mit 'view' eintrug,
     konnte im selben Zug einen Eintrag für eine ANDERE Adresse mit 'edit'
     anlegen – und die kam beim Inhalt durch, ohne je in memberEmails
     gestanden zu haben. Beide Enden sind jetzt zu: hier kommt der
     Eintrag gar nicht erst hinein, und mayWriteContent verlangt
     zusätzlich die Mitgliedschaft. */
  await denied('Eine fremde Rolle lässt sich nicht mit einschmuggeln',
    updateDoc(doc(fsOf(STRANGER), 'docs/dok3'), {
      memberEmails: [STRANGER.mail],
      members: { [STRANGER.mail]: 'view', [READER.mail]: 'edit' },
      memberVia: { [STRANGER.mail]: 'link' }
    }));

  await ok('Der saubere Selbsteintrag geht',
    updateDoc(doc(fsOf(STRANGER), 'docs/dok3'), {
      memberEmails: [STRANGER.mail],
      members: { [STRANGER.mail]: 'view' },
      memberVia: { [STRANGER.mail]: 'link' }
    }));

  await denied('Über einen Nur-lesen-Link bleibt es beim Lesen',
    setDoc(doc(fsOf(STRANGER), 'docs/dok3/pages/p1'), { text: '<p>heimlich</p>' }, { merge: true }));

  /* Und selbst wenn ein Eintrag in `members` stünde – etwa aus der Zeit
     vor der Regel oben –, gäbe er ohne Mitgliedschaft kein Schreibrecht. */
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'docs/dok3'), {
      members: { [STRANGER.mail]: 'view', [READER.mail]: 'edit' }
    }, { merge: true });
  });

  await denied('Ein untergeschobener Eintrag gibt kein Schreibrecht',
    setDoc(doc(fsOf(READER), 'docs/dok3/pages/p1'), { text: '<p>heimlich</p>' }, { merge: true }));

  section('Firestore: ein Dokument, das es nicht gibt');

  /* Muss ein sauberes „gibt es nicht" ergeben, keinen Rechtefehler –
     sonst zeigt die App eine Fehlermeldung, wo ein schlichter Hinweis
     hingehört. */
  await ok('Antwortet mit „gibt es nicht"',
    getDoc(doc(fsOf(STRANGER), 'docs/gibt-es-nicht')));

  section('Firestore: der Link-Eintrag');

  await ok('Der Besitzer legt ihn an',
    setDoc(doc(fsOf(OWNER), 'doc_links/link9'), { docId: 'dok1', owner: OWNER.uid }));
  await ok('Und darf ihn erneuern',
    setDoc(doc(fsOf(OWNER), 'doc_links/link9'), { docId: 'dok1', owner: OWNER.uid }));

  /* Vorher konnte jeder, der eine Link-Kennung kannte, den Eintrag auf
     SEIN Dokument umbiegen – der verschickte Link führte danach
     woandershin. */
  await denied('Ein Fremder biegt ihn nicht um',
    setDoc(doc(fsOf(STRANGER), 'doc_links/link9'), { docId: 'dok3', owner: STRANGER.uid }));
  await denied('Und löscht ihn auch nicht',
    deleteDoc(doc(fsOf(STRANGER), 'doc_links/link9')));

  /* ── Aussteigen und löschen ──────────────────────────────────────── */

  section('Firestore: aussteigen und löschen');

  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'docs/dok4'), headData({
      memberEmails: [EDITOR.mail, READER.mail],
      members: { [EDITOR.mail]: 'edit', [READER.mail]: 'view' }
    }));
  });

  await denied('Niemand wirft einen anderen hinaus',
    updateDoc(doc(fsOf(EDITOR), 'docs/dok4'), {
      memberEmails: [EDITOR.mail],
      members: { [EDITOR.mail]: 'edit' },
      memberVia: { [EDITOR.mail]: 'invite' }
    }));

  await ok('Man steigt selbst aus',
    updateDoc(doc(fsOf(READER), 'docs/dok4'), {
      memberEmails: [EDITOR.mail],
      members: { [EDITOR.mail]: 'edit' },
      memberVia: { [EDITOR.mail]: 'invite' }
    }));

  await denied('Bearbeiter löscht das Dokument nicht', deleteDoc(doc(fsOf(EDITOR), 'docs/dok4')));
  await ok('Der Besitzer schon', deleteDoc(doc(fsOf(OWNER), 'docs/dok4')));

  /* ── Die eigene Kennung eintragen ─────────────────────────────────
     Die Mitgliedschaft steht als ADRESSE im Kopf, die Regeln der
     Realtime Database kennen aber nur auth.uid. Jeder trägt seine eigene
     Kennung deshalb selbst ein; daraus baut der Besitzer die Rollenliste
     des Raums (core/share.js, registerMyUid).

     Die Gefahr dabei ist offensichtlich: wer hier einen FREMDEN Eintrag
     anlegen könnte, käme über die Rollenliste in einen Raum, in den er
     nicht gehört. Deshalb steht das hier.
     ─────────────────────────────────────────────────────────────── */

  section('Die eigene Kennung eintragen');

  await ok('Der Bearbeiter trägt seine Kennung ein',
    updateDoc(doc(fsOf(EDITOR), 'docs/dok1'), {
      ['memberUids.' + EDITOR.uid]: EDITOR.mail
    }));

  await ok('Der Leser ebenso',
    updateDoc(doc(fsOf(READER), 'docs/dok1'), {
      ['memberUids.' + READER.uid]: READER.mail
    }));

  await denied('Aber nicht unter fremder Kennung',
    updateDoc(doc(fsOf(EDITOR), 'docs/dok1'), {
      ['memberUids.' + STRANGER.uid]: STRANGER.mail
    }));

  await denied('Und nicht mit fremder Adresse',
    updateDoc(doc(fsOf(EDITOR), 'docs/dok1'), {
      ['memberUids.' + EDITOR.uid]: OWNER.mail
    }));

  /* BLOCKED und nicht STRANGER: der ist weiter oben laengst zu dok1
     eingeladen worden ("Besitzer laedt jemanden ein") und duerfte seine
     Kennung daher zu Recht eintragen. Wer wirklich nicht dazugehoert,
     ist hier der Gesperrte. */
  await denied('Wer nicht dazugehört, trägt gar nichts ein',
    updateDoc(doc(fsOf(BLOCKED), 'docs/dok1'), {
      ['memberUids.' + BLOCKED.uid]: BLOCKED.mail
    }));

  await denied('Und nebenbei die Rolle anheben geht auch nicht',
    updateDoc(doc(fsOf(READER), 'docs/dok1'), {
      ['memberUids.' + READER.uid]: READER.mail,
      members: { [READER.mail]: 'edit' }
    }));

  /* ══════════════════════════════════════════════════════════════════
     REALTIME DATABASE
     ══════════════════════════════════════════════════════════════════ */

  const rtOf = (who) => person(env, who.uid, who.mail).database();

  /* ── Die Rollenliste des Raums ────────────────────────────────────
     Wer dazugehört, steht als ADRESSE in Firestore. Die Realtime
     Database kann dort nicht nachschlagen, deshalb legt der Besitzer
     unter roles/{docId} eine Liste mit KENNUNGEN ab. Erst sie öffnet
     Anwesenheit und Änderungsstrom.

     Vorher stand an beiden Stellen nur `auth != null`. Angemeldet ist
     aber jeder – die App meldet jedes Gerät anonym an, damit Freigaben
     ohne Konto lesbar sind. Wer eine docId kannte, kam damit an den
     gesamten Live-Textstrom eines fremden Dokuments heran und konnte
     hineinschreiben.
     ─────────────────────────────────────────────────────────────── */

  section('Realtime Database: die Rollenliste');

  await denied('Ein Fremder legt keinen Raum unter fremder Kennung an',
    set(ref(rtOf(STRANGER), 'roles/dok1'), { owner: OWNER.uid, r: {}, w: {} }));

  const rollen = {
    owner: OWNER.uid,
    r: { [OWNER.uid]: true, [EDITOR.uid]: true, [READER.uid]: true },
    w: { [OWNER.uid]: true, [EDITOR.uid]: true }
  };

  await ok('Der Besitzer legt den Raum an',
    set(ref(rtOf(OWNER), 'roles/dok1'), rollen));

  await denied('Danach übernimmt ihn niemand sonst',
    set(ref(rtOf(EDITOR), 'roles/dok1'), {
      owner: EDITOR.uid, r: { [EDITOR.uid]: true }, w: { [EDITOR.uid]: true }
    }));

  await denied('Auch der Bearbeiter trägt niemanden nach',
    set(ref(rtOf(EDITOR), 'roles/dok1/w/' + STRANGER.uid), true));

  await ok('Der Besitzer darf sie fortschreiben',
    set(ref(rtOf(OWNER), 'roles/dok1'), rollen));

  section('Realtime Database: Anwesenheit');

  /* Genau der Eintrag, den joinDocRoom schreibt – samt der Zeilensperre.
     Die Regel weist jedes Feld ab, das sie nicht kennt ($other), ein
     vergessenes Feld hier lässt also die Anwesenheit stumm ausfallen. */
  const card = {
    uid: EDITOR.uid, initials: 'BE', name: 'Bearbeiter', email: EDITOR.mail,
    color: '#2a5fa8', pageId: 'p1', offset: 12,
    lockFrom: 0, lockTo: 24, lockAt: Date.now(), cx: 'ein Stück Text', at: Date.now()
  };

  await ok('Man meldet sich selbst an',
    set(ref(rtOf(EDITOR), 'presence/dok1/' + EDITOR.uid), card));
  await denied('Die Sperre muss eine Zahl sein',
    set(ref(rtOf(EDITOR), 'presence/dok1/' + EDITOR.uid), { ...card, lockFrom: 'anfang' }));
  await denied('Aber nicht unter fremdem Namen',
    set(ref(rtOf(READER), 'presence/dok1/' + EDITOR.uid), { ...card }));
  await denied('Und nicht mit erfundenen Feldern',
    set(ref(rtOf(EDITOR), 'presence/dok1/' + EDITOR.uid), { ...card, schadhaft: 'x' }));
  await ok('Mitlesen darf, wer in der Liste steht',
    get(ref(rtOf(READER), 'presence/dok1')));
  await denied('Ohne Anmeldung nicht',
    get(ref(env.unauthenticatedContext().database(), 'presence/dok1')));

  /* >>> Der Fall, der vorher fehlte <<<
     Ein Außenstehender ist angemeldet – anonym genügt, und anonym ist
     hier jeder Besucher der Website. */
  await denied('Ein Fremder liest die Anwesenheit nicht mit',
    get(ref(rtOf(STRANGER), 'presence/dok1')));
  await denied('Und meldet sich dort auch nicht an',
    set(ref(rtOf(STRANGER), 'presence/dok1/' + STRANGER.uid),
        { ...card, uid: STRANGER.uid, email: STRANGER.mail }));

  section('Realtime Database: der Änderungsstrom');

  const opBase = { p: 'p1', by: EDITOR.uid, at: Date.now() };

  await ok('Text', set(ref(rtOf(EDITOR), 'ops/dok1/o1'), { ...opBase, k: 'y', u: 'AAAA' }));

  /* Die Schreibmarke reist an der Textänderung mit. Fehlten diese Felder
     in den Regeln, würde JEDE Textänderung abgewiesen – nicht nur die
     Marke bliebe stehen, es käme gar nichts mehr an. */
  await ok('Text mit Schreibmarke und Sperre',
    set(ref(rtOf(EDITOR), 'ops/dok1/o1b'),
        { ...opBase, k: 'y', u: 'AAAA', c: 42, lf: 12, lt: 80, cx: 'ein Stück Text' }));
  await ok('Ein Strich', set(ref(rtOf(EDITOR), 'ops/dok1/o2'), { ...opBase, k: 'ink', s: { path: [{ x: 1 }] } }));

  // Die Arten, die mit der Live-Übertragung des Aufbaus dazugekommen sind
  for (const [kind, label] of [
    ['st', 'Abschnitte und Reihenfolge'],
    ['pg+', 'Seite angelegt'],
    ['pg-', 'Seite gelöscht'],
    ['pgm', 'Seitenangaben'],
    ['obj', 'Objekte'],
    ['inks', 'Striche neu'],
    ['get', 'Seite nachholen']
  ]) {
    await ok(label, set(ref(rtOf(EDITOR), 'ops/dok1/k_' + kind.replace(/\W/g, '_')),
      { ...opBase, k: kind, u: '{"a":1}' }));
  }

  await denied('Nicht unter fremdem Namen',
    set(ref(rtOf(READER), 'ops/dok1/o3'), { ...opBase, k: 'y', u: 'AAAA' }));
  await denied('Nicht ohne Absender',
    set(ref(rtOf(EDITOR), 'ops/dok1/o4'), { k: 'y', p: 'p1', u: 'AAAA' }));
  // Ohne Zeitstempel liesse sich der Eintrag nie wieder wegräumen
  await denied('Nicht ohne Zeitstempel',
    set(ref(rtOf(EDITOR), 'ops/dok1/o7'), { k: 'y', p: 'p1', by: EDITOR.uid, u: 'AAAA' }));
  await denied('Nicht mit erfundenen Feldern',
    set(ref(rtOf(EDITOR), 'ops/dok1/o5'), { ...opBase, k: 'y', u: 'AAAA', schadhaft: 1 }));
  await denied('Und nicht überlang',
    set(ref(rtOf(EDITOR), 'ops/dok1/o6'), { ...opBase, k: 'y', u: 'x'.repeat(200001) }));

  /* ── Nur lesen heißt nur lesen ─────────────────────────────────────
     Der Leser steht in r, aber nicht in w. Vorher durfte er schreiben:
     die Regel fragte allein nach `auth != null`. Damit konnte jemand mit
     einem reinen Lese-Link Text und Striche in die laufende Sitzung
     schieben – und weil der Text drüben in innerHTML landete, war das
     mehr als Sachbeschädigung. */
  await denied('Wer nur lesen darf, schreibt nicht in den Strom',
    set(ref(rtOf(READER), 'ops/dok1/oL'),
        { p: 'p1', by: READER.uid, at: Date.now(), k: 'y', u: 'AAAA' }));
  await ok('Mitlesen darf er', get(ref(rtOf(READER), 'ops/dok1')));

  /* ── Der Besitzer geht kurz weg ────────────────────────────────────
     Beim Verlassen hat er die ganze Rollenliste mitgenommen. Anwesenheit
     und Änderungsstrom hängen aber daran (roles/$docId/r) – in dem
     Augenblick verloren also ALLE anderen beides auf einen Schlag, und
     zwar endgültig: Firebase kündigt einen Beobachter, den die Regeln
     einmal abgewiesen haben. Kam der Besitzer zurück, sassen sie taub im
     Lesemodus. Zweimal gemeldet.

     Jetzt nimmt er nur noch das SCHREIBRECHT mit (leave in
     core/share.js). Was das für die Regeln heisst, steht hier. */
  section('Realtime Database: der Besitzer geht kurz weg');

  await ok('Er nimmt nur das Schreibrecht mit',
    set(ref(rtOf(OWNER), 'roles/dok1/w'), { [OWNER.uid]: true }));

  await ok('Der Leser liest die Anwesenheit weiter mit',
    get(ref(rtOf(READER), 'presence/dok1')));
  await ok('Und den Änderungsstrom auch',
    get(ref(rtOf(READER), 'ops/dok1')));
  await ok('Der Bearbeiter ebenso',
    get(ref(rtOf(EDITOR), 'ops/dok1')));
  await ok('Und meldet sich weiter als anwesend',
    set(ref(rtOf(EDITOR), 'presence/dok1/' + EDITOR.uid), card));

  /* Aber schreiben darf ohne ihn niemand mehr – genau der Grund, aus dem
     die Liste ueberhaupt weggeraeumt wurde. */
  await denied('Schreiben geht ohne den Besitzer nicht mehr',
    set(ref(rtOf(EDITOR), 'ops/dok1/oWeg'),
        { p: 'p1', by: EDITOR.uid, at: Date.now(), k: 'y', u: 'AAAA' }));

  await ok('Und wenn er zurückkommt, gilt wieder alles',
    set(ref(rtOf(OWNER), 'roles/dok1'), rollen));
  await ok('Der Bearbeiter schreibt wieder',
    set(ref(rtOf(EDITOR), 'ops/dok1/oZurueck'),
        { p: 'p1', by: EDITOR.uid, at: Date.now(), k: 'y', u: 'AAAA' }));

  await denied('Ein Fremder liest den Strom nicht mit',
    get(ref(rtOf(STRANGER), 'ops/dok1')));
  await denied('Und schreibt erst recht nicht hinein',
    set(ref(rtOf(STRANGER), 'ops/dok1/oF'),
        { p: 'p1', by: STRANGER.uid, at: Date.now(), k: 'y', u: 'AAAA' }));

  section('Realtime Database: der Chat');

  /* >>> Der Unterschied zum Änderungsstrom <<<
     ops darf nur, wer BEARBEITEN darf. Der Chat steht jedem offen, der
     das Dokument lesen darf – gerade wer nur zusehen kann, hat oft eine
     Frage. Genau das prüft die erste Zeile hier. */
  const nachricht = { by: READER.uid, at: Date.now(), tx: 'Schau mal auf Seite 4' };

  await ok('Auch wer nur liest, darf etwas sagen',
    set(ref(rtOf(READER), 'chat/dok1/m/n1'), nachricht));
  await ok('Mit Name, Initialen und Farbe',
    set(ref(rtOf(EDITOR), 'chat/dok1/m/n2'), {
      by: EDITOR.uid, at: Date.now(), tx: 'mach ich',
      nm: 'Bearbeiter', ini: 'BE', col: '#2a5fa8'
    }));
  await ok('Mitlesen darf, wer in der Liste steht',
    get(ref(rtOf(READER), 'chat/dok1')));

  await denied('Aber nicht unter fremdem Namen',
    set(ref(rtOf(EDITOR), 'chat/dok1/m/n3'), { ...nachricht }));
  await denied('Eine leere Nachricht ist keine',
    set(ref(rtOf(READER), 'chat/dok1/m/n4'), { ...nachricht, tx: '' }));
  await denied('Und keine ohne Ende',
    set(ref(rtOf(READER), 'chat/dok1/m/n5'), { ...nachricht, tx: 'x'.repeat(801) }));
  await denied('Erfundene Felder nicht',
    set(ref(rtOf(READER), 'chat/dok1/m/n6'), { ...nachricht, bild: 'data:...' }));

  /* ── Eine Antwort auf eine andere Nachricht ────────────────────────
     rid ist die gemeinte Kennung, rn ihr Verfasser, rt ein kurzer
     Ausschnitt. Der Ausschnitt reist mit, weil die gemeinte Nachricht
     nach einem Tag weg sein kann (sendChat in src/core/share.js).

     Ohne diese drei Felder in den Regeln weist `$other` jede Antwort
     ab – und zwar die GANZE Nachricht, nicht nur das Zitat darin.
     Genau davor steht die erste Zeile hier. */
  await ok('Eine Antwort trägt Kennung, Namen und Ausschnitt',
    set(ref(rtOf(READER), 'chat/dok1/m/n7'), {
      ...nachricht, rid: '-Nabc123', rn: 'Bearbeiter', rt: 'mach ich'
    }));
  await denied('Der Ausschnitt bleibt kurz',
    set(ref(rtOf(READER), 'chat/dok1/m/n8'), { ...nachricht, rt: 'x'.repeat(141) }));
  await denied('Und die Kennung ist eine Zeichenkette',
    set(ref(rtOf(READER), 'chat/dok1/m/n9'), { ...nachricht, rid: 42 }));

  /* Ein Fremder ist angemeldet – anonym genügt, und anonym ist jeder
     Besucher der Website. Er darf weder mitlesen noch mitreden. */
  await denied('Ein Fremder liest nicht mit',
    get(ref(rtOf(STRANGER), 'chat/dok1')));
  await denied('Und redet auch nicht mit',
    set(ref(rtOf(STRANGER), 'chat/dok1/m/nF'),
        { by: STRANGER.uid, at: Date.now(), tx: 'hallo' }));

  await ok('Die Tipp-Anzeige setzt man für sich selbst',
    set(ref(rtOf(READER), 'chat/dok1/t/' + READER.uid), Date.now()));
  await ok('Und nimmt sie wieder weg',
    remove(ref(rtOf(READER), 'chat/dok1/t/' + READER.uid)));
  await denied('Für einen anderen nicht',
    set(ref(rtOf(READER), 'chat/dok1/t/' + EDITOR.uid), Date.now()));
  await denied('Und nur als Zahl',
    set(ref(rtOf(READER), 'chat/dok1/t/' + READER.uid), 'ja'));

  section('Realtime Database: aufräumen');

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, 'ops/dok1/alt'), {
      k: 'y', p: 'p1', by: 'jemand-anderes', u: 'A',
      at: Date.now() - 11 * 60 * 1000
    });
    await set(ref(db, 'ops/dok1/frisch'), {
      k: 'y', p: 'p1', by: 'jemand-anderes', u: 'A', at: Date.now()
    });
  });

  await ok('Alte fremde Einträge darf jeder Schreibende wegräumen',
    remove(ref(rtOf(EDITOR), 'ops/dok1/alt')));
  await denied('Frische fremde Einträge nicht',
    remove(ref(rtOf(EDITOR), 'ops/dok1/frisch')));
  await ok('Die eigenen jederzeit',
    remove(ref(rtOf(EDITOR), 'ops/dok1/o1')));

  /* Der Chat hält länger als der Änderungsstrom – einen Tag statt zehn
     Minuten. Eine Bemerkung an einen Menschen ist auch morgen noch etwas
     wert, eine Yjs-Änderung nicht. */
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, 'chat/dok1/m/alt'), {
      by: 'jemand-anderes', at: Date.now() - 25 * 60 * 60 * 1000, tx: 'von gestern'
    });
    await set(ref(db, 'chat/dok1/m/frisch'), {
      by: 'jemand-anderes', at: Date.now(), tx: 'von eben'
    });
  });

  await ok('Alte fremde Nachrichten darf jeder Beteiligte wegräumen',
    remove(ref(rtOf(READER), 'chat/dok1/m/alt')));
  await denied('Frische fremde nicht',
    remove(ref(rtOf(READER), 'chat/dok1/m/frisch')));
  await ok('Die eigenen jederzeit',
    remove(ref(rtOf(READER), 'chat/dok1/m/n1')));

  /* ── Postfach ──────────────────────────────────────────────────────
     Die Nachrichten selbst sind oeffentlich lesbar – das ist Absicht und
     der Grund, warum der Empfaengerkreis in der App nur eine Hoeflichkeit
     ist (src/core/postfach.js). Der persoenliche Gelesen-Stand dagegen
     geht niemanden sonst etwas an, auch den Admin nicht. */
  section('Firestore: Postfach');

  const ohne = () => env.unauthenticatedContext().firestore();

  await ok('Nachrichten liest jeder, auch ohne Anmeldung',
    getDoc(doc(ohne(), 'site_content/nachrichten')));

  await denied('Schreiben darf sie nur der Admin',
    setDoc(doc(fsOf(STRANGER), 'site_content/nachrichten'), { liste: [] }));

  await ok('Der Admin darf',
    setDoc(doc(fsOf(ADMIN), 'site_content/nachrichten'), { liste: [] }));

  await ok('Den eigenen Stand anlegen',
    setDoc(doc(fsOf(READER), 'postfach/' + READER.uid),
      { gelesen: ['n1'], geloescht: [], aktualisiert: serverTimestamp() }));

  await ok('Und wieder lesen',
    getDoc(doc(fsOf(READER), 'postfach/' + READER.uid)));

  await denied('Fremde Staende bleiben zu',
    getDoc(doc(fsOf(STRANGER), 'postfach/' + READER.uid)));

  await denied('Und lassen sich nicht ueberschreiben',
    setDoc(doc(fsOf(STRANGER), 'postfach/' + READER.uid), { gelesen: [] }));

  /* Der Admin verschickt Nachrichten – er soll nicht mitlesen koennen,
     wer sie geoeffnet hat. */
  await denied('Auch der Admin sieht fremde Staende nicht',
    getDoc(doc(fsOf(ADMIN), 'postfach/' + READER.uid)));

  await denied('Ohne Anmeldung gar kein Postfach',
    getDoc(doc(ohne(), 'postfach/' + READER.uid)));

  /* ══════════════════════════════════════════════════════════════
     MELDEN UND SPERREN
     ══════════════════════════════════════════════════════════════ */

  section('Melden: was durchkommt und was nicht');

  const meldung = (extra = {}) => ({
    erstellt: serverTimestamp(),
    melderEmail: MELDER.mail,
    gemeldetEmail: GESPERRT.mail,
    gemeldetName: 'Verwarnt',
    docId: 'dok1',
    docTitel: 'Mathematik',
    ownerUid: OWNER.uid,
    gegenBesitzer: false,
    grund: 'beleidigung',
    notiz: 'Hat im Chat beleidigt.',
    erledigt: false,
    ...extra
  });

  await ok('Ein Angemeldeter darf melden',
    setDoc(doc(fsOf(MELDER), 'meldungen/m1'), meldung()));

  await denied('Aber nicht unter fremdem Namen',
    setDoc(doc(fsOf(MELDER), 'meldungen/m2'), meldung({ melderEmail: OWNER.mail })));

  await denied('Und nicht sich selbst',
    setDoc(doc(fsOf(MELDER), 'meldungen/m3'), meldung({ gemeldetEmail: MELDER.mail })));

  await denied('Ein erfundener Grund kommt nicht durch',
    setDoc(doc(fsOf(MELDER), 'meldungen/m4'), meldung({ grund: 'weilichkann' })));

  await denied('Eine zu lange Notiz auch nicht',
    setDoc(doc(fsOf(MELDER), 'meldungen/m5'), meldung({ notiz: 'x'.repeat(301) })));

  await denied('Und nicht gleich als erledigt',
    setDoc(doc(fsOf(MELDER), 'meldungen/m6'), meldung({ erledigt: true })));

  await denied('Ohne Anmeldung gar nicht',
    setDoc(doc(ohne(), 'meldungen/m7'), meldung({ melderEmail: '' })));

  await ok('Die Verwaltung liest sie',
    getDoc(doc(fsOf(ADMIN), 'meldungen/m1')));

  await ok('Der Besitzer des Dokuments auch',
    getDoc(doc(fsOf(OWNER), 'meldungen/m1')));

  await denied('Der Gemeldete sieht sie nicht',
    getDoc(doc(fsOf(GESPERRT), 'meldungen/m1')));

  await denied('Und auch nicht der, der sie geschrieben hat',
    getDoc(doc(fsOf(MELDER), 'meldungen/m1')));

  await ok('Der Besitzer darf sie abhaken',
    updateDoc(doc(fsOf(OWNER), 'meldungen/m1'), { erledigt: true }));

  await denied('Aber nicht den Vorwurf umschreiben',
    updateDoc(doc(fsOf(OWNER), 'meldungen/m1'), { grund: 'sonstiges' }));

  section('Verbannen und zurueckholen');

  /* Genau die zwei Schreibvorgaenge, die ui/share.js macht: erst
     hinauswerfen (mit Merkzettel), dann zurueckholen. Gemeldet wurde
     „beim Zurueckholen kommt ein Fehler" – hier faellt auf, ob eine
     Regel im Weg steht. */
  await ok('Hinauswerfen, mit Merkzettel',
    updateDoc(doc(fsOf(OWNER), 'docs/dok1'), {
      memberEmails: [READER.mail],
      members: { [READER.mail]: 'view' },
      memberVia: { [READER.mail]: 'invite' },
      blockedEmails: [BLOCKED.mail, EDITOR.mail],
      blockedInfo: { [EDITOR.mail]: { role: 'edit', via: 'invite' } }
    }));

  await ok('Und zurueckholen, mit Rolle und Weg',
    updateDoc(doc(fsOf(OWNER), 'docs/dok1'), {
      memberEmails: [READER.mail, EDITOR.mail],
      members: { [READER.mail]: 'view', [EDITOR.mail]: 'edit' },
      memberVia: { [READER.mail]: 'invite', [EDITOR.mail]: 'invite' },
      blockedEmails: [BLOCKED.mail],
      blockedInfo: {}
    }));

  await ok('Der Zurueckgeholte darf wieder lesen',
    getDoc(doc(fsOf(EDITOR), 'docs/dok1')));

  await ok('Und wieder schreiben',
    setDoc(doc(fsOf(EDITOR), 'docs/dok1/pages/p1'),
      { index: 0, text: '<p>Wieder da</p>', objects: [] }));

  await denied('Ein Fremder darf das alles nicht',
    updateDoc(doc(fsOf(STRANGER), 'docs/dok1'), { blockedInfo: {} }));

  section('Rausgeworfen heisst auch: nicht ueber den Link');

  /* dok2 hat einen offenen Link. BLOCKED steht in seiner blockedEmails –
     der Besitzer hat ihn aus dem Dokument geworfen. Bis hierher las er
     es trotzdem weiter, weil der Link offen ist. */
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'docs/dok2'), headData({
      linkMode: 'edit', linkId: 'link2', memberEmails: [], members: {}, memberVia: {},
      blockedEmails: [BLOCKED.mail]
    }));
  });

  await denied('Der Hinausgeworfene liest den Kopf nicht mehr',
    getDoc(doc(fsOf(BLOCKED), 'docs/dok2')));

  await denied('Und den Inhalt erst recht nicht',
    getDoc(doc(fsOf(BLOCKED), 'docs/dok2/pages/p1')));

  await ok('Ein anderer Angemeldeter kommt weiter ueber den Link',
    getDoc(doc(fsOf(STRANGER), 'docs/dok2')));

  /* Ohne Konto gibt es keine Adresse, an der eine Sperre haengen koennte.
     Ein offener Link bleibt fuer Unangemeldete offen - das ist die Natur
     eines Links und steht so in den Regeln. */
  await ok('Ohne Anmeldung bleibt ein offener Link offen',
    getDoc(doc(ohne(), 'docs/dok2')));

  section('Wird der Besitzer gemeldet, sieht er es nicht');

  /* Sonst bekaeme er die Beschwerde ueber sich selbst vorgelegt, koennte
     sie abhaken – und angeboten wuerde ihm, sich aus seinem eigenen
     Dokument zu verbannen. */
  await ok('Der Besitzer laesst sich melden',
    setDoc(doc(fsOf(MELDER), 'meldungen/mb1'),
      meldung({ gemeldetEmail: OWNER.mail, gemeldetName: 'Besitzer', gegenBesitzer: true })));

  await denied('Aber er sieht die Meldung nicht',
    getDoc(doc(fsOf(OWNER), 'meldungen/mb1')));

  await ok('Die Verwaltung schon',
    getDoc(doc(fsOf(ADMIN), 'meldungen/mb1')));

  await denied('Und er kann sie auch nicht abhaken',
    updateDoc(doc(fsOf(OWNER), 'meldungen/mb1'), { erledigt: true }));

  /* Der Vermerk laesst sich nicht faelschen: er wird gegen den Kopf des
     Dokuments geprueft. */
  await denied('Ein falscher Vermerk kommt nicht durch (Besitzer, aber false)',
    setDoc(doc(fsOf(MELDER), 'meldungen/mb2'),
      meldung({ gemeldetEmail: OWNER.mail, gegenBesitzer: false })));

  await denied('Und andersherum genauso (Fremder, aber true)',
    setDoc(doc(fsOf(MELDER), 'meldungen/mb3'),
      meldung({ gemeldetEmail: GESPERRT.mail, gegenBesitzer: true })));

  section('Sperren: nur die Verwaltung setzt sie');

  const sperre = (umfang, bis = null) => ({
    email: GESPERRT.mail, bis, umfang,
    grund: 'Beleidigung', gesetztAm: serverTimestamp()
  });

  await denied('Ein Nutzer sperrt niemanden',
    setDoc(doc(fsOf(MELDER), 'sperren/' + GESPERRT.mail),
      sperre({ neueFreigaben: true, selbstTeilen: false, laufendeRaus: false })));

  await denied('Auch nicht sich selbst frei',
    setDoc(doc(fsOf(GESPERRT), 'sperren/' + GESPERRT.mail), sperre({})));

  await ok('Die Verwaltung schon',
    setDoc(doc(fsOf(ADMIN), 'sperren/' + GESPERRT.mail),
      sperre({ neueFreigaben: true, selbstTeilen: true, laufendeRaus: true })));

  await ok('Der Betroffene darf seine eigene Sperre sehen',
    getDoc(doc(fsOf(GESPERRT), 'sperren/' + GESPERRT.mail)));

  await denied('Fremde Sperren gehen niemanden etwas an',
    getDoc(doc(fsOf(MELDER), 'sperren/' + GESPERRT.mail)));

  section('Und die Sperre wirkt wirklich');

  await denied('Aus laufenden Freigaben heraus: kein Kopf mehr',
    getDoc(doc(fsOf(GESPERRT), 'docs/dok3')));

  await denied('Und kein Inhalt',
    getDoc(doc(fsOf(GESPERRT), 'docs/dok3/pages/p1')));

  await denied('Auch nicht ueber den offenen Link daneben',
    getDoc(doc(fsOf(GESPERRT), 'docs/dok2/pages/p1')));

  await denied('Nichts mehr schreiben',
    setDoc(doc(fsOf(GESPERRT), 'docs/dok3/pages/p1'),
      { index: 0, text: '<p>Doch</p>', objects: [] }));

  await denied('Nichts Eigenes mehr freigeben',
    setDoc(doc(fsOf(GESPERRT), 'docs/neu1'), {
      owner: GESPERRT.uid, ownerEmail: GESPERRT.mail, ownerName: 'V',
      title: 'Neu', color: '#c8a96e', defaultBg: 'ruled', notebookId: 'nb9',
      format: 'pages', revision: 0, linkMode: 'off', linkId: '',
      pageCount: 1, pageOrder: ['p1'], sections: [], activeSecId: '',
      memberEmails: [], members: {}, memberVia: {}, blockedEmails: []
    }));

  await ok('Der Ungesperrte daneben kann alles wie vorher',
    getDoc(doc(fsOf(EDITOR), 'docs/dok3')));

  await env.withSecurityRulesDisabled(async (ctx) => {
    // Sperre auf „abgelaufen" stellen
    await setDoc(doc(ctx.firestore(), 'sperren/' + GESPERRT.mail), {
      email: GESPERRT.mail,
      bis: new Date(Date.now() - 864e5),
      umfang: { neueFreigaben: true, selbstTeilen: true, laufendeRaus: true },
      grund: 'Beleidigung'
    });
  });

  await ok('Abgelaufen: er ist wieder dabei, wo er vorher war',
    getDoc(doc(fsOf(GESPERRT), 'docs/dok3')));

  await ok('Und darf wieder freigeben',
    setDoc(doc(fsOf(GESPERRT), 'docs/neu2'), {
      owner: GESPERRT.uid, ownerEmail: GESPERRT.mail, ownerName: 'V',
      title: 'Neu', color: '#c8a96e', defaultBg: 'ruled', notebookId: 'nb9',
      format: 'pages', revision: 0, linkMode: 'off', linkId: '',
      pageCount: 1, pageOrder: ['p1'], sections: [], activeSecId: '',
      memberEmails: [], members: {}, memberVia: {}, blockedEmails: []
    }));

  section('Direktpost: eine Nachricht an einen einzelnen');

  await ok('Die Verwaltung legt sie an',
    setDoc(doc(fsOf(ADMIN), 'direktpost/' + GESPERRT.mail), { liste: [] }));

  await ok('Der Empfaenger liest sie',
    getDoc(doc(fsOf(GESPERRT), 'direktpost/' + GESPERRT.mail)));

  await denied('Sonst niemand',
    getDoc(doc(fsOf(MELDER), 'direktpost/' + GESPERRT.mail)));

  await denied('Und niemand schreibt sich selbst etwas hinein',
    setDoc(doc(fsOf(GESPERRT), 'direktpost/' + GESPERRT.mail), { liste: [] }));

  section('Realtime Database: alles Übrige bleibt zu');

  await denied('Nichts an anderer Stelle',
    set(ref(rtOf(EDITOR), 'irgendwo/sonst'), { a: 1 }));

  await env.cleanup();

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})().catch(err => {
  console.error('\nRegelprüfung abgebrochen:', err);
  process.exit(1);
});
