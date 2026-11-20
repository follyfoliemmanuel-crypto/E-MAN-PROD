// Génère une paire de clés VAPID pour les notifications push.
//   npm run push:keys
// Copiez les deux lignes dans Vercel (Settings → Environment Variables) puis redéployez.
// Facultatif : sans ces variables, le site crée lui-même une paire et la garde en base (table push_keys).
// Ne publiez jamais VAPID_PRIVATE_KEY (ni dans le code, ni dans une capture d'écran).
import { generateVapidKeys } from '../api/_lib/push.js';
const k = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('VAPID_SUBJECT=mailto:emanprod3@gmail.com');
console.log('\n⚠ Attention : changer de clés désabonne tous les appareils (chacun devra réactiver les notifications).');
