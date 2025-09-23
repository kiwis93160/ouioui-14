# Pense-bête Netlify / Firebase

## API d'authentification PIN

- La fonction Cloud `verifyPinAndIssueToken` lit la liste des origines autorisées à partir de
  `functions.config().app.allowed_origins` (ou de la variable d'environnement `ALLOWED_ORIGINS`).
  Les valeurs peuvent être fournies sous forme de liste séparée par des virgules. À défaut de
  configuration, la fonction retombe sur les domaines historiques :
  - https://admin.ouiouitacos.com
  - https://ouiouitacos-admin.netlify.app
  - https://main--ouiouitacos-admin.netlify.app
  - https://posouioui.netlify.app
- Toute requête (POST ou prévol `OPTIONS`) provenant d'une autre origine reçoit une réponse **403 origin-not-allowed**.
- Mettre à jour la configuration d'environnement (ou les domaines de secours dans
  `functions/index.js`) lors de l'ajout ou la suppression de fronts.

## Déploiement Firebase

Après modification de la fonction :

```bash
firebase deploy --only functions:verifyPinAndIssueToken
```

Penser à monitorer la console Firebase pour vérifier l'absence d'erreurs et tester l'authentification depuis l'interface Admin Netlify une fois le déploiement terminé.
