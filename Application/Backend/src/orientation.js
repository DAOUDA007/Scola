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
const OF = require('./offers');
const AU = require('./audience');
const CP = require('./campaigns');
const catalog = require('./catalog');
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
  const r = OF.currentPlan(s).plan.rights || {};
  const a = r.admissions && s.admissions ? { ...s.admissions, highlight: !!r.admissionsHighlight } : null;
  return {
    id: s.id, name: s.name, type: s.type, typeLabel: SCHOOL_TYPES[s.type] || SCHOOL_TYPES.autre,
    country: s.country, city: s.city, address: s.address, website: s.website, email: s.email, phone: s.phone,
    description: s.description, programs: s.programs, logo: s.logo,
    // Badge « vérifié » : accordé par l'administration ET inclus dans la formule ; « Fondateur » : permanent.
    verified: OF.showsVerified(s), founder: OF.isFounder(s),
    createdAt: s.activatedAt || s.requestedAt, followers: (s.followerIds || []).length,
    posts: postsOf(s.id).length, following: !!f, muted: f ? !!f.muted : false,
    // Page officielle (vitrine payée par l'établissement, visible même sans suivre la chaîne).
    infoButton: !!r.infoButton, formations: r.fullPage ? s.formations || [] : [], gallery: r.fullPage ? s.gallery || [] : [], admissions: a,
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
    featuredUntil: p.featuredUntil && p.featuredUntil > C.now() ? p.featuredUntil : null, admission: !!p.admission,
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
  if (b.info) m.info = { formation: String(b.info.formation || '').slice(0, 120), source: b.info.source === 'ad' ? 'ad' : 'channel' };
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
  if (from === 'student') {
    AU.contact(q.schoolId, q.studentId, { info: !!m.info });
    if (m.postRef) AU.postReply(q.schoolId, m.postRef.id);
  }
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

// Comme sur WhatsApp : le contenu d'une chaîne (publications, médias, documents, échanges)
// n'est accessible qu'aux élèves qui la suivent. Les autres ne voient que sa présentation.
function requireFollow(s, uid) {
  if (!followsOf(uid)[s.id]) {
    const e = httpError(403, 'Suivez cette chaîne pour voir ses publications et ses documents.');
    e.code = 'follow_required';
    throw e;
  }
}

const router = express.Router();
router.use(requireAuth);

// Classement des établissements dans la recherche et les suggestions : d'abord les campagnes
// « priorité dans la recherche » (marquées Sponsorisé), puis la priorité de la formule, puis
// le nombre d'abonnés. Une ville renseignée fait remonter les établissements proches.
function ranked(list, uid, { sponsoredSlots = 2, used = new Set() } = {}) {
  const u = data.users[uid];
  const near = (s) => (u?.city && fold(s.city) === fold(u.city) ? 1 : 0);
  const sorted = [...list].sort((a, b) => (OF.quota(b, 'rank') || 0) - (OF.quota(a, 'rank') || 0) || near(b) - near(a) || (b.followerIds || []).length - (a.followerIds || []).length);
  const ids = new Set(list.map(s => s.id));
  const promo = CP.pick(uid, 'search', sponsoredSlots, used).filter(x => ids.has(x.c.schoolId));
  for (const x of promo) CP.record(x.c, uid);
  const top = promo.map(x => ({ s: data.schools[x.c.schoolId], ad: x.c }));
  const rest = sorted.filter(s => !top.some(t => t.s.id === s.id)).map(s => ({ s }));
  return [...top, ...rest];
}
function listView(item, uid) {
  AU.seen(item.s.id, uid);
  const v = channelView(item.s, uid);
  if (item.ad) { v.sponsored = { adId: item.ad.id, why: CP.why(item.ad) }; }
  return v;
}

// « À la une » : publications mises en avant (formule Standard et plus, 7 jours), publications
// récentes des établissements « mise en avant dans le fil » (Pro et plus), annonces d'inscription
// mises en valeur, et au plus une publication sponsorisée toutes les 5 publications.
function aLaUne(uid, used) {
  const t = C.now();
  const items = [];
  for (const s of Object.values(data.schools)) {
    if (!active(s)) continue;
    const r = OF.currentPlan(s).plan.rights || {};
    for (const p of postsOf(s.id)) {
      const featured = r.featuredPosts && p.featuredUntil > t;
      const hl = r.feedHighlight && t - p.createdAt < 7 * 86400e3;
      const adm = r.admissionsHighlight && p.admission && t - p.createdAt < 30 * 86400e3;
      if (featured || hl || adm) items.push({ s, p, w: (featured ? 3 : 0) + (adm ? 2 : 0) + (hl ? 1 : 0) });
    }
  }
  items.sort((a, b) => b.w - a.w || b.p.createdAt - a.p.createdAt);
  // Une publication au plus par établissement, 12 au total.
  const one = new Set();
  const posts = items.filter(x => !one.has(x.s.id) && one.add(x.s.id)).slice(0, 12).map(({ s, p }) => {
    AU.seen(s.id, uid);
    AU.postSeen(s.id, p.id, uid);
    return { kind: 'post', post: { ...postView(p, uid), preview: postSnippet(p) }, channel: { id: s.id, name: s.name, logo: s.logo, verified: OF.showsVerified(s), founder: OF.isFounder(s) } };
  });
  const nAds = posts.length ? Math.ceil(posts.length / 5) : 1;
  const ads = CP.pick(uid, 'sponsored', nAds, used);
  const out = [];
  let k = 0;
  posts.forEach((x, i) => { out.push(x); if ((i + 1) % 5 === 2 && ads[k]) { out.push(adItem(ads[k++], uid, 'sponsored')); } });
  while (k < ads.length && out.length < 2 + posts.length) out.push(adItem(ads[k++], uid, 'sponsored'));
  return out;
}
function adItem(x, uid, placement) {
  CP.record(x.c, uid);
  return { kind: 'ad', ad: CP.adView(x.c, { big: x.big, placement }) };
}

router.get('/', (req, res) => {
  const uid = req.user.id;
  CP.refreshStatuses();
  const used = new Set();
  // Bannière : une seule à la fois (rotation, grand format Premium en priorité).
  const b = CP.pick(uid, 'banner', 1, used)[0];
  const banner = b ? adItem(b, uid, 'banner').ad : null;
  const mine = Object.keys(followsOf(uid)).map(id => data.schools[id]).filter(active);
  const following = mine.map(s => summary(s, uid)).sort((a, b) => (b.last?.createdAt || 0) - (a.last?.createdAt || 0));
  const others = Object.values(data.schools).filter(s => active(s) && !followsOf(uid)[s.id]);
  const suggestions = ranked(others, uid, { sponsoredSlots: 1, used }).slice(0, 20).map(x => listView(x, uid));
  const une = aLaUne(uid, used);
  const inquiries = Object.values(data.inquiries).filter(q => q.studentId === uid && active(data.schools[q.schoolId]) && visibleMessages(q, 'student').length)
    .sort((a, b) => b.updatedAt - a.updatedAt).map(q => inquiryView(q, 'student'));
  res.json({ following, suggestions, inquiries, types: SCHOOL_TYPES, banner, une });
});

// Annuaire : recherche par nom, ville, type, formation ou domaine de formation.
router.get('/channels', (req, res) => {
  const q = fold(req.query.q);
  let list = Object.values(data.schools).filter(active);
  const { domains, domainOf } = catalog;
  const hay = (s) => {
    const forms = OF.can(s, 'directory') ? (s.formations || []).map(f => `${f.title} ${f.filiere} ${domains[domainOf(f.filiere)] || ''}`).join(' ') : '';
    return fold(`${s.name} ${s.city} ${s.country} ${s.programs} ${SCHOOL_TYPES[s.type]} ${forms}`);
  };
  if (q) list = list.filter(s => hay(s).includes(q));
  if (req.query.type) list = list.filter(s => s.type === req.query.type);
  if (req.query.domain && domains[req.query.domain]) {
    list = list.filter(s => OF.can(s, 'directory') && (s.formations || []).some(f => domainOf(f.filiere) === req.query.domain));
  }
  res.json(ranked(list, req.user.id, { sponsoredSlots: q || req.query.type || req.query.domain ? 1 : 2 }).slice(0, 100).map(x => listView(x, req.user.id)));
});

router.get('/channels/:id', (req, res) => {
  const s = getSchool(req.params.id);
  const list = postsOf(s.id);
  // Visite de la chaîne (compteur agrégé) ; « from » : clic depuis une liste, la recherche ou À la une.
  AU.visit(s.id, req.user.id, ['suggestion', 'search', 'une', 'ad'].includes(req.query.from) ? req.query.from : null);
  if (req.query.post && req.query.from === 'une') AU.postClick(s.id, req.query.post, req.user.id);
  res.json({ ...channelView(s, req.user.id), media: list.filter(p => ['image', 'video', 'document'].includes(p.type) || /https?:\/\//.test(p.text || '')).length, hasInquiry: !!findInquiry(s.id, req.user.id) });
});

/* ---------------- Publicités (onglet Orientation uniquement) ---------------- */

function liveAd(id) {
  const c = data.campaigns[id];
  if (!c) throw httpError(404, 'Publicité introuvable.');
  return c;
}
router.post('/ads/:id/click', (req, res) => {
  const c = liveAd(req.params.id);
  AU.adClick(c.schoolId, c.id, req.user.id);
  res.json({ ok: true });
});
router.post('/ads/:id/hide', (req, res) => {
  const c = liveAd(req.params.id);
  const u = req.user;
  u.hiddenAds = [...new Set([...(u.hiddenAds || []), c.id])].slice(-200);
  AU.adHide(c.schoolId, c.id);
  save();
  res.json({ ok: true });
});
router.post('/ads/:id/report', (req, res) => {
  const c = liveAd(req.params.id);
  const u = req.user;
  u.hiddenAds = [...new Set([...(u.hiddenAds || []), c.id])].slice(-200);
  data.reports.push({
    id: C.uid('r_'), kind: 'ad', schoolId: c.schoolId, campaignId: c.id, classId: null, by: u.id, at: C.now(),
    reason: String(req.body.reason || '').slice(0, 500), userId: null,
    message: { id: c.id, kind: 'ad', text: `${c.title}${c.text ? ' — ' + c.text : ''}`.slice(0, 300), media: c.media?.url || null, at: c.createdAt }, resolved: false,
  });
  AU.adHide(c.schoolId, c.id);
  save();
  res.json({ ok: true });
});

router.get('/channels/:id/posts', (req, res) => {
  const s = getSchool(req.params.id);
  requireFollow(s, req.user.id);
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
    AU.follow(s.id, true);
    save();
  }
  res.json(summary(s, req.user.id));
});

router.delete('/channels/:id/follow', (req, res) => {
  const s = getSchool(req.params.id, { mustBeActive: false });
  if (followsOf(req.user.id)[s.id]) AU.follow(s.id, false);
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
  requireFollow(s, req.user.id);
  const f = followsOf(req.user.id)[s.id];
  f.lastReadAt = C.now();
  for (const p of postsOf(s.id).slice(-60)) {
    p.viewerIds ||= [];
    if (!p.viewerIds.includes(req.user.id)) p.viewerIds.push(req.user.id);
  }
  save();
  res.json({ ok: true });
});

router.get('/channels/:id/media', (req, res) => {
  const s = getSchool(req.params.id);
  requireFollow(s, req.user.id);
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
  requireFollow(school, req.user.id);
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
  requireFollow(s, req.user.id);
  let q = findInquiry(s.id, req.user.id);
  if (!q) {
    q = { id: C.uid('q_'), schoolId: s.id, studentId: req.user.id, createdAt: C.now(), updatedAt: C.now(), messages: [], readBySchoolAt: 0, readByStudentAt: C.now() };
    data.inquiries[q.id] = q;
  }
  const m = addInquiryMessage(q, 'student', req.body);
  res.json({ inquiry: inquiryView(q, 'student'), message: m });
});

// « Demander des informations » : formulaire court (formation, question facultative) qui crée une
// demande marquée dans la messagerie de l'établissement. Possible sans suivre la chaîne : c'est
// l'élève lui-même qui choisit de contacter l'établissement (depuis sa page ou une publicité).
router.post('/inquiries/with/:schoolId/info-request', (req, res) => {
  const s = getSchool(req.params.schoolId);
  if (!OF.can(s, 'infoButton')) throw httpError(403, 'Cet établissement ne reçoit pas de demandes d\'informations pour le moment : suivez sa chaîne pour lui écrire.');
  const b = req.body;
  const f = b.formationId ? (s.formations || []).find(x => x.id === b.formationId) : null;
  const formation = String(f?.title || b.formation || '').trim().slice(0, 120);
  const question = String(b.question || '').trim().slice(0, 2000);
  const text = `📋 Demande d'informations${formation ? ` — ${formation}` : ''}${question ? `\n${question}` : ''}`;
  let q = findInquiry(s.id, req.user.id);
  if (!q) {
    q = { id: C.uid('q_'), schoolId: s.id, studentId: req.user.id, createdAt: C.now(), updatedAt: C.now(), messages: [], readBySchoolAt: 0, readByStudentAt: C.now() };
    data.inquiries[q.id] = q;
  }
  const m = addInquiryMessage(q, 'student', { text, info: { formation, source: b.source } });
  if (b.adId && data.campaigns[b.adId]?.schoolId === s.id) AU.adContact(s.id, b.adId);
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
