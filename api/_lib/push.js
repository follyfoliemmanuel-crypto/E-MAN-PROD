// Notifications push (Web Push, RFC 8030 / 8291 / 8292), sans service payant ni dépendance :
// chiffrement aes128gcm et signature VAPID faits avec le module crypto de Node.
//
// - Les clés VAPID viennent de VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Si elles sont absentes,
//   une paire est créée une seule fois et rangée en base (table push_keys, jamais lue par le navigateur).
//   La clé privée ne quitte jamais le serveur ; seule la clé publique est envoyée au navigateur.
// - Un envoi ne part que vers les appareils des personnes qui reçoivent déjà la notification
//   dans leur espace (mêmes règles d'accès), et seulement si leur compte est actif.
// - Le texte affiché sur l'écran verrouillé est générique : jamais de nom, de montant ni de numéro.
import crypto from 'node:crypto';
import { query, one } from './db.js';
import { logError } from './http.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

// ---------------------------------------------------------------------------
// Clés VAPID
// ---------------------------------------------------------------------------
let cachedKeys = null;

/** Nouvelle paire VAPID au format standard (clé publique brute 65 octets, clé privée brute 32 octets, base64url). */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function validPair(publicKey, privateKey) {
  try {
    const pub = fromB64u(publicKey); const priv = fromB64u(privateKey);
    if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return false;
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(priv);
    return ecdh.getPublicKey().equals(pub);
  } catch { return false; }
}

export function vapidSubject() {
  const s = (process.env.VAPID_SUBJECT || '').trim();
  if (/^(mailto:|https:\/\/)/.test(s)) return s;
  const owner = String(process.env.ADMIN_EMAILS || 'emanprod3@gmail.com').split(',')[0].trim();
  return `mailto:${owner}`;
}

/** Paire VAPID active : variables d'environnement, sinon paire créée et gardée en base. */
export async function vapidKeys() {
  if (cachedKeys) return cachedKeys;
  const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (envPub || envPriv) {
    if (!validPair(envPub, envPriv)) throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY invalides ou ne vont pas ensemble. Regénérez-les avec « npm run push:keys ».');
    cachedKeys = { publicKey: envPub, privateKey: envPriv, source: 'env' };
    // Les clés sont maintenant dans Vercel : la copie gardée en base (même paire) est effacée,
    // pour que la clé privée ne se trouve plus du tout dans Neon.
    await query('delete from push_keys where id = 1 and public_key = $1 returning id', [envPub]).catch(() => {});
    return cachedKeys;
  }
  const fresh = generateVapidKeys();
  // Une seule paire en base, même si deux requêtes arrivent en même temps.
  await query(
    `insert into push_keys (id, public_key, private_key) values (1, $1, $2) on conflict (id) do nothing returning id`,
    [fresh.publicKey, fresh.privateKey],
  );
  const row = await one('select public_key, private_key from push_keys where id = 1');
  if (!row || !validPair(row.public_key, row.private_key)) throw new Error('Clés VAPID en base illisibles.');
  cachedKeys = { publicKey: row.public_key, privateKey: row.private_key, source: 'database' };
  return cachedKeys;
}
export const resetVapidCache = () => { cachedKeys = null; };

function privateKeyObject({ publicKey, privateKey }) {
  const pub = fromB64u(publicKey);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

/** En-tête Authorization VAPID (RFC 8292) : JWT ES256 signé, valable 12 h, pour l'origine du service push. */
export function vapidAuthorization(endpoint, keys, { subject = vapidSubject(), now = Date.now() } = {}) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const unsigned = `${header}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: privateKeyObject(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`;
}

// ---------------------------------------------------------------------------
// Chiffrement du message (RFC 8291, aes128gcm, un seul enregistrement)
// ---------------------------------------------------------------------------
/**
 * @param {Buffer|string} payload  texte à chiffrer (≤ 3 ko)
 * @param {{p256dh: string, auth: string}} keys  clés fournies par le navigateur de l'appareil
 * @param {{salt?: Buffer, serverPrivateKey?: Buffer}} [fixed]  pour les vecteurs de test uniquement
 */
export function encryptPayload(payload, { p256dh, auth }, fixed = {}) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Clé p256dh invalide.');
  if (authSecret.length !== 16) throw new Error('Secret auth invalide.');
  const ecdh = crypto.createECDH('prime256v1');
  if (fixed.serverPrivateKey) ecdh.setPrivateKey(fixed.serverPrivateKey); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = fixed.salt || crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 0x02 : dernier enregistrement
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// ---------------------------------------------------------------------------
// Services push autorisés (on n'envoie jamais de requête vers une adresse choisie par le navigateur)
// ---------------------------------------------------------------------------
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, // Chrome, Edge (Android), Opera, Samsung…
  /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, // Safari (macOS, iPhone, iPad)
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge (Windows)
];
/** Origine de test (simulateur local) : jamais acceptée sur Vercel. */
function testOrigin() {
  if (process.env.VERCEL) return null;
  return (process.env.PUSH_TEST_ORIGIN || '').trim() || null;
}
export function allowedEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (testOrigin() && u.origin === testOrigin()) return true;
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return PUSH_HOSTS.some((re) => re.test(u.hostname));
}

// ---------------------------------------------------------------------------
// Texte affiché : générique, sans donnée personnelle (écran verrouillé)
// ---------------------------------------------------------------------------
const TEAM_TEXT = [
  [/^test$/, 'Notification d’essai : tout fonctionne sur cet appareil'],
  [/^order\.new$/, 'Nouvelle commande à confirmer'],
  [/^order\.cancelled$/, 'Un client a annulé sa commande'],
  [/^order\.assigned$/, 'Une commande vous a été confiée'],
  [/^order\.comment$/, 'Nouveau commentaire interne sur une commande'],
  [/^order\./, 'Du nouveau sur une commande'],
  [/^quote\.(received|new)$/, 'Nouvelle demande de devis'],
  [/^quote\.accepte$/, 'Un client a accepté un devis'],
  [/^quote\.refuse$/, 'Un client a refusé un devis'],
  [/^quote\./, 'Du nouveau sur un devis'],
  [/^message\.voice$/, 'Nouveau message vocal d’un client'],
  [/^message\./, 'Nouveau message d’un client'],
  [/^security\./, 'Alerte de sécurité sur votre compte'],
  [/^client\./, 'Nouveau client inscrit'],
  [/^enrollment\.new$/, 'Nouvelle inscription à une formation'],
  [/^enrollment\./, 'Du nouveau sur une inscription'],
  [/^testimonial\./, 'Nouvel avis à valider'],
  [/^(invoice|payment)\./, 'Du nouveau sur un paiement'],
];
const CLIENT_TEXT = [
  [/^test$/, 'Notification d’essai : tout fonctionne sur cet appareil'],
  [/^message\.voice$/, 'Vous avez reçu un message vocal sur E-MAN PROD.'],
  [/^message\./, 'Vous avez reçu un nouveau message sur E-MAN PROD.'],
  [/^security\./, 'Alerte de sécurité sur votre compte'],
  [/^quote\.envoye$/, 'Votre devis est prêt'],
  [/^quote\./, 'Du nouveau sur votre devis'],
  [/^order\.received$/, 'Votre commande est bien reçue'],
  [/^order\.confirmee$/, 'Votre commande est confirmée'],
  [/^order\.en_production$/, 'Votre commande est en cours'],
  [/^order\.terminee$/, 'Votre commande est prête'],
  [/^order\.livree$/, 'Votre commande est livrée'],
  [/^order\.annulee$/, 'Votre commande a été annulée'],
  [/^order\./, 'Votre commande a changé de statut'],
  [/^invoice\./, 'Votre facture est disponible'],
  [/^payment\./, 'Paiement enregistré'],
  [/^(enrollment|certificate|lesson|training)\./, 'Du nouveau sur votre formation'],
  [/^announcement\./, 'Nouvelle information d’E-MAN PROD'],
];
export function lockScreenText(kind, team) {
  const list = team ? TEAM_TEXT : CLIENT_TEXT;
  const hit = list.find(([re]) => re.test(String(kind || '')));
  return { title: 'E-MAN PROD', body: hit ? hit[1] : (team ? 'Nouvelle notification dans l’espace équipe' : 'Vous avez une nouvelle notification') };
}

/** Lien interne seulement (jamais d'URL externe dans une notification). */
function safeLink(link) {
  const l = String(link || '/espace');
  return l.startsWith('/') && !l.startsWith('//') ? l.slice(0, 300) : '/espace';
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------
const TIMEOUT_MS = 5000;

async function sendOne(sub, body, keys, { ttl, urgency, topic }) {
  const encrypted = encryptPayload(body, { p256dh: sub.p256dh, auth: sub.auth });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: ctrl.signal,
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
        ...(topic ? { Topic: topic } : {}),
      },
      body: encrypted,
    });
    return { status: res.status };
  } catch (err) {
    return { status: 0, error: err.name === 'AbortError' ? 'délai dépassé' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Envoie une notification push à tous les appareils de ces personnes (comptes actifs uniquement).
 * Ne lève jamais d'erreur : les notifications dans l'espace et les e-mails ne dépendent pas du push.
 * @returns {Promise<{sent: number, removed: number, failed: number, devices: number}>}
 */
export async function pushToUsers(userIds, { kind, link, team = false, ttl = 86400, urgency = 'normal' } = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const out = { sent: 0, removed: 0, failed: 0, devices: 0 };
  if (!ids.length) return out;
  try {
    const subs = await query(
      `select s.id, s.endpoint, s.p256dh, s.auth, s.user_id, u.role
         from push_subscriptions s join users u on u.id = s.user_id
        where s.user_id = any($1::uuid[]) and u.disabled_at is null`,
      [ids],
    );
    out.devices = subs.length;
    if (!subs.length) return out;
    const keys = await vapidKeys();
    await Promise.all(subs.map(async (sub) => {
      if (!allowedEndpoint(sub.endpoint)) { // adresse devenue invalide : on la retire
        await query('delete from push_subscriptions where id = $1 returning id', [sub.id]);
        out.removed += 1;
        return;
      }
      const isTeam = team || sub.role !== 'client';
      const text = lockScreenText(kind, isTeam);
      const tag = String(kind || 'general').split('.')[0];
      const body = JSON.stringify({ ...text, url: safeLink(link), tag });
      const r = await sendOne(sub, body, keys, { ttl, urgency, topic: tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) });
      if (r.status >= 200 && r.status < 300) {
        out.sent += 1;
        await query('update push_subscriptions set last_success_at = now(), failures = 0, last_error = null where id = $1 returning id', [sub.id]);
      } else if (r.status === 404 || r.status === 410) {
        // Abonnement expiré ou retiré par le navigateur : on l'efface.
        out.removed += 1;
        await query('delete from push_subscriptions where id = $1 returning id', [sub.id]);
      } else {
        out.failed += 1;
        const row = await one(
          `update push_subscriptions set failures = failures + 1, last_error = $2, last_error_at = now() where id = $1 returning failures`,
          [sub.id, `${r.status || 'réseau'}${r.error ? ` : ${r.error}` : ''}`.slice(0, 300)],
        );
        if (row?.failures >= 15) await query('delete from push_subscriptions where id = $1 returning id', [sub.id]);
      }
    }));
  } catch (err) {
    logError('push.failed', err);
  }
  return out;
}

/** Description lisible d'un appareil, à partir du navigateur (rien de plus précis). */
export function deviceLabel(ua = '') {
  const s = String(ua);
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'Appareil';
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'navigateur';
  return `${br} sur ${os}`;
}
