import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, MessageCircle, Phone, Quote, Mail } from 'lucide-react';
import { BUSINESS, LEGAL, TESTIMONIALS, AUDIENCES, HERO_SLIDES, whatsappLink } from '../config.js';
import { Link } from '../lib/router.jsx';
import { useApp } from '../context.js';
import { useCatalog } from '../lib/catalog.jsx';
import { useMedia } from '../lib/media.jsx';
import { space } from '../lib/api.js';
import { QuoteForm } from '../components/forms.jsx';
import { ContactList } from '../components/Layout.jsx';
import { HeroCarousel, CardCarousel, SmartImage, Reveal } from '../components/visual.jsx';
import { PageHero, CtaBand, Eyebrow } from '../components/page.jsx';
import { prestationImage } from './prestations.jsx';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Chiffre qui défile de 0 à sa valeur la première fois qu'il devient visible. */
function CountUp({ value }) {
  const target = /^\d+$/.test(String(value)) ? Number(value) : null;
  const [shown, setShown] = useState(target === null || reduceMotion() ? String(value) : '0');
  const ref = useRef(null);
  useEffect(() => {
    if (target === null || reduceMotion()) { setShown(String(value)); return undefined; }
    let raf;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / 900);
        setShown(String(Math.round(target * (1 - (1 - t) ** 3))));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(ref.current);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [target, value]);
  return <span ref={ref}>{shown}</span>;
}

const STEPS = [
  { title: 'Vous décrivez votre projet', text: 'Par le formulaire, sur WhatsApp ou au comptoir, avec vos fichiers ou une simple photo de ce que vous voulez.' },
  { title: 'Nous vous envoyons le devis', text: 'Prix, délai et conseil sur le support adapté à votre budget. Une maquette est préparée si besoin.' },
  { title: 'Vous validez, nous produisons', text: 'Impression, personnalisation ou pose, puis retrait de votre commande à l’atelier.' },
];

// ---------------------------------------------------------------------------
export function Home() {
  const { openQuote } = useApp();
  const cat = useCatalog();
  const media = useMedia();
  const ready = cat.status === 'ready';
  const home = cat.content?.home || {};
  // Diapositives 1 à 4 toujours là (visuel provisoire tant qu'aucune photo) ; 5 à 10 seulement avec une photo.
  const slides = HERO_SLIDES.flatMap((s) => {
    if (!s.optional) return [s];
    const m = media.get(s.slot);
    return m && !m.placeholder ? [{ ...s, theme: (m.alt || s.theme).slice(0, 60) }] : [];
  });
  // Avis réels, publiés après relecture dans l'admin (aucun avis inventé).
  const reviews = (cat.testimonials || []).map((t) => ({ name: t.author_name, role: t.author_title, text: t.content }));
  const cards = cat.prestations.map((p) => ({ ...prestationImage(p), title: p.title, text: p.summary, to: `/prestations/${p.slug}` }));
  const figures = [
    { value: ready ? cat.prestations.length : '…', label: 'métiers réunis sous un même toit' },
    { value: ready ? cat.courses.length : '…', label: `formations dans ${cat.poles.length || 3} pôles` },
  ];

  return (
    <main id="contenu">
      <HeroCarousel slides={slides}>
        <p className="eyebrow light heroEyebrow"><span className="eyebrowDash" aria-hidden="true" />{home.eyebrow || BUSINESS.slogan}</p>
        <h1 className="heroTitle">{home.title || 'DONNEZ VIE À VOS IDÉES AVEC E-MAN PROD'}</h1>
        <p className="heroLead">
          {home.lead || 'Impression, création graphique, communication visuelle et formation professionnelle : nous transformons vos idées en réalisations exceptionnelles.'}
        </p>
        <div className="heroActions">
          <Link to="/prestations" className="btn btnOutlineLight">Découvrir nos services</Link>
          <button type="button" className="btn btnPrimary" onClick={() => openQuote()}>Demander un devis <ArrowRight size={18} aria-hidden="true" /></button>
          <Link to="/formations" className="btn btnGlass">Découvrir nos formations</Link>
        </div>
      </HeroCarousel>

      <section className="figuresBand" aria-label="En bref">
        <ul className="wrap figures" data-wa>
          {figures.map((f) => (
            <li key={f.label}><strong>{ready ? <CountUp value={f.value} /> : f.value}</strong><span>{f.label}</span></li>
          ))}
          <li>
            <a href={whatsappLink(undefined, 'quote')} target="_blank" rel="noreferrer">
              <strong>WhatsApp</strong>
              <span>pour envoyer vos fichiers et recevoir le devis</span>
            </a>
          </li>
        </ul>
      </section>

      <Reveal as="section" className="section activities" aria-labelledby="activities-title">
        <div className="wrap">
          <div className="sectionHead">
            <div>
              <Eyebrow>Nos prestations</Eyebrow>
              <h2 id="activities-title" className="sectionTitle">Ce que nous réalisons pour vous.</h2>
            </div>
            <Link to="/prestations" className="textLink">Toutes les prestations <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </div>
        {cards.length > 0 && <CardCarousel items={cards} label="Nos prestations" />}
      </Reveal>

      <Reveal as="section" className="wrap audiences" aria-label="Pour qui">
        {AUDIENCES.map((a) => (
          <article key={a.badge} className={`audience tone-${a.tone}`}>
            <span className="badge">{a.badge}</span>
            <h2>{a.title}</h2>
            <p>{a.text}</p>
            {a.action === 'quote'
              ? <button type="button" className="cardLink" onClick={() => openQuote()}>{a.cta} <ArrowRight size={16} aria-hidden="true" /></button>
              : <Link to={a.to} className="cardLink">{a.cta} <ArrowRight size={16} aria-hidden="true" /></Link>}
          </article>
        ))}
      </Reveal>

      <Reveal as="section" className="section process" aria-labelledby="process-title">
        <div className="wrap">
          <Eyebrow>Comment ça marche</Eyebrow>
          <h2 id="process-title" className="sectionTitle">Votre commande en trois étapes.</h2>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="stepNum" aria-hidden="true">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </Reveal>

      <Reveal as="section" className="training" aria-labelledby="training-title">
        <SmartImage slot="training-band" className="trainingBg" />
        <div className="wrap trainingGrid">
          <div>
            <Eyebrow light>Centre de formation professionnelle</Eyebrow>
            <h2 id="training-title" className="sectionTitle">Apprenez un métier, en pratique, dans trois pôles.</h2>
            <p className="trainingText">Des formations sur nos machines et nos postes, avec l’équipe qui produit chaque jour.</p>
            <Link to="/formations" className="btn btnLight">Voir les formations <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
          <ul className="courseList poles">
            {cat.poles.map((p) => (
              <li key={p.slug}>
                <Link to={`/formations#pole-${p.slug}`} className="poleLink">
                  <span className="poleBadge">Pôle {p.number}</span>
                  <strong>{p.title}</strong>
                  <span>{cat.coursesOf(p.slug).length} formations</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>

      {reviews.length > 0 && (
        <section className="section wrap" aria-labelledby="reviews-title">
          <Eyebrow>Avis clients</Eyebrow>
          <h2 id="reviews-title" className="sectionTitle">Ils nous ont confié leurs projets.</h2>
          <div className="reviews">
            {reviews.slice(0, 6).map((t, i) => (
              <blockquote key={i}>
                <Quote aria-hidden="true" />
                <p>{t.text}</p>
                <footer><strong>{t.name}</strong>{t.role && `, ${t.role}`}</footer>
              </blockquote>
            ))}
          </div>
        </section>
      )}

      <CtaBand />
    </main>
  );
}

export function Contact() {
  return (
    <main id="contenu">
      <PageHero
        crumbs={[{ label: 'Contact' }]}
        eyebrow="Nous joindre"
        title="Parlons de votre projet."
        lead="Passez à l’atelier de Baguida ou à l’annexe d’Agbavi, appelez, ou envoyez votre demande ici : nous revenons vers vous avec un devis."
      />
      <section className="section wrap split">
        <div className="contactCol" data-wa>
          <h2 className="subTitle">E-MAN PROD</h2>
          <a href={`tel:+${BUSINESS.whatsapp}`} className="bigPhone">{BUSINESS.phoneDisplay}</a>
          <ContactList />
          <div className="contactActions">
            <a className="btn btnWhatsapp" href={whatsappLink(undefined, 'info')} target="_blank" rel="noreferrer">
              <MessageCircle size={18} aria-hidden="true" /> Écrire sur WhatsApp
            </a>
            <a className="btn btnGhost" href={`mailto:${BUSINESS.email}`}><Mail size={18} aria-hidden="true" /> Écrire un e-mail</a>
            <a className="btn btnGhost" href={`tel:+${BUSINESS.whatsapp}`}><Phone size={18} aria-hidden="true" /> Appeler</a>
          </div>
        </div>
        <div className="panel">
          <QuoteForm title="Envoyer une demande" />
        </div>
      </section>
    </main>
  );
}

function LegalRow({ label, value }) {
  return value ? <p><strong>{label} :</strong> {value}</p> : null;
}

const siteLine = (s) => `${s.name}, ${s.city}, ${BUSINESS.country}`;

export function MentionsLegales() {
  const missing = ['legalName', 'legalForm', 'rccm', 'nif', 'director'].filter((k) => !LEGAL[k]);
  return (
    <main id="contenu">
      <PageHero crumbs={[{ label: 'Mentions légales' }]} eyebrow="Informations" title="Mentions légales" />
      <div className="wrap legal">
        {import.meta.env.DEV && missing.length > 0 && (
          <p className="notice">À compléter dans l’espace de gestion, Paramètres → Informations légales : {missing.join(', ')}. Ce message n’apparaît qu’en développement.</p>
        )}
        <h2>Éditeur du site</h2>
        <LegalRow label="Raison sociale" value={LEGAL.legalName || BUSINESS.name} />
        <LegalRow label="Forme juridique" value={LEGAL.legalForm} />
        <LegalRow label="Capital social" value={LEGAL.capital} />
        <LegalRow label="Siège social" value={LEGAL.headOffice} />
        <LegalRow label="RCCM" value={LEGAL.rccm} />
        <LegalRow label="NIF" value={LEGAL.nif} />
        {BUSINESS.sites.map((s) => <LegalRow key={s.id} label={s.role} value={siteLine(s)} />)}
        <LegalRow label="Téléphone" value={BUSINESS.phoneDisplay} />
        <LegalRow label="E-mail" value={BUSINESS.email} />
        <LegalRow label="Directeur de la publication" value={LEGAL.director} />
        <h2>Hébergement</h2>
        <p>{LEGAL.host}</p>
        <h2>Propriété intellectuelle</h2>
        <p>Le logo, les textes et les visuels de ce site appartiennent à {BUSINESS.name}. Toute reproduction sans autorisation écrite est interdite. Les travaux présentés dans la galerie sont publiés avec l’accord des clients concernés.</p>
        <h2>Données personnelles</h2>
        <p>Voir la <Link to="/confidentialite">politique de confidentialité</Link>.</p>
      </div>
    </main>
  );
}

export function Confidentialite() {
  const siege = BUSINESS.sites[0];
  return (
    <main id="contenu">
      <PageHero crumbs={[{ label: 'Confidentialité' }]} eyebrow="Informations" title="Confidentialité" />
      <div className="wrap legal">
        <p>{BUSINESS.name} applique la loi togolaise n° 2019-014 du 29 octobre 2019 relative à la protection des données à caractère personnel.</p>
        <h2>Responsable du traitement</h2>
        <p>{LEGAL.legalName || BUSINESS.name}, {siteLine(siege)}. Contact : {BUSINESS.phoneDisplay}, {BUSINESS.email}.</p>
        <h2>Données collectées</h2>
        <p>Quand vous envoyez une demande de devis, une demande d’inscription à une formation ou créez un compte : votre nom, votre numéro de téléphone, votre adresse e-mail (facultative pour les demandes), la description de votre projet ou la session choisie. Votre mot de passe est enregistré sous une forme chiffrée irréversible.</p>
        <h2>Utilisation</h2>
        <p>Ces données servent uniquement à répondre à votre demande, établir devis et factures, organiser les formations, vous recontacter et suivre vos commandes. Elles ne sont ni vendues ni cédées.</p>
        <h2>Durée de conservation</h2>
        <p>Les demandes sans suite sont conservées au plus 3 ans après le dernier contact. Les données liées aux commandes, factures et formations sont conservées le temps exigé par les obligations comptables.</p>
        <h2>Prestataires</h2>
        <p>Hébergement du site : Vercel. Base de données : Neon. Envoi des e-mails : Resend. Si vous nous écrivez sur WhatsApp, l’échange relève des conditions de WhatsApp (Meta).</p>
        <h2>Vos droits</h2>
        <p>Vous pouvez demander à consulter, corriger ou supprimer vos données, ou vous opposer à leur utilisation, en nous contactant au {BUSINESS.phoneDisplay} ou à {BUSINESS.email}. Vous pouvez aussi saisir l’Instance de protection des données à caractère personnel (IPDCP).</p>
        <h2>Cookies</h2>
        <p>Ce site n’utilise ni publicité ni mesure d’audience. Un seul cookie est déposé, uniquement si vous vous connectez à votre espace client : il garde votre session ouverte.</p>
      </div>
    </main>
  );
}

/** Vérification publique d'une attestation ou d'un certificat E-MAN PROD (code imprimé sur le document). */
export function VerifyCertificate() {
  const initial = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('code') || '';
  const [code, setCode] = useState(initial);
  const [state, setState] = useState({ status: initial ? 'loading' : 'idle' });
  const check = async (value) => {
    const c = value.trim().toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(c)) return setState({ status: 'error', message: 'Le code comporte 16 caractères (chiffres et lettres A à F).' });
    setState({ status: 'loading' });
    try { setState({ status: 'done', result: await space.verify(c) }); } catch (e) { setState({ status: 'error', message: e.message }); }
  };
  useEffect(() => { if (initial) check(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const r = state.result;
  return (
    <main id="contenu">
      <PageHero crumbs={[{ label: 'Vérifier une attestation' }]} eyebrow="Centre de formation" title="Vérifier une attestation" />
      <div className="wrap legal">
        <p>Saisissez le code de vérification imprimé en bas de l’attestation ou du certificat.</p>
        <form className="verifyForm" onSubmit={(e) => { e.preventDefault(); check(code); }}>
          <label className="field"><span className="fieldLabel">Code de vérification</span>
            <input value={code} maxLength={16} autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value)} placeholder="ex. 3FA92C0B7D4E1A65" /></label>
          <button className="btn btnPrimary" disabled={state.status === 'loading'}>{state.status === 'loading' ? 'Vérification…' : 'Vérifier'}</button>
        </form>
        {state.status === 'error' && <p className="formError" role="alert">{state.message}</p>}
        {state.status === 'done' && (r.valid ? (
          <div className="verifyResult ok" role="status">
            <h2>Document authentique</h2>
            <p><strong>{r.kind === 'certificat' ? 'Certificat' : 'Attestation'} n° {r.number}</strong></p>
            <p>Délivré(e) à <strong>{r.holder_name}</strong> pour la formation « {r.training_title} »{r.session_label ? ` (${r.session_label.toLowerCase()})` : ''}, le {new Date(r.issued_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
          </div>
        ) : (
          <div className="verifyResult ko" role="status">
            <h2>{r.revoked ? 'Document révoqué' : 'Aucun document trouvé'}</h2>
            <p>{r.revoked ? `Le document n° ${r.number} a été révoqué par E-MAN PROD et n’est plus valable.` : 'Ce code ne correspond à aucune attestation délivrée par E-MAN PROD. Vérifiez la saisie ou contactez-nous.'}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
