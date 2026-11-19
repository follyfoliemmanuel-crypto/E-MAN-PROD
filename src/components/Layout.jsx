import React, { useEffect, useRef, useState } from 'react';
import { Menu, X, MapPin, Phone, Mail, Clock3, MessageCircle, ChevronDown, ArrowRight } from 'lucide-react';
import { Link, usePath } from '../lib/router.jsx';
import { BUSINESS, whatsappLink } from '../config.js';
import { useApp } from '../context.js';
import { useCatalog } from '../lib/catalog.jsx';

function TopBar() {
  const { user, openAuth } = useApp();
  return (
    <div className="topBar">
      <div className="wrap topBarRow">
        <span className="topBarPlace">
          <MapPin size={14} aria-hidden="true" />
          {BUSINESS.sites.map((s) => `${s.role} : ${s.name}`).join('  ·  ')}
        </span>
        <nav aria-label="Liens rapides">
          <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
          {user ? <Link to="/espace">Espace client</Link> : <button type="button" onClick={openAuth}>Espace client</button>}
          <a href={whatsappLink(undefined, 'contact')} target="_blank" rel="noreferrer">WhatsApp {BUSINESS.phoneDisplay}</a>
          <Link to="/e-man-cars" className="carsLink">E-MAN CARS</Link>
        </nav>
      </div>
    </div>
  );
}

/** Menu déroulant : ouverture au clic ou au survol, fermeture par Échap ou clic extérieur. */
function Dropdown({ label, id, active, children, footer }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);
  const path = usePath();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const hover = (v) => (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(v), v ? 60 : 180);
  };

  return (
    <div className="dropdown" ref={ref} onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
      <button type="button" className={'navItem' + (active ? ' current' : '')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {label} <ChevronDown size={16} aria-hidden="true" className="chev" />
      </button>
      <div id={id} className="dropdownPanel" data-open={open} onClick={(e) => { if (e.target.closest('a')) setOpen(false); }}>
        {children}
        {footer}
      </div>
    </div>
  );
}

function PrestationsMenu() {
  const cat = useCatalog();
  const path = usePath();
  return (
    <Dropdown label="Prestations" id="menu-prestations" active={path.startsWith('/prestations')}
      footer={<Link to="/prestations" className="dropdownAll">Toutes les prestations <ArrowRight size={16} aria-hidden="true" /></Link>}>
      <ul>
        {cat.prestations.map((p) => (
          <li key={p.slug}>
            <Link to={`/prestations/${p.slug}`}>
              <span><strong>{p.title}</strong><small>{p.offerings.slice(0, 3).join(', ')}</small></span>
            </Link>
          </li>
        ))}
      </ul>
    </Dropdown>
  );
}

function FormationsMenu() {
  const cat = useCatalog();
  const path = usePath();
  return (
    <Dropdown label="Formations" id="menu-formations" active={path.startsWith('/formations')}
      footer={<Link to="/formations" className="dropdownAll">Centre de formation <ArrowRight size={16} aria-hidden="true" /></Link>}>
      <ul className="oneCol">
        {cat.poles.map((p) => (
          <li key={p.slug}>
            <Link to={`/formations#pole-${p.slug}`}>
              <span className="dropIcon poleIcon">{p.number}</span>
              <span><strong>{p.title}</strong><small>{cat.coursesOf(p.slug).length} formations</small></span>
            </Link>
          </li>
        ))}
      </ul>
    </Dropdown>
  );
}

export function Header() {
  const { user, openQuote, openAuth } = useApp();
  const cat = useCatalog();
  const [open, setOpen] = useState(false);
  const path = usePath();
  const panel = useRef(null);

  useEffect(() => setOpen(false), [path]);
  // « inert » retire le menu fermé de la tabulation (posé à la main : React 18
  // ne connaît pas encore cet attribut).
  useEffect(() => { panel.current?.toggleAttribute('inert', !open); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="header">
      <a className="skip" href="#contenu">Aller au contenu</a>
      <TopBar />
      <div className="headerMain">
        <div className="wrap headerBar">
          <Link to="/" className="logo" aria-label="E-MAN PROD, accueil">
            <img src="/logo-eman-prod.png" width="168" height="57" alt="E-MAN PROD" />
          </Link>

          <nav className="navDesktop" aria-label="Menu principal">
            <PrestationsMenu />
            <FormationsMenu />
            <Link to="/realisations" className="navItem">Réalisations</Link>
            <Link to="/a-propos" className="navItem">À propos</Link>
            <Link to="/contact" className="navItem">Contact</Link>
          </nav>

          <div className="headerActions">
            <button type="button" className="btn btnPrimary btnSmall" onClick={() => openQuote()}>
              <span className="lgOnly">Demander un devis</span><span className="smOnly">Devis</span>
              <ArrowRight size={16} aria-hidden="true" className="lgOnly" />
            </button>
            <button
              type="button"
              className="menuToggle"
              aria-expanded={open}
              aria-controls="menu-mobile"
              aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
              onClick={() => setOpen(!open)}
            >
              {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className="flagLine" aria-hidden="true" />
      </div>

      <div id="menu-mobile" className="navMobile" data-open={open} ref={panel}>
        <div className="navMobileInner">
          <nav className="wrap" aria-label="Menu principal">
            <Link to="/">Accueil</Link>
            <Link to="/prestations">Prestations</Link>
            <ul className="navMobileSub">
              {cat.prestations.map((p) => <li key={p.slug}><Link to={`/prestations/${p.slug}`}>{p.title}</Link></li>)}
            </ul>
            <Link to="/formations">Centre de formation</Link>
            <ul className="navMobileSub">
              {cat.poles.map((p) => <li key={p.slug}><Link to={`/formations#pole-${p.slug}`}>Pôle {p.number} : {p.title}</Link></li>)}
            </ul>
            <Link to="/realisations">Réalisations</Link>
            <Link to="/a-propos">À propos</Link>
            <Link to="/contact">Contact</Link>
            {user
              ? <Link to="/espace">Mon espace</Link>
              : <button type="button" onClick={() => { setOpen(false); openAuth(); }}>Espace client</button>}
            <Link to="/e-man-cars" className="navMobileCars">E-MAN CARS</Link>
            <a href={whatsappLink(undefined, 'contact')} target="_blank" rel="noreferrer" className="navMobileWa">
              <MessageCircle size={18} aria-hidden="true" /> WhatsApp {BUSINESS.phoneDisplay}
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}

/** Les deux implantations (siège et annexe), avec leur itinéraire. */
export function SitesList({ invert = false }) {
  return (
    <ul className={'contactList' + (invert ? ' invert' : '')}>
      {BUSINESS.sites.map((s) => (
        <li key={s.id}>
          <MapPin aria-hidden="true" />
          <span>
            <strong className="siteRole">{s.role}</strong> {s.name}, {s.city}<br />
            <a href={s.mapsUrl} target="_blank" rel="noreferrer">Ouvrir l’itinéraire</a>
            {s.hours.map((h) => <span key={h.days} className="hoursLine"><Clock3 size={14} aria-hidden="true" /> {h.days} : {h.time}</span>)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ContactList({ invert = false }) {
  return (
    <>
      <SitesList invert={invert} />
      <ul className={'contactList' + (invert ? ' invert' : '')}>
        <li>
          <Phone aria-hidden="true" />
          <span><a href={`tel:+${BUSINESS.whatsapp}`}>{BUSINESS.phoneDisplay}</a> (appel et WhatsApp)</span>
        </li>
        <li><Mail aria-hidden="true" /><a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a></li>
      </ul>
    </>
  );
}

export function Footer() {
  const { openQuote } = useApp();
  const cat = useCatalog();
  const socials = Object.entries(BUSINESS.socials).filter(([, url]) => url);
  return (
    <footer className="footer">
      <div className="wrap footerGrid">
        <div className="footerBrand">
          <img src="/logo-eman-prod.png" width="168" height="57" alt="E-MAN PROD" loading="lazy" />
          <p className="footerSlogan">{BUSINESS.slogan}</p>
          <p>Imprimerie, infographie, communication visuelle, sérigraphie, personnalisation, formation professionnelle et informatique, au Togo.</p>
          <button type="button" className="btn btnPrimary btnSmall" onClick={() => openQuote()}>Demander un devis</button>
          {socials.length > 0 && (
            <p className="socials">
              {socials.map(([name, url]) => <a key={name} href={url} target="_blank" rel="noreferrer">{name[0].toUpperCase() + name.slice(1)}</a>)}
            </p>
          )}
        </div>
        <nav aria-label="Prestations">
          <h2 className="footerTitle">Prestations</h2>
          {cat.prestations.map((p) => <Link key={p.slug} to={`/prestations/${p.slug}`}>{p.title}</Link>)}
        </nav>
        <nav aria-label="Formations">
          <h2 className="footerTitle">Centre de formation</h2>
          {cat.poles.map((p) => <Link key={p.slug} to={`/formations#pole-${p.slug}`}>Pôle {p.number} : {p.title}</Link>)}
          <h2 className="footerTitle spaced">Le site</h2>
          <Link to="/realisations">Réalisations</Link>
          <Link to="/a-propos">À propos</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/espace">Espace client</Link>
        </nav>
        <div>
          <h2 className="footerTitle">Nous trouver</h2>
          <ContactList invert />
        </div>
      </div>
      <div className="wrap footerCars">
        <span>Découvrez aussi notre branche automobile :</span>
        <Link to="/e-man-cars" className="carsLink">E-MAN CARS <ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
      <div className="wrap footerBase">
        <span>© {new Date().getFullYear()} E-MAN PROD. {BUSINESS.slogan}</span>
        <span className="footerLegal">
          <Link to="/mentions-legales">Mentions légales</Link>
          <Link to="/confidentialite">Confidentialité</Link>
          <Link to="/verifier">Vérifier une attestation</Link>
          <button type="button" className="toTop" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Revenir en haut</button>
        </span>
      </div>
    </footer>
  );
}

/**
 * Bouton WhatsApp flottant. Il se retire quand un autre bouton WhatsApp est
 * déjà visible à l'écran (éléments marqués data-wa).
 */
export function WhatsAppButton() {
  const path = usePath();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const targets = document.querySelectorAll('[data-wa]');
    if (!targets.length || !('IntersectionObserver' in window)) { setHidden(false); return undefined; }
    const visible = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
      setHidden(visible.size > 0);
    });
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [path]);

  return (
    <a
      data-hidden={hidden}
      tabIndex={hidden ? -1 : undefined}
      className="waFloat"
      href={whatsappLink(undefined, 'contact')}
      target="_blank"
      rel="noreferrer"
      aria-label="Écrire à E-MAN PROD sur WhatsApp"
    >
      <MessageCircle size={24} aria-hidden="true" />
      <span>WhatsApp</span>
    </a>
  );
}
