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
