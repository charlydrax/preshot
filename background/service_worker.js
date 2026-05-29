// background/service_worker.js
console.log('[PreShot] service_worker.js loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECKOUT_DETECTED') {
    handleCheckoutDetected(message, sender, sendResponse);
    return true;
  }
  if (message.type === 'GET_STATUS') {
    handleGetStatus(message, sender, sendResponse);
    return true;
  }
});

function handleCheckoutDetected(message, sender, sendResponse) {
  // TODO: run red flag checks (domain age, SSL, legal mentions)
  // TODO: compute score via scoring.js logic
  // TODO: update badge via updateBadge()
  // TODO: store result in chrome.storage.session keyed by tabId
  // TODO: broadcast ANALYSIS_COMPLETE to side panel
  console.log('[PreShot] CHECKOUT_DETECTED received for', message.url);
  sendResponse({ status: 'received' });
}

function handleGetStatus(message, sender, sendResponse) {
  // TODO: read from chrome.storage.session keyed by tabId
  // TODO: return { verdict, redFlags, score } or null if not analyzed
  console.log('[PreShot] GET_STATUS received');
  sendResponse({ verdict: null });
}

function broadcastAnalysisComplete(tabId, result) {
  // TODO: chrome.runtime.sendMessage({ type: 'ANALYSIS_COMPLETE', ...result })
  console.log('[PreShot] ANALYSIS_COMPLETE broadcast for tab', tabId);
}

function updateBadge(tabId, redFlagCount) {
  // TODO: chrome.action.setBadgeText({ text: String(redFlagCount), tabId })
  // TODO: chrome.action.setBadgeBackgroundColor based on verdict level
  console.log('[PreShot] updateBadge', redFlagCount, 'flags for tab', tabId);
}
