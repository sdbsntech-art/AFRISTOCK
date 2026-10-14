# Migration AfriStock vers Vercel et Supabase

Le serveur utilise PostgreSQL Supabase pour les comptes, les profils, les paramètres Google, les catégories, les produits, les ventes, les lignes de vente et les mouvements de stock. Les mots de passe conservent leur hachage scrypt; aucun mot de passe en clair n'est exporté. Les tables ne sont pas accessibles aux rôles `anon` ou `authenticated` : le site passe par l'API serveur avec une connexion PostgreSQL privée.

La migration copie les données et leurs identifiants, garde la base SQLite locale intacte et s'arrête si la source est invalide ou si une table métier Supabase contient déjà des lignes. Elle ne supprime ni ne remplace automatiquement les données dans Supabase.

## 1. Préparer la base Supabase

1. Dans Supabase, ouvrez **SQL Editor** et exécutez [`supabase/app_schema.sql`](./supabase/app_schema.sql).
2. Pour la migration locale, ouvrez **Connect → Connection string**, choisissez le **Session pooler** et copiez l'URI PostgreSQL. Gardez le mot de passe privé. N'utilisez pas la clé publishable `sb_publishable_...` comme mot de passe SQL.
3. Le script de schéma supprime l'ancienne table `afristock_usage` si elle existe : le suivi séparé par tableau de bord admin a été retiré, conformément à la demande.

## 2. Migrer les données SQLite depuis votre ordinateur

1. Mettez les écritures en pause, arrêtez les processus qui utilisent SQLite, puis faites une copie de sauvegarde de `data/store.db` ainsi que de `data/store.db-wal` et `data/store.db-shm` si ces fichiers existent. Ne supprimez pas la base d'origine. Assurez-vous aussi que ce fichier SQLite est bien la source des données de production que vous souhaitez transférer.
2. Créez un fichier local `.env` à la racine à partir de [`.env.example`](./.env.example), puis collez-y la chaîne PostgreSQL privée dans `SUPABASE_DB_URL`. Générez une valeur longue et aléatoire pour `SESSION_SECRET`. Ne publiez et ne transmettez pas ce fichier.
3. Vous pouvez d'abord exécuter `npm run migrate:supabase -- --dry-run`. Cette vérification ne se connecte pas à Supabase et ne modifie aucune donnée.
4. Après avoir vérifié que SQLite contient bien les données de production, exécutez `npm run migrate:supabase`. La commande copie les sept tables dans une transaction PostgreSQL, conserve les IDs, protège les anciens mots de passe non hachés avant transfert et règle les séquences d'IDs. En cas d'erreur, elle annule la transaction. La source SQLite reste inchangée.
5. Si la migration indique que les tables Supabase contiennent déjà des données, arrêtez-vous et faites vérifier ces données avant toute action. Ne videz pas les tables pour contourner le contrôle.
6. Vérifiez dans Supabase les nombres de lignes des tables et testez une connexion et des ventes avant de considérer la migration validée.

## 3. Configurer le déploiement Vercel

Dans **Vercel → Project → Settings → Environment Variables**, ajoutez pour Production (et Preview uniquement si nécessaire) :

- `SUPABASE_DB_URL` : une URI privée copiée dans **Connect → Connection string → Transaction pooler**. Vercel exécute des fonctions serverless : utilisez le port et l'utilisateur indiqués par Supabase pour le transaction pooler (généralement le port `6543`), pas l'URI session `5432` utilisée pour migrer localement.
- `SESSION_SECRET` : le même secret long généré à l'étape 2.
- `APP_ORIGIN` : l'origine publique exacte du site, par exemple `https://mon-site.vercel.app`, sans chemin ni slash final.
- `GOOGLE_CLIENT_ID` : seulement si l'authentification Google est utilisée et n'est pas configurée dans les paramètres du logiciel.

Ne mettez pas `SUPABASE_DB_URL` ni un mot de passe PostgreSQL dans une variable `VITE_*`, le code du navigateur, un dépôt Git ou un message. Les valeurs doivent être définies dans Vercel avant le déploiement. Redéployez ensuite le projet. Le backend limite le pool Node à une connexion par instance et stocke les sessions vendeur dans PostgreSQL. L'URI doit garder le mode TLS `sslmode=require` fourni par Supabase.

## 4. Vérifier avant de supprimer quoi que ce soit

Testez, sur le domaine Vercel, une connexion avec un compte existant, l'affichage des produits et de l'historique, la création d'une vente, puis la persistance après reconnexion et redéploiement. Gardez la base SQLite et ses fichiers WAL/SHM en sauvegarde jusqu'à ce que ces vérifications soient concluantes. Le code local est prêt, mais ce dépôt ne peut pas modifier le projet Vercel ni effectuer son déploiement à votre place.
