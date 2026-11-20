// Temps réel côté navigateur : un flux SSE (/api/inbox?stream=1) tant que la page est visible.
// - reconnexion automatique (le navigateur, puis une relance maison si la connexion est refusée) ;
// - reprise sans perte grâce au dernier identifiant reçu ;
// - aucun doublon : chaque notification n'est signalée qu'une fois ;
// - en secours (navigateur sans EventSource ou flux indisponible), relecture toutes les 20 s.
import { useEffect } from 'react';
import { DEMO } from './api.js';

export const LIVE_EVENT = 'eman:live';
const HIDDEN_GRACE_MS = 30000;

export function startLive({ onUnread, onNotification, onFallbackPoll }) {
  if (DEMO || typeof window === 'undefined') return () => {};
  let es = null; let stopped = false; let lastId = ''; let retryTimer = null; let hideTimer = null; let pollTimer = null;
  let failures = 0;
  const seen = new Set();

  const startPolling = () => { if (!pollTimer) pollTimer = setInterval(() => { if (document.visibilityState === 'visible') onFallbackPoll?.(); }, 20000); };
  const stopPolling = () => { clearInterval(pollTimer); pollTimer = null; };

  function open() {
    if (stopped || es || document.visibilityState !== 'visible') return;
    if (typeof EventSource === 'undefined') { startPolling(); return; }
    const url = `/api/inbox?stream=1${lastId ? `&since=${encodeURIComponent(lastId)}` : ''}`;
    es = new EventSource(url, { withCredentials: true });
    es.addEventListener('hello', (e) => {
      failures = 0; stopPolling();
      try { onUnread?.(JSON.parse(e.data).unread); } catch { /* message illisible : ignoré */ }
      // Rattrapage de ce qui a pu arriver pendant la coupure.
      onFallbackPoll?.();
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
  const onOnline = () => { close(); open(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  open();
  return () => {
    stopped = true; close(); stopPolling(); clearTimeout(retryTimer); clearTimeout(hideTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}

/** Recharge une donnée dès qu'une notification qui la concerne arrive (ex. nouveau message). */
export function onLive(test, fn) {
  const h = (e) => { if (test(e.detail)) fn(e.detail); };
  window.addEventListener(LIVE_EVENT, h);
  return () => window.removeEventListener(LIVE_EVENT, h);
}

/** Hook React : relance `fn` quand une notification correspondante arrive. */
export function useLive(test, fn, deps = []) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onLive(test, fn), deps);
}
