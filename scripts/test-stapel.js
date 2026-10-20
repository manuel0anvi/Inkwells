#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   EIN STAPEL BLEIBT UNTER DER GRENZE VON FIRESTORE

   Prüft stapel(), schreibeSchritte() und gewichtVon() aus core/share.js.

   >>> Woher der Test kommt <<<
   Gemeldet: „Freigabe aktivieren lädt für immer“ und danach „Request
   payload size exceeds the limit“. Firestore nimmt höchstens 10 MiB je
   Anfrage an, und es verschickt jeden Wert eingepackt – eine Handschrift
   ist auf der Leitung ein Vielfaches ihres JSON. Der nachgebaute Stapel
   unten weist deshalb ab, was in dieser Verpackung über der Grenze liegt.

   Aufruf:  node scripts/test-stapel.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const quelle = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'share.js'), 'utf8');

function extract(name) {
  const start = quelle.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Funktion ${name} nicht gefunden`);
  // „async function“ mitnehmen
  const vor = quelle.slice(Math.max(0, start - 6), start);
  const anfang = vor === 'async ' ? start - 6 : start;
  let depth = 0, seen = false;
  for (let i = start; i < quelle.length; i++) {
    const ch = quelle[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return quelle.slice(anfang, i + 1);
    }
  }
  throw new Error(`Ende von ${name} nicht gefunden`);
}
function extractConst(name) {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(quelle);
  if (!m) throw new Error(`Konstante ${name} nicht gefunden`);
  return `const ${name} = ${m[1]};`;
}

/* Firestore auf der Leitung: jeder Wert eingepackt wie im REST-Format.
   Was darüber 10 MiB ergibt, wird abgewiesen – mit dem echten Wortlaut. */
const GRENZE = 10 * 1024 * 1024;
function leitung(wert) {
  if (wert === null || wert === undefined) return '{"nullValue":null}';
  if (typeof wert === 'string') return JSON.stringify({ stringValue: wert });
  if (typeof wert === 'number') return Number.isInteger(wert)
    ? `{"integerValue":"${wert}"}` : `{"doubleValue":${wert}}`;
  if (typeof wert === 'boolean') return `{"booleanValue":${wert}}`;
  if (Array.isArray(wert)) return `{"arrayValue":{"values":[${wert.map(leitung).join(',')}]}}`;
  if (wert.__zeitstempel) return '{"timestampValue":"2026-10-20T00:00:00Z"}';
  return `{"mapValue":{"fields":{${Object.keys(wert).map(k => JSON.stringify(k) + ':' + leitung(wert[k])).join(',')}}}}`;
}

const protokoll = { commits: 0, abgewiesen: 0, geschrieben: new Set(), groesste: 0 };
function writeBatch() {
  const teile = [];
  return {
    set(ref, data) { teile.push({ ref, data }); },
    delete(ref) { teile.push({ ref, weg: true }); },
    async commit() {
      const groesse = teile.reduce((n, t) => n + 100 + (t.weg ? 0 : leitung(t.data).length), 0);
      protokoll.groesste = Math.max(protokoll.groesste, groesse);
      if (groesse > GRENZE) {
        protokoll.abgewiesen++;
        throw new Error('Request payload size exceeds the limit: 11534336 bytes.');
      }
      protokoll.commits++;
      for (const t of teile) protokoll.geschrieben.add(t.ref);
    }
  };
}

const sandbox = { writeBatch, db: {}, console, Object, Math, String, Array, JSON };
vm.createContext(sandbox);
vm.runInContext([
  extractConst('MAX_BATCH'),
  extractConst('MAX_BATCH_BYTES'),
  extract('gewichtVon'),
  extract('istZuGross'),
  extract('schreibeSchritte'),
  extract('stapel'),
  'this.stapel = stapel; this.schreibeSchritte = schreibeSchritte; this.istZuGross = istZuGross;'
].join('\n'), sandbox);

let failed = 0;
function check(label, ok, info) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed++; console.error(`  ✗ ${label}${info ? '  (' + info + ')' : ''}`); }
}

function strich(n) {
  const path = [];
  for (let i = 0; i < n; i++) path.push({ x: 80 + (i * 7) % 600, y: 120 + (i * 3) % 900 });
  return { path, color: '#1a1510', width: 2.5 };
}

(async () => {
  console.log('Viel Handschrift');
  {
    // 60 Bögen à ~550 KB JSON – so legt splitNotebook sie an
    const s = sandbox.stapel();
    const boegen = [];
    for (let b = 0; b < 60; b++) {
      const strokes = [];
      for (let k = 0; k < 60; k++) strokes.push(strich(500));
      boegen.push({ ref: 'ink/' + b, data: { pageId: 'p', no: b, strokes, by: 'u' } });
    }
    for (const b of boegen) await s.set(b.ref, b.data);
    await s.flush();
    check('Alles ist angekommen', boegen.every(b => protokoll.geschrieben.has(b.ref)));
    check('Kein Stapel war zu gross', protokoll.abgewiesen === 0,
      'abgewiesen: ' + protokoll.abgewiesen + ', groesster ' + Math.round(protokoll.groesste / 1048576) + ' MiB');
  }

  console.log('\nViele Bildstücke');
  {
    protokoll.abgewiesen = 0;
    const s = sandbox.stapel();
    const stuecke = [];
    for (let i = 0; i < 40; i++) stuecke.push({ ref: 'blob/' + i, data: { key: 'b' + i, data: 'A'.repeat(700000) } });
    for (const st of stuecke) await s.set(st.ref, st.data);
    await s.flush();
    check('Alle 40 Stücke sind oben', stuecke.every(st => protokoll.geschrieben.has(st.ref)));
    check('Ohne einen Fehlversuch', protokoll.abgewiesen === 0);
  }

  console.log('\nSchätzt es doch einmal daneben, wird geteilt');
  {
    protokoll.abgewiesen = 0;
    const schritte = [];
    for (let i = 0; i < 30; i++) schritte.push({ ref: 'zu-viel/' + i, data: { data: 'B'.repeat(700000) } });
    let fehler = null;
    try { await sandbox.schreibeSchritte(schritte); } catch (e) { fehler = e; }
    check('Kein Fehler nach aussen', !fehler, fehler && fehler.message);
    check('Erst abgewiesen, dann geteilt', protokoll.abgewiesen > 0);
    check('Und alles geschrieben', schritte.every(s => protokoll.geschrieben.has(s.ref)));
  }

  console.log('\nEin anderer Fehler wird nicht verschluckt');
  {
    check('„permission-denied“ ist kein Grössenproblem', !sandbox.istZuGross(new Error('Missing or insufficient permissions.')));
    check('Der Wortlaut von Firestore wird erkannt',
      sandbox.istZuGross(new Error('Request payload size exceeds the limit: 11534336 bytes.')));
  }

  if (failed) { console.error(`${failed} Pruefung(en) fehlgeschlagen.`); process.exit(1); }
  console.log('Alle Pruefungen bestanden.');
})();
