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

  // ------------------------------------------------------------------ Mode de secours rapide
  // Si le flux temps réel ne passe pas (proxy d'opérateur qui le retient, réseau instable), la
  // page relit « ce qui a changé » toutes les 3 s (8 s sur connexion lente) et retente le flux
  // chaque minute. Les messages arrivent donc toujours, sans recharger la page.
  let degraded = false; let pulseTimer = null; let pulseSince = ''; let helloTimer = null; let lastEventAt = 0; let watchdog = null; let lastUnread = null;
  const slow = () => { const c = navigator.connection; return Boolean(c && (c.saveData || /(^|-)(2g|3g)$/.test(c.effectiveType || ''))); };
  const pulseOnce = async () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    try {
      const r = await fetch(`/api/inbox?chat=pulse${pulseSince ? `&since=${encodeURIComponent(pulseSince)}` : ''}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (!r.ok) return;
      const d = await r.json();
      const first = !pulseSince;
      pulseSince = d.at;
      if (!first && d.threads?.length) chatEmit({ type: 'chat', threads: d.threads });
      chatState.typing = d.typing || []; chatEmit({ type: 'typing', typing: chatState.typing });
      if (lastUnread !== null && d.unread !== lastUnread) onFallbackPoll?.();
      lastUnread = d.unread; onUnread?.(d.unread);
    } catch { /* réseau coupé : on réessaie au tour suivant */ }
  };
  const schedulePulse = () => { clearTimeout(pulseTimer); if (degraded && !stopped) pulseTimer = setTimeout(async () => { await pulseOnce(); schedulePulse(); }, slow() ? 8000 : 3000); };
  const degrade = () => {
    if (stopped) return;
    close();
    if (!degraded) { degraded = true; resync(); pulseOnce(); schedulePulse(); }
    // Nouvel essai du flux temps réel dans une minute (il reprend la main s'il passe).
    clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (!stopped) open(); }, 60000);
  };
  const recover = () => { if (!degraded) return; degraded = false; clearTimeout(pulseTimer); pulseSince = ''; };
  const alive = () => { lastEventAt = Date.now(); };

  function open() {
    if (stopped || es || document.visibilityState !== 'visible') return;
    if (typeof EventSource === 'undefined') { startPolling(); return; }
    const url = `/api/inbox?stream=1&conn=${CONN_ID}${lastId ? `&since=${encodeURIComponent(lastId)}` : ''}`;
    es = new EventSource(url, { withCredentials: true });
    // Pas de « bonjour » en 6 s : le flux est retenu quelque part → mode de secours.
    clearTimeout(helloTimer); helloTimer = setTimeout(() => { if (!lastEventAt || Date.now() - lastEventAt > 6000) degrade(); }, 6000);
    es.addEventListener('ping', alive);
    es.addEventListener('hello', (e) => {
      failures = 0; stopPolling(); alive(); clearTimeout(helloTimer); recover();
      try { onUnread?.(JSON.parse(e.data).unread); } catch { /* message illisible : ignoré */ }
      // Rattrapage de ce qui a pu arriver pendant la coupure.
      onFallbackPoll?.();
      if (connectedOnce) resync();
      connectedOnce = true;
    });
    es.addEventListener('notification', (e) => {
      alive();
      if (e.lastEventId) lastId = e.lastEventId;
      let n; try { n = JSON.parse(e.data); } catch { return; }
      if (seen.has(n.id)) return;
      seen.add(n.id);
      if (seen.size > 500) seen.delete(seen.values().next().value);
      onUnread?.(n.unread);
      onNotification?.(n);
      window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: n }));
    });
    es.addEventListener('chat', (e) => { alive(); try { chatEmit({ type: 'chat', ...JSON.parse(e.data) }); } catch { /* ignoré */ } });
    es.addEventListener('typing', (e) => {
      alive();
      try { chatState.typing = JSON.parse(e.data).typing || []; chatEmit({ type: 'typing', typing: chatState.typing }); } catch { /* ignoré */ }
    });
    es.addEventListener('presence', (e) => {
      alive();
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
        retryTimer = setTimeout(open, Math.min(10000, 1000 * 2 ** Math.min(failures, 4)));
        // Deux échecs de suite : on passe en relecture rapide en attendant.
        if (failures >= 2) degrade();
      }
    };
  }
  // Connexion ouverte mais muette depuis 40 s (le serveur envoie un signe de vie toutes les 15 s) :
  // bloquée → on la relance.
  watchdog = setInterval(() => {
    if (es && lastEventAt && Date.now() - lastEventAt > 40000 && document.visibilityState === 'visible') { close(); lastEventAt = 0; open(); }
  }, 10000);
  function close() { if (es) { es.close(); es = null; } }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') { clearTimeout(hideTimer); if (degraded) { pulseOnce(); schedulePulse(); } else open(); onFallbackPoll?.(); }
    else { clearTimeout(hideTimer); hideTimer = setTimeout(close, HIDDEN_GRACE_MS); }
  };
  const onOnline = () => { close(); lastEventAt = 0; open(); resync(); if (degraded) pulseOnce(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  open();
  return () => {
    stopped = true; close(); stopPolling(); clearTimeout(retryTimer); clearTimeout(hideTimer); clearTimeout(pulseTimer); clearTimeout(helloTimer); clearInterval(watchdog);
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
