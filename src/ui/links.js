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
  const fehlerFeld = E('link-error');
  const knopfOk = E('link-ok');
  const knopfWeg = E('link-remove');

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
      feldText.value = bearbeitet.textContent || '';
      feldUrl.value = bearbeitet.getAttribute('href') || '';
      knopfWeg.style.display = '';
      knopfOk.textContent = t('linkApply') || 'Übernehmen';
    } else {
      feldText.value = (sel && !sel.isCollapsed) ? String(sel) : '';
      feldUrl.value = '';
      knopfWeg.style.display = 'none';
      knopfOk.textContent = t('linkInsert') || 'Einfügen';
    }

    zeigeFehler('');
    overlay.style.display = 'flex';
    // Die Adresse ist das, was fehlt – dorthin der Fokus
    setTimeout(() => feldUrl.focus(), 0);
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
    const adresse = raeumeAdresse(feldUrl.value);
    if (!adresse) { zeigeFehler(t('linkBadUrl') || 'Das ist keine brauchbare Adresse.'); return; }

    const text = feldText.value.trim() || adresse;

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
  overlay.addEventListener('click', (e) => { if (e.target === overlay) zu(); });

  for (const feld of [feldText, feldUrl]) {
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

  /* ── Anklicken ───────────────────────────────────────────────────── */

  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('.j-text a[href]') : null;
    if (!a) return;

    /* Ohne Strg (bzw. Cmd) passiert nichts: der Verweis steht mitten im
       Text, und man muss dort auch schreiben koennen. Siehe oben. */
    if (!(e.ctrlKey || e.metaKey)) return;

    e.preventDefault();
    const ziel = a.getAttribute('href') || '';

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
  }, true);

  /* Der Zeigerwechsel sagt, dass hier etwas zu holen ist – aber erst mit
     gedruecktem Strg, denn nur dann tut ein Klick auch etwas. */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') document.body.classList.add('links-aktiv');
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') document.body.classList.remove('links-aktiv');
  });
  window.addEventListener('blur', () => document.body.classList.remove('links-aktiv'));
})();
