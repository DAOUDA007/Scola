// Déploiement sur Vercel : Vercel héberge le site (fichiers de Application/Frontend) ;
// le serveur Scola (messages en direct, appels, données, fichiers) reste sur Render.
// Ce script écrit l'adresse du serveur dans config.js, lu par l'application et le service worker.
const fs = require('fs');
const path = require('path');

const url = String(process.env.SCOLA_BACKEND_URL || 'https://scola-admin.onrender.com').trim().replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+$/.test(url)) {
  console.error(`SCOLA_BACKEND_URL invalide : « ${url} ». Exemple : https://scola-admin.onrender.com`);
  process.exit(1);
}
const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'Application', 'Frontend');
// L'administration (/admin) et l'espace établissements (/etablissement) sont publiés avec le site :
// Vercel les sert directement, et leurs requêtes vont au serveur Scola (adresse de config.js).
for (const [from, to] of [['Admin', 'admin'], ['Etablissement', 'etablissement']]) {
  fs.rmSync(path.join(SITE, to), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, from, 'Frontend'), path.join(SITE, to), { recursive: true });
}
const file = path.join(SITE, 'config.js');
fs.writeFileSync(file, `// Généré au déploiement Vercel : adresse du serveur Scola.\nself.SCOLA_BACKEND = ${JSON.stringify(url)};\n`);
console.log(`Scola : site prêt pour Vercel, serveur ${url}`);
