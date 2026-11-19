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

/**
 * Mêmes formes de valeurs avec les deux pilotes (pg en local, Neon en ligne), que le code
 * de l'application attend partout :
 *   bigint, numeric     → nombre (montants en FCFA, tailles de fichiers, versions)
 *   date                → texte « AAAA-MM-JJ » (jamais un objet Date décalé par le fuseau)
 *   timestamp(tz)       → texte ISO 8601 (« 2026-11-19T15:32:04.624+00:00 »)
 * Sans cela, le pilote renverrait par exemple '5' au lieu de 5 et une date JavaScript au
 * lieu de '2026-11-19', ce qui casse les comparaisons et les dates affichées.
 */
export function typeParsers(base) {
  const iso = (v) => v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  return {
    getTypeParser(id, format) {
      if (format === 'binary') return base.getTypeParser(id, format);
      if (id === 20) return (v) => { const n = Number(v); return Number.isSafeInteger(n) ? n : v; };
      if (id === 1700) return (v) => Number(v);
      if (id === 1082) return (v) => v;
      if (id === 1114) return (v) => v.replace(' ', 'T');
      if (id === 1184) return iso;
      return base.getTypeParser(id, format);
    },
  };
}

async function getRunner() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL n’est pas configurée. Copiez .env.example vers .env et renseignez-la (voir README, « Démarrer en local »).');
  }
  if (isLocalDatabase(url)) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 5, types: typeParsers(pg.types) });
    return (text, params) => pool.query(text, params).then((r) => r.rows);
  }
  const { neon, types } = await import('@neondatabase/serverless');
  const sql = neon(url, { types: typeParsers(types) });
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
