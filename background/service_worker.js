// background/service_worker.js
// ============================================================
// PreShot — Service Worker (Manifest V3)
//
// Rôle : cerveau de l'extension. Il reçoit les signaux du content
// script, lance l'analyse du site, pilote l'icône + le badge de la
// barre d'outils, met le résultat en cache (24h) et tient le side
// panel / le popup informés.
//
// Worker "classique" (le manifest ne déclare pas "type":"module").
// L'analyse (red flags + verdict) est calculée par utils/scoring.js dans
// le content script puis transmise via le message CHECKOUT_DETECTED ; le
// SW la met en cache et pilote l'icône/badge, la bannière et le side panel.
// ============================================================

console.log('[PreShot] service_worker.js loaded');

// On charge le scoring pour réutiliser checkDomainAge() et calculateVerdict()
// côté SW (le content script en charge sa propre copie via le manifest).
importScripts('/utils/scoring.js');

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
  if (message.type === 'OPEN_SIDE_PANEL') {
    handleOpenSidePanel(sender, sendResponse);
    return true;
  }
  if (message.type === 'REANALYZE') {
    handleReanalyze(message, sender, sendResponse);
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

    // 1) Cache d'abord : si une analyse fraîche (<24h) existe, on la réutilise
    //    (évite de refaire le lookup WHOIS). Sinon : on part des flags locaux
    //    du content script, on y ajoute le flag réseau 'domain_recent' (RDAP),
    //    puis on recalcule le verdict final.
    let result = await getCachedAnalysis(hostname);
    if (!result) {
      const redFlags = Array.isArray(message.redFlags) ? [...message.redFlags] : [];

      // Lookup WHOIS/RDAP (réseau, SW only). Fail-open en cas d'échec.
      const registrationDate = await fetchDomainAge(hostname);
      const ageCheck = checkDomainAge(registrationDate);
      if (ageCheck.detected) redFlags.push(ageCheck.flag);

      // Verdict recalculé avec l'ensemble des flags (locaux + réseau).
      result = { redFlags, verdict: calculateVerdict(redFlags) };
      await setCachedAnalysis(hostname, result);
    }

    // 2) Nombre de red flags → alimente le badge numérique.
    const redFlagCount = Array.isArray(result.redFlags) ? result.redFlags.length : 0;

    // 3) Mise à jour visuelle de l'icône + badge pour cet onglet.
    //    L'icône suit verdict.level (respecte l'exception SSL = danger).
    updateBadge(tabId, result.verdict, redFlagCount);

    // 4) On informe le side panel (s'il est ouvert).
    broadcastAnalysisComplete({
      hostname,
      url: message.url,
      signalCount: message.signalCount,
      redFlagCount,
      ...result // redFlags, verdict
    });

    // 5) Persister le résultat par tabId (chrome.storage.session survit aux
    //    redémarrages du service worker dans la même session navigateur).
    if (typeof tabId === 'number') {
      await setTabResult(tabId, {
        verdict: result.verdict,
        redFlagCount,
        redFlags: result.redFlags,
        hostname
      });
    }

    // 6) Afficher la bannière dans le content script de l'onglet actif.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { type: 'SHOW_BANNER', redFlagsCount: redFlagCount, verdict: result.verdict.level },
          () => void chrome.runtime.lastError
        );
      }
    });

    // 7) Accusé de réception au content script.
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

    // Priorité 1 : résultat scopé au tabId (fiable même après redémarrage du SW).
    const tabResult = await getTabResult(activeTab.id);
    if (tabResult) {
      sendResponse(tabResult);
      return;
    }

    // Priorité 2 : cache hostname (fallback si tabId non disponible).
    const hostname = getHostname(activeTab.url);
    const cached = await getCachedAnalysis(hostname);
    sendResponse(cached || { verdict: null });
  } catch (err) {
    console.error('[PreShot] handleGetStatus error:', err);
    sendResponse({ verdict: null });
  }
}

// ------------------------------------------------------------
// Mise à jour de l'icône + badge (scopé à un onglet)
// ------------------------------------------------------------
function updateBadge(tabId, verdict, redFlagCount) {
  // Sans onglet cible on ne peut pas mettre à jour proprement.
  if (typeof tabId !== 'number') return;

  const iconKey = iconForLevel(verdict && verdict.level);

  // Icône colorée selon le niveau de risque (verdict.level).
  chrome.action.setIcon({ tabId, path: ICONS[iconKey] });

  // Badge : le nombre de red flags si > 0, sinon vide.
  chrome.action.setBadgeText({
    tabId,
    text: redFlagCount > 0 ? String(redFlagCount) : ''
  });

  // Fond de badge en rouge.
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
}

// Traduit le niveau de verdict de scoring.js (safe/warning/danger) en clé d'icône.
function iconForLevel(level) {
  if (level === 'danger') return 'red';
  if (level === 'warning') return 'orange';
  return 'green'; // safe (ou valeur inconnue) → vert
}

// ------------------------------------------------------------
// OPEN_SIDE_PANEL — Content Script → Service Worker
// ------------------------------------------------------------
// Déclenché quand l'utilisateur clique "Voir le diagnostic" dans la bannière.
// chrome.sidePanel.open() nécessite un windowId ou tabId.
async function handleOpenSidePanel(sender, sendResponse) {
  try {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      await chrome.sidePanel.open({ tabId });
    }
    sendResponse({ status: 'ok' });
  } catch (err) {
    console.error('[PreShot] handleOpenSidePanel error:', err);
    sendResponse({ status: 'error' });
  }
}

// ------------------------------------------------------------
// REANALYZE — Side Panel → Service Worker
// ------------------------------------------------------------
// Déclenché par le bouton « Re-analyser » du panneau. On vide le cache du
// site (et le résultat scopé à l'onglet) pour forcer une analyse fraîche
// — y compris un nouveau lookup WHOIS — puis on demande au content script
// de relancer l'analyse de la page (RUN_ANALYSIS). Le content script
// renverra un CHECKOUT_DETECTED qui repassera par tout le pipeline.
async function handleReanalyze(message, sender, sendResponse) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.url) {
      sendResponse({ status: 'no-tab' });
      return;
    }

    const hostname = getHostname(activeTab.url);

    // Bypass cache : on supprime l'entrée hostname + le résultat de l'onglet.
    await chrome.storage.local.remove(cacheKey(hostname));
    if (typeof activeTab.id === 'number') {
      await chrome.storage.session.remove(tabKey(activeTab.id));
      chrome.tabs.sendMessage(
        activeTab.id,
        { type: 'RUN_ANALYSIS' },
        () => void chrome.runtime.lastError // page sans content script : sans gravité
      );
    }

    sendResponse({ status: 'ok' });
  } catch (err) {
    console.error('[PreShot] handleReanalyze error:', err);
    sendResponse({ status: 'error' });
  }
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
// Résultats par tabId — chrome.storage.session
// ------------------------------------------------------------
// Survit aux redémarrages du service worker dans la même session navigateur,
// contrairement à une simple variable globale qui serait réinitialisée.

function tabKey(tabId) {
  return 'tab_' + tabId;
}

async function setTabResult(tabId, result) {
  await chrome.storage.session.set({ [tabKey(tabId)]: result });
}

async function getTabResult(tabId) {
  const data = await chrome.storage.session.get(tabKey(tabId));
  return data[tabKey(tabId)] || null;
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

// Note : les flags LOCAUX (SSL + mentions légales) sont calculés par
// utils/scoring.js dans le content script puis transmis via CHECKOUT_DETECTED.
// Le flag RÉSEAU 'domain_recent' est ajouté ici, après le lookup ci-dessous.

// ------------------------------------------------------------
// WHOIS / RDAP — ancienneté du domaine
// ------------------------------------------------------------
// Endpoint RDAP bootstrap : rdap.org redirige (302) vers le serveur RDAP
// autoritaire du registre. fetch() suit la redirection ; les serveurs RDAP
// renvoient du JSON avec un tableau "events" contenant la date d'enregistrement.

const RDAP_BASE = 'https://rdap.org/domain/';
const RDAP_TIMEOUT_MS = 4000;

// Renvoie la Date d'enregistrement du domaine, ou null si indisponible
// (offline, timeout, 4xx/5xx, domaine introuvable, JSON inattendu).
// Fail-open : tout échec → null → checkDomainAge ne lève pas le flag.
async function fetchDomainAge(hostname) {
  // AbortController : coupe la requête si le serveur RDAP traîne.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);

  try {
    const res = await fetch(RDAP_BASE + encodeURIComponent(hostname), {
      signal: controller.signal,
      headers: { Accept: 'application/rdap+json' }
    });

    if (!res.ok) return null; // 404 (domaine inconnu), 429, 5xx…

    const data = await res.json();
    const events = Array.isArray(data.events) ? data.events : [];

    // On cherche l'évènement "registration" (création du domaine).
    const registration = events.find((e) => e && e.eventAction === 'registration');
    if (!registration || !registration.eventDate) return null;

    return new Date(registration.eventDate);
  } catch (err) {
    // AbortError (timeout) ou erreur réseau : on échoue silencieusement.
    console.warn('[PreShot] fetchDomainAge échec pour', hostname, ':', String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
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
