// Équipe et sécurité : rôles, permissions, comptes désactivés, sessions, journal.
// Seul un administrateur change un rôle ; jamais le navigateur, jamais pour soi-même.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { PERMISSIONS, logSecurity, sha256, readCookie, issueToken, maskEmail } from '../auth.js';
import { sendMail, mailConfigured } from '../mail.js';
import { siteUrl } from '../http.js';

const ROLES = ['client', 'staff', 'admin'];

export async function listTeam() {
  return query(
    `select id, email, full_name, role, permissions, email_verified_at is not null as email_verified, disabled_at, last_login_at,
            (select count(*)::int from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions
       from users u where role in ('admin', 'staff') or disabled_at is not null
      order by role, full_name`,
  );
}

/** Change le rôle et les permissions d'un compte (administrateur uniquement). */
export async function setRole(req, admin, { user_id: userId, role, permissions = [] }) {
  if (!ROLES.includes(role)) throw new HttpError(400, 'Rôle invalide.');
  const unknown = permissions.filter((p) => !PERMISSIONS[p]);
  if (unknown.length) throw new HttpError(400, `Permission inconnue : ${unknown.join(', ')}.`);
  if (userId === admin.id) throw new HttpError(409, 'Vous ne pouvez pas modifier votre propre rôle : demandez à un autre administrateur.');
  const target = await one('select id, email, role, permissions, email_verified_at from users where id = $1', [userId]);
  if (!target) throw new HttpError(404, 'Compte introuvable.');
  if (role !== 'client' && !target.email_verified_at) {
    throw new HttpError(409, 'Ce compte doit d’abord confirmer son adresse e-mail avant de rejoindre l’équipe.');
  }
  const perms = role === 'staff' ? [...new Set(permissions)].sort() : [];
  if (role === 'staff' && !perms.length) throw new HttpError(400, 'Choisissez au moins une permission pour un membre staff.');
  await one(
    `update users set role = $2, permissions = $3::text[] where id = $1 returning id`,
    [userId, role, `{${perms.join(',')}}`],
  );
  // Rôle diminué : les sessions ouvertes sont fermées (le nouveau rôle s'applique de toute façon à la requête suivante).
  const rank = { client: 0, staff: 1, admin: 2 };
  const lowered = rank[role] < rank[target.role] || (role === 'staff' && target.permissions.some((p) => !perms.includes(p)));
  if (lowered) await query('delete from sessions where user_id = $1 returning id', [userId]);
  await logSecurity(req, 'auth.role_changed', {
    userId: admin.id, role: 'admin',
    data: { target: userId, email: target.email, from: target.role, to: role, permissions_from: target.permissions, permissions_to: perms },
  });
  return { id: userId, role, permissions: perms };
}

/** Désactive ou réactive un compte : désactivé, il ne peut plus se connecter. */
export async function setDisabled(req, admin, userId, disabled) {
  if (userId === admin.id) throw new HttpError(409, 'Vous ne pouvez pas désactiver votre propre compte.');
  const row = await one(
    `update users set disabled_at = case when $2 then coalesce(disabled_at, now()) else null end where id = $1 returning id, email, role`,
    [userId, disabled],
  );
  if (!row) throw new HttpError(404, 'Compte introuvable.');
  if (disabled) { await query('delete from sessions where user_id = $1 returning id', [userId]); await query('update trusted_devices set revoked_at = now() where user_id = $1 and revoked_at is null returning id', [userId]); }
  await logSecurity(req, disabled ? 'auth.account_disabled' : 'auth.account_enabled', { userId: admin.id, role: 'admin', data: { target: userId, email: row.email } });
  return { ok: true };
}

export async function revokeUserSessions(req, admin, userId) {
  const rows = await query('delete from sessions where user_id = $1 returning id', [userId]);
  // Sessions fermées par l'administrateur : plus aucun appareil de confiance pour ce compte.
  await query('update trusted_devices set revoked_at = now() where user_id = $1 and revoked_at is null returning id', [userId]);
  await logSecurity(req, 'auth.sessions_revoked_all', { userId: admin.id, role: 'admin', data: { target: userId, count: rows.length } });
  return { revoked: rows.length };
}

/** Journal de sécurité (connexions, échecs, changements de rôle, accès refusés). */
export async function securityLog({ limit = 200 } = {}) {
  return query(
    `select a.created_at, a.action, a.actor_role, a.data, u.email as actor_email
       from activity_logs a left join users u on u.id = a.actor_id
      where a.action like 'auth.%' or a.action like 'security.%'
      order by a.created_at desc limit $1`,
    [limit],
  );
}

// --- Sessions de l'utilisateur lui-même ------------------------------------------------------
const currentHash = (req) => {
  const token = readCookie(req, '__Host-emp_session') || readCookie(req, 'emp_session');
  return token ? sha256(token) : null;
};

export async function mySessions(req, user) {
  const hash = currentHash(req);
  return query(
    `select id, created_at, last_seen_at, expires_at, method, user_agent, (token_hash = $2 or previous_token_hash = $2) as current
       from sessions where user_id = $1 and expires_at > now() order by last_seen_at desc`,
    [user.id, hash],
  );
}

/** Ferme une de mes sessions, ou toutes les autres (« déconnecter mes autres appareils »). */
export async function revokeMine(req, user, { id = null, others = false }) {
  const hash = currentHash(req);
  const rows = others
    ? await query('delete from sessions where user_id = $1 and token_hash <> $2 and coalesce(previous_token_hash, \'\') <> $2 returning id, trusted_device_id', [user.id, hash])
    : await query('delete from sessions where user_id = $1 and id = $2 returning id, trusted_device_id', [user.id, id]);
  if (!others && !rows.length) throw new HttpError(404, 'Session introuvable.');
  // Session fermée : l'appareil qui l'avait ouverte n'est plus de confiance (code redemandé).
  const devices = rows.map((r) => r.trusted_device_id).filter(Boolean);
  if (devices.length) await query('update trusted_devices set revoked_at = now() where id = any($1::uuid[]) and revoked_at is null returning id', [`{${devices.join(',')}}`]);
  await logSecurity(req, others ? 'auth.sessions_revoked_others' : 'auth.session_revoked', { userId: user.id, role: user.role, data: { count: rows.length } });
  return { revoked: rows.length };
}

/**
 * Créer un compte STAFF : le compte n'a pas de mot de passe ; la personne reçoit un lien
 * (72 h, usage unique) pour choisir le sien, ce qui confirme aussi son adresse.
 * Sans service d'e-mails, le lien est renvoyé à l'administrateur pour qu'il le transmette.
 */
export async function inviteStaff(req, admin, { first_name: first, last_name: last, email, permissions }) {
  const unknown = permissions.filter((p) => !PERMISSIONS[p]);
  if (unknown.length) throw new HttpError(400, `Permission inconnue : ${unknown.join(', ')}.`);
  if (!permissions.length) throw new HttpError(400, 'Choisissez au moins une permission.');
  if (await one('select id from users where lower(email) = $1', [email])) {
    throw new HttpError(409, 'Un compte existe déjà avec cette adresse : recherchez-le et changez son rôle.');
  }
  const user = await one(
    `insert into users (email, password_hash, full_name, first_name, last_name, role, permissions)
     values ($1, null, $2, $3, $4, 'staff', $5::text[]) returning id`,
    [email, `${first} ${last}`, first, last, `{${[...new Set(permissions)].sort().join(',')}}`],
  );
  const token = await issueToken(user.id, 'reset', 72);
  const link = `${siteUrl(req)}/espace?reinitialiser=${token}`;
  let emailed = false;
  if (mailConfigured()) {
    const { sendTemplate } = await import('../emails.js');
    emailed = (await sendTemplate('staff_invite', { to: email, userId: user.id, link, vars: { prenom: first, invite_par: admin.full_name } })).status === 'envoye';
  }
  await logSecurity(req, 'auth.staff_invited', { userId: admin.id, role: 'admin', data: { target: user.id, email: maskEmail(email), permissions, emailed } });
  // Le lien n'est renvoyé que s'il n'a pas pu partir par e-mail.
  return { id: user.id, emailed, link: emailed ? null : link };
}

/** Historique des actions d'un collaborateur (devis, commandes, contenu, sécurité). */
export async function actionsOf(userId, { limit = 200 } = {}) {
  return query(
    `select created_at, action, entity_type, entity_id, data from activity_logs
      where actor_id = $1 order by created_at desc limit $2`,
    [userId, limit],
  );
}
