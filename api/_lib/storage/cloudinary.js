// Cloudinary : fournisseur unique des fichiers d'E-MAN PROD.
//
// Types de ressources :
//   image  JPG, PNG, WebP (photos, réalisations, photos de profil, images jointes)
//   raw    PDF, AI, EPS, PSD, CDR, ZIP, DOCX, XLSX, PPTX (fichiers bruts, jamais transformés)
// Types de livraison :
//   upload         public : réalisations et images du site uniquement
//   authenticated  privé  : tout le reste ; accessible seulement par adresse signée
//
// Sécurité :
// - envoi direct navigateur → Cloudinary, signé ICI : identifiant aléatoire, type de
//   livraison, formats autorisés et interdiction d'écraser sont couverts par la signature ;
// - la clé secrète ne quitte jamais le serveur (le navigateur reçoit api_key, qui est publique) ;
// - confirmation : taille et format relus chez Cloudinary (API d'administration), et pour les
//   fichiers bruts, 64 premiers octets relus pour contrôler la vraie signature du format ;
// - fichiers privés : lien de téléchargement signé et LIMITÉ DANS LE TEMPS (5 min), donné après
//   contrôle des droits (API « download » de Cloudinary, équivalent de private_download_url) ;
// - photos de profil : adresse de livraison signée (recadrée), sans expiration sur l'offre
//   gratuite, non devinable, donnée après contrôle des droits.
//
// Algorithmes vérifiés sur les exemples officiels (cloudinary.com/documentation) :
//   signature d'API     : SHA-1 hex de « a=1&b=2…<secret> » (paramètres triés)
//   signature d'adresse : 8 premiers caractères du SHA-1 base64url de « <chemin><secret> »
import { createHash } from 'node:crypto';

export function cloudinaryConfig(env = process.env) {
  const names = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = names.filter((k) => !env[k]);
  if (missing.length) return { config: null, missing, any: missing.length < names.length };
  // Adresses de remplacement : réservées aux tests automatiques, ignorées sur Vercel.
  const test = !env.VERCEL;
  const maxMb = Number(env.CLOUDINARY_MAX_FILE_MB) > 0 ? Number(env.CLOUDINARY_MAX_FILE_MB) : 10;
  return {
    config: {
      cloud: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      secret: env.CLOUDINARY_API_SECRET,
      folder: (env.CLOUDINARY_FOLDER || 'emanprod').replace(/^\/+|\/+$/g, ''),
      maxBytes: Math.floor(maxMb * 1024 * 1024),
      // Signature des appels à l'API : SHA-256 (Cloudinary accepte SHA-1 et SHA-256 par défaut).
      // CLOUDINARY_SIGNATURE_ALGORITHM=sha1 permet de revenir à l'ancien format si un compte le refusait.
      algo: String(env.CLOUDINARY_SIGNATURE_ALGORITHM || 'sha256').toLowerCase() === 'sha1' ? 'sha1' : 'sha256',
      api: (test && env.CLOUDINARY_TEST_API_BASE) || 'https://api.cloudinary.com',
      delivery: (test && env.CLOUDINARY_TEST_DELIVERY_BASE) || 'https://res.cloudinary.com',
    },
    missing: [],
    any: true,
  };
}

/** Signature des appels d'API : paramètres non vides, triés, secret ajouté, SHA-1 hex. */
export function apiSignature(params, secret, algo = 'sha1') {
  const s = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort().map((k) => `${k}=${Array.isArray(params[k]) ? params[k].join(',') : params[k]}`).join('&');
  return createHash(algo === 'sha256' ? 'sha256' : 'sha1').update(s + secret).digest('hex');
}

/** Signature d'adresse de livraison : composant « s--XXXXXXXX-- ». */
export function deliverySignature(path, secret) {
  return createHash('sha1').update(path + secret).digest('base64url').slice(0, 8);
}

/** Variantes d'affichage des images (l'original n'est jamais modifié). */
export const VARIANTS = {
  gallery: 'c_limit,w_1600/f_auto,q_auto',
  thumb: 'c_fill,w_600,h_450/f_auto,q_auto',
  avatar: 'c_fill,g_face,w_256,h_256/f_auto,q_auto',
};

const IMAGE_FORMATS = ['jpg', 'png', 'webp'];
export const resourceTypeOf = (ext) => (IMAGE_FORMATS.includes(ext) ? 'image' : 'raw');

export function cloudinaryProvider(cfg) {
  const auth = 'Basic ' + Buffer.from(`${cfg.apiKey}:${cfg.secret}`).toString('base64');
  const now = () => Math.floor(Date.now() / 1000);
  const fail = (r, what) => new Error(`cloudinary : réponse ${r.status} (${what}).`);
  const rt = (row) => row.resource_type || 'image';
  const dt = (row) => row.remote_type || (row.visibility === 'public' ? 'upload' : 'authenticated');
  /** Partie « identifiant.format » d'une adresse : les fichiers bruts gardent leur extension dans l'identifiant. */
  const asset = (row) => (rt(row) === 'raw' ? row.storage_key : `${row.storage_key}.${row.remote_format}`);

  /** Adresse de livraison signée (images publiques, photos de profil). */
  function deliveryUrl(row, variant = null) {
    if (!row.remote_version) throw new Error('cloudinary : fichier pas encore confirmé.');
    const t = variant ? VARIANTS[variant] : '';
    const path = `${t ? t + '/' : ''}v${row.remote_version}/${asset(row)}`;
    return `${cfg.delivery}/${cfg.cloud}/${rt(row)}/${dt(row)}/s--${deliverySignature(path, cfg.secret)}--/${path}`;
  }

  /** Lien de téléchargement signé et temporaire de l'original (API « download »). */
  function privateDownloadUrl(row, { attachment = true, expires = 300 } = {}) {
    const t = now();
    const params = {
      attachment: attachment ? 'true' : undefined,
      expires_at: String(t + expires),
      format: rt(row) === 'raw' ? undefined : row.remote_format,
      public_id: row.storage_key,
      timestamp: String(t),
      type: dt(row),
    };
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const q = new URLSearchParams({ ...clean, api_key: cfg.apiKey, signature: apiSignature(clean, cfg.secret, cfg.algo) });
    return `${cfg.api}/v1_1/${cfg.cloud}/${rt(row)}/download?${q}`;
  }

  return {
    name: 'cloudinary',
    kind: 'cloudinary',
    folder: cfg.folder,
    maxBytes: cfg.maxBytes,
    deliveryUrl,
    privateDownloadUrl,
    /**
     * Prépare un envoi direct. Clé = identifiant public Cloudinary, dans le dossier de
     * l'application ; les fichiers bruts gardent l'extension dans leur identifiant.
     */
    prepareUpload({ key, ext, visibility }) {
      const resourceType = resourceTypeOf(ext);
      const base = `${cfg.folder}/${key.replace(/^public\//, '').replace(/\.[a-z0-9]+$/, '')}`;
      const publicId = resourceType === 'raw' ? `${base}.${ext}` : base;
      const type = visibility === 'public' ? 'upload' : 'authenticated';
      const params = {
        allowed_formats: resourceType === 'image' ? ext === 'jpg' ? 'jpg,jpeg' : ext : undefined,
        overwrite: 'false',
        public_id: publicId,
        timestamp: String(now()),
        type,
      };
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
      return {
        storage_key: publicId,
        remote_type: type,
        resource_type: resourceType,
        upload: {
          method: 'POST',
          url: `${cfg.api}/v1_1/${cfg.cloud}/${resourceType}/upload`,
          fields: { ...clean, api_key: cfg.apiKey, signature: apiSignature(clean, cfg.secret, cfg.algo) },
        },
      };
    },
    /** Ce que Cloudinary a réellement enregistré (+ 64 premiers octets des fichiers bruts). */
    async inspect(row, n = 64) {
      const r = await fetch(`${cfg.api}/v1_1/${cfg.cloud}/resources/${rt(row)}/${dt(row)}/${row.storage_key}`, { headers: { Authorization: auth } });
      if (r.status === 404) return null;
      if (!r.ok) throw fail(r, 'vérification');
      const j = await r.json();
      const info = {
        size: Number(j.bytes), format: String(j.format || '').toLowerCase(), width: j.width || null, height: j.height || null,
        version: j.version, type: j.type, resourceType: j.resource_type,
      };
      if (rt(row) === 'raw' && n > 0) info.head = await readStart({ ...row, remote_version: j.version }, n);
      return info;
    },
    /** Adresse donnée après contrôle des droits. */
    downloadUrl(row, { inline = false, variant, direct = false } = {}) {
      // direct : image d'origine par lien de téléchargement temporaire, sans transformation
      // (secours si une adresse de livraison signée est refusée par le compte Cloudinary).
      if (direct && inline && rt(row) === 'image') return privateDownloadUrl(row, { attachment: false });
      if (dt(row) === 'upload') return inline ? deliveryUrl(row, variant || 'gallery') : privateDownloadUrl(row, { attachment: true });
      if (inline && row.purpose === 'avatar') return deliveryUrl(row, 'avatar');
      // Privé : original exact, lien de 5 minutes ; affiché seulement pour les images.
      return privateDownloadUrl(row, { attachment: !(inline && rt(row) === 'image') });
    },
    /** Adresse publique durable (réalisations), mise en cache par le CDN de Cloudinary. */
    publicUrl(row, variant = 'gallery') {
      return deliveryUrl(row, variant);
    },
    async remove(row) {
      const params = { invalidate: 'true', public_id: row.storage_key, timestamp: String(now()), type: dt(row) };
      const body = new URLSearchParams({ ...params, api_key: cfg.apiKey, signature: apiSignature(params, cfg.secret, cfg.algo) });
      const r = await fetch(`${cfg.api}/v1_1/${cfg.cloud}/${rt(row)}/destroy`, { method: 'POST', body });
      if (!r.ok) throw fail(r, 'suppression');
      const j = await r.json().catch(() => ({}));
      if (j.result !== 'ok' && j.result !== 'not found') throw new Error(`cloudinary : suppression refusée (${j.result || 'réponse inconnue'}).`);
    },
    /** Original complet (sauvegarde, contrôle d'intégrité) — utilisé hors de Vercel. */
    async read(row) {
      const r = await fetch(privateDownloadUrl(row, { attachment: true, expires: 600 }));
      if (r.status === 404) return null;
      if (!r.ok) throw fail(r, 'lecture');
      return Buffer.from(await r.arrayBuffer());
    },
    /** Envoi côté serveur (restauration) : même identifiant et même type que l'original. */
    async write(row, buffer) {
      const params = { overwrite: 'true', public_id: row.storage_key, timestamp: String(now()), type: dt(row) };
      const form = new FormData();
      for (const [k, v] of Object.entries({ ...params, api_key: cfg.apiKey, signature: apiSignature(params, cfg.secret, cfg.algo) })) form.append(k, v);
      form.append('file', new Blob([buffer], { type: row.mime_type || 'application/octet-stream' }), 'restauration');
      const r = await fetch(`${cfg.api}/v1_1/${cfg.cloud}/${rt(row)}/upload`, { method: 'POST', body: form });
      if (!r.ok) throw fail(r, 'restauration');
      const j = await r.json();
      return { remote_version: j.version, remote_format: rt(row) === 'raw' ? null : j.format, size: j.bytes };
    },
    /** Identifiants présents dans le dossier de l'application (fichiers orphelins). */
    async list() {
      const out = [];
      for (const resource of ['image', 'raw']) {
        for (const type of ['upload', 'authenticated']) {
          let cursor = null;
          do {
            const q = new URLSearchParams({ prefix: `${cfg.folder}/`, max_results: '500', ...(cursor ? { next_cursor: cursor } : {}) });
            const r = await fetch(`${cfg.api}/v1_1/${cfg.cloud}/resources/${resource}/${type}?${q}`, { headers: { Authorization: auth } });
            if (!r.ok) throw fail(r, 'liste');
            const j = await r.json();
            for (const x of j.resources || []) out.push({ key: x.public_id, size: x.bytes, modified: x.created_at, type, resource_type: resource });
            cursor = j.next_cursor || null;
          } while (cursor);
        }
      }
      return out;
    },
  };

  /** Premiers octets d'un fichier, sans télécharger le reste (lecture interrompue). */
  async function readStart(row, n) {
    const r = await fetch(privateDownloadUrl(row, { attachment: true, expires: 60 }), { headers: { Range: `bytes=0-${n - 1}` } });
    if (!r.ok) throw fail(r, 'lecture du début du fichier');
    const reader = r.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < n) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    return Buffer.concat(chunks).subarray(0, n);
  }
}
