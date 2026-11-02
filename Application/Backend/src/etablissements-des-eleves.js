// Établissement de chaque élève et « groupe de classe de l'école ».
//
// En plus du groupe national de sa classe (ex. BTS IDA · 1ère année · Côte d'Ivoire), chaque élève
// rejoint le groupe de sa classe DANS son établissement (ex. BTS IDA · 1ère année · ETIC Korhogo).
// Ce second groupe est une « classe » comme les autres (data.classes, kind: 'school'), rattachée à la
// classe nationale (nationalId) et à l'établissement (institutionId) : messages, médias, appels et
// modération fonctionnent à l'identique.
//
// La liste des établissements (data.institutions) se construit avec les élèves : ils choisissent dans
// les suggestions ou ajoutent leur école. Les variantes simples d'un même nom sont regroupées
// automatiquement ; l'administration renomme, valide ou fusionne les doublons.
const crypto = require('crypto');
const express = require('express');
const C = require('./donnees-classes-et-discussions');
const { httpError } = require('./connexion-inscription-sms');
const { data, save } = C;

(function migrate() {
  if (!data.institutions || typeof data.institutions !== 'object') { data.institutions = {}; save(); }
})();

// « ETIC de Korhogo », « E.T.I.C Korhogo », « etic korhogo » → « etic korhogo ».
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'a', 'au', 'aux', 'en']);
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.'’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(w => w && !STOP.has(w)).join(' ');
}
const clip = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const keysOf = (inst) => [inst.key, ...(inst.aliases || [])];
function byKey(k) { return Object.values(data.institutions).find(i => keysOf(i).includes(k)); }
const studentsOf = (instId) => Object.values(data.users).filter(u => !u.deleted && u.institutionId === instId);

// Établissement inscrit sur Scola (espace Établissements) : relié à sa fiche.
function fromPartner(sch) {
  let inst = Object.values(data.institutions).find(i => i.schoolId === sch.id) || byKey(norm(sch.name));
  if (!inst) {
    inst = { id: C.uid('in_'), name: clip(sch.name, 100), city: clip(sch.city, 60), key: norm(sch.name), aliases: [], schoolId: sch.id, status: 'validated', createdAt: C.now(), createdBy: 'scola' };
    data.institutions[inst.id] = inst;
  } else if (!inst.schoolId) inst.schoolId = sch.id;
  return inst;
}

// Choix fait par l'élève : un établissement de la liste, une école Scola, ou un nouveau nom.
function resolve(b = {}, { by = 'student' } = {}) {
  if (b.institutionId) {
    const inst = data.institutions[b.institutionId];
    if (!inst) throw httpError(400, 'Établissement introuvable : choisis-le à nouveau dans la liste.');
    return inst;
  }
  if (b.schoolId) {
    const sch = data.schools?.[b.schoolId];
    if (!sch || sch.status !== 'active') throw httpError(400, 'Établissement introuvable : choisis-le à nouveau dans la liste.');
    const inst = fromPartner(sch);
    save();
    return inst;
  }
  const name = clip(b.name, 100);
  const key = norm(name);
  if (name.length < 3 || key.length < 2) throw httpError(400, 'Indique le nom de ton établissement (3 caractères minimum).');
  let inst = byKey(key);
  if (!inst) {
    inst = { id: C.uid('in_'), name, city: '', key, aliases: [], status: 'new', createdAt: C.now(), createdBy: by };
    data.institutions[inst.id] = inst;
    save();
  }
  return inst;
}

// Suggestions pendant la saisie : établissements déjà choisis par des élèves, puis écoles Scola.
function suggest(q, limit = 8) {
  const k = norm(q);
  const counts = {};
  for (const u of Object.values(data.users)) if (!u.deleted && u.institutionId) counts[u.institutionId] = (counts[u.institutionId] || 0) + 1;
  const match = (key) => !k || key.split(' ').some(w => w.startsWith(k.split(' ')[0])) && k.split(' ').every(w => key.includes(w));
  const out = Object.values(data.institutions).filter(i => keysOf(i).some(match))
    .map(i => ({ institutionId: i.id, name: i.name, city: i.city || '', students: counts[i.id] || 0, partner: !!i.schoolId }));
  for (const s of Object.values(data.schools || {})) {
    if (s.status !== 'active' || out.some(o => o.partner && data.institutions[o.institutionId]?.schoolId === s.id)) continue;
    if (Object.values(data.institutions).some(i => i.schoolId === s.id)) continue;
    if (match(norm(s.name))) out.push({ schoolId: s.id, name: s.name, city: s.city || '', students: 0, partner: true });
  }
  return out.sort((a, b) => b.partner - a.partner || b.students - a.students || a.name.localeCompare(b.name, 'fr')).slice(0, limit);
}

/* ---------------- Groupe de la classe dans l'établissement ---------------- */
const groupName = (national, inst) => `${national.name} · ${inst.name}`;
function ensureSchoolClass(national, inst) {
  const key = national.key + '|' + inst.id;
  let id = data.classKeys[key];
  if (id && data.classes[id]) return data.classes[id];
  id = C.uid('c_');
  data.classKeys[key] = id;
  data.classes[id] = {
    id, key, kind: 'school', nationalId: national.id, institutionId: inst.id,
    country: national.country, cycle: national.cycle, cycleLabel: national.cycleLabel, filiere: national.filiere, niveau: national.niveau,
    name: groupName(national, inst),
    description: `Groupe des élèves et étudiants « ${national.filiere} · ${national.niveau} » de ${inst.name}. Cours, devoirs, informations de l'établissement : entraidez-vous !`,
    icon: null, createdAt: C.now(), memberIds: [], restricted: [],
    settings: C.defaultClassSettings(), inviteCode: crypto.randomBytes(6).toString('base64url'),
  };
  data.chats[id] = { id, type: 'group', createdAt: C.now(), disappearing: 0, pinnedMsgs: [] };
  data.messages[id] = [];
  return data.classes[id];
}
const schoolClassOf = (u) => (u?.schoolClassId ? data.classes[u.schoolClassId] : null);

function leave(u, note) {
  const old = schoolClassOf(u);
  if (!old) return;
  old.memberIds = old.memberIds.filter(x => x !== u.id);
  old.restricted = old.restricted.filter(x => x !== u.id);
  if (note) C.systemMessage(old.id, note);
  C.pushChat(data.chats[old.id], old.memberIds);
}
// Place l'élève dans le groupe « sa classe nationale × son établissement ».
function join(u, inst, { note } = {}) {
  const national = C.classOf(u);
  if (!national || !inst) return null;
  const cls = ensureSchoolClass(national, inst);
  u.institutionId = inst.id;
  u.school = inst.name;
  if (u.schoolClassId !== cls.id) {
    leave(u, note);
    u.schoolClassId = cls.id;
    if (!cls.memberIds.includes(u.id)) cls.memberIds.push(u.id);
    C.systemMessage(cls.id, `${u.name} a rejoint le groupe`, { meta: { joined: u.id } });
  }
  save();
  C.pushChat(data.chats[cls.id], cls.memberIds);
  return cls;
}

/* ---------------- Administration ---------------- */
function adminList(q) {
  const k = norm(q);
  return Object.values(data.institutions).filter(i => !k || keysOf(i).some(x => x.includes(k)))
    .map(i => {
      const groups = Object.values(data.classes).filter(c => c.kind === 'school' && c.institutionId === i.id);
      return { id: i.id, name: i.name, city: i.city || '', status: i.status, partner: !!i.schoolId, createdAt: i.createdAt, students: studentsOf(i.id).length, groups: groups.length, aliases: i.aliases || [] };
    })
    .sort((a, b) => (b.status === 'new') - (a.status === 'new') || b.students - a.students || a.name.localeCompare(b.name, 'fr'));
}
function getInst(id) {
  const i = data.institutions[id];
  if (!i) throw httpError(404, 'Établissement introuvable.');
  return i;
}
function rename(id, b) {
  const i = getInst(id);
  const name = clip(b.name, 100);
  if (name.length < 3) throw httpError(400, 'Nom trop court.');
  const key = norm(name);
  const other = byKey(key);
  if (other && other.id !== i.id) throw httpError(400, `« ${other.name} » existe déjà : utilisez plutôt « Fusionner ».`);
  if (key !== i.key) { i.aliases = [...new Set([...(i.aliases || []), i.key])].filter(x => x !== key); i.key = key; }
  if (b.city !== undefined) i.city = clip(b.city, 60);
  const oldName = i.name;
  i.name = name;
  i.status = 'validated';
  for (const u of studentsOf(i.id)) u.school = name;
  for (const c of Object.values(data.classes)) {
    if (c.kind !== 'school' || c.institutionId !== i.id) continue;
    const nat = data.classes[c.nationalId];
    if (nat && c.name === `${nat.name} · ${oldName}`) c.name = groupName(nat, i);
  }
  save();
  return i;
}
function validate(id) { const i = getInst(id); i.status = 'validated'; save(); return i; }
// Fusion d'un doublon : ses élèves et ses groupes passent dans l'établissement gardé.
function merge(fromId, intoId) {
  if (fromId === intoId) throw httpError(400, 'Choisissez deux établissements différents.');
  const from = getInst(fromId), into = getInst(intoId);
  let moved = 0, groupsKept = 0, groupsMerged = 0;
  for (const c of Object.values(data.classes)) {
    if (c.kind !== 'school' || c.institutionId !== from.id) continue;
    const nat = data.classes[c.nationalId];
    const targetKey = (nat?.key || '') + '|' + into.id;
    const targetId = data.classKeys[targetKey];
    if (!targetId || !data.classes[targetId]) {
      // Pas encore de groupe pour cette classe dans l'établissement gardé : on garde celui-ci (et ses messages).
      delete data.classKeys[c.key];
      c.key = targetKey; c.institutionId = into.id;
      if (nat && c.name === `${nat.name} · ${from.name}`) c.name = groupName(nat, into);
      data.classKeys[targetKey] = c.id;
      groupsKept++;
    } else {
      // Les deux groupes existent : les membres rejoignent celui de l'établissement gardé.
      const t = data.classes[targetId];
      for (const uid of c.memberIds) { if (!t.memberIds.includes(uid)) t.memberIds.push(uid); if (data.users[uid]) data.users[uid].schoolClassId = t.id; }
      C.systemMessage(t.id, `Les élèves du groupe « ${c.name} » ont rejoint ce groupe`);
      c.memberIds = [];
      C.systemMessage(c.id, `Ce groupe a été fusionné avec « ${t.name} ». Retrouvez vos camarades là-bas.`);
      groupsMerged++;
    }
  }
  for (const u of studentsOf(from.id)) { u.institutionId = into.id; u.school = into.name; moved++; }
  into.aliases = [...new Set([...(into.aliases || []), ...keysOf(from)])].filter(x => x !== into.key);
  if (!into.schoolId && from.schoolId) into.schoolId = from.schoolId;
  into.status = 'validated';
  delete data.institutions[from.id];
  save();
  return { moved, groupsKept, groupsMerged };
}

/* ---------------- API ---------------- */
const router = express.Router();
// Suggestions : utilisées pendant l'inscription (avant d'avoir un compte) et par l'administration.
router.get('/institutions/suggest', (req, res) => res.json(suggest(String(req.query.q || '').slice(0, 80))));

module.exports = { router, norm, resolve, suggest, join, leave, schoolClassOf, ensureSchoolClass, adminList, rename, validate, merge, getInst, groupName };
