const os = require('os');
const path = require('path');

const outputDir = path.join(os.homedir(), 'AppData', 'Local', 'Inkwell', 'dist');

module.exports = {
  appId: 'com.inkwell.app',
  productName: 'Inkwell',
  icon: 'icon.ico',
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    icon: 'icon.ico',
    fileAssociations: [
      {
        ext: 'jrnl',
        name: 'Inkwell Notebook',
        description: 'Inkwell Notebook File',
        icon: 'icon.ico',
        role: 'Editor'
      }
    ]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    perMachine: false
  },
  // node_modules steht hier bewusst NICHT.
  //
  // electron-builder nimmt die Laufzeit-Abhaengigkeiten von sich aus mit
  // und laesst die devDependencies weg. Ein ausdrueckliches Muster ueber
  // node_modules hebt genau diese Filterung auf - firebase, esbuild, yjs
  // und electron-builder selbst wanderten dadurch mit in den Installer,
  // obwohl die App keine davon zur Laufzeit braucht.
  files: [
    'main.js',
    'preload.js',
    'src/**/*',
    'icon.ico'
  ],
  directories: {
    output: outputDir
  }
};