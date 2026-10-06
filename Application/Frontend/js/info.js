// Panneaux d'informations : contact, groupe de classe, liste de diffusion, médias, infos de message.
import { $, h, esc, icon, avatar, lastSeenText, fullDate, listTime, fileSize, extOf, docKind, copyText, formatText, fold, hhmm, pickFiles } from './util.js';
import { get, post, patch, del, upload } from './api.js';
import { S, emit, user, displayName, chatTitle, isMuted, canEditClass, blocked, preview } from './state.js';
import { toast, fail, ctxMenu, modal, confirmBox, choose, promptBox, pickMembers, pushPage } from './ui.js';
import { nav } from './nav.js';
import { live, muteChat, clearChat, deleteChat, toggleBlock, report } from './chatlist.js';
import { openViewer } from './media.js';

const DISAPPEAR = [{ value: 86400, label: '24 heures' }, { value: 604800, label: '7 jours' }, { value: 7776000, label: '90 jours' }, { value: 0, label: 'Désactivé' }];
const disLabel = (s) => DISAPPEAR.find(x => x.value === s)?.label || 'Désactivé';

export function openChatInfo(chat) {
  if (chat.type === 'group') return openGroup();
  if (chat.type === 'broadcast') return openBroadcast(chat);
  return openUser(chat.peerId);
}

function row(ic, title, sub = '', attrs = '', cls = '') {
  return `<div class="menu-row ${cls}" ${attrs}>${icon(ic)}<div class="txt"><span>${title}</span>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
}

async function mediaStrip(chatId, box) {
  try {
    const r = await get(`/chats/${chatId}/media`);
    const items = r.media.slice(0, 12);
    const total = r.media.length + r.docs.length + r.links.length;
    box.innerHTML = `<div class="card-title" data-all style="cursor:pointer"><span>Médias, liens et docs</span><span>${total} ${icon('chevR', 'xs')}</span></div>`
      + (items.length ? `<div class="media-strip">${items.map((m, i) => m.type === 'video'
        ? `<div data-i="${i}"><video src="${esc(m.media.url)}#t=0.5" preload="metadata" muted></video></div>`
        : `<div data-i="${i}" style="background-image:url('${esc(m.media.url)}')"></div>`).join('')}</div>` : '<div class="card-pad faint" style="font-size:13px;padding-top:0">Aucun média partagé pour le moment.</div>');
    box.onclick = (e) => {
      const i = e.target.closest('[data-i]')?.dataset.i;
      if (i !== undefined) return openViewer(r.media.map(m => ({ url: m.media.url, type: m.type, caption: m.text, senderId: m.senderId, createdAt: m.createdAt, name: m.media.name })), Number(i));
      if (e.target.closest('[data-all]')) openMedia(S.chats.get(chatId), true);
    };
  } catch { box.innerHTML = ''; }
}

/* ---------------- Profil d'un camarade ---------------- */
export async function openUser(uid) {
  if (!uid) return;
  if (uid === S.me.id && !S.chats.get(S.current)?.peerId) return import('./settings.js').then(m => { nav.setTab('settings'); m.openProfile(); });
  nav.openDrawer({
    title: uid === S.me.id ? 'Vous' : 'Infos du contact',
    render: async (body) => {
      const draw = async () => {
        let u = user(uid);
        try { u = { ...u, ...(await get('/users/' + uid)) }; } catch {}
        const chatId = 'dm_' + [S.me.id, uid].sort().join('_');
        const chat = S.chats.get(chatId);
        const self = uid === S.me.id;
        body.innerHTML = `
          <div class="profile-top">${avatar(u, 200)}
            <h3>${esc(u.name)}</h3>
            <p>${esc(u.phone || 'Numéro masqué')}</p>
            <p class="faint" style="font-size:13.5px">${esc(lastSeenText(u))}</p>
            ${!self ? `<div class="profile-actions">
              <button data-a="msg">${icon('chat')}Message</button>
              <button data-a="audio">${icon('phone')}Audio</button>
              <button data-a="video">${icon('video')}Vidéo</button>
              <button data-a="search">${icon('search')}Rechercher</button></div>` : ''}
          </div>
          ${u.about !== null && u.about !== undefined ? `<div class="card"><div class="card-title">Infos</div><div class="card-pad" style="padding-top:0">${formatText(u.about || '—')}</div></div>` : ''}
          <div class="card"><div class="card-title">Scolarité</div>
            ${row('cap', esc(S.cls?.name || ''), esc(`${S.cls?.cycleLabel || ''} · ${S.cls?.country || ''}`))}
            ${u.school ? row('book', esc(u.school), 'Établissement') : ''}
            ${u.joinedAt ? row('calendar', 'Membre depuis', esc(fullDate(u.joinedAt))) : ''}</div>
          ${chat ? `<div class="card" data-media></div>` : ''}
          ${chat ? `<div class="card">
            ${row(isMuted(chat) ? 'bellOff' : 'bell', 'Notifications', isMuted(chat) ? 'En sourdine' : 'Activées', 'data-a="mute"')}
            ${row('timer', 'Messages éphémères', disLabel(chat.disappearing), 'data-a="dis"')}
            ${row('wall', 'Fond d\'écran de la discussion', '', 'data-a="wall"')}
            ${row('lock', 'Confidentialité', 'Seuls vous deux, membres de la même classe, pouvez lire cette discussion.')}</div>` : ''}
          ${!self ? `<div class="card">
            ${row('ban', blocked(uid) ? `Débloquer ${esc(u.name)}` : `Bloquer ${esc(u.name)}`, '', 'data-a="block"', 'danger')}
            ${row('flag', `Signaler ${esc(u.name)}`, '', 'data-a="report"', 'danger')}
            ${chat ? row('trash', 'Supprimer la discussion', '', 'data-a="delete"', 'danger') : ''}
          </div>` : ''}`;
        if (chat) mediaStrip(chat.id, $('[data-media]', body));
        $('.profile-top .av', body).onclick = () => u.avatar && openViewer([{ url: u.avatar, type: 'image', caption: u.name }], 0);
        body.onclick = async (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (!a) return;
          const ensure = async () => { const c = await post('/chats/dm/' + uid); S.chats.set(c.id, c); emit('chats'); return c; };
          try {
            if (a === 'msg') { const c = await ensure(); nav.openChat(c.id); }
            if (a === 'audio' || a === 'video') { const c = await ensure(); nav.startCall(c.id, a === 'video'); }
            if (a === 'search') { const c = await ensure(); await nav.openChat(c.id); $('[data-search]', nav.els.main)?.click(); }
            if (a === 'mute') await muteChat(chat);
            if (a === 'dis') await setDisappearing(chat);
            if (a === 'wall') import('./settings.js').then(m => m.pickWallpaper(chat.id));
            if (a === 'block') { await toggleBlock(uid); draw(); }
            if (a === 'report') report({ userId: uid });
            if (a === 'delete') { await deleteChat(chat); nav.closeDrawer(); }
          } catch (er) { fail(er); }
        };
      };
      draw();
      live(body, 'chat:meta', draw);
    },
  });
}

/* ---------------- Groupe de classe ---------------- */
export function openGroup() {
  nav.openDrawer({
    title: 'Infos du groupe',
    render: (body) => {
      let q = '';
      const draw = () => {
        const c = S.cls;
        const chat = S.chats.get(c.id);
        const canEdit = canEditClass();
        const members = [...S.members.values()].filter(u => !u.deleted && u.classId === c.id)
          .sort((a, b) => (b.id === S.me.id) - (a.id === S.me.id) || a.name.localeCompare(b.name, 'fr'));
        const shown = members.filter(u => fold(u.name).includes(fold(q)));
        body.innerHTML = `
          <div class="profile-top">
            <div data-icon style="display:inline-block">${avatar({ ...c, icon: c.icon }, 180, { group: true })}</div>
            <h3 class="edit-line" style="justify-content:center">${esc(c.name)} ${canEdit ? `<button class="icon-btn" data-a="name" title="Renommer">${icon('edit', 'sm')}</button>` : ''}</h3>
            <p>Groupe · ${c.memberCount} membre${c.memberCount > 1 ? 's' : ''}</p>
            <p class="faint" style="font-size:13px">${esc(c.cycleLabel)} · ${esc(c.filiere)} · ${esc(c.niveau)} — ${esc(c.country)}</p>
            <div class="profile-actions">
              <button data-a="audio">${icon('phone')}Audio</button>
              <button data-a="video">${icon('video')}Vidéo</button>
              <button data-a="search">${icon('search')}Rechercher</button></div>
          </div>
          <div class="card"><div class="card-title"><span>Description</span>${canEdit ? `<button class="icon-btn" data-a="desc">${icon('edit', 'sm')}</button>` : ''}</div>
            <div class="card-pad" style="padding-top:0;white-space:pre-wrap">${formatText(c.description || 'Aucune description.')}</div>
            <div class="card-pad faint" style="font-size:12.5px;padding-top:0">Groupe créé le ${esc(fullDate(c.createdAt))}</div></div>
          <div class="card" data-media></div>
          <div class="card">
            ${row(isMuted(chat) ? 'bellOff' : 'bell', 'Notifications', isMuted(chat) ? 'En sourdine' : 'Activées', 'data-a="mute"')}
            ${row('timer', 'Messages éphémères', disLabel(chat?.disappearing), 'data-a="dis"')}
            ${row('wall', 'Fond d\'écran de la discussion', '', 'data-a="wall"')}
            ${c.inviteCode ? row('link', 'Inviter via un lien', 'Partager le lien d\'inscription de la classe', 'data-a="invite"') : ''}
            ${c.settings.readOnly ? row('lock', 'Groupe fermé en écriture', 'L\'administration a temporairement réservé la publication.') : ''}
            ${row('shield', 'Géré par l\'administration de Scola', 'Les réglages et la modération de ce groupe sont assurés par l\'administration du site. Signalez tout abus depuis un message ou un profil.')}
            ${row('lock', 'Groupe fermé', 'Réservé aux élèves/étudiants de cette filière et de ce niveau. Personne ne peut y être ajouté ou s\'y inscrire depuis une autre classe.')}
          </div>
          <div class="card">
            <div class="card-title"><span>${c.memberCount} membre${c.memberCount > 1 ? 's' : ''}</span>${icon('users', 'sm')}</div>
            <div style="padding:0 16px 8px"><div class="search-box">${icon('search', 'sm')}<input placeholder="Rechercher un membre" data-q value="${esc(q)}"></div></div>
            <div data-members>${shown.slice(0, 300).map(u => `
              <div class="item compact" data-uid="${u.id}">${avatar(u, 40)}
                <div class="body"><div class="top"><span class="name">${esc(u.id === S.me.id ? 'Vous' : u.name)}</span>${c.restricted.includes(u.id) ? '<span class="tag red">Restreint</span>' : ''}</div>
                <div class="bot"><span class="prev">${esc(u.about || u.school || '')}</span></div></div></div>`).join('')}
              ${shown.length > 300 ? `<div class="empty">+ ${shown.length - 300} autres membres, affinez la recherche.</div>` : ''}</div>
          </div>
          <div class="card">
            ${row('download', 'Exporter la discussion', '', 'data-a="export"')}
            ${row('x', 'Effacer la discussion', '', 'data-a="clear"', 'danger')}
            ${row('info', 'Quitter le groupe', 'Impossible : votre classe est définie à l\'inscription. Vous pouvez mettre le groupe en sourdine ou l\'archiver.', '', 'faint')}
          </div>`;
        mediaStrip(c.id, $('[data-media]', body));
        const qi = $('[data-q]', body);
        qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw(); const n = $('[data-q]', body); n.focus(); n.selectionStart = n.selectionEnd = pos; };
        $('[data-icon]', body).onclick = () => {
          if (!canEdit) return c.icon && openViewer([{ url: c.icon, type: 'image', caption: c.name }], 0);
          ctxMenu($('[data-icon]', body), [
            c.icon && { icon: 'eye', label: 'Voir l\'icône', onClick: () => openViewer([{ url: c.icon, type: 'image', caption: c.name }], 0) },
            { icon: 'image', label: 'Changer l\'icône', onClick: changeIcon },
            c.icon && { icon: 'trash', label: 'Supprimer l\'icône', danger: true, onClick: () => patch('/class', { icon: null }).then(setCls).catch(fail) },
          ], { align: 'left' });
        };
      };
      draw();
      live(body, 'class', draw);
      live(body, 'members', draw);
      live(body, 'chat:meta', draw);
      body.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        const m = e.target.closest('[data-uid]')?.dataset.uid;
        const chat = S.chats.get(S.cls.id);
        try {
          if (m) return memberMenu(m, e.target.closest('[data-uid]'));
          if (a === 'name') { const v = await promptBox('Nom du groupe', { value: S.cls.name, max: 100 }); if (v) setCls(await patch('/class', { name: v })); }
          if (a === 'desc') { const v = await promptBox('Description du groupe', { value: S.cls.description, max: 2048, multiline: true }); if (v !== null) setCls(await patch('/class', { description: v })); }
          if (a === 'audio' || a === 'video') nav.startCall(S.cls.id, a === 'video');
          if (a === 'search') { await nav.openChat(S.cls.id); $('[data-search]', nav.els.main)?.click(); }
          if (a === 'mute') await muteChat(chat);
          if (a === 'dis') await setDisappearing(chat);
          if (a === 'wall') import('./settings.js').then(x => x.pickWallpaper(S.cls.id));
          if (a === 'invite') inviteLink();
          if (a === 'export') import('./api.js').then(x => x.downloadAuth(`/chats/${S.cls.id}/export`, 'discussion.txt')).catch(fail);
          if (a === 'clear') clearChat(chat);
        } catch (er) { fail(er); }
      });
    },
  });
}

function setCls(c) { S.cls = c; emit('class'); }

async function changeIcon() {
  const files = await pickFiles({ accept: 'image/*' });
  if (!files) return;
  try { const f = await upload(files[0]); setCls(await patch('/class', { icon: f.url })); toast('Icône mise à jour'); } catch (e) { fail(e); }
}

function memberMenu(uid, anchor) {
  const u = user(uid);
  if (uid === S.me.id) {
    return ctxMenu(anchor, [
      { icon: 'user', label: 'Mon profil', onClick: () => import('./settings.js').then(m => { nav.setTab('settings'); m.openProfile(); }) },
      { icon: 'chat', label: 'Message à moi-même', onClick: () => post('/chats/dm/' + uid).then(c => { S.chats.set(c.id, c); nav.openChat(c.id); }).catch(fail) },
    ]);
  }
  ctxMenu(anchor, [
    { icon: 'chat', label: `Écrire à ${u.name}`, onClick: () => post('/chats/dm/' + uid).then(c => { S.chats.set(c.id, c); emit('chats'); nav.openChat(c.id); }).catch(fail) },
    { icon: 'phone', label: 'Appel vocal', onClick: () => post('/chats/dm/' + uid).then(c => { S.chats.set(c.id, c); nav.startCall(c.id, false); }).catch(fail) },
    { icon: 'video', label: 'Appel vidéo', onClick: () => post('/chats/dm/' + uid).then(c => { S.chats.set(c.id, c); nav.startCall(c.id, true); }).catch(fail) },
    { icon: 'info', label: 'Voir le profil', onClick: () => openUser(uid) },
    { icon: 'flag', label: 'Signaler à l\'administration', danger: true, onClick: () => report({ userId: uid }) },
  ]);
}

function inviteLink() {
  nav.openDrawer({
    title: 'Lien d\'invitation', stack: true,
    render: async (body) => {
      const draw = async () => {
        const link = `${location.origin}/?join=${S.cls.inviteCode}`;
        body.innerHTML = `<div class="profile-top">${avatar(S.cls, 80, { group: true })}<h3 style="font-size:17px;margin-top:10px">${esc(S.cls.name)}</h3>
          <p style="word-break:break-all;font-size:13.5px"><a href="${esc(link)}" target="_blank">${esc(link)}</a></p>
          <p class="faint" style="font-size:12.5px">Toute personne qui s'inscrit avec ce lien voit sa classe pré-remplie. Elle doit tout de même vérifier son numéro.</p>
          <div data-qr style="width:200px;height:200px;margin:12px auto;background:#fff;border-radius:8px"></div></div>
          <div class="card">${row('copy', 'Copier le lien', '', 'data-a="copy"')}${navigator.share ? row('share', 'Partager le lien', '', 'data-a="share"') : ''}</div>`;
        get('/qr?text=' + encodeURIComponent(link)).then(r => { const q = $('[data-qr]', body); if (q) q.innerHTML = `<img src="${r.qr}" style="width:100%">`; }).catch(() => {});
        body.onclick = async (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'copy') copyText(link).then(() => toast('Lien copié'));
          if (a === 'share') navigator.share({ title: 'Rejoins ma classe sur Scola', text: `Rejoins « ${S.cls.name} » sur Scola !`, url: link }).catch(() => {});
        };
      };
      draw();
    },
  });
}

/* ---------------- Liste de diffusion ---------------- */
function openBroadcast(chat) {
  nav.openDrawer({
    title: 'Infos de la liste',
    render: (body) => {
      const draw = () => {
        const c = S.chats.get(chat.id) || chat;
        body.innerHTML = `<div class="profile-top">${avatar({ id: c.id }, 120, { broadcast: true })}
          <h3 class="edit-line" style="justify-content:center">${esc(c.name)} <button class="icon-btn" data-a="name">${icon('edit', 'sm')}</button></h3>
          <p>Liste de diffusion · ${c.recipients.length} destinataires</p></div>
          <div class="card"><div class="card-title"><span>Destinataires</span><button class="btn text" data-a="edit">Modifier</button></div>
            ${c.recipients.map(id => `<div class="item compact" data-uid="${id}">${avatar(user(id), 40)}<div class="body"><span class="name">${esc(user(id).name)}</span></div></div>`).join('')}</div>
          <div class="card">${row('info', 'Comment ça marche ?', 'Chaque destinataire reçoit vos messages dans votre discussion privée avec lui. Ses réponses arrivent aussi en privé.')}
            ${row('trash', 'Supprimer la liste', '', 'data-a="delete"', 'danger')}</div>`;
      };
      draw();
      live(body, 'chats', draw);
      body.onclick = async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        const uid = e.target.closest('[data-uid]')?.dataset.uid;
        const c = S.chats.get(chat.id);
        try {
          if (uid) return openUser(uid);
          if (a === 'name') { const v = await promptBox('Nom de la liste', { value: c.name, max: 60 }); if (v) S.chats.set(c.id, await patch('/broadcasts/' + c.id, { name: v })); emit('chats'); emit('chat:meta', c.id); }
          if (a === 'edit') { const ids = await pickMembers({ title: 'Destinataires', multiple: true, min: 2, selected: c.recipients, exclude: [S.me.id] }); if (ids) { S.chats.set(c.id, await patch('/broadcasts/' + c.id, { recipients: ids })); emit('chats'); emit('chat:meta', c.id); } }
          if (a === 'delete') { await deleteChat(c); nav.closeDrawer(); }
        } catch (er) { fail(er); }
      };
    },
  });
}

/* ---------------- Messages éphémères ---------------- */
export async function setDisappearing(chat) {
  if (chat.type === 'group' && !canEditClass()) return toast('Ce réglage du groupe est géré par l\'administration de Scola.');
  const v = await choose('Messages éphémères', DISAPPEAR, chat.disappearing || 0, { note: 'Les nouveaux messages disparaîtront de la discussion après la durée choisie.', okLabel: 'Valider' });
  if (v === null || v === (chat.disappearing || 0)) return;
  try { const s = await patch(`/chats/${chat.id}/disappearing`, { seconds: v }); S.chats.set(s.id, s); emit('chats'); emit('chat:meta', s.id); } catch (e) { fail(e); }
}

/* ---------------- Médias, liens et documents ---------------- */
export function openMedia(chat, stack = false) {
  nav.openDrawer({
    title: chatTitle(chat), stack,
    render: async (body) => {
      body.innerHTML = '<div class="empty">Chargement…</div>';
      let r;
      try { r = await get(`/chats/${chat.id}/media`); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      let tab = 'media';
      const draw = () => {
        const list = r[tab];
        let content = '';
        if (tab === 'media') content = list.length ? `<div class="media-grid">${list.map((m, i) => m.type === 'video'
          ? `<div data-i="${i}"><video src="${esc(m.media.url)}#t=0.5" preload="metadata" muted></video></div>`
          : `<div data-i="${i}" style="background-image:url('${esc(m.media.url)}')"></div>`).join('')}</div>` : `<div class="empty">${icon('image')}Aucun média</div>`;
        if (tab === 'docs') content = list.map(m => `<a class="item compact" href="${esc(m.media.url)}" download="${esc(m.media.name)}" style="text-decoration:none;color:inherit">
          <span class="doc" style="min-width:0;padding:0;background:none"><span class="ext ${docKind(m.media.name) === 'pdf' ? '' : docKind(m.media.name)}">${esc(extOf(m.media.name).slice(0, 4))}</span></span>
          <div class="body"><div class="top"><span class="name" style="font-size:14.5px">${esc(m.media.name)}</span></div><div class="bot"><span class="prev">${fileSize(m.media.size)} · ${listTime(m.createdAt)} · ${esc(displayName(m.senderId))}</span></div></div></a>`).join('') || `<div class="empty">${icon('file')}Aucun document</div>`;
        if (tab === 'links') content = list.map(m => `<div class="item compact" data-jump="${m.id}"><div class="body">
          ${m.linkPreview ? `<b style="font-size:14px">${esc(m.linkPreview.title)}</b>` : ''}<div class="text" style="font-size:13.5px">${formatText(m.text)}</div><small class="faint">${listTime(m.createdAt)} · ${esc(displayName(m.senderId))}</small></div></div>`).join('') || `<div class="empty">${icon('link')}Aucun lien</div>`;
        body.innerHTML = `<div class="media-tabs">${[['media', 'Médias'], ['docs', 'Documents'], ['links', 'Liens']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l} (${r[k].length})</button>`).join('')}</div>${content}`;
      };
      draw();
      body.onclick = (e) => {
        const t = e.target.closest('[data-t]');
        if (t) { tab = t.dataset.t; return draw(); }
        const i = e.target.closest('[data-i]')?.dataset.i;
        if (i !== undefined) openViewer(r.media.map(m => ({ url: m.media.url, type: m.type, caption: m.text, senderId: m.senderId, createdAt: m.createdAt, name: m.media.name })), Number(i));
        const j = e.target.closest('[data-jump]');
        if (j && !e.target.closest('a')) { nav.openChat(chat.id, { around: j.dataset.jump }); }
      };
    },
  });
}

/* ---------------- Infos d'un message (lu par, distribué à) ---------------- */
export function openMessageInfo(m) {
  nav.openDrawer({
    title: 'Infos du message',
    render: async (body) => {
      body.innerHTML = '<div class="empty">Chargement…</div>';
      try {
        const r = await get(`/messages/${m.id}/info`);
        const read = r.rows.filter(x => x.readAt).sort((a, b) => b.readAt - a.readAt);
        const delivered = r.rows.filter(x => !x.readAt && x.deliveredAt);
        const pending = r.rows.filter(x => !x.deliveredAt);
        const chat = S.chats.get(m.chatId);
        const list = (rows, key) => rows.map(x => `<div class="item compact">${avatar(user(x.userId), 40)}<div class="body"><div class="top"><span class="name">${esc(user(x.userId).name)}</span></div>${key ? `<div class="bot"><span class="prev">${esc(fullDate(x[key]))}</span></div>` : ''}</div></div>`).join('');
        body.innerHTML = `<div class="card card-pad"><div class="text" style="font-size:14.5px">${formatText(preview(r.message))}</div><small class="faint">Envoyé le ${esc(fullDate(m.createdAt))}${m.editedAt ? ` · modifié à ${hhmm(m.editedAt)}` : ''}</small></div>`
          + (chat.type === 'dm' ? `<div class="card">${row('check2', 'Lu', read[0] ? esc(fullDate(read[0].readAt)) : '—')}${row('check2', 'Distribué', r.rows[0]?.deliveredAt ? esc(fullDate(r.rows[0].deliveredAt)) : '—')}</div>`
            : `<div class="card"><div class="card-title" style="color:var(--tick-read)">Lu par ${read.length}</div>${list(read, 'readAt') || '<div class="card-pad faint">Personne pour l\'instant</div>'}</div>
               <div class="card"><div class="card-title">Distribué à ${delivered.length}</div>${list(delivered, 'deliveredAt') || '<div class="card-pad faint">—</div>'}</div>
               ${pending.length ? `<div class="card"><div class="card-title">En attente ${pending.length}</div>${list(pending.slice(0, 100))}</div>` : ''}`);
      } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    },
  });
}
