// Onglet « Ma classe » : le tableau de bord du groupe unique de l'élève.
import { $, esc, icon, avatar, fold, fullDate, listTime, fileSize, extOf, docKind, monthShort } from './util.js';
import { get, post } from './api.js';
import { S, emit, user, displayName } from './state.js';
import { fail, ctxMenu } from './ui.js';
import { nav } from './nav.js';
import { live } from './chatlist.js';

const KIND = { cours: 'Cours', devoir: 'Devoir', examen: 'Examen', reunion: 'Réunion', sortie: 'Sortie', autre: 'Évènement' };

export function render(side) {
  side.innerHTML = `<div class="panel-head"><h1>Ma classe</h1><button class="icon-btn" data-info title="Infos du groupe">${icon('info')}</button></div><div class="list scroll" data-body></div>`;
  const body = $('[data-body]', side);
  let ov = null;
  let q = '';
  const draw = () => {
    const c = S.cls;
    if (!c) { body.innerHTML = '<div class="empty">Classe introuvable.</div>'; return; }
    const members = [...S.members.values()].filter(u => !u.deleted && u.classId === c.id).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const shown = members.filter(u => fold(u.name).includes(fold(q)));
    body.innerHTML = `
      <div class="class-hero">${avatar(c, 84, { group: true })}<h3>${esc(c.name)}</h3>
        <p>${esc(c.cycleLabel)} · ${esc(c.filiere)} · ${esc(c.niveau)}</p><p>${esc(c.country)}</p>
        <div class="row" style="justify-content:center;margin-top:14px;gap:8px;flex-wrap:wrap">
          <button class="btn" data-a="open" style="background:#fff;color:var(--brand-strong)">${icon('chat', 'sm')} Discussion</button>
          <button class="btn ghost" data-a="call" style="color:#fff;border-color:rgba(255,255,255,.5)">${icon('phone', 'sm')} Appel</button>
          <button class="btn ghost" data-a="video" style="color:#fff;border-color:rgba(255,255,255,.5)">${icon('video', 'sm')} Vidéo</button>
        </div></div>
      <div class="stats"><div><b>${c.memberCount}</b><small>membres</small></div><div><b>${ov ? ov.events.length : '–'}</b><small>évènement${ov?.events.length > 1 ? 's' : ''}</small></div><div><b>${ov ? ov.online : '–'}</b><small>en ligne</small></div></div>

      <div class="section-title">Agenda de la classe</div>
      ${ov ? (ov.events.length ? ov.events.map(m => {
        const e = m.event; const d = new Date(e.startsAt);
        const mine = e.responses?.[S.me.id];
        return `<div class="upcoming" data-jump="${m.id}"><div class="event" style="min-width:0;flex:none"><div class="cal"><small>${monthShort(e.startsAt)}</small><b>${d.getDate()}</b></div></div>
          <div class="grow"><span class="tag ${e.kind === 'examen' ? 'red' : e.kind === 'devoir' ? 'warn' : ''}">${KIND[e.kind] || 'Évènement'}</span> <b>${esc(e.title)}</b>
          <div class="faint" style="font-size:13px">${esc(fullDate(e.startsAt))}${e.place ? ' · ' + esc(e.place) : ''}</div>
          ${mine ? `<div style="font-size:12.5px;color:var(--brand)">${mine === 'going' ? 'Vous participez' : mine === 'maybe' ? 'Peut-être' : 'Absent'}</div>` : ''}</div></div>`;
      }).join('') : `<div class="empty" style="padding:14px 20px">Aucun évènement à venir. Créez-en un depuis la discussion (+ › Évènement) : cours, devoir, examen…</div>`) : '<div class="empty">Chargement…</div>'}

      ${ov?.polls.length ? `<div class="section-title">Sondages récents</div>${ov.polls.map(m => {
        const total = new Set(m.poll.options.flatMap(o => o.votes)).size;
        const voted = m.poll.options.some(o => o.votes.includes(S.me.id));
        return `<div class="item compact" data-jump="${m.id}"><div class="av" style="--s:40px;background:var(--accent)">${icon('poll')}</div><div class="body"><div class="top"><span class="name" style="font-size:15px">${esc(m.poll.question)}</span><span class="time">${listTime(m.createdAt)}</span></div><div class="bot"><span class="prev">${total} votant${total > 1 ? 's' : ''} · ${voted ? 'Vous avez voté' : '<b style="color:var(--brand)">À voter</b>'}</span></div></div></div>`;
      }).join('')}` : ''}

      ${ov?.docs.length ? `<div class="section-title">Cours et documents partagés</div>${ov.docs.slice(0, 10).map(m => `
        <a class="item compact" href="${esc(m.media.url)}" download="${esc(m.media.name)}" target="_blank" style="text-decoration:none;color:inherit">
          <span class="doc" style="min-width:0;padding:0;background:none"><span class="ext ${docKind(m.media.name) === 'pdf' ? '' : docKind(m.media.name)}">${esc(extOf(m.media.name).slice(0, 4))}</span></span>
          <div class="body"><div class="top"><span class="name" style="font-size:14.5px">${esc(m.media.name)}</span></div><div class="bot"><span class="prev">${fileSize(m.media.size)} · ${esc(displayName(m.senderId))} · ${listTime(m.createdAt)}</span></div></div></a>`).join('')}
        ${ov.docs.length > 10 ? `<div class="menu-row" data-a="media"><div class="txt" style="color:var(--brand)">Voir tous les documents (${ov.docs.length})</div></div>` : ''}` : ''}

      <div class="section-title">Annuaire de la classe</div>
      <div style="padding:0 14px 8px"><div class="search-box">${icon('search', 'sm')}<input placeholder="Rechercher un camarade" data-q value="${esc(q)}"></div></div>
      <div data-dir>${shown.slice(0, 300).map(u => memberRow(u)).join('') || '<div class="empty">Aucun résultat.</div>'}</div>
      <div class="empty" style="font-size:12.5px">${icon('lock', 'xs')} Tu fais partie de ce groupe car tu as choisi « ${esc(c.filiere)} · ${esc(c.niveau)} » à l'inscription. Chaque élève n'appartient qu'à une seule classe.</div>`;
    const qi = $('[data-q]', body);
    qi.oninput = () => {
      q = qi.value;
      $('[data-dir]', body).innerHTML = members.filter(u => fold(u.name).includes(fold(q))).slice(0, 300).map(u => memberRow(u)).join('') || '<div class="empty">Aucun résultat.</div>';
    };
  };
  const memberRow = (u) => `<div class="item compact" data-uid="${u.id}"><div class="av-wrap">${avatar(u, 42)}${u.online ? '<span class="dot"></span>' : ''}</div>
    <div class="body"><div class="top"><span class="name">${esc(u.id === S.me.id ? `${u.name} (vous)` : u.name)}</span></div>
    <div class="bot"><span class="prev">${esc(u.school || u.about || '')}</span></div></div></div>`;
  const load = async () => { try { ov = await get('/class/overview'); } catch {} if (side.isConnected) draw(); };
  draw();
  load();
  live(side, 'class', draw);
  live(side, 'members', draw);
  live(side, 'presence', () => { if (!$('[data-q]', body) || document.activeElement !== $('[data-q]', body)) draw(); });
  live(side, 'msg:new', (m) => { if (m.chatId === S.cls?.id && ['event', 'poll', 'document'].includes(m.type)) load(); });
  $('[data-info]', side).onclick = () => import('./info.js').then(m => m.openGroup());
  body.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'open') return nav.openChat(S.cls.id);
    if (a === 'call' || a === 'video') return nav.startCall(S.cls.id, a === 'video');
    if (a === 'media') return import('./info.js').then(m => m.openMedia(S.chats.get(S.cls.id)));
    const j = e.target.closest('[data-jump]');
    if (j) return nav.openChat(S.cls.id, { around: j.dataset.jump });
    const it = e.target.closest('[data-uid]');
    if (!it) return;
    const uid = it.dataset.uid;
    if (uid === S.me.id) return import('./settings.js').then(m => { nav.setTab('settings'); m.openProfile(); });
    ctxMenu(it, [
      { icon: 'chat', label: 'Envoyer un message', onClick: () => post('/chats/dm/' + uid).then(c => { S.chats.set(c.id, c); emit('chats'); nav.openChat(c.id); }).catch(fail) },
      { icon: 'phone', label: 'Appel vocal', onClick: () => post('/chats/dm/' + uid).then(c => { S.chats.set(c.id, c); nav.startCall(c.id, false); }).catch(fail) },
      { icon: 'video', label: 'Appel vidéo', onClick: () => post('/chats/dm/' + uid).then(c => { S.chats.set(c.id, c); nav.startCall(c.id, true); }).catch(fail) },
      { icon: 'info', label: 'Voir le profil', onClick: () => nav.openProfile(uid) },
    ], { align: 'left' });
  });
}
