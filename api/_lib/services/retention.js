// Durée de conservation annoncée dans la politique de confidentialité : « Les demandes sans suite
// sont conservées au plus 3 ans après le dernier contact ». Lancé chaque nuit par la tâche planifiée.
// Les demandes ne sont PAS supprimées : seuls nom, téléphone, e-mail et société sont effacés, pour
// garder les statistiques et la numérotation. Aucune demande liée à une commande, une facture,
// un compte client ou une attestation n'est touchée.
import { query } from '../db.js';

export const RETENTION_YEARS = 3;
const ANON = 'Demande anonymisée';

export async function applyRetention({ years = RETENTION_YEARS } = {}) {
  const interval = `${Number(years)} years`;
  const quotes = await query(
    `update quotes set customer_name = $1, customer_phone = '—', customer_email = null, customer_company = null
      where user_id is null and customer_name <> $1
        and status in ('nouveau', 'en_etude', 'envoye', 'refuse', 'expire', 'annule')
        and updated_at < now() - $2::interval
        and not exists (select 1 from orders o where o.quote_id = quotes.id)
      returning id`, [ANON, interval]);
  const enrollments = await query(
    `update enrollments set full_name = $1, phone = '—', email = null
      where user_id is null and full_name <> $1
        and status in ('Nouvelle demande', 'Contacté', 'Annulé')
        and updated_at < now() - $2::interval
        and not exists (select 1 from certificates c where c.enrollment_id = enrollments.id)
      returning id`, [ANON, interval]);
  return { quotes: quotes.length, enrollments: enrollments.length };
}
