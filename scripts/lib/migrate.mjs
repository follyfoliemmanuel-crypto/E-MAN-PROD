// Migrations et sauvegardes de la base, indépendantes du driver :
//   db.exec(sql)          exécute un script SQL de plusieurs instructions
//   db.rows(sql, params)  exécute une requête et renvoie les lignes
// Utilisé par scripts/db.mjs (driver « pg ») et par les tests.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export function listMigrations(dir) {
  return readdirSync(dir)
    .filter((f) => FILE.test(f))
    .sort()
    .map((f) => {
      const [, version, name] = f.match(FILE);
      const sql = readFileSync(join(dir, f), 'utf8');
      return { version, name, file: f, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

export async function migrationStatus(db, dir) {
  await db.exec(`create table if not exists schema_migrations (
    version text primary key,
    name text not null,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const applied = await db.rows('select version, name, checksum, applied_at from schema_migrations order by version');
  const byVersion = Object.fromEntries(applied.map((m) => [m.version, m]));
  const all = listMigrations(dir);
  // Une migration déjà appliquée ne doit jamais être modifiée : on en écrit une nouvelle.
  const altered = all.filter((m) => byVersion[m.version] && byVersion[m.version].checksum !== m.checksum);
  return { all, applied, pending: all.filter((m) => !byVersion[m.version]), altered };
}

/**
 * Applique les migrations en attente, chacune dans sa propre transaction :
 * si une instruction échoue, la base reste exactement dans l'état précédent.
 * @param {{ before?: (pending) => Promise<void>, log?: (msg: string) => void }} opts
 */
export async function migrate(db, dir, { before, log = () => {}, upTo = null } = {}) {
  const status = await migrationStatus(db, dir);
  const { altered } = status;
  // upTo : s'arrêter à une version (restauration d'une sauvegarde faite avec un schéma plus ancien).
  const pending = upTo ? status.pending.filter((m) => m.version <= upTo) : status.pending;
  if (altered.length) {
    throw new Error(`Migration(s) modifiée(s) après application : ${altered.map((m) => m.file).join(', ')}. Annulez la modification et créez une nouvelle migration.`);
  }
  if (!pending.length) return [];
  if (before) await before(pending);
  for (const m of pending) {
    log(`→ ${m.file}`);
    try {
      await db.exec(`begin;\n${m.sql}\n;\ninsert into schema_migrations (version, name, checksum) values ('${m.version}', '${m.name}', '${m.checksum}');\ncommit;`);
    } catch (err) {
      await db.exec('rollback').catch(() => {});
      throw new Error(`La migration ${m.file} a échoué, rien n'a été modifié : ${err.message}`);
    }
  }
  return pending;
}

/** Une base est « vide » si elle n'a encore aucune table de l'application. */
export async function isEmptyDatabase(db) {
  const [{ n }] = await db.rows(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'users'`);
  return n === 0;
}

/**
 * Sauvegarde lisible de toutes les tables (un fichier JSON par table + un manifeste).
 * C'est une copie de sécurité des données ; pour revenir en arrière sur Neon, la
 * méthode la plus sûre reste une branche créée avant la migration (voir README).
 */
export async function backup(db, outRoot, { label = 'sauvegarde' } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(outRoot, `${stamp}_${label}`);
  mkdirSync(dir, { recursive: true });
  const tables = await db.rows(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const manifest = { created_at: new Date().toISOString(), label, tables: {} };
  for (const { table_name: t } of tables) {
    const rows = await db.rows(`select * from "${t.replace(/"/g, '""')}"`);
    writeFileSync(join(dir, `${t}.json`), JSON.stringify(rows, null, 1));
    manifest.tables[t] = rows.length;
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { dir, manifest };
}

export function ensureGitignored(root, entry) {
  const file = join(root, '.gitignore');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (!text.split(/\r?\n/).includes(entry)) writeFileSync(file, text.replace(/\n?$/, '\n') + entry + '\n');
}

/**
 * Copie de sécurité DANS la base, avant des migrations lancées depuis Vercel (où aucun fichier ne
 * survit au build) : chaque table publique est copiée dans le schéma « avant_migration_<version> ».
 * Les 2 copies les plus récentes sont gardées, les plus anciennes retirées (jamais les tables du site).
 * Restauration manuelle : voir docs/A-FAIRE-MANUELLEMENT.md.
 */
export async function snapshotInDatabase(db, label, { keep = 2 } = {}) {
  const schema = `avant_migration_${String(label).replace(/[^0-9a-z_]/gi, '').slice(0, 40) || 'x'}`;
  const tables = (await db.rows(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).map((r) => r.tablename);
  await db.exec(`begin; drop schema if exists ${schema} cascade; create schema ${schema}; revoke all on schema ${schema} from public;`);
  try {
    for (const t of tables) await db.exec(`create table ${schema}."${t.replace(/"/g, '')}" as table public."${t.replace(/"/g, '')}"`);
    await db.exec('commit');
  } catch (err) {
    await db.exec('rollback').catch(() => {});
    throw new Error(`Copie de sécurité impossible, aucune migration lancée : ${err.message}`);
  }
  const old = (await db.rows(`select nspname from pg_namespace where nspname like 'avant\\_migration\\_%' order by nspname desc`)).map((r) => r.nspname);
  for (const s of old.slice(keep)) await db.exec(`drop schema ${s} cascade`);
  return { schema, tables: tables.length };
}
