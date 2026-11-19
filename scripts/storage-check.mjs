// Vérification RÉELLE du compte Cloudinary configuré (à lancer après avoir rempli .env) :
//   npm run storage:check
// Reproduit le parcours du site avec de petits fichiers de test, dans le dossier
// <CLOUDINARY_FOLDER>/verification/, puis les efface :
//   1. image publique : envoi signé direct, vérification, adresse optimisée, suppression ;
//   2. image privée   : envoi, refus sans signature, lien temporaire, suppression ;
//   3. PDF privé (raw) : envoi, 64 premiers octets, téléchargement, suppression
//      (échoue si « Allow delivery of PDF and ZIP files » n'est pas activé) ;
//   4. fichier refusé  : format non autorisé rejeté par Cloudinary.
// Aucune donnée de la base n'est lue ni modifiée. Aucun secret n'est affiché.
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const { cloudinaryConfig, cloudinaryProvider } = await import('../api/_lib/storage/cloudinary.js');
const c = cloudinaryConfig();
if (!c.config) {
  console.error(`✖ Cloudinary non configuré : ${c.missing.join(', ')} manquant(s) dans .env.`);
  process.exit(1);
}
const store = cloudinaryProvider(c.config);
let ok = 0;
let ko = 0;
const step = (cond, label, hint = '') => { if (cond) { ok += 1; console.log('  ✔ ' + label); } else { ko += 1; console.log('  ✖ ' + label + (hint ? `\n      → ${hint}` : '')); } };

/** PNG valide 2×2 (sans dépendance). */
function png() {
  const crc = (buf) => { let c2 = ~0; for (const b of buf) { c2 ^= b; for (let k = 0; k < 8; k++) c2 = (c2 >>> 1) ^ (0xedb88320 & -(c2 & 1)); } return ~c2 >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 200, 30, 30, 30, 40, 200, 0, 30, 30, 200, 200, 200, 200]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function send(prepared, buffer, mime, name) {
  const form = new FormData();
  for (const [k, v] of Object.entries(prepared.upload.fields)) form.append(k, v);
  form.append('file', new Blob([buffer], { type: mime }), name);
  const r = await fetch(prepared.upload.url, { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, error: j.error?.message };
}
async function roundTrip(label, { ext, mime, buffer, visibility }) {
  console.log(`\n${label}`);
  const key = `verification/${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
  const prepared = store.prepareUpload({ key, ext, visibility });
  const row = { storage_key: prepared.storage_key, resource_type: prepared.resource_type, remote_type: prepared.remote_type, visibility, purpose: 'verification', mime_type: mime };
  const up = await send(prepared, buffer, mime, `test.${ext}`);
  step(up.ok, `envoi direct signé (${prepared.resource_type}, ${prepared.remote_type})`, up.error || `réponse ${up.status} : vérifiez CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET`);
  if (!up.ok) return;
  try {
    const info = await store.inspect(row, 64);
    step(info && info.size === buffer.length, `relu par l'API d'administration : ${info?.size} octets, format ${info?.format || '(brut)'}`);
    row.remote_version = info.version;
    row.remote_format = prepared.resource_type === 'image' ? info.format : null;
    if (prepared.resource_type === 'raw') step(info.head?.subarray(0, 5).toString() === '%PDF-', 'lecture des 64 premiers octets (signature %PDF-)', 'activez « Allow delivery of PDF and ZIP files » (Settings > Security)');
    if (visibility === 'public') {
      const r = await fetch(store.publicUrl(row));
      step(r.ok && /^image\//.test(r.headers.get('content-type') || ''), `adresse optimisée publique (${r.headers.get('content-type')})`);
    } else {
      const unsigned = `${c.config.delivery}/${c.config.cloud}/${prepared.resource_type}/authenticated/v${row.remote_version}/${prepared.resource_type === 'raw' ? row.storage_key : `${row.storage_key}.${row.remote_format}`}`;
      const r0 = await fetch(unsigned);
      step(!r0.ok, `accès sans signature refusé (réponse ${r0.status})`, 'le fichier privé est accessible sans signature : vérifiez le type « authenticated »');
      const r = await fetch(store.downloadUrl(row, {}));
      const body = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      step(body && body.equals(buffer), 'lien de téléchargement temporaire : contenu identique à l’original', prepared.resource_type === 'raw' ? 'activez « Allow delivery of PDF and ZIP files »' : `réponse ${r.status}`);
    }
  } catch (err) {
    step(false, 'vérification', String(err.message).replace(/https?:\/\/\S+/g, '[adresse]'));
  } finally {
    await store.remove(row).then(() => step(true, 'suppression')).catch((e) => step(false, 'suppression', e.message));
    const gone = await store.inspect(row, 0).catch(() => 'erreur');
    step(gone === null, 'fichier bien absent après suppression');
  }
}

console.log(`Compte Cloudinary « ${c.config.cloud} », dossier « ${c.config.folder}/verification », limite par fichier ${Math.round(c.config.maxBytes / 1048576)} Mo.`);
await roundTrip('1. Image publique (réalisation)', { ext: 'png', mime: 'image/png', buffer: png(), visibility: 'public' });
await roundTrip('2. Image privée (photo de profil, image jointe)', { ext: 'png', mime: 'image/png', buffer: png(), visibility: 'private' });
await roundTrip('3. PDF privé (pièce jointe)', { ext: 'pdf', mime: 'application/pdf', buffer: pdf, visibility: 'private' });

console.log('\n4. Format non autorisé');
{
  const prepared = store.prepareUpload({ key: `verification/x/${randomUUID()}.png`, ext: 'png', visibility: 'public' });
  const up = await send(prepared, pdf, 'image/png', 'faux.png');
  step(!up.ok, `PDF déguisé en .png refusé par Cloudinary (réponse ${up.status})`);
}

console.log(`\n${ok} vérification(s) réussie(s), ${ko} échec(s).`);
process.exit(ko ? 1 : 0);
