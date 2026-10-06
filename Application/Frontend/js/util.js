// Utilitaires d'interface : icônes, échappement, formats de date, mise en forme du texte.

const P = {
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  status: '<circle cx="12" cy="12" r="9.5" stroke-dasharray="4.5 2.6"/><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  phoneOff: '<g transform="rotate(135 12 12)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></g>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  videoOff: '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.25-3.06a.5.5 0 0 1 .75.43v8.2"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
  more: '<circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  send: '<path d="M3.4 20.4 21 12 3.4 3.6 3.4 10 15 12 3.4 14z" fill="currentColor" stroke="none"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  micOff: '<path d="m2 2 20 20"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M12 19v3"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  poll: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  check2: '<path d="M17 6.5 6.5 17 2 12.5"/><path d="m22 6.5-10.5 10.5-1.5-1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  starFill: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
  thumbtack: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  forward: '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  flip: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  timer: '<path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  laptop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21h.01M17.5 17.5H21V21h-3.5z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  cap: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/><path d="M22 10v6"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  arrowIn: '<path d="M17 7 7 17"/><path d="M17 17H7V7"/>',
  arrowOut: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  flash: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  flashOff: '<path d="M16.5 10.5 21 10h-9"/><path d="M13 2 9.6 6.1"/><path d="M7.3 9 3 14h9l-1 8 4.3-5.2"/><path d="m2 2 20 20"/>',
  sticker: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/><path d="M8 13h.01M16 13h.01"/><path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1"/>',
  gif: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 10H8.5a1.5 1.5 0 0 0 0 3H10v-1.5H9"/><path d="M13 10v4"/><path d="M16 14v-4h2.5M16 12h2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  checkSq: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>',
  speaker: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  unread: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  wall: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>',
  textSize: '<path d="M4 7V4h10v3"/><path d="M9 4v16"/><path d="M7 20h4"/><path d="M15 13v-2h6v2"/><path d="M18 11v9"/><path d="M16.5 20h3"/>',
  enter: '<path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Met à jour un conteneur en conservant les éléments inchangés (repérés par
// data-key / data-chat / data-uid / data-id) : évite de perdre un clic en cours.
export function morph(container, html) {
  if (container._html === html) return;
  container._html = html;
  const t = document.createElement('template');
  t.innerHTML = html;
  const key = (n) => n.dataset?.key || (n.dataset?.chat && 'c' + n.dataset.chat + (n.dataset.around || '')) || (n.dataset?.uid && 'u' + n.dataset.uid) || (n.dataset?.id && 'i' + n.dataset.id);
  const old = new Map();
  for (const c of container.children) { const k = key(c); if (k) old.set(k, c); }
  const next = [...t.content.children].map(n => {
    const k = key(n);
    const o = k && old.get(k);
    if (o && o.outerHTML === n.outerHTML) { old.delete(k); return o; }
    return n;
  });
  const cur = [...container.children];
  if (cur.length === next.length && cur.every((c, i) => c === next[i])) return;
  container.replaceChildren(...next);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

/* ---------- Dates ---------- */
const pad = n => String(n).padStart(2, '0');
export function hhmm(t) { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function listTime(t) {
  if (!t) return '';
  const d = new Date(t), n = new Date();
  if (sameDay(d, n)) return hhmm(t);
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return 'Hier';
  if (n - d < 6 * 86400e3) return DAYS[d.getDay()];
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function dayLabel(t) {
  const d = new Date(t), n = new Date();
  if (sameDay(d, n)) return "Aujourd'hui";
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return 'Hier';
  if (n - d < 6 * 86400e3) return DAYS[d.getDay()][0].toUpperCase() + DAYS[d.getDay()].slice(1);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function fullDate(t) {
  const d = new Date(t);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} à ${hhmm(t)}`;
}
export function shortDate(t) { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 4)}.`; }
export function monthShort(t) { return MONTHS[new Date(t).getMonth()].slice(0, 3); }
export function lastSeenText(u) {
  if (!u) return '';
  if (u.online) return 'en ligne';
  if (!u.lastSeen) return '';
  const d = new Date(u.lastSeen), n = new Date();
  if (sameDay(d, n)) return `vu(e) aujourd'hui à ${hhmm(u.lastSeen)}`;
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return `vu(e) hier à ${hhmm(u.lastSeen)}`;
  return `vu(e) le ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} à ${hhmm(u.lastSeen)}`;
}
export function relTime(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `aujourd'hui à ${hhmm(t)}`;
  return `hier à ${hhmm(t)}`;
}
export function duration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
export function fileSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' o';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' Ko';
  if (n < 1073741824) return (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  return (n / 1073741824).toFixed(1).replace('.', ',') + ' Go';
}

/* ---------- Couleurs & avatars ---------- */
const COLORS = ['#EA580C', '#1f77b4', '#7c3aed', '#c2410c', '#be185d', '#0369a1', '#4d7c0f', '#b45309', '#6d28d9', '#EA580C', '#9333ea', '#dc2626', '#2563eb', '#059669'];
export function colorFor(id) {
  let x = 0;
  for (const c of String(id || '')) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[x % COLORS.length];
}
export function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}
export function avatar(entity, size = 49, opts = {}) {
  const s = `--s:${size}px`;
  if (!entity) return `<div class="av" style="${s};background:#9aa5a2">${icon('user')}</div>`;
  if (entity.avatar || entity.icon) return `<div class="av" style="${s}"><img src="${esc(entity.avatar || entity.icon)}" alt="" loading="lazy"></div>`;
  if (opts.group) return `<div class="av" style="${s};background:${colorFor(entity.id)}">${icon('cap')}</div>`;
  if (opts.broadcast) return `<div class="av" style="${s};background:#6b7a78">${icon('megaphone')}</div>`;
  if (entity.deleted) return `<div class="av" style="${s};background:#9aa5a2">${icon('user')}</div>`;
  return `<div class="av" style="${s};background:${colorFor(entity.id)}">${esc(initials(entity.name))}</div>`;
}

/* ---------- Mise en forme des messages (comme WhatsApp) ---------- */
const URL_RE = /\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"»])/gi;

function inline(s) {
  return s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/(^|[\s(>«"'])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s.,!?;:)<»"'])/g, '$1<b>$2</b>')
    .replace(/(^|[\s(>«"'])_(?=\S)([^_\n]*?\S)_(?=$|[\s.,!?;:)<»"'])/g, '$1<i>$2</i>')
    .replace(/(^|[\s(>«"'])~(?=\S)([^~\n]*?\S)~(?=$|[\s.,!?;:)<»"'])/g, '$1<s>$2</s>');
}

export function formatText(text, { mentions = [], nameOf = () => '' } = {}) {
  const src = String(text || '');
  const blocks = src.split(/```/);
  let out = '';
  blocks.forEach((part, i) => {
    if (i % 2 === 1 && i < blocks.length - 1) { out += `<code class="mono">${esc(part.replace(/^\n|\n$/g, ''))}</code>`; return; }
    if (i % 2 === 1) part = '```' + part;
    const lines = part.split('\n').map(line => {
      let seg = '';
      let last = 0;
      line.replace(URL_RE, (m, _u, idx) => {
        seg += inline(esc(line.slice(last, idx)));
        seg += `<a href="${esc(m)}" target="_blank" rel="noopener noreferrer">${esc(m)}</a>`;
        last = idx + m.length;
        return m;
      });
      seg += inline(esc(line.slice(last)));
      if (/^&gt; /.test(seg)) seg = `<blockquote>${seg.slice(5)}</blockquote>`;
      else if (/^[-*•] /.test(line)) seg = '• ' + seg.slice(2);
      return seg;
    });
    out += lines.join('\n').replace(/<\/blockquote>\n/g, '</blockquote>');
  });
  for (const id of mentions) {
    const n = nameOf(id);
    if (!n) continue;
    const tag = '@' + esc(n);
    out = out.split(tag).join(`<span class="mention" data-uid="${esc(id)}">${tag}</span>`);
  }
  return out;
}

export function stripFormat(s) { return String(s || '').replace(/```/g, '').replace(/(^|[\s(«"'])[*_~](\S[^*_~\n]*?\S|\S)[*_~](?=$|[\s.,!?;:)»"'])/g, '$1$2'); }

export function isJumbo(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 24) return false;
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t)) return false;
  const n = [...new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(t.replace(/\s/g, ''))].length;
  return n > 0 && n <= 3;
}

export function extOf(name) { return (String(name || '').split('.').pop() || '').toLowerCase().slice(0, 5); }
export function docKind(name) {
  const e = extOf(name);
  if (e === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(e)) return 'word';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(e)) return 'xls';
  if (['ppt', 'pptx', 'odp'].includes(e)) return 'ppt';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'zip';
  return 'other';
}

// Ouvre le sélecteur de fichiers (l'input est attaché au document : requis sur iOS).
export function pickFiles({ accept = '', multiple = false, capture = '' } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    if (multiple) inp.multiple = true;
    if (capture) inp.setAttribute('capture', capture);
    inp.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.append(inp);
    inp.onchange = () => { resolve(inp.files?.length ? [...inp.files] : null); inp.remove(); };
    inp.oncancel = () => { resolve(null); inp.remove(); };
    inp.click();
  });
}

export function copyText(t) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(t);
  const ta = document.createElement('textarea');
  ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  return Promise.resolve();
}

export function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name || ''; document.body.append(a); a.click(); a.remove();
}

// Tuile OpenStreetMap pour l'aperçu d'une position (sans clé d'API).
export function osmTile(lat, lng, z = 15) {
  const n = 2 ** z;
  const x = (lng + 180) / 360 * n;
  const r = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  const tx = Math.floor(x), ty = Math.floor(y);
  return { url: `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`, fx: x - tx, fy: y - ty };
}
