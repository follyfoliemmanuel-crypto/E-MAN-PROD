// Paiements, reçus et factures.
// Règle : une facture n'est jamais marquée « payée » à la main. Son état vient uniquement des
// paiements enregistrés par l'équipe ; chaque encaissement réel reçoit un reçu numéroté.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { logActivity, notifyUser, isTeam } from '../activity.js';
import { loadOrder } from './orders.js';

export const PAYMENT_METHODS = ['especes', 'mobile_money', 'virement', 'cheque', 'carte', 'autre'];
const fcfa = (n) => `${Math.round(Number(n)).toLocaleString('fr-FR')} FCFA`;

const PAYMENT_COLS = `p.id, p.order_id, p.amount_fcfa::float8 as amount_fcfa, p.method, p.reference, to_char(p.received_on, 'YYYY-MM-DD') as received_on,
  p.note, p.receipt_number, p.created_at, u.full_name as recorded_by_name`;

/** Insère un paiement (ou une correction négative). Le déclencheur met à jour la commande. */
export async function insertPayment(actor, orderId, { amount_fcfa: amount, method, reference = null, received_on: receivedOn = null, note = null }) {
  if (!Number.isInteger(amount) || amount === 0) throw new HttpError(400, 'Montant invalide.');
  if (amount < 0 && method !== 'correction') throw new HttpError(400, 'Un montant négatif n’est possible que pour une correction.');
  const o = await one(`select id, number, status, user_id, total_fcfa::float8 as total, amount_paid_fcfa::float8 as paid from orders where id = $1`, [orderId]);
  if (!o) throw new HttpError(404, 'Commande introuvable.');
  if (o.status === 'annulee' && amount > 0) throw new HttpError(409, 'Cette commande est annulée : aucun paiement ne peut y être enregistré.');
  if (o.status === 'en_attente' && amount > 0) throw new HttpError(409, 'Confirmez d’abord la commande du client : un paiement ne s’enregistre que sur une commande confirmée.');
  if (o.total > 0 && o.paid + amount > o.total) throw new HttpError(400, `Le montant encaissé (${o.paid + amount} FCFA) dépasse le total de la commande (${o.total} FCFA).`);
  if (o.paid + amount < 0) throw new HttpError(400, 'La correction rendrait le total encaissé négatif.');
  if (receivedOn && receivedOn > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'La date du paiement ne peut pas être dans le futur.');
  const receipt = amount > 0;
  const row = await one(
    `insert into payments (order_id, amount_fcfa, method, reference, received_on, note, receipt_number, recorded_by)
     values ($1, $2, $3, $4, coalesce($5::date, current_date), $6, case when $7 then next_number('REC') end, $8)
     returning id, receipt_number`,
    [orderId, amount, method, reference, receivedOn, note, receipt, actor.id],
  );
  await logActivity(actor, amount > 0 ? 'payment.recorded' : 'payment.corrected', 'order', orderId, { payment_id: row.id, amount, method, receipt: row.receipt_number });
  if (o.user_id && amount > 0) {
    await notifyUser(o.user_id, {
      kind: 'payment.recorded', category: 'orders', title: `Paiement de ${fcfa(amount)} reçu — commande ${o.number}`,
      body: `Reçu ${row.receipt_number} disponible dans Mes documents.`, link: '/espace?section=documents',
    });
  }
  return row;
}

export async function recordPayment(actor, orderId, input) {
  if (!isTeam(actor, 'orders')) throw new HttpError(403, 'Accès réservé à l’équipe « commandes ».');
  if (!PAYMENT_METHODS.includes(input.method) && input.method !== 'correction') throw new HttpError(400, 'Moyen de paiement inconnu.');
  await insertPayment(actor, orderId, input);
  return listPayments(actor, orderId);
}

export async function listPayments(actor, orderId) {
  const o = await loadOrder(actor, orderId);
  const payments = await query(`select ${PAYMENT_COLS} from payments p left join users u on u.id = p.recorded_by where p.order_id = $1 order by p.received_on, p.created_at`, [orderId]);
  const team = isTeam(actor, 'orders');
  return {
    total_fcfa: o.total_fcfa, paid_fcfa: o.amount_paid_fcfa, balance_fcfa: Math.max(o.total_fcfa - o.amount_paid_fcfa, 0), payment_status: o.payment_status,
    payments: team ? payments : payments.filter((p) => p.amount_fcfa > 0 || p.method === 'correction').map(({ recorded_by_name: _r, note: _n, ...p }) => p),
  };
}

/** Données d'un reçu, après contrôle d'accès (équipe « commandes » ou client de la commande). */
export async function receiptData(actor, paymentId) {
  const p = await one(
    `select p.id, p.order_id, p.method, p.reference, p.note, p.receipt_number, p.created_at, p.amount_fcfa::float8 as amount_fcfa, to_char(p.received_on, 'YYYY-MM-DD') as received_on,
            o.number as order_number, o.user_id, o.customer_name, o.customer_phone, o.customer_email, o.total_fcfa::float8 as order_total_fcfa,
            (select coalesce(sum(x.amount_fcfa), 0)::float8 from payments x where x.order_id = p.order_id
               and (x.received_on, x.created_at) <= (p.received_on, p.created_at)) as paid_to_date_fcfa,
            (select invoice_number from invoices i where i.order_id = p.order_id and i.snapshot is not null and i.cancelled_at is null) as invoice_number
       from payments p join orders o on o.id = p.order_id where p.id = $1`,
    [paymentId],
  );
  if (!p || (!isTeam(actor, 'orders') && (!actor.id || p.user_id !== actor.id))) throw new HttpError(404, 'Reçu introuvable.');
  if (!p.receipt_number) throw new HttpError(409, 'Ce mouvement n’a pas de reçu (saisie antérieure ou correction).');
  return p;
}

// --- Factures --------------------------------------------------------------------------
const INVOICE_COLS = `i.id, i.invoice_number, i.order_id, i.user_id, i.customer_name, i.total_fcfa::float8 as total_fcfa, i.status,
  to_char(i.due_date, 'YYYY-MM-DD') as due_date, i.issued_at, i.cancelled_at, i.cancel_reason, i.snapshot`;

/** Émet la facture d'une commande : copie figée des lignes et des montants au moment de l'émission. */
export async function issueInvoice(actor, orderId, { due_date: dueDate = null } = {}) {
  if (!isTeam(actor, 'orders')) throw new HttpError(403, 'Accès réservé à l’équipe « commandes ».');
  const o = await loadOrder(actor, orderId);
  if (o.status === 'annulee') throw new HttpError(409, 'Cette commande est annulée : elle ne peut pas être facturée.');
  if (o.status === 'en_attente') throw new HttpError(409, 'Confirmez d’abord la commande du client : elle ne peut pas encore être facturée.');
  const items = await query(
    `select label, description, quantity::float8 as quantity, unit, unit_price_fcfa::float8 as unit_price_fcfa, line_total_fcfa::float8 as line_total_fcfa
       from order_items where order_id = $1 order by sort, created_at`, [orderId]);
  if (!items.length) throw new HttpError(409, 'La commande n’a aucune ligne.');
  if (items.some((i) => i.unit_price_fcfa === null)) throw new HttpError(409, 'Fixez le prix de toutes les lignes avant de facturer.');
  if (!(o.total_fcfa > 0)) throw new HttpError(409, 'Le total de la commande est nul : rien à facturer.');
  const existing = await one(`select invoice_number from invoices where order_id = $1 and snapshot is not null and cancelled_at is null`, [orderId]);
  if (existing) throw new HttpError(409, `Cette commande a déjà la facture ${existing.invoice_number}. Annulez-la pour en émettre une nouvelle.`);
  const quote = o.quote_id ? await one('select customer_company from quotes where id = $1', [o.quote_id]) : null;
  const profile = o.user_id ? await one('select company_name, address, city from client_profiles where user_id = $1', [o.user_id]) : null;
  const snapshot = {
    order_number: o.number, quote_number: o.quote_number || null,
    customer: {
      name: o.customer_name, company: quote?.customer_company || profile?.company_name || null,
      address: [profile?.address, profile?.city].filter(Boolean).join(', ') || null, phone: o.customer_phone, email: o.customer_email,
    },
    items, subtotal_fcfa: o.subtotal_fcfa, discount_fcfa: o.discount_fcfa, total_fcfa: o.total_fcfa,
  };
  let row;
  try {
    row = await one(
      `insert into invoices (order_id, invoice_number, customer_name, amount, status, due_date, user_id, total_fcfa, snapshot, issued_at, created_by)
       values ($1, next_number('FAC'), $2, $3::numeric, 'Émise', $4, $5, $3::bigint, $6::jsonb, now(), $7) returning id, invoice_number`,
      [orderId, o.customer_name, o.total_fcfa, dueDate, o.user_id, JSON.stringify(snapshot), actor.id],
    );
  } catch (err) {
    if (/invoices_active_order_idx|duplicate key/.test(String(err.message))) throw new HttpError(409, 'Cette commande a déjà une facture.');
    throw err;
  }
  await logActivity(actor, 'invoice.issued', 'order', orderId, { invoice_id: row.id, number: row.invoice_number, total: o.total_fcfa });
  if (o.user_id) {
    await notifyUser(o.user_id, {
      kind: 'invoice.issued', category: 'orders', title: `Facture ${row.invoice_number} disponible`, body: `Commande ${o.number} — ${fcfa(o.total_fcfa)}.`,
      link: '/espace?section=documents', email: 'invoice_issued', vars: { numero: row.invoice_number, total: fcfa(o.total_fcfa) },
      details: [['Facture', row.invoice_number], ['Commande', o.number], ['Montant', fcfa(o.total_fcfa)], ['Déjà réglé', o.amount_paid_fcfa > 0 ? fcfa(o.amount_paid_fcfa) : null]],
      emailBody: '',
    });
  }
  return getInvoice(actor, row.id);
}

export async function cancelInvoice(actor, id, reason) {
  if (!isTeam(actor, 'orders')) throw new HttpError(403, 'Accès réservé à l’équipe « commandes ».');
  const row = await one(
    `update invoices set status = 'Annulée', cancelled_at = now(), cancel_reason = $2
      where id = $1 and snapshot is not null and cancelled_at is null returning id, order_id, invoice_number`,
    [id, reason],
  );
  if (!row) throw new HttpError(404, 'Facture introuvable ou déjà annulée.');
  await logActivity(actor, 'invoice.cancelled', 'order', row.order_id, { invoice_id: id, number: row.invoice_number, reason });
  return getInvoice(actor, id);
}

/** Facture avec son état de paiement, calculé à partir des paiements enregistrés. */
export async function getInvoice(actor, id) {
  const inv = await one(`select ${INVOICE_COLS}, o.user_id as order_user_id from invoices i left join orders o on o.id = i.order_id where i.id = $1 and i.snapshot is not null`, [id]);
  const owner = inv && actor.id && (inv.user_id === actor.id || inv.order_user_id === actor.id);
  if (!inv || (!isTeam(actor, 'orders') && !owner)) throw new HttpError(404, 'Facture introuvable.');
  const payments = await query(
    `select id, amount_fcfa::float8 as amount_fcfa, method, to_char(received_on, 'YYYY-MM-DD') as received_on, receipt_number
       from payments where order_id = $1 order by received_on, created_at`, [inv.order_id]);
  const paid = payments.reduce((a, p) => a + p.amount_fcfa, 0);
  const { order_user_id: _u, ...rest } = inv;
  return {
    ...rest, payments: payments.filter((p) => p.method !== 'correction' || isTeam(actor, 'orders')), paid_fcfa: paid,
    balance_fcfa: Math.max(inv.total_fcfa - paid, 0),
    payment_state: inv.cancelled_at ? 'annulee' : paid >= inv.total_fcfa ? 'acquittee' : paid > 0 ? 'partielle' : 'a_payer',
  };
}

export async function listInvoices(actor, { orderId = null, userId = null } = {}) {
  const team = isTeam(actor, 'orders');
  const where = ['i.snapshot is not null'];
  const params = [];
  if (!team) { params.push(actor.id); where.push(`(i.user_id = $${params.length} or o.user_id = $${params.length})`); } else if (userId) { params.push(userId); where.push(`i.user_id = $${params.length}`); }
  if (orderId) { params.push(orderId); where.push(`i.order_id = $${params.length}`); }
  const rows = await query(
    `select i.id, i.invoice_number, i.order_id, o.number as order_number, i.customer_name, i.total_fcfa::float8 as total_fcfa, i.status, i.issued_at, i.cancelled_at,
            (select coalesce(sum(amount_fcfa), 0)::float8 from payments p where p.order_id = i.order_id) as paid_fcfa
       from invoices i left join orders o on o.id = i.order_id where ${where.join(' and ')} order by i.issued_at desc limit 200`,
    params,
  );
  return rows.map((r) => ({ ...r, payment_state: r.cancelled_at ? 'annulee' : r.paid_fcfa >= r.total_fcfa ? 'acquittee' : r.paid_fcfa > 0 ? 'partielle' : 'a_payer' }));
}

/** Reçus d'un client (pour « Mes documents »). */
export async function receiptsOf(userId) {
  return query(
    `select p.id, p.receipt_number, p.amount_fcfa::float8 as amount_fcfa, p.method, to_char(p.received_on, 'YYYY-MM-DD') as received_on, o.number as order_number
       from payments p join orders o on o.id = p.order_id
      where o.user_id = $1 and p.receipt_number is not null order by p.received_on desc, p.created_at desc limit 200`,
    [userId],
  );
}
