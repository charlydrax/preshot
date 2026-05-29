// background/service_worker.js
// ============================================================
// PreShot — Service Worker (Manifest V3)
//
// Rôle : cerveau de l'extension. Il reçoit les signaux du content
// script, lance l'analyse du site, pilote l'icône + le badge de la
// barre d'outils, met le résultat en cache (24h) et tient le side
// panel / le popup informés.
//
// Worker "classique" (le manifest ne déclare pas "type":"module"),
// donc on charge un éventuel utilitaire avec importScripts('/utils/..').
// L'analyse réelle n'est pas encore branchée : analyzeWebsite() est
// pour l'instant un placeholder.
// ============================================================

console.log('[PreShot] service_worker.js loaded');

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

// Durée de vie du cache : 24 heures (en millisecondes).
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Couleur de fond du badge (rouge) — appliquée dès qu'un chiffre s'affiche.
const BADGE_COLOR = '#dc2626';

// Chemins des icônes (relatifs à la racine de l'extension), un par niveau de risque.
const ICONS = {
  green: 'icons/icon_green.png',   // 0 red flag        → site fiable
  orange: 'icons/icon_orange.png', // 1-2 red flags     → à vérifier
  red: 'icons/icon_red.png'        // 3+ red flags       → risque élevé
};

// ------------------------------------------------------------
// Listener principal des messages inter-composants
// ------------------------------------------------------------
// Les handlers répondent de façon asynchrone (storage, tabs…), donc on
// renvoie `true` pour garder le canal `sendResponse` ouvert.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECKOUT_DETECTED') {
    handleCheckoutDetected(message, sender, sendResponse);
    return true;
  }
  if (message.type === 'GET_STATUS') {
    handleGetStatus(message, sender, sendResponse);
    return true;
  }
  // Message inconnu : on ne garde pas le canal ouvert.
  return false;
});

// ------------------------------------------------------------
// CHECKOUT_DETECTED — Content Script → Service Worker
// ------------------------------------------------------------
// Déclenché quand le detector repère une page de paiement. On analyse
// le site (cache d'abord), on met à jour le badge, on persiste le
// résultat et on prévient le side panel.
async function handleCheckoutDetected(message, sender, sendResponse) {
  try {
    // L'onglet d'origine (sender.tab) sert à scoper le badge à CET onglet.
    const tabId = sender.tab && sender.tab.id;

    // Remarque : detector.js envoie déjà location.hostname dans `url`.
    // getHostname() reste robuste si une URL complète arrive un jour.
    const hostname = getHostname(message.url);

    console.log('[PreShot] CHECKOUT_DETECTED', { hostname, signalCount: message.signalCount });

    // 1) Cache d'abord : si une analyse fraîche (<24h) existe, on la réutilise.
    let result = await getCachedAnalysis(hostname);
    if (!result) {
      result = await analyzeWebsite(message.url);
      await setCachedAnalysis(hostname, result);
    }

    // 2) Nombre de red flags → pilote l'icône et le badge.
    const redFlagCount = Array.isArray(result.redFlags) ? result.redFlags.length : 0;

    // 3) Mise à jour visuelle de l'icône + badge pour cet onglet.
    updateBadge(tabId, redFlagCount);

    // 4) On informe le side panel (s'il est ouvert).
    broadcastAnalysisComplete({
      hostname,
      url: message.url,
      signalCount: message.signalCount,
      redFlagCount,
      ...result // redFlags, verdict
    });

    // 5) Accusé de réception au content script.
    sendResponse({ status: 'ok', redFlagCount });
  } catch (err) {
    console.error('[PreShot] handleCheckoutDetected error:', err);
    sendResponse({ status: 'error', message: String(err) });
  }
}

// ------------------------------------------------------------
// GET_STATUS — Popup → Service Worker
// ------------------------------------------------------------
// Le popup ne connaît pas le hostname : on récupère l'onglet actif,
// on en déduit le hostname puis on renvoie la dernière analyse en cache.
async function handleGetStatus(message, sender, sendResponse) {
  try {
    console.log('[PreShot] GET_STATUS received');

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Pas d'onglet exploitable (ex. page interne chrome://) → rien à montrer.
    if (!activeTab || !activeTab.url) {
      sendResponse({ verdict: null });
      return;
    }

    const hostname = getHostname(activeTab.url);
    const cached = await getCachedAnalysis(hostname);

    // `popup.js` teste `status.verdict === null` pour l'état "aucune analyse".
    sendResponse(cached || { verdict: null });
  } catch (err) {
    console.error('[PreShot] handleGetStatus error:', err);
    sendResponse({ verdict: null });
  }
}

// ------------------------------------------------------------
// Mise à jour de l'icône + badge (scopé à un onglet)
// ------------------------------------------------------------
function updateBadge(tabId, redFlagCount) {
  // Sans onglet cible on ne peut pas mettre à jour proprement.
  if (typeof tabId !== 'number') return;

  const level = getVerdictLevel(redFlagCount);

  // Icône colorée selon le niveau de risque.
  chrome.action.setIcon({ tabId, path: ICONS[level] });

  // Badge : le nombre de red flags si > 0, sinon vide.
  chrome.action.setBadgeText({
    tabId,
    text: redFlagCount > 0 ? String(redFlagCount) : ''
  });

  // Fond de badge en rouge.
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
}

// Traduit un nombre de red flags en niveau visuel (mêmes seuils que
// computeVerdict() dans utils/scoring.js).
function getVerdictLevel(redFlagCount) {
  if (redFlagCount === 0) return 'green';
  if (redFlagCount <= 2) return 'orange';
  return 'red';
}

// ------------------------------------------------------------
// Diffusion vers le side panel
// ------------------------------------------------------------
// runtime.sendMessage lève une erreur "Could not establish connection"
// si aucun receveur (panel fermé). On consomme lastError dans le
// callback pour l'ignorer silencieusement.
function broadcastAnalysisComplete(data) {
  chrome.runtime.sendMessage({ type: 'ANALYSIS_COMPLETE', data }, () => {
    void chrome.runtime.lastError; // panel non ouvert : sans gravité
  });
}

// ------------------------------------------------------------
// Cache (chrome.storage.local), clé "analysis_<hostname>"
// ------------------------------------------------------------

// Construit la clé de stockage pour un hostname donné.
function cacheKey(hostname) {
  return 'analysis_' + hostname;
}

// Renvoie l'analyse en cache si elle date de moins de 24h, sinon null.
async function getCachedAnalysis(hostname) {
  const key = cacheKey(hostname);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];

  if (!entry) return null;
  if (Date.now() - entry.timestamp >= CACHE_TTL_MS) return null; // expiré

  return entry.data;
}

// Stocke l'analyse avec un horodatage pour gérer l'expiration.
async function setCachedAnalysis(hostname, data) {
  await chrome.storage.local.set({
    [cacheKey(hostname)]: { timestamp: Date.now(), data }
  });
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

// Extrait le hostname d'une URL complète ; si la valeur est déjà un
// hostname brut (cas de detector.js), on la renvoie telle quelle.
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// PLACEHOLDER : analyse du site.
// Pour l'instant renvoie toujours un résultat "safe" sans red flag.
// À terme, déléguera aux utilitaires existants :
//   - utils/scoring.js : computeVerdict(), checkSsl(), checkDomainAge(), checkLegalMentions()
//   - utils/whitelist.js : isWhitelisted()
// (chargés via importScripts('/utils/scoring.js', '/utils/whitelist.js')).
async function analyzeWebsite(url) {
  return { redFlags: [], verdict: 'safe' };
}

// ------------------------------------------------------------
// Reset du badge au changement d'onglet
// ------------------------------------------------------------
// Quand l'utilisateur bascule sur un autre onglet, on remet le badge à
// un état neutre (icône verte, aucun chiffre) pour ne pas afficher le
// verdict d'un onglet sur un autre.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.action.setBadgeText({ tabId, text: '' });
  chrome.action.setIcon({ tabId, path: ICONS.green });
});
