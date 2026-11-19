// Après `vite build` : écrit une page HTML par adresse (dist/services/index.html, …)
// avec le bon titre, la bonne description et l'URL canonique, ainsi que sitemap.xml
// et robots.txt. Google et les aperçus de liens WhatsApp/Facebook lisent ainsi les
// bonnes informations sans exécuter le JavaScript.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES, SITE_URL } from '../src/routes-meta.js';

const dist = new URL('../dist/', import.meta.url).pathname;
const template = readFileSync(join(dist, 'index.html'), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function render(path, meta) {
  const url = SITE_URL + (path === '/' ? '' : path);
  return template
    .replace(/<title>.*?<\/title>/s, `<title>${esc(meta.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(meta.description)}`)
    .replace(/(<meta name="robots" content=")[^"]*/, `$1${meta.noindex ? 'noindex' : 'index,follow'}`)
    .replace(/(<link rel="canonical" href=")[^"]*/, `$1${url}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(meta.title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(meta.description)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${url}`);
}

for (const [path, meta] of Object.entries(ROUTES)) {
  const html = render(path, meta);
  if (path === '/') {
    writeFileSync(join(dist, 'index.html'), html);
  } else {
    mkdirSync(join(dist, path), { recursive: true });
    writeFileSync(join(dist, path, 'index.html'), html);
  }
}

// Le plan du site (/sitemap.xml) est généré dynamiquement par /api/catalog.
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /espace\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

console.log(`prerender-meta : ${Object.keys(ROUTES).length} pages et robots.txt écrits (sitemap dynamique).`);
