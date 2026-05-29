// content/banner.js
console.log('[PreShot] banner.js loaded');

// ----------------------------------------------------------------
// Styles
// ----------------------------------------------------------------

function preshot_injectStyles() {
  if (document.getElementById('preshot-styles')) return;

  const style = document.createElement('style');
  style.id = 'preshot-styles';
  style.textContent = `
    #preshot-banner {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      width: 320px;
      padding: 16px;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06);
      border-left: 4px solid #10B981;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      color: #1f2937;
      transform: translateX(360px);
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-sizing: border-box;
    }

    #preshot-banner.preshot-visible {
      transform: translateX(0);
    }

    #preshot-banner[data-verdict="safe"]    { border-left-color: #10B981; }
    #preshot-banner[data-verdict="warning"] { border-left-color: #F59E0B; }
    #preshot-banner[data-verdict="danger"]  { border-left-color: #EF4444; }

    #preshot-banner-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    #preshot-banner-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      font-size: 15px;
      color: #111827;
    }

    #preshot-banner-close {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: #9ca3af;
      padding: 0;
      line-height: 1;
      flex-shrink: 0;
    }

    #preshot-banner-close:hover { color: #374151; }

    #preshot-banner-message {
      margin: 0 0 12px 0;
      color: #374151;
      line-height: 1.45;
    }

    #preshot-banner-cta {
      display: inline-block;
      padding: 8px 14px;
      border-radius: 8px;
      background: #1f2937;
      color: #ffffff;
      font-size: 13px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      font-family: inherit;
    }

    #preshot-banner-cta:hover { background: #374151; }
  `;

  document.head.appendChild(style);
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function preshot_buildMessage(redFlagsCount, verdict) {
  if (verdict === 'safe' || redFlagsCount === 0) {
    return 'Aucun problème détecté sur ce site.';
  }
  const plural = redFlagsCount > 1 ? 's' : '';
  return `${redFlagsCount} élément${plural} à vérifier avant de payer`;
}

// ----------------------------------------------------------------
// Banner lifecycle
// ----------------------------------------------------------------

let preshot_autoCloseTimer = null;

function preshot_removeBanner() {
  const banner = document.getElementById('preshot-banner');
  if (!banner) return;
  clearTimeout(preshot_autoCloseTimer);
  banner.classList.remove('preshot-visible');
  // attendre la fin de la transition CSS avant de supprimer le nœud
  setTimeout(() => banner.remove(), 400);
}

function preshot_startAutoClose() {
  clearTimeout(preshot_autoCloseTimer);
  preshot_autoCloseTimer = setTimeout(preshot_removeBanner, 10000);
}

function preshot_injectBanner(redFlagsCount, verdict) {
  // Ne pas doubler la bannière si elle est déjà présente
  if (document.getElementById('preshot-banner')) return;

  preshot_injectStyles();

  const banner = document.createElement('div');
  banner.id = 'preshot-banner';
  banner.setAttribute('data-verdict', verdict);

  banner.innerHTML = `
    <div id="preshot-banner-header">
      <div id="preshot-banner-title">
        <span>🛡️</span>
        <span>PreShot</span>
      </div>
      <button id="preshot-banner-close" aria-label="Fermer la notification">✕</button>
    </div>
    <p id="preshot-banner-message">${preshot_buildMessage(redFlagsCount, verdict)}</p>
    <button id="preshot-banner-cta">Voir le diagnostic</button>
  `;

  document.body.appendChild(banner);

  // Double rAF : garantit que le navigateur a peint l'état initial
  // (translateX(360px)) avant de déclencher la transition vers (0).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => banner.classList.add('preshot-visible'));
  });

  // Fermeture manuelle
  banner.querySelector('#preshot-banner-close').addEventListener('click', preshot_removeBanner);

  // Ouverture du side panel
  banner.querySelector('#preshot-banner-cta').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  });

  // Auto-fermeture 10s, suspendue au survol
  preshot_startAutoClose();
  banner.addEventListener('mouseenter', () => clearTimeout(preshot_autoCloseTimer));
  banner.addEventListener('mouseleave', preshot_startAutoClose);

  console.log('[PreShot] banner injected — verdict:', verdict, '| redFlags:', redFlagsCount);
}

// ----------------------------------------------------------------
// Listener de messages depuis le service worker
// ----------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SHOW_BANNER') {
    const { redFlagsCount, verdict } = message;
    preshot_injectBanner(redFlagsCount, verdict);
  }
});
