// Centre de formation professionnelle : les 3 pôles, puis une fiche par formation.
import React from 'react';
import { ArrowRight, CalendarDays, Clock3, GraduationCap, ChartColumn, ListChecks, Wallet, Users, MapPin, MessageCircle } from 'lucide-react';
import { PLACEHOLDERS, whatsappLink } from '../config.js';
import { useCatalog } from '../lib/catalog.jsx';
import { useSeo } from '../lib/seo.js';
import { courseMeta } from '../routes-meta.js';
import { Link } from '../lib/router.jsx';
import { formatPrice, formatDay } from '../lib/api.js';
import { SmartImage, Reveal } from '../components/visual.jsx';
import { PageHero, Eyebrow, Loading, CatalogError, NotFound } from '../components/page.jsx';
import { TrainingForm } from '../components/forms.jsx';

export const courseImage = (c) => ({ slot: `course-${c.slug}`, fallback: PLACEHOLDERS[c.placeholder] });

const nextSession = (c) => c.sessions.find((s) => s.status === 'ouverte');

function CourseCard({ c }) {
  const next = nextSession(c);
  return (
    <li className="cCard">
      <SmartImage {...courseImage(c)} className="cCardPhoto" sizes="(max-width: 600px) 100vw, 360px" />
      <div className="cCardBody">
        <span className="cCardDomain">{c.domain}</span>
        <h3>{c.title}</h3>
        <p>{c.summary}</p>
        <p className="cCardMeta">
          <CalendarDays size={16} aria-hidden="true" />
          {next ? `Prochaine session : ${formatDay(next.starts_on)}` : 'Prochaines dates bientôt annoncées'}
        </p>
        <Link to={`/formations/${c.slug}`} className="cardLink stretched">Voir la formation <span className="sr">{c.title}</span><ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </li>
  );
}

export function TrainingCenter() {
  const cat = useCatalog();
  return (
    <main id="contenu">
      <PageHero
        crumbs={[{ label: 'Formations' }]}
        eyebrow="Formation professionnelle"
        title="Centre de formation professionnelle E-MAN PROD"
        lead="Trois pôles pour apprendre un métier en pratique : arts graphiques et imprimerie, informatique et réseaux, développement web."
        slot="training-band"
      >
        {cat.poles.length > 0 && (
          <nav className="poleNav" aria-label="Les pôles de formation">
            {cat.poles.map((p) => <a key={p.slug} href={`#pole-${p.slug}`} className="poleChip"><strong>Pôle {p.number}</strong> {p.title}</a>)}
          </nav>
        )}
      </PageHero>

      {cat.status === 'loading' ? <Loading lines={5} /> : cat.status === 'error' ? <CatalogError message={cat.error} /> : (
        cat.poles.map((pole, i) => (
          <Reveal as="section" key={pole.slug} id={`pole-${pole.slug}`} className={'section poleSection' + (i % 2 ? ' alt' : '')} aria-labelledby={`pole-title-${pole.slug}`}>
            <div className="wrap">
              <div className="poleHead">
                <span className="poleNumber" aria-hidden="true">{pole.number}</span>
                <div>
                  <Eyebrow>Pôle {pole.number}</Eyebrow>
                  <h2 id={`pole-title-${pole.slug}`} className="sectionTitle">{pole.title}</h2>
                  <p className="poleSummary">{pole.summary}</p>
                </div>
              </div>
              <ul className="cGrid">
                {cat.coursesOf(pole.slug).map((c) => <CourseCard key={c.slug} c={c} />)}
              </ul>
            </div>
          </Reveal>
        ))
      )}

      <section className="ctaBand" aria-labelledby="training-cta">
        <div className="wrap ctaInner">
          <div>
            <Eyebrow light>Une question sur une formation ?</Eyebrow>
            <h2 id="training-cta" className="sectionTitle">Parlons de votre projet de formation.</h2>
            <p>Dates, tarifs, niveau requis : nous vous répondons sur WhatsApp ou par téléphone.</p>
          </div>
          <div className="ctaActions" data-wa>
            <a className="btn btnWhatsapp" href={whatsappLink(undefined, 'training')} target="_blank" rel="noreferrer">
              <MessageCircle size={18} aria-hidden="true" /> Écrire sur WhatsApp
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

function Fact({ icon: Icon, label, value, empty }) {
  return (
    <div className="fact">
      <Icon size={20} aria-hidden="true" />
      <dt>{label}</dt>
      <dd className={value ? '' : 'pending'}>{value || empty}</dd>
    </div>
  );
}

export function CoursePage({ slug }) {
  const cat = useCatalog();
  const c = cat.course(slug);
  useSeo(`/formations/${slug}`, c && courseMeta(c));

  if (cat.status === 'loading') return <main id="contenu"><Loading lines={6} /></main>;
  if (cat.status === 'error') return <main id="contenu"><CatalogError message={cat.error} /></main>;
  if (!c) return <NotFound />;

  const pole = cat.pole(c.pole_slug);
  const siblings = cat.coursesOf(c.pole_slug).filter((x) => x.slug !== c.slug);

  return (
    <main id="contenu">
      <PageHero
        crumbs={[{ label: 'Formations', to: '/formations' }, { label: c.title }]}
        eyebrow={pole ? `Pôle ${pole.number} : ${pole.title}` : 'Formation'}
        title={c.title}
        lead={c.summary}
        {...courseImage(c)}
      >
        <div className="heroActions">
          <a href="#inscription" className="btn btnPrimary">S’inscrire <ArrowRight size={18} aria-hidden="true" /></a>
        </div>
      </PageHero>

      <section className="section wrap detailGrid">
        <div className="detailMain">
          <Reveal>
            <SmartImage {...courseImage(c)} className="coursePhoto" />
            <p className="detailIntro">{c.description}</p>
          </Reveal>

          <Reveal as="section" aria-labelledby="objectifs">
            <h2 id="objectifs" className="subTitle">Objectifs</h2>
            <ul className="checkList">
              {c.objectives.map((o) => <li key={o}><ListChecks size={18} aria-hidden="true" />{o}</li>)}
            </ul>
          </Reveal>

          <Reveal as="section" aria-labelledby="programme">
            <h2 id="programme" className="subTitle">Programme</h2>
            <ol className="program">
              {c.program.map((m, i) => <li key={m}><span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>{m}</li>)}
            </ol>
          </Reveal>

          <Reveal as="section" aria-labelledby="sessions">
            <h2 id="sessions" className="subTitle">Dates de formation</h2>
            {c.sessions.length === 0 ? (
              <p className="muted">Les prochaines dates seront bientôt annoncées. Inscrivez-vous ci-dessous pour être prévenu en priorité.</p>
            ) : (
              <ul className="sessionList">
                {c.sessions.map((s) => {
                  const full = s.seats_left === 0;
                  const closed = s.status !== 'ouverte';
                  return (
                    <li key={s.id} className={full || closed ? 'off' : ''}>
                      <div>
                        <strong>{formatDay(s.starts_on)}{s.ends_on && s.ends_on !== s.starts_on ? ` au ${formatDay(s.ends_on)}` : ''}</strong>
                        <span className="muted">{[s.schedule, s.site].filter(Boolean).join(' · ')}</span>
                      </div>
                      <span className={'tag ' + (closed ? 'off' : full ? 'off' : 'done')}>
                        {closed ? 'Inscriptions fermées' : full ? 'Complet' : s.seats_left !== null && s.seats_left !== undefined ? `${s.seats_left} place${s.seats_left > 1 ? 's' : ''} disponible${s.seats_left > 1 ? 's' : ''}` : 'Places disponibles'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Reveal>
        </div>

        <aside className="detailAside">
          <dl className="facts">
            <Fact icon={GraduationCap} label="Domaine" value={c.domain} />
            <Fact icon={Clock3} label="Durée" value={c.duration} empty="À préciser" />
            <Fact icon={ChartColumn} label="Niveau" value={c.level} empty="À préciser" />
            <Fact icon={ListChecks} label="Prérequis" value={c.prerequisites} empty="À préciser" />
            <Fact icon={Wallet} label="Tarif" value={c.price_fcfa !== null && c.price_fcfa !== undefined ? formatPrice(c.price_fcfa, c.price_note) : null} empty="Nous consulter" />
            {c.certificate && <Fact icon={GraduationCap} label="À l’issue" value={c.certificate} />}
            <Fact icon={Users} label="Places" value={c.sessions.some((s) => s.seats_left) ? 'Selon la session choisie' : null} empty="Selon la session" />
            <Fact icon={MapPin} label="Lieu" value={[...new Set(c.sessions.map((s) => s.site).filter(Boolean))].join(', ') || null} empty="Baguida ou Agbavi, selon la session" />
          </dl>
          <div className="panel" id="inscription">
            <TrainingForm course={c} />
          </div>
          <a className="btn btnWhatsapp btnBlock" href={whatsappLink(`Bonjour E-MAN PROD, je souhaite des renseignements sur la formation « ${c.title} ».`, 'training')} target="_blank" rel="noreferrer">
            Une question ? Nous écrire sur WhatsApp
          </a>
        </aside>
      </section>

      {siblings.length > 0 && (
        <Reveal as="section" className="section related" aria-labelledby="siblings-title">
          <div className="wrap">
            <Eyebrow>Dans le même pôle</Eyebrow>
            <h2 id="siblings-title" className="sectionTitle">Autres formations du pôle {pole?.number}</h2>
            <ul className="cGrid">{siblings.map((x) => <CourseCard key={x.slug} c={x} />)}</ul>
          </div>
        </Reveal>
      )}
    </main>
  );
}
