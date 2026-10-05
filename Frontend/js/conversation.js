// Écran de conversation : messages, saisie, pièces jointes, vocaux, réactions, sélection…
import { $, $$, h, esc, icon, avatar, lastSeenText, debounce, copyText, hhmm, download, dayLabel, fullDate, fold, pickFiles } from './util.js';
import { get, post, patch, del, upload, downloadAuth } from './api.js';
import { S, on, emit, user, displayName, chatTitle, chatEntity, isMuted, blocked, preview, upsertMsg, draft } from './state.js';
import { toast, fail, ctxMenu, modal, confirmBox, choose, pickMembers, placeAt, sound, closeMenus } from './ui.js';
import { nav } from './nav.js';
import { live, typingText, chatMenu, muteChat, clearChat, deleteChat, toggleBlock, report } from './chatlist.js';
import { msgHTML, daySep, sameGroup, quoteHTML, eventIcs } from './msgview.js';
import { emojiPanel, QUICK, pushRecent } from './emoji.js';
import { openViewer, composeMedia, takePhoto, compressImage, imageInfo, videoInfo, kindOf, toggleVoice, seekVoice, cycleSpeed, syncVoice, startRecorder } from './media.js';

let cur = null;
const liveWatch = new Map();

/* ---------------- Fonds d'écran ---------------- */
export const WALLPAPERS = [
  null, 'c:#e8ded2', 'c:#d6e6e2', 'c:#dbe4f3', 'c:#efe0ef', 'c:#f3ecd2', 'c:#1d2b2a', 'c:#232a3a',
  'g:linear-gradient(160deg,#c9f0e6,#f6e9c9)', 'g:linear-gradient(160deg,#cfe0ff,#f3d4ec)', 'g:linear-gradient(160deg,#0f2b29,#21313f)', 'g:linear-gradient(160deg,#fde2c9,#f9c5c5)',
];
export function wallStyle(v) {
  if (!v) return { cls: '', style: '' };
  if (v.startsWith('c:')) return { cls: '', style: `background:${v.slice(2)}` };
  if (v.startsWith('g:')) return { cls: '', style: `background:${v.slice(2)}` };
  if (v.startsWith('i:')) return { cls: 'img', style: `background-image:url('${v.slice(2).replace(/'/g, '')}')` };
  return { cls: '', style: '' };
}

/* ---------------- Écran vide ---------------- */
export function renderEmpty() {
  nav.els.main.innerHTML = `<div class="welcome"><div>
    <svg class="art" viewBox="0 0 220 160" aria-hidden="true">
      <rect x="20" y="30" width="120" height="84" rx="14" fill="var(--brand-soft)"/>
      <rect x="34" y="48" width="70" height="8" rx="4" fill="var(--brand)"/>
      <rect x="34" y="64" width="90" height="8" rx="4" fill="var(--brand)" opacity=".5"/>
      <rect x="34" y="80" width="54" height="8" rx="4" fill="var(--brand)" opacity=".5"/>
      <rect x="86" y="70" width="114" height="70" rx="14" fill="var(--brand)"/>
      <path d="M143 88l-26 12 26 12 26-12z" fill="#fff"/><path d="M128 106v9c0 5 7 9 15 9s15-4 15-9v-9l-15 7z" fill="#fff"/>
      <circle cx="176" cy="40" r="16" fill="var(--accent)"/><path d="M170 40l4 4 8-8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>
    <h2>Scola pour ${esc(S.cls?.name || 'ta classe')}</h2>
    <p>Discute avec tes camarades, partage cours, devoirs et documents, organise des sondages et des évènements, et appelle ta classe en audio ou en vidéo.</p>
    <div class="lock">${icon('lock', 'xs')} Seuls les membres de ta classe ont accès à tes échanges</div></div></div>`;
}

/* ---------------- Ouverture / fermeture ---------------- */
nav.openChat = openChat;
nav.closeChat = closeChat;

export async function openChat(chatId, { around } = {}) {
  let chat = S.chats.get(chatId);
  if (!chat) {
    try { chat = await get('/chats/' + chatId); S.chats.set(chatId, chat); } catch (e) { return fail(e); }
  }
  stopRecording(true);
  saveDraft();
  const wasOpen = !!S.current;
  S.current = chatId;
  cur = { chatId, replyTo: null, editing: null, selecting: null, mentions: new Set(), pinIdx: 0, newCount: 0, atBottom: true, unreadFrom: null, unreadCount: chat.unread || 0 };
  nav.els.app.classList.add('chat-open');
  if (innerWidth <= 900 && !wasOpen) history.pushState({ chat: chatId }, '');
  nav.closeDrawer();
  renderShell();
  emit('current');
  await loadMessages(around);
  markRead(true);
}

export function closeChat(fromPop = false) {
  if (!fromPop && innerWidth <= 900 && history.state?.chat) return history.back();
  stopRecording(true);
  saveDraft();
  S.current = null;
  cur = null;
  nav.els.app.classList.remove('chat-open');
  nav.closeDrawer();
  renderEmpty();
  emit('current');
}

async function loadMessages(around) {
  const id = cur.chatId;
  const chat = S.chats.get(id);
  if (!S.msgs.has(id) || around) {
    cur.inner.innerHTML = '<div class="sys">Chargement…</div>';
    try {
      const r = await get(`/chats/${id}/messages?limit=60${around ? '&around=' + encodeURIComponent(around) : ''}`);
      if (cur?.chatId !== id) return;
      S.msgs.set(id, r.messages);
      S.hasMore.set(id, r.hasMore);
    } catch (e) { cur.inner.innerHTML = `<div class="sys">${esc(e.message)}</div>`; return; }
  }
  // Repère des messages non lus.
  const list = S.msgs.get(id);
  if (cur.unreadCount && !around) {
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].senderId !== S.me.id && list[i].type !== 'system') n++;
      if (n === cur.unreadCount) { cur.unreadFrom = list[i].id; break; }
    }
  }
  renderMessages(around ? { around } : cur.unreadFrom ? 'unread' : 'bottom');
  renderPinned();
  if (chat) chat.unread = chat.unread || 0;
}

/* ---------------- Structure ---------------- */
function renderShell() {
  const chat = S.chats.get(cur.chatId);
  const root = h(`<div class="conv col" style="height:100%;position:relative">
    <header class="conv-head" data-head></header>
    <div data-banner></div>
    <div data-pinned></div>
    <div class="messages scroll" data-list><div class="wall" data-wall></div><div class="messages-inner" data-inner></div></div>
    <button class="to-bottom" data-bottom hidden>${icon('chevD')}</button>
    <div class="composer-wrap" data-composer></div>
  </div>`);
  nav.els.main.innerHTML = '';
  nav.els.main.append(root);
  cur.root = root;
  cur.list = $('[data-list]', root);
  cur.inner = $('[data-inner]', root);
  renderHead();
  renderWall();
  renderBanner();
  renderComposer();
  bindMessages();
  cur.list.addEventListener('scroll', onScroll, { passive: true });
  $('[data-bottom]', root).onclick = () => { scrollBottom(true); };
  // Glisser-déposer de fichiers.
  root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  root.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    if (sendBlocked()) return toast(typeof sendBlocked() === 'string' ? sendBlocked() : 'Envoi impossible.');
    pickedFiles(e.dataTransfer.files);
  });

  live(root, 'msg:new', onMsg);
  live(root, 'msg:update', onMsg);
  live(root, 'msg:status', (list) => list.forEach(s => { if (s.chatId === cur?.chatId) refreshMsg(s.id); }));
  live(root, 'msg:remove', ({ chatId }) => { if (chatId === cur?.chatId) renderMessages('keep'); });
  live(root, 'chat:reload', (id) => { if (id === cur?.chatId) { S.msgs.delete(id); loadMessages(); } });
  live(root, 'typing', (id) => { if (id === cur?.chatId) renderHead(); });
  live(root, 'presence', (uid) => { if (S.chats.get(cur?.chatId)?.peerId === uid) renderHead(); });
  live(root, 'chat:meta', (id) => { if (id === cur?.chatId) { renderHead(); renderPinned(); renderWall(); } });
  live(root, 'class', () => { if (chat?.type === 'group') { renderHead(); renderComposer(); } });
  live(root, 'me', () => { renderHead(); renderComposer(); renderWall(); });
  live(root, 'members', () => renderHead());
  live(root, 'calls:active', () => renderBanner());
}

function sendBlocked() {
  const chat = S.chats.get(cur.chatId);
  if (chat.type === 'group') {
    if (S.cls.restricted?.includes(S.me.id)) return 'L\'administration de Scola a restreint vos messages dans ce groupe.';
    if (S.cls.settings.readOnly) return 'L\'administration a temporairement fermé ce groupe en écriture. Vous pouvez toujours lire les messages.';
  } else if (chat.type === 'dm' && chat.peerId !== S.me.id) {
    if (blocked(chat.peerId)) return { blocked: true };
    if (user(chat.peerId).deleted) return 'Ce compte a été supprimé. Vous ne pouvez plus lui écrire.';
  }
  return null;
}

/* ---------------- En-tête ---------------- */
function subtitle(chat) {
  const t = typingText(chat.id);
  if (t) return { text: t, live: true };
  if (chat.type === 'group') {
    const ids = S.cls?.memberCount > 1 ? [...S.members.values()].filter(u => !u.deleted).map(u => u.id) : [];
    const names = ids.filter(x => x !== S.me.id).slice(0, 8).map(x => user(x).name.split(' ')[0]);
    if (!names.length) return { text: `${S.cls?.memberCount || 1} membre · ${S.cls?.country || ''}` };
    return { text: `${names.join(', ')}${ids.length > 9 ? '…' : ''}, Vous` };
  }
  if (chat.type === 'broadcast') return { text: `${chat.recipients.length} destinataires` };
  if (chat.peerId === S.me.id) return { text: 'Envoyez-vous des messages' };
  if (blocked(chat.peerId)) return { text: 'Bloqué(e)' };
  const u = user(chat.peerId);
  return { text: lastSeenText(u) || 'Cliquez ici pour les infos du contact', live: u.online };
}

function renderHead() {
  if (!cur) return;
  const head = $('[data-head]', cur.root);
  const chat = S.chats.get(cur.chatId);
  if (!chat) return;
  if (cur.selecting) {
    const n = cur.selecting.size;
    head.innerHTML = `<button class="icon-btn" data-sel-x title="Annuler">${icon('x')}</button>
      <div class="grow" style="font-size:16px;font-weight:500;padding-left:8px">${n} sélectionné${n > 1 ? 's' : ''}</div>
      <button class="icon-btn" data-sel="star" title="Important" ${n ? '' : 'disabled'}>${icon('star')}</button>
      <button class="icon-btn" data-sel="copy" title="Copier" ${n ? '' : 'disabled'}>${icon('copy')}</button>
      <button class="icon-btn" data-sel="fwd" title="Transférer" ${n ? '' : 'disabled'}>${icon('forward')}</button>
      <button class="icon-btn" data-sel="del" title="Supprimer" ${n ? '' : 'disabled'}>${icon('trash')}</button>`;
    $('[data-sel-x]', head).onclick = () => setSelecting(false);
    head.querySelectorAll('[data-sel]').forEach(b => (b.onclick = () => selectionAction(b.dataset.sel)));
    return;
  }
  const sub = subtitle(chat);
  const canCall = chat.type !== 'broadcast' && chat.peerId !== S.me.id;
  head.innerHTML = `<button class="icon-btn back" data-back title="Retour">${icon('back')}</button>
    <div class="who" data-info>${avatar(chatEntity(chat), 40, { group: chat.type === 'group', broadcast: chat.type === 'broadcast' })}
      <div class="col grow"><div class="t ellipsis">${esc(chatTitle(chat))}</div><div class="s ellipsis ${sub.live ? 'live' : ''}">${esc(sub.text)}</div></div></div>
    ${canCall ? `<button class="icon-btn" data-call="video" title="Appel vidéo">${icon('video')}</button><button class="icon-btn" data-call="audio" title="Appel vocal">${icon('phone')}</button>` : ''}
    <button class="icon-btn" data-search title="Rechercher">${icon('search')}</button>
    <button class="icon-btn" data-menu title="Menu">${icon('more')}</button>`;
  $('[data-back]', head).onclick = () => closeChat();
  $('[data-info]', head).onclick = () => import('./info.js').then(m => m.openChatInfo(chat));
  head.querySelectorAll('[data-call]').forEach(b => (b.onclick = () => nav.startCall(chat.id, b.dataset.call === 'video')));
  $('[data-search]', head).onclick = () => openSearch(chat);
  $('[data-menu]', head).onclick = (e) => headMenu(chat, e.currentTarget);
}

function headMenu(chat, anchor) {
  const dm = chat.type === 'dm' && chat.peerId !== S.me.id;
  ctxMenu(anchor, [
    { icon: 'info', label: chat.type === 'group' ? 'Infos du groupe' : chat.type === 'broadcast' ? 'Infos de la liste' : 'Infos du contact', onClick: () => import('./info.js').then(m => m.openChatInfo(chat)) },
    { icon: 'image', label: 'Médias, liens et docs', onClick: () => import('./info.js').then(m => m.openMedia(chat)) },
    { icon: 'checkSq', label: 'Sélectionner des messages', onClick: () => setSelecting(true) },
    chat.type !== 'broadcast' && { icon: 'timer', label: 'Messages éphémères', onClick: () => import('./info.js').then(m => m.setDisappearing(chat)) },
    { icon: isMuted(chat) ? 'bell' : 'bellOff', label: isMuted(chat) ? 'Réactiver les notifications' : 'Mettre en sourdine', onClick: () => muteChat(chat) },
    { icon: 'wall', label: 'Fond d\'écran', onClick: () => import('./settings.js').then(m => m.pickWallpaper(chat.id)) },
    '-',
    { icon: 'download', label: 'Exporter la discussion', onClick: () => downloadAuth(`/chats/${chat.id}/export`, 'discussion.txt').catch(fail) },
    { icon: 'x', label: 'Effacer la discussion', onClick: () => clearChat(chat) },
    dm && { icon: 'ban', label: blocked(chat.peerId) ? 'Débloquer' : 'Bloquer', onClick: () => toggleBlock(chat.peerId) },
    dm && { icon: 'flag', label: 'Signaler', onClick: () => report({ userId: chat.peerId }) },
    chat.type !== 'group' && { icon: 'trash', label: 'Supprimer la discussion', danger: true, onClick: () => deleteChat(chat) },
    { icon: 'x', label: 'Fermer la discussion', onClick: () => closeChat() },
  ]);
}

function renderWall() {
  if (!cur) return;
  const chat = S.chats.get(cur.chatId);
  const w = wallStyle(chat?.state?.wallpaper || S.me.settings.wallpaper);
  const el = $('[data-wall]', cur.root);
  el.className = 'wall ' + w.cls;
  el.setAttribute('style', w.style);
}

export function renderBanner() {
  if (!cur) return;
  const el = $('[data-banner]', cur.root);
  const call = [...S.activeCalls.values()].find(c => c.chatId === cur.chatId && c.group);
  const inIt = call && call.participants.includes(S.me.id);
  el.innerHTML = call && !inIt ? `<div class="call-banner">${icon(call.video ? 'video' : 'phone', 'sm')}<span class="grow">Appel ${call.video ? 'vidéo' : 'vocal'} en cours · ${call.participants.length} participant${call.participants.length > 1 ? 's' : ''}</span><button class="btn" data-join>Rejoindre</button></div>` : '';
  $('[data-join]', el)?.addEventListener('click', () => import('./calls.js').then(m => m.joinCall(call.callId, call.video)));
}

function renderPinned() {
  if (!cur) return;
  const chat = S.chats.get(cur.chatId);
  const el = $('[data-pinned]', cur.root);
  const ids = chat?.pinnedMsgs || [];
  if (!ids.length) { el.innerHTML = ''; return; }
  cur.pinIdx = cur.pinIdx % ids.length;
  const id = ids[ids.length - 1 - cur.pinIdx];
  const m = S.msgs.get(cur.chatId)?.find(x => x.id === id);
  el.innerHTML = `<div class="pinned-bar">${ids.length > 1 ? `<div class="pins">${ids.map((_, i) => `<i class="${ids.length - 1 - i === ids.length - 1 - cur.pinIdx ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    ${icon('thumbtack', 'sm')}<div class="grow ellipsis">${m ? `<b>${esc(displayName(m.senderId))} :</b> ${esc(preview(m))}` : 'Message épinglé'}</div></div>`;
  $('.pinned-bar', el).onclick = () => { jumpTo(id); cur.pinIdx++; renderPinned(); };
}

/* ---------------- Messages ---------------- */
function prevOf(list, i) { for (let k = i - 1; k >= 0; k--) return list[k]; return null; }

function introHTML(chat) {
  const t = chat.type === 'group'
    ? 'Groupe officiel de votre classe : seuls les élèves et étudiants inscrits dans cette filière et ce niveau y ont accès.'
    : chat.type === 'broadcast' ? 'Liste de diffusion : chaque destinataire reçoit vos messages en privé.'
    : chat.peerId === S.me.id ? 'Votre espace personnel : notes, rappels, fichiers à garder.'
    : 'Discussion privée entre camarades de classe. Seuls vous deux pouvez la lire.';
  return `<div class="sys e2e">${icon('lock', 'xs')} ${esc(t)}</div>`;
}

function renderMessages(mode = 'bottom') {
  if (!cur) return;
  const chat = S.chats.get(cur.chatId);
  const list = S.msgs.get(cur.chatId) || [];
  let html = S.hasMore.get(cur.chatId) ? `<button class="btn ghost load-more" data-older>Charger les messages précédents</button>` : introHTML(chat);
  let lastDay = null;
  list.forEach((m, i) => {
    const d = dayLabel(m.createdAt);
    if (d !== lastDay) { html += daySep(m.createdAt); lastDay = d; }
    if (m.id === cur.unreadFrom) html += `<div class="unread-sep" data-unread>${cur.unreadCount} message${cur.unreadCount > 1 ? 's' : ''} non lu${cur.unreadCount > 1 ? 's' : ''}</div>`;
    html += msgHTML(m, prevOf(list, i), chat);
  });
  const el = cur.list;
  const fromBottom = el.scrollHeight - el.scrollTop;
  cur.inner.innerHTML = html;
  if (cur.selecting) markSelected();
  syncVoice(cur.inner);
  if (mode === 'bottom') scrollBottom();
  else if (mode === 'unread') { const u = $('[data-unread]', cur.inner); u ? u.scrollIntoView({ block: 'center' }) : scrollBottom(); }
  else if (mode === 'keep') el.scrollTop = el.scrollHeight - fromBottom;
  else if (mode?.around) flash(mode.around);
  // Les images chargées plus tard décalent le contenu : on reste en bas si on y était.
  cur.inner.querySelectorAll('img').forEach(img => img.complete || img.addEventListener('load', () => { if (cur?.atBottom) scrollBottom(); }, { once: true }));
}

function msgEl(id) { return cur?.inner.querySelector(`[data-id="${CSS.escape(id)}"]`); }

function refreshMsg(id, oldId) {
  if (!cur) return;
  const list = S.msgs.get(cur.chatId) || [];
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return;
  const el = msgEl(id) || (oldId && msgEl(oldId));
  if (!el) return;
  el.outerHTML = msgHTML(list[i], prevOf(list, i), S.chats.get(cur.chatId));
  if (cur.selecting) markSelected();
  syncVoice(cur.inner);
}

function onMsg(m) {
  if (!cur || m.chatId !== cur.chatId) return;
  const list = S.msgs.get(cur.chatId) || [];
  const i = list.findIndex(x => x.id === m.id);
  if (i < 0) return;
  const existing = msgEl(m.id) || (m.clientId && msgEl(m.clientId));
  if (existing) { refreshMsg(m.id, m.clientId); renderPinned(); return; }
  if (i !== list.length - 1) return renderMessages('keep');
  const prev = list[i - 1];
  let html = '';
  if (!prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt)) html += daySep(m.createdAt);
  html += msgHTML(m, prev, S.chats.get(cur.chatId));
  cur.inner.insertAdjacentHTML('beforeend', html);
  const mine = m.senderId === S.me.id;
  if (mine || cur.atBottom) scrollBottom(mine);
  else { cur.newCount++; updateBottomBtn(); }
  if (!mine) markRead(true);
  if (m.type === 'system' && m.meta?.pinned) renderPinned();
}

function scrollBottom(smooth = false) {
  if (!cur) return;
  cur.list.scrollTo({ top: cur.list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  cur.newCount = 0;
  cur.atBottom = true;
  updateBottomBtn();
}

function updateBottomBtn() {
  const b = $('[data-bottom]', cur.root);
  b.hidden = cur.atBottom;
  b.querySelector('.badge')?.remove();
  if (cur.newCount) b.insertAdjacentHTML('beforeend', `<span class="badge">${cur.newCount}</span>`);
}

const onScroll = () => {
  if (!cur) return;
  const el = cur.list;
  const was = cur.atBottom;
  cur.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  if (cur.atBottom) cur.newCount = 0;
  if (was !== cur.atBottom || cur.atBottom) updateBottomBtn();
  if (el.scrollTop < 150 && S.hasMore.get(cur.chatId) && !cur.loadingOlder) loadOlder();
};

async function loadOlder() {
  const id = cur.chatId;
  const list = S.msgs.get(id) || [];
  if (!list.length) return;
  cur.loadingOlder = true;
  try {
    const r = await get(`/chats/${id}/messages?limit=50&before=${list[0].createdAt}`);
    if (cur?.chatId !== id) return;
    const known = new Set(list.map(x => x.id));
    S.msgs.set(id, r.messages.filter(x => !known.has(x.id)).concat(list));
    S.hasMore.set(id, r.hasMore);
    renderMessages('keep');
  } catch (e) { fail(e); }
  finally { if (cur) cur.loadingOlder = false; }
}

function flash(id) {
  const el = msgEl(id);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1700);
}

export async function jumpTo(id) {
  if (!id) return;
  if (msgEl(id)) return flash(id);
  try {
    const r = await get(`/chats/${cur.chatId}/messages?around=${encodeURIComponent(id)}`);
    if (!r.messages.some(m => m.id === id)) return toast('Ce message n\'est plus disponible.');
    S.msgs.set(cur.chatId, r.messages);
    S.hasMore.set(cur.chatId, true);
    renderMessages({ around: id });
  } catch (e) { fail(e); }
}

export async function markRead(force = false) {
  if (!cur) return;
  const chat = S.chats.get(cur.chatId);
  if (!chat || document.visibilityState !== 'visible') return;
  if (!force && !chat.unread && !chat.state?.markedUnread) return;
  chat.unread = 0;
  chat.mentioned = false;
  if (chat.state) chat.state.markedUnread = false;
  emit('chats');
  post(`/chats/${chat.id}/read`).catch(() => {});
}

function findMsg(id) { return (S.msgs.get(cur?.chatId) || []).find(x => x.id === id); }

/* ---------------- Interactions sur les messages ---------------- */
function bindMessages() {
  const L = cur.list;
  L.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-older]')) return loadOlder();
    const el = t.closest('.msg');
    const m = el && findMsg(el.dataset.id);
    if (cur.selecting) { if (m && m.status !== 'pending') { e.preventDefault(); toggleSelect(m.id); } return; }
    if (!m) return;
    if (t.closest('[data-menu]')) return msgMenu(m, t.closest('[data-menu]'));
    if (t.closest('[data-react]')) return reactBar(m, el.querySelector('.bubble'));
    if (t.closest('[data-reactions]')) return reactionsDetail(m);
    if (t.closest('[data-jump]')) return jumpTo(t.closest('[data-jump]').dataset.jump);
    const prof = t.closest('[data-profile],.mention');
    if (prof) return nav.openProfile(prof.dataset.profile || prof.dataset.uid);
    if (t.closest('[data-once]')) return openOnce(m);
    if (t.closest('[data-view]')) return viewMedia(m);
    if (t.closest('.voice .pp')) return toggleVoice(m.id, m.media.url, cur.inner);
    const wave = t.closest('.voice .wave');
    if (wave) { const r = wave.getBoundingClientRect(); return seekVoice(m.id, (e.clientX - r.left) / r.width); }
    if (t.closest('[data-speed]')) return cycleSpeed();
    if (t.closest('[data-stoplive]')) return stopLive(m.id);
    if (t.closest('[data-loc]')) return open(`https://www.openstreetmap.org/?mlat=${m.location.lat}&mlon=${m.location.lng}#map=17/${m.location.lat}/${m.location.lng}`, '_blank', 'noopener');
    const cm = t.closest('[data-contact-msg]');
    if (cm) return post('/chats/dm/' + cm.dataset.contactMsg).then(c => { S.chats.set(c.id, c); openChat(c.id); }).catch(fail);
    const cv = t.closest('[data-contact-view]');
    if (cv) return nav.openProfile(cv.dataset.contactView);
    const vote = t.closest('[data-vote]');
    if (vote) return castVote(m, vote.dataset.vote);
    if (t.closest('[data-votes]')) return votesDetail(m);
    const rs = t.closest('[data-rsvp]');
    if (rs) return post(`/messages/${m.id}/rsvp`, { response: m.event.responses?.[S.me.id] === rs.dataset.rsvp ? null : rs.dataset.rsvp }).catch(fail);
    if (t.closest('[data-ics]')) {
      const blob = new Blob([eventIcs(m)], { type: 'text/calendar' });
      return download(URL.createObjectURL(blob), (m.event.title || 'evenement').replace(/[^\w-]+/g, '_') + '.ics');
    }
  });
  L.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.msg');
    if (!el || e.target.closest('a')) return;
    const m = findMsg(el.dataset.id);
    if (!m || m.status === 'pending') return;
    e.preventDefault();
    if (cur.selecting) return;
    msgMenu(m, { x: e.clientX, y: e.clientY });
  });
  // Appui long (menu + réactions) et glisser vers la droite (répondre) sur écran tactile.
  let press, sx, sy, swEl;
  L.addEventListener('touchstart', (e) => {
    const el = e.target.closest('.msg');
    if (!el) return;
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; swEl = el;
    press = setTimeout(() => {
      press = null;
      const m = findMsg(el.dataset.id);
      if (!m || m.status === 'pending') return;
      navigator.vibrate?.(25);
      if (cur.selecting) return toggleSelect(m.id);
      if (!m.deleted) reactBar(m, el.querySelector('.bubble'));
      msgMenu(m, { x: t.clientX, y: t.clientY + 60 }, true);
    }, 500);
  }, { passive: true });
  L.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
    if (Math.abs(dx) > 8 || dy > 8) clearTimeout(press);
    if (swEl && dx > 0 && dy < 30) swEl.style.transform = `translateX(${Math.min(dx, 80)}px)`;
  }, { passive: true });
  L.addEventListener('touchend', (e) => {
    clearTimeout(press);
    if (!swEl) return;
    const dx = e.changedTouches[0].clientX - sx;
    swEl.style.transform = '';
    const m = findMsg(swEl.dataset.id);
    if (dx > 70 && m && !m.deleted && m.type !== 'system' && m.status !== 'pending') setReply(m);
    swEl = null;
  });
}

function canDeleteForAll(m) {
  const chat = S.chats.get(m.chatId);
  if (m.deleted) return false;
  return m.senderId === S.me.id && Date.now() - m.createdAt < 60 * 3600e3;
}

function msgMenu(m, anchor, touch = false) {
  const mine = m.senderId === S.me.id;
  const chat = S.chats.get(m.chatId);
  if (m.deleted) {
    return ctxMenu(anchor, [
      { icon: 'checkSq', label: 'Sélectionner', onClick: () => { setSelecting(true); toggleSelect(m.id); } },
      { icon: 'trash', label: 'Supprimer pour moi', danger: true, onClick: () => del(`/messages/${m.id}?for=me`).catch(fail) },
    ]);
  }
  const hasText = !!m.text && !m.viewOnce;
  const editable = mine && ['text', 'image', 'video', 'document'].includes(m.type) && !m.viewOnce && Date.now() - m.createdAt < 15 * 60e3;
  const media = m.media && !m.viewOnce;
  const pinAllowed = chat.type !== 'group' || S.cls.settings.membersPin !== false;
  ctxMenu(anchor, [
    !touch && { icon: 'smile', label: 'Réagir', onClick: () => reactBar(m, msgEl(m.id)?.querySelector('.bubble')) },
    { icon: 'reply', label: 'Répondre', onClick: () => setReply(m) },
    chat.type === 'group' && !mine && { icon: 'user', label: `Écrire à ${user(m.senderId).name.split(' ')[0]} en privé`, onClick: () => post('/chats/dm/' + m.senderId).then(c => { S.chats.set(c.id, c); openChat(c.id); }).catch(fail) },
    hasText && { icon: 'copy', label: 'Copier', onClick: () => copyText(m.text).then(() => toast('Message copié')) },
    !m.viewOnce && { icon: 'forward', label: 'Transférer', onClick: () => forwardMessages([m.id]) },
    pinAllowed && { icon: 'thumbtack', label: m.pinned ? 'Désépingler' : 'Épingler', onClick: () => pinMessage(m) },
    { icon: m.starred ? 'starFill' : 'star', label: m.starred ? 'Retirer des importants' : 'Marquer comme important', onClick: () => post(`/messages/${m.id}/star`).catch(fail) },
    editable && { icon: 'edit', label: 'Modifier', onClick: () => startEdit(m) },
    mine && chat.type !== 'broadcast' && { icon: 'info', label: 'Infos du message', onClick: () => import('./info.js').then(x => x.openMessageInfo(m)) },
    media && { icon: 'download', label: 'Télécharger', onClick: () => download(m.media.url, m.media.name) },
    { icon: 'checkSq', label: 'Sélectionner', onClick: () => { setSelecting(true); toggleSelect(m.id); } },
    !mine && { icon: 'flag', label: 'Signaler', onClick: () => report({ messageId: m.id, userId: m.senderId }) },
    '-',
    { icon: 'trash', label: 'Supprimer', danger: true, onClick: () => deleteMessages([m]) },
  ]);
}

function reactBar(m, anchorEl) {
  if (!anchorEl || m.deleted) return;
  document.querySelectorAll('.react-bar').forEach(x => x.remove());
  const mine = m.reactions?.[S.me.id];
  const bar = h(`<div class="react-bar">${QUICK.map(e => `<button class="${mine === e ? 'on' : ''}">${e}</button>`).join('')}<button class="plus" data-plus>${icon('plus', 'sm')}</button></div>`);
  const close = () => { bar.remove(); removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!bar.contains(e.target)) close(); };
  setTimeout(() => addEventListener('mousedown', outside, true), 0);
  bar.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    close();
    if (b.dataset.plus !== undefined) {
      closeMenus();
      const mod = modal({ title: 'Réagir', body: emojiPanel((em) => { mod.close(); react(m, em); }), flush: true });
      return;
    }
    closeMenus();
    react(m, b.textContent);
  };
  document.body.append(bar);
  const r = anchorEl.getBoundingClientRect();
  const out = m.senderId === S.me.id;
  placeAt(bar, { x: out ? r.right - bar.offsetWidth : r.left, y: Math.max(8, r.top - bar.offsetHeight - 6) });
}

function react(m, emoji) {
  pushRecent(emoji);
  post(`/messages/${m.id}/react`, { emoji }).catch(fail);
}

function reactionsDetail(m) {
  const entries = Object.entries(m.reactions || {});
  const body = h(`<div class="list">${entries.map(([uid, e]) => `
    <div class="item compact" data-uid="${uid}">${avatar(user(uid), 40)}<div class="body"><div class="top"><span class="name">${esc(uid === S.me.id ? 'Vous' : user(uid).name)}</span><span style="font-size:24px">${e}</span></div>
    ${uid === S.me.id ? '<div class="bot"><span class="prev">Appuyez pour retirer</span></div>' : ''}</div></div>`).join('')}</div>`);
  const mod = modal({ title: `${entries.length} réaction${entries.length > 1 ? 's' : ''}`, body, flush: true });
  body.onclick = (e) => {
    const it = e.target.closest('[data-uid]');
    if (it?.dataset.uid === S.me.id) { react(m, m.reactions[S.me.id]); mod.close(); }
  };
}

async function pinMessage(m) {
  if (m.pinned) return post(`/messages/${m.id}/pin`, { unpin: true }).catch(fail);
  const s = await choose('Durée de l\'épinglage', [{ value: 86400, label: '24 heures' }, { value: 604800, label: '7 jours' }, { value: 2592000, label: '30 jours' }], 604800, { okLabel: 'Épingler', note: 'Vous pouvez désépingler à tout moment.' });
  if (s) post(`/messages/${m.id}/pin`, { seconds: s }).then(() => toast('Message épinglé')).catch(fail);
}

async function deleteMessages(msgs) {
  const forAll = msgs.every(canDeleteForAll);
  const n = msgs.length;
  const v = await new Promise((resolve) => modal({
    title: n > 1 ? `Supprimer ${n} messages ?` : 'Supprimer le message ?',
    body: '',
    buttons: [
      forAll && { label: 'Supprimer pour tous', cls: 'text danger', value: 'all' },
      { label: 'Supprimer pour moi', cls: 'text danger', value: 'me' },
      { label: 'Annuler', value: null },
    ].filter(Boolean),
    onClose: resolve,
  }));
  if (!v) return;
  for (const m of msgs) await del(`/messages/${m.id}?for=${v}`).catch(fail);
  if (cur?.selecting) setSelecting(false);
}

async function openOnce(m) {
  try {
    const r = await post(`/messages/${m.id}/open`);
    if (r.type === 'voice') {
      const a = new Audio(r.media.url);
      a.play();
      toast('Message vocal à écoute unique en cours de lecture…', { ms: Math.max(3000, (r.media.duration || 3) * 1000) });
      return;
    }
    openViewer([{ url: r.media.url, type: r.type, senderId: m.senderId, createdAt: m.createdAt, noDownload: true }], 0);
  } catch (e) { fail(e); }
}

function viewMedia(m) {
  const all = (S.msgs.get(cur.chatId) || []).filter(x => ['image', 'video'].includes(x.type) && x.media && !x.viewOnce && !x.deleted && x.status !== 'pending');
  const items = all.map(x => ({ id: x.id, url: x.media.url, type: x.type, caption: x.text, name: x.media.name, senderId: x.senderId, createdAt: x.createdAt }));
  const i = Math.max(0, items.findIndex(x => x.id === m.id));
  if (!items.length) return;
  openViewer(items, i, { onForward: (it) => forwardMessages([it.id]), onReply: (it) => setReply(findMsg(it.id)) });
}

function castVote(m, optId) {
  const mine = m.poll.options.filter(o => o.votes.includes(S.me.id)).map(o => o.id);
  let next;
  if (m.poll.multiple) next = mine.includes(optId) ? mine.filter(x => x !== optId) : [...mine, optId];
  else next = mine.includes(optId) ? [] : [optId];
  post(`/messages/${m.id}/vote`, { optionIds: next }).catch(fail);
}

function votesDetail(m) {
  const p = m.poll;
  modal({
    title: 'Résultats du sondage',
    body: `<h4 style="margin:4px 0 12px">${esc(p.question)}</h4>` + p.options.map(o => `
      <div class="card-title" style="padding:10px 0 4px"><b style="color:var(--text)">${esc(o.text)}</b><span>${o.votes.length} vote${o.votes.length > 1 ? 's' : ''}</span></div>
      ${o.votes.map(uid => `<div class="row" style="padding:5px 0">${avatar(user(uid), 32)}<span>${esc(uid === S.me.id ? 'Vous' : user(uid).name)}</span></div>`).join('') || '<div class="faint" style="font-size:13px">Aucun vote</div>'}`).join(''),
  });
}

/* ---------------- Sélection multiple ---------------- */
function setSelecting(on) {
  if (!cur) return;
  cur.selecting = on ? new Set() : null;
  cur.root.classList.toggle('selecting', !!on);
  markSelected();
  renderHead();
}
function toggleSelect(id) {
  if (!cur.selecting) return;
  if (cur.selecting.has(id)) cur.selecting.delete(id); else cur.selecting.add(id);
  markSelected();
  renderHead();
}
function markSelected() {
  cur.inner.querySelectorAll('.msg').forEach(el => {
    const on = !!cur.selecting?.has(el.dataset.id);
    el.classList.toggle('sel', on);
    el.querySelector('.selbox')?.classList.toggle('on', on);
  });
}
async function selectionAction(a) {
  const msgs = [...cur.selecting].map(findMsg).filter(Boolean).sort((x, y) => x.createdAt - y.createdAt);
  if (!msgs.length) return;
  if (a === 'del') return deleteMessages(msgs);
  if (a === 'fwd') { await forwardMessages(msgs.filter(m => !m.deleted && !m.viewOnce).map(m => m.id)); return setSelecting(false); }
  if (a === 'star') { for (const m of msgs) if (!m.deleted && !m.starred) await post(`/messages/${m.id}/star`).catch(() => {}); toast('Marqués comme importants'); return setSelecting(false); }
  if (a === 'copy') {
    const txt = msgs.filter(m => !m.deleted).map(m => msgs.length > 1 ? `[${hhmm(m.createdAt)}] ${user(m.senderId).name} : ${preview(m)}` : (m.text || preview(m))).join('\n');
    await copyText(txt);
    toast(msgs.length > 1 ? 'Messages copiés' : 'Message copié');
    setSelecting(false);
  }
}

/* ---------------- Transfert ---------------- */
export async function forwardMessages(ids) {
  if (!ids.length) return toast('Rien à transférer.');
  const sel = new Set();
  const chats = [...S.chats.values()].sort((a, b) => (b.last?.createdAt || 0) - (a.last?.createdAt || 0));
  const dmPeers = new Set(chats.filter(c => c.type === 'dm').map(c => c.peerId));
  const people = [...S.members.values()].filter(u => !u.deleted && !dmPeers.has(u.id) && u.id !== S.me.id);
  const rows = chats.map(c => ({ key: 'c:' + c.id, title: chatTitle(c), ent: chatEntity(c), opts: { group: c.type === 'group', broadcast: c.type === 'broadcast' } }))
    .concat(people.map(u => ({ key: 'u:' + u.id, title: u.name, ent: u, opts: {} })));
  const body = h(`<div><div class="search-bar" style="padding:8px 16px"><div class="search-box">${icon('search', 'sm')}<input placeholder="Rechercher"></div></div>
    <div class="list" style="max-height:46vh" data-l></div>
    <div style="padding:10px 16px"><input class="input boxed" data-c placeholder="Ajouter un message (facultatif)"></div></div>`);
  const draw = () => {
    const f = fold($('input', body).value);
    $('[data-l]', body).innerHTML = rows.filter(r => fold(r.title).includes(f)).map(r => `
      <div class="item compact" data-k="${r.key}"><span class="check ${sel.has(r.key) ? 'on' : ''}">${sel.has(r.key) ? icon('check', 'xs') : ''}</span>${avatar(r.ent, 40, r.opts)}
      <div class="body"><div class="top"><span class="name">${esc(r.title)}</span></div></div></div>`).join('');
  };
  draw();
  $('input', body).oninput = draw;
  $('[data-l]', body).onclick = (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    if (sel.has(k)) sel.delete(k); else if (sel.size < 5) sel.add(k); else toast('5 discussions maximum.');
    draw();
  };
  modal({
    title: 'Transférer à…', body, flush: true,
    buttons: [{ label: 'Annuler' }, { label: 'Transférer', cls: '', onClick: async () => {
      if (!sel.size) throw new Error('Choisissez au moins une discussion.');
      const chatIds = [...sel].filter(k => k.startsWith('c:')).map(k => k.slice(2));
      const userIds = [...sel].filter(k => k.startsWith('u:')).map(k => k.slice(2));
      await post('/messages/forward', { messageIds: ids, chatIds, userIds, comment: $('[data-c]', body).value.trim() || undefined });
      toast('Transféré');
      if (sel.size === 1 && chatIds[0] && chatIds[0] !== cur?.chatId) openChat(chatIds[0]);
    } }],
  });
}

/* ---------------- Recherche dans la discussion ---------------- */
function openSearch(chat) {
  nav.openDrawer({
    title: 'Rechercher des messages',
    render: (body) => {
      body.innerHTML = `<div class="search-bar" style="padding:10px 14px"><div class="search-box">${icon('search', 'sm')}<input placeholder="Rechercher…" data-q></div></div><div data-r></div>`;
      const q = $('[data-q]', body);
      const run = debounce(async () => {
        const v = q.value.trim();
        const box = $('[data-r]', body);
        if (v.length < 2) { box.innerHTML = `<div class="empty">Rechercher des messages avec ${esc(chatTitle(chat))}.</div>`; return; }
        try {
          const r = await get(`/search?chatId=${encodeURIComponent(chat.id)}&q=${encodeURIComponent(v)}`);
          box.innerHTML = r.messages.map(m => `<div class="item compact" data-id="${m.id}"><div class="body">
            <div class="top"><span class="time">${esc(fullDate(m.createdAt))}</span></div>
            <div class="bot"><span class="prev">${chat.type === 'group' ? `<b>${esc(displayName(m.senderId))}</b>&nbsp;: ` : ''}${esc(preview(m))}</span></div></div></div>`).join('') || '<div class="empty">Aucun message trouvé.</div>';
        } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
      }, 250);
      q.oninput = run;
      run();
      setTimeout(() => q.focus(), 50);
      body.onclick = (e) => { const it = e.target.closest('[data-id]'); if (it) { jumpTo(it.dataset.id); if (innerWidth <= 900) nav.closeDrawer(); } };
    },
  });
}

/* ---------------- Zone de saisie ---------------- */
function renderComposer() {
  if (!cur) return;
  const wrap = $('[data-composer]', cur.root);
  const block = sendBlocked();
  if (block) {
    wrap.innerHTML = block.blocked
      ? `<div class="notice-bar">Vous avez bloqué ce contact. <button data-unblock>Débloquer</button></div>`
      : `<div class="notice-bar">${icon('lock', 'xs')} ${esc(block)}</div>`;
    $('[data-unblock]', wrap)?.addEventListener('click', () => toggleBlock(S.chats.get(cur.chatId).peerId));
    return;
  }
  wrap.innerHTML = `<div data-ctx></div><div data-suggest></div>
    <div class="composer" data-bar>
      <button class="icon-btn" data-emoji title="Emojis">${icon('smile')}</button>
      <button class="icon-btn" data-attach title="Joindre">${icon('plus')}</button>
      <div class="box"><textarea rows="1" data-input placeholder="Écrire un message" aria-label="Message"></textarea>
        <button class="icon-btn" data-cam title="Appareil photo">${icon('camera')}</button></div>
      <button class="send" data-send title="Message vocal">${icon('mic')}</button>
    </div>
    <div data-emojis hidden></div>`;
  const ta = $('[data-input]', wrap);
  ta.value = draft(cur.chatId);
  autosize(ta);
  syncSendBtn();
  renderCtx();
  if (matchMedia('(pointer: fine)').matches) setTimeout(() => ta.focus(), 30);

  ta.addEventListener('input', () => {
    autosize(ta);
    syncSendBtn();
    typingPing();
    mentionSuggest();
    saveDraftSoon();
  });
  ta.addEventListener('keydown', (e) => {
    if (handleSuggestKey(e)) return;
    const ets = S.me.settings.enterToSend !== false && !matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && ets) { e.preventDefault(); sendText(); }
    if (e.key === 'Escape') { if (cur.replyTo || cur.editing) { e.stopPropagation(); clearCtx(); } }
    if (e.key === 'ArrowUp' && !ta.value) {
      const last = [...(S.msgs.get(cur.chatId) || [])].reverse().find(m => m.senderId === S.me.id && m.type === 'text' && !m.deleted && Date.now() - m.createdAt < 15 * 60e3);
      if (last) { e.preventDefault(); startEdit(last); }
    }
  });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); pickedFiles(files); }
  });
  $('[data-send]', wrap).onclick = () => (ta.value.trim() || cur.editing ? sendText() : startRecording());
  $('[data-attach]', wrap).onclick = (e) => attachMenu(e.currentTarget);
  $('[data-cam]', wrap).onclick = async () => { const f = await takePhoto(); if (f) pickedFiles([f]); };
  $('[data-emoji]', wrap).onclick = () => {
    const box = $('[data-emojis]', wrap);
    if (!box.firstChild) box.append(emojiPanel((em) => insertAtCaret(ta, em)));
    box.hidden = !box.hidden;
    $('[data-emoji]', wrap).classList.toggle('active', !box.hidden);
    if (!box.hidden) scrollBottom();
  };
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; }
function input() { return cur && $('[data-input]', cur.root); }
function syncSendBtn() {
  const ta = input();
  const b = cur && $('[data-send]', cur.root);
  if (!ta || !b) return;
  const send = !!ta.value.trim() || !!cur.editing;
  b.innerHTML = icon(cur.editing ? 'check' : send ? 'send' : 'mic');
  b.title = send ? 'Envoyer' : 'Message vocal';
}
function insertAtCaret(ta, text) {
  const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function saveDraft() {
  if (!cur) return;
  const ta = input();
  if (ta && !cur.editing) { draft(cur.chatId, ta.value.trim() ? ta.value : ''); emit('chats'); }
}
const saveDraftSoon = debounce(() => { if (cur) { const ta = input(); if (ta && !cur.editing) draft(cur.chatId, ta.value.trim() ? ta.value : ''); } }, 400);

let typingSent = 0, typingStop = null;
function typingPing(state = 'typing') {
  if (!cur || !S.socket) return;
  const chatId = cur.chatId;
  if (Date.now() - typingSent > 2500) { S.socket.emit('typing', { chatId, state }); typingSent = Date.now(); }
  clearTimeout(typingStop);
  typingStop = setTimeout(() => { S.socket.emit('typing', { chatId, state: null }); typingSent = 0; }, state === 'recording' ? 1e9 : 3500);
}
function typingDone() {
  clearTimeout(typingStop);
  if (cur && typingSent) S.socket?.emit('typing', { chatId: cur.chatId, state: null });
  typingSent = 0;
}

/* Réponse / modification */
function renderCtx() {
  const box = cur && $('[data-ctx]', cur.root);
  if (!box) return;
  if (cur.editing) {
    box.innerHTML = `<div class="ctx-bar"><div class="quote" style="--qc:var(--brand)"><div class="q"><b>${icon('edit', 'xs')} Modifier le message</b><span>${esc(cur.editing.text)}</span></div></div><button class="icon-btn" data-cx>${icon('x')}</button></div>`;
  } else if (cur.replyTo) {
    const m = cur.replyTo;
    box.innerHTML = `<div class="ctx-bar">${quoteHTML({ id: '', senderId: m.senderId, text: preview(m), thumb: m.type === 'image' && !m.viewOnce ? m.media?.url : null })}<button class="icon-btn" data-cx>${icon('x')}</button></div>`;
  } else box.innerHTML = '';
  $('[data-cx]', box)?.addEventListener('click', clearCtx);
}
function clearCtx() {
  const wasEdit = !!cur.editing;
  cur.replyTo = null;
  cur.editing = null;
  renderCtx();
  if (wasEdit) { const ta = input(); ta.value = draft(cur.chatId); autosize(ta); }
  syncSendBtn();
}
export function setReply(m) {
  if (!cur || !m || sendBlocked()) return;
  cur.editing = null;
  cur.replyTo = m;
  renderCtx();
  syncSendBtn();
  input()?.focus();
}
function startEdit(m) {
  cur.replyTo = null;
  cur.editing = m;
  renderCtx();
  const ta = input();
  ta.value = m.text || '';
  autosize(ta);
  syncSendBtn();
  ta.focus();
}

/* Mentions @ (groupe) */
let sugg = { list: [], i: 0, start: -1 };
function mentionSuggest() {
  const chat = S.chats.get(cur.chatId);
  const box = $('[data-suggest]', cur.root);
  const ta = input();
  if (chat.type !== 'group') return;
  const before = ta.value.slice(0, ta.selectionStart);
  const mm = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  if (!mm) { box.innerHTML = ''; sugg.list = []; return; }
  const q = fold(mm[2]);
  sugg.start = before.length - mm[2].length - 1;
  sugg.list = [...S.members.values()].filter(u => !u.deleted && u.id !== S.me.id && fold(u.name).includes(q)).slice(0, 8);
  sugg.i = 0;
  drawSuggest();
}
function drawSuggest() {
  const box = $('[data-suggest]', cur.root);
  box.innerHTML = sugg.list.length ? `<div class="suggest">${sugg.list.map((u, k) => `<div class="item compact ${k === sugg.i ? 'on' : ''}" data-k="${k}">${avatar(u, 34)}<div class="body"><span class="name" style="font-size:15px">${esc(u.name)}</span></div></div>`).join('')}</div>` : '';
  box.onclick = (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k !== undefined) pickSuggest(Number(k)); };
}
function pickSuggest(k) {
  const u = sugg.list[k];
  const ta = input();
  const caret = ta.selectionStart;
  ta.value = ta.value.slice(0, sugg.start) + '@' + u.name + ' ' + ta.value.slice(caret);
  const pos = sugg.start + u.name.length + 2;
  ta.selectionStart = ta.selectionEnd = pos;
  cur.mentions.add(u.id);
  sugg.list = [];
  $('[data-suggest]', cur.root).innerHTML = '';
  ta.focus();
  syncSendBtn();
}
function handleSuggestKey(e) {
  if (!sugg.list.length) return false;
  if (e.key === 'ArrowDown') { sugg.i = (sugg.i + 1) % sugg.list.length; drawSuggest(); e.preventDefault(); return true; }
  if (e.key === 'ArrowUp') { sugg.i = (sugg.i - 1 + sugg.list.length) % sugg.list.length; drawSuggest(); e.preventDefault(); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { pickSuggest(sugg.i); e.preventDefault(); return true; }
  if (e.key === 'Escape') { sugg.list = []; $('[data-suggest]', cur.root).innerHTML = ''; e.preventDefault(); return true; }
  return false;
}

/* ---------------- Envoi ---------------- */
function tempId() { return 'tmp_' + Math.random().toString(36).slice(2, 12); }

function addTemp(fields) {
  const m = {
    id: tempId(), chatId: cur.chatId, senderId: S.me.id, createdAt: Date.now() + S.clockSkew, status: 'pending',
    reactions: {}, mentions: [], ...fields,
  };
  if (cur.replyTo) {
    const r = cur.replyTo;
    m.replyTo = { id: r.id, senderId: r.senderId, type: r.type, text: preview(r).slice(0, 200), thumb: r.type === 'image' && !r.viewOnce ? r.media?.url : null };
  }
  (S.msgs.get(cur.chatId) || S.msgs.set(cur.chatId, []).get(cur.chatId)).push(m);
  onMsg(m);
  scrollBottom();
  return m;
}

function settle(temp, real) {
  const chatId = temp.chatId;
  const list = S.msgs.get(chatId);
  if (list) {
    const hasReal = list.some(x => x.id === real.id);
    const i = list.findIndex(x => x.id === temp.id);
    if (i >= 0) { if (hasReal) list.splice(i, 1); else list[i] = real; }
    else if (!hasReal) upsertMsg(real);
  }
  const chat = S.chats.get(chatId);
  if (chat && (!chat.last || chat.last.createdAt <= real.createdAt)) chat.last = real;
  emit('chats');
  if (cur?.chatId === chatId) {
    const tEl = msgEl(temp.id);
    if (tEl && msgEl(real.id)) tEl.remove();
    else refreshMsg(real.id, temp.id);
  }
}

function dropTemp(temp) {
  const list = S.msgs.get(temp.chatId);
  const i = list?.findIndex(x => x.id === temp.id);
  if (i >= 0) list.splice(i, 1);
  if (cur?.chatId === temp.chatId) msgEl(temp.id)?.remove();
}

async function sendText() {
  const ta = input();
  if (!ta) return;
  const text = ta.value.replace(/\s+$/, '');
  if (!text.trim()) return;
  if (cur.editing) {
    const m = cur.editing;
    try { await patch(`/messages/${m.id}`, { text }); } catch (e) { return fail(e); }
    clearCtx();
    ta.value = draft(cur.chatId);
    autosize(ta);
    return;
  }
  const mentions = [...cur.mentions].filter(id => text.includes('@' + user(id).name));
  const replyTo = cur.replyTo?.id;
  const temp = addTemp({ type: 'text', text, mentions });
  ta.value = '';
  autosize(ta);
  draft(cur.chatId, '');
  cur.mentions.clear();
  cur.replyTo = null;
  renderCtx();
  syncSendBtn();
  typingDone();
  $('[data-suggest]', cur.root).innerHTML = '';
  try {
    const m = await post(`/chats/${temp.chatId}/messages`, { type: 'text', text, mentions, replyTo, clientId: temp.id });
    settle(temp, m);
    sound.sent();
  } catch (e) {
    dropTemp(temp);
    fail(e);
    if (cur?.chatId === temp.chatId && !input().value) { input().value = text; autosize(input()); syncSendBtn(); }
  }
}

async function sendPayload(body, tempFields) {
  const replyTo = cur.replyTo?.id;
  const temp = addTemp(tempFields || body);
  cur.replyTo = null;
  renderCtx();
  try {
    const m = await post(`/chats/${temp.chatId}/messages`, { ...body, replyTo, clientId: temp.id });
    settle(temp, m);
    sound.sent();
    return m;
  } catch (e) { dropTemp(temp); fail(e); return null; }
}

async function pickedFiles(files, asDocuments = false) {
  const items = await composeMedia(files, { title: chatTitle(S.chats.get(cur.chatId)), asDocuments, allowViewOnce: S.chats.get(cur.chatId).type !== 'broadcast' });
  if (items?.length) sendFiles(items);
}

async function sendFiles(items) {
  const chatId = cur.chatId;
  for (const it of items) {
    if (cur?.chatId !== chatId) break;
    let file = it.file;
    if (it.kind === 'image' && !it.hd) file = await compressImage(file);
    let dims = {};
    if (it.kind === 'image') { const d = await imageInfo(file); dims = { width: d.width, height: d.height }; }
    if (it.kind === 'video' || it.kind === 'audio') { const d = await videoInfo(file); dims = { width: d.width, height: d.height, duration: d.duration }; }
    const replyTo = cur.replyTo?.id;
    const temp = addTemp({ type: it.kind, text: it.caption, viewOnce: false, media: { url: it.url, name: file.name, size: file.size, mime: file.type, ...dims }, progress: 0 });
    cur.replyTo = null;
    renderCtx();
    try {
      let last = 0;
      const up = await upload(file, (p) => {
        temp.progress = p;
        if (Date.now() - last > 150 && cur?.chatId === chatId) { last = Date.now(); refreshMsg(temp.id); }
      });
      const m = await post(`/chats/${chatId}/messages`, { type: it.kind, text: it.caption, viewOnce: it.viewOnce, media: { ...up, ...dims, hd: it.hd }, replyTo, clientId: temp.id });
      settle(temp, m);
      sound.sent();
    } catch (e) { dropTemp(temp); fail(e); }
  }
}

function attachMenu(anchor) {
  const pick = (accept, multiple, cb) => pickFiles({ accept, multiple }).then(f => f && cb(f));
  const r = anchor.getBoundingClientRect();
  const menu = ctxMenu({ x: r.left, y: r.top }, [
    { icon: 'file', label: 'Document', onClick: () => pick('', true, (f) => pickedFiles(f, true)) },
    { icon: 'image', label: 'Photos et vidéos', onClick: () => pick('image/*,video/*', true, (f) => pickedFiles(f)) },
    { icon: 'camera', label: 'Appareil photo', onClick: async () => { const f = await takePhoto(); if (f) pickedFiles([f]); } },
    { icon: 'speaker', label: 'Audio', onClick: () => pick('audio/*', true, (f) => pickedFiles(f)) },
    { icon: 'user', label: 'Contact', onClick: sendContact },
    { icon: 'poll', label: 'Sondage', onClick: createPoll },
    { icon: 'calendar', label: 'Évènement (cours, devoir, examen…)', onClick: createEvent },
    { icon: 'pin', label: 'Position', onClick: sendLocation },
  ]);
  placeAt(menu, { x: r.left, y: r.top - menu.offsetHeight - 8 });
}

async function sendContact() {
  const id = await pickMembers({ title: 'Partager un contact' });
  if (!id) return;
  const u = user(id);
  sendPayload({ type: 'contact', contact: { userId: id } }, { type: 'contact', contact: { userId: id, name: u.name, phone: u.phone } });
}

function createPoll() {
  const body = h(`<div>
    <div class="field"><label>Question</label><input class="input" data-q maxlength="255" placeholder="Posez une question"></div>
    <div class="field"><label>Options</label><div data-opts></div></div>
    <label class="choice"><span class="grow">Autoriser plusieurs réponses</span><label class="switch"><input type="checkbox" data-multi><span></span></label></label></div>`);
  const opts = $('[data-opts]', body);
  const addOpt = () => {
    if (opts.children.length >= 12) return;
    const inp = h(`<input class="input" maxlength="100" placeholder="+ Ajouter une option" style="margin-bottom:6px">`);
    inp.oninput = () => { if (inp === opts.lastElementChild && inp.value) addOpt(); };
    opts.append(inp);
  };
  addOpt(); addOpt();
  modal({
    title: 'Créer un sondage', body,
    buttons: [{ label: 'Annuler' }, { label: 'Envoyer', cls: '', onClick: async () => {
      const question = $('[data-q]', body).value.trim();
      const options = [...opts.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
      if (!question || options.length < 2) throw new Error('Une question et au moins 2 options sont nécessaires.');
      const multiple = $('[data-multi]', body).checked;
      sendPayload({ type: 'poll', poll: { question, options, multiple } },
        { type: 'poll', poll: { question, multiple, options: options.map((t, i) => ({ id: 'o' + i, text: t, votes: [] })) } });
    } }],
  });
}

function createEvent() {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 86400e3);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const body = h(`<div>
    <div class="field"><label>Type</label><select class="select" data-kind><option value="cours">Cours</option><option value="devoir">Devoir / rendu</option><option value="examen">Examen / interrogation</option><option value="reunion">Réunion</option><option value="sortie">Sortie</option><option value="autre">Autre</option></select></div>
    <div class="field"><label>Titre</label><input class="input" data-t maxlength="120" placeholder="Ex. Devoir de SQL — chapitre 3"></div>
    <div class="row"><div class="field grow"><label>Date</label><input class="input" type="date" data-d value="${date}"></div>
      <div class="field"><label>Début</label><input class="input" type="time" data-s value="08:00"></div>
      <div class="field"><label>Fin</label><input class="input" type="time" data-e></div></div>
    <div class="field"><label>Lieu (facultatif)</label><input class="input" data-p maxlength="200" placeholder="Salle 12, amphi B, en ligne…"></div>
    <div class="field"><label>Description (facultatif)</label><textarea class="input" rows="3" data-desc maxlength="1000"></textarea></div></div>`);
  modal({
    title: 'Créer un évènement', body,
    buttons: [{ label: 'Annuler' }, { label: 'Envoyer', cls: '', onClick: async () => {
      const title = $('[data-t]', body).value.trim();
      const day = $('[data-d]', body).value;
      if (!title || !day) throw new Error('Titre et date obligatoires.');
      const startsAt = new Date(`${day}T${$('[data-s]', body).value || '08:00'}`).getTime();
      const endsAt = $('[data-e]', body).value ? new Date(`${day}T${$('[data-e]', body).value}`).getTime() : null;
      const ev = { title, startsAt, endsAt, place: $('[data-p]', body).value.trim(), description: $('[data-desc]', body).value.trim(), kind: $('[data-kind]', body).value };
      sendPayload({ type: 'event', event: ev }, { type: 'event', event: { ...ev, responses: {} } });
    } }],
  });
}

async function sendLocation() {
  if (!navigator.geolocation) return toast('Géolocalisation indisponible.', { error: true });
  const mode = await choose('Partager une position', [
    { value: 'now', label: 'Ma position actuelle' },
    { value: '15', label: 'Position en direct · 15 minutes' },
    { value: '60', label: 'Position en direct · 1 heure' },
    { value: '480', label: 'Position en direct · 8 heures' },
  ], 'now', { okLabel: 'Partager' });
  if (!mode) return;
  toast('Localisation en cours…');
  navigator.geolocation.getCurrentPosition(async (p) => {
    const loc = { lat: p.coords.latitude, lng: p.coords.longitude, live: mode !== 'now', liveMinutes: mode === 'now' ? 0 : Number(mode) };
    const m = await sendPayload({ type: 'location', location: loc }, { type: 'location', location: { ...loc, liveUntil: Date.now() + loc.liveMinutes * 60e3 } });
    if (m && loc.live) startLive(m);
  }, () => toast('Impossible d\'obtenir votre position.', { error: true }), { enableHighAccuracy: true, timeout: 15000 });
}

function startLive(m) {
  let last = 0;
  const id = navigator.geolocation.watchPosition((p) => {
    if (Date.now() - last < 15000) return;
    last = Date.now();
    post(`/messages/${m.id}/live`, { lat: p.coords.latitude, lng: p.coords.longitude }).then(r => { if (!r.active) stopLive(m.id, true); }).catch(() => {});
  }, () => {}, { enableHighAccuracy: true });
  liveWatch.set(m.id, id);
  setTimeout(() => stopLive(m.id, true), m.location.liveUntil - Date.now() + 1000);
}
function stopLive(msgId, silent) {
  const w = liveWatch.get(msgId);
  if (w !== undefined) { navigator.geolocation.clearWatch(w); liveWatch.delete(msgId); }
  if (!silent) post(`/messages/${msgId}/live`, { stop: true }).catch(fail);
}

/* ---------------- Messages vocaux ---------------- */
async function startRecording() {
  if (!cur || cur.recorder) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Enregistrement audio non pris en charge par ce navigateur.', { error: true });
  const bar = $('[data-bar]', cur.root);
  let rec;
  const levels = [];
  try {
    rec = await startRecorder((l, t) => {
      levels.push(l);
      const lv = $('[data-lv]', cur?.root || document);
      if (!lv) return;
      lv.insertAdjacentHTML('beforeend', `<i style="height:${Math.max(8, l * 100)}%"></i>`);
      if (lv.children.length > 120) lv.firstElementChild.remove();
      $('[data-t]', cur.root).textContent = new Date(t * 1000).toISOString().slice(14, 19);
    });
  } catch { return toast('Accès au micro refusé.', { error: true }); }
  cur.recorder = rec;
  typingPing('recording');
  bar.hidden = true;
  const ui = h(`<div class="rec" data-rec>
    <button class="icon-btn" data-cancel title="Annuler">${icon('trash')}</button>
    <span class="dot"></span><span data-t>0:00</span>
    <div class="lv" data-lv></div>
    <button class="icon-btn" data-pause title="Pause">${icon('pause')}</button>
    <button class="send" data-ok title="Envoyer" style="width:46px;height:46px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center">${icon('send')}</button></div>`);
  bar.after(ui);
  $('[data-cancel]', ui).onclick = () => stopRecording(true);
  $('[data-pause]', ui).onclick = () => {
    if (rec.paused) { rec.resume(); $('[data-pause]', ui).innerHTML = icon('pause'); $('.dot', ui).style.animationPlayState = 'running'; }
    else { rec.pause(); $('[data-pause]', ui).innerHTML = icon('mic'); $('.dot', ui).style.animationPlayState = 'paused'; }
  };
  $('[data-ok]', ui).onclick = () => stopRecording(false);
}

async function stopRecording(cancel) {
  if (!cur?.recorder) return;
  const rec = cur.recorder;
  cur.recorder = null;
  typingDone();
  $('[data-rec]', cur.root)?.remove();
  const bar = $('[data-bar]', cur.root);
  if (bar) bar.hidden = false;
  if (cancel) return rec.cancel();
  const r = await rec.stop();
  if (!r || r.duration < 0.8) return toast('Message vocal trop court.');
  const chatId = cur.chatId;
  const url = URL.createObjectURL(r.file);
  const replyTo = cur.replyTo?.id;
  const temp = addTemp({ type: 'voice', media: { url, name: r.file.name, size: r.file.size, mime: r.file.type, duration: r.duration, waveform: r.waveform }, progress: 0 });
  cur.replyTo = null;
  renderCtx();
  try {
    const up = await upload(r.file, (p) => { temp.progress = p; });
    const m = await post(`/chats/${chatId}/messages`, { type: 'voice', media: { ...up, duration: r.duration, waveform: r.waveform }, replyTo, clientId: temp.id });
    settle(temp, m);
    sound.sent();
  } catch (e) { dropTemp(temp); fail(e); }
}
