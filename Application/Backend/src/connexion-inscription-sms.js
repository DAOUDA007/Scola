// Connexion façon WhatsApp : numéro de téléphone -> code à 6 chiffres -> (code PIN
// de vérification en deux étapes) -> profil + choix de la classe à l'inscription.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { DATA_DIR } = require('./base-de-donnees');
const C = require('./donnees-classes-et-discussions');
const catalog = require('./listes-pays-filieres-niveaux');
const { data, save } = C;

// Clé de signature des sessions, conservée dans la base (elle survit ainsi aux
// redémarrages, même quand le disque est effacé). L'ancienne clé secret.key est reprise.
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const SECRET = process.env.SCOLA_SECRET || (() => {
  if (!data.meta.secret) {
    data.meta.secret = fs.existsSync(SECRET_FILE) ? fs.readFileSync(SECRET_FILE, 'utf8').trim() : crypto.randomBytes(48).toString('hex');
    save();
  }
  return data.meta.secret;
})();

// Sans fournisseur SMS configuré, le code est affiché dans la console et renvoyé
// au client (mode démonstration). Brancher un service SMS dans sendSms().
// Connexion : toujours numéro + mot de passe. Les SMS (s'ils sont configurés) servent seulement à
// vérifier le numéro à l'inscription, à retrouver un mot de passe oublié et à changer de numéro.
// Le code n'est jamais renvoyé à l'application.
const PASSWORD_MODE = true;
const DEV_OTP = false;

// SMS envoyés par un téléphone Android (application gratuite textbee, https://textbee.dev) :
//   SMS_PROVIDER=textbee, TEXTBEE_API_KEY=…, TEXTBEE_DEVICE_ID=… (facultatif).
// Sans configuration : aucun SMS, l'inscription se fait avec le seul mot de passe.
const SMS_ENABLED = process.env.SMS_PROVIDER === 'textbee' && !!process.env.TEXTBEE_API_KEY;
async function sendSms(phone, text) {
  if (!SMS_ENABLED) { console.log(`[SMS non configuré -> ${phone}] ${text}`); return; }
  let r;
  try {
    r = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
      method: 'POST',
      headers: { 'x-api-key': process.env.TEXTBEE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [phone], message: text, ...(process.env.TEXTBEE_DEVICE_ID ? { deviceId: process.env.TEXTBEE_DEVICE_ID } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw httpError(503, 'Envoi du SMS impossible pour le moment. Réessayez dans quelques minutes.'); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    console.error('[SMS] textbee', r.status, d.message || d.error || '');
    throw httpError(503, r.status === 429 ? 'Le nombre de SMS du jour est atteint. Réessayez demain ou contactez l\'administration de Scola.' : 'Envoi du SMS impossible pour le moment (téléphone d\'envoi hors ligne ?). Réessayez plus tard.');
  }
}

function normPhone(p) {
  const s = String(p || '').replace(/[^\d+]/g, '');
  if (!/^\+\d{8,15}$/.test(s)) throw httpError(400, 'Numéro invalide. Format international requis, ex. +225 07 00 00 00 00');
  return s;
}

// Erreur destinée à l'utilisateur : son message est toujours affiché (même pour un 503 prévu).
function httpError(status, message) { const e = new Error(message); e.status = status; e.expose = true; return e; }

function issueToken(userId, device) {
  const sid = C.uid('s_');
  data.sessions[sid] = { id: sid, userId, device: String(device || 'Navigateur').slice(0, 80), createdAt: C.now(), lastActive: C.now() };
  save();
  // Pas d'expiration, comme WhatsApp : la session dure jusqu'à la déconnexion volontaire
  // ou jusqu'à ce que l'appareil soit déconnecté (Appareils connectés / administration).
  return jwt.sign({ uid: userId, sid }, SECRET);
}

function verifyToken(token) {
  try {
    const p = jwt.verify(token, SECRET);
    const s = data.sessions[p.sid];
    const u = data.users[p.uid];
    if (!s || !u || u.deleted || u.suspended || s.userId !== u.id) return null;
    return { user: u, session: s };
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const v = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : req.query.token);
  if (!v) return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  req.user = v.user;
  req.session = v.session;
  v.session.lastActive = C.now();
  next();
}

const router = express.Router();

router.get('/catalog', (req, res) => res.json({ countries: catalog.countries, cycles: catalog.cycles, cities: catalog.cities, domains: catalog.domains }));

// Aperçu des classes existantes pour aider au choix pendant l'inscription.
router.get('/classes/lookup', (req, res) => {
  try {
    const r = catalog.resolve(req.query);
    const id = data.classKeys[r.key];
    const cls = id && data.classes[id];
    res.json({ ...r, exists: !!cls, members: cls ? cls.memberIds.length : 0, displayName: cls ? cls.name : r.name });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Lien d'invitation : pré-remplit l'inscription avec la classe correspondante.
router.get('/invite/:code', (req, res) => {
  const cls = Object.values(data.classes).find(c => c.inviteCode === req.params.code);
  if (!cls) throw httpError(404, 'Lien d\'invitation invalide ou réinitialisé.');
  res.json({ name: cls.name, icon: cls.icon, country: cls.country, cycle: cls.cycle, filiere: cls.filiere, niveau: cls.niveau, members: cls.memberIds.length, description: cls.description });
});

// Numéro déjà déclaré par un établissement (demande ou compte) : il ne peut pas servir à créer un
// compte élève ni rejoindre une classe. Comparaison sur les 8 derniers chiffres (indicatif facultatif).
const digits8 = (p) => String(p || '').replace(/\D/g, '').slice(-8);
function isSchoolPhone(phone) {
  const d = digits8(phone);
  return d.length === 8 && Object.values(data.schools || {}).some(s => s.status !== 'rejected' && digits8(s.phone) === d);
}

/* --- Connexion par mot de passe (mode sans SMS) --- */
// Trop d'essais : blocage 15 minutes par numéro (5 échecs) et par adresse IP (20 échecs).
const fails = new Map();
const LOCK = 15 * 60_000;
function checkLock(...keys) {
  for (const k of keys) {
    const f = fails.get(k);
    if (f && f.until > C.now() && f.n >= (k.startsWith('ip:') ? 20 : 5)) throw httpError(429, `Trop d'essais. Réessayez dans ${Math.ceil((f.until - C.now()) / 60000)} minute(s).`);
  }
}
function fail(...keys) {
  for (const k of keys) { const f = fails.get(k); fails.set(k, { n: (f && f.until > C.now() ? f.n : 0) + 1, until: C.now() + LOCK }); }
}
function checkPassword(p) {
  p = String(p || '');
  if (p.length < 8) throw httpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  if (/^(\d)\1+$/.test(p) || ['12345678', '123456789', 'azertyui', 'password', 'motdepasse'].includes(p.toLowerCase())) throw httpError(400, 'Mot de passe trop facile à deviner : choisissez-en un autre.');
  return p;
}

/* --- Codes envoyés par SMS : inscription, mot de passe oublié, changement de numéro --- */
// Limites (le forfait gratuit permet 50 SMS par jour) : 1 SMS par minute et 4 par jour pour un
// numéro, 15 par jour pour une adresse IP. Le code expire après 10 minutes et 5 essais.
const smsCount = new Map();
function smsQuota(key, max) {
  const day = new Date().toISOString().slice(0, 10);
  const c = smsCount.get(key);
  const n = c && c.day === day ? c.n : 0;
  if (n >= max) throw httpError(429, 'Trop de codes demandés aujourd\'hui. Réessayez demain.');
  smsCount.set(key, { day, n: n + 1 });
}
async function sendCode(phone, purpose, ip) {
  if (!SMS_ENABLED) throw httpError(400, 'L\'envoi de codes par SMS n\'est pas activé.');
  const prev = data.otps[phone];
  if (prev && prev.sentAt > C.now() - 60_000) throw httpError(429, 'Patientez une minute avant de redemander un code.');
  smsQuota('ph:' + phone, 4);
  smsQuota('ip:' + ip, 15);
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  data.otps[phone] = { code, purpose, expires: C.now() + 10 * 60_000, tries: 0, sentAt: C.now() };
  save();
  const what = { signup: 'pour créer votre compte', reset: 'pour choisir un nouveau mot de passe', number: 'pour confirmer votre nouveau numéro', school: 'pour choisir le nouveau mot de passe de votre établissement' }[purpose];
  await sendSms(phone, `Scola : votre code ${what} est ${code}. Ne le donnez à personne.`);
}
function checkCode(phone, purpose, code) {
  const o = data.otps[phone];
  if (!o || o.purpose !== purpose || o.expires < C.now()) throw httpError(400, 'Code expiré ou inconnu. Demandez un nouveau code.');
  if (++o.tries > 5) { delete data.otps[phone]; save(); throw httpError(429, 'Trop d\'essais. Demandez un nouveau code.'); }
  if (String(code || '').trim() !== o.code) { save(); throw httpError(400, 'Code incorrect.'); }
  delete data.otps[phone];
  save();
}

router.post('/auth/send-code', async (req, res) => {
  const phone = normPhone(req.body.phone);
  const purpose = req.body.purpose === 'reset' ? 'reset' : 'signup';
  const u = data.users[data.phones[phone]];
  const exists = !!u && !u.deleted;
  if (purpose === 'signup') {
    if (exists) throw httpError(400, 'Ce numéro est déjà inscrit : connectez-vous.');
    if (isSchoolPhone(phone)) throw httpError(403, 'Ce numéro est celui d\'un établissement inscrit sur Scola. Les établissements n\'ont pas de compte élève : utilisez l\'Espace Établissements.');
  } else if (!exists) throw httpError(400, 'Aucun compte avec ce numéro.');
  await sendCode(phone, purpose, req.ip);
  res.json({ ok: true });
});

// Mot de passe oublié : code reçu par SMS, puis nouveau mot de passe.
router.post('/auth/reset-password', (req, res) => {
  const phone = normPhone(req.body.phone);
  const u = data.users[data.phones[phone]];
  if (!u || u.deleted) throw httpError(400, 'Aucun compte avec ce numéro.');
  checkCode(phone, 'reset', req.body.code);
  u.passwordHash = bcrypt.hashSync(checkPassword(req.body.password), 10);
  u.mustChangePassword = false;
  u.phoneVerified = true;
  fails.delete('ph:' + phone);
  save();
  if (u.suspended) throw httpError(403, 'Ce compte a été suspendu par l\'administration de Scola.');
  if (u.pinHash) return res.json({ needPin: true, pinToken: jwt.sign({ pin: u.id }, SECRET, { expiresIn: '10m' }), name: u.name });
  res.json({ token: issueToken(u.id, req.body.device) });
});

router.post('/auth/login-password', (req, res) => {
  const phone = normPhone(req.body.phone);
  checkLock('ph:' + phone, 'ip:' + req.ip);
  const user = data.users[data.phones[phone]];
  if (!user || user.deleted) { fail('ip:' + req.ip); throw httpError(400, 'Aucun compte avec ce numéro. Vérifiez-le ou créez votre compte.'); }
  if (!user.passwordHash) throw httpError(400, 'Ce compte n\'a pas encore de mot de passe. Ouvrez Scola sur un appareil déjà connecté et créez-le dans Paramètres › Compte › Mot de passe, ou demandez un mot de passe provisoire à l\'administration de Scola.');
  if (!bcrypt.compareSync(String(req.body.password || ''), user.passwordHash)) { fail('ph:' + phone, 'ip:' + req.ip); throw httpError(400, 'Mot de passe incorrect.'); }
  fails.delete('ph:' + phone);
  if (user.suspended) throw httpError(403, `Ce compte a été suspendu par l'administration de Scola.${user.suspended.reason ? ' Motif : ' + user.suspended.reason : ''}`);
  if (user.pinHash) {
    const pinToken = jwt.sign({ pin: user.id }, SECRET, { expiresIn: '10m' });
    return res.json({ needPin: true, pinToken, name: user.name });
  }
  res.json({ token: issueToken(user.id, req.body.device) });
});

// Inscription : le mot de passe est choisi avant le profil et la classe.
router.post('/auth/signup-start', (req, res) => {
  const phone = normPhone(req.body.phone);
  checkLock('ip:' + req.ip);
  if (phone.replace(/\D/g, '').length < 8) throw httpError(400, 'Numéro invalide.');
  if (data.phones[phone] && !data.users[data.phones[phone]]?.deleted) throw httpError(400, 'Ce numéro est déjà inscrit : connectez-vous.');
  if (isSchoolPhone(phone)) throw httpError(403, 'Ce numéro est celui d\'un établissement inscrit sur Scola. Les établissements n\'ont pas de compte élève : utilisez l\'Espace Établissements.');
  const pw = bcrypt.hashSync(checkPassword(req.body.password), 10);
  // Avec les SMS : le numéro doit être vérifié par le code reçu.
  if (SMS_ENABLED) checkCode(phone, 'signup', req.body.code);
  res.json({ signupToken: jwt.sign({ signup: phone, pw, verified: SMS_ENABLED }, SECRET, { expiresIn: '1h' }) });
});

// Création ou changement du mot de passe (élève connecté).
router.patch('/me/password', requireAuth, (req, res) => {
  const u = req.user;
  if (u.passwordHash && !u.mustChangePassword && !bcrypt.compareSync(String(req.body.currentPassword || ''), u.passwordHash)) throw httpError(400, 'Mot de passe actuel incorrect.');
  u.passwordHash = bcrypt.hashSync(checkPassword(req.body.password), 10);
  u.mustChangePassword = false;
  save();
  res.json({ ok: true, hasPassword: true });
});

router.post('/auth/request-otp', async (req, res) => {
  const phone = normPhone(req.body.phone);
  // Mode sans SMS : on indique seulement s'il faut se connecter ou créer un compte.
  if (PASSWORD_MODE) {
    const u = data.users[data.phones[phone]];
    const exists = !!u && !u.deleted;
    if (!exists && isSchoolPhone(phone)) throw httpError(403, 'Ce numéro est celui d\'un établissement inscrit sur Scola. Les établissements n\'ont pas de compte élève : utilisez l\'Espace Établissements.');
    return res.json({ ok: true, mode: 'password', exists, hasPassword: exists && !!u.passwordHash, sms: SMS_ENABLED });
  }
  if (!data.phones[phone] && isSchoolPhone(phone)) {
    throw httpError(403, 'Ce numéro est celui d\'un établissement inscrit sur Scola. Les établissements n\'ont pas de compte élève : utilisez l\'Espace Établissements.');
  }
  const prev = data.otps[phone];
  if (prev && prev.sentAt > C.now() - 30_000) throw httpError(429, 'Patientez 30 secondes avant de redemander un code.');
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  data.otps[phone] = { code, expires: C.now() + 10 * 60_000, tries: 0, sentAt: C.now() };
  save();
  await sendSms(phone, `Votre code Scola : ${code}. Ne le partagez avec personne.`);
  res.json({ ok: true, exists: !!data.phones[phone], devCode: DEV_OTP ? code : undefined });
});

router.post('/auth/verify-otp', (req, res) => {
  if (PASSWORD_MODE) throw httpError(400, 'La connexion se fait par mot de passe.');
  const phone = normPhone(req.body.phone);
  const o = data.otps[phone];
  if (!o || o.expires < C.now()) throw httpError(400, 'Code expiré. Demandez-en un nouveau.');
  if (++o.tries > 5) { delete data.otps[phone]; save(); throw httpError(429, 'Trop de tentatives. Demandez un nouveau code.'); }
  if (String(req.body.code).trim() !== o.code) { save(); throw httpError(400, 'Code incorrect.'); }
  delete data.otps[phone];
  save();
  const userId = data.phones[phone];
  const user = userId && data.users[userId];
  if (user && !user.deleted) {
    if (user.suspended) throw httpError(403, `Ce compte a été suspendu par l'administration de Scola.${user.suspended.reason ? ' Motif : ' + user.suspended.reason : ''}`);
    if (user.pinHash) {
      const pinToken = jwt.sign({ pin: user.id }, SECRET, { expiresIn: '10m' });
      return res.json({ needPin: true, pinToken, name: user.name });
    }
    return res.json({ token: issueToken(user.id, req.body.device) });
  }
  const signupToken = jwt.sign({ signup: phone }, SECRET, { expiresIn: '1h' });
  res.json({ newUser: true, signupToken });
});

router.post('/auth/verify-pin', (req, res) => {
  let p;
  try { p = jwt.verify(req.body.pinToken, SECRET); } catch { throw httpError(400, 'Session expirée, recommencez.'); }
  const user = data.users[p.pin];
  if (!user || !user.pinHash) throw httpError(400, 'Compte introuvable.');
  if (user.suspended) throw httpError(403, 'Ce compte a été suspendu par l\'administration de Scola.');
  if (!bcrypt.compareSync(String(req.body.pin || ''), user.pinHash)) throw httpError(400, 'Code PIN incorrect.');
  res.json({ token: issueToken(user.id, req.body.device) });
});

router.post('/auth/register', (req, res) => {
  let p;
  try { p = jwt.verify(req.body.signupToken, SECRET); } catch { throw httpError(400, 'Inscription expirée, recommencez.'); }
  const phone = p.signup;
  if (PASSWORD_MODE && !p.pw) throw httpError(400, 'Inscription expirée, recommencez.');
  if (data.phones[phone] && !data.users[data.phones[phone]]?.deleted) throw httpError(400, 'Ce numéro est déjà inscrit.');
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (name.length < 2) throw httpError(400, 'Indiquez votre nom (2 caractères minimum).');
  let r;
  try { r = catalog.resolve(req.body); } catch (e) { throw httpError(400, e.message); }

  const id = C.uid('u_');
  const { cls, created } = C.ensureClass(r);
  const clsId = cls.id;
  data.users[id] = {
    id, phone, name, about: String(req.body.about || 'Salut ! J\'utilise Scola.').slice(0, 139),
    avatar: typeof req.body.avatar === 'string' && req.body.avatar.startsWith('/media/') ? req.body.avatar : null,
    school: String(req.body.school || '').trim().slice(0, 80),
    classId: clsId, createdAt: C.now(), lastSeen: C.now(), pinHash: null, pinHint: '', passwordHash: p.pw || null, phoneVerified: !!p.verified,
    privacy: C.defaultPrivacy(), settings: C.defaultSettings(), blocked: [],
  };
  data.phones[phone] = id;
  cls.memberIds.push(id);
  save();
  // Personne ne « crée » un groupe : chaque élève rejoint celui de sa filière et de son niveau.
  C.systemMessage(clsId, `${name} a rejoint la classe`, { meta: { joined: id } });
  C.toUsers(cls.memberIds.filter(x => x !== id), 'member:join', C.publicUser(data.users[id], cls.memberIds[0]));
  res.json({ token: issueToken(id, req.body.device), created });
});

/* --- Connexion d'un appareil par QR code (comme WhatsApp Web) --- */

router.post('/auth/link/start', async (req, res) => {
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  data.linkCodes[code] = { code, device: String(req.body.device || 'Navigateur').slice(0, 80), expires: C.now() + 3 * 60_000, token: null };
  save();
  const qr = await QRCode.toDataURL('scola-link:' + code, { margin: 1, width: 264 });
  res.json({ code, qr, expires: data.linkCodes[code].expires });
});

router.get('/auth/link/:code', (req, res) => {
  const l = data.linkCodes[req.params.code];
  if (!l) return res.json({ expired: true });
  if (l.token) { delete data.linkCodes[l.code]; save(); return res.json({ token: l.token }); }
  res.json({ pending: true });
});

router.post('/auth/link/approve', requireAuth, (req, res) => {
  const code = String(req.body.code || '').replace(/^scola-link:/, '').trim().toUpperCase();
  const l = data.linkCodes[code];
  if (!l || l.expires < C.now()) throw httpError(400, 'Code QR invalide ou expiré.');
  l.token = issueToken(req.user.id, l.device);
  save();
  res.json({ ok: true, device: l.device });
});

module.exports = { router, requireAuth, verifyToken, httpError, bcrypt, SECRET, jwt, checkPassword, PASSWORD_MODE, SMS_ENABLED, sendCode, checkCode, normPhone, isSchoolPhone };
