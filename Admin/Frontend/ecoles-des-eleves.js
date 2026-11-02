// Administration › Écoles des élèves : établissements choisis ou ajoutés par les élèves à l'inscription.
// Chacun donne un « groupe de classe de l'école ». Valider, renommer, fusionner les doublons
// (ex. « ETIC Korhogo » et « Etic de Korhogo ») : élèves et groupes passent dans l'établissement gardé.
import { $, esc, icon, listTime, debounce } from '/js/outils-communs.js';
import { toast, fail, modal, confirmBox } from '/js/fenetres-et-menus.js';
import { institutionPicker } from '/js/choix-etablissement.js';

let X; // { get, post, patch, setTitle }
export function setup(ctx) { X = ctx; }

const n = (x, s, p = s + 's') => `${x} ${x > 1 ? p : s}`;

export async function ecolesPage(c) {
  X.setTitle('Écoles des élèves');
  let q = '';
  c.innerHTML = `<p class="muted" style="margin-top:0">Chaque élève indique son établissement à l'inscription : il rejoint alors, en plus du groupe national de sa classe, <b>le groupe de sa classe dans son école</b>. Les noms ajoutés par les élèves apparaissent ici « à vérifier » : validez-les, corrigez leur nom, ou <b>fusionnez</b> les doublons pour réunir leurs élèves et leurs groupes.</p>
    <div class="toolbar"><input class="input" data-q placeholder="Rechercher un établissement" style="max-width:360px"></div>
    <section class="panel" data-l><div class="empty">Chargement…</div></section>`;
  const load = async () => {
    let list;
    try { list = await X.get('/institutions?q=' + encodeURIComponent(q)); } catch (e) { return fail(e); }
    $('[data-l]', c).innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Établissement</th><th>Statut</th><th class="num">Élèves</th><th class="num">Groupes</th><th>Ajouté</th><th></th></tr></thead><tbody>
      ${list.map(i => `<tr data-id="${esc(i.id)}"><td><b>${esc(i.name)}</b>${i.city ? `<div class="faint" style="font-size:12px">${esc(i.city)}</div>` : ''}${i.aliases.length ? `<div class="faint" style="font-size:12px">Aussi saisi : ${i.aliases.length} variante${i.aliases.length > 1 ? 's' : ''}</div>` : ''}</td>
        <td>${i.status === 'new' ? '<span class="tag warn">À vérifier</span>' : '<span class="tag ok">Validé</span>'}${i.partner ? ' <span class="tag">Présent sur Scola</span>' : ''}</td>
        <td class="num">${i.students}</td><td class="num">${i.groups}</td><td>${esc(listTime(i.createdAt))}</td>
        <td class="num">${i.status === 'new' ? '<button class="btn text" data-a="ok">Valider</button>' : ''}<button class="btn text" data-a="rename">Renommer</button><button class="btn text" data-a="merge">Fusionner…</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Aucun établissement pour le moment.</div>';
    c._list = list;
  };
  $('[data-q]', c).oninput = debounce((e) => { q = e.target.value; load(); }, 250);
  c.onclick = async (e) => {
    const row = e.target.closest('[data-id]');
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!row || !a) return;
    const i = c._list.find(x => x.id === row.dataset.id);
    try {
      if (a === 'ok') { await X.post(`/institutions/${i.id}/validate`); toast('Établissement validé'); return load(); }
      if (a === 'rename') {
        return modal({
          title: 'Renommer l’établissement',
          body: `<div class="field"><label>Nom officiel</label><input class="input" data-n maxlength="100" value="${esc(i.name)}"></div><div class="field"><label>Ville (facultatif)</label><input class="input" data-c maxlength="60" value="${esc(i.city)}"></div><p class="hint">Le nom des ${n(i.groups, 'groupe')} de cet établissement et la fiche de ses ${n(i.students, 'élève')} sont mis à jour.</p>`,
          buttons: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: '', onClick: async (close, body) => { await X.patch('/institutions/' + i.id, { name: $('[data-n]', body).value, city: $('[data-c]', body).value }); toast('Établissement renommé'); load(); } }],
        });
      }
      if (a === 'merge') {
        let pick;
        const m = modal({
          title: `Fusionner « ${i.name} »`,
          body: `<p style="margin-top:0">Ses ${n(i.students, 'élève')} et ses ${n(i.groups, 'groupe')} rejoignent l'établissement choisi ci-dessous, qui garde son nom. « ${esc(i.name)} » disparaît de la liste ; ce nom reste reconnu pour les prochaines inscriptions.</p>
            <div class="field"><label>Établissement à garder</label><div data-into></div></div>
            <p class="hint">Si les deux établissements ont déjà un groupe pour la même classe, les élèves rejoignent le groupe gardé ; l'autre groupe est vidé et garde son historique.</p>`,
          buttons: [{ label: 'Annuler' }, {
            label: 'Fusionner', cls: 'danger',
            onClick: async () => {
              const into = pick.value()?.institutionId;
              if (!into) throw new Error('Choisissez dans la liste l’établissement à garder.');
              if (into === i.id) throw new Error('Choisissez un autre établissement.');
              if (!(await confirmBox('Confirmer la fusion ?', `« ${i.name} » → « ${pick.label()} ». Action irréversible.`, { ok: 'Fusionner', danger: true }))) return false;
              const r = await X.post(`/institutions/${i.id}/merge`, { into });
              toast(`Fusion faite : ${n(r.moved, 'élève déplacé', 'élèves déplacés')}`);
              load();
            },
          }],
        });
        pick = institutionPicker($('[data-into]', m.body), { search: (s) => X.get('/institutions/suggest?q=' + encodeURIComponent(s)).then(l => l.filter(x => x.institutionId && x.institutionId !== i.id)), placeholder: 'Nom de l’établissement à garder' });
      }
    } catch (er) { fail(er); }
  };
  load();
}
