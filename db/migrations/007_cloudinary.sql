-- 007 — Cloudinary devient le fournisseur unique des fichiers ; Neon garde les métadonnées.
-- Migration uniquement ADDITIVE : aucune ligne modifiée ni supprimée, aucune colonne retirée.
-- Les fichiers existants gardent leur fournisseur (driver 's3' ou 'local') et restent lisibles
-- jusqu'à leur migration vérifiée (npm run files:migrate).

-- Nouveau fournisseur possible (les anciens restent acceptés).
alter table uploaded_files drop constraint uploaded_files_driver_check;
alter table uploaded_files add constraint uploaded_files_driver_check
  check (driver in ('s3', 'local', 'cloudinary'));

-- Référence Cloudinary : type de ressource, type de livraison, version et format réels,
-- nécessaires pour construire les adresses, vérifier, supprimer et restaurer le fichier.
alter table uploaded_files add column resource_type text check (resource_type in ('image', 'raw'));
alter table uploaded_files add column remote_type text check (remote_type in ('upload', 'authenticated'));
alter table uploaded_files add column remote_version bigint check (remote_version > 0);
alter table uploaded_files add column remote_format text check (remote_format ~ '^[a-z0-9]{2,5}$');
alter table uploaded_files add column width integer check (width > 0);
alter table uploaded_files add column height integer check (height > 0);
alter table uploaded_files add constraint uploaded_files_cloudinary_check
  check (driver <> 'cloudinary' or (resource_type is not null and remote_type is not null));
-- Un fichier privé n'est jamais livré en public par Cloudinary.
alter table uploaded_files add constraint uploaded_files_private_check
  check (driver <> 'cloudinary' or visibility = 'public' or remote_type = 'authenticated');

-- Migration progressive d'un ancien fichier : l'ancienne référence est conservée ici et
-- l'original n'est jamais effacé par la migration.
alter table uploaded_files add column previous_driver text check (previous_driver in ('s3', 'local', 'cloudinary'));
alter table uploaded_files add column previous_storage_key text;
alter table uploaded_files add column moved_at timestamptz;

-- Intégrité et sauvegarde : empreinte calculée par le serveur à partir du contenu réellement
-- stocké (jamais fournie par le navigateur), dernière vérification, dernière copie.
alter table uploaded_files add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$');
alter table uploaded_files add column verified_at timestamptz;
alter table uploaded_files add column integrity_status text check (integrity_status in ('ok', 'missing', 'mismatch'));
alter table uploaded_files add column integrity_checked_at timestamptz;
alter table uploaded_files add column backed_up_at timestamptz;

create index files_driver_idx on uploaded_files (driver);
create index files_backup_idx on uploaded_files (backed_up_at nulls first) where status = 'ready';
create index files_integrity_idx on uploaded_files (integrity_status) where integrity_status is not null and integrity_status <> 'ok';

-- Journal des sauvegardes et contrôles : ce qui a réellement été fait, quand, et le résultat.
create table backup_runs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('files', 'database', 'integrity')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  destination text,
  copied integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  bytes bigint not null default 0,
  details jsonb not null default '{}'::jsonb
);
create index backup_runs_kind_idx on backup_runs (kind, started_at desc);
