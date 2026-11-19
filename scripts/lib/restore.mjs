// Restauration d'une sauvegarde créée par `npm run db:backup` (un fichier JSON par table).
//
// Règles de sécurité :
//   - la base cible doit être VIDE (aucune table de l'application) : la restauration ne
//     remplace jamais des données existantes ;
//   - le schéma est recréé exactement à la version de la sauvegarde (migrations), puis les
//     migrations plus récentes s'appliquent normalement avec `npm run db:migrate` ;
//   - les lignes sont réinsérées telles quelles (identifiants, dates, montants), déclencheurs
//     suspendus, contraintes de clés étrangères vérifiées ; les comptes sont contrôlés à la fin.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { migrate, isEmptyDatabase } from './migrate.mjs';

const qi = (name) => `"${String(name).replace(/"/g, '""')}"`;
const CHUNK = 500;

export async function restore(db, dir, migrationsDir, { log = () => {} } = {}) {
  const manifestFile = join(dir, 'manifest.json');
  if (!existsSync(manifestFile)) throw new Error(`Aucune sauvegarde trouvée dans ${dir} (manifest.json absent).`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (!(await isEmptyDatabase(db))) {
    throw new Error('La base cible contient déjà les tables de l’application. Par sécurité, la restauration se fait uniquement dans une base vide (nouvelle base ou nouvelle branche Neon).');
  }
  const read = (t) => JSON.parse(readFileSync(join(dir, `${t}.json`), 'utf8'));

  // 1. Schéma à la version de la sauvegarde.
  const versions = existsSync(join(dir, 'schema_migrations.json')) ? read('schema_migrations').map((m) => m.version).sort() : [];
  if (!versions.length) throw new Error('La sauvegarde ne contient pas la liste des migrations (schema_migrations).');
  const upTo = versions.at(-1);
  await migrate(db, migrationsDir, { upTo, log });
  log(`Schéma recréé jusqu’à la migration ${upTo}.`);

  // Les migrations ajoutent du contenu de départ (catégories…) : la sauvegarde fait foi.
  const tables = Object.keys(manifest.tables).filter((t) => t !== 'schema_migrations');
  const existing = new Set((await db.rows(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).map((r) => r.table_name));
  const missing = tables.filter((t) => !existing.has(t));
  if (missing.length) throw new Error(`Tables de la sauvegarde absentes du schéma : ${missing.join(', ')}.`);

  // 2. Colonnes insérables (hors colonnes calculées) et clés primaires.
  const cols = {};
  for (const r of await db.rows(`select c.relname as t, a.attname as col, a.attidentity as ident, a.attgenerated as gen
      from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by a.attnum`)) {
    (cols[r.t] ||= []).push(r);
  }
  const pk = Object.fromEntries((await db.rows(`select c.relname as t, array_agg(a.attname order by a.attnum)::text[] as cols
      from pg_index i join pg_class c on c.oid = i.indrelid join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indisprimary and c.relnamespace = 'public'::regnamespace group by c.relname`)).map((r) => [r.t, typeof r.cols === 'string' ? r.cols.replace(/[{}]/g, '').split(',') : r.cols]));

  // 3. Ordre d'insertion selon les clés étrangères ; une référence circulaire (ex. photo de
  //    profil ↔ fichier) est d'abord laissée vide puis complétée à la fin.
  const fks = await db.rows(`select c.conrelid::regclass::text as t, a.attname as col, c.confrelid::regclass::text as ref,
         not a.attnotnull as nullable,
         exists (select 1 from pg_constraint k where k.conrelid = c.conrelid and k.contype = 'c' and a.attnum = any(k.conkey)) as checked
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
  const strip = (t) => t.replace(/^public\./, '').replace(/"/g, '');
  let edges = fks.map((f) => ({ t: strip(f.t), col: f.col, ref: strip(f.ref), breakable: f.nullable && !f.checked }))
    .filter((e) => tables.includes(e.t) && tables.includes(e.ref));
  const deferred = edges.filter((e) => e.t === e.ref); // référence à sa propre table
  edges = edges.filter((e) => e.t !== e.ref);
  // Tri topologique (Kahn). En cas de cycle, une référence facultative et sans contrainte de
  // vérification est laissée vide à l'insertion puis complétée (de préférence vers un fichier).
  const order = [];
  const done = new Set();
  while (order.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && edges.every((e) => e.t !== t || done.has(e.ref)));
    if (ready.length) { for (const t of ready) { order.push(t); done.add(t); } continue; }
    const stuck = edges.filter((e) => !done.has(e.t) && !done.has(e.ref) && e.breakable)
      .sort((a, b) => (b.ref === 'uploaded_files') - (a.ref === 'uploaded_files'));
    if (!stuck.length) throw new Error('Références circulaires impossibles à ordonner : restauration annulée.');
    deferred.push(stuck[0]);
    edges = edges.filter((e) => e !== stuck[0]);
  }

  // 4. Insertion.
  for (const t of [...order].reverse()) await db.exec(`delete from ${qi(t)}`); // contenu de départ des migrations
  for (const t of order) {
    const rows = read(t);
    if (!rows.length) continue;
    const later = deferred.filter((d) => d.t === t).map((d) => d.col);
    const insertable = cols[t].filter((c) => c.gen === '').map((c) => c.col);
    const identity = cols[t].some((c) => c.ident === 'a');
    await db.exec(`alter table ${qi(t)} disable trigger user`);
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK).map((r) => (later.length ? { ...r, ...Object.fromEntries(later.map((c) => [c, null])) } : r));
        const list = insertable.map(qi).join(', ');
        await db.rows(
          `insert into ${qi(t)} (${list}) ${identity ? 'overriding system value' : ''} select ${list} from jsonb_populate_recordset(null::${qi(t)}, $1::jsonb) returning 1`,
          [JSON.stringify(chunk)],
        );
      }
    } finally {
      await db.exec(`alter table ${qi(t)} enable trigger user`);
    }
    log(`  ${t} : ${rows.length} ligne(s)`);
  }
  for (const { t, col } of deferred) {
    const rows = read(t).filter((r) => r[col] !== null && r[col] !== undefined);
    const keys = pk[t];
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.exec(`alter table ${qi(t)} disable trigger user`);
      try {
        await db.rows(
          `update ${qi(t)} x set ${qi(col)} = s.${qi(col)} from jsonb_populate_recordset(null::${qi(t)}, $1::jsonb) s where ${keys.map((k) => `x.${qi(k)} = s.${qi(k)}`).join(' and ')} returning 1`,
          [JSON.stringify(rows.slice(i, i + CHUNK))],
        );
      } finally {
        await db.exec(`alter table ${qi(t)} enable trigger user`);
      }
    }
  }

  // 5. Compteurs d'identité recalés sur les valeurs restaurées.
  for (const t of tables) {
    for (const c of cols[t].filter((x) => x.ident === 'a')) {
      await db.rows(`select setval(pg_get_serial_sequence($1, $2), coalesce((select max(${qi(c.col)}) from ${qi(t)}), 0) + 1, false)`, [t, c.col]);
    }
  }

  // 6. Vérification : même nombre de lignes que dans la sauvegarde.
  const diff = [];
  for (const t of tables) {
    const [{ n }] = await db.rows(`select count(*)::int as n from ${qi(t)}`);
    if (n !== manifest.tables[t]) diff.push(`${t} : ${n} au lieu de ${manifest.tables[t]}`);
  }
  if (diff.length) throw new Error(`Restauration incomplète : ${diff.join(' ; ')}.`);
  return { tables: tables.length, rows: tables.reduce((a, t) => a + manifest.tables[t], 0), upTo, created_at: manifest.created_at };
}
