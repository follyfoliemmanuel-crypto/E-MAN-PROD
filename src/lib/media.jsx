// Images du site : valeur choisie dans l'admin si elle existe, sinon visuel
// provisoire défini dans config.js (MEDIA_SLOTS).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { MEDIA_SLOTS } from '../config.js';
import { fetchMedia } from './api.js';

const MediaContext = createContext({ get: () => null, reload: () => {} });
const defaults = Object.fromEntries(MEDIA_SLOTS.map((m) => [m.slot, m]));

export function MediaProvider({ children }) {
  const [custom, setCustom] = useState({});
  const reload = useCallback(() => {
    fetchMedia().then(setCustom).catch(() => setCustom({}));
  }, []);
  useEffect(reload, [reload]);

  const value = useMemo(() => ({
    reload,
    /** `fallback` = visuel provisoire pour les emplacements créés à partir du catalogue. */
    get(slot, fallback) {
      const d = defaults[slot];
      const fb = d?.fallback || fallback;
      const c = custom[slot];
      if (c) return { url: c.url, alt: c.alt || d?.alt || '', placeholder: false, fallback: fb };
      if (fb) return { url: fb, alt: d?.alt || '', placeholder: true, fallback: fb };
      return null;
    },
  }), [custom, reload]);

  return <MediaContext.Provider value={value}>{children}</MediaContext.Provider>;
}

export const useMedia = () => useContext(MediaContext);
