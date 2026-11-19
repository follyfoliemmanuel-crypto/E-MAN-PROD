// ---------------------------------------------------------------------------
// Réglages fixes du site : coordonnées, informations légales, emplacements
// d'images. Le CONTENU (prestations, formations, réalisations, textes « À
// propos » et E-MAN CARS) n'est plus ici : il est en base de données, chargé
// au départ depuis src/content/seed.js et modifiable depuis l'administration.
// Un champ laissé vide ('' ou []) est simplement masqué sur le site.
// ---------------------------------------------------------------------------
import phGrandFormat from './assets/placeholders/grand-format.svg';
import phTextile from './assets/placeholders/textile.svg';
import phSerigraphie from './assets/placeholders/serigraphie.svg';
import phStudio from './assets/placeholders/studio.svg';
import phAtelierInfo from './assets/placeholders/atelier-info.svg';
import phMaintenance from './assets/placeholders/maintenance.svg';
import phReseau from './assets/placeholders/reseau.svg';
import phDevWeb from './assets/placeholders/dev-web.svg';
import phSignaletique from './assets/placeholders/signaletique.svg';
import phFournitures from './assets/placeholders/fournitures.svg';
import phCars from './assets/placeholders/cars.svg';

export const BUSINESS = {
  name: 'E-MAN PROD',
  slogan: 'E-man Prod, la référence !',
  website: 'https://www.emanprod.com',
  whatsapp: (import.meta.env.VITE_WHATSAPP_NUMBER || '22891388405').replace(/\D/g, ''),
  phoneDisplay: '+228 91 38 84 05',
  email: import.meta.env.VITE_CONTACT_EMAIL || 'emanprod3@gmail.com',
  country: 'Togo',
  // Implantations : le siège d'abord. `mapsUrl` peut être remplacé par le lien
  // « Partager » de la fiche Google Business de chaque site.
  sites: [
    {
      id: 'siege',
      role: 'Siège',
      name: 'Nouveau Marché de Baguida',
      city: 'Lomé',
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Nouveau Marché de Baguida, Lomé, Togo'),
      hours: [], // ex. [{ days: 'Lundi – vendredi', time: '8 h – 18 h' }]
    },
    {
      id: 'annexe',
      role: 'Annexe',
      name: 'Agbavi, Yésuvito',
      city: 'Togo',
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Agbavi Yésuvito, Togo'),
      hours: [],
    },
  ],
  socials: { facebook: '', instagram: '', tiktok: '', linkedin: '', youtube: '', x: '' },
  // Numéros WhatsApp par usage (Paramètres → WhatsApp). Vide = numéro principal.
  wa: {},
};

/** Boutons WhatsApp configurables et leur message prérempli par défaut. */
export const WHATSAPP_PURPOSES = {
  contact: { label: 'Contact direct', message: 'Bonjour E-MAN PROD,' },
  info: { label: 'Demande de renseignements', message: 'Bonjour E-MAN PROD, je souhaite un renseignement.' },
  quote: { label: 'Demande de devis', message: 'Bonjour E-MAN PROD, je souhaite un devis.' },
  support: { label: 'Assistance', message: 'Bonjour, j’ai besoin d’aide avec mon espace client E-MAN PROD.' },
  training: { label: 'Orientation formation', message: 'Bonjour, je souhaite être orienté(e) vers une formation E-MAN PROD.' },
};

/**
 * Applique les coordonnées enregistrées dans l'admin (réglage « business ») par-dessus
 * les valeurs ci-dessus. Renvoie true si quelque chose a changé.
 */
export function applySettings(content = {}) {
  const before = JSON.stringify([BUSINESS, LEGAL]);
  const b = content.business || {};
  const digitsOf = (v) => String(v || '').replace(/\D/g, '');
  // Numéros WhatsApp par usage et messages préremplis.
  if (content.whatsapp) {
    BUSINESS.wa = Object.fromEntries(Object.entries(content.whatsapp).filter(([, v]) => v).map(([k, v]) => [k, { number: digitsOf(v.number), message: v.message || '' }]));
  }
  if (content.socials) for (const [k, v] of Object.entries(content.socials)) BUSINESS.socials[k] = v || '';
  if (content.legal) for (const [k, v] of Object.entries(content.legal)) if (v) LEGAL[k] = v;
  if (!content.business) return JSON.stringify([BUSINESS, LEGAL]) !== before;
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const pretty = (v) => {
    const d = digits(v);
    return d.length === 11 && d.startsWith('228') ? `+228 ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : v;
  };
  if (b.slogan) BUSINESS.slogan = b.slogan;
  if (b.email) BUSINESS.email = b.email;
  if (b.phone) BUSINESS.phoneDisplay = pretty(b.phone);
  if (b.whatsapp || b.phone) BUSINESS.whatsapp = digits(b.whatsapp || b.phone);
  if (Array.isArray(b.sites) && b.sites.length) {
    BUSINESS.sites = b.sites.map((s, i) => ({
      id: `site-${i}`, role: s.label, name: s.address, city: '', hours: [],
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${s.address}, Togo`),
    }));
  }
  if (b.hours) BUSINESS.hoursText = b.hours;
  return JSON.stringify([BUSINESS, LEGAL]) !== before;
}

// Mentions légales : obligatoires avant l'ouverture publique.
export const LEGAL = {
  legalName: '',
  legalForm: '',
  rccm: '',
  nif: '',
  director: '',
  capital: '',
  headOffice: '',
  host: 'Vercel Inc. (https://vercel.com) ; base de données : Neon (https://neon.com)',
};

// Avis de vrais clients uniquement (avec leur accord). Section masquée si vide.
export const TESTIMONIALS = [];

// Les trois cartes « Pour qui » de l'accueil.
export const AUDIENCES = [
  {
    tone: 'paper',
    badge: 'Professionnels et institutions',
    title: 'Entreprises, commerces, ONG et administrations',
    text: 'Enseignes, bâches, supports de communication, tenues d’équipe et habillage de véhicules.',
    cta: 'Demander un devis',
    action: 'quote',
  },
  {
    tone: 'sky',
    badge: 'Particuliers',
    title: 'Vos événements, à votre image',
    text: 'Faire-part, t-shirts et mugs personnalisés, kakémonos pour une fête ou une cérémonie.',
    cta: 'Voir les prestations',
    to: '/prestations',
  },
  {
    tone: 'ink',
    badge: 'Centre de formation',
    title: 'Apprendre un métier, en pratique',
    text: 'Arts graphiques et imprimerie, informatique et réseaux, développement web : trois pôles de formation.',
    cta: 'Voir les formations',
    to: '/formations',
  },
];

/**
 * Lien WhatsApp. `purpose` choisit le numéro configuré pour cet usage (contact, info, quote,
 * support, training) ; sans numéro propre, le numéro principal est utilisé. Sans texte, le
 * message prérempli de l'usage est proposé.
 */
export const whatsappLink = (text, purpose = 'contact') => {
  const cfg = BUSINESS.wa?.[purpose] || {};
  const number = cfg.number || BUSINESS.whatsapp;
  const msg = text ?? (cfg.message || WHATSAPP_PURPOSES[purpose]?.message || '');
  return `https://wa.me/${number}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
};

// ---------------------------------------------------------------------------
// Visuels provisoires (sans texte) : affichés tant qu'aucune photo n'a été
// choisie dans l'admin, onglet « Images du site ».
// ---------------------------------------------------------------------------
export const PLACEHOLDERS = {
  'grand-format': phGrandFormat, textile: phTextile, serigraphie: phSerigraphie, studio: phStudio,
  'atelier-info': phAtelierInfo, maintenance: phMaintenance, reseau: phReseau, 'dev-web': phDevWeb,
  signaletique: phSignaletique, fournitures: phFournitures, cars: phCars,
};
const ph = (name) => PLACEHOLDERS[name] || phGrandFormat;

// Emplacements fixes. Ceux des prestations et des formations sont créés
// automatiquement à partir du catalogue (prestation-<slug>, course-<slug>).
export const MEDIA_SLOTS = [
  { slot: 'hero-1', group: 'Carrousel d’accueil', label: 'Diapositive 1 : impression grand format', fallback: ph('grand-format'), alt: 'Impression grand format' },
  { slot: 'hero-2', group: 'Carrousel d’accueil', label: 'Diapositive 2 : impression textile', fallback: ph('textile'), alt: 'Impression textile' },
  { slot: 'hero-3', group: 'Carrousel d’accueil', label: 'Diapositive 3 : graphistes en studio', fallback: ph('studio'), alt: 'Graphistes en studio' },
  { slot: 'hero-4', group: 'Carrousel d’accueil', label: 'Diapositive 4 : formation en développement web', fallback: ph('dev-web'), alt: 'Formation en développement web' },
  { slot: 'training-band', group: 'Pages', label: 'Fond du bandeau « Centre de formation »', fallback: ph('atelier-info'), alt: 'Atelier informatique' },
  { slot: 'about-photo', group: 'Pages', label: 'Photo de la page « À propos »', fallback: ph('studio'), alt: 'L’équipe E-MAN PROD' },
  { slot: 'cars-hero', group: 'Pages', label: 'Photo d’en-tête E-MAN CARS', fallback: ph('cars'), alt: 'E-MAN CARS' },
];

export const HERO_SLIDES = [
  { slot: 'hero-1', theme: 'Impression grand format' },
  { slot: 'hero-2', theme: 'Impression textile' },
  { slot: 'hero-3', theme: 'Création graphique' },
  { slot: 'hero-4', theme: 'Formation professionnelle' },
];

export const GALLERY_CATEGORIES = [
  { slug: 'infographie', label: 'Infographie' },
  { slug: 'impression', label: 'Impression' },
  { slug: 'serigraphie', label: 'Sérigraphie' },
  { slug: 'enseignes', label: 'Enseignes' },
  { slug: 'personnalisation', label: 'Personnalisation' },
  { slug: 'packaging', label: 'Packaging' },
];
