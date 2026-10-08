// Service worker : installation de l'application, coquille hors-ligne, notifications.
// v2 : purge les anciens caches, qui pouvaient contenir la page élève enregistrée sous /admin.
const CACHE = 'scola-shell-v8';
const SHELL = ['/', '/css/app.css', '/icons/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Réseau d'abord pour l'application, cache en secours ; les API et médias ne sont jamais mis en cache ici.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/media/')) return;
  // L'espace d'administration est une application distincte : jamais intercepté ni
  // remplacé par la page des élèves (même serveur arrêté).
  if (/^\/(admin|etablissement)(\/|$)/i.test(url.pathname)) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});

// Notification push envoyée par le serveur (nouveau message, annonce, appel manqué).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil((async () => {
    // Scola est ouvert et au premier plan : l'application affiche déjà sa propre bannière.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some(w => w.focused && w.visibilityState === 'visible' && new URL(w.url).pathname === '/')) return;
    await self.registration.showNotification(d.title || 'Scola', {
      body: d.body || 'Nouveau message',
      icon: d.icon || '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      timestamp: d.at || Date.now(),
      vibrate: [120, 60, 120],
      data: { url: d.url || '/', chatId: d.chatId, msgId: d.msgId },
    });
  })());
});

// Clic sur la notification : raccourci vers le message dans Scola.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { chatId, msgId, url } = e.notification.data || {};
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
    const c = list.find(w => new URL(w.url).pathname === '/');
    if (c) {
      await c.focus().catch(() => {});
      if (chatId) c.postMessage({ type: 'open-chat', chatId, msgId });
      else if (url) c.postMessage({ type: 'open-url', url }); // Orientation : chaîne, publication, échange
      return;
    }
    return self.clients.openWindow(url || (chatId ? '/?chat=' + encodeURIComponent(chatId) + (msgId ? '&msg=' + encodeURIComponent(msgId) : '') : '/'));
  }));
});
