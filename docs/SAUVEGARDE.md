# Sauvegarde et restauration

Deux protections complémentaires :

1. **Neon** (la base en ligne) : copies instantanées et retour à un instant passé. C'est la méthode à privilégier pour revenir en arrière.
2. **Sauvegardes JSON** du projet (`npm run db:backup`) : une copie lisible de toutes les données, à conserver hors de Neon, et restaurable avec `npm run db:restore`.

Les fichiers joints (photos, PDF envoyés par les clients) sont dans le stockage S3/R2, pas dans la base : voir la dernière section.

## 1. Avec Neon (recommandé pour revenir en arrière)

- **Avant toute mise à jour** du site ou de la base : Neon Console → *Branches* → *Create branch* depuis `main` (nom : `avant-maj-AAAA-MM-JJ`). C'est une copie complète et instantanée.
- **Retour en arrière** : Neon Console → branche `main` → *Restore*, en choisissant la branche de secours ou un instant passé (la durée disponible dépend de l'offre Neon : vérifiez « History retention » dans les réglages du projet).
- Une branche de secours peut être supprimée une fois la mise à jour validée.

## 2. Sauvegarde JSON du projet

```bash
npm run db:backup                 # crée backups/<date>_manuelle/
npm run db:backup -- avant-soldes # même chose, avec une étiquette
```

- Un fichier JSON par table, plus `manifest.json` (nombre de lignes par table).
- `npm run db:migrate` fait automatiquement une sauvegarde avant chaque migration (`backups/<date>_avant-migration/`).
- Le dossier `backups/` est exclu de Git : **il contient des données personnelles** (noms, téléphones, e-mails, hachages de mots de passe). Copiez-le sur un support chiffré ou un stockage privé, jamais dans un endroit public.
- Rythme conseillé : une sauvegarde par semaine et avant chaque mise à jour, conservées 3 mois.

## 3. Restauration d'une sauvegarde JSON

La restauration se fait **uniquement dans une base vide** : elle refuse une base qui contient déjà les tables de l'application. Elle ne peut donc jamais écraser des données réelles.

1. Créer une base vide :
   - Neon : *Branches* → *Create branch*, option *Schema only* ou nouvelle base vide ; ou un nouveau projet Neon ;
   - PostgreSQL local : `createdb emanprod_restauration`.
2. Mettre la chaîne de connexion de cette base vide dans `.env` (`DATABASE_URL=…`).
3. Restaurer :
   ```bash
   npm run db:restore -- backups/2026-11-19T08-00-00_manuelle
   ```
   La commande :
   - recrée le schéma à la version exacte de la sauvegarde ;
   - réinsère chaque ligne telle quelle : identifiants, dates, montants, numéros de devis et de factures ;
   - vérifie les clés étrangères et compare le nombre de lignes de chaque table au manifeste ;
   - recale les compteurs (numéros DV-, CMD-, FAC-, REC-, ATT- continuent après le dernier).
4. Appliquer les migrations plus récentes que la sauvegarde :
   ```bash
   npm run db:migrate
   ```
5. Vérifier sur le site (connexion admin, quelques devis et commandes), puis faire pointer Vercel (`DATABASE_URL`) vers cette base si c'est elle qui doit servir.

**Testé (phase 8)** : sauvegarde de 43 627 lignes (34 tables), restauration dans une base vide en 8 s, puis comparaison ligne à ligne (empreinte md5) : les 33 tables de données sont identiques. Refus confirmé sur une base non vide.

## 4. Fichiers joints (S3 / Cloudflare R2)

La base ne contient que la référence des fichiers. Pour les fichiers eux-mêmes, quel que soit le fournisseur, faites une copie périodique du seau vers un second seau ou un disque, avec un outil compatible S3 comme rclone (`rclone sync r2:emanprod-fichiers sauvegarde:emanprod-fichiers`). Créez pour cela un jeton en lecture seule limité à ce seau. Sur AWS S3 et Backblaze B2, le versionnage du seau peut aussi être activé.

Après une restauration de la base sur un autre environnement, utilisez le même seau (mêmes variables `S3_*`) pour que les liens restent valides.

## 5. Ce qu'il ne faut jamais faire

- Tester une migration, une restauration ou des données de démonstration sur la base en ligne : utilisez une branche Neon `dev`.
- Supprimer des données réelles pour « faire de la place » ou faciliter des tests.
- Versionner `backups/`, `.env` ou un export de la base dans Git.
