-- =====================================================================================
-- E-MAN PROD — SÉCURITÉ 1/3 : SAUVEGARDE avant la remise à zéro
-- =====================================================================================
-- À lancer AVANT db/reinitialisation-avant-production.sql.
-- Neon → SQL Editor → coller tout le fichier → Run.
--
-- Copie, dans un espace séparé de la base nommé « securite_avant_production », toutes les
-- tables que la remise à zéro modifie (et les comptes, pour l'option « comptes de test »).
-- Le site n'utilise jamais cet espace : il ne voit pas la copie et continue de fonctionner.
-- Rien n'est modifié dans les tables du site.
--
-- Pour revenir en arrière : db/securite-2-restauration.sql
-- Quand tout est validé en production (après quelques semaines) : db/securite-3-suppression-sauvegarde.sql
-- =====================================================================================

do $$
declare
  t text; n bigint; report text := '';
  tables text[] := array[
    'users', 'accounts', 'client_profiles',
    'quotes', 'quote_items', 'orders', 'order_items', 'payments', 'invoices',
    'messages', 'enrollments', 'attendance', 'certificates',
    'uploaded_files', 'notifications', 'activity_logs', 'email_log', 'counters',
    -- tables du site qui gardent « qui a fait quoi » (lien vers un compte) : pour pouvoir le remettre
    'testimonials', 'site_media', 'site_settings', 'announcements', 'legacy_orders'];
begin
  if not exists (select 1 from schema_migrations where version = '013') then
    raise exception 'Base pas à jour (v4.1 attendue : migration 013). Rien n''a été fait.';
  end if;
  if exists (select 1 from information_schema.schemata where schema_name = 'securite_avant_production') then
    raise exception 'Une sauvegarde existe déjà (securite_avant_production) : elle n''a pas été écrasée. Rien n''a été fait.';
  end if;

  create schema securite_avant_production;
  -- personne d'autre que le propriétaire de la base ne peut lire la copie
  revoke all on schema securite_avant_production from public;

  foreach t in array tables loop
    execute format('create table securite_avant_production.%I as table public.%I', t, t);
    execute format('select count(*) from securite_avant_production.%I', t) into n;
    report := report || format(E'\n  %s : %s', t, n);
  end loop;

  create table securite_avant_production.infos as
    select now() as sauvegarde_le, (select max(version) from schema_migrations) as version_base;

  raise notice E'Sauvegarde terminée (espace « securite_avant_production »), lignes copiées :%', report;
end $$;
