/* ══════════════════════════════════════════════════════════════════════
   DAS FIREBASE-BÜNDEL, WIRKLICH BENUTZT – UNTER DER ECHTEN CSP

   Lädt lib/firebase/ in einem Fenster, das dieselbe Sicherheitsregel trägt wie
   die App, und redet mit den Emulatoren: anonym anmelden, Firestore schreiben und
   lesen, die Realtime Database über WebSocket und über Long-Polling. Long-Polling
   ist der Rückfallweg, für den 'unsafe-inline' einmal nötig schien.

   Dazu der Lader von Google, den die Microsoft-Anmeldung braucht (GAPI): auch er
   darf gegen die Regel nicht verstossen. Ohne Netz wird das nur übersprungen.

   Aufruf:  npm run test:firebase  (Emulatoren brauchen Java)
   ══════════════════════════════════════════════════════════════════════ */
const { app, BrowserWindow } = require('electron');
require('../stabile-fenster.js');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

const quelle = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const CSP = quelle.match(/const UI_CSP = "([^"]+)"/)[1]
  // Nur die Emulatoren kommen dazu – sie laufen über http und auf localhost
  .replace("connect-src 'self' https: wss:", "connect-src 'self' https: wss: http://localhost:* ws://localhost:*")
  .replace("script-src 'self'", "script-src 'self' http://localhost:*")
  // Long-Polling rahmt den Datenbank-Host ein; die echte Regel nennt firebasedatabase.app
  .replace('frame-src ', 'frame-src http://localhost:* ');

const SEITE = '<!doctype html><meta charset="utf-8"><title>Probe</title><script type="module" src="/__probe.js"></script>';
const PROBE = `
  const aus = { schritte: {}, verstoesse: [] };
  window.__ergebnis = aus;
  document.addEventListener('securitypolicyviolation', e => {
    aus.verstoesse.push(e.effectiveDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || '').slice(0, 60));
  });
  const k = await import('/lib/firebase/kern.js');
  const fb = k.initializeApp({ apiKey: 'probe', projectId: 'inkwell-rules-test', appId: 'probe' });
  const auth = k.getAuth(fb);
  k.connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  const db = k.getFirestore(fb);
  k.connectFirestoreEmulator(db, 'localhost', 8089);
  const wer = await k.signInAnonymously(auth);
  aus.schritte.anmeldung = !!wer.user.uid;

  const pfad = k.doc(db, 'shared_notebooks', 'buendel-' + Date.now());
  await k.setDoc(pfad, { owner: wer.user.uid, mode: 'frozen', title: 'Probe', chunkCount: 1 });
  aus.schritte.firestore = (await k.getDoc(pfad)).data().title === 'Probe';

  const e = await import('/lib/firebase/echtzeit.js');
  const rtdb = async (name, lang) => {
    const zweit = k.initializeApp({ apiKey: 'probe', projectId: 'inkwell-rules-test', appId: 'probe' }, name);
    const a2 = k.getAuth(zweit);
    k.connectAuthEmulator(a2, 'http://localhost:9099', { disableWarnings: true });
    const u = await k.signInAnonymously(a2);
    const d = e.getDatabase(zweit, 'http://localhost:9009?ns=inkwell-rules-test');
    if (lang) e.forceLongPolling(); else e.forceWebSockets();
    e.connectDatabaseEmulator(d, 'localhost', 9009);
    const ort = e.ref(d, 'roles/' + name);
    await e.set(ort, { owner: u.user.uid });
    return (await e.get(ort)).val().owner === u.user.uid;
  };
  aus.schritte.websocket = await rtdb('ws' + Date.now(), false);
  aus.schritte.longPolling = await rtdb('lp' + Date.now(), true);

  // Inline-Code muss abgewiesen werden
  const b = document.createElement('img');
  b.setAttribute('onerror', 'window.__lief = 1');
  b.src = 'data:,x';
  document.body.appendChild(b);
  await new Promise(r => setTimeout(r, 300));
  aus.schritte.inlineLaeuftNicht = window.__lief !== 1;

  // Der Lader für die Microsoft-Anmeldung
  aus.gapi = await new Promise(fertig => {
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onerror = () => fertig('kein Netz');
    s.onload = () => gapi.load('gapi.iframes', {
      callback: () => {
        gapi.iframes.getContext().open({
          where: document.body, url: 'https://inkwell-53ab9.firebaseapp.com/__/auth/iframe',
          messageHandlersFilter: gapi.iframes.CROSS_ORIGIN_IFRAMES_FILTER, dontclear: true
        }, () => {});
        setTimeout(() => fertig('geladen'), 2500);
      },
      onerror: () => fertig('Fehler'), timeout: 8000, ontimeout: () => fertig('Zeitgrenze')
    });
    document.head.appendChild(s);
  });
  aus.fertig = true;
`;

const zeilen = [];
const pruefe = (was, gut, hinweis) => zeilen.push((gut ? 'ok   ' : 'FEHL ') + was + (gut ? '' : '  -> ' + hinweis));
function fertig() {
  process.stdout.write('\nDas Firebase-Bündel unter der CSP\n' + zeilen.map(z => '  ' + z).join('\n') + '\n');
  const fehl = zeilen.filter(z => /^FEHL/.test(z)).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : 0);
}

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    const kopf = { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' };
    const pfad = new URL(req.url, 'http://localhost').pathname;
    if (pfad === '/') { res.writeHead(200, { ...kopf, 'Content-Type': 'text/html; charset=utf-8' }); res.end(SEITE); return; }
    if (pfad === '/__probe.js') { res.writeHead(200, { ...kopf, 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(PROBE); return; }
    fs.readFile(path.join(SRC, pfad), (err, daten) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { ...kopf, 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(daten);
    });
  });
  await new Promise(r => server.listen(0, 'localhost', r));

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  win.webContents.on('console-message', (ev) => {
    if (ev.level === 'error') zeilen.push('     Konsole: ' + String(ev.message).slice(0, 160));
  });
  await win.loadURL('http://localhost:' + server.address().port + '/');

  let r = null;
  for (let i = 0; i < 120; i++) {
    r = await win.webContents.executeJavaScript('window.__ergebnis || null');
    if (r && r.fertig) break;
    await new Promise(res => setTimeout(res, 500));
  }
  r = r || { schritte: {}, verstoesse: [] };
  pruefe('Anonym anmelden', r.schritte.anmeldung === true, JSON.stringify(r));
  pruefe('Firestore schreiben und lesen', r.schritte.firestore === true, JSON.stringify(r));
  pruefe('Realtime Database über WebSocket', r.schritte.websocket === true, JSON.stringify(r));
  pruefe('Realtime Database über Long-Polling', r.schritte.longPolling === true, JSON.stringify(r));
  pruefe('Eingeschleuster Inline-Code läuft nicht', r.schritte.inlineLaeuftNicht === true, JSON.stringify(r));
  pruefe('Der Lader der Microsoft-Anmeldung kommt hoch (' + r.gapi + ')',
    r.gapi === 'geladen' || r.gapi === 'kein Netz', String(r.gapi));
  const fremd = (r.verstoesse || []).filter(v => !/^script-src-attr|^script-src-elem data:/.test(v));
  pruefe('Nichts anderes verstösst gegen die Regel', fremd.length === 0, fremd.join(' | ').slice(0, 600));
  fertig();
}).catch(err => { zeilen.push('FEHL Abbruch: ' + (err && err.stack || err)); fertig(); });
