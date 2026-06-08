# Politique de confidentialité — PreShot

_Dernière mise à jour : 8 juin 2026_

## 1. Introduction

**PreShot** est une extension de navigateur (Chrome) qui vous aide à
repérer les sites potentiellement frauduleux au moment du paiement. Lorsqu'elle
détecte une page de paiement, elle affiche un diagnostic de fiabilité fondé sur
quelques signaux simples (connexion sécurisée, mentions légales, ancienneté du
domaine). PreShot **crée le doute, sans jamais bloquer** votre navigation.

Votre vie privée est au cœur de la conception de PreShot. Cette politique
explique, en toute transparence, quelles données sont traitées et comment.

## 2. Données collectées

**PreShot ne collecte aucune donnée personnelle.** Aucun nom, e-mail, identité,
moyen de paiement ni historique de navigation n'est collecté.

- La seule donnée traitée est l'**adresse (URL)** de la page sur laquelle vous
  vous trouvez, et **uniquement son nom de domaine** (_hostname_, par exemple
  `exemple-boutique.fr`).
- Le **chemin** de la page, les **paramètres** d'URL et le **contenu** de vos
  formulaires (carte bancaire, identifiants, etc.) **ne sont jamais lus,
  enregistrés ni transmis**.
- L'essentiel du traitement a lieu **localement, dans votre navigateur**.

## 3. Services externes consultés

Pour évaluer l'**ancienneté d'un domaine**, PreShot interroge un service public
de données d'enregistrement de noms de domaine :

- **RDAP** (_Registration Data Access Protocol_, le standard moderne qui remplace
  le WHOIS), via le point d'entrée public `https://rdap.org`.
- **Seul le nom de domaine** (_hostname_) est envoyé à ce service, afin de
  récupérer sa date de création. **Aucune donnée personnelle** n'accompagne cette
  requête.
- Cette requête est effectuée par le composant interne de l'extension (_service
  worker_), jamais directement depuis la page que vous consultez.

> ℹ️ PreShot **n'utilise pas** de service WHOIS payant ni de clé d'API : l'appel
> RDAP est anonyme et gratuit.

## 4. Stockage local

Pour éviter de recalculer le diagnostic à chaque visite, PreShot met en cache ses
analyses via l'API **`chrome.storage.local`** de votre navigateur :

- **Durée de conservation : 24 heures** (au-delà, l'entrée expire et est ignorée).
- **Données stockées** : le nom de domaine, les signaux détectés (_red flags_),
  le verdict et un horodatage (_timestamp_).
- Ces données **restent sur votre appareil** et **ne sont jamais transmises** à
  qui que ce soit.

Vous pouvez les effacer à tout moment en supprimant les données de l'extension
depuis les réglages de votre navigateur.

## 5. Permissions demandées

PreShot demande le strict minimum nécessaire à son fonctionnement :

- **`activeTab`** : accéder à l'onglet actif pour analyser le site en cours.
- **`storage`** : mettre en cache les analyses localement (voir section 4).
- **`sidePanel`** : afficher le diagnostic détaillé dans le panneau latéral.
- **`host_permissions` limité à `https://rdap.org/*`** : interroger uniquement le
  service RDAP pour l'ancienneté du domaine. PreShot **ne dispose d'aucun accès
  réseau privilégié vers les autres sites**.

Par ailleurs, le script de détection s'exécute sur les pages que vous visitez
(`<all_urls>`) afin de repérer une page de paiement. Il **lit la structure de la
page localement** (présence de champs de paiement, de mentions légales…) sans
jamais en exporter le contenu.

## 6. Absence de pistage

- **Aucun outil d'analyse d'audience** (analytics), **aucun cookie tiers**,
  **aucun identifiant utilisateur**.
- **Aucun profilage** et **aucun partage de données avec des tiers**, à des fins
  commerciales ou publicitaires.

PreShot n'a aucun intérêt à vous suivre : son seul rôle est de vous alerter au
bon moment.

## 7. Contact

Pour toute question relative à cette politique ou à vos données :

- **E-mail :** `__ADRESSE_EMAIL_CONTACT__` _(placeholder — à remplacer par l'adresse de contact réelle)_

## 8. Modifications

Cette politique de confidentialité peut être mise à jour, notamment pour refléter
des évolutions de l'extension ou de la réglementation. La date de **dernière mise
à jour** indiquée en haut de ce document fait foi. En cas de changement notable,
la nouvelle version sera publiée à cet emplacement.
