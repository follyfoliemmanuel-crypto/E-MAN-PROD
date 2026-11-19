// Pages « À propos » et E-MAN CARS. Leurs textes viennent de la base
// (table content_blocks), avec le contenu initial en secours.
import React from 'react';
import { ArrowRight, Check, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { BUSINESS, whatsappLink } from '../config.js';
import { CONTENT } from '../content/seed.js';
import { useCatalog } from '../lib/catalog.jsx';
import { Link } from '../lib/router.jsx';
import { SmartImage, Reveal } from '../components/visual.jsx';
import { PageHero, CtaBand, Eyebrow } from '../components/page.jsx';
import { SitesList } from '../components/Layout.jsx';

export function About() {
  const cat = useCatalog();
  const a = { ...CONTENT.about, ...(cat.content.about || {}) };
  return (
    <main id="contenu">
      <PageHero crumbs={[{ label: 'À propos' }]} eyebrow={BUSINESS.slogan} title="Qui sommes-nous ?" lead={a.lead} slot="about-photo" />
      <section className="section wrap detailGrid">
        <Reveal className="detailMain">
          <h2 className="subTitle">Nos activités</h2>
          <ul className="checkList two">
            {a.activities.map((x) => <li key={x}><Check size={18} aria-hidden="true" />{x}</li>)}
          </ul>
          <div className="aboutLinks">
            <Link to="/prestations" className="btn btnPrimary">Nos prestations <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link to="/formations" className="btn btnGhost">Le centre de formation</Link>
          </div>
        </Reveal>
        <Reveal as="aside" className="detailAside" delay={120}>
          <SmartImage slot="about-photo" className="asidePhoto" />
          <div className="asideBox">
            <h2 className="subTitle">Nos implantations</h2>
            <SitesList />
            <p className="contactLine"><Mail size={18} aria-hidden="true" /><a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a></p>
            <p className="contactLine"><Phone size={18} aria-hidden="true" /><a href={`tel:+${BUSINESS.whatsapp}`}>{BUSINESS.phoneDisplay}</a></p>
          </div>
        </Reveal>
      </section>
      <CtaBand />
    </main>
  );
}

/** E-MAN CARS : branche séparée, avec son propre style et ses propres contacts. */
export function EmanCars() {
  const cat = useCatalog();
  const c = { ...CONTENT.cars, ...(cat.content.cars || {}) };
  // Numéro propre à E-MAN CARS s'il est renseigné dans l'admin, sinon le numéro principal.
  const carsPhone = String(cat.content?.cars?.phone || '').replace(/\D/g, '');
  const carsText = encodeURIComponent('Bonjour E-MAN CARS, je souhaite des informations sur vos véhicules.');
  const wa = carsPhone ? `https://wa.me/${carsPhone}?text=${carsText}` : whatsappLink('Bonjour E-MAN CARS, je souhaite des informations sur vos véhicules.');
  return (
    <main id="contenu" className="carsPage">
      <PageHero crumbs={[{ label: 'E-MAN CARS' }]} eyebrow={c.tagline} title={c.title} lead={c.intro} slot="cars-hero" tone="cars">
        <div className="heroActions" data-wa>
          <a className="btn btnGold" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" /> Contacter E-MAN CARS</a>
        </div>
      </PageHero>
      <section className="section wrap">
        <Eyebrow>{c.tagline}</Eyebrow>
        <h2 className="sectionTitle">Notre offre</h2>
        <Reveal as="ul" className="carsOffers">
          {c.offers.map((o) => (
            <li key={o.title}>
              <h3>{o.title}</h3>
              <p>{o.text}</p>
            </li>
          ))}
        </Reveal>
      </section>
      <section className="carsContact">
        <div className="wrap ctaInner">
          <div>
            <h2 className="sectionTitle">{c.contactText}</h2>
            <p className="carsNote"><MapPin size={16} aria-hidden="true" /> E-MAN CARS est une branche distincte des activités d’imprimerie et de formation d’E-MAN PROD.</p>
          </div>
          <div className="ctaActions" data-wa>
            <a className="btn btnGold" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" /> WhatsApp</a>
            <a className="btn btnOutlineLight" href={`tel:+${BUSINESS.whatsapp}`}><Phone size={18} aria-hidden="true" /> Appeler</a>
          </div>
        </div>
      </section>
    </main>
  );
}
