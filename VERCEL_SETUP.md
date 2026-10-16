# Déployer AfriStock sur Vercel avec MySQL

Vercel héberge le site et son API, mais pas un serveur MySQL persistant. Il faut une base MySQL managée accessible depuis Internet (par exemple chez un fournisseur MySQL compatible TLS). Le site se connecte directement à cette base via son API serveur. SQLite local et la base MySQL de Laragon ne sont pas accessibles depuis Vercel.

Le backend de ce projet utilise MySQL (`mysql2`).

## 1. Créer et initialiser une base MySQL hébergée

1. Créez une base MySQL et un utilisateur dédiés chez le fournisseur choisi. Autorisez les connexions depuis Vercel selon les consignes de ce fournisseur et activez TLS.
2. Gardez le nom d’hôte, le port, le nom de la base, l’utilisateur et le mot de passe fournis. Ne publiez pas ces informations.
3. Dans l’éditeur SQL du fournisseur, sélectionnez la base nouvellement créée et exécutez le contenu de [`mysql/schema.sql`](./mysql/schema.sql). Si le fournisseur n’autorise pas `CREATE DATABASE` ou `USE`, retirez ces deux instructions du début du script avant exécution : le schéma doit être appliqué dans la base déjà sélectionnée.
4. Le schéma ne crée aucun compte, catégorie ou produit. Le premier compte propriétaire se crée une seule fois depuis l’application. En production, l’inscription publique est bloquée : effectuez cette première création depuis une instance locale sécurisée connectée à la base voulue. Une fois le compte créé, l’inscription publique reste fermée.

Si vous avez déjà des données MySQL, faites d’abord une sauvegarde complète, puis importez cette sauvegarde dans la base hébergée au moyen des outils de migration du fournisseur. Ne réexécutez pas le script d’initialisation sur une base contenant des données sans avoir vérifié son effet.

Si vos anciennes données sont uniquement dans SQLite, elles ne sont pas copiées automatiquement. Exportez et vérifiez toute donnée à conserver séparément avant de préparer une base MySQL neuve.

## 2. Configurer les variables Vercel

Dans **Vercel → Project → Settings → Environment Variables**, ajoutez en **Production** :

- `MYSQL_URL` : URL privée `mysql://utilisateur:mot-de-passe@hôte:port/base`. Encodez les caractères spéciaux du nom d’utilisateur et du mot de passe au format URL (par exemple `%40` pour `@`). Cette valeur reste côté serveur ; ne la mettez jamais dans une variable `VITE_*`.
- `SESSION_SECRET` : une clé aléatoire d’au moins 32 octets. Générez-en une différente du mot de passe MySQL.
- `GOOGLE_CLIENT_ID` : uniquement si vous activez la connexion Google.
- `MYSQL_SSL_CA` : uniquement si votre hébergeur exige un certificat CA privé. Les certificats TLS publics sont validés automatiquement.

Ne définissez pas `MYSQL_SSL=false` ni `MYSQL_SSL_REJECT_UNAUTHORIZED=false` en production. Le pool utilise une connexion par instance Vercel par défaut afin de limiter le nombre de connexions simultanées.

Pour les environnements **Preview**, utilisez une base de test séparée ; ne pointez pas les aperçus vers la base de production. Après avoir ajouté les variables, redéployez le projet.

## 3. Déployer et vérifier

Vercel doit détecter le projet Node.js, exécuter `npm run build` et servir le dossier `dist`. L’API Express est exposée par [`api/[...path].js`](./api/[...path].js). Une absence de `MYSQL_URL` ou un secret de session trop court fait échouer explicitement l’initialisation en production au lieu d’essayer de se connecter à MySQL local.

Sur le domaine de production, vérifiez la page de connexion, les comptes, l’affichage des produits et de l’historique, la création d’une vente, puis la persistance des données et de la session après reconnexion. Gardez une sauvegarde de la base source jusqu’à la fin de ces vérifications.

Le dépôt peut préparer l’application, mais la création de la base distante, l’ajout de ses secrets dans Vercel et le déploiement doivent être faits dans vos comptes fournisseur/Vercel. Ne partagez jamais ici un mot de passe ou une URL MySQL privée.

AfriStock est une PWA installable sur Android et les navigateurs compatibles Windows, macOS et Linux ; iOS/iPadOS permet l’ajout à l’écran d’accueil depuis Safari. Le mode hors ligne ne met jamais les réponses de l’API en cache : les données métier nécessitent une connexion à MySQL.
