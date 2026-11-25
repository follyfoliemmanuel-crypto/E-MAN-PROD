-- =====================================================================================
-- E-MAN PROD — Remise à zéro des données de TEST avant la mise en production
-- =====================================================================================
--
-- AVANT DE LANCER : faites une copie de secours de la base (30 secondes, sans risque)
--   Neon → votre projet → « Branches » → « Create branch » (nom : avant-production).
--   Cette branche garde une copie exacte de la base d'aujourd'hui : en cas d'erreur,
--   vous pourrez tout récupérer.
--
-- COMMENT LANCER : Neon → SQL Editor → coller TOUT ce fichier → Run.
--   Tout se fait en une seule opération : si une étape échoue, RIEN n'est modifié.
--   À la fin, l'onglet des messages affiche ce qui a été supprimé.
--
-- CE QUI EST VIDÉ (activité de test) :
--   commandes, lignes de commande, paiements, factures ;
--   devis et lignes de devis ;
--   messagerie (conversations, messages, vocaux, « en train d'écrire », présence) ;
--   notifications ;
--   inscriptions aux formations, présences, attestations ;
--   fichiers joints aux devis, commandes, messages et inscriptions (lignes en base) ;
--   journaux de test (activité, e-mails envoyés, limites anti-abus, liens de connexion en attente) ;
--   numérotation : la prochaine commande sera CMD-2026-00001, le prochain devis DV-2026-00001.
--
-- CE QUI EST GARDÉ (votre site et votre équipe) :
--   tous les comptes (équipe et clients — voir l'OPTION en bas pour retirer des comptes de test),
--   rôles, droits, Google Authenticator, appareils de confiance, connexions en cours ;
--   textes du site, bannières et photos, réalisations, prestations, formations et sessions
--   au programme, témoignages, annonces, réglages ; photos de profil ;
--   anciennes commandes importées de l'ancien site (legacy_orders) ; clés de notification.
--
-- APRÈS : effacer chez Cloudinary les fichiers de test devenus sans propriétaire
--   (depuis le poste d'E-MAN PROD, dans le dossier du projet) :
--     npm run files:check -- --orphans                 (liste, ne supprime rien)
--     npm run files:check -- --clean-orphans --yes     (efface les orphelins de plus de 24 h)
-- =====================================================================================

do $$
declare
  n bigint;
  report text := '';
begin
  if not exists (select 1 from schema_migrations where version = '013') then
    raise exception 'Base pas à jour (v4.1 attendue : migration 013). Lancez d''abord db/mise-a-jour-v4.1.sql. Rien n''a été modifié.';
  end if;

  -- 1. Fichiers joints à l'activité de test (les photos du site, réalisations, profils et supports
  --    de formation sont gardés).
  delete from uploaded_files
   where purpose in ('quote', 'order', 'message', 'enrollment')
      or quote_id is not null or order_id is not null or message_id is not null or enrollment_id is not null;
  get diagnostics n = row_count; report := report || format(E'\n  fichiers joints (devis, commandes, messages, inscriptions) : %s', n);

  -- 2. Paiements et factures (liés aux commandes)
  delete from payments;  get diagnostics n = row_count; report := report || format(E'\n  paiements : %s', n);
  delete from invoices;  get diagnostics n = row_count; report := report || format(E'\n  factures : %s', n);

  -- 3. Messagerie
  delete from messages;  get diagnostics n = row_count; report := report || format(E'\n  messages : %s', n);
  delete from typing;
  delete from presence;

  -- 4. Commandes (les lignes de commande partent avec elles)
  delete from order_items;
  delete from orders;    get diagnostics n = row_count; report := report || format(E'\n  commandes : %s', n);

  -- 5. Devis (les lignes de devis partent avec eux)
  delete from quote_items;
  delete from quotes;    get diagnostics n = row_count; report := report || format(E'\n  devis : %s', n);

  -- 6. Formations : inscriptions de test (les formations et sessions au programme sont gardées)
  delete from certificates;
  delete from attendance;
  delete from enrollments; get diagnostics n = row_count; report := report || format(E'\n  inscriptions aux formations : %s', n);

  -- 7. Notifications et journaux de test
  delete from notifications;       get diagnostics n = row_count; report := report || format(E'\n  notifications : %s', n);
  delete from activity_logs;       get diagnostics n = row_count; report := report || format(E'\n  journal d''activité : %s', n);
  delete from email_log;           get diagnostics n = row_count; report := report || format(E'\n  journal des e-mails : %s', n);
  delete from rate_events;
  delete from verification_tokens; -- liens de vérification / réinitialisation non utilisés
  delete from oauth_states;
  delete from mfa_challenges;      -- étapes de connexion en cours (pas les codes Authenticator)

  -- 8. Numérotation : CMD-2026-00001, DV-2026-00001, REC-2026-00001… repartent de 1
  delete from counters;  get diagnostics n = row_count; report := report || format(E'\n  compteurs de numérotation remis à zéro : %s', n);

  raise notice E'Remise à zéro terminée.%\n\nGardés : % comptes, % prestations, % réalisations, % formations, % photos du site.',
    report,
    (select count(*) from users), (select count(*) from services), (select count(*) from portfolio_items),
    (select count(*) from trainings), (select count(*) from site_media);
end $$;

-- =====================================================================================
-- OPTION — retirer des COMPTES DE TEST (clients créés pour essayer le site)
-- =====================================================================================
-- 1) Voir la liste des comptes clients (lancer seul) :
--      select email, name, created_at from users where role = 'client' order by created_at;
--
-- 2) Mettre les adresses à supprimer dans la liste ci-dessous, enlever les « -- » devant
--    les 12 lignes du bloc, puis lancer le bloc seul. Les comptes de l'équipe (admin)
--    sont protégés : le bloc les refuse même s'ils sont dans la liste.
--
-- do $$
-- declare
--   test_emails text[] := array['client.test@example.com', 'autre.test@example.com'];
--   n bigint;
-- begin
--   if exists (select 1 from users where lower(email) = any (select lower(e) from unnest(test_emails) e) and role <> 'client') then
--     raise exception 'La liste contient un compte de l''équipe : rien n''a été supprimé.';
--   end if;
--   delete from users where role = 'client' and lower(email) = any (select lower(e) from unnest(test_emails) e);
--   get diagnostics n = row_count;
--   raise notice 'Comptes de test supprimés : %', n;
-- end $$;
