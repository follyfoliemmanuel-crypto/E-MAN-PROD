// /api/files — fichiers joints (devis, commandes, messages) et images du site
//   POST {purpose, target_id, filename, mime_type, size}   préparer un envoi → adresse signée
//   POST {action: 'confirm', id}                            vérifier le fichier reçu
//   GET ?id=                     lien de téléchargement (redirection, 5 min), après contrôle des droits
//   GET ?id=&inline=1            idem, affiché dans le navigateur (images seulement)
//   GET ?id=&inline=1&direct=1   image d'origine par lien temporaire (secours de l'affichage)
//   GET ?id=&info=1              informations sur le fichier (JSON)
//   DELETE {id}                  supprimer (auteur ou admin)
//   POST {action: 'cleanup'}     admin : effacer les envois abandonnés
//   GET ?limits=1                tailles et formats acceptés par usage (public)
//   GET ?cron=cleanup            Vercel Cron (en-tête Authorization: Bearer CRON_SECRET) : nettoyage quotidien
// Le navigateur envoie les fichiers directement à Cloudinary : ils ne transitent jamais par
// cette fonction. En développement sans Cloudinary : PUT/GET ?local=… (dossier .uploads/).
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { applyRetention } from './_lib/services/retention.js';
import { handler, send, readJson, HttpError, readQuery, Q, logError } from './_lib/http.js';
import { currentUser, requireUser, requireAdmin, rateLimit } from './_lib/auth.js';
import { actorOf } from './_lib/activity.js';
import { provider, storageStatus, verifyLocalSignature } from './_lib/storage.js';
import * as s from './_lib/schemas.js';
import * as files from './_lib/services/files.js';

// Liste blanche à la frontière de l'API : extensions et types acceptés par AU MOINS un usage.
// Chaque usage applique ensuite sa propre liste (plus courte), puis le fichier réellement reçu
// est contrôlé (taille, format décodé, premiers octets) avant d'être marqué « prêt ».
const EXTENSIONS = Object.values(files.FORMATS).flatMap((f) => f.ext);
const MIME_TYPES = new Set(['', 'application/octet-stream', ...Object.values(files.FORMATS).flatMap((f) => [f.mime, ...f.aliases])]);
const ABSOLUTE_MAX = 200 * 1024 * 1024; // aucun usage n'accepte plus (les limites réelles sont bien plus basses)
const uploadSchema = z.object({
  purpose: s.oneOf(Object.keys(files.PURPOSES), 'Usage du fichier'),
  target_id: s.optionalUuid('Ressource'),
  filename: z.string({ required_error: 'Nom du fichier obligatoire.' }).trim().min(1).max(255)
    // Pas d'extension exécutable ni de double extension trompeuse : seule la DERNIÈRE compte, et elle doit être connue.
    .refine((n) => EXTENSIONS.includes(n.split('.').pop().toLowerCase()) && n.includes('.'), { message: 'Format de fichier non accepté.', params: { status: 415 } })
    .refine((n) => !/\.(php\d?|phtml|html?|xhtml|svg|js|mjs|cjs|exe|bat|cmd|sh|ps1|jar|py|pl|cgi|asp|aspx|jsp|htaccess)(\.|$)/i.test(n), { message: 'Format de fichier non accepté.', params: { status: 415 } }),
  mime_type: z.string().trim().max(120).optional().default('')
    .refine((m) => MIME_TYPES.has(m.toLowerCase()), { message: 'Type de fichier non accepté.', params: { status: 415 } }),
  size: z.number({ invalid_type_error: 'Taille du fichier invalide.' }).int().min(1, 'Fichier vide.')
    .max(ABSOLUTE_MAX, { message: 'Fichier trop volumineux.' }),
});
/** Comme s.parse, mais garde le code HTTP adapté (415 format refusé, 413 trop volumineux). */
function parseUpload(body) {
  const r = uploadSchema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const status = issue?.params?.status || (issue?.code === 'too_big' && issue.path[0] === 'size' ? 413 : 400);
  throw new HttpError(status, issue?.message || 'Requête invalide.');
}

export default handler({
  async POST(req, res) {
    const body = await readJson(req);
    if (body.action === 'confirm') {
      const actor = actorOf(await requireUser(req));
      return send(res, 200, { file: await files.confirmUpload(actor, s.parse(s.uuid('Fichier'), body.id)) });
    }
    if (body.action === 'cleanup') {
      const actor = actorOf(await requireAdmin(req));
      return send(res, 200, await files.cleanupPending(actor));
    }
    const user = await requireUser(req);
    await rateLimit(`upload:${user.id}`, 40, 60, 'Trop de fichiers envoyés. Réessayez dans une heure.');
    send(res, 201, await files.createUpload(actorOf(user), parseUpload(body)));
  },

  async GET(req, res) {
    const q = readQuery(req, {
      limits: Q.flag, cron: Q.oneOf(['cleanup']), id: Q.id('Fichier'), inline: Q.flag, direct: Q.flag, info: Q.flag, stream: Q.flag,
      // Lien du stockage local de développement (signé par le serveur).
      local: Q.oneOf(['get', 'put']), key: Q.text(200), type: Q.text(120), size: Q.text(15), name: Q.text(255), exp: Q.text(15), sig: Q.text(64),
    });
    if (q.limits === '1') {
      return send(res, 200, { limits: files.uploadLimits() });
    }
    if (q.cron === 'cleanup') {
      // Nettoyage quotidien lancé par Vercel Cron (vercel.json), authentifié par CRON_SECRET.
      const secret = process.env.CRON_SECRET;
      const given = String(req.headers.authorization || '');
      if (!secret || given.length !== secret.length + 7 || !timingSafeEqual(Buffer.from(given), Buffer.from(`Bearer ${secret}`))) throw new HttpError(404, 'Adresse inconnue.');
      const cleaned = await files.cleanupPending({ id: null, role: 'system', permissions: [] });
      // Durée de conservation (3 ans) : anonymise les demandes sans suite, sans rien supprimer.
      const retention = await applyRetention().catch((err) => { logError('retention.failed', err); return { error: true }; });
      return send(res, 200, { ...cleaned, retention });
    }
    if (q.local === 'get') {
      // Lecture directe : seulement pour le stockage local de développement (jamais sur Vercel).
      if (process.env.VERCEL) throw new HttpError(404, 'Adresse inconnue.');
      verifyLocalSignature(process.env, q);
      const data = await provider('local').readKey(q.key).catch(() => null);
      if (!data) throw new HttpError(404, 'Fichier introuvable.');
      const type = Object.values(files.FORMATS).some((f) => f.mime === q.type) ? q.type : 'application/octet-stream';
      const inline = q.inline === '1' && type.startsWith('image/');
      res.statusCode = 200;
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(String(q.name || 'fichier').slice(0, 200))}`);
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.end(data);
    }
    if (!q.id) throw new HttpError(400, 'Fichier manquant.');
    const id = q.id;
    const actor = actorOf(await currentUser(req));
    if (q.stream === '1') {
      // Message vocal lu dans la bulle : octets servis par le site, avec lecture partielle (Range)
      // pour avancer / reculer dans l'enregistrement.
      const { data, mime } = await files.readAudio(actor, id);
      const total = data.length;
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      let start = 0; let end = total - 1; let status = 200;
      if (m && (m[1] || m[2])) {
        start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
        end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
        if (start > end || start >= total) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${total}`); return res.end(); }
        status = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      }
      res.statusCode = status;
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
    }
    const url = await files.downloadUrl(actor, id, { inline: q.inline === '1', direct: q.direct === '1' });
    if (q.info === '1') return send(res, 200, { url });
    res.statusCode = 302;
    res.setHeader('Location', url);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end();
  },

  async PUT(req, res) {
    // Réception directe : seulement pour le stockage local de développement.
    const q = readQuery(req, { local: Q.oneOf(['put']), key: Q.text(200), type: Q.text(120), size: Q.text(15), name: Q.text(255), inline: Q.flag, exp: Q.text(15), sig: Q.text(64) });
    if (q.local !== 'put' || process.env.VERCEL) throw new HttpError(404, 'Adresse inconnue.');
    verifyLocalSignature(process.env, q);
    if (storageStatus().active !== 'local') throw new HttpError(404, 'Adresse inconnue.');
    const store = provider('local');
    const contentType = s.parse(z.string().max(120), String(req.headers['content-type'] || ''));
    if (contentType !== q.type) throw new HttpError(400, 'Type de fichier différent de celui annoncé.');
    await store.receive(q.key, req, { size: Number(q.size), contentType: q.type });
    res.statusCode = 200;
    res.end();
  },

  async DELETE(req, res) {
    const actor = actorOf(await requireUser(req));
    const { id } = s.parse(z.object({ id: s.uuid('Fichier') }), await readJson(req));
    send(res, 200, await files.deleteFile(actor, id));
  },
}, { raw: ['PUT'] });
