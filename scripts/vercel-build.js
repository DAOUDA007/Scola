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
const file = path.join(__dirname, '..', 'Application', 'Frontend', 'config.js');
fs.writeFileSync(file, `// Généré au déploiement Vercel : adresse du serveur Scola.\nself.SCOLA_BACKEND = ${JSON.stringify(url)};\n`);
console.log(`Scola : site prêt pour Vercel, serveur ${url}`);
