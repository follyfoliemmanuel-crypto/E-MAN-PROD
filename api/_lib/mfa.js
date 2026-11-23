// Double authentification (Google Authenticator, TOTP RFC 6238) et appareils de confiance.
//
// - Secret TOTP : 20 octets aléatoires, chiffré en base (AES-256-GCM). Montré UNE fois, pendant
//   l'activation (QR code + clé à saisir), jamais ensuite ; jamais dans une autre réponse d'API.
// - Code à 6 chiffres, 30 s, tolérance d'une période avant/après ; un code déjà accepté est refusé.
// - Codes de récupération : 10 codes à usage unique, stockés hachés (SHA-256).
// - Appareil de confiance : cookie aléatoire (seule son empreinte est en base), durée limitée
//   (MFA_TRUST_DAYS, 30 jours par défaut, 90 au plus), lié au navigateur, révocable.
// - Équipe : la double authentification est OBLIGATOIRE en production (MFA_REQUIRED, activé par
//   défaut sur Vercel). Tant qu'elle n'est pas activée, le compte n'a AUCUN droit d'équipe.
import crypto from 'node:crypto';
import { query, one } from './db.js';
import { HttpError } from './http.js';

export const MFA = {
  issuer: 'E-MAN PROD',
  trustDays: Math.min(90, Math.max(1, Number(process.env.MFA_TRUST_DAYS) || 30)),
  challengeMinutes: 10,
  maxAttempts: 5,
  stepUpMinutes: 10,
};
export const mfaRequired = () => (process.env.MFA_REQUIRED ?? (process.env.VERCEL ? '1' : '0')) === '1';
export const isTeamRole = (role) => role === 'admin' || role === 'staff';

// --------------------------------------------------------------- Base32 et TOTP
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const c of clean) { const i = B32.indexOf(c); if (i < 0) throw new Error('base32'); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totp(secret, step, digits = 6) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / 30);
/** Étape acceptée (pour l'anti-rejeu) ou null. Comparaison à temps constant. */
export function checkTotp(secret, code, { lastStep = null, now = Date.now() } = {}) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return null;
  const s0 = currentStep(now);
  for (const s of [s0, s0 - 1, s0 + 1]) {
    if (lastStep !== null && s <= Number(lastStep)) continue;
    if (crypto.timingSafeEqual(Buffer.from(totp(secret, s)), Buffer.from(c))) return s;
  }
  return null;
}
export const otpauthUri = (secretB32, account) =>
  `otpauth://totp/${encodeURIComponent(MFA.issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(MFA.issuer)}&algorithm=SHA1&digits=6&period=30`;

// --------------------------------------------------------------- Chiffrement du secret
let keyPromise = null;
function envKey() {
  const env = process.env.MFA_ENCRYPTION_KEY;
  if (!env) return null;
  const k = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : Buffer.from(env, 'base64');
  if (k.length !== 32) throw new Error('MFA_ENCRYPTION_KEY doit faire 32 octets (64 caractères hexadécimaux).');
  return k;
}
async function encryptionKey() {
  return envKey() || dbKey();
}
/** Clé gardée en base (créée au premier usage si MFA_ENCRYPTION_KEY n'existe pas). */
async function dbKey() {
  keyPromise ||= (async () => {
    const fresh = crypto.randomBytes(32).toString('base64');
    await query(`insert into app_secrets (name, value) values ('mfa_key', $1) on conflict (name) do nothing returning name`, [fresh]);
    const row = await one(`select value from app_secrets where name = 'mfa_key'`);
    return Buffer.from(row.value, 'base64');
  })().catch((err) => { keyPromise = null; throw err; });
  return keyPromise;
}
export async function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', await encryptionKey(), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
export async function unseal(sealed) {
  const [v, iv, tag, data] = String(sealed || '').split('.');
  if (v !== 'v1') throw new Error('secret illisible');
  const open = (key) => {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]);
  };
  // Clé de Vercel d'abord ; secret créé avant qu'elle existe : ancienne clé gardée en base.
  const env = envKey();
  if (env) { try { return open(env); } catch { /* essai avec la clé en base */ } }
  const row = await one(`select value from app_secrets where name = 'mfa_key'`);
  if (!row) throw new Error('secret illisible');
  return open(Buffer.from(row.value, 'base64'));
}

// --------------------------------------------------------------- Codes de récupération
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normCode = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export async function newRecoveryCodes(userId) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes = Array.from({ length: 10 }, () => {
    const raw = Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  await query('delete from mfa_recovery_codes where user_id = $1 returning id', [userId]);
  for (const c of codes) await query('insert into mfa_recovery_codes (user_id, code_hash) values ($1, $2) returning id', [userId, sha(normCode(c))]);
  return codes;
}
/** Consomme un code de récupération (une seule fois). */
export async function useRecoveryCode(userId, code) {
  const n = normCode(code);
  if (n.length !== 10) return false;
  return Boolean(await one('update mfa_recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning id', [userId, sha(n)]));
}
export const recoveryLeft = async (userId) => (await one('select count(*)::int as n from mfa_recovery_codes where user_id = $1 and used_at is null', [userId])).n;

/**
 * Vérifie un code (6 chiffres ou code de récupération) pour ce compte. Met à jour l'anti-rejeu.
 * @returns {Promise<'totp'|'recovery'|null>}
 */
export async function verifyCode(userId, code) {
  const u = await one('select mfa_secret_enc, mfa_last_step from users where id = $1 and mfa_enabled_at is not null', [userId]);
  if (!u) return null;
  const digits = String(code || '').replace(/\s/g, '');
  if (/^\d{6}$/.test(digits)) {
    const step = checkTotp(await unseal(u.mfa_secret_enc), digits, { lastStep: u.mfa_last_step });
    if (step === null) return null;
    // Anti-rejeu : la mise à jour échoue si un autre appel a déjà utilisé ce code ou un plus récent.
    const ok = await one('update users set mfa_last_step = $2 where id = $1 and (mfa_last_step is null or mfa_last_step < $2) returning id', [userId, step]);
    return ok ? 'totp' : null;
  }
  return (await useRecoveryCode(userId, code)) ? 'recovery' : null;
}

// --------------------------------------------------------------- Appareils de confiance
export const TRUST_COOKIE = 'emp_trust';
export const CHALLENGE_COOKIE = 'emp_mfa';
/** Famille du navigateur et système : un cookie copié dans un autre navigateur n'est pas reconnu. */
export function deviceLabel(ua = '') {
  const s = String(ua);
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Navigateur';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iPhone / iPad' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'appareil inconnu';
  return `${browser} sur ${os}`;
}

export async function findTrustedDevice(token, userId, ua) {
  if (typeof token !== 'string' || token.length < 30 || token.length > 100) return { device: null };
  const d = await one(
    `select id, label, user_agent from trusted_devices
      where token_hash = $1 and user_id = $2 and revoked_at is null and expires_at > now()`,
    [sha(token), userId],
  );
  if (!d) return { device: null };
  // Même jeton, autre navigateur : activité inhabituelle, l'appareil n'est plus considéré comme fiable.
  if (deviceLabel(d.user_agent) !== deviceLabel(ua)) {
    await query('update trusted_devices set revoked_at = now() where id = $1 returning id', [d.id]);
    return { device: null, suspicious: true };
  }
  await query('update trusted_devices set last_used_at = now() where id = $1 returning id', [d.id]);
  return { device: d };
}

export async function trustDevice(userId, ua, ipHash) {
  const token = crypto.randomBytes(32).toString('base64url');
  const row = await one(
    `insert into trusted_devices (user_id, token_hash, label, user_agent, ip_hash, expires_at)
     values ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval) returning id`,
    [userId, sha(token), deviceLabel(ua), String(ua || '').slice(0, 300) || null, ipHash, String(MFA.trustDays)],
  );
  return { token, id: row.id };
}

export async function listDevices(userId) {
  return query(
    `select id, label, created_at, last_used_at, expires_at from trusted_devices
      where user_id = $1 and revoked_at is null and expires_at > now() order by last_used_at desc`, [userId]);
}
/** Révoque un ou tous les appareils de confiance, et ferme les sessions ouvertes grâce à eux. */
export async function revokeDevices(userId, { id = null } = {}) {
  const rows = await query(
    `update trusted_devices set revoked_at = now() where user_id = $1 and revoked_at is null ${id ? 'and id = $2' : ''} returning id`,
    id ? [userId, id] : [userId]);
  if (rows.length) await query('delete from sessions where trusted_device_id = any($1::uuid[]) returning id', [`{${rows.map((r) => r.id).join(',')}}`]);
  return rows.length;
}

// --------------------------------------------------------------- Étape « code » après connexion
export async function createChallenge(userId, method) {
  const token = crypto.randomBytes(32).toString('base64url');
  await query('delete from mfa_challenges where expires_at < now() returning token_hash');
  await query(
    `insert into mfa_challenges (token_hash, user_id, method, expires_at) values ($1, $2, $3, now() + ($4 || ' minutes')::interval) returning token_hash`,
    [sha(token), userId, method, String(MFA.challengeMinutes)]);
  return token;
}
export async function loadChallenge(token) {
  if (typeof token !== 'string' || token.length < 30 || token.length > 100) return null;
  return one('select token_hash, user_id, method, attempts from mfa_challenges where token_hash = $1 and expires_at > now()', [sha(token)]);
}
/** Essai raté : au 5e, l'étape est annulée (il faut se reconnecter avec le mot de passe). */
export async function failChallenge(c) {
  const row = await one('update mfa_challenges set attempts = attempts + 1 where token_hash = $1 returning attempts', [c.token_hash]);
  if (!row || row.attempts >= MFA.maxAttempts) {
    await query('delete from mfa_challenges where token_hash = $1 returning token_hash', [c.token_hash]);
    return 0;
  }
  return MFA.maxAttempts - row.attempts;
}
export const dropChallenge = (c) => query('delete from mfa_challenges where token_hash = $1 returning token_hash', [c.token_hash]);

/** Action sensible : un code saisi sur CETTE session depuis moins de 10 minutes. */
export function assertRecentMfa(user) {
  if (!isTeamRole(user?.real_role || user?.role) || !user.mfa_enabled) return;
  const at = user.mfa_verified_at ? Date.parse(user.mfa_verified_at) : 0;
  if (Date.now() - at > MFA.stepUpMinutes * 60000) {
    const err = new HttpError(403, 'Action sensible : confirmez avec le code de Google Authenticator.');
    err.code = 'mfa_step_up';
    throw err;
  }
}
