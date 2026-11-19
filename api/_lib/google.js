// Connexion Google (OpenID Connect, « authorization code » + PKCE), sans dépendance.
//
// 1. /api/auth/google          : crée state + nonce + code_verifier (gardés en base, 10 min,
//                                usage unique), pose le cookie de state, redirige vers Google.
// 2. /api/auth/google-callback : vérifie le state (URL = cookie = base), échange le code
//                                (avec le secret et le code_verifier), vérifie la signature du
//                                jeton d'identité (clés publiques de Google), puis ses champs :
//                                émetteur, destinataire, expiration, nonce, e-mail vérifié.
//
// Liaison des comptes (adresse e-mail identique) :
//  - compte déjà lié à ce compte Google → connexion ;
//  - compte e-mail existant et confirmé → liaison ;
//  - compte e-mail existant mais JAMAIS confirmé → liaison, mais son mot de passe est retiré
//    et ses sessions fermées : quelqu'un a pu créer ce compte avec l'adresse d'autrui
//    (« pré-détournement ») ; la vraie propriétaire de l'adresse, prouvée par Google, garde la main ;
//  - aucun compte → création automatique, adresse marquée comme confirmée.
import { createHash, createPublicKey, verify as verifySig, randomBytes, timingSafeEqual } from 'node:crypto';
import { query, one } from './db.js';
import { HttpError, siteUrl, clientIp } from './http.js';
import { createSession, cookie, readCookie, appendCookie, logSecurity, maskEmail, rateLimit, sha256 } from './auth.js';

let ENDPOINTS = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
};
/** Réservé aux tests automatisés (faux serveur Google). */
export function __setGoogleEndpointsForTests(e) {
  ENDPOINTS = { ...ENDPOINTS, ...e };
  jwksCache = null;
}

export const googleConfigured = (env = process.env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const STATE_COOKIE = 'emp_oauth_state';
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Adresse de retour déclarée dans Google Cloud Console (une par environnement). */
export const redirectUri = (req) => process.env.GOOGLE_REDIRECT_URI || `${siteUrl(req)}/api/auth/google-callback`;

/** Après connexion, on ne renvoie que vers une page du site (jamais vers un autre domaine). */
const safeReturn = (v) => (typeof v === 'string' && /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/.test(v) && v.length <= 200 ? v : '/espace');

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export async function startGoogle(req, res) {
  // Cette adresse est ouverte par un simple lien (navigation) : en cas de refus, on
  // revient sur le site avec un message lisible plutôt qu'une page d'erreur JSON.
  if (!googleConfigured()) return redirect(res, '/espace?connexion=google-indisponible');
  try {
    await rateLimit(`google:ip:${clientIp(req)}`, 30, 15);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) return redirect(res, '/espace?connexion=google-limite');
    throw e;
  }
  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  await query(
    'insert into oauth_states (state_hash, nonce, code_verifier, return_to) values ($1, $2, $3, $4) returning state_hash',
    [sha256(state), nonce, verifier, safeReturn(req.query?.return)],
  );
  appendCookie(res, cookie(req, STATE_COOKIE, state, 600, { path: '/api/auth' }));
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  redirect(res, `${ENDPOINTS.authorize}?${params}`);
}

let jwksCache = null;
async function googleKey(kid) {
  if (!jwksCache || jwksCache.expires < Date.now() || !jwksCache.keys[kid]) {
    const r = await fetch(ENDPOINTS.jwks);
    if (!r.ok) throw new Error(`clés Google indisponibles (${r.status})`);
    const { keys } = await r.json();
    jwksCache = { expires: Date.now() + 3600e3, keys: Object.fromEntries(keys.map((k) => [k.kid, k])) };
  }
  const jwk = jwksCache.keys[kid];
  if (!jwk || jwk.kty !== 'RSA') throw new Error('clé de signature inconnue');
  return createPublicKey({ key: jwk, format: 'jwk' });
}

/** Vérifie le jeton d'identité : signature RS256 puis champs obligatoires. */
export async function verifyIdToken(idToken, { audience, nonce, now = Date.now() }) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('jeton mal formé');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (header.alg !== 'RS256') throw new Error(`algorithme refusé (${header.alg})`);
  const ok = verifySig('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), await googleKey(header.kid), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('signature invalide');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  const t = Math.floor(now / 1000);
  if (!ENDPOINTS.issuers.includes(c.iss)) throw new Error('émetteur inattendu');
  if (c.aud !== audience && !(Array.isArray(c.aud) && c.aud.includes(audience))) throw new Error('jeton destiné à une autre application');
  if (!(c.exp > t - 60)) throw new Error('jeton expiré');
  if (c.iat && c.iat > t + 300) throw new Error('jeton daté dans le futur');
  const a = Buffer.from(String(c.nonce || ''));
  const b = Buffer.from(nonce);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('nonce différent');
  if (!c.sub) throw new Error('identifiant Google manquant');
  if (!c.email || c.email_verified !== true) throw new Error('adresse e-mail Google non vérifiée');
  return c;
}

/** Trouve, relie ou crée le compte correspondant au profil Google. */
export async function accountForGoogle(req, profile) {
  const email = String(profile.email).toLowerCase();
  const linked = await one(
    `select u.id, u.disabled_at from accounts a join users u on u.id = a.user_id where a.provider = 'google' and a.provider_account_id = $1`,
    [profile.sub],
  );
  if (linked) {
    if (linked.disabled_at) throw new Error('compte désactivé');
    await query(`update accounts set last_login_at = now(), email = $2 where provider = 'google' and provider_account_id = $1 returning id`, [profile.sub, email]);
    return { userId: linked.id, created: false, linked: false };
  }
  const existing = await one('select id, email_verified_at, disabled_at from users where lower(email) = $1', [email]);
  if (existing) {
    if (existing.disabled_at) throw new Error('compte désactivé');
    const preHijack = !existing.email_verified_at;
    if (preHijack) {
      await query('update users set email_verified_at = now(), password_hash = null where id = $1 returning id', [existing.id]);
      await query('delete from sessions where user_id = $1 returning id', [existing.id]);
    }
    await query(
      `insert into accounts (user_id, provider, provider_account_id, email, last_login_at) values ($1, 'google', $2, $3, now()) returning id`,
      [existing.id, profile.sub, email],
    );
    await logSecurity(req, 'auth.google_linked', { userId: existing.id, data: { email: maskEmail(email), unverified_account_secured: preHijack } });
    return { userId: existing.id, created: false, linked: true };
  }
  const first = String(profile.given_name || '').trim().slice(0, 60) || null;
  const last = String(profile.family_name || '').trim().slice(0, 60) || null;
  const full = String(profile.name || [first, last].filter(Boolean).join(' ') || email.split('@')[0]).trim().slice(0, 120);
  const user = await one(
    `insert into users (email, password_hash, full_name, first_name, last_name, email_verified_at)
     values ($1, null, $2, $3, $4, now()) returning id`,
    [email, full.length >= 2 ? full : email, first, last],
  );
  await query(
    `insert into accounts (user_id, provider, provider_account_id, email, last_login_at) values ($1, 'google', $2, $3, now()) returning id`,
    [user.id, profile.sub, email],
  );
  await logSecurity(req, 'auth.signup', { userId: user.id, data: { method: 'google', email: maskEmail(email) } });
  await (await import('./services/clients.js')).announceClient({ id: user.id, full_name: full, email }, 'Google');
  return { userId: user.id, created: true, linked: false };
}

export async function googleCallback(req, res, { onLogin } = {}) {
  const q = req.query || {};
  const fail = async (reason, data = {}, code = 'google-echec') => {
    await logSecurity(req, 'auth.google_failed', { data: { reason, ...data } });
    appendCookie(res, cookie(req, STATE_COOKIE, '', 0, { path: '/api/auth' }));
    redirect(res, `/espace?connexion=${code}`);
  };
  if (!googleConfigured()) return fail('non configuré', {}, 'google-indisponible');
  if (q.error) return fail('refus ou annulation sur Google', { error: String(q.error).slice(0, 60) }, q.error === 'access_denied' ? 'google-annule' : 'google-echec');
  const cookieState = readCookie(req, STATE_COOKIE);
  const a = Buffer.from(String(q.state || ''));
  const b = Buffer.from(String(cookieState || ''));
  // Le state de l'adresse doit être celui posé dans CE navigateur : un lien préparé par un tiers échoue.
  if (!q.state || !cookieState || a.length !== b.length || !timingSafeEqual(a, b)) return fail('state absent ou différent');
  const saved = await one(
    `delete from oauth_states where state_hash = $1 and created_at > now() - interval '10 minutes' returning nonce, code_verifier, return_to`,
    [sha256(String(q.state))],
  );
  if (!saved) return fail('state expiré ou déjà utilisé');
  if (!q.code) return fail('code absent');

  let profile;
  try {
    const r = await fetch(ENDPOINTS.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(q.code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
        code_verifier: saved.code_verifier,
      }),
    });
    const tokens = await r.json().catch(() => ({}));
    if (!r.ok || !tokens.id_token) throw new Error(`échange du code refusé (${r.status} ${tokens.error || ''})`.trim());
    profile = await verifyIdToken(tokens.id_token, { audience: process.env.GOOGLE_CLIENT_ID, nonce: saved.nonce });
  } catch (err) {
    return fail(err.message);
  }

  let result;
  try {
    result = await accountForGoogle(req, profile);
  } catch (err) {
    return fail(err.message, { email: maskEmail(profile.email) });
  }
  await createSession(req, res, result.userId, { method: 'google' });
  await query('update users set last_login_at = now() where id = $1 returning id', [result.userId]);
  await logSecurity(req, 'auth.login', { userId: result.userId, data: { method: 'google', created: result.created, linked: result.linked } });
  if (onLogin) await onLogin(result.userId);
  appendCookie(res, cookie(req, STATE_COOKIE, '', 0, { path: '/api/auth' }));
  const back = saved.return_to + (saved.return_to.includes('?') ? '&' : '?') + 'connexion=google';
  redirect(res, back);
}
