// content/banner.js
console.log('[PreShot] banner.js loaded');

// ----------------------------------------------------------------
// Styles (thème sombre, maquette Figma)
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
      width: 360px;
      padding: 21px;
      border-radius: 20px;
      background: #0d1220;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 12px 15px rgba(0, 0, 0, 0.15), 0 4px 24px rgba(0, 0, 0, 0.35);
      font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      color: #ffffff;
      transform: translateX(400px);
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-sizing: border-box;
    }

    #preshot-banner.preshot-visible {
      transform: translateX(0);
    }

    #preshot-banner-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      padding-right: 20px;
    }

    #preshot-banner-icon {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 18px;
      background: #dc2626;
      color: #ffffff;
      font-size: 16px;
      font-weight: 800;
      line-height: 1;
    }

    #preshot-banner[data-verdict="warning"] #preshot-banner-icon { background: #f59e0b; }
    #preshot-banner[data-verdict="safe"]    #preshot-banner-icon { background: #10b981; }

    #preshot-banner-title {
      font-weight: 700;
      font-size: 16px;
      line-height: 1.25;
      color: #ffffff;
    }

    #preshot-banner-close {
      position: absolute;
      top: 14px;
      right: 16px;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.5);
      padding: 0;
      line-height: 1;
    }
    #preshot-banner-close:hover { color: #ffffff; }

    #preshot-banner-message {
      margin: 0 0 14px 0;
      color: rgba(255, 255, 255, 0.85);
      font-size: 14px;
      line-height: 21px;
    }

    #preshot-banner-cta {
      display: inline-block;
      width: 100%;
      padding: 10px 14px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.18);
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s ease;
    }
    #preshot-banner-cta:hover { background: rgba(255, 255, 255, 0.2); }

    /* Pastille d'alerte : petit bloc rouge "!" fixé en haut à droite de la
       page (au plus près de la barre d'outils du navigateur), persistante
       tant qu'un élément cloche sur le site. */
    #preshot-alert-badge {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      background: #dc2626;
      color: #ffffff;
      font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 22px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
      user-select: none;
      box-sizing: border-box;
      box-shadow: 0 4px 14px rgba(220, 38, 38, 0.45), 0 1px 4px rgba(0, 0, 0, 0.15);
      animation: preshot-alert-pop 0.3s ease both,
                 preshot-alert-pulse 2s ease-in-out 1.5s infinite;
    }

    #preshot-alert-badge:hover { background: #b91c1c; }

    @keyframes preshot-alert-pop {
      from { opacity: 0; transform: scale(0.6); }
      to   { opacity: 1; transform: scale(1); }
    }

    @keyframes preshot-alert-pulse {
      0%, 100% { box-shadow: 0 4px 14px rgba(220, 38, 38, 0.45), 0 1px 4px rgba(0, 0, 0, 0.15); }
      50%      { box-shadow: 0 4px 22px rgba(220, 38, 38, 0.8), 0 1px 6px rgba(0, 0, 0, 0.2); }
    }

    @media (prefers-reduced-motion: reduce) {
      #preshot-alert-badge { animation: preshot-alert-pop 0.3s ease both; }
      #preshot-banner { transition: none; }
    }
  `;

  document.head.appendChild(style);
}

// ----------------------------------------------------------------
// Helpers — copie de la bannière selon le verdict
// ----------------------------------------------------------------

function preshot_bannerCopy(redFlagsCount, verdict) {
  if (verdict === 'safe' || redFlagsCount === 0) {
    return {
      icon: '✓',
      title: 'Aucun élément suspect détecté',
      text: 'Ce site ne présente pas de signal inhabituel. Restez tout de même vigilant avant de payer.'
    };
  }
  return {
    icon: '!',
    title: 'PreShot a détecté des éléments à vérifier',
    text: 'Ce site présente plusieurs signaux inhabituels avant paiement. Vérifiez les informations avant de poursuivre.'
  };
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

  const copy = preshot_bannerCopy(redFlagsCount, verdict);

  const banner = document.createElement('div');
  banner.id = 'preshot-banner';
  banner.setAttribute('data-verdict', verdict);

  banner.innerHTML = `
    <button id="preshot-banner-close" aria-label="Fermer la notification">✕</button>
    <div id="preshot-banner-header">
      <div id="preshot-banner-icon" aria-hidden="true">${copy.icon}</div>
      <div id="preshot-banner-title">${copy.title}</div>
    </div>
    <p id="preshot-banner-message">${copy.text}</p>
    <button id="preshot-banner-cta">Voir le diagnostic</button>
  `;

  document.body.appendChild(banner);

  // Double rAF : garantit que le navigateur a peint l'état initial
  // (translateX) avant de déclencher la transition vers (0).
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
// Pastille d'alerte (haut à droite)
// ----------------------------------------------------------------

function preshot_removeAlertBadge() {
  const badge = document.getElementById('preshot-alert-badge');
  if (badge) badge.remove();
}

function preshot_injectAlertBadge(redFlagsCount, verdict) {
  // Aucun problème détecté → pas de pastille (et on retire une éventuelle
  // ancienne, ex. après une re-analyse qui repasse le site au vert).
  if (verdict === 'safe' || !redFlagsCount) {
    preshot_removeAlertBadge();
    return;
  }

  // Déjà présente → ne pas dupliquer.
  if (document.getElementById('preshot-alert-badge')) return;

  preshot_injectStyles();

  const plural = redFlagsCount > 1 ? 's' : '';
  const label = `PreShot : ${redFlagsCount} élément${plural} à vérifier sur ce site`;

  const badge = document.createElement('div');
  badge.id = 'preshot-alert-badge';
  badge.textContent = '!';
  badge.setAttribute('role', 'button');
  badge.setAttribute('tabindex', '0');
  badge.setAttribute('aria-label', label);
  badge.title = `${label} — cliquez pour le diagnostic`;

  // Clic / clavier → ouverture du side panel (comme le CTA de la bannière).
  const openDiagnostic = () => chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  badge.addEventListener('click', openDiagnostic);
  badge.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDiagnostic();
    }
  });

  document.body.appendChild(badge);
  console.log('[PreShot] alert badge injected — redFlags:', redFlagsCount);
}

// ----------------------------------------------------------------
// Listener de messages depuis le service worker
// ----------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SHOW_BANNER') {
    const { redFlagsCount, verdict } = message;
    preshot_injectBanner(redFlagsCount, verdict);
    preshot_injectAlertBadge(redFlagsCount, verdict);
  }
});
