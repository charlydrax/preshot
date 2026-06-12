// popup/popup.js
// ============================================================
// PreShot — Popup (clic sur l'icône de la barre d'outils)
//
// Affiche l'état courant (verdict de l'onglet actif) et permet d'ouvrir le
// side panel. Données via GET_STATUS (réponse PLATE) :
//   { verdict:{level,label,color}, redFlags, redFlagCount, hostname } | { verdict:null }
// ============================================================

console.log('[PreShot] popup.js loaded');

// Icône d'état par niveau de verdict (cercles colorés, cf. cahier des charges).
const STATE_ICONS = {
  safe: '🟢',
  warning: '🟠',
  danger: '🔴'
};

// Onglet actif mémorisé au chargement : nécessaire pour ouvrir le side panel
// de façon synchrone dans le handler de clic (geste utilisateur requis).
let activeTab = null;

// ------------------------------------------------------------
// Rendu de l'état
// ------------------------------------------------------------

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// État neutre : aucune analyse disponible pour cet onglet.
function renderNeutral() {
  const state = document.getElementById('preshot-popup-state');
  state.dataset.level = 'neutral';
  document.getElementById('preshot-popup-state-icon').textContent = '✅';
  document.getElementById('preshot-popup-state-label').textContent = 'Aucune analyse en cours';

  document.getElementById('preshot-popup-domain').hidden = true;

  // Pas de diagnostic à montrer → bouton grisé.
  document.getElementById('preshot-popup-diagnostic').disabled = true;
}

// État analysé : verdict coloré + domaine + bouton actif.
function renderVerdict(status, fallbackHostname) {
  const verdict = status.verdict;
  const level = verdict.level;

  const state = document.getElementById('preshot-popup-state');
  state.dataset.level = level;
  document.getElementById('preshot-popup-state-icon').textContent = STATE_ICONS[level] || '✅';
  document.getElementById('preshot-popup-state-label').textContent = verdict.label || 'Analyse';

  const hostname = status.hostname || fallbackHostname;
  const domainEl = document.getElementById('preshot-popup-domain');
  if (hostname) {
    domainEl.textContent = hostname;
    domainEl.hidden = false;
  } else {
    domainEl.hidden = true;
  }

  // Diagnostic disponible → bouton actif (si on a un onglet cible).
  document.getElementById('preshot-popup-diagnostic').disabled = !(activeTab && activeTab.id != null);
}

function renderStatus(status) {
  const fallbackHostname = activeTab && activeTab.url ? safeHostname(activeTab.url) : '';

  if (!status || status.verdict == null) {
    renderNeutral();
    return;
  }
  renderVerdict(status, fallbackHostname);
}

// ------------------------------------------------------------
// Chargement : onglet actif → GET_STATUS
// ------------------------------------------------------------

function init() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    activeTab = (tabs && tabs[0]) || null;

    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[PreShot] GET_STATUS error:', chrome.runtime.lastError.message);
        renderNeutral();
        return;
      }
      renderStatus(response);
    });
  });

  checkAuthState();
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------

// Ouvre le side panel pour l'onglet actif. chrome.sidePanel.open() exige un
// geste utilisateur : on l'appelle directement dans le handler de clic.
function openDiagnostic() {
  if (!activeTab) return;

  const target = activeTab.id != null ? { tabId: activeTab.id } : { windowId: activeTab.windowId };
  try {
    chrome.sidePanel.open(target);
    window.close(); // referme le popup une fois le panneau ouvert
  } catch (err) {
    console.warn('[PreShot] sidePanel.open error:', String(err));
  }
}

// Lien « Comment ça marche ? » : affiche/masque l'explication inline.
function toggleHelp(event) {
  event.preventDefault();
  const help = document.getElementById('preshot-popup-help-text');
  help.hidden = !help.hidden;
}

document.getElementById('preshot-popup-diagnostic').addEventListener('click', openDiagnostic);
document.getElementById('preshot-popup-help').addEventListener('click', toggleHelp);

// ------------------------------------------------------------
// Auth — Google Identity
// ------------------------------------------------------------

function renderUserInfo(user) {
  const avatar = document.getElementById('preshot-user-avatar');

  if (user.picture) {
    const img = document.createElement('img');
    img.src    = user.picture;
    img.alt    = '';
    img.width  = 36;
    img.height = 36;
    avatar.replaceChildren(img);
  } else {
    avatar.textContent = (user.name || user.email || '?')[0].toUpperCase();
  }

  document.getElementById('preshot-user-name').textContent  = user.name  || '';
  document.getElementById('preshot-user-email').textContent = user.email || '';

  document.getElementById('preshot-user-card').hidden   = false;
  document.getElementById('login-btn').hidden           = true;
  document.getElementById('logout-btn').hidden          = false;
  document.getElementById('preshot-auth-error').hidden  = true;
}

function renderLoggedOut() {
  document.getElementById('preshot-user-card').hidden   = true;
  document.getElementById('login-btn').hidden           = false;
  document.getElementById('logout-btn').hidden          = true;
  document.getElementById('preshot-auth-error').hidden  = true;
}

function renderAuthError(msg) {
  const err = document.getElementById('preshot-auth-error');
  err.textContent = msg;
  err.hidden = false;
}

function login() {
  document.getElementById('preshot-auth-error').hidden = true;

  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (chrome.runtime.lastError || !token) {
      const detail = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : 'annulée';
      console.warn('[PreShot] auth error:', detail);
      renderAuthError('Connexion impossible. Réessayez.');
      return;
    }

    fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((user) => {
        chrome.storage.local.set({
          preshot_auth: { token, email: user.email, name: user.name, picture: user.picture }
        });
        renderUserInfo(user);
      })
      .catch((err) => {
        console.warn('[PreShot] userinfo fetch error:', err);
        renderAuthError('Impossible de récupérer le profil.');
      });
  });
}

function logout() {
  chrome.storage.local.get('preshot_auth', ({ preshot_auth }) => {
    const token = preshot_auth && preshot_auth.token;
    const finish = () => {
      chrome.storage.local.remove('preshot_auth');
      renderLoggedOut();
    };
    if (token) {
      chrome.identity.removeCachedAuthToken({ token }, finish);
    } else {
      finish();
    }
  });
}

function checkAuthState() {
  chrome.storage.local.get('preshot_auth', ({ preshot_auth }) => {
    if (preshot_auth && preshot_auth.email) {
      renderUserInfo(preshot_auth);
    } else {
      renderLoggedOut();
    }
  });
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('logout-btn').addEventListener('click', logout);

// Mise à jour en direct : si une analyse se termine alors que le popup est
// ouvert, le service worker diffuse ANALYSIS_COMPLETE → on rafraîchit l'état.
// On ne met à jour que si l'analyse concerne l'onglet actif (comparaison de
// hostname quand il est connu), pour ne pas afficher le verdict d'un autre onglet.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'ANALYSIS_COMPLETE' || !message.data) return;

  const current = activeTab && activeTab.url ? safeHostname(activeTab.url) : '';
  if (!current || current === message.data.hostname) {
    renderStatus(message.data);
  }
});

init();
