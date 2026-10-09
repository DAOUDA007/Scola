// Accès à l'API REST du serveur Scola.
const KEY = 'scola.token';
// Adresse du serveur (config.js) : vide = même adresse que le site.
export const BACKEND = (typeof self !== 'undefined' && self.SCOLA_BACKEND) || '';

export const token = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(t) { try { localStorage.setItem(KEY, t); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(method, url, body) {
  const headers = {};
  const t = token.get();
  if (t) headers.Authorization = 'Bearer ' + t;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(BACKEND + '/api' + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    const e = new Error('Pas de connexion Internet. Réessayez quand le réseau revient.');
    e.offline = true;
    throw e;
  }
  const data = await r.json().catch(() => ({}));
  // Réponse gardée sur l'appareil (service worker) : l'application reste utilisable hors connexion.
  if (r.headers.get('X-Scola-Offline') && data && typeof data === 'object' && !Array.isArray(data)) data.__offline = true;
  if (r.status === 401 && t) onUnauthorized();
  if (!r.ok) {
    const e = new Error(data.error || 'Une erreur est survenue.');
    if (r.headers.get('X-Scola-Offline')) e.offline = true;
    throw e;
  }
  return data;
}

export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const del = (u) => api('DELETE', u);

// Envoi de fichier avec progression.
export function upload(file, onProgress = () => {}, name) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file, name || file.name || 'fichier');
    const x = new XMLHttpRequest();
    x.open('POST', BACKEND + '/api/upload');
    const t = token.get();
    if (t) x.setRequestHeader('Authorization', 'Bearer ' + t);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let d = {};
      try { d = JSON.parse(x.responseText); } catch {}
      x.status < 300 ? resolve(d) : reject(new Error(d.error || 'Échec de l\'envoi du fichier.'));
    };
    x.onerror = () => reject(new Error('Échec de l\'envoi du fichier.'));
    x.send(fd);
  });
}

// Téléchargement authentifié (exports).
export async function downloadAuth(url, fallbackName) {
  const r = await fetch(BACKEND + '/api' + url, { headers: { Authorization: 'Bearer ' + token.get() } });
  if (!r.ok) throw new Error('Téléchargement impossible.');
  const cd = r.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="([^"]+)"/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
