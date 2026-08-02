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
  files: [
    'main.js',
    'preload.js',
    'src/**/*',
    'node_modules/**/*',
    'icon.ico'
  ],
  directories: {
    output: outputDir
  }
};