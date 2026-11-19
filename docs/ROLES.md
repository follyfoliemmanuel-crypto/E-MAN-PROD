# Rôles et permissions

Trois rôles existent : **ADMIN**, **STAFF** et **CLIENT**. Le rôle et les droits sont lus en base à chaque requête : le navigateur ne peut ni les choisir ni les modifier (testé : en-têtes, cookies et champs falsifiés sont sans effet).

## Les trois rôles

| Rôle | Pour qui | Accès |
|---|---|---|
| **ADMIN** | Direction d'E-MAN PROD | Tout : équipe, paramètres, annonces, journal de sécurité, historique des collaborateurs, et tous les domaines ci-dessous |
| **STAFF** | Collaborateurs de l'atelier | Uniquement les domaines cochés par l'admin (tableau ci-dessous) |
| **CLIENT** | Toute personne qui crée un compte | Uniquement ses propres demandes, commandes, inscriptions, documents, notifications et messages |

## Droits du STAFF (cumulables)

| Droit | Ce qu'il ouvre |
|---|---|
| `quotes` — Devis | Liste des devis, chiffrage, envoi, PDF, messages des devis, transformation en commande |
| `orders` — Commandes | Commandes : statuts, lignes, collaborateur affecté, commentaires internes, **paiements, reçus et factures** |
| `trainings` — Formations | Formations, sessions, inscriptions, apprenants, **appel, résultats, supports de cours, attestations** |
| `content` — Contenu | Prestations, réalisations, images et bannières, textes du site (sauf textes officiels et coordonnées), avis |
| `clients` — Fiches clients | Liste et recherche des clients, fiche avec historique, notes internes |
| `support` — Assistance | Conversations d'assistance de tous les clients |

Le tableau de bord d'un STAFF n'affiche que les statistiques de ses domaines.

## Réservé à l'ADMIN

- **Équipe** : inviter un collaborateur, lui donner ou retirer des droits, le désactiver, consulter l'historique de ses actions.
- **Paramètres** : coordonnées, numéros WhatsApp, réseaux sociaux, informations légales, conditions des devis et factures, modèles d'e-mails, notifications.
- **Annonces** : publier une information importante pour tous les clients.
- **Textes officiels** du site (accueil, à propos, E-MAN CARS).
- Changer le rôle d'un compte. Un admin ne peut pas changer son propre rôle.

## Ce que voit un CLIENT

- Ses devis (PDF dès l'envoi par l'atelier), qu'il peut accepter ou refuser.
- Ses commandes : avancement, paiements enregistrés, reçus, factures, bon de commande.
- Ses inscriptions : présences, supports de la session (place confirmée), attestation.
- Ses documents, notifications, conversation d'assistance, profil, sessions ouvertes.
- Il ne voit **jamais** : les notes internes, les commentaires internes des commandes, le collaborateur affecté, les données d'un autre client (réponse « introuvable », sans indiquer que la ressource existe).

## Règles de gestion des comptes

- **Premier administrateur** : créer son compte sur le site, puis `npm run db:admin -- email@exemple.com`.
- **Collaborateurs** : Espace → Équipe → Inviter. La personne reçoit un lien (72 h, usage unique) pour choisir son mot de passe ; sans e-mail configuré, le lien s'affiche pour être transmis par WhatsApp.
- Retirer un droit ou désactiver un compte **ferme immédiatement** ses sessions.
- Un compte désactivé ne peut plus se connecter ; ses données restent conservées.
- Pour rejoindre l'équipe, un compte existant doit avoir confirmé son adresse e-mail.

## Vérifications effectuées (phase 8)

Une matrice de 6 profils (visiteur, client propriétaire, autre client, STAFF « assistance », STAFF « commandes + formations », ADMIN) a été testée sur 22 ressources en lecture et 15 actions en écriture : 82 contrôles, tous conformes. Détail dans `docs/RAPPORT-PHASE-8.md`.
