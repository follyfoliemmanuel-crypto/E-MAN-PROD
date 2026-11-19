// Composants visuels de la page d'accueil : image à chargement progressif,
// apparition des sections, carrousel d'accueil et carrousel de cartes.
// Aucune dépendance : CSS, IntersectionObserver et API du navigateur.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
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
// Carrousel d'accueil : fondu enchaîné et défilement AUTOMATIQUE permanent (aucun bouton
// pause), y compris quand la souris est dessus ou quand l'appareil demande moins
// d'animations (le changement se fait alors sans fondu). Il ne s'arrête que pendant la
// navigation au clavier dans ses commandes et quand l'onglet est en arrière-plan.
// Flèches, points et glissement tactile restent disponibles.
// ---------------------------------------------------------------------------
export function HeroCarousel({ slides, interval = 6500, children }) {
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false); // navigation au clavier dans les commandes
  const [tick, setTick] = useState(0);           // relance du minuteur (onglet caché puis rouvert)
  const startX = useRef(null);
  const count = slides.length;
  const go = useCallback((i) => setIndex((i + count) % count), [count]);

  useEffect(() => {
    if (focused || count < 2) return undefined;
    const t = setTimeout(() => {
      if (document.visibilityState === 'visible') go(index + 1);
      else setTick((n) => n + 1); // onglet caché : on réessaie au prochain tour
    }, interval);
    return () => clearTimeout(t);
  }, [index, focused, count, interval, go, tick]);
  // Retour sur l'onglet : le défilement reprend aussitôt.
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === 'visible') setTick((n) => n + 1); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);

  const current = slides[index];
  return (
    <section
      className="heroCarousel"
      data-motion={reduceMotion() ? 'reduced' : 'full'}
      aria-roledescription="carrousel"
      aria-label="E-MAN PROD en images"
      onFocus={(e) => { if (e.target.matches?.(':focus-visible') && e.target.closest('.heroControls')) setFocused(true); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
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
                  <span key={i === index ? `run-${index}` : 'idle'} className="heroDotFill" style={{ animationDuration: `${interval}ms` }} data-run={i === index && !focused} />
                </button>
              ))}
            </div>
            <button type="button" className="roundBtn light" onClick={() => go(index + 1)} aria-label="Diapositive suivante"><ChevronRight size={20} aria-hidden="true" /></button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cartes défilantes : défilement continu et doux (environ 30 px par seconde), en
// boucle sans à-coup. Il s'arrête le temps que la souris est sur une carte, que la
// personne fait défiler à la main ou navigue au clavier, puis reprend tout seul.
// Flèches, glissement tactile et cartes entièrement cliquables restent disponibles.
// ---------------------------------------------------------------------------
export function CardCarousel({ items, label, speed = 30 }) {
  const track = useRef(null);
  const pos = useRef(0);           // position exacte (les navigateurs arrondissent scrollLeft)
  const resumeAt = useRef(0);      // reprise après une action de la personne
  const hover = useRef(false);
  const focus = useRef(false);
  const [visible, setVisible] = useState(false);
  const loop = items.length > 1;

  const step = () => {
    const el = track.current;
    const card = el?.querySelector('li');
    if (!card) return 0;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    return card.getBoundingClientRect().width + gap;
  };
  // Largeur d'un tour complet : de la première carte à sa copie.
  const lap = () => {
    const el = track.current;
    const first = el?.children[0];
    const copy = el?.children[items.length];
    return first && copy ? copy.offsetLeft - first.offsetLeft : 0;
  };
  const pauseFor = (ms) => { resumeAt.current = Date.now() + ms; };

  const scroll = (dir) => {
    const el = track.current;
    pauseFor(6000);
    el.scrollBy({ left: dir * step(), behavior: 'smooth' });
  };

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(track.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!visible || !loop || !el) return undefined;
    let raf = 0;
    let last = performance.now();
    pos.current = el.scrollLeft;
    const frame = (now) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const busy = hover.current || focus.current || Date.now() < resumeAt.current || document.visibilityState !== 'visible';
      if (busy) {
        pos.current = el.scrollLeft;
        el.dataset.auto = 'false';
      } else {
        el.dataset.auto = 'true';
        pos.current += (speed * dt) / 1000;
        const l = lap();
        if (l > 0 && pos.current >= l) pos.current -= l;
        el.scrollLeft = pos.current;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); el.dataset.auto = 'false'; };
  }, [visible, loop, speed, items.length]);

  // Revenu au-delà d'un tour (flèches, glissement) : on reste dans la boucle sans saut visible.
  const onScroll = () => {
    const el = track.current;
    const l = lap();
    if (l > 0 && el.dataset.auto !== 'true' && el.scrollLeft >= l + 4) el.scrollLeft -= l;
  };

  const list = loop ? [...items, ...items] : items;
  return (
    <div
      className="cardCarousel"
      role="region"
      aria-roledescription="carrousel"
      aria-label={label}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') hover.current = true; }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') hover.current = false; }}
      onFocus={() => { focus.current = true; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) focus.current = false; }}
      onPointerDown={(e) => { if (e.pointerType !== 'mouse') pauseFor(4000); }}
      onWheel={() => pauseFor(4000)}
    >
      <div className="carouselArrows">
        <button type="button" className="roundBtn" onClick={() => scroll(-1)} aria-label="Cartes précédentes"><ChevronLeft size={20} aria-hidden="true" /></button>
        <button type="button" className="roundBtn" onClick={() => scroll(1)} aria-label="Cartes suivantes"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      <ul className="cardTrack" data-loop={loop || undefined} ref={track} onScroll={onScroll} onTouchStart={() => pauseFor(4000)} tabIndex={0} aria-label={`${label} : faites défiler horizontalement`}>
        {list.map((a, i) => {
          const copy = i >= items.length;
          return (
            <li key={`${a.slot}-${copy ? 'b' : 'a'}`} className="actCard" aria-hidden={copy || undefined} inert={copy ? '' : undefined}>
              <SmartImage slot={a.slot} fallback={a.fallback} className="actPhoto" sizes="(max-width: 600px) 80vw, 340px" />
              <div className="actBody">
                <h3>{a.title}</h3>
                <p>{a.text}</p>
                <Link to={a.to} className="cardLink stretched" tabIndex={copy ? -1 : undefined}>En savoir plus <span className="sr">sur {a.title}</span><ArrowRight size={16} aria-hidden="true" /></Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
