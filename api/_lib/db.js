// Accès à la base de données.
// - En ligne (Vercel) et en local avec une base Neon : driver serverless de Neon (HTTP).
// - En local avec un PostgreSQL installé sur le PC (DATABASE_URL vers localhost) :
//   driver « pg » classique, car le driver Neon ne parle qu'aux serveurs Neon.
// Les dossiers commençant par « _ » ne sont pas exposés comme routes par Vercel.
let runner = null;
let override = null;

/**
 * Remplace l'exécution des requêtes : utilisé par les scripts (`npm run db:demo`,
 * qui passent par le même code métier que l'API) et par les tests automatisés.
 */
export function setQueryRunner(fn) {
  override = fn;
}
export const __setQueryForTests = setQueryRunner;

export function isLocalDatabase(url) {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function getRunner() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL n’est pas configurée. Copiez .env.example vers .env et renseignez-la (voir README, « Démarrer en local »).');
  }
  if (isLocalDatabase(url)) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    return (text, params) => pool.query(text, params).then((r) => r.rows);
  }
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return (text, params) => sql.query(text, params);
}

/**
 * Exécute une requête paramétrée ($1, $2…) et renvoie les lignes.
 * Ne jamais concaténer de valeur dans `text` : toujours passer par `params`.
 */
export async function query(text, params = []) {
  if (override) return override(text, params);
  if (!runner) {
    runner = getRunner().catch((err) => {
      runner = null;
      throw err;
    });
  }
  return (await runner)(text, params);
}

export async function one(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}
