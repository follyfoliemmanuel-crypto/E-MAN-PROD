// Photo de profil, la même partout (en-tête, menu, espace, profil) : image recadrée en
// cercle, et initiales si la personne n'a pas de photo ou si l'image ne se charge pas
// — jamais d'icône d'image cassée. Si l'adresse optimisée est refusée, une seconde
// tentative charge l'image d'origine (déjà allégée à 800 px avant l'envoi).
import React, { useEffect, useState } from 'react';
import { avatarUrl } from '../lib/api.js';

export const initialsOf = (u) => ((u?.first_name?.[0] || u?.full_name?.[0] || '?') + (u?.last_name?.[0] || '')).toUpperCase();

export function Avatar({ user, size = 44, className = '', alt = '' }) {
  const url = avatarUrl(user?.avatar_file_id);
  const [attempt, setAttempt] = useState(0); // 0 : adresse optimisée, 1 : image d'origine, 2 : initiales
  useEffect(() => setAttempt(0), [url]);
  const failed = attempt >= 2;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (!url || failed) return <span className={`avatar ${className}`} style={style} aria-hidden={alt ? undefined : 'true'} role={alt ? 'img' : undefined} aria-label={alt || undefined}>{initialsOf(user)}</span>;
  return <img className={`avatar ${className}`} src={attempt === 1 ? `${url}&direct=1` : url} alt={alt} width={size} height={size} style={style} decoding="async" onError={() => setAttempt((a) => a + 1)} />;
}
