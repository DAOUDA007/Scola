// Mesure d'audience des établissements (chaînes, publications ; campagnes au lot suivant).
//
// Choix de stockage : AUCUN événement brut n'est conservé. Chaque événement incrémente un
// compteur du jour (data.stats[idÉtablissement].days['AAAA-MM-JJ']) ; les répartitions par
// ville, niveau et domaine sont des compteurs mensuels. Au-delà de 400 jours, les jours sont
// regroupés par mois.
//
// Visiteurs uniques : pour savoir si un élève a déjà été compté aujourd'hui, on garde en
// MÉMOIRE une empreinte du jour = HMAC(sel du jour, identifiant), tronquée. Le sel est tiré au
// hasard chaque jour et n'est jamais enregistré : à minuit (ou au redémarrage du serveur),
// empreintes et sel disparaissent, et rien ne permet plus de relier un compteur à un élève.
// Contrepartie assumée : après un redémarrage en cours de journée, un même élève peut être
// compté deux fois ce jour-là. Les « visiteurs uniques » d'un mois sont la somme des visiteurs
// uniques de chaque jour (un élève revenu 3 jours compte 3 fois).
const crypto = require('crypto');
const C = require('./core');
const catalog = require('./catalog');
const { data, save } = C;

const DAY = 86400e3;
const KEEP_DAYS = 400;
const KEEP_MONTHS_DIMS = 25;
const dayKey = (t = C.now()) => new Date(t).toISOString().slice(0, 10);
const monthKey = (t = C.now()) => new Date(t).toISOString().slice(0, 7);

// Métriques (clés courtes : une ligne de base par établissement).
const METRICS = {
  i: 'élèves ayant vu l\'établissement (listes, recherche, À la une)',
  v: 'visites de la chaîne',
  u: 'visiteurs uniques (par jour)',
  c: 'clics vers la chaîne depuis une liste',
  f: 'nouveaux abonnés',
  x: 'désabonnements',
  k: 'élèves ayant écrit',
  q: 'demandes d\'informations',
};

/* ---------------- Empreintes du jour (mémoire seulement) ---------------- */

let day = { key: null, salt: null, seen: new Map(), counts: new Map() };
function rollDay() {
  const k = dayKey();
  if (day.key === k) return;
  day = { key: k, salt: crypto.randomBytes(32), seen: new Map(), counts: new Map() };
  prune();
}
const fp = (uid) => crypto.createHmac('sha256', day.salt).update(String(uid)).digest('base64url').slice(0, 12);
function firstToday(scope, uid) {
  rollDay();
  const h = fp(uid);
  let set = day.seen.get(scope);
  if (!set) day.seen.set(scope, (set = new Set()));
  if (set.has(h)) return false;
  set.add(h);
  return true;
}
// Nombre de fois qu'un élève a vu une chose aujourd'hui (plafond de répétition des campagnes).
function countToday(scope, uid) { rollDay(); return day.counts.get(scope)?.get(fp(uid)) || 0; }
function bumpToday(scope, uid) {
  rollDay();
  let m = day.counts.get(scope);
  if (!m) day.counts.set(scope, (m = new Map()));
  const h = fp(uid), n = (m.get(h) || 0) + 1;
  m.set(h, n);
  return n;
}
setInterval(rollDay, 10 * 60e3).unref();

/* ---------------- Compteurs ---------------- */

function statsOf(sid) {
  const st = (data.stats[sid] ||= {});
  st.days ||= {}; st.months ||= {}; st.posts ||= {}; st.dims ||= {};
  return st;
}
function inc(sid, m, n = 1) {
  if (!data.schools[sid]) return;
  const b = (statsOf(sid).days[dayKey()] ||= {});
  b[m] = (b[m] || 0) + n;
  save();
}

// Profil agrégé d'un élève (jamais stocké tel quel : seulement ajouté à des compteurs).
function profile(uid) {
  const u = data.users[uid];
  const cls = data.classes[u?.classId];
  const d = catalog.domainOf(cls?.filiere);
  return {
    city: u?.city || 'Ville non renseignée',
    level: cls ? `${cls.cycleLabel} · ${cls.niveau}` : 'Autre',
    domain: d ? catalog.domains[d] : 'Autre',
  };
}
// Répartitions mensuelles (kind : visit | contact), une fois par élève et par jour.
function addDims(sid, uid, kind) {
  const p = profile(uid);
  const m = (statsOf(sid).dims[monthKey()] ||= {});
  const x = (m[kind] ||= { city: {}, level: {}, domain: {} });
  for (const k of ['city', 'level', 'domain']) x[k][p[k]] = (x[k][p[k]] || 0) + 1;
}

// L'établissement apparaît dans une liste vue par l'élève (suggestions, recherche, À la une).
function seen(sid, uid) { if (firstToday('i:' + sid, uid)) inc(sid, 'i'); }

// Visite de la chaîne ; `from` = suggestion | search | une (clic depuis une liste).
function visit(sid, uid, from) {
  inc(sid, 'v');
  if (firstToday('u:' + sid, uid)) { inc(sid, 'u'); addDims(sid, uid, 'visit'); }
  if (from && firstToday('c:' + sid, uid)) inc(sid, 'c');
}

function follow(sid, on) { inc(sid, on ? 'f' : 'x'); }

// Un élève écrit à l'établissement (compté une fois par jour) ; demande d'informations à part.
function contact(sid, uid, { info = false } = {}) {
  if (info) inc(sid, 'q');
  if (firstToday('k:' + sid, uid)) { inc(sid, 'k'); addDims(sid, uid, 'contact'); }
}

// Publications : affichage dans « À la une », clic, réponse privée à une publication.
function postStat(sid, pid) { return (statsOf(sid).posts[pid] ||= { i: 0, c: 0, r: 0 }); }
function postSeen(sid, pid, uid) { if (firstToday('pi:' + pid, uid)) { postStat(sid, pid).i++; save(); } }
function postClick(sid, pid, uid) { if (firstToday('pc:' + pid, uid)) { postStat(sid, pid).c++; save(); } }
function postReply(sid, pid) { postStat(sid, pid).r++; save(); }

/* ---------------- Campagnes ---------------- */

// Par campagne et par jour : i affichages, r élèves touchés (portée, unique par jour),
// c clics (unique par jour), k contacts (demandes d'informations venues de la publicité), h masquages.
function campStats(sid, cid) {
  const st = statsOf(sid);
  st.campaigns ||= {};
  const cs = (st.campaigns[cid] ||= { days: {}, dims: { city: {}, level: {}, domain: {} } });
  return cs;
}
function campInc(sid, cid, m) {
  const b = (campStats(sid, cid).days[dayKey()] ||= {});
  b[m] = (b[m] || 0) + 1;
  save();
}
function adImpression(sid, cid, uid) {
  campInc(sid, cid, 'i');
  if (firstToday('ar:' + cid, uid)) {
    campInc(sid, cid, 'r');
    const p = profile(uid), d = campStats(sid, cid).dims;
    for (const k of ['city', 'level', 'domain']) d[k][p[k]] = (d[k][p[k]] || 0) + 1;
  }
}
function adClick(sid, cid, uid) { if (firstToday('ac:' + cid, uid)) campInc(sid, cid, 'c'); }
function adContact(sid, cid) { campInc(sid, cid, 'k'); }
function adHide(sid, cid) { campInc(sid, cid, 'h'); }
const CAMP_KEYS = ['i', 'r', 'c', 'k', 'h'];
function campaignReport(sid, cid, threshold = 10) {
  const cs = data.stats[sid]?.campaigns?.[cid] || { days: {}, dims: {} };
  const totals = Object.fromEntries(CAMP_KEYS.map(k => [k, 0]));
  const days = Object.entries(cs.days).sort().map(([d, b]) => { for (const k of CAMP_KEYS) totals[k] += b[k] || 0; return { d, ...Object.fromEntries(CAMP_KEYS.map(k => [k, b[k] || 0])) }; });
  const dims = Object.fromEntries(['city', 'level', 'domain'].map(k => {
    const rows = Object.entries(cs.dims?.[k] || {}).sort((a, b) => b[1] - a[1]);
    const shown = rows.filter(([, n]) => n >= threshold).map(([label, n]) => ({ label, n }));
    const hidden = rows.filter(([, n]) => n < threshold);
    if (hidden.length) { const s = hidden.reduce((a, [, n]) => a + n, 0); shown.push({ label: `Autres (moins de ${threshold} personnes chacune)`, n: s >= threshold ? s : null, masked: s < threshold }); }
    return [k, shown];
  }));
  return { totals, days, dims };
}

/* ---------------- Rétention ---------------- */

// Une fois par jour : les jours de plus de 400 jours sont regroupés par mois,
// les répartitions de plus de 25 mois supprimées, les publications effacées oubliées.
function prune() {
  const limit = dayKey(C.now() - KEEP_DAYS * DAY);
  const dimLimit = monthKey(C.now() - KEEP_MONTHS_DIMS * 31 * DAY);
  let changed = false;
  for (const [sid, st] of Object.entries(data.stats)) {
    if (!data.schools[sid]) { delete data.stats[sid]; changed = true; continue; }
    for (const [d, b] of Object.entries(st.days || {})) {
      if (d >= limit) continue;
      const m = (st.months[d.slice(0, 7)] ||= {});
      for (const [k, n] of Object.entries(b)) m[k] = (m[k] || 0) + n;
      delete st.days[d];
      changed = true;
    }
    for (const m of Object.keys(st.dims || {})) if (m < dimLimit) { delete st.dims[m]; changed = true; }
    for (const cid of Object.keys(st.campaigns || {})) if (!data.campaigns[cid]) { delete st.campaigns[cid]; changed = true; }
    const live = new Set((data.posts[sid] || []).map(p => p.id));
    for (const pid of Object.keys(st.posts || {})) if (!live.has(pid)) { delete st.posts[pid]; changed = true; }
  }
  if (changed) save();
}

/* ---------------- Lecture (tableau de bord) ---------------- */

const empty = () => Object.fromEntries(Object.keys(METRICS).map(k => [k, 0]));
function addTo(a, b) { for (const k of Object.keys(METRICS)) a[k] += b?.[k] || 0; return a; }

// Série quotidienne sur [from, to[ (dates en ms), un point par jour.
function daily(sid, from, to) {
  const st = data.stats[sid] || {};
  const out = [];
  for (let t = from; t < to; t += DAY) out.push({ d: dayKey(t), ...addTo(empty(), st.days?.[dayKey(t)]) });
  return out;
}
// Série mensuelle (12 derniers mois), jours et mois archivés confondus.
function monthly(sid, n = 12) {
  const st = data.stats[sid] || {};
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    const s = addTo(empty(), st.months?.[key]);
    for (const [d, b] of Object.entries(st.days || {})) if (d.startsWith(key)) addTo(s, b);
    out.push({ m: key, ...s });
  }
  return out;
}
function total(series) { return series.reduce((a, b) => addTo(a, b), empty()); }

// Répartitions sur les mois couverts par la période, avec le seuil de confidentialité :
// toute catégorie de moins de `threshold` personnes est affichée « moins de N ».
function breakdown(sid, from, to, kind, threshold) {
  const st = data.stats[sid] || {};
  const acc = { city: {}, level: {}, domain: {} };
  for (const [m, d] of Object.entries(st.dims || {})) {
    if (m < monthKey(from) || m > monthKey(to - 1)) continue;
    for (const k of Object.keys(acc)) for (const [label, n] of Object.entries(d[kind]?.[k] || {})) acc[k][label] = (acc[k][label] || 0) + n;
  }
  return Object.fromEntries(Object.entries(acc).map(([k, obj]) => {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    const shown = rows.filter(([, n]) => n >= threshold).map(([label, n]) => ({ label, n }));
    const hidden = rows.filter(([, n]) => n < threshold);
    // Les petites catégories sont regroupées ; si leur total reste sous le seuil, il est masqué aussi.
    if (hidden.length) {
      const sum = hidden.reduce((a, [, n]) => a + n, 0);
      shown.push({ label: `Autres (moins de ${threshold} personnes chacune)`, n: sum >= threshold ? sum : null, masked: sum < threshold });
    }
    return [k, shown];
  }));
}
// Masque une valeur isolée sous le seuil (ex. une répartition des abonnés).
const mask = (n, threshold) => (n < threshold ? null : n);

module.exports = {
  METRICS, dayKey, monthKey, firstToday, countToday, bumpToday, adImpression, adClick, adContact, adHide, campaignReport, profile, seen, visit, follow, contact, postSeen, postClick, postReply, postStat,
  daily, monthly, total, breakdown, mask, statsOf, prune, DAY,
};
