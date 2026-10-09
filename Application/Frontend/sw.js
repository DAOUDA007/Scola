// Service worker : installation de l'application, fonctionnement hors connexion, notifications.
// Comme WhatsApp, Scola s'ouvre sans réseau : l'application, les dernières discussions et les
// médias déjà vus restent sur l'appareil ; tout est rafraîchi dès le retour du réseau.
try { importScripts('/config.js'); } catch {}
const BACKEND = self.SCOLA_BACKEND ? new URL(self.SCOLA_BACKEND).origin : location.origin;
const VERSION = 'v13';
const SHELL = 'scola-shell-' + VERSION;   // code de l'application (HTML, JS, CSS, icônes, stickers)
const API = 'scola-api';                   // dernières réponses de l'API (lecture seule hors connexion)
const MEDIA = 'scola-media';               // photos, vocaux, documents déjà ouverts
const MEDIA_MAX = 400;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    let files = ['/', '/config.js', '/css/app.css', '/icons/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest', '/socket.io/socket.io.js'];
    try { files = [...new Set([...files, ...(await (await fetch('/offline-files.json', { cache: 'no-store' })).json())])]; } catch {}
    // Un fichier introuvable ne doit pas empêcher l'installation.
    await Promise.all(files.map(f => fetch(f, { cache: 'no-store' }).then(r => (r.ok ? c.put(f, r) : null)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('scola-shell') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const offlineCopy = (r) => {
  const h = new Headers(r.headers);
  h.set('X-Scola-Offline', '1');
  return r.blob().then(b => new Response(b, { status: r.status, statusText: r.statusText, headers: h }));
};
async function trimMedia() {
  const c = await caches.open(MEDIA);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MEDIA_MAX))) await c.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || (url.origin !== location.origin && url.origin !== BACKEND)) return;
  // Administration et espace établissement : applications distinctes, jamais interceptées.
  if (/^\/(admin|etablissement)(\/|$)/i.test(url.pathname)) return;
  const p = url.pathname;

  // API : réseau d'abord ; sans réseau, la dernière réponse gardée sur l'appareil.
  if (p.startsWith('/api/')) {
    if (/^\/api\/(auth|health|push|admin|school)/.test(p) || /^\/api\/(me\/export|export)/.test(p)) return;
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(API).then(c => c.put(req, copy)); }
      return r;
    }).catch(async () => {
      const hit = await caches.match(req, { cacheName: API });
      if (hit) return offlineCopy(hit);
      return new Response(JSON.stringify({ error: 'Pas de connexion Internet.' }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-Scola-Offline': '1' } });
    }));
    return;
  }

  // Médias : noms uniques et immuables → l'appareil d'abord. (Les lectures partielles de vidéo passent au réseau.)
  if (p.startsWith('/media/')) {
    if (req.headers.has('range')) return;
    e.respondWith(caches.match(req, { cacheName: MEDIA }).then(hit => hit || fetch(req).then(r => {
      if (r.status === 200) { const copy = r.clone(); caches.open(MEDIA).then(c => c.put(req, copy)).then(trimMedia); }
      return r;
    })));
    return;
  }

  // Temps réel : uniquement le script client est gardé (les échanges en direct passent au réseau).
  if (p.startsWith('/socket.io/') && p !== '/socket.io/socket.io.js') return;

  // Application : réseau d'abord (mises à jour immédiates), sinon la copie de l'appareil.
  const isPage = req.mode === 'navigate';
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(isPage ? '/' : req, copy)); }
    return r;
  }).catch(async () => (await caches.match(isPage ? '/' : req, { ignoreSearch: isPage })) || (await caches.match('/')) || Response.error()));
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
