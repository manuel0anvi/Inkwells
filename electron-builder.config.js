const os = require('os');
const path = require('path');

const outputDir = path.join(os.homedir(), 'AppData', 'Local', 'Inkwell', 'dist');

/* ── Store-Bau (MSIX/appx) ────────────────────────────────────────────
   Der gewoehnliche "npm run build" baut wie bisher NUR den
   NSIS-Installierer. Das Store-Paket entsteht mit "npm run build-store"
   und setzt dafuer INKWELL_STORE.

   Warum getrennt: das MSIX ist ohne die drei Kennungen unten wertlos,
   und wer nur schnell eine Fassung zum Weitergeben braucht, soll nicht
   jedes Mal auf ein Paket warten, das er gar nicht hochlaedt.

   >>> DIE DREI KENNUNGEN STAMMEN AUS PARTNER CENTER <<<
   Sie stehen dort unter "Produktidentitaet", nachdem der Name reserviert
   ist. Ohne sie lehnt der Store das Paket ab - es sind keine Geheimnisse,
   sie stehen spaeter oeffentlich in der Store-Eintragung.

       identityName          -> Package/Identity/Name
       publisher             -> Package/Identity/Publisher
       publisherDisplayName  -> Package/Properties/PublisherDisplayName

   scripts/build-release.js bricht ab, solange hier noch PLATZHALTER
   steht - sonst entstuende ein Paket, das der Store stumm zurueckweist. */
const STORE = process.env.INKWELL_STORE === '1';

const APPX_IDENTITY = {
  identityName: 'PLATZHALTER.Inkwell',
  publisher: 'CN=PLATZHALTER',
  publisherDisplayName: 'PLATZHALTER'
};

module.exports = {
  appId: 'com.inkwell.app',
  productName: 'Inkwell',
  icon: 'icon.ico',
  win: {
    target: STORE
      ? [{ target: 'appx', arch: ['x64'] }]
      : [{ target: 'nsis', arch: ['x64'] }],
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

  /* ── Das Store-Paket ────────────────────────────────────────────────
     backgroundColor faerbt die Kachel HINTER dem Zeichen. Die Bilder in
     build/appx/ sind durchsichtig freigestellt (scripts/make-icons.js),
     ohne diese Farbe stuende das Gold auf Weiss und verschwaende fast.

     languages: die App spricht diese drei, siehe website/js/i18n.js.
     Der Store zeigt die Eintragung danach in den passenden Maerkten.

     >>> Warum displayName "Inkwells" heisst und productName "Inkwell" <<<
     "Inkwell" war im Store schon vergeben, reserviert ist "Inkwells".
     Partner Center prueft beim Hochladen, ob der Anzeigename im Paket zu
     einem reservierten Namen passt - sonst wird es abgelehnt.

     Der Unterschied ist Absicht und KEIN Versehen: productName steckt im
     Dateinamen, im Programmordner und in der Kennung der Installation.
     Ihn mitzuziehen haette Folgen fuer alle, die schon installiert haben.
     Die App umzubenennen ist ein eigener Schritt fuer spaeter. */
  appx: {
    ...APPX_IDENTITY,
    applicationId: 'Inkwell',
    displayName: 'Inkwells',
    backgroundColor: '#0c0e18',
    languages: ['de-DE', 'en-US', 'it-IT'],
    artifactName: 'Inkwell ${version}.${ext}'
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