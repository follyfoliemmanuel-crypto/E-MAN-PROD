// « Partager le site » : le lien du site avec son aperçu (celui que montrent WhatsApp, Facebook…),
// à copier ou à partager directement. Présent dans l'espace client et dans l'espace de l'équipe.
import React, { useRef, useState } from 'react';
import { Copy, Check, Share2, MessageCircle, Link2 } from 'lucide-react';
import { ROUTES } from '../../routes-meta.js';

/** Adresse publique du site : celle déclarée au déploiement (SITE_URL), sinon celle de la page ouverte. */
export function siteUrl() {
  const declared = import.meta.env?.VITE_SITE_URL;
  return String(declared || window.location.origin).replace(/\/$/, '');
}

export function ShareSite() {
  const url = siteUrl();
  const host = url.replace(/^https?:\/\//, '');
  const { title, description } = ROUTES['/'];
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const field = useRef(null);
  const text = `Découvrez E-MAN PROD : impression, création graphique, sérigraphie et formations à Baguida (Togo).`;

  async function copy() {
    let done = false;
    try {
      await navigator.clipboard.writeText(url);
      done = true;
    } catch {
      // Navigateur sans accès au presse-papiers : on sélectionne le lien pour une copie manuelle.
      try { field.current?.select(); done = document.execCommand('copy'); } catch { done = false; }
    }
    setCopied(done);
    setNote(done ? 'Lien copié. Collez-le dans WhatsApp, Facebook, un e-mail… l’aperçu s’affichera.' : 'Copie automatique impossible : le lien est sélectionné, copiez-le (appui long → Copier).');
    if (done) setTimeout(() => setCopied(false), 2500);
  }

  async function share() {
    try {
      await navigator.share({ title: 'E-MAN PROD', text, url });
    } catch (err) {
      if (err?.name !== 'AbortError') copy();
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;

  return (
    <section className="spaceBlock shareSite" aria-labelledby="share-title">
      <div>
        <h2 className="subTitle" id="share-title">Partager le site</h2>
        <p className="muted small">Faites connaître E-MAN PROD : le lien s’affiche avec cet aperçu sur WhatsApp, Facebook et les autres réseaux.</p>
      </div>
      <a className="sharePreview" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Aperçu du lien ${host}`}>
        <img src="/og-image.jpg" alt="" width="1200" height="630" loading="lazy" />
        <span className="shareText">
          <span className="shareHost">{host}</span>
          <strong>{title}</strong>
          <span className="shareDesc">{description}</span>
        </span>
      </a>
      <div className="shareLink">
        <Link2 size={18} aria-hidden="true" />
        <input ref={field} readOnly value={url} aria-label="Lien du site" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btnPrimary" onClick={copy}>
          {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          {copied ? 'Copié' : 'Copier le lien'}
        </button>
      </div>
      <div className="shareActions">
        {canShare && (
          <button type="button" className="btn btnGhost" onClick={share}><Share2 size={18} aria-hidden="true" /> Partager…</button>
        )}
        <a className="btn btnGhost" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} aria-hidden="true" /> WhatsApp</a>
        <a className="btn btnGhost" href={fb} target="_blank" rel="noopener noreferrer">Facebook</a>
      </div>
      <p className="shareNote small" role="status" aria-live="polite">{note}</p>
    </section>
  );
}
