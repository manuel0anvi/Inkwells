// Custom mobile language menu toggling
function toggleMobileLangMenu(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('lang-dropdown-mobile');
  if (!dropdown) return;
  const isShown = dropdown.style.display === 'block';
  dropdown.style.display = isShown ? 'none' : 'block';
}

document.addEventListener('click', (event) => {
  const dropdown = document.getElementById('lang-dropdown-mobile');
  const btn = document.getElementById('lang-btn-mobile');
  if (dropdown && !dropdown.contains(event.target) && event.target !== btn && !btn.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});

// Auth state helper for common navigation headers
function checkCommonAuth(isLandingPage = false, relativePathToRoot = './') {
  const savedToken = localStorage.getItem('inkwell_web_token');
  const savedUid = localStorage.getItem('inkwell_web_uid');
  const isDashboard = window.location.pathname.includes('/dashboard/');
  
  const btnOpenLogin = document.getElementById('btn-open-login');
  if (!btnOpenLogin) return;

  const span = btnOpenLogin.querySelector('span');
  const userIcon = btnOpenLogin.querySelector('.nav-icon-user');
  const homeIcon = btnOpenLogin.querySelector('.nav-icon-home');

  if (savedToken && savedUid) {
    // User is logged in!
    if (isDashboard) {
      if (span) {
        // preserve data-i18n if it exists, otherwise set text
        span.textContent = window.t ? t('dash_home', 'Startseite') : 'Startseite';
        span.setAttribute('data-i18n', 'dash_home');
      }
      if (userIcon) userIcon.style.display = 'none';
      if (homeIcon) homeIcon.style.display = 'inline-block';

      // On click, navigate to home
      btnOpenLogin.onclick = (e) => {
        e.preventDefault();
        window.location.href = relativePathToRoot + '?home=true';
      };
    } else {
      if (span) {
        span.textContent = 'Dashboard';
        span.removeAttribute('data-i18n'); // prevent i18n from overwriting
      }
      if (userIcon) userIcon.style.display = 'inline-block';
      if (homeIcon) homeIcon.style.display = 'none';

      // On click, navigate directly to dashboard
      btnOpenLogin.onclick = (e) => {
        e.preventDefault();
        window.location.href = `${relativePathToRoot}dashboard/`;
      };
    }
  } else {
    // User is not logged in!
    if (span) span.textContent = t('nav_login') || 'Anmelden';
    if (userIcon) userIcon.style.display = 'inline-block';
    if (homeIcon) homeIcon.style.display = 'none';

    if (isLandingPage) {
      // Landing page handles modal opening on its own
      btnOpenLogin.onclick = null; 
    } else {
      // On other subpages, redirect to landing with ?login=true
      btnOpenLogin.onclick = (e) => {
        e.preventDefault();
        window.location.href = `${relativePathToRoot}?login=true`;
      };
    }
  }
}

// Hook into translation updates to refresh auth button texts
if (typeof addLangChangeListener === 'function') {
  addLangChangeListener(() => {
    // Detect page path to determine relative root
    const path = window.location.pathname;
    let rel = './';
    if (path.includes('/dashboard/') || path.includes('/community/') || path.includes('/datenschutz/')) {
      rel = '../';
    }
    const isLanding = !path.includes('/dashboard/') && !path.includes('/community/') && !path.includes('/datenschutz/');
    checkCommonAuth(isLanding, rel);
  });
}

// Initialize navbar on load
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  let rel = './';
  if (path.includes('/dashboard/') || path.includes('/community/') || path.includes('/datenschutz/')) {
    rel = '../';
  }
  const isLanding = !path.includes('/dashboard/') && !path.includes('/community/') && !path.includes('/datenschutz/');
  checkCommonAuth(isLanding, rel);
});
