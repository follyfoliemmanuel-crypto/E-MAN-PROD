-- 010 — Formations : durées multiples, frais, conditions d'admission (tout se règle dans l'administration).
-- Migration ADDITIVE : nouvelles colonnes seulement. Les anciennes (duration, prerequisites, price_fcfa…)
-- sont conservées et restent remplies, pour les PDF, e-mails et inscriptions existants.

alter table trainings add column if not exists duration_options jsonb not null default '[]'::jsonb
  check (jsonb_typeof(duration_options) = 'array' and jsonb_array_length(duration_options) <= 12);
alter table trainings add column if not exists registration_fee_fcfa integer check (registration_fee_fcfa is null or registration_fee_fcfa >= 0);
alter table trainings add column if not exists extra_fees jsonb not null default '[]'::jsonb
  check (jsonb_typeof(extra_fees) = 'array' and jsonb_array_length(extra_fees) <= 12);
alter table trainings add column if not exists payment_terms text check (char_length(payment_terms) <= 600);
alter table trainings add column if not exists admission_requirements jsonb not null default '[]'::jsonb
  check (jsonb_typeof(admission_requirements) = 'array' and jsonb_array_length(admission_requirements) <= 20);

-- Reprise des valeurs déjà saisies : la durée devient la première option, le prérequis la première condition.
update trainings set duration_options = jsonb_build_array(jsonb_build_object('label', duration))
 where duration is not null and btrim(duration) <> '' and duration_options = '[]'::jsonb;
update trainings set admission_requirements = jsonb_build_array(prerequisites)
 where prerequisites is not null and btrim(prerequisites) <> '' and admission_requirements = '[]'::jsonb;
