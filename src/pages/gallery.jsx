// Galerie des réalisations : filtres par catégorie et affichage en grand format.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Images } from 'lucide-react';
import { GALLERY_CATEGORIES } from '../config.js';
import { useCatalog } from '../lib/catalog.jsx';
import { Link } from '../lib/router.jsx';
import { Reveal } from '../components/visual.jsx';
import { PageHero, CtaBand, Loading, CatalogError } from '../components/page.jsx';

const label = (slug) => GALLERY_CATEGORIES.find((c) => c.slug === slug)?.label || slug;

function GalleryThumb({ item, onOpen }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <li className="gItem">
      <button type="button" className="gButton" onClick={onOpen} aria-label={`Agrandir : ${item.title}`}>
        <span className="smartImg gPhoto" data-loaded={loaded}>
          <img src={item.image_url} alt={item.alt} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} />
        </span>
        <span className="gCaption"><strong>{item.title}</strong><span>{label(item.category)}</span></span>
      </button>
    </li>
  );
}

/** Affichage grand format : flèches, clavier (← → Échap) et glissement tactile. */
function Lightbox({ items, index, onClose, onMove }) {
  const ref = useRef(null);
  const startX = useRef(null);
  const item = items[index];

  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    document.documentElement.classList.add('modal-open');
    return () => document.documentElement.classList.remove('modal-open');
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') onMove(1);
      if (e.key === 'ArrowLeft') onMove(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onMove]);

  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label={`Réalisation : ${item.title}`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
      onPointerDown={(e) => { startX.current = e.clientX; }}
      onPointerUp={(e) => {
        if (startX.current === null || e.pointerType === 'mouse') return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 50) onMove(dx < 0 ? 1 : -1);
      }}
    >
      <figure className="lbFigure">
        <img key={item.id} src={item.image_url} alt={item.alt} />
        <figcaption>
          <strong>{item.title}</strong>
          {item.description && <span>{item.description}</span>}
          <span className="lbCount">{label(item.category)} · {index + 1} / {items.length}</span>
        </figcaption>
      </figure>
      <button type="button" className="roundBtn light lbClose" onClick={onClose} aria-label="Fermer"><X size={20} aria-hidden="true" /></button>
      {items.length > 1 && (
        <>
          <button type="button" className="roundBtn light lbPrev" onClick={() => onMove(-1)} aria-label="Réalisation précédente"><ChevronLeft size={22} aria-hidden="true" /></button>
          <button type="button" className="roundBtn light lbNext" onClick={() => onMove(1)} aria-label="Réalisation suivante"><ChevronRight size={22} aria-hidden="true" /></button>
        </>
      )}
    </dialog>
  );
}

export function Realisations() {
  const cat = useCatalog();
  const [filter, setFilter] = useState('tout');
  const [open, setOpen] = useState(null);
  const items = useMemo(() => (filter === 'tout' ? cat.gallery : cat.gallery.filter((g) => g.category === filter)), [cat.gallery, filter]);
  const counts = useMemo(() => Object.fromEntries(GALLERY_CATEGORIES.map((c) => [c.slug, cat.gallery.filter((g) => g.category === c.slug).length])), [cat.gallery]);
  const move = useCallback((d) => setOpen((i) => (i + d + items.length) % items.length), [items.length]);

  return (
    <main id="contenu">
      <PageHero
        crumbs={[{ label: 'Réalisations' }]}
        eyebrow="Galerie"
        title="Nos réalisations"
        lead="Des travaux sortis de l’atelier E-MAN PROD : infographie, impression, sérigraphie, enseignes, personnalisation et packaging."
      />
      {cat.status === 'loading' ? <Loading /> : cat.status === 'error' ? <CatalogError message={cat.error} /> : (
        <section className="section wrap">
          <div className="filters" role="group" aria-label="Filtrer par catégorie">
            <button type="button" className="filter" aria-pressed={filter === 'tout'} onClick={() => setFilter('tout')}>Tout <span>{cat.gallery.length}</span></button>
            {GALLERY_CATEGORIES.map((c) => (
              <button key={c.slug} type="button" className="filter" aria-pressed={filter === c.slug} onClick={() => setFilter(c.slug)}>
                {c.label} <span>{counts[c.slug]}</span>
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <div className="emptyState">
              <Images size={40} aria-hidden="true" />
              <h2 className="subTitle">{cat.gallery.length === 0 ? 'Les premières réalisations arrivent bientôt.' : `Aucune réalisation dans « ${label(filter)} » pour le moment.`}</h2>
              <p className="muted">En attendant, découvrez nos <Link to="/prestations" className="textLink">prestations</Link> ou demandez-nous des exemples sur WhatsApp.</p>
            </div>
          ) : (
            <Reveal as="ul" className="gGrid" key={filter}>
              {items.map((g, i) => <GalleryThumb key={g.id} item={g} onOpen={() => setOpen(i)} />)}
            </Reveal>
          )}
        </section>
      )}
      {open !== null && items[open] && <Lightbox items={items} index={open} onClose={() => setOpen(null)} onMove={move} />}
      <CtaBand />
    </main>
  );
}
