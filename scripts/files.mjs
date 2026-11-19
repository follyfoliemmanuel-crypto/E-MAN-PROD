// Fichiers : sauvegarde indépendante, intégrité, restauration, migration des anciens fichiers.
// À lancer depuis un poste d'E-MAN PROD (jamais sur Vercel). Dossier de sauvegarde :
// --dossier "<chemin>" ou BACKUP_DIR dans .env (disque externe, NAS, dossier synchronisé).
//
//   npm run backup -- --dossier E:\Sauvegardes\emanprod   base Neon + fichiers (à planifier)
//   npm run files:backup -- --dossier …     fichiers seulement (copie incrémentale)
//   npm run files:check                     chaque fichier existe-t-il, avec la bonne taille ?
//   npm run files:check -- --deep           relit le contenu et compare l'empreinte SHA-256
//   npm run files:check -- --orphans        liste les fichiers Cloudinary sans ligne en base
//   npm run files:check -- --clean-orphans --yes   efface les orphelins de plus de 24 h
//   npm run files:check -- --cleanup        efface les envois abandonnés (plus de 24 h)
//   npm run files:restore -- --dossier …    restaure les fichiers introuvables
//   npm run files:restore -- --dossier … <id> <id>   restaure ces fichiers
//   npm run files:migrate                   simulation : anciens fichiers (s3, local) → Cloudinary
//   npm run files:migrate -- --apply        migration réelle, vérifiée ; originaux conservés
import { loadEnv, connectDb } from './lib/env.mjs';

loadEnv();
const [command, ...args] = process.argv.slice(2);
const flag = (f) => args.includes(f);
const option = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const dir = option('--dossier');
let conn;
try {
  conn = await connectDb();
  const ops = await import('./lib/files-ops.mjs');
  let failed = false;
  if (command === 'backup' || command === 'backup-all') {
    if (command === 'backup-all') failed = (await ops.backupDatabase(conn.db, { dir })).status !== 'ok';
    failed = (await ops.backupFiles({ dir })).status !== 'ok' || failed;
  } else if (command === 'check') {
    if (flag('--cleanup')) {
      const { cleanupPending } = await import('../api/_lib/services/files.js');
      const r = await cleanupPending({ id: null, role: 'system', name: 'tâche planifiée' });
      console.log(`Envois abandonnés : ${r.removed} effacé(s), ${r.kept} gardé(s) (fournisseur injoignable).`);
    }
    const r = await ops.checkIntegrity({ deep: flag('--deep'), orphans: flag('--orphans'), cleanOrphans: flag('--clean-orphans'), yes: flag('--yes') });
    failed = r.status !== 'ok';
  } else if (command === 'restore') {
    const ids = args.filter((a) => /^[0-9a-f-]{36}$/.test(a));
    failed = (await ops.restoreFiles({ dir, ids: ids.length ? ids : null })).failed > 0;
  } else if (command === 'migrate') {
    failed = (await ops.moveLegacy({ apply: flag('--apply') })).failed > 0;
  } else {
    console.error('Commande inconnue : backup, backup-all, check, restore ou migrate.');
    failed = true;
  }
  process.exitCode = failed ? 1 : 0;
} catch (err) {
  console.error('\n✖ ' + String(err.message).replace(/https?:\/\/\S+/g, '[adresse]') + '\n');
  process.exitCode = 1;
} finally {
  await conn?.client.end();
}
