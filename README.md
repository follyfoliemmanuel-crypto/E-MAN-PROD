# E-MAN PROD — site et plateforme de gestion (v3.1)

*E-man Prod, la référence !* — Imprimerie, création graphique, sérigraphie, enseignes, formation professionnelle et informatique. Siège : Nouveau Marché de Baguida, Lomé (Togo). Annexe : Agbavi, Yésuvito. emanprod3@gmail.com

**Ce que contient le projet**
- **Site public** : accueil, prestations, centre de formation (pôles, fiches, sessions), réalisations, à propos, E-MAN CARS, contact, vérification des attestations.
- **Espace client** : demandes de devis avec fichiers, devis en PDF à accepter ou refuser, commandes et paiements, factures et reçus, inscriptions, présences, supports de cours, attestations, notifications, assistance, profil.
- **Espace de gestion** (ADMIN et STAFF) : tableau de bord, clients, devis, commandes, paiements et factures, formations et apprenants, réalisations, contenu, annonces, équipe, paramètres.
- **Comptes** : e-mail et mot de passe (Argon2id), connexion Google, sessions sécurisées, rôles ADMIN, STAFF et CLIENT.

**Technique** : React 18 + Vite (site), fonctions Node sur Vercel (`/api`), PostgreSQL sur Neon, fichiers sur Cloudinary (métadonnées dans Neon), e-mails Resend ou Brevo, PDF générés par le serveur (pdf-lib). Node.js 24.7 ou plus.

## Démarrage rapide (sur votre PC)

```bash
npm install
cp .env.example .env        # puis renseigner DATABASE_URL
npm run db:migrate          # crée la base et le contenu de départ (en ligne : automatique à chaque déploiement)
                            # (ou : coller db/install-neon.sql dans le SQL Editor de Neon)
npm run dev                 # site et API : http://localhost:5173
```
Sans base de données, pour voir le site : `npm run demo`. Détails et dépannage : [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | site + API en local |
| `npm run demo` | site seul, données fictives |
| `npm run build` | version de production (`dist/`, pages prérendues pour le SEO) |
| `npm run preview` | tester la version de production en local |
| `npm run db:migrate` | sauvegarde puis migrations en attente et contenu de départ |
| `npm run db:status` / `db:check` | état des migrations / test de connexion |
| `npm run db:backup` | sauvegarde JSON de toutes les tables |
| `npm run db:restore -- backups/<dossier>` | restauration dans une base vide |
| `npm run db:admin -- email` | nommer un administrateur |
| `npm run db:demo` (`-- --remove`) | données de démonstration (branche `dev` uniquement) |

## Documentation

| Guide | Contenu |
|---|---|
| [INSTALLATION.md](docs/INSTALLATION.md) | Installation locale, commandes, dépannage |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Variables d'environnement, base Neon, Google, e-mails, stockage, réglages du site |
| [DEPLOIEMENT.md](docs/DEPLOIEMENT.md) | Mise en production pas à pas (Vercel, Neon, domaine, HTTPS) et vérifications |
| [SAUVEGARDE.md](docs/SAUVEGARDE.md) | Sauvegardes, restauration, branches Neon, fichiers |
| [ROLES.md](docs/ROLES.md) | Rôles ADMIN, STAFF, CLIENT et droits |
| [FONCTIONNALITÉS](docs/FONCTIONNALITES.md) | Fonctionnement détaillé et règles métier |
| [HISTORIQUE.md](docs/HISTORIQUE.md) | Versions précédentes et vérifications |
| [RAPPORT-PHASE-8.md](docs/RAPPORT-PHASE-8.md) | Audit final : tests, sécurité, performances, état du projet |

## Structure

```
api/                 fonctions serverless (une par fichier) : valident les entrées (Zod) puis appellent les services
api/_lib/            règles métier et contrôles d'accès (services/), auth, e-mails, PDF, stockage, validation
db/migrations/       001 → 006, appliquées dans l'ordre par db:migrate (jamais modifiées après application)
db/install-neon.sql  les mêmes migrations + le contenu de départ en un seul fichier (npm run db:sql)
scripts/             outils base de données (migrations, sauvegarde, restauration, démo) et prérendu SEO
src/                 site React : pages publiques, espaces (src/pages/space), composants, styles
public/              polices, logo, icônes, image de partage
docs/                documentation
```

## À fournir par E-MAN PROD avant l'ouverture

1. Le **nom de domaine** réel (à reporter dans `SITE_URL` et `VITE_SITE_URL`).
2. Les comptes **Vercel Pro**, **Neon**, **Cloudinary**, **Resend** et **Google Cloud** (identifiants créés par l'entreprise : aucun n'est fourni).
3. Dans Paramètres : numéros WhatsApp officiels, réseaux sociaux, informations légales (raison sociale, RCCM, NIF…), conditions des devis et moyens de paiement.
4. Dans Formations : tarifs, durées, sessions et conditions d'attestation ; dans Réalisations : les photos des travaux.
5. Vérifier auprès de l'IPDCP si une déclaration du traitement des données clients est nécessaire (loi n° 2019-014).
