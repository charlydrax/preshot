# Périmètre technique — MVP PreShot

> Ce document définit le **périmètre technique** du MVP (Minimum Viable Product) de
> l'extension navigateur **PreShot**. Il fixe ce qui est dans le périmètre, ce qui
> en est exclu, l'architecture, les contraintes et les critères de succès.
> Version : 1.0.0 — Dernière mise à jour : 17/06/2026

---

## 1. Objectif & contexte

### Problème adressé
Au moment de payer sur un site e-commerce inconnu, l'utilisateur n'a aucun moyen
simple de savoir s'il a affaire à une arnaque. Les signaux de fraude (domaine
récent, absence de mentions légales, connexion non chiffrée) ne sont ni visibles
ni interprétables par un non-expert.

### Proposition de valeur du MVP
PreShot déclenche, **au moment du paiement**, une alerte non bloquante et affiche
un **diagnostic de fiabilité** du site en moins de 5 secondes, afin de **créer le
doute** plutôt que d'imposer un obstacle.

### Objectif du MVP
Valider l'hypothèse principale : *un signal contextuel discret au checkout
suffit-il à faire douter (et donc à protéger) l'utilisateur face à un site à
risque, sans générer de faux positifs destructeurs de confiance ?*

---

## 2. Périmètre fonctionnel

### 2.1 Dans le périmètre (MUST — livré dans le MVP)

| # | Fonctionnalité | Description |
|---|----------------|-------------|
| F1 | **Détection du checkout** | Activation par signaux combinés (≥ 2 signaux : mots-clés URL, champs sensibles CB/IBAN/CVV, logos de paiement) |
| F2 | **Scoring local des red flags** | Calcul des red flags côté content script + service worker |
| F3 | **Vérification d'ancienneté du domaine** | Lookup RDAP (`rdap.org`) via le service worker |
| F4 | **Vérification mentions légales / CGV** | Présence des pages légales obligatoires |
| F5 | **Vérification HTTPS** | Détection de l'absence de chiffrement |
| F6 | **Notification latérale non bloquante** | 3 niveaux visuels : 🟢 vert / 🟠 orange / 🔴 rouge |
| F7 | **Badge numérique** | Nombre de red flags sur l'icône de l'extension |
| F8 | **Side Panel de diagnostic** | Verdict global lisible en < 5 s + détail des red flags |
| F9 | **Popup d'état** | État courant + accès au diagnostic |
| F10 | **Whitelist e-commerce** | Top sites de confiance (Amazon, Fnac, Cdiscount…) toujours en vert |
| F11 | **Authentification Google (OAuth2)** | Login + avatar dans le panel (`identity`) |

### 2.2 Hors périmètre (NOT — exclu du MVP)

- ❌ Blocage effectif du paiement ou de la navigation (principe produit : ne jamais bloquer)
- ❌ Support multi-navigateur (Firefox, Edge, Safari) — **Chrome uniquement**
- ❌ Backend propriétaire / base de données serveur (pas de stockage centralisé)
- ❌ Machine learning / scoring par IA
- ❌ Analyse du contenu des avis, réputation réseaux sociaux, signalement communautaire
- ❌ Vérification WHOIS payante / API tierces commerciales
- ❌ Internationalisation (FR uniquement)
- ❌ Application mobile

---

## 3. Stack & architecture technique

### 3.1 Stack

- **Manifest V3** (extension Chrome)
- **JavaScript vanilla** — pas de framework (React/Vue), pas de bundler (Webpack/Vite)
- **CSS pur** injecté dans la page
- **Pas de TypeScript** (sans validation explicite)

### 3.2 Composants

| Composant | Rôle |
|-----------|------|
| **Content Script** (`content/`) | Détecte le checkout, score localement, injecte la notification |
| **Service Worker** (`background/`) | Badge, cache, lookups réseau (RDAP / Google), verdict |
| **Side Panel** (`panel/`) | Affiche le diagnostic complet |
| **Popup** (`popup/`) | État courant + accès au diagnostic |
| **Utils** (`utils/`) | `scoring.js` (red flags + verdict), `whitelist.js` (domaines de confiance) |

### 3.3 Flux de données

```
Page web ──(détection checkout)──> Content Script
   │  CHECKOUT_DETECTED
   ▼
Service Worker ──(RDAP lookup)──> rdap.org
   │  calcul verdict + badge
   │  ANALYSIS_COMPLETE
   ▼
Side Panel / Popup  ◄── GET_STATUS
```

**Messages inter-composants** (`UPPER_SNAKE_CASE`) :
`CHECKOUT_DETECTED`, `ANALYSIS_COMPLETE`, `GET_STATUS`.

### 3.4 Permissions & accès réseau

- **`permissions`** : `activeTab`, `storage`, `sidePanel`, `identity`
- **`host_permissions`** : `https://rdap.org/*`, `https://www.googleapis.com/*`, `https://accounts.google.com/*`
- **Règle CORS** : aucune requête réseau depuis le content script — tout passe par le service worker.
- Le `<all_urls>` du manifest concerne **uniquement** `content_scripts.matches` (détection sur toutes les pages), pas les `host_permissions`.

---

## 4. Exigences non fonctionnelles

| Domaine | Exigence |
|---------|----------|
| **Performance** | Verdict affiché en **< 5 s** dans le panneau ; détection sans ralentissement perceptible de la page |
| **Robustesse** | Gestion explicite des erreurs : timeout, offline, réponses 4xx/5xx du RDAP |
| **Fiabilité** | Préférer rater une arnaque qu'alerter à tort ; whitelist prioritaire pour éviter les faux positifs |
| **Sécurité / vie privée** | Pas de stockage centralisé de l'historique de navigation ; OAuth limité à `openid email profile` |
| **Isolation CSS** | Tous les éléments DOM injectés préfixés `preshot-` pour éviter les conflits |
| **UX** | Jamais bloquant : on crée le doute, pas l'obstacle |

---

## 5. Conventions de code

- **Fichiers** : `snake_case.js`
- **Variables / fonctions** : `camelCase`
- **Messages** : `{ type: 'UPPER_SNAKE_CASE', ... }`
- **DOM injecté** : préfixe `preshot-`

---

## 6. Critères d'acceptation (tests manuels avant livraison)

| Site | Comportement attendu |
|------|----------------------|
| Amazon (checkout) | Détection ✓, verdict **VERT** (whitelist) |
| Fnac (checkout) | Détection ✓, verdict **VERT** |
| Site HTTP au checkout | Flag SSL levé, verdict **ROUGE** |
| Google.com | **Aucune** détection |

**Critères de succès du MVP :**
- Détection fiable du checkout sur les sites e-commerce courants (≥ 2 signaux)
- Zéro faux positif sur la whitelist
- Verdict lisible en < 5 s
- Aucune action bloquante pour l'utilisateur

---

## 7. Risques & limites connues

| Risque                             | Impact                 | Mitigation                                     |
|------------------------------------|------------------------|------------------------------------------------|
| Faux positif sur site légitime     | Perte de confiance     | Whitelist e-commerce + seuils prudents         |
| RDAP indisponible / lent           | Diagnostic incomplet   | Timeout + dégradation, cache côté SW           |
| Site checkout non détecté          | Pas d'alerte           | Détection par signaux combinés (3 familles)    |
| Dépendance à un seul navigateur    | Couverture limitée     | Assumé pour le MVP (Chrome only)               |
| Évolution Manifest V3 / API Chrome | Maintenance            | Stack standard, pas de dépendance exotique     |

