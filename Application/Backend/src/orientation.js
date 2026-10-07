// Orientation : chaînes des établissements (équivalent des chaînes WhatsApp).
// Les élèves suivent des écoles, lisent leurs publications, réagissent et peuvent les
// contacter en privé. Seuls des établissements validés par l'administration publient.
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const C = require('./core');
const push = require('./push');
const mail = require('./mail');
const { requireAuth, httpError } = require('./auth');
const { cleanMedia } = require('./api');
const { data, save } = C;

const SCHOOL_TYPES = {
  lycee: 'Lycée / Collège',
  universite_publique: 'Université publique',
  universite_privee: 'Université privée',
  grande_ecole: 'Grande école',
  bts: 'École professionnelle / BTS',
  formation: 'Centre de formation',
  autre: 'Autre établissement',
};

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const active = (s) => s && s.status === 'active';
const postsOf = (sid) => (data.posts[sid] ||= []);
const followsOf = (uid) => (data.follows[uid] ||= {});

function getSchool(id, { mustBeActive = true } = {}) {
  const s = data.schools[id];
  if (!s || (mustBeActive && !active(s))) throw httpError(404, 'Établissement introuvable.');
  return s;
}

function findPost(id) {
  for (const [sid, list] of Object.entries(data.posts)) {
    const p = list.find(x => x.id === id);
    if (p) return { p, school: data.schools[sid] };
  }
  return {};
}

/* ---------------- Vues ---------------- */

function channelView(s, viewerId) {
  const f = viewerId ? followsOf(viewerId)[s.id] : null;
  return {
    id: s.id, name: s.name, type: s.type, typeLabel: SCHOOL_TYPES[s.type] || SCHOOL_TYPES.autre,
    country: s.country, city: s.city, address: s.address, website: s.website, email: s.email, phone: s.phone,
    description: s.description, programs: s.programs, logo: s.logo, verified: !!s.verified,
    createdAt: s.activatedAt || s.requestedAt, followers: (s.followerIds || []).length,
    posts: postsOf(s.id).length, following: !!f, muted: f ? !!f.muted : false,
  };
}

function postSnippet(p) {
  if (p.text) return p.text.replace(/\s+/g, ' ').slice(0, 160);
  return { image: '📷 Photo', video: '🎥 Vidéo', document: '📄 ' + (p.media?.name || 'Document') }[p.type] || 'Publication';
}

function postView(p, viewerId) {
  const counts = {};
  for (const e of Object.values(p.reactions || {})) counts[e] = (counts[e] || 0) + 1;
  return {
    id: p.id, schoolId: p.schoolId, type: p.type, text: p.text || '', media: p.media || null, linkPreview: p.linkPreview || null,
    createdAt: p.createdAt, editedAt: p.editedAt || null, reactions: counts,
    myReaction: viewerId ? (p.reactions || {})[viewerId] || null : null,
    views: (p.viewerIds || []).length,
  };
}

function summary(s, uid) {
  const f = followsOf(uid)[s.id];
  const list = postsOf(s.id);
  const last = list[list.length - 1];
  const unread = f ? list.filter(p => p.createdAt > (f.lastReadAt || 0)).length : 0;
  return { ...channelView(s, uid), last: last ? { ...postView(last, uid), preview: postSnippet(last) } : null, unread };
}

// Ce qu'un établissement voit d'un élève : nom et classe, jamais son numéro.
function studentCard(uid) {
  const u = data.users[uid];
  if (!u || u.deleted) return { id: uid, name: 'Élève', className: '—' };
  const cls = data.classes[u.classId];
  return { id: u.id, name: u.name, className: cls?.name || '—', country: cls?.country || '', school: u.school || '', avatar: u.privacy?.avatar === 'all' ? u.avatar : null };
}

// Chaque côté peut supprimer l'échange pour lui seul : il ne voit plus que les messages postérieurs.
function visibleMessages(q, side) {
  const from = q.clearedAt?.[side] || 0;
  return from ? q.messages.filter(m => m.createdAt > from) : q.messages;
}

function inquiryView(q, side) {
  const s = data.schools[q.schoolId];
  const msgs = visibleMessages(q, side);
  const last = msgs[msgs.length - 1];
  const readAt = side === 'school' ? q.readBySchoolAt : q.readByStudentAt;
  const other = side === 'school' ? 'student' : 'school';
  return {
    id: q.id, schoolId: q.schoolId, studentId: q.studentId, createdAt: q.createdAt, updatedAt: q.updatedAt,
    school: s ? { id: s.id, name: s.name, logo: s.logo, verified: !!s.verified } : null,
    student: side === 'school' ? studentCard(q.studentId) : undefined,
    last: last ? { from: last.from, text: last.text || (last.media ? '📎 ' + (last.media.name || 'Fichier') : ''), createdAt: last.createdAt } : null,
    unread: msgs.filter(m => m.from === other && m.createdAt > (readAt || 0)).length,
  };
}

// Suppression d'un échange par l'élève ou l'établissement (pour lui seul).
// Quand les deux côtés l'ont supprimé, il est effacé définitivement.
function clearInquiry(q, side) {
  q.clearedAt ||= {};
  q.clearedAt[side] = C.now();
  const last = q.messages[q.messages.length - 1]?.createdAt || 0;
  if ((q.clearedAt.student || 0) >= last && (q.clearedAt.school || 0) >= last) delete data.inquiries[q.id];
  save();
  if (side === 'student') C.toUser(q.studentId, 'orientation:inquiry-cleared', { schoolId: q.schoolId });
}

/* ---------------- Notifications ---------------- */

// Nouvelle publication : prévient les abonnés (en direct et par notification push).
function notifyPost(s, p) {
  for (const uid of s.followerIds || []) {
    const u = data.users[uid];
    if (!u || u.deleted) continue;
    if (C.isOnline(uid)) C.toUser(uid, 'orientation:post', { channel: summary(s, uid), post: postView(p, uid) });
    const f = followsOf(uid)[s.id];
    if (!f || f.muted || u.settings?.notifications?.orientation === false) continue;
    push.sendTo(uid, {
      title: s.name, body: postSnippet(p), tag: 'ori-' + s.id, icon: s.logo || '/icons/icon-192.png',
      url: `/?orientation=${encodeURIComponent(s.id)}&post=${encodeURIComponent(p.id)}`, at: p.createdAt,
    });
  }
}

// Réponse d'un établissement à un élève.
function notifyReply(q, m) {
  const s = data.schools[q.schoolId];
  C.toUser(q.studentId, 'orientation:reply', { inquiry: inquiryView(q, 'student'), message: m });
  push.sendTo(q.studentId, {
    title: s?.name || 'Établissement', body: m.text || '📎 Fichier', tag: 'inq-' + q.id, icon: s?.logo || '/icons/icon-192.png',
    url: `/?inquiry=${encodeURIComponent(q.schoolId)}`, at: m.createdAt,
  });
}

/* ---------------- Échanges privés élève ↔ établissement ---------------- */

function findInquiry(schoolId, studentId) {
  return Object.values(data.inquiries).find(q => q.schoolId === schoolId && q.studentId === studentId) || null;
}

function addInquiryMessage(q, from, b) {
  const text = String(b.text || '').trim().slice(0, 4000);
  const media = b.media ? cleanMedia(b.media) : null;
  if (!text && !media) throw httpError(400, 'Message vide.');
  const m = { id: C.uid('qm_'), from, text, media, createdAt: C.now() };
  if (b.postId) {
    const { p } = findPost(b.postId);
    if (p && p.schoolId === q.schoolId) m.postRef = { id: p.id, text: postSnippet(p), thumb: p.type === 'image' ? p.media?.url : null };
  }
  q.messages.push(m);
  if (q.messages.length > 2000) q.messages.splice(0, q.messages.length - 2000);
  q.updatedAt = m.createdAt;
  if (from === 'student') q.readByStudentAt = m.createdAt; else q.readBySchoolAt = m.createdAt;
  save();
  if (from === 'school') notifyReply(q, m);
  return m;
}

/* ---------------- Codes d'activation ---------------- */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I
const CODE_DAYS = 7;

function newCode() {
  let c = '';
  for (let i = 0; i < 8; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return c.slice(0, 4) + '-' + c.slice(4);
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Génère le code (montré une seule fois) et l'envoie à l'e-mail de l'établissement si possible.
async function issueActivationCode(s, adminName, baseUrl) {
  const code = newCode();
  s.codeHash = bcrypt.hashSync(normCode(code), 10);
  s.codeExpires = C.now() + CODE_DAYS * 86400e3;
  s.codeAttempts = 0;
  s.codeSentAt = C.now();
  s.codeSentBy = adminName;
  s.status = 'code_sent';
  save();
  const link = `${baseUrl}/etablissement/#activer`;
  const text = `Bonjour,\n\nLa demande de création du compte « ${s.name} » sur Scola a été validée.\n\nVotre code d'activation : ${code}\n(valable ${CODE_DAYS} jours)\n\nPour terminer la création de votre compte, rendez-vous sur ${link}, saisissez votre e-mail (${s.email}), ce code et choisissez votre mot de passe.\n\nL'équipe Scola`;
  const html = `<p>Bonjour,</p><p>La demande de création du compte <b>${s.name.replace(/</g, '&lt;')}</b> sur Scola a été validée.</p>
    <p style="font-size:22px;letter-spacing:3px"><b>${code}</b></p><p>Ce code est valable ${CODE_DAYS} jours.</p>
    <p>Pour terminer la création de votre compte : <a href="${link}">${link}</a><br>saisissez votre e-mail (${s.email}), ce code, puis choisissez votre mot de passe.</p><p>L'équipe Scola</p>`;
  const r = await mail.send({ to: s.email, subject: 'Scola — votre code d\'activation', text, html });
  s.codeEmailed = r.sent;
  save();
  return { code, emailed: r.sent, reason: r.reason, subject: 'Scola — votre code d\'activation', text };
}

function checkActivationCode(s, code) {
  if (s.status !== 'code_sent' || !s.codeHash) throw httpError(400, 'Aucun code n\'a encore été envoyé pour cet établissement. Les codes sont envoyés sous 72 h après la demande.');
  if (s.codeExpires < C.now()) throw httpError(400, 'Ce code a expiré. Contactez l\'administration de Scola pour en recevoir un nouveau.');
  if ((s.codeAttempts || 0) >= 5) throw httpError(429, 'Trop de tentatives. Contactez l\'administration de Scola pour un nouveau code.');
  if (!bcrypt.compareSync(normCode(code), s.codeHash)) { s.codeAttempts = (s.codeAttempts || 0) + 1; save(); throw httpError(400, 'Code incorrect.'); }
}

/* ---------------- API des élèves (/api/orientation) ---------------- */

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const uid = req.user.id;
  const mine = Object.keys(followsOf(uid)).map(id => data.schools[id]).filter(active);
  const following = mine.map(s => summary(s, uid)).sort((a, b) => (b.last?.createdAt || 0) - (a.last?.createdAt || 0));
  const suggestions = Object.values(data.schools).filter(s => active(s) && !followsOf(uid)[s.id])
    .sort((a, b) => (b.followerIds || []).length - (a.followerIds || []).length).slice(0, 20).map(s => channelView(s, uid));
  const inquiries = Object.values(data.inquiries).filter(q => q.studentId === uid && active(data.schools[q.schoolId]) && visibleMessages(q, 'student').length)
    .sort((a, b) => b.updatedAt - a.updatedAt).map(q => inquiryView(q, 'student'));
  res.json({ following, suggestions, inquiries, types: SCHOOL_TYPES });
});

router.get('/channels', (req, res) => {
  const q = fold(req.query.q);
  let list = Object.values(data.schools).filter(active);
  if (q) list = list.filter(s => fold(`${s.name} ${s.city} ${s.country} ${s.programs} ${SCHOOL_TYPES[s.type]}`).includes(q));
  if (req.query.type) list = list.filter(s => s.type === req.query.type);
  res.json(list.sort((a, b) => (b.followerIds || []).length - (a.followerIds || []).length).slice(0, 100).map(s => channelView(s, req.user.id)));
});

router.get('/channels/:id', (req, res) => {
  const s = getSchool(req.params.id);
  const list = postsOf(s.id);
  res.json({ ...channelView(s, req.user.id), media: list.filter(p => ['image', 'video', 'document'].includes(p.type) || /https?:\/\//.test(p.text || '')).length, hasInquiry: !!findInquiry(s.id, req.user.id) });
});

router.get('/channels/:id/posts', (req, res) => {
  const s = getSchool(req.params.id);
  let list = postsOf(s.id);
  if (req.query.around) {
    const i = list.findIndex(p => p.id === req.query.around);
    if (i >= 0) list = list.slice(Math.max(0, i - 25), i + 25);
  } else if (req.query.before) list = list.filter(p => p.createdAt < Number(req.query.before));
  const slice = req.query.around ? list : list.slice(-40);
  res.json({ posts: slice.map(p => postView(p, req.user.id)), hasMore: postsOf(s.id)[0] && slice[0] ? postsOf(s.id)[0].id !== slice[0].id : false });
});

router.post('/channels/:id/follow', (req, res) => {
  const s = getSchool(req.params.id);
  const f = followsOf(req.user.id);
  if (!f[s.id]) {
    f[s.id] = { at: C.now(), muted: false, lastReadAt: C.now() };
    (s.followerIds ||= []).push(req.user.id);
    save();
  }
  res.json(summary(s, req.user.id));
});

router.delete('/channels/:id/follow', (req, res) => {
  const s = getSchool(req.params.id, { mustBeActive: false });
  delete followsOf(req.user.id)[s.id];
  s.followerIds = (s.followerIds || []).filter(x => x !== req.user.id);
  save();
  res.json(channelView(s, req.user.id));
});

router.patch('/channels/:id', (req, res) => {
  const s = getSchool(req.params.id);
  const f = followsOf(req.user.id)[s.id];
  if (!f) throw httpError(400, 'Suivez d\'abord cet établissement.');
  if (typeof req.body.muted === 'boolean') f.muted = req.body.muted;
  save();
  res.json(summary(s, req.user.id));
});

// Lecture : remet les non-lus à zéro et compte une vue par élève sur chaque publication.
router.post('/channels/:id/read', (req, res) => {
  const s = getSchool(req.params.id);
  const f = followsOf(req.user.id)[s.id];
  if (f) f.lastReadAt = C.now();
  for (const p of postsOf(s.id).slice(-60)) {
    p.viewerIds ||= [];
    if (!p.viewerIds.includes(req.user.id)) p.viewerIds.push(req.user.id);
  }
  save();
  res.json({ ok: true });
});

router.get('/channels/:id/media', (req, res) => {
  const s = getSchool(req.params.id);
  const list = [...postsOf(s.id)].reverse();
  const v = p => postView(p, req.user.id);
  res.json({
    media: list.filter(p => p.type === 'image' || p.type === 'video').map(v),
    docs: list.filter(p => p.type === 'document').map(v),
    links: list.filter(p => /https?:\/\//.test(p.text || '')).map(v),
  });
});

router.post('/channels/:id/report', (req, res) => {
  const s = getSchool(req.params.id, { mustBeActive: false });
  const r = { id: C.uid('r_'), kind: 'channel', schoolId: s.id, classId: null, by: req.user.id, at: C.now(), reason: String(req.body.reason || '').slice(0, 500), userId: null, message: null, resolved: false };
  if (req.body.postId) {
    const { p } = findPost(req.body.postId);
    if (p && p.schoolId === s.id) r.message = { id: p.id, kind: 'post', text: postSnippet(p), media: p.media?.url || null, at: p.createdAt };
  }
  data.reports.push(r);
  save();
  res.json({ ok: true });
});

router.post('/posts/:id/react', (req, res) => {
  const { p, school } = findPost(req.params.id);
  if (!p || !active(school)) throw httpError(404, 'Publication introuvable.');
  const e = String(req.body.emoji || '').slice(0, 16);
  p.reactions ||= {};
  if (!e || p.reactions[req.user.id] === e) delete p.reactions[req.user.id]; else p.reactions[req.user.id] = e;
  save();
  const v = postView(p, req.user.id);
  for (const uid of school.followerIds || []) if (uid !== req.user.id && C.isOnline(uid)) C.toUser(uid, 'orientation:update', postView(p, uid));
  res.json(v);
});

router.get('/inquiries/with/:schoolId', (req, res) => {
  const s = getSchool(req.params.schoolId);
  const q = findInquiry(s.id, req.user.id);
  res.json({ school: channelView(s, req.user.id), inquiry: q ? inquiryView(q, 'student') : null, messages: q ? visibleMessages(q, 'student').slice(-200) : [] });
});

router.delete('/inquiries/with/:schoolId', (req, res) => {
  const q = findInquiry(req.params.schoolId, req.user.id);
  if (q) clearInquiry(q, 'student');
  res.json({ ok: true });
});

router.post('/inquiries/with/:schoolId/messages', (req, res) => {
  const s = getSchool(req.params.schoolId);
  let q = findInquiry(s.id, req.user.id);
  if (!q) {
    q = { id: C.uid('q_'), schoolId: s.id, studentId: req.user.id, createdAt: C.now(), updatedAt: C.now(), messages: [], readBySchoolAt: 0, readByStudentAt: C.now() };
    data.inquiries[q.id] = q;
  }
  const m = addInquiryMessage(q, 'student', req.body);
  res.json({ inquiry: inquiryView(q, 'student'), message: m });
});

router.post('/inquiries/with/:schoolId/read', (req, res) => {
  const q = findInquiry(req.params.schoolId, req.user.id);
  if (q) { q.readByStudentAt = C.now(); save(); }
  res.json({ ok: true });
});

module.exports = {
  router, SCHOOL_TYPES, fold, active, postsOf, followsOf, getSchool, findPost, findInquiry,
  channelView, postView, postSnippet, summary, studentCard, inquiryView, visibleMessages, clearInquiry,
  notifyPost, addInquiryMessage, issueActivationCode, checkActivationCode, normCode,
};
