// Tableau de bord : statistiques (toutes calculées sur la base, jamais inventées)
// et documents d'un client.
import { query, one } from '../db.js';
import { isTeam } from '../activity.js';

/** 12 derniers mois, y compris le mois en cours (« 2026-11 »…). */
const MONTHS = `select to_char(d, 'YYYY-MM') as month
                  from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') d`;

/** Statistiques visibles selon les droits : l'admin voit tout, le staff ses domaines. */
export async function stats(actor) {
  const out = { generated_at: new Date().toISOString(), sections: [] };
  const tasks = [];
  if (isTeam(actor, 'clients')) {
    out.sections.push('clients');
    tasks.push(one(
      `select count(*)::int as clients,
              count(*) filter (where created_at > now() - interval '30 days')::int as new_clients,
              count(*) filter (where email_verified_at is not null)::int as verified
         from users where role = 'client'`,
    ).then((r) => (out.clients = r)));
    tasks.push(query(
      `select m.month, count(u.id)::int as n from (${MONTHS}) m
         left join users u on u.role = 'client' and to_char(u.created_at, 'YYYY-MM') = m.month
        group by m.month order by m.month`,
    ).then((r) => (out.clients_by_month = r)));
  }
  if (isTeam(actor, 'quotes')) {
    out.sections.push('quotes');
    tasks.push(one(
      `select count(*)::int as total,
              count(*) filter (where status in ('nouveau', 'en_etude'))::int as to_process,
              count(*) filter (where status = 'envoye')::int as waiting_client,
              count(*) filter (where status = 'accepte')::int as accepted,
              count(*) filter (where status in ('refuse', 'expire', 'annule'))::int as closed,
              count(*) filter (where created_at > now() - interval '30 days')::int as last_30_days
         from quotes`,
    ).then((r) => (out.quotes = r)));
    tasks.push(query(
      `select m.month, count(q.id)::int as n, count(q.id) filter (where q.status = 'accepte')::int as accepted
         from (${MONTHS}) m left join quotes q on to_char(q.created_at, 'YYYY-MM') = m.month
        group by m.month order by m.month`,
    ).then((r) => (out.quotes_by_month = r)));
  }
  if (isTeam(actor, 'orders')) {
    out.sections.push('orders');
    tasks.push(one(
      `select count(*)::int as total,
              count(*) filter (where status = 'en_attente')::int as pending,
              count(*) filter (where status = 'confirmee')::int as confirmed,
              count(*) filter (where status = 'en_production')::int as in_production,
              count(*) filter (where status in ('terminee', 'livree'))::int as done,
              count(*) filter (where status = 'annulee')::int as cancelled,
              coalesce(sum(total_fcfa) filter (where status <> 'annulee'), 0)::float8 as ordered_fcfa,
              coalesce(sum(amount_paid_fcfa) filter (where status <> 'annulee'), 0)::float8 as paid_fcfa
         from orders`,
    ).then((r) => (out.orders = r)));
    tasks.push(query(
      `select m.month, count(o.id)::int as n, coalesce(sum(o.total_fcfa), 0)::float8 as total_fcfa
         from (${MONTHS}) m left join orders o on to_char(o.created_at, 'YYYY-MM') = m.month and o.status <> 'annulee'
        group by m.month order by m.month`,
    ).then((r) => (out.orders_by_month = r)));
  }
  if (isTeam(actor, 'trainings')) {
    out.sections.push('trainings');
    tasks.push(one(
      `select count(*)::int as total,
              count(*) filter (where status = 'Inscrit')::int as confirmed,
              count(*) filter (where status in ('Nouvelle demande', 'Contacté'))::int as pending
         from enrollments`,
    ).then((r) => (out.enrollments = r)));
    tasks.push(query(
      `select coalesce(t.title, e.training_title) as title, count(*)::int as n
         from enrollments e left join trainings t on t.slug = e.training_slug
        where e.status <> 'Annulé'
        group by 1 order by 2 desc, 1 limit 8`,
    ).then((r) => (out.enrollments_by_training = r)));
  }
  await Promise.all(tasks);
  return out;
}

/** Tous les documents d'un client : ses fichiers et ceux de ses devis, commandes, inscriptions. */
export async function documentsOf(userId) {
  const [files, quotes, orders] = await Promise.all([
    query(
      `select f.id, f.original_name, f.mime_type, f.size_bytes::float8 as size_bytes, f.created_at, f.purpose,
              coalesce(q.number, o.number, e.training_title) as about,
              case when f.owner_id = $1 then 'client' else 'atelier' end as source
         from uploaded_files f
         left join quotes q on q.id = f.quote_id
         left join orders o on o.id = f.order_id
         left join enrollments e on e.id = f.enrollment_id
         left join messages m on m.id = f.message_id
         left join quotes mq on mq.id = m.quote_id
         left join orders mo on mo.id = m.order_id
        where f.status = 'ready' and f.purpose <> 'avatar'
          and (q.user_id = $1 or o.user_id = $1 or e.user_id = $1 or mq.user_id = $1 or mo.user_id = $1 or m.support_user_id = $1)
        order by f.created_at desc`,
      [userId],
    ),
    // Devis téléchargeables en PDF : ceux qui ont été envoyés.
    query(
      `select id, number, status, sent_at, total_fcfa::float8 as total_fcfa from quotes
        where user_id = $1 and status not in ('nouveau', 'en_etude') order by coalesce(sent_at, created_at) desc`,
      [userId],
    ),
    query(`select id, number, status, created_at, total_fcfa::float8 as total_fcfa from orders where user_id = $1 order by created_at desc`, [userId]),
  ]);
  const { listInvoices, receiptsOf } = await import('./billing.js');
  const [invoices, receipts, certificates, sessionFiles] = await Promise.all([
    listInvoices({ id: userId, role: 'client' }),
    receiptsOf(userId),
    query(`select c.id, c.number, c.kind, c.training_title, c.issued_at from certificates c join enrollments e on e.id = c.enrollment_id
            where e.user_id = $1 and c.revoked_at is null order by c.issued_at desc`, [userId]),
    // Documents pédagogiques des sessions où la place est confirmée.
    query(`select f.id, f.original_name, f.mime_type, f.size_bytes::float8 as size_bytes, f.created_at, f.purpose, e.training_title as about, 'atelier' as source
             from uploaded_files f join enrollments e on e.session_id = f.session_id
            where f.status = 'ready' and e.user_id = $1 and e.status in ('Inscrit', 'Terminé') order by f.created_at desc`, [userId]),
  ]);
  return { files: [...files, ...sessionFiles], quotes, orders, invoices, receipts, certificates };
}
