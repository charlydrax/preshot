// panel/panel.js
console.log('[PreShot] panel.js loaded');

function renderVerdict(level, label) {
  const section = document.getElementById('preshot-verdict-section');
  // TODO: clear section, create verdict badge with level color class
  // TODO: inject label text and icon matching level
  console.log('[PreShot] renderVerdict', level, label);
}

function renderFlags(flags) {
  const list = document.getElementById('preshot-flags-list');
  // TODO: clear list, append <li class="preshot-flag-item"> for each flag
  // TODO: use ✓/✗ indicator and flag.label text
  console.log('[PreShot] renderFlags', flags);
}

function showLoading() {
  const main = document.getElementById('preshot-panel-main');
  // TODO: display "Analyse en cours…" with a spinner
  console.log('[PreShot] showLoading');
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ANALYSIS_COMPLETE') {
    renderVerdict(message.level, message.label);
    renderFlags(message.flags);
  }
});

showLoading();
