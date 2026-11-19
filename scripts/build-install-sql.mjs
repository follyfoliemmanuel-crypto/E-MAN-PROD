// Génère db/install-neon.sql : toutes les migrations + le contenu de départ, en un
// seul fichier à exécuter dans l'éditeur SQL de Neon (ou avec psql).
//   npm run db:sql
//
// Le fichier est sûr à relancer :
// - chaque migration n'est appliquée que si elle ne figure pas déjà dans
//   schema_migrations (même registre que « npm run db:migrate ») ;
// - une migration modifiée après application arrête tout (comme db:migrate) ;
// - le contenu de départ utilise « on conflict do nothing » : rien n'est écrasé ;
// - tout est dans une seule transaction : en cas d'erreur, la base reste intacte.
// Aucune donnée n'est supprimée, aucun compte n'est créé.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { listMigrations } from './lib/migrate.mjs';
import { seedStatements } from '../src/content/seed.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const migrations = listMigrations(join(root, 'db/migrations'));
const version = JSON.parse((await import('node:fs')).readFileSync(join(root, 'package.json'), 'utf8')).version;

const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
};
/** Remplace $1, $2… par des valeurs SQL (du plus grand au plus petit numéro). */
const inline = ({ text, params }) => params.reduceRight((sql, p, i) => sql.split(`$${i + 1}`).join(lit(p)), text).replace(/\s+returning\s+\w+\s*$/i, '');

const out = [];
out.push(`-- =============================================================================
-- E-MAN PROD v${version} : installation ou mise à jour de la base de données
-- Fichier généré par « npm run db:sql » à partir de db/migrations : ne pas modifier à la main.
--
-- Utilisation (Neon) : console.neon.tech → votre projet → SQL Editor → coller tout
-- le fichier → Run. Ou en ligne de commande : psql "$DATABASE_URL" -f db/install-neon.sql
--
-- • Base vide : crée toutes les tables et le contenu de départ (pôles, prestations,
--   formations, textes du site).
-- • Base existante : n'applique que les migrations manquantes. Avant une mise à jour
--   d'une base en production, créez une branche Neon (sauvegarde instantanée).
-- • Relancer le fichier ne change rien. Aucune donnée n'est supprimée ou écrasée.
-- • Aucun compte n'est créé : voir la dernière section pour nommer l'administrateur.
-- =============================================================================

begin;

create table if not exists schema_migrations (
  version text primary key,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);
`);

for (const m of migrations) {
  const tag = `$m${m.version}$`;
  if (m.sql.includes(tag)) throw new Error(`${m.file} contient ${tag}`);
  out.push(`-- -----------------------------------------------------------------------------
-- Migration ${m.file}
-- -----------------------------------------------------------------------------
do $install$
declare applied text;
begin
  select checksum into applied from schema_migrations where version = '${m.version}';
  if applied is null then
    execute ${tag}
${m.sql.trim()}
${tag};
    insert into schema_migrations (version, name, checksum) values ('${m.version}', '${m.name}', '${m.checksum}');
    raise notice 'Migration ${m.file} appliquée.';
  elsif applied <> '${m.checksum}' then
    raise exception 'La migration ${m.file} a été modifiée après application : rien n''a été changé.';
  else
    raise notice 'Migration ${m.file} déjà appliquée.';
  end if;
end
$install$;
`);
}

out.push(`-- -----------------------------------------------------------------------------
-- Contenu de départ (modifiable ensuite dans l'espace administrateur).
-- « on conflict do nothing » : un élément déjà présent n'est jamais modifié.
-- -----------------------------------------------------------------------------`);
for (const st of seedStatements()) out.push(inline(st) + ';');

out.push(`
commit;

-- Vérification : doit afficher les migrations 001 à ${migrations.at(-1).version}.
select version, name, applied_at from schema_migrations order by version;

-- -----------------------------------------------------------------------------
-- Administrateur : créez d'abord le compte sur le site (bouton « Inscription »,
-- ou « S'inscrire avec Google »), puis exécutez, avec la bonne adresse :
--
--   update users set role = 'admin' where lower(email) = lower('emanprod3@gmail.com');
--
-- (équivalent de « npm run db:admin -- emanprod3@gmail.com »)
-- -----------------------------------------------------------------------------
`);

const file = join(root, 'db/install-neon.sql');
writeFileSync(file, out.join('\n'));
console.log(`✔ db/install-neon.sql écrit : ${migrations.length} migrations, ${seedStatements().length} éléments de contenu de départ.`);
