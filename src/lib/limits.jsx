// Taille maximale réelle d'un envoi, lue sur le serveur (règle métier plafonnée par la
// limite du compte Cloudinary). Affichée dans les formulaires : jamais une promesse fausse.
import React, { useEffect, useState } from 'react';
import { fileLimits, formatMb } from './api.js';

export function useFileLimit(purpose) {
  const [max, setMax] = useState(null);
  useEffect(() => {
    let alive = true;
    fileLimits().then((l) => { if (alive && l[purpose]) setMax(l[purpose].max_bytes); });
    return () => { alive = false; };
  }, [purpose]);
  return max;
}

/** « JPG, PNG… , 10 Mo maximum par fichier » ; sans la taille tant qu'elle n'est pas connue. */
export function LimitHint({ purpose, formats, per = '', after = '' }) {
  const max = useFileLimit(purpose);
  return <span className="hint">{formats}{max ? `, ${formatMb(max)} maximum${per} (au-delà, compressé automatiquement jusqu’à 50 Mo)` : ''}{after}.</span>;
}
