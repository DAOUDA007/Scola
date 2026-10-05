// Stockage persistant simple : tout l'état est gardé en mémoire et écrit
// dans data/db.json (écriture atomique, différée). Aucune dépendance native.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SCOLA_DATA || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOADS, { recursive: true });

function empty() {
  return {
    users: {},        // id -> utilisateur
    phones: {},       // téléphone -> id utilisateur
    classes: {},      // id -> classe (= le groupe unique de chaque élève)
    classKeys: {},    // clé normalisée pays|cycle|filière|niveau -> id classe
    chats: {},        // id -> discussion (groupe de classe, privée, diffusion)
    messages: {},     // id discussion -> [messages]
    userChats: {},    // id utilisateur -> { id discussion -> état personnel }
    statuses: {},     // id -> statut (24 h)
    calls: {},        // id -> journal d'appel
    sessions: {},     // id -> appareil connecté
    otps: {},         // téléphone -> { code, expires, tries }
    linkCodes: {},    // code QR -> demande de connexion d'appareil
    reports: [],      // signalements (traités par l'administration)
    admins: {},       // id -> administrateur du site (espace /admin)
  };
}

let data = empty();
try {
  if (fs.existsSync(FILE)) data = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch (e) {
  console.error('[db] lecture impossible, base vierge utilisée :', e.message);
}

let timer = null;
function save() {
  if (timer) return;
  timer = setTimeout(flush, 400);
}
function flush() {
  clearTimeout(timer);
  timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

module.exports = { data, save, flush, UPLOADS, DATA_DIR };
