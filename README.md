# Scola — la messagerie de ta classe

Scola fonctionne comme WhatsApp, mais pour l'école : à l'inscription, chaque élève ou étudiant choisit
**pays + cycle + filière + niveau** et rejoint automatiquement **le groupe unique** de tous ceux qui
partagent ce parcours (ex. tous les « BTS IDA · 1ère année » de Côte d'Ivoire). Une personne n'appartient
qu'à **une seule classe**, définie une fois pour toutes.

## Démarrer

Prérequis : Node.js 20 ou plus.

```bash
npm install          # installe les dépendances de Application/Backend
npm start            # http://localhost:3000  (élèves)  et  http://localhost:3000/admin  (administration)
```

(Équivalent : `cd Application/Backend && npm install && npm start`.) Un seul serveur, celui de
`Application/Backend`, sert l'interface des élèves (`Application/Frontend`) et charge la partie
administration (`Admin/`) : une seule adresse suffit.

Sans fournisseur SMS configuré, l'application est en **mode démonstration** : le code de connexion à
6 chiffres s'affiche dans la console du serveur et directement à l'écran.

Pour tester à plusieurs sur un seul ordinateur, ouvrez une fenêtre normale et une fenêtre de navigation
privée, et inscrivez deux numéros différents dans la même filière et le même niveau.

## Espace d'administration

L'administration du site est **séparée de l'application des élèves** : <http://localhost:3000/admin>, avec
une connexion par e-mail et mot de passe. Il n'y a pas de délégué : seuls les administrateurs gèrent le site.

**Premier administrateur.** Au premier démarrage sans administrateur, le serveur en crée un et affiche ses
identifiants dans la console :

```
  ===== Administrateur Scola créé =====
  E-mail       : daoudaprosperekone202@gmail.com
  Mot de passe : 12345678
```

Le mot de passe est provisoire : il doit être changé à la première connexion. Pour choisir vous-même les
identifiants initiaux, définissez `SCOLA_ADMIN_EMAIL` et `SCOLA_ADMIN_PASSWORD` avant le premier démarrage.

**Mot de passe perdu.** Arrêtez le serveur, puis : `npm run admin:reset -- votre@email.com` (un nouveau
mot de passe provisoire est affiché ; le compte est créé s'il n'existe pas).

Ce que fait l'administration :

- **Tableau de bord** — utilisateurs, classes, messages, statuts, signalements, inscriptions sur 14 jours.
- **Utilisateurs** — recherche, fiche détaillée, modifier le profil, **changer de classe** (élève inscrit
  par erreur), suspendre / réactiver, réinitialiser le code PIN, déconnecter tous les appareils, supprimer.
- **Classes** — nom, description, icône, **lecture seule** (seule l'administration publie), autoriser ou non
  les membres à modifier les infos / épingler, messages éphémères, lien d'invitation, restreindre un membre,
  modération des derniers messages (suppression pour tous), suppression d'une classe vide.
- **Signalements** — envoyés par les élèves ; supprimer le message, suspendre ou restreindre l'auteur,
  marquer comme traité.
- **Statuts** — voir et supprimer n'importe quel statut en ligne.
- **Annonces** — publier une annonce officielle dans une, plusieurs ou toutes les classes (notifiée aux élèves).
- **Administrateurs** — ajouter, modifier, supprimer d'autres administrateurs (on ne peut pas se supprimer
  soi-même ni supprimer le dernier).
- **Mon compte** — nom, e-mail, mot de passe.

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `PORT` | Port HTTP (3000 par défaut) |
| `SCOLA_DATA` | Dossier des données (`Application/Backend/data` par défaut : base `db.json` + fichiers envoyés) |
| `FRONTEND_DIR` | Interface des élèves à servir (`Application/Frontend` par défaut) |
| `ADMIN_DIR` | Dossier de la partie administration (`Admin` par défaut) |
| `DATABASE_URL` | Base PostgreSQL : données, sessions et fichiers envoyés y sont conservés (voir « Mise en ligne sur Render ») |
| `PG_POOL_MAX` | Nombre maximal de connexions PostgreSQL (4 par défaut) |
| `VAPID_SUBJECT` | Contact des notifications push (`mailto:…` ou URL du site ; `mailto:contact@scola.app` par défaut) |
| `SCOLA_SECRET` | Clé de signature des sessions (sinon générée et conservée dans la base) |
| `SCOLA_ADMIN_EMAIL`, `SCOLA_ADMIN_PASSWORD` | Identifiants du premier administrateur (utilisés seulement s'il n'en existe aucun) |
| `SSL_KEY`, `SSL_CERT` | Chemins du certificat pour servir en HTTPS |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | Serveur TURN pour les appels sur réseaux mobiles/pare-feu |
| `SMS_PROVIDER` | Désactive le mode démo ; branchez votre fournisseur dans `sendSms()` (`Application/Backend/src/auth.js`) |

> **Important (téléphones)** : micro, caméra, appels et notifications exigent **HTTPS** (sauf sur
> `localhost`). Pour tester depuis un téléphone du réseau local, servez Scola en HTTPS (`SSL_KEY`/`SSL_CERT`)
> ou derrière un proxy HTTPS.

### Rester connecté (comme WhatsApp)

Une fois connecté, un utilisateur le reste : la session n'expire pas. Elle ne prend fin que s'il se
déconnecte, si l'appareil est retiré dans *Paramètres › Appareils connectés*, ou si l'administration
suspend le compte. Si le serveur est momentanément injoignable (réseau coupé, serveur qui démarre),
l'application affiche « Connexion à Scola… » et réessaie toute seule, sans redemander de connexion.

Cela suppose que le serveur **conserve ses données** entre deux redémarrages. C'est le cas en local
(fichier `data/db.json`), mais **pas sur Render** ni sur la plupart des hébergeurs gratuits : leur disque
est effacé à chaque redéploiement et à chaque réveil après mise en veille, ce qui effacerait comptes,
sessions et messages. Sur ces hébergeurs, utilisez PostgreSQL (ci-dessous).

### Notifications (même Scola fermé)

Le destinataire d'un message (texte, photo, vidéo, vocal, document, position, sondage…), d'une annonce de
l'administration ou d'un appel manqué reçoit une notification sur ses appareils, **même lorsque Scola est
fermé**. Toucher la notification ouvre Scola **directement sur le message**. Quand Scola est déjà ouvert à
l'écran, une bannière interne remplace la notification (pas de doublon).

- L'utilisateur active les notifications depuis l'invitation en haut de la liste des discussions, ou dans
  *Paramètres › Notifications*. Sourdine, réglages « messages / groupe / aperçu » et blocage sont respectés.
- Une déconnexion, ou un appareil retiré dans *Appareils connectés*, arrête les notifications de cet appareil.
- Il faut **HTTPS** (Render le fournit) ou `localhost`. Sur **iPhone/iPad** (iOS 16.4+), il faut d'abord
  ajouter Scola à l'écran d'accueil (*Partager › Sur l'écran d'accueil*) et l'ouvrir depuis l'icône.
- Les clés de chiffrement des notifications (VAPID) sont générées au premier démarrage et conservées dans
  la base : gardez `DATABASE_URL` sur Render, sinon les abonnements seraient perdus à chaque redémarrage.

### Mise en ligne sur Render

1. Créez une base PostgreSQL gratuite et durable, par exemple sur [Neon](https://neon.tech) (ou Supabase).
   Copiez son adresse de connexion : `postgresql://utilisateur:motdepasse@hote/base?sslmode=require`.
2. Sur Render, créez **un seul** service *Web Service* depuis le dépôt GitHub :
   - *Build Command* : `npm install`
   - *Start Command* : `npm start`
3. Dans *Environment*, ajoutez `DATABASE_URL` avec l'adresse de l'étape 1 (et, si vous le souhaitez,
   `SCOLA_ADMIN_EMAIL` / `SCOLA_ADMIN_PASSWORD` pour le premier administrateur).
4. Déployez. Au démarrage, les journaux doivent afficher
   `Données : PostgreSQL (conservées entre les redémarrages)`.

Les élèves utilisent l'adresse du service (`https://votre-service.onrender.com`), l'administration
`https://votre-service.onrender.com/admin`. Les tables (`scola_kv`, `scola_media`) sont créées
automatiquement ; si une base locale `db.json` existe au premier lancement, elle est importée.

Mot de passe administrateur perdu sur Render : depuis votre ordinateur, définissez la même
`DATABASE_URL` puis lancez `npm run admin:reset -- votre@email.com`, et redémarrez le service.

## Fonctionnalités

**Compte et connexion** — numéro de téléphone + code SMS, vérification en deux étapes (PIN), connexion
d'autres appareils par code QR (comme WhatsApp Web), liste des appareils connectés et déconnexion à distance,
changement de numéro, export de mes données, suppression du compte.

**Profil** — photo (importée ou prise, puis **recadrée en cercle** : glisser, zoomer), nom, infos (avec
suggestions), établissement, code QR personnel.

**Discussions** — groupe de classe + discussions privées entre camarades + « message à moi-même »,
listes de diffusion, épingler (3 max), archiver, sourdine (8 h / 1 semaine / toujours), marquer comme
non lu, favoris, filtres (non lues, favoris, groupe, diffusions), brouillons, recherche globale (discussions,
camarades, messages), effacer, supprimer, exporter en .txt, fond d'écran par discussion.

**Messages** — texte avec mise en forme (`*gras*`, `_italique_`, `~barré~`, code, citations, listes),
emojis (sélecteur avec recherche et récents), gros emojis, aperçu des liens, mentions `@`, réponses,
transfert (« Transféré » / « Transféré plusieurs fois », 5 discussions max), modification (15 min),
suppression pour moi / pour tous, réactions, messages importants, épinglage (24 h / 7 j / 30 j),
sélection multiple, infos du message (lu par / distribué à), coches ✓ ✓✓ bleues, « écrit… » et
« enregistre un vocal… », en ligne / vu à, messages éphémères (24 h / 7 j / 90 j), glisser pour répondre,
appui long sur mobile, glisser-déposer et coller des fichiers.

**Pièces jointes** — photos et vidéos (avec légende, HD, **vue unique**), appareil photo, documents
(PDF, Word…, 100 Mo max), audio, **messages vocaux** (pause, onde, vitesse 1× / 1,5× / 2×), contact,
position actuelle ou **en direct**, **sondages** (choix unique ou multiple, détail des votes) et
**évènements** (cours, devoir, examen, réunion… avec réponses Présent / Peut-être / Absent et ajout à l'agenda).

**Statuts** — texte (couleurs, polices), photo, vidéo ; 24 h ; vues et réactions ; réponses en privé ;
masquer les statuts d'un camarade ; confidentialité (toute la classe / sauf… / uniquement…) ; page
**« Mes statuts »** pour revoir et supprimer chacun de ses statuts à tout moment.

**Appels** — vocaux et vidéo, individuels et **de groupe** (jusqu'à 8 personnes, rejoindre un appel en
cours), couper le micro, caméra, retourner la caméra, **partage d'écran**, réduire l'appel, journal d'appels
(manqués, entrants, sortants, durée), sonnerie.

**Ma classe** (équivalent éducatif de l'onglet Communautés) — agenda des évènements, sondages récents,
cours et documents partagés, annuaire de la classe.

**Groupe de classe** — tous les membres sont égaux ; les réglages et la modération relèvent de
l'administration du site. Lien d'invitation (QR, partage), signalement à l'administration, annonces
officielles signées « Administration Scola ». Les membres ne peuvent ni être ajoutés depuis une autre
classe ni quitter la leur.

**Confidentialité et sécurité** — vu à / photo / infos / numéro visibles par la classe ou personne,
confirmations de lecture, contacts bloqués, signalement.

**Réglages** — thème clair/sombre/système, fonds d'écran, taille du texte, Entrée pour envoyer,
notifications (navigateur, sons, aperçu), application installable (PWA).

## Architecture

```
Application/                 l'application des élèves
  Backend/
    package.json             dépendances et scripts du serveur
    data/                    base db.json, fichiers envoyés, clé secrète (créé au démarrage)
    src/
      index.js               serveur HTTP(S), Socket.IO ; sert Application/Frontend et charge Admin/
      auth.js                inscription, code SMS, PIN, connexion par QR
      api.js                 API REST des élèves (messages, discussions, classe, statuts, diffusion, profil…)
      realtime.js            présence, « écrit… », accusés de réception, signalisation WebRTC
      core.js                logique partagée (vues des messages, droits, nettoyage des éphémères)
      catalog.js             référentiel pays / cycles / filières / niveaux
      db.js                  stockage JSON persistant
  Frontend/
    index.html, css/app.css, sw.js, manifest.webmanifest, icons/
    js/                      application des élèves (modules ES, sans étape de build)
Admin/                       tout ce qui concerne l'administration
  Backend/
    admin.js                 API de l'espace d'administration (/api/admin)
    reset-admin.js           réinitialisation d'un mot de passe administrateur
  Frontend/
    index.html, admin.js, admin.css   interface d'administration, servie sur /admin
```

La partie `Admin` n'a pas de dépendances propres : son API utilise celles d'`Application/Backend`
(Express, base de données, logique métier), et son interface réutilise la feuille de style et les
composants d'`Application/Frontend` (`/css/app.css`, `/js/util.js`, `/js/ui.js`).

## Limites connues et pistes pour la production

- **Stockage** : les données sont gardées en mémoire et sauvegardées dans `db.json` ou dans PostgreSQL
  (une ligne par collection et par discussion), ce qui convient à quelques milliers d'utilisateurs. Pour
  un déploiement national, passer à un vrai schéma relationnel, et à un stockage objet (S3) pour les
  fichiers plutôt qu'à la table `scola_media`.
- **Chiffrement** : les échanges sont protégés en transit (HTTPS) mais ne sont pas chiffrés de bout en bout
  comme sur WhatsApp ; c'est ce qui permet à l'administration de traiter les signalements.
- **SMS** : brancher un fournisseur (Orange SMS API, Twilio…) dans `sendSms()`.
- **Appels** : maillage pair-à-pair limité à 8 participants ; prévoir un serveur TURN, et un SFU
  (mediasoup, LiveKit) pour des appels de classe plus grands.
- **Notifications** : envoyées en Web Push. Les appels entrants ne sonnent que si Scola est ouvert ; un
  appel non décroché donne une notification « Appel manqué ».
