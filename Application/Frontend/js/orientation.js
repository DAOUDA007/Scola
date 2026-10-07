// Onglet Orientation : chaînes des établissements (équivalent des chaînes WhatsApp).
// Suivre, lire, réagir, répondre / contacter un établissement, découvrir de nouvelles écoles.
import { $, h, esc, icon, avatar, listTime, fullDate, formatText, fold, debounce, copyText, fileSize, extOf, docKind, hhmm, dayLabel, pickFiles } from './util.js';
import { get, post, patch, del, upload } from './api.js';
import { S, emit, on, chatTitle, chatEntity } from './state.js';
import { toast, fail, ctxMenu, modal, confirmBox, choose, pushPage, placeAt, sound, banner } from './ui.js';
import { nav } from './nav.js';
import { live } from './chatlist.js';
import { openViewer } from './media.js';
import { QUICK } from './emoji.js';

export const O = { following: [], suggestions: [], inquiries: [], types: {}, loaded: false };
let panel = null; // { kind: 'channel' | 'inquiry', id, posts, root }

export async function loadOrientation() {
  try { Object.assign(O, await get('/orientation'), { loaded: true }); emit('orientation'); } catch {}
}

export function unreadTotal() {
  return O.following.reduce((n, c) => n + (c.muted ? 0 : c.unread || 0), 0) + O.inquiries.reduce((n, q) => n + (q.unread || 0), 0);
}

const logo = (c, size = 49) => avatar({ id: c.id, name: c.name, avatar: c.logo }, size);
const badgeV = (c) => (c.verified ? `<span class="verified" title="Établissement certifié par Scola">${icon('check', 'xs')}</span>` : '');
const followersTxt = (n) => `${n.toLocaleString('fr-FR')} abonné${n > 1 ? 's' : ''}`;

/* ---------------- Onglet ---------------- */
export function render(side) {
  side.innerHTML = `<div class="panel-head"><h1>Orientation</h1>
      <button class="icon-btn" data-discover title="Découvrir des établissements">${icon('search')}</button>
      <button class="icon-btn" data-menu title="Menu">${icon('more')}</button></div>
    <div class="list scroll" data-list></div>`;
  const list = $('[data-list]', side);
  const draw = () => {
    const inq = O.inquiries;
    list.innerHTML = `
      ${O.following.length ? `<div class="section-title">Établissements suivis</div>${O.following.map(c => `
        <div class="item" data-channel="${c.id}"><div class="av-wrap">${logo(c)}</div>
          <div class="body"><div class="top"><span class="name">${esc(c.name)}${badgeV(c)}</span><span class="time">${c.last ? listTime(c.last.createdAt) : ''}</span></div>
          <div class="bot"><span class="prev">${c.last ? (c.last.type !== 'text' ? icon(c.last.type === 'document' ? 'file' : c.last.type === 'video' ? 'video' : 'image', 'xs') : '') + `<span>${esc(c.last.preview || '')}</span>` : `<span>${esc(followersTxt(c.followers))}</span>`}</span>
          <span class="icons">${c.muted ? icon('bellOff', 'sm') : ''}${c.unread ? `<span class="badge ${c.muted ? 'grey' : ''}">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</span></div></div></div>`).join('')}`
      : `<div class="ori-empty">${icon('cap')}<b>Suivez des établissements</b><span>Découvrez les écoles et universités, leurs actualités, concours et inscriptions, et contactez-les pour votre orientation.</span></div>`}
      ${inq.length ? `<div class="section-title">Mes échanges avec les établissements</div>${inq.map(q => `
        <div class="item compact" data-inquiry="${q.schoolId}">${avatar({ id: q.schoolId, name: q.school?.name, avatar: q.school?.logo }, 42)}
          <div class="body"><div class="top"><span class="name">${esc(q.school?.name || 'Établissement')}</span><span class="time">${listTime(q.updatedAt)}</span></div>
          <div class="bot"><span class="prev"><span>${q.last ? (q.last.from === 'student' ? 'Vous : ' : '') + esc(q.last.text) : ''}</span></span>${q.unread ? `<span class="badge">${q.unread}</span>` : ''}</div></div></div>`).join('')}` : ''}
      <div class="section-title">Découvrir des établissements</div>
      ${O.suggestions.length ? O.suggestions.slice(0, 8).map(suggestion).join('') + `<div class="menu-row" data-discover><div class="txt" style="color:var(--brand-strong);font-weight:600">Voir tous les établissements</div></div>`
        : '<div class="empty" style="padding:16px 24px">Aucun autre établissement pour le moment.</div>'}
      <div class="empty" style="font-size:12.5px">${icon('lock', 'xs')} Les établissements ne voient jamais votre numéro de téléphone.<br>Vous représentez un établissement ? <a href="/etablissement/" target="_blank">Créez votre chaîne</a>.</div>`;
  };
  if (!O.loaded) loadOrientation();
  draw();
  live(side, 'orientation', draw);
  side.querySelector('[data-menu]').onclick = (e) => ctxMenu(e.currentTarget, [
    { icon: 'search', label: 'Découvrir des établissements', onClick: () => discover(side) },
    { icon: 'refresh', label: 'Actualiser', onClick: loadOrientation },
    { icon: 'ext', label: 'Espace établissement', onClick: () => open('/etablissement/', '_blank') },
  ]);
  side.addEventListener('click', (e) => {
    if (e.target.closest('[data-discover]')) return discover(side);
    const f = e.target.closest('[data-follow]');
    if (f) { e.stopPropagation(); return follow(f.dataset.follow); }
    const c = e.target.closest('[data-channel]');
    if (c) return openChannel(c.dataset.channel);
    const q = e.target.closest('[data-inquiry]');
    if (q) return openInquiry(q.dataset.inquiry);
  });
}

function suggestion(c) {
  return `<div class="item compact" data-channel="${c.id}">${logo(c, 44)}
    <div class="body"><div class="top"><span class="name">${esc(c.name)}${badgeV(c)}</span></div>
    <div class="bot"><span class="prev"><span>${esc(c.typeLabel)} · ${esc(c.city || c.country || '')} · ${esc(followersTxt(c.followers))}</span></span></div></div>
    <button class="btn ${c.following ? 'ghost' : ''} ori-follow" data-follow="${c.id}">${c.following ? 'Suivi' : 'Suivre'}</button></div>`;
}

function discover(side) {
  pushPage(side, {
    title: 'Découvrir des établissements',
    render: (body) => {
      let type = '';
      body.innerHTML = `<div class="search-bar" style="padding:10px 12px"><div class="search-box">${icon('search', 'sm')}<input placeholder="Nom, ville, filière…" data-q></div></div>
        <div class="filters"><button class="chip on" data-t="">Tous</button>${Object.entries(O.types || {}).map(([k, l]) => `<button class="chip" data-t="${k}">${esc(l)}</button>`).join('')}</div>
        <div data-r><div class="empty">Chargement…</div></div>`;
      const run = debounce(async () => {
        try {
          const list = await get(`/orientation/channels?q=${encodeURIComponent($('[data-q]', body).value)}&type=${type}`);
          $('[data-r]', body).innerHTML = list.map(suggestion).join('') || `<div class="empty">${icon('search')}Aucun établissement trouvé.</div>`;
        } catch (e) { fail(e); }
      }, 250);
      $('[data-q]', body).oninput = run;
      body.addEventListener('click', (e) => {
        const t = e.target.closest('[data-t]');
        if (t) { type = t.dataset.t; body.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === t)); run(); }
        const f = e.target.closest('[data-follow]');
        if (f) { e.stopPropagation(); follow(f.dataset.follow).then(run); return; }
        const c = e.target.closest('[data-channel]');
        if (c && !t) openChannel(c.dataset.channel);
      });
      run();
    },
  });
}

async function follow(id, on = true) {
  try {
    if (on) { await post(`/orientation/channels/${id}/follow`); toast('Établissement suivi'); }
    else { await del(`/orientation/channels/${id}/follow`); toast('Vous ne suivez plus cet établissement'); }
    await loadOrientation();
    if (panel?.kind === 'channel' && panel.id === id) openChannel(id, { keepScroll: true });
  } catch (e) { fail(e); }
}

/* ---------------- Panneau principal (chaîne ou échange) ---------------- */
function openPanel(kind, id) {
  if (S.current) nav.closeChat(true);
  const mobile = innerWidth <= 900;
  if (mobile && !panel && !history.state?.panel) history.pushState({ panel: kind }, '');
  panel = { kind, id, posts: [] };
  nav.els.app.classList.add('chat-open');
  nav.closeDrawer();
}
export function closePanel(fromPop = false) {
  if (!panel) return;
  if (!fromPop && innerWidth <= 900 && history.state?.panel) return history.back();
  panel = null;
  nav.els.app.classList.remove('chat-open');
  nav.closeDrawer();
  import('./conversation.js').then(m => m.renderEmpty());
}
nav.closePanel = closePanel;
nav.resetPanel = () => { panel = null; };
nav.hasPanel = () => !!panel;
nav.openChannel = (id, opts) => openChannel(id, opts);
nav.openInquiry = (id) => openInquiry(id);

export async function openChannel(id, { post: postId, keepScroll } = {}) {
  let c;
  try { c = await get('/orientation/channels/' + id); } catch (e) { return fail(e); }
  openPanel('channel', id);
  panel.channel = c;
  const root = h(`<div class="conv col ori-channel" style="height:100%;position:relative">
    <header class="conv-head">
      <button class="icon-btn back" data-back title="Retour">${icon('back')}</button>
      <div class="who" data-info>${logo(c, 40)}<div class="col grow"><div class="t ellipsis">${esc(c.name)}${badgeV(c)}</div><div class="s ellipsis">${esc(followersTxt(c.followers))}</div></div></div>
      ${c.following ? `<button class="icon-btn" data-mute title="${c.muted ? 'Réactiver les notifications' : 'Mode silencieux'}">${icon(c.muted ? 'bellOff' : 'bell')}</button>` : ''}
      <button class="icon-btn" data-menu title="Menu">${icon('more')}</button>
    </header>
    <div class="messages-area"><div class="wall"></div><div class="messages scroll" data-list><div class="messages-inner" data-inner><div class="sys">Chargement…</div></div></div></div>
    <div class="ori-bar">${c.following
      ? `<button class="btn ghost" data-contact>${icon('chat', 'sm')} Contacter l'établissement</button>`
      : `<button class="btn" data-follow-main>${icon('plus', 'sm')} Suivre</button>`}</div></div>`);
  panel.root = root;
  nav.els.main.innerHTML = '';
  nav.els.main.append(root);
  $('[data-back]', root).onclick = () => closePanel();
  $('[data-info]', root).onclick = () => openChannelInfo(c.id);
  $('[data-mute]', root)?.addEventListener('click', () => setMuted(c.id, !c.muted));
  $('[data-follow-main]', root)?.addEventListener('click', () => follow(c.id));
  $('[data-contact]', root)?.addEventListener('click', () => openInquiry(c.id));
  $('[data-menu]', root).onclick = (e) => channelMenu(c, e.currentTarget);
  try {
    const r = await get(`/orientation/channels/${id}/posts${postId ? '?around=' + encodeURIComponent(postId) : ''}`);
    if (panel?.id !== id) return;
    panel.posts = r.posts;
    drawPosts(postId ? { around: postId } : 'bottom');
    if (c.following) { post(`/orientation/channels/${id}/read`).catch(() => {}); const s = O.following.find(x => x.id === id); if (s) { s.unread = 0; emit('orientation'); } }
  } catch (e) { fail(e); }
  bindPosts(root);
}

function postHTML(p, c) {
  const md = p.media;
  let media = '';
  if (md && p.type === 'image') media = `<div class="post-media" data-view="${p.id}"><img src="${esc(md.url)}" alt="" loading="lazy"></div>`;
  else if (md && p.type === 'video') media = `<div class="post-media"><video src="${esc(md.url)}#t=0.1" controls preload="metadata" playsinline></video></div>`;
  else if (md) {
    const k = docKind(md.name);
    media = `<a class="doc" href="${esc(md.url)}" download="${esc(md.name)}" target="_blank" rel="noopener"><span class="ext ${k === 'pdf' ? '' : k}">${esc(extOf(md.name).slice(0, 4))}</span><span class="info"><b>${esc(md.name)}</b><small>${esc(extOf(md.name).toUpperCase())} · ${fileSize(md.size)}</small></span>${icon('download')}</a>`;
  }
  const reacts = Object.entries(p.reactions || {}).sort((a, b) => b[1] - a[1]);
  const total = reacts.reduce((n, r) => n + r[1], 0);
  return `<div class="post" data-post="${p.id}">
    ${media}
    ${p.text ? `<div class="text">${formatText(p.text)}</div>` : ''}
    <div class="post-meta">${p.editedAt ? 'Modifié · ' : ''}${hhmm(p.createdAt)} · ${icon('eye', 'xs')} ${p.views}</div>
    <div class="post-actions">
      ${total ? `<button class="post-reacts ${p.myReaction ? 'mine' : ''}" data-react="${p.id}">${reacts.slice(0, 3).map(r => r[0]).join('')} <small>${total}</small></button>` : `<button class="post-reacts none" data-react="${p.id}">${icon('smile', 'sm')}</button>`}
      <button class="post-reply" data-reply="${p.id}">${icon('reply', 'sm')} Répondre</button>
    </div></div>`;
}

function drawPosts(mode = 'keep') {
  if (!panel?.root) return;
  const inner = $('[data-inner]', panel.root), list = $('[data-list]', panel.root);
  const c = panel.channel;
  let html = `<div class="sys e2e">${icon('lock', 'xs')} Chaîne de ${esc(c.name)}. Vos réactions sont anonymes pour les autres abonnés ; l'établissement ne voit pas votre numéro.</div>`;
  let lastDay = null;
  for (const p of panel.posts) {
    const d = dayLabel(p.createdAt);
    if (d !== lastDay) { html += `<div class="day-sep">${esc(d)}</div>`; lastDay = d; }
    html += postHTML(p, c);
  }
  if (!panel.posts.length) html += `<div class="empty">${icon('megaphone')}Aucune publication pour le moment.</div>`;
  const fromBottom = list.scrollHeight - list.scrollTop;
  inner.innerHTML = html;
  if (mode === 'bottom') list.scrollTop = list.scrollHeight;
  else if (mode?.around) { const el = inner.querySelector(`[data-post="${CSS.escape(mode.around)}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); } }
  else list.scrollTop = list.scrollHeight - fromBottom;
  inner.querySelectorAll('img').forEach(img => img.complete || img.addEventListener('load', () => { if (mode === 'bottom') list.scrollTop = list.scrollHeight; }, { once: true }));
}

function bindPosts(root) {
  root.addEventListener('click', (e) => {
    if (!panel || panel.kind !== 'channel') return;
    const r = e.target.closest('[data-react]');
    if (r) return reactBar(r.dataset.react, r);
    const rep = e.target.closest('[data-reply]');
    if (rep) return openInquiry(panel.id, { postId: rep.dataset.reply });
    const v = e.target.closest('[data-view]');
    if (v) {
      const items = panel.posts.filter(p => p.type === 'image').map(p => ({ id: p.id, url: p.media.url, type: 'image', caption: p.text, createdAt: p.createdAt }));
      return openViewer(items, Math.max(0, items.findIndex(x => x.id === v.dataset.view)));
    }
  });
}

function reactBar(postId, anchor) {
  document.querySelectorAll('.react-bar').forEach(x => x.remove());
  const p = panel.posts.find(x => x.id === postId);
  const bar = h(`<div class="react-bar">${QUICK.map(e => `<button class="${p?.myReaction === e ? 'on' : ''}">${e}</button>`).join('')}</div>`);
  const close = () => { bar.remove(); removeEventListener('mousedown', out, true); };
  const out = (e) => { if (!bar.contains(e.target)) close(); };
  setTimeout(() => addEventListener('mousedown', out, true));
  bar.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    close();
    try {
      const v = await post(`/orientation/posts/${postId}/react`, { emoji: b.textContent });
      const i = panel.posts.findIndex(x => x.id === postId);
      if (i >= 0) { panel.posts[i] = v; drawPosts(); }
    } catch (er) { fail(er); }
  };
  document.body.append(bar);
  const rc = anchor.getBoundingClientRect();
  placeAt(bar, { x: rc.left, y: Math.max(8, rc.top - bar.offsetHeight - 6) });
}

async function setMuted(id, muted) {
  try {
    await patch('/orientation/channels/' + id, { muted });
    toast(muted ? 'Mode silencieux activé' : 'Notifications réactivées');
    await loadOrientation();
    if (panel?.kind === 'channel' && panel.id === id) openChannel(id);
  } catch (e) { fail(e); }
}

function shareLink(c) { return `${location.origin}/?orientation=${encodeURIComponent(c.id)}`; }

async function forwardChannel(c) {
  const chats = [...S.chats.values()].filter(x => x.type !== 'broadcast');
  const v = await choose(`Transférer « ${c.name} »`, chats.map(x => ({ value: x.id, label: chatTitle(x) })), chats[0]?.id, { okLabel: 'Envoyer' });
  if (!v) return;
  try {
    await post(`/chats/${v}/messages`, { type: 'text', text: `📢 Découvre la chaîne « ${c.name} » sur Scola Orientation : ${shareLink(c)}` });
    toast('Chaîne transférée');
  } catch (e) { fail(e); }
}

async function shareChannel(c) {
  const url = shareLink(c);
  if (navigator.share) navigator.share({ title: c.name, text: `Chaîne de ${c.name} sur Scola`, url }).catch(() => {});
  else { await copyText(url); toast('Lien de la chaîne copié'); }
}

async function report(c, postId) {
  const reason = await choose(postId ? 'Signaler cette publication' : `Signaler ${c.name}`, ['Informations trompeuses', 'Arnaque / frais suspects', 'Contenu inapproprié', 'Spam', 'Usurpation d\'identité', 'Autre'].map(x => ({ value: x, label: x })), 'Informations trompeuses', { okLabel: 'Signaler', note: 'Le signalement est transmis à l\'administration de Scola.' });
  if (!reason) return;
  try { await post(`/orientation/channels/${c.id}/report`, { reason, postId }); toast('Signalement envoyé à l\'administration'); } catch (e) { fail(e); }
}

function channelMenu(c, anchor) {
  ctxMenu(anchor, [
    { icon: 'info', label: 'Infos de la chaîne', onClick: () => openChannelInfo(c.id) },
    { icon: 'chat', label: 'Contacter l\'établissement', onClick: () => openInquiry(c.id) },
    { icon: 'forward', label: 'Transférer', onClick: () => forwardChannel(c) },
    { icon: 'share', label: 'Partager', onClick: () => shareChannel(c) },
    c.following && { icon: c.muted ? 'bell' : 'bellOff', label: c.muted ? 'Réactiver les notifications' : 'Mode silencieux', onClick: () => setMuted(c.id, !c.muted) },
    '-',
    c.following ? { icon: 'logout', label: 'Ne plus suivre la chaîne', danger: true, onClick: async () => { if (await confirmBox(`Ne plus suivre ${c.name} ?`, 'Vous ne recevrez plus ses publications.', { ok: 'Ne plus suivre', danger: true })) follow(c.id, false); } }
      : { icon: 'plus', label: 'Suivre la chaîne', onClick: () => follow(c.id) },
    { icon: 'flag', label: 'Signaler la chaîne', danger: true, onClick: () => report(c) },
  ]);
}

/* ---------------- Infos de la chaîne (tiroir) ---------------- */
export function openChannelInfo(id) {
  nav.openDrawer({
    title: 'Infos de la chaîne',
    render: async (body) => {
      body.innerHTML = '<div class="empty">Chargement…</div>';
      let c, m;
      try { [c, m] = await Promise.all([get('/orientation/channels/' + id), get(`/orientation/channels/${id}/media`)]); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      const long = (c.description || '').length > 220;
      const media = m.media.slice(0, 10);
      const row = (ic, title, sub = '', attrs = '', cls = '') => `<div class="menu-row ${cls}" ${attrs}>${icon(ic)}<div class="txt"><span>${title}</span>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
      body.innerHTML = `
        <div class="profile-top">${logo(c, 120)}
          <h3>${esc(c.name)}${badgeV(c)}</h3>
          <p>Chaîne · ${esc(followersTxt(c.followers))}</p>
          <div class="profile-actions">
            <button data-a="follow">${icon(c.following ? 'check' : 'plus')}${c.following ? 'Suivie' : 'Suivre'}</button>
            <button data-a="forward">${icon('forward')}Transférer</button>
            <button data-a="share">${icon('share')}Partager</button>
            <button data-a="search">${icon('search')}Rechercher</button></div></div>
        <div class="card card-pad">
          <div class="ori-desc ${long ? 'clamp' : ''}" data-desc>${formatText(c.description || 'Aucune description.')}</div>
          ${long ? '<button class="btn text" data-a="more" style="padding:0;height:auto;margin-top:4px">Voir plus</button>' : ''}
          <div class="faint" style="font-size:13px;margin-top:10px">${esc(c.typeLabel)} · ${esc([c.city, c.country].filter(Boolean).join(', '))}<br>Créée le ${esc(fullDate(c.createdAt).replace(/ à .*/, ''))}</div></div>
        ${c.programs ? `<div class="card"><div class="card-title">Filières et formations</div><div class="card-pad" style="padding-top:0;white-space:pre-wrap">${esc(c.programs)}</div></div>` : ''}
        <div class="card">
          ${c.website ? row('link', `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website.replace(/^https?:\/\//, ''))}</a>`, 'Site web') : ''}
          ${c.email ? row('chat', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`, 'E-mail') : ''}
          ${c.phone ? row('phone', `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>`, 'Téléphone') : ''}
          ${c.address ? row('pin', esc(c.address), 'Adresse') : ''}
          ${row('chat', 'Contacter l\'établissement', 'Conversation privée', 'data-a="contact"')}</div>
        <div class="card"><div class="card-title" data-a="media" style="cursor:pointer"><span>Médias et liens</span><span>${m.media.length + m.docs.length + m.links.length} ${icon('chevR', 'xs')}</span></div>
          ${media.length ? `<div class="media-strip">${media.map((p, i) => p.type === 'video' ? `<div data-i="${i}"><video src="${esc(p.media.url)}#t=0.5" preload="metadata" muted></video></div>` : `<div data-i="${i}" style="background-image:url('${esc(p.media.url)}')"></div>`).join('')}</div>` : '<div class="card-pad faint" style="padding-top:0;font-size:13px">Aucun média.</div>'}</div>
        <div class="card">
          ${c.following ? `<label class="menu-row"><span style="color:var(--text-3)">${icon('bell')}</span><div class="txt"><span>Mode silencieux</span><small>Ne pas recevoir de notification pour les nouvelles publications</small></div><label class="switch"><input type="checkbox" data-muted ${c.muted ? 'checked' : ''}><span></span></label></label>` : ''}
          ${row('ext', 'Chaîne publique', 'Tous les élèves et étudiants de Scola peuvent trouver cette chaîne et voir ce qui y est partagé.')}
          ${row('lock', 'Confidentialité du profil', 'Pour cette chaîne, votre numéro de téléphone n\'est jamais communiqué à l\'établissement : il ne voit que votre nom et votre classe si vous le contactez.')}</div>
        <div class="card">
          ${c.following ? row('logout', 'Ne plus suivre la chaîne', '', 'data-a="unfollow"', 'danger') : ''}
          ${row('flag', 'Signaler la chaîne', '', 'data-a="report"', 'danger')}</div>`;
      $('[data-muted]', body)?.addEventListener('change', (e) => setMuted(c.id, e.target.checked));
      body.onclick = async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        const i = e.target.closest('[data-i]')?.dataset.i;
        if (i !== undefined) return openViewer(m.media.map(p => ({ url: p.media.url, type: p.type, caption: p.text, createdAt: p.createdAt })), Number(i));
        if (a === 'follow') return c.following ? null : follow(c.id).then(() => openChannelInfo(c.id));
        if (a === 'forward') return forwardChannel(c);
        if (a === 'share') return shareChannel(c);
        if (a === 'search') return searchPosts(c);
        if (a === 'more') { $('[data-desc]', body).classList.remove('clamp'); e.target.remove(); }
        if (a === 'contact') return openInquiry(c.id);
        if (a === 'media') return mediaPage(c, m);
        if (a === 'unfollow' && await confirmBox(`Ne plus suivre ${c.name} ?`, 'Vous ne recevrez plus ses publications.', { ok: 'Ne plus suivre', danger: true })) { await follow(c.id, false); nav.closeDrawer(); }
        if (a === 'report') report(c);
      };
    },
  });
}

function mediaPage(c, m) {
  nav.openDrawer({
    title: 'Médias et liens', stack: true,
    render: (body) => {
      let tab = 'media';
      const draw = () => {
        const list = m[tab];
        body.innerHTML = `<div class="media-tabs">${[['media', 'Médias'], ['docs', 'Documents'], ['links', 'Liens']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l} (${m[k].length})</button>`).join('')}</div>`
          + (tab === 'media' ? (list.length ? `<div class="media-grid">${list.map((p, i) => p.type === 'video' ? `<div data-i="${i}"><video src="${esc(p.media.url)}#t=0.5" preload="metadata" muted></video></div>` : `<div data-i="${i}" style="background-image:url('${esc(p.media.url)}')"></div>`).join('')}</div>` : '<div class="empty">Aucun média.</div>')
            : list.map(p => `<div class="item compact" data-post="${p.id}"><div class="body"><b style="font-size:14px">${esc(p.media?.name || '')}</b><div class="text" style="font-size:13.5px">${formatText((p.text || '').slice(0, 300))}</div><small class="faint">${listTime(p.createdAt)}</small></div></div>`).join('') || '<div class="empty">Rien pour le moment.</div>');
      };
      draw();
      body.onclick = (e) => {
        const t = e.target.closest('[data-t]');
        if (t) { tab = t.dataset.t; return draw(); }
        const i = e.target.closest('[data-i]')?.dataset.i;
        if (i !== undefined) return openViewer(m.media.map(p => ({ url: p.media.url, type: p.type, caption: p.text })), Number(i));
        const p = e.target.closest('[data-post]');
        if (p && !e.target.closest('a')) openChannel(c.id, { post: p.dataset.post });
      };
    },
  });
}

function searchPosts(c) {
  nav.openDrawer({
    title: 'Rechercher dans la chaîne', stack: true,
    render: async (body) => {
      body.innerHTML = `<div class="search-bar" style="padding:10px 14px"><div class="search-box">${icon('search', 'sm')}<input placeholder="Rechercher une publication…" data-q></div></div><div data-r></div>`;
      let all = [];
      try { all = (await get(`/orientation/channels/${c.id}/posts`)).posts; } catch {}
      const draw = () => {
        const q = fold($('[data-q]', body).value);
        const hits = q.length < 2 ? [] : [...all].reverse().filter(p => fold(p.text + ' ' + (p.media?.name || '')).includes(q));
        $('[data-r]', body).innerHTML = q.length < 2 ? '<div class="empty">Saisissez au moins 2 caractères.</div>' : hits.map(p => `<div class="item compact" data-post="${p.id}"><div class="body"><div class="top"><span class="time">${esc(fullDate(p.createdAt))}</span></div><div class="bot"><span class="prev"><span>${esc((p.text || p.media?.name || '').slice(0, 140))}</span></span></div></div></div>`).join('') || '<div class="empty">Aucune publication trouvée.</div>';
      };
      $('[data-q]', body).oninput = draw;
      draw();
      setTimeout(() => $('[data-q]', body).focus(), 50);
      body.onclick = (e) => { const p = e.target.closest('[data-post]'); if (p) { openChannel(c.id, { post: p.dataset.post }); if (innerWidth <= 900) nav.closeDrawer(); } };
    },
  });
}

/* ---------------- Échange privé avec un établissement ---------------- */
export async function openInquiry(schoolId, { postId } = {}) {
  let r;
  try { r = await get('/orientation/inquiries/with/' + schoolId); } catch (e) { return fail(e); }
  openPanel('inquiry', schoolId);
  panel.messages = r.messages;
  panel.channel = r.school;
  let quote = postId ? (await get(`/orientation/channels/${schoolId}/posts?around=${encodeURIComponent(postId)}`).then(x => x.posts.find(p => p.id === postId)).catch(() => null)) : null;
  const c = r.school;
  const root = h(`<div class="conv col" style="height:100%;position:relative">
    <header class="conv-head">
      <button class="icon-btn back" data-back title="Retour">${icon('back')}</button>
      <div class="who" data-info>${logo(c, 40)}<div class="col grow"><div class="t ellipsis">${esc(c.name)}${badgeV(c)}</div><div class="s ellipsis">Conversation privée · ${esc(c.typeLabel)}</div></div></div>
      <button class="icon-btn" data-open-channel title="Voir la chaîne">${icon('megaphone')}</button>
    </header>
    <div class="messages-area"><div class="wall"></div><div class="messages scroll" data-list><div class="messages-inner" data-inner></div></div></div>
    <div class="composer-wrap"><div data-ctx></div>
      <div class="composer"><button class="icon-btn" data-attach title="Joindre un document">${icon('clip')}</button>
        <div class="box"><textarea rows="1" data-input placeholder="Écrire à l'établissement…" maxlength="4000"></textarea></div>
        <button class="send" data-send title="Envoyer">${icon('send')}</button></div></div></div>`);
  panel.root = root;
  nav.els.main.innerHTML = '';
  nav.els.main.append(root);
  const ta = $('[data-input]', root);
  const drawCtx = () => {
    $('[data-ctx]', root).innerHTML = quote ? `<div class="ctx-bar"><div class="quote" style="--qc:var(--brand)"><div class="q"><b>Publication de ${esc(c.name)}</b><span>${esc((quote.text || quote.media?.name || '').slice(0, 160))}</span></div>${quote.type === 'image' ? `<img src="${esc(quote.media.url)}" alt="">` : ''}</div><button class="icon-btn" data-cx>${icon('x')}</button></div>` : '';
    $('[data-cx]', root)?.addEventListener('click', () => { quote = null; drawCtx(); });
  };
  drawCtx();
  drawInquiry();
  post(`/orientation/inquiries/with/${schoolId}/read`).catch(() => {});
  const q = O.inquiries.find(x => x.schoolId === schoolId);
  if (q) { q.unread = 0; emit('orientation'); }
  $('[data-back]', root).onclick = () => closePanel();
  $('[data-info]', root).onclick = () => openChannelInfo(schoolId);
  $('[data-open-channel]', root).onclick = () => openChannel(schoolId);
  const send = async (extra = {}) => {
    const text = ta.value.trim();
    if (!text && !extra.media) return;
    try {
      const res = await post(`/orientation/inquiries/with/${schoolId}/messages`, { text, postId: quote?.id, ...extra });
      ta.value = ''; ta.style.height = 'auto';
      quote = null; drawCtx();
      panel.messages.push(res.message);
      drawInquiry();
      sound.sent();
      loadOrientation();
    } catch (e) { fail(e); }
  };
  $('[data-send]', root).onclick = () => send();
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
  $('[data-attach]', root).onclick = async () => {
    const files = await pickFiles({ accept: 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt' });
    if (!files) return;
    try { toast('Envoi du fichier…'); const up = await upload(files[0]); await send({ media: up }); } catch (e) { fail(e); }
  };
  if (matchMedia('(pointer: fine)').matches) setTimeout(() => ta.focus(), 50);
}

function drawInquiry() {
  if (!panel?.root || panel.kind !== 'inquiry') return;
  const inner = $('[data-inner]', panel.root), list = $('[data-list]', panel.root);
  const c = panel.channel;
  let html = `<div class="sys e2e">${icon('lock', 'xs')} Conversation privée avec ${esc(c.name)}. L'établissement voit votre nom et votre classe, jamais votre numéro de téléphone.</div>`;
  let lastDay = null, prev = null;
  for (const m of panel.messages) {
    const d = dayLabel(m.createdAt);
    if (d !== lastDay) { html += `<div class="day-sep">${esc(d)}</div>`; lastDay = d; prev = null; }
    const mine = m.from === 'student';
    const first = !prev || prev.from !== m.from;
    const md = m.media;
    const mediaHTML = !md ? '' : /^image\//.test(md.mime) ? `<div class="media" style="max-width:280px"><img src="${esc(md.url)}" alt=""></div>`
      : `<a class="doc" href="${esc(md.url)}" download="${esc(md.name)}" target="_blank" rel="noopener"><span class="ext ${docKind(md.name) === 'pdf' ? '' : docKind(md.name)}">${esc(extOf(md.name).slice(0, 4))}</span><span class="info"><b>${esc(md.name)}</b><small>${fileSize(md.size)}</small></span>${icon('download')}</a>`;
    html += `<div class="msg ${mine ? 'out' : 'in'} ${first ? 'first' : ''}"><div class="bubble-wrap"><div class="bubble">
      ${!mine && first ? `<div class="sender" style="color:var(--brand-strong)">${esc(c.name)}</div>` : ''}
      ${m.postRef ? `<div class="quote" style="--qc:var(--brand)"><div class="q"><b>Publication de ${esc(c.name)}</b><span>${esc(m.postRef.text)}</span></div>${m.postRef.thumb ? `<img src="${esc(m.postRef.thumb)}" alt="">` : ''}</div>` : ''}
      ${mediaHTML}${m.text ? `<div class="text">${formatText(m.text)}</div>` : ''}<span class="meta"><span>${hhmm(m.createdAt)}</span></span></div></div></div>`;
    prev = m;
  }
  if (!panel.messages.length) html += `<div class="empty" style="padding:30px">Posez vos questions sur les formations, les inscriptions, les frais ou les débouchés. ${esc(c.name)} vous répondra ici.</div>`;
  inner.innerHTML = html;
  list.scrollTop = list.scrollHeight;
}

/* ---------------- Temps réel ---------------- */
export function attach(socket) {
  socket.on('orientation:post', ({ channel, post: p }) => {
    const i = O.following.findIndex(x => x.id === channel.id);
    if (i >= 0) O.following[i] = channel; else O.following.unshift(channel);
    O.following.sort((a, b) => (b.last?.createdAt || 0) - (a.last?.createdAt || 0));
    const viewing = panel?.kind === 'channel' && panel.id === channel.id && document.visibilityState === 'visible';
    if (viewing) {
      panel.posts.push(p);
      drawPosts('bottom');
      post(`/orientation/channels/${channel.id}/read`).catch(() => {});
      channel.unread = 0;
    } else if (!channel.muted && S.me?.settings?.notifications?.orientation !== false) {
      sound.message();
      if (document.visibilityState === 'visible') banner({ title: channel.name, text: channel.last?.preview || 'Nouvelle publication', entity: { id: channel.id, name: channel.name, avatar: channel.logo }, onClick: () => openChannel(channel.id, { post: p.id }) });
    }
    emit('orientation');
  });
  socket.on('orientation:update', (p) => {
    if (panel?.kind !== 'channel' || panel.id !== p.schoolId) return;
    const i = panel.posts.findIndex(x => x.id === p.id);
    if (i >= 0) { panel.posts[i] = p; drawPosts(); }
  });
  socket.on('orientation:remove', ({ schoolId, id }) => {
    if (panel?.kind === 'channel' && panel.id === schoolId) { panel.posts = panel.posts.filter(x => x.id !== id); drawPosts(); }
    loadOrientation();
  });
  socket.on('orientation:reply', ({ inquiry, message }) => {
    const i = O.inquiries.findIndex(x => x.id === inquiry.id);
    if (i >= 0) O.inquiries[i] = inquiry; else O.inquiries.unshift(inquiry);
    const viewing = panel?.kind === 'inquiry' && panel.id === inquiry.schoolId && document.visibilityState === 'visible';
    if (viewing) {
      panel.messages.push(message);
      drawInquiry();
      post(`/orientation/inquiries/with/${inquiry.schoolId}/read`).catch(() => {});
      O.inquiries.find(x => x.id === inquiry.id).unread = 0;
    } else {
      sound.message();
      if (document.visibilityState === 'visible') banner({ title: inquiry.school?.name || 'Établissement', text: message.text || '📎 Fichier', entity: { id: inquiry.schoolId, name: inquiry.school?.name, avatar: inquiry.school?.logo }, onClick: () => openInquiry(inquiry.schoolId) });
    }
    emit('orientation');
  });
}
