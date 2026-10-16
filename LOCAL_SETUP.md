# Utiliser AfriStock en local

AfriStock utilise JavaScript/Node.js pour le site et son API, et MySQL pour les données. Les mots de passe sont hachés avec `node:crypto` (Scrypt, sel aléatoire unique et comparaison en temps constant). Python n’est pas nécessaire à l’exécution de l’application.

## Première installation

1. Installez les dépendances avec `npm install` si nécessaire.
2. Démarrez MySQL dans Laragon.
3. Dans PowerShell, à la racine du projet, lancez `npm run db:init`. Cette commande prépare les tables et ne crée aucun compte, catégorie ou produit.
4. Lancez `npm run dev`, puis ouvrez `http://127.0.0.1:4173`.
5. Créez le premier compte propriétaire depuis le formulaire de première installation. Son mot de passe est haché automatiquement. Après cette première inscription, la création publique de comptes est fermée ; l’administrateur peut ensuite gérer les comptes vendeurs.

Les données de chaque vendeur (catégories, produits, ventes et mouvements) sont limitées à son compte. L’administrateur peut gérer les comptes et superviser leurs stocks.

## Données neuves et sauvegardes

Les données de démonstration ont été retirées et les bases locales ont été remises à zéro après sauvegarde. La sauvegarde confidentielle a été enregistrée dans `%LOCALAPPDATA%\AfriStock\backups\before-clean-install-20261016`. Garde ce dossier privé ; il contient des informations de compte et des hashes de mots de passe. La base SQLite historique n’est plus utilisée par le site. Ne lance pas l’ancien outil de migration SQLite si tu veux garder l’application vide.

Fais des sauvegardes régulières de la base MySQL avec HeidiSQL ou l’outil de sauvegarde de Laragon. Ne place pas ces sauvegardes dans un dépôt Git, un dossier public ou un service de partage.

## Application installable sur téléphone et ordinateur

AfriStock est une PWA : Chrome/Edge peuvent l’installer sur Android et sur les ordinateurs compatibles Windows, macOS et Linux. Sur iPhone/iPad, dans Safari, choisis **Partager → Sur l’écran d’accueil**. Une installation publiée nécessite HTTPS ; `localhost` est accepté pour les essais sur ce PC.

Pour tester la version installable localement, compile puis démarre l’aperçu PWA :

```powershell
npm run build
npm run pwa:local
```

Ouvre `http://127.0.0.1:4173` dans Chrome ou Edge et utilise le bouton **Installer l’application** si le navigateur le propose. Garde Laragon et les deux services locaux en marche. L’interface statique peut s’ouvrir hors ligne, mais les comptes et données métier ne sont jamais mis en cache dans le navigateur : ils nécessitent MySQL.
