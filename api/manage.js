// /api/manage — contenu du site : administrateurs et membres staff ayant le droit « content ».
// Corps : { action, ... }. Les réglages du site restent réservés aux administrateurs.
//   training.create / training.update      formations (textes, programme, tarif, durée…, visibilité)
//   category.create / category.update      pôles de formation
//   session.create / session.update / session.delete
//   service.create / service.update        prestations
//   portfolio.create / portfolio.update / portfolio.delete / portfolio.image
//   portfolio_category.create / portfolio_category.update
//   testimonial.update / testimonial.delete
//   setting.update                         réglages du site (coordonnées, textes)
//   auth.status                            état de la connexion Google (admin)
//   storage.status                         état du stockage Cloudinary et des sauvegardes (admin)
// Anciens noms (v2.4), toujours acceptés : course.update, prestation.update, gallery.*.
import { z } from 'zod';
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { requirePermission, maskEmail } from './_lib/auth.js';
import { actorOf, CLIENT_EMAIL_EVENTS, TEAM_EMAIL_EVENTS } from './_lib/activity.js';
import { query, one } from './_lib/db.js';
import { TEMPLATES, renderEmail } from './_lib/emails.js';
import { deliverEmail, mailStatus } from './_lib/mail.js';
import { WHATSAPP_PURPOSES, SOCIALS } from './_lib/settings.js';
import { googleConfigured, redirectUri } from './_lib/google.js';
import { storageStatus } from './_lib/storage.js';
import { siteUrl } from './_lib/http.js';
import * as s from './_lib/schemas.js';
import * as content from './_lib/services/content.js';

const stringList = (label, max = 40) => s.list(s.text(label, { min: 2, max: 400, req: true }), label, { max });

const training = z.object({
  category_slug: s.slug('Pôle'),
  title: s.text('Titre', { min: 2, max: 160, req: true }),
  domain: s.text('Domaine', { min: 2, max: 120, req: true }),
  summary: s.text('Résumé', { min: 10, max: 400, req: true }),
  description: s.text('Description', { max: 4000 }),
  objectives: stringList('Objectifs'),
  program: stringList('Programme', 60),
  duration: s.text('Durée', { max: 120 }),
  level: s.text('Niveau', { max: 120 }),
  prerequisites: s.text('Prérequis', { max: 600 }),
  price_fcfa: s.fcfa('Prix de la formation'),
  price_note: s.text('Précision sur le tarif', { max: 200 }),
  // Fiche détaillée : tout est libre et modifiable par l'administration (rien n'est figé dans le code).
  duration_options: s.list(z.object({
    label: s.text('Durée', { min: 1, max: 120, req: true }),
    price_fcfa: s.fcfa('Prix pour cette durée'),
    note: s.text('Précision', { max: 160 }),
  }), 'Options de durée', { max: 12 }),
  registration_fee_fcfa: s.fcfa('Frais d’inscription'),
  extra_fees: s.list(z.object({
    label: s.text('Frais', { min: 2, max: 120, req: true }),
    amount_fcfa: s.fcfa('Montant', { req: true }),
  }), 'Frais supplémentaires', { max: 12 }),
  payment_terms: s.text('Modalités de paiement', { max: 600 }),
  admission_requirements: s.list(s.text('Condition', { min: 2, max: 300, req: true }), 'Conditions d’admission', { max: 20 }),
  certificate: s.text('Attestation', { max: 200 }),
  // Règles de délivrance de l'attestation, fixées par l'administration.
  certificate_rules: z.object({
    kind: z.enum(['attestation', 'certificat']).nullable().optional(),
    min_attendance: s.int('Assiduité minimale (%)', { min: 0, max: 100 }).nullable().optional(),
    evaluation: z.boolean().optional(),
  }).optional(),
  sort: s.int('Ordre', { max: 100000 }),
  published: s.bool,
});

const session = z.object({
  starts_on: s.date('Date de début', { req: true }),
  ends_on: s.date('Date de fin'),
  schedule: s.text('Horaires', { max: 200 }),
  site: s.text('Lieu', { max: 200 }),
  seats: s.int('Nombre de places', { min: 1, max: 10000 }),
  status: s.oneOf(['ouverte', 'fermée'], 'Statut').default('ouverte'),
});

const service = z.object({
  title: s.text('Titre', { min: 2, max: 120, req: true }),
  summary: s.text('Résumé', { min: 10, max: 400, req: true }),
  intro: s.text('Présentation', { max: 4000 }),
  offerings: stringList('Ce que l’atelier réalise'),
  related_category_slug: s.optionalSlug('Pôle de formation lié'),
  sort: s.int('Ordre', { max: 100000 }),
  published: s.bool,
});

const portfolio = z.object({
  category_slug: s.slug('Catégorie'),
  title: s.text('Titre', { min: 2, max: 120, req: true }),
  description: s.text('Description', { max: 600 }),
  image_url: s.imageUrl,
  alt: s.text('Texte alternatif', { min: 3, max: 200, req: true }),
  sort: s.int('Ordre', { max: 100000 }),
  status: s.oneOf(s.PORTFOLIO_STATUSES, 'Visibilité').optional(),
  published_at: s.date('Date de publication'),
  service_slug: s.optionalSlug('Prestation'),
});

const SETTINGS = {
  business: z.object({
    slogan: s.text('Slogan', { max: 120 }),
    email: s.email({ req: true }),
    phone: s.phone(),
    whatsapp: s.phone('WhatsApp', { req: false }),
    sites: s.list(z.object({ label: s.text('Nom du site', { min: 2, max: 60, req: true }), address: s.text('Adresse', { min: 3, max: 200, req: true }) }), 'Adresses', { max: 6 }),
    hours: s.text('Horaires', { max: 300 }),
  }),
  about: z.object({ title: s.text('Titre', { min: 2, max: 120, req: true }), lead: s.text('Présentation', { min: 10, max: 2000, req: true }), activities: stringList('Activités') }),
  home: z.object({
    eyebrow: s.text('Accroche au-dessus du titre', { max: 80 }),
    title: s.text('Titre du bandeau d’accueil', { min: 5, max: 90, req: true }),
    lead: s.text('Texte du bandeau d’accueil', { min: 10, max: 300, req: true }),
  }),
  cars: z.object({
    title: s.text('Titre', { min: 2, max: 120, req: true }),
    tagline: s.text('Accroche', { max: 200 }),
    intro: s.text('Présentation', { min: 10, max: 2000, req: true }),
    offers: s.list(z.object({ title: s.text('Titre', { min: 2, max: 120, req: true }), text: s.text('Texte', { min: 2, max: 600, req: true }) }), 'Offres', { max: 12 }),
    contactText: s.text('Texte de contact', { max: 400 }),
    phone: s.phone('Téléphone E-MAN CARS', { req: false }),
  }),
  // Boutons WhatsApp par usage : numéro (vide = numéro principal) et message prérempli.
  whatsapp: z.object(Object.fromEntries(Object.entries(WHATSAPP_PURPOSES).map(([k, label]) => [k, z.object({
    number: s.phone(`WhatsApp — ${label}`, { req: false }),
    message: s.text(`Message prérempli — ${label}`, { max: 300 }),
  }).optional()]))),
  socials: z.object(Object.fromEntries(Object.entries(SOCIALS).map(([k, hosts]) => [k, socialUrl(k, hosts)]))),
  legal: z.object({
    legalName: s.text('Raison sociale', { max: 160 }),
    legalForm: s.text('Forme juridique', { max: 80 }),
    capital: s.text('Capital social', { max: 80 }),
    rccm: s.text('RCCM', { max: 80 }),
    nif: s.text('NIF', { max: 80 }),
    headOffice: s.text('Siège social', { max: 200 }),
    director: s.text('Directeur de la publication', { max: 120 }),
    host: s.text('Hébergeur', { max: 300 }),
  }),
  documents: z.object({
    quote_validity_days: s.int('Durée de validité des devis (jours)', { min: 1, max: 365 }),
    quote_conditions: s.text('Conditions des devis', { max: 2000 }),
    invoice_conditions: s.text('Conditions des factures', { max: 2000 }),
    payment_instructions: s.text('Moyens de paiement', { max: 1000 }),
    signature_label: s.text('Mention de la zone de signature', { max: 60 }),
  }),
  notifications: z.object({
    client_email: z.object(Object.fromEntries(CLIENT_EMAIL_EVENTS.map((k) => [k, z.boolean().optional()]))).default({}),
    team_email: z.object(Object.fromEntries(Object.keys(TEAM_EMAIL_EVENTS).map((k) => [k, z.boolean().optional()]))).default({}),
    team_email_to: s.email({ req: false }).optional().nullable(),
  }),
  email_templates: z.object(Object.fromEntries(Object.keys(TEMPLATES).map((k) => [k, z.object({
    subject: s.text('Objet', { max: 150 }),
    intro: s.text('Introduction', { max: 1500 }),
  }).optional()]))).strict('Modèle d’e-mail inconnu.'),
};

const key = (label) => z.object({ slug: s.slug(label) });

/** Adresse d'un réseau social : https et domaine du réseau, ou vide. */
function socialUrl(name, hosts) {
  return z.string().trim().max(300).optional().nullable().transform((v) => v || null).refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    } catch { return false; }
  }, `${name} : adresse https://${hosts[0]}/… attendue.`);
}
const idOf = (label) => z.object({ id: s.uuid(label) });

/** Sépare l'identifiant du reste et valide une mise à jour partielle. */
const partial = (schema, body, idField) => {
  const { action: _a, [idField]: _id, ...rest } = body;
  return s.parsePatch(schema, rest);
};

const actions = {
  'training.create': (a, b) => content.createTraining(a, s.parse(training.extend({ slug: s.slug('Identifiant de la formation') }), b)),
  'training.update': (a, b) => content.updateTraining(a, s.parse(key('Formation'), b).slug, partial(training, b, 'slug')),
  'training.archive': (a, b) => {
    const p = s.parse(z.object({ slug: s.slug('Formation'), archived: s.bool }), b);
    return content.archiveTraining(a, p.slug, p.archived);
  },
  'category.create': (a, b) => content.createCategory(a, s.parse(z.object({
    slug: s.slug('Identifiant du pôle'), number: s.int('Numéro', { min: 1, max: 99 }),
    title: s.text('Titre', { min: 2, max: 160, req: true }), summary: s.text('Résumé', { max: 600 }), sort: s.int('Ordre', { max: 1000 }),
  }), b)),
  'category.update': (a, b) => content.updateCategory(a, s.parse(key('Pôle'), b).slug, partial(z.object({
    number: s.int('Numéro', { min: 1, max: 99 }), title: s.text('Titre', { min: 2, max: 160, req: true }),
    summary: s.text('Résumé', { max: 600 }), sort: s.int('Ordre', { max: 1000 }),
  }), b, 'slug')),
  'session.create': (a, b) => content.createSession(a, s.parse(session.extend({ training_slug: s.slug('Formation') }), { ...b, training_slug: b.training_slug ?? b.course_slug })),
  'session.update': (a, b) => content.updateSession(a, s.parse(idOf('Session'), b).id, s.parse(session, b)),
  'session.delete': (a, b) => content.deleteSession(a, s.parse(idOf('Session'), b).id),
  'service.create': (a, b) => content.createService(a, s.parse(service.extend({ slug: s.slug('Identifiant de la prestation') }), b)),
  'service.update': (a, b) => content.updateService(a, s.parse(key('Prestation'), b).slug, partial(service, b, 'slug')),
  'portfolio.create': (a, b) => content.createPortfolioItem(a, s.parse(portfolio, { ...b, category_slug: b.category_slug ?? b.category })),
  'portfolio.update': (a, b) => {
    const { id } = s.parse(idOf('Réalisation'), b);
    const body = { ...b };
    if ('category' in body && !('category_slug' in body)) body.category_slug = body.category;
    delete body.category;
    // Ancien champ « published » (v2.4) → visibilité.
    if ('published' in body && !('status' in body)) body.status = s.parse(s.bool, body.published) ? 'publie' : 'masque';
    delete body.published;
    return content.updatePortfolioItem(a, id, partial(portfolio, body, 'id'));
  },
  'portfolio.delete': (a, b) => content.deletePortfolioItem(a, s.parse(idOf('Réalisation'), b).id),
  'portfolio.image': (a, b) => {
    const p = s.parse(z.object({ id: s.uuid('Réalisation'), file_id: s.uuid('Image') }), b);
    return content.setPortfolioImage(a, p.id, p.file_id);
  },
  'portfolio_category.create': (a, b) => content.createPortfolioCategory(a, s.parse(z.object({
    slug: s.slug('Identifiant de la catégorie'), title: s.text('Titre', { min: 2, max: 80, req: true }), sort: s.int('Ordre', { max: 1000 }),
  }), b)),
  'portfolio_category.update': (a, b) => content.updatePortfolioCategory(a, s.parse(key('Catégorie'), b).slug, partial(z.object({
    title: s.text('Titre', { min: 2, max: 80, req: true }), sort: s.int('Ordre', { max: 1000 }),
  }), b, 'slug')),
  'testimonial.update': (a, b) => {
    const p = s.parse(z.object({ id: s.uuid('Avis'), status: s.oneOf(s.TESTIMONIAL_STATUSES, 'Statut') }), b);
    return content.moderateTestimonial(a, p.id, p.status);
  },
  'testimonial.delete': (a, b) => content.deleteTestimonial(a, s.parse(idOf('Avis'), b).id),
  // E-mails : état de la configuration, aperçu d'un modèle, envoi d'essai, journal. Admin.
  'email.status': async (a) => {
    adminOnly(a);
    const [log, counts] = await Promise.all([
      query(`select id, to_email, template, subject, status, provider, provider_id, error, created_at from email_log order by created_at desc limit 50`),
      query(`select status, count(*)::int as n from email_log where created_at > now() - interval '30 days' group by status`),
    ]);
    return { ...mailStatus(), templates: Object.entries(TEMPLATES).map(([k, t]) => ({ key: k, label: t.label, category: t.category, vars: t.vars, subject: t.subject, intro: t.intro })),
      log: log.map((l) => ({ ...l, to_email: maskEmail(l.to_email) })), last_30_days: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  },
  'email.preview': async (a, b) => {
    adminOnly(a);
    const p = s.parse(z.object({ template: s.oneOf(Object.keys(TEMPLATES), 'Modèle'), subject: s.text('Objet', { max: 150 }), intro: s.text('Introduction', { max: 1500 }) }), b);
    return renderEmail(p.template, sampleVars(a), { link: '/espace', details: [['Exemple', 'Valeur d’exemple']] }, { subject: p.subject || undefined, intro: p.intro || undefined });
  },
  'email.test': async (a, b) => {
    adminOnly(a);
    const p = s.parse(z.object({ template: s.oneOf(Object.keys(TEMPLATES), 'Modèle') }), b);
    const me = await one('select email from users where id = $1', [a.id]);
    const mail = await renderEmail(p.template, sampleVars(a), { link: '/espace', details: [['Exemple', 'Valeur d’exemple']] });
    const r = await deliverEmail({ to: me.email, userId: a.id, template: p.template, ...mail, subject: `[Essai] ${mail.subject}` });
    return { ...r, to: maskEmail(me.email) };
  },
  // Modes de connexion : état de la configuration Google (aucun secret renvoyé). Admin.
  'auth.status': async (a, b, req) => {
    adminOnly(a);
    const id = process.env.GOOGLE_CLIENT_ID || '';
    const [{ n }] = await query(`select count(*)::int as n from accounts where provider = 'google'`);
    return {
      google: {
        configured: googleConfigured(),
        client_id: id ? `${id.slice(0, 8)}…${id.slice(-27)}` : null,
        secret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
        origin: siteUrl(req),
        redirect_uri: redirectUri(req),
        linked_accounts: n,
      },
    };
  },
  // Fichiers : fournisseur, limite réelle, répartition, dernières sauvegardes réellement faites. Admin.
  'storage.status': async (a) => {
    adminOnly(a);
    const [byDriver, integrity, runs, pending] = await Promise.all([
      query(`select driver, count(*)::int as n, coalesce(sum(size_bytes), 0)::float8 as bytes from uploaded_files where status = 'ready' group by driver order by driver`),
      query(`select coalesce(integrity_status, 'non vérifié') as state, count(*)::int as n from uploaded_files where status = 'ready' group by 1`),
      query(`select distinct on (kind) kind, started_at, finished_at, status, copied, skipped, failed, bytes::float8 as bytes from backup_runs order by kind, started_at desc`),
      query(`select count(*)::int as n from uploaded_files where status = 'ready' and backed_up_at is null`),
    ]);
    const st = storageStatus();
    return { ...st, cloudinary: { configured: st.cloudinary.configured, missing: st.cloudinary.missing, cloud: st.cloudinary.cloud, folder: st.cloudinary.folder },
      by_driver: byDriver, integrity: Object.fromEntries(integrity.map((r) => [r.state, r.n])), runs, not_backed_up: pending[0].n };
  },
  'setting.update': (a, b) => {
    // Coordonnées et textes officiels : réservés aux administrateurs.
    if (a.role !== 'admin') throw new HttpError(403, 'Seul un administrateur peut modifier les réglages du site.');
    const k = s.parse(s.oneOf(Object.keys(SETTINGS), 'Réglage'), b.key);
    return content.updateSetting(a, k, s.parse(SETTINGS[k], b.value));
  },
};
// Noms de la v2.4.
actions['course.update'] = actions['training.update'];
actions['prestation.update'] = actions['service.update'];
actions['gallery.create'] = actions['portfolio.create'];
actions['gallery.update'] = actions['portfolio.update'];
actions['gallery.delete'] = actions['portfolio.delete'];

/** Droit exigé par action : les formations relèvent du droit « trainings », le reste de « content ». */
const permissionOf = (action) => (/^(training|category|session|course)\./.test(action) ? 'trainings' : 'content');
const adminOnly = (a) => { if (a.role !== 'admin') throw new HttpError(403, 'Réservé aux administrateurs.'); };
const sampleVars = (a) => ({ prenom: (a.name || 'Kofi').split(' ')[0], numero: 'DV-2026-00042', prestations: 'Bâche 3 × 2 m', total: '70 000 FCFA', validite: '18 décembre 2026', decision: 'accepté', statut: 'En production', date_prevue: '15 décembre 2026', formation: 'Infographie', session: 'du 1er au 26 février 2027', lieu: 'Baguida', sujet: 'Réponse de l’équipe E-MAN PROD', titre: 'Fermeture exceptionnelle le 24 décembre', invite_par: 'Ama Dossou', document: 'attestation' });

export default handler({
  async POST(req, res) {
    const body = await readJson(req);
    const fn = actions[body.action];
    if (!fn) throw new HttpError(400, 'Action inconnue.');
    const actor = actorOf(await requirePermission(req, permissionOf(body.action)));
    send(res, 200, { result: await fn(actor, body, req) });
  },
});
