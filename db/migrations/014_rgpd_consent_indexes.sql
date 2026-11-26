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
