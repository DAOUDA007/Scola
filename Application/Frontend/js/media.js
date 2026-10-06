// Médias : visionneuse, préparation avant envoi, appareil photo, lecture des vocaux.
import { $, $$, h, esc, icon, fileSize, extOf, download, duration, avatar, fullDate, pickFiles } from './util.js';
import { S, displayName, user } from './state.js';
import { modal, toast } from './ui.js';

/* ---------- Visionneuse plein écran ---------- */
export function openViewer(items, index = 0, { onForward, onReply } = {}) {
  let i = index;
  const el = h(`<div class="viewer" role="dialog" aria-modal="true">
    <div class="viewer-head"><div data-who class="row grow"></div>
      ${onReply ? `<button class="icon-btn" data-reply title="Répondre">${icon('reply')}</button>` : ''}
      ${onForward ? `<button class="icon-btn" data-fwd title="Transférer">${icon('forward')}</button>` : ''}
      <button class="icon-btn" data-dl title="Télécharger">${icon('download')}</button>
      <button class="icon-btn" data-x title="Fermer">${icon('x')}</button></div>
    <div class="viewer-stage"><button class="viewer-nav prev">${icon('chevL')}</button><div data-stage></div><button class="viewer-nav next">${icon('chevR')}</button></div>
    <div class="viewer-cap" data-cap></div>
    <div class="viewer-strip" data-strip></div></div>`);
  const show = () => {
    const it = items[i];
    $('[data-who]', el).innerHTML = it.senderId !== undefined ? `${avatar(user(it.senderId), 40)}<div class="col"><b>${esc(displayName(it.senderId))}</b><small style="opacity:.7">${fullDate(it.createdAt)}</small></div>` : '';
    $('[data-stage]', el).innerHTML = it.type === 'video'
      ? `<video src="${esc(it.url)}" controls autoplay playsinline></video>`
      : `<img src="${esc(it.url)}" alt="">`;
    $('[data-cap]', el).textContent = it.caption || '';
    $('.prev', el).hidden = i === 0;
    $('.next', el).hidden = i === items.length - 1;
    $('[data-strip]', el).innerHTML = items.length > 1 ? items.map((x, k) => x.type === 'video'
      ? `<video class="v ${k === i ? 'on' : ''}" data-k="${k}" src="${esc(x.url)}#t=0.5" preload="metadata" muted></video>`
      : `<img class="${k === i ? 'on' : ''}" data-k="${k}" src="${esc(x.url)}" loading="lazy">`).join('') : '';
    $('[data-strip] .on', el)?.scrollIntoView({ inline: 'center', block: 'nearest' });
    if ($('[data-dl]', el)) $('[data-dl]', el).hidden = !!it.noDownload;
  };
  const close = () => { el.remove(); removeEventListener('keydown', key); };
  const key = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft' && i > 0) { i--; show(); }
    if (e.key === 'ArrowRight' && i < items.length - 1) { i++; show(); }
  };
  addEventListener('keydown', key);
  $('[data-x]', el).onclick = close;
  $('.prev', el).onclick = () => { i--; show(); };
  $('.next', el).onclick = () => { i++; show(); };
  $('[data-dl]', el).onclick = () => download(items[i].url, items[i].name || 'scola-media');
  $('[data-fwd]', el)?.addEventListener('click', () => { close(); onForward(items[i]); });
  $('[data-reply]', el)?.addEventListener('click', () => { close(); onReply(items[i]); });
  $('[data-strip]', el).onclick = (e) => { const k = e.target.dataset.k; if (k !== undefined) { i = Number(k); show(); } };
  let sx = null;
  el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (dx > 60 && i > 0) { i--; show(); } else if (dx < -60 && i < items.length - 1) { i++; show(); }
    sx = null;
  });
  document.body.append(el);
  show();
  return close;
}

/* ---------- Dimensions & compression ---------- */
export function imageInfo(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight, img }); };
    img.onerror = () => resolve({});
    img.src = URL.createObjectURL(file);
  });
}
export function videoInfo(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.onerror = () => resolve({});
    v.src = URL.createObjectURL(file);
  });
}
export async function compressImage(file, max = 1600, quality = 0.85) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 300_000) return file;
  const { img, width, height } = await imageInfo(file);
  if (!img) return file;
  const r = Math.min(1, max / Math.max(width, height));
  const c = document.createElement('canvas');
  c.width = Math.round(width * r); c.height = Math.round(height * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export function kindOf(file) {
  if (file.type.startsWith('image/') && !/svg/.test(file.type)) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}

/* ---------- Préparation avant envoi (légende, vue unique, HD) ---------- */
export function composeMedia(files, { title = '', asDocuments = false, allowViewOnce = true } = {}) {
  return new Promise((resolve) => {
    let items = [...files].map(f => ({ file: f, caption: '', viewOnce: false, hd: false, kind: asDocuments ? 'document' : kindOf(f), url: URL.createObjectURL(f) }));
    let i = 0;
    const el = h(`<div class="media-compose" role="dialog">
      <div class="viewer-head"><button class="icon-btn" data-x style="color:#fff">${icon('x')}</button><div class="grow ellipsis">${esc(title)}</div>
        <span data-opts class="row"></span></div>
      <div class="stage" data-stage></div>
      <div class="cap"><input data-cap placeholder="Ajouter une légende…" maxlength="2000"><button class="send" data-send style="width:52px;height:52px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center">${icon('send')}</button></div>
      <div class="thumbs" data-thumbs></div></div>`);
    const show = () => {
      const it = items[i];
      $('[data-stage]', el).innerHTML = it.kind === 'image' ? `<img src="${it.url}">`
        : it.kind === 'video' ? `<video src="${it.url}" controls playsinline></video>`
        : `<div class="docprev">${icon('file', 'lg')}<h3>${esc(it.file.name)}</h3><p>${fileSize(it.file.size)} · ${esc(extOf(it.file.name).toUpperCase())}</p></div>`;
      $('[data-cap]', el).value = it.caption;
      $('[data-cap]', el).hidden = it.kind === 'audio';
      const canOnce = allowViewOnce && ['image', 'video'].includes(it.kind);
      $('[data-opts]', el).innerHTML = (it.kind === 'image' ? `<button class="opt-toggle ${it.hd ? 'on' : ''}" data-hd title="Envoyer en haute qualité">HD</button>` : '')
        + (canOnce ? `<button class="opt-toggle ${it.viewOnce ? 'on' : ''}" data-once title="Vue unique : le média ne pourra être ouvert qu'une fois"><span class="once-ic" style="width:20px;height:20px;font-size:10px">1</span> Vue unique</button>` : '');
      $('[data-thumbs]', el).innerHTML = items.map((x, k) => `<div class="${k === i ? 'on' : ''}" data-k="${k}" style="${x.kind === 'image' ? `background-image:url(${x.url})` : ''}">${x.kind === 'image' ? '' : x.kind === 'video' ? icon('video') : esc(extOf(x.file.name).toUpperCase())}</div>`).join('')
        + `<div data-add title="Ajouter">${icon('plus')}</div>`;
    };
    const finish = (v) => { el.remove(); removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') finish(null); };
    addEventListener('keydown', key);
    $('[data-x]', el).onclick = () => finish(null);
    $('[data-cap]', el).oninput = (e) => { items[i].caption = e.target.value; };
    $('[data-cap]', el).onkeydown = (e) => { if (e.key === 'Enter') $('[data-send]', el).click(); };
    $('[data-opts]', el).onclick = (e) => {
      if (e.target.closest('[data-once]')) items[i].viewOnce = !items[i].viewOnce;
      if (e.target.closest('[data-hd]')) items[i].hd = !items[i].hd;
      show();
    };
    $('[data-thumbs]', el).onclick = (e) => {
      const t = e.target.closest('[data-k],[data-add]');
      if (!t) return;
      if (t.dataset.add !== undefined) {
        pickFiles({ multiple: true, accept: asDocuments ? '' : 'image/*,video/*' }).then(files => {
          if (!files) return;
          items = items.concat(files.map(f => ({ file: f, caption: '', viewOnce: false, hd: false, kind: asDocuments ? 'document' : kindOf(f), url: URL.createObjectURL(f) })));
          show();
        });
        return;
      }
      i = Number(t.dataset.k); show();
    };
    $('[data-send]', el).onclick = () => finish(items);
    document.body.append(el);
    show();
    setTimeout(() => $('[data-cap]', el).focus(), 50);
  });
}

/* ---------- Appareil photo ---------- */
// video : autorise aussi l'enregistrement d'une vidéo avec l'appareil natif (mobile).
export function takePhoto({ video = true } = {}) {
  // Sur mobile, l'appareil photo natif est plus adapté (et plus fiable).
  if (matchMedia('(pointer: coarse)').matches) {
    return pickFiles({ accept: video ? 'image/*,video/*' : 'image/*', capture: 'environment' }).then(f => f?.[0] || null);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Caméra indisponible : ouvrez Scola en HTTPS ou sur localhost.', { error: true });
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let stream = null, facing = 'user', result = null, closed = false;
    const body = h(`<div class="camera-box"><div class="cam-wait">${icon('camera', 'lg')}<span>Ouverture de la caméra…</span></div><video playsinline muted></video></div>`);
    const v = $('video', body);
    v.muted = true;
    // Certaines caméras envoient d'abord quelques images minuscules : on attend une vraie image.
    const ready = () => v.videoWidth >= 64 && v.videoHeight >= 64 && v.readyState >= 2;
    const setReady = (ok) => {
      $('.cam-wait', body).hidden = ok;
      const btn = [...m.el.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Capturer');
      if (btn) btn.disabled = !ok;
    };
    const start = async () => {
      setReady(false);
      stream?.getTracks().forEach(t => t.stop());
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (closed) return stream.getTracks().forEach(t => t.stop());
        v.srcObject = stream;
        v.classList.toggle('env', facing !== 'user');
        await v.play().catch(() => {});
        const check = () => { if (closed) return; if (ready()) setReady(true); else setTimeout(check, 150); };
        check();
      } catch (e) {
        toast(e?.name === 'NotAllowedError' ? 'Accès à la caméra refusé. Autorisez-le dans votre navigateur.' : 'Aucune caméra disponible.', { error: true });
        m.close();
      }
    };
    const m = modal({
      title: 'Prendre une photo', body, wide: true,
      buttons: [
        { label: 'Retourner', onClick: () => { facing = facing === 'user' ? 'environment' : 'user'; start(); return false; } },
        { label: 'Capturer', cls: '', onClick: async () => {
          if (!ready()) { toast('La caméra n\'est pas encore prête.'); return false; }
          const c = document.createElement('canvas');
          c.width = v.videoWidth; c.height = v.videoHeight;
          const g = c.getContext('2d');
          if (facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); }
          g.drawImage(v, 0, 0);
          const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
          if (!blob) { toast('Capture impossible, réessayez.', { error: true }); return false; }
          result = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        } },
      ],
      onClose: () => { closed = true; stream?.getTracks().forEach(t => t.stop()); resolve(result); },
    });
    start();
  });
}

/* ---------- Recadrage d'une photo de profil / d'icône (comme WhatsApp) ---------- */
// Cadre circulaire : glisser pour déplacer, molette / curseur / pincement pour zoomer.
export function cropImage(file, { title = 'Recadrer la photo', size = 640 } = {}) {
  if (!file || !/^image\//.test(file.type)) return Promise.resolve(file || null);
  return new Promise(async (resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    try { img.src = url; await img.decode(); } catch { URL.revokeObjectURL(url); toast('Image illisible.', { error: true }); return resolve(null); }
    const body = h(`<div class="cropper">
      <div class="crop-stage"><img alt="" draggable="false"><div class="crop-mask"></div></div>
      <div class="crop-zoom">${icon('image', 'sm')}<input type="range" min="0" max="100" value="0" aria-label="Zoom">${icon('image')}</div>
      <p class="hint" style="text-align:center;margin:6px 0 0">Faites glisser pour cadrer, zoomez avec la molette ou le curseur.</p></div>`);
    const stage = $('.crop-stage', body), pic = $('img', body), range = $('input', body);
    pic.src = url;
    let S = 0, min = 1, s = 1, x = 0, y = 0;
    const W = img.naturalWidth, H = img.naturalHeight;
    const clamp = () => {
      s = Math.min(Math.max(s, min), min * 5);
      x = Math.min(0, Math.max(S - W * s, x));
      y = Math.min(0, Math.max(S - H * s, y));
      pic.style.width = W * s + 'px';
      pic.style.height = H * s + 'px';
      pic.style.transform = `translate(${x}px, ${y}px)`;
      range.value = Math.round(((s / min - 1) / 4) * 100);
    };
    const zoomAt = (ns, cx = S / 2, cy = S / 2) => {
      const k = Math.min(Math.max(ns, min), min * 5) / s;
      x = cx - (cx - x) * k; y = cy - (cy - y) * k; s *= k;
      clamp();
    };
    const layout = () => {
      S = stage.clientWidth;
      min = Math.max(S / W, S / H);
      s = min; x = (S - W * s) / 2; y = (S - H * s) / 2;
      clamp();
    };
    const pts = new Map();
    let last = null, pinch = null;
    stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY }; });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = stage.getBoundingClientRect();
        if (pinch) zoomAt(s * d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        pinch = d;
        return;
      }
      x += e.clientX - last.x; y += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      clamp();
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = null; const p = [...pts.values()][0]; if (p) last = p; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    range.oninput = () => zoomAt(min * (1 + (range.value / 100) * 4));
    let result = null;
    modal({
      title, body,
      buttons: [{ label: 'Annuler' }, { label: 'Valider', cls: '', onClick: async () => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, size, size);
        g.drawImage(img, -x / s, -y / s, S / s, S / s, 0, 0, size, size);
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
        if (blob) result = new File([blob], 'photo-profil.jpg', { type: 'image/jpeg' });
      } }],
      onClose: () => { URL.revokeObjectURL(url); resolve(result); },
    });
    requestAnimationFrame(layout);
  });
}

/* ---------- Lecture des vocaux et audios (un seul à la fois) ---------- */
const player = { audio: null, id: null, rate: 1 };
export function voiceState(id) { return player.id === id ? player : null; }

export function toggleVoice(id, url, root, onEnded) {
  if (player.id === id && player.audio) {
    if (player.audio.paused) player.audio.play(); else player.audio.pause();
    return syncVoice(root);
  }
  player.audio?.pause();
  const a = new Audio(url);
  a.playbackRate = player.rate;
  player.audio = a; player.id = id;
  a.ontimeupdate = () => syncVoice(document);
  a.onpause = a.onplay = () => syncVoice(document);
  a.onended = () => { player.id = null; syncVoice(document, id, true); onEnded?.(id); };
  a.play().catch(() => toast('Lecture impossible.', { error: true }));
}

export function seekVoice(id, ratio) {
  if (player.id !== id || !player.audio?.duration) return;
  player.audio.currentTime = ratio * player.audio.duration;
}

export function cycleSpeed() {
  player.rate = player.rate === 1 ? 1.5 : player.rate === 1.5 ? 2 : 1;
  if (player.audio) player.audio.playbackRate = player.rate;
  syncVoice(document);
  return player.rate;
}

export function syncVoice(root = document, endedId, ended) {
  $$('.voice[data-vid]', root).forEach(v => {
    const id = v.dataset.vid;
    const active = player.id === id && player.audio;
    const playing = active && !player.audio.paused;
    v.querySelector('.pp').innerHTML = icon(playing ? 'pause' : 'play');
    const ratio = active && player.audio.duration ? player.audio.currentTime / player.audio.duration : 0;
    const bars = v.querySelectorAll('.wave i');
    bars.forEach((b, k) => b.classList.toggle('p', active && k / bars.length < ratio));
    const foot = v.parentElement.querySelector('.voice-foot span');
    if (foot) foot.textContent = active && player.audio.currentTime ? duration(player.audio.currentTime) : duration(Number(v.dataset.dur));
    const sp = v.parentElement.querySelector('.speed');
    if (sp) { sp.hidden = !active; sp.textContent = player.rate + '×'; }
    if (ended && id === endedId) bars.forEach(b => b.classList.remove('p'));
  });
}

/* ---------- Enregistreur de vocaux ---------- */
export async function startRecorder(onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  const mimeType = types.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const levels = [];
  let elapsed = 0, last = performance.now(), paused = false;
  const iv = setInterval(() => {
    const t = performance.now();
    if (!paused) elapsed += t - last;
    last = t;
    if (paused) return;
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
    const l = Math.min(1, peak * 1.8);
    levels.push(l);
    onLevel?.(l, elapsed / 1000);
  }, 100);
  rec.start(250);
  const cleanup = () => { clearInterval(iv); stream.getTracks().forEach(t => t.stop()); ac.close().catch(() => {}); };
  return {
    pause() { if (rec.state === 'recording') { rec.pause(); paused = true; } },
    resume() { if (rec.state === 'paused') { rec.resume(); paused = false; } },
    get paused() { return paused; },
    cancel() { try { rec.stop(); } catch {} cleanup(); },
    stop() {
      return new Promise((resolve) => {
        rec.onstop = () => {
          cleanup();
          const type = rec.mimeType || mimeType || 'audio/webm';
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const blob = new Blob(chunks, { type });
          const n = 48;
          const wave = Array.from({ length: n }, (_, k) => {
            const seg = levels.slice(Math.floor(k * levels.length / n), Math.floor((k + 1) * levels.length / n) || undefined);
            return seg.length ? Math.max(...seg) : 0;
          });
          resolve({ file: new File([blob], `vocal-${Date.now()}.${ext}`, { type }), duration: elapsed / 1000, waveform: wave });
        };
        try { rec.stop(); } catch { cleanup(); resolve(null); }
      });
    },
  };
}
