// Fichiers envoyés : formats, tailles, types MIME, contenu réel et droits d'accès.
//
// Envoi en 3 temps :
//   1. POST /api/files            → le serveur vérifie le droit et le format annoncé,
//                                   puis renvoie une adresse d'envoi signée (10 min) ;
//   2. le navigateur envoie le fichier à cette adresse ;
//   3. POST /api/files {confirm}  → le serveur relit la taille et les premiers octets du
//                                   fichier stocké : s'ils ne correspondent pas au format
//                                   annoncé, le fichier est refusé et effacé.
import { randomUUID } from 'node:crypto';
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { logActivity, isTeam } from '../activity.js';
import { storage } from '../storage.js';

const MB = 1024 * 1024;

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);
const ascii = (buf, offset, text) => buf.subarray(offset, offset + text.length).toString('latin1') === text;

/** Formats acceptés : type MIME enregistré, extensions, types annoncés tolérés, signature du contenu. */
export const FORMATS = {
  jpg: { mime: 'image/jpeg', ext: ['jpg', 'jpeg'], aliases: ['image/jpeg', 'image/pjpeg'], check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  png: { mime: 'image/png', ext: ['png'], aliases: ['image/png'], check: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  webp: { mime: 'image/webp', ext: ['webp'], aliases: ['image/webp'], check: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') },
  pdf: { mime: 'application/pdf', ext: ['pdf'], aliases: ['application/pdf'], check: (b) => ascii(b, 0, '%PDF-') },
  // Illustrator : PDF compatible ou PostScript. EPS : PostScript, ou en-tête binaire DOS.
  ai: { mime: 'application/postscript', ext: ['ai'], aliases: ['application/postscript', 'application/illustrator', 'application/pdf'], check: (b) => ascii(b, 0, '%PDF-') || ascii(b, 0, '%!PS') },
  eps: { mime: 'application/postscript', ext: ['eps'], aliases: ['application/postscript', 'application/eps', 'image/x-eps'], check: (b) => ascii(b, 0, '%!PS') || startsWith(b, [0xc5, 0xd0, 0xd3, 0xc6]) },
  psd: { mime: 'image/vnd.adobe.photoshop', ext: ['psd'], aliases: ['image/vnd.adobe.photoshop', 'application/x-photoshop', 'image/x-photoshop', 'application/photoshop'], check: (b) => ascii(b, 0, '8BPS') },
  // CorelDRAW, très utilisé dans les ateliers : ancien format RIFF « CDR », récent au format ZIP.
  cdr: { mime: 'application/vnd.corel-draw', ext: ['cdr'], aliases: ['application/vnd.corel-draw', 'application/x-cdr', 'application/cdr', 'image/x-cdr', 'application/coreldraw'], check: (b) => (ascii(b, 0, 'RIFF') && ascii(b, 8, 'CDR')) || startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  zip: { mime: 'application/zip', ext: ['zip'], aliases: ['application/zip', 'application/x-zip-compressed'], check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  // Supports de cours bureautiques (Word, Excel, PowerPoint) : archives ZIP.
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: ['docx'], aliases: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: ['xlsx'], aliases: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: ['pptx'], aliases: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
};
const ATTACHMENTS = ['jpg', 'png', 'webp', 'pdf', 'ai', 'eps', 'psd', 'cdr', 'zip'];
const IMAGES = ['jpg', 'png', 'webp'];

/** Règles par usage : formats, taille maximale, nombre de fichiers, qui peut envoyer. */
export const PURPOSES = {
  quote: { formats: ATTACHMENTS, maxBytes: 25 * MB, perTarget: 10, team: 'quotes', visibility: 'private' },
  order: { formats: ATTACHMENTS, maxBytes: 25 * MB, perTarget: 20, team: 'orders', visibility: 'private' },
  message: { formats: ATTACHMENTS, maxBytes: 25 * MB, perTarget: 5, team: null, visibility: 'private' },
  portfolio: { formats: IMAGES, maxBytes: 5 * MB, perTarget: 1, team: 'content', teamOnly: true, visibility: 'public' },
  site_media: { formats: IMAGES, maxBytes: 5 * MB, perTarget: null, team: 'content', teamOnly: true, visibility: 'public' },
  // Photo de profil : envoyée par la personne elle-même, visible d'elle et de l'équipe « clients ».
  avatar: { formats: IMAGES, maxBytes: 2 * MB, perTarget: null, team: 'clients', visibility: 'private' },
  // Documents d'une inscription (attestation, support) : déposés par l'équipe « formations ».
  enrollment: { formats: ATTACHMENTS, maxBytes: 25 * MB, perTarget: 20, team: 'trainings', teamOnly: true, visibility: 'private' },
  // Documents pédagogiques d'une session (supports, exercices) : visibles des inscrits confirmés.
  session: { formats: [...ATTACHMENTS, 'docx', 'xlsx', 'pptx'], maxBytes: 25 * MB, perTarget: 40, team: 'trainings', teamOnly: true, visibility: 'private' },
};
const TARGET_COLUMN = { quote: 'quote_id', order: 'order_id', message: 'message_id', portfolio: 'portfolio_item_id', enrollment: 'enrollment_id', session: 'session_id' };

const FILE_COLS = `f.id, f.purpose, f.original_name, f.mime_type, f.size_bytes::float8 as size_bytes, f.visibility, f.status,
  f.owner_id, f.quote_id, f.order_id, f.message_id, f.portfolio_item_id, f.enrollment_id, f.session_id, f.created_at, f.confirmed_at`;

/** Nom de fichier affiché : sans chemin ni caractères de contrôle. Jamais utilisé dans le stockage. */
export function cleanName(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!base) throw new HttpError(400, 'Nom de fichier manquant.');
  return base.slice(-200);
}

/** Reconnaît le format à partir de l'extension, puis vérifie le type MIME annoncé par le navigateur. */
export function formatFor(purpose, filename, declaredMime) {
  const rules = PURPOSES[purpose];
  const ext = (filename.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
  const key = rules.formats.find((f) => FORMATS[f].ext.includes(ext));
  const accepted = rules.formats.flatMap((f) => FORMATS[f].ext).join(', ');
  if (!key) throw new HttpError(415, `Format non accepté (.${ext || '?'}). Formats acceptés : ${accepted}.`);
  const mime = String(declaredMime || '').toLowerCase().split(';')[0].trim();
  // Certains navigateurs n'annoncent rien de précis pour .cdr, .ai ou .psd : toléré, le contenu est vérifié ensuite.
  if (mime && mime !== 'application/octet-stream' && !FORMATS[key].aliases.includes(mime)) {
    throw new HttpError(415, `Le type annoncé (${mime}) ne correspond pas à un fichier .${ext}.`);
  }
  return { key, ext, mime: FORMATS[key].mime };
}

/** Vérifie que la personne peut joindre un fichier à cette ressource. */
async function assertCanAttach(actor, purpose, targetId) {
  const rules = PURPOSES[purpose];
  if (!actor?.id) throw new HttpError(401, 'Connectez-vous pour envoyer un fichier.');
  if (rules.teamOnly && !isTeam(actor, rules.team)) throw new HttpError(403, 'Accès réservé à l’équipe de l’atelier.');
  if (purpose === 'site_media' || purpose === 'avatar') return;
  // Photo de réalisation : peut être envoyée avant la création de la fiche, puis rattachée.
  if (purpose === 'portfolio' && !targetId) return;
  if (!targetId) throw new HttpError(400, 'Indiquez à quoi rattacher le fichier.');
  if (purpose === 'quote') {
    const q = await one('select user_id, status from quotes where id = $1', [targetId]);
    if (!q || (!isTeam(actor, 'quotes') && q.user_id !== actor.id)) throw new HttpError(404, 'Devis introuvable.');
    if (['annule', 'refuse', 'expire'].includes(q.status)) throw new HttpError(409, 'Ce devis est clos : il ne reçoit plus de fichiers.');
  } else if (purpose === 'order') {
    const o = await one('select user_id, status from orders where id = $1', [targetId]);
    if (!o || (!isTeam(actor, 'orders') && o.user_id !== actor.id)) throw new HttpError(404, 'Commande introuvable.');
    if (['livree', 'annulee'].includes(o.status)) throw new HttpError(409, 'Cette commande est close : elle ne reçoit plus de fichiers.');
  } else if (purpose === 'message') {
    const m = await one('select author_id, quote_id from messages where id = $1', [targetId]);
    if (!m || (!isTeam(actor, m.quote_id ? 'quotes' : 'orders') && m.author_id !== actor.id)) throw new HttpError(404, 'Message introuvable.');
  } else if (purpose === 'enrollment') {
    if (!(await one('select id from enrollments where id = $1', [targetId]))) throw new HttpError(404, 'Inscription introuvable.');
  } else if (purpose === 'session') {
    if (!(await one('select id from training_sessions where id = $1', [targetId]))) throw new HttpError(404, 'Session introuvable.');
  } else if (purpose === 'portfolio') {
    if (!(await one('select id from portfolio_items where id = $1', [targetId]))) throw new HttpError(404, 'Réalisation introuvable.');
  }
}

/** Étape 1 : prépare l'envoi et renvoie l'adresse signée. */
export async function createUpload(actor, { purpose, target_id: targetId = null, filename, mime_type: declaredMime, size }) {
  const rules = PURPOSES[purpose];
  const name = cleanName(filename);
  const format = formatFor(purpose, name, declaredMime);
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'Taille du fichier invalide.');
  if (size > rules.maxBytes) throw new HttpError(413, `Fichier trop volumineux : ${Math.round(rules.maxBytes / MB)} Mo maximum.`);
  await assertCanAttach(actor, purpose, targetId);
  const column = TARGET_COLUMN[purpose];
  if (rules.perTarget && column) {
    const [{ n }] = await query(`select count(*)::int as n from uploaded_files where ${column} = $1 and status <> 'rejected'`, [targetId]);
    if (n >= rules.perTarget) throw new HttpError(409, `${rules.perTarget} fichier(s) maximum ici. Supprimez-en un pour en ajouter un autre.`);
  }
  const store = storage();
  const now = new Date();
  const id = randomUUID();
  const prefix = rules.visibility === 'public' ? 'public/' : '';
  // La clé de stockage ne reprend jamais le nom choisi par la personne.
  const key = `${prefix}${purpose}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${format.ext}`;
  await query(
    `insert into uploaded_files (id, owner_id, purpose, driver, storage_key, original_name, mime_type, size_bytes, visibility, ${column || 'quote_id'})
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [id, actor.id, purpose, store.name, key, name, format.mime, size, rules.visibility, column ? targetId : null],
  );
  return { file_id: id, upload: store.uploadTarget(key, { contentType: format.mime, size }) };
}

/** L'équipe qui gère la ressource à laquelle le fichier est rattaché. */
async function teamOf(actor, f) {
  if (f.purpose === 'avatar') return isTeam(actor, 'clients');
  if (f.enrollment_id || f.session_id) return isTeam(actor, 'trainings');
  if (f.quote_id) return isTeam(actor, 'quotes');
  if (f.order_id) return isTeam(actor, 'orders');
  if (f.message_id) {
    const m = await one('select quote_id from messages where id = $1', [f.message_id]);
    return isTeam(actor, m?.quote_id ? 'quotes' : 'orders');
  }
  return isTeam(actor, 'content');
}

async function loadFile(id) {
  const f = await one(`select ${FILE_COLS}, f.storage_key, f.driver from uploaded_files f where f.id = $1`, [id]);
  if (!f) throw new HttpError(404, 'Fichier introuvable.');
  return f;
}

/** Étape 3 : vérifie le fichier réellement stocké. */
export async function confirmUpload(actor, id) {
  const f = await loadFile(id);
  if (!(await teamOf(actor, f)) && f.owner_id !== actor?.id) throw new HttpError(404, 'Fichier introuvable.');
  if (f.status === 'ready') return publicFile(f);
  if (f.status === 'rejected') throw new HttpError(409, 'Ce fichier a été refusé.');
  const store = storage();
  const stat = await store.head(f.storage_key);
  if (!stat) throw new HttpError(409, 'Le fichier n’a pas encore été reçu par le stockage. Réessayez l’envoi.');
  const key = Object.keys(FORMATS).find((k) => FORMATS[k].mime === f.mime_type && FORMATS[k].ext.includes(f.storage_key.split('.').pop()));
  const head = await store.readStart(f.storage_key, 64);
  const problem =
    stat.size !== f.size_bytes ? 'la taille reçue ne correspond pas'
      : !FORMATS[key]?.check(head) ? `son contenu n’est pas un vrai fichier .${f.storage_key.split('.').pop()}`
        : null;
  if (problem) {
    await store.remove(f.storage_key);
    await query(`update uploaded_files set status = 'rejected' where id = $1 returning id`, [id]);
    await logActivity(actor, 'file.rejected', 'file', id, { reason: problem, name: f.original_name });
    throw new HttpError(422, `Fichier refusé : ${problem}.`);
  }
  const row = await one(`update uploaded_files f set status = 'ready', confirmed_at = now() where id = $1 returning ${FILE_COLS}`, [id]);
  const target = f.quote_id ? ['quote', f.quote_id] : f.order_id ? ['order', f.order_id] : ['file', id];
  await logActivity(actor, 'file.uploaded', target[0], target[1], { file_id: id, name: f.original_name, size: f.size_bytes });
  return publicFile(row);
}

const publicFile = (f) => ({
  id: f.id, purpose: f.purpose, original_name: f.original_name, mime_type: f.mime_type, size_bytes: f.size_bytes,
  visibility: f.visibility, status: f.status, created_at: f.created_at,
});

/** Lecture : public, administration, auteur du fichier, ou client propriétaire du devis / de la commande. */
export async function canRead(actor, f) {
  if (f.status !== 'ready') return Boolean(actor?.id && f.owner_id === actor.id) || teamOf(actor, f);
  if (f.visibility === 'public') return true;
  if (!actor?.id) return false;
  if (f.owner_id === actor.id || (await teamOf(actor, f))) return true;
  if (f.quote_id) return Boolean(await one('select 1 from quotes where id = $1 and user_id = $2', [f.quote_id, actor.id]));
  if (f.order_id) return Boolean(await one('select 1 from orders where id = $1 and user_id = $2', [f.order_id, actor.id]));
  if (f.enrollment_id) return Boolean(await one('select 1 from enrollments where id = $1 and user_id = $2', [f.enrollment_id, actor.id]));
  if (f.session_id) return Boolean(await one(`select 1 from enrollments where session_id = $1 and user_id = $2 and status in ('Inscrit', 'Terminé')`, [f.session_id, actor.id]));
  if (f.message_id) {
    return Boolean(await one(
      `select 1 from messages m
         left join quotes q on q.id = m.quote_id left join orders o on o.id = m.order_id
        where m.id = $1 and coalesce(q.user_id, o.user_id) = $2`,
      [f.message_id, actor.id],
    ));
  }
  return false;
}

/** Adresse de téléchargement temporaire (5 minutes), après contrôle des droits. */
export async function downloadUrl(actor, id, { inline = false } = {}) {
  const f = await loadFile(id);
  if (!(await canRead(actor, f))) throw new HttpError(404, 'Fichier introuvable.');
  if (f.status !== 'ready') throw new HttpError(409, 'Ce fichier n’est pas encore disponible.');
  // Seules les images s'affichent dans le navigateur ; le reste est toujours téléchargé.
  const show = inline && f.mime_type.startsWith('image/');
  return storage().downloadUrl(f.storage_key, { filename: f.original_name, inline: show, contentType: f.mime_type });
}

export async function deleteFile(actor, id) {
  const f = await loadFile(id);
  const team = await teamOf(actor, f);
  if (!team && f.owner_id !== actor?.id) throw new HttpError(404, 'Fichier introuvable.');
  if (!team && f.order_id) throw new HttpError(409, 'Les fichiers d’une commande ne peuvent être retirés que par l’atelier.');
  await storage().remove(f.storage_key);
  await query('delete from uploaded_files where id = $1 returning id', [id]);
  const target = f.quote_id ? ['quote', f.quote_id] : f.order_id ? ['order', f.order_id] : ['file', id];
  await logActivity(actor, 'file.deleted', target[0], target[1], { file_id: id, name: f.original_name });
  return { ok: true };
}

/** Fichiers prêts d'une ressource (pour l'affichage d'un devis, d'une commande…). */
export async function filesOf(type, id) {
  const column = TARGET_COLUMN[type];
  return query(
    `select f.id, f.original_name, f.mime_type, f.size_bytes::float8 as size_bytes, f.created_at, u.role as owner_role
       from uploaded_files f left join users u on u.id = f.owner_id
      where f.${column} = $1 and f.status = 'ready' order by f.created_at`,
    [id],
  );
}

/** Efface les envois jamais terminés (plus de 24 h). */
export async function cleanupPending(actor) {
  const rows = await query(`select id, storage_key from uploaded_files where status in ('pending','rejected') and created_at < now() - interval '24 hours'`);
  if (!rows.length) return { removed: 0 };
  const store = storage();
  for (const r of rows) {
    await store.remove(r.storage_key).catch(() => {});
    await query('delete from uploaded_files where id = $1 returning id', [r.id]);
  }
  await logActivity(actor, 'file.cleanup', 'file', 'pending', { removed: rows.length });
  return { removed: rows.length };
}
