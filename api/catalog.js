// /api/catalog — contenu public du site, lu par toutes les pages.
//   GET            : prestations, pôles, formations (avec sessions à venir et places
//                    restantes), réalisations publiées, avis publiés, réglages publics
//   GET ?all=1     : idem avec les éléments masqués et les sessions passées (admin)
//   GET ?sitemap=1 : plan du site XML (servi à /sitemap.xml par vercel.json)
import { query } from './_lib/db.js';
import { handler, send, siteUrl } from './_lib/http.js';
import { requirePermission, requireUser, can } from './_lib/auth.js';
import { loadCatalog } from './_lib/services/content.js';

const STATIC_PAGES = ['/', '/prestations', '/formations', '/realisations', '/a-propos', '/contact', '/e-man-cars', '/mentions-legales', '/confidentialite'];

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export default handler({
  async GET(req, res) {
    const all = req.query?.all === '1';
    if (all) {
      // Vue complète (éléments masqués) : équipe chargée du contenu ou des formations.
      const user = await requireUser(req);
      if (!can(user, 'content') && !can(user, 'trainings')) await requirePermission(req, 'content');
    }

    if (req.query?.sitemap === '1') {
      const base = siteUrl(req);
      const [services, trainings] = await Promise.all([
        query('select slug from services where published order by sort'),
        query('select slug from trainings where published order by category_slug, sort'),
      ]);
      const urls = [
        ...STATIC_PAGES,
        ...services.map((p) => `/prestations/${p.slug}`),
        ...trainings.map((c) => `/formations/${c.slug}`),
      ];
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
      res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${xmlEscape(base + (u === '/' ? '/' : u))}</loc></url>`)
        .join('\n')}\n</urlset>\n`);
      return;
    }

    const data = await loadCatalog({ all });
    // Jamais de copie en cache côté CDN : une modification faite dans l'espace
    // administrateur (numéros, textes, prix, places) s'applique au chargement suivant.
    send(res, 200, data, all ? {} : {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Vercel-CDN-Cache-Control': 'no-store',
    });
  },
});
