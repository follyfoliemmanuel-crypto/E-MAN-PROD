# Sauvegarde et restauration

Deux protections complémentaires :

1. **Neon** (la base en ligne) : copies instantanées et retour à un instant passé. C'est la méthode à privilégier pour revenir en arrière.
2. **Sauvegardes JSON** du projet (`npm run db:backup`) : une copie lisible de toutes les données, à conserver hors de Neon, et restaurable avec `npm run db:restore`.

Les fichiers (photos, PDF envoyés par les clients) sont chez Cloudinary, pas dans la base, et Cloudinary n'est pas une sauvegarde : voir la section 4 (`npm run backup`).

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

## 4. Fichiers (Cloudinary) : sauvegarde indépendante

**Cloudinary n'est pas une sauvegarde** : une suppression, une erreur de manipulation ou la perte du compte emporterait les fichiers. La sauvegarde copie la base et les fichiers sur un support d'E-MAN PROD, hors de Cloudinary et de Neon (disque externe, NAS, dossier synchronisé).

**Lancer une sauvegarde** (depuis le dossier du projet, `.env` rempli avec `DATABASE_URL` et `CLOUDINARY_*`) :
```
npm run backup -- --dossier "E:\Sauvegardes\emanprod"
```
- `base/<date>/` : un fichier JSON par table + `manifest.json` (restaurable par `npm run db:restore`) ;
- `fichiers/<identifiant>` : chaque fichier, son `.json` de métadonnées, et `manifeste.json` ;
- copie **incrémentale** : seuls les fichiers nouveaux ou manquants sont téléchargés ; chaque copie est relue et son empreinte SHA-256 enregistrée dans Neon ;
- chaque exécution est inscrite dans la table `backup_runs` (visible dans Espace → Paramètres → Fichiers et sauvegardes), avec son résultat réel : une sauvegarde qui n'a pas tourné n'apparaît pas.

**Planifier** (conseillé : chaque semaine, et avant toute mise à jour) :
- Windows : Planificateur de tâches → *Créer une tâche de base* → programme `npm`, arguments `run backup -- --dossier "E:\Sauvegardes\emanprod"`, dossier de démarrage : celui du projet ;
- macOS / Linux : `crontab -e` → `0 20 * * 5 cd /chemin/emanprod && npm run backup -- --dossier /media/sauvegarde/emanprod`.
Gardez au moins deux supports (par exemple un disque à l'atelier, un autre ailleurs) et vérifiez de temps en temps que le dossier se remplit.

**Contrôle d'intégrité**
```
npm run files:check                 # chaque fichier existe-t-il chez Cloudinary, avec la bonne taille ?
npm run files:check -- --deep       # relit le contenu et compare l'empreinte SHA-256
npm run files:check -- --orphans    # fichiers présents chez Cloudinary mais absents de la base
npm run files:check -- --cleanup    # efface les envois abandonnés depuis plus de 24 h
```
Les orphelins ne sont effacés qu'avec `--clean-orphans --yes`, et seulement s'ils ont plus de 24 h.

**Restaurer des fichiers**
```
npm run files:check                                   # repère les fichiers introuvables
npm run files:restore -- --dossier "E:\Sauvegardes\emanprod"           # les remet chez Cloudinary
npm run files:restore -- --dossier "E:\…" <identifiant> <identifiant>   # ou seulement ceux-là
```
Chaque copie est contrôlée (empreinte) avant d'être renvoyée, au même identifiant Cloudinary. Les adresses des réalisations sont mises à jour automatiquement.

**Restaurer toute la plateforme** (perte de la base et du compte Cloudinary) : créez une base Neon vide, `npm run db:restore -- "<dossier>/base/<date>"`, créez le nouveau compte Cloudinary et ses variables, puis `npm run files:restore -- --dossier "<dossier>"` après avoir marqué les fichiers comme manquants avec `npm run files:check`.

## 5. Ce qu'il ne faut jamais faire

- Tester une migration, une restauration ou des données de démonstration sur la base en ligne : utilisez une branche Neon `dev`.
- Supprimer des données réelles pour « faire de la place » ou faciliter des tests.
- Versionner `backups/`, `.env` ou un export de la base dans Git.
