// Catalogue du site (prestations, pôles, formations, réalisations, textes),
// chargé une fois depuis /api/catalog puis partagé par toutes les pages.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchCatalog } from './api.js';
import { applySettings } from '../config.js';

const CatalogContext = createContext(null);
const EMPTY = { prestations: [], poles: [], courses: [], gallery: [], galleryCategories: [], testimonials: [], content: {} };

// Dernière version reçue, gardée dans le navigateur : un visiteur qui revient voit la page
// tout de suite (sans décalage de mise en page), puis elle est remplacée par la version à jour.
// Ce n'est qu'un confort d'affichage : les places restantes et les prix sont toujours relus.
import { comfortAllowed } from './consent.js';

const CACHE_KEY = 'emp_catalog_v1';
const CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return c && Date.now() - c.at < CACHE_MAX_AGE ? c.data : null;
  } catch { return null; }
}
function writeCache(data) {
  if (!comfortAllowed()) return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* stockage plein ou interdit */ }
}

export function CatalogProvider({ children, onContent }) {
  const [state, setState] = useState(() => {
    const cached = readCache();
    // Coordonnées et numéros en cache appliqués avant le premier affichage (sans re-rendu du parent).
    if (cached) applySettings(cached.content || {});
    return cached ? { status: 'ready', data: { ...EMPTY, ...cached }, error: '', stale: true } : { status: 'loading', data: EMPTY, error: '' };
  });

  const reload = useCallback(async () => {
    try {
      const data = await fetchCatalog();
      onContent?.(data.content || {});
      writeCache(data);
      setState({ status: 'ready', data: { ...EMPTY, ...data }, error: '' });
    } catch (e) {
      // Hors connexion avec une copie récente : on garde l'affichage plutôt qu'une erreur.
      setState((s) => (s.stale ? s : { ...s, status: 'error', error: e.message }));
    }
  }, [onContent]);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo(() => {
    const d = state.data;
    return {
      ...d,
      status: state.status,
      error: state.error,
      reload,
      prestation: (slug) => d.prestations.find((p) => p.slug === slug),
      course: (slug) => d.courses.find((c) => c.slug === slug),
      pole: (slug) => d.poles.find((p) => p.slug === slug),
      coursesOf: (poleSlug) => d.courses.filter((c) => c.pole_slug === poleSlug),
    };
  }, [state, reload]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export const useCatalog = () => useContext(CatalogContext);
