// /api/media — images du site choisies depuis l'espace admin.
//   GET    : liste publique { slot: { url, alt } } (lue par toutes les pages)
//   PUT    : définir l'image d'un emplacement (équipe « contenu ») : soit une adresse (url),
//            soit une photo envoyée depuis le tableau de bord (file_id, stockée sur Cloudinary)
//   DELETE : revenir au visuel par défaut (équipe « contenu »)
// Une photo remplacée ou retirée est aussi effacée chez Cloudinary (plus de fichier orphelin).
import { query, one } from './_lib/db.js';
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { requirePermission } from './_lib/auth.js';
import * as v from './_lib/validate.js';
import { publicImageUrl, deleteStoredFile } from './_lib/services/files.js';

function slot(value) {
  if (typeof value !== 'string' || !/^[a-z0-9-]{2,60}$/.test(value)) throw new HttpError(400, 'Emplacement invalide.');
  return value;
}

export default handler({
  async GET(req, res) {
    const rows = await query('select slot, url, alt from site_media order by slot');
    const media = Object.fromEntries(rows.map((r) => [r.slot, { url: r.url, alt: r.alt }]));
    // Pas de copie en cache côté CDN : une photo changée s'affiche au chargement suivant.
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ media }));
  },

  async PUT(req, res) {
    const admin = await requirePermission(req, 'content');
    const body = await readJson(req);
    const s = slot(body.slot);
    let fileId = null;
    let url;
    if (body.file_id) {
      fileId = v.uuid(body.file_id, 'Photo');
      const f = await one(`select id from uploaded_files where id = $1 and purpose = 'site_media' and status = 'ready'`, [fileId]);
      if (!f) throw new HttpError(400, 'Photo introuvable ou pas encore reçue : renvoyez-la.');
      url = await publicImageUrl(fileId);
    } else {
      url = v.imageUrl(body.url);
    }
    const previous = await one('select file_id from site_media where slot = $1', [s]);
    const row = await one(
      `insert into site_media (slot, url, alt, credit, file_id, updated_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (slot) do update set url = excluded.url, alt = excluded.alt, credit = excluded.credit,
         file_id = excluded.file_id, updated_by = excluded.updated_by, updated_at = now()
       returning slot, url, alt, credit, file_id, updated_at`,
      [s, url, v.text(body.alt, 'Description', { min: 3, max: 200, required: true }), v.text(body.credit, 'Crédit', { max: 200 }), fileId, admin.id],
    );
    if (previous?.file_id && previous.file_id !== fileId) await deleteStoredFile(previous.file_id).catch(() => {});
    send(res, 200, { item: row });
  },

  async DELETE(req, res) {
    await requirePermission(req, 'content');
    const body = await readJson(req);
    const previous = await one('select file_id from site_media where slot = $1', [slot(body.slot)]);
    await query('delete from site_media where slot = $1 returning slot', [slot(body.slot)]);
    if (previous?.file_id) await deleteStoredFile(previous.file_id).catch(() => {});
    send(res, 200, { ok: true });
  },
});
