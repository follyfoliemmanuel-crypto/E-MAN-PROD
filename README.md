# E-MAN PROD — site et espace client (v2.8)

Site vitrine, prestations, centre de formation professionnelle, galerie de réalisations, page E-MAN CARS, demandes de devis, inscriptions, espace client et tableau de bord d'administration.

*E-man Prod, la référence !* Siège : Nouveau Marché de Baguida, Lomé. Annexe : Agbavi, Yésuvito. emanprod3@gmail.com
Stack : **React 18 + Vite** pour le site, **fonctions Vercel** pour l'API, **Neon (PostgreSQL)** pour les données et les comptes.

## Architecture
```
Navigateur ──► /api/* (fonctions Vercel, Node) ──► Neon (PostgreSQL)
```
- Le navigateur ne parle **jamais** directement à la base. La chaîne `DATABASE_URL` reste côté serveur, et chaque fonction vérifie qui appelle et ce qu'il a le droit de faire.
- Les comptes sont gérés dans Neon, sans service tiers :
  - mots de passe hachés avec scrypt ;
  - sessions par cookie `HttpOnly`, `SameSite=Lax` et `Secure` en HTTPS ;
  - limitation des tentatives de connexion et des envois de formulaires.
- Les requêtes passent par le driver officiel `@neondatabase/serverless`, en HTTP, toujours paramétrées (aucune concaténation de valeurs dans le SQL). Avec un PostgreSQL installé sur le PC, le driver `pg` prend le relais automatiquement.
- Les e-mails (alerte à chaque demande, confirmation d'adresse, mot de passe oublié) passent par Resend. C'est facultatif : sans clé, tout le reste fonctionne.

```
api/                     routes (fonctions Vercel) : valident l'entrée avec Zod, puis appellent les services
  quotes.js              devis : demande, chiffrage, statuts, conversion en commande
  orders.js              commandes : statuts, paiement, lignes, historique
  trainings.js           inscriptions aux formations (places contrôlées)
  account.js             espace client : profil, historique ; admin : clients ; avis clients
  files.js               fichiers joints : envoi signé, vérification du contenu, téléchargement contrôlé
  inbox.js               messages (fil par devis ou commande) et notifications
  manage.js              contenu admin : formations, pôles, sessions, prestations, réalisations, avis, réglages
  catalog.js, media.js, auth/[action].js
api/_lib/                (non exposé comme route)
  services/              RÈGLES MÉTIER et contrôles d'accès : quotes, orders, enrollments, clients,
                         files, inbox, content
  schemas.js             validation Zod (champs, statuts) ; activity.js journal + notifications
  storage.js             stockage S3 compatible (signature SigV4) ou dossier local en développement
  db.js, http.js, auth.js, mail.js
db/migrations/           001_base.sql (v1.0 → v2.4), 002_backend.sql (v2.5) — appliquées par db:migrate
db/schema-reference.sql  schéma complet après migration (lecture seule, pour consultation)
scripts/db.mjs           migrate, status, backup, demo, admin, check ; scripts/lib/ : migrations, sauvegarde, démo
src/content/seed.js      contenu de départ : 6 prestations, 3 pôles, 12 formations, textes, coordonnées
src/pages/requests.jsx   espace client : devis, commandes, messages, fichiers, profil
src/config.js, src/routes-meta.js, src/pages/, src/components/, src/style.css, public/fonts/
```

## Démarrer en local (sur votre PC, sans Vercel)

Vercel ne sert qu'à la mise en ligne. En local, une seule commande lance le site **et** l'API.

### Prérequis
- **Node.js 24.7 ou plus** : https://nodejs.org (version « LTS » 24). Vérifier avec `node -v`. Node 24 est nécessaire pour le hachage Argon2id des mots de passe.
- Un terminal ouvert **dans le dossier du projet** (celui qui contient `package.json`).

### 1. Installer
```bash
npm install
```

### 2a. Voir le site tout de suite, sans base de données
```bash
npm run demo
```
Le site s'ouvre sur http://localhost:5173 avec des données fictives : formulaires, tableau de bord, animations. Rien n'est enregistré.

### 2b. Version complète avec base de données
1. Copier `.env.example` en `.env`, puis remplir `DATABASE_URL`. Deux choix :
   - **Neon (recommandé, rien à installer)** : Neon Console > Branches > créer une branche `dev` > **Connect** > copier la chaîne `postgresql://…neon.tech/…?sslmode=require`.
   - **PostgreSQL installé sur le PC** : créer une base `emanprod`, puis `DATABASE_URL=postgresql://postgres:VOTRE_MDP@localhost:5432/emanprod`.
2. Créer ou mettre à jour la base :
   ```bash
   npm run db:check     # teste la connexion
   npm run db:migrate   # sauvegarde, applique les migrations, ajoute le contenu de départ
   npm run db:demo      # facultatif : données de démonstration (-- --remove pour les retirer)
   ```
3. Lancer :
   ```bash
   npm run dev
   ```
   Site et API sur http://localhost:5173.
   `db:migrate` peut être relancé sans risque : une migration déjà appliquée ne l'est jamais deux fois. Le contenu de départ : il n'écrase jamais ce qui a été modifié dans l'admin.
4. Sur le site, créer votre compte (Espace client > Créer un compte), puis le passer administrateur :
   ```bash
   npm run db:admin -- votre@email.com
   ```
   Déconnectez-vous et reconnectez-vous : le tableau de bord complet apparaît.

### Si ça refuse de démarrer
| Message | Cause et solution |
|---|---|
| `npm : impossible de charger le fichier … l’exécution de scripts est désactivée` (Windows PowerShell) | Ouvrir PowerShell et lancer `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, puis répondre O. Ou utiliser l'« Invite de commandes » (cmd) à la place. |
| `'npm' n’est pas reconnu…` / `command not found: npm` | Node.js n'est pas installé, ou le terminal a été ouvert avant l'installation : installer Node.js LTS puis rouvrir le terminal. |
| `npm ERR! enoent … package.json` | Le terminal n'est pas dans le bon dossier : `cd` jusqu'au dossier qui contient `package.json` (après décompression : `eman-prod-app`). |
| `Unsupported engine` / erreurs de syntaxe au lancement | Node.js trop ancien : installer la version 24 ou plus. |
| `Port 5173 is in use` | Un autre serveur tourne déjà : le fermer, ou lancer `npm run dev -- --port 5174`. |
| Dans le site : « DATABASE_URL n’est pas configurée » | Le fichier `.env` manque ou est vide : voir l'étape 2b. Il doit s'appeler exactement `.env` (pas `.env.txt`). |
| `npm run db:check` : connexion impossible | Chaîne de connexion mal copiée (mot de passe, `?sslmode=require` pour Neon), ou PostgreSQL local arrêté. |

### Commandes utiles
| Commande | Rôle |
|---|---|
| `npm run dev` | site + API en local (avec base) |
| `npm run demo` | site seul avec données fictives |
| `npm run build` puis `npm run preview` | tester la version de production en local |
| `npm run db:migrate` / `db:status` / `db:backup` | mettre à jour la base, voir son état, la sauvegarder |
| `npm run db:demo` (`-- --remove`) | ajouter / retirer les données de démonstration |
| `npm run db:admin -- email` / `db:check` | nommer un administrateur, tester la connexion |

## Mise en ligne (Vercel + Neon)
1. Dans Neon, utiliser la branche principale `main` pour le site en ligne. **Avant la mise à jour v2.5**, créez une branche de secours : Neon > Branches > *Create branch* (copie instantanée de toute la base). Puis lancez `npm run db:migrate` avec la chaîne de `main` dans `.env`.
2. Pousser le dossier sur GitHub, puis l'importer dans Vercel (framework : **Vite**, build : `npm run build`, sortie : `dist`). Dans Vercel > Settings > General > **Node.js Version : 24.x**. `vercel.json` gère déjà les adresses des pages, l'API et les en-têtes de sécurité.
3. Vercel > Settings > Environment Variables : `DATABASE_URL` (branche `main`), `AUTH_SECRET`, et pour Google `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` (voir « Connexion Google »), et pour les fichiers joints `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (voir « Fichiers joints »), `SITE_URL=https://www.emanprod.com`, `VITE_WHATSAPP_NUMBER=22891388405`, et si souhaité `RESEND_API_KEY`, `MAIL_FROM`, `NOTIFY_TO`, `VITE_CONTACT_EMAIL`.
4. Déployer, relier le domaine `www.emanprod.com`, créer votre compte sur le site en ligne, puis le passer administrateur (`db:admin` avec la chaîne de `main`, ou en SQL : `update users set role = 'admin' where lower(email) = lower('VOTRE_EMAIL');`).
5. E-mails (recommandé) : compte https://resend.com, domaine `emanprod.com` vérifié, puis `RESEND_API_KEY`, `MAIL_FROM` et `NOTIFY_TO` dans Vercel. Cela active les alertes de commande, la confirmation d'adresse et le « mot de passe oublié ».

## Backend v2.5 : base de données et règles métier

**Choix techniques.** Le stack existant est conservé (React + Vite, fonctions Vercel, Neon PostgreSQL) : il est sain, testé, et le réécrire en Next.js + Prisma n'apporterait rien aux clients. Ajouts : **Zod** pour toutes les validations, **migrations SQL versionnées**, organisation en **services** (règles métier et contrôles d'accès, toujours côté serveur) appelés par des routes minces. Les requêtes restent en SQL paramétré. 10 fonctions Vercel (limite de l'offre gratuite : 12).

**Modèles** (28 tables) :

| Modèle demandé | Table | Remarques |
|---|---|---|
| User, Session, VerificationToken | `users`, `sessions`, `verification_tokens` | mots de passe scrypt, jetons hachés |
| Account | `accounts` | prête pour une connexion Google/Facebook plus tard ; non utilisée aujourd'hui |
| ClientProfile | `client_profiles` | type de client, entreprise, adresse, ville, WhatsApp, moyen de contact, note interne |
| Quote, QuoteItem | `quotes`, `quote_items` | numéro DV-AAAA-NNNNN, plusieurs prestations, prix, remise, validité, dates |
| Order, OrderItem | `orders`, `order_items` | numéro CMD-AAAA-NNNNN unique, une commande par devis au plus, paiement |
| Service | `services` | les prestations |
| Training, TrainingCategory | `trainings`, `training_categories` (+ `training_sessions`) | pôles, programmes, tarifs, durées, dates, places |
| Enrollment | `enrollments` | statut, session, places contrôlées |
| Portfolio, PortfolioCategory | `portfolio_items`, `portfolio_categories` | brouillon / publié / masqué, date de publication |
| Testimonial | `testimonials` | publié seulement après relecture, avec l'accord écrit du client |
| Notification, Message | `notifications`, `messages` | fil par devis ou commande |
| UploadedFile | `uploaded_files` | rattaché à un utilisateur et à un devis, une commande, un message ou une réalisation |
| ActivityLog | `activity_logs` | historique de chaque devis, commande, inscription et action admin |
| SiteSettings | `site_settings` | coordonnées, textes « À propos » et E-MAN CARS |

Tables techniques : `counters` (numérotation), `schema_migrations`, `rate_events`, `site_media`, `invoices` (prête), `legacy_orders` (anciennes demandes, lecture seule).

**Règles de suppression.**
- Les devis, commandes et inscriptions ne se suppriment pas depuis le site : on les annule, et l'historique reste.
- Les lignes et les messages suivent leur devis ou leur commande (cascade).
- Une commande facturée ne peut pas être supprimée.
- Un fichier rattaché bloque la suppression de sa ressource : il faut l'effacer d'abord, stockage compris.
- Un compte supprimé garde ses devis et commandes (client « détaché »).

**Règles métier principales.**
- **Devis**
  - Un visiteur ne fixe jamais de prix.
  - Le devis ne peut être envoyé que si chaque ligne a un prix ; sa validité est alors de 30 jours par défaut.
  - Après l'envoi, les prix sont verrouillés (on repasse « En étude » pour les modifier).
  - Le client accepte ou refuse son devis ; il expire automatiquement passé sa date de validité.
  - L'atelier crée la commande, une seule par devis, même en cas de double clic.
- **Commandes**
  - Les statuts se suivent : confirmée → en production → terminée → livrée, ou annulée.
  - Le statut de paiement se déduit du montant encaissé, qui ne peut pas dépasser le total.
  - Les lignes sont modifiables jusqu'à la fin de la production.
  - Chaque modification est inscrite dans l'historique.
- **Inscriptions**
  - Une même personne ne peut pas s'inscrire deux fois à une session.
  - La place est confirmée (« Inscrit ») seulement s'il en reste une.
  - Le client peut annuler sa propre inscription.
  - Une session qui a reçu des inscriptions se ferme, elle ne se supprime pas.
- **Accès** : chaque client ne voit que ses propres demandes. Une ressource appartenant à quelqu'un d'autre répond « introuvable », pour ne pas révéler qu'elle existe.

## Authentification et sécurité (v2.6)

**Connexion par e-mail et mot de passe.**
- Inscription avec prénom, nom, e-mail et mot de passe.
- Règles du mot de passe : 10 caractères minimum, et refus des mots de passe courants, ou de ceux qui contiennent le nom ou l'e-mail.
- Mots de passe hachés avec **Argon2id** (19 Mio, 2 passes : réglages recommandés par l'OWASP), natif dans Node 24. Les anciens hachages scrypt sont remplacés automatiquement à la connexion suivante.
- Confirmation de l'adresse e-mail par un lien valable 48 h. Mot de passe oublié : lien valable 1 h, à usage unique ; la réinitialisation ferme toutes les sessions.
- Les e-mails partent par Resend. **Sans Resend, en local, les liens s'affichent dans le terminal** de `npm run dev`. En ligne, sans Resend, la confirmation et le mot de passe oublié ne fonctionnent pas.

**Sessions.**
- Le cookie contient un jeton aléatoire, et la base n'en garde que l'empreinte.
- Cookie `HttpOnly` et `SameSite=Lax`. En HTTPS, il prend le nom `__Host-emp_session` et devient `Secure`.
- Durée maximale de 30 jours. Fermeture après 14 jours sans utilisation. Jeton renouvelé toutes les 24 h.
- Au plus 10 sessions par compte.
- L'écran **Sécurité** liste les appareils connectés et permet d'en fermer un, ou tous les autres.
- Changer son mot de passe déconnecte les autres appareils. L'administrateur peut fermer les sessions d'un compte ou le désactiver.

**Rôles.**

| Rôle | Accès |
|---|---|
| ADMIN | tout, y compris l'équipe, les réglages du site et le journal de sécurité |
| STAFF | seulement les domaines cochés par l'admin : devis, commandes, formations, contenu, fiches clients |
| CLIENT | uniquement ses propres informations |

- Le rôle est lu en base à chaque requête. Le navigateur ne peut ni le choisir ni le modifier.
- Un admin ne peut pas changer son propre rôle.
- Pour rejoindre l'équipe, un compte doit avoir confirmé son adresse e-mail.
- Retirer un droit ferme les sessions de la personne.
- Nommer le premier administrateur : `npm run db:admin -- email`. Les suivants se nomment depuis l'onglet **Équipe**.

**Protections.**
- Validation de toutes les entrées (Zod) et requêtes SQL paramétrées.
- CSRF : origine vérifiée (`Origin` et `Sec-Fetch-Site`), corps JSON obligatoire, cookies `SameSite`.
- XSS : React échappe tout le texte. En-tête CSP strict, sans script en ligne ni `eval`, et intégration dans un autre site interdite. Ajout de HSTS et `nosniff`.
- Force brute : 8 essais par compte et 30 par adresse IP, sur 15 minutes.
- Contrôle des fichiers envoyés (voir plus bas).
- **Journal de sécurité** : connexions, échecs, blocages, changements de rôle, accès refusés, liaisons Google. L'adresse IP y est remplacée par une empreinte et l'e-mail est masqué.
- Aucun secret dans le code envoyé au navigateur : seules les variables `VITE_*` y vont, et aucune n'est secrète.

### Connexion Google

**Fonctionnement.**
- OpenID Connect avec PKCE, `state` (lié au navigateur par un cookie) et `nonce`, à usage unique et valables 10 minutes.
- La signature du jeton d'identité est vérifiée avec les clés publiques de Google, ainsi que son émetteur, son destinataire, son expiration et l'adresse vérifiée.
- À la première connexion, le compte est créé automatiquement (client, adresse confirmée).

**Liaison des comptes.** Si un compte existe déjà avec la même adresse et qu'elle est confirmée, il est relié. Si elle n'a jamais été confirmée, il est relié aussi, mais son mot de passe est retiré et ses sessions fermées : un tiers a pu créer ce compte avec l'adresse d'autrui.

**Auth.js** n'a pas été retenu : il n'était pas installable ici, et il aurait dupliqué les sessions et les comptes déjà en place.

**Créer les identifiants** (à faire par E-MAN PROD, aucun identifiant n'est fourni) :
1. https://console.cloud.google.com : créer un projet « E-MAN PROD ».
2. **API et services > Écran de consentement OAuth** :
   - type « Externe », nom de l'application, e-mail d'assistance, logo ;
   - domaine autorisé `emanprod.com` ;
   - liens vers `/confidentialite` et `/mentions-legales` ;
   - champs d'application : `openid`, `email`, `profile` (aucune validation Google n'est nécessaire pour ces trois-là) ;
   - publier l'application (« En production »).
3. **API et services > Identifiants > Créer des identifiants > ID client OAuth**, type « Application Web » :
   - Origines JavaScript autorisées : `https://www.emanprod.com`, et pour tester en local `http://localhost:5173`.
   - URI de redirection autorisés : `https://www.emanprod.com/api/auth/google-callback`, et `http://localhost:5173/api/auth/google-callback`.
   - Pour une préversion Vercel, ajoutez son adresse exacte. Google refuse les adresses génériques avec `*`.
4. Copier l'ID client et le code secret dans `.env` en local, et dans Vercel (Environment Variables) en ligne : `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`. Vérifier que `SITE_URL` correspond bien à l'adresse du site.
5. Redéployer. Le bouton « Continuer avec Google » n'apparaît que lorsque ces deux variables sont présentes.

## Fichiers joints (stockage S3 compatible)

Les clients connectés peuvent joindre des fichiers à leurs devis et commandes, et l'atelier aux réalisations. Formats acceptés :
- pièces jointes : JPG, PNG, WebP, PDF, AI, EPS, PSD, CDR (CorelDRAW) ou ZIP, 25 Mo maximum ;
- photos de réalisations : JPG, PNG ou WebP, 5 Mo maximum.

Contrôles :
1. Avant l'envoi : droits, extension, type MIME annoncé et taille.
2. Pendant l'envoi : le navigateur envoie directement au stockage, avec une adresse signée valable 10 minutes. Le type et la taille y sont signés, donc le stockage refuse tout autre fichier.
3. Après l'envoi : relecture de la taille et des premiers octets du fichier. Un faux PDF, par exemple un programme renommé, est refusé puis effacé.

Le seau reste **privé** : chaque téléchargement passe par `/api/files`, qui vérifie les droits puis redirige vers un lien de 5 minutes. Les fichiers sont toujours téléchargés, jamais affichés dans le navigateur, sauf les images.

**Mise en place (Cloudflare R2, recommandé)** :
1. Dans R2, créez un seau privé, par exemple `emanprod-fichiers`.
2. Dans *Manage API tokens*, créez un jeton avec le droit *Object Read & Write*.
3. Renseignez dans Vercel : `S3_ENDPOINT=https://<id-compte>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` et `S3_SECRET_ACCESS_KEY`.
4. Dans les réglages CORS du seau, autorisez `PUT` et `GET` depuis `https://www.emanprod.com`.

AWS S3, Backblaze B2 et Wasabi fonctionnent de la même façon.

Sans ces réglages, les fichiers vont dans le dossier `.uploads/` du projet en local. En ligne, l'envoi est désactivé et le site invite les clients à utiliser WhatsApp.

## Espaces client et administration (v2.7)

Une seule adresse, `/espace`, avec un menu latéral (replié derrière un bouton sur mobile). Le contenu du menu dépend du rôle, et chaque écran revérifie les droits côté serveur.

**Espace client**
- **Accueil** : message de bienvenue, devis et commandes en cours, dernières nouvelles.
- **Mes devis** : nouvelle demande avec plusieurs prestations (quantité, unité, précisions) et fichiers joints ; réponses de l'atelier ; PDF dès que le devis est envoyé ; accepter ou refuser (avec confirmation).
- **Mes commandes** : avancement, dates, statut, paiement, documents de l'atelier, bon de commande en PDF.
- **Mes formations** : inscription à une session, statut, dates, tarif, durée, documents remis (convocation, attestation…).
- **Mes documents** : tous les PDF et fichiers échangés, au même endroit.
- **Notifications**, **Assistance** (fil de discussion avec l'équipe), **Mon profil** (photo, nom, coordonnées), **Sécurité** (mot de passe, sessions).

**Espace équipe** (ADMIN : tout ; STAFF : selon ses droits)
- **Tableau de bord** : indicateurs et graphiques calculés en direct sur la base, sur 12 mois. Chaque graphique se consulte aussi en tableau. Un STAFF ne voit que les chiffres de ses domaines.
- **Clients** : recherche, filtres (type, activité, e-mail confirmé, compte), fiche avec historique complet, note interne, fermeture des sessions, désactivation.
- **Devis** : créer (demande reçue par téléphone, WhatsApp, au comptoir), chiffrer, envoyer, PDF (filigrane « BROUILLON » avant envoi), statuts, historique, pièces jointes.
- **Commandes** : créer, modifier les lignes, confier à un collaborateur (« Suivie par »), filtre « mes commandes », commentaires internes jamais visibles du client, le client est notifié à chaque changement de statut.
- **Formations** : ajouter, modifier, tarifs, durées, sessions (dates, places), apprenants par session, documents pour un apprenant, archiver / désarchiver.
- **Réalisations** : envoi de photo ou adresse, description, catégories, publier, dépublier, supprimer.
- **Prestations**, **Images et bannières**, **Textes et coordonnées** (bandeau d'accueil, slogan, téléphone, WhatsApp, sites, horaires, page À propos, E-MAN CARS et son numéro), **témoignages** (publication après accord).
- **Assistance** : toutes les conversations des clients (droit « assistance »).
- **Équipe** (admin) : inviter un collaborateur STAFF, choisir ses droits, le désactiver, consulter l'historique de ses actions.

**Droits STAFF** : `quotes` (devis), `orders` (commandes), `trainings` (formations), `content` (réalisations, prestations, images), `clients`, `support` (assistance). Les textes officiels et coordonnées restent réservés à l'admin.

**Inviter un collaborateur** : Équipe → Inviter. La personne reçoit un e-mail pour choisir son mot de passe (lien valable 72 h, à usage unique). Si l'envoi d'e-mails n'est pas configuré, le lien s'affiche à l'écran pour être transmis par WhatsApp.

**PDF** : générés à la volée par le serveur (`pdf-lib`, sans service externe).

Migration : `004_spaces.sql` (photo de profil, documents de formation, assistance, affectation des commandes, archivage des formations). Elle s'applique avec `npm run db:migrate`, sauvegarde préalable comprise, sans perte de données.

## Notifications, e-mails et documents (v2.8)

### Ce qui fonctionne sans aucune configuration
- **Centre de notifications** (clients et équipe) : compteur de non lues dans le menu, filtres par rubrique, historique complet (30 par page), marquer comme lu ou non lu, tout marquer comme lu.
- **Événements notifiés aux clients** : demande de devis reçue, devis disponible, devis accepté ou refusé, changement de statut de commande, commande prête, facture émise, paiement reçu, inscription confirmée, attestation disponible, réponse de l'équipe, information importante (Annonces).
- **Événements notifiés à l'équipe** (selon les droits) : nouveau client, devis demandé, commande créée, inscription envoyée, nouveau message.
- **PDF générés par le serveur** : devis (logo, coordonnées, référence, dates, client, désignations, quantités, prix unitaires, montants, total, conditions, validité, zone de signature), bon de commande, facture, reçu, feuille de présence, attestation ou certificat. Les mentions légales renseignées apparaissent en pied de page.
- **Paiements et factures** : l'équipe « commandes » enregistre chaque paiement reçu (montant, moyen, date, référence) et un reçu numéroté REC-AAAA-NNNNN est créé. La facture FAC-AAAA-NNNNN fige les lignes de la commande. Son état (à payer, partiellement réglée, acquittée, annulée) est **calculé à partir des paiements enregistrés** : une contrainte en base interdit de la marquer « Payée » à la main.
- **Formations** : liste des participants, appel jour par jour (présent, retard, absent, excusé), taux d'assiduité, résultat de l'évaluation, supports de cours visibles des inscrits confirmés, feuille de présence en PDF.
- **Attestations** : pour chaque formation, l'admin fixe le document délivré (aucun, attestation, certificat), l'assiduité minimale et l'exigence d'une évaluation réussie. Le document n'est émis que si la formation est terminée, si ces conditions sont remplies et après une validation explicite de l'équipe, qui est tracée. Chaque document est numéroté (ATT-AAAA-NNNNN), téléchargeable par l'apprenant, révocable, et vérifiable par tous sur `/verifier`.
- **WhatsApp** : un numéro et un message prérempli par usage (contact direct, renseignements, devis, assistance, orientation formation), dans Paramètres → WhatsApp. Sans numéro propre, c'est le numéro principal qui est utilisé.
- **Paramètres** (admin) : coordonnées, WhatsApp, réseaux sociaux, informations légales, devis et factures (validité, conditions, moyens de paiement, mention de signature), modèles d'e-mails, notifications.

### Ce qui demande une configuration externe : l'envoi des e-mails
Sans fournisseur, aucun e-mail ne part et l'interface ne prétend jamais le contraire : le journal (Paramètres → E-mails) indique « non envoyé : fournisseur non configuré ». Un e-mail n'est noté « accepté par le fournisseur » que si celui-ci a répondu avec un identifiant de message. La remise effective dans la boîte de réception n'est pas suivie.

Modèles fournis : confirmation d'inscription, réinitialisation du mot de passe, invitation d'un collaborateur, confirmation de demande de devis, envoi de devis, devis accepté ou refusé, confirmation de commande, mise à jour de commande, commande prête, facture émise, inscription à une formation confirmée, attestation disponible, réponse de l'équipe, information importante, alerte pour l'équipe. L'admin peut changer l'objet et le paragraphe d'introduction de chacun, voir un aperçu et s'envoyer un essai.

**Étapes (Resend, recommandé)**
1. Créer un compte sur resend.com.
2. Ajouter un domaine qui appartient à l'entreprise (par exemple `emanprod.com`, ou un sous-domaine `notifications.emanprod.com`) et copier chez l'hébergeur du domaine les enregistrements DNS indiqués (DKIM, SPF). Attendre la vérification.
3. Créer une clé d'API (droit « Sending access »).
4. Dans Vercel → Settings → Environment Variables : `MAIL_PROVIDER=resend`, `MAIL_API_KEY=<clé>`, `MAIL_FROM=E-MAN PROD <notifications@emanprod.com>`, `MAIL_REPLY_TO=emanprod3@gmail.com`, `SITE_URL=https://www.emanprod.com`. Redéployer.
5. Paramètres → E-mails : vérifier « Envoi d'e-mails configuré », puis « M'envoyer un essai ».

**Brevo** fonctionne aussi : `MAIL_PROVIDER=brevo` et la clé d'API v3 de Brevo. Le domaine doit y être authentifié de la même façon.

**Pourquoi emanprod3@gmail.com n'est pas l'expéditeur** : Resend n'envoie que depuis un domaine vérifié, et Brevo remplace automatiquement les adresses gratuites (gmail.com) par une adresse technique. emanprod3@gmail.com est donc utilisée comme **adresse de réponse** (les clients qui répondent écrivent à l'atelier), comme adresse de contact dans les e-mails et les PDF, et comme destinataire par défaut des alertes de l'équipe.

Migration : `005_documents.sql` (journal des e-mails, annonces, paiements et reçus, factures figées, présences, documents de session, attestations). Les montants déjà encaissés sont repris comme paiements « saisie antérieure », **sans reçu** : aucun reçu n'est fabriqué pour un paiement qui n'a pas été enregistré comme tel.

## Migration v2.4 → v2.5 et sauvegardes

- `npm run db:migrate` fait d'abord une **sauvegarde** de toutes les tables dans `backups/<date>_avant-migration/`, avec un fichier JSON par table et un manifeste du nombre de lignes. Il applique ensuite chaque migration **dans une transaction** : en cas d'erreur, rien n'est modifié.
- **Aucune donnée n'est supprimée.**
  - Les tables sont renommées, et leurs lignes et identifiants restent identiques.
  - Les anciennes demandes restent intactes dans `legacy_orders`. Chacune est recopiée en devis, avec le même numéro EMP-…, le client, la description, la prestation, la quantité, le montant, la date et le statut.
  - Les demandes « Validée », « En production » ou « Terminée » donnent aussi une commande.
  - Les factures pointent vers les nouvelles commandes, et l'ancien lien est gardé.
  - Les valeurs sans équivalent dans le nouveau modèle sont notées dans le journal d'activité. C'est le cas d'un paiement noté sur une demande annulée.
- **Retour en arrière** : utilisez la branche Neon créée avant la mise à jour (*Restore* depuis la console Neon). La sauvegarde JSON est une copie lisible des données, pas un outil de restauration automatique.
- Une migration déjà appliquée ne doit plus être modifiée : `db:migrate` le refuse. Toute évolution passe par une nouvelle migration, par exemple `003_….sql`.

## Données de démonstration

`npm run db:demo` crée, par les mêmes règles métier que le site :
- 2 comptes clients, avec le mot de passe `demo-client-2026` ;
- 3 devis : un à chiffrer, un accepté et transformé en commande, un d'un visiteur sans compte ;
- 2 commandes, 2 inscriptions et un message.

Rien n'apparaît sur les pages publiques : pas de réalisation, de session ni d'avis inventés. Tout est repérable par l'adresse `@demo.emanprod.test`. Pour tout retirer : `npm run db:demo -- --remove`. À utiliser sur la branche `dev`, pas sur la base en ligne.

## Pages du site (v2.4)

| Adresse | Contenu |
|---|---|
| `/` | carrousel, chiffres, prestations défilantes, publics, déroulé, centre de formation |
| `/prestations` et `/prestations/<nom>` | Imprimerie, Infographie, Sérigraphie, Enseignes et publicité, Papeterie, Informatique et réseaux : présentation, ce que l'atelier réalise, devis prérempli |
| `/formations` | Centre de formation professionnelle E-MAN PROD, 3 pôles, 12 formations |
| `/formations/<nom>` | fiche : domaine, image, description, objectifs, programme, durée, niveau, prérequis, tarif, attestation, dates, places restantes, formulaire d'inscription |
| `/realisations` | galerie : filtres par catégorie, grand affichage (flèches, clavier, glissement) |
| `/e-man-cars` | branche automobile, présentée à part (style propre, sans lien avec l'imprimerie) |
| `/a-propos`, `/contact`, `/espace`, `/mentions-legales`, `/confidentialite` | |

`/services` (ancienne adresse) affiche toujours la liste des prestations. Le `sitemap.xml` est généré à la demande et suit les pages publiées.

## Gérer le contenu (Espace client, compte admin)

Tout le contenu des pages vient de la base : rien n'est à modifier dans le code.

- **Formations** : pour chaque formation, renseigner durée, niveau, prérequis, tarif en FCFA (ou une mention comme « payable en 2 fois »), attestation délivrée, puis ajouter les **sessions** (dates, horaires, lieu, nombre de places, ouverte ou fermée). Une formation peut aussi être masquée.
  - **Rien n'est inventé** : tant qu'un champ est vide, la fiche affiche « À préciser », « Nous consulter » ou « Prochaines dates bientôt annoncées ».
  - Les places restantes = places de la session − inscriptions au statut « Inscrit ». À 0, la session passe en « Complet » et disparaît du formulaire.
  - Les sessions passées ne s'affichent plus.
- **Réalisations** : ajouter une photo (catégorie, titre, adresse de l'image, description), la masquer ou la supprimer. Seules vos propres photos ont leur place ici.
- **Prestations** : afficher ou masquer une prestation (menu, accueil, pied de page, page).
- **Images du site** : 7 emplacements fixes (carrousel, bandeau formation, à propos, E-MAN CARS) + une image par prestation et par formation.
- **Inscriptions** : chaque demande indique la formation et la session choisies.

Les textes de présentation, objectifs et programmes viennent de `src/content/seed.js` au premier `db:migrate`. Ils se modifient ensuite depuis l'espace équipe (Formations, Prestations, Textes et coordonnées).

## Photos du site

Chaque image a un **visuel provisoire** : une illustration sobre, sans texte, qui ne se fait pas passer pour une réalisation d'E-MAN PROD.

**Remplacer une photo** : Espace client (compte admin), onglet **Images du site**, puis :
1. coller l'adresse de la photo (`https://…`) ou le chemin d'un fichier déposé dans `public/media/` (par exemple `/media/bache-boutique.jpg`) ;
2. écrire une courte description, lue par les lecteurs d'écran ;
3. cliquer sur **Enregistrer**. Le bouton « Revenir au visuel provisoire » annule.

Si une adresse ne répond plus, le site réaffiche automatiquement le visuel provisoire.

**Tailles conseillées** : JPEG ou WebP, carrousel 2000 × 1200 px, cartes et galerie 1200 × 900 px, au plus 300 à 400 Ko chacune pour rester rapide sur mobile.

**Photos libres de droits** : [Unsplash](https://unsplash.com) et [Pexels](https://www.pexels.com) (vérifiez la licence de chaque photo). Mots-clés utiles : « African graphic designer », « African print shop », « screen printing Africa », « large format printer », « African IT technician », « network cabling technician », « coding class Africa ».

Règles :
- une photo de banque d'images illustre un **métier**, jamais une réalisation d'E-MAN PROD ;
- seules vos propres photos peuvent être présentées comme des travaux de l'atelier ;
- dès que possible, préférez de vraies photos de l'atelier et de l'équipe, avec l'accord des personnes photographiées.

**Animations** : apparition des sections au défilement, carrousel en fondu, cartes défilantes (flèches, glissement tactile, défilement lent qui s'arrête au survol ou au toucher), grand affichage de la galerie. Écrites en CSS et JavaScript natif, sans Framer Motion, et coupées quand l'appareil demande moins d'animations.

## Design
- Barre utilitaire bleu nuit (adresses, e-mail, espace client, WhatsApp, lien E-MAN CARS), en-tête blanc avec menus « Prestations » et « Formations », filet bleu et rouge du logo.
- Polices : Inter Display (titres) et Inter (texte), hébergées sur le site (licence OFL). Couleurs : bleu nuit `#0F1B3D`, bleu `#1E26C4` et rouge `#D3121C` du logo ; noir et or pour E-MAN CARS. Contraste WCAG AA.

## À compléter ou confirmer
1. **Formations** : durées, niveaux, prérequis, tarifs, attestations et dates, depuis l'admin.
2. **Réalisations** : vos photos de travaux, depuis l'admin.
3. **Prestation « Informatique et réseaux »** : ajoutée parce que le pôle 2 de formation existe. Masquez-la depuis l'admin si l'atelier ne propose pas ces services aux clients.
4. **E-MAN CARS** : la page utilise le numéro principal tant qu'aucun numéro propre n'est renseigné dans Textes et coordonnées → E-MAN CARS.
5. `src/config.js` > `LEGAL` : raison sociale, forme juridique, RCCM, NIF, directeur de la publication. `BUSINESS.hours` : horaires.
6. **Témoignages** : les clients les déposent depuis leur espace ; l'admin les publie.
7. Vérifier auprès de l'IPDCP si une déclaration du traitement des données clients est nécessaire (loi n° 2019-014).

## Ce qui a été vérifié (v2.8)
- **Notifications, e-mails, documents** : 147 tests d'API contre un faux fournisseur d'e-mails, avec des comptes ADMIN, STAFF et CLIENT. Ils couvrent chaque événement, le contenu des e-mails et des PDF (lus avec pdftotext), les factures et reçus, les présences et attestations, les annonces, les paramètres, ainsi que les permissions et l'isolement des clients.
- **Envois refusés** : adresse refusée, réponse sans identifiant, clé invalide, fournisseur injoignable et fournisseur non configuré ne sont jamais notés « envoyé » (7 tests Resend et Brevo).
- **Navigateur** : 51 vérifications (centre de notifications, téléchargements, Paramètres, aperçu et essai d'e-mail, annonce, paiement et facture, appel, vérification publique), écrans à 360 et 390 px sans débordement.
- **Migration 005** appliquée sur une base v2.7 contenant des acomptes : montants et statuts conservés.
- **Non-régression** : 42 + 18 + 30 + 137 + 115 + 114 tests d'API, 25 + 58 vérifications navigateur.

## Ce qui a été vérifié (v2.7)
- **Espaces** : 114 tests d'API avec des comptes ADMIN, STAFF et CLIENT (création, consultation, modification, suppression ; statistiques identiques à la base ; isolement des clients sur devis, commandes, PDF, documents, photo, assistance ; commentaires internes et collaborateur affecté invisibles du client ; droits STAFF).
- **Navigateur** : 58 vérifications de parcours réels (demande de devis avec fichiers, PDF, acceptation, photo, assistance, affectation, commentaire, archivage…) et toutes les sections à 360 et 390 px sans débordement.
- **Non-régression** : 42 + 18 + 30 + 137 + 115 tests et 25 vérifications navigateur de la v2.6.

## Ce qui a été vérifié (v2.6)
- **Sécurité** : 115 tests, dont un parcours Google complet contre un faux serveur Google qui signe de vrais jetons RS256. Ils couvrent :
  - client sans accès à l'administration ;
  - isolation entre clients ;
  - droits STAFF ;
  - utilisateur déconnecté ;
  - rôle falsifié depuis le navigateur ;
  - mots de passe, sessions, réinitialisation, force brute, CSRF, XSS, injections, secrets et journal.
- **Navigateur** : 25 vérifications (onglets selon le rôle, XSS affiché sans exécution, bouton Google, écrans Sécurité et Équipe, mobile).
- **Non-régression** : 42 + 18 + 30 + 137 tests des versions précédentes, migration 003 sur une base v2.4 sans perte.

## Ce qui a été vérifié (v2.5, toujours valable)
- **Migration d'une base v2.4 complète** : 36 contrôles, tous réussis.
  - La base de test contient chaque statut et chaque mode de paiement, des factures liées, des inscriptions, des photos masquées et un lien prestation → pôle cassé.
  - Résultats : mêmes lignes et mêmes identifiants, chaque demande recopiée champ par champ, ancienne table intacte, sauvegarde faite avant, relance sans effet.
  - Une migration volontairement cassée ne laisse aucune trace, et une migration modifiée après application est refusée.
- **API, sur PostgreSQL 16** : 137 tests de la v2.5 sur les opérations, les relations, les règles métier, les droits, les validations et les erreurs. Il faut y ajouter les 90 tests des versions précédentes et 16 tests unitaires : signature S3 vérifiée contre l'exemple officiel d'AWS, détection des formats, données de démonstration créées puis retirées sans reste.
- **Navigateur** : 23 vérifications du parcours complet, plus les 57 de la v2.4.
  - Le parcours : demande depuis le site → chiffrage → envoi → message → fichier joint (faux PDF refusé) → acceptation → commande → production et acompte → profil → notifications, puis contrôle sur mobile.
- **Non vérifié ici** :
  - `npm install` et `vite build` avec les vraies dépendances, car l'installation de paquets est bloquée dans l'environnement de développement ;
  - l'envoi réel vers Cloudflare R2, faute d'accès réseau : le calcul de la signature est vérifié, l'envoi est à tester au premier réglage.

## Prochaines étapes possibles
- Paiement Mobile Money (T-Money, Flooz).
- Devis et factures en PDF : la table `invoices` est prête.
- Envoi de fichiers par le client (logo, maquette). Pour l'instant, cela passe par WhatsApp.
- Écran admin pour envoyer directement les photos de réalisations (l'API `/api/files` + action `portfolio.image` est prête).
- Écran admin « Clients » et « Avis » (API prêtes : `/api/account?clients=1`, actions `testimonial.*`).
