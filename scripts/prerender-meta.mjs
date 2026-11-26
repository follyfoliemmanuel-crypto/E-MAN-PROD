// Après `vite build` : écrit une page HTML par adresse (dist/formations/index.html, …)
// avec le bon titre, la bonne description, l'URL canonique et les données structurées,
// ainsi que robots.txt. Google et les aperçus de liens WhatsApp / Facebook lisent ainsi
// les bonnes informations sans exécuter le JavaScript.
// Les fiches de prestations et de formations sont prérendues à partir du catalogue initial
// (src/content/seed.js) ; une fiche ajoutée ensuite par l'administration reste servie par
// la page générique, puis le site met son titre à jour dans le navigateur.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES, SITE_URL, courseMeta, serviceMeta } from '../src/routes-meta.js';
import { PRESTATIONS, ALL_COURSES as COURSES } from '../src/content/seed.js';

const dist = new URL('../dist/', import.meta.url).pathname;
// Le modèle cite le domaine prévu : on le remplace par l'adresse réelle (SITE_URL).
// Google Search Console : GOOGLE_SITE_VERIFICATION = la valeur « content » de la balise fournie par Google.
const gsv = String(process.env.GOOGLE_SITE_VERIFICATION || '').trim();
const gsvTag = /^[A-Za-z0-9_-]{10,120}$/.test(gsv) ? `<meta name="google-site-verification" content="${gsv}" />\n    ` : '';
if (gsv && !gsvTag) console.warn('⚠ GOOGLE_SITE_VERIFICATION ignorée : indiquez seulement la valeur content de la balise Google.');
const template = readFileSync(join(dist, 'index.html'), 'utf8').replaceAll('https://www.emanprod.com', SITE_URL)
  .replace('<link rel="canonical"', gsvTag + '<link rel="canonical"');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function render(path, meta) {
  const url = SITE_URL + (path === '/' ? '' : path);
  let html = template
    .replace(/<title>.*?<\/title>/s, `<title>${esc(meta.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(meta.description)}`)
    .replace(/(<meta name="robots" content=")[^"]*/, `$1${meta.noindex ? 'noindex' : 'index,follow'}`)
    .replace(/(<link rel="canonical" href=")[^"]*/, `$1${url}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(meta.title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(meta.description)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${url}`)
    .replace(/(<meta name="twitter:title" content=")[^"]*/, `$1${esc(meta.title)}`)
    .replace(/(<meta name="twitter:description" content=")[^"]*/, `$1${esc(meta.description)}`);
  if (meta.jsonLd) {
    // « </ » échappé : le JSON ne peut pas fermer la balise script.
    const ld = JSON.stringify(meta.jsonLd).replace(/<\//g, '<\\/');
    html = html.replace('</head>', `    <script type="application/ld+json" id="page-jsonld">${ld}</script>\n  </head>`);
  }
  return html;
}

function write(path, meta) {
  const html = render(path, meta);
  if (path === '/') return writeFileSync(join(dist, 'index.html'), html);
  mkdirSync(join(dist, path), { recursive: true });
  writeFileSync(join(dist, path, 'index.html'), html);
}

let n = 0;
for (const [path, meta] of Object.entries(ROUTES)) { write(path, meta); n++; }
for (const p of PRESTATIONS) { write(`/prestations/${p.slug}`, serviceMeta(p)); n++; }
for (const c of COURSES) { write(`/formations/${c.slug}`, courseMeta(c)); n++; }

// Page introuvable : Vercel sert 404.html avec le code 404 pour toute adresse inconnue
// (vercel.json ne réécrit vers index.html que les routes connues). L'application y affiche « Page introuvable ».
writeFileSync(join(dist, '404.html'), render('/404', {
  title: 'Page introuvable | E-MAN PROD',
  description: 'Cette page n’existe pas ou a été déplacée. Retrouvez les prestations et formations d’E-MAN PROD.',
  noindex: true,
}).replace(/\s*<link rel="canonical"[^>]*>/, ''));

// Le plan du site (/sitemap.xml) est généré dynamiquement par /api/catalog.
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /espace\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

console.log(`prerender-meta : ${n} pages et robots.txt écrits pour ${SITE_URL} (sitemap dynamique).`);
