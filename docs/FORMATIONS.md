# Rubrique Formation (v3.7)

## Les 7 modules de la fiche de renseignements

L'import compare chaque module avec les formations **déjà enregistrées**. Il cherche d'abord l'identifiant connu, puis un intitulé proche. Il n'ajoute un module que s'il n'existe pas encore.

| Module de la fiche | Formation dans le site | Action |
|---|---|---|
| CM Community Manager | `community-manager` — *Community manager (CM)*, pôle 3 | **ajoutée** |
| Informatique bureautique | `informatique-bureautique` — *Informatique et bureautique* | existante, conservée |
| Secrétariat bureautique | `secretariat-bureautique` — *Secrétariat bureautique*, pôle 2 | **ajoutée** |
| Infographie | `infographie-design-graphique` — *Infographie et design graphique* | existante, conservée |
| Sérigraphie | `serigraphie` — *Sérigraphie* | existante, conservée |
| Maintenance informatique et réseau | `maintenance-informatique` — *Maintenance informatique* | existante, conservée |
| Impression numérique | `impression-numerique-grand-format` — *Impression numérique et grand format* | existante, conservée |

Règles de l'import :

- **Formation existante** : son identifiant, ses textes, son prix, sa visibilité, ses sessions et ses inscriptions restent tels quels. Seuls les champs encore **vides** reçoivent la valeur de la fiche : 10 000 FCFA de frais d'inscription et « Collège et plus » comme niveau.
- **Aucun doublon.** Si l'administration avait déjà créé « Community Manager » ou « Secrétariat » sous un autre identifiant (même archivé), ce module est retrouvé par son intitulé et rien n'est ajouté.
- **Aucune suppression.** La formation *Réseaux informatiques* reste en place à côté de *Maintenance informatique*. Si la fiche les regroupe, vous pouvez renommer la seconde et masquer ou archiver la première depuis l'administration.
- **Une seule fois.** L'import s'enregistre dans `site_settings` (clé `import_fiche_formations`) et ne se rejoue jamais. Ensuite, c'est l'administration qui décide : si vous videz un champ ou supprimez une formation, un redéploiement ne la recrée pas.
- **Quand il s'exécute** : automatiquement au déploiement Vercel (`npm run db:migrate`, migrations puis contenu de départ) ou avec `db/install-neon.sql`.

Les durées de la fiche (3 mois + stage, 5 mois + stage, 6 mois + stage, 12 mois) ne sont attribuées à **aucun** module. La fiche ne précise pas laquelle va avec quel module, et rien n'est inventé. Elles s'ajoutent en un clic dans l'administration.

## Ce que l'administration gère (Espace → Formations)

Pour chaque formation (bouton **Nouvelle formation**, ou en ouvrant une formation existante) :

- **Informations générales** : titre, pôle, domaine, résumé, description, objectifs, programme. La photo se gère dans **Images et bannières**, rubrique *Formations*.
- **Durées proposées** : autant de lignes que nécessaire (12 au maximum). Chaque ligne a sa durée, un prix facultatif propre à cette durée et une précision (ex. « cours du soir »). On peut ajouter, modifier ou supprimer une ligne. Les durées de la fiche sont proposées en boutons « + 3 mois + stage »…
- **Prix et frais** : frais d'inscription, prix de la formation, précision sur le prix, modalités de paiement, frais supplémentaires (intitulé et montant, 12 lignes au maximum). Tous les montants sont en FCFA, entiers, positifs. Un champ vide n'est pas affiché, ou affiché comme « Nous consulter ».
- **Admission** : niveau scolaire requis et conditions d'admission (une par ligne, 20 au maximum), modifiables et supprimables.
- **Visibilité** : publiée ou masquée. Une formation masquée ou archivée n'apparaît pas sur le site.

Rien de tout cela n'est figé dans le code : tout est enregistré dans Neon (table `trainings`) et le site affiche les nouvelles valeurs dès l'enregistrement.

**Droits :** il faut être administrateur, ou STAFF avec le droit « formations ». Les clients et les visiteurs ne peuvent rien modifier : le serveur refuse avant même de valider les données.

**Contrôles :** pas de montant négatif ni de texte à la place d'un nombre, pas de durée ou de condition vide. Une formation ne peut pas porter le même titre qu'une autre, même avec d'autres majuscules ou espaces.

## Affichage public

- **Liste des formations** : chaque carte montre les durées et les frais d'inscription quand ils sont renseignés.
- **Fiche d'une formation** :
  - durées au choix, avec leur prix éventuel ;
  - frais d'inscription, prix, frais supplémentaires et modalités de paiement ;
  - niveau requis, et une section « Conditions d'admission ».

## Base de données

La migration `010_training_details.sql` est **additive** : elle ajoute les colonnes `duration_options`, `registration_fee_fcfa`, `extra_fees`, `payment_terms` et `admission_requirements`.

- Une durée ou un prérequis déjà saisi devient la première ligne de la nouvelle liste.
- Les anciens champs `duration` et `prerequisites` restent tenus à jour automatiquement, pour les PDF, les e-mails et les inscriptions existantes.
