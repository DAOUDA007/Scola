// File d'attente des messages écrits hors connexion (comme WhatsApp) : ils restent affichés avec
// l'horloge et partent tout seuls au retour du réseau. Gardée sur l'appareil (localStorage), par
// compte. Le serveur ignore un renvoi déjà reçu (même clientId) : jamais de doublon.
import { post } from './api.js';
import { S, emit } from './state.js';

const key = () => 'scola.outbox.' + (S.me?.id || '');
export function items() { try { return JSON.parse(localStorage.getItem(key()) || '[]'); } catch { return []; } }
function store(list) { try { localStorage.setItem(key(), JSON.stringify(list)); } catch {} }
const without = (id) => items().filter(x => x.temp.id !== id);

export function enqueue(temp, body) { store([...without(temp.id), { temp, body: { ...body, clientId: temp.id } }]); }
export function pendingFor(chatId) { return items().filter(x => x.temp.chatId === chatId).map(x => x.temp); }
export function clear() { try { localStorage.removeItem(key()); } catch {} }

let running = false;
export async function flush() {
  if (running || !S.me) return;
  running = true;
  try {
    for (const it of items()) {
      try {
        const real = await post(`/chats/${it.temp.chatId}/messages`, it.body);
        store(without(it.temp.id));
        emit('outbox:sent', { temp: it.temp, real });
      } catch (e) {
        if (e.offline) break; // toujours pas de réseau : on réessaiera
        store(without(it.temp.id)); // refusé par le serveur (bloqué, classe en lecture seule…)
        emit('outbox:failed', { temp: it.temp, error: e });
      }
    }
  } finally { running = false; }
}
