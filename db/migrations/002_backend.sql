-- E-MAN PROD — migration 002 : backend v2.5 (devis, commandes, clients, fichiers…)
--
-- Exécutée par `npm run db:migrate`, dans une seule transaction : si une étape
-- échoue, rien n'est modifié. Une sauvegarde est faite juste avant.
--
-- Aucune donnée n'est supprimée :
--   - les tables existantes sont RENOMMÉES (les lignes restent en place) ;
--   - l'ancienne table « orders », qui mélangeait devis et commandes, est gardée
--     telle quelle sous le nom « legacy_orders » ; chaque ligne est recopiée en
--     devis (et en commande si elle était validée) ;
--   - chaque valeur qui ne trouve pas sa place dans le nouveau modèle est notée
--     dans activity_logs (action « migration.* »).

-- ============================================================================
-- 0. Outils communs
-- ============================================================================

-- Compteurs pour les numéros lisibles : DV-2026-00001, CMD-2026-00001.
-- L'upsert est atomique : deux demandes simultanées n'obtiennent jamais le même numéro.
create table counters (
  key text primary key,
  value bigint not null
);

create function next_number(prefix text) returns text
language sql volatile as $$
  insert into counters (key, value) values (prefix || '-' || to_char(now(), 'YYYY'), 1)
  on conflict (key) do update set value = counters.value + 1
  returning prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(value::text, 5, '0');
$$;

-- Journal d'activité : historique des devis, commandes, inscriptions et actions admin.
create table activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references users(id) on delete set null,
  actor_role text check (actor_role in ('client','admin','system','guest')),
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type text not null,
  entity_id text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_entity_idx on activity_logs (entity_type, entity_id, created_at desc);
create index activity_actor_idx on activity_logs (actor_id, created_at desc);

-- ============================================================================
-- 1. Comptes : User, Account, Session, VerificationToken, ClientProfile
-- ============================================================================

alter table users add column updated_at timestamptz not null default now();
alter table users add column last_login_at timestamptz;
create trigger users_touch_updated_at before update on users
for each row execute procedure touch_updated_at();

-- Connexions externes (Google, Facebook…), prêtes pour plus tard. La connexion
-- actuelle par e-mail et mot de passe n'en a pas besoin.
create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9-]{2,40}$'),
  provider_account_id text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);
create index accounts_user_idx on accounts (user_id);

create index sessions_expires_idx on sessions (expires_at);

alter table auth_tokens rename to verification_tokens;
alter table verification_tokens rename constraint auth_tokens_pkey to verification_tokens_pkey;
create index verification_tokens_user_idx on verification_tokens (user_id);

create table client_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  client_type text not null default 'particulier'
    check (client_type in ('particulier','entreprise','association','etablissement')),
  company_name text check (company_name is null or length(company_name) <= 160),
  address text check (address is null or length(address) <= 300),
  city text check (city is null or length(city) <= 120),
  whatsapp text check (whatsapp is null or whatsapp ~ '^\+[0-9]{8,15}$'),
  preferred_contact text not null default 'whatsapp' check (preferred_contact in ('whatsapp','appel','email')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger client_profiles_touch_updated_at before update on client_profiles
for each row execute procedure touch_updated_at();
insert into client_profiles (user_id) select id from users on conflict do nothing;

-- ============================================================================
-- 2. Catalogue : Service, TrainingCategory, Training (+ sessions)
-- ============================================================================

alter table prestations rename to services;
alter table services rename constraint prestations_pkey to services_pkey;
alter table services rename column related_pole to related_category_slug;

alter table training_poles rename to training_categories;
alter table training_categories rename constraint training_poles_pkey to training_categories_pkey;

-- Lien prestation → pôle de formation : une valeur sans pôle correspondant est
-- notée dans le journal avant d'être vidée (la contrainte l'exige).
insert into activity_logs (actor_role, action, entity_type, entity_id, data)
select 'system', 'migration.repaired', 'service', slug, jsonb_build_object('related_pole', related_category_slug)
  from services
 where related_category_slug is not null
   and related_category_slug not in (select slug from training_categories);
update services set related_category_slug = null
 where related_category_slug is not null
   and related_category_slug not in (select slug from training_categories);
alter table services add constraint services_related_category_fkey
  foreign key (related_category_slug) references training_categories(slug) on update cascade on delete set null;

alter table courses rename to trainings;
alter table trainings rename constraint courses_pkey to trainings_pkey;
alter table trainings rename column pole_slug to category_slug;
alter table trainings rename constraint courses_pole_slug_fkey to trainings_category_slug_fkey;
alter index courses_pole_idx rename to trainings_category_idx;

alter table training_sessions rename column course_slug to training_slug;
alter table training_sessions rename constraint training_sessions_course_slug_fkey to training_sessions_training_slug_fkey;
alter index sessions_course_idx rename to training_sessions_training_idx;
alter table training_sessions add column updated_at timestamptz not null default now();
create trigger training_sessions_touch_updated_at before update on training_sessions
for each row execute procedure touch_updated_at();

-- ============================================================================
-- 3. Enrollment (inscriptions)
-- ============================================================================

alter table training_registrations rename to enrollments;
alter table enrollments rename constraint training_registrations_pkey to enrollments_pkey;
alter table enrollments rename column course to training_title;   -- intitulé au moment de l'inscription
alter table enrollments rename column course_slug to training_slug;
alter table enrollments rename constraint training_registrations_course_slug_fkey to enrollments_training_slug_fkey;
alter index training_user_idx rename to enrollments_user_idx;
alter index training_email_idx rename to enrollments_email_idx;
alter index training_session_idx rename to enrollments_session_idx;
alter table enrollments drop constraint training_registrations_status_check;
alter table enrollments add constraint enrollments_status_check
  check (status in ('Nouvelle demande','Contacté','Inscrit','Terminé','Annulé'));
alter table enrollments add column admin_note text;
alter table enrollments add column updated_at timestamptz;
update enrollments set updated_at = created_at;
alter table enrollments alter column updated_at set not null, alter column updated_at set default now();
create trigger enrollments_touch_updated_at before update on enrollments
for each row execute procedure touch_updated_at();
create index enrollments_status_idx on enrollments (session_id, status);

-- ============================================================================
-- 4. Devis : Quote, QuoteItem
-- ============================================================================

-- L'ancienne table est conservée intacte. Ses index et contraintes sont renommés
-- pour libérer les noms utilisés par la nouvelle table « orders ».
alter table orders rename to legacy_orders;
alter table legacy_orders rename constraint orders_pkey to legacy_orders_pkey;
alter table legacy_orders rename constraint orders_reference_key to legacy_orders_reference_key;
alter index orders_user_idx rename to legacy_orders_user_idx;
alter index orders_created_idx rename to legacy_orders_created_idx;
alter index orders_email_idx rename to legacy_orders_email_idx;
drop trigger orders_touch_updated_at on legacy_orders;
comment on table legacy_orders is 'Demandes reçues avant la v2.5 (lecture seule). Recopiées dans quotes et orders par la migration 002.';

create table quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default next_number('DV'),
  user_id uuid references users(id) on delete set null,
  customer_name text not null check (length(customer_name) between 2 and 120),
  customer_phone text not null,
  customer_email text,
  customer_company text,
  message text,                                   -- description envoyée par le client
  status text not null default 'nouveau'
    check (status in ('nouveau','en_etude','envoye','accepte','refuse','expire','annule')),
  source text not null default 'site' check (source in ('site','whatsapp','telephone','atelier','admin')),
  subtotal_fcfa bigint not null default 0,        -- tenu à jour par déclencheur
  discount_fcfa bigint not null default 0 check (discount_fcfa >= 0),
  total_fcfa bigint generated always as (greatest(subtotal_fcfa - discount_fcfa, 0)) stored,
  valid_until date,
  admin_note text,
  sent_at timestamptz,
  decided_at timestamptz,                         -- accepté ou refusé
  cancelled_at timestamptz,
  legacy_order_id uuid unique references legacy_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_user_idx on quotes (user_id, created_at desc);
create index quotes_status_idx on quotes (status, created_at desc);
create index quotes_email_idx on quotes (lower(customer_email));
create index quotes_phone_idx on quotes (customer_phone);
create trigger quotes_touch_updated_at before update on quotes
for each row execute procedure touch_updated_at();

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  service_slug text references services(slug) on update cascade on delete set null,
  label text not null check (length(label) between 2 and 160),
  description text,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit text,                                      -- pièce, m², lot…
  unit_price_fcfa bigint check (unit_price_fcfa is null or unit_price_fcfa >= 0),  -- vide = pas encore chiffré
  line_total_fcfa bigint generated always as (round(quantity * unit_price_fcfa)::bigint) stored,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index quote_items_quote_idx on quote_items (quote_id, sort);
create index quote_items_service_idx on quote_items (service_slug);

-- ============================================================================
-- 5. Commandes : Order, OrderItem
-- ============================================================================

create table orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default next_number('CMD'),
  quote_id uuid references quotes(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  customer_name text not null check (length(customer_name) between 2 and 120),
  customer_phone text not null,
  customer_email text,
  status text not null default 'confirmee'
    check (status in ('confirmee','en_production','terminee','livree','annulee')),
  payment_status text not null default 'non_paye' check (payment_status in ('non_paye','acompte','paye')),
  amount_paid_fcfa bigint not null default 0 check (amount_paid_fcfa >= 0),
  subtotal_fcfa bigint not null default 0,
  discount_fcfa bigint not null default 0 check (discount_fcfa >= 0),
  total_fcfa bigint generated always as (greatest(subtotal_fcfa - discount_fcfa, 0)) stored,
  due_on date,                                    -- date promise au client
  delivered_at timestamptz,
  cancelled_at timestamptz,
  admin_note text,
  legacy_order_id uuid unique references legacy_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index orders_quote_key on orders (quote_id) where quote_id is not null;   -- une commande par devis
create index orders_user_idx on orders (user_id, created_at desc);
create index orders_status_idx on orders (status, created_at desc);
create trigger orders_touch_updated_at before update on orders
for each row execute procedure touch_updated_at();

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  quote_item_id uuid references quote_items(id) on delete set null,
  service_slug text references services(slug) on update cascade on delete set null,
  label text not null check (length(label) between 2 and 160),
  description text,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit text,
  unit_price_fcfa bigint check (unit_price_fcfa is null or unit_price_fcfa >= 0),
  line_total_fcfa bigint generated always as (round(quantity * unit_price_fcfa)::bigint) stored,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index order_items_order_idx on order_items (order_id, sort);
create index order_items_service_idx on order_items (service_slug);

-- Sous-totaux recalculés à chaque ajout, modification ou suppression de ligne.
create function recalc_quote_total() returns trigger language plpgsql as $$
declare qid uuid := coalesce(new.quote_id, old.quote_id);
begin
  update quotes set subtotal_fcfa = coalesce((select sum(line_total_fcfa) from quote_items where quote_id = qid), 0)
   where id = qid;
  if tg_op = 'UPDATE' and old.quote_id is distinct from new.quote_id then
    update quotes set subtotal_fcfa = coalesce((select sum(line_total_fcfa) from quote_items where quote_id = old.quote_id), 0)
     where id = old.quote_id;
  end if;
  return null;
end;
$$;
create trigger quote_items_total after insert or update or delete on quote_items
for each row execute procedure recalc_quote_total();

create function recalc_order_total() returns trigger language plpgsql as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  update orders set subtotal_fcfa = coalesce((select sum(line_total_fcfa) from order_items where order_id = oid), 0)
   where id = oid;
  return null;
end;
$$;
create trigger order_items_total after insert or update or delete on order_items
for each row execute procedure recalc_order_total();

-- Factures (table existante) : elles pointent désormais vers les nouvelles commandes.
-- L'ancien lien est gardé dans legacy_order_id.
alter table invoices add column legacy_order_id uuid references legacy_orders(id) on delete set null;
update invoices set legacy_order_id = order_id;
alter table invoices drop constraint invoices_order_id_fkey;
update invoices set order_id = null;

-- ============================================================================
-- 6. Reprise des anciennes demandes (legacy_orders → quotes / orders)
-- ============================================================================

insert into quotes (number, user_id, customer_name, customer_phone, customer_email, message, status, source,
                    admin_note, decided_at, cancelled_at, legacy_order_id, created_at, updated_at)
select o.reference, o.user_id, o.customer_name, o.phone, o.customer_email, o.details,
       case o.status when 'En attente' then 'nouveau' when 'Devis envoyé' then 'envoye' when 'Annulée' then 'annule' else 'accepte' end,
       'site', o.admin_note,
       -- dates de décision inconnues avant la v2.5 : laissées vides plutôt qu'inventées
       null, null,
       o.id, o.created_at, o.updated_at
  from legacy_orders o;

-- Une ligne de devis par ancienne demande : la prestation, la quantité saisie
-- (texte libre) et le montant total, s'il avait été fixé.
insert into quote_items (quote_id, service_slug, label, description, quantity, unit_price_fcfa)
select q.id,
       (select s.slug from services s where lower(s.title) = lower(o.service) limit 1),
       left(o.service, 160),
       case when o.quantity is not null then 'Quantité / format : ' || o.quantity end,
       1, o.total_amount
  from quotes q join legacy_orders o on o.id = q.legacy_order_id;

insert into orders (number, quote_id, user_id, customer_name, customer_phone, customer_email, status, payment_status,
                    admin_note, legacy_order_id, created_at, updated_at)
select o.reference, q.id, o.user_id, o.customer_name, o.phone, o.customer_email,
       case o.status when 'Validée' then 'confirmee' when 'En production' then 'en_production' else 'terminee' end,
       case o.payment_status when 'Acompte payé' then 'acompte' when 'Payé' then 'paye' else 'non_paye' end,
       o.admin_note, o.id, o.created_at, o.updated_at
  from legacy_orders o join quotes q on q.legacy_order_id = o.id
 where o.status in ('Validée','En production','Terminée');

insert into order_items (order_id, quote_item_id, service_slug, label, description, quantity, unit, unit_price_fcfa, sort)
select ord.id, qi.id, qi.service_slug, qi.label, qi.description, qi.quantity, qi.unit, qi.unit_price_fcfa, qi.sort
  from orders ord join quote_items qi on qi.quote_id = ord.quote_id
 where ord.legacy_order_id is not null;

update invoices i set order_id = ord.id from orders ord where ord.legacy_order_id = i.legacy_order_id;
alter table invoices add constraint invoices_order_id_fkey foreign key (order_id) references orders(id) on delete restrict;

-- Trace de chaque reprise, avec les valeurs d'origine.
insert into activity_logs (actor_role, action, entity_type, entity_id, data, created_at)
select 'system', 'migration.imported', 'quote', q.id::text,
       jsonb_build_object('legacy_order_id', o.id, 'reference', o.reference, 'status', o.status,
                          'payment_status', o.payment_status, 'total_amount', o.total_amount, 'quantity', o.quantity),
       now()
  from quotes q join legacy_orders o on o.id = q.legacy_order_id;

-- ============================================================================
-- 7. Réalisations : Portfolio, PortfolioCategory
-- ============================================================================

create table portfolio_categories (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  title text not null,
  sort int not null default 0
);
insert into portfolio_categories (slug, title, sort) values
  ('infographie', 'Infographie', 1), ('impression', 'Impression', 2), ('serigraphie', 'Sérigraphie', 3),
  ('enseignes', 'Enseignes', 4), ('personnalisation', 'Personnalisation', 5), ('packaging', 'Packaging', 6);

alter table gallery_items rename to portfolio_items;
alter table portfolio_items rename constraint gallery_items_pkey to portfolio_items_pkey;
alter table portfolio_items drop constraint gallery_items_category_check;
alter table portfolio_items rename column category to category_slug;
alter table portfolio_items add constraint portfolio_items_category_fkey
  foreign key (category_slug) references portfolio_categories(slug) on update cascade on delete restrict;
drop index gallery_category_idx;
alter table portfolio_items add column status text not null default 'publie' check (status in ('brouillon','publie','masque'));
alter table portfolio_items add column published_at timestamptz;
update portfolio_items set status = case when published then 'publie' else 'masque' end,
                           published_at = case when published then created_at end;
alter table portfolio_items drop column published;
alter table portfolio_items add column service_slug text references services(slug) on update cascade on delete set null;
alter table portfolio_items add column updated_at timestamptz;
update portfolio_items set updated_at = created_at;
alter table portfolio_items alter column updated_at set not null, alter column updated_at set default now();
alter table portfolio_items add constraint portfolio_items_published_check check (status <> 'publie' or published_at is not null);
create index portfolio_items_listing_idx on portfolio_items (status, category_slug, sort);
create trigger portfolio_items_touch_updated_at before update on portfolio_items
for each row execute procedure touch_updated_at();

-- ============================================================================
-- 8. Testimonial, Notification, Message
-- ============================================================================

create table testimonials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  author_name text not null check (length(author_name) between 2 and 120),
  author_title text check (author_title is null or length(author_title) <= 120),   -- fonction, entreprise
  content text not null check (length(content) between 10 and 1000),
  rating smallint check (rating between 1 and 5),
  service_slug text references services(slug) on update cascade on delete set null,
  status text not null default 'en_attente' check (status in ('en_attente','publie','refuse')),
  consent_at timestamptz not null,                -- accord écrit de la personne pour publier son avis
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'publie' or published_at is not null)
);
create index testimonials_status_idx on testimonials (status, published_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]+(\.[a-z_]+)*$'),
  title text not null,
  body text,
  link text check (link is null or link ~ '^/'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

-- Fil de discussion attaché à un devis ou à une commande.
create table messages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  author_role text not null check (author_role in ('client','admin')),
  body text not null check (length(body) between 1 and 4000),
  read_at timestamptz,                            -- lu par l'autre partie
  created_at timestamptz not null default now(),
  check (num_nonnulls(quote_id, order_id) = 1)
);
create index messages_quote_idx on messages (quote_id, created_at) where quote_id is not null;
create index messages_order_idx on messages (order_id, created_at) where order_id is not null;

-- ============================================================================
-- 9. UploadedFile
-- ============================================================================

-- Le fichier lui-même est dans le stockage (S3 compatible : Cloudflare R2, AWS S3…) ;
-- la base garde qui l'a envoyé, à quoi il est rattaché, son type et sa taille.
-- Un fichier rattaché à un devis, une commande ou un message ne peut pas
-- disparaître avec eux (RESTRICT) : il faut le supprimer d'abord, stockage compris.
create table uploaded_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id) on delete set null,
  purpose text not null check (purpose in ('quote','order','message','portfolio','site_media')),
  driver text not null check (driver in ('s3','local')),
  storage_key text not null unique,
  original_name text not null check (length(original_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  visibility text not null default 'private' check (visibility in ('private','public')),
  status text not null default 'pending' check (status in ('pending','ready','rejected')),
  quote_id uuid references quotes(id) on delete restrict,
  order_id uuid references orders(id) on delete restrict,
  message_id uuid references messages(id) on delete restrict,
  portfolio_item_id uuid references portfolio_items(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  check (num_nonnulls(quote_id, order_id, message_id, portfolio_item_id) <= 1)
);
create index files_owner_idx on uploaded_files (owner_id, created_at desc);
create index files_quote_idx on uploaded_files (quote_id) where quote_id is not null;
create index files_order_idx on uploaded_files (order_id) where order_id is not null;
create index files_message_idx on uploaded_files (message_id) where message_id is not null;
create index files_pending_idx on uploaded_files (created_at) where status = 'pending';

alter table portfolio_items add column image_file_id uuid references uploaded_files(id) on delete set null;
alter table site_media add column file_id uuid references uploaded_files(id) on delete set null;

-- ============================================================================
-- 10. SiteSettings
-- ============================================================================

alter table content_blocks rename to site_settings;
alter table site_settings rename constraint content_blocks_pkey to site_settings_pkey;
alter table site_settings add column updated_by uuid references users(id) on delete set null;
