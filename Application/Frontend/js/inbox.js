// Boîte « Annonces » : annonces de l'administration et avertissements, adressés à chaque élève.
// Accessible depuis l'en-tête des Discussions (à côté du crayon), avec un compteur de non-lus :
// un élève qui revient après une longue absence retrouve toutes les annonces, sans les chercher.
import { esc, icon, fullDate, formatText } from './util.js';
import { get, post } from './api.js';
import { S, emit } from './state.js';
import { pushPage } from './ui.js';

export const INBOX = { items: [], unread: 0, readAt: 0, loaded: false };

export async function loadInbox() {
  try { Object.assign(INBOX, await get('/inbox'), { loaded: true }); emit('inbox'); } catch {}
}

export function badgeHTML() {
  return INBOX.unread ? `<span class="badge">${INBOX.unread > 99 ? '99+' : INBOX.unread}</span>` : '';
}

export function openInbox(side) {
  const seenBefore = INBOX.readAt;
  pushPage(side, {
    title: 'Annonces',
    render: (body) => {
      const draw = () => {
        body.innerHTML = INBOX.items.length ? `<p class="inbox-intro">${icon('lock', 'xs')} Annonces de l'administration de Scola et messages qui vous sont adressés. Ils restent ici même si la discussion de votre classe avance.</p>
          ${INBOX.items.map(x => `<article class="inbox-card ${x.kind} ${x.at > seenBefore ? 'new' : ''}">
            <header>${icon(x.kind === 'warning' ? 'flag' : 'megaphone', 'sm')}<b>${x.kind === 'warning' ? 'Avertissement' : 'Annonce'}</b><span class="grow"></span>${x.at > seenBefore ? '<span class="tag">Nouveau</span>' : ''}</header>
            <div class="inbox-text">${formatText(x.text)}</div>
            <footer>${esc(x.from)} · ${esc(fullDate(x.at))}</footer></article>`).join('')}`
          : `<div class="empty">${icon('megaphone')}Aucune annonce pour le moment.<br><small class="faint">Les annonces de l'administration de Scola apparaîtront ici.</small></div>`;
      };
      draw();
      // Tout est marqué comme lu à l'ouverture.
      if (INBOX.unread) { INBOX.unread = 0; INBOX.readAt = Date.now() + (S.clockSkew || 0); emit('inbox'); post('/inbox/read').catch(() => {}); }
    },
  });
}
