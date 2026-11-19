# Historique des versions et des vérifications

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
