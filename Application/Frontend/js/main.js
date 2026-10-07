// Point d'entrée : démarrage, mise en page, connexion temps réel, notifications.
import { $, $$, h, icon, esc, debounce } from './util.js';
import { get, post, token, setUnauthorizedHandler } from './api.js';
import { S, emit, on, upsertMsg, chatTitle, chatEntity, isMuted, preview, user, totalUnread } from './state.js';
import { toast, banner, sound, closeMenus, pushPage } from './ui.js';
import { nav } from './nav.js';
import { startAuth } from './auth.js';
import * as chatlist from './chatlist.js';
import * as conversation from './conversation.js';
import * as orientation from './orientation.js';
import * as calls from './calls.js';
import * as settings from './settings.js';
import * as classTab from './classtab.js';
import * as info from './info.js';
import { syncPush, disablePush, pushState } from './push.js';

const root = $('#root');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Clic sur une notification alors que Scola est déjà ouvert : on va au message.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open-chat' && S.me) nav.openChat(e.data.chatId, { around: e.data.msgId });
    if (e.data?.type === 'open-url' && S.me) {
      const p = new URL(e.data.url, location.origin).searchParams;
      if (p.get('orientation')) { setTab('orientation'); nav.openChannel(p.get('orientation'), { post: p.get('post') || undefined }); }
      else if (p.get('inquiry')) { setTab('orientation'); nav.openInquiry(p.get('inquiry')); }
    }
  });
}

setUnauthorizedHandler(() => logout(true));

// Comme WhatsApp : une fois connecté, on le reste. Si le serveur est injoignable
// (réseau coupé, serveur en train de démarrer), on garde la session et on réessaie
// tout seul. Seul un refus explicite du serveur (session révoquée) déconnecte.
async function boot(attempt = 0) {
  if (!token.get()) return startAuth(root, () => loadApp());
  try { await loadApp(); }
  catch (e) {
    if (!token.get()) return startAuth(root, () => loadApp());
    const wait = Math.min(15, 2 + attempt * 2);
    root.innerHTML = `<div class="splash"><div class="splash-logo"></div>
      <div class="splash-name" style="font-size:18px;font-weight:500">Connexion à Scola…</div>
      <p class="muted" style="text-align:center;max-width:320px;margin:0">${navigator.onLine ? 'Le serveur démarre, cela peut prendre jusqu\'à une minute.' : 'Pas de connexion Internet.'}<br><small class="faint">Nouvelle tentative dans <span data-s>${wait}</span> s</small></p>
      <button class="btn ghost" data-retry>Réessayer maintenant</button></div>`;
    let left = wait;
    const retry = () => { clearInterval(tick); removeEventListener('online', retry); boot(attempt + 1); };
    const tick = setInterval(() => {
      left--;
      const el = root.querySelector('[data-s]');
      if (el) el.textContent = left;
      if (left <= 0) retry();
    }, 1000);
    root.querySelector('[data-retry]').onclick = retry;
    addEventListener('online', retry);
  }
}

/* ---------- Données ---------- */
function applyBootstrap(b) {
  S.me = b.me;
  S.cls = b.class;
  S.session = b.session;
  S.clockSkew = (b.serverTime || Date.now()) - Date.now();
  S.members = new Map(b.members.map(u => [u.id, u]));
  S.members.set(b.me.id, b.me);
  S.chats = new Map(b.chats.map(c => [c.id, c]));
  S.calls = b.calls;
  applyTheme();
}

export function applyTheme() {
  const s = S.me?.settings || {};
  const theme = s.theme || 'system';
  if (theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('scola.theme', theme); } catch {}
  document.documentElement.dataset.font = s.fontSize || 'medium';
}

async function loadApp() {
  const b = await get('/bootstrap');
  applyBootstrap(b);
  renderLayout();
  connect();
  const params = new URLSearchParams(location.search);
  const q = params.get('chat');
  const u = params.get('user');
  if (u && S.members.has(u)) post('/chats/dm/' + u).then(c => { S.chats.set(c.id, c); emit('chats'); nav.openChat(c.id); }).catch(() => {});
  else if (u) toast('Ce code QR appartient à un élève d\'une autre classe.');
  // Ouverture depuis une notification : ?chat=…&msg=… mène directement au message.
  else if (q) nav.openChat(q, { around: params.get('msg') || undefined });
  // Orientation : publication d'une chaîne (notification, lien partagé) ou échange avec un établissement.
  const ori = params.get('orientation'), inq = params.get('inquiry');
  if (ori) { setTab('orientation'); orientation.openChannel(ori, { post: params.get('post') || undefined }); }
  else if (inq) { setTab('orientation'); orientation.openInquiry(inq); }
  if (q || u || ori || inq || params.get('join')) history.replaceState(null, '', '/');
  orientation.loadOrientation();
  syncPush().then(() => emit('push'));
}

nav.refresh = async () => {
  const b = await get('/bootstrap');
  applyBootstrap(b);
  emit('chats'); emit('calls'); orientation.loadOrientation(); emit('class'); emit('members');
  if (S.current) emit('chat:reload', S.current);
};

/* ---------- Mise en page ---------- */
const TABS = [
  ['chats', 'chat', 'Discussions'],
  ['class', 'cap', 'Ma classe'],
  ['orientation', 'megaphone', 'Orientation'],
  ['calls', 'phone', 'Appels'],
  ['settings', 'settings', 'Paramètres'],
];

function renderLayout() {
  root.innerHTML = `<div class="app" id="app">
    <nav class="rail">
      <div class="logo" title="Scola"></div>
      ${TABS.map(([id, ic, label]) => `<button class="rail-btn" data-tab="${id}" title="${label}" aria-label="${label}">${icon(ic)}<span class="lbl">${label}</span></button>`).join('')}
      <div class="spacer"></div>
      <button class="rail-btn me-btn" data-me title="Profil"></button>
    </nav>
    <aside class="side" id="side"></aside>
    <main class="main" id="main"></main>
    <aside class="drawer" id="drawer"></aside>
  </div>`;
  nav.els = { app: $('#app'), side: $('#side'), main: $('#main'), drawer: $('#drawer') };
  $('.rail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) setTab(b.dataset.tab);
    if (e.target.closest('[data-me]')) { setTab('settings'); settings.openProfile(); }
  });
  renderMe();
  setTab('chats');
  conversation.renderEmpty();
  updateBadges();
}

function renderMe() {
  const b = $('[data-me]');
  if (b) b.innerHTML = `<div style="--s:34px" class="av">${S.me.avatar ? `<img src="${esc(S.me.avatar)}">` : esc(S.me.name[0] || '?')}</div>`;
  if (b && !S.me.avatar) b.firstElementChild.style.background = 'var(--brand)';
}

export function setTab(tab) {
  S.tab = tab;
  $$('.rail-btn[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const side = nav.els.side;
  side.innerHTML = '';
  ({ chats: chatlist, orientation, calls, settings, class: classTab })[tab].render(side);
  if (tab === 'calls') { try { localStorage.setItem('scola.callsSeen', Date.now()); } catch {} }
  updateBadges();
}
nav.setTab = setTab;

export function updateBadges() {
  const set = (tab, html) => {
    const b = $(`.rail-btn[data-tab=${tab}]`);
    if (!b) return;
    b.querySelector('.badge, .dotb')?.remove();
    if (html) b.insertAdjacentHTML('beforeend', html);
  };
  const n = totalUnread();
  set('chats', n ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : '');
  const ori = orientation.unreadTotal();
  set('orientation', ori ? `<span class="badge">${ori > 99 ? '99+' : ori}</span>` : '');
  let seen = 0;
  try { seen = Number(localStorage.getItem('scola.callsSeen')) || 0; } catch {}
  const missed = S.tab === 'calls' ? 0 : S.calls.filter(c => c.missed && c.startedAt > seen).length;
  set('calls', missed ? `<span class="badge">${missed}</span>` : '');
  document.title = n ? `(${n}) Scola` : 'Scola';
}
on('chats', updateBadges);
on('orientation', updateBadges);
on('calls', updateBadges);
on('me', () => { renderMe(); applyTheme(); });

/* ---------- Tiroir d'infos (droite) ---------- */
nav.openDrawer = (opts) => {
  const d = nav.els.drawer;
  nav.els.app.classList.add('drawer-open');
  if (!opts.stack) d.innerHTML = '';
  return pushPage(d, {
    ...opts,
    onClose: () => { opts.onClose?.(); setTimeout(() => { if (!d.querySelector('.page:not(.out)')) nav.els.app.classList.remove('drawer-open'); }, 0); },
  });
};
nav.closeDrawer = () => { nav.els.drawer.innerHTML = ''; nav.els.app.classList.remove('drawer-open'); };
nav.openProfile = (uid) => info.openUser(uid);

/* ---------- Temps réel ---------- */
let wasDisconnected = false;
function connect() {
  const socket = io({ auth: { token: token.get() }, transports: ['websocket', 'polling'] });
  S.socket = socket;
  socket.on('connect_error', (e) => { if (e.message === 'auth') logout(true); });
  socket.on('connect', async () => {
    if (wasDisconnected) { wasDisconnected = false; try { await nav.refresh(); } catch {} }
  });
  socket.on('disconnect', () => { wasDisconnected = true; });
  socket.on('session:revoked', () => logout(true));

  socket.on('msg:new', async (m) => {
    let chat = S.chats.get(m.chatId);
    if (!chat) {
      try { chat = await get('/chats/' + m.chatId); S.chats.set(chat.id, chat); } catch { return; }
    }
    const mine = m.senderId === S.me.id;
    upsertMsg(m);
    chat.last = m;
    if (chat.state) chat.state.hidden = false;
    const viewing = S.current === m.chatId && document.visibilityState === 'visible' && document.hasFocus();
    if (!mine && (m.type !== 'system' || m.meta?.announce) && !viewing) {
      chat.unread = (chat.unread || 0) + 1;
      if (m.mentions?.includes(S.me.id)) chat.mentioned = true;
    }
    clearTyping(m.chatId, m.senderId);
    emit('msg:new', m);
    emit('chats');
    if (!mine && (m.type !== 'system' || m.meta?.announce)) notifyMessage(m, chat, viewing);
  });
  socket.on('msg:update', (m) => {
    upsertMsg(m);
    const chat = S.chats.get(m.chatId);
    if (chat?.last?.id === m.id) chat.last = m;
    emit('msg:update', m);
    emit('chats');
  });
  socket.on('msg:status', (list) => {
    for (const s of list) {
      const m = S.msgs.get(s.chatId)?.find(x => x.id === s.id);
      if (m) m.status = s.status;
      const chat = S.chats.get(s.chatId);
      if (chat?.last?.id === s.id) chat.last.status = s.status;
    }
    emit('msg:status', list);
    emit('chats');
  });
  socket.on('msg:remove', async ({ chatId, id }) => {
    const list = S.msgs.get(chatId);
    if (list) { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); }
    const chat = S.chats.get(chatId);
    if (chat?.last?.id === id) { try { S.chats.set(chatId, await get('/chats/' + chatId)); } catch {} }
    emit('msg:remove', { chatId, id });
    emit('chats');
  });
  socket.on('msg:reacted', ({ chatId, id, by, emoji }) => {
    const chat = S.chats.get(chatId);
    if (!chat || isMuted(chat) || (S.current === chatId && document.hasFocus())) return;
    const m = S.msgs.get(chatId)?.find(x => x.id === id);
    showNotif({ chat, title: chatTitle(chat), text: `${user(by).name} a réagi ${emoji} à : ${m ? preview(m) : 'votre message'}` });
  });
  socket.on('chat:update', (c) => { S.chats.set(c.id, c); emit('chats'); emit('chat:meta', c.id); });
  socket.on('chat:remove', ({ chatId }) => {
    S.chats.delete(chatId); S.msgs.delete(chatId);
    if (S.current === chatId) nav.closeChat();
    emit('chats');
  });
  socket.on('chat:cleared', ({ chatId }) => { S.msgs.delete(chatId); emit('chat:reload', chatId); });
  socket.on('typing', ({ chatId, userId, state }) => {
    if (!state) return clearTyping(chatId, userId);
    if (!S.typing.has(chatId)) S.typing.set(chatId, new Map());
    const map = S.typing.get(chatId);
    clearTimeout(map.get(userId)?.t);
    map.set(userId, { state, t: setTimeout(() => clearTyping(chatId, userId), 7000) });
    emit('typing', chatId);
  });
  socket.on('presence', ({ userId, online, lastSeen }) => {
    const u = S.members.get(userId);
    if (!u || S.me.privacy.lastSeen !== 'all') return;
    u.online = online; u.lastSeen = lastSeen;
    emit('presence', userId);
  });
  socket.on('user:update', (u) => {
    if (u.id === S.me.id) return;
    S.members.set(u.id, u);
    emit('presence', u.id);
    emit('chats');
  });
  socket.on('member:join', (u) => {
    S.members.set(u.id, u);
    if (S.cls) S.cls.memberCount = (S.cls.memberCount || 0) + 1;
    emit('members');
  });
  socket.on('class:update', (c) => { S.cls = c; emit('class'); emit('chats'); });
  // L'administration a modifié le compte (ex. changement de classe) : on recharge.
  socket.on('reload', () => location.reload());

  calls.attach(socket);
  orientation.attach(socket);

  const markRead = debounce(() => {
    if (S.current && document.visibilityState === 'visible') conversation.markRead();
  }, 300);
  addEventListener('focus', markRead);
  document.addEventListener('visibilitychange', markRead);
}

function clearTyping(chatId, userId) {
  const map = S.typing.get(chatId);
  if (!map?.has(userId)) return;
  clearTimeout(map.get(userId).t);
  map.delete(userId);
  emit('typing', chatId);
}

/* ---------- Notifications ---------- */
function notifyMessage(m, chat, viewing) {
  if (viewing) return;
  if (isMuted(chat)) return;
  const n = S.me.settings.notifications;
  const mentioned = m.mentions?.includes(S.me.id) || m.meta?.announce;
  if (chat.type === 'group' ? !n.groups && !mentioned : !n.messages) return;
  const author = m.meta?.announce ? '📢 Administration' : user(m.senderId).name;
  const title = chat.type === 'group' ? chatTitle(chat) : author;
  const body = n.preview ? (chat.type === 'group' ? `${author} : ` : '') + preview(m) : 'Nouveau message';
  showNotif({ chat, title, text: body, tag: chat.id, msgId: m.id });
}

async function showNotif({ chat, title, text, tag, msgId }) {
  sound.message();
  if (document.visibilityState === 'visible') {
    if (S.current !== chat.id || !document.hasFocus()) banner({ title, text, entity: chatEntity(chat), opts: { group: chat.type === 'group' }, onClick: () => nav.openChat(chat.id, { around: msgId }) });
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // Appareil abonné : c'est le serveur qui envoie la notification (pas de doublon).
  if (pushState.active) return;
  const opts = { body: text, tag, icon: chatEntity(chat)?.avatar || chatEntity(chat)?.icon || '/icons/icon.svg', badge: '/icons/icon.svg', data: { chatId: chat.id, msgId, url: `/?chat=${encodeURIComponent(chat.id)}${msgId ? '&msg=' + encodeURIComponent(msgId) : ''}` }, renotify: true };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, opts);
    else { const nt = new Notification(title, opts); nt.onclick = () => { focus(); nav.openChat(chat.id); }; }
  } catch {}
}

/* ---------- Déconnexion ---------- */
async function logout(silent = false) {
  await disablePush();
  if (!silent) { try { await post('/me/logout'); } catch {} }
  token.clear();
  try { S.socket?.disconnect(); } catch {}
  location.href = '/';
}
nav.logout = logout;

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#layer').children.length) return;
    closeMenus();
    if (nav.els.app?.classList.contains('drawer-open')) return nav.closeDrawer();
    if (S.current && innerWidth > 900) nav.closeChat();
  }
});

// Retour arrière sur mobile : ferme la conversation au lieu de quitter l'application.
addEventListener('popstate', () => {
  if (nav.els.app?.classList.contains('drawer-open')) nav.closeDrawer();
  else if (S.current) nav.closeChat(true);
  else if (nav.hasPanel?.()) nav.closePanel(true);
});

boot();
