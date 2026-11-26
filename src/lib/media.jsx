// Images du site : valeur choisie dans l'admin si elle existe, sinon visuel
// provisoire défini dans config.js (MEDIA_SLOTS).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { MEDIA_SLOTS } from '../config.js';
import { fetchMedia } from './api.js';

const MediaContext = createContext({ get: () => null, reload: () => {} });
const defaults = Object.fromEntries(MEDIA_SLOTS.map((m) => [m.slot, m]));

// Les photos choisies dans l'admin arrivent du serveur un instant après l'affichage de la page.
// Pour ne jamais montrer un visuel par défaut à la place d'une vraie photo :
//  - la liste est demandée dès le chargement du script (avant même l'affichage) ;
//  - la dernière liste reçue est gardée sur l'appareil : visites suivantes = vraies photos d'emblée ;
//  - en attendant, fond neutre (pas de visuel par défaut) ; au-delà de 3 s sans réponse, visuels par défaut.
import { comfortAllowed } from './consent.js';

const CACHE_KEY = 'eman-media-v1';
const WAIT_MS = 3000;
const readCache = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return c && c.media && Date.now() - c.at < 30 * 24 * 3600 * 1000 ? c.media : null;
  } catch { return null; }
};
const writeCache = (media) => { if (!comfortAllowed()) return; try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), media })); } catch { /* stockage indisponible */ } };
let early = null;
const firstFetch = () => (early ||= fetchMedia());
if (typeof window !== 'undefined') firstFetch().catch(() => {});

export function MediaProvider({ children }) {
  const [cached] = useState(readCache);
  const [custom, setCustom] = useState(cached || {});
  // 'ready' : liste connue (serveur ou mémoire de l'appareil) ; 'wait' : en attente ; 'late' : serveur trop lent
  const [state, setState] = useState(cached ? 'ready' : 'wait');
  const apply = useCallback((m) => { setCustom(m); setState('ready'); writeCache(m); }, []);
  const reload = useCallback(() => {
    fetchMedia().then(apply).catch(() => setState((s) => (s === 'wait' ? 'late' : s)));
  }, [apply]);
  useEffect(() => {
    let live = true;
    firstFetch().then((m) => live && apply(m)).catch(() => live && setState((s) => (s === 'wait' ? 'late' : s)));
    const t = setTimeout(() => live && setState((s) => (s === 'wait' ? 'late' : s)), WAIT_MS);
    return () => { live = false; clearTimeout(t); };
  }, [apply]);

  const value = useMemo(() => ({
    reload,
    /** `fallback` = visuel provisoire pour les emplacements créés à partir du catalogue. */
    get(slot, fallback) {
      const d = defaults[slot];
      const fb = d?.fallback || fallback;
      const c = custom[slot];
      if (c) return { url: c.url, alt: c.alt || d?.alt || '', placeholder: false, fallback: fb, srcset: c.srcset, focus: c.focus, focus_mobile: c.focus_mobile };
      // Liste pas encore reçue : on ne sait pas encore s'il y a une vraie photo → fond neutre.
      if (state === 'wait' && fb) return { url: null, alt: d?.alt || '', placeholder: true, pending: true, fallback: fb };
      if (fb) return { url: fb, alt: d?.alt || '', placeholder: true, fallback: fb };
      return null;
    },
  }), [custom, reload, state]);

  return <MediaContext.Provider value={value}>{children}</MediaContext.Provider>;
}

export const useMedia = () => useContext(MediaContext);
