# Mise en production

Plateforme cible, adaptée au code réel : **Vercel** (site React/Vite + fonctions Node dans `/api`) et **Neon** (PostgreSQL). Fichiers sur un stockage S3 compatible (Cloudflare R2 conseillé), e-mails par Resend ou Brevo. Toutes les variables sont décrites dans [CONFIGURATION.md](CONFIGURATION.md).

## 0. Avant de commencer

- **Offre Vercel** : l'offre gratuite *Hobby* est réservée à un usage personnel et non commercial. Le site d'E-MAN PROD étant celui d'une entreprise, il relève de l'offre **Pro** (voir https://vercel.com/docs/plans/hobby).
- Vérifier de même les conditions de l'offre Neon choisie (stockage, durée de l'historique pour les restaurations).
- Prévoir : le nom de domaine, un compte Google (connexion Google), un compte Resend, un compte Cloudflare (R2 et éventuellement DNS).
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

## 3. Projet Vercel

1. Vercel → *Add New* → *Project* → importer le dépôt GitHub.
2. Réglages (détectés automatiquement) : framework **Vite**, commande `npm run build`, dossier `dist`.
3. *Settings* → *General* → **Node.js Version : 24.x** (nécessaire pour Argon2id).
4. *Settings* → *Environment Variables* (environnement *Production*), au minimum :
   `DATABASE_URL`, `SITE_URL`, `VITE_SITE_URL`, `AUTH_SECRET`, `VITE_WHATSAPP_NUMBER`,
   puis selon les services : `GOOGLE_*`, `MAIL_*`, `S3_*` (voir CONFIGURATION.md).
5. *Deploy*. `vercel.json` gère déjà : adresses des pages, plan du site `/sitemap.xml`, en-têtes de sécurité (CSP, HSTS…), cache des fichiers.

Le build exécute `vite build` puis `scripts/prerender-meta.mjs`, qui écrit une page HTML par adresse (titre, description, données structurées) et `robots.txt` pour le domaine de `VITE_SITE_URL`/`SITE_URL`.

## 4. Nom de domaine et HTTPS

1. Vercel → *Settings* → *Domains* → ajouter `www.emanprod.com` et `emanprod.com` (redirection de l'un vers l'autre, Vercel le propose).
2. Chez le registraire du domaine, créer les enregistrements DNS indiqués par Vercel.
3. Le certificat **HTTPS** est créé et renouvelé automatiquement par Vercel. HSTS (dans `vercel.json`) impose ensuite HTTPS aux navigateurs.
4. Si le domaine réel n'est pas `www.emanprod.com`, mettre la bonne adresse dans `SITE_URL` et `VITE_SITE_URL`, et dans la console Google (origines et redirection), puis redéployer.

## 5. Premier administrateur

1. Sur le site en ligne : Espace client → *Créer un compte*.
2. Depuis votre PC (chaîne de `main` dans `.env`) : `npm run db:admin -- votre@email.com`.
3. Se déconnecter et se reconnecter : l'espace de gestion complet apparaît.
4. Inviter les collaborateurs : Espace → Équipe → Inviter (voir [ROLES.md](ROLES.md)).

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
