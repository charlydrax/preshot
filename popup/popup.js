// popup/popup.js
console.log('[PreShot] popup.js loaded');

function fetchStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[PreShot] GET_STATUS error:', chrome.runtime.lastError.message);
      renderStatus(null);
      return;
    }
    renderStatus(response);
  });
}

function renderStatus(status) {
  const el = document.getElementById('preshot-popup-status');
  if (!status || status.verdict === null) {
    el.textContent = 'Aucune analyse disponible pour cet onglet.';
    return;
  }
  // TODO: display verdict, score, and flag count with color coding
  el.textContent = `Verdict : ${status.verdict}`;
  console.log('[PreShot] renderStatus', status);
}

fetchStatus();
