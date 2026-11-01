# Church Live : téléphone → OBS (sans lag)
- `server/` : serveur Node + pages web (`phone.html`, `obs.html`, `control.html`)
- `mobile/` : enveloppe Capacitor → APK (compilé par GitHub Actions)
- `desktop/` : enveloppe Electron → installeur Windows (compilé par GitHub Actions)
- `android-native/` : version Android native (secours, optionnelle)

## Obtenir les applications
Onglet **Actions** du dépôt → dernier « Build APK » / « Build Windows » → télécharger l'artefact (`church-live-apk`, `church-live-windows`).

## Utilisation
1. PC : installer et lancer **Church Live** ; la fenêtre affiche l'adresse OBS et l'adresse à saisir sur le téléphone.
2. OBS : Source Navigateur → adresse affichée (`http://localhost:3000/obs.html`), cocher « Contrôler l'audio via OBS ».
3. Téléphone (APK) : saisir l'adresse du PC → Démarrer le direct.
4. Mode USB : Paramètres du téléphone → Partage de connexion → Partage par USB, puis utiliser l'adresse affichée par le PC.
5. Autoriser Church Live dans le pare-feu Windows (réseau privé).

## Développement
`cd server && npm install && npm test` ; `npm start` pour lancer le serveur seul.
