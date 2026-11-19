-- E-MAN PROD — migration 004 : espaces client et administrateur (v2.7)
-- Uniquement des ajouts : aucune donnée existante n'est modifiée.

-- Photo de profil ------------------------------------------------------------------
alter table uploaded_files drop constraint uploaded_files_purpose_check;
alter table uploaded_files add constraint uploaded_files_purpose_check
  check (purpose in ('quote', 'order', 'message', 'portfolio', 'site_media', 'avatar', 'enrollment'));
alter table users add column avatar_file_id uuid references uploaded_files(id) on delete set null;

-- Documents d'une inscription (attestation, support de cours…), déposés par l'équipe.
alter table uploaded_files add column enrollment_id uuid references enrollments(id) on delete restrict;
create index files_enrollment_idx on uploaded_files (enrollment_id) where enrollment_id is not null;
alter table uploaded_files drop constraint uploaded_files_check;
alter table uploaded_files add constraint uploaded_files_check
  check (num_nonnulls(quote_id, order_id, message_id, portfolio_item_id, enrollment_id) <= 1);

-- Assistance : un fil de discussion par client, hors devis et commandes.
alter table messages add column support_user_id uuid references users(id) on delete cascade;
alter table messages drop constraint messages_check;
alter table messages add constraint messages_check check (num_nonnulls(quote_id, order_id, support_user_id) = 1);
create index messages_support_idx on messages (support_user_id, created_at) where support_user_id is not null;

-- Nouveau droit STAFF : l'assistance.
alter table users drop constraint users_permissions_check;
alter table users add constraint users_permissions_check
  check (permissions <@ array['quotes', 'orders', 'trainings', 'content', 'clients', 'support']::text[]);

-- Commandes : collaborateur chargé de la commande.
alter table orders add column assigned_to uuid references users(id) on delete set null;
create index orders_assigned_idx on orders (assigned_to) where assigned_to is not null;

-- Formations archivées : retirées du site et de la liste courante, conservées avec leur historique.
alter table trainings add column archived_at timestamptz;
alter table trainings add constraint trainings_archived_check check (archived_at is null or published = false);
