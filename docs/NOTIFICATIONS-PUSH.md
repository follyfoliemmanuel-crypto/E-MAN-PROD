# Notifications push (v3.6)

Les clients et l'équipe peuvent recevoir une alerte sur leur téléphone ou leur ordinateur, même quand le site est fermé.
Le push **s'ajoute** aux notifications dans l'espace et aux e-mails, il ne les remplace pas. On ne paie aucun service : c'est le standard Web Push, et les services push de Google, Mozilla, Apple et Microsoft sont gratuits.

## Comment ça marche

1. Dans son espace, rubrique **Notifications**, l'utilisateur clique sur **Activer sur cet appareil**. Le navigateur lui demande son autorisation.
2. L'appareil est enregistré dans Neon (table `push_subscriptions`) et rattaché au **compte connecté**. Le navigateur ne choisit jamais à quel compte l'appareil appartient.
3. Chaque fois qu'une notification est créée dans l'espace de quelqu'un (`notifyUser` / `notifyTeam`), le serveur envoie aussi un push à **tous les appareils de cette personne, et à elle seule**. Les règles d'accès sont les mêmes que pour la cloche : par exemple, un STAFF sans le droit « commandes » ne reçoit pas les nouvelles commandes.
4. Quand on clique sur la notification, la bonne page d'E-MAN PROD s'ouvre (commande, devis, message…).

| Pour les clients | Pour l'administration et le STAFF concerné |
|---|---|
| Nouveau message de l'équipe | Nouvelle commande à confirmer |
| Devis prêt, devis mis à jour | Nouvelle demande de devis |
| Commande bien reçue, confirmée, en cours, prête, livrée, annulée | Un client a accepté ou refusé un devis |
| Facture disponible, paiement enregistré | Nouveau message d'un client |
| Formation, annonce importante | Nouveau client, inscription, avis à valider… |

**Écran verrouillé :** le texte reste générique. Exemples : « E-MAN PROD — Votre commande est confirmée », « Nouvelle commande à confirmer ». Il n'y a jamais de nom, de montant, de numéro, de téléphone ni d'e-mail. Le détail s'affiche seulement dans l'espace, après connexion.

## Configuration

**Rien n'est obligatoire.** Au premier usage, le site crée lui-même une paire de clés VAPID et la garde dans Neon (table `push_keys`). Seul le serveur la lit, et la clé privée n'est jamais envoyée au navigateur.

Si vous préférez gérer vous-même les clés dans Vercel (conseillé si vous changez un jour de base de données) :

```bash
npm run push:keys
```

Copiez les 3 lignes affichées dans Vercel (**Settings → Environment Variables**, environnement *Production*), puis redéployez :

| Variable | Rôle |
|---|---|
| `VAPID_PUBLIC_KEY` | clé publique (envoyée aux navigateurs) |
| `VAPID_PRIVATE_KEY` | clé privée : **secrète**, ne jamais la publier |
| `VAPID_SUBJECT` | contact pour les services push, par exemple `mailto:emanprod3@gmail.com` |

⚠ Changer de clés désabonne tous les appareils : chacun devra réactiver les notifications.

**Base de données :** la migration `009_push.sql` s'applique toute seule au déploiement si `DATABASE_URL` est défini en production. Sinon, lancez `db/install-neon.sql` dans Neon : il n'applique que ce qui manque.

## Navigateurs

| Appareil | Ce qu'il faut |
|---|---|
| Android (Chrome, Edge, Samsung Internet, Firefox) | Rien de spécial |
| Ordinateur (Chrome, Edge, Firefox, Safari 16+) | Rien de spécial |
| **iPhone / iPad** (iOS 16.4 ou plus récent) | Ajoutez d'abord le site à l'écran d'accueil : bouton **Partager**, puis **Sur l'écran d'accueil**. Ouvrez E-MAN PROD depuis cette icône, puis activez les notifications. Le site l'explique lui-même à l'utilisateur. |

Si l'utilisateur a bloqué les notifications, le site lui explique comment les réautoriser.

## Test en vrai, une fois déployé (2 minutes)

1. Ouvrez le site **en ligne** (https) sur votre téléphone. Connectez-vous et allez dans **Notifications**. Cliquez sur **Activer sur cet appareil**, puis acceptez.
2. Cliquez sur **Envoyer une notification d'essai** : « Notification d'essai : tout fonctionne sur cet appareil » doit apparaître.
3. Fermez complètement le navigateur. Depuis l'ordinateur, avec le compte admin, faites changer le statut d'une commande de ce client. La notification arrive sur le téléphone. Touchez-la : la commande s'ouvre.
4. Faites la même chose dans l'autre sens : un client passe commande, et l'admin reçoit « Nouvelle commande à confirmer ».
5. Cliquez sur **Désactiver sur cet appareil**, puis refaites l'étape 3 : plus rien n'arrive sur le téléphone.

## Sécurité

- L'appareil est toujours rattaché au compte de la session. Un client ne peut ni s'abonner aux notifications d'un autre, ni retirer l'appareil d'un autre.
- Le serveur n'envoie de requêtes **qu'aux services push officiels** (Google, Mozilla, Apple, Microsoft). Une adresse inventée par le navigateur est refusée.
- Les abonnements expirés (réponse 404 ou 410 du service push) sont supprimés automatiquement. Les erreurs passagères sont comptées, et l'appareil est retiré après 15 échecs d'affilée.
- Un compte désactivé ne reçoit plus rien.
- À la **déconnexion**, l'appareil est désabonné : sur un appareil partagé, la personne suivante ne reçoit pas les notifications de l'ancien compte. Il est réabonné automatiquement à la reconnexion, si la personne l'avait activé.
- Si quelqu'un d'autre se connecte sur le même appareil et active les notifications, l'appareil passe à son compte.
- Un compte peut avoir jusqu'à 10 appareils. Au-delà, le plus ancien laisse sa place.
- Le service worker (`/sw.js`) ne gère que les notifications : il ne met rien en cache et n'intercepte aucune requête. Le site fonctionne exactement comme avant.
