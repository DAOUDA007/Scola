# Guide du projet Scola

Ce dossier explique, en français simple, **où se trouve chaque partie de Scola**. Il ne contient
aucun code : le lire ou le modifier ne change rien au site.

## Les 4 fiches du guide

| Fiche | À lire quand… |
|---|---|
| [1-plan-du-projet.md](1-plan-du-projet.md) | vous voulez savoir ce que contient chaque dossier et chaque fichier |
| [2-en-cas-de-probleme.md](2-en-cas-de-probleme.md) | quelque chose ne marche pas et vous cherchez quel fichier ouvrir |
| [3-ce-qui-n-a-pas-ete-renomme.md](3-ce-qui-n-a-pas-ete-renomme.md) | vous vous demandez pourquoi certains dossiers ou fichiers gardent un nom anglais ou technique |
| [4-anciens-et-nouveaux-noms.md](4-anciens-et-nouveaux-noms.md) | vous retrouvez un ancien nom de fichier (dans un vieux message, une capture, l'historique) |

## Scola en une image

```
                 ┌───────────────────────────────┐
  Élèves  ─────► │  Site des élèves (Vercel)     │  Application/Frontend
                 └──────────────┬────────────────┘
  Écoles  ─────► Espace établissements (/etablissement)  Etablissement/Frontend
  Vous    ─────► Administration (/admin)                 Admin/Frontend
                                │  toutes les demandes
                                ▼
                 ┌───────────────────────────────┐
                 │  Serveur Scola (Render)       │  Application/Backend
                 │  + API admin et établissements│  Admin/Backend, Etablissement/Backend
                 └──────────────┬────────────────┘
                                ▼
                     Base de données PostgreSQL (Render)
```

- **Frontend** (= « l'interface ») : ce que l'on voit dans le navigateur ou sur le téléphone.
- **Backend** (= « le serveur ») : ce qui tourne sur Render, garde les données et répond aux demandes.

## Règle d'or

Chaque fichier commence par **une ou deux lignes de commentaire** qui disent à quoi il sert.
En ouvrant un fichier, lisez toujours ces premières lignes.
