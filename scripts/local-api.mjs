// Serveur d'API local : fait tourner les fonctions du dossier /api directement
// dans `npm run dev` (Vite), sans Vercel. En ligne, Vercel prend le relais avec
// exactement les mêmes fichiers.
const ROUTES = [
  [/^\/api\/orders\/?$/, '/api/orders.js'],
  [/^\/api\/trainings\/?$/, '/api/trainings.js'],
  [/^\/api\/media\/?$/, '/api/media.js'],
  [/^\/api\/catalog\/?$/, '/api/catalog.js'],
  [/^\/api\/manage\/?$/, '/api/manage.js'],
  [/^\/api\/quotes\/?$/, '/api/quotes.js'],
  [/^\/api\/account\/?$/, '/api/account.js'],
  [/^\/api\/files\/?$/, '/api/files.js'],
  [/^\/api\/inbox\/?$/, '/api/inbox.js'],
  [/^\/api\/auth\/([a-z-]+)\/?$/, '/api/auth/[action].js', 'action'],
];

/**
 * @param {(path: string) => Promise<any>} load  charge un module de l'API
 *   (dans Vite : server.ssrLoadModule, qui recharge le fichier à chaque modification)
 */
export function createApiMiddleware(load) {
  return async function apiMiddleware(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();

    for (const [pattern, file, param] of ROUTES) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      req.query = Object.fromEntries(url.searchParams);
      if (param) req.query[param] = match[1];
      try {
        const mod = await load(file);
        return await mod.default(req, res);
      } catch (err) {
        console.error('\n[api]', err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Erreur du serveur local : ' + err.message }));
        }
        return undefined;
      }
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Route API inconnue.' }));
    return undefined;
  };
}
