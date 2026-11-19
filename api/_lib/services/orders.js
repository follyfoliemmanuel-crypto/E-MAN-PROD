// Règles métier des commandes.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { logActivity, historyOf, notifyUser, notifyTeam, isTeam } from '../activity.js';
import { ITEM_COLS } from './quotes.js';
import { filesOf } from './files.js';

const ORDER_COLS = `o.id, o.number, o.quote_id, o.user_id, o.customer_name, o.customer_phone, o.customer_email,
  o.status, o.payment_status, o.amount_paid_fcfa::float8 as amount_paid_fcfa, o.subtotal_fcfa::float8 as subtotal_fcfa,
  o.discount_fcfa::float8 as discount_fcfa, o.total_fcfa::float8 as total_fcfa, to_char(o.due_on, 'YYYY-MM-DD') as due_on,
  o.delivered_at, o.cancelled_at, o.created_at, o.updated_at,
  (select number from quotes where id = o.quote_id) as quote_number`;
const ADMIN_COLS = `${ORDER_COLS}, o.admin_note, o.assigned_to, (select full_name from users where id = o.assigned_to) as assigned_name`;

export const TRANSITIONS = {
  confirmee: ['en_production', 'annulee'],
  en_production: ['terminee', 'annulee'],
  terminee: ['livree', 'en_production'],
  livree: [],
  annulee: [],
};
export const STATUS_LABELS = {
  confirmee: 'Confirmée', en_production: 'En production', terminee: 'Terminée (prête)', livree: 'Livrée', annulee: 'Annulée',
};
/** Lignes et prix modifiables jusqu'à la fin de la production. */
const EDITABLE = ['confirmee', 'en_production'];

const ITEMS_RECORDSET = `jsonb_to_recordset($2::jsonb) as x(service_slug text, label text, description text,
  quantity numeric, unit text, unit_price_fcfa bigint, sort int)`;

async function prepareItems(items) {
  if (!items.length) throw new HttpError(400, 'Une commande contient au moins une ligne.');
  const slugs = [...new Set(items.map((i) => i.service_slug).filter(Boolean))];
  const services = slugs.length ? await query('select slug, title from services where slug = any($1::text[])', [`{${slugs.join(',')}}`]) : [];
  const bySlug = Object.fromEntries(services.map((s) => [s.slug, s.title]));
  return items.map((it, i) => {
    if (it.service_slug && !bySlug[it.service_slug]) throw new HttpError(400, `Prestation inconnue : ${it.service_slug}.`);
    const label = it.label || bySlug[it.service_slug];
    if (!label) throw new HttpError(400, `Ligne ${i + 1} : choisissez une prestation ou donnez un intitulé.`);
    return { service_slug: it.service_slug || null, label, description: it.description ?? null, quantity: it.quantity ?? 1, unit: it.unit ?? null, unit_price_fcfa: it.unit_price_fcfa ?? null, sort: i };
  });
}

/** Paiement : le statut se déduit du montant encaissé quand il est connu. */
function paymentFrom(amountPaid, total) {
  if (!amountPaid) return 'non_paye';
  return total > 0 && amountPaid >= total ? 'paye' : 'acompte';
}

/** Commande directe, sans devis (client venu à l'atelier, commande par téléphone). Admin. */
export async function createOrder(actor, input) {
  const items = await prepareItems(input.items);
  if (input.user_id && !(await one('select id from users where id = $1', [input.user_id]))) throw new HttpError(404, 'Client introuvable.');
  const row = await one(
    `with o as (
       insert into orders (user_id, customer_name, customer_phone, customer_email, due_on, admin_note)
       values ($1, $3, $4, $5, $6, $7) returning id, number
     ), i as (
       insert into order_items (order_id, service_slug, label, description, quantity, unit, unit_price_fcfa, sort)
       select o.id, x.service_slug, x.label, x.description, x.quantity, x.unit, x.unit_price_fcfa, x.sort
         from o, ${ITEMS_RECORDSET}
       returning id
     )
     select o.id, o.number, (select count(*) from i)::int as items from o`,
    [input.user_id, JSON.stringify(items), input.name, input.phone, input.email, input.due_on, input.admin_note],
  );
  await logActivity(actor, 'order.created', 'order', row.id, { number: row.number, items: row.items, direct: true });
  await announceOrder(actor, row.id);
  return row;
}

const fcfa = (n) => `${Number(n).toLocaleString('fr-FR')} FCFA`;
const longDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null);

/** Nouvelle commande : confirmation au client, alerte à l'équipe « commandes ». */
export async function announceOrder(actor, id) {
  const o = await one(`select id, number, user_id, customer_name, total_fcfa::float8 as total, due_on::text as due_on,
    (select string_agg(label, ', ' order by sort) from order_items where order_id = o.id) as labels from orders o where id = $1`, [id]);
  const link = `/espace?commande=${id}`;
  if (o.user_id) {
    await notifyUser(o.user_id, {
      kind: 'order.created', title: `Commande ${o.number} confirmée`, body: o.labels, link,
      email: 'order_confirmed', vars: { numero: o.number, total: fcfa(o.total), date_prevue: longDate(o.due_on) },
      details: [['Commande', o.number], ['Prestations', o.labels], ['Montant', o.total > 0 ? fcfa(o.total) : null], ['Date prévue', longDate(o.due_on)]], emailBody: '',
    });
  }
  await notifyTeam('orders', {
    kind: 'order.new', title: `Nouvelle commande ${o.number}`, body: `${o.customer_name} — ${o.labels || ''}`, link, event: 'order_new', exclude: actor?.id,
    details: [['Client', o.customer_name], ['Prestations', o.labels], ['Montant', fcfa(o.total)]],
  });
}

export async function listOrders(actor, { status = null, search = null, userId = null, assigned = null, limit = 200 } = {}) {
  const admin = isTeam(actor, 'orders');
  const where = [];
  const params = [];
  if (!admin) {
    params.push(actor.id);
    where.push(`o.user_id = $${params.length}`);
  } else if (userId) {
    params.push(userId);
    where.push(`o.user_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`o.status = $${params.length}`);
  }
  if (assigned && admin) {
    params.push(assigned === 'me' ? actor.id : assigned);
    where.push(`o.assigned_to = $${params.length}`);
  }
  if (search && admin) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`lower(o.number || ' ' || o.customer_name || ' ' || o.customer_phone) like $${params.length}`);
  }
  params.push(limit);
  return query(
    `select ${admin ? ADMIN_COLS : ORDER_COLS},
            (select string_agg(label, ', ' order by sort) from order_items where order_id = o.id) as summary
       from orders o ${where.length ? 'where ' + where.join(' and ') : ''}
      order by o.created_at desc limit $${params.length}`,
    params,
  );
}

export async function loadOrder(actor, id) {
  const o = await one(`select ${ADMIN_COLS} from orders o where o.id = $1`, [id]);
  if (!o || (!isTeam(actor, 'orders') && (!actor.id || o.user_id !== actor.id))) throw new HttpError(404, 'Commande introuvable.');
  return o;
}

export async function getOrder(actor, id) {
  const o = await loadOrder(actor, id);
  const admin = isTeam(actor, 'orders');
  if (!admin) { delete o.admin_note; delete o.assigned_to; delete o.assigned_name; }
  const [items, files, history] = await Promise.all([
    query(`select ${ITEM_COLS} from order_items where order_id = $1 order by sort, created_at`, [id]),
    filesOf('order', id),
    historyOf('order', id, { forClient: !admin }),
  ]);
  return { ...o, items, files, history, allowed: admin ? TRANSITIONS[o.status] : [] };
}

/** Mise à jour par l'administration. Chaque modification est inscrite dans l'historique. */
export async function updateOrder(actor, id, patch) {
  const o = await loadOrder(actor, id);
  const changes = {};

  if ('status' in patch && patch.status !== o.status) {
    if (!TRANSITIONS[o.status].includes(patch.status)) {
      throw new HttpError(409, `Impossible de passer de « ${STATUS_LABELS[o.status]} » à « ${STATUS_LABELS[patch.status]} ».`);
    }
  }
  if (('items' in patch || 'discount_fcfa' in patch) && !EDITABLE.includes(o.status)) {
    throw new HttpError(409, `La commande est « ${STATUS_LABELS[o.status]} » : ses lignes et ses prix ne peuvent plus être modifiés.`);
  }
  if (['livree', 'annulee'].includes(o.status) && Object.keys(patch).some((k) => !['admin_note', 'amount_paid_fcfa', 'payment_status'].includes(k))) {
    throw new HttpError(409, `La commande est « ${STATUS_LABELS[o.status]} » : seuls le paiement et la note peuvent encore changer.`);
  }

  if ('items' in patch) {
    const items = await prepareItems(patch.items);
    await query(
      `with d as (delete from order_items where order_id = $1 returning id)
       insert into order_items (order_id, service_slug, label, description, quantity, unit, unit_price_fcfa, sort)
       select $1, x.service_slug, x.label, x.description, x.quantity, x.unit, x.unit_price_fcfa, x.sort from ${ITEMS_RECORDSET}
       returning id`,
      [id, JSON.stringify(items)],
    );
    changes.items = items.length;
  }

  const sets = [];
  const params = [id];
  const set = (col, value) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  for (const key of ['due_on', 'admin_note']) if (key in patch) set(key, patch[key]);
  if ('assigned_to' in patch && patch.assigned_to !== o.assigned_to) {
    if (patch.assigned_to) {
      // Seul un membre de l'équipe qui a accès aux commandes peut en être chargé.
      const member = await one(
        `select id, full_name from users where id = $1 and disabled_at is null and (role = 'admin' or (role = 'staff' and 'orders' = any(permissions)))`,
        [patch.assigned_to],
      );
      if (!member) throw new HttpError(400, 'Ce collaborateur n’a pas accès aux commandes.');
      await notifyUser(member.id, { kind: 'order.assigned', title: `Commande ${o.number} vous est confiée`, link: `/espace?commande=${id}` });
    }
    set('assigned_to', patch.assigned_to);
    changes.assigned = { from: o.assigned_to, to: patch.assigned_to };
  }
  if ('discount_fcfa' in patch) set('discount_fcfa', patch.discount_fcfa ?? 0);
  if ('status' in patch && patch.status !== o.status) {
    set('status', patch.status);
    if (patch.status === 'livree') sets.push('delivered_at = now()');
    if (patch.status === 'annulee') sets.push('cancelled_at = now()');
    changes.status = { from: o.status, to: patch.status };
  }
  if (sets.length) await query(`update orders set ${sets.join(', ')} where id = $1 returning id`, params);

  // Paiement, calculé après une éventuelle modification des lignes. Depuis la v2.8, chaque
  // encaissement est un paiement enregistré (avec reçu) ; le champ « montant encaissé » de
  // l'ancien écran ajoute la différence comme paiement, ou comme correction si elle est négative.
  if ('amount_paid_fcfa' in patch) {
    const delta = (patch.amount_paid_fcfa ?? 0) - o.amount_paid_fcfa;
    if (delta !== 0) {
      const { insertPayment } = await import('./billing.js');
      await insertPayment(actor, id, { amount_fcfa: delta, method: delta > 0 ? 'autre' : 'correction', note: 'Saisi depuis la fiche de la commande.' });
      const now = await one('select payment_status, amount_paid_fcfa::float8 as paid from orders where id = $1', [id]);
      changes.payment = { from: o.payment_status, to: now.payment_status, amount_paid_fcfa: now.paid };
    }
  } else if ('payment_status' in patch && patch.payment_status !== o.payment_status) {
    // Anciennes commandes sans montant noté : statut choisi à la main, sans reçu.
    if (o.amount_paid_fcfa > 0) throw new HttpError(409, 'Des paiements sont enregistrés : le statut de paiement en découle.');
    await query('update orders set payment_status = $2 where id = $1 returning id', [id, patch.payment_status]);
    changes.payment = { from: o.payment_status, to: patch.payment_status, amount_paid_fcfa: 0 };
  }
  // Total modifié : le statut de paiement suit les paiements déjà enregistrés.
  await query(`update orders set payment_status = case when amount_paid_fcfa = 0 then payment_status when total_fcfa > 0 and amount_paid_fcfa >= total_fcfa then 'paye' else 'acompte' end
                where id = $1 and amount_paid_fcfa > 0 returning id`, [id]);

  const after = await one('select total_fcfa::float8 as total_fcfa from orders where id = $1', [id]);
  if (after.total_fcfa !== o.total_fcfa) changes.total = { from: o.total_fcfa, to: after.total_fcfa };
  if ('due_on' in patch && patch.due_on !== o.due_on) changes.due_on = { from: o.due_on, to: patch.due_on };
  if ('admin_note' in patch) changes.note = true;

  if (changes.status) {
    await logActivity(actor, 'order.status_changed', 'order', id, changes.status);
    if (o.user_id) {
      const ready = patch.status === 'terminee';
      await notifyUser(o.user_id, {
        kind: `order.${patch.status}`,
        title: ready ? `Commande ${o.number} prête` : `Commande ${o.number} : ${STATUS_LABELS[patch.status].toLowerCase()}`,
        body: ready ? 'Contactez-nous pour convenir du retrait ou de la livraison.' : null,
        link: `/espace?commande=${id}`,
        email: ready ? 'order_ready' : 'order_update',
        vars: { numero: o.number, statut: STATUS_LABELS[patch.status] },
        details: [['Commande', o.number], ['Statut', STATUS_LABELS[patch.status]], ['Date prévue', ready ? null : longDate(patch.due_on ?? o.due_on)]],
        emailBody: '',
      });
    }
  }
  const { status: _s, ...rest } = changes;
  if (Object.keys(rest).length) await logActivity(actor, 'order.updated', 'order', id, rest);
  return getOrder(actor, id);
}

/** Commentaire interne (visible de l'équipe seulement, jamais du client). */
export async function addComment(actor, id, text) {
  const o = await loadOrder(actor, id);
  await logActivity(actor, 'order.comment', 'order', id, { text });
  if (o.assigned_to && o.assigned_to !== actor.id) {
    await notifyUser(o.assigned_to, { kind: 'order.comment', title: `Nouveau commentaire sur la commande ${o.number}`, body: text.slice(0, 140), link: `/espace?commande=${id}` });
  }
  return getOrder(actor, id);
}

/** Collaborateurs à qui une commande peut être confiée. */
export async function assignableMembers() {
  return query(`select id, full_name, role from users where disabled_at is null and (role = 'admin' or (role = 'staff' and 'orders' = any(permissions))) order by full_name`);
}
