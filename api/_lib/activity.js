// Journal d'activité et notifications : deux traces écrites par les règles métier.
import { query, one } from './db.js';
import { can } from './auth.js';

/** Personne qui agit : utilisateur connecté (avec ses permissions lues en base), ou visiteur. */
export const actorOf = (user) => (user ? { id: user.id, role: user.role, permissions: user.permissions || [] } : { id: null, role: 'guest', permissions: [] });
export const isAdmin = (actor) => actor?.role === 'admin';
/** Équipe de l'atelier ayant ce droit (admin, ou staff à qui il a été accordé). */
export const isTeam = (actor, permission) => can(actor, permission);
export { can };

/**
 * Ajoute une ligne à l'historique d'un devis, d'une commande, d'une inscription…
 * @param {{id: string|null, role: string}} actor
 */
export async function logActivity(actor, action, entityType, entityId, data = {}) {
  await query(
    `insert into activity_logs (actor_id, actor_role, action, entity_type, entity_id, data)
     values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
    [actor?.id ?? null, actor?.role ?? 'system', action, entityType, String(entityId), JSON.stringify(data)],
  );
}

export async function historyOf(entityType, entityId, { forClient = false } = {}) {
  // Les clients voient les changements de statut et de prix, pas les notes internes.
  const rows = await query(
    `select a.action, a.data, a.created_at, a.actor_role, u.full_name as actor_name
       from activity_logs a left join users u on u.id = a.actor_id
      where a.entity_type = $1 and a.entity_id = $2
      order by a.created_at, a.id`,
    [entityType, String(entityId)],
  );
  if (!forClient) return rows;
  return rows
    .filter((r) => /\.(created|status_changed|sent|converted)$/.test(r.action))
    .map(({ action, data, created_at, actor_role }) => ({
      action,
      created_at,
      actor_role,
      data: { from: data.from, to: data.to, number: data.number },
    }));
}

const CATEGORY_OF = (kind) => (
  kind.startsWith('quote.') ? 'quotes' : kind.startsWith('order.') || kind.startsWith('invoice.') || kind.startsWith('payment.') ? 'orders'
    : kind.startsWith('enrollment.') || kind.startsWith('certificate.') ? 'trainings' : kind.startsWith('message.') ? 'messages'
      : kind.startsWith('announcement.') ? 'announcements' : 'general');

/** Événements envoyés par e-mail aux clients, activables un par un par l'administration. */
export const CLIENT_EMAIL_EVENTS = ['quote_received', 'quote_sent', 'quote_decision', 'order_confirmed', 'order_update', 'order_ready', 'invoice_issued', 'enrollment_confirmed', 'certificate_issued', 'message_new', 'announcement'];
/** Alertes envoyées par e-mail à l'équipe. */
export const TEAM_EMAIL_EVENTS = { client_new: 'Nouveau client inscrit', quote_new: 'Demande de devis', order_new: 'Commande créée', enrollment_new: 'Inscription à une formation', message_new: 'Nouveau message' };
/** Rubriques que chaque client peut couper pour les e-mails (les notifications dans l'espace restent). */
export const USER_EMAIL_CATEGORIES = { quotes: 'Devis', orders: 'Commandes et factures', trainings: 'Formations', messages: 'Messages de l’équipe', announcements: 'Informations importantes' };

export async function notificationSettings() {
  const v = (await one(`select value from site_settings where key = 'notifications'`))?.value || {};
  return { client_email: v.client_email || {}, team_email: v.team_email || {}, team_email_to: v.team_email_to || '' };
}

/**
 * Notification dans l'espace d'un utilisateur et, avec `email: '<modèle>'`, e-mail
 * transactionnel — si l'administration a activé ce type d'e-mail et si la personne
 * ne l'a pas désactivé. Renvoie le résultat de l'envoi (null si pas d'e-mail prévu).
 */
export async function notifyUser(userId, { kind, title, body = null, link = null, category = null, email = null, vars = {}, details = null, emailBody = null }) {
  if (!userId) return null;
  const cat = category || CATEGORY_OF(kind);
  await query(
    'insert into notifications (user_id, kind, title, body, link, category) values ($1, $2, $3, $4, $5, $6) returning id',
    [userId, kind, title, body, link, cat],
  );
  if (!email || typeof email !== 'string') return null;
  const u = await one('select email, first_name, full_name, notification_prefs from users where id = $1 and disabled_at is null', [userId]);
  if (!u) return null;
  const { client_email: adminPrefs } = await notificationSettings();
  const off = adminPrefs[email] === false || u.notification_prefs?.email?.[cat] === false;
  const { sendTemplate } = await import('./emails.js');
  return sendTemplate(email, {
    to: u.email, userId, disabled: off, link, details, body: emailBody ?? body,
    vars: { prenom: u.first_name || u.full_name, ...vars },
  }).catch((err) => ({ status: 'echec', error: err.message }));
}

/** E-mail à une personne sans compte (demande envoyée sans être connecté). */
export async function emailGuest(to, template, { name, vars = {}, details, body, link }) {
  if (!to) return null;
  const { client_email: adminPrefs } = await notificationSettings();
  const { sendTemplate } = await import('./emails.js');
  return sendTemplate(template, { to, disabled: adminPrefs[template] === false, details, body, link, vars: { prenom: String(name || '').split(' ')[0], ...vars } })
    .catch((err) => ({ status: 'echec', error: err.message }));
}

/**
 * Notification à l'équipe concernée (admins et staff ayant ce droit) et, si l'événement
 * est activé dans les paramètres, alerte e-mail à l'adresse de l'équipe.
 */
export async function notifyTeam(permission, { kind, title, body = null, link = null, event = null, details = null, exclude = null }) {
  await query(
    `insert into notifications (user_id, kind, title, body, link, category)
     select id, $1, $2, $3, $4, 'team' from users
      where disabled_at is null and (role = 'admin' or (role = 'staff' and $5 = any(permissions)))
        and ($6::uuid is null or id <> $6::uuid)
     returning id`,
    [kind, title, body, link, permission, exclude],
  );
  if (!event) return null;
  const s = await notificationSettings();
  // Par défaut : activé, sauf les messages (souvent nombreux).
  if ((s.team_email[event] ?? event !== 'message_new') !== true) return null;
  const biz = (await one(`select value from site_settings where key = 'business'`))?.value || {};
  const to = s.team_email_to || process.env.NOTIFY_TO || biz.email;
  if (!to) return null;
  const { sendTemplate } = await import('./emails.js');
  return sendTemplate('team_alert', { to, vars: { titre: title }, body, details, link: link || '/espace' }).catch(() => null);
}
