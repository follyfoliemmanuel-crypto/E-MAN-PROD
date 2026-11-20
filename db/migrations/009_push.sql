-- 009 — Notifications push (en complément des notifications dans l'espace et des e-mails).
-- Migration ADDITIVE : deux nouvelles tables, rien n'est modifié ni supprimé.

-- Un abonnement par appareil (navigateur) ; un compte peut en avoir plusieurs.
-- L'adresse (endpoint) est unique : si quelqu'un d'autre se connecte sur le même appareil
-- et active les notifications, l'appareil passe à son compte et l'ancien n'y reçoit plus rien.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000),
  p256dh text not null check (char_length(p256dh) between 80 and 100),
  auth text not null check (char_length(auth) between 16 and 30),
  device_label text check (char_length(device_label) <= 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures int not null default 0,
  last_error text,
  last_error_at timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

-- Paire de clés VAPID créée automatiquement si VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ne sont pas définies.
-- Lue uniquement par le serveur ; la clé privée n'est jamais envoyée au navigateur.
create table if not exists push_keys (
  id int primary key check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
