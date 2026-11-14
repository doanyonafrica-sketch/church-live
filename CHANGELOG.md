# Journal des changements

Les numéros de version sont attribués automatiquement à chaque envoi sur `main` (voir « Publier une nouvelle version » dans le README) ; l'historique complet est dans les **Releases** GitHub. Ce fichier résume les changements par lot.

## Non publié

### Ajouts
- **Journal automatique du direct** : le PC enregistre tout seul, dans le dossier de données (`journal/journal-AAAA-MM-JJ.jsonl`, conservé 30 jours), les connexions, coupures, reprises, mesures réseau toutes les 10 s, et les événements envoyés par le téléphone (même ceux survenus hors connexion) et par la page OBS. Aucun code, image ni son. Page **`/rapport.html`** (PC uniquement) : résumé lisible, copie et téléchargement. Ligne de commande : `node server/tools/rapport.js [jours] [dossier]`. Désactivable avec `TPR_NO_JOURNAL=1`.
- **Reconnexion fiable après une mauvaise connexion** : battement de cœur (ping) toutes les 3 s côté téléphone et côté OBS, nouvelle liaison si le PC ne répond plus pendant 9 s, reconnexion immédiate au retour du réseau, et OBS peut demander au téléphone de renégocier la vidéo quand l'image n'arrive plus.
- **Service « Direct en cours » (Android)** : pendant le direct, notification permanente et service au premier plan caméra + micro, pour qu'Android ne gèle ni ne tue l'application (écran verrouillé, changement d'application). Ne gêne jamais le direct : si Android refuse, tout continue comme avant. Les anciens APK ne sont pas affectés.
- **Test de la page OBS** (`server/test/obs.js`) : adresse et code envoyés au PC, reconnexions, « à l'antenne », écran d'attente, réglages `?delay=` et `?vol=`.
- **Test de cohérence Android** (`server/test/android.js`) : chaque appel `TPRNative` de la page existe côté Android ; le service, ses permissions et le workflow restent alignés.
- **Test du flux vidéo réel des caméras IP** : exécuté automatiquement avec un serveur RTSP de test (MediaMTX, version et empreinte SHA-256 épinglées).
- **Test de longue durée** lançable à la main depuis l'onglet Actions (durée au choix, 3 h pour un culte).
- **Signature facultative de l'installeur Windows** (secrets `WIN_CSC_LINK` et `WIN_CSC_KEY_PASSWORD`).

### Modifications
- L'APK est maintenant compilé en **release** (non débogable), aligné puis signé avec la même clé qu'avant ; la compilation contrôle la signature, l'absence de mode débogage, le service et les permissions.
- Node 22 dans tous les workflows (Node 20 n'est plus maintenu) ; `ws` 8.23.0.
- Le repli sur une clé de signature publique (`ALLOW_PUBLIC_KEY`) est supprimé : le dossier `mobile/signing/` n'existe plus et la clé doit rester privée.
- Le test des caméras IP lance MediaMTX dans un dossier temporaire (il y crée un certificat auto-signé) ; `.gitignore` protège `server/auto.key` et `server/auto.crt`.
- README : section de signature unifiée (elle se contredisait), section de transition obsolète retirée, « Vérifications sur le terrain » et « Limites connues » ajoutées.

### À savoir
- Android 13 et plus : l'application demande l'autorisation d'afficher les notifications au premier lancement. Refuser n'empêche pas le service de fonctionner.
