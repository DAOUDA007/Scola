// Onglet Discussions : liste, filtres, recherche, archives et actions sur les discussions.
import { $, h, esc, icon, avatar, listTime, fold, debounce, formatText, hhmm, morph } from './util.js';
import { get, post, patch, del } from './api.js';
import { S, on, emit, user, chatTitle, chatEntity, isMuted, preview, sortedChats, draft, displayName } from './state.js';
import { toast, fail, ctxMenu, confirmBox, choose, pickMembers, pushPage, promptBox, modal, touchActive } from './ui.js';
import { nav } from './nav.js';
import * as INB from './inbox.js';
import { pushSupported, enablePush } from './push.js';

let filter = 'all';

/* Abonnement automatiquement libéré quand l'élément quitte le DOM. */
export function live(el, ev, fn) {
  const off = on(ev, (d) => { if (!el.isConnected) return off(); fn(d); });
  return off;
}

export function tickIcon(status) {
  if (status === 'pending') return `<span class="tick">${icon('clock', 'xs')}</span>`;
  if (status === 'read') return `<span class="tick read">${icon('check2', 'sm')}</span>`;
  if (status === 'delivered') return `<span class="tick">${icon('check2', 'sm')}</span>`;
  return `<span class="tick">${icon('check', 'sm')}</span>`;
}

export function typingText(chatId) {
  const map = S.typing.get(chatId);
  if (!map || !map.size) return '';
  const chat = S.chats.get(chatId);
  const entries = [...map.entries()];
  const rec = entries.some(([, v]) => v.state === 'recording');
  if (chat?.type === 'dm') return rec ? 'enregistre un vocal…' : 'écrit…';
  const names = entries.map(([id]) => user(id).name.split(' ')[0]);
  const verb = rec ? 'enregistre' : 'écrit';
  return names.length === 1 ? `${names[0]} ${verb}…` : `${names.length} personnes écrivent…`;
}

export function chatItem(chat, { active = false } = {}) {
  const ent = chatEntity(chat);
  const title = chatTitle(chat);
  const st = chat.state || {};
  const m = chat.last;
  const typing = typingText(chat.id);
  const dr = S.current !== chat.id && draft(chat.id);
  let prev = '';
  if (typing) prev = `<span class="typing">${esc(typing)}</span>`;
  else if (dr) prev = `<span class="draft">Brouillon :</span> <span>${esc(dr)}</span>`;
  else if (m) {
    const mine = m.senderId === S.me.id && m.type !== 'system';
    const who = chat.type === 'group' && m.senderId && m.type !== 'system' && !m.deleted ? `${esc(mine ? 'Vous' : user(m.senderId).name.split(' ')[0])} : ` : '';
    prev = `${mine && !m.deleted ? tickIcon(m.status) : ''}${m.deleted ? icon('ban', 'xs') : ''}<span>${who}${esc(preview(m))}</span>`;
  } else if (chat.type === 'group') prev = `<span>${S.cls?.memberCount || 0} membres</span>`;
  const unread = chat.unread || (st.markedUnread ? 1 : 0);
  const muted = isMuted(chat);
  const showDot = st.markedUnread && !chat.unread;
  return `<div class="item ${active ? 'on' : ''} ${unread ? 'unread' : ''}" data-chat="${chat.id}">
    <div class="av-wrap">${avatar(ent, 49, { group: chat.type === 'group', broadcast: chat.type === 'broadcast' })}</div>
    <div class="body">
      <div class="top"><span class="name">${esc(title)}</span><span class="time">${listTime(m?.createdAt || chat.createdAt)}</span></div>
      <div class="bot"><span class="prev">${prev}</span>
        <span class="icons">${chat.disappearing ? icon('timer', 'xs') : ''}${muted ? icon('bellOff', 'sm') : ''}${chat.mentioned ? `<span class="badge">@</span>` : ''}${st.pinned ? icon('thumbtack', 'sm') : ''}${unread ? `<span class="badge ${muted ? 'grey' : ''}">${showDot ? '' : chat.unread > 999 ? '999+' : chat.unread}</span>` : ''}</span>
      </div>
    </div>
    <button class="icon-btn more" data-more aria-label="Options">${icon('chevD', 'sm')}</button>
  </div>`;
}

/* ---------------- Rendu de l'onglet ---------------- */
export function render(side) {
  side.innerHTML = `
    <div class="panel-head"><h1>Discussions</h1>
      <button class="icon-btn inbox-btn" data-inbox title="Annonces de l'administration" aria-label="Annonces">${icon('megaphone')}<span data-inbox-badge></span></button>
      <button class="icon-btn" data-new title="Nouvelle discussion">${icon('edit')}</button>
      <button class="icon-btn" data-menu title="Menu">${icon('more')}</button></div>
    <div class="search-bar"><div class="search-box">${icon('search', 'sm')}<input type="search" placeholder="Rechercher ou démarrer une discussion" data-q></div></div>
    <div class="filters">
      ${[['all', 'Toutes'], ['unread', 'Non lues'], ['fav', 'Favoris'], ['groups', 'Groupe'], ['broadcast', 'Diffusions']].map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
    </div>
    <div data-pushcard></div>
    <div class="list scroll" data-list></div>`;
  const list = $('[data-list]', side);
  drawPushCard($('[data-pushcard]', side));
  live(side, 'push', () => drawPushCard($('[data-pushcard]', side)));
  const q = $('[data-q]', side);
  const draw = () => drawList(list, q.value.trim());
  draw();
  live(side, 'chats', draw);
  live(side, 'typing', draw);
  live(side, 'members', draw);
  live(side, 'class', draw);
  live(side, 'presence', draw);
  live(side, 'current', draw);
  q.addEventListener('input', debounce(draw, 120));
  side.querySelector('.filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    side.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b));
    draw();
  });
  bindList(list);
  $('[data-new]', side).onclick = () => newChatPage(side);
  // Boîte « Annonces » : compteur de non-lus et ouverture.
  const drawInbox = () => { $('[data-inbox-badge]', side).innerHTML = INB.badgeHTML(); };
  drawInbox();
  live(side, 'inbox', drawInbox);
  $('[data-inbox]', side).onclick = () => INB.openInbox(side);
  nav.openInbox = () => INB.openInbox(side);
  $('[data-menu]', side).onclick = (e) => ctxMenu(e.currentTarget, [
    { icon: 'megaphone', label: 'Nouvelle liste de diffusion', onClick: () => newBroadcast() },
    { icon: 'star', label: 'Messages importants', onClick: () => openStarred(side) },
    { icon: 'archive', label: 'Discussions archivées', onClick: () => openArchived(side) },
    { icon: 'checkSq', label: 'Tout marquer comme lu', onClick: markAllRead },
    { icon: 'laptop', label: 'Appareils connectés', onClick: () => { nav.setTab('settings'); import('./settings.js').then(m => m.openDevices()); } },
    '-',
    { icon: 'settings', label: 'Paramètres', onClick: () => nav.setTab('settings') },
    { icon: 'logout', label: 'Se déconnecter', danger: true, onClick: async () => { if (await confirmBox('Se déconnecter ?', 'Vous pourrez vous reconnecter avec votre numéro.', { ok: 'Se déconnecter', danger: true })) nav.logout(); } },
  ]);
}

/* Invitation à activer les notifications (comme WhatsApp Web), masquable 3 jours. */
const PUSH_LATER = 'scola.push.later';
function drawPushCard(box) {
  if (!box) return;
  let later = 0;
  try { later = Number(localStorage.getItem(PUSH_LATER)) || 0; } catch {}
  const show = pushSupported() && Notification.permission === 'default' && Date.now() > later;
  box.innerHTML = show ? `<div class="push-card">
    <span class="av" style="--s:44px;background:var(--brand)">${icon('bellOff')}</span>
    <div class="grow"><b>Activer les notifications</b><small>Soyez prévenu des nouveaux messages, même quand Scola est fermé.</small>
      <div class="row" style="gap:6px;margin-top:6px"><button class="btn" data-on style="height:32px;padding:0 14px">Activer</button><button class="btn text" data-later style="height:32px">Plus tard</button></div></div></div>` : '';
  if (!show) return;
  $('[data-on]', box).onclick = async () => {
    const r = await enablePush().catch((e) => { fail(e); return null; });
    if (r === 'granted') toast('Notifications activées sur cet appareil');
    else if (r === 'denied') toast('Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site.', { ms: 6000 });
    drawPushCard(box);
  };
  $('[data-later]', box).onclick = () => { try { localStorage.setItem(PUSH_LATER, Date.now() + 3 * 86400e3); } catch {} drawPushCard(box); };
}

let searchSeq = 0;
function drawList(list, q) {
  const all = sortedChats();
  const archived = all.filter(c => c.state?.archived);
  if (q) return drawSearch(list, q, all);
  let chats = all.filter(c => !c.state?.archived);
  if (filter === 'unread') chats = chats.filter(c => c.unread || c.state?.markedUnread);
  if (filter === 'fav') chats = chats.filter(c => c.state?.favorite);
  if (filter === 'groups') chats = chats.filter(c => c.type === 'group');
  if (filter === 'broadcast') chats = chats.filter(c => c.type === 'broadcast');
  const unreadArch = archived.filter(c => c.unread).length;
  morph(list, (archived.length && filter === 'all' ? `<div class="archived-row" data-archived data-key="archived">${icon('archive')}<span class="grow">Archivées</span>${unreadArch ? `<span class="faint" style="color:var(--badge);font-weight:600">${unreadArch}</span>` : `<span class="faint">${archived.length}</span>`}</div>` : '')
    + (chats.map(c => chatItem(c, { active: c.id === S.current })).join('') || `<div class="empty">${icon('chat')}${filter === 'all' ? 'Aucune discussion. Appuie sur ✎ pour écrire à un camarade.' : 'Aucune discussion dans ce filtre.'}</div>`)
    + `<div class="empty" data-key="foot" style="font-size:12.5px;padding:24px">${icon('lock', 'xs')} Seuls les membres de ta classe peuvent voir tes discussions.</div>`);
}

function drawSearch(list, q, all) {
  const f = fold(q);
  const chats = all.filter(c => fold(chatTitle(c)).includes(f));
  const withChat = new Set(all.filter(c => c.type === 'dm').map(c => c.peerId));
  const people = [...S.members.values()].filter(u => !u.deleted && u.id !== S.me.id && !withChat.has(u.id) && fold(u.name).includes(f)).slice(0, 30);
  list._html = null;
  list.innerHTML =(chats.length ? `<div class="section-title">Discussions</div>${chats.map(c => chatItem(c)).join('')}` : '')
    + (people.length ? `<div class="section-title">Camarades de classe</div>${people.map(u => `
      <div class="item compact" data-user="${u.id}">${avatar(u, 42)}<div class="body"><div class="top"><span class="name">${esc(u.name)}</span></div><div class="bot"><span class="prev">${esc(u.about || '')}</span></div></div></div>`).join('')}` : '')
    + '<div data-msgs></div>';
  if (f.length < 2) return;
  const my = ++searchSeq;
  get('/search?q=' + encodeURIComponent(q)).then(r => {
    if (my !== searchSeq || !list.isConnected) return;
    const box = $('[data-msgs]', list);
    if (!box) return;
    box.innerHTML = r.messages.length ? `<div class="section-title">Messages</div>` + r.messages.map(m => {
      const chat = S.chats.get(m.chatId);
      return `<div class="item compact" data-chat="${m.chatId}" data-around="${m.id}"><div class="body">
        <div class="top"><span class="name" style="font-size:15px">${esc(chatTitle(chat))}</span><span class="time">${listTime(m.createdAt)}</span></div>
        <div class="bot"><span class="prev">${m.senderId === S.me.id ? tickIcon(m.status) : ''}<span>${chat?.type === 'group' ? esc(displayName(m.senderId)) + ' : ' : ''}${highlight(preview(m), q)}</span></span></div></div></div>`;
    }).join('') : (!chats.length && !people.length ? '<div class="empty">Aucun résultat.</div>' : '');
  }).catch(() => {});
}

function highlight(text, q) {
  const t = String(text);
  const i = fold(t).indexOf(fold(q));
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + `<b style="color:var(--brand)">${esc(t.slice(i, i + q.length))}</b>` + esc(t.slice(i + q.length));
}

export function bindList(list) {
  list.addEventListener('click', async (e) => {
    if (e.target.closest('[data-archived]')) return openArchived(nav.els.side);
    const more = e.target.closest('[data-more]');
    const it = e.target.closest('.item');
    if (!it) return;
    if (more) { e.stopPropagation(); return chatMenu(S.chats.get(it.dataset.chat), more); }
    if (it.dataset.user) {
      try { const c = await post('/chats/dm/' + it.dataset.user); S.chats.set(c.id, c); nav.openChat(c.id); } catch (er) { fail(er); }
      return;
    }
    nav.openChat(it.dataset.chat, { around: it.dataset.around });
  });
  list.addEventListener('contextmenu', (e) => {
    const it = e.target.closest('.item[data-chat]');
    if (!it || it.dataset.around) return;
    e.preventDefault();
    if (touchActive()) return; // déjà ouvert par l'appui long
    chatMenu(S.chats.get(it.dataset.chat), { x: e.clientX, y: e.clientY });
  });
  let press;
  list.addEventListener('touchstart', (e) => {
    const it = e.target.closest('.item[data-chat]');
    if (!it || it.dataset.around) return;
    const t = e.touches[0];
    press = setTimeout(() => { press = null; navigator.vibrate?.(20); chatMenu(S.chats.get(it.dataset.chat), { x: t.clientX, y: t.clientY }); }, 550);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(ev => list.addEventListener(ev, () => clearTimeout(press), { passive: true }));
}

/* ---------------- Actions sur une discussion ---------------- */
async function setState(chat, body) {
  try { const s = await patch(`/chats/${chat.id}/state`, body); S.chats.set(s.id, s); emit('chats'); emit('chat:meta', s.id); }
  catch (e) { fail(e); }
}

export async function muteChat(chat) {
  if (isMuted(chat)) return setState(chat, { mutedUntil: 0 });
  const v = await choose('Mettre la discussion en sourdine ?', [
    { value: 8 * 3600e3, label: '8 heures' }, { value: 7 * 86400e3, label: '1 semaine' }, { value: -1, label: 'Toujours' },
  ], 8 * 3600e3, { note: 'Les autres membres ne verront pas que vous avez mis la discussion en sourdine.', okLabel: 'Mettre en sourdine' });
  if (v !== null) setState(chat, { mutedUntil: v === -1 ? -1 : Date.now() + v });
}

export function toggleArchive(chat) {
  setState(chat, { archived: !chat.state?.archived });
  toast(chat.state?.archived ? 'Discussion désarchivée' : 'Discussion archivée', { action: 'Annuler', onAction: () => setState(chat, { archived: !!chat.state?.archived }) });
}

export async function clearChat(chat) {
  let keep = true;
  const ok = await new Promise((resolve) => modal({
    title: 'Effacer cette discussion ?',
    body: '<p class="muted">Les messages seront supprimés de cet appareil et de vos autres appareils.</p><label class="choice"><input type="checkbox" checked data-keep> Conserver les messages importants</label>',
    buttons: [{ label: 'Annuler', value: false }, { label: 'Effacer', cls: 'text danger', value: true, onClick: (c, b) => { keep = $('[data-keep]', b).checked; } }],
    onClose: resolve,
  }));
  if (!ok) return;
  try { await post(`/chats/${chat.id}/clear`, { keepStarred: keep }); toast('Discussion effacée'); } catch (e) { fail(e); }
}

export async function deleteChat(chat) {
  if (chat.type === 'group') return toast('Le groupe de votre classe ne peut pas être supprimé ni quitté.');
  const ok = await confirmBox(chat.type === 'broadcast' ? 'Supprimer cette liste de diffusion ?' : `Supprimer la discussion avec ${chatTitle(chat)} ?`, 'Cette action est définitive sur vos appareils.', { ok: 'Supprimer', danger: true });
  if (!ok) return;
  try { await del('/chats/' + chat.id); } catch (e) { fail(e); }
}

export async function toggleBlock(uid) {
  const b = S.me.blocked.includes(uid);
  const name = user(uid).name;
  if (!b && !(await confirmBox(`Bloquer ${name} ?`, 'Cette personne ne pourra plus vous appeler ni vous envoyer de messages privés. Elle ne sera pas prévenue.', { ok: 'Bloquer', danger: true }))) return;
  try {
    S.me = { ...S.me, ...(b ? await del('/me/block/' + uid) : await post('/me/block/' + uid)) };
    emit('me'); emit('chats'); emit('chat:meta', S.current);
    toast(b ? `${name} débloqué(e)` : `${name} bloqué(e)`);
  } catch (e) { fail(e); }
}

export async function report({ userId, messageId }) {
  let block = false, reason = '';
  const ok = await new Promise((resolve) => modal({
    title: messageId ? 'Signaler ce message ?' : `Signaler ${user(userId).name} ?`,
    body: `<p class="muted" style="font-size:14px">Le signalement sera transmis à l'administration de Scola avec ${messageId ? 'ce message' : 'les informations du profil'}.</p>
      <div class="field"><label>Motif</label><select class="select" data-r><option>Harcèlement ou insultes</option><option>Contenu inapproprié</option><option>Fraude / triche aux examens</option><option>Spam</option><option>Usurpation d'identité</option><option>Autre</option></select></div>
      ${userId !== S.me.id ? '<label class="choice"><input type="checkbox" data-b> Bloquer aussi cette personne</label>' : ''}`,
    buttons: [{ label: 'Annuler', value: false }, { label: 'Signaler', cls: 'text danger', value: true, onClick: (c, b) => { reason = $('[data-r]', b).value; block = !!$('[data-b]', b)?.checked; } }],
    onClose: resolve,
  }));
  if (!ok) return;
  try {
    const r = await post('/reports', { userId, messageId, reason, block });
    S.me = { ...S.me, ...r.me };
    emit('me');
    toast('Signalement envoyé à l\'administration');
  } catch (e) { fail(e); }
}

export function chatMenu(chat, anchor) {
  if (!chat) return;
  const st = chat.state || {};
  const unread = chat.unread || st.markedUnread;
  ctxMenu(anchor, [
    { icon: 'archive', label: st.archived ? 'Désarchiver' : 'Archiver', onClick: () => toggleArchive(chat) },
    { icon: isMuted(chat) ? 'bell' : 'bellOff', label: isMuted(chat) ? 'Réactiver les notifications' : 'Mettre en sourdine', onClick: () => muteChat(chat) },
    !st.archived && { icon: 'thumbtack', label: st.pinned ? 'Désépingler' : 'Épingler', onClick: () => setState(chat, { pinned: !st.pinned }) },
    { icon: 'unread', label: unread ? 'Marquer comme lu' : 'Marquer comme non lu', onClick: () => unread ? markRead(chat) : setState(chat, { markedUnread: true }) },
    { icon: 'heart', label: st.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris', onClick: () => setState(chat, { favorite: !st.favorite }) },
    '-',
    { icon: 'x', label: 'Effacer la discussion', onClick: () => clearChat(chat) },
    chat.type !== 'group' && { icon: 'trash', label: 'Supprimer la discussion', danger: true, onClick: () => deleteChat(chat) },
  ]);
}

async function markRead(chat) {
  try { await post(`/chats/${chat.id}/read`); chat.unread = 0; chat.mentioned = false; if (chat.state) chat.state.markedUnread = false; emit('chats'); } catch (e) { fail(e); }
}
async function markAllRead() {
  for (const c of S.chats.values()) if (c.unread || c.state?.markedUnread) await markRead(c);
}

/* ---------------- Pages ---------------- */
export function newChatPage(side) {
  pushPage(side, {
    title: 'Nouvelle discussion',
    render: (body) => {
      body.innerHTML = `<div class="search-bar"><div class="search-box">${icon('search', 'sm')}<input placeholder="Rechercher un camarade" data-q></div></div>
        <div class="menu-row" data-a="group"><div class="av" style="--s:42px;background:var(--brand)">${icon('cap')}</div><div class="txt"><b>${esc(S.cls?.name || 'Ma classe')}</b><small>Groupe de la classe · ${S.cls?.memberCount || 0} membres</small></div></div>
        <div class="menu-row" data-a="broadcast"><div class="av" style="--s:42px;background:var(--brand)">${icon('megaphone')}</div><div class="txt">Nouvelle liste de diffusion</div></div>
        <div class="menu-row" data-a="self"><div class="av" style="--s:42px;background:var(--brand)">${icon('user')}</div><div class="txt">Message à moi-même<small>Notes, rappels, brouillons de devoirs</small></div></div>
        <div class="section-title">Camarades de classe</div><div data-list></div>`;
      const draw = () => {
        const f = fold($('[data-q]', body).value);
        const people = [...S.members.values()].filter(u => !u.deleted && u.id !== S.me.id && fold(u.name).includes(f)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        $('[data-list]', body).innerHTML = people.map(u => `<div class="item compact" data-user="${u.id}">${avatar(u, 42)}<div class="body"><div class="top"><span class="name">${esc(u.name)}</span></div><div class="bot"><span class="prev">${esc(u.about || '')}</span></div></div></div>`).join('') || '<div class="empty">Aucun camarade trouvé. Invite ta classe à rejoindre Scola !</div>';
      };
      draw();
      $('[data-q]', body).oninput = draw;
      body.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        const uid = a === 'self' ? S.me.id : e.target.closest('[data-user]')?.dataset.user;
        if (a === 'group') return nav.openChat(S.cls.id);
        if (a === 'broadcast') return newBroadcast();
        if (!uid) return;
        try { const c = await post('/chats/dm/' + uid); S.chats.set(c.id, c); emit('chats'); nav.openChat(c.id); body.closest('.page').close(); } catch (er) { fail(er); }
      });
    },
  });
}

export async function newBroadcast() {
  const ids = await pickMembers({ title: 'Nouvelle diffusion', multiple: true, min: 2, exclude: [S.me.id], okLabel: 'Créer' });
  if (!ids) return;
  const name = await promptBox('Nom de la liste', { placeholder: 'Ex. Groupe de TD 3', max: 60, hint: 'Seules les personnes qui vous ont dans leurs discussions recevront vos messages diffusés, en privé.' });
  try { const c = await post('/broadcasts', { recipients: ids, name: name || '' }); S.chats.set(c.id, c); emit('chats'); nav.openChat(c.id); } catch (e) { fail(e); }
}

export function openArchived(side) {
  pushPage(side, {
    title: 'Archivées',
    render: (body) => {
      const draw = () => {
        const chats = sortedChats().filter(c => c.state?.archived);
        body.innerHTML = `<div class="empty" style="padding:14px 20px;font-size:13px">Les discussions archivées restent archivées lorsque vous recevez un nouveau message. Modifiable dans Paramètres › Discussions.</div>`
          + (chats.map(c => chatItem(c)).join('') || `<div class="empty">${icon('archive')}Aucune discussion archivée</div>`);
      };
      draw();
      live(body, 'chats', draw);
      bindList(body);
    },
  });
}

export function openStarred(container) {
  pushPage(container, {
    title: 'Messages importants',
    render: async (body) => {
      body.innerHTML = '<div class="empty">Chargement…</div>';
      try {
        const list = await get('/starred');
        body.innerHTML = list.length ? list.map(m => {
          const chat = S.chats.get(m.chatId);
          return `<div class="item" data-chat="${m.chatId}" data-around="${m.id}">${avatar(user(m.senderId), 40)}
            <div class="body"><div class="top"><span class="name" style="font-size:14.5px">${esc(displayName(m.senderId))} ${icon('chevR', 'xs')} ${esc(chatTitle(chat))}</span><span class="time">${listTime(m.createdAt)}</span></div>
            <div class="text" style="font-size:14px;max-height:80px;overflow:hidden">${formatText(preview(m))}</div>
            <small class="faint">${hhmm(m.createdAt)} ${icon('starFill', 'xs')}</small></div></div>`;
        }).join('') : `<div class="empty">${icon('star')}Aucun message important.<br>Appuyez longuement sur un message puis sur ★ pour le retrouver ici.</div>`;
        bindList(body);
      } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    },
  });
}
