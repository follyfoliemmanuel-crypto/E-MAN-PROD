# Configuration

Toute la configuration technique passe par des **variables d'environnement** :
- en local, dans le fichier `.env` (copie de `.env.example`) ;
- en ligne, dans Vercel → *Settings* → *Environment Variables*.

Les informations de l'entreprise (coordonnées, WhatsApp, mentions légales, conditions des devis…) se règlent ensuite **dans le site**, Espace → Paramètres (compte administrateur).

**Règle de sécurité** : seules les variables qui commencent par `VITE_` sont visibles du navigateur ; aucune ne doit contenir de secret. Toutes les autres restent sur le serveur. Ne jamais versionner `.env` (il est exclu par `.gitignore`).

## 1. Référence des variables

| Variable | Obligatoire | Rôle | Exemple |
|---|---|---|---|
| `DATABASE_URL` | **oui** | Base PostgreSQL (Neon en ligne) | `postgresql://…neon.tech/neondb?sslmode=require` |
| `SITE_URL` | **oui** en ligne | Adresse publique : liens des e-mails, retour Google, sitemap | `https://www.emanprod.com` |
| `VITE_SITE_URL` | **oui** en ligne | Même adresse, lue au build : URL canoniques, aperçus de liens | `https://www.emanprod.com` |
| `AUTH_SECRET` | conseillé | Chaîne aléatoire (32+ caractères) pour anonymiser les adresses IP du journal | `openssl rand -hex 32` |
| `VITE_WHATSAPP_NUMBER` | conseillé | Numéro WhatsApp principal par défaut (sans +) | `22891388405` |
| `VITE_CONTACT_EMAIL` | non | E-mail de contact par défaut | `emanprod3@gmail.com` |
| `GOOGLE_CLIENT_ID` | pour Google | Identifiant OAuth (section 3) | `…apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | pour Google | Secret OAuth | `GOCSPX-…` |
| `GOOGLE_REDIRECT_URI` | non | Adresse de retour exacte, si différente de `SITE_URL/api/auth/google-callback` | |
| `MAIL_PROVIDER` | pour les e-mails | `resend` ou `brevo` (section 4) | `resend` |
| `MAIL_API_KEY` | pour les e-mails | Clé d'API du fournisseur | `re_…` |
| `MAIL_FROM` | pour les e-mails | Expéditeur, sur un domaine vérifié | `E-MAN PROD <notifications@emanprod.com>` |
| `MAIL_REPLY_TO` | non | Adresse de réponse (par défaut emanprod3@gmail.com) | `emanprod3@gmail.com` |
| `NOTIFY_TO` | non | Destinataire des alertes de l'équipe (sinon : Paramètres → Notifications) | |
| `S3_ENDPOINT` | pour les fichiers | Point d'accès du stockage (section 5) | `https://<compte>.r2.cloudflarestorage.com` |
| `S3_REGION` | pour les fichiers | Région (`auto` pour R2) | `auto` |
| `S3_BUCKET` | pour les fichiers | Nom du seau privé | `emanprod-fichiers` |
| `S3_ACCESS_KEY_ID` | pour les fichiers | Clé d'accès | |
| `S3_SECRET_ACCESS_KEY` | pour les fichiers | Clé secrète | |
| `S3_PUBLIC_URL` | non | Domaine public du seau, pour servir les photos publiques en cache CDN | `https://fichiers.emanprod.com` |

Anciennes variables encore acceptées : `RESEND_API_KEY`, `BREVO_API_KEY`. Variables réservées aux tests (ne pas définir en ligne) : `MAIL_TEST_ENDPOINT`, `STORAGE_DRIVER`, `LOCAL_UPLOAD_DIR`, `FILES_SECRET`.

Après toute modification dans Vercel : **redéployer** (Deployments → … → *Redeploy*). Les variables `VITE_*` sont intégrées au moment du build.

## 2. Base de données (Neon)

1. https://neon.tech → créer un projet « E-MAN PROD », région la plus proche des utilisateurs (Europe, par exemple Francfort).
2. Branche `main` = base en ligne. Créer aussi une branche `dev` pour les essais.
3. *Connect* → copier la chaîne `postgresql://…?sslmode=require` de la branche voulue dans `DATABASE_URL`.
4. Créer le schéma et le contenu de départ depuis votre PC (avec la chaîne de `main` dans `.env`) :
   ```bash
   npm run db:check      # connexion
   npm run db:migrate    # sauvegarde éventuelle, migrations 001 → 006, contenu de départ
   npm run db:status     # doit afficher « Base à jour »
   ```
5. Les migrations sont dans `db/migrations/`, appliquées dans l'ordre, chacune dans une transaction. Une migration appliquée ne doit jamais être modifiée : toute évolution passe par un nouveau fichier `007_….sql`.

## 3. Connexion Google

Aucun identifiant n'est fourni : ils doivent être créés par E-MAN PROD, avec son compte Google.

1. https://console.cloud.google.com → créer un projet « E-MAN PROD ».
2. *API et services* → *Écran de consentement OAuth* :
   - type « Externe », nom « E-MAN PROD », e-mail d'assistance (ajouter un logo peut déclencher une vérification de la marque par Google : on peut publier sans logo puis l'ajouter) ;
   - domaine autorisé : `emanprod.com` (le domaine réel) ;
   - liens : `https://www.emanprod.com/confidentialite` et `/mentions-legales` ;
   - champs : `openid`, `email`, `profile` (aucune validation Google nécessaire pour ces trois-là) ;
   - publier l'application (« En production »).
3. *Identifiants* → *Créer des identifiants* → *ID client OAuth* → « Application Web » :
   - origines JavaScript : `https://www.emanprod.com` (et `http://localhost:5173` pour les essais) ;
   - URI de redirection : `https://www.emanprod.com/api/auth/google-callback` (et `http://localhost:5173/api/auth/google-callback`).
4. Copier l'ID et le secret dans `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`, vérifier `SITE_URL`, redéployer.
5. Le bouton « Continuer avec Google » n'apparaît que si les deux variables sont présentes.

Fonctionnement : OpenID Connect avec PKCE, `state` et `nonce` à usage unique (10 minutes) ; signature du jeton vérifiée avec les clés publiques de Google. Un compte existant avec la même adresse est relié ; si cette adresse n'avait jamais été confirmée, son mot de passe est retiré et ses sessions fermées (protection contre un compte créé avec l'adresse d'autrui).

## 4. E-mails transactionnels

Sans fournisseur, le site fonctionne : les notifications restent dans les espaces, aucun e-mail ne part, et le journal (Paramètres → E-mails) l'indique honnêtement. Un e-mail n'est noté « accepté » que si le fournisseur a répondu avec un identifiant de message.

**Resend (recommandé)**
1. Compte sur https://resend.com.
2. *Domains* → ajouter le domaine de l'entreprise (ou un sous-domaine, par exemple `notifications.emanprod.com`) et copier chez l'hébergeur du domaine les enregistrements DNS indiqués (DKIM, SPF). Attendre « Verified ».
3. *API Keys* → créer une clé « Sending access ».
4. Variables : `MAIL_PROVIDER=resend`, `MAIL_API_KEY`, `MAIL_FROM=E-MAN PROD <notifications@emanprod.com>`, `MAIL_REPLY_TO=emanprod3@gmail.com`. Redéployer.
5. Paramètres → E-mails : « Envoi d'e-mails configuré » doit s'afficher ; cliquer « M'envoyer un essai ».

**Brevo** : `MAIL_PROVIDER=brevo` et la clé d'API v3 ; le domaine doit y être authentifié de la même façon.

**Pourquoi emanprod3@gmail.com n'est pas l'expéditeur** : Resend n'envoie que depuis un domaine vérifié, et Brevo remplace les adresses gratuites (gmail.com) par une adresse technique. L'adresse Gmail sert donc d'adresse de réponse, de contact dans les e-mails et les PDF, et de destinataire par défaut des alertes.

## 5. Stockage des fichiers (S3 compatible)

Sert aux pièces jointes des devis et commandes, aux photos des réalisations et du site, aux photos de profil, aux documents de formation. Le seau reste **privé** : chaque téléchargement passe par `/api/files`, qui vérifie les droits puis redirige vers un lien valable 5 minutes.

**Cloudflare R2 (recommandé)**
1. R2 → *Create bucket* → `emanprod-fichiers` (privé).
2. *Manage API tokens* → jeton « Object Read & Write » limité à ce seau.
3. Variables : `S3_ENDPOINT=https://<id-compte>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
4. Réglages CORS du seau : autoriser `PUT` et `GET` depuis `https://www.emanprod.com`, en-tête `Content-Type`.
5. Facultatif : un domaine public (par exemple `fichiers.emanprod.com`) pour le dossier `public/` du seau, puis `S3_PUBLIC_URL` : les photos publiques sont alors servies en cache par le CDN.

AWS S3, Backblaze B2 et Wasabi fonctionnent de la même façon. La politique de sécurité (CSP) autorise déjà les envois vers `*.r2.cloudflarestorage.com`, `*.amazonaws.com` et `*.backblazeb2.com` ; pour un autre fournisseur, ajoutez son domaine à `connect-src` dans `vercel.json`.

Sans ces variables : en local, les fichiers vont dans `.uploads/` ; en ligne, l'envoi de fichiers est désactivé et le site propose WhatsApp.

## 6. Réglages dans le site (Espace → Paramètres, admin)

| Rubrique | Contenu |
|---|---|
| Coordonnées | Téléphone, e-mail, slogan, sites (siège, annexe), horaires |
| WhatsApp | Un numéro et un message par usage : contact, renseignements, devis, assistance, formation |
| Réseaux sociaux | Facebook, Instagram, TikTok, LinkedIn, YouTube, X (adresses https vérifiées) |
| Informations légales | Raison sociale, forme, capital, RCCM, NIF, siège, directeur de la publication, hébergeur |
| Devis et factures | Validité des devis (jours), conditions des devis et des factures, moyens de paiement, mention de signature |
| E-mails | État du fournisseur, modèles (objet et introduction), aperçu, essai, journal |
| Notifications | E-mails envoyés aux clients, alertes de l'équipe et leur destinataire |

Rien n'est inventé : un champ vide n'est ni affiché sur le site ni imprimé sur les PDF.
