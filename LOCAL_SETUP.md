# Utiliser AfriStock en local

AfriStock tourne uniquement sur cet ordinateur. Les données sont enregistrées dans un fichier **SQLite** local. Les mots de passe sont hachés avec Scrypt (`node:crypto`). MySQL et Laragon ne sont plus nécessaires.

## Première installation

1. Installez Node.js 22.5 ou plus récent (SQLite est fourni par `node:sqlite`).
2. Dans le dossier du projet, lancez `npm install`.
3. Lancez `npm run dev`.
4. Ouvrez `http://127.0.0.1:4173`.
5. Configurez `SUPER_ADMIN_EMAIL` avec l’adresse du propriétaire (par défaut `sdbnstech@gmail.com`), puis créez le premier compte avec cette adresse. Après cette étape, les inscriptions publiques sont fermées ; le super-administrateur peut ajouter des vendeurs, mais aucun autre compte ne peut recevoir ses droits.

Le secret de session et la base sont créés automatiquement dans `%LOCALAPPDATA%\AfriStock\` :

- `.env` — secret de session
- `afristock.sqlite` — toutes les données (comptes, stock, ventes)

Les permissions du dossier et de ses fichiers sont restreintes à votre compte Windows et au système. Gardez ce dossier privé. Ne le copiez pas dans Git ni sur un service public.

Pour une installation PowerShell, définissez la variable avant de lancer l’application :

```powershell
$env:SUPER_ADMIN_EMAIL = "sdbnstech@gmail.com"
npm run dev
```

Pour le déploiement, définissez la même variable dans la configuration d’environnement de l’hébergeur. Les anciens comptes avec le rôle `admin` ne conservent les droits super-administrateur que si leur adresse correspond à cette valeur.

## Commandes

```powershell
npm run dev          # site + API locale
npm run db:init      # crée / vérifie le fichier SQLite
npm test             # tests
```

L’API n’écoute que sur `127.0.0.1`. Aucune base distante n’est acceptée.
