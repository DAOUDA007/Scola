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
const OF = backendRequire('./src/offers');
const B = backendRequire('./src/billing');
const AU = backendRequire('./src/audience');
const CP = backendRequire('./src/campaigns');
const RP = backendRequire('./src/reports');
const catalog = backendRequire('./src/catalog');
const { data, save } = C;
const DAY = 86400e3;

const router = express.Router();
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const clip = (v, n) => String(v || '').trim().slice(0, n);
const isMedia = (u) => typeof u === 'string' && /^\/media\/[a-f0-9]{32}(\.[a-z0-9]{1,7})?$/.test(u);

function selfView(s) {
  return {
    ...O.channelView(s), status: s.status, requestedAt: s.requestedAt, activatedAt: s.activatedAt || null,
    manager: s.manager, email: s.email, mustChangePassword: false,
    // L'établissement voit toujours ses propres contenus, même masqués aux élèves par sa formule.
    formations: s.formations || [], gallery: s.gallery || [], admissions: s.admissions || null,
    offer: { ...OF.offerState(s), banner: B.banner(s) },
  };
}

// Contenus de la page officielle. Retirer est toujours permis ; ajouter ou modifier demande la formule.
const sameOrSubset = (next, prev, key) => next.every(x => prev.some(y => JSON.stringify(key(y)) === JSON.stringify(key(x))));
function officialFields(b, s) {
  const out = {};
  if (b.formations !== undefined) {
    if (!Array.isArray(b.formations)) throw httpError(400, 'Liste de formations invalide.');
    const list = b.formations.slice(0, 60).map(f => {
      const title = clip(f.title, 120);
      if (title.length < 2) throw httpError(400, 'Donnez un intitulé à chaque formation.');
      return {
        id: typeof f.id === 'string' && /^[a-z0-9_]{4,40}$/i.test(f.id) ? f.id : C.uid('f_'), title,
        cycle: catalog.cycles.some(c => c.id === f.cycle) ? f.cycle : '', filiere: clip(f.filiere, 80),
        entryLevel: clip(f.entryLevel, 60), duration: clip(f.duration, 40), fees: clip(f.fees, 80),
      };
    });
    if (!OF.can(s, 'fullPage') && !sameOrSubset(list, s.formations || [], x => [x.id, x.title, x.cycle, x.filiere, x.entryLevel, x.duration, x.fees])) OF.requireRight(s, 'fullPage');
    out.formations = list;
  }
  if (b.gallery !== undefined) {
    if (!Array.isArray(b.gallery) || b.gallery.some(u => !isMedia(u))) throw httpError(400, 'Photos invalides.');
    const list = [...new Set(b.gallery)].slice(0, 20);
    if (!OF.can(s, 'fullPage') && !list.every(u => (s.gallery || []).includes(u))) OF.requireRight(s, 'fullPage');
    out.gallery = list;
  }
  if (b.admissions !== undefined) {
    if (b.admissions === null) out.admissions = null;
    else {
      OF.requireRight(s, 'admissions');
      const a = b.admissions;
      const day = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
      out.admissions = { open: !!a.open, start: day(a.start), end: day(a.end), deadline: day(a.deadline), fees: clip(a.fees, 200), conditions: clip(a.conditions, 2000), documents: clip(a.documents, 2000), updatedAt: C.now() };
      if (out.admissions.start && out.admissions.end && out.admissions.end < out.admissions.start) throw httpError(400, 'La clôture des inscriptions précède leur ouverture.');
    }
  }
  return out;
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
  Object.assign(f, officialFields(req.body, req.school));
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
  OF.checkPostQuota(req.school);
  const text = clip(b.text, 6000);
  const media = b.media ? cleanMedia(b.media) : null;
  if (!text && !media) throw httpError(400, 'La publication est vide.');
  const type = !media ? 'text' : /^image\//.test(media.mime) ? 'image' : /^video\//.test(media.mime) ? 'video' : 'document';
  const p = { id: C.uid('p_'), schoolId: req.school.id, type, text, media, createdAt: C.now(), reactions: {}, viewerIds: [], admission: !!b.admission };
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
  if (typeof req.body.admission === 'boolean') p.admission = req.body.admission;
  p.editedAt = C.now();
  save();
  for (const uid of req.school.followerIds || []) if (C.isOnline(uid)) C.toUser(uid, 'orientation:update', O.postView(p, uid));
  res.json(O.postView(p));
});

// Mise en avant (formule Standard et plus) : en tête de la chaîne et dans « À la une » pendant
// featuredDays jours, dans la limite du quota mensuel. Un retrait anticipé ne rend pas le crédit.
router.post('/posts/:id/feature', (req, res) => {
  const s = req.school;
  OF.requireRight(s, 'featuredPosts');
  const p = O.postsOf(s.id).find(x => x.id === req.params.id);
  if (!p) throw httpError(404, 'Publication introuvable.');
  if (p.featuredUntil > C.now()) throw httpError(400, 'Cette publication est déjà mise en avant.');
  const max = OF.quota(s, 'featuredPerMonth');
  if (max !== null && OF.featuredThisMonth(s) >= max) throw httpError(403, `Vous avez utilisé vos ${max} mises en avant de ce mois-ci.`);
  p.featuredUntil = C.now() + (OF.offers().featuredDays || 7) * DAY;
  (s.featureLog ||= []).push({ at: C.now(), postId: p.id });
  s.featureLog = s.featureLog.filter(x => x.at > C.now() - 400 * DAY);
  save();
  res.json(O.postView(p));
});
router.delete('/posts/:id/feature', (req, res) => {
  const p = O.postsOf(req.school.id).find(x => x.id === req.params.id);
  if (!p) throw httpError(404, 'Publication introuvable.');
  p.featuredUntil = null;
  save();
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
// Ce que l'établissement voit dépend de sa formule (décidé ici, côté serveur). Uniquement des
// agrégats ; toute catégorie de moins de `privacyThreshold` élèves est masquée.
router.get('/stats', (req, res) => {
  const s = req.school;
  const r = OF.currentPlan(s).plan.rights || {};
  const th = OF.offers().privacyThreshold || 10;
  const posts = O.postsOf(s.id);
  const byCycle = {};
  for (const uid of s.followerIds || []) {
    const cls = data.classes[data.users[uid]?.classId];
    const k = cls?.cycleLabel || 'Autre';
    byCycle[k] = (byCycle[k] || 0) + 1;
  }
  const rows = Object.entries(byCycle).sort((a, b) => b[1] - a[1]);
  const small = rows.filter(([, n]) => n < th);
  const cycles = rows.filter(([, n]) => n >= th);
  if (small.length) { const sum = small.reduce((a, [, n]) => a + n, 0); cycles.push([`Autres niveaux (moins de ${th} chacun)`, sum >= th ? sum : null]); }
  const inquiries = Object.values(data.inquiries).filter(q => q.schoolId === s.id && O.visibleMessages(q, 'school').length);
  const out = {
    followers: (s.followerIds || []).length, posts: posts.length,
    views: posts.reduce((n, p) => n + (p.viewerIds || []).length, 0),
    reactions: posts.reduce((n, p) => n + Object.keys(p.reactions || {}).length, 0),
    inquiries: inquiries.length, unread: inquiries.reduce((n, q) => n + O.inquiryView(q, 'school').unread, 0),
    byCycle: cycles, threshold: th, rights: r,
  };
  if (!r.statsBasic) return res.json(out);
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
  const metrics = r.statsVisibility ? ['i', 'v', 'u', 'c', 'f', 'k', 'q'] : ['v', 'f', 'k', 'q'];
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k === 'd' || k === 'm' || metrics.includes(k)));
  const to = Date.parse(AU.dayKey()) + DAY, from = to - days * DAY;
  const series = AU.daily(s.id, from, to).map(pick);
  Object.assign(out, { metrics, period: { days, from, to }, series, totals: pick(AU.total(series)) });
  if (r.statsAdvanced) {
    const prev = AU.daily(s.id, from - days * DAY, from).map(pick);
    out.previous = { series: prev, totals: pick(AU.total(prev)) };
    out.funnel = [{ label: 'ont vu votre établissement', n: out.totals.i }, { label: 'ont visité votre chaîne', n: out.totals.u }, { label: 'vous ont contacté', n: out.totals.k }];
  }
  if (r.statsVisibility) {
    out.months = AU.monthly(s.id, 12).map(pick);
    const ps = data.stats[s.id]?.posts || {};
    out.postStats = [...posts].reverse().slice(0, 30).map(p => ({
      id: p.id, text: O.postSnippet(p), createdAt: p.createdAt, reach: (p.viewerIds || []).length, reactions: Object.keys(p.reactions || {}).length,
      une: ps[p.id]?.i || 0, clicks: ps[p.id]?.c || 0, replies: ps[p.id]?.r || 0, featured: p.featuredUntil > C.now(), admission: !!p.admission,
    }));
    out.weeks = [];
    for (let w = 7; w >= 0; w--) {
      const a = to - (w + 1) * 7 * DAY;
      out.weeks.push({ from: AU.dayKey(a), ...pick(AU.total(AU.daily(s.id, a, a + 7 * DAY))) });
    }
  }
  if (r.statsBreakdown) out.breakdown = { visit: AU.breakdown(s.id, from, to, 'visit', th), contact: AU.breakdown(s.id, from, to, 'contact', th) };
  res.json(out);
});

/* ---------------- Ma formule ---------------- */

router.get('/offer', (req, res) => {
  const s = req.school;
  const o = OF.offers();
  const founderOk = B.founderEligibility(s).eligible;
  const plans = Object.values(o.plans).filter(p => p.purchasable && (p.code !== 'fondateur' || founderOk)).sort((a, b) => a.order - b.order).map(p => OF.planSummary(p.code));
  const cur = OF.currentPlan(s);
  if (!plans.some(p => p.code === cur.code) && cur.code !== 'gratuit') plans.unshift(OF.planSummary(cur.code));
  res.json({
    offer: { ...OF.offerState(s), banner: B.banner(s) }, plans, rights: OF.RIGHTS,
    requests: Object.values(data.planRequests).filter(r => r.schoolId === s.id).sort((a, b) => b.at - a.at).map(r => ({ ...r, planName: OF.planDef(r.plan).name })),
    paymentInstructions: o.paymentInstructions, methods: B.METHODS,
    // Reçus de paiement envoyés par l'établissement et reçus Scola envoyés par l'administration.
    proofs: Object.values(data.paymentProofs).filter(p => p.schoolId === s.id).sort((a, b) => b.at - a.at).slice(0, 50).map(B.proofView),
    receipts: Object.values(data.payments).filter(p => p.schoolId === s.id && p.sentAt && !p.cancelled).sort((a, b) => b.at - a.at)
      .map(p => ({ id: p.id, receiptNo: p.receiptNo, amount: p.amount, label: p.label, at: p.at, sentAt: p.sentAt })),
    marketingContact: OF.can(s, 'marketingSupport') ? o.marketingContact : null,
    founder: { seatsLeft: Math.max(0, o.founder.seats - OF.founderSeatsTaken()), guaranteedYears: o.founder.guaranteedYears },
  });
});

// Demande de formule (souscription, renouvellement ou montée en gamme) : arrive dans l'administration.
router.post('/offer/request', (req, res) => {
  const s = req.school;
  const p = OF.offers().plans[req.body.plan];
  if (!p || !p.purchasable || p.code === 'gratuit') throw httpError(400, 'Formule indisponible.');
  if (p.code === 'fondateur') { const f = B.founderEligibility(s); if (!f.eligible) throw httpError(400, f.reason); }
  if (Object.values(data.planRequests).some(r => r.schoolId === s.id && r.status === 'pending')) throw httpError(400, 'Une demande est déjà en cours : l\'équipe Scola vous recontacte.');
  const r = { id: C.uid('rq_'), schoolId: s.id, plan: p.code, message: clip(req.body.message, 1000), at: C.now(), status: 'pending' };
  data.planRequests[r.id] = r;
  save();
  const admins = Object.values(data.admins).map(a => a.email).filter(Boolean);
  if (admins.length) mail.send({ to: admins.join(','), subject: `Scola — demande de formule : ${s.name} (${p.name})`, text: `« ${s.name} » demande la formule ${p.name} (${p.price.toLocaleString('fr-FR')} FCFA / an).${r.message ? `\n\nMessage : ${r.message}` : ''}\n\nEnregistrez le paiement dans l'administration, rubrique Abonnements.` });
  res.json({ request: { ...r, planName: p.name }, paymentInstructions: OF.offers().paymentInstructions });
});

// « Envoyer mon reçu de paiement » : capture ou PDF du paiement, transmis à l'administration.
router.post('/offer/proof', (req, res) => res.json(B.proofView(B.createProof(req.school, req.body))));

// Reçu Scola envoyé par l'administration (consultable et imprimable dans l'espace).
router.get('/receipts/:id', (req, res) => {
  const p = data.payments[req.params.id];
  if (!p || p.schoolId !== req.school.id || !p.sentAt) throw httpError(404, 'Reçu introuvable.');
  res.json(B.paymentView(p));
});

/* ---------------- Campagnes publicitaires ---------------- */

function myCampaign(req) {
  const c = data.campaigns[req.params.id];
  if (!c || c.schoolId !== req.school.id) throw httpError(404, 'Campagne introuvable.');
  return c;
}

router.get('/campaigns', (req, res) => {
  const s = req.school;
  CP.refreshStatuses();
  const o = OF.offers();
  res.json({
    campaigns: Object.values(data.campaigns).filter(c => c.schoolId === s.id).sort((a, b) => b.createdAt - a.createdAt).map(c => CP.view(c)),
    credits: CP.credits(s), allowed: CP.allowed(s), ctas: CP.CTA, placements: OF.PLACEMENTS,
    types: Object.values(o.campaignTypes).filter(t => t.active),
    catalog: { countries: catalog.countries, cycles: catalog.cycles.map(c => ({ id: c.id, label: c.label, niveaux: c.niveaux })), cities: catalog.cities, domains: catalog.domains },
    country: catalog.countries.includes(s.country) ? s.country : "Côte d'Ivoire",
    frequencyCap: o.frequencyCap, threshold: o.privacyThreshold || 10, paymentInstructions: o.paymentInstructions, methods: B.METHODS,
    proofs: Object.values(data.paymentProofs).filter(p => p.schoolId === s.id && p.kind === 'campaign').map(B.proofView),
  });
});

// Estimation de l'audience : nombre d'élèves correspondants, arrondi (jamais de liste).
router.post('/campaigns/estimate', (req, res) => {
  const f = CP.sanitize({ ...req.body, title: 'estimation', media: null, cta: { kind: 'channel' }, start: null }, req.school);
  res.json({ ...CP.estimate(f.targeting), describe: CP.describe(f.targeting), personal: CP.isPersonal(f.targeting) });
});

router.post('/campaigns', (req, res) => res.json(CP.view(CP.create(req.school, req.body))));
router.patch('/campaigns/:id', (req, res) => res.json(CP.view(CP.update(myCampaign(req), req.school, req.body))));
router.delete('/campaigns/:id', (req, res) => {
  const c = myCampaign(req);
  if (!['draft', 'rejected'].includes(c.status)) throw httpError(400, 'Seul un brouillon ou une campagne refusée peut être supprimé.');
  delete data.campaigns[c.id];
  save();
  res.json({ ok: true });
});
router.post('/campaigns/:id/submit', (req, res) => {
  const credit = req.body.credit === 'national' ? 'national' : req.body.credit === 'campaign' ? 'campaign' : undefined;
  res.json(CP.view(CP.submit(myCampaign(req), req.school, { credit })));
});

/* ---------------- Rapports (imprimables) ---------------- */

router.get('/reports', (req, res) => {
  const s = req.school;
  res.json({ annual: OF.can(s, 'statsBasic'), monthly: OF.can(s, 'monthlyReport'), months: RP.availableMonths(s) });
});
router.get('/reports/monthly', (req, res) => res.json(RP.monthly(req.school, req.query.m)));
router.get('/reports/annual', (req, res) => res.json(RP.annual(req.school)));

/* Avertissements de l'administration (après un signalement). */
router.get('/notices', (req, res) => res.json(backendRequire('./src/inbox').noticesOf({ schoolId: req.school.id })));
router.post('/notices/:id/read', (req, res) => {
  const n = data.notices?.[req.params.id];
  if (!n || n.schoolId !== req.school.id) throw httpError(404, 'Avertissement introuvable.');
  n.readAt = C.now();
  save();
  res.json({ ok: true });
});

/* Messages des élèves (l'établissement ne peut que répondre, jamais écrire le premier). */
function myInquiry(req) {
  const q = data.inquiries[req.params.id];
  if (!q || q.schoolId !== req.school.id) throw httpError(404, 'Conversation introuvable.');
  return q;
}

router.get('/inquiries', (req, res) => {
  res.json(Object.values(data.inquiries).filter(q => q.schoolId === req.school.id && O.visibleMessages(q, 'school').length)
    .sort((a, b) => b.updatedAt - a.updatedAt).map(q => O.inquiryView(q, 'school')));
});

router.get('/inquiries/:id', (req, res) => {
  const q = myInquiry(req);
  res.json({ inquiry: O.inquiryView(q, 'school'), messages: O.visibleMessages(q, 'school').slice(-300) });
});

router.delete('/inquiries/:id', (req, res) => {
  O.clearInquiry(myInquiry(req), 'school');
  res.json({ ok: true });
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
