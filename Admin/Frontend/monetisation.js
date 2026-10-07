// Administration : abonnements des établissements, paiements et reçus, offres et tarifs.
import { $, $$, h, esc, icon, avatar, listTime, fullDate, debounce } from '/js/util.js';
import { toast, fail, modal, confirmBox, promptBox } from '/js/ui.js';
import { mountLine } from '/js/charts.js';

let X; // contexte fourni par admin.js : { get, post, patch, setTitle, bindRows, refreshBadge }
export function setup(ctx) { X = ctx; }

export const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
export const dateFr = (t) => (t ? new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const fromIso = (v) => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const PST = { active: ['Actif', 'ok'], grace: ['Période de grâce', 'warn'], none: ['Sans abonnement', ''] };
const pstTag = (st) => `<span class="tag ${PST[st]?.[1] || ''}">${PST[st]?.[0] || esc(st)}</span>`;
const founderTag = (f) => (f ? `<span class="tag founder" title="${f.rateLost ? 'Tarif Fondateur perdu' : 'Tarif garanti jusqu\'au ' + esc(dateFr(f.rateUntil))}">Fondateur n°${f.seat}${f.rateLost ? ' · tarif perdu' : ''}</span>` : '');
const left = (r) => {
  if (r.planStatus === 'none' || r.daysLeft === null) return '<span class="faint">—</span>';
  const d = r.daysLeft;
  const cls = d < 0 ? 'red' : d <= 30 ? 'red' : d <= 60 ? 'warn' : '';
  return `${esc(dateFr(r.paidUntil))}<div><span class="tag ${cls}">${d < 0 ? `échu depuis ${-d} j` : `dans ${d} j`}</span></div>`;
};

/* ---------------- Liste des abonnements ---------------- */
let F = { q: '', status: '', plan: '', soon: '' };

export async function billing(c) {
  X.setTitle('Abonnements');
  c.innerHTML = '<div data-cards></div><div data-req></div><div class="toolbar"><div class="search-box">' + icon('search', 'sm') + `<input placeholder="Établissement, ville ou e-mail" data-q value="${esc(F.q)}"></div><div class="seg" data-seg></div><select data-plan></select></div><section class="panel"><div class="tbl-wrap" data-t></div></section>`;
  const load = async () => {
    const r = await X.get(`/billing/subscriptions?q=${encodeURIComponent(F.q)}&status=${F.status}&plan=${F.plan}&soon=${F.soon}`).catch(fail);
    if (!r) return;
    const k = r.counts;
    $('[data-cards]', c).innerHTML = `<div class="cards">
      <div class="stat"><small>${icon('checkSq', 'xs')} Abonnés actifs</small><b>${k.active}</b><span class="sub">sur ${k.all} établissement(s) actif(s)</span></div>
      <div class="stat ${k.grace ? 'alert' : ''}"><small>${icon('clock', 'xs')} En période de grâce</small><b>${k.grace}</b><span class="sub">à relancer</span></div>
      <div class="stat"><small>${icon('calendar', 'xs')} Échéance sous 60 jours</small><b>${k.soon}</b><span class="sub"><a href="#" data-soon>Voir</a></span></div>
      <div class="stat"><small>${icon('star', 'xs')} Places Fondateur</small><b>${r.founder.taken} / ${r.founder.seats}</b><span class="sub">${Math.max(0, r.founder.seats - r.founder.taken)} restante(s) · tarif garanti ${r.founder.guaranteedYears} an(s)</span></div>
      <div class="stat ${r.pendingRequests ? 'alert' : ''}"><small>${icon('bell', 'xs')} Demandes de formule</small><b>${r.pendingRequests}</b><span class="sub">en attente</span></div></div>`;
    $('[data-seg]', c).innerHTML = [['', 'Tous', k.all], ['active', 'Actifs', k.active], ['grace', 'En grâce', k.grace], ['none', 'Sans abonnement', k.none]]
      .map(([v, l, n]) => `<button class="${v === F.status && !F.soon ? 'on' : ''}" data-st="${v}">${l} <span class="faint">${n}</span></button>`).join('')
      + `<button class="${F.soon ? 'on' : ''}" data-st="soon">Échéance ≤ 60 j <span class="faint">${k.soon}</span></button>`;
    $('[data-plan]', c).innerHTML = `<option value="">Toutes les formules</option>${r.plans.map(p => `<option value="${p.code}" ${p.code === F.plan ? 'selected' : ''}>${esc(p.name)} (${k.byPlan[p.code] || 0})</option>`).join('')}`;
    $('[data-t]', c).innerHTML = r.rows.length ? `<table class="tbl"><thead><tr><th>Établissement</th><th>Formule</th><th>Statut</th><th>Échéance</th><th>Dernier paiement</th></tr></thead><tbody>
      ${r.rows.map(s => `<tr data-go="#/billing/${s.id}"><td><div class="cell-user">${avatar({ id: s.id, name: s.name, avatar: s.logo }, 34)}<div><b>${esc(s.name)}</b><div class="faint" style="font-size:12px">${esc(s.city || '')}</div></div></div></td>
        <td>${esc(s.planName)} ${founderTag(s.founder)}${s.pendingRequest ? '<div><span class="tag warn">Demande en attente</span></div>' : ''}</td><td>${pstTag(s.planStatus)}</td><td>${left(s)}</td>
        <td>${s.lastPayment ? `${fcfa(s.lastPayment.amount)}<div class="faint" style="font-size:12px">${esc(listTime(s.lastPayment.at))}</div>` : '<span class="faint">—</span>'}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${icon('checkSq')}Aucun établissement dans cette catégorie.</div>`;
    const reqs = r.pendingRequests ? await X.get('/billing/requests?status=pending').catch(() => []) : [];
    $('[data-req]', c).innerHTML = reqs.length ? `<section class="panel"><h2>${icon('bell', 'sm')} Demandes de formule en attente</h2><table class="tbl"><tbody>
      ${reqs.map(q => `<tr data-go="#/billing/${q.schoolId}"><td><b>${esc(q.schoolName)}</b>${q.message ? `<div class="faint" style="font-size:12.5px">« ${esc(q.message)} »</div>` : ''}</td><td>demande <b>${esc(q.planName)}</b></td><td class="faint">${esc(listTime(q.at))}</td><td class="num"><button class="btn text" data-go="#/billing/${q.schoolId}">Traiter</button></td></tr>`).join('')}</tbody></table></section>` : '';
  };
  c.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (b) { if (b.dataset.st === 'soon') { F.soon = '60'; F.status = ''; } else { F.status = b.dataset.st; F.soon = ''; } load(); }
    if (e.target.closest('[data-soon]')) { e.preventDefault(); F.soon = '60'; F.status = ''; load(); }
    const go = e.target.closest('button[data-go]');
    if (go) location.hash = go.dataset.go;
  });
  $('[data-plan]', c).onchange = (e) => { F.plan = e.target.value; load(); };
  $('[data-q]', c).oninput = debounce((e) => { F.q = e.target.value; load(); }, 250);
  X.bindRows(c);
  load();
}

/* ---------------- Fiche abonnement d'un établissement ---------------- */
export async function billingDetail(c, id) {
  X.setTitle('Abonnement');
  let s;
  try { s = await X.get('/billing/schools/' + id); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  X.setTitle(s.name);
  const o = s.offer;
  const pend = s.requests.find(r => r.status === 'pending');
  c.innerHTML = `<p><a href="#/billing">← Tous les abonnements</a> · <a href="#/schools/${s.id}">Fiche de l'établissement</a></p>
    <section class="panel"><div class="pad row" style="gap:18px;flex-wrap:wrap">${avatar({ id: s.id, name: s.name, avatar: s.logo }, 72)}
      <div class="grow"><h2 style="margin:0;font-size:21px">${esc(s.name)}</h2><div class="muted">${esc(s.city || '')} · ${esc(s.email)}</div>
      <div style="margin-top:6px">${esc(o.name)} ${pstTag(o.status)} ${founderTag(s.founder)} ${s.verified ? (s.verifiedShown ? '<span class="tag ok">Vérifié</span>' : '<span class="tag" title="Le badge n\'est affiché qu\'à partir de la formule Standard">Vérifié (masqué : formule insuffisante)</span>') : ''}</div></div>
      <div class="actions"><button class="btn" data-a="pay">${icon('plus', 'sm')} Enregistrer un paiement</button></div></div>
      ${s.banner ? `<div class="pad" style="padding-top:0"><div class="notice ${s.banner.level}">${esc(s.banner.text)}</div></div>` : ''}</section>
    ${pend ? `<section class="panel"><h2>${icon('bell', 'sm')} Demande en attente</h2><div class="pad row" style="flex-wrap:wrap"><div class="grow">Formule demandée : <b>${esc(pend.planName)}</b> · ${esc(fullDate(pend.at))}${pend.message ? `<div class="faint">« ${esc(pend.message)} »</div>` : ''}</div>
      <button class="btn" data-a="pay" data-plan="${pend.plan}">Enregistrer le paiement</button><button class="btn ghost" data-req="${pend.id}">Refuser / classer</button></div></section>` : ''}
    <div class="grid2">
      <section class="panel"><h2>Situation</h2><div class="pad"><dl class="kv">
        <dt>Formule</dt><dd>${esc(o.name)} — ${PST[o.status][0].toLowerCase()}</dd>
        <dt>Payé jusqu'au</dt><dd>${esc(dateFr(o.paidUntil))}${o.next ? `<div class="faint">puis ${esc(o.next.plan)} du ${esc(dateFr(o.next.start))} au ${esc(dateFr(o.next.end))}</div>` : ''}</dd>
        ${o.graceEnd ? `<dt>Fin de la grâce</dt><dd>${esc(dateFr(o.graceEnd))}</dd>` : ''}
        <dt>Publications ce mois</dt><dd>${o.usage.postsThisMonth}${o.quotas.postsPerMonth !== null ? ` / ${o.quotas.postsPerMonth}` : ' (illimité)'}</dd>
        <dt>Offre Fondateur</dt><dd>${s.founder ? `Place n°${s.founder.seat}${s.founder.rateLost ? ' — <b>tarif perdu</b> (interruption)' : ` — tarif garanti jusqu'au ${esc(dateFr(s.founder.rateUntil))}`}` : esc(s.founderEligibility.reason)}</dd>
      </dl></div></section>
      <section class="panel"><h2>Paiements</h2>${s.payments.length ? `<table class="tbl"><tbody>${s.payments.map(p => `<tr data-go="#/receipt/${p.id}" ${p.cancelled ? 'style="opacity:.55"' : ''}><td><b>${fcfa(p.amount)}</b><div class="faint" style="font-size:12px">${esc(p.methodLabel)}${p.reference ? ' · ' + esc(p.reference) : ''}</div></td><td>${esc(dateFr(p.at))}${p.cancelled ? ' <span class="tag red">Annulé</span>' : ''}</td><td class="num"><a href="#/receipt/${p.id}">Reçu ${esc(p.receiptNo)}</a></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucun paiement enregistré.</div>'}</section>
    </div>
    <section class="panel"><h2>Historique des abonnements</h2><div class="tbl-wrap">${s.subscriptions.length ? `<table class="tbl"><thead><tr><th>Formule</th><th>Période</th><th>Montant</th><th>Saisi par</th><th></th></tr></thead><tbody>
      ${s.subscriptions.map(x => `<tr ${x.cancelled ? 'style="opacity:.55"' : ''}><td><b>${esc(x.planName)}</b><div class="faint" style="font-size:12px">${esc(x.kindLabel)}${x.founderRate ? ' · tarif Fondateur' : ''}</div>${x.cancelled ? `<span class="tag red">Annulé</span>` : ''}</td>
        <td>${esc(dateFr(x.start))} → ${esc(dateFr(x.end))}${x.history.map(hh => `<div class="faint" style="font-size:12px">${esc(listTime(hh.at))} · ${esc(hh.byName)} : ${hh.action === 'extend' ? `prolongé de ${hh.days} j` : `formule ${esc(hh.from)} → ${esc(hh.to)}`}${hh.note ? ' — ' + esc(hh.note) : ''}</div>`).join('')}</td>
        <td>${fcfa(x.amount)}${x.discount ? `<div class="faint" style="font-size:12px">remise ${fcfa(x.discount)}</div>` : ''}<div class="faint" style="font-size:12px">${esc(x.methodLabel)}</div></td>
        <td>${esc(x.byName)}<div class="faint" style="font-size:12px">${esc(listTime(x.createdAt))}</div>${x.note ? `<div class="faint" style="font-size:12px">${esc(x.note)}</div>` : ''}</td>
        <td class="num">${x.cancelled ? '' : `<button class="btn text" data-ext="${x.id}">Prolonger</button><button class="btn text" data-chg="${x.id}">Changer de formule</button><button class="btn text danger" data-can="${x.id}">Annuler</button>`}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucun abonnement : statut « sans abonnement ».</div>'}</div></section>`;
  const reload = () => billingDetail(c, id);
  c.onclick = async (e) => {
    const t = e.target;
    try {
      const pay = t.closest('[data-a=pay]');
      if (pay) return paymentForm(s, pay.dataset.plan || pend?.plan);
      const go = t.closest('tr[data-go]');
      if (go && !t.closest('a,button')) { location.hash = go.dataset.go; return; }
      const rq = t.closest('[data-req]');
      if (rq) {
        const note = await promptBox('Classer la demande sans paiement ?', { label: 'Note interne (facultative)', max: 500 });
        if (note === null) return;
        await X.post('/billing/requests/' + rq.dataset.req, { status: 'rejected', note }); toast('Demande classée'); X.refreshBadge(); return reload();
      }
      const ext = t.closest('[data-ext]');
      if (ext) {
        const days = await promptBox('Prolonger l\'abonnement', { label: 'Nombre de jours à ajouter à l\'échéance', value: '30', max: 3 });
        if (days === null) return;
        const note = await promptBox('Motif de la prolongation', { label: 'Visible dans l\'historique', max: 500 });
        if (note === null) return;
        await X.post(`/billing/subscriptions/${ext.dataset.ext}/extend`, { days: Number(days), note }); toast('Abonnement prolongé'); return reload();
      }
      const chg = t.closest('[data-chg]');
      if (chg) return changePlanForm(chg.dataset.chg, reload);
      const can = t.closest('[data-can]');
      if (can) {
        if (!(await confirmBox('Annuler cet enregistrement ?', 'À utiliser pour une saisie erronée : l\'abonnement et son paiement sont marqués « annulés » (ils restent dans l\'historique) et les droits correspondants sont retirés.', { ok: 'Annuler l\'enregistrement', danger: true }))) return;
        const note = await promptBox('Motif de l\'annulation', { max: 500 });
        if (note === null) return;
        await X.post(`/billing/subscriptions/${can.dataset.can}/cancel`, { note }); toast('Enregistrement annulé'); return reload();
      }
    } catch (er) { fail(er); }
  };
}

async function changePlanForm(subId, done) {
  const plans = Object.values((await X.get('/billing/offers')).plans).sort((x, y) => x.order - y.order);
  const body = h(`<div><div class="field"><label>Nouvelle formule</label><select class="input boxed" data-p>${plans.filter(p => p.code !== 'gratuit').map(p => `<option value="${p.code}">${esc(p.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Motif</label><input class="input boxed" data-n maxlength="500" placeholder="Ex. correction de saisie, geste commercial"></div>
    <p class="hint">Change la formule de cette période sans nouveau paiement. Pour une montée en gamme payante, utilisez « Enregistrer un paiement » (le prorata est calculé).</p></div>`);
  modal({ title: 'Changer de formule', body, buttons: [{ label: 'Annuler' }, { label: 'Changer', cls: '', onClick: async () => {
    await X.post(`/billing/subscriptions/${subId}/plan`, { plan: $('[data-p]', body).value, note: $('[data-n]', body).value });
    toast('Formule modifiée'); done();
  } }] });
}

// Saisie d'un paiement : formule, montant, moyen, référence, date de début (fin = début + 12 mois).
async function paymentForm(s, preset) {
  const plans = Object.values((await X.get('/billing/offers')).plans).sort((x, y) => x.order - y.order);
  const buyable = plans.filter(p => p.code !== 'gratuit');
  const body = h(`<div class="pay-form">
    <div class="field"><label>Formule</label><select class="input boxed" data-plan>${buyable.map(p => `<option value="${p.code}" ${p.code === (preset || s.plan) ? 'selected' : ''}>${esc(p.name)} — ${fcfa(p.price)}/an${p.purchasable ? '' : ' (désactivée)'}</option>`).join('')}</select></div>
    <div data-quote class="notice info">Calcul…</div>
    <div class="form2">
      <div class="field"><label>Date de début</label><input class="input boxed" type="date" data-start></div>
      <div class="field"><label>Fin (calculée)</label><input class="input boxed" data-end disabled></div>
      <div class="field"><label>Montant payé (FCFA)</label><input class="input boxed" type="number" min="0" step="100" data-amount></div>
      <div class="field"><label>Remise accordée (FCFA)</label><input class="input boxed" type="number" min="0" step="100" data-discount value="0"></div>
      <div class="field"><label>Moyen de paiement</label><select class="input boxed" data-method><option value="">Choisir…</option>${Object.entries(s.methods).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Référence de transaction</label><input class="input boxed" data-ref maxlength="120" placeholder="Ex. identifiant Wave, n° de chèque"></div>
    </div>
    <div class="field"><label>Note interne</label><input class="input boxed" data-note maxlength="1000"></div></div>`);
  let q = null;
  const endOf = () => {
    if (!q) return;
    const st = $('[data-start]', body).value;
    if (!st) return;
    const start = fromIso(st);
    let end = q.end;
    if (q.kind !== 'upgrade') { const d = new Date(start); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate())); end = d.getTime(); }
    $('[data-end]', body).value = dateFr(end);
  };
  const quote = async () => {
    try {
      q = await X.get(`/billing/schools/${s.id}/quote?plan=${$('[data-plan]', body).value}`);
      const lines = [`<b>${esc(q.kindLabel)}</b> — formule actuelle : ${esc(q.current.name)} (${PST[q.current.status][0].toLowerCase()}${q.current.paidUntil ? `, payée jusqu'au ${esc(dateFr(q.current.paidUntil))}` : ''}).`];
      if (q.kind === 'renewal' && q.current.status !== 'none') lines.push('Renouvellement anticipé : la nouvelle période commence à la fin de l\'actuelle, aucun jour n\'est perdu.');
      if (q.prorata) lines.push(`Montée en gamme immédiate jusqu'à la même échéance. <b>Prorata suggéré : ${fcfa(q.prorata.amount)}</b> = (${fcfa(q.prorata.newPrice)} − ${fcfa(q.prorata.oldPrice)}) × ${q.prorata.remainingDays} jours restants.`);
      else lines.push(`Prix de la formule : ${fcfa(q.listPrice)} / an.`);
      if (q.founder) lines.push(`${q.founder.eligible ? '✔' : '✖'} ${esc(q.founder.reason)}`);
      const box = $('[data-quote]', body);
      box.className = `notice ${q.founder && !q.founder.eligible ? 'danger' : 'info'}`;
      box.innerHTML = lines.join('<br>');
      $('[data-start]', body).value = isoDay(q.start);
      $('[data-amount]', body).value = q.suggestedAmount;
      endOf();
    } catch (e) { fail(e); }
  };
  $('[data-plan]', body).onchange = quote;
  $('[data-start]', body).onchange = endOf;
  quote();
  modal({ title: `Enregistrer un paiement — ${s.name}`, body, wide: true, buttons: [{ label: 'Annuler' }, { label: 'Enregistrer et générer le reçu', cls: '', onClick: async () => {
    const amount = $('[data-amount]', body).value;
    if (amount === '') throw new Error('Indiquez le montant payé.');
    const r = await X.post(`/billing/schools/${s.id}/subscriptions`, {
      plan: $('[data-plan]', body).value, start: fromIso($('[data-start]', body).value), amount: Number(amount),
      discount: Number($('[data-discount]', body).value || 0), method: $('[data-method]', body).value,
      reference: $('[data-ref]', body).value, note: $('[data-note]', body).value,
    });
    toast(`Paiement enregistré — reçu ${r.payment.receiptNo}`);
    X.refreshBadge();
    location.hash = '#/receipt/' + r.payment.id;
  } }] });
}

/* ---------------- Reçu imprimable ---------------- */
export async function receipt(c, id) {
  X.setTitle('Reçu');
  let p;
  try { p = await X.get('/billing/payments/' + id); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  X.setTitle('Reçu ' + p.receiptNo);
  const sub = p.subscription;
  const iss = p.issuer || {};
  c.innerHTML = `<div class="no-print toolbar"><a href="#/billing/${p.school.id}" class="grow">← Abonnement de ${esc(p.school.name)}</a><button class="btn" data-print>${icon('download', 'sm')} Imprimer / enregistrer en PDF</button></div>
    <article class="receipt">
      ${p.cancelled ? '<div class="receipt-void">ANNULÉ</div>' : ''}
      <header><div><div class="receipt-brand"><span class="logo"></span>${esc(iss.name || 'Scola')}</div>
        <div class="faint">${esc(iss.address || '')}${iss.phone ? '<br>' + esc(iss.phone) : ''}${iss.email ? '<br>' + esc(iss.email) : ''}${iss.legal ? '<br>' + esc(iss.legal) : ''}</div></div>
        <div style="text-align:right"><h2>Reçu de paiement</h2><div><b>N° ${esc(p.receiptNo)}</b></div><div class="faint">Émis le ${esc(dateFr(p.at))}</div></div></header>
      <section><h3>Reçu de</h3><p><b>${esc(p.school.name)}</b><br>${esc([p.school.address, p.school.city, p.school.country].filter(Boolean).join(', '))}${p.school.email ? '<br>' + esc(p.school.email) : ''}${p.school.manager?.name ? '<br>À l\'attention de ' + esc(p.school.manager.name) : ''}</p></section>
      <table class="receipt-lines"><thead><tr><th>Désignation</th><th>Montant</th></tr></thead><tbody>
        <tr><td>${esc(p.label || 'Paiement')}${sub?.founderRate ? '<br><span class="faint">Offre Partenaire Fondateur</span>' : ''}</td><td>${fcfa((sub?.amount ?? p.amount) + (p.discount || 0))}</td></tr>
        ${p.discount ? `<tr><td>Remise</td><td>− ${fcfa(p.discount)}</td></tr>` : ''}
      </tbody><tfoot><tr><td>Total payé</td><td>${fcfa(p.amount)}</td></tr></tfoot></table>
      <dl class="kv"><dt>Moyen de paiement</dt><dd>${esc(p.methodLabel)}</dd>${p.reference ? `<dt>Référence</dt><dd>${esc(p.reference)}</dd>` : ''}
        ${sub ? `<dt>Période couverte</dt><dd>du ${esc(dateFr(sub.start))} au ${esc(dateFr(sub.end))}</dd>` : ''}<dt>Enregistré par</dt><dd>${esc(p.byName)}</dd></dl>
      <footer class="faint">Ce reçu atteste le paiement ci-dessus. Merci de votre confiance.</footer>
    </article>`;
  $('[data-print]', c).onclick = () => print();
}

/* ---------------- Offres et tarifs ---------------- */
export async function offersPage(c) {
  X.setTitle('Offres et tarifs');
  let o;
  try { o = await X.get('/billing/offers'); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const plans = Object.values(o.plans).sort((a, b) => a.order - b.order);
  const types = Object.values(o.campaignTypes);
  const numIn = (attrs, v, extra = '') => `<input class="input boxed num-in" type="number" min="0" ${attrs} value="${v ?? ''}" ${extra}>`;
  c.innerHTML = `<p class="muted" style="margin-top:0">Toute la grille commerciale est réglable ici, sans toucher au code. Les modifications s'appliquent immédiatement (les abonnements déjà payés gardent leur montant).</p>
    <section class="panel"><h2><span class="grow">Formules annuelles</span><button class="btn ghost" data-addplan style="height:32px">${icon('plus', 'sm')} Ajouter une formule</button></h2><div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th></th>${plans.map(p => `<th>${esc(p.code)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Nom</td>${plans.map(p => `<td><input class="input boxed" data-p="${p.code}" data-k="name" value="${esc(p.name)}"></td>`).join('')}</tr>
      <tr><td>Prix annuel (FCFA)</td>${plans.map(p => `<td>${numIn(`data-p="${p.code}" data-k="price" step="1000"`, p.price, p.code === 'gratuit' ? 'disabled' : '')}</td>`).join('')}</tr>
      <tr><td>Cible</td>${plans.map(p => `<td><input class="input boxed" data-p="${p.code}" data-k="target" value="${esc(p.target || '')}"></td>`).join('')}</tr>
      <tr><td>Proposée à la souscription</td>${plans.map(p => `<td>${p.code === 'gratuit' ? '—' : `<input type="checkbox" data-p="${p.code}" data-k="purchasable" ${p.purchasable ? 'checked' : ''}>`}</td>`).join('')}</tr>
      <tr><td>Ordre (gamme)</td>${plans.map(p => `<td>${numIn(`data-p="${p.code}" data-k="order"`, p.order)}</td>`).join('')}</tr>
      <tr class="sep"><td colspan="${plans.length + 1}">Quotas</td></tr>
      ${Object.entries(o.quotas).map(([k, l]) => `<tr><td>${esc(l)}${k === 'postsPerMonth' ? '<div class="faint" style="font-size:11.5px">vide = illimité</div>' : ''}</td>${plans.map(p => `<td>${numIn(`data-p="${p.code}" data-q="${k}"`, p.quotas[k])}</td>`).join('')}</tr>`).join('')}
      <tr class="sep"><td colspan="${plans.length + 1}">Droits inclus</td></tr>
      ${Object.entries(o.rights).map(([k, l]) => `<tr><td>${esc(l)}</td>${plans.map(p => `<td><input type="checkbox" data-p="${p.code}" data-r="${k}" ${p.rights[k] ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}
    </tbody></table></div></section>

    <section class="panel"><h2>Types de campagnes publicitaires</h2><div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th>Type</th><th>Prix (FCFA)</th><th>Durée min (j)</th><th>Durée max (j)</th><th>Emplacements</th><th>Nationale</th><th>Proposé</th><th>Prix provisoire</th></tr></thead><tbody>
      ${types.map(t => `<tr><td><input class="input boxed" data-t="${t.code}" data-k="name" value="${esc(t.name)}"><input class="input boxed" data-t="${t.code}" data-k="usage" value="${esc(t.usage || '')}" style="margin-top:4px;font-size:12.5px"></td>
        <td>${numIn(`data-t="${t.code}" data-k="price" step="1000"`, t.price)}</td><td>${numIn(`data-t="${t.code}" data-k="minDays"`, t.minDays)}</td><td>${numIn(`data-t="${t.code}" data-k="maxDays"`, t.maxDays)}</td>
        <td>${Object.entries(o.placements).map(([k, l]) => `<label class="chk"><input type="checkbox" data-t="${t.code}" data-pl="${k}" ${t.placements.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</td>
        <td><input type="checkbox" data-t="${t.code}" data-k="national" ${t.national ? 'checked' : ''}></td><td><input type="checkbox" data-t="${t.code}" data-k="active" ${t.active ? 'checked' : ''}></td>
        <td><input type="checkbox" data-t="${t.code}" data-k="provisional" ${t.provisional ? 'checked' : ''}>${t.provisional ? ' <span class="tag warn">provisoire</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div><p class="hint pad" style="margin:0">Un prix marqué « provisoire » est signalé comme tel aux établissements. Décochez-le une fois le tarif fixé.</p></section>

    <div class="grid2">
      <section class="panel"><h2>Règles</h2><div class="pad form2">
        <div class="field"><label>Places Partenaire Fondateur</label>${numIn('data-g="founder.seats"', o.founder.seats)}<div class="hint">${o.founderTaken} déjà attribuée(s)</div></div>
        <div class="field"><label>Années de tarif Fondateur garanti</label>${numIn('data-g="founder.guaranteedYears"', o.founder.guaranteedYears)}</div>
        <div class="field"><label>Période de grâce (jours)</label>${numIn('data-g="graceDays"', o.graceDays)}</div>
        <div class="field"><label>Rappels avant échéance (jours)</label><input class="input boxed" data-g="reminderDays" value="${esc(o.reminderDays.join(', '))}"><div class="hint">Ex. 60, 30, 7</div></div>
        <div class="field"><label>Durée d'une mise en avant (jours)</label>${numIn('data-g="featuredDays"', o.featuredDays)}</div>
        <div class="field"><label>Affichages max d'une campagne / élève / jour</label>${numIn('data-g="frequencyCap"', o.frequencyCap)}</div>
        <div class="field"><label>Seuil d'estimation d'audience</label>${numIn('data-g="minAudience"', o.minAudience)}<div class="hint">En dessous : « moins de ${o.minAudience} »</div></div>
        <div class="field"><label>Seuil de confidentialité des statistiques</label>${numIn('data-g="privacyThreshold" min="10"', o.privacyThreshold)}<div class="hint">10 minimum</div></div>
      </div></section>
      <section class="panel"><h2>Textes et contacts</h2><div class="pad">
        <div class="field"><label>Instructions de paiement (montrées aux établissements)</label><textarea class="input boxed" rows="6" data-g="paymentInstructions">${esc(o.paymentInstructions)}</textarea></div>
        <div class="field"><label>Interlocuteur « Accompagnement marketing » (Premium)</label><div class="form3"><input class="input boxed" placeholder="Nom" data-g="marketingContact.name" value="${esc(o.marketingContact.name)}"><input class="input boxed" placeholder="Téléphone" data-g="marketingContact.phone" value="${esc(o.marketingContact.phone)}"><input class="input boxed" placeholder="E-mail" data-g="marketingContact.email" value="${esc(o.marketingContact.email)}"></div></div>
        <div class="field"><label>Émetteur des reçus</label><div class="form3"><input class="input boxed" placeholder="Nom" data-g="issuer.name" value="${esc(o.issuer.name)}"><input class="input boxed" placeholder="Téléphone" data-g="issuer.phone" value="${esc(o.issuer.phone)}"><input class="input boxed" placeholder="E-mail" data-g="issuer.email" value="${esc(o.issuer.email)}"></div>
          <input class="input boxed" style="margin-top:6px" placeholder="Adresse" data-g="issuer.address" value="${esc(o.issuer.address)}"><input class="input boxed" style="margin-top:6px" placeholder="Mentions légales (RCCM, NCC…)" data-g="issuer.legal" value="${esc(o.issuer.legal)}"></div>
      </div></section>
    </div>
    <div class="save-bar"><span class="grow faint" data-dirty></span><button class="btn ghost" data-reset>Annuler les modifications</button><button class="btn" data-save>Enregistrer la grille</button></div>`;
  const collect = () => {
    const b = { plans: {}, campaignTypes: {}, founder: {}, marketingContact: {}, issuer: {} };
    for (const el of $$('[data-p]', c)) {
      const p = (b.plans[el.dataset.p] ||= { rights: {}, quotas: {} });
      if (el.dataset.r) p.rights[el.dataset.r] = el.checked;
      else if (el.dataset.q) p.quotas[el.dataset.q] = el.value === '' ? (el.dataset.q === 'postsPerMonth' ? null : 0) : Number(el.value);
      else if (el.type === 'checkbox') p[el.dataset.k] = el.checked;
      else if (!el.disabled) p[el.dataset.k] = el.type === 'number' ? Number(el.value) : el.value;
    }
    for (const el of $$('[data-t]', c)) {
      const t = (b.campaignTypes[el.dataset.t] ||= { placements: [] });
      if (el.dataset.pl) { if (el.checked) t.placements.push(el.dataset.pl); }
      else if (el.type === 'checkbox') t[el.dataset.k] = el.checked;
      else t[el.dataset.k] = el.type === 'number' ? Number(el.value) : el.value;
    }
    for (const el of $$('[data-g]', c)) {
      const [k, sub] = el.dataset.g.split('.');
      const v = el.type === 'number' ? Number(el.value) : el.value;
      if (sub) b[k][sub] = v; else b[k] = v;
    }
    return b;
  };
  c.addEventListener('input', () => { $('[data-dirty]', c).textContent = 'Modifications non enregistrées'; });
  $('[data-reset]', c).onclick = () => offersPage(c);
  $('[data-save]', c).onclick = async (e) => {
    e.target.disabled = true;
    try { await X.patch('/billing/offers', collect()); toast('Grille enregistrée'); offersPage(c); } catch (er) { fail(er); } finally { e.target.disabled = false; }
  };
  $('[data-addplan]', c).onclick = async () => {
    const code = await promptBox('Nouvelle formule', { label: 'Code (lettres minuscules, ex. ecole_plus)', max: 20 });
    if (!code) return;
    try { await X.patch('/billing/offers', { plans: { [code.trim()]: { name: code.trim(), purchasable: false } } }); toast('Formule ajoutée (non proposée tant que vous ne la cochez pas)'); offersPage(c); } catch (er) { fail(er); }
  };
}

/* ---------------- Tableau de bord financier (en tête du tableau de bord) ---------------- */
export async function financePanel(el) {
  let f;
  try { f = await X.get('/billing/finance'); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const monthLbl = (k, long) => new Date(k + '-15T12:00:00Z').toLocaleDateString('fr-FR', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
  const split = (x) => `${fcfa(x.subscriptions)} d'abonnements · ${fcfa(x.campaigns)} de campagnes`;
  el.innerHTML = `<h2 class="section-h">Activité commerciale</h2>
    <div class="cards">
      <div class="stat"><small>${icon('checkSq', 'xs')} Encaissé ce mois-ci</small><b>${fcfa(f.month.total)}</b><span class="sub">${split(f.month)}</span></div>
      <div class="stat"><small>${icon('calendar', 'xs')} Encaissé cette année</small><b>${fcfa(f.year.total)}</b><span class="sub">${split(f.year)}</span></div>
      <div class="stat"><small>${icon('refresh', 'xs')} Taux de renouvellement</small><b>${f.renewal.rate === null ? '—' : f.renewal.rate + ' %'}</b><span class="sub">${f.renewal.due ? `${f.renewal.renewed} renouvelé(s) sur ${f.renewal.due} échéance(s) en 12 mois` : 'Pas encore d\'échéance passée'}</span></div>
      <div class="stat ${f.campaigns.queue ? 'alert' : ''}"><small>${icon('flash', 'xs')} Campagnes actives</small><b>${f.campaigns.active}</b><span class="sub">${f.campaigns.scheduled} programmée(s) · <a href="#/campaigns">${f.campaigns.queue} à traiter</a></span></div>
      <div class="stat"><small>${icon('star', 'xs')} Places Fondateur restantes</small><b>${Math.max(0, f.founder.seats - f.founder.taken)}</b><span class="sub">${f.founder.taken} attribuée(s) sur ${f.founder.seats}</span></div>
    </div>
    <div class="grid2">
      <section class="panel"><h2>Encaissements des 12 derniers mois</h2><div class="pad"><div data-rev></div></div></section>
      <section class="panel"><h2>Établissements par formule</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Formule</th><th class="num">Nombre</th><th class="num">Encaissé (année)</th></tr></thead><tbody>
        ${f.byPlan.map(p => `<tr data-go="#/billing"><td>${esc(p.name)}${p.grace ? ` <span class="tag warn">${p.grace} en grâce</span>` : ''}</td><td class="num">${p.count}</td><td class="num">${p.revenueYear ? fcfa(p.revenueYear) : '—'}</td></tr>`).join('')}</tbody></table></div></section>
    </div>
    <section class="panel"><h2><span class="grow">Renouvellements à venir (60 jours) et périodes de grâce</span><a href="#/billing" style="font-size:13px;font-weight:500">Tous les abonnements</a></h2>
      ${f.upcoming.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Établissement</th><th>Formule</th><th>Échéance</th><th class="num">Montant attendu</th></tr></thead><tbody>
        ${f.upcoming.map(u => `<tr data-go="#/billing/${u.id}"><td><b>${esc(u.name)}</b>${u.founder ? ' <span class="tag founder">Fondateur</span>' : ''}</td><td>${esc(u.plan)}</td><td>${esc(dateFr(u.paidUntil))} <span class="tag ${u.daysLeft < 0 ? 'red' : u.daysLeft <= 30 ? 'red' : 'warn'}">${u.daysLeft < 0 ? `en grâce depuis ${-u.daysLeft} j` : `dans ${u.daysLeft} j`}</span></td><td class="num">${fcfa(u.price)}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty" style="padding:20px">Aucune échéance dans les 60 prochains jours.</div>'}</section>`;
  mountLine($('[data-rev]', el), { points: f.months.map(x => ({ label: monthLbl(x.m, true), short: monthLbl(x.m), v: x.total })), name: 'Encaissé (FCFA)', ariaLabel: 'Encaissements par mois sur 12 mois', height: 200 });
  X.bindRows(el);
}
