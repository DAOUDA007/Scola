// Accès à l'API REST du serveur Scola.
const KEY = 'scola.token';

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
    r = await fetch('/api' + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Connexion impossible. Vérifiez votre réseau.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && t) onUnauthorized();
  if (!r.ok) throw new Error(data.error || 'Une erreur est survenue.');
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
    x.open('POST', '/api/upload');
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
  const r = await fetch('/api' + url, { headers: { Authorization: 'Bearer ' + token.get() } });
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
