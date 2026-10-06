// État global de l'application + bus d'évènements.
import { stripFormat } from './util.js';

export const S = {
  me: null,
  cls: null,
  members: new Map(),   // id -> utilisateur public
  chats: new Map(),     // id -> résumé de discussion
  msgs: new Map(),      // id discussion -> [messages] (chargés)
  hasMore: new Map(),
  statuses: [],
  calls: [],
  activeCalls: new Map(), // id appel -> appel en cours (bandeau « rejoindre »)
  typing: new Map(),      // id discussion -> Map(id utilisateur -> { state, at })
  current: null,          // discussion ouverte
  tab: 'chats',
  socket: null,
  session: null,
  pendingUploads: new Map(),
  clockSkew: 0,
};

const listeners = new Map();
export function on(ev, fn) {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev).add(fn);
  return () => listeners.get(ev).delete(fn);
}
export function emit(ev, data) {
  for (const fn of listeners.get(ev) || []) {
    try { fn(data); } catch (e) { console.error(ev, e); }
  }
}

export function user(id) {
  if (!id) return { id: 'scola', name: 'Scola' };
  if (S.me && id === S.me.id) return S.me;
  return S.members.get(id) || { id, name: 'Ancien membre', deleted: true };
}

export function displayName(id) {
  if (S.me && id === S.me.id) return 'Vous';
  return user(id).name;
}

export function chatTitle(chat) {
  if (!chat) return '';
  if (chat.type === 'group') return S.cls?.name || 'Ma classe';
  if (chat.type === 'broadcast') return chat.name || 'Liste de diffusion';
  if (chat.peerId === S.me.id) return `${S.me.name} (vous)`;
  return user(chat.peerId).name;
}

export function chatEntity(chat) {
  if (!chat) return null;
  if (chat.type === 'group') return { ...S.cls, icon: S.cls?.icon };
  if (chat.type === 'broadcast') return { id: chat.id, name: chat.name };
  return user(chat.peerId);
}

export function isMuted(chat) { return !!chat?.state?.mutedUntil && (chat.state.mutedUntil === -1 || chat.state.mutedUntil > Date.now()); }

// Les réglages de la classe sont décidés par l'administration du site.
export function canEditClass() { return !!S.cls?.settings?.membersEditInfo; }

export function blocked(uid) { return S.me?.blocked?.includes(uid); }

export function preview(m) {
  if (!m) return '';
  if (m.deleted) return m.senderId === S.me.id ? 'Vous avez supprimé ce message' : 'Ce message a été supprimé';
  if (m.meta?.announce) return '📢 Annonce : ' + stripFormat(m.text || m.preview);
  if (m.preview !== undefined) return stripFormat(m.preview);
  switch (m.type) {
    case 'image': return '📷 ' + (stripFormat(m.text) || 'Photo');
    case 'video': return '🎥 ' + (stripFormat(m.text) || 'Vidéo');
    case 'audio': return '🎵 ' + (m.media?.name || 'Audio');
    case 'voice': return '🎤 Message vocal';
    case 'document': return '📄 ' + (m.media?.name || 'Document');
    case 'location': return '📍 Position';
    case 'contact': return '👤 ' + (m.contact?.name || 'Contact');
    case 'poll': return '📊 ' + (m.poll?.question || 'Sondage');
    case 'event': return '📅 ' + (m.event?.title || 'Évènement');
    default: return stripFormat(m.text);
  }
}

export function upsertMsg(m) {
  const list = S.msgs.get(m.chatId);
  if (!list) return false;
  const i = list.findIndex(x => x.id === m.id || (m.clientId && x.id === m.clientId));
  if (i >= 0) { list[i] = m; return 'update'; }
  // Insertion triée par date.
  let j = list.length;
  while (j > 0 && list[j - 1].createdAt > m.createdAt) j--;
  list.splice(j, 0, m);
  return 'insert';
}

export function sortedChats() {
  return [...S.chats.values()].sort((a, b) => {
    if (!!b.state?.pinned - !!a.state?.pinned) return !!b.state?.pinned - !!a.state?.pinned;
    return (b.last?.createdAt || b.createdAt) - (a.last?.createdAt || a.createdAt);
  });
}

export function totalUnread() {
  let n = 0;
  for (const c of S.chats.values()) if (!c.state?.archived && (c.unread || c.state?.markedUnread)) n++;
  return n;
}

export function draft(chatId, value) {
  const k = 'scola.draft.' + chatId;
  try {
    if (value === undefined) return localStorage.getItem(k) || '';
    if (value) localStorage.setItem(k, value); else localStorage.removeItem(k);
  } catch { return ''; }
}
