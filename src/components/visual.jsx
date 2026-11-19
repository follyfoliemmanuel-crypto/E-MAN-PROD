// Composants visuels de la page d'accueil : image à chargement progressif,
// apparition des sections, carrousel d'accueil et carrousel de cartes.
// Aucune dépendance : CSS, IntersectionObserver et API du navigateur.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useMedia } from '../lib/media.jsx';
import { Link } from '../lib/router.jsx';

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Image d'un emplacement : fond coloré pendant le chargement, fondu à
// l'arrivée, retour au visuel provisoire si l'adresse ne répond pas.
// ---------------------------------------------------------------------------
export function SmartImage({ slot, fallback, className = '', eager = false, sizes }) {
  const media = useMedia().get(slot, fallback);
  const [src, setSrc] = useState(media?.url);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    setSrc(media?.url);
    setLoaded(false);
  }, [media?.url]);

  // Image déjà en cache : l'évènement load a pu partir avant l'hydratation.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, [src]);

  if (!media) return null;
  return (
    <span className={'smartImg ' + className} data-loaded={loaded}>
      <img
        ref={ref}
        src={src}
        alt={media.placeholder ? '' : media.alt}
        loading={eager ? 'eager' : 'lazy'}
        fetchpriority={eager ? 'high' : undefined}
        decoding="async"
        sizes={sizes}
        onLoad={() => setLoaded(true)}
        onError={() => { if (src !== media.fallback) setSrc(media.fallback); }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Apparition progressive : la section glisse doucement en vue une seule fois.
// ---------------------------------------------------------------------------
export function Reveal({ as: Tag = 'div', children, delay = 0, ...rest }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduceMotion() || !('IntersectionObserver' in window)) { setShown(true); return undefined; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); io.disconnect(); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} data-reveal={shown ? 'in' : 'out'} style={delay ? { '--reveal-delay': `${delay}ms` } : undefined} {...rest}>
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Carrousel d'accueil : fondu enchaîné, défilement automatique avec bouton
// pause (exigence d'accessibilité), flèches, points et glissement tactile.
// ---------------------------------------------------------------------------
export function HeroCarousel({ slides, interval = 6500, children }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);   // choix de l'utilisateur
  const [holding, setHolding] = useState(false); // survol ou focus
  const startX = useRef(null);
  const count = slides.length;
  const go = useCallback((i) => setIndex((i + count) % count), [count]);

  useEffect(() => {
    if (paused || holding || count < 2 || reduceMotion()) return undefined;
    const t = setTimeout(() => {
      if (document.visibilityState === 'visible') go(index + 1);
    }, interval);
    return () => clearTimeout(t);
  }, [index, paused, holding, count, interval, go]);

  const current = slides[index];
  return (
    <section
      className="heroCarousel"
      aria-roledescription="carrousel"
      aria-label="E-MAN PROD en images"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHolding(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHolding(false)}
      onFocus={() => setHolding(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHolding(false); }}
      onPointerDown={(e) => { startX.current = e.clientX; }}
      onPointerUp={(e) => {
        if (startX.current === null) return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 50 && e.pointerType !== 'mouse') go(index + (dx < 0 ? 1 : -1));
      }}
    >
      <div className="heroSlides">
        {slides.map((s, i) => (
          <div
            key={s.slot}
            className="heroSlide"
            data-active={i === index}
            aria-hidden={i !== index}
            role="group"
            aria-roledescription="diapositive"
            aria-label={`${i + 1} sur ${count} : ${s.theme}`}
          >
            <SmartImage slot={s.slot} eager={i === 0} className="heroPhoto" />
          </div>
        ))}
        <div className="heroShade" aria-hidden="true" />
      </div>

      <div className="wrap heroContent">{children}</div>

      {count > 1 && (
        <div className="wrap heroControls" data-wa>
          <p className="heroTheme" aria-live="off"><span aria-hidden="true" className="heroThemeDash" />{current.theme}</p>
          <div className="heroNav">
            <button type="button" className="roundBtn light" onClick={() => go(index - 1)} aria-label="Diapositive précédente"><ChevronLeft size={20} aria-hidden="true" /></button>
            <div className="heroDots">
              {slides.map((s, i) => (
                <button
                  key={s.slot}
                  type="button"
                  className="heroDot"
                  aria-label={`Diapositive ${i + 1} : ${s.theme}`}
                  aria-current={i === index}
                  onClick={() => go(i)}
                >
                  <span className="heroDotFill" style={{ animationDuration: `${interval}ms` }} data-run={i === index && !paused && !holding && !reduceMotion()} />
                </button>
              ))}
            </div>
            <button type="button" className="roundBtn light" onClick={() => go(index + 1)} aria-label="Diapositive suivante"><ChevronRight size={20} aria-hidden="true" /></button>
            <button type="button" className="roundBtn light" onClick={() => setPaused(!paused)} aria-label={paused ? 'Reprendre le défilement' : 'Mettre le défilement en pause'} aria-pressed={paused}>
              {paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cartes défilantes : défilement horizontal natif (tactile, trackpad, clavier),
// flèches, défilement automatique lent qui s'arrête dès que la personne
// interagit, et cartes entièrement cliquables.
// ---------------------------------------------------------------------------
export function CardCarousel({ items, label, interval = 4500 }) {
  const track = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const [visible, setVisible] = useState(false);
  const [hold, setHold] = useState(false);
  const resumeAt = useRef(0);

  const step = () => {
    const el = track.current;
    const card = el?.querySelector('li');
    if (!card) return 0;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    return card.getBoundingClientRect().width + gap;
  };

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);

  const scroll = (dir) => {
    const el = track.current;
    resumeAt.current = Date.now() + 10000;
    el.scrollBy({ left: dir * step(), behavior: reduceMotion() ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(track.current);
    return () => { window.removeEventListener('resize', update); io.disconnect(); };
  }, [update]);

  // Défilement automatique lent, seulement quand le carrousel est à l'écran.
  useEffect(() => {
    if (!visible || hold || reduceMotion()) return undefined;
    const t = setInterval(() => {
      const el = track.current;
      if (!el || Date.now() < resumeAt.current || document.visibilityState !== 'visible') return;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step(), behavior: 'smooth' });
    }, interval);
    return () => clearInterval(t);
  }, [visible, hold, interval]);

  return (
    <div
      className="cardCarousel"
      role="region"
      aria-roledescription="carrousel"
      aria-label={label}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHold(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHold(false); }}
      onPointerDown={() => { resumeAt.current = Date.now() + 10000; }}
    >
      <div className="carouselArrows">
        <button type="button" className="roundBtn" onClick={() => scroll(-1)} disabled={edges.start} aria-label="Cartes précédentes"><ChevronLeft size={20} aria-hidden="true" /></button>
        <button type="button" className="roundBtn" onClick={() => scroll(1)} disabled={edges.end} aria-label="Cartes suivantes"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      <ul className="cardTrack" ref={track} onScroll={update} tabIndex={0} aria-label={`${label} : faites défiler horizontalement`}>
        {items.map((a) => (
          <li key={a.slot} className="actCard">
            <SmartImage slot={a.slot} fallback={a.fallback} className="actPhoto" sizes="(max-width: 600px) 80vw, 340px" />
            <div className="actBody">
              <h3>{a.title}</h3>
              <p>{a.text}</p>
              <Link to={a.to} className="cardLink stretched">En savoir plus <span className="sr">sur {a.title}</span><ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
