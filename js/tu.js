'use strict';

/* ══════════════════════════════════════════════════════════════════════
   WAS EIN KNOPF TUT, OHNE INLINE-CODE

   Die Seiten tragen keine onclick-Attribute mehr, sondern data-tu-click="…" mit
   derselben Schreibweise. Die Sicherheitsregel der Website lässt keinen Inline-Code
   mehr zu: auf inkwells.me liegen die Cloud-Token, und ein eingeschleustes
   <img onerror> soll dort nicht laufen können.

   Bewusst kein eval. Verstanden werden nur Aufrufe globaler Funktionen mit Text,
   Zahl oder event als Angabe:  setLang('de'); toggleMobileLangMenu()
   Das Attribut kann also nichts anderes tun, als eine vorhandene Funktion rufen.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const AUFRUF = /\s*([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?:;|$)/y;
  const ANGABE = /\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|(event))\s*(?:,|$)/y;

  function angaben(text, ereignis) {
    const liste = [];
    ANGABE.lastIndex = 0;
    while (ANGABE.lastIndex < text.length) {
      const m = ANGABE.exec(text);
      if (!m) throw new Error('Nicht verstanden: ' + text);
      if (m[1] !== undefined) liste.push(m[1].replace(/\\(.)/g, '$1'));
      else if (m[2] !== undefined) liste.push(m[2].replace(/\\(.)/g, '$1'));
      else if (m[3] !== undefined) liste.push(Number(m[3]));
      else liste.push(ereignis);
    }
    return liste;
  }

  function fuehreAus(befehl, ereignis) {
    AUFRUF.lastIndex = 0;
    while (AUFRUF.lastIndex < befehl.length) {
      const m = AUFRUF.exec(befehl);
      if (!m) throw new Error('Nicht verstanden: ' + befehl);
      const tun = window[m[1]];
      if (typeof tun !== 'function') throw new Error('Keine Funktion: ' + m[1]);
      tun(...angaben(m[2], ereignis));
    }
  }

  for (const art of ['click', 'submit', 'input', 'change']) {
    const schluessel = 'data-tu-' + art;
    document.addEventListener(art, (ereignis) => {
      let el = ereignis.target && ereignis.target.closest && ereignis.target.closest('[' + schluessel + ']');
      while (el) {
        try {
          fuehreAus(el.getAttribute(schluessel), ereignis);
        } catch (err) {
          console.error('[Seite]', err);
        }
        if (ereignis.cancelBubble) return;
        el = el.parentElement && el.parentElement.closest('[' + schluessel + ']');
      }
    });
  }
})();
