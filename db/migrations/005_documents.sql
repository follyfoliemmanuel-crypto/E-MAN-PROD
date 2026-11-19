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
