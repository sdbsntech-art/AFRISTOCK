# Utiliser AfriStock en local

AfriStock utilise JavaScript/Node.js pour le site et son API, et MySQL pour les données. Les mots de passe sont hachés avec `node:crypto` (Scrypt, sel aléatoire unique et comparaison en temps constant). Python n’est pas nécessaire à l’exécution de l’application.

Le logiciel fonctionne exclusivement sur cet ordinateur : l’API écoute sur `127.0.0.1`, et les connexions MySQL distantes, `MYSQL_URL` et les fonctions Vercel sont refusées.

## Première installation

1. Installez les dépendances avec `npm install` si nécessaire.
2. Créez votre fichier local de configuration : `Copy-Item .env.example .env`.
3. Générez un secret de session aléatoire avec `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` puis copiez le résultat dans `SESSION_SECRET` du fichier `.env`. Ne partagez pas ce secret.
4. Démarrez MySQL dans Laragon et définissez un mot de passe sur le compte MySQL utilisé par l’application ; renseignez-le dans `MYSQL_PASSWORD` du fichier `.env`.
5. Dans PowerShell, à la racine du projet, lancez `npm run db:init`. Cette commande prépare les tables et ne crée aucun compte, catégorie ou produit.
6. Lancez `npm run dev`, puis ouvrez `http://127.0.0.1:4173`.
7. Créez le premier compte propriétaire depuis le formulaire de première installation. Son mot de passe est haché automatiquement. Après cette première inscription, la création publique de comptes est fermée ; l’administrateur peut ensuite gérer les comptes vendeurs.

Les données de chaque vendeur (catégories, produits, ventes et mouvements) sont limitées à son compte. L’administrateur peut gérer les comptes et superviser leurs stocks. Pour renforcer MySQL local, configure un mot de passe sur le compte MySQL utilisé par l’application et remplace `MYSQL_PASSWORD` dans ton fichier `.env` ; ne publie jamais ce fichier.

## Données neuves et sauvegardes

Les données de démonstration ont été retirées et les bases locales ont été remises à zéro après sauvegarde. La sauvegarde confidentielle a été enregistrée dans `%LOCALAPPDATA%\AfriStock\backups\before-clean-install-20261016`. Garde ce dossier privé ; il contient des informations de compte et des hashes de mots de passe. La base SQLite historique n’est plus utilisée par le site. Ne lance pas l’ancien outil de migration SQLite si tu veux garder l’application vide.

Fais des sauvegardes régulières de la base MySQL avec HeidiSQL ou l’outil de sauvegarde de Laragon. Ne place pas ces sauvegardes dans un dépôt Git, un dossier public ou un service de partage.

## Application installable sur téléphone et ordinateur

AfriStock peut être installé comme PWA dans Chrome/Edge sur l’ordinateur où il tourne. En mode local uniquement, l’API reste attachée à cet ordinateur : l’application n’est pas accessible depuis un téléphone ni depuis Internet.

Pour tester la version installable localement, compile puis démarre l’aperçu PWA :

```powershell
npm run build
npm run pwa:local
```

Ouvre `http://127.0.0.1:4173` dans Chrome ou Edge et utilise le bouton **Installer l’application** si le navigateur le propose. Garde Laragon et les deux services locaux en marche. L’interface statique peut s’ouvrir hors ligne, mais les comptes et données métier ne sont jamais mis en cache dans le navigateur : ils nécessitent MySQL.
