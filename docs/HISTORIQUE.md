# Historique des versions et des vérifications

## v4.2.0 — Corrections de l'audit avant production, bandeau cookies, SQL de production

- **Légal** : page Conditions générales ; politique de confidentialité corrigée (Cloudinary, Google,
  notifications, 4 cookies techniques décrits, effacement) ; lien vers les conditions à l'inscription.
- **Bandeau cookies** : première visite, « Tout accepter / Nécessaires uniquement / Personnaliser »,
  rouvrable par « Gérer les cookies ». Le refus de l'« affichage rapide » efface les copies locales.
- **Données personnelles** : anonymisation d'un client (droit à l'effacement, factures et attestations
  conservées) ; consentement exigé et daté pour les demandes sans compte ; durée de conservation de
  3 ans appliquée chaque nuit (anonymisation, rien supprimé).
- **Production** : onglet « Mise en production » (e-mails, mentions légales, photos, MFA, CRON, compte
  de base, adresse du site, sauvegarde, Search Console, CGV) ; adresse de surveillance
  `/api/catalog?health=1` ; copie de toutes les tables avant chaque migration lancée par Vercel.
- **Robustesse** : écran de secours au lieu d'une page blanche ; vrai code 404 ; champ piège anti-robot ;
  focus rendu au bouton après une fenêtre ; `/espace` sans saut de mise en page (CLS 0,44 → 0).
- **Base** : migration 014 additive (consentement, 5 index, clé primaire anti-abus).
  SQL : `mise-a-jour-v4.2.sql`, `production-verification.sql`, `effacement-journaux-client.sql`.
- Tests : régression complète au vert ; nouvelles suites v4.2 API 39/39, navigateur 37/37,
  conservation 11/11 ; `securite-base.sql` appliqué tel quel puis API v4.2 et sécurité rejouées avec
  le compte `eman_app` (39/39, 83/83) ; scripts SQL de production exécutés sur une copie de la base.

## v4.1.3 — Audit de sécurité ciblé, bannière sans flash, « Partager le site »

- **Sécurité (audit ciblé, corrigé)** : la re-signature des adresses Cloudinary ajoutée en v4.1.2
  signait n'importe quelle adresse du compte. Un membre de l'équipe « contenu » pouvait enregistrer,
  comme photo du site, l'adresse d'une pièce jointe PRIVÉE d'un client : /api/media (public)
  renvoyait alors un lien valide vers ce fichier. Reproduit (réponse 200), corrigé : seules les photos
  publiques du site et des réalisations, dans les tailles prévues, sont re-signées (fichier privé : 401).
  Revu sans autre faille : connexion, sessions, double authentification, réinitialisation, droits
  client/équipe (devis, commandes, factures, reçus, inscriptions, fichiers, messagerie, profils, rôles),
  CSRF, XSS, SQL, CSP, secrets côté navigateur, abonnements aux notifications.
- **Bannière** : plus de visuel par défaut affiché avant les vraies photos (liste demandée dès le
  démarrage, gardée sur l'appareil, fond neutre en attendant ; visuels par défaut après 3 s sans réponse).
- **« Partager le site »** (tableau de bord client et équipe) : aperçu du lien, copie, partage du
  téléphone, WhatsApp, Facebook.
- Tests : régression complète, sécurité re-signature 5/5, sans flash 5/5 (v4.1.2 : 3 échecs),
  partage 60/60, connexion 78/78, bannière 12/12, secours 19/19, carrousel 33/33, 10 photos 15/15,
  en-tête 86/86, messagerie 63/63 et 35/35, admin 37/37 et 21/21, responsive 0 problème.

## v4.1.2 — Photos qui disparaissaient, fenêtre de connexion sur téléphone, aperçu des liens

- **Photos du site (bannière 2 et 3…)** : cause trouvée et reproduite. Dans « Images et bannières »,
  « Enregistrer » (pour changer une description) renvoyait l'adresse de la photo comme une adresse
  web ordinaire : le serveur détachait la photo de son fichier et SUPPRIMAIT ce fichier chez
  Cloudinary. La photo disparaissait ensuite (visuel par défaut). Corrigé : une adresse qui désigne
  une photo du site garde son fichier ; un fichier n'est jamais supprimé tant qu'un emplacement
  l'utilise. Les adresses Cloudinary enregistrées sont re-signées à l'affichage (clé régénérée sans
  effet). Une photo introuvable est signalée dans l'admin (« Renvoyez-la »).
  Réparation des données : db/reparation-photos.sql (rattache ce qui peut l'être, liste les photos à renvoyer).
- **Fenêtre de connexion sur téléphone** : depuis la v4.0, une règle du panneau de profil de la
  messagerie (même nom « sheet ») écrasait celle de la fenêtre : elle s'ouvrait en partie hors de
  l'écran (jusqu'à 800 px trop haut). Panneau renommé ; replis « vh » pour les navigateurs qui ne
  connaissent pas « dvh/svh » (Android et iOS plus anciens).
- **Aperçu des liens** (WhatsApp, Facebook, LinkedIn, X) : balises complétées sur les 31 pages
  (image sécurisée, type, texte alternatif, balises X). Fonctionne sur le domaine déclaré dans SITE_URL
  (sinon le domaine de production Vercel).
- Tests : connexion 78/78 (10 appareils, texte 130 %, ancien navigateur ; v4.1.1 : 20 échecs),
  bannière 12/12, secours 19/19, carrousel 33/33, 10 photos 15/15, aperçus 287/287 par domaine,
  régression complète, en-tête 86/86, messagerie 63/63 et 35/35, admin 37/37 et 21/21, responsive 0 problème.

## v4.1.1 — Bannière : une photo ne disparaît plus ; remise à zéro avant la production

- Bannière et images du site : quand une taille adaptée à l'écran est refusée par le navigateur ou
  par Cloudinary, l'image se rabat sur son adresse d'origine (celle d'avant la v4.1), puis sur le
  visuel par défaut ; une diapositive sans aucune image affichable est retirée du carrousel (plus
  de bannière vide). La console du navigateur indique l'adresse refusée (diagnostic).
  Tests : pannes Cloudinary simulées sur 4 écrans (19/19), carrousel 33/33, bannière 10 photos 15/15,
  navigateur phases 5 et 6, responsive 0 problème.
- db/reinitialisation-avant-production.sql : vide l'activité de test (commandes, devis, messages,
  notifications, inscriptions, journaux, numérotation) et garde le site, l'équipe et les comptes.
  Testé sur une copie : parcours devis → commande (CMD-2026-00001) et messagerie fonctionnent ensuite.

## v4.1.0 — Corrections : vocaux, barre de saisie, rapidité, fichiers, carrousel, responsive

Rapport complet (causes, corrections, fichiers, tests, restant à faire) : docs/CORRECTIONS-V4.1.md.
Migration 013 (additive) ; fichier prêt : db/mise-a-jour-v4.1.sql.

## v4.0.0 — Messagerie privée, profils, présence, vocaux, notifications, Google Authenticator

Cahier des charges « Restructuration des espaces client et administrateur ». Audit d'abord, puis
réutilisation de l'existant (fil d'assistance, SSE, Push, Cloudinary, sessions) : aucun second système.

- **Espaces réorganisés** : client (Tableau de bord, Messagerie, Mes devis, Mes commandes, Suivi des
  demandes, Mes formations, Mes documents, Notifications, Mon profil, Paramètres) ; administrateur
  (Tableau de bord, Gestion des clients, Messagerie, Gestion des devis, Gestion des commandes,
  Notifications, Profil administrateur, Paramètres) + « Gestion du site » (outils existants
  conservés). Anciennes adresses redirigées.
- **Messagerie** : conversation privée par client, bleu clair (moi) / gris (l'autre), heures,
  envoyé / reçu / lu, non lus, « écrit un message… », présence, historique progressif, photos,
  documents, messages vocaux. Voir docs/MESSAGERIE-V4.md.
- **Profils** : nom public, fonction, présentation de l'équipe visibles des clients ; profil du
  client visible de l'équipe ; dernière activité masquable.
- **Notifications** : invitation « Activer les notifications » (demande native seulement au clic,
  états default / granted / denied, aide pour réactiver), message vocal, alertes de sécurité.
- **Google Authenticator** obligatoire pour l'équipe en production, appareil de confiance 30 jours,
  codes de récupération, code redemandé dans les cas prévus, appareils révocables, alertes.
  Voir docs/DOUBLE-AUTHENTIFICATION.md.
- **Mot de passe** : bouton « œil » pour l'afficher ou le masquer dans tous les formulaires.
- Corrigés en route : le micro était interdit par l'en-tête Permissions-Policy (vocaux impossibles) ;
  la politique de sécurité (CSP) bloquait la lecture audio ; un fichier non encore envoyé était
  visible de l'équipe ; une conversation se rechargeait à chaque rafraîchissement du menu ; une
  coupure réseau pouvait faire planter la page de la messagerie (erreur affichée comme un objet).
- Vérifié : messagerie API 68/68 (dont compte base limité), Google Authenticator API 62/62 (dont
  Google + code, mode production), vecteurs TOTP RFC 6238, clé de chiffrement 5/5, navigateur à deux
  (client + admin, ordinateur, téléphone, tablette) 61/61, temps réel 8/8 (messages en moins d'une
  seconde), Push 41/41 et 17/17, mode Vercel 10/10, SQL d'installation 20/20, non-régression complète.
- Migration 012 (additive). Aucune nouvelle fonction Vercel (11/12).

## v3.10.1 — Carrousel d'accueil : jusqu'à 10 photos

- Diapositives 5 à 10 ajoutées dans « Images et bannières » (facultatives). Elles n'apparaissent sur l'accueil qu'une fois une photo ajoutée : jamais de diapositive vide. Leur légende sous le carrousel est la description saisie.
- « Retirer la photo » la fait disparaître de l'accueil sans laisser de trou. Les diapositives 1 à 4 gardent leur visuel provisoire.
- Téléphone : les traits du carrousel se partagent la largeur (10 tiennent dès 320 px), flèches de 44 px conservées.
- Vérifié dans un vrai navigateur (p19/hero10.py, 15/15) et non-régression site, responsive, en-tête, espace et SEO.

## v3.10.0 — Fichiers piégés : inspection du contenu et réencodage des photos

- Photos du site (réalisations, photos du site, photos de profil) : réencodées par Cloudinary dès leur arrivée (transformation signée). Le fichier gardé est une copie propre : ce qui était caché dedans ou collé derrière disparaît, avec les métadonnées (position GPS). Les pièces jointes des clients gardent leur original exact pour l'impression.
- Chaque fichier est relu en entier à la confirmation et inspecté (api/_lib/scan.js) : programme ou script caché dans une image, ZIP avec programme, double extension, autre archive, chemin « ../ », mot de passe, bombe de décompression ; Word/Excel/PowerPoint avec macros, objets intégrés ou modèle distant ; PDF/AI avec JavaScript (y compris caché dans un flux compressé ou sous un nom encodé), lancement de programme, fichiers joints ; EPS/AI avec commandes système ou fichiers.
- Fichier refusé : effacé du stockage, marqué « refusé », jamais téléchargeable ; message clair au client ; entrée « security.upload_blocked » dans le journal de sécurité de l'administrateur.
- Détails et limites (ce n'est pas un antivirus) : docs/AUDIT-SECURITE.md, section v3.10.0.

## v3.9.2 — Suite du scan Herozion (38 → 26 constats, 17 → 5 élevés)

- Réponses de l'API : plus aucun `select *`, colonnes explicites partout (connexion, sessions, reçus, attestations). La réponse de connexion donne le profil public complet, sans hachage.
- Journaux serveur masqués (e-mails, liens, jetons, chaînes de connexion) via `redact`/`logError`.
- Téléversements : liste blanche d'extensions et de types MIME dès la frontière de l'API (Zod) ; extension exécutable cachée dans le nom refusée ; 415 et 413 conservés.
- Temps réel : après une coupure, les vues ouvertes se relisent une fois (sans toucher aux formulaires en cours de l'équipe). Une relecture en arrière-plan qui échoue garde l'affichage au lieu d'afficher une erreur.

## v3.9.1 — Validation par schéma de toutes les entrées (scan Herozion)

- Chaque route déclare ses paramètres d'adresse dans un schéma Zod (`readQuery`). Corps, en-têtes Content-Length, IP, user-agent et Last-Event-ID passent aussi par Zod. Plus aucun `req.query` lu directement.
- Délai maximal sur tous les appels sortants (Google, Cloudinary, S3), anti-rafales en mémoire (300 requêtes/min/IP en ligne), chemin du stockage local confiné à son dossier.
- Détails : docs/AUDIT-SECURITE.md, section v3.9.1.

## v3.9.0 — Messagerie en temps réel et derniers points de sécurité

- Temps réel (Server-Sent Events) : messages, pastille de non lues, notifications, nouvelles commandes et changements de statut s'affichent en environ 1 s, sans recharger la page. Reconnexion automatique, aucun doublon, droits inchangés. Détails et limites de Vercel : docs/MESSAGERIE-TEMPS-REEL.md.
- Inscription sans révéler les adresses inscrites (quand les e-mails sont configurés) ; le lien de confirmation ouvre la session.
- Essais de mot de passe limités par compte + connexion : un tiers ne peut plus bloquer le titulaire.
- Signatures de l'API Cloudinary en SHA-256 (retour à SHA-1 possible).
- Compte de base limité eman_app (npm run db:app-role) ; DATABASE_URL_OWNER réservé aux migrations.
- Dependabot et npm run audit ; npm run push:export-keys pour sortir les clés VAPID de Neon sans désabonner les appareils.
- Migration 011 (additive) : une session peut aussi s'ouvrir par le lien de confirmation.

## v3.8.0 — Audit de sécurité approfondi

Les constats, leurs causes et les corrections sont dans docs/AUDIT-SECURITE.md.
- Entrées : caractères de contrôle refusés partout ; montants plafonnés à la capacité de la base ; dates entre 1900 et 2200 ; identifiants stricts. Les erreurs de données Postgres donnent un 400 neutre. Avant, 10 cas provoquaient une erreur 500.
- Téléversements : 30 envois non terminés au plus par compte, nettoyage quotidien automatique (Vercel Cron, CRON_SECRET), route de stockage local fermée en ligne.
- Données sensibles : le diagnostic public n'affiche que des oui/non ; erreurs 500 sans détail technique, avec une référence ; journaux sans valeurs Postgres.
- Divers : adresse du site non déduite de l'en-tête Host, IP fiable sur Vercel, seul le cookie __Host- est lu en HTTPS, plus de sel en clair dans le code, dépendances minimales alignées sur des versions corrigées.

## v3.7.0 — Rubrique Formation dynamique et modules de la fiche

- 7 modules de la fiche comparés aux formations en base. 5 existaient déjà et sont conservés tels quels ; 2 sont ajoutés (Community manager (CM), Secrétariat bureautique). Aucun doublon, aucune suppression, inscriptions intactes. L'import ne s'exécute qu'une fois (docs/FORMATIONS.md).
- Administration (même écran Formations, complété) :
  - plusieurs durées, avec un prix facultatif par durée ;
  - frais d'inscription, prix, frais supplémentaires, modalités de paiement ;
  - niveau requis et conditions d'admission, à ajouter, modifier ou supprimer.
  Les durées de la fiche se proposent en un clic. Rien n'est figé dans le code.
- Site public : la fiche d'une formation affiche les durées et prix, les frais et une section « Conditions d'admission » ; les cartes montrent la durée et les frais d'inscription.
- Contrôles : montants entiers positifs, listes limitées, titres en double refusés ; droit « formations » obligatoire.
- Migration 010 (additive). Les anciens champs durée et prérequis sont repris dans les nouvelles listes et restent tenus à jour.

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
