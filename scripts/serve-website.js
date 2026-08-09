#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Kleiner Webserver für die lokale Vorschau der Website.
   Start:  npm run web     (danach http://localhost:8080 öffnen)

   Warum überhaupt ein Server und nicht die Datei direkt öffnen?
   Der Google-Login funktioniert nicht über file:// – Google verlangt
   eine echte Herkunftsadresse (Origin), die in der Cloud Console
   eingetragen ist.

   Port 8080 bewusst, weil die Desktop-App beim Login kurzzeitig
   Port 3000 belegt.

   Ohne zusätzliche Pakete, damit nichts nachinstalliert werden muss.
   ══════════════════════════════════════════════════════════════════════ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'website');
const PORT = Number(process.env.PORT) || 8080;
const HOST = 'localhost';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    // Beim Entwickeln nie aus dem Zwischenspeicher liefern
    'Cache-Control': 'no-store, must-revalidate',
    ...headers
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, `http://${HOST}:${PORT}`).pathname);
  } catch (err) {
    return send(res, 400, 'Ungültige Adresse');
  }

  /* Ausbruch aus dem website-Ordner verhindern (z. B. /../../geheim).

     Mit dem Trennzeichen dahinter: ein reines startsWith(ROOT) laesst
     einen Nachbarordner durch, dessen Name nur mit "website" ANFAENGT.
     main.js macht es beim Ausliefern der Oberflaeche schon so. */
  const target = path.resolve(path.join(ROOT, urlPath));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Zugriff verweigert');
  }

  let filePath = target;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      console.log(`  404  ${urlPath}`);
      return send(res, 404, `Nicht gefunden: ${urlPath}`, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const body = fs.readFileSync(filePath);
    console.log(`  200  ${urlPath}`);
    send(res, 200, body, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
  } catch (err) {
    console.error(`  500  ${urlPath}`, err.message);
    send(res, 500, 'Serverfehler', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} ist belegt – vermutlich läuft der Server schon.`);
    console.error('');
    console.error('  Laufenden Server beenden (PowerShell):');
    console.error(`    Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT} -State Listen).OwningProcess -Force`);
    console.error('');
    console.error('  Oder einfach einen anderen Port nehmen:');
    console.error(`    PowerShell:  $env:PORT=${PORT + 1}; npm run web`);
    console.error(`    CMD:         set PORT=${PORT + 1} && npm run web`);
    console.error('');
    console.error('  Achtung: ein anderer Port muss auch in der Google Cloud Console');
    console.error('  eingetragen sein, sonst funktioniert dort der Login nicht.');
    console.error('');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Inkwell Website läuft');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Startseite   http://${HOST}:${PORT}/`);
  console.log(`  Dashboard    http://${HOST}:${PORT}/dashboard/`);
  console.log(`  Community    http://${HOST}:${PORT}/community/`);
  console.log(`  Datenschutz  http://${HOST}:${PORT}/datenschutz/`);
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Ordner: ${ROOT}`);
  console.log('  Beenden mit Strg+C');
  console.log('');
  console.log(`  Für den Google-Login muss http://${HOST}:${PORT} in der`);
  console.log('  Google Cloud Console eingetragen sein (siehe CLOUD_SETUP.md).');
  console.log('');
});
