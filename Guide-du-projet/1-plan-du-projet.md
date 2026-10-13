# 1. Plan du projet : chaque dossier, chaque fichier

## À la racine du projet

| Élément | Rôle |
|---|---|
| `Application/` | l'application des **élèves et étudiants** (son site et le serveur de tout Scola) |
| `Admin/` | l'**administration** du site (`/admin`) |
| `Etablissement/` | l'**espace des écoles et universités** (`/etablissement`) |
| `Guide-du-projet/` | ce guide |
| `Presentation/` | affiches, vidéos et textes pour présenter Scola au public |
| `scripts/vercel-build.js` | prépare le site au moment de la mise en ligne sur **Vercel** |
| `package.json` | commandes de démarrage du projet (utilisées par Render et Vercel) |
| `vercel.json` | réglages de Vercel (quelles adresses vont vers le serveur Render) |
| `README.md` | documentation technique complète (installation, variables, fonctionnalités) |

---

## `Application/Backend/` — le serveur de Scola (tourne sur Render)

| Fichier | Ce qu'il fait |
|---|---|
| `package.json` | liste des bibliothèques du serveur et commande de démarrage |
| `src/index.js` | **démarrage** du serveur : charge la base de données, puis lance tout le reste |
| `src/serveur-web-et-adresses.js` | relie chaque adresse (`/api/...`, `/admin`, `/etablissement`, fichiers) au bon module |
| `src/base-de-donnees.js` | enregistrement des données : fichier local ou **PostgreSQL** (Render) |
| `src/donnees-classes-et-discussions.js` | cœur de Scola : classes, discussions, messages, profils visibles, suppressions |
| `src/connexion-inscription-sms.js` | connexion par mot de passe, inscription, **SMS (textbee)**, mot de passe oublié, blocage après erreurs |
| `src/api-messagerie-eleves.js` | tout ce que fait un élève : envoyer/modifier/supprimer un message, profil, confidentialité, discussions |
| `src/temps-reel-messages-et-appels.js` | le **direct** : « en ligne », « écrit… », accusés de lecture, **appels audio et vidéo** |
| `src/notifications-push.js` | notifications sur le téléphone même quand Scola est fermé |
| `src/envoi-emails.js` | envoi des e-mails (codes des établissements, alertes) |
| `src/listes-pays-filieres-niveaux.js` | listes **pays, cycles, filières/séries, niveaux** (modifiables dans l'administration) |
| `src/annonces-et-avertissements.js` | **annonces** de l'administration et avertissements reçus par les élèves |
| `src/groupes-chefs-de-classe-et-contacts.js` | groupes créés par les **chefs de classe**, discussions avec les **contacts** du téléphone |
| `src/support-messages-a-l-equipe.js` | **« Écrire à l'équipe Scola »** (élèves et établissements) |
| `src/orientation-chaines-ecoles.js` | onglet **Orientation** : chaînes des écoles, abonnements, questions aux écoles |
| `src/formules-et-tarifs.js` | **formules** des établissements (Starter, Pro…), prix, droits et quotas |
| `src/abonnements-et-paiements.js` | **abonnements, paiements, reçus**, offre Fondateur, rappels d'échéance |
| `src/campagnes-publicitaires.js` | **campagnes** des écoles : ciblage, validation, diffusion |
| `src/statistiques-audience-etablissements.js` | compteurs de vues et de clics des écoles (sans données personnelles) |
| `src/rapports-et-chiffre-affaires.js` | rapports mensuels des écoles et **chiffre d'affaires** de l'administration |
| `scripts/donnees-de-demonstration.js` | crée de fausses données pour essayer (jamais lancé automatiquement) |

## `Application/Frontend/` — le site des élèves (publié sur Vercel)

| Fichier | Ce qu'il fait |
|---|---|
| `index.html` | la page unique qui charge l'application |
| `config.js` | adresse du serveur Render (régénéré automatiquement par Vercel) |
| `sw.js` | **fonctionnement hors connexion** et réception des notifications |
| `manifest.webmanifest` | nom, icône et couleurs quand on « installe » Scola sur le téléphone |
| `css/style-application.css` | **apparence** de toute l'application (couleurs, mode sombre, boutons…) |
| `css/style-tableaux-de-bord.css` | apparence des tableaux de bord (administration et établissements) |
| `icons/` | icônes et logo de l'application |
| `stickers/` | autocollants fournis avec Scola |

### `Application/Frontend/js/` — les écrans des élèves

| Fichier | Ce qu'il fait |
|---|---|
| `demarrage-application.js` | **démarrage** de l'application, connexion au direct, bandeau « hors connexion » |
| `ecrans-connexion-inscription.js` | écrans **Élève / Établissement**, connexion, inscription, choix de la classe |
| `liste-des-discussions.js` | onglet **Discussions** : liste, recherche, nouvelle discussion, groupes, contacts |
| `conversation-ouverte.js` | une **conversation** : écrire, joindre, vocaux, réactions, appui long |
| `affichage-des-messages.js` | dessin d'un message (bulle, heure, coches, réponses, liens) |
| `photos-videos-fichiers.js` | photos, vidéos, documents, appareil photo, lecture des vocaux |
| `emojis.js` | sélecteur d'emojis |
| `autocollants.js` | stickers (pack Scola, stickers personnels, favoris) |
| `appels-audio-video.js` | **appels** et onglet Appels |
| `onglet-ma-classe.js` | onglet **Ma classe** |
| `fiches-contact-et-groupe.js` | fiches d'informations : contact, groupe, médias partagés |
| `onglet-orientation.js` | onglet **Orientation** : écoles suivies, publications, questions |
| `orientation-a-la-une-et-ville.js` | « À la une », page officielle d'une école, choix de la ville |
| `publicites.js` | publicités des écoles (onglet Orientation uniquement) |
| `onglet-parametres.js` | onglet **Paramètres** : compte, mot de passe, confidentialité, thème, Aide |
| `ecrire-a-l-equipe-scola.js` | **Paramètres › Aide › Écrire à l'équipe Scola** |
| `boite-des-annonces.js` | bouton **Annonces** (à côté du crayon) |
| `messages-hors-connexion.js` | messages écrits **sans réseau**, envoyés au retour de la connexion |
| `notifications-push.js` | activation des notifications sur l'appareil |
| `appels-au-serveur.js` | toutes les demandes envoyées au serveur |
| `memoire-de-l-application.js` | ce que l'application garde en mémoire (moi, discussions, membres…) |
| `navigation-entre-ecrans.js` | passage d'un écran à l'autre |
| `fenetres-et-menus.js` | fenêtres, menus, petits messages en bas d'écran, sons |
| `outils-communs.js` | petits outils partagés : icônes, dates, mise en forme du texte |
| `graphiques.js` | graphiques (courbes, barres) des tableaux de bord |

---

## `Admin/` — l'administration (`/admin`)

| Fichier | Ce qu'il fait |
|---|---|
| `Backend/api-administration.js` | serveur de l'administration : utilisateurs, classes, signalements, établissements, groupes, annonces, support, filières, **droits des administrateurs**, nettoyage |
| `Backend/api-abonnements-campagnes-offres.js` | serveur des **abonnements, paiements, campagnes, offres et tarifs** |
| `Backend/reinitialiser-administrateur.js` | outil de secours : nouveau mot de passe administrateur (`npm run admin:reset`) |
| `Frontend/index.html` | page de l'administration |
| `Frontend/administration.js` | **toutes les pages** de l'administration (tableau de bord, utilisateurs, classes, signalements, établissements, groupes, annonces, administrateurs, mon compte) |
| `Frontend/abonnements-et-offres.js` | pages **Abonnements** et **Offres et tarifs**, reçus |
| `Frontend/campagnes-publicitaires.js` | page **Campagnes** |
| `Frontend/support-messages.js` | page **Support** |
| `Frontend/filieres-et-niveaux.js` | page **Filières et niveaux** |
| `Frontend/nettoyage-donnees-test.js` | page **Nettoyage** (propriétaire) |
| `Frontend/style-administration.css` | apparence de l'administration |

## `Etablissement/` — l'espace des écoles (`/etablissement`)

| Fichier | Ce qu'il fait |
|---|---|
| `Backend/api-espace-etablissement.js` | serveur de l'espace écoles : demande de compte, activation, connexion, mot de passe oublié, publications, messages des élèves, formule, campagnes, statistiques, support |
| `Frontend/index.html` | page de l'espace établissement |
| `Frontend/espace-etablissement.js` | **pages principales** : demande, connexion, publications, messages des élèves, ma chaîne, mon compte |
| `Frontend/tableau-de-bord-statistiques.js` | **tableau de bord** de l'école |
| `Frontend/ma-formule-et-paiements.js` | **Ma formule** : offre, liens de paiement, envoi du reçu |
| `Frontend/mes-campagnes.js` | **Campagnes** de l'école |
| `Frontend/rapports-mensuels.js` | **Rapports** imprimables |
| `Frontend/contacter-scola.js` | **Contacter Scola** (support) |
| `Frontend/style-espace-etablissement.css` | apparence de l'espace établissement |
