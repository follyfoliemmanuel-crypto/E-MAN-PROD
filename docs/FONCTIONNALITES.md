# Fonctionnalités et règles métier

Description détaillée, phase par phase. Pour l'installation, la configuration et la mise en ligne, voir le [README](../README.md).

## Architecture
```
Navigateur ──► /api/* (fonctions Vercel, Node) ──► Neon (PostgreSQL)
```
- Le navigateur ne parle **jamais** directement à la base. La chaîne `DATABASE_URL` reste côté serveur, et chaque fonction vérifie qui appelle et ce qu'il a le droit de faire.
- Les comptes sont gérés dans Neon, sans service tiers :
  - mots de passe hachés avec Argon2id (scrypt pour les anciens comptes, converti à la connexion) ;
  - sessions par cookie `HttpOnly`, `SameSite=Lax` et `Secure` en HTTPS ;
  - limitation des tentatives de connexion et des envois de formulaires.
- Les requêtes passent par le driver officiel `@neondatabase/serverless`, en HTTP, toujours paramétrées (aucune concaténation de valeurs dans le SQL). Avec un PostgreSQL installé sur le PC, le driver `pg` prend le relais automatiquement.
- Les e-mails transactionnels passent par Resend ou Brevo (facultatif : sans fournisseur, tout le reste fonctionne).

```
api/                     routes (fonctions Vercel) : valident l'entrée avec Zod, puis appellent les services
  quotes.js              devis : demande, chiffrage, statuts, conversion en commande
  orders.js              commandes : statuts, paiement, lignes, historique
  trainings.js           inscriptions aux formations (places contrôlées)
  account.js             espace client : profil, historique ; admin : clients ; avis clients
  files.js               fichiers joints : envoi signé, vérification du contenu, téléchargement contrôlé
  inbox.js               messages (fil par devis ou commande) et notifications
  manage.js              contenu admin : formations, pôles, sessions, prestations, réalisations, avis, réglages
  documents.js           factures, paiements, reçus, présences, attestations, vérification publique
  catalog.js, media.js, auth/[action].js
api/_lib/                (non exposé comme route)
  services/              RÈGLES MÉTIER et contrôles d'accès : quotes, orders, enrollments, clients,
                         files, inbox, content
  schemas.js             validation Zod (champs, statuts) ; activity.js journal + notifications
  storage.js             stockage S3 compatible (signature SigV4) ou dossier local en développement
  db.js, http.js, auth.js, mail.js
db/migrations/           001 → 006 (base, backend, auth, espaces, documents, performances) — appliquées par db:migrate
db/schema-reference.sql  schéma complet après migration (lecture seule, pour consultation)
scripts/db.mjs           migrate, status, backup, restore, demo, admin, check ; scripts/lib/ : migrations, sauvegarde, restauration, démo
src/content/seed.js      contenu de départ : 6 prestations, 3 pôles, 12 formations, textes, coordonnées
src/pages/requests.jsx   espace client : devis, commandes, messages, fichiers, profil
src/config.js, src/routes-meta.js, src/pages/, src/components/, src/style.css, public/fonts/
```

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
- Les e-mails partent par le fournisseur configuré (Resend ou Brevo). **Sans fournisseur, en local, les liens s'affichent dans le terminal** de `npm run dev`. En ligne, sans fournisseur, la confirmation d'adresse et le mot de passe oublié ne peuvent pas fonctionner.

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
- Nommer le premier administrateur : `npm run db:admin -- email`. Les suivants se nomment depuis la section **Équipe**.

**Protections.**
- Validation de toutes les entrées (Zod) et requêtes SQL paramétrées.
- CSRF : origine vérifiée (`Origin` et `Sec-Fetch-Site`), corps JSON obligatoire, cookies `SameSite`.
- XSS : React échappe tout le texte. En-tête CSP strict, sans script en ligne ni `eval`, et intégration dans un autre site interdite. Ajout de HSTS et `nosniff`.
- Force brute : 8 essais par compte et 30 par adresse IP, sur 15 minutes.
- Contrôle des fichiers envoyés (voir plus bas).
- **Journal de sécurité** : connexions, échecs, blocages, changements de rôle, accès refusés, liaisons Google. L'adresse IP y est remplacée par une empreinte et l'e-mail est masqué.
- Aucun secret dans le code envoyé au navigateur : seules les variables `VITE_*` y vont, et aucune n'est secrète.

La configuration de Google est décrite dans [CONFIGURATION.md](CONFIGURATION.md#3-connexion-google). Rôles et droits : [ROLES.md](ROLES.md).

## Fichiers joints (stockage S3 compatible)

Les clients connectés peuvent joindre des fichiers à leurs devis et commandes, et l'atelier aux réalisations. Formats acceptés :
- pièces jointes : JPG, PNG, WebP, PDF, AI, EPS, PSD, CDR (CorelDRAW) ou ZIP, 25 Mo maximum ;
- photos de réalisations : JPG, PNG ou WebP, 5 Mo maximum.

Contrôles :
1. Avant l'envoi : droits, extension, type MIME annoncé et taille.
2. Pendant l'envoi : le navigateur envoie directement au stockage, avec une adresse signée valable 10 minutes. Le type et la taille y sont signés, donc le stockage refuse tout autre fichier.
3. Après l'envoi : relecture de la taille et des premiers octets du fichier. Un faux PDF, par exemple un programme renommé, est refusé puis effacé.

Le seau reste **privé** : chaque téléchargement passe par `/api/files`, qui vérifie les droits puis redirige vers un lien de 5 minutes. Les fichiers sont toujours téléchargés, jamais affichés dans le navigateur, sauf les images.

Mise en place : [CONFIGURATION.md](CONFIGURATION.md#5-stockage-des-fichiers-s3-compatible).

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
- **Prestations**, **Images et bannières**, **Textes du site** (bandeau d'accueil, page À propos, E-MAN CARS et son numéro) ; coordonnées, WhatsApp, sites et horaires dans **Paramètres**, **témoignages** (publication après accord).
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

## Gérer le contenu (espace de gestion, compte admin)

Tout le contenu des pages vient de la base : rien n'est à modifier dans le code.

- **Formations** : pour chaque formation, renseigner durée, niveau, prérequis, tarif en FCFA (ou une mention comme « payable en 2 fois »), attestation délivrée, puis ajouter les **sessions** (dates, horaires, lieu, nombre de places, ouverte ou fermée). Une formation peut aussi être masquée.
  - **Rien n'est inventé** : tant qu'un champ est vide, la fiche affiche « À préciser », « Nous consulter » ou « Prochaines dates bientôt annoncées ».
  - Les places restantes = places de la session − inscriptions au statut « Inscrit ». À 0, la session passe en « Complet » et disparaît du formulaire.
  - Les sessions passées ne s'affichent plus.
- **Réalisations** : envoyer une photo (ou indiquer son adresse), catégorie, titre, description ; publier, dépublier ou supprimer. Seules vos propres photos ont leur place ici.
- **Prestations** : afficher ou masquer une prestation (menu, accueil, pied de page, page).
- **Images du site** : 7 emplacements fixes (carrousel, bandeau formation, à propos, E-MAN CARS) + une image par prestation et par formation.
- **Inscriptions** : chaque demande indique la formation et la session choisies.

Les textes de présentation, objectifs et programmes viennent de `src/content/seed.js` au premier `db:migrate`. Ils se modifient ensuite depuis l'espace équipe (Formations, Prestations, Textes du site, Paramètres).

## Photos du site

Chaque image a un **visuel provisoire** : une illustration sobre, sans texte, qui ne se fait pas passer pour une réalisation d'E-MAN PROD.

**Remplacer une photo** : Espace de gestion (compte admin), section **Images et bannières**, puis :
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
