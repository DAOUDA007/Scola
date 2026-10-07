// Abonnements annuels et paiements des établissements.
// Il n'y a pas encore de paiement en ligne : l'administration enregistre chaque paiement
// (Wave, Orange Money, MTN MoMo, Moov Money, virement, chèque, espèces) et un reçu numéroté
// est généré. Les rappels d'échéance partent automatiquement (J-60, J-30, J-7 par défaut).
const C = require('./core');
const OF = require('./offers');
const mail = require('./mail');
const { data, save } = C;
const { DAY } = OF;

const METHODS = {
  wave: 'Wave', orange: 'Orange Money', mtn: 'MTN MoMo', moov: 'Moov Money',
  virement: 'Virement bancaire', cheque: 'Chèque', especes: 'Espèces',
};
const KINDS = { new: 'Nouvelle souscription', renewal: 'Renouvellement', upgrade: 'Montée en gamme' };

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const fcfa = (n) => Number(n || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') + ' FCFA';
const dateFr = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Ajoute n mois (calendrier) : le 31 janvier + 1 mois donne le 28/29 février.
function addMonths(t, n) {
  const d = new Date(t);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}
const round100 = (n) => Math.max(0, Math.round(n / 100) * 100);
const startOfDay = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

function nextReceiptNo(t = C.now()) {
  const y = new Date(t).getUTCFullYear();
  data.meta.receiptSeq ||= {};
  const n = (data.meta.receiptSeq[y] || 0) + 1;
  data.meta.receiptSeq[y] = n;
  return `SCO-${y}-${String(n).padStart(5, '0')}`;
}

/* ---------------- Paiement en ligne (à brancher plus tard) ---------------- */

// Point d'entrée UNIQUE pour un futur paiement en ligne (Wave Business, CinetPay…), sur le
// modèle de sendSms() dans auth.js. Une fois un prestataire choisi : créer ici la demande de
// paiement chez lui, puis, à la confirmation (webhook), appeler recordSubscription() ou
// recordCampaignPayment() avec method = le moyen utilisé et reference = l'identifiant de transaction.
// Volontairement non implémenté : aucune API de prestataire n'est supposée.
async function startOnlinePayment(/* { school, amount, label, returnUrl } */) {
  throw bad('Le paiement en ligne n\'est pas encore disponible. Suivez les instructions de paiement : l\'équipe Scola enregistrera votre paiement.', 501);
}

/* ---------------- Offre Partenaire Fondateur ---------------- */

// Le tarif Fondateur est perdu si l'abonnement s'interrompt au-delà de la période de grâce.
function checkFounderContinuity(s, t = C.now()) {
  if (!s.founder || s.founder.rateLost) return false;
  const cp = OF.currentPlan(s, t);
  if (cp.status === 'none' && cp.expired) {
    s.founder.rateLost = true;
    s.founder.rateLostAt = t;
    save();
    return true;
  }
  return false;
}

// L'établissement peut-il (encore) souscrire au tarif Fondateur, pour une période débutant à `start` ?
function founderEligibility(s, start = C.now()) {
  if (!s.founder) {
    const o = OF.offers().founder;
    const taken = OF.founderSeatsTaken();
    return taken < o.seats ? { eligible: true, reason: `${o.seats - taken} place(s) Fondateur restante(s).` } : { eligible: false, reason: 'Les places Partenaire Fondateur sont toutes prises.' };
  }
  checkFounderContinuity(s);
  if (s.founder.rateLost) return { eligible: false, reason: 'Tarif Fondateur perdu : l\'abonnement a été interrompu au-delà de la période de grâce.' };
  if (s.founder.rateUntil && start >= s.founder.rateUntil) return { eligible: false, reason: `Tarif garanti jusqu'au ${dateFr(s.founder.rateUntil)} : il faut maintenant choisir une autre formule.` };
  return { eligible: true, reason: `Tarif garanti jusqu'au ${dateFr(s.founder.rateUntil)}, tant que l'abonnement est renouvelé sans interruption.` };
}

/* ---------------- Devis : dates, type d'opération, prorata ---------------- */

function getPlan(code) {
  const p = OF.offers().plans[code];
  if (!p || code === 'gratuit') throw bad('Formule inconnue.');
  return p;
}

// Calcule ce que l'enregistrement d'une formule produirait aujourd'hui :
//  - montée en gamme pendant un abonnement actif : effet immédiat jusqu'à la même échéance,
//    montant suggéré = différence de prix au prorata des jours restants ;
//  - renouvellement (même formule ou autre, abonnement actif ou en période de grâce) :
//    la nouvelle période commence à la fin de l'actuelle — aucun jour perdu ;
//  - sinon : nouvelle souscription à partir d'aujourd'hui.
function quote(s, planCode, t = C.now()) {
  const plan = getPlan(planCode);
  const cp = OF.currentPlan(s, t);
  let kind, start, end, prorata = null;
  if (cp.status === 'active' && plan.order > cp.plan.order) {
    kind = 'upgrade';
    start = startOfDay(t);
    end = cp.subscription.end;
    const total = cp.subscription.end - cp.subscription.start;
    const remaining = Math.max(0, end - start);
    const oldPrice = cp.subscription.listPrice ?? cp.plan.price;
    prorata = { remainingDays: Math.round(remaining / DAY), oldPrice, newPrice: plan.price, amount: round100((plan.price - oldPrice) * remaining / (total || 1)) };
  } else if (cp.status === 'active' || cp.status === 'grace') {
    kind = 'renewal';
    start = cp.paidUntil;
    end = addMonths(start, 12);
  } else {
    kind = OF.subscriptionsOf(s.id).length ? 'renewal' : 'new';
    start = startOfDay(t);
    end = addMonths(start, 12);
  }
  const founder = planCode === 'fondateur' ? founderEligibility(s, start) : null;
  return {
    plan: plan.code, planName: plan.name, kind, kindLabel: KINDS[kind], start, end, listPrice: plan.price,
    suggestedAmount: kind === 'upgrade' ? prorata.amount : plan.price, prorata, founder,
    current: { code: cp.code, name: cp.plan.name, status: cp.status, end: cp.end, paidUntil: cp.paidUntil },
  };
}

/* ---------------- Enregistrement d'un paiement d'abonnement ---------------- */

function recordSubscription(s, b, admin) {
  if (s.status !== 'active' && s.status !== 'suspended') throw bad('Seul un établissement validé et activé peut souscrire.');
  const q = quote(s, b.plan);
  if (q.founder && !q.founder.eligible) throw bad(q.founder.reason);
  const amount = Number(b.amount);
  if (!Number.isInteger(amount) || amount < 0) throw bad('Montant payé invalide (nombre entier en FCFA).');
  const discount = b.discount ? Number(b.discount) : 0;
  if (!Number.isInteger(discount) || discount < 0) throw bad('Remise invalide.');
  if (!METHODS[b.method]) throw bad('Choisissez le moyen de paiement.');
  let start = q.start, end = q.end;
  if (b.start !== undefined && b.start !== null && b.start !== '') {
    start = Number(b.start);
    if (!Number.isFinite(start)) throw bad('Date de début invalide.');
    end = q.kind === 'upgrade' ? Math.max(q.end, start + DAY) : addMonths(start, 12);
  }
  const t = C.now();
  const id = C.uid('sub_'), pid = C.uid('pay_');
  const sub = {
    id, schoolId: s.id, plan: q.plan, kind: q.kind, start, end, listPrice: q.listPrice, amount, discount,
    method: b.method, reference: clip(b.reference, 120), note: clip(b.note, 1000), founderRate: q.plan === 'fondateur',
    by: admin.id, createdAt: t, paymentId: pid, history: [],
  };
  const pay = {
    id: pid, receiptNo: nextReceiptNo(t), schoolId: s.id, subscriptionId: id, amount, discount, method: b.method,
    reference: sub.reference, note: sub.note, at: t, by: admin.id, label: `Abonnement ${q.planName} — ${KINDS[q.kind].toLowerCase()} (du ${dateFr(start)} au ${dateFr(end)})`,
  };
  data.subscriptions[id] = sub;
  data.payments[pid] = pay;
  if (q.plan === 'fondateur' && !s.founder) {
    s.founder = { since: start, seat: OF.founderSeatsTaken() + 1, rateUntil: addMonths(start, 12 * OF.offers().founder.guaranteedYears), subscriptionId: id, rateLost: false };
  }
  // Les demandes de formule en attente de cet établissement sont considérées comme traitées.
  for (const r of Object.values(data.planRequests)) if (r.schoolId === s.id && r.status === 'pending') Object.assign(r, { status: 'done', handledBy: admin.id, handledAt: t, subscriptionId: id });
  save();
  mail.send({
    to: s.email, subject: `Scola — paiement reçu (reçu ${pay.receiptNo})`,
    text: `Bonjour,\n\nNous avons bien reçu votre paiement de ${fcfa(amount)} (${METHODS[b.method]}) pour « ${s.name} ».\n\n${pay.label}.\nNuméro de reçu : ${pay.receiptNo}\n\nMerci de votre confiance.\nL'équipe Scola`,
  });
  return { subscription: sub, payment: pay };
}

// Paiement d'une campagne publicitaire : reçu numéroté, puis la campagne passe en revue.
function recordCampaignPayment(c, b, admin) {
  if (c.status !== 'awaiting_payment') throw bad('Cette campagne n\'attend pas de paiement.');
  const s = data.schools[c.schoolId];
  const amount = Number(b.amount);
  if (!Number.isInteger(amount) || amount < 0) throw bad('Montant payé invalide (nombre entier en FCFA).');
  const discount = b.discount ? Number(b.discount) : 0;
  if (!Number.isInteger(discount) || discount < 0) throw bad('Remise invalide.');
  if (!METHODS[b.method]) throw bad('Choisissez le moyen de paiement.');
  const t = C.now();
  const type = OF.offers().campaignTypes[c.type];
  const pay = {
    id: C.uid('pay_'), receiptNo: nextReceiptNo(t), schoolId: c.schoolId, campaignId: c.id, amount, discount, method: b.method,
    reference: clip(b.reference, 120), note: clip(b.note, 1000), at: t, by: admin.id,
    label: `Campagne « ${c.title} » — ${type?.name || c.type}, ${c.days} jours à partir du ${dateFr(c.start)}`,
  };
  data.payments[pay.id] = pay;
  c.paymentId = pay.id;
  c.history ||= [];
  c.history.push({ at: t, by: admin.id, from: c.status, to: 'in_review', note: `Paiement enregistré (reçu ${pay.receiptNo})` });
  c.status = 'in_review';
  c.updatedAt = t;
  save();
  if (s?.email) mail.send({ to: s.email, subject: `Scola — paiement reçu (reçu ${pay.receiptNo})`, text: `Bonjour,\n\nNous avons bien reçu votre paiement de ${fcfa(amount)} (${METHODS[b.method]}).\n${pay.label}.\nNuméro de reçu : ${pay.receiptNo}\n\nVotre campagne est maintenant en cours de validation.\n\nL'équipe Scola` });
  return pay;
}

function getSub(id) {
  const x = data.subscriptions[id];
  if (!x) throw bad('Abonnement introuvable.', 404);
  return x;
}

// Prolongation manuelle (geste commercial, correction) : ajoute des jours à l'échéance.
function extend(sub, days, note, admin) {
  days = Number(days);
  if (!Number.isInteger(days) || days < 1 || days > 730) throw bad('Nombre de jours invalide (1 à 730).');
  if (sub.cancelled) throw bad('Abonnement annulé.');
  sub.history ||= [];
  sub.history.push({ at: C.now(), by: admin.id, action: 'extend', days, from: sub.end, note: clip(note, 500) });
  sub.end += days * DAY;
  save();
  return sub;
}

// Changement de formule sans paiement (correction d'une saisie, geste commercial).
function changePlan(sub, planCode, note, admin) {
  getPlan(planCode);
  if (sub.cancelled) throw bad('Abonnement annulé.');
  if (planCode === 'fondateur' && sub.plan !== 'fondateur') {
    const s = data.schools[sub.schoolId];
    const f = founderEligibility(s, sub.start);
    if (!f.eligible) throw bad(f.reason);
    if (!s.founder) s.founder = { since: sub.start, seat: OF.founderSeatsTaken() + 1, rateUntil: addMonths(sub.start, 12 * OF.offers().founder.guaranteedYears), subscriptionId: sub.id, rateLost: false };
  }
  sub.history ||= [];
  sub.history.push({ at: C.now(), by: admin.id, action: 'plan', from: sub.plan, to: planCode, note: clip(note, 500) });
  sub.plan = planCode;
  sub.founderRate = planCode === 'fondateur';
  save();
  return sub;
}

// Annulation d'un enregistrement erroné : l'abonnement et son paiement sont marqués annulés (jamais effacés).
function cancel(sub, note, admin) {
  if (sub.cancelled) return sub;
  sub.cancelled = { at: C.now(), by: admin.id, note: clip(note, 500) };
  const pay = data.payments[sub.paymentId];
  if (pay) pay.cancelled = sub.cancelled;
  const s = data.schools[sub.schoolId];
  // Place Fondateur obtenue par cet enregistrement : elle est libérée.
  if (s?.founder?.subscriptionId === sub.id && !OF.subscriptionsOf(s.id).some(x => x.plan === 'fondateur')) delete s.founder;
  save();
  return sub;
}

/* ---------------- Rappels d'échéance ---------------- */

// Bandeau affiché dans l'espace établissement à l'approche de l'échéance, pendant la grâce,
// ou après le retour au statut sans abonnement.
function banner(s, t = C.now()) {
  const cp = OF.currentPlan(s, t);
  const max = Math.max(0, ...(OF.offers().reminderDays || []));
  if (cp.status === 'active') {
    if (cp.next) return null;
    const left = Math.ceil((cp.paidUntil - t) / DAY);
    if (left > max) return null;
    return { level: left <= 7 ? 'danger' : 'warn', daysLeft: left, text: `Votre formule ${cp.plan.name} arrive à échéance le ${dateFr(cp.paidUntil)} (dans ${left} jour${left > 1 ? 's' : ''}). Renouvelez-la pour garder vos avantages${s.founder && !s.founder.rateLost ? ' et votre tarif Fondateur' : ''}.` };
  }
  if (cp.status === 'grace') {
    const left = Math.ceil((cp.graceEnd - t) / DAY);
    return { level: 'danger', daysLeft: -Math.ceil((t - cp.end) / DAY), text: `Votre formule ${cp.plan.name} a expiré le ${dateFr(cp.end)}. Vos avantages restent actifs encore ${left} jour${left > 1 ? 's' : ''} (période de grâce) : renouvelez-la pour ne rien perdre${s.founder && !s.founder.rateLost ? ', y compris votre tarif Fondateur' : ''}.` };
  }
  if (cp.expired && t - cp.expired.end < 60 * DAY) {
    return { level: 'info', text: 'Votre abonnement a expiré : votre chaîne reste visible avec les fonctions de base. Rien n\'a été supprimé ; souscrivez une formule pour retrouver vos avantages.' };
  }
  return null;
}

async function remind(s, subject, text) {
  const r = await mail.send({ to: s.email, subject, text: `Bonjour,\n\n${text}\n\nPour renouveler, rendez-vous dans votre espace établissement, rubrique « Ma formule ».\n\nL'équipe Scola` });
  return r.sent;
}

// Tâche périodique : un seul e-mail par seuil et par échéance (mémorisé dans s.remindersSent).
// Sans SMTP, les rappels sont marqués comme traités : le bandeau de l'espace établissement prend le relais.
function runReminders(t = C.now()) {
  const thresholds = [...(OF.offers().reminderDays || [])].sort((a, b) => b - a);
  for (const s of Object.values(data.schools)) {
    if (s.status !== 'active') continue;
    checkFounderContinuity(s, t);
    const cp = OF.currentPlan(s, t);
    const sent = (s.remindersSent ||= {});
    let key = null, subject = null, text = null;
    if (cp.status === 'active' && !cp.next) {
      const left = Math.ceil((cp.paidUntil - t) / DAY);
      const due = thresholds.filter(d => left <= d);
      if (due.length) {
        key = `end:${cp.paidUntil}`;
        const done = (sent[key] ||= []);
        const todo = due.filter(d => !done.includes(d));
        if (!todo.length) continue;
        done.push(...todo);
        subject = `Scola — votre formule ${cp.plan.name} expire dans ${left} jour${left > 1 ? 's' : ''}`;
        text = `La formule ${cp.plan.name} de « ${s.name} » arrive à échéance le ${dateFr(cp.paidUntil)}. Le renouvellement anticipé ne vous fait perdre aucun jour : la nouvelle période commence à la fin de l'actuelle.${s.founder && !s.founder.rateLost ? ' Renouvelez sans interruption pour conserver votre tarif Partenaire Fondateur.' : ''}`;
      }
    } else if (cp.status === 'grace') {
      key = `grace:${cp.end}`;
      if (sent[key]) continue;
      sent[key] = [1];
      subject = 'Scola — votre abonnement a expiré (période de grâce)';
      text = `La formule ${cp.plan.name} de « ${s.name} » a expiré le ${dateFr(cp.end)}. Vos avantages restent actifs jusqu'au ${dateFr(cp.graceEnd)}. Passé cette date, votre chaîne repassera au niveau gratuit (rien ne sera supprimé).`;
    } else if (cp.status === 'none' && cp.expired && t - cp.expired.end < 45 * DAY) {
      key = `ended:${cp.expired.end}`;
      if (sent[key]) continue;
      sent[key] = [1];
      subject = 'Scola — votre chaîne est repassée au niveau gratuit';
      text = `L'abonnement de « ${s.name} » a pris fin. Votre chaîne reste visible avec ses fonctions de base, et rien n'a été supprimé. Vous pouvez souscrire à nouveau à tout moment.`;
    }
    if (!key) continue;
    // On ne garde que les traces récentes.
    for (const k of Object.keys(sent)) if (Number(k.split(':')[1]) < t - 400 * DAY) delete sent[k];
    save();
    remind(s, subject, text).catch(() => {});
  }
}
setTimeout(() => runReminders(), 20_000).unref();
setInterval(() => runReminders(), 3600e3).unref();

/* ---------------- Vues ---------------- */

const adminName = (id) => (id ? data.admins[id]?.name || 'Administrateur' : 'Système');

function subView(x) {
  return {
    ...x, planName: OF.planDef(x.plan).name, kindLabel: KINDS[x.kind] || x.kind, methodLabel: METHODS[x.method] || x.method,
    byName: adminName(x.by), receiptNo: data.payments[x.paymentId]?.receiptNo || null,
    history: (x.history || []).map(h => ({ ...h, byName: adminName(h.by) })),
  };
}

function paymentView(p) {
  const s = data.schools[p.schoolId];
  return {
    ...p, methodLabel: METHODS[p.method] || p.method, byName: adminName(p.by),
    school: s ? { id: s.id, name: s.name, address: s.address, city: s.city, country: s.country, email: s.email, phone: s.phone, manager: s.manager } : { id: p.schoolId, name: 'Établissement supprimé' },
    subscription: p.subscriptionId && data.subscriptions[p.subscriptionId] ? subView(data.subscriptions[p.subscriptionId]) : null,
    issuer: OF.offers().issuer,
  };
}

module.exports = {
  METHODS, KINDS, addMonths, quote, recordSubscription, recordCampaignPayment, getSub, extend, changePlan, cancel, banner, runReminders,
  founderEligibility, checkFounderContinuity, subView, paymentView, startOnlinePayment, nextReceiptNo, fcfa, dateFr,
};
