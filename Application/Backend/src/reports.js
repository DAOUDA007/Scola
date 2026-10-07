// Rapports des établissements (rapport mensuel, bilan annuel) et indicateurs financiers de
// l'administration. Uniquement des agrégats : aucune donnée individuelle d'élève.
const C = require('./core');
const OF = require('./offers');
const AU = require('./audience');
const CP = require('./campaigns');
const { data } = C;
const { DAY } = OF;

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const monthStart = (y, m) => Date.UTC(y, m, 1);
const keyOf = (t) => new Date(t).toISOString().slice(0, 7);
const parseMonth = (m) => {
  const r = /^(\d{4})-(\d{2})$/.exec(String(m || ''));
  if (!r) return null;
  return { y: Number(r[1]), m: Number(r[2]) - 1 };
};
const sum = (series, keys) => Object.fromEntries(keys.map(k => [k, series.reduce((a, b) => a + (b[k] || 0), 0)]));
const ALL = Object.keys(AU.METRICS);
const BASIC = ['v', 'f', 'x', 'k', 'q'];

// Mois disponibles : ceux qui ont des compteurs, jusqu'au mois en cours (12 derniers).
function availableMonths(s) {
  const now = new Date();
  const out = [];
  for (let i = 0; i < 12; i++) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const st = data.stats[s.id] || {};
  const has = (k) => Object.keys(st.days || {}).some(d => d.startsWith(k)) || st.months?.[k];
  return out.filter(k => has(k) || k === out[0]);
}

// Résultats d'une campagne sur une période (jours de la campagne compris dans [from, to[).
function campaignOver(c, from, to) {
  const days = AU.campaignReport(c.schoolId, c.id).days.filter(d => { const t = Date.parse(d.d); return t >= from && t < to; });
  const t = sum(days, ['i', 'r', 'c', 'k', 'h']);
  return { id: c.id, title: c.title, type: OF.offers().campaignTypes[c.type]?.name || c.type, start: c.start, end: c.end, status: CP.effectiveStatus(c), price: c.price, included: c.paidBy !== 'payment', ...t, costPerContact: t.k ? Math.round(c.price / t.k) : null };
}

/* ---------------- Rapport mensuel (Pro et plus) ---------------- */

function monthly(s, month) {
  OF.requireRight(s, 'monthlyReport');
  const p = parseMonth(month) || (() => { const d = new Date(); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; })();
  const from = monthStart(p.y, p.m), to = monthStart(p.y, p.m + 1);
  if (from > Date.now()) throw bad('Ce mois n\'a pas encore commencé.');
  const th = OF.offers().privacyThreshold || 10;
  const series = AU.daily(s.id, from, Math.min(to, Date.now() + DAY));
  const prevSeries = AU.daily(s.id, monthStart(p.y, p.m - 1), from);
  const totals = sum(series, ALL), previous = sum(prevSeries, ALL);
  const ps = data.stats[s.id]?.posts || {};
  const posts = (data.posts[s.id] || []).filter(x => x.createdAt >= from && x.createdAt < to)
    .map(x => ({ text: (x.text || x.media?.name || 'Publication').replace(/\s+/g, ' ').slice(0, 120), createdAt: x.createdAt, reach: (x.viewerIds || []).length, reactions: Object.keys(x.reactions || {}).length, une: ps[x.id]?.i || 0, replies: ps[x.id]?.r || 0 }))
    .sort((a, b) => b.reach - a.reach);
  const campaigns = Object.values(data.campaigns).filter(c => c.schoolId === s.id && c.start && c.start < to && c.end > from && !['draft', 'rejected', 'awaiting_payment', 'in_review'].includes(c.status)).map(c => campaignOver(c, from, to));
  return {
    kind: 'monthly', month: keyOf(from), from, to, school: header(s), totals, previous, series,
    breakdown: { visit: AU.breakdown(s.id, from, to, 'visit', th), contact: AU.breakdown(s.id, from, to, 'contact', th) },
    posts: posts.slice(0, 5), postsCount: posts.length, campaigns, threshold: th, generatedAt: Date.now(),
  };
}

/* ---------------- Bilan annuel (formules payantes) ---------------- */

function annual(s) {
  OF.requireRight(s, 'statsBasic');
  const cp = OF.currentPlan(s);
  const rights = cp.plan.rights;
  const keys = rights.statsVisibility ? ALL : BASIC;
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k === 'm' || keys.includes(k)));
  // Période : les 12 derniers mois (glissants), quelle que soit la date du dernier renouvellement.
  const now = Date.now();
  const from = now - 365 * DAY;
  const months = AU.monthly(s.id, 12).map(pick);
  const series = AU.daily(s.id, from, now + DAY);
  const totals = pick(sum(series, ALL));
  const best = [...months].sort((a, b) => (b.v || 0) - (a.v || 0))[0];
  const campaigns = Object.values(data.campaigns).filter(c => c.schoolId === s.id && c.start && c.end > from && c.start < now && !['draft', 'rejected', 'awaiting_payment', 'in_review'].includes(c.status)).map(c => campaignOver(c, from, now + DAY));
  // Ce que l'établissement a investi sur la période : abonnements au prorata des jours couverts
  // dans la période, plus les campagnes payées diffusées sur la période.
  const paid = Math.round(Object.values(data.payments).reduce((a, x) => {
    if (x.schoolId !== s.id || x.cancelled) return a;
    const sub = x.subscriptionId && data.subscriptions[x.subscriptionId];
    if (sub) {
      const overlap = Math.max(0, Math.min(sub.end, now) - Math.max(sub.start, from));
      return a + (sub.end > sub.start ? (x.amount * overlap) / (sub.end - sub.start) : 0);
    }
    const c = x.campaignId && data.campaigns[x.campaignId];
    return c && c.end > from && c.start < now ? a + x.amount : a;
  }, 0) / 100) * 100;
  const contacts = (totals.k || 0);
  return {
    kind: 'annual', from, to: now, school: header(s), plan: { name: cp.plan.name, status: cp.status, paidUntil: cp.paidUntil, end: cp.end }, metrics: keys,
    totals, months, best: best && best.v ? { m: best.m, v: best.v } : null, followers: (s.followerIds || []).length,
    campaigns, invested: paid, costPerContact: contacts && paid ? Math.round(paid / contacts) : null, generatedAt: now,
    renewalSoon: cp.paidUntil ? Math.ceil((cp.paidUntil - now) / DAY) : null,
  };
}

function header(s) {
  return { id: s.id, name: s.name, logo: s.logo, city: s.city, country: s.country, plan: OF.currentPlan(s).plan.name, founder: OF.isFounder(s) };
}

/* ---------------- Finances (administration) ---------------- */

function finance() {
  const now = new Date();
  const t = now.getTime();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const pays = Object.values(data.payments).filter(p => !p.cancelled);
  const inRange = (a, b) => pays.filter(p => p.at >= a && p.at < b);
  const total = (list) => list.reduce((a, p) => a + p.amount, 0);
  const split = (list) => ({ total: total(list), subscriptions: total(list.filter(p => p.subscriptionId)), campaigns: total(list.filter(p => p.campaignId)), count: list.length });
  const months = Array.from({ length: 12 }, (_, i) => {
    const a = monthStart(y, m - 11 + i), b = monthStart(y, m - 10 + i);
    return { m: keyOf(a), ...split(inRange(a, b)) };
  });
  // Formules en cours.
  const schools = Object.values(data.schools).filter(s => ['active', 'suspended'].includes(s.status));
  const byPlan = {};
  for (const s of schools) {
    const cp = OF.currentPlan(s);
    const k = cp.code;
    byPlan[k] ||= { code: k, name: cp.plan.name, count: 0, grace: 0, revenueYear: 0 };
    byPlan[k].count++;
    if (cp.status === 'grace') byPlan[k].grace++;
  }
  for (const p of inRange(monthStart(y, 0), monthStart(y + 1, 0))) {
    const sub = p.subscriptionId && data.subscriptions[p.subscriptionId];
    if (!sub) continue;
    const name = OF.planDef(sub.plan).name;
    (byPlan[sub.plan] ||= { code: sub.plan, name, count: 0, grace: 0, revenueYear: 0 }).revenueYear += p.amount;
  }
  // Renouvellements à venir (60 jours) : abonnements sans période suivante déjà réglée.
  const upcoming = schools.map(s => ({ s, cp: OF.currentPlan(s) }))
    .filter(({ cp }) => (cp.status === 'active' && !cp.next && cp.paidUntil - t <= 60 * DAY) || cp.status === 'grace')
    .map(({ s, cp }) => ({ id: s.id, name: s.name, plan: cp.plan.name, status: cp.status, paidUntil: cp.paidUntil, daysLeft: Math.ceil((cp.paidUntil - t) / DAY), founder: !!s.founder && !s.founder.rateLost, price: OF.planDef(cp.code).price }))
    .sort((a, b) => a.paidUntil - b.paidUntil);
  // Taux de renouvellement (12 derniers mois) : périodes échues (hors montées en gamme, grâce passée)
  // suivies d'un nouvel abonnement commençant au plus tard à la fin de la période de grâce.
  const grace = (OF.offers().graceDays || 0) * DAY;
  const subs = Object.values(data.subscriptions).filter(x => !x.cancelled);
  const seen = new Set();
  let due = 0, renewed = 0;
  for (const x of subs) {
    if (x.kind === 'upgrade' || x.end + grace > t || x.end < t - 365 * DAY) continue;
    const key = x.schoolId + ':' + x.end;
    if (seen.has(key)) continue;
    seen.add(key);
    due++;
    if (subs.some(o => o.schoolId === x.schoolId && o.kind !== 'upgrade' && o.start >= x.end - DAY && o.start <= x.end + grace)) renewed++;
  }
  const camp = Object.values(data.campaigns).map(c => CP.effectiveStatus(c));
  return {
    month: split(inRange(monthStart(y, m), monthStart(y, m + 1))),
    year: split(inRange(monthStart(y, 0), monthStart(y + 1, 0))),
    months,
    byPlan: Object.values(byPlan).sort((a, b) => (OF.planDef(a.code).order ?? 0) - (OF.planDef(b.code).order ?? 0)),
    upcoming, renewal: { due, renewed, rate: due ? Math.round((renewed / due) * 100) : null },
    campaigns: { active: camp.filter(x => x === 'active').length, scheduled: camp.filter(x => x === 'scheduled').length, queue: camp.filter(x => ['in_review', 'awaiting_payment'].includes(x)).length },
    founder: { taken: OF.founderSeatsTaken(), seats: OF.offers().founder.seats },
  };
}

module.exports = { availableMonths, monthly, annual, finance };
