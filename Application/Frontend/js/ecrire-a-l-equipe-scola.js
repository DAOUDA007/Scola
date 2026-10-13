// « Écrire à l'équipe Scola » (Profil › Aide) : conversation privée avec l'administration.
// Chaque demande a un sujet, un historique et un statut ; une réponse de l'équipe arrive
// en notification et s'affiche avec un compteur sur la ligne « Aide ».
import { $, h, esc, icon, formatText, fullDate, listTime, pickFiles } from './outils-communs.js';
import { get, post, upload } from './appels-au-serveur.js';
import { emit } from './memoire-de-l-application.js';
import { toast, fail, pushPage } from './fenetres-et-menus.js';

export const SUPPORT = { tickets: [], topics: {}, unread: 0, loaded: false };

export async function loadSupport() {
  try {
    const r = await get('/support');
    Object.assign(SUPPORT, r, { loaded: true, unread: r.tickets.reduce((n, t) => n + t.unread, 0) });
    emit('support');
  } catch {}
}
export const supportBadge = () => (SUPPORT.unread ? `<span class="badge">${SUPPORT.unread > 99 ? '99+' : SUPPORT.unread}</span>` : '');

const STATUS_CLS = { open: 'wait', pending: 'ok', resolved: 'done' };
const statusTag = (t) => `<span class="sup-status ${STATUS_CLS[t.status]}">${t.status === 'pending' ? 'Réponse reçue' : t.status === 'open' ? 'Envoyée' : 'Résolue'}</span>`;

// Pièce jointe (capture d'écran ou PDF) envoyée avant le message.
async function attach(holder, state) {
  const files = await pickFiles({ accept: 'image/*,application/pdf' });
  if (!files) return;
  const f = files[0];
  if (f.size > 10 * 1024 * 1024) return toast('Fichier trop lourd (10 Mo maximum).', { error: true });
  holder.innerHTML = `<span class="sup-file">${icon('clip', 'xs')} Envoi…</span>`;
  try {
    state.media = await upload(f);
    holder.innerHTML = `<span class="sup-file">${icon(f.type.startsWith('image/') ? 'image' : 'file', 'xs')} ${esc(f.name)} <button type="button" class="icon-btn" data-rm aria-label="Retirer">${icon('x', 'xs')}</button></span>`;
    $('[data-rm]', holder).onclick = () => { state.media = null; holder.innerHTML = ''; };
  } catch (e) { holder.innerHTML = ''; fail(e); }
}

const msgHTML = (m) => `<div class="sup-msg ${m.from === 'admin' ? 'them' : 'me'}">
  ${m.from === 'admin' ? `<div class="sup-who">${icon('shieldCheck', 'xs')} Équipe Scola${m.adminName ? ' · ' + esc(m.adminName) : ''}</div>` : ''}
  ${m.text ? `<div class="sup-text">${formatText(m.text)}</div>` : ''}
  ${m.media ? (m.media.mime.startsWith('image/') ? `<a href="${esc(m.media.url)}" target="_blank" rel="noopener"><img class="sup-img" src="${esc(m.media.url)}" alt=""></a>` : `<a class="sup-file" href="${esc(m.media.url)}" target="_blank" rel="noopener">${icon('file', 'xs')} ${esc(m.media.name)}</a>`) : ''}
  <time>${esc(fullDate(m.at))}</time></div>`;

export function openSupport(side) {
  pushPage(side, {
    title: 'Écrire à l\'équipe Scola',
    render: (body) => {
      const draw = () => {
        body.innerHTML = `<div class="sup-intro">${icon('shieldCheck')}<div><b>Une question, un problème ?</b><br>Écrivez-nous : l'équipe Scola vous répond ici, en privé. Personne d'autre ne voit cet échange.</div></div>
          <div style="padding:4px 14px 10px"><button class="btn block" data-new>${icon('edit', 'sm')} Nouvelle demande</button></div>
          ${SUPPORT.tickets.length ? `<div class="list">${SUPPORT.tickets.map(t => `<div class="item" data-id="${esc(t.id)}"><div class="body"><div class="top"><span class="name">${esc(t.topicLabel)}</span><span class="time">${esc(listTime(t.updatedAt))}</span></div>
              <div class="bot"><span class="prev">${t.last?.from === 'admin' ? 'Équipe Scola : ' : ''}${esc(t.last?.text || '')}</span>${t.unread ? `<span class="badge">${t.unread}</span>` : statusTag(t)}</div></div></div>`).join('')}</div>`
            : `<div class="empty">${icon('chat')}Aucune demande pour le moment.</div>`}`;
        $('[data-new]', body).onclick = () => newTicket(side, draw);
        body.querySelectorAll('[data-id]').forEach(x => (x.onclick = () => openTicket(side, x.dataset.id, draw)));
      };
      draw();
      loadSupport().then(() => body.isConnected && draw());
    },
  });
}

function newTicket(side, redraw) {
  const page = pushPage(side, {
    title: 'Nouvelle demande',
    render: (body) => {
      const state = { media: null };
      body.innerHTML = `<form class="card card-pad sup-form" data-f>
        <div class="field"><label>Sujet</label><select class="input" name="topic">${Object.entries(SUPPORT.topics).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>Votre message</label><textarea class="input" name="text" rows="6" maxlength="4000" placeholder="Décrivez votre demande : ce que vous faisiez, ce qui s'est passé…" required></textarea></div>
        <div class="sup-attach"><button type="button" class="btn ghost" data-att>${icon('clip', 'sm')} Joindre une capture</button><span data-file></span></div>
        <p class="hint">Évitez d'écrire votre mot de passe : l'équipe Scola ne vous le demandera jamais.</p>
        <button class="btn block" data-go>${icon('send', 'sm')} Envoyer</button></form>`;
      const f = $('[data-f]', body);
      $('[data-att]', body).onclick = () => attach($('[data-file]', body), state);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('[data-go]', body);
        btn.disabled = true;
        try {
          const t = await post('/support', { topic: f.topic.value, text: f.text.value, media: state.media });
          toast('Message envoyé à l\'équipe Scola');
          await loadSupport();
          redraw();
          page.close();
          openTicket(side, t.id, redraw);
        } catch (er) { fail(er); btn.disabled = false; }
      };
    },
  });
}

export function openTicket(side, id, redraw = () => {}) {
  pushPage(side, {
    title: 'Équipe Scola',
    cls: 'sup-page',
    onClose: () => loadSupport().then(redraw),
    render: async (body, page) => {
      body.innerHTML = '<div class="empty">Chargement…</div>';
      let t;
      try { t = await get('/support/' + id); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      page.setTitle(t.topicLabel);
      const state = { media: null };
      body.innerHTML = `<div class="sup-thread" data-thread></div>
        ${t.status === 'resolved' ? '<p class="sup-note">Cette demande est résolue. Écrivez ci-dessous pour la rouvrir.</p>' : ''}
        <form class="sup-reply" data-f><span data-file></span>
          <div class="composer"><button type="button" class="icon-btn" data-att aria-label="Joindre">${icon('clip')}</button>
          <div class="box"><textarea name="text" rows="1" maxlength="4000" placeholder="Votre message"></textarea></div>
          <button class="send" aria-label="Envoyer">${icon('send')}</button></div></form>`;
      const thread = $('[data-thread]', body);
      const draw = () => { thread.innerHTML = t.messages.map(msgHTML).join(''); body.scrollTop = body.scrollHeight; };
      draw();
      post(`/support/${id}/read`).catch(() => {});
      const f = $('[data-f]', body);
      $('[data-att]', body).onclick = () => attach($('[data-file]', body), state);
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (!f.text.value.trim() && !state.media) return;
        try {
          t = await post(`/support/${id}/messages`, { text: f.text.value, media: state.media });
          f.text.value = ''; state.media = null; $('[data-file]', body).innerHTML = '';
          $('.sup-note', body)?.remove();
          draw();
        } catch (er) { fail(er); }
      };
      f.text.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
      // Réponse de l'équipe pendant que la conversation est ouverte.
      const off = onReply(async (d) => {
        if (!body.isConnected) return off();
        if (d.id !== id) return;
        t = await get('/support/' + id);
        draw();
        await post(`/support/${id}/read`).catch(() => {});
        loadSupport();
      });
    },
  });
}

const listeners = new Set();
function onReply(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function supportReply(d) { listeners.forEach(fn => fn(d)); }
