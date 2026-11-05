#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   WAS EIN HEFT NICHT KOSTEN DARF

   · Eine Datei, die gerade fehlt, darf den Eintrag nicht löschen.
   · Verschieben darf keine andere Datei überschreiben und muss auch
     zwischen zwei Laufwerken gehen.

   Aufruf:  node scripts/test-datenverlust.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const lies = (...t) => fs.readFileSync(path.join(ROOT, ...t), 'utf8');

function extract(quelle, kopf) {
  const start = quelle.indexOf(kopf);
  if (start === -1) throw new Error('Nicht gefunden: ' + kopf);
  let tiefe = 0, gesehen = false;
  for (let i = start; i < quelle.length; i++) {
    if (quelle[i] === '{') { tiefe++; gesehen = true; }
    if (quelle[i] === '}' && --tiefe === 0 && gesehen) return quelle.slice(start, i + 1);
  }
  throw new Error('Nicht abgeschlossen: ' + kopf);
}

let fehler = 0;
function pruefe(titel, gut, hinweis) {
  console.log(`  ${gut ? '✓' : '✗'} ${titel}`);
  if (!gut) { fehler++; if (hinweis !== undefined) console.log('    ', hinweis); }
}

(async () => {
  console.log('Eine fehlende Datei löscht keinen Eintrag');
  {
    const entfernt = [];
    const meldungen = [];
    const hefte = {
      'a.jrnl': { success: true, data: { notebooks: [{ id: 'a', name: 'Da', pages: [] }] } },
      'kaputt.jrnl': { success: false, error: 'kaputt' }
    };
    const ctx = {
      console: { log() {}, warn() {}, error() {} },
      S: { notebooks: [] },
      t: () => '',
      toast: (m, f) => meldungen.push(m),
      normalizeNotebook: () => {},
      Registry: {
        load: async () => [
          { id: 'a', name: 'Da', path: 'a.jrnl' },
          { id: 'b', name: 'Stick', path: 'stick.jrnl' },
          { id: 'c', name: 'Kaputt', path: 'kaputt.jrnl' },
          { id: 'd', name: 'Wirft', path: 'wirft.jrnl' }
        ],
        remove: async (id) => entfernt.push(id)
      },
      window: { api: {
        fileExists: async (p) => p !== 'stick.jrnl',
        loadFromPath: async (p) => { if (p === 'wirft.jrnl') throw new Error('gesperrt'); return hefte[p]; }
      } }
    };
    vm.createContext(ctx);
    vm.runInContext(extract(lies('src', 'core', 'init.js'), 'async function loadNotebooksFromRegistry('), ctx);
    await ctx.loadNotebooksFromRegistry();
    pruefe('Nichts wurde aus der Liste entfernt', entfernt.length === 0, entfernt);
    pruefe('Das erreichbare Heft ist geladen', ctx.S.notebooks.length === 1 && ctx.S.notebooks[0].id === 'a');
    pruefe('Die drei anderen sind als fehlend vermerkt',
      JSON.stringify(Array.from(ctx.S.fehlendeHefte).map(e => e.id)) === '["b","c","d"]');
    pruefe('Und der Nutzer erfährt ihre Namen',
      meldungen.length === 1 && /Stick/.test(meldungen[0]) && /Kaputt/.test(meldungen[0]), meldungen);
  }

  console.log('Verschieben überschreibt nichts');
  {
    const quelle = lies('main.js');
    const fsVerpackt = Object.create(fs);
    const ctx = { fs: fsVerpackt, path, Error,
      pfadSchluessel: (p) => path.resolve(p).toLowerCase() };
    vm.createContext(ctx);
    vm.runInContext(extract(quelle, 'function freierDateiPfad(')
      + extract(quelle, 'function verschiebeDatei('), ctx);

    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwells-verschieben-'));
    const a = path.join(ordner, 'a.jrnl');
    const ziel = path.join(ordner, 'ziel', 'heft.jrnl');
    fs.mkdirSync(path.dirname(ziel));

    fs.writeFileSync(a, 'NEU');
    fs.writeFileSync(ziel, 'VORHANDEN');
    const erg = ctx.verschiebeDatei(a, ziel);
    pruefe('Die vorhandene Datei bleibt unberührt', fs.readFileSync(ziel, 'utf8') === 'VORHANDEN');
    pruefe('Das Heft bekommt einen freien Namen', path.basename(erg) === 'heft (2).jrnl', erg);
    pruefe('Und ist dort angekommen', fs.readFileSync(erg, 'utf8') === 'NEU' && !fs.existsSync(a));

    // Zwischen zwei Laufwerken: rename scheitert beim ersten Versuch
    const b = path.join(ordner, 'b.jrnl');
    const zielB = path.join(ordner, 'ziel', 'anderes.jrnl');
    fs.writeFileSync(b, 'INHALT');
    let ersterVersuch = true;
    fsVerpackt.renameSync = (x, y) => {
      if (ersterVersuch) { ersterVersuch = false; const e = new Error('EXDEV'); e.code = 'EXDEV'; throw e; }
      return fs.renameSync(x, y);
    };
    const ergB = ctx.verschiebeDatei(b, zielB);
    delete fsVerpackt.renameSync;
    pruefe('Zwischen Laufwerken kommt die Datei an', ergB === zielB && fs.readFileSync(zielB, 'utf8') === 'INHALT');
    pruefe('Erst danach verschwindet die Quelle', !fs.existsSync(b));
    pruefe('Keine Zwischendatei bleibt liegen', !fs.existsSync(zielB + '.tmp'));

    // Scheitert die Kopie, bleibt die Quelle
    const c = path.join(ordner, 'c.jrnl');
    fs.writeFileSync(c, 'WICHTIG');
    fsVerpackt.renameSync = () => { const e = new Error('EXDEV'); e.code = 'EXDEV'; throw e; };
    fsVerpackt.copyFileSync = () => { throw new Error('Platte voll'); };
    let geworfen = false;
    try { ctx.verschiebeDatei(c, path.join(ordner, 'ziel', 'c.jrnl')); } catch (e) { geworfen = true; }
    delete fsVerpackt.renameSync; delete fsVerpackt.copyFileSync;
    pruefe('Scheitert die Kopie, bleibt die Quelle liegen', geworfen && fs.readFileSync(c, 'utf8') === 'WICHTIG');

    fs.rmSync(ordner, { recursive: true, force: true });
  }

  console.log('Die Erlaubnis gehört dem Hauptprozess');
  {
    const quelle = lies('main.js');
    pruefe('Die Oberfläche kommt nicht an die Listen',
      /if \(istNurFuerDenHauptprozess\(filePath\)\) return false;/.test(quelle));
    pruefe('Eine geöffnete Datei bleibt über den Neustart erlaubt',
      /fs\.writeFileSync\(dateienPfad/.test(quelle));
  }

  if (fehler) { console.error(fehler + ' Pruefung(en) fehlgeschlagen.'); process.exit(1); }
  console.log('Alle Pruefungen bestanden.');
})().catch(err => { console.error(err); process.exit(1); });
