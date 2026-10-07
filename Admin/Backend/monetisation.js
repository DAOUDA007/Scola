// Administration de la monétisation (/api/admin/billing/…) : abonnements des établissements,
// paiements et reçus, demandes de formule, offres et tarifs.
// Monté par admin.js APRÈS la vérification de la session administrateur.
const path = require('path');
const { createRequire } = require('module');
const BACKEND = process.env.SCOLA_BACKEND || path.join(__dirname, '..', '..', 'Application', 'Backend');
const backendRequire = createRequire(path.join(BACKEND, 'package.json'));
const express = backendRequire('express');
const C = backendRequire('./src/core');
const O = backendRequire('./src/orientation');
const OF = backendRequire('./src/offers');
const B = backendRequire('./src/billing');
const CP = backendRequire('./src/campaigns');
const RP = backendRequire('./src/reports');
const { httpError } = backendRequire('./src/auth');
const { data } = C;

const router = express.Router();
const DAY = OF.DAY;

function getSchool(id) {
  const s = data.schools[id];
  if (!s) throw httpError(404, 'Établissement introuvable.');
  return s;
}

function row(s) {
  const cp = OF.currentPlan(s);
  const pays = Object.values(data.payments).filter(p => p.schoolId === s.id && !p.cancelled);
  const last = pays.sort((a, b) => b.at - a.at)[0];
  return {
    id: s.id, name: s.name, logo: s.logo, city: s.city, country: s.country, email: s.email, status: s.status,
    plan: cp.code, planName: cp.plan.name, planStatus: cp.status, end: cp.end, paidUntil: cp.paidUntil, graceEnd: cp.graceEnd || null,
    daysLeft: cp.paidUntil ? Math.ceil((cp.paidUntil - C.now()) / DAY) : null,
    founder: s.founder ? { seat: s.founder.seat, rateLost: !!s.founder.rateLost, rateUntil: s.founder.rateUntil } : null,
    verified: !!s.verified, verifiedShown: OF.showsVerified(s),
    lastPayment: last ? { at: last.at, amount: last.amount } : null,
    pendingRequest: Object.values(data.planRequests).find(r => r.schoolId === s.id && r.status === 'pending') || null,
  };
}

function requestView(r) {
  const s = data.schools[r.schoolId];
  return { ...r, schoolName: s?.name || 'Établissement supprimé', planName: OF.planDef(r.plan).name, handledByName: r.handledBy ? data.admins[r.handledBy]?.name || '—' : null };
}

/* ---------------- Abonnements ---------------- */

router.get('/billing/subscriptions', (req, res) => {
  let list = Object.values(data.schools).filter(s => ['active', 'suspended'].includes(s.status)).map(row);
  const counts = { all: list.length, active: 0, grace: 0, none: 0, soon: 0, byPlan: {} };
  for (const r of list) {
    counts[r.planStatus]++;
    counts.byPlan[r.plan] = (counts.byPlan[r.plan] || 0) + 1;
    if (r.planStatus !== 'none' && r.daysLeft !== null && r.daysLeft <= 60) counts.soon++;
  }
  const q = O.fold(req.query.q);
  if (q) list = list.filter(r => O.fold(`${r.name} ${r.city} ${r.email}`).includes(q));
  if (req.query.plan) list = list.filter(r => r.plan === req.query.plan);
  if (req.query.status) list = list.filter(r => r.planStatus === req.query.status);
  if (req.query.soon) list = list.filter(r => r.planStatus !== 'none' && r.daysLeft !== null && r.daysLeft <= Number(req.query.soon));
  list.sort((a, b) => (a.planStatus === 'none') - (b.planStatus === 'none') || (a.paidUntil || Infinity) - (b.paidUntil || Infinity) || a.name.localeCompare(b.name, 'fr'));
  const o = OF.offers();
  res.json({
    counts, rows: list,
    plans: Object.values(o.plans).sort((a, b) => a.order - b.order).map(p => ({ code: p.code, name: p.name, price: p.price, purchasable: p.purchasable })),
    founder: { taken: OF.founderSeatsTaken(), seats: o.founder.seats, guaranteedYears: o.founder.guaranteedYears },
    pendingRequests: Object.values(data.planRequests).filter(r => r.status === 'pending').length,
    methods: B.METHODS,
  });
});

router.get('/billing/schools/:id', (req, res) => {
  const s = getSchool(req.params.id);
  B.checkFounderContinuity(s);
  const subs = Object.values(data.subscriptions).filter(x => x.schoolId === s.id).sort((a, b) => b.createdAt - a.createdAt).map(B.subView);
  const payments = Object.values(data.payments).filter(p => p.schoolId === s.id).sort((a, b) => b.at - a.at).map(p => ({ id: p.id, receiptNo: p.receiptNo, amount: p.amount, method: p.method, methodLabel: B.METHODS[p.method] || p.method, reference: p.reference, at: p.at, label: p.label, cancelled: !!p.cancelled }));
  const requests = Object.values(data.planRequests).filter(r => r.schoolId === s.id).sort((a, b) => b.at - a.at).map(requestView);
  res.json({ ...row(s), offer: OF.offerState(s), banner: B.banner(s), subscriptions: subs, payments, requests, founderEligibility: B.founderEligibility(s), methods: B.METHODS });
});

router.get('/billing/schools/:id/quote', (req, res) => {
  res.json(B.quote(getSchool(req.params.id), String(req.query.plan || '')));
});

router.post('/billing/schools/:id/subscriptions', (req, res) => {
  const r = B.recordSubscription(getSchool(req.params.id), req.body, req.admin);
  res.json({ subscription: B.subView(r.subscription), payment: B.paymentView(r.payment) });
});

router.post('/billing/subscriptions/:id/extend', (req, res) => res.json(B.subView(B.extend(B.getSub(req.params.id), req.body.days, req.body.note, req.admin))));
router.post('/billing/subscriptions/:id/plan', (req, res) => res.json(B.subView(B.changePlan(B.getSub(req.params.id), req.body.plan, req.body.note, req.admin))));
router.post('/billing/subscriptions/:id/cancel', (req, res) => res.json(B.subView(B.cancel(B.getSub(req.params.id), req.body.note, req.admin))));

/* ---------------- Reçus ---------------- */

router.get('/billing/payments/:id', (req, res) => {
  const p = data.payments[req.params.id];
  if (!p) throw httpError(404, 'Paiement introuvable.');
  res.json(B.paymentView(p));
});

/* ---------------- Demandes de formule ---------------- */

router.get('/billing/requests', (req, res) => {
  let list = Object.values(data.planRequests);
  if (req.query.status) list = list.filter(r => r.status === req.query.status);
  res.json(list.sort((a, b) => b.at - a.at).slice(0, 300).map(requestView));
});

router.post('/billing/requests/:id', (req, res) => {
  const r = data.planRequests[req.params.id];
  if (!r) throw httpError(404, 'Demande introuvable.');
  if (!['pending', 'done', 'rejected'].includes(req.body.status)) throw httpError(400, 'Statut invalide.');
  Object.assign(r, { status: req.body.status, handledBy: req.body.status === 'pending' ? null : req.admin.id, handledAt: C.now(), note: String(req.body.note || r.note || '').slice(0, 500) });
  C.save();
  res.json(requestView(r));
});

/* ---------------- Campagnes publicitaires ---------------- */

function getCampaign(id) {
  const c = data.campaigns[id];
  if (!c) throw httpError(404, 'Campagne introuvable.');
  return c;
}

router.get('/billing/campaigns', (req, res) => {
  CP.refreshStatuses();
  const all = Object.values(data.campaigns).filter(c => c.status !== 'draft');
  const counts = {};
  for (const c of all) { const st = CP.effectiveStatus(c); counts[st] = (counts[st] || 0) + 1; }
  let list = all;
  if (req.query.status === 'queue') list = list.filter(c => ['awaiting_payment', 'in_review'].includes(c.status));
  else if (req.query.status) list = list.filter(c => CP.effectiveStatus(c) === req.query.status);
  const order = { in_review: 0, awaiting_payment: 1, active: 2, scheduled: 3, suspended: 4, ended: 5, rejected: 6 };
  list.sort((a, b) => (order[CP.effectiveStatus(a)] ?? 9) - (order[CP.effectiveStatus(b)] ?? 9) || (b.submittedAt || 0) - (a.submittedAt || 0));
  res.json({ counts, campaigns: list.map(c => { const v = CP.view(c, { admin: true }); delete v.report; return v; }), statuses: CP.STATUS, methods: B.METHODS });
});

router.get('/billing/campaigns/:id', (req, res) => {
  const c = getCampaign(req.params.id);
  const s = data.schools[c.schoolId];
  res.json({
    ...CP.view(c, { admin: true }), estimate: CP.estimate(c.targeting),
    preview: s ? { ...CP.adView(c, { placement: c.placements.includes('banner') ? 'banner' : 'sponsored', big: OF.can(s, 'bigBanner') }), sponsored: true } : null,
    plan: s ? OF.currentPlan(s).plan.name : '—', payment: c.paymentId ? data.payments[c.paymentId] || null : null, methods: B.METHODS,
  });
});

router.post('/billing/campaigns/:id/payment', (req, res) => {
  const p = B.recordCampaignPayment(getCampaign(req.params.id), req.body, req.admin);
  res.json({ payment: B.paymentView(p) });
});
router.post('/billing/campaigns/:id/approve', (req, res) => res.json(CP.view(CP.approve(getCampaign(req.params.id), req.admin), { admin: true })));
router.post('/billing/campaigns/:id/reject', (req, res) => res.json(CP.view(CP.reject(getCampaign(req.params.id), req.admin, req.body.reason), { admin: true })));
router.post('/billing/campaigns/:id/suspend', (req, res) => res.json(CP.view(CP.suspend(getCampaign(req.params.id), req.admin, req.body.reason), { admin: true })));
router.post('/billing/campaigns/:id/resume', (req, res) => res.json(CP.view(CP.resume(getCampaign(req.params.id), req.admin), { admin: true })));

/* ---------------- Tableau de bord financier ---------------- */

router.get('/billing/finance', (req, res) => res.json(RP.finance()));

/* ---------------- Offres et tarifs ---------------- */

function offersView() {
  return { ...OF.offers(), rights: OF.RIGHTS, quotas: OF.QUOTAS, placements: OF.PLACEMENTS, founderTaken: OF.founderSeatsTaken() };
}
router.get('/billing/offers', (req, res) => res.json(offersView()));
router.patch('/billing/offers', (req, res) => { OF.updateOffers(req.body || {}); res.json(offersView()); });

module.exports = router;
