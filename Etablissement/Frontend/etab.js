// Espace Établissement (/etablissement) : demande de compte, activation par code,
// puis gestion de la chaîne d'orientation (publications, messages des élèves, profil).
import { $, $$, h, esc, icon, avatar, listTime, fullDate, formatText, fileSize, extOf, docKind, hhmm, pickFiles, debounce } from '/js/util.js';
import { toast, fail, modal, confirmBox, promptBox } from '/js/ui.js';
import { cropImage, compressImage } from '/js/media.js';

const root = $('#root');
const TK = 'scola.etab.token';
const tok = {
  get() { try { return localStorage.getItem(TK); } catch { return null; } },
  set(t) { try { localStorage.setItem(TK, t); } catch {} },
  clear() { try { localStorage.removeItem(TK); } catch {} },
};
let ME = null, TYPES = {}, COUNTRIES = [], timers = [];

async function A(method, url, body) {
  const headers = {};
  if (tok.get()) headers.Authorization = 'Bearer ' + tok.get();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try { r = await fetch('/api/school' + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Connexion au serveur impossible.'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && ME) { tok.clear(); ME = null; location.hash = '#connexion'; publicPage(); }
  if (!r.ok) throw new Error(d.error || 'Erreur.');
  return d;
}
const get = (u) => A('GET', u), post = (u, b = {}) => A('POST', u, b), patch = (u, b = {}) => A('PATCH', u, b), del = (u) => A('DELETE', u);

function uploadFile(file, url = '/upload', onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file, file.name || 'fichier');
    const x = new XMLHttpRequest();
    x.open('POST', '/api/school' + url);
    if (tok.get()) x.setRequestHeader('Authorization', 'Bearer ' + tok.get());
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(d) : reject(new Error(d.error || 'Échec de l\'envoi.')); };
    x.onerror = () => reject(new Error('Échec de l\'envoi.'));
    x.send(fd);
  });
}

const STATUS = { pending: 'Demande en cours d\'examen', code_sent: 'Code d\'activation envoyé', active: 'Compte actif', rejected: 'Demande refusée', suspended: 'Compte suspendu', unknown: 'Aucune demande trouvée' };

/* ======================= Pages publiques ======================= */
function shell(inner, wide = false) {
  timers.forEach(clearInterval); timers = [];
  root.innerHTML = `<div class="et-public"><div class="et-top"><div class="logo"></div><div>Scola Établissements<small>Chaînes d'orientation</small></div><a href="/">Application des élèves →</a></div>
    <div class="et-card ${wide ? 'wide' : ''}">${inner}</div></div>`;
  window.scrollTo(0, 0);
  return $('.et-card', root);
}

function publicPage() {
  const page = location.hash.replace('#', '');
  if (page === 'demande') return requestPage();
  if (page === 'activer') return activatePage();
  if (page === 'suivi') return statusPage();
  if (page === 'connexion') return loginPage();
  const card = shell(`<div class="et-hero"><div>
      <h1>Votre établissement sur Scola</h1>
      <p class="lead">Créez la chaîne d'orientation de votre école ou université et touchez directement les élèves et étudiants.</p>
      <ul><li>Publiez vos actualités, concours, inscriptions et journées portes ouvertes</li><li>Partagez brochures, fiches et formulaires (PDF, images, vidéos)</li><li>Répondez aux questions des élèves qui vous contactent</li><li>Suivez vos abonnés et l'audience de vos publications</li></ul>
      <div class="et-steps"><b>Comment ça marche ?</b><ol><li>Vous remplissez la demande de création de compte.</li><li>L'administration de Scola vérifie votre établissement.</li><li>Vous recevez <b>sous 72 h</b> un code d'activation par e-mail.</li><li>Ce code, et seulement ce code, vous permet d'achever la création du compte.</li></ol></div></div>
    <div class="et-actions">
      <button class="btn" data-go="demande">${icon('plus', 'sm')} Créer un compte établissement</button>
      <button class="btn ghost" data-go="activer">${icon('key', 'sm')} J'ai reçu mon code d'activation</button>
      <button class="btn ghost" data-go="connexion">${icon('user', 'sm')} Se connecter</button>
      <button class="btn text" data-go="suivi">Suivre ma demande</button></div></div>`, true);
  card.onclick = (e) => { const g = e.target.closest('[data-go]'); if (g) location.hash = '#' + g.dataset.go; };
}

function requestPage() {
  let logoUrl = null;
  const card = shell(`<button class="btn text" data-back style="padding:0;height:auto;margin-bottom:10px">← Retour</button>
    <h1>Demande de création de compte</h1>
    <p class="lead">Ces informations seront vérifiées par l'administration de Scola. Elles apparaîtront sur la fiche de votre chaîne (sauf le nom du responsable).</p>
    <form data-f>
      <div class="et-logo-pick"><div class="ph" data-ph>${icon('cap', 'lg')}</div><div><button type="button" class="btn ghost" data-logo>Ajouter le logo</button><div class="hint" style="margin-top:6px">Carré, recadré automatiquement. Facultatif.</div></div></div>
      <div class="et-grid">
        <div class="field full"><label>Nom de l'établissement *</label><input class="input" name="name" maxlength="120" required placeholder="Ex. Université Félix Houphouët-Boigny"></div>
        <div class="field"><label>Type d'établissement *</label><select class="select" name="type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>Pays *</label><select class="select" name="country">${COUNTRIES.map(c => `<option ${c === "Côte d'Ivoire" ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>Ville *</label><input class="input" name="city" maxlength="80" required></div>
        <div class="field"><label>Adresse</label><input class="input" name="address" maxlength="200" placeholder="Quartier, rue…"></div>
        <div class="field"><label>E-mail officiel *</label><input class="input" type="email" name="email" required placeholder="contact@etablissement.ci"><div class="hint">Le code d'activation sera envoyé à cette adresse.</div></div>
        <div class="field"><label>Téléphone *</label><input class="input" name="phone" maxlength="40" required placeholder="+225 …"></div>
        <div class="field full"><label>Site web</label><input class="input" name="website" maxlength="200" placeholder="www.etablissement.ci"></div>
        <div class="field"><label>Responsable de la demande *</label><input class="input" name="managerName" maxlength="80" required placeholder="Nom et prénoms"></div>
        <div class="field"><label>Fonction</label><input class="input" name="managerRole" maxlength="80" placeholder="Ex. Directeur des études"></div>
        <div class="field full"><label>Présentation de l'établissement *</label><textarea class="input boxed" name="description" rows="4" maxlength="4000" required placeholder="Historique, valeurs, points forts, accréditations…"></textarea></div>
        <div class="field full"><label>Filières et formations proposées</label><textarea class="input boxed" name="programs" rows="3" maxlength="2000" placeholder="Ex. BTS IDA, Licence Informatique, Master Finance…"></textarea></div>
      </div>
      <label class="choice" style="font-size:14px"><input type="checkbox" name="certify" required> Je certifie représenter cet établissement et que ces informations sont exactes.</label>
      <div class="error-text" data-err></div>
      <button class="btn block" data-send>Envoyer la demande</button></form>`);
  $('[data-back]', card).onclick = () => (location.hash = '');
  $('[data-logo]', card).onclick = async () => {
    const files = await pickFiles({ accept: 'image/*' });
    if (!files) return;
    const cropped = await cropImage(files[0], { title: 'Recadrer le logo', shape: 'square', size: 512 });
    if (!cropped) return;
    try { const r = await uploadFile(cropped, '/request/logo'); logoUrl = r.url; $('[data-ph]', card).innerHTML = `<img src="${esc(r.url)}" alt="">`; } catch (e) { fail(e); }
  };
  $('[data-f]', card).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      name: f.elements.name.value, type: f.type.value, country: f.country.value, city: f.city.value, address: f.address.value,
      email: f.email.value, phone: f.phone.value, website: f.website.value, description: f.description.value, programs: f.programs.value,
      manager: { name: f.managerName.value, role: f.managerRole.value }, logo: logoUrl,
    };
    $('[data-send]', card).disabled = true;
    try {
      await post('/request', body);
      const done = shell(`<div class="et-done"><div class="ok">${icon('check')}</div>
        <h1>Demande envoyée</h1>
        <p class="lead">L'administration de Scola vérifie votre établissement. Vous recevrez <b>sous 72 heures</b> un code d'activation à l'adresse <b>${esc(body.email)}</b>.</p>
        <p class="muted" style="font-size:14px">Ce code, et seulement ce code, vous permettra d'achever la création de votre compte. Pensez à vérifier vos courriers indésirables.</p>
        <div class="et-actions" style="max-width:360px;margin:18px auto 0"><button class="btn" data-go="activer">J'ai reçu mon code</button><button class="btn text" data-go="">Retour à l'accueil</button></div></div>`);
      done.onclick = (ev) => { const g = ev.target.closest('[data-go]'); if (g) location.hash = '#' + g.dataset.go; };
    } catch (er) { $('[data-err]', card).textContent = er.message; $('[data-send]', card).disabled = false; }
  };
}

function activatePage() {
  const card = shell(`<button class="btn text" data-back style="padding:0;height:auto;margin-bottom:10px">← Retour</button>
    <h1>Activer mon compte</h1>
    <p class="lead">Saisissez le code d'activation reçu par e-mail (envoyé sous 72 h après votre demande), puis choisissez votre mot de passe.</p>
    <form data-f style="max-width:440px">
      <div class="field"><label>E-mail de l'établissement</label><input class="input" type="email" name="email" required autocomplete="username"></div>
      <div class="field"><label>Code d'activation</label><input class="input code-input" name="code" required maxlength="9" placeholder="XXXX-XXXX" autocomplete="one-time-code"></div>
      <div class="field"><label>Mot de passe (8 caractères minimum)</label><input class="input" type="password" name="password" required minlength="8" autocomplete="new-password"></div>
      <div class="field"><label>Confirmer le mot de passe</label><input class="input" type="password" name="confirm" required minlength="8" autocomplete="new-password"></div>
      <div class="error-text" data-err></div>
      <button class="btn block">Activer mon compte</button>
      <p class="hint" style="text-align:center;margin-top:12px">Pas encore de code ? <a href="#suivi">Suivre ma demande</a></p></form>`);
  $('[data-back]', card).onclick = () => (location.hash = '');
  $('[name=code]', card).oninput = (e) => {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    e.target.value = v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v;
  };
  $('[data-f]', card).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.confirm.value) return ($('[data-err]', card).textContent = 'Les deux mots de passe ne correspondent pas.');
    try {
      const r = await post('/activate', { email: f.email.value, code: f.code.value, password: f.password.value });
      tok.set(r.token);
      toast('Compte activé. Bienvenue sur Scola !');
      location.hash = '#/tableau';
      start();
    } catch (er) { $('[data-err]', card).textContent = er.message; }
  };
}

function statusPage() {
  const card = shell(`<button class="btn text" data-back style="padding:0;height:auto;margin-bottom:10px">← Retour</button>
    <h1>Suivre ma demande</h1><p class="lead">Indiquez l'e-mail utilisé pour la demande.</p>
    <form data-f style="max-width:440px"><div class="field"><label>E-mail de l'établissement</label><input class="input" type="email" name="email" required></div>
    <button class="btn">Vérifier</button></form><div data-r style="margin-top:18px"></div>`);
  $('[data-back]', card).onclick = () => (location.hash = '');
  $('[data-f]', card).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await post('/request/status', { email: e.target.email.value });
      const msg = { pending: 'Votre demande est en cours de vérification. Le code d\'activation vous sera envoyé par e-mail sous 72 h.', code_sent: 'Le code d\'activation vous a été envoyé par e-mail. Utilisez-le pour activer votre compte.', active: 'Votre compte est actif : connectez-vous.', rejected: 'Votre demande n\'a pas été retenue.' + (r.reason ? ' Motif : ' + r.reason : ''), suspended: 'Ce compte est suspendu. Contactez l\'administration de Scola.', unknown: 'Aucune demande avec cet e-mail.' }[r.status];
      $('[data-r]', card).innerHTML = `<span class="status-pill ${r.status}">${esc(STATUS[r.status] || r.status)}</span>
        ${r.requestedAt ? `<p class="faint" style="font-size:13px">Demande envoyée le ${esc(fullDate(r.requestedAt))}</p>` : ''}<p>${esc(msg || '')}</p>
        ${r.status === 'code_sent' ? '<a class="btn" href="#activer">Activer mon compte</a>' : r.status === 'active' ? '<a class="btn" href="#connexion">Se connecter</a>' : ''}`;
    } catch (er) { fail(er); }
  };
}

function loginPage() {
  const card = shell(`<button class="btn text" data-back style="padding:0;height:auto;margin-bottom:10px">← Retour</button>
    <h1>Connexion</h1><p class="lead">Espace réservé aux établissements validés par Scola.</p>
    <form data-f style="max-width:440px">
      <div class="field"><label>E-mail de l'établissement</label><input class="input" type="email" name="email" required autocomplete="username"></div>
      <div class="field"><label>Mot de passe</label><input class="input" type="password" name="password" required autocomplete="current-password"></div>
      <div class="error-text" data-err></div><button class="btn block">Se connecter</button>
      <p class="hint" style="text-align:center;margin-top:12px">Pas encore de compte ? <a href="#demande">Faire une demande</a> · <a href="#activer">J'ai reçu mon code</a></p></form>`);
  $('[data-back]', card).onclick = () => (location.hash = '');
  $('[data-f]', card).onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await post('/login', { email: e.target.email.value, password: e.target.password.value }); tok.set(r.token); location.hash = '#/tableau'; start(); }
    catch (er) { $('[data-err]', card).textContent = er.message; }
  };
}

/* ======================= Espace connecté ======================= */
const NAV = [['tableau', 'poll', 'Tableau de bord'], ['publications', 'megaphone', 'Publications'], ['messages', 'chat', 'Messages des élèves'], ['chaine', 'cap', 'Ma chaîne'], ['compte', 'key', 'Mon compte']];

async function start() {
  try { ME = await get('/me'); } catch { tok.clear(); return publicPage(); }
  timers.forEach(clearInterval); timers = [];
  root.innerHTML = `<div class="et-app">
    <nav class="et-nav"><div class="et-brand" data-brand></div>
      <button class="et-menu-btn" data-menu>${icon('more', 'sm')}<span data-current>Menu</span>${icon('chevD', 'sm')}</button>
      <div class="et-links">${NAV.map(([k, ic, l]) => `<a href="#/${k}" data-k="${k}">${icon(ic, 'sm')}<span>${l}</span></a>`).join('')}
        <div class="spacer"></div>
        <a href="/" target="_blank">${icon('ext', 'sm')}<span>Voir Scola</span></a>
        <a href="#" data-logout>${icon('logout', 'sm')}<span>Déconnexion</span></a></div></nav>
    <main class="et-main"><header class="et-head"><h1 data-title></h1></header><div class="et-content" data-content></div></main></div>`;
  drawBrand();
  const nav = $('.et-nav');
  $('[data-menu]').onclick = (e) => { e.stopPropagation(); nav.classList.toggle('open'); };
  $('.et-links').addEventListener('click', (e) => { if (e.target.closest('a')) nav.classList.remove('open'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.et-nav')) $('.et-nav')?.classList.remove('open'); });
  $('[data-logout]').onclick = (e) => { e.preventDefault(); tok.clear(); ME = null; location.hash = ''; publicPage(); };
  refreshBadge();
  timers.push(setInterval(refreshBadge, 30000));
  route();
}

function drawBrand() {
  const b = $('[data-brand]');
  if (b) b.innerHTML = `${avatar({ id: ME.id, name: ME.name, avatar: ME.logo }, 40)}<div style="min-width:0"><b>${esc(ME.name)}${ME.verified ? ` ${icon('check', 'xs')}` : ''}</b><small>${esc(ME.followers)} abonné${ME.followers > 1 ? 's' : ''}</small></div>`;
}

async function refreshBadge() {
  try {
    const s = await get('/stats');
    const a = $('.et-links a[data-k=messages]');
    a?.querySelector('.badge')?.remove();
    if (s.unread) a?.insertAdjacentHTML('beforeend', `<span class="badge">${s.unread}</span>`);
  } catch {}
}

function route() {
  if (!ME) return publicPage();
  const [page, id] = (location.hash.replace(/^#\/?/, '') || 'tableau').split('/');
  if (!NAV.some(n => n[0] === page)) { location.hash = '#/tableau'; return; }
  $$('.et-links a[data-k]').forEach(a => a.classList.toggle('on', a.dataset.k === page));
  const cur = NAV.find(n => n[0] === page);
  $('[data-current]').textContent = cur[2];
  $('[data-title]').textContent = cur[2];
  document.title = `${cur[2]} · Scola Établissements`;
  const old = $('[data-content]');
  const c = old.cloneNode(false);
  old.replaceWith(c);
  timers.slice(1).forEach(clearInterval); timers = timers.slice(0, 1);
  ({ tableau: dashboard, publications, messages, chaine: channel, compte: account })[page](c, id);
}
addEventListener('hashchange', () => (ME ? route() : publicPage()));

async function dashboard(c) {
  const s = await get('/stats').catch(fail);
  if (!s) return;
  const max = Math.max(1, ...s.byCycle.map(x => x[1]));
  c.innerHTML = `<div class="cards">
      <div class="stat"><small>${icon('users', 'xs')} Abonnés</small><b>${s.followers.toLocaleString('fr-FR')}</b></div>
      <div class="stat"><small>${icon('megaphone', 'xs')} Publications</small><b>${s.posts}</b></div>
      <div class="stat"><small>${icon('eye', 'xs')} Vues</small><b>${s.views.toLocaleString('fr-FR')}</b></div>
      <div class="stat"><small>${icon('smile', 'xs')} Réactions</small><b>${s.reactions}</b></div>
      <div class="stat"><small>${icon('chat', 'xs')} Messages non lus</small><b>${s.unread}</b></div></div>
    <div class="panel"><h2>Vos abonnés par niveau d'études</h2><div class="pad bars">${s.byCycle.length ? s.byCycle.map(([k, n]) => `<div class="row2"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(n / max) * 100}%"></div></div><b>${n}</b></div>`).join('') : '<p class="faint">Pas encore d\'abonnés. Publiez régulièrement pour vous faire connaître !</p>'}</div></div>
    <div class="panel"><h2>Conseils</h2><div class="pad" style="font-size:14px;line-height:1.7;color:var(--text-2)">• Publiez vos dates clés : concours, inscriptions, portes ouvertes.<br>• Joignez vos brochures en PDF et des photos de vos campus.<br>• Répondez vite aux élèves qui vous écrivent : c'est décisif pour leur orientation.</div></div>`;
}

/* Publications */
async function publications(c) {
  let attachment = null;
  c.innerHTML = `<div class="panel composer-card"><h2>Nouvelle publication</h2><div class="pad">
      <textarea data-text maxlength="6000" placeholder="Annonce, concours, inscriptions, résultats… (mise en forme : *gras*, _italique_, liens)"></textarea>
      <div class="att"><button class="btn ghost" data-attach>${icon('clip', 'sm')} Photo, vidéo ou document</button><span data-att></span><span style="flex:1"></span><button class="btn" data-publish>${icon('send', 'sm')} Publier</button></div>
      <p class="hint" style="margin:8px 0 0">Vos abonnés reçoivent une notification (sauf s'ils ont activé le mode silencieux).</p></div></div>
    <div class="panel"><h2><span class="grow">Vos publications</span></h2><div data-list><div class="pad faint">Chargement…</div></div></div>`;
  const drawAtt = () => {
    $('[data-att]', c).innerHTML = attachment ? `<span class="att-prev">${attachment.mime.startsWith('image/') ? `<img src="${esc(attachment.url)}" alt="">` : icon(attachment.mime.startsWith('video/') ? 'video' : 'file')}<span>${esc(attachment.name)}<br><small class="faint">${fileSize(attachment.size)}</small></span><button class="icon-btn" data-rm>${icon('x', 'sm')}</button></span>` : '';
    $('[data-rm]', c)?.addEventListener('click', () => { attachment = null; drawAtt(); });
  };
  $('[data-attach]', c).onclick = async () => {
    const files = await pickFiles({ accept: 'image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx' });
    if (!files) return;
    let f = files[0];
    if (f.type.startsWith('image/')) f = await compressImage(f, 2000);
    $('[data-att]', c).innerHTML = '<span class="faint">Envoi… 0 %</span>';
    try { attachment = await uploadFile(f, '/upload', (p) => { const el = $('[data-att] .faint', c); if (el) el.textContent = `Envoi… ${Math.round(p * 100)} %`; }); }
    catch (e) { fail(e); attachment = null; }
    drawAtt();
  };
  $('[data-publish]', c).onclick = async () => {
    const text = $('[data-text]', c).value.trim();
    if (!text && !attachment) return toast('Écrivez un texte ou joignez un fichier.');
    try { await post('/posts', { text, media: attachment }); toast('Publication envoyée à vos abonnés'); $('[data-text]', c).value = ''; attachment = null; drawAtt(); load(); }
    catch (e) { fail(e); }
  };
  const load = async () => {
    const list = await get('/posts').catch(fail);
    if (!list) return;
    $('[data-list]', c).innerHTML = list.length ? list.map(p => {
      const md = p.media;
      const thumb = !md ? icon('megaphone') : p.type === 'image' ? '' : p.type === 'video' ? `<video src="${esc(md.url)}#t=0.5" preload="metadata" muted></video>` : `<span style="font-weight:700;font-size:13px">${esc(extOf(md.name).toUpperCase())}</span>`;
      const reacts = Object.entries(p.reactions).map(([e, n]) => `${e} ${n}`).join('  ');
      return `<div class="my-post" data-id="${p.id}"><div class="thumb" style="${p.type === 'image' ? `background-image:url('${esc(md.url)}')` : ''}">${thumb}</div>
        <div class="body"><div class="txt">${p.text ? formatText(p.text) : `<i class="faint">${esc(md?.name || '')}</i>`}</div>
        <div class="meta2"><span>${esc(fullDate(p.createdAt))}${p.editedAt ? ' · modifié' : ''}</span><span>${icon('eye', 'xs')} ${p.views} vue${p.views > 1 ? 's' : ''}</span>${reacts ? `<span>${esc(reacts)}</span>` : ''}
          <span style="flex:1"></span><button class="btn text" data-edit style="height:28px">Modifier</button><button class="btn text danger" data-del style="height:28px">Supprimer</button></div></div></div>`;
    }).join('') : `<div class="empty">${icon('megaphone')}Aucune publication. Votre première annonce apparaîtra ici.</div>`;
  };
  c.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-edit]')) {
      const cur = (await get('/posts')).find(p => p.id === id);
      const v = await promptBox('Modifier la publication', { value: cur?.text || '', max: 6000, multiline: true });
      if (v !== null) { try { await patch('/posts/' + id, { text: v }); toast('Publication modifiée'); load(); } catch (er) { fail(er); } }
    }
    if (e.target.closest('[data-del]') && await confirmBox('Supprimer cette publication ?', 'Elle disparaîtra de la chaîne pour tous les abonnés.', { ok: 'Supprimer', danger: true })) {
      try { await del('/posts/' + id); toast('Publication supprimée'); load(); } catch (er) { fail(er); }
    }
  });
  load();
}

/* Messages des élèves */
async function messages(c, openId) {
  c.innerHTML = `<div class="panel"><div class="inbox" data-inbox><div class="inbox-list" data-list></div><div class="inbox-thread" data-thread><div class="empty" style="margin:auto">${icon('chat')}Sélectionnez une conversation.</div></div></div></div>
    <p class="hint">Les élèves vous écrivent depuis votre chaîne. Vous voyez leur nom et leur classe ; leur numéro de téléphone reste privé. Vous ne pouvez que répondre aux élèves qui vous ont contacté.</p>`;
  let current = openId || null;
  const loadList = async () => {
    const list = await get('/inquiries').catch(() => null);
    if (!list) return;
    $('[data-list]', c).innerHTML = list.length ? list.map(q => `<div class="item compact ${q.id === current ? 'on' : ''}" data-q="${q.id}">${avatar({ id: q.student.id, name: q.student.name, avatar: q.student.avatar }, 42)}
      <div class="body"><div class="top"><span class="name">${esc(q.student.name)}</span><span class="time">${listTime(q.updatedAt)}</span></div>
      <div class="bot"><span class="prev"><span>${q.last ? (q.last.from === 'school' ? 'Vous : ' : '') + esc(q.last.text) : ''}</span></span>${q.unread ? `<span class="badge">${q.unread}</span>` : ''}</div></div></div>`).join('')
      : `<div class="empty">${icon('chat')}Aucun message pour le moment.</div>`;
  };
  const loadThread = async (id) => {
    current = id;
    $('[data-inbox]', c).classList.add('thread-open');
    const r = await get('/inquiries/' + id).catch(fail);
    if (!r) return;
    const s = r.inquiry.student;
    const t = $('[data-thread]', c);
    const keep = t.querySelector('textarea')?.value || '';
    t.innerHTML = `<div class="student-card"><button class="icon-btn" data-back title="Retour">${icon('back')}</button>${avatar({ id: s.id, name: s.name, avatar: s.avatar }, 40)}<div><b>${esc(s.name)}</b><div class="faint" style="font-size:13px">${esc(s.className)}${s.country ? ' · ' + esc(s.country) : ''}${s.school ? ' · ' + esc(s.school) : ''}</div></div></div>
      <div class="msgs" data-msgs>${r.messages.map(m => `<div class="bub ${m.from === 'school' ? 'me' : ''}">${m.postRef ? `<div class="quote" style="--qc:var(--brand)"><div class="q"><b>Votre publication</b><span>${esc(m.postRef.text)}</span></div></div>` : ''}${m.media ? `<a href="${esc(m.media.url)}" target="_blank" rel="noopener">📎 ${esc(m.media.name)}</a>\n` : ''}${m.text ? formatText(m.text) : ''}<small>${listTime(m.createdAt) === hhmm(m.createdAt) ? '' : esc(listTime(m.createdAt)) + ' · '}${hhmm(m.createdAt)}</small></div>`).join('')}</div>
      <div class="reply"><textarea rows="1" data-reply maxlength="4000" placeholder="Répondre à ${esc(s.name)}…"></textarea><button class="btn" data-send>${icon('send', 'sm')}</button></div>`;
    const ta = $('[data-reply]', t);
    ta.value = keep;
    const box = $('[data-msgs]', t);
    box.scrollTop = box.scrollHeight;
    $('[data-back]', t).onclick = () => { $('[data-inbox]', c).classList.remove('thread-open'); current = null; loadList(); };
    const send = async () => {
      const text = ta.value.trim();
      if (!text) return;
      try { await post(`/inquiries/${id}/messages`, { text }); ta.value = ''; loadThread(id); loadList(); } catch (e) { fail(e); }
    };
    $('[data-send]', t).onclick = send;
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    post(`/inquiries/${id}/read`).then(() => { loadList(); refreshBadge(); }).catch(() => {});
  };
  $('[data-list]', c).addEventListener('click', (e) => { const q = e.target.closest('[data-q]'); if (q) loadThread(q.dataset.q); });
  await loadList();
  if (current) loadThread(current);
  timers.push(setInterval(() => { if (!c.isConnected) return; loadList(); if (current && !document.activeElement?.matches('[data-reply]')) loadThread(current); }, 15000));
}

/* Ma chaîne (profil public) */
function channel(c) {
  const draw = () => {
    c.innerHTML = `<div class="panel"><h2>Profil public de votre chaîne</h2><form class="pad" data-f>
        <div class="et-logo-pick"><div class="ph" data-ph>${ME.logo ? `<img src="${esc(ME.logo)}" alt="">` : icon('cap', 'lg')}</div><div><button type="button" class="btn ghost" data-logo>Changer le logo</button></div></div>
        <div class="et-grid">
          <div class="field full"><label>Nom</label><input class="input" name="name" maxlength="120" value="${esc(ME.name)}"></div>
          <div class="field"><label>Type</label><input class="input" value="${esc(ME.typeLabel)}" disabled></div>
          <div class="field"><label>Ville</label><input class="input" name="city" maxlength="80" value="${esc(ME.city || '')}"></div>
          <div class="field"><label>Adresse</label><input class="input" name="address" maxlength="200" value="${esc(ME.address || '')}"></div>
          <div class="field"><label>Téléphone</label><input class="input" name="phone" maxlength="40" value="${esc(ME.phone || '')}"></div>
          <div class="field full"><label>Site web</label><input class="input" name="website" maxlength="200" value="${esc(ME.website || '')}"></div>
          <div class="field full"><label>Présentation</label><textarea class="input boxed" name="description" rows="5" maxlength="4000">${esc(ME.description || '')}</textarea></div>
          <div class="field full"><label>Filières et formations</label><textarea class="input boxed" name="programs" rows="3" maxlength="2000">${esc(ME.programs || '')}</textarea></div>
        </div>
        <button class="btn">Enregistrer</button></form></div>
      <p class="hint">${ME.verified ? `${icon('check', 'xs')} Établissement certifié par Scola.` : 'Le badge « certifié » est attribué par l\'administration de Scola.'} Votre e-mail (${esc(ME.email)}) est affiché comme contact sur votre chaîne.</p>`;
    $('[data-logo]', c).onclick = async () => {
      const files = await pickFiles({ accept: 'image/*' });
      if (!files) return;
      const cropped = await cropImage(files[0], { title: 'Recadrer le logo', shape: 'square', size: 512 });
      if (!cropped) return;
      try { const up = await uploadFile(cropped); ME = await patch('/me', { logo: up.url }); drawBrand(); draw(); toast('Logo mis à jour'); } catch (e) { fail(e); }
    };
    $('[data-f]', c).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        ME = await patch('/me', { name: f.elements.name.value, city: f.city.value, address: f.address.value, phone: f.phone.value, website: f.website.value, description: f.description.value, programs: f.programs.value });
        drawBrand(); toast('Profil enregistré');
      } catch (er) { fail(er); }
    };
  };
  draw();
}

function account(c) {
  c.innerHTML = `<div class="panel"><h2>Changer le mot de passe</h2><form class="pad" data-f style="max-width:440px">
      <div class="field"><label>Mot de passe actuel</label><input class="input" type="password" name="currentPassword" required autocomplete="current-password"></div>
      <div class="field"><label>Nouveau mot de passe</label><input class="input" type="password" name="password" required minlength="8" autocomplete="new-password"></div>
      <div class="field"><label>Confirmer</label><input class="input" type="password" name="confirm" required minlength="8" autocomplete="new-password"></div>
      <button class="btn">Changer le mot de passe</button></form></div>
    <div class="panel"><h2>Compte</h2><div class="pad" style="font-size:14px;line-height:1.8">E-mail : <b>${esc(ME.email)}</b><br>Statut : <span class="status-pill active">Compte actif</span><br>Activé le ${esc(fullDate(ME.activatedAt || ME.createdAt))}<br><span class="faint">Pour modifier l'e-mail ou supprimer le compte, contactez l'administration de Scola.</span></div></div>`;
  $('[data-f]', c).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.confirm.value) return toast('Les deux mots de passe ne correspondent pas.', { error: true });
    try { const r = await patch('/me/password', { currentPassword: f.currentPassword.value, password: f.password.value }); tok.set(r.token); toast('Mot de passe modifié'); f.reset(); } catch (er) { fail(er); }
  };
}

/* ======================= Démarrage ======================= */
(async () => {
  try {
    TYPES = await get('/types');
    COUNTRIES = (await (await fetch('/api/catalog')).json()).countries || [];
  } catch {}
  if (tok.get()) start(); else publicPage();
})();
