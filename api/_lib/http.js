// Petits utilitaires HTTP communs aux fonctions /api.
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

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return safeParse(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, 'Requête trop volumineuse.');
    chunks.push(chunk);
  }
  return safeParse(Buffer.concat(chunks).toString('utf8'));
}

function safeParse(text) {
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new HttpError(400, 'Corps de requête invalide.');
  }
}

function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || req.socket?.remoteAddress || 'inconnu';
}

export function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https';
}

export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
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
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      // En local (hors Vercel), on affiche la vraie cause pour aider au réglage.
      const detail = process.env.VERCEL ? '' : ` (${err.message})`;
      send(res, 500, { error: 'Erreur du serveur. Réessayez ou contactez-nous sur WhatsApp.' + detail });
    }
  };
}
