# Hébergement Vercel désactivé

AfriStock utilise maintenant **uniquement le MySQL installé sur l’ordinateur qui exécute l’application**. L’API refuse les connexions MySQL distantes et refuse de démarrer dans les fonctions serverless de Vercel. Une application Vercel ne peut pas accéder au MySQL de votre ordinateur.

Pour utiliser le logiciel, démarrez MySQL dans Laragon, puis lancez AfriStock localement en suivant [LOCAL_SETUP.md](./LOCAL_SETUP.md). Les données et les sessions restent sur cet ordinateur.

N’ajoutez pas `MYSQL_URL` dans les variables Vercel. Si un ancien déploiement ou une ancienne base distante existe, ce changement de code ne les supprime pas : supprimez le projet Vercel et la base distante depuis les tableaux de bord concernés uniquement si vous êtes certain de ne plus en avoir besoin. Faites d’abord une sauvegarde des données à conserver.
