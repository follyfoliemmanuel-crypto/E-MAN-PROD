# Configuration

Toute la configuration technique passe par des **variables d'environnement** :
- en local, dans le fichier `.env` (copie de `.env.example`) ;
- en ligne, dans Vercel → *Settings* → *Environment Variables*.

Les informations de l'entreprise (coordonnées, WhatsApp, mentions légales, conditions des devis…) se règlent ensuite **dans le site**, Espace → Paramètres (compte administrateur).

**Règle de sécurité** : seules les variables qui commencent par `VITE_` sont visibles du navigateur ; aucune ne doit contenir de secret. Toutes les autres restent sur le serveur. Ne jamais versionner `.env` (il est exclu par `.gitignore`).

## 0. Vérifier la configuration en une commande

- **En ligne** : ouvrez `https://<votre-site>/api/auth/status`. La page dit ce que le serveur Vercel voit vraiment (base, e-mails, Google, fichiers) et liste ce qui manque. Aucune valeur secrète n'y figure.
- **Sur votre PC** : `npm run check`. Lit votre `.env`, teste réellement Neon, Resend, Google et Cloudinary, puis interroge le site en ligne et compare.

**Le fichier `.env` n'est pas envoyé à Vercel.** En ligne, les variables se saisissent dans Vercel → *Settings → Environment Variables* (cochées pour *Production*, sans guillemets), puis **Redeploy**. Si le site « répond comme si rien n'était configuré », c'est presque toujours l'un de ces trois points ; `/api/auth/status` le montre.

## 1. Référence des variables

| Variable | Obligatoire | Rôle | Exemple |
|---|---|---|---|
| `DATABASE_URL` | **oui** | Base PostgreSQL (Neon en ligne) | `postgresql://…neon.tech/neondb?sslmode=require` |
| `SITE_URL` | **oui** en ligne | Adresse publique : liens des e-mails, retour Google, sitemap | `https://www.emanprod.com` |
| `VITE_SITE_URL` | non | Ancien nom, encore accepté : `SITE_URL` suffit désormais (lue au build et par le serveur ; à défaut, l'adresse de production Vercel) | |
| `ADMIN_EMAILS` | non | Adresse(s) administrateur, appliquées une fois l'adresse prouvée (défaut : emanprod3@gmail.com) | `emanprod3@gmail.com` |
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
| `CLOUDINARY_CLOUD_NAME` | pour les fichiers | Nom du compte Cloudinary (section 5) | `emanprod` |
| `CLOUDINARY_API_KEY` | pour les fichiers | Clé d'API (publique, envoyée au navigateur avec chaque signature) | `123456789012345` |
| `CLOUDINARY_API_SECRET` | pour les fichiers | **Secret** : uniquement dans Vercel, jamais dans le code ni préfixé `VITE_` | |
| `CLOUDINARY_MAX_FILE_MB` | non | Taille maximale par fichier de votre offre (gratuite : 10) | `10` |
| `CLOUDINARY_FOLDER` | non | Dossier de l'application dans Cloudinary | `emanprod` |
| `BACKUP_DIR` | non | Dossier de sauvegarde sur le poste qui lance `npm run backup` (jamais sur Vercel) | `E:\Sauvegardes\emanprod` |
| `S3_*` | non | **Ancien stockage (v3.0)** : à garder uniquement tant que des fichiers y sont encore (lecture et suppression seulement, section 5) | |

Anciennes variables encore acceptées : `RESEND_API_KEY`, `BREVO_API_KEY`. Variables réservées aux tests (ne pas définir en ligne ; ignorées sur Vercel pour les adresses de test) : `MAIL_TEST_ENDPOINT`, `CLOUDINARY_TEST_API_BASE`, `CLOUDINARY_TEST_DELIVERY_BASE`, `STORAGE_DRIVER`, `LOCAL_UPLOAD_DIR`, `FILES_SECRET`.

**Pourquoi une variable ajoutée dans Vercel « ne s'applique pas »** : Vercel fige les variables dans chaque déploiement. Une variable ajoutée ou modifiée ne vaut que pour le **déploiement suivant**, jamais pour celui qui est en ligne. C'est une règle de Vercel, aucun code ne peut la contourner. Après chaque ajout ou modification : *Deployments* → dernier déploiement → *…* → **Redeploy** (environ une minute). Vérifiez aussi que la variable est cochée pour l'environnement **Production**. En local, arrêtez puis relancez `npm run dev` après avoir modifié `.env`.

Ce qui s'applique **sans redéploiement** : tout ce qui se règle dans l'espace administrateur (numéros WhatsApp, coordonnées, textes, prix, photos du site, réalisations, modèles d'e-mails, conditions des devis) est visible au chargement suivant de la page, sans cache intermédiaire.

Ce qui se fait **tout seul au redéploiement** : les migrations de la base et le contenu de départ (voir DEPLOIEMENT.md) ; aucun SQL à lancer à la main.

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
5. Les boutons « Se connecter avec Google » et « S'inscrire avec Google » sont toujours affichés dans les fenêtres de connexion et d'inscription. Tant que les deux variables manquent, ils sont grisés avec la mention « bientôt disponible ». **Espace → Paramètres → Connexion Google** indique l'état, et donne les deux adresses à copier dans Google Cloud.

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

## 5. Stockage des fichiers (Cloudinary, fournisseur unique)

Cloudinary stocke tous les fichiers ; Neon garde leurs métadonnées (propriétaire, droits, type, taille, référence Cloudinary, statut, dates). Le navigateur envoie chaque fichier **directement** à Cloudinary avec une autorisation signée par le serveur : les fichiers ne passent jamais par Vercel et la clé secrète ne quitte jamais le serveur.

| Fichier | Ressource Cloudinary | Livraison | Accès |
|---|---|---|---|
| Photos des réalisations | `image` | `upload` (publique) | CDN, format et compression automatiques, largeur adaptée |
| Photos de profil | `image` | `authenticated` (privée) | adresse signée recadrée, donnée après contrôle des droits |
| Images jointes (devis, commandes, messages…) | `image` | `authenticated` | lien de téléchargement signé, **5 minutes** |
| PDF, AI, EPS, PSD, CDR, ZIP, Word, Excel, PowerPoint | `raw` | `authenticated` | lien de téléchargement signé, 5 minutes, toujours en pièce jointe |

Les originaux ne sont jamais transformés : les variantes (miniatures, WebP/AVIF) sont calculées à l'affichage.

**Mise en place**
1. Créez un compte sur cloudinary.com (offre gratuite pour démarrer).
2. *Settings → API Keys* : notez le *Cloud name*, l'*API Key* et l'*API Secret*.
3. Vercel → *Settings → Environment Variables* : `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (et `CLOUDINARY_MAX_FILE_MB` si votre offre dépasse 10 Mo), puis **redéployez**.
4. *Settings → Security* :
   - cochez **« Allow delivery of PDF and ZIP files »** (bloqué par défaut sur les comptes gratuits ; sans ce réglage, les PDF et ZIP ne peuvent pas être téléchargés). Cloudinary vous demande d'accepter ses conditions pour ces fichiers ;
   - activez **« Strict transformations »** : le site signe toutes ses adresses, ce réglage empêche des tiers de fabriquer des variantes qui consommeraient vos crédits ;
   - laissez désactivés les envois non signés (*unsigned upload presets*).
5. Sur votre poste, avec les mêmes trois variables dans `.env` : `npm run storage:check`. Le script fait un vrai envoi, une vraie lecture et une vraie suppression (image publique, image privée, PDF privé, format refusé) dans le dossier `emanprod/verification`. **Tant qu'il n'affiche pas « 0 échec », ne considérez pas le stockage comme opérationnel.**
6. Espace → Paramètres → **Fichiers et sauvegardes** affiche l'état réel.

**Limites de l'offre gratuite** (à vérifier sur votre compte, *Settings → Account*) : 10 Mo par image et par fichier brut, 25 crédits par mois (1 crédit = 1 Go stocké, ou 1 Go de bande passante, ou 1 000 transformations), 500 appels par heure à l'API d'administration (le site en fait un par envoi confirmé). La limite par fichier du site suit `CLOUDINARY_MAX_FILE_MB` (10 par défaut) : les pièces jointes sont limitées à 10 Mo et les formulaires l'affichent ; au-delà, le site oriente vers WhatsApp. Ne l'augmentez qu'après avoir vérifié la limite de votre offre (offre Plus : 20 Mo pour les images ; la limite des fichiers bruts est à confirmer auprès de Cloudinary). Les règles métier plus strictes restent appliquées (réalisations 5 Mo, photos de profil 2 Mo).

**Contrôles de sécurité conservés** : droits vérifiés avant chaque téléchargement (sinon « introuvable »), extension + type MIME + signature réelle du contenu (format décodé par Cloudinary pour les images, 64 premiers octets relus pour les fichiers bruts), taille relue chez Cloudinary, identifiant aléatoire (jamais le nom du fichier), formats dangereux refusés (HTML, SVG, exécutables), suppression chez Cloudinary avant la base (si Cloudinary ne répond pas, la ligne est conservée).

**Anciens fichiers** : un fichier enregistré avant la v3.2 (stockage local ou `S3_*`) reste lu chez son fournisseur d'origine, indiqué dans sa ligne. `npm run files:migrate` liste ceux à migrer ; `npm run files:migrate -- --apply` les copie vers Cloudinary, relit chaque copie et compare l'empreinte SHA-256 avant de changer la ligne. L'original n'est jamais effacé et l'ancienne référence reste en base (`previous_driver`, `previous_storage_key`). Gardez les variables `S3_*` tant que `files:migrate` en liste.

Sans Cloudinary : en local, les fichiers vont dans `.uploads/` ; en ligne, l'envoi de fichiers est désactivé et le site propose WhatsApp.

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
