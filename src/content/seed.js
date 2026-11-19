// Contenu initial du site, chargé dans la base par `npm run db:setup`.
// Ensuite, c'est la base qui fait foi : les modifications faites dans l'admin
// ne sont jamais écrasées par ce fichier. Il sert aussi au mode démonstration.
//
// Règle : aucune information pratique inventée. Tarifs, durées, niveaux,
// prérequis, attestations, dates et places restent vides (null) et se
// renseignent depuis l'administration.

export const PRESTATIONS = [
  {
    slug: 'imprimerie',
    title: 'Imprimerie',
    summary: 'Impression papier, bâche, vinyle, autocollant et textile, des petites séries aux grandes quantités.',
    intro: 'Nous imprimons vos supports de communication et vos commandes personnalisées, sur papier comme sur grand format et textile. Envoyez-nous votre fichier, ou faites-le préparer par nos infographistes.',
    offerings: ['Impression papier', 'Bâches', 'Vinyle', 'Autocollants', 'Impression textile', 'DTF', 'Sublimation', 'Affiches', 'Flyers', 'Banderoles'],
    placeholder: 'grand-format',
    related_pole: 'arts-graphiques',
    sort: 1,
  },
  {
    slug: 'infographie',
    title: 'Infographie',
    summary: 'Logos, identité visuelle, affiches, brochures, cartes de visite, packaging et visuels numériques.',
    intro: 'Nos infographistes conçoivent l’image de votre entreprise, de votre événement ou de votre produit, et préparent des fichiers prêts à imprimer ou à publier sur les réseaux.',
    offerings: ['Logos', 'Identité visuelle', 'Affiches', 'Brochures', 'Cartes de visite', 'Packaging', 'Visuels numériques'],
    placeholder: 'studio',
    related_pole: 'arts-graphiques',
    sort: 2,
  },
  {
    slug: 'serigraphie',
    title: 'Sérigraphie',
    summary: 'Sérigraphie artisanale et moderne, impression textile et personnalisation.',
    intro: 'La sérigraphie permet des marquages résistants et économiques en série. Nous l’associons aux techniques d’impression textile pour personnaliser vos vêtements et objets.',
    offerings: ['Sérigraphie artisanale', 'Sérigraphie moderne', 'Impression textile', 'Personnalisation'],
    placeholder: 'serigraphie',
    related_pole: 'arts-graphiques',
    sort: 3,
  },
  {
    slug: 'enseignes-publicite',
    title: 'Enseignes et publicité',
    summary: 'Panneaux, plaques professionnelles, enseignes, habillage de vitrines et de véhicules.',
    intro: 'Nous fabriquons et posons les supports qui rendent votre activité visible : de la plaque professionnelle à l’habillage complet d’une vitrine ou d’un véhicule.',
    offerings: ['Panneaux', 'Plaques professionnelles', 'Enseignes', 'Habillage de vitrines', 'Habillage de véhicules', 'Supports publicitaires'],
    placeholder: 'signaletique',
    related_pole: null,
    sort: 4,
  },
  {
    slug: 'papeterie',
    title: 'Papeterie',
    summary: 'Fournitures de bureau et articles de papeterie.',
    intro: 'Nous proposons les fournitures de bureau et les articles de papeterie du quotidien, pour les entreprises, les écoles et les particuliers.',
    offerings: ['Fournitures de bureau', 'Articles de papeterie'],
    placeholder: 'fournitures',
    related_pole: null,
    sort: 5,
  },
  {
    // 6e prestation, déduite de « l'informatique et les technologies numériques ».
    // À masquer depuis l'admin (ou published: false) si elle n'est pas proposée.
    slug: 'informatique',
    title: 'Informatique et réseaux',
    summary: 'Maintenance informatique et installation de réseaux pour les bureaux et commerces.',
    intro: 'Nous intervenons sur vos ordinateurs et vos réseaux : diagnostic, dépannage, installation et configuration.',
    offerings: ['Diagnostic et dépannage', 'Maintenance matérielle et logicielle', 'Installation de systèmes', 'Câblage et réseaux LAN', 'Configuration de routeurs et switchs'],
    placeholder: 'maintenance',
    related_pole: 'informatique',
    sort: 6,
  },
];

export const POLES = [
  { slug: 'arts-graphiques', number: 1, title: 'Arts graphiques et imprimerie', summary: 'Infographie, design graphique, identité visuelle, impression numérique et grand format, sérigraphie, DTF, sublimation et personnalisation textile.', sort: 1 },
  { slug: 'informatique', number: 2, title: 'Informatique, maintenance et réseaux', summary: 'Informatique et bureautique, maintenance matérielle et logicielle, sécurité informatique et réseaux.', sort: 2 },
  { slug: 'web', number: 3, title: 'Développement web et technologies numériques', summary: 'HTML, CSS, JavaScript, sites vitrines et responsives, développement dynamique, bases de données, administration et mise en ligne.', sort: 3 },
];

const course = (c) => ({
  duration: null, level: null, prerequisites: null, price_fcfa: null, price_note: null, certificate: null,
  ...c,
});

export const COURSES = [
  // ----- Pôle 1 -------------------------------------------------------------
  course({
    slug: 'infographie-design-graphique', pole_slug: 'arts-graphiques', sort: 1, placeholder: 'studio',
    title: 'Infographie et design graphique', domain: 'Arts graphiques',
    summary: 'Apprendre à concevoir des visuels professionnels et à préparer des fichiers pour l’impression et le numérique.',
    description: 'Une formation pratique pour maîtriser les bases de l’infographie et du design graphique : composition, couleurs, typographie et préparation des fichiers, à partir de cas réels de l’atelier.',
    objectives: ['Comprendre les règles de composition, de couleur et de typographie', 'Réaliser des visuels pour l’impression et les réseaux sociaux', 'Préparer des fichiers conformes aux exigences de l’imprimeur'],
    program: ['Infographie', 'Design graphique', 'Mise en page', 'Préparation des fichiers pour l’impression'],
  }),
  course({
    slug: 'logo-identite-visuelle', pole_slug: 'arts-graphiques', sort: 2, placeholder: 'studio',
    title: 'Création de logos et identité visuelle', domain: 'Arts graphiques',
    summary: 'Concevoir un logo et décliner une identité visuelle cohérente sur tous les supports.',
    description: 'De la recherche d’idées à la charte graphique, cette formation montre comment créer un logo et l’appliquer de façon cohérente sur les supports d’une marque.',
    objectives: ['Mener une recherche créative à partir d’un besoin client', 'Dessiner et finaliser un logo', 'Décliner une identité visuelle sur différents supports'],
    program: ['Création de logos', 'Identité visuelle', 'Charte graphique', 'Déclinaison sur supports'],
  }),
  course({
    slug: 'impression-numerique-grand-format', pole_slug: 'arts-graphiques', sort: 3, placeholder: 'grand-format',
    title: 'Impression numérique et grand format', domain: 'Imprimerie',
    summary: 'Utiliser les machines d’impression numérique et grand format, du réglage à la finition.',
    description: 'Une formation sur machine pour comprendre la chaîne d’impression : préparation, choix des supports, réglages, contrôle qualité et finitions.',
    objectives: ['Choisir le support et les réglages adaptés à une commande', 'Lancer et contrôler une impression numérique ou grand format', 'Réaliser les finitions courantes'],
    program: ['Impression numérique', 'Impression grand format', 'Choix des supports', 'Contrôle qualité et finition'],
  }),
  course({
    slug: 'serigraphie', pole_slug: 'arts-graphiques', sort: 4, placeholder: 'serigraphie',
    title: 'Sérigraphie', domain: 'Imprimerie',
    summary: 'Maîtriser les étapes de la sérigraphie, de la préparation de l’écran au tirage.',
    description: 'Une formation pratique aux techniques de sérigraphie artisanale et moderne, sur textile et autres supports.',
    objectives: ['Préparer un écran de sérigraphie', 'Réaliser un tirage propre en une ou plusieurs couleurs', 'Entretenir le matériel'],
    program: ['Sérigraphie artisanale', 'Sérigraphie moderne', 'Préparation des écrans', 'Tirage et séchage'],
  }),
  course({
    slug: 'dtf-sublimation-personnalisation', pole_slug: 'arts-graphiques', sort: 5, placeholder: 'textile',
    title: 'DTF, sublimation et personnalisation textile', domain: 'Personnalisation',
    summary: 'Personnaliser textiles et objets avec les procédés DTF et sublimation.',
    description: 'Une formation pour produire des articles personnalisés : t-shirts, polos, mugs et objets, avec les procédés DTF et sublimation.',
    objectives: ['Choisir le procédé adapté au support', 'Préparer et presser un transfert', 'Garantir la tenue du marquage'],
    program: ['DTF', 'Sublimation', 'Personnalisation textile', 'Pressage et finition'],
  }),
  // ----- Pôle 2 -------------------------------------------------------------
  course({
    slug: 'informatique-bureautique', pole_slug: 'informatique', sort: 1, placeholder: 'atelier-info',
    title: 'Informatique et bureautique', domain: 'Informatique',
    summary: 'Utiliser l’ordinateur et les logiciels de bureau au quotidien, avec aisance.',
    description: 'Une formation pour prendre en main l’ordinateur, les logiciels de bureautique et les outils numériques utilisés en entreprise.',
    objectives: ['Utiliser Windows et organiser ses fichiers', 'Produire documents, tableaux et présentations', 'Utiliser Internet et les outils numériques en sécurité'],
    program: ['Windows', 'Word', 'Excel', 'PowerPoint', 'Internet', 'Outils numériques'],
  }),
  course({
    slug: 'maintenance-informatique', pole_slug: 'informatique', sort: 2, placeholder: 'maintenance',
    title: 'Maintenance informatique', domain: 'Informatique',
    summary: 'Diagnostiquer, dépanner et entretenir les ordinateurs.',
    description: 'Une formation pratique au diagnostic et au dépannage, au montage des ordinateurs et à l’installation des systèmes.',
    objectives: ['Diagnostiquer une panne matérielle ou logicielle', 'Monter, démonter et installer un poste de travail', 'Appliquer les bonnes pratiques de sécurité informatique'],
    program: ['Diagnostic informatique', 'Dépannage', 'Montage et démontage PC', 'Installation des systèmes', 'Maintenance matérielle et logicielle', 'Sécurité informatique'],
  }),
  course({
    slug: 'reseaux-informatiques', pole_slug: 'informatique', sort: 3, placeholder: 'reseau',
    title: 'Réseaux informatiques', domain: 'Réseaux',
    summary: 'Concevoir, câbler et configurer un réseau local.',
    description: 'Une formation pour comprendre l’architecture d’un réseau, réaliser le câblage et configurer les équipements d’un réseau local.',
    objectives: ['Comprendre l’architecture d’un réseau local', 'Réaliser un câblage RJ45', 'Configurer et dépanner routeurs et switchs'],
    program: ['Architecture réseau', 'Câblage RJ45', 'Routeurs', 'Switchs', 'Réseaux LAN', 'Configuration et dépannage'],
  }),
  // ----- Pôle 3 -------------------------------------------------------------
  course({
    slug: 'html-css-javascript', pole_slug: 'web', sort: 1, placeholder: 'dev-web',
    title: 'HTML, CSS et JavaScript', domain: 'Développement web',
    summary: 'Les bases indispensables pour créer des pages web.',
    description: 'Une formation pour apprendre les trois langages du web et construire ses premières pages interactives.',
    objectives: ['Structurer une page avec HTML', 'La mettre en forme avec CSS', 'Ajouter de l’interactivité avec JavaScript'],
    program: ['HTML', 'CSS', 'JavaScript'],
  }),
  course({
    slug: 'sites-vitrines-responsives', pole_slug: 'web', sort: 2, placeholder: 'dev-web',
    title: 'Sites vitrines et responsives', domain: 'Développement web',
    summary: 'Créer un site vitrine qui s’affiche bien sur ordinateur, tablette et téléphone.',
    description: 'Une formation orientée projet : concevoir et réaliser un site vitrine complet, adapté à tous les écrans.',
    objectives: ['Concevoir l’arborescence d’un site vitrine', 'Réaliser des pages adaptées à tous les écrans', 'Publier un site prêt à être présenté à un client'],
    program: ['Création de sites vitrines', 'Sites web responsives'],
  }),
  course({
    slug: 'developpement-web-dynamique', pole_slug: 'web', sort: 3, placeholder: 'dev-web',
    title: 'Développement web dynamique et bases de données', domain: 'Développement web',
    summary: 'Créer des sites qui enregistrent et affichent des données.',
    description: 'Une formation pour passer du site statique au site dynamique : formulaires, traitement des données et bases de données.',
    objectives: ['Comprendre le fonctionnement d’un site dynamique', 'Concevoir une base de données simple', 'Relier un site à une base de données'],
    program: ['Développement web dynamique', 'Bases de données'],
  }),
  course({
    slug: 'administration-hebergement', pole_slug: 'web', sort: 4, placeholder: 'dev-web',
    title: 'Administration, hébergement et mise en ligne', domain: 'Technologies numériques',
    summary: 'Mettre un site en ligne et l’administrer au quotidien.',
    description: 'Une formation pour choisir un hébergement, mettre un site en ligne et assurer son administration.',
    objectives: ['Choisir un hébergement et un nom de domaine', 'Mettre en ligne un site', 'Administrer et mettre à jour un site'],
    program: ['Administration de sites web', 'Hébergement et mise en ligne'],
  }),
];

export const CONTENT = {
  // Coordonnées affichées sur le site, modifiables ensuite dans l'admin (réglage « business »).
  business: {
    slogan: 'E-man Prod, la référence !',
    email: 'emanprod3@gmail.com',
    phone: '+22891388405',
    whatsapp: '+22891388405',
    sites: [
      { label: 'Siège', address: 'Nouveau Marché de Baguida, Lomé' },
      { label: 'Annexe', address: 'Agbavi, Yésuvito' },
    ],
    hours: null,
  },
  about: {
    title: 'E-MAN PROD',
    lead: 'E-MAN PROD est une entreprise togolaise spécialisée dans l’imprimerie, l’infographie, la communication visuelle, la sérigraphie, la personnalisation, la formation professionnelle, l’informatique et les technologies numériques.',
    activities: ['Imprimerie', 'Infographie', 'Communication visuelle', 'Sérigraphie', 'Personnalisation', 'Formation professionnelle', 'Informatique et technologies numériques'],
  },
  cars: {
    title: 'E-MAN CARS',
    tagline: 'Véhicules neufs et haut de gamme',
    intro: 'E-MAN CARS est la branche commerciale du groupe E-MAN spécialisée dans les véhicules neufs et haut de gamme.',
    offers: [
      { title: 'Véhicules neufs', text: 'Des véhicules neufs, pour les particuliers comme pour les entreprises.' },
      { title: 'Haut de gamme', text: 'Une sélection de véhicules haut de gamme.' },
    ],
    contactText: 'Pour connaître les véhicules disponibles, contactez l’équipe E-MAN CARS.',
  },
};

export const GALLERY_CATEGORIES = [
  { slug: 'infographie', label: 'Infographie' },
  { slug: 'impression', label: 'Impression' },
  { slug: 'serigraphie', label: 'Sérigraphie' },
  { slug: 'enseignes', label: 'Enseignes' },
  { slug: 'personnalisation', label: 'Personnalisation' },
  { slug: 'packaging', label: 'Packaging' },
];

/** Requêtes de chargement initial : insertion sans écraser l'existant. */
export function seedStatements() {
  const q = [];
  // Ordre imposé par les liens : pôles, puis prestations (liées à un pôle), puis formations.
  for (const p of POLES) {
    q.push({
      text: `insert into training_categories (slug, number, title, summary, sort) values ($1, $2, $3, $4, $5)
             on conflict (slug) do nothing returning slug`,
      params: [p.slug, p.number, p.title, p.summary, p.sort],
    });
  }
  for (const p of PRESTATIONS) {
    q.push({
      text: `insert into services (slug, title, summary, intro, offerings, placeholder, related_category_slug, sort)
             values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8) on conflict (slug) do nothing returning slug`,
      params: [p.slug, p.title, p.summary, p.intro, JSON.stringify(p.offerings), p.placeholder, p.related_pole, p.sort],
    });
  }
  for (const c of COURSES) {
    q.push({
      text: `insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10) on conflict (slug) do nothing returning slug`,
      params: [c.slug, c.pole_slug, c.title, c.domain, c.summary, c.description, JSON.stringify(c.objectives), JSON.stringify(c.program), c.placeholder, c.sort],
    });
  }
  for (const [key, value] of Object.entries(CONTENT)) {
    q.push({
      text: `insert into site_settings (key, value) values ($1, $2::jsonb) on conflict (key) do nothing returning key`,
      params: [key, JSON.stringify(value)],
    });
  }
  return q;
}
