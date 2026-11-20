# Audit de sécurité v3.8 (20 novembre 2026)

Audit fait sur le code lui-même, sans accès aux 36 détails verrouillés du rapport Herozion v2.0.20.

**Méthode :**
- Lecture des 11 routes `/api` et de leurs services.
- Sonde automatique (`p16/probe.mjs`) qui envoie 39 entrées limites aux routes. Une réponse 500, ou un message d'erreur technique, compte comme un échec.
- Tests ciblés des téléversements et du mode « en ligne » (VERCEL=1).
- Régression complète.

## 1. Validation des entrées

| # | Constat (vérifié par un test qui échouait avant la correction) | Cause | Correction |
|---|---|---|---|
| V1 | Un caractère nul (`\u0000`) dans un texte provoquait une **erreur 500**. 7 routes étaient touchées : devis, inscription, connexion, inscription à une formation, message, profil, abonnement push. | Postgres refuse ce caractère ; aucune règle ne le filtrait avant la base. | Contrôle commun dans `readJson` (`api/_lib/http.js`), qui vaut pour toutes les routes. Il refuse en 400 les caractères de contrôle invisibles et les caractères de direction du texte, utilisés pour masquer du contenu. La même règle s'applique aux paramètres d'adresse. La profondeur du JSON est limitée à 8, et un corps de requête qui n'est pas un objet est ignoré. |
| V2 | Montant de 5 milliards (prix, frais d'inscription, prix par durée) : **erreur 500**. | La limite de validation (100 milliards) dépassait la capacité des colonnes `integer`. | `fcfa()` est plafonné à 2 milliards (`schemas.js`). Le montant d'un paiement aussi (`documents.js`). |
| V3 | Date « 0000-01-01 » : **erreur 500**. | L'année 0 n'existe pas dans Postgres. | `validDay()` accepte un vrai jour entre 1900 et 2200 (`schemas.js`), utilisé aussi par `validate.js`. |
| V4 | Identifiant fait de 36 tirets : **erreur 500** (photo du site). | L'ancienne règle `validate.uuid` était trop permissive. | Format UUID strict. |
| V5 | L'ancienne règle `validate.date` acceptait le 31 février. | `Date.parse` corrige la date au lieu de la refuser. | Même contrôle `validDay()`. |
| V6 | L'ancienne règle `validate.password` acceptait 8 caractères, alors que la règle du site est de 10. | Deux règles différentes pour la même chose. | Alignée sur 10. |
| V7 | Filet de sécurité pour toute donnée encore refusée par Postgres. | — | Codes 22P02, 22003, 22007/22008, 22021, 22001, 23505, 23503 et 23514 renvoyés en 400 ou 409 avec un message neutre, sans détail technique. |

Contrôles **déjà corrects**, vérifiés sans changement :
- toutes les requêtes SQL sont paramétrées (les seuls morceaux insérés dans le texte SQL sont des noms de colonnes fixes du code) ;
- une injection SQL dans la recherche reste sans effet ;
- `__proto__` dans le JSON est sans effet ;
- les rôles et les prix ne sont jamais lus dans la requête.

## 2. Téléversements

| # | Constat | Correction |
|---|---|---|
| U1 | Un compte pouvait préparer des envois sans jamais les confirmer, dans la limite de 40 par heure. Les fichiers non vérifiés restaient chez Cloudinary jusqu'à un nettoyage manuel. | 30 envois non terminés au maximum par compte et par 24 h (429 au-delà). Un **nettoyage automatique quotidien** passe par Vercel Cron (`vercel.json`, route `/api/files?cron=cleanup`), protégé par `CRON_SECRET` avec une comparaison en temps constant. Sans secret, la route répond 404. |
| U2 | La route de lecture du stockage local de développement (`?local=get`) restait joignable en ligne, même protégée par signature. Elle renvoyait le type de fichier annoncé, sans liste blanche. | Fermée sur Vercel (404). En local : type limité aux formats acceptés, affichage dans le navigateur réservé aux images, en-tête `CSP: sandbox`. |

Protections **déjà en place**, retestées dans `p16/uploads.mjs` (10/10) et dans les suites Cloudinary (103 + 16) :
- liste blanche d'extensions : `.php` et `.png.html` sont refusés ;
- type annoncé cohérent avec l'extension ;
- taille plafonnée ;
- signature Cloudinary qui fixe l'identifiant, le type, les formats et l'interdiction d'écraser ;
- vérification après envoi de la taille réelle, du format décodé et des premiers octets du fichier ;
- fichiers privés en type `authenticated` avec liens de 5 minutes ;
- nom de fichier nettoyé et jamais utilisé comme clé de stockage ;
- droits vérifiés sur le devis ou la commande ;
- un fichier d'un autre compte répond 404.

## 3. Exposition de données sensibles

| # | Constat | Correction |
|---|---|---|
| S1 | `/api/auth/status` (public) montrait à n'importe qui les noms des variables manquantes, la version du schéma, le domaine d'envoi des e-mails et l'adresse de retour Google. | En ligne, un visiteur ne voit que des oui/non. Le détail est réservé à l'administrateur connecté. |
| S2 | Hors Vercel, une erreur 500 renvoyait le message technique (par exemple « invalid byte sequence… »). Les journaux recevaient l'objet d'erreur complet : une erreur Postgres peut contenir des valeurs (champ `detail`). | Message neutre avec une **référence** courte. Le journal est structuré (référence, route, code, message tronqué, 6 lignes de pile) et ne contient pas le `detail` Postgres. Le message technique n'apparaît qu'en local, sur demande (`DEBUG_ERRORS=1`). |
| S3 | Sur l'abonnement push, une erreur de clés VAPID était renvoyée telle quelle aux utilisateurs. | Le message d'erreur des clés VAPID est désormais remplacé par un texte neutre ; le détail ne part que dans le journal. |

Déjà correct :
- notes internes et personne assignée retirées des réponses aux clients ;
- réglages publics filtrés par liste blanche ;
- e-mails masqués dans le journal de sécurité ;
- adresse IP hachée ;
- texte des notifications push générique ;
- aucun secret côté navigateur (le diagnostic signale toute variable `VITE_*SECRET*`).

## 4. Autres risques

| # | Constat | Correction |
|---|---|---|
| A1 | Quand `SITE_URL` est absent, l'adresse du site était déduite de l'en-tête `Host`, qui peut être falsifié. Cette adresse sert au lien de vérification des attestations et à l'adresse de retour Google. | En production, l'adresse vient de `VERCEL_PROJECT_PRODUCTION_URL`. Ailleurs, l'en-tête Host est contrôlé. Les liens des e-mails passaient déjà par une adresse tirée de la configuration. |
| A2 | L'IP des limites anti-abus était lue dans `x-forwarded-for`, et `x-forwarded-for` brut dans la vérification d'attestation. | Sur Vercel, `x-real-ip` (posé par la plateforme), et une seule fonction `clientIp` partout. |
| A3 | En HTTPS, le cookie de session sans préfixe était encore lu en secours. | En HTTPS, seul `__Host-emp_session` est lu, ce qui protège contre l'injection d'un cookie de session depuis un autre site du même domaine. |
| A4 | Sel de secours écrit en clair dans le code pour le hachage des IP. | Le secours est dérivé d'une valeur connue du seul serveur ; il n'y a plus de constante. |
| A5 | `Math.random` utilisé pour le ménage des tables (sans enjeu de sécurité). | Remplacé par `crypto.randomInt`. |
| A6 | `package.json` autorisait des versions de dépendances plus anciennes que celles installées, dont Vite 6.0.x, touché par des failles connues. | Versions minimales alignées sur celles installées, qui sont corrigées : vite ^6.4.6, pg ^8.23.1, @neondatabase/serverless ^1.2.1… `npm audit` n'a pas pu tourner : l'accès réseau est coupé ici. |

Déjà en place et vérifié :
- mots de passe en Argon2id ;
- sessions HttpOnly, SameSite=Lax, Secure, préfixe `__Host-`, rotation toutes les 24 h, expiration après 14 jours d'inactivité, 10 sessions au plus par compte ;
- sessions fermées après un changement ou une réinitialisation de mot de passe ;
- limites anti-abus sur la connexion, l'inscription, le mot de passe oublié, les devis, les inscriptions et les messages ;
- CSRF (en-tête Origin, Sec-Fetch-Site, JSON obligatoire) ;
- Google OAuth avec state lié au navigateur, PKCE, nonce et vérification de la signature du jeton ;
- CSP stricte, HSTS, X-Frame-Options, COOP, Permissions-Policy ;
- droits admin/staff/client vérifiés côté serveur à chaque requête ;
- 404 plutôt que 403 sur les ressources d'autrui.

## Points restants de la v3.8, traités en v3.9

| Point | Traitement | Vérifié par |
|---|---|---|
| Inscription : « un compte existe déjà » révélait les adresses inscrites | Quand les e-mails fonctionnent, la réponse est **identique** que l'adresse soit libre ou déjà prise : même code 202, même forme, même durée (mot de passe haché dans les deux cas). Le compte ne s'ouvre qu'avec le lien reçu, qui ouvre aussi la session. Une adresse déjà inscrite reçoit dans **sa** boîte un rappel « vous avez déjà un compte », et son mot de passe n'est pas touché. Sans fournisseur d'e-mails, le comportement reste celui d'avant, sinon personne ne pourrait s'inscrire. | `p7/p7test.mjs` : mêmes réponses, durées comparables, rappel envoyé, aucun compte créé |
| Blocage d'un compte par un tiers (8 essais en 15 min) | La limite porte désormais sur le couple **compte + connexion**. L'attaquant est bloqué ; le vrai titulaire se connecte normalement depuis chez lui. Un plafond large par compte (60 par heure) freine les attaques réparties sur beaucoup d'adresses IP. | `p16/lockout.mjs` (4/4) |
| Signatures Cloudinary en SHA-1 | Les appels à l'API (envois, téléchargements privés, inspection, suppression) sont signés en **SHA-256**, que Cloudinary accepte par défaut. `CLOUDINARY_SIGNATURE_ALGORITHM=sha1` permet de revenir en arrière si un compte le refusait. Les adresses de livraison signées restent au format court de Cloudinary : le format long en SHA-256 se règle dans le compte Cloudinary. | `p16/cloud_sig.mjs` (4/4), suites Cloudinary |
| Base Neon avec un seul compte propriétaire | `npm run db:app-role` crée le compte **eman_app**. Il peut lire et écrire des lignes, mais ne peut ni créer, ni modifier, ni supprimer une table. Les tables créées plus tard par les migrations lui sont ouvertes automatiquement. `DATABASE_URL_OWNER` (le propriétaire) ne sert plus qu'aux migrations au déploiement. | Création de table, `drop table` et `alter table` refusés ; 6 suites (225 tests) passent avec ce compte |
| `npm audit` impossible ici | Script `npm run audit` et surveillance **Dependabot** (`.github/dependabot.yml`) : alerte automatique et proposition de mise à jour dès qu'une faille connue touche une dépendance. | À lancer de votre côté (réseau) |
| Clés VAPID gardées dans Neon | `npm run push:export-keys` sort la **même** paire de la base, pour la mettre dans Vercel sans désabonner aucun appareil. Une fois les clés présentes dans Vercel, le site efface tout seul la copie gardée dans Neon. | Test : même clé publique servie, copie effacée de la base |

## Risques restants (choix assumés ou hors code)

- Sans fournisseur d'e-mails configuré, l'inscription peut toujours révéler qu'une adresse existe : il n'y a alors aucun autre moyen de confirmer une adresse.
- Il faut lancer `npm audit` et activer Dependabot sur votre dépôt GitHub.
- Les adresses de livraison signées de Cloudinary restent en SHA-1 court, sauf si le format long est activé dans le compte Cloudinary.
