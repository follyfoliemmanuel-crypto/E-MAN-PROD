// Stockage des fichiers envoyés (pièces jointes, photos de réalisations).
//
// - « s3 » : tout stockage compatible S3 — Cloudflare R2 (recommandé : 10 Go gratuits,
//   sans frais de sortie), AWS S3, Backblaze B2, Wasabi, MinIO. Le navigateur envoie le
//   fichier directement au stockage grâce à une adresse signée et limitée dans le temps :
//   le fichier ne passe pas par Vercel (dont les requêtes sont limitées à 4,5 Mo).
//   Le seau reste PRIVÉ : chaque téléchargement passe par /api/files, qui vérifie les droits.
// - « local » : dossier .uploads/ du projet, pour développer sans compte de stockage.
//   Refusé en ligne (le disque de Vercel n'est pas conservé).
//
// La signature AWS « SigV4 » est calculée ici avec node:crypto, sans SDK.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const sha256hex = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Adresse pré-signée SigV4 (méthode « query string »).
 * Vérifiée contre l'exemple officiel de la documentation AWS (voir tests).
 */
export function presignUrl({ method, url, region, accessKeyId, secretAccessKey, expires = 300, headers = {}, query = {}, date = new Date(), service = 's3' }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const hdrs = { host: u.host };
  for (const [k, v] of Object.entries(headers)) hdrs[k.toLowerCase()] = String(v).trim();
  const signed = Object.keys(hdrs).sort();
  const params = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signed.join(';'),
  };
  const canonicalQuery = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const canonicalRequest = [
    method,
    u.pathname,
    canonicalQuery,
    signed.map((h) => `${h}:${hdrs[h]}\n`).join(''),
    signed.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
  return `${u.origin}${u.pathname}?${canonicalQuery}&X-Amz-Signature=${hmac(key, toSign).toString('hex')}`;
}

const contentDisposition = (filename, inline) =>
  `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${enc(filename)}`;

function s3Driver(env) {
  const endpoint = env.S3_ENDPOINT.replace(/\/$/, '');
  const base = { region: env.S3_REGION || 'auto', accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY };
  const objectUrl = (key) => `${endpoint}/${enc(env.S3_BUCKET)}/${key.split('/').map(enc).join('/')}`;
  const sign = (method, key, opts = {}) => presignUrl({ ...base, method, url: objectUrl(key), ...opts });
  return {
    name: 's3',
    /** Envoi direct depuis le navigateur. Type et taille sont signés : le stockage refuse tout autre fichier. */
    uploadTarget(key, { contentType, size }) {
      return {
        method: 'PUT',
        url: sign('PUT', key, { expires: 600, headers: { 'content-type': contentType, 'content-length': size } }),
        headers: { 'Content-Type': contentType },
      };
    },
    downloadUrl(key, { filename, inline = false, contentType }) {
      if (inline && env.S3_PUBLIC_URL && key.startsWith('public/')) return `${env.S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
      return sign('GET', key, {
        expires: 300,
        query: { 'response-content-disposition': contentDisposition(filename, inline), 'response-content-type': contentType },
      });
    },
    async head(key) {
      const r = await fetch(sign('HEAD', key, { expires: 60 }), { method: 'HEAD' });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Stockage : réponse ${r.status} à la vérification du fichier.`);
      return { size: Number(r.headers.get('content-length')), contentType: r.headers.get('content-type') };
    },
    async readStart(key, n = 64) {
      const r = await fetch(sign('GET', key, { expires: 60 }), { headers: { Range: `bytes=0-${n - 1}` } });
      if (!r.ok) throw new Error(`Stockage : réponse ${r.status} à la lecture du fichier.`);
      return Buffer.from(await r.arrayBuffer()).subarray(0, n);
    },
    async remove(key) {
      const r = await fetch(sign('DELETE', key, { expires: 60 }), { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw new Error(`Stockage : réponse ${r.status} à la suppression.`);
    },
  };
}

// --- Stockage local (développement) -----------------------------------------
let localSecret = null;
const secretOf = (env) => (localSecret ||= env.FILES_SECRET || randomBytes(32).toString('hex'));
const localSig = (env, parts) => createHmac('sha256', secretOf(env)).update(parts.join('|')).digest('hex');

export function verifyLocalSignature(env, q) {
  const parts = [q.local, q.key, q.type || '', q.size || '', q.name || '', q.inline || '', q.exp];
  const expected = Buffer.from(localSig(env, parts));
  const given = Buffer.from(String(q.sig || ''));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(403, 'Lien de fichier invalide.');
  if (Number(q.exp) < Date.now() / 1000) throw new HttpError(403, 'Lien de fichier expiré. Rechargez la page.');
  if (!/^[a-z_]+\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$|^public\/[a-z_]+\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(q.key)) {
    throw new HttpError(400, 'Clé de fichier invalide.');
  }
}

function localDriver(env) {
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
  return {
    name: 'local',
    uploadTarget(key, { contentType, size }) {
      return { method: 'PUT', url: link({ local: 'put', key, type: contentType, size: String(size) }), headers: { 'Content-Type': contentType } };
    },
    downloadUrl(key, { filename, inline = false, contentType }) {
      return link({ local: 'get', key, type: contentType, name: filename, inline: inline ? '1' : '' });
    },
    async head(key) {
      const { fs, file } = await fsOps();
      try {
        const st = await fs.stat(file(key));
        const meta = JSON.parse(await fs.readFile(file(key) + '.meta.json', 'utf8'));
        return { size: st.size, contentType: meta.contentType };
      } catch {
        return null;
      }
    },
    async readStart(key, n = 64) {
      const { fs, file } = await fsOps();
      const fh = await fs.open(file(key));
      try {
        const buf = Buffer.alloc(n);
        const { bytesRead } = await fh.read(buf, 0, n, 0);
        return buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    },
    async remove(key) {
      const { fs, file } = await fsOps();
      await fs.rm(file(key), { force: true });
      await fs.rm(file(key) + '.meta.json', { force: true });
    },
    /** Réception du fichier (PUT /api/files?local=put…), taille contrôlée pendant la lecture. */
    async write(key, req, { size, contentType }) {
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
    async read(key) {
      const { fs, file } = await fsOps();
      return fs.readFile(file(key));
    },
  };
}

/** Stockage configuré, ou erreur claire s'il ne l'est pas. */
export function storage(env = process.env) {
  const wanted = env.STORAGE_DRIVER || (env.S3_BUCKET ? 's3' : env.VERCEL ? '' : 'local');
  if (wanted === 's3') {
    const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
    if (missing.length) throw new HttpError(503, `Stockage des fichiers incomplet : ${missing.join(', ')} manquant(s).`);
    return s3Driver(env);
  }
  if (wanted === 'local') {
    if (env.VERCEL) throw new HttpError(503, 'Le stockage local n’est pas disponible en ligne : configurez S3_* (voir README).');
    return localDriver(env);
  }
  throw new HttpError(503, 'L’envoi de fichiers n’est pas encore activé sur le site. Envoyez vos fichiers sur WhatsApp.');
}
