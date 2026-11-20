-- 008 — Les commandes sont passées par les clients depuis leur espace.
-- L'atelier les reçoit « en attente », les confirme (ou les refuse), puis fait avancer leur statut.
-- Migration uniquement ADDITIVE : aucune ligne modifiée ni supprimée, aucune colonne retirée.

-- Nouveau statut de départ : « en attente de confirmation » (les anciens restent acceptés).
-- Le nom de l'ancienne contrainte varie selon l'historique de la base (orders_status_check, orders_status_check1…) :
-- on retire toute contrainte de statut existante, quel que soit son nom, avant de poser la nouvelle.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%confirmee%'
  loop
    execute format('alter table orders drop constraint %I', c.conname);
  end loop;
end $$;
alter table orders add constraint orders_status_values
  check (status in ('en_attente', 'confirmee', 'en_production', 'terminee', 'livree', 'annulee'));

-- Ce que le client écrit en passant commande, et la date qu'il souhaite (l'atelier fixe la date promise).
alter table orders add column if not exists client_note text check (char_length(client_note) <= 4000);
alter table orders add column if not exists wanted_on date;
alter table orders add column if not exists confirmed_at timestamptz;
-- Qui a passé la commande : le client lui-même, ou un devis accepté puis converti.
alter table orders add column if not exists origin text check (origin in ('devis', 'client', 'atelier'));

create index if not exists orders_pending_idx on orders (created_at desc) where status = 'en_attente';
