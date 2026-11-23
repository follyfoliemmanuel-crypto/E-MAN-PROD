// Temps réel côté navigateur : un flux SSE (/api/inbox?stream=1) tant que la page est visible.
// - reconnexion automatique (le navigateur, puis une relance maison si la connexion est refusée) ;
// - reprise sans perte grâce au dernier identifiant reçu ;
// - aucun doublon : chaque notification n'est signalée qu'une fois ;
// - en secours (navigateur sans EventSource ou flux indisponible), relecture toutes les 20 s.
import { useEffect } from 'react';
import { DEMO } from './api.js';

export const LIVE_EVENT = 'eman:live';
// Messagerie : conversations qui ont bougé, « écrit un message… », présence.
export const CHAT_EVENT = 'eman:chat';
const HIDDEN_GRACE_MS = 30000;
/** Dernier état connu (pour un écran ouvert après l'évènement). */
export const chatState = { typing: [], online: new Set(), teamOnline: false, presenceKnown: false };
const chatEmit = (detail) => window.dispatchEvent(new CustomEvent(CHAT_EVENT, { detail }));
/** Identifiant de cette connexion (un onglet) : la présence compte chaque appareil séparément. */
const CONN_ID = (() => {
  try { return crypto.randomUUID().replace(/-/g, '').slice(0, 24); } catch { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
})();

export function startLive({ onUnread, onNotification, onFallbackPoll }) {
  if (DEMO || typeof window === 'undefined') return () => {};
  let es = null; let stopped = false; let lastId = ''; let retryTimer = null; let hideTimer = null; let pollTimer = null;
  let failures = 0; let connectedOnce = false;
  const seen = new Set();
  // Après une coupure ou un retour sur l'onglet : tout ce qui est affiché se relit une fois
  // (un rechargement a pu échouer pendant la coupure, et ce qui est déjà vu n'est pas renvoyé).
  const resync = () => { window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: { kind: 'resync' } })); chatEmit({ type: 'resync' }); };

  const startPolling = () => { if (!pollTimer) pollTimer = setInterval(() => { if (document.visibilityState === 'visible') onFallbackPoll?.(); }, 20000); };
  const stopPolling = () => { clearInterval(pollTimer); pollTimer = null; };

  function open() {
    if (stopped || es || document.visibilityState !== 'visible') return;
    if (typeof EventSource === 'undefined') { startPolling(); return; }
    const url = `/api/inbox?stream=1&conn=${CONN_ID}${lastId ? `&since=${encodeURIComponent(lastId)}` : ''}`;
    es = new EventSource(url, { withCredentials: true });
    es.addEventListener('hello', (e) => {
      failures = 0; stopPolling();
      try { onUnread?.(JSON.parse(e.data).unread); } catch { /* message illisible : ignoré */ }
      // Rattrapage de ce qui a pu arriver pendant la coupure.
      onFallbackPoll?.();
      if (connectedOnce) resync();
      connectedOnce = true;
    });
    es.addEventListener('notification', (e) => {
      if (e.lastEventId) lastId = e.lastEventId;
      let n; try { n = JSON.parse(e.data); } catch { return; }
      if (seen.has(n.id)) return;
      seen.add(n.id);
      if (seen.size > 500) seen.delete(seen.values().next().value);
      onUnread?.(n.unread);
      onNotification?.(n);
      window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: n }));
    });
    es.addEventListener('chat', (e) => { try { chatEmit({ type: 'chat', ...JSON.parse(e.data) }); } catch { /* ignoré */ } });
    es.addEventListener('typing', (e) => {
      try { chatState.typing = JSON.parse(e.data).typing || []; chatEmit({ type: 'typing', typing: chatState.typing }); } catch { /* ignoré */ }
    });
    es.addEventListener('presence', (e) => {
      try {
        const d = JSON.parse(e.data);
        if ('team_online' in d) chatState.teamOnline = Boolean(d.team_online);
        if (d.online) { chatState.online = new Set(d.online); chatState.presenceKnown = true; }
        chatEmit({ type: 'presence', ...d });
      } catch { /* ignoré */ }
    });
    es.addEventListener('bye', () => { close(); stopped = true; });
    es.onerror = () => {
      // Fin normale d'une connexion (durée maximale) : EventSource se reconnecte seul.
      // Connexion refusée (déconnecté, serveur indisponible) : relance espacée + relecture de secours.
      if (es && es.readyState === EventSource.CLOSED) {
        close(); failures += 1; startPolling();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(open, Math.min(30000, 1500 * 2 ** Math.min(failures, 5)));
      }
    };
  }
  function close() { if (es) { es.close(); es = null; } }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') { clearTimeout(hideTimer); open(); onFallbackPoll?.(); }
    else { clearTimeout(hideTimer); hideTimer = setTimeout(close, HIDDEN_GRACE_MS); }
  };
  const onOnline = () => { close(); open(); resync(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  open();
  return () => {
    stopped = true; close(); stopPolling(); clearTimeout(retryTimer); clearTimeout(hideTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}

/** Écoute les évènements de messagerie ({type: 'chat'|'typing'|'presence'|'resync', …}). */
export function onChat(fn) {
  const h = (e) => fn(e.detail || {});
  window.addEventListener(CHAT_EVENT, h);
  return () => window.removeEventListener(CHAT_EVENT, h);
}

/** Recharge une donnée dès qu'une notification qui la concerne arrive (ex. nouveau message). */
export function onLive(test, fn, { resync = true } = {}) {
  const h = (e) => { if (e.detail?.kind === 'resync' ? resync : test(e.detail)) fn(e.detail); };
  window.addEventListener(LIVE_EVENT, h);
  return () => window.removeEventListener(LIVE_EVENT, h);
}

/** Hook React : relance `fn` quand une notification correspondante arrive. */
export function useLive(test, fn, deps = [], options = {}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onLive(test, fn, options), deps);
}
