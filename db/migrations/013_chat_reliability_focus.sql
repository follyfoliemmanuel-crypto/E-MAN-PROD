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
