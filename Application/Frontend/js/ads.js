// Publicités des établissements, côté élève : uniquement dans l'onglet Orientation.
// Toujours marquées « Sponsorisé », avec « Pourquoi je vois ceci ? », masquer et signaler.
// Aucune lecture automatique avec le son, aucun pop-up.
import { esc, icon, avatar } from './util.js';
import { post } from './api.js';
import { toast, fail, ctxMenu, choose } from './ui.js';
import { whyBox, infoRequest, founderMark } from './orientation-plus.js';

const media = (m, big) => {
  if (!m) return '';
  if (/^video\//.test(m.mime)) return `<div class="ad-media"><video src="${esc(m.url)}#t=0.1" controls muted playsinline preload="metadata"></video></div>`;
  return `<div class="ad-media ${big ? 'big' : ''}" style="background-image:url('${esc(m.url)}')"></div>`;
};

function head(ad) {
  const s = ad.school;
  return `<div class="ad-head">${avatar({ id: s.id, name: s.name, avatar: s.logo }, 30)}<div class="grow" style="min-width:0"><b class="ellipsis">${esc(s.name)}</b>${s.verified ? `<span class="verified">${icon('check', 'xs')}</span>` : ''}${founderMark(s)}
    <div class="ad-label">Sponsorisé · <a href="#" data-ad-why>Pourquoi je vois ceci ?</a></div></div>
    <button class="icon-btn" data-ad-menu title="Options" aria-label="Options de la publicité">${icon('more', 'sm')}</button></div>`;
}

// Bannière en haut de l'onglet (une seule à la fois ; grande pour les établissements Premium).
export function bannerHTML(ad) {
  if (!ad) return '';
  return `<div class="ad ad-banner ${ad.big ? 'big' : ''}" data-ad="${esc(ad.id)}">${head(ad)}${media(ad.media, ad.big)}
    <div class="ad-body"><b>${esc(ad.title)}</b>${ad.text ? `<p>${esc(ad.text)}</p>` : ''}</div>
    <button class="btn ad-cta" data-ad-cta>${esc(ad.cta.label)}</button></div>`;
}

// Publication sponsorisée dans « À la une ».
export function cardHTML(ad, i) {
  return `<div class="une-card sponsored ad-card" data-ad="${esc(ad.id)}" data-ad-i="${i}">${ad.media && !/^video\//.test(ad.media.mime) ? `<div class="une-img" style="background-image:url('${esc(ad.media.url)}')"></div>` : ''}
    <div class="une-body"><div class="une-head">${avatar({ id: ad.school.id, name: ad.school.name, avatar: ad.school.logo }, 26)}<b class="ellipsis">${esc(ad.school.name)}</b><button class="icon-btn mini" data-ad-menu title="Options">${icon('more', 'xs')}</button></div>
      <div class="une-text"><b>${esc(ad.title)}</b>${ad.text ? ' — ' + esc(ad.text) : ''}</div>
      <button class="btn ad-cta sm" data-ad-cta>${esc(ad.cta.label)}</button>
      <div class="une-foot"><span class="sponsor">Sponsorisé</span> · <a href="#" data-ad-why>Pourquoi je vois ceci ?</a></div></div></div>`;
}

/**
 * Gère les clics sur une publicité (bannière, carte, établissement mis en tête).
 * find(id) renvoie la publicité ; openChannel / reload viennent de l'onglet Orientation.
 * Renvoie true si le clic a été traité.
 */
export function handleClick(e, { find, openChannel, reload }) {
  const el = e.target.closest('[data-ad]');
  if (!el) return false;
  const ad = find(el.dataset.ad);
  if (!ad) return false;
  e.preventDefault(); e.stopPropagation();
  if (e.target.closest('[data-ad-why]')) { whyBox(ad.why); return true; }
  if (e.target.closest('[data-ad-menu]')) { menu(ad, e.target.closest('[data-ad-menu]'), reload); return true; }
  if (e.target.closest('video')) return true;
  post(`/orientation/ads/${ad.id}/click`).catch(() => {});
  const k = ad.cta.kind;
  if (k === 'info' && ad.school.infoButton) infoRequest({ id: ad.school.id, name: ad.school.name, formations: ad.school.formations }, { source: 'ad', adId: ad.id, onSent: () => reload?.() });
  else if (k === 'link' && ad.cta.url && (e.target.closest('[data-ad-cta]'))) open(ad.cta.url, '_blank', 'noopener');
  else openChannel(ad.school.id, { from: 'une' });
  return true;
}

function menu(ad, anchor, reload) {
  ctxMenu(anchor, [
    { icon: 'info', label: 'Pourquoi je vois ceci ?', onClick: () => whyBox(ad.why) },
    { icon: 'eye', label: 'Masquer cette publicité', onClick: async () => { try { await post(`/orientation/ads/${ad.id}/hide`); toast('Publicité masquée : vous ne la reverrez plus'); reload?.(); } catch (er) { fail(er); } } },
    { icon: 'flag', label: 'Signaler cette publicité', danger: true, onClick: () => report(ad, reload) },
  ]);
}

async function report(ad, reload) {
  const reason = await choose('Signaler cette publicité', ['Informations trompeuses', 'Arnaque / frais suspects', 'Contenu inapproprié', 'Je la vois trop souvent', 'Autre'].map(x => ({ value: x, label: x })), 'Informations trompeuses', { okLabel: 'Signaler', note: 'Le signalement est transmis à l\'administration de Scola, qui peut suspendre la campagne. La publicité est masquée pour vous.' });
  if (!reason) return;
  try { await post(`/orientation/ads/${ad.id}/report`, { reason }); toast('Signalement envoyé à l\'administration'); reload?.(); } catch (e) { fail(e); }
}
