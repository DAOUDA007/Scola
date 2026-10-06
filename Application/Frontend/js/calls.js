// Appels vocaux et vidéo (WebRTC, maillage pair-à-pair) + onglet « Appels ».
import { $, h, esc, icon, avatar, listTime, duration, fullDate } from './util.js';
import { get, post, del } from './api.js';
import { S, emit, user, chatTitle } from './state.js';
import { toast, fail, ctxMenu, confirmBox, pickMembers, sound } from './ui.js';
import { nav } from './nav.js';
import { live } from './chatlist.js';

let call = null;      // appel en cours sur cet appareil
let incoming = null;  // appel entrant affiché
let ICE = null;

async function iceServers() {
  if (!ICE) ICE = await get('/ice').catch(() => [{ urls: 'stun:stun.l.google.com:19302' }]);
  return ICE;
}

function callChatTitle(c) {
  if (c.group || S.chats.get(c.chatId)?.type === 'group') return S.cls?.name || 'Ma classe';
  const chat = S.chats.get(c.chatId);
  const peer = c.peerId || chat?.peerId || (c.callerId !== S.me.id ? c.callerId : null);
  return peer ? user(peer).name : chatTitle(chat);
}
function callEntity(c) {
  if (c.group || S.chats.get(c.chatId)?.type === 'group') return { ...S.cls };
  const chat = S.chats.get(c.chatId);
  return user(c.peerId || chat?.peerId || c.callerId);
}

/* ---------------- Onglet Appels ---------------- */
export function render(side) {
  side.innerHTML = `<div class="panel-head"><h1>Appels</h1>
      <button class="icon-btn" data-new title="Nouvel appel">${icon('phone')}</button>
      <button class="icon-btn" data-menu title="Menu">${icon('more')}</button></div>
    <div class="list scroll" data-list></div>`;
  const list = $('[data-list]', side);
  const draw = () => {
    const active = [...S.activeCalls.values()].filter(c => c.group && !c.participants.includes(S.me.id));
    list.innerHTML = `
      <div class="menu-row" data-a="dm"><div class="av" style="--s:42px;background:var(--brand)">${icon('phone')}</div><div class="txt">Appeler un camarade</div></div>
      <div class="menu-row" data-a="group"><div class="av" style="--s:42px;background:var(--brand)">${icon('users')}</div><div class="txt">Appel de groupe<small>Jusqu'à 8 participants de la classe</small></div></div>
      ${active.map(c => `<div class="item" data-join="${c.callId}" data-video="${c.video ? 1 : ''}">${avatar(S.cls, 46, { group: true })}<div class="body"><div class="top"><span class="name">Appel ${c.video ? 'vidéo' : 'vocal'} en cours</span></div><div class="bot"><span class="prev">${c.participants.length} participant(s) · Appuyez pour rejoindre</span></div></div></div>`).join('')}
      <div class="section-title">Récents</div>
      ${S.calls.map(c => {
        const missed = c.missed;
        const dur = c.answeredAt && c.endedAt ? ` · ${duration((c.endedAt - c.answeredAt) / 1000)}` : '';
        return `<div class="item call-log" data-id="${c.id}">${avatar(callEntity(c), 46, { group: c.group })}
          <div class="body"><div class="top"><span class="name" style="${missed ? 'color:var(--danger)' : ''}">${esc(callChatTitle(c))}</span></div>
          <div class="bot"><span class="prev"><span class="${missed ? 'arrow-in' : 'arrow-ok'}">${icon(c.outgoing ? 'arrowOut' : 'arrowIn', 'xs')}</span> ${esc(listTime(c.startedAt))}${dur}</span></div></div>
          <button class="icon-btn" data-call title="Rappeler">${icon(c.video ? 'video' : 'phone')}</button></div>`;
      }).join('') || `<div class="empty">${icon('phone')}Aucun appel récent.</div>`}
      <div class="empty" style="font-size:12.5px">${icon('lock', 'xs')} Appels directs de navigateur à navigateur entre membres de la classe.</div>`;
  };
  draw();
  live(side, 'calls', draw);
  live(side, 'calls:active', draw);
  $('[data-new]', side).onclick = newCall;
  $('[data-menu]', side).onclick = (e) => ctxMenu(e.currentTarget, [
    { icon: 'trash', label: 'Effacer le journal d\'appels', danger: true, onClick: async () => {
      if (!(await confirmBox('Effacer le journal d\'appels ?', 'Cette action ne concerne que vous.', { ok: 'Effacer', danger: true }))) return;
      try { await del('/calls'); S.calls = []; emit('calls'); } catch (er) { fail(er); }
    } },
  ]);
  list.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'dm') return newCall();
    if (a === 'group') return startCall(S.cls.id, false);
    const j = e.target.closest('[data-join]');
    if (j) return joinCall(j.dataset.join, !!j.dataset.video);
    const it = e.target.closest('[data-id]');
    if (!it) return;
    const c = S.calls.find(x => x.id === it.dataset.id);
    if (e.target.closest('[data-call]')) return callBack(c);
    ctxMenu(e.target.closest('[data-id]'), [
      { icon: 'info', label: fullDate(c.startedAt) },
      { icon: 'phone', label: 'Appel vocal', onClick: () => callBack(c, false) },
      { icon: 'video', label: 'Appel vidéo', onClick: () => callBack(c, true) },
      { icon: 'chat', label: 'Ouvrir la discussion', onClick: () => openCallChat(c) },
      { icon: 'trash', label: 'Supprimer du journal', danger: true, onClick: () => del('/calls?id=' + c.id).then(() => { S.calls = S.calls.filter(x => x.id !== c.id); emit('calls'); }).catch(fail) },
    ], { align: 'right' });
  };
}

async function chatForCall(c) {
  if (c.group) return S.cls.id;
  const peer = c.peerId || S.chats.get(c.chatId)?.peerId;
  const chat = await post('/chats/dm/' + peer);
  S.chats.set(chat.id, chat);
  return chat.id;
}
async function callBack(c, video = c.video) { try { startCall(await chatForCall(c), video); } catch (e) { fail(e); } }
async function openCallChat(c) { try { nav.openChat(await chatForCall(c)); } catch (e) { fail(e); } }

async function newCall() {
  const uid = await pickMembers({ title: 'Appeler', exclude: [S.me.id] });
  if (!uid) return;
  try {
    const chat = await post('/chats/dm/' + uid);
    S.chats.set(chat.id, chat);
    const video = await new Promise((resolve) => ctxMenu({ x: innerWidth / 2 - 100, y: innerHeight / 2 - 40 }, [
      { icon: 'phone', label: 'Appel vocal', onClick: () => resolve(false) },
      { icon: 'video', label: 'Appel vidéo', onClick: () => resolve(true) },
    ]));
    startCall(chat.id, video);
  } catch (e) { fail(e); }
}

/* ---------------- Signalisation ---------------- */
export function attach(socket) {
  socket.on('call:incoming', (c) => {
    S.activeCalls.set(c.callId, { ...c });
    if (call) {
      if (!c.group) socket.emit('call:decline', { callId: c.callId });
      return toast(`${user(c.callerId).name} vous appelle (vous êtes déjà en appel).`);
    }
    showIncoming(c);
  });
  socket.on('call:stopring', ({ callId }) => { if (incoming?.callId === callId) closeIncoming(); });
  socket.on('call:active', (c) => { S.activeCalls.set(c.callId, c); emit('calls:active'); if (call?.id === c.callId) { call.participants = c.participants; renderCall(); } });
  socket.on('call:ended', ({ callId, reason }) => {
    S.activeCalls.delete(callId);
    emit('calls:active');
    if (incoming?.callId === callId) closeIncoming();
    if (call?.id === callId) finish(reason === 'declined' ? 'Appel refusé' : reason === 'missed' ? 'Pas de réponse' : 'Appel terminé');
  });
  socket.on('call:joined', ({ callId, userId }) => {
    if (call?.id !== callId) return;
    if (!call.participants.includes(userId)) call.participants.push(userId);
    sound.stopRing();
    renderCall();
  });
  socket.on('call:left', ({ callId, userId }) => {
    if (call?.id !== callId) return;
    removePeer(userId);
    call.participants = call.participants.filter(x => x !== userId);
    if (!call.group) return finish('Appel terminé');
    renderCall();
  });
  socket.on('rtc:signal', onSignal);
  socket.on('call:media', ({ callId, userId, audio, video, screen }) => {
    const p = call?.id === callId && call.peers.get(userId);
    if (!p) return;
    p.media = { audio, video, screen };
    renderCall();
  });
  socket.on('call:log', (c) => {
    S.calls = [c, ...S.calls.filter(x => x.id !== c.id)].sort((a, b) => b.startedAt - a.startedAt);
    emit('calls');
  });
  socket.on('call:missed', ({ callerId, video }) => {
    if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.getRegistration().then(r => r?.showNotification('Appel manqué', { body: `Appel ${video ? 'vidéo' : 'vocal'} manqué de ${user(callerId).name}`, icon: '/icons/icon.svg' }));
    }
  });
}

/* ---------------- Appel entrant ---------------- */
function showIncoming(c) {
  closeIncoming();
  incoming = c;
  const title = c.group ? S.cls.name : user(c.callerId).name;
  const el = h(`<div class="incoming" role="alertdialog">
    <div class="row"><div class="big-av-pulse">${avatar(c.group ? S.cls : user(c.callerId), 56, { group: c.group })}</div>
      <div class="grow"><b>${esc(title)}</b><div style="opacity:.8;font-size:14px">${c.group ? `${esc(user(c.callerId).name)} · ` : ''}Appel ${c.video ? 'vidéo' : 'vocal'} entrant…</div></div></div>
    <div class="acts">
      <button class="cbtn end" data-no title="Refuser">${icon('phoneOff')}</button>
      ${c.video ? `<button class="cbtn" data-audio title="Répondre sans vidéo">${icon('phone')}</button>` : ''}
      <button class="cbtn ok" data-yes title="Répondre">${icon(c.video ? 'video' : 'phone')}</button>
    </div></div>`);
  $('#call-layer').append(el);
  incoming.el = el;
  if (S.me.settings.notifications.calls !== false) sound.ring();
  if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker?.getRegistration().then(r => r?.showNotification(title, { body: `Appel ${c.video ? 'vidéo' : 'vocal'} entrant`, tag: c.callId, icon: '/icons/icon.svg', requireInteraction: true }));
  }
  $('[data-no]', el).onclick = () => { S.socket.emit('call:decline', { callId: c.callId }); closeIncoming(); };
  $('[data-yes]', el).onclick = () => { closeIncoming(); joinCall(c.callId, c.video, c); };
  $('[data-audio]', el)?.addEventListener('click', () => { closeIncoming(); joinCall(c.callId, false, c); });
}
function closeIncoming() {
  sound.stopRing();
  incoming?.el?.remove();
  incoming = null;
}

/* ---------------- Démarrer / rejoindre ---------------- */
async function getMedia(video) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  } catch (e) {
    if (video) {
      toast('Caméra indisponible : appel vocal uniquement.');
      try { return await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {}
    }
    throw new Error('Accès au micro refusé. Autorisez le micro dans votre navigateur.');
  }
}

export async function startCall(chatId, video) {
  if (call) return toast('Vous êtes déjà en appel.');
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast('Les appels ne sont pas pris en charge par ce navigateur (HTTPS requis).', { error: true });
  const chat = S.chats.get(chatId);
  let userIds;
  const existing = [...S.activeCalls.values()].find(c => c.chatId === chatId);
  if (existing) return joinCall(existing.callId, video);
  if (chat?.type === 'group') {
    userIds = await pickMembers({ title: 'Qui appeler ?', multiple: true, exclude: [S.me.id], max: 7, okLabel: 'Appeler' });
    if (!userIds) return;
  }
  let local;
  try { local = await getMedia(video); } catch (e) { return fail(e); }
  await iceServers();
  S.socket.emit('call:start', { chatId, video, userIds }, (r) => {
    if (r.error) { local.getTracks().forEach(t => t.stop()); return toast(r.error, { error: true }); }
    call = newCallState(r.callId, chatId, video, local, r.call);
    call.outgoing = true;
    renderCall();
    sound.ringback();
    if (r.busy) toast('Votre correspondant est déjà en ligne.');
  });
}
nav.startCall = startCall;

export async function joinCall(callId, video, info) {
  if (call) return toast('Vous êtes déjà en appel.');
  let local;
  try { local = await getMedia(video); } catch (e) { return fail(e); }
  await iceServers();
  S.socket.emit('call:accept', { callId }, (r) => {
    if (r.error) { local.getTracks().forEach(t => t.stop()); return toast(r.error, { error: true }); }
    call = newCallState(callId, r.call.chatId, video, local, r.call);
    for (const uid of r.peers) createPeer(uid);
    renderCall();
  });
}

function newCallState(id, chatId, video, local, info) {
  return {
    id, chatId, video: local.getVideoTracks().length > 0, wantedVideo: video, local, peers: new Map(),
    group: info?.group ?? S.chats.get(chatId)?.type === 'group', callerId: info?.callerId,
    participants: info?.participants || [S.me.id], startedAt: Date.now(), connectedAt: null,
    muted: false, camOff: false, screen: null, facing: 'user', min: false,
  };
}

/* ---------------- WebRTC : négociation « parfaite » ---------------- */
function signal(to, data) { S.socket.emit('rtc:signal', { callId: call.id, to, data }); }

function createPeer(uid) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const peer = { uid, pc, polite: S.me.id > uid, makingOffer: false, ignoreOffer: false, stream: new MediaStream(), media: { audio: true, video: true } };
  call.peers.set(uid, peer);
  call.local.getTracks().forEach(t => pc.addTrack(t, call.local));
  if (call.screen) replaceVideo(call.screen.getVideoTracks()[0]);
  pc.ontrack = (e) => {
    const s = e.streams[0];
    if (s) peer.stream = s; else peer.stream.addTrack(e.track);
    e.track.onunmute = () => renderCall();
    renderCall();
  };
  pc.onicecandidate = (e) => { if (e.candidate) signal(uid, { candidate: e.candidate }); };
  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      signal(uid, { description: pc.localDescription });
    } catch (err) { console.warn(err); }
    finally { peer.makingOffer = false; }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      sound.stopRing();
      call.connectedAt ||= Date.now();
      sendMediaState();
    }
    if (pc.connectionState === 'failed') pc.restartIce?.();
    renderCall();
  };
  return peer;
}

async function onSignal({ callId, from, data }) {
  if (!call || call.id !== callId) return;
  const peer = call.peers.get(from) || createPeer(from);
  const pc = peer.pc;
  try {
    if (data.description) {
      const collision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        await pc.setLocalDescription();
        signal(from, { description: pc.localDescription });
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) console.warn(e); }
    }
  } catch (e) { console.warn('signal', e); }
}

function removePeer(uid) {
  const p = call?.peers.get(uid);
  if (!p) return;
  try { p.pc.close(); } catch {}
  call.peers.delete(uid);
}

function sendMediaState() {
  if (!call) return;
  const v = call.local.getVideoTracks()[0];
  S.socket.emit('call:media', { callId: call.id, audio: !call.muted, video: !!(call.screen || (v && v.enabled && !call.camOff)), screen: !!call.screen });
}

function replaceVideo(track) {
  for (const p of call.peers.values()) {
    const sender = p.pc.getSenders().find(s => s.track?.kind === 'video' || (s.track === null && s._video));
    if (sender) sender.replaceTrack(track);
    else { const s = p.pc.addTrack(track, call.local); s._video = true; }
  }
}

/* ---------------- Commandes ---------------- */
function toggleMute() {
  call.muted = !call.muted;
  call.local.getAudioTracks().forEach(t => (t.enabled = !call.muted));
  sendMediaState(); renderCall();
}

async function toggleCam() {
  let v = call.local.getVideoTracks()[0];
  if (!v) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: call.facing } });
      v = s.getVideoTracks()[0];
      call.local.addTrack(v);
      if (!call.screen) replaceVideo(v);
      call.video = true; call.camOff = false;
    } catch { return toast('Caméra inaccessible.', { error: true }); }
  } else {
    call.camOff = !call.camOff;
    v.enabled = !call.camOff;
  }
  sendMediaState(); renderCall();
}

async function flipCam() {
  const old = call.local.getVideoTracks()[0];
  if (!old) return;
  call.facing = call.facing === 'user' ? 'environment' : 'user';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: call.facing } } });
    const t = s.getVideoTracks()[0];
    call.local.removeTrack(old); old.stop();
    call.local.addTrack(t);
    if (!call.screen) replaceVideo(t);
    renderCall();
  } catch { call.facing = call.facing === 'user' ? 'environment' : 'user'; toast('Une seule caméra disponible.'); }
}

async function toggleScreen() {
  if (call.screen) return stopScreen();
  if (!navigator.mediaDevices.getDisplayMedia) return toast('Partage d\'écran non pris en charge sur cet appareil.');
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    call.screen = s;
    const t = s.getVideoTracks()[0];
    t.onended = stopScreen;
    replaceVideo(t);
    sendMediaState(); renderCall();
  } catch {}
}
function stopScreen() {
  if (!call?.screen) return;
  call.screen.getTracks().forEach(t => t.stop());
  call.screen = null;
  const cam = call.local.getVideoTracks()[0];
  for (const p of call.peers.values()) {
    const sender = p.pc.getSenders().find(s => s.track?.kind === 'video' || s._video);
    sender?.replaceTrack(cam || null);
  }
  sendMediaState(); renderCall();
}

export function hangUp() {
  if (!call) return;
  S.socket.emit('call:leave', { callId: call.id });
  finish('Appel terminé');
}

function finish(label) {
  if (!call) return;
  sound.stopRing();
  sound.end();
  for (const p of call.peers.values()) try { p.pc.close(); } catch {}
  call.local.getTracks().forEach(t => t.stop());
  call.screen?.getTracks().forEach(t => t.stop());
  clearInterval(call.timer);
  const el = $('#call-layer .call');
  call = null;
  if (el) {
    const s = el.querySelector('[data-status]');
    if (s) s.textContent = label;
    el.querySelector('.call-controls')?.remove();
    setTimeout(() => el.remove(), 1200);
  }
  emit('calls:active');
}

/* ---------------- Interface d'appel ---------------- */
function statusText() {
  if (!call) return '';
  if (call.connectedAt) return duration((Date.now() - call.connectedAt) / 1000);
  if (call.outgoing && call.peers.size === 0) return call.group ? 'Appel en cours… en attente des participants' : 'Appel en cours…';
  return 'Connexion…';
}

function renderCall() {
  if (!call) return;
  let el = $('#call-layer .call');
  if (!el) {
    el = h(`<div class="call" role="dialog" aria-label="Appel">
      <div class="call-top"><button class="icon-btn" data-min title="Réduire">${icon('minimize')}</button>
        <div class="call-title"><b data-title></b><small data-status></small></div>
        ${icon('lock', 'sm')}</div>
      <div class="call-grid" data-grid></div>
      <div class="local-video" data-local hidden><video autoplay playsinline muted></video></div>
      <div class="call-controls" data-ctl></div></div>`);
    $('#call-layer').append(el);
    $('[data-min]', el).onclick = (e) => { e.stopPropagation(); call.min = true; el.classList.add('min'); };
    el.addEventListener('click', (e) => { if (call?.min && !e.target.closest('button')) { call.min = false; el.classList.remove('min'); } });
    call.timer = setInterval(() => { const s = $('[data-status]', el); if (s && call) s.textContent = statusText(); }, 1000);
  }
  const chat = S.chats.get(call.chatId);
  $('[data-title]', el).textContent = call.group ? (S.cls?.name || 'Appel de groupe') : chatTitle(chat);
  $('[data-status]', el).textContent = statusText();

  // Tuiles des participants (on conserve les éléments vidéo existants).
  const grid = $('[data-grid]', el);
  const peers = [...call.peers.values()];
  const waiting = call.participants.filter(u => u !== S.me.id && !call.peers.has(u));
  const ids = peers.map(p => p.uid).concat(waiting);
  if (!ids.length) {
    const ent = call.group ? S.cls : user(chat?.peerId);
    grid.innerHTML = `<div class="tile"><div class="state"><div class="big-av-pulse" style="display:inline-block">${avatar(ent, 120, { group: call.group })}</div><p>${esc(call.group ? 'En attente des participants…' : 'Appel en cours…')}</p></div></div>`;
  } else {
    grid.querySelectorAll('.tile').forEach(t => { if (!ids.includes(t.dataset.uid)) t.remove(); });
    for (const uid of ids) {
      let t = grid.querySelector(`.tile[data-uid="${uid}"]`);
      if (!t) {
        t = h(`<div class="tile" data-uid="${uid}"><video autoplay playsinline></video><div class="state" data-st></div><div class="who"></div></div>`);
        grid.append(t);
      }
      const p = call.peers.get(uid);
      const v = t.querySelector('video');
      if (p && v.srcObject !== p.stream) v.srcObject = p.stream;
      const hasVideo = p && p.stream.getVideoTracks().some(tr => tr.readyState === 'live' && !tr.muted) && p.media.video !== false;
      v.style.opacity = hasVideo ? 1 : 0;
      v.classList.toggle('contain', !!p?.media.screen);
      const connected = p?.pc.connectionState === 'connected';
      t.querySelector('[data-st]').innerHTML = hasVideo ? '' : `${avatar(user(uid), ids.length > 2 ? 72 : 110)}<p>${!p ? 'Sonnerie…' : connected ? '' : 'Connexion…'}</p>`;
      t.querySelector('.who').innerHTML = `${p && p.media.audio === false ? icon('micOff', 'xs') : ''}${esc(user(uid).name)}`;
    }
    grid.querySelector('.tile:not([data-uid])')?.remove();
  }
  const n = Math.max(1, ids.length);
  grid.style.setProperty('--cols', n === 1 ? 1 : n <= 4 ? 2 : 3);

  // Aperçu local.
  const lv = $('[data-local]', el);
  const myVideo = call.screen || (call.local.getVideoTracks().length && !call.camOff ? call.local : null);
  lv.hidden = !myVideo;
  const lvv = lv.querySelector('video');
  if (myVideo && lvv.srcObject !== myVideo) lvv.srcObject = myVideo;
  lvv.className = call.screen ? 'screen' : call.facing === 'environment' ? 'env' : '';

  const hasCam = call.local.getVideoTracks().length > 0;
  $('[data-ctl]', el).innerHTML = `
    <button class="cbtn ${call.muted ? 'off' : ''}" data-c="mute" title="${call.muted ? 'Réactiver le micro' : 'Couper le micro'}">${icon(call.muted ? 'micOff' : 'mic')}</button>
    <button class="cbtn ${!hasCam || call.camOff ? 'off' : ''}" data-c="cam" title="Caméra">${icon(!hasCam || call.camOff ? 'videoOff' : 'video')}</button>
    ${hasCam && matchMedia('(pointer: coarse)').matches ? `<button class="cbtn" data-c="flip" title="Retourner la caméra">${icon('flip')}</button>` : ''}
    ${navigator.mediaDevices.getDisplayMedia ? `<button class="cbtn ${call.screen ? 'off' : ''}" data-c="screen" title="Partager l'écran">${icon('screen')}</button>` : ''}
    <button class="cbtn" data-c="chat" title="Discussion">${icon('chat')}</button>
    <button class="cbtn end" data-c="end" title="Raccrocher">${icon('phoneOff')}</button>`;
  $('[data-ctl]', el).onclick = (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (c === 'mute') toggleMute();
    if (c === 'cam') toggleCam();
    if (c === 'flip') flipCam();
    if (c === 'screen') toggleScreen();
    if (c === 'end') hangUp();
    if (c === 'chat') { call.min = true; el.classList.add('min'); nav.openChat(call.chatId); }
  };
}

addEventListener('beforeunload', () => { if (call) S.socket?.emit('call:leave', { callId: call.id }); });
