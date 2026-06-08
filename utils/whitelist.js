// utils/whitelist.js
// ============================================================
// PreShot — Whitelist des grands sites de confiance
//
// Un site légitime mal flaggué détruit la confiance dans l'extension.
// On court-circuite donc l'analyse pour les top sites e-commerce connus
// (cf. CLAUDE.md : « préférer rater une arnaque qu'alerter à tort »).
//
// Utilisable depuis le service worker via importScripts('/utils/whitelist.js')
// (fonctions globales) ou en test Node via module.exports (bas de fichier).
// ============================================================

console.log('[PreShot] whitelist.js loaded');

// Domaines de confiance (sans "www.", en minuscules). Note : "apple.com/fr"
// est un chemin ; côté hostname seul "apple.com" compte.
const TRUSTED_DOMAINS = [
  'amazon.fr', 'amazon.com', 'fnac.com', 'cdiscount.com', 'boulanger.com',
  'darty.com', 'zalando.fr', 'decathlon.fr', 'leroymerlin.fr', 'castorama.fr',
  'but.fr', 'conforama.fr', 'laredoute.fr', 'vinted.fr', 'leboncoin.fr',
  'sncf-connect.com', 'booking.com', 'airbnb.fr', 'paypal.com', 'stripe.com',
  'shopify.com', 'ebay.fr', 'aliexpress.com', 'apple.com', 'microsoft.com',
  'google.com', 'etsy.com', 'sephora.fr', 'nocibe.fr', 'yves-rocher.fr',
  'ikea.com', 'h-m.com', 'uniqlo.com', 'zara.com', 'nike.com', 'adidas.fr'
];

// ------------------------------------------------------------
// normalizeHostname(hostname)
// ------------------------------------------------------------
// Ramène une valeur (hostname ou URL complète) à un hostname nu, en
// minuscules, sans schéma, port, chemin ni "www.".
function normalizeHostname(hostname) {
  if (typeof hostname !== 'string') return '';

  let h = hostname.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, ''); // schéma éventuel
  h = h.split('/')[0];               // chemin éventuel
  h = h.split(':')[0];               // port éventuel
  h = h.replace(/^www\./, '');       // sous-domaine www
  return h;
}

// ------------------------------------------------------------
// isTrustedDomain(hostname)
// ------------------------------------------------------------
// true si le hostname est un domaine de confiance OU un sous-domaine
// d'un domaine de confiance (ex. checkout.amazon.fr → amazon.fr).
// Insensible à la casse, gère "www." en amont via normalizeHostname.
//
// @param  {string} hostname
// @return {boolean}
function isTrustedDomain(hostname) {
  const h = normalizeHostname(hostname);
  if (!h) return false;

  return TRUSTED_DOMAINS.some((domain) => {
    const d = domain.toLowerCase();
    return h === d || h.endsWith('.' + d);
  });
}

// ------------------------------------------------------------
// Export (Node / tests). Ignoré en contexte importScripts/navigateur.
// ------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TRUSTED_DOMAINS, isTrustedDomain, normalizeHostname };
}
