// Briques d'interface : toasts, modales, menus, pages empilées, sélecteur de membres, sons.
import { $, $$, h, esc, icon, avatar, fold } from './util.js';
import { S, user } from './state.js';

/* ---------- Toasts ---------- */
export function toast(msg, { error = false, action, onAction, ms = 3200 } = {}) {
  const el = h(`<div class="toast ${error ? 'err' : ''}"><span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}</div>`);
  if (action) el.querySelector('button').onclick = () => { onAction?.(); el.remove(); };
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}
export const fail = (e) => toast(e?.message || String(e), { error: true });

/* ---------- Modales ---------- */
export function modal({ title = '', body = '', wide = false, full = false, buttons = [], onClose, closable = true, flush = false }) {
  const bd = h(`<div class="backdrop"><div class="modal ${wide ? 'wide' : ''} ${full ? 'full' : ''}" role="dialog" aria-modal="true">
    ${title ? `<div class="modal-head"><h3>${esc(title)}</h3>${closable ? `<button class="icon-btn" data-x aria-label="Fermer">${icon('x')}</button>` : ''}</div>` : ''}
    <div class="modal-body ${flush ? 'flush' : ''}"></div>
    ${buttons.length ? '<div class="modal-foot"></div>' : ''}
  </div></div>`);
  const bodyEl = $('.modal-body', bd);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  let closed = false;
  const close = (v) => {
    if (closed) return;
    closed = true;
    bd.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.(v);
  };
  const onKey = (e) => { if (e.key === 'Escape' && closable && bd === $('#layer').lastElementChild) close(); };
  document.addEventListener('keydown', onKey);
  if (closable) bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
  $('[data-x]', bd)?.addEventListener('click', () => close());
  const foot = $('.modal-foot', bd);
  for (const b of buttons) {
    const btn = h(`<button class="btn ${b.cls || 'text'}">${esc(b.label)}</button>`);
    btn.onclick = async () => {
      if (!b.onClick) return close(b.value);
      btn.disabled = true;
      try { const r = await b.onClick(close, bodyEl); if (r !== false) close(b.value); }
      catch (e) { fail(e); }
      finally { btn.disabled = false; }
    };
    foot.append(btn);
  }
  $('#layer').append(bd);
  setTimeout(() => $('input:not([type=checkbox]):not([type=radio]), textarea', bodyEl)?.focus(), 30);
  return { el: bd, body: bodyEl, close };
}

export function confirmBox(title, text, { ok = 'OK', danger = false, cancel = 'Annuler' } = {}) {
  return new Promise((resolve) => {
    modal({
      title, body: `<p class="muted" style="margin:4px 0 6px">${esc(text)}</p>`,
      buttons: [{ label: cancel, value: false }, { label: ok, cls: danger ? 'text danger' : 'text', value: true }],
      onClose: (v) => resolve(!!v),
    });
  });
}

export function promptBox(title, { value = '', placeholder = '', max = 200, multiline = false, label = '', hint = '' } = {}) {
  return new Promise((resolve) => {
    const field = multiline
      ? `<textarea class="input" rows="4" maxlength="${max}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" maxlength="${max}" placeholder="${esc(placeholder)}" value="${esc(value)}">`;
    let result = null;
    const m = modal({
      title,
      body: `<div class="field">${label ? `<label>${esc(label)}</label>` : ''}${field}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`,
      buttons: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'text', onClick: (c, b) => { result = $('input,textarea', b).value; } }],
      onClose: () => resolve(result),
    });
    $('input', m.body)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = e.target.value; m.close(); } });
  });
}

export function choose(title, options, current, { okLabel = 'OK', note = '' } = {}) {
  return new Promise((resolve) => {
    const name = 'c' + Math.random().toString(36).slice(2);
    const body = (note ? `<p class="muted" style="margin:0 0 6px;font-size:14px">${esc(note)}</p>` : '') + options.map(o => `
      <label class="choice"><input type="radio" name="${name}" value="${esc(String(o.value))}" ${String(o.value) === String(current) ? 'checked' : ''}>
      <span><div>${esc(o.label)}</div>${o.desc ? `<small class="faint">${esc(o.desc)}</small>` : ''}</span></label>`).join('');
    let result = null;
    modal({
      title, body,
      buttons: [{ label: 'Annuler' }, { label: okLabel, cls: 'text', onClick: (c, b) => {
        const v = $(`input[name=${name}]:checked`, b)?.value;
        result = options.find(o => String(o.value) === v)?.value ?? null;
      } }],
      onClose: () => resolve(result),
    });
  });
}

/* ---------- Menus contextuels ---------- */
export function ctxMenu(anchor, items, { align = 'right' } = {}) {
  closeMenus();
  const menu = h('<div class="ctx" role="menu"></div>');
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { menu.append(h('<hr>')); continue; }
    const b = h(`<button class="${it.danger ? 'danger' : ''}" role="menuitem">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span></button>`);
    b.onclick = (e) => { e.stopPropagation(); closeMenus(); it.onClick?.(); };
    menu.append(b);
  }
  const bd = h('<div class="backdrop clear"></div>');
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) closeMenus(); });
  bd.addEventListener('contextmenu', (e) => { e.preventDefault(); closeMenus(); });
  bd.append(menu);
  $('#layer').append(bd);
  placeAt(menu, anchor, align);
  return menu;
}
export function closeMenus() { $$('#layer .backdrop.clear').forEach(x => x.remove()); }

export function placeAt(el, anchor, align = 'right') {
  let x, y, r;
  if (anchor instanceof Element) { r = anchor.getBoundingClientRect(); x = align === 'right' ? r.right : r.left; y = r.bottom + 4; }
  else { x = anchor.x; y = anchor.y; }
  const w = el.offsetWidth, hh = el.offsetHeight;
  if (align === 'right' && anchor instanceof Element) x -= w;
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  if (y + hh > innerHeight - 8) y = Math.max(8, (r ? r.top - hh - 4 : y - hh));
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

/* ---------- Pages empilées (panneau latéral et tiroir d'infos) ---------- */
export function pushPage(container, { title, render, actions = '', onClose, cls = '' }) {
  const page = h(`<section class="page ${cls}">
    <div class="page-head"><button class="icon-btn" data-back aria-label="Retour">${icon(container.id === 'drawer' ? 'x' : 'back')}</button><h2>${esc(title)}</h2>${actions}</div>
    <div class="page-body scroll"></div></section>`);
  const body = $('.page-body', page);
  page.close = () => {
    page.classList.add('out');
    setTimeout(() => page.remove(), 170);
    onClose?.();
  };
  page.setTitle = (t) => { $('h2', page).textContent = t; };
  $('[data-back]', page).onclick = () => page.close();
  container.append(page);
  render?.(body, page);
  return page;
}

/* ---------- Sélecteur de camarades ---------- */
export function pickMembers({ title = 'Choisir', multiple = false, exclude = [], selected = [], okLabel = 'Valider', min = 1, max = 256, extraTop = '' } = {}) {
  return new Promise((resolve) => {
    const sel = new Set(selected);
    const people = [...S.members.values()].filter(u => !u.deleted && !exclude.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const body = h(`<div>
      <div class="search-bar" style="padding:8px 16px"><div class="search-box">${icon('search', 'sm')}<input placeholder="Rechercher un camarade"></div></div>
      ${extraTop}
      <div class="list" style="max-height:52vh"></div></div>`);
    let result = null;
    const draw = (q = '') => {
      const list = $('.list', body);
      const f = fold(q);
      const shown = people.filter(u => fold(u.name).includes(f));
      list.innerHTML = shown.length ? shown.map(u => `
        <div class="item compact" data-id="${u.id}">
          ${multiple ? `<span class="check ${sel.has(u.id) ? 'on' : ''}">${sel.has(u.id) ? icon('check', 'xs') : ''}</span>` : ''}
          ${avatar(u, 42)}
          <div class="body"><div class="top"><span class="name">${esc(u.name)}</span></div>
          <div class="bot"><span class="prev">${esc(u.about || u.school || '')}</span></div></div>
        </div>`).join('') : '<div class="empty">Aucun camarade trouvé.</div>';
    };
    const m = modal({
      title, body, flush: true,
      buttons: multiple ? [{ label: 'Annuler' }, { label: okLabel, cls: 'text', onClick: () => {
        if (sel.size < min) throw new Error(`Sélectionnez au moins ${min} personne${min > 1 ? 's' : ''}.`);
        result = [...sel];
      } }] : [],
      onClose: () => resolve(result),
    });
    draw();
    $('input', body).addEventListener('input', (e) => draw(e.target.value));
    $('.list', body).addEventListener('click', (e) => {
      const it = e.target.closest('.item');
      if (!it) return;
      const id = it.dataset.id;
      if (!multiple) { result = id; m.close(); return; }
      if (sel.has(id)) sel.delete(id);
      else if (sel.size < max) sel.add(id);
      else toast(`${max} maximum.`);
      draw($('input', body).value);
      m.body.closest('.modal').querySelector('.modal-head h3').textContent = `${title}${sel.size ? ` (${sel.size})` : ''}`;
    });
  });
}

/* ---------- Sons (Web Audio, sans fichier) ---------- */
let ctx;
function ac() { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; }
function tone(freq, start, dur, vol = 0.08, type = 'sine') {
  const c = ac();
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.05);
}
let ringTimer = null;
export const sound = {
  enabled: () => S.me?.settings?.notifications?.sound !== false,
  message() { if (!this.enabled()) return; try { tone(880, 0, 0.12); tone(1320, 0.1, 0.18); } catch {} },
  sent() { if (!this.enabled()) return; try { tone(1200, 0, 0.06, 0.03); } catch {} },
  ring() {
    this.stopRing();
    const play = () => { try { [0, 0.18, 0.36].forEach((t, i) => tone(i % 2 ? 660 : 880, t, 0.16, 0.12, 'triangle')); } catch {} };
    play(); ringTimer = setInterval(play, 2200);
  },
  ringback() {
    this.stopRing();
    const play = () => { try { tone(440, 0, 1.2, 0.05); tone(480, 0, 1.2, 0.05); } catch {} };
    play(); ringTimer = setInterval(play, 3500);
  },
  stopRing() { clearInterval(ringTimer); ringTimer = null; },
  end() { try { tone(480, 0, 0.18, 0.08); tone(360, 0.2, 0.3, 0.08); } catch {} },
};
// Débloque l'audio au premier geste de l'utilisateur.
addEventListener('pointerdown', () => { try { ac(); } catch {} }, { once: true });

/* ---------- Bannière de notification interne ---------- */
const BANNER_MS = 4500;
export function banner({ title, text, entity, opts, onClick }) {
  // Une seule bannière à la fois.
  document.querySelectorAll('.banner-notif').forEach(b => b.remove());
  const el = h(`<div class="banner-notif" role="status">${avatar(entity, 42, opts)}<div class="grow"><b>${esc(title)}</b><span>${esc(text)}</span></div></div>`);
  el.dataset.until = Date.now() + BANNER_MS;
  el.onclick = () => { el.remove(); onClick?.(); };
  document.body.append(el);
  setTimeout(() => el.remove(), BANNER_MS);
}
// Les minuteries sont suspendues dans un onglet en arrière-plan : au retour,
// on retire tout de suite les bannières expirées au lieu de les laisser traîner.
function dropExpiredBanners() {
  document.querySelectorAll('.banner-notif').forEach(b => { if (Number(b.dataset.until) <= Date.now()) b.remove(); });
}
document.addEventListener('visibilitychange', dropExpiredBanners);
addEventListener('focus', dropExpiredBanners);
addEventListener('pageshow', dropExpiredBanners);

export function nameColor(id) {
  const palette = ['#e5484d', '#0e8f7e', '#2563eb', '#c2410c', '#7c3aed', '#be185d', '#0369a1', '#4d7c0f', '#b45309', '#0891b2', '#9333ea', '#15803d'];
  let x = 0;
  for (const c of String(id)) x = (x * 33 + c.charCodeAt(0)) >>> 0;
  return palette[x % palette.length];
}

export function userLabel(id) { return user(id).name; }
