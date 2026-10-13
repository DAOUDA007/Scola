// Contacts du téléphone et groupes créés par les chefs de classe.
//
// Contacts : un élève peut écrire à une personne qui utilise Scola s'il connaît son numéro (contacts
// du téléphone ou numéro saisi), sauf si elle a choisi « ma classe seulement ». Hors de la classe,
// on ne voit ni le « vu à », ni les infos : seulement le nom et la photo (selon ses réglages).
//
// Groupes : un chef de classe (nommé par l'administration) demande la création d'un groupe avec des
// membres de sa classe ; le groupe n'existe qu'après validation par un administrateur.
const express = require('express');
const C = require('./donnees-classes-et-discussions');
const { requireAuth, httpError } = require('./connexion-inscription-sms');
const { data, save } = C;

(function migrate() {
  let changed = false;
  if (!data.teamRequests || typeof data.teamRequests !== 'object') { data.teamRequests = {}; changed = true; }
  for (const u of Object.values(data.users)) if (u.privacy && !u.privacy.contactable) { u.privacy.contactable = 'all'; changed = true; }
  if (changed) save();
})();

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const digits = (p) => String(p || '').replace(/\D/g, '');
const DIAL = { "Côte d'Ivoire": '225', 'Bénin': '229', 'Burkina Faso': '226', 'Cameroun': '237', 'Congo': '242', 'RD Congo': '243', 'Gabon': '241', 'Guinée': '224', 'Mali': '223', 'Niger': '227', 'Sénégal': '221', 'Tchad': '235', 'Togo': '228', 'Madagascar': '261', 'Maroc': '212', 'Tunisie': '216', 'Algérie': '213', 'France': '33', 'Belgique': '32', 'Canada': '1', 'Suisse': '41' };

// Numéro du carnet d'adresses → numéro international (indicatif du pays de la classe par défaut).
function intl(raw, me) {
  let d = digits(raw);
  if (String(raw).trim().startsWith('00')) d = d.slice(2);
  else if (!String(raw).trim().startsWith('+')) {
    const cc = DIAL[C.classOf(me)?.country] || '225';
    if (d.startsWith(cc) && d.length > 10) return '+' + d;
    d = cc + (cc === '33' || cc === '32' || cc === '41' ? d.replace(/^0/, '') : d);
  }
  return '+' + d;
}

const classmates = (a, b) => !!a && !!b && a.classId === b.classId;
// Personnes avec qui l'élève est déjà en relation : sa classe, ses discussions privées, ses groupes.
function related(me, otherId) {
  const o = data.users[otherId];
  if (!o || o.deleted) return false;
  if (otherId === me.id || classmates(me, o)) return true;
  if (data.chats[C.dmId(me.id, otherId)]) return true;
  return Object.values(data.chats).some(c => c.type === 'team' && c.members.includes(me.id) && c.members.includes(otherId));
}
function assertReachable(me, otherId) {
  if (!related(me, otherId)) throw httpError(403, 'Cette personne n\'est pas dans vos contacts Scola.');
  return data.users[otherId];
}
// Peut-on lui écrire grâce à son numéro ?
function contactable(me, o) {
  if (!o || o.deleted || o.suspended || o.id === me.id) return false;
  if (C.blocks(o.id, me.id) || C.blocks(me.id, o.id)) return false;
  return classmates(me, o) || o.privacy?.contactable !== 'class';
}

// Profils des personnes « en relation » hors de la classe (discussions privées, groupes).
function relatedProfiles(me) {
  const ids = new Set();
  for (const c of Object.values(data.chats)) {
    if (c.type === 'dm' && c.members.includes(me.id)) c.members.forEach(x => ids.add(x));
    if (c.type === 'team' && c.members.includes(me.id)) c.members.forEach(x => ids.add(x));
  }
  return [...ids].filter(id => id !== me.id && data.users[id] && data.users[id].classId !== me.classId).map(id => C.publicUser(data.users[id], me.id)).filter(Boolean);
}

// Limite de recherche par numéro (anti-aspiration) : 500 numéros par jour et par élève.
const lookups = new Map();
function quota(me, n) {
  const day = new Date().toISOString().slice(0, 10);
  const q = lookups.get(me.id);
  const used = q && q.day === day ? q.n : 0;
  if (used + n > 500) throw httpError(429, 'Trop de recherches aujourd\'hui. Réessayez demain.');
  lookups.set(me.id, { day, n: used + n });
}
function findByPhone(me, raw) {
  const p = intl(raw, me);
  const o = data.users[data.phones[p]];
  return contactable(me, o) ? o : null;
}

const router = express.Router();
router.use(requireAuth);

// Contacts du téléphone : qui utilise Scola ? (les numéros ne sont pas conservés)
router.post('/contacts/find', (req, res) => {
  const list = (Array.isArray(req.body.contacts) ? req.body.contacts : []).slice(0, 300);
  quota(req.user, list.reduce((n, c) => n + Math.min(3, (c.phones || []).length), 0));
  const out = new Map();
  for (const c of list) {
    for (const ph of (c.phones || []).slice(0, 3)) {
      const o = findByPhone(req.user, ph);
      if (o && !out.has(o.id)) out.set(o.id, { ...C.publicUser(o, req.user.id), contactName: clip(c.name, 60), classmate: o.classId === req.user.classId });
    }
  }
  res.json([...out.values()]);
});

// Démarrer une discussion avec un numéro.
router.post('/chats/dm-phone', (req, res) => {
  quota(req.user, 1);
  const o = findByPhone(req.user, req.body.phone);
  if (!o) throw httpError(404, 'Aucun élève ou étudiant joignable avec ce numéro sur Scola.');
  const chat = C.ensureDm(req.user.id, o.id);
  C.getUC(req.user.id, chat.id).hidden = false;
  save();
  res.json(C.chatSummary(chat, req.user.id));
});

/* ---------------- Groupes des chefs de classe ---------------- */

function teamOf(req) {
  const c = data.chats[req.params.id];
  if (!c || c.type !== 'team' || !c.members.includes(req.user.id)) throw httpError(404, 'Groupe introuvable.');
  return c;
}
const isLeader = (u) => !!u?.classLeader;
function validMembers(me, ids) {
  const cls = C.classOf(me);
  return [...new Set((ids || []).filter(id => id !== me.id && cls?.memberIds.includes(id) && !data.users[id]?.deleted))];
}

// Demande de création (chef de classe) : validée ou refusée par l'administration.
router.post('/teams/requests', (req, res) => {
  if (!isLeader(req.user)) throw httpError(403, 'Seul un chef de classe peut créer un groupe.');
  const name = clip(req.body.name, 60);
  if (name.length < 3) throw httpError(400, 'Donnez un nom au groupe (3 caractères minimum).');
  const members = validMembers(req.user, req.body.members);
  if (members.length < 2) throw httpError(400, 'Choisissez au moins 2 membres de votre classe.');
  if (members.length > 255) throw httpError(400, '255 membres au maximum.');
  if (Object.values(data.teamRequests).filter(r => r.by === req.user.id && r.status === 'pending').length >= 3) throw httpError(400, 'Vous avez déjà 3 demandes en attente.');
  const r = { id: C.uid('tr_'), by: req.user.id, classId: req.user.classId, name, description: clip(req.body.description, 300), members, at: C.now(), status: 'pending' };
  data.teamRequests[r.id] = r;
  save();
  res.json(r);
});
router.get('/teams/requests', (req, res) => {
  res.json(Object.values(data.teamRequests).filter(r => r.by === req.user.id).sort((a, b) => b.at - a.at).slice(0, 20));
});

// Le chef du groupe le renomme et gère ses membres (toujours dans sa classe).
router.patch('/teams/:id', (req, res) => {
  const c = teamOf(req);
  if (!c.admins.includes(req.user.id)) throw httpError(403, 'Seul le chef du groupe peut le modifier.');
  if (req.body.name !== undefined) { const n = clip(req.body.name, 60); if (n.length < 3) throw httpError(400, 'Nom trop court.'); c.name = n; }
  if (req.body.description !== undefined) c.description = clip(req.body.description, 300);
  const before = new Set(c.members);
  if (Array.isArray(req.body.add)) for (const id of validMembers(req.user, req.body.add)) if (!c.members.includes(id)) c.members.push(id);
  if (Array.isArray(req.body.remove)) c.members = c.members.filter(id => c.admins.includes(id) || !req.body.remove.includes(id));
  save();
  const added = c.members.filter(id => !before.has(id)), removed = [...before].filter(id => !c.members.includes(id));
  if (added.length) C.systemMessage(c.id, `${req.user.name} a ajouté ${added.map(id => data.users[id]?.name).join(', ')}`);
  if (removed.length) C.systemMessage(c.id, `${req.user.name} a retiré ${removed.map(id => data.users[id]?.name).join(', ')}`);
  C.toUsers([...new Set([...before, ...c.members])], 'chat:update', { id: c.id });
  res.json(C.chatSummary(c, req.user.id));
});
router.post('/teams/:id/leave', (req, res) => {
  const c = teamOf(req);
  if (c.admins.includes(req.user.id) && c.admins.length === 1 && c.members.length > 1) throw httpError(400, 'Vous êtes le chef de ce groupe : demandez à l\'administration de le supprimer ou de nommer un autre chef.');
  c.members = c.members.filter(x => x !== req.user.id);
  c.admins = c.admins.filter(x => x !== req.user.id);
  save();
  C.systemMessage(c.id, `${req.user.name} a quitté le groupe`);
  C.toUsers(c.members, 'chat:update', { id: c.id });
  res.json({ ok: true });
});

/* ---------------- Décisions de l'administration (appelées par admin.js) ---------------- */

function approve(r, admin) {
  if (r.status !== 'pending') throw httpError(400, 'Demande déjà traitée.');
  const leader = data.users[r.by];
  if (!leader || leader.deleted) throw httpError(400, 'Le chef de classe n\'existe plus.');
  const members = [...new Set([r.by, ...r.members.filter(id => data.users[id] && !data.users[id].deleted && data.users[id].classId === r.classId)])];
  const id = C.uid('t_');
  data.chats[id] = { id, type: 'team', name: r.name, description: r.description, classId: r.classId, members, admins: [r.by], createdBy: r.by, approvedBy: admin.id, createdAt: C.now(), disappearing: 0, pinnedMsgs: [] };
  data.messages[id] = [];
  Object.assign(r, { status: 'approved', chatId: id, handledBy: admin.id, handledAt: C.now() });
  save();
  C.systemMessage(id, `Groupe « ${r.name} » créé par ${leader.name}, chef de classe, et validé par l'administration de Scola`);
  for (const uid of members) C.toUser(uid, 'chat:update', { id });
  require('./annonces-et-avertissements').notify(r.by, `Votre groupe « ${r.name} » a été validé par l'administration. Il apparaît dans vos discussions.`);
  return data.chats[id];
}
function reject(r, admin, reason) {
  if (r.status !== 'pending') throw httpError(400, 'Demande déjà traitée.');
  reason = clip(reason, 300);
  Object.assign(r, { status: 'rejected', reason, handledBy: admin.id, handledAt: C.now() });
  save();
  require('./annonces-et-avertissements').notify(r.by, `Votre demande de groupe « ${r.name} » n'a pas été validée.${reason ? ' Motif : ' + reason : ''}`);
}
function removeTeam(id) {
  const c = data.chats[id];
  if (!c || c.type !== 'team') throw httpError(404, 'Groupe introuvable.');
  const members = c.members;
  delete data.chats[id];
  delete data.messages[id];
  save();
  C.toUsers(members, 'chat:removed', { id });
}

module.exports = { router, assertReachable, related, relatedProfiles, approve, reject, removeTeam };
