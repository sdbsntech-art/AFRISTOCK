# Déploiement AfriStock

AfriStock peut être utilisé en local ou déployé sur Vercel.

## 1. Utilisation locale (recommandée pour stocker vos données sur cet ordinateur)

1. Lancez `npm run dev`
2. Ouvrez l'application sur `http://127.0.0.1:4173`
3. Connectez-vous ou créez votre compte propriétaire lors du premier lancement.

## 2. Déploiement Vercel

Le fichier `vercel.json` et la fonction `api/index.js` assurent la redirection des routes `/api/*` vers le moteur AfriStock.
- Sur Vercel, la session et le stockage temporaire utilisent le répertoire sécurisé `/tmp`.
- Aucune configuration bloquante n'entrave l'affichage ou l'utilisation du formulaire de connexion / inscription.
