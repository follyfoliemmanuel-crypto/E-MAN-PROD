// Crée (ou met à jour) le compte de base « eman_app », limité à ce dont le site a besoin :
// lire, ajouter, modifier et supprimer des lignes. Il ne peut ni créer, ni modifier, ni supprimer
// une table : une faille dans le site ne pourrait donc pas détruire la structure de la base.
//
//   DATABASE_URL_OWNER="<chaîne Neon du propriétaire>" npm run db:app-role
//
// Le script affiche la nouvelle chaîne de connexion (mot de passe aléatoire fort, montré une seule
// fois). Dans Vercel : DATABASE_URL = cette nouvelle chaîne ; DATABASE_URL_OWNER = l'ancienne
// (pour les migrations au déploiement). Relancer le script change le mot de passe.
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const ownerUrl = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!ownerUrl) { console.error('Indiquez DATABASE_URL_OWNER (chaîne de connexion du propriétaire de la base).'); process.exit(1); }
const ROLE = process.env.APP_DB_ROLE || 'eman_app';
if (!/^[a-z_][a-z0-9_]{2,40}$/.test(ROLE)) { console.error('Nom de rôle invalide.'); process.exit(1); }
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(ownerUrl) || ownerUrl.includes('host=/');
const client = new pg.Client({ connectionString: ownerUrl, ssl: local ? false : { rejectUnauthorized: true } });
await client.connect();
const password = randomBytes(24).toString('base64url'); // 192 bits
const exists = (await client.query('select 1 from pg_roles where rolname = $1', [ROLE])).rowCount > 0;
const q = (sql) => client.query(sql);
await q('begin');
await q(`${exists ? 'alter' : 'create'} role ${ROLE} with login password '${password}' nosuperuser nocreatedb nocreaterole noinherit`);
const owner = (await client.query('select current_user as u')).rows[0].u;
await q(`grant connect on database ${client.connectionParameters.database} to ${ROLE}`);
await q(`grant usage on schema public to ${ROLE}`);
await q(`revoke create on schema public from ${ROLE}`);
await q(`grant select, insert, update, delete on all tables in schema public to ${ROLE}`);
await q(`grant usage, select on all sequences in schema public to ${ROLE}`);
await q(`grant execute on all functions in schema public to ${ROLE}`);
// Tables créées plus tard par les migrations (lancées par le propriétaire) : mêmes droits, automatiquement.
await q(`alter default privileges for role ${owner} in schema public grant select, insert, update, delete on tables to ${ROLE}`);
await q(`alter default privileges for role ${owner} in schema public grant usage, select on sequences to ${ROLE}`);
await q(`alter default privileges for role ${owner} in schema public grant execute on functions to ${ROLE}`);
await q('commit');
await client.end();
const u = new URL(ownerUrl);
u.username = ROLE; u.password = password;
console.log(`✔ Compte « ${ROLE} » ${exists ? 'mis à jour' : 'créé'} (lecture et écriture des données, aucun droit sur la structure).`);
console.log('\nDans Vercel → Settings → Environment Variables (Production), puis Redeploy :');
console.log(`  DATABASE_URL       = ${u.toString()}`);
console.log('  DATABASE_URL_OWNER = (votre ancienne chaîne DATABASE_URL, celle du propriétaire)');
console.log('\nCe mot de passe n’est affiché qu’une fois. Relancer la commande en crée un nouveau.');
