// Réinitialise (ou crée) un compte administrateur et affiche un nouveau mot de passe.
// Usage (serveur arrêté) : npm run admin:reset -- admin@exemple.com
// Avec DATABASE_URL défini, agit directement sur la base PostgreSQL (ex. celle de Render).
const crypto = require('crypto');
const path = require('path');
const { createRequire } = require('module');
const BACKEND = process.env.SCOLA_BACKEND || path.join(__dirname, '..', '..', 'Application', 'Backend');
const backendRequire = createRequire(path.join(BACKEND, 'package.json'));
const bcrypt = backendRequire('bcryptjs');
const db = backendRequire('./src/db');

(async () => {
  await db.init();
  const { data } = db;
  const email = String(process.argv[2] || process.env.SCOLA_ADMIN_EMAIL || 'daoudaprosperekone202@gmail.com').trim().toLowerCase();
  const password = crypto.randomBytes(9).toString('base64url');
  let a = Object.values(data.admins).find(x => x.email === email);
  if (!a) {
    const id = 'a_' + crypto.randomBytes(9).toString('base64url');
    a = data.admins[id] = { id, name: 'Administrateur', email, createdAt: Date.now(), createdBy: null, tokenVersion: 0 };
  }
  a.passwordHash = bcrypt.hashSync(password, 10);
  a.tokenVersion = (a.tokenVersion || 0) + 1;
  a.mustChangePassword = true;
  db.save();
  await db.flush();
  console.log(`\n  Administrateur : ${email}\n  Nouveau mot de passe : ${password}\n  (à changer à la prochaine connexion sur /admin)\n`);
  console.log(db.usesPostgres()
    ? '  Base PostgreSQL mise à jour. Redémarrez le serveur pour qu\'il relise ce changement.\n'
    : '  Attention : arrêtez le serveur Scola avant de lancer ce script, sinon il écrasera ce changement.\n');
  process.exit(0);
})().catch((e) => { console.error('Échec :', e.message); process.exit(1); });
