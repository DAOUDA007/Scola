// Administration › Nettoyage (propriétaire) : effacer les données de test avant le lancement
// en gardant les comptes choisis, leurs classes et leurs messages.
import { $, esc, icon, listTime } from '/js/outils-communs.js';
import { toast, fail, confirmBox } from '/js/fenetres-et-menus.js';

let X; // { get, post, setTitle, askPassword, refreshBadge }
export function setup(ctx) { X = ctx; }

// Par défaut : tout ce qui relève des essais (pas le journal, qui garde la trace du nettoyage).
const DEFAULT_PARTS = ['billing', 'campaigns', 'stats', 'reports', 'support', 'inbox', 'teamRequests'];

export async function nettoyagePage(c) {
  X.setTitle('Nettoyage des données de test');
  let V;
  try { V = await X.get('/maintenance'); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  c.innerHTML = `<p class="muted" style="margin-top:0">Avant le lancement, effacez ce qui a servi aux essais. <b>Les comptes cochés « Garder » restent intacts</b>, avec leur classe, leurs discussions et leurs messages. L'opération est définitive et demande votre mot de passe.</p>
    <section class="panel"><h2>${icon('trash', 'sm')} À effacer</h2><div class="pad" style="padding-top:0">
      ${V.parts.map(p => `<label class="chk mt-row"><input type="checkbox" data-part="${p.key}" ${DEFAULT_PARTS.includes(p.key) && p.count ? 'checked' : ''} ${p.count ? '' : 'disabled'}> <span class="grow">${esc(p.label)}</span><span class="tag ${p.count ? 'warn' : ''}">${p.count}</span></label>`).join('')}
      <p class="hint">Les formules et tarifs, les listes de filières, les administrateurs et les réglages ne sont jamais touchés.</p></div></section>
    <section class="panel"><h2>${icon('users', 'sm')} Comptes élèves (${V.users.length})</h2>${V.users.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Garder</th><th>Nom</th><th>Téléphone</th><th>Classe</th><th class="num">Messages</th><th>Inscrit</th></tr></thead><tbody>
      ${V.users.map(u => `<tr><td><input type="checkbox" data-keep="${u.id}" checked></td><td><b>${esc(u.name)}</b></td><td>${esc(u.phone)}</td><td>${esc(u.className)}</td><td class="num">${u.messages}</td><td>${esc(listTime(u.createdAt))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun compte.</div>'}
      <p class="hint pad" style="margin:0">Décochez « Garder » pour supprimer un compte de test.</p></section>
    <section class="panel"><h2>${icon('megaphone', 'sm')} Établissements (${V.schools.length})</h2>${V.schools.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Supprimer</th><th>Nom</th><th>Statut</th><th class="num">Abonnés</th><th class="num">Publications</th><th>Créé</th></tr></thead><tbody>
      ${V.schools.map(s => `<tr><td><input type="checkbox" data-school="${s.id}"></td><td><b>${esc(s.name)}</b></td><td>${esc(s.status)}</td><td class="num">${s.followers}</td><td class="num">${s.posts}</td><td>${esc(listTime(s.createdAt))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun établissement.</div>'}
      <p class="hint pad" style="margin:0">Cochez seulement les établissements de test : ils seront supprimés avec leur chaîne, leurs publications et leurs échanges.</p></section>
    <div class="row" style="justify-content:flex-end"><button class="btn danger" data-go>${icon('trash', 'sm')} Effacer les données sélectionnées</button></div>`;

  $('[data-go]', c).onclick = async () => {
    const parts = [...c.querySelectorAll('[data-part]:checked')].map(x => x.dataset.part);
    const keepUserIds = [...c.querySelectorAll('[data-keep]:checked')].map(x => x.dataset.keep);
    const dropUsers = V.users.filter(u => !keepUserIds.includes(u.id));
    const schoolIds = [...c.querySelectorAll('[data-school]:checked')].map(x => x.dataset.school);
    if (!parts.length && !dropUsers.length && !schoolIds.length) return toast('Rien n’est sélectionné.');
    const lines = [
      ...V.parts.filter(p => parts.includes(p.key)).map(p => `• ${p.label} (${p.count})`),
      ...dropUsers.map(u => `• Compte de ${u.name}`),
      ...V.schools.filter(s => schoolIds.includes(s.id)).map(s => `• Établissement « ${s.name} »`),
    ];
    const kept = V.users.filter(u => keepUserIds.includes(u.id)).map(u => u.name);
    if (!(await confirmBox('Effacer définitivement ?', `${lines.join('\n')}\n\nComptes gardés : ${kept.join(', ') || 'aucun'}.`, { ok: 'Continuer', danger: true }))) return;
    const password = await X.askPassword('Confirmez avec votre mot de passe', 'Cette opération ne peut pas être annulée.');
    if (password === null) return;
    try {
      await X.post('/maintenance/purge', { password, parts, keepUserIds, schoolIds });
      toast('Données de test effacées');
      X.refreshBadge();
      location.hash = '#/dashboard';
    } catch (e) { fail(e); }
  };
}
