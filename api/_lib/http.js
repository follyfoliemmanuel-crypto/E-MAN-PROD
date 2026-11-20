// Petits utilitaires HTTP communs aux fonctions /api.
import { randomBytes } from 'node:crypto';

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

export async function readJson(req) {
  // Sur Vercel, le corps est déjà lu par la plateforme (jusqu'à 4,5 Mo) : la limite de
  // l'application est donc aussi vérifiée sur la taille annoncée et sur le texte reçu.
  if (Number(req.headers?.['content-length'] || 0) > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse.');
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse.');
    return checkJson(req.body);
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse.');
    return safeParse(req.body);
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
export function checkJson(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
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
export function clientIp(req) {
  if (process.env.VERCEL && req.headers['x-real-ip']) return String(req.headers['x-real-ip']).slice(0, 64);
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || req.socket?.remoteAddress || 'inconnu';
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
      // Paramètres d'adresse : mêmes caractères interdits que dans les corps JSON.
      for (const v of Object.values(req.query || {})) {
        if ([].concat(v).some((x) => typeof x === 'string' && (BAD_CHARS.test(x) || x.length > 2000))) {
          return send(res, 400, { error: 'Paramètre d’adresse invalide.' });
        }
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
      console.error(JSON.stringify({ level: 'error', event: 'api.error', ref, path: String(req.url || '').split('?')[0], method: req.method, code: err?.code || null, message: String(err?.message || err).slice(0, 300), stack: String(err?.stack || '').split('\n').slice(0, 6).join(' | ') }));
      // Détail technique seulement en développement local, à la demande (DEBUG_ERRORS=1).
      const detail = !process.env.VERCEL && process.env.DEBUG_ERRORS === '1' ? ` (${err.message})` : '';
      send(res, 500, { error: `Erreur du serveur. Réessayez ou contactez-nous sur WhatsApp (référence ${ref}).${detail}`, ref });
    }
  };
}
