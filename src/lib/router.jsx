// Routeur minimal basé sur l'historique du navigateur. Chaque page a sa propre
// adresse ; le changement de page utilise l'API View Transitions quand le
// navigateur la propose (fondu court), sinon il est instantané.
import React, { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

const listeners = new Set();
const normalize = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';
// Mode « ancre » (#services) réservé aux aperçus hébergés sans serveur.
const HASH = import.meta.env.VITE_HASH_ROUTER === '1';
const currentPath = () => normalize(HASH ? '/' + window.location.hash.slice(1) : window.location.pathname);
export const hrefFor = (to) => (HASH ? (to === '/' ? '#' : '#' + to.slice(1).replace(/#.*/, '')) : to);
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function emit() {
  const update = () => flushSync(() => listeners.forEach((l) => l()));
  if (document.startViewTransition && !reduceMotion()) document.startViewTransition(update);
  else update();
}

if (typeof window !== 'undefined') window.addEventListener(HASH ? 'hashchange' : 'popstate', emit);

export function navigate(to, { replace = false } = {}) {
  if (HASH) {
    const target = hrefFor(to);
    if (target !== (window.location.hash || '#')) window.location.hash = target;
    else emit();
    window.scrollTo(0, 0);
    return;
  }
  const url = new URL(to, window.location.origin);
  if (url.pathname + url.search !== window.location.pathname + window.location.search) {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search + url.hash);
  }
  emit();
  if (url.hash) scrollToHash(url.hash);
  else window.scrollTo(0, 0);
}

/**
 * Fait défiler jusqu'à l'ancre (#pole-web…). La page cible peut encore être en
 * cours d'affichage ou de chargement : on réessaie pendant 2 secondes.
 */
export function scrollToHash(hash, tries = 40) {
  let el = null;
  try { el = document.querySelector(hash); } catch { return; }
  if (el) el.scrollIntoView({ block: 'start' });
  else if (tries > 0) setTimeout(() => scrollToHash(hash, tries - 1), 50);
}

export function usePath() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const l = () => setPath(currentPath());
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return path;
}

export function Link({ to, children, onClick, className, ...rest }) {
  const path = usePath();
  const current = path === to;
  return (
    <a
      href={hrefFor(to)}
      className={className}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
