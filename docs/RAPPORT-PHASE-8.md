# Rapport final — phase 8 : audit, tests, optimisation, déploiement

Version 3.0.0 · 19 novembre 2026

## En bref

Les fonctionnalités essentielles marchent toutes et ont été testées avec les rôles ADMIN, STAFF et CLIENT. Au total, 1 071 contrôles automatisés passent, sans aucun échec. L'audit a trouvé et corrigé 10 problèmes réels.

**La plateforme est prête pour la mise en production, sous deux réserves :**
- les services externes doivent être configurés par E-MAN PROD (domaine, Vercel Pro, Neon, Google, e-mails, stockage) ;
- le premier build réel doit être contrôlé avec la liste de [DEPLOIEMENT.md](DEPLOIEMENT.md). Cet environnement n'avait pas d'accès réseau pour installer Vite et les dépendances officielles.

Le projet ne doit donc pas être considéré comme « en ligne et terminé » avant ces vérifications.

## 1. Fonctionnalités opérationnelles

| Domaine | Fonctionnalités |
|---|---|
| Site public | Accueil, prestations et fiches, centre de formation (pôles, fiches, sessions, places), réalisations, à propos, E-MAN CARS, contact, mentions légales, confidentialité, vérification des attestations, page introuvable |
| Formulaires | Demande de devis (avec ou sans compte), inscription à une formation, consentement obligatoire, téléphone normalisé (+228) |
| Comptes | Inscription, connexion, déconnexion, confirmation d'adresse, mot de passe oublié, sessions (liste, fermeture), Argon2id, limitation des tentatives |
| Espace client | Accueil, devis (demande, fichiers, PDF, acceptation, refus), commandes (suivi, paiements, reçus, facture, bon de commande), formations (présences, supports, attestation), documents, notifications, assistance, profil et photo, préférences e-mail |
| Espace de gestion | Statistiques réelles, clients, devis, commandes, paiements et factures, inscriptions, formations, sessions, appel, attestations, réalisations, prestations, images, textes, annonces, assistance, équipe, paramètres |
| Documents | PDF de devis, bon de commande, facture (état calculé à partir des paiements), reçu, feuille de présence, attestation ; numérotation DV-, CMD-, FAC-, REC-, ATT- |
| Base de données | Migrations 001 → 006 transactionnelles, sauvegarde JSON, **restauration testée** |

## 2. Fonctionnalités partiellement opérationnelles

| Fonctionnalité | Ce qui manque |
|---|---|
| E-mails | Code complet et testé contre un faux fournisseur ; aucun envoi réel tant que Resend ou Brevo n'est pas configuré. Les notifications dans les espaces fonctionnent sans eux. |
| Fichiers joints en ligne | Fonctionnent en local (dossier `.uploads/`) ; en ligne, il faut un stockage S3/R2, sinon l'envoi est désactivé et le site propose WhatsApp. |
| Connexion Google | Testée contre un faux serveur Google qui signe de vrais jetons ; identifiants réels à créer. |
| Paiements | Enregistrés à la main par l'équipe, avec reçu. Pas de paiement en ligne (Mobile Money) intégré. |
| SEO des nouvelles fiches | Les fiches créées dans l'admin après le build sont servies par la page générique, puis titrées dans le navigateur ; elles sont prérendues au build suivant. |

## 3. Fonctionnalités nécessitant une configuration externe

Domaine et HTTPS (Vercel), offre **Vercel Pro** (l'offre Hobby est limitée à un usage non commercial), base Neon de production, identifiants Google OAuth, fournisseur d'e-mails avec domaine vérifié, stockage Cloudflare R2. Puis, dans Paramètres : numéros WhatsApp officiels, réseaux sociaux, informations légales, conditions des devis, moyens de paiement. Étapes : [CONFIGURATION.md](CONFIGURATION.md) et [DEPLOIEMENT.md](DEPLOIEMENT.md).

## 4. Résultats des tests

| Suite | Résultat |
|---|---|
| API phases 1 à 6 (site, fichiers, catalogue, backend, sécurité, espaces) | 42 + 18 + 30 + 137 + 115 + 114 = **456 / 456** |
| API phase 7 (notifications, e-mails, PDF, factures, formations, paramètres) | **147 / 147** |
| Fournisseurs d'e-mails (Resend, Brevo, échecs) | **7 / 7** |
| **Sécurité phase 8** : 6 profils × 22 lectures et 15 écritures, CSRF, injections, fichiers, sessions, en-têtes | **82 / 82** |
| Navigateur phases 5, 6, 7 (parcours ADMIN, STAFF, CLIENT, mobile) | 25 + 58 + 51 = **134 / 134** |
| **Site public phase 8** : toutes les pages par exploration des liens, liens externes, sitemap, navigation, formulaires | **54 / 54** |
| **Responsive phase 8** : 5 appareils × site, espace client, espace admin | **156 / 156** |
| **SEO phase 8** : 29 pages prérendues | **35 / 35** |
| Sauvegarde puis restauration (43 627 lignes, 34 tables) | 33 tables de données identiques (empreinte md5) |

Les tests n'ont jamais touché à des données réelles : ils tournent sur une base PostgreSQL de test recréée à chaque passage.

## 5. Problèmes corrigés pendant l'audit

1. **Sécurité** : sur Vercel, le corps des requêtes est lu par la plateforme (jusqu'à 4,5 Mo) et la limite de 64 Ko de l'application n'était plus appliquée. Elle est maintenant vérifiée dans tous les cas (413).
2. **Sécurité / affichage** : l'aperçu des e-mails dans Paramètres aurait été affiché sans style en production. La CSP l'aurait bloqué ; ce n'était visible qu'avec les en-têtes réels. La CSP autorise désormais uniquement les attributs `style` (directive `style-src-attr`), jamais les scripts en ligne.
3. **Local** : la route `/api/documents` manquait au serveur de `npm run dev`. Factures, reçus et attestations échouaient en local. Les routes locales sont maintenant générées à partir du dossier `/api`.
4. **Sauvegarde** : aucune restauration n'existait. La nouvelle commande `npm run db:restore` refuse une base non vide, gère les références circulaires et contrôle les comptes de lignes.
5. **Performances** : tout le code des espaces (environ 40 % du JavaScript) était téléchargé par chaque visiteur. Il est maintenant chargé à la demande : 140 → 98 Ko compressés sur le site public.
6. **Performances** : décalages de mise en page pendant le chargement (CLS 0,52 sur une fiche formation, 0,16 sur les prestations). Ils sont à 0 désormais.
7. **SEO** : le domaine était codé en dur et le sitemap pouvait annoncer une autre adresse que les URL canoniques. `/verifier` portait la balise `noindex`. Des descriptions étaient trop courtes et des titres trop longs. Les données structurées des fiches manquaient.
8. **Accessibilité mobile** : textes en 11,5 px et liens tactiles trop petits (« Revenir en haut », itinéraires, téléphone). Les textes font désormais au moins 12 px et les cibles 44 px.
9. **Build** : trois icônes portaient d'anciens noms Lucide (`AlertTriangle`, `BarChart3`, `CheckCircle2`), un risque de build cassé. Elles sont renommées.
10. **Git** : le projet n'était pas versionné. Le dépôt est créé, avec l'étiquette `v2.8.0` (point de sauvegarde), puis la branche `phase-8-audit`. Le `.gitignore` est renforcé (`.env.*`, sauvegardes, journaux) et le code ne contient aucun secret.

## 6. Problèmes restants (à traiter ou à vérifier)

| Point | Niveau | Action |
|---|---|---|
| Le build Vite officiel et le pilote Neon n'ont pas pu être exécutés ici (pas de réseau) : le build a été reproduit avec esbuild, et les noms d'icônes vérifiés un par un | À vérifier | `npm install && npm run build` sur le PC ou le premier déploiement Vercel, puis la liste de contrôle de DEPLOIEMENT.md |
| `npm audit` non exécuté (pas de réseau) | À vérifier | Lancer `npm audit` après `npm install`, puis enregistrer `package-lock.json` dans Git |
| Polices en WOFF (le convertisseur WOFF2 n'était pas disponible ici) | Mineur | Convertir en WOFF2 pour gagner environ 30 % sur les polices |
| Web Vitals mesurés en laboratoire seulement | Info | Suivre les données réelles dans Google Search Console après l'ouverture |
| Pas de double authentification pour les comptes de l'équipe | À décider | Envisageable en évolution |
| Pas de paiement Mobile Money en ligne | À décider | Évolution possible (T-Money, Flooz) |
| Déclaration IPDCP (loi n° 2019-014) | À vérifier par E-MAN PROD | |
| Décisions ouvertes des phases précédentes | À décider | Stockage R2 ou Cloudinary, création automatique ou manuelle des commandes, service « Informatique et réseaux », durées de session |

## 7. État de la sécurité

- **Accès** : rôle et droits lus en base à chaque requête. Un client ne voit jamais les données d'un autre ; la réponse est « introuvable », sans révéler l'existence de la ressource. Les champs, en-têtes et cookies falsifiés sont sans effet (testé).
- **Sessions** : jeton aléatoire, empreinte seule en base. Cookie `HttpOnly`, `SameSite=Lax`, `__Host-` et `Secure` en HTTPS. 30 jours maximum, renouvellement quotidien, révocation à la déconnexion, au changement de droits ou à la désactivation.
- **Mots de passe** : Argon2id, politique de 10 caractères, mêmes messages pour un compte inconnu ou un mauvais mot de passe. Blocage après 8 essais par compte et 30 par adresse IP.
- **Entrées** : validation Zod sur toutes les API. SQL toujours paramétré ; les seuls fragments dynamiques sont des noms de colonnes tirés de listes fixes (revue du code). Limite de 64 Ko par requête.
- **Fichiers** : extension, type, taille et contenu réel vérifiés. SVG refusé. Exécutable déguisé refusé puis effacé. Chemins neutralisés. Liens signés de 5 minutes.
- **En-têtes** : CSP sans script en ligne ni `eval`, `frame-ancestors 'none'`, HSTS, `nosniff`, Referrer-Policy, Permissions-Policy. Aucune violation de CSP sur le site ni dans les espaces.
- **CSRF** : origine vérifiée, JSON obligatoire, cookies SameSite.
- **Secrets** : aucun dans le code ni dans le JavaScript envoyé au navigateur ; tous en variables d'environnement.
- **« Server Actions »** : le projet n'utilise pas Next.js. L'équivalent, les fonctions `/api`, est couvert par les tests ci-dessus.

## 8. État des performances

Mesures en laboratoire, téléphone Android émulé, processeur ralenti ×4, 4G lente (1,6 Mbit/s, 150 ms) :

| Page | FCP | LCP | TBT | CLS |
|---|---|---|---|---|
| Accueil | 1,5 s | 1,5 s | 18 ms | 0* |
| Prestations | 1,6 s | 2,3 s | 25 ms | 0 |
| Formations | 1,5 s | 1,6 s | 37 ms | 0 |
| Fiche formation | 1,5 s | 2,9 s | 5 ms | 0 |
| Réalisations | 1,5 s | 2,1 s | 22 ms | 0 |
| Contact | 1,5 s | 2,2 s | 27 ms | 0 |

\* 0 avec le texte d'accueil par défaut. Si l'admin personnalise ce texte, un léger décalage (0,07, sous le seuil « bon » de 0,1) peut apparaître à la toute première visite ; les visites suivantes s'affichent tout de suite grâce à la copie du catalogue gardée dans le navigateur.

- **JavaScript du site public** : 98 Ko compressés (contre 140) ; l'espace se charge à la demande (45 Ko).
- **Base de données** : avec 3 000 clients, 10 000 devis et 70 000 notifications, la requête la plus lente prend 13 ms. La migration 006 ajoute 7 index (recherches par client et par formation, suppressions).
- **Cache** : fichiers versionnés en cache d'un an, images d'un jour, catalogue 60 s sur le CDN, photos publiques servies par le CDN si `S3_PUBLIC_URL` est défini.
- **Animations** : défilement automatique arrêté hors écran et pour les personnes qui demandent moins d'animations (`prefers-reduced-motion`).
- **Dépendances** : 6 en production (React, React DOM, Lucide, Zod, pdf-lib, pilote Neon), toutes utilisées.

## 9. Instructions de déploiement

Résumé (détail dans [DEPLOIEMENT.md](DEPLOIEMENT.md)) :

1. Créer les comptes : Vercel **Pro**, Neon, Cloudflare (R2), Resend, Google Cloud.
2. Pousser le dépôt Git sur GitHub (privé).
3. Neon : branche `main`, puis `npm run db:migrate` avec sa chaîne de connexion.
4. Vercel : importer le dépôt (Vite, `npm run build`, `dist`), Node.js 24.x, variables d'environnement (CONFIGURATION.md), déployer.
5. Domaine : l'ajouter dans Vercel et créer les enregistrements DNS. HTTPS est automatique.
6. Premier administrateur : créer le compte sur le site, puis `npm run db:admin -- email`.
7. Paramètres de l'entreprise dans le site, puis la liste de contrôle d'après mise en ligne.
8. Sauvegardes : branche Neon avant chaque mise à jour, `npm run db:backup` chaque semaine ([SAUVEGARDE.md](SAUVEGARDE.md)).
