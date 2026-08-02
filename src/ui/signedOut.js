'use strict';

/* ══════════════════════════════════════════════════════════════════════
   HINWEIS „DU BIST ABGEMELDET"

   Eine Sitzung kann im Hintergrund enden: das Token läuft ab und lässt
   sich nicht mehr still erneuern, das Passwort wurde geändert, der
   Zugriff wurde im Google- oder Microsoft-Konto entzogen. Bisher fiel
   das erst auf, wenn man von sich aus das Konto-Fenster öffnete – bis
   dahin lief die App scheinbar normal weiter, sicherte aber nichts mehr
   in die Cloud.

   core/cloudSync.js setzt dafür das Kennzeichen `cloudSessionLost`.
   Hier wird es beim Start einmal ausgewertet und danach zurückgesetzt.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const overlay = E('ov-signed-out');
  if (!overlay) return;

  const textEl = E('signed-out-text');
  const accountEl = E('signed-out-account');
  const pendingEl = E('signed-out-pending');

  function close() {
    overlay.style.display = 'none';
  }

  E('signed-out-close')?.addEventListener('click', close);
  E('signed-out-later')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  E('signed-out-signin')?.addEventListener('click', () => {
    close();
    if (typeof window.openAccountDialog === 'function') window.openAccountDialog();
    else E('btn-profile')?.click();
  });

  function show() {
    const mail = Settings.get('cloudEmail');

    // t() ersetzt {provider} selbst – der Name des Dienstes steckt im Text
    textEl.textContent = t('signedOutText');

    accountEl.textContent = mail ? t('signedOutAccount').replace('{mail}', mail) : '';
    accountEl.style.display = mail ? 'block' : 'none';

    const pending = typeof CloudSync_?.getPendingCount === 'function'
      ? CloudSync_.getPendingCount()
      : 0;
    if (pending > 0) {
      pendingEl.textContent = t('signedOutPending').replace('{n}', pending);
      pendingEl.style.display = 'block';
    } else {
      pendingEl.style.display = 'none';
    }

    overlay.style.display = 'flex';
  }

  /**
   * Wird von core/init.js aufgerufen, nachdem CloudSync gestartet ist.
   * Zeigt den Hinweis höchstens einmal je verlorener Sitzung.
   */
  async function checkOnStartup() {
    if (!window.CloudSync_ || typeof CloudSync_.sessionWasLost !== 'function') return;
    if (!CloudSync_.sessionWasLost()) return;

    show();

    // Bestätigen, damit derselbe Hinweis nicht bei jedem Start wiederkommt.
    // Erst nach dem Anzeigen – sonst ginge er verloren, falls das Speichern
    // der Einstellungen scheitert.
    try { await CloudSync_.acknowledgeSessionLoss(); } catch (e) { /* egal */ }
  }

  window.checkSignedOutOnStartup = checkOnStartup;
  window.showSignedOutNotice = show;
})();
