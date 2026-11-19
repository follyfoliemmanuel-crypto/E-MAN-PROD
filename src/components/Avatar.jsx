// Photo de profil, la même partout (en-tête, menu, espace, profil) : image recadrée en
// cercle, et initiales si la personne n'a pas de photo ou si l'image ne se charge pas
// (fichier retiré, stockage injoignable) — jamais d'icône d'image cassée.
import React, { useEffect, useState } from 'react';
import { avatarUrl } from '../lib/api.js';

export const initialsOf = (u) => ((u?.first_name?.[0] || u?.full_name?.[0] || '?') + (u?.last_name?.[0] || '')).toUpperCase();

export function Avatar({ user, size = 44, className = '', alt = '' }) {
  const url = avatarUrl(user?.avatar_file_id);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (!url || failed) return <span className={`avatar ${className}`} style={style} aria-hidden={alt ? undefined : 'true'} role={alt ? 'img' : undefined} aria-label={alt || undefined}>{initialsOf(user)}</span>;
  return <img className={`avatar ${className}`} src={url} alt={alt} width={size} height={size} style={style} decoding="async" onError={() => setFailed(true)} />;
}
