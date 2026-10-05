# Scola — la messagerie de ta classe

Scola fonctionne comme WhatsApp, mais pour l'école : à l'inscription, chaque élève ou étudiant choisit
**pays + cycle + filière + niveau** et rejoint automatiquement **le groupe unique** de tous ceux qui
partagent ce parcours (ex. tous les « BTS IDA · 1ère année » de Côte d'Ivoire). Une personne n'appartient
qu'à **une seule classe**, définie une fois pour toutes.

## Démarrer

Prérequis : Node.js 20 ou plus.

```bash
npm install          # installe les dépendances du dossier Backend
npm start            # http://localhost:3000
```

(Équivalent : `cd Backend && npm install && npm start`.) Le serveur du dossier `Backend` sert aussi
l'interface du dossier `Frontend` : une seule adresse suffit.

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
  E-mail       : admin@scola.local
  Mot de passe : (généré, affiché ici)
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
| `SCOLA_DATA` | Dossier des données (`Backend/data` par défaut : base `db.json` + fichiers envoyés) |
| `FRONTEND_DIR` | Dossier de l'interface à servir (`Frontend` par défaut) |
| `SCOLA_SECRET` | Clé de signature des sessions (sinon générée dans `data/secret.key`) |
| `SCOLA_ADMIN_EMAIL`, `SCOLA_ADMIN_PASSWORD` | Identifiants du premier administrateur (utilisés seulement s'il n'en existe aucun) |
| `SSL_KEY`, `SSL_CERT` | Chemins du certificat pour servir en HTTPS |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | Serveur TURN pour les appels sur réseaux mobiles/pare-feu |
| `SMS_PROVIDER` | Désactive le mode démo ; branchez votre fournisseur dans `sendSms()` (`Backend/src/auth.js`) |

> **Important (téléphones)** : micro, caméra, appels et notifications exigent **HTTPS** (sauf sur
> `localhost`). Pour tester depuis un téléphone du réseau local, servez Scola en HTTPS (`SSL_KEY`/`SSL_CERT`)
> ou derrière un proxy HTTPS.

## Fonctionnalités

**Compte et connexion** — numéro de téléphone + code SMS, vérification en deux étapes (PIN), connexion
d'autres appareils par code QR (comme WhatsApp Web), liste des appareils connectés et déconnexion à distance,
changement de numéro, export de mes données, suppression du compte.

**Profil** — photo, nom, infos (avec suggestions), établissement, code QR personnel.

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
Backend/
  package.json  dépendances et scripts du serveur
  data/         base db.json, fichiers envoyés, clé secrète (créé au démarrage)
  src/
    index.js      serveur HTTP(S), sert le Frontend, Socket.IO
    auth.js       inscription, code SMS, PIN, connexion par QR
    api.js        API REST des élèves (messages, discussions, classe, statuts, diffusion, profil…)
    admin.js      API de l'espace d'administration (/api/admin)
    tools/reset-admin.js   réinitialisation d'un mot de passe administrateur
    realtime.js   présence, « écrit… », accusés de réception, signalisation WebRTC
    core.js       logique partagée (vues des messages, droits, nettoyage des éphémères)
    catalog.js    référentiel pays / cycles / filières / niveaux
    db.js         stockage JSON persistant
Frontend/
  index.html, css/app.css, sw.js, manifest.webmanifest, icons/
  js/           application des élèves (modules ES, sans étape de build)
  admin/        espace d'administration (index.html, admin.js, admin.css) servi sur /admin
```

## Limites connues et pistes pour la production

- **Stockage** : un fichier JSON en mémoire, adapté à quelques milliers d'utilisateurs. Pour un déploiement
  national, passer à PostgreSQL et à un stockage objet (S3) pour les fichiers.
- **Chiffrement** : les échanges sont protégés en transit (HTTPS) mais ne sont pas chiffrés de bout en bout
  comme sur WhatsApp ; c'est ce qui permet à l'administration de traiter les signalements.
- **SMS** : brancher un fournisseur (Orange SMS API, Twilio…) dans `sendSms()`.
- **Appels** : maillage pair-à-pair limité à 8 participants ; prévoir un serveur TURN, et un SFU
  (mediasoup, LiveKit) pour des appels de classe plus grands.
- **Notifications** : affichées tant que l'application est ouverte ou en arrière-plan ; les notifications
  push application fermée demandent l'ajout de Web Push (clés VAPID).
