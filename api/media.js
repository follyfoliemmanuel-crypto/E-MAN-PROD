// /api/media — images du site choisies depuis l'espace admin.
//   GET    : liste publique { slot: { url, alt } } (lue par toutes les pages)
//   PUT    : définir l'image d'un emplacement (admin)
//   DELETE : revenir au visuel par défaut (admin)
import { query, one } from './_lib/db.js';
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { requirePermission } from './_lib/auth.js';
import * as v from './_lib/validate.js';

function slot(value) {
  if (typeof value !== 'string' || !/^[a-z0-9-]{2,60}$/.test(value)) throw new HttpError(400, 'Emplacement invalide.');
  return value;
}

export default handler({
  async GET(req, res) {
    const rows = await query('select slot, url, alt from site_media order by slot');
    const media = Object.fromEntries(rows.map((r) => [r.slot, { url: r.url, alt: r.alt }]));
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ media }));
  },

  async PUT(req, res) {
    const admin = await requirePermission(req, 'content');
    const body = await readJson(req);
    const row = await one(
      `insert into site_media (slot, url, alt, credit, updated_by) values ($1, $2, $3, $4, $5)
       on conflict (slot) do update set url = excluded.url, alt = excluded.alt, credit = excluded.credit,
         updated_by = excluded.updated_by, updated_at = now()
       returning slot, url, alt, credit, updated_at`,
      [
        slot(body.slot),
        v.imageUrl(body.url),
        v.text(body.alt, 'Description', { min: 3, max: 200, required: true }),
        v.text(body.credit, 'Crédit', { max: 200 }),
        admin.id,
      ],
    );
    send(res, 200, { item: row });
  },

  async DELETE(req, res) {
    await requirePermission(req, 'content');
    const body = await readJson(req);
    await query('delete from site_media where slot = $1 returning slot', [slot(body.slot)]);
    send(res, 200, { ok: true });
  },
});
