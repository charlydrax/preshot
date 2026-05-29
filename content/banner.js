// content/banner.js
console.log('[PreShot] banner.js loaded');

function injectBanner(level, message) {
  if (document.getElementById('preshot-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'preshot-banner';
  banner.setAttribute('data-level', level);

  // TODO: apply fixed positioning (bottom-right, high z-index)
  // TODO: set background color based on level (green/orange/red)
  // TODO: add close button (#preshot-banner-close)
  // TODO: add message text span (#preshot-banner-text)

  document.body.appendChild(banner);
  console.log('[PreShot] banner injected at level', level);
}

function removeBanner() {
  const banner = document.getElementById('preshot-banner');
  if (banner) banner.remove();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ANALYSIS_COMPLETE') {
    // TODO: derive level from message.verdict
    // TODO: call injectBanner(level, message.summary)
    console.log('[PreShot] ANALYSIS_COMPLETE received in banner.js', message);
  }
});
