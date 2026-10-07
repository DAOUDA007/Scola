// Campagnes publicitaires ponctuelles des établissements (onglet Orientation uniquement).
//
// Parcours : brouillon → en attente de paiement → en revue → programmée → active → terminée,
// plus refusée (avec motif) et suspendue. Une campagne payée par un crédit inclus dans la
// formule passe directement en revue. Toute campagne est validée par un administrateur.
//
// Règles de confiance : le ciblage est fait ici, par le serveur ; l'établissement ne reçoit que
// des chiffres agrégés. Jamais de publicité dans les classes, discussions, appels ni notifications.
const C = require('./core');
const OF = require('./offers');
const AU = require('./audience');
const catalog = require('./catalog');
const mail = require('./mail');
const { data, save } = C;
const { DAY } = OF;

const STATUS = {
  draft: 'Brouillon', awaiting_payment: 'En attente de paiement', in_review: 'En revue', scheduled: 'Programmée',
  active: 'Active', ended: 'Terminée', rejected: 'Refusée', suspended: 'Suspendue',
};
const CTA = { info: 'Demander des informations', channel: 'Voir la chaîne', link: 'En savoir plus' };

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/-/g, ' ').trim();
const startOfDay = (t = C.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const isMediaUrl = (u) => typeof u === 'string' && /^\/media\/[a-f0-9]{32}(\.[a-z0-9]{1,7})?$/.test(u);
const dateFr = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Préférence des élèves « Publicités personnalisées » (activée par défaut).
(function migrate() {
  let changed = false;
  for (const u of Object.values(data.users)) if (u.privacy && !('personalizedAds' in u.privacy)) { u.privacy.personalizedAds = true; changed = true; }
  if (changed) save();
})();

/* ---------------- Statuts ---------------- */

function effectiveStatus(c, t = C.now()) {
  if (c.status === 'scheduled' && t >= c.start) return t >= c.end ? 'ended' : 'active';
  if (c.status === 'active' && t >= c.end) return 'ended';
  return c.status;
}
function setStatus(c, status, by = null, note = '') {
  c.history ||= [];
  c.history.push({ at: C.now(), by, from: c.status, to: status, note: clip(note, 500) });
  c.status = status;
  c.updatedAt = C.now();
}
// Les campagnes programmées démarrent et s'arrêtent toutes seules.
function refreshStatuses() {
  let changed = false;
  for (const c of Object.values(data.campaigns)) {
    const e = effectiveStatus(c);
    if (e !== c.status && ['scheduled', 'active'].includes(c.status)) { setStatus(c, e, null, e === 'active' ? 'Début de la diffusion' : 'Fin de la période'); changed = true; }
  }
  if (changed) save();
}
setInterval(refreshStatuses, 60e3).unref();

/* ---------------- Droits et crédits ---------------- */

// Ce que la formule de l'établissement permet pour une campagne.
function allowed(s) {
  const r = OF.offerState(s).rights;
  return { banner: !!r.banner, bigBanner: !!r.bigBanner, targeting: !!r.targeting, video: !!r.videoAds, info: !!r.infoButton };
}

// Campagnes incluses dans l'abonnement en cours (par période de 12 mois). Une campagne refusée rend son crédit.
function credits(s) {
  const cp = OF.currentPlan(s);
  const q = cp.plan.quotas || {};
  const sub = cp.status !== 'none' ? cp.subscription : null;
  const used = (kind) => (sub ? Object.values(data.campaigns).filter(c => c.schoolId === s.id && c.paidBy === kind && c.status !== 'rejected' && c.creditAt >= sub.start && c.creditAt < sub.end).length : 0);
  const mk = (total, kind) => { const u = used(kind); return { total: sub ? total || 0 : 0, used: u, left: sub ? Math.max(0, (total || 0) - u) : 0 }; };
  return { campaign: mk(q.campaignCredits, 'credit'), national: mk(q.nationalCredits, 'national_credit'), until: sub?.end || null };
}

/* ---------------- Ciblage ---------------- */

const isPersonal = (t = {}) => !!(t.cities?.length || t.cycles?.length || t.levels?.length || t.domains?.length);

function matches(t = {}, u) {
  const cls = data.classes[u?.classId];
  if (!cls) return false;
  if (t.country && cls.country !== t.country) return false;
  if (t.cities?.length && !t.cities.some(x => fold(x) === fold(u.city))) return false;
  if (t.cycles?.length || t.levels?.length) {
    if (!(t.cycles || []).includes(cls.cycle) && !(t.levels || []).includes(`${cls.cycle}|${cls.niveau}`)) return false;
  }
  if (t.domains?.length && !t.domains.includes(catalog.domainOf(cls.filiere))) return false;
  return true;
}

// Un élève qui a désactivé les publicités personnalisées ne reçoit que des campagnes sans ciblage
// (le pays n'est pas considéré comme un ciblage personnel : tout le catalogue en dépend).
function eligible(c, u) {
  if (!u || u.deleted || u.suspended) return false;
  if ((u.hiddenAds || []).includes(c.id)) return false;
  if (isPersonal(c.targeting) && u.privacy?.personalizedAds === false) return false;
  return matches(c.targeting, u);
}

// Estimation de l'audience : nombre d'élèves correspondants, arrondi ; « moins de 50 » en dessous du seuil.
function estimate(t) {
  let n = 0;
  for (const u of Object.values(data.users)) {
    if (u.deleted || u.suspended) continue;
    if (isPersonal(t) && u.privacy?.personalizedAds === false) continue;
    if (matches(t, u)) n++;
  }
  const min = OF.offers().minAudience ?? 50;
  if (n < min) return { n: null, label: `moins de ${min} élèves` };
  const r = n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100;
  return { n: r, label: `environ ${r.toLocaleString('fr-FR')} élèves` };
}

// « en Côte d'Ivoire », « au Sénégal », « à Madagascar »…
const AU_PAYS = ['Bénin', 'Burkina Faso', 'Cameroun', 'Congo', 'Gabon', 'Mali', 'Niger', 'Sénégal', 'Tchad', 'Togo', 'Maroc', 'Canada'];
const inCountry = (c) => (c === 'Madagascar' ? 'à Madagascar' : AU_PAYS.includes(c) ? `au ${c}` : `en ${c}`);
const cycleLabel = (id) => catalog.cycles.find(c => c.id === id)?.label || id;
const list = (arr, last = 'et') => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} ${last} ${arr[arr.length - 1]}`);

// Description en clair du ciblage, ex. « les élèves de Terminale (Lycée) à Korhogo intéressés par Informatique & numérique ».
function describe(t = {}) {
  const who = [...(t.levels || []).map(k => { const [cy, niv] = k.split('|'); return `${niv} (${cycleLabel(cy)})`; }), ...(t.cycles || []).map(cy => `${cycleLabel(cy)} (tous niveaux)`)];
  let s = who.length ? `les élèves de ${list(who)}` : 'tous les élèves';
  if (t.cities?.length) s += ` à ${list(t.cities, 'ou')}`;
  else if (t.country) s += ` ${inCountry(t.country)}`;
  if (t.domains?.length) s += ` intéressés par ${list(t.domains.map(d => catalog.domains[d] || d), 'ou')}`;
  return s;
}

function why(c) {
  const s = data.schools[c.schoolId];
  const personal = isPersonal(c.targeting);
  return `Publicité payée par ${s?.name || 'un établissement'}. Cet établissement cible ${describe(c.targeting)}. `
    + (personal
      ? 'Vous la voyez parce que votre profil Scola correspond à ce ciblage. L\'établissement ne sait pas qui vous êtes : il ne reçoit que des chiffres globaux. Vous pouvez désactiver les publicités personnalisées dans Paramètres › Confidentialité.'
      : 'Cette publicité n\'utilise aucune information sur vous, à part votre pays.');
}

/* ---------------- Création et validation du contenu ---------------- */

function sanitize(b, s, cur = {}) {
  const types = OF.offers().campaignTypes;
  const can = allowed(s);
  const out = {};
  const type = types[b.type ?? cur.type];
  if (!type || (!type.active && b.type !== undefined && b.type !== cur.type)) throw bad('Type de campagne indisponible.');
  out.type = type.code;
  out.title = clip(b.title ?? cur.title, 80);
  out.text = clip(b.text ?? cur.text, 400);
  // Média : image (toutes formules) ou vidéo (Premium), jamais en lecture automatique avec le son.
  const m = b.media !== undefined ? b.media : cur.media;
  if (m) {
    if (!isMediaUrl(m.url) || typeof m.mime !== 'string') throw bad('Média invalide.');
    if (/^video\//.test(m.mime) && !can.video) throw bad('La vidéo sponsorisée est incluse dans la formule Premium.', 403);
    if (!/^(image|video)\//.test(m.mime)) throw bad('Choisissez une image ou une vidéo.');
    out.media = { url: m.url, mime: m.mime, name: clip(m.name, 120), size: Number(m.size) || 0 };
  } else out.media = null;
  // Bouton d'action.
  const ct = b.cta !== undefined ? b.cta : cur.cta || { kind: 'channel' };
  if (!CTA[ct?.kind]) throw bad('Bouton d\'action invalide.');
  if (ct.kind === 'info' && !can.info) throw bad('Le bouton « Demander des informations » est inclus à partir de la formule Starter.', 403);
  out.cta = { kind: ct.kind, label: clip(ct.label, 40) || CTA[ct.kind], url: '' };
  if (ct.kind === 'link') {
    out.cta.url = clip(ct.url, 300);
    if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(out.cta.url)) throw bad('Indiquez une adresse web valide (https://…).');
  }
  // Dates : durée comprise entre les bornes du type.
  const start = b.start !== undefined ? Number(b.start) : cur.start;
  const days = b.days !== undefined ? Number(b.days) : cur.days || type.minDays;
  if (start !== undefined && start !== null && !Number.isFinite(start)) throw bad('Date de début invalide.');
  if (!Number.isInteger(days) || days < type.minDays || days > type.maxDays) throw bad(type.minDays === type.maxDays ? `Une campagne « ${type.name} » dure ${type.minDays} jours.` : `Une campagne « ${type.name} » dure de ${type.minDays} à ${type.maxDays} jours.`);
  out.start = start ? startOfDay(start) : null;
  out.days = days;
  out.end = out.start ? out.start + days * DAY : null;
  // Ciblage (facultatif, combinable) ; ville et domaine selon la formule ; rien de local pour une campagne nationale.
  const t = b.targeting !== undefined ? b.targeting || {} : cur.targeting || {};
  const tg = { country: catalog.countries.includes(t.country) ? t.country : (s.country && catalog.countries.includes(s.country) ? s.country : "Côte d'Ivoire") };
  tg.cycles = [...new Set((t.cycles || []).filter(id => catalog.cycles.some(c => c.id === id)))];
  tg.levels = [...new Set((t.levels || []).filter(k => { const [cy, niv] = String(k).split('|'); return catalog.cycles.find(c => c.id === cy)?.niveaux.includes(niv); }))];
  tg.cities = [...new Set((t.cities || []).map(x => clip(x, 60)).filter(Boolean))].slice(0, 20);
  tg.domains = [...new Set((t.domains || []).filter(d => catalog.domains[d]))];
  if ((tg.cities.length || tg.domains.length) && !can.targeting) throw bad('Le ciblage par ville et par domaine de formation est inclus à partir de la formule Pro.', 403);
  if (type.national && tg.cities.length) throw bad('Une campagne nationale ne se limite pas à des villes.');
  out.targeting = tg;
  // Emplacements autorisés par le type et la formule.
  if (b.placements?.includes('banner') && !can.banner) throw bad('La bannière est incluse à partir de la formule Pro.', 403);
  const pl = (b.placements ?? cur.placements ?? type.placements).filter(p => type.placements.includes(p) && (p !== 'banner' || can.banner));
  if (!pl.length) throw bad('Choisissez au moins un emplacement.');
  out.placements = [...new Set(pl)];
  return out;
}

function checkComplete(c) {
  if (c.title.length < 3) throw bad('Donnez un titre à la campagne.');
  if (!c.text && !c.media) throw bad('Ajoutez un texte ou une image.');
  if (!c.start) throw bad('Choisissez la date de début.');
  if (c.start < startOfDay()) throw bad('La date de début est déjà passée.');
}

function create(s, b) {
  const f = sanitize(b, s);
  const id = C.uid('cmp_');
  const c = { id, schoolId: s.id, ...f, status: 'draft', price: OF.offers().campaignTypes[f.type].price, createdAt: C.now(), updatedAt: C.now(), history: [] };
  data.campaigns[id] = c;
  save();
  return c;
}

function update(c, s, b) {
  if (!['draft', 'rejected', 'awaiting_payment'].includes(c.status)) throw bad('Cette campagne ne peut plus être modifiée : contactez l\'équipe Scola.');
  Object.assign(c, sanitize(b, s, c), { updatedAt: C.now(), price: c.status === 'awaiting_payment' ? c.price : OF.offers().campaignTypes[b.type ?? c.type].price });
  if (c.status === 'rejected') setStatus(c, 'draft', null, 'Modifiée par l\'établissement après refus');
  save();
  return c;
}

// Soumission : par crédit inclus (→ en revue) ou par paiement (→ en attente de paiement).
function submit(c, s, { credit } = {}) {
  if (!['draft', 'rejected'].includes(c.status)) throw bad('Cette campagne a déjà été soumise.');
  checkComplete(c);
  const type = OF.offers().campaignTypes[c.type];
  c.price = type.price;
  if (credit) {
    const cr = credits(s);
    const kind = credit === 'national' ? 'national_credit' : 'credit';
    const pool = kind === 'national_credit' ? cr.national : cr.campaign;
    if (kind === 'national_credit' && !type.national) throw bad('Les campagnes nationales incluses ne s\'utilisent que pour une campagne de type « Nationale ».');
    if (!pool.left) throw bad('Vous n\'avez plus de campagne incluse disponible pour cette année d\'abonnement.');
    c.paidBy = kind;
    c.creditAt = C.now();
    setStatus(c, 'in_review', null, 'Soumise (campagne incluse dans la formule)');
  } else {
    c.paidBy = 'payment';
    setStatus(c, 'awaiting_payment', null, 'Soumise, en attente du paiement');
  }
  c.submittedAt = C.now();
  save();
  const admins = Object.values(data.admins).map(a => a.email).filter(Boolean);
  if (admins.length) mail.send({ to: admins.join(','), subject: `Scola — campagne à valider : ${c.title}`, text: `« ${s.name} » a soumis la campagne « ${c.title} » (${type.name}, ${c.days} jours à partir du ${dateFr(c.start)}).\n${c.paidBy === 'payment' ? `Paiement attendu : ${c.price.toLocaleString('fr-FR')} FCFA.` : 'Campagne incluse dans la formule.'}\n\nValidez-la dans l'administration, rubrique Campagnes.` });
  return c;
}

/* ---------------- Décisions de l'administration ---------------- */

function approve(c, admin) {
  if (c.status !== 'in_review') throw bad(c.status === 'awaiting_payment' ? 'Enregistrez d\'abord le paiement.' : 'Cette campagne n\'est pas en revue.');
  if (C.now() >= c.end) throw bad('La période de cette campagne est déjà passée : demandez à l\'établissement de changer les dates.');
  setStatus(c, 'scheduled', admin.id, 'Contenu et paiement validés');
  c.approvedAt = C.now(); c.approvedBy = admin.id;
  refreshStatuses();
  save();
  notifySchool(c, `Votre campagne « ${c.title} » a été validée. Diffusion du ${dateFr(c.start)} au ${dateFr(c.end - DAY)}.`);
  return c;
}
function reject(c, admin, reason) {
  if (!['awaiting_payment', 'in_review', 'scheduled'].includes(c.status)) throw bad('Cette campagne ne peut pas être refusée dans son état actuel.');
  reason = clip(reason, 500);
  if (!reason) throw bad('Indiquez le motif du refus : il est communiqué à l\'établissement.');
  c.rejectReason = reason;
  setStatus(c, 'rejected', admin.id, reason);
  save();
  notifySchool(c, `Votre campagne « ${c.title} » n'a pas été retenue.\nMotif : ${reason}\n\nVous pouvez la modifier et la soumettre à nouveau.`);
  return c;
}
function suspend(c, admin, reason) {
  if (!['scheduled', 'active'].includes(effectiveStatus(c))) throw bad('Seule une campagne programmée ou active peut être suspendue.');
  c.suspendReason = clip(reason, 500);
  setStatus(c, 'suspended', admin.id, c.suspendReason);
  save();
  notifySchool(c, `Votre campagne « ${c.title} » a été suspendue par l'équipe Scola.${c.suspendReason ? '\nMotif : ' + c.suspendReason : ''}`);
  return c;
}
function resume(c, admin) {
  if (c.status !== 'suspended') throw bad('Cette campagne n\'est pas suspendue.');
  setStatus(c, 'scheduled', admin.id, 'Reprise');
  refreshStatuses();
  save();
  return c;
}
function notifySchool(c, text) {
  const s = data.schools[c.schoolId];
  if (s?.email) mail.send({ to: s.email, subject: `Scola — votre campagne « ${c.title} »`, text: `Bonjour,\n\n${text}\n\nL'équipe Scola` });
}

/* ---------------- Diffusion côté élève ---------------- */

const liveSchool = (c) => data.schools[c.schoolId]?.status === 'active';

// Campagnes éligibles pour un élève à un emplacement, sous le plafond de répétition du jour,
// la grande bannière (Premium) d'abord puis par rotation (la moins vue aujourd'hui).
// `used` : campagnes déjà placées dans la même réponse (une campagne n'occupe qu'un emplacement à la fois).
function pick(uid, placement, n = 1, used = new Set()) {
  const u = data.users[uid];
  const cap = OF.offers().frequencyCap || 3;
  const out = Object.values(data.campaigns)
    .filter(c => !used.has(c.id) && effectiveStatus(c) === 'active' && c.placements.includes(placement) && liveSchool(c) && eligible(c, u) && AU.countToday('ad:' + c.id, uid) < cap)
    .map(c => ({ c, big: placement === 'banner' && OF.can(data.schools[c.schoolId], 'bigBanner'), seen: AU.countToday('ad:' + c.id, uid), r: Math.random() }))
    .sort((a, b) => (b.big - a.big) || (a.seen - b.seen) || (a.r - b.r));
  // Une seule campagne par établissement et par emplacement.
  const bySchool = new Set();
  const res = out.filter(x => !bySchool.has(x.c.schoolId) && bySchool.add(x.c.schoolId)).slice(0, n).map(x => ({ c: x.c, big: x.big }));
  for (const x of res) used.add(x.c.id);
  return res;
}

// Affichage effectivement servi : compte pour le plafond et pour les statistiques de la campagne.
function record(c, uid) {
  AU.bumpToday('ad:' + c.id, uid);
  AU.adImpression(c.schoolId, c.id, uid);
}

function adView(c, { big = false, placement } = {}) {
  const s = data.schools[c.schoolId];
  return {
    id: c.id, placement, big, title: c.title, text: c.text, media: c.media, cta: c.cta,
    school: { id: s.id, name: s.name, logo: s.logo, verified: OF.showsVerified(s), founder: OF.isFounder(s), infoButton: OF.can(s, 'infoButton'), formations: OF.can(s, 'fullPage') ? s.formations || [] : [] },
    why: why(c),
  };
}

/* ---------------- Vues ---------------- */

function view(c, { admin = false } = {}) {
  const s = data.schools[c.schoolId];
  const type = OF.offers().campaignTypes[c.type];
  const st = effectiveStatus(c);
  const rep = AU.campaignReport(c.schoolId, c.id, OF.offers().privacyThreshold || 10);
  const t = rep.totals;
  return {
    ...c, status: st, statusLabel: STATUS[st], typeName: type?.name || c.type, provisional: !!type?.provisional,
    schoolName: s?.name || 'Établissement supprimé', describe: describe(c.targeting), personal: isPersonal(c.targeting),
    stats: {
      impressions: t.i, reach: t.r, clicks: t.c, contacts: t.k, hides: t.h,
      ctr: t.i ? Math.round((t.c / t.i) * 1000) / 10 : null,
      // Coût par contact : prix de la campagne ÷ contacts obtenus (valeur de référence si campagne incluse).
      costPerContact: t.k ? Math.round(c.price / t.k) : null,
    },
    report: rep,
    history: admin ? (c.history || []).map(h => ({ ...h, byName: h.by ? data.admins[h.by]?.name || 'Administrateur' : 'Système' })) : (c.history || []).map(({ by, ...h }) => h),
  };
}

module.exports = {
  STATUS, CTA, effectiveStatus, refreshStatuses, allowed, credits, isPersonal, matches, eligible, estimate, describe, why,
  sanitize, create, update, submit, approve, reject, suspend, resume, pick, record, adView, view, setStatus,
};
