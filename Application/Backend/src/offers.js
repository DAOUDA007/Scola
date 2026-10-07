// Offres commerciales des établissements : formules annuelles, droits (entitlements),
// quotas, types de campagnes et réglages. Tout est stocké dans data.offers et modifiable
// depuis l'administration ; les valeurs ci-dessous ne sont que les valeurs par défaut,
// fusionnées au démarrage sans jamais écraser un réglage existant.
const C = require('./core');
const { data, save } = C;

const DAY = 86400e3;

// Droits activables par formule (libellés affichés dans l'administration et l'espace établissement).
const RIGHTS = {
  fullPage: 'Page officielle complète (galerie photos, formations structurées)',
  admissions: 'Bloc « Inscriptions » (période, conditions, pièces, date limite)',
  infoButton: 'Bouton « Demander des informations »',
  directory: 'Présence dans l\'annuaire (recherche par formation et domaine)',
  statsBasic: 'Statistiques de base (abonnés, vues, contacts)',
  verifiedBadge: 'Badge « Établissement vérifié » (accordé par l\'administration)',
  featuredPosts: 'Publications mises en avant',
  admissionsHighlight: 'Annonces d\'inscription mises en valeur',
  statsVisibility: 'Statistiques de visibilité (visiteurs uniques, clics, par semaine)',
  targeting: 'Publicité ciblée par ville et domaine de formation',
  banner: 'Bannière dans l\'onglet Orientation',
  feedHighlight: 'Mise en avant dans le fil Orientation',
  statsBreakdown: 'Statistiques détaillées (ville, niveau, domaine)',
  monthlyReport: 'Rapport de performance mensuel',
  bigBanner: 'Grande bannière (emplacement prioritaire)',
  videoAds: 'Publications sponsorisées vidéo',
  statsAdvanced: 'Statistiques avancées (comparaison, entonnoir vue → clic → contact)',
  marketingSupport: 'Accompagnement marketing (interlocuteur Scola dédié)',
  founderBadge: 'Badge « Fondateur »',
};

// Quotas : null = illimité.
const QUOTAS = {
  postsPerMonth: 'Publications par mois',
  featuredPerMonth: 'Publications mises en avant par mois',
  campaignCredits: 'Campagnes incluses par an',
  nationalCredits: 'Campagnes nationales incluses par an',
  rank: 'Priorité dans la recherche et les suggestions (0 = aucune)',
};

const LEVELS = {
  gratuit: [],
  starter: ['fullPage', 'admissions', 'infoButton', 'directory', 'statsBasic'],
  standard: ['verifiedBadge', 'featuredPosts', 'admissionsHighlight', 'statsVisibility'],
  pro: ['targeting', 'banner', 'feedHighlight', 'statsBreakdown', 'monthlyReport'],
  premium: ['bigBanner', 'videoAds', 'statsAdvanced', 'marketingSupport'],
};
// Chaque formule inclut les droits de la précédente.
function rightsUpTo(level, extra = []) {
  const order = ['gratuit', 'starter', 'standard', 'pro', 'premium'];
  const on = new Set(extra);
  for (const l of order.slice(0, order.indexOf(level) + 1)) for (const r of LEVELS[l]) on.add(r);
  return Object.fromEntries(Object.keys(RIGHTS).map(r => [r, on.has(r)]));
}

function defaultPlans() {
  const q = (o) => ({ postsPerMonth: null, featuredPerMonth: 0, campaignCredits: 0, nationalCredits: 0, rank: 0, ...o });
  return {
    gratuit: { code: 'gratuit', name: 'Sans abonnement', price: 0, order: 0, purchasable: false, target: 'Établissement validé sans abonnement en cours', rights: rightsUpTo('gratuit'), quotas: q({ postsPerMonth: 4 }) },
    fondateur: { code: 'fondateur', name: 'Partenaire Fondateur', price: 150000, order: 1, purchasable: true, target: '100 premiers établissements uniquement', rights: rightsUpTo('starter', ['founderBadge']), quotas: q({ rank: 1 }) },
    starter: { code: 'starter', name: 'Starter', price: 250000, order: 2, purchasable: true, target: 'Petites écoles, budget limité', rights: rightsUpTo('starter'), quotas: q({ rank: 1 }) },
    standard: { code: 'standard', name: 'Standard', price: 600000, order: 3, purchasable: true, target: 'Établissements privés de taille moyenne', rights: rightsUpTo('standard'), quotas: q({ featuredPerMonth: 2, rank: 2 }) },
    pro: { code: 'pro', name: 'Pro', price: 1200000, order: 4, purchasable: true, target: 'Grandes écoles et instituts', rights: rightsUpTo('pro'), quotas: q({ featuredPerMonth: 2, campaignCredits: 1, rank: 3 }) },
    premium: { code: 'premium', name: 'Premium', price: 2400000, order: 5, purchasable: true, target: 'Visibilité nationale maximale', rights: rightsUpTo('premium'), quotas: q({ featuredPerMonth: 2, campaignCredits: 1, nationalCredits: 2, rank: 4 }) },
  };
}

// Emplacements possibles d'une campagne (côté élève, uniquement dans l'onglet Orientation).
const PLACEMENTS = {
  sponsored: 'Publication sponsorisée dans le fil Orientation',
  search: 'Priorité dans la recherche et les suggestions',
  banner: 'Bannière en haut de l\'onglet Orientation',
};

function defaultCampaignTypes() {
  const t = (code, name, minDays, maxDays, price, usage, extra = {}) => ({
    code, name, minDays, maxDays, price, provisional: true, usage, active: true,
    placements: ['sponsored', 'search', 'banner'], national: false, ...extra,
  });
  return {
    rentree: t('rentree', 'Rentrée', 30, 30, 150000, 'Début d\'année scolaire'),
    inscriptions: t('inscriptions', 'Inscriptions', 30, 45, 150000, 'Période d\'inscriptions'),
    concours: t('concours', 'Concours', 30, 30, 120000, 'Préparation et inscription aux concours'),
    evenement: t('evenement', 'Événement', 7, 15, 60000, 'Portes ouvertes, conférence, cérémonie, salon'),
    nationale: t('nationale', 'Nationale', 30, 30, 400000, 'Plusieurs régions, sans limite de ville', { national: true }),
  };
}

function defaults() {
  return {
    plans: defaultPlans(),
    campaignTypes: defaultCampaignTypes(),
    founder: { seats: 100, guaranteedYears: 3 },
    graceDays: 15,
    reminderDays: [60, 30, 7],
    featuredDays: 7,
    frequencyCap: 3,          // affichages max d'une même campagne par élève et par jour
    minAudience: 50,          // en dessous : « moins de 50 » dans l'estimation d'audience
    privacyThreshold: 10,     // catégories statistiques masquées en dessous de ce seuil
    paymentInstructions: 'Paiement par Wave, Orange Money, MTN MoMo, Moov Money, virement, chèque ou espèces.\nIndiquez le nom de votre établissement en référence, puis envoyez la preuve de paiement à l\'équipe Scola. (Texte à personnaliser dans l\'administration : numéros, RIB…)',
    marketingContact: { name: '', phone: '', email: '' },
    // Émetteur affiché sur les reçus.
    issuer: { name: 'Scola', address: "Abidjan, Côte d'Ivoire", phone: '', email: '', legal: '' },
  };
}

// Complète récursivement les objets simples sans écraser ce qui existe.
function fillMissing(target, def) {
  let changed = false;
  for (const [k, v] of Object.entries(def)) {
    if (!(k in target)) { target[k] = structuredClone(v); changed = true; }
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      if (fillMissing(target[k], v)) changed = true;
    }
  }
  return changed;
}

(function migrate() {
  data.offers ||= {};
  let changed = fillMissing(data.offers, defaults());
  // Une formule ajoutée par l'administration (sans valeur par défaut) reçoit les clés de droits manquantes.
  for (const p of Object.values(data.offers.plans)) {
    p.rights ||= {}; p.quotas ||= {};
    for (const r of Object.keys(RIGHTS)) if (!(r in p.rights)) { p.rights[r] = false; changed = true; }
    for (const k of Object.keys(QUOTAS)) if (!(k in p.quotas)) { p.quotas[k] = k === 'postsPerMonth' ? null : 0; changed = true; }
  }
  for (const k of ['subscriptions', 'payments', 'planRequests', 'campaigns', 'stats']) if (!data[k] || typeof data[k] !== 'object') { data[k] = {}; changed = true; }
  // Les établissements existants n'ont pas d'abonnement : ils passent au statut « sans abonnement ».
  // Rien n'est supprimé : galerie, formations et inscriptions sont simplement vides au départ.
  for (const s of Object.values(data.schools)) {
    if (!Array.isArray(s.gallery)) { s.gallery = []; changed = true; }
    if (!Array.isArray(s.formations)) { s.formations = []; changed = true; }
    if (!s.admissions || typeof s.admissions !== 'object') { s.admissions = null; }
  }
  delete data.statsDay; // ancienne clé (lot 1) : les empreintes du jour restent en mémoire, jamais enregistrées
  if (changed) save();
})();

/* ---------------- Formule en cours ---------------- */

const offers = () => data.offers;
const planDef = (code) => offers().plans[code] || offers().plans.gratuit;

function subscriptionsOf(schoolId) {
  return Object.values(data.subscriptions).filter(x => x.schoolId === schoolId && !x.cancelled).sort((a, b) => a.start - b.start || a.createdAt - b.createdAt);
}

// Formule effective d'un établissement à l'instant t :
//  - active : un abonnement couvre t (en cas de montée en gamme, le plus récent l'emporte) ;
//  - grace : le dernier abonnement est échu depuis moins de graceDays (droits conservés) ;
//  - none : statut « sans abonnement » (formule gratuite).
function currentPlan(s, t = C.now()) {
  const subs = subscriptionsOf(s.id);
  const covering = subs.filter(x => x.start <= t && t < x.end);
  const cur = covering.sort((a, b) => b.start - a.start || b.createdAt - a.createdAt)[0];
  const last = subs.filter(x => x.end <= t).sort((a, b) => b.end - a.end)[0];
  const next = subs.filter(x => x.start > t).sort((a, b) => a.start - b.start)[0] || null;
  // Fin de la période couverte sans interruption à partir de l'abonnement en cours (renouvellements anticipés inclus).
  const chainEnd = (from) => { let end = from.end; for (const x of subs) if (x.start <= end && x.end > end) end = x.end; return end; };
  if (cur) return { code: cur.plan, plan: planDef(cur.plan), status: 'active', subscription: cur, end: cur.end, paidUntil: chainEnd(cur), next };
  const grace = (offers().graceDays || 0) * DAY;
  if (last && t < last.end + grace) return { code: last.plan, plan: planDef(last.plan), status: 'grace', subscription: last, end: last.end, graceEnd: last.end + grace, paidUntil: last.end, next };
  return { code: 'gratuit', plan: planDef('gratuit'), status: 'none', subscription: null, end: null, paidUntil: null, next, expired: last || null };
}

function can(s, right) { return !!currentPlan(s).plan.rights?.[right]; }

function quota(s, key) {
  const v = currentPlan(s).plan.quotas?.[key];
  return v === undefined ? 0 : v;
}

// Exige un droit : utilisé par les routes de l'espace établissement (vérification côté serveur).
function requireRight(s, right) {
  if (can(s, right)) return;
  // On cite la première formule de la gamme normale (l'offre Fondateur, limitée, n'est pas une référence).
  const from = Object.values(offers().plans).filter(p => p.purchasable && p.rights?.[right] && !p.rights.founderBadge).sort((a, b) => a.order - b.order)[0];
  const err = new Error(from ? `Fonction incluse à partir de la formule ${from.name}.` : 'Fonction non incluse dans votre formule.');
  err.status = 403;
  throw err;
}

const monthStart = (t = C.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

// Publications du mois en cours (quota de la formule sans abonnement).
function postsThisMonth(s) {
  const from = monthStart();
  return (data.posts[s.id] || []).filter(p => p.createdAt >= from).length;
}

// Mises en avant lancées ce mois-ci (un retrait anticipé ne rend pas le crédit).
function featuredThisMonth(s) {
  const from = monthStart();
  return (s.featureLog || []).filter(x => x.at >= from).length;
}

function checkPostQuota(s) {
  const max = quota(s, 'postsPerMonth');
  if (max === null || max === undefined) return;
  if (postsThisMonth(s) >= max) {
    const err = new Error(`Limite atteinte : ${max} publication${max > 1 ? 's' : ''} par mois sans abonnement. Souscrivez une formule pour publier sans limite.`);
    err.status = 403;
    throw err;
  }
}

/* ---------------- Offre Partenaire Fondateur ---------------- */

function founderSeatsTaken() { return Object.values(data.schools).filter(s => s.founder).length; }
function founderAvailable() { return founderSeatsTaken() < (offers().founder.seats || 0); }

// Badge « Fondateur » : permanent une fois obtenu, même si le tarif garanti est perdu.
function isFounder(s) { return !!s.founder; }
// Badge « vérifié » affiché seulement si l'administration l'a accordé ET que la formule l'inclut.
function showsVerified(s) { return !!s.verified && can(s, 'verifiedBadge'); }

// Résumé public d'une offre (espace établissement, administration).
function planSummary(code) {
  const p = planDef(code);
  return { code: p.code, name: p.name, price: p.price, order: p.order, purchasable: !!p.purchasable, target: p.target || '', rights: { ...p.rights }, quotas: { ...p.quotas } };
}

function offerState(s) {
  const cp = currentPlan(s);
  return {
    code: cp.code, name: cp.plan.name, status: cp.status, end: cp.end, graceEnd: cp.graceEnd || null, paidUntil: cp.paidUntil,
    next: cp.next ? { plan: cp.next.plan, start: cp.next.start, end: cp.next.end } : null,
    rights: { ...cp.plan.rights }, quotas: { ...cp.plan.quotas },
    usage: { postsThisMonth: postsThisMonth(s), featuredThisMonth: featuredThisMonth(s) },
    founder: s.founder ? { since: s.founder.since, rateLost: !!s.founder.rateLost, rateUntil: s.founder.rateUntil || null } : null,
    verified: showsVerified(s),
  };
}

/* ---------------- Modification par l'administration ---------------- */

const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
function int(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} : nombre entier entre ${min.toLocaleString('fr-FR')} et ${max.toLocaleString('fr-FR')} attendu.`);
  return n;
}

// Applique les modifications envoyées par l'administration, champ par champ, après validation.
// Les valeurs absentes de la requête sont conservées.
function updateOffers(b) {
  const o = structuredClone(offers());
  if (b.plans) {
    for (const [code, v] of Object.entries(b.plans)) {
      if (v === null) {
        if (['gratuit', 'fondateur'].includes(code)) throw bad('Cette formule ne peut pas être supprimée.');
        if (Object.values(data.subscriptions).some(x => x.plan === code && !x.cancelled)) throw bad(`La formule « ${o.plans[code]?.name || code} » a des abonnements : désactivez-la plutôt que de la supprimer.`);
        delete o.plans[code];
        continue;
      }
      if (!o.plans[code]) {
        if (!/^[a-z0-9_-]{2,20}$/.test(code)) throw bad('Code de formule invalide (2 à 20 caractères : lettres minuscules, chiffres, - ou _).');
        o.plans[code] = { ...structuredClone(o.plans.starter), code, name: code, order: Math.max(...Object.values(o.plans).map(p => p.order)) + 1 };
        o.plans[code].rights.founderBadge = false;
      }
      const p = o.plans[code];
      if (v.name !== undefined) { p.name = clip(v.name, 60); if (p.name.length < 2) throw bad('Nom de formule trop court.'); }
      if (v.target !== undefined) p.target = clip(v.target, 200);
      if (v.price !== undefined) p.price = int(v.price, 0, 1e9, `Prix de ${p.name}`);
      if (v.order !== undefined) p.order = int(v.order, 0, 100, 'Ordre');
      if (v.purchasable !== undefined && code !== 'gratuit') p.purchasable = !!v.purchasable;
      if (v.rights) for (const r of Object.keys(RIGHTS)) if (typeof v.rights[r] === 'boolean') p.rights[r] = v.rights[r];
      if (v.quotas) for (const k of Object.keys(QUOTAS)) {
        if (v.quotas[k] === undefined) continue;
        p.quotas[k] = k === 'postsPerMonth' && (v.quotas[k] === null || v.quotas[k] === '') ? null : int(v.quotas[k], 0, 10000, `${QUOTAS[k]} (${p.name})`);
      }
    }
  }
  if (b.campaignTypes) {
    for (const [code, v] of Object.entries(b.campaignTypes)) {
      if (v === null) { if (Object.values(data.campaigns).some(x => x.type === code)) throw bad('Ce type a déjà des campagnes : désactivez-le plutôt.'); delete o.campaignTypes[code]; continue; }
      if (!o.campaignTypes[code]) {
        if (!/^[a-z0-9_-]{2,20}$/.test(code)) throw bad('Code de type de campagne invalide.');
        o.campaignTypes[code] = { ...structuredClone(o.campaignTypes.evenement), code, name: code, national: false };
      }
      const t = o.campaignTypes[code];
      if (v.name !== undefined) { t.name = clip(v.name, 60); if (t.name.length < 2) throw bad('Nom de type trop court.'); }
      if (v.usage !== undefined) t.usage = clip(v.usage, 200);
      if (v.price !== undefined) t.price = int(v.price, 0, 1e9, `Prix (${t.name})`);
      if (v.minDays !== undefined) t.minDays = int(v.minDays, 1, 365, 'Durée minimale');
      if (v.maxDays !== undefined) t.maxDays = int(v.maxDays, 1, 365, 'Durée maximale');
      if (t.minDays > t.maxDays) throw bad(`${t.name} : la durée minimale dépasse la durée maximale.`);
      for (const k of ['provisional', 'active', 'national']) if (typeof v[k] === 'boolean') t[k] = v[k];
      if (Array.isArray(v.placements)) {
        t.placements = v.placements.filter(x => PLACEMENTS[x]);
        if (!t.placements.length) throw bad(`${t.name} : choisissez au moins un emplacement.`);
      }
    }
  }
  if (b.founder) {
    if (b.founder.seats !== undefined) o.founder.seats = int(b.founder.seats, 0, 100000, 'Places Fondateur');
    if (b.founder.guaranteedYears !== undefined) o.founder.guaranteedYears = int(b.founder.guaranteedYears, 0, 20, 'Années de tarif garanti');
  }
  if (b.graceDays !== undefined) o.graceDays = int(b.graceDays, 0, 90, 'Période de grâce');
  if (b.featuredDays !== undefined) o.featuredDays = int(b.featuredDays, 1, 60, 'Durée de mise en avant');
  if (b.frequencyCap !== undefined) o.frequencyCap = int(b.frequencyCap, 1, 50, 'Plafond de répétition');
  if (b.minAudience !== undefined) o.minAudience = int(b.minAudience, 0, 100000, "Seuil d'audience");
  // Règle de confidentialité : jamais moins de 10 personnes par catégorie statistique.
  if (b.privacyThreshold !== undefined) o.privacyThreshold = int(b.privacyThreshold, 10, 1000, 'Seuil de confidentialité');
  if (b.reminderDays !== undefined) {
    const list = [...new Set((Array.isArray(b.reminderDays) ? b.reminderDays : String(b.reminderDays).split(/[\s,;]+/)).filter(x => x !== '').map(x => int(x, 1, 365, 'Rappels')))].sort((a, z) => z - a);
    o.reminderDays = list;
  }
  if (b.paymentInstructions !== undefined) o.paymentInstructions = clip(b.paymentInstructions, 3000);
  if (b.marketingContact) for (const k of ['name', 'phone', 'email']) if (b.marketingContact[k] !== undefined) o.marketingContact[k] = clip(b.marketingContact[k], 120);
  if (b.issuer) for (const k of ['name', 'address', 'phone', 'email', 'legal']) if (b.issuer[k] !== undefined) o.issuer[k] = clip(b.issuer[k], 300);
  data.offers = o;
  save();
  return o;
}

module.exports = {
  updateOffers,
  RIGHTS, QUOTAS, PLACEMENTS, DAY, defaults, offers, planDef, subscriptionsOf, currentPlan, can, quota, requireRight,
  monthStart, postsThisMonth, featuredThisMonth, checkPostQuota, founderSeatsTaken, founderAvailable, isFounder, showsVerified, planSummary, offerState,
};
