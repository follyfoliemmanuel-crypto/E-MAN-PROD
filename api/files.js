// /api/files — fichiers joints (devis, commandes, messages) et images du site
//   POST {purpose, target_id, filename, mime_type, size}   préparer un envoi → adresse signée
//   POST {action: 'confirm', id}                            vérifier le fichier reçu
//   GET ?id=                     lien de téléchargement (redirection, 5 min), après contrôle des droits
//   GET ?id=&inline=1            idem, affiché dans le navigateur (images seulement)
//   GET ?id=&info=1              informations sur le fichier (JSON)
//   DELETE {id}                  supprimer (auteur ou admin)
//   POST {action: 'cleanup'}     admin : effacer les envois abandonnés
//   GET ?limits=1                tailles et formats acceptés par usage (public)
// Le navigateur envoie les fichiers directement à Cloudinary : ils ne transitent jamais par
// cette fonction. En développement sans Cloudinary : PUT/GET ?local=… (dossier .uploads/).
import { z } from 'zod';
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { currentUser, requireUser, requireAdmin, rateLimit } from './_lib/auth.js';
import { actorOf } from './_lib/activity.js';
import { provider, storageStatus, verifyLocalSignature } from './_lib/storage.js';
import * as s from './_lib/schemas.js';
import * as files from './_lib/services/files.js';

const uploadSchema = z.object({
  purpose: s.oneOf(Object.keys(files.PURPOSES), 'Usage du fichier'),
  target_id: s.optionalUuid('Ressource'),
  filename: s.text('Nom du fichier', { min: 1, max: 255, req: true }),
  mime_type: s.text('Type du fichier', { max: 120 }),
  size: s.int('Taille du fichier', { min: 1, max: 1e10, req: true }),
});

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
    send(res, 201, await files.createUpload(actorOf(user), s.parse(uploadSchema, body)));
  },

  async GET(req, res) {
    const q = req.query || {};
    if (q.limits === '1') {
      return send(res, 200, { limits: files.uploadLimits() });
    }
    if (q.local === 'get') {
      verifyLocalSignature(process.env, q);
      const data = await provider('local').readKey(q.key).catch(() => null);
      if (!data) throw new HttpError(404, 'Fichier introuvable.');
      res.statusCode = 200;
      res.setHeader('Content-Type', q.type);
      res.setHeader('Content-Disposition', `${q.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(q.name || 'fichier')}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.end(data);
    }
    const id = s.parse(s.uuid('Fichier'), q.id);
    const actor = actorOf(await currentUser(req));
    const url = await files.downloadUrl(actor, id, { inline: q.inline === '1' });
    if (q.info === '1') return send(res, 200, { url });
    res.statusCode = 302;
    res.setHeader('Location', url);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end();
  },

  async PUT(req, res) {
    // Réception directe : seulement pour le stockage local de développement.
    const q = req.query || {};
    if (q.local !== 'put') throw new HttpError(404, 'Adresse inconnue.');
    verifyLocalSignature(process.env, q);
    if (storageStatus().active !== 'local') throw new HttpError(404, 'Adresse inconnue.');
    const store = provider('local');
    if (String(req.headers['content-type'] || '') !== q.type) throw new HttpError(400, 'Type de fichier différent de celui annoncé.');
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
