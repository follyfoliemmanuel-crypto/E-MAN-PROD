# v4.2.0 — Corrections de l'audit avant production

Référence : rapport « Audit avant production — E-MAN PROD v4.1.3 » (28 points). Chaque ligne
indique ce qui a été fait, ou pourquoi le point n'est pas traité dans le code.

## Points corrigés dans le code

| N° | Point | Correction | Fichiers |
|----|-------|-----------|----------|
| 1 | E-mails : domaine non vérifié | Le code ne peut pas vérifier un domaine. Ajout d'une vérification visible : l'admin voit si l'expéditeur est `resend.dev`, une adresse Gmail, absent, ou si les envois échouent (Paramètres du site → Mise en production) | `api/manage.js` (`production.checks`), `src/pages/space/settings.jsx` |
| 3 | Pas de CGV | Page `/conditions-generales` : devis, commande, bon à tirer, paiement (aucun encaissement en ligne), délais, fichiers, réclamations, annulation, formations, droit togolais. Liens en pied de page, dans la politique et à l'inscription ; ajoutée au sitemap et prérendue | `src/pages/public.jsx`, `src/App.jsx`, `src/routes-meta.js`, `api/catalog.js`, `src/components/Layout.jsx` |
| 4 | Mentions légales vides | Signalées en orange dans Mise en production (liste des champs manquants) tant qu'elles ne sont pas saisies | `api/manage.js` |
| 5 | Pas d'effacement | Bouton « Anonymiser (droit à l'effacement) » sur la fiche client (administrateur, Google Authenticator récent, confirmation). Une seule requête, tout ou rien : identité, téléphone, e-mail, photo, profil, connexions Google, sessions, appareils, notifications, abonnements push et avis effacés ; devis, commandes, inscriptions sans facture ou attestation gardés sans identité ; factures, paiements, attestations gardés tels quels ; action journalisée. Script pour les journaux : `db/effacement-journaux-client.sql` | `api/_lib/services/clients.js`, `api/account.js`, `src/pages/space/team.jsx`, `src/lib/api.js` |
| 6 | Sous-traitants incomplets | Politique : Cloudinary, Google (connexion), services de notification des navigateurs ajoutés | `src/pages/public.jsx` |
| 7 | « Un seul cookie » | Les 4 cookies techniques décrits avec leur durée, le stockage local, le lien « Gérer les cookies » | `src/pages/public.jsx` |
| — | Bandeau cookies (demande) | Bandeau à la première visite : « Tout accepter », « Nécessaires uniquement », « Personnaliser ». Choix réel : l'« affichage rapide » (photos et catalogue gardés sur l'appareil) ; refusé, les copies sont effacées et plus jamais écrites. Rouvrable par « Gérer les cookies » en pied de page. Ne bloque pas la page, tient sur un écran de 360 px | `src/components/CookieBanner.jsx`, `src/lib/consent.js`, `src/lib/media.jsx`, `src/lib/catalog.jsx`, `src/style.css` |
| 8 | Consentement non vérifié | Devis et inscription sans compte : refusés si la case n'est pas cochée (400). Date du consentement enregistrée (`consent_at`). Client connecté : accepté à l'inscription | `api/quotes.js`, `api/trainings.js`, services, migration 014 |
| 9 | Migrations sans sauvegarde | Avant toute migration lancée par Vercel : copie de toutes les tables dans le schéma `avant_migration_<version>` (2 dernières gardées). Si la copie échoue, aucune migration n'est lancée | `scripts/lib/migrate.mjs`, `scripts/db.mjs`, `scripts/vercel-build.mjs` |
| 10 | Compte limité non confirmé | Le script existait ; Mise en production indique maintenant si le site tourne avec le compte propriétaire ou `eman_app`. Testé : `db/securite-base.sql` appliqué tel quel puis suites rejouées avec `eman_app` | `api/manage.js` |
| 11 | Page blanche en cas de bug | Barrière d'erreur : écran « Recharger la page / Retour à l'accueil » | `src/components/ErrorBoundary.jsx`, `src/main.jsx` |
| 12 | Pas d'alerte de panne | Adresse de surveillance `/api/catalog?health=1` (200 si site et base répondent, 503 sinon, aucune donnée) à brancher sur UptimeRobot ; sauvegarde planifiée : procédure dans `A-FAIRE-MANUELLEMENT.md` | `api/catalog.js` |
| 13 | CLS 0,44 sur `/espace` | Même hauteur minimale dans tous les états de l'espace (chargement, non connecté) | `src/App.jsx`, `src/pages/Dashboard.jsx`, `src/style.css` |
| 14 | `SITE_URL` vers un domaine mort | Mise en production compare `SITE_URL` à l'adresse consultée ; `.env.example` dit de laisser vide tant que le domaine ne répond pas | `api/manage.js`, `.env.example` |
| 15 | 3 ans non appliqués | Tâche de nuit : demandes sans compte et sans suite de plus de 3 ans **anonymisées** (rien n'est supprimé ; jamais une demande liée à une commande, une facture, un compte ou une attestation) | `api/_lib/services/retention.js`, `api/files.js` |
| 16 | `MFA_REQUIRED`, `CRON_SECRET` | Affichés dans Mise en production (présence seulement, jamais la valeur) | `api/manage.js` |
| 17 | Pas d'anti-robot | Champ piège invisible sur devis et inscription : un robot qui le remplit reçoit un faux succès, rien n'est enregistré | `src/components/forms.jsx`, `api/quotes.js`, `api/trainings.js` |
| 21 | Page introuvable en 200 | Vrai code 404 : seules les routes connues vont vers l'application, le reste vers `404.html` (prérendu, noindex). Les nouvelles formations et prestations créées après le déploiement restent accessibles | `vercel.json`, `scripts/prerender-meta.mjs` |
| 23 | Focus perdu | À la fermeture d'une fenêtre, le focus revient sur le bouton qui l'a ouverte | `src/components/Modal.jsx` |
| 24 | Icône 254 Ko | `icon-512.png` 254 → 48 Ko, `icon-maskable-512.png` 164 → 32 Ko (256 couleurs, différence invisible, comparées à l'œil) | `public/` |
| 25 | Index manquants | 5 index et une clé primaire sur `rate_events` (migration 014, additive) | `db/migrations/014_rgpd_consent_indexes.sql` |
| 27 | Inscription sans lien | Ligne « En créant un compte, vous acceptez nos conditions générales et notre politique de confidentialité » | `src/components/forms.jsx` |
| 28 | Search Console | Variable `GOOGLE_SITE_VERIFICATION` : balise ajoutée à toutes les pages au build | `scripts/prerender-meta.mjs` |

## Points qui ne se règlent pas dans le code (voir `A-FAIRE-MANUELLEMENT.md`)

| N° | Point | Pourquoi |
|----|-------|----------|
| 1 | Domaine d'envoi | Se vérifie chez Resend et dans les DNS du domaine |
| 2 | Bannières 2 et 3 | Les fichiers ont été effacés en v4.1.1 : il faut renvoyer les photos depuis l'admin |
| 3 | Texte des CGV | Le texte publié est une base ; il doit être relu par un juriste |
| 4 | RCCM, NIF… | Informations de l'entreprise, à saisir dans l'admin |

## Points volontairement non appliqués (risque de casser l'existant)

| N° | Point | Raison |
|----|-------|--------|
| 18 | Antivirus | Aucun service d'analyse disponible sans abonnement externe. Consigne : n'ouvrir les ZIP, PSD ou documents Office d'un client inconnu qu'après analyse par l'antivirus du poste |
| 19 | RLS | Activer la RLS sans réécrire chaque requête avec des politiques bloquerait tout le site avec le compte limité. La séparation propriétaire / `eman_app` (point 10) apporte déjà une seconde barrière |
| 20 | CSP plus stricte | `img-src https:` est nécessaire : l'admin peut afficher une image par son adresse web. `style-src-attr` sert au cadrage des photos, au carrousel et aux animations (13 usages). Les resserrer casserait ces fonctions |
| 22 | Texte des pages sans JavaScript | Demande un rendu serveur complet de l'application : refonte trop risquée avant l'ouverture. Google exécute le JavaScript ; titres, descriptions, aperçus et données structurées sont déjà dans le HTML |
| 24 | Polices `.woff2` | Pas d'outil de conversion ni de réseau ici ; gain estimé ~40 Ko. À faire plus tard |
| 26 | pdf-lib | Aucune alternative installable hors ligne ; la bibliothèque fonctionne. À surveiller avec `npm audit` |

## SQL de production (dossier `db/`)

| Fichier | Rôle | Modifie la base ? |
|---------|------|-------------------|
| `securite-1-sauvegarde.sql` | Copie de toutes les tables dans `securite_avant_production` | Ajoute une copie |
| `mise-a-jour-v4.2.sql` | Migration 014 à la main (sinon appliquée par Vercel) | Additive |
| `securite-base.sql` | Compte limité `eman_app`, droits minimaux, journaux en ajout seul | Droits uniquement |
| `reparation-photos.sql` | Rattache les photos du site à leur fichier, liste celles à renvoyer | Liens seulement |
| `reinitialisation-avant-production.sql` | Vide les données de test (une seule fois) | Oui : à lancer après la sauvegarde |
| `effacement-journaux-client.sql` | Journaux d'un client anonymisé | Journaux d'un seul client |
| `production-verification.sql` | Tableau OK / À FAIRE | Non (lecture seule) |
| `securite-2-restauration.sql` / `securite-3-suppression-sauvegarde.sql` | Restaurer / retirer la copie de l'étape 1 | Oui |
