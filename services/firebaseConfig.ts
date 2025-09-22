
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";
import { getStorage, connectStorageEmulator } from "firebase/storage";

// Your web app's Firebase configuration
// Using Vite's import.meta.env to get environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_DATABASE_URL,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Get references to Firebase services
export const auth = getAuth(app);
export const database = getDatabase(app);
export const storage = getStorage(app);

let resolveAuthReady: (() => void) | null = null;
let authReadyPromise: Promise<void> | null = null;
let anonymousSignInPromise: Promise<void> | null = null;

const createAuthReadyPromise = () => {
  authReadyPromise = new Promise<void>((resolve) => {
    resolveAuthReady = resolve;
  });
};

const ensureAuthReadyPromise = () => {
  if (!authReadyPromise) {
    createAuthReadyPromise();
  }
  return authReadyPromise!;
};

const resolveAuthPromise = () => {
  if (resolveAuthReady) {
    resolveAuthReady();
    resolveAuthReady = null;
  }
};

const startAnonymousSignIn = async (): Promise<void> => {
  if (!anonymousSignInPromise) {
    anonymousSignInPromise = signInAnonymously(auth)
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("Erreur lors de la connexion anonyme à Firebase", error);
        throw error;
      })
      .finally(() => {
        anonymousSignInPromise = null;
      });
  }

  try {
    await anonymousSignInPromise;
  } catch (error) {
    // Propager l'erreur pour que les appels puissent la gérer.
    throw error;
  }
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    resolveAuthPromise();
  } else {
    createAuthReadyPromise();
  }
});

createAuthReadyPromise();

export const ensureFirebaseUser = async (): Promise<void> => {
  if (auth.currentUser) {
    resolveAuthPromise();
    return;
  }

  try {
    await startAnonymousSignIn();
  } catch (error) {
    // Si la connexion anonyme échoue, attendre tout de même un utilisateur
    // valide (par exemple un jeton personnalisé).
    await ensureAuthReadyPromise();
    throw error;
  }

  if (!auth.currentUser) {
    await ensureAuthReadyPromise();
  }
};

// Déclenche un premier cycle d'authentification pour éviter les conditions de course
ensureFirebaseUser().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Impossible d'initialiser l'authentification Firebase", error);
});

/*
// Connect to emulators in development - DISABLED BY USER REQUEST
// To re-enable, uncomment the following block.
if (import.meta.env.DEV) {
  // Point the Realtime Database SDK to the Realtime Database emulator
  connectDatabaseEmulator(database, "localhost", 9002);
  
  // Point the Storage SDK to the Storage emulator
  connectStorageEmulator(storage, "localhost", 9200);
}
*/
