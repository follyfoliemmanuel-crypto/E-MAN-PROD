// Données de démonstration (npm run db:demo), créées en passant par les mêmes règles
// métier que l'API : numéros de devis, totaux, statuts, historique, notifications.
//
// Rien de ce qui est créé ici n'apparaît sur les pages publiques du site : pas de
// réalisation, pas de session de formation, pas d'avis publié. Tout est repérable
// par l'adresse en @demo.emanprod.test et se retire avec `npm run db:demo -- --remove`.
import { query, one } from '../../api/_lib/db.js';
import { hashPassword } from '../../api/_lib/auth.js';
import { createQuote, updateQuote, changeQuoteStatus, convertToOrder } from '../../api/_lib/services/quotes.js';
import { createOrder, updateOrder } from '../../api/_lib/services/orders.js';
import { createEnrollment } from '../../api/_lib/services/enrollments.js';
import { postMessage } from '../../api/_lib/services/inbox.js';
import { updateAccount } from '../../api/_lib/services/clients.js';

export const DEMO_DOMAIN = '@demo.emanprod.test';
export const DEMO_PASSWORD = 'demo-client-2026';
const like = `%${DEMO_DOMAIN}`;

async function demoUser(email, name, phone) {
  const existing = await one('select id, role from users where email = $1', [email]);
  if (existing) return existing;
  return one(
    `insert into users (email, password_hash, full_name, phone, email_verified_at) values ($1, $2, $3, $4, now()) returning id, role`,
    [email, await hashPassword(DEMO_PASSWORD), name, phone],
  );
}

export async function createDemoData(log = console.log) {
  if (await one('select id from users where email like $1', [like])) {
    log('Des données de démonstration existent déjà : retirez-les d’abord (npm run db:demo -- --remove).');
    return null;
  }
  const admin = { id: null, role: 'admin' };
  const kossi = await demoUser(`kossi${DEMO_DOMAIN}`, 'Kossi Démo', '+22890000001');
  const afi = await demoUser(`afi${DEMO_DOMAIN}`, 'Afi Démo', '+22890000002');
  const kossiActor = { id: kossi.id, role: 'client' };
  await updateAccount(kossiActor, { client_type: 'entreprise', company_name: 'Boutique Démo SARL', city: 'Lomé', preferred_contact: 'whatsapp' });

  // 1. Demande envoyée depuis le site par un client connecté, encore à étudier.
  const q1 = await createQuote(kossiActor, {
    name: 'Kossi Démo', phone: '+22890000001', email: `kossi${DEMO_DOMAIN}`, company: 'Boutique Démo SARL',
    message: 'Bâche pour la façade de la boutique et cartes de visite pour l’équipe. (démonstration)',
    items: [
      { service_slug: 'enseignes-publicite', label: 'Bâche façade 3 × 1 m', quantity: 1, unit: 'pièce' },
      { service_slug: 'imprimerie', label: 'Cartes de visite recto verso', quantity: 500, unit: 'pièce' },
    ],
  });

  // 2. Devis chiffré, envoyé, accepté, puis transformé en commande en production.
  const q2 = await createQuote(kossiActor, {
    name: 'Kossi Démo', phone: '+22890000001', email: `kossi${DEMO_DOMAIN}`,
    message: 'T-shirts sérigraphiés pour un évènement. (démonstration)',
    items: [{ service_slug: 'serigraphie', label: 'T-shirts sérigraphiés 1 couleur', quantity: 50, unit: 'pièce' }],
  });
  await updateQuote(admin, q2.id, {
    items: [
      { service_slug: 'serigraphie', label: 'T-shirts sérigraphiés 1 couleur', quantity: 50, unit: 'pièce', unit_price_fcfa: 3500 },
      { service_slug: 'infographie', label: 'Préparation du visuel', quantity: 1, unit: 'forfait', unit_price_fcfa: 10000 },
    ],
    discount_fcfa: 5000,
  });
  await changeQuoteStatus(admin, q2.id, 'envoye');
  await postMessage(admin, { quote_id: q2.id }, 'Bonjour, voici votre devis. Délai : 5 jours ouvrés après validation. (démonstration)');
  await changeQuoteStatus(kossiActor, q2.id, 'accepte');
  const o1 = await convertToOrder(admin, q2.id, { due_on: null });
  await updateOrder(admin, o1.id, { status: 'en_production', amount_paid_fcfa: 80000 });

  // 3. Demande d'un visiteur sans compte, puis commande directe à l'atelier.
  await createQuote({ id: null, role: 'guest' }, {
    name: 'Visiteur Démo', phone: '+22890000003', email: `visiteur${DEMO_DOMAIN}`,
    message: 'Logo pour une association. (démonstration)', items: [{ service_slug: 'infographie', label: 'Création de logo' }],
  });
  const o2 = await createOrder(admin, {
    user_id: afi.id, name: 'Afi Démo', phone: '+22890000002', email: `afi${DEMO_DOMAIN}`,
    items: [{ service_slug: 'papeterie', label: 'Chemises à rabat imprimées', quantity: 100, unit: 'pièce', unit_price_fcfa: 800 }],
    due_on: null, admin_note: 'Commande passée au comptoir. (démonstration)',
  });
  await updateOrder(admin, o2.id, { status: 'en_production' });
  await updateOrder(admin, o2.id, { status: 'terminee' });
  await updateOrder(admin, o2.id, { status: 'livree', amount_paid_fcfa: 80000 });

  // 4. Inscriptions (sans session : aucune date fictive n'est publiée).
  await createEnrollment({ id: afi.id, role: 'client' }, {
    name: 'Afi Démo', phone: '+22890000002', email: `afi${DEMO_DOMAIN}`, training_slug: 'infographie-design-graphique',
    message: 'Disponible le samedi. (démonstration)',
  });
  await createEnrollment({ id: null, role: 'guest' }, {
    name: 'Visiteur Démo', phone: '+22890000003', email: `visiteur${DEMO_DOMAIN}`, training_slug: 'html-css-javascript',
  });

  log(`✔ Démonstration : 2 comptes clients (mot de passe « ${DEMO_PASSWORD} »), 3 devis, 2 commandes, 2 inscriptions, 1 message.`);
  log(`  Comptes : kossi${DEMO_DOMAIN}, afi${DEMO_DOMAIN}. Devis ${q1.number} (à étudier), ${q2.number} (accepté → commande ${o1.number}).`);
  return { q1, q2, o1, o2 };
}

export async function removeDemoData(log = console.log) {
  const quotes = await query('select id from quotes where customer_email like $1', [like]);
  const orders = await query('select id from orders where customer_email like $1', [like]);
  const enrollments = await query('select id from enrollments where email like $1', [like]);
  const users = await query('select id from users where email like $1', [like]);
  const ids = [...quotes, ...orders, ...enrollments, ...users].map((r) => r.id);
  if (ids.length) await query('delete from activity_logs where entity_id = any($1::text[]) returning id', [`{${ids.join(',')}}`]);
  // Notifications des admins à propos des demandes de démonstration.
  await query(`delete from notifications where body like '%Démo%' or title like '%Démo%' or link like any($1::text[]) returning id`, [
    `{${[...quotes.map((q) => `%devis=${q.id}`), ...orders.map((o) => `%commande=${o.id}`)].join(',') || 'aucun'}}`,
  ]);
  await query('delete from orders where customer_email like $1 returning id', [like]);
  await query('delete from quotes where customer_email like $1 returning id', [like]);
  await query('delete from enrollments where email like $1 returning id', [like]);
  await query('delete from users where email like $1 returning id', [like]);
  log(`✔ Démonstration retirée : ${quotes.length} devis, ${orders.length} commandes, ${enrollments.length} inscriptions, ${users.length} comptes.`);
  return { quotes: quotes.length, orders: orders.length, enrollments: enrollments.length, users: users.length };
}
