// Stockage des fichiers : routeur unique de l'application.
//
//   Fichiers (images, PDF, pièces jointes, bureautique…) → Cloudinary (seul fournisseur)
//   Métadonnées, propriétaires, droits, statuts          → Neon (table uploaded_files)
//
// Deux fonctions, et aucune condition sur le fournisseur ailleurs dans l'application :
//   providerFor()      fournisseur des NOUVEAUX envois (Cloudinary ; local en développement) ;
//   providerOf(ligne)  fournisseur d'un fichier EXISTANT, lu dans sa propre ligne (driver) :
//                      un ancien fichier reste lisible même si la configuration change.
//
// Valeurs de uploaded_files.driver :
//   cloudinary  fournisseur actuel             variables CLOUDINARY_*
//   s3          ancien réglage S3_* (v3.0)     LECTURE et suppression seulement, le temps de la
//                                              migration vérifiée des anciens fichiers
//   local       dossier .uploads/, développement uniquement (refusé sur Vercel)
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';
import { s3Provider, s3Config, presignUrl, contentDisposition } from './storage/s3.js';
import { cloudinaryProvider, cloudinaryConfig } from './storage/cloudinary.js';

export { presignUrl };

// --- Stockage local (développement) -----------------------------------------
let localSecret = null;
const secretOf = (env) => (localSecret ||= env.FILES_SECRET || randomBytes(32).toString('hex'));
const localSig = (env, parts) => createHmac('sha256', secretOf(env)).update(parts.join('|')).digest('hex');
const LOCAL_KEY = /^(public\/)?[a-z_]+\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export function verifyLocalSignature(env, q) {
  const parts = [q.local, q.key, q.type || '', q.size || '', q.name || '', q.inline || '', q.exp];
  const expected = Buffer.from(localSig(env, parts));
  const given = Buffer.from(String(q.sig || ''));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(403, 'Lien de fichier invalide.');
  if (Number(q.exp) < Date.now() / 1000) throw new HttpError(403, 'Lien de fichier expiré. Rechargez la page.');
  if (!LOCAL_KEY.test(q.key)) throw new HttpError(400, 'Clé de fichier invalide.');
}

function localProvider(env) {
  const link = (params) => {
    const exp = String(Math.floor(Date.now() / 1000) + 600);
    const p = { ...params, exp };
    const sig = localSig(env, [p.local, p.key, p.type || '', p.size || '', p.name || '', p.inline || '', exp]);
    return '/api/files?' + new URLSearchParams({ ...p, sig }).toString();
  };
  const fsOps = async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), '.uploads');
    const file = (key) => path.join(dir, ...key.split('/'));
    return { fs, path, dir, file };
  };
  const self = {
    name: 'local',
    kind: 'local',
    prepareUpload({ key, contentType, size }) {
      return { storage_key: key, upload: { method: 'PUT', url: link({ local: 'put', key, type: contentType, size: String(size) }), headers: { 'Content-Type': contentType } } };
    },
    async inspect(row, n = 64) {
      const { fs, file } = await fsOps();
      try {
        const st = await fs.stat(file(row.storage_key));
        const meta = JSON.parse(await fs.readFile(file(row.storage_key) + '.meta.json', 'utf8'));
        const fh = await fs.open(file(row.storage_key));
        try {
          const buf = Buffer.alloc(n);
          const { bytesRead } = await fh.read(buf, 0, n, 0);
          return { size: st.size, contentType: meta.contentType, head: buf.subarray(0, bytesRead) };
        } finally {
          await fh.close();
        }
      } catch {
        return null;
      }
    },
    downloadUrl(row, { filename, inline = false }) {
      return link({ local: 'get', key: row.storage_key, type: row.mime_type, name: filename, inline: inline ? '1' : '' });
    },
    async remove(row) {
      const { fs, file } = await fsOps();
      await fs.rm(file(row.storage_key), { force: true });
      await fs.rm(file(row.storage_key) + '.meta.json', { force: true });
    },
    /** Réception du fichier (PUT /api/files?local=put…), taille contrôlée pendant la lecture. */
    async receive(key, req, { size, contentType }) {
      const { fs, path, file } = await fsOps();
      await fs.mkdir(path.dirname(file(key)), { recursive: true });
      const chunks = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > size) throw new HttpError(413, 'Le fichier est plus gros qu’annoncé.');
        chunks.push(chunk);
      }
      if (total !== size) throw new HttpError(400, 'Le fichier reçu est incomplet.');
      await fs.writeFile(file(key), Buffer.concat(chunks));
      await fs.writeFile(file(key) + '.meta.json', JSON.stringify({ contentType }));
    },
    async readKey(key) {
      const { fs, file } = await fsOps();
      return fs.readFile(file(key));
    },
    async read(row) {
      return self.readKey(row.storage_key).catch(() => null);
    },
    async write(key, buffer, { contentType = 'application/octet-stream' } = {}) {
      const { fs, path, file } = await fsOps();
      await fs.mkdir(path.dirname(file(key)), { recursive: true });
      await fs.writeFile(file(key), buffer);
      await fs.writeFile(file(key) + '.meta.json', JSON.stringify({ contentType }));
      return { storage_key: key };
    },
    async list() {
      const { fs, path, dir } = await fsOps();
      const out = [];
      const walk = async (d) => {
        for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) await walk(p);
          else if (!e.name.endsWith('.meta.json')) {
            const st = await fs.stat(p);
            out.push({ key: path.relative(dir, p).split(path.sep).join('/'), size: st.size, modified: st.mtime.toISOString() });
          }
        }
      };
      await walk(dir);
      return out;
    },
  };
  return self;
}

// --- Configuration ------------------------------------------------------------
/** État de la configuration (sans aucun secret), pour l'admin et les scripts. */
export function storageStatus(env = process.env) {
  const cdn = cloudinaryConfig(env);
  const legacy = s3Config(env, 'S3');
  const forced = env.STORAGE_DRIVER === 'local' && !env.VERCEL;
  const active = forced ? 'local' : cdn.config ? 'cloudinary' : env.VERCEL ? null : 'local';
  return {
    active,
    max_bytes: active === 'cloudinary' ? cdn.config.maxBytes : null,
    cloudinary: { configured: Boolean(cdn.config), missing: cdn.missing, cloud: cdn.config?.cloud || null, folder: cdn.config?.folder || null },
    legacy_s3: { configured: Boolean(legacy.config) },
    local: { allowed: !env.VERCEL },
  };
}

const NOT_ENABLED = 'L’envoi de fichiers n’est pas encore activé sur le site. Envoyez vos fichiers sur WhatsApp.';

/** Fournisseur par nom (valeur de la colonne driver). */
export function provider(name, env = process.env) {
  if (name === 'cloudinary') {
    const c = cloudinaryConfig(env);
    if (!c.config) throw new HttpError(503, `Stockage des fichiers incomplet : ${c.missing.join(', ')} manquant(s).`);
    return cloudinaryProvider(c.config);
  }
  if (name === 's3') {
    // Ancien stockage : conservé pour lire et supprimer les fichiers déjà enregistrés.
    const c = s3Config(env, 'S3');
    if (!c.config) throw new HttpError(503, 'Ce fichier est dans l’ancien stockage (S3_*), qui n’est plus configuré.');
    return s3Provider('s3', c.config);
  }
  if (name === 'local') {
    if (env.VERCEL) throw new HttpError(503, 'Le stockage local n’est pas disponible en ligne : configurez CLOUDINARY_* (voir docs/CONFIGURATION.md).');
    return localProvider(env);
  }
  throw new HttpError(503, NOT_ENABLED);
}

/** Fournisseur des nouveaux envois. */
export function providerFor(env = process.env) {
  const { active } = storageStatus(env);
  if (!active) throw new HttpError(503, NOT_ENABLED);
  return provider(active, env);
}

/** Fournisseur d'un fichier existant : celui indiqué dans sa ligne, jamais la configuration du moment. */
export function providerOf(row, env = process.env) {
  return provider(row.driver, env);
}

/** Compatibilité (v3.0). Préférer providerFor / providerOf. */
export function storage(env = process.env) {
  return providerFor(env);
}

/** Journal d'erreur utile, sans adresse signée ni secret. */
export function logStorageError(op, row, err) {
  console.error(JSON.stringify({ level: 'error', scope: 'storage', op, driver: row?.driver, file_id: row?.id, message: String(err?.message || err).replace(/https?:\/\/\S+/g, '[adresse]') }));
}

export { contentDisposition };
