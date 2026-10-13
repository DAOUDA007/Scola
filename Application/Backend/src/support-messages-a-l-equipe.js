// Support : les élèves (Profil › Aide) et les établissements (Mon compte) écrivent à l'équipe Scola.
// Chaque demande est une conversation privée avec un sujet, traitée dans Administration › Support.
const express = require('express');
const C = require('./donnees-classes-et-discussions');
const push = require('./notifications-push');
const mail = require('./envoi-emails');
const { requireAuth, httpError } = require('./connexion-inscription-sms');
const { data, save } = C;

const TOPICS = {
  account: 'Compte ou connexion', class: 'Mauvaise classe', bug: 'Bug ou problème technique', abuse: 'Signaler un abus',
  payment: 'Paiement ou abonnement', suggestion: 'Suggestion', other: 'Autre',
};
const STATUS = { open: 'À traiter', pending: 'En attente de réponse', resolved: 'Résolue' };

(function migrate() {
  if (!data.tickets || typeof data.tickets !== 'object') { data.tickets = {}; save(); }
})();

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const isMedia = (u) => typeof u === 'string' && /^\/media\/[a-f0-9]{32}(\.[a-z0-9]{1,7})?$/.test(u);
function cleanFile(f) {
  if (!f) return null;
  if (!isMedia(f.url) || !/^(image\/|application\/pdf)/.test(String(f.mime || ''))) throw httpError(400, 'Pièce jointe invalide (image ou PDF).');
  return { url: f.url, name: clip(f.name, 120) || 'fichier', mime: String(f.mime).slice(0, 80), size: Number(f.size) || 0 };
}
function message(from, b, adminName) {
  const text = clip(b.text, 4000);
  const media = cleanFile(b.media);
  if (!text && !media) throw httpError(400, 'Message vide.');
  return { id: C.uid('sm_'), from, adminName: adminName || undefined, text, media, at: C.now() };
}

/* ---------------- Vues ---------------- */
function requester(t) {
  if (t.kind === 'school') {
    const s = data.schools[t.ownerId];
    return { kind: 'school', id: t.ownerId, name: s?.name || 'Établissement supprimé', email: s?.email || '', phone: s?.phone || '', logo: s?.logo || null };
  }
  const u = data.users[t.ownerId];
  const cls = data.classes[u?.classId];
  return { kind: 'user', id: t.ownerId, name: u?.name || 'Compte supprimé', phone: u?.phone || '', className: cls?.name || '—', avatar: u?.avatar || null };
}
function view(t, side) {
  const last = t.messages[t.messages.length - 1];
  const theirs = side === 'admin' ? (m) => m.from !== 'admin' : (m) => m.from === 'admin';
  const readAt = side === 'admin' ? t.readByAdminAt : t.readByOwnerAt;
  return {
    id: t.id, topic: t.topic, topicLabel: TOPICS[t.topic] || TOPICS.other, status: t.status, statusLabel: STATUS[t.status],
    createdAt: t.createdAt, updatedAt: t.updatedAt, unread: t.messages.filter(m => theirs(m) && m.at > (readAt || 0)).length,
    last: last ? { from: last.from, text: last.text || (last.media ? '📎 ' + last.media.name : ''), at: last.at } : null,
    ...(side === 'admin' ? { requester: requester(t) } : {}),
  };
}
const full = (t, side) => ({ ...view(t, side), messages: t.messages });

/* ---------------- Côté demandeur (élève ou établissement) ---------------- */
function listFor(kind, ownerId) {
  return Object.values(data.tickets).filter(t => t.kind === kind && t.ownerId === ownerId).sort((a, b) => b.updatedAt - a.updatedAt).map(t => view(t, 'owner'));
}
function create(kind, ownerId, b) {
  if (Object.values(data.tickets).filter(t => t.ownerId === ownerId && t.createdAt > C.now() - 86400e3).length >= 5) throw httpError(429, 'Vous avez déjà ouvert 5 demandes aujourd\'hui : complétez plutôt une demande existante.');
  const m = message(kind, b);
  const t = { id: C.uid('tk_'), kind, ownerId, topic: TOPICS[b.topic] ? b.topic : 'other', status: 'open', createdAt: m.at, updatedAt: m.at, messages: [m], readByOwnerAt: m.at, readByAdminAt: 0 };
  data.tickets[t.id] = t;
  save();
  notifyAdmins(t);
  return t;
}
function mine(kind, ownerId, id) {
  const t = data.tickets[id];
  if (!t || t.kind !== kind || t.ownerId !== ownerId) throw httpError(404, 'Demande introuvable.');
  return t;
}
function reply(t, kind, b) {
  const m = message(kind, b);
  t.messages.push(m);
  if (t.messages.length > 500) t.messages.splice(0, t.messages.length - 500);
  t.status = 'open';
  t.updatedAt = m.at;
  t.readByOwnerAt = m.at;
  save();
  notifyAdmins(t);
  return m;
}
const unreadCount = (kind, ownerId) => listFor(kind, ownerId).reduce((n, t) => n + t.unread, 0);

// Prévient les administrateurs connectés (badge mis à jour au prochain rafraîchissement).
function notifyAdmins(t) {
  const admins = Object.values(data.admins).map(a => a.email).filter(Boolean);
  if (admins.length && mail.configured()) {
    const r = requester(t);
    mail.send({ to: admins.join(','), subject: `Scola — support : ${TOPICS[t.topic]} (${r.name})`, text: `${r.name} a écrit à l'équipe Scola :\n\n${t.messages[t.messages.length - 1].text}\n\nRépondez dans l'administration, rubrique Support.` });
  }
}

/* ---------------- Côté administration ---------------- */
function adminList(status) {
  let list = Object.values(data.tickets);
  if (status) list = list.filter(t => t.status === status);
  const order = { open: 0, pending: 1, resolved: 2 };
  return list.sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt).slice(0, 300).map(t => view(t, 'admin'));
}
function adminGet(id) {
  const t = data.tickets[id];
  if (!t) throw httpError(404, 'Demande introuvable.');
  t.readByAdminAt = C.now();
  save();
  return full(t, 'admin');
}
function adminReply(id, admin, b) {
  const t = data.tickets[id];
  if (!t) throw httpError(404, 'Demande introuvable.');
  const m = message('admin', b, admin.name);
  t.messages.push(m);
  t.status = b.resolve ? 'resolved' : 'pending';
  t.updatedAt = m.at;
  t.readByAdminAt = m.at;
  save();
  // Réponse de l'équipe : notification à l'élève, e-mail à l'établissement.
  if (t.kind === 'user') {
    C.toUser(t.ownerId, 'support:reply', { id: t.id });
    push.sendTo(t.ownerId, { title: 'Équipe Scola', body: m.text || 'Nouvelle réponse à votre demande', tag: 'support-' + t.id, url: '/?support=' + t.id, at: m.at });
  } else {
    const s = data.schools[t.ownerId];
    if (s?.email) mail.send({ to: s.email, subject: 'Scola — réponse de l\'équipe Scola', text: `Bonjour,\n\n${m.text}\n\nRetrouvez l'échange dans votre espace établissement, rubrique Mon compte › Contacter l'équipe Scola.\n\nL'équipe Scola` });
  }
  return full(t, 'admin');
}
function adminStatus(id, status) {
  const t = data.tickets[id];
  if (!t) throw httpError(404, 'Demande introuvable.');
  if (!STATUS[status]) throw httpError(400, 'Statut invalide.');
  t.status = status;
  save();
  return full(t, 'admin');
}
function adminDelete(id) {
  if (!data.tickets[id]) throw httpError(404, 'Demande introuvable.');
  delete data.tickets[id];
  save();
}
const adminUnread = () => Object.values(data.tickets).filter(t => t.status === 'open').length;

/* ---------------- API des élèves (/api/support) ---------------- */
const router = express.Router();
router.use('/support', requireAuth);
router.get('/support', (req, res) => res.json({ tickets: listFor('user', req.user.id), topics: TOPICS }));
router.post('/support', (req, res) => res.json(full(create('user', req.user.id, req.body), 'owner')));
router.get('/support/:id', (req, res) => res.json(full(mine('user', req.user.id, req.params.id), 'owner')));
router.post('/support/:id/messages', (req, res) => { const t = mine('user', req.user.id, req.params.id); reply(t, 'user', req.body); res.json(full(t, 'owner')); });
router.post('/support/:id/read', (req, res) => { const t = mine('user', req.user.id, req.params.id); t.readByOwnerAt = C.now(); save(); res.json({ ok: true }); });

module.exports = { router, TOPICS, STATUS, listFor, create, mine, reply, full, unreadCount, adminList, adminGet, adminReply, adminStatus, adminDelete, adminUnread };
