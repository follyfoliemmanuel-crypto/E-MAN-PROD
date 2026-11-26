-- =====================================================================================
-- E-MAN PROD — Réparation des photos du site (bug « Enregistrer » corrigé en v4.1.2)
-- =====================================================================================
-- Avant la v4.1.2, cliquer sur « Enregistrer » dans « Images et bannières » (pour changer une
-- description, par exemple) détachait la photo de son fichier, puis SUPPRIMAIT ce fichier chez
-- Cloudinary. La photo disparaissait ensuite du site (visuel par défaut à la place).
--
-- Ce script :
--   1. rattache à leur fichier les photos dont le fichier existe encore (elles retrouvent
--      leurs tailles adaptées à chaque écran) ;
--   2. affiche la liste des photos dont le fichier a été supprimé : à RENVOYER dans
--      « Images et bannières » (bouton « Envoyer une photo »).
-- Il ne supprime rien. On peut le relancer sans risque.
--
-- Neon → SQL Editor → coller tout le fichier → Run. Lire le compte rendu dans les messages.
-- =====================================================================================

do $$
declare
  n bigint;
  r record;
  lost text := '';
  k int := 0;
begin
  -- 1. Rattacher les photos dont le fichier existe encore
  update site_media m set file_id = f.id
    from uploaded_files f
   where m.file_id is null
     and f.purpose = 'site_media' and f.status = 'ready'
     and position(f.storage_key in m.url) > 0;
  get diagnostics n = row_count;

  -- 2. Photos envoyées sur le site dont le fichier n'existe plus
  for r in
    select m.slot, m.alt from site_media m
     where m.file_id is null
       and m.url like '%/site_media/%'
       and not exists (select 1 from uploaded_files f where position(f.storage_key in m.url) > 0)
     order by m.slot
  loop
    k := k + 1;
    lost := lost || format(E'\n    %s  (%s)', r.slot, r.alt);
  end loop;

  raise notice E'\nPhotos rattachées à leur fichier : %\n\nPhotos à RENVOYER dans « Images et bannières » (fichier supprimé par l''ancien bug) : % %\n\n(hero-2 = carrousel, diapositive 2 ; course-… = photo d''une formation ; prestation-… = photo d''une prestation)',
    n, k, case when k = 0 then E'\n    aucune' else lost end;
end $$;
