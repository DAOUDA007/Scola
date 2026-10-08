// Référentiel des parcours scolaires. Une classe Scola = pays + cycle + filière + niveau.
// Exemple : tous les étudiants « BTS · IDA · 1ère année · Côte d'Ivoire » partagent le même groupe.

const countries = [
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

const cycles = [
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

// Valide le choix fait pendant l'inscription et renvoie la classe canonique.
function resolve({ country, cycle, filiere, niveau }) {
  const c = cycles.find(x => x.id === cycle);
  if (!c) throw new Error('Cycle invalide');
  if (!countries.includes(country)) throw new Error('Pays invalide');
  if (!c.niveaux.includes(niveau)) throw new Error('Niveau invalide');
  let fil = String(filiere || '').trim().replace(/\s+/g, ' ');
  if (!fil || fil.length > 80) throw new Error('Filière invalide');
  // Filière saisie librement : on réutilise l'entrée du catalogue si elle correspond.
  const known = c.filieres.find(x => norm(x) === norm(fil) || norm(shortFiliere(x)) === norm(fil));
  if (known) fil = known;
  const key = [country, c.id, fil, niveau].map(norm).join('|');
  const name = `${c.label === 'Licence (LMD)' ? '' : c.label + ' '}${shortFiliere(fil)} · ${niveau}`.trim();
  return { key, country, cycle: c.id, cycleLabel: c.label, filiere: fil, niveau, name };
}

module.exports = { countries, cycles, cities, domains, domainOf, resolve };
