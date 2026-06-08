// utils/scoring.js
// ============================================================
// PreShot — Scoring / détection des red flags
//
// Regroupe les vérifications de fiabilité d'un site et le calcul du
// verdict global. JavaScript vanilla, sans dépendance.
//
// Chaque vérification renvoie un objet { flag, detected } où :
//   - `flag`     : identifiant stable du red flag (UPPER/lower_snake_case)
//   - `detected` : true si le red flag est LEVÉ (signal négatif présent)
//
// Le fichier reste utilisable :
//   - tel quel dans une page / un content script (fonctions globales),
//   - depuis le service worker via importScripts('/utils/scoring.js'),
//   - en test Node via module.exports (voir bas de fichier).
// ============================================================

console.log('[PreShot] scoring.js loaded');

// ------------------------------------------------------------
// Mots-clés des liens "mentions légales" (en minuscules).
// Comparés au textContent des <a>, insensiblement à la casse.
// ------------------------------------------------------------
// Seuil d'ancienneté du domaine : en dessous, on considère le domaine
// "récent" (red flag). ~6 mois en millisecondes.
const DOMAIN_AGE_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000;

const LEGAL_KEYWORDS = [
  'mentions légales',
  'cgv',
  'conditions générales',
  'politique de confidentialité',
  'legal notice',
  'terms'
];

// ------------------------------------------------------------
// Fonction 1 — checkSSL(url)
// ------------------------------------------------------------
// Vérifie que la connexion est chiffrée (HTTPS).
// Red flag levé (detected: true) si l'URL n'est PAS en https://.
//
// @param  {string} url  URL complète de la page (avec son schéma).
// @return {{ flag: string, detected: boolean }}
function checkSSL(url) {
  // On normalise pour tolérer un schéma en majuscules ("HTTPS://…").
  const isHttps = typeof url === 'string' &&
    url.trim().toLowerCase().startsWith('https://');

  return { flag: 'ssl_missing', detected: !isHttps };
}

// ------------------------------------------------------------
// Fonction 2 — checkLegalMentions(document)
// ------------------------------------------------------------
// Cherche dans la page au moins un lien <a> renvoyant vers des
// mentions légales / CGV / politique de confidentialité, etc.
//   - au moins 1 lien trouvé → detected: false (tout va bien)
//   - aucun lien trouvé       → detected: true  (red flag levé)
//
// @param  {Document} doc  Le DOM de la page à analyser.
// @return {{ flag: string, detected: boolean }}
function checkLegalMentions(doc) {
  // DOM indisponible (ex. appelé hors page) → on lève le flag par prudence.
  if (!doc || typeof doc.querySelectorAll !== 'function') {
    return { flag: 'no_legal_mentions', detected: true };
  }

  const anchors = doc.querySelectorAll('a');

  // Dès qu'un lien correspond, on peut conclure : pas de red flag.
  for (const anchor of anchors) {
    const text = (anchor.textContent || '').toLowerCase();
    if (LEGAL_KEYWORDS.some((keyword) => text.includes(keyword))) {
      return { flag: 'no_legal_mentions', detected: false };
    }
  }

  // Aucun lien légal trouvé → red flag levé.
  return { flag: 'no_legal_mentions', detected: true };
}

// ------------------------------------------------------------
// Fonction réseau — checkDomainAge(registrationDate, now)
// ------------------------------------------------------------
// Évalue l'ancienneté du domaine. Un domaine très récent est un signal
// classique d'arnaque ; un domaine ancien inspire confiance.
//
// IMPORTANT : la date d'enregistrement provient d'une requête WHOIS/RDAP
// qui ne peut PAS tourner dans le content script (CORS). Le fetch est donc
// fait côté service worker, qui passe ensuite la date à cette fonction PURE.
//
// Fail-open : si la date est inconnue/illisible (lookup en échec, offline,
// 4xx/5xx…), on NE lève PAS le flag — on préfère rater une arnaque
// qu'alerter à tort (cf. CLAUDE.md).
//
// @param  {Date|string|number|null} registrationDate  Date de création du domaine.
// @param  {number} [now=Date.now()]                   Horodatage de référence (testable).
// @return {{ flag: string, detected: boolean }}
function checkDomainAge(registrationDate, now = Date.now()) {
  if (!registrationDate) {
    return { flag: 'domain_recent', detected: false };
  }

  const created =
    registrationDate instanceof Date
      ? registrationDate.getTime()
      : new Date(registrationDate).getTime();

  // Date non parsable → fail-open.
  if (Number.isNaN(created)) {
    return { flag: 'domain_recent', detected: false };
  }

  const ageMs = now - created;
  return { flag: 'domain_recent', detected: ageMs < DOMAIN_AGE_THRESHOLD_MS };
}

// ------------------------------------------------------------
// Fonction 3 — calculateVerdict(redFlags)
// ------------------------------------------------------------
// Traduit la liste des red flags levés en verdict lisible.
//   - 0 red flag    → "safe"    (vert)
//   - 1-2 red flags → "warning" (orange)
//   - 3+ red flags  → "danger"  (rouge)
// Exception : l'absence de SSL ("ssl_missing") force "danger",
// quel que soit le nombre de red flags (risque jugé critique).
//
// @param  {string[]} redFlags  Tableau des identifiants de flags levés.
// @return {{ level: string, label: string, color: string }}
function calculateVerdict(redFlags) {
  const flags = Array.isArray(redFlags) ? redFlags : [];
  const count = flags.length;

  // Cas critique : connexion non chiffrée → danger immédiat.
  if (flags.includes('ssl_missing')) {
    return { level: 'danger', label: 'Risque élevé — soyez prudent', color: '#EF4444' };
  }

  if (count === 0) {
    return { level: 'safe', label: 'Site fiable', color: '#10B981' };
  }

  if (count <= 2) {
    return { level: 'warning', label: 'Quelques points à vérifier', color: '#F59E0B' };
  }

  return { level: 'danger', label: 'Risque élevé — soyez prudent', color: '#EF4444' };
}

// ------------------------------------------------------------
// Fonction principale — analyzeWebsite(hostname, document)
// ------------------------------------------------------------
// Orchestre les vérifications LOCALES (SSL + mentions légales), agrège les
// red flags levés et calcule un verdict provisoire. Le flag réseau
// 'domain_recent' (checkDomainAge) est ajouté ensuite par le service worker
// après le lookup WHOIS/RDAP, qui recalcule alors le verdict final.
//
// Le schéma (http/https) n'est pas porté par le hostname seul : on le
// récupère depuis le DOM (document.URL) avec repli sur le hostname.
//
// @param  {string}   hostname  Nom d'hôte du site (ex. "exemple.com").
// @param  {Document} doc       Le DOM de la page à analyser.
// @return {{ hostname: string, redFlags: string[],
//            verdict: { level, label, color }, timestamp: number }}
function analyzeWebsite(hostname, doc) {
  // URL complète (avec schéma) nécessaire à checkSSL.
  const url =
    (doc && (doc.URL || (doc.location && doc.location.href))) || hostname;

  // On lance chaque vérification.
  const checks = [
    checkSSL(url),
    checkLegalMentions(doc)
  ];

  // On ne conserve que les flags réellement levés.
  const redFlags = checks
    .filter((check) => check.detected)
    .map((check) => check.flag);

  return {
    hostname,
    redFlags,
    verdict: calculateVerdict(redFlags),
    timestamp: Date.now()
  };
}

// ------------------------------------------------------------
// Export (Node / tests). En contexte navigateur ou importScripts,
// les fonctions ci-dessus sont déjà globales : ce bloc est ignoré.
// ------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { checkSSL, checkLegalMentions, checkDomainAge, calculateVerdict, analyzeWebsite };
}
