// Authentification, stockée dans Neon. Tout est vérifié côté serveur :
// - mots de passe hachés avec Argon2id (natif dans Node 24), les anciens hachages
//   scrypt sont remplacés automatiquement à la connexion suivante ;
// - sessions par cookie HttpOnly, renouvelées toutes les 24 h, révocables ;
// - rôles ADMIN / STAFF / CLIENT lus en base à chaque requête, jamais fournis par le navigateur.
import crypto, { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { query, one } from './db.js';
import { HttpError, isHttps, clientIp } from './http.js';

const scryptAsync = promisify(scrypt);
const argon2Async = crypto.argon2 ? promisify(crypto.argon2) : null;

// --- Mots de passe -------------------------------------------------------------
// Réglages Argon2id recommandés par l'OWASP : 19 Mio de mémoire, 2 passes, 1 fil.
export const ARGON2 = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
const b64 = (buf) => buf.toString('base64').replace(/=+$/, '');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  if (argon2Async) {
    const tag = await argon2Async('argon2id', { message: password, nonce: salt, ...ARGON2 });
    // Format standard « PHC », lisible par toutes les bibliothèques Argon2.
    return `$argon2id$v=19$m=${ARGON2.memory},t=${ARGON2.passes},p=${ARGON2.parallelism}$${b64(salt)}$${b64(tag)}`;
  }
  // Repli si le serveur tourne sur un Node trop ancien (< 24.7) : scrypt, lui aussi résistant.
  const key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string') return false;
  if (stored.startsWith('$argon2id$')) {
    if (!argon2Async) throw new Error('Argon2id indisponible : le serveur doit tourner sous Node.js 24.7 ou plus.');
    const m = stored.match(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/);
    if (!m) return false;
    const expected = Buffer.from(m[5], 'base64');
    const tag = await argon2Async('argon2id', {
      message: password, nonce: Buffer.from(m[4], 'base64'), memory: +m[1], passes: +m[2], parallelism: +m[3], tagLength: expected.length,
    });
    return timingSafeEqual(tag, expected);
  }
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(key, expected);
}

/** Le hachage doit-il être refait (ancien algorithme ou anciens réglages) ? */
export const needsRehash = (stored) =>
  Boolean(argon2Async) && stored !== null && !String(stored).startsWith(`$argon2id$v=19$m=${ARGON2.memory},t=${ARGON2.passes},p=${ARGON2.parallelism}$`);

// Hachage factice : même temps de réponse quand le compte n'existe pas.
let dummyHash;
export async function dummyVerify(password) {
  dummyHash ||= await hashPassword('mot-de-passe-factice-0');
  await verifyPassword(String(password || ''), dummyHash);
  return false;
}

// Mots de passe parmi les plus utilisés (liste courte : les variantes évidentes sont aussi refusées).
const COMMON = new Set(['motdepasse', 'motdepasse1', 'motdepasse123', 'password', 'password1', 'password123', 'azerty', 'azertyuiop',
  'azerty123', 'qwerty', 'qwertyuiop', '123456789', '1234567890', '12345678910', '0123456789', 'abcdefghij', 'iloveyou', 'bonjour123',
  'soleil123', 'loulou123', 'doudou123', 'chocolat', 'football', 'jesus12345', 'jesuschrist', 'lomelome', 'togo123456', 'togolais',
  'emanprod', 'eman-prod', 'emanprod123', 'administrateur', 'admin12345', 'welcome123', 'bienvenue', 'bienvenue1', 'changeme', '0000000000',
  '1111111111', 'aaaaaaaaaa', 'abc123456', 'passw0rd', 'p@ssw0rd', 'motdepass', 'secret123']);

/** Règles du mot de passe (NIST / ANSSI) : longueur, pas de mot de passe courant, pas l'adresse e-mail. */
export function checkPassword(password, { email = '', name = '' } = {}) {
  const pw = typeof password === 'string' ? password : '';
  if (pw.length < 10) throw new HttpError(400, 'Mot de passe : 10 caractères minimum.');
  if (pw.length > 128) throw new HttpError(400, 'Mot de passe : 128 caractères maximum.');
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[\d!@#$%^&*.]+$/, ''))) {
    throw new HttpError(400, 'Ce mot de passe est trop courant. Choisissez une phrase ou une combinaison plus personnelle.');
  }
  if (/^(.)\1+$/.test(pw)) throw new HttpError(400, 'Mot de passe trop simple.');
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) throw new HttpError(400, 'Le mot de passe ne doit pas contenir votre adresse e-mail.');
  for (const part of String(name).toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) throw new HttpError(400, 'Le mot de passe ne doit pas contenir votre nom.');
  }
  return pw;
}

export const sha256 = (v) => createHash('sha256').update(v).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
/** Empreinte de l'adresse IP pour le journal (on ne garde pas l'adresse elle-même). */
export const ipHash = (req) => sha256(`${clientIp(req)}|${process.env.AUTH_SECRET || 'eman-prod-journal'}`).slice(0, 16);

// --- Cookies ---------------------------------------------------------------------
// En HTTPS, le préfixe « __Host- » oblige le navigateur à n'accepter ce cookie que s'il
// est Secure, sur tout le site (Path=/) et sans domaine partagé avec d'autres sous-domaines.
const COOKIE_DEV = 'emp_session';
const COOKIE_PROD = '__Host-emp_session';
const secureContext = (req) => isHttps(req) || process.env.VERCEL_ENV === 'production';
const cookieName = (req) => (secureContext(req) ? COOKIE_PROD : COOKIE_DEV);

export function cookie(req, name, value, maxAge, { path = '/' } = {}) {
  return [`${name}=${value}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, secureContext(req) ? 'Secure' : null]
    .filter(Boolean).join('; ');
}

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Ajoute un Set-Cookie sans effacer ceux déjà posés dans la réponse. */
export function appendCookie(res, value) {
  const prev = res.getHeader?.('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, value) : value);
}

const sessionToken = (req) => readCookie(req, cookieName(req)) || readCookie(req, COOKIE_DEV);

// --- Sessions ------------------------------------------------------------------------
export const SESSION = { maxDays: 30, idleDays: 14, rotateHours: 24, graceSeconds: 60, perUser: 10 };

/**
 * Adresse(s) de l'administrateur propriétaire : ADMIN_EMAILS (séparées par des virgules),
 * par défaut l'adresse professionnelle d'E-MAN PROD.
 */
export const ownerEmails = () => (process.env.ADMIN_EMAILS || 'emanprod3@gmail.com')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

/**
 * Le compte d'E-MAN PROD devient administrateur à sa connexion, décidé par le serveur
 * uniquement, et SEULEMENT si l'adresse est prouvée : confirmée par Google, par le lien de
 * confirmation reçu par e-mail ou par une réinitialisation du mot de passe. Quelqu'un qui
 * s'inscrit avec cette adresse sans en avoir la boîte reste un simple client non confirmé.
 */
export async function promoteOwner(req, userId) {
  const owners = ownerEmails();
  if (!owners.length) return;
  const row = await one(
    `update users set role = 'admin' where id = $1 and role <> 'admin' and email_verified_at is not null
       and disabled_at is null and lower(email) = any($2::text[]) returning id, email`,
    [userId, owners],
  );
  if (row) await logSecurity(req, 'auth.owner_promoted', { userId, role: 'admin', data: { email: maskEmail(row.email) } });
}

export async function createSession(req, res, userId, { method = 'password' } = {}) {
  await promoteOwner(req, userId);
  const token = newToken();
  await query(
    `insert into sessions (token_hash, user_id, expires_at, user_agent, ip_hash, method)
     values ($1, $2, now() + ($3 || ' days')::interval, $4, $5, $6) returning id`,
    [sha256(token), userId, String(SESSION.maxDays), String(req.headers['user-agent'] || '').slice(0, 300) || null, ipHash(req), method],
  );
  // Au plus 10 sessions par compte : les plus anciennes sont fermées.
  await query(
    `delete from sessions where user_id = $1 and id not in (
       select id from sessions where user_id = $1 order by created_at desc limit $2) returning id`,
    [userId, SESSION.perUser],
  );
  appendCookie(res, cookie(req, cookieName(req), token, SESSION.maxDays * 86400));
  // Réutilisation dans la même requête.
  req.__user = undefined;
}

export async function destroySession(req, res) {
  const token = sessionToken(req);
  let userId = null;
  if (token) {
    const row = await one('delete from sessions where token_hash = $1 or previous_token_hash = $1 returning user_id', [sha256(token)]);
    userId = row?.user_id ?? null;
  }
  appendCookie(res, cookie(req, cookieName(req), '', 0));
  if (cookieName(req) !== COOKIE_DEV) appendCookie(res, cookie(req, COOKIE_DEV, '', 0));
  return userId;
}

const USER_COLS = `u.id, u.email, u.full_name, u.first_name, u.last_name, u.phone, u.role, u.permissions,
  u.email_verified_at, u.disabled_at, u.avatar_file_id, (u.password_hash is not null) as has_password`;

/**
 * Utilisateur connecté, ou null. Vérifie l'expiration (30 jours), l'inactivité (14 jours),
 * le compte désactivé, et renouvelle le jeton toutes les 24 h.
 */
export async function currentUser(req) {
  if (req.__user !== undefined) return req.__user;
  const token = sessionToken(req);
  if (!token) return (req.__user = null);
  const hash = sha256(token);
  const row = await one(
    `select ${USER_COLS}, s.id as session_id, (s.token_hash = $1) as is_current,
            (s.rotated_at < now() - ($2 || ' hours')::interval) as rotate_due,
            (s.last_seen_at < now() - interval '5 minutes') as touch_due
       from sessions s join users u on u.id = s.user_id
      where (s.token_hash = $1 or (s.previous_token_hash = $1 and s.rotated_at > now() - ($3 || ' seconds')::interval))
        and s.expires_at > now()
        and s.last_seen_at > now() - ($4 || ' days')::interval
        and u.disabled_at is null`,
    [hash, String(SESSION.rotateHours), String(SESSION.graceSeconds), String(SESSION.idleDays)],
  );
  if (!row) return (req.__user = null);
  const { is_current: isCurrent, rotate_due: rotateDue, touch_due: touchDue, ...user } = row;
  if (isCurrent && rotateDue && req.res) {
    // Renouvellement : nouveau jeton, l'ancien reste valable 60 secondes.
    const fresh = newToken();
    const done = await one(
      `update sessions set previous_token_hash = token_hash, token_hash = $2, rotated_at = now(), last_seen_at = now()
        where token_hash = $1 returning id`,
      [hash, sha256(fresh)],
    );
    if (done) appendCookie(req.res, cookie(req, cookieName(req), fresh, SESSION.maxDays * 86400));
  } else if (touchDue) {
    await query('update sessions set last_seen_at = now() where id = $1 returning id', [user.session_id]);
  }
  return (req.__user = user);
}

export async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Connectez-vous pour continuer.');
  return user;
}

// --- Rôles et permissions ---------------------------------------------------------------
/** Permissions qu'un administrateur peut accorder à un membre STAFF. */
export const PERMISSIONS = {
  quotes: 'Devis et messages des devis',
  orders: 'Commandes',
  trainings: 'Formations, sessions et inscriptions',
  content: 'Contenu du site : prestations, réalisations, images, avis',
  clients: 'Fiches clients (lecture et notes)',
  support: 'Assistance : messages des clients',
};

/** Droit d'un utilisateur : l'admin a tout, le staff ce qui lui a été accordé, le client rien. */
export function can(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'staff' && Array.isArray(user.permissions) && user.permissions.includes(permission);
}

async function denied(req, user, what) {
  await logSecurity(req, 'security.forbidden', { userId: user.id, role: user.role, data: { what, path: String(req.url || '').split('?')[0] } });
  throw new HttpError(403, 'Accès réservé : votre compte n’a pas ce droit.');
}

export async function requirePermission(req, permission) {
  const user = await requireUser(req);
  if (!can(user, permission)) await denied(req, user, permission);
  return user;
}

export async function requireAdmin(req) {
  const user = await requireUser(req);
  if (user.role !== 'admin') await denied(req, user, 'admin');
  return user;
}

export const publicUser = (u) =>
  u && {
    id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name ?? null, last_name: u.last_name ?? null,
    phone: u.phone, role: u.role,
    // Affichage seulement : chaque action est revérifiée par le serveur.
    permissions: u.role === 'admin' ? Object.keys(PERMISSIONS) : u.role === 'staff' ? u.permissions || [] : [],
    email_verified: Boolean(u.email_verified_at), has_password: u.has_password ?? Boolean(u.password_hash),
    avatar_file_id: u.avatar_file_id ?? null,
  };

// --- Journal des évènements sensibles ---------------------------------------------------------
export async function logSecurity(req, action, { userId = null, role = null, data = {} } = {}) {
  await query(
    `insert into activity_logs (actor_id, actor_role, action, entity_type, entity_id, data)
     values ($1, $2, $3, 'user', $4, $5::jsonb) returning id`,
    [userId, role || (userId ? 'client' : 'guest'), action, userId || 'anonyme',
      JSON.stringify({ ...data, ip: ipHash(req), ua: String(req.headers['user-agent'] || '').slice(0, 120) })],
  ).catch((err) => console.error('journal', err));
}

/** a***@domaine.tg : assez pour enquêter, sans copier l'adresse complète dans le journal. */
export const maskEmail = (e) => String(e || '').replace(/^(.)[^@]*(@.*)$/, '$1***$2');

/**
 * Limitation anti-abus : au plus `max` évènements par `bucket` sur `minutes`.
 */
export async function rateLimit(bucket, max, minutes, message = 'Trop de tentatives. Réessayez dans quelques minutes.') {
  const [{ n }] = await query(
    `select count(*)::int as n from rate_events where bucket = $1 and created_at > now() - ($2 || ' minutes')::interval`,
    [bucket, String(minutes)],
  );
  if (n >= max) throw new HttpError(429, message);
  await query('insert into rate_events (bucket) values ($1) returning bucket', [bucket]);
  if (Math.random() < 0.02) {
    await query(`delete from rate_events where created_at < now() - interval '2 days' returning bucket`);
    await query(`delete from oauth_states where created_at < now() - interval '1 hour' returning state_hash`);
    await query(`delete from sessions where expires_at < now() or last_seen_at < now() - ($1 || ' days')::interval returning id`, [String(SESSION.idleDays)]);
  }
}

/** Lien à usage unique (confirmation d'e-mail, réinitialisation, invitation). Le précédent du même type est annulé. */
export async function issueToken(userId, kind, hours) {
  const token = newToken();
  await query(`update verification_tokens set used_at = now() where user_id = $1 and kind = $2 and used_at is null returning kind`, [userId, kind]);
  await query(
    `insert into verification_tokens (token_hash, user_id, kind, expires_at) values ($1, $2, $3, now() + ($4 || ' hours')::interval) returning kind`,
    [sha256(token), userId, kind, String(hours)],
  );
  return token;
}
