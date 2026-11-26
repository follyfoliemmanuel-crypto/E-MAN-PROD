-- =====================================================================================
-- E-MAN PROD — SÉCURITÉ 2/3 : RESTAURATION (seulement en cas d'erreur)
-- =====================================================================================
-- Remet les données sauvegardées par db/securite-1-sauvegarde.sql : commandes, devis,
-- messages, notifications, inscriptions, fichiers joints, journaux, numérotation, et les
-- comptes supprimés par l'option « comptes de test ».
--
-- Neon → SQL Editor → coller tout le fichier → Run.
-- Tout se fait en une seule opération : si une étape échoue, RIEN n'est modifié.
-- Les données créées APRÈS la remise à zéro (nouvelles commandes de vrais clients) sont
-- gardées : la restauration ajoute seulement ce qui manque, elle n'efface rien.
-- Attention : si de nouvelles commandes ou de nouveaux devis ont déjà été créés après la remise
-- à zéro, leurs numéros (CMD-2026-00001…) existent aussi dans la sauvegarde ; la restauration
-- s'arrête alors sans rien modifier, pour ne jamais mélanger deux commandes du même numéro.
-- =====================================================================================

do $$
declare
  t text; cols text; n bigint; report text := ''; clash bigint;
  -- ordre imposé par les liens entre tables (un compte avant ses commandes, etc.)
  tables text[] := array[
    'users', 'accounts', 'client_profiles',
    'quotes', 'quote_items', 'orders', 'order_items', 'payments', 'invoices',
    'messages', 'enrollments', 'attendance', 'certificates',
    'uploaded_files', 'notifications', 'activity_logs', 'email_log'];
  with_triggers text[] := array['quotes', 'quote_items', 'orders', 'order_items', 'payments', 'enrollments', 'users', 'client_profiles'];
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'securite_avant_production') then
    raise exception 'Aucune sauvegarde trouvée (securite_avant_production). Rien n''a été modifié.';
  end if;

  -- Même numéro de commande ou de devis déjà réutilisé par une nouvelle commande ? On s'arrête.
  select count(*) into clash from public.orders o join securite_avant_production.orders s on s.number = o.number and s.id <> o.id;
  if clash > 0 then raise exception '% numéro(s) de commande déjà réutilisé(s) depuis la remise à zéro : rien n''a été modifié. Contactez le développeur.', clash; end if;
  select count(*) into clash from public.quotes o join securite_avant_production.quotes s on s.number = o.number and s.id <> o.id;
  if clash > 0 then raise exception '% numéro(s) de devis déjà réutilisé(s) depuis la remise à zéro : rien n''a été modifié. Contactez le développeur.', clash; end if;

  -- Les déclencheurs (totaux, dates de modification, état de paiement) sont mis en pause :
  -- les lignes reviennent exactement comme elles étaient.
  foreach t in array with_triggers loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  foreach t in array tables loop
    -- colonnes recopiables (les totaux calculés par la base sont recalculés par elle)
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t and is_generated = 'NEVER'
       and column_name in (select column_name from information_schema.columns
                            where table_schema = 'securite_avant_production' and table_name = t);
    execute format('insert into public.%I (%s) overriding system value select %s from securite_avant_production.%I on conflict do nothing',
                   t, cols, cols, t);
    get diagnostics n = row_count;
    report := report || format(E'\n  %s : %s ligne(s) remise(s)', t, n);
  end loop;

  foreach t in array with_triggers loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  -- Liens vers un compte effacés quand un compte de test a été supprimé (auteur d'une photo,
  -- d'un témoignage, d'un réglage…) : remis, sans toucher au reste de ces lignes.
  update public.uploaded_files x set owner_id = s.owner_id from securite_avant_production.uploaded_files s
   where s.id = x.id and x.owner_id is null and s.owner_id is not null and exists (select 1 from public.users u where u.id = s.owner_id);
  update public.testimonials x set user_id = s.user_id from securite_avant_production.testimonials s
   where s.id = x.id and x.user_id is null and s.user_id is not null and exists (select 1 from public.users u where u.id = s.user_id);
  update public.site_media x set updated_by = s.updated_by from securite_avant_production.site_media s
   where s.slot = x.slot and x.updated_by is null and s.updated_by is not null and exists (select 1 from public.users u where u.id = s.updated_by);
  update public.site_settings x set updated_by = s.updated_by from securite_avant_production.site_settings s
   where s.key = x.key and x.updated_by is null and s.updated_by is not null and exists (select 1 from public.users u where u.id = s.updated_by);
  update public.announcements x set created_by = s.created_by from securite_avant_production.announcements s
   where s.id = x.id and x.created_by is null and s.created_by is not null and exists (select 1 from public.users u where u.id = s.created_by);
  update public.legacy_orders x set user_id = s.user_id from securite_avant_production.legacy_orders s
   where s.id = x.id and x.user_id is null and s.user_id is not null and exists (select 1 from public.users u where u.id = s.user_id);

  -- Numérotation : on reprend le plus grand des deux compteurs (jamais de numéro en double)
  insert into public.counters (key, value)
    select key, value from securite_avant_production.counters
    on conflict (key) do update set value = greatest(public.counters.value, excluded.value);

  -- Les compteurs des numéros automatiques (journaux) repartent après la plus grande valeur
  perform setval(pg_get_serial_sequence('public.activity_logs', 'id'), greatest((select coalesce(max(id), 0) from public.activity_logs), 1));
  perform setval(pg_get_serial_sequence('public.email_log', 'id'), greatest((select coalesce(max(id), 0) from public.email_log), 1));

  raise notice E'Restauration terminée :%\n  numérotation : reprise', report;
end $$;
