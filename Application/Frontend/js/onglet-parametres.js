// Onglet Paramètres.
import { $, h, esc, icon, avatar, formatText, listTime, fullDate, copyText, pickFiles } from './outils-communs.js';
import { get, post, patch, del, upload, downloadAuth } from './appels-au-serveur.js';
import { S, emit, user } from './memoire-de-l-application.js';
import { toast, fail, modal, confirmBox, choose, promptBox, pickMembers, pushPage, sound } from './fenetres-et-menus.js';
import { nav } from './navigation-entre-ecrans.js';
import { live, openStarred, toggleBlock } from './liste-des-discussions.js';
import { WALLPAPERS, wallStyle } from './conversation-ouverte.js';
import { openViewer } from './photos-videos-fichiers.js';
import { DIAL, deviceName } from './ecrans-connexion-inscription.js';
import { pushSupported, enablePush, pushState } from './notifications-push.js';
import { pickCity } from './orientation-a-la-une-et-ville.js';
import { SUPPORT, loadSupport, supportBadge, openSupport } from './ecrire-a-l-equipe-scola.js';

let side;

function setMe(me) { S.me = { ...S.me, ...me }; S.members.set(S.me.id, S.me); emit('me'); }

function row(ic, title, sub = '', attrs = '', cls = '') {
  return `<div class="menu-row ${cls}" ${attrs}>${icon(ic)}<div class="txt"><span>${title}</span>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
}
function sw(key, title, sub, checked) {
  return `<label class="menu-row"><div class="txt"><span>${title}</span>${sub ? `<small>${sub}</small>` : ''}</div><label class="switch"><input type="checkbox" data-sw="${key}" ${checked ? 'checked' : ''}><span></span></label></label>`;
}

export function render(el) {
  side = el;
  el.innerHTML = `<div class="panel-head"><h1>Paramètres</h1></div><div class="list scroll" data-body></div>`;
  const body = $('[data-body]', el);
  const draw = () => {
    body.innerHTML = `
      <div class="item" data-a="profile" style="min-height:96px">${avatar(S.me, 70)}<div class="body" style="border:0"><div class="top"><span class="name" style="font-size:19px">${esc(S.me.name)}</span></div><div class="bot"><span class="prev">${esc(S.me.about || '')}</span></div></div>${icon('qr')}</div>
      <div style="height:8px;background:var(--panel-2)"></div>
      ${row('key', 'Compte', 'Sécurité, changer de numéro, mes données, supprimer', 'data-a="account"')}
      ${row('lock', 'Confidentialité', 'Contacts bloqués, vu à, confirmations de lecture', 'data-a="privacy"')}
      ${row('chat', 'Discussions', 'Thème, fonds d\'écran, taille du texte', 'data-a="chats"')}
      ${row('bell', 'Notifications', 'Messages, groupe, appels, sons', 'data-a="notif"')}
      ${row('star', 'Messages importants', '', 'data-a="starred"')}
      ${row('laptop', 'Appareils connectés', 'Utiliser Scola sur un autre appareil', 'data-a="devices"')}
      ${row('cap', 'Ma classe', esc(S.cls?.name || ''), 'data-a="class"')}
      ${row('help', 'Aide' + (SUPPORT.unread ? ' ' + supportBadge() : ''), SUPPORT.unread ? 'Nouvelle réponse de l\'équipe Scola' : 'Centre d\'aide, écrire à l\'équipe Scola, charte', 'data-a="help"')}
      ${row('users', 'Inviter des camarades', '', 'data-a="invite"')}
      ${row('logout', 'Se déconnecter', '', 'data-a="logout"', 'danger')}
      <div class="empty" style="font-size:12px">Scola · la messagerie de ta classe · v1.0</div>`;
  };
  draw();
  live(el, 'me', draw);
  live(el, 'support', draw);
  if (!SUPPORT.loaded) loadSupport();
  body.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'profile') openProfile();
    if (a === 'account') accountPage();
    if (a === 'privacy') privacyPage();
    if (a === 'chats') chatsPage();
    if (a === 'notif') notifPage();
    if (a === 'starred') openStarred(side);
    if (a === 'devices') openDevices();
    if (a === 'class') import('./fiches-contact-et-groupe.js').then(m => m.openGroup());
    if (a === 'help') helpPage();
    if (a === 'invite') invite();
    if (a === 'logout' && await confirmBox('Se déconnecter ?', 'Vous pourrez vous reconnecter avec votre numéro de téléphone.', { ok: 'Se déconnecter', danger: true })) nav.logout();
  };
}

function invite() {
  const link = S.cls?.inviteCode ? `${location.origin}/?join=${S.cls.inviteCode}` : location.origin;
  const text = `Rejoins notre classe « ${S.cls?.name} » sur Scola, la messagerie des élèves et étudiants : ${link}`;
  if (navigator.share) navigator.share({ title: 'Scola', text, url: link }).catch(() => {});
  else copyText(text).then(() => toast('Lien d\'invitation copié'));
}

/* ---------------- Profil ---------------- */
export function openProfile() {
  pushPage(side || nav.els.side, {
    title: 'Profil',
    render: (body) => {
      const draw = () => {
        body.innerHTML = `
          <div class="avatar-edit" data-av>${avatar(S.me, 200)}<div class="ov">${icon('camera')}<span>${S.me.avatar ? 'Changer la photo de profil' : 'Ajouter une photo de profil'}</span></div></div>
          <div class="card card-pad"><div class="field"><label>Nom</label><div class="edit-line"><span class="grow">${esc(S.me.name)}</span><button class="icon-btn" data-e="name">${icon('edit', 'sm')}</button></div></div>
            <div class="hint">Ce nom est visible par les membres de votre classe.</div></div>
          <div class="card card-pad"><div class="field"><label>Infos</label><div class="edit-line"><span class="grow">${formatText(S.me.about || '—')}</span><button class="icon-btn" data-e="about">${icon('edit', 'sm')}</button></div></div></div>
          <div class="card card-pad"><div class="field"><label>Établissement</label><div class="edit-line"><span class="grow">${esc(S.me.school || '—')}</span><button class="icon-btn" data-e="school">${icon('edit', 'sm')}</button></div></div>
            <div class="field"><label>Ville <small class="faint">(facultatif)</small></label><div class="edit-line"><span class="grow">${esc(S.me.city || '—')}</span><button class="icon-btn" data-e="city">${icon('edit', 'sm')}</button></div><div class="hint">Sert seulement à te proposer des établissements proches dans Orientation. Ni ta classe ni les établissements ne la voient.</div></div></div>
          <div class="card card-pad"><div class="field"><label>Téléphone</label><div>${esc(S.me.phone)}</div></div></div>
          <div class="card card-pad"><div class="field"><label>Classe</label><div>${esc(S.cls?.name || '')}</div><div class="hint">${esc(S.cls?.cycleLabel || '')} · ${esc(S.cls?.filiere || '')} · ${esc(S.cls?.niveau || '')} — ${esc(S.cls?.country || '')}. La classe est définie à l'inscription et ne peut pas être modifiée.</div></div></div>
          <div class="card card-pad" style="text-align:center"><div class="hint" style="margin-bottom:8px">Mon code QR : un camarade de ma classe peut le scanner pour m'écrire.</div><div data-qr style="width:180px;height:180px;margin:0 auto;background:#fff;border-radius:8px"></div></div>`;
        get('/qr?text=' + encodeURIComponent(`${location.origin}/?chat=dm&user=${S.me.id}`)).then(r => { const q = $('[data-qr]', body); if (q) q.innerHTML = `<img src="${r.qr}" style="width:100%">`; }).catch(() => {});
        $('[data-av]', body).onclick = (e) => {
          const items = [
            S.me.avatar && { icon: 'eye', label: 'Voir la photo', onClick: () => openViewer([{ url: S.me.avatar, type: 'image', caption: S.me.name }], 0) },
            { icon: 'image', label: 'Importer une photo', onClick: pickAvatar },
            { icon: 'camera', label: 'Prendre une photo', onClick: () => import('./photos-videos-fichiers.js').then(async m => { const f = await m.takePhoto({ video: false }); if (f) saveAvatar(f); }) },
            S.me.avatar && { icon: 'trash', label: 'Supprimer la photo', danger: true, onClick: () => patch('/me', { avatar: null }).then(setMe).catch(fail) },
          ];
          import('./fenetres-et-menus.js').then(m => m.ctxMenu({ x: e.clientX, y: e.clientY }, items));
        };
        body.querySelectorAll('[data-e]').forEach(b => (b.onclick = () => edit(b.dataset.e)));
      };
      const edit = async (k) => {
        if (k === 'about') {
          const presets = ['Disponible', 'En cours 📚', 'En révision pour les examens 📝', 'À la bibliothèque', 'Occupé(e)', 'Ne pas déranger 🔕', 'Salut ! J\'utilise Scola.'];
          const v = await choose('Infos', [{ value: '__custom', label: 'Personnaliser…', desc: S.me.about }, ...presets.map(p => ({ value: p, label: p }))], S.me.about);
          if (v === null) return;
          const val = v === '__custom' ? await promptBox('Infos', { value: S.me.about, max: 139 }) : v;
          if (val !== null) patch('/me', { about: val }).then(setMe).catch(fail);
          return;
        }
        if (k === 'city') return pickCity();
        const labels = { name: ['Votre nom', 40], school: ['Établissement', 80] };
        const v = await promptBox(labels[k][0], { value: S.me[k] || '', max: labels[k][1] });
        if (v !== null) patch('/me', { [k]: v }).then(setMe).catch(fail);
      };
      draw();
      live(body, 'me', draw);
    },
  });
}

function pickAvatar() {
  pickFiles({ accept: 'image/*' }).then(f => f && saveAvatar(f[0]));
}
async function saveAvatar(file) {
  try {
    const { cropImage } = await import('./photos-videos-fichiers.js');
    const cropped = await cropImage(file, { title: 'Recadrer votre photo' });
    if (!cropped) return;
    const f = await upload(cropped);
    setMe(await patch('/me', { avatar: f.url }));
    toast('Photo de profil mise à jour');
  } catch (e) { fail(e); }
}

/* ---------------- Mot de passe ---------------- */
// Création (ancien compte sans mot de passe), changement, ou remplacement du mot de passe provisoire.
export function passwordFlow({ force = false } = {}) {
  const first = !S.me.hasPassword, temp = S.me.mustChangePassword;
  const body = h(`<div>
    <p class="muted" style="margin-top:0;font-size:14px">${temp ? 'Vous utilisez un mot de passe provisoire donné par l\'administration : choisissez votre propre mot de passe.'
      : first ? 'Créez votre mot de passe : il vous permettra de vous reconnecter à Scola sur n\'importe quel téléphone, avec votre numéro.' : 'Changez votre mot de passe Scola.'}</p>
    ${!first && !temp ? '<div class="field"><label>Mot de passe actuel</label><input class="input" type="password" data-cur autocomplete="current-password"></div>' : ''}
    <div class="field"><label>Nouveau mot de passe (8 caractères minimum)</label><input class="input" type="password" data-new autocomplete="new-password"></div>
    <div class="field"><label>Confirmez</label><input class="input" type="password" data-new2 autocomplete="new-password"></div></div>`);
  modal({
    title: first ? 'Créer mon mot de passe' : 'Mot de passe', body, closable: !(force && temp),
    buttons: [...(force && temp ? [] : [{ label: force ? 'Plus tard' : 'Annuler' }]), { label: 'Enregistrer', cls: 'text', onClick: async () => {
      const n = $('[data-new]', body).value;
      if (n !== $('[data-new2]', body).value) throw new Error('Les deux mots de passe ne correspondent pas.');
      await patch('/me/password', { currentPassword: $('[data-cur]', body)?.value, password: n });
      setMe({ ...S.me, hasPassword: true, mustChangePassword: false });
      toast('Mot de passe enregistré');
    } }],
  });
}

/* ---------------- Compte ---------------- */
function accountPage() {
  pushPage(side, {
    title: 'Compte',
    render: (body) => {
      const draw = () => {
        body.innerHTML = `
          ${row('lock', 'Mot de passe', S.me.hasPassword ? 'Pour vous reconnecter sur un autre téléphone' : 'Pas encore créé : créez-le pour pouvoir vous reconnecter', 'data-a="password"', S.me.hasPassword ? '' : 'warn')}
          ${row('shieldCheck', 'Vérification en deux étapes', S.me.hasPin ? 'Activée — un code PIN est demandé à chaque nouvelle connexion' : 'Désactivée', 'data-a="pin"')}
          ${row('phone', 'Changer de numéro', esc(S.me.phone), 'data-a="number"')}
          ${row('laptop', 'Appareils connectés', '', 'data-a="devices"')}
          ${row('download', 'Demander les infos de mon compte', 'Télécharger un fichier contenant mon profil et mes messages', 'data-a="export"')}
          ${row('trash', 'Supprimer mon compte', 'Vous quitterez votre classe définitivement', 'data-a="delete"', 'danger')}`;
      };
      draw();
      live(body, 'me', draw);
      body.onclick = async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        try {
          if (a === 'password') passwordFlow();
          if (a === 'pin') await pinFlow();
          if (a === 'number') await changeNumber();
          if (a === 'devices') openDevices();
          if (a === 'export') { await downloadAuth('/me/export', 'scola-mes-donnees.json'); toast('Export téléchargé'); }
          if (a === 'delete') await deleteAccount();
        } catch (er) { fail(er); }
      };
    },
  });
}

async function askPin(title) {
  const v = await promptBox(title, { max: 6, placeholder: '••••••', hint: '6 chiffres' });
  if (v === null) return null;
  if (!/^\d{6}$/.test(v)) throw new Error('Le code PIN doit contenir exactement 6 chiffres.');
  return v;
}

async function pinFlow() {
  if (S.me.hasPin) {
    const v = await choose('Vérification en deux étapes', [{ value: 'change', label: 'Changer le code PIN' }, { value: 'off', label: 'Désactiver' }], 'change');
    if (v === 'off') { if (await confirmBox('Désactiver la vérification en deux étapes ?', 'Votre compte sera moins protégé.', { ok: 'Désactiver', danger: true })) { setMe(await del('/me/pin')); toast('Vérification en deux étapes désactivée'); } return; }
    if (v !== 'change') return;
  }
  const p1 = await askPin('Choisissez un code PIN à 6 chiffres');
  if (!p1) return;
  const p2 = await askPin('Confirmez le code PIN');
  if (!p2) return;
  if (p1 !== p2) throw new Error('Les deux codes ne correspondent pas.');
  setMe(await post('/me/pin', { pin: p1 }));
  toast('Vérification en deux étapes activée');
}

async function changeNumber() {
  const body = h(`<div><p class="muted" style="font-size:14px">Vos discussions, votre classe et vos paramètres seront conservés.</p>
    <div class="field"><label>Nouveau numéro</label><div class="phone-row"><select class="select" data-c>${Object.entries(DIAL).map(([c, d]) => `<option value="${d}" ${c === S.cls?.country ? 'selected' : ''}>${esc(c)} ${d}</option>`).join('')}</select><input class="input" data-n inputmode="tel" placeholder="07 00 00 00 00"></div></div>
    <div data-step2 hidden><div class="field" data-sms-f hidden><label>Code reçu par SMS au nouveau numéro</label><input class="input" data-sms inputmode="numeric" maxlength="6"></div>
      <div class="field"><label data-l2>Code reçu par SMS</label><input class="input" data-code inputmode="numeric" maxlength="6"></div></div></div>`);
  let pwMode = false, sms = false;
  let phone = null;
  modal({
    title: 'Changer de numéro', body,
    buttons: [{ label: 'Annuler' }, { label: 'Continuer', cls: 'text', onClick: async () => {
      if (!phone) {
        phone = $('[data-c]', body).value + $('[data-n]', body).value.replace(/\D/g, '');
        const r = await post('/auth/request-otp', { phone });
        if (r.exists) { phone = null; throw new Error('Ce numéro est déjà utilisé par un autre compte.'); }
        $('[data-step2]', body).hidden = false;
        // Sans SMS : confirmation par le mot de passe du compte.
        if (r.mode === 'password') { pwMode = true; $('[data-l2]', body).textContent = 'Votre mot de passe Scola'; const c = $('[data-code]', body); c.type = 'password'; c.removeAttribute('maxlength'); c.removeAttribute('inputmode'); }
        // SMS activés : un code est envoyé au nouveau numéro pour vérifier qu'il vous appartient.
        if (r.sms) { sms = true; $('[data-sms-f]', body).hidden = false; await post('/me/number-code', { phone }); toast('Code envoyé par SMS au nouveau numéro'); }
        return false;
      }
      const v = $('[data-code]', body).value;
      setMe(await post('/me/change-number', pwMode ? { phone, password: v, code: sms ? $('[data-sms]', body).value : undefined } : { phone, code: v }));
      toast('Numéro modifié');
    } }],
  });
}

async function deleteAccount() {
  const ok = await confirmBox('Supprimer votre compte ?', 'Votre profil, vos statuts et vos appareils connectés seront supprimés. Vous quitterez la classe. Cette action est irréversible.', { ok: 'Continuer', danger: true });
  if (!ok) return;
  const v = await promptBox('Confirmez avec votre numéro', { placeholder: S.me.phone, hint: `Saisissez ${S.me.phone} pour confirmer.` });
  if (v === null) return;
  if (v.replace(/\s/g, '') !== S.me.phone) throw new Error('Le numéro saisi ne correspond pas.');
  await del('/me');
  toast('Compte supprimé');
  setTimeout(() => nav.logout(true), 800);
}

/* ---------------- Appareils connectés ---------------- */
export function openDevices() {
  pushPage(side || nav.els.side, {
    title: 'Appareils connectés',
    render: async (body) => {
      const draw = async () => {
        let list = [];
        try { list = await get('/me/sessions'); } catch (e) { return fail(e); }
        body.innerHTML = `<div style="text-align:center;padding:24px 20px;background:var(--panel)">
            <div class="av" style="--s:84px;background:var(--brand-soft);color:var(--brand);margin:0 auto 12px">${icon('laptop', 'lg')}</div>
            <p class="muted" style="font-size:14px">Utilisez Scola sur un ordinateur, une tablette ou un autre téléphone.</p>
            <button class="btn" data-link>${icon('qr', 'sm')} Connecter un appareil</button></div>
          <div class="section-title">Appareils (${list.length})</div>
          ${list.map(s => `<div class="item" data-sid="${s.id}"><div class="av" style="--s:44px;background:var(--panel-3);color:var(--text-2)">${icon(/Android|iOS/.test(s.device) ? 'phone' : 'laptop')}</div>
            <div class="body"><div class="top"><span class="name">${esc(s.device)}</span>${s.current ? '<span class="tag">Cet appareil</span>' : ''}</div>
            <div class="bot"><span class="prev">Actif ${esc(listTime(s.lastActive))} · connecté le ${esc(fullDate(s.createdAt))}</span></div></div></div>`).join('')}
          <div class="empty" style="font-size:12.5px">${icon('lock', 'xs')} Appuyez sur un appareil pour le déconnecter.</div>`;
        $('[data-link]', body).onclick = linkDevice;
      };
      draw();
      body.onclick = async (e) => {
        const it = e.target.closest('[data-sid]');
        if (!it) return;
        const s = it.querySelector('.tag');
        if (s) return toast('Pour déconnecter cet appareil, utilisez « Se déconnecter ».');
        if (await confirmBox('Déconnecter cet appareil ?', 'Il devra être reconnecté avec un code QR ou un numéro.', { ok: 'Déconnecter', danger: true })) {
          try { await del('/me/sessions/' + it.dataset.sid); toast('Appareil déconnecté'); draw(); } catch (er) { fail(er); }
        }
      };
    },
  });
}

async function loadJsQR() {
  if (window.jsQR) return window.jsQR;
  await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/vendor/jsQR.js'; s.onload = resolve; s.onerror = reject; document.head.append(s); });
  return window.jsQR;
}

function linkDevice() {
  let stream, raf, done = false;
  const body = h(`<div class="qr-scan">
    <p class="muted" style="font-size:14px;margin-top:0">Sur l'autre appareil, ouvrez <b>${esc(location.host)}</b> puis scannez le code QR affiché, ou saisissez le code à 10 caractères.</p>
    <video playsinline muted></video>
    <div class="field" style="margin-top:12px"><label>Ou saisissez le code</label><input class="input" data-code maxlength="10" placeholder="Ex. 3FA92C10BE" style="text-transform:uppercase;letter-spacing:2px"></div></div>`);
  const approve = async (code) => {
    if (done) return;
    done = true;
    try { const r = await post('/auth/link/approve', { code }); toast(`Appareil connecté : ${r.device}`); m.close(); }
    catch (e) { done = false; fail(e); }
  };
  const m = modal({
    title: 'Connecter un appareil', body,
    buttons: [{ label: 'Annuler' }, { label: 'Valider le code', cls: 'text', onClick: async () => { await approve($('[data-code]', body).value.trim()); return false; } }],
    onClose: () => { cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); },
  });
  (async () => {
    try {
      const jsQR = await loadJsQR();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = $('video', body);
      v.srcObject = stream;
      await v.play();
      const c = document.createElement('canvas');
      const g = c.getContext('2d', { willReadFrequently: true });
      const scan = () => {
        if (!body.isConnected) return;
        if (v.videoWidth) {
          c.width = v.videoWidth; c.height = v.videoHeight;
          g.drawImage(v, 0, 0);
          const res = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
          if (res?.data?.startsWith('scola-link:')) return approve(res.data);
        }
        raf = requestAnimationFrame(scan);
      };
      scan();
    } catch { $('video', body).replaceWith(h('<div class="dev-code">Caméra indisponible : saisissez le code affiché sur l\'autre appareil.</div>')); }
  })();
}

/* ---------------- Confidentialité ---------------- */
function privacyPage() {
  pushPage(side, {
    title: 'Confidentialité',
    render: (body) => {
      const lab = (v) => (v === 'all' ? 'Ma classe' : 'Personne');
      const draw = () => {
        const p = S.me.privacy;
        body.innerHTML = `<div class="section-title">Qui peut voir mes infos personnelles</div>
          ${row('clock', 'Vu à et en ligne', lab(p.lastSeen), 'data-a="lastSeen"')}
          ${row('user', 'Photo de profil', lab(p.avatar), 'data-a="avatar"')}
          ${row('info', 'Infos', lab(p.about), 'data-a="about"')}
          ${row('phone', 'Numéro de téléphone', lab(p.phone), 'data-a="phone"')}
          ${sw('readReceipts', 'Confirmations de lecture', 'Si désactivées, vous ne verrez pas non plus celles des autres. Toujours actives dans le groupe de classe.', p.readReceipts)}
          ${row('phone', 'Qui peut m\u2019écrire grâce à mon numéro', p.contactable === 'class' ? 'Ma classe seulement' : 'Tout élève ou étudiant qui a mon numéro', 'data-a="contactable"')}
          <div class="section-title">Orientation</div>
          ${sw('personalizedAds', 'Publicités personnalisées', 'Les établissements peuvent payer pour apparaître dans l’onglet Orientation (jamais dans ta classe, tes discussions, tes appels ni tes notifications). Activé : Scola choisit celles qui correspondent à ton niveau, ta filière et ta ville, sans jamais dire aux établissements qui tu es. Désactivé : tu vois seulement des publicités non ciblées, au même emplacement.', p.personalizedAds !== false)}
          <div class="section-title">Contacts bloqués</div>
          ${row('ban', 'Contacts bloqués', `${S.me.blocked.length}`, 'data-a="blocked"')}`;
        $('[data-sw=readReceipts]', body).onchange = (e) => patch('/me/privacy', { readReceipts: e.target.checked }).then(setMe).catch(fail);
        $('[data-sw=personalizedAds]', body).onchange = (e) => patch('/me/privacy', { personalizedAds: e.target.checked }).then(setMe).catch(fail);
      };
      draw();
      live(body, 'me', draw);
      body.onclick = async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        if (a === 'blocked') return blockedPage();
        if (a === 'contactable') {
          const v = await choose('Qui peut m\u2019écrire grâce à mon numéro', [{ value: 'all', label: 'Tout élève ou étudiant qui a mon numéro' }, { value: 'class', label: 'Ma classe seulement' }], S.me.privacy.contactable || 'all', { note: 'Hors de votre classe, personne ne voit votre « vu à » ni vos infos. Vous pouvez toujours bloquer ou signaler quelqu\u2019un.' });
          if (v) patch('/me/privacy', { contactable: v }).then(setMe).catch(fail);
          return;
        }
        const notes = { lastSeen: 'Si vous ne partagez pas votre « vu à », vous ne verrez pas celui des autres.' };
        const v = await choose({ lastSeen: 'Vu à et en ligne', avatar: 'Photo de profil', about: 'Infos', phone: 'Numéro de téléphone' }[a], [{ value: 'all', label: 'Ma classe' }, { value: 'nobody', label: 'Personne' }], S.me.privacy[a], { note: notes[a] || '' });
        if (v) patch('/me/privacy', { [a]: v }).then(setMe).catch(fail);
      };
    },
  });
}

function blockedPage() {
  pushPage(side, {
    title: 'Contacts bloqués',
    render: (body) => {
      const draw = () => {
        body.innerHTML = `<div class="menu-row" data-add>${icon('userPlus')}<div class="txt">Bloquer un camarade</div></div>`
          + (S.me.blocked.map(id => `<div class="item compact" data-uid="${id}">${avatar(user(id), 42)}<div class="body"><div class="top"><span class="name">${esc(user(id).name)}</span></div><div class="bot"><span class="prev">Appuyez pour débloquer</span></div></div></div>`).join('')
          || '<div class="empty">Aucun contact bloqué. Les contacts bloqués ne peuvent plus vous appeler ni vous écrire en privé.</div>');
      };
      draw();
      live(body, 'me', draw);
      body.onclick = async (e) => {
        if (e.target.closest('[data-add]')) { const id = await pickMembers({ title: 'Bloquer…', exclude: [S.me.id, ...S.me.blocked] }); if (id) toggleBlock(id); return; }
        const uid = e.target.closest('[data-uid]')?.dataset.uid;
        if (uid) toggleBlock(uid);
      };
    },
  });
}

/* ---------------- Discussions ---------------- */
function chatsPage() {
  pushPage(side, {
    title: 'Discussions',
    render: (body) => {
      const draw = () => {
        const s = S.me.settings;
        body.innerHTML = `<div class="section-title">Affichage</div>
          ${row('moon', 'Thème', { system: 'Par défaut du système', light: 'Clair', dark: 'Sombre' }[s.theme], 'data-a="theme"')}
          ${row('wall', 'Fond d\'écran', s.wallpaper ? 'Personnalisé' : 'Par défaut', 'data-a="wall"')}
          ${row('textSize', 'Taille de la police', { small: 'Petite', medium: 'Moyenne', large: 'Grande' }[s.fontSize], 'data-a="font"')}
          <div class="section-title">Paramètres des discussions</div>
          ${sw('enterToSend', 'Entrée pour envoyer', 'La touche Entrée envoie le message (Maj+Entrée pour aller à la ligne)', s.enterToSend)}
          ${sw('archiveKeep', 'Garder les discussions archivées', 'Elles restent archivées lorsque vous recevez un nouveau message', s.archiveKeep)}
          <div class="section-title">Sauvegarde</div>
          ${row('download', 'Exporter mes données', 'Profil et messages envoyés (JSON)', 'data-a="export"')}`;
        body.querySelectorAll('[data-sw]').forEach(i => (i.onchange = () => patch('/me/settings', { [i.dataset.sw]: i.checked }).then(setMe).catch(fail)));
      };
      draw();
      live(body, 'me', draw);
      body.onclick = async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'theme') { const v = await choose('Thème', [{ value: 'system', label: 'Par défaut du système' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }], S.me.settings.theme); if (v) patch('/me/settings', { theme: v }).then(setMe).catch(fail); }
        if (a === 'font') { const v = await choose('Taille de la police', [{ value: 'small', label: 'Petite' }, { value: 'medium', label: 'Moyenne' }, { value: 'large', label: 'Grande' }], S.me.settings.fontSize); if (v) patch('/me/settings', { fontSize: v }).then(setMe).catch(fail); }
        if (a === 'wall') pickWallpaper(null);
        if (a === 'export') downloadAuth('/me/export', 'scola-mes-donnees.json').catch(fail);
      };
    },
  });
}

export function pickWallpaper(chatId) {
  const current = chatId ? S.chats.get(chatId)?.state?.wallpaper : S.me.settings.wallpaper;
  const body = h(`<div><p class="muted" style="font-size:14px;margin-top:0">${chatId ? 'Fond d\'écran de cette discussion uniquement.' : 'Fond d\'écran par défaut de toutes les discussions.'}</p>
    <div class="wall-swatches">${WALLPAPERS.map((w, i) => { const st = wallStyle(w); return `<button data-i="${i}" class="${w === current ? 'on' : ''}" style="${st.style || 'background:var(--chat-bg)'}" title="${w ? 'Couleur' : 'Par défaut'}">${w ? '' : '<small class="faint">Défaut</small>'}</button>`; }).join('')}
    <button data-img style="background:var(--panel-3);display:grid;place-items:center">${icon('image')}</button></div></div>`);
  const apply = async (w) => {
    try {
      if (chatId) { const s = await patch(`/chats/${chatId}/state`, { wallpaper: w }); S.chats.set(s.id, s); emit('chat:meta', s.id); }
      else setMe(await patch('/me/settings', { wallpaper: w }));
      toast('Fond d\'écran appliqué');
    } catch (e) { fail(e); }
  };
  const m = modal({ title: 'Fond d\'écran', body, buttons: chatId ? [{ label: 'Utiliser le fond par défaut', onClick: () => apply(null) }] : [] });
  body.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (b) { apply(WALLPAPERS[Number(b.dataset.i)]); m.close(); }
    if (e.target.closest('[data-img]')) {
      pickFiles({ accept: 'image/*' }).then(async (files) => {
        if (!files) return;
        try {
          const { compressImage } = await import('./photos-videos-fichiers.js');
          const f = await upload(await compressImage(files[0], 1920));
          apply('i:' + f.url);
          m.close();
        } catch (er) { fail(er); }
      });
    }
  };
}

/* ---------------- Notifications ---------------- */
function notifPage() {
  pushPage(side, {
    title: 'Notifications',
    render: (body) => {
      const draw = () => {
        const n = S.me.settings.notifications;
        const perm = 'Notification' in window ? Notification.permission : 'unsupported';
        body.innerHTML = `<div class="card card-pad">
            <b>Notifications du navigateur</b>
            <p class="muted" style="font-size:13.5px;margin:4px 0 10px">${perm === 'granted'
              ? (pushState.active ? 'Activées sur cet appareil : vous êtes prévenu de chaque message, même quand Scola est fermé. Touchez une notification pour ouvrir le message.' : 'Autorisées. Activez la réception quand Scola est fermé :')
              : perm === 'denied' ? 'Bloquées dans les réglages du navigateur. Autorisez-les pour ce site, puis revenez ici.'
              : perm === 'unsupported' || !pushSupported() ? 'Non prises en charge par ce navigateur. Sur iPhone : ajoutez Scola à l\'écran d\'accueil (Partager › Sur l\'écran d\'accueil), puis ouvrez-le depuis l\'icône.'
              : 'Autorisez-les pour être prévenu des messages et appels, même quand Scola est fermé.'}</p>
            ${(perm === 'default' || (perm === 'granted' && !pushState.active)) && pushSupported() ? '<button class="btn" data-perm>Activer les notifications</button>' : ''}</div>
          <div class="section-title">Messages</div>
          ${sw('messages', 'Discussions privées', 'Notifications des messages privés', n.messages)}
          ${sw('groups', 'Groupe de la classe', 'Les mentions @vous sont toujours notifiées', n.groups)}
          ${sw('preview', 'Aperçu du message', 'Afficher le texte dans les notifications', n.preview)}
          <div class="section-title">Autres</div>
          ${sw('calls', 'Sonnerie des appels', '', n.calls)}
          ${sw('orientation', 'Orientation', 'Nouvelles publications des établissements suivis (hors mode silencieux) et leurs réponses', n.orientation !== false)}
          ${sw('sound', 'Sons', 'Sons des messages entrants et sortants', n.sound)}
          ${row('speaker', 'Tester le son', '', 'data-test')}`;
        body.querySelectorAll('[data-sw]').forEach(i => (i.onchange = () => patch('/me/settings', { notifications: { [i.dataset.sw]: i.checked } }).then(setMe).catch(fail)));
        $('[data-perm]', body)?.addEventListener('click', async () => {
          const r = await enablePush().catch((e) => { fail(e); return null; });
          if (r === 'granted') toast('Notifications activées sur cet appareil');
          emit('push');
          draw();
        });
        $('[data-test]', body).onclick = () => sound.message();
      };
      draw();
      live(body, 'me', draw);
    },
  });
}

/* ---------------- Aide ---------------- */
function helpPage() {
  pushPage(side, {
    title: 'Aide',
    render: (body) => {
      body.innerHTML = `<div class="profile-top"><div class="splash-logo" style="margin:0 auto 12px;width:72px;height:72px;animation:none"></div><h3>Scola</h3><p class="faint">Version 1.0 · la messagerie de ta classe</p></div>
        <div class="list" style="margin-bottom:8px">${row('chat', 'Écrire à l\'équipe Scola' + (SUPPORT.unread ? ' ' + supportBadge() : ''), 'Question, problème, mauvaise classe, suggestion…', 'data-support')}</div>
        <div class="card card-pad" style="font-size:14.5px;line-height:1.6">
          <b>Comment fonctionne Scola ?</b>
          <p>À l'inscription, tu choisis ton pays, ton cycle, ta filière et ton niveau. Tu rejoins alors automatiquement le <b>groupe unique</b> de tous les élèves/étudiants concernés (ex. tous les BTS IDA 1ère année de Côte d'Ivoire). Tu ne peux appartenir qu'à une seule classe.</p>
          <b>Administration</b>
          <p>Scola est géré par une équipe d'administration. Elle modère les groupes de classe, traite les signalements, publie les annonces officielles et peut, en cas d'erreur, transférer un élève dans la bonne classe ou lui donner un mot de passe provisoire. Pour la joindre : « Écrire à l'équipe Scola » ci-dessus.</p>
          <b>Mise en forme des messages</b>
          <p><code>*gras*</code> → <b>gras</b> · <code>_italique_</code> → <i>italique</i> · <code>~barré~</code> → <s>barré</s> · <code>\`code\`</code> · <code>\`\`\`bloc\`\`\`</code> · <code>&gt; citation</code> · <code>- liste</code> · <code>@Nom</code> pour mentionner.</p>
          <b>Raccourcis</b>
          <p>Entrée : envoyer · Maj+Entrée : nouvelle ligne · ↑ : modifier le dernier message · Échap : fermer.</p>
        </div>
        <div class="card card-pad" style="font-size:14px;line-height:1.6"><b>Charte Scola</b>
          <ul style="padding-left:20px;margin:6px 0"><li>Respect et bienveillance envers tous les camarades.</li><li>Pas de fraude ni de fuite de sujets d'examen.</li><li>Pas de contenus violents, haineux ou inappropriés.</li><li>Pas de spam ni de publicité.</li><li>Signale tout abus : l'administration de Scola est là pour aider.</li></ul></div>`;
      $('[data-support]', body).onclick = () => openSupport(side);
    },
  });
}

export { deviceName };
