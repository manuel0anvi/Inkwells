/* ══════════════════════════════════════════════════════════════════════
   Inhalt der Datenschutzseite – alle drei Sprachen an einer Stelle.
   Wird von datenschutz/index.html gerendert.

   Bausteine pro Abschnitt:
     { h: 'Überschrift', p: ['Absatz', …], ul: ['Punkt', …],
       table: { head: [...], rows: [[...], …] }, note: 'Hinweiskasten' }
   Alle Felder außer h sind optional und können kombiniert werden.
   ══════════════════════════════════════════════════════════════════════ */

const PRIVACY_UPDATED = '2026-07-31';

const PRIVACY = {
  de: {
    title: 'Datenschutz',
    subtitle: 'Was Inkwell speichert, was nicht, und wo deine Notizen wirklich liegen.',
    updatedLabel: 'Stand',
    summaryTitle: 'Das Wichtigste in Kürze',
    summary: [
      ['Deine Notizen', 'Liegen als Dateien auf deinem Rechner. Wir sehen sie nie.'],
      ['Cloud-Sicherung', 'Freiwillig. Geht in dein eigenes Google Drive oder OneDrive, nicht auf unsere Server.'],
      ['Konto', 'Anmeldung mit Google oder Microsoft. Kein Passwort, keine Nutzerdatenbank bei uns.'],
      ['Tracking', 'Keines. Keine Analyse-Werkzeuge, keine Werbung, keine Werbe-Cookies.'],
      ['Weitergabe', 'Wir verkaufen und teilen keine Daten.']
    ],
    sections: [
      {
        h: '1. Wer hinter Inkwell steht',
        p: [
          'Inkwell ist ein privates, quelloffenes Projekt und wird nicht kommerziell betrieben. Es gibt keine Firma, keine Werbevermarktung und keine Weitergabe von Daten an Dritte zu Werbezwecken.',
          'Fragen zum Datenschutz, Auskunftswünsche und Löschanfragen richtest du am einfachsten als Issue an das öffentliche Projekt-Repository auf GitHub. Dort werden sie bearbeitet.'
        ],
        links: [
          { label: 'github.com/manuel0anvi/Inkwell', href: 'https://github.com/manuel0anvi/Inkwell' }
        ]
      },
      {
        h: '2. Deine Notizen bleiben bei dir',
        p: [
          'Alle Notizbücher, Handschrift, eingefügten Bilder und importierten PDFs werden als gewöhnliche Dateien in einem Ordner gespeichert, den du beim ersten Start selbst auswählst. Standardmäßig verlassen diese Dateien deinen Rechner nie.',
          'Auch die Einstellungen der App (Sprache, Speicherort, Auto-Speichern) liegen ausschließlich lokal in einer Datei auf deinem Gerät.',
          'Wir betreiben keinen Server, auf dem Notizbücher liegen. Es gibt schlicht keinen Ort bei uns, an dem deine Inhalte gespeichert werden könnten.'
        ]
      },
      {
        h: '3. Anmeldung mit Google oder Microsoft',
        p: [
          'Inkwell hat keine eigene Nutzerverwaltung. Es gibt keine Registrierung mit E-Mail und Passwort und keine Passwort-Datenbank. Die Anmeldung läuft ausschließlich über dein bestehendes Google- oder Microsoft-Konto.',
          'Bei der Anmeldung fragt Inkwell diese Berechtigungen an:'
        ],
        ul: [
          '<strong>Google (openid, email, profile, drive.file):</strong> Identifikation (Profil-ID, E-Mail-Adresse, Name, Profilbild) und Zugriff ausschließlich auf die Dateien, die Inkwell selbst in deinem Google Drive anlegt.',
          '<strong>Microsoft (User.Read, Files.ReadWrite, offline_access):</strong> Identifikation (Profil-ID, E-Mail-Adresse, Name) sowie Lese- und Schreibzugriff auf den von Inkwell genutzten Speicherbereich in deinem OneDrive.'
        ],
        p2: [
          'Die erhaltenen Angaben (Profil-ID, E-Mail, Name, Profilbild-Adresse) sowie die zeitlich begrenzten Zugriffstokens werden nur lokal gespeichert: in der App in der Einstellungsdatei, auf der Website im localStorage deines Browsers. Sie werden an niemanden weitergeleitet.',
          'Ein Zugriffstoken ist zeitlich begrenzt gültig. Beim Abmelden wird es gelöscht und der Zugriff beim jeweiligen Anbieter zurückgezogen.'
        ]
      },
      {
        h: '4. Cloud-Sicherung über Google Drive oder OneDrive',
        p: [
          'Die Cloud-Sicherung ist freiwillig und standardmäßig aus. Schaltest du sie ein, werden deine Notizbücher als JSON-Dateien in deinem eigenen Google Drive oder OneDrive im Ordner „Inkwell“ abgelegt.',
          'Das bedeutet: Die Daten liegen in deinem Google- oder Microsoft-Konto, unter deiner Kontrolle, und zählen auf deinen jeweiligen Speicherplatz. Sie laufen zu keinem Zeitpunkt über einen Server von uns. Für die Verarbeitung gelten die Datenschutzerklärungen von Google bzw. Microsoft.',
          'Du kannst die Sicherung jederzeit in der App abschalten, den Ordner „Inkwell“ in deinem Cloud-Speicher löschen und Inkwell in deinem Google- oder Microsoft-Konto den Zugriff entziehen. Deine lokalen Notizbücher bleiben dabei unberührt.'
        ],
        links: [
          { label: 'Google-Zugriff verwalten und entziehen', href: 'https://myaccount.google.com/permissions' },
          { label: 'Datenschutzerklärung von Google', href: 'https://policies.google.com/privacy' },
          { label: 'Microsoft-Zugriff verwalten und entziehen', href: 'https://account.live.com/consent/Manage' },
          { label: 'Datenschutzerklärung von Microsoft', href: 'https://privacy.microsoft.com/privacystatement' }
        ]
      },
      {
        h: '5. Diese Website',
        p: [
          'Die Website wird über GitHub Pages ausgeliefert. Beim Aufruf verarbeitet GitHub technisch notwendige Verbindungsdaten wie IP-Adresse, Zeitpunkt, aufgerufene Adresse und Browserkennung, um die Seite überhaupt senden zu können. Darauf haben wir keinen Zugriff.',
          'Auf dieser Website gibt es keine Cookies, keine Analyse-Werkzeuge, keine Zählpixel und keine Werbenetzwerke. Wir werten dein Verhalten auf der Seite nicht aus.',
          'Gespeichert wird nur, was für die Bedienung nötig ist – ausschließlich im Speicher deines eigenen Browsers (localStorage), nicht auf einem Server:'
        ],
        table: {
          head: ['Gespeichert wird', 'Wofür', 'Wie lange'],
          rows: [
            ['Gewählte Sprache', 'Damit die Seite beim nächsten Besuch in deiner Sprache erscheint', 'Bis du den Browser-Speicher leerst'],
            ['Google / Microsoft Zugriffstoken', 'Damit das Dashboard deine Notizbücher aus Drive oder OneDrive laden kann', 'Etwa 1 Stunde (automatische Erneuerung möglich)'],
            ['E-Mail, Name, Profil-ID, Profilbild-Adresse', 'Anzeige des angemeldeten Kontos', 'Bis zur Abmeldung'],
            ['Autorenname im Forum', 'Damit du ihn nicht bei jedem Beitrag neu eintippen musst', 'Bis du den Browser-Speicher leerst']
          ]
        },
        note: 'Mit „Abmelden“ werden alle diese Einträge bis auf die Spracheinstellung gelöscht.'
      },
      {
        h: '6. Eingebundene externe Dienste',
        p: [
          'So wenig wie möglich, aber nicht null. Diese Dienste werden beim Aufruf kontaktiert und erhalten dabei technisch zwangsläufig deine IP-Adresse:'
        ],
        table: {
          head: ['Dienst', 'Wozu', 'Wo'],
          rows: [
            ['Google Fonts', 'Schriftarten der Website', 'Website'],
            ['Google Identity / Drive API', 'Anmeldung und Zugriff auf deinen Inkwell-Ordner in Drive', 'Website und App, nur bei Google-Anmeldung'],
            ['Microsoft Identity / Graph API', 'Anmeldung und Zugriff auf deinen Inkwell-Ordner in OneDrive', 'Website und App, nur bei Microsoft-Anmeldung'],
            ['GitHub', 'Auslieferung der Website, Liste der Downloads, Prüfung auf App-Updates', 'Website und App'],
            ['Google Firebase (Cloud Firestore)', 'Datenbank für die Beiträge im Community-Forum', 'Nur die Forumsseite']
          ]
        },
        note: 'Diese Dienste werden nicht zum Wiedererkennen oder Beobachten von Besuchern eingesetzt.'
      },
      {
        h: '7. Update-Prüfung in der App',
        p: [
          'Die Desktop-App fragt bei GitHub nach, ob eine neuere Version vorliegt, und lädt auf deinen Wunsch das Installationsprogramm herunter. Dabei wird ausschließlich die öffentliche Versionsliste abgerufen. Es werden keine Angaben über dich, dein Gerät oder deine Notizen übermittelt.'
        ]
      },
      {
        h: '8. Community-Forum',
        p: [
          'Beiträge und Antworten im Forum werden in einer Datenbank bei Google Firebase (Cloud Firestore) gespeichert. Sie sind für alle Besucherinnen und Besucher öffentlich lesbar – auch ohne Anmeldung.',
          'Gespeichert werden der von dir angegebene Name beziehungsweise dein Pseudonym, Titel und Text des Beitrags sowie der Zeitpunkt. Du kannst auch anonym schreiben; dann wird kein Name gespeichert. Bist du angemeldet, wird dein Google- oder Microsoft-Anzeigename vorgeschlagen – du kannst ihn überschreiben.',
          'Bitte schreibe keine persönlichen oder vertraulichen Angaben in öffentliche Beiträge. Soll ein Beitrag gelöscht werden, melde dich über das GitHub-Repository.',
          'Freigegebene Hefte: Gibst du ein Heft über einen Link frei, wird eine Lesekopie bei Google Firebase (Cloud Firestore) abgelegt. Jeder, der den Link kennt, kann sie ohne Anmeldung ansehen — die Kennung im Link ist zufällig und nicht erratbar, die Seite ist für Suchmaschinen gesperrt. Die Kopie enthält den gesamten Inhalt des Hefts, auch eingefügte Bilder und PDF-Seiten. Du kannst die Freigabe jederzeit in der App oder im Dashboard aufheben; die Kopie wird dann gelöscht und der Link führt ins Leere.'
        ]
      },
      {
        h: '9. Deine Rechte',
        p: [
          'Nach der Datenschutz-Grundverordnung hast du das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren.',
          'Vieles davon kannst du unmittelbar selbst umsetzen, ohne uns fragen zu müssen:'
        ],
        ul: [
          '<strong>Auskunft und Übertragbarkeit:</strong> Deine Notizbücher liegen bereits als lesbare Dateien bei dir und in deinem Cloud-Ordner „Inkwell“ (Drive / OneDrive) – du kannst sie jederzeit kopieren.',
          '<strong>Löschung:</strong> Lokale Dateien löschen, den Ordner „Inkwell“ in Google Drive oder OneDrive löschen, in der App abmelden.',
          '<strong>Widerruf der Einwilligung:</strong> Cloud-Sicherung ausschalten und Inkwell in deinen Google- oder Microsoft-Kontoeinstellungen den Zugriff entziehen.',
          '<strong>Forumsbeiträge:</strong> Löschung über das GitHub-Repository anfragen.'
        ]
      },
      {
        h: '10. Aufbewahrung',
        p: [
          'Wir bewahren nichts auf, weil wir nichts erheben. Notizbücher bleiben so lange bestehen, wie du sie auf deinem Gerät und in deiner Cloud behältst. Öffentliche Forumsbeiträge bleiben, bis du ihre Löschung anfragst.'
        ]
      },
      {
        h: '11. Kinder',
        p: [
          'Inkwell richtet sich nicht gezielt an Kinder unter 16 Jahren. Da wir keine Daten über Nutzerinnen und Nutzer sammeln, werden auch keine Daten von Kindern erhoben. Für die Anmeldung mit Google oder Microsoft gelten zusätzlich die Altersgrenzen der jeweiligen Anbieter.'
        ]
      },
      {
        h: '12. Änderungen',
        p: [
          'Ändert sich die Funktionsweise von Inkwell, wird diese Seite angepasst. Der jeweils aktuelle Stand ist oben angegeben. Die Änderungshistorie ist im öffentlichen Repository nachvollziehbar.'
        ]
      }
    ]
  },

  en: {
    title: 'Privacy',
    subtitle: 'What Inkwell stores, what it does not, and where your notes actually live.',
    updatedLabel: 'Last updated',
    summaryTitle: 'The short version',
    summary: [
      ['Your notes', 'Stored as files on your own computer. We never see them.'],
      ['Cloud backup', 'Optional. Goes to your own Google Drive or OneDrive, not to our servers.'],
      ['Account', 'Sign in with Google or Microsoft. No password, no user database on our side.'],
      ['Tracking', 'None. No analytics, no ads, no advertising cookies.'],
      ['Sharing', 'We do not sell or share your data.']
    ],
    sections: [
      {
        h: '1. Who is behind Inkwell',
        p: [
          'Inkwell is a private, open-source project and is not run commercially. There is no company, no ad business and no sharing of data with third parties for advertising.',
          'For privacy questions, access requests and deletion requests, the simplest route is to open an issue on the public project repository on GitHub, where they are handled.'
        ],
        links: [
          { label: 'github.com/manuel0anvi/Inkwell', href: 'https://github.com/manuel0anvi/Inkwell' }
        ]
      },
      {
        h: '2. Your notes stay with you',
        p: [
          'All notebooks, handwriting, inserted images and imported PDFs are stored as ordinary files in a folder you pick yourself on first launch. By default these files never leave your computer.',
          'App settings (language, storage location, auto-save) are likewise kept only in a local file on your device.',
          'We do not operate a server that holds notebooks. There is simply no place on our side where your content could be stored.'
        ]
      },
      {
        h: '3. Signing in with Google or Microsoft',
        p: [
          'Inkwell has no user management of its own. There is no email-and-password registration and no password database. Signing in works exclusively through your existing Google or Microsoft account.',
          'During sign-in Inkwell requests these permissions:'
        ],
        ul: [
          '<strong>Google (openid, email, profile, drive.file):</strong> identification (profile ID, email address, display name, profile picture) and access restricted exclusively to files created by Inkwell in your Google Drive.',
          '<strong>Microsoft (User.Read, Files.ReadWrite, offline_access):</strong> identification (profile ID, email address, display name) as well as read and write access to the Inkwell folder in your OneDrive.'
        ],
        p2: [
          'The information received (profile ID, email, name, profile picture URL) and the time-limited access tokens are stored locally only: in the app inside the settings file, on the website in your browser\'s localStorage. They are not forwarded to anyone.',
          'Access tokens are valid for a limited time. Signing out deletes them and revokes access with the respective provider.'
        ]
      },
      {
        h: '4. Cloud backup via Google Drive or OneDrive',
        p: [
          'Cloud backup is optional and off by default. If you turn it on, your notebooks are stored as JSON files in your own Google Drive or OneDrive inside the "Inkwell" folder.',
          'That means the data sits in your Google or Microsoft account, under your control, and counts against your storage. It never passes through a server of ours. Processing is governed by Google\'s or Microsoft\'s privacy policy.',
          'You can turn the backup off at any time, delete the "Inkwell" folder in your cloud storage and revoke Inkwell\'s access in your Google or Microsoft account. Your local notebooks are untouched by this.'
        ],
        links: [
          { label: 'Manage and revoke Google access', href: 'https://myaccount.google.com/permissions' },
          { label: 'Google privacy policy', href: 'https://policies.google.com/privacy' },
          { label: 'Manage and revoke Microsoft access', href: 'https://account.live.com/consent/Manage' },
          { label: 'Microsoft privacy policy', href: 'https://privacy.microsoft.com/privacystatement' }
        ]
      },
      {
        h: '5. This website',
        p: [
          'The website is served through GitHub Pages. When you visit, GitHub processes technically necessary connection data such as IP address, timestamp, requested address and browser identifier in order to deliver the page at all. We have no access to it.',
          'This website uses no cookies, no analytics tools, no tracking pixels and no ad networks. We do not evaluate your behaviour on the site.',
          'Only what is needed to operate the site is stored — exclusively in your own browser (localStorage), not on a server:'
        ],
        table: {
          head: ['What is stored', 'What for', 'How long'],
          rows: [
            ['Selected language', 'So the site appears in your language next time', 'Until you clear browser storage'],
            ['Google / Microsoft access token', 'So the dashboard can load your notebooks from Drive or OneDrive', 'About 1 hour (auto-renewable)'],
            ['Email, name, profile ID, profile picture URL', 'Showing the signed-in account', 'Until you sign out'],
            ['Forum author name', 'So you do not have to retype it for every post', 'Until you clear browser storage']
          ]
        },
        note: 'Signing out deletes all of these entries except the language setting.'
      },
      {
        h: '6. External services involved',
        p: [
          'As few as possible, but not zero. These services are contacted when you use the site and unavoidably receive your IP address:'
        ],
        table: {
          head: ['Service', 'Purpose', 'Where'],
          rows: [
            ['Google Fonts', 'Typefaces used on the website', 'Website'],
            ['Google Identity / Drive API', 'Sign-in and access to your Inkwell folder in Drive', 'Website and app, only when signing in with Google'],
            ['Microsoft Identity / Graph API', 'Sign-in and access to your Inkwell folder in OneDrive', 'Website and app, only when signing in with Microsoft'],
            ['GitHub', 'Serving the website, download list, checking for app updates', 'Website and app'],
            ['Google Firebase (Cloud Firestore)', 'Database for community forum posts', 'Forum page only']
          ]
        },
        note: 'None of these services are used to recognise or observe visitors.'
      },
      {
        h: '7. Update check in the app',
        p: [
          'The desktop app asks GitHub whether a newer version exists and, if you choose to, downloads the installer. Only the public release list is retrieved. No information about you, your device or your notes is transmitted.'
        ]
      },
      {
        h: '8. Community forum',
        p: [
          'Posts and replies in the forum are stored in a Google Firebase (Cloud Firestore) database. They are publicly readable by every visitor, including people who are not signed in.',
          'Stored are the name or pseudonym you enter, the title and body of the post, and the timestamp. You can also post anonymously, in which case no name is stored. If you are signed in, your Google or Microsoft display name is suggested — you can overwrite it.',
          'Please do not put personal or confidential information into public posts. To have a post removed, get in touch through the GitHub repository.',
          'Shared notebooks: If you share a notebook via link, a read-only copy is stored with Google Firebase (Cloud Firestore). Anyone who knows the link can view it without signing in — the identifier in the link is random and cannot be guessed, and the page is blocked from search engines. The copy contains the notebook in full, including inserted images and PDF pages. You can revoke the share at any time in the app or the dashboard; the copy is then deleted and the link stops working.'
        ]
      },
      {
        h: '9. Your rights',
        p: [
          'Under the GDPR you have the right to access, rectification, erasure, restriction of processing, data portability and objection. You may also lodge a complaint with a data protection supervisory authority.',
          'Much of this you can carry out yourself, without having to ask us:'
        ],
        ul: [
          '<strong>Access and portability:</strong> your notebooks already exist as readable files on your device and in your cloud "Inkwell" folder (Drive / OneDrive) — copy them whenever you like.',
          '<strong>Erasure:</strong> delete the local files, delete the "Inkwell" folder in Drive or OneDrive, sign out in the app.',
          '<strong>Withdrawing consent:</strong> turn off cloud backup and revoke Inkwell\'s access in your Google or Microsoft account settings.',
          '<strong>Forum posts:</strong> request removal through the GitHub repository.'
        ]
      },
      {
        h: '10. Retention',
        p: [
          'We retain nothing, because we collect nothing. Notebooks exist for as long as you keep them on your device and in your cloud storage. Public forum posts remain until you request their removal.'
        ]
      },
      {
        h: '11. Children',
        p: [
          'Inkwell is not specifically aimed at children under 16. Since we collect no data about users, no data about children is collected either. Google\'s and Microsoft\'s own age requirements additionally apply to signing in.'
        ]
      },
      {
        h: '12. Changes',
        p: [
          'If the way Inkwell works changes, this page is updated. The current version date is shown above. The history of changes can be followed in the public repository.'
        ]
      }
    ]
  },

  it: {
    title: 'Privacy',
    subtitle: 'Cosa salva Inkwell, cosa no e dove si trovano davvero i tuoi appunti.',
    updatedLabel: 'Ultimo aggiornamento',
    summaryTitle: 'In breve',
    summary: [
      ['I tuoi appunti', 'Sono file sul tuo computer. Noi non li vediamo mai.'],
      ['Backup cloud', 'Facoltativo. Va nel tuo Google Drive o OneDrive, non sui nostri server.'],
      ['Account', 'Accesso con Google o Microsoft. Nessuna password, nessun database utenti da parte nostra.'],
      ['Tracciamento', 'Nessuno. Niente analytics, niente pubblicità, niente cookie pubblicitari.'],
      ['Condivisione', 'Non vendiamo né condividiamo i tuoi dati.']
    ],
    sections: [
      {
        h: '1. Chi c\'è dietro Inkwell',
        p: [
          'Inkwell è un progetto privato e open source, non gestito a scopo commerciale. Non c\'è nessuna azienda, nessuna raccolta pubblicitaria e nessuna cessione di dati a terzi per scopi pubblicitari.',
          'Per domande sulla privacy, richieste di accesso e richieste di cancellazione il modo più semplice è aprire una issue nel repository pubblico del progetto su GitHub, dove vengono gestite.'
        ],
        links: [
          { label: 'github.com/manuel0anvi/Inkwell', href: 'https://github.com/manuel0anvi/Inkwell' }
        ]
      },
      {
        h: '2. I tuoi appunti restano tuoi',
        p: [
          'Tutti i quaderni, la scrittura a mano, le immagini inserite e i PDF importati vengono salvati come normali file in una cartella che scegli tu al primo avvio. Per impostazione predefinita questi file non lasciano mai il tuo computer.',
          'Anche le impostazioni dell\'app (lingua, percorso di salvataggio, salvataggio automatico) restano solo in un file locale sul tuo dispositivo.',
          'Non gestiamo alcun server su cui risiedano i quaderni. Semplicemente non esiste un posto da parte nostra in cui i tuoi contenuti potrebbero essere salvati.'
        ]
      },
      {
        h: '3. Accesso con Google o Microsoft',
        p: [
          'Inkwell non ha una propria gestione utenti. Non esiste registrazione con email e password né un database di password. L\'accesso avviene esclusivamente tramite il tuo account Google o Microsoft esistente.',
          'Durante l\'accesso Inkwell richiede queste autorizzazioni:'
        ],
        ul: [
          '<strong>Google (openid, email, profile, drive.file):</strong> identificazione (ID profilo, indirizzo email, nome visualizzato, immagine del profilo) e accesso limitato esclusivamente ai file creati da Inkwell nel tuo Google Drive.',
          '<strong>Microsoft (User.Read, Files.ReadWrite, offline_access):</strong> identificazione (ID profilo, indirizzo email, nome visualizzato) e accesso in lettura/scrittura alla cartella Inkwell nel tuo OneDrive.'
        ],
        p2: [
          'Le informazioni ricevute (ID profilo, email, nome, indirizzo dell\'immagine del profilo) e i token di accesso a tempo limitato vengono salvati solo localmente: nell\'app nel file delle impostazioni, sul sito nel localStorage del browser. Non vengono inoltrati a nessuno.',
          'I token di accesso sono validi per un tempo limitato. Disconnettendosi vengono eliminati e l\'accesso presso il rispettivo provider viene revocato.'
        ]
      },
      {
        h: '4. Backup cloud tramite Google Drive o OneDrive',
        p: [
          'Il backup cloud è facoltativo e disattivato di default. Se lo attivi, i tuoi quaderni vengono salvati come file JSON nel tuo Google Drive o OneDrive nella cartella "Inkwell".',
          'Ciò significa che i dati si trovano nel tuo account Google o Microsoft, sotto il tuo controllo, e occupano il tuo spazio di archiviazione. Non passano mai da un nostro server. Il trattamento è regolato dall\'informativa privacy di Google o Microsoft.',
          'Puoi disattivare il backup in qualsiasi momento, eliminare la cartella "Inkwell" nel tuo spazio cloud e revocare l\'accesso di Inkwell nel tuo account Google o Microsoft. I quaderni locali restano intatti.'
        ],
        links: [
          { label: 'Gestisci e revoca l\'accesso Google', href: 'https://myaccount.google.com/permissions' },
          { label: 'Informativa privacy di Google', href: 'https://policies.google.com/privacy' },
          { label: 'Gestisci e revoca l\'accesso Microsoft', href: 'https://account.live.com/consent/Manage' },
          { label: 'Informativa privacy di Microsoft', href: 'https://privacy.microsoft.com/privacystatement' }
        ]
      },
      {
        h: '5. Questo sito',
        p: [
          'Il sito è distribuito tramite GitHub Pages. Quando lo visiti, GitHub tratta dati di connessione tecnicamente necessari come indirizzo IP, orario, indirizzo richiesto e identificativo del browser, per poter inviare la pagina. Noi non vi abbiamo accesso.',
          'Questo sito non usa cookie, strumenti di analisi, pixel di tracciamento o reti pubblicitarie. Non analizziamo il tuo comportamento sul sito.',
          'Viene salvato solo ciò che serve al funzionamento — esclusivamente nel tuo browser (localStorage), non su un server:'
        ],
        table: {
          head: ['Cosa viene salvato', 'A cosa serve', 'Per quanto'],
          rows: [
            ['Lingua scelta', 'Per rivedere il sito nella tua lingua', 'Finché non svuoti la memoria del browser'],
            ['Token di accesso Google / Microsoft', 'Per permettere alla dashboard di caricare i quaderni da Drive o OneDrive', 'Circa 1 ora (rinnovo automatico)'],
            ['Email, nome, ID profilo, indirizzo immagine profilo', 'Mostrare l\'account connesso', 'Fino alla disconnessione'],
            ['Nome autore nel forum', 'Per non doverlo riscrivere a ogni messaggio', 'Finché non svuoti la memoria del browser']
          ]
        },
        note: 'Con "Esci" tutte queste voci vengono eliminate, tranne l\'impostazione della lingua.'
      },
      {
        h: '6. Servizi esterni coinvolti',
        p: [
          'Il meno possibile, ma non zero. Questi servizi vengono contattati durante l\'uso e ricevono inevitabilmente il tuo indirizzo IP:'
        ],
        table: {
          head: ['Servizio', 'Scopo', 'Dove'],
          rows: [
            ['Google Fonts', 'Caratteri tipografici del sito', 'Sito'],
            ['Google Identity / Drive API', 'Accesso e uso della tua cartella Inkwell in Drive', 'Sito e app, solo con accesso Google'],
            ['Microsoft Identity / Graph API', 'Accesso e uso della tua cartella Inkwell in OneDrive', 'Sito e app, solo con accesso Microsoft'],
            ['GitHub', 'Distribuzione del sito, elenco download, controllo aggiornamenti', 'Sito e app'],
            ['Google Firebase (Cloud Firestore)', 'Database dei messaggi del forum', 'Solo la pagina del forum']
          ]
        },
        note: 'Nessuno di questi servizi viene usato per riconoscere o osservare i visitatori.'
      },
      {
        h: '7. Controllo aggiornamenti nell\'app',
        p: [
          'L\'app desktop chiede a GitHub se esiste una versione più recente e, se lo desideri, scarica il programma di installazione. Viene richiesto solo l\'elenco pubblico delle versioni. Non viene trasmessa alcuna informazione su di te, sul tuo dispositivo o sui tuoi appunti.'
        ]
      },
      {
        h: '8. Forum della community',
        p: [
          'I messaggi e le risposte del forum vengono salvati in un database Google Firebase (Cloud Firestore). Sono leggibili pubblicamente da chiunque, anche senza accesso.',
          'Vengono salvati il nome o lo pseudonimo che indichi, il titolo e il testo del messaggio e l\'orario. Puoi anche scrivere in forma anonima: in quel caso non viene salvato alcun nome. Se hai effettuato l\'accesso, viene proposto il tuo nome Google o Microsoft — puoi sostituirlo.',
          'Non inserire informazioni personali o riservate nei messaggi pubblici. Per far rimuovere un messaggio, scrivi tramite il repository GitHub.',
          'Quaderni condivisi: se condividi un quaderno tramite link, una copia di sola lettura viene salvata presso Google Firebase (Cloud Firestore). Chiunque conosca il link può vederla senza accesso — l’identificativo nel link è casuale e non indovinabile e la pagina è esclusa dai motori di ricerca. La copia contiene l’intero quaderno, comprese immagini e pagine PDF inserite. Puoi revocare la condivisione in qualsiasi momento nell’app o nella dashboard: la copia viene eliminata e il link smette di funzionare.'
        ]
      },
      {
        h: '9. I tuoi diritti',
        p: [
          'In base al GDPR hai diritto di accesso, rettifica, cancellazione, limitazione del trattamento, portabilità dei dati e opposizione. Puoi inoltre presentare reclamo a un\'autorità di controllo per la protezione dei dati.',
          'Gran parte di questo puoi farlo direttamente, senza doverlo chiedere a noi:'
        ],
        ul: [
          '<strong>Accesso e portabilità:</strong> i tuoi quaderni esistono già come file leggibili sul tuo dispositivo e nella cartella cloud "Inkwell" (Drive / OneDrive) — puoi copiarli quando vuoi.',
          '<strong>Cancellazione:</strong> elimina i file locali, elimina la cartella "Inkwell" in Drive o OneDrive, esci dall\'app.',
          '<strong>Revoca del consenso:</strong> disattiva il backup cloud e revoca l\'accesso di Inkwell nelle impostazioni del tuo account Google o Microsoft.',
          '<strong>Messaggi del forum:</strong> richiedi la rimozione tramite il repository GitHub.'
        ]
      },
      {
        h: '10. Conservazione',
        p: [
          'Non conserviamo nulla, perché non raccogliamo nulla. I quaderni esistono finché li tieni sul tuo dispositivo e nel tuo spazio cloud. I messaggi pubblici del forum restano finché non ne chiedi la rimozione.'
        ]
      },
      {
        h: '11. Minori',
        p: [
          'Inkwell non si rivolge specificamente a minori di 16 anni. Poiché non raccogliamo dati sugli utenti, non vengono raccolti nemmeno dati di minori. Per l\'accesso valgono inoltre i limiti di età previsti da Google e Microsoft.'
        ]
      },
      {
        h: '12. Modifiche',
        p: [
          'Se il funzionamento di Inkwell cambia, questa pagina viene aggiornata. La data di riferimento è indicata in alto. La cronologia delle modifiche è consultabile nel repository pubblico.'
        ]
      }
    ]
  }
};