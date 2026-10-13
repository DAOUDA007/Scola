# 3. Ce qui n'a pas été renommé, et pourquoi

Les fichiers de code ont reçu des noms en français qui disent ce qu'ils font (voir la fiche 4).
Certains noms ont été **volontairement gardés**, parce qu'un hébergeur, un navigateur ou les
téléphones des utilisateurs les attendent tels quels. Les changer aurait pu **arrêter le site**.

## Les dossiers

| Dossier | Ce qu'il contient | Pourquoi il garde son nom |
|---|---|---|
| `Application/` | l'application des élèves | Render démarre le serveur avec la commande `cd Application/Backend && npm start` |
| `Application/Backend/` | le **serveur** (Backend = serveur) | même raison : c'est le chemin utilisé par Render pour installer et démarrer Scola |
| `Application/Backend/src/` | les **fonctionnalités** du serveur (src = « source ») | le démarrage `node src/index.js` est écrit dans les réglages du serveur |
| `Application/Frontend/` | le **site des élèves** (Frontend = interface) | Vercel publie exactement ce dossier (`outputDirectory` dans `vercel.json`) |
| `Admin/`, `Etablissement/` | administration, espace des écoles | le serveur et la préparation Vercel les cherchent sous ces noms |
| `Admin/Backend`, `Etablissement/Backend` | leur partie **serveur** | chargées par le serveur Render à ces emplacements |
| `Admin/Frontend`, `Etablissement/Frontend` | leur partie **interface** | copiées par Vercel vers `/admin` et `/etablissement` |
| `js/`, `css/`, `icons/`, `stickers/` | programmes, apparence, icônes, autocollants | noms standard du web ; ils font partie des **adresses** des fichiers déjà gardés sur les téléphones (mode hors connexion) |
| `scripts/` | outil de mise en ligne Vercel | Vercel lance `npm run build`, qui appelle `scripts/vercel-build.js` |

**Rappel :** Backend = serveur (Render) · Frontend = interface (navigateur, téléphone).

## Les fichiers

| Fichier | Rôle | Pourquoi il garde son nom |
|---|---|---|
| `index.html` (×3) | page de chaque espace | nom que les navigateurs et Vercel ouvrent automatiquement |
| `sw.js` | mode hors connexion, notifications | **déjà installé sur les téléphones** des utilisateurs sous ce nom : le renommer couperait leurs mises à jour |
| `manifest.webmanifest` | nom et icône de l'application installée | nom attendu par les navigateurs |
| `config.js` | adresse du serveur | régénéré par Vercel à chaque mise en ligne sous ce nom |
| `src/index.js` | démarrage du serveur | commande de démarrage de Render |
| `scripts/vercel-build.js` | préparation du site pour Vercel | appelé par la commande de construction de Vercel |
| `package.json`, `package-lock.json` | commandes et bibliothèques | noms imposés par Node.js, Render et Vercel |
| `vercel.json` | réglages Vercel | nom imposé par Vercel |
| `README.md` | documentation | nom affiché automatiquement par GitHub |
| `.gitignore` | fichiers à ne pas envoyer sur GitHub | nom imposé par Git |

## Si un jour vous voulez aussi renommer les dossiers

C'est possible, mais il faut **changer en même temps les réglages de Render** (et parfois de Vercel).
Exemple pour `Application/Backend` → `Application/Serveur` :

1. Sur Render, ouvrez le service *scola-admin*, puis **Settings › Build & Deploy**. Notez les champs
   **Root Directory**, **Build Command** et **Start Command**.
2. Renommez le dossier dans le projet. Mettez à jour `package.json` (racine), `scripts/vercel-build.js`,
   `vercel.json` et le fichier `src/serveur-web-et-adresses.js` (chemins vers `Admin` et `Etablissement`).
3. Corrigez les champs Render qui contiennent l'ancien nom, **juste avant** d'envoyer la modification
   sur GitHub.
4. Envoyez sur GitHub, puis vérifiez sur Render › **Logs** que le serveur redémarre, et ouvrez
   `https://scola-admin.onrender.com/api/health`.

En cas de problème, revenir à la version précédente sur GitHub remet tout en ordre.
