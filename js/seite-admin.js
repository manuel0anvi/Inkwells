/* ══════════════════════════════════════════════════════════════════════
   ADMINSEITE

   Alles hier ist Bedienoberfläche. Ob ein Löschen oder Speichern
   tatsächlich durchgeht, entscheidet Firestore anhand der angemeldeten
   Kennung (siehe website/firestore.rules). Wer diese Seite ohne gültige
   Anmeldung öffnet, sieht sie gar nicht erst – und käme selbst dann nicht
   an die Daten.

   Die Beitragsliste ist bewusst dieselbe Darstellung wie im Forum: gleiche
   Klassen, gleiche Stildatei (css/forum.css). Moderiert wird dort, wo man
   die Beiträge auch liest.
   ══════════════════════════════════════════════════════════════════════ */

let adminApi = null;
let posts = [];
let currentFilter = 'all';

/* Arbeitsfassung der Datenschutzerklärung, je Sprache. Wird beim ersten
   Öffnen des Reiters aus Firestore oder aus js/privacy-content.js befüllt. */
let privacyDraft = null;
let privacyUpdated = '';
let privacyFromDb = false;

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const locale = lang === 'de' ? 'de-DE' : lang === 'it' ? 'it-IT' : 'en-GB';
  return date.toLocaleDateString(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function showStatus(id, message, kind) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message;
  node.className = 'admin-status' + (kind ? ' ' + kind : '');
}

/* ── Reiter ─────────────────────────────────────────────────────────── */

function switchPanel(name) {
  /* ══ NACHRICHTEN AN DIE APP ══════════════════════════════════════════
   Eine Nachricht landet in site_content/nachrichten. Jede Installation
   mit Internet liest das beim Start - auch die ohne Konto, denn die App
   meldet jedes Geraet anonym bei Firebase an.

   >>> Der Empfaengerkreis ist eine Hoeflichkeit, keine Sperre <<<
   Das Dokument ist oeffentlich lesbar; die Auswahl trifft die App. Wer
   die Datenbank direkt abfragt, sieht auch, was nicht fuer ihn gedacht
   war. Fuer Ankuendigungen reicht das - Vertrauliches gehoert hier nicht
   hinein. Dieselbe Warnung steht in src/core/postfach.js.
   ══════════════════════════════════════════════════════════════════ */

const nachrichtFeld = (id) => document.getElementById(id);

function nachrichtAusFormular() {
  const holen = (id) => (nachrichtFeld(id).value || '').trim();

  const titelDe = holen('nachricht-titel-de');
  const textDe = holen('nachricht-text-de');
  if (!titelDe || !textDe) return null;

  const art = nachrichtFeld('nachricht-art').value;
  const bis = holen('nachricht-bis');
  const gewaehlt = (name) => {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : 'alle';
  };
  const anmeldung = gewaehlt('ziel-anmeldung');
  const anbieter = gewaehlt('ziel-anbieter');
  const fassung = gewaehlt('ziel-fassung');

  return {
    titel: { de: titelDe, en: holen('nachricht-titel-en'), it: holen('nachricht-titel-it') },
    text:  { de: textDe,  en: holen('nachricht-text-en'),  it: holen('nachricht-text-it') },
    art: art === 'banner' ? 'banner' : 'fenster',
    sofort: art === 'fenster-sofort',
    /* Aus den Einfachauswahlen werden dieselben Felder wie bisher - die
       Auswertung in src/core/postfach.js bleibt unveraendert. Die Form
       hier verhindert nur Kombinationen, die niemanden treffen. */
    ziel: {
      nurAngemeldete: anmeldung !== 'alle',
      nurGoogle:      anmeldung !== 'alle' && anbieter === 'google',
      nurMicrosoft:   anmeldung !== 'alle' && anbieter === 'microsoft',
      nurStore:       fassung === 'store',
      nurWebsite:     fassung === 'website',
      /* Derselbe Haken, zwei Felder - welches gemeint ist, entscheidet
         die Anmelde-Zeile darueber. */
      nurNeue:           anmeldung === 'alle' && nachrichtFeld('ziel-neue').checked,
      nurNeuAngemeldete: anmeldung !== 'alle' && nachrichtFeld('ziel-neue').checked
    },
    /* Ende des Tages, nicht Mitternacht: sonst waere eine Nachricht am
       eingetragenen Tag selbst schon abgelaufen. */
    gueltigBis: bis ? new Date(bis + 'T23:59:59.000Z').toISOString() : null
  };
}

function nachrichtFormularLeeren() {
  for (const id of ['nachricht-titel-de', 'nachricht-titel-en', 'nachricht-titel-it',
                    'nachricht-text-de', 'nachricht-text-en', 'nachricht-text-it',
                    'nachricht-bis']) {
    nachrichtFeld(id).value = '';
  }
  nachrichtFeld('ziel-neue').checked = false;
  for (const [name, wert] of [['ziel-anmeldung', 'alle'],
                              ['ziel-anbieter', 'egal'],
                              ['ziel-fassung', 'alle']]) {
    const el = document.querySelector('input[name="' + name + '"][value="' + wert + '"]');
    if (el) el.checked = true;
  }
  anbieterZeileZeigen();
  datumKnopfZeigen();
  nachrichtFeld('nachricht-art').value = 'fenster-start';
}

function zielText(ziel) {
  const z = ziel || {};
  const teile = [];
  if (z.nurAngemeldete) teile.push(t('admin_ziel_angemeldete') || 'Nur Angemeldete');
  if (z.nurStore) teile.push(t('admin_ziel_store') || 'Nur Store');
  if (z.nurWebsite) teile.push(t('admin_ziel_website') || 'Nur Website');
  if (z.nurGoogle) teile.push(t('admin_ziel_google') || 'Nur Google');
  if (z.nurMicrosoft) teile.push(t('admin_ziel_microsoft') || 'Nur Microsoft');
  if (z.nurNeue) teile.push(t('admin_ziel_neue') || 'Nur Erststart');
  return teile.length ? teile.join(' · ') : (t('admin_ziel_alle') || 'Alle');
}

async function nachrichtenZeichnen() {
  const kasten = document.getElementById('nachricht-liste');
  if (!kasten) return;

  let liste = [];
  try {
    liste = await adminApi.ladeNachrichten();
  } catch (err) {
    showStatus('nachricht-status', describeAdminError(err), 'err');
    return;
  }

  kasten.innerHTML = '';
  if (!liste.length) {
    const leer = document.createElement('p');
    leer.className = 'admin-hint';
    leer.textContent = t('admin_nachricht_keine') || 'Noch nichts verschickt.';
    kasten.appendChild(leer);
    return;
  }

  const jetzt = Date.now();

  for (const n of liste) {
    /* <details> statt eigener Aufklapp-Logik: das Verhalten bringt der
       Browser mit, es ist mit der Tastatur bedienbar und braucht kein
       Skript. */
    const eintrag = document.createElement('details');
    eintrag.className = 'nachricht-eintrag';

    const kopf = document.createElement('summary');

    const titel = document.createElement('span');
    titel.className = 'n-titel';
    titel.textContent = (n.titel && n.titel.de) || '(ohne Titel)';
    kopf.appendChild(titel);

    const abgelaufen = n.gueltigBis && !Number.isNaN(Date.parse(n.gueltigBis))
      && Date.parse(n.gueltigBis) < jetzt;

    const marken = document.createElement('span');
    marken.className = 'n-marken';

    // WIE es erscheint
    const wie = document.createElement('span');
    wie.className = 'marke wie';
    wie.textContent = n.art === 'banner'
      ? (t('admin_marke_postfach') || 'Postfach')
      : (n.sofort ? (t('admin_marke_sofort') || 'sofort')
                  : (t('admin_marke_start') || 'beim Start'));
    marken.appendChild(wie);

    // WEN es erreicht – jeder Haken eine eigene Marke
    for (const [feld, schluessel, rueckfall] of [
      /* Bei "nur Google" ist "angemeldet" selbstverstaendlich - die Marke
         dafuer waere doppelt gemoppelt und macht die Zeile unruhig. */
      ['nurAngemeldete', 'admin_marke_angemeldet', 'angemeldet'],
      ['nurGoogle', 'admin_marke_google', 'Google'],
      ['nurMicrosoft', 'admin_marke_microsoft', 'Microsoft'],
      ['nurStore', 'admin_marke_store', 'Store'],
      ['nurWebsite', 'admin_marke_website', 'Website'],
      ['nurNeue', 'admin_marke_neue', 'neu installiert'],
      ['nurNeuAngemeldete', 'admin_marke_neu_angemeldet', 'neu angemeldet']
    ]) {
      if (!(n.ziel && n.ziel[feld])) continue;
      if (feld === 'nurAngemeldete' && (n.ziel.nurGoogle || n.ziel.nurMicrosoft)) continue;
      const m = document.createElement('span');
      m.className = 'marke wen';
      m.textContent = t(schluessel) || rueckfall;
      marken.appendChild(m);
    }

    if (!marken.querySelector('.wen')) {
      const alle = document.createElement('span');
      alle.className = 'marke wen';
      alle.textContent = t('admin_ziel_alle') || 'Alle';
      marken.appendChild(alle);
    }

    if (abgelaufen) {
      const ab = document.createElement('span');
      ab.className = 'marke abgelaufen';
      ab.textContent = t('admin_nachricht_abgelaufen') || 'abgelaufen';
      marken.appendChild(ab);
    }

    kopf.appendChild(marken);
    eintrag.appendChild(kopf);

    // Aufgeklappt: die Zeitangaben und der Text in allen gepflegten Sprachen
    const koerper = document.createElement('div');
    koerper.className = 'n-koerper';

    const wann = new Date(n.erstellt);
    const zeile = document.createElement('p');
    zeile.className = 'n-zeit';
    const teile = [];
    if (!Number.isNaN(wann.getTime())) {
      teile.push((t('admin_nachricht_am') || 'Verschickt am {d}')
        .replace('{d}', wann.toLocaleDateString()));
    }
    teile.push(n.gueltigBis && !Number.isNaN(Date.parse(n.gueltigBis))
      ? (t('admin_nachricht_bis_am') || 'zustellen bis {d}')
        .replace('{d}', new Date(n.gueltigBis).toLocaleDateString())
      : (t('admin_nachricht_unbegrenzt') || 'unbegrenzt'));
    zeile.textContent = teile.join(' · ');
    koerper.appendChild(zeile);

    for (const [kuerzel, name] of [['de', 'Deutsch'], ['en', 'English'], ['it', 'Italiano']]) {
      const txt = (n.text && n.text[kuerzel] || '').trim();
      if (!txt) continue;
      const block = document.createElement('div');
      block.className = 'n-sprache';
      const kopfz = document.createElement('div');
      kopfz.className = 'n-sprache-kopf';
      kopfz.textContent = name;
      const inhalt = document.createElement('div');
      inhalt.className = 'n-text';
      inhalt.textContent = txt;
      block.append(kopfz, inhalt);
      koerper.appendChild(block);
    }

    const weg = document.createElement('button');
    weg.type = 'button';
    weg.className = 'btn-m warn';
    weg.textContent = t('admin_nachricht_zurueck') || 'Zurückziehen';
    weg.addEventListener('click', async () => {
      /* Zurueckziehen nimmt sie aus jedem Postfach - auch bei denen, die
         sie schon gesehen haben. Gelesen ist gelesen; sie wird ab jetzt
         nur nicht mehr angezeigt. */
      if (!confirm(t('admin_nachricht_zurueck_sicher')
        || 'Diese Nachricht aus allen Postfächern entfernen?')) return;
      try {
        await adminApi.ziehNachrichtZurueck(n.id);
        showStatus('nachricht-status', t('admin_nachricht_zurueckgezogen') || 'Zurückgezogen.', 'ok');
        await nachrichtenZeichnen();
      } catch (err) {
        showStatus('nachricht-status', describeAdminError(err), 'err');
      }
    });
    koerper.appendChild(weg);

    eintrag.appendChild(koerper);
    kasten.appendChild(eintrag);
  }
}

/* Die Anbieter-Auswahl ergibt nur Sinn, wenn ueberhaupt auf Angemeldete
   eingeschraenkt wird - sonst stuende dort eine Auswahl ohne Wirkung. */
function anbieterZeileZeigen() {
  const an = document.querySelector('input[name="ziel-anmeldung"]:checked');
  document.getElementById('ziel-anbieter-zeile').style.display =
    (an && an.value === 'angemeldet') ? 'flex' : 'none';
  neueHakenBeschriften();
}

/* Der "neu"-Haken meint zweierlei, je nachdem, ob auf Angemeldete
   eingeschraenkt ist: sonst waere "neu installiert UND nur angemeldete"
   eine Kombination, die niemanden erreicht - beim allerersten Start ist
   noch keiner angemeldet. */
function neueHakenBeschriften() {
  const an = document.querySelector('input[name="ziel-anmeldung"]:checked');
  const angemeldet = an && an.value === 'angemeldet';
  const feld = document.getElementById('ziel-neue-text');
  const schluessel = angemeldet ? 'admin_ziel_neu_angemeldet' : 'admin_ziel_neue';
  feld.dataset.i18n = schluessel;
  feld.textContent = t(schluessel)
    || (angemeldet ? 'Nur neu angemeldete' : 'Nur neu installierte');
}

/* Datum wieder loeschen. Sichtbar nur, wenn eines gesetzt ist. */
function datumKnopfZeigen() {
  document.getElementById('nachricht-bis-weg').style.display =
    document.getElementById('nachricht-bis').value ? '' : 'none';
}

document.getElementById('nachricht-bis').addEventListener('change', datumKnopfZeigen);
document.getElementById('nachricht-bis').addEventListener('input', datumKnopfZeigen);
document.getElementById('nachricht-bis-weg').addEventListener('click', () => {
  document.getElementById('nachricht-bis').value = '';
  datumKnopfZeigen();
});

for (const el of document.querySelectorAll('input[name="ziel-anmeldung"]')) {
  el.addEventListener('change', anbieterZeileZeigen);
}

/* ── Formular auf und zu ─────────────────────────────────────────────
   Es liegt hinter einem Knopf, damit man beim Hereinkommen die Liste
   sieht und nicht ein leeres Formular. */
function nachrichtFormularZeigen(offen) {
  document.getElementById('nachricht-formular').style.display = offen ? 'block' : 'none';
  document.getElementById('nachricht-neu').style.display = offen ? 'none' : '';
  if (offen) document.getElementById('nachricht-titel-de').focus();
}

document.getElementById('nachricht-neu').addEventListener('click', () => {
  nachrichtFormularLeeren();
  sprachReiterWaehlen('de');
  nachrichtFormularZeigen(true);
});

document.getElementById('nachricht-abbrechen').addEventListener('click', () => {
  nachrichtFormularZeigen(false);
});

/* ── Sprachreiter ────────────────────────────────────────────────────
   Drei Blaetter, eines sichtbar. Deutsch traegt den Rueckfall fuer alles,
   was in den anderen leer bleibt. */
function sprachReiterWaehlen(sprache) {
  for (const tab of document.querySelectorAll('.sprach-tab')) {
    tab.classList.toggle('active', tab.dataset.sprache === sprache);
  }
  for (const blatt of document.querySelectorAll('.sprach-blatt')) {
    blatt.classList.toggle('active', blatt.dataset.sprache === sprache);
  }
}

for (const tab of document.querySelectorAll('.sprach-tab')) {
  tab.addEventListener('click', () => sprachReiterWaehlen(tab.dataset.sprache));
}

document.getElementById('nachricht-senden').addEventListener('click', async () => {
  const nachricht = nachrichtAusFormular();
  if (!nachricht) {
    /* Ohne deutschen Text gibt es keinen Rueckfall - dann saehe ein Teil
       der Nutzer eine leere Nachricht. */
    sprachReiterWaehlen('de');
    showStatus('nachricht-status',
      t('admin_nachricht_fehlt') || 'Überschrift und Text auf Deutsch werden gebraucht.', 'err');
    return;
  }
  try {
    await adminApi.verschickeNachricht(nachricht);
    nachrichtFormularLeeren();
    nachrichtFormularZeigen(false);
    showStatus('nachricht-status', t('admin_nachricht_weg') || 'Verschickt.', 'ok');
    await nachrichtenZeichnen();
  } catch (err) {
    showStatus('nachricht-status', describeAdminError(err), 'err');
  }
});

document.getElementById('nachricht-aufraeumen').addEventListener('click', async () => {
  try {
    const weg = await adminApi.raeumeNachrichtenAuf();
    showStatus('nachricht-status',
      (t('admin_nachricht_aufgeraeumt') || '{n} abgelaufene entfernt.').replace('{n}', weg), 'ok');
    await nachrichtenZeichnen();
  } catch (err) {
    showStatus('nachricht-status', describeAdminError(err), 'err');
  }
});


for (const tab of document.querySelectorAll('.admin-tab')) {
    tab.classList.toggle('active', tab.dataset.panel === name);
  }
  for (const panel of document.querySelectorAll('.admin-panel')) {
    panel.classList.toggle('active', panel.id === 'panel-' + name);
  }
  if (name === 'privacy' && !privacyDraft) loadPrivacyDraft();
  // Die Liste jedes Mal frisch: sie ist kurz, und ein veralteter Stand
  // waere hier schlimmer als ein Zugriff mehr.
  if (name === 'nachrichten') nachrichtenZeichnen();
  if (name === 'meldungen') meldungenZeichnen();
}

/* ══════════════════════════════════════════════════════════════════════
   MELDUNGEN UND SPERREN

   Was gilt, steht in src/core/melden.js (in der App). Diese Seite kennt
   dieselben Regeln noch einmal – sie laeuft im Browser und kann das
   Modul der App nicht laden. Wer dort etwas aendert, muss hier
   nachsehen: die Umfangs-Namen und die Gruende stehen an beiden Orten,
   und zusaetzlich in website/firestore.rules.
   ══════════════════════════════════════════════════════════════════════ */

const SPERR_UMFANG = ['neueFreigaben', 'selbstTeilen', 'laufendeRaus'];

const GRUND_TEXTE = {
  beleidigung:   'Beleidigung oder Bedrohung',
  fremdeInhalte: 'Unangemessene Inhalte',
  zerstoerung:   'Zerstört die gemeinsame Arbeit',
  werbung:       'Werbung',
  sonstiges:      'Etwas anderes'
};

let meldungen = [];
let sperren = [];
/* Wen die Massnahme betrifft. Steht hier und nicht im Formular, weil das
   Formular nur Umfang, Dauer und Text traegt. */
let massnahmeZiel = null;

function sperreLaeuft(sp) {
  if (!sp) return false;
  if (!SPERR_UMFANG.some(k => sp.umfang && sp.umfang[k] === true)) return false;
  if (!sp.bis) return true;
  const bis = (sp.bis instanceof Date) ? sp.bis.getTime() : Date.parse(sp.bis);
  return !Number.isNaN(bis) && bis > Date.now();
}

function umfangText(umfang) {
  const teile = [];
  if (umfang.neueFreigaben) teile.push(t('admin_sperre_neue_kurz'));
  if (umfang.selbstTeilen)  teile.push(t('admin_sperre_teilen_kurz'));
  if (umfang.laufendeRaus)  teile.push(t('admin_sperre_raus_kurz'));
  return teile.join(' · ');
}

async function meldungenZeichnen() {
  const liste = document.getElementById('meldungen-liste');
  const sperrBox = document.getElementById('sperren-liste');
  if (!liste) return;

  try {
    const api = adminApi;
    [meldungen, sperren] = await Promise.all([api.ladeMeldungen(), api.ladeSperren()]);
  } catch (err) {
    liste.innerHTML = '<div class="forum-error">' + escapeHtml(describeAdminError(err)) + '</div>';
    return;
  }

  /* ══════════════════════════════════════════════════════════════════
     HIER WIRD NICHTS ABGEHAKT, HIER WIRD GELOESCHT

     Es gab einen Abhaken-Knopf und einen Filter dazu. Beides ist weg,
     und zwar aus einem einfachen Grund: eine Meldung, um die sich jemand
     gekuemmert hat, hat hier nichts mehr zu suchen – sie gehoert weg.
     Ein zweiter Zustand zwischen „offen" und „geloescht" war nur eine
     Stelle mehr, an der etwas liegen bleiben kann. So steht es auch in
     der Datenschutzerklaerung: geloescht, sobald erledigt.

     Gezeigt wird deshalb ALLES, was da ist. Dass der Besitzer schon
     entschieden hat, steht als Vermerk an der Karte – es nimmt die
     Meldung aber nicht aus der Liste, denn gerade dann ist interessant,
     ob jemand wiederholt auffaellt.
     ══════════════════════════════════════════════════════════════════ */
  const zeigen = meldungen;
  const offen = meldungen.length;
  const zahl = document.getElementById('meldungen-zahl');
  if (zahl) {
    zahl.textContent = String(offen);
    zahl.style.display = offen ? '' : 'none';
  }

  liste.innerHTML = '';
  if (!zeigen.length) {
    liste.innerHTML = '<div class="v-loading" style="border:0.5px solid var(--navy-border); background:var(--navy-card);">'
      + escapeHtml(t('admin_meldungen_keine')) + '</div>';
  }

  for (const m of zeigen) {
    const karte = document.createElement('div');
    karte.className = 'meldung-karte';

    /* Wie oft ist diese Adresse schon aufgefallen? Eine einzelne Meldung
       sagt wenig; fuenf gegen dieselbe Person sagen viel. Und andersherum
       genauso: wer selbst staendig meldet, faellt hier ebenfalls auf. */
    const gegenIhn = meldungen.filter(x => x.gemeldetEmail === m.gemeldetEmail).length;
    const vonIhm = meldungen.filter(x => x.melderEmail === m.melderEmail).length;
    const sp = sperren.find(x => x.email === m.gemeldetEmail);

    karte.innerHTML =
      '<div class="meldung-kopf">' + escapeHtml(GRUND_TEXTE[m.grund] || m.grund)
        /* Was der Besitzer entschieden hat – und getrennt davon, ob hier
           schon jemand daraufgesehen hat. */
        + (m.erledigt ? ' <span class="meldung-fertig">' + escapeHtml(
             m.massnahme === 'verbannt' ? t('admin_meldung_verbannt')
             : m.massnahme === 'nichts' ? t('admin_meldung_geprueft')
             : t('admin_meldung_erledigt')) + '</span>' : '')
        + (sperreLaeuft(sp) ? ' <span class="meldung-gesperrt">' + escapeHtml(t('admin_meldung_gesperrt')) + '</span>' : '')
        /* Der Besitzer wurde nicht benachrichtigt – hier liegt die Sache
           allein. Das muss dranstehen, sonst wartet man auf einen, der
           gar nichts davon weiss. */
        + (m.gegenBesitzer ? ' <span class="meldung-besitzer">' + escapeHtml(t('admin_meldung_gegen_besitzer')) + '</span>' : '')
      + '</div>'
      + '<div class="meldung-zeile"><b>' + escapeHtml(t('admin_meldung_gegen')) + '</b> '
        + escapeHtml(m.gemeldetName ? m.gemeldetName + ' · ' + m.gemeldetEmail : m.gemeldetEmail)
        + (gegenIhn > 1 ? ' <span class="meldung-oft">' + escapeHtml(t('admin_meldung_mehrfach').replace('{n}', gegenIhn)) + '</span>' : '')
      + '</div>'
      + '<div class="meldung-zeile"><b>' + escapeHtml(t('admin_meldung_von')) + '</b> '
        + escapeHtml(m.melderEmail)
        + (vonIhm > 3 ? ' <span class="meldung-oft warn">' + escapeHtml(t('admin_meldung_vielmelder').replace('{n}', vonIhm)) + '</span>' : '')
      + '</div>'
      + '<div class="meldung-zeile dim">' + escapeHtml([m.docTitel, m.docId,
          m.erstellt ? m.erstellt.toLocaleString() : ''].filter(Boolean).join(' · ')) + '</div>'
      + (m.notiz ? '<div class="meldung-notiz">' + escapeHtml(m.notiz) + '</div>' : '');

    const knoepfe = document.createElement('div');
    knoepfe.className = 'meldung-knoepfe';

    const massnahme = document.createElement('button');
    massnahme.type = 'button';
    massnahme.className = 'btn-p';
    massnahme.textContent = t('admin_meldung_massnahme');
    massnahme.addEventListener('click', () => oeffneMassnahme(m.gemeldetEmail, m.gemeldetName));
    knoepfe.appendChild(massnahme);

    const weg = document.createElement('button');
    weg.type = 'button';
    weg.className = 'forum-del-btn';
    weg.textContent = t('admin_meldung_loeschen');
    weg.addEventListener('click', async () => {
      if (!confirm(t('admin_meldung_loeschen_frage'))) return;
      try {
        const api = adminApi;
        await api.loescheMeldung(m.id);
        await meldungenZeichnen();
      } catch (err) {
        showStatus('meldung-status', describeAdminError(err), 'err');
      }
    });
    knoepfe.appendChild(weg);

    karte.appendChild(knoepfe);
    liste.appendChild(karte);
  }

  // ── Die laufenden Sperren ───────────────────────────────────────────
  sperrBox.innerHTML = '';
  const laufend = sperren.filter(sperreLaeuft);
  if (!laufend.length) {
    sperrBox.innerHTML = '<div class="v-loading" style="border:0.5px solid var(--navy-border); background:var(--navy-card);">'
      + escapeHtml(t('admin_sperren_keine')) + '</div>';
  }
  for (const sp of laufend) {
    const zeile = document.createElement('div');
    zeile.className = 'sperre-zeile';
    zeile.innerHTML =
      '<div class="sperre-wer">' + escapeHtml(sp.email) + '</div>'
      + '<div class="sperre-was">' + escapeHtml(umfangText(sp.umfang)) + '</div>'
      + '<div class="sperre-bis">' + escapeHtml(sp.bis
          ? t('admin_sperre_bis').replace('{d}', sp.bis.toLocaleDateString())
          : t('admin_sperre_unbegrenzt')) + '</div>'
      + (sp.grund ? '<div class="sperre-grund">' + escapeHtml(sp.grund) + '</div>' : '');

    const auf = document.createElement('button');
    auf.type = 'button';
    auf.className = 'btn-m';
    auf.textContent = t('admin_sperre_aufheben');
    auf.addEventListener('click', async () => {
      auf.disabled = true;
      try {
        const api = adminApi;
        await api.hebeSperreAuf(sp.email);
        await meldungenZeichnen();
      } catch (err) {
        showStatus('meldung-status', describeAdminError(err), 'err');
        auf.disabled = false;
      }
    });
    zeile.appendChild(auf);
    sperrBox.appendChild(zeile);
  }
}

/* ── Der Massnahmen-Dialog ──────────────────────────────────────────── */

function oeffneMassnahme(email, name) {
  massnahmeZiel = { email, name: name || '' };

  const vorhanden = sperren.find(x => x.email === email);
  for (const k of SPERR_UMFANG) {
    document.getElementById('sperr-' + k).checked =
      !!(vorhanden && vorhanden.umfang && vorhanden.umfang[k]);
  }
  /* Nichts angekreuzt heisst: noch keine Sperre. Dann die Vorauswahl, die
     man in neun von zehn Faellen will – nicht mehr hineinlassen, aber die
     eigenen Sachen weiter behalten duerfen. */
  if (!SPERR_UMFANG.some(k => document.getElementById('sperr-' + k).checked)) {
    document.getElementById('sperr-neueFreigaben').checked = true;
  }

  document.getElementById('sperr-grund').value = (vorhanden && vorhanden.grund) || '';
  document.getElementById('massnahme-titel-de').value = '';
  document.getElementById('massnahme-text-de').value = '';
  document.getElementById('massnahme-wen').textContent =
    t('admin_massnahme_wen').replace('{n}', name ? name + ' · ' + email : email);

  document.getElementById('massnahme-hg').style.display = 'flex';
}

function schliesseMassnahme() {
  document.getElementById('massnahme-hg').style.display = 'none';
  massnahmeZiel = null;
}

/** Die Nachricht aus dem Dialog – oder null, wenn keine geschrieben wurde. */
function massnahmeNachricht() {
  const titel = (document.getElementById('massnahme-titel-de').value || '').trim();
  const text = (document.getElementById('massnahme-text-de').value || '').trim();
  if (!titel || !text) return null;

  /* Aufbau wie in site_content/nachrichten, damit das Postfach der App
     beide Quellen gleich behandeln kann (src/ui/postfach.js).

     Kein `ziel`: die Nachricht liegt schon unter der Adresse des
     Empfaengers, und niemand sonst darf sie lesen. `sofort` ist wahr –
     wer gerade gesperrt wurde, soll nicht bis zum naechsten Start
     warten, um zu erfahren warum. */
  return {
    id: 'dp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    erstellt: new Date().toISOString(),
    titel: { de: titel, en: '', it: '' },
    text: { de: text, en: '', it: '' },
    art: 'fenster',
    sofort: true,
    ziel: {},
    gueltigBis: null
  };
}

document.getElementById('massnahme-abbruch')?.addEventListener('click', schliesseMassnahme);

document.getElementById('massnahme-hg')?.addEventListener('click', (e) => {
  if (e.target.id === 'massnahme-hg') schliesseMassnahme();
});

document.getElementById('massnahme-nur-nachricht')?.addEventListener('click', async () => {
  if (!massnahmeZiel) return;
  const nachricht = massnahmeNachricht();
  if (!nachricht) { showStatus('meldung-status', t('admin_massnahme_ohne_text'), 'err'); return; }
  try {
    const api = adminApi;
    await api.schickeDirektpost(massnahmeZiel.email, nachricht);
    schliesseMassnahme();
    showStatus('meldung-status', t('admin_massnahme_geschickt'), 'ok');
  } catch (err) {
    showStatus('meldung-status', describeAdminError(err), 'err');
  }
});

document.getElementById('massnahme-sperren')?.addEventListener('click', async () => {
  if (!massnahmeZiel) return;

  const umfang = {};
  for (const k of SPERR_UMFANG) umfang[k] = document.getElementById('sperr-' + k).checked;
  if (!SPERR_UMFANG.some(k => umfang[k])) {
    showStatus('meldung-status', t('admin_sperre_ohne_umfang'), 'err');
    return;
  }

  const tage = Number(document.getElementById('sperr-tage').value) || 0;
  const bis = tage > 0 ? new Date(Date.now() + tage * 864e5).toISOString() : null;

  try {
    const api = adminApi;
    await api.setzeSperre({
      email: massnahmeZiel.email,
      bis,
      umfang,
      grund: (document.getElementById('sperr-grund').value || '').trim()
    });

    /* Die Nachricht danach: geht sie schief, ist die Sperre trotzdem
       gesetzt. Andersherum stuende eine Verwarnung im Postfach, ohne
       dass etwas gilt – das waere die schlechtere Reihenfolge. */
    const nachricht = massnahmeNachricht();
    if (nachricht) await api.schickeDirektpost(massnahmeZiel.email, nachricht);

    schliesseMassnahme();
    await meldungenZeichnen();
    showStatus('meldung-status', t('admin_sperre_gesetzt'), 'ok');
  } catch (err) {
    showStatus('meldung-status', describeAdminError(err), 'err');
  }
});

document.getElementById('meldungen-neu-laden')?.addEventListener('click', () => meldungenZeichnen());

/* ══════════════════════════════════════════════════════════════════════
   COMMUNITY
   ══════════════════════════════════════════════════════════════════════ */

function updateCounter(inputId, max) {
  const input = document.getElementById(inputId);
  const counter = document.getElementById(inputId + '-counter');
  if (!input || !counter) return;
  counter.textContent = tf('community_chars_left_of', {
    left: Math.max(0, max - (input.value || '').length),
    max
  });
}

function setFilter(filter) {
  currentFilter = filter;
  for (const btn of document.querySelectorAll('.forum-filter-btn')) {
    btn.classList.toggle('active', btn.id === 'admin-filter-' + filter);
  }
  renderFeed();
}

function toggleAdminPostForm() {
  const card = document.getElementById('admin-post-form-card');
  card.classList.toggle('open');
}

/* Antworten auf- und zuklappen. Die Liste startet zugeklappt, sonst wird
   die Seite bei vielen Antworten unübersichtlich lang. */
function toggleRepliesList(postId) {
  const list = document.getElementById('admin-replies-' + postId);
  const icon = document.getElementById('admin-replies-icon-' + postId);
  if (!list) return;

  const open = list.style.display !== 'none';
  list.style.display = open ? 'none' : 'flex';
  if (icon) icon.textContent = open ? '▼' : '▲';
}

function toggleReplyForm(postId) {
  const form = document.getElementById('admin-reply-form-' + postId);
  if (form) form.classList.toggle('open');
}

async function loadPosts() {
  const list = document.getElementById('admin-feed-list');
  list.innerHTML = `<div class="v-loading">${escapeHtml(t('admin_mod_loading'))}</div>`;

  try {
    posts = await adminApi.listPosts();
    renderFeed();
  } catch (err) {
    list.innerHTML = `<div class="forum-error">${escapeHtml(describeAdminError(err))}</div>`;
  }
}

function renderFeed() {
  const container = document.getElementById('admin-feed-list');
  const filtered = posts.filter(p => currentFilter === 'all' || p.type === currentFilter);

  if (!filtered.length) {
    container.innerHTML = `<div class="v-loading" style="border:0.5px solid var(--navy-border); background:var(--navy-card);">${escapeHtml(t('admin_mod_empty'))}</div>`;
    return;
  }

  container.innerHTML = filtered.map(post => {
    const badge = post.type === 'question' ? t('community_type_question') : t('community_type_bug');
    const replies = post.replies || [];

    /* Angeheftet steht sie ohnehin oben (js/firebase.js); der Streifen
       sagt, warum – genau wie im Forum. */
    const replyItems = replies.map(reply => `
      <div class="reply-item${['inkwells team','inkwell team'].includes(String(reply.author || '').trim().toLowerCase()) ? ' vom-team' : ''}">
        <div class="reply-meta">
          <strong>${escapeHtml(reply.author)}</strong>
          <span>${escapeHtml(formatDate(reply.created_at))}</span>
          <button type="button" class="forum-del-btn" data-del-reply="${escapeHtml(post.id)}" data-reply-id="${escapeHtml(reply.id)}">${escapeHtml(t('admin_mod_delete_reply'))}</button>
        </div>
        <div class="reply-text">${escapeHtml(reply.content)}</div>
      </div>`).join('');

    return `
      <div class="post-item-card ${post.type}">
        <div class="post-meta-line">
          <span class="post-badge ${post.type}">${escapeHtml(badge)}</span>
          <span class="post-author-time">von <strong>${escapeHtml(post.author)}</strong> ${escapeHtml(formatDate(post.created_at))}</span>
          <button type="button" class="forum-del-btn" data-del-post="${escapeHtml(post.id)}">${escapeHtml(t('admin_mod_delete_post'))}</button>
        </div>
        <h3>${escapeHtml(post.title)}</h3>
        <div class="post-body-text">${escapeHtml(post.content)}</div>

        <div class="replies-section">
          <div class="replies-header">
            <span class="replies-title" style="cursor:pointer; user-select:none; display:inline-flex; align-items:center; gap:4px;" data-toggle-replies="${escapeHtml(post.id)}">
              ${replies.length} ${escapeHtml(t('admin_mod_replies'))}
              ${replies.length ? `<span id="admin-replies-icon-${escapeHtml(post.id)}">▼</span>` : ''}
            </span>
            <button type="button" class="reply-toggle-btn" data-toggle-reply-form="${escapeHtml(post.id)}">
              ${escapeHtml(t('admin_mod_reply_send'))}
            </button>
          </div>

          <!-- ── Erst das Formular, dann die Antworten ──────────────────
               Es stand hinter der Liste. Bei einem Beitrag mit vielen
               Antworten sprang der Druck auf „Antworten" damit ans Ende
               der Liste – das Feld lag ausserhalb des Bildes und es sah
               aus, als sei nichts geschehen. Dieselbe Reihenfolge wie im
               Forum selbst (community/index.html). -->
          <form class="reply-form" id="admin-reply-form-${escapeHtml(post.id)}" data-reply-post="${escapeHtml(post.id)}">
            <p class="admin-as-note">${escapeHtml(t('admin_mod_reply_as'))}</p>
            <div class="forum-input-group" style="margin:0;">
              <textarea class="admin-reply-text" rows="2" maxlength="500" required placeholder="${escapeHtml(t('community_add_reply'))}"></textarea>
            </div>
            <button type="submit" class="reply-submit-btn">${escapeHtml(t('admin_mod_reply_send'))}</button>
          </form>

          ${replies.length ? `<div id="admin-replies-${escapeHtml(post.id)}" style="display:none; flex-direction:column; gap:8px; margin-top:14px;">${replyItems}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* Ein einziger Zuhörer für die ganze Liste statt einer je Knopf: die Liste
   wird bei jedem Laden neu gebaut, einzeln angehängte Zuhörer müssten
   jedes Mal mit aufgeräumt werden. */
document.getElementById('admin-feed-list').addEventListener('click', (event) => {
  const target = event.target.closest('[data-del-post], [data-del-reply], [data-toggle-replies], [data-toggle-reply-form]');
  if (!target) return;

  if (target.dataset.delPost) removePost(target.dataset.delPost);
  else if (target.dataset.delReply) removeReply(target.dataset.delReply, target.dataset.replyId);
  else if (target.dataset.toggleReplies) toggleRepliesList(target.dataset.toggleReplies);
  else if (target.dataset.toggleReplyForm) toggleReplyForm(target.dataset.toggleReplyForm);
});

document.getElementById('admin-feed-list').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-reply-post]');
  if (!form) return;
  event.preventDefault();

  const postId = form.dataset.replyPost;
  const textarea = form.querySelector('.admin-reply-text');
  const button = form.querySelector('.reply-submit-btn');
  const content = textarea.value.trim();
  if (!content) return;

  button.disabled = true;
  try {
    await adminApi.createReply(postId, { author: ADMIN_DISPLAY_NAME, content });
    textarea.value = '';
    await loadPosts();
  } catch (err) {
    alert(describeAdminError(err));
  } finally {
    button.disabled = false;
  }
});

async function handleCreatePost(event) {
  event.preventDefault();

  const title = document.getElementById('admin-post-title').value.trim();
  const type = document.getElementById('admin-post-type').value;
  const content = document.getElementById('admin-post-content').value.trim();
  if (!title || !content) return;

  const button = document.getElementById('admin-post-submit');
  button.disabled = true;

  try {
    await adminApi.createPost({ type, title, content, author: ADMIN_DISPLAY_NAME });
    document.getElementById('admin-new-post-form').reset();
    updateCounter('admin-post-title', 120);
    updateCounter('admin-post-content', 2000);
    toggleAdminPostForm();
    await loadPosts();
  } catch (err) {
    alert(describeAdminError(err));
  } finally {
    button.disabled = false;
  }
}

async function removePost(postId) {
  const post = posts.find(p => p.id === postId);
  const ok = await askConfirm({
    title: t('admin_del_post_title'),
    body: post ? `„${post.title}“ — ${t('admin_del_post_body')}` : t('admin_del_post_body'),
    confirm: t('admin_del_confirm'),
    danger: true
  });
  if (!ok) return;

  try {
    await adminApi.deletePost(postId);
    await loadPosts();
  } catch (err) {
    alert(describeAdminError(err));
  }
}

async function removeReply(postId, replyId) {
  const ok = await askConfirm({
    title: t('admin_del_reply_title'),
    body: t('admin_del_reply_body'),
    confirm: t('admin_del_confirm'),
    danger: true
  });
  if (!ok) return;

  try {
    await adminApi.deleteReply(postId, replyId);
    await loadPosts();
  } catch (err) {
    alert(describeAdminError(err));
  }
}

/* ══════════════════════════════════════════════════════════════════════
   DATENSCHUTZERKLÄRUNG

   Bearbeitet werden Überschriften, Absätze und die Kurzübersicht. Listen,
   Tabellen und Verweise bleiben unangetastet: sie stecken in der Struktur
   aus js/privacy-content.js und werden beim Speichern unverändert
   mitgeschrieben. So kann man den Text pflegen, ohne den Aufbau der Seite
   versehentlich zu zerlegen.
   ══════════════════════════════════════════════════════════════════════ */

function updatePrivacyBadge() {
  const badge = document.getElementById('privacy-source-badge');
  if (!badge) return;
  badge.textContent = privacyFromDb ? t('admin_privacy_edited') : t('admin_privacy_original');
  badge.classList.toggle('on', privacyFromDb);
}

async function loadPrivacyDraft() {
  try {
    const stored = await adminApi.loadPrivacy();
    if (stored) {
      privacyDraft = stored.content;
      privacyUpdated = stored.updated || PRIVACY_UPDATED;
      privacyFromDb = true;
    } else {
      // Tiefe Kopie, damit das Original im Script unberührt bleibt
      privacyDraft = JSON.parse(JSON.stringify(PRIVACY));
      privacyUpdated = PRIVACY_UPDATED;
      privacyFromDb = false;
    }
  } catch (err) {
    privacyDraft = JSON.parse(JSON.stringify(PRIVACY));
    privacyUpdated = PRIVACY_UPDATED;
    privacyFromDb = false;
    showStatus('privacy-status', describeAdminError(err), 'err');
  }

  updatePrivacyBadge();
  renderPrivacyEditor();
}

function currentPrivacyLang() {
  return document.getElementById('privacy-lang-select').value;
}

function renderPrivacyEditor() {
  if (!privacyDraft) return;

  const data = privacyDraft[currentPrivacyLang()] || privacyDraft.de;

  /* Überschrift, Unterzeile und Datum schreiben ihre Änderung sofort in die
     Arbeitsfassung. Würden sie erst beim Speichern ausgelesen, wären sie
     beim Wechsel der Sprache verloren – renderPrivacyEditor() überschreibt
     die Felder dann ja mit dem Text der anderen Sprache.

     Zuweisung an .oninput statt addEventListener: die drei Felder stehen
     fest im Dokument, und bei jedem Aufbau käme sonst ein weiterer
     Zuhörer obendrauf. */
  const updatedInput = document.getElementById('privacy-updated-input');
  const titleInput = document.getElementById('privacy-title-input');
  const subtitleInput = document.getElementById('privacy-subtitle-input');

  updatedInput.value = privacyUpdated || '';
  titleInput.value = data.title || '';
  subtitleInput.value = data.subtitle || '';

  updatedInput.oninput = () => { privacyUpdated = updatedInput.value.trim(); };
  titleInput.oninput = () => { data.title = titleInput.value; };
  subtitleInput.oninput = () => { data.subtitle = subtitleInput.value; };

  // Kurzübersicht: Paare aus Begriff und Erklärung
  const summaryBox = document.getElementById('privacy-summary-fields');
  summaryBox.textContent = '';
  (data.summary || []).forEach((pair, index) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid; grid-template-columns:minmax(120px,1fr) 2fr; gap:10px; margin-bottom:8px;';

    const term = document.createElement('input');
    term.type = 'text';
    term.value = pair[0] || '';
    term.addEventListener('input', () => { data.summary[index][0] = term.value; });

    const desc = document.createElement('input');
    desc.type = 'text';
    desc.value = pair[1] || '';
    desc.addEventListener('input', () => { data.summary[index][1] = desc.value; });

    row.append(term, desc);
    summaryBox.appendChild(row);
  });

  // Abschnitte
  const sectionBox = document.getElementById('privacy-section-fields');
  sectionBox.textContent = '';
  (data.sections || []).forEach((section, index) => {
    const block = document.createElement('div');
    block.className = 'admin-section-block';

    const headingField = document.createElement('div');
    headingField.className = 'admin-field';
    const headingLabel = document.createElement('label');
    headingLabel.textContent = t('admin_privacy_section_heading');

    /* Überschrift und Löschknopf in einer Zeile – der Knopf gehört an
       den Abschnitt, den er trifft, und nicht in eine Liste am Ende. */
    const headingRow = document.createElement('div');
    headingRow.style.cssText = 'display:flex; gap:10px; align-items:center;';
    const headingInput = document.createElement('input');
    headingInput.type = 'text';
    headingInput.style.flex = '1';
    headingInput.value = section.h || '';
    headingInput.addEventListener('input', () => { section.h = headingInput.value; });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-m warn';
    delBtn.textContent = t('admin_privacy_section_del');
    delBtn.addEventListener('click', () => entfernePrivacyAbschnitt(index));

    headingRow.append(headingInput, delBtn);
    headingField.append(headingLabel, headingRow);
    block.appendChild(headingField);

    /* Absätze stehen im Datenmodell als Liste. Im Formular sind sie ein
       einziges Feld, in dem eine Leerzeile zwei Absätze trennt – das
       tippt sich weit angenehmer als ein Feld je Absatz. */
    const makeParagraphField = (key) => {
      if (!Array.isArray(section[key])) return;

      const field = document.createElement('div');
      field.className = 'admin-field';
      const label = document.createElement('label');
      label.textContent = t('admin_privacy_paragraphs');
      const area = document.createElement('textarea');
      area.rows = Math.min(10, Math.max(3, section[key].length * 2));
      area.value = section[key].join('\n\n');
      area.addEventListener('input', () => {
        section[key] = area.value.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
      });
      field.append(label, area);
      block.appendChild(field);
    };

    makeParagraphField('p');
    makeParagraphField('p2');

    if (typeof section.note === 'string') {
      const noteField = document.createElement('div');
      noteField.className = 'admin-field';
      noteField.style.marginBottom = '0';
      const noteLabel = document.createElement('label');
      noteLabel.textContent = t('admin_privacy_note');
      const noteArea = document.createElement('textarea');
      noteArea.rows = 2;
      noteArea.value = section.note;
      noteArea.addEventListener('input', () => { section.note = noteArea.value; });
      noteField.append(noteLabel, noteArea);
      block.appendChild(noteField);
    }

    sectionBox.appendChild(block);
  });

  /* Der Knopf zum Anhängen steht UNTER der Liste, dort wo der neue
     Abschnitt auch erscheint. */
  const hinweis = document.createElement('p');
  hinweis.className = 'admin-hint';
  hinweis.style.margin = '4px 0 8px';
  hinweis.textContent = t('admin_privacy_section_hint');

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-m';
  addBtn.textContent = t('admin_privacy_section_add');
  addBtn.addEventListener('click', ergaenzePrivacyAbschnitt);

  sectionBox.append(hinweis, addBtn);
}

/* ══════════════════════════════════════════════════════════════════════
   ABSCHNITTE ANLEGEN UND ENTFERNEN

   >>> Warum immer in ALLEN Sprachen zugleich <<<
   Die Datenschutzseite ist EIN Text in drei Sprachen, und die Abschnitte
   stehen in jeder Sprache an derselben Stelle. Käme einer nur auf Deutsch
   dazu, hätte die englische Seite ihn nicht – und niemand merkte es, denn
   im Formular sieht man immer nur eine Sprache.

   Angelegt wird er deshalb überall, leer; gefüllt wird er je Sprache über
   die Auswahl oben. Solange er leer bleibt, zeigt die Seite ihn gar
   nicht an – datenschutz/index.html überspringt Abschnitte ohne jeden
   Inhalt. Ein halb gefüllter Text steht also nie mit einer leeren
   Überschrift da.
   ══════════════════════════════════════════════════════════════════════ */

/* Die drei Sprachen der Seite. Ausdruecklich aufgezaehlt und nicht ueber
   Object.keys geholt: im gespeicherten Dokument koennen auch andere
   Felder stehen (Zeitstempel), und die haben keine Abschnitte. */
const PRIVACY_SPRACHEN = ['de', 'en', 'it'];

function privacySprachen() {
  return PRIVACY_SPRACHEN.map((k) => privacyDraft && privacyDraft[k]).filter(Boolean);
}

function ergaenzePrivacyAbschnitt() {
  if (!privacyDraft) return;
  for (const fassung of privacySprachen()) {
    if (!Array.isArray(fassung.sections)) fassung.sections = [];
    fassung.sections.push({ h: '', p: [] });
  }
  renderPrivacyEditor();
  // Ans Ende rollen: der neue Abschnitt steht dort, wo man ihn sucht
  const box = document.getElementById('privacy-section-fields');
  const letzter = box && box.querySelector('.admin-section-block:last-of-type');
  if (letzter) letzter.scrollIntoView({ block: 'nearest' });
}

async function entfernePrivacyAbschnitt(index) {
  if (!privacyDraft) return;
  const ok = await askConfirm({
    title: t('admin_privacy_section_del_title'),
    body: t('admin_privacy_section_del_body'),
    confirm: t('admin_privacy_section_del'),
    danger: true
  });
  if (!ok) return;

  for (const fassung of privacySprachen()) {
    if (Array.isArray(fassung.sections)) fassung.sections.splice(index, 1);
  }
  renderPrivacyEditor();
}

async function savePrivacyDraft() {
  // Alle Felder schreiben schon beim Tippen in privacyDraft – hier ist
  // deshalb nichts mehr einzusammeln.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(privacyUpdated)) {
    showStatus('privacy-status', t('admin_privacy_date_invalid'), 'err');
    return;
  }

  const button = document.getElementById('privacy-save');
  button.disabled = true;
  try {
    await adminApi.savePrivacy(privacyDraft, privacyUpdated);
    privacyFromDb = true;
    updatePrivacyBadge();
    showStatus('privacy-status', t('admin_privacy_saved'), 'ok');
  } catch (err) {
    showStatus('privacy-status', describeAdminError(err), 'err');
  } finally {
    button.disabled = false;
  }
}

async function resetPrivacyDraft() {
  const ok = await askConfirm({
    title: t('admin_privacy_reset_title'),
    body: t('admin_privacy_reset_body'),
    confirm: t('admin_privacy_reset_confirm'),
    danger: true
  });
  if (!ok) return;

  try {
    await adminApi.resetPrivacy();
    privacyDraft = null;
    await loadPrivacyDraft();
    showStatus('privacy-status', t('admin_privacy_saved'), 'ok');
  } catch (err) {
    showStatus('privacy-status', describeAdminError(err), 'err');
  }
}

/* ══════════════════════════════════════════════════════════════════════
   PASSWORT
   ══════════════════════════════════════════════════════════════════════ */

async function handlePasswordChange(event) {
  event.preventDefault();

  const current = document.getElementById('pw-current').value;
  const next = document.getElementById('pw-new').value;
  const repeat = document.getElementById('pw-repeat').value;

  if (next !== repeat) {
    showStatus('pw-status', t('admin_pw_mismatch'), 'err');
    return;
  }
  if (next.length < 8) {
    showStatus('pw-status', t('admin_pw_short'), 'err');
    return;
  }

  const button = document.getElementById('pw-submit');
  button.disabled = true;
  showStatus('pw-status', '', '');

  try {
    await adminApi.adminChangePassword(current, next);
    document.getElementById('password-form').reset();
    showStatus('pw-status', t('admin_pw_changed'), 'ok');
  } catch (err) {
    showStatus('pw-status', describeAdminError(err), 'err');
  } finally {
    button.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   VERLASSEN

   Der Weg hinaus führt über das Logo oben links – mit Rückfrage, damit
   ein versehentlicher Klick nicht die Sitzung beendet.
   ══════════════════════════════════════════════════════════════════════ */

async function exitAdmin(event) {
  if (event) event.preventDefault();

  const ok = await askConfirm({
    title: t('admin_exit_title'),
    body: t('admin_exit_body'),
    confirm: t('admin_exit_confirm')
  });
  if (!ok) return;

  try {
    await adminApi.adminSignOut();
  } catch (err) {
    console.warn('[Admin] Abmelden:', err);
  }
  window.location.replace('../?home=true');
}

/* ══════════════════════════════════════════════════════════════════════
   START
   ══════════════════════════════════════════════════════════════════════ */

document.getElementById('admin-exit-btn').addEventListener('click', exitAdmin);
document.getElementById('admin-refresh').addEventListener('click', loadPosts);
document.getElementById('admin-new-post-btn').addEventListener('click', toggleAdminPostForm);
document.getElementById('admin-post-cancel').addEventListener('click', toggleAdminPostForm);
document.getElementById('admin-new-post-form').addEventListener('submit', handleCreatePost);
document.getElementById('privacy-save').addEventListener('click', savePrivacyDraft);
document.getElementById('privacy-reset').addEventListener('click', resetPrivacyDraft);
document.getElementById('password-form').addEventListener('submit', handlePasswordChange);
document.getElementById('privacy-lang-select').addEventListener('change', renderPrivacyEditor);

document.getElementById('admin-post-title').addEventListener('input', () => updateCounter('admin-post-title', 120));
document.getElementById('admin-post-content').addEventListener('input', () => updateCounter('admin-post-content', 2000));

for (const tab of document.querySelectorAll('.admin-tab')) {
  tab.addEventListener('click', () => switchPanel(tab.dataset.panel));
}
for (const btn of document.querySelectorAll('.forum-filter-btn')) {
  btn.addEventListener('click', () => setFilter(btn.id.replace('admin-filter-', '')));
}

/* Beim Sprachwechsel erneuern sich die festen Texte über data-i18n von
   selbst (js/i18n.js). Was hier erzeugt wurde, muss neu gezeichnet
   werden – Beitragsliste, Zähler und der Datenschutz-Editor. */
if (typeof addLangChangeListener === 'function') {
  addLangChangeListener(() => {
    document.title = 'Inkwells — ' + t('admin_page_title');
    updateCounter('admin-post-title', 120);
    updateCounter('admin-post-content', 2000);
    if (posts.length) renderFeed();
    if (privacyDraft) { updatePrivacyBadge(); renderPrivacyEditor(); }
  });
}

(async () => {
  document.getElementById('admin-gate').textContent = '…';
  setupPasswordEyes();
  updateCounter('admin-post-title', 120);
  updateCounter('admin-post-content', 2000);

  try {
    adminApi = await whenAdminApiReady();
  } catch (err) {
    document.getElementById('admin-gate').textContent = describeAdminError(err);
    document.body.dataset.admin = 'no';
    return;
  }

  const signedIn = await adminApi.adminReady();
  if (!signedIn) {
    // Kein Hinweis, keine Verzögerung: wer hier nichts zu suchen hat, soll
    // nicht einmal erfahren, dass es die Seite gibt.
    window.location.replace('../');
    return;
  }

  document.body.dataset.admin = 'yes';
  document.title = 'Inkwells — ' + t('admin_page_title');
  loadPosts();

  // Wird die Sitzung anderswo beendet (etwa in einem zweiten Tab),
  // schließt sich der Adminbereich auch hier.
  adminApi.onAdminChange((stillAdmin) => {
    if (!stillAdmin) window.location.replace('../');
  });
})();
