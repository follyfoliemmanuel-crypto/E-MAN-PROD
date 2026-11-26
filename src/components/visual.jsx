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
export function SmartImage({ slot, fallback, className = '', eager = false, sizes, onFail, onBroken }) {
  const media = useMedia().get(slot, fallback);
  // Essais successifs, pour qu'une photo ne disparaisse jamais :
  //   0 : taille adaptée à l'écran (srcset)   1 : adresse unique de la photo (comme avant la v4.1)
  //   2 : visuel par défaut de l'emplacement   3 : rien ne s'affiche → l'emplacement est signalé (onFail)
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);
  const srcsetKey = media?.srcset?.length ? media.srcset[0][1] : '';

  useEffect(() => {
    setStage(0);
    setLoaded(false);
  }, [media?.url, srcsetKey]);

  const hasSet = !!media?.srcset?.length;
  const src = !media ? undefined : stage <= 1 ? media.url : media.fallback;
  // Image déjà en cache : l'évènement load a pu partir avant l'hydratation.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, [src, stage]);

  const fail = () => {
    setLoaded(false);
    if (stage === 0 && hasSet) {
      // Trace pour le diagnostic (console du navigateur) : quelle taille a été refusée.
      console.warn(`[E-MAN PROD] photo « ${slot} » : taille adaptée refusée, repli sur l’adresse d’origine.`, ref.current?.currentSrc || '');
      setStage(1); return;
    }
    if (!media.placeholder) onBroken?.(slot); // photo personnalisée introuvable (signalée dans l'admin)
    if (stage <= 1 && media.fallback && media.fallback !== media.url) { setStage(2); return; }
    setStage(3); onFail?.(slot);
  };

  if (!media || stage === 3 || !src) return null;
  // Photo envoyée depuis l'admin : le navigateur choisit la taille adaptée à l'écran (léger sur
  // téléphone, net sur grand écran) ; point de cadrage choisi dans l'admin (sinon centré).
  const srcSet = stage === 0 && hasSet ? media.srcset.map(([w, u]) => `${u} ${w}w`).join(', ') : undefined;
  const style = {
    ...(media.focus ? { '--focus': media.focus } : {}),
    ...(media.focus_mobile ? { '--focus-m': media.focus_mobile } : {}),
  };
  return (
    <span className={'smartImg ' + className} data-loaded={loaded} style={style}>
      <img
        key={stage}
        ref={ref}
        src={src}
        srcSet={srcSet}
        alt={media.placeholder ? '' : media.alt}
        loading={eager ? 'eager' : 'lazy'}
        fetchpriority={eager ? 'high' : undefined}
        decoding="async"
        sizes={srcSet ? sizes || '100vw' : sizes}
        data-stage={stage}
        onLoad={() => setLoaded(true)}
        onError={fail}
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
export function HeroCarousel({ slides: allSlides, interval = 6500, children }) {
  // Une diapositive dont la photo ne peut pas s'afficher (et sans visuel par défaut) est retirée :
  // jamais d'image vide dans la bannière.
  const [broken, setBroken] = useState(() => new Set());
  const onFail = useCallback((slot) => setBroken((b) => (b.has(slot) ? b : new Set(b).add(slot))), []);
  const kept = allSlides.filter((s) => !broken.has(s.slot));
  const slides = kept.length ? kept : allSlides.slice(0, 1);
  const [rawIndex, setIndex] = useState(0);
  const index = rawIndex % slides.length;
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
            <SmartImage slot={s.slot} eager={i === 0} className="heroPhoto" onFail={onFail} />
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
// boucle sans à-coup, TOUT SEUL : il ne s'arrête jamais, même souris dessus. Seul un
// défilement fait à la main (doigt, molette, flèches) le suspend quelques secondes.
// Flèches, glissement tactile et cartes entièrement cliquables restent disponibles.
// ---------------------------------------------------------------------------
export function CardCarousel({ items, label, speed = 30 }) {
  const track = useRef(null);
  const pos = useRef(0);           // position exacte (les navigateurs arrondissent scrollLeft)
  const resumeAt = useRef(0);      // reprise après une action de la personne
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
  const touching = useRef(false);  // doigt posé : on suit le doigt, puis on repart
  const pauseFor = (ms) => { resumeAt.current = Date.now() + ms; };

  const scroll = (dir) => {
    const el = track.current;
    pauseFor(1500);
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
      const busy = touching.current || Date.now() < resumeAt.current || document.visibilityState !== 'visible';
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
      onPointerDown={(e) => { if (e.pointerType !== 'mouse') pauseFor(1000); }}
      onWheel={() => pauseFor(1200)}
    >
      <div className="carouselArrows">
        <button type="button" className="roundBtn" onClick={() => scroll(-1)} aria-label="Cartes précédentes"><ChevronLeft size={20} aria-hidden="true" /></button>
        <button type="button" className="roundBtn" onClick={() => scroll(1)} aria-label="Cartes suivantes"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      <ul className="cardTrack" data-loop={loop || undefined} ref={track} onScroll={onScroll} onTouchStart={() => { touching.current = true; }} onTouchEnd={() => { touching.current = false; pauseFor(900); }} onTouchCancel={() => { touching.current = false; pauseFor(900); }} tabIndex={0} aria-label={`${label} : faites défiler horizontalement`}>
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
