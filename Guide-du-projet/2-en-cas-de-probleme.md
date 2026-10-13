# 2. En cas de problème : quel fichier ouvrir ?

Trouvez le symptôme, puis ouvrez le fichier indiqué. « Serveur » = `Application/Backend/src/`,
« Élèves » = `Application/Frontend/js/`.

## D'abord : le site entier ne répond plus

| Symptôme | Où regarder |
|---|---|
| Plus rien ne charge, « Connexion au serveur impossible » | **Render** › service *scola-admin* › onglet **Logs**. Le serveur démarre avec `src/index.js` |
| Erreur « Impossible de charger les données Scola » dans les journaux Render | variable **DATABASE_URL** sur Render ; fichier Serveur `base-de-donnees.js` |
| Le site Vercel affiche une ancienne version | Vercel › **Deployments** › *Redeploy* ; fichier `scripts/vercel-build.js` |
| `/admin` ou `/etablissement` affiche la page des élèves | `vercel.json` et `scripts/vercel-build.js` |
| Après une mise à jour, un téléphone garde l'ancienne version | Élèves `../sw.js` (augmenter `VERSION`), puis fermer et rouvrir Scola |

## Connexion et comptes

| Symptôme | Fichier |
|---|---|
| Impossible de se connecter, mot de passe refusé, compte bloqué 15 min | Serveur `connexion-inscription-sms.js` |
| Les **SMS** n'arrivent pas | Serveur `connexion-inscription-sms.js` (fonction `sendSms`) + téléphone Android **textbee** + variables `SMS_PROVIDER`, `TEXTBEE_API_KEY` |
| Écran d'accueil Élève / Établissement, formulaire d'inscription | Élèves `ecrans-connexion-inscription.js` |
| Un élève est déconnecté tout seul | Élèves `demarrage-application.js` ; Serveur `connexion-inscription-sms.js` |
| Mot de passe administrateur perdu | `Admin/Backend/reinitialiser-administrateur.js` (`npm run admin:reset -- email`) |

## Messages et discussions

| Symptôme | Fichier |
|---|---|
| Un message ne part pas, ne se modifie ou ne se supprime pas | Serveur `api-messagerie-eleves.js` ; Élèves `conversation-ouverte.js` |
| Un message s'affiche mal (bulle, heure, coches, liens) | Élèves `affichage-des-messages.js` |
| « En ligne », « écrit… », coches bleues ne se mettent pas à jour | Serveur `temps-reel-messages-et-appels.js` |
| Liste des discussions, recherche, nouvelle discussion | Élèves `liste-des-discussions.js` |
| Messages écrits sans réseau qui ne partent pas | Élèves `messages-hors-connexion.js` |
| Appui long : le menu disparaît | Élèves `fenetres-et-menus.js` |
| Photos, vidéos, vocaux, documents | Élèves `photos-videos-fichiers.js` |
| Emojis / stickers | Élèves `emojis.js` / `autocollants.js` |
| Appels audio ou vidéo | Élèves `appels-audio-video.js` ; Serveur `temps-reel-messages-et-appels.js` |
| Notifications qui n'arrivent pas | Serveur `notifications-push.js` ; Élèves `notifications-push.js` et `../sw.js` |

## Classes, groupes, contacts

| Symptôme | Fichier |
|---|---|
| Une filière, une série ou un niveau manque à l'inscription | **Administration › Filières et niveaux** (aucun code à toucher) ; sinon Serveur `listes-pays-filieres-niveaux.js` |
| Un élève est dans la mauvaise classe | Administration › Utilisateurs › fiche de l'élève |
| Onglet Ma classe | Élèves `onglet-ma-classe.js` |
| Groupes des chefs de classe, contacts du téléphone | Serveur `groupes-chefs-de-classe-et-contacts.js` ; Élèves `liste-des-discussions.js` |
| Fiche d'un contact ou d'un groupe | Élèves `fiches-contact-et-groupe.js` |

## Annonces, support, paramètres

| Symptôme | Fichier |
|---|---|
| Annonces de l'administration, avertissements | Serveur `annonces-et-avertissements.js` ; Élèves `boite-des-annonces.js` |
| « Écrire à l'équipe Scola » | Serveur `support-messages-a-l-equipe.js` ; Élèves `ecrire-a-l-equipe-scola.js` ; Admin `Frontend/support-messages.js` ; Écoles `Frontend/contacter-scola.js` |
| Onglet Paramètres (compte, confidentialité, thème, aide) | Élèves `onglet-parametres.js` |
| Couleurs, mode sombre, listes déroulantes illisibles | `Application/Frontend/css/style-application.css` |

## Orientation et établissements

| Symptôme | Fichier |
|---|---|
| Onglet Orientation, abonnement à une école, questions aux écoles | Serveur `orientation-chaines-ecoles.js` ; Élèves `onglet-orientation.js` |
| « À la une », page officielle d'une école | Élèves `orientation-a-la-une-et-ville.js` |
| Publicités affichées aux élèves | Élèves `publicites.js` ; Serveur `campagnes-publicitaires.js` |
| Une école ne peut pas se connecter / mot de passe oublié | `Etablissement/Backend/api-espace-etablissement.js` |
| Pages de l'espace école (publications, messages, chaîne, compte) | `Etablissement/Frontend/espace-etablissement.js` |
| Tableau de bord ou rapports d'une école | `Etablissement/Frontend/tableau-de-bord-statistiques.js`, `rapports-mensuels.js` ; Serveur `statistiques-audience-etablissements.js`, `rapports-et-chiffre-affaires.js` |

## Argent : formules, paiements, campagnes

| Symptôme | Fichier |
|---|---|
| Prix, contenu des formules, liens de paiement | Administration › **Offres et tarifs** ; Serveur `formules-et-tarifs.js` |
| Paiement, reçu, abonnement, offre Fondateur, rappels | Serveur `abonnements-et-paiements.js` ; Admin `Frontend/abonnements-et-offres.js` ; Écoles `Frontend/ma-formule-et-paiements.js` |
| Campagnes (création, validation, diffusion) | Serveur `campagnes-publicitaires.js` ; Admin `Frontend/campagnes-publicitaires.js` ; Écoles `Frontend/mes-campagnes.js` |
| Chiffre d'affaires du tableau de bord | Serveur `rapports-et-chiffre-affaires.js` |

## Administration

| Symptôme | Fichier |
|---|---|
| Une page de l'administration (tableau de bord, utilisateurs, classes, signalements…) | `Admin/Frontend/administration.js` (interface) et `Admin/Backend/api-administration.js` (serveur) |
| Un administrateur voit (ou ne voit pas) une rubrique | `Admin/Backend/api-administration.js`, partie « Zones de l'administration » (`SECTIONS`, `sectionsFor`) |
| Effacer les données de test | Administration › **Nettoyage** ; fichier `Admin/Frontend/nettoyage-donnees-test.js` |
