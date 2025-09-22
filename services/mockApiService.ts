
/*
 * =====================================================================================
 *  FICHIER DÉPRÉCIÉ : Ce service de simulation d'API n'est plus utilisé.
 * =====================================================================================
 *
 * Ce fichier a été remplacé par le service `apiService.ts` qui se connecte directement
 * à Firebase. L'ancienne logique de simulation a été supprimée pour éviter toute incohérence.
 *
 * --- POUR LE DÉVELOPPEMENT LOCAL ---
 *
 * Il est fortement recommandé d'utiliser la Firebase Local Emulator Suite.
 * C'est un ensemble d'outils qui vous permet de lancer une version locale des services Firebase
 * (Realtime Database, Authentication, etc.) directement sur votre machine.
 *
 * AVANTAGES :
 * - Développement hors ligne.
 * - Environnement à haute fidélité qui se comporte comme la production.
 * - Pas de risque de modifier les données de production.
 * - Pas besoin de maintenir un service de simulation complexe.
 *
 * --- COMMENT COMMENCER AVEC LA SUITE D'ÉMULATION ---
 *
 * 1. Installer la Firebase CLI : `npm install -g firebase-tools`
 * 
 * 2. Initialiser Firebase dans votre projet : `firebase init`
 *    - Sélectionnez "Emulators" et configurez-le pour la "Realtime Database".
 *    - Un fichier `firebase.json` sera créé.
 *
 * 3. Démarrer les émulateurs : `firebase emulators:start`
 *
 * 4. (Optionnel) Modifier `services/firebaseConfig.ts` pour qu'il se connecte aux émulateurs
 *    automatiquement lorsque vous êtes en développement. Vous pouvez utiliser `connectDatabaseEmulator`
 *    du SDK Firebase.
 *
 *    Exemple :
 *    
 *    import { connectDatabaseEmulator } from "firebase/database";
 *    if (window.location.hostname === "localhost") {
 *      connectDatabaseEmulator(database, "localhost", 9000);
 *    }
 * 
 * =====================================================================================
 */

// Le contenu a été intentionnellement supprimé.

export const api = {};
