import { useEffect } from 'react';
import { ROUTES, NOT_FOUND, SITE_URL } from '../routes-meta.js';

function setMeta(selector, attr, value) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement(selector.startsWith('link') ? 'link' : 'meta');
    const m = selector.match(/\[(\w+)="([^"]+)"\]/);
    if (m) el.setAttribute(m[1], m[2]);
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

/**
 * Met à jour titre, description et URL canonique. `override` sert aux pages
 * dynamiques (une prestation, une formation) ; `path` à null ne fait rien.
 */
export function useSeo(path, override) {
  const title = override?.title;
  const description = override?.description;
  useEffect(() => {
    if (path === null) return;
    const meta = override ? { ...NOT_FOUND, noindex: false, title, description } : ROUTES[path] || NOT_FOUND;
    const url = SITE_URL + (path === '/' ? '' : path);
    document.title = meta.title;
    setMeta('meta[name="description"]', 'content', meta.description);
    setMeta('meta[property="og:title"]', 'content', meta.title);
    setMeta('meta[property="og:description"]', 'content', meta.description);
    setMeta('meta[property="og:url"]', 'content', url);
    setMeta('link[rel="canonical"]', 'href', url);
    setMeta('meta[name="robots"]', 'content', meta.noindex ? 'noindex' : 'index,follow');
  }, [path, title, description]); // eslint-disable-line react-hooks/exhaustive-deps
}
