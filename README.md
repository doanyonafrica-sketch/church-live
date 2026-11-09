# TPR Live : téléphone → OBS (sans lag)
- `server/` : serveur Node + pages web (`phone.html`, `obs.html`, `control.html`)
- `mobile/` : enveloppe Capacitor → APK (compilé par GitHub Actions)
- `desktop/` : enveloppe Electron → installeur Windows (compilé par GitHub Actions)
- `mobile/signing/` : clé de signature fixe de l'APK (nécessaire pour que les mises à jour s'installent par-dessus)
- `mobile/patch/` : `MainActivity` qui garde le Wi-Fi en haute performance pendant le direct

## Obtenir les applications
Onglet **Actions** du dépôt → dernier « Release » (APK et PC compilés ensemble). « Build Windows » ne se lance plus qu'à la main.

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

## Fenêtre du PC : vue simple et réglages des téléphones
Pour chaque caméra, la fenêtre affiche d'abord **un état et une phrase** : « Tout va bien », « À surveiller » ou « Problème », avec le conseil à suivre (rapprocher le téléphone du routeur, brancher la batterie…), puis quatre repères : connexion (Excellente → Mauvaise), batterie, image et durée du direct. Le bouton **Détails techniques** (réglage mémorisé sur le PC) affiche en plus toutes les mesures décrites plus bas.

Sous chaque caméra, **« Régler ce téléphone depuis le PC »** permet de changer sans toucher au téléphone : qualité de l'image, priorité netteté/fluidité, image fluide de nuit, compression, volume du micro, couper/réactiver le micro, flash et zoom (si la caméra du téléphone les propose).
- **Le téléphone reste maître et garde tous ses réglages et son bouton Démarrer/Terminer.** Un réglage peut être changé sur le téléphone ou sur le PC : le dernier changement fait foi, et le PC affiche toujours la valeur réelle rapportée par le téléphone (toutes les 3 s et à chaque changement).
- Ces réglages s'appliquent **tout de suite**, y compris ceux de l'écran Réglages du téléphone (avant, certains attendaient le démarrage suivant). Micro, flash, zoom, priorité et image de nuit n'interrompent pas l'image. **Qualité et compression** (et le retour de l'image de nuit à « Normal ») rouvrent la caméra : l'image se fige une ou deux secondes. Si la caméra est **à l'antenne**, le PC demande confirmation avant.
- Le numéro de caméra, l'adresse du PC et le code d'appairage ne se règlent que sur le téléphone.
- Le téléphone n'est joignable qu'**une fois le direct démarré** (c'est là qu'il se connecte au PC) : démarrez-le, puis réglez depuis le PC.
- Seul le PC lui-même peut envoyer ces ordres (même protection que les caméras IP) ; le téléphone revérifie chaque valeur reçue. Il faut **mettre à jour le PC et le téléphone** : un ancien APK continue de fonctionner, mais le PC indique qu'il doit être mis à jour pour être réglé à distance.

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
## Sécurité de la signature (obligatoire)
La clé du dossier `mobile/signing/` est publique (le dépôt l'est) : n'importe qui pourrait signer un faux APK qui s'installerait par-dessus. **La compilation est donc refusée tant que le secret n'existe pas.** À faire une fois :
1. Créer une clé privée : `keytool -genkey -v -keystore tpr.keystore -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=TPR Live"`
2. `base64 -w0 tpr.keystore` (sur Windows : `certutil -encode`), puis copier le résultat dans un **secret GitHub** nommé `ANDROID_KEYSTORE_B64` (Settings → Secrets and variables → Actions).
3. Supprimer ensuite `mobile/signing/debug.keystore` du dépôt.

**Dépannage / transition** : pour compiler quand même avec l'ancienne clé publique (déconseillé), créer la *variable* GitHub (Settings → Secrets and variables → Actions → Variables) `ALLOW_PUBLIC_KEY` = `true`. Un avertissement apparaît à chaque compilation. Changer de clé oblige à désinstaller l'ancien APK une seule fois.

## Protections intégrées
- **Tests avant chaque publication** : `release.yml` lance `npm test` (appairage, sécurité, WebRTC, caméras). Un test rouge empêche la publication.
- **Pages malveillantes** : le WebSocket et l'API caméras refusent les requêtes venant d'un autre site, d'un nom de domaine (DNS rebinding) ou marquées « inter-sites » par le navigateur.
- **Mise à jour de l'APK vérifiée** : le téléphone compare l'empreinte SHA-256 du fichier téléchargé à celle publiée avec la version (`apk-version.json` sur le PC, et sur GitHub quand le téléphone a Internet : si les deux diffèrent, la mise à jour est refusée). Sans empreinte valide, rien ne s'installe.
- **Reprise automatique de la caméra** : si un appel téléphonique, une autre application ou une panne coupe la caméra ou le micro (ou si l'image se fige 8 secondes), le téléphone la rouvre tout seul et reprend le direct, sans toucher l'écran.
- **Alertes sur le téléphone** : « le téléphone chauffe » (Android 10+) et « batterie faible, branchez-le » apparaissent sur le téléphone et sur le PC avant que l'image ne se dégrade.
- **Fermeture protégée (PC)** : fermer TPR Live pendant qu'un téléphone est en direct demande confirmation. Une seule copie du programme à la fois, et Windows ne se met plus en veille pendant que TPR Live tourne.
- **Mises à jour hors direct (PC)** : la mise à jour ne se télécharge ni ne s'annonce tant qu'un téléphone est en direct.
- **Journal d'erreurs (PC)** : `tpr-live.log` dans le dossier de données (`%APPDATA%\TPR Live`). Une erreur inattendue y est notée au lieu d'interrompre le programme.
- **Pare-feu (PC)** : au premier lancement, TPR Live propose d'autoriser les téléphones (Windows demande l'accord de l'administrateur une seule fois). À la main : `netsh advfirewall firewall add rule name=TPRLive dir=in action=allow protocol=TCP localport=3000 profile=any` dans une invite de commandes administrateur.
- **Mots de passe des caméras IP chiffrés** sur le PC (liés à la session Windows).
- **Serveur durci** : au plus 16 caméras simultanées, et un appareil qui inonde le serveur de messages est déconnecté.
- **Tests** : `npm test` (appairage, sécurité, page téléphone, programme Windows, WebRTC, caméras). `npm run soak` simule une liaison vidéo avec coupures Wi-Fi ; pour un vrai culte : `SOAK_SECONDS=10800 npm run soak` (3 heures).
- Limite connue : le code d'appairage et la vidéo circulent en clair sur le réseau local (pas de HTTPS). À utiliser sur un Wi-Fi de confiance.

## Important : première installation après cette correction
L'ancien APK était signé avec une clé différente à chaque compilation. **Désinstallez l'ancien APK une seule fois**, puis installez le nouveau. Les mises à jour suivantes s'installeront normalement par-dessus.

## Dernières améliorations (fluidité, son, interface)

- **Image fluide et nette** : débits relevés (480p = 2 Mb/s, 720p = 5 Mb/s, 1080p = 8 Mb/s) avec un débit de départ élevé et un plancher, pour que l'image ne s'étrangle pas dès qu'on bouge la caméra. La baisse automatique de qualité ne se déclenche plus qu'après 5 secondes de vrai problème (processeur surchargé, pertes ou retard réseau), ne descend jamais sous ~480p, et la qualité remonte seule après un calme prolongé (sans yo-yo, même si la lumière est faible). Réglage **Priorité** : « Netteté » (par défaut) garde la définition et le débit en toutes circonstances, quitte à laisser sauter des images si le téléphone ou le réseau peine ; « Fluidité » garde 30 images/s et accepte de baisser la définition. Le tampon anti-saccades d'OBS reste à 250 ms (`obs.html?delay=150` plus réactif, `?delay=400` plus fluide).
- **Son** : le micro est filtré (basses parasites), baissé par défaut (réglage « Volume du micro », 50 %) et limité (plus de pics trop forts). Si ça « siffle » encore : dans OBS, mettre l'écoute audio de la source sur « Écoute coupée » (clic droit sur la source dans le mélangeur audio), ou ajouter `?vol=0.6` à l'adresse de la source.
- **Interface téléphone** : l'image de la caméra occupe tout l'écran. Les commandes flottent sur le côté, se cachent seules pendant le direct (toucher l'écran pour les faire revenir), et la barre « à l'antenne » est devenue une petite pastille.
- **Écran d'attente** (`attente.mp4` / `attente.webm` dans `server/public`) : la vidéo de l'aigle tourne en fond, avec la date, un texte d'état et une barre de chargement, sur le téléphone tant que la caméra n'est pas lancée ou ne fournit plus d'image, et dans OBS tant qu'aucune image n'arrive (caméra absente, connexion en cours, image figée). Pour la changer, remplacer ces deux fichiers (idéalement en 16:9, 1920×1080).
