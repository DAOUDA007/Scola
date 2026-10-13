// Administration › Support : messages envoyés par les élèves (Profil › Aide) et par les
// établissements (Contacter Scola). Répondre, marquer comme résolue, ouvrir la fiche du demandeur.
import { $, esc, icon, avatar, listTime, fullDate, formatText, pickFiles } from '/js/outils-communs.js';
import { toast, fail } from '/js/fenetres-et-menus.js';

let X; // { get, post, setTitle, refreshBadge, uploadFile }
export function setup(ctx) { X = ctx; }

const TAG = { open: ['À traiter', 'red'], pending: ['Répondu, en attente', 'warn'], resolved: ['Résolue', 'ok'] };
let filter = 'open';

export async function support(c) {
  X.setTitle('Support');
  c.innerHTML = `<p class="muted" style="margin-top:0">Messages envoyés à l'équipe Scola par les élèves (Paramètres › Aide) et par les établissements (Contacter Scola). Chaque réponse est reçue en notification par l'élève, ou par e-mail par l'établissement.</p>
    <div class="toolbar"><div class="seg" data-seg>${[['open', 'À traiter'], ['pending', 'En attente'], ['resolved', 'Résolues'], ['', 'Toutes']].map(([k, l]) => `<button data-s="${k}" class="${k === filter ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <section class="panel" data-l><div class="empty">Chargement…</div></section>`;
  const load = async () => {
    let r;
    try { r = await X.get('/support' + (filter ? '?status=' + filter : '')); } catch (e) { return fail(e); }
    $('[data-l]', c).innerHTML = r.tickets.length ? r.tickets.map(t => `<a class="report sup-item" href="#/support/${esc(t.id)}">
        <div class="row" style="flex-wrap:wrap;gap:8px"><span class="tag ${TAG[t.status][1]}">${TAG[t.status][0]}</span><span class="tag">${esc(t.topicLabel)}</span>
          <b class="grow">${esc(t.requester.name)}</b>${t.unread ? `<span class="badge" style="background:var(--danger)">${t.unread}</span>` : ''}<span class="faint" style="font-size:12.5px">${esc(listTime(t.updatedAt))}</span></div>
        <div class="faint" style="font-size:13px;margin-top:2px">${t.requester.kind === 'school' ? 'Établissement' : 'Élève · ' + esc(t.requester.className)}${t.requester.phone ? ' · ' + esc(t.requester.phone) : ''}</div>
        <div style="font-size:14px;margin-top:4px">${t.last?.from === 'admin' ? '<i>Vous :</i> ' : ''}${esc((t.last?.text || '').slice(0, 200))}</div></a>`).join('')
      : `<div class="empty">${filter === 'open' ? 'Aucune demande à traiter.' : 'Aucune demande.'}</div>`;
  };
  $('[data-seg]', c).onclick = (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    filter = b.dataset.s;
    c.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x === b));
    load();
  };
  load();
}

const msgHTML = (m) => `<div class="sup-msg ${m.from === 'admin' ? 'me' : 'them'}">
  <div class="sup-who">${m.from === 'admin' ? `${icon('shieldCheck', 'xs')} ${esc(m.adminName || 'Équipe Scola')}` : m.from === 'school' ? 'Établissement' : 'Élève'}</div>
  ${m.text ? `<div class="sup-text">${formatText(m.text)}</div>` : ''}
  ${m.media ? (m.media.mime.startsWith('image/') ? `<a href="${esc(m.media.url)}" target="_blank" rel="noopener"><img class="sup-img" src="${esc(m.media.url)}" alt=""></a>` : `<a class="sup-file" href="${esc(m.media.url)}" target="_blank" rel="noopener">${icon('file', 'xs')} ${esc(m.media.name)}</a>`) : ''}
  <time>${esc(fullDate(m.at))}</time></div>`;

export async function supportDetail(c, id) {
  let t;
  try { t = await X.get('/support/' + id); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  X.refreshBadge();
  X.setTitle('Support · ' + t.requester.name);
  const state = { media: null };
  const draw = () => {
    const r = t.requester;
    c.innerHTML = `<a href="#/support" class="btn text" style="padding:0;height:auto;margin-bottom:10px">← Toutes les demandes</a>
      <section class="panel"><div class="pad row" style="gap:12px;flex-wrap:wrap">${avatar({ id: r.id, name: r.name, avatar: r.avatar || r.logo }, 46)}
        <div class="grow"><b style="font-size:16px">${esc(r.name)}</b><div class="faint" style="font-size:13px">${r.kind === 'school' ? 'Établissement' + (r.email ? ' · ' + esc(r.email) : '') : 'Élève · ' + esc(r.className)}${r.phone ? ' · ' + esc(r.phone) : ''}</div>
          <div style="margin-top:6px"><span class="tag ${TAG[t.status][1]}">${TAG[t.status][0]}</span> <span class="tag">${esc(t.topicLabel)}</span></div></div>
        <a class="btn ghost" href="#/${r.kind === 'school' ? 'schools' : 'users'}/${esc(r.id)}">${icon('user', 'sm')} Voir la fiche</a>
        ${t.status === 'resolved' ? '<button class="btn ghost" data-st="open">Rouvrir</button>' : '<button class="btn ghost" data-st="resolved">' + icon('check', 'sm') + ' Marquer résolue</button>'}
        ${X.isOwner() ? `<button class="btn text danger" data-del>${icon('trash', 'sm')} Supprimer</button>` : ''}</div></section>
      <section class="panel"><div class="sup-thread">${t.messages.map(msgHTML).join('')}</div>
        <form class="pad" data-f style="border-top:1px solid var(--line)">
          <textarea class="input" name="text" rows="4" maxlength="4000" placeholder="Votre réponse (reçue ${r.kind === 'school' ? 'par e-mail et dans son espace' : 'en notification'})" style="width:100%"></textarea>
          <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><button type="button" class="btn ghost" data-att>${icon('clip', 'sm')} Joindre</button><span data-file class="grow"></span>
            <button class="btn ghost" data-go="resolve">Répondre et clore</button><button class="btn" data-go="reply">${icon('send', 'sm')} Répondre</button></div></form></section>`;
    const th = $('.sup-thread', c);
    th.scrollTop = th.scrollHeight;
    const f = $('[data-f]', c);
    $('[data-att]', c).onclick = async () => {
      const files = await pickFiles({ accept: 'image/*,application/pdf' });
      if (!files) return;
      try { state.media = await X.uploadFile(files[0]); $('[data-file]', c).innerHTML = `<span class="sup-file">${icon('file', 'xs')} ${esc(files[0].name)}</span>`; } catch (e) { fail(e); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (!f.text.value.trim() && !state.media) return toast('Écrivez une réponse.', { error: true });
      try {
        t = await X.post(`/support/${id}/messages`, { text: f.text.value, media: state.media, resolve: e.submitter?.dataset.go === 'resolve' });
        state.media = null;
        toast(t.status === 'resolved' ? 'Réponse envoyée, demande close' : 'Réponse envoyée');
        X.refreshBadge();
        draw();
      } catch (er) { fail(er); }
    };
    const d = $('[data-del]', c);
    if (d) d.onclick = async () => {
      const password = await X.askPassword('Supprimer cette demande ?', 'L’échange disparaît pour vous et pour le demandeur. Action irréversible.');
      if (password === null) return;
      try { await X.del('/support/' + id, { password }); toast('Demande supprimée'); X.refreshBadge(); location.hash = '#/support'; } catch (e) { fail(e); }
    };
    c.querySelectorAll('[data-st]').forEach(b => (b.onclick = async () => {
      try { t = await X.post(`/support/${id}/status`, { status: b.dataset.st }); X.refreshBadge(); draw(); } catch (e) { fail(e); }
    }));
  };
  draw();
}
