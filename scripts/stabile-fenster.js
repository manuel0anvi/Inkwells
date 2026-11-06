'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DIE PRÜFSTÄNDE LAUFEN AUCH HINTER ANDEREN FENSTERN

   Chromium bremst ein Fenster, das verdeckt ist oder im Hintergrund liegt:
   Zeitgeber kommen seltener, Bilder (requestAnimationFrame) gar nicht mehr. Die
   Prüfstände zeichnen und messen auf einem echten Desktop. Lag ein anderes
   Fenster darüber, kamen dieselben Meldungen, mal hier und mal dort.
   ══════════════════════════════════════════════════════════════════════ */
const { app } = require('electron');

app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
