import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Hosted authentication must boot even when Firebase browser config has been removed.
export const firebaseApp =
  import.meta.env.VITE_AUTH_PROVIDER === 'auth0' ? null : initializeApp(firebaseConfig);
export const auth = firebaseApp ? getAuth(firebaseApp) : null;
