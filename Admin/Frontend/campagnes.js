// Administration : campagnes publicitaires des établissements (file de validation, aperçu,
// paiement, validation, refus motivé, suspension, résultats).
import { $, h, esc, icon, avatar, listTime, fullDate } from '/js/util.js';
import { toast, fail, modal, confirmBox, promptBox } from '/js/ui.js';
import { mountLine, barList, fmt } from '/js/charts.js';
import { fcfa, dateFr } from './monetisation.js';

let X; // { get, post, setTitle, bindRows, refreshBadge }
export function setup(ctx) { X = ctx; }

const DAY = 86400e3;
const CLS = { awaiting_payment: 'warn', in_review: 'warn', scheduled: 'ok', active: 'ok', ended: '', rejected: 'red', suspended: 'red' };
const tag = (c) => `<span class="tag ${CLS[c.status] || ''}">${esc(c.statusLabel)}</span>`;
const paidBy = (c) => (c.paidBy === 'credit' ? 'Incluse dans la formule' : c.paidBy === 'national_credit' ? 'Campagne nationale incluse'
  : fcfa(c.price) + (c.paymentId ? ' · payée' : c.provisional ? ' (tarif provisoire)' : ''));
let filter = 'queue';

export async function campaigns(c) {
  X.setTitle('Campagnes');
  c.innerHTML = '<div class="toolbar"><div class="seg" data-seg></div></div><section class="panel"><div class="tbl-wrap" data-t></div></section>';
  const load = async () => {
    const r = await X.get('/billing/campaigns?status=' + filter).catch(fail);
    if (!r) return;
    const k = r.counts;
    const queue = (k.awaiting_payment || 0) + (k.in_review || 0);
    $('[data-seg]', c).innerHTML = [['queue', 'À traiter', queue], ['active', 'Actives', k.active || 0], ['scheduled', 'Programmées', k.scheduled || 0], ['suspended', 'Suspendues', k.suspended || 0], ['ended', 'Terminées', k.ended || 0], ['rejected', 'Refusées', k.rejected || 0], ['', 'Toutes', Object.values(k).reduce((a, b) => a + b, 0)]]
      .map(([v, l, n]) => `<button class="${v === filter ? 'on' : ''}" data-st="${v}">${l} <span class="faint">${n}</span></button>`).join('');
    $('[data-t]', c).innerHTML = r.campaigns.length ? `<table class="tbl"><thead><tr><th>Campagne</th><th>Établissement</th><th>Période</th><th>Paiement</th><th>Statut</th><th class="num">Affichages</th><th class="num">Contacts</th></tr></thead><tbody>
      ${r.campaigns.map(x => `<tr data-go="#/campaigns/${x.id}"><td><b>${esc(x.title)}</b><div class="faint" style="font-size:12px">${esc(x.typeName)} · ${esc(x.describe)}</div></td><td>${esc(x.schoolName)}</td>
        <td>${x.start ? `${esc(dateFr(x.start))}<div class="faint" style="font-size:12px">${x.days} jours</div>` : '—'}</td><td>${esc(paidBy(x))}</td><td>${tag(x)}</td><td class="num">${fmt(x.stats.impressions)}</td><td class="num">${fmt(x.stats.contacts)}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${icon('flash')}Aucune campagne ${filter === 'queue' ? 'à traiter' : 'dans cette catégorie'}.</div>`;
  };
  $('[data-seg]', c).onclick = (e) => { const b = e.target.closest('[data-st]'); if (b) { filter = b.dataset.st; load(); } };
  X.bindRows(c);
  load();
}

// Aperçu tel que l'élève le verra (mêmes composants que l'application).
function preview(p) {
  if (!p) return '';
  const s = p.school;
  const m = p.media;
  return `<div class="ad ad-banner ${p.big ? 'big' : ''}" style="margin:0;max-width:420px"><div class="ad-head">${avatar({ id: s.id, name: s.name, avatar: s.logo }, 30)}<div class="grow" style="min-width:0"><b>${esc(s.name)}</b>${s.verified ? `<span class="verified">${icon('check', 'xs')}</span>` : ''}<div class="ad-label">Sponsorisé · <a href="#" data-why>Pourquoi je vois ceci ?</a></div></div>${icon('more', 'sm')}</div>
    ${m ? (/^video\//.test(m.mime) ? `<div class="ad-media"><video src="${esc(m.url)}" controls muted playsinline preload="metadata"></video></div>` : `<div class="ad-media ${p.big ? 'big' : ''}" style="background-image:url('${esc(m.url)}')"></div>`) : ''}
    <div class="ad-body"><b>${esc(p.title)}</b>${p.text ? `<p>${esc(p.text)}</p>` : ''}</div><button class="btn ad-cta" type="button">${esc(p.cta.label)}</button></div>`;
}

export async function campaignDetail(c, id) {
  X.setTitle('Campagne');
  let x;
  try { x = await X.get('/billing/campaigns/' + id); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  X.setTitle(x.title);
  const s = x.stats;
  const PL = { sponsored: 'Publication sponsorisée (À la une)', search: 'Priorité dans la recherche', banner: 'Bannière' };
  c.innerHTML = `<p><a href="#/campaigns">← Toutes les campagnes</a> · <a href="#/billing/${x.schoolId}">Abonnement de l'établissement</a></p>
    <div class="grid2">
      <section class="panel"><h2><span class="grow">${esc(x.title)}</span>${tag(x)}</h2><div class="pad"><dl class="kv">
        <dt>Établissement</dt><dd><a href="#/schools/${x.schoolId}">${esc(x.schoolName)}</a> · formule ${esc(x.plan)}</dd>
        <dt>Type</dt><dd>${esc(x.typeName)}</dd>
        <dt>Période</dt><dd>${x.start ? `du ${esc(dateFr(x.start))} au ${esc(dateFr(x.end - DAY))} (${x.days} jours)` : '—'}</dd>
        <dt>Ciblage</dt><dd>${esc(x.describe)}${x.personal ? ' <span class="tag">personnalisé</span>' : ''}</dd>
        <dt>Audience estimée</dt><dd>${esc(x.estimate.label)}</dd>
        <dt>Emplacements</dt><dd>${x.placements.map(p => esc(PL[p] || p)).join(', ')}</dd>
        <dt>Bouton</dt><dd>${esc(x.cta.label)}${x.cta.url ? ` → <a href="${esc(x.cta.url)}" target="_blank" rel="noopener">${esc(x.cta.url)}</a>` : ''}</dd>
        <dt>Paiement</dt><dd>${esc(paidBy(x))}${x.payment ? ` · <a href="#/receipt/${x.payment.id}">reçu ${esc(x.payment.receiptNo)}</a>` : x.status === 'awaiting_payment' ? ' · <b>en attente</b>' : ''}</dd>
        ${x.rejectReason && x.status === 'rejected' ? `<dt>Motif du refus</dt><dd>${esc(x.rejectReason)}</dd>` : ''}
        ${x.suspendReason && x.status === 'suspended' ? `<dt>Motif de suspension</dt><dd>${esc(x.suspendReason)}</dd>` : ''}
      </dl></div>
      <div class="pad actions" style="border-top:1px solid var(--line)">
        ${x.status === 'awaiting_payment' ? `<button class="btn" data-a="pay">${icon('plus', 'sm')} Enregistrer le paiement</button>` : ''}
        ${x.status === 'in_review' ? `<button class="btn" data-a="approve">${icon('check', 'sm')} Valider la campagne</button>` : ''}
        ${['awaiting_payment', 'in_review', 'scheduled'].includes(x.status) ? `<button class="btn danger" data-a="reject">${icon('x', 'sm')} Refuser</button>` : ''}
        ${['scheduled', 'active'].includes(x.status) ? `<button class="btn danger" data-a="suspend">${icon('shield', 'sm')} Suspendre</button>` : ''}
        ${x.status === 'suspended' ? `<button class="btn" data-a="resume">Reprendre la diffusion</button>` : ''}
      </div></section>
      <section class="panel"><h2>Aperçu côté élève</h2><div class="pad">${preview(x.preview)}<p class="hint" style="margin-bottom:0">Vérifiez le texte, l'image et la promesse faite aux élèves avant de valider.</p></div></section>
    </div>
    <section class="panel"><h2>Résultats</h2><div class="pad">
      <div class="cards" style="margin-bottom:12px">
        <div class="stat"><small>Affichages</small><b>${fmt(s.impressions)}</b></div><div class="stat"><small>Élèves touchés</small><b>${fmt(s.reach)}</b></div>
        <div class="stat"><small>Clics</small><b>${fmt(s.clicks)}</b><span class="sub">${s.ctr !== null ? String(s.ctr).replace('.', ',') + ' % de clics' : ''}</span></div>
        <div class="stat"><small>Contacts</small><b>${fmt(s.contacts)}</b><span class="sub">${s.costPerContact !== null ? fcfa(s.costPerContact) + ' par contact' : ''}</span></div>
        <div class="stat"><small>Masquages</small><b>${fmt(s.hides)}</b></div></div>
      <div data-chart></div>
      <div class="grid3" style="margin-top:14px">${[['city', 'Par ville'], ['level', 'Par niveau'], ['domain', 'Par domaine']].map(([k, l]) => `<div><h3 class="h3">${l}</h3>${barList(x.report.dims[k])}</div>`).join('')}</div></div></section>
    <section class="panel"><h2>Historique</h2><div class="pad" style="font-size:13.5px;line-height:1.9">${(x.history || []).map(hh => `${esc(fullDate(hh.at))} — <b>${esc(hh.byName)}</b> : ${esc(hh.from || '')} → ${esc(hh.to)}${hh.note ? ` · ${esc(hh.note)}` : ''}`).join('<br>') || '—'}</div></section>`;
  if (x.report.days.length) mountLine($('[data-chart]', c), { points: x.report.days.map(d => ({ label: new Date(d.d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), short: new Date(d.d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: d.i })), name: 'Affichages', ariaLabel: 'Affichages par jour', height: 180 });
  const reload = () => campaignDetail(c, id);
  c.onclick = async (e) => {
    if (e.target.closest('[data-why]')) { e.preventDefault(); return modal({ title: 'Pourquoi je vois ceci ?', body: `<p style="margin-top:0">${esc(x.preview?.why || '')}</p>`, buttons: [{ label: 'Fermer', cls: '' }] }); }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    try {
      if (a === 'pay') return payForm(x, reload);
      if (a === 'approve') {
        if (!(await confirmBox('Valider cette campagne ?', `Elle sera diffusée du ${dateFr(x.start)} au ${dateFr(x.end - DAY)} auprès de ${x.describe}.`, { ok: 'Valider' }))) return;
        await X.post(`/billing/campaigns/${id}/approve`); toast('Campagne validée');
      }
      if (a === 'reject') {
        const reason = await promptBox('Refuser la campagne', { label: 'Motif (communiqué à l\'établissement)', max: 500, multiline: true, placeholder: 'Ex. image floue, promesse non vérifiable…' });
        if (reason === null) return;
        await X.post(`/billing/campaigns/${id}/reject`, { reason }); toast('Campagne refusée');
      }
      if (a === 'suspend') {
        const reason = await promptBox('Suspendre la diffusion', { label: 'Motif (communiqué à l\'établissement)', max: 500, multiline: true });
        if (reason === null) return;
        await X.post(`/billing/campaigns/${id}/suspend`, { reason }); toast('Campagne suspendue');
      }
      if (a === 'resume') { await X.post(`/billing/campaigns/${id}/resume`); toast('Diffusion reprise'); }
      X.refreshBadge();
      reload();
    } catch (er) { fail(er); }
  };
}

function payForm(x, done) {
  const body = h(`<div class="form2">
    <div class="field"><label>Montant payé (FCFA)</label><input class="input boxed" type="number" min="0" step="100" data-amount value="${x.price}"></div>
    <div class="field"><label>Remise (FCFA)</label><input class="input boxed" type="number" min="0" step="100" data-discount value="0"></div>
    <div class="field"><label>Moyen de paiement</label><select class="input boxed" data-method><option value="">Choisir…</option>${Object.entries(x.methods).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
    <div class="field"><label>Référence</label><input class="input boxed" data-ref maxlength="120"></div></div>
    <div class="field"><label>Note interne</label><input class="input boxed" data-note maxlength="1000"></div>`);
  modal({ title: `Paiement — ${x.title}`, body, buttons: [{ label: 'Annuler' }, { label: 'Enregistrer et générer le reçu', cls: '', onClick: async () => {
    const r = await X.post(`/billing/campaigns/${x.id}/payment`, { amount: Number($('[data-amount]', body).value), discount: Number($('[data-discount]', body).value || 0), method: $('[data-method]', body).value, reference: $('[data-ref]', body).value, note: $('[data-note]', body).value });
    toast(`Paiement enregistré — reçu ${r.payment.receiptNo}. La campagne passe en revue.`);
    done();
  } }] });
}
