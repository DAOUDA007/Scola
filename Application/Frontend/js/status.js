// Onglet Statuts : publications éphémères (24 h) visibles par la classe.
import { $, h, esc, icon, avatar, relTime, formatText, pickFiles } from './util.js';
import { get, post, patch, del, upload } from './api.js';
import { S, emit, user } from './state.js';
import { toast, fail, ctxMenu, modal, choose, pickMembers, confirmBox, pushPage } from './ui.js';
import { nav } from './nav.js';
import { live } from './chatlist.js';
import { composeMedia, compressImage, kindOf } from './media.js';
import { QUICK } from './emoji.js';

const COLORS = ['#EA580C', '#2563eb', '#7c3aed', '#be185d', '#c2410c', '#0369a1', '#4d7c0f', '#b45309', '#334155', '#dc2626'];

function groups() {
  const muted = S.me.settings.mutedStatuses || [];
  const by = new Map();
  for (const s of S.statuses) {
    if (!by.has(s.userId)) by.set(s.userId, []);
    by.get(s.userId).push(s);
  }
  const mine = by.get(S.me.id) || [];
  by.delete(S.me.id);
  const all = [...by.entries()].map(([uid, list]) => ({ uid, list, last: list[list.length - 1].createdAt, unseen: list.some(s => !s.viewed) }))
    .sort((a, b) => b.last - a.last);
  return {
    mine,
    recent: all.filter(g => g.unseen && !muted.includes(g.uid)),
    seen: all.filter(g => !g.unseen && !muted.includes(g.uid)),
    muted: all.filter(g => muted.includes(g.uid)),
  };
}

export function render(side) {
  side.innerHTML = `<div class="panel-head"><h1>Statuts</h1>
      <button class="icon-btn" data-text title="Statut texte">${icon('edit')}</button>
      <button class="icon-btn" data-media title="Photo ou vidéo">${icon('camera')}</button>
      <button class="icon-btn" data-menu title="Menu">${icon('more')}</button></div>
    <div class="list scroll" data-list></div>`;
  const list = $('[data-list]', side);
  const draw = () => {
    const g = groups();
    const lastMine = g.mine[g.mine.length - 1];
    const rowHTML = (gr, seen) => `<div class="item" data-uid="${gr.uid}"><div class="ring ${seen ? 'seen' : ''}">${avatar(user(gr.uid), 46)}</div>
      <div class="body"><div class="top"><span class="name">${esc(user(gr.uid).name)}</span></div><div class="bot"><span class="prev">${esc(relTime(gr.last))}${gr.list.length > 1 ? ` · ${gr.list.length} statuts` : ''}</span></div></div></div>`;
    list.innerHTML = `
      <div class="item" data-mine>
        <div class="av-wrap">${g.mine.length ? `<div class="ring seen">${avatar(S.me, 46)}</div>` : avatar(S.me, 52)}
          ${!g.mine.length ? `<span style="position:absolute;right:-2px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;border:2px solid var(--panel)">${icon('plus', 'xs')}</span>` : ''}</div>
        <div class="body"><div class="top"><span class="name">Mon statut</span></div><div class="bot"><span class="prev">${lastMine ? esc(relTime(lastMine.createdAt)) + ` · ${g.mine.reduce((n, s) => n + (s.views?.length || 0), 0)} vue(s)` : 'Ajoutez un statut pour votre classe'}</span></div></div>
        ${g.mine.length ? `<button class="icon-btn" data-manage title="Gérer mes statuts">${icon('more')}</button>` : ''}
      </div>
      ${g.recent.length ? `<div class="section-title">Mises à jour récentes</div>${g.recent.map(x => rowHTML(x, false)).join('')}` : ''}
      ${g.seen.length ? `<div class="section-title">Mises à jour vues</div>${g.seen.map(x => rowHTML(x, true)).join('')}` : ''}
      ${g.muted.length ? `<div class="section-title">Masqués</div><div style="opacity:.6">${g.muted.map(x => rowHTML(x, true)).join('')}</div>` : ''}
      ${!g.recent.length && !g.seen.length && !g.muted.length ? `<div class="empty">${icon('status')}Aucun statut de vos camarades pour le moment.<br>Les statuts disparaissent après 24 heures.</div>` : ''}
      <div class="empty" style="font-size:12.5px">${icon('lock', 'xs')} Vos statuts ne sont visibles que par votre classe (selon vos réglages de confidentialité).</div>`;
  };
  draw();
  live(side, 'statuses', draw);
  live(side, 'members', draw);
  list.onclick = (e) => {
    if (e.target.closest('[data-manage]')) return myStatuses(side);
    if (e.target.closest('[data-mine]')) {
      const g = groups();
      if (g.mine.length) return openViewer([S.me.id], 0);
      return ctxMenu(e.target.closest('[data-mine]'), [
        { icon: 'type', label: 'Statut texte', onClick: textStatus },
        { icon: 'image', label: 'Photo ou vidéo', onClick: mediaStatus },
      ], { align: 'left' });
    }
    const it = e.target.closest('[data-uid]');
    if (!it) return;
    const g = groups();
    const order = [...g.recent, ...g.seen, ...g.muted].map(x => x.uid);
    openViewer(order, order.indexOf(it.dataset.uid));
  };
  list.oncontextmenu = (e) => {
    const it = e.target.closest('[data-uid]');
    if (!it) return;
    e.preventDefault();
    muteMenu(it.dataset.uid, { x: e.clientX, y: e.clientY });
  };
  $('[data-text]', side).onclick = textStatus;
  $('[data-media]', side).onclick = mediaStatus;
  $('[data-menu]', side).onclick = (e) => ctxMenu(e.currentTarget, [
    { icon: 'status', label: 'Mes statuts (gérer, supprimer)', onClick: () => myStatuses(side) },
    { icon: 'lock', label: 'Confidentialité du statut', onClick: statusPrivacy },
    { icon: 'type', label: 'Nouveau statut texte', onClick: textStatus },
    { icon: 'image', label: 'Nouveau statut photo/vidéo', onClick: mediaStatus },
  ]);
}

/* ---------------- Mes statuts : liste et suppression ---------------- */
export async function deleteStatus(s) {
  if (!(await confirmBox('Supprimer ce statut ?', 'Il sera supprimé pour tous ceux qui peuvent le voir.', { ok: 'Supprimer', danger: true }))) return false;
  try {
    await del('/statuses/' + s.id);
    S.statuses = S.statuses.filter(x => x.id !== s.id);
    emit('statuses');
    toast('Statut supprimé');
    return true;
  } catch (e) { fail(e); return false; }
}

function myStatuses(side) {
  pushPage(side, {
    title: 'Mes statuts',
    render: (body) => {
      const draw = () => {
        const mine = S.statuses.filter(s => s.userId === S.me.id).sort((a, b) => b.createdAt - a.createdAt);
        body.innerHTML = mine.length ? mine.map(s => {
          const thumb = s.type === 'text'
            ? `<div class="av fonts-${s.font || 0}" style="--s:52px;background:${esc(s.bg)};font-size:9px;padding:4px;text-align:center;line-height:1.1">${esc((s.text || '').slice(0, 40))}</div>`
            : s.type === 'image' ? `<div class="av" style="--s:52px"><img src="${esc(s.media.url)}" alt=""></div>`
            : `<div class="av" style="--s:52px;background:#000">${icon('video')}</div>`;
          const views = s.views?.length || 0;
          return `<div class="item" data-sid="${s.id}">${thumb}
            <div class="body"><div class="top"><span class="name" style="font-size:15px">${esc(s.text || s.caption || (s.type === 'image' ? 'Photo' : 'Vidéo'))}</span></div>
            <div class="bot"><span class="prev">${esc(relTime(s.createdAt))} · ${icon('eye', 'xs')} ${views} vue${views > 1 ? 's' : ''}</span></div></div>
            <button class="icon-btn" data-del title="Supprimer ce statut">${icon('trash')}</button></div>`;
        }).join('') + `<div class="empty" style="font-size:12.5px">Vos statuts disparaissent automatiquement après 24 heures. Vous pouvez les supprimer avant à tout moment.</div>`
          : `<div class="empty">${icon('status')}Vous n'avez aucun statut en ligne.</div>`;
      };
      draw();
      live(body, 'statuses', draw);
      body.onclick = (e) => {
        const it = e.target.closest('[data-sid]');
        if (!it) return;
        const s = S.statuses.find(x => x.id === it.dataset.sid);
        if (!s) return;
        if (e.target.closest('[data-del]')) return deleteStatus(s);
        const mine = S.statuses.filter(x => x.userId === S.me.id).sort((a, b) => a.createdAt - b.createdAt);
        openViewer([S.me.id], 0, mine.indexOf(s));
      };
    },
  });
}

function muteMenu(uid, anchor) {
  const muted = (S.me.settings.mutedStatuses || []).includes(uid);
  ctxMenu(anchor, [
    { icon: muted ? 'eye' : 'bellOff', label: muted ? `Afficher les statuts de ${user(uid).name}` : `Masquer les statuts de ${user(uid).name}`, onClick: async () => {
      const list = new Set(S.me.settings.mutedStatuses || []);
      muted ? list.delete(uid) : list.add(uid);
      try { S.me = { ...S.me, ...(await patch('/me/settings', { mutedStatuses: [...list] })) }; emit('me'); emit('statuses'); } catch (e) { fail(e); }
    } },
    { icon: 'chat', label: 'Envoyer un message', onClick: () => post('/chats/dm/' + uid).then(c => { S.chats.set(c.id, c); nav.openChat(c.id); }).catch(fail) },
  ]);
}

export async function statusPrivacy() {
  const p = S.me.privacy.status;
  const mode = await choose('Qui peut voir mes statuts', [
    { value: 'all', label: 'Toute ma classe' },
    { value: 'except', label: 'Ma classe sauf…', desc: p.mode === 'except' ? `${p.list.length} exclu(s)` : '' },
    { value: 'only', label: 'Uniquement avec…', desc: p.mode === 'only' ? `${p.list.length} personne(s)` : '' },
  ], p.mode, { note: 'Les modifications ne concernent pas les statuts déjà publiés.' });
  if (!mode) return;
  let list = [];
  if (mode !== 'all') {
    list = await pickMembers({ title: mode === 'except' ? 'Masquer mon statut pour…' : 'Partager uniquement avec…', multiple: true, exclude: [S.me.id], selected: p.mode === mode ? p.list : [], min: 1 });
    if (!list) return;
  }
  try { S.me = { ...S.me, ...(await patch('/me/privacy', { status: { mode, list } })) }; emit('me'); toast('Confidentialité mise à jour'); } catch (e) { fail(e); }
}

/* ---------------- Création ---------------- */
function textStatus() {
  let bg = 0, font = 0;
  const el = h(`<div class="status-compose" style="background:${COLORS[0]}">
    <div class="bar"><button class="icon-btn" data-x>${icon('x')}</button><div class="grow"></div>
      <button class="icon-btn" data-font title="Police">${icon('type')}</button>
      <button class="icon-btn" data-bg title="Couleur">${icon('drop')}</button></div>
    <div style="flex:1;display:grid;place-items:center"><textarea class="fonts-0" maxlength="700" placeholder="Saisissez un statut" rows="4"></textarea></div>
    <button class="send" data-send title="Publier">${icon('send')}</button></div>`);
  const ta = $('textarea', el);
  const close = () => { el.remove(); removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', key);
  $('[data-x]', el).onclick = close;
  $('[data-bg]', el).onclick = () => { bg = (bg + 1) % COLORS.length; el.style.background = COLORS[bg]; };
  $('[data-font]', el).onclick = () => { font = (font + 1) % 5; ta.className = 'fonts-' + font; };
  ta.oninput = () => { ta.style.fontSize = ta.value.length > 120 ? '22px' : ta.value.length > 50 ? '27px' : '32px'; };
  $('[data-send]', el).onclick = async () => {
    if (!ta.value.trim()) return toast('Écrivez quelque chose.');
    try { const s = await post('/statuses', { type: 'text', text: ta.value, bg: COLORS[bg], font }); addMine(s); close(); toast('Statut publié'); }
    catch (e) { fail(e); }
  };
  document.body.append(el);
  ta.focus();
}

function mediaStatus() {
  pickFiles({ accept: 'image/*,video/*' }).then(async (files) => {
    if (!files) return;
    const items = await composeMedia(files, { title: 'Mon statut', allowViewOnce: false });
    if (!items) return;
    for (const it of items) {
      if (!['image', 'video'].includes(it.kind)) { toast('Seules les photos et vidéos sont acceptées.'); continue; }
      try {
        const file = it.kind === 'image' && !it.hd ? await compressImage(it.file) : it.file;
        toast('Publication en cours…');
        const up = await upload(file);
        const s = await post('/statuses', { type: it.kind, media: up, caption: it.caption });
        addMine(s);
        toast('Statut publié');
      } catch (e) { fail(e); }
    }
  });
}

function addMine(s) {
  S.statuses = S.statuses.filter(x => x.id !== s.id).concat(s);
  emit('statuses');
}

/* ---------------- Visionneuse ---------------- */
export function openViewer(order, startIdx, startStatus = -1) {
  let ui = startIdx, si = 0, timer = null, started = 0, elapsed = 0, paused = false, dur = 5000;
  const listFor = (uid) => S.statuses.filter(s => s.userId === uid).sort((a, b) => a.createdAt - b.createdAt);
  const firstUnseen = (uid) => { const l = listFor(uid); const k = l.findIndex(s => !s.viewed); return k < 0 ? 0 : k; };
  si = startStatus >= 0 ? startStatus : order[ui] === S.me.id ? 0 : firstUnseen(order[ui]);
  const el = h(`<div class="status-viewer" role="dialog"><div class="sv-stage">
    <div class="sv-content" data-content></div>
    <div class="sv-bars" data-bars></div>
    <div class="sv-head" data-head></div>
    <div class="sv-tap l" data-prev></div><div class="sv-tap r" data-next></div>
    <div class="sv-caption" data-cap hidden></div>
    <div class="sv-foot" data-foot></div></div></div>`);
  const close = () => { clearTimeout(timer); el.remove(); removeEventListener('keydown', key); emit('statuses'); };
  const key = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
    if (e.key === ' ' && e.target.tagName !== 'INPUT') { e.preventDefault(); paused ? resume() : pause(); }
  };
  addEventListener('keydown', key);

  const tickBars = () => {
    const bar = el.querySelectorAll('[data-bars] i b')[si];
    if (!bar) return;
    const p = Math.min(1, (elapsed + (paused ? 0 : Date.now() - started)) / dur);
    bar.style.width = p * 100 + '%';
    if (!paused) requestAnimationFrame(() => el.isConnected && tickBars());
  };
  const schedule = (ms) => { clearTimeout(timer); started = Date.now(); timer = setTimeout(next, ms); tickBars(); };
  const pause = () => { if (paused) return; paused = true; elapsed += Date.now() - started; clearTimeout(timer); el.querySelector('video')?.pause(); };
  const resume = () => { if (!paused) return; paused = false; el.querySelector('video')?.play(); schedule(dur - elapsed); };

  const show = () => {
    const uid = order[ui];
    const list = listFor(uid);
    if (!list.length) return next();
    if (si >= list.length) si = list.length - 1;
    const s = list[si];
    const own = uid === S.me.id;
    elapsed = 0; paused = false; dur = 5000;
    $('[data-bars]', el).innerHTML = list.map((_, k) => `<i><b style="width:${k < si ? 100 : 0}%"></b></i>`).join('');
    $('[data-head]', el).innerHTML = `<button class="icon-btn" data-close>${icon('back')}</button>${avatar(user(uid), 38)}
      <div class="grow"><b>${esc(own ? 'Mon statut' : user(uid).name)}</b><div style="font-size:12.5px;opacity:.8">${esc(relTime(s.createdAt))}</div></div>
      <button class="icon-btn" data-pp>${icon('pause')}</button><button class="icon-btn" data-more>${icon('more')}</button>`;
    const c = $('[data-content]', el);
    if (s.type === 'text') c.innerHTML = `<div class="sv-text fonts-${s.font || 0}" style="background:${esc(s.bg)}">${formatText(s.text)}</div>`;
    else if (s.type === 'image') c.innerHTML = `<img src="${esc(s.media.url)}" alt="">`;
    else c.innerHTML = `<video src="${esc(s.media.url)}" autoplay playsinline></video>`;
    const cap = $('[data-cap]', el);
    cap.hidden = !s.caption;
    cap.innerHTML = s.caption ? formatText(s.caption) : '';
    const foot = $('[data-foot]', el);
    if (own) {
      foot.innerHTML = `<div class="sv-views" data-views>${icon('eye')}<span>${s.views?.length || 0} vue${(s.views?.length || 0) > 1 ? 's' : ''}</span></div>`;
    } else {
      foot.innerHTML = `<input data-reply placeholder="Répondre…" maxlength="2000"><button class="icon-btn" data-heart title="J'aime" style="${s.myReaction ? 'color:#ff4d6d' : ''}">${icon('heart')}</button><button class="icon-btn" data-sendr>${icon('send')}</button>`;
    }
    if (!own && !s.viewed) { s.viewed = true; post(`/statuses/${s.id}/view`).catch(() => {}); }
    if (s.type === 'video') {
      const v = c.querySelector('video');
      v.onloadedmetadata = () => { dur = Math.min(60, v.duration || 15) * 1000; schedule(dur); };
      v.onerror = () => schedule(5000);
    } else schedule(Math.max(5000, Math.min(12000, (s.text || s.caption || '').length * 60)));
    bindFoot(s, own);
  };
  const bindFoot = (s, own) => {
    $('[data-close]', el).onclick = close;
    $('[data-pp]', el).onclick = () => { paused ? resume() : pause(); $('[data-pp]', el).innerHTML = icon(paused ? 'play' : 'pause'); };
    $('[data-more]', el).onclick = (e) => {
      pause();
      ctxMenu(e.currentTarget, own ? [
        { icon: 'trash', label: 'Supprimer ce statut', danger: true, onClick: async () => {
          if (!(await deleteStatus(s))) return resume();
          listFor(S.me.id).length ? show() : close();
        } },
        { icon: 'lock', label: 'Confidentialité du statut', onClick: () => { close(); statusPrivacy(); } },
      ] : [
        { icon: 'chat', label: 'Envoyer un message', onClick: () => { close(); post('/chats/dm/' + s.userId).then(c => { S.chats.set(c.id, c); nav.openChat(c.id); }).catch(fail); } },
        { icon: 'bellOff', label: 'Masquer ses statuts', onClick: () => { close(); muteMenu(s.userId, { x: innerWidth / 2, y: innerHeight / 2 }); } },
        { icon: 'flag', label: 'Signaler', onClick: () => { close(); import('./chatlist.js').then(m => m.report({ userId: s.userId })); } },
      ]);
    };
    if (own) {
      $('[data-views]', el).onclick = () => {
        pause();
        const views = (s.views || []).sort((a, b) => b.at - a.at);
        modal({
          title: `Vu par ${views.length}`, flush: true,
          body: views.length ? `<div class="list">${views.map(v => `<div class="item compact">${avatar(user(v.userId), 40)}<div class="body"><div class="top"><span class="name">${esc(user(v.userId).name)}</span>${v.reaction ? `<span style="font-size:20px">${v.reaction}</span>` : ''}</div><div class="bot"><span class="prev">${esc(relTime(v.at))}</span></div></div></div>`).join('')}</div>` : '<div class="empty">Personne n\'a encore vu ce statut.</div>',
          onClose: resume,
        });
      };
      return;
    }
    const inp = $('[data-reply]', el);
    inp.onfocus = pause;
    inp.onblur = () => { if (!inp.value) resume(); };
    const send = async () => {
      if (!inp.value.trim()) return;
      try { await post(`/statuses/${s.id}/reply`, { text: inp.value.trim() }); toast('Réponse envoyée'); inp.value = ''; inp.blur(); resume(); } catch (e) { fail(e); }
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') send(); e.stopPropagation(); };
    $('[data-sendr]', el).onclick = send;
    $('[data-heart]', el).onclick = (e) => {
      pause();
      const bar = h(`<div class="react-bar" style="position:absolute;bottom:76px;right:12px">${['❤️', ...QUICK.filter(x => x !== '❤️')].map(x => `<button>${x}</button>`).join('')}</div>`);
      $('.sv-stage', el).append(bar);
      bar.onclick = async (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        bar.remove();
        s.myReaction = b.textContent;
        post(`/statuses/${s.id}/react`, { emoji: b.textContent }).catch(fail);
        toast(`Réaction ${b.textContent} envoyée`);
        resume();
      };
    };
  };
  const next = () => {
    const list = listFor(order[ui]);
    if (si < list.length - 1) { si++; return show(); }
    if (ui < order.length - 1) { ui++; si = order[ui] === S.me.id ? 0 : firstUnseen(order[ui]); return show(); }
    close();
  };
  const prev = () => {
    if (si > 0) { si--; return show(); }
    if (ui > 0) { ui--; si = 0; return show(); }
    show();
  };
  // Toucher à gauche/droite pour naviguer ; maintenir appuyé pour mettre en pause.
  let holdT, held = false;
  [['[data-next]', next], ['[data-prev]', prev]].forEach(([sel, go]) => {
    const z = $(sel, el);
    z.addEventListener('pointerdown', () => { held = false; holdT = setTimeout(() => { held = true; pause(); }, 250); });
    z.addEventListener('pointerup', () => { clearTimeout(holdT); if (held) resume(); });
    z.addEventListener('click', () => { if (held) { held = false; return; } go(); });
  });
  document.body.append(el);
  show();
}
