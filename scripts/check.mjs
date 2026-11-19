// Diagnostic de configuration : npm run check
// 1. Lit .env exactement comme l'application et repère les erreurs courantes.
// 2. Teste réellement chaque service : base Neon, e-mails (Resend/Brevo), Google, Cloudinary.
// 3. Interroge le site EN LIGNE (SITE_URL/api/auth/status) : ce que Vercel voit vraiment.
//    Rappel : le fichier .env n'est pas envoyé à Vercel ; les variables se saisissent dans
//    Vercel → Settings → Environment Variables, puis « Redeploy ».
// Aucun secret n'est affiché.
import { loadEnv } from './lib/env.mjs';

loadEnv();
const env = process.env;
let problems = 0;
const ok = (m) => console.log('  ✔ ' + m);
const bad = (m, fix) => { problems += 1; console.log('  ✖ ' + m + (fix ? `\n      → ${fix}` : '')); };
const info = (m) => console.log('  · ' + m);
const timeout = (ms) => AbortSignal.timeout(ms);

console.log('\nVariables (.env)');
for (const [k, v] of Object.entries(env)) {
  if (!/^(DATABASE_URL|SITE_URL|MAIL_|RESEND_|BREVO_|GOOGLE_|CLOUDINARY_|AUTH_SECRET|ADMIN_EMAILS)/.test(k)) continue;
  if (v !== v.trim()) bad(`${k} contient des espaces au début ou à la fin`, 'retirez-les');
  if (/^["'].*["']$/.test(v) && v.length > 1 && v[0] === v.at(-1)) info(`${k} entre guillemets : accepté en local, mais ne mettez PAS les guillemets dans Vercel`);
}
const leaked = Object.keys(env).filter((k) => /^VITE_.*(SECRET|API_KEY|PASSWORD|DATABASE)/.test(k));
if (leaked.length) bad(`${leaked.join(', ')} commence par VITE_ : la valeur serait envoyée au navigateur`, 'retirez le préfixe VITE_');

console.log('\nBase de données (Neon)');
if (!env.DATABASE_URL) bad('DATABASE_URL absente', 'Neon → Connection string (Node.js), à coller telle quelle');
else if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) bad('DATABASE_URL ne commence pas par postgresql://', 'copiez la chaîne complète depuis Neon');
else {
  try {
    const { default: pg } = await import('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(env.DATABASE_URL);
    const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
    await c.connect();
    const { SCHEMA_VERSION } = await import('../api/_lib/version.js');
    const r = await c.query(`select max(version) as v from schema_migrations`).catch(() => ({ rows: [{ v: null }] }));
    const admins = await c.query(`select count(*)::int as n from users where role = 'admin'`).catch(() => ({ rows: [{ n: 0 }] }));
    await c.end();
    ok('connexion réussie');
    if (!r.rows[0].v) bad('base vide', 'lancez npm run db:migrate (ou db/install-neon.sql dans Neon) ; en ligne, le redéploiement le fait');
    else if (r.rows[0].v < SCHEMA_VERSION) bad(`base en version ${r.rows[0].v}, le code attend ${SCHEMA_VERSION}`, 'npm run db:migrate, ou redéployez');
    else ok(`base à jour (${r.rows[0].v})`);
    if (!admins.rows[0].n) info(`aucun administrateur pour l’instant : connectez-vous avec ${(env.ADMIN_EMAILS || 'emanprod3@gmail.com')} (Google, ou e-mail confirmé) et le compte le deviendra`);
    else ok(`${admins.rows[0].n} administrateur(s)`);
  } catch (e) {
    bad(`connexion impossible (${e.code || e.message.split('\n')[0]})`, e.code === 'ERR_MODULE_NOT_FOUND' ? 'lancez d’abord npm install' : 'vérifiez la chaîne Neon (mot de passe, ?sslmode=require) et votre connexion Internet');
  }
}

console.log('\nAdresse du site');
if (!env.SITE_URL) info('SITE_URL vide : en ligne, l’adresse de production Vercel sera utilisée');
else if (!/^https:\/\/[^/]+$/.test(env.SITE_URL.replace(/\/$/, '')) && !/localhost|127\.0\.0\.1/.test(env.SITE_URL)) bad(`SITE_URL « ${env.SITE_URL} » invalide`, 'format : https://www.votre-domaine.com (sans chemin)');
else ok(`SITE_URL = ${env.SITE_URL}`);

console.log('\nE-mails (inscription, mot de passe oublié)');
const provider = (env.MAIL_PROVIDER || (env.BREVO_API_KEY && !env.RESEND_API_KEY ? 'brevo' : 'resend')).toLowerCase();
const key = env.MAIL_API_KEY || (provider === 'brevo' ? env.BREVO_API_KEY : env.RESEND_API_KEY);
const from = env.MAIL_FROM || '';
const domain = from.replace(/.*@/, '').replace(/>.*/, '').trim().toLowerCase();
if (!key) bad('clé absente', 'MAIL_API_KEY=re_… (Resend → API Keys)');
if (!from) bad('MAIL_FROM absente', 'MAIL_FROM=E-MAN PROD <notifications@votre-domaine.com>');
else if (/^(gmail|yahoo|hotmail|outlook|live)\./.test(domain)) bad(`MAIL_FROM utilise ${domain}`, 'Resend refuse ces adresses comme expéditeur : utilisez une adresse de votre domaine vérifié (Gmail reste l’adresse de réponse, MAIL_REPLY_TO)');
if (key && provider === 'resend') {
  try {
    const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` }, signal: timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && /restricted/i.test(JSON.stringify(j))) ok('clé Resend valide (limitée à l’envoi : domaine non vérifiable ici)');
    else if (r.status === 401 || r.status === 403) bad('clé Resend refusée', 'recréez une clé dans Resend → API Keys');
    else if (r.ok) {
      const d = (j.data || []).find((x) => x.name === domain);
      if (!domain) {} else if (!d) bad(`domaine ${domain} absent du compte Resend`, 'Resend → Domains → Add domain, puis ajoutez les DNS indiqués');
      else if (d.status !== 'verified') bad(`domaine ${domain} : ${d.status}`, 'terminez la vérification DNS dans Resend → Domains');
      else ok(`clé valide, domaine ${domain} vérifié`);
    } else bad(`Resend répond ${r.status}`);
  } catch (e) { bad(`Resend injoignable (${e.message})`); }
} else if (key && provider === 'brevo') {
  try {
    const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': key }, signal: timeout(10000) });
    r.ok ? ok('clé Brevo valide') : bad(`clé Brevo refusée (${r.status})`);
  } catch (e) { bad(`Brevo injoignable (${e.message})`); }
}

console.log('\nConnexion Google');
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) bad('GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET absent', 'Google Cloud → Identifiants → ID client OAuth (application Web)');
else {
  if (!/\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID)) bad('GOOGLE_CLIENT_ID ne finit pas par .apps.googleusercontent.com', 'copiez l’« ID client » complet');
  else ok('identifiants présents');
  const site = (env.SITE_URL || 'https://<votre-domaine>').replace(/\/$/, '');
  info(`à déclarer dans Google Cloud : origine ${site} et URI de redirection ${env.GOOGLE_REDIRECT_URI || site + '/api/auth/google-callback'}`);
}

console.log('\nFichiers (Cloudinary)');
if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) bad('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY ou CLOUDINARY_API_SECRET absent', 'Cloudinary → Settings → API Keys');
else {
  try {
    const r = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/usage`, { headers: { Authorization: 'Basic ' + Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString('base64') }, signal: timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      ok(`compte « ${env.CLOUDINARY_CLOUD_NAME} » joint${j.plan ? `, offre ${j.plan}` : ''}`);
      const lim = j.media_limits || {};
      if (lim.raw_max_size_bytes) info(`taille max : images ${Math.round(lim.image_max_size_bytes / 1048576)} Mo, documents ${Math.round(lim.raw_max_size_bytes / 1048576)} Mo (CLOUDINARY_MAX_FILE_MB=${env.CLOUDINARY_MAX_FILE_MB || 10})`);
      info('test complet d’envoi/lecture/suppression : npm run storage:check');
    } else bad(`Cloudinary refuse les identifiants (${r.status})`, 'vérifiez le Cloud name, l’API Key et l’API Secret');
  } catch (e) { bad(`Cloudinary injoignable (${e.message})`); }
}

if (env.SITE_URL && !/localhost|127\.0\.0\.1/.test(env.SITE_URL)) {
  console.log(`\nSite en ligne (${env.SITE_URL}) : ce que le serveur Vercel voit vraiment`);
  try {
    const r = await fetch(env.SITE_URL.replace(/\/$/, '') + '/api/auth/status', { signal: timeout(15000) });
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) bad(`l’API ne répond pas (${r.status})`, 'le déploiement n’inclut pas les fonctions /api : vérifiez dans Vercel que la racine du projet est le dossier contenant package.json et api/');
    else {
      const s = await r.json();
      s.ok ? ok('tout est configuré en ligne') : s.to_fix.forEach((f) => bad(f));
      info(s.reminder || '');
    }
  } catch (e) { bad(`site injoignable (${e.message})`); }
}

console.log(problems ? `\n${problems} point(s) à corriger.` : '\nConfiguration correcte.');
process.exit(problems ? 1 : 0);
