// Éléments communs des pages intérieures.
import React from 'react';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { BUSINESS, whatsappLink } from '../config.js';
import { Link } from '../lib/router.jsx';
import { useApp } from '../context.js';
import { SmartImage } from './visual.jsx';

export function Eyebrow({ children, light = false }) {
  return <p className={'eyebrow' + (light ? ' light' : '')}><span className="eyebrowDash" aria-hidden="true" />{children}</p>;
}

/** En-tête de page : bandeau bleu nuit, fil d'Ariane, photo en fond. */
export function PageHero({ eyebrow, title, lead, crumbs = [], slot = 'hero-1', fallback, children, tone = '' }) {
  return (
    <section className={'pageHero ' + tone}>
      <SmartImage slot={slot} fallback={fallback} className="pageHeroImg" eager />
      <div className="wrap pageHeroInner">
        <nav className="crumbs" aria-label="Fil d’Ariane">
          <Link to="/">Accueil</Link>
          {crumbs.map((c, i) => (
            <React.Fragment key={c.label}>
              <span aria-hidden="true">/</span>
              {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </React.Fragment>
          ))}
        </nav>
        {eyebrow && <Eyebrow light>{eyebrow}</Eyebrow>}
        <h1 className="pageTitle">{title}</h1>
        {lead && <p className="pageLead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

export function CtaBand({ title = 'Recevez votre devis, avec un prix et un délai.', eyebrow = 'Un projet à imprimer ?' }) {
  const { openQuote } = useApp();
  return (
    <section className="ctaBand" aria-labelledby="cta-title">
      <div className="wrap ctaInner">
        <div>
          <Eyebrow light>{eyebrow}</Eyebrow>
          <h2 id="cta-title" className="sectionTitle">{title}</h2>
          <p>Écrivez-nous sur WhatsApp avec une photo ou vos fichiers, ou appelez le <a href={`tel:+${BUSINESS.whatsapp}`}>{BUSINESS.phoneDisplay}</a>.</p>
        </div>
        <div className="ctaActions" data-wa>
          <button type="button" className="btn btnPrimary" onClick={() => openQuote()}>Demander un devis <ArrowRight size={18} aria-hidden="true" /></button>
          <a className="btn btnWhatsapp" href={whatsappLink(undefined, 'quote')} target="_blank" rel="noreferrer">
            <MessageCircle size={18} aria-hidden="true" /> WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

/** Squelette affiché pendant le chargement du catalogue. */
export function Loading({ lines = 3 }) {
  return (
    <div className="wrap section loadingBlock" role="status" aria-label="Chargement">
      {Array.from({ length: lines }, (_, i) => <span key={i} className="skeleton" style={{ width: `${90 - i * 18}%` }} />)}
    </div>
  );
}

export function CatalogError({ message }) {
  return (
    <div className="wrap section">
      <p className="formError" role="alert">Le contenu n’a pas pu être chargé ({message}). Rechargez la page ou écrivez-nous sur WhatsApp.</p>
    </div>
  );
}

export function NotFound() {
  return (
    <main id="contenu">
      <PageHero crumbs={[{ label: 'Page introuvable' }]} eyebrow="Erreur 404" title="Page introuvable" lead="Cette adresse ne correspond à aucune page du site." />
      <div className="wrap legal">
        <Link to="/" className="btn btnPrimary">Revenir à l’accueil</Link>
      </div>
    </main>
  );
}
