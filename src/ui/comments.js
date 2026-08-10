'use strict';

/* ══════════════════════════════════════════════════════════════════════
   KOMMENTAR-OBERFLÄCHE

   Zeigt Kommentare als Karten in einer Leiste am rechten Rand und als
   farbige Marken im Text. Die Leiste ist nur sichtbar, wenn die aktuelle
   Seite Kommentare hat.

   >>> Karten und Marken: zwei Ansichten derselben Daten <<<
   Die Marke im Text ist der Anker: ein Klick darauf öffnet die Karte
   daneben. Beide zeigen denselben Zustand (offen/erledigt) und dieselbe
   Kennung (data-cid).
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  /* ── Die Leiste aufbauen ──────────────────────────────────────────── */
  const leiste = document.createElement('div');
  leiste.id = 'comment-panel';
  leiste.className = 'comment-panel';
  leiste.style.display = 'none';
  leiste.innerHTML = '<div class="comment-panel-head">'
    + '<span class="comment-panel-title" data-i18n="comments">Kommentare</span>'
    + '<button class="comment-panel-close" id="comment-panel-close">✕</button>'
    + '</div>'
    + '<div class="comment-list" id="comment-list"></div>'
    + '<div class="comment-add-row">'
    + '<textarea id="comment-new-text" rows="2" placeholder="Kommentar …" data-i18n-ph="commentPlaceholder"></textarea>'
    + '<button class="ok-btn" id="comment-add-btn" data-i18n="addComment">Kommentar</button>'
    + '</div>';

  const editorCol = document.querySelector('.editor-col');
  if (editorCol) editorCol.appendChild(leiste);

  /* ── Übersetzungen anwenden ───────────────────────────────────────── */
  function aktualisiereTexte() {
    const titel = leiste.querySelector('.comment-panel-title');
    if (titel && typeof t === 'function') titel.textContent = t('comments');
    const ta = E('comment-new-text');
    if (ta && typeof t === 'function') ta.placeholder = t('commentPlaceholder') || 'Kommentar …';
    const btn = E('comment-add-btn');
    if (btn && typeof t === 'function') btn.textContent = t('addComment');
  }

  /* t() ist beim Laden dieses Scripts vielleicht noch nicht fertig –
     später nachholen. */
  if (typeof t === 'function') aktualisiereTexte();
  else window.addEventListener('load', aktualisiereTexte);

  /* ── Öffnen / Schließen ──────────────────────────────────────────── */
  function oeffnen() {
    leiste.style.display = 'flex';
    zeichneKarten();
  }

  function schliessen() {
    leiste.style.display = 'none';
  }

  E('comment-panel-close').addEventListener('click', schliessen);

  /* ── Karten bauen ────────────────────────────────────────────────── */
  function formatZeit(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const jetzt = new Date();
    const diff = jetzt - d;
    if (diff < 60000) return 'jetzt';
    if (diff < 3600000) return 'vor ' + Math.floor(diff / 60000) + ' min';
    if (diff < 86400000) return 'vor ' + Math.floor(diff / 3600000) + ' h';
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function baueKarte(c) {
    const karte = document.createElement('div');
    karte.className = 'comment-card' + (c.resolved ? ' resolved' : '');
    karte.dataset.cid = String(c.id);

    const kopf = document.createElement('div');
    kopf.className = 'comment-card-head';

    const autor = document.createElement('span');
    autor.className = 'comment-card-author';
    autor.textContent = (c.author && c.author.name) || 'Unbekannt';

    const zeit = document.createElement('span');
    zeit.className = 'comment-card-time';
    zeit.textContent = formatZeit(c.created);

    kopf.appendChild(autor);
    kopf.appendChild(zeit);

    const text = document.createElement('div');
    text.className = 'comment-card-text';
    text.textContent = c.text || '';

    karte.appendChild(kopf);
    karte.appendChild(text);

    // Antworten
    if (c.replies && c.replies.length) {
      const antworten = document.createElement('div');
      antworten.className = 'comment-replies';
      c.replies.forEach(r => {
        const ant = document.createElement('div');
        ant.className = 'comment-reply';
        ant.innerHTML = '<span class="comment-reply-author">' + escapeHtml(r.author.name || '') + '</span>'
          + '<span class="comment-reply-text">' + escapeHtml(r.text || '') + '</span>'
          + '<span class="comment-reply-time">' + formatZeit(r.created) + '</span>';
        antworten.appendChild(ant);
      });
      karte.appendChild(antworten);
    }

    // Knopf-Reihe
    const btnReihe = document.createElement('div');
    btnReihe.className = 'comment-card-btns';

    // Antwort-Knopf
    const antwBtn = document.createElement('button');
    antwBtn.className = 'sm-action';
    antwBtn.textContent = (typeof t === 'function' && t('replyToComment')) || 'Antworten';
    antwBtn.addEventListener('click', () => {
      const antwortText = window.prompt(
        (typeof t === 'function' && t('replyPlaceholder')) || 'Antwort schreiben …'
      );
      if (antwortText && antwortText.trim()) {
        replyToComment(c.id, antwortText.trim());
        zeichneKarten();
        aktualisiereMarken();
      }
    });

    // Erledigt-Knopf
    const erlBtn = document.createElement('button');
    erlBtn.className = 'sm-action';
    erlBtn.textContent = c.resolved
      ? ((typeof t === 'function' && t('reopenComment')) || 'Wieder öffnen')
      : ((typeof t === 'function' && t('resolveComment')) || 'Erledigt');
    erlBtn.addEventListener('click', () => {
      toggleCommentResolved(c.id);
      zeichneKarten();
      aktualisiereMarken();
    });

    // Löschen-Knopf
    const delBtn = document.createElement('button');
    delBtn.className = 'sm-action danger';
    delBtn.textContent = (typeof t === 'function' && t('deleteComment')) || 'Löschen';
    delBtn.addEventListener('click', () => {
      if (window.confirm((typeof t === 'function' && t('confirmDeleteComment')) || 'Kommentar wirklich löschen?')) {
        deleteComment(c.id);
        zeichneKarten();
        aktualisiereMarken();
      }
    });

    btnReihe.appendChild(antwBtn);
    btnReihe.appendChild(erlBtn);
    btnReihe.appendChild(delBtn);
    karte.appendChild(btnReihe);

    return karte;
  }

  function zeichneKarten() {
    const liste = E('comment-list');
    if (!liste) return;

    const pgId = S.activePgId;
    if (!pgId) { liste.innerHTML = ''; return; }

    const kommentare = typeof getPageComments === 'function' ? getPageComments(pgId) : [];
    if (!kommentare.length) {
      schliessen();
      return;
    }

    liste.innerHTML = '';
    kommentare.forEach(c => liste.appendChild(baueKarte(c)));
  }

  /* ── Marken im Text ──────────────────────────────────────────────────
     Die Marken sind contenteditable="false"-Spans, die vom Browser wie
     ein einzelnes Zeichen behandelt werden. Wir färben sie je nach
     Zustand (offen = gelb, erledigt = grün) und machen sie anklickbar. */

  function aktualisiereMarken() {
    const markers = document.querySelectorAll('.j-comment-marker[data-cid]');
    const nb = typeof getNb === 'function' ? getNb() : null;
    const kommentare = nb && nb.comments ? nb.comments : [];

    markers.forEach(m => {
      const cid = m.dataset.cid;
      const c = kommentare.find(c => String(c.id) === cid);

      // Zustand als Klasse
      m.classList.toggle('j-resolved', !!(c && c.resolved));
      m.classList.toggle('j-no-data', !c);

      // Sichtbarer Hinweis (kleine Zahl)
      if (c && !c.resolved) {
        m.textContent = '💬';
      } else if (c && c.resolved) {
        m.textContent = '✅';
      } else {
        m.textContent = '⁠'; // WORD JOINER
      }
    });
  }

  // Marken nach jedem Neuzeichnen aktualisieren
  document.addEventListener('click', e => {
    const marker = e.target.closest('.j-comment-marker[data-cid]');
    if (!marker) return;

    e.preventDefault();
    e.stopPropagation();

    const cid = marker.dataset.cid;
    oeffnen();

    // Zur entsprechenden Karte springen
    setTimeout(() => {
      const karte = leiste.querySelector('.comment-card[data-cid="' + CSS.escape(cid) + '"]');
      if (karte) karte.scrollIntoView({ behavior: 'smooth', block: 'center' });
      karte && karte.classList.add('highlight');
      setTimeout(() => karte && karte.classList.remove('highlight'), 2000);
    }, 100);
  });

  /* ── Neuen Kommentar hinzufügen ────────────────────────────────────── */
  E('comment-add-btn')?.addEventListener('click', () => {
    const ta = E('comment-new-text');
    if (!ta || !ta.value.trim()) return;

    const pgId = S.activePgId;
    if (!pgId) return;

    // Schreibmarke merken
    const sel = window.getSelection();
    const hatMarke = sel && sel.rangeCount && sel.getRangeAt(0).collapsed;

    if (!hatMarke) {
      toast((typeof t === 'function' && t('commentNeedsCaret')) || 'Erst in den Text klicken, dort soll die Marke hin.', true);
      return;
    }

    const comment = addComment(pgId, ta.value.trim());
    if (!comment) return;

    insertCommentMarker(comment.id);
    ta.value = '';
    zeichneKarten();
    aktualisiereMarken();
    oeffnen();
  });

  /* ── Button in der Werkzeugleiste ─────────────────────────────────── */
  function baueKnopf() {
    const insertPop = E('insert-pop');
    if (!insertPop) return setTimeout(baueKnopf, 200);

    // Trennlinie und Knopf im Einfügen-Menü
    const sep = document.createElement('div');
    sep.className = 'tb-sep';
    sep.style.margin = '4px 8px';

    const btn = document.createElement('button');
    btn.id = 'ins-comment';
    btn.className = 'pop-item';
    btn.innerHTML = '<span class="pop-item-icon">💬</span>'
      + '<span class="pop-item-label">'
      + ((typeof t === 'function' && t('addComment')) || 'Kommentar')
      + '</span>';

    btn.addEventListener('click', () => {
      // Schreibmarke prüfen
      const sel = window.getSelection();
      const hatMarke = sel && sel.rangeCount && sel.getRangeAt(0).collapsed;
      if (!hatMarke) {
        toast((typeof t === 'function' && t('commentNeedsCaret')) || 'Erst in den Text klicken.', true);
        return;
      }

      const pgId = S.activePgId;
      if (!pgId) return;

      // Kurzen Text erfragen
      const text = window.prompt(
        (typeof t === 'function' && t('commentPlaceholder')) || 'Kommentar …'
      );
      if (!text || !text.trim()) return;

      const comment = addComment(pgId, text.trim());
      if (!comment) return;

      insertCommentMarker(comment.id);
      aktualisiereMarken();
      oeffnen();

      // Einfügen-Menü schließen
      const pop = E('insert-pop');
      if (pop) pop.style.display = 'none';
    });

    // Hinter dem Formel-Knopf einfügen
    const formulaBtn = E('ins-formula');
    if (formulaBtn && formulaBtn.parentElement) {
      formulaBtn.parentElement.insertBefore(sep, formulaBtn.nextSibling);
      formulaBtn.parentElement.insertBefore(btn, sep.nextSibling);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', baueKnopf);
  } else {
    baueKnopf();
  }

  /* ── Bei Seitenwechsel neu zeichnen ────────────────────────────────── */
  // Wir hängen uns an setActivePg – einen einfachen observer auf
  // S.activePgId gibt es nicht, also patchen wir setActivePg.
  const origSetActive = window.setActivePg;
  if (typeof origSetActive === 'function') {
    window.setActivePg = function (pgId) {
      origSetActive.apply(this, arguments);
      setTimeout(() => {
        aktualisiereMarken();
        if (leiste.style.display !== 'none') zeichneKarten();
      }, 50);
    };
  }

  /* ── Nach dem Laden alle Marken aktualisieren ──────────────────────── */
  window.addEventListener('load', () => {
    setTimeout(aktualisiereMarken, 500);
  });

  /* ── Global erreichbar ────────────────────────────────────────────── */
  window.refreshComments = function () {
    aktualisiereMarken();
    if (leiste.style.display !== 'none') zeichneKarten();
  };

})();
