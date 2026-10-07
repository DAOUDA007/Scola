// Graphiques SVG faits main (sans bibliothèque) : courbe avec infobulle, barres horizontales,
// entonnoir. Couleurs par rôle (variables --viz-* de app.css, clair et sombre), une seule
// échelle, tableau de données lisible par les lecteurs d'écran.
import { esc } from './util.js';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR'));
export { fmt };

// Maximum de l'axe : 4 graduations entières et rondes (1, 2, 5 × 10ⁿ).
function niceMax(v) {
  const raw = Math.max(1, v / 4);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * p).find(s => s >= raw);
  return Math.max(4, Math.ceil(step) * 4);
}

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div'); tip.className = 'vz-tip'; tip.hidden = true; document.body.append(tip);
    addEventListener('scroll', () => { tip.hidden = true; document.querySelectorAll('.vz-hover.on').forEach(g => g.classList.remove('on')); }, { capture: true, passive: true });
  }
  return tip;
}

/**
 * Courbe (une série, plus éventuellement la période précédente en pointillés).
 * opts : { points: [{ label, v }], compare?: [{ label, v }], name, compareName, height, ariaLabel }
 * Le rendu mesure la largeur réelle du conteneur et se refait quand elle change.
 */
export function mountLine(el, opts) {
  const draw = () => {
    const width = Math.max(260, el.clientWidth || 600);
    el.innerHTML = lineSVG({ ...opts, width });
    bindLine(el, opts, width);
  };
  draw();
  if (el._vzObs) el._vzObs.disconnect();
  let last = el.clientWidth;
  el._vzObs = new ResizeObserver(() => { if (Math.abs(el.clientWidth - last) > 8) { last = el.clientWidth; draw(); } });
  el._vzObs.observe(el);
}

function lineSVG({ points, compare = null, name = 'Valeur', compareName = 'Période précédente', height = 220, width, ariaLabel = '' }) {
  const W = width, H = height, L = 40, R = 14, T = 14, B = 26;
  const vals = points.map(p => p.v || 0), cv = compare ? compare.map(p => p.v || 0) : [];
  const max = niceMax(Math.max(1, ...vals, ...cv));
  const n = points.length;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const grid = [0, 1, 2, 3, 4].map(k => {
    const v = (max * k) / 4, yy = y(v).toFixed(1);
    return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="${k ? 'vz-grid' : 'vz-base'}"/><text x="${L - 6}" y="${yy}" class="vz-ylab" dy="0.32em" text-anchor="end">${fmt(Math.round(v))}</text>`;
  }).join('');
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 70))));
  const xl = points.map((p, i) => (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every)
    ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="vz-xlab" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(p.short || p.label)}</text>` : '').join('');
  // Étiquette directe sélective : seulement le maximum de la période.
  let peak = 0;
  vals.forEach((v, i) => { if (v > vals[peak]) peak = i; });
  const peakLab = vals[peak] > 0 ? `<text x="${x(peak).toFixed(1)}" y="${(y(vals[peak]) - 8).toFixed(1)}" class="vz-peak" text-anchor="${peak === 0 ? 'start' : peak === n - 1 ? 'end' : 'middle'}">${fmt(vals[peak])}</text>` : '';
  const area = `${path(vals)}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const legend = compare ? `<div class="vz-legend"><span><i class="vz-key s1"></i>${esc(name)}</span><span><i class="vz-key s2"></i>${esc(compareName)}</span></div>` : '';
  const table = `<table class="vz-sr"><caption>${esc(ariaLabel || name)}</caption><tr><th>Date</th><th>${esc(name)}</th>${compare ? `<th>${esc(compareName)}</th>` : ''}</tr>${points.map((p, i) => `<tr><td>${esc(p.label)}</td><td>${fmt(p.v)}</td>${compare ? `<td>${fmt(compare[i]?.v)}</td>` : ''}</tr>`).join('')}</table>`;
  return `${legend}<svg class="vz-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel || name)}">
    ${grid}${xl}
    <path d="${area}" class="vz-area"/>
    ${compare ? `<path d="${path(cv)}" class="vz-line s2"/>` : ''}
    <path d="${path(vals)}" class="vz-line s1"/>
    ${peakLab}
    <g class="vz-hover"><line class="vz-cross" y1="${T}" y2="${H - B}" x1="0" x2="0"/>
    <circle class="vz-dot s1" r="4.5" cx="0" cy="0"/>${compare ? '<circle class="vz-dot s2" r="4.5" cx="0" cy="0"/>' : ''}</g>
    <rect class="vz-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
  </svg>${table}`;
}

function bindLine(el, { points, compare, name = 'Valeur', compareName = 'Période précédente', height = 220 }, W) {
  const svg = el.querySelector('svg');
  const hit = svg.querySelector('.vz-hit');
  const L = 40, R = 14, T = 14, B = 26, H = height;
  const vals = points.map(p => p.v || 0), cv = compare ? compare.map(p => p.v || 0) : [];
  const max = niceMax(Math.max(1, ...vals, ...cv));
  const n = points.length;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const hov = svg.querySelector('.vz-hover');
  const cross = svg.querySelector('.vz-cross'), d1 = svg.querySelector('.vz-dot.s1'), d2 = svg.querySelector('.vz-dot.s2');
  const t = tooltip();
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : ((px - L) / (W - L - R)) * (n - 1))));
    const xx = x(i);
    cross.setAttribute('x1', xx); cross.setAttribute('x2', xx);
    d1.setAttribute('cx', xx); d1.setAttribute('cy', y(vals[i]));
    if (d2) { d2.setAttribute('cx', xx); d2.setAttribute('cy', y(cv[i])); }
    t.innerHTML = `<div class="vz-tip-h">${esc(points[i].label)}</div><div><i class="vz-key s1"></i>${esc(name)} <b>${fmt(vals[i])}</b></div>${compare ? `<div><i class="vz-key s2"></i>${esc(compareName)}${compare[i]?.label ? ` (${esc(compare[i].label)})` : ''} <b>${fmt(cv[i])}</b></div>` : ''}`;
    t.hidden = false;
    hov.classList.add('on');
    const left = r.left + (xx / W) * r.width;
    t.style.left = Math.max(8, Math.min(left + 14, innerWidth - t.offsetWidth - 8)) + 'px';
    t.style.top = Math.max(8, r.top + (y(vals[i]) / H) * r.height - t.offsetHeight - 12) + 'px';
  };
  const out = () => { t.hidden = true; hov.classList.remove('on'); };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', out);
  addEventListener('hashchange', out, { once: true });
}

/**
 * Barres horizontales (une seule teinte). rows : [{ label, n, masked }].
 * Une valeur masquée (seuil de confidentialité) s'affiche « moins de N » sans barre.
 */
export function barList(rows, { threshold = 10, empty = 'Pas encore assez de données.' } = {}) {
  if (!rows?.length) return `<p class="faint" style="margin:0;font-size:13.5px">${esc(empty)}</p>`;
  const max = Math.max(1, ...rows.map(r => r.n || 0));
  return `<div class="vz-bars">${rows.map(r => `<div class="vz-bar-row"><span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span>
    <span class="track">${r.n ? `<span class="fill" style="width:${Math.max(2, (r.n / max) * 100)}%"></span>` : ''}</span>
    <b>${r.n === null || r.masked ? `<span class="faint" title="Masqué pour protéger la vie privée des élèves">moins de ${threshold}</span>` : fmt(r.n)}</b></div>`).join('')}</div>`;
}

/** Entonnoir vue → visite → contact : barres de largeur proportionnelle + taux de passage. */
export function funnel(steps) {
  const top = Math.max(1, steps[0]?.n || 0);
  return `<div class="vz-funnel">${steps.map((s, i) => {
    const rate = i && steps[i - 1].n ? Math.round((s.n / steps[i - 1].n) * 1000) / 10 : null;
    return `<div class="vz-fstep"><div class="vz-fbar" style="width:${Math.max(3, ((s.n || 0) / top) * 100)}%"></div>
      <div class="vz-ftxt"><b>${fmt(s.n)}</b> élèves ${esc(s.label)}${rate !== null ? ` <span class="faint">· ${String(rate).replace('.', ',')} % de l'étape précédente</span>` : ''}</div></div>`;
  }).join('')}</div>`;
}
