const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { UPLOADS, storeMedia } = require('./db');
const C = require('./core');
const push = require('./push');
const { requireAuth, httpError, bcrypt } = require('./auth');
const { data, save } = C;

const router = express.Router();
router.use(requireAuth);

const MAX_UPLOAD = 100 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: MAX_UPLOAD },
});

/* ---------------- Utilitaires ---------------- */

function getChat(req, id = req.params.id) {
  const chat = data.chats[id];
  if (!C.canAccess(chat, req.user.id)) throw httpError(404, 'Discussion introuvable.');
  return chat;
}

function getMsg(req, id = req.params.id) {
  const m = C.findMessage(id);
  if (!m) throw httpError(404, 'Message introuvable.');
  const chat = getChat(req, m.chatId);
  if ((m.deletedFor || []).includes(req.user.id)) throw httpError(404, 'Message introuvable.');
  return { m, chat };
}

function classmates(user) { return C.classOf(user)?.memberIds || []; }

function assertClassmate(user, otherId) {
  if (otherId !== user.id && !classmates(user).includes(otherId)) throw httpError(403, 'Cette personne n\'est pas dans votre classe.');
  const o = data.users[otherId];
  if (!o || o.deleted) throw httpError(404, 'Utilisateur introuvable.');
  return o;
}

function pushUser(u) {
  for (const id of classmates(u)) if (C.isOnline(id)) C.toUser(id, 'user:update', C.publicUser(u, id));
}

function selfView(u) {
  return { ...C.publicUser(u, u.id), phone: u.phone, privacy: u.privacy, settings: u.settings, blocked: u.blocked, hasPin: !!u.pinHash, pinHint: u.pinHint || '' };
}

function isMedia(u) { return typeof u === 'string' && /^\/media\/[a-f0-9]{32}(\.[a-z0-9]{1,7})?$/.test(u); }

function cleanMedia(md) {
  if (!md || !isMedia(md.url)) throw httpError(400, 'Fichier invalide.');
  return {
    url: md.url,
    name: String(md.name || 'fichier').slice(0, 200),
    size: Math.max(0, Number(md.size) || 0),
    mime: String(md.mime || 'application/octet-stream').slice(0, 100),
    duration: Number(md.duration) || undefined,
    width: Number(md.width) || undefined,
    height: Number(md.height) || undefined,
    waveform: Array.isArray(md.waveform) ? md.waveform.slice(0, 64).map(n => Math.max(0, Math.min(1, Number(n) || 0))) : undefined,
    hd: !!md.hd || undefined,
  };
}

/* ---------------- Envoi de messages ---------------- */

const TYPES = ['text', 'image', 'video', 'audio', 'voice', 'document', 'location', 'contact', 'poll', 'event', 'sticker'];

function assertCanSend(user, chat) {
  if (chat.type === 'group') {
    const cls = data.classes[chat.id];
    if (cls.restricted.includes(user.id)) throw httpError(403, 'L\'administration a restreint vos messages dans ce groupe.');
    if (cls.settings.readOnly) throw httpError(403, 'L\'administration a temporairement fermé ce groupe en écriture.');
  } else if (chat.type === 'dm') {
    const peer = chat.members.find(x => x !== user.id);
    if (peer && C.blocks(user.id, peer)) throw httpError(403, 'Vous avez bloqué ce contact. Débloquez-le pour lui écrire.');
    if (peer && data.users[peer]?.deleted) throw httpError(403, 'Ce compte a été supprimé.');
  }
}

function buildContent(user, chat, b) {
  const type = TYPES.includes(b.type) ? b.type : 'text';
  const c = { type, text: String(b.text || '').slice(0, 65536) };
  const members = chat.type === 'broadcast' ? [user.id, ...chat.recipients] : C.chatMembers(chat);
  switch (type) {
    case 'text':
    case 'sticker':
      if (!c.text.trim()) throw httpError(400, 'Message vide.');
      break;
    case 'image': case 'video': case 'audio': case 'voice': case 'document':
      c.media = cleanMedia(b.media);
      c.viewOnce = !!b.viewOnce && ['image', 'video', 'voice'].includes(type);
      break;
    case 'location': {
      const lat = Number(b.location?.lat), lng = Number(b.location?.lng);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw httpError(400, 'Position invalide.');
      c.location = { lat, lng, label: String(b.location.label || '').slice(0, 120), live: !!b.location.live, liveUntil: b.location.live ? C.now() + Math.min(8 * 3600e3, Number(b.location.liveMinutes || 15) * 60e3) : undefined };
      break;
    }
    case 'contact': {
      const o = assertClassmate(user, b.contact?.userId);
      c.contact = { userId: o.id, name: o.name, phone: o.privacy.phone === 'all' ? o.phone : null };
      break;
    }
    case 'poll': {
      const q = String(b.poll?.question || '').trim().slice(0, 255);
      const opts = (b.poll?.options || []).map(x => String(x || '').trim().slice(0, 100)).filter(Boolean).slice(0, 12);
      if (!q || opts.length < 2) throw httpError(400, 'Un sondage demande une question et au moins 2 options.');
      c.poll = { question: q, multiple: !!b.poll.multiple, options: opts.map(text => ({ id: C.uid('o'), text, votes: [] })) };
      break;
    }
    case 'event': {
      const title = String(b.event?.title || '').trim().slice(0, 120);
      const startsAt = Number(new Date(b.event?.startsAt));
      if (!title || !startsAt) throw httpError(400, 'Un évènement demande un titre et une date.');
      c.event = {
        title, startsAt, endsAt: Number(new Date(b.event.endsAt)) || null,
        description: String(b.event.description || '').slice(0, 1000),
        place: String(b.event.place || '').slice(0, 200),
        kind: ['cours', 'devoir', 'examen', 'reunion', 'sortie', 'autre'].includes(b.event.kind) ? b.event.kind : 'autre',
        responses: {},
      };
      break;
    }
  }
  c.mentions = Array.isArray(b.mentions) ? [...new Set(b.mentions)].filter(x => members.includes(x)).slice(0, 50) : [];
  if (b.replyTo) {
    const r = C.findMessage(b.replyTo);
    if (r && r.chatId === chat.id && !r.deletedForAll) {
      c.replyTo = { id: r.id, senderId: r.senderId, type: r.type, text: C.snippet(r).slice(0, 200), thumb: r.type === 'image' && !r.viewOnce ? r.media?.url : null };
    }
  }
  return c;
}

function insertMessage(user, chat, content, extra = {}) {
  const t = C.now();
  let recipients = [];
  const deletedFor = [];
  if (chat.type === 'group') recipients = C.chatMembers(chat).filter(x => x !== user.id);
  else if (chat.type === 'dm') {
    recipients = chat.members.filter(x => x !== user.id);
    // Un contact qui vous a bloqué ne reçoit rien (le message reste à une coche).
    for (const r of [...recipients]) if (C.blocks(r, user.id)) { deletedFor.push(r); recipients = recipients.filter(x => x !== r); }
  }
  const m = {
    id: C.uid('m_'), chatId: chat.id, senderId: user.id, createdAt: t,
    ...content, ...extra,
    recipients, deliveredTo: {}, readBy: {}, reactions: {}, starredBy: [], deletedFor, viewedBy: [],
  };
  if (chat.disappearing) m.expiresAt = t + chat.disappearing * 1000;
  for (const r of recipients) if (C.isOnline(r)) m.deliveredTo[r] = t;
  (data.messages[chat.id] ||= []).push(m);
  C.msgIndex.set(m.id, m);
  // La discussion réapparaît pour tous (sauf archives conservées).
  for (const id of chat.type === 'broadcast' ? [user.id] : C.chatMembers(chat)) {
    const uc = C.getUC(id, chat.id);
    uc.hidden = false;
    if (uc.archived && !data.users[id]?.settings.archiveKeep && id !== user.id) uc.archived = false;
  }
  const uc = C.getUC(user.id, chat.id);
  uc.lastReadAt = t;
  uc.markedUnread = false;
  save();
  C.pushMessage(m);
  push.notifyMessage(m);
  if (m.type === 'text' && !m.viewOnce) fetchPreview(m);
  return m;
}

function sendTo(user, chat, body, extra) {
  assertCanSend(user, chat);
  const content = buildContent(user, chat, body);
  if (chat.type !== 'broadcast') return insertMessage(user, chat, content, extra);
  // Liste de diffusion : copie privée à chaque destinataire, comme WhatsApp.
  const m = insertMessage(user, chat, content, extra);
  for (const r of chat.recipients) {
    const o = data.users[r];
    if (!o || o.deleted || o.classId !== user.classId || C.blocks(user.id, r)) continue;
    insertMessage(user, C.ensureDm(user.id, r), { ...content, mentions: [] }, extra);
  }
  return m;
}

/* Aperçu de lien (titre, description, image) récupéré côté serveur. */
function isPrivateHost(h) {
  return /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd])/i.test(h) || !h.includes('.');
}
async function fetchPreview(m) {
  const url = /(https?:\/\/[^\s<>"']+)/i.exec(m.text)?.[1];
  if (!url) return;
  try {
    const u = new URL(url);
    if (isPrivateHost(u.hostname)) return;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(u, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'ScolaBot/1.0 (+aperçu de lien)' } });
    clearTimeout(to);
    if (!r.ok || !(r.headers.get('content-type') || '').includes('text/html')) return;
    const html = (await r.text()).slice(0, 300_000);
    const meta = (p) => {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*>`, 'i');
      const tag = re.exec(html)?.[0];
      return tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
    };
    const decode = s => s && s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const title = decode(meta('og:title') || /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]);
    if (!title) return;
    let image = meta('og:image');
    if (image) { try { image = new URL(image, u).href; if (!/^https:/.test(image)) image = null; } catch { image = null; } }
    m.linkPreview = { url, title: title.slice(0, 200), description: (decode(meta('og:description') || meta('description')) || '').slice(0, 300), image, site: u.hostname.replace(/^www\./, '') };
    if (C.findMessage(m.id) && !m.deletedForAll) { save(); C.pushMessage(m, 'msg:update'); }
  } catch { /* aperçu facultatif */ }
}

/* ---------------- Démarrage de l'application ---------------- */

function myChats(user) {
  const out = [];
  const cls = C.classOf(user);
  if (cls) out.push(C.chatSummary(data.chats[cls.id], user.id));
  for (const chat of Object.values(data.chats)) {
    if (chat.type === 'dm' && chat.members.includes(user.id)) {
      const uc = C.getUC(user.id, chat.id);
      const s = C.chatSummary(chat, user.id);
      if (uc.hidden || (!s.last && !uc.pinned)) continue;
      out.push(s);
    } else if (chat.type === 'broadcast' && chat.ownerId === user.id) out.push(C.chatSummary(chat, user.id));
  }
  return out;
}

function classView(cls, viewerId) {
  return {
    id: cls.id, name: cls.name, description: cls.description, icon: cls.icon, country: cls.country,
    cycle: cls.cycle, cycleLabel: cls.cycleLabel, filiere: cls.filiere, niveau: cls.niveau,
    createdAt: cls.createdAt, restricted: cls.restricted, settings: cls.settings,
    memberCount: cls.memberIds.length, inviteCode: cls.inviteCode,
  };
}

function canSeeStatus(owner, viewerId) {
  if (owner.id === viewerId) return true;
  if (!data.users[viewerId] || data.users[viewerId].classId !== owner.classId) return false;
  if (C.blocks(owner.id, viewerId) || C.blocks(viewerId, owner.id)) return false;
  const p = owner.privacy.status;
  if (p.mode === 'except') return !p.list.includes(viewerId);
  if (p.mode === 'only') return p.list.includes(viewerId);
  return true;
}

function statusView(s, viewerId) {
  const own = s.userId === viewerId;
  return {
    id: s.id, userId: s.userId, type: s.type, text: s.text, bg: s.bg, font: s.font, media: s.media,
    caption: s.caption, createdAt: s.createdAt, expiresAt: s.expiresAt,
    viewed: !!s.views[viewerId],
    views: own ? Object.entries(s.views).map(([userId, at]) => ({ userId, at, reaction: s.reactions[userId] || null })) : undefined,
    myReaction: s.reactions[viewerId] || null,
  };
}

function myStatuses(user) {
  return Object.values(data.statuses)
    .filter(s => s.expiresAt > C.now() && canSeeStatus(data.users[s.userId], user.id))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(s => statusView(s, user.id));
}

function callView(c, viewerId) {
  return {
    id: c.id, chatId: c.chatId, video: c.video, callerId: c.callerId, startedAt: c.startedAt,
    answeredAt: c.answeredAt, endedAt: c.endedAt, participants: c.everJoined,
    outgoing: c.callerId === viewerId,
    missed: c.callerId !== viewerId && !c.everJoined.includes(viewerId),
    group: data.chats[c.chatId]?.type === 'group',
    peerId: data.chats[c.chatId]?.type === 'dm' ? (c.invited.find(x => x !== viewerId) || null) : null,
  };
}

// Serveurs ICE pour WebRTC. Un serveur TURN (TURN_URL, TURN_USER, TURN_PASS) est
// recommandé en production pour traverser les réseaux mobiles et pare-feu.
router.get('/ice', (req, res) => {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) ice.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  res.json(ice);
});

router.get('/bootstrap', (req, res) => {
  const u = req.user;
  const cls = C.classOf(u);
  res.json({
    me: selfView(u),
    class: cls && classView(cls, u.id),
    members: (cls?.memberIds || []).map(id => C.publicUser(data.users[id], u.id)).filter(Boolean),
    chats: myChats(u),
    statuses: myStatuses(u),
    calls: Object.values(data.calls).filter(c => c.invited.includes(u.id) && !(c.hiddenFor || []).includes(u.id))
      .sort((a, b) => b.startedAt - a.startedAt).slice(0, 200).map(c => callView(c, u.id)),
    session: req.session.id,
    serverTime: C.now(),
  });
});

/* ---------------- Fichiers ---------------- */

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) throw httpError(400, 'Aucun fichier reçu.');
  await storeMedia(req.file);
  res.json({ url: '/media/' + req.file.filename, name: req.file.originalname, size: req.file.size, mime: req.file.mimetype });
});

router.get('/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  if (!text) throw httpError(400, 'Texte manquant.');
  res.json({ qr: await require('qrcode').toDataURL(text, { margin: 1, width: 280 }) });
});

/* ---------------- Profil & compte ---------------- */

router.get('/me', (req, res) => res.json(selfView(req.user)));

router.patch('/me', (req, res) => {
  const u = req.user, b = req.body;
  if (b.name !== undefined) {
    const n = String(b.name).trim().slice(0, 40);
    if (n.length < 2) throw httpError(400, 'Nom trop court.');
    u.name = n;
  }
  if (b.about !== undefined) u.about = String(b.about).slice(0, 139);
  if (b.school !== undefined) u.school = String(b.school).trim().slice(0, 80);
  if (b.avatar !== undefined) {
    if (b.avatar !== null && !isMedia(b.avatar)) throw httpError(400, 'Photo invalide.');
    u.avatar = b.avatar;
  }
  save();
  pushUser(u);
  res.json(selfView(u));
});

router.patch('/me/privacy', (req, res) => {
  const p = req.user.privacy, b = req.body;
  for (const k of ['lastSeen', 'avatar', 'about', 'phone']) if (['all', 'nobody'].includes(b[k])) p[k] = b[k];
  if (typeof b.readReceipts === 'boolean') p.readReceipts = b.readReceipts;
  if (b.status && ['all', 'except', 'only'].includes(b.status.mode)) {
    p.status = { mode: b.status.mode, list: (b.status.list || []).filter(x => classmates(req.user).includes(x)) };
  }
  save();
  pushUser(req.user);
  C.getIo()?.in('u:' + req.user.id).fetchSockets().then(ss => ss.forEach(s => {
    const room = 'seen:' + req.user.classId;
    p.lastSeen === 'all' ? s.join(room) : s.leave(room);
  }));
  res.json(selfView(req.user));
});

router.patch('/me/settings', (req, res) => {
  const s = req.user.settings, b = req.body;
  if (['system', 'light', 'dark'].includes(b.theme)) s.theme = b.theme;
  if (['small', 'medium', 'large'].includes(b.fontSize)) s.fontSize = b.fontSize;
  if (b.wallpaper !== undefined) s.wallpaper = b.wallpaper === null ? null : String(b.wallpaper).slice(0, 200);
  if (typeof b.enterToSend === 'boolean') s.enterToSend = b.enterToSend;
  if (typeof b.archiveKeep === 'boolean') s.archiveKeep = b.archiveKeep;
  if (b.notifications) for (const k of Object.keys(s.notifications)) if (typeof b.notifications[k] === 'boolean') s.notifications[k] = b.notifications[k];
  if (Array.isArray(b.mutedStatuses)) s.mutedStatuses = b.mutedStatuses.filter(x => data.users[x]).slice(0, 2000);
  save();
  res.json(selfView(req.user));
});

router.post('/me/pin', (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{6}$/.test(pin)) throw httpError(400, 'Le code PIN doit contenir 6 chiffres.');
  req.user.pinHash = bcrypt.hashSync(pin, 10);
  req.user.pinHint = String(req.body.hint || '').slice(0, 60);
  save();
  res.json(selfView(req.user));
});

router.delete('/me/pin', (req, res) => {
  req.user.pinHash = null;
  req.user.pinHint = '';
  save();
  res.json(selfView(req.user));
});

router.post('/me/change-number', (req, res) => {
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '');
  const o = data.otps[phone];
  if (!o || o.expires < C.now() || String(req.body.code).trim() !== o.code) throw httpError(400, 'Code incorrect ou expiré.');
  if (data.phones[phone] && data.phones[phone] !== req.user.id && !data.users[data.phones[phone]]?.deleted) throw httpError(400, 'Ce numéro est déjà utilisé.');
  delete data.otps[phone];
  delete data.phones[req.user.phone];
  req.user.phone = phone;
  data.phones[phone] = req.user.id;
  save();
  pushUser(req.user);
  res.json(selfView(req.user));
});

router.get('/me/sessions', (req, res) => {
  res.json(Object.values(data.sessions).filter(s => s.userId === req.user.id)
    .map(s => ({ ...s, current: s.id === req.session.id })).sort((a, b) => b.lastActive - a.lastActive));
});

router.delete('/me/sessions/:id', (req, res) => {
  const s = data.sessions[req.params.id];
  if (!s || s.userId !== req.user.id) throw httpError(404, 'Appareil introuvable.');
  delete data.sessions[s.id];
  save();
  C.getIo()?.to('s:' + s.id).emit('session:revoked');
  res.json({ ok: true });
});

router.post('/me/logout', (req, res) => {
  delete data.sessions[req.session.id];
  save();
  res.json({ ok: true });
});

/* Notifications push : l'appareil s'abonne (les abonnements d'un appareil
   déconnecté sont ignorés puis supprimés automatiquement). */
router.get('/push/key', (req, res) => res.json({ publicKey: push.publicKey() }));
router.post('/push/subscribe', (req, res) => {
  push.subscribe(req.user.id, req.session.id, req.body.subscription);
  res.json({ ok: true });
});
router.post('/push/unsubscribe', (req, res) => {
  push.unsubscribe(req.body.endpoint);
  res.json({ ok: true });
});

router.get('/me/export', (req, res) => {
  const u = req.user;
  const chats = myChats(u).map(c => ({ ...c, messages: C.visibleMessages(c.id, u.id).filter(m => m.senderId === u.id).map(m => C.msgView(m, u.id)) }));
  res.setHeader('Content-Disposition', `attachment; filename="scola-mes-donnees-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), account: selfView(u), class: classView(C.classOf(u), u.id), chats });
});

router.delete('/me', (req, res) => {
  C.deleteAccount(req.user);
  res.json({ ok: true });
});

router.post('/me/block/:uid', (req, res) => {
  const o = data.users[req.params.uid];
  if (!o || o.id === req.user.id) throw httpError(400, 'Impossible.');
  if (!req.user.blocked.includes(o.id)) req.user.blocked.push(o.id);
  save();
  C.toUser(o.id, 'user:update', C.publicUser(req.user, o.id));
  res.json(selfView(req.user));
});

router.delete('/me/block/:uid', (req, res) => {
  req.user.blocked = req.user.blocked.filter(x => x !== req.params.uid);
  save();
  C.toUser(req.params.uid, 'user:update', C.publicUser(req.user, req.params.uid));
  res.json(selfView(req.user));
});

router.get('/users/:id', (req, res) => {
  const o = assertClassmate(req.user, req.params.id);
  const dm = data.chats[C.dmId(req.user.id, o.id)];
  const shared = dm ? C.visibleMessages(dm.id, req.user.id).filter(m => ['image', 'video', 'document', 'audio'].includes(m.type) && !m.deletedForAll && !m.viewOnce).length : 0;
  res.json({ ...C.publicUser(o, req.user.id), blockedByMe: req.user.blocked.includes(o.id), sharedMedia: shared });
});

/* ---------------- Classe (groupe unique) ---------------- */

function myClass(req) {
  const cls = C.classOf(req.user);
  if (!cls) throw httpError(404, 'Classe introuvable.');
  return cls;
}
function assertEditInfo(cls) {
  if (!cls.settings.membersEditInfo) throw httpError(403, 'Les infos du groupe sont gérées par l\'administration de Scola.');
}
function pushClass(cls) {
  for (const id of cls.memberIds) if (C.isOnline(id)) C.toUser(id, 'class:update', classView(cls, id));
}

router.get('/class', (req, res) => res.json(classView(myClass(req), req.user.id)));

// Tableau de bord de la classe : agenda, sondages récents, documents de cours partagés.
router.get('/class/overview', (req, res) => {
  const cls = myClass(req);
  const list = C.visibleMessages(cls.id, req.user.id).filter(m => !m.deletedForAll);
  const view = m => C.msgView(m, req.user.id);
  const since = C.now() - 86400e3;
  res.json({
    events: list.filter(m => m.type === 'event' && (m.event.endsAt || m.event.startsAt) > since).sort((a, b) => a.event.startsAt - b.event.startsAt).slice(0, 30).map(view),
    polls: list.filter(m => m.type === 'poll').slice(-10).reverse().map(view),
    docs: list.filter(m => m.type === 'document').slice(-30).reverse().map(view),
    online: cls.memberIds.filter(id => C.isOnline(id)).length,
  });
});

router.patch('/class', (req, res) => {
  const cls = myClass(req);
  assertEditInfo(cls);
  const b = req.body;
  if (b.name !== undefined) {
    const n = String(b.name).trim().slice(0, 100);
    if (n.length < 3) throw httpError(400, 'Nom trop court.');
    if (n !== cls.name) { cls.name = n; C.systemMessage(cls.id, `${req.user.name} a renommé le groupe en « ${n} »`); }
  }
  if (b.description !== undefined) {
    cls.description = String(b.description).slice(0, 2048);
    C.systemMessage(cls.id, `${req.user.name} a modifié la description du groupe`);
  }
  if (b.icon !== undefined) {
    if (b.icon !== null && !isMedia(b.icon)) throw httpError(400, 'Image invalide.');
    cls.icon = b.icon;
    C.systemMessage(cls.id, `${req.user.name} a ${b.icon ? 'changé' : 'supprimé'} l'icône du groupe`);
  }
  save();
  pushClass(cls);
  res.json(classView(cls, req.user.id));
});

router.post('/reports', (req, res) => {
  const cls = myClass(req);
  const b = req.body;
  const r = { id: C.uid('r_'), classId: cls.id, by: req.user.id, at: C.now(), reason: String(b.reason || '').slice(0, 500), userId: null, message: null, resolved: false };
  if (b.messageId) {
    const { m } = getMsg(req, b.messageId);
    r.message = { id: m.id, chatId: m.chatId, senderId: m.senderId, text: C.snippet(m), media: m.media?.url || null, at: m.createdAt };
    r.userId = m.senderId;
  } else if (b.userId) r.userId = assertClassmate(req.user, b.userId).id;
  else throw httpError(400, 'Rien à signaler.');
  data.reports.push(r);
  if (b.block && r.userId && r.userId !== req.user.id && !req.user.blocked.includes(r.userId)) req.user.blocked.push(r.userId);
  save();
  res.json({ ok: true, me: selfView(req.user) });
});

/* ---------------- Discussions ---------------- */

router.post('/chats/dm/:uid', (req, res) => {
  const o = assertClassmate(req.user, req.params.uid);
  const chat = C.ensureDm(req.user.id, o.id);
  const uc = C.getUC(req.user.id, chat.id);
  uc.hidden = false;
  save();
  res.json(C.chatSummary(chat, req.user.id));
});

router.get('/chats/:id', (req, res) => res.json(C.chatSummary(getChat(req), req.user.id)));

router.get('/chats/:id/messages', (req, res) => {
  const chat = getChat(req);
  const limit = Math.min(100, Number(req.query.limit) || 50);
  let list = C.visibleMessages(chat.id, req.user.id);
  if (req.query.around) {
    const i = list.findIndex(m => m.id === req.query.around);
    if (i >= 0) list = list.slice(Math.max(0, i - 40), i + 40);
  } else if (req.query.before) {
    const b = Number(req.query.before);
    list = list.filter(m => m.createdAt < b);
    list = list.slice(-limit);
  } else list = list.slice(-limit);
  const views = list.map(m => C.msgView(m, req.user.id)).filter(Boolean);
  res.json({ messages: views, hasMore: views.length > 0 && C.visibleMessages(chat.id, req.user.id)[0]?.id !== list[0]?.id });
});

router.post('/chats/:id/messages', (req, res) => {
  const chat = getChat(req);
  const clientId = /^tmp_[\w-]{4,40}$/.test(req.body.clientId || '') ? req.body.clientId : undefined;
  const m = sendTo(req.user, chat, req.body, clientId ? { clientId } : {});
  res.json(C.msgView(m, req.user.id));
});

router.post('/chats/:id/read', (req, res) => {
  const chat = getChat(req);
  const me = req.user;
  const uc = C.getUC(me.id, chat.id);
  const t = C.now();
  uc.lastReadAt = t;
  uc.markedUnread = false;
  const silent = chat.type === 'dm' && !me.privacy.readReceipts;
  const bySender = {};
  for (const m of data.messages[chat.id] || []) {
    if (!(m.recipients || []).includes(me.id) || m.readBy[me.id]) continue;
    if (!m.deliveredTo[me.id]) m.deliveredTo[me.id] = t;
    if (silent) continue;
    m.readBy[me.id] = t;
    (bySender[m.senderId] ||= []).push({ id: m.id, chatId: chat.id, status: C.deliveryStatus(m) });
  }
  save();
  for (const [s, list] of Object.entries(bySender)) C.toUser(s, 'msg:status', list);
  C.toUser(me.id, 'chat:update', C.chatSummary(chat, me.id));
  res.json({ ok: true });
});

router.patch('/chats/:id/state', (req, res) => {
  const chat = getChat(req);
  const uc = C.getUC(req.user.id, chat.id);
  const b = req.body;
  if (typeof b.pinned === 'boolean') {
    if (b.pinned && !uc.pinned) {
      const count = Object.values(data.userChats[req.user.id] || {}).filter(x => x.pinned).length;
      if (count >= 3) throw httpError(400, 'Vous ne pouvez épingler que 3 discussions.');
    }
    uc.pinned = b.pinned;
  }
  if (typeof b.archived === 'boolean') { uc.archived = b.archived; if (b.archived) uc.pinned = false; }
  if (typeof b.favorite === 'boolean') uc.favorite = b.favorite;
  if (typeof b.markedUnread === 'boolean') uc.markedUnread = b.markedUnread;
  if (b.mutedUntil !== undefined) uc.mutedUntil = Number(b.mutedUntil) || 0;
  if (b.wallpaper !== undefined) uc.wallpaper = b.wallpaper === null ? null : String(b.wallpaper).slice(0, 200);
  save();
  const s = C.chatSummary(chat, req.user.id);
  C.toUser(req.user.id, 'chat:update', s);
  res.json(s);
});

router.post('/chats/:id/clear', (req, res) => {
  const chat = getChat(req);
  const keepStarred = !!req.body.keepStarred;
  for (const m of data.messages[chat.id] || []) {
    if (keepStarred && (m.starredBy || []).includes(req.user.id)) continue;
    if (!m.deletedFor.includes(req.user.id)) m.deletedFor.push(req.user.id);
  }
  save();
  const s = C.chatSummary(chat, req.user.id);
  C.toUser(req.user.id, 'chat:update', s);
  C.toUser(req.user.id, 'chat:cleared', { chatId: chat.id });
  res.json(s);
});

router.delete('/chats/:id', (req, res) => {
  const chat = getChat(req);
  if (chat.type === 'group') throw httpError(400, 'Le groupe de votre classe ne peut pas être supprimé ni quitté.');
  if (chat.type === 'broadcast') {
    delete data.chats[chat.id];
    for (const m of data.messages[chat.id] || []) C.msgIndex.delete(m.id);
    delete data.messages[chat.id];
  } else {
    for (const m of data.messages[chat.id] || []) if (!m.deletedFor.includes(req.user.id)) m.deletedFor.push(req.user.id);
    Object.assign(C.getUC(req.user.id, chat.id), { hidden: true, pinned: false, archived: false });
  }
  save();
  C.toUser(req.user.id, 'chat:remove', { chatId: chat.id });
  res.json({ ok: true });
});

router.patch('/chats/:id/disappearing', (req, res) => {
  const chat = getChat(req);
  const secs = Number(req.body.seconds) || 0;
  if (![0, 86400, 604800, 7776000].includes(secs)) throw httpError(400, 'Durée invalide.');
  if (chat.type === 'group') {
    const cls = data.classes[chat.id];
    assertEditInfo(cls);
  }
  chat.disappearing = secs;
  const label = { 0: 'désactivé les messages éphémères', 86400: 'activé les messages éphémères (24 heures)', 604800: 'activé les messages éphémères (7 jours)', 7776000: 'activé les messages éphémères (90 jours)' }[secs];
  C.systemMessage(chat.id, `${req.user.name} a ${label}`);
  save();
  C.pushChat(chat, chat.type === 'broadcast' ? [chat.ownerId] : undefined);
  res.json(C.chatSummary(chat, req.user.id));
});

router.get('/chats/:id/media', (req, res) => {
  const chat = getChat(req);
  const list = C.visibleMessages(chat.id, req.user.id).filter(m => !m.deletedForAll && !m.viewOnce);
  const views = l => l.map(m => C.msgView(m, req.user.id)).filter(Boolean).reverse();
  res.json({
    media: views(list.filter(m => ['image', 'video'].includes(m.type))),
    docs: views(list.filter(m => ['document', 'audio'].includes(m.type))),
    links: views(list.filter(m => m.type === 'text' && /https?:\/\//i.test(m.text))),
  });
});

router.get('/chats/:id/export', (req, res) => {
  const chat = getChat(req);
  const pad = n => String(n).padStart(2, '0');
  const fmt = t => { const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const lines = C.visibleMessages(chat.id, req.user.id).map(m => {
    const who = m.senderId ? (data.users[m.senderId]?.name || 'Inconnu') : 'Scola';
    let body = m.deletedForAll ? 'Ce message a été supprimé' : C.snippet(m);
    if (m.media && !m.viewOnce && !m.deletedForAll) body += ` <fichier : ${m.media.name}>`;
    return `[${fmt(m.createdAt)}] ${who} : ${body}${m.editedAt ? ' <modifié>' : ''}`;
  });
  const title = chat.type === 'group' ? data.classes[chat.id].name : chat.type === 'broadcast' ? chat.name : data.users[chat.members.find(x => x !== req.user.id) || req.user.id]?.name;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('Discussion Scola avec ' + title + '.txt')}`);
  res.send(lines.join('\n'));
});

/* ---------------- Actions sur les messages ---------------- */

router.patch('/messages/:id', (req, res) => {
  const { m } = getMsg(req);
  if (m.senderId !== req.user.id) throw httpError(403, 'Vous ne pouvez modifier que vos messages.');
  if (m.deletedForAll || !['text', 'image', 'video', 'document'].includes(m.type)) throw httpError(400, 'Ce message ne peut pas être modifié.');
  if (C.now() - m.createdAt > 15 * 60_000) throw httpError(400, 'Un message ne peut être modifié que dans les 15 minutes suivant son envoi.');
  const text = String(req.body.text || '').slice(0, 65536);
  if (m.type === 'text' && !text.trim()) throw httpError(400, 'Message vide.');
  m.text = text;
  m.editedAt = C.now();
  m.linkPreview = null;
  save();
  C.pushMessage(m, 'msg:update');
  if (m.type === 'text') fetchPreview(m);
  res.json(C.msgView(m, req.user.id));
});

router.delete('/messages/:id', (req, res) => {
  const { m, chat } = getMsg(req);
  if (req.query.for === 'all') {
    if (m.senderId !== req.user.id) throw httpError(403, 'Vous ne pouvez supprimer pour tous que vos propres messages.');
    if (C.now() - m.createdAt > 60 * 3600e3) throw httpError(400, 'Trop tard pour supprimer ce message pour tout le monde.');
    C.deleteForAll(m, req.user.id);
  } else {
    if (!m.deletedFor.includes(req.user.id)) m.deletedFor.push(req.user.id);
    save();
    C.toUser(req.user.id, 'msg:remove', { chatId: m.chatId, id: m.id });
  }
  res.json({ ok: true });
});

router.post('/messages/:id/react', (req, res) => {
  const { m } = getMsg(req);
  if (m.deletedForAll || m.type === 'system') throw httpError(400, 'Impossible de réagir à ce message.');
  const e = String(req.body.emoji || '').slice(0, 16);
  if (!e || m.reactions[req.user.id] === e) delete m.reactions[req.user.id];
  else m.reactions[req.user.id] = e;
  save();
  C.pushMessage(m, 'msg:update');
  if (e && m.senderId && m.senderId !== req.user.id) C.toUser(m.senderId, 'msg:reacted', { chatId: m.chatId, id: m.id, by: req.user.id, emoji: e });
  res.json(C.msgView(m, req.user.id));
});

router.post('/messages/:id/star', (req, res) => {
  const { m } = getMsg(req);
  const s = (m.starredBy ||= []);
  const i = s.indexOf(req.user.id);
  if (i >= 0) s.splice(i, 1); else s.push(req.user.id);
  save();
  const v = C.msgView(m, req.user.id);
  C.toUser(req.user.id, 'msg:update', v);
  res.json(v);
});

router.post('/messages/:id/pin', (req, res) => {
  const { m, chat } = getMsg(req);
  if (m.deletedForAll || m.type === 'system') throw httpError(400, 'Impossible d\'épingler ce message.');
  if (chat.type === 'group') {
    const cls = data.classes[chat.id];
    if (!cls.settings.membersPin) throw httpError(403, 'L\'épinglage est désactivé dans ce groupe par l\'administration.');
  }
  chat.pinnedMsgs = (chat.pinnedMsgs || []).filter(p => p.until > C.now());
  const existing = chat.pinnedMsgs.find(p => p.id === m.id);
  if (req.body.unpin) {
    chat.pinnedMsgs = chat.pinnedMsgs.filter(p => p.id !== m.id);
  } else if (!existing) {
    const dur = [86400, 604800, 2592000].includes(Number(req.body.seconds)) ? Number(req.body.seconds) : 604800;
    if (chat.pinnedMsgs.length >= 3) chat.pinnedMsgs.shift();
    chat.pinnedMsgs.push({ id: m.id, by: req.user.id, until: C.now() + dur * 1000 });
    C.systemMessage(chat.id, `${req.user.name} a épinglé un message`, { meta: { pinned: m.id } });
  }
  save();
  C.pushMessage(m, 'msg:update');
  C.pushChat(chat, chat.type === 'broadcast' ? [chat.ownerId] : undefined);
  res.json({ ok: true });
});

router.post('/messages/:id/vote', (req, res) => {
  const { m } = getMsg(req);
  if (m.type !== 'poll' || !m.poll) throw httpError(400, 'Ce message n\'est pas un sondage.');
  let ids = Array.isArray(req.body.optionIds) ? req.body.optionIds : [];
  if (!m.poll.multiple) ids = ids.slice(0, 1);
  for (const o of m.poll.options) {
    o.votes = o.votes.filter(x => x !== req.user.id);
    if (ids.includes(o.id)) o.votes.push(req.user.id);
  }
  save();
  C.pushMessage(m, 'msg:update');
  res.json(C.msgView(m, req.user.id));
});

router.post('/messages/:id/rsvp', (req, res) => {
  const { m } = getMsg(req);
  if (m.type !== 'event' || !m.event) throw httpError(400, 'Ce message n\'est pas un évènement.');
  const r = req.body.response;
  if (['going', 'maybe', 'notgoing'].includes(r)) m.event.responses[req.user.id] = r;
  else delete m.event.responses[req.user.id];
  save();
  C.pushMessage(m, 'msg:update');
  res.json(C.msgView(m, req.user.id));
});

// Position en direct : l'expéditeur pousse ses coordonnées jusqu'à l'expiration.
router.post('/messages/:id/live', (req, res) => {
  const { m } = getMsg(req);
  if (m.senderId !== req.user.id || m.type !== 'location' || !m.location?.live) throw httpError(400, 'Pas une position en direct.');
  if (req.body.stop || m.location.liveUntil < C.now()) m.location.liveUntil = Math.min(m.location.liveUntil, C.now());
  else {
    const lat = Number(req.body.lat), lng = Number(req.body.lng);
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) Object.assign(m.location, { lat, lng, updatedAt: C.now() });
  }
  save();
  C.pushMessage(m, 'msg:update');
  res.json({ ok: true, active: m.location.liveUntil > C.now() });
});

router.post('/messages/:id/open', (req, res) => {
  const { m } = getMsg(req);
  if (!m.viewOnce || m.deletedForAll) throw httpError(400, 'Message non disponible.');
  if (m.senderId === req.user.id) throw httpError(400, 'Vous ne pouvez pas rouvrir un média à vue unique que vous avez envoyé.');
  if (m.viewedBy.includes(req.user.id)) throw httpError(400, 'Ce média a déjà été ouvert.');
  m.viewedBy.push(req.user.id);
  if (!m.readBy[req.user.id]) m.readBy[req.user.id] = C.now();
  save();
  const media = m.media;
  C.pushMessage(m, 'msg:update');
  res.json({ media, type: m.type });
});

router.get('/messages/:id/info', (req, res) => {
  const { m } = getMsg(req);
  if (m.senderId !== req.user.id) throw httpError(403, 'Infos disponibles uniquement pour vos messages.');
  const rows = (m.recipients || []).map(id => ({ userId: id, deliveredAt: m.deliveredTo[id] || null, readAt: m.readBy[id] || null, playedAt: (m.viewedBy || []).includes(id) ? m.readBy[id] : null }));
  res.json({ message: C.msgView(m, req.user.id), rows });
});

router.post('/messages/forward', (req, res) => {
  const ids = (req.body.messageIds || []).slice(0, 100);
  const chatIds = [...new Set(req.body.chatIds || [])];
  const userIds = [...new Set(req.body.userIds || [])];
  const targets = chatIds.map(id => getChat(req, id));
  for (const u of userIds) { assertClassmate(req.user, u); targets.push(C.ensureDm(req.user.id, u)); }
  const msgs = ids.map(id => getMsg(req, id).m).filter(m => !m.deletedForAll && m.type !== 'system' && !m.viewOnce).sort((a, b) => a.createdAt - b.createdAt);
  const frequent = msgs.some(m => (m.forwardCount || 0) >= 4);
  if (frequent && targets.length > 1) throw httpError(400, 'Les messages transférés de nombreuses fois ne peuvent être envoyés qu\'à une seule discussion.');
  if (targets.length > 5) throw httpError(400, 'Vous pouvez transférer à 5 discussions maximum.');
  let sent = 0;
  for (const chat of targets) {
    for (const m of msgs) {
      const body = { type: m.type, text: m.text, media: m.media, location: m.location, contact: m.contact, poll: m.poll && { question: m.poll.question, multiple: m.poll.multiple, options: m.poll.options.map(o => o.text) }, event: m.event };
      sendTo(req.user, chat, body, { forwarded: m.senderId !== req.user.id || !!m.forwarded, forwardCount: (m.forwardCount || 0) + (m.senderId !== req.user.id ? 1 : 0) });
      sent++;
    }
    if (req.body.comment) sendTo(req.user, chat, { type: 'text', text: req.body.comment });
  }
  res.json({ ok: true, sent });
});

/* ---------------- Recherche & favoris ---------------- */

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

router.get('/search', (req, res) => {
  const q = fold(req.query.q).trim();
  if (q.length < 2) return res.json({ messages: [], members: [] });
  const out = [];
  const chats = myChats(req.user);
  const only = req.query.chatId;
  for (const c of chats) {
    if (only && c.id !== only) continue;
    const list = C.visibleMessages(c.id, req.user.id);
    for (let i = list.length - 1; i >= 0 && out.length < 100; i--) {
      const m = list[i];
      if (m.deletedForAll || m.type === 'system') continue;
      const hay = fold([m.text, m.media?.name, m.poll?.question, m.event?.title].filter(Boolean).join(' '));
      if (hay.includes(q)) { const v = C.msgView(m, req.user.id); if (v) out.push(v); }
    }
  }
  const members = only ? [] : classmates(req.user).map(id => data.users[id]).filter(u => u && fold(u.name).includes(q)).slice(0, 30).map(u => C.publicUser(u, req.user.id));
  res.json({ messages: out.sort((a, b) => b.createdAt - a.createdAt), members });
});

router.get('/starred', (req, res) => {
  const out = [];
  for (const c of myChats(req.user)) {
    for (const m of C.visibleMessages(c.id, req.user.id)) if ((m.starredBy || []).includes(req.user.id)) { const v = C.msgView(m, req.user.id); if (v && !v.deleted) out.push(v); }
  }
  res.json(out.sort((a, b) => b.createdAt - a.createdAt));
});

/* ---------------- Listes de diffusion ---------------- */

router.post('/broadcasts', (req, res) => {
  const rec = [...new Set(req.body.recipients || [])].filter(x => x !== req.user.id);
  rec.forEach(x => assertClassmate(req.user, x));
  if (rec.length < 2) throw httpError(400, 'Choisissez au moins 2 destinataires.');
  if (rec.length > 256) throw httpError(400, '256 destinataires maximum.');
  const id = C.uid('b_');
  data.chats[id] = { id, type: 'broadcast', ownerId: req.user.id, name: String(req.body.name || '').trim().slice(0, 60) || `${rec.length} destinataires`, recipients: rec, createdAt: C.now(), disappearing: 0, pinnedMsgs: [] };
  data.messages[id] = [];
  C.getUC(req.user.id, id);
  save();
  C.systemMessage(id, `Vous avez créé une liste de diffusion avec ${rec.length} destinataires`);
  res.json(C.chatSummary(data.chats[id], req.user.id));
});

router.patch('/broadcasts/:id', (req, res) => {
  const chat = getChat(req);
  if (chat.type !== 'broadcast') throw httpError(400, 'Pas une liste de diffusion.');
  if (req.body.name !== undefined) chat.name = String(req.body.name).trim().slice(0, 60) || chat.name;
  if (Array.isArray(req.body.recipients)) {
    const rec = [...new Set(req.body.recipients)].filter(x => x !== req.user.id);
    rec.forEach(x => assertClassmate(req.user, x));
    if (rec.length < 2) throw httpError(400, 'Choisissez au moins 2 destinataires.');
    chat.recipients = rec;
  }
  save();
  const s = C.chatSummary(chat, req.user.id);
  C.toUser(req.user.id, 'chat:update', s);
  res.json(s);
});

/* ---------------- Statuts (24 h) ---------------- */

router.get('/statuses', (req, res) => res.json(myStatuses(req.user)));

router.post('/statuses', (req, res) => {
  const b = req.body;
  const type = ['text', 'image', 'video', 'voice'].includes(b.type) ? b.type : 'text';
  const s = {
    id: C.uid('st_'), userId: req.user.id, classId: req.user.classId, type, createdAt: C.now(),
    expiresAt: C.now() + 24 * 3600e3, views: {}, reactions: {},
    text: String(b.text || '').slice(0, 700), bg: /^#[0-9a-f]{6}$/i.test(b.bg) ? b.bg : '#0f766e',
    font: Number(b.font) % 5 || 0, caption: String(b.caption || '').slice(0, 700),
    media: type === 'text' ? null : cleanMedia(b.media),
  };
  if (type === 'text' && !s.text.trim()) throw httpError(400, 'Statut vide.');
  data.statuses[s.id] = s;
  save();
  for (const id of classmates(req.user)) {
    if (C.isOnline(id) && canSeeStatus(req.user, id)) C.toUser(id, 'status:new', statusView(s, id));
  }
  res.json(statusView(s, req.user.id));
});

function getStatus(req) {
  const s = data.statuses[req.params.id];
  if (!s || s.expiresAt < C.now() || !canSeeStatus(data.users[s.userId], req.user.id)) throw httpError(404, 'Statut introuvable.');
  return s;
}

router.post('/statuses/:id/view', (req, res) => {
  const s = getStatus(req);
  if (s.userId !== req.user.id && !s.views[req.user.id]) {
    s.views[req.user.id] = C.now();
    save();
    C.toUser(s.userId, 'status:update', statusView(s, s.userId));
  }
  res.json({ ok: true });
});

router.post('/statuses/:id/react', (req, res) => {
  const s = getStatus(req);
  const e = String(req.body.emoji || '').slice(0, 16);
  if (e) s.reactions[req.user.id] = e; else delete s.reactions[req.user.id];
  s.views[req.user.id] ||= C.now();
  save();
  C.toUser(s.userId, 'status:update', statusView(s, s.userId));
  res.json({ ok: true });
});

router.post('/statuses/:id/reply', (req, res) => {
  const s = getStatus(req);
  if (s.userId === req.user.id) throw httpError(400, 'Impossible de répondre à votre propre statut.');
  const chat = C.ensureDm(req.user.id, s.userId);
  const m = sendTo(req.user, chat, { type: 'text', text: req.body.text }, {
    statusRef: { id: s.id, ownerId: s.userId, type: s.type, text: (s.text || s.caption || '').slice(0, 120), bg: s.bg, thumb: s.type === 'image' ? s.media.url : null },
  });
  res.json(C.msgView(m, req.user.id));
});

router.delete('/statuses/:id', (req, res) => {
  const s = data.statuses[req.params.id];
  if (!s || s.userId !== req.user.id) throw httpError(404, 'Statut introuvable.');
  delete data.statuses[s.id];
  save();
  C.toUsers(classmates(req.user), 'status:remove', { id: s.id });
  res.json({ ok: true });
});

/* ---------------- Journal d'appels ---------------- */

router.get('/calls', (req, res) => {
  res.json(Object.values(data.calls).filter(c => c.invited.includes(req.user.id) && !(c.hiddenFor || []).includes(req.user.id))
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, 200).map(c => callView(c, req.user.id)));
});

router.delete('/calls', (req, res) => {
  const only = req.query.id;
  for (const c of Object.values(data.calls)) {
    if (!c.invited.includes(req.user.id) || (only && c.id !== only)) continue;
    (c.hiddenFor ||= []).push(req.user.id);
  }
  save();
  res.json({ ok: true });
});

module.exports = { router, callView, canSeeStatus, classView, upload };
