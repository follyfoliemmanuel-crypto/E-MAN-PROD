// Sort de la base la paire de clés VAPID créée automatiquement, pour la mettre dans Vercel
// SANS désabonner les appareils (c'est la même paire).
//   npm run push:export-keys
// Copiez les 3 lignes dans Vercel (Production), puis Redeploy : au premier envoi, le site
// constate que les clés sont dans Vercel et efface la copie gardée dans Neon.
// Ne publiez jamais VAPID_PRIVATE_KEY.
import { connectDb, loadEnv } from './lib/env.mjs';

loadEnv();
import { vapidSubject } from '../api/_lib/push.js';

const { client, db } = await connectDb();
const [row] = await db.rows('select public_key, private_key from push_keys where id = 1');
await client.end();
if (!row) {
  console.log('Aucune clé en base : soit elles sont déjà dans Vercel, soit aucune n’a encore été créée.');
  console.log('Pour en créer : npm run push:keys');
  process.exit(0);
}
console.log(`VAPID_PUBLIC_KEY=${row.public_key}`);
console.log(`VAPID_PRIVATE_KEY=${row.private_key}`);
console.log(`VAPID_SUBJECT=${vapidSubject()}`);
console.log('\nCopiez ces lignes dans Vercel → Settings → Environment Variables, puis Redeploy.');
console.log('La copie en base sera effacée automatiquement au premier envoi de notification.');
