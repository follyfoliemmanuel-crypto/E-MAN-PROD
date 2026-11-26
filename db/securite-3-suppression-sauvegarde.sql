-- =====================================================================================
-- E-MAN PROD — SÉCURITÉ 3/3 : SUPPRESSION de la sauvegarde
-- =====================================================================================
-- Quand la production fonctionne bien depuis quelques semaines et que vous êtes sûr de
-- ne plus avoir besoin des données de test.
-- Neon → SQL Editor → coller → Run. Supprime uniquement l'espace « securite_avant_production ».
-- (La copie contient des comptes et des messages de test : ne la gardez pas indéfiniment.)
-- =====================================================================================

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'securite_avant_production') then
    raise notice 'Aucune sauvegarde à supprimer.';
    return;
  end if;
  raise notice 'Sauvegarde du % supprimée.', (select sauvegarde_le::date from securite_avant_production.infos limit 1);
  drop schema securite_avant_production cascade;
end $$;
