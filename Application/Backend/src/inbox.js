// Annonces de l'administration et avertissements : une boîte de réception personnelle.
// Chaque élève y retrouve toutes les annonces qui le concernent (même s'il se connecte tard,
// après des centaines de messages dans sa classe) et les avertissements qui lui sont adressés.
// Les établissements reçoivent leurs avertissements dans leur espace (et par e-mail).
const express = require('express');
const C = require('./core');
const push = require('./push');
const mail = require('./mail');
const { requireAuth, httpError } = require('./auth');
const { data, save } = C;

const KEEP = 365 * 86400e3; // une annonce reste dans la boîte un an

(function migrate() {
  let changed = false;
  for (const k of ['announcements', 'notices']) if (!data[k] || typeof data[k] !== 'object') { data[k] = {}; changed = true; }
  // Annonces publiées avant la boîte de réception : retrouvées dans les groupes de classe et regroupées
  // (même texte, même auteur, publiées dans la même minute).
  if (!data.meta.inboxMigrated) {
    const groups = new Map();
    for (const [chatId, list] of Object.entries(data.messages)) {
      if (!data.classes[chatId]) continue;
      for (const m of list) {
        if (!m.meta?.announce || m.deletedForAll || m.meta.announcementId) continue;
        const key = `${m.meta.by}|${Math.floor(m.createdAt / 60000)}|${m.text}`;
        if (!groups.has(key)) groups.set(key, { text: m.text, at: m.createdAt, byName: m.meta.by, msgs: {} });
        groups.get(key).msgs[chatId] = m;
      }
    }
    for (const g of groups.values()) {
      const a = { id: C.uid('an_'), text: g.text, at: g.at, by: null, byName: g.byName, target: Object.keys(g.msgs), messages: {} };
      for (const [chatId, m] of Object.entries(g.msgs)) { a.messages[chatId] = m.id; m.meta.announcementId = a.id; }
      data.announcements[a.id] = a;
    }
    data.meta.inboxMigrated = true;
    changed = true;
  }
  if (changed) save();
})();

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const concerns = (a, u) => a.target === 'all' || (Array.isArray(a.target) && a.target.includes(u.classId));

function itemsFor(u) {
  const t = C.now();
  const out = [];
  for (const a of Object.values(data.announcements)) {
    if (a.deleted || t - a.at > KEEP || !concerns(a, u)) continue;
    out.push({ id: a.id, kind: 'announce', text: a.text, at: a.at, from: 'Administration Scola' });
  }
  for (const n of Object.values(data.notices)) {
    if (n.userId !== u.id || n.deleted) continue;
    out.push({ id: n.id, kind: 'warning', text: n.text, at: n.at, from: 'Administration Scola' });
  }
  return out.sort((a, b) => b.at - a.at);
}
function summary(u) {
  const items = itemsFor(u);
  return { items, readAt: u.inboxReadAt || 0, unread: items.filter(x => x.at > (u.inboxReadAt || 0)).length };
}

/* ---------------- Annonces ---------------- */

// Publication : dans la boîte personnelle de chaque élève concerné, et en carte dans le groupe de classe.
function publish(admin, text, classIds) {
  text = clip(text, 4000);
  if (!text) throw httpError(400, 'Le texte de l\'annonce est vide.');
  const all = classIds === 'all';
  const ids = all ? Object.keys(data.classes) : (classIds || []).filter(id => data.classes[id]);
  if (!ids.length) throw httpError(400, 'Choisissez au moins une classe.');
  const a = { id: C.uid('an_'), text, at: C.now(), by: admin.id, byName: admin.name, target: all ? 'all' : ids, messages: {} };
  data.announcements[a.id] = a;
  for (const id of ids) {
    const m = C.systemMessage(id, text, { meta: { announce: true, by: admin.name, announcementId: a.id } });
    a.messages[id] = m.id;
    push.notifyMessage(m);
  }
  save();
  const users = new Set(ids.flatMap(id => data.classes[id]?.memberIds || []));
  C.toUsers([...users], 'inbox:new', { id: a.id });
  return { announcement: a, sent: ids.length };
}

// Suppression : retirée des boîtes personnelles et des groupes de classe.
function remove(id) {
  const a = data.announcements[id];
  if (!a || a.deleted) throw httpError(404, 'Annonce introuvable.');
  a.deleted = true;
  a.deletedAt = C.now();
  for (const [chatId, mid] of Object.entries(a.messages || {})) {
    const m = C.findMessage(mid);
    if (!m) continue;
    C.removeMessage(m);
    const chat = data.chats[chatId];
    if (chat) C.toUsers(C.chatMembers(chat), 'msg:remove', { chatId, id: mid });
  }
  save();
  const users = a.target === 'all' ? Object.keys(data.users) : [...new Set(a.target.flatMap(c => data.classes[c]?.memberIds || []))];
  C.toUsers(users, 'inbox:remove', { id });
  return a;
}

function adminList() {
  return Object.values(data.announcements).filter(a => !a.deleted).sort((a, b) => b.at - a.at).slice(0, 200).map(a => ({
    id: a.id, text: a.text, at: a.at, byName: a.byName,
    target: a.target === 'all' ? 'Toutes les classes' : a.target.map(c => data.classes[c]?.name || 'classe supprimée').join(', '),
    classes: a.target === 'all' ? Object.keys(data.classes).length : a.target.length,
  }));
}

/* ---------------- Avertissements ---------------- */

const DEFAULT_WARNING = 'Un signalement a été fait à votre sujet. Merci de respecter les règles de Scola : respect des autres, pas de contenus inappropriés ni trompeurs. En cas de récidive, votre compte pourra être suspendu.';

function warn(admin, { userId, schoolId, text, reportId }) {
  text = clip(text, 2000) || DEFAULT_WARNING;
  const n = { id: C.uid('nt_'), kind: 'warning', text, at: C.now(), by: admin.id, byName: admin.name, reportId: reportId || null };
  if (userId) {
    const u = data.users[userId];
    if (!u || u.deleted) throw httpError(404, 'Utilisateur introuvable.');
    n.userId = u.id;
    data.notices[n.id] = n;
    save();
    C.toUser(u.id, 'inbox:new', { id: n.id, warning: true });
    push.sendTo(u.id, { title: 'Avertissement de l\'administration Scola', body: text, tag: 'warn-' + n.id, url: '/?inbox=1', at: n.at });
  } else if (schoolId) {
    const s = data.schools[schoolId];
    if (!s) throw httpError(404, 'Établissement introuvable.');
    n.schoolId = s.id;
    data.notices[n.id] = n;
    save();
    if (s.email) mail.send({ to: s.email, subject: 'Scola — avertissement de l\'administration', text: `Bonjour,\n\n${text}\n\nVous retrouvez cet avertissement dans votre espace établissement.\n\nL'équipe Scola` });
  } else throw httpError(400, 'Destinataire manquant.');
  const r = reportId && data.reports.find(x => x.id === reportId);
  if (r) { r.warnedAt = n.at; r.warnedBy = admin.id; save(); }
  return n;
}

function noticesOf({ userId, schoolId }) {
  return Object.values(data.notices).filter(n => (userId && n.userId === userId) || (schoolId && n.schoolId === schoolId))
    .sort((a, b) => b.at - a.at).map(n => ({ id: n.id, text: n.text, at: n.at, byName: n.byName, readAt: n.readAt || null }));
}

/* ---------------- API des élèves ---------------- */

const router = express.Router();
router.get('/inbox', requireAuth, (req, res) => res.json(summary(req.user)));
router.post('/inbox/read', requireAuth, (req, res) => {
  req.user.inboxReadAt = C.now();
  save();
  res.json({ ok: true });
});

module.exports = { router, publish, remove, adminList, warn, noticesOf, summary, DEFAULT_WARNING };
