// Espace Établissement (/etablissement) : les écoles et universités demandent un compte,
// l'activent avec le code envoyé par l'administration, publient sur leur chaîne
// d'orientation et répondent aux élèves. Chargé par le serveur de l'application.
const path = require('path');
const { createRequire } = require('module');
const BACKEND = process.env.SCOLA_BACKEND || path.join(__dirname, '..', '..', 'Application', 'Backend');
const backendRequire = createRequire(path.join(BACKEND, 'package.json'));
const express = backendRequire('express');
const C = backendRequire('./src/core');
const O = backendRequire('./src/orientation');
const mail = backendRequire('./src/mail');
const { httpError, bcrypt, SECRET, jwt } = backendRequire('./src/auth');
const { upload, cleanMedia } = backendRequire('./src/api');
const { storeMedia } = backendRequire('./src/db');
const { data, save } = C;

const router = express.Router();
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const clip = (v, n) => String(v || '').trim().slice(0, n);
const isMedia = (u) => typeof u === 'string' && /^\/media\/[a-f0-9]{32}(\.[a-z0-9]{1,7})?$/.test(u);

function selfView(s) {
  return {
    ...O.channelView(s), status: s.status, requestedAt: s.requestedAt, activatedAt: s.activatedAt || null,
    manager: s.manager, email: s.email, mustChangePassword: false,
  };
}

// Informations publiques et de contact de la chaîne (demande et modification).
function profileFields(b, s = {}) {
  const out = {};
  if (b.name !== undefined) { out.name = clip(b.name, 120); if (out.name.length < 3) throw httpError(400, 'Nom de l\'établissement trop court.'); }
  if (b.type !== undefined) out.type = O.SCHOOL_TYPES[b.type] ? b.type : 'autre';
  for (const [k, n] of [['country', 60], ['city', 80], ['address', 200], ['phone', 40], ['website', 200], ['description', 4000], ['programs', 2000]]) if (b[k] !== undefined) out[k] = clip(b[k], n);
  if (out.website && !/^https?:\/\//i.test(out.website)) out.website = 'https://' + out.website;
  if (b.manager !== undefined) out.manager = { name: clip(b.manager?.name, 80), role: clip(b.manager?.role, 80) };
  if (b.logo !== undefined) { if (b.logo !== null && !isMedia(b.logo)) throw httpError(400, 'Logo invalide.'); out.logo = b.logo; }
  return out;
}

/* ---------------- Demande de compte (publique) ---------------- */

router.get('/types', (req, res) => res.json(O.SCHOOL_TYPES));

// Logo envoyé avant la demande (le compte n'existe pas encore) : images uniquement.
router.post('/request/logo', upload.single('file'), async (req, res) => {
  if (!req.file || !/^image\//.test(req.file.mimetype) || req.file.size > 5 * 1024 * 1024) throw httpError(400, 'Logo invalide (image de 5 Mo maximum).');
  await storeMedia(req.file);
  res.json({ url: '/media/' + req.file.filename });
});

router.post('/request', async (req, res) => {
  const b = req.body;
  const email = normEmail(b.email);
  if (!validEmail(email)) throw httpError(400, 'Adresse e-mail invalide.');
  const existing = Object.values(data.schools).find(s => s.email === email && s.status !== 'rejected');
  if (existing) throw httpError(400, existing.status === 'active' ? 'Un compte existe déjà avec cet e-mail : connectez-vous.' : 'Une demande est déjà en cours pour cet e-mail. Le code d\'activation vous sera envoyé sous 72 h.');
  const f = profileFields({ type: 'autre', ...b });
  if (!f.name) throw httpError(400, 'Indiquez le nom de l\'établissement.');
  if (!f.country || !f.city) throw httpError(400, 'Indiquez le pays et la ville.');
  if (!f.phone) throw httpError(400, 'Indiquez un numéro de téléphone.');
  if (!f.manager?.name) throw httpError(400, 'Indiquez le nom du responsable de la demande.');
  if (!f.description || f.description.length < 20) throw httpError(400, 'Présentez l\'établissement en quelques phrases (20 caractères minimum).');
  const id = C.uid('e_');
  data.schools[id] = { id, email, status: 'pending', requestedAt: C.now(), followerIds: [], verified: false, tokenVersion: 0, ...f };
  save();
  // Alerte aux administrateurs (si l'envoi d'e-mails est configuré).
  const admins = Object.values(data.admins).map(a => a.email).filter(Boolean);
  if (admins.length) {
    mail.send({
      to: admins.join(','), subject: `Scola — nouvelle demande d'établissement : ${f.name}`,
      text: `Nouvelle demande de compte établissement :\n\n${f.name} (${O.SCHOOL_TYPES[f.type]})\n${f.city}, ${f.country}\nE-mail : ${email}\nResponsable : ${f.manager.name} ${f.manager.role ? '— ' + f.manager.role : ''}\n\nValidez-la dans l'administration de Scola, rubrique Établissements.`,
    });
  }
  res.json({ ok: true, status: 'pending', delayHours: 72 });
});

// Suivi de la demande, sans révéler d'informations : l'établissement saisit son e-mail.
router.post('/request/status', (req, res) => {
  const s = Object.values(data.schools).find(x => x.email === normEmail(req.body.email) && x.status !== 'deleted');
  if (!s) return res.json({ status: 'unknown' });
  res.json({ status: s.status, requestedAt: s.requestedAt, reason: s.status === 'rejected' ? s.rejectReason || '' : undefined });
});

/* ---------------- Activation par le code, connexion ---------------- */

function token(s) { return jwt.sign({ sch: s.id, v: s.tokenVersion || 0 }, SECRET, { expiresIn: '30d' }); }
function checkPassword(p) { if (String(p || '').length < 8) throw httpError(400, 'Le mot de passe doit contenir au moins 8 caractères.'); }

const attempts = new Map();
function limit(req) {
  const at = attempts.get(req.ip);
  if (at && at.until > C.now() && at.n >= 10) throw httpError(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
}
function failed(req) {
  const at = attempts.get(req.ip);
  attempts.set(req.ip, { n: (at && at.until > C.now() ? at.n : 0) + 1, until: C.now() + 15 * 60e3 });
}

router.post('/activate', (req, res) => {
  limit(req);
  const s = Object.values(data.schools).find(x => x.email === normEmail(req.body.email) && ['pending', 'code_sent'].includes(x.status));
  if (!s) { failed(req); throw httpError(400, 'Aucune demande en attente pour cet e-mail.'); }
  if (s.status === 'pending') throw httpError(400, 'Votre demande est en cours d\'examen. Le code d\'activation vous sera envoyé par e-mail sous 72 h.');
  try { O.checkActivationCode(s, req.body.code); } catch (e) { failed(req); throw e; }
  checkPassword(req.body.password);
  s.passwordHash = bcrypt.hashSync(String(req.body.password), 10);
  s.status = 'active';
  s.activatedAt = C.now();
  delete s.codeHash; delete s.codeExpires; delete s.codeAttempts;
  save();
  res.json({ token: token(s), school: selfView(s) });
});

router.post('/login', (req, res) => {
  limit(req);
  const s = Object.values(data.schools).find(x => x.email === normEmail(req.body.email));
  if (s && ['pending', 'code_sent'].includes(s.status)) throw httpError(400, 'Compte pas encore activé : utilisez le code d\'activation reçu par e-mail (sous 72 h après la demande).');
  if (!s || !s.passwordHash || !bcrypt.compareSync(String(req.body.password || ''), s.passwordHash)) { failed(req); throw httpError(401, 'E-mail ou mot de passe incorrect.'); }
  if (s.status === 'suspended') throw httpError(403, 'Ce compte a été suspendu par l\'administration de Scola.');
  if (s.status !== 'active') throw httpError(403, 'Ce compte n\'est pas actif.');
  attempts.delete(req.ip);
  s.lastLogin = C.now();
  save();
  res.json({ token: token(s), school: selfView(s) });
});

/* ---------------- Espace connecté ---------------- */

router.use((req, res, next) => {
  const h = req.headers.authorization || '';
  try {
    const p = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', SECRET);
    const s = p.sch && data.schools[p.sch];
    if (!s || s.status !== 'active' || (s.tokenVersion || 0) !== p.v) throw new Error();
    req.school = s;
  } catch { return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' }); }
  next();
});

router.get('/me', (req, res) => res.json(selfView(req.school)));

router.patch('/me', (req, res) => {
  const f = profileFields(req.body);
  delete f.type; // le type d'établissement est fixé à la validation
  Object.assign(req.school, f);
  save();
  res.json(selfView(req.school));
});

router.patch('/me/password', (req, res) => {
  const s = req.school;
  if (!bcrypt.compareSync(String(req.body.currentPassword || ''), s.passwordHash)) throw httpError(400, 'Mot de passe actuel incorrect.');
  checkPassword(req.body.password);
  s.passwordHash = bcrypt.hashSync(String(req.body.password), 10);
  s.tokenVersion = (s.tokenVersion || 0) + 1;
  save();
  res.json({ token: token(s) });
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) throw httpError(400, 'Aucun fichier reçu.');
  await storeMedia(req.file);
  res.json({ url: '/media/' + req.file.filename, name: req.file.originalname, size: req.file.size, mime: req.file.mimetype });
});

/* Publications */
router.get('/posts', (req, res) => {
  const list = O.postsOf(req.school.id);
  res.json([...list].reverse().slice(0, 200).map(p => O.postView(p)));
});

router.post('/posts', (req, res) => {
  const b = req.body;
  const text = clip(b.text, 6000);
  const media = b.media ? cleanMedia(b.media) : null;
  if (!text && !media) throw httpError(400, 'La publication est vide.');
  const type = !media ? 'text' : /^image\//.test(media.mime) ? 'image' : /^video\//.test(media.mime) ? 'video' : 'document';
  const p = { id: C.uid('p_'), schoolId: req.school.id, type, text, media, createdAt: C.now(), reactions: {}, viewerIds: [] };
  O.postsOf(req.school.id).push(p);
  save();
  O.notifyPost(req.school, p);
  res.json(O.postView(p));
});

router.patch('/posts/:id', (req, res) => {
  const p = O.postsOf(req.school.id).find(x => x.id === req.params.id);
  if (!p) throw httpError(404, 'Publication introuvable.');
  const text = clip(req.body.text, 6000);
  if (!text && !p.media) throw httpError(400, 'La publication est vide.');
  p.text = text;
  p.editedAt = C.now();
  save();
  for (const uid of req.school.followerIds || []) if (C.isOnline(uid)) C.toUser(uid, 'orientation:update', O.postView(p, uid));
  res.json(O.postView(p));
});

router.delete('/posts/:id', (req, res) => {
  const list = O.postsOf(req.school.id);
  const i = list.findIndex(x => x.id === req.params.id);
  if (i < 0) throw httpError(404, 'Publication introuvable.');
  list.splice(i, 1);
  save();
  C.toUsers(req.school.followerIds || [], 'orientation:remove', { schoolId: req.school.id, id: req.params.id });
  res.json({ ok: true });
});

/* Statistiques */
router.get('/stats', (req, res) => {
  const s = req.school;
  const posts = O.postsOf(s.id);
  const byCycle = {};
  for (const uid of s.followerIds || []) {
    const cls = data.classes[data.users[uid]?.classId];
    const k = cls?.cycleLabel || 'Autre';
    byCycle[k] = (byCycle[k] || 0) + 1;
  }
  const inquiries = Object.values(data.inquiries).filter(q => q.schoolId === s.id);
  res.json({
    followers: (s.followerIds || []).length, posts: posts.length,
    views: posts.reduce((n, p) => n + (p.viewerIds || []).length, 0),
    reactions: posts.reduce((n, p) => n + Object.keys(p.reactions || {}).length, 0),
    inquiries: inquiries.length, unread: inquiries.reduce((n, q) => n + O.inquiryView(q, 'school').unread, 0),
    byCycle: Object.entries(byCycle).sort((a, b) => b[1] - a[1]),
  });
});

/* Messages des élèves (l'établissement ne peut que répondre, jamais écrire le premier). */
function myInquiry(req) {
  const q = data.inquiries[req.params.id];
  if (!q || q.schoolId !== req.school.id) throw httpError(404, 'Conversation introuvable.');
  return q;
}

router.get('/inquiries', (req, res) => {
  res.json(Object.values(data.inquiries).filter(q => q.schoolId === req.school.id)
    .sort((a, b) => b.updatedAt - a.updatedAt).map(q => O.inquiryView(q, 'school')));
});

router.get('/inquiries/:id', (req, res) => {
  const q = myInquiry(req);
  res.json({ inquiry: O.inquiryView(q, 'school'), messages: q.messages.slice(-300) });
});

router.post('/inquiries/:id/messages', (req, res) => {
  const q = myInquiry(req);
  const m = O.addInquiryMessage(q, 'school', req.body);
  res.json({ inquiry: O.inquiryView(q, 'school'), message: m });
});

router.post('/inquiries/:id/read', (req, res) => {
  const q = myInquiry(req);
  q.readBySchoolAt = C.now();
  save();
  res.json({ ok: true });
});

module.exports = { router };
