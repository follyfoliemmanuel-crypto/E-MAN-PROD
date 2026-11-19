// /api/auth/:action — comptes et connexion.
//   GET  me                          utilisateur connecté (+ modes de connexion disponibles)
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
} from '../_lib/auth.js';
import { googleConfigured, startGoogle, googleCallback } from '../_lib/google.js';
import { sendMail, mailConfigured } from '../_lib/mail.js';
import { mySessions, revokeMine } from '../_lib/services/security.js';
import * as v from '../_lib/validate.js';
import { claimGuestRequests, announceClient } from '../_lib/services/clients.js';

const actionOf = (req) => req.query?.action || new URL(req.url, 'http://x').pathname.split('/').pop();
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
    send(res, 200, { user: publicUser(await currentUser(req)), mail: mailConfigured() || devMail(), google: googleConfigured() });
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
    const exists = await one('select id from users where lower(email) = $1', [email]);
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
      await rateLimit(`login:email:${email}`, 8, 15, 'Trop de tentatives pour ce compte. Réessayez dans 15 minutes, ou utilisez « Mot de passe oublié ».');
      await rateLimit(`login:ip:${clientIp(req)}`, 30, 15);
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
    const user = await one('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1 returning *', [userId]);
    await logSecurity(req, 'auth.email_verified', { userId });
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
    if (!fn || name === 'me' || name === 'sessions') throw new HttpError(404, 'Action inconnue.');
    return fn(req, res);
  },
});
