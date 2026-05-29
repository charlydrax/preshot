// utils/whitelist.js
console.log('[PreShot] whitelist.js loaded');

const WHITELIST = [
  'amazon.fr',
  'amazon.com',
  'fnac.com',
  'cdiscount.com',
  'darty.com',
  'boulanger.com',
  'ldlc.com',
  'ebay.fr',
  'leboncoin.fr',
  'paypal.com'
];

function isWhitelisted(hostname) {
  const normalized = hostname.replace(/^www\./, '');
  return WHITELIST.includes(normalized);
}
