// Espace établissement : campagnes publicitaires (création, estimation d'audience, soumission,
// résultats). Toute campagne est validée par l'équipe Scola avant diffusion.
import { $, $$, h, esc, icon, avatar, debounce, pickFiles } from '/js/util.js';
import { toast, fail, modal, confirmBox } from '/js/ui.js';
import { compressImage } from '/js/media.js';
import { mountLine, barList, fmt } from '/js/charts.js';
import { locked, fcfa, dateFr } from '/etablissement/offre.js';

let X; // { get, post, patch, del, uploadFile, me }
export function setup(ctx) { X = ctx; }

const ST_CLS = { draft: '', awaiting_payment: 'warn', in_review: 'warn', scheduled: 'ok', active: 'ok', ended: '', rejected: 'red', suspended: 'red' };
const isoDay = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
const fromIso = (v) => { if (!v) return null; const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const DAY = 86400e3;

export async function campagnesPage(c) {
  let r;
  try { r = await X.get('/campaigns'); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const cr = r.credits;
  c.innerHTML = `<div class="toolbar-row"><span class="grow muted" style="font-size:14px">Faites connaître votre établissement aux élèves qui vous intéressent, dans l'onglet Orientation de Scola.</span>
      <button class="btn" data-new>${icon('plus', 'sm')} Nouvelle campagne</button></div>
    ${cr.campaign.total || cr.national.total ? `<div class="et-banner info">${icon('star', 'sm')}<span class="grow">Votre formule inclut ${cr.campaign.total ? `<b>${cr.campaign.left} campagne${cr.campaign.left > 1 ? 's' : ''}</b> sur ${cr.campaign.total}` : ''}${cr.campaign.total && cr.national.total ? ' et ' : ''}${cr.national.total ? `<b>${cr.national.left} campagne${cr.national.left > 1 ? 's' : ''} nationale${cr.national.left > 1 ? 's' : ''}</b> sur ${cr.national.total}` : ''} pour l'année d'abonnement en cours${cr.until ? ` (jusqu'au ${esc(dateFr(cr.until))})` : ''}.</span></div>` : ''}
    <div data-list>${r.campaigns.length ? r.campaigns.map(card).join('') : `<div class="panel"><div class="empty">${icon('megaphone')}<b>Aucune campagne pour le moment</b><br>Rentrée, inscriptions, concours, portes ouvertes : créez votre première campagne.</div></div>`}</div>
    <div class="panel"><h2>Comment ça marche ?</h2><div class="pad" style="font-size:14px;line-height:1.8;color:var(--text-2)">
      1. Vous créez la campagne : texte, image, bouton, dates et élèves visés. Vous voyez une estimation de l'audience.<br>
      2. Vous la soumettez : elle est incluse dans votre formule ou vous la réglez selon les instructions de paiement.<br>
      3. L'équipe Scola vérifie le contenu et le paiement, puis la campagne est diffusée aux dates prévues.<br>
      4. Vous suivez les résultats : affichages, élèves touchés, clics, contacts et coût par contact.<br>
      <span class="hint">Scola fait le ciblage : vous ne recevez jamais le nom ni le numéro des élèves, seulement des chiffres globaux. Un même élève voit votre campagne ${r.frequencyCap} fois par jour au plus.</span></div></div>`;
  $('[data-new]', c).onclick = () => editor(c, r, null);
  c.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const cm = r.campaigns.find(x => x.id === b.closest('[data-cid]').dataset.cid);
    try {
      if (b.dataset.act === 'edit') return editor(c, r, cm);
      if (b.dataset.act === 'submit') return submitFlow(c, r, cm);
      if (b.dataset.act === 'stats') return statsModal(cm, r);
      if (b.dataset.act === 'pay') return payInfo(r, cm);
      if (b.dataset.act === 'delete' && await confirmBox(`Supprimer « ${cm.title} » ?`, '', { ok: 'Supprimer', danger: true })) { await X.del('/campaigns/' + cm.id); toast('Campagne supprimée'); campagnesPage(c); }
    } catch (er) { fail(er); }
  };
}

function card(cm) {
  const s = cm.stats;
  const showStats = ['active', 'ended', 'suspended'].includes(cm.status) || s.impressions;
  return `<div class="panel camp" data-cid="${esc(cm.id)}"><div class="pad">
    <div class="row" style="flex-wrap:wrap;gap:8px"><b class="grow" style="font-size:16px">${esc(cm.title)}</b><span class="tag ${ST_CLS[cm.status]}">${esc(cm.statusLabel)}</span></div>
    <div class="faint" style="font-size:13px;margin-top:4px">${esc(cm.typeName)} · ${cm.start ? `du ${esc(dateFr(cm.start))} au ${esc(dateFr(cm.end - DAY))} (${cm.days} jours)` : 'dates à choisir'} · ${cm.paidBy === 'credit' || cm.paidBy === 'national_credit' ? 'incluse dans votre formule' : fcfa(cm.price)}${cm.provisional && cm.paidBy !== 'credit' ? ' <span class="tag warn" title="Tarif indicatif, susceptible d\'évoluer">prix provisoire</span>' : ''}</div>
    <div style="font-size:13.5px;margin-top:6px">${icon('users', 'xs')} Cible : ${esc(cm.describe)}</div>
    ${cm.status === 'rejected' && cm.rejectReason ? `<div class="notice" style="margin-top:10px;border-color:#f3b4ae">${icon('info', 'xs')} <b>Motif du refus :</b> ${esc(cm.rejectReason)}<br><span class="hint">Modifiez la campagne puis soumettez-la à nouveau.</span></div>` : ''}
    ${cm.status === 'suspended' && cm.suspendReason ? `<div class="notice" style="margin-top:10px">${icon('info', 'xs')} Suspendue par l'équipe Scola : ${esc(cm.suspendReason)}</div>` : ''}
    ${cm.status === 'awaiting_payment' ? `<div class="notice" style="margin-top:10px">${icon('clock', 'xs')} En attente de votre paiement de <b>${fcfa(cm.price)}</b>. Dès réception, l'équipe Scola valide la campagne.</div>` : ''}
    ${showStats ? `<div class="camp-stats">
      <div><b>${fmt(s.impressions)}</b><small>affichages</small></div><div><b>${fmt(s.reach)}</b><small>élèves touchés</small></div>
      <div><b>${fmt(s.clicks)}</b><small>clics${s.ctr !== null ? ` (${String(s.ctr).replace('.', ',')} %)` : ''}</small></div>
      <div><b>${fmt(s.contacts)}</b><small>contacts</small></div>
      <div><b>${s.costPerContact !== null ? fcfa(s.costPerContact) : '—'}</b><small>coût par contact</small></div></div>` : ''}
    <div class="actions" style="margin-top:10px">
      ${['draft', 'rejected', 'awaiting_payment'].includes(cm.status) ? `<button class="btn ghost" data-act="edit">${icon('edit', 'sm')} Modifier</button>` : ''}
      ${['draft', 'rejected'].includes(cm.status) ? `<button class="btn" data-act="submit">${icon('send', 'sm')} Soumettre</button>` : ''}
      ${cm.status === 'awaiting_payment' ? `<button class="btn" data-act="pay">Comment payer ?</button>` : ''}
      ${showStats ? `<button class="btn ghost" data-act="stats">${icon('poll', 'sm')} Résultats détaillés</button>` : ''}
      ${['draft', 'rejected'].includes(cm.status) ? `<button class="btn text danger" data-act="delete">Supprimer</button>` : ''}</div></div></div>`;
}

function payInfo(r, cm) {
  modal({ title: 'Payer la campagne', body: `<p style="margin-top:0">Montant : <b>${fcfa(cm.price)}</b>${cm.provisional ? ' (tarif provisoire)' : ''}.</p><div class="notice" style="white-space:pre-wrap">${esc(r.paymentInstructions)}</div><p class="hint">Indiquez « ${esc(cm.title)} » en référence. Le paiement en ligne n'est pas encore disponible.</p>`, buttons: [{ label: 'Compris', cls: '' }] });
}

async function submitFlow(c, r, cm) {
  const t = r.types.find(x => x.code === cm.type);
  const cr = r.credits;
  const opts = [];
  if (t?.national && cr.national.left) opts.push(['national', `Utiliser une campagne nationale incluse (${cr.national.left} restante${cr.national.left > 1 ? 's' : ''})`]);
  if (cr.campaign.left) opts.push(['campaign', `Utiliser une campagne incluse dans ma formule (${cr.campaign.left} restante${cr.campaign.left > 1 ? 's' : ''})`]);
  opts.push(['', `Payer ${fcfa(t?.price ?? cm.price)}${t?.provisional ? ' (tarif provisoire)' : ''}`]);
  const body = h(`<div><p style="margin-top:0">Une fois soumise, la campagne est vérifiée par l'équipe Scola avant diffusion. Vous ne pourrez plus la modifier après validation.</p>
    ${opts.map(([v, l], i) => `<label class="choice"><input type="radio" name="cr" value="${v}" ${i === 0 ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`);
  modal({ title: `Soumettre « ${cm.title} »`, body, buttons: [{ label: 'Annuler' }, { label: 'Soumettre', cls: '', onClick: async () => {
    const credit = $('input[name=cr]:checked', body).value || undefined;
    const res = await X.post(`/campaigns/${cm.id}/submit`, { credit });
    toast(res.status === 'in_review' ? 'Campagne soumise : l\'équipe Scola la vérifie' : 'Campagne soumise : en attente de votre paiement');
    if (res.status === 'awaiting_payment') payInfo(r, res);
    campagnesPage(c);
  } }] });
}

/* ---------------- Éditeur ---------------- */
function editor(c, r, cm) {
  const al = r.allowed;
  const v = cm ? structuredClone(cm) : { type: r.types[0]?.code, title: '', text: '', media: null, cta: { kind: al.info ? 'info' : 'channel', label: '' }, start: Date.now() + DAY, days: r.types[0]?.minDays, targeting: { country: r.country, cycles: [], levels: [], cities: [], domains: [] }, placements: null };
  const typeOf = () => r.types.find(t => t.code === v.type) || r.types[0];
  const me = X.me();
  c.innerHTML = `<p><a href="#/campagnes" data-back>← Mes campagnes</a></p>
    <div class="camp-edit"><div class="panel"><h2>${cm ? 'Modifier la campagne' : 'Nouvelle campagne'}</h2><form class="pad" data-f>
      <div class="field"><label>Type de campagne</label><div class="type-grid">${r.types.map(t => `<label class="type-opt"><input type="radio" name="type" value="${t.code}" ${t.code === v.type ? 'checked' : ''}>
        <span><b>${esc(t.name)}</b><small>${esc(t.usage)}</small><small>${t.minDays === t.maxDays ? `${t.minDays} jours` : `${t.minDays} à ${t.maxDays} jours`} · ${fcfa(t.price)}${t.provisional ? ' <em>(prix provisoire)</em>' : ''}</small></span></label>`).join('')}</div></div>
      <div class="field"><label>Titre</label><input class="input" name="title" maxlength="80" value="${esc(v.title)}" placeholder="Ex. Concours d'entrée 2026 : inscriptions ouvertes"></div>
      <div class="field"><label>Texte</label><textarea class="input boxed" name="text" rows="3" maxlength="400" placeholder="Ce que les élèves doivent savoir, en quelques phrases.">${esc(v.text)}</textarea></div>
      <div class="field"><label>Image${al.video ? ' ou vidéo' : ''} (facultatif)</label><div class="row" style="flex-wrap:wrap"><button type="button" class="btn ghost" data-media>${icon('image', 'sm')} Choisir</button><span data-media-name class="faint" style="font-size:13px"></span></div>
        <div class="hint">${al.video ? 'La vidéo ne démarre jamais seule avec le son.' : 'La vidéo sponsorisée est incluse dans la formule Premium.'}</div></div>
      <div class="et-grid">
        <div class="field"><label>Bouton d'action</label><select class="input" name="cta">${Object.entries(r.ctas).map(([k, l]) => `<option value="${k}" ${k === v.cta.kind ? 'selected' : ''} ${k === 'info' && !al.info ? 'disabled' : ''}>${esc(l)}${k === 'info' && !al.info ? ' (Starter et plus)' : ''}</option>`).join('')}</select></div>
        <div class="field" data-urlf><label>Adresse du lien</label><input class="input" name="url" maxlength="300" value="${esc(v.cta.url || '')}" placeholder="https://"></div>
        <div class="field"><label>Date de début</label><input class="input" type="date" name="start" value="${isoDay(v.start)}" min="${isoDay(Date.now())}"></div>
        <div class="field"><label>Durée (jours)</label><input class="input" type="number" name="days" value="${v.days}"><div class="hint" data-end></div></div>
      </div>
      <h3 class="h3" style="margin-top:8px">Élèves visés <span class="faint" style="text-transform:none;font-weight:400">(tout est facultatif : sans choix, la campagne s'adresse à tous les élèves du pays)</span></h3>
      <div class="field"><label>Pays</label><select class="input" name="country">${r.catalog.countries.map(x => `<option ${x === v.targeting.country ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="field"><label>Cycles et niveaux</label><div class="lvl-box">${r.catalog.cycles.map(cy => `<details ${v.targeting.cycles.includes(cy.id) || v.targeting.levels.some(l => l.startsWith(cy.id + '|')) ? 'open' : ''}><summary><label><input type="checkbox" data-cycle="${cy.id}" ${v.targeting.cycles.includes(cy.id) ? 'checked' : ''}> ${esc(cy.label)} <small class="faint">(tous niveaux)</small></label></summary>
        <div class="chips">${cy.niveaux.map(n => `<label class="chk-inline"><input type="checkbox" data-level="${esc(cy.id + '|' + n)}" ${v.targeting.levels.includes(cy.id + '|' + n) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div></details>`).join('')}</div></div>
      <div data-loc></div>
      <h3 class="h3">Emplacements</h3><div data-pl class="chips"></div>
      <div class="notice" data-est style="margin-top:14px">Estimation…</div>
      <div class="row" style="margin-top:14px;flex-wrap:wrap"><button class="btn">${icon('check', 'sm')} Enregistrer</button><button type="button" class="btn ghost" data-save-submit>${icon('send', 'sm')} Enregistrer et soumettre</button><a href="#/campagnes" class="btn text">Annuler</a></div>
    </form></div>
    <div class="camp-prev"><div class="h3">Aperçu côté élève</div><div data-prev></div><p class="hint">Chaque publicité porte la mention « Sponsorisé » et un lien « Pourquoi je vois ceci ? ». L'élève peut la masquer ou la signaler.</p></div></div>`;
  const f = $('[data-f]', c);
  const read = () => {
    v.type = f.type.value; v.title = f.title.value; v.text = f.text.value;
    v.cta = { kind: f.cta.value, url: f.url.value };
    v.start = fromIso(f.start.value); v.days = Number(f.days.value);
    v.targeting.country = f.country.value;
    v.targeting.cycles = $$('[data-cycle]', f).filter(x => x.checked).map(x => x.dataset.cycle);
    v.targeting.levels = $$('[data-level]', f).filter(x => x.checked && !v.targeting.cycles.includes(x.dataset.level.split('|')[0])).map(x => x.dataset.level);
    v.targeting.cities = $$('[data-city]', f).filter(x => x.checked).map(x => x.dataset.city);
    v.targeting.domains = $$('[data-domain]', f).filter(x => x.checked).map(x => x.dataset.domain);
    v.placements = $$('[data-place]', f).filter(x => x.checked).map(x => x.dataset.place);
  };
  const drawType = () => {
    const t = typeOf();
    f.days.min = t.minDays; f.days.max = t.maxDays;
    if (v.days < t.minDays || v.days > t.maxDays) v.days = f.days.value = t.minDays;
    f.days.readOnly = t.minDays === t.maxDays;
    const loc = $('[data-loc]', f);
    if (!al.targeting) loc.innerHTML = `<div class="field">${locked('Le ciblage par ville et par domaine de formation est inclus à partir de la formule Pro.')}</div>`;
    else loc.innerHTML = `${t.national ? '<p class="hint">Campagne nationale : elle n\'est pas limitée à des villes.</p>' : `<div class="field"><label>Villes</label><div class="chips">${r.catalog.cities.map(x => `<label class="chk-inline"><input type="checkbox" data-city="${esc(x)}" ${v.targeting.cities.includes(x) ? 'checked' : ''}> ${esc(x)}</label>`).join('')}</div><div class="hint">Les élèves qui n'ont pas indiqué leur ville ne voient que les campagnes sans ville.</div></div>`}
      <div class="field"><label>Domaines de formation</label><div class="chips">${Object.entries(r.catalog.domains).map(([k, l]) => `<label class="chk-inline"><input type="checkbox" data-domain="${k}" ${v.targeting.domains.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>`;
    const pls = v.placements || t.placements.filter(p => p !== 'banner' || al.banner);
    $('[data-pl]', f).innerHTML = t.placements.map(p => `<label class="chk-inline ${p === 'banner' && !al.banner ? 'off' : ''}"><input type="checkbox" data-place="${p}" ${pls.includes(p) && (p !== 'banner' || al.banner) ? 'checked' : ''} ${p === 'banner' && !al.banner ? 'disabled' : ''}> ${esc(r.placements[p])}${p === 'banner' && !al.banner ? ' <small class="faint">(Pro et plus)</small>' : p === 'banner' && al.bigBanner ? ' <small class="faint">(grand format, prioritaire)</small>' : ''}</label>`).join('');
  };
  const drawMisc = () => {
    $('[data-urlf]', f).style.display = f.cta.value === 'link' ? '' : 'none';
    $('[data-media-name]', f).innerHTML = v.media ? `${esc(v.media.name || 'Fichier')} <button type="button" class="btn text danger" data-rm-media style="height:auto;padding:0 6px">Retirer</button>` : '';
    $('[data-end]', f).textContent = v.start && v.days ? `Fin : ${dateFr(v.start + (v.days - 1) * DAY)} inclus` : '';
    const ctaLabel = r.ctas[f.cta.value];
    $('[data-prev]', c).innerHTML = `<div class="ad ad-banner ${al.bigBanner ? 'big' : ''}" style="margin:0"><div class="ad-head">${avatar({ id: me.id, name: me.name, avatar: me.logo }, 30)}<div class="grow" style="min-width:0"><b>${esc(me.name)}</b><div class="ad-label">Sponsorisé · <a>Pourquoi je vois ceci ?</a></div></div>${icon('more', 'sm')}</div>
      ${v.media ? (/^video\//.test(v.media.mime) ? `<div class="ad-media"><video src="${esc(v.media.url)}" controls muted playsinline preload="metadata"></video></div>` : `<div class="ad-media ${al.bigBanner ? 'big' : ''}" style="background-image:url('${esc(v.media.url)}')"></div>`) : ''}
      <div class="ad-body"><b>${esc(v.title || 'Titre de la campagne')}</b>${v.text ? `<p>${esc(v.text)}</p>` : ''}</div><button type="button" class="btn ad-cta">${esc(ctaLabel)}</button></div>`;
  };
  const estimate = debounce(async () => {
    read();
    try {
      const e = await X.post('/campaigns/estimate', { type: v.type, days: v.days, targeting: v.targeting });
      $('[data-est]', f).innerHTML = `${icon('users', 'xs')} <b>Audience estimée : ${esc(e.label)}</b><br><span class="hint">Cible : ${esc(e.describe)}.${e.personal ? ' Les élèves qui ont désactivé les publicités personnalisées ne sont pas comptés.' : ''}</span>`;
    } catch (er) { $('[data-est]', f).innerHTML = `${icon('info', 'xs')} ${esc(er.message)}`; }
  }, 300);
  drawType(); drawMisc(); estimate();
  f.addEventListener('change', (e) => {
    if (e.target.name === 'type') { read(); v.placements = null; drawType(); }
    if (e.target.dataset.cycle) $$(`[data-level^="${e.target.dataset.cycle}|"]`, f).forEach(x => { x.checked = e.target.checked; });
    read(); drawMisc(); estimate();
  });
  f.addEventListener('input', debounce(() => { read(); drawMisc(); }, 120));
  f.addEventListener('click', async (e) => {
    if (e.target.closest('[data-rm-media]')) { v.media = null; drawMisc(); return; }
    if (!e.target.closest('[data-media]')) return;
    const files = await pickFiles({ accept: al.video ? 'image/*,video/*' : 'image/*' });
    if (!files) return;
    let file = files[0];
    try {
      if (file.type.startsWith('image/')) file = await compressImage(file, 1600);
      toast('Envoi du fichier…');
      const up = await X.uploadFile(file);
      v.media = { url: up.url, mime: up.mime, name: up.name, size: up.size };
      drawMisc();
    } catch (er) { fail(er); }
  });
  const save = async () => {
    read();
    const body = { type: v.type, title: v.title, text: v.text, media: v.media, cta: v.cta, start: v.start, days: v.days, targeting: v.targeting, placements: v.placements };
    return cm ? X.patch('/campaigns/' + cm.id, body) : X.post('/campaigns', body);
  };
  f.onsubmit = async (e) => { e.preventDefault(); try { await save(); toast('Campagne enregistrée'); campagnesPage(c); } catch (er) { fail(er); } };
  $('[data-save-submit]', f).onclick = async () => {
    try { const saved = await save(); const fresh = await X.get('/campaigns'); await campagnesPage(c); submitFlow(c, fresh, fresh.campaigns.find(x => x.id === saved.id)); } catch (er) { fail(er); }
  };
}

/* ---------------- Résultats détaillés ---------------- */
function statsModal(cm, r) {
  const rep = cm.report, s = cm.stats;
  const body = h(`<div>
    <p style="margin-top:0;font-size:15px;line-height:1.6">Votre campagne a été affichée <b>${fmt(s.impressions)}</b> fois à <b>${fmt(s.reach)}</b> élèves${s.reach ? ' (comptés une fois par jour)' : ''}. <b>${fmt(s.clicks)}</b> ont cliqué et <b>${fmt(s.contacts)}</b> vous ont demandé des informations.${s.costPerContact !== null ? ` Coût par contact : <b>${fcfa(s.costPerContact)}</b>${cm.paidBy !== 'payment' ? ' (valeur de la campagne incluse)' : ''}.` : ''}</p>
    <div data-chart></div>
    <div class="grid3" style="margin-top:14px">${[['city', 'Par ville'], ['level', 'Par niveau'], ['domain', 'Par domaine']].map(([k, l]) => `<div><h3 class="h3">${l}</h3>${barList(rep.dims[k], { threshold: r.threshold })}</div>`).join('')}</div>
    <p class="hint">Élèves touchés, par catégorie. Les catégories de moins de ${r.threshold} élèves sont regroupées ou masquées.${s.hides ? ` ${fmt(s.hides)} élève(s) ont masqué la publicité.` : ''}</p></div>`);
  modal({ title: `Résultats — ${cm.title}`, body, wide: true });
  const days = rep.days.length ? rep.days : [{ d: isoDay(Date.now()), i: 0 }];
  setTimeout(() => mountLine($('[data-chart]', body), { points: days.map(d => ({ label: new Date(d.d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), short: new Date(d.d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: d.i })), name: 'Affichages', ariaLabel: 'Affichages par jour', height: 180 }), 30);
}
