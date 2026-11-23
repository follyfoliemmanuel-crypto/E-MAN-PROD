// Dernier recours : administrateur SEUL qui a perdu son téléphone ET ses codes de récupération.
//   npm run mfa:reset -- adresse@exemple.com
// Exige l'accès à la base (DATABASE_URL_OWNER ou DATABASE_URL dans .env) : seule la personne qui
// gère l'hébergement peut le faire. Le site, lui, n'offre JAMAIS de désactivation sur simple demande.
// Effet : double authentification retirée, codes et appareils de confiance supprimés, sessions
// fermées, évènement inscrit au journal de sécurité. À la connexion suivante, l'activation est
// de nouveau demandée (obligatoire pour l'équipe).
import { connectDb, loadEnv } from './lib/env.mjs';

loadEnv();
const email = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage : npm run mfa:reset -- adresse@exemple.com');
  process.exit(1);
}
const { client, db } = await connectDb();
const [u] = await db.rows(`select id, role, mfa_enabled_at from users where lower(email) = $1`, [email]);
if (!u) { console.error('Aucun compte avec cette adresse.'); await client.end(); process.exit(1); }
if (!u.mfa_enabled_at) { console.log('La double authentification n’est pas activée sur ce compte : rien à faire.'); await client.end(); process.exit(0); }
await db.rows('update users set mfa_secret_enc = null, mfa_pending_enc = null, mfa_enabled_at = null, mfa_last_step = null where id = $1 returning id', [u.id]);
await db.rows('delete from mfa_recovery_codes where user_id = $1 returning id', [u.id]);
await db.rows('delete from trusted_devices where user_id = $1 returning id', [u.id]);
await db.rows('delete from sessions where user_id = $1 returning id', [u.id]);
await db.rows(`insert into activity_logs (actor_id, actor_role, action, entity_type, entity_id, data)
  values ($1::uuid, $2, 'auth.mfa_reset_cli', 'user', $1::text, '{"by":"script serveur"}'::jsonb) returning id`, [u.id, u.role]);
await client.end();
console.log(`Double authentification réinitialisée pour ${email}. Reconnectez-vous et réactivez Google Authenticator.`);
