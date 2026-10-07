// Orientation (côté élève) : ville facultative, section « À la une », page officielle des
// établissements (formations, inscriptions, galerie), « Demander des informations », badges.
import { $, h, esc, icon, avatar, listTime, fullDate, formatText } from './util.js';
import { get, post, patch } from './api.js';
import { S, emit } from './state.js';
import { toast, fail, modal, choose, promptBox } from './ui.js';
import { cardHTML } from './ads.js';

let CAT = null;
export async function catalog() {
  if (!CAT) CAT = await get('/catalog').catch(() => ({ cities: [], domains: {} }));
  return CAT;
}

const dateFr = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const setMe = (me) => { S.me = { ...S.me, ...me }; S.members?.set?.(S.me.id, S.me); emit('me'); };

/* ---------------- Badges ---------------- */
// Badge « Fondateur » : étoile compacte dans les listes, libellé complet sur la chaîne.
export const founderMark = (c) => (c?.founder ? `<span class="founder-mark" title="Partenaire Fondateur de Scola">${icon('star', 'xs')}</span>` : '');
export const founderTag = (c) => (c?.founder ? `<span class="founder-tag">${icon('star', 'xs')} Partenaire Fondateur</span>` : '');

/* ---------------- Ville facultative ---------------- */
export function cityPromptHTML() {
  if (!S.me || S.me.city || S.me.cityAsked) return '';
  return `<div class="ori-city">${icon('pin')}<div class="grow"><b>Indique ta ville pour découvrir les établissements près de chez toi</b>
    <small>Facultatif. Ta ville n'est jamais montrée à ta classe ni aux établissements.</small>
    <div class="row" style="margin-top:8px"><button class="btn" data-city-set style="height:34px">Indiquer ma ville</button><button class="btn text" data-city-later style="height:34px">Plus tard</button></div></div></div>`;
}

export async function pickCity() {
  const cat = await catalog();
  const opts = [...cat.cities.map(c => ({ value: c, label: c })), { value: '__other', label: 'Autre ville…' }];
  if (S.me.city) opts.push({ value: '__none', label: 'Ne pas indiquer de ville' });
  const v = await choose('Ma ville', opts, cat.cities.includes(S.me.city) ? S.me.city : S.me.city ? '__other' : null, { okLabel: 'Enregistrer', note: 'Facultatif : elle sert seulement à te proposer des établissements proches. Ni ta classe ni les établissements ne la voient.' });
  if (v === null) return false;
  let city = v;
  if (v === '__none') city = '';
  if (v === '__other') { city = await promptBox('Ma ville', { value: cat.cities.includes(S.me.city) ? '' : S.me.city, max: 60, placeholder: 'Nom de ta ville' }); if (city === null) return false; }
  try { setMe(await patch('/me', { city })); toast(city ? `Ville enregistrée : ${city}` : 'Ville retirée'); return true; } catch (e) { fail(e); return false; }
}

export async function cityLater() {
  try { setMe(await patch('/me', { cityAsked: true })); } catch (e) { fail(e); }
}

/* ---------------- À la une ---------------- */
export function aLaUneHTML(items) {
  if (!items?.length) return '';
  return `<div class="section-title">À la une</div><div class="ori-une" data-une>${items.map((it, i) => {
    if (it.kind === 'ad') return cardHTML(it.ad, i);
    const p = it.post, c = it.channel;
    const img = p.type === 'image' && p.media ? `<div class="une-img" style="background-image:url('${esc(p.media.url)}')"></div>` : '';
    return `<div class="une-card ${it.sponsored ? 'sponsored' : ''}" data-une-i="${i}">
      ${img}<div class="une-body">
        <div class="une-head">${avatar({ id: c.id, name: c.name, avatar: c.logo }, 26)}<b class="ellipsis">${esc(c.name)}</b>${c.verified ? `<span class="verified">${icon('check', 'xs')}</span>` : ''}${founderMark(c)}</div>
        <div class="une-text">${esc(p.preview || '')}</div>
        <div class="une-foot">${it.sponsored ? `<span class="sponsor">Sponsorisé</span> · <a href="#" data-why="${i}">Pourquoi je vois ceci ?</a>` : `${p.featuredUntil ? `<span class="feat">${icon('star', 'xs')} Mis en avant</span> · ` : ''}${p.admission ? '<span class="feat">Inscriptions</span> · ' : ''}${esc(listTime(p.createdAt))}`}</div>
      </div></div>`;
  }).join('')}</div>`;
}

export function whyBox(text) {
  modal({ title: 'Pourquoi je vois ceci ?', body: `<p style="margin-top:0;line-height:1.6">${esc(text)}</p><p class="hint">Les contenus sponsorisés n'apparaissent que dans l'onglet Orientation : jamais dans ta classe, tes discussions, tes appels ni tes notifications.</p>`, buttons: [{ label: 'Compris', cls: '' }] });
}

/* ---------------- Page officielle de l'établissement ---------------- */
export function admissionsBannerHTML(c) {
  const a = c.admissions;
  if (!a || !a.open) return '';
  const until = a.deadline || a.end;
  return `<div class="ori-adm ${a.highlight ? 'hl' : ''}" data-adm>${icon('calendar', 'sm')}<span class="grow"><b>Inscriptions ouvertes</b>${until ? ` jusqu'au ${esc(dateFr(until))}` : ''}</span><span class="link">Voir les conditions ${icon('chevR', 'xs')}</span></div>`;
}

export function officialHTML(c, cycles = []) {
  const a = c.admissions;
  const cyc = (id) => cycles.find(x => x.id === id)?.label || '';
  let out = '';
  if (c.infoButton) out += `<div class="card card-pad" style="text-align:center"><button class="btn block" data-a="info">${icon('info', 'sm')} Demander des informations</button><div class="hint" style="margin-top:6px">L'établissement voit ton nom et ta classe, jamais ton numéro.</div></div>`;
  if (a) {
    out += `<div class="card ${a.highlight ? 'adm-card hl' : 'adm-card'}"><div class="card-title"><span>${icon('calendar', 'xs')} Inscriptions</span><span class="adm-state ${a.open ? 'open' : ''}">${a.open ? 'Ouvertes' : 'Fermées'}</span></div><div class="card-pad" style="padding-top:4px;font-size:14px;line-height:1.6">
      ${a.start || a.end ? `<div>Période : ${a.start ? 'du ' + esc(dateFr(a.start)) : ''} ${a.end ? 'au ' + esc(dateFr(a.end)) : ''}</div>` : ''}
      ${a.deadline ? `<div><b>Date limite de dépôt : ${esc(dateFr(a.deadline))}</b></div>` : ''}
      ${a.fees ? `<div>Frais de dossier : ${esc(a.fees)}</div>` : ''}
      ${a.conditions ? `<div style="margin-top:8px"><b>Conditions</b><div style="white-space:pre-wrap">${esc(a.conditions)}</div></div>` : ''}
      ${a.documents ? `<div style="margin-top:8px"><b>Pièces à fournir</b><ul class="adm-docs">${a.documents.split('\n').filter(x => x.trim()).map(x => `<li>${esc(x.replace(/^[-•*]\s*/, ''))}</li>`).join('')}</ul></div>` : ''}
    </div></div>`;
  }
  if (c.formations?.length) {
    out += `<div class="card"><div class="card-title"><span>Formations proposées</span><span>${c.formations.length}</span></div>${c.formations.map(f => `
      <div class="formation-row"><div class="grow"><b>${esc(f.title)}</b><small>${esc([cyc(f.cycle), f.filiere].filter(Boolean).join(' · '))}</small>
        <small>${esc([f.entryLevel && 'Entrée : ' + f.entryLevel, f.duration && 'Durée : ' + f.duration].filter(Boolean).join(' · '))}</small></div>
        ${f.fees ? `<span class="fees">${esc(f.fees)}</span>` : ''}</div>`).join('')}</div>`;
  }
  if (c.gallery?.length) {
    out += `<div class="card"><div class="card-title"><span>Photos</span><span>${c.gallery.length}</span></div><div class="media-strip">${c.gallery.map((u, i) => `<div data-g="${i}" style="background-image:url('${esc(u)}')"></div>`).join('')}</div></div>`;
  }
  return out;
}

/* ---------------- Demander des informations ---------------- */
export function infoRequest(c, { source = 'channel', adId, onSent } = {}) {
  const forms = c.formations || [];
  const body = h(`<div>
    <p class="muted" style="margin-top:0;font-size:14px">Ta demande arrive dans la messagerie de ${esc(c.name)}. L'établissement voit ton nom et ta classe, jamais ton numéro de téléphone.</p>
    <div class="field"><label>Formation qui t'intéresse</label>
      ${forms.length ? `<select class="input" data-f><option value="">— Choisir —</option>${forms.map(f => `<option value="${esc(f.id)}">${esc(f.title)}</option>`).join('')}<option value="__other">Autre / je ne sais pas encore</option></select>` : ''}
      <input class="input" data-ft maxlength="120" placeholder="Ex. BTS Informatique, Licence de droit…" ${forms.length ? 'style="display:none;margin-top:6px"' : ''}></div>
    <div class="field"><label>Ta question (facultatif)</label><textarea class="input" data-q rows="3" maxlength="2000" placeholder="Frais, conditions d'admission, débouchés, dates…"></textarea></div></div>`);
  const sel = $('[data-f]', body);
  sel?.addEventListener('change', () => { $('[data-ft]', body).style.display = sel.value === '__other' ? '' : 'none'; });
  modal({ title: 'Demander des informations', body, buttons: [{ label: 'Annuler' }, { label: 'Envoyer', cls: 'text', onClick: async () => {
    const fid = sel?.value;
    const res = await post(`/orientation/inquiries/with/${c.id}/info-request`, {
      formationId: fid && fid !== '__other' ? fid : undefined,
      formation: !fid || fid === '__other' ? $('[data-ft]', body).value : undefined,
      question: $('[data-q]', body).value, source, adId,
    });
    toast('Demande envoyée à l\'établissement');
    onSent?.(res);
  } }] });
}
