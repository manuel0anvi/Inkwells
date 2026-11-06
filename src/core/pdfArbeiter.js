'use strict';

/* Wo pdf.js seinen Arbeiter findet. Eine eigene Datei, weil die Oberfläche keinen
   Inline-Code mehr ausführt (siehe UI_CSP in main.js). */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
