// Espace d'administration Scola (/admin).
import { $, $$, h, esc, icon, avatar, listTime, fullDate, relTime, fold, debounce, fileSize, copyText, pickFiles } from '/js/util.js';
import { toast, fail, modal, confirmBox, promptBox, ctxMenu } from '/js/ui.js';
import { cropImage } from '/js/media.js';
import * as MON from './monetisation.js';
import * as CMP from './campagnes.js';

const root = $('#root');
const TK = 'scola.admin.token';
// Adresse du serveur Scola (config.js) : vide = même adresse que le site.
const BK = self.SCOLA_BACKEND || '';
const tok = {
  get() { try { return localStorage.getItem(TK); } catch { return null; } },
  set(t) { try { localStorage.setItem(TK, t); } catch {} },
  clear() { try { localStorage.removeItem(TK); } catch {} },
};
let ME = null;
let CATALOG = null;
let pendingReports = 0;
let globalsBound = false;

async function A(method, url, body) {
  const headers = { Authorization: 'Bearer ' + (tok.get() || '') };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try { r = await fetch(BK + '/api/admin' + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Connexion au serveur impossible.'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/login') { tok.clear(); showLogin(d.error); throw new Error(d.error || 'Session expirée.'); }
  if (!r.ok) throw new Error(d.error || 'Erreur.');
  return d;
}
const get = (u) => A('GET', u);
const post = (u, b = {}) => A('POST', u, b);
const patch = (u, b = {}) => A('PATCH', u, b);
const del = (u) => A('DELETE', u);
async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(BK + '/api/admin/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + tok.get() }, body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Échec de l\'envoi.');
  return d;
}

const DIS = { 0: 'Désactivés', 86400: '24 heures', 604800: '7 jours', 7776000: '90 jours' };
const num = (n) => Number(n || 0).toLocaleString('fr-FR');

/* ---------------- Connexion ---------------- */
function showLogin(msg) {
  root.innerHTML = `<div class="login"><form class="login-card">
    <div class="logo"></div><h1>Administration Scola</h1>
    <p class="muted" style="margin:0 0 20px;font-size:14px">Espace réservé aux administrateurs du site.</p>
    <div class="field"><label>E-mail</label><input class="input" type="email" name="email" autocomplete="username" required></div>
    <div class="field"><label>Mot de passe</label><input class="input" type="password" name="password" autocomplete="current-password" required></div>
    <div class="error-text" data-err>${esc(msg && msg !== 'Session administrateur expirée. Reconnectez-vous.' ? msg : '')}</div>
    <button class="btn block" type="submit">Se connecter</button>
    <p style="text-align:center;margin:18px 0 0"><a href="/" style="font-size:13.5px">← Retour à Scola</a></p></form></div>`;
  const f = $('form', root);
  f.email.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    f.querySelector('button').disabled = true;
    try {
      const r = await post('/login', { email: f.email.value, password: f.password.value });
      tok.set(r.token);
      ME = r.admin;
      start();
    } catch (er) { $('[data-err]', f).textContent = er.message; f.querySelector('button').disabled = false; }
  };
}

/* ---------------- Coquille ---------------- */
const NAV = [
  ['dashboard', 'poll', 'Tableau de bord'],
  ['users', 'users', 'Utilisateurs'],
  ['classes', 'cap', 'Classes'],
  ['reports', 'flag', 'Signalements'],
  ['schools', 'megaphone', 'Établissements'],
  ['billing', 'checkSq', 'Abonnements'],
  ['campaigns', 'flash', 'Campagnes'],
  ['offers', 'star', 'Offres et tarifs'],
  ['announce', 'bell', 'Annonces'],
  ['admins', 'shieldCheck', 'Administrateurs'],
  ['account', 'user', 'Mon compte'],
];

async function start() {
  try { ME = await get('/me'); } catch { return; }
  if (!CATALOG) CATALOG = await get('/catalog').catch(() => null);
  root.innerHTML = `<div class="adm">
    <nav class="adm-nav">
      <div class="adm-brand"><div class="logo"></div><div>Scola<small>Administration</small></div></div>
      <!-- Petit écran : menu en liste déroulante -->
      <button class="adm-menu-btn" data-menu aria-expanded="false" aria-controls="adm-links">${icon('more', 'sm')}<span data-current>Menu</span>${icon('chevD', 'sm')}</button>
      <div class="adm-links" id="adm-links">
        ${NAV.map(([k, ic, l]) => `<a href="#/${k}" data-k="${k}">${icon(ic, 'sm')}<span>${l}</span></a>`).join('')}
        <div class="spacer"></div>
        <a href="#" data-toggle-theme>${icon('moon', 'sm')}<span>Thème</span></a>
        <a href="/" target="_blank">${icon('ext', 'sm')}<span>Ouvrir Scola</span></a>
        <a href="#" data-logout>${icon('logout', 'sm')}<span>Déconnexion</span></a>
      </div>
    </nav>
    <main class="adm-main"><header class="adm-top"><h1 data-title></h1><span class="who">${icon('shieldCheck', 'xs')} ${esc(ME.name)}</span></header>
      <div class="adm-content" data-content></div></main></div>`;
  $('[data-logout]').onclick = (e) => { e.preventDefault(); tok.clear(); showLogin(); };
  // Liste déroulante (petits écrans) : ouvrir / fermer, se refermer après un choix ou un clic ailleurs.
  const nav = $('.adm-nav'), menuBtn = $('[data-menu]');
  const setOpen = (open) => { nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.onclick = (e) => { e.stopPropagation(); setOpen(!nav.classList.contains('open')); };
  $('.adm-links', nav).addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  // Écouteurs globaux posés une seule fois (start() est rappelée après « Mon compte »).
  if (!globalsBound) {
    globalsBound = true;
    const close = () => { const n = $('.adm-nav'); n?.classList.remove('open'); $('[data-menu]')?.setAttribute('aria-expanded', 'false'); };
    document.addEventListener('click', (e) => { if (!e.target.closest('.adm-nav')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
  // Attention : <html> porte aussi un attribut data-theme, d'où un sélecteur dédié limité au menu.
  $('[data-toggle-theme]', nav).onclick = (e) => {
    e.preventDefault();
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('scola.admin.theme', next); } catch {}
  };
  if (ME.mustChangePassword) forcePasswordChange();
  refreshBadge();
  route();
}

async function refreshBadge() {
  const put = (k, n, bg) => {
    const a = $(`.adm-nav a[data-k=${k}]`);
    a?.querySelector('.badge')?.remove();
    if (n) a?.insertAdjacentHTML('beforeend', `<span class="badge" style="background:${bg}">${n}</span>`);
  };
  try {
    const r = await get('/reports?status=pending');
    pendingReports = r.length;
    put('reports', pendingReports, 'var(--danger)');
  } catch {}
  try { const s = await get('/schools?status=pending'); put('schools', s.counts.pending || 0, 'var(--brand)'); } catch {}
  try {
    const st = await get('/stats');
    put('billing', (st.planRequests || 0) + (st.paymentProofs || 0), 'var(--brand)');
    put('campaigns', st.campaignQueue || 0, 'var(--brand)');
  } catch {}
}
setInterval(() => { if (tok.get() && ME) refreshBadge(); }, 30000);

function route() {
  const [page, id] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  $$('.adm-nav a[data-k]').forEach(a => a.classList.toggle('on', a.dataset.k === page));
  const cur = NAV.find(n => n[0] === page) || NAV[0];
  const lbl = $('[data-current]');
  if (lbl) lbl.textContent = cur[2];
  // Zone de contenu neuve à chaque page : aucun écouteur ne subsiste de la page précédente.
  const old = $('[data-content]');
  if (!old) return;
  const c = old.cloneNode(false);
  old.replaceWith(c);
  window.scrollTo(0, 0);
  c.innerHTML = '<div class="empty">Chargement…</div>';
  const pages = { dashboard, users, classes, reports, schools, announce, admins, account, billing: MON.billing, campaigns: CMP.campaigns, offers: MON.offersPage };
  const fn = pages[page] || dashboard;
  if (page === 'users' && id) return userDetail(c, id);
  if (page === 'classes' && id) return classDetail(c, id);
  if (page === 'schools' && id) return schoolDetail(c, id);
  if (page === 'billing' && id) return MON.billingDetail(c, id);
  if (page === 'campaigns' && id) return CMP.campaignDetail(c, id);
  if (page === 'receipt' && id) { $$('.adm-nav a[data-k=billing]').forEach(a => a.classList.add('on')); return MON.receipt(c, id); }
  fn(c);
}
addEventListener('hashchange', route);
const setTitle = (t) => { const e = $('[data-title]'); if (e) e.textContent = t; document.title = `${t} · Scola Admin`; };
// Contexte partagé avec les modules Abonnements / Campagnes / Offres.
const CTX = { get: (u) => get(u), post: (u, b) => post(u, b), patch: (u, b) => patch(u, b), setTitle, bindRows: (c) => bindRows(c), refreshBadge: () => refreshBadge() };
MON.setup(CTX);
CMP.setup(CTX);

/* ---------------- Tableau de bord ---------------- */
async function dashboard(c) {
  setTitle('Tableau de bord');
  let s;
  try { s = await get('/stats'); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const max = Math.max(1, ...s.signups.map(x => x.count));
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  const peak = s.signups.reduce((a, b) => (b.count > a.count ? b : a), s.signups[0]);
  const dayLbl = (t) => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  c.innerHTML = `
    ${s.storage && !s.storage.postgres && s.storage.render ? `<div class="notice danger" style="margin-bottom:18px"><b>${icon('info', 'xs')} Les données ne sont pas conservées.</b><br>
      Le serveur fonctionne sur Render sans base PostgreSQL : à chaque mise en veille (environ 15 minutes sans visite) ou redéploiement, Render efface son disque.
      Comptes, messages, établissements et paiements sont alors perdus, et <b>les élèves doivent se reconnecter</b>.
      Ajoutez la variable <code>DATABASE_URL</code> (base PostgreSQL gratuite, par exemple Neon) dans <i>Render › Environment</i>.</div>` : ''}
    <div class="cards">
      <div class="stat"><small>${icon('users', 'xs')} Utilisateurs</small><b>${num(s.users)}</b><span class="sub">${num(s.online)} en ligne</span></div>
      <div class="stat"><small>${icon('cap', 'xs')} Classes</small><b>${num(s.classes)}</b><span class="sub">groupes actifs</span></div>
      <div class="stat"><small>${icon('chat', 'xs')} Messages</small><b>${num(s.messages)}</b><span class="sub">${num(s.messagesToday)} aujourd'hui</span></div>
      <div class="stat ${s.schoolRequests ? 'alert' : ''}"><small>${icon('megaphone', 'xs')} Établissements</small><b>${num(s.schools)}</b><span class="sub">${s.schoolRequests ? `<a href="#/schools">${num(s.schoolRequests)} demande(s) à valider</a>` : `${num(s.posts)} publication(s)`}</span></div>
      <div class="stat ${s.reportsPending ? 'alert' : ''}"><small>${icon('flag', 'xs')} Signalements à traiter</small><b>${num(s.reportsPending)}</b><span class="sub"><a href="#/reports">Voir</a></span></div>
      <div class="stat"><small>${icon('ban', 'xs')} Comptes suspendus</small><b>${num(s.suspended)}</b><span class="sub">${num(s.admins)} administrateur(s)</span></div>
    </div>
    <div class="grid2">
      <section class="panel"><h2><span class="grow">Inscriptions des 14 derniers jours</span><span class="faint" style="font-size:12.5px;font-weight:400">${num(s.signups.reduce((n, x) => n + x.count, 0))} au total</span></h2>
        <div class="pad">
          <div class="chart" role="img" aria-label="Inscriptions par jour sur 14 jours">
            <div class="yaxis"><span>${top}</span><span>${top * 3 / 4}</span><span>${top / 2}</span><span>${top / 4}</span><span>0</span></div>
            <div class="plot">${s.signups.map((x, i) => `<div class="col" data-d="${x.day}" data-n="${x.count}">
              ${x === peak && x.count ? `<span class="val" style="bottom:calc(${(x.count / top) * 100}% + 4px)">${x.count}</span>` : ''}
              <div class="bar" style="height:${(x.count / top) * 100}%"></div>
              ${i % 2 === 0 || i === 13 ? `<span class="lbl">${dayLbl(x.day)}</span>` : ''}</div>`).join('')}</div>
          </div>
          <table class="sr-table"><caption>Inscriptions par jour</caption><tr><th>Jour</th><th>Inscriptions</th></tr>${s.signups.map(x => `<tr><td>${dayLbl(x.day)}</td><td>${x.count}</td></tr>`).join('')}</table>
        </div></section>
      <section class="panel"><h2>Classes les plus grandes</h2>
        <table class="tbl"><tbody>${s.topClasses.map(k => `<tr data-go="#/classes/${k.id}"><td>${esc(k.name)}<div class="faint" style="font-size:12px">${esc(k.country)}</div></td><td class="num">${num(k.members)}</td></tr>`).join('') || '<tr><td class="faint">Aucune classe</td></tr>'}</tbody></table></section>
    </div>
    <section class="panel"><h2>Dernières inscriptions</h2><div class="tbl-wrap">${userTable(s.recentUsers)}</div></section>
    <div data-finance></div>`;
  MON.financePanel($('[data-finance]', c));
  bindRows(c);
  // Infobulle au survol des barres.
  const tip = h('<div class="chart-tip" hidden></div>');
  document.body.append(tip);
  const plot = $('.plot', c);
  plot.addEventListener('mousemove', (e) => {
    const col = e.target.closest('.col');
    if (!col) { tip.hidden = true; return; }
    const d = new Date(Number(col.dataset.d)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    tip.innerHTML = `${esc(d)}<br><b>${col.dataset.n}</b> inscription${col.dataset.n > 1 ? 's' : ''}`;
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY - tip.offsetHeight - 10) + 'px';
  });
  plot.addEventListener('mouseleave', () => { tip.hidden = true; });
  addEventListener('hashchange', () => tip.remove(), { once: true });
}

function bindRows(c) {
  c.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-go]');
    if (tr && !e.target.closest('a,button')) location.hash = tr.dataset.go;
  });
}

function userBadges(u) {
  return `${u.online ? '<span class="tag">En ligne</span> ' : ''}${u.suspended ? '<span class="tag red">Suspendu</span> ' : ''}${u.restricted ? '<span class="tag warn">Restreint</span> ' : ''}${u.hasPin ? `<span title="Vérification en deux étapes">${icon('lock', 'xs')}</span>` : ''}`;
}
function userTable(list) {
  if (!list.length) return '<div class="empty">Aucun utilisateur.</div>';
  return `<table class="tbl"><thead><tr><th>Utilisateur</th><th>Téléphone</th><th>Classe</th><th>Inscrit</th><th>Vu</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr data-go="#/users/${u.id}"><td><div class="cell-user">${avatar(u, 34)}<div><b>${esc(u.name)}</b><div class="faint" style="font-size:12px">${esc(u.school || '')}</div></div></div></td>
      <td>${esc(u.phone)}</td><td>${esc(u.className)}</td><td>${esc(listTime(u.createdAt))}</td><td>${u.online ? 'maintenant' : esc(listTime(u.lastSeen))}</td><td>${userBadges(u)}</td></tr>`).join('')}</tbody></table>`;
}

/* ---------------- Utilisateurs ---------------- */
let usersState = { q: '', status: '', page: 0 };
async function users(c) {
  setTitle('Utilisateurs');
  c.innerHTML = `<div class="toolbar"><div class="search-box">${icon('search', 'sm')}<input placeholder="Nom, téléphone ou établissement" data-q value="${esc(usersState.q)}"></div>
    <select data-st><option value="">Tous</option><option value="online">En ligne</option><option value="suspended">Suspendus</option></select></div>
    <section class="panel"><div class="tbl-wrap" data-t></div><div class="pager" data-p></div></section>`;
  $('[data-st]', c).value = usersState.status;
  const load = async () => {
    const r = await get(`/users?q=${encodeURIComponent(usersState.q)}&status=${usersState.status}&page=${usersState.page}`).catch(fail);
    if (!r) return;
    $('[data-t]', c).innerHTML = userTable(r.users);
    const pages = Math.max(1, Math.ceil(r.total / 50));
    $('[data-p]', c).innerHTML = `<span>${num(r.total)} utilisateur(s)</span><span class="row"><button class="btn ghost" data-prev ${usersState.page ? '' : 'disabled'} style="height:32px">Précédent</button><span>Page ${usersState.page + 1} / ${pages}</span><button class="btn ghost" data-next ${usersState.page + 1 < pages ? '' : 'disabled'} style="height:32px">Suivant</button></span>`;
    $('[data-prev]', c).onclick = () => { usersState.page--; load(); };
    $('[data-next]', c).onclick = () => { usersState.page++; load(); };
  };
  $('[data-q]', c).oninput = debounce((e) => { usersState.q = e.target.value; usersState.page = 0; load(); }, 250);
  $('[data-st]', c).onchange = (e) => { usersState.status = e.target.value; usersState.page = 0; load(); };
  bindRows(c);
  load();
}

async function userDetail(c, id) {
  setTitle('Utilisateur');
  let u;
  try { u = await get('/users/' + id); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  setTitle(u.name);
  c.innerHTML = `<p><a href="#/users">← Tous les utilisateurs</a></p>
    <section class="panel"><div class="pad row" style="gap:18px;flex-wrap:wrap">${avatar(u, 84)}
      <div class="grow"><h2 style="margin:0;font-size:22px">${esc(u.name)}</h2><div class="muted">${esc(u.phone)} · ${esc(u.className)}</div><div style="margin-top:6px">${userBadges(u)}</div></div></div></section>
    <div class="grid2">
      <section class="panel"><h2>Informations</h2><div class="pad"><dl class="kv">
        <dt>Classe</dt><dd><a href="#/classes/${u.classId}">${esc(u.className)}</a> — ${esc(u.country)}</dd>
        <dt>Établissement</dt><dd>${esc(u.school || '—')}</dd>
        <dt>Infos</dt><dd>${esc(u.about || '—')}</dd>
        <dt>Inscription</dt><dd>${esc(fullDate(u.createdAt))}</dd>
        <dt>Dernière activité</dt><dd>${u.online ? 'En ligne maintenant' : esc(fullDate(u.lastSeen))}</dd>
        <dt>Messages envoyés</dt><dd>${num(u.messages)}</dd>
        <dt>Chaînes suivies</dt><dd>${num(u.following)}</dd>
        <dt>Signalements reçus</dt><dd>${num(u.reportsAgainst)}</dd>
        <dt>Vérification 2 étapes</dt><dd>${u.hasPin ? 'Activée' : 'Désactivée'}</dd>
        ${u.suspended ? `<dt>Suspension</dt><dd>${esc(fullDate(u.suspended.at))}${u.suspended.reason ? ' — ' + esc(u.suspended.reason) : ''}</dd>` : ''}
      </dl></div></section>
      <section class="panel"><h2>Actions</h2><div class="pad actions" style="flex-direction:column;align-items:stretch">
        <button class="btn ghost" data-a="edit">${icon('edit', 'sm')} Modifier le profil</button>
        <button class="btn ghost" data-a="move">${icon('cap', 'sm')} Changer de classe</button>
        <button class="btn ghost" data-a="restrict">${icon('ban', 'sm')} ${u.restricted ? 'Rétablir ses messages dans la classe' : 'Restreindre ses messages dans la classe'}</button>
        ${u.hasPin ? `<button class="btn ghost" data-a="pin">${icon('key', 'sm')} Réinitialiser le code PIN</button>` : ''}
        <button class="btn ghost" data-a="logout">${icon('laptop', 'sm')} Déconnecter tous ses appareils</button>
        <button class="btn ${u.suspended ? '' : 'danger'}" data-a="suspend">${icon('shield', 'sm')} ${u.suspended ? 'Réactiver le compte' : 'Suspendre le compte'}</button>
        <button class="btn ghost" data-a="warn">${icon('flag', 'sm')} Envoyer un avertissement</button>
        <button class="btn danger" data-a="delete">${icon('trash', 'sm')} Supprimer le compte</button>
      </div></section></div>
    <section class="panel"><h2>Appareils connectés (${u.sessions.length})</h2>
      ${u.sessions.length ? `<table class="tbl"><tbody>${u.sessions.map(s => `<tr><td>${esc(s.device)}</td><td>Connecté le ${esc(fullDate(s.createdAt))}</td><td>Actif ${esc(listTime(s.lastActive))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucun appareil.</div>'}</section>`;
  c.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    try {
      if (a === 'edit') return editUser(u);
      if (a === 'warn') return sendWarning({ userId: u.id, name: u.name });
      if (a === 'move') return moveUser(u);
      if (a === 'restrict') { await (u.restricted ? del(`/classes/${u.classId}/restrict/${u.id}`) : post(`/classes/${u.classId}/restrict/${u.id}`)); toast('Fait'); }
      if (a === 'pin') { if (!(await confirmBox('Réinitialiser le code PIN ?', 'La vérification en deux étapes sera désactivée pour ce compte.', { ok: 'Réinitialiser' }))) return; await post(`/users/${u.id}/reset-pin`); toast('Code PIN réinitialisé'); }
      if (a === 'logout') { if (!(await confirmBox('Déconnecter tous ses appareils ?', 'L\'utilisateur devra se reconnecter.', { ok: 'Déconnecter' }))) return; await post(`/users/${u.id}/logout`); toast('Appareils déconnectés'); }
      if (a === 'suspend') {
        if (u.suspended) { await del(`/users/${u.id}/suspend`); toast('Compte réactivé'); }
        else {
          const reason = await promptBox(`Suspendre ${u.name} ?`, { label: 'Motif (affiché à l\'utilisateur)', placeholder: 'Ex. harcèlement répété', max: 300 });
          if (reason === null) return;
          await post(`/users/${u.id}/suspend`, { reason });
          toast('Compte suspendu');
        }
      }
      if (a === 'delete') {
        if (!(await confirmBox(`Supprimer le compte de ${u.name} ?`, 'Profil, abonnements et appareils seront supprimés et la personne quittera sa classe. Ses messages restent affichés sous « Compte supprimé ». Action irréversible.', { ok: 'Supprimer', danger: true }))) return;
        await del('/users/' + u.id);
        toast('Compte supprimé');
        location.hash = '#/users';
        return;
      }
      userDetail(c, id);
    } catch (er) { fail(er); }
  };
}

function editUser(u) {
  const body = h(`<div>
    <div class="field"><label>Nom</label><input class="input" data-n maxlength="40" value="${esc(u.name)}"></div>
    <div class="field"><label>Établissement</label><input class="input" data-s maxlength="80" value="${esc(u.school || '')}"></div>
    <div class="field"><label>Infos</label><input class="input" data-a maxlength="139" value="${esc(u.about || '')}"></div>
    ${u.avatar ? '<label class="choice"><input type="checkbox" data-rm> Retirer la photo de profil</label>' : ''}</div>`);
  modal({ title: 'Modifier le profil', body, buttons: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: '', onClick: async () => {
    await patch('/users/' + u.id, { name: $('[data-n]', body).value, school: $('[data-s]', body).value, about: $('[data-a]', body).value, removeAvatar: !!$('[data-rm]', body)?.checked });
    toast('Profil mis à jour');
    route();
  } }] });
}

function catalogFields(pre = {}) {
  const body = h(`<div>
    <div class="field"><label>Pays</label><select class="select" data-k="country">${CATALOG.countries.map(x => `<option ${x === pre.country ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
    <div class="field"><label>Cycle</label><select class="select" data-k="cycle">${CATALOG.cycles.map(x => `<option value="${x.id}" ${x.id === pre.cycle ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
    <div class="field"><label>Filière</label><select class="select" data-k="filiere"></select><input class="input" data-other placeholder="Autre filière" hidden></div>
    <div class="field"><label>Niveau</label><select class="select" data-k="niveau"></select></div></div>`);
  const q = (k) => $(`[data-k=${k}]`, body);
  const fill = () => {
    const cy = CATALOG.cycles.find(x => x.id === q('cycle').value);
    q('filiere').innerHTML = cy.filieres.map(f => `<option ${f === pre.filiere ? 'selected' : ''}>${esc(f)}</option>`).join('') + '<option value="__other">Autre…</option>';
    q('niveau').innerHTML = cy.niveaux.map(n => `<option ${n === pre.niveau ? 'selected' : ''}>${esc(n)}</option>`).join('');
    $('[data-other]', body).hidden = q('filiere').value !== '__other';
  };
  q('cycle').onchange = () => { pre = {}; fill(); };
  q('filiere').onchange = () => { $('[data-other]', body).hidden = q('filiere').value !== '__other'; };
  fill();
  body.values = () => ({ country: q('country').value, cycle: q('cycle').value, niveau: q('niveau').value, filiere: q('filiere').value === '__other' ? $('[data-other]', body).value.trim() : q('filiere').value });
  return body;
}

async function moveUser(u) {
  if (!CATALOG) return toast('Catalogue indisponible.');
  const cls = await get('/classes/' + u.classId).catch(() => ({}));
  const body = catalogFields(cls);
  body.insertAdjacentHTML('afterbegin', `<p class="muted" style="font-size:14px;margin-top:0">${esc(u.name)} quittera « ${esc(u.className)} » et rejoindra la classe choisie (créée si elle n'existe pas). Ses discussions privées sont conservées.</p>`);
  modal({ title: 'Changer de classe', body, buttons: [{ label: 'Annuler' }, { label: 'Transférer', cls: '', onClick: async () => {
    const r = await patch('/users/' + u.id, body.values());
    toast(`Transféré dans « ${r.className} »`);
    route();
  } }] });
}

/* ---------------- Classes ---------------- */
let classState = { q: '', sort: 'members' };
async function classes(c) {
  setTitle('Classes');
  c.innerHTML = `<div class="toolbar"><div class="search-box">${icon('search', 'sm')}<input placeholder="Filière, niveau, pays…" data-q value="${esc(classState.q)}"></div>
    <select data-sort><option value="members">Plus de membres</option><option value="activity">Activité récente</option><option value="recent">Plus récentes</option><option value="name">Nom</option></select></div>
    <section class="panel"><div class="tbl-wrap" data-t></div></section>`;
  $('[data-sort]', c).value = classState.sort;
  const load = async () => {
    const list = await get(`/classes?q=${encodeURIComponent(classState.q)}&sort=${classState.sort}`).catch(fail);
    if (!list) return;
    $('[data-t]', c).innerHTML = list.length ? `<table class="tbl"><thead><tr><th>Classe</th><th>Pays</th><th class="num">Membres</th><th class="num">En ligne</th><th class="num">Messages</th><th>Dernière activité</th><th></th></tr></thead><tbody>
      ${list.map(k => `<tr data-go="#/classes/${k.id}"><td><div class="cell-user">${avatar(k, 34, { group: true })}<div><b>${esc(k.name)}</b><div class="faint" style="font-size:12px">${esc(k.cycleLabel)} · ${esc(k.filiere)}</div></div></div></td>
        <td>${esc(k.country)}</td><td class="num">${num(k.members)}</td><td class="num">${num(k.online)}</td><td class="num">${num(k.messages)}</td><td>${k.lastActivity ? esc(listTime(k.lastActivity)) : '—'}</td>
        <td>${k.settings.readOnly ? '<span class="tag warn">Lecture seule</span> ' : ''}${k.reportsPending ? `<span class="tag red">${k.reportsPending} signalement(s)</span>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucune classe.</div>';
  };
  $('[data-q]', c).oninput = debounce((e) => { classState.q = e.target.value; load(); }, 250);
  $('[data-sort]', c).onchange = (e) => { classState.sort = e.target.value; load(); };
  bindRows(c);
  load();
}

async function classDetail(c, id) {
  let k;
  try { k = await get('/classes/' + id); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  setTitle(k.name);
  const sw = (key, label, sub) => `<label class="setting"><div class="txt">${label}<small>${sub}</small></div><label class="switch"><input type="checkbox" data-set="${key}" ${k.settings[key] ? 'checked' : ''}><span></span></label></label>`;
  c.innerHTML = `<p><a href="#/classes">← Toutes les classes</a></p>
    <section class="panel"><div class="pad row" style="gap:18px;flex-wrap:wrap"><div data-icon style="cursor:pointer" title="Changer l'icône">${avatar(k, 84, { group: true })}</div>
      <div class="grow"><h2 style="margin:0;font-size:22px">${esc(k.name)}</h2><div class="muted">${esc(k.cycleLabel)} · ${esc(k.filiere)} · ${esc(k.niveau)} — ${esc(k.country)}</div>
      <div class="faint" style="font-size:13px;margin-top:4px">${num(k.members.length)} membres · ${num(k.online)} en ligne · ${num(k.messages)} messages · créée le ${esc(fullDate(k.createdAt))}</div></div>
      <div class="actions"><button class="btn ghost" data-a="rename">${icon('edit', 'sm')} Renommer</button><button class="btn" data-a="announce">${icon('megaphone', 'sm')} Annonce</button></div></div></section>
    <div class="grid2">
      <section class="panel"><h2><span class="grow">Description</span><button class="btn text" data-a="desc">Modifier</button></h2><div class="pad" style="white-space:pre-wrap;font-size:14px">${esc(k.description || '—')}</div></section>
      <section class="panel"><h2>Réglages du groupe</h2>
        ${sw('readOnly', 'Lecture seule', 'Les membres ne peuvent plus écrire (examens, annonces officielles).')}
        ${sw('membersEditInfo', 'Les membres modifient les infos', 'Nom, icône, description et messages éphémères du groupe.')}
        ${sw('membersPin', 'Les membres épinglent des messages', '')}
        <label class="setting"><div class="txt">Messages éphémères<small>Durée de vie des nouveaux messages</small></div>
          <select data-dis style="height:34px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text)">${Object.entries(DIS).map(([v, l]) => `<option value="${v}" ${Number(v) === k.disappearing ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="setting"><div class="txt">Lien d'invitation<small>${esc(location.origin)}/?join=${esc(k.inviteCode)}</small></div><button class="btn text" data-a="copy">Copier</button><button class="btn text danger" data-a="invite">Réinitialiser</button></div>
      </section></div>
    <div class="grid2">
      <section class="panel"><h2><span class="grow">Derniers messages (modération)</span><button class="btn text" data-a="more" hidden>Plus anciens</button></h2><div class="feed" data-feed style="max-height:560px;overflow-y:auto"></div></section>
      <section class="panel"><h2>Membres (${num(k.members.length)})</h2>
        <div class="pad" style="padding-bottom:6px"><div class="search-box">${icon('search', 'sm')}<input placeholder="Rechercher" data-mq></div></div>
        <div data-members style="max-height:520px;overflow-y:auto"></div></section></div>
    <section class="panel"><h2>Zone sensible</h2><div class="pad actions"><button class="btn danger" data-a="delete" ${k.members.length ? 'disabled title="Transférez d\'abord les membres"' : ''}>${icon('trash', 'sm')} Supprimer la classe</button>
      <span class="faint" style="font-size:13px;align-self:center">${k.members.length ? 'Une classe ne peut être supprimée que lorsqu\'elle n\'a plus de membres.' : 'Cette classe est vide.'}</span></div></section>`;

  const drawMembers = (q = '') => {
    const f = fold(q);
    $('[data-members]', c).innerHTML = k.members.filter(u => fold(u.name).includes(f)).slice(0, 300).map(u => `
      <div class="item compact" data-go="#/users/${u.id}">${avatar(u, 38)}<div class="body"><div class="top"><span class="name" style="font-size:15px">${esc(u.name)}</span>${userBadges(u)}</div><div class="bot"><span class="prev">${esc(u.phone)}</span></div></div>
      <button class="icon-btn" data-restrict="${u.id}" title="${u.restricted ? 'Rétablir ses messages' : 'Restreindre ses messages'}">${icon(u.restricted ? 'chat' : 'ban', 'sm')}</button></div>`).join('') || '<div class="empty">Aucun membre.</div>';
  };
  drawMembers();
  $('[data-mq]', c).oninput = (e) => drawMembers(e.target.value);

  let before = null;
  const feed = $('[data-feed]', c);
  const loadFeed = async (append) => {
    const r = await get(`/classes/${id}/messages${append && before ? '?before=' + before : ''}`).catch(fail);
    if (!r) return;
    if (r.messages.length) before = r.messages[0].createdAt;
    const html = [...r.messages].reverse().map(m => `<div class="m ${m.deleted ? 'deleted' : ''} ${m.announce ? 'announce' : ''}" data-mid="${m.id}">
      <div class="body"><b>${esc(m.senderName)}</b> <span class="meta2">${esc(fullDate(m.createdAt))}</span>
        <div>${m.deleted ? 'Message supprimé' : esc(m.text || '')}${m.media ? ` <a href="${esc(m.media.url)}" target="_blank">[${esc(m.media.name)} · ${fileSize(m.media.size)}]</a>` : ''}</div></div>
      ${!m.deleted && m.type !== 'system' ? `<button class="icon-btn" data-delmsg="${m.id}" title="Supprimer pour tous">${icon('trash', 'sm')}</button>` : ''}</div>`).join('');
    if (append) feed.insertAdjacentHTML('beforeend', html); else feed.innerHTML = html || '<div class="empty">Aucun message.</div>';
    $('[data-a=more]', c).hidden = !r.hasMore;
  };
  loadFeed(false);

  const save = async (body) => { try { await patch('/classes/' + id, body); toast('Enregistré'); classDetail(c, id); } catch (e) { fail(e); } };
  c.querySelectorAll('[data-set]').forEach(i => (i.onchange = () => save({ settings: { [i.dataset.set]: i.checked } })));
  $('[data-dis]', c).onchange = (e) => save({ disappearing: Number(e.target.value) });
  $('[data-icon]', c).onclick = (e) => ctxMenu(e.currentTarget, [
    { icon: 'image', label: 'Changer l\'icône', onClick: async () => {
      const files = await pickFiles({ accept: 'image/*' });
      if (!files) return;
      const cropped = await cropImage(files[0], { title: 'Recadrer l\'icône de la classe' });
      if (!cropped) return;
      try { const f = await uploadFile(cropped); save({ icon: f.url }); } catch (er) { fail(er); }
    } },
    k.icon && { icon: 'trash', label: 'Retirer l\'icône', danger: true, onClick: () => save({ icon: null }) },
  ], { align: 'left' });
  c.onclick = async (e) => {
    const go = e.target.closest('[data-go]');
    const r = e.target.closest('[data-restrict]');
    if (r) {
      const u = k.members.find(x => x.id === r.dataset.restrict);
      try { await (u.restricted ? del(`/classes/${id}/restrict/${u.id}`) : post(`/classes/${id}/restrict/${u.id}`)); toast(u.restricted ? 'Messages rétablis' : 'Membre restreint'); classDetail(c, id); } catch (er) { fail(er); }
      return;
    }
    const dm = e.target.closest('[data-delmsg]');
    if (dm) {
      if (!(await confirmBox('Supprimer ce message pour tous ?', 'Il sera remplacé par « Ce message a été supprimé » chez tous les membres.', { ok: 'Supprimer', danger: true }))) return;
      try { await del('/messages/' + dm.dataset.delmsg); toast('Message supprimé'); loadFeed(false); } catch (er) { fail(er); }
      return;
    }
    if (go && !e.target.closest('button')) { location.hash = go.dataset.go; return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'rename') { const v = await promptBox('Nom du groupe', { value: k.name, max: 100 }); if (v) save({ name: v }); }
    if (a === 'desc') { const v = await promptBox('Description', { value: k.description, max: 2048, multiline: true }); if (v !== null) save({ description: v }); }
    if (a === 'copy') copyText(`${location.origin}/?join=${k.inviteCode}`).then(() => toast('Lien copié'));
    if (a === 'invite' && await confirmBox('Réinitialiser le lien d\'invitation ?', 'L\'ancien lien ne fonctionnera plus.', { ok: 'Réinitialiser', danger: true })) { await post(`/classes/${id}/invite/reset`).catch(fail); classDetail(c, id); }
    if (a === 'more') loadFeed(true);
    if (a === 'announce') announceModal([k.id], k.name);
    if (a === 'delete' && await confirmBox('Supprimer cette classe ?', 'Son historique de messages sera supprimé définitivement.', { ok: 'Supprimer', danger: true })) {
      try { await del('/classes/' + id); toast('Classe supprimée'); location.hash = '#/classes'; } catch (er) { fail(er); }
    }
  };
}

function announceModal(classIds, label) {
  const body = h(`<div><p class="muted" style="margin-top:0;font-size:14px">Destinataires : <b>${esc(label)}</b>. L'annonce apparaît dans le groupe, signée « Administration Scola », et notifie les membres.</p>
    <textarea class="input boxed" rows="6" maxlength="4000" placeholder="Votre annonce…" data-t></textarea></div>`);
  modal({ title: 'Publier une annonce', body, buttons: [{ label: 'Annuler' }, { label: 'Publier', cls: '', onClick: async () => {
    const r = await post('/announce', { classIds, text: $('[data-t]', body).value });
    toast(`Annonce publiée dans ${r.sent} classe(s)`);
  } }] });
}

/* ---------------- Annonces ---------------- */
async function announce(c) {
  setTitle('Annonces');
  const list = await get('/classes?sort=name').catch(fail) || [];
  c.innerHTML = `<section class="panel"><h2>Nouvelle annonce</h2><div class="pad">
    <div class="field"><label>Message</label><textarea class="input boxed" rows="6" maxlength="4000" data-t placeholder="Ex. La plateforme sera en maintenance samedi de 22 h à minuit."></textarea>
      <div class="hint">Mise en forme possible : *gras*, _italique_, liens.</div></div>
    <div class="field"><label>Destinataires</label>
      <label class="choice"><input type="radio" name="dest" value="all" checked> Toutes les classes (${num(list.length)})</label>
      <label class="choice"><input type="radio" name="dest" value="some"> Certaines classes</label>
      <div data-pick hidden><div class="search-box" style="margin-bottom:8px">${icon('search', 'sm')}<input placeholder="Filtrer les classes" data-q></div>
        <div class="class-pick">${list.map(k => `<label data-name="${esc(fold(k.name + ' ' + k.country))}"><input type="checkbox" value="${k.id}"> <span class="grow">${esc(k.name)} <span class="faint">— ${esc(k.country)}</span></span><span class="faint">${num(k.members)}</span></label>`).join('')}</div></div></div>
    <button class="btn" data-send>${icon('megaphone', 'sm')} Publier l'annonce</button>
    <p class="hint" style="margin-bottom:0">L'annonce arrive dans la boîte « Annonces » de chaque élève (bouton à côté du crayon, dans Discussions) et en carte dans les groupes de classe. Les élèves reçoivent une notification.</p></div></section>
    <section class="panel"><h2>Annonces publiées</h2><div data-hist><div class="empty">Chargement…</div></div></section>`;
  const hist = async () => {
    const l = await get('/announcements').catch(fail);
    if (!l) return;
    $('[data-hist]', c).innerHTML = l.length ? l.map(a => `<div class="report" data-an="${a.id}"><div class="row" style="flex-wrap:wrap"><b class="grow">${esc(listTime(a.at))} · ${esc(a.target.length > 90 ? a.classes + ' classes' : a.target)}</b><span class="faint" style="font-size:12.5px">par ${esc(a.byName || '—')}</span></div>
      <p style="margin:8px 0;white-space:pre-wrap">${esc(a.text)}</p><button class="btn text danger" data-del-an style="height:30px;padding:0">${icon('trash', 'sm')} Supprimer l'annonce</button></div>`).join('')
      : '<div class="empty">Aucune annonce publiée.</div>';
  };
  hist();
  $('[data-hist]', c).onclick = async (e) => {
    const b = e.target.closest('[data-del-an]');
    if (!b) return;
    if (!(await confirmBox('Supprimer cette annonce ?', 'Elle disparaîtra de la boîte « Annonces » de tous les élèves et des groupes de classe.', { ok: 'Supprimer', danger: true }))) return;
    try { await del('/announcements/' + b.closest('[data-an]').dataset.an); toast('Annonce supprimée'); hist(); } catch (er) { fail(er); }
  };
  const pick = $('[data-pick]', c);
  c.querySelectorAll('[name=dest]').forEach(r => (r.onchange = () => { pick.hidden = $('[name=dest]:checked', c).value !== 'some'; }));
  $('[data-q]', c).oninput = (e) => { const f = fold(e.target.value); pick.querySelectorAll('label').forEach(l => { l.hidden = !l.dataset.name.includes(f); }); };
  $('[data-send]', c).onclick = async () => {
    const some = $('[name=dest]:checked', c).value === 'some';
    const ids = some ? [...pick.querySelectorAll('input:checked')].map(i => i.value) : 'all';
    if (some && !ids.length) return toast('Choisissez au moins une classe.');
    if (!(await confirmBox('Publier cette annonce ?', some ? `Elle sera envoyée à ${ids.length} classe(s).` : 'Elle sera envoyée à toutes les classes.', { ok: 'Publier' }))) return;
    try { const r = await post('/announce', { classIds: ids, text: $('[data-t]', c).value }); toast(`Annonce publiée dans ${r.sent} classe(s)`); $('[data-t]', c).value = ''; hist(); } catch (e) { fail(e); }
  };
}

/* ---------------- Avertissements ---------------- */
// Envoi d'un avertissement à un élève (boîte « Annonces » + notification) ou à un établissement
// (en tête de son espace + e-mail), en général après un signalement.
async function sendWarning({ userId, schoolId, name, reportId }) {
  const def = (await get('/warnings/default').catch(() => ({ text: '' }))).text;
  const text = await promptBox(`Avertir ${name}`, { value: def, max: 2000, multiline: true, label: 'Message (modifiable)', hint: schoolId ? 'Affiché en tête de l\'espace de l\'établissement et envoyé par e-mail.' : 'Reçu dans sa boîte « Annonces », avec une notification. Personne d\'autre ne le voit.' });
  if (text === null) return false;
  await post(schoolId ? `/schools/${schoolId}/warn` : `/users/${userId}/warn`, { text, reportId });
  toast('Avertissement envoyé');
  return true;
}

/* ---------------- Signalements ---------------- */
let reportFilter = 'pending';
async function reports(c) {
  setTitle('Signalements');
  c.innerHTML = `<div class="toolbar"><select data-f><option value="pending">À traiter</option><option value="resolved">Traités</option><option value="all">Tous</option></select></div><section class="panel" data-l></section>`;
  $('[data-f]', c).value = reportFilter;
  const load = async () => {
    const list = await get('/reports?status=' + reportFilter).catch(fail);
    if (!list) return;
    $('[data-l]', c).innerHTML = list.length ? list.map(r => `<div class="report ${r.resolved ? 'done' : ''}" data-r="${r.id}">
      <div class="row" style="flex-wrap:wrap"><span class="tag ${r.resolved ? '' : 'red'}">${r.resolved ? 'Traité' : 'À traiter'}</span><span class="tag warn">${esc(r.reason || 'Sans motif')}</span>
        <span class="grow faint" style="font-size:13px">Signalé par <b>${esc(r.byName)}</b> · ${esc(r.className)} · ${esc(relTime(r.at))}</span></div>
      <p style="margin:10px 0 6px">${r.kind === 'ad' ? `Publicité de <a href="#/schools/${r.schoolId}">${esc(r.className.replace(/^Publicité · /, ''))}</a> — campagne ${esc(r.campaignStatus === 'supprimée' ? 'supprimée' : 'en cours de diffusion ou terminée')}` : r.kind === 'channel' ? `Chaîne signalée : <a href="#/schools/${r.schoolId}">${esc(r.className.replace(/^Orientation · /, ''))}</a>` : `Personne signalée : ${r.userId ? `<a href="#/users/${r.userId}">${esc(r.userName)}</a>${r.userSuspended ? ' <span class="tag red">Suspendu</span>' : ''}` : '—'}`}</p>
      ${r.message ? `<div class="quote" style="margin:6px 0 10px;--qc:var(--danger)"><div class="q"><b>${r.kind === 'channel' ? 'Publication' : 'Message'} du ${esc(fullDate(r.message.at))}${r.messageDeleted ? ' — supprimé' : ''}</b><span>${esc(r.message.text)}</span></div>${r.message.media && /\.(jpe?g|png|webp|gif)$/i.test(r.message.media) ? `<img src="${esc(r.message.media)}" alt="">` : ''}</div>` : ''}
      ${r.warnedAt ? `<div class="faint" style="font-size:12.5px">${icon('flag', 'xs')} Avertissement envoyé le ${esc(fullDate(r.warnedAt))} par ${esc(r.warnedByName || '—')}</div>` : ''}
      ${r.resolved ? `<div class="faint" style="font-size:12.5px">Traité par ${esc(r.resolvedByName || '—')}${r.resolvedAt ? ' le ' + esc(fullDate(r.resolvedAt)) : ''}</div>` : ''}
      <div class="actions" style="margin-top:8px">
        ${r.message && !r.messageDeleted && r.kind !== 'ad' ? `<button class="btn ghost" data-act="${r.kind === 'channel' ? 'delpost' : 'delmsg'}" data-m="${r.message.id}">${r.kind === 'channel' ? 'Supprimer la publication' : 'Supprimer le message'}</button>` : ''}
        ${r.kind === 'channel' && r.schoolId ? `<a class="btn ghost" href="#/schools/${r.schoolId}">Voir l'établissement</a>` : ''}
        ${r.kind === 'ad' && r.campaignId ? `<a class="btn ghost" href="#/campaigns/${r.campaignId}">Voir la campagne (suspendre)</a>` : ''}
        ${r.userId ? `<button class="btn ghost" data-act="warn" data-u="${r.userId}" data-n="${esc(r.userName || '')}">${icon('flag', 'sm')} ${r.warnedAt ? 'Avertir à nouveau' : 'Envoyer un avertissement'}</button>` : ''}
        ${!r.userId && r.schoolId ? `<button class="btn ghost" data-act="warn" data-s="${r.schoolId}" data-n="${esc(r.className.replace(/^(Orientation|Publicité) · /, ''))}">${icon('flag', 'sm')} ${r.warnedAt ? 'Avertir à nouveau' : 'Avertir l\'établissement'}</button>` : ''}
        ${r.userId && !r.userSuspended ? `<button class="btn ghost" data-act="suspend" data-u="${r.userId}">Suspendre l'auteur</button>` : ''}
        ${r.userId ? `<button class="btn ghost" data-act="restrict" data-u="${r.userId}" data-c="${r.classId}">Restreindre dans la classe</button>` : ''}
        <button class="btn ${r.resolved ? 'ghost' : ''}" data-act="${r.resolved ? 'reopen' : 'resolve'}">${r.resolved ? 'Rouvrir' : 'Marquer comme traité'}</button></div></div>`).join('')
      : `<div class="empty">${icon('shieldCheck')}Aucun signalement ${reportFilter === 'pending' ? 'à traiter' : ''}.</div>`;
  };
  $('[data-f]', c).onchange = (e) => { reportFilter = e.target.value; load(); };
  c.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('[data-r]').dataset.r;
    try {
      if (b.dataset.act === 'warn') { if (!(await sendWarning({ userId: b.dataset.u, schoolId: b.dataset.s, name: b.dataset.n || 'ce compte', reportId: id }))) return; }
      if (b.dataset.act === 'delpost') { if (!(await confirmBox('Supprimer cette publication ?', 'Elle disparaîtra de la chaîne pour tous les abonnés.', { ok: 'Supprimer', danger: true }))) return; await del('/posts/' + b.dataset.m); toast('Publication supprimée'); }
      if (b.dataset.act === 'delmsg') { if (!(await confirmBox('Supprimer ce message pour tous ?', '', { ok: 'Supprimer', danger: true }))) return; await del('/messages/' + b.dataset.m); toast('Message supprimé'); }
      if (b.dataset.act === 'suspend') { const reason = await promptBox('Suspendre ce compte ?', { label: 'Motif', max: 300 }); if (reason === null) return; await post(`/users/${b.dataset.u}/suspend`, { reason }); toast('Compte suspendu'); }
      if (b.dataset.act === 'restrict') { await post(`/classes/${b.dataset.c}/restrict/${b.dataset.u}`); toast('Membre restreint'); }
      if (b.dataset.act === 'resolve') await post(`/reports/${id}/resolve`);
      if (b.dataset.act === 'reopen') await post(`/reports/${id}/resolve`, { reopen: true });
      load();
      refreshBadge();
    } catch (er) { fail(er); }
  };
  load();
}

/* ---------------- Établissements (chaînes d'orientation) ---------------- */
const SCH = { pending: ['À valider', 'warn'], code_sent: ['Code envoyé', ''], active: ['Actif', 'ok'], suspended: ['Suspendu', 'red'], rejected: ['Refusé', 'red'] };
const schTag = (st) => `<span class="tag ${SCH[st]?.[1] || ''}">${SCH[st]?.[0] || esc(st)}</span>`;
const waitTag = (s) => s.status !== 'pending' ? '' : `<span class="tag ${s.waitingHours >= 48 ? 'red' : ''}" title="Le code doit être envoyé sous 72 h">${s.waitingHours >= 72 ? 'Délai de 72 h dépassé' : `${72 - s.waitingHours} h restantes`}</span>`;
let schoolFilter = 'pending', schoolQ = '';

async function schools(c) {
  setTitle('Établissements');
  c.innerHTML = `<div class="toolbar"><div class="search-box">${icon('search', 'sm')}<input placeholder="Nom, ville, pays ou e-mail" data-q value="${esc(schoolQ)}"></div><div class="seg" data-seg></div></div>
    <p class="muted" data-mail style="margin-top:0;font-size:13.5px"></p><section class="panel"><div class="tbl-wrap" data-t></div></section>`;
  const load = async () => {
    const r = await get(`/schools?status=${schoolFilter}&q=${encodeURIComponent(schoolQ)}`).catch(fail);
    if (!r) return;
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    $('[data-seg]', c).innerHTML = [['', 'Tous', total], ...Object.keys(SCH).map(k => [k, SCH[k][0], r.counts[k] || 0])]
      .map(([k, l, n]) => `<button class="${k === schoolFilter ? 'on' : ''}" data-st="${k}">${l} <span class="faint">${n}</span></button>`).join('');
    $('[data-mail]', c).innerHTML = r.mailConfigured ? `${icon('check', 'xs')} Envoi d'e-mails configuré : le code part automatiquement à l'adresse de l'établissement.`
      : `${icon('info', 'xs')} Envoi d'e-mails non configuré (variables SMTP_*) : après validation, le code s'affiche et vous l'envoyez vous-même depuis votre messagerie.`;
    $('[data-t]', c).innerHTML = r.schools.length ? `<table class="tbl"><thead><tr><th>Établissement</th><th>Type</th><th>Lieu</th><th>Demande</th><th>Statut</th></tr></thead><tbody>
      ${r.schools.map(s => `<tr data-go="#/schools/${s.id}"><td><div class="cell-user">${avatar({ id: s.id, name: s.name, avatar: s.logo }, 34)}<div><b>${esc(s.name)}</b>${s.verified ? ` ${icon('check', 'xs')}` : ''}<div class="faint" style="font-size:12px">${esc(s.email)}</div></div></div></td>
        <td>${esc(s.typeLabel)}</td><td>${esc(s.city)}, ${esc(s.country)}</td><td>${esc(listTime(s.requestedAt))}</td><td>${schTag(s.status)} ${waitTag(s)}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${icon('megaphone')}Aucun établissement${schoolFilter ? ' dans cette catégorie' : ''}.</div>`;
  };
  $('[data-seg]', c).onclick = (e) => { const b = e.target.closest('[data-st]'); if (b) { schoolFilter = b.dataset.st; load(); } };
  $('[data-q]', c).oninput = debounce((e) => { schoolQ = e.target.value; load(); }, 250);
  bindRows(c);
  load();
}

function showCode(r) {
  const mailto = `mailto:${encodeURIComponent(r.to)}?subject=${encodeURIComponent(r.subject || 'Scola — code d\'activation')}&body=${encodeURIComponent(r.text || r.code)}`;
  const m = modal({
    title: 'Code d\'activation généré',
    body: `<p style="margin-top:0">${r.emailed ? `Le code a été envoyé par e-mail à <b>${esc(r.to)}</b>.` : `<b>L'e-mail n'a pas pu être envoyé automatiquement</b>${r.reason ? ` (${esc(r.reason)})` : ''}. Transmettez ce code à <b>${esc(r.to)}</b> :`}</p>
      <div class="code-box" data-code>${esc(r.code)}</div>
      <p class="faint" style="font-size:13px">Valable 7 jours, à usage unique. Il ne sera plus affiché ensuite : en cas de perte, générez-en un nouveau (l'ancien sera annulé).</p>
      <div class="actions" style="justify-content:flex-end;margin-top:14px">
        ${r.emailed ? '' : `<a class="btn ghost" href="${esc(mailto)}">${icon('ext', 'sm')} Ouvrir ma messagerie</a>`}
        <button class="btn ghost" data-copy>Copier le code</button><button class="btn" data-done>Terminé</button></div>`,
  });
  $('[data-copy]', m.el).onclick = () => { copyText(r.code); toast('Code copié'); };
  $('[data-done]', m.el).onclick = () => m.close();
  return m;
}

async function schoolDetail(c, id) {
  setTitle('Établissement');
  let s;
  try { s = await get('/schools/' + id); } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  setTitle(s.name);
  const link = (u) => u ? `<a href="${esc(/^https?:/.test(u) ? u : 'https://' + u)}" target="_blank" rel="noopener">${esc(u)}</a>` : '—';
  c.innerHTML = `<p><a href="#/schools">← Tous les établissements</a></p>
    <section class="panel"><div class="pad row" style="gap:18px;flex-wrap:wrap">${avatar({ id: s.id, name: s.name, avatar: s.logo }, 84)}
      <div class="grow"><h2 style="margin:0;font-size:22px">${esc(s.name)}${s.verified ? ` ${icon('check', 'sm')}` : ''}</h2><div class="muted">${esc(s.typeLabel)} · ${esc(s.city)}, ${esc(s.country)}</div>
      <div style="margin-top:6px">${schTag(s.status)} ${waitTag(s)}${s.verified ? ' <span class="tag ok">Certifié</span>' : ''}</div></div></div></section>
    <div class="grid2">
      <section class="panel"><h2>Informations fournies</h2><div class="pad"><dl class="kv">
        <dt>E-mail officiel</dt><dd><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></dd>
        <dt>Téléphone</dt><dd>${esc(s.phone || '—')}</dd>
        <dt>Adresse</dt><dd>${esc(s.address || '—')}</dd>
        <dt>Site web</dt><dd>${link(s.website)}</dd>
        <dt>Responsable</dt><dd>${esc(s.manager?.name || '—')}${s.manager?.role ? ' — ' + esc(s.manager.role) : ''}</dd>
        <dt>Demande reçue</dt><dd>${esc(fullDate(s.requestedAt))}</dd>
        ${s.codeSentAt ? `<dt>Code envoyé</dt><dd>${esc(fullDate(s.codeSentAt))} par ${esc(s.codeSentBy || '—')}${s.codeEmailed ? ' (e-mail)' : ' (à transmettre manuellement)'}${s.status === 'code_sent' && s.codeExpires ? `<br><span class="faint">Expire le ${esc(fullDate(s.codeExpires))}</span>` : ''}</dd>` : ''}
        ${s.activatedAt ? `<dt>Activé le</dt><dd>${esc(fullDate(s.activatedAt))}</dd>` : ''}
        ${s.lastLogin ? `<dt>Dernière connexion</dt><dd>${esc(fullDate(s.lastLogin))}</dd>` : ''}
        ${s.rejectReason ? `<dt>Motif du refus</dt><dd>${esc(s.rejectReason)}</dd>` : ''}
        ${s.plan ? `<dt>Formule</dt><dd>${esc(s.plan.name)}${s.founder ? ' <span class="tag founder">Fondateur</span>' : ''} · <a href="#/billing/${s.id}">abonnement et paiements</a></dd>` : ''}
        ${s.verified && !s.verifiedShown ? '<dt>Badge vérifié</dt><dd class="faint">Accordé, mais affiché seulement à partir de la formule Standard.</dd>' : ''}
        <dt>Abonnés</dt><dd>${num(s.followers)}</dd>
        <dt>Publications</dt><dd>${num(s.posts)}</dd>
      </dl></div></section>
      <section class="panel"><h2>Actions</h2><div class="pad actions" style="flex-direction:column;align-items:stretch">
        ${s.status === 'pending' ? `<button class="btn" data-a="code">${icon('key', 'sm')} Valider et envoyer le code d'activation</button>` : ''}
        ${s.status === 'code_sent' ? `<button class="btn ghost" data-a="code">${icon('key', 'sm')} Générer un nouveau code</button>` : ''}
        ${['pending', 'code_sent'].includes(s.status) ? `<button class="btn danger" data-a="reject">${icon('x', 'sm')} Refuser la demande</button>` : ''}
        ${['active', 'suspended'].includes(s.status) ? `<button class="btn ghost" data-a="verify">${icon('check', 'sm')} ${s.verified ? 'Retirer le badge certifié' : 'Certifier l\'établissement'}</button>
          <button class="btn ${s.status === 'suspended' ? '' : 'danger'}" data-a="suspend">${icon('shield', 'sm')} ${s.status === 'suspended' ? 'Réactiver la chaîne' : 'Suspendre la chaîne'}</button>` : ''}
        ${['active', 'suspended'].includes(s.status) ? `<button class="btn ghost" data-a="warn">${icon('flag', 'sm')} Envoyer un avertissement</button>` : ''}
        <button class="btn danger" data-a="delete">${icon('trash', 'sm')} Supprimer définitivement</button>
        <p class="faint" style="font-size:12.5px;margin:4px 0 0">Le code d'activation est le seul moyen pour l'établissement d'achever la création de son compte. Il doit lui parvenir sous 72 h.</p>
      </div></section></div>
    <section class="panel"><h2>Présentation</h2><div class="pad" style="white-space:pre-wrap">${esc(s.description || '—')}${s.programs ? `\n\n<b>Filières et formations</b>\n${esc(s.programs)}` : ''}</div></section>
    <section class="panel"><h2>Publications récentes (${num(s.posts)})</h2>
      ${s.recentPosts.length ? s.recentPosts.map(p => `<div class="report"><div class="row"><span class="grow faint" style="font-size:13px">${esc(fullDate(p.createdAt))} · ${num(p.views)} vue(s)</span><button class="btn ghost" data-delpost="${p.id}" style="height:32px">Supprimer</button></div>
        ${p.media && p.type === 'image' ? `<img src="${esc(p.media.url)}" alt="" style="max-width:220px;border-radius:10px;margin-top:8px;display:block">` : p.media ? `<p style="margin:8px 0 0">📎 <a href="${esc(p.media.url)}" target="_blank" rel="noopener">${esc(p.media.name || 'Fichier')}</a></p>` : ''}
        ${p.text ? `<p style="margin:8px 0 0;white-space:pre-wrap">${esc(p.text)}</p>` : ''}</div>`).join('') : '<div class="empty">Aucune publication.</div>'}</section>`;
  c.onclick = async (e) => {
    const dp = e.target.closest('[data-delpost]');
    const a = e.target.closest('[data-a]')?.dataset.a;
    try {
      if (dp) {
        if (!(await confirmBox('Supprimer cette publication ?', 'Elle disparaîtra de la chaîne pour tous les abonnés.', { ok: 'Supprimer', danger: true }))) return;
        await del('/posts/' + dp.dataset.delpost); toast('Publication supprimée'); return schoolDetail(c, id);
      }
      if (!a) return;
      if (a === 'warn') { await sendWarning({ schoolId: id, name: s.name }); return; }
      if (a === 'code') {
        if (!(await confirmBox(s.status === 'pending' ? `Valider « ${s.name} » ?` : 'Générer un nouveau code ?', `Un code d'activation à usage unique sera envoyé à ${s.email}.${s.status === 'code_sent' ? ' L\'ancien code sera annulé.' : ''}`, { ok: 'Générer le code' }))) return;
        const r = await post(`/schools/${id}/code`);
        showCode(r);
        refreshBadge();
      }
      if (a === 'reject') {
        const reason = await promptBox(`Refuser « ${s.name} » ?`, { label: 'Motif (communiqué à l\'établissement)', placeholder: 'Ex. informations invérifiables', max: 500, multiline: true });
        if (reason === null) return;
        await post(`/schools/${id}/reject`, { reason }); toast('Demande refusée'); refreshBadge();
      }
      if (a === 'verify') { await patch('/schools/' + id, { verified: !s.verified }); toast(s.verified ? 'Badge retiré' : 'Établissement certifié'); }
      if (a === 'suspend') {
        if (s.status !== 'suspended' && !(await confirmBox('Suspendre cette chaîne ?', 'Elle sera masquée pour les élèves et l\'établissement ne pourra plus se connecter.', { ok: 'Suspendre', danger: true }))) return;
        await patch('/schools/' + id, { status: s.status === 'suspended' ? 'active' : 'suspended' }); toast(s.status === 'suspended' ? 'Chaîne réactivée' : 'Chaîne suspendue');
      }
      if (a === 'delete') {
        if (!(await confirmBox(`Supprimer « ${s.name} » ?`, 'Le compte, la chaîne, ses publications et ses échanges avec les élèves seront supprimés. Action irréversible.', { ok: 'Supprimer', danger: true }))) return;
        await del('/schools/' + id); toast('Établissement supprimé'); refreshBadge(); location.hash = '#/schools'; return;
      }
      schoolDetail(c, id);
    } catch (er) { fail(er); }
  };
}

/* ---------------- Administrateurs ---------------- */
async function admins(c) {
  setTitle('Administrateurs');
  const load = async () => {
    const list = await get('/admins').catch(fail);
    if (!list) return;
    c.innerHTML = `<div class="toolbar"><span class="grow muted">Les administrateurs gèrent tout le site. Ce ne sont pas des comptes élèves.</span><button class="btn" data-add>${icon('userPlus', 'sm')} Ajouter un administrateur</button></div>
      <section class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nom</th><th>E-mail</th><th>Ajouté par</th><th>Créé le</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
      ${list.map(a => `<tr data-id="${a.id}"><td><b>${esc(a.name)}</b>${a.me ? ' <span class="tag">Vous</span>' : ''}${a.mustChangePassword ? ' <span class="tag warn">Mot de passe provisoire</span>' : ''}</td><td>${esc(a.email)}</td>
        <td>${esc(a.createdBy || '—')}</td><td>${esc(listTime(a.createdAt))}</td><td>${a.lastLogin ? esc(listTime(a.lastLogin)) : 'Jamais'}</td>
        <td class="num"><button class="btn text" data-edit>Modifier</button>${a.me ? '' : '<button class="btn text danger" data-del>Supprimer</button>'}</td></tr>`).join('')}</tbody></table></div></section>`;
    $('[data-add]', c).onclick = () => adminForm(null, load);
  };
  c.onclick = async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const list = await get('/admins');
    const a = list.find(x => x.id === tr.dataset.id);
    if (e.target.closest('[data-edit]')) return a.me ? (location.hash = '#/account') : adminForm(a, load);
    if (e.target.closest('[data-del]')) {
      if (!(await confirmBox(`Supprimer l'administrateur ${a.name} ?`, 'Cette personne n\'aura plus accès à l\'espace d\'administration.', { ok: 'Supprimer', danger: true }))) return;
      try { await del('/admins/' + a.id); toast('Administrateur supprimé'); load(); } catch (er) { fail(er); }
    }
  };
  load();
}

function adminForm(a, done) {
  const body = h(`<div>
    <div class="field"><label>Nom</label><input class="input" data-n maxlength="60" value="${esc(a?.name || '')}"></div>
    <div class="field"><label>E-mail</label><input class="input" type="email" data-e value="${esc(a?.email || '')}"></div>
    <div class="field"><label>${a ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe provisoire'}</label><input class="input" type="text" data-p autocomplete="new-password" placeholder="8 caractères minimum">
      <div class="hint">${a ? 'Un nouveau mot de passe déconnecte cet administrateur ; il devra le changer à sa prochaine connexion.' : 'Communiquez-le à la personne : elle devra le changer à sa première connexion.'}</div></div></div>`);
  if (!a) $('[data-p]', body).value = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase();
  modal({ title: a ? 'Modifier l\'administrateur' : 'Ajouter un administrateur', body, buttons: [{ label: 'Annuler' }, { label: a ? 'Enregistrer' : 'Ajouter', cls: '', onClick: async () => {
    const payload = { name: $('[data-n]', body).value, email: $('[data-e]', body).value };
    const p = $('[data-p]', body).value;
    if (p || !a) payload.password = p;
    if (a) await patch('/admins/' + a.id, payload); else await post('/admins', payload);
    toast(a ? 'Administrateur modifié' : 'Administrateur ajouté');
    done();
  } }] });
}

/* ---------------- Mon compte ---------------- */
function account(c) {
  setTitle('Mon compte');
  c.innerHTML = `<div class="grid2">
    <section class="panel"><h2>Profil</h2><form class="pad" data-prof>
      <div class="field"><label>Nom</label><input class="input" name="name" value="${esc(ME.name)}" maxlength="60"></div>
      <div class="field"><label>E-mail</label><input class="input" type="email" name="email" value="${esc(ME.email)}"></div>
      <div class="field"><label>Mot de passe actuel (requis pour changer l'e-mail)</label><input class="input" type="password" name="currentPassword" autocomplete="current-password"></div>
      <button class="btn">Enregistrer</button></form></section>
    <section class="panel"><h2>Changer le mot de passe</h2><form class="pad" data-pw>
      <div class="field"><label>Mot de passe actuel</label><input class="input" type="password" name="currentPassword" autocomplete="current-password" required></div>
      <div class="field"><label>Nouveau mot de passe</label><input class="input" type="password" name="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label>Confirmer</label><input class="input" type="password" name="confirm" autocomplete="new-password" minlength="8" required></div>
      <button class="btn">Changer le mot de passe</button></form></section></div>`;
  $('[data-prof]', c).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { name: f.elements.name.value };
    if (f.email.value.trim().toLowerCase() !== ME.email) { body.email = f.email.value; body.currentPassword = f.currentPassword.value; }
    try { const r = await patch('/me', body); ME = r.admin; toast('Profil enregistré'); start(); } catch (er) { fail(er); }
  };
  $('[data-pw]', c).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.confirm.value) return toast('Les deux mots de passe ne correspondent pas.', { error: true });
    try { const r = await patch('/me', { currentPassword: f.currentPassword.value, password: f.password.value }); tok.set(r.token); ME = r.admin; toast('Mot de passe modifié'); f.reset(); } catch (er) { fail(er); }
  };
}

function forcePasswordChange() {
  const body = h(`<div><p class="muted" style="margin-top:0;font-size:14px">Vous utilisez un mot de passe provisoire. Choisissez-en un nouveau pour continuer.</p>
    <div class="field"><label>Mot de passe actuel (provisoire)</label><input class="input" type="password" data-c></div>
    <div class="field"><label>Nouveau mot de passe</label><input class="input" type="password" data-p placeholder="8 caractères minimum"></div>
    <div class="field"><label>Confirmer</label><input class="input" type="password" data-p2></div></div>`);
  modal({ title: 'Changez votre mot de passe', body, closable: false, buttons: [{ label: 'Valider', cls: '', onClick: async () => {
    if ($('[data-p]', body).value !== $('[data-p2]', body).value) throw new Error('Les deux mots de passe ne correspondent pas.');
    const r = await patch('/me', { currentPassword: $('[data-c]', body).value, password: $('[data-p]', body).value });
    tok.set(r.token);
    ME = r.admin;
    toast('Mot de passe modifié');
  } }] });
}

/* ---------------- Démarrage ---------------- */
if (tok.get()) start(); else showLogin();
