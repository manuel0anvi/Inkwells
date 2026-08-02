'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ÖRTLICHE ZUGANGSDATEN  ―  VORLAGE

   Diese Datei ist die Vorlage. So wird sie benutzt:

     1. Kopieren und in  cloudConfig.local.js  umbenennen
        (gleicher Ordner, also src/core/).
     2. Unten das Google-Client-Secret eintragen.

   cloudConfig.local.js steht in .gitignore und wird deshalb NICHT
   mit hochgeladen – jeder trägt seinen Wert selbst ein. Diese Vorlage
   hier dagegen gehört ins Repo und bleibt immer leer.

   Fehlt cloudConfig.local.js, läuft alles weiter: die Google-Anmeldung
   nimmt dann den Implicit Flow und muss stündlich erneuert werden.
   Siehe CLOUD_SETUP.md, Abschnitt 4.
   ══════════════════════════════════════════════════════════════════════ */

// Google Cloud Console -> APIs & Dienste -> Anmeldedaten -> OAuth-Client
// Form: GOCSPX-...
window.GOOGLE_CLIENT_SECRET_LOCAL = '';
