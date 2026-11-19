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
