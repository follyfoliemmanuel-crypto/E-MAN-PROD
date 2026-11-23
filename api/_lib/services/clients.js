// Clients : informations personnelles, profil, historique des devis, commandes et inscriptions.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { logActivity, isTeam, notifyTeam, USER_EMAIL_CATEGORIES } from '../activity.js';
import { listQuotes } from './quotes.js';
import { listOrders } from './orders.js';
import { listEnrollments } from './enrollments.js';

const PROFILE_COLS = 'client_type, company_name, address, city, whatsapp, preferred_contact, updated_at';

export async function getProfile(userId, { admin = false } = {}) {
  await query('insert into client_profiles (user_id) values ($1) on conflict do nothing returning user_id', [userId]);
  return one(`select ${PROFILE_COLS}${admin ? ', admin_note' : ''} from client_profiles where user_id = $1`, [userId]);
}

/** Le client modifie ses informations (l'e-mail se change par une autre procédure, avec vérification). */
export async function updateAccount(actor, patch) {
  const userCols = { full_name: 'full_name', first_name: 'first_name', last_name: 'last_name', phone: 'phone' };
  const profileCols = ['client_type', 'company_name', 'address', 'city', 'whatsapp', 'preferred_contact'];
  const uSets = [];
  const uParams = [actor.id];
  for (const [k, col] of Object.entries(userCols)) {
    if (!(k in patch)) continue;
    if (k === 'full_name' && !patch[k]) throw new HttpError(400, 'Nom : champ obligatoire.');
    uParams.push(patch[k]);
    uSets.push(`${col} = $${uParams.length}`);
  }
  // Profil public (messagerie) : nom public, fonction, présentation réservés à l'équipe ;
  // « dernière activité visible » pour tout le monde.
  const team = actor.role === 'admin' || actor.role === 'staff';
  for (const k of ['public_name', 'job_title', 'bio']) {
    if (!(k in patch)) continue;
    if (!team) throw new HttpError(403, 'Ce champ est réservé à l’équipe.');
    const val = patch[k] ? String(patch[k]).trim() : null;
    if (val && k !== 'bio' && val.length < 2) throw new HttpError(400, 'Au moins 2 caractères.');
    uParams.push(val || null);
    uSets.push(`${k} = $${uParams.length}`);
  }
  if ('show_last_seen' in patch && typeof patch.show_last_seen === 'boolean') { uParams.push(patch.show_last_seen); uSets.push(`show_last_seen = $${uParams.length}`); }
  if (uSets.length) await query(`update users set ${uSets.join(', ')} where id = $1 returning id`, uParams);
  // Prénom ou nom modifié : le nom affiché suit.
  if ('first_name' in patch || 'last_name' in patch) {
    await query(`update users set full_name = trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) where id = $1 and coalesce(first_name, last_name) is not null returning id`, [actor.id]);
  }
  const pKeys = profileCols.filter((k) => k in patch);
  if (pKeys.length) {
    await getProfile(actor.id);
    const params = [actor.id, ...pKeys.map((k) => patch[k] ?? (k === 'client_type' ? 'particulier' : k === 'preferred_contact' ? 'whatsapp' : null))];
    await query(`update client_profiles set ${pKeys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where user_id = $1 returning user_id`, params);
  }
  if (patch.email_prefs) {
    await query(`update users set notification_prefs = jsonb_set(notification_prefs, '{email}', coalesce(notification_prefs->'email', '{}'::jsonb) || $2::jsonb) where id = $1 returning id`, [actor.id, JSON.stringify(patch.email_prefs)]);
  }
  await logActivity(actor, 'client.updated', 'user', actor.id, { fields: Object.keys(patch) });
  return getAccount(actor);
}

export async function emailPrefs(userId) {
  const row = await one('select notification_prefs from users where id = $1', [userId]);
  const mine = row?.notification_prefs?.email || {};
  return { categories: Object.entries(USER_EMAIL_CATEGORIES).map(([key, label]) => ({ key, label, email: mine[key] !== false })) };
}

export async function getAccount(actor) {
  const user = await one('select id, email, full_name, first_name, last_name, phone, role, email_verified_at, created_at, last_login_at, avatar_file_id, public_name, job_title, bio, show_last_seen from users where id = $1', [actor.id]);
  return { user: { ...user, email_verified: Boolean(user.email_verified_at) }, profile: await getProfile(actor.id) };
}

/** Historique complet d'un client : ses devis, ses commandes et ses inscriptions. */
export async function historyOfClient(viewer, userId) {
  // Chacun ne voit que les domaines auxquels il a accès (le client : les siens).
  const own = viewer.id === userId;
  const [quotes, orders, enrollments] = await Promise.all([
    own || isTeam(viewer, 'quotes') ? listQuotes(viewer, { userId }) : [],
    own || isTeam(viewer, 'orders') ? listOrders(viewer, { userId }) : [],
    own || isTeam(viewer, 'trainings') ? listEnrollments(viewer, { userId }) : [],
  ]);
  return { quotes, orders, enrollments };
}

/** Liste des comptes pour l'équipe, avec recherche et filtres, et le nombre de demandes de chacun. */
export async function listClients({ search = null, type = null, verified = null, activity = null, status = null, role = 'client' } = {}) {
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('$?', `$${params.length}`)); };
  if (role) add('u.role = $?', role);
  if (search) add(`lower(u.full_name || ' ' || u.email || ' ' || coalesce(u.phone, '') || ' ' || coalesce(p.company_name, '')) like $?`, `%${search.toLowerCase()}%`);
  if (type) add('p.client_type = $?', type);
  if (verified === true) where.push('u.email_verified_at is not null');
  if (verified === false) where.push('u.email_verified_at is null');
  if (status === 'disabled') where.push('u.disabled_at is not null');
  if (status === 'active') where.push('u.disabled_at is null');
  if (activity === 'orders') where.push('exists (select 1 from orders where user_id = u.id)');
  if (activity === 'quotes') where.push('exists (select 1 from quotes where user_id = u.id)');
  if (activity === 'trainings') where.push('exists (select 1 from enrollments where user_id = u.id)');
  if (activity === 'new') where.push(`u.created_at > now() - interval '30 days'`);
  return query(
    `select u.id, u.email, u.full_name, u.phone, u.role, u.created_at, u.last_login_at, (u.email_verified_at is not null) as email_verified,
            u.disabled_at, p.client_type, p.company_name, p.city,
            (select count(*)::int from quotes where user_id = u.id) as quotes,
            (select count(*)::int from orders where user_id = u.id) as orders,
            (select count(*)::int from enrollments where user_id = u.id) as enrollments,
            (select coalesce(sum(total_fcfa), 0)::float8 from orders where user_id = u.id and status <> 'annulee') as ordered_fcfa
       from users u left join client_profiles p on p.user_id = u.id
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by u.created_at desc limit 500`,
    params,
  );
}

export async function getClient(viewer, userId) {
  const user = await one('select id, email, full_name, first_name, last_name, phone, role, email_verified_at, disabled_at, created_at, last_login_at, avatar_file_id from users where id = $1', [userId]);
  if (!user) throw new HttpError(404, 'Client introuvable.');
  return { user, profile: await getProfile(userId, { admin: true }), ...(await historyOfClient(viewer, userId)) };
}

export async function setClientNote(actor, userId, note) {
  await getProfile(userId);
  const row = await one('update client_profiles set admin_note = $2 where user_id = $1 returning user_id', [userId, note]);
  if (!row) throw new HttpError(404, 'Client introuvable.');
  await logActivity(actor, 'client.noted', 'user', userId, {});
  return { ok: true };
}

/**
 * Rattache au compte les demandes envoyées sans compte avec la même adresse,
 * une fois l'adresse vérifiée (sinon n'importe qui pourrait les récupérer).
 */
/** Nouveau compte client : alerte à l'équipe « clients ». */
export async function announceClient(user, method) {
  await notifyTeam('clients', {
    kind: 'client.new', title: `Nouveau client : ${user.full_name}`, body: `Inscription par ${method}.`, link: `/espace?section=clients&client=${user.id}`,
    event: 'client_new', details: [['Nom', user.full_name], ['E-mail', user.email], ['Inscription', method]],
  });
}

export async function claimGuestRequests(user) {
  if (!user?.email_verified_at) return 0;
  const counts = await Promise.all([
    query('update quotes set user_id = $1 where user_id is null and lower(customer_email) = lower($2) returning id', [user.id, user.email]),
    query('update orders set user_id = $1 where user_id is null and lower(customer_email) = lower($2) returning id', [user.id, user.email]),
    query('update enrollments set user_id = $1 where user_id is null and lower(email) = lower($2) returning id', [user.id, user.email]),
  ]);
  const n = counts.reduce((s, r) => s + r.length, 0);
  if (n) await logActivity({ id: user.id, role: user.role }, 'client.claimed', 'user', user.id, { quotes: counts[0].length, orders: counts[1].length, enrollments: counts[2].length });
  return n;
}

/** Photo de profil : un fichier « avatar » déjà vérifié et envoyé par la personne elle-même. */
export async function setAvatar(actor, fileId) {
  const f = await one(`select id from uploaded_files where id = $1 and owner_id = $2 and purpose = 'avatar' and status = 'ready'`, [fileId, actor.id]);
  if (!f) throw new HttpError(400, 'Photo introuvable ou pas encore vérifiée.');
  const prev = await one('select avatar_file_id from users where id = $1', [actor.id]);
  await query('update users set avatar_file_id = $2 where id = $1 returning id', [actor.id, fileId]);
  await logActivity(actor, 'client.avatar', 'user', actor.id, {});
  return { avatar_file_id: fileId, previous: prev?.avatar_file_id || null };
}
