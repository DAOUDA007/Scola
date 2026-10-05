// Rendu HTML des messages.
import { esc, icon, avatar, formatText, isJumbo, hhmm, dayLabel, fileSize, extOf, docKind, duration, osmTile, monthShort, fullDate } from './util.js';
import { S, user, displayName, chatTitle } from './state.js';
import { nameColor } from './ui.js';
import { tickIcon } from './chatlist.js';
import { voiceState } from './media.js';

const KIND = { cours: ['Cours', ''], devoir: ['Devoir', 'warn'], examen: ['Examen', 'red'], reunion: ['Réunion', ''], sortie: ['Sortie', ''], autre: ['Évènement', ''] };

export function sameGroup(a, b) {
  if (!a || !b) return false;
  if (a.type === 'system' || b.type === 'system') return false;
  if (a.senderId !== b.senderId) return false;
  if (dayLabel(a.createdAt) !== dayLabel(b.createdAt)) return false;
  return b.createdAt - a.createdAt < 5 * 60e3;
}

export function quoteHTML(r, { label } = {}) {
  if (!r) return '';
  const color = r.senderId === S.me.id ? 'var(--brand)' : nameColor(r.senderId);
  return `<div class="quote" data-jump="${esc(r.id || '')}" style="--qc:${color}"><div class="q"><b>${esc(label || displayName(r.senderId))}</b><span>${esc(r.text || '')}</span></div>${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : ''}</div>`;
}

function meta(m, over = false) {
  const mine = m.senderId === S.me.id;
  return `<span class="meta ${over ? 'over' : ''}">${m.expiresAt ? icon('timer', 'xs') : ''}${m.starred ? icon('starFill', 'xs') : ''}${m.pinned ? icon('thumbtack', 'xs') : ''}${m.editedAt ? '<span>Modifié</span>' : ''}<span>${hhmm(m.createdAt)}</span>${mine ? tickIcon(m.status) : ''}</span>`;
}

function textBlock(m) {
  return `<div class="text">${formatText(m.text, { mentions: m.mentions, nameOf: (id) => user(id).name })}</div>`;
}

function waveHTML(wave = [], n = 40) {
  const w = wave.length ? wave : Array.from({ length: n }, (_, i) => 0.25 + 0.5 * Math.abs(Math.sin(i * 1.7)));
  return w.map(v => `<i style="height:${Math.max(10, Math.round(v * 100))}%"></i>`).join('');
}

function mediaHTML(m) {
  const md = m.media || {};
  const pending = m.status === 'pending' && m.progress !== undefined;
  const up = pending ? `<div class="uploading">${Math.round((m.progress || 0) * 100)} %</div>` : '';
  if (m.viewOnce) {
    if (m.senderId === S.me.id || m.opened) {
      return `<div class="once opened"><span class="once-ic">1</span>${m.opened ? 'Ouvert' : m.type === 'voice' ? 'Message vocal à écoute unique' : m.type === 'video' ? 'Vidéo à vue unique' : 'Photo à vue unique'}</div>`;
    }
    return `<div class="once" data-once><span class="once-ic">1</span>${m.type === 'voice' ? 'Message vocal' : m.type === 'video' ? 'Vidéo' : 'Photo'}</div>`;
  }
  switch (m.type) {
    case 'image': {
      const ratio = md.width && md.height ? Math.min(1.4, md.height / md.width) : 0.75;
      return `<div class="media" data-view style="aspect-ratio:${(1 / ratio).toFixed(3)}"><img src="${esc(md.url)}" alt="" loading="lazy">${up}</div>`;
    }
    case 'video':
      return `<div class="media" data-view><video src="${esc(md.url)}#t=0.1" preload="metadata" muted playsinline></video>
        <div class="play"><span>${icon('play')}</span></div><div class="dur">${icon('video', 'xs')} ${duration(md.duration)}</div>${up}</div>`;
    case 'voice':
    case 'audio': {
      const st = voiceState(m.id);
      const voice = m.type === 'voice';
      const sender = user(m.senderId);
      return `<div class="voice" data-vid="${esc(m.id)}" data-url="${esc(md.url)}" data-dur="${md.duration || 0}">
          ${voice ? `<div class="vav">${avatar(sender, 44)}<span class="mic">${icon('mic', 'xs')}</span></div>` : `<div class="av" style="--s:44px;background:#f0a020">${icon('speaker')}</div>`}
          <button class="pp" aria-label="Lire">${icon(st && !st.audio.paused ? 'pause' : 'play')}</button>
          <div class="wave">${waveHTML(md.waveform)}</div>
        </div>
        <div class="voice-foot"><span>${duration(md.duration)}</span>${!voice ? `<small class="ellipsis" style="max-width:150px">${esc(md.name)}</small>` : ''}<b class="speed" data-speed ${st ? '' : 'hidden'}>${st?.rate || 1}×</b></div>${up}`;
    }
    case 'document': {
      const k = docKind(md.name);
      return `<a class="doc" href="${esc(md.url)}" download="${esc(md.name)}" target="_blank" rel="noopener">
        <span class="ext ${k === 'pdf' ? '' : k}">${esc(extOf(md.name).slice(0, 4))}</span>
        <span class="info"><b>${esc(md.name)}</b><small>${esc(extOf(md.name).toUpperCase())} · ${fileSize(md.size)}${pending ? ` · ${Math.round((m.progress || 0) * 100)} %` : ''}</small></span>
        ${icon('download')}</a>`;
    }
  }
  return '';
}

function locationHTML(m) {
  const l = m.location;
  const t = osmTile(l.lat, l.lng);
  const liveOn = l.live && l.liveUntil > Date.now();
  return `<div class="loc" data-loc>
    <div class="map"><img src="${t.url}" alt="" style="left:calc(50% - ${Math.round(t.fx * 256)}px);top:calc(50% - ${Math.round(t.fy * 256)}px)" referrerpolicy="no-referrer" loading="lazy">
      <span class="pin">${icon('pin')}</span></div>
    <div class="cap">${l.live ? `<div class="live">${liveOn ? `● Position en direct jusqu'à ${hhmm(l.liveUntil)}` : 'Position en direct terminée'}</div>` : ''}
      ${l.label ? `<div>${esc(l.label)}</div>` : ''}<small class="faint">${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}</small>
      ${liveOn && m.senderId === S.me.id ? '<div><button class="btn text danger" data-stoplive style="padding:0;height:28px">Arrêter le partage</button></div>' : ''}</div></div>`;
}

function contactHTML(m) {
  const c = m.contact;
  const u = S.members.get(c.userId) || { id: c.userId, name: c.name };
  return `<div class="contact-card"><div class="row">${avatar(u, 46)}<div class="grow"><b>${esc(c.name)}</b>${c.phone ? `<div class="faint" style="font-size:13px">${esc(c.phone)}</div>` : ''}</div></div>
    <div class="actions">${c.userId !== S.me.id ? `<button data-contact-msg="${esc(c.userId)}">Écrire</button>` : ''}<button data-contact-view="${esc(c.userId)}">Voir le profil</button></div></div>`;
}

function pollHTML(m) {
  const p = m.poll;
  const total = new Set(p.options.flatMap(o => o.votes)).size;
  const max = Math.max(1, ...p.options.map(o => o.votes.length));
  return `<div class="poll ${p.multiple ? 'multi' : ''}">
    <h4>${esc(p.question)}</h4>
    <div class="sub">${icon('poll', 'xs')} ${p.multiple ? 'Choisissez une ou plusieurs options' : 'Choisissez une option'}</div>
    ${p.options.map(o => {
      const on = o.votes.includes(S.me.id);
      return `<div class="opt ${on ? 'on' : ''}" data-vote="${esc(o.id)}"><span class="box">${on ? icon('check', 'xs') : ''}</span><span>${esc(o.text)}</span>
        <span class="n">${o.votes.length}</span><span class="bar"><i style="width:${(o.votes.length / max) * 100}%"></i></span></div>`;
    }).join('')}
    <button class="votes" data-votes>Voir les votes (${total})</button></div>`;
}

function eventHTML(m) {
  const e = m.event;
  const d = new Date(e.startsAt);
  const r = e.responses || {};
  const mine = r[S.me.id];
  const count = (k) => Object.values(r).filter(x => x === k).length;
  const [label, cls] = KIND[e.kind] || KIND.autre;
  const past = (e.endsAt || e.startsAt) < Date.now();
  return `<div class="event">
    <div class="ev-head"><div class="cal"><small>${monthShort(e.startsAt)}</small><b>${d.getDate()}</b></div>
      <div class="grow"><span class="tag ${cls}">${label}</span><h4>${esc(e.title)}</h4>
      <div class="when">${esc(fullDate(e.startsAt))}${e.endsAt ? ` → ${hhmm(e.endsAt)}` : ''}${past ? ' · <i>passé</i>' : ''}</div>
      ${e.place ? `<div class="when">${icon('pin', 'xs')} ${esc(e.place)}</div>` : ''}</div></div>
    ${e.description ? `<div class="desc">${esc(e.description)}</div>` : ''}
    <div class="rsvp">
      <button data-rsvp="going" class="${mine === 'going' ? 'on' : ''}">Présent (${count('going')})</button>
      <button data-rsvp="maybe" class="${mine === 'maybe' ? 'on' : ''}">Peut-être (${count('maybe')})</button>
      <button data-rsvp="notgoing" class="${mine === 'notgoing' ? 'on' : ''}">Absent (${count('notgoing')})</button>
    </div>
    <button class="votes" data-ics style="border-top:1px solid rgba(127,127,127,.2);width:100%;padding:8px 0 2px;color:var(--brand);font-weight:500;font-size:14px">Ajouter à mon agenda</button></div>`;
}

function reactionsHTML(m) {
  const r = Object.values(m.reactions || {});
  if (!r.length) return '';
  const counts = {};
  r.forEach(e => (counts[e] = (counts[e] || 0) + 1));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]).join('');
  return `<div class="reactions" data-reactions>${top}${r.length > 1 ? `<small>${r.length}</small>` : ''}</div>`;
}

export function msgHTML(m, prev, chat) {
  if (m.type === 'system' && m.meta?.announce) {
    return `<div class="sys announce" data-id="${esc(m.id)}"><b>${icon('megaphone', 'sm')} Annonce de l'administration Scola</b><div class="text">${formatText(m.text)}</div><small>${esc(m.meta.by || '')} · ${hhmm(m.createdAt)}</small></div>`;
  }
  if (m.type === 'system') return `<div class="sys" data-id="${esc(m.id)}">${esc(m.text)}</div>`;
  const mine = m.senderId === S.me.id;
  const first = !sameGroup(prev, m);
  const group = chat?.type === 'group';
  const hasReact = !m.deleted && Object.keys(m.reactions || {}).length > 0;
  let inner = '';
  let bubbleCls = '';
  if (group && !mine && first) {
    const u = user(m.senderId);
    inner += `<div class="sender" data-profile="${esc(m.senderId)}" style="color:${nameColor(m.senderId)}">${esc(u.name)}</div>`;
  }
  if (m.deleted) {
    inner += `<div class="deleted-text">${icon('ban', 'sm')} ${mine ? 'Vous avez supprimé ce message' : 'Ce message a été supprimé'}</div>${meta(m)}`;
  } else {
    if (m.forwarded) inner += `<div class="fwd">${icon('forward', 'xs')} ${m.frequentlyForwarded ? 'Transféré plusieurs fois' : 'Transféré'}</div>`;
    if (m.statusRef) {
      const s = m.statusRef;
      inner += `<div class="status-reply">${icon('status', 'xs')} Réponse au statut</div><div class="quote" style="--qc:var(--brand)"><div class="q"><b>${esc(s.ownerId === S.me.id ? 'Vous' : user(s.ownerId).name)} · Statut</b><span>${esc(s.text || (s.type === 'image' ? '📷 Photo' : s.type === 'video' ? '🎥 Vidéo' : ''))}</span></div>${s.thumb ? `<img src="${esc(s.thumb)}">` : s.type === 'text' ? `<div class="sw" style="background:${esc(s.bg)}">${esc((s.text || '').slice(0, 30))}</div>` : ''}</div>`;
    }
    if (m.replyTo) inner += quoteHTML(m.replyTo);
    switch (m.type) {
      case 'text':
      case 'sticker':
        if (m.linkPreview) {
          const lp = m.linkPreview;
          inner += `<a class="lp" href="${esc(lp.url)}" target="_blank" rel="noopener noreferrer">${lp.image ? `<img src="${esc(lp.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<div><b>${esc(lp.title)}</b>${lp.description ? `<p>${esc(lp.description)}</p>` : ''}<small>${esc(lp.site)}</small></div></a>`;
        }
        if (!m.replyTo && !m.linkPreview && !m.forwarded && isJumbo(m.text)) bubbleCls = 'jumbo';
        inner += textBlock(m) + meta(m);
        break;
      case 'image':
      case 'video': {
        const caption = m.text && !m.viewOnce;
        if (!caption && !m.replyTo && !m.forwarded && !(group && !mine && first) && !m.viewOnce) bubbleCls = 'media-only over-media';
        inner += mediaHTML(m) + (caption ? textBlock(m) + meta(m) : (bubbleCls ? meta(m, true) : meta(m)));
        break;
      }
      case 'voice': case 'audio': case 'document':
        inner += mediaHTML(m) + (m.text && m.type === 'document' ? textBlock(m) : '') + meta(m);
        break;
      case 'location': inner += locationHTML(m) + meta(m); break;
      case 'contact': inner += contactHTML(m) + meta(m); break;
      case 'poll': inner += pollHTML(m) + meta(m); break;
      case 'event': inner += eventHTML(m) + meta(m); break;
      default: inner += textBlock(m) + meta(m);
    }
  }
  return `<div class="msg ${mine ? 'out' : 'in'} ${first ? 'first' : ''} ${hasReact ? 'has-react' : ''}" data-id="${esc(m.id)}">
    <span class="selbox check">${icon('check', 'xs')}</span>
    <div class="bubble-wrap">
      <div class="bubble ${bubbleCls}">${inner}${m.status !== 'pending' ? `<button class="chev" data-menu aria-label="Options">${icon('chevD', 'sm')}</button>` : ''}</div>
      ${!m.deleted && m.status !== 'pending' ? `<button class="react-btn" data-react aria-label="Réagir">${icon('smile', 'sm')}</button>` : ''}
      ${hasReact ? reactionsHTML(m) : ''}
    </div></div>`;
}

export function daySep(t) { return `<div class="day-sep">${esc(dayLabel(t))}</div>`; }

export function eventIcs(m) {
  const e = m.event;
  const f = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc2 = (s) => String(s || '').replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Scola//FR', 'BEGIN:VEVENT', `UID:${m.id}@scola`, `DTSTAMP:${f(Date.now())}`,
    `DTSTART:${f(e.startsAt)}`, `DTEND:${f(e.endsAt || e.startsAt + 3600e3)}`, `SUMMARY:${esc2(e.title)}`, `DESCRIPTION:${esc2(e.description)}`,
    `LOCATION:${esc2(e.place)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export { chatTitle };
