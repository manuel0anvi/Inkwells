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
      `Inkwells Setup ${packageJson.version}.exe.blockmap`
    ];

execFileSync(process.execPath, [electronBuilderCli, '--config', 'electron-builder.config.js', '--win', '--x64'], {
  cwd: rootDir,
  stdio: 'inherit'
});

fs.mkdirSync(targetDir, { recursive: true });

for (const artifact of artifacts) {
  const sourcePath = path.join(sourceDir, artifact);
  const targetPath = path.join(targetDir, artifact);

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

console.log(`Copied release artifacts to ${targetDir}`);