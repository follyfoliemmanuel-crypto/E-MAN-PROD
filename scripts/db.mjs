// Outils base de données, en local comme sur Neon (chaîne lue dans .env : DATABASE_URL).
//
//   npm run db:migrate        sauvegarde, puis applique les migrations en attente (db/migrations),
//                             puis ajoute le contenu de départ manquant (sans rien écraser)
//   npm run db:setup          identique (ancien nom)
//   npm run db:status         migrations appliquées et en attente
//   npm run db:backup         sauvegarde de toutes les tables dans backups/
//   npm run db:restore -- backups/<dossier>   restaure une sauvegarde dans une base VIDE
//   npm run db:demo           données de démonstration (-- --remove pour les retirer)
//   npm run db:admin -- email@exemple.com   donne le rôle administrateur à ce compte
//   npm run db:check          vérifie la connexion
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { seedStatements } from '../src/content/seed.js';
import { typeParsers } from '../api/_lib/db.js';
import { migrate, migrationStatus, backup, isEmptyDatabase, ensureGitignored } from './lib/migrate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS = root + 'db/migrations';
const BACKUPS = root + 'backups';

// Lecture minimale du fichier .env (sans dépendance).
function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = root + name;
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

function fail(message) {
  console.error('\n✖ ' + message + '\n');
  process.exit(1);
}

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL est vide. Copiez .env.example vers .env et renseignez-la.');

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: true }, types: typeParsers(pg.types) });
const db = {
  exec: (sql) => client.query(sql),
  rows: (sql, params) => client.query(sql, params).then((r) => r.rows),
};

const [command, ...args] = process.argv.slice(2);
try {
  await client.connect();
} catch (err) {
  fail(`Connexion impossible à la base (${err.code || err.message}).\n  Vérifiez DATABASE_URL dans .env${local ? ' et que PostgreSQL est bien démarré sur votre PC' : ''}.`);
}

async function seed() {
  let added = 0;
  for (const { text, params } of seedStatements()) added += (await client.query(text, params)).rowCount;
  console.log(added ? `✔ Contenu de départ : ${added} élément(s) ajouté(s).` : '✔ Contenu de départ déjà présent : rien à ajouter.');
}

async function doBackup(label) {
  ensureGitignored(root, 'backups/');
  const { dir, manifest } = await backup(db, BACKUPS, { label });
  const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(`✔ Sauvegarde : ${Object.keys(manifest.tables).length} tables, ${total} lignes → ${dir.replace(root, '')}`);
}

try {
  if (command === 'migrate' || command === 'setup') {
    const empty = await isEmptyDatabase(db);
    const applied = await migrate(db, MIGRATIONS, {
      before: async (pending) => {
        console.log(`Migrations à appliquer : ${pending.map((m) => m.file).join(', ')}`);
        if (empty) console.log('Base vide : pas de sauvegarde nécessaire.');
        else if (args.includes('--no-backup')) console.log('⚠ Sauvegarde désactivée (--no-backup).');
        else await doBackup('avant-migration');
      },
      log: (m) => console.log('  ' + m),
    });
    console.log(applied.length ? `✔ ${applied.length} migration(s) appliquée(s).` : '✔ Base à jour : aucune migration en attente.');
    await seed();
  } else if (command === 'status') {
    const { applied, pending, altered } = await migrationStatus(db, MIGRATIONS);
    for (const m of applied) console.log(`  ✔ ${m.version} ${m.name}  (${new Date(m.applied_at).toLocaleString('fr-FR')})`);
    for (const m of pending) console.log(`  … ${m.file}  en attente`);
    for (const m of altered) console.log(`  ⚠ ${m.file}  modifiée après application`);
    if (!pending.length && !altered.length) console.log('✔ Base à jour.');
  } else if (command === 'backup') {
    await doBackup(args[0] || 'manuelle');
  } else if (command === 'restore') {
    const dir = args[0];
    if (!dir) fail('Indiquez le dossier de la sauvegarde : npm run db:restore -- backups/2026-11-19T08-00-00_manuelle');
    const { restore } = await import('./lib/restore.mjs');
    const r = await restore(db, dir.startsWith('/') ? dir : root + dir, MIGRATIONS, { log: (m) => console.log(m) });
    console.log(`✔ Restauration terminée : ${r.tables} tables, ${r.rows} lignes (sauvegarde du ${new Date(r.created_at).toLocaleString('fr-FR')}, schéma ${r.upTo}).`);
    console.log('  Étape suivante : npm run db:migrate (applique les migrations plus récentes que la sauvegarde).');
  } else if (command === 'demo') {
    const { setQueryRunner } = await import('../api/_lib/db.js');
    setQueryRunner((text, params) => client.query(text, params).then((r) => r.rows));
    const demo = await import('./lib/demo.mjs');
    if (args.includes('--remove')) await demo.removeDemoData();
    else await demo.createDemoData();
  } else if (command === 'admin') {
    const email = args[0];
    if (!email) fail('Indiquez l’e-mail du compte : npm run db:admin -- vous@exemple.com');
    const { rows } = await client.query(`update users set role = 'admin' where lower(email) = lower($1) returning email`, [email]);
    if (!rows.length) fail(`Aucun compte avec l’adresse ${email}. Créez-le d’abord sur le site (Espace client > Créer un compte).`);
    console.log(`✔ ${rows[0].email} est maintenant administrateur.`);
  } else if (command === 'check') {
    const { rows } = await client.query('select version()');
    console.log('✔ Connexion réussie : ' + rows[0].version.split(',')[0]);
  } else {
    fail('Commande inconnue. Utilisez : migrate, status, backup, restore, demo, admin ou check.');
  }
} catch (err) {
  fail(err.message);
} finally {
  await client.end();
}
