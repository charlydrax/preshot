// content/detector.js
console.log('[PreShot] detector.js loaded on', location.href);

const SIGNAL_THRESHOLD = 2;

const URL_KEYWORDS = ['/checkout', '/panier', '/order', '/payment', '/cart'];

const SENSITIVE_FIELD_PATTERNS = [
  'cardnumber', 'card-number', 'cc-number',
  'iban', 'cvv', 'cvc', 'security-code'
];

const PAYMENT_LOGO_PATTERNS = ['stripe', 'paypal', 'visa', 'mastercard'];

function countSignals() {
  let count = 0;
  // TODO: check location.href against URL_KEYWORDS
  // TODO: query DOM inputs matching SENSITIVE_FIELD_PATTERNS (name/autocomplete attrs)
  // TODO: query DOM images/logos matching PAYMENT_LOGO_PATTERNS (alt/src attrs)
  return count;
}

function notifyCheckoutDetected() {
  chrome.runtime.sendMessage({
    type: 'CHECKOUT_DETECTED',
    url: location.href
  });
  console.log('[PreShot] CHECKOUT_DETECTED sent');
}

function runDetection() {
  const signals = countSignals();
  console.log('[PreShot] signals detected:', signals);
  if (signals >= SIGNAL_THRESHOLD) {
    notifyCheckoutDetected();
  }
}

runDetection();
