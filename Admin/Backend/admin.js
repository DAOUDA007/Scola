// Espace d'administration du site (/admin) : comptes administrateurs séparés des
// élèves, gestion des utilisateurs, classes, signalements, statuts, annonces.
//
// Ce module est chargé par le serveur de l'application (Application/Backend) : il
// réutilise ses dépendances et sa logique métier — mêmes instances, même base.
const crypto = require('crypto');
const path = require('path');
const { createRequire } = require('module');
const BACKEND = process.env.SCOLA_BACKEND || path.join(__dirname, '..', '..', 'Application', 'Backend');
const backendRequire = createRequire(path.join(BACKEND, 'package.json'));
const express = backendRequire('express');
const C = backendRequire('./src/core');
const catalog = backendRequire('./src/catalog');
const { httpError, bcrypt, SECRET, jwt } = backendRequire('./src/auth');
const { classView, upload } = backendRequire('./src/api');
const { storeMedia } = backendRequire('./src/db');
const { data, save } = C;

const router = express.Router();

/* ---------------- Comptes administrateurs ---------------- */

const normEmail = (e) => String(e || '').trim().toLowerCase();
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function checkPassword(p) {
  if (String(p || '').length < 8) throw httpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
}
function adminView(a, me) {
  return { id: a.id, name: a.name, email: a.email, createdAt: a.createdAt, createdBy: a.createdBy ? (data.admins[a.createdBy]?.name || 'Administrateur supprimé') : null, lastLogin: a.lastLogin || null, mustChangePassword: !!a.mustChangePassword, me: a.id === me };
}

function createAdmin({ name, email, password, createdBy = null, mustChangePassword = false }) {
  email = normEmail(email);
  if (!validEmail(email)) throw httpError(400, 'Adresse e-mail invalide.');
  if (Object.values(data.admins).some(a => a.email === email)) throw httpError(400, 'Un administrateur utilise déjà cette adresse.');
  checkPassword(password);
  const id = C.uid('a_');
  data.admins[id] = {
    id, name: String(name || '').trim().slice(0, 60) || email.split('@')[0], email,
    passwordHash: bcrypt.hashSync(String(password), 10), createdAt: C.now(), createdBy, tokenVersion: 0, mustChangePassword,
  };
  save();
  return data.admins[id];
}

// Premier démarrage : un administrateur initial est créé et ses identifiants affichés.
(function ensureFirstAdmin() {
  if (Object.keys(data.admins).length) return;
  const email = process.env.SCOLA_ADMIN_EMAIL || 'daoudaprosperekone202@gmail.com';
  const fromEnv = !!process.env.SCOLA_ADMIN_PASSWORD;
  // Mot de passe initial provisoire : il doit être changé à la première connexion.
  const password = process.env.SCOLA_ADMIN_PASSWORD || '12345678';
  createAdmin({ name: 'Administrateur', email, password, mustChangePassword: !fromEnv });
  console.log('\n  ===== Administrateur Scola créé =====');
  console.log(`  E-mail       : ${email}`);
  console.log(`  Mot de passe : ${fromEnv ? '(celui de SCOLA_ADMIN_PASSWORD)' : password}`);
  console.log('  Espace admin : /admin  (changez ce mot de passe à la première connexion)');
  console.log('  Perdu ? Lancez : npm run admin:reset -- votre@email.com\n');
})();

/* ---------------- Connexion ---------------- */

const attempts = new Map(); // ip -> { n, until }
router.post('/login', (req, res) => {
  const ip = req.ip;
  const at = attempts.get(ip);
  if (at && at.until > C.now() && at.n >= 8) throw httpError(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
  const email = normEmail(req.body.email);
  const a = Object.values(data.admins).find(x => x.email === email);
  if (!a || !bcrypt.compareSync(String(req.body.password || ''), a.passwordHash)) {
    attempts.set(ip, { n: (at && at.until > C.now() ? at.n : 0) + 1, until: C.now() + 15 * 60e3 });
    throw httpError(401, 'E-mail ou mot de passe incorrect.');
  }
  attempts.delete(ip);
  a.lastLogin = C.now();
  save();
  res.json({ token: jwt.sign({ adm: a.id, v: a.tokenVersion }, SECRET, { expiresIn: '12h' }), admin: adminView(a, a.id) });
});

router.use((req, res, next) => {
  const h = req.headers.authorization || '';
  try {
    const p = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', SECRET);
    const a = p.adm && data.admins[p.adm];
    if (!a || a.tokenVersion !== p.v) throw new Error();
    req.admin = a;
  } catch { return res.status(401).json({ error: 'Session administrateur expirée. Reconnectez-vous.' }); }
  next();
});

router.get('/me', (req, res) => res.json(adminView(req.admin, req.admin.id)));

router.patch('/me', (req, res) => {
  const a = req.admin, b = req.body;
  const sensitive = b.email !== undefined || b.password !== undefined;
  if (sensitive && !bcrypt.compareSync(String(b.currentPassword || ''), a.passwordHash)) throw httpError(400, 'Mot de passe actuel incorrect.');
  if (b.name !== undefined) a.name = String(b.name).trim().slice(0, 60) || a.name;
  if (b.email !== undefined) {
    const e = normEmail(b.email);
    if (!validEmail(e)) throw httpError(400, 'Adresse e-mail invalide.');
    if (Object.values(data.admins).some(x => x.email === e && x.id !== a.id)) throw httpError(400, 'Adresse déjà utilisée.');
    a.email = e;
  }
  let token;
  if (b.password !== undefined) {
    checkPassword(b.password);
    a.passwordHash = bcrypt.hashSync(String(b.password), 10);
    a.mustChangePassword = false;
    a.tokenVersion++;
    token = jwt.sign({ adm: a.id, v: a.tokenVersion }, SECRET, { expiresIn: '12h' });
  }
  save();
  res.json({ admin: adminView(a, a.id), token });
});

/* ---------------- Gestion des administrateurs ---------------- */

router.get('/admins', (req, res) => res.json(Object.values(data.admins).sort((x, y) => x.createdAt - y.createdAt).map(a => adminView(a, req.admin.id))));

router.post('/admins', (req, res) => {
  const a = createAdmin({ ...req.body, createdBy: req.admin.id, mustChangePassword: true });
  res.json(adminView(a, req.admin.id));
});

router.patch('/admins/:id', (req, res) => {
  const a = data.admins[req.params.id];
  if (!a) throw httpError(404, 'Administrateur introuvable.');
  const b = req.body;
  if (b.name !== undefined) a.name = String(b.name).trim().slice(0, 60) || a.name;
  if (b.email !== undefined) {
    const e = normEmail(b.email);
    if (!validEmail(e)) throw httpError(400, 'Adresse e-mail invalide.');
    if (Object.values(data.admins).some(x => x.email === e && x.id !== a.id)) throw httpError(400, 'Adresse déjà utilisée.');
    a.email = e;
  }
  if (b.password) {
    checkPassword(b.password);
    a.passwordHash = bcrypt.hashSync(String(b.password), 10);
    a.tokenVersion++;
    if (a.id !== req.admin.id) a.mustChangePassword = true;
  }
  save();
  res.json(adminView(a, req.admin.id));
});

router.delete('/admins/:id', (req, res) => {
  const a = data.admins[req.params.id];
  if (!a) throw httpError(404, 'Administrateur introuvable.');
  if (a.id === req.admin.id) throw httpError(400, 'Vous ne pouvez pas supprimer votre propre compte administrateur.');
  if (Object.keys(data.admins).length <= 1) throw httpError(400, 'Il doit rester au moins un administrateur.');
  delete data.admins[a.id];
  save();
  res.json({ ok: true });
});

/* ---------------- Tableau de bord ---------------- */

router.get('/stats', (req, res) => {
  const users = Object.values(data.users).filter(u => !u.deleted);
  const day = 86400e3;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const signups = Array.from({ length: 14 }, (_, i) => {
    const start = today.getTime() - (13 - i) * day;
    return { day: start, count: users.filter(u => u.createdAt >= start && u.createdAt < start + day).length };
  });
  let messages = 0, messagesToday = 0;
  for (const list of Object.values(data.messages)) for (const m of list) { if (m.type === 'system') continue; messages++; if (m.createdAt >= today.getTime()) messagesToday++; }
  const classes = Object.values(data.classes);
  res.json({
    users: users.length,
    suspended: users.filter(u => u.suspended).length,
    online: users.filter(u => C.isOnline(u.id)).length,
    classes: classes.length,
    messages, messagesToday,
    statuses: Object.values(data.statuses).filter(s => s.expiresAt > C.now()).length,
    reportsPending: data.reports.filter(r => !r.resolved).length,
    admins: Object.keys(data.admins).length,
    signups,
    topClasses: classes.sort((a, b) => b.memberIds.length - a.memberIds.length).slice(0, 8).map(c => ({ id: c.id, name: c.name, country: c.country, members: c.memberIds.length })),
    recentUsers: users.sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map(userRow),
  });
});

/* ---------------- Utilisateurs ---------------- */

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function userRow(u) {
  const cls = data.classes[u.classId];
  return {
    id: u.id, name: u.name, phone: u.phone, avatar: u.avatar, school: u.school, about: u.about,
    classId: u.classId, className: cls?.name || '—', country: cls?.country || '',
    createdAt: u.createdAt, lastSeen: u.lastSeen, online: C.isOnline(u.id),
    suspended: u.suspended || null, hasPin: !!u.pinHash, restricted: !!cls?.restricted.includes(u.id),
  };
}

function getUser(id) {
  const u = data.users[id];
  if (!u || u.deleted) throw httpError(404, 'Utilisateur introuvable.');
  return u;
}

function kick(u) {
  const io = C.getIo();
  if (!io) return;
  io.to('u:' + u.id).emit('session:revoked');
  io.in('u:' + u.id).disconnectSockets(true);
}

router.get('/users', (req, res) => {
  const q = fold(req.query.q);
  let list = Object.values(data.users).filter(u => !u.deleted);
  if (q) list = list.filter(u => fold(u.name).includes(q) || u.phone.includes(q.replace(/\s/g, '')) || fold(u.school).includes(q));
  if (req.query.classId) list = list.filter(u => u.classId === req.query.classId);
  if (req.query.status === 'suspended') list = list.filter(u => u.suspended);
  if (req.query.status === 'online') list = list.filter(u => C.isOnline(u.id));
  list.sort((a, b) => b.createdAt - a.createdAt);
  const page = Math.max(0, Number(req.query.page) || 0);
  res.json({ total: list.length, page, users: list.slice(page * 50, page * 50 + 50).map(userRow) });
});

router.get('/users/:id', (req, res) => {
  const u = getUser(req.params.id);
  let messages = 0;
  for (const list of Object.values(data.messages)) for (const m of list) if (m.senderId === u.id) messages++;
  res.json({
    ...userRow(u),
    sessions: Object.values(data.sessions).filter(s => s.userId === u.id).sort((a, b) => b.lastActive - a.lastActive),
    messages,
    statuses: Object.values(data.statuses).filter(s => s.userId === u.id && s.expiresAt > C.now()).length,
    reportsAgainst: data.reports.filter(r => r.userId === u.id).length,
    blockedCount: (u.blocked || []).length,
  });
});

router.patch('/users/:id', (req, res) => {
  const u = getUser(req.params.id);
  const b = req.body;
  if (b.name !== undefined) {
    const n = String(b.name).trim().slice(0, 40);
    if (n.length < 2) throw httpError(400, 'Nom trop court.');
    u.name = n;
  }
  if (b.school !== undefined) u.school = String(b.school).trim().slice(0, 80);
  if (b.about !== undefined) u.about = String(b.about).slice(0, 139);
  if (b.removeAvatar) u.avatar = null;
  // Changement de classe (l'élève s'est trompé à l'inscription).
  if (b.country && b.cycle && b.filiere && b.niveau) {
    let r;
    try { r = catalog.resolve(b); } catch (e) { throw httpError(400, e.message); }
    const old = C.classOf(u);
    const { cls } = C.ensureClass(r);
    if (!old || old.id !== cls.id) {
      if (old) {
        old.memberIds = old.memberIds.filter(x => x !== u.id);
        old.restricted = old.restricted.filter(x => x !== u.id);
        C.systemMessage(old.id, `${u.name} a été transféré(e) dans une autre classe par l'administration`);
      }
      cls.memberIds.push(u.id);
      u.classId = cls.id;
      for (const s of Object.values(data.statuses)) if (s.userId === u.id) s.classId = cls.id;
      C.systemMessage(cls.id, `${u.name} a rejoint la classe`, { meta: { joined: u.id } });
      C.toUser(u.id, 'reload', { reason: 'class' });
    }
  }
  save();
  for (const id of C.classOf(u)?.memberIds || []) if (C.isOnline(id)) C.toUser(id, 'user:update', C.publicUser(u, id));
  res.json(userRow(u));
});

router.post('/users/:id/suspend', (req, res) => {
  const u = getUser(req.params.id);
  u.suspended = { at: C.now(), by: req.admin.id, reason: String(req.body.reason || '').slice(0, 300) };
  save();
  kick(u);
  res.json(userRow(u));
});

router.delete('/users/:id/suspend', (req, res) => {
  const u = getUser(req.params.id);
  delete u.suspended;
  save();
  res.json(userRow(u));
});

router.post('/users/:id/reset-pin', (req, res) => {
  const u = getUser(req.params.id);
  u.pinHash = null;
  u.pinHint = '';
  save();
  res.json(userRow(u));
});

router.post('/users/:id/logout', (req, res) => {
  const u = getUser(req.params.id);
  for (const s of Object.values(data.sessions)) if (s.userId === u.id) delete data.sessions[s.id];
  save();
  kick(u);
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const u = getUser(req.params.id);
  kick(u);
  C.deleteAccount(u, `${u.name} a été retiré(e) de Scola par l'administration`);
  res.json({ ok: true });
});

/* ---------------- Classes ---------------- */

function getClass(id) {
  const c = data.classes[id];
  if (!c) throw httpError(404, 'Classe introuvable.');
  return c;
}

function classRow(c) {
  const list = data.messages[c.id] || [];
  const last = [...list].reverse().find(m => m.type !== 'system');
  return {
    id: c.id, name: c.name, country: c.country, cycle: c.cycle, cycleLabel: c.cycleLabel, filiere: c.filiere, niveau: c.niveau,
    description: c.description, icon: c.icon, createdAt: c.createdAt, members: c.memberIds.length,
    online: c.memberIds.filter(id => C.isOnline(id)).length,
    messages: list.filter(m => m.type !== 'system').length, lastActivity: last?.createdAt || null,
    settings: c.settings, restricted: c.restricted, inviteCode: c.inviteCode,
    disappearing: data.chats[c.id]?.disappearing || 0,
    reportsPending: data.reports.filter(r => r.classId === c.id && !r.resolved).length,
  };
}

function pushClass(c) {
  for (const id of c.memberIds) if (C.isOnline(id)) C.toUser(id, 'class:update', classView(c, id));
}

router.get('/catalog', (req, res) => res.json({ countries: catalog.countries, cycles: catalog.cycles }));

router.get('/classes', (req, res) => {
  const q = fold(req.query.q);
  let list = Object.values(data.classes);
  if (q) list = list.filter(c => fold(`${c.name} ${c.filiere} ${c.niveau} ${c.country} ${c.cycleLabel}`).includes(q));
  if (req.query.country) list = list.filter(c => c.country === req.query.country);
  const sort = req.query.sort || 'members';
  const rows = list.map(classRow);
  rows.sort((a, b) => sort === 'recent' ? b.createdAt - a.createdAt : sort === 'activity' ? (b.lastActivity || 0) - (a.lastActivity || 0) : sort === 'name' ? a.name.localeCompare(b.name, 'fr') : b.members - a.members);
  res.json(rows);
});

router.get('/classes/:id', (req, res) => {
  const c = getClass(req.params.id);
  res.json({ ...classRow(c), members: c.memberIds.map(id => userRow(data.users[id])).sort((a, b) => a.name.localeCompare(b.name, 'fr')) });
});

const SETTING_LABELS = {
  readOnly: ['a fermé le groupe en écriture (seule l\'administration peut publier)', 'a rouvert le groupe à tous les membres'],
  membersEditInfo: ['autorise les membres à modifier les infos du groupe', 'réserve la modification des infos du groupe à l\'administration'],
  membersPin: ['autorise les membres à épingler des messages', 'a désactivé l\'épinglage de messages'],
};

router.patch('/classes/:id', (req, res) => {
  const c = getClass(req.params.id);
  const b = req.body;
  if (b.name !== undefined) {
    const n = String(b.name).trim().slice(0, 100);
    if (n.length < 3) throw httpError(400, 'Nom trop court.');
    if (n !== c.name) { c.name = n; C.systemMessage(c.id, `L'administration a renommé le groupe en « ${n} »`); }
  }
  if (b.description !== undefined && b.description !== c.description) {
    c.description = String(b.description).slice(0, 2048);
    C.systemMessage(c.id, 'L\'administration a modifié la description du groupe');
  }
  if (b.icon !== undefined) {
    if (b.icon !== null && !/^\/media\/[a-f0-9]{32}(\.[a-z0-9]{1,7})?$/.test(b.icon)) throw httpError(400, 'Image invalide.');
    c.icon = b.icon;
  }
  if (b.settings) {
    for (const k of Object.keys(SETTING_LABELS)) {
      if (typeof b.settings[k] === 'boolean' && b.settings[k] !== c.settings[k]) {
        c.settings[k] = b.settings[k];
        C.systemMessage(c.id, `L'administration ${SETTING_LABELS[k][b.settings[k] ? 0 : 1]}`);
      }
    }
  }
  if (b.disappearing !== undefined) {
    const s = Number(b.disappearing) || 0;
    if (![0, 86400, 604800, 7776000].includes(s)) throw httpError(400, 'Durée invalide.');
    const chat = data.chats[c.id];
    if (chat.disappearing !== s) {
      chat.disappearing = s;
      C.systemMessage(c.id, s ? `L'administration a activé les messages éphémères (${{ 86400: '24 heures', 604800: '7 jours', 7776000: '90 jours' }[s]})` : 'L\'administration a désactivé les messages éphémères');
      C.pushChat(chat);
    }
  }
  save();
  pushClass(c);
  res.json(classRow(c));
});

router.post('/classes/:id/restrict/:uid', (req, res) => {
  const c = getClass(req.params.id);
  const u = getUser(req.params.uid);
  if (u.classId !== c.id) throw httpError(400, 'Cet utilisateur n\'est pas dans cette classe.');
  if (!c.restricted.includes(u.id)) { c.restricted.push(u.id); C.systemMessage(c.id, `L'administration a restreint les messages de ${u.name}`); }
  save(); pushClass(c);
  res.json(classRow(c));
});

router.delete('/classes/:id/restrict/:uid', (req, res) => {
  const c = getClass(req.params.id);
  const u = data.users[req.params.uid];
  if (c.restricted.includes(req.params.uid)) {
    c.restricted = c.restricted.filter(x => x !== req.params.uid);
    if (u) C.systemMessage(c.id, `L'administration a rétabli les messages de ${u.name}`);
  }
  save(); pushClass(c);
  res.json(classRow(c));
});

router.post('/classes/:id/invite/reset', (req, res) => {
  const c = getClass(req.params.id);
  c.inviteCode = crypto.randomBytes(6).toString('base64url');
  save(); pushClass(c);
  res.json(classRow(c));
});

router.delete('/classes/:id', (req, res) => {
  const c = getClass(req.params.id);
  if (c.memberIds.length) throw httpError(400, 'Impossible de supprimer une classe qui a encore des membres. Transférez-les d\'abord.');
  for (const m of data.messages[c.id] || []) C.msgIndex.delete(m.id);
  delete data.messages[c.id];
  delete data.chats[c.id];
  delete data.classKeys[c.key];
  delete data.classes[c.id];
  save();
  res.json({ ok: true });
});

// Modération : derniers messages d'une classe.
router.get('/classes/:id/messages', (req, res) => {
  const c = getClass(req.params.id);
  let list = (data.messages[c.id] || []);
  if (req.query.before) list = list.filter(m => m.createdAt < Number(req.query.before));
  const slice = list.slice(-60);
  res.json({ hasMore: list.length > slice.length, messages: slice.map(msgRow) });
});

function msgRow(m) {
  return {
    id: m.id, chatId: m.chatId, type: m.type, createdAt: m.createdAt, senderId: m.senderId,
    senderName: m.senderId ? (data.users[m.senderId]?.name || 'Inconnu') : (m.meta?.announce ? `Administration (${m.meta.by})` : 'Scola'),
    text: m.deletedForAll ? null : C.snippet(m), media: !m.deletedForAll && !m.viewOnce ? m.media || null : null,
    deleted: !!m.deletedForAll, announce: !!m.meta?.announce, viewOnce: !!m.viewOnce,
  };
}

router.delete('/messages/:id', (req, res) => {
  const m = C.findMessage(req.params.id);
  if (!m) throw httpError(404, 'Message introuvable.');
  if (!m.deletedForAll) C.deleteForAll(m, 'admin:' + req.admin.id);
  res.json({ ok: true });
});

/* ---------------- Annonces ---------------- */

router.post('/announce', (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 4000);
  if (!text) throw httpError(400, 'Le texte de l\'annonce est vide.');
  const ids = req.body.classIds === 'all' ? Object.keys(data.classes) : (req.body.classIds || []).filter(id => data.classes[id]);
  if (!ids.length) throw httpError(400, 'Choisissez au moins une classe.');
  for (const id of ids) C.systemMessage(id, text, { meta: { announce: true, by: req.admin.name } });
  res.json({ ok: true, sent: ids.length });
});

/* ---------------- Signalements ---------------- */

router.get('/reports', (req, res) => {
  let list = [...data.reports].reverse();
  if (req.query.status === 'pending') list = list.filter(r => !r.resolved);
  if (req.query.status === 'resolved') list = list.filter(r => r.resolved);
  res.json(list.slice(0, 300).map(r => ({
    ...r,
    className: data.classes[r.classId]?.name || '—',
    byName: data.users[r.by]?.name || 'Inconnu',
    userName: r.userId ? (data.users[r.userId]?.name || 'Inconnu') : null,
    userSuspended: !!data.users[r.userId]?.suspended,
    messageDeleted: r.message ? !!C.findMessage(r.message.id)?.deletedForAll : false,
    resolvedByName: r.resolvedBy ? (data.admins[r.resolvedBy]?.name || '—') : null,
  })));
});

router.post('/reports/:id/resolve', (req, res) => {
  const r = data.reports.find(x => x.id === req.params.id);
  if (!r) throw httpError(404, 'Signalement introuvable.');
  r.resolved = !req.body.reopen;
  r.resolvedBy = r.resolved ? req.admin.id : null;
  r.resolvedAt = r.resolved ? C.now() : null;
  r.note = String(req.body.note || r.note || '').slice(0, 500);
  save();
  res.json(r);
});

/* ---------------- Statuts ---------------- */

router.get('/statuses', (req, res) => {
  res.json(Object.values(data.statuses).filter(s => s.expiresAt > C.now()).sort((a, b) => b.createdAt - a.createdAt).map(s => ({
    id: s.id, userId: s.userId, userName: data.users[s.userId]?.name || 'Inconnu', className: data.classes[s.classId]?.name || '—',
    type: s.type, text: s.text, bg: s.bg, caption: s.caption, media: s.media, createdAt: s.createdAt, expiresAt: s.expiresAt, views: Object.keys(s.views).length,
  })));
});

router.delete('/statuses/:id', (req, res) => {
  const s = data.statuses[req.params.id];
  if (!s) throw httpError(404, 'Statut introuvable.');
  delete data.statuses[s.id];
  save();
  C.toUsers(data.classes[s.classId]?.memberIds || [], 'status:remove', { id: s.id });
  res.json({ ok: true });
});

/* ---------------- Fichiers (icône de classe) ---------------- */

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) throw httpError(400, 'Aucun fichier reçu.');
  await storeMedia(req.file);
  res.json({ url: '/media/' + req.file.filename, name: req.file.originalname, size: req.file.size, mime: req.file.mimetype });
});

module.exports = { router, createAdmin };
