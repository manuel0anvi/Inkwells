/* ══════════════════════════════════════════════════════════════════════
   ADMIN – gemeinsame Helfer für alle Seiten

   Diese Datei ist ein klassisches Script (kein Modul), damit die Seiten
   ihre Funktionen wie gewohnt aus onclick="…" aufrufen können. Die
   eigentliche Anbindung an Firebase steckt in js/firebase.js und kommt
   über window.InkwellForum herein.

   Wichtig zum Verständnis: Nichts hier schützt irgendetwas. Ob gelöscht
   oder unter geschütztem Namen geschrieben werden darf, entscheidet
   ausschließlich Firestore anhand der angemeldeten UID (siehe
   website/firestore.rules). Der Code hier sorgt nur dafür, dass die
   Oberfläche das Richtige zeigt und verständliche Meldungen erscheinen.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Warten auf js/firebase.js ──────────────────────────────────────
   Das Modul läuft erst nach den klassischen Scripts. Bis dahin gibt es
   window.InkwellForum noch nicht. */
function whenAdminApiReady() {
  if (window.InkwellForum) return Promise.resolve(window.InkwellForum);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('ADMIN_API_TIMEOUT')),
      15000
    );

    document.addEventListener('inkwell-forum-ready', () => {
      clearTimeout(timer);
      if (window.InkwellForum) resolve(window.InkwellForum);
      else reject(new Error('ADMIN_API_MISSING'));
    }, { once: true });
  });
}

/**
 * Ist das Adminkonto angemeldet? Wartet dabei ab, bis Firebase eine
 * gespeicherte Sitzung wiederhergestellt hat.
 *
 * @returns {Promise<boolean>}
 */
async function isAdminSignedIn() {
  try {
    const api = await whenAdminApiReady();
    return await api.adminReady();
  } catch (err) {
    console.warn('[Admin] Anmeldestatus nicht feststellbar:', err.message);
    return false;
  }
}

/* ── Kennzeichen am <body> ──────────────────────────────────────────
   js/common.js baut die Navigation, bevor Firebase eine gespeicherte
   Anmeldung wiederhergestellt hat. Sobald das nachgeholt ist, wird das
   Kennzeichen gesetzt und die Navigation noch einmal aufgebaut – dann
   steht dort "Verwaltung" statt "Dashboard".

   Auf der Adminseite selbst passiert das nicht: die hat ihre eigene
   Navigation und setzt data-admin bereits beim Laden. */
function markAdminOnBody(admin) {
  document.body.dataset.inkwellAdmin = admin ? 'yes' : 'no';

  if (typeof checkCommonAuth !== 'function') return;

  const path = window.location.pathname;
  const nested = path.includes('/dashboard/') || path.includes('/community/')
              || path.includes('/datenschutz/') || path.includes('/admin/');
  const rel = nested ? '../' : './';
  checkCommonAuth(!nested, rel);
}

/* Nur auf Seiten, die js/firebase.js überhaupt einbinden. Die Startseite
   lädt es erst beim Dreifachklick nach – dort würde die Prüfung sonst
   fünfzehn Sekunden auf ein Modul warten, das nie kommt. */
if (!window.location.pathname.includes('/admin/')
    && document.querySelector('script[src*="firebase.js"]')) {
  document.addEventListener('DOMContentLoaded', () => {
    isAdminSignedIn().then(markAdminOnBody).catch(() => {});
  });
}

/* ── Fehlermeldungen ────────────────────────────────────────────────
   Firebase antwortet mit Codes wie "auth/invalid-credential". Die sagen
   niemandem etwas, deshalb hier die Übersetzung in Klartext. */
function describeAdminError(err) {
  const code = String(err?.code || err?.message || '');

  if (code.includes('auth/invalid-credential')
   || code.includes('auth/wrong-password')
   || code.includes('auth/invalid-email')
   || code.includes('auth/user-not-found')) {
    return t('admin_err_wrong_password');
  }
  if (code.includes('auth/too-many-requests')) {
    return t('admin_err_too_many');
  }
  if (code.includes('auth/weak-password')) {
    return t('admin_err_weak_password');
  }
  if (code.includes('auth/network-request-failed')) {
    return t('admin_err_network');
  }
  if (code.includes('auth/operation-not-allowed')) {
    // Tritt auf, solange in der Firebase-Konsole "E-Mail/Passwort" aus ist.
    return t('admin_err_not_enabled');
  }
  if (code.includes('permission-denied')) {
    // Angemeldet, aber die UID steht nicht in den Firestore-Regeln.
    return t('admin_err_denied');
  }
  if (code.includes('ADMIN_API_TIMEOUT') || code.includes('ADMIN_API_MISSING')) {
    return t('admin_err_offline');
  }

  return err?.message || t('admin_err_generic');
}

/* ── Geschützte Namen ───────────────────────────────────────────────
   isReservedAuthorName() steht in js/config.js, damit die Liste an
   derselben Stelle wie die übrige Konfiguration gepflegt wird. */

/**
 * Prüft einen eingegebenen Anzeigenamen.
 *
 * @param {string} name
 * @param {boolean} admin  ob gerade das Adminkonto angemeldet ist
 * @returns {string} leere Zeichenkette, wenn der Name in Ordnung ist,
 *                   sonst der Text der Fehlermeldung
 */
function checkAuthorName(name, admin) {
  if (admin) return '';
  if (!isReservedAuthorName(name)) return '';
  return t('community_name_reserved');
}

/* ── Bestätigungsfenster ────────────────────────────────────────────
   Ersetzt confirm(): das sieht in jedem Browser anders aus und passt
   nicht zum Rest der Seite. Baut sein Fenster selbst und räumt es hinter
   sich wieder weg.

   @param {{title: string, body: string, confirm: string, cancel: string,
            danger?: boolean}} options
   @returns {Promise<boolean>} */
function askConfirm(options) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open';
    backdrop.setAttribute('aria-hidden', 'false');

    const card = document.createElement('div');
    card.className = 'modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    const kicker = document.createElement('div');
    kicker.className = 'modal-kicker';
    kicker.textContent = t('admin_confirm_kicker');

    const heading = document.createElement('h4');
    heading.textContent = options.title;

    const text = document.createElement('p');
    text.textContent = options.body;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-m';
    cancelBtn.textContent = options.cancel || t('downgrade_cancel');

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn-m' + (options.danger ? ' warn' : '');
    okBtn.textContent = options.confirm;

    actions.append(cancelBtn, okBtn);
    card.append(kicker, heading, text, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    // Damit Enter/Escape sofort wirken, ohne erst hineinklicken zu müssen
    okBtn.focus();

    const close = (answer) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(answer);
    };

    function onKey(event) {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter') close(true);
    }

    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKey);
  });
}
