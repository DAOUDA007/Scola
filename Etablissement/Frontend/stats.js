// Tableau de bord de l'établissement : des phrases et des chiffres d'abord, puis les graphiques.
// Le contenu dépend de la formule ; c'est le serveur qui décide de ce qu'il renvoie.
import { $, esc, icon, fullDate } from '/js/util.js';
import { fail } from '/js/ui.js';
import { mountLine, barList, funnel, fmt } from '/js/charts.js';
import { locked } from '/etablissement/offre.js';

let X; // { get }
export function setup(ctx) { X = ctx; }

const LABELS = {
  i: ['Élèves ayant vu votre établissement', 'eye'],
  v: ['Visites de votre chaîne', 'megaphone'],
  u: ['Visiteurs uniques', 'users'],
  c: ['Clics depuis les listes', 'ext'],
  f: ['Nouveaux abonnés', 'userPlus'],
  k: ['Élèves vous ayant écrit', 'chat'],
  q: ['Demandes d\'informations', 'info'],
};
const ORDER = ['i', 'v', 'u', 'c', 'f', 'k', 'q'];
const plural = (n, s, p = s + 's') => (n > 1 ? p : s);
const dayLbl = (d, long = false) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' });
const monLbl = (m, long = false) => new Date(m + '-15T12:00:00Z').toLocaleDateString('fr-FR', long ? { month: 'long', year: 'numeric' } : { month: 'short' });

function sentence(s) {
  const t = s.totals, d = s.period.days;
  if (s.rights.statsVisibility) {
    return `Ces ${d} derniers jours, <b>${fmt(t.i)}</b> ${plural(t.i, 'élève a vu', 'élèves ont vu')} votre établissement, <b>${fmt(t.u)}</b> ${plural(t.u, 'a visité', 'ont visité')} votre chaîne et <b>${fmt(t.k)}</b> vous ${plural(t.k, 'a contacté', 'ont contacté')}${t.q ? `, dont <b>${fmt(t.q)}</b> ${plural(t.q, 'demande', 'demandes')} d'informations` : ''}.`;
  }
  return `Ces ${d} derniers jours, votre chaîne a été consultée <b>${fmt(t.v)}</b> fois, vous avez gagné <b>${fmt(t.f)}</b> ${plural(t.f, 'abonné')} et <b>${fmt(t.k)}</b> ${plural(t.k, 'élève vous a écrit', 'élèves vous ont écrit')}${t.q ? `, dont <b>${fmt(t.q)}</b> ${plural(t.q, 'demande', 'demandes')} d'informations` : ''}.`;
}

function delta(cur, prev) {
  if (prev === undefined) return '';
  if (!prev) return cur ? '<span class="delta up">nouveau</span>' : '';
  const p = Math.round(((cur - prev) / prev) * 100);
  return `<span class="delta ${p > 0 ? 'up' : p < 0 ? 'down' : ''}" title="Par rapport à la période précédente (${fmt(prev)})">${p > 0 ? '↑' : p < 0 ? '↓' : '='} ${Math.abs(p)} %</span>`;
}

const TIPS = `<div class="panel"><h2>Conseils</h2><div class="pad" style="font-size:14px;line-height:1.7;color:var(--text-2)">• Publiez vos dates clés : concours, inscriptions, portes ouvertes.<br>• Joignez vos brochures en PDF et des photos de vos campus.<br>• Répondez vite aux élèves qui vous écrivent : c'est décisif pour leur orientation.</div></div>`;

export async function dashboard(c) {
  let days = 30, metric = 'v', span = 'days', who = 'visit';
  const load = async () => {
    const s = await X.get('/stats?days=' + days).catch(fail);
    if (!s) return;
    const r = s.rights;
    const legacy = `<div class="cards">
        <div class="stat"><small>${icon('users', 'xs')} Abonnés</small><b>${fmt(s.followers)}</b></div>
        <div class="stat"><small>${icon('megaphone', 'xs')} Publications</small><b>${fmt(s.posts)}</b></div>
        <div class="stat"><small>${icon('eye', 'xs')} Vues des publications</small><b>${fmt(s.views)}</b></div>
        <div class="stat"><small>${icon('smile', 'xs')} Réactions</small><b>${fmt(s.reactions)}</b></div>
        <div class="stat"><small>${icon('chat', 'xs')} Messages non lus</small><b>${fmt(s.unread)}</b></div></div>`;
    const maxC = Math.max(1, ...s.byCycle.map(x => x[1] || 0));
    const cycles = `<div class="panel"><h2>Vos abonnés par niveau d'études</h2><div class="pad bars">${s.byCycle.length ? s.byCycle.map(([k, n]) => `<div class="row2"><span>${esc(k)}</span><div class="track">${n ? `<div class="fill" style="width:${(n / maxC) * 100}%"></div>` : ''}</div><b>${n === null ? `<small class="faint">moins de ${s.threshold}</small>` : n}</b></div>`).join('') : '<p class="faint">Pas encore d\'abonnés. Publiez régulièrement pour vous faire connaître !</p>'}
      <p class="hint" style="margin:8px 0 0">Pour protéger la vie privée des élèves, les niveaux de moins de ${s.threshold} abonnés sont regroupés.</p></div></div>`;
    if (!r.statsBasic) {
      c.innerHTML = `${legacy}<div class="panel"><h2>Statistiques d'audience</h2><div class="pad">${locked('Vues, contacts et demandes d\'informations jour par jour, avec un résumé clair : inclus à partir de la formule Starter.')}</div></div>${cycles}${TIPS}`;
      return;
    }
    const keys = ORDER.filter(k => s.metrics.includes(k));
    const prev = s.previous?.totals;
    c.innerHTML = `
      <div class="toolbar-row"><div class="seg">${[7, 30, 90].map(d => `<button data-days="${d}" class="${d === days ? 'on' : ''}">${d} jours</button>`).join('')}</div>
        <span class="grow"></span><a class="btn ghost" href="#/rapports" style="height:34px">${icon('file', 'sm')} ${r.monthlyReport ? 'Rapports mensuels et bilan annuel' : 'Bilan annuel'}</a></div>
      <div class="panel summary"><div class="pad"><p class="big">${sentence(s)}</p>
        <p class="hint" style="margin:6px 0 0">Un élève qui revient plusieurs jours est compté chaque jour. Aucune donnée personnelle n'est conservée pour ces chiffres.</p></div></div>
      <div class="cards">${keys.map(k => `<div class="stat"><small>${icon(LABELS[k][1], 'xs')} ${LABELS[k][0]}</small><b>${fmt(s.totals[k])}</b>${prev ? delta(s.totals[k], prev[k]) : ''}</div>`).join('')}
        <div class="stat"><small>${icon('users', 'xs')} Abonnés au total</small><b>${fmt(s.followers)}</b></div></div>
      <div class="panel"><h2><span class="grow">Évolution</span>${r.statsVisibility ? `<span class="seg sm">${[['days', `${days} jours`], ['months', '12 mois']].map(([k, l]) => `<button data-span="${k}" class="${k === span ? 'on' : ''}">${l}</button>`).join('')}</span>` : ''}</h2>
        <div class="pad"><div class="seg sm" style="margin-bottom:10px">${keys.map(k => `<button data-metric="${k}" class="${k === metric ? 'on' : ''}">${LABELS[k][0]}</button>`).join('')}</div>
          <div data-chart></div>${s.previous && span === 'days' ? '<p class="hint" style="margin:6px 0 0">En pointillés : la période précédente de même durée.</p>' : ''}</div></div>
      ${s.funnel ? `<div class="panel"><h2>Du regard au contact</h2><div class="pad">${funnel(s.funnel)}</div></div>` : r.statsVisibility ? '' : ''}
      ${s.breakdown ? `<div class="panel"><h2><span class="grow">Qui s'intéresse à vous ?</span><span class="seg sm">${[['visit', 'Visiteurs'], ['contact', 'Élèves qui vous ont écrit']].map(([k, l]) => `<button data-who="${k}" class="${k === who ? 'on' : ''}">${l}</button>`).join('')}</span></h2>
        <div class="pad grid3">${[['city', 'Par ville'], ['level', 'Par niveau'], ['domain', 'Par domaine']].map(([k, l]) => `<div><h3 class="h3">${l}</h3>${barList(s.breakdown[who][k], { threshold: s.threshold })}</div>`).join('')}</div>
        <p class="hint pad" style="margin:0;padding-top:0">Les catégories de moins de ${s.threshold} élèves sont regroupées ou masquées : vous ne voyez jamais de données individuelles.</p></div>`
        : `<div class="panel"><h2>Qui s'intéresse à vous ?</h2><div class="pad">${locked('Répartition de vos visiteurs et contacts par ville, niveau et domaine de formation : inclus à partir de la formule Pro.')}</div></div>`}
      ${s.postStats ? `<div class="panel"><h2>Performance de vos publications</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Publication</th><th class="num">Élèves touchés</th><th class="num">Réactions</th><th class="num">Vue dans « À la une »</th><th class="num">Clics</th><th class="num">Réponses</th></tr></thead><tbody>
        ${s.postStats.map(p => `<tr><td><div class="ellipsis" style="max-width:340px">${p.featured ? `${icon('star', 'xs')} ` : ''}${p.admission ? '<span class="tag">Inscriptions</span> ' : ''}${esc(p.text)}</div><div class="faint" style="font-size:12px">${esc(fullDate(p.createdAt))}</div></td><td class="num">${fmt(p.reach)}</td><td class="num">${fmt(p.reactions)}</td><td class="num">${fmt(p.une)}</td><td class="num">${fmt(p.clicks)}</td><td class="num">${fmt(p.replies)}</td></tr>`).join('') || '<tr><td colspan="6" class="faint">Aucune publication.</td></tr>'}</tbody></table></div></div>
      <div class="panel"><h2>Semaine par semaine</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Semaine du</th>${['i', 'v', 'u', 'c', 'k', 'q'].map(k => `<th class="num">${LABELS[k][0]}</th>`).join('')}</tr></thead><tbody>
        ${[...s.weeks].reverse().map(w => `<tr><td>${esc(dayLbl(w.from))}</td>${['i', 'v', 'u', 'c', 'k', 'q'].map(k => `<td class="num">${fmt(w[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`
        : `<div class="panel"><h2>Visibilité détaillée</h2><div class="pad">${locked('Visiteurs uniques, clics, élèves qui ont vu votre établissement, performance de chaque publication, semaine par semaine et sur 12 mois : inclus à partir de la formule Standard.')}</div></div>`}
      ${r.statsAdvanced ? '' : (r.statsVisibility ? `<div class="panel"><h2>Analyse avancée</h2><div class="pad">${locked('Comparaison avec la période précédente et entonnoir « vu → visite → contact » : inclus dans la formule Premium.')}</div></div>` : '')}
      ${cycles}${TIPS}`;
    const draw = () => {
      const el = $('[data-chart]', c);
      if (!el) return;
      const name = LABELS[metric][0];
      if (span === 'months' && s.months) mountLine(el, { points: s.months.map(m => ({ label: monLbl(m.m, true), short: monLbl(m.m), v: m[metric] })), name, ariaLabel: `${name} sur 12 mois` });
      else mountLine(el, {
        points: s.series.map(p => ({ label: dayLbl(p.d, true), short: dayLbl(p.d), v: p[metric] })), name,
        compare: s.previous ? s.previous.series.map(p => ({ label: dayLbl(p.d), v: p[metric] })) : null,
        compareName: 'Période précédente', ariaLabel: `${name} par jour sur ${days} jours`,
      });
    };
    draw();
    c.onclick = (e) => {
      const b = e.target.closest('[data-days],[data-metric],[data-span],[data-who]');
      if (!b) return;
      if (b.dataset.days) { days = Number(b.dataset.days); return load(); }
      if (b.dataset.metric) metric = b.dataset.metric;
      if (b.dataset.span) span = b.dataset.span;
      if (b.dataset.who) { who = b.dataset.who; return load(); }
      c.querySelectorAll(`[data-${Object.keys(b.dataset)[0]}]`).forEach(x => x.classList.toggle('on', x === b));
      draw();
    };
  };
  await load();
}
