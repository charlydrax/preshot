// content/detector.js
console.log('[PreShot] Content script chargé ✅');
console.log('[PreShot] detector.js loaded on', location.href);

const PRESHOT_SIGNAL_THRESHOLD = 2;
const PRESHOT_DEBOUNCE_MS = 500;

// État anti-doublon en mémoire : réinitialisé à chaque chargement de page
// (donc la notif réapparaît à chaque rafraîchissement), mais conservé pendant
// la vie de la page pour ne pas réinjecter la bannière à chaque mutation DOM.
let preshot_alerted = false;

const PRESHOT_URL_REGEX = /\/(checkout|panier|order|payment|cart|paiement|commande)/i;

const PRESHOT_FIELD_SELECTOR = [
  '[name*="card"]',
  '[name*="cvv"]',
  '[name*="expiry"]',
  '[name*="iban"]',
  '[autocomplete*="cc-"]'
].join(',');

// Marques de paiement reconnues.
const PRESHOT_BRANDS = 'visa|mastercard|maestro|amex|american-express|paypal|stripe';

// alt : libellé descriptif → match borné par limites de mot.
const PRESHOT_LOGO_ALT_REGEX = new RegExp('\\b(' + PRESHOT_BRANDS + ')\\b', 'i');

// src : le NOM DE FICHIER doit ÊTRE la marque (éventuellement suffixée d'un mot
// de contexte logo/card/icon…), pour éviter qu'un produit comme
// "stripe-dress-12.jpg" ne soit pris pour un logo Stripe.
const PRESHOT_LOGO_FILE_REGEX = new RegExp(
  '^(' + PRESHOT_BRANDS + ')([-_](logo|icon|card|badge|pay|payment))?(\\.\\w+)?$',
  'i'
);

function detectUrlPattern() {
  return PRESHOT_URL_REGEX.test(location.pathname + location.search);
}

function detectSensitiveFields() {
  return document.querySelector(PRESHOT_FIELD_SELECTOR) !== null;
}

function detectPaymentLogos() {
  const imgs = document.querySelectorAll('img');
  for (const img of imgs) {
    // alt : libellé descriptif, signal fort.
    if (PRESHOT_LOGO_ALT_REGEX.test(img.alt || '')) return true;

    // src : on ne teste QUE le nom de fichier (dernier segment, sans query),
    // pas l'URL entière, et il doit ÊTRE la marque (pas la contenir).
    const file = (img.currentSrc || img.src || '').split('/').pop().split('?')[0];
    if (PRESHOT_LOGO_FILE_REGEX.test(file)) return true;
  }
  return false;
}

function analyzePage() {
  if (preshot_alerted) return;

  const urlSignal = detectUrlPattern();
  const fieldsSignal = detectSensitiveFields();
  const logosSignal = detectPaymentLogos();

  const signals = [];
  if (urlSignal) signals.push('url');
  if (fieldsSignal) signals.push('fields');
  if (logosSignal) signals.push('logos');

  const signalCount = signals.length;

  console.log(
    `[PreShot] Signaux détectés : URL=${urlSignal}, Fields=${fieldsSignal}, Logos=${logosSignal} (${signalCount}/3)`
  );

  if (signalCount >= PRESHOT_SIGNAL_THRESHOLD) {
    preshot_alerted = true;

    // Le scoring tourne ici (content script) car checkLegalMentions a besoin
    // du DOM, indisponible côté service worker. Les checks sont 100% locaux.
    const analysis = analyzeWebsite(location.hostname, document);

    chrome.runtime.sendMessage({
      type: 'CHECKOUT_DETECTED',
      url: location.hostname,        // conservé : le SW lit message.url
      signals,
      signalCount,
      redFlags: analysis.redFlags,   // string[]
      verdict: analysis.verdict      // { level, label, color }
    });

    // Alerte envoyée : plus rien à surveiller sur cette « page » → on coupe
    // l'observer pour éviter le gaspillage (réactivé sur navigation SPA /
    // re-analyse).
    clearTimeout(preshot_debounceTimer);
    preshot_observer.disconnect();
  }
}

let preshot_debounceTimer = null;

function preshot_onMutation() {
  clearTimeout(preshot_debounceTimer);
  preshot_debounceTimer = setTimeout(analyzePage, PRESHOT_DEBOUNCE_MS);
}

const preshot_observer = new MutationObserver(preshot_onMutation);

// (Ré)active l'observation du DOM. Idempotent : on déconnecte d'abord.
function preshot_startObserver() {
  preshot_observer.disconnect();
  if (document.body) {
    preshot_observer.observe(document.body, { childList: true, subtree: true });
  }
}

// Navigation SPA (history API) : sans rechargement, preshot_alerted resterait
// bloqué et un checkout atteint via routing JS ne ré-alerterait jamais. On
// surveille les changements d'URL (popstate, hashchange, et pushState via un
// check périodique) pour réautoriser une analyse.
let preshot_lastUrl = location.href;
function preshot_onUrlMaybeChanged() {
  if (location.href === preshot_lastUrl) return;
  preshot_lastUrl = location.href;
  preshot_alerted = false;
  preshot_startObserver();
  analyzePage();
}
window.addEventListener('popstate', preshot_onUrlMaybeChanged);
window.addEventListener('hashchange', preshot_onUrlMaybeChanged);
setInterval(preshot_onUrlMaybeChanged, 1000);

// Re-analyse forcée depuis le side panel (bouton « Re-analyser »). Le SW a
// déjà vidé le cache ; on lève le garde anti-doublon et on relance l'analyse.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'RUN_ANALYSIS') {
    preshot_alerted = false;
    preshot_startObserver();
    analyzePage();
  }
});

preshot_startObserver();
analyzePage();
