// Notifications push : abonnement de cet appareil pour être prévenu même Scola fermé.
import { get, post } from './api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushState = { active: false };

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function subscribeDevice() {
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await get('/push/key');
  let sub = await reg.pushManager.getSubscription();
  // Clé serveur différente (serveur réinstallé) : on renouvelle l'abonnement.
  if (sub && sub.options?.applicationServerKey) {
    const cur = new Uint8Array(sub.options.applicationServerKey);
    const want = keyBytes(publicKey);
    if (cur.length !== want.length || cur.some((v, i) => v !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await post('/push/subscribe', { subscription: sub.toJSON() });
  pushState.active = true;
  return true;
}

// Au démarrage : si l'utilisateur a déjà autorisé, on (ré)enregistre l'appareil sans rien demander.
export async function syncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try { return await subscribeDevice(); } catch (e) { console.warn('[push]', e); return false; }
}

// À la demande de l'utilisateur (bouton « Activer ») : demande l'autorisation puis abonne.
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  await subscribeDevice();
  return 'granted';
}

// À la déconnexion : cet appareil ne doit plus recevoir les notifications du compte.
export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch {}
  pushState.active = false;
}
