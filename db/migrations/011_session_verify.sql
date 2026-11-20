-- 011 — Une session peut aussi s'ouvrir par le lien de confirmation reçu à l'inscription.
-- Migration ADDITIVE : la liste des valeurs acceptées s'élargit, rien n'est modifié ni supprimé.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'sessions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%method%'
  loop
    execute format('alter table sessions drop constraint %I', c.conname);
  end loop;
end $$;
alter table sessions add constraint sessions_method_values check (method in ('password', 'google', 'reset', 'verify'));
