const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/* Store-Bau: "node scripts/build-release.js --store" oder npm run build-store.
   Die Umgebungsvariable MUSS vor dem require der Konfiguration stehen -
   die entscheidet beim Laden, welches Ziel gebaut wird. Und sie wird an
   electron-builder weitergereicht, das die Datei ein zweites Mal liest. */
const STORE = process.argv.includes('--store');
if (STORE) process.env.INKWELLS_STORE = '1';

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'electron-builder.config.js');
const config = require(configPath);

/* Ohne die Kennungen aus Partner Center weist der Store das Paket stumm
   zurueck - erst nach dem Hochladen, nach Minuten Wartezeit. Lieber
   sofort hier abbrechen und sagen, wo die Werte herkommen. */
if (STORE) {
  const fehlend = Object.entries(config.appx)
    .filter(([, wert]) => typeof wert === 'string' && wert.includes('PLATZHALTER'))
    .map(([name]) => name);

  if (fehlend.length) {
    console.error('');
    console.error('Store-Bau nicht moeglich: ' + fehlend.join(', ') + ' noch nicht gesetzt.');
    console.error('Die Werte stehen in Partner Center unter "Produktidentitaet",');
    console.error('sobald der App-Name reserviert ist. Eintragen in');
    console.error('electron-builder.config.js -> APPX_IDENTITY.');
    console.error('');
    process.exit(1);
  }
}
/* ══════════════════════════════════════════════════════════════════════
   EIN GEHEIMNIS GEHT NICHT UNBEMERKT MIT

   src/core/cloudConfig.local.js traegt das Google-Client-Secret und wird
   vom Muster ueber src/ mit ins Paket genommen. Das ist so gewollt (die
   Abwaegung steht in src/core/cloudConfig.js), darf aber niemandem
   entgehen, der ein Release baut – am wenigsten auf einem fremden
   Rechner, auf dem zufaellig eine solche Datei liegt.

   Gelesen wird nur, OB ein Wert darinsteht. Der Wert selbst erscheint
   nirgends: diese Ausgabe landet im Terminal, in Bildschirmfotos und in
   Fehlerberichten.
   ══════════════════════════════════════════════════════════════════════ */
function meldeGeheimnis() {
  const datei = path.join(rootDir, 'src', 'core', 'cloudConfig.local.js');
  const ausgeschlossen = (config.files || []).some(m =>
    typeof m === 'string' && m.replace(/\\/g, '/').includes('!src/core/cloudConfig.local.js'));

  if (!fs.existsSync(datei)) {
    console.log('[Bau] Kein cloudConfig.local.js – die Google-Sitzung haelt eine Stunde.');
    return;
  }

  const gesetzt = /GOOGLE_CLIENT_SECRET_LOCAL\s*=\s*['"][^'"]+['"]/.test(
    fs.readFileSync(datei, 'utf-8'));

  if (!gesetzt) {
    console.log('[Bau] cloudConfig.local.js ist leer – die Google-Sitzung haelt eine Stunde.');
    return;
  }

  if (ausgeschlossen) {
    console.log('[Bau] Ein Client-Secret liegt vor, ist aber vom Paket ausgeschlossen.');
    console.log('      Die Google-Sitzung haelt in der ausgelieferten App eine Stunde.');
    return;
  }

  console.log('');
  console.log('  ================================================================');
  console.log('   Das Google-Client-Secret GEHT MIT ins Paket.');
  console.log('   In der ausgelieferten .exe ist es auslesbar.');
  console.log('');
  console.log('   So ist es gemeint: ohne Secret gibt Google kein Refresh-Token,');
  console.log('   und die Anmeldung hielte nur eine Stunde. Die Abwaegung steht');
  console.log('   in src/core/cloudConfig.js.');
  console.log('');
  console.log('   Nicht gewollt? Dann in electron-builder.config.js die Zeile');
  console.log('   !src/core/cloudConfig.local.js hereinnehmen.');
  console.log('  ================================================================');
  console.log('');
}

meldeGeheimnis();

const sourceDir = config.directories.output;
const targetDir = path.join(rootDir, 'dist');
const packageJson = require(path.join(rootDir, 'package.json'));
const electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js');
/* latest.yml stand hier und wurde nie erzeugt: dafuer braeuchte
   electron-builder eine publish-Angabe, und die gibt es nicht. Gelesen
   wuerde es ohnehin nie – der Updater in main.js fragt die
   GitHub-Releases-API und laedt die .exe unmittelbar. */
const artifacts = STORE
  ? [`Inkwells ${packageJson.version}.appx`]
  : [
      `Inkwells Setup ${packageJson.version}.exe`,
      `Inkwells Setup ${packageJson.version}.exe.blockmap`,
      // Ohne sie nimmt die installierte App das Update nicht an (main.js)
      `Inkwells Setup ${packageJson.version}.exe.sig`
    ];

execFileSync(process.execPath, [electronBuilderCli, '--config', 'electron-builder.config.js', '--win', '--x64'], {
  cwd: rootDir,
  stdio: 'inherit'
});

if (!STORE) {
  require('./update-signatur.js').unterschreibe(
    path.join(sourceDir, `Inkwells Setup ${packageJson.version}.exe`), packageJson.version);
}

fs.mkdirSync(targetDir, { recursive: true });

for (const artifact of artifacts) {
  const sourcePath = path.join(sourceDir, artifact);
  const targetPath = path.join(targetDir, artifact);

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

console.log(`Copied release artifacts to ${targetDir}`);