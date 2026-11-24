# v4.1 — Corrections messagerie, vocaux, fichiers, carrousel et responsive

## Problèmes identifiés (audit, causes exactes)

| # | Symptôme | Cause trouvée |
|---|---|---|
| 1 | Message vocal : il faut le télécharger, il ne se lit pas dans la bulle | En ligne, Cloudinary sert les fichiers privés comme des **téléchargements** (`attachment`), depuis `api.cloudinary.com`, domaine que la politique de sécurité du site n'autorisait pas pour l'audio. Le lecteur ne pouvait que proposer « Ouvrir ». En local le stockage servait le fichier directement : le défaut ne se voyait pas. |
| 2 | Barre de saisie qui disparaît, cachée par le clavier | La conversation était posée dans une page qui défile, sous l'en-tête, le titre et l'invitation : sur un téléphone de 360 px, la barre était à 1 127 px du haut d'un écran de 740 px. Rien ne suivait la partie visible de l'écran quand le clavier s'ouvre. |
| 3 | Réception parfois lente, connexion « bloquée » | Un flux temps réel ouvert mais retenu par un intermédiaire (proxy, réseau d'opérateur) n'était jamais détecté ; le mode de secours ne relisait que les notifications, toutes les 20 s ; relance jusqu'à 30 s après une coupure ; statuts relus toutes les 2,4 s. |
| 4 | Doublons possibles | Un message renvoyé après une coupure (réponse perdue) était enregistré deux fois. |
| 5 | Fichiers abîmés acceptés | Le contrôle vérifiait le début du fichier (signature) mais pas sa fin : un JPEG ou un PDF coupé passait. |
| 6 | Photos du carrousel mal cadrées ou floues | Toujours centrées (`object-position: 50% 50%`) : sur téléphone (cadre vertical) les côtés de la photo, et donc le sujet, étaient coupés. Une seule taille (1 600 px) pour tous : lourde sur téléphone, pixellisée sur grand écran et écran Retina. |
| 7 | Éléments qui se chevauchent | Le bouton WhatsApp flottant cachait des boutons (micro de la messagerie sur grand écran, « Ouvrir la commande », « Marquer comme lue »). Fil d'Ariane : liens de 22 px de haut (cible tactile trop petite). |

## Corrections

1. **Lecteur vocal intégré** (`src/pages/space/voice.jsx`, avec lecture de secours Web Audio si le navigateur refuse le format) : le fichier est lu par le site (`/api/files?id=…&stream=1`, mêmes droits que le téléchargement, vrai type audio, lecture partielle), gardé en mémoire et lu sur place. Forme d'onde calculée sur le vrai son (40 traits), progression animée, toucher ou glisser sur l'onde pour avancer / reculer, temps écoulé / durée, pause et reprise, vitesse 1× / 1,5× / 2×, erreurs avec « Réessayer ». Enregistrement : niveaux du micro en direct, aperçu avec la vraie forme d'onde.
2. **Barre de saisie** : sur téléphone, conversation en plein écran sur la partie **visible** de l'écran (visualViewport) : le clavier ne la cache jamais ; zones de sécurité (encoche, barre d'accueil) ; la page derrière ne défile plus ; la zone de texte grandit jusqu'à 5 lignes. Sur ordinateur, la conversation se place sous l'en-tête et prend la hauteur exacte de la fenêtre. Seule la liste des messages défile.
3. **Rapidité** : message affiché tout de suite, puis confirmé par le serveur (qui renvoie le message complet) ; statuts toutes les 1,2 s ; flux temps réel protégé contre la mise en tampon (2 Ko envoyés d'emblée, signes de vie toutes les 15 s) ; connexion muette détectée (6 s au démarrage, 40 s ensuite) → **mode de secours** qui relit les changements toutes les 3 s (8 s sur connexion lente) et retente le flux chaque minute ; relance en 1 à 10 s après une coupure ; filet de sécurité toutes les 30 s.
4. **Sans doublon** : chaque message porte une référence unique ; un renvoi (ou un triple clic) rend le message déjà enregistré. Hors connexion, le message reste « En attente du réseau » et part tout seul au retour, dans l'ordre.
5. **Fichiers** : en plus des contrôles existants (extension, type annoncé, signature réelle, cohérence, taille, exécutables, archives et PDF piégés, droits), détection des fichiers **abîmés ou incomplets** (JPEG/PNG/WebP sans fin, PDF sans fin de document, Word/Excel/PowerPoint sans structure, audio abîmé). Un fichier abîmé est refusé avec « renvoyez le fichier d'origine » (sans le compter comme une attaque).
6. **Carrousel** : 6 tailles servies par Cloudinary (480 à 3 200 px, jamais plus grand que l'original) ; le navigateur prend la bonne. **Point de cadrage** réglable dans « Images et bannières » → « Cadrage » (un point pour tous les écrans, ou un point différent pour les téléphones), avec aperçus téléphone, tablette, ordinateur, grand écran. Voile plus régulier et ombre du texte sur téléphone ; hauteurs adaptées aux tablettes et aux très grands écrans.
7. **Responsive** : bouton WhatsApp flottant retiré des espaces client et équipe (la messagerie le remplace), marges du bas ; fil d'Ariane 28 px.

Stockage : le projet utilise **Cloudinary** (privé, liens temporaires de 5 minutes pour les téléchargements). Il n'y a pas de Cloudflare R2 dans le projet : rien n'a été remplacé.

Trouvés et corrigés pendant les tests :
- l'aperçu d'un vocal avant envoi devenait illisible dès que sa forme d'onde était calculée (l'adresse du son était libérée trop tôt) ;
- au retour du réseau, deux messages en attente pouvaient partir en même temps et arriver dans le désordre : ils partent maintenant un par un, dans l'ordre d'écriture.

## Base de données
Migration **013** (additive) : `messages.client_ref` (+ index unique), `site_media.focus` et `focus_mobile`. Fichier prêt : `db/mise-a-jour-v4.1.sql`. Le garde-fou est maintenant **dans** le bloc de migration (aussi corrigé dans `db/mise-a-jour-v4.0.sql`) : sur une base trop ancienne, rien n'est modifié.

## Tests exécutés (tous rejoués sur la version finale)

| Suite | Résultat |
|---|---|
| Fiabilité messagerie (doublons, renvoi, coupure, mode secours, ordre) | 39/39 |
| Messagerie navigateur v4.1 (temps d'affichage, clavier simulé, hors connexion, vocal) | 35/35 (×3) |
| Messagerie navigateur v4.0 + lecture de secours Web Audio | 63/63 |
| Messagerie API / rôle base restreint | 68/68 et 68/68 |
| Double authentification API | 62/62 |
| Contrôle des fichiers (unitaire, local, Cloudinary) | 38/38, 9/9, 40/40 |
| Temps réel API / navigateur | 15/15, 8/8 |
| Carrousel (tailles, cadrage, 4 écrans) | 33/33 |
| Responsive (11 tailles d'écran, toutes les pages et sections) | 0 problème |
| Bannière 10 photos, commandes, admin, push, mode Vercel, verrouillage, envois | tous à 0 échec |
| Régression complète (API, navigateur phases 5 à 8, sécurité, SEO, en-tête, Cloudinary) | tous à 0 échec |
| Fichier SQL d'installation (13 migrations) et de mise à jour | 20/20 |

Mesures (serveur local) : message affiché en 69 ms, confirmé en 99 ms, reçu par l'autre personne en ~0,9 s ; en mode secours ~0,8–1,4 s.

## Restant à vérifier de votre côté
- Lecture d'un vocal enregistré sur Android ou ordinateur (WebM/Opus) depuis un **iPhone** : selon la version d'iOS, Safari refuse parfois ce format dans son lecteur audio (ou depuis une adresse « blob: ») tout en sachant le décoder. Le lecteur bascule alors seul sur une lecture « Web Audio » du son décodé (mêmes commandes). Testé ici en forçant ce mode dans Chromium ; à confirmer sur un iPhone réel. Les vocaux enregistrés sur iPhone (MP4) se lisent partout.
- Clavier réel d'Android et d'iOS : simulé ici en réduisant la partie visible de l'écran (même mécanisme que le vrai clavier) ; à confirmer sur vos téléphones.
- Photos déjà en ligne : je n'ai pas accès à vos vraies photos. Ouvrez « Images et bannières » → « Cadrage » pour chaque photo dont le sujet n'est pas au centre.
