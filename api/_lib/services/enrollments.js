// Règles métier des inscriptions aux formations.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { logActivity, historyOf, notifyUser, notifyTeam, isTeam } from '../activity.js';
import { filesOf } from './files.js';

/** Changements de statut autorisés (administration). */
export const TRANSITIONS = {
  'Nouvelle demande': ['Contacté', 'Inscrit', 'Annulé'],
  'Contacté': ['Inscrit', 'Annulé', 'Nouvelle demande'],
  'Inscrit': ['Terminé', 'Annulé', 'Contacté'],
  'Terminé': ['Inscrit'],
  'Annulé': ['Nouvelle demande', 'Contacté'],
};

const COLS = `e.id, e.user_id, e.full_name, e.phone, e.email, e.training_title, e.training_slug, e.session_id, e.message,
  e.status, e.created_at, e.updated_at, to_char(s.starts_on, 'YYYY-MM-DD') as session_starts_on,
  to_char(s.ends_on, 'YYYY-MM-DD') as session_ends_on, s.schedule as session_schedule, s.site as session_site,
  t.duration as training_duration, t.level as training_level, t.price_fcfa as training_price_fcfa, t.certificate as training_certificate,
  (select count(*)::int from uploaded_files f where f.enrollment_id = e.id and f.status = 'ready') as documents`;
const FROM = `enrollments e left join training_sessions s on s.id = e.session_id left join trainings t on t.slug = e.training_slug`;

/** Une session et ses places : places restantes = places − inscrits confirmés. */
async function sessionWithSeats(sessionId, trainingSlug) {
  return one(
    `select s.id, to_char(s.starts_on, 'DD/MM/YYYY') as label, s.status, s.seats,
            (select count(*)::int from enrollments r where r.session_id = s.id and r.status = 'Inscrit') as taken
       from training_sessions s
      where s.id = $1 and s.training_slug = $2 and coalesce(s.ends_on, s.starts_on) >= current_date`,
    [sessionId, trainingSlug],
  );
}

/** Demande d'inscription (visiteur ou client connecté). */
export async function createEnrollment(actor, input) {
  const data = { ...input, trainingSlug: null, sessionId: null, sessionLabel: '' };
  if (input.training_slug) {
    const t = await one('select slug, title from trainings where slug = $1 and published', [input.training_slug]);
    if (!t) throw new HttpError(404, 'Formation introuvable.');
    data.trainingSlug = t.slug;
    data.title = t.title;
    if (input.session_id) {
      const s = await sessionWithSeats(input.session_id, t.slug);
      if (!s) throw new HttpError(404, 'Session introuvable ou passée.');
      if (s.status !== 'ouverte') throw new HttpError(409, 'Les inscriptions à cette session sont fermées.');
      if (s.seats !== null && s.taken >= s.seats) throw new HttpError(409, 'Cette session est complète. Choisissez une autre date ou demandez à être informé de la prochaine.');
      data.sessionId = s.id;
      data.sessionLabel = ` (session du ${s.label})`;
      // Pas de double inscription à la même session (même numéro ou même compte).
      const dup = await one(
        `select id from enrollments where session_id = $1 and status <> 'Annulé' and (phone = $2 or ($3::uuid is not null and user_id = $3)) limit 1`,
        [s.id, input.phone, actor.role === 'guest' ? null : actor.id],
      );
      if (dup) throw new HttpError(409, 'Une demande d’inscription à cette session existe déjà pour ce numéro. Nous vous recontactons.');
    }
  } else {
    if (!input.course) throw new HttpError(400, 'Formation : champ obligatoire.');
    data.title = input.course;
  }
  const userId = actor.role === 'guest' ? null : actor.id;
  const row = await one(
    `insert into enrollments (full_name, phone, email, training_title, message, user_id, training_slug, session_id, consent_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz) returning id`,
    [input.name, input.phone, input.email ?? input.userEmail ?? null, data.title, input.message, userId, data.trainingSlug, data.sessionId, input.consent_at ?? null],
  );
  await logActivity(actor, 'enrollment.created', 'enrollment', row.id, { training: data.trainingSlug || data.title, session_id: data.sessionId });
  await notifyTeam('trainings', {
    kind: 'enrollment.new', title: `Nouvelle inscription — ${data.title}${data.sessionLabel}`, body: input.name, link: '/espace?section=inscriptions', event: 'enrollment_new',
    details: [['Nom', input.name], ['Téléphone', input.phone], ['E-mail', input.email ?? input.userEmail], ['Formation', `${data.title}${data.sessionLabel}`], ['Message', input.message]],
  });
  return { id: row.id, title: data.title, sessionLabel: data.sessionLabel };
}

export async function listEnrollments(actor, { userId = null, sessionId = null } = {}) {
  const admin = isTeam(actor, 'trainings');
  const where = [];
  const params = [];
  if (!admin) {
    params.push(actor.id);
    where.push(`e.user_id = $${params.length}`);
  } else {
    if (userId) {
      params.push(userId);
      where.push(`e.user_id = $${params.length}`);
    }
    if (sessionId) {
      params.push(sessionId);
      where.push(`e.session_id = $${params.length}`);
    }
  }
  return query(
    `select ${COLS}${admin ? ', e.admin_note' : ''}
       from ${FROM}
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by e.created_at desc limit 500`,
    params,
  );
}

export async function getEnrollment(actor, id) {
  const e = await one(`select ${COLS}, e.admin_note from ${FROM} where e.id = $1`, [id]);
  if (!e || (!isTeam(actor, 'trainings') && e.user_id !== actor.id)) throw new HttpError(404, 'Inscription introuvable.');
  if (!isTeam(actor, 'trainings')) delete e.admin_note;
  return { ...e, files: await filesOf('enrollment', id), history: await historyOf('enrollment', id, { forClient: !isTeam(actor, 'trainings') }) };
}

/**
 * Statut et note, par l'administration ; annulation par le client lui-même.
 * Confirmer une place (« Inscrit ») n'est possible que s'il en reste.
 */
export async function updateEnrollment(actor, id, { status, admin_note: note }) {
  const e = await one('select id, user_id, status, session_id, training_title from enrollments where id = $1', [id]);
  if (!e || (!isTeam(actor, 'trainings') && e.user_id !== actor.id)) throw new HttpError(404, 'Inscription introuvable.');
  if (!isTeam(actor, 'trainings')) {
    if (status !== 'Annulé' || note !== undefined) throw new HttpError(403, 'Vous pouvez seulement annuler votre inscription.');
    if (['Terminé', 'Annulé'].includes(e.status)) throw new HttpError(409, 'Cette inscription ne peut plus être annulée.');
  }
  if (status !== undefined && status !== e.status) {
    if (isTeam(actor, 'trainings') && !TRANSITIONS[e.status].includes(status)) throw new HttpError(409, `Impossible de passer de « ${e.status} » à « ${status} ».`);
    let row;
    if (status === 'Inscrit' && e.session_id) {
      // Vérification des places et changement de statut dans la même requête.
      row = await one(
        `update enrollments set status = 'Inscrit'
          where id = $1 and status = $2
            and (select s.seats is null or s.seats > (select count(*) from enrollments r where r.session_id = s.id and r.status = 'Inscrit')
                   from training_sessions s where s.id = $3)
          returning id`,
        [id, e.status, e.session_id],
      );
      if (!row) throw new HttpError(409, 'Plus de place disponible dans cette session : augmentez le nombre de places ou proposez une autre date.');
    } else {
      row = await one('update enrollments set status = $3 where id = $1 and status = $2 returning id', [id, e.status, status]);
      if (!row) throw new HttpError(409, 'L’inscription vient d’être modifiée. Rechargez la page.');
    }
    await logActivity(actor, 'enrollment.status_changed', 'enrollment', id, { from: e.status, to: status });
    if (isTeam(actor, 'trainings') && e.user_id && ['Inscrit', 'Annulé'].includes(status)) {
      const ok = status === 'Inscrit';
      const sess = e.session_id ? await one(`select starts_on::text as starts_on, ends_on::text as ends_on, schedule, site from training_sessions where id = $1`, [e.session_id]) : null;
      const day = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null);
      const when = sess ? (sess.ends_on && sess.ends_on !== sess.starts_on ? `du ${day(sess.starts_on)} au ${day(sess.ends_on)}` : `le ${day(sess.starts_on)}`) : null;
      await notifyUser(e.user_id, {
        kind: ok ? 'enrollment.confirmed' : 'enrollment.cancelled',
        title: ok ? `Inscription confirmée : ${e.training_title}` : `Inscription annulée : ${e.training_title}`,
        body: ok && when ? `Session ${when}${sess.site ? `, ${sess.site}` : ''}.` : null,
        link: `/espace?section=formations`,
        ...(ok ? { email: 'enrollment_confirmed', vars: { formation: e.training_title, session: when, lieu: sess?.site }, emailBody: '',
          details: [['Formation', e.training_title], ['Dates', when], ['Horaires', sess?.schedule], ['Lieu', sess?.site]] } : {}),
      });
    }
    if (!isTeam(actor, 'trainings')) await notifyTeam('trainings', { kind: 'enrollment.cancelled', title: `Inscription annulée par le client : ${e.training_title}`, link: '/espace?section=inscriptions' });
  }
  if (note !== undefined && isTeam(actor, 'trainings')) {
    await query('update enrollments set admin_note = $2 where id = $1 returning id', [id, note]);
    await logActivity(actor, 'enrollment.updated', 'enrollment', id, { fields: ['admin_note'] });
  }
  return getEnrollment(actor, id);
}
