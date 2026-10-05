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

module.exports = { countries, cycles, resolve };
