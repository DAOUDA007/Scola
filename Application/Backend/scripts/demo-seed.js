// Données de TEST pour la monétisation (jamais chargées automatiquement).
// Usage, serveur arrêté :
//   npm run demo:seed            crée 2 établissements (Starter, Pro) et 2 élèves de test
//   npm run demo:seed -- --remove   supprime tout ce qui a été créé par ce script
// Tout ce qui est créé porte le marqueur demo: true. Refusé si NODE_ENV=production.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../src/db');

if (process.env.NODE_ENV === 'production') {
  console.error('\n  Refusé : NODE_ENV=production. Les données de test ne doivent pas aller en production.\n');
  process.exit(1);
}

const DAY = 86400e3;
const PASSWORD = 'demo12345';

(async () => {
  await db.init();
  const C = require('../src/core');
  require('../src/offers'); // migration des réglages commerciaux
  const catalog = require('../src/catalog');
  const bcrypt = require('bcryptjs');
  const { data } = db;

  remove(data);
  if (process.argv.includes('--remove')) {
    db.save(); await db.flush();
    console.log('\n  Données de test supprimées.\n');
    return done();
  }

  const t = C.now();
  const school = (key, name, city, plan, email, type) => {
    const id = 'e_demo_' + key;
    data.schools[id] = {
      id, demo: true, email, status: 'active', requestedAt: t - 30 * DAY, activatedAt: t - 29 * DAY, followerIds: [], verified: plan === 'pro',
      tokenVersion: 0, name, type, country: "Côte d'Ivoire", city, address: `Quartier de test, ${city}`, phone: '+225 00 00 00 00',
      website: '', description: `${name} — établissement fictif créé pour tester les abonnements et campagnes Scola.`,
      programs: 'Informatique, Gestion', manager: { name: 'Responsable test', role: 'Directeur' }, logo: null,
      passwordHash: bcrypt.hashSync(PASSWORD, 10), gallery: [], formations: [], admissions: null,
    };
    data.posts[id] = [];
    if (plan) {
      const p = data.offers.plans[plan];
      const sid = 'sub_demo_' + key, pid = 'pay_demo_' + key;
      data.subscriptions[sid] = { id: sid, demo: true, schoolId: id, plan, start: t - 20 * DAY, end: t - 20 * DAY + 365 * DAY, listPrice: p.price, amount: p.price, discount: 0, method: 'wave', reference: 'TEST-' + key.toUpperCase(), kind: 'new', founderRate: false, note: 'Données de test', by: null, createdAt: t, paymentId: pid };
      data.payments[pid] = { id: pid, demo: true, receiptNo: 'TEST-' + key.toUpperCase(), schoolId: id, subscriptionId: sid, amount: p.price, method: 'wave', reference: 'TEST-' + key.toUpperCase(), at: t - 20 * DAY, by: null, note: 'Données de test' };
    }
    return id;
  };
  school('starter', 'Institut Démo Starter', 'Bouaké', 'starter', 'starter@demo.scola.test', 'formation');
  school('pro', 'Groupe Démo Pro', 'Abidjan', 'pro', 'pro@demo.scola.test', 'universite_privee');
  school('gratuit', 'Collège Démo Gratuit', 'Yamoussoukro', null, 'gratuit@demo.scola.test', 'lycee');

  const student = (key, name, phone, city, choice) => {
    const r = catalog.resolve({ country: "Côte d'Ivoire", ...choice });
    const { cls } = C.ensureClass(r);
    const id = 'u_demo_' + key;
    data.users[id] = {
      id, demo: true, phone, name, about: 'Compte de test', avatar: null, school: '', city, classId: cls.id, createdAt: t, lastSeen: t,
      pinHash: null, pinHint: '', privacy: C.defaultPrivacy(), settings: C.defaultSettings(), blocked: [],
    };
    data.phones[phone] = id;
    if (!cls.memberIds.includes(id)) cls.memberIds.push(id);
  };
  student('a', 'Élève Test Korhogo', '+2250100000001', 'Korhogo', { cycle: 'lycee', filiere: 'Série D', niveau: 'Terminale' });
  student('b', 'Élève Test Abidjan', '+2250100000002', 'Abidjan', { cycle: 'bts', filiere: 'IDA', niveau: '1ère année' });

  if (process.argv.includes('--stats')) fakeStats(data, t);

  db.save(); await db.flush();
  console.log(`
  ===== Données de test créées (marquées demo) =====${process.argv.includes('--stats') ? '\n  + statistiques FICTIVES sur 13 mois pour les établissements de démo (--stats)' : ''}
  Établissements (espace /etablissement, mot de passe : ${PASSWORD})
    starter@demo.scola.test   Institut Démo Starter  (formule Starter)
    pro@demo.scola.test       Groupe Démo Pro        (formule Pro)
    gratuit@demo.scola.test   Collège Démo Gratuit   (sans abonnement)
  Élèves (connexion par numéro, code affiché en mode démo)
    01 00 00 00 01   Terminale D, Korhogo
    01 00 00 00 02   BTS IDA 1ère année, Abidjan
  Pour tout supprimer : npm run demo:seed -- --remove
`);
  done();
})().catch((e) => { console.error('Échec :', e); process.exit(1); });

function remove(data) {
  const ids = new Set(Object.values(data.users).filter(u => u.demo).map(u => u.id));
  for (const id of ids) {
    const u = data.users[id];
    const cls = data.classes[u.classId];
    if (cls) cls.memberIds = cls.memberIds.filter(x => x !== id);
    if (data.phones[u.phone] === id) delete data.phones[u.phone];
    delete data.follows[id];
    delete data.users[id];
  }
  for (const s of Object.values(data.schools)) {
    if (!s.demo) { s.followerIds = (s.followerIds || []).filter(x => !ids.has(x)); continue; }
    for (const f of Object.values(data.follows)) delete f[s.id];
    delete data.posts[s.id];
    delete data.stats[s.id];
    delete data.schools[s.id];
  }
  for (const k of ['subscriptions', 'payments', 'planRequests', 'campaigns', 'inquiries']) {
    for (const [id, v] of Object.entries(data[k] || {})) if (v.demo || data.schools[v.schoolId] === undefined && String(v.schoolId).startsWith('e_demo_')) delete data[k][id];
  }
}

// Compteurs d'audience FICTIFS (option --stats) pour voir les tableaux de bord remplis.
// Uniquement pour les établissements de démo ; supprimés avec --remove.
function fakeStats(data, t) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Historique d'abonnements fictif : Starter et Pro ont renouvelé, le Collège n'a pas renouvelé.
  const past = [['starter', 'e_demo_starter', 'starter', 385, 20], ['pro', 'e_demo_pro', 'standard', 385, 20], ['gratuit', 'e_demo_gratuit', 'starter', 600, 235]];
  for (const [key, sid, plan, startAgo, endAgo] of past) {
    const p = data.offers.plans[plan];
    const sidx = 'sub_demo_old_' + key, pid = 'pay_demo_old_' + key;
    data.subscriptions[sidx] = { id: sidx, demo: true, schoolId: sid, plan, start: t - startAgo * 864e5, end: t - endAgo * 864e5, listPrice: p.price, amount: p.price, discount: 0, method: 'orange', reference: 'TEST-OLD-' + key.toUpperCase(), kind: 'new', founderRate: false, note: 'Données de test', by: null, createdAt: t - startAgo * 864e5, paymentId: pid };
    data.payments[pid] = { id: pid, demo: true, receiptNo: 'TEST-OLD-' + key.toUpperCase(), schoolId: sid, subscriptionId: sidx, amount: p.price, method: 'orange', reference: '', at: t - (startAgo + 3) * 864e5, by: null, note: 'Données de test' };
  }
  for (const [key, amount, ago] of [['c1', 120000, 150], ['c2', 60000, 95], ['c3', 150000, 50]]) {
    const pid = 'pay_demo_camp_' + key;
    data.payments[pid] = { id: pid, demo: true, receiptNo: 'TEST-CAMP-' + key.toUpperCase(), schoolId: 'e_demo_pro', campaignId: 'cmp_demo_fake_' + key, amount, method: 'wave', reference: '', at: t - ago * 864e5, by: null, note: 'Campagne fictive (données de test)', label: 'Campagne fictive' };
  }

  const size = { e_demo_pro: 1, e_demo_starter: 0.35, e_demo_gratuit: 0.15 };
  for (const [sid, k] of Object.entries(size)) {
    const st = (data.stats[sid] = { days: {}, months: {}, posts: {}, dims: {} });
    for (let i = 395; i >= 0; i--) {
      const d = new Date(t - i * 864e5);
      const season = 1 + 0.6 * Math.sin(((d.getUTCMonth() + 3) / 12) * 2 * Math.PI); // pic à la rentrée
      const wk = [0.6, 1.1, 1, 1, 1.05, 0.9, 0.7][d.getUTCDay()];
      const base = 120 * k * season * wk * (0.75 + rnd() * 0.5);
      const iSeen = Math.round(base * 3), u = Math.round(base * 0.45);
      st.days[d.toISOString().slice(0, 10)] = {
        i: iSeen, v: Math.round(u * 1.4), u, c: Math.round(u * 0.6), f: Math.round(u * 0.08 * rnd() * 2),
        x: Math.round(rnd() * 2 * k), k: Math.round(u * 0.06 * (0.5 + rnd())), q: Math.round(u * 0.03 * (0.5 + rnd())),
      };
    }
    const cities = [['Abidjan', 0.45], ['Bouaké', 0.14], ['Yamoussoukro', 0.09], ['Korhogo', 0.07], ['Daloa', 0.06], ['San-Pédro', 0.05], ['Ville non renseignée', 0.11], ['Odienné', 0.004], ['Touba', 0.003]];
    const levels = [['Lycée · Terminale', 0.42], ['BTS · 1ère année', 0.2], ['Lycée · 1ère', 0.15], ['Licence (LMD) · Licence 1', 0.12], ['BTS · 2ème année', 0.08], ['Collège · 3ème', 0.004]];
    const domains = [['Informatique & numérique', 0.3], ['Gestion & commerce', 0.25], ['Sciences', 0.2], ['Santé', 0.1], ['Droit & sciences politiques', 0.08], ['Lettres, langues & sciences humaines', 0.05], ['Tourisme & hôtellerie', 0.004]];
    for (let m = 0; m < 13; m++) {
      const d = new Date(Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() - m, 15));
      const key = d.toISOString().slice(0, 7);
      const tot = Object.entries(st.days).filter(([dk]) => dk.startsWith(key)).reduce((a, [, b]) => a + b.u, 0);
      const tk = Object.entries(st.days).filter(([dk]) => dk.startsWith(key)).reduce((a, [, b]) => a + b.k, 0);
      const split = (n, dist) => Object.fromEntries(dist.map(([l, p]) => [l, Math.round(n * p)]));
      st.dims[key] = {
        visit: { city: split(tot, cities), level: split(tot, levels), domain: split(tot, domains) },
        contact: { city: split(tk, cities), level: split(tk, levels), domain: split(tk, domains) },
      };
    }
  }
}

function done() {
  console.log(db.usesPostgres() ? '  (Base PostgreSQL mise à jour : redémarrez le serveur.)\n' : '  (Lancez ensuite npm start.)\n');
  process.exit(0);
}
