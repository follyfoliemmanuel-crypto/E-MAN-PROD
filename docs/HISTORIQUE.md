# Historique des versions et des vérifications

## v3.6.0 — Notifications push (téléphone et ordinateur)

- PWA (manifeste, icônes 192/512/maskable) et service worker `/sw.js` limité aux notifications (aucun cache, aucune requête interceptée).
- Web Push standard avec clés VAPID, chiffrement aes128gcm (RFC 8291) et signature VAPID (RFC 8292) faits avec le module crypto de Node : aucune dépendance, aucun service payant. Clés créées automatiquement si les variables VAPID_* sont absentes.
- Chaque utilisateur active ou désactive les notifications appareil par appareil (rubrique Notifications), voit et retire ses appareils, envoie une notification d'essai. Plusieurs appareils par compte.
- Envoi branché sur les notifications existantes (espace client et admin conservés) : mêmes destinataires, mêmes droits. Texte d'écran verrouillé générique, sans donnée personnelle. Le clic ouvre la bonne page.
- Sécurité : appareil rattaché au compte de la session, services push officiels seulement, abonnements expirés supprimés, comptes désactivés exclus, désabonnement à la déconnexion.
- Migration 009 (additive) : tables push_subscriptions et push_keys. Détails : docs/NOTIFICATIONS-PUSH.md.

## v3.5.0 — Les commandes viennent des clients

- Le client passe commande depuis son espace (« Mes commandes » → « Passer une commande ») : prestations, quantités, précisions, date souhaitée, fichiers.
- La commande arrive dans l'onglet Commandes de l'atelier avec le statut « À confirmer » et un bandeau « nouvelle commande ». L'atelier vérifie, fixe les prix et la date promise, puis **confirme** ou **refuse**. Ensuite : en production → terminée (prête) → livrée.
- Le client suit l'avancement avec des mots simples : en attente de confirmation, confirmée, en cours, prête, livrée, annulée. Il est prévenu dans son espace et par e-mail (« commande bien reçue », « confirmée », « prête »…). Il peut annuler tant que l'atelier n'a pas confirmé.
- L'atelier ne crée plus de commande lui-même (bouton retiré, refusé côté serveur). Les commandes issues d'un devis accepté restent possibles.
- Sécurité : prix, statut et paiement envoyés par le navigateur sont ignorés ; facture et paiement refusés tant que la commande n'est pas confirmée ; 10 commandes en attente maximum par client.
- Base : migration 008 (additive) — statut « en_attente », message et date souhaitée du client, date de confirmation, origine.
- Corrigé : l'émission d'une facture échouait avec le vrai pilote Postgres (types de paramètres) ; liens de fichiers agrandis au doigt.

## v3.4.2 — Bandeau du haut d'un bord à l'autre

- Le bandeau (adresse, e-mail, WhatsApp, E-MAN CARS) entre par le bord droit, traverse toute la largeur, sort complètement par le bord gauche puis recommence. Vitesse constante d'environ 60 px/s quelle que soit la taille de l'écran.

## v3.4.1 — Défilement automatique partout

- Bandeau du haut (adresse du siège et de l'annexe, e-mail, WhatsApp, E-MAN CARS) : défile tout seul en continu, en boucle, les liens restent cliquables.
- Cartes « Ce que nous réalisons pour vous » : défilent toutes seules sans jamais s'arrêter, même avec la souris dessus. Au doigt, elles suivent le doigt puis repartent moins d'une seconde après qu'on les lâche (flèches et molette : reprise après 1 à 1,5 s).
- Tests : défilement des cartes souris posée, doigt posé puis lâché, bandeau en mouvement, liens cliquables, réglage « moins d'animations ».

## v3.4.0 — compression automatique des fichiers avant l'envoi
- **Dans le navigateur, avant Cloudinary**, sans rien installer (`src/lib/compress.js`) :
  - fichier sous la limite : envoyé tel quel, identique à l'octet près (fichiers d'impression) ;
  - photo trop lourde (devis, commandes, messages) : réenregistrée en haute qualité (jusqu'à 6 000 px, 92 %) ;
  - autre fichier trop lourd (PSD, EPS, AI, PDF…) : mis dans une archive .zip **sans perte** — l'atelier retrouve le fichier d'origine intact en l'ouvrant ;
  - fichiers choisis jusqu'à 50 Mo ; si même compressé le fichier dépasse la limite, message clair (WhatsApp, lien de partage).
- Le message de confirmation indique la compression (« compressé de 20,0 Mo à 0,7 Mo »).

## v3.3.1 — photos jusqu'à 50 Mo, photo de profil toujours affichée
- **Photos jusqu'à 50 Mo** (réalisations, images du site, photo de profil) : réduites dans le navigateur avant l'envoi (2 560 px pour le site, 800 px pour le profil, orientation des téléphones respectée), pour tenir dans la limite de 10 Mo par image de l'offre gratuite de Cloudinary. Au-delà de 50 Mo : message clair.
- **Photo de profil** : avant, une photo de téléphone (souvent 3 à 8 Mo) était refusée par la limite de 2 Mo. Elle est maintenant allégée automatiquement. Si Cloudinary refuse l'adresse optimisée, la photo d'origine est affichée par un lien temporaire ; en dernier recours, les initiales.

## v3.3.0 — carrousels automatiques, photos de profil fiables, valeurs de la base identiques en ligne
- **Carrousel d'accueil** : défilement automatique permanent, sans bouton pause, y compris souris posée dessus ou appareil réglé sur « moins d'animations » ; flèches, points et glissement conservés.
- **Cartes « Ce que nous réalisons pour vous »** : défilement continu et doux (≈ 30 px/s) en boucle sans fin ; arrêt le temps que la souris est sur une carte ou que la personne fait défiler à la main, puis reprise.
- **Photos de profil** : un seul composant partout (en-tête, menu, espace, profil), image ronde recadrée ; initiales si la photo ne se charge pas, jamais d'icône cassée.
- **Base de données** : le vrai pilote (pg en local, Neon en ligne) renvoyait les grands nombres en texte et les dates en objets JavaScript ; ils sont maintenant convertis comme le code l'attend (montants, tailles de fichiers, dates des e-mails et des PDF). Tous les tests tournent désormais avec le vrai pilote.
- **Google** : l'adresse de retour `/api/auth/google/callback` est acceptée en plus de `/api/auth/google-callback`.

## v3.2.2 — diagnostic de configuration, administrateur automatique, inscription Google d'abord
- **`/api/auth/status`** (en ligne) et **`npm run check`** (sur le poste) : disent précisément ce qui est configuré, ce qui manque et pourquoi le site « ne voit pas » une variable (fichier `.env` non envoyé à Vercel, pas de redéploiement, valeur mal saisie).
- **Plus de panne silencieuse** : si l'API ou la base ne répond pas, le site l'affiche (fenêtre de connexion, espace) au lieu de se comporter comme si rien n'était configuré.
- **emanprod3@gmail.com administrateur automatiquement**, seulement une fois l'adresse prouvée (Google ou lien de confirmation) ; jamais par le navigateur.
- **Inscription** : « S'inscrire avec Google » en premier (recommandé), inscription par e-mail toujours possible ; connexion par e-mail et mot de passe inchangée ; e-mails de confirmation et de mot de passe oublié par Resend.

## v3.2.1 — plus rien à faire à la main après la configuration
- **Base mise à jour automatiquement** à chaque déploiement de production (migrations + contenu de départ) : plus de SQL à lancer.
- **Réglages admin appliqués aussitôt** : contenu public et photos du site jamais gardés en cache par le CDN.
- **Une seule variable d'adresse** : `SITE_URL` (ou, à défaut, l'adresse de production Vercel).
- **Photos du site depuis le tableau de bord** : Images et bannières → « Envoyer une photo » remplace chaque visuel provisoire (carrousel, pages, prestations, formations) ; photo stockée et optimisée par Cloudinary, l'ancienne est effacée.

## v3.2 — fichiers sur Cloudinary, métadonnées dans Neon
- **Cloudinary fournisseur unique** : images (`image`) et documents (`raw`), envoi direct navigateur → Cloudinary signé par le serveur, aucun fichier ne passe par Vercel, aucun SDK ajouté.
- **Confidentialité** : tout est privé (`authenticated`) sauf les réalisations ; liens de téléchargement signés de 5 minutes après contrôle des droits ; PDF et archives toujours en pièce jointe.
- **Contrôles conservés** : droits, extension, MIME, taille relue chez Cloudinary, vraie signature du contenu (format décodé pour les images, 64 premiers octets pour les fichiers bruts).
- **Limite réelle** : pièces jointes à 10 Mo (offre gratuite), affichée dans les formulaires, réglable par `CLOUDINARY_MAX_FILE_MB`.
- **Images optimisées** : réalisations servies par le CDN (format moderne, compression, largeur adaptée), photos de profil recadrées, originaux intacts.
- **Compatibilité** : chaque fichier est lu chez le fournisseur indiqué dans sa ligne ; les anciens fichiers (local, S3) restent lisibles ; `npm run files:migrate` les copie avec vérification SHA-256 sans effacer les originaux.
- **Migration 007** (additive) : références Cloudinary, empreinte, intégrité, sauvegarde, ancienne référence ; table `backup_runs`.
- **Sauvegarde indépendante** : `npm run backup` (base + fichiers vers un dossier d'E-MAN PROD), `files:check` (intégrité, orphelins, envois abandonnés), `files:restore`. Paramètres → Fichiers et sauvegardes affiche l'état réel.
- **Vérification réelle du compte** : `npm run storage:check` (à lancer avec les identifiants Cloudinary).

## v3.1 — connexion et inscription dans l'en-tête
- **En-tête** : boutons « Connexion » et « Inscription » visibles sur toutes les pages. Sur téléphone, « Connexion » reste dans l'en-tête et les deux boutons sont en tête du menu. Une fois connecté, la photo de profil (ou les initiales) remplace ces boutons, avec la pastille des notifications non lues et un menu : Mon espace / Tableau de bord, Notifications, Mon profil, Sécurité, Se déconnecter.
- **Google** : « Se connecter avec Google » et « S'inscrire avec Google » sont toujours affichés. Tant que les identifiants ne sont pas configurés, le bouton est grisé avec la mention « bientôt disponible ». L'adresse `/api/auth/google` ne renvoie plus de page d'erreur : elle ramène sur le site avec un message (non configuré, annulé, trop de tentatives).
- **Paramètres → Connexion Google** (admin) : état de la configuration, nombre de comptes reliés, et les deux adresses à déclarer dans Google Cloud. Le secret n'est jamais affiché.
- **Fenêtre de connexion** : onglets Connexion / Inscription. En démonstration, elle montre les vrais formulaires et précise qu'ils ouvrent un tableau de bord fictif.
- **Menu principal** : replié en dessous de 1 100 px de large (tablettes) pour laisser la place aux boutons.
- **Base de données en un fichier** : `db/install-neon.sql`, à coller dans le SQL Editor de Neon. Il est généré depuis les migrations (`npm run db:sql`). 20 contrôles : base vide, relance, base existante avec données, base à mi-chemin (004), empreinte modifiée. Le schéma et le contenu de départ obtenus sont identiques à ceux de `db:migrate`.
- **Vérifié** : 85 contrôles dans le navigateur, à 9 tailles d'écran de 360 à 1 440 px, pour les comptes déconnecté, CLIENT, STAFF et ADMIN, avec Google configuré, non configuré et en démonstration ; plus la non-régression complète.

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

## Migration v2.4 → v2.5

- `npm run db:migrate` fait d'abord une **sauvegarde** de toutes les tables dans `backups/<date>_avant-migration/`, avec un fichier JSON par table et un manifeste du nombre de lignes. Il applique ensuite chaque migration **dans une transaction** : en cas d'erreur, rien n'est modifié.
- **Aucune donnée n'est supprimée.**
  - Les tables sont renommées, et leurs lignes et identifiants restent identiques.
  - Les anciennes demandes restent intactes dans `legacy_orders`. Chacune est recopiée en devis, avec le même numéro EMP-…, le client, la description, la prestation, la quantité, le montant, la date et le statut.
  - Les demandes « Validée », « En production » ou « Terminée » donnent aussi une commande.
  - Les factures pointent vers les nouvelles commandes, et l'ancien lien est gardé.
  - Les valeurs sans équivalent dans le nouveau modèle sont notées dans le journal d'activité. C'est le cas d'un paiement noté sur une demande annulée.
- **Retour en arrière** : branche Neon créée avant la mise à jour, ou restauration de la sauvegarde JSON dans une base vide (`npm run db:restore`, depuis la v3.0). Voir [SAUVEGARDE.md](SAUVEGARDE.md).
- Une migration déjà appliquée ne doit plus être modifiée : `db:migrate` le refuse. Toute évolution passe par une nouvelle migration, par exemple `003_….sql`.
