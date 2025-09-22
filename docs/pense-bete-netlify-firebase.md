# Pense-bête Netlify / Firebase

## API d'authentification PIN

- La fonction Cloud `verifyPinAndIssueToken` n'accepte que les origines suivantes :
  - https://admin.ouiouitacos.com
  - https://ouiouitacos-admin.netlify.app
  - https://main--ouiouitacos-admin.netlify.app
- Toute requête (POST ou prévol `OPTIONS`) provenant d'une autre origine reçoit une réponse **403 origin-not-allowed**.
- Mettre à jour la liste dans `functions/index.js` en cas d'ajout/suppression de domaines frontaux.

## Déploiement Firebase

Après modification de la fonction :

```bash
firebase deploy --only functions:verifyPinAndIssueToken
```

Penser à monitorer la console Firebase pour vérifier l'absence d'erreurs et tester l'authentification depuis l'interface Admin Netlify une fois le déploiement terminé.
