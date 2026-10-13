// Administration › Filières et niveaux : listes proposées à l'inscription (pays, cycles,
// filières/séries, niveaux). Ajouter, renommer, réordonner, retirer. Un renommage met aussi
// à jour les classes existantes ; un retrait ne supprime aucune classe.
import { $, esc, icon } from '/js/util.js';
import { toast, fail, confirmBox, promptBox } from '/js/ui.js';

let X; // { get, post, setTitle, resetCatalog }
export function setup(ctx) { X = ctx; }

let V = null;          // vue renvoyée par le serveur
let openCycle = null;  // cycle déplié
const n = (x, s, p = s + 's') => `${x} ${x > 1 ? p : s}`;
const useOf = (k) => V.use[k] || { classes: 0, members: 0 };
const useTxt = (u) => (u.classes ? `${n(u.classes, 'classe')} · ${n(u.members, 'élève')}` : 'aucune classe');

async function op(body, done) {
  try {
    V = await X.post('/catalog/manage', body);
    X.resetCatalog();
    const r = V.result || {};
    if (r.moved) toast(`${n(r.moved, 'classe mise à jour', 'classes mises à jour')}${r.conflicts ? ` · ${r.conflicts} non renommée(s) : une classe porte déjà ce nom` : ''}`);
    else if (done) toast(done);
    return true;
  } catch (e) { fail(e); return false; }
}

export async function cataloguePage(c) {
  X.setTitle('Filières et niveaux');
  try { V = await X.get('/catalog/manage'); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const draw = () => {
    const dom = (f) => `<select class="cat-dom" data-dom="${esc(f)}" title="Domaine (ciblage des campagnes, statistiques)">${Object.entries(V.domains).map(([k, l]) => `<option value="${k}" ${V.domainOf[f] === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}<option value="" ${V.domainOf[f] ? '' : 'selected'}>Domaine ?</option></select>`;
    const item = (cy, list, v, i, len) => {
      const u = useOf(`${list}|${cy.id}|${v}`);
      return `<li class="cat-item" data-cy="${esc(cy.id)}" data-list="${list}" data-v="${esc(v)}">
        <span class="grow"><b>${esc(v)}</b><small class="faint">${useTxt(u)}</small></span>
        ${list === 'filieres' ? dom(v) : ''}
        <button class="icon-btn sm" data-a="up" ${i === 0 ? 'disabled' : ''} title="Monter">${icon('chevD', 'sm')}</button>
        <button class="icon-btn sm" data-a="down" ${i === len - 1 ? 'disabled' : ''} title="Descendre">${icon('chevD', 'sm')}</button>
        <button class="icon-btn sm" data-a="rename" title="Renommer">${icon('edit', 'sm')}</button>
        <button class="icon-btn sm danger" data-a="remove" title="Retirer de la liste">${icon('trash', 'sm')}</button></li>`;
    };
    const listBlock = (cy, list, label, ph) => `<div class="cat-col"><h3>${label} <span class="faint">(${cy[list].length})</span></h3>
      <ul class="cat-list">${cy[list].map((v, i) => item(cy, list, v, i, cy[list].length)).join('') || '<li class="faint" style="padding:8px 0">Liste vide.</li>'}</ul>
      <form class="cat-add" data-add="${list}" data-cy="${esc(cy.id)}"><input class="input" maxlength="80" placeholder="${ph}">${list === 'filieres' ? `<select class="input" style="max-width:190px"><option value="">Domaine (auto)</option>${Object.entries(V.domains).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>` : ''}<button class="btn">${icon('plus', 'sm')} Ajouter</button></form></div>`;

    c.innerHTML = `<p class="muted" style="margin-top:0">Ces listes sont proposées aux élèves à l'inscription et dans « Changer de classe ». Un élève dont la filière n'existe pas peut choisir « Autre filière… » et la saisir : elle apparaît alors ci-dessous pour que vous l'ajoutiez. <b>Renommer</b> corrige aussi le nom des classes existantes. <b>Retirer</b> ne supprime aucune classe ni aucun élève : la valeur n'est simplement plus proposée.</p>
      ${V.unlisted.length ? `<section class="panel"><h2>${icon('flag', 'sm')} Filières saisies par les élèves (${V.unlisted.length})</h2>
        <div class="pad" style="padding-top:0"><p class="hint" style="margin-top:0">Absentes des listes. Ajoutez-les pour que les prochains élèves les trouvent directement, ou renommez la classe si l'orthographe est mauvaise (page Classes).</p>
        ${V.unlisted.map(x => `<div class="cat-item" data-unl data-cy="${esc(x.cycle)}" data-v="${esc(x.filiere)}"><span class="grow"><b>${esc(x.filiere)}</b><small class="faint">${esc(x.cycleLabel)} · ${useTxt(x)}</small></span><button class="btn ghost" data-a="adopt">${icon('plus', 'sm')} Ajouter à la liste</button></div>`).join('')}</div></section>` : ''}
      <section class="panel"><h2>Pays (${V.countries.length})</h2><div class="pad" style="padding-top:0">
        <div class="cat-chips">${V.countries.map(p => `<span class="cat-chip" title="${useTxt(useOf('country|' + p))}">${esc(p)} <button class="icon-btn sm" data-country="${esc(p)}" aria-label="Retirer">${icon('x', 'xs')}</button></span>`).join('')}</div>
        <form class="cat-add" data-add-country><input class="input" maxlength="60" placeholder="Ajouter un pays"><button class="btn">${icon('plus', 'sm')} Ajouter</button></form></div></section>
      <section class="panel"><h2>Cycles, filières / séries et niveaux</h2>
        ${V.cycles.map((cy, i) => `<div class="cat-cycle ${openCycle === cy.id ? 'open' : ''}" data-cycle="${esc(cy.id)}">
          <div class="cat-cycle-head" data-toggle><span class="grow"><b>${esc(cy.label)}</b><small class="faint">${n(cy.filieres.length, 'filière')} · ${n(cy.niveaux.length, 'niveau')} · ${useTxt(useOf('cycle|' + cy.id))}</small></span>
            <button class="icon-btn sm" data-ca="up" ${i === 0 ? 'disabled' : ''} title="Monter">${icon('chevD', 'sm')}</button>
            <button class="icon-btn sm" data-ca="down" ${i === V.cycles.length - 1 ? 'disabled' : ''} title="Descendre">${icon('chevD', 'sm')}</button>
            <button class="icon-btn sm" data-ca="rename" title="Renommer le cycle">${icon('edit', 'sm')}</button>
            <button class="icon-btn sm danger" data-ca="remove" title="Retirer le cycle">${icon('trash', 'sm')}</button>
            <span class="cat-caret">${icon('chevD', 'sm')}</span></div>
          ${openCycle === cy.id ? `<div class="cat-body">${listBlock(cy, 'filieres', 'Filières / séries', 'Nouvelle filière ou série (ex. « BTS SEP » ou « Série H »)')}${listBlock(cy, 'niveaux', 'Niveaux', 'Nouveau niveau (ex. « 3ème année »)')}</div>` : ''}
        </div>`).join('')}
        <div class="pad"><form class="cat-add" data-add-cycle><input class="input" maxlength="50" placeholder="Nouveau cycle (ex. « Formation professionnelle »)"><button class="btn">${icon('plus', 'sm')} Ajouter un cycle</button></form></div></section>
      ${V.custom ? `<p class="hint">Listes modifiées${V.updatedAt ? ' le ' + esc(new Date(V.updatedAt).toLocaleString('fr-FR')) : ''}. <button class="btn text danger" data-reset>Rétablir les listes d'origine</button></p>` : ''}`;
  };
  draw();

  c.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const input = f.querySelector('input');
    const value = input.value.trim();
    if (!value) return input.focus();
    let ok;
    if (f.matches('[data-add-country]')) ok = await op({ op: 'addCountry', value }, 'Pays ajouté');
    else if (f.matches('[data-add-cycle]')) { ok = await op({ op: 'addCycle', value }, 'Cycle ajouté : ajoutez maintenant ses filières et niveaux'); if (ok) openCycle = V.result?.id; }
    else ok = await op({ op: 'addItem', cycle: f.dataset.cy, list: f.dataset.add, value, domain: f.querySelector('select')?.value || '' }, 'Ajouté');
    if (ok) { draw(); $(`form[data-add="${f.dataset.add}"][data-cy="${f.dataset.cy}"] input`, c)?.focus(); }
  };
  c.onchange = async (e) => {
    const s = e.target.closest('[data-dom]');
    if (s && await op({ op: 'setDomain', value: s.dataset.dom, domain: s.value }, 'Domaine enregistré')) draw();
  };
  c.onclick = async (e) => {
    const t = e.target;
    if (t.closest('[data-reset]')) {
      const password = await window.__askPassword('Rétablir les listes d’origine ?', 'Toutes vos modifications des pays, cycles, filières et niveaux seront annulées. Les classes existantes ne changent pas.');
      if (password === null) return;
      if (await op({ op: 'reset', password }, 'Listes d’origine rétablies')) draw();
      return;
    }
    const country = t.closest('[data-country]')?.dataset.country;
    if (country) {
      const u = useOf('country|' + country);
      if (!(await confirmBox(`Retirer « ${country} » ?`, `Il ne sera plus proposé à l'inscription.${u.classes ? ` Les ${useTxt(u)} existantes ne changent pas.` : ''}`, { ok: 'Retirer', danger: true }))) return;
      if (await op({ op: 'removeCountry', value: country }, 'Pays retiré')) draw();
      return;
    }
    const unl = t.closest('[data-unl]');
    if (unl && t.closest('[data-a=adopt]')) {
      if (await op({ op: 'addItem', cycle: unl.dataset.cy, list: 'filieres', value: unl.dataset.v }, 'Filière ajoutée à la liste')) draw();
      return;
    }
    const it = t.closest('.cat-item[data-list]');
    const a = t.closest('[data-a]')?.dataset.a;
    if (it && a) {
      const { cy, list, v } = it.dataset;
      const label = list === 'niveaux' ? 'niveau' : 'filière';
      if (a === 'up' || a === 'down') { if (await op({ op: 'moveItem', cycle: cy, list, value: v, dir: a })) draw(); return; }
      if (a === 'rename') {
        const u = useOf(`${list}|${cy}|${v}`);
        const value = await promptBox(`Renommer la ${label}`, { value: v, max: 80, label: 'Nouveau nom', hint: u.classes ? `Les ${useTxt(u)} existantes seront renommées aussi.` : '' });
        if (value === null || value.trim() === v) return;
        if (await op({ op: 'renameItem', cycle: cy, list, from: v, value }, 'Renommé')) draw();
        return;
      }
      if (a === 'remove') {
        const u = useOf(`${list}|${cy}|${v}`);
        if (!(await confirmBox(`Retirer « ${v} » ?`, `Cette ${label} ne sera plus proposée aux nouveaux élèves.${u.classes ? ` Les ${useTxt(u)} existantes restent en place.` : ''}`, { ok: 'Retirer', danger: true }))) return;
        if (await op({ op: 'removeItem', cycle: cy, list, value: v }, 'Retiré de la liste')) draw();
        return;
      }
    }
    const cyEl = t.closest('[data-cycle]');
    const ca = t.closest('[data-ca]')?.dataset.ca;
    if (cyEl && ca) {
      const id = cyEl.dataset.cycle;
      const cy = V.cycles.find(x => x.id === id);
      if (ca === 'up' || ca === 'down') { if (await op({ op: 'moveCycle', cycle: id, dir: ca })) draw(); return; }
      if (ca === 'rename') {
        const value = await promptBox('Renommer le cycle', { value: cy.label, max: 50, label: 'Nom du cycle', hint: 'Le nom des classes de ce cycle sera mis à jour.' });
        if (value === null || value.trim() === cy.label) return;
        if (await op({ op: 'renameCycle', cycle: id, value }, 'Cycle renommé')) draw();
        return;
      }
      if (ca === 'remove') {
        const u = useOf('cycle|' + id);
        if (!(await confirmBox(`Retirer le cycle « ${cy.label} » ?`, `Il ne sera plus proposé à l'inscription, avec ses filières et niveaux.${u.classes ? ` Les ${useTxt(u)} existantes restent en place.` : ''}`, { ok: 'Retirer', danger: true }))) return;
        if (await op({ op: 'removeCycle', cycle: id }, 'Cycle retiré')) draw();
        return;
      }
    }
    if (cyEl && t.closest('[data-toggle]') && !t.closest('button')) {
      openCycle = openCycle === cyEl.dataset.cycle ? null : cyEl.dataset.cycle;
      draw();
    }
  };
}
