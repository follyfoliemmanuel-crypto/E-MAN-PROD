-- E-MAN PROD — migration 006 : index complémentaires (v3.0). Aucun changement de données.
-- Mesuré avant ajout : toutes les requêtes de l'application restent sous 15 ms avec
-- 3 000 clients, 10 000 devis et 70 000 notifications. Ces index couvrent les recherches
-- par client ou par formation et évitent des parcours complets lors des suppressions.
create index if not exists invoices_user_idx on invoices (user_id) where user_id is not null;
create index if not exists enrollments_training_idx on enrollments (training_slug);
create index if not exists messages_author_idx on messages (author_id) where author_id is not null;
create index if not exists testimonials_user_idx on testimonials (user_id) where user_id is not null;
create index if not exists files_portfolio_idx on uploaded_files (portfolio_item_id) where portfolio_item_id is not null;
create index if not exists users_avatar_idx on users (avatar_file_id) where avatar_file_id is not null;
create index if not exists portfolio_category_idx on portfolio_items (category_slug);
