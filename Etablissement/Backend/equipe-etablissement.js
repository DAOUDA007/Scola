// Équipe d'un établissement : plusieurs personnes gèrent le même espace, chacune avec son mot de passe
// (toujours généré par Scola), son poste et ses droits. Tout le monde se connecte avec l'e-mail de
// l'établissement : c'est le mot de passe qui indique qui se connecte.
//
// Le responsable principal garde le mot de passe historique de l'établissement (s.passwordHash) : la
// récupération par SMS et le mot de passe provisoire de l'administration Scola continuent de le viser.
// Lui seul gère l'équipe et peut transmettre son rôle à un membre.
const crypto = require('crypto');

const RIGHTS = {
  posts: 'Publications',
  inquiries: 'Messages des élèves',
  channel: 'Ma chaîne (profil et page officielle)',
  offer: 'Ma formule et paiements',
  campaigns: 'Campagnes',
  stats: 'Tableau de bord et rapports',
  support: 'Contacter Scola',
};
const ALL = Object.fromEntries(Object.keys(RIGHTS).map(k => [k, true]));
const MAX_MEMBERS = 15;
const OWNER = 'owner';

const clip = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const cleanRights = (r) => Object.fromEntries(Object.keys(RIGHTS).map(k => [k, !!(r && r[k])]));

// Mot de passe généré : 12 caractères faciles à dicter (sans 0/o, 1/l/i), soit environ 60 bits.
function generatePassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const c = Array.from({ length: 12 }, () => A[crypto.randomInt(A.length)]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

function setup({ bcrypt, httpError, save, now }) {
  const members = (s) => (s.members ||= {});
  const owner = (s) => ({
    id: OWNER, owner: true, rights: { ...ALL },
    name: s.ownerName || s.manager?.name || 'Responsable principal',
    role: s.ownerRole || s.manager?.role || 'Responsable principal',
    lastLogin: s.lastLogin || null,
  });
  // Personne connectée (identifiant présent dans la session).
  function actor(s, memberId) {
    if (!memberId || memberId === OWNER) return owner(s);
    const m = members(s)[memberId];
    return m ? { id: m.id, owner: false, name: m.name, role: m.role, rights: { ...cleanRights(m.rights) }, lastLogin: m.lastLogin || null } : null;
  }
  const label = (a) => `${a.name}${a.role ? ' · ' + a.role : ''}`;

  function log(s, a, action, target = '') {
    (s.teamLog ||= []).push({ at: now(), by: a ? label(a) : 'Scola', action, target: String(target).slice(0, 160) });
    if (s.teamLog.length > 300) s.teamLog.splice(0, s.teamLog.length - 300);
  }

  // Connexion : le mot de passe désigne le responsable ou l'un des membres.
  function identify(s, password) {
    const pw = String(password || '');
    if (s.passwordHash && bcrypt.compareSync(pw, s.passwordHash)) return OWNER;
    for (const m of Object.values(members(s))) if (bcrypt.compareSync(pw, m.passwordHash)) return m.id;
    return null;
  }
  // Version de session : changer un mot de passe ou retirer un membre ferme ses sessions.
  const versionOf = (s, memberId) => (!memberId || memberId === OWNER ? s.tokenVersion || 0 : members(s)[memberId]?.tokenVersion ?? -1);

  function view(m) {
    return { id: m.id, name: m.name, role: m.role, rights: cleanRights(m.rights), createdAt: m.createdAt, createdBy: m.createdBy || null, lastLogin: m.lastLogin || null };
  }
  function list(s) {
    return { owner: owner(s), members: Object.values(members(s)).sort((a, b) => a.createdAt - b.createdAt).map(view), rights: RIGHTS, max: MAX_MEMBERS, log: [...(s.teamLog || [])].reverse().slice(0, 100) };
  }
  function getMember(s, id) {
    const m = members(s)[id];
    if (!m) throw httpError(404, 'Membre introuvable.');
    return m;
  }
  function checkIdentity(b) {
    const name = clip(b.name, 60), role = clip(b.role, 60);
    if (name.length < 2) throw httpError(400, 'Indiquez le nom de la personne.');
    if (role.length < 2) throw httpError(400, 'Indiquez son poste (ex. Service communication).');
    return { name, role };
  }

  function add(s, a, b) {
    if (Object.keys(members(s)).length >= MAX_MEMBERS) throw httpError(400, `${MAX_MEMBERS} membres au maximum.`);
    const { name, role } = checkIdentity(b);
    const password = generatePassword();
    const m = { id: 'mb_' + crypto.randomBytes(6).toString('base64url'), name, role, rights: cleanRights(b.rights), passwordHash: bcrypt.hashSync(password, 10), tokenVersion: 0, createdAt: now(), createdBy: label(a) };
    members(s)[m.id] = m;
    log(s, a, 'Membre ajouté', label(m));
    save();
    return { member: view(m), password };
  }
  function update(s, a, id, b) {
    const m = getMember(s, id);
    if (b.name !== undefined || b.role !== undefined) Object.assign(m, checkIdentity({ name: b.name ?? m.name, role: b.role ?? m.role }));
    if (b.rights) {
      m.rights = cleanRights(b.rights);
      log(s, a, 'Droits modifiés', `${label(m)} : ${Object.entries(m.rights).filter(([, v]) => v).map(([k]) => RIGHTS[k]).join(', ') || 'aucun'}`);
    } else log(s, a, 'Membre modifié', label(m));
    save();
    return view(m);
  }
  function regenerate(s, a, id) {
    const m = getMember(s, id);
    const password = generatePassword();
    m.passwordHash = bcrypt.hashSync(password, 10);
    m.tokenVersion = (m.tokenVersion || 0) + 1;
    log(s, a, 'Nouveau mot de passe généré', label(m));
    save();
    return { member: view(m), password };
  }
  function remove(s, a, id) {
    const m = getMember(s, id);
    delete members(s)[id];
    log(s, a, 'Membre retiré', label(m));
    save();
  }
  // Transmission du rôle : le membre choisi devient responsable principal (avec son mot de passe
  // actuel) ; l'ancien responsable devient membre avec tous les droits, et garde son mot de passe.
  function transfer(s, a, id) {
    const m = getMember(s, id);
    const old = owner(s);
    const formerId = 'mb_' + crypto.randomBytes(6).toString('base64url');
    members(s)[formerId] = { id: formerId, name: old.name, role: old.role, rights: { ...ALL }, passwordHash: s.passwordHash, tokenVersion: 0, createdAt: now(), createdBy: label(old) };
    s.passwordHash = m.passwordHash;
    s.ownerName = m.name;
    s.ownerRole = m.role;
    s.mustChangePassword = false;
    s.tokenVersion = (s.tokenVersion || 0) + 1;
    delete members(s)[id];
    log(s, a, 'Rôle de responsable principal transmis', `${label(old)} → ${label(m)}`);
    save();
  }
  function touchLogin(s, memberId) {
    if (memberId && memberId !== OWNER && members(s)[memberId]) members(s)[memberId].lastLogin = now();
    else s.lastLogin = now();
    log(s, actor(s, memberId), 'Connexion');
  }

  return { RIGHTS, OWNER, actor, label, identify, versionOf, list, add, update, regenerate, remove, transfer, touchLogin, log };
}

module.exports = { setup, RIGHTS, generatePassword };
