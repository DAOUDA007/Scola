// Stickers (comme WhatsApp) : pack Scola intégré, « Mes stickers » créés à partir de photos,
// favoris et récents. Le panneau d'expressions regroupe Emojis et Stickers.
import { $, h, esc, icon, pickFiles } from './util.js';
import { post, del, upload } from './api.js';
import { S, emit } from './state.js';
import { toast, fail, modal, ctxMenu, confirmBox } from './ui.js';
import { cropImage } from './media.js';
import { emojiPanel } from './emoji.js';

export const PACK = [
  ['bravo', 'Bravo !'], ['merci', 'Merci !'], ['on-revise', 'On révise ?'], ['devoir-fait', 'Devoir fait !'], ['courage', 'Courage !'],
  ['mdr', 'Mdr'], ['pause-cafe', 'Pause café'], ['en-retard', 'En retard !'], ['examen', 'Examen demain'], ['bonne-nuit', 'Bonne nuit'],
  ['felicitations', 'Félicitations !'], ['qui-a-le-cours', 'Qui a le cours ?'], ['on-y-va', 'On y va !'], ['present', 'Présent !'],
].map(([id, label]) => ({ url: `/stickers/${id}.svg`, label }));

const RECENT = 'scola.stickers.recent';
function recents() { try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch { return []; } }
export function pushRecent(url) {
  try { localStorage.setItem(RECENT, JSON.stringify([url, ...recents().filter(x => x !== url)].slice(0, 24))); } catch {}
}
const mine = () => S.me?.stickers || [];
const favs = () => S.me?.favStickers || [];
export const isFav = (url) => favs().includes(url);
export const isMine = (url) => mine().includes(url);
function setMe(me) { S.me = { ...S.me, ...me }; S.members.set(S.me.id, S.me); emit('me'); emit('stickers'); }

export async function toggleFav(url) {
  try { setMe(await post('/me/stickers/fav', { url, on: !isFav(url) })); toast(isFav(url) ? 'Ajouté aux favoris' : 'Retiré des favoris'); } catch (e) { fail(e); }
}
export async function saveToMine(url) {
  try { setMe(await post('/me/stickers', { url })); toast('Ajouté à vos stickers'); } catch (e) { fail(e); }
}
async function removeMine(url) {
  if (!(await confirmBox('Supprimer ce sticker ?', 'Il sera retiré de « Mes stickers » sur tous vos appareils.', { ok: 'Supprimer', danger: true }))) return;
  try { setMe(await del('/me/stickers?url=' + encodeURIComponent(url))); } catch (e) { fail(e); }
}

// Menu d'un sticker (appui long / clic droit) : favoris, enregistrer, supprimer.
export function stickerMenu(url, anchor, { onSend } = {}) {
  ctxMenu(anchor, [
    onSend && { icon: 'send', label: 'Envoyer', onClick: () => onSend(url) },
    { icon: isFav(url) ? 'starFill' : 'star', label: isFav(url) ? 'Retirer des favoris' : 'Ajouter aux favoris', onClick: () => toggleFav(url) },
    url.startsWith('/media/') && !isMine(url) && { icon: 'plus', label: 'Enregistrer dans mes stickers', onClick: () => saveToMine(url) },
    isMine(url) && { icon: 'trash', label: 'Supprimer de mes stickers', danger: true, onClick: () => removeMine(url) },
  ]);
}

/* ---------- Création d'un sticker à partir d'une photo ---------- */
function roundRect(g, x, y, w, hh, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r);
  g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

async function renderSticker(imgFile, caption) {
  const img = new Image();
  img.src = URL.createObjectURL(imgFile);
  await img.decode();
  const S2 = 512, pad = 18, r = 70;
  const c = document.createElement('canvas');
  c.width = c.height = S2;
  const g = c.getContext('2d');
  // Contour blanc « découpé » + ombre légère, comme un vrai sticker.
  g.save();
  g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 14; g.shadowOffsetY = 4;
  roundRect(g, pad, pad, S2 - pad * 2, S2 - pad * 2, r);
  g.fillStyle = '#fff'; g.fill();
  g.restore();
  g.save();
  roundRect(g, pad + 14, pad + 14, S2 - (pad + 14) * 2, S2 - (pad + 14) * 2, r - 12);
  g.clip();
  g.drawImage(img, pad + 14, pad + 14, S2 - (pad + 14) * 2, S2 - (pad + 14) * 2);
  g.restore();
  URL.revokeObjectURL(img.src);
  if (caption) {
    let fs = 64;
    g.font = `900 ${fs}px "Segoe UI", Roboto, Arial, sans-serif`;
    while (g.measureText(caption).width > S2 - 90 && fs > 28) { fs -= 2; g.font = `900 ${fs}px "Segoe UI", Roboto, Arial, sans-serif`; }
    g.textAlign = 'center'; g.lineJoin = 'round';
    g.lineWidth = Math.max(8, fs / 5); g.strokeStyle = '#000';
    g.strokeText(caption, S2 / 2, S2 - 62);
    g.fillStyle = '#fff';
    g.fillText(caption, S2 / 2, S2 - 62);
  }
  let blob = await new Promise(res => c.toBlob(res, 'image/webp', 0.9));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise(res => c.toBlob(res, 'image/png'));
  const ext = blob.type === 'image/webp' ? 'webp' : 'png';
  return new File([blob], `sticker.${ext}`, { type: blob.type });
}

export async function createSticker() {
  const files = await pickFiles({ accept: 'image/*' });
  if (!files) return null;
  const cropped = await cropImage(files[0], { title: 'Créer un sticker', shape: 'square', size: 512, okLabel: 'Suivant' });
  if (!cropped) return null;
  // Texte facultatif, avec aperçu en direct.
  const body = h(`<div><div class="sticker-preview"><img alt=""></div>
    <div class="field" style="margin-top:12px"><label>Texte (facultatif)</label><input class="input" maxlength="24" placeholder="Ex. Trop fort !"></div></div>`);
  const preview = $('img', body), inp = $('input', body);
  let last = null;
  const refresh = async () => { last = await renderSticker(cropped, inp.value.trim()); preview.src = URL.createObjectURL(last); };
  await refresh();
  let t;
  inp.oninput = () => { clearTimeout(t); t = setTimeout(refresh, 200); };
  let url = null;
  await new Promise((resolve) => modal({
    title: 'Créer un sticker', body,
    buttons: [{ label: 'Annuler' }, { label: 'Créer', cls: '', onClick: async () => {
      await refresh();
      const up = await upload(last);
      setMe(await post('/me/stickers', { url: up.url }));
      url = up.url;
      toast('Sticker créé — retrouvez-le dans « Mes stickers »');
    } }],
    onClose: resolve,
  }));
  return url;
}

/* ---------- Panneau des stickers ---------- */
export function stickerPanel(onSend) {
  let tab = recents().length ? 'recent' : 'pack';
  const el = h(`<div class="sticker-panel">
    <div class="sticker-grid" data-grid></div>
    <div class="sticker-tabs">
      <button data-t="recent" title="Récents">${icon('clock')}</button>
      <button data-t="fav" title="Favoris">${icon('star')}</button>
      <button data-t="mine" title="Mes stickers">${icon('user')}</button>
      <button data-t="pack" title="Pack Scola"><img src="/stickers/bravo.svg" alt=""></button>
    </div></div>`);
  const draw = () => {
    if (!el.isConnected && el.dataset.drawn) return;
    el.dataset.drawn = '1';
    el.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    const lists = { recent: recents(), fav: favs(), mine: mine(), pack: PACK.map(p => p.url) };
    const list = lists[tab];
    const label = (u) => PACK.find(p => p.url === u)?.label || 'Sticker';
    const empty = { recent: 'Les stickers que vous envoyez apparaîtront ici.', fav: 'Maintenez un sticker appuyé puis « Ajouter aux favoris ».', mine: 'Créez vos propres stickers à partir de vos photos.', pack: '' }[tab];
    $('[data-grid]', el).innerHTML = `<button class="sticker-create" data-create>${icon('edit')}<span>Créer un sticker</span></button>`
      + list.map(u => `<button class="sticker-item" data-url="${esc(u)}" title="${esc(label(u))}"><img src="${esc(u)}" alt="${esc(label(u))}" loading="lazy"></button>`).join('')
      + (list.length ? '' : `<p class="sticker-empty">${esc(empty)}</p>`);
  };
  const send = (url) => { pushRecent(url); onSend(url); };
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-t]');
    if (t) { tab = t.dataset.t; return draw(); }
    if (e.target.closest('[data-create]')) {
      const url = await createSticker();
      if (url) { tab = 'mine'; draw(); }
      return;
    }
    const it = e.target.closest('[data-url]');
    if (it) send(it.dataset.url);
  });
  el.addEventListener('contextmenu', (e) => {
    const it = e.target.closest('[data-url]');
    if (!it) return;
    e.preventDefault();
    stickerMenu(it.dataset.url, { x: e.clientX, y: e.clientY }, { onSend: send });
  });
  let press;
  el.addEventListener('touchstart', (e) => {
    const it = e.target.closest('[data-url]');
    if (!it) return;
    const p = e.touches[0];
    press = setTimeout(() => { press = null; navigator.vibrate?.(20); stickerMenu(it.dataset.url, { x: p.clientX, y: p.clientY }, { onSend: send }); }, 500);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(ev => el.addEventListener(ev, (e) => { if (press === null && ev === 'touchend') e.preventDefault(); clearTimeout(press); }));
  draw();
  el.redraw = draw;
  return el;
}

// Panneau d'expressions : onglets Emojis / Stickers + bouton « Créer un sticker ».
export function expressionPanel({ onEmoji, onSticker }) {
  const el = h(`<div class="expr-panel">
    <div class="expr-head"><div class="seg"><button data-p="emoji" class="on" title="Emojis">${icon('smile')}</button><button data-p="sticker" title="Stickers">${icon('sticker')}</button></div>
      <button class="icon-btn" data-new title="Créer un sticker">${icon('edit', 'sm')}</button></div>
    <div data-body></div></div>`);
  const emo = emojiPanel(onEmoji);
  const stk = stickerPanel(onSticker);
  $('[data-body]', el).append(emo, stk);
  stk.hidden = true;
  el.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-p]');
    if (p) {
      el.querySelectorAll('[data-p]').forEach(b => b.classList.toggle('on', b === p));
      emo.hidden = p.dataset.p !== 'emoji';
      stk.hidden = p.dataset.p !== 'sticker';
      if (!stk.hidden) stk.redraw();
      try { localStorage.setItem('scola.expr.tab', p.dataset.p); } catch {}
    }
    if (e.target.closest('[data-new]')) {
      const url = await createSticker();
      if (url) { el.querySelector('[data-p=sticker]').click(); }
    }
  });
  try { if (localStorage.getItem('scola.expr.tab') === 'sticker') setTimeout(() => el.querySelector('[data-p=sticker]').click()); } catch {}
  return el;
}
