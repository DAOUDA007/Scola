// Choix de l'établissement avec suggestions : l'élève tape le nom, Scola propose les établissements
// déjà connus (choisis par d'autres élèves ou inscrits sur Scola) ; sinon il ajoute le sien.
// Utilisé à l'inscription, dans la demande faite aux anciens comptes et dans l'administration.
import { esc, icon, debounce } from './outils-communs.js';

// search(q) → Promise<[{ institutionId? , schoolId?, name, city, students, partner }]>
export function institutionPicker(holder, { search, value = null, placeholder = 'Ex. ETIC Korhogo, Lycée Classique d\'Abidjan…', onChange = () => {} }) {
  let chosen = value; // { institutionId | schoolId | name, label }
  holder.innerHTML = `<div class="inst-pick">
      <input class="input" data-inst-q maxlength="100" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(value?.label || value?.name || '')}">
      <div class="inst-list" data-inst-list hidden></div>
      <div class="inst-chosen" data-inst-chosen></div></div>`;
  const q = holder.querySelector('[data-inst-q]'), list = holder.querySelector('[data-inst-list]'), tag = holder.querySelector('[data-inst-chosen]');
  const drawChosen = () => {
    tag.innerHTML = chosen ? `${icon('check', 'xs')} ${chosen.institutionId || chosen.schoolId ? 'Établissement choisi' : 'Nouvel établissement ajouté à Scola'} : <b>${esc(chosen.label)}</b>` : '';
    tag.className = 'inst-chosen' + (chosen ? ' on' : '');
  };
  const pick = (c) => { chosen = c; q.value = c.label; list.hidden = true; drawChosen(); onChange(chosen); };
  let items = [];
  const run = debounce(async () => {
    const text = q.value.trim();
    if (text.length < 2) { list.hidden = true; return; }
    try { items = await search(text); } catch { items = []; }
    if (q.value.trim() !== text) return;
    const exact = items.some(i => i.name.toLowerCase() === text.toLowerCase());
    list.innerHTML = items.map((i, k) => `<button type="button" class="inst-item" data-k="${k}">${icon(i.partner ? 'shieldCheck' : 'book', 'sm')}<span class="grow"><b>${esc(i.name)}</b><small>${[i.city, i.partner ? 'Établissement présent sur Scola' : '', i.students ? `${i.students} élève${i.students > 1 ? 's' : ''} sur Scola` : ''].filter(Boolean).map(esc).join(' · ')}</small></span></button>`).join('')
      + (exact || text.length < 3 ? '' : `<button type="button" class="inst-item add" data-new>${icon('plus', 'sm')}<span class="grow"><b>Ajouter « ${esc(text)} »</b><small>Mon établissement n'est pas dans la liste</small></span></button>`);
    list.hidden = !list.innerHTML;
  }, 220);
  q.oninput = () => { if (chosen && q.value !== chosen.label) { chosen = null; drawChosen(); onChange(null); } run(); };
  q.onfocus = () => { if (!chosen) run(); };
  list.onmousedown = (e) => e.preventDefault(); // garder le focus pendant le choix
  list.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-new')) return pick({ name: q.value.trim(), label: q.value.trim() });
    const i = items[Number(b.dataset.k)];
    pick({ ...(i.institutionId ? { institutionId: i.institutionId } : { schoolId: i.schoolId }), label: i.name });
  };
  q.onblur = () => setTimeout(() => { list.hidden = true; }, 150);
  drawChosen();
  return {
    // Valeur à envoyer au serveur (sans le libellé), ou null si rien n'est choisi.
    value: () => (chosen ? (({ label, ...rest }) => rest)(chosen) : null),
    label: () => chosen?.label || '',
    focus: () => q.focus(),
  };
}
