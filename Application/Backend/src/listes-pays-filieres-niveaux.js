// Référentiel des parcours scolaires. Une classe Scola = pays + cycle + filière + niveau.
// Exemple : tous les étudiants « BTS · IDA · 1ère année · Côte d'Ivoire » partagent le même groupe.
// Les listes ci-dessous sont celles d'origine. L'administration peut les modifier (pays, cycles,
// filières/séries, niveaux) : la version modifiée est alors enregistrée dans la base (data.meta.catalog).
const { data, save } = require('./base-de-donnees');

const DEFAULT_COUNTRIES = [
  "Côte d'Ivoire", 'Bénin', 'Burkina Faso', 'Cameroun', 'Congo', 'RD Congo', 'Gabon',
  'Guinée', 'Mali', 'Niger', 'Sénégal', 'Tchad', 'Togo', 'Madagascar', 'Maroc', 'Tunisie',
  'Algérie', 'France', 'Belgique', 'Canada', 'Suisse',
];

const lycee = ['Série A', 'Série C', 'Série D', 'Série E', 'Série F', 'Série G'];
const univ = [
  'Informatique', 'Mathématiques', 'Physique', 'Chimie', 'Biologie', 'Géologie', 'Médecine',
  'Pharmacie', 'Odontologie', 'Droit', 'Sciences économiques', 'Gestion', 'Sciences politiques',
  'Lettres modernes', 'Anglais', 'Allemand', 'Espagnol', 'Histoire', 'Géographie', 'Philosophie',
  'Sociologie', 'Psychologie', 'Sciences de la communication', 'Criminologie', 'Agronomie',
  'Génie civil', 'Génie électrique', 'Génie mécanique', 'Télécommunications', 'Architecture',
];

const DEFAULT_CYCLES = [
  {
    id: 'primaire', label: 'Primaire',
    filieres: ['Enseignement général'],
    niveaux: ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'],
  },
  {
    id: 'college', label: 'Collège',
    filieres: ['Enseignement général'],
    niveaux: ['6ème', '5ème', '4ème', '3ème'],
  },
  {
    id: 'lycee', label: 'Lycée',
    filieres: lycee,
    niveaux: ['2nde', '1ère', 'Terminale'],
  },
  {
    id: 'technique', label: 'Lycée technique / professionnel',
    filieres: ['Électricité', 'Électronique', 'Mécanique auto', 'Froid et climatisation', 'Bâtiment', 'Comptabilité', 'Secrétariat', 'Hôtellerie', 'Couture'],
    niveaux: ['CAP 1', 'CAP 2', 'BEP 1', 'BEP 2', 'BT 1', 'BT 2', 'Bac Pro 1', 'Bac Pro 2', 'Bac Pro 3'],
  },
  {
    id: 'bts', label: 'BTS',
    filieres: [
      'IDA — Informatique Développeur d\'Applications',
      'RIT — Réseaux Informatiques et Télécommunications',
      'FCGE — Finance Comptabilité et Gestion des Entreprises',
      'GEC — Gestion Commerciale',
      'RHC — Ressources Humaines et Communication',
      'AD — Assistanat de Direction',
      'LOG — Logistique',
      'TL — Transport Logistique',
      'COM — Communication',
      'MCV — Marketing et Communication Visuelle',
      'ELT — Électrotechnique',
      'MSI — Maintenance des Systèmes Industriels',
      'BAT — Bâtiment',
      'TP — Travaux Publics',
      'TOU — Tourisme Hôtellerie',
      'AGRI — Agriculture',
    ],
    niveaux: ['1ère année', '2ème année'],
  },
  { id: 'licence', label: 'Licence (LMD)', filieres: univ, niveaux: ['Licence 1', 'Licence 2', 'Licence 3'] },
  { id: 'master', label: 'Master', filieres: univ, niveaux: ['Master 1', 'Master 2'] },
  { id: 'ingenieur', label: 'École d\'ingénieurs', filieres: ['Informatique', 'Génie civil', 'Génie électrique', 'Génie mécanique', 'Génie chimique', 'Mines et géologie', 'Agronomie', 'Télécommunications'], niveaux: ['Prépa 1', 'Prépa 2', 'Ingénieur 1', 'Ingénieur 2', 'Ingénieur 3'] },
  { id: 'doctorat', label: 'Doctorat', filieres: univ, niveaux: ['Doctorat 1', 'Doctorat 2', 'Doctorat 3'] },
];

// Principales villes de Côte d'Ivoire (ville facultative des élèves, ciblage des campagnes).
// Saisie libre possible pour les autres villes.
const cities = [
  'Abidjan', 'Bouaké', 'Daloa', 'Yamoussoukro', 'San-Pédro', 'Korhogo', 'Man', 'Divo', 'Gagnoa', 'Abengourou',
  'Anyama', 'Agboville', 'Grand-Bassam', 'Dabou', 'Bingerville', 'Soubré', 'Séguéla', 'Odienné', 'Bondoukou',
  'Ferkessédougou', 'Dimbokro', 'Sassandra', 'Issia', 'Toumodi', 'Adzopé', 'Aboisso', 'Katiola', 'Duékoué',
  'Guiglo', 'Bouaflé', 'Tiassalé', 'Daoukro', 'Boundiali', 'Danané', 'Lakota', 'Sinfra', 'Oumé', 'Bonoua',
];

// Domaines de formation (ciblage des campagnes, statistiques des établissements).
const domains = {
  numerique: 'Informatique & numérique',
  gestion: 'Gestion & commerce',
  sante: 'Santé',
  droit: 'Droit & sciences politiques',
  lettres: 'Lettres, langues & sciences humaines',
  sciences: 'Sciences',
  genie: 'Génie & industrie',
  agriculture: 'Agriculture & environnement',
  tourisme: 'Tourisme & hôtellerie',
  communication: 'Communication & arts',
  general: 'Enseignement général',
};

// Correspondance filière → domaine (filières du catalogue, codes BTS compris).
const FILIERE_DOMAIN = {
  'Enseignement général': 'general',
  'Série A': 'lettres', 'Série C': 'sciences', 'Série D': 'sciences', 'Série E': 'sciences', 'Série F': 'genie', 'Série G': 'gestion',
  'Électricité': 'genie', 'Électronique': 'genie', 'Mécanique auto': 'genie', 'Froid et climatisation': 'genie', 'Bâtiment': 'genie',
  'Comptabilité': 'gestion', 'Secrétariat': 'gestion', 'Hôtellerie': 'tourisme', 'Couture': 'communication',
  IDA: 'numerique', RIT: 'numerique', FCGE: 'gestion', GEC: 'gestion', RHC: 'gestion', AD: 'gestion', LOG: 'gestion', TL: 'gestion',
  COM: 'communication', MCV: 'communication', ELT: 'genie', MSI: 'genie', BAT: 'genie', TP: 'genie', TOU: 'tourisme', AGRI: 'agriculture',
  'Informatique': 'numerique', 'Télécommunications': 'numerique', 'Mathématiques': 'sciences', 'Physique': 'sciences', 'Chimie': 'sciences',
  'Biologie': 'sciences', 'Géologie': 'sciences', 'Mines et géologie': 'sciences', 'Médecine': 'sante', 'Pharmacie': 'sante', 'Odontologie': 'sante',
  'Droit': 'droit', 'Sciences politiques': 'droit', 'Criminologie': 'droit', 'Sciences économiques': 'gestion', 'Gestion': 'gestion',
  'Lettres modernes': 'lettres', 'Anglais': 'lettres', 'Allemand': 'lettres', 'Espagnol': 'lettres', 'Histoire': 'lettres', 'Géographie': 'lettres',
  'Philosophie': 'lettres', 'Sociologie': 'lettres', 'Psychologie': 'lettres', 'Sciences de la communication': 'communication',
  'Agronomie': 'agriculture', 'Génie civil': 'genie', 'Génie électrique': 'genie', 'Génie mécanique': 'genie', 'Génie chimique': 'genie',
  'Architecture': 'genie',
};
// Mots-clés pour les filières saisies librement.
const KEYWORDS = [
  [/informat|numeri|reseau|telecom|developp|digital|data|logiciel|web/, 'numerique'],
  [/medec|pharma|sante|infirm|sage.?femme|odonto|biomed|kine/, 'sante'],
  [/droit|juridi|politi|criminol/, 'droit'],
  [/gestion|commerc|compta|financ|banque|marketing|logisti|transport|ressources humaines|econom|management|assistanat|secretar/, 'gestion'],
  [/genie|electr|mecani|batiment|travaux|industri|maintenance|btp|archit|mines/, 'genie'],
  [/agri|agro|elevage|environnement|forest/, 'agriculture'],
  [/touris|hotel|restaura|cuisine/, 'tourisme'],
  [/communic|journal|audiovis|graphi|design|art|couture|mode/, 'communication'],
  [/lettre|langue|anglais|espagnol|allemand|histoire|geograph|philo|sociol|psycho/, 'lettres'],
  [/math|physi|chimi|biolog|geolog|science|serie [cde]/, 'sciences'],
];

function domainOf(filiere) {
  if (!filiere) return null;
  const f = String(filiere);
  const custom = data.meta.catalog?.domainOf || {};
  if (custom[f]) return custom[f];
  if (FILIERE_DOMAIN[f]) return FILIERE_DOMAIN[f];
  const short = shortFiliere(f);
  if (FILIERE_DOMAIN[short]) return FILIERE_DOMAIN[short];
  const n = norm(f);
  for (const [re, d] of KEYWORDS) if (re.test(n)) return d;
  return null;
}

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function shortFiliere(f) {
  // « IDA — Informatique ... » -> « IDA »
  const m = /^([A-Z]{2,6}) — /.exec(f);
  return m ? m[1] : f;
}

/* ---------------- Listes en vigueur (modifiables par l'administration) ---------------- */
const clone = (x) => JSON.parse(JSON.stringify(x));
function current() {
  return data.meta.catalog || { countries: DEFAULT_COUNTRIES, cycles: DEFAULT_CYCLES, domainOf: {} };
}
// Première modification : on part d'une copie des listes d'origine.
function editable() {
  if (!data.meta.catalog) data.meta.catalog = { countries: clone(DEFAULT_COUNTRIES), cycles: clone(DEFAULT_CYCLES), domainOf: {}, updatedAt: null };
  return data.meta.catalog;
}

const className = (cycleLabel, filiere, niveau) => `${cycleLabel === 'Licence (LMD)' ? '' : cycleLabel + ' '}${shortFiliere(filiere)} · ${niveau}`.trim();
const classKey = (country, cycle, filiere, niveau) => [country, cycle, filiere, niveau].map(norm).join('|');

// Valide le choix fait pendant l'inscription et renvoie la classe canonique.
function resolve({ country, cycle, filiere, niveau }) {
  const cat = current();
  const c = cat.cycles.find(x => x.id === cycle);
  if (!c) throw new Error('Cycle invalide');
  if (!cat.countries.includes(country)) throw new Error('Pays invalide');
  if (!c.niveaux.includes(niveau)) throw new Error('Niveau invalide');
  let fil = String(filiere || '').trim().replace(/\s+/g, ' ');
  if (!fil || fil.length > 80) throw new Error('Filière invalide');
  // Filière saisie librement : on réutilise l'entrée du catalogue si elle correspond.
  const known = c.filieres.find(x => norm(x) === norm(fil) || norm(shortFiliere(x)) === norm(fil));
  if (known) fil = known;
  return { key: classKey(country, c.id, fil, niveau), country, cycle: c.id, cycleLabel: c.label, filiere: fil, niveau, name: className(c.label, fil, niveau) };
}

/* ---------------- Modification par l'administration ---------------- */
class CatalogError extends Error {}
const bad = (m) => new CatalogError(m);
function cleanText(v, max = 80) {
  const t = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!t) throw bad('Le nom est vide.');
  if (t.length > max) throw bad(`Le nom est trop long (${max} caractères maximum).`);
  return t;
}
const same = (a, b) => norm(a) === norm(b);
function cycleOf(cat, id) {
  const c = cat.cycles.find(x => x.id === id);
  if (!c) throw bad('Cycle introuvable.');
  return c;
}
function move(list, i, dir) {
  const j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

// Renommage : les classes existantes suivent (clé, nom), sauf si une classe porte déjà le nouveau nom.
function migrateClasses(match, change) {
  let moved = 0, conflicts = 0;
  for (const cls of Object.values(data.classes)) {
    if (!match(cls)) continue;
    const next = { cycleLabel: cls.cycleLabel, filiere: cls.filiere, niveau: cls.niveau, ...change(cls) };
    const key = classKey(cls.country, cls.cycle, next.filiere, next.niveau);
    if (key !== cls.key && data.classKeys[key] && data.classKeys[key] !== cls.id) { conflicts++; continue; }
    const autoName = cls.name === className(cls.cycleLabel, cls.filiere, cls.niveau);
    if (key !== cls.key) { delete data.classKeys[cls.key]; data.classKeys[key] = cls.id; cls.key = key; }
    Object.assign(cls, next);
    if (autoName) cls.name = className(cls.cycleLabel, cls.filiere, cls.niveau);
    moved++;
  }
  return { moved, conflicts };
}

function apply(b) {
  const cat = editable();
  const L = b.list === 'niveaux' ? 'niveaux' : 'filieres';
  let result = {};
  switch (b.op) {
    case 'addCountry': {
      const n = cleanText(b.value, 60);
      if (cat.countries.some(x => same(x, n))) throw bad('Ce pays est déjà dans la liste.');
      cat.countries.push(n);
      break;
    }
    case 'removeCountry':
      if (cat.countries.length <= 1) throw bad('Il faut au moins un pays.');
      cat.countries = cat.countries.filter(x => x !== b.value);
      break;
    case 'addCycle': {
      const label = cleanText(b.value, 50);
      if (cat.cycles.some(x => same(x.label, label))) throw bad('Ce cycle existe déjà.');
      let id = norm(label).replace(/ /g, '-').slice(0, 30) || 'cycle';
      while (cat.cycles.some(x => x.id === id)) id += '-2';
      cat.cycles.push({ id, label, filieres: [], niveaux: [] });
      result.id = id;
      break;
    }
    case 'renameCycle': {
      const c = cycleOf(cat, b.cycle);
      const label = cleanText(b.value, 50);
      if (cat.cycles.some(x => x !== c && same(x.label, label))) throw bad('Un autre cycle porte déjà ce nom.');
      c.label = label;
      result = migrateClasses(cls => cls.cycle === c.id, () => ({ cycleLabel: label }));
      break;
    }
    case 'removeCycle':
      cycleOf(cat, b.cycle);
      if (cat.cycles.length <= 1) throw bad('Il faut au moins un cycle.');
      cat.cycles = cat.cycles.filter(x => x.id !== b.cycle);
      break;
    case 'moveCycle':
      move(cat.cycles, cat.cycles.findIndex(x => x.id === b.cycle), b.dir);
      break;
    case 'addItem': {
      const c = cycleOf(cat, b.cycle);
      const v = cleanText(b.value);
      if (c[L].some(x => same(x, v))) throw bad('Déjà dans la liste.');
      c[L].push(v);
      if (L === 'filieres' && b.domain && domains[b.domain]) cat.domainOf[v] = b.domain;
      break;
    }
    case 'renameItem': {
      const c = cycleOf(cat, b.cycle);
      const i = c[L].indexOf(b.from);
      if (i < 0) throw bad('Élément introuvable.');
      const v = cleanText(b.value);
      if (c[L].some((x, k) => k !== i && same(x, v))) throw bad('Ce nom est déjà dans la liste.');
      c[L][i] = v;
      if (L === 'filieres' && cat.domainOf[b.from]) { cat.domainOf[v] = cat.domainOf[b.from]; delete cat.domainOf[b.from]; }
      result = L === 'filieres'
        ? migrateClasses(cls => cls.cycle === c.id && cls.filiere === b.from, () => ({ filiere: v }))
        : migrateClasses(cls => cls.cycle === c.id && cls.niveau === b.from, () => ({ niveau: v }));
      break;
    }
    case 'removeItem': {
      const c = cycleOf(cat, b.cycle);
      if (L === 'niveaux' && c.niveaux.length <= 1) throw bad('Un cycle doit garder au moins un niveau.');
      c[L] = c[L].filter(x => x !== b.value);
      break;
    }
    case 'moveItem': {
      const c = cycleOf(cat, b.cycle);
      move(c[L], c[L].indexOf(b.value), b.dir);
      break;
    }
    // Tri alphabétique (A → Z ou Z → A), « 2ème » avant « 10ème ».
    case 'sortItems': {
      const by = (a, z) => a.localeCompare(z, 'fr', { numeric: true, sensitivity: 'base' }) * (b.dir === 'desc' ? -1 : 1);
      if (b.list === 'countries') cat.countries.sort(by);
      else cycleOf(cat, b.cycle)[L].sort(by);
      break;
    }
    case 'setDomain':
      if (b.domain && !domains[b.domain]) throw bad('Domaine inconnu.');
      if (b.domain) cat.domainOf[cleanText(b.value)] = b.domain; else delete cat.domainOf[b.value];
      break;
    case 'reset':
      delete data.meta.catalog;
      save();
      return result;
    default:
      throw bad('Opération inconnue.');
  }
  cat.updatedAt = Date.now();
  save();
  return result;
}

// Vue de l'administration : listes, nombre de classes/élèves par élément, filières saisies librement.
function adminView() {
  const cat = current();
  const use = {};
  const unlisted = {};
  for (const cls of Object.values(data.classes)) {
    const n = cls.memberIds?.length || 0;
    const add = (k) => { use[k] ||= { classes: 0, members: 0 }; use[k].classes++; use[k].members += n; };
    add('country|' + cls.country); add('cycle|' + cls.cycle);
    add(`filieres|${cls.cycle}|${cls.filiere}`); add(`niveaux|${cls.cycle}|${cls.niveau}`);
    const cy = cat.cycles.find(x => x.id === cls.cycle);
    if (cy && !cy.filieres.includes(cls.filiere)) {
      const k = cls.cycle + '|' + cls.filiere;
      unlisted[k] ||= { cycle: cls.cycle, cycleLabel: cy.label, filiere: cls.filiere, classes: 0, members: 0 };
      unlisted[k].classes++; unlisted[k].members += n;
    }
  }
  return {
    countries: cat.countries, cycles: cat.cycles, domains,
    domainOf: Object.fromEntries(cat.cycles.flatMap(c => c.filieres).map(f => [f, domainOf(f)])),
    use, unlisted: Object.values(unlisted).sort((a, z) => z.members - a.members),
    custom: !!data.meta.catalog, updatedAt: data.meta.catalog?.updatedAt || null,
  };
}

module.exports = {
  get countries() { return current().countries; },
  get cycles() { return current().cycles; },
  cities, domains, domainOf, resolve, apply, adminView, CatalogError,
};
