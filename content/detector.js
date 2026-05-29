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

const PRESHOT_LOGO_REGEX = /visa|mastercard|paypal|stripe/i;

function detectUrlPattern() {
  return PRESHOT_URL_REGEX.test(location.pathname + location.search);
}

function detectSensitiveFields() {
  return document.querySelector(PRESHOT_FIELD_SELECTOR) !== null;
}

function detectPaymentLogos() {
  const imgs = document.querySelectorAll('img');
  for (const img of imgs) {
    if (PRESHOT_LOGO_REGEX.test(img.alt) || PRESHOT_LOGO_REGEX.test(img.src)) {
      return true;
    }
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
    chrome.runtime.sendMessage({
      type: 'CHECKOUT_DETECTED',
      url: location.hostname,
      signals,
      signalCount
    });
  }
}

let preshot_debounceTimer = null;

function preshot_onMutation() {
  clearTimeout(preshot_debounceTimer);
  preshot_debounceTimer = setTimeout(analyzePage, PRESHOT_DEBOUNCE_MS);
}

const preshot_observer = new MutationObserver(preshot_onMutation);
preshot_observer.observe(document.body, { childList: true, subtree: true });

analyzePage();
