# Messagerie en temps réel (v3.9)

## 1. Ce qui causait le délai (analyse avant modification)

- **Conversations** (devis, commande, assistance) : elles n'étaient **jamais** relues automatiquement. Un message n'apparaissait qu'en rouvrant la conversation ou en rechargeant la page.
- **Compteur de non lues** (pastille du profil) : relu par **polling toutes les 60 secondes**, et seulement quand l'onglet était visible.
- **Web Push** : l'alerte du téléphone ou de l'ordinateur passe par les services de Google, Apple ou Mozilla, avec leur propre délai (souvent quelques secondes, parfois plus).

Le « 10 à 30 secondes » observé venait donc de la combinaison suivante : on attend la pastille (jusqu'à 60 s) ou la notification push, puis on ouvre la conversation à la main.

## 2. Choix de la technique

| Solution | Sur Vercel + Neon | Choix |
|---|---|---|
| WebSocket | Les fonctions Vercel ne peuvent pas héberger de serveur WebSocket. Il faudrait un service externe (Pusher, Ably…), en général payant au-delà d'un quota. | ✗ |
| Polling rapide (toutes les 2–3 s) | Fonctionne, mais lance une fonction Vercel toutes les 2–3 s par onglet ouvert (environ 10 000 appels par jour et par onglet). | ✗ |
| **Server-Sent Events (SSE)** | Les fonctions Node de Vercel savent envoyer une réponse en continu. Le navigateur (EventSource) se reconnecte tout seul et reprend là où il s'était arrêté. Une seule fonction tourne par onglet, pendant 4 min 30, puis elle est relancée. | ✓ |
| LISTEN/NOTIFY de Postgres | Le pilote HTTP de Neon ne le permet pas. | ✗ |

La fonction SSE interroge donc la base toutes les 1,2 s avec une seule requête très légère, qui s'appuie sur l'index `notifications_user_created_idx`.

## 3. Fonctionnement

1. Quand quelqu'un écrit, le code existant crée déjà une **notification interne** pour le bon destinataire (client, ou équipe ayant le droit), puis un **Web Push**. Rien de cela n'a changé.
2. Chaque onglet connecté ouvre `GET /api/inbox?stream=1`. Le flux envoie les nouvelles notifications **de la personne connectée uniquement**, avec son nombre de non lues.
3. À la réception :
   - la pastille et la liste des notifications se mettent à jour ;
   - la conversation ouverte qui est concernée **se recharge par l'API habituelle**, qui revérifie les droits ;
   - les listes Commandes et Devis, côté équipe, se mettent à jour ;
   - la fiche d'une commande ou d'un devis, côté client, aussi ;
   - un petit message s'affiche.
4. **Aucun contenu de message ne passe par le flux.** Un client ne peut donc rien voir d'une conversation qui n'est pas la sienne : c'est le même contrôle que sans le temps réel.

**Pas de doublon :**
- la conversation est remplacée en entier à chaque rechargement, sans ajout ligne par ligne ;
- chaque notification porte un identifiant, et le navigateur ignore celles déjà vues ;
- à la reconnexion, la dernière reçue n'est pas renvoyée.

**Reconnexion automatique :**
- EventSource reprend tout seul avec `Last-Event-ID` ;
- en cas de refus (serveur indisponible), il réessaie de plus en plus espacé, jusqu'à 30 s ;
- en attendant, le compteur est relu toutes les 20 s ;
- au retour du réseau ou de l'onglet, il rattrape ce qui a été manqué.

**Économies :**
- un onglet caché depuis 30 s ferme son flux, puis le rouvre dès qu'il redevient visible ;
- la relecture lente du compteur (60 s) reste en place comme filet de sécurité.

**Sécurité :**
- connexion obligatoire ;
- le flux s'arrête si la session est fermée (déconnexion, mot de passe changé) ou si le compte est désactivé, avec une vérification toutes les 30 s ;
- 120 ouvertures de flux par heure au maximum.

## 4. Résultats mesurés (tests réels, deux navigateurs ouverts en même temps)

| Situation | Délai |
|---|---|
| Client → admin, conversation d'assistance ouverte | **1,3 s** |
| Admin → client (téléphone) | **0,7 s** |
| Nouvelle commande d'un client → liste de l'admin | **0,9 s** |
| Coupure réseau côté admin, message envoyé pendant la coupure | Rattrapé dès le retour du réseau, sans doublon |

Le délai vient surtout de l'intervalle de lecture de la base (1,2 s) : 0,6 s en moyenne.

## 5. Limites de Vercel et de Neon

- **Durée d'une fonction** : 300 s au maximum sur l'offre Hobby (réglé dans `vercel.json`). Le flux se termine à 270 s et le navigateur se reconnecte aussitôt, de façon invisible.
- **Coût** : chaque onglet ouvert et visible occupe une fonction. Avec la facturation Vercel « Fluid compute », l'attente coûte peu de calcul, mais la durée compte.
- **Neon** : tant qu'un onglet est ouvert, la base reçoit une requête par seconde et ne se met pas en veille. Sur l'offre gratuite, cela consomme des heures de calcul. Un onglet caché se déconnecte après 30 s, pour limiter cette consommation.
- **Réglages possibles** : `LIVE_TICK_MS` (1 200 par défaut) et `LIVE_MAX_SECONDS` (270).
- **Un message pendant une coupure** n'apparaît qu'au retour du réseau. C'est le comportement normal.
- **Le Web Push reste en place.** Si la page est ouverte et visible, l'appareil peut afficher aussi l'alerte système : c'est voulu, pour ne pas toucher au Web Push existant.

## Fichiers

- `api/_lib/services/live.js` (nouveau) : le flux SSE.
- `api/inbox.js` : la route `GET ?stream=1`.
- `vercel.json` : durée maximale de 300 s pour `api/inbox.js`.
- `src/lib/live.js` (nouveau) : connexion, reconnexion, suppression des doublons, relecture de secours.
- `src/App.jsx` : démarrage du temps réel, pastille, petit message.
- `src/pages/requests.jsx` : conversations, listes et fiches.
- `src/pages/space/client.jsx` : assistance côté client, notifications.
- `src/pages/space/team.jsx` : liste des conversations d'assistance.
