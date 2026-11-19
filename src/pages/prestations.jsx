// Pages « Prestations » : liste et page détaillée de chaque prestation.
import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { PLACEHOLDERS } from '../config.js';
import { useCatalog } from '../lib/catalog.jsx';
import { useSeo } from '../lib/seo.js';
import { serviceMeta } from '../routes-meta.js';
import { Link } from '../lib/router.jsx';
import { useApp } from '../context.js';
import { SmartImage, Reveal } from '../components/visual.jsx';
import { PageHero, CtaBand, Eyebrow, Loading, CatalogError, NotFound } from '../components/page.jsx';


export const prestationImage = (p) => ({ slot: `prestation-${p.slug}`, fallback: PLACEHOLDERS[p.placeholder] });

export function PrestationCard({ p }) {
  return (
    <li className="pCard">
      <SmartImage {...prestationImage(p)} className="pCardPhoto" sizes="(max-width: 600px) 100vw, 380px" />
      <div className="pCardBody">
        <h3>{p.title}</h3>
        <p>{p.summary}</p>
        <Link to={`/prestations/${p.slug}`} className="cardLink stretched">En savoir plus <span className="sr">sur {p.title}</span><ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </li>
  );
}

export function PrestationsIndex() {
  const cat = useCatalog();
  return (
    <main id="contenu">
      <PageHero
        crumbs={[{ label: 'Prestations' }]}
        eyebrow="Nos prestations"
        title="Du fichier à l’objet fini."
        lead="Imprimerie, infographie, sérigraphie, enseignes et papeterie : chaque demande reçoit un devis avec un prix et un délai."
      />
      {cat.status === 'loading' ? <Loading /> : cat.status === 'error' ? <CatalogError message={cat.error} /> : (
        <Reveal as="section" className="section wrap">
          <ul className="pGrid">
            {cat.prestations.map((p) => <PrestationCard key={p.slug} p={p} />)}
          </ul>
        </Reveal>
      )}
      <CtaBand />
    </main>
  );
}

export function PrestationPage({ slug }) {
  const cat = useCatalog();
  const { openQuote } = useApp();
  const p = cat.prestation(slug);
  useSeo(`/prestations/${slug}`, p && serviceMeta(p));

  if (cat.status === 'loading') return <main id="contenu"><Loading lines={4} /></main>;
  if (cat.status === 'error') return <main id="contenu"><CatalogError message={cat.error} /></main>;
  if (!p) return <NotFound />;

  const pole = p.related_pole && cat.pole(p.related_pole);
  const others = cat.prestations.filter((x) => x.slug !== p.slug).slice(0, 3);

  return (
    <main id="contenu">
      <PageHero
        crumbs={[{ label: 'Prestations', to: '/prestations' }, { label: p.title }]}
        eyebrow="Prestation"
        title={p.title}
        lead={p.summary}
        {...prestationImage(p)}
      >
        <div className="heroActions">
          <button type="button" className="btn btnPrimary" onClick={() => openQuote(p.title)}>Demander un devis <ArrowRight size={18} aria-hidden="true" /></button>
        </div>
      </PageHero>

      <section className="section wrap detailGrid">
        <Reveal className="detailMain">
          <p className="detailIntro">{p.intro}</p>
          <h2 className="subTitle">Ce que nous réalisons</h2>
          <ul className="checkList">
            {p.offerings.map((o) => <li key={o}><Check size={18} aria-hidden="true" />{o}</li>)}
          </ul>
        </Reveal>
        <Reveal as="aside" className="detailAside" delay={120}>
          <SmartImage {...prestationImage(p)} className="asidePhoto" />
          <div className="asideBox">
            <h2 className="subTitle">Votre projet</h2>
            <p className="muted">Décrivez ce dont vous avez besoin : nous vous rappelons avec un prix et un délai.</p>
            <button type="button" className="btn btnPrimary btnBlock" onClick={() => openQuote(p.title)}>Demander un devis</button>
            {pole && (
              <p className="asideLink">
                Envie d’apprendre ce métier ? <Link to={`/formations#pole-${pole.slug}`} className="textLink">Pôle {pole.number} : {pole.title}</Link>
              </p>
            )}
          </div>
        </Reveal>
      </section>

      {others.length > 0 && (
        <Reveal as="section" className="section related" aria-labelledby="related-title">
          <div className="wrap">
            <Eyebrow>Autres prestations</Eyebrow>
            <h2 id="related-title" className="sectionTitle">Nous pouvons aussi vous aider pour…</h2>
            <ul className="pGrid compact">
              {others.map((x) => <PrestationCard key={x.slug} p={x} />)}
            </ul>
          </div>
        </Reveal>
      )}
      <CtaBand />
    </main>
  );
}
