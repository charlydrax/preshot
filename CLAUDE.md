# CLAUDE.md

> Guide de contexte pour Claude Code sur le projet **PreShot**.

## 🎯 Projet

**PreShot** est une extension navigateur (Chrome) qui déclenche une alerte au doute au moment du paiement et affiche un diagnostic de fiabilité du site pour détecter une arnaque en ligne.

## 🧰 Stack

- **Manifest V3**
- **JavaScript vanilla** — pas de framework, pas de build
- **CSS pur** injecté dans la page

## 📁 Architecture

```
preshot/
├── manifest.json           # Manifest V3
├── background/
│   └── service_worker.js   # Badge, cache, WHOIS/RDAP, verdict
├── content/
│   ├── detector.js         # Trigger : détection checkout + scoring local
│   └── banner.js           # Notification latérale
├── panel/
│   ├── panel.html          # Diagnostic
│   ├── panel.css
│   └── panel.js
├── popup/
│   ├── popup.html          # État courant + accès au diagnostic
│   └── popup.js
├── utils/
│   ├── scoring.js          # Calcul des red flags + verdict
│   └── whitelist.js        # Domaines de confiance + domaine enregistrable
└── icons/                  # Vert / orange / rouge (16/32/48/128)
```

| Composant | Rôle |
|-----------|------|
| **Content Script** | Détecte le checkout, injecte la notification |
| **Service Worker** | Gère le badge, le cache, les vérifications |
| **Side Panel** | Affiche le diagnostic complet |

## 🎯 Logique du Trigger

Détection par **signaux combinés**. Activation dès que **2 signaux** sont présents :
1. Mots-clés URL : `/checkout`, `/panier`, `/order`, `/payment`, `/cart`
2. Champs sensibles : carte bancaire, IBAN, CVV
3. Logos de paiement : Stripe, PayPal, Visa, Mastercard

## 🚨 Logique de la Notif

3 niveaux visuels, jamais bloquants :
- 🟢 **Vert** : aucun red flag
- 🟠 **Orange** : 1-2 red flags
- 🔴 **Rouge** : 3+ red flags

Badge numérique sur l'icône = nombre de red flags détectés.

## 🔍 Red Flags Vérifiés

- Ancienneté du domaine (plus ancien = plus safe) — via RDAP (`rdap.org`)
- Présence des mentions légales / CGV
- Connexion HTTPS (présence du chiffrement)

Verdict global : **Site fiable** / **Quelques points à vérifier** / **Risque élevé**

> Accès réseau : `host_permissions` limité à `https://rdap.org/*` (lookup
> d'ancienneté du domaine côté Service Worker). Pas de `<all_urls>` en
> host_permissions ; le `<all_urls>` du manifest concerne uniquement
> `content_scripts.matches` (détection sur toutes les pages).

## 🔑 Conventions

- **Fichiers** : `snake_case.js`
- **Variables / fonctions** : `camelCase`
- **Préfixe DOM injecté** : tous les éléments injectés dans la page commencent par `preshot-` (ex: `#preshot-banner`) pour éviter les conflits CSS
- **Messages inter-composants** : `{ type: 'UPPER_SNAKE_CASE', ... }`

Types de messages :
- `CHECKOUT_DETECTED` — Content Script → Service Worker
- `ANALYSIS_COMPLETE` — Service Worker → Side Panel
- `GET_STATUS` — Popup → Service Worker

## 🚨 Règles Importantes

### Principe produit
- **Ne jamais bloquer l'utilisateur**. On crée le doute, pas l'obstacle.
- **Verdict lisible en < 5 secondes** dans le panneau.

### Code
- ❌ Pas de framework (React/Vue) — vanilla JS uniquement
- ❌ Pas de bundler (Webpack/Vite) — chargement direct
- ❌ Pas de TypeScript sans validation explicite
- ❌ Pas de requêtes réseau depuis le content script (CORS) — toujours via le Service Worker
- ✅ Préfixer tous les éléments DOM injectés avec `preshot-`
- ✅ Gérer les cas d'erreur (timeout, offline, 4xx/5xx)

### Faux positifs
- Un site légitime mal flaggué détruit la confiance
- Whitelist du top sites e-commerce (Amazon, Fnac, Cdiscount...) en priorité
- Préférer rater une arnaque qu'alerter à tort

## 🧪 Tests Manuels Avant Commit

| Site | Comportement attendu |
|------|----------------------|
| Amazon (checkout) | Détection ✓, verdict VERT (whitelist) |
| Fnac (checkout) | Détection ✓, verdict VERT |
| Site HTTP au checkout | Flag SSL levé, verdict ROUGE |
| Google.com | Aucune détection |

## 🐞 Débogage

| Console | Accès |
|---------|-------|
| Service Worker | `chrome://extensions` → PreShot → « Inspect views » |
| Content Script | F12 sur la page → Console |
| Side Panel | Clic droit dans le panel → Inspecter |