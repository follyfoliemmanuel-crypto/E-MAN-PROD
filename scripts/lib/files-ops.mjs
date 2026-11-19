// Opérations de fond sur les fichiers, lancées HORS de Vercel (poste d'E-MAN PROD) :
// sauvegarde indépendante, contrôle d'intégrité, fichiers orphelins, restauration,
// migration progressive des anciens fichiers vers Cloudinary.
//
// Cloudinary n'est PAS une sauvegarde : la copie se fait dans un dossier choisi par
// E-MAN PROD (disque externe, NAS, dossier synchronisé), hors de Cloudinary et de Neon.
//
// Règles :
// - rien n'est jamais effacé sans --yes, et jamais un fichier référencé en base ;
// - l'empreinte SHA-256 est calculée ici, à partir du contenu réellement stocké ;
// - chaque exécution est enregistrée dans backup_runs avec son résultat réel.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { query, one } from '../../api/_lib/db.js';
import { provider, providerOf, providerFor, storageStatus } from '../../api/_lib/storage.js';
import { PURPOSES } from '../../api/_lib/services/files.js';

const COLS = `id, purpose, driver, storage_key, resource_type, remote_type, remote_version, remote_format, original_name, mime_type,
  size_bytes::float8 as size_bytes, visibility, status, sha256, backed_up_at, created_at`;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const clean = (m) => String(m).replace(/https?:\/\/\S+/g, '[adresse]');

/** Dossier de sauvegarde : argument --dossier, sinon BACKUP_DIR. */
export function backupDir(dir = process.env.BACKUP_DIR) {
  if (!dir) throw new Error('Indiquez le dossier de sauvegarde : --dossier "E:\\Sauvegardes\\emanprod" ou BACKUP_DIR dans .env.');
  const d = resolve(dir);
  mkdirSync(join(d, 'fichiers'), { recursive: true });
  return d;
}

async function startRun(kind, destination) {
  return (await one(`insert into backup_runs (kind, destination) values ($1, $2) returning id`, [kind, destination])).id;
}
async function endRun(id, r) {
  const status = r.failed && !r.copied ? 'failed' : r.failed ? 'partial' : 'ok';
  await query(`update backup_runs set finished_at = now(), status = $2, copied = $3, skipped = $4, failed = $5, bytes = $6, details = $7 where id = $1 returning id`,
    [id, status, r.copied, r.skipped, r.failed, r.bytes, JSON.stringify(r.details || {})]);
  return status;
}

/**
 * Sauvegarde incrémentale des fichiers : chaque fichier prêt dont la copie manque (ou n'a
 * jamais été faite) est lu chez son fournisseur, vérifié (taille), son empreinte calculée,
 * puis écrit dans le dossier et relu.
 */
export async function backupFiles({ dir, log = console.log } = {}) {
  const root = backupDir(dir);
  const rows = await query(`select ${COLS} from uploaded_files where status = 'ready' order by created_at`);
  const run = await startRun('files', root);
  const r = { copied: 0, skipped: 0, failed: 0, bytes: 0, details: { errors: [] } };
  for (const f of rows) {
    const target = join(root, 'fichiers', f.id);
    if (f.backed_up_at && existsSync(target) && statSync(target).size === f.size_bytes) { r.skipped += 1; continue; }
    try {
      const data = await providerOf(f).read(f);
      if (!data) throw new Error('fichier absent chez le fournisseur');
      if (data.length !== f.size_bytes) throw new Error(`taille ${data.length} ≠ ${f.size_bytes}`);
      const hash = sha(data);
      if (f.sha256 && f.sha256 !== hash) throw new Error('empreinte différente de celle déjà enregistrée');
      writeFileSync(target, data);
      if (sha(readFileSync(target)) !== hash) throw new Error('copie illisible après écriture');
      writeFileSync(`${target}.json`, JSON.stringify({ ...f, sha256: hash }, null, 1));
      await query(`update uploaded_files set sha256 = $2, backed_up_at = now() where id = $1 returning id`, [f.id, hash]);
      r.copied += 1;
      r.bytes += data.length;
    } catch (err) {
      r.failed += 1;
      r.details.errors.push({ id: f.id, message: clean(err.message) });
      log(`  ✖ ${f.id} (${f.original_name}) : ${clean(err.message)}`);
    }
  }
  // Manifeste : correspondance fichier → copie, lisible sans la base.
  const all = await query(`select id, driver, storage_key, resource_type, remote_type, original_name, mime_type, size_bytes::float8 as size_bytes, sha256, backed_up_at from uploaded_files where backed_up_at is not null order by created_at`);
  writeFileSync(join(root, 'fichiers', 'manifeste.json'), JSON.stringify({ created_at: new Date().toISOString(), files: all }, null, 1));
  const status = await endRun(run, r);
  log(`Fichiers : ${r.copied} copié(s), ${r.skipped} déjà sauvegardé(s), ${r.failed} échec(s), ${(r.bytes / 1048576).toFixed(1)} Mo → ${status}.`);
  return { ...r, status };
}

/** Sauvegarde de la base Neon : un JSON par table + manifeste (restaurable par db:restore). */
export async function backupDatabase(db, { dir, log = console.log } = {}) {
  const root = backupDir(dir);
  const { backup } = await import('./migrate.mjs');
  const run = await startRun('database', root);
  const r = { copied: 0, skipped: 0, failed: 0, bytes: 0, details: {} };
  try {
    const { dir: out, manifest } = await backup(db, join(root, 'base'), { label: 'sauvegarde' });
    r.copied = Object.keys(manifest.tables).length;
    r.details = { folder: out, tables: r.copied, rows: Object.values(manifest.tables).reduce((a, b) => a + b, 0) };
  } catch (err) {
    r.failed += 1;
    r.details.error = clean(err.message);
    log(`  ✖ base : ${clean(err.message)}`);
  }
  const status = await endRun(run, r);
  log(`Base : ${r.details.tables ?? 0} tables, ${r.details.rows ?? 0} lignes → ${r.details.folder || '—'} (${status}).`);
  return { ...r, status };
}

/**
 * Contrôle d'intégrité : chaque fichier « prêt » existe-t-il chez son fournisseur, avec la
 * bonne taille ? Avec deep, le contenu est relu et comparé à l'empreinte enregistrée.
 * Orphelins (fichiers Cloudinary sans ligne en base) : listés ; effacés seulement avec
 * clean + yes, et s'ils ont plus de 24 h (un envoi peut être en cours).
 */
export async function checkIntegrity({ log = console.log, deep = false, orphans = false, cleanOrphans = false, yes = false } = {}) {
  const rows = await query(`select ${COLS} from uploaded_files where status = 'ready' order by created_at`);
  const run = await startRun('integrity', 'fournisseurs');
  const r = { copied: 0, skipped: 0, failed: 0, bytes: 0, details: { missing: [], mismatch: [], orphans: [], removed: [] } };
  for (const f of rows) {
    let state = 'ok';
    try {
      const store = providerOf(f);
      const info = await store.inspect(f, 0);
      if (!info) state = 'missing';
      else if (info.size !== f.size_bytes) state = 'mismatch';
      else if (deep && f.sha256) {
        const data = await store.read(f);
        if (!data || sha(data) !== f.sha256) state = 'mismatch';
      }
    } catch (err) {
      r.failed += 1;
      log(`  ? ${f.id} (${f.driver}) : ${clean(err.message)}`);
      continue;
    }
    await query(`update uploaded_files set integrity_status = $2, integrity_checked_at = now() where id = $1 returning id`, [f.id, state]);
    if (state === 'ok') r.copied += 1;
    else { r.details[state].push(f.id); log(`  ✖ ${f.id} (${f.original_name}) : ${state === 'missing' ? 'introuvable' : 'taille ou contenu différent'}`); }
  }
  if (orphans || cleanOrphans) {
    if (storageStatus().active === 'cloudinary') {
      const store = provider('cloudinary');
      const known = new Set((await query(`select storage_key from uploaded_files where driver = 'cloudinary'`)).map((x) => x.storage_key));
      for (const o of (await store.list()).filter((x) => !known.has(x.key))) {
        const old = Date.now() - new Date(o.modified).getTime() > 24 * 3600 * 1000;
        r.details.orphans.push({ key: o.key, resource_type: o.resource_type, type: o.type, size: o.size, modified: o.modified });
        if (cleanOrphans && yes && old) {
          await store.remove({ storage_key: o.key, resource_type: o.resource_type, remote_type: o.type });
          r.details.removed.push(o.key);
        }
      }
    }
    log(`Orphelins : ${r.details.orphans.length}${cleanOrphans ? `, effacés : ${r.details.removed.length}${yes ? '' : ' (ajoutez --yes pour effacer)'}` : ''}.`);
  }
  r.skipped = r.details.missing.length + r.details.mismatch.length;
  const status = await endRun(run, { ...r, failed: r.failed + r.skipped });
  log(`Intégrité : ${r.copied} fichier(s) correct(s), ${r.details.missing.length} introuvable(s), ${r.details.mismatch.length} différent(s), ${r.failed} non vérifié(s) → ${status}.`);
  return { ...r, status };
}

/** Écrit un contenu chez le fournisseur d'une ligne, au même emplacement. */
async function putBack(f, data) {
  const store = providerOf(f);
  if (store.kind === 'cloudinary') {
    const res = await store.write(f, data);
    if (res.size !== data.length) throw new Error('taille reçue par Cloudinary différente');
    await query(`update uploaded_files set remote_version = $2, remote_format = coalesce($3, remote_format) where id = $1 returning id`, [f.id, res.remote_version, res.remote_format]);
    // L'adresse publique d'une réalisation contient la version : on la met à jour.
    if (f.purpose === 'portfolio') {
      const fresh = await one(`select ${COLS} from uploaded_files where id = $1`, [f.id]);
      await query(`update portfolio_items set image_url = $2 where image_file_id = $1 returning id`, [f.id, store.publicUrl(fresh)]);
    }
  } else {
    await store.write(f.storage_key, data, { contentType: f.mime_type });
  }
}

/**
 * Restauration depuis le dossier de sauvegarde : fichiers marqués introuvables par le
 * contrôle d'intégrité (ou une liste d'identifiants), recopiés à leur place après contrôle
 * de l'empreinte.
 */
export async function restoreFiles({ dir, ids = null, log = console.log } = {}) {
  const root = backupDir(dir);
  const rows = ids
    ? await query(`select ${COLS} from uploaded_files where id = any($1::uuid[])`, [ids])
    : await query(`select ${COLS} from uploaded_files where status = 'ready' and integrity_status = 'missing'`);
  const r = { restored: 0, failed: 0 };
  for (const f of rows) {
    try {
      const file = join(root, 'fichiers', f.id);
      if (!existsSync(file)) throw new Error('copie absente du dossier de sauvegarde');
      const data = readFileSync(file);
      const meta = existsSync(`${file}.json`) ? JSON.parse(readFileSync(`${file}.json`, 'utf8')) : {};
      const expected = f.sha256 || meta.sha256;
      if (expected && sha(data) !== expected) throw new Error('empreinte de la copie différente');
      await putBack(f, data);
      await query(`update uploaded_files set integrity_status = 'ok', integrity_checked_at = now() where id = $1 returning id`, [f.id]);
      r.restored += 1;
      log(`  ✔ ${f.id} (${f.original_name}) restauré`);
    } catch (err) {
      r.failed += 1;
      log(`  ✖ ${f.id} : ${clean(err.message)}`);
    }
  }
  log(`Restauration : ${r.restored} fichier(s) restauré(s), ${r.failed} échec(s).`);
  return r;
}

/**
 * Migration progressive des anciens fichiers (driver s3 ou local) vers Cloudinary.
 * Simulation par défaut ; apply pour copier. Chaque copie est vérifiée (taille, empreinte
 * relue chez Cloudinary) AVANT de changer la ligne ; l'original n'est jamais effacé et son
 * ancienne référence reste dans previous_driver / previous_storage_key.
 */
export async function moveLegacy({ apply = false, limit = 100, log = console.log } = {}) {
  const dest = providerFor();
  if (dest.kind !== 'cloudinary') throw new Error('Cloudinary n’est pas configuré : rien à migrer.');
  const rows = await query(`select ${COLS} from uploaded_files where status = 'ready' and driver in ('s3', 'local') order by created_at limit $1`, [limit]);
  const r = { planned: rows.length, moved: 0, failed: 0 };
  for (const f of rows) {
    if (!apply) { log(`  → ${f.id} ${f.driver} → cloudinary (${f.original_name}, ${(f.size_bytes / 1048576).toFixed(1)} Mo)`); continue; }
    try {
      if (f.size_bytes > dest.maxBytes) throw new Error(`plus lourd que la limite du compte Cloudinary (${Math.round(dest.maxBytes / 1048576)} Mo) : laissé à sa place`);
      const data = await providerOf(f).read(f);
      if (!data || data.length !== f.size_bytes) throw new Error('original absent ou de taille différente');
      const hash = sha(data);
      const ext = f.storage_key.split('.').pop();
      const prepared = dest.prepareUpload({ key: f.storage_key, ext: ext === 'jpeg' ? 'jpg' : ext, visibility: f.visibility });
      const row = { ...f, driver: 'cloudinary', storage_key: prepared.storage_key, resource_type: prepared.resource_type, remote_type: prepared.remote_type };
      const res = await dest.write(row, data);
      if (res.size !== data.length) throw new Error('taille reçue par Cloudinary différente');
      const copy = await dest.read({ ...row, remote_version: res.remote_version, remote_format: res.remote_format });
      if (!copy || sha(copy) !== hash) throw new Error('la copie relue chez Cloudinary ne correspond pas à l’original');
      await query(
        `update uploaded_files set previous_driver = driver, previous_storage_key = storage_key, moved_at = now(),
           driver = 'cloudinary', storage_key = $2, resource_type = $3, remote_type = $4, remote_version = $5, remote_format = $6, sha256 = coalesce(sha256, $7)
         where id = $1 and driver = $8 returning id`,
        [f.id, row.storage_key, row.resource_type, row.remote_type, res.remote_version, res.remote_format, hash, f.driver],
      );
      if (f.purpose === 'portfolio') {
        const fresh = await one(`select ${COLS} from uploaded_files where id = $1`, [f.id]);
        await query(`update portfolio_items set image_url = $2 where image_file_id = $1 returning id`, [f.id, dest.publicUrl(fresh)]);
      }
      r.moved += 1;
      log(`  ✔ ${f.id} ${f.driver} → cloudinary (vérifié)`);
    } catch (err) {
      r.failed += 1;
      log(`  ✖ ${f.id} : ${clean(err.message)}`);
    }
  }
  log(apply ? `Migration : ${r.moved} fichier(s) migré(s) et vérifié(s), ${r.failed} échec(s). Les originaux sont conservés.` : `Simulation : ${r.planned} fichier(s) à migrer. Relancez avec --apply pour copier.`);
  return r;
}

export { PURPOSES };
