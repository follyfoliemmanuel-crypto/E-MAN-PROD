-- =====================================================================================
-- E-MAN PROD — DROIT À L'EFFACEMENT : NETTOYAGE DES JOURNAUX D'UN CLIENT
-- =====================================================================================
-- À utiliser APRÈS avoir cliqué « Anonymiser (droit à l'effacement) » sur la fiche du client
-- (Espace → Clients). Le bouton efface l'identité partout où le site a le droit d'écrire ; les deux
-- journaux techniques sont protégés en « ajout seul » (une faille ne peut pas effacer les traces),
-- donc leur nettoyage se fait ici, avec le compte PROPRIÉTAIRE de la base.
--
-- Ce que fait le script, pour UN client :
--   - journal des e-mails : l'adresse de destination est remplacée par « anonymisé » ;
--   - journal d'activité : les détails (data) des actions qui le concernent sont vidés ;
--     l'action, sa date et son auteur restent (traçabilité).
-- Rien d'autre n'est modifié. Tout ou rien : en cas d'erreur, aucun changement.
--
-- MODE D'EMPLOI : Neon → SQL Editor (compte propriétaire), remplacer l'identifiant ci-dessous par
-- celui du client (Espace → Gestion des clients → fiche, ou : select id, full_name from users where full_name = 'Client supprimé';)
-- puis Run.
-- =====================================================================================

do $$
declare
  target uuid := '00000000-0000-0000-0000-000000000000';   -- ← identifiant du client à remplacer
  n_mail int; n_log int;
begin
  if target = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Remplacez d''abord l''identifiant du client en haut du script. Rien n''a été modifié.';
  end if;
  if not exists (select 1 from users where id = target and email like 'supprime-%@anonyme.invalid') then
    raise exception 'Ce compte n''est pas anonymisé : cliquez d''abord « Anonymiser » sur sa fiche. Rien n''a été modifié.';
  end if;
  update email_log set to_email = 'anonymisé' where user_id = target and to_email <> 'anonymisé';
  get diagnostics n_mail = row_count;
  update activity_logs set data = '{}'::jsonb
   where (entity_id = target::text or actor_id = target) and data <> '{}'::jsonb;
  get diagnostics n_log = row_count;
  raise notice 'Journal des e-mails : % ligne(s) anonymisée(s). Journal d''activité : % ligne(s) vidée(s).', n_mail, n_log;
end $$;
