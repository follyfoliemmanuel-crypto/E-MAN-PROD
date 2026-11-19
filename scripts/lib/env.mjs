// Chargement de .env et connexion PostgreSQL pour les scripts (hors Vercel).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../..', import.meta.url));

export function loadEnv() {
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

/** Client pg relié aux services de l'application (api/_lib/db.js). */
export async function connectDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL est vide (fichier .env ou secret GitHub).');
  const { default: pg } = await import('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes('host=/');
  const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: true } });
  await client.connect();
  const { setQueryRunner } = await import('../../api/_lib/db.js');
  setQueryRunner((text, params) => client.query(text, params).then((r) => r.rows));
  return {
    client,
    db: { exec: (sql) => client.query(sql), rows: (sql, params) => client.query(sql, params).then((r) => r.rows) },
  };
}
