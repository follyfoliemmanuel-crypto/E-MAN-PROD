// /api/media — images du site choisies depuis l'espace admin.
//   GET    : liste publique { slot: { url, alt } } (lue par toutes les pages)
//   PUT    : définir l'image d'un emplacement (équipe « contenu ») : soit une adresse (url),
//            soit une photo envoyée depuis le tableau de bord (file_id, stockée sur Cloudinary)
//   DELETE : revenir au visuel par défaut (équipe « contenu »)
// Une photo remplacée ou retirée est aussi effacée chez Cloudinary (plus de fichier orphelin).
import { resignStoredUrl } from './_lib/storage/cloudinary.js';
import { query, one } from './_lib/db.js';
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { requirePermission } from './_lib/auth.js';
import * as v from './_lib/validate.js';
import { publicImageUrl, deleteStoredFile } from './_lib/services/files.js';
import { providerOf } from './_lib/storage.js';
import { RESPONSIVE_WIDTHS } from './_lib/storage/cloudinary.js';

const FOCUS = /^(100|[0-9]{1,2})% (100|[0-9]{1,2})%$/;
const focusOf = (value, label) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !FOCUS.test(value)) throw new HttpError(400, `${label} : point de cadrage invalide.`);
  return value;
};
/** Tailles servies par Cloudinary pour une photo envoyée depuis l'admin (sinon aucune). */
function srcsetOf(r) {
  if (!r.storage_key || r.driver !== 'cloudinary' || r.visibility !== 'public' || !r.remote_version) return undefined;
  try {
    const store = providerOf(r);
    return RESPONSIVE_WIDTHS.filter((w) => !r.width || w <= Math.max(r.width, 480)).map((w) => [w, store.publicUrl(r, `w${w}`)]);
  } catch { return undefined; }
}

/** Supprime le fichier d'une ancienne photo, seulement si plus aucun emplacement ne l'utilise. */
async function removeIfUnused(fileId) {
  const used = await one(
    `select 1 as x from site_media m, uploaded_files f
      where f.id = $1 and (m.file_id = f.id or position(f.storage_key in m.url) > 0) limit 1`, [fileId]);
  if (!used) await deleteStoredFile(fileId).catch(() => {});
}

function slot(value) {
  if (typeof value !== 'string' || !/^[a-z0-9-]{2,60}$/.test(value)) throw new HttpError(400, 'Emplacement invalide.');
  return value;
}

export default handler({
  async GET(req, res) {
    const rows = await query(
      `select m.slot, m.url, m.alt, m.focus, m.focus_mobile, f.storage_key, f.driver, f.resource_type, f.remote_type,
              f.remote_version, f.remote_format, f.visibility, f.width
         from site_media m left join uploaded_files f on f.id = m.file_id and f.status = 'ready' order by m.slot`);
    const media = Object.fromEntries(rows.map((r) => [r.slot, {
      url: resignStoredUrl(r.url), alt: r.alt,
      ...(r.focus ? { focus: r.focus } : {}), ...(r.focus_mobile ? { focus_mobile: r.focus_mobile } : {}),
      ...(srcsetOf(r) ? { srcset: srcsetOf(r) } : {}),
    }]));
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
    // Seulement le cadrage (photo inchangée).
    if (body.focus !== undefined && !body.url && !body.file_id) {
      const row = await one(
        `update site_media set focus = $2, focus_mobile = $3, updated_by = $4, updated_at = now() where slot = $1
         returning slot, url, alt, focus, focus_mobile`,
        [s, focusOf(body.focus, 'Cadrage'), focusOf(body.focus_mobile ?? null, 'Cadrage téléphone'), admin.id]);
      if (!row) throw new HttpError(404, 'Ajoutez d’abord une photo à cet emplacement.');
      return send(res, 200, { item: row });
    }
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
    const previous = await one(
      `select m.file_id, m.url, f.storage_key from site_media m left join uploaded_files f on f.id = m.file_id where m.slot = $1`, [s]);
    if (!fileId) {
      // Adresse d'une photo DÉJÀ envoyée sur le site (le formulaire renvoie l'adresse actuelle quand on
      // ne change que la description) : c'est la même photo → on garde son fichier, rien n'est supprimé.
      const sig = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/s--[A-Za-z0-9_-]{8}--\//, '/');
      if (previous?.file_id && (sig(url) === sig(previous.url) || (previous.storage_key && url.includes(previous.storage_key)))) {
        fileId = previous.file_id;
      } else {
        const own = await one(
          `select id from uploaded_files where purpose = 'site_media' and status = 'ready' and position(storage_key in $1) > 0 limit 1`, [url]);
        if (own) fileId = own.id;
      }
      if (fileId) url = await publicImageUrl(fileId);
    }
    const row = await one(
      `insert into site_media (slot, url, alt, credit, file_id, updated_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (slot) do update set url = excluded.url, alt = excluded.alt, credit = excluded.credit,
         file_id = excluded.file_id, updated_by = excluded.updated_by, updated_at = now(),
         focus = null, focus_mobile = null -- nouvelle photo : cadrage à refaire (centré par défaut)
       returning slot, url, alt, credit, file_id, updated_at`,
      [s, url, v.text(body.alt, 'Description', { min: 3, max: 200, required: true }), v.text(body.credit, 'Crédit', { max: 200 }), fileId, admin.id],
    );
    if (previous?.file_id && previous.file_id !== fileId) await removeIfUnused(previous.file_id);
    send(res, 200, { item: row });
  },

  async DELETE(req, res) {
    await requirePermission(req, 'content');
    const body = await readJson(req);
    const previous = await one('select file_id from site_media where slot = $1', [slot(body.slot)]);
    await query('delete from site_media where slot = $1 returning slot', [slot(body.slot)]);
    if (previous?.file_id) await removeIfUnused(previous.file_id);
    send(res, 200, { ok: true });
  },
});
