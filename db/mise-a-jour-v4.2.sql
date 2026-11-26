-- =============================================================================
-- E-MAN PROD — mise à jour v4.2 : migration 014 (consentement, index, clé primaire anti-abus)
-- NORMALEMENT INUTILE : le déploiement Vercel l'applique tout seul, après une copie de sécurité
-- de toutes les tables (schéma avant_migration_014). Ce fichier sert seulement si vous préférez
-- l'appliquer vous-même : Neon → SQL Editor → coller tout → Run, AVANT de déployer la v4.2.
-- Additive : ajoute 2 colonnes, 5 index et une clé primaire. Ne supprime aucune donnée.
-- Sans danger si relancée : « déjà appliquée », rien ne change.
-- =============================================================================

do $install$
declare applied text;
begin
  if not exists (select 1 from schema_migrations where version = '013') then
    raise exception 'Base pas encore en 013 : exécutez d''abord db/mise-a-jour-v4.1.sql. Rien n''a été modifié.';
  end if;
  select checksum into applied from schema_migrations where version = '014';
  if applied is null then
    execute $m014$
-- 014 — Audit avant production (v4.2.0). Migration ADDITIVE uniquement : aucune donnée supprimée.
-- 1. Preuve du consentement : date à laquelle la case « J’accepte… » a été cochée (formulaires publics).
-- 2. Index sur des clés étrangères utilisées dans les recherches et suppressions.
-- 3. Clé primaire sur rate_events (compteurs anti-abus, purgés après 2 jours).

alter table quotes add column if not exists consent_at timestamptz;
alter table enrollments add column if not exists consent_at timestamptz;

create index if not exists site_media_file_idx on site_media (file_id) where file_id is not null;
create index if not exists mfa_challenges_user_idx on mfa_challenges (user_id);
create index if not exists typing_user_idx on typing (user_id);
create index if not exists sessions_trusted_device_idx on sessions (trusted_device_id) where trusted_device_id is not null;
create index if not exists portfolio_items_image_idx on portfolio_items (image_file_id) where image_file_id is not null;

alter table rate_events add column if not exists id bigint generated always as identity;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'rate_events'::regclass and contype = 'p') then
    alter table rate_events add constraint rate_events_pkey primary key (id);
  end if;
end $$;
$m014$;
    insert into schema_migrations (version, name, checksum) values ('014', 'rgpd_consent_indexes', 'dd4621af94ee2c8180554576b46e283283f76e2a64fa7b01f29ab52e840f61f0');
    raise notice 'Migration 014_rgpd_consent_indexes.sql appliquée.';
  elsif applied <> 'dd4621af94ee2c8180554576b46e283283f76e2a64fa7b01f29ab52e840f61f0' then
    raise exception 'La migration 014_rgpd_consent_indexes.sql a été modifiée après application : rien n''a été changé.';
  else
    raise notice 'Migration 014 déjà appliquée : rien à faire.';
  end if;
end
$install$;

-- Vérification : doit afficher 014 | rgpd_consent_indexes
select version, name, applied_at from schema_migrations order by version desc limit 3;
