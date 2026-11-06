/* ══════════════════════════════════════════════════════════════════════
   DIE SEITEN DER WEBSITE, EINMAL ALLE AUFGEMACHT

   >>> Wozu das gut ist <<<
   website/ steht in .gitignore und reist nicht über den app-Branch mit
   (siehe scripts/pull-website.js). Der Ordner läuft deshalb auf zwei
   Rechnern auseinander, und ein Fehler, der beim Auffrischen entsteht –
   ein Skript, das eine Funktion aus einer neueren common.js ruft –
   fällt niemandem auf: die Seite bleibt einfach stehen.

   Hier wird jede Seite in einem echten Chromium geladen und alles
   eingesammelt, was in der Konsole landet. Geprüft wird zusätzlich, dass
   die Seite ihre Beschriftungen wirklich eingesetzt hat: bleibt ein
   data-i18n-Feld leer oder steht darin noch der Schlüssel, ist die
   Übersetzung nicht angekommen.

   Ohne Anmeldung und ohne Netz: Firebase bekommt hier keine Verbindung,
   und das ist in Ordnung. Was danach an Fehlern übrig bleibt, gehört zur
   Seite selbst.

   Läuft NICHT in `npm test` – braucht Electron.
   Aufruf:  npm run test:web
   ══════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
require('../stabile-fenster.js');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const WEB = path.join(ROOT, 'website');
app.disableHardwareAcceleration();

const zeilen = [];
const abschnitt = (name) => { zeilen.push(''); zeilen.push(name); };
const pruefe = (was, ok, hinweis) =>
  zeilen.push((ok ? 'ok   ' : 'FEHL ') + was + (ok ? '' : '  -> ' + hinweis));

function fertig(code) {
  process.stdout.write('\nDie Seiten der Website\n');
  process.stdout.write(zeilen.map(l => '  ' + l).join('\n') + '\n');
  const fehl = zeilen.filter(l => /^(FEHL|ABBRUCH)/.test(l)).length;
  process.stdout.write('\n' + (fehl ? fehl + ' Prüfung(en) fehlgeschlagen.' : 'Alle Prüfungen bestanden.') + '\n');
  app.exit(fehl ? 1 : code);
}

setTimeout(() => { zeilen.push('ABBRUCH: Zeitgrenze erreicht'); fertig(2); }, 180000);
const warte = ms => new Promise(r => setTimeout(r, ms));

/* Jede Seite bekommt ihr eigenes Fenster, und das alte wird zugemacht.
   Zwischen zwei Seiten ist damit KEIN Fenster offen – und darauf beendet
   Electron sich von selbst. Der Prüfstand war dadurch nach der ersten
   Seite still zu Ende, ohne einen einzigen Bericht. */
app.on('window-all-closed', () => { /* der Rundgang ist noch nicht fertig */ });

/* Ein eigener kleiner Server – derselbe Aufbau wie scripts/serve-website.js,
   nur auf einem Port, der niemandem in die Quere kommt. */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch (e) { res.writeHead(400); res.end(); return; }
  if (p.endsWith('/')) p += 'index.html';

  const abs = path.resolve(WEB, '.' + p);
  if (abs !== WEB && !abs.startsWith(WEB + path.sep)) { res.writeHead(403); res.end(); return; }

  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); res.end('nicht gefunden: ' + p); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

/* Was beim Laden ohne Netz und ohne Anmeldung zu erwarten ist. Diese
   Meldungen gehören nicht der Seite, sondern der fehlenden Verbindung –
   sie hier durchzulassen ist der Unterschied zwischen einem Bericht, den
   man liest, und einem, den man wegklickt. */
const ERWARTET = [
  /net::ERR_/i, /Failed to load resource/i, /ERR_NAME_NOT_RESOLVED/i,
  /ERR_INTERNET_DISCONNECTED/i, /ERR_CONNECTION/i,
  /auth\/network-request-failed/i, /Firebase/i, /firestore/i,
  /googleapis|gstatic|firebaseio|firebasedatabase/i,
  /offline/i, /Access to (fetch|XMLHttpRequest)/i,
  /favicon/i
];
const istErwartet = (text) => ERWARTET.some(r => r.test(text));

const SEITEN = [
  ['Die Startseite', '/'],
  ['Die Leseansicht', '/s/'],
  ['Das Dashboard', '/dashboard/'],
  ['Die Community', '/community/'],
  ['Der Datenschutz', '/datenschutz/'],
  ['Die Verwaltung', '/admin/']
];


/* Die Oberflaeche fragt beim Hochfahren nach einer beim Start
   mitgegebenen Datei (main.js, get-pending-file). Hier gibt es keine -
   ohne diesen Griff protokolliert Electron aber einen Fehler, der mit
   dem Geprueften nichts zu tun hat. */
try { ipcMain.handle('get-pending-file', () => null); } catch (e) {}

app.on('ready', () => {
  server.listen(0, '127.0.0.1', async () => {
    const port = server.address().port;
    const basis = `http://127.0.0.1:${port}`;

    try {
      for (const [name, pfad] of SEITEN) {
        abschnitt(name + '  (' + pfad + ')');

        const win = new BrowserWindow({
          width: 1400, height: 900, show: false,
          webPreferences: { contextIsolation: true, nodeIntegration: false }
        });

        const konsole = [];
        win.webContents.on('console-message', (...args) => {
          let level, message;
          if (args[0] && typeof args[0] === 'object' && 'message' in args[0]) ({ level, message } = args[0]);
          else [, level, message] = args;
          if (level === 3 || level === 'error') konsole.push(String(message));
        });

        let ladeFehler = null;
        win.webContents.on('did-fail-load', (_e, code, desc, url) => {
          // Unterressourcen melden sich hier auch; nur die Seite selbst zaehlt
          if (url && url.startsWith(basis + pfad)) ladeFehler = `${code} ${desc}`;
        });

        try {
          await win.loadURL(basis + pfad);
        } catch (err) {
          pruefe('Die Seite laedt', false, String(err && err.message || err));
          win.destroy();
          continue;
        }
        await warte(2600);

        pruefe('Die Seite laedt', !ladeFehler, ladeFehler || '');

        // Steht ueberhaupt Inhalt da?
        const lage = await win.webContents.executeJavaScript(`(() => {
          const leer = [];
          const roh = [];
          for (const el of document.querySelectorAll('[data-i18n]')) {
            const k = el.getAttribute('data-i18n');
            const txt = (el.textContent || '').trim();
            if (!txt) leer.push(k);
            else if (txt === k) roh.push(k);
          }
          return JSON.stringify({
            titel: document.title,
            laenge: (document.body.innerText || '').trim().length,
            felder: document.querySelectorAll('[data-i18n]').length,
            leer, roh,
            fehler: (window.__fehler || [])
          });
        })()`).then(JSON.parse).catch(e => ({ fehler: ['Abfrage: ' + e.message], laenge: 0, felder: 0, leer: [], roh: [] }));

        /* ── Die Knöpfe ohne Inline-Code (js/tu.js) ────────────────────────
           Ein Name, den es nicht gibt, fiele erst beim Klick auf. Geprüft wird
           auch, was die Seite erst später baut: das steht in ihrer Skriptdatei. */
        {
          const fs = require('fs');
          const seitenOrdner = path.join(ROOT, 'website', pfad === '/' ? '' : pfad);
          const html = fs.readFileSync(path.join(seitenOrdner, 'index.html'), 'utf8');
          let text = html;
          for (const m of html.matchAll(/<script src="[^"]*(seite-[a-z]+\.js)"/g)) {
            text += fs.readFileSync(path.join(ROOT, 'website', 'js', m[1]), 'utf8');
          }
          const namen = new Set();
          for (const m of text.matchAll(/data-tu-[a-z]+="([^"]*)"/g)) {
            for (const a of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) namen.add(a[1]);
          }
          const fehlend = await win.webContents.executeJavaScript(
            `${JSON.stringify([...namen])}.filter(n => typeof window[n] !== 'function')`);
          pruefe('Jeder Knopf findet seine Funktion (' + namen.size + ')', fehlend.length === 0, fehlend.join(', '));

          const geklickt = await win.webContents.executeJavaScript(`(() => {
            const k = document.querySelector('[data-tu-click^="setLang"]');
            if (!k) return null;
            k.click();
            return document.documentElement.lang || true;
          })()`);
          if (geklickt !== null) pruefe('Ein Knopf tut etwas, ohne Fehler', true, '');
          await warte(200);
        }

        pruefe('Sie hat einen Titel', !!lage.titel, 'kein <title>');
        pruefe('Es steht Text darauf', lage.laenge > 60, `nur ${lage.laenge} Zeichen sichtbar`);
        pruefe('Die Beschriftungen sind eingesetzt',
          lage.leer.length === 0 && lage.roh.length === 0,
          [...lage.leer.map(k => 'leer: ' + k), ...lage.roh.map(k => 'nur der Schluessel: ' + k)]
            .slice(0, 8).join(', ') + `  (von ${lage.felder} Feldern)`);

        const echte = konsole.filter(k => !istErwartet(k));
        pruefe('Kein Fehler in der Konsole', echte.length === 0,
          echte.slice(0, 4).join(' | ').slice(0, 400));

        win.destroy();
      }

      fertig(0);
    } catch (err) {
      zeilen.push('ABBRUCH: ' + (err && err.stack || err));
      fertig(2);
    }
  });
});
