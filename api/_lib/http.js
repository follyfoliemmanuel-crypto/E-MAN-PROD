// Petits utilitaires HTTP communs aux fonctions /api.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Journal serveur sans données personnelles ni secrets : adresses e-mail, liens (qui peuvent
 * porter un jeton), chaînes de connexion et jetons longs sont masqués avant écriture.
 */
export function redact(text) {
  return String(text ?? '')
    .replace(/postgres(ql)?:\/\/\S+/gi, '[base]')
    .replace(/https?:\/\/\S+/gi, '[adresse]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[jeton]')
    .slice(0, 400);
}
export function logError(event, err, extra = {}) {
  console.error(JSON.stringify({ level: 'error', event, ...extra, message: redact(err?.message ?? err) }));
}

/** Codes Postgres qui signalent une donnée mal formée envoyée par le navigateur. */
const PG_INPUT_ERRORS = {
  '22P02': [400, 'Donnée invalide.'], '22003': [400, 'Nombre trop grand.'], '22008': [400, 'Date invalide.'], '22007': [400, 'Date invalide.'],
  '22021': [400, 'Texte invalide.'], '22001': [400, 'Texte trop long.'], '23505': [409, 'Cet élément existe déjà.'], '23503': [409, 'Élément lié introuvable.'],
  '23514': [400, 'Donnée refusée par les règles de l’application.'],
};
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

const MAX_BODY = 64 * 1024;

/** En-tête Content-Length : entier positif (absent = 0). */
const ContentLength = z.coerce.number().int().min(0).catch(0);
/** Corps déjà lu par la plateforme : objet JSON, ou texte JSON. */
const RawBody = z.union([z.record(z.string().max(100), z.unknown()), z.string(), z.undefined(), z.null()]);

export async function readJson(req) {
  // Sur Vercel, le corps est déjà lu par la plateforme (jusqu'à 4,5 Mo) : la limite de
  // l'application est donc aussi vérifiée sur la taille annoncée et sur le texte reçu.
  const declared = ContentLength.parse(req.headers?.['content-length'] ?? 0);
  if (declared > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse.');
  const given = Buffer.isBuffer(req.body) ? undefined : RawBody.safeParse(req.body);
  if (given && !given.success) throw new HttpError(400, 'Corps de requête invalide.');
  const body = given?.data;
  if (body && typeof body === 'object') {
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse.');
    return checkJson(body);
  }
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse.');
    return safeParse(body);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse.');
    chunks.push(chunk);
  }
  return safeParse(Buffer.concat(chunks).toString('utf8'));
}

function safeParse(text) {
  if (!text) return {};
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Corps de requête invalide.');
  }
  return checkJson(v);
}

/**
 * Contrôle commun à toutes les routes : objet JSON (pas une liste ni une valeur seule),
 * profondeur raisonnable, et aucun caractère nul ni caractère de contrôle invisible dans
 * les textes (Postgres refuse le caractère nul ; les autres servent à masquer du contenu).
 */
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
/** Enveloppe d'un corps de requête : un objet JSON (les champs sont ensuite validés par chaque route). */
const BodySchema = z.record(z.string().max(100), z.unknown());
export function checkJson(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const parsed = BodySchema.safeParse(v);
  if (!parsed.success) throw new HttpError(400, 'Corps de requête invalide.');
  const walk = (x, depth) => {
    if (depth > 8) throw new HttpError(400, 'Corps de requête trop imbriqué.');
    if (typeof x === 'string') {
      if (BAD_CHARS.test(x)) throw new HttpError(400, 'Texte refusé : il contient des caractères invisibles ou de contrôle.');
    } else if (Array.isArray(x)) x.forEach((y) => walk(y, depth + 1));
    else if (x && typeof x === 'object') {
      for (const [k, y] of Object.entries(x)) {
        if (BAD_CHARS.test(k)) throw new HttpError(400, 'Corps de requête invalide.');
        walk(y, depth + 1);
      }
    }
  };
  walk(v, 0);
  return v;
}

// --- Paramètres d'adresse (query string) ---------------------------------------------
/** Valeur d'un paramètre d'adresse : texte simple, sans caractère de contrôle, 2 000 caractères au plus. */
const QueryValue = z.string().max(2000).refine((x) => !BAD_CHARS.test(x), 'Paramètre d’adresse invalide.');
const QueryEnvelope = z.record(z.string().max(60), z.union([QueryValue, z.array(QueryValue).max(5)]));

/**
 * Lit les paramètres d'adresse d'une route avec SON schéma Zod : seuls les paramètres déclarés
 * sont gardés (les autres sont ignorés), chacun avec son type et sa longueur.
 * @param {import('zod').ZodRawShape} shape
 */
export function readQuery(req, shape) {
  const raw = req.query && typeof req.query === 'object' ? req.query : {};
  if (!QueryEnvelope.safeParse(raw).success) throw new HttpError(400, 'Paramètre d’adresse invalide.');
  const r = z.object(shape).safeParse(raw);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message || 'Paramètre d’adresse invalide.');
  return r.data;
}
/** Briques courantes pour les schémas de paramètres d'adresse. */
export const Q = {
  flag: z.enum(['1', '']).optional(),
  id: (label = 'Identifiant') => z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, `${label} invalide.`).optional(),
  text: (max = 100) => z.string().max(max).optional(),
  oneOf: (values) => z.enum(values).optional(),
};

// --- Anti-abus de premier niveau, en mémoire (par instance de fonction) -----------------
// Freine les rafales (déni de service) avant toute requête à la base. Les limites métier
// (connexion, inscription, devis…) restent en base, communes à toutes les instances.
// 300 requêtes par minute et par IP en ligne ; désactivé en local sauf si API_BURST_PER_MINUTE est fixé.
const BURST = { windowMs: 60000, max: Number(process.env.API_BURST_PER_MINUTE) || (process.env.VERCEL ? 300 : Infinity) };
const hits = new Map();
function burstLimited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > BURST.windowMs) { hits.set(ip, { start: now, n: 1 }); }
  else if (++h.n > BURST.max) return true;
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > BURST.windowMs) hits.delete(k);
  return false;
}

function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * Adresse IP du visiteur pour les limites anti-abus. Sur Vercel, x-real-ip et le premier
 * élément de x-forwarded-for sont posés par la plateforme ; ailleurs, ils pourraient être inventés.
 */
const IpAddress = z.string().trim().max(64).regex(/^[0-9a-fA-F:.]+$/);
export function clientIp(req) {
  const real = process.env.VERCEL ? IpAddress.safeParse(req.headers['x-real-ip']) : { success: false };
  if (real.success) return real.data;
  const fwd = [].concat(req.headers['x-forwarded-for'] ?? '')[0];
  const first = IpAddress.safeParse(String(fwd).split(',')[0]);
  return first.success ? first.data : IpAddress.safeParse(req.socket?.remoteAddress).data || 'inconnu';
}

export function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https';
}

export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  // En production, jamais l'en-tête Host (falsifiable) : les liens des e-mails (réinitialisation
  // du mot de passe…) doivent toujours pointer vers le vrai site.
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = String(req.headers.host || 'localhost');
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) throw new HttpError(400, 'Adresse du site invalide.');
  return `${isHttps(req) ? 'https' : 'http'}://${host}`;
}


/**
 * Enveloppe commune : méthodes autorisées, protection CSRF (les requêtes qui
 * modifient des données doivent venir du site lui-même, en JSON) et erreurs.
 */
export function handler(methods, { raw = [] } = {}) {
  return async (req, res) => {
    const fn = methods[req.method];
    if (!fn) return send(res, 405, { error: 'Méthode non autorisée.' }, { Allow: Object.keys(methods).join(', ') });

    // Utilisé par l'authentification pour renouveler le cookie de session au passage.
    req.res = res;
    if (burstLimited(clientIp(req))) return send(res, 429, { error: 'Trop de requêtes. Patientez une minute.' }, { 'Retry-After': '60' });
    if (req.method !== 'GET') {
      // Protection CSRF : une requête qui modifie des données doit venir du site lui-même.
      // 1. en-tête Origin (envoyé par les navigateurs) ; 2. en-tête Sec-Fetch-Site ;
      // 3. corps JSON obligatoire (un formulaire d'un autre site ne peut pas en envoyer).
      const origin = req.headers.origin;
      if (origin && hostOf(origin) !== req.headers.host) {
        return send(res, 403, { error: 'Origine non autorisée.' });
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        return send(res, 403, { error: 'Origine non autorisée.' });
      }
      if (!raw.includes(req.method) && !String(req.headers['content-type'] || '').includes('application/json')) {
        return send(res, 415, { error: 'Format attendu : JSON.' });
      }
    }

    try {
      // Paramètres d'adresse : enveloppe validée par Zod pour toutes les routes (chaque route
      // valide ensuite SES paramètres avec readQuery).
      if (!QueryEnvelope.safeParse(req.query && typeof req.query === 'object' ? req.query : {}).success) {
        return send(res, 400, { error: 'Paramètre d’adresse invalide.' });
      }
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      // Donnée refusée par Postgres (format, nombre trop grand, date hors limites) : c'est une
      // erreur de saisie, pas une panne. Le détail technique n'est jamais renvoyé.
      const pg = PG_INPUT_ERRORS[err?.code];
      if (pg) return send(res, pg[0], { error: pg[1] });
      // Référence courte : permet de retrouver l'erreur dans les journaux Vercel sans rien exposer.
      const ref = randomBytes(4).toString('hex');
      console.error(JSON.stringify({ level: 'error', event: 'api.error', ref, path: String(req.url || '').split('?')[0], method: req.method, code: err?.code || null, message: redact(err?.message || err), stack: redact(String(err?.stack || '').split('\n').slice(1, 6).join(' | ')) }));
      // Détail technique seulement en développement local, à la demande (DEBUG_ERRORS=1).
      const detail = !process.env.VERCEL && process.env.DEBUG_ERRORS === '1' ? ` (${err.message})` : '';
      send(res, 500, { error: `Erreur du serveur. Réessayez ou contactez-nous sur WhatsApp (référence ${ref}).${detail}`, ref });
    }
  };
}
