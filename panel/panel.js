// panel/panel.js
// ============================================================
// PreShot — Logique du Side Panel
//
// Affiche le diagnostic de fiabilité du site analysé. Manipulation DOM
// directe (pas de framework). S'appuie sur le HTML du ticket 7 :
//   #preshot-panel-domain, #preshot-verdict-section (+ data-level),
//   #preshot-verdict-icon/-label, #preshot-flags-list (cards data-flag),
//   #preshot-flags-empty, #preshot-tips-list.
//
// Contrats de messages (cf. service_worker.js) :
//   - GET_STATUS  → réponse PLATE : { verdict:{level,label,color},
//                    redFlags:[...], redFlagCount, hostname } | { verdict:null }
//   - ANALYSIS_COMPLETE → { type, data:{ hostname, redFlags, verdict, ... } }
//                    ⇒ on lit message.data.* (et non message.level).
// ============================================================

console.log('[PreShot] panel.js loaded');

// ------------------------------------------------------------
// Constantes d'affichage
// ------------------------------------------------------------

// Vraies clés émises par le code (PAS domain_age_recent).
const FLAG_KEYS = ['ssl_missing', 'no_legal_mentions', 'domain_recent'];

// Icône du badge verdict par niveau.
const VERDICT_ICONS = {
  loading: '⏳',
  safe: '✅',
  warning: '⚠️',
  danger: '🔴'
};

// Conseils adaptés au verdict (3 par niveau).
const TIPS = {
  safe: [
    { icon: '🔒', text: 'La connexion est sécurisée : vérifiez tout de même l’URL exacte.' },
    { icon: '⭐', text: 'Un rapide coup d’œil aux avis clients reste une bonne habitude.' },
    { icon: '💳', text: 'Privilégiez un moyen de paiement sécurisé (carte, PayPal).' }
  ],
  warning: [
    { icon: '🔍', text: 'Vérifiez l’adresse du site et l’orthographe du nom de domaine.' },
    { icon: '📄', text: 'Cherchez les mentions légales et des avis externes sur le vendeur.' },
    { icon: '💳', text: 'Évitez virement et carte cadeau ; préférez un paiement traçable.' }
  ],
  danger: [
    { icon: '🛑', text: 'Ne saisissez pas vos informations de paiement sur ce site.' },
    { icon: '🔍', text: 'Recherchez le nom du site + « arnaque » / « avis » avant d’acheter.' },
    { icon: '💳', text: 'N’utilisez jamais de virement ou de carte cadeau pour ce vendeur.' }
  ]
};

// Vérifications réalisées par PreShot (affichées en mode « Diagnostic partiel »).
const CHECK_LABELS = [
  'Connexion sécurisée (HTTPS)',
  'Mentions légales / CGV',
  'Ancienneté du domaine'
];

// Filet de sécurité après un « Re-analyser » : si aucune analyse n'arrive.
const REANALYZE_FALLBACK_MS = 6000;
let reanalyzeTimer = null;

// ------------------------------------------------------------
// Helpers DOM
// ------------------------------------------------------------

function setSectionVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}

function setDomain(hostname) {
  document.getElementById('preshot-panel-domain').textContent = hostname || '—';
}

// Pose le verdict : couleur via data-level (piloté par le CSS), icône + label.
function setVerdict(level, label, iconOverride) {
  const section = document.getElementById('preshot-verdict-section');
  section.dataset.level = level;
  document.getElementById('preshot-verdict-icon').textContent =
    iconOverride || VERDICT_ICONS[level] || VERDICT_ICONS.loading;
  document.getElementById('preshot-verdict-label').textContent = label;
}

// Retire les éléments injectés dynamiquement dans la liste des flags.
function clearDynamicItems() {
  document
    .querySelectorAll('#preshot-flags-list .preshot-dynamic')
    .forEach((n) => n.remove());
}

// Masque toutes les cards statiques de red flags + le message « aucun flag ».
function hideAllFlags() {
  document.querySelectorAll('.preshot-flag-card').forEach((c) => (c.hidden = true));
  document.getElementById('preshot-flags-empty').hidden = true;
}

// Affiche les cards dont le data-flag figure dans redFlags ; masque les autres.
// Si la liste est vide → message rassurant.
function renderFlags(redFlags) {
  clearDynamicItems();
  const flags = Array.isArray(redFlags) ? redFlags : [];

  document.querySelectorAll('.preshot-flag-card').forEach((card) => {
    card.hidden = !flags.includes(card.dataset.flag);
  });

  document.getElementById('preshot-flags-empty').hidden = flags.length !== 0;
}

// Reconstruit la liste des conseils selon le niveau de verdict.
function renderTips(level) {
  const list = document.getElementById('preshot-tips-list');
  list.innerHTML = '';

  (TIPS[level] || TIPS.safe).forEach((tip) => {
    const li = document.createElement('li');
    li.className = 'preshot-tip';

    const icon = document.createElement('span');
    icon.className = 'preshot-tip-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = tip.icon;

    li.appendChild(icon);
    li.appendChild(document.createTextNode(' ' + tip.text));
    list.appendChild(li);
  });
}

// ------------------------------------------------------------
// États du panneau
// ------------------------------------------------------------

function showLoading() {
  setVerdict('loading', 'Analyse en cours…');
  hideAllFlags();
  clearDynamicItems();
  setSectionVisible('preshot-flags-section', false);
  setSectionVisible('preshot-tips-section', false);
}

// Aucune analyse encore disponible pour cet onglet.
function showNoData() {
  setVerdict('loading', 'Naviguez sur un site e-commerce pour lancer l’analyse', '🧭');
  hideAllFlags();
  clearDynamicItems();
  setSectionVisible('preshot-flags-section', false);
  setSectionVisible('preshot-tips-section', false);
}

// Pas de connexion : l'analyse complète (ancienneté du domaine) est impossible.
function showOffline() {
  setVerdict('loading', 'Connexion internet requise pour l’analyse complète', '📡');
  hideAllFlags();
  clearDynamicItems();
  setSectionVisible('preshot-flags-section', false);
  setSectionVisible('preshot-tips-section', false);
}

// Erreur côté API/messagerie : on reste transparent (diagnostic partiel).
function showError() {
  setVerdict('warning', 'Diagnostic partiel', '⚠️');
  hideAllFlags();
  clearDynamicItems();

  // Liste des vérifications que PreShot réalise (résultat incomplet).
  const list = document.getElementById('preshot-flags-list');
  CHECK_LABELS.forEach((text) => {
    const li = document.createElement('li');
    li.className = 'preshot-dynamic preshot-tip';
    li.textContent = '• ' + text;
    list.appendChild(li);
  });

  setSectionVisible('preshot-flags-section', true);
  setSectionVisible('preshot-tips-section', false);
}

// Rendu nominal d'un diagnostic complet.
function renderDiagnostic(data) {
  clearReanalyzeFallback();

  const verdict = data && data.verdict;
  if (!verdict) {
    showNoData();
    return;
  }

  if (data.hostname) setDomain(data.hostname);

  setVerdict(verdict.level, verdict.label);
  setSectionVisible('preshot-flags-section', true);
  setSectionVisible('preshot-tips-section', true);
  renderFlags(data.redFlags);
  renderTips(verdict.level);
}

// ------------------------------------------------------------
// Chargement initial : onglet actif → GET_STATUS
// ------------------------------------------------------------

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function loadStatus() {
  showLoading();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const hostname = tab && tab.url ? safeHostname(tab.url) : '';
    if (hostname) setDomain(hostname);

    chrome.runtime.sendMessage({ type: 'GET_STATUS', hostname }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[PreShot] GET_STATUS error:', chrome.runtime.lastError.message);
        if (!navigator.onLine) showOffline();
        else showError();
        return;
      }

      // Réponse PLATE (pas de .data) côté GET_STATUS.
      if (!response || response.verdict == null) {
        if (!navigator.onLine) showOffline();
        else showNoData();
        return;
      }

      renderDiagnostic(response);
    });
  });
}

// ------------------------------------------------------------
// Bouton « Re-analyser » (force une analyse fraîche, bypass cache)
// ------------------------------------------------------------
// Injecté en JS pour rester dans le périmètre de ce ticket (panel.js).
// Le vrai bypass du cache + relance de l'analyse DOM se fait côté SW
// (message REANALYZE) puis content script (RUN_ANALYSIS) : panel.js seul
// ne peut ni vider le cache du SW ni lire le DOM de la page.
function injectReanalyzeButton() {
  const header = document.getElementById('preshot-panel-header');
  if (!header || document.getElementById('preshot-reanalyze')) return;

  const btn = document.createElement('button');
  btn.id = 'preshot-reanalyze';
  btn.type = 'button';
  btn.textContent = '↻ Re-analyser';
  Object.assign(btn.style, {
    marginTop: '10px',
    padding: '6px 12px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    color: '#4f46e5',
    font: 'inherit',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  });

  btn.addEventListener('click', triggerReanalyze);
  header.appendChild(btn);
}

function triggerReanalyze() {
  showLoading();

  chrome.runtime.sendMessage({ type: 'REANALYZE' }, (response) => {
    if (chrome.runtime.lastError) {
      if (!navigator.onLine) showOffline();
      else showError();
      return;
    }
    // On attend le broadcast ANALYSIS_COMPLETE ; filet de sécurité au cas où
    // la page courante n'est pas une page de paiement (pas de nouvelle analyse).
    scheduleReanalyzeFallback();
  });
}

function scheduleReanalyzeFallback() {
  clearReanalyzeFallback();
  reanalyzeTimer = setTimeout(loadStatus, REANALYZE_FALLBACK_MS);
}

function clearReanalyzeFallback() {
  if (reanalyzeTimer) {
    clearTimeout(reanalyzeTimer);
    reanalyzeTimer = null;
  }
}

// ------------------------------------------------------------
// Réception des analyses poussées par le service worker
// ------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ANALYSIS_COMPLETE') {
    renderDiagnostic(message.data || {});
  }
});

// Retour de connexion : on retente une analyse complète.
window.addEventListener('online', loadStatus);

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------

injectReanalyzeButton();
loadStatus();
