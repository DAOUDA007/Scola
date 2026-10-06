// Point d'entrée : charge les données (fichier local ou PostgreSQL) puis démarre le serveur.
// Les autres modules lisent la base dès leur chargement : ils sont requis après init().
const db = require('./db');

db.init()
  .then(() => require('./server'))
  .catch((e) => {
    console.error('\n  Impossible de charger les données Scola :', e.message);
    if (process.env.DATABASE_URL) console.error('  Vérifiez la variable DATABASE_URL (adresse, mot de passe, accès réseau).\n');
    process.exit(1);
  });
