# Calmgram

Instagram web dans une appli Android, sans Reels ni suggestions, qui s'ouvre sur le feed des abonnements.

## Ce que fait l'appli

Chaque comportement ci-dessous a son interrupteur. Tous sont activés par défaut.

| Situation | Comportement |
|---|---|
| Ouverture | `/?variant=following` (feed des abonnements) |
| Bouton Accueil (`/`) | redirigé vers le feed des abonnements, sans rechargement |
| Reels dans le feed | réduits à 1px (le scroll infini continue ; ancrage de scroll coupé pour éviter les retours en arrière) |
| Posts « Suggestions pour vous » | réduits à 1px |
| Publicités (étiquette « Sponsorisée ») | réduites à 1px, dans les deux feeds |
| Bouton Reels de la barre du bas | masqué |
| `/reels/` et `/reels/audio/…` | redirigés vers le feed |
| `/reels/ID` (flux swipable) | redirigé vers `/reel/ID` (Reel seul, pas de swipe) |
| Explorer `/explore/` | redirigé vers `/explore/search/` (recherche seule, sans grille), sans rechargement |
| Liens externes | ouverts dans le navigateur |
| Photos en message | sélecteur de fichiers Android |
| Appels | boutons 📞 et 🎥 en haut d'une conversation : ouvrent la page d'appel d'Instagram (`/call/`) dans l'appli. Appels sortants seulement : l'appli fermée ne sonne pas. |

## Réglages

- **Dans Instagram :** Profil → ⚙ → Paramètres et confidentialité → **Mode calme**, sous « Changer l'apparence ». Si Instagram retire cette ligne, « Mode calme » s'affiche en haut de la page.
- **Raccourci :** appui long sur l'icône → **Mode calme**.
- L'appli s'appelle « Instagram » sur le téléphone (paquet `fr.perso.calmgram`, icône à elle).
- Masquer ou afficher un élément s'applique immédiatement. Une redirection s'applique au prochain tap.
- Les réglages sont gardés dans le stockage du site Instagram, sur le téléphone. S'ils sont effacés, tout revient en mode calme.
- Le thème sombre est celui d'Instagram : Paramètres → Changer l'apparence.

## Ce qu'il y a dedans

- `app/src/main/assets/calmfeed.js` : toutes les règles. C'est le fichier à corriger quand Instagram change.
- `app/src/main/java/fr/perso/calmgram/MainActivity.kt` : la WebView.
- Permissions : Internet, et micro + caméra pour les appels. Android les demande au premier appel ; l'appli ne les donne à la page que sur `https://www.instagram.com/call/`, jamais ailleurs.
- Les boutons d'appel lisent le numéro d'appel de la conversation dans les données internes de la page. Si Instagram change ces données, un tap affiche « Appel indisponible » : le reste de l'appli n'est pas touché.

**Ton identifiant :** la page de connexion est celle d'Instagram. Il n'existe aucun pont entre la page et l'appli (`addJavascriptInterface` n'est pas utilisé), donc l'appli ne peut pas lire ce que tu tapes. `calmfeed.js` lit seulement l'adresse de la page, le texte des posts du feed et ses propres réglages. Sur la page de paramètres, il ajoute la ligne Calmgram sans rien lire. La WebView garde le cookie de session dans les données privées de l'appli, pas le mot de passe.

## Compiler et installer

Prérequis : Java 17 et le SDK Android (voir plus bas).

Téléphone branché, débogage USB autorisé :

```bash
./install.sh
```

Ce script compile l'appli, attend le téléphone, l'installe et l'ouvre. `./install.sh reglages` ouvre directement les réglages.

## Déboguer sur le téléphone

Avec l'APK debug, ouvre `chrome://inspect` dans Chrome ou Chromium sur le PC, téléphone branché : tu as la console et l'inspecteur de la page Instagram dans l'appli.

## Installer les outils (une seule fois)

1. Java 17 :

   ```bash
   sudo apt install openjdk-17-jdk-headless
   ```

2. Le SDK Android, installé en ligne de commande dans `~/Android/Sdk` (Android Studio n'est pas nécessaire). Il faut accepter les licences de Google avec `sdkmanager --licenses`.
3. `local.properties` à la racine du projet :

   ```
   sdk.dir=/home/<toi>/Android/Sdk
   ```

## Avertissement

Projet personnel, sans lien avec Meta, qui n'a ni approuvé ni vérifié ce projet. Instagram et Facebook sont des marques de Meta. L'appli affiche le site web officiel et y ajoute seulement des règles d'affichage. Elle ne modifie pas l'appli officielle, ne lit pas ton identifiant et n'envoie rien ailleurs. Utilise-la à tes risques, dans le respect des conditions d'utilisation de Meta.

## Licence

MIT : voir [LICENSE](LICENSE).
