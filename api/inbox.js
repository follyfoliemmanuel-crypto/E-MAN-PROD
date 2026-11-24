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
// Messagerie privée (v4) — une conversation par client :
//   GET ?chat=me | ?chat=<client> [&before=<date>] [&mark=0]   messages (40 par page, du plus récent)
//   GET ?chat=threads [&q=]              équipe « support » : conversations par activité récente
//   GET ?chat=unread                     nombre de messages non lus
//   GET ?chat=team                       client : profils publics de l'équipe (+ présence)
//   GET ?chat=profile&of=<client>        équipe : profil du client
//   POST {action:'chat', to?, body, kind?, file_ids?, voice_ms?}   envoyer
//   POST {action:'typing', to?}          « écrit un message… »
import { z } from 'zod';
import { handler, send, readJson, readQuery, Q } from './_lib/http.js';
import { requireUser, requirePermission, requireAdmin, rateLimit } from './_lib/auth.js';
import { actorOf } from './_lib/activity.js';
import * as s from './_lib/schemas.js';
import { streamNotifications } from './_lib/services/live.js';
import * as inbox from './_lib/services/inbox.js';
import * as chat from './_lib/services/chat.js';

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
    const q = readQuery(req, {
      stream: Q.flag, since: Q.text(80), notifications: Q.flag, unread: Q.flag, category: Q.text(30), before: Q.text(40), limit: Q.text(4),
      announcements: Q.flag, support: Q.text(40), quote: Q.id('Devis'), order: Q.id('Commande'),
      chat: Q.text(40), of: Q.id('Client'), mark: Q.flag, q: Q.text(100), conn: Q.text(40),
    });
    if (q.stream === '1') {
      // Flux temps réel (SSE) : notifications de la personne connectée uniquement.
      await rateLimit(`live:${user.id}`, 120, 60, 'Trop de connexions en temps réel. Rechargez la page dans un moment.');
      const conn = /^[A-Za-z0-9_-]{8,40}$/.test(q.conn || '') ? q.conn : null;
      return streamNotifications(req, res, user, { cursor: q.since || null, conn });
    }
    if (q.chat) {
      if (q.chat === 'threads') return send(res, 200, { threads: await chat.threads(actor, { search: q.q || '' }) });
      if (q.chat === 'pulse') {
        // Mode de secours (flux temps réel bloqué) : ce qui a changé depuis « since ».
        await rateLimit(`pulse:${user.id}`, 60, 1, 'Trop de relectures. Réessayez dans un moment.');
        const since = q.since ? s.parse(z.string().datetime({ offset: true, message: 'Date invalide.' }), q.since) : null;
        return send(res, 200, await chat.pulse(actor, since));
      }
      if (q.chat === 'unread') return send(res, 200, { unread: await chat.unreadCount(actor) });
      if (q.chat === 'team') return send(res, 200, await chat.teamProfiles());
      if (q.chat === 'profile') return send(res, 200, { profile: await chat.clientProfile(actor, s.parse(s.uuid('Client'), q.of)) });
      const who = q.chat === 'me' ? 'me' : s.parse(s.uuid('Conversation'), q.chat);
      const before = q.before ? s.parse(z.string().datetime({ offset: true, message: 'Date invalide.' }), q.before) : null;
      return send(res, 200, await chat.listChat(actor, who, { before, mark: q.mark !== '' }));
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
    if (body.action === 'chat') {
      await rateLimit(`message:${user.id}`, 30, 60, 'Trop de messages envoyés. Réessayez dans un moment ou appelez-nous.');
      const m = s.parse(z.object({
        to: s.optionalUuid('Conversation'),
        body: s.text('Message', { max: 4000 }),
        kind: s.oneOf(['text', 'file', 'voice'], 'Type de message').default('text'),
        file_ids: s.list(s.uuid('Fichier'), 'Fichiers', { max: 5 }).default([]),
        voice_ms: z.number().int().min(0).max(600000).optional().nullable(),
        client_ref: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Référence de message invalide.').optional().nullable(),
      }), body);
      return send(res, 201, { message: await chat.postChat(actor, m.to || 'me', { ...m, name: user.full_name }) });
    }
    if (body.action === 'typing') {
      await rateLimit(`typing:${user.id}`, 40, 1, 'Trop de signaux.');
      const { to } = s.parse(z.object({ to: s.optionalUuid('Conversation') }), body);
      return send(res, 200, await chat.setTyping(actor, to || 'me'));
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
