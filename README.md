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
3. Téléphone (APK) : saisir l'adresse du PC → Démarrer le direct.
4. Mode USB : Paramètres du téléphone → Partage de connexion → Partage par USB, puis utiliser l'adresse affichée par le PC.
5. Autoriser TPR Live dans le pare-feu Windows (réseau privé).

## Développement
`cd server && npm install && npm test` ; `npm start` pour lancer le serveur seul.

## Publier une nouvelle version (mises à jour automatiques)
1. `git add . && git commit -m "description" && git push`
2. `git tag v1.0.1 && git push origin v1.0.1` (numéro supérieur au précédent)
3. GitHub compile et publie une **Release** avec l'installeur Windows et `church-live.apk`.
- **PC Windows** : l'application détecte la nouvelle version au démarrage, la télécharge et propose de redémarrer.
- **Téléphone** : l'application affiche « Nouvelle version disponible » ; un appui télécharge l'APK, puis on l'installe (Android n'autorise pas l'installation silencieuse hors Play Store).


## Important : première installation après cette correction
L'ancien APK était signé avec une clé différente à chaque compilation. **Désinstallez l'ancien APK une seule fois**, puis installez le nouveau. Les mises à jour suivantes s'installeront normalement par-dessus.
