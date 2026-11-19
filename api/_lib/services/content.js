// Contenu géré par l'administration : formations, catégories, sessions, prestations,
// réalisations, avis clients, réglages du site. Et lecture publique du catalogue.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { logActivity, notifyTeam } from '../activity.js';
import { providerOf, logStorageError } from '../storage.js';
import { publicImageUrl } from './files.js';

/** Mise à jour partielle : seules les colonnes de la liste blanche peuvent être écrites. */
async function updateRow(table, keyCol, key, patch, columns, notFound) {
  const sets = [];
  const params = [key];
  for (const [field, col] of Object.entries(columns)) {
    if (!(field in patch)) continue;
    const v = patch[field];
    params.push(Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : v);
    sets.push(`${col} = $${params.length}${Array.isArray(v) || (v && typeof v === 'object') ? '::jsonb' : ''}`);
  }
  if (!sets.length) throw new HttpError(400, 'Aucune modification envoyée.');
  const row = await one(`update ${table} set ${sets.join(', ')} where ${keyCol} = $1 returning ${keyCol}`, params);
  if (!row) throw new HttpError(404, notFound);
  return row;
}

// --- Formations ---------------------------------------------------------------
const TRAINING_COLUMNS = {
  category_slug: 'category_slug', title: 'title', domain: 'domain', summary: 'summary', description: 'description',
  objectives: 'objectives', program: 'program', duration: 'duration', level: 'level', prerequisites: 'prerequisites',
  price_fcfa: 'price_fcfa', price_note: 'price_note', certificate: 'certificate', sort: 'sort', published: 'published',
  certificate_rules: 'certificate_rules',
};

export async function createTraining(actor, t) {
  if (!(await one('select slug from training_categories where slug = $1', [t.category_slug]))) throw new HttpError(404, 'Pôle de formation introuvable.');
  if (await one('select slug from trainings where slug = $1', [t.slug])) throw new HttpError(409, 'Une formation utilise déjà cet identifiant.');
  const row = await one(
    `insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, duration, level,
                            prerequisites, price_fcfa, price_note, certificate, sort, published)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14,
             coalesce($15, (select coalesce(max(sort), 0) + 1 from trainings where category_slug = $2)), $16)
     returning slug`,
    [t.slug, t.category_slug, t.title, t.domain, t.summary, t.description ?? '', JSON.stringify(t.objectives), JSON.stringify(t.program),
      t.duration, t.level, t.prerequisites, t.price_fcfa, t.price_note, t.certificate, t.sort, t.published ?? false],
  );
  await logActivity(actor, 'training.created', 'training', row.slug, { title: t.title });
  return row;
}

export async function updateTraining(actor, slug, patch) {
  if (patch.category_slug && !(await one('select slug from training_categories where slug = $1', [patch.category_slug]))) {
    throw new HttpError(404, 'Pôle de formation introuvable.');
  }
  if (patch.published === true && (await one('select archived_at from trainings where slug = $1 and archived_at is not null', [slug]))) {
    throw new HttpError(409, 'Cette formation est archivée : désarchivez-la avant de la publier.');
  }
  for (const k of ['title', 'domain', 'summary']) if (k in patch && !patch[k]) throw new HttpError(400, `Le champ ${k} ne peut pas être vide.`);
  const row = await updateRow('trainings', 'slug', slug, { ...patch }, TRAINING_COLUMNS, 'Formation introuvable.');
  await query('update trainings set updated_at = now() where slug = $1 returning slug', [slug]);
  await logActivity(actor, 'training.updated', 'training', slug, { fields: Object.keys(patch) });
  return row;
}

/** Archiver : la formation quitte le site et la liste courante ; ses inscriptions restent consultables. */
export async function archiveTraining(actor, slug, archived) {
  const row = await one(
    `update trainings set archived_at = case when $2 then coalesce(archived_at, now()) else null end,
            published = case when $2 then false else published end, updated_at = now()
      where slug = $1 returning slug`,
    [slug, archived],
  );
  if (!row) throw new HttpError(404, 'Formation introuvable.');
  await logActivity(actor, archived ? 'training.archived' : 'training.unarchived', 'training', slug, {});
  return row;
}

export async function createCategory(actor, c) {
  if (await one('select slug from training_categories where slug = $1', [c.slug])) throw new HttpError(409, 'Ce pôle existe déjà.');
  const row = await one(
    `insert into training_categories (slug, number, title, summary, sort)
     values ($1, coalesce($2, (select coalesce(max(number), 0) + 1 from training_categories)), $3, $4,
             coalesce($5, (select coalesce(max(sort), 0) + 1 from training_categories)))
     returning slug`,
    [c.slug, c.number, c.title, c.summary ?? '', c.sort],
  );
  await logActivity(actor, 'training_category.created', 'training_category', row.slug, { title: c.title });
  return row;
}

export async function updateCategory(actor, slug, patch) {
  const row = await updateRow('training_categories', 'slug', slug, patch, { number: 'number', title: 'title', summary: 'summary', sort: 'sort' }, 'Pôle introuvable.');
  await logActivity(actor, 'training_category.updated', 'training_category', slug, { fields: Object.keys(patch) });
  return row;
}

// --- Sessions -----------------------------------------------------------------
function checkDates(s) {
  if (s.ends_on && s.starts_on && s.ends_on < s.starts_on) throw new HttpError(400, 'La date de fin précède la date de début.');
}

export async function createSession(actor, s) {
  checkDates(s);
  if (!(await one('select slug from trainings where slug = $1', [s.training_slug]))) throw new HttpError(404, 'Formation introuvable.');
  const row = await one(
    `insert into training_sessions (training_slug, starts_on, ends_on, schedule, site, seats, status)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [s.training_slug, s.starts_on, s.ends_on, s.schedule, s.site, s.seats, s.status || 'ouverte'],
  );
  await logActivity(actor, 'session.created', 'training', s.training_slug, { session_id: row.id, starts_on: s.starts_on, seats: s.seats });
  return row;
}

export async function updateSession(actor, id, s) {
  checkDates(s);
  const current = await one(
    `select s.training_slug, s.seats, (select count(*)::int from enrollments e where e.session_id = s.id and e.status = 'Inscrit') as taken
       from training_sessions s where s.id = $1`,
    [id],
  );
  if (!current) throw new HttpError(404, 'Session introuvable.');
  if (s.seats !== null && s.seats !== undefined && s.seats < current.taken) {
    throw new HttpError(409, `${current.taken} personne(s) sont déjà inscrites : le nombre de places ne peut pas être inférieur.`);
  }
  const row = await one(
    `update training_sessions set starts_on = $2, ends_on = $3, schedule = $4, site = $5, seats = $6, status = $7
      where id = $1 returning id`,
    [id, s.starts_on, s.ends_on, s.schedule, s.site, s.seats, s.status || 'ouverte'],
  );
  await logActivity(actor, 'session.updated', 'training', current.training_slug, { session_id: id });
  return row;
}

/** Une session qui a reçu des inscriptions n'est pas supprimée : on la ferme. */
export async function deleteSession(actor, id) {
  const s = await one('select training_slug, (select count(*)::int from enrollments where session_id = $1) as n from training_sessions where id = $1', [id]);
  if (!s) return { ok: true };
  if (s.n) throw new HttpError(409, `Cette session a ${s.n} demande(s) d’inscription : fermez-la plutôt que de la supprimer.`);
  await query('delete from training_sessions where id = $1 returning id', [id]);
  await logActivity(actor, 'session.deleted', 'training', s.training_slug, { session_id: id });
  return { ok: true };
}

// --- Prestations -------------------------------------------------------------------
export async function updateService(actor, slug, patch) {
  if (patch.related_category_slug && !(await one('select slug from training_categories where slug = $1', [patch.related_category_slug]))) {
    throw new HttpError(404, 'Pôle de formation introuvable.');
  }
  const row = await updateRow('services', 'slug', slug, patch, {
    title: 'title', summary: 'summary', intro: 'intro', offerings: 'offerings', related_category_slug: 'related_category_slug', sort: 'sort', published: 'published',
  }, 'Prestation introuvable.');
  await query('update services set updated_at = now() where slug = $1 returning slug', [slug]);
  await logActivity(actor, 'service.updated', 'service', slug, { fields: Object.keys(patch) });
  return row;
}

export async function createService(actor, s) {
  if (await one('select slug from services where slug = $1', [s.slug])) throw new HttpError(409, 'Une prestation utilise déjà cet identifiant.');
  const row = await one(
    `insert into services (slug, title, summary, intro, offerings, related_category_slug, sort, published)
     values ($1, $2, $3, $4, $5::jsonb, $6, coalesce($7, (select coalesce(max(sort), 0) + 1 from services)), $8) returning slug`,
    [s.slug, s.title, s.summary, s.intro ?? '', JSON.stringify(s.offerings), s.related_category_slug, s.sort, s.published ?? false],
  );
  await logActivity(actor, 'service.created', 'service', row.slug, { title: s.title });
  return row;
}

// --- Réalisations ------------------------------------------------------------------
async function checkPortfolioRefs(p) {
  if (p.category_slug && !(await one('select slug from portfolio_categories where slug = $1', [p.category_slug]))) throw new HttpError(400, 'Catégorie invalide.');
  if (p.service_slug && !(await one('select slug from services where slug = $1', [p.service_slug]))) throw new HttpError(400, 'Prestation inconnue.');
}

export async function createPortfolioItem(actor, p) {
  await checkPortfolioRefs(p);
  const status = p.status || 'publie';
  const row = await one(
    `insert into portfolio_items (category_slug, title, description, image_url, alt, sort, status, published_at, service_slug)
     values ($1, $2, $3, $4, $5, $6, $7, case when $7 = 'publie' then coalesce($8::timestamptz, now()) end, $9) returning id`,
    [p.category_slug, p.title, p.description, p.image_url, p.alt, p.sort ?? 0, status, p.published_at, p.service_slug],
  );
  await logActivity(actor, 'portfolio.created', 'portfolio', row.id, { title: p.title, status });
  return row;
}

export async function updatePortfolioItem(actor, id, patch) {
  await checkPortfolioRefs(patch);
  if (patch.status === 'publie' && !patch.published_at) {
    // Première publication : la date est fixée dans la même requête que le statut.
    const current = await one('select published_at from portfolio_items where id = $1', [id]);
    if (!current) throw new HttpError(404, 'Réalisation introuvable.');
    patch = { ...patch, published_at: current.published_at || new Date().toISOString() };
  }
  const row = await updateRow('portfolio_items', 'id', id, patch, {
    category_slug: 'category_slug', title: 'title', description: 'description', image_url: 'image_url', alt: 'alt',
    sort: 'sort', status: 'status', service_slug: 'service_slug', published_at: 'published_at',
  }, 'Réalisation introuvable.');
  await logActivity(actor, 'portfolio.updated', 'portfolio', id, { fields: Object.keys(patch) });
  return row;
}

export async function deletePortfolioItem(actor, id) {
  const files = await query('select id, purpose, storage_key, driver, resource_type, remote_type, remote_version, remote_format, visibility, mime_type from uploaded_files where portfolio_item_id = $1', [id]);
  if (files.length) {
    for (const f of files) {
      try {
        await providerOf(f).remove(f);
      } catch (err) {
        logStorageError('delete', f, err);
        throw new HttpError(502, 'Le stockage des images ne répond pas : la réalisation n’a pas été supprimée. Réessayez dans un instant.');
      }
      await query('delete from uploaded_files where id = $1 returning id', [f.id]);
    }
  }
  const row = await one('delete from portfolio_items where id = $1 returning id, title', [id]);
  if (row) await logActivity(actor, 'portfolio.deleted', 'portfolio', id, { title: row.title, files: files.length });
  return { ok: true };
}

/** Image envoyée par l'admin (fichier prêt) → adresse publique utilisée par la galerie. */
export async function setPortfolioImage(actor, id, fileId) {
  const f = await one(`select id, status, purpose from uploaded_files where id = $1`, [fileId]);
  if (!f || f.status !== 'ready' || f.purpose !== 'portfolio') throw new HttpError(400, 'Image introuvable ou pas encore vérifiée.');
  const row = await one(
    `update portfolio_items set image_file_id = $2, image_url = $3 where id = $1 returning id`,
    [id, fileId, await publicImageUrl(fileId)],
  );
  if (!row) throw new HttpError(404, 'Réalisation introuvable.');
  await query('update uploaded_files set portfolio_item_id = $1 where id = $2 returning id', [id, fileId]);
  await logActivity(actor, 'portfolio.updated', 'portfolio', id, { fields: ['image'] });
  return row;
}

export async function createPortfolioCategory(actor, c) {
  if (await one('select slug from portfolio_categories where slug = $1', [c.slug])) throw new HttpError(409, 'Cette catégorie existe déjà.');
  const row = await one(
    'insert into portfolio_categories (slug, title, sort) values ($1, $2, coalesce($3, (select coalesce(max(sort), 0) + 1 from portfolio_categories))) returning slug',
    [c.slug, c.title, c.sort],
  );
  await logActivity(actor, 'portfolio_category.created', 'portfolio_category', row.slug, { title: c.title });
  return row;
}

export async function updatePortfolioCategory(actor, slug, patch) {
  const row = await updateRow('portfolio_categories', 'slug', slug, patch, { title: 'title', sort: 'sort' }, 'Catégorie introuvable.');
  await logActivity(actor, 'portfolio_category.updated', 'portfolio_category', slug, { fields: Object.keys(patch) });
  return row;
}

// --- Avis clients -------------------------------------------------------------------
export async function submitTestimonial(actor, t, user) {
  const [{ n }] = await query(`select count(*)::int as n from testimonials where user_id = $1 and status = 'en_attente'`, [actor.id]);
  if (n >= 3) throw new HttpError(429, 'Vous avez déjà des avis en attente de relecture.');
  const row = await one(
    `insert into testimonials (user_id, author_name, author_title, content, rating, service_slug, consent_at)
     values ($1, $2, $3, $4, $5, $6, now()) returning id`,
    [actor.id, t.author_name || user.full_name, t.author_title, t.content, t.rating, t.service_slug],
  );
  await logActivity(actor, 'testimonial.created', 'testimonial', row.id, {});
  await notifyTeam('content', { kind: 'testimonial.new', title: 'Nouvel avis client à relire', body: t.content.slice(0, 140), link: '/espace?onglet=avis' });
  return row;
}

export async function moderateTestimonial(actor, id, status) {
  const row = await one(
    `update testimonials set status = $2, published_at = case when $2 = 'publie' then coalesce(published_at, now()) else published_at end
      where id = $1 returning id`,
    [id, status],
  );
  if (!row) throw new HttpError(404, 'Avis introuvable.');
  await logActivity(actor, 'testimonial.status_changed', 'testimonial', id, { to: status });
  return row;
}

export async function deleteTestimonial(actor, id) {
  await query('delete from testimonials where id = $1 returning id', [id]);
  await logActivity(actor, 'testimonial.deleted', 'testimonial', id, {});
  return { ok: true };
}

// --- Réglages du site ----------------------------------------------------------------
/** Réglages lisibles par tous (affichés sur le site). */
export const PUBLIC_SETTINGS = ['business', 'about', 'cars', 'home', 'whatsapp', 'socials', 'legal'];

export async function updateSetting(actor, key, value) {
  const row = await one(
    `insert into site_settings (key, value, updated_by, updated_at) values ($1, $2::jsonb, $3, now())
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
     returning key`,
    [key, JSON.stringify(value), actor.id],
  );
  await logActivity(actor, 'setting.updated', 'setting', key, {});
  return row;
}

// --- Catalogue public -----------------------------------------------------------------
/**
 * Contenu lu par toutes les pages. Les noms des champs renvoyés restent ceux de la
 * v2.4 (prestations, poles, courses, gallery) : le site n'a pas besoin de changer.
 */
export async function loadCatalog({ all = false } = {}) {
  const pub = all ? '' : 'where published';
  const [services, categories, trainings, sessions, portfolio, portfolioCategories, settings, testimonials] = await Promise.all([
    query(`select slug, title, summary, intro, offerings, placeholder, related_category_slug as related_pole, sort, published from services ${pub} order by sort, title`),
    query('select slug, number, title, summary, sort from training_categories order by sort, number'),
    query(`select slug, category_slug as pole_slug, title, domain, summary, description, objectives, program, duration, level, prerequisites,
                  price_fcfa, price_note, certificate, certificate_rules, placeholder, sort, published, archived_at
             from trainings ${pub} order by sort, title`),
    query(`select s.id, s.training_slug as course_slug, to_char(s.starts_on, 'YYYY-MM-DD') as starts_on, to_char(s.ends_on, 'YYYY-MM-DD') as ends_on,
                  s.schedule, s.site, s.seats, s.status,
                  case when s.seats is null then null
                       else greatest(s.seats - (select count(*)::int from enrollments r where r.session_id = s.id and r.status = 'Inscrit'), 0)
                  end as seats_left
             from training_sessions s
            ${all ? '' : 'where coalesce(s.ends_on, s.starts_on) >= current_date'}
            order by s.starts_on`),
    query(`select id, category_slug as category, title, description, image_url, alt, sort, status, (status = 'publie') as published,
                  published_at, service_slug
             from portfolio_items ${all ? '' : "where status = 'publie'"} order by sort, published_at desc nulls last, created_at desc`),
    query('select slug, title, sort from portfolio_categories order by sort, title'),
    query(`select key, value from site_settings ${all ? '' : 'where key = any($1::text[])'}`, all ? [] : [`{${PUBLIC_SETTINGS.join(',')}}`]),
    query(`select id, author_name, author_title, content, rating, service_slug, published_at${all ? ', status, created_at' : ''}
             from testimonials ${all ? '' : "where status = 'publie'"} order by coalesce(published_at, created_at) desc limit 100`),
  ]);
  const byTraining = {};
  for (const s of sessions) (byTraining[s.course_slug] ||= []).push(s);
  return {
    prestations: services,
    poles: categories,
    courses: trainings.map((c) => ({ ...c, sessions: byTraining[c.slug] || [] })),
    gallery: portfolio,
    galleryCategories: portfolioCategories,
    testimonials,
    content: Object.fromEntries(settings.map((b) => [b.key, b.value])),
  };
}
