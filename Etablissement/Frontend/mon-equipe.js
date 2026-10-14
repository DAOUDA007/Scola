// Espace établissement › Mon équipe (responsable principal) : ajouter des membres avec leur poste et
// leurs droits, leur générer un mot de passe, les retirer, transmettre le rôle de responsable principal.
// Chaque membre se connecte avec l'e-mail de l'établissement et SON mot de passe (généré par Scola).
import { $, esc, icon, listTime, fullDate, copyText } from '/js/outils-communs.js';
import { toast, fail, modal, confirmBox } from '/js/fenetres-et-menus.js';

let X; // { get, post, patch, del, me, logout }
export function setup(ctx) { X = ctx; }

const DEFAULT_RIGHTS = ['posts', 'inquiries'];
const rightsTags = (V, r) => Object.entries(V.rights).filter(([k]) => r[k]).map(([, l]) => `<span class="tag">${esc(l)}</span>`).join(' ') || '<span class="faint">Aucun droit</span>';

// Formulaire d'un membre (ajout ou modification).
function memberForm(V, m, done) {
  const r = m ? m.rights : Object.fromEntries(DEFAULT_RIGHTS.map(k => [k, true]));
  modal({
    title: m ? `Modifier ${m.name}` : 'Ajouter un membre',
    body: `<div class="field"><label>Nom et prénom</label><input class="input" data-n maxlength="60" value="${esc(m?.name || '')}" placeholder="Ex. Marie Kouassi"></div>
      <div class="field"><label>Poste dans l'établissement</label><input class="input" data-r maxlength="60" value="${esc(m?.role || '')}" placeholder="Ex. Service communication, Scolarité, Direction…"></div>
      <div class="field"><label>Ce que cette personne peut faire</label><div class="team-rights">${Object.entries(V.rights).map(([k, l]) => `<label class="chk"><input type="checkbox" data-right="${k}" ${r[k] ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
        <p class="hint">La gestion de l'équipe reste réservée au responsable principal.${m ? '' : ' Un mot de passe sera généré par Scola : vous le transmettrez à la personne.'}</p></div>`,
    buttons: [{ label: 'Annuler', cls: 'text' }, {
      label: m ? 'Enregistrer' : 'Ajouter et générer le mot de passe', cls: '',
      onClick: async (close, body) => {
        const payload = { name: $('[data-n]', body).value, role: $('[data-r]', body).value, rights: Object.fromEntries([...body.querySelectorAll('[data-right]')].map(x => [x.dataset.right, x.checked])) };
        if (m) { await X.patch('/team/' + m.id, payload); toast('Membre modifié'); done(); return; }
        const r2 = await X.post('/team', payload);
        close();
        showPassword(r2, true);
        done();
        return false;
      },
    }],
  });
}

// Le mot de passe n'est affiché qu'une fois : le responsable le transmet à la personne.
function showPassword({ member, password }, isNew) {
  const email = X.me().email;
  modal({
    title: isNew ? 'Membre ajouté' : 'Nouveau mot de passe',
    body: `<p style="margin-top:0"><b>${esc(member.name)}</b> (${esc(member.role)}) se connecte sur <b>Scola Établissements</b> avec :</p>
      <div class="kv-box"><div><small>E-mail de l'établissement</small><b>${esc(email)}</b></div><div><small>Mot de passe personnel</small><b class="pw-big" data-pw>${esc(password)}</b></div></div>
      <p class="hint">Transmettez-le en main propre, par téléphone ou par message privé. <b>Il ne sera plus affiché.</b> En cas d'oubli, générez-en un nouveau depuis cette page.</p>`,
    buttons: [
      { label: 'Copier', cls: 'text', onClick: () => { copyText(`Scola Établissements\nE-mail : ${email}\nMot de passe : ${password}\nConnexion : ${location.origin}/etablissement/`); toast('Copié'); return false; } },
      { label: 'Terminé', cls: '' },
    ],
  });
}

export async function equipePage(c) {
  let V;
  try { V = await X.get('/team'); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const draw = () => {
    c.innerHTML = `<p class="muted" style="margin-top:0">Plusieurs personnes de votre établissement peuvent gérer cet espace. Chacune se connecte avec <b>l'e-mail de l'établissement</b> et <b>son propre mot de passe</b>, généré par Scola, et ne voit que les rubriques que vous lui autorisez.</p>
      <div class="panel"><h2>${icon('shieldCheck', 'sm')} Responsable principal</h2><div class="pad team-owner">
        <div class="grow"><b>${esc(V.owner.name)}</b> <span class="tag founder">Responsable principal</span><div class="faint">${esc(V.owner.role)} · tous les droits · gère l'équipe</div></div>
        <button class="btn ghost" data-edit-owner>${icon('edit', 'sm')} Mon nom et mon poste</button></div></div>
      <div class="panel"><h2><span class="grow">Membres de l'équipe (${V.members.length}/${V.max})</span><button class="btn" data-add ${V.members.length >= V.max ? 'disabled' : ''}>${icon('userPlus', 'sm')} Ajouter un membre</button></h2>
        ${V.members.length ? V.members.map(m => `<div class="team-row" data-id="${esc(m.id)}">
          <div class="grow"><b>${esc(m.name)}</b> <span class="faint">· ${esc(m.role)}</span>
            <div class="team-tags">${rightsTags(V, m.rights)}</div>
            <small class="faint">Ajouté ${esc(listTime(m.createdAt))}${m.createdBy ? ' par ' + esc(m.createdBy) : ''} · ${m.lastLogin ? 'dernière connexion ' + esc(listTime(m.lastLogin)) : 'jamais connecté'}</small></div>
          <div class="team-actions"><button class="btn text" data-a="edit">Modifier</button><button class="btn text" data-a="pw">Nouveau mot de passe</button><button class="btn text" data-a="owner">Transmettre mon rôle</button><button class="btn text danger" data-a="del">Retirer</button></div></div>`).join('')
          : `<div class="empty">${icon('users')}Personne d'autre pour le moment.<br><small class="faint">Ajoutez par exemple votre service communication ou votre scolarité.</small></div>`}</div>
      <div class="panel"><h2>Journal de l'équipe</h2>${V.log.length ? `<div class="team-log">${V.log.slice(0, 60).map(l => `<div><span class="faint">${esc(fullDate(l.at))}</span> — <b>${esc(l.by)}</b> : ${esc(l.action)}${l.target ? ' · ' + esc(l.target) : ''}</div>`).join('')}</div>` : '<div class="empty">Aucune activité.</div>'}</div>`;
  };
  const reload = async () => { try { V = await X.get('/team'); draw(); } catch (e) { fail(e); } };
  draw();
  c.onclick = async (e) => {
    if (e.target.closest('[data-add]')) return memberForm(V, null, reload);
    if (e.target.closest('[data-edit-owner]')) {
      return modal({
        title: 'Mon nom et mon poste',
        body: `<div class="field"><label>Nom et prénom</label><input class="input" data-n maxlength="60" value="${esc(V.owner.name)}"></div><div class="field"><label>Poste</label><input class="input" data-r maxlength="60" value="${esc(V.owner.role)}"></div>`,
        buttons: [{ label: 'Annuler', cls: 'text' }, { label: 'Enregistrer', cls: '', onClick: async (close, body) => { V = await X.patch('/team-owner', { name: $('[data-n]', body).value, role: $('[data-r]', body).value }); draw(); toast('Enregistré'); } }],
      });
    }
    const row = e.target.closest('[data-id]');
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!row || !a) return;
    const m = V.members.find(x => x.id === row.dataset.id);
    try {
      if (a === 'edit') return memberForm(V, m, reload);
      if (a === 'pw') {
        if (!(await confirmBox(`Nouveau mot de passe pour ${m.name} ?`, 'Son ancien mot de passe ne marchera plus et ses appareils seront déconnectés.', { ok: 'Générer' }))) return;
        showPassword(await X.post(`/team/${m.id}/password`), false);
        return reload();
      }
      if (a === 'del') {
        if (!(await confirmBox(`Retirer ${m.name} de l'équipe ?`, 'Son mot de passe ne marchera plus et ses appareils seront déconnectés immédiatement. Ses publications et réponses restent en place.', { ok: 'Retirer', danger: true }))) return;
        await X.del('/team/' + m.id); toast('Membre retiré'); return reload();
      }
      if (a === 'owner') {
        modal({
          title: `Transmettre votre rôle à ${m.name} ?`,
          body: `<p style="margin-top:0"><b>${esc(m.name)}</b> deviendra <b>responsable principal</b> : tous les droits, gestion de l'équipe, récupération du mot de passe par SMS au numéro de l'établissement.</p>
            <p>Vous resterez dans l'équipe comme membre, avec tous les droits sauf la gestion de l'équipe, et vous garderez votre mot de passe actuel. Vous serez déconnecté.</p>
            <div class="field"><label>Votre mot de passe, pour confirmer</label><input class="input" type="password" data-pwc autocomplete="current-password"></div>`,
          buttons: [{ label: 'Annuler', cls: 'text' }, {
            label: 'Transmettre', cls: 'danger',
            onClick: async (close, body) => {
              await X.post(`/team/${m.id}/transfer`, { password: $('[data-pwc]', body).value });
              close();
              toast(`${m.name} est maintenant responsable principal. Reconnectez-vous.`);
              setTimeout(() => X.logout(), 1200);
              return false;
            },
          }],
        });
      }
    } catch (er) { fail(er); }
  };
}
