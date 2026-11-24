-- =============================================================================
-- E-MAN PROD — mise à jour v4.1 : migration 013 (messagerie sans doublon, cadrage des photos)
-- À coller dans Neon → SQL Editor → Run, AVANT de déployer la v4.1 sur Vercel.
-- Additive : ajoute 3 colonnes et un index, ne supprime aucune donnée.
-- Sans danger si relancée : « déjà appliquée », rien ne change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Migration 013_chat_reliability_focus.sql
-- -----------------------------------------------------------------------------
do $install$
declare applied text;
begin
  -- Garde-fou DANS le bloc : rien n'est appliqué si la base n'est pas en 012.
  if not exists (select 1 from schema_migrations where version = '012') then
    raise exception 'Base pas encore en 012 : exécutez d''abord db/mise-a-jour-v4.0.sql (ou db/install-neon.sql en entier). Rien n''a été modifié.';
  end if;
  select checksum into applied from schema_migrations where version = '013';
  if applied is null then
    execute $m013$
-- 013 — Fiabilité de la messagerie et cadrage des photos du site. ADDITIVE : rien n'est supprimé.

-- Identifiant donné par le navigateur à chaque message : si le réseau coupe juste après l'envoi et
-- que le navigateur renvoie le message, le serveur le reconnaît et ne l'enregistre pas deux fois.
alter table messages add column if not exists client_ref text;
alter table messages add constraint messages_client_ref_format check (client_ref is null or client_ref ~ '^[A-Za-z0-9_-]{8,64}$');
create unique index if not exists messages_client_ref_uniq on messages (author_id, client_ref) where client_ref is not null;

-- Point important d'une photo du site (carrousel, bannières) : « 30% 45% » = 30 % depuis la gauche,
-- 45 % depuis le haut. Le recadrage automatique (téléphone, tablette, ordinateur) le garde en vue.
-- focus_mobile : point différent pour les écrans étroits (facultatif).
alter table site_media add column if not exists focus text;
alter table site_media add constraint site_media_focus_format check (focus is null or focus ~ '^(100|[0-9]{1,2})% (100|[0-9]{1,2})%$');
alter table site_media add column if not exists focus_mobile text;
alter table site_media add constraint site_media_focus_mobile_format check (focus_mobile is null or focus_mobile ~ '^(100|[0-9]{1,2})% (100|[0-9]{1,2})%$');
$m013$;
    insert into schema_migrations (version, name, checksum) values ('013', 'chat_reliability_focus', 'e006821e3668ca48a271e5a80c19c0dfc71ac7e38ed566831d8b64f591fc8759');
    raise notice 'Migration 013_chat_reliability_focus.sql appliquée.';
  elsif applied <> 'e006821e3668ca48a271e5a80c19c0dfc71ac7e38ed566831d8b64f591fc8759' then
    raise exception 'La migration 013_chat_reliability_focus.sql a été modifiée après application : rien n''a été changé.';
  else
    raise notice 'Migration 013_chat_reliability_focus.sql déjà appliquée.';
  end if;
end
$install$;

-- Vérification : doit afficher 013 | chat_reliability_focus
select version, name, applied_at from schema_migrations order by version desc limit 3;
