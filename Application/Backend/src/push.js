// Notifications push (Web Push) : prévenir le destinataire d'un message même quand
// Scola est fermé. Un clic sur la notification ouvre directement le message.
const crypto = require('crypto');
const webpush = require('web-push');
const C = require('./core');
const { data, save } = C;

// Clés VAPID générées une fois et conservées dans la base (survivent aux redémarrages).
if (!data.meta.vapid) {
  data.meta.vapid = webpush.generateVAPIDKeys();
  save();
}
data.pushSubs ||= {};
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contact@scola.app', data.meta.vapid.publicKey, data.meta.vapid.privateKey);

const keyOf = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);

function publicKey() { return data.meta.vapid.publicKey; }

function subscribe(userId, sessionId, sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
    const e = new Error('Abonnement aux notifications invalide.'); e.status = 400; throw e;
  }
  data.pushSubs[keyOf(sub.endpoint)] = {
    userId, sessionId, at: C.now(),
    sub: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
  };
  save();
}

function unsubscribe(endpoint) {
  if (data.pushSubs[keyOf(endpoint)]) { delete data.pushSubs[keyOf(endpoint)]; save(); }
}

// Envoie à tous les appareils encore connectés de l'utilisateur.
async function sendTo(userId, payload) {
  const u = data.users[userId];
  if (!u || u.deleted || u.suspended) return;
  const body = JSON.stringify(payload);
  for (const [k, s] of Object.entries(data.pushSubs)) {
    if (s.userId !== userId) continue;
    if (!data.sessions[s.sessionId]) { delete data.pushSubs[k]; save(); continue; } // appareil déconnecté
    try {
      await webpush.sendNotification(s.sub, body, { TTL: 24 * 3600, urgency: 'high', topic: String(payload.tag || '').replace(/[^\w-]/g, '').slice(0, 32) || undefined });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { delete data.pushSubs[k]; save(); }
      else console.warn('[push] envoi échoué :', e.statusCode || '', e.body || e.message);
    }
  }
}

function previewOf(m) {
  if (m.viewOnce) return m.type === 'video' ? '🎥 Vidéo à vue unique' : m.type === 'voice' ? '🎤 Vocal à écoute unique' : '📷 Photo à vue unique';
  return C.snippet(m).replace(/```/g, '').slice(0, 180);
}

// Message envoyé (ou annonce de l'administration) : on prévient chaque destinataire.
function notifyMessage(m) {
  const chat = data.chats[m.chatId];
  if (!chat || m.deletedForAll) return;
  const announce = !!m.meta?.announce;
  if (m.type === 'system' && !announce) return;
  const sender = m.senderId ? data.users[m.senderId] : null;
  const targets = announce ? C.chatMembers(chat) : (m.recipients || []);
  const cls = chat.type === 'group' ? data.classes[chat.id] : null;
  for (const uid of targets) {
    if (uid === m.senderId || (m.deletedFor || []).includes(uid)) continue;
    const u = data.users[uid];
    if (!u || u.deleted) continue;
    const n = u.settings?.notifications || {};
    const mentioned = (m.mentions || []).includes(uid);
    const uc = C.getUC(uid, chat.id);
    const muted = uc.mutedUntil === -1 || uc.mutedUntil > C.now();
    if (muted && !announce) continue;
    if (chat.type === 'group' ? (!n.groups && !mentioned && !announce) : !n.messages) continue;
    const who = announce ? '📢 Administration' : (sender?.name || 'Scola');
    const title = cls ? cls.name : who;
    const text = n.preview === false ? (announce ? 'Nouvelle annonce' : 'Nouveau message') : (cls ? `${mentioned ? '@ ' : ''}${who} : ` : '') + previewOf(m);
    sendTo(uid, {
      title, body: text, tag: chat.id, chatId: chat.id, msgId: m.id,
      url: `/?chat=${encodeURIComponent(chat.id)}&msg=${encodeURIComponent(m.id)}`,
      icon: (cls ? cls.icon : sender?.privacy?.avatar === 'all' ? sender.avatar : null) || '/icons/icon-192.png',
      at: m.createdAt,
    });
  }
}

function notifyMissedCall(callerId, userId, video, chatId) {
  const u = data.users[userId];
  if (!u || u.settings?.notifications?.calls === false) return;
  sendTo(userId, {
    title: 'Appel manqué', body: `Appel ${video ? 'vidéo' : 'vocal'} de ${data.users[callerId]?.name || 'un camarade'}`,
    tag: 'call-' + callerId, chatId, url: `/?chat=${encodeURIComponent(chatId)}`, icon: '/icons/icon-192.png', at: C.now(),
  });
}

module.exports = { publicKey, subscribe, unsubscribe, notifyMessage, notifyMissedCall, sendTo };
