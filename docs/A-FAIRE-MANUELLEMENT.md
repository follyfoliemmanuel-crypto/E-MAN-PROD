# Mise en production v4.2 — ce qu'il reste à faire à la main

Le code ne peut pas faire ces étapes : elles se passent chez Vercel, Neon, Resend, Google ou dans
l'espace admin. Suivez l'ordre. Après chaque étape, ouvrez **Espace → Paramètres du site → Mise en
production** : la liste se met à jour et passe au vert point par point.

| # | Étape | Où | Durée | Bloquant pour ouvrir ? |
|---|-------|----|-------|------------------------|
| 1 | Sauvegarder la base | Neon | 5 min | Oui |
| 2 | Vérifier le domaine d'envoi des e-mails | Resend + DNS du domaine | 20 min + attente DNS | Oui |
| 3 | Régler les variables d'environnement | Vercel | 10 min | Oui |
| 4 | Déployer la v4.2 | GitHub → Vercel | 5 min | Oui |
| 5 | Sécuriser la base (compte limité) | Neon + Vercel | 10 min | Fortement conseillé |
| 6 | Remplir les mentions légales | Espace admin | 5 min | Oui |
| 7 | Renvoyer les photos de bannière 2 et 3 | Espace admin + Neon | 5 min | Oui |
| 8 | Faire relire les conditions générales | Juriste | — | Oui |
| 9 | Vider les données de test (une seule fois) | Neon | 5 min | Conseillé |
| 10 | Surveillance de disponibilité | UptimeRobot (gratuit) | 5 min | Conseillé |
| 11 | Sauvegarde hebdomadaire planifiée | Poste du bureau | 15 min | Conseillé |
| 12 | Google Search Console | Google + Vercel | 10 min | Non |
| 13 | Audit des dépendances | Poste connecté | 2 min | Non |
| 14 | Vérification finale | Neon | 2 min | Oui |
| 15 | Domaine emanprod.com (quand il est prêt) | Registrar + Vercel + Resend | 30 min | Non |

---

## 1. Sauvegarder la base (avant toute autre chose)

1. Neon → votre projet → **Branches** → **Create branch** depuis `main`, nom `avant-v4-2`.
   C'est une copie instantanée et complète : en cas de problème, on revient dessus.
2. Neon → **SQL Editor** → coller `db/securite-1-sauvegarde.sql` → **Run**.
   Copie supplémentaire des tables dans le schéma `securite_avant_production`.
3. Notez dans Neon → **Settings** la durée d'historique (« History retention ») de votre offre :
   c'est la fenêtre pendant laquelle Neon peut remonter le temps.

## 2. E-mails : vérifier un domaine d'envoi (point bloquant)

Sans domaine vérifié, Resend n'envoie **qu'à l'adresse du titulaire du compte Resend** : les clients
ne reçoivent ni le lien de vérification, ni la réinitialisation du mot de passe, ni les accusés de réception.

1. Resend → **Domains** → **Add domain** → `emanprod.com` (ou un sous-domaine, ex. `mail.emanprod.com`).
2. Ajoutez chez votre registrar (là où le domaine est acheté) les enregistrements DNS affichés
   (SPF, DKIM, et le MX de retour). Le site n'a pas besoin d'être en ligne sur ce domaine pour ça.
3. Attendez le statut **Verified** chez Resend.
4. Dans Vercel, `MAIL_FROM = E-MAN PROD <contact@emanprod.com>` (une adresse du domaine vérifié).
   Une adresse Gmail ne peut pas servir d'expéditeur.
5. Test réel : créez un compte client sur le site avec une adresse qui n'est **pas** celle du compte
   Resend (ex. l'adresse d'un collègue) et vérifiez que l'e-mail de confirmation arrive (dossier spam
   compris). Le bouton « M’envoyer un essai » (Paramètres du site → **E-mails**) envoie à votre propre
   adresse : utile, mais il ne prouve pas que les clients reçoivent les e-mails.

Si le domaine n'est pas encore acheté : achetez-le d'abord ; aucune solution gratuite fiable
n'existe pour envoyer depuis une adresse Gmail.

## 3. Variables d'environnement Vercel

Vercel → projet → **Settings → Environment Variables** → environnement **Production** :

| Variable | Valeur | Pourquoi |
|----------|--------|----------|
| `MAIL_PROVIDER` | `resend` | Fournisseur d'e-mails |
| `MAIL_API_KEY` | clé Resend (« Sending access ») | Envoi |
| `MAIL_FROM` | `E-MAN PROD <contact@emanprod.com>` | Expéditeur du domaine vérifié |
| `MAIL_REPLY_TO` | `emanprod3@gmail.com` | Les réponses arrivent dans votre boîte |
| `CRON_SECRET` | 32 caractères aléatoires | Sans elle, le nettoyage nocturne (fichiers abandonnés + durée de conservation 3 ans) ne tourne jamais |
| `MFA_REQUIRED` | **ne pas créer** (ou `1`) | Google Authenticator obligatoire pour l'équipe. `0` le désactive : à proscrire |
| `SITE_URL` | **laisser vide** tant que emanprod.com ne répond pas | Sinon les liens des e-mails et les aperçus pointent vers un domaine mort. Vide = adresse Vercel |
| `GOOGLE_SITE_VERIFICATION` | voir étape 12 | Balise Search Console |

Ne mettez jamais ces valeurs dans un fichier envoyé sur GitHub.

## 4. Déployer la v4.2

1. Envoyez le code v4.2 sur GitHub (branche suivie par Vercel). Vercel déploie tout seul.
2. Pendant le déploiement, Vercel **copie toutes les tables** dans le schéma
   `avant_migration_014`, puis applique la migration 014 (2 colonnes, 5 index, une clé primaire).
   Aucune donnée n'est supprimée. Si quelque chose échoue, le déploiement s'arrête et l'ancienne
   version reste en ligne.
3. Alternative manuelle : coller `db/mise-a-jour-v4.2.sql` dans Neon **avant** de déployer.

## 5. Sécuriser la base (compte limité)

1. Neon → SQL Editor → coller **tout** `db/securite-base.sql` → **Run** (compte propriétaire).
2. Copiez le mot de passe `eman_app` affiché à la fin (il n'est affiché qu'une fois).
3. Vercel → Environment Variables → Production :
   - `DATABASE_URL_OWNER` = votre `DATABASE_URL` actuelle (copiez-la **avant** de la changer) ;
   - `DATABASE_URL` = la même adresse avec l'utilisateur `eman_app` et le nouveau mot de passe.
4. **Redeploy**. Puis Espace → Paramètres du site → Mise en production : « Compte de base limité » doit être vert.

En cas de souci : remettez l'ancienne `DATABASE_URL` et redéployez, rien n'est perdu.

## 6. Mentions légales

Espace → Paramètres du site → **Informations légales** : raison sociale, forme juridique, capital, RCCM,
NIF, siège social, directeur de la publication. Ces informations apparaissent aussi sur les devis,
factures et attestations PDF.

## 7. Photos de bannière 2 et 3

1. Espace → **Images et bannières** → bannière 2 → **Remplacer** → choisir la photo → enregistrer. Idem bannière 3.
2. Neon → SQL Editor → `db/reparation-photos.sql` → Run (rattache les fichiers et liste ce qui manque encore).
3. Ouvrez le site en navigation privée et faites défiler le carrousel.

## 8. Conditions générales

Un texte de base est publié sur `/conditions-generales` (devis, bon à tirer, paiement, délais,
réclamations sous 7 jours, annulation, formations, droit togolais). Faites-le relire par un juriste
et ajustez notamment : délai de réclamation, règles d'acompte, conditions de remboursement des formations.
Le texte est dans `src/pages/public.jsx` (fonction `ConditionsGenerales`) : envoyez-moi les
corrections, je les applique.

## 9. Vider les données de test (une seule fois, optionnel)

Après l'étape 1 uniquement : Neon → SQL Editor → `db/reinitialisation-avant-production.sql` → Run.
Vide devis, commandes, messages, notifications et journaux de test ; garde les comptes et le contenu
du site. Lisez l'en-tête du fichier avant (un bloc optionnel supprime les comptes clients de test).

## 10. Surveillance de disponibilité

1. Créez un compte gratuit sur uptimerobot.com (ou Better Stack).
2. Nouveau moniteur **HTTP(s)** : `https://emanprod.vercel.app/api/catalog?health=1`, toutes les 5 minutes.
3. Alerte par e-mail (et SMS/WhatsApp si l'offre le permet). Réponse 200 = site et base OK ; 503 = base injoignable.

## 11. Sauvegarde hebdomadaire planifiée

Sur le poste du bureau (Windows), avec le projet et un `.env` contenant `DATABASE_URL` et les clés Cloudinary :

1. Testez une fois : `npm run backup -- --dossier "E:\Sauvegardes\emanprod"` (disque externe, NAS ou dossier synchronisé).
2. **Planificateur de tâches** → Créer une tâche de base → Hebdomadaire (ex. lundi 9 h) →
   Programme : `cmd.exe`, arguments : `/c cd /d C:\chemin\du\projet && npm run backup -- --dossier "E:\Sauvegardes\emanprod"`.
3. Chaque sauvegarde apparaît dans Espace → Paramètres du site → Fichiers et sauvegardes.
4. Une fois par trimestre : `npm run files:check -- --deep` (vérifie chaque fichier).

## 12. Google Search Console

1. search.google.com/search-console → **Ajouter une propriété** → préfixe d'URL → `https://emanprod.vercel.app`.
2. Méthode **Balise HTML** : copiez seulement la valeur `content="…"`.
3. Vercel → variable `GOOGLE_SITE_VERIFICATION` = cette valeur → **Redeploy** → **Valider** chez Google.
4. Search Console → **Sitemaps** → `sitemap.xml`.

## 13. Audit des dépendances

Sur un poste connecté à Internet, dans le dossier du projet : `npm audit --omit=dev`.
Ne lancez pas `npm audit fix --force`. Envoyez-moi le résultat s'il signale quelque chose.

## 14. Vérification finale

Neon → SQL Editor → `db/production-verification.sql` → Run (lecture seule). Chaque ligne doit être
**OK** ; les lignes « À FAIRE » indiquent l'étape à reprendre. Puis, quelques jours après l'ouverture
sans incident, `db/securite-3-suppression-sauvegarde.sql` retire la copie de l'étape 1.

## 15. Domaine emanprod.com (quand il est prêt)

1. Vercel → **Settings → Domains** → ajouter `emanprod.com` et `www.emanprod.com`, suivre les DNS indiqués.
2. Quand le site répond sur `https://www.emanprod.com` : `SITE_URL = https://www.emanprod.com` → Redeploy.
3. Google (connexion) : ajoutez l'adresse de retour du nouveau domaine dans la console Google Cloud
   (Espace → Paramètres du site → Connexion Google affiche l'adresse exacte).
4. Search Console : ajoutez la nouvelle propriété.

---

## Effacement des données d'un client (quand quelqu'un le demande)

1. Espace → **Gestion des clients** → fiche du client → **Anonymiser (droit à l'effacement)** (administrateur,
   code Google Authenticator récent). Nom, téléphone, e-mail, photo, profil, connexions, notifications
   et avis sont effacés. Factures, paiements et attestations délivrées sont conservés tels quels ;
   les autres devis, commandes et inscriptions restent sans son identité.
2. Neon → `db/effacement-journaux-client.sql` (remplacez l'identifiant en haut) : anonymise aussi
   le journal des e-mails et vide les détails du journal d'activité.
3. Répondez rapidement à la personne : la loi n° 2019-014 fixe un délai, à confirmer avec votre juriste.

## Revenir en arrière après une migration

Deux filets existent : la **branche Neon** de l'étape 1 (copie complète, la plus simple à utiliser)
et les deux dernières copies `avant_migration_<version>` faites dans la base à chaque déploiement
qui applique une migration. Une restauration ne se fait jamais à chaud sur la production :
contactez-moi, je prépare le script adapté (les colonnes ajoutées par la migration doivent être
prises en compte) et on le teste d'abord sur une branche Neon.
