# Double authentification de l'équipe (Google Authenticator)

Depuis la v4.0, les comptes de l'équipe (administrateurs et collaborateurs) sont protégés par
un code à 6 chiffres affiché par **Google Authenticator** (TOTP, norme RFC 6238), en plus du mot
de passe ou de la connexion Google.

## Première activation

1. Connectez-vous avec votre mot de passe (ou Google).
2. L'espace affiche « Protégez votre compte avant de continuer ». Tant que ce n'est pas fait,
   le compte n'a **aucun** droit d'équipe : le serveur le traite comme un simple client.
3. « Afficher le QR code » → scannez-le avec Google Authenticator.
   Sur le même téléphone : dans l'application, **+** → **Saisir une clé de configuration**.
4. Saisissez le code affiché → **Activer**.
5. **Rangez les 10 codes de récupération** (papier, gestionnaire de mots de passe). Ils ne sont
   montrés qu'une fois. Chacun ne sert qu'une fois.

## Au quotidien

- Sur votre appareil habituel, cochez « Faire confiance à cet appareil » : le code n'est plus
  demandé à chaque visite, la session survit à la fermeture du navigateur.
- Le code est **redemandé** :
  - sur un nouvel appareil ou un autre navigateur ;
  - après « Se déconnecter » ;
  - quand la session a été fermée (par vous ou un administrateur) ;
  - après un changement de mot de passe ;
  - au bout de 30 jours (MFA_TRUST_DAYS, 90 au plus) ;
  - si un appareil de confiance est révoqué ;
  - si le cookie de confiance réapparaît dans un autre navigateur (activité inhabituelle : l'appareil
    est révoqué et vous êtes alerté) ;
  - avant une **action sensible** (gestion de l'équipe, réglages du site, mot de passe, codes de
    récupération) si aucun code n'a été saisi depuis 10 minutes.
- **Paramètres** : appareils de confiance (navigateur, dates) révocables un par un ou tous, sessions
  ouvertes, nouveaux codes de récupération.

## Sécurité

- Le secret TOTP est chiffré en base (AES-256-GCM). Il n'est montré qu'une fois, pendant
  l'activation, et n'apparaît dans aucune autre réponse de l'API.
- Un code déjà accepté est refusé (anti-rejeu). Décalage d'horloge toléré : ± 30 secondes.
- 5 codes faux : l'étape est annulée (retour au mot de passe) et vous êtes alerté.
  10 essais par heure au plus par compte.
- Alertes (espace + e-mail si configuré) : nouvelle connexion, code de récupération utilisé,
  codes incorrects, activité inhabituelle, activation / désactivation.
- Cookies `__Host-` en HTTPS, HttpOnly, Secure, SameSite=Lax. Chaque évènement est inscrit au
  journal de sécurité.

## Téléphone perdu

1. **Avec un code de récupération** : « Téléphone perdu ? Utiliser un code de récupération »,
   puis Paramètres → réactivez sur le nouveau téléphone si besoin (nouveaux codes).
2. **Sans code, et un autre administrateur existe** : il ouvre Équipe et réinitialise votre double
   authentification (il doit lui-même saisir son code). Vos sessions sont fermées ; vous réactivez.
3. **Administrateur seul, sans code** : la personne qui a accès à la base (fichier .env) lance
   `npm run mfa:reset -- votre@adresse.com`. Rien ne peut être désactivé depuis le site sur
   simple demande.

## Variables (toutes facultatives)

| Variable | Effet |
|---|---|
| `MFA_REQUIRED` | `1` obligatoire pour l'équipe (défaut sur Vercel), `0` facultative (défaut en local) |
| `MFA_TRUST_DAYS` | durée d'un appareil de confiance (30 par défaut, 90 au plus) |
| `MFA_ENCRYPTION_KEY` | clé de chiffrement (`openssl rand -hex 32`). Sans elle, une clé est créée en base. Une fois mise, ne la changez plus. Les secrets créés avant restent lisibles. |
