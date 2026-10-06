// Socket.IO : présence (en ligne / vu à), « écrit… », accusés de réception,
// et signalisation WebRTC des appels vocaux et vidéo (individuels et de groupe).
const C = require('./core');
const { verifyToken } = require('./auth');
const { callView } = require('./api');
const push = require('./push');
const { data, save } = C;

const MAX_CALL_PARTICIPANTS = 8; // maillage pair-à-pair : au-delà, la qualité chute
const RING_MS = 45_000;
const active = C.activeCalls;

module.exports = function realtime(io) {
  C.setIo(io);

  io.use((socket, next) => {
    const v = verifyToken(socket.handshake.auth?.token);
    if (!v) return next(new Error('auth'));
    socket.data.userId = v.user.id;
    socket.data.sid = v.session.id;
    next();
  });

  function presence(u) {
    if (u.privacy.lastSeen !== 'all') return;
    io.to('seen:' + u.classId).emit('presence', { userId: u.id, online: C.isOnline(u.id), lastSeen: u.lastSeen });
  }

  function markDelivered(u) {
    const t = C.now();
    const chatIds = [u.classId, ...Object.values(data.chats).filter(c => c.type === 'dm' && c.members.includes(u.id)).map(c => c.id)];
    const bySender = {};
    for (const id of chatIds) {
      const list = data.messages[id] || [];
      for (let i = Math.max(0, list.length - 500); i < list.length; i++) {
        const m = list[i];
        if (!(m.recipients || []).includes(u.id) || m.deliveredTo[u.id]) continue;
        m.deliveredTo[u.id] = t;
        (bySender[m.senderId] ||= []).push({ id: m.id, chatId: id, status: C.deliveryStatus(m) });
      }
    }
    if (Object.keys(bySender).length) save();
    for (const [s, list] of Object.entries(bySender)) C.toUser(s, 'msg:status', list);
  }

  /* ---------- Appels ---------- */

  function callPublic(call) {
    return { callId: call.id, chatId: call.chatId, video: call.video, callerId: call.callerId, group: call.group, participants: [...call.sockets.keys()], startedAt: call.startedAt };
  }

  function announce(call) {
    // Bandeau « appel en cours — rejoindre » pour les membres de la discussion.
    const chat = data.chats[call.chatId];
    C.toUsers(C.chatMembers(chat), 'call:active', callPublic(call));
  }

  function logFor(call) {
    const rec = data.calls[call.id];
    for (const id of rec.invited) if (C.isOnline(id)) C.toUser(id, 'call:log', callView(rec, id));
  }

  function endCall(call, reason) {
    if (!active.has(call.id)) return;
    clearTimeout(call.ringTimer);
    active.delete(call.id);
    const rec = data.calls[call.id];
    rec.endedAt = C.now();
    rec.reason = reason;
    save();
    const chat = data.chats[call.chatId];
    C.toUsers([...new Set([...rec.invited, ...C.chatMembers(chat)])], 'call:ended', { callId: call.id, chatId: call.chatId, reason });
    logFor(call);
    if (!rec.answeredAt && !call.group) {
      for (const id of rec.invited) {
        if (id === rec.callerId) continue;
        C.toUser(id, 'call:missed', { callId: call.id, callerId: rec.callerId, video: rec.video });
        if (reason !== 'declined') push.notifyMissedCall(rec.callerId, id, rec.video, call.chatId);
      }
    }
  }

  function leave(call, userId, reason = 'left') {
    if (!call.sockets.has(userId)) return;
    call.sockets.delete(userId);
    for (const [id, sid] of call.sockets) io.to(sid).emit('call:left', { callId: call.id, userId });
    if (!call.group || call.sockets.size === 0 || (call.sockets.size === 1 && !data.calls[call.id].answeredAt)) endCall(call, reason);
    else announce(call);
  }

  io.on('connection', (socket) => {
    const u = data.users[socket.data.userId];
    if (!u) return socket.disconnect(true);
    socket.join('u:' + u.id);
    socket.join('s:' + socket.data.sid);
    if (u.privacy.lastSeen === 'all') socket.join('seen:' + u.classId);

    const wasOnline = C.isOnline(u.id);
    C.online.set(u.id, (C.online.get(u.id) || 0) + 1);
    if (!wasOnline) presence(u);
    markDelivered(u);
    // Appels en cours dans ses discussions (pour rejoindre un appel de groupe).
    for (const call of active.values()) if (C.canAccess(data.chats[call.chatId], u.id)) socket.emit('call:active', callPublic(call));

    socket.on('typing', ({ chatId, state } = {}) => {
      const chat = data.chats[chatId];
      if (!C.canAccess(chat, u.id) || chat.type === 'broadcast') return;
      const ids = C.chatMembers(chat).filter(x => x !== u.id && C.isOnline(x));
      C.toUsers(ids, 'typing', { chatId, userId: u.id, state: state === 'recording' ? 'recording' : state ? 'typing' : null });
    });

    socket.on('call:start', ({ chatId, video, userIds } = {}, ack = () => {}) => {
      const chat = data.chats[chatId];
      if (!C.canAccess(chat, u.id) || chat.type === 'broadcast') return ack({ error: 'Discussion introuvable.' });
      for (const c of active.values()) if (c.chatId === chatId) return ack({ error: 'Un appel est déjà en cours dans cette discussion.', callId: c.id });
      let invited;
      const group = chat.type === 'group';
      if (group) {
        const members = C.chatMembers(chat);
        invited = [u.id, ...(Array.isArray(userIds) ? userIds : []).filter(x => x !== u.id && members.includes(x))].slice(0, 32);
      } else {
        const peer = chat.members.find(x => x !== u.id);
        if (!peer) return ack({ error: 'Impossible de s\'appeler soi-même.' });
        if (C.blocks(u.id, peer)) return ack({ error: 'Débloquez ce contact pour l\'appeler.' });
        if (C.blocks(peer, u.id)) return ack({ error: 'Appel impossible.' });
        invited = [u.id, peer];
      }
      const id = C.uid('call_');
      const call = { id, chatId, video: !!video, callerId: u.id, group, sockets: new Map([[u.id, socket.id]]), startedAt: C.now() };
      active.set(id, call);
      data.calls[id] = { id, chatId, video: !!video, callerId: u.id, invited, everJoined: [u.id], startedAt: call.startedAt, answeredAt: null, endedAt: null };
      save();
      const ringing = invited.filter(x => x !== u.id && !C.blocks(x, u.id));
      const busy = !group && ringing.some(x => [...active.values()].some(c => c.id !== id && c.sockets.has(x)));
      C.toUsers(ringing, 'call:incoming', { ...callPublic(call), busy });
      call.ringTimer = setTimeout(() => {
        if (!active.has(id)) return;
        if (!data.calls[id].answeredAt) endCall(call, 'missed');
        else C.toUsers(ringing.filter(x => !call.sockets.has(x)), 'call:stopring', { callId: id });
      }, RING_MS);
      if (group) announce(call);
      ack({ callId: id, call: callPublic(call), busy });
    });

    socket.on('call:accept', ({ callId } = {}, ack = () => {}) => {
      const call = active.get(callId);
      if (!call) return ack({ error: 'Cet appel est terminé.' });
      const rec = data.calls[callId];
      const chat = data.chats[call.chatId];
      if (!C.canAccess(chat, u.id) || (!call.group && !rec.invited.includes(u.id))) return ack({ error: 'Accès refusé.' });
      if (call.sockets.size >= MAX_CALL_PARTICIPANTS && !call.sockets.has(u.id)) return ack({ error: `Appel complet (${MAX_CALL_PARTICIPANTS} participants maximum).` });
      const others = [...call.sockets.keys()].filter(x => x !== u.id);
      call.sockets.set(u.id, socket.id);
      if (!rec.invited.includes(u.id)) rec.invited.push(u.id);
      if (!rec.everJoined.includes(u.id)) rec.everJoined.push(u.id);
      if (!rec.answeredAt) rec.answeredAt = C.now();
      save();
      socket.to('u:' + u.id).emit('call:stopring', { callId }); // ses autres appareils
      for (const id of others) io.to(call.sockets.get(id)).emit('call:joined', { callId, userId: u.id });
      if (call.group) announce(call);
      ack({ ok: true, call: callPublic(call), peers: others });
    });

    socket.on('call:decline', ({ callId } = {}) => {
      const call = active.get(callId);
      if (!call) return;
      C.toUser(u.id, 'call:stopring', { callId });
      if (!call.group && data.calls[callId].invited.includes(u.id)) endCall(call, 'declined');
    });

    socket.on('call:leave', ({ callId } = {}) => {
      const call = active.get(callId);
      if (call && call.sockets.get(u.id) === socket.id) leave(call, u.id, call.callerId === u.id && !data.calls[callId].answeredAt ? 'cancelled' : 'left');
    });

    socket.on('rtc:signal', ({ callId, to, data: payload } = {}) => {
      const call = active.get(callId);
      if (!call || call.sockets.get(u.id) !== socket.id || !call.sockets.has(to)) return;
      io.to(call.sockets.get(to)).emit('rtc:signal', { callId, from: u.id, data: payload });
    });

    socket.on('call:media', ({ callId, audio, video, screen } = {}) => {
      const call = active.get(callId);
      if (!call || call.sockets.get(u.id) !== socket.id) return;
      for (const [id, sid] of call.sockets) if (id !== u.id) io.to(sid).emit('call:media', { callId, userId: u.id, audio: !!audio, video: !!video, screen: !!screen });
    });

    socket.on('disconnect', () => {
      for (const call of [...active.values()]) if (call.sockets.get(u.id) === socket.id) leave(call, u.id);
      const n = (C.online.get(u.id) || 1) - 1;
      if (n <= 0) {
        C.online.delete(u.id);
        u.lastSeen = C.now();
        save();
        presence(u);
      } else C.online.set(u.id, n);
    });
  });
};
