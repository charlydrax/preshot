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
// Suffixes publics composés (multi-labels)
// ------------------------------------------------------------
// Liste PRAGMATIQUE (pas la Public Suffix List complète) des suffixes à
// second niveau les plus courants. Sert à extraire le domaine enregistrable :
// sans elle, "shop.example.co.uk" donnerait "co.uk" au lieu de "example.co.uk".
const MULTI_PART_SUFFIXES = new Set([
  // Royaume-Uni
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk',
  // Australie / Nouvelle-Zélande
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'net.nz', 'org.nz',
  // Asie
  'co.jp', 'or.jp', 'ne.jp', 'go.jp', 'co.kr', 'or.kr', 'com.cn', 'com.hk',
  'com.tw', 'com.sg', 'com.my', 'co.in', 'co.id', 'co.th',
  // Amériques
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'com.ar', 'com.co',
  // Europe / autres
  'com.tr', 'com.ua', 'com.pl', 'com.ru', 'co.za', 'co.il'
]);

// ------------------------------------------------------------
// getRegistrableDomain(hostname)
// ------------------------------------------------------------
// Réduit un hostname au domaine ENREGISTRABLE (eTLD+1) attendu par RDAP :
//   checkout.boutique.com   → boutique.com
//   shop.example.co.uk      → example.co.uk
//   www.amazon.com.br       → amazon.com.br
// Gère les suffixes composés via MULTI_PART_SUFFIXES (pas de split naïf).
//
// @param  {string} hostname
// @return {string} domaine enregistrable (ou le hostname normalisé si ≤ 2 labels)
function getRegistrableDomain(hostname) {
  const h = normalizeHostname(hostname); // minuscules, sans schéma/port/chemin/www
  if (!h) return '';

  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return h;

  const lastTwo = labels.slice(-2).join('.');
  // Suffixe composé (co.uk…) → on garde 3 labels (domaine + suffixe).
  const keep = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

// ------------------------------------------------------------
// Export (Node / tests). Ignoré en contexte importScripts/navigateur.
// ------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRUSTED_DOMAINS,
    isTrustedDomain,
    normalizeHostname,
    getRegistrableDomain
  };
}
