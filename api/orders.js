// /api/orders — commandes
//   GET            liste (client : les siennes ; admin : toutes, filtres ?status= &q= &user=)
//   GET ?id=       détail : lignes, fichiers, historique des modifications
//   POST           commande directe sans devis (admin : client venu à l'atelier…)
//   GET ?id=&pdf=1 bon de commande en PDF (client concerné ou équipe)
//   GET ?members=1 collaborateurs à qui confier une commande
//   POST {action: 'comment', id, text}   commentaire interne (équipe)
//   PATCH {id, …}  statut, paiement, lignes, remise, date promise, collaborateur, note (équipe)
// Une commande issue d'un devis se crée par POST /api/quotes {action: 'convert'}.
import { z } from 'zod';
import { handler, send, readJson } from './_lib/http.js';
import { requireUser, requirePermission } from './_lib/auth.js';
import { actorOf } from './_lib/activity.js';
import * as s from './_lib/schemas.js';
import * as orders from './_lib/services/orders.js';
import { orderPdf, sendPdf } from './_lib/pdf.js';

const createSchema = z.object({
  ...s.customer,
  user_id: s.optionalUuid('Client'),
  items: s.list(s.lineItem, 'Lignes', { max: 50 }),
  due_on: s.date('Date de livraison prévue'),
  admin_note: s.text('Note interne', { max: 4000 }),
});

const patchSchema = z.object({
  status: s.oneOf(s.ORDER_STATUSES, 'Statut'),
  payment_status: s.oneOf(s.PAYMENT_STATUSES, 'Paiement'),
  amount_paid_fcfa: s.fcfa('Montant encaissé'),
  items: s.list(s.lineItem, 'Lignes', { max: 50 }),
  discount_fcfa: s.fcfa('Remise'),
  due_on: s.date('Date de livraison prévue'),
  admin_note: s.text('Note interne', { max: 4000 }),
  assigned_to: s.optionalUuid('Collaborateur'),
});

export default handler({
  async GET(req, res) {
    const actor = actorOf(await requireUser(req));
    if (req.query?.id && req.query?.pdf === '1') return sendPdf(res, await orderPdf(actor, s.parse(s.uuid('Commande'), req.query.id)));
    if (req.query?.id) return send(res, 200, { order: await orders.getOrder(actor, s.parse(s.uuid('Commande'), req.query.id)) });
    if (req.query?.members === '1') {
      await requirePermission(req, 'orders');
      return send(res, 200, { members: await orders.assignableMembers() });
    }
    const f = s.parse(z.object({
      status: s.oneOf(s.ORDER_STATUSES, 'Statut').optional(),
      q: s.text('Recherche', { max: 100 }),
      user: s.optionalUuid('Client'),
      assigned: z.string().regex(/^(me|[0-9a-f-]{36})$/).optional(),
    }), req.query || {});
    send(res, 200, { orders: await orders.listOrders(actor, { status: f.status, search: f.q, userId: f.user, assigned: f.assigned }) });
  },

  async POST(req, res) {
    const actor = actorOf(await requirePermission(req, 'orders'));
    const body = await readJson(req);
    if (body.action === 'comment') {
      const c = s.parse(z.object({ id: s.uuid('Commande'), text: s.text('Commentaire', { min: 1, max: 2000, req: true }) }), body);
      return send(res, 201, { order: await orders.addComment(actor, c.id, c.text) });
    }
    const data = s.parse(createSchema, body);
    send(res, 201, { order: await orders.createOrder(actor, data) });
  },

  async PATCH(req, res) {
    const actor = actorOf(await requirePermission(req, 'orders'));
    const body = await readJson(req);
    const id = s.parse(s.uuid('Commande'), body.id);
    const { id: _id, ...rest } = body;
    send(res, 200, { order: await orders.updateOrder(actor, id, s.parsePatch(patchSchema, rest)) });
  },
});
