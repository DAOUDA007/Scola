// Espace établissement : rapports imprimables (PDF depuis le navigateur), rédigés simplement.
// Rapport mensuel : formules Pro et plus. Bilan annuel : toutes les formules payantes.
import { $, esc, icon, avatar } from '/js/util.js';
import { mountLine, barList, fmt } from '/js/charts.js';
import { locked, fcfa, dateFr } from '/etablissement/offre.js';

let X; // { get }
export function setup(ctx) { X = ctx; }

const monthName = (k) => new Date(k + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const pl = (n, s, p = s + 's') => (n > 1 ? p : s);
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);

export async function rapportsPage(c, id) {
  if (id === 'annuel') return annualSheet(c);
  if (id && id.startsWith('m-')) return monthlySheet(c, id.slice(2));
  let r;
  try { r = await X.get('/reports'); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  c.innerHTML = `
    <div class="panel"><h2>Bilan annuel</h2><div class="pad">${r.annual
      ? `<p style="margin-top:0">Tout ce que Scola vous a apporté sur votre année d'abonnement : élèves touchés, contacts, campagnes, et ce que chaque contact vous a coûté. Idéal avant de renouveler.</p><a class="btn" href="#/rapports/annuel">${icon('file', 'sm')} Voir le bilan annuel</a>`
      : locked('Le bilan annuel est inclus dans toutes les formules d\'abonnement.')}</div></div>
    <div class="panel"><h2>Rapports mensuels</h2><div class="pad">${r.monthly
      ? `<p style="margin-top:0">Un rapport par mois, à imprimer ou enregistrer en PDF pour votre direction.</p><div class="month-list">${r.months.map((m, i) => `<a class="month-item" href="#/rapports/m-${m}">${icon('file', 'sm')}<span class="grow">${esc(monthName(m))}</span>${i === 0 ? '<span class="tag">en cours</span>' : ''}${icon('chevR', 'sm')}</a>`).join('')}</div>`
      : locked('Le rapport de performance mensuel est inclus à partir de la formule Pro.')}</div></div>`;
}

function sheet(c, inner, back = '#/rapports') {
  c.innerHTML = `<div class="no-print toolbar-row"><a href="${back}" class="grow">← Rapports</a><button class="btn" data-print>${icon('download', 'sm')} Imprimer / enregistrer en PDF</button></div>
    <article class="report-sheet">${inner}</article>`;
  $('[data-print]', c).onclick = () => print();
}

const head = (s, title, sub) => `<header class="rs-head">${avatar({ id: s.id, name: s.name, avatar: s.logo }, 56)}<div class="grow"><h1>${esc(title)}</h1><div class="rs-sub">${esc(s.name)} · ${esc(sub)}</div></div><div class="rs-brand"><span class="logo"></span>Scola</div></header>`;

const figures = (t, keys) => {
  const L = { i: 'élèves ont vu votre établissement', v: 'visites de votre chaîne', u: 'visiteurs uniques', c: 'clics depuis les listes', f: 'nouveaux abonnés', k: 'élèves vous ont écrit', q: 'demandes d\'informations' };
  return `<div class="rs-figs">${['i', 'v', 'u', 'c', 'f', 'k', 'q'].filter(k => keys.includes(k)).map(k => `<div><b>${fmt(t[k])}</b><span>${L[k]}</span></div>`).join('')}</div>`;
};

function campaignsBlock(list) {
  if (!list.length) return '';
  return `<h2>Vos campagnes</h2>${list.map(x => `<p>Votre campagne <b>« ${esc(x.title)} »</b> (${esc(x.type)}) a été affichée <b>${fmt(x.i)}</b> fois à <b>${fmt(x.r)}</b> élèves. ${fmt(x.c)} ${pl(x.c, 'élève a', 'élèves ont')} cliqué et ${fmt(x.k)} vous ${pl(x.k, 'a', 'ont')} demandé des informations${x.costPerContact !== null ? `, soit <b>${fcfa(x.costPerContact)}</b> par contact${x.included ? ' (valeur de la campagne incluse dans votre formule)' : ''}` : ''}.</p>`).join('')}`;
}

async function monthlySheet(c, m) {
  let r;
  try { r = await X.get('/reports/monthly?m=' + encodeURIComponent(m)); } catch (e) { c.innerHTML = `<p><a href="#/rapports">← Rapports</a></p><div class="panel"><div class="pad">${locked(e.message)}</div></div>`; return; }
  const t = r.totals, p = r.previous;
  const mon = monthName(r.month), prevMon = monthName(new Date(r.from - 86400e3).toISOString().slice(0, 7));
  const dv = pct(t.u, p.u);
  const top = r.posts[0];
  const tips = [];
  if (r.postsCount < 4) tips.push('Publiez au moins une fois par semaine : les élèves suivent les chaînes actives (dates de concours, inscriptions, portes ouvertes, photos du campus).');
  if (t.i && t.u / t.i < 0.08) tips.push('Beaucoup d\'élèves voient votre nom sans ouvrir votre chaîne : soignez votre logo et la première phrase de votre présentation.');
  if (t.u && !t.q) tips.push('Aucune demande d\'informations ce mois-ci : vérifiez que vos formations et votre bloc Inscriptions sont à jour, ils donnent envie de vous écrire.');
  if (!tips.length) tips.push('Continuez ainsi : répondez rapidement aux élèves qui vous écrivent, c\'est décisif pour leur orientation.');
  sheet(c, `${head(r.school, `Rapport de ${mon}`, `formule ${r.school.plan}`)}
    <p class="rs-lead">En ${esc(mon)}, <b>${fmt(t.i)}</b> élèves ont vu votre établissement, <b>${fmt(t.u)}</b> ont visité votre chaîne et <b>${fmt(t.k)}</b> vous ont contacté${t.q ? `, dont <b>${fmt(t.q)}</b> ${pl(t.q, 'demande', 'demandes')} d'informations` : ''}.</p>
    <p>Vous avez gagné <b>${fmt(t.f)}</b> ${pl(t.f, 'abonné')}${t.x ? ` (${fmt(t.x)} ${pl(t.x, 'désabonnement')})` : ''}.${dv !== null ? ` Votre chaîne a reçu ${Math.abs(dv)} % de visiteurs ${dv >= 0 ? 'de plus' : 'de moins'} qu'en ${esc(prevMon)}.` : ''}${top ? ` Votre publication la plus lue : « ${esc(top.text)} » (${fmt(top.reach)} élèves).` : ''}</p>
    ${figures(t, ['i', 'v', 'u', 'c', 'f', 'k', 'q'])}
    <h2>Visiteurs de votre chaîne, jour par jour</h2><div data-chart></div>
    <h2>Qui s'intéresse à vous ?</h2><div class="rs-grid">${[['city', 'Par ville'], ['level', 'Par niveau'], ['domain', 'Par domaine']].map(([k, l]) => `<div><h3>${l}</h3>${barList(r.breakdown.visit[k], { threshold: r.threshold })}</div>`).join('')}</div>
    <p class="rs-note">Visiteurs comptés une fois par jour. Les catégories de moins de ${r.threshold} élèves sont regroupées : ce rapport ne contient aucune donnée individuelle.</p>
    ${campaignsBlock(r.campaigns)}
    ${r.posts.length ? `<h2>Vos publications du mois</h2><table class="rs-table"><thead><tr><th>Publication</th><th>Élèves touchés</th><th>Réactions</th><th>Réponses</th></tr></thead><tbody>${r.posts.map(x => `<tr><td>${esc(x.text)}<small>${esc(dateFr(x.createdAt))}</small></td><td>${fmt(x.reach)}</td><td>${fmt(x.reactions)}</td><td>${fmt(x.replies)}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>Nos conseils pour le mois prochain</h2><ul>${tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <footer class="rs-foot">Rapport généré le ${esc(dateFr(r.generatedAt))} par Scola · données agrégées, sans information personnelle sur les élèves.</footer>`);
  mountLine($('[data-chart]', c), { points: r.series.map(d => ({ label: new Date(d.d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), short: new Date(d.d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: d.u })), name: 'Visiteurs uniques', ariaLabel: `Visiteurs uniques par jour en ${mon}`, height: 190 });
}

async function annualSheet(c) {
  let r;
  try { r = await X.get('/reports/annual'); } catch (e) { c.innerHTML = `<p><a href="#/rapports">← Rapports</a></p><div class="panel"><div class="pad">${locked(e.message)}</div></div>`; return; }
  const t = r.totals, has = (k) => r.metrics.includes(k);
  const lead = has('i')
    ? `Depuis le ${esc(dateFr(r.from))}, <b>${fmt(t.i)}</b> élèves ont vu votre établissement, <b>${fmt(t.u)}</b> ont visité votre chaîne et <b>${fmt(t.k)}</b> vous ont contacté`
    : `Depuis le ${esc(dateFr(r.from))}, votre chaîne a été consultée <b>${fmt(t.v)}</b> fois et <b>${fmt(t.k)}</b> élèves vous ont contacté`;
  sheet(c, `${head(r.school, 'Bilan annuel', `formule ${r.plan.name}${r.plan.paidUntil ? ` jusqu'au ${dateFr(r.plan.paidUntil)}` : ''}`)}
    <p class="rs-lead">${lead}${t.q ? `, dont <b>${fmt(t.q)}</b> ${pl(t.q, 'demande', 'demandes')} d'informations` : ''}.</p>
    <p>Vous avez gagné <b>${fmt(t.f)}</b> ${pl(t.f, 'abonné')} et votre chaîne en compte aujourd'hui <b>${fmt(r.followers)}</b>.${r.best ? ` Votre meilleur mois : ${esc(monthName(r.best.m))} (${fmt(r.best.v)} visites).` : ''}
      ${r.invested ? ` Sur cette période, Scola vous a coûté <b>${fcfa(r.invested)}</b> (abonnement au prorata de la période, et campagnes)${r.costPerContact !== null ? ` : chaque élève qui vous a contacté vous a coûté environ <b>${fcfa(r.costPerContact)}</b>` : ''}.` : ''}</p>
    ${r.renewalSoon !== null && r.renewalSoon <= 60 ? `<p class="rs-callout">Votre formule arrive à échéance le <b>${esc(dateFr(r.plan.paidUntil))}</b>. Le renouvellement anticipé ne vous fait perdre aucun jour${r.school.founder ? ' et conserve votre tarif Partenaire Fondateur' : ''}.</p>` : ''}
    ${figures(t, r.metrics)}
    <h2>Visites de votre chaîne, mois par mois</h2><div data-chart></div>
    ${campaignsBlock(r.campaigns)}
    <footer class="rs-foot">Bilan généré le ${esc(dateFr(r.generatedAt))} par Scola · données agrégées, sans information personnelle sur les élèves. Un élève revenu plusieurs jours est compté chaque jour.</footer>`);
  mountLine($('[data-chart]', c), { points: r.months.map(x => ({ label: monthName(x.m), short: new Date(x.m + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'short' }), v: x.v })), name: 'Visites', ariaLabel: 'Visites de la chaîne par mois', height: 190 });
}
