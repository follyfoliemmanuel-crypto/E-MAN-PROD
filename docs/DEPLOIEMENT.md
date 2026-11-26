# Mise en production

Plateforme cible, adaptée au code réel : **Vercel** (site React/Vite + fonctions Node dans `/api`) et **Neon** (PostgreSQL). Fichiers sur **Cloudinary** (fournisseur unique, métadonnées dans Neon), e-mails par Resend ou Brevo. Toutes les variables sont décrites dans [CONFIGURATION.md](CONFIGURATION.md).

## 0. Avant de commencer

- **Offre Vercel** : l'offre gratuite *Hobby* est réservée à un usage personnel et non commercial. Le site d'E-MAN PROD étant celui d'une entreprise, il relève de l'offre **Pro** (voir https://vercel.com/docs/plans/hobby).
- Vérifier de même les conditions de l'offre Neon choisie (stockage, durée de l'historique pour les restaurations).
- Prévoir : le nom de domaine, un compte Google (connexion Google), un compte Resend, un compte Cloudinary (vérifier sur son offre la taille maximale des fichiers et les crédits mensuels).
- Faire une copie de secours de la base en ligne si elle existe déjà (voir [SAUVEGARDE.md](SAUVEGARDE.md)).

## 1. Code source sur GitHub

```bash
git status                 # vérifier qu'aucun fichier sensible n'apparaît (.env, backups/)
git push origin main       # dépôt privé recommandé
```
`.gitignore` exclut `.env*` (sauf les modèles), `backups/`, `.uploads/`, `node_modules/` et `dist/`.

## 2. Base de données de production

1. Neon → projet « E-MAN PROD » → branche `main`.
2. Sur votre PC, mettre la chaîne de `main` dans `.env`, puis :
   ```bash
   npm install
   npm run db:migrate     # crée ou met à jour le schéma (001 → 006) et le contenu de départ
   npm run db:status      # « Base à jour »
   ```
3. Remettre ensuite dans `.env` la chaîne de la branche `dev` pour vos essais, afin de ne jamais tester sur la base en ligne.

**Sans installer Node : dans le navigateur.** Neon → projet → **SQL Editor** → branche `main` → coller tout le fichier [`db/install-neon.sql`](../db/install-neon.sql) → **Run**. Ce fichier contient les mêmes migrations et le même contenu de départ que `npm run db:migrate`, et les inscrit dans le même registre (`schema_migrations`). Les deux méthodes peuvent donc être utilisées l'une après l'autre.
- Le fichier peut être relancé : ce qui est déjà en place est sauté, rien n'est supprimé ni écrasé.
- Tout passe dans une seule transaction : en cas d'erreur, la base reste telle quelle.
- La dernière requête affiche les migrations 001 à 007.
- Pour mettre à jour une base qui contient déjà des données, créer d'abord une branche Neon de secours.
- Après chaque nouvelle migration, régénérer le fichier avec `npm run db:sql`.

**Premier administrateur :** Le compte **emanprod3@gmail.com** devient administrateur **automatiquement** (réglable par `ADMIN_EMAILS`), dès que l'adresse est prouvée :
- connexion avec **Google** : immédiat ;
- inscription par e-mail : au clic sur le lien de confirmation reçu (nécessite le fournisseur d'e-mails, Resend).

Quelqu'un qui s'inscrirait avec cette adresse sans en avoir la boîte reste un simple client non confirmé ; et si le vrai propriétaire se connecte ensuite avec Google, le mot de passe posé par l'intrus est effacé. Aucun SQL n'est nécessaire. Les autres membres de l'équipe sont invités depuis Espace → Équipe (`npm run db:admin -- email` reste disponible).

## 3. Projet Vercel

1. Vercel → *Add New* → *Project* → importer le dépôt GitHub.
2. Réglages (détectés automatiquement) : framework **Vite**, commande `npm run build`, dossier `dist`.
3. *Settings* → *General* → **Node.js Version : 24.x** (nécessaire pour Argon2id).
4. *Settings* → *Environment Variables* (environnement *Production*), au minimum :
   `DATABASE_URL`, `SITE_URL`, `VITE_SITE_URL`, `AUTH_SECRET`, `VITE_WHATSAPP_NUMBER`,
   puis selon les services : `GOOGLE_*`, `MAIL_*`, `CLOUDINARY_*` (voir CONFIGURATION.md). **À chaque déploiement de production, la base est mise à jour automatiquement** (`npm run vercel-build` : migrations en attente + contenu de départ, sans rien effacer ; en cas d'erreur, le déploiement échoue et la version précédente reste en ligne ; les déploiements de prévisualisation ne touchent jamais la base). Le fichier `db/install-neon.sql` reste disponible pour une installation à la main. Ensuite, sur votre poste : `npm run storage:check` (vrai test d'envoi, lecture et suppression chez Cloudinary).
5. *Deploy*. `vercel.json` gère déjà : adresses des pages, plan du site `/sitemap.xml`, en-têtes de sécurité (CSP, HSTS…), cache des fichiers.

Le build exécute `vite build` puis `scripts/prerender-meta.mjs`, qui écrit une page HTML par adresse (titre, description, données structurées) et `robots.txt` pour le domaine de `VITE_SITE_URL`/`SITE_URL`.

## 4. Nom de domaine et HTTPS

1. Vercel → *Settings* → *Domains* → ajouter `www.emanprod.com` et `emanprod.com` (redirection de l'un vers l'autre, Vercel le propose).
2. Chez le registraire du domaine, créer les enregistrements DNS indiqués par Vercel.
3. Le certificat **HTTPS** est créé et renouvelé automatiquement par Vercel. HSTS (dans `vercel.json`) impose ensuite HTTPS aux navigateurs.
4. Si le domaine réel n'est pas `www.emanprod.com`, mettre la bonne adresse dans `SITE_URL`, et dans la console Google (origines et redirection), puis redéployer.

## 5. Premier administrateur

1. Sur le site en ligne : **Connexion → Se connecter avec Google** avec emanprod3@gmail.com (ou Inscription par e-mail, puis clic sur le lien reçu).
2. L'espace de gestion complet apparaît : le compte est administrateur.
3. Inviter les collaborateurs : Espace → Équipe → Inviter (voir [ROLES.md](ROLES.md)).

Le compte **emanprod3@gmail.com** devient administrateur **automatiquement** (réglable par `ADMIN_EMAILS`), dès que l'adresse est prouvée :
- connexion avec **Google** : immédiat ;
- inscription par e-mail : au clic sur le lien de confirmation reçu (nécessite le fournisseur d'e-mails, Resend).

Quelqu'un qui s'inscrirait avec cette adresse sans en avoir la boîte reste un simple client non confirmé ; et si le vrai propriétaire se connecte ensuite avec Google, le mot de passe posé par l'intrus est effacé. Aucun SQL n'est nécessaire. Les autres membres de l'équipe sont invités depuis Espace → Équipe (`npm run db:admin -- email` reste disponible).

## 6. Réglages de l'entreprise (dans le site)

Espace → Paramètres : coordonnées, numéros WhatsApp officiels, réseaux sociaux, informations légales (RCCM, NIF…), conditions des devis et factures, moyens de paiement, modèles d'e-mails. Puis : Formations (tarifs, durées, sessions, conditions d'attestation), Réalisations (photos), Images et bannières.

## 7. Vérifications après la mise en ligne

| À vérifier | Comment |
|---|---|
| Pages publiques | Ouvrir l'accueil, une prestation, une formation, Contact ; aucun message d'erreur |
| HTTPS | Cadenas dans le navigateur ; `http://` redirige vers `https://` |
| Base | Espace admin → Tableau de bord : les chiffres s'affichent |
| Compte | Créer un compte de test, se déconnecter, se reconnecter |
| E-mails | Paramètres → E-mails → « M'envoyer un essai » : reçu (vérifier les indésirables) |
| Google | « Continuer avec Google » sur la fenêtre de connexion |
| Fichiers | Joindre une image à une demande de devis, puis la télécharger depuis l'admin |
| PDF | Télécharger un devis envoyé, un bon de commande |
| SEO | `https://www.emanprod.com/sitemap.xml` et `/robots.txt` s'affichent ; déclarer le sitemap dans Google Search Console |
| En-têtes | https://securityheaders.com sur l'adresse du site |
| Performances | https://pagespeed.web.dev sur l'accueil (mobile) |

Puis supprimer le compte de test : Espace → Clients → fiche → Désactiver.

## 8. Mises à jour suivantes

1. Branche Neon de secours (`avant-maj-AAAA-MM-JJ`).
2. `npm run db:migrate` avec la chaîne de `main` si de nouvelles migrations existent (une sauvegarde JSON est faite automatiquement).
3. `git push` : Vercel redéploie automatiquement.
4. En cas de problème : Vercel → *Deployments* → *Promote* sur le déploiement précédent (retour instantané du site) et, si la base est en cause, *Restore* de la branche Neon.

## 9. Autres plateformes

Le code suppose des fonctions serverless Node au format Vercel (`api/*.js`, `export default (req, res)`). Netlify ou un serveur Node classique demanderaient un petit adaptateur (le serveur de développement local en est un exemple) ; Vercel reste la cible testée et documentée.

## Passage à la v4.0 (messagerie, Google Authenticator)

1. **Base** : `npm run db:migrate` (migration 012, additive), ou exécuter `db/install-neon.sql` dans Neon.
   Avec le compte limité (`npm run db:app-role`), les nouvelles tables sont accessibles automatiquement.
2. **Déployer** sur Vercel. Aucune variable n'est obligatoire (voir docs/DOUBLE-AUTHENTIFICATION.md
   pour MFA_REQUIRED, MFA_TRUST_DAYS, MFA_ENCRYPTION_KEY).
3. **Première connexion de l'administrateur** : l'espace demande d'activer Google Authenticator.
   Gardez le téléphone à portée de main et rangez les 10 codes de récupération.
4. **À vérifier sur vos propres appareils** (impossible à tester ici) : scanner le QR code avec votre
   téléphone ; recevoir une notification Push sur le téléphone ; enregistrer un message vocal sur
   iPhone (Safari) et sur Android (Chrome).

## Passage à la v4.1 (corrections messagerie, carrousel)

1. Neon → SQL Editor → coller `db/mise-a-jour-v4.1.sql` → Run (migration 013, additive). La base doit
   être en 012 (v4.0) : sinon le fichier s'arrête sans rien modifier.
2. Déployer sur Vercel. Aucune nouvelle variable.
3. Dans « Images et bannières », bouton « Cadrage » sur chaque photo dont le sujet n'est pas centré.

## Passage à la v4.2 (audit avant production)

Suivre `docs/A-FAIRE-MANUELLEMENT.md` dans l'ordre (sauvegarde, e-mails, variables, déploiement,
compte limité, mentions légales, photos, CGV, surveillance, sauvegarde planifiée, Search Console,
vérification finale avec `db/production-verification.sql`). Détail des corrections :
`docs/CORRECTIONS-V4.2.md`. Le déploiement applique la migration 014 après une copie de sécurité
de toutes les tables (schéma `avant_migration_014`). Nouvelles variables facultatives :
`GOOGLE_SITE_VERIFICATION` ; `CRON_SECRET` devient indispensable (durée de conservation).

## Sécurisation de la base (avant l'ouverture)

1. Neon → SQL Editor → `db/securite-base.sql` → Run (compte propriétaire). Copier le mot de passe
   affiché pour « eman_app » (montré une seule fois ; relancer le script en crée un nouveau).
2. Vercel → Environment Variables (Production) :
   `DATABASE_URL_OWNER` = l'ancienne `DATABASE_URL` ; `DATABASE_URL` = même adresse avec
   l'utilisateur `eman_app` et le nouveau mot de passe. Redeploy.
3. Le site ne peut plus créer, modifier, vider ni supprimer de table, ni effacer le journal
   d'activité, ni remplacer la clé Google Authenticator. Testé : 13 tentatives refusées,
   toutes les suites (messagerie, MFA, commandes, envois, temps réel) passent avec ce compte.

Sauvegarde SQL facultative avant la remise à zéro : `db/securite-1-sauvegarde.sql`,
restauration `db/securite-2-restauration.sql`, suppression `db/securite-3-suppression-sauvegarde.sql`.
