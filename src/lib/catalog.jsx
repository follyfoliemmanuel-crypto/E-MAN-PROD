// Catalogue du site (prestations, pôles, formations, réalisations, textes),
// chargé une fois depuis /api/catalog puis partagé par toutes les pages.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchCatalog } from './api.js';

const CatalogContext = createContext(null);
const EMPTY = { prestations: [], poles: [], courses: [], gallery: [], galleryCategories: [], testimonials: [], content: {} };

export function CatalogProvider({ children, onContent }) {
  const [state, setState] = useState({ status: 'loading', data: EMPTY, error: '' });

  const reload = useCallback(async () => {
    try {
      const data = await fetchCatalog();
      onContent?.(data.content || {});
      setState({ status: 'ready', data: { ...EMPTY, ...data }, error: '' });
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: e.message }));
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
