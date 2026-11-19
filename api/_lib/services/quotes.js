// Règles métier des devis. Toutes les vérifications de droits sont faites ici,
// côté serveur : les routes /api ne font que valider l'entrée et appeler ces fonctions.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { logActivity, historyOf, notifyUser, notifyTeam, emailGuest, isTeam } from '../activity.js';
import { quoteValidityDays } from '../settings.js';
import { filesOf } from './files.js';

// Montants et quantités convertis en nombres JS (bigint/numeric arrivent en texte).
export const QUOTE_COLS = `q.id, q.number, q.user_id, q.customer_name, q.customer_phone, q.customer_email, q.customer_company,
  q.message, q.status, q.source, q.subtotal_fcfa::float8 as subtotal_fcfa, q.discount_fcfa::float8 as discount_fcfa,
  q.total_fcfa::float8 as total_fcfa, to_char(q.valid_until, 'YYYY-MM-DD') as valid_until, q.sent_at, q.decided_at,
  q.cancelled_at, q.created_at, q.updated_at`;
const ADMIN_COLS = `${QUOTE_COLS}, q.admin_note`;
export const ITEM_COLS = `id, service_slug, label, description, quantity::float8 as quantity, unit,
  unit_price_fcfa::float8 as unit_price_fcfa, line_total_fcfa::float8 as line_total_fcfa, sort`;

/** Modifiable (lignes, prix, remise) tant que le devis n'est pas envoyé. */
export const EDITABLE = ['nouveau', 'en_etude'];

/** Changements de statut autorisés, selon qui agit. */
export const TRANSITIONS = {
  admin: {
    nouveau: ['en_etude', 'envoye', 'annule'],
    en_etude: ['envoye', 'annule'],
    envoye: ['en_etude', 'accepte', 'refuse', 'expire', 'annule'],
    accepte: ['annule'],
    refuse: ['en_etude'],
    expire: ['en_etude'],
    annule: [],
  },
  client: {
    nouveau: ['annule'],
    en_etude: ['annule'],
    envoye: ['accepte', 'refuse'],
  },
};

export const STATUS_LABELS = {
  nouveau: 'Nouvelle demande', en_etude: 'En étude', envoye: 'Devis envoyé', accepte: 'Accepté',
  refuse: 'Refusé', expire: 'Expiré', annule: 'Annulé',
};

const ITEMS_RECORDSET = `jsonb_to_recordset($ITEMS::jsonb) as x(service_slug text, label text, description text,
  quantity numeric, unit text, unit_price_fcfa bigint, sort int)`;

/** Complète et vérifie les lignes : prestation existante, intitulé par défaut. */
async function prepareItems(items, { allowPrices }) {
  if (!items.length) throw new HttpError(400, 'Ajoutez au moins une prestation.');
  const services = await query('select slug, title from services where published');
  const bySlug = Object.fromEntries(services.map((s) => [s.slug, s.title]));
  const byTitle = Object.fromEntries(services.map((s) => [s.title.toLowerCase(), s.slug]));
  return items.map((it, i) => {
    // Formulaire du site : la prestation arrive par son nom ; on la relie au catalogue.
    if (!it.service_slug && it.label && byTitle[it.label.toLowerCase()]) it = { ...it, service_slug: byTitle[it.label.toLowerCase()] };
    if (it.service_slug && !bySlug[it.service_slug]) throw new HttpError(400, `Prestation inconnue : ${it.service_slug}.`);
    const label = it.label || bySlug[it.service_slug];
    if (!label) throw new HttpError(400, `Ligne ${i + 1} : choisissez une prestation ou donnez un intitulé.`);
    return {
      service_slug: it.service_slug || null,
      label,
      description: it.description ?? null,
      quantity: it.quantity ?? 1,
      unit: it.unit ?? null,
      // Un visiteur ne fixe jamais lui-même le prix.
      unit_price_fcfa: allowPrices ? it.unit_price_fcfa ?? null : null,
      sort: i,
    };
  });
}

/**
 * Enregistre une demande de devis (visiteur, client connecté ou admin).
 * @param {{id: string|null, role: string}} actor
 */
export async function createQuote(actor, input) {
  const admin = isTeam(actor, 'quotes');
  const items = await prepareItems(input.items, { allowPrices: admin });
  // Un admin peut créer un devis pour un client existant (demande reçue par téléphone…).
  let userId = actor.role === 'client' ? actor.id : null;
  if (admin && input.user_id) {
    if (!(await one('select id from users where id = $1', [input.user_id]))) throw new HttpError(404, 'Client introuvable.');
    userId = input.user_id;
  }
  const source = admin ? input.source || 'admin' : 'site';
  const row = await one(
    `with q as (
       insert into quotes (user_id, customer_name, customer_phone, customer_email, customer_company, message, source)
       values ($1, $2, $3, $4, $5, $6, $7) returning id, number
     ), i as (
       insert into quote_items (quote_id, service_slug, label, description, quantity, unit, unit_price_fcfa, sort)
       select q.id, x.service_slug, x.label, x.description, x.quantity, x.unit, x.unit_price_fcfa, x.sort
         from q, ${ITEMS_RECORDSET.replace('$ITEMS', '$8')}
       returning id
     )
     select q.id, q.number, (select count(*) from i)::int as items from q`,
    [userId, input.name, input.phone, input.email, input.company, input.message, source, JSON.stringify(items)],
  );
  await logActivity(actor, 'quote.created', 'quote', row.id, { number: row.number, source, items: items.length });
  const labels = items.map((i) => (i.quantity && Number(i.quantity) !== 1 ? `${i.label} × ${Number(i.quantity).toLocaleString('fr-FR')}` : i.label)).join(', ');
  if (!admin) {
    await notifyTeam('quotes', {
      kind: 'quote.new', title: `Nouvelle demande ${row.number}`, body: `${input.name} — ${labels}`, link: `/espace?devis=${row.id}`, event: 'quote_new',
      details: [['Client', input.company ? `${input.name} (${input.company})` : input.name], ['Téléphone', input.phone], ['E-mail', input.email], ['Prestations', labels]],
    });
    // Accusé de réception au client : dans son espace et par e-mail (ou par e-mail seul sans compte).
    const receipt = { vars: { numero: row.number, prestations: labels }, details: [['Numéro', row.number], ['Prestations', labels]] };
    if (userId) {
      await notifyUser(userId, { kind: 'quote.received', title: `Demande ${row.number} reçue`, body: 'L’atelier l’étudie et vous envoie un devis chiffré ici.', link: `/espace?devis=${row.id}`, email: 'quote_received', ...receipt });
    } else if (input.email) {
      await emailGuest(input.email, 'quote_received', { name: input.name, ...receipt, body: 'Créez votre espace client avec cette adresse e-mail pour suivre votre demande en ligne.', link: '/espace' });
    }
  }
  return { id: row.id, number: row.number, items, userId };
}

/** Passe en « expiré » les devis envoyés dont la date de validité est dépassée. */
async function expireOverdue() {
  const rows = await query(
    `update quotes set status = 'expire' where status = 'envoye' and valid_until < current_date returning id`,
  );
  for (const r of rows) await logActivity({ id: null, role: 'system' }, 'quote.status_changed', 'quote', r.id, { from: 'envoye', to: 'expire' });
}

export async function listQuotes(actor, { status = null, search = null, userId = null, limit = 200 } = {}) {
  await expireOverdue();
  const admin = isTeam(actor, 'quotes');
  const where = [];
  const params = [];
  if (!admin) {
    params.push(actor.id);
    where.push(`q.user_id = $${params.length}`);
  } else if (userId) {
    params.push(userId);
    where.push(`q.user_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`q.status = $${params.length}`);
  }
  if (search && admin) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`lower(q.number || ' ' || q.customer_name || ' ' || q.customer_phone || ' ' || coalesce(q.customer_email, '')) like $${params.length}`);
  }
  params.push(limit);
  return query(
    `select ${admin ? ADMIN_COLS : QUOTE_COLS},
            (select string_agg(label, ', ' order by sort) from quote_items where quote_id = q.id) as summary,
            (select count(*)::int from quote_items where quote_id = q.id and unit_price_fcfa is null) as unpriced,
            (select o.number from orders o where o.quote_id = q.id) as order_number
       from quotes q ${where.length ? 'where ' + where.join(' and ') : ''}
      order by q.created_at desc limit $${params.length}`,
    params,
  );
}

/** Charge un devis et vérifie que la personne a le droit de le voir. */
export async function loadQuote(actor, id) {
  const q = await one(`select ${ADMIN_COLS} from quotes q where q.id = $1`, [id]);
  // Même réponse « introuvable » si le devis existe mais appartient à quelqu'un d'autre.
  if (!q || (!isTeam(actor, 'quotes') && (!actor.id || q.user_id !== actor.id))) throw new HttpError(404, 'Devis introuvable.');
  return q;
}

export async function getQuote(actor, id) {
  await expireOverdue();
  const q = await loadQuote(actor, id);
  const admin = isTeam(actor, 'quotes');
  if (!admin) delete q.admin_note;
  const [items, files, order, history] = await Promise.all([
    query(`select ${ITEM_COLS} from quote_items where quote_id = $1 order by sort, created_at`, [id]),
    filesOf('quote', id),
    one('select id, number, status from orders where quote_id = $1', [id]),
    historyOf('quote', id, { forClient: !admin }),
  ]);
  return { ...q, items, files, order, history, allowed: allowedTransitions(actor, q) };
}

export function allowedTransitions(actor, q) {
  const table = isTeam(actor, 'quotes') ? TRANSITIONS.admin : TRANSITIONS.client;
  return table[q.status] || [];
}

/** Modification par l'administration : lignes, prix, remise, validité, client associé, note. */
export async function updateQuote(actor, id, patch) {
  const q = await loadQuote(actor, id);
  const touchesContent = 'items' in patch || 'discount_fcfa' in patch;
  if (touchesContent && !EDITABLE.includes(q.status)) {
    throw new HttpError(409, `Le devis est « ${STATUS_LABELS[q.status]} » : repassez-le « En étude » pour modifier les lignes ou les prix.`);
  }
  const before = { total_fcfa: q.total_fcfa };
  if ('items' in patch) {
    const items = await prepareItems(patch.items, { allowPrices: true });
    // Remplacement des lignes en une seule requête (donc atomique).
    await query(
      `with d as (delete from quote_items where quote_id = $1 returning id)
       insert into quote_items (quote_id, service_slug, label, description, quantity, unit, unit_price_fcfa, sort)
       select $1, x.service_slug, x.label, x.description, x.quantity, x.unit, x.unit_price_fcfa, x.sort
         from ${ITEMS_RECORDSET.replace('$ITEMS', '$2')}
       returning id`,
      [id, JSON.stringify(items)],
    );
  }
  if ('user_id' in patch && patch.user_id && !(await one('select id from users where id = $1', [patch.user_id]))) {
    throw new HttpError(404, 'Client introuvable.');
  }
  if ('valid_until' in patch && patch.valid_until && patch.valid_until < today()) {
    throw new HttpError(400, 'La date de validité est déjà passée.');
  }
  const cols = {
    discount_fcfa: 'discount_fcfa', valid_until: 'valid_until', admin_note: 'admin_note', user_id: 'user_id',
    name: 'customer_name', phone: 'customer_phone', email: 'customer_email', company: 'customer_company',
  };
  const sets = [];
  const params = [id];
  for (const [key, col] of Object.entries(cols)) {
    if (!(key in patch)) continue;
    params.push(key === 'discount_fcfa' ? patch[key] ?? 0 : patch[key]);
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length) await query(`update quotes set ${sets.join(', ')} where id = $1 returning id`, params);
  const after = await one('select total_fcfa::float8 as total_fcfa from quotes where id = $1', [id]);
  const changed = Object.keys(patch).filter((k) => k !== 'id');
  await logActivity(actor, 'quote.updated', 'quote', id, {
    fields: changed,
    ...(before.total_fcfa !== after.total_fcfa ? { total_before: before.total_fcfa, total_after: after.total_fcfa } : {}),
  });
  return getQuote(actor, id);
}

const today = () => new Date().toISOString().slice(0, 10);

/** Change le statut d'un devis, en appliquant les règles de passage. */
export async function changeQuoteStatus(actor, id, to, { reason = null } = {}) {
  await expireOverdue();
  const q = await loadQuote(actor, id);
  const allowed = allowedTransitions(actor, q);
  if (!allowed.includes(to)) {
    throw new HttpError(409, `Impossible de passer de « ${STATUS_LABELS[q.status]} » à « ${STATUS_LABELS[to] || to} ».`);
  }
  const extra = [];
  if (to === 'envoye') {
    const [{ n, unpriced }] = await query(
      'select count(*)::int as n, count(*) filter (where unit_price_fcfa is null)::int as unpriced from quote_items where quote_id = $1',
      [id],
    );
    if (!n) throw new HttpError(409, 'Ajoutez au moins une ligne avant d’envoyer le devis.');
    if (unpriced) throw new HttpError(409, `Fixez le prix de toutes les lignes avant d’envoyer le devis (${unpriced} sans prix).`);
    extra.push('sent_at = now()', `valid_until = coalesce(valid_until, current_date + ${await quoteValidityDays()})`);
  }
  if (to === 'accepte' || to === 'refuse') extra.push('decided_at = now()');
  if (to === 'annule') {
    const order = await one(`select number from orders where quote_id = $1 and status <> 'annulee'`, [id]);
    if (order) throw new HttpError(409, `Ce devis a donné la commande ${order.number} : annulez d’abord la commande.`);
    extra.push('cancelled_at = now()');
  }
  if (to === 'en_etude') extra.push('decided_at = null', 'cancelled_at = null');
  // La condition sur l'ancien statut évite que deux personnes changent le statut en même temps.
  const row = await one(
    `update quotes set status = $3${extra.length ? ', ' + extra.join(', ') : ''}
      where id = $1 and status = $2 returning id`,
    [id, q.status, to],
  );
  if (!row) throw new HttpError(409, 'Le devis vient d’être modifié par quelqu’un d’autre. Rechargez la page.');
  await logActivity(actor, 'quote.status_changed', 'quote', id, { from: q.status, to, ...(reason ? { reason } : {}) });

  const link = `/espace?devis=${id}`;
  if (isTeam(actor, 'quotes') && q.user_id && ['envoye', 'expire', 'annule', 'accepte', 'refuse'].includes(to)) {
    if (to === 'envoye') {
      const fresh = await one(`select total_fcfa::float8 as total, valid_until::text as valid_until from quotes where id = $1`, [id]);
      const total = `${Number(fresh.total).toLocaleString('fr-FR')} FCFA`;
      const until = fresh.valid_until ? new Date(fresh.valid_until + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
      await notifyUser(q.user_id, {
        kind: 'quote.envoye', title: `Votre devis ${q.number} est disponible`, body: `Montant : ${total}. Téléchargez-le en PDF, puis acceptez-le ou refusez-le en ligne.`, link,
        email: 'quote_sent', vars: { numero: q.number, total, validite: until }, details: [['Devis', q.number], ['Montant total', total], ['Valable jusqu’au', until]], emailBody: '',
      });
    } else {
      // Décision notée par l'atelier (devis accepté par téléphone, refus…), expiration, annulation.
      const titles = { expire: `Votre devis ${q.number} a expiré`, annule: `Votre devis ${q.number} a été annulé`, accepte: `Devis ${q.number} accepté`, refuse: `Devis ${q.number} refusé` };
      await notifyUser(q.user_id, {
        kind: `quote.${to}`, title: titles[to], link,
        ...(['accepte', 'refuse'].includes(to) ? { email: 'quote_decision', vars: { numero: q.number, decision: to === 'accepte' ? 'accepté' : 'refusé' } } : {}),
      });
    }
  }
  if (!isTeam(actor, 'quotes') && ['accepte', 'refuse'].includes(to)) {
    // Le client a répondu en ligne : confirmation dans son espace et par e-mail.
    await notifyUser(actor.id, {
      kind: `quote.${to}`, title: to === 'accepte' ? `Vous avez accepté le devis ${q.number}` : `Vous avez refusé le devis ${q.number}`,
      body: to === 'accepte' ? 'L’atelier prépare votre commande et vous tient informé.' : null, link,
      email: 'quote_decision', vars: { numero: q.number, decision: to === 'accepte' ? 'accepté' : 'refusé' },
      emailBody: to === 'accepte' ? 'L’atelier prépare votre commande et vous tient informé de son avancement.' : 'Merci de nous avoir répondu. N’hésitez pas à nous recontacter pour une nouvelle demande.',
    });
  }
  if (!isTeam(actor, 'quotes')) {
    await notifyTeam('quotes', { kind: `quote.${to}`, title: `Devis ${q.number} : ${STATUS_LABELS[to].toLowerCase()} par le client`, link: `/espace?devis=${id}` });
  }
  return getQuote(actor, id);
}

/** Transforme un devis accepté en commande (une seule commande par devis). */
export async function convertToOrder(actor, id, { due_on = null } = {}) {
  const q = await loadQuote(actor, id);
  if (q.status !== 'accepte') throw new HttpError(409, 'Seul un devis accepté peut devenir une commande.');
  const existing = await one('select number from orders where quote_id = $1', [id]);
  if (existing) throw new HttpError(409, `Ce devis a déjà donné la commande ${existing.number}.`);
  let row;
  try {
    row = await one(
      `with o as (
         insert into orders (quote_id, user_id, customer_name, customer_phone, customer_email, discount_fcfa, due_on)
         select id, user_id, customer_name, customer_phone, customer_email, discount_fcfa, $2::date
           from quotes where id = $1 and status = 'accepte'
         returning id, number
       ), i as (
         insert into order_items (order_id, quote_item_id, service_slug, label, description, quantity, unit, unit_price_fcfa, sort)
         select o.id, qi.id, qi.service_slug, qi.label, qi.description, qi.quantity, qi.unit, qi.unit_price_fcfa, qi.sort
           from o, quote_items qi where qi.quote_id = $1
         returning id
       )
       select o.id, o.number, (select count(*) from i)::int as items from o`,
      [id, due_on],
    );
  } catch (err) {
    // Deux clics simultanés : l'index unique orders_quote_key refuse la seconde commande.
    if (/orders_quote_key|duplicate key/.test(String(err.message))) throw new HttpError(409, 'Ce devis a déjà donné une commande.');
    throw err;
  }
  if (!row) throw new HttpError(409, 'Seul un devis accepté peut devenir une commande.');
  await logActivity(actor, 'quote.converted', 'quote', id, { order_id: row.id, number: row.number });
  await logActivity(actor, 'order.created', 'order', row.id, { number: row.number, from_quote: q.number, items: row.items });
  // Import différé : orders.js importe déjà ce fichier.
  await (await import('./orders.js')).announceOrder(actor, row.id);
  return row;
}
