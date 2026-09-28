'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DIE LEISTEN BLEIBEN, WENN DIE BILDSCHIRMTASTATUR KOMMT

   >>> Gemeldet: „manchmal geht die ganze Titel- und Werkzeugleiste weg" <<<
   Fährt unter Windows die Bildschirmtastatur heraus, verkleinert
   Chromium nur das SICHTBARE Fenster (visualViewport), nicht das Layout.
   Die App ist weiter so hoch wie der ganze Schirm, und liegt die
   Schreibmarke im unteren Teil, schiebt Chromium den sichtbaren
   Ausschnitt nach unten, damit sie über der Tastatur steht. Oben fallen
   dabei Titel- und Werkzeugleiste heraus – und zurück kommt man nicht:
   html und body haben overflow: hidden, rollen lässt sich da nichts.
   „Manchmal" deshalb, weil es nur geschieht, wenn die Marke tief genug
   sitzt.

   >>> Was stattdessen geschieht <<<
   Die App schrumpft auf die Höhe, die über der Tastatur bleibt
   (--app-h, siehe css/layout.css). Die Leisten stehen oben, das Blatt
   wird kürzer, und die Marke wird im Blatt selbst hochgerollt statt mit
   dem ganzen Fenster.

   Mit zwei Fingern ins Fenster gezoomt (scale ≠ 1) ist der kleine
   Ausschnitt dagegen gewollt – da wird nichts angefasst.
   ══════════════════════════════════════════════════════════════════════ */
(function leistenBleibenUeberDerTastatur() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;

  /* Unter dieser Differenz ist es keine Tastatur, sondern eine Rundung
     oder eine eingeblendete Leiste des Systems. */
  const TASTATUR_MIN = 80;

  let hoehe = 0;

  function markeZeigen() {
    const sel = window.getSelection && window.getSelection();
    const aktiv = document.activeElement;
    if (!aktiv || !(aktiv.isContentEditable || /^(INPUT|TEXTAREA)$/.test(aktiv.tagName))) return;

    let rect = null;
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      // Eine leere Zeile liefert ein Rechteck ohne Ausdehnung bei 0/0
      if (r && (r.width || r.height)) rect = r;
    }
    if (!rect) rect = aktiv.getBoundingClientRect();

    const unten = vv.height - 16;
    if (rect.bottom <= unten) return;

    // Das nächste Rollfeld darüber rollen, nicht das Fenster
    for (let el = aktiv.parentElement; el && el !== document.body; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
        el.scrollTop += rect.bottom - unten;
        return;
      }
    }
  }

  function nachrechnen() {
    if (Math.abs(vv.scale - 1) > 0.01) return;

    const voll = root.clientHeight;
    const sichtbar = Math.round(vv.height);
    const neu = (voll - sichtbar > TASTATUR_MIN) ? sichtbar : 0;

    if (neu !== hoehe) {
      hoehe = neu;
      if (neu) root.style.setProperty('--app-h', neu + 'px');
      else root.style.removeProperty('--app-h');
      if (neu) requestAnimationFrame(markeZeigen);
    }

    // Den verschobenen Ausschnitt zurück nach oben – dort stehen die Leisten
    if (vv.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
  }

  vv.addEventListener('resize', nachrechnen);
  vv.addEventListener('scroll', nachrechnen);

  /* Auch overflow: hidden lässt sich rollen – nur nicht von Hand. Genau
     das tut Chromium beim Hineinholen der Marke mit body und den
     Ansichten. Keines davon soll je gerollt stehen. */
  document.addEventListener('scroll', (e) => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!el || !el.scrollTop) return;
    if (el === document.scrollingElement || el === document.body
        || (el.classList && el.classList.contains('view'))) {
      el.scrollTop = 0;
    }
  }, true);
})();
