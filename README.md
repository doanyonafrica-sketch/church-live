# TPR Live : téléphone → OBS (sans lag)
- `server/` : serveur Node + pages web (`phone.html`, `obs.html`, `control.html`)
- `mobile/` : enveloppe Capacitor → APK (compilé par GitHub Actions)
- `desktop/` : enveloppe Electron → installeur Windows (compilé par GitHub Actions)
- `android-native/` : version Android native (secours, optionnelle)
- `mobile/signing/` : clé de signature fixe de l'APK (nécessaire pour que les mises à jour s'installent par-dessus)
- `mobile/patch/` : `MainActivity` qui garde le Wi-Fi en haute performance pendant le direct

## Obtenir les applications
Onglet **Actions** du dépôt → dernier « Build APK » / « Build Windows » → télécharger l'artefact (`church-live-apk`, `church-live-windows`).

## Utilisation
1. PC : installer et lancer **TPR Live** ; la fenêtre affiche l'adresse OBS et l'adresse à saisir sur le téléphone.
2. OBS : Source Navigateur → adresse affichée (`http://localhost:3000/obs.html`), cocher « Contrôler l'audio via OBS ».
3. Téléphone (APK) : touchez **Rechercher le PC** dans les Réglages (ou laissez l'application le faire seule au premier lancement, et après trois échecs de connexion) → Démarrer le direct. L'adresse peut aussi être saisie à la main.
4. Mode USB : Paramètres du téléphone → Partage de connexion → Partage par USB, puis utiliser l'adresse affichée par le PC.
5. Autoriser TPR Live dans le pare-feu Windows (réseau privé).

## Code d'appairage (nouveau)
La fenêtre du PC affiche un **code à 6 chiffres**. Saisissez-le **une seule fois** dans les Réglages du téléphone (champ « Code d'appairage »). Sans lui, un autre appareil du Wi-Fi ne peut pas se faire passer pour une caméra ou pour OBS. OBS sur le PC lui-même n'en a pas besoin ; pour une source OBS sur un autre ordinateur, ajoutez `?code=123456` à l'adresse. Après dix erreurs, l'appareil est bloqué une minute. Pour désactiver : variable d'environnement `TPR_NO_PIN=1` avant de lancer le serveur. **Les anciens APK ne connaissent pas le code : mettez le téléphone à jour (ou désactivez le code le temps de la mise à jour).**

## Une place = un appareil (nouveau)
Une caméra (et une Source OBS) ne peut être tenue que par un appareil à la fois. Si un second téléphone choisit le même numéro, **c'est lui qui est refusé** : le direct en cours n'est jamais coupé. Une seconde page OBS sur la même caméra affiche un message rouge et attend. Un appareil qui revient après une coupure Wi-Fi reprend sa place seul.

## Plusieurs téléphones
Chaque téléphone choisit un **numéro de caméra** (Réglages). Dans OBS, ajoutez une Source Navigateur par caméra : la caméra 1 utilise `obs.html`, les autres `obs.html?room=cam2`, `?room=cam3`, `?room=cam4` (adresses à copier dans la fenêtre du PC). Deux téléphones ne peuvent pas partager le même numéro. Chaque caméra consomme du réseau (≈ 3 Mb/s) et du processeur sur le PC.

## Mesures dans la fenêtre du PC
La fenêtre TPR Live affiche, pour chaque caméra : image et images/s, débit (Mb/s), compression, latence et pertes réseau, signal Wi-Fi (dBm) et vitesse de liaison, batterie du téléphone, durée du direct, micro, cause d'une éventuelle limitation, et le conseil de diagnostic. Elle affiche aussi ce que **OBS reçoit réellement** (images/s, paquets et images perdus, gigue, tampon) et la charge du processeur du PC. Le signal Wi-Fi n'est pas disponible en partage de connexion USB.

## Indicateur « à l'antenne » (téléphone)
Chaque téléphone affiche un bandeau en haut de l'écran : **rouge « À L'ANTENNE »** (avec un liseré rouge autour de l'image) quand sa caméra est visible dans le **Programme** d'OBS, **« PAS À L'ANTENNE »** quand OBS utilise une autre caméra ou une autre scène, **orange « STATUT INCONNU »** si la liaison avec le PC est coupée. C'est la Source Navigateur d'OBS qui le détecte (la caméra doit être dans la scène en direct ; en mode Studio, l'aperçu ne compte pas). La fenêtre du PC affiche aussi « À l'antenne » à côté de la caméra concernée. Il faut mettre à jour **le PC et le téléphone** (nouvelle Release).

## Caméras dômes IP (PTZ)
Onglet **Caméras PTZ** dans la fenêtre du PC : image en direct, rotation (haut/bas/gauche/droite, zoom, vitesse), positions mémorisées (« Chaire », « Chorale »…) et adresse du flux à copier dans OBS.
1. **Ajouter une caméra** : adresse IP (ex. `192.168.1.182`), nom d'utilisateur et mot de passe de la caméra, puis **Tester la connexion** (le port ONVIF est cherché automatiquement : 80, 8080, 2020, 8899…).
2. La commande utilise **ONVIF**, que presque toutes les caméras IP comprennent. **Activez ONVIF dans la caméra** si elle le propose (souvent dans Réseau → Intégration/ONVIF), et créez-y un utilisateur ONVIF si besoin (sur certaines marques, TP-Link Tapo par exemple, c'est un « compte de caméra » différent du compte de l'application).
3. L'image passe par **ffmpeg** (intégré à l'application) : le flux RTSP de la caméra est converti pour la fenêtre. Pour l'affichage on prend le flux de qualité réduite (moins de réseau et de processeur).
4. OBS : **+ → Source média**, décochez « Fichier local », collez l'adresse RTSP affichée sous la caméra. OBS reçoit la qualité maximale, sans passer par TPR Live.
5. Les caméras et leurs mots de passe sont enregistrés sur le PC (dossier de données de TPR Live), jamais envoyés ailleurs. Seul le PC lui-même peut les voir et les commander : les téléphones du réseau n'y ont pas accès.
6. Sécurité : un ordre de déplacement s'arrête tout seul au bout de 1,5 s si l'ordre « stop » se perd. Réservez les caméras à un réseau privé et changez le mot de passe d'usine.

## Développement
`cd server && npm install && npm test` ; `npm start` pour lancer le serveur seul.

## Publier une nouvelle version (mises à jour automatiques)
1. `git add . && git commit -m "description" && git push` : **c'est tout.** Chaque envoi sur `main` publie seul la version suivante (1.0.1, 1.0.2…) : GitHub compile l'APK, l'intègre à l'installeur Windows et publie une **Release** avec les deux fichiers. Les changements qui ne touchent que des fichiers `.md` ne publient rien.
2. Pour choisir soi-même le numéro (par exemple 1.1.0) : `git tag v1.1.0 && git push origin v1.1.0` publie exactement ce numéro.
- **PC Windows** : vérifie au démarrage puis toutes les 30 minutes, télécharge seul et propose de redémarrer (à ne pas faire pendant un direct).
- **Téléphone** : à l'ouverture et à chaque connexion au PC, il demande la version de l'APK au PC (aucun Internet nécessaire). Si elle est plus récente, un bouton « Nouvelle version disponible » apparaît : un appui télécharge l'APK et ouvre l'écran d'installation Android (un appui sur « Mettre à jour »). La première fois, Android demande d'autoriser l'installation depuis TPR Live.
- Le dépôt GitHub doit être **public** (sinon le PC ne peut pas vérifier les mises à jour).

## Clé de signature privée (recommandé)
La clé du dossier `mobile/signing/` est publique (le dépôt l'est) : n'importe qui pourrait signer un faux APK qui s'installerait par-dessus. Pour y remédier une fois :
1. `keytool -genkeypair -keystore tpr.keystore -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=TPR Live"`
2. `base64 -w0 tpr.keystore` (sur Windows : `certutil -encode`), puis copier le résultat dans un **secret GitHub** nommé `ANDROID_KEYSTORE_B64` (Settings → Secrets and variables → Actions).
3. Garder `tpr.keystore` en lieu sûr, **jamais dans le dépôt**. Publier une nouvelle version (tag). Désinstaller l'ancien APK **une seule fois** (la signature change), puis installer le nouveau.
Tant que le secret n'existe pas, la compilation utilise l'ancienne clé comme avant.

## Important : première installation après cette correction
L'ancien APK était signé avec une clé différente à chaque compilation. **Désinstallez l'ancien APK une seule fois**, puis installez le nouveau. Les mises à jour suivantes s'installeront normalement par-dessus.
