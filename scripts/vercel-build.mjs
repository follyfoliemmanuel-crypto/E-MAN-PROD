// Build Vercel : rien à faire à la main après une configuration.
//   1. Mise en production (VERCEL_ENV=production) avec DATABASE_URL : migrations en attente et
//      contenu de départ appliqués automatiquement (même code que npm run db:migrate ; Neon
//      garde l'historique pour revenir en arrière). En cas d'erreur, le build échoue et la
//      version en ligne précédente reste active : le site n'est jamais cassé à moitié.
//      Les déploiements de prévisualisation ne touchent jamais la base.
//   2. Build du site, puis pages prérendues (titres, aperçus, sitemap).
import { execSync } from 'node:child_process';

const run = (cmd) => execSync(cmd, { stdio: 'inherit', env: process.env });
if (process.env.VERCEL_ENV === 'production' && process.env.DATABASE_URL) {
  console.log('Base de données : application des migrations en attente…');
  run('node scripts/db.mjs migrate --no-backup');
} else if (process.env.VERCEL_ENV === 'production') {
  console.log('⚠ DATABASE_URL absente : base non mise à jour (le site public fonctionne, pas les comptes).');
} else {
  console.log(`Déploiement « ${process.env.VERCEL_ENV || 'local'} » : base non modifiée.`);
}
run('npx vite build');
run('node scripts/prerender-meta.mjs');
