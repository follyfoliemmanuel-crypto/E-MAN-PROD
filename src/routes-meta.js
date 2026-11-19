// Titres et descriptions de chaque page. Utilisé par le site (onglet du navigateur)
// et par scripts/prerender-meta.mjs, qui écrit une page HTML par adresse au moment
// du build pour Google et les aperçus WhatsApp / Facebook.
export const SITE_URL = 'https://www.emanprod.com';

export const ROUTES = {
  '/': {
    title: 'E-MAN PROD | Imprimerie, création graphique et formation au Togo',
    description: 'E-MAN PROD, la référence : impression, création graphique, communication visuelle et formation professionnelle à Baguida et Agbavi (Togo). Devis rapide sur WhatsApp.',
    sitemap: true,
  },
  '/prestations': {
    title: 'Prestations : imprimerie, infographie, sérigraphie, enseignes | E-MAN PROD',
    description: 'Imprimerie, infographie, sérigraphie, enseignes et publicité, papeterie, informatique : les prestations d’E-MAN PROD à Lomé et Agbavi. Devis rapide.',
    sitemap: true,
  },
  '/formations': {
    title: 'Centre de formation professionnelle E-MAN PROD | 3 pôles',
    description: 'Arts graphiques et imprimerie, informatique, maintenance et réseaux, développement web : les formations pratiques du centre E-MAN PROD au Togo.',
    sitemap: true,
  },
  '/realisations': {
    title: 'Nos réalisations | E-MAN PROD',
    description: 'Galerie des réalisations E-MAN PROD : infographie, impression, sérigraphie, enseignes, personnalisation et packaging.',
    sitemap: true,
  },
  '/a-propos': {
    title: 'À propos d’E-MAN PROD | La référence',
    description: 'E-MAN PROD, entreprise togolaise d’imprimerie, d’infographie, de communication visuelle, de formation et d’informatique. Siège à Baguida, annexe à Agbavi.',
    sitemap: true,
  },
  '/e-man-cars': {
    title: 'E-MAN CARS | Véhicules neufs et haut de gamme',
    description: 'E-MAN CARS, la branche automobile du groupe E-MAN : véhicules neufs et haut de gamme.',
    sitemap: true,
  },
  '/contact': {
    title: 'Contact et devis | E-MAN PROD — Baguida et Agbavi',
    description: 'Contactez E-MAN PROD au Nouveau Marché de Baguida (Lomé) ou à Agbavi Yésuvito, sur WhatsApp au +228 91 38 84 05 ou par e-mail à emanprod3@gmail.com.',
    sitemap: true,
  },
  '/espace': {
    title: 'Mon espace | E-MAN PROD',
    description: 'Suivez vos demandes de devis et commandes E-MAN PROD.',
    noindex: true,
  },
  '/mentions-legales': {
    title: 'Mentions légales | E-MAN PROD',
    description: 'Mentions légales du site E-MAN PROD.',
    sitemap: true,
  },
  '/confidentialite': {
    title: 'Politique de confidentialité | E-MAN PROD',
    description: 'Comment E-MAN PROD collecte et protège vos données personnelles.',
    sitemap: true,
  },
};

export const NOT_FOUND = {
  title: 'Page introuvable | E-MAN PROD',
  description: 'Cette page n’existe pas.',
  noindex: true,
};
