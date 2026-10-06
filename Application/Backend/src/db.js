// Stockage : tout l'état est gardé en mémoire et sauvegardé de façon différée.
//  - par défaut : fichier data/db.json (écriture atomique) ;
//  - si DATABASE_URL est défini : PostgreSQL (indispensable sur les hébergeurs dont le
//    disque est effacé à chaque redémarrage, comme Render) — données ET fichiers envoyés.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SCOLA_DATA || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const DATABASE_URL = process.env.DATABASE_URL || '';

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
    pushSubs: {},     // abonnements aux notifications push (par appareil connecté)
    meta: {},         // clé secrète des sessions, clés VAPID, etc.
  };
}

// L'objet exporté garde la même identité : init() le remplit sur place.
const data = empty();
function fill(obj) {
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, empty(), obj);
}

function readFile() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.error('[db] lecture impossible, base vierge utilisée :', e.message);
  }
  return null;
}

/* ---------------- PostgreSQL ---------------- */

let pool = null;
const written = new Map(); // clé -> dernier JSON écrit (on n'écrit que ce qui change)

// Une ligne par collection, et une ligne par discussion pour les messages.
function entries() {
  const out = [];
  for (const k of Object.keys(data)) {
    if (k === 'messages') for (const [cid, list] of Object.entries(data.messages)) out.push(['messages/' + cid, list]);
    else out.push([k, data[k]]);
  }
  return out;
}

async function init() {
  if (!DATABASE_URL) {
    const obj = readFile();
    if (obj) fill(obj);
    return;
  }
  const { Pool } = require('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
  pool = new Pool({ connectionString: DATABASE_URL, ssl: local || process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }, max: Number(process.env.PG_POOL_MAX) || 4 });
  await pool.query(`
    create table if not exists scola_kv (k text primary key, v jsonb not null, updated_at timestamptz not null default now());
    create table if not exists scola_media (name text primary key, mime text, size integer, data bytea not null, created_at timestamptz not null default now());`);
  const { rows } = await pool.query('select k, v from scola_kv');
  if (!rows.length) {
    // Première utilisation : on importe la base locale si elle existe.
    const obj = readFile();
    if (obj) {
      fill(obj);
      dirty = true;
      await flushPg();
      console.log('[db] base locale importée dans PostgreSQL.');
    }
    return;
  }
  const obj = { messages: {} };
  for (const r of rows) {
    if (r.k.startsWith('messages/')) obj.messages[r.k.slice(9)] = r.v;
    else obj[r.k] = r.v;
  }
  fill(obj);
  for (const [k, v] of entries()) written.set(k, JSON.stringify(v));
  console.log('[db] données chargées depuis PostgreSQL.');
}

let dirty = false;
async function flushPg() {
  if (!dirty) return;
  dirty = false;
  const changed = [];
  const present = new Set();
  for (const [k, v] of entries()) {
    present.add(k);
    const s = JSON.stringify(v);
    if (written.get(k) !== s) changed.push([k, s]);
  }
  const removed = [...written.keys()].filter(k => !present.has(k));
  if (!changed.length && !removed.length) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const [k, s] of changed) {
      await client.query('insert into scola_kv (k, v, updated_at) values ($1, $2::jsonb, now()) on conflict (k) do update set v = excluded.v, updated_at = now()', [k, s]);
    }
    if (removed.length) await client.query('delete from scola_kv where k = any($1)', [removed]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    dirty = true;
    throw e;
  } finally {
    client.release();
  }
  for (const [k, s] of changed) written.set(k, s);
  for (const k of removed) written.delete(k);
}

/* ---------------- Sauvegarde différée ---------------- */

let timer = null;
let queue = Promise.resolve();
function save() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(flush, pool ? 1500 : 400);
}

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!pool) {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
    return Promise.resolve();
  }
  queue = queue.then(flushPg).catch((e) => {
    console.error('[db] écriture PostgreSQL échouée, nouvel essai dans 5 s :', e.message);
    setTimeout(save, 5000);
  });
  return queue;
}

async function shutdown() {
  try { await flush(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown); // envoyé par Render avant chaque redéploiement

/* ---------------- Fichiers envoyés ---------------- */

// Copie le fichier reçu dans PostgreSQL (le disque local n'est alors qu'un cache).
async function storeMedia(file) {
  if (!pool || !file) return;
  const buf = await fs.promises.readFile(file.path);
  await pool.query('insert into scola_media (name, mime, size, data) values ($1, $2, $3, $4) on conflict (name) do nothing', [file.filename, file.mimetype, file.size, buf]);
}

// Récupère un fichier absent du disque (après un redémarrage) et le remet en cache.
async function restoreMedia(name) {
  if (!pool) return false;
  const { rows } = await pool.query('select data from scola_media where name = $1', [name]);
  if (!rows[0]) return false;
  await fs.promises.writeFile(path.join(UPLOADS, name), rows[0].data);
  return true;
}

module.exports = { data, save, flush, init, storeMedia, restoreMedia, UPLOADS, DATA_DIR, usesPostgres: () => !!pool };
