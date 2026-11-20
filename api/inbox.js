// /api/inbox — messages et notifications
//   GET ?quote=<id> | ?order=<id>        fil de discussion (marque comme lus les messages reçus)
//   POST {quote_id | order_id, body}     écrire un message
//   GET ?support=me | ?support=<client>  fil d'assistance (le client : le sien ; l'équipe « support » : tous)
//   GET ?support=threads                 équipe : liste des conversations d'assistance
//   POST {support: true, body}           client : écrire à l'assistance ; {support_user_id, body} : l'équipe répond
//   GET ?notifications=1 [&unread=1] [&limit=n]  mes notifications
//   POST {action: 'read', ids?}          marquer comme lues (toutes si ids absent) ; {action: 'unread', ids}
//   GET ?stream=1 [&since=]               flux temps réel (Server-Sent Events) de MES notifications
//   GET ?announcements=1                 annonces publiées ; POST {action: 'announce', …} : admin
import { z } from 'zod';
import { handler, send, readJson } from './_lib/http.js';
import { requireUser, requirePermission, requireAdmin, rateLimit } from './_lib/auth.js';
import { actorOf } from './_lib/activity.js';
import * as s from './_lib/schemas.js';
import { streamNotifications } from './_lib/services/live.js';
import * as inbox from './_lib/services/inbox.js';

const messageSchema = z.object({
  quote_id: s.optionalUuid('Devis'),
  order_id: s.optionalUuid('Commande'),
  support_user_id: s.optionalUuid('Conversation'),
  support: z.literal(true).optional(),
  body: s.text('Message', { min: 1, max: 4000, req: true }),
});

export default handler({
  async GET(req, res) {
    const user = await requireUser(req);
    const actor = actorOf(user);
    const q = req.query || {};
    if (q.stream === '1') {
      // Flux temps réel (SSE) : notifications de la personne connectée uniquement.
      await rateLimit(`live:${user.id}`, 120, 60, 'Trop de connexions en temps réel. Rechargez la page dans un moment.');
      return streamNotifications(req, res, user, { cursor: typeof q.since === 'string' ? q.since : null });
    }
    if (q.notifications === '1') {
      const f = s.parse(z.object({
        category: s.oneOf(inbox.NOTIFICATION_CATEGORIES, 'Rubrique').optional(),
        before: z.string().datetime({ offset: true, message: 'Date invalide.' }).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }), { category: q.category || undefined, before: q.before || undefined, limit: q.limit || undefined });
      return send(res, 200, await inbox.listNotifications(actor, { unread: q.unread === '1', ...f }));
    }
    if (q.announcements === '1') return send(res, 200, { announcements: await inbox.listAnnouncements({ forClients: actor.role === 'client' }) });
    if (q.support === 'threads') {
      await requirePermission(req, 'support');
      return send(res, 200, { threads: await inbox.supportThreads() });
    }
    if (q.support) {
      const id = q.support === 'me' ? actor.id : s.parse(s.uuid('Conversation'), q.support);
      return send(res, 200, { messages: await inbox.listMessages(actor, { support_user_id: id }) });
    }
    const target = s.parse(z.object({ quote: s.optionalUuid('Devis'), order: s.optionalUuid('Commande') }), q);
    send(res, 200, { messages: await inbox.listMessages(actor, { quote_id: target.quote, order_id: target.order }) });
  },

  async POST(req, res) {
    const user = await requireUser(req);
    const actor = actorOf(user);
    const body = await readJson(req);
    if (body.action === 'unread') {
      const { ids } = s.parse(z.object({ ids: s.list(s.uuid('Notification'), 'Notifications', { max: 200 }).refine((l) => l.length > 0, 'Choisissez au moins une notification.') }), body);
      return send(res, 200, await inbox.markNotificationsUnread(actor, ids));
    }
    if (body.action === 'announce') {
      await requireAdmin(req);
      const a = s.parse(z.object({
        title: s.text('Titre', { min: 3, max: 140, req: true }),
        body: s.text('Texte', { min: 10, max: 4000, req: true }),
        link: z.string().trim().max(300).regex(/^(\/[^\s]*|https:\/\/[^\s]+)$/, 'Lien : une adresse du site (/…) ou https://…').optional().nullable(),
        audience: s.oneOf(['clients', 'tous'], 'Destinataires').default('clients'),
        send_email: z.boolean().default(false),
      }), body);
      return send(res, 201, await inbox.publishAnnouncement(actor, a));
    }
    if (body.action === 'read') {
      const { ids } = s.parse(z.object({ ids: s.list(s.uuid('Notification'), 'Notifications', { max: 200 }) }), body);
      return send(res, 200, await inbox.markNotificationsRead(actor, ids));
    }
    await rateLimit(`message:${user.id}`, 30, 60, 'Trop de messages envoyés. Réessayez dans un moment ou appelez-nous.');
    const m = s.parse(messageSchema, body);
    const support = m.support ? actor.id : m.support_user_id;
    send(res, 201, { message: await inbox.postMessage({ ...actor, name: user.full_name }, support ? { support_user_id: support } : { quote_id: m.quote_id, order_id: m.order_id }, m.body) });
  },
});
