-- =============================================================================
-- E-MAN PROD v3.1.0 : installation ou mise à jour de la base de données
-- Fichier généré par « npm run db:sql » à partir de db/migrations : ne pas modifier à la main.
--
-- Utilisation (Neon) : console.neon.tech → votre projet → SQL Editor → coller tout
-- le fichier → Run. Ou en ligne de commande : psql "$DATABASE_URL" -f db/install-neon.sql
--
-- • Base vide : crée toutes les tables et le contenu de départ (pôles, prestations,
--   formations, textes du site).
-- • Base existante : n'applique que les migrations manquantes. Avant une mise à jour
--   d'une base en production, créez une branche Neon (sauvegarde instantanée).
-- • Relancer le fichier ne change rien. Aucune donnée n'est supprimée ou écrasée.
-- • Aucun compte n'est créé : voir la dernière section pour nommer l'administrateur.
-- =============================================================================

begin;

create table if not exists schema_migrations (
  version text primary key,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Migration 001_base.sql
-- -----------------------------------------------------------------------------
do $install$
declare applied text;
begin
  select checksum into applied from schema_migrations where version = '001';
  if applied is null then
    execute $m001$
-- E-MAN PROD — migration 001 : schéma de base (versions 1.0 à 2.4).
-- Appliquée une seule fois par `npm run db:migrate`. Ré-exécutable sur une base antérieure à la v2.5.
--
-- Le navigateur n'accède jamais directement à la base : toutes les lectures et
-- écritures passent par les fonctions /api (Vercel), qui contrôlent les droits.
-- La chaîne de connexion DATABASE_URL reste donc côté serveur uniquement.

create extension if not exists pgcrypto;

-- Comptes -------------------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  full_name text not null,
  phone text,
  role text not null default 'client' check (role in ('client','admin')),
  email_verified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));

-- Sessions : le cookie contient un jeton aléatoire ; seule son empreinte SHA-256 est stockée.
create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);

-- Jetons à usage unique : vérification d'e-mail et réinitialisation de mot de passe.
create table if not exists auth_tokens (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify','reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Tentatives (limitation anti-abus des connexions et des formulaires).
create table if not exists rate_events (
  bucket text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_bucket_idx on rate_events (bucket, created_at desc);

-- Commandes et devis --------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('EMP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  user_id uuid references users(id) on delete set null,
  customer_name text not null,
  customer_email text,
  phone text not null,
  service text not null,
  details text not null,
  quantity text,
  status text not null default 'En attente'
    check (status in ('En attente','Devis envoyé','Validée','En production','Terminée','Annulée')),
  total_amount numeric(12,0) check (total_amount is null or total_amount >= 0),
  payment_status text not null default 'Non payé'
    check (payment_status in ('Non payé','Acompte payé','Payé')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_user_idx on orders (user_id);
create index if not exists orders_created_idx on orders (created_at desc);
create index if not exists orders_email_idx on orders (lower(customer_email));

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists orders_touch_updated_at on orders;
create trigger orders_touch_updated_at before update on orders
for each row execute procedure touch_updated_at();

-- Inscriptions aux formations ----------------------------------------------
create table if not exists training_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  full_name text not null,
  phone text not null,
  email text,
  course text not null,
  message text,
  status text not null default 'Nouvelle demande'
    check (status in ('Nouvelle demande','Contacté','Inscrit','Terminé')),
  created_at timestamptz not null default now()
);
create index if not exists training_user_idx on training_registrations (user_id);
create index if not exists training_email_idx on training_registrations (lower(email));

-- Factures (prête pour une prochaine version) -------------------------------
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  invoice_number text not null unique,
  customer_name text not null,
  amount numeric(12,0) not null default 0,
  status text not null default 'Brouillon'
    check (status in ('Brouillon','Émise','Payée','En retard','Annulée')),
  due_date date,
  created_at timestamptz not null default now()
);

-- Nommer un administrateur (après avoir créé son compte sur le site) :
--   update users set role = 'admin' where lower(email) = lower('VOTRE_EMAIL');

-- Images du site (v2.3) ------------------------------------------------------
-- Chaque « emplacement » (photo du carrousel, carte d'activité…) peut recevoir
-- une image choisie depuis l'espace admin. Sans ligne ici, le site affiche le
-- visuel provisoire prévu dans le code.
create table if not exists site_media (
  slot text primary key check (slot ~ '^[a-z0-9-]{2,60}$'),
  url text not null,
  alt text not null default '',
  credit text,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Contenus du site (v2.4) ----------------------------------------------------
-- Le contenu initial est chargé par `npm run db:setup` (scripts/db.mjs, à partir
-- de src/content/seed.js) sans jamais écraser une modification faite dans l'admin.

create table if not exists prestations (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  title text not null,
  summary text not null,
  intro text not null default '',
  offerings jsonb not null default '[]',
  placeholder text,
  related_pole text,
  sort int not null default 0,
  published boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists training_poles (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  number int not null,
  title text not null,
  summary text not null default '',
  sort int not null default 0
);

create table if not exists courses (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  pole_slug text not null references training_poles(slug) on update cascade,
  title text not null,
  domain text not null,
  summary text not null,
  description text not null default '',
  objectives jsonb not null default '[]',
  program jsonb not null default '[]',
  -- Informations pratiques : vides tant que l'administration ne les a pas renseignées.
  duration text,
  level text,
  prerequisites text,
  price_fcfa integer check (price_fcfa is null or price_fcfa >= 0),
  price_note text,
  certificate text,
  placeholder text,
  sort int not null default 0,
  published boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists courses_pole_idx on courses (pole_slug, sort);

create table if not exists training_sessions (
  id uuid primary key default gen_random_uuid(),
  course_slug text not null references courses(slug) on update cascade on delete cascade,
  starts_on date not null,
  ends_on date check (ends_on is null or ends_on >= starts_on),
  schedule text,
  site text,
  seats integer check (seats is null or seats > 0),
  status text not null default 'ouverte' check (status in ('ouverte','fermée')),
  created_at timestamptz not null default now()
);
create index if not exists sessions_course_idx on training_sessions (course_slug, starts_on);

alter table training_registrations add column if not exists course_slug text references courses(slug) on update cascade on delete set null;
alter table training_registrations add column if not exists session_id uuid references training_sessions(id) on delete set null;
create index if not exists training_session_idx on training_registrations (session_id);

create table if not exists gallery_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('infographie','impression','serigraphie','enseignes','personnalisation','packaging')),
  title text not null,
  description text,
  image_url text not null,
  alt text not null,
  sort int not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists gallery_category_idx on gallery_items (category, sort);

create table if not exists content_blocks (
  key text primary key check (key ~ '^[a-z0-9-]{2,60}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
$m001$;
    insert into schema_migrations (version, name, checksum) values ('001', 'base', '5a58aa521be4c831bc188d283b3f0ec3b1c92f17380efbfc7e3d89602c787ba6');
    raise notice 'Migration 001_base.sql appliquée.';
  elsif applied <> '5a58aa521be4c831bc188d283b3f0ec3b1c92f17380efbfc7e3d89602c787ba6' then
    raise exception 'La migration 001_base.sql a été modifiée après application : rien n''a été changé.';
  else
    raise notice 'Migration 001_base.sql déjà appliquée.';
  end if;
end
$install$;

-- -----------------------------------------------------------------------------
-- Migration 002_backend.sql
-- -----------------------------------------------------------------------------
do $install$
declare applied text;
begin
  select checksum into applied from schema_migrations where version = '002';
  if applied is null then
    execute $m002$
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
$m002$;
    insert into schema_migrations (version, name, checksum) values ('002', 'backend', 'b490b923fb0653f37659815ce2e7868b5d0690778028130ef5d3825dad5996f5');
    raise notice 'Migration 002_backend.sql appliquée.';
  elsif applied <> 'b490b923fb0653f37659815ce2e7868b5d0690778028130ef5d3825dad5996f5' then
    raise exception 'La migration 002_backend.sql a été modifiée après application : rien n''a été changé.';
  else
    raise notice 'Migration 002_backend.sql déjà appliquée.';
  end if;
end
$install$;

-- -----------------------------------------------------------------------------
-- Migration 003_auth.sql
-- -----------------------------------------------------------------------------
do $install$
declare applied text;
begin
  select checksum into applied from schema_migrations where version = '003';
  if applied is null then
    execute $m003$
-- E-MAN PROD — migration 003 : authentification et sécurité (v2.6)
-- Rôles ADMIN / STAFF / CLIENT, connexion Google, sessions renouvelées et révocables.
-- Aucune donnée existante n'est modifiée, sauf l'ajout de colonnes.

-- Rôles et permissions -------------------------------------------------------
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('client', 'staff', 'admin'));

-- Permissions d'un membre STAFF, attribuées par un administrateur (jamais par le navigateur).
alter table users add column permissions text[] not null default '{}';
alter table users add constraint users_permissions_check
  check (permissions <@ array['quotes', 'orders', 'trainings', 'content', 'clients']::text[]);
-- Un client n'a aucune permission ; un admin les a toutes (sans liste).
alter table users add constraint users_permissions_role_check check (role = 'staff' or permissions = '{}');

-- Identité : nom et prénom (full_name reste le nom affiché).
alter table users add column first_name text check (first_name is null or length(first_name) between 1 and 60);
alter table users add column last_name text check (last_name is null or length(last_name) between 1 and 60);

-- Un compte créé avec Google n'a pas de mot de passe.
alter table users alter column password_hash drop not null;
alter table users add column password_changed_at timestamptz;
-- Compte désactivé par l'administration : plus aucune connexion possible.
alter table users add column disabled_at timestamptz;

alter table activity_logs drop constraint activity_logs_actor_role_check;
alter table activity_logs add constraint activity_logs_actor_role_check
  check (actor_role in ('client', 'staff', 'admin', 'system', 'guest'));
create index activity_security_idx on activity_logs (created_at desc) where action like 'auth.%' or action like 'security.%';

-- Sessions ----------------------------------------------------------------------
-- Le cookie contient un jeton aléatoire ; la base n'en garde que l'empreinte SHA-256.
-- Le jeton est renouvelé toutes les 24 h (l'ancien reste accepté 60 s, le temps que
-- les requêtes en cours se terminent). Durée maximale : 30 jours ; inactivité : 14 jours.
alter table sessions add column id uuid not null default gen_random_uuid();
alter table sessions add constraint sessions_id_key unique (id);
alter table sessions add column previous_token_hash text;
alter table sessions add column rotated_at timestamptz;
alter table sessions add column last_seen_at timestamptz;
update sessions set last_seen_at = created_at, rotated_at = created_at;
alter table sessions alter column last_seen_at set not null, alter column last_seen_at set default now();
alter table sessions alter column rotated_at set not null, alter column rotated_at set default now();
alter table sessions add column user_agent text check (user_agent is null or length(user_agent) <= 300);
alter table sessions add column ip_hash text;
alter table sessions add column method text not null default 'password' check (method in ('password', 'google', 'reset'));
create index sessions_previous_idx on sessions (previous_token_hash) where previous_token_hash is not null;

-- Connexion Google ------------------------------------------------------------------
alter table accounts add column email text;
alter table accounts add column last_login_at timestamptz;

-- Tentatives de connexion Google en cours (10 minutes, usage unique).
-- « state » est aussi posé dans un cookie : un lien de connexion fabriqué par un tiers échoue.
create table oauth_states (
  state_hash text primary key,
  nonce text not null,
  code_verifier text not null,
  return_to text not null default '/espace' check (return_to ~ '^/[^/\\]'),
  created_at timestamptz not null default now()
);
create index oauth_states_created_idx on oauth_states (created_at);
$m003$;
    insert into schema_migrations (version, name, checksum) values ('003', 'auth', '4187261bdfa0290b34b4fa1f97e8943fb329936bee9ef563496d8c9f613063f1');
    raise notice 'Migration 003_auth.sql appliquée.';
  elsif applied <> '4187261bdfa0290b34b4fa1f97e8943fb329936bee9ef563496d8c9f613063f1' then
    raise exception 'La migration 003_auth.sql a été modifiée après application : rien n''a été changé.';
  else
    raise notice 'Migration 003_auth.sql déjà appliquée.';
  end if;
end
$install$;

-- -----------------------------------------------------------------------------
-- Migration 004_spaces.sql
-- -----------------------------------------------------------------------------
do $install$
declare applied text;
begin
  select checksum into applied from schema_migrations where version = '004';
  if applied is null then
    execute $m004$
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
$m004$;
    insert into schema_migrations (version, name, checksum) values ('004', 'spaces', '2961d29185dac07515ede9d9c76994ba3c203b351949b771e4431c6f372cf661');
    raise notice 'Migration 004_spaces.sql appliquée.';
  elsif applied <> '2961d29185dac07515ede9d9c76994ba3c203b351949b771e4431c6f372cf661' then
    raise exception 'La migration 004_spaces.sql a été modifiée après application : rien n''a été changé.';
  else
    raise notice 'Migration 004_spaces.sql déjà appliquée.';
  end if;
end
$install$;

-- -----------------------------------------------------------------------------
-- Migration 005_documents.sql
-- -----------------------------------------------------------------------------
do $install$
declare applied text;
begin
  select checksum into applied from schema_migrations where version = '005';
  if applied is null then
    execute $m005$
-- E-MAN PROD — migration 005 : notifications, e-mails, factures, paiements, formations (v2.8)
-- Uniquement des ajouts. Les montants encaissés déjà saisis sont repris tels quels, sans reçu.

-- Notifications --------------------------------------------------------------------
-- Rubrique de chaque notification (filtre du centre de notifications, choix des e-mails).
alter table notifications add column category text not null default 'general'
  check (category in ('general', 'quotes', 'orders', 'trainings', 'messages', 'announcements', 'account', 'team'));
update notifications set category = case
  when kind like 'quote.%' then 'quotes'
  when kind like 'order.%' then 'orders'
  when kind like 'enrollment.%' then 'trainings'
  when kind like 'message.%' then 'messages'
  else 'general' end;
create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);

-- Préférences de chaque personne : { "email": { "quotes": false, … } }. Vide = tout activé.
alter table users add column notification_prefs jsonb not null default '{}'::jsonb
  check (jsonb_typeof(notification_prefs) = 'object');

-- Journal des e-mails : « envoye » uniquement si le fournisseur a accepté le message.
create table email_log (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete set null,
  to_email text not null,
  template text not null check (template ~ '^[a-z_]{2,40}$'),
  subject text not null,
  status text not null check (status in ('envoye', 'echec', 'non_configure', 'desactive')),
  provider text,
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  check (status <> 'envoye' or provider_id is not null)
);
create index email_log_created_idx on email_log (created_at desc);
create index email_log_user_idx on email_log (user_id, created_at desc);

-- Annonces : « information importante » publiée pour les clients.
create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 3 and 140),
  body text not null check (length(body) between 10 and 4000),
  link text check (link is null or link ~ '^/' or link ~ '^https://'),
  audience text not null default 'clients' check (audience in ('clients', 'tous')),
  send_email boolean not null default false,
  recipients integer not null default 0,
  emailed integer not null default 0,
  created_by uuid references users(id) on delete set null,
  published_at timestamptz not null default now()
);

-- Paiements et reçus ---------------------------------------------------------------
create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  amount_fcfa bigint not null check (amount_fcfa <> 0),
  method text not null check (method in ('especes', 'mobile_money', 'virement', 'cheque', 'carte', 'autre', 'historique', 'correction')),
  reference text check (reference is null or length(reference) <= 120),
  received_on date not null default current_date,
  note text check (note is null or length(note) <= 500),
  receipt_number text unique,
  recorded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Une correction est le seul montant négatif ; seul un encaissement réel reçoit un numéro de reçu.
  check ((amount_fcfa < 0) = (method = 'correction')),
  check ((receipt_number is not null) = (amount_fcfa > 0 and method <> 'historique'))
);
create index payments_order_idx on payments (order_id, created_at);

-- Le montant encaissé d'une commande est la somme de ses paiements.
create function payments_sync_order() returns trigger language plpgsql as $$
declare
  paid bigint;
  tot bigint;
begin
  select coalesce(sum(amount_fcfa), 0) into paid from payments where order_id = new.order_id;
  if paid < 0 then raise exception 'Le total encaissé ne peut pas être négatif.'; end if;
  select total_fcfa into tot from orders where id = new.order_id;
  update orders set amount_paid_fcfa = paid,
    payment_status = case when paid = 0 then 'non_paye' when tot > 0 and paid >= tot then 'paye' else 'acompte' end
   where id = new.order_id;
  return new;
end $$;
create trigger payments_sync_order after insert on payments
for each row execute procedure payments_sync_order();

-- Reprise : les montants déjà saisis deviennent un paiement « historique », sans reçu.
insert into payments (order_id, amount_fcfa, method, note, received_on, created_at)
select id, amount_paid_fcfa, 'historique', 'Montant encaissé enregistré avant la v2.8 (aucun reçu émis).', created_at::date, created_at
  from orders where amount_paid_fcfa > 0;

-- Factures -------------------------------------------------------------------------
-- Les nouvelles factures gardent une copie figée de la commande (snapshot). Leur statut
-- n'est jamais « Payée » : l'état du paiement est calculé à partir des paiements enregistrés.
alter table invoices
  add column user_id uuid references users(id) on delete set null,
  add column total_fcfa bigint,
  add column snapshot jsonb,
  add column issued_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancel_reason text,
  add column created_by uuid references users(id) on delete set null;
alter table invoices add constraint invoices_v28_check check (
  snapshot is null or (status in ('Émise', 'Annulée') and issued_at is not null and total_fcfa is not null
    and (status = 'Annulée') = (cancelled_at is not null)));
create unique index invoices_active_order_idx on invoices (order_id) where snapshot is not null and cancelled_at is null;

-- Formations -----------------------------------------------------------------------
-- Résultat de l'évaluation, quand la formation en comporte une.
alter table enrollments add column result text check (result is null or result in ('reussi', 'non_reussi'));

-- Règles de délivrance, fixées par l'administration pour chaque formation.
-- kind null = aucun document délivré ; min_attendance en % ; evaluation = réussite exigée.
alter table trainings add column certificate_rules jsonb not null default '{}'::jsonb
  check (jsonb_typeof(certificate_rules) = 'object');

-- Présences : une ligne par apprenant et par jour de cours.
create table attendance (
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  day date not null,
  status text not null check (status in ('present', 'retard', 'absent', 'excuse')),
  note text check (note is null or length(note) <= 300),
  recorded_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, day)
);

-- Documents pédagogiques d'une session : visibles de tous les inscrits de la session.
alter table uploaded_files add column session_id uuid references training_sessions(id) on delete restrict;
create index files_session_idx on uploaded_files (session_id) where session_id is not null;
alter table uploaded_files drop constraint uploaded_files_purpose_check;
alter table uploaded_files add constraint uploaded_files_purpose_check
  check (purpose in ('quote', 'order', 'message', 'portfolio', 'site_media', 'avatar', 'enrollment', 'session'));
alter table uploaded_files drop constraint uploaded_files_check;
alter table uploaded_files add constraint uploaded_files_check
  check (num_nonnulls(quote_id, order_id, message_id, portfolio_item_id, enrollment_id, session_id) <= 1);

-- Attestations et certificats : émis après validation des conditions par l'équipe.
create table certificates (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default next_number('ATT'),
  verify_code text not null unique,
  enrollment_id uuid not null references enrollments(id) on delete restrict,
  kind text not null check (kind in ('attestation', 'certificat')),
  holder_name text not null,
  training_title text not null,
  session_label text,
  conditions jsonb not null,
  issued_by uuid references users(id) on delete set null,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  check ((revoked_at is null) = (revoked_reason is null))
);
create unique index certificates_active_idx on certificates (enrollment_id) where revoked_at is null;

-- Paramètres : les clés peuvent contenir un tiret bas (email_templates).
alter table site_settings drop constraint content_blocks_key_check;
alter table site_settings add constraint site_settings_key_check check (key ~ '^[a-z0-9_-]{2,60}$');
$m005$;
    insert into schema_migrations (version, name, checksum) values ('005', 'documents', '49c7e3a23fb2d5af1ea33a1b1699210b6d60ba695b209c466d11562a352a8456');
    raise notice 'Migration 005_documents.sql appliquée.';
  elsif applied <> '49c7e3a23fb2d5af1ea33a1b1699210b6d60ba695b209c466d11562a352a8456' then
    raise exception 'La migration 005_documents.sql a été modifiée après application : rien n''a été changé.';
  else
    raise notice 'Migration 005_documents.sql déjà appliquée.';
  end if;
end
$install$;

-- -----------------------------------------------------------------------------
-- Migration 006_performance.sql
-- -----------------------------------------------------------------------------
do $install$
declare applied text;
begin
  select checksum into applied from schema_migrations where version = '006';
  if applied is null then
    execute $m006$
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
$m006$;
    insert into schema_migrations (version, name, checksum) values ('006', 'performance', '1e4984ca950980b461b9a1274bd59fc0dc64b957d66a4feeaaefac56d6d96db3');
    raise notice 'Migration 006_performance.sql appliquée.';
  elsif applied <> '1e4984ca950980b461b9a1274bd59fc0dc64b957d66a4feeaaefac56d6d96db3' then
    raise exception 'La migration 006_performance.sql a été modifiée après application : rien n''a été changé.';
  else
    raise notice 'Migration 006_performance.sql déjà appliquée.';
  end if;
end
$install$;

-- -----------------------------------------------------------------------------
-- Contenu de départ (modifiable ensuite dans l'espace administrateur).
-- « on conflict do nothing » : un élément déjà présent n'est jamais modifié.
-- -----------------------------------------------------------------------------
insert into training_categories (slug, number, title, summary, sort) values ('arts-graphiques', 1, 'Arts graphiques et imprimerie', 'Infographie, design graphique, identité visuelle, impression numérique et grand format, sérigraphie, DTF, sublimation et personnalisation textile.', 1)
             on conflict (slug) do nothing;
insert into training_categories (slug, number, title, summary, sort) values ('informatique', 2, 'Informatique, maintenance et réseaux', 'Informatique et bureautique, maintenance matérielle et logicielle, sécurité informatique et réseaux.', 2)
             on conflict (slug) do nothing;
insert into training_categories (slug, number, title, summary, sort) values ('web', 3, 'Développement web et technologies numériques', 'HTML, CSS, JavaScript, sites vitrines et responsives, développement dynamique, bases de données, administration et mise en ligne.', 3)
             on conflict (slug) do nothing;
insert into services (slug, title, summary, intro, offerings, placeholder, related_category_slug, sort)
             values ('imprimerie', 'Imprimerie', 'Impression papier, bâche, vinyle, autocollant et textile, des petites séries aux grandes quantités.', 'Nous imprimons vos supports de communication et vos commandes personnalisées, sur papier comme sur grand format et textile. Envoyez-nous votre fichier, ou faites-le préparer par nos infographistes.', '["Impression papier","Bâches","Vinyle","Autocollants","Impression textile","DTF","Sublimation","Affiches","Flyers","Banderoles"]'::jsonb, 'grand-format', 'arts-graphiques', 1) on conflict (slug) do nothing;
insert into services (slug, title, summary, intro, offerings, placeholder, related_category_slug, sort)
             values ('infographie', 'Infographie', 'Logos, identité visuelle, affiches, brochures, cartes de visite, packaging et visuels numériques.', 'Nos infographistes conçoivent l’image de votre entreprise, de votre événement ou de votre produit, et préparent des fichiers prêts à imprimer ou à publier sur les réseaux.', '["Logos","Identité visuelle","Affiches","Brochures","Cartes de visite","Packaging","Visuels numériques"]'::jsonb, 'studio', 'arts-graphiques', 2) on conflict (slug) do nothing;
insert into services (slug, title, summary, intro, offerings, placeholder, related_category_slug, sort)
             values ('serigraphie', 'Sérigraphie', 'Sérigraphie artisanale et moderne, impression textile et personnalisation.', 'La sérigraphie permet des marquages résistants et économiques en série. Nous l’associons aux techniques d’impression textile pour personnaliser vos vêtements et objets.', '["Sérigraphie artisanale","Sérigraphie moderne","Impression textile","Personnalisation"]'::jsonb, 'serigraphie', 'arts-graphiques', 3) on conflict (slug) do nothing;
insert into services (slug, title, summary, intro, offerings, placeholder, related_category_slug, sort)
             values ('enseignes-publicite', 'Enseignes et publicité', 'Panneaux, plaques professionnelles, enseignes, habillage de vitrines et de véhicules.', 'Nous fabriquons et posons les supports qui rendent votre activité visible : de la plaque professionnelle à l’habillage complet d’une vitrine ou d’un véhicule.', '["Panneaux","Plaques professionnelles","Enseignes","Habillage de vitrines","Habillage de véhicules","Supports publicitaires"]'::jsonb, 'signaletique', null, 4) on conflict (slug) do nothing;
insert into services (slug, title, summary, intro, offerings, placeholder, related_category_slug, sort)
             values ('papeterie', 'Papeterie', 'Fournitures de bureau et articles de papeterie.', 'Nous proposons les fournitures de bureau et les articles de papeterie du quotidien, pour les entreprises, les écoles et les particuliers.', '["Fournitures de bureau","Articles de papeterie"]'::jsonb, 'fournitures', null, 5) on conflict (slug) do nothing;
insert into services (slug, title, summary, intro, offerings, placeholder, related_category_slug, sort)
             values ('informatique', 'Informatique et réseaux', 'Maintenance informatique et installation de réseaux pour les bureaux et commerces.', 'Nous intervenons sur vos ordinateurs et vos réseaux : diagnostic, dépannage, installation et configuration.', '["Diagnostic et dépannage","Maintenance matérielle et logicielle","Installation de systèmes","Câblage et réseaux LAN","Configuration de routeurs et switchs"]'::jsonb, 'maintenance', 'informatique', 6) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('infographie-design-graphique', 'arts-graphiques', 'Infographie et design graphique', 'Arts graphiques', 'Apprendre à concevoir des visuels professionnels et à préparer des fichiers pour l’impression et le numérique.', 'Une formation pratique pour maîtriser les bases de l’infographie et du design graphique : composition, couleurs, typographie et préparation des fichiers, à partir de cas réels de l’atelier.', '["Comprendre les règles de composition, de couleur et de typographie","Réaliser des visuels pour l’impression et les réseaux sociaux","Préparer des fichiers conformes aux exigences de l’imprimeur"]'::jsonb, '["Infographie","Design graphique","Mise en page","Préparation des fichiers pour l’impression"]'::jsonb, 'studio', 1) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('logo-identite-visuelle', 'arts-graphiques', 'Création de logos et identité visuelle', 'Arts graphiques', 'Concevoir un logo et décliner une identité visuelle cohérente sur tous les supports.', 'De la recherche d’idées à la charte graphique, cette formation montre comment créer un logo et l’appliquer de façon cohérente sur les supports d’une marque.', '["Mener une recherche créative à partir d’un besoin client","Dessiner et finaliser un logo","Décliner une identité visuelle sur différents supports"]'::jsonb, '["Création de logos","Identité visuelle","Charte graphique","Déclinaison sur supports"]'::jsonb, 'studio', 2) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('impression-numerique-grand-format', 'arts-graphiques', 'Impression numérique et grand format', 'Imprimerie', 'Utiliser les machines d’impression numérique et grand format, du réglage à la finition.', 'Une formation sur machine pour comprendre la chaîne d’impression : préparation, choix des supports, réglages, contrôle qualité et finitions.', '["Choisir le support et les réglages adaptés à une commande","Lancer et contrôler une impression numérique ou grand format","Réaliser les finitions courantes"]'::jsonb, '["Impression numérique","Impression grand format","Choix des supports","Contrôle qualité et finition"]'::jsonb, 'grand-format', 3) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('serigraphie', 'arts-graphiques', 'Sérigraphie', 'Imprimerie', 'Maîtriser les étapes de la sérigraphie, de la préparation de l’écran au tirage.', 'Une formation pratique aux techniques de sérigraphie artisanale et moderne, sur textile et autres supports.', '["Préparer un écran de sérigraphie","Réaliser un tirage propre en une ou plusieurs couleurs","Entretenir le matériel"]'::jsonb, '["Sérigraphie artisanale","Sérigraphie moderne","Préparation des écrans","Tirage et séchage"]'::jsonb, 'serigraphie', 4) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('dtf-sublimation-personnalisation', 'arts-graphiques', 'DTF, sublimation et personnalisation textile', 'Personnalisation', 'Personnaliser textiles et objets avec les procédés DTF et sublimation.', 'Une formation pour produire des articles personnalisés : t-shirts, polos, mugs et objets, avec les procédés DTF et sublimation.', '["Choisir le procédé adapté au support","Préparer et presser un transfert","Garantir la tenue du marquage"]'::jsonb, '["DTF","Sublimation","Personnalisation textile","Pressage et finition"]'::jsonb, 'textile', 5) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('informatique-bureautique', 'informatique', 'Informatique et bureautique', 'Informatique', 'Utiliser l’ordinateur et les logiciels de bureau au quotidien, avec aisance.', 'Une formation pour prendre en main l’ordinateur, les logiciels de bureautique et les outils numériques utilisés en entreprise.', '["Utiliser Windows et organiser ses fichiers","Produire documents, tableaux et présentations","Utiliser Internet et les outils numériques en sécurité"]'::jsonb, '["Windows","Word","Excel","PowerPoint","Internet","Outils numériques"]'::jsonb, 'atelier-info', 1) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('maintenance-informatique', 'informatique', 'Maintenance informatique', 'Informatique', 'Diagnostiquer, dépanner et entretenir les ordinateurs.', 'Une formation pratique au diagnostic et au dépannage, au montage des ordinateurs et à l’installation des systèmes.', '["Diagnostiquer une panne matérielle ou logicielle","Monter, démonter et installer un poste de travail","Appliquer les bonnes pratiques de sécurité informatique"]'::jsonb, '["Diagnostic informatique","Dépannage","Montage et démontage PC","Installation des systèmes","Maintenance matérielle et logicielle","Sécurité informatique"]'::jsonb, 'maintenance', 2) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('reseaux-informatiques', 'informatique', 'Réseaux informatiques', 'Réseaux', 'Concevoir, câbler et configurer un réseau local.', 'Une formation pour comprendre l’architecture d’un réseau, réaliser le câblage et configurer les équipements d’un réseau local.', '["Comprendre l’architecture d’un réseau local","Réaliser un câblage RJ45","Configurer et dépanner routeurs et switchs"]'::jsonb, '["Architecture réseau","Câblage RJ45","Routeurs","Switchs","Réseaux LAN","Configuration et dépannage"]'::jsonb, 'reseau', 3) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('html-css-javascript', 'web', 'HTML, CSS et JavaScript', 'Développement web', 'Les bases indispensables pour créer des pages web.', 'Une formation pour apprendre les trois langages du web et construire ses premières pages interactives.', '["Structurer une page avec HTML","La mettre en forme avec CSS","Ajouter de l’interactivité avec JavaScript"]'::jsonb, '["HTML","CSS","JavaScript"]'::jsonb, 'dev-web', 1) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('sites-vitrines-responsives', 'web', 'Sites vitrines et responsives', 'Développement web', 'Créer un site vitrine qui s’affiche bien sur ordinateur, tablette et téléphone.', 'Une formation orientée projet : concevoir et réaliser un site vitrine complet, adapté à tous les écrans.', '["Concevoir l’arborescence d’un site vitrine","Réaliser des pages adaptées à tous les écrans","Publier un site prêt à être présenté à un client"]'::jsonb, '["Création de sites vitrines","Sites web responsives"]'::jsonb, 'dev-web', 2) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('developpement-web-dynamique', 'web', 'Développement web dynamique et bases de données', 'Développement web', 'Créer des sites qui enregistrent et affichent des données.', 'Une formation pour passer du site statique au site dynamique : formulaires, traitement des données et bases de données.', '["Comprendre le fonctionnement d’un site dynamique","Concevoir une base de données simple","Relier un site à une base de données"]'::jsonb, '["Développement web dynamique","Bases de données"]'::jsonb, 'dev-web', 3) on conflict (slug) do nothing;
insert into trainings (slug, category_slug, title, domain, summary, description, objectives, program, placeholder, sort)
             values ('administration-hebergement', 'web', 'Administration, hébergement et mise en ligne', 'Technologies numériques', 'Mettre un site en ligne et l’administrer au quotidien.', 'Une formation pour choisir un hébergement, mettre un site en ligne et assurer son administration.', '["Choisir un hébergement et un nom de domaine","Mettre en ligne un site","Administrer et mettre à jour un site"]'::jsonb, '["Administration de sites web","Hébergement et mise en ligne"]'::jsonb, 'dev-web', 4) on conflict (slug) do nothing;
insert into site_settings (key, value) values ('business', '{"slogan":"E-man Prod, la référence !","email":"emanprod3@gmail.com","phone":"+22891388405","whatsapp":"+22891388405","sites":[{"label":"Siège","address":"Nouveau Marché de Baguida, Lomé"},{"label":"Annexe","address":"Agbavi, Yésuvito"}],"hours":null}'::jsonb) on conflict (key) do nothing;
insert into site_settings (key, value) values ('about', '{"title":"E-MAN PROD","lead":"E-MAN PROD est une entreprise togolaise spécialisée dans l’imprimerie, l’infographie, la communication visuelle, la sérigraphie, la personnalisation, la formation professionnelle, l’informatique et les technologies numériques.","activities":["Imprimerie","Infographie","Communication visuelle","Sérigraphie","Personnalisation","Formation professionnelle","Informatique et technologies numériques"]}'::jsonb) on conflict (key) do nothing;
insert into site_settings (key, value) values ('cars', '{"title":"E-MAN CARS","tagline":"Véhicules neufs et haut de gamme","intro":"E-MAN CARS est la branche commerciale du groupe E-MAN spécialisée dans les véhicules neufs et haut de gamme.","offers":[{"title":"Véhicules neufs","text":"Des véhicules neufs, pour les particuliers comme pour les entreprises."},{"title":"Haut de gamme","text":"Une sélection de véhicules haut de gamme."}],"contactText":"Pour connaître les véhicules disponibles, contactez l’équipe E-MAN CARS."}'::jsonb) on conflict (key) do nothing;

commit;

-- Vérification : doit afficher les migrations 001 à 006.
select version, name, applied_at from schema_migrations order by version;

-- -----------------------------------------------------------------------------
-- Administrateur : créez d'abord le compte sur le site (bouton « Inscription »,
-- ou « S'inscrire avec Google »), puis exécutez, avec la bonne adresse :
--
--   update users set role = 'admin' where lower(email) = lower('emanprod3@gmail.com');
--
-- (équivalent de « npm run db:admin -- emanprod3@gmail.com »)
-- -----------------------------------------------------------------------------
