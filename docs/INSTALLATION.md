# Installation locale


Vercel ne sert qu'à la mise en ligne. En local, une seule commande lance le site **et** l'API.

## Prérequis
- **Node.js 24.7 ou plus** : https://nodejs.org (version « LTS » 24). Vérifier avec `node -v`. Node 24 est nécessaire pour le hachage Argon2id des mots de passe.
- Un terminal ouvert **dans le dossier du projet** (celui qui contient `package.json`).

## 1. Installer
```bash
npm install
```

## 2a. Voir le site tout de suite, sans base de données
```bash
npm run demo
```
Le site s'ouvre sur http://localhost:5173 avec des données fictives : formulaires, tableau de bord, animations. Rien n'est enregistré.

## 2b. Version complète avec base de données
1. Copier `.env.example` en `.env`, puis remplir `DATABASE_URL`. Deux choix :
   - **Neon (recommandé, rien à installer)** : Neon Console > Branches > créer une branche `dev` > **Connect** > copier la chaîne `postgresql://…neon.tech/…?sslmode=require`.
   - **PostgreSQL installé sur le PC** : créer une base `emanprod`, puis `DATABASE_URL=postgresql://postgres:VOTRE_MDP@localhost:5432/emanprod`.
2. Créer ou mettre à jour la base :
   ```bash
   npm run db:check     # teste la connexion
   npm run db:migrate   # sauvegarde, applique les migrations, ajoute le contenu de départ
   npm run db:demo      # facultatif : données de démonstration (-- --remove pour les retirer)
   ```
3. Lancer :
   ```bash
   npm run dev
   ```
   Site et API sur http://localhost:5173.
   `db:migrate` peut être relancé sans risque : une migration déjà appliquée ne l'est jamais deux fois. Le contenu de départ : il n'écrase jamais ce qui a été modifié dans l'admin.
4. Sur le site, créer votre compte (Espace client > Créer un compte), puis le passer administrateur :
   ```bash
   npm run db:admin -- votre@email.com
   ```
   Déconnectez-vous et reconnectez-vous : le tableau de bord complet apparaît.

## Si ça refuse de démarrer
| Message | Cause et solution |
|---|---|
| `npm : impossible de charger le fichier … l’exécution de scripts est désactivée` (Windows PowerShell) | Ouvrir PowerShell et lancer `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, puis répondre O. Ou utiliser l'« Invite de commandes » (cmd) à la place. |
| `'npm' n’est pas reconnu…` / `command not found: npm` | Node.js n'est pas installé, ou le terminal a été ouvert avant l'installation : installer Node.js LTS puis rouvrir le terminal. |
| `npm ERR! enoent … package.json` | Le terminal n'est pas dans le bon dossier : `cd` jusqu'au dossier qui contient `package.json` (après décompression : `eman-prod-app`). |
| `Unsupported engine` / erreurs de syntaxe au lancement | Node.js trop ancien : installer la version 24 ou plus. |
| `Port 5173 is in use` | Un autre serveur tourne déjà : le fermer, ou lancer `npm run dev -- --port 5174`. |
| Dans le site : « DATABASE_URL n’est pas configurée » | Le fichier `.env` manque ou est vide : voir l'étape 2b. Il doit s'appeler exactement `.env` (pas `.env.txt`). |
| `npm run db:check` : connexion impossible | Chaîne de connexion mal copiée (mot de passe, `?sslmode=require` pour Neon), ou PostgreSQL local arrêté. |

## Commandes
| Commande | Rôle |
|---|---|
| `npm run dev` | site + API en local (avec base) |
| `npm run demo` | site seul avec données fictives, sans base |
| `npm run build` puis `npm run preview` | construire et tester la version de production |
| `npm run db:check` | tester la connexion à la base |
| `npm run db:migrate` | sauvegarde, migrations en attente, contenu de départ |
| `npm run db:status` | migrations appliquées et en attente |
| `npm run db:backup` | sauvegarde JSON de toutes les tables (voir SAUVEGARDE.md) |
| `npm run db:restore -- backups/<dossier>` | restaurer une sauvegarde dans une base vide |
| `npm run db:demo` (`-- --remove`) | ajouter / retirer les données de démonstration |
| `npm run db:admin -- email` | nommer un administrateur |

En local sans fournisseur d'e-mails, les liens de confirmation et de réinitialisation s'affichent dans le terminal de `npm run dev`. Sans stockage S3, les fichiers joints vont dans le dossier `.uploads/`.
