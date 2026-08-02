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

  /* ══════════════════════════════════════════════════════════════════
     REALTIME DATABASE
     ══════════════════════════════════════════════════════════════════ */

  const rtOf = (who) => person(env, who.uid, who.mail).database();

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
  await ok('Mitlesen darf, wer angemeldet ist',
    get(ref(rtOf(READER), 'presence/dok1')));
  await denied('Ohne Anmeldung nicht',
    get(ref(env.unauthenticatedContext().database(), 'presence/dok1')));

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

  await ok('Alte fremde Einträge darf jeder wegräumen',
    remove(ref(rtOf(EDITOR), 'ops/dok1/alt')));
  await denied('Frische fremde Einträge nicht',
    remove(ref(rtOf(EDITOR), 'ops/dok1/frisch')));
  await ok('Die eigenen jederzeit',
    remove(ref(rtOf(EDITOR), 'ops/dok1/o1')));

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
