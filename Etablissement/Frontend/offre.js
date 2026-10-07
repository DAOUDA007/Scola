// Espace établissement : « Ma formule » (offre en cours, demande de formule) et contenus de la
// page officielle selon la formule (formations structurées, bloc Inscriptions, galerie photos).
import { $, h, esc, icon } from '/js/util.js';
import { toast, fail, modal, confirmBox } from '/js/ui.js';
import { compressImage } from '/js/media.js';

let X; // { get, post, patch, uploadFile, me, setMe, cycles }
export function setup(ctx) { X = ctx; }

export const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
export const dateFr = (t) => (t ? new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const isoDay = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
const fromIso = (v) => { if (!v) return null; const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const STATUS = { active: 'en cours', grace: 'expirée — période de grâce', none: 'aucun abonnement en cours' };

// Bandeau d'échéance (affiché en haut de toutes les pages de l'espace).
export function bannerHTML(me) {
  const b = me?.offer?.banner;
  if (!b) return '';
  return `<div class="et-banner ${b.level}">${icon(b.level === 'info' ? 'info' : 'clock', 'sm')}<span class="grow">${esc(b.text)}</span>${location.hash.startsWith('#/formule') ? '' : '<a class="btn" href="#/formule">Ma formule</a>'}</div>`;
}

// Encart « fonction non incluse » avec lien vers Ma formule.
export function locked(text) {
  return `<div class="et-lock">${icon('lock', 'sm')}<span class="grow">${esc(text)}</span><a class="btn ghost" href="#/formule">Voir les formules</a></div>`;
}

/* ---------------- Ma formule ---------------- */
export async function formulePage(c) {
  let r;
  try { r = await X.get('/offer'); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const o = r.offer;
  const pending = r.requests.find(q => q.status === 'pending');
  const lim = (used, max) => (max === null || max === undefined ? `${used} <small class="faint" style="display:inline;font-size:13px;font-weight:500">sans limite</small>` : `${used} / ${max}`);
  const rightsList = (rights) => Object.entries(r.rights).filter(([k]) => rights[k] && k !== 'founderBadge');
  const cur = r.plans.find(p => p.code === o.code);
  c.innerHTML = `${bannerHTML({ offer: o })}${o.banner && o.rights.statsBasic ? `<p style="margin:-6px 0 14px"><a href="#/rapports/annuel">${icon('file', 'xs')} Voir mon bilan annuel avant de renouveler</a></p>` : ''}
    <div class="panel plan-now"><div class="pad">
      <div class="row" style="flex-wrap:wrap;gap:14px"><div class="grow"><small class="faint">Votre formule</small><h2 style="margin:2px 0 4px;font-size:24px">${esc(o.name)}${o.founder ? ' <span class="tag founder">Partenaire Fondateur</span>' : ''}</h2>
        <div class="muted">${esc(STATUS[o.status])}${o.paidUntil ? ` · payée jusqu'au <b>${esc(dateFr(o.paidUntil))}</b>` : ''}${o.graceEnd ? ` · avantages conservés jusqu'au ${esc(dateFr(o.graceEnd))}` : ''}</div>
        ${o.next ? `<div class="faint" style="font-size:13px">Période suivante déjà réglée : jusqu'au ${esc(dateFr(o.next.end))}.</div>` : ''}</div>
        ${pending ? `<span class="tag warn">Demande « ${esc(pending.planName)} » en cours</span>` : ''}</div>
      <div class="cards" style="margin:16px 0 0">
        <div class="stat"><small>${icon('megaphone', 'xs')} Publications ce mois</small><b>${lim(o.usage.postsThisMonth, o.quotas.postsPerMonth)}</b></div>
        ${o.rights.featuredPosts ? `<div class="stat"><small>${icon('star', 'xs')} Mises en avant ce mois</small><b>${lim(o.usage.featuredThisMonth, o.quotas.featuredPerMonth)}</b></div>` : ''}
        ${o.quotas.campaignCredits ? `<div class="stat"><small>${icon('flash', 'xs')} Campagnes incluses / an</small><b>${o.quotas.campaignCredits}</b></div>` : ''}
        ${o.quotas.nationalCredits ? `<div class="stat"><small>${icon('flash', 'xs')} Campagnes nationales / an</small><b>${o.quotas.nationalCredits}</b></div>` : ''}
      </div>
      ${o.founder ? `<p class="hint" style="margin:12px 0 0">${o.founder.rateLost ? 'Votre tarif Fondateur a pris fin (abonnement interrompu). Votre badge « Fondateur » reste affiché.' : `Tarif Fondateur garanti jusqu'au ${esc(dateFr(o.founder.rateUntil))}, à condition de renouveler sans interruption.`}</p>` : ''}
    </div></div>
    ${r.marketingContact && (r.marketingContact.name || r.marketingContact.phone || r.marketingContact.email) ? `<div class="panel"><h2>${icon('user', 'sm')} Votre interlocuteur Scola — Accompagnement marketing</h2><div class="pad" style="line-height:1.8">
      <b>${esc(r.marketingContact.name || 'Équipe Scola')}</b>${r.marketingContact.phone ? `<br>${icon('phone', 'xs')} <a href="tel:${esc(r.marketingContact.phone)}">${esc(r.marketingContact.phone)}</a>` : ''}${r.marketingContact.email ? `<br>${icon('at', 'xs')} <a href="mailto:${esc(r.marketingContact.email)}">${esc(r.marketingContact.email)}</a>` : ''}</div></div>` : ''}
    <div class="panel"><h2>Ce qui est inclus dans votre formule</h2><div class="pad"><ul class="incl">
      ${o.quotas.postsPerMonth === null ? `<li class="on">${icon('check', 'xs')} Publications illimitées</li>` : `<li class="on">${icon('check', 'xs')} ${o.quotas.postsPerMonth} publications par mois</li>`}
      <li class="on">${icon('check', 'xs')} Chaîne visible, présentation, logo et coordonnées</li>
      <li class="on">${icon('check', 'xs')} Réponse aux élèves qui vous contactent</li>
      ${Object.entries(r.rights).filter(([k]) => k !== 'founderBadge').map(([k, l]) => `<li class="${o.rights[k] ? 'on' : 'off'}">${icon(o.rights[k] ? 'check' : 'x', 'xs')} ${esc(l)}</li>`).join('')}
    </ul></div></div>
    <h2 class="et-h2">Choisir une formule <small class="faint">abonnement annuel (12 mois)</small></h2>
    <div class="plans">${r.plans.map(p => {
      const isCur = p.code === o.code && o.status !== 'none';
      const extra = rightsList(p.rights).filter(([k]) => !cur || !cur.rights[k]).slice(0, 6);
      return `<div class="plan-card ${isCur ? 'cur' : ''}"><div class="row"><b class="grow">${esc(p.name)}</b>${isCur ? '<span class="tag ok">Actuelle</span>' : ''}${p.code === 'fondateur' ? '<span class="tag founder">Offre limitée</span>' : ''}</div>
        <div class="price">${fcfa(p.price)} <small>/ an</small></div><div class="faint" style="font-size:13px;min-height:34px">${esc(p.target)}</div>
        ${p.code === 'fondateur' ? `<p class="hint" style="margin:6px 0">${r.founder.seatsLeft} place(s) restante(s). Badge « Fondateur » permanent et tarif garanti ${r.founder.guaranteedYears} an(s) si vous renouvelez sans interruption.</p>` : ''}
        <ul class="incl small">${p.quotas.postsPerMonth === null ? `<li class="on">${icon('check', 'xs')} Publications illimitées</li>` : ''}${extra.map(([, l]) => `<li class="on">${icon('check', 'xs')} ${esc(l)}</li>`).join('')}${p.quotas.featuredPerMonth && !(cur?.quotas.featuredPerMonth) ? `<li class="on">${icon('check', 'xs')} ${p.quotas.featuredPerMonth} mises en avant par mois</li>` : ''}${p.quotas.campaignCredits ? `<li class="on">${icon('check', 'xs')} ${p.quotas.campaignCredits} campagne(s) incluse(s) par an</li>` : ''}${p.quotas.nationalCredits ? `<li class="on">${icon('check', 'xs')} ${p.quotas.nationalCredits} campagne(s) nationale(s) incluse(s)</li>` : ''}</ul>
        <button class="btn ${isCur ? 'ghost' : ''} block" data-req="${p.code}" ${pending ? 'disabled' : ''}>${isCur ? 'Renouveler' : o.status !== 'none' && cur && p.order > (cur.order ?? 0) ? 'Passer à cette formule' : 'Demander cette formule'}</button></div>`;
    }).join('')}</div>
    <div class="panel"><h2>Comment payer ?</h2><div class="pad" style="white-space:pre-wrap;font-size:14px;line-height:1.7">${esc(r.paymentInstructions)}</div>
      <p class="hint pad" style="margin:0;padding-top:0">Le paiement en ligne n'est pas encore disponible : après votre demande, l'équipe Scola enregistre votre paiement et vous envoie un reçu. Un renouvellement anticipé ne vous fait perdre aucun jour. Une montée en gamme en cours d'année est facturée au prorata.</p></div>
    ${r.requests.length ? `<div class="panel"><h2>Vos demandes</h2><div class="pad" style="font-size:14px;line-height:1.9">${r.requests.map(q => `${esc(dateFr(q.at))} — formule <b>${esc(q.planName)}</b> : ${{ pending: '<span class="tag warn">en cours</span>', done: '<span class="tag ok">traitée</span>', rejected: '<span class="tag">classée</span>' }[q.status]}`).join('<br>')}</div></div>` : ''}`;
  c.onclick = async (e) => {
    const b = e.target.closest('[data-req]');
    if (!b) return;
    const p = r.plans.find(x => x.code === b.dataset.req);
    const body = h(`<div><p style="margin-top:0">Vous demandez la formule <b>${esc(p.name)}</b> (${fcfa(p.price)} par an). L'équipe Scola vous recontacte pour finaliser le paiement.</p>
      <div class="field"><label>Message (facultatif)</label><textarea class="input boxed" rows="3" maxlength="1000" data-m placeholder="Ex. moyen de paiement souhaité, personne à contacter…"></textarea></div></div>`);
    modal({ title: 'Demander une formule', body, buttons: [{ label: 'Annuler' }, { label: 'Envoyer la demande', cls: '', onClick: async () => {
      const res = await X.post('/offer/request', { plan: p.code, message: $('[data-m]', body).value });
      modal({ title: 'Demande envoyée', body: `<p style="margin-top:0">Votre demande a bien été transmise. Pour finaliser, effectuez le paiement selon les instructions ci-dessous :</p><div class="notice" style="white-space:pre-wrap">${esc(res.paymentInstructions)}</div><p class="hint">Dès réception, votre formule est activée et un reçu vous est envoyé.</p>`, buttons: [{ label: 'Compris', cls: '' }] });
      formulePage(c);
    } }] });
  };
}

/* ---------------- Page officielle : formations, inscriptions, galerie ---------------- */
export function officialPanels(c) {
  const me = X.me();
  const r = me.offer?.rights || {};
  const wrap = h('<div></div>');
  c.append(wrap);
  const draw = () => {
    const m = X.me();
    const a = m.admissions || {};
    wrap.innerHTML = `
      <div class="panel"><h2><span class="grow">Formations proposées</span>${r.fullPage ? `<button class="btn ghost" data-addf style="height:32px">${icon('plus', 'sm')} Ajouter</button>` : ''}</h2>
        ${r.fullPage ? '' : `<div class="pad">${locked('Les formations structurées (cycle, filière, niveau d\'entrée, durée, frais) sont incluses à partir de la formule Starter. Elles permettent aux élèves de vous trouver dans l\'annuaire.')}</div>`}
        ${(m.formations || []).length ? `<div class="tbl-wrap"><table class="tbl formations"><thead><tr><th>Formation</th><th>Cycle</th><th>Niveau d'entrée</th><th>Durée</th><th>Frais indicatifs</th><th></th></tr></thead><tbody>
          ${m.formations.map(f => `<tr data-f="${f.id}"><td><b>${esc(f.title)}</b>${f.filiere ? `<div class="faint" style="font-size:12.5px">${esc(f.filiere)}</div>` : ''}</td><td>${esc(X.cycles().find(x => x.id === f.cycle)?.label || '—')}</td><td>${esc(f.entryLevel || '—')}</td><td>${esc(f.duration || '—')}</td><td>${esc(f.fees || '—')}</td>
            <td class="num" style="white-space:nowrap"><button class="btn text" data-editf>Modifier</button><button class="btn text danger" data-delf>Retirer</button></td></tr>`).join('')}</tbody></table></div>` : r.fullPage ? '<div class="pad faint">Aucune formation. Ajoutez vos filières pour apparaître dans l\'annuaire des formations.</div>' : ''}
        ${!r.fullPage && (m.formations || []).length ? '<p class="hint pad" style="margin:0">Ces formations sont conservées mais masquées aux élèves tant que votre formule ne les inclut pas.</p>' : ''}
      </div>
      <div class="panel"><h2>Inscriptions</h2><div class="pad">
        ${r.admissions ? `<form data-adm class="et-grid">
          <label class="field full row" style="flex-direction:row;gap:10px"><input type="checkbox" name="open" ${a.open ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--brand)"> <span>Inscriptions ouvertes (affiché sur votre chaîne)</span></label>
          <div class="field"><label>Ouverture</label><input class="input" type="date" name="start" value="${isoDay(a.start)}"></div>
          <div class="field"><label>Clôture</label><input class="input" type="date" name="end" value="${isoDay(a.end)}"></div>
          <div class="field"><label>Date limite de dépôt des dossiers</label><input class="input" type="date" name="deadline" value="${isoDay(a.deadline)}"></div>
          <div class="field"><label>Frais d'inscription / de dossier</label><input class="input" name="fees" maxlength="200" value="${esc(a.fees || '')}" placeholder="Ex. 25 000 FCFA"></div>
          <div class="field full"><label>Conditions d'admission</label><textarea class="input boxed" name="conditions" rows="3" maxlength="2000" placeholder="Ex. Bac C, D ou E ; étude de dossier puis entretien">${esc(a.conditions || '')}</textarea></div>
          <div class="field full"><label>Pièces à fournir</label><textarea class="input boxed" name="documents" rows="4" maxlength="2000" placeholder="Une pièce par ligne">${esc(a.documents || '')}</textarea></div>
          <div class="full row"><button class="btn">Enregistrer</button>${m.admissions ? '<button type="button" class="btn text danger" data-clear-adm>Retirer le bloc</button>' : ''}${r.admissionsHighlight ? `<span class="hint">${icon('star', 'xs')} Votre formule met ce bloc en valeur auprès des élèves.</span>` : ''}</div>
        </form>` : locked('Le bloc « Inscriptions » (période, conditions, pièces à fournir, date limite) est inclus à partir de la formule Starter.')}
      </div></div>
      <div class="panel"><h2><span class="grow">Galerie photos</span>${r.fullPage ? `<button class="btn ghost" data-addg style="height:32px">${icon('image', 'sm')} Ajouter des photos</button>` : ''}</h2><div class="pad">
        ${r.fullPage ? '' : locked('La galerie photos (campus, salles, événements) est incluse à partir de la formule Starter.')}
        ${(m.gallery || []).length ? `<div class="gallery">${m.gallery.map(u => `<div class="g"><img src="${esc(u)}" alt=""><button class="icon-btn" data-delg="${esc(u)}" title="Retirer">${icon('x', 'sm')}</button></div>`).join('')}</div>` : r.fullPage ? '<p class="faint" style="margin:0">Aucune photo. 20 photos au maximum.</p>' : ''}
      </div></div>`;
  };
  const save = async (body, msg) => { try { X.setMe(await X.patch('/me', body)); toast(msg); draw(); } catch (e) { fail(e); } };
  const formationForm = (f) => {
    const body = h(`<div class="et-grid">
      <div class="field full"><label>Intitulé</label><input class="input" data-k="title" maxlength="120" value="${esc(f?.title || '')}" placeholder="Ex. BTS Informatique Développeur d'Applications"></div>
      <div class="field"><label>Cycle</label><select class="input" data-k="cycle"><option value="">—</option>${X.cycles().map(x => `<option value="${x.id}" ${x.id === f?.cycle ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Filière</label><input class="input" data-k="filiere" maxlength="80" value="${esc(f?.filiere || '')}" list="et-filieres" placeholder="Ex. IDA"><datalist id="et-filieres"></datalist></div>
      <div class="field"><label>Niveau d'entrée</label><input class="input" data-k="entryLevel" maxlength="60" value="${esc(f?.entryLevel || '')}" placeholder="Ex. Baccalauréat"></div>
      <div class="field"><label>Durée</label><input class="input" data-k="duration" maxlength="40" value="${esc(f?.duration || '')}" placeholder="Ex. 2 ans"></div>
      <div class="field full"><label>Frais indicatifs</label><input class="input" data-k="fees" maxlength="80" value="${esc(f?.fees || '')}" placeholder="Ex. 450 000 FCFA / an"></div></div>`);
    const fill = () => { const cy = X.cycles().find(x => x.id === $('[data-k=cycle]', body).value); $('#et-filieres', body).innerHTML = (cy?.filieres || []).map(x => `<option value="${esc(x)}">`).join(''); };
    $('[data-k=cycle]', body).onchange = fill; fill();
    modal({ title: f ? 'Modifier la formation' : 'Ajouter une formation', body, buttons: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: '', onClick: async () => {
      const v = Object.fromEntries([...body.querySelectorAll('[data-k]')].map(el => [el.dataset.k, el.value]));
      const list = [...(X.me().formations || [])];
      if (f) list[list.findIndex(x => x.id === f.id)] = { ...f, ...v }; else list.push(v);
      X.setMe(await X.patch('/me', { formations: list }));
      toast('Formations enregistrées'); draw();
    } }] });
  };
  wrap.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-addf]')) return formationForm(null);
    const row = t.closest('[data-f]');
    const f = row && X.me().formations.find(x => x.id === row.dataset.f);
    if (f && t.closest('[data-editf]')) return formationForm(f);
    if (f && t.closest('[data-delf]') && await confirmBox(`Retirer « ${f.title} » ?`, '', { ok: 'Retirer', danger: true })) return save({ formations: X.me().formations.filter(x => x.id !== f.id) }, 'Formation retirée');
    if (t.closest('[data-clear-adm]') && await confirmBox('Retirer le bloc Inscriptions ?', 'Il ne sera plus affiché sur votre chaîne.', { ok: 'Retirer', danger: true })) return save({ admissions: null }, 'Bloc retiré');
    if (t.closest('[data-addg]')) {
      const { pickFiles } = await import('/js/util.js');
      const files = await pickFiles({ accept: 'image/*', multiple: true });
      if (!files) return;
      const urls = [...(X.me().gallery || [])];
      toast('Envoi des photos…');
      try { for (const file of [...files].slice(0, 20 - urls.length)) urls.push((await X.uploadFile(await compressImage(file, 1800))).url); } catch (er) { return fail(er); }
      return save({ gallery: urls }, 'Galerie mise à jour');
    }
    const g = t.closest('[data-delg]');
    if (g) return save({ gallery: X.me().gallery.filter(u => u !== g.dataset.delg) }, 'Photo retirée');
  });
  wrap.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-adm]')) return;
    e.preventDefault();
    const f = e.target;
    save({ admissions: { open: f.open.checked, start: fromIso(f.start.value), end: fromIso(f.end.value), deadline: fromIso(f.deadline.value), fees: f.fees.value, conditions: f.conditions.value, documents: f.documents.value } }, 'Bloc Inscriptions enregistré');
  });
  draw();
}
