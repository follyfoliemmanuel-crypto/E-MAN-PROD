-- =====================================================================================
-- E-MAN PROD — SÉCURISATION DE LA BASE (Neon)
-- =====================================================================================
-- Neon → SQL Editor → coller TOUT le fichier → Run (avec le compte propriétaire, celui de
-- votre DATABASE_URL actuelle). Tout se fait en une seule opération : si une étape échoue,
-- RIEN n'est modifié. On peut le relancer (après une mise à jour par exemple) sans risque :
-- un nouveau mot de passe est alors créé pour le compte du site.
--
-- CE QUE FAIT LE SCRIPT
--  1. Ferme la base à tout compte non autorisé (plus aucun droit « par défaut » pour tout le monde).
--  2. Crée le compte « eman_app », réservé au site, avec le strict nécessaire :
--       - lire, ajouter, modifier, supprimer des LIGNES ;
--       - impossible de créer, modifier, vider (TRUNCATE) ou supprimer une TABLE ;
--       - journal d'activité, journal des e-mails et clé de chiffrement Google Authenticator :
--         le site peut seulement AJOUTER et LIRE (une faille ne pourrait ni effacer les traces,
--         ni remplacer la clé) ; version de la base : lecture seule ;
--       - garde-fous : requête bloquée au-delà de 15 s, transaction oubliée coupée après 30 s.
--  3. Rend la sauvegarde « securite_avant_production » (si elle existe) invisible pour le site.
--  4. Affiche le mot de passe du compte eman_app (UNE SEULE FOIS) et la liste des comptes à vérifier.
--
-- APRÈS LE SCRIPT (indispensable pour que le site utilise le compte limité) — Vercel :
--   Settings → Environment Variables → Production :
--     DATABASE_URL_OWNER = votre DATABASE_URL ACTUELLE (copiez-la avant de la changer) ;
--                          sert seulement aux mises à jour de la base pendant le déploiement.
--     DATABASE_URL       = la même adresse, en remplaçant le nom d'utilisateur par  eman_app
--                          et le mot de passe par celui affiché à la fin de ce script.
--   Puis Deployments → Redeploy. Rien d'autre ne change.
--   Tant que vous n'avez pas changé DATABASE_URL, le site continue avec l'ancien compte :
--   le script ne casse rien, il prépare.
-- =====================================================================================

do $$
declare
  db text := current_database();
  me text := current_user;
  pwd text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');  -- 64 caractères aléatoires
  existed boolean;
  r record; admins text := ''; roles text := '';
begin
  if not exists (select 1 from schema_migrations where version = '013') then
    raise exception 'Base pas à jour (v4.1 attendue : migration 013). Rien n''a été modifié.';
  end if;
  if me = 'eman_app' then
    raise exception 'Lancez ce script avec le compte PROPRIÉTAIRE de la base, pas avec eman_app. Rien n''a été modifié.';
  end if;

  -- 1. Aucun droit pour « tout le monde » ---------------------------------------------
  execute format('revoke all on database %I from public', db);
  revoke create on schema public from public;
  revoke all on all tables in schema public from public;
  revoke all on all sequences in schema public from public;
  -- fonctions du site seulement (celles des extensions, comme pgcrypto, appartiennent au système)
  for r in select p.oid::regprocedure as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and pg_get_userbyid(p.proowner) = me
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('revoke execute on function %s from public', r.f);
  end loop;
  -- et pour les tables créées plus tard par les mises à jour
  execute format('alter default privileges for role %I in schema public revoke all on tables from public', me);
  execute format('alter default privileges for role %I in schema public revoke all on sequences from public', me);
  execute format('alter default privileges for role %I in schema public revoke execute on functions from public', me);

  -- 2. Compte du site : eman_app ------------------------------------------------------
  existed := exists (select 1 from pg_roles where rolname = 'eman_app');
  if existed then
    -- (le propriétaire ne peut pas toucher l'attribut SUPERUSER ; le compte n'en a pas, on le vérifie)
    if (select rolsuper from pg_roles where rolname = 'eman_app') then
      raise exception 'Le compte eman_app a des droits de super-administrateur : supprimez-le dans Neon → Roles, puis relancez. Rien n''a été modifié.';
    end if;
    execute format('alter role eman_app with login password %L nocreatedb nocreaterole noinherit', pwd);
  else
    execute format('create role eman_app with login password %L nosuperuser nocreatedb nocreaterole noinherit', pwd);
  end if;
  alter role eman_app set statement_timeout = '15s';
  alter role eman_app set idle_in_transaction_session_timeout = '30s';
  alter role eman_app set lock_timeout = '10s';
  alter role eman_app set search_path = public;

  -- on repart de zéro à chaque lancement (aucun droit oublié d'une ancienne version)
  revoke all on all tables in schema public from eman_app;
  revoke all on all sequences in schema public from eman_app;
  revoke all on schema public from eman_app;

  execute format('grant connect on database %I to eman_app', db);
  grant usage on schema public to eman_app;
  grant select, insert, update, delete on all tables in schema public to eman_app;
  grant usage, select on all sequences in schema public to eman_app;
  for r in select p.oid::regprocedure as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and pg_get_userbyid(p.proowner) = me
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('grant execute on function %s to eman_app', r.f);
  end loop;

  -- tables protégées : ajout et lecture seulement
  revoke update, delete on activity_logs, email_log, app_secrets from eman_app;
  -- version de la base : lecture seule (seul le propriétaire fait les mises à jour)
  revoke insert, update, delete on schema_migrations from eman_app;

  -- tables créées plus tard par les mises à jour (lancées par le propriétaire) : mêmes droits
  execute format('alter default privileges for role %I in schema public grant select, insert, update, delete on tables to eman_app', me);
  execute format('alter default privileges for role %I in schema public grant usage, select on sequences to eman_app', me);
  execute format('alter default privileges for role %I in schema public grant execute on functions to eman_app', me);

  -- 3. Sauvegarde de sécurité : jamais visible du site -------------------------------
  if exists (select 1 from information_schema.schemata where schema_name = 'securite_avant_production') then
    revoke all on schema securite_avant_production from public, eman_app;
    revoke all on all tables in schema securite_avant_production from public, eman_app;
  end if;

  -- 4. Compte rendu -------------------------------------------------------------------
  for r in select email, coalesce(full_name, '') as name from users where role = 'admin' order by created_at loop
    admins := admins || format(E'\n    %s %s', r.email, r.name);
  end loop;
  for r in select rolname, rolsuper, rolcreaterole, rolcanlogin from pg_roles
            where rolcanlogin and rolname not like 'pg\_%' and rolname not in ('cloud_admin', 'neon_superuser', 'neon_service')
            order by 1 loop
    roles := roles || format(E'\n    %s%s', r.rolname,
      case when r.rolname = me then '  (propriétaire : celui de ce script)'
           when r.rolname = 'eman_app' then '  (site, droits limités)'
           else '  ← à vérifier : supprimez-le dans Neon → Roles s''il ne sert à rien' end);
  end loop;

  raise notice E'\n✔ Base sécurisée. Compte du site « eman_app » %.\n\nMOT DE PASSE eman_app (affiché une seule fois, copiez-le maintenant) :\n\n    %\n\nComptes administrateurs du site (vérifiez qu''ils sont tous légitimes) :%\n\nComptes ayant accès à la base :%\n\nÉtape suivante : Vercel → DATABASE_URL_OWNER = ancienne DATABASE_URL ; DATABASE_URL = même adresse avec eman_app et ce mot de passe ; Redeploy.',
    case when existed then 'mis à jour (nouveau mot de passe)' else 'créé' end, pwd, admins, roles;
end $$;
