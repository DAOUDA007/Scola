// Parcours de connexion et d'inscription.
import { $, h, esc, icon, pickFiles } from './util.js';
import { get, post, token } from './api.js';
import { toast, ctxMenu } from './ui.js';
import { cropImage, takePhoto } from './media.js';

export const DIAL = {
  "Côte d'Ivoire": '+225', 'Bénin': '+229', 'Burkina Faso': '+226', 'Cameroun': '+237', 'Congo': '+242', 'RD Congo': '+243',
  'Gabon': '+241', 'Guinée': '+224', 'Mali': '+223', 'Niger': '+227', 'Sénégal': '+221', 'Tchad': '+235', 'Togo': '+228',
  'Madagascar': '+261', 'Maroc': '+212', 'Tunisie': '+216', 'Algérie': '+213', 'France': '+33', 'Belgique': '+32', 'Canada': '+1', 'Suisse': '+41',
};

export function deviceName() {
  const ua = navigator.userAgent;
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${b}${o ? ' (' + o + ')' : ''}`;
}

let root, done, linkTimer, catalog, invite, onViewport;

export async function startAuth(el, onDone) {
  root = el;
  done = (t) => { clearInterval(linkTimer); token.set(t); onDone(t); };
  catalog = await get('/catalog');
  const code = new URLSearchParams(location.search).get('join');
  if (code) invite = await get('/invite/' + encodeURIComponent(code)).catch(() => null);
  // Lien d'invitation d'une classe : c'est forcément un élève.
  if (invite) return welcome();
  chooseProfile();
}

/* ---------- Qui êtes-vous ? ----------
   Élèves et établissements sont séparés dès le départ : un établissement ne passe jamais par le
   numéro de téléphone ni par le choix d'une classe, il crée son compte dans son propre espace. */
function chooseProfile() {
  const card = shell(`
    <h1>Bienvenue sur Scola</h1>
    <p class="muted" style="margin:0 0 18px">Qui êtes-vous ?</p>
    <div class="profile-choice">
      <button class="choice-card" data-student>${icon('cap', 'lg')}<span><b>Élève ou étudiant</b><small>Rejoins le groupe de ta filière et de ton niveau, discute avec ta classe, suis les établissements.</small></span>${icon('chevR', 'sm')}</button>
      <a class="choice-card" href="/etablissement/">${icon('megaphone', 'lg')}<span><b>Établissement</b><small>École, université, lycée, centre de formation : créez ou ouvrez le compte de votre établissement.</small></span>${icon('chevR', 'sm')}</a>
    </div>
    <p class="faint" style="font-size:12.5px;margin:16px 0 0">Les établissements n'intègrent aucun groupe de classe : ils disposent de leur propre espace, validé par l'administration de Scola.</p>`, true);
  $('[data-student]', card).onclick = () => welcome();
}

function shell(inner, narrow = false) {
  clearInterval(linkTimer);
  root.innerHTML = `<div class="auth"><div class="auth-band"></div>
    <div class="auth-top"><div class="logo"></div>SCOLA</div>
    <div class="auth-card ${narrow ? 'narrow' : ''}">${inner}</div></div>`;
  window.scrollTo(0, 0); // chaque étape s'ouvre en haut, sans saut
  const card = $('.auth-card', root);
  // Le contenu du cadre défile (pas la page) : le champ actif est amené au centre du cadre,
  // y compris quand le clavier du téléphone s'ouvre et réduit la hauteur visible.
  const reveal = () => {
    const el = document.activeElement;
    if (el && card.contains(el) && /INPUT|SELECT|TEXTAREA/.test(el.tagName)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  card.addEventListener('focusin', () => setTimeout(reveal, 300));
  if (window.visualViewport) {
    if (onViewport) visualViewport.removeEventListener('resize', onViewport);
    onViewport = () => { if (card.isConnected) reveal(); };
    visualViewport.addEventListener('resize', onViewport);
  }
  return card;
}

/* ---------- Accueil ---------- */
function welcome() {
  const card = shell(`
    <div>
      <h1>Bienvenue sur Scola</h1>
      <p class="muted" style="margin:0 0 18px">La messagerie qui réunit <b>tous les élèves et étudiants de ta filière et de ton niveau</b> dans un seul groupe : partagez cours, devoirs, annonces, et discutez comme sur WhatsApp.</p>
      ${invite ? `<div class="class-preview">${icon('cap', 'lg')}<div><small>Invitation à rejoindre</small><b>${esc(invite.name)}</b><small>${esc(invite.country)} · ${invite.members} membre${invite.members > 1 ? 's' : ''}</small></div></div>` : ''}
      <button class="btn" data-phone style="margin:8px 0 10px">${icon('phone', 'sm')} Continuer avec mon numéro</button>
      <p class="faint" style="font-size:12.5px;margin:0 0 22px">Espace réservé aux élèves et étudiants. ${invite ? '' : '<a href="#" data-back-profile>← Changer de profil</a> · '}<a href="/etablissement/">Vous êtes un établissement ?</a></p>
      <h3 style="margin:0 0 6px;font-weight:500">Déjà connecté sur un autre appareil ?</h3>
      <ol>
        <li>Ouvre Scola sur ton téléphone</li>
        <li>Va dans <b>Paramètres</b> › <b>Appareils connectés</b></li>
        <li>Appuie sur <b>Connecter un appareil</b></li>
        <li>Scanne ce code QR (ou saisis le code affiché)</li>
      </ol>
    </div>
    <div style="text-align:center">
      <div class="qr"><div class="faint">Chargement…</div></div>
      <p class="faint" style="font-size:13px;margin-top:10px">Code : <b data-code style="letter-spacing:2px">—</b></p>
    </div>`);
  $('[data-phone]', card).onclick = () => phoneStep();
  $('[data-back-profile]', card)?.addEventListener('click', (e) => { e.preventDefault(); chooseProfile(); });
  startLink(card);
}

async function startLink(card) {
  const box = $('.qr', card);
  try {
    const l = await post('/auth/link/start', { device: deviceName() });
    box.innerHTML = `<img src="${l.qr}" alt="Code QR de connexion">`;
    $('[data-code]', card).textContent = l.code;
    linkTimer = setInterval(async () => {
      if (!document.body.contains(box)) return clearInterval(linkTimer);
      const r = await get('/auth/link/' + l.code).catch(() => ({}));
      if (r.token) { done(r.token); toast('Appareil connecté'); }
      else if (r.expired || Date.now() > l.expires) {
        clearInterval(linkTimer);
        box.insertAdjacentHTML('beforeend', `<div class="expired"><span>Code expiré</span><button class="btn">${icon('refresh', 'sm')} Recharger</button></div>`);
        $('.expired button', box).onclick = () => startLink(card);
      }
    }, 2000);
  } catch { box.innerHTML = '<div class="faint">QR indisponible</div>'; }
}

/* ---------- Numéro de téléphone ---------- */
function phoneStep(prefill = {}) {
  const country = prefill.country || invite?.country || "Côte d'Ivoire";
  const card = shell(`
    <button class="icon-btn" data-back style="margin:-12px 0 8px -12px">${icon('back')}</button>
    <h1>Ton numéro de téléphone</h1>
    <p class="muted">Scola va t'envoyer un code à 6 chiffres pour vérifier ton numéro.</p>
    <div class="field"><label>Pays</label><select class="select" data-country>${Object.keys(DIAL).map(c => `<option ${c === country ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="field"><label>Numéro</label><div class="phone-row"><input class="input" data-dial readonly style="width:70px;flex:none"><input class="input" data-num inputmode="tel" autocomplete="tel-national" placeholder="07 00 00 00 00" value="${esc(prefill.num || '')}"></div></div>
    <div class="error-text" data-err></div>
    <button class="btn block" data-go>Suivant</button>`, true);
  const sel = $('[data-country]', card), dial = $('[data-dial]', card), num = $('[data-num]', card);
  const sync = () => { dial.value = DIAL[sel.value]; };
  sync();
  sel.onchange = sync;
  $('[data-back]', card).onclick = welcome;
  const go = async () => {
    const digits = num.value.replace(/\D/g, '');
    const phone = dial.value + (dial.value === '+33' || dial.value === '+32' || dial.value === '+41' ? digits.replace(/^0/, '') : digits);
    if (digits.length < 6) return ($('[data-err]', card).textContent = 'Numéro trop court.');
    $('[data-go]', card).disabled = true;
    try {
      const r = await post('/auth/request-otp', { phone });
      otpStep(phone, r, { country: sel.value, num: num.value });
    } catch (e) { $('[data-err]', card).textContent = e.message; $('[data-go]', card).disabled = false; }
  };
  $('[data-go]', card).onclick = go;
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  num.focus();
}

/* ---------- Code reçu par SMS ---------- */
function otpStep(phone, info, prefill) {
  const card = shell(`
    <button class="icon-btn" data-back style="margin:-12px 0 8px -12px">${icon('back')}</button>
    <h1>Vérification</h1>
    <p class="muted">Saisis le code envoyé par SMS au <b>${esc(phone)}</b>. <button class="btn text" data-edit style="height:auto;padding:0">Mauvais numéro ?</button></p>
    ${info.devCode ? `<div class="dev-code">Mode démonstration (aucun SMS configuré) — ton code est <b style="letter-spacing:2px">${info.devCode}</b></div>` : ''}
    <div class="otp">${'<input inputmode="numeric" maxlength="1" autocomplete="one-time-code">'.repeat(6)}</div>
    <div class="error-text" data-err style="text-align:center"></div>
    <p style="text-align:center"><button class="btn text" data-resend disabled>Renvoyer le code</button></p>`, true);
  const inputs = [...card.querySelectorAll('.otp input')];
  $('[data-back]', card).onclick = () => phoneStep(prefill);
  $('[data-edit]', card).onclick = () => phoneStep(prefill);
  const resend = $('[data-resend]', card);
  let left = 30;
  const tick = setInterval(() => {
    if (!document.body.contains(resend)) return clearInterval(tick);
    left--; resend.textContent = left > 0 ? `Renvoyer le code (${left} s)` : 'Renvoyer le code';
    if (left <= 0) { resend.disabled = false; clearInterval(tick); }
  }, 1000);
  resend.onclick = async () => {
    try { const r = await post('/auth/request-otp', { phone }); otpStep(phone, r, prefill); } catch (e) { toast(e.message, { error: true }); }
  };
  const submit = async () => {
    const code = inputs.map(i => i.value).join('');
    if (code.length < 6) return;
    inputs.forEach(i => (i.disabled = true));
    try {
      const r = await post('/auth/verify-otp', { phone, code, device: deviceName() });
      if (r.token) return done(r.token);
      if (r.needPin) return pinStep(r);
      if (r.newUser) return profileStep({ signupToken: r.signupToken, country: prefill.country });
    } catch (e) {
      $('[data-err]', card).textContent = e.message;
      inputs.forEach(i => { i.disabled = false; i.value = ''; });
      inputs[0].focus();
    }
  };
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      const v = inp.value.replace(/\D/g, '');
      if (v.length > 1) { v.split('').slice(0, 6 - i).forEach((d, k) => (inputs[i + k].value = d)); }
      else inp.value = v;
      const next = inputs.find(x => !x.value);
      (next || inputs[5]).focus();
      if (inputs.every(x => x.value)) submit();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus(); });
  });
  inputs[0].focus();
}

/* ---------- Vérification en deux étapes ---------- */
function pinStep(r) {
  const card = shell(`
    <h1>Vérification en deux étapes</h1>
    <p class="muted">Bonjour ${esc(r.name)} ! Ton compte est protégé par un code PIN à 6 chiffres.</p>
    <div class="otp">${'<input inputmode="numeric" maxlength="1" type="password">'.repeat(6)}</div>
    <div class="error-text" data-err style="text-align:center"></div>
    <p class="hint" style="text-align:center">PIN oublié ? Contacte l'administration de Scola pour le réinitialiser.</p>`, true);
  const inputs = [...card.querySelectorAll('.otp input')];
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', async () => {
      inp.value = inp.value.replace(/\D/g, '').slice(-1);
      if (inp.value && i < 5) inputs[i + 1].focus();
      if (inputs.every(x => x.value)) {
        try { const t = await post('/auth/verify-pin', { pinToken: r.pinToken, pin: inputs.map(x => x.value).join(''), device: deviceName() }); done(t.token); }
        catch (e) { $('[data-err]', card).textContent = e.message; inputs.forEach(x => (x.value = '')); inputs[0].focus(); }
      }
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus(); });
  });
  inputs[0].focus();
}

/* ---------- Inscription : profil ---------- */
const reg = {};
function profileStep(init) {
  Object.assign(reg, init);
  const card = shell(`
    <div class="steps"><i class="on"></i><i></i></div>
    <h1>Ton profil</h1>
    <p class="muted">Indique ton nom et, si tu veux, une photo. Tes camarades de classe les verront.</p>
    <button type="button" class="avatar-pick" title="Ajouter une photo">${reg.avatarUrl ? `<img src="${reg.avatarUrl}" alt="">` : icon('camera', 'lg')}</button>
    <div class="field"><label>Nom complet</label><input class="input" data-name maxlength="40" placeholder="Ex. Awa Koné" value="${esc(reg.name || '')}"></div>
    <div class="field"><label>Infos (facultatif)</label><input class="input" data-about maxlength="139" placeholder="Salut ! J'utilise Scola." value="${esc(reg.about || '')}"></div>
    <div class="field"><label>Établissement (facultatif)</label><input class="input" data-school maxlength="80" placeholder="Ex. Lycée Classique d'Abidjan, INP-HB, Pigier…" value="${esc(reg.school || '')}"></div>
    <div class="error-text" data-err></div>
    <button class="btn block" data-go>Suivant</button>`, true);
  // Photo de profil : importée ou prise, puis recadrée en cercle comme sur WhatsApp.
  const setPhoto = async (file) => {
    const cropped = await cropImage(file, { title: 'Recadrer ta photo' });
    if (!cropped) return;
    reg.avatarFile = cropped;
    reg.avatarUrl = URL.createObjectURL(cropped);
    $('.avatar-pick', card).innerHTML = `<img src="${reg.avatarUrl}" alt="">`;
  };
  $('.avatar-pick', card).onclick = (e) => ctxMenu(e.currentTarget, [
    { icon: 'image', label: 'Importer une photo', onClick: () => pickFiles({ accept: 'image/*' }).then(f => f && setPhoto(f[0])) },
    { icon: 'camera', label: 'Prendre une photo', onClick: () => takePhoto({ video: false }).then(f => f && setPhoto(f)) },
    reg.avatarFile && { icon: 'trash', label: 'Retirer la photo', danger: true, onClick: () => { reg.avatarFile = reg.avatarUrl = null; $('.avatar-pick', card).innerHTML = icon('camera', 'lg'); } },
  ], { align: 'left' });
  $('[data-go]', card).onclick = () => {
    reg.name = $('[data-name]', card).value.trim();
    reg.about = $('[data-about]', card).value.trim();
    reg.school = $('[data-school]', card).value.trim();
    if (reg.name.length < 2) return ($('[data-err]', card).textContent = 'Indique ton nom (2 caractères minimum).');
    classStep();
  };
  $('[data-name]', card).focus();
}

/* ---------- Inscription : choix de la classe ---------- */
function classStep() {
  const pre = invite || {};
  const card = shell(`
    <div class="steps"><i class="on"></i><i class="on"></i></div>
    <h1>Ta classe</h1>
    <p class="muted">Choisis ta filière et ton niveau. Tu rejoindras automatiquement le groupe unique de tous les élèves/étudiants concernés dans ton pays.</p>
    <div class="field"><label>Pays</label><select class="select" data-k="country">${catalog.countries.map(c => `<option ${c === (pre.country || reg.country || "Côte d'Ivoire") ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="field"><label>Cycle</label><select class="select" data-k="cycle">${catalog.cycles.map(c => `<option value="${c.id}" ${c.id === (pre.cycle || 'bts') ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
    <div class="field"><label>Filière / série</label><select class="select" data-k="filiere"></select>
      <input class="input" data-other placeholder="Saisis ta filière" maxlength="80" hidden></div>
    <div class="field"><label>Niveau</label><select class="select" data-k="niveau"></select></div>
    <div data-preview></div>
    <label class="choice" style="font-size:13.5px"><input type="checkbox" data-rules> <span>Je suis élève ou étudiant et j'accepte la charte Scola : respect, entraide, pas de fraude aux examens ni de contenus inappropriés. <b>Je comprends que ma classe ne pourra plus être changée.</b></span></label>
    <div class="error-text" data-err></div>
    <button class="btn block" data-go>Rejoindre ma classe</button>
    <p style="text-align:center"><button class="btn text" data-back>Retour</button></p>`, true);
  const q = (k) => $(`[data-k=${k}]`, card);
  const other = $('[data-other]', card);
  const fillCycle = () => {
    const c = catalog.cycles.find(x => x.id === q('cycle').value);
    q('filiere').innerHTML = c.filieres.map(f => `<option ${f === pre.filiere ? 'selected' : ''}>${esc(f)}</option>`).join('') + '<option value="__other">Autre filière…</option>';
    if (pre.filiere && !c.filieres.includes(pre.filiere)) { q('filiere').value = '__other'; other.value = pre.filiere; }
    q('niveau').innerHTML = c.niveaux.map(n => `<option ${n === pre.niveau ? 'selected' : ''}>${esc(n)}</option>`).join('');
    other.hidden = q('filiere').value !== '__other';
    lookup();
  };
  const values = () => ({
    country: q('country').value, cycle: q('cycle').value, niveau: q('niveau').value,
    filiere: q('filiere').value === '__other' ? other.value.trim() : q('filiere').value,
  });
  let seq = 0;
  const lookup = async () => {
    const v = values();
    const box = $('[data-preview]', card);
    // La zone garde toujours la même place (hauteur réservée) : le cadre ne saute pas.
    const show = (title, sub) => { box.innerHTML = `<div class="class-preview">${icon('cap', 'lg')}<div><b>${esc(title)}</b><small>${esc(sub)}</small></div></div>`; };
    const my = ++seq;
    if (!v.filiere) { box.classList.remove('loading'); return show('Ta classe', 'Saisis le nom de ta filière'); }
    box.classList.add('loading');
    try {
      const r = await get('/classes/lookup?' + new URLSearchParams(v));
      if (my !== seq) return;
      show(r.displayName, `${r.country} · ${r.exists ? `${r.members} membre${r.members > 1 ? 's' : ''} t'attendent` : 'Tu seras le premier membre de cette classe'}`);
    } catch (e) { if (my === seq) show('Classe introuvable', e.message); }
    finally { if (my === seq) box.classList.remove('loading'); }
  };
  q('cycle').onchange = () => { pre.filiere = pre.niveau = undefined; fillCycle(); };
  q('country').onchange = lookup;
  q('niveau').onchange = lookup;
  q('filiere').onchange = () => { other.hidden = q('filiere').value !== '__other'; if (!other.hidden) other.focus(); lookup(); };
  let t;
  other.oninput = () => { clearTimeout(t); t = setTimeout(lookup, 300); };
  fillCycle();
  $('[data-back]', card).onclick = () => profileStep({});
  $('[data-go]', card).onclick = async () => {
    const v = values();
    const err = $('[data-err]', card);
    if (!v.filiere) return (err.textContent = 'Indique ta filière.');
    if (!$('[data-rules]', card).checked) return (err.textContent = 'Merci d\'accepter la charte.');
    $('[data-go]', card).disabled = true;
    try {
      const r = await post('/auth/register', { signupToken: reg.signupToken, name: reg.name, about: reg.about, school: reg.school, ...v, device: deviceName() });
      token.set(r.token);
      if (reg.avatarFile) {
        const { upload, patch } = await import('./api.js');
        try { const f = await upload(reg.avatarFile); await patch('/me', { avatar: f.url }); } catch {}
      }
      history.replaceState(null, '', '/');
      done(r.token);
    } catch (e) { err.textContent = e.message; $('[data-go]', card).disabled = false; }
  };
}
