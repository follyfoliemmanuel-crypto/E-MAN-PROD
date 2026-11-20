// Ancien stockage compatible S3 (réglage S3_* de la v3.0), conservé uniquement pour LIRE et
// SUPPRIMER les fichiers déjà enregistrés avec driver = 's3', le temps de leur migration
// vérifiée vers Cloudinary. Aucun nouvel envoi n'y est fait.
// La signature AWS « SigV4 » est calculée avec node:crypto, sans SDK ; elle est vérifiée
// contre l'exemple officiel de la documentation AWS.
import { createHmac, createHash } from 'node:crypto';

export const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const sha256hex = (data) => createHash('sha256').update(data).digest('hex');

/** Adresse pré-signée SigV4 (méthode « query string »). */
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

export const contentDisposition = (filename, inline) =>
  `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${enc(filename)}`;

/** Lit les variables <prefix>_* ; config null si incomplètes. */
export function s3Config(env, prefix) {
  const c = {
    endpoint: env[`${prefix}_ENDPOINT`],
    bucket: env[`${prefix}_BUCKET`],
    accessKeyId: env[`${prefix}_ACCESS_KEY_ID`],
    secretAccessKey: env[`${prefix}_SECRET_ACCESS_KEY`],
    region: env[`${prefix}_REGION`] || 'auto',
    publicUrl: env[`${prefix}_PUBLIC_URL`] || null,
  };
  const missing = ['ENDPOINT', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'].filter((k) => !env[`${prefix}_${k}`]);
  return { config: missing.length ? null : c, missing: missing.map((k) => `${prefix}_${k}`), any: missing.length < 4 };
}

const xmlValues = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));

/**
 * Pilote S3 (ancien stockage). `name` est la valeur de uploaded_files.driver (« s3 »).
 */
export function s3Provider(name, cfg) {
  const endpoint = cfg.endpoint.replace(/\/$/, '');
  const base = { region: cfg.region, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey };
  const objectUrl = (key) => `${endpoint}/${enc(cfg.bucket)}/${key.split('/').map(enc).join('/')}`;
  const sign = (method, key, opts = {}) => presignUrl({ ...base, method, url: objectUrl(key), ...opts });
  const check = (r, what) => { if (!r.ok) throw new Error(`${name} : réponse ${r.status} (${what}).`); return r; };
  return {
    name,
    kind: 's3',
    /** Envoi direct depuis le navigateur. Type et taille sont signés : le stockage refuse tout autre fichier. */
    prepareUpload({ key, contentType, size }) {
      return {
        storage_key: key,
        upload: { method: 'PUT', url: sign('PUT', key, { expires: 600, headers: { 'content-type': contentType, 'content-length': size } }), headers: { 'Content-Type': contentType } },
      };
    },
    /** Ce que le stockage a réellement reçu : taille et premiers octets. null s'il n'y a rien. */
    async inspect(row, n = 64) {
      const h = await fetch(sign('HEAD', row.storage_key, { expires: 60 }), { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      if (h.status === 404) return null;
      check(h, 'vérification');
      if (n <= 0) return { size: Number(h.headers.get('content-length')), contentType: h.headers.get('content-type'), head: Buffer.alloc(0) };
      const r = check(await fetch(sign('GET', row.storage_key, { expires: 60 }), { headers: { Range: `bytes=0-${n - 1}` }, signal: AbortSignal.timeout(15000) }), 'lecture');
      return { size: Number(h.headers.get('content-length')), contentType: h.headers.get('content-type'), head: Buffer.from(await r.arrayBuffer()).subarray(0, n) };
    },
    downloadUrl(row, { filename, inline = false }) {
      if (inline && cfg.publicUrl && row.storage_key.startsWith('public/')) return `${cfg.publicUrl.replace(/\/$/, '')}/${row.storage_key}`;
      return sign('GET', row.storage_key, {
        expires: 300,
        query: { 'response-content-disposition': contentDisposition(filename, inline), 'response-content-type': row.mime_type },
      });
    },
    async remove(row) {
      const r = await fetch(sign('DELETE', row.storage_key, { expires: 60 }), { method: 'DELETE', signal: AbortSignal.timeout(15000) });
      if (!r.ok && r.status !== 404) throw new Error(`${name} : réponse ${r.status} (suppression).`);
    },
    /** Contenu complet (sauvegarde, contrôle d'intégrité). Utilisé hors de Vercel. */
    async read(row) {
      const r = await fetch(sign('GET', row.storage_key, { expires: 300 }), { signal: AbortSignal.timeout(120000) });
      if (r.status === 404) return null;
      check(r, 'lecture');
      return Buffer.from(await r.arrayBuffer());
    },
    /** Écriture côté serveur (restauration, sauvegarde vers B2). */
    async write(key, buffer, { contentType = 'application/octet-stream', metadata = {} } = {}) {
      const headers = { 'content-type': contentType, 'content-length': buffer.length };
      for (const [k, v] of Object.entries(metadata)) headers[`x-amz-meta-${k}`] = v;
      check(await fetch(sign('PUT', key, { expires: 300, headers }), { method: 'PUT', headers: { 'Content-Type': contentType, ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`x-amz-meta-${k}`, v])) }, body: buffer, signal: AbortSignal.timeout(120000) }), 'écriture');
      return { storage_key: key };
    },
    /** Liste des objets (ListObjectsV2), pour repérer les fichiers orphelins. */
    async list(prefix = '') {
      const out = [];
      let token = null;
      do {
        const query = { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) };
        const url = presignUrl({ ...base, method: 'GET', url: `${endpoint}/${enc(cfg.bucket)}`, query, expires: 60 });
        const xml = await check(await fetch(url, { signal: AbortSignal.timeout(30000) }), 'liste').text();
        const keys = xmlValues(xml, 'Key');
        const sizes = xmlValues(xml, 'Size').map(Number);
        const dates = xmlValues(xml, 'LastModified');
        keys.forEach((k, i) => out.push({ key: k, size: sizes[i], modified: dates[i] }));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlValues(xml, 'NextContinuationToken')[0] : null;
      } while (token);
      return out;
    },
  };
}
