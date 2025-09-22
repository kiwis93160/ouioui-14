
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
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

// Get a reference to the database service and storage service
export const database = getDatabase(app);
export const storage = getStorage(app);

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
