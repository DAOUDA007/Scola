// Espace établissement : « Contacter l'équipe Scola » (questions, paiement, problème technique…).
// Mêmes demandes que les élèves, traitées dans Administration › Support ; la réponse arrive ici
// (avec un compteur dans le menu) et par e-mail.
import { $, esc, icon, formatText, fullDate, listTime, pickFiles } from '/js/util.js';
import { toast, fail } from '/js/ui.js';

let X; // { get, post, uploadFile }
export function setup(ctx) { X = ctx; }

export async function unread() {
  try { return (await X.get('/support')).tickets.reduce((n, t) => n + t.unread, 0); } catch { return 0; }
}

const STATUS = { open: ['Envoyée', 'wait'], pending: ['Réponse reçue', 'ok'], resolved: ['Résolue', 'done'] };

async function attach(holder, state) {
  const files = await pickFiles({ accept: 'image/*,application/pdf' });
  if (!files) return;
  const f = files[0];
  if (f.size > 10 * 1024 * 1024) return toast('Fichier trop lourd (10 Mo maximum).', { error: true });
  holder.innerHTML = `<span class="sup-file">${icon('clip', 'xs')} Envoi…</span>`;
  try {
    state.media = await X.uploadFile(f);
    holder.innerHTML = `<span class="sup-file">${icon('file', 'xs')} ${esc(f.name)} <button type="button" class="icon-btn" data-rm aria-label="Retirer">${icon('x', 'xs')}</button></span>`;
    $('[data-rm]', holder).onclick = () => { state.media = null; holder.innerHTML = ''; };
  } catch (e) { holder.innerHTML = ''; fail(e); }
}

const msgHTML = (m) => `<div class="sup-msg ${m.from === 'admin' ? 'them' : 'me'}">
  ${m.from === 'admin' ? `<div class="sup-who">${icon('shieldCheck', 'xs')} Équipe Scola${m.adminName ? ' · ' + esc(m.adminName) : ''}</div>` : ''}
  ${m.text ? `<div class="sup-text">${formatText(m.text)}</div>` : ''}
  ${m.media ? (m.media.mime.startsWith('image/') ? `<a href="${esc(m.media.url)}" target="_blank" rel="noopener"><img class="sup-img" src="${esc(m.media.url)}" alt=""></a>` : `<a class="sup-file" href="${esc(m.media.url)}" target="_blank" rel="noopener">${icon('file', 'xs')} ${esc(m.media.name)}</a>`) : ''}
  <time>${esc(fullDate(m.at))}</time></div>`;

export async function aidePage(c, id) {
  if (id === 'nouvelle') return newForm(c);
  if (id) return thread(c, id);
  let r;
  try { r = await X.get('/support'); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  c.innerHTML = `<div class="panel"><h2>Contacter l'équipe Scola</h2><div class="pad">
      <p style="margin-top:0">Une question sur votre chaîne, votre formule, un paiement ou un problème technique ? Écrivez-nous : l'équipe Scola vous répond ici et par e-mail.</p>
      <a class="btn" href="#/aide/nouvelle">${icon('edit', 'sm')} Nouvelle demande</a></div></div>
    <div class="panel"><h2>Mes demandes</h2>${r.tickets.length ? `<div class="sup-list">${r.tickets.map(t => `<a class="sup-row" href="#/aide/${esc(t.id)}">
        <div class="grow"><b>${esc(t.topicLabel)}</b><div class="faint">${t.last?.from === 'admin' ? 'Équipe Scola : ' : ''}${esc((t.last?.text || '').slice(0, 140))}</div></div>
        <div class="sup-side"><small class="faint">${esc(listTime(t.updatedAt))}</small>${t.unread ? `<span class="badge">${t.unread}</span>` : `<span class="sup-status ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span>`}</div></a>`).join('')}</div>`
      : `<div class="empty">Aucune demande pour le moment.</div>`}</div>`;
}

async function newForm(c) {
  let topics = {};
  try { topics = (await X.get('/support')).topics; } catch (e) { return fail(e); }
  const state = { media: null };
  c.innerHTML = `<div class="panel"><h2>Nouvelle demande</h2><form class="pad" data-f style="max-width:620px">
      <div class="field"><label>Sujet</label><select class="input" name="topic">${Object.entries(topics).filter(([k]) => !['class'].includes(k)).map(([k, l]) => `<option value="${k}" ${k === 'payment' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Votre message</label><textarea class="input" name="text" rows="7" maxlength="4000" required placeholder="Décrivez votre demande…"></textarea></div>
      <div class="sup-attach"><button type="button" class="btn ghost" data-att>${icon('clip', 'sm')} Joindre une capture ou un PDF</button><span data-file></span></div>
      <div style="display:flex;gap:8px"><a class="btn ghost" href="#/aide">Annuler</a><button class="btn" data-go>${icon('send', 'sm')} Envoyer</button></div></form></div>`;
  const f = $('[data-f]', c);
  $('[data-att]', c).onclick = () => attach($('[data-file]', c), state);
  f.onsubmit = async (e) => {
    e.preventDefault();
    $('[data-go]', c).disabled = true;
    try {
      const t = await X.post('/support', { topic: f.topic.value, text: f.text.value, media: state.media });
      toast('Message envoyé à l’équipe Scola');
      location.hash = '#/aide/' + t.id;
    } catch (er) { fail(er); $('[data-go]', c).disabled = false; }
  };
}

async function thread(c, id) {
  let t;
  try { t = await X.get('/support/' + id); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  X.post(`/support/${id}/read`).then(() => X.refresh?.()).catch(() => {});
  const state = { media: null };
  c.innerHTML = `<div class="panel"><h2><a href="#/aide" style="color:inherit;text-decoration:none">←</a> ${esc(t.topicLabel)} <span class="sup-status ${STATUS[t.status][1]}" style="vertical-align:3px">${STATUS[t.status][0]}</span></h2>
      <div class="sup-thread" data-thread></div>
      <form class="pad" data-f style="border-top:1px solid var(--line)">
        ${t.status === 'resolved' ? '<p class="hint" style="margin-top:0">Cette demande est résolue. Écrivez pour la rouvrir.</p>' : ''}
        <div class="field"><textarea class="input" name="text" rows="3" maxlength="4000" placeholder="Votre message"></textarea></div>
        <div class="sup-attach"><button type="button" class="btn ghost" data-att>${icon('clip', 'sm')} Joindre</button><span data-file></span><span class="grow"></span><button class="btn" data-go>${icon('send', 'sm')} Envoyer</button></div></form></div>`;
  const draw = () => { $('[data-thread]', c).innerHTML = t.messages.map(msgHTML).join(''); };
  draw();
  const f = $('[data-f]', c);
  $('[data-att]', c).onclick = () => attach($('[data-file]', c), state);
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.text.value.trim() && !state.media) return;
    try {
      t = await X.post(`/support/${id}/messages`, { text: f.text.value, media: state.media });
      f.text.value = ''; state.media = null; $('[data-file]', c).innerHTML = '';
      draw();
    } catch (er) { fail(er); }
  };
}
