// Fiche de renseignements du centre de formation (2026) : les 7 modules proposés.
//
// Import UNIQUE et sans doublon, joué après le contenu de départ (npm run db:migrate, déploiement
// Vercel ou install-neon.sql) :
//   • chaque module est d'abord recherché parmi les formations déjà en base (identifiant connu,
//     puis intitulé proche) ; s'il existe, son enregistrement, ses textes et ses inscriptions sont
//     conservés, et seuls les champs encore VIDES reçoivent la valeur de référence de la fiche ;
//   • seuls les modules absents sont ajoutés ;
//   • l'import se note dans site_settings (« import_fiche_formations ») et ne se rejoue jamais :
//     ensuite, tout se modifie librement dans l'administration (Formations).
//
// Les montants et le niveau ci-dessous ne sont que des valeurs de départ, modifiables à tout moment.
export const FICHE_REFERENCE = {
  registration_fee_fcfa: 10000,
  level: 'Collège et plus',
  // Durées visibles sur la fiche : proposées en un clic dans l'administration, jamais imposées.
  duration_suggestions: ['3 mois + stage', '5 mois + stage', '6 mois + stage', '12 mois'],
};

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const FICHE_MODULES = [
  {
    name: 'CM Community Manager',
    slugs: ['community-manager', 'community-management', 'cm-community-manager'],
    // « CM » seul est trop court pour être cherché dans un titre : on s'appuie sur « community ».
    match: 'community',
    create: {
      slug: 'community-manager', pole_slug: 'web', placeholder: 'dev-web',
      title: 'Community manager (CM)', domain: 'Communication digitale',
      summary: 'Animer les réseaux sociais d’une entreprise : contenus, publications, communauté et résultats.',
      description: 'Une formation pratique pour gérer la présence d’une marque sur les réseaux sociais : stratégie, création de visuels et de textes, planification, échanges avec la communauté et lecture des statistiques.',
      objectives: [
        'Définir une ligne éditoriale adaptée à une entreprise',
        'Créer des publications (visuels, textes, courtes vidéos)',
        'Planifier et animer une page ou un compte professionnel',
        'Répondre à la communauté et gérer les avis',
        'Lire les statistiques et ajuster les actions',
      ],
      program: [
        'Panorama des réseaux sociais (Facebook, Instagram, TikTok, WhatsApp Business, LinkedIn)',
        'Stratégie et calendrier éditorial',
        'Création de contenus visuels et rédaction',
        'Animation de communauté et service client en ligne',
        'Publicité sur les réseaux : les bases',
        'Statistiques et bilan',
      ],
    },
  },
  { name: 'Informatique bureautique', slugs: ['informatique-bureautique'], match: '^(informatique.*bureautique|bureautique)' },
  {
    name: 'Secrétariat bureautique',
    slugs: ['secretariat-bureautique', 'secretariat'],
    match: 'secretariat',
    create: {
      slug: 'secretariat-bureautique', pole_slug: 'informatique', placeholder: 'atelier-info',
      title: 'Secrétariat bureautique', domain: 'Bureautique',
      summary: 'Maîtriser les outils et les tâches d’un poste de secrétariat : courriers, tableaux, classement et accueil.',
      description: 'Une formation pour tenir un poste de secrétariat avec l’outil informatique : rédaction et mise en forme de documents, tableaux simples, messagerie, classement et organisation du travail de bureau.',
      objectives: [
        'Rédiger et mettre en forme courriers, rapports et comptes rendus',
        'Réaliser des tableaux simples (listes, suivis, devis)',
        'Organiser le classement papier et numérique',
        'Gérer la messagerie, l’agenda et l’accueil téléphonique',
      ],
      program: [
        'Prise en main de l’ordinateur et du clavier',
        'Traitement de texte : courriers et documents administratifs',
        'Tableur : tableaux et calculs simples',
        'Messagerie, internet et agenda',
        'Classement, archivage et organisation du bureau',
        'Accueil et communication professionnelle',
      ],
    },
  },
  { name: 'Infographie', slugs: ['infographie-design-graphique', 'infographie'], match: '^infographie' },
  { name: 'Sérigraphie', slugs: ['serigraphie'], match: '^serigraphie' },
  { name: 'Maintenance informatique et réseau', slugs: ['maintenance-informatique', 'maintenance-informatique-reseau'], match: '^maintenance' },
  { name: 'Impression numérique', slugs: ['impression-numerique-grand-format', 'impression-numerique'], match: '^impression numerique' },
];

/** Module de la fiche correspondant à une formation (identifiant, puis intitulé). */
export function ficheModuleOf(training) {
  return FICHE_MODULES.find((m) => m.slugs.includes(training.slug)) || FICHE_MODULES.find((m) => new RegExp(m.match).test(norm(training.title))) || null;
}

const NORM_SQL = `lower(translate(btrim(title), 'ÉÈÊËÀÂÄÎÏÔÖÛÜÙÇéèêëàâäîïôöûüùç', 'EEEEAAAIIOOUUUCeeeeaaaiioouuuc'))`;
/** Formation existante pour un module : identifiant connu d'abord, puis intitulé ; une seule. */
const targetOf = (i) => `(select slug from trainings
   where slug = any($${i}::text[]) or ${NORM_SQL} ~ $${i + 1}
   order by (slug = any($${i}::text[])) desc, (archived_at is null) desc, sort, slug limit 1)`;
const NOT_DONE = `not exists (select 1 from site_settings where key = 'import_fiche_formations')`;

/** Requêtes de l'import (paramétrées), à jouer après les formations de départ. */
export function ficheStatements() {
  const q = [];
  const ref = FICHE_REFERENCE;
  for (const m of FICHE_MODULES.filter((x) => x.create)) {
    const c = m.create;
    q.push({
      text: `insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort, published,
                                    level, registration_fee_fcfa)
             select $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11,
                    (select coalesce(max(sort), 0) + 1 from trainings where category_slug = $4), true, $12, $13
              where ${NOT_DONE} and ${targetOf(1)} is null
                and exists (select 1 from training_categories where slug = $4)
             on conflict (slug) do nothing returning slug`,
      params: [m.slugs, m.match, c.slug, c.pole_slug, c.title, c.domain, c.summary, c.description, JSON.stringify(c.objectives), JSON.stringify(c.program), c.placeholder, ref.level, ref.registration_fee_fcfa],
    });
  }
  for (const m of FICHE_MODULES) {
    q.push({
      text: `update trainings set registration_fee_fcfa = coalesce(registration_fee_fcfa, $3),
                                  level = coalesce(nullif(btrim(level), ''), $4), updated_at = now()
              where ${NOT_DONE} and slug = ${targetOf(1)} returning slug`,
      params: [m.slugs, m.match, ref.registration_fee_fcfa, ref.level],
    });
  }
  q.push({
    text: `insert into site_settings (key, value) values ('import_fiche_formations', jsonb_build_object('applied_at', now(), 'modules', $1::jsonb))
           on conflict (key) do nothing returning key`,
    params: [JSON.stringify(FICHE_MODULES.map((m) => m.name))],
  });
  return q;
}
