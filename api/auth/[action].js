// /api/auth/:action — comptes et connexion.
//   GET  me                          utilisateur connecté (+ modes de connexion disponibles)
//   GET  status                      état du serveur après configuration (public, sans aucun secret)
//   GET  google                      démarrer la connexion avec Google
//   GET  google-callback             retour de Google
//   GET  sessions                    mes sessions ouvertes (appareils)
//   POST signup | login | logout
//   POST forgot | reset              mot de passe oublié / réinitialisation (lien par e-mail, 1 h)
//   POST verify | resend             confirmation de l'adresse e-mail (lien, 48 h)
//   POST password                    changer mon mot de passe (ou en créer un après Google)
//   POST revoke {id} | {others:true} fermer une session / toutes mes autres sessions
//   POST google-unlink               retirer la connexion Google (si un mot de passe existe)
import { query, one } from '../_lib/db.js';
import { handler, send, readJson, clientIp, siteUrl, HttpError } from '../_lib/http.js';
import {
  hashPassword, verifyPassword, needsRehash, dummyVerify, checkPassword, createSession, destroySession, currentUser,
  requireUser, publicUser, rateLimit, sha256, logSecurity, maskEmail, issueToken,
  promoteOwner,
} from '../_lib/auth.js';
import { googleConfigured, startGoogle, googleCallback, redirectUri } from '../_lib/google.js';
import { sendMail, mailConfigured, mailStatus } from '../_lib/mail.js';
import { SCHEMA_VERSION } from '../_lib/version.js';
import { mySessions, revokeMine } from '../_lib/services/security.js';
import * as v from '../_lib/validate.js';
import { claimGuestRequests, announceClient } from '../_lib/services/clients.js';

// « /api/auth/google/callback » (adresse souvent saisie dans Google Cloud) = « google-callback ».
const actionOf = (req) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/\/$/, '');
  if (path.endsWith('/google/callback')) return 'google-callback';
  return req.query?.action || path.split('/').pop();
};
// Sans service d'e-mails, en développement local, les liens s'affichent dans le terminal.
const devMail = () => !mailConfigured() && !process.env.VERCEL;

async function consumeToken(token, kind) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw new HttpError(400, 'Lien invalide.');
  const row = await one(
    `update verification_tokens set used_at = now()
      where token_hash = $1 and kind = $2 and used_at is null and expires_at > now()
      returning user_id`,
    [sha256(token), kind],
  );
  if (!row) throw new HttpError(400, 'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.');
  return row.user_id;
}

/** Envoie un modèle d'e-mail de compte. En local sans fournisseur, le lien s'affiche dans le terminal. */
async function deliver(req, { to, template, vars, link, userId }) {
  if (devMail()) {
    console.log(`\n[e-mail de développement : ${template}] À : ${to}\n${link}\n`);
    return 'terminal';
  }
  const { sendTemplate } = await import('../_lib/emails.js');
  return (await sendTemplate(template, { to, userId, vars, link })).status;
}

/** Renvoie le résultat réel : 'envoye', 'terminal' (local), 'echec' ou 'non_configure'. */
async function sendVerification(req, user) {
  if (!mailConfigured() && !devMail()) return 'non_configure';
  const token = await issueToken(user.id, 'verify', 48);
  const link = `${siteUrl(req)}/espace?verifier=${token}`;
  return deliver(req, { to: user.email, userId: user.id, template: 'account_verify', link, vars: { prenom: user.first_name || user.full_name } });
}

const nameField = (value, label) => v.text(value, label, { min: 1, max: 60, required: true }).replace(/\s+/g, ' ');

const actions = {
  async me(req, res) {
    const methods = { mail: mailConfigured() || devMail(), google: googleConfigured() };
    let user;
    try {
      user = await currentUser(req);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Base injoignable : on le dit clairement au lieu de faire comme si rien n'était configuré.
      console.error(JSON.stringify({ level: 'error', scope: 'database', message: String(err.message).replace(/postgres(ql)?:\/\/\S+/g, '[adresse]') }));
      return send(res, 503, { error: 'Le serveur ne joint pas la base de données : vérifiez DATABASE_URL (voir /api/auth/status).', database: false, ...methods });
    }
    send(res, 200, { user: publicUser(user), ...methods });
  },

  /**
   * Diagnostic après configuration : ce que le serveur EN LIGNE voit réellement (et non le
   * fichier .env du poste). Booléens et noms de variables seulement, jamais une valeur.
   */
  async status(req, res) {
    const env = process.env;
    const out = { checked_at: new Date().toISOString(), environment: env.VERCEL_ENV || (env.VERCEL ? 'vercel' : 'local'), site_url: siteUrl(req) };
    const fix = [];
    // Base de données
    {
      try {
        const rows = await query(`select max(version) as v, count(*)::int as n from schema_migrations`);
        out.database = { ok: true, schema: rows[0]?.v || null, expected: SCHEMA_VERSION };
        if ((rows[0]?.v || '') < SCHEMA_VERSION) fix.push(`Base pas à jour (${rows[0]?.v || 'vide'} au lieu de ${SCHEMA_VERSION}) : redéployez (mise à jour automatique) ou lancez db/install-neon.sql.`);
      } catch (err) {
        const m = String(err.message || '');
        const empty = /schema_migrations/.test(m) && /does not exist|n'existe pas/.test(m);
        out.database = { ok: empty, schema: empty ? null : undefined, expected: SCHEMA_VERSION };
        fix.push(empty ? 'Base vide : redéployez (création automatique) ou lancez db/install-neon.sql dans Neon.'
          : !env.DATABASE_URL ? 'DATABASE_URL absente du serveur.' : 'Connexion à la base impossible : vérifiez DATABASE_URL (chaîne Neon complète, avec ?sslmode=require).');
      }
    }
    const missing = (names) => names.filter((k) => !env[k]);
    // E-mails
    const mail = mailStatus();
    out.email = { ok: mail.configured, provider: mail.provider, from_domain: mail.from ? String(mail.from).replace(/.*@/, '').replace(/>.*/, '') : null };
    if (!mail.configured) fix.push(`E-mails : ${[!mail.key && 'MAIL_API_KEY (ou RESEND_API_KEY)', !mail.from && 'MAIL_FROM', !mail.provider_valid && 'MAIL_PROVIDER (resend ou brevo)'].filter(Boolean).join(', ')} manquant(s).`);
    else if (/@(gmail|yahoo|hotmail|outlook)\./i.test(mail.from || '')) fix.push('MAIL_FROM utilise une adresse Gmail/Yahoo/Outlook : Resend refuse ces expéditeurs. Utilisez une adresse de votre domaine vérifié (ex. notifications@emanprod.com).');
    // Google
    out.google = { ok: googleConfigured(), redirect_uri: googleConfigured() ? redirectUri(req) : null };
    if (!out.google.ok) fix.push(`Google : ${missing(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']).join(', ')} manquant(s).`);
    // Fichiers
    const { storageStatus } = await import('../_lib/storage.js');
    const st = storageStatus();
    out.files = { ok: st.active === 'cloudinary' || (!env.VERCEL && st.active === 'local'), provider: st.active };
    if (st.active !== 'cloudinary') fix.push(`Fichiers : ${st.cloudinary.missing.join(', ') || 'Cloudinary'} manquant(s)${env.VERCEL ? '' : ' (en local, dossier .uploads/ utilisé)'}.`);
    if (env.VERCEL && !env.SITE_URL) fix.push('SITE_URL absente : l’adresse de production Vercel est utilisée pour les liens des e-mails et Google.');
    // Variables mal nommées : une clé secrète préfixée VITE_ serait envoyée au navigateur.
    const exposed = Object.keys(env).filter((k) => /^VITE_.*(SECRET|KEY|PASSWORD|DATABASE)/.test(k));
    if (exposed.length) fix.push(`Attention : ${exposed.join(', ')} commence par VITE_ et serait visible dans le navigateur. Retirez le préfixe VITE_.`);
    out.ok = Boolean(out.database?.ok && out.email.ok && out.google.ok && out.files.ok);
    out.to_fix = fix;
    out.reminder = 'Une variable ajoutée dans Vercel ne s’applique qu’après « Redeploy ».';
    // En ligne, le détail (noms de variables, version du schéma, domaine d'envoi, adresse de
    // retour Google) n'est montré qu'à l'administrateur connecté : un visiteur ne voit que des oui/non.
    const viewer = out.database?.ok ? await currentUser(req).catch(() => null) : null;
    if (env.VERCEL && viewer?.role !== 'admin') {
      return send(res, 200, {
        checked_at: out.checked_at, ok: out.ok,
        database: { ok: Boolean(out.database?.ok) }, email: { ok: out.email.ok }, google: { ok: out.google.ok }, files: { ok: out.files.ok },
        detail: out.ok ? null : 'Connectez-vous avec le compte administrateur puis rouvrez cette adresse pour voir quoi corriger (ou consultez docs/CONFIGURATION.md).',
        reminder: out.reminder,
      });
    }
    send(res, 200, out);
  },

  async signup(req, res) {
    const body = await readJson(req);
    // Nom et prénom séparés ; « name » (ancien formulaire) reste accepté.
    let first = body.first_name ? nameField(body.first_name, 'Prénom') : null;
    let last = body.last_name ? nameField(body.last_name, 'Nom') : null;
    if (!first && !last) {
      const full = v.text(body.name, 'Nom et prénom', { min: 2, max: 120, required: true });
      [first, ...last] = full.split(/\s+/);
      last = last.join(' ') || null;
    }
    if (!first || !last) throw new HttpError(400, 'Indiquez votre prénom et votre nom.');
    const email = v.email(body.email, { required: true });
    const pw = checkPassword(body.password, { email, name: `${first} ${last}` });
    const phone = body.phone ? v.phone(body.phone) : null;
    await rateLimit(`signup:ip:${clientIp(req)}`, 10, 60);

    // Le rôle n'est jamais lu dans la requête : tout nouveau compte est « client ».
    const exists = await one('select id, first_name, full_name from users where lower(email) = $1', [email]);
    // Inscription sans révéler qui est inscrit : quand les e-mails fonctionnent, la réponse est la même
    // que l'adresse soit libre ou déjà prise. Le compte ne s'ouvre qu'avec le lien reçu dans la boîte
    // (preuve que l'adresse est à la personne) ; une adresse déjà inscrite reçoit un rappel de connexion.
    // (En développement sans fournisseur, le compte s'ouvre tout de suite pour faciliter les essais.)
    if (mailConfigured()) {
      const hash = await hashPassword(pw); // même travail dans les deux cas (pas de différence de durée)
      if (exists) {
        await deliver(req, { to: email, userId: exists.id, template: 'account_exists', link: `${siteUrl(req)}/espace?connexion=rappel`, vars: { prenom: exists.first_name || exists.full_name } });
        await logSecurity(req, 'auth.signup_existing', { userId: exists.id, data: { email: maskEmail(email) } });
        return send(res, 202, { pending: true });
      }
      const created = await one(
        `insert into users (email, password_hash, full_name, first_name, last_name, phone, password_changed_at)
         values ($1, $2, $3, $4, $5, $6, now())
         returning id, email, full_name, first_name, last_name, phone, role, permissions, email_verified_at, true as has_password`,
        [email, hash, `${first} ${last}`, first, last, phone],
      );
      await logSecurity(req, 'auth.signup', { userId: created.id, data: { method: 'password', email: maskEmail(email), pending: true } });
      const verification = await sendVerification(req, created);
      await announceClient(created, 'e-mail et mot de passe');
      return send(res, 202, { pending: true, ...(verification === 'terminal' ? { verification } : {}) });
    }
    // Sans fournisseur d'e-mails (aucun lien ne peut être envoyé) : ouverture immédiate du compte.
    if (exists) throw new HttpError(409, 'Un compte existe déjà avec cette adresse. Connectez-vous, ou utilisez « Mot de passe oublié ».');
    const user = await one(
      `insert into users (email, password_hash, full_name, first_name, last_name, phone, password_changed_at)
       values ($1, $2, $3, $4, $5, $6, now())
       returning id, email, full_name, first_name, last_name, phone, role, permissions, email_verified_at, true as has_password`,
      [email, await hashPassword(pw), `${first} ${last}`, first, last, phone],
    );
    await createSession(req, res, user.id);
    await logSecurity(req, 'auth.signup', { userId: user.id, data: { method: 'password', email: maskEmail(email) } });
    // « verificationSent » n'est vrai que si le fournisseur a accepté l'e-mail ; en local,
    // le lien est affiché dans le terminal (verification: 'terminal').
    const verification = await sendVerification(req, user);
    await announceClient(user, 'e-mail et mot de passe');
    send(res, 201, { user: publicUser(user), verificationSent: verification === 'envoye', verification });
  },

  async login(req, res) {
    const body = await readJson(req);
    const email = v.email(body.email, { required: true });
    const pw = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    try {
      // Limite par compte ET par connexion : un tiers qui essaie des mots de passe depuis son réseau
      // ne bloque plus le vrai titulaire, qui se connecte d'ailleurs. Un plafond large par compte
      // freine aussi les attaques réparties sur beaucoup d'adresses IP.
      await rateLimit(`login:email-ip:${email}|${clientIp(req)}`, 8, 15, 'Trop de tentatives pour ce compte. Réessayez dans 15 minutes, ou utilisez « Mot de passe oublié ».');
      await rateLimit(`login:ip:${clientIp(req)}`, 30, 15);
      await rateLimit(`login:email:${email}`, 60, 60, 'Trop de tentatives sur ce compte depuis des connexions différentes. Réessayez dans une heure, ou utilisez « Mot de passe oublié ».');
    } catch (err) {
      await logSecurity(req, 'security.rate_limited', { data: { what: 'login', email: maskEmail(email) } });
      throw err;
    }
    const user = await one('select * from users where lower(email) = $1', [email]);
    const ok = user?.password_hash ? await verifyPassword(pw, user.password_hash) : await dummyVerify(pw);
    if (!ok || user.disabled_at) {
      await logSecurity(req, 'auth.login_failed', { userId: user?.id ?? null, data: { email: maskEmail(email), reason: !user ? 'compte inconnu' : user.disabled_at && ok ? 'compte désactivé' : 'mot de passe' } });
      // Même message dans tous les cas : on ne révèle pas si le compte existe.
      throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
    }
    // Ancien hachage (scrypt) : remplacé par Argon2id maintenant que le mot de passe est connu.
    if (needsRehash(user.password_hash)) await query('update users set password_hash = $2 where id = $1 returning id', [user.id, await hashPassword(pw)]);
    await createSession(req, res, user.id);
    await query('update users set last_login_at = now() where id = $1 returning id', [user.id]);
    await logSecurity(req, 'auth.login', { userId: user.id, role: user.role, data: { method: 'password' } });
    send(res, 200, { user: publicUser(user) });
  },

  async logout(req, res) {
    const userId = await destroySession(req, res);
    if (userId) await logSecurity(req, 'auth.logout', { userId });
    send(res, 200, { ok: true });
  },

  async forgot(req, res) {
    const body = await readJson(req);
    const email = v.email(body.email, { required: true });
    await rateLimit(`forgot:email:${email}`, 3, 60);
    await rateLimit(`forgot:ip:${clientIp(req)}`, 10, 60);
    if (!mailConfigured() && !devMail()) return send(res, 200, { mail: false });
    const user = await one('select id, email, full_name, first_name, disabled_at from users where lower(email) = $1', [email]);
    if (user && !user.disabled_at) {
      const token = await issueToken(user.id, 'reset', 1);
      const link = `${siteUrl(req)}/espace?reinitialiser=${token}`;
      await deliver(req, { to: user.email, userId: user.id, template: 'password_reset', link, vars: { prenom: user.first_name || user.full_name } });
    }
    await logSecurity(req, 'auth.password_reset_requested', { userId: user?.id ?? null, data: { email: maskEmail(email), known: Boolean(user) } });
    // Même réponse que le compte existe ou non.
    send(res, 200, { mail: true });
  },

  async reset(req, res) {
    const body = await readJson(req);
    await rateLimit(`reset:ip:${clientIp(req)}`, 10, 60);
    const userId = await consumeToken(body.token, 'reset');
    const target = await one('select email, full_name, disabled_at from users where id = $1', [userId]);
    if (target.disabled_at) throw new HttpError(403, 'Ce compte est désactivé.');
    const pw = checkPassword(body.password, { email: target.email, name: target.full_name });
    // L'e-mail a été prouvé par le lien : on le marque comme vérifié.
    await query(
      `update users set password_hash = $2, password_changed_at = now(), email_verified_at = coalesce(email_verified_at, now()) where id = $1 returning id`,
      [userId, await hashPassword(pw)],
    );
    // Toutes les sessions ouvertes (peut-être par quelqu'un d'autre) sont fermées.
    await query('delete from sessions where user_id = $1 returning user_id', [userId]);
    await createSession(req, res, userId, { method: 'reset' });
    await logSecurity(req, 'auth.password_reset', { userId });
    const user = await one('select * from users where id = $1', [userId]);
    await claimGuestRequests(user);
    send(res, 200, { user: publicUser(user) });
  },

  async verify(req, res) {
    const body = await readJson(req);
    await rateLimit(`verify:ip:${clientIp(req)}`, 20, 60);
    const userId = await consumeToken(body.token, 'verify');
    const row = await one('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1 and disabled_at is null returning id', [userId]);
    if (!row) throw new HttpError(403, 'Ce compte est désactivé.');
    await logSecurity(req, 'auth.email_verified', { userId });
    // Le lien prouve que la boîte appartient à la personne : il ouvre sa session (inscription par e-mail).
    await createSession(req, res, userId, { method: 'verify' });
    // Adresse désormais prouvée : le compte d'E-MAN PROD devient administrateur.
    await promoteOwner(req, userId);
    const user = await one('select * from users where id = $1', [userId]);
    const claimed = await claimGuestRequests(user);
    send(res, 200, { user: publicUser(user), claimed });
  },

  async resend(req, res) {
    const user = await requireUser(req);
    if (user.email_verified_at) return send(res, 200, { verificationSent: false, alreadyVerified: true });
    await rateLimit(`resend:${user.id}`, 3, 60);
    const verification = await sendVerification(req, user);
    send(res, 200, { verificationSent: verification === 'envoye', verification });
  },

  /** Changer de mot de passe (l'ancien est exigé), ou en créer un pour un compte Google. */
  async password(req, res) {
    const user = await requireUser(req);
    const body = await readJson(req);
    await rateLimit(`password:${user.id}`, 5, 15);
    const row = await one('select password_hash from users where id = $1', [user.id]);
    if (row.password_hash && !(await verifyPassword(String(body.current_password || ''), row.password_hash))) {
      await logSecurity(req, 'auth.password_change_failed', { userId: user.id, role: user.role });
      throw new HttpError(400, 'Mot de passe actuel incorrect.');
    }
    const pw = checkPassword(body.new_password, { email: user.email, name: user.full_name });
    await query('update users set password_hash = $2, password_changed_at = now() where id = $1 returning id', [user.id, await hashPassword(pw)]);
    // Les autres appareils sont déconnectés ; celui-ci reçoit une nouvelle session.
    await query('delete from sessions where user_id = $1 returning id', [user.id]);
    await createSession(req, res, user.id);
    await logSecurity(req, 'auth.password_changed', { userId: user.id, role: user.role });
    send(res, 200, { ok: true });
  },

  async sessions(req, res) {
    const user = await requireUser(req);
    const google = await one(`select email, created_at from accounts where user_id = $1 and provider = 'google'`, [user.id]);
    send(res, 200, { sessions: await mySessions(req, user), google, has_password: user.has_password });
  },

  async revoke(req, res) {
    const user = await requireUser(req);
    const body = await readJson(req);
    if (body.others === true) return send(res, 200, await revokeMine(req, user, { others: true }));
    send(res, 200, await revokeMine(req, user, { id: v.uuid(body.id) }));
  },

  async 'google-unlink'(req, res) {
    const user = await requireUser(req);
    if (!user.has_password) throw new HttpError(409, 'Créez d’abord un mot de passe : sinon vous ne pourriez plus vous connecter.');
    const rows = await query(`delete from accounts where user_id = $1 and provider = 'google' returning id`, [user.id]);
    if (rows.length) await logSecurity(req, 'auth.google_unlinked', { userId: user.id, role: user.role });
    send(res, 200, { ok: true });
  },
};

const GET_ACTIONS = {
  me: actions.me,
  status: actions.status,
  sessions: actions.sessions,
  google: startGoogle,
  'google-callback': (req, res) => googleCallback(req, res, { onLogin: async (id) => claimGuestRequests(await one('select * from users where id = $1', [id])) }),
};

export default handler({
  async GET(req, res) {
    const fn = GET_ACTIONS[actionOf(req)];
    if (!fn) throw new HttpError(404, 'Action inconnue.');
    return fn(req, res);
  },
  async POST(req, res) {
    const name = actionOf(req);
    const fn = actions[name];
    if (!fn || name === 'me' || name === 'sessions' || name === 'status') throw new HttpError(404, 'Action inconnue.');
    return fn(req, res);
  },
});
