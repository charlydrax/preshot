// utils/scoring.js
console.log('[PreShot] scoring.js loaded');

const VERDICT_LEVELS = {
  GREEN: 'green',
  ORANGE: 'orange',
  RED: 'red'
};

function computeVerdict(flags) {
  const count = flags.filter(f => f.triggered).length;
  let level, label;

  if (count === 0) {
    level = VERDICT_LEVELS.GREEN;
    label = 'Site fiable';
  } else if (count <= 2) {
    level = VERDICT_LEVELS.ORANGE;
    label = 'Quelques points à vérifier';
  } else {
    level = VERDICT_LEVELS.RED;
    label = 'Risque élevé — soyez prudent';
  }

  return { level, label, count };
}

function checkSsl(url) {
  // TODO: return triggered: true if url starts with 'http://'
  return { key: 'ssl', triggered: false };
}

async function checkDomainAge(domain) {
  // TODO: call WHOIS / domain-age API (service worker only — no CORS issue)
  // TODO: return triggered: true if domain is < 6 months old
  return { key: 'domain_age', triggered: false };
}

function checkLegalMentions(doc) {
  // TODO: search anchors for /mentions légales|cgv|politique/i
  return { key: 'legal_mentions', triggered: false };
}
