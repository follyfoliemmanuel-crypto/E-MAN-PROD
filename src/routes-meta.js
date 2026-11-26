// Titres et descriptions de chaque page. Utilisé par le site (onglet du navigateur)
// et par scripts/prerender-meta.mjs, qui écrit une page HTML par adresse au moment
// du build pour Google et les aperçus WhatsApp / Facebook.
// Adresse publique du site : SITE_URL (une seule variable, lue au build par vite.config.js
// et par le prérendu), sinon le domaine de production Vercel, sinon le domaine prévu.
const viteEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
const nodeEnv = typeof process !== 'undefined' ? process.env : undefined;
const vercelUrl = nodeEnv?.VERCEL_PROJECT_PRODUCTION_URL ? `https://${nodeEnv.VERCEL_PROJECT_PRODUCTION_URL}` : '';
export const SITE_URL = (viteEnv?.VITE_SITE_URL || nodeEnv?.SITE_URL || nodeEnv?.VITE_SITE_URL || vercelUrl || 'https://www.emanprod.com').replace(/\/$/, '');

export const ROUTES = {
  '/': {
    title: 'E-MAN PROD | Imprimerie, création graphique et formation au Togo',
    description: 'E-MAN PROD, la référence : impression, création graphique, communication visuelle et formation professionnelle à Baguida et Agbavi (Togo). Devis rapide sur WhatsApp.',
    sitemap: true,
  },
  '/prestations': {
    title: 'Imprimerie, infographie, enseignes à Lomé | E-MAN PROD',
    description: 'Imprimerie, infographie, sérigraphie, enseignes et publicité, papeterie, informatique : les prestations d’E-MAN PROD à Lomé et Agbavi. Devis rapide.',
    sitemap: true,
  },
  '/formations': {
    title: 'Centre de formation professionnelle à Lomé (Togo) | E-MAN PROD',
    description: 'Arts graphiques et imprimerie, informatique, maintenance et réseaux, développement web : les formations pratiques du centre E-MAN PROD au Togo.',
    sitemap: true,
  },
  '/realisations': {
    title: 'Nos réalisations à Lomé : impression, enseignes, textile | E-MAN PROD',
    description: 'Galerie des réalisations d’E-MAN PROD à Lomé (Togo) : infographie, impression grand format, sérigraphie, enseignes, personnalisation textile et packaging.',
    sitemap: true,
  },
  '/a-propos': {
    title: 'À propos d’E-MAN PROD | La référence',
    description: 'E-MAN PROD, entreprise togolaise d’imprimerie, d’infographie, de communication visuelle, de formation et d’informatique. Siège à Baguida, annexe à Agbavi.',
    sitemap: true,
  },
  '/e-man-cars': {
    title: 'E-MAN CARS : véhicules neufs et haut de gamme au Togo | E-MAN PROD',
    description: 'E-MAN CARS, la branche automobile du groupe E-MAN au Togo : véhicules neufs et haut de gamme. Renseignements par WhatsApp ou au Nouveau Marché de Baguida.',
    sitemap: true,
  },
  '/contact': {
    title: 'Contact et devis | E-MAN PROD — Baguida et Agbavi',
    description: 'Contactez E-MAN PROD au Nouveau Marché de Baguida (Lomé) ou à Agbavi Yésuvito, sur WhatsApp au +228 91 38 84 05 ou par e-mail à emanprod3@gmail.com.',
    sitemap: true,
  },
  '/espace': {
    title: 'Mon espace | E-MAN PROD',
    description: 'Votre espace E-MAN PROD : suivez vos demandes de devis, vos commandes, vos formations, vos factures et vos documents.',
    noindex: true,
  },
  '/mentions-legales': {
    title: 'Mentions légales | E-MAN PROD',
    description: 'Mentions légales du site E-MAN PROD : éditeur, siège au Nouveau Marché de Baguida (Lomé, Togo), hébergement, propriété intellectuelle et contact.',
    sitemap: true,
  },
  '/confidentialite': {
    title: 'Politique de confidentialité | E-MAN PROD',
    description: 'Comment E-MAN PROD (Baguida, Togo) collecte, utilise et protège vos données personnelles (devis, commandes, formations) et comment exercer vos droits.',
    sitemap: true,
  },
  '/conditions-generales': {
    title: 'Conditions générales | E-MAN PROD',
    description: 'Conditions générales d’E-MAN PROD (Lomé, Togo) : devis, commandes, bon à tirer, paiement, délais, réclamations et formations.',
    sitemap: true,
  },
  '/verifier': {
    title: 'Vérifier une attestation de formation | E-MAN PROD',
    description: 'Vérifiez l’authenticité d’une attestation ou d’un certificat délivré par le centre de formation E-MAN PROD (Togo) grâce au code imprimé sur le document.',
    sitemap: true,
  },
};

export const NOT_FOUND = {
  title: 'Page introuvable | E-MAN PROD',
  description: 'Cette page n’existe pas.',
  noindex: true,
};

// ---------------------------------------------------------------------------------------
// Pages dynamiques : titre, description et données structurées (schema.org) d'une
// formation ou d'une prestation. Utilisé par le site et par le prérendu du build.
const ORG = { '@type': 'Organization', name: 'E-MAN PROD', sameAs: SITE_URL };
const clip = (s, n = 158) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
const crumbs = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE_URL + path })),
});

export function courseMeta(c) {
  const path = `/formations/${c.slug}`;
  return {
    // Titre court (moins de 66 caractères) : Google coupe les titres plus longs.
    title: [`Formation ${c.title} à Lomé | E-MAN PROD`, `${c.title} à Lomé | E-MAN PROD`, `${c.title} | E-MAN PROD`].find((t) => t.length <= 65) || `${c.title} | E-MAN PROD`,
    description: clip(`${c.summary} Formation pratique au centre E-MAN PROD, Baguida (Lomé, Togo)${c.duration ? `, durée ${c.duration}` : ''}.`),
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: c.title,
        description: c.description || c.summary,
        url: SITE_URL + path,
        inLanguage: 'fr',
        provider: ORG,
        ...(c.price_fcfa ? { offers: { '@type': 'Offer', price: String(c.price_fcfa), priceCurrency: 'XOF', category: 'Paid' } } : {}),
        ...(c.duration ? { timeRequired: c.duration } : {}),
      },
      crumbs([['Accueil', '/'], ['Formations', '/formations'], [c.title, path]]),
    ],
  };
}

export function serviceMeta(p) {
  const path = `/prestations/${p.slug}`;
  return {
    title: [`${p.title} à Lomé (Togo) | E-MAN PROD`, `${p.title} à Lomé | E-MAN PROD`].find((t) => t.length <= 65) || `${p.title} | E-MAN PROD`,
    description: clip(`${p.summary} E-MAN PROD, Nouveau Marché de Baguida et Agbavi (Lomé, Togo). Devis rapide sur WhatsApp.`),
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: p.title,
        description: p.summary,
        url: SITE_URL + path,
        areaServed: { '@type': 'Country', name: 'Togo' },
        provider: { '@type': 'LocalBusiness', '@id': `${SITE_URL}/#entreprise`, name: 'E-MAN PROD' },
      },
      crumbs([['Accueil', '/'], ['Prestations', '/prestations'], [p.title, path]]),
    ],
  };
}
