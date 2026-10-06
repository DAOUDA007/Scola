// Logique métier partagée entre l'API REST et le temps réel.
const crypto = require('crypto');
const { data, save } = require('./db');

let io = null;
const online = new Map(); // id utilisateur -> nombre de sockets connectés

const uid = (p = '') => p + crypto.randomBytes(9).toString('base64url');
const now = () => Date.now();

function setIo(server) { io = server; }
function getIo() { return io; }
function isOnline(id) { return (online.get(id) || 0) > 0; }

/* ---------- Utilisateurs ---------- */

function defaultPrivacy() {
  return {
    lastSeen: 'all',     // all | nobody (réciproque, comme WhatsApp)
    avatar: 'all',       // all | nobody
    about: 'all',        // all | nobody
    phone: 'all',        // all | nobody (adaptation éducative : masquer son numéro)
    readReceipts: true,  // accusés de lecture (discussions privées)
    status: { mode: 'all', list: [] }, // all | except | only
  };
}

function defaultSettings() {
  return {
    theme: 'system',
    wallpaper: null,
    fontSize: 'medium',
    enterToSend: true,
    notifications: { messages: true, groups: true, calls: true, status: true, sound: true, preview: true },
    mutedStatuses: [],
    archiveKeep: true,
  };
}

function classOf(user) { return user && data.classes[user.classId]; }

/* ---------- Classes ---------- */

// Réglages d'une classe, fixés uniquement par l'administration du site.
function defaultClassSettings() {
  return { readOnly: false, membersEditInfo: false, membersPin: true };
}

// Retrouve la classe correspondant à un parcours (catalog.resolve) ou la crée.
function ensureClass(r) {
  let id = data.classKeys[r.key];
  if (id && data.classes[id]) return { cls: data.classes[id], created: false };
  id = uid('c_');
  data.classKeys[r.key] = id;
  data.classes[id] = {
    id, key: r.key, country: r.country, cycle: r.cycle, cycleLabel: r.cycleLabel,
    filiere: r.filiere, niveau: r.niveau, name: r.name,
    description: `Groupe officiel de tous les élèves et étudiants « ${r.filiere} · ${r.niveau} » — ${r.country}. Partagez cours, devoirs, annonces et entraidez-vous !`,
    icon: null, createdAt: now(), memberIds: [], restricted: [],
    settings: defaultClassSettings(),
    inviteCode: crypto.randomBytes(6).toString('base64url'),
  };
  data.chats[id] = { id, type: 'group', createdAt: now(), disappearing: 0, pinnedMsgs: [] };
  data.messages[id] = [];
  save();
  return { cls: data.classes[id], created: true };
}

// Migration : les anciennes données avaient des « délégués » par classe.
(function migrate() {
  let changed = false;
  for (const c of Object.values(data.classes)) {
    if (c.adminIds || !('readOnly' in (c.settings || {}))) {
      const s = c.settings || {};
      c.settings = { readOnly: !!s.onlyAdminsSend, membersEditInfo: s.onlyAdminsEditInfo === false, membersPin: !s.onlyAdminsPin };
      delete c.adminIds;
      changed = true;
    }
    c.restricted ||= [];
  }
  data.admins ||= {};
  if (changed) save();
})();

function blocks(a, b) {
  const u = data.users[a];
  return !!u && (u.blocked || []).includes(b);
}

function publicUser(u, viewerId) {
  if (!u) return null;
  const self = u.id === viewerId;
  if (u.deleted) return { id: u.id, name: 'Compte supprimé', deleted: true };
  const viewer = data.users[viewerId];
  const p = u.privacy;
  const hiddenFromViewer = blocks(u.id, viewerId);
  const out = {
    id: u.id,
    name: u.name,
    school: u.school || '',
    classId: u.classId,
    joinedAt: u.createdAt,
    avatar: self || (p.avatar === 'all' && !hiddenFromViewer) ? u.avatar : null,
    about: self || (p.about === 'all' && !hiddenFromViewer) ? u.about : null,
    phone: self || p.phone === 'all' ? u.phone : null,
  };
  const reciprocal = viewer && viewer.privacy.lastSeen === 'all';
  if (self || (p.lastSeen === 'all' && reciprocal && !hiddenFromViewer)) {
    out.online = isOnline(u.id);
    out.lastSeen = u.lastSeen;
  }
  return out;
}

/* ---------- Discussions ---------- */

function dmId(a, b) { return 'dm_' + [a, b].sort().join('_'); }

function chatMembers(chat) {
  if (chat.type === 'group') return data.classes[chat.id]?.memberIds || [];
  return chat.members;
}

function canAccess(chat, userId) {
  if (!chat) return false;
  if (chat.type === 'broadcast') return chat.ownerId === userId;
  return chatMembers(chat).includes(userId);
}

function getUC(userId, chatId) {
  const all = (data.userChats[userId] ||= {});
  return (all[chatId] ||= {
    pinned: false, archived: false, favorite: false, mutedUntil: 0, markedUnread: false,
    lastReadAt: 0, clearedAt: 0, hidden: false, wallpaper: null,
  });
}

function ensureDm(a, b) {
  const id = dmId(a, b);
  if (!data.chats[id]) {
    data.chats[id] = { id, type: 'dm', members: [a, b].sort(), createdAt: now(), disappearing: 0, pinnedMsgs: [] };
    data.messages[id] = [];
    save();
  }
  return data.chats[id];
}

function findMessage(id) {
  // Index en mémoire des messages par identifiant.
  const hit = msgIndex.get(id);
  if (hit) return hit;
  return null;
}
const msgIndex = new Map();
function indexAll() {
  msgIndex.clear();
  for (const list of Object.values(data.messages)) for (const m of list) msgIndex.set(m.id, m);
}
indexAll();

/* ---------- Messages ---------- */

function snippet(m) {
  if (!m) return '';
  if (m.deletedForAll) return 'Ce message a été supprimé';
  switch (m.type) {
    case 'image': return '📷 ' + (m.text || 'Photo');
    case 'video': return '🎥 ' + (m.text || 'Vidéo');
    case 'audio': return '🎵 ' + (m.media?.name || 'Audio');
    case 'voice': return '🎤 Message vocal';
    case 'document': return '📄 ' + (m.media?.name || 'Document');
    case 'location': return '📍 ' + (m.location?.live ? 'Position en direct' : 'Position');
    case 'contact': return '👤 ' + (m.contact?.name || 'Contact');
    case 'poll': return '📊 ' + (m.poll?.question || 'Sondage');
    case 'event': return '📅 ' + (m.event?.title || 'Évènement');
    case 'sticker': return m.text || 'Autocollant';
    case 'system': return m.text;
    default: return m.text || '';
  }
}

function deliveryStatus(m) {
  const r = m.recipients || [];
  if (!r.length) return 'sent';
  if (r.every(x => m.readBy[x])) return 'read';
  if (r.every(x => m.deliveredTo[x])) return 'delivered';
  return 'sent';
}

function msgView(m, viewerId) {
  if (!m) return null;
  if ((m.deletedFor || []).includes(viewerId)) return null;
  const uc = getUC(viewerId, m.chatId);
  if (uc.clearedAt && m.createdAt <= uc.clearedAt) return null;
  const base = {
    id: m.id, chatId: m.chatId, senderId: m.senderId, type: m.type, createdAt: m.createdAt,
    expiresAt: m.expiresAt || null,
    meta: m.meta || undefined,
    starred: (m.starredBy || []).includes(viewerId),
    pinned: !!(data.chats[m.chatId]?.pinnedMsgs || []).find(p => p.id === m.id && p.until > now()),
  };
  if (m.senderId === viewerId) {
    base.status = deliveryStatus(m);
    if (m.clientId) base.clientId = m.clientId;
  }
  if (m.deletedForAll) return { ...base, type: 'deleted', deleted: true };
  Object.assign(base, {
    text: m.text || '',
    media: m.media || null,
    replyTo: m.replyTo || null,
    forwarded: !!m.forwarded,
    frequentlyForwarded: (m.forwardCount || 0) >= 4,
    editedAt: m.editedAt || null,
    mentions: m.mentions || [],
    reactions: m.reactions || {},
    location: m.location || null,
    contact: m.contact || null,
    poll: m.poll || null,
    event: m.event || null,
    statusRef: m.statusRef || null,
    viewOnce: !!m.viewOnce,
    linkPreview: m.linkPreview || null,
  });
  if (m.viewOnce) {
    const opened = (m.viewedBy || []).length > 0;
    base.opened = m.senderId === viewerId ? opened : (m.viewedBy || []).includes(viewerId);
    if (m.senderId === viewerId || base.opened) base.media = null;
  }
  return base;
}

function visibleMessages(chatId, viewerId) {
  return (data.messages[chatId] || []).filter(m => !(m.deletedFor || []).includes(viewerId));
}

function chatSummary(chat, viewerId) {
  const uc = getUC(viewerId, chat.id);
  const list = data.messages[chat.id] || [];
  let last = null;
  let unread = 0;
  let mentioned = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const v = msgView(list[i], viewerId);
    if (!v) continue;
    if (!last) last = v;
    if (list[i].createdAt <= uc.lastReadAt) break;
    if (list[i].senderId !== viewerId && (list[i].type !== 'system' || list[i].meta?.announce)) {
      unread++;
      if ((list[i].mentions || []).includes(viewerId)) mentioned = true;
    }
  }
  const out = {
    id: chat.id, type: chat.type, createdAt: chat.createdAt, disappearing: chat.disappearing || 0,
    last: last && { ...last, preview: snippet(list.find(x => x.id === last.id)) },
    unread, mentioned, state: uc,
    pinnedMsgs: (chat.pinnedMsgs || []).filter(p => p.until > now()).map(p => p.id),
  };
  if (chat.type === 'dm') out.peerId = chat.members.find(x => x !== viewerId) || viewerId;
  if (chat.type === 'broadcast') { out.name = chat.name; out.recipients = chat.recipients; }
  return out;
}

/* ---------- Diffusion temps réel ---------- */

function toUser(userId, ev, payload) { if (io) io.to('u:' + userId).emit(ev, payload); }
function toUsers(ids, ev, payload) { if (io && ids.length) io.to(ids.map(i => 'u:' + i)).emit(ev, payload); }

// Envoie à chaque membre connecté sa propre vue du message.
function pushMessage(m, ev = 'msg:new') {
  const chat = data.chats[m.chatId];
  if (!chat) return;
  const ids = chat.type === 'broadcast' ? [chat.ownerId] : chatMembers(chat);
  for (const id of ids) {
    if (!isOnline(id)) continue;
    const v = msgView(m, id);
    if (v) toUser(id, ev, v);
  }
}

function pushChat(chat, userIds) {
  for (const id of userIds || chatMembers(chat)) if (isOnline(id)) toUser(id, 'chat:update', chatSummary(chat, id));
}

function systemMessage(chatId, text, extra = {}) {
  const m = {
    id: uid('m_'), chatId, senderId: null, type: 'system', text, createdAt: now(),
    recipients: [], deliveredTo: {}, readBy: {}, reactions: {}, deletedFor: [], starredBy: [], viewedBy: [], ...extra,
  };
  (data.messages[chatId] ||= []).push(m);
  msgIndex.set(m.id, m);
  save();
  pushMessage(m);
  return m;
}

// Suppression d'un compte (par l'utilisateur lui-même ou par l'administration).
function deleteAccount(u, note) {
  const cls = classOf(u);
  u.deleted = true;
  u.avatar = null;
  u.about = '';
  delete data.phones[u.phone];
  if (cls) {
    cls.memberIds = cls.memberIds.filter(x => x !== u.id);
    cls.restricted = cls.restricted.filter(x => x !== u.id);
  }
  for (const s of Object.values(data.statuses)) if (s.userId === u.id) delete data.statuses[s.id];
  for (const s of Object.values(data.sessions)) if (s.userId === u.id) { delete data.sessions[s.id]; io?.to('s:' + s.id).emit('session:revoked'); }
  save();
  if (cls) systemMessage(cls.id, note || `${u.name} a quitté Scola`);
}

// Suppression « pour tout le monde » (par l'auteur ou par l'administration).
function deleteForAll(m, by) {
  m.deletedForAll = true;
  m.deletedBy = by;
  for (const k of ['text', 'media', 'poll', 'location', 'contact', 'event', 'replyTo', 'linkPreview']) delete m[k];
  m.reactions = {};
  const chat = data.chats[m.chatId];
  if (chat) chat.pinnedMsgs = (chat.pinnedMsgs || []).filter(p => p.id !== m.id);
  save();
  pushMessage(m, 'msg:update');
}

function removeMessage(m) {
  const list = data.messages[m.chatId] || [];
  const i = list.indexOf(m);
  if (i >= 0) list.splice(i, 1);
  msgIndex.delete(m.id);
}

/* ---------- Nettoyage périodique : messages éphémères, statuts, codes ---------- */

function sweep() {
  const t = now();
  let changed = false;
  for (const [chatId, list] of Object.entries(data.messages)) {
    const expired = list.filter(m => m.expiresAt && m.expiresAt <= t);
    if (!expired.length) continue;
    const chat = data.chats[chatId];
    for (const m of expired) {
      removeMessage(m);
      if (chat) toUsers(chat.type === 'broadcast' ? [chat.ownerId] : chatMembers(chat), 'msg:remove', { chatId, id: m.id });
    }
    changed = true;
  }
  for (const s of Object.values(data.statuses)) {
    if (s.expiresAt <= t) { delete data.statuses[s.id]; changed = true; toUsers(data.classes[s.classId]?.memberIds || [], 'status:remove', { id: s.id }); }
  }
  for (const [k, v] of Object.entries(data.otps)) if (v.expires <= t) { delete data.otps[k]; changed = true; }
  for (const [k, v] of Object.entries(data.linkCodes)) if (v.expires <= t) { delete data.linkCodes[k]; changed = true; }
  if (changed) save();
}
setInterval(sweep, 20_000).unref();

const activeCalls = new Map(); // appels en cours (mémoire uniquement)

module.exports = {
  data, save, uid, now, setIo, getIo, online, isOnline, activeCalls,
  defaultPrivacy, defaultSettings, defaultClassSettings, ensureClass, classOf, blocks, publicUser,
  dmId, chatMembers, canAccess, getUC, ensureDm, findMessage, msgIndex,
  snippet, deliveryStatus, msgView, visibleMessages, chatSummary,
  toUser, toUsers, pushMessage, pushChat, systemMessage, removeMessage, deleteForAll, deleteAccount,
};
