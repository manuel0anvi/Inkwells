'use strict';

/* ══════════════════════════════════════════════════════════════════════
   VERWEISE IM TEXT

   Es gab sie nicht: der Sanitizer hat jedes <a> ausgepackt, weil eine
   ADRESSE der uebliche Weg ist, ueber den in einer fremden Seite etwas
   Ausfuehrbares landet (javascript:, data:). Wer eine Internetadresse in
   ein Heft schrieb, hatte danach blossen Text.

   Jetzt gibt es sie – mit der Pruefung in core/sanitize.js darunter.
   Diese Datei ist die Bedienseite davon:

     · der Knopf in der Werkzeugleiste und Strg+K,
     · das Fenster mit Text und Adresse,
     · das Oeffnen beim Anklicken.

   ── Warum das Oeffnen hier steht und nicht am <a> ───────────────────
   Ein Verweis im Heft ist ein Stueck TEXT, in dem man auch schreiben
   koennen muss. Ein gewoehnlicher Klick soll deshalb die Schreibmarke
   setzen und nichts oeffnen – sonst kaeme man an das Ende eines Wortes
   gar nicht mehr heran. Geoeffnet wird mit Strg (bzw. Cmd) und Klick,
   so wie in einem Editor auch.

   ── Und warum nicht einfach das <a> klicken lassen ──────────────────
   Weil die Oberflaeche unter einer eigenen Herkunft laeuft (dem
   oertlichen Server, siehe main.js). Ein Klick wuerde die fremde Seite
   IM FENSTER DER APP oeffnen – und dieses Fenster traegt window.api.
   Der Verweis geht deshalb ueber openExternal in den Standardbrowser,
   und main.js laesst dort nur http und https durch.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const overlay = E('ov-link');
  if (!overlay) return;

  const feldText = E('link-text');
  const feldUrl = E('link-url');
  const feldSeite = E('link-page');
  const fehlerFeld = E('link-error');
  const knopfOk = E('link-ok');
  const knopfWeg = E('link-remove');

  /* 'url' oder 'seite'. Getrennte Felder, weil „12" sonst zugleich eine
     Adresse und eine Seitenzahl wäre und niemand raten sollte. */
  let art = 'url';

  /* Der Ausschnitt, auf den der Verweis soll. Er MUSS gemerkt werden:
     sobald der Fokus ins Eingabefeld geht, ist die Auswahl im Heft weg,
     und danach weiss niemand mehr, welche Woerter gemeint waren. */
  let gemerkt = null;      // Range
  let gemerktesFeld = null;
  let bearbeitet = null;   // ein vorhandenes <a>, wenn man darin stand

  /* ── Adressen ────────────────────────────────────────────────────── */

  /**
   * Macht aus einer Eingabe eine brauchbare Adresse.
   *
   * „inkwells.me" ist das, was Leute tippen; ohne Schema ist es keine
   * Adresse, sondern ein relativer Pfad. https:// davor ist die
   * Vermutung, die in fast allen Faellen stimmt – und wenn nicht, sieht
   * man es sofort im Feld.
   *
   * @returns {string} die fertige Adresse, oder '' wenn nichts geht
   */
  function raeumeAdresse(eingabe) {
    let roh = String(eingabe || '').trim();
    if (!roh) return '';

    // Eine Mailadresse ohne mailto: ist ebenfalls das, was man tippt
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(roh)) roh = 'mailto:' + roh;
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(roh)) roh = 'https://' + roh;

    try {
      const u = new URL(roh);
      if (!['http:', 'https:', 'mailto:', 'inkwell:'].includes(u.protocol)) return '';
      return u.href;
    } catch (err) {
      return '';
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     EIN VERWEIS AUF EINE SEITE IM HEFT

     Er sieht aus wie „inkwell://page/12" und ist damit ein ganz
     gewöhnlicher Verweis: er läuft durch dieselbe Prüfung in
     core/sanitize.js (das Schema inkwell: war dort schon erlaubt,
     wegen der Freigabe-Links) und überlebt jeden Abgleich.

     Warum kein eigenes Attribut: ein data-Attribut müsste in der
     Bereinigung eigens freigegeben werden, und jede Stelle, die Text
     verarbeitet – Export, Word, Website – müsste es kennen. Als Adresse
     ist es überall schon richtig behandelt; wer das Heft als PDF
     exportiert, bekommt einen toten Verweis statt einer kaputten Seite.
     ══════════════════════════════════════════════════════════════════ */
  const SEITE_MUSTER = /^inkwell:\/\/page\/(\d{1,5})$/i;

  function seiteAusAdresse(href) {
    const m = SEITE_MUSTER.exec(String(href || '').trim());
    return m ? Number(m[1]) : null;
  }

  function adresseFuerSeite(nr) {
    return 'inkwell://page/' + Math.max(1, Math.floor(nr));
  }

  /** Wie viele Seiten hat das offene Heft? Für die Prüfung der Eingabe. */
  function seitenImHeft() {
    const nb = (typeof getNb === 'function') ? getNb() : null;
    if (!nb) return 0;
    return (typeof notebookPages === 'function' ? notebookPages(nb) : (nb.pages || [])).length;
  }

  /** Wechselt zwischen Adresse und Seitenzahl. */
  function setzeArt(neu) {
    art = neu === 'seite' ? 'seite' : 'url';
    E('link-kind-url').classList.toggle('active', art === 'url');
    E('link-kind-page').classList.toggle('active', art === 'seite');
    E('link-url-row').style.display = art === 'url' ? '' : 'none';
    E('link-page-row').style.display = art === 'seite' ? '' : 'none';
    zeigeFehler('');
    setTimeout(() => (art === 'url' ? feldUrl : feldSeite).focus(), 0);
  }

  /* ── Das Fenster ─────────────────────────────────────────────────── */

  function zu() {
    overlay.style.display = 'none';
    gemerkt = null;
    gemerktesFeld = null;
    bearbeitet = null;
  }

  function zeigeFehler(text) {
    fehlerFeld.textContent = text;
    fehlerFeld.style.display = text ? 'block' : 'none';
  }

  /** Das <a>, in dem die Schreibmarke gerade steht – oder null. */
  function verweisUnterMarke(sel) {
    if (!sel || !sel.rangeCount) return null;
    let knoten = sel.getRangeAt(0).commonAncestorContainer;
    if (knoten.nodeType === 3) knoten = knoten.parentNode;
    return knoten && knoten.closest ? knoten.closest('a') : null;
  }

  function oeffneFenster() {
    const sel = window.getSelection();
    const feld = document.activeElement;

    // Nur im Seitentext. Anderswo hat ein Verweis keinen Platz.
    if (!feld || !feld.classList || !feld.classList.contains('j-text')) return;
    if (feld.isContentEditable === false) return;

    gemerktesFeld = feld;
    gemerkt = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
    bearbeitet = verweisUnterMarke(sel);

    if (bearbeitet) {
      const href = bearbeitet.getAttribute('href') || '';
      const seite = seiteAusAdresse(href);
      feldText.value = bearbeitet.textContent || '';
      feldUrl.value = seite ? '' : href;
      feldSeite.value = seite ? String(seite) : '';
      knopfWeg.style.display = '';
      knopfOk.textContent = t('linkApply') || 'Übernehmen';
      setzeArt(seite ? 'seite' : 'url');
    } else {
      feldText.value = (sel && !sel.isCollapsed) ? String(sel) : '';
      feldUrl.value = '';
      feldSeite.value = '';
      knopfWeg.style.display = 'none';
      knopfOk.textContent = t('linkInsert') || 'Einfügen';
      setzeArt('url');
    }

    zeigeFehler('');
    overlay.style.display = 'flex';
  }

  /** Die gemerkte Auswahl zurückholen, damit execCommand sie wieder trifft. */
  function stelleAuswahlHer() {
    if (!gemerktesFeld) return false;
    gemerktesFeld.focus();
    if (!gemerkt) return true;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(gemerkt);
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE ÄNDERUNG MUSS DENSELBEN WEG NEHMEN WIE GETIPPTER TEXT

     >>> Was hier vorher stand, und warum es zu wenig war <<<
     `markCurrentNotebookDirty()` plus `syncAll()`. Das schrieb die Seite
     auf die Platte – und sonst nichts. Ein Verweis erreichte die anderen
     in einer Live-Sitzung NIE. Genau so ist es gemeldet worden.

     Der Grund ist, dass an einer einzigen Stelle sehr viel hängt: der
     'input'-Griff des Textfeldes in app.js. Dort wird page.textContent
     gesetzt, Collab.noteTextChange gerufen (das ist der Live-Weg), der
     Seitenbaum nachgezogen, der Überlauf geprüft und die Änderung
     vermerkt. Wer den Text von Hand ändert, geht daran vorbei — ein
     programmatisch eingefügter Knoten löst kein 'input' aus.

     Deshalb wird das Ereignis ausgelöst, statt die Liste von Dingen hier
     noch einmal aufzuschreiben. Dieselbe Lösung nimmt app.js schon für
     Tab und Enter in Tabellen (commitPlainTextEdit).
     ══════════════════════════════════════════════════════════════════ */
  function merkeAenderung(feld) {
    const ziel = feld || gemerktesFeld;
    if (ziel) {
      ziel.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Ohne Feld bleibt nur der kurze Weg – sollte nicht vorkommen
    if (typeof window.markCurrentNotebookDirty === 'function') window.markCurrentNotebookDirty();
    if (typeof syncAll === 'function') { try { syncAll(); } catch (e) { /* egal */ } }
  }

  function uebernehmen() {
    let adresse = '';
    let vorgabeText = '';

    if (art === 'seite') {
      const nr = Number.parseInt(feldSeite.value, 10);
      const gesamt = seitenImHeft();
      if (!Number.isFinite(nr) || nr < 1 || (gesamt && nr > gesamt)) {
        zeigeFehler((t('linkBadPage') || 'Diese Seite gibt es nicht (1 bis {n}).')
          .replace('{n}', gesamt || '?'));
        return;
      }
      adresse = adresseFuerSeite(nr);
      // „Seite 12" ist als Beschriftung brauchbarer als die rohe Adresse
      vorgabeText = (t('linkPageText') || 'Seite {n}').replace('{n}', nr);
    } else {
      adresse = raeumeAdresse(feldUrl.value);
      if (!adresse) { zeigeFehler(t('linkBadUrl') || 'Das ist keine brauchbare Adresse.'); return; }
      vorgabeText = adresse;
    }

    const text = feldText.value.trim() || vorgabeText;

    if (bearbeitet) {
      /* Das Feld VOR zu() merken – dort wird gemerktesFeld geleert, und
         danach wüsste merkeAenderung() nicht mehr, wen es benachrichtigen
         soll. Der Verweis ginge dann wieder nicht hinaus. */
      const feld = gemerktesFeld || bearbeitet.closest('.j-text');
      bearbeitet.setAttribute('href', adresse);
      bearbeitet.setAttribute('target', '_blank');
      bearbeitet.setAttribute('rel', 'noopener noreferrer');
      bearbeitet.textContent = text;
      zu();
      merkeAenderung(feld);
      return;
    }

    if (!stelleAuswahlHer()) { zu(); return; }
    const feld = gemerktesFeld;

    /* Von Hand aufgebaut und nicht ueber execCommand('createLink'):
       createLink braucht eine Auswahl und kann den Text nicht aendern –
       wer nichts markiert hatte, bekam einen Verweis ohne Beschriftung. */
    const a = document.createElement('a');
    a.setAttribute('href', adresse);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.textContent = text;

    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(a);
      // Die Marke hinter den Verweis, sonst tippt man mitten hinein
      range.setStartAfter(a);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    zu();
    merkeAenderung(feld);
  }

  function entfernen() {
    if (!bearbeitet) { zu(); return; }
    const feld = gemerktesFeld || bearbeitet.closest('.j-text');
    const eltern = bearbeitet.parentNode;
    while (bearbeitet.firstChild) eltern.insertBefore(bearbeitet.firstChild, bearbeitet);
    bearbeitet.remove();
    zu();
    merkeAenderung(feld);
  }

  /* ── Verdrahtung ─────────────────────────────────────────────────── */

  E('fmt-link')?.addEventListener('mousedown', (e) => {
    // Sonst nimmt der Knopf dem Textfeld den Fokus, bevor wir die
    // Auswahl merken konnten – dieselbe Falle wie beim Farbring.
    e.preventDefault();
    oeffneFenster();
  });

  E('link-close')?.addEventListener('click', zu);
  E('link-cancel')?.addEventListener('click', zu);
  E('link-ok')?.addEventListener('click', uebernehmen);
  E('link-remove')?.addEventListener('click', entfernen);
  E('link-kind-url')?.addEventListener('click', () => setzeArt('url'));
  E('link-kind-page')?.addEventListener('click', () => setzeArt('seite'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) zu(); });

  for (const feld of [feldText, feldUrl, feldSeite]) {
    feld?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); uebernehmen(); }
      if (e.key === 'Escape') { e.preventDefault(); zu(); }
    });
    feld?.addEventListener('input', () => zeigeFehler(''));
  }

  /* Strg+K, das gewohnte Kürzel. Über die Bubble-Phase und nicht über
     core/shortcuts.js: der Verweis gehört zum Textfeld, und dort werden
     die Kürzel der App bewusst nicht durchgereicht. */
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (String(e.key).toLowerCase() !== 'k') return;
    const feld = document.activeElement;
    if (!feld || !feld.classList || !feld.classList.contains('j-text')) return;
    e.preventDefault();
    oeffneFenster();
  });

  /* ══════════════════════════════════════════════════════════════════
     WOHIN FÜHRT DAS?

     Ein Verweis öffnet sich im STANDARDBROWSER – das ist ein Schritt aus
     der App hinaus, und den sollte niemand blind tun. Deshalb steht das
     Ziel unten links, sobald der Zeiger darauf liegt, wie in der
     Statuszeile eines Browsers.

     Mit dem Finger ist derselbe Streifen der erste von zwei Schritten:
     einmal tippen zeigt ihn, ein zweiter Tipp auf denselben Verweis
     öffnet. Auf einem Tablet gibt es kein Zeigen und kein Strg – ohne
     diesen Umweg wüsste man dort nie, was man gleich aufmacht.
     ══════════════════════════════════════════════════════════════════ */
  const streifen = E('link-peek');
  const streifenZiel = E('link-peek-ziel');
  const streifenHinweis = E('link-peek-hinweis');

  /* Der Verweis, der mit dem Finger schon einmal angetippt wurde. Der
     zweite Tipp darauf öffnet. */
  let angetippt = null;
  let angetipptUhr = null;

  /** Wie das Ziel lesbar heißt. */
  function zielText(href) {
    const seite = seiteAusAdresse(href);
    if (seite) return (t('linkPageText') || 'Seite {n}').replace('{n}', seite);
    try {
      const u = new URL(href);
      if (u.protocol === 'mailto:') return u.pathname;
      // Ohne das https:// davor – das weiß jeder, es kostet nur Platz
      return u.host + (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
    } catch (err) {
      return href;
    }
  }

  function zeigeStreifen(href, warten) {
    if (!streifen) return;
    streifenZiel.textContent = zielText(href);
    streifenHinweis.textContent = warten
      ? (t('linkTapAgain') || 'noch einmal tippen zum Öffnen')
      : (t('linkCtrlClick') || 'Strg + Klick zum Öffnen');
    streifen.style.display = 'flex';
  }

  function versteckeStreifen() {
    if (streifen) streifen.style.display = 'none';
  }

  function vergissTipp() {
    angetippt = null;
    clearTimeout(angetipptUhr);
    versteckeStreifen();
  }

  const verweisUnter = (ziel) =>
    (ziel && ziel.closest) ? ziel.closest('.j-text a[href]') : null;

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;   // dort gilt der Tipp-Weg
    const a = verweisUnter(e.target);
    if (a) zeigeStreifen(a.getAttribute('href') || '', false);
    else if (!angetippt) versteckeStreifen();
  }, true);

  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    if (!verweisUnter(e.target)) return;
    if (!angetippt) versteckeStreifen();
  }, true);

  /* ══════════════════════════════════════════════════════════════════
     ZU EINER SEITENZAHL SPRINGEN

     Die Zahl ist die des HEFTS – dieselbe, die über der Seite steht und
     die auch die Suche nennt (pageNumberOf in core/data.js). Nicht die
     Stelle innerhalb eines Abschnitts: die ändert sich, sobald man den
     Ausschnitt wechselt, und ein Verweis, dessen Ziel vom gerade
     gewählten Abschnitt abhängt, wäre keiner.

     Steht die Seite in einem anderen Abschnitt als dem gezeigten, wird
     auf „alle Seiten" umgeschaltet – sonst führte der Verweis ins Leere,
     und zwar wortlos.
     ══════════════════════════════════════════════════════════════════ */
  window.springeZuSeitenzahl = function springeZuSeitenzahl(nr) {
    const nb = (typeof getNb === 'function') ? getNb() : null;
    if (!nb) return false;

    const seiten = (typeof notebookPages === 'function') ? notebookPages(nb) : (nb.pages || []);
    const ziel = seiten[Math.floor(nr) - 1];
    if (!ziel) {
      if (typeof toast === 'function') {
        toast((t('linkPageGone') || 'Seite {n} gibt es nicht mehr.').replace('{n}', nr), true);
      }
      return false;
    }

    const gezeigt = (typeof activeSection === 'function') ? activeSection(nb) : null;
    const imAusschnitt = !gezeigt || String(ziel.secId || '') === String(gezeigt.id);
    if (typeof openSection === 'function') openSection(imAusschnitt ? gezeigt : null, ziel.id);
    return true;
  };

  /** Wirklich hingehen. */
  function folge(href) {
    const ziel = String(href || '');

    // Eine Seite im selben Heft – dafür braucht es niemanden von aussen
    const seite = seiteAusAdresse(ziel);
    if (seite) {
      if (typeof window.springeZuSeitenzahl === 'function') window.springeZuSeitenzahl(seite);
      return;
    }

    // Ein Freigabe-Link gehört in die App selbst, nicht in den Browser
    if (ziel.startsWith('inkwell://') && typeof window.openSharedDocumentByLink === 'function') {
      const treffer = /^inkwell:\/\/share\/([^/?#]+)/i.exec(ziel);
      if (treffer) { window.openSharedDocumentByLink(decodeURIComponent(treffer[1])); return; }
    }

    if (window.api && typeof window.api.openExternal === 'function') {
      window.api.openExternal(ziel);
    } else {
      window.open(ziel, '_blank', 'noopener,noreferrer');
    }
  }

  document.addEventListener('click', (e) => {
    const a = verweisUnter(e.target);
    if (!a) { vergissTipp(); return; }

    const href = a.getAttribute('href') || '';

    /* ── Mit dem Finger: zwei Schritte ────────────────────────────
       Der Klick aus einer Berührung trägt pointerType nicht mehr, aber
       e.detail ist bei einem echten Tipp 1 und der Zeiger war vorher
       nirgends. Verlässlicher ist die Marke, die pointerdown setzt. */
    if (istBeruehrung) {
      e.preventDefault();
      e.stopPropagation();
      if (angetippt === a) { vergissTipp(); folge(href); return; }
      angetippt = a;
      zeigeStreifen(href, true);
      clearTimeout(angetipptUhr);
      // Nach einer Weile gilt der erste Tipp nicht mehr
      angetipptUhr = setTimeout(vergissTipp, 4000);
      return;
    }

    /* Ohne Strg (bzw. Cmd) passiert nichts: der Verweis steht mitten im
       Text, und man muss dort auch schreiben koennen. */
    if (!(e.ctrlKey || e.metaKey)) return;

    e.preventDefault();
    versteckeStreifen();
    folge(href);
  }, true);

  /* Kam der letzte Zeiger von einem Finger? Der Klick danach weiss das
     nicht mehr von selbst. */
  let istBeruehrung = false;
  document.addEventListener('pointerdown', (e) => {
    istBeruehrung = e.pointerType === 'touch';
    // Ein Tipp woanders hebt den ersten Tipp auf
    if (istBeruehrung && angetippt && !verweisUnter(e.target)) vergissTipp();
  }, true);

  /* Der Zeigerwechsel sagt, dass hier etwas zu holen ist – aber erst mit
     gedruecktem Strg, denn nur dann tut ein Klick auch etwas. */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') document.body.classList.add('links-aktiv');
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') document.body.classList.remove('links-aktiv');
  });
  window.addEventListener('blur', () => {
    document.body.classList.remove('links-aktiv');
    vergissTipp();
  });
})();
