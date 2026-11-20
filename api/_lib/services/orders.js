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
  o.client_note, to_char(o.wanted_on, 'YYYY-MM-DD') as wanted_on, o.confirmed_at, o.origin,
  (select number from quotes where id = o.quote_id) as quote_number`;
const ADMIN_COLS = `${ORDER_COLS}, o.admin_note, o.assigned_to, (select full_name from users where id = o.assigned_to) as assigned_name`;

export const TRANSITIONS = {
  en_attente: ['confirmee', 'annulee'],
  confirmee: ['en_production', 'annulee'],
  en_production: ['terminee', 'annulee'],
  terminee: ['livree', 'en_production'],
  livree: [],
  annulee: [],
};
export const STATUS_LABELS = {
  en_attente: 'En attente de confirmation', confirmee: 'Confirmée', en_production: 'En production', terminee: 'Terminée (prête)', livree: 'Livrée', annulee: 'Annulée',
};
/** Lignes et prix modifiables jusqu'à la fin de la production. */
const EDITABLE = ['en_attente', 'confirmee', 'en_production'];

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

/**
 * Commande passée par le client depuis son espace. Elle arrive « en attente » :
 * l'atelier la confirme (en fixant prix et date) ou la refuse. Les prix ne viennent jamais du navigateur.
 */
export async function createClientOrder(actor, input) {
  if (!actor?.id) throw new HttpError(401, 'Connectez-vous pour passer commande.');
  const items = (await prepareItems(input.items)).map((it) => ({ ...it, unit_price_fcfa: null }));
  const u = await one('select full_name, email, phone from users where id = $1 and disabled_at is null', [actor.id]);
  if (!u) throw new HttpError(403, 'Compte indisponible.');
  const pending = await one(`select count(*)::int as n from orders where user_id = $1 and status = 'en_attente'`, [actor.id]);
  if (pending.n >= 10) throw new HttpError(429, 'Vous avez déjà 10 commandes en attente de confirmation. Attendez la réponse de l’atelier ou écrivez-nous sur WhatsApp.');
  const row = await one(
    `with o as (
       insert into orders (user_id, customer_name, customer_phone, customer_email, status, origin, client_note, wanted_on)
       values ($1, $3, $4, $5, 'en_attente', 'client', $6, $7) returning id, number
     ), i as (
       insert into order_items (order_id, service_slug, label, description, quantity, unit, unit_price_fcfa, sort)
       select o.id, x.service_slug, x.label, x.description, x.quantity, x.unit, x.unit_price_fcfa, x.sort
         from o, ${ITEMS_RECORDSET}
       returning id
     )
     select o.id, o.number, (select count(*) from i)::int as items from o`,
    [actor.id, JSON.stringify(items), u.full_name, input.phone || u.phone, u.email, input.client_note, input.wanted_on],
  );
  if (input.phone && input.phone !== u.phone) await query('update users set phone = $2 where id = $1 and phone is null returning id', [actor.id, input.phone]);
  await logActivity(actor, 'order.created', 'order', row.id, { number: row.number, items: row.items, by_client: true });
  const labels = items.map((i) => i.label).join(', ');
  const link = `/espace?commande=${row.id}`;
  await notifyUser(actor.id, {
    kind: 'order.received', title: `Commande ${row.number} envoyée`, body: 'L’atelier la vérifie et vous confirme le prix et la date.', link,
    email: 'order_received', vars: { numero: row.number },
    details: [['Commande', row.number], ['Prestations', labels], ['Date souhaitée', longDate(input.wanted_on)]], emailBody: '',
  });
  await notifyTeam('orders', {
    kind: 'order.new', title: `Commande ${row.number} à confirmer`, body: `${u.full_name} — ${labels}`, link, event: 'order_new',
    details: [['Client', u.full_name], ['Téléphone', input.phone || u.phone], ['Prestations', labels], ['Date souhaitée', longDate(input.wanted_on)]],
  });
  return row;
}

/** Le client peut annuler sa commande tant que l'atelier ne l'a pas confirmée. */
export async function cancelByClient(actor, id) {
  const o = await loadOrder(actor, id);
  if (o.user_id !== actor.id) throw new HttpError(404, 'Commande introuvable.');
  if (o.status !== 'en_attente') throw new HttpError(409, 'Cette commande est déjà confirmée par l’atelier : écrivez-nous pour la modifier ou l’annuler.');
  await query(`update orders set status = 'annulee', cancelled_at = now() where id = $1 and status = 'en_attente' returning id`, [id]);
  await logActivity(actor, 'order.status_changed', 'order', id, { from: 'en_attente', to: 'annulee', by_client: true });
  await notifyTeam('orders', { kind: 'order.cancelled', title: `Commande ${o.number} annulée par le client`, body: o.customer_name, link: `/espace?commande=${id}` });
  return getOrder(actor, id);
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
  return { ...o, items, files, history, allowed: admin ? TRANSITIONS[o.status] : [], can_cancel: !admin && o.status === 'en_attente' };
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
    if (o.status === 'en_attente' && patch.status === 'confirmee') sets.push('confirmed_at = now()');
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
      const confirmed = o.status === 'en_attente' && patch.status === 'confirmee';
      const refused = o.status === 'en_attente' && patch.status === 'annulee';
      if (confirmed || refused) {
        const now = await one('select total_fcfa::float8 as total, to_char(due_on, \'YYYY-MM-DD\') as due_on from orders where id = $1', [id]);
        await notifyUser(o.user_id, confirmed ? {
          kind: 'order.confirmee', title: `Commande ${o.number} confirmée`, body: 'L’atelier a accepté votre commande. Suivez son avancement ici.', link: `/espace?commande=${id}`,
          email: 'order_confirmed', vars: { numero: o.number, total: now.total > 0 ? fcfa(now.total) : 'à préciser', date_prevue: longDate(now.due_on) || 'à préciser' },
          details: [['Commande', o.number], ['Montant', now.total > 0 ? fcfa(now.total) : null], ['Date prévue', longDate(now.due_on)]], emailBody: '',
        } : {
          kind: 'order.annulee', title: `Commande ${o.number} non acceptée`, body: patch.admin_note ? null : 'Écrivez-nous pour en savoir plus ou trouver une autre solution.', link: `/espace?commande=${id}`,
          email: 'order_update', vars: { numero: o.number, statut: 'non acceptée' },
          details: [['Commande', o.number], ['Statut', 'Non acceptée']], emailBody: '',
        });
      } else await notifyUser(o.user_id, {
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
