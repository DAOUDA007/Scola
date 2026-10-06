// Service worker : installation de l'application, coquille hors-ligne, notifications.
// v2 : purge les anciens caches, qui pouvaient contenir la page élève enregistrée sous /admin.
const CACHE = 'scola-shell-v2';
const SHELL = ['/', '/css/app.css', '/icons/icon.svg', '/manifest.webmanifest'];

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
  if (/^\/admin(\/|$)/i.test(url.pathname)) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const chatId = e.notification.data?.chatId;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list[0];
    if (c) { c.focus(); if (chatId) c.postMessage({ type: 'open-chat', chatId }); return; }
    return self.clients.openWindow(chatId ? '/?chat=' + encodeURIComponent(chatId) : '/');
  }));
});
