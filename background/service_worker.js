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

// On charge le scoring (checkDomainAge, calculateVerdict) et la whitelist
// (isTrustedDomain) côté SW. Le content script charge sa propre copie de
// scoring.js via le manifest.
importScripts('/utils/scoring.js');
importScripts('/utils/whitelist.js');

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

// Durée de vie du cache : 24 heures (en millisecondes).
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Couleur de fond du badge (rouge) — appliquée dès qu'un chiffre s'affiche.
const BADGE_COLOR = '#dc2626';

// L'icône de la barre d'outils est FIXE (icon_normal_v5, déclarée dans le
// manifest). On ne la change plus selon le niveau de risque : le badge
// numérique rouge suffit à signaler les red flags. Cela évite aussi l'appel
// chrome.action.setIcon() qui échouait par moments ("Failed to fetch").

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
    //    (évite de refaire le lookup WHOIS). Sinon on calcule et on met en cache.
    let result = await getCachedAnalysis(hostname);
    if (!result) {
      result = await computeAnalysis(hostname, message.redFlags);
      await setCachedAnalysis(hostname, result);
    }

    // 2) Nombre de red flags → alimente le badge numérique.
    const redFlagCount = Array.isArray(result.redFlags) ? result.redFlags.length : 0;

    // 3) Mise à jour du badge numérique pour cet onglet (icône fixe).
    updateBadge(tabId, redFlagCount);

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

    // 6) Afficher la bannière dans l'onglet qui a DÉCLENCHÉ la détection
    //    (sender.tab.id), et non l'onglet actif — sinon une détection en
    //    arrière-plan injecterait la bannière sur le mauvais onglet.
    if (typeof tabId === 'number') {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'SHOW_BANNER', redFlagsCount: redFlagCount, verdict: result.verdict.level },
        () => void chrome.runtime.lastError
      );
    }

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

    // Pas d'onglet du tout → rien à montrer.
    if (!activeTab) {
      sendResponse({ verdict: null });
      return;
    }

    // Priorité 1 : résultat scopé au tabId. `activeTab.id` est TOUJOURS
    // disponible (contrairement à `activeTab.url`, undefined sans la
    // permission `tabs` quand le panel est ouvert via sidePanel.open()).
    // C'est ce qui permet au panel de récupérer le verdict du bon onglet.
    if (typeof activeTab.id === 'number') {
      const tabResult = await getTabResult(activeTab.id);
      if (tabResult) {
        sendResponse(tabResult);
        return;
      }
    }

    // Priorité 2 : fallback cache hostname, uniquement si l'URL est lisible.
    if (activeTab.url) {
      const hostname = getHostname(activeTab.url);
      const cached = await getCachedAnalysis(hostname);
      sendResponse(cached || { verdict: null });
      return;
    }

    sendResponse({ verdict: null });
  } catch (err) {
    console.error('[PreShot] handleGetStatus error:', err);
    sendResponse({ verdict: null });
  }
}

// ------------------------------------------------------------
// Mise à jour du badge (scopé à un onglet)
// ------------------------------------------------------------
// L'icône reste fixe (cf. note en haut du fichier) ; on ne pilote que le
// badge numérique = nombre de red flags détectés sur cet onglet.
function updateBadge(tabId, redFlagCount) {
  // Sans onglet cible on ne peut pas mettre à jour proprement.
  if (typeof tabId !== 'number') return;

  // Badge : le nombre de red flags si > 0, sinon vide.
  chrome.action.setBadgeText({
    tabId,
    text: redFlagCount > 0 ? String(redFlagCount) : ''
  });

  // Fond de badge en rouge.
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
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

// ------------------------------------------------------------
// Calcul de l'analyse (cache-miss)
// ------------------------------------------------------------
// Combine les flags LOCAUX (SSL + mentions légales, calculés par scoring.js
// dans le content script) avec le flag RÉSEAU 'domain_recent' (WHOIS/RDAP),
// puis calcule le verdict.
//
// Court-circuit whitelist : pour un grand site de confiance, on renvoie
// directement un verdict "safe" sans aucun red flag (anti faux positif).
//
// Degraded mode : si le lookup WHOIS échoue, on conserve les flags locaux
// et on n'interrompt jamais l'analyse.
async function computeAnalysis(hostname, localRedFlags) {
  if (isTrustedDomain(hostname)) {
    console.log('[PreShot] Domaine de confiance, analyse ignorée:', hostname);
    return { redFlags: [], verdict: calculateVerdict([]) };
  }

  const redFlags = Array.isArray(localRedFlags) ? [...localRedFlags] : [];

  try {
    // fetchDomainAge gère déjà ses erreurs (fail-open → null) ; ce try/catch
    // est une sécurité supplémentaire pour ne jamais casser l'analyse.
    const registrationDate = await fetchDomainAge(hostname);
    const ageCheck = checkDomainAge(registrationDate);
    if (ageCheck.detected) redFlags.push(ageCheck.flag);
  } catch (err) {
    console.warn('[PreShot] computeAnalysis: WHOIS indisponible:', String(err));
  }

  return { redFlags, verdict: calculateVerdict(redFlags) };
}

// ------------------------------------------------------------
// WHOIS / RDAP — ancienneté du domaine
// ------------------------------------------------------------
// Endpoint RDAP bootstrap : rdap.org redirige (302) vers le serveur RDAP
// autoritaire du registre. fetch() suit la redirection ; les serveurs RDAP
// renvoient du JSON avec un tableau "events" contenant la date d'enregistrement.

const RDAP_BASE = 'https://rdap.org/domain/';
const RDAP_TIMEOUT_MS = 5000;

// Renvoie la Date d'enregistrement du domaine, ou null si indisponible
// (offline, timeout, 4xx/5xx, domaine introuvable, JSON inattendu).
// Fail-open : tout échec → null → checkDomainAge ne lève pas le flag.
async function fetchDomainAge(hostname) {
  // RDAP attend le domaine ENREGISTRABLE (eTLD+1), pas un sous-domaine :
  // "checkout.boutique.com" → "boutique.com", sinon 404 et flag jamais levé.
  const domain = getRegistrableDomain(hostname);
  if (!domain) return null;

  // AbortController : coupe la requête si le serveur RDAP traîne.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);

  try {
    const res = await fetch(RDAP_BASE + encodeURIComponent(domain), {
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
// Restauration du badge au changement d'onglet
// ------------------------------------------------------------
// Quand l'utilisateur bascule sur un onglet, on RESTAURE le nombre de red
// flags déjà calculé pour cet onglet au lieu de le réinitialiser aveuglément
// — sinon un site analysé "à risque" perdrait son badge au simple aller-retour
// entre onglets.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const result = await getTabResult(tabId);
    if (result) {
      updateBadge(tabId, result.redFlagCount);
    } else {
      // Aucun diagnostic pour cet onglet → badge vide.
      chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (err) {
    console.warn('[PreShot] onActivated restore error:', String(err));
  }
});
