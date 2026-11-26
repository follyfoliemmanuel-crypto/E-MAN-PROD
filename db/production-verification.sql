-- =====================================================================================
-- E-MAN PROD — VÉRIFICATION DE LA BASE AVANT / APRÈS MISE EN PRODUCTION (LECTURE SEULE)
-- =====================================================================================
-- Neon → SQL Editor → coller tout → Run. Ce script NE MODIFIE RIEN : il affiche un tableau
-- « contrôle | résultat | statut ». Statut OK = rien à faire ; À FAIRE = voir la colonne résultat.
-- À relancer après chaque étape de docs/A-FAIRE-MANUELLEMENT.md.
-- =====================================================================================

with
v as (select coalesce(max(version), 'aucune') as version from schema_migrations),
legal as (select coalesce((select value from site_settings where key = 'legal'), '{}'::jsonb) as j),
legal_missing as (
  select string_agg(k, ', ') as missing
  from unnest(array['legalName', 'legalForm', 'rccm', 'nif', 'director', 'headOffice']) k, legal
  where coalesce(nullif(trim(legal.j ->> k), ''), null) is null
),
photos as (
  select string_agg(m.slot, ', ' order by m.slot) as slots
  from site_media m left join uploaded_files f on f.id = m.file_id and f.status = 'ready'
  where m.url like '%res.cloudinary.com%' and f.id is null
),
admins as (select count(*) filter (where role = 'admin' and disabled_at is null) as n,
                  count(*) filter (where role in ('admin', 'staff') and disabled_at is null and mfa_enabled_at is null) as no_mfa
           from users),
public_rights as (
  -- Base ouverte à « tout le monde » (PUBLIC) : connexion à la base ou création dans le schéma public.
  select (case when has_database_privilege('public', current_database(), 'CONNECT') then 1 else 0 end
        + case when has_schema_privilege('public', 'public', 'CREATE') then 1 else 0 end) as n
),
app_rights as (
  select coalesce((select has_table_privilege('eman_app', 'activity_logs', 'DELETE') or has_table_privilege('eman_app', 'email_log', 'UPDATE')
                   from pg_roles where rolname = 'eman_app'), false) as journals_writable
),
app_role as (select exists (select 1 from pg_roles where rolname = 'eman_app') as present),
mails as (select count(*) filter (where status = 'envoye') as sent, count(*) filter (where status = 'echec') as failed
          from email_log where created_at > now() - interval '30 days'),
backups as (select max(started_at) filter (where status = 'ok') as last_ok from backup_runs),
snap as (select string_agg(nspname, ', ' order by nspname) as schemas from pg_namespace
         where nspname like 'avant\_migration\_%' or nspname = 'securite_avant_production'),
pending as (select count(*) as n from uploaded_files where status = 'pending' and created_at < now() - interval '2 days')
select * from (values
  (1, 'Version du schéma (attendu : 014)', (select version from v), case when (select version from v) >= '014' then 'OK' else 'À FAIRE' end),
  (2, 'Mentions légales manquantes', coalesce((select missing from legal_missing), 'aucune'), case when (select missing from legal_missing) is null then 'OK' else 'À FAIRE' end),
  (3, 'Photos du site sans fichier (image par défaut affichée)', coalesce((select slots from photos), 'aucune'), case when (select slots from photos) is null then 'OK' else 'À FAIRE' end),
  (4, 'Administrateurs actifs', (select n from admins)::text, case when (select n from admins) between 1 and 3 then 'OK' else 'À VÉRIFIER' end),
  (5, 'Comptes équipe sans Google Authenticator', (select no_mfa from admins)::text, case when (select no_mfa from admins) = 0 then 'OK' else 'À FAIRE' end),
  (6, 'Base ouverte à « tout le monde » (PUBLIC)', case when (select n from public_rights) = 0 then 'non' else 'oui' end, case when (select n from public_rights) = 0 then 'OK' else 'À FAIRE : db/securite-base.sql' end),
  (7, 'Compte limité eman_app créé', case when (select present from app_role) then 'oui' else 'non' end, case when (select present from app_role) then 'OK (vérifiez DATABASE_URL dans Vercel)' else 'À FAIRE : db/securite-base.sql' end),
  (12, 'Journaux protégés (eman_app ne peut ni effacer ni modifier)', case when (select journals_writable from app_rights) then 'non' else 'oui' end, case when (select present from app_role) and not (select journals_writable from app_rights) then 'OK' else 'À FAIRE : db/securite-base.sql' end),
  (8, 'E-mails des 30 derniers jours (envoyés / échecs)', (select sent || ' / ' || failed from mails), case when (select failed from mails) = 0 then 'OK' when (select sent from mails) = 0 then 'À FAIRE : domaine Resend' else 'À VÉRIFIER' end),
  (9, 'Dernière sauvegarde hors ligne réussie', coalesce(to_char((select last_ok from backups), 'YYYY-MM-DD HH24:MI'), 'jamais'), case when (select last_ok from backups) > now() - interval '7 days' then 'OK' else 'À FAIRE : npm run backup' end),
  (10, 'Copies de sécurité présentes dans la base', coalesce((select schemas from snap), 'aucune'), 'INFO'),
  (11, 'Envois de fichiers abandonnés (> 2 jours)', (select n from pending)::text, case when (select n from pending) = 0 then 'OK' else 'À VÉRIFIER : CRON_SECRET' end)
) as t(n, controle, resultat, statut)
order by n;
