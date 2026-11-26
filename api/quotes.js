// /api/quotes — devis
//   POST                      envoyer une demande (public ; un admin peut aussi en créer, avec prix)
//   POST {action: 'status'}   changer le statut (admin, ou client : accepter / refuser / annuler)
//   POST {action: 'convert'}  transformer un devis accepté en commande (admin)
//   GET                       liste (client : les siens ; admin : tous, filtres ?status= &q= &user=)
//   GET ?id=                  détail : lignes, fichiers, commande liée, historique
//   GET ?id=&pdf=1            devis en PDF (client : une fois envoyé ; équipe : toujours, « brouillon » avant l'envoi)
//   PATCH {id, …}             lignes, prix, remise, validité, client associé, note (admin)
import { z } from 'zod';
import { handler, send, readJson, clientIp, readQuery, Q } from './_lib/http.js';
import { currentUser, requireUser, requirePermission, rateLimit, can } from './_lib/auth.js';
import { actorOf } from './_lib/activity.js';
import * as s from './_lib/schemas.js';
import * as quotes from './_lib/services/quotes.js';
import { quotePdf, sendPdf } from './_lib/pdf.js';

/** Faux accusé de réception pour un robot piégé (même forme qu'une vraie réponse). */
const fakeReceipt = (prefix) => {
  const ref = `${prefix}-${new Date().getFullYear()}-${String(Math.floor(10000 + Math.random() * 89999))}`;
  return { id: crypto.randomUUID(), number: ref, reference: ref };
};

const createSchema = z.object({
  ...s.customer,
  message: s.text('Description', { min: 5, max: 4000 }),
  items: s.list(s.lineItem, 'Prestations', { max: 20 }),
  // Ancien formulaire (une seule prestation) : toujours accepté.
  service: s.text('Prestation', { min: 2, max: 160 }),
  details: s.text('Description', { min: 5, max: 4000 }),
  quantity: s.text('Quantité', { max: 200 }),
  // Réservé à l'administration.
  user_id: s.optionalUuid('Client'),
  source: z.enum(['site', 'whatsapp', 'telephone', 'atelier', 'admin']).optional(),
  // Case « J’accepte… » du formulaire public (obligatoire sans compte) et champ piège invisible anti-robot.
  consent: z.boolean().optional(),
  website: z.string().max(300).optional(),
});

const patchSchema = z.object({
  items: s.list(s.lineItem, 'Lignes', { max: 50 }),
  discount_fcfa: s.fcfa('Remise'),
  valid_until: s.date('Valable jusqu’au'),
  admin_note: s.text('Note interne', { max: 4000 }),
  user_id: s.optionalUuid('Client'),
  name: s.customer.name,
  phone: s.customer.phone,
  email: s.customer.email,
  company: s.customer.company,
});

const statusSchema = z.object({
  id: s.uuid('Devis'),
  to: s.oneOf(s.QUOTE_STATUSES, 'Statut'),
  reason: s.text('Motif', { max: 500 }),
});

export default handler({
  async POST(req, res) {
    const body = await readJson(req);
    if (body.action === 'status') {
      const user = await requireUser(req);
      const { id, to, reason } = s.parse(statusSchema, body);
      return send(res, 200, { quote: await quotes.changeQuoteStatus(actorOf(user), id, to, { reason }) });
    }
    if (body.action === 'convert') {
      const user = await requirePermission(req, 'quotes');
      const { id, due_on } = s.parse(z.object({ id: s.uuid('Devis'), due_on: s.date('Date de livraison prévue') }), body);
      return send(res, 201, { order: await quotes.convertToOrder(actorOf(user), id, { due_on }) });
    }

    const user = await currentUser(req);
    const actor = actorOf(user);
    const data = s.parse(createSchema, body);
    const items = data.items.length ? data.items
      : data.service ? [{ label: data.service, description: data.quantity ? `Quantité / format : ${data.quantity}` : null, quantity: 1 }]
        : [];
    const message = data.message ?? data.details;
    if (!can(actor, 'quotes')) {
      // Champ piège rempli : un robot. Réponse identique à un succès, rien n'est enregistré.
      if (data.website) return send(res, 201, fakeReceipt('DV'));
      if (!user && data.consent !== true) return send(res, 400, { error: 'Cochez la case d’accord sur l’utilisation de vos informations.' });
      if (!message) return send(res, 400, { error: 'Description : champ obligatoire.' });
      await rateLimit(`quote:phone:${data.phone}`, 5, 60, 'Trop de demandes envoyées avec ce numéro. Écrivez-nous sur WhatsApp.');
      await rateLimit(`quote:ip:${clientIp(req)}`, 20, 60, 'Trop de demandes envoyées. Écrivez-nous sur WhatsApp.');
    }
    const quote = await quotes.createQuote(actor, {
      ...data,
      items,
      message,
      email: data.email ?? user?.email ?? null,
      user_id: can(actor, 'quotes') ? data.user_id : null,
      consent_at: data.consent === true ? new Date().toISOString() : null,
    });

    // « reference » : nom utilisé par le formulaire du site depuis la v1.
    send(res, 201, { id: quote.id, number: quote.number, reference: quote.number });
  },

  async GET(req, res) {
    const user = await requireUser(req);
    const actor = actorOf(user);
    const f = readQuery(req, { id: Q.id('Devis'), pdf: Q.flag, status: Q.oneOf(s.QUOTE_STATUSES), q: Q.text(100), user: Q.id('Client') });
    if (f.id && f.pdf) return sendPdf(res, await quotePdf(actor, f.id));
    if (f.id) return send(res, 200, { quote: await quotes.getQuote(actor, f.id) });
    send(res, 200, { quotes: await quotes.listQuotes(actor, { status: f.status, search: f.q || null, userId: f.user || null }) });
  },

  async PATCH(req, res) {
    const user = await requirePermission(req, 'quotes');
    const body = await readJson(req);
    const id = s.parse(s.uuid('Devis'), body.id);
    const { id: _id, ...rest } = body;
    const patch = s.parsePatch(patchSchema, rest);
    send(res, 200, { quote: await quotes.updateQuote(actorOf(user), id, patch) });
  },
});
