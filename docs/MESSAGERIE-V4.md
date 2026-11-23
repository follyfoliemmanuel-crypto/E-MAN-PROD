# Messagerie privée client ↔ E-MAN PROD (v4.0)

## Audit et choix

- **Réutilisé** : le fil « Assistance » (table `messages`, colonne `support_user_id`) était déjà une
  conversation privée par client. Tout l'historique est conservé ; « Assistance » s'appelle
  désormais « Messagerie ». Pièces jointes : table `uploaded_files` (usage `message`).
- **Stockage** : Cloudinary, en privé (type « authenticated »), comme tous les fichiers du site.
  Le cahier des charges parlait de Cloudflare R2 : le projet ne l'utilise pas, et la règle « ne pas
  créer un deuxième système » a primé.
- **Temps réel** : le flux SSE existant (`/api/inbox?stream=1`). Vercel ne permet pas de serveur
  WebSocket ; le flux SSE fonctionne en continu, reprend après coupure et transporte maintenant
  les statuts, « écrit un message… » et la présence. Aucune infrastructure en plus.
- **Fonctions Vercel** : toujours 11 (limite 12 sur l'offre gratuite) ; tout passe par `/api/inbox`.

## Fonctionnement

- Un client n'accède qu'à SA conversation : l'identifiant vient de sa session, jamais du navigateur.
- L'équipe y accède avec le droit « Assistance / support » (l'administrateur l'a toujours).
- **Couleurs** : bleu clair = messages de la personne connectée ; gris = messages reçus (client, ou
  collègue de l'équipe, dont le nom s'affiche).
- **Statuts** : ✓ envoyé ; ✓✓ gris reçu (un appareil de l'autre partie est connecté ou a chargé la
  conversation) ; ✓✓ bleu lu (conversation ouverte, onglet visible).
- **Historique** : 40 messages, puis les précédents en remontant (sans doublon).
- **Pièces jointes** : photos (aperçu), PDF, Word, Excel, PowerPoint, AI, EPS, PSD, CDR, ZIP ;
  25 Mo et 5 fichiers par message ; type vérifié sur le contenu et inspection anti-piège (v3.10).
  Un fichier envoyé mais pas encore joint à un message n'est visible que de son auteur ; il est
  effacé au bout de 24 h s'il n'est jamais envoyé.
- **Messages vocaux** : enregistrer, arrêter, annuler, réécouter avant d'envoyer, 5 minutes au plus.
  WebM/Opus (Chrome, Android, Firefox), MP4/AAC (Safari, iPhone). Lecture, pause, barre de
  progression, durée. Aucun appel audio ou vidéo.
- **Présence** : « En ligne » = un onglet de l'espace ouvert et visible (chaque appareil compte),
  vu depuis moins de 50 s. Un onglet caché se déconnecte au bout de 30 s. Sinon « Hors ligne · vu
  aujourd'hui à 14:05 » ; chacun peut masquer sa dernière activité (Paramètres).
- **Profils** : le client voit le nom public, la fonction, la photo, l'entreprise, la présence et la
  présentation de l'équipe (jamais l'e-mail ni le téléphone) ; modifiables dans « Profil
  administrateur ». L'équipe voit les coordonnées du client depuis la conversation.
- **Notifications** : nouveau message / message vocal (espace + Push ; e-mail au client seulement
  s'il n'est pas en ligne). Ouvrir la conversation marque ces notifications comme lues.
