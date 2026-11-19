// Messages (fil de discussion d'un devis ou d'une commande) et notifications.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { notifyUser, notifyTeam, isTeam } from '../activity.js';
import { loadQuote } from './quotes.js';
import { loadOrder } from './orders.js';

/** Vérifie l'accès au fil et renvoie la ressource (devis ou commande). */
async function thread(actor, { quote_id: quoteId, order_id: orderId, support_user_id: supportUserId }) {
  if (supportUserId !== undefined && supportUserId !== null) {
    // Assistance : le client n'accède qu'à son propre fil ; l'équipe « support » à tous.
    if (supportUserId !== actor.id && !isTeam(actor, 'support')) throw new HttpError(404, 'Conversation introuvable.');
    const user = await one('select id, full_name from users where id = $1', [supportUserId]);
    if (!user) throw new HttpError(404, 'Conversation introuvable.');
    return { type: 'support', perm: 'support', column: 'support_user_id', id: supportUserId, res: { user_id: user.id, number: user.full_name } };
  }
  if (Boolean(quoteId) === Boolean(orderId)) throw new HttpError(400, 'Indiquez un devis ou une commande.');
  return quoteId ? { type: 'quote', perm: 'quotes', column: 'quote_id', id: quoteId, res: await loadQuote(actor, quoteId) }
    : { type: 'order', perm: 'orders', column: 'order_id', id: orderId, res: await loadOrder(actor, orderId) };
}

export async function listMessages(actor, target) {
  const t = await thread(actor, target);
  const mine = t.type === 'support' ? t.id === actor.id : !isTeam(actor, t.perm);
  const other = mine ? 'admin' : 'client';
  // Ouvrir le fil marque comme lus les messages de l'autre partie.
  await query(`update messages set read_at = now() where ${t.column} = $1 and author_role = $2 and read_at is null returning id`, [t.id, other]);
  return query(
    `select m.id, m.author_role, m.body, m.created_at, m.read_at, u.full_name as author_name,
            coalesce((select json_agg(json_build_object('id', f.id, 'original_name', f.original_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes) order by f.created_at)
                        from uploaded_files f where f.message_id = m.id and f.status = 'ready'), '[]'::json) as files
       from messages m left join users u on u.id = m.author_id
      where m.${t.column} = $1 order by m.created_at, m.id`,
    [t.id],
  );
}

export async function postMessage(actor, target, body) {
  const t = await thread(actor, target);
  // « admin » = côté atelier (admin ou staff), « client » = côté client.
  const role = (t.type === 'support' ? t.id !== actor.id : isTeam(actor, t.perm)) ? 'admin' : 'client';
  const row = await one(
    `insert into messages (${t.column}, author_id, author_role, body) values ($1, $2, $3, $4) returning id, created_at`,
    [t.id, actor.id, role, body],
  );
  const label = t.type === 'quote' ? `devis ${t.res.number}` : t.type === 'order' ? `commande ${t.res.number}` : 'demande d’assistance';
  const link = t.type === 'quote' ? `/espace?devis=${t.id}` : t.type === 'order' ? `/espace?commande=${t.id}` : role === 'admin' ? '/espace?section=assistance' : `/espace?section=assistance&client=${t.id}`;
  if (role === 'admin') {
    const title = t.type === 'support' ? 'Réponse de l’équipe E-MAN PROD' : `Nouveau message sur votre ${label}`;
    await notifyUser(t.res.user_id, { kind: 'message.new', title, body: body.slice(0, 140), link, email: 'message_new', vars: { sujet: title }, emailBody: body.slice(0, 1000) });
  } else {
    await notifyTeam(t.perm, { kind: 'message.new', title: t.type === 'support' ? `Assistance : message de ${actor.name || 'un client'}` : `Message du client sur le ${label}`, body: body.slice(0, 140), link, event: 'message_new' });
  }
  return row;
}

export const NOTIFICATION_CATEGORIES = ['quotes', 'orders', 'trainings', 'messages', 'announcements', 'account', 'team', 'general'];

/** Centre de notifications : les plus récentes d'abord, 30 par page (`before` = date de la dernière reçue). */
export async function listNotifications(actor, { unread = false, category = null, before = null, limit = 30 } = {}) {
  const where = ['user_id = $1'];
  const params = [actor.id];
  if (unread) where.push('read_at is null');
  if (category) { params.push(category); where.push(`category = $${params.length}`); }
  if (before) { params.push(before); where.push(`created_at < $${params.length}::timestamptz`); }
  params.push(Math.min(limit, 100) + 1);
  const [rows, [{ n }], byCat] = await Promise.all([
    query(
      `select id, kind, category, title, body, link, read_at, created_at from notifications
        where ${where.join(' and ')} order by created_at desc, id limit $${params.length}`,
      params,
    ),
    query('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [actor.id]),
    query('select category, count(*)::int as n from notifications where user_id = $1 and read_at is null group by category', [actor.id]),
  ]);
  const more = rows.length > Math.min(limit, 100);
  return { notifications: rows.slice(0, Math.min(limit, 100)), unread: n, unread_by_category: Object.fromEntries(byCat.map((r) => [r.category, r.n])), has_more: more };
}

export async function markNotificationsUnread(actor, ids) {
  const rows = await query('update notifications set read_at = null where user_id = $1 and id = any($2::uuid[]) returning id', [actor.id, `{${ids.join(',')}}`]);
  return { marked: rows.length };
}

/** Annonce (« information importante ») : notification à tous les clients, e-mail en option. */
export async function publishAnnouncement(actor, { title, body, link = null, audience = 'clients', send_email: sendEmail = false }) {
  const row = await one(
    `insert into announcements (title, body, link, audience, send_email, created_by) values ($1, $2, $3, $4, $5, $6) returning id, published_at`,
    [title, body, link, audience, sendEmail, actor.id],
  );
  const users = await query(
    `select id from users where disabled_at is null ${audience === 'clients' ? `and role = 'client'` : ''} order by created_at`,
  );
  let emailed = 0;
  const notifLink = link && link.startsWith('/') ? link : '/espace?section=notifications';
  // Envois par petits groupes pour ne pas dépasser les limites du fournisseur.
  for (let i = 0; i < users.length; i += 8) {
    const results = await Promise.all(users.slice(i, i + 8).map((u) => notifyUser(u.id, {
      kind: 'announcement.published', category: 'announcements', title, body: body.slice(0, 300), link: notifLink,
      ...(sendEmail ? { email: 'announcement', vars: { titre: title }, emailBody: body } : {}),
    })));
    emailed += results.filter((r) => r?.status === 'envoye').length;
  }
  await query('update announcements set recipients = $2, emailed = $3 where id = $1 returning id', [row.id, users.length, emailed]);
  const { logActivity } = await import('../activity.js');
  await logActivity(actor, 'announcement.published', 'announcement', row.id, { title, recipients: users.length, emailed });
  return { id: row.id, recipients: users.length, emailed, email_requested: sendEmail };
}

export async function listAnnouncements({ forClients = false, limit = 20 } = {}) {
  return query(
    `select a.id, a.title, a.body, a.link, a.audience, a.published_at${forClients ? '' : ', a.send_email, a.recipients, a.emailed, u.full_name as author'}
       from announcements a left join users u on u.id = a.created_by order by a.published_at desc limit $1`,
    [limit],
  );
}

export async function markNotificationsRead(actor, ids) {
  const rows = ids?.length
    ? await query('update notifications set read_at = now() where user_id = $1 and id = any($2::uuid[]) and read_at is null returning id', [actor.id, `{${ids.join(',')}}`])
    : await query('update notifications set read_at = now() where user_id = $1 and read_at is null returning id', [actor.id]);
  return { marked: rows.length };
}

/** Conversations d'assistance (équipe « support ») : dernier message et messages non lus. */
export async function supportThreads() {
  return query(
    `select u.id as user_id, u.full_name, u.email, max(m.created_at) as last_at,
            (array_agg(m.body order by m.created_at desc))[1] as last_body,
            (array_agg(m.author_role order by m.created_at desc))[1] as last_role,
            count(*) filter (where m.author_role = 'client' and m.read_at is null)::int as unread
       from messages m join users u on u.id = m.support_user_id
      group by u.id order by max(m.created_at) desc limit 200`,
  );
}
