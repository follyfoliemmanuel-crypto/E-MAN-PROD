-- 012 — Messagerie privée (statuts reçu/lu, présence, « écrit un message… », vocaux),
-- profils publics de l'équipe et double authentification (Google Authenticator).
-- Migration ADDITIVE : des colonnes et des tables s'ajoutent ; rien n'est supprimé ni réécrit,
-- sauf le remplissage de « reçu » pour les messages déjà lus (un message lu a forcément été reçu).

-- ---------------------------------------------------------------- Messages
alter table messages add column if not exists delivered_at timestamptz;          -- reçu par un appareil de l'autre partie
alter table messages add column if not exists kind text not null default 'text';
alter table messages add constraint messages_kind_values check (kind in ('text', 'voice', 'file'));
alter table messages add column if not exists voice_ms integer;
alter table messages add constraint messages_voice_ms_range check (voice_ms is null or voice_ms between 0 and 600000);
-- Dernier changement (création, reçu, lu) : le temps réel ne relit que ce qui a bougé.
alter table messages add column if not exists changed_at timestamptz not null default now();
update messages set delivered_at = read_at where read_at is not null and delivered_at is null;
create index if not exists messages_support_idx on messages (support_user_id, created_at desc) where support_user_id is not null;
create index if not exists messages_changed_idx on messages (changed_at) where support_user_id is not null;
create index if not exists messages_undelivered_idx on messages (support_user_id) where support_user_id is not null and delivered_at is null;

-- ---------------------------------------------------------------- Profils publics
alter table users add column if not exists public_name text;
alter table users add constraint users_public_name_len check (public_name is null or length(public_name) between 2 and 80);
alter table users add column if not exists job_title text;
alter table users add constraint users_job_title_len check (job_title is null or length(job_title) between 2 and 80);
alter table users add column if not exists bio text;
alter table users add constraint users_bio_len check (bio is null or length(bio) <= 600);
alter table users add column if not exists show_last_seen boolean not null default true;
alter table users add column if not exists last_active_at timestamptz;

-- ---------------------------------------------------------------- Présence
-- Une ligne par connexion temps réel ouverte (un onglet visible = une connexion) ; plusieurs
-- appareils = plusieurs lignes. « En ligne » = au moins une ligne vue depuis moins de 50 s :
-- une connexion coupée sans prévenir expire d'elle-même.
create table if not exists presence (
  user_id uuid not null references users(id) on delete cascade,
  conn_id text not null check (conn_id ~ '^[A-Za-z0-9_-]{8,40}$'),
  seen_at timestamptz not null default now(),
  primary key (user_id, conn_id)
);
create index if not exists presence_seen_idx on presence (seen_at);

-- « écrit un message… » : valable quelques secondes.
create table if not exists typing (
  thread_user_id uuid not null references users(id) on delete cascade,   -- la conversation (le client)
  user_id uuid not null references users(id) on delete cascade,          -- la personne qui écrit
  until timestamptz not null,
  primary key (thread_user_id, user_id)
);

-- ---------------------------------------------------------------- Double authentification
alter table users add column if not exists mfa_secret_enc text;      -- secret TOTP chiffré (AES-256-GCM)
alter table users add column if not exists mfa_pending_enc text;     -- secret en cours d'activation
alter table users add column if not exists mfa_enabled_at timestamptz;
alter table users add column if not exists mfa_last_step bigint;     -- dernier code accepté : un code ne sert qu'une fois

create table if not exists mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null unique,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists mfa_recovery_user_idx on mfa_recovery_codes (user_id) where used_at is null;

-- Étape « code à 6 chiffres » après le mot de passe (ou Google) : 10 minutes, 5 essais.
create table if not exists mfa_challenges (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  method text not null check (method in ('password', 'google', 'reset', 'verify')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Appareils de confiance : durée limitée, révocables, jamais permanents.
create table if not exists trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  label text check (label is null or length(label) <= 120),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  ip_hash text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists trusted_devices_user_idx on trusted_devices (user_id);

alter table sessions add column if not exists mfa_verified_at timestamptz;   -- dernier code saisi sur cette session
alter table sessions add column if not exists trusted_device_id uuid references trusted_devices(id) on delete set null;

-- Clé de chiffrement créée automatiquement si MFA_ENCRYPTION_KEY n'est pas définie (même principe
-- que les clés VAPID) : jamais renvoyée par l'API.
create table if not exists app_secrets (
  name text primary key check (name ~ '^[a-z_]{3,40}$'),
  value text not null,
  created_at timestamptz not null default now()
);
