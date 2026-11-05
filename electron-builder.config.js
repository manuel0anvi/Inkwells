const os = require('os');
const path = require('path');

const outputDir = path.join(os.homedir(), 'AppData', 'Local', 'Inkwells', 'dist');

/* ── Store-Bau (MSIX/appx) ────────────────────────────────────────────
   Der gewoehnliche "npm run build" baut wie bisher NUR den
   NSIS-Installierer. Das Store-Paket entsteht mit "npm run build-store"
   und setzt dafuer INKWELLS_STORE.

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
const STORE = process.env.INKWELLS_STORE === '1';

const APPX_IDENTITY = {
  identityName: 'Inkwells.Inkwells',
  publisher: 'CN=641C6486-C859-4269-92DA-078D86AB80F1',
  publisherDisplayName: 'Inkwells'
};

module.exports = {
  appId: 'com.inkwells.app',
  productName: 'Inkwells',
  icon: 'icon.ico',
  win: {
    target: STORE
      ? [{ target: 'appx', arch: ['x64'] }]
      : [{ target: 'nsis', arch: ['x64'] }],
    icon: 'icon.ico',
    fileAssociations: [
      {
        ext: 'jrnl',
        name: 'Inkwells Notebook',
        description: 'Inkwells Notebook File',
        icon: 'icon.ico',
        role: 'Editor'
      }
    ]
  },
  /* ── Der Installierer muss die ALTE Installation finden ─────────────
     >>> Warum hier eine feste Kennung steht <<<
     electron-builder leitet die Kennung, unter der Windows eine
     Installation fuehrt, aus der appId ab (UUID v5, Namensraum
     50e065bc-3134-11e6-9bab-38c9862bdaf3 - siehe ELECTRON_BUILDER_NS_UUID
     in app-builder-lib/out/targets/nsis/NsisTarget.js). Die appId hiess
     bis einschliesslich 1.1.1 "com.inkwell.app" und heisst seit der
     Umbenennung "com.inkwells.app" - zwei verschiedene Kennungen:

         com.inkwell.app   347a11a8-8881-56e0-8e18-ec105f5fe2ad
         com.inkwells.app  9b6bb7d6-2201-5483-b1a3-83bb76ea7ff3

     Dass die veroeffentlichte 1.1.1 die ERSTE traegt, sagt ihr eigener
     Dateiname: sie heisst "Inkwell.Setup.1.1.1.exe", stammt also von vor
     der Umbenennung - die aendert appId und productName zusammen.

     Ohne diese Zeile faende der Installierer die vorhandene Fassung
     nicht und legte eine ZWEITE daneben: "Inkwell" bliebe stehen,
     "Inkwells" kaeme dazu, zwei Eintraege in der App-Liste, zwei
     Verknuepfungen. Und weil die neue Fassung beim Start den Datenordner
     umbenennt (migriereAltenDatenordner in main.js), startete die alte
     danach mit leeren Einstellungen.

     Eingetragen ist deshalb die Kennung der ALTEN appId. Sie bleibt in
     alle Zukunft stehen - sie ist jetzt die Kennung dieser App, und ein
     Wechsel wuerde denselben Bruch ein zweites Mal ausloesen.

     >>> Auf den Entwicklerrechnern einmal von Hand aufraeumen <<<
     Wer hier schon eine SELBST gebaute Fassung nach der Umbenennung
     installiert hat, fuehrt sie unter der zweiten Kennung. Die findet
     der neue Installierer nicht - dort bleibt der alte Eintrag
     "Inkwells 1.1.1" stehen und muss einmal von Hand deinstalliert
     werden. Nutzer draussen trifft das nicht, die kommen alle von der
     veroeffentlichten 1.1.1. */
  nsis: {
    guid: '347a11a8-8881-56e0-8e18-ec105f5fe2ad',
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

     >>> Warum die App "Inkwells" heisst und nicht "Inkwell" <<<
     "Inkwell" war im Store schon vergeben. Partner Center prueft beim
     Hochladen, ob der Anzeigename im Paket zu einem reservierten Namen
     passt - deshalb hiess zuerst nur der Store-Eintrag so.

     Inzwischen traegt die ganze App den Namen: Programmdatei, Datenordner,
     Protokoll, appId. Wer von einer aelteren Fassung kommt, wird beim
     Start umgezogen (migriereAltenDatenordner in main.js). */
  appx: {
    ...APPX_IDENTITY,
    applicationId: 'Inkwells',
    displayName: 'Inkwells',
    backgroundColor: '#0c0e18',
    languages: ['de-DE', 'en-US', 'it-IT'],
    artifactName: 'Inkwells ${version}.${ext}'
  },
  // node_modules steht hier bewusst NICHT.
  //
  // electron-builder nimmt die Laufzeit-Abhaengigkeiten von sich aus mit
  // und laesst die devDependencies weg. Ein ausdrueckliches Muster ueber
  // node_modules hebt genau diese Filterung auf - firebase, esbuild, yjs
  // und electron-builder selbst wanderten dadurch mit in den Installer,
  // obwohl die App keine davon zur Laufzeit braucht.
  /* ══════════════════════════════════════════════════════════════════
     WAS MIT INS PAKET GEHT – UND WAS DAS BEDEUTET

     Das Muster ueber src/ nimmt auch src/core/cloudConfig.local.js mit, und in der
     steht das Google-Client-Secret. Es ist damit in der ausgelieferten
     .exe auslesbar.

     Das ist KEIN Versehen, sondern der Preis fuer die dauerhafte
     Anmeldung: ohne Secret gibt Google kein Refresh-Token, und die
     Google-Sitzung muesste stuendlich erneuert werden. Die Abwaegung
     steht ausfuehrlich in src/core/cloudConfig.js.

     Was daran wichtig ist: dass es eine ENTSCHEIDUNG bleibt und nicht
     ein Nebeneffekt eines Musters. scripts/build-release.js sagt
     deshalb vor jedem Bau laut, ob ein Secret mitgeht. Wer es NICHT
     ausliefern will, nimmt die Zeile unten wieder hinein – die App
     laeuft dann weiter, nur eben mit stuendlicher Neuanmeldung.
     ══════════════════════════════════════════════════════════════════ */
  /* ── Was das ausgelieferte Programm nicht mehr kann ─────────────────
     Mit diesen Schaltern liesse sich die signierte oder installierte
     Inkwells.exe als beliebiger Node-Interpreter benutzen oder von aussen
     einsehen. Die App selbst braucht nichts davon; die Prüfstände laufen über
     das ungepackte Electron und sind davon nicht betroffen. */
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true
  },
  files: [
    'main.js',
    'preload.js',
    'src/**/*',
    // '!src/core/cloudConfig.local.js',   // <- ohne dauerhafte Google-Sitzung
    'icon.ico'
  ],
  directories: {
    output: outputDir
  }
};